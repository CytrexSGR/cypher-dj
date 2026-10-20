// Paket K3 (Spec D1 2.5, 3.1, 6.14, 6.25, 6.27, 6.29): /k/arr/freeze über Netz-Faden und Arrangement-Lade-Faden. Das
// Netz prüft die Anfrage und reiht einen Auftrag zum Lade-Faden; der legt den Auftrag samt Puffer an (Kapazität für
// 60 BPM plus Nachlauf), das Netz gibt ihn als Befehl ARR_FREEZE in den Kern. Die Rückgabe ARR_FREEZE geht vom Netz an
// den Lade-Faden zurück: fertig schreibt er <arr_ordner>/freeze-<spur>-<kennung>.f32 (frames · 8 Bytes, keine Temp-Datei
// übrig, nie ersetzt), das Netz meldet /e/freeze 0 mit frames; abgebrochen /e/freeze 1 ohne Datei; Schreibfehler oder
// schon vorhandene Datei /e/freeze 2; abgelehnt nichts. Das Netz selbst legt keinen Puffer an und schreibt keine Datei.
// Bereichsfehler, KI-Stopp (cypher, vor der Bereichsprüfung, §4.7) und fehlender Arbeitsordner als /q 6.
// Mutation: ARR_FREEZE_ABBRUCH_SCHREIBT (Fall 6 rot: ein abgebrochener Freeze wird Datei).
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;

namespace {

cdj::Ereignis rueckgabe(cdj::ArrFreeze* f, int32_t status) {
  cdj::Ereignis e{};
  e.art = cdj::Ereignis::ARR_FREEZE;
  e.status = status;
  e.zeiger = f;
  return e;
}

std::vector<float> lies(const std::string& datei, size_t n) {
  std::vector<float> d(n);
  std::ifstream(datei, std::ios::binary).read(reinterpret_cast<char*>(d.data()), static_cast<std::streamsize>(n * 4));
  return d;
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_netz_arr_freeze");
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  auto ringe = std::make_unique<cdj::ArrLaderRinge>();
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
  {
    cdj::Netz netz(0, false, bef.get(), ere.get());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    auto anfrage = [&](int64_t id, const char* quelle, int32_t spur, double von, double bis, int32_t kennung) {
      cdj::osc::Schreiber s(v::k_arr_freeze);
      s.h(id).s(quelle).i(spur).d(von).d(bis).i(kennung);
      netz.paket(s.daten(), s.groesse());
    };
    auto q6 = [&](int64_t id, const char* grund) {
      return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund);
    };
    cdj::Befehl b;
    cdj::ArrAuftrag au;
    // 1: ohne Lade-Faden und ohne Arbeitsordner: datei_fehlt, kein Befehl, kein Auftrag
    anfrage(90, "andreas", 1, 0.0, 4.0, 1);
    PRUEF(q6(90, "datei_fehlt") && !bef->hole(b));
    netz.verbinde_arr(ringe.get());
    anfrage(89, "andreas", 1, 0.0, 4.0, 1);
    PRUEF(q6(89, "datei_fehlt") && !bef->hole(b) && !ringe->auftraege.hole(au));
    netz.setze_arr_ordner(o.pfad);
    // 2: gute Anfrage: das Netz reiht nur einen Auftrag (kein Puffer, kein Befehl); der Lade-Faden legt ihn an
    //    (Kapazität (4 + 2) · 48 000 + 2 Frames), dann gibt das Netz ihn als Befehl ARR_FREEZE in den Kern
    anfrage(91, "andreas", 2, 4.0, 8.0, 17);
    PRUEF(!bef->hole(b));
    PRUEF(lader.einmal(*ringe));
    netz.ereignisse_senden();
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_FREEZE && b.id == 91 && b.nr == 2 && b.zeiger);
    PRUEF(!std::strcmp(b.quelle, "andreas"));
    cdj::ArrFreeze* f = static_cast<cdj::ArrFreeze*>(const_cast<void*>(b.zeiger));
    PRUEF(f->spur == 2 && f->kennung == 17 && f->von_beat == 4.0 && f->bis_beat == 8.0);
    PRUEF(f->kap == 6 * 48000 + 2 && f->daten.size() == static_cast<size_t>(f->kap) * 2);
    // 3: Bereichsfehler: Spur 0 und 9, bis − von < 1 und > 256, kennung < 0, von < 0, NaN
    anfrage(92, "andreas", 0, 0.0, 4.0, 1);
    PRUEF(q6(92, "ausserhalb_bereich"));
    anfrage(93, "andreas", 9, 0.0, 4.0, 1);
    PRUEF(q6(93, "ausserhalb_bereich"));
    anfrage(94, "andreas", 1, 0.0, 0.5, 1);
    PRUEF(q6(94, "ausserhalb_bereich"));
    anfrage(95, "andreas", 1, 0.0, 257.0, 1);
    PRUEF(q6(95, "ausserhalb_bereich"));
    anfrage(96, "andreas", 1, 0.0, 4.0, -1);
    PRUEF(q6(96, "ausserhalb_bereich"));
    anfrage(97, "andreas", 1, -1.0, 4.0, 1);
    PRUEF(q6(97, "ausserhalb_bereich"));
    anfrage(98, "andreas", 1, 0.0, std::nan(""), 1);
    PRUEF(q6(98, "ausserhalb_bereich"));
    anfrage(88, "fremd", 1, 0.0, 4.0, 1);
    PRUEF(q6(88, "ausserhalb_bereich"));
    PRUEF(!ringe->auftraege.hole(au) && !bef->hole(b));
    // 4: KI-Stopp: cypher abgelehnt, vor der Bereichsprüfung (§4.7, Spec 6.27); andreas nicht
    {
      cdj::Ereignis ki{};
      ki.art = cdj::Ereignis::KI;
      ki.status = 1;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
      anfrage(99, "cypher", 1, 0.0, 4.0, 1);
      PRUEF(q6(99, "ki_gestoppt"));
      anfrage(87, "cypher", 1, 0.0, 0.5, 1);   // ungültig und im KI-Stopp: ki_gestoppt zuerst
      PRUEF(q6(87, "ki_gestoppt"));
      PRUEF(!ringe->auftraege.hole(au));
      anfrage(100, "andreas", 1, 0.0, 4.0, 1);
      PRUEF(ringe->auftraege.hole(au) && au.id == 100 && au.art == cdj::ArrAuftrag::FREEZE && au.spur == 1);
      ki.status = 0;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
    }
    // 5: fertig: der Lade-Faden schreibt die Datei (frames · 8 Bytes, Inhalt, keine Temp-Datei), dann /e/freeze 0
    f->frames = 1000;
    for (int64_t i = 0; i < 2 * f->frames; ++i) f->daten[static_cast<size_t>(i)] = static_cast<float>(i) * 0.001f;
    PRUEF(ere->schiebe(rueckgabe(f, 0)));
    netz.ereignisse_senden();
    const std::string datei = o.pfad + "/freeze-2-17.f32";
    PRUEF(!std::filesystem::exists(datei));   // das Netz schreibt nicht selbst (Spec 6.29)
    PRUEF(!g.warte("/e/freeze", 20));
    PRUEF(lader.einmal(*ringe));
    netz.ereignisse_senden();
    PRUEF(g.warte("/e/freeze", 200) && g.m.werte[0].i == 2 && g.m.werte[1].i == 17 && g.m.werte[2].i == 0 &&
          g.m.werte[3].h == 1000);
    PRUEF(cdj::freeze_datei(o.pfad, 2, 17) == datei);
    PRUEF(std::filesystem::exists(datei) && std::filesystem::file_size(datei) == 1000 * 8);
    {
      const std::vector<float> d = lies(datei, 2000);
      PRUEF(d[0] == 0.0f && d[1999] == 1999 * 0.001f);
    }
    size_t teile = 0;
    for (const auto& e : std::filesystem::directory_iterator(o.pfad))
      teile += e.path().string().find(".teil") != std::string::npos;
    PRUEF(teile == 0);
    // 6: abgebrochen: /e/freeze 1, frames 0, keine Datei
    auto a = std::make_unique<cdj::ArrFreeze>();
    a->spur = 3;
    a->kennung = 4;
    a->frames = 500;
    a->daten.assign(1000, 0.5f);
    PRUEF(ere->schiebe(rueckgabe(a.release(), 1)));
    netz.ereignisse_senden();
    lader.einmal(*ringe);
    netz.ereignisse_senden();
    PRUEF(g.warte("/e/freeze", 200) && g.m.werte[0].i == 3 && g.m.werte[2].i == 1 && g.m.werte[3].h == 0);
    PRUEF(!std::filesystem::exists(o.pfad + "/freeze-3-4.f32"));
    // 7: abgelehnt: kein /e/freeze (nur freigeben, im Lade-Faden)
    auto r = std::make_unique<cdj::ArrFreeze>();
    PRUEF(ere->schiebe(rueckgabe(r.release(), cdj::ARR_FREEZE_ABGELEHNT)));
    netz.ereignisse_senden();
    lader.einmal(*ringe);
    netz.ereignisse_senden();
    PRUEF(!g.warte("/e/freeze", 50));
    // 8: Schreibfehler (Ordner fehlt): /e/freeze 2
    {
      cdj::ArrLader weg(o.pfad + "/gibtsnicht", &konto, 50LL << 20, false);
      auto w = std::make_unique<cdj::ArrFreeze>();
      w->spur = 1;
      w->kennung = 1;
      w->frames = 10;
      w->daten.assign(20, 0.0f);
      PRUEF(ere->schiebe(rueckgabe(w.release(), 0)));
      netz.ereignisse_senden();
      weg.einmal(*ringe);
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/freeze", 200) && g.m.werte[2].i == 2 && g.m.werte[3].h == 0);
    }
    // 9: Spec 6.25: die Datei gibt es schon (freeze-2-17.f32 aus Fall 5): nie still ersetzt, /e/freeze 2, keine
    //    Temp-Datei übrig, der Inhalt bleibt der alte
    {
      auto z = std::make_unique<cdj::ArrFreeze>();
      z->spur = 2;
      z->kennung = 17;
      z->frames = 1000;
      z->daten.assign(2000, 0.75f);
      PRUEF(ere->schiebe(rueckgabe(z.release(), 0)));
      netz.ereignisse_senden();
      lader.einmal(*ringe);
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/freeze", 200) && g.m.werte[0].i == 2 && g.m.werte[1].i == 17 && g.m.werte[2].i == 2 &&
            g.m.werte[3].h == 0);
      const std::vector<float> d = lies(datei, 2000);
      PRUEF(std::filesystem::file_size(datei) == 1000 * 8 && d[0] == 0.0f && d[1999] == 1999 * 0.001f);
      size_t teile2 = 0;
      for (const auto& e : std::filesystem::directory_iterator(o.pfad))
        teile2 += e.path().string().find(".teil") != std::string::npos;
      PRUEF(teile2 == 0);
    }
    // 10: Befehlsring voll: der Auftrag geht an den Lade-Faden zurück und wird dort freigegeben (kein Leck), /q 4
    {
      cdj::Befehl fuell{};
      fuell.art = cdj::Befehl::ARR_STOPP;
      while (bef->schiebe(fuell)) {
      }
      anfrage(101, "andreas", 1, 0.0, 4.0, 5);
      lader.einmal(*ringe);
      netz.ereignisse_senden();   // einreihen wartet bis 100 ms, dann zu_spaet
      PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 101 && g.m.werte[2].i == 4);
      cdj::ArrFreeze* zurueck = nullptr;
      PRUEF(ringe->freeze_zurueck.hole(zurueck) && zurueck && zurueck->kennung == 5 &&
            zurueck->status == cdj::ARR_FREEZE_ABGELEHNT);
      delete zurueck;
      while (bef->hole(b)) {
      }
    }
  }
  PRUEF_ENDE();
}
