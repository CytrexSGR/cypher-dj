// Loop lane strip K4, the mixer half: the FX 3 share of arrangement tracks that lead into container strip deck/1 (Mixer::arr_fx3_eingang_l/r + arr_fx3_markiere, the core hands it after weighting it
// with the container module weight). The channel strip applies ITS fader (the gain of the main path, per sample) and the crossfader weight and adds the result into the fx/3 bus input while a graph sits on
// fx/3, into the master sum when there is none (never silent). Only the share is fed here: deck/1 itself carries no signal. The master sum (master_summe_l/r) is read.
//  (a) graph on fx/3 (a pass-through): the share arrives at fader 0 dB, at -6 dB it is exactly the fader's -6 dB, and with the fader closed nothing arrives
//  (b) no graph on fx/3: the same three, audible at 0 dB (the fallback to the master sum), following the fader
//  (c) the crossfader weight acts on the share: deck/1 on side A, crossfader at +0.5 gives half, fully cut gives nothing
// Mutations (CMakeLists.txt): ARR_FX3_OHNE_FADER (a, b), ARR_FX3_OHNE_XFADER (c).
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

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[N], mr[N], cl[N], cr[N];
  float aus_l[N] = {};
  long t = 0;
  int k;
  Lauf() : m(std::make_unique<cdj::Mixer>(tab)), k(cdj::Mixer::kanal_index("deck/1")) {
    PRUEF(k >= 0);
    for (const char* p : {"deck/2/fader", "pad/1/fader", "pad/2/fader"}) setze(p, -200.0f);
  }
  void setze(const char* pfad, float w) {
    const int r = tab.suche(pfad);
    PRUEF(r >= 0);
    m->setze_sofort(r, w);
  }
  void block() {
    for (int d = 0; d < 4; ++d) {
      std::memset(m->eingang_l(d), 0, sizeof(float) * N);
      std::memset(m->eingang_r(d), 0, sizeof(float) * N);
    }
    for (int i = 0; i < N; ++i) {
      const float v = static_cast<float>(0.5 * std::sin(2.0 * PI * 1000.0 * static_cast<double>(t + i) / 48000.0));
      m->arr_fx3_eingang_l(k)[i] = v;
      m->arr_fx3_eingang_r(k)[i] = v;
    }
    m->arr_fx3_markiere(k);
    t += N;
    m->fx_takt(t / 22500.0, 128.0 / 60.0 / 48000.0);
    m->verarbeite(N, ml, mr, cl, cr);
    std::memcpy(aus_l, m->master_summe_l(), sizeof aus_l);
  }
  float spitze() const {
    float p = 0.0f;
    for (int i = 0; i < N; ++i) p = std::fmax(p, std::fabs(aus_l[i]));
    return p;
  }
  float messen(int bloecke = 40) {
    for (int b = 0; b < bloecke; ++b) block();
    return spitze();
  }
};

int main() {
  for (const bool mit_graph : {true, false}) {
    float p[3];
    const float fader[3] = {0.0f, -6.0f, -200.0f};
    for (int i = 0; i < 3; ++i) {
      Lauf l;
      if (mit_graph) l.m->setze_send_graph(2, graph(DURCH));
      l.setze("deck/1/fader", fader[i]);
      p[i] = l.messen();
    }
    std::printf("(%c) %s: share at 0 dB %.4f, at -6 dB %.4f, closed %.3g\n", mit_graph ? 'a' : 'b', mit_graph ? "graph on fx/3" : "no graph", p[0], p[1], p[2]);
    PRUEF(p[0] > 0.3f);   // arrives (through the graph or, with none, on the master path)
    PRUEF(std::fabs(p[1] / p[0] - std::pow(10.0f, -6.0f / 20.0f)) < 2e-3f);   // the fader of the strip acts on the share
    PRUEF(p[2] < 1e-6f);  // closed: nothing arrives
  }
  {  // (c) the crossfader weight
    float p[3];
    const float xf[3] = {0.0f, 0.5f, 1.0f};
    for (int i = 0; i < 3; ++i) {
      Lauf l;
      l.m->setze_send_graph(2, graph(DURCH));
      l.setze("deck/1/fader", 0.0f);
      l.setze("deck/1/xseite", 0.0f);
      l.setze("xfader", xf[i]);
      p[i] = l.messen();
    }
    std::printf("(c) crossfader: centre %.4f, +0.5 %.4f, cut %.3g\n", p[0], p[1], p[2]);
    PRUEF(p[0] > 0.3f);
    PRUEF(std::fabs(p[1] / p[0] - 0.5f) < 1e-3f);
    PRUEF(p[2] < 1e-6f);
  }
  PRUEF_ENDE();
}
