// 1.15 A5a: the latency account. With an injected limiter look-ahead L (Mixer::setze_kanal_latenz, no limiter object involved) every
// master-bound path arrives at the master exactly L samples later than with L = 0, all of them by the same amount:
//   the four buses (a delay of L after the bus strip), the direct sources, the hall return, the send-graph returns (the sum is delayed
//   before the master FX and the buses are added there), the metronome (own delay) and the PFL (the cue delay is vh + L).
//  (C1)  an impulse on deck/1 (target master) and an impulse on erz/1 routed to bus/1, then bus/4, appear on the same output sample,
//        that sample being the L = 0 sample + L; two buses at the same time; at block sizes 256, 128, 64, 32 and L = 26 and 2062
//  (C2)  the send-graph return fx/3 and the hall return of a source (direct and bus-routed) keeps its place against the dry signal (both shift by L); the bus's own
//        send: its wet part and its dry part keep their L = 0 offset (the residual of D8, measured and printed)
//  (C3)  the metronome click and a source click injected on the same sample leave on the same sample (L = 0 sample + L)
//  (C4)  the cue: the PFL impulse leaves the cue vh + L samples after the input, and the master impulse leaves the master vh + L after
//        the input (ADR 008 point 3); also for the PFL of a bus channel and for the metronome's cue input
//  (C5)  L = 0 (the default): the mixer is bit-identical to one that never heard of the account; L set and set back to 0 is identical
//        again (rings cleared), L > 0 differs (positive control). The golden digest itself: test_mixer_golden, unchanged.
//        (fix round 1) the same value again, in the middle of a run, is a no-op (bit-identical); a value outside 0..kMaxLatenz is clamped
//  (C6)  the PFL ring at L = kMaxLatenz (2062): vh + L = 2146 of its kMaxVorhalt + 1 + kMaxLatenz = 3099 entries (the worst case vh = kMaxVorhalt
//        is not settable; the size formula is pinned directly); correct at block sizes 32 and 256, clean under the sanitizer build
//  (C7)  real-time discipline: 0 allocations, frees, locks, sleeps with L > 0 and every path in use
//  (W)   the whole mix (noise on direct sources and on buses, hall, bus send, multiband on a bus, metronome, PFL, mixed block sizes 1..1024)
//        shifted by L: master, cue and the ear tap at L equal their L = 0 selves delayed by L
//  (F)   the F01 guard resets the new rings and the PFL ring (an impulse in flight is dropped, the cue goes silent with the master); a NaN or Inf in
//        the metronome input falls in its own block; a NaN on a bus-routed source is caught before the bus delay (the master is finite throughout and the signal is back L + vh + 2 blocks after the bad block)
//  (Z)   index ranges: the sources never touch a bus ring (the shifted-waveform checks above would show a bleed; the sanitizer run
//        shows an out-of-range access)
#include <cmath>
#include <cstdio>
#include <cstring>
#include <functional>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/dsp/channel_limiter.h"
#include "mixer_wz_run.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

using namespace wzt;

namespace {

// a pass-through effect graph for the send return fx/3 (the graph is owned by the mixer from setze_send_graph on)
const char* DURCH =
    R"({"format":"baukasten/2","name":"durch","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"o.l"},{"von":"e.r","nach":"o.r"}]})";

constexpr int LMAX = cypherdj::dsp::KanalLimiter::kMaxLatenz;   // 2062
constexpr int ERZ3 = 6;                                          // not in mixer_wz_run.h
constexpr long GESAMT = 8192;                                    // divisible by every block size used below
const int GROESSEN[] = {256, 128, 64, 32};

struct Spur {
  std::vector<float> ml, mr, cl, cr, tap;
  int vh = 0;
};

enum class Art { quelle, metro_master, metro_cue };
struct Impuls {
  Art art;
  int kanal;   // mixer channel for Art::quelle
  long s;      // absolute input sample
  float a;
};

using Vorbereitung = std::function<void(Lauf&)>;

// n-sample blocks of GESAMT samples, impulses injected at their absolute sample, L injected first
Spur fahre(int n, int L, const std::vector<Impuls>& imp, const Vorbereitung& vor, long gesamt = GESAMT) {
  Lauf l;
  l.m->setze_kanal_latenz(L);
  if (vor) vor(l);
  Spur sp;
  sp.vh = l.m->limiter_vorhalt();
  for (long t0 = 0; t0 < gesamt; t0 += n) {
    for (const Impuls& p : imp) {
      if (p.s < t0 || p.s >= t0 + n) continue;
      const int i = static_cast<int>(p.s - t0);
      float *el = nullptr, *er = nullptr;
      switch (p.art) {
        case Art::quelle: el = l.m->eingang_l(p.kanal); er = l.m->eingang_r(p.kanal); break;
        case Art::metro_master: el = l.m->summe_eingang_l(); er = l.m->summe_eingang_r(); break;
        case Art::metro_cue: el = l.m->pfl_eingang_l(); er = l.m->pfl_eingang_r(); break;
      }
      el[i] += p.a;
      er[i] += p.a;
    }
    l.verarbeite(n);
    sp.ml.insert(sp.ml.end(), l.ml, l.ml + n);
    sp.mr.insert(sp.mr.end(), l.mr, l.mr + n);
    sp.cl.insert(sp.cl.end(), l.cl, l.cl + n);
    sp.cr.insert(sp.cr.end(), l.cr, l.cr + n);
    sp.tap.insert(sp.tap.end(), l.m->master_summe_l(), l.m->master_summe_l() + n);
  }
  return sp;
}

// first sample from `ab` whose magnitude exceeds `anteil` of the peak found from `ab` on (-1: nothing)
long einsatz(const std::vector<float>& x, long ab, long bis, double anteil = 0.25) {
  float p = 0.0f;
  for (long i = ab; i < bis && i < static_cast<long>(x.size()); ++i) p = std::fmax(p, std::fabs(x[i]));
  if (p <= 0.0f) return -1;
  for (long i = ab; i < bis && i < static_cast<long>(x.size()); ++i)
    if (std::fabs(x[i]) > anteil * p) return i;
  return -1;
}

// largest |a[i + L] - b[i]| for i in [von, bis)
double verschiebung_abstand(const std::vector<float>& a, const std::vector<float>& b, int L, long von, long bis) {
  double d = 0.0;
  for (long i = von; i < bis && i + L < static_cast<long>(a.size()); ++i)
    d = std::fmax(d, std::fabs(static_cast<double>(a[i + L]) - b[i]));
  return d;
}

void ziel_bus(Lauf& l, int quelle, int bus) { l.setze(quelle, "ziel", static_cast<float>(bus)); }

// ---- (C1) ----
void c1() {
  for (int n : GROESSEN)
    for (int L : {26, LMAX})
      for (int bus : {1, 4}) {
        const int k_bus = BUS1 + bus - 1;
        // three impulses one after the other: deck/1 on the master, erz/1 on bus `bus`, erz/2 on the other end bus
        const int bus2 = bus == 1 ? 4 : 1;
        const std::vector<Impuls> imp = {{Art::quelle, DECK1, 100, 0.5f}, {Art::quelle, ERZ1, 3000, 0.5f}, {Art::quelle, ERZ2, 6000, 0.5f}};
        const Vorbereitung vor = [&](Lauf& l) {
          ziel_bus(l, ERZ1, bus);
          ziel_bus(l, ERZ2, bus2);
        };
        const Spur s0 = fahre(n, 0, imp, vor);
        const Spur sl = fahre(n, L, imp, vor);
        const long e0[3] = {einsatz(s0.ml, 100, 1500), einsatz(s0.ml, 3000, 4500), einsatz(s0.ml, 6000, 7500)};
        const long el[3] = {einsatz(sl.ml, 100, 1500 + L), einsatz(sl.ml, 3000, 4500 + L), einsatz(sl.ml, 6000, 7500 + L)};
        std::printf("C1 n=%d L=%d bus=%d: onsets L=0 %ld %ld %ld, L=%d %ld %ld %ld (k_bus %d)\n", n, L, bus, e0[0], e0[1], e0[2], L, el[0], el[1], el[2], k_bus);
        for (int j = 0; j < 3; ++j) {
          PRUEF(e0[j] >= 0);
          PRUEF(el[j] == e0[j] + L);   // every path arrives exactly L later
        }
        PRUEF(e0[0] - 100 == e0[1] - 3000 && e0[1] - 3000 == e0[2] - 6000);   // L = 0: the three paths have the same strip latency
        PRUEF(el[0] - 100 == el[1] - 3000 && el[1] - 3000 == el[2] - 6000);   // L > 0: still the same, i.e. direct and bus arrive aligned
        PRUEF(verschiebung_abstand(sl.ml, s0.ml, L, 0, GESAMT - L) < 1e-6);   // the whole left master is the L = 0 master delayed by L
        PRUEF(verschiebung_abstand(sl.mr, s0.mr, L, 0, GESAMT - L) < 1e-6);
        PRUEF(verschiebung_abstand(sl.tap, s0.tap, L, 0, GESAMT - L) < 1e-6);   // the ear tap reads after the merge
      }
  // two buses at the same time, and the direct source on the same sample as well
  for (int n : GROESSEN)
    for (int L : {26, LMAX}) {
      const std::vector<Impuls> imp = {{Art::quelle, ERZ1, 300, 0.5f}, {Art::quelle, ERZ2, 300, -0.25f}, {Art::quelle, DECK1, 300, 0.125f}};
      const Vorbereitung vor = [&](Lauf& l) {
        ziel_bus(l, ERZ1, 1);
        ziel_bus(l, ERZ2, 4);
      };
      const Spur s0 = fahre(n, 0, imp, vor);
      const Spur sl = fahre(n, L, imp, vor);
      PRUEF(verschiebung_abstand(sl.ml, s0.ml, L, 0, GESAMT - L) < 1e-6);
      PRUEF(verschiebung_abstand(sl.ml, s0.ml, 0, 0, 300 + 200) > 0.0 || L == 0);   // positive control: unshifted they differ
      long a = einsatz(s0.ml, 300, 1000, 0.05), b = einsatz(sl.ml, 300, 1000 + L, 0.05);
      PRUEF(a >= 0 && b == a + L);
    }
}

// ---- (C2) ----
void c2() {
  for (int n : GROESSEN)
    for (int L : {26, LMAX}) {
      for (int ziel : {0, 1, 4}) {   // 0: master; bus 1 and bus 4: the source is bus-routed
        auto lauf = [&](int ll, bool hall_an) {
          const Vorbereitung vor = [&](Lauf& l) {
            l.setze(ERZ1, "send/2", 0.0f);   // send 2 = the hall
            l.setze("fx/2/rueckweg", hall_an ? 0.0f : -200.0f);
            if (ziel) ziel_bus(l, ERZ1, ziel);
          };
          return fahre(n, ll, {{Art::quelle, ERZ1, 100, 0.5f}}, vor, 16384);
        };
        const Spur t0 = lauf(0, false), h0 = lauf(0, true), tl = lauf(L, false), hl = lauf(L, true);
        // the hall return = with minus without
        std::vector<float> r0(h0.ml.size()), rl(hl.ml.size());
        for (size_t i = 0; i < r0.size(); ++i) r0[i] = h0.ml[i] - t0.ml[i];
        for (size_t i = 0; i < rl.size(); ++i) rl[i] = hl.ml[i] - tl.ml[i];
        const long dry0 = einsatz(t0.ml, 100, 1500), dryl = einsatz(tl.ml, 100, 1500 + L);
        const long hall0 = einsatz(r0, 100, 8000, 0.02), halll = einsatz(rl, 100, 8000 + L, 0.02);
        std::printf("C2 n=%d L=%d ziel=%d: dry onset %ld -> %ld, hall onset %ld -> %ld, wet-dry offset %ld -> %ld\n", n, L, ziel, dry0, dryl,
                    hall0, halll, hall0 - dry0, halll - dryl);
        PRUEF(dry0 >= 0 && dryl == dry0 + L);
        PRUEF(hall0 >= 0 && halll == hall0 + L);   // the hall return is delayed once, like the dry signal
        PRUEF(halll - dryl == hall0 - dry0);       // aligned: their offset does not move
        PRUEF(verschiebung_abstand(rl, r0, L, 0, 12000) < 1e-5);   // and the whole hall return is the L = 0 one delayed by L
      }
      // the bus's own send (the residual of D8): the wet part and the dry part of bus/1 keep the offset they have at L = 0
      auto lauf2 = [&](int ll, bool hall_an) {
        const Vorbereitung vor = [&](Lauf& l) {
          ziel_bus(l, ERZ1, 1);
          l.setze(BUS1, "send/2", 0.0f);
          l.setze("fx/2/rueckweg", hall_an ? 0.0f : -200.0f);
        };
        return fahre(n, ll, {{Art::quelle, ERZ1, 100, 0.5f}}, vor, 16384);
      };
      const Spur t0 = lauf2(0, false), h0 = lauf2(0, true), tl = lauf2(L, false), hl = lauf2(L, true);
      std::vector<float> r0(h0.ml.size()), rl(hl.ml.size());
      for (size_t i = 0; i < r0.size(); ++i) r0[i] = h0.ml[i] - t0.ml[i];
      for (size_t i = 0; i < rl.size(); ++i) rl[i] = hl.ml[i] - tl.ml[i];
      const long dry0 = einsatz(t0.ml, 100, 1500), dryl = einsatz(tl.ml, 100, 1500 + L);
      const long hall0 = einsatz(r0, 100, 8000, 0.02), halll = einsatz(rl, 100, 8000 + L, 0.02);
      std::printf("C2 bus send n=%d L=%d: wet-dry offset L=0 %ld, L=%d %ld (residual = %ld samples)\n", n, L, hall0 - dry0, L, halll - dryl,
                  (halll - dryl) - (hall0 - dry0));
      PRUEF(hall0 >= 0 && dry0 >= 0);
      PRUEF(halll - dryl == hall0 - dry0);
    }
}

// (C2, send graph) the send-graph return fx/3 joins sum_ before the merge like the hall return: it is delayed once. Source direct and on bus/1.
void c2_send_graph() {
  for (int n : GROESSEN)
    for (int L : {26, LMAX})
      for (int ziel : {0, 1}) {
        auto lauf = [&](int ll, bool nass) {
          const Vorbereitung vor = [&](Lauf& l) {
            if (nass) {
              char f[256] = {};
              CypherBk* g = cypher_bk_neu(DURCH, 48000.0, f, sizeof f);
              PRUEF(g != nullptr);
              l.m->setze_send_graph(2, g);
            }
            l.setze(ERZ1, "send/3", nass ? 0.0f : -200.0f);
            l.setze("fx/3/rueckweg", 0.0f);
            if (ziel) ziel_bus(l, ERZ1, ziel);
          };
          return fahre(n, ll, {{Art::quelle, ERZ1, 100, 0.5f}}, vor, 8192);
        };
        const Spur t0 = lauf(0, false), h0 = lauf(0, true), tl = lauf(L, false), hl = lauf(L, true);
        std::vector<float> r0(h0.ml.size()), rl(hl.ml.size());
        for (size_t i = 0; i < r0.size(); ++i) r0[i] = h0.ml[i] - t0.ml[i];
        for (size_t i = 0; i < rl.size(); ++i) rl[i] = hl.ml[i] - tl.ml[i];
        const long dry0 = einsatz(t0.ml, 100, 1500), dryl = einsatz(tl.ml, 100, 1500 + L);
        const long ret0 = einsatz(r0, 100, 1500), retl = einsatz(rl, 100, 1500 + L);
        std::printf("C2 send graph n=%d L=%d ziel=%d: dry onset %ld -> %ld, send-graph return onset %ld -> %ld, return-dry %ld -> %ld\n", n, L, ziel, dry0, dryl,
                    ret0, retl, ret0 - dry0, retl - dryl);
        PRUEF(dry0 >= 0 && ret0 >= 0);   // positive control: the return really sounds
        PRUEF(retl == ret0 + L);
        PRUEF(retl - dryl == ret0 - dry0);
        PRUEF(verschiebung_abstand(rl, r0, L, 0, 6000) < 5e-7);
      }
}

// ---- (C3) ----
void c3() {
  for (int n : GROESSEN)
    for (int L : {26, LMAX}) {
      const Impuls quelle{Art::quelle, DECK1, 300, 0.5f}, klick{Art::metro_master, 0, 300, 0.5f};
      const Spur q0 = fahre(n, 0, {quelle}, nullptr), k0 = fahre(n, 0, {klick}, nullptr);
      const Spur ql = fahre(n, L, {quelle}, nullptr), kl = fahre(n, L, {klick}, nullptr);
      const Spur bl = fahre(n, L, {quelle, klick}, nullptr);
      const long eq0 = einsatz(q0.ml, 300, 1500), ek0 = einsatz(k0.ml, 300, 1500);
      const long eql = einsatz(ql.ml, 300, 1500 + L), ekl = einsatz(kl.ml, 300, 1500 + L), ebl = einsatz(bl.ml, 300, 1500 + L);
      std::printf("C3 n=%d L=%d: source click %ld -> %ld, metronome click %ld -> %ld, both %ld\n", n, L, eq0, eql, ek0, ekl, ebl);
      PRUEF(eq0 >= 0 && ek0 >= 0 && eq0 == ek0);   // L = 0: both leave on the same sample (precondition of the comparison)
      PRUEF(eql == eq0 + L);
      PRUEF(ekl == ek0 + L);                       // the metronome goes through its own delay of L
      PRUEF(eql == ekl && ebl == eql);             // same sample, both alone and together
      // together, the output before the common onset is silent: neither click leaves early
      double vor = 0.0;
      for (long i = 300; i < ebl; ++i) vor = std::fmax(vor, std::fabs(bl.ml[i]));
      PRUEF(vor == 0.0);
      PRUEF(verschiebung_abstand(kl.ml, k0.ml, L, 0, GESAMT - L) < 1e-6);
      // the residual of D8: the test click master_eingang_* sits behind the limiter by design (F19) and is not delayed by L, so it leaves
      // vh + L samples before any other path injected on the same sample (vh before the account: the new part is L)
      Spur tl;
      {
        Lauf l;
        l.m->setze_kanal_latenz(L);
        for (long t0 = 0; t0 < 1536; t0 += n) {
          if (300 >= t0 && 300 < t0 + n) l.m->master_eingang_l()[300 - t0] = 0.5f;
          l.verarbeite(n);
          tl.ml.insert(tl.ml.end(), l.ml, l.ml + n);
        }
      }
      const long etl = einsatz(tl.ml, 300, 1500);
      std::printf("C3 n=%d L=%d: test click (master_eingang) leaves at %ld, a source click at %ld: offset %ld samples (vh %d + L %d)\n", n, L, etl, eql, eql - etl, q0.vh, L);
      PRUEF(etl == 300);
      PRUEF(eql - etl == q0.vh + L);
    }
}

// ---- (C4) ----
void c4() {
  for (int n : GROESSEN)
    for (int L : {26, LMAX}) {
      // deck/1 PFL; the default cue/mix is -1 (PFL only)
      const std::vector<Impuls> imp = {{Art::quelle, DECK1, 300, 0.5f}};
      const Vorbereitung pfl = [](Lauf& l) { l.setze(DECK1, "pfl", 1.0f); };
      const Spur s0 = fahre(n, 0, imp, pfl), sl = fahre(n, L, imp, pfl);
      const int vh = sl.vh;
      const long c0 = einsatz(s0.cl, 300, 1500), m0 = einsatz(s0.ml, 300, 1500);
      const long cl = einsatz(sl.cl, 300, 1500 + L), ml = einsatz(sl.ml, 300, 1500 + L);
      std::printf("C4 n=%d L=%d vh=%d: deck PFL cue %ld -> %ld, master %ld -> %ld (input at 300)\n", n, L, vh, c0, cl, m0, ml);
      PRUEF(vh > 0);
      PRUEF(c0 == 300 + vh && m0 == 300 + vh);     // L = 0: the cue is delayed by the limiter's look-ahead like the master
      PRUEF(cl == 300 + vh + L);                   // the PFL impulse leaves the cue vh + L after the input
      PRUEF(ml == 300 + vh + L);                   // and the master impulse leaves the master vh + L after the input
      PRUEF(cl == ml);                             // equal (ADR 008 point 3)
      PRUEF(verschiebung_abstand(sl.cl, s0.cl, L, 0, GESAMT - L) < 1e-6);
      // the PFL of a bus channel: erz/1 on bus/1, PFL on the bus (the tap before its fader), erz/1's own PFL off
      const Vorbereitung bpfl = [](Lauf& l) {
        ziel_bus(l, ERZ1, 1);
        l.setze(BUS1, "pfl", 1.0f);
      };
      const std::vector<Impuls> bimp = {{Art::quelle, ERZ1, 300, 0.5f}};
      const Spur b0 = fahre(n, 0, bimp, bpfl), bl = fahre(n, L, bimp, bpfl);
      const long bc0 = einsatz(b0.cl, 300, 1500), bm0 = einsatz(b0.ml, 300, 1500);
      const long bcl = einsatz(bl.cl, 300, 1500 + L), bml = einsatz(bl.ml, 300, 1500 + L);
      std::printf("C4 n=%d L=%d bus PFL: cue %ld -> %ld, master %ld -> %ld\n", n, L, bc0, bcl, bm0, bml);
      PRUEF(bc0 >= 0 && bc0 == bm0);
      PRUEF(bcl == bc0 + L && bml == bm0 + L && bcl == bml);   // bus: delay L on the bus and vh + L on its PFL
      // the metronome: master input and cue input on the same sample leave the master and the cue together
      const std::vector<Impuls> mimp = {{Art::metro_master, 0, 300, 0.5f}, {Art::metro_cue, 0, 300, 0.5f}};
      const Spur k0 = fahre(n, 0, mimp, nullptr), kl = fahre(n, L, mimp, nullptr);
      const long kc0 = einsatz(k0.cl, 300, 1500), km0 = einsatz(k0.ml, 300, 1500);
      const long kcl = einsatz(kl.cl, 300, 1500 + L), kml = einsatz(kl.ml, 300, 1500 + L);
      std::printf("C4 n=%d L=%d metronome: cue %ld -> %ld, master %ld -> %ld\n", n, L, kc0, kcl, km0, kml);
      PRUEF(kc0 >= 0 && kc0 == km0 && kcl == kc0 + L && kml == km0 + L && kcl == kml);
    }
}

// ---- (C5) ----
// a mixed scenario that touches every path; the same input for any instance
void mischung(Lauf& l, int blocks, int n) {
  l.setze(ERZ1, "send/2", -6.0f);
  l.setze(ERZ2, "send/2", -3.0f);
  l.setze("fx/2/rueckweg", -6.0f);
  ziel_bus(l, ERZ2, 1);
  ziel_bus(l, PAD1, 4);
  l.setze(DECK1, "pfl", 1.0f);
  l.setze(BUS1, "pfl", 1.0f);
  for (int b = 0; b < blocks; ++b) {
    l.rausch(DECK1, 0.3, n);
    l.rausch(ERZ1, 0.2, n);
    l.rausch(ERZ2, 0.2, n);
    l.sinus(PAD1, 440.0, 0.2, 0.2, n);
    for (int i = 0; i < n; ++i) {
      l.m->summe_eingang_l()[i] = (b * n + i) % 12000 == 0 ? 0.3f : 0.0f;
      l.m->summe_eingang_r()[i] = l.m->summe_eingang_l()[i];
      l.m->pfl_eingang_l()[i] = l.m->summe_eingang_l()[i];
      l.m->pfl_eingang_r()[i] = l.m->summe_eingang_l()[i];
    }
    l.verarbeite(n);
  }
}
void c5() {
  for (int n : {256, 64, 32}) {
    Lauf frisch, null, anders;
    null.m->setze_kanal_latenz(0);
    anders.m->setze_kanal_latenz(26);
    mischung(frisch, 120, n);
    mischung(null, 120, n);
    mischung(anders, 120, n);
    PRUEF(gleich(frisch, null, n));      // setze_kanal_latenz(0) is the default
    PRUEF(!gleich(frisch, anders, n));   // positive control: L > 0 is not the same mix
  }
  // set to L, put the metronome clicks (no strip, no filter tail) into the metronome ring and the PFL ring, set back to 0: the lines are
  // cleared, nothing of the clicks comes out later. Positive control: left at L, the clicks do come out.
  for (int n : {256, 32})
    for (int zuruecksetzen = 0; zuruecksetzen < 2; ++zuruecksetzen) {
      double m = 0.0;
      Lauf l;
      l.m->setze_kanal_latenz(LMAX);
      l.m->summe_eingang_l()[2] = 0.5f;
      l.m->pfl_eingang_l()[3] = 0.5f;
      l.verarbeite(n);
      if (zuruecksetzen) l.m->setze_kanal_latenz(0);
      for (int b = 0; b < 12288 / n; ++b) {
        l.verarbeite(n);
        for (int i = 0; i < n; ++i) m = std::fmax(m, std::fmax(std::fabs(l.ml[i]), std::fabs(l.cl[i])));
      }
      std::printf("C5 n=%d: L=%d, %s, clicks in flight: peak %g afterwards\n", n, LMAX, zuruecksetzen ? "set back to 0" : "left at L", m);
      if (zuruecksetzen) PRUEF(m == 0.0);
      else PRUEF(m > 0.05);   // positive control
    }
}

// ---- (C6) ----
void c6() {
  for (int n : {32, 256}) {
    const int L = LMAX;
    const std::vector<Impuls> imp = {{Art::quelle, DECK1, 100, 0.5f}, {Art::quelle, ERZ1, 3000, 0.5f}, {Art::metro_master, 0, 6000, 0.5f},
                                     {Art::metro_cue, 0, 9000, 0.5f}};
    const Vorbereitung vor = [](Lauf& l) {
      ziel_bus(l, ERZ1, 4);
      l.setze(DECK1, "pfl", 1.0f);
      l.setze(BUS1 + 3, "pfl", 1.0f);
    };
    const long gesamt = 14336;
    const Spur s0 = fahre(n, 0, imp, vor, gesamt), sl = fahre(n, L, imp, vor, gesamt);
    const int vh = sl.vh;
    const long e_deck = einsatz(sl.cl, 100, 2000 + L, 0.25);
    const long e_dm = einsatz(sl.ml, 100, 2000 + L, 0.25);
    std::printf("C6 n=%d L=%d vh=%d (vh+L = %d of cap %d): deck PFL cue at %ld (input 100), master at %ld; ring ends %d\n", n, L, vh, vh + L,
                cypherdj::dsp::MasterLimiter::kMaxVorhalt + 1 + LMAX, e_deck, e_dm, cypherdj::dsp::MasterLimiter::kMaxVorhalt + LMAX);
    PRUEF(e_deck == 100 + vh + L && e_dm == 100 + vh + L);
    // vh + L is 2146 of 3099 entries here: the default limiter's vh is 84, and no setting reaches the worst case vh = kMaxVorhalt. The ring is
    // sized for that worst case, so the formula is pinned by its size, not by a run
    PRUEF(cdj::Mixer::pfl_ring_groesse() == cypherdj::dsp::MasterLimiter::kMaxVorhalt + 1 + LMAX);
    PRUEF(vh + L < cdj::Mixer::pfl_ring_groesse());
    PRUEF(verschiebung_abstand(sl.cl, s0.cl, L, 0, gesamt - L) < 1e-6);
    PRUEF(verschiebung_abstand(sl.ml, s0.ml, L, 0, gesamt - L) < 1e-6);
    PRUEF(verschiebung_abstand(sl.mr, s0.mr, L, 0, gesamt - L) < 1e-6);
  }
}

// ---- (W) ----
void w_ganze_mischung() {
  const int groessen[] = {1, 7, 32, 64, 100, 128, 256, 1000, 1024, 33, 5, 512};
  for (int L : {26, 400, LMAX}) {
    Spur sp[2];
    for (int variante = 0; variante < 2; ++variante) {
      Lauf l;
      l.m->setze_kanal_latenz(variante ? L : 0);
      l.setze(ERZ1, "send/2", -6.0f);
      l.setze(ERZ2, "send/2", -3.0f);
      l.setze(BUS1, "send/2", -9.0f);
      l.setze("fx/2/rueckweg", -6.0f);
      ziel_bus(l, ERZ2, 1);
      ziel_bus(l, ERZ3, 4);
      ziel_bus(l, PAD1, 2);
      l.setze(DECK1, "pfl", 1.0f);
      l.setze(BUS1, "pfl", 1.0f);
      l.setze(BUS1, "mb/an", 1.0f);   // the multiband on a bus: it sits before the delay, its fade and order are not touched
      l.setze(BUS1, "mb/mitte/schwelle", -30.0f);
      l.setze(BUS1, "mb/mitte/ratio", 4.0f);
      long t = 0;
      sp[variante].vh = l.m->limiter_vorhalt();
      for (int b = 0; b < 70; ++b) {
        const int n = groessen[b % 12];
        l.rausch(DECK1, 0.3, n);
        l.rausch(ERZ1, 0.2, n);
        l.rausch(ERZ2, 0.4, n);
        l.rausch(ERZ3, 0.3, n);
        l.sinus(PAD1, 440.0, 0.2, 0.2, n);
        for (int i = 0; i < n; ++i) {
          const bool klick = (t + i) % 5000 == 0;
          l.m->summe_eingang_l()[i] = klick ? 0.3f : 0.0f;
          l.m->summe_eingang_r()[i] = klick ? 0.3f : 0.0f;
          l.m->pfl_eingang_l()[i] = klick ? 0.3f : 0.0f;
          l.m->pfl_eingang_r()[i] = klick ? 0.3f : 0.0f;
        }
        l.verarbeite(n);
        t += n;
        sp[variante].ml.insert(sp[variante].ml.end(), l.ml, l.ml + n);
        sp[variante].cl.insert(sp[variante].cl.end(), l.cl, l.cl + n);
        sp[variante].tap.insert(sp[variante].tap.end(), l.m->master_summe_l(), l.m->master_summe_l() + n);
      }
    }
    const long n_ges = static_cast<long>(sp[0].ml.size());
    const double dm = verschiebung_abstand(sp[1].ml, sp[0].ml, L, 0, n_ges - L);
    const double dc = verschiebung_abstand(sp[1].cl, sp[0].cl, L, 0, n_ges - L);
    const double dt = verschiebung_abstand(sp[1].tap, sp[0].tap, L, 0, n_ges - L);
    const double d0 = verschiebung_abstand(sp[1].ml, sp[0].ml, 0, 0, n_ges);   // positive control: unshifted they differ clearly
    std::printf("W L=%d (%ld samples): shifted distance master %g, cue %g, tap %g; unshifted master %g\n", L, n_ges, dm, dc, dt, d0);
    // measured 1.8e-7 (master), 2.4e-7 (tap), 0 (cue); 1.8e-7 is about 3 ulp at amplitude 0.5..1 (one ulp is 6e-8), from the reordered sum of the contributions;
    // the limit 5e-7 is about 8 ulp. A shift error of one sample moves this by > 0.01
    PRUEF(dm < 5e-7 && dc < 5e-7 && dt < 5e-7);
    PRUEF(d0 > 0.05);
  }
}

// ---- (F) ----
void f01() {
  for (int n : {256, 32}) {
    const int L = 600;
    // (1) impulses in flight on the three rings (sum, bus, metronome), then a NaN on a direct source in a later block: the guard drops them
    {
      const std::vector<Impuls> imp = {{Art::quelle, DECK1, 10, 0.5f}, {Art::quelle, ERZ1, 11, 0.5f}, {Art::metro_master, 0, 12, 0.5f},
                                       {Art::metro_cue, 0, 13, 0.5f}};
      const Vorbereitung vor = [](Lauf& l) { ziel_bus(l, ERZ1, 1); };
      Lauf l;
      l.m->setze_kanal_latenz(L);
      vor(l);
      const long gift = (300 / n) * n;   // a block after the impulses went in and before they emerge (10 + 600)
      double nach = 0.0, nach_cue = 0.0;
      long t0 = 0;
      for (; t0 < 4096; t0 += n) {
        for (const Impuls& p : imp)
          if (p.s >= t0 && p.s < t0 + n) {
            float* e = p.art == Art::quelle ? l.m->eingang_l(p.kanal) : p.art == Art::metro_cue ? l.m->pfl_eingang_l() : l.m->summe_eingang_l();
            e[p.s - t0] += p.a;
          }
        if (t0 == gift) l.m->eingang_l(ERZ3)[0] = NAN;   // erz/3 goes to the master
        l.verarbeite(n);
        for (int i = 0; i < n; ++i) PRUEF(std::isfinite(l.ml[i]) && std::isfinite(l.mr[i]) && std::isfinite(l.cl[i]));
        if (t0 > gift) {   // after the bad block: the three impulses (in flight at the bad block, 300 < 10 + 600) must not come out
          for (int i = 0; i < n; ++i) nach = std::fmax(nach, std::fabs(l.ml[i]));
          for (int i = 0; i < n; ++i) nach_cue = std::fmax(nach_cue, std::fabs(l.cl[i]));
        }
      }
      std::printf("F n=%d: after the bad block at %ld: master peak %g (nan hits %lld)\n", n, gift, nach, static_cast<long long>(l.m->nan_treffer()));
      PRUEF(l.m->nan_treffer() >= 1);
      PRUEF(nach < 1e-3);
      PRUEF(nach_cue == 0.0);   // the PFL ring is cleared too (L > 0): the cue does not play up to vh + L samples of old material
      std::printf("F n=%d: cue peak after the bad block %g\n", n, nach_cue);
    }
    // (2) NaN on a bus-routed source: caught at the bus delay's input in the same block, master finite throughout, signal back soon after
    {
      Lauf l;
      l.m->setze_kanal_latenz(L);
      ziel_bus(l, ERZ1, 1);
      const long gift = (1000 / n) * n;
      long erste_stille = -1, zurueck = -1;
      long treffer_im_giftblock = -1;
      for (long t0 = 0; t0 < 6000; t0 += n) {
        l.sinus(ERZ1, 440.0, 0.3, 0.3, n);
        if (t0 == gift) l.m->eingang_l(ERZ1)[3] = NAN;
        l.verarbeite(n);
        if (t0 == gift) treffer_im_giftblock = l.m->nan_treffer();
        double e = 0.0;
        for (int i = 0; i < n; ++i) {
          PRUEF(std::isfinite(l.ml[i]) && std::isfinite(l.mr[i]));
          e += std::fabs(l.ml[i]);
        }
        if (t0 > gift && e == 0.0 && erste_stille < 0) erste_stille = t0;
        if (t0 > gift && e > 0.1 * n * 0.05 && erste_stille >= 0 && zurueck < 0) zurueck = t0;
      }
      std::printf("F n=%d bus NaN: bad block %ld, nan hits in that block %lld, signal back at %ld (L + vh + 2 blocks = %ld)\n", n, gift,
                  static_cast<long long>(treffer_im_giftblock), zurueck, gift + L + l.m->limiter_vorhalt() + 2 * n);
      PRUEF(treffer_im_giftblock >= 1);                      // caught in the block of the NaN, not L samples later
      PRUEF(zurueck >= 0 && zurueck <= gift + L + l.m->limiter_vorhalt() + 2 * n);   // the signal is back one delay (L + the master look-ahead) after the next block
    }
  }
}

// ---- (F, L = 0) the F01 guard leaves the PFL ring alone at L = 0: behaviour as before the account ----
// A clean deck/1 PFL cue runs, a NaN on erz/1 (a source that is not in the cue) fires the guard in block 40. The guard zeroes the block (n samples of
// exact zeros in the cue), but the PFL ring still holds the cue material of the vh samples before: it comes out after the bad block. If the guard clears
// the ring (as it does for L > 0) the whole window vh + n is exact zeros. The numbers are NOT from this code: measured on the base commit 4c01be5c with
// the same scenario (probe test_probe_cue, ~/messungen/2026-11-03-a5a/r2/probe-base.log): n = 256: 256 exact zeros of 340, cue |x| sum 3.1832 in the
// window; n = 32: 32 exact zeros of 116, sum 3.1328.
void f01_l0_cue() {
  struct Soll { int n; long nullen, fenster; double summe; } faelle[] = {{256, 256, 340, 3.1832}, {32, 32, 116, 3.1328}};
  for (const Soll& f : faelle) {
    const int n = f.n;
    Lauf l;   // L = 0: the account is off
    l.setze(DECK1, "pfl", 1.0f);
    const long gift = 40;
    const long fenster_ende = (gift + 1) * n + 84;
    PRUEF(l.m->limiter_vorhalt() == 84);
    long nullen = 0;
    double summe = 0.0;
    for (long b = 0; b < 100; ++b) {
      l.rausch(DECK1, 0.3, n);
      l.rausch(ERZ1, 0.2, n);
      l.rausch(ERZ2, 0.3, n);
      if (b == gift) l.m->eingang_l(ERZ1)[3] = NAN;
      l.verarbeite(n);
      for (int i = 0; i < n; ++i) {
        const long s = b * n + i;
        if (b >= gift && s < fenster_ende) {
          summe += std::fabs(l.cl[i]);
          nullen += l.cl[i] == 0.0f;
        }
      }
    }
    std::printf("F L=0 n=%d: nan hits %lld, cue in the window after the bad block: %ld exact zeros of %ld, |x| sum %.4f (base 4c01be5c: %ld of %ld, %.4f)\n", n,
                static_cast<long long>(l.m->nan_treffer()), nullen, fenster_ende - gift * n, summe, f.nullen, f.fenster, f.summe);
    PRUEF(l.m->nan_treffer() == 1);
    PRUEF(fenster_ende - gift * n == f.fenster);
    PRUEF(nullen == f.nullen);
    PRUEF(std::fabs(summe - f.summe) < 2e-3);
  }
}

// ---- (F, metronome) a NaN / Inf in summe_eingang_* must fall in its own block (the check in front of the metronome line) ----
void f01_metro() {
  for (int n : {256, 32})
    for (int L : {26, 600})
      for (int art = 0; art < 3; ++art) {   // 0: NaN left, 1: Inf right, 2: -Inf left
        Lauf l;
        l.m->setze_kanal_latenz(L);
        const long gift = 20L * n;
        long treffer_gift = -1, treffer_ende = -1;
        for (long t0 = 0; t0 < gift + 4L * L + 8L * n; t0 += n) {
          if (t0 == 0) l.m->summe_eingang_l()[1] = 0.5f;   // a click in flight, to see the line cleared too
          if (t0 == gift) {
            if (art == 0) l.m->summe_eingang_l()[3] = NAN;
            else if (art == 1) l.m->summe_eingang_r()[3] = INFINITY;
            else l.m->summe_eingang_l()[3] = -INFINITY;
          }
          l.verarbeite(n);
          for (int i = 0; i < n; ++i) PRUEF(std::isfinite(l.ml[i]) && std::isfinite(l.mr[i]) && std::isfinite(l.cl[i]));
          if (t0 == gift) treffer_gift = l.m->nan_treffer();
        }
        treffer_ende = l.m->nan_treffer();
        std::printf("F metronome n=%d L=%d art=%d: nan hits in the bad block %lld, at the end %lld\n", n, L, art, static_cast<long long>(treffer_gift),
                    static_cast<long long>(treffer_ende));
        PRUEF(treffer_gift == 1);   // caught in its own block ...
        PRUEF(treffer_ende == 1);   // ... and not again L samples later
      }
}

// ---- (C5, no-op) setting the value that is already set, in the middle of a run, changes nothing ----
void c5_gleicher_wert() {
  for (int n : {256, 32}) {
    Lauf a, b, c;
    for (Lauf* l : {&a, &b, &c}) {
      l->m->setze_kanal_latenz(300);
      ziel_bus(*l, ERZ2, 1);
      l->setze(ERZ1, "send/2", -6.0f);
      l->setze("fx/2/rueckweg", -6.0f);
      l->setze(DECK1, "pfl", 1.0f);
      l->setze(BUS1, "pfl", 1.0f);
    }
    bool gleich_immer = true, kontrolle_anders = false;
    for (int blk = 0; blk < 60; ++blk) {
      for (Lauf* l : {&a, &b, &c}) {
        l->rausch(DECK1, 0.3, n);
        l->rausch(ERZ1, 0.2, n);
        l->rausch(ERZ2, 0.3, n);
        l->m->summe_eingang_l()[0] = l->m->pfl_eingang_l()[0] = blk % 7 == 0 ? 0.3f : 0.0f;
      }
      if (blk == 30) {
        b.m->setze_kanal_latenz(300);   // the same value, lines and PFL ring full of audio in flight: no-op
        c.m->setze_kanal_latenz(301);   // positive control: another value restarts the lines
        c.m->setze_kanal_latenz(300);
      }
      for (Lauf* l : {&a, &b, &c}) l->verarbeite(n);
      if (blk >= 30) {
        gleich_immer = gleich_immer && std::memcmp(a.ml, b.ml, sizeof(float) * n) == 0 && std::memcmp(a.cl, b.cl, sizeof(float) * n) == 0;
        kontrolle_anders = kontrolle_anders || std::memcmp(a.ml, c.ml, sizeof(float) * n) != 0;
      }
    }
    std::printf("C5 same value n=%d: bit-identical after the call: %d, a changed value differs (positive control): %d\n", n, gleich_immer, kontrolle_anders);
    PRUEF(gleich_immer);
    PRUEF(kontrolle_anders);
  }
}

// ---- (C5, clamp) a value outside 0..kMaxLatenz is clamped ----
void c5_klemme() {
  {
    sw::ReglerTabelle tab;
    cdj::Mixer m(tab);
    m.setze_kanal_latenz(LMAX + 1);
    PRUEF(m.kanal_latenz() == LMAX);
    m.setze_kanal_latenz(99999);
    PRUEF(m.kanal_latenz() == LMAX);
    m.setze_kanal_latenz(-1);
    PRUEF(m.kanal_latenz() == 0);
    m.setze_kanal_latenz(-99999);
    PRUEF(m.kanal_latenz() == 0);
    m.setze_kanal_latenz(LMAX);
    PRUEF(m.kanal_latenz() == LMAX);   // the edge itself is not changed
  }
  if (pruef_fehler) return;   // an unclamped value would run the lines out of range
  const std::vector<Impuls> imp = {{Art::quelle, DECK1, 100, 0.5f}, {Art::metro_master, 0, 3000, 0.5f}};
  const Spur voll = fahre(256, LMAX, imp, nullptr), ueber = fahre(256, LMAX + 500, imp, nullptr);
  const Spur null = fahre(256, 0, imp, nullptr), minus = fahre(256, -7, imp, nullptr);
  PRUEF(voll.ml == ueber.ml && voll.cl == ueber.cl);   // too big: the same as kMaxLatenz, bit for bit
  PRUEF(null.ml == minus.ml && null.cl == minus.cl);   // negative: the same as 0, bit for bit (the old path)
  PRUEF(voll.ml != null.ml);                           // positive control
}

// ---- (C7) ----
void c7() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("C7 skipped (sanitizer build): allocation watcher not available\n");
    return;
  }
  {   // positive control first: the watcher must see an allocation
    abfang_an();
    { std::vector<float> v(1000); v[1] = 1.0f; }
    const AbfangZahlen pk = abfang_zahlen();
    abfang_aus();
    std::printf("C7 positive control: %ld allocations\n", pk.alloc);
    PRUEF(pk.alloc >= 1);
  }
  Lauf l;
  l.m->setze_kanal_latenz(LMAX);
  l.setze(ERZ1, "send/2", -6.0f);
  l.setze(BUS1, "send/2", -9.0f);
  l.setze("fx/2/rueckweg", -6.0f);
  ziel_bus(l, ERZ2, 1);
  ziel_bus(l, PAD1, 4);
  l.setze(DECK1, "pfl", 1.0f);
  l.setze(BUS1, "pfl", 1.0f);
  const int groessen[] = {1, 256, 17, 1024, 64, 255, 512, 3, 128, 1000, 33, 32, 800, 2, 129};
  AbfangZahlen summe;
  long nicht_endlich = 0;
  for (long b = 0; b < 6000; ++b) {
    const int n = groessen[b % 15];
    for (int k : {DECK1, ERZ1, ERZ2, PAD1}) l.rausch(k, 0.3, n);
    if (b % 1500 == 7) l.m->eingang_l(ERZ1)[0] = NAN;   // the F01 guard (clearing the rings) is in the window too
    abfang_an();
    l.m->verarbeite(n, l.ml, l.mr, l.cl, l.cr);
    abfang_aus();
    summe += abfang_zahlen();
    for (int i = 0; i < n; ++i) nicht_endlich += !(std::isfinite(l.ml[i]) && std::isfinite(l.cl[i]));
  }
  std::printf("C7: 6000 blocks at L=%d: %ld allocations, %ld frees, %ld locks, %ld sleeps; non-finite output samples %ld\n", LMAX, summe.alloc,
              summe.frei, summe.sperren, summe.schlafen, nicht_endlich);
  PRUEF(summe.alloc == 0 && summe.frei == 0 && summe.sperren == 0 && summe.schlafen == 0);
  PRUEF(nicht_endlich == 0);
  PRUEF(l.m->nan_treffer() >= 4);   // the NaN blocks really were hit
}

}  // namespace

int main() {
  c1();
  c2();
  c2_send_graph();
  c3();
  c4();
  c5();
  c5_gleicher_wert();
  c5_klemme();
  c6();
  w_ganze_mischung();
  f01();
  f01_metro();
  f01_l0_cue();
  c7();
  PRUEF_ENDE();
}
