// D1 K1 Slice 8: KI-Stopp und Neustart am Arrangement (Spec D1 2.12, 2.3). Bei KI-Stopp lehnt der Kern /k/arr/laden und
// /k/arr/start der Quelle cypher ab (ki_gestoppt; der Schnappschuss geht als ARR_ALT zurück), Andreas lädt und startet
// weiter; ein KI-Stopp beendet einen LAUFENDEN Transport nicht, auch keinen von cypher gestarteten (Entscheidung E-a, 2026-10-20, Andreas: „was klingt,
// klingt weiter“; vorher Spec 2.12 beendete er Cyphers Transport, Fälle 2 und 5). Was noch nicht klingt, verwirft er weiter: Cyphers wartenden Start (Fall 9,
// 7 ki_stopp) und ihren Freeze (test_kern_arr_freeze Fall 3). Neustart-Zustand: spur/<n>/* kommen wieder, das Arrangement nicht.
// Entscheidung E-a (2026-10-20): ein KI-Stopp senkt keinen Fader mehr (vorher: spur/<n> in der KI-Spur fiel über 4 Beats auf −200).
// Spec 6.15, E3 P1 (Fälle 3, 5, 6): der Leitstand trägt Kanäle in die KI-Spur ein, S2 sendet nur spur/0, jede andere Spur-Angabe wird abgelehnt; die
// Kanal-Liste wird geführt und steht im Neustart-Zustand (Fälle 3, 6); der Stopp senkt keinen Fader, Cyphers Transport läuft weiter (Fall 5).
// Spec 6.27 (Fall 7, K1-Fix 4): der gemeinsame Fall djk/vertrag/faelle/arr_ki_stopp.json, den auch die Attrappe fährt
// (ki.test.mjs): laden, start, loop, metronom und (Paket K3) freeze von cypher abgelehnt (ki_gestoppt), stopp von cypher
// erlaubt.
// Mutation CYPHERDJ_MUTATION_ARR_KI_NUR_LADEN_START (nur laden und start geprüft, wie vor 6.27) macht Fall 7 rot.
// K1-Fix-2 Punkt 2 (§4.7: der KI-Stopp zuerst, vor jeder Bereichsprüfung): ungültige cypher-Befehle im KI-Stopp enden
// mit ki_gestoppt, nicht ausserhalb_bereich; Fall 7 im Kern allein, Fall 8 durch Netz und Kern wie im Betrieb.
// Mutation CYPHERDJ_MUTATION_ARR_KI_NACH_BEREICH (das Netz prüft den Bereich zuerst, wie vorher) macht Fall 8 rot.
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "arr_lauf.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/netz.h"
#include "cypherdj/zustand.h"
#include "gegenstelle.h"

bool g_waechter = false;

using k35::N;
using cdj::ArrStatus;
using B = cdj::Befehl;
namespace v = cypherdj::osc;

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_ki");
  const std::string spur = "{\"nr\":1,\"art\":\"audio\",\"clips\":[]}";
  {  // 1: KI-Stopp: cypher abgelehnt, andreas nicht
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    x.sende(x.neu(B::KI_STOPP, "andreas"));
    x.lauf(4 * N);
    const int64_t l_cy = x.laden(1, spur, "cypher");
    const int64_t s_cy = x.start(0.0, 0, "cypher");
    x.lauf(5 * N);
    PRUEF(x.quittung(l_cy, 6) && x.quittung(l_cy, 6)->grund == "ki_gestoppt");
    PRUEF(x.quittung(s_cy, 6) && x.quittung(s_cy, 6)->grund == "ki_gestoppt");
    PRUEF(x.alle(cdj::Ereignis::ARR_ALT).size() == 1);   // der abgelehnte Schnappschuss ging zurück
    PRUEF(x.kern->arrangement().snapshot() == nullptr);
    const int64_t l_an = x.laden(2, spur, "andreas");
    const int64_t s_an = x.start(0.0, 0, "andreas");
    x.lauf(10 * N);
    PRUEF(x.quittung(l_an, 3) && x.quittung(s_an, 2));
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
  }
  for (int cy = 0; cy < 2; ++cy) {  // 2: E-a: der KI-Stopp beendet keinen laufenden Transport, auch Cyphers nicht (vorher steht bei cy == 1)
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    x.laden(1, spur);
    x.start(0.0, 0, cy ? "cypher" : "andreas");
    x.lauf(10 * N);
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
    x.sende(x.neu(B::KI_STOPP, "andreas"));
    x.lauf(12 * N);
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
    x.lauf(200 * N);                                       // und bleibt es, bis Andreas stoppt
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
    const int64_t st = x.stopp(0, "andreas");
    x.lauf(x.kern->sample() + 4 * N);
    PRUEF(x.quittung(st, 3) && x.kern->arrangement().status() == ArrStatus::steht);
  }
  {  // 3: KI-Spur mit spur/0 (E3 P1: einzige Spur-Angabe) und Kanal deck/3: angenommen, die Liste im Zustand ist deck/3; spur/2 wird wie ein
     // unbekannter Kanal abgelehnt (Quittung 6 unbekannter_regler, wie erz/9)
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    cdj::Befehl k = x.neu(B::KI_SPUR, "leitstand");
    std::snprintf(k.liste, sizeof k.liste, "deck/3,spur/0");
    x.sende(k);
    x.lauf(10 * N);
    PRUEF(x.quittung(k.id, 3) != nullptr);
    {  // deck/3 steht in der Liste (Neustart-Zustand), spur/0 trägt keinen Spur-Teil bei
      auto fach = std::make_unique<cdj_z_echtzeit>();
      x.kern->abbild(*fach);
      PRUEF(std::strcmp(fach->ki_spur, "deck/3") == 0);
    }
    cdj::Befehl k2 = x.neu(B::KI_SPUR, "leitstand");
    std::snprintf(k2.liste, sizeof k2.liste, "spur/2");
    x.sende(k2);
    cdj::Befehl k9 = x.neu(B::KI_SPUR, "leitstand");
    std::snprintf(k9.liste, sizeof k9.liste, "erz/9");
    x.sende(k9);
    x.lauf(20 * N);
    PRUEF(x.quittung(k2.id, 6) && x.quittung(k2.id, 6)->grund == "unbekannter_regler");
    PRUEF(x.quittung(k9.id, 6) && x.quittung(k9.id, 6)->grund == "unbekannter_regler");
    {  // abgelehnte Listen ändern nichts
      auto fach = std::make_unique<cdj_z_echtzeit>();
      x.kern->abbild(*fach);
      PRUEF(std::strcmp(fach->ki_spur, "deck/3") == 0);
    }
  }
  {  // 4: Neustart-Zustand: Spur-Regler kommen wieder (auch im Modul), das Arrangement nicht
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    x.laden(1, spur);
    x.teil("spur/1/fader", -6.0f, 0.0, 0.0);
    x.teil("spur/1/pan", 0.5f, 0.0, 0.0);
    x.lauf(20 * N);
    auto fach = std::make_unique<cdj_z_echtzeit>();
    x.kern->abbild(*fach);
    arr35::Lauf y(ab.pfad, "test_kern_arr_ki_neu");
    PRUEF(y.kern->wiederherstellen(*fach));
    PRUEF(y.kern->arrangement().wert(0, 0) == -6.0f && y.kern->arrangement().wert(0, 1) == 0.5f);
    PRUEF(y.wert("spur/1/fader") == -6.0);
    PRUEF(y.kern->arrangement().snapshot() == nullptr);   // der Server lädt nach /e/neustart neu (Spec 2.12, S2)
  }
  {  // 5: Leitstand deck/3, S2 spur/0 (spur/1,spur/3 werden abgelehnt, E3 P1), Transport von Cypher; der KI-Stopp senkt keinen dieser Fader (E-a),
     // der Transport von Cypher läuft weiter
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    x.laden(1, spur);
    for (const char* p : {"deck/3/fader", "spur/1/fader", "spur/2/fader", "spur/3/fader"}) x.teil(p, -2.0f, 0.0, 0.0);
    cdj::Befehl l = x.neu(B::KI_SPUR, "leitstand");
    std::snprintf(l.liste, sizeof l.liste, "deck/3");
    x.sende(l);
    cdj::Befehl s2 = x.neu(B::KI_SPUR, "andreas");   // S2 (Server) mit Quelle der Seite
    std::snprintf(s2.liste, sizeof s2.liste, "spur/0");
    x.sende(s2);
    cdj::Befehl s2alt = x.neu(B::KI_SPUR, "andreas");   // die alte Maske: abgelehnt wie ein unbekannter Kanal
    std::snprintf(s2alt.liste, sizeof s2alt.liste, "spur/1,spur/3");
    x.sende(s2alt);
    x.start(0.0, 0, "cypher");
    x.lauf(10 * N);
    PRUEF(x.quittung(s2.id, 3) != nullptr);
    PRUEF(x.quittung(s2alt.id, 6) && x.quittung(s2alt.id, 6)->grund == "unbekannter_regler");
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
    x.sende(x.neu(B::KI_STOPP, "andreas"));
    x.lauf(10 * N + 4 * 22500 + 2 * N);
    for (const char* p : {"deck/3/fader", "spur/1/fader", "spur/2/fader", "spur/3/fader"}) PRUEF(x.wert(p) == -2.0);
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
  }
  {  // 6: Neustart-Zustand trägt die Kanal-Liste (Leitstand deck/3; S2 spur/0 nimmt der Kern an, es bleibt kein Spur-Teil)
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    cdj::Befehl l = x.neu(B::KI_SPUR, "leitstand");
    std::snprintf(l.liste, sizeof l.liste, "deck/3");
    x.sende(l);
    cdj::Befehl s2 = x.neu(B::KI_SPUR, "andreas");
    std::snprintf(s2.liste, sizeof s2.liste, "spur/0");
    x.sende(s2);
    x.lauf(10 * N);
    PRUEF(x.quittung(l.id, 3) != nullptr && x.quittung(s2.id, 3) != nullptr);
    auto fach = std::make_unique<cdj_z_echtzeit>();
    x.kern->abbild(*fach);
    PRUEF(std::strcmp(fach->ki_spur, "deck/3") == 0);   // kein Spur-Teil im Zustand
    arr35::Lauf y(ab.pfad, "test_kern_arr_ki_neu");
    PRUEF(y.kern->wiederherstellen(*fach));
    y.lauf(4 * N);
    auto fach2 = std::make_unique<cdj_z_echtzeit>();
    y.kern->abbild(*fach2);
    PRUEF(std::strcmp(fach2->ki_spur, "deck/3") == 0);   // der Textpuffer des Kerns trägt die Liste (nur der zurückgespielte Text)
    // Das Stellwerk hat die Liste zurückbekommen (teile_nachreichen): spur/0 lässt die Kanäle stehen, und der Text, den die Quittung fertig neu
    // aus dem Stellwerk schreibt, ist wieder deck/3. Fehlte die Liste im Stellwerk, stünde hier "".
    cdj::Befehl n0 = y.neu(B::KI_SPUR, "andreas");
    std::snprintf(n0.liste, sizeof n0.liste, "spur/0");
    y.sende(n0);
    y.lauf(8 * N);
    PRUEF(y.quittung(n0.id, 3) != nullptr);
    auto fach3 = std::make_unique<cdj_z_echtzeit>();
    y.kern->abbild(*fach3);
    PRUEF(std::strcmp(fach3->ki_spur, "deck/3") == 0);   // die Liste kommt aus dem Stellwerk
  }
  {  // 7: Spec 6.27, SCHNITTSTELLEN §4.7/§4.11: gemeinsamer Fall mit der Attrappe (djk/vertrag/faelle/arr_ki_stopp.json)
    const nlohmann::json f = nlohmann::json::parse(std::ifstream(CYPHERDJ_DJK "/vertrag/faelle/arr_ki_stopp.json"));
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    std::vector<std::unique_ptr<cdj::ArrFreeze>> auftraege;   // Paket K3: der Kern gibt sie als ARR_FREEZE zurück
    auto schicke = [&](const nlohmann::json& b) -> int64_t {
      const std::string a = b.at("adresse");
      const std::string quelle = b.at("quelle");
      const nlohmann::json& w = b.at("werte");
      if (a == "/k/arr/laden") return x.laden(w.at("nr").get<int64_t>(), spur, quelle.c_str());   // nr >= 0 (unten)
      if (a == "/k/arr/freeze") {   // Paket K3: der Auftrag, wie ihn der Lade-Faden anlegt (hier ohne Puffer)
        auto f = std::make_unique<cdj::ArrFreeze>();
        f->spur = w.at("spur").get<int>();
        f->von_beat = w.at("von_beat").get<double>();
        f->bis_beat = w.at("bis_beat").get<double>();
        f->kennung = w.at("kennung").get<int32_t>();
        cdj::Befehl c = x.neu(B::ARR_FREEZE, quelle.c_str());
        c.nr = f->spur;
        c.zeiger = f.get();
        auftraege.push_back(std::move(f));
        return x.sende(c);
      }
      if (a == "/k/arr/start") return x.start(w.at("start_beat").get<double>(), w.at("quant").get<int>(), quelle.c_str());
      if (a == "/k/arr/stopp") return x.stopp(w.at("quant").get<int>(), quelle.c_str());
      if (a == "/k/arr/loop")
        return x.loop(w.at("an").get<int>() == 1, w.at("von_beat").get<double>(), w.at("bis_beat").get<double>(), quelle.c_str());
      if (a == "/k/arr/metronom")
        return x.metronom(w.at("an").get<int>() == 1, w.at("pegel_db").get<float>(), w.at("ziel").get<int>(), quelle.c_str());
      if (a == "/k/ki/stopp") return x.sende(x.neu(B::KI_STOPP, quelle.c_str()));
      std::printf("Fall 7: Adresse %s unbekannt\n", a.c_str());
      PRUEF(false);
      return -1;
    };
    for (const auto& b : f.at("vorher")) {
      schicke(b);
      x.lauf(x.kern->sample() + 4 * N);
    }
    x.lauf(x.kern->sample() + 8 * N);
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);   // Andreas' Transport läuft durch den KI-Stopp
    for (const auto& b : f.at("befehle")) {
      // laden mit nr < 0 erreicht den Kern nie: das Netz lehnt ab, bevor geladen wird (Fall 8 fährt es durchs Netz)
      if (b.at("adresse") == "/k/arr/laden" && b.at("werte").at("nr").get<int64_t>() < 0) continue;
      const int64_t id = schicke(b);
      x.lauf(x.kern->sample() + 8 * N);
      const k35::Q* letzte = nullptr;
      for (const auto& q : x.q)
        if (q.id == id) letzte = &q;
      const int ende = b.at("ende").get<int>();
      const std::string grund = b.at("grund");
      const bool ok = letzte && letzte->status == ende && letzte->grund == grund;
      if (!ok)
        std::printf("Fall 7: %s von %s endet mit %d '%s', erwartet %d '%s'\n", b.at("adresse").get<std::string>().c_str(),
                    b.at("quelle").get<std::string>().c_str(), letzte ? letzte->status : -1,
                    letzte ? letzte->grund.c_str() : "", ende, grund.c_str());
      PRUEF(ok);
    }
  }
  {  // 8: K1-Fix-2 Punkt 2, derselbe gemeinsame Fall (djk/vertrag/faelle/arr_ki_stopp.json) im Betriebsweg: jeder Befehl
     // geht als OSC zuerst durch das Netz (Bereichsprüfung, KI-Stopp nach /e/ki), was es durchlässt, in den Kern
     // (ARR_LADEN über den Lade-Weg wie im Betrieb). Das /e/ki des Kerns geht ans Netz zurück.
    const nlohmann::json f = nlohmann::json::parse(std::ifstream(CYPHERDJ_DJK "/vertrag/faelle/arr_ki_stopp.json"));
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    auto nbef = std::make_unique<cdj::Befehlsring>();
    auto nere = std::make_unique<cdj::Ereignisring>();
    auto ringe = std::make_unique<cdj::ArrLaderRinge>();
    cdj::Netz netz(0, false, nbef.get(), nere.get());
    netz.verbinde_arr(ringe.get());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    size_t ev_bis = 0;
    auto weiter = [&](int64_t bis) {   // Kern laufen lassen, seine /e/ki ans Netz (wie der Ereignisring im Betrieb)
      x.lauf(bis);
      for (; ev_bis < x.ev.size(); ++ev_bis)
        if (x.ev[ev_bis].art == cdj::Ereignis::KI) PRUEF(nere->schiebe(x.ev[ev_bis]));
      netz.ereignisse_senden();
    };
    int64_t osc_id = 5000;
    std::vector<std::pair<int64_t, std::string>> netz_q;   // id und Grund der /q 6, die schon das Netz gab
    auto schicke = [&](const nlohmann::json& b) -> int64_t {
      const std::string a = b.at("adresse");
      const std::string quelle = b.at("quelle");
      const nlohmann::json& w = b.at("werte");
      const int64_t id = ++osc_id;
      if (a == "/k/arr/laden") {
        cdj::osc::Schreiber s(v::k_arr_laden);
        s.h(id).s(quelle.c_str()).i(w.at("nr").get<int32_t>());
        netz.paket(s.daten(), s.groesse());
      } else if (a == "/k/arr/start") {
        cdj::osc::Schreiber s(v::k_arr_start);
        s.h(id).s(quelle.c_str()).d(w.at("start_beat").get<double>()).i(w.at("quant").get<int32_t>());
        netz.paket(s.daten(), s.groesse());
      } else if (a == "/k/arr/stopp") {
        cdj::osc::Schreiber s(v::k_arr_stopp);
        s.h(id).s(quelle.c_str()).i(w.at("quant").get<int32_t>());
        netz.paket(s.daten(), s.groesse());
      } else if (a == "/k/arr/loop") {
        cdj::osc::Schreiber s(v::k_arr_loop);
        s.h(id).s(quelle.c_str()).i(w.at("an").get<int32_t>()).d(w.at("von_beat").get<double>())
            .d(w.at("bis_beat").get<double>());
        netz.paket(s.daten(), s.groesse());
      } else if (a == "/k/arr/metronom") {
        cdj::osc::Schreiber s(v::k_arr_metronom);
        s.h(id).s(quelle.c_str()).i(w.at("an").get<int32_t>()).f(w.at("pegel_db").get<float>())
            .i(w.at("ziel").get<int32_t>());
        netz.paket(s.daten(), s.groesse());
      } else if (a == "/k/arr/freeze") {   // Paket K3
        cdj::osc::Schreiber s(v::k_arr_freeze);
        s.h(id).s(quelle.c_str()).i(w.at("spur").get<int32_t>()).d(w.at("von_beat").get<double>())
            .d(w.at("bis_beat").get<double>()).i(w.at("kennung").get<int32_t>());
        netz.paket(s.daten(), s.groesse());
      } else if (a == "/k/ki/stopp") {
        cdj::osc::Schreiber s(v::k_ki_stopp);
        s.h(id).s(quelle.c_str());
        netz.paket(s.daten(), s.groesse());
      } else {
        std::printf("Fall 8: Adresse %s unbekannt\n", a.c_str());
        PRUEF(false);
        return -1;
      }
      cdj::Befehl c;
      cdj::ArrAuftrag au;
      if (nbef->hole(c)) {   // durchgelassen: in den Kern
        x.sende(c);
      } else if (ringe->auftraege.hole(au)) {   // laden durchgelassen: der Lade-Weg der Prüfung (arr_lauf.h) mit dieser id
        PRUEF(au.art == cdj::ArrAuftrag::LADEN);   // Paket K3: ein durchgelassener Freeze käme hier an (der Fall hat keinen)
        x.ordner.wiedergabe(au.nr, spur);
        cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, au.nr, x.cache);
        PRUEF(e.snap != nullptr);
        cdj::Befehl l = x.neu(cdj::Befehl::ARR_LADEN, au.quelle);
        l.id = au.id;
        l.zeiger = e.snap.release();
        l.arr_nr = au.nr;
        x.sende(l);
      } else if (g.warte("/q", 200) && g.m.werte[0].h == id) {   // das Netz hat selbst quittiert
        netz_q.emplace_back(id, g.s(5));
        PRUEF(g.m.werte[2].i == 6);
      } else {
        std::printf("Fall 8: %s von %s: weder durchgelassen noch vom Netz quittiert\n", a.c_str(), quelle.c_str());
        PRUEF(false);
      }
      return id;
    };
    for (const auto& b : f.at("vorher")) {
      schicke(b);
      weiter(x.kern->sample() + 4 * N);
    }
    weiter(x.kern->sample() + 8 * N);
    PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);   // Andreas' Transport läuft durch den KI-Stopp
    for (const auto& b : f.at("befehle")) {
      const int64_t id = schicke(b);
      weiter(x.kern->sample() + 8 * N);
      int status = -1;
      std::string grund;
      for (const auto& q : x.q)
        if (q.id == id) status = q.status, grund = q.grund;
      for (const auto& [i, gr] : netz_q)
        if (i == id) status = 6, grund = gr;
      const int ende = b.at("ende").get<int>();
      const bool ok = status == ende && grund == b.at("grund").get<std::string>();
      if (!ok)
        std::printf("Fall 8: %s von %s %s endet mit %d '%s', erwartet %d '%s'\n", b.at("adresse").get<std::string>().c_str(),
                    b.at("quelle").get<std::string>().c_str(), b.at("werte").dump().c_str(), status, grund.c_str(), ende,
                    b.at("grund").get<std::string>().c_str());
      PRUEF(ok);
    }
  }
  for (int cy = 0; cy < 2; ++cy) {  // 9: E-a: was noch nicht klingt, verwirft der KI-Stopp weiter: ein wartender Start von Cypher endet mit 7 ki_stopp (kein 2),
                                    // ein wartender von Andreas setzt am Takt ein (2); danach läuft er, bis Andreas stoppt (3)
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    x.laden(1, spur);
    x.lauf(2 * N);
    const int64_t s_w = x.start(0.0, 2, cy ? "cypher" : "andreas");   // Takt: Einsatz bei 90 000
    x.lauf(4 * N);
    PRUEF(x.kern->arrangement().status() == ArrStatus::wartet);
    x.sende(x.neu(B::KI_STOPP, "andreas"));
    x.lauf(100000);
    if (cy) {
      PRUEF(x.quittung(s_w, 7) && x.quittung(s_w, 7)->grund == "ki_stopp" && !x.quittung(s_w, 2));
      PRUEF(x.kern->arrangement().status() == ArrStatus::steht);
    } else {
      PRUEF(x.quittung(s_w, 2) && !x.quittung(s_w, 7));
      PRUEF(x.kern->arrangement().status() == ArrStatus::spielt);
      const int64_t st = x.stopp(0, "andreas");
      x.lauf(110000);
      PRUEF(x.quittung(st, 3) && x.kern->arrangement().status() == ArrStatus::steht);
    }
  }
  for (const char* schlecht : {"spur/2", "erz/9"}) {  // 8: gültiges, dann abgelehntes /k/ki/spur im selben Zyklus: der Neustart-Zustand trägt die gültige Liste
    arr35::Lauf x(ab.pfad, "test_kern_arr_ki");
    cdj::Befehl gut = x.neu(B::KI_SPUR, "leitstand");
    std::snprintf(gut.liste, sizeof gut.liste, "deck/3");
    x.sende(gut);
    cdj::Befehl schl = x.neu(B::KI_SPUR, "leitstand");
    std::snprintf(schl.liste, sizeof schl.liste, "%s", schlecht);
    x.sende(schl);
    x.lauf(10 * N);
    PRUEF(x.quittung(gut.id, 3) != nullptr);
    PRUEF(x.quittung(schl.id, 6) && x.quittung(schl.id, 6)->grund == "unbekannter_regler");
    auto fach = std::make_unique<cdj_z_echtzeit>();
    x.kern->abbild(*fach);
    PRUEF(std::strcmp(fach->ki_spur, "deck/3") == 0);
  }
  PRUEF_ENDE();
}
