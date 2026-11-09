// 1.10 Slice 3 (Task 7): no malloc in the kernel cycle with returns: four tracks send to four returns (64 sends are set via the track controls too),
// the Halls are awake, Hall controls move (the debounce and the one-setze-per-block credit apply), sends ramp, a return is added and dropped by a swap of the
// playback, hall on is toggled, mute/solo of a return, stop. Counted only inside kern->zyklus(). Positive control: a malloc is counted. The Hall ran
// (wach, setze counted): 0 allocations is not an empty run. Under ASan/TSan the trap is missing: then "übersprungen", never "bestanden".
#include <cstdlib>

#include "arr_build.h"
#include "arr_run.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives (as test_kern_arr_alloc)

bool g_waechter = false;

using k35::N;

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("übersprungen (Sanitizer-Bau): Allokationswächter nicht verfügbar\n");
    return 0;
  }
  k35::Arbeitsbestand ab("test_kern_arr_returns_alloc");
  arr35::Lauf x(ab.pfad, "test_kern_arr_returns_alloc");
  const std::string a = x.ordner.audio('a', 400000, 0.2f);
  const std::string rets4 = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}},{\"nr\":2,\"ausgang\":{\"art\":\"master\"}},{\"nr\":3,\"ausgang\":{\"art\":\"master\"}},"
                            "{\"nr\":4,\"ausgang\":{\"art\":\"master\"}}";
  const std::string rets2 = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}},{\"nr\":3,\"ausgang\":{\"art\":\"master\"}}";
  std::string spuren;
  for (int i = 0; i < 8; ++i) {
    spuren += (i ? "," : "") + std::string("{\"nr\":") + std::to_string(i + 1) + ",\"art\":\"audio\",\"clips\":[" +
              x.ordner.clip(("c" + std::to_string(i + 1)).c_str(), 0.0, 8.0, a, 400000) + "]}";
  }
  auto tl = [&](const std::string& p, float v, double ab, double d) { x.teil(p.c_str(), v, ab, d); };
  x.laden3(1, spuren, "", rets4);
  x.loop(true, 0.0, 8.0);
  x.start(0.0, 0);
  for (int t = 1; t <= 8; ++t)
    for (int r = 1; r <= 4; ++r) tl("spur/" + std::to_string(t) + "/send/" + std::to_string(r), -6.0f - static_cast<float>(t), 2.0, 6.0);   // ramps: a course per sample
  x.lauf(4 * N);
  long im_zyklus = 0;
  auto zyklen = [&](int n) {
    for (int i = 0; i < n; ++i) {
      const int64_t n0 = x.kern->sample();
      abfang_an();
      x.kern->zyklus(N, n0 * 20833);
      im_zyklus += abfang_aus();
      cdj::Ereignis e;
      while (x.ere->hole(e))
        if (e.art == cdj::Ereignis::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), x.cache);
    }
  };
  zyklen(800);
  PRUEF(x.kern->arrangement().returns().wach(0) && x.kern->arrangement().returns().wach(3));   // the Halls were awake
  const uint64_t setze0 = x.kern->arrangement().returns().setze_gesamt();
  for (int b = 0; b < 40; ++b) {   // the Hall controls move: ramps in every cycle, then still
    for (int r = 1; r <= 4; ++r) tl("ret/" + std::to_string(r) + "/hall/decay", 0.3f + 0.01f * static_cast<float>(b), 0.0, 0.0);
    zyklen(1);
  }
  zyklen(400);
  PRUEF(x.kern->arrangement().returns().setze_gesamt() > setze0);   // setze ran inside the counted cycles
  tl("ret/2/mute", 1.0f, 0.0, 0.0);
  tl("ret/3/solo", 1.0f, 0.0, 0.0);
  tl("ret/4/hall/an", 0.0f, 0.0, 0.0);
  zyklen(500);
  x.laden3(2, spuren, "", rets2);   // returns 2 and 4 are dropped (fade 480 samples, Hall cleared), return 3 stays
  zyklen(600);
  tl("ret/2/mute", 0.0f, 0.0, 0.0);
  tl("ret/3/solo", 0.0f, 0.0, 0.0);
  tl("ret/4/hall/an", 1.0f, 0.0, 0.0);
  x.laden3(3, spuren, "", rets4);   // and added again
  zyklen(600);
  x.stopp(0);
  zyklen(200);
  abfang_an();
  void* p = std::malloc(16);
  const long positiv = abfang_aus();
  std::free(p);
  std::printf("arr_returns_alloc: %ld allocations in %d cycles, positive control %ld, setze %llu\n", im_zyklus, 3700 + 40, positiv,
              (unsigned long long)x.kern->arrangement().returns().setze_gesamt());
  PRUEF(positiv >= 1);
  PRUEF(im_zyklus == 0);
  PRUEF(x.kern->arrangement().returns().setze_max_je_block() <= 1);   // the credit held in the live run too
  PRUEF_ENDE();
}
