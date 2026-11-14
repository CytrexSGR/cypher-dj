// Master insert graph: an effect graph on the DJ master sum (Mixer::setze_master_graph), runs just before the master beat FX.
// Signal: 1 kHz sine 0.5 on deck/1; master_summe_l()/r() is read.
//  (a) without a graph the sum is bit-identical to a mixer that never had one; after removal and blend again bit-identical
//  (b) a halving graph halves the sum after the blend (the insert REPLACES the sum, it is not added to it)
//  (c) pass-through graph: sum bit-identical to no graph after the blend
//  (d) master/bk/2 (row MIX_BK_MASTER_ZEILE) steers a regler node of the master graph; the decks' rows do not
//  (e) the replaced graph is handed back through bk_frei after its blend (no leak); out of range input never leaks
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
static const char* REGLER2 =
    R"({"format":"baukasten/2","name":"r2","stimmen":1,"knoten":[{"id":"e","art":"eingang"},{"id":"r","art":"regler","nr":2,"min":0,"max":1},{"id":"a","art":"mul"},{"id":"b","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"e.l","nach":"a.a"},{"von":"r.aus","nach":"a.b"},{"von":"e.r","nach":"b.a"},{"von":"r.aus","nach":"b.b"},{"von":"a.aus","nach":"o.l"},{"von":"b.aus","nach":"o.r"}]})";

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[N], mr[N], cl[N], cr[N];
  float aus_l[N] = {}, aus_r[N] = {};
  long t = 0;
  float bk[cdj::MIX_BK_ZEILEN][sw::BK_REGLER_N];
  Lauf() : m(std::make_unique<cdj::Mixer>(tab)) {
    const int r = tab.suche("deck/1/fader");
    PRUEF(r >= 0);
    m->setze_sofort(r, 0.0f);
    for (auto& z : bk) for (float& w : z) w = 0.5f;
    m->setze_bk_wert(bk);
  }
  void block() {
    for (int i = 0; i < N; ++i) {
      const float x = static_cast<float>(0.5 * std::sin(2.0 * PI * 1000.0 * (t + i) / 48000.0));
      m->eingang_l(0)[i] = x;
      m->eingang_r(0)[i] = x;
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

int main() {
  // (a) no graph: bit-identical, also after set + remove
  {
    Lauf a, b;
    int anders_ohne = 0;
    for (int k = 0; k < 40; ++k) {
      if (k == 10) b.m->setze_master_graph(graph(HALB));
      if (k == 25) b.m->setze_master_graph(nullptr);
      a.block();
      b.block();
      const bool gleich = std::memcmp(a.aus_l, b.aus_l, sizeof a.aus_l) == 0 && std::memcmp(a.aus_r, b.aus_r, sizeof a.aus_r) == 0;
      if (k < 10 || k >= 28) anders_ohne += !gleich;
    }
    PRUEF(anders_ohne == 0);
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 1);   // the removed graph comes back exactly once
    cypher_bk_frei(f[0]);
  }
  // (b) halving graph: half the peak after the blend, and the graph really changes the sum
  {
    Lauf a, b;
    float vor = 0.0f, nach = 0.0f, ref = 0.0f;
    for (int k = 0; k < 20; ++k) {
      if (k == 10) b.m->setze_master_graph(graph(HALB));
      a.block();
      b.block();
      if (k == 9) vor = b.spitze();
      if (k == 15) { nach = b.spitze(); ref = a.spitze(); }
    }
    PRUEF(vor > 0.01f);
    PRUEF(std::fabs(20.0 * std::log10(nach / vor) + 6.0206) < 0.05);   // replaced, not added: -6 dB, not +3.5 dB
    PRUEF(nach < 0.6f * ref);
  }
  // (c) pass-through graph: bit-identical to no graph after the blend
  {
    Lauf a, b;
    int anders = 0;
    for (int k = 0; k < 20; ++k) {
      if (k == 5) b.m->setze_master_graph(graph(DURCH));
      a.block();
      b.block();
      if (k >= 8) anders += std::memcmp(a.aus_l, b.aus_l, sizeof a.aus_l) != 0 || std::memcmp(a.aus_r, b.aus_r, sizeof a.aus_r) != 0;
    }
    PRUEF(anders == 0);
  }
  // (d) knob row: master/bk/2 = bk[MIX_BK_MASTER_ZEILE][1] steers the graph, the deck rows and the send rows do not
  {
    auto gewinn = [](int zeile, float wert) {
      Lauf ref, mit;
      mit.m->setze_master_graph(graph(REGLER2));
      for (auto& z : mit.bk) for (float& x : z) x = 0.5f;
      mit.bk[zeile][1] = wert;
      float g = 0.0f;
      for (int k = 0; k < 30; ++k) {
        ref.block();
        mit.block();
        g = mit.spitze() / ref.spitze();
      }
      return g;
    };
    PRUEF(cdj::MIX_BK_MASTER_ZEILE == cdj::MIX_BK_ZEILEN - 1);
    PRUEF(std::fabs(gewinn(cdj::MIX_BK_MASTER_ZEILE, 0.25f) - 0.25f) < 0.01f);
    PRUEF(std::fabs(gewinn(cdj::MIX_BK_MASTER_ZEILE, 1.0f) - 1.0f) < 0.01f);
    PRUEF(std::fabs(gewinn(0, 0.25f) - 0.5f) < 0.01f);   // deck/1/bk/2 is not the master knob: it stays at its 0.5
    PRUEF(std::fabs(gewinn(cdj::MIX_BK_SEND_ZEILE, 0.25f) - 0.5f) < 0.01f);
  }
  // (e) a replacement: the old graph is freed after the blend and handed back once
  {
    Lauf b;
    CypherBk* g1 = graph(HALB);
    CypherBk* g2 = graph(DURCH);
    b.m->setze_master_graph(g1);
    for (int k = 0; k < 4; ++k) b.block();
    CypherBk* f[8] = {};
    PRUEF(b.frei(f) == 0);
    b.m->setze_master_graph(g2);
    for (int k = 0; k < 4; ++k) b.block();
    int n = b.frei(f);
    PRUEF(n == 1 && f[0] == g1);
    for (int i = 0; i < n; ++i) cypher_bk_frei(f[i]);
    b.m->setze_master_graph(nullptr);
    for (int k = 0; k < 4; ++k) b.block();
    n = b.frei(f);
    PRUEF(n == 1 && f[0] == g2);
    for (int i = 0; i < n; ++i) cypher_bk_frei(f[i]);
  }
  PRUEF_ENDE();
}
