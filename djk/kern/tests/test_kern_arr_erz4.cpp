// D1 K1 Slice 8: erz/4 gehört der Produktion (Spec D1 2.3). Der Rückweg rueck_erz_4 klingt nicht mehr (ein Wirt am
// falschen Port mischt nicht in die Summe des Arrangements), rueck_erz_2 klingt weiter (Negativ-Kontrolle); der
// Hüllen-Ring führt erz/4 als belegt und sieht die Summe des Arrangements, erz/5 bleibt null.
// Mutation: ARR_RUECK_ERZ4 (Rückweg erz/4 wie vorher) macht Fall 1 rot.
#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "arr_lauf.h"
#include "cypherdj/huellen.h"

bool g_waechter = false;

using k35::N;

static float spitze(const std::vector<float>& x, int64_t von, int64_t bis) {
  float m = 0.0f;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, std::fabs(x[i]));
  return m;
}

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_erz4");
  std::vector<float> gleich(N, 0.25f);
  {  // 1: rueck_erz_4 bei offenem erz/4 bleibt still
    arr35::Lauf x(ab.pfad, "test_kern_arr_erz4");
    x.kern->rueck(4, gleich.data(), gleich.data());
    x.lauf(40 * N);
    PRUEF(spitze(x.l, 20 * N, 40 * N) == 0.0f);
  }
  {  // 2: Negativ-Kontrolle: rueck_erz_2 bei offenem erz/2 klingt
    arr35::Lauf x(ab.pfad, "test_kern_arr_erz4");
    x.teil("erz/2/fader", 0.0f, 0.0, 0.0);
    x.kern->rueck(2, gleich.data(), gleich.data());
    x.lauf(40 * N);
    PRUEF(spitze(x.l, 20 * N, 40 * N) > 0.1f);
  }
  {  // 3: Hüllen-Ring: erz/4 (Kanal 7) belegt mit der Summe des Arrangements, erz/5 (Kanal 8) null
    arr35::Lauf x(ab.pfad, "test_kern_arr_erz4");
    auto* h = static_cast<cdj_huellen_kopf*>(std::aligned_alloc(64, CDJ_HUELLEN_BYTES));
    cdj_huellen_init(h);
    x.kern->verbinde_huellen(h);
    const std::string a = x.ordner.audio('a', 96000, 0.5f);
    x.laden(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 4.0, a, 96000) + "]}");
    x.start(0.0, 0);
    x.lauf(10 * N);
    const uint64_t r0 = cdj_lade(&h->w);
    x.lauf(10 * N + 48000);
    const uint64_t r1 = cdj_lade(&h->w);
    float e4 = 0.0f, e5 = 0.0f;
    for (uint64_t r = r0; r < r1; ++r) {
      e4 = std::max(e4, cdj_huellen_ort(h, r, 7)->spitze);
      e5 = std::max(e5, cdj_huellen_ort(h, r, 8)->spitze);
    }
    PRUEF(r1 - r0 >= 990);
    PRUEF(e4 > 0.1f);
    PRUEF(e5 == 0.0f);
    x.kern->verbinde_huellen(nullptr);
    std::free(h);
  }
  PRUEF_ENDE();
}
