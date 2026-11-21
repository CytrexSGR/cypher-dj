// Container core K1: the Erzeuger is channel free. A stream is "set" once setze_strom was called (or setze_bk got a graph); its sound
// goes to the output buffer of its own index (stream - 1). A stream that was never set makes no sound and no ringing-out graph
// (the former kanal < 0 case). The ringing-out of a replaced graph (BkAus) reports the stream it belongs to.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "cypherdj/cypher_bk_ffi.h"
#include "cypherdj/generator.h"
#include "check.h"

namespace {

constexpr int N = 256;
constexpr int64_t SPB = 22500;  // 128 BPM at 48 kHz
const char* G = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";

CypherBk* graph() {
  char f[256] = {};
  CypherBk* h = cypher_bk_neu(G, 48000.0, f, sizeof f);
  PRUEF(h != nullptr);
  return h;
}

struct Welt {
  cdj::Karte karte{128.0, 0};
  cdj::Erzeuger erz;
  std::vector<float> pl = std::vector<float>(cdj::ERZ_STROEME * N), pr = pl;
  float* l[cdj::ERZ_STROEME];
  float* r[cdj::ERZ_STROEME];
  std::vector<float> summe[cdj::ERZ_STROEME];  // per stream index, over all blocks
  int64_t s = 0;
  Welt() {
    for (int k = 0; k < cdj::ERZ_STROEME; ++k) { l[k] = &pl[k * N]; r[k] = &pr[k * N]; }
  }
  void bis(int64_t ende) {
    while (s < ende) {
      std::fill(pl.begin(), pl.end(), 0.0f);
      std::fill(pr.begin(), pr.end(), 0.0f);
      erz.block(karte, s, N, l, r, nullptr, s);
      for (int k = 0; k < cdj::ERZ_STROEME; ++k) summe[k].insert(summe[k].end(), l[k], l[k] + N);
      s += N;
    }
  }
  float spitze(int k) const {
    float m = 0.0f;
    for (float x : summe[k]) m = std::max(m, std::fabs(x));
    return m;
  }
};

cdj::ErzFenster fenster(int strom, double beat, int note, double dauer) {
  cdj::ErzFenster f{};
  f.strom = strom;
  f.sendung = 1;
  f.ab_beat = 0.0;
  f.bis_beat = 8.0;
  cdj::ErzEv e{beat, note, 1, 1.0f};
  e.dauer = dauer;
  f.ev[f.n++] = e;
  return f;
}

}  // namespace

int main() {
  cdj::Kit kit;
  kit.klang[57].frames = 2;
  kit.klang[57].daten = {1.0f, 1.0f, 0.5f, 0.5f};
  kit.n = 1;
  {  // 1) setze_strom(5, kit): stream 5 is set, stream 4 is not; the kit sound lands in output index 4 and nowhere else
    Welt w;
    PRUEF(!w.erz.strom_gesetzt(5));
    w.erz.setze_strom(5, &kit);
    PRUEF(w.erz.strom_gesetzt(5));
    PRUEF(!w.erz.strom_gesetzt(4));
    w.erz.fenster(fenster(5, 1.0, 57, 0.5), 0.0);
    w.bis(2 * SPB);
    PRUEF(w.summe[4][SPB] == 1.0f);
    for (int k = 0; k < cdj::ERZ_STROEME; ++k)
      if (k != 4) PRUEF(w.spitze(k) == 0.0f);
  }
  {  // 2) a note on stream 4 (never set): no sound anywhere, nothing rings out
    Welt w;
    w.erz.setze_strom(5, &kit);
    w.erz.fenster(fenster(4, 1.0, 57, 0.5), 0.0);
    w.bis(2 * SPB);
    for (int k = 0; k < cdj::ERZ_STROEME; ++k) PRUEF(w.spitze(k) == 0.0f);
    CypherBk* f[4];
    PRUEF(w.erz.bk_frei(f, 4) == 0);
    w.erz.setze_bk(4, nullptr);   // no graph there, nothing to ring out
    w.bis(w.s + 2 * N);
    PRUEF(w.erz.bk_frei(f, 4) == 0);
    PRUEF(!w.erz.strom_gesetzt(4));
  }
  {  // 3) a graph on stream 2, replaced while a note holds: the old one rings out into output index 1 (BkAus.strom == 2 - 1), not elsewhere
    Welt w;
    w.erz.setze_bk(2, graph());
    PRUEF(w.erz.strom_gesetzt(2));
    w.erz.fenster(fenster(2, 0.0, 57, 8.0), 0.0);
    w.bis(2 * N);
    const float vor = w.spitze(1);
    PRUEF(vor > 0.0f);
    const size_t ab = w.summe[1].size();
    w.erz.setze_bk(2, graph());   // the held note belongs to the old graph, which rings out
    w.bis(w.s + N);
    // the ramp of the old graph is audible in the block after the replacement, on index 1 only
    float rampe = 0.0f;
    for (size_t i = ab; i < w.summe[1].size(); ++i) rampe = std::max(rampe, std::fabs(w.summe[1][i]));
    PRUEF(rampe > 0.0f);
    for (int k = 0; k < cdj::ERZ_STROEME; ++k)
      if (k != 1) PRUEF(w.spitze(k) == 0.0f);
    w.bis(w.s + 4 * N);
    CypherBk* f[4];
    const int nf = w.erz.bk_frei(f, 4);
    PRUEF(nf == 1);
    for (int i = 0; i < nf; ++i) cypher_bk_frei(f[i]);
    w.erz.setze_bk(2, nullptr);
    w.bis(w.s + 4 * N);
    const int nf2 = w.erz.bk_frei(f, 4);
    PRUEF(nf2 == 1);
    for (int i = 0; i < nf2; ++i) cypher_bk_frei(f[i]);
  }
  PRUEF_ENDE();
}
