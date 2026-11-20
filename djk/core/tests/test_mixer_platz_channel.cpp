// Place channel (DJ view): the content of place 3 / 4 sounds through the fixed channel of that place (pad/1 = L1, pad/2 = L2).
// Mixer::platz_kanal_setze(pad, inhalt): inhalt 0 nothing, 1 Strudel sum (erz/1..3 after their own strips), 2 deck/3, 3 deck/4.
// The redirected sum goes into the INPUT of pad/1 or pad/2 (in front of its strip) instead of the master sum; the master sum is read.
// A strip is not transparent (its filters shift the phase), so the reference is the two-stage mixer of the same graph: a first mixer runs the
// redirected channels alone, its master sum is fed into the pad input of a second mixer that runs everything else.
//  (a) Strudel sum into pad/1: heard once (not doubled), sample aligned with the reference (no delay), the pad/1 fader regulates all of it,
//      a muted pad/1 mutes all of it, pad/2 does not touch it, other channels are not redirected
//  (b) deck/3 into pad/2 and deck/4 into pad/1, also both pads at once
//  (c) inhalt 0 is the old behaviour bit for bit; out of range values change nothing; on and off again converges back
//  (d) switching is click free: the step from sample to sample stays inside what the unswitched and the switched signal do on their own
//  (e) a change while the source is silent still ends its blend (a strip that sleeps advances it); pad/1 -> pad/2 blends over
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>

#include "cypherdj/mixer.h"
#include "check.h"

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;
constexpr double PI = 3.14159265358979323846;

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  unsigned maske;   // bit 0..3 = deck/1..4, bit 4..6 = erz/1..3
  float ml[N], mr[N], cl[N], cr[N];
  float aus_l[N] = {}, aus_r[N] = {};
  const float* ext_l[2] = {nullptr, nullptr};   // a signal added into the input of pad/1, pad/2 (the reference feeds the first stage here)
  float letzter = 0.0f;
  float max_schritt = 0.0f;
  long t = 0;
  explicit Lauf(unsigned mask) : m(std::make_unique<cdj::Mixer>(tab)), maske(mask) {
    for (const char* p : {"deck/1/fader", "deck/2/fader", "deck/3/fader", "deck/4/fader", "erz/1/fader", "erz/2/fader", "erz/3/fader", "pad/1/fader", "pad/2/fader"})
      setze(p, 0.0f);
  }
  void setze(const char* pfad, float w) {
    const int r = tab.suche(pfad);
    PRUEF(r >= 0);
    m->setze_sofort(r, w);
  }
  void block() {
    static const double HZ[7] = {1000.0, 440.0, 700.0, 300.0, 523.0, 659.0, 784.0};
    for (int i = 0; i < N; ++i) {
      const double tt = static_cast<double>(t + i) / 48000.0;
      for (int q = 0; q < 7; ++q) {
        const float v = (maske >> q) & 1u ? static_cast<float>(0.25 * std::sin(2.0 * PI * HZ[q] * tt)) : 0.0f;
        m->eingang_l(q)[i] = v;
        m->eingang_r(q)[i] = v;
      }
      for (int p = 0; p < 2; ++p)
        if (ext_l[p]) {
          m->eingang_l(12 + p)[i] += ext_l[p][i];
          m->eingang_r(12 + p)[i] += ext_l[p][i];
        }
    }
    t += N;
    m->verarbeite(N, ml, mr, cl, cr);
    std::memcpy(aus_l, m->master_summe_l(), sizeof aus_l);
    std::memcpy(aus_r, m->master_summe_r(), sizeof aus_r);
    for (int i = 0; i < N; ++i) {
      max_schritt = std::fmax(max_schritt, std::fabs(aus_l[i] - letzter));
      letzter = aus_l[i];
    }
  }
  float spitze() const {
    float p = 0.0f;
    for (int i = 0; i < N; ++i) p = std::fmax(p, std::fmax(std::fabs(aus_l[i]), std::fabs(aus_r[i])));
    return p;
  }
};

// The reference of a redirect: stage 1 mixers (one per pad) run the redirected channels alone; their master sums go into the pad inputs of the
// stage 2 mixer, which runs the other channels. Pad faders are set on stage 2 only.
struct Referenz {
  Lauf q0, q1, y;
  Referenz(unsigned fuer_pad1, unsigned fuer_pad2, unsigned rest) : q0(fuer_pad1), q1(fuer_pad2), y(rest) {}
  void block() {
    q0.block();
    q1.block();
    y.ext_l[0] = q0.maske ? q0.aus_l : nullptr;
    y.ext_l[1] = q1.maske ? q1.aus_l : nullptr;
    y.block();
  }
};

static float abstand(const Lauf& a, const Lauf& b, float faktor = 1.0f) {
  float d = 0.0f;
  for (int i = 0; i < N; ++i) d = std::fmax(d, std::fmax(std::fabs(a.aus_l[i] - faktor * b.aus_l[i]), std::fabs(a.aus_r[i] - faktor * b.aus_r[i])));
  return d;
}

constexpr unsigned STRUDEL = 0x70, DECK3 = 0x4, DECK4 = 0x8, DECK1 = 0x1;
constexpr float TOL = 2e-6f;

int main() {
  // (a) Strudel sum into pad/1
  {
    Lauf a(STRUDEL);
    Referenz r(STRUDEL, 0, 0);
    a.m->platz_kanal_setze(0, 1);
    float gleich = 0.0f, sp = 0.0f, plain = 0.0f;
    Lauf roh(STRUDEL);   // the unswitched mixer: the sum differs from the redirected one (the pad strip filters it once more), so this is no reference
    for (int k = 0; k < 12; ++k) {
      a.block();
      r.block();
      roh.block();
      if (k >= 6) { gleich = std::fmax(gleich, abstand(a, r.y)); sp = std::fmax(sp, a.spitze()); plain = std::fmax(plain, abstand(a, roh)); }
    }
    PRUEF(sp > 0.3f);
    PRUEF(gleich < TOL);    // through the pad strip once, heard once, sample aligned with the two-stage reference
    PRUEF(plain > 0.05f);   // and it really went through the pad strip (the unswitched sum differs)
    // pad/1 fader -6 dB: the whole Strudel sum follows
    Lauf b(STRUDEL);
    Referenz r2(STRUDEL, 0, 0);
    b.m->platz_kanal_setze(0, 1);
    b.setze("pad/1/fader", -6.0f);
    r2.y.setze("pad/1/fader", -6.0f);
    float d6 = 0.0f;
    for (int k = 0; k < 12; ++k) { b.block(); r2.block(); if (k >= 6) d6 = std::fmax(d6, abstand(b, r2.y)); }
    PRUEF(d6 < TOL);
    // pad/1 fader at the floor: the master hears nothing of the sum
    Lauf c(STRUDEL);
    c.m->platz_kanal_setze(0, 1);
    c.setze("pad/1/fader", -200.0f);
    float stumm = 0.0f;
    for (int k = 0; k < 12; ++k) { c.block(); if (k >= 6) stumm = std::fmax(stumm, c.spitze()); }
    PRUEF(stumm < 1e-5f);
    // pad/2 fader does not touch a sum that sits on pad/1
    Lauf d(STRUDEL);
    Referenz r3(STRUDEL, 0, 0);
    d.m->platz_kanal_setze(0, 1);
    d.setze("pad/2/fader", -200.0f);
    float p2 = 0.0f;
    for (int k = 0; k < 12; ++k) { d.block(); r3.block(); if (k >= 6) p2 = std::fmax(p2, abstand(d, r3.y)); }
    PRUEF(p2 < TOL);
    // other channels are not redirected: deck/1 plus the sum with pad/1 muted leaves deck/1 alone
    Lauf e(STRUDEL | DECK1), only(DECK1);
    e.m->platz_kanal_setze(0, 1);
    e.setze("pad/1/fader", -200.0f);
    float rest = 0.0f;
    for (int k = 0; k < 12; ++k) { e.block(); only.block(); if (k >= 6) rest = std::fmax(rest, abstand(e, only)); }
    PRUEF(rest < TOL && only.spitze() > 0.1f);
  }
  // (b) deck/3 into pad/2, deck/4 into pad/1
  {
    Lauf a(DECK3 | DECK1);
    Referenz r(0, DECK3, DECK1);
    a.m->platz_kanal_setze(1, 2);
    float gleich = 0.0f;
    for (int k = 0; k < 12; ++k) { a.block(); r.block(); if (k >= 6) gleich = std::fmax(gleich, abstand(a, r.y)); }
    PRUEF(gleich < TOL && r.y.spitze() > 0.1f);
    Lauf b(DECK3 | DECK1), only(DECK1);   // pad/2 muted: deck/3 is gone, deck/1 stays
    b.m->platz_kanal_setze(1, 2);
    b.setze("pad/2/fader", -200.0f);
    float rest = 0.0f;
    for (int k = 0; k < 12; ++k) { b.block(); only.block(); if (k >= 6) rest = std::fmax(rest, abstand(b, only)); }
    PRUEF(rest < TOL);
    Lauf c(DECK4 | DECK3), only3(DECK3);   // deck/4 on pad/1 muted, deck/3 untouched
    c.m->platz_kanal_setze(0, 3);
    c.setze("pad/1/fader", -200.0f);
    float rest3 = 0.0f;
    for (int k = 0; k < 12; ++k) { c.block(); only3.block(); if (k >= 6) rest3 = std::fmax(rest3, abstand(c, only3)); }
    PRUEF(rest3 < TOL);
    // both pads at once, each fixed to its own channel: deck/4 on pad/1 at -6 dB, deck/3 on pad/2 at 0 dB
    Lauf d(DECK3 | DECK4);
    Referenz r2(DECK4, DECK3, 0);
    d.m->platz_kanal_setze(0, 3);
    d.m->platz_kanal_setze(1, 2);
    d.setze("pad/1/fader", -6.0f);
    r2.y.setze("pad/1/fader", -6.0f);
    float zwei = 0.0f;
    for (int k = 0; k < 12; ++k) { d.block(); r2.block(); if (k >= 6) zwei = std::fmax(zwei, abstand(d, r2.y)); }
    PRUEF(zwei < TOL);
  }
  // (c) inhalt 0: the same bits as a mixer that was never asked
  {
    Lauf a(0x7F), r(0x7F);
    a.m->platz_kanal_setze(0, 0);
    a.m->platz_kanal_setze(1, 0);
    bool bit = true;
    for (int k = 0; k < 10; ++k) {
      a.block();
      r.block();
      bit = bit && std::memcmp(a.aus_l, r.aus_l, sizeof a.aus_l) == 0 && std::memcmp(a.aus_r, r.aus_r, sizeof a.aus_r) == 0;
    }
    PRUEF(bit);
    PRUEF(a.m->platz_kanal(0) == 0 && a.m->platz_kanal(1) == 0 && !a.m->platz_kanal_wechselt());
    // out of range values are refused and change nothing
    a.m->platz_kanal_setze(0, 4);
    a.m->platz_kanal_setze(2, 1);
    a.m->platz_kanal_setze(-1, 1);
    a.m->platz_kanal_setze(0, -1);
    PRUEF(a.m->platz_kanal(0) == 0 && a.m->platz_kanal(1) == 0 && a.m->platz_kanal(2) == 0 && !a.m->platz_kanal_wechselt());
    // on and off again: back on the old path (only the pad strip's own filter tail is left, it dies out)
    a.m->platz_kanal_setze(0, 1);
    for (int k = 0; k < 6; ++k) { a.block(); r.block(); }
    PRUEF(a.m->platz_kanal(0) == 1);
    a.m->platz_kanal_setze(0, 0);
    float spaet = 0.0f;
    for (int k = 0; k < 40; ++k) { a.block(); r.block(); if (k >= 30) spaet = std::fmax(spaet, abstand(a, r)); }
    PRUEF(spaet < TOL && !a.m->platz_kanal_wechselt());
  }
  // (d) click free: the step of the sum stays inside the steps of the two pure signals (unswitched, switched), before, in and after the blends
  {
    Lauf roh(STRUDEL | DECK1), fest(STRUDEL | DECK1), a(STRUDEL | DECK1);
    fest.m->platz_kanal_setze(0, 1);
    for (int k = 0; k < 40; ++k) { roh.block(); fest.block(); }
    const float grenze = std::fmax(roh.max_schritt, fest.max_schritt);
    PRUEF(grenze > 0.01f);
    for (int k = 0; k < 60; ++k) {
      if (k == 8) a.m->platz_kanal_setze(0, 1);
      if (k == 24) a.m->platz_kanal_setze(0, 0);
      if (k == 36) a.m->platz_kanal_setze(1, 1);
      if (k == 48) a.m->platz_kanal_setze(0, 1);   // pad/2 -> pad/1 with the pad/1 change in one go
      a.block();
    }
    PRUEF(a.max_schritt < grenze * 1.15f);
    PRUEF(a.spitze() > 0.1f);
    // the blend is no hole: the energy of the sum stays within the two pure signals while it runs
    Lauf x(STRUDEL), ref(STRUDEL);
    float emin = 1e9f, emax = 0.0f;
    for (int k = 0; k < 24; ++k) {
      if (k == 10) x.m->platz_kanal_setze(0, 1);
      x.block();
      ref.block();
      if (k >= 9 && k <= 13) {
        float e = 0.0f;
        for (int i = 0; i < N; ++i) e += x.aus_l[i] * x.aus_l[i];
        emin = std::fmin(emin, e);
        emax = std::fmax(emax, e);
      }
    }
    PRUEF(emin > 0.5f * emax);
  }
  // (e) a change while the source is silent still ends its blend; pad/1 -> pad/2 while sounding
  {
    Lauf a(0);
    Referenz r(0, 0, 0);
    a.m->platz_kanal_setze(0, 1);
    for (int k = 0; k < 4; ++k) { a.block(); r.block(); }
    PRUEF(!a.m->platz_kanal_wechselt());
    a.maske = STRUDEL;
    r.q0.maske = STRUDEL;
    float gleich = 0.0f;
    for (int k = 0; k < 8; ++k) { a.block(); r.block(); gleich = std::fmax(gleich, abstand(a, r.y)); }
    PRUEF(gleich < TOL);   // the first sample of the sound is already fully in pad/1: no fade-in from a blend that stood still
    Lauf b(STRUDEL);
    Referenz r2(0, STRUDEL, 0);
    b.m->platz_kanal_setze(0, 1);
    for (int k = 0; k < 24; ++k) {
      if (k == 8) { b.m->platz_kanal_setze(0, 0); b.m->platz_kanal_setze(1, 1); }
      b.block();
      r2.block();
    }
    PRUEF(b.m->platz_kanal(0) == 0 && b.m->platz_kanal(1) == 1 && !b.m->platz_kanal_wechselt());
    PRUEF(abstand(b, r2.y) < TOL);   // after the blends: on pad/2 only, filter tail of pad/1 long gone
  }
  PRUEF_ENDE();
}
