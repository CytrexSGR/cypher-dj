// D1 K1 Slice 8, container core K3: the production position belongs to the production (Spec D1 2.3). The return rueck_erz_4 reaches no stream (a host on the
// wrong port neither mixes into the sum of the arrangement nor into a stream buffer of stage 1), rueck_erz_2 sounds (negative control, and it lands in stream buffer 2);
// the envelope ring reports the production position as occupied and sees the sum of the arrangement, the slot after it stays null.
// Mutation: ARR_RUECK_ERZ4 (the return added into stream 4 like any other) turns case 1 red.
#include <algorithm>
#include <cmath>
#include <cstdlib>

#include "arr_run.h"
#include "stream_hoerbar.h"
#include "cypherdj/quellpuffer.h"
#include "cypherdj/hulls.h"

bool g_waechter = false;

using k35::N;

static float spitze(const std::vector<float>& x, int64_t von, int64_t bis) {
  float m = 0.0f;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, std::fabs(x[i]));
  return m;
}

int main() {
  k35::Arbeitsbestand ab("test_kern_rueck_erz4");
  std::vector<float> gleich(N, 0.25f);
  {  // 1: rueck_erz_4 bei offenem erz/4 bleibt still
    arr35::Lauf x(ab.pfad, "test_kern_rueck_erz4");
    x.kern->rueck(4, gleich.data(), gleich.data());
    float s4 = 0.0f;
    for (int z = 1; z <= 40; ++z) {   // stage 1 never puts the return into a stream buffer (stream 4 = index 3)
      x.lauf(z * N);
      const cdj::Quellpuffer& q = x.kern->quellpuffer();
      for (int i = 0; i < N; ++i) s4 = std::max(s4, std::max(std::fabs(q.strom_l[3][i]), std::fabs(q.strom_r[3][i])));
    }
    PRUEF(s4 == 0.0f);
    PRUEF(spitze(x.l, 20 * N, 40 * N) == 0.0f);
  }
  {  // 2: negative control: rueck_erz_2 sounds when stream 2 has a track (X1: a stream has no strip, strom track on pad/1)
    arr35::Lauf x(ab.pfad, "test_kern_rueck_erz4");
    arr35::strom_hoerbar(x, 2);
    x.kern->rueck(2, gleich.data(), gleich.data());
    x.lauf(40 * N);
    PRUEF(spitze(x.l, 20 * N, 40 * N) > 0.1f);
    PRUEF(x.kern->quellpuffer().strom_l[1][0] == 0.25f);   // stream 2 holds the return (index 1)
  }
  {  // 3: Hüllen-Ring: erz/4 (Kanal 7) belegt mit der Summe des Arrangements, erz/5 (Kanal 8) null
    arr35::Lauf x(ab.pfad, "test_kern_rueck_erz4");
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
