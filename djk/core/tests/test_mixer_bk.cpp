// Baukasten S3c Task 4: Effekt-Graph im Kanalzug von deck/1..4 (Plan 2026-10-29-baukasten-s3c-effekt.md, D3, D4).
// Gelesen wird master_summe_l()/r() (vor master/pegel und Limiter). Signal: 1-kHz-Sinus 0,5 auf deck/1 (Index 0).
//  (a) ohne Graph bitgleich zu einem Mixer, der nie einen Graphen hatte; nach Entfernen und Blende wieder bitgleich
//  (b) Durchreich-Graph: nach der Blende bitgleich zu ohne Graph (der Split-Weg ist bitgleich, test_kanalzug_teilung)
//  (c) Halbierer-Graph: nach der Blende halbe Spitze (±0,05 dB); in der Blende kein Sprung > 0,07 zwischen Samples (Steigung des Sinus ≈ 0,065)
//  (d) Wechsel Halbierer → Durchreich: der alte Graph steht nach der Blende in bk_frei, vorher nicht
//  (e) Wechsel während der Blende: der älteste Graph wird sofort frei, der mittlere nach der Blende
//  (f) Graph auf Index 4 (erz/1): sofort in bk_frei, Kanal unberührt
//  (g) übersteuernder Graph (×100): Kanal auf ±8 geklemmt
//  (h) Allokationsfrei: Blöcke mit Graph und Blende allokieren nicht (alloc_intercept.h)
//  (i) Takt kommt an: ein LFO-Graph mit takt hört um einen halben Beat versetzt anders, ohne Versatz bitgleich
//  (j) zwei Wechsel vor demselben Block: der ungehörte geht sofort frei, der gehörte blendet weiter aus
//      (bitgleich zu einem einzelnen Wechsel); zurück auf den gehörten Graphen beendet die Blende
//  (k) Ablage: neun Freigaben ohne Abholen -> acht in bk_frei, eine verloren; gleicher Zeiger ändert nichts
//  S6 Task 1 (send returns fx/3, fx/4; plan 2026-10-31-baukasten-s6-send-graphen.md), signal DC on deck/1, sends read via fx_l():
//  (m) send graph audible: pass-through graph on fx/3 adds exactly the send bus to the master sum
//  (n) fx/3/rueckweg scales (-200 dB bit-identical to no graph, -6.0206 dB halves, ramped path vl exercised)
//  (o) fx/4 signal does not reach a graph on fx/3 (no cross-wiring)
//  (p) without a graph the master is bit-identical whether sends 3/4 are fed or not
//  (q) switch blends wet to wet over MIX_GRAPH_BLENDE samples, old graph in bk_frei only after the blend
//  (r) removal blends to silence, then exactly 0
//  (s) output clamp +-8
//  (t) tail survives a silent send (no hall-style wake gate)
//  (u) allocation free with send graphs, switch and blend
//  (v) stereo kept on the send return (left and right not mixed up)
//  (w) S14: a regler node in a send graph follows its knob row (fx/3 = row MIX_BK_SEND_ZEILE, fx/4 = +1) within one block;
//      deck/3 and the other send's row do not move it
//  (l) Hörprobe Effektwechsel auf deck/1, nur unter CYPHERDJ_BK_FX_WAV_EIN/_AUS (_TROCKEN: dieselbe Spur ohne Graph)
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/mixer.h"
#include "check.h"
#include "alloc_intercept.h"   // zuletzt: ersetzt malloc und Verwandte (wie test_generator_bk.cpp:17)

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;
constexpr double PI = 3.14159265358979323846;

static CypherBk* graph(const char* json) {
  char f[256] = {};
  CypherBk* g = cypher_bk_neu(json, 48000.0, f, sizeof f);
  if (!g) std::fprintf(stderr, "Graph: %s\n", f);
  PRUEF(g != nullptr);
  return g;
}
static const char* DURCH =
    R"({"format":"baukasten/2","name":"durch","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"o.l"},{"von":"e.r","nach":"o.r"}]})";
static const char* HALB =
    R"({"format":"baukasten/2","name":"halb","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":0.5},{"id":"b","art":"mul","b":0.5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
// Tremolo im Takt: Eingang mal LFO (Rechteck nicht nötig, Sinus genügt), Phase aus dem Beat
static const char* TAKT =
    R"({"format":"baukasten/2","name":"takt","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"w","art":"lfo","form":0,"takt":1},{"id":"a","art":"mul"},{"id":"b","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"w.aus","nach":"a.b"},{"von":"w.aus","nach":"b.b"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
// Übersteuert endlich (0,5 · 100 = 50): nicht endliche Werte fängt schon der Rust-Wächter (Ausgang 0), die Klemme ±8
// im Mixer sieht nur dieser Fall
static const char* GROSS =
    R"({"format":"baukasten/2","name":"gross","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":100},{"id":"b","art":"mul","b":100},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[N], mr[N], cl[N], cr[N];
  long t = 0;
  double beat_versatz = 0.0;
  Lauf() : m(std::make_unique<cdj::Mixer>(tab)) { setze("deck/1/fader", 0.0f); }
  void setze(const char* pfad, float w) {
    const int r = tab.suche(pfad);
    PRUEF(r >= 0);
    m->setze_sofort(r, w);
  }
  const float* block() {
    for (int i = 0; i < N; ++i) {
      const float x = static_cast<float>(0.5 * std::sin(2.0 * PI * 1000.0 * (t + i) / 48000.0));
      m->eingang_l(0)[i] = x;
      m->eingang_r(0)[i] = x;
    }
    t += N;
    m->fx_takt(t / 22500.0 + beat_versatz, 128.0 / 60.0 / 48000.0);
    m->verarbeite(N, ml, mr, cl, cr);
    return m->master_summe_l();
  }
  int frei(CypherBk** aus) { return m->bk_frei(aus, 8); }
};

// S14: the knob graph of test_kern_kanal_graph (REGLER_PEGEL) on knob nr 2: input times knob 2 (0..1)
static const char* REGLER2 =
    R"({"format":"baukasten/2","name":"r2","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"r","art":"regler","nr":2,"min":0,"max":1},{"id":"a","art":"mul"},{"id":"b","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"r.aus","nach":"a.b"},{"von":"e.r","nach":"b.a"},{"von":"r.aus","nach":"b.b"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";

static const char* GROSS400 =
    R"({"format":"baukasten/2","name":"gross400","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":400},{"id":"b","art":"mul","b":400},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
static const char* ECHO10 =
    R"({"format":"baukasten/2","name":"echo10","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"d","art":"delay","zeit":10,"fb":0.5,"mix":1,"max":100},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"d.l"},{"von":"e.r","nach":"d.r"},{"von":"d.l","nach":"o.l"},{"von":"d.r","nach":"o.r"}]})";

// S6: DC on deck/1, fader 0 dB, send 3 at 0 dB and send 4 off by default. block() returns a copy of the master sum.
struct SLauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[N], mr[N], cl[N], cr[N];
  float aus_l[N], aus_r[N];
  SLauf() : m(std::make_unique<cdj::Mixer>(tab)) {
    setze("deck/1/fader", 0.0f);
    setze("deck/1/send/3", 0.0f);
  }
  int r(const char* pfad) { const int i = tab.suche(pfad); PRUEF(i >= 0); return i; }
  void setze(const char* pfad, float w) { m->setze_sofort(r(pfad), w); }
  void block(float dc) { block_lr(dc, dc); }
  void block_lr(float dl, float dr) {
    for (int i = 0; i < N; ++i) { m->eingang_l(0)[i] = dl; m->eingang_r(0)[i] = dr; }
    m->verarbeite(N, ml, mr, cl, cr);
    std::memcpy(aus_l, m->master_summe_l(), sizeof aus_l);
    std::memcpy(aus_r, m->master_summe_r(), sizeof aus_r);
  }
  // send bus of the last block (index 2 = fx/3, 3 = fx/4)
  const float* bus_l(int s) const { return m->fx_l(s); }
  const float* bus_r(int s) const { return m->fx_r(s); }
  int frei(CypherBk** aus) { return m->bk_frei(aus, 8); }
};

static float spitze(const float* x) {
  float p = 0.0f;
  for (int i = 0; i < N; ++i) p = std::fmax(p, std::fabs(x[i]));
  return p;
}

int main() {
  // (a) + (b)
  {
    Lauf a, b;
    int anders_ohne = 0, anders_durch = 0;
    for (int k = 0; k < 40; ++k) {
      if (k == 10) b.m->setze_kanal_graph(0, graph(DURCH));
      if (k == 25) b.m->setze_kanal_graph(0, nullptr);
      const float* x = a.block();
      const float* y = b.block();
      const bool gleich = std::memcmp(x, y, sizeof(float) * N) == 0;
      if (k < 10 || k >= 28) anders_ohne += !gleich;
      if (k >= 13 && k < 25) anders_durch += !gleich;
    }
    PRUEF(anders_ohne == 0);
    PRUEF(anders_durch == 0);
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (c) Halbierer: Spitze nach der Blende halb, Blende ohne Sprung
  {
    Lauf b;
    float vor = 0.0f, nach = 0.0f, letzter = 0.0f, sprung = 0.0f;
    for (int k = 0; k < 20; ++k) {
      if (k == 10) b.m->setze_kanal_graph(0, graph(HALB));
      const float* x = b.block();
      if (k == 9) vor = spitze(x);
      if (k == 15) nach = spitze(x);
      for (int i = 0; i < N; ++i) {
        if (k >= 9 && k <= 13) sprung = std::fmax(sprung, std::fabs(x[i] - letzter));
        letzter = x[i];
      }
    }
    PRUEF(std::fabs(20.0 * std::log10(nach / vor) + 6.0206) < 0.05);
    // 1 kHz bei 0,5: größte Steigung je Sample ≈ 0,5·2π·1000/48000 ≈ 0,065; die Blende darf sie kaum erhöhen
    PRUEF(sprung < 0.07f);
  }
  // (d) Wechsel: alter Graph erst nach der Blende frei
  {
    Lauf b;
    b.m->setze_kanal_graph(0, graph(HALB));
    for (int k = 0; k < 5; ++k) b.block();
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 0);
    b.m->setze_kanal_graph(0, graph(DURCH));
    b.block();   // 256 von 480 Samples Blende
    PRUEF(b.frei(f) == 0);
    b.block();   // Blende fertig
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (e) Wechsel in der Blende: der älteste sofort frei
  {
    Lauf b;
    b.m->setze_kanal_graph(0, graph(HALB));
    b.block(); b.block();
    b.m->setze_kanal_graph(0, graph(DURCH));   // HALB blendet aus
    b.block();
    b.m->setze_kanal_graph(0, graph(HALB));    // HALB(alt) sofort frei, DURCH blendet aus
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
    b.block(); b.block();
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (f) Kanal außerhalb deck/1..4
  {
    Lauf b;
    b.m->setze_kanal_graph(4, graph(DURCH));
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (g) übersteuernder Graph: Kanal auf ±8 geklemmt (Fader 0 dB, also Master höchstens 8)
  {
    Lauf b;
    b.m->setze_kanal_graph(0, graph(GROSS));
    float p = 0.0f;
    for (int k = 0; k < 6; ++k) {
      const float* x = b.block();
      if (k >= 2) p = std::fmax(p, spitze(x));
    }
    PRUEF(p > 7.9f && p <= 8.0f * 1.0001f);   // Positivkontrolle: übersteuert wirklich, und die Klemme greift
  }
  // (h) allokationsfrei mit Graph, Wechsel und Blende
  {
    Lauf b;
    CypherBk* g1 = graph(HALB);
    CypherBk* g2 = graph(DURCH);
    b.m->setze_kanal_graph(0, g1);
    b.block();
    abfang_an();   // Positivkontrolle: der Wächter sieht Allokationen aus dem Rust-Teil
    CypherBk* probe = graph(DURCH);
    const long pos = abfang_aus();
    cypher_bk_frei(probe);
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || pos > 0);
    abfang_an();
    b.m->setze_kanal_graph(0, g2);
    for (int k = 0; k < 10; ++k) b.block();
    const AbfangZahlen az = abfang_zahlen();
    abfang_aus();
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || az.summe() == 0);   // Allokation, free, Sperren, Schlafen
  }
  // (i) Takt: gleicher Beat bitgleich, halber Beat versetzt deutlich anders
  {
    Lauf a, b, c;
    c.beat_versatz = 0.5;
    a.m->setze_kanal_graph(0, graph(TAKT));
    b.m->setze_kanal_graph(0, graph(TAKT));
    c.m->setze_kanal_graph(0, graph(TAKT));
    int anders_ab = 0;
    float diff_ac = 0.0f;
    for (int k = 0; k < 60; ++k) {
      const float* x = a.block();
      const float* y = b.block();
      const float* z = c.block();
      anders_ab += std::memcmp(x, y, sizeof(float) * N) != 0;
      for (int i = 0; i < N; ++i) diff_ac = std::fmax(diff_ac, std::fabs(x[i] - z[i]));
    }
    PRUEF(anders_ab == 0);
    PRUEF(diff_ac > 0.1f);   // ohne Takt rechneten a und c denselben freilaufenden LFO und wären gleich
  }
  // (j) zwei Wechsel vor demselben Block
  {
    Lauf ein, zwei;
    ein.m->setze_kanal_graph(0, graph(HALB));
    zwei.m->setze_kanal_graph(0, graph(HALB));
    for (int k = 0; k < 4; ++k) { ein.block(); zwei.block(); }
    ein.m->setze_kanal_graph(0, graph(DURCH));
    zwei.m->setze_kanal_graph(0, graph(GROSS));   // ungehört, wird sofort ersetzt
    zwei.m->setze_kanal_graph(0, graph(DURCH));
    CypherBk* f[8] = {};
    PRUEF(zwei.frei(f) == 1);                     // GROSS sofort frei
    cypher_bk_frei(f[0]); f[0] = nullptr;
    int anders = 0;
    for (int k = 0; k < 4; ++k) anders += std::memcmp(ein.block(), zwei.block(), sizeof(float) * N) != 0;
    PRUEF(anders == 0);
    PRUEF(zwei.frei(f) == 1);                     // HALB nach der Blende
    cypher_bk_frei(f[0]); f[0] = nullptr;
    PRUEF(ein.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
#ifndef CYPHERDJ_MUTATION_BK_KANAL_DOPPEL_ALT   // alter Weg: h ginge in die Freigabe und liefe weiter (use-after-free, gemessen SegFault)
    // zurück auf den gehörten: HALB läuft, DURCH gesetzt und vor dem Block wieder HALB -> keine Blende, bitgleich
    Lauf r, s2;
    CypherBk* h = graph(HALB);
    r.m->setze_kanal_graph(0, graph(HALB));
    s2.m->setze_kanal_graph(0, h);
    for (int k = 0; k < 4; ++k) { r.block(); s2.block(); }
    s2.m->setze_kanal_graph(0, graph(DURCH));
    s2.m->setze_kanal_graph(0, h);
    PRUEF(s2.frei(f) == 1);                       // DURCH frei, h bleibt
    cypher_bk_frei(f[0]); f[0] = nullptr;
    anders = 0;
    for (int k = 0; k < 4; ++k) anders += std::memcmp(r.block(), s2.block(), sizeof(float) * N) != 0;
    PRUEF(anders == 0);
    PRUEF(s2.frei(f) == 0);
#endif
  }
  // (k) Ablage-Überlauf und gleicher Zeiger
  {
    Lauf b;
    CypherBk* g[9];
    for (int i = 0; i < 9; ++i) { g[i] = graph(DURCH); b.m->setze_kanal_graph(4, g[i]); }
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 8);
    PRUEF(b.m->bk_verloren() == 1);
    for (int i = 0; i < 8; ++i) cypher_bk_frei(f[i]);
    cypher_bk_frei(g[8]);   // der verlorene; im Betrieb ein Leck, hier vom Test aufgeräumt
    CypherBk* d = graph(DURCH);
    b.m->setze_kanal_graph(0, d);
    b.block(); b.block();
    b.m->setze_kanal_graph(0, d);
    b.block();
    PRUEF(b.frei(f) == 0);
  }

  // ---- S6: effect graphs on the send returns fx/3, fx/4 (bus index 2, 3 inside the mixer) ----
  // (m) a pass-through graph on fx/3 adds exactly the send bus to the master sum
  {
    SLauf a, b;
    b.m->setze_send_graph(2, graph(DURCH));
    float bus_max = 0.0f, fehler = 0.0f;
    for (int k = 0; k < 8; ++k) {
      a.block(0.25f);
      b.block(0.25f);
      if (k < 3) continue;   // blend (480 samples) is over
      for (int i = 0; i < N; ++i) {
        bus_max = std::fmax(bus_max, std::fabs(b.bus_l(2)[i]));
        fehler = std::fmax(fehler, std::fabs((b.aus_l[i] - a.aus_l[i]) - b.bus_l(2)[i]));
        fehler = std::fmax(fehler, std::fabs((b.aus_r[i] - a.aus_r[i]) - b.bus_r(2)[i]));
      }
    }
    PRUEF(bus_max > 0.05f);   // positive control: the send really carries signal
    PRUEF(fehler <= 1e-6f);
  }
  // (n) fx/3/rueckweg: -200 dB leaves the master bit-identical, -6.0206 dB halves, a ramp (vl path) follows per sample
  {
    SLauf a, off, halb, rampe;
    off.setze("fx/3/rueckweg", -200.0f);
    halb.setze("fx/3/rueckweg", -6.0206f);
    rampe.setze("fx/3/rueckweg", -40.0f);
    for (SLauf* l : {&off, &halb, &rampe}) l->m->setze_send_graph(2, graph(DURCH));
    int anders_off = 0;
    float fehler_halb = 0.0f, fehler_rampe = 0.0f, rampe_max = 0.0f;
    const int rw = rampe.r("fx/3/rueckweg");
    float verlauf[N];
    for (int k = 0; k < 8; ++k) {
      a.block(0.25f);
      off.block(0.25f);
      halb.block(0.25f);
      if (k == 6) {   // ramp block: -40 dB -> -6.0206 dB over one block, .w stays at -40 dB
        for (int i = 0; i < N; ++i) verlauf[i] = -40.0f + (40.0f - 6.0206f) * i / (N - 1);
        rampe.m->verlauf(rw, verlauf);
      }
      rampe.block(0.25f);
      anders_off += std::memcmp(a.aus_l, off.aus_l, sizeof a.aus_l) != 0 || std::memcmp(a.aus_r, off.aus_r, sizeof a.aus_r) != 0;
      if (k >= 3) {
        for (int i = 0; i < N; ++i)
          fehler_halb = std::fmax(fehler_halb, std::fabs((halb.aus_l[i] - a.aus_l[i]) - 0.5f * halb.bus_l(2)[i]));
      }
      if (k == 6) {
        for (int i = 0; i < N; ++i) {
          const float erwartet = static_cast<float>(std::pow(10.0, verlauf[i] / 20.0)) * rampe.bus_l(2)[i];
          fehler_rampe = std::fmax(fehler_rampe, std::fabs((rampe.aus_l[i] - a.aus_l[i]) - erwartet));
          rampe_max = std::fmax(rampe_max, std::fabs(erwartet));
        }
      }
    }
    PRUEF(anders_off == 0);
    PRUEF(fehler_halb <= 1e-5f);
    PRUEF(rampe_max > 0.05f);       // the ramp ends near 0.5 of the bus, so the check is not vacuous
    PRUEF(fehler_rampe <= 1e-5f);
  }
  // (o) signal only on send 4, graph only on fx/3: the master stays bit-identical to no graph
  {
    SLauf a, b;
    for (SLauf* l : {&a, &b}) { l->setze("deck/1/send/3", -200.0f); l->setze("deck/1/send/4", 0.0f); }
    b.m->setze_send_graph(2, graph(DURCH));
    int anders = 0;
    float bus4 = 0.0f;
    for (int k = 0; k < 8; ++k) {
      a.block(0.25f);
      b.block(0.25f);
      anders += std::memcmp(a.aus_l, b.aus_l, sizeof a.aus_l) != 0 || std::memcmp(a.aus_r, b.aus_r, sizeof a.aus_r) != 0;
      for (int i = 0; i < N; ++i) bus4 = std::fmax(bus4, std::fabs(b.bus_l(3)[i]));
    }
    PRUEF(bus4 > 0.05f);   // positive control: send 4 carries signal
    PRUEF(anders == 0);
    // mirror: graph on fx/4 and signal on send 3 only
    SLauf c, d;
    for (SLauf* l : {&c, &d}) l->setze("deck/1/send/4", -200.0f);
    d.m->setze_send_graph(3, graph(DURCH));
    anders = 0;
    for (int k = 0; k < 8; ++k) {
      c.block(0.25f);
      d.block(0.25f);
      anders += std::memcmp(c.aus_l, d.aus_l, sizeof c.aus_l) != 0;
    }
    PRUEF(anders == 0);
  }
  // (p) without any send graph the sends do not touch the main path: fed at 0 dB == sends at -200 dB (R4)
  {
    SLauf gespeist, still;
    gespeist.setze("deck/1/send/4", 0.0f);
    still.setze("deck/1/send/3", -200.0f);
    int anders = 0;
    for (int k = 0; k < 4; ++k) {
      gespeist.block(0.25f);
      still.block(0.25f);
      anders += std::memcmp(gespeist.aus_l, still.aus_l, sizeof gespeist.aus_l) != 0 ||
                std::memcmp(gespeist.aus_r, still.aus_r, sizeof gespeist.aus_r) != 0;
    }
    PRUEF(anders == 0);
  }
  // contribution of a send graph per sample = (graph master) - (reference master without graph)
  // (q) switch HALB -> DURCH: wet to wet over 480 samples, the old graph is free only after the blend
  {
    SLauf a, b;
    b.m->setze_send_graph(2, graph(HALB));
    for (int k = 0; k < 6; ++k) { a.block(0.25f); b.block(0.25f); }
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 0);
    b.m->setze_send_graph(2, graph(DURCH));
    float fehler = 0.0f;
    float c0 = 0.0f, c240 = 0.0f, c479 = 0.0f, c480 = 0.0f, bus0 = 0.0f, bus240 = 0.0f, bus479 = 0.0f, bus480 = 0.0f;
    for (int k = 0; k < 3; ++k) {
      a.block(0.25f);
      b.block(0.25f);
      if (k == 0) PRUEF(b.frei(f) == 0);   // 256 of 480 samples
      for (int i = 0; i < N; ++i) {
        const int t = k * N + i;
        const float w = t < cdj::Mixer::MIX_GRAPH_BLENDE ? static_cast<float>(cdj::Mixer::MIX_GRAPH_BLENDE - t) / cdj::Mixer::MIX_GRAPH_BLENDE : 0.0f;   // weight of the old (half) path
        const float c = b.aus_l[i] - a.aus_l[i];
        const float bus = b.bus_l(2)[i];
        fehler = std::fmax(fehler, std::fabs(c - bus * (w * 0.5f + (1.0f - w))));
        if (t == 0) { c0 = c; bus0 = bus; }
        if (t == 240) { c240 = c; bus240 = bus; }
        if (t == 479) { c479 = c; bus479 = bus; }
        if (t == 480) { c480 = c; bus480 = bus; }
      }
      if (k == 1) PRUEF(b.frei(f) == 1);   // blend over: HALB freed
    }
    cypher_bk_frei(f[0]); f[0] = nullptr;
    PRUEF(bus0 > 0.05f);
    PRUEF(fehler <= 1e-5f);
    PRUEF(std::fabs(c0 - 0.5f * bus0) <= 1e-5f);                 // weights of the old path 1, 0.5, ~0, 0
    PRUEF(std::fabs(c240 - 0.75f * bus240) <= 1e-5f);
    PRUEF(std::fabs(c479 - bus479) <= 2e-3f * std::fabs(bus479));
    PRUEF(std::fabs(c480 - bus480) <= 1e-6f);
  }
  // (r) removal blends to silence, then exactly 0 and the graph is returned
  {
    SLauf a, b;
    b.m->setze_send_graph(2, graph(DURCH));
    for (int k = 0; k < 6; ++k) { a.block(0.25f); b.block(0.25f); }
    b.m->setze_send_graph(2, nullptr);
    float fehler = 0.0f;
    int still_anders = 0;
    CypherBk* f[8] = {};
    for (int k = 0; k < 4; ++k) {
      a.block(0.25f);
      b.block(0.25f);
      for (int i = 0; i < N; ++i) {
        const int t = k * N + i;
        const float w = t < cdj::Mixer::MIX_GRAPH_BLENDE ? static_cast<float>(cdj::Mixer::MIX_GRAPH_BLENDE - t) / cdj::Mixer::MIX_GRAPH_BLENDE : 0.0f;
        fehler = std::fmax(fehler, std::fabs((b.aus_l[i] - a.aus_l[i]) - b.bus_l(2)[i] * w));
      }
      if (k >= 2) still_anders += std::memcmp(a.aus_l, b.aus_l, sizeof a.aus_l) != 0;   // 512 > 480
    }
    PRUEF(fehler <= 1e-5f);
    PRUEF(still_anders == 0);
    PRUEF(b.frei(f) == 1);
    cypher_bk_frei(f[0]); f[0] = nullptr;
  }
  // (s) clamp: +-100 on the return becomes +-8 (R3: the NaN branch is defense in depth and has no binding test)
  {
    for (const float dc : {0.25f, -0.25f}) {
      SLauf a, b;
      b.m->setze_send_graph(2, graph(GROSS400));
      float c_min = 1e9f, c_max = -1e9f;
      for (int k = 0; k < 8; ++k) {
        a.block(dc);
        b.block(dc);
        if (k < 3) continue;
        for (int i = 0; i < N; ++i) {
          const float c = b.aus_l[i] - a.aus_l[i];
          c_min = std::fmin(c_min, c);
          c_max = std::fmax(c_max, c);
        }
      }
      const float betrag = dc > 0 ? c_min : -c_max;   // smallest magnitude in the steady state
      const float spitze_c = dc > 0 ? c_max : -c_min;
      PRUEF(std::fabs(b.bus_l(2)[N - 1]) * 400.0f > 20.0f);   // the graph really asks for far more than 8
      PRUEF(betrag > 7.99f && spitze_c <= 8.0f + 1e-5f);
    }
  }
  // (t) tail survives a silent send (D5): delay 10 ms, fb 0.5, one block of send signal, then the send at -200 dB
  {
    SLauf a, b;
    b.m->setze_send_graph(2, graph(ECHO10));
    int stumm_bloecke = 0;
    float bus_stille = 0.0f;
    for (int k = 0; k < 11; ++k) {
      if (k == 1) { a.setze("deck/1/send/3", -200.0f); b.setze("deck/1/send/3", -200.0f); }   // the send goes silent
      a.block(0.25f);
      b.block(0.25f);
      if (k < 2) continue;
      float c = 0.0f;
      for (int i = 0; i < N; ++i) {
        c = std::fmax(c, std::fabs(b.aus_l[i] - a.aus_l[i]));
        bus_stille = std::fmax(bus_stille, std::fabs(b.bus_l(2)[i]));
      }
      stumm_bloecke += c < 1e-4f;
    }
    PRUEF(bus_stille < 1e-3f);   // the send really is silent in blocks 2..10 (the dry channel tail is tiny)
    PRUEF(stumm_bloecke == 0);
  }
  // (u) allocation free: set, switch and blend of send graphs
  {
    SLauf b;
    CypherBk* g1 = graph(HALB);
    CypherBk* g2 = graph(DURCH);
    b.m->setze_send_graph(2, g1);
    b.block(0.25f);
    abfang_an();
    b.m->setze_send_graph(3, nullptr);
    b.m->setze_send_graph(2, g2);
    for (int k = 0; k < 10; ++k) b.block(0.25f);
    const AbfangZahlen az = abfang_zahlen();
    abfang_aus();
    PRUEF(!ALLOC_ABFANG_VERFUEGBAR || az.summe() == 0);
    CypherBk* f[8] = {};
    for (int nf = b.frei(f), i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
  }
  // (v) stereo is kept on the send return: opposite DC on the left and right deck input, pass-through graph on fx/3;
  //     the right return must carry the right bus (a left/right mix-up in send_rueckweg survived cases m-u)
  {
    SLauf a, b;
    b.m->setze_send_graph(2, graph(DURCH));
    float fehler = 0.0f, rechts = 0.0f;
    for (int k = 0; k < 8; ++k) {
      a.block_lr(0.25f, -0.25f);
      b.block_lr(0.25f, -0.25f);
      if (k < 3) continue;
      for (int i = 0; i < N; ++i) {
        rechts = std::fmin(rechts, b.bus_r(2)[i]);
        fehler = std::fmax(fehler, std::fabs((b.aus_l[i] - a.aus_l[i]) - b.bus_l(2)[i]));
        fehler = std::fmax(fehler, std::fabs((b.aus_r[i] - a.aus_r[i]) - b.bus_r(2)[i]));
      }
    }
    PRUEF(rechts < -0.05f);   // positive control: the right bus carries the negative signal
    PRUEF(fehler <= 1e-6f);
  }
  // (w) S14: a regler node in a send graph follows its knob row. Matrix of MIX_BK_ZEILEN rows at 0.5; fx/3/bk/2 is
  //     w[MIX_BK_SEND_ZEILE][1], fx/4/bk/2 the next row, deck/3/bk/2 is w[2][1]. Gain of the graph = contribution of the send
  //     return to the master sum (graph master minus the reference master without graph) divided by the send bus.
  {
    auto matrix = [](float (*w)[sw::BK_REGLER_N]) {
      for (int z = 0; z < cdj::MIX_BK_ZEILEN; ++z) for (int i = 0; i < sw::BK_REGLER_N; ++i) w[z][i] = 0.5f;
    };
    auto gewinn = [](const SLauf& ref, const SLauf& mit, int bus) {
      return (mit.aus_l[N - 1] - ref.aus_l[N - 1]) / mit.bus_l(bus)[N - 1];
    };
    // 1 + 2: the knob moves the graph within one block (one-pole: not there yet) and settles on the target
    float w[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N];
    matrix(w);
    SLauf a, b;
    b.m->setze_bk_wert(w);
    b.m->setze_send_graph(2, graph(REGLER2));
    for (int k = 0; k < 6; ++k) { a.block(0.25f); b.block(0.25f); }
    const float g0 = gewinn(a, b, 2);
    PRUEF(std::fabs(g0 - 0.5f) < 1e-4f);   // positive control: the knob node is in the path, default 0.5
    w[cdj::MIX_BK_SEND_ZEILE][1] = 1.0f;
    a.block(0.25f);
    b.block(0.25f);
    const float g1 = gewinn(a, b, 2);
    PRUEF(g1 > 0.55f && g1 < 1.0f);
    for (int k = 0; k < 40; ++k) { a.block(0.25f); b.block(0.25f); }
    const float g41 = gewinn(a, b, 2);
    PRUEF(std::fabs(g41 - 1.0f) < 1e-3f);
    std::printf("(w) fx/3/bk/2: default %.5f, 1 block %.4f, 41 blocks %.5f\n", g0, g1, g41);
    // 3: negative controls on fresh pairs, master bit-identical to a pair whose matrix stays at 0.5:
    //    the deck/3 row (the old NUTZT_DECK_REGLER idea) and the other send's row
    for (const int zeile : {2, cdj::MIX_BK_SEND_ZEILE + 1}) {
      float wr[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N], wb[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N];
      matrix(wr);
      matrix(wb);
      SLauf ruhig, bewegt;
      ruhig.m->setze_bk_wert(wr);
      bewegt.m->setze_bk_wert(wb);
      ruhig.m->setze_send_graph(2, graph(REGLER2));
      bewegt.m->setze_send_graph(2, graph(REGLER2));
      int anders = 0;
      for (int k = 0; k < 20; ++k) {
        if (k == 6) wb[zeile][1] = 1.0f;
        ruhig.block(0.25f);
        bewegt.block(0.25f);
        anders += std::memcmp(ruhig.aus_l, bewegt.aus_l, sizeof ruhig.aus_l) != 0 ||
                  std::memcmp(ruhig.aus_r, bewegt.aus_r, sizeof ruhig.aus_r) != 0;
      }
      PRUEF(anders == 0);
    }
    // 4: mirror, graph on slot 3 (fx/4), signal on send 4 only. Its row is MIX_BK_SEND_ZEILE + 1; the fx/3 row leaves it alone
    {
      float wm[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N], wr[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N];
      matrix(wm);
      matrix(wr);
      SLauf ref, spiegel, ruhig;
      for (SLauf* l : {&ref, &spiegel, &ruhig}) { l->setze("deck/1/send/3", -200.0f); l->setze("deck/1/send/4", 0.0f); }
      spiegel.m->setze_bk_wert(wm);
      ruhig.m->setze_bk_wert(wr);
      spiegel.m->setze_send_graph(3, graph(REGLER2));
      ruhig.m->setze_send_graph(3, graph(REGLER2));
      for (int k = 0; k < 6; ++k) { ref.block(0.25f); spiegel.block(0.25f); ruhig.block(0.25f); }
      const float m0 = gewinn(ref, spiegel, 3);
      PRUEF(std::fabs(m0 - 0.5f) < 1e-4f);
      wm[cdj::MIX_BK_SEND_ZEILE + 1][1] = 1.0f;
      wr[cdj::MIX_BK_SEND_ZEILE][1] = 1.0f;   // the fx/3 row: must not move the graph on fx/4
      for (int k = 0; k < 41; ++k) {
        ref.block(0.25f);
        spiegel.block(0.25f);
        ruhig.block(0.25f);
      }
      const float m41 = gewinn(ref, spiegel, 3);
      PRUEF(std::fabs(m41 - 1.0f) < 1e-3f);
      PRUEF(std::fabs(gewinn(ref, ruhig, 3) - 0.5f) < 1e-4f);
      std::printf("(w) fx/4/bk/2: default %.5f, 41 blocks %.5f, fx/3 row moved: %.5f\n", m0, m41, gewinn(ref, ruhig, 3));
    }
    // 4b: 32-knob widening: a regler node on knob 9 and one on knob 32 follow their own matrix column of the send row (fx/3 = MIX_BK_SEND_ZEILE);
    //     the neighbour column leaves the graph at 0.5
    for (const int knopf : {9, 32, 33, 64}) {   // 64-knob widening: 33 and 64 as well (an engine with REGLER 64 is needed: on an older library the node of knob 33 and 64 stays out of the path)
      std::string js = REGLER2;
      const size_t pos = js.find("\"nr\":2,");
      PRUEF(pos != std::string::npos);
      js.replace(pos, 7, "\"nr\":" + std::to_string(knopf) + ",");
      float wn[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N], wd[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N];
      matrix(wn);
      matrix(wd);
      SLauf ref, eigen, nachbar;
      eigen.m->setze_bk_wert(wn);
      nachbar.m->setze_bk_wert(wd);
      eigen.m->setze_send_graph(2, graph(js.c_str()));
      nachbar.m->setze_send_graph(2, graph(js.c_str()));
      for (int k = 0; k < 6; ++k) { ref.block(0.25f); eigen.block(0.25f); nachbar.block(0.25f); }
      PRUEF(std::fabs(gewinn(ref, eigen, 2) - 0.5f) < 1e-4f);   // positive control: the knob node is in the path
      wn[cdj::MIX_BK_SEND_ZEILE][knopf - 1] = 1.0f;
      wd[cdj::MIX_BK_SEND_ZEILE][(knopf == 32 || knopf == 64) ? knopf - 2 : knopf] = 1.0f;   // the neighbour column (knob 31, 10, 34, 63)
      for (int k = 0; k < 41; ++k) { ref.block(0.25f); eigen.block(0.25f); nachbar.block(0.25f); }
      const float ge = gewinn(ref, eigen, 2), gn = gewinn(ref, nachbar, 2);
      std::printf("(w) fx/3/bk/%d: own column 41 blocks %.5f, neighbour column %.5f\n", knopf, ge, gn);
      PRUEF(std::fabs(ge - 1.0f) < 1e-3f);
      PRUEF(std::fabs(gn - 0.5f) < 1e-4f);
    }
    // 5: without setze_bk_wert (K10) the graph stays at 0.5, whatever a matrix elsewhere holds
    {
      SLauf ref, ohne;
      ohne.m->setze_send_graph(2, graph(REGLER2));
      for (int k = 0; k < 8; ++k) { ref.block(0.25f); ohne.block(0.25f); }
      PRUEF(std::fabs(gewinn(ref, ohne, 2) - 0.5f) < 1e-4f);
    }
    // 6: allocation free while the knob changes every block
    {
      float wa[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N];
      matrix(wa);
      SLauf z;
      z.m->setze_bk_wert(wa);
      z.m->setze_send_graph(2, graph(REGLER2));
      for (int k = 0; k < 4; ++k) z.block(0.25f);
      abfang_an();
      for (int k = 0; k < 10; ++k) {
        wa[cdj::MIX_BK_SEND_ZEILE][1] = (k & 1) ? 1.0f : 0.0f;
        z.block(0.25f);
      }
      const AbfangZahlen az = abfang_zahlen();
      abfang_aus();
      PRUEF(!ALLOC_ABFANG_VERFUEGBAR || az.summe() == 0);
    }
  }
  // (l) Hörprobe (Task 7), nur mit CYPHERDJ_BK_FX_WAV_EIN/_AUS: 48-kHz-Stereo-WAV (16 bit oder 32-bit float) auf
  //     deck/1, 128 BPM ab Beat 0; 0 s ohne Graph, 4 s fx-echo-achtel, 12 s fx-filter-wobble, 20 s ohne, Ende 24 s
  const char* wav_ein = std::getenv("CYPHERDJ_BK_FX_WAV_EIN");
  const char* wav_aus = std::getenv("CYPHERDJ_BK_FX_WAV_AUS");
  if (wav_ein && wav_aus) {
    std::ifstream f(wav_ein, std::ios::binary);
    std::vector<char> roh((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    PRUEF(roh.size() > 44 && std::memcmp(roh.data(), "RIFF", 4) == 0 && std::memcmp(roh.data() + 8, "WAVE", 4) == 0);
    auto u16 = [&](size_t o) { uint16_t v; std::memcpy(&v, roh.data() + o, 2); return v; };
    auto u32 = [&](size_t o) { uint32_t v; std::memcpy(&v, roh.data() + o, 4); return v; };
    int format = 0, kanaele = 0, bits = 0;
    size_t daten = 0, laenge = 0;
    for (size_t o = 12; o + 8 <= roh.size(); o += 8 + ((u32(o + 4) + 1) & ~1u)) {
      if (std::memcmp(roh.data() + o, "fmt ", 4) == 0) { format = u16(o + 8); kanaele = u16(o + 10); bits = u16(o + 22); PRUEF(u32(o + 12) == 48000); }
      if (std::memcmp(roh.data() + o, "data", 4) == 0) { daten = o + 8; laenge = std::min<size_t>(u32(o + 4), roh.size() - daten); break; }
    }
    PRUEF(kanaele == 2 && daten > 0 && ((format == 1 && bits == 16) || (format == 3 && bits == 32)));
    const size_t frames = laenge / (bits / 8 * 2);
    auto probe = [&](size_t i, int c) -> float {
      const char* p = roh.data() + daten + (i * 2 + c) * (bits / 8);
      if (bits == 16) { int16_t v; std::memcpy(&v, p, 2); return v / 32768.0f; }
      float v; std::memcpy(&v, p, 4); return v;
    };
    auto lies = [](const char* name) {
      std::ifstream j(std::string(CYPHERDJ_DJK "/instruments/modular_dsp/demos/") + name);
      return std::string((std::istreambuf_iterator<char>(j)), std::istreambuf_iterator<char>());
    };
    const std::string echo = lies("fx-echo-achtel.json"), wobble = lies("fx-filter-wobble.json");
    constexpr long ENDE = 24L * 48000;
    PRUEF(frames >= (size_t)ENDE);
    // mit = false: derselbe Mixer ohne Graph, die Vergleichsspur (der Kanalzug ist auch ohne Graph nicht neutral)
    auto spiele = [&](bool mit) {
      Lauf l;
      std::vector<float> aus;
      aus.reserve(ENDE * 2);
      for (long s = 0; s < ENDE; s += N) {
        if (mit && s == 4L * 48000) l.m->setze_kanal_graph(0, graph(echo.c_str()));
        if (mit && s == 12L * 48000) l.m->setze_kanal_graph(0, graph(wobble.c_str()));
        if (mit && s == 20L * 48000) l.m->setze_kanal_graph(0, nullptr);
        CypherBk* fr[8];
        for (int nf = l.frei(fr), i = 0; i < nf; ++i) cypher_bk_frei(fr[i]);
        for (int i = 0; i < N; ++i) { l.m->eingang_l(0)[i] = probe(s + i, 0); l.m->eingang_r(0)[i] = probe(s + i, 1); }
        l.m->fx_takt(s / 22500.0, 128.0 / 60.0 / 48000.0);
        l.m->verarbeite(N, l.ml, l.mr, l.cl, l.cr);
        for (int i = 0; i < N; ++i) { aus.push_back(l.m->master_summe_l()[i]); aus.push_back(l.m->master_summe_r()[i]); }
      }
      return aus;
    };
    auto schreibe = [](const char* pfad, const std::vector<float>& aus) {
      std::ofstream o(pfad, std::ios::binary);
      auto w32 = [&](uint32_t v) { o.write(reinterpret_cast<const char*>(&v), 4); };
      auto w16 = [&](uint16_t v) { o.write(reinterpret_cast<const char*>(&v), 2); };
      const uint32_t bytes = aus.size() * 4;
      o.write("RIFF", 4); w32(36 + bytes); o.write("WAVEfmt ", 8); w32(16); w16(3); w16(2); w32(48000); w32(48000 * 8); w16(8); w16(32);
      o.write("data", 4); w32(bytes); o.write(reinterpret_cast<const char*>(aus.data()), bytes);
      PRUEF(o.good());
      std::fprintf(stderr, "Hörprobe: %s (%zu Frames)\n", pfad, aus.size() / 2);
    };
    schreibe(wav_aus, spiele(true));
    if (const char* wav_trocken = std::getenv("CYPHERDJ_BK_FX_WAV_TROCKEN")) schreibe(wav_trocken, spiele(false));
  }
  PRUEF_ENDE();
}
