// D1 K1 Slice 9: Arrangement im Netz-Faden (SCHNITTSTELLEN §4.11, §5.13). /k/arr/laden reiht einen Auftrag zum
// Lade-Faden, dessen Ergebnis wird Befehl ARR_LADEN (mit Zeiger) oder /q 6 mit Grund; Bereichsfehler und KI-Stopp
// (Quelle cypher) lehnt schon das Netz ab; start, stopp, loop, metronom gehen als Befehl durch; /k/arr/freeze ohne
// Arbeitsordner ist datei_fehlt (Paket K3, test_netz_arr_freeze); ARR_ALT geht an den Lade-Faden zurück; ARR_ZUSTAND
// wird /zustand/arr; /erz/strom auf erz/4 ist reserviert.
// Mutation: ARR_ERZ4_FREI (kein Riegel) macht Fall 7 rot.
#include <cstdio>
#include <cstring>
#include <memory>

#include "arr_datei.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;

int main() {
  arrdatei::Ordner o("test_netz_arr");
  const std::string a = o.audio('a', 48000);
  o.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}");
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  auto ringe = std::make_unique<cdj::ArrLaderRinge>();
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
  cdj::Befehl b;
  {
    cdj::Netz netz(0, false, bef.get(), ere.get());
    netz.verbinde_arr(ringe.get());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    auto laden = [&](int64_t id, const char* quelle, int32_t nr) {
      cdj::osc::Schreiber s(v::k_arr_laden);
      s.h(id).s(quelle).i(nr);
      netz.paket(s.daten(), s.groesse());
    };
    // 1: gute Wiedergabe: Auftrag, Lade-Faden, Ergebnis -> Befehl ARR_LADEN mit Zeiger und nr
    laden(71, "andreas", 1);
    PRUEF(!bef->hole(b));   // das Netz lädt nicht selbst
    PRUEF(lader.einmal(*ringe));
    netz.ereignisse_senden();
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_LADEN && b.id == 71 && b.arr_nr == 1 && b.zeiger);
    cdj::ArrSnapshot* snap = static_cast<cdj::ArrSnapshot*>(const_cast<void*>(b.zeiger));
    PRUEF(snap && snap->nr == 1 && snap->spur[0].n_clips == 1);
    // 2: fehlende Datei: /q 6 datei_fehlt, kein Befehl
    laden(72, "andreas", 99);
    lader.einmal(*ringe);
    netz.ereignisse_senden();
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 72 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "datei_fehlt"));
    PRUEF(!bef->hole(b));
    // 3: ARR_ALT geht an den Lade-Faden zurück, der gibt frei
    cdj::Ereignis alt{};
    alt.art = cdj::Ereignis::ARR_ALT;
    alt.zeiger = snap;
    PRUEF(ere->schiebe(alt));
    netz.ereignisse_senden();
    PRUEF(konto.gesperrt() == 48000 * 8 + cdj::arr_audio_kopf() + snap->gesperrt_bytes);   // Audio (Daten, Kopf) und Schnappschuss
    lader.einmal(*ringe);
    PRUEF(konto.gesperrt() == 0 && lader.cache().eintraege() == 0);
    // 4: start, stopp, loop, metronom als Befehl; Bereichsfehler als /q 6
    {
      cdj::osc::Schreiber s(v::k_arr_start);
      s.h(73).s("cypher").d(4.0).i(2);
      netz.paket(s.daten(), s.groesse());
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_START && b.ab_beat == 4.0 && b.politik == 2 && !std::strcmp(b.quelle, "cypher"));
      cdj::osc::Schreiber t(v::k_arr_stopp);
      t.h(74).s("andreas").i(1);
      netz.paket(t.daten(), t.groesse());
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_STOPP && b.politik == 1);
      cdj::osc::Schreiber l(v::k_arr_loop);
      l.h(75).s("andreas").i(1).d(0.0).d(32.0);
      netz.paket(l.daten(), l.groesse());
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_LOOP && b.an == 1 && b.arr_von == 0.0 && b.arr_bis == 32.0);
      cdj::osc::Schreiber m(v::k_arr_metronom);
      m.h(76).s("andreas").i(1).f(-12.0f).i(1);
      netz.paket(m.daten(), m.groesse());
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_METRONOM && b.an == 1 && b.wert == -12.0f && b.nr == 1);
      cdj::osc::Schreiber f1(v::k_arr_start);
      f1.h(77).s("andreas").d(-1.0).i(0);
      netz.paket(f1.daten(), f1.groesse());
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 77 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
      cdj::osc::Schreiber f2(v::k_arr_loop);
      f2.h(78).s("andreas").i(1).d(4.0).d(4.5);
      netz.paket(f2.daten(), f2.groesse());
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 78 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
      cdj::osc::Schreiber f3(v::k_arr_metronom);
      f3.h(79).s("andreas").i(1).f(-61.0f).i(0);
      netz.paket(f3.daten(), f3.groesse());
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 79 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
      PRUEF(!bef->hole(b));
    }
    // 5: KI-Stopp: /k/arr/laden von cypher lehnt schon das Netz ab, von andreas nicht
    {
      cdj::Ereignis ki{};
      ki.art = cdj::Ereignis::KI;
      ki.status = 1;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
      laden(80, "cypher", 1);
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 80 && !std::strcmp(g.s(5), "ki_gestoppt"));
      cdj::ArrAuftrag x;
      PRUEF(!ringe->auftraege.hole(x));
      laden(81, "andreas", 1);
      PRUEF(ringe->auftraege.hole(x) && x.id == 81);
    }
    // 6: /k/arr/freeze ohne Arbeitsordner: datei_fehlt, kein Auftrag (Paket K3); /zustand/arr aus ARR_ZUSTAND
    {
      cdj::osc::Schreiber s(v::k_arr_freeze);
      s.h(82).s("andreas").i(1).d(0.0).d(4.0).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 82 && !std::strcmp(g.s(5), "datei_fehlt"));
      cdj::ArrAuftrag fa;
      PRUEF(!ringe->auftraege.hole(fa));
      cdj::Ereignis z{};
      z.art = cdj::Ereignis::ARR_ZUSTAND;
      z.arr_nr = 17;
      z.arr_status = 2;
      z.arr_loop_an = 1;
      z.arr_beat = 3.5;
      z.arr_ursprung = 90000;
      z.arr_start_beat = 0.0;
      z.arr_metronom_an = 0;
      PRUEF(ere->schiebe(z));
      netz.ereignisse_senden();
      PRUEF(g.warte("/zustand/arr", 200) && g.m.werte[0].i == 17 && g.m.werte[1].i == 2 && g.m.werte[2].i == 1 &&
            g.m.werte[3].d == 3.5 && g.m.werte[4].h == 90000 && g.m.werte[6].i == 0);
    }
    // 7: /erz/strom auf erz/4: reserviert; erz/5 mit unbekanntem Kit: pruefung (Negativ-Kontrolle)
    {
      cdj::osc::Schreiber s(v::erz_strom);
      s.h(83).s("andreas").i(5).s("kit:gibtsnicht").s("erz/4");
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 83 && !std::strcmp(g.s(5), "reserviert"));
      cdj::osc::Schreiber t(v::erz_strom);
      t.h(84).s("andreas").i(5).s("kit:gibtsnicht").s("erz/5");
      netz.paket(t.daten(), t.groesse());
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 84 && !std::strcmp(g.s(5), "pruefung"));
    }
    // 8: K1-Fix 9: ein Ergebnis ohne Schnappschuss mit Grund zu_spaet (Ergebnisring war 1 s voll) wird /q 4 zu_spaet;
    // Negativ-Kontrolle: ein anderer Grund bleibt /q 6
    {
      cdj::ArrErgebnis e{};
      e.auftrag.id = 85;
      std::snprintf(e.auftrag.quelle, sizeof e.auftrag.quelle, "andreas");
      std::snprintf(e.grund, sizeof e.grund, "zu_spaet");
      PRUEF(ringe->ergebnisse.schiebe(e));
      netz.ereignisse_senden();
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 85 && g.m.werte[2].i == 4 && !std::strcmp(g.s(5), "zu_spaet"));
      e.auftrag.id = 86;
      std::snprintf(e.grund, sizeof e.grund, "format");
      PRUEF(ringe->ergebnisse.schiebe(e));
      netz.ereignisse_senden();
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 86 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "format"));
    }
  }
  PRUEF_ENDE();
}
