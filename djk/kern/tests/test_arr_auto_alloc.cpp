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
  // 1.12 slice 5 U8a: voices that play a clip with a gain envelope, and of those the ones whose held factor has left 1.0 (the envelope really runs)
  static int hk_stimmen(const Arrangement& a) { int n = 0; for (const Arrangement::Stimme& v : a.st_) n += v.aktiv && v.clip && v.hk.punkte() > 0; return n; }
  static int hk_laufen(const Arrangement& a) { int n = 0; for (const Arrangement::Stimme& v : a.st_) n += v.aktiv && v.clip && v.hk.punkte() > 0 && v.hk_lin != 1.0f; return n; }
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
  const cdj::ArrSnapshot* sn = x.kern->arrangement().snapshot();
  const bool lanes_da = sn != nullptr && sn->n_auto_lanes == 96;   // the lanes were really loaded (read before the next load replaces the snapshot)
  // 1.12 slice 5 U8a: the plain path with gain_hk: 32 voices evaluate an envelope per sample, loop seams restart them, a swap changes the tables (glide) and a stop fades them.
  // The envelope really runs (0 allocations is not an empty run): 32 voices with a table whose held factor has left 1.0.
  auto spuren_hk = [&](double p) {
    std::string s;
    for (int nr = 1; nr <= 32; ++nr) {
      std::string c = x.ordner.clip(("h" + std::to_string(nr)).c_str(), 0.0, 8.0, a, 400000);
      char hk[160];
      std::snprintf(hk, sizeof hk, ",\"gain_hk\":[[0,-20,0],[%.17g,%.17g,0],[8,-30,1],[8,-6,2]]", p, -3.0 - nr * 0.5);
      c.insert(c.size() - 1, hk);
      s += (nr > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" + c + "]}";
    }
    return s;
  };
  x.laden(3, spuren_hk(4.0), "andreas", true);
  zyklen(1000);
  const int hk_an = cdj::ArrPruefZugang::hk_stimmen(x.kern->arrangement()), hk_lauf = cdj::ArrPruefZugang::hk_laufen(x.kern->arrangement());
  x.laden(4, spuren_hk(5.0), "andreas", true);   // only the tables change: 32 glides
  zyklen(1000);
  x.stopp(0);
  zyklen(200);
  x.start(0.0, 0);
  zyklen(1000);
  // 1.12 slice 5 U8b: the same with RE-PITCH voices (a warp map of two markers, 22500 source frames per beat) that carry the envelope: the clip beat of every sample comes from wp_
  auto spuren_warp = [&](double p) {
    std::string s;
    for (int nr = 1; nr <= 32; ++nr) {
      std::string c = x.ordner.clip_warp(("r" + std::to_string(nr)).c_str(), 0.0, 8.0, a, 400000, {{0.0, 0.0}, {8.0, 8.0 * 22500.0}});
      char hk[160];
      std::snprintf(hk, sizeof hk, ",\"gain_hk\":[[0,-20,0],[%.17g,%.17g,0],[8,-30,1],[8,-6,2]]", p, -3.0 - nr * 0.5);
      c.insert(c.size() - 1, hk);
      s += (nr > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" + c + "]}";
    }
    return s;
  };
  x.laden(5, spuren_warp(4.0), "andreas", true);
  zyklen(1000);
  const int warp_an = cdj::ArrPruefZugang::hk_stimmen(x.kern->arrangement()), warp_lauf = cdj::ArrPruefZugang::hk_laufen(x.kern->arrangement());
  const int warp_stimmen = x.kern->arrangement().warp_stimmen();
  x.laden(6, spuren_warp(5.0), "andreas", true);   // only the tables change: 32 glides of warped voices
  zyklen(1000);
  x.stopp(0);
  zyklen(200);
  x.start(0.0, 0);
  zyklen(1000);
  // 1.12 slice 5 U9: the value stack. Odd tracks carry an absolute and a relative lane for fader and pan, even tracks relative lanes only (base value + summand); the loop seams restart the
  // cursors, a swap moves the points (the relative lanes appear and move, blend of 480 samples), a stop blends back. The stack really plays: the last fader value of every track
  // is below the one of the absolute lane alone (the relative fader lane holds -10 dB or lower, the absolute lane never goes below -4).
  auto spuren_stapel = [&](double p) {
    std::string s;
    for (int nr = 1; nr <= 32; ++nr) {
      s += (nr > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" +
           x.ordner.clip(("s" + std::to_string(nr)).c_str(), 0.0, 8.0, a, 400000) + "],\"auto\":[";
      if (nr & 1) s += arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {p, -4.0, 0}, {8.0, 0.0, 1}}) + "," + arrdatei::Ordner::auto_lane({{0.0, -0.5, 0}, {p, 0.5, 0}, {8.0, 0.0, 0}}, "pan") + ",";
      s += arrdatei::Ordner::auto_lane_rel({{0.0, -10.0, 0}, {p, -20.0 - nr * 0.5, 0}, {8.0, -12.0, 1}, {8.0, -30.0, 2}}) + "," +
           arrdatei::Ordner::auto_lane_rel({{0.0, -0.8, 0}, {p, 0.9, 1}, {8.0, 0.3, 0}}, "pan") + "]}";
    }
    return s;
  };
  x.laden(7, spuren_stapel(4.0), "andreas", true);
  zyklen(1000);
  int stapel_tief = 0;
  for (int i = 0; i < 32; ++i) stapel_tief += x.kern->arrangement().auto_letzter_wert(i, 0) < -9.5f && cdj::ArrPruefZugang::schrieb(x.kern->arrangement(), i, 0) && cdj::ArrPruefZugang::schrieb(x.kern->arrangement(), i, 1);
  const cdj::ArrSnapshot* sn_stapel = x.kern->arrangement().snapshot();
  const bool stapel_da = sn_stapel != nullptr && sn_stapel->n_auto_lanes == 16 * 4 + 16 * 2;   // 16 odd tracks with 4 lanes, 16 even with 2
  x.laden(8, spuren_stapel(5.0), "andreas", true);   // the points move: 32 blends of the stacks
  zyklen(1000);
  x.stopp(0);
  zyklen(200);
  x.start(0.0, 0);
  zyklen(1000);
  abfang_an();
  void* p = std::malloc(16);
  const long positiv = abfang_aus();
  std::free(p);
  cypherdj::stellwerk::ReglerTabelle tab;
  const long voll = static_cast<long>(x.kern->stellwerk().zaehler().bewegt_voll);
  std::printf("arr_auto_alloc: %ld allocations in 12800 cycles (3200 with lanes, 3200 with gain_hk, 3200 with gain_hk on RE-PITCH voices: %d voices, %d with a table, %d running, 3200 with value stacks: %d of 32 tracks play the stack), hk voices %d running %d, positive control %ld, controllers %d, bewegt_voll %ld\n", im_zyklus, warp_stimmen, warp_an, warp_lauf, stapel_tief, hk_an, hk_lauf, positiv, tab.anzahl(), voll);
  PRUEF(lanes_da);   // the lanes were really loaded: 0 allocations is not an empty run
  PRUEF(spielt == 32 && spielt_solo == 0);
  PRUEF(hk_an == 32 && hk_lauf == 32);
  PRUEF(warp_stimmen == 32 && warp_an == 32 && warp_lauf == 32);   // U8b: 32 warped voices play a table and its factor is running   // 32 voices play a table and its factor is running
  PRUEF(stapel_da && stapel_tief == 32);   // U9: the stacks were really loaded and play on all 32 tracks
  PRUEF(positiv >= 1);
  PRUEF(im_zyklus == 0);
  PRUEF(tab.anzahl() == 693 + 204 + 16 + 345 + 120 + 2 * 59 + 4 + 48 + 3);   // 2026-11-06: eq pool 2; master limiter: + 3 ins/lim rows   // 693 (before slice 3) + 204 send, return and hall controls + 16 send-return graph knobs (S14) + 345 mix-tool rows (1.15 A1b: gate 117, utility 119, multiband 96, limiter 12, spectrum 1) = 1258, + 120 ins/komp rows (1.10 slice 4a T1) = 1378, + 63 ins/eq and ins/saett rows (4b T12) = 1441, + 48 rack macro rows rack/<k>/m<n> (4c T15) = 1489
  PRUEF(voll == 0);
  PRUEF_ENDE();
}
