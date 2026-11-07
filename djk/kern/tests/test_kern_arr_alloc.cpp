// D1 K1 Slice 11 (A10, L5): kein malloc im Kern-Zyklus mit spielendem Arrangement. Drei Spuren (Audio-Clips, interne
// und Wirt-Noten an Prüfsenken), Loop-Klammer mit Nähten, Metronom, eine Fader-Rampe über das Stellwerk (Verlauf je
// Sample), ein Tausch der Wiedergabe mitten im Lauf (Ausklang, Noten-Offs), Stopp. Gezählt wird nur in kern->zyklus()
// (alloc_abfang.h, thread_local); der Schnappschuss entsteht außerhalb. Positiv-Kontrolle: ein malloc wird gezählt.
// Unter ASan/TSan fehlt der Abfang: dann „übersprungen“, nie „bestanden“.
// 1.10 slice 5 U2b: a second phase counts the cycles of a project in which EVERY kind of sidechain key is active (row sc, track post, group pre and post, return pre and post, deck/1, erz/1) with latency stages in
// front of the keyed stages, so that the key rings run: the cycles allocate nothing either (the rings are built in the constructor of ArrInserts).
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

  {  // slice 5 U2b: all key kinds active
    arr35::Lauf y(ab.pfad, "test_kern_arr_alloc_schluessel");
    const std::string au = y.ordner.audio('b', 200000, 0.25f);
    const auto stufe = [](const std::string& art, int slot, const std::string& key = "") {
      return "{\"art\":\"" + art + "\",\"slot\":" + std::to_string(slot) + (key.empty() ? "" : ",\"key\":" + key) + "}";
    };
    const auto key = [](const std::string& q, int nr, const char* punkt = "post") { return "{\"q\":\"" + q + "\",\"nr\":" + std::to_string(nr) + ",\"punkt\":\"" + punkt + "\"}"; };
    const auto spur = [&](int nr, const std::string& kette, int gruppe = 0) {
      return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" + y.ordner.clip(("k" + std::to_string(nr)).c_str(), 0.0, 8.0, au, 200000) + "]" +
             (gruppe ? ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + std::to_string(gruppe) + "}" : "") + (kette.empty() ? "" : ",\"chain\":[" + kette + "]") + "}";
    };
    // komp slots (1-based in the rows): 1 track 1 keyed by track 2 post, 2 track 3 by deck/1, 3 track 4 by erz/1, 4 track 5 by the row sc = 2, 5 group 1 by track 2 post, 6 return 1 by group 1 post,
    // 7 PM by return 1 post, 8 PM by group 1 pre. The eq on track 6 and the saturator in the group chain make the largest path latency non-zero, so the rings of the late stages run.
    const std::string spuren_j = spur(1, stufe("eq", 1) + "," + stufe("komp", 1, key("spur", 2))) + "," + spur(2, "") + "," + spur(3, stufe("komp", 2, key("deck", 1))) + "," +
                                 spur(4, stufe("komp", 3, key("erz", 1))) + "," + spur(5, stufe("komp", 4)) + "," + spur(6, "", 1);
    const std::string gruppen_j = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"chain\":[" + stufe("saett", 1) + "," + stufe("komp", 5, key("spur", 2)) + "]}";
    const std::string returns_j = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"chain\":[" + stufe("komp", 6, key("grp", 1)) + "]}";
    const std::string pm_j = "{\"chain\":[" + stufe("komp", 7, key("ret", 1)) + "," + stufe("komp", 8, key("grp", 1, "pre")) + "]}";
    y.ordner.roh(7, "{\"format\":\"cypherdj-arr/2\",\"nr\":7,\"spuren\":[" + spuren_j + "],\"gruppen\":[" + gruppen_j + "],\"returns\":[" + returns_j + "],\"pm\":" + pm_j + "}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(y.ordner.pfad, 7, y.cache);
    if (!e.snap) std::printf("arr_alloc: the key project did not load: %s %s\n", e.grund.c_str(), e.meldung.c_str());
    PRUEF(e.snap != nullptr);
    if (e.snap) {
      PRUEF(e.snap->pdc.gesamt > 0);   // the delay compensation is active: some path has a latency
      cdj::Befehl b = y.neu(cdj::Befehl::ARR_LADEN, "andreas");
      b.zeiger = e.snap.release();
      b.arr_nr = 7;
      y.sende(b);
    }
    for (int sl = 1; sl <= 8; ++sl) {
      const std::string p = "ins/komp/" + std::to_string(sl) + "/";
      y.teil((p + "an").c_str(), 1.0f, 0.0, 0.0);
      y.teil((p + "schwelle").c_str(), -30.0f, 0.0, 0.0);
      y.teil((p + "ratio").c_str(), 8.0f, 0.0, 0.0);
      y.teil((p + "mix").c_str(), 1.0f, 0.0, 0.0);
    }
    y.teil("ins/komp/4/sc", 2.0f, 0.0, 0.0);   // the row key of the fifth strip
    y.teil("spur/1/send/1", 0.0f, 0.0, 0.0);   // the return computes: a send into it
    y.teil("spur/2/send/1", 0.0f, 0.0, 0.0);
    y.start(0.0, 0);
    y.lauf(4 * N);
    long j_zyklus = 0;
    for (int i = 0; i < 2500; ++i) {
      const int64_t n0 = y.kern->sample();
      abfang_an();
      y.kern->zyklus(N, n0 * 20833);
      j_zyklus += abfang_aus();
      cdj::Ereignis ev;
      while (y.ere->hole(ev))
        if (ev.art == cdj::Ereignis::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(ev.zeiger)), y.cache);
    }
    int aktiv = 0, laeuft = 0;
    for (int sl = 0; sl < 8; ++sl) {
      if (y.kern->arrangement().inserts().strukturell(sl) || sl == 3) ++aktiv;
      if (y.kern->arrangement().inserts().lief(sl)) ++laeuft;
    }
    std::printf("arr_alloc: all key kinds: %ld allocations in 2500 cycles, %d of 8 key stages listening, %d running, largest path latency %d samples\n", j_zyklus, aktiv, laeuft,
                y.kern->arrangement().pdc_latenz());
    PRUEF(aktiv == 8);   // the project exercised all eight keys (seven structural, one row)
    PRUEF(laeuft >= 7);
    PRUEF(y.kern->arrangement().pdc_latenz() > 0);
    PRUEF(j_zyklus == 0);
    y.stopp(0);
    y.lauf(y.kern->sample() + 8 * N);
  }
  PRUEF_ENDE();
}
