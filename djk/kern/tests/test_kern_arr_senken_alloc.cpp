// D1 K2b (A10, L5): kein malloc im Kern-Zyklus mit den Senken, die der Kern selbst anlegt: RB-338 für die interne Spur
// (mit Parametern, Tausch mitten im Lauf mit neuem cutoff), Wirt-Slot 1 mit Rückweg-Puffer und Messpunkt A4, Loop-Klammer
// mit Nähten, Stopp. Gezählt wird nur in kern->zyklus() (alloc_abfang.h, thread_local); seit K3 Fix L2 auch free,
// blockierende Sperren und Schlafen. Positiv-Kontrolle abfang_gegenprobe(): je Art ein Aufruf wird gezählt; es lief wirklich etwas: MIDI am Wirt-Slot und Pegel der internen Spur über −60 dB.
// Fix F5: auch unter dem Wächter laufen der Start-Pfad (vorgaben, setze, zuruecksetzen, alle_aus im Block des Einsatzes;
// Beleg: Quittung 2 des Starts), ein Neustart im Lauf mit Kurzblende (Quittung 2 des Neustarts; eine lange Note klingt),
// die Ruhe nach dem Stopp (über 1 s exakte Stille; Beleg: ruhend() von 7 auf 8) und der Spurwechsel aus Fix F2 (intern und
// wirt werden leer; Beleg: ruhend() 8 und CC 123 am Slot). K2b-Rest (a, b): zwei Tausche vor demselben Block, Spur 3
// wirt -> intern -> leer (zwei verlassene Senken für eine Spur) und Spur 2 intern -> leer -> intern (die RB rechnet den
// alten Ausklang und die zurückgekehrte Spur im selben Block); Beleg: CC 123 am Slot, Pegel spur/2 danach über −60 dB.
// Unter ASan/TSan fehlt der Abfang: dann „übersprungen“, nie „bestanden“.
#include <cstdlib>
#include <cstring>
#include <vector>

#include "arr_lauf.h"
#include "alloc_abfang.h"   // zuletzt: ersetzt malloc und Verwandte (wie test_kern_arr_alloc)

bool g_waechter = false;

using k35::N;

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("übersprungen (Sanitizer-Bau): Allokationswächter nicht verfügbar\n");
    return 0;
  }
  k35::Arbeitsbestand ab("test_kern_arr_senken_alloc");
  arr35::Lauf x(ab.pfad, "test_kern_arr_senken_alloc");
  std::string noten;
  for (int i = 0; i < 16; ++i)
    noten += (i ? "," : "") + std::string("{\"id\":\"n/") + std::to_string(i) + "\",\"beat\":" + std::to_string(i / 2) +
             (i % 2 ? ".5" : ".0") + ",\"laenge\":0.25,\"ton\":" + std::to_string(36 + i) + ",\"vel\":100}";
  noten += ",{\"id\":\"n/lang\",\"beat\":0.0,\"laenge\":8.0,\"ton\":30,\"vel\":120}";   // klingt beim Neustart
  auto spuren = [&](const char* cutoff) {
    return std::string("{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":") + cutoff +
           ",\"env_mod\":0.7},\"noten\":[" + noten + "]}," + "{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[" + noten + "]}";
  };
  x.laden(1, spuren("0.3"));
  x.loop(true, 0.0, 8.0);
  x.lauf(4 * N);   // Laden und Klammer außerhalb des Wächters (Befehle aus dem Netz, nicht der Pfad im Zyklus)
  std::vector<float> rl(N, 0.0f), rr(N, 0.0f);
  rl[10] = rr[10] = 0.5f;   // Rückweg mit Inhalt: Kopie und Messpunkt laufen
  AbfangZahlen im_zyklus;
  int n_zyklen = 0;
  uint64_t midi = 0, pegel = 0, cc123 = 0;
  std::vector<std::pair<int64_t, int32_t>> quittungen;
  auto zyklen = [&](int n) {
    for (int i = 0; i < n; ++i) {
      const int64_t n0 = x.kern->sample();
      x.kern->arr_rueck(1, rl.data(), rr.data());
      abfang_an();
      x.kern->zyklus(N, n0 * 20833);
      abfang_aus();
      im_zyklus += abfang_zahlen();
      ++n_zyklen;
      const cdj::MidiAus& m = x.kern->arr_midi_aus(1);
      midi += static_cast<uint64_t>(m.n);
      for (int j = 0; j < m.n; ++j) cc123 += (m.ev[j].b[0] == 0xB0 && m.ev[j].b[1] == 123) ? 1 : 0;
      cdj::Ereignis e;
      while (x.ere->hole(e)) {
        if (e.art == cdj::Ereignis::ARR_ALT)
          cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), x.cache);
        if (e.art == cdj::Ereignis::PEGEL && !std::strcmp(e.pfad, "spur/2") && e.pegel[0] > -60.0f) ++pegel;
        if (e.art == cdj::Ereignis::QUITTUNG) quittungen.push_back({e.id, e.status});
      }
      cdj::ArrWirtMessung m4;
      while (x.kern->arr_wirt_messung(1, m4)) {}
    }
  };
  auto quittung = [&](int64_t id, int32_t st) {
    for (const auto& [i, s] : quittungen)
      if (i == id && s == st) return true;
    return false;
  };
  const int64_t st1 = x.start(0.0, 0);   // Start-Pfad unter dem Wächter: Einsatz nach 537 + 256 Samples
  zyklen(10);
  const bool start_da = quittung(st1, 2);
  zyklen(3000);              // > 2 Durchläufe der Klammer (8 Beats = 180 000 Samples)
  x.laden(2, spuren("0.8"));   // Tausch: neue Parameter, Noten bleiben
  zyklen(1000);
  const int64_t st2 = x.start(0.0, 0);   // Neustart im Lauf: Kurzblende im Block vor dem Einsatz, dann Start-Pfad
  zyklen(10);
  const bool neustart_da = quittung(st2, 2);
  zyklen(500);
  const int ruhend_lauf = x.kern->arr_rb().ruhend();
  x.stopp(0);
  zyklen(800);               // 4,3 s: Ausklang, dann 1 s exakte Stille, dann setzt die Senke zurück
  const int ruhend_stopp = x.kern->arr_rb().ruhend();
  const int64_t st3 = x.start(0.0, 0);
  zyklen(200);
  const int ruhend_vor_wechsel = x.kern->arr_rb().ruhend();
  const uint64_t cc_vor = cc123;
  x.laden(3, "");            // Spurwechsel (Fix F2): beide Spuren werden leer, RB blendet aus, Slot 1 bekommt CC 123
  zyklen(10);
  const int ruhend_wechsel = x.kern->arr_rb().ruhend();
  x.laden(4, spuren("0.5"));   // K2b-Rest: wieder beide Spuren, Start
  x.lauf(x.kern->sample() + 4 * N);
  const int64_t st4 = x.start(0.0, 0);
  zyklen(400);
  const uint64_t cc_vor2 = cc123, pegel_vor2 = pegel;
  x.laden(5, std::string("{\"nr\":3,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]}"));   // 2 leer, 3 intern
  x.laden(6, std::string("{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5,"
                         "\"env_mod\":0.7},\"noten\":[") + noten + "]}");                                  // 2 zurück, 3 leer
  zyklen(400);
  const uint64_t cc_doppel = cc123 - cc_vor2, pegel_doppel = pegel - pegel_vor2;
  const AbfangZahlen positiv = abfang_gegenprobe();
  std::printf("senken_alloc: %ld Allokationen, %ld free, %ld Sperren, %ld Schlafen in %d Zyklen, Gegenprobe %ld/%ld/%ld/%ld, MIDI %llu, Pegel spur/2 %llu, RB verloren %llu"
              " | Start %d, Neustart %d, ruhend im Lauf %d, nach Stopp und Ruhe %d, vor dem Wechsel %d, nach dem Wechsel %d,"
              " CC 123 beim Wechsel %llu | Doppeltausch: CC 123 %llu, Pegel spur/2 %llu\n",
              im_zyklus.alloc, im_zyklus.frei, im_zyklus.sperren, im_zyklus.schlafen, n_zyklen, positiv.alloc, positiv.frei,
              positiv.sperren, positiv.schlafen, (unsigned long long)midi, (unsigned long long)pegel,
              (unsigned long long)x.kern->arr_rb().verloren(), start_da, neustart_da, ruhend_lauf, ruhend_stopp,
              ruhend_vor_wechsel, ruhend_wechsel, (unsigned long long)(cc_vor2 - cc_vor), (unsigned long long)cc_doppel,
              (unsigned long long)pegel_doppel);
  PRUEF(positiv.alloc == 1 && positiv.frei == 1 && positiv.sperren == 4 && positiv.schlafen == 2);   // je Aufruf genau einmal
  PRUEF(im_zyklus.alloc == 0 && im_zyklus.frei == 0 && im_zyklus.sperren == 0 && im_zyklus.schlafen == 0);
  PRUEF(midi > 100 && pegel > 100);   // es lief wirklich etwas
  PRUEF(x.kern->arr_rb().verloren() == 0);
  PRUEF(start_da && neustart_da);     // Start-Pfad und Neustart mit Kurzblende liefen im Zyklus unter dem Wächter
  PRUEF(quittung(st3, 2));
  PRUEF(ruhend_lauf == cdj::ARR_SPUREN - 1 && ruhend_stopp == cdj::ARR_SPUREN);   // Ruhe-Reset lief
  PRUEF(ruhend_vor_wechsel == cdj::ARR_SPUREN - 1 && ruhend_wechsel == cdj::ARR_SPUREN);   // Spurwechsel lief
  PRUEF(cc_vor2 - cc_vor >= 1);
  PRUEF(quittung(st4, 2) && cc_doppel >= 1 && pegel_doppel > 20);   // Doppeltausch lief unter dem Wächter
  PRUEF_ENDE();
}
