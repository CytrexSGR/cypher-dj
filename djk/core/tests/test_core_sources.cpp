// Container core K3 (F2/F3): stage 1 of Kern::audio fills the source buffers once per sub-block.
//  - an Erzeuger stream sounds in the buffer of its own index (stream 5 -> strom[4]) and in no other; unset streams stay zero;
//  - the host returns rueck(e) for e in {1,2,3,5,6,7} are added into strom[e-1]; rueck(4) (production) and rueck(8) (previewer) reach no stream;
//  - an input pair that is not fed leaves ein[] zero, a fed one lands in ein[paar-1];
//  - the players stay zero without a deck.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "cypherdj/cypher_bk_ffi.h"
#include "core25.h"
#include "core35.h"

bool g_waechter = false;

using k35::Lauf;
using k35::N;
using k35::SPB;

namespace {

const char* G = R"({"format":"baukasten/2","name":"t","stimmen":1,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";

float spitze(const float* p, int n) {
  float m = 0.0f;
  for (int i = 0; i < n; ++i) m = std::max(m, std::fabs(p[i]));
  return m;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_quellen");
  Lauf x(ab.pfad, nullptr);
  char f[256] = {};
  CypherBk* g = cypher_bk_neu(G, 48000.0, f, sizeof f);
  PRUEF(g != nullptr);
  auto s = x.neu(cdj::Befehl::ERZ_STROM, "erzeuger");
  s.nr = 5;
  s.form = -1;
  s.politik = 1;
  s.zeiger = g;
  x.sende(s);
  {
    auto* fe = new cdj::ErzFenster{};
    fe->strom = 5;
    fe->sendung = 1;
    fe->ab_beat = 0.0;
    fe->bis_beat = 8.0;
    cdj::ErzEv e{1.0, 57, 1, 1.0f};
    e.dauer = 4.0;
    fe->ev[fe->n++] = e;
    auto c = x.neu(cdj::Befehl::ERZ_FENSTER, "erzeuger");
    c.zeiger = fe;
    x.sende(c);
  }
  // host returns: e in 1..8 carries 0.1 * e on the left (and its negative on the right)
  for (int e = 0; e < 8; ++e) x.erz_quelle[e] = [e](int64_t) { return 0.1f * float(e + 1); };
  x.ein_quelle[2] = [](int64_t) { return 0.25f; };   // pair 2 fed, the others not

  float strom_s[cdj::ERZ_STROEME] = {}, strom_rueck[cdj::ERZ_STROEME] = {};
  float ein_s[cdj::EIN_PAARE] = {}, player_s[4] = {};
  float rueck_l[cdj::ERZ_STROEME][N] = {}, rueck_r[cdj::ERZ_STROEME][N] = {};
  float stream5_peak = 0.0f;
  for (int zyk = 0; zyk < 400; ++zyk) {
    x.zyklen(x.kern->sample() + N);
    const cdj::Quellpuffer& q = x.kern->quellpuffer();
    if (zyk == 300) {   // note over (beat 1..5 = samples 22500..112500 ~ cycle 88..440): the stream sounds
      for (int k = 0; k < cdj::ERZ_STROEME; ++k) {
        std::memcpy(rueck_l[k], q.strom_l[k], sizeof(float) * N);
        std::memcpy(rueck_r[k], q.strom_r[k], sizeof(float) * N);
      }
    }
    if (zyk < 120) continue;  // sound of the stream is in from sample ~22500 (cycle 88)
    for (int k = 0; k < cdj::ERZ_STROEME; ++k)
      strom_s[k] = std::max(strom_s[k], std::max(spitze(q.strom_l[k], N), spitze(q.strom_r[k], N)));
    for (int p = 0; p < cdj::EIN_PAARE; ++p) ein_s[p] = std::max(ein_s[p], spitze(q.ein_l[p], N));
    for (int d = 0; d < 4; ++d) player_s[d] = std::max(player_s[d], spitze(q.player_l[d], N));
  }
  (void)strom_rueck; (void)stream5_peak;
  // stream 5 carries the saw plus the host return 0.5; the pure return streams carry exactly 0.1 * e
  for (int e = 1; e <= 8; ++e) {
    const int k = e - 1;
    const bool in_strom = (e <= 3) || (e >= 5 && e <= 7);
    if (e == 5) continue;   // checked below together with the Erzeuger
    if (in_strom) {
      for (int i = 0; i < N; ++i) {
        PRUEF_NAH(rueck_l[k][i], 0.1 * e, 1e-6);
        PRUEF_NAH(rueck_r[k][i], -0.1 * e, 1e-6);
      }
    } else {
      PRUEF(spitze(rueck_l[k], N) == 0.0f && spitze(rueck_r[k], N) == 0.0f);   // rueck(4), rueck(8): no stream
    }
  }
  PRUEF(spitze(rueck_l[7], N) == 0.0f);   // rueck(8) is the previewer (stream index 7 stays silent)
  for (int k = 8; k < cdj::ERZ_STROEME; ++k) PRUEF(strom_s[k] == 0.0f);   // unset streams 9..16
  PRUEF(strom_s[3] == 0.0f && strom_s[7] == 0.0f);
  PRUEF(strom_s[4] > 0.5f + 0.01f);   // stream 5: return 0.5 plus the saw (0.5 exactly would be the return alone)
  PRUEF(ein_s[0] == 0.0f && ein_s[2] == 0.0f && ein_s[3] == 0.0f);
  PRUEF_NAH(ein_s[1], 0.25, 1e-6);
  for (int d = 0; d < 4; ++d) PRUEF(player_s[d] == 0.0f);
  PRUEF_ENDE();
}
