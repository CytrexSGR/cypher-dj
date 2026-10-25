// 1.10 Slice 1 (L5): kein malloc im Kern-Zyklus mit Gruppen: vier Audio-Spuren in zwei Gruppen, Ziel-Wechsel mitten im Lauf (Tausch der Wiedergabe mit
// anderem ausgang), Fader-Rampen an Gruppe und PM (Verlauf je Sample), Mute/Solo von Gruppe und Spur, Stopp. Gezählt wird nur in kern->zyklus().
// Positiv-Kontrolle: ein malloc wird gezählt. Unter ASan/TSan fehlt der Abfang: dann „übersprungen“, nie „bestanden“.
#include <cstdlib>

#include "arr_bau.h"
#include "arr_lauf.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte (wie test_kern_arr_alloc)

bool g_waechter = false;

using k35::N;

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("übersprungen (Sanitizer-Bau): Allokationswächter nicht verfügbar\n");
    return 0;
  }
  k35::Arbeitsbestand ab("test_kern_arr_gruppen_alloc");
  arr35::Lauf x(ab.pfad, "test_kern_arr_gruppen_alloc");
  const std::string a = x.ordner.audio('a', 400000, 0.2f);
  const std::string gruppen = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}},{\"nr\":2,\"ausgang\":{\"art\":\"master\"}}";
  auto spuren = [&](int g3, int g4) {   // Spur 1 und 2 in Gruppe 1, Spur 3 und 4 in g3 und g4 (0 = master)
    std::string s;
    const int ziel[4] = {1, 1, g3, g4};
    for (int i = 0; i < 4; ++i) {
      s += (i ? "," : "") + std::string("{\"nr\":") + std::to_string(i + 1) + ",\"art\":\"audio\"";
      if (ziel[i]) s += ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + std::to_string(ziel[i]) + "}";
      s += ",\"clips\":[" + x.ordner.clip(("c" + std::to_string(i + 1)).c_str(), 0.0, 8.0, a, 400000) + "]}";
    }
    return s;
  };
  x.laden2(1, spuren(2, 2), gruppen);
  x.loop(true, 0.0, 8.0);
  x.start(0.0, 0);
  x.teil("grp/1/fader", -6.0f, 2.0, 6.0);   // Rampen: Verlauf je Sample ins Modul
  x.teil("pm/fader", -3.0f, 2.0, 6.0);
  x.teil("grp/2/pan", 0.5f, 2.0, 6.0);
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
  zyklen(1500);
  x.teil("grp/2/mute", 1.0f, 0.0, 0.0);
  x.teil("spur/1/solo", 1.0f, 0.0, 0.0);
  zyklen(500);
  x.laden2(2, spuren(0, 1), gruppen);   // Ziel-Wechsel: Spur 3 nach master, Spur 4 nach Gruppe 1 (Blende 480 Samples)
  zyklen(1000);
  x.teil("grp/2/mute", 0.0f, 0.0, 0.0);
  x.teil("spur/1/solo", 0.0f, 0.0, 0.0);
  zyklen(500);
  x.stopp(0);
  zyklen(200);
  abfang_an();
  void* p = std::malloc(16);
  const long positiv = abfang_aus();
  std::free(p);
  std::printf("arr_gruppen_alloc: %ld Allokationen in %d Zyklen, Positiv-Kontrolle %ld\n", im_zyklus, 3700, positiv);
  PRUEF(positiv >= 1);
  PRUEF(im_zyklus == 0);
  PRUEF(x.wert("grp/1/fader") < -5.0);     // die Rampe lief (liest das Stellwerk, nicht den Mischer: belegt nur, dass die Lage bewegt wurde)
  PRUEF_ENDE();
}
