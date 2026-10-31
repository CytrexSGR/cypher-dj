// Baukasten S3a Task 1: Baukasten-Graph aus libhall_ffi.a im Kern-Bau. Note am Versatz verschiebungs-invariant, Fehlertext
// bei falschem Graphen, Zeiger null harmlos, block unter dem Denormal-Schutz wie Hall, Komp und RB-338.
#include "cypherdj/cypher_bk_ffi.h"
#include <cypherdj/dsp/denormal.h>
#include "pruef.h"
#include <cstring>
#include <vector>

namespace {
const char* G = R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";

std::vector<float> lauf(int k) {
  char fehler[256] = {};
  CypherBk* h = cypher_bk_neu(G, 48000.0, fehler, sizeof fehler);
  PRUEF(h != nullptr);
  PRUEF(cypher_bk_note_an(h, static_cast<uint32_t>(k), 57, 1.0f) == 0);
  std::vector<float> aus;
  for (int b = 0; b < 20; ++b) {
    std::vector<float> l(256, 9.0f), r(256, 9.0f);
    cypherdj::dsp::DenormalSchutz schutz;
    PRUEF(cypher_bk_block(h, l.data(), r.data(), 256) == 0);
    aus.insert(aus.end(), l.begin(), l.end());
  }
  cypher_bk_frei(h);
  return aus;
}
}  // namespace

int main() {
  {  // 1 Versatz: k Samples Stille, danach bitgleich die Note bei 0; Gegenprobe k = 1 unverschoben anders
    const auto null = lauf(0);
    for (int k : {1, 256, 300}) {
      const auto x = lauf(k);
      for (int i = 0; i < k; ++i) PRUEF(x[i] == 0.0f);
      PRUEF(std::equal(x.begin() + k, x.end(), null.begin()));
    }
    PRUEF(!std::equal(null.begin(), null.begin() + 200, lauf(1).begin()));
    float spitze = 0.0f;
    for (float v : null) spitze = std::max(spitze, std::abs(v));
    PRUEF(spitze > 0.1f);
  }
  {  // 2 falscher Graph: nullptr und Text; Zeiger null: Stille
    char fehler[256] = {};
    PRUEF(cypher_bk_neu("{}", 48000.0, fehler, sizeof fehler) == nullptr);
    PRUEF(std::strlen(fehler) > 0);
    float l[64], r[64];
    std::fill(l, l + 64, 1.0f);
    std::fill(r, r + 64, 1.0f);
    PRUEF(cypher_bk_block(nullptr, l, r, 64) == 0);
    for (int i = 0; i < 64; ++i) PRUEF(l[i] == 0.0f && r[i] == 0.0f);
    cypher_bk_frei(nullptr);
  }
  {  // 3 Regler (S5r): nr 1..8 ok, 0 und 9 und Zeiger null -1; Wirkung (Glättung, Klemmen) prüft hall_ffi/tests/bk_ffi.rs
    char fehler[256] = {};
    CypherBk* h = cypher_bk_neu(G, 48000.0, fehler, sizeof fehler);
    PRUEF(h != nullptr);
    PRUEF(cypher_bk_regler(h, 1, 0.9f) == 0);
    PRUEF(cypher_bk_regler(h, 8, 0.1f) == 0);
    PRUEF(cypher_bk_regler(h, 9, 0.5f) == -1);
    PRUEF(cypher_bk_regler(h, 0, 0.5f) == -1);
    PRUEF(cypher_bk_regler(nullptr, 1, 0.5f) == -1);
    cypher_bk_frei(h);
  }
  PRUEF_ENDE();
}
