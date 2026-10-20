// D1 K1 Slice 11 (A10, L5): kein malloc im Kern-Zyklus mit spielendem Arrangement. Drei Spuren (Audio-Clips, interne
// und Wirt-Noten an Prüfsenken), Loop-Klammer mit Nähten, Metronom, eine Fader-Rampe über das Stellwerk (Verlauf je
// Sample), ein Tausch der Wiedergabe mitten im Lauf (Ausklang, Noten-Offs), Stopp. Gezählt wird nur in kern->zyklus()
// (alloc_abfang.h, thread_local); der Schnappschuss entsteht außerhalb. Positiv-Kontrolle: ein malloc wird gezählt.
// Unter ASan/TSan fehlt der Abfang: dann „übersprungen“, nie „bestanden“.
#include <cstdlib>

#include "arr_bau.h"
#include "arr_lauf.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte (wie test_loopbox_keylock)

bool g_waechter = false;

using k35::N;

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("übersprungen (Sanitizer-Bau): Allokationswächter nicht verfügbar\n");
    return 0;
  }
  k35::Arbeitsbestand ab("test_kern_arr_alloc");
  arr35::Lauf x(ab.pfad, "test_kern_arr_alloc");
  arrtest::PruefSenke rb(0), wirt(2 * N + 25);
  x.kern->setze_arr_senke_intern(&rb);
  x.kern->setze_arr_senke_wirt(1, &wirt);
  const std::string a = x.ordner.audio('a', 200000, 0.25f);
  std::string noten;
  for (int i = 0; i < 16; ++i)
    noten += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i * 0.5) +
             ",\"laenge\":0.25,\"ton\":" + std::to_string(36 + i) + ",\"vel\":100}";
  auto spuren = [&](double c2) {
    return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x.ordner.clip("c1", 0.0, 2.0, a, 200000) + "," +
           x.ordner.clip("c2", c2, 1.0, a, 200000) + "]}," + "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[" +
           noten + "]}," + "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten + "]}";
  };
  x.laden(1, spuren(4.0));
  x.loop(true, 0.0, 8.0);
  x.metronom(true, -12.0f, 0);
  x.start(0.0, 0);
  x.teil("spur/1/fader", -6.0f, 4.0, 4.0);   // Rampe über 4 Beats: Verlauf je Sample ins Modul
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
        if (e.art == cdj::Ereignis::ARR_ALT)
          cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), x.cache);
    }
  };
  zyklen(3000);                  // > 2 Durchläufe der Klammer (8 Beats = 180 000 Samples)
  x.laden(2, spuren(5.0));       // Tausch: c2 verschoben -> Ausklang; Noten bleiben
  zyklen(1000);
  x.stopp(0);
  zyklen(200);
  abfang_an();
  void* p = std::malloc(16);
  const long positiv = abfang_aus();
  std::free(p);
  std::printf("arr_alloc: %ld Allokationen in %d Zyklen, Positiv-Kontrolle %ld, Noten intern %zu, Wirt %zu\n", im_zyklus,
              4200, positiv, rb.ev.size(), wirt.ev.size());
  PRUEF(positiv >= 1);
  PRUEF(im_zyklus == 0);
  PRUEF(rb.ev.size() > 100 && wirt.ev.size() > 100);   // es lief wirklich etwas
  PRUEF_ENDE();
}
