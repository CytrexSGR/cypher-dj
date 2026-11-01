// Automation Slice 1, task 8 (slice 2 task 3: fader, pan and mute lanes): no malloc in the core cycle with lanes. 32 tracks with three lanes each (clip + lane), a loop bracket with seams, 32 pan
// ramps through the stellwerk (many moving controllers next to the lanes: bewegt_voll must stay 0), a snapshot swap in the middle of the run (lane
// points move, blend of 480 samples), a stop (source blend) and a start again. Counted only inside kern->zyklus() (alloc_abfang.h).
// Positive control: a malloc is counted. Controller protection: the table still holds 693 controllers (N0 of the baseline) and the stellwerk
// counter bewegt_voll stays 0. Under ASan/TSan the interception is missing: "skipped", never "passed".
#include <cstdlib>

#include "arr_bau.h"
#include "arr_lauf.h"
#include "cypherdj/stellwerk/regler.h"
#include "alloc_abfang.h"   // last: replaces malloc and relatives

bool g_waechter = false;

namespace cdj {
struct ArrPruefZugang {   // friend of Arrangement: did the track write the lane buffer of a field in the last block?
  static bool schrieb(const Arrangement& a, int spur, int feld) { return a.auto_war_[spur][feld]; }
};
}  // namespace cdj

using k35::N;

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("skipped (sanitizer build): allocation watcher not available\n");
    return 0;
  }
  k35::Arbeitsbestand ab("test_arr_auto_alloc");
  arr35::Lauf x(ab.pfad, "test_arr_auto_alloc");
  const std::string a = x.ordner.audio('a', 400000, 0.1f);
  auto spuren = [&](double p) {
    std::string s;
    for (int nr = 1; nr <= 32; ++nr) {
      s += (nr > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" +
           x.ordner.clip(("c" + std::to_string(nr)).c_str(), 0.0, 8.0, a, 400000) + "],\"auto\":[" +
           arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {p, -20.0 - nr * 0.5, 0}, {8.0, -3.0, 1}, {8.0, -30.0, 2}}) + "," +
           arrdatei::Ordner::auto_lane({{0.0, -1.0, 0}, {p, 1.0, 1}, {8.0, 0.25, 0}}, "pan") + "," +
           arrdatei::Ordner::auto_lane({{0.0, 0.0, 2}, {p, 1.0, 2}, {5.0, 0.0, 2}}, "mute") + "]}";
    }
    return s;
  };
  x.laden(1, spuren(4.0), "andreas", true);
  x.loop(true, 0.0, 6.0);
  x.start(0.0, 0);
  for (int nr = 1; nr <= 32; ++nr) x.teil(("spur/" + std::to_string(nr) + "/pan").c_str(), 0.5f, 6.0, 6.0);
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
  zyklen(1000);
  int spielt = 0, spielt_solo = 0;   // the lanes really play in the measured cycles (0 allocations is not an empty run)
  for (int i = 0; i < 32; ++i) {
    spielt += cdj::ArrPruefZugang::schrieb(x.kern->arrangement(), i, 0) && cdj::ArrPruefZugang::schrieb(x.kern->arrangement(), i, 1) &&
              cdj::ArrPruefZugang::schrieb(x.kern->arrangement(), i, 2);
    spielt_solo += cdj::ArrPruefZugang::schrieb(x.kern->arrangement(), i, 3);   // negative control: no solo lane
  }
  x.laden(2, spuren(5.0), "andreas", true);   // swap: the lane points move, blend on 32 tracks
  zyklen(1000);
  x.stopp(0);
  zyklen(200);   // stop blend
  x.start(0.0, 0);
  zyklen(1000);
  abfang_an();
  void* p = std::malloc(16);
  const long positiv = abfang_aus();
  std::free(p);
  cypherdj::stellwerk::ReglerTabelle tab;
  const long voll = static_cast<long>(x.kern->stellwerk().zaehler().bewegt_voll);
  std::printf("arr_auto_alloc: %ld allocations in 3200 cycles, positive control %ld, controllers %d, bewegt_voll %ld\n", im_zyklus, positiv, tab.anzahl(), voll);
  const cdj::ArrSnapshot* sn = x.kern->arrangement().snapshot();
  PRUEF(sn != nullptr && sn->n_auto_lanes == 96);   // the lanes were really loaded: 0 allocations is not an empty run
  PRUEF(spielt == 32 && spielt_solo == 0);
  PRUEF(positiv >= 1);
  PRUEF(im_zyklus == 0);
  PRUEF(tab.anzahl() == 693 + 204 + 16);   // 693 (before slice 3) + 204 send, return and hall controls + 16 send-return graph knobs (S14)
  PRUEF(voll == 0);
  PRUEF_ENDE();
}
