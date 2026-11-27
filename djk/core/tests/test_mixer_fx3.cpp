// FX3: the third FX unit, an insert on the group of assigned source channels that carries the effect graph of fx/3
// (Mixer::fx_zuweisung_setze(FX3_EINHEIT, k, an), see mixer.h). Signals: 1 kHz sine 0.5 on deck/1, 440 Hz sine 0.5 on deck/2; the master sum
// (master_summe_l()/r(), in front of the master FX and the limiter) is read.
//  (a) idle graph (passes dry) on fx/3: assigning and releasing deck/1 leaves the sum unchanged within float rounding, blend included
//  (b) no graph on fx/3: the assigned channel is still heard (fallback to the master path), also through assign and release
//  (c) a halving graph: only the assigned channel is halved after the blend, the other channel is untouched (insert on a group, no copy)
//  (d) the crossfader weight of the channel is applied before the bus (the bus carries what the channel adds to the master sum)
//  (e) the blend: no step in the sum (sample to sample bounded like the plain sine), it takes MIX_ZIEL_BLENDE samples, S-curve start and end
//  (f) a channel that leaves FX3 lets the graph's tail ring out (the bus keeps running)
//  (g) a graph set or removed on fx/3 while channels are assigned: no hole and no jump (idle graph, sum equals the unassigned reference)
//  (h) an FX3 blend advances while the strip is silent (sleeping strips are woken for it)
//  (i) FX3 on every source channel, a bus target is untouched, master and buses are ignored, the state is reported back
//  (j) FX1/FX2 on pad/1 and pad/2: the Beat FX acts there (and only there), they were no targets before
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/mixer.h"
#include "check.h"

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;
constexpr double PI = 3.14159265358979323846;

static CypherBk* graph(const char* json) {
  char f[256] = {};
  CypherBk* g = cypher_bk_neu(json, 48000.0, f, sizeof f);
  if (!g) std::fprintf(stderr, "graph: %s\n", f);
  PRUEF(g != nullptr);
  return g;
}
static const char* DURCH =
    R"({"format":"baukasten/2","name":"durch","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"o.l"},{"von":"e.r","nach":"o.r"}]})";
static const char* HALB =
    R"({"format":"baukasten/2","name":"halb","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":0.5},{"id":"b","art":"mul","b":0.5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
static const char* ECHO =
    R"({"format":"baukasten/2","name":"echo10","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"d","art":"delay","zeit":10,"fb":0.5,"mix":1,"max":100},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"d.l"},{"von":"e.r","nach":"d.r"},{"von":"d.l","nach":"o.l"},{"von":"d.r","nach":"o.r"}]})";

// One mixer with a feed mask: bit i = deck/(i+1) gets its sine. Both sines run on their own phase of the global sample count.
struct Lauf {
  std::unique_ptr<sw::ReglerTabelle> tab_ = std::make_unique<sw::ReglerTabelle>();   // heap: the 24 576-row table fits only once or twice on an 8 MiB stack
  sw::ReglerTabelle& tab = *tab_;
  std::unique_ptr<cdj::Mixer> m;
  unsigned maske;
  float ml[N], mr[N], cl[N], cr[N];
  float aus_l[N] = {}, aus_r[N] = {};
  long t = 0;
  explicit Lauf(unsigned mask) : m(std::make_unique<cdj::Mixer>(tab)), maske(mask) {
    for (const char* p : {"deck/1/fader", "deck/2/fader", "pad/1/fader", "pad/2/fader"}) {
      const int r = tab.suche(p);
      PRUEF(r >= 0);
      m->setze_sofort(r, 0.0f);
    }
  }
  void setze(const char* pfad, float w) {
    const int r = tab.suche(pfad);
    PRUEF(r >= 0);
    m->setze_sofort(r, w);
  }
  void block() {
    for (int i = 0; i < N; ++i) {
      const double tt = static_cast<double>(t + i) / 48000.0;
      const float f[4] = {static_cast<float>(0.5 * std::sin(2.0 * PI * 1000.0 * tt)), static_cast<float>(0.5 * std::sin(2.0 * PI * 440.0 * tt)),
                          static_cast<float>(0.5 * std::sin(2.0 * PI * 700.0 * tt)), static_cast<float>(0.5 * std::sin(2.0 * PI * 300.0 * tt))};
      for (int d = 0; d < 4; ++d) {
        m->eingang_l(d)[i] = (maske >> d) & 1u ? f[d] : 0.0f;
        m->eingang_r(d)[i] = (maske >> d) & 1u ? f[d] : 0.0f;
      }
    }
    t += N;
    m->fx_takt(t / 22500.0, 128.0 / 60.0 / 48000.0);
    m->verarbeite(N, ml, mr, cl, cr);
    std::memcpy(aus_l, m->master_summe_l(), sizeof aus_l);
    std::memcpy(aus_r, m->master_summe_r(), sizeof aus_r);
  }
  float spitze() const {
    float p = 0.0f;
    for (int i = 0; i < N; ++i) p = std::fmax(p, std::fmax(std::fabs(aus_l[i]), std::fabs(aus_r[i])));
    return p;
  }
};

static float abstand(const Lauf& a, const Lauf& b) {
  float d = 0.0f;
  for (int i = 0; i < N; ++i) d = std::fmax(d, std::fmax(std::fabs(a.aus_l[i] - b.aus_l[i]), std::fabs(a.aus_r[i] - b.aus_r[i])));
  return d;
}
static int kanal(const char* n) { return cdj::Mixer::kanal_index(n); }
static const int F3 = cdj::Mixer::FX3_EINHEIT;

int main() {
  // (a) idle graph: assign at block 10, release at block 30, the sum never differs from the unassigned mixer with the same graph
  {
    Lauf a(0x3), b(0x3);
    a.m->setze_send_graph(2, graph(DURCH));
    b.m->setze_send_graph(2, graph(DURCH));
    float grenze = 0.0f, spitze = 0.0f;
    for (int k = 0; k < 50; ++k) {
      if (k == 10) a.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
      if (k == 30) a.m->fx_zuweisung_setze(F3, kanal("deck/1"), false);
      a.block();
      b.block();
      if (k >= 3) grenze = std::fmax(grenze, abstand(a, b));   // the first blocks are the graph's own blend from nothing, equal on both sides
      spitze = std::fmax(spitze, a.spitze());
    }
    PRUEF(spitze > 0.5f);
    PRUEF(grenze < 2e-6f);
    PRUEF(a.m->fx_zugewiesen(F3, kanal("deck/1")) == false);
  }
  // (b) no graph on fx/3: still audible, equal to the unassigned reference through the whole sequence
  {
    Lauf a(0x3), b(0x3);
    float grenze = 0.0f, spitze_a = 0.0f;
    for (int k = 0; k < 50; ++k) {
      if (k == 10) a.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
      if (k == 20) a.m->fx_zuweisung_setze(F3, kanal("deck/2"), true);
      if (k == 35) a.m->fx_zuweisung_setze(F3, kanal("deck/1"), false);
      a.block();
      b.block();
      grenze = std::fmax(grenze, abstand(a, b));
      if (k >= 12 && k < 20) spitze_a = std::fmax(spitze_a, a.spitze());
    }
    PRUEF(spitze_a > 0.4f);
    PRUEF(grenze < 2e-6f);
  }
  // (c) halving graph: deck/1 assigned, deck/2 not. The sum is 0.5 * (deck/1 alone) + (deck/2 alone) once the blend is over.
  {
    Lauf a(0x3), r1(0x1), r2(0x2);
    a.m->setze_send_graph(2, graph(HALB));
    float grenze = 0.0f;
    for (int k = 0; k < 30; ++k) {
      if (k == 5) a.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
      a.block();
      r1.block();
      r2.block();
      if (k >= 10) {
        for (int i = 0; i < N; ++i) {
          grenze = std::fmax(grenze, std::fabs(a.aus_l[i] - (0.5f * r1.aus_l[i] + r2.aus_l[i])));
          grenze = std::fmax(grenze, std::fabs(a.aus_r[i] - (0.5f * r1.aus_r[i] + r2.aus_r[i])));
        }
      }
    }
    PRUEF(grenze < 2e-6f);   // an insert, not a copy: a copy would give 1.5 * deck/1 + deck/2
    // fx/3/rueckweg scales the return of the assigned group and nothing else: -6 dB on the return = a quarter of deck/1 left
    Lauf c(0x3), c1(0x1), c2(0x2);
    c.m->setze_send_graph(2, graph(HALB));
    c.setze("fx/3/rueckweg", -6.0206f);
    for (int k = 0; k < 30; ++k) {
      if (k == 5) c.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
      c.block();
      c1.block();
      c2.block();
    }
    float g2 = 0.0f;
    for (int i = 0; i < N; ++i) g2 = std::fmax(g2, std::fabs(c.aus_l[i] - (0.25f * c1.aus_l[i] + c2.aus_l[i])));
    PRUEF(g2 < 1e-4f);
  }
  // (d) crossfader: deck/1 on side A, crossfader at +0.5: its master share is half. The bus takes that half, the halving graph makes it a quarter.
  {
    Lauf a(0x1), r(0x1);
    for (Lauf* l : {&a, &r}) {
      l->setze("deck/1/xseite", 0.0f);
      l->setze("xfader", 0.5f);
    }
    a.m->setze_send_graph(2, graph(HALB));
    float v = 0.0f, ref = 0.0f;
    for (int k = 0; k < 30; ++k) {
      if (k == 5) a.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
      a.block();
      r.block();
      if (k == 25) { v = a.spitze(); ref = r.spitze(); }
    }
    PRUEF(ref > 0.2f && ref < 0.3f);          // 0.5 * 0.5 from the crossfader
    PRUEF(std::fabs(v / ref - 0.5f) < 1e-3f);   // then the graph halves it
    // crossfader fully cut: nothing reaches the bus either
    a.setze("xfader", 1.0f);
    for (int k = 0; k < 4; ++k) a.block();
    PRUEF(a.spitze() < 1e-6f);
  }
  // (e) the blend: a halving graph, assign at a block start. Sample to sample the sum moves like the plain sine, no step; the gain goes from
  // 1 to 0.5 in exactly MIX_ZIEL_BLENDE samples.
  {
    Lauf a(0x1), r(0x1);
    a.m->setze_send_graph(2, graph(HALB));
    for (int k = 0; k < 8; ++k) { a.block(); r.block(); }   // the graph's own blend is over, steady state
    a.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
    float letzt = a.aus_l[N - 1], max_schritt = 0.0f, max_ref = 0.0f, rletzt = r.aus_l[N - 1];
    float g_start = 0.0f, g_mitte = 0.0f, g_ende = 0.0f, g_danach = 0.0f;
    long n = 0;
    for (int k = 0; k < 4; ++k) {
      a.block();
      r.block();
      for (int i = 0; i < N; ++i, ++n) {
        max_schritt = std::fmax(max_schritt, std::fabs(a.aus_l[i] - letzt));
        max_ref = std::fmax(max_ref, std::fabs(r.aus_l[i] - rletzt));
        letzt = a.aus_l[i];
        rletzt = r.aus_l[i];
        if (std::fabs(r.aus_l[i]) > 0.3f) {   // gain only where the reference is far from zero crossings
          const float g = a.aus_l[i] / r.aus_l[i];
          if (n < 40) g_start = g;
          if (n >= 235 && n <= 245) g_mitte = g;
          if (n >= 470 && n < 480) g_ende = g;
          if (n >= 500) g_danach = g;
        }
      }
    }
    PRUEF(max_ref > 0.05f && max_ref < 0.07f);
    PRUEF(max_schritt < max_ref * 1.1f);   // a hard switch would step by up to 0.25
    PRUEF(g_start > 0.99f);                // S-curve: starts flat
    PRUEF(g_mitte > 0.70f && g_mitte < 0.80f);   // the middle of the S-curve is 0.75
    PRUEF(g_ende < 0.505f);                // ends flat
    PRUEF(std::fabs(g_danach - 0.5f) < 1e-4f);
    // the release blends the same way
    a.m->fx_zuweisung_setze(F3, kanal("deck/1"), false);
    letzt = a.aus_l[N - 1];
    max_schritt = 0.0f;
    for (int k = 0; k < 4; ++k) {
      a.block();
      for (int i = 0; i < N; ++i) { max_schritt = std::fmax(max_schritt, std::fabs(a.aus_l[i] - letzt)); letzt = a.aus_l[i]; }
    }
    PRUEF(max_schritt < max_ref * 1.1f);
  }
  // (f) tail: an echo graph on fx/3. The channel is released and its input stops at once; the echoes keep ringing and die out by themselves.
  {
    Lauf a(0x1);
    a.m->setze_send_graph(2, graph(ECHO));
    a.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
    for (int k = 0; k < 10; ++k) a.block();
    PRUEF(a.spitze() > 0.2f);
    a.m->fx_zuweisung_setze(F3, kanal("deck/1"), false);
    a.maske = 0;
    a.block();
    const float erst = a.spitze();
    a.block();
    const float zweit = a.spitze();
    a.block();
    const float dritt = a.spitze();
    PRUEF(erst > 0.01f && zweit > 0.01f && dritt > 0.001f);   // rings on, not cut
    PRUEF(zweit < erst && dritt < zweit);                     // and decays (fb 0.5 per 10 ms)
  }
  // (g) a graph set and removed while channels are assigned: no hole, no jump (idle graph; the reference is the unassigned mixer without graph)
  {
    Lauf a(0x3), b(0x3);
    a.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
    a.m->fx_zuweisung_setze(F3, kanal("deck/2"), true);
    float grenze = 0.0f;
    for (int k = 0; k < 60; ++k) {
      if (k == 20) a.m->setze_send_graph(2, graph(DURCH));
      if (k == 40) a.m->setze_send_graph(2, nullptr);
      a.block();
      b.block();
      if (k >= 5) grenze = std::fmax(grenze, abstand(a, b));
    }
    PRUEF(grenze < 2e-6f);
    CypherBk* f[8] = {};
    PRUEF(a.m->bk_frei(f, 8) == 1);   // the removed graph comes back once
    cypher_bk_frei(f[0]);
  }
  // (h) an FX3 blend advances while the strip is silent: the signal that starts after the blend is at its final level at once
  {
    Lauf a(0x0);
    a.m->setze_send_graph(2, graph(HALB));
    for (int k = 0; k < 6; ++k) a.block();   // silent from the start, the strip falls asleep
    PRUEF(a.m->schlaeft(0));   // the strip really sleeps when the assignment arrives
    a.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
    for (int k = 0; k < 4; ++k) a.block();   // more than MIX_ZIEL_BLENDE samples of silence
    a.maske = 0x1;
    Lauf r(0x1);
    r.t = a.t;
    a.block();
    r.block();
    float g = 0.0f;
    for (int i = 0; i < 64; ++i)
      if (std::fabs(r.aus_l[i]) > 0.3f) g = a.aus_l[i] / r.aus_l[i];
    PRUEF(std::fabs(g - 0.5f) < 1e-3f);
  }
  // (i) every container takes FX3; master, buses and out-of-range indices are ignored; a channel routed to a bus keeps its path
  {
    Lauf a(0x1);
    const char* quellen[] = {"deck/1", "deck/2", "pad/1", "pad/2"};
    for (const char* q : quellen) {
      PRUEF(!a.m->fx_zugewiesen(F3, kanal(q)));
      a.m->fx_zuweisung_setze(F3, kanal(q), true);
      PRUEF(a.m->fx_zugewiesen(F3, kanal(q)));
    }
    PRUEF(!a.m->fx_zugewiesen(0, kanal("deck/1")));   // the Beat FX units are untouched by it
    PRUEF(!a.m->fx_zugewiesen(1, kanal("deck/1")));
    a.m->fx_zuweisung_setze(F3, cdj::Mixer::FX_MASTER, true);
    a.m->fx_zuweisung_setze(F3, kanal("bus/1"), true);
    a.m->fx_zuweisung_setze(F3, -1, true);
    a.m->fx_zuweisung_setze(F3, 99, true);
    PRUEF(!a.m->fx_zugewiesen(F3, cdj::Mixer::FX_MASTER) && !a.m->fx_zugewiesen(F3, kanal("bus/1")) && !a.m->fx_zugewiesen(F3, 99));
    a.m->fx_zuweisung_setze(F3, kanal("deck/1"), false);
    PRUEF(!a.m->fx_zugewiesen(F3, kanal("deck/1")) && a.m->fx_zugewiesen(F3, kanal("deck/2")));
    // deck/1 routed to bus/1 (ziel 1) and assigned: the bus carries it, FX3 changes nothing (the halving graph is not heard)
    Lauf b(0x1), r(0x1);
    for (Lauf* l : {&b, &r}) {
      l->setze("deck/1/ziel", 1.0f);
      l->setze("bus/1/fader", 0.0f);   // the bus fader starts closed
    }
    b.m->setze_send_graph(2, graph(HALB));
    b.m->fx_zuweisung_setze(F3, kanal("deck/1"), true);
    float grenze = 0.0f;
    for (int k = 0; k < 20; ++k) { b.block(); r.block(); grenze = std::fmax(grenze, abstand(b, r)); }
    PRUEF(grenze < 2e-6f && r.spitze() > 0.3f);
  }
  // (j) FX1 and FX2 on pad/1 and pad/2: the echo shows only on the channel it is assigned to
  {
    for (const char* ziel : {"pad/1", "pad/2"}) {
      for (int einheit = 0; einheit < 2; ++einheit) {
        const unsigned maske = 0xF;
        Lauf a(maske), b(maske);
        a.m->fx_einheit_setze(einheit, cdj::BeatFx::ECHO, 0.25, 0.5f, 0.5f, 0.5, 0.5, true);
        a.m->fx_zuweisung_setze(einheit, kanal(ziel), true);
        PRUEF(a.m->fx_zugewiesen(einheit, kanal(ziel)));
        float grenze = 0.0f;
        for (int k = 0; k < 80; ++k) { a.block(); b.block(); grenze = std::fmax(grenze, abstand(a, b)); }
        PRUEF(grenze > 0.05f);   // the Beat FX changed the sum
        // the same unit on deck/1 gives a different sum from pad/1: the effect sits on the assigned channel (the channels differ in pitch)
        Lauf c(0x1);
        c.m->fx_einheit_setze(einheit, cdj::BeatFx::ECHO, 0.25, 0.5f, 0.5f, 0.5, 0.5, true);
        c.m->fx_zuweisung_setze(einheit, kanal("pad/1"), true);   // pad/1 carries no signal in this mixer: nothing may change
        Lauf d(0x1);
        float stumm = 0.0f;
        for (int k = 0; k < 80; ++k) { c.block(); d.block(); stumm = std::fmax(stumm, abstand(c, d)); }
        PRUEF(stumm < 1e-7f);
      }
    }
  }
  PRUEF_ENDE();
}
