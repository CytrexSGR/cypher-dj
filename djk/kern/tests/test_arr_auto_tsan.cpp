// Automation slice 1 (task 8 step 3; slice 2 task 8 adds pan, mute, solo and geraet.* lanes): the lane swap over three threads as in operation. The net thread (Netz::laufen), the core thread (Kern::zyklus, the audio
// callback) and the arrangement load thread (ArrLader::laufen) run at the same time; the plan goes over the SPSC rings only (loader -> net -> core). While the
// transport plays in a loop, 40 playbacks with 8 fader lanes each (and a jump), pan, mute, solo and geraet.* lanes replace one another, so the lane snapshot is swapped under the running callback.
// Under ThreadSanitizer (own build with -DCYPHERDJ_TSAN=ON, target test_arr_auto_tsan) TSan reports nothing; the control is test_freeze_tsan_ohne_ring in the
// same build (a deliberate data race IS reported there, so the instrument is not blind). Without TSan the test runs as a plain three-thread check.
#include <cstdio>
#include <memory>
#include <string>

#include "cypherdj/warp_werk.h"
#include "freeze_faeden.h"

int main() {
  ff::Aufbau x("test_arr_auto_tsan");
  const std::string a = x.ordner.audio('a', 400000, 0.2f);
  // 1.12 slice 5 U8a: every clip carries a gain envelope whose table changes with the variant, so each swap is a table-only change under the running voices (glide)
  // 1.12 slice 5 U8b: the tracks differ in the voice path they run: 1, 2 plain; 3, 4 RE-PITCH; 5, 6 BEATS (32 units); 7 COMPLEX and 8 TONES through the warp werk (two worker
  // threads next to the core thread), so the swapped tables are read by every path of the voice code and by the werk voices
  auto hk_clip = [&](const char* id, int variante, int nr) {
    std::string c = nr <= 2 ? x.ordner.clip(id, 0.0, 8.0, a, 400000) : x.ordner.clip_warp(id, 0.0, 8.0, a, 400000, {{0.0, 0.0}, {8.0, 360000.0}}, 0.0, nr <= 4 ? 0 : nr <= 6 ? 1 : nr == 7 ? 2 : 3);
    if (nr == 5 || nr == 6) {
      std::string e = ",\"e\":[";
      for (int k = 0; k < 32; ++k) e += (k ? "," : "") + std::string("[") + std::to_string(k * 0.25) + "," + std::to_string(k * 11250) + "]";
      e += "],\"loop\":" + std::to_string(nr - 5) + ",\"huelle\":100";
      const size_t m = c.find("\"modus\":1");
      c.replace(m, 9, "\"modus\":1" + e);
    }
    char hk[160];
    std::snprintf(hk, sizeof hk, ",\"gain_hk\":[[0,-20,0],[%.17g,%.17g,0],[8,-30,1],[8,-6,2]]", 2.0 + (variante % 3), -3.0 - nr * 0.5 - variante * 0.1);
    c.insert(c.size() - 1, hk);
    return c;
  };
  auto spuren = [&](int variante) {
    std::string s;
    for (int nr = 1; nr <= 8; ++nr) {
      s += (nr > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" +
           hk_clip(("c" + std::to_string(nr)).c_str(), variante, nr) + "],\"auto\":[" +
           arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {1.0 + (variante % 3), -6.0 - variante * 0.25, 0}, {5.0, -3.0 - nr, 1}, {5.0, -30.0, 2}, {8.0, -12.0, 0}}) +
           // slice 2: a pan lane on every track, a mute lane on track 1 and a solo lane on track 2 (jump points), all swapped with the fader lane
           "," + arrdatei::Ordner::auto_lane({{0.0, -0.8, 0}, {4.0, 0.8 - 0.1 * (variante % 4), 1}, {8.0, -0.5, 0}}, "pan") +
           (nr == 1 ? "," + arrdatei::Ordner::auto_lane({{0.0, 0.0, 2}, {3.0, 1.0, 2}, {3.0 + 0.25 * (variante % 3), 0.0, 2}}, "mute") : std::string()) +
           (nr == 2 ? "," + arrdatei::Ordner::auto_lane({{0.0, 0.0, 2}, {2.0, 1.0, 2}, {2.25, 0.0, 2}}, "solo") : std::string()) +
           // 1.12 slice 5 U9: the value stack, a relative fader lane on every track and a relative pan lane on the even ones (swapped with the rest)
           "," + arrdatei::Ordner::auto_lane_rel({{0.0, -3.0, 0}, {4.0, -6.0 - 0.5 * (variante % 4), 1}, {8.0, -1.0, 0}}) +
           (nr % 2 == 0 ? "," + arrdatei::Ordner::auto_lane_rel({{0.0, 0.2, 0}, {4.0, -0.3 + 0.1 * (variante % 3), 0}, {8.0, 0.4, 0}}, "pan") : std::string()) +
           "]}";
    }
    // slice 2: an internal RB-338 track with geraet.* lanes (one block each over the device parameter path of the sink)
    s += ",{\"nr\":9,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[";
    for (int i = 0; i < 32; ++i)
      s += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.25) + ",\"laenge\":0.2,\"ton\":" +
           std::to_string(36 + i % 12) + ",\"vel\":100}";
    s += "],\"auto\":[" + arrdatei::Ordner::auto_lane({{0.0, 0.1, 0}, {4.0, 0.2 + 0.05 * (variante % 5), 0}, {8.0, 0.9, 1}}, "geraet.cutoff") + "," +
         arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {8.0, 0.7, 0}}, "geraet.resonanz") + "," +
         arrdatei::Ordner::auto_lane_rel({{0.0, -0.1, 0}, {8.0, 0.3 - 0.05 * (variante % 4), 0}}, "geraet.cutoff") + "," +   // U9: stacked with the absolute lane (core side) ...
         arrdatei::Ordner::auto_lane_rel({{0.0, 0.1, 0}, {8.0, -0.2, 0}}, "geraet.env_mod") + "]}";                           // ... and alone (the sink adds its base value)
    return s;
  };
  x.ordner.wiedergabe2(1, spuren(0), "");
  x.echtzeit.store(false);
  x.pause_us.store(200);
  auto werk = cdj::warp_werk_neu({2});
  PRUEF(werk != nullptr);
  x.starten([&](cdj::Kern& k) { k.setze_arr_warp_werk(werk.get()); });
  x.hallo();
  PRUEF(x.warte("/k/willkommen", 5000, [](const cdj::osc::Nachricht&) { return true; }) >= 0);
  const int64_t l1 = x.laden(1);
  PRUEF(x.warte_q(l1, 3, 20000) >= 0);
  {
    cdj::osc::Schreiber s(ff::v::k_arr_loop);
    s.h(++x.id).s("andreas").i(1).d(0.0).d(6.0);
    x.g->sende(s);
  }
  {
    cdj::osc::Schreiber s(ff::v::k_arr_start);
    s.h(++x.id).s("andreas").d(0.0).i(0);
    x.g->sende(s);
  }
  int geladen = 0;
  for (int n = 2; n <= 41; ++n) {   // each swap goes the whole way: file, load thread, net thread, ring, core thread at a block boundary
    x.ordner.wiedergabe2(n, spuren(n), "");
    const int64_t q = x.laden(n);
    if (x.warte_q(q, 3, 20000) >= 0) ++geladen;
    x.sammeln(5);
  }
  x.stopp();
  x.sammeln(50);
  x.anhalten();
  const unsigned long long werk_auftraege = werk->zaehler().ansaetze;
  werk->stoppe();
  long zustand = 0;
  for (const auto& p : x.pakete) zustand += p.adresse == "/zustand/arr";
  std::printf("arr_auto_tsan: %d of 40 lane swaps acknowledged as loaded, %ld /zustand/arr packets seen while playing, %llu werk jobs taken\n", geladen, zustand, werk_auftraege);
  PRUEF(geladen == 40);
  PRUEF(werk_auftraege > 0);   // the werk voices (COMPLEX, TONES) really ran next to the core thread
  PRUEF(zustand > 0);   // the transport really ran: not an empty run
  PRUEF_ENDE();
}
