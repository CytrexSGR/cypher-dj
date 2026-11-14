// Insert graphs on every source channel (remix targets L1, L2, DRUMS, BASS, MELODY): Mixer::setze_kanal_graph takes erz/1..8 and pad/1..2 like the decks.
// Signal: 1 kHz sine 0.5 on the channel under test (fader 0 dB), master_summe_l()/r() is read.
//  (a) a halving graph on pad/1 halves the sum after the blend (insert: the channel is replaced, not added to)
//  (b) a graph on pad/1 does not touch deck/1: with only deck/1 playing the sum stays bit-identical
//  (c) pad/1/bk/2 (knob row 12) steers a regler node of the pad/1 graph; deck/1/bk/2 (row 0) does not
//  (d) erz/1 (the drum stream, row 4) takes a graph as well
//  (e) a bus (bus/1, index 14) has no slot: the graph goes straight back through bk_frei
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
constexpr int DECK1 = 0, ERZ1 = 4, PAD1 = 12, BUS1 = 14;

static CypherBk* graph(const char* json) {
  char f[256] = {};
  CypherBk* g = cypher_bk_neu(json, 48000.0, f, sizeof f);
  if (!g) std::fprintf(stderr, "graph: %s\n", f);
  PRUEF(g != nullptr);
  return g;
}
static const char* HALB =
    R"({"format":"baukasten/2","name":"halb","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"a","art":"mul","b":0.5},{"id":"b","art":"mul","b":0.5},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";
static const char* REGLER2 =
    R"({"format":"baukasten/2","name":"r2","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"r","art":"regler","nr":2,"min":0,"max":1},{"id":"a","art":"mul"},{"id":"b","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"e.r","nach":"b.a"},{"von":"r.aus","nach":"a.b"},{"von":"r.aus","nach":"b.b"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  int quelle;
  float ml[N], mr[N], cl[N], cr[N];
  float aus_l[N] = {}, aus_r[N] = {};
  long t = 0;
  float bk[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N];
  explicit Lauf(int k) : m(std::make_unique<cdj::Mixer>(tab)), quelle(k) {
    for (const char* f : {"deck/1/fader", "erz/1/fader", "pad/1/fader"}) {
      const int r = tab.suche(f);
      PRUEF(r >= 0);
      m->setze_sofort(r, 0.0f);
    }
    for (auto& z : bk) for (float& w : z) w = 0.5f;
    m->setze_bk_wert(bk);
  }
  void block() {
    for (int i = 0; i < N; ++i) {
      const float x = static_cast<float>(0.5 * std::sin(2.0 * PI * 1000.0 * (t + i) / 48000.0));
      m->eingang_l(quelle)[i] = x;
      m->eingang_r(quelle)[i] = x;
    }
    t += N;
    m->fx_takt(t / 22500.0, 128.0 / 60.0 / 48000.0);
    m->verarbeite(N, ml, mr, cl, cr);
    std::memcpy(aus_l, m->master_summe_l(), sizeof aus_l);
    std::memcpy(aus_r, m->master_summe_r(), sizeof aus_r);
  }
  int frei(CypherBk** aus) { return m->bk_frei(aus, 8); }
  float spitze() const {
    float p = 0.0f;
    for (int i = 0; i < N; ++i) p = std::fmax(p, std::fabs(aus_l[i]));
    return p;
  }
};

// Peak ratio with / without a graph on channel `ziel` while channel `quelle` plays, after the blend.
static float verhaeltnis(int quelle, int ziel, const char* json) {
  Lauf ref(quelle), mit(quelle);
  mit.m->setze_kanal_graph(ziel, graph(json));
  float v = 0.0f;
  for (int k = 0; k < 20; ++k) {
    ref.block();
    mit.block();
    v = mit.spitze() / ref.spitze();
  }
  PRUEF(ref.spitze() > 0.01f);
  return v;
}

int main() {
  PRUEF(cdj::Mixer::MIX_GRAPH_KANAELE == cdj::MIX_QUELLEN);
  // (a) pad/1: -6 dB after the blend
  PRUEF(std::fabs(20.0 * std::log10(verhaeltnis(PAD1, PAD1, HALB)) + 6.0206) < 0.05);
  // (b) a graph on pad/1 leaves deck/1 alone, bit for bit
  {
    Lauf a(DECK1), b(DECK1);
    b.m->setze_kanal_graph(PAD1, graph(HALB));
    int anders = 0;
    for (int k = 0; k < 20; ++k) {
      a.block();
      b.block();
      anders += std::memcmp(a.aus_l, b.aus_l, sizeof a.aus_l) != 0 || std::memcmp(a.aus_r, b.aus_r, sizeof a.aus_r) != 0;
    }
    PRUEF(anders == 0);
  }
  // (c) knob row of pad/1 steers its graph, the row of deck/1 does not
  {
    auto gewinn = [](int zeile, float wert) {
      Lauf ref(PAD1), mit(PAD1);
      mit.m->setze_kanal_graph(PAD1, graph(REGLER2));
      mit.bk[zeile][1] = wert;
      float g = 0.0f;
      for (int k = 0; k < 30; ++k) {
        ref.block();
        mit.block();
        g = mit.spitze() / ref.spitze();
      }
      return g;
    };
    PRUEF(std::fabs(gewinn(PAD1, 0.25f) - 0.25f) < 0.01f);
    PRUEF(std::fabs(gewinn(DECK1, 0.25f) - 0.5f) < 0.01f);
  }
  // (d) erz/1 takes a graph
  PRUEF(std::fabs(20.0 * std::log10(verhaeltnis(ERZ1, ERZ1, HALB)) + 6.0206) < 0.05);
  // (e) no slot on a bus: handed back at once
  {
    Lauf b(DECK1);
    CypherBk* g = graph(HALB);
    b.m->setze_kanal_graph(BUS1, g);
    CypherBk* f[8] = {};
    const int n = b.frei(f);
    PRUEF(n == 1 && f[0] == g);
    for (int i = 0; i < n; ++i) cypher_bk_frei(f[i]);
  }
  PRUEF_ENDE();
}
