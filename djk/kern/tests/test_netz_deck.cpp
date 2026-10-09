// Scheibe 31: Deck-Adressen im Netz-Faden über echtes UDP (SCHNITTSTELLEN §4.4, §5.5, §5.9, §16.2): /k/deck/laden,
// entladen, start, stopp kommen mit allen Feldern in den Befehlsring; Bereichsfehler werden quittiert, ohne den Ring zu
// füllen; /zustand/deck, /e/geladen und /e/frist gehen mit den Typen aus osc_adressen.h hinaus; die Deck-Adressen
// späterer Scheiben bleiben unbekannt.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cmath>
#include <cstring>
#include <string>
#include <thread>

#include "cypherdj/kern.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;

// Holt den nächsten Befehl aus dem Ring (wartet bis zu 500 ms, der Netz-Faden reiht asynchron ein).
static bool hole(cdj::Befehlsring* rb, cdj::Befehl& b) {
  for (int t = 0; t < 500; ++t) {
    if (rb->hole(b)) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return false;
}

int main() {
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  std::atomic<bool> stop{false};
  cdj::Netz netz(0, true, bef, ere);
  std::thread faden([&] { netz.laufen(stop); });
  Gegenstelle g(netz.port());
  { cdj::osc::Schreiber s(v::k_hallo); s.s("pruefstand").i(g.port).i(1); g.sende(s); }
  PRUEF(g.warte("/k/willkommen", 500));
  cdj::Befehl b{};

  // 1) laden, entladen, start, stopp: Felder im Ring
  { cdj::osc::Schreiber s(v::k_deck_laden); s.h(1).s("leitstand").i(2).s("f0000000000000a1").d(128.0).i(3).i(1); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_LADEN && b.id == 1 && b.deck == 2 &&
        !std::strcmp(b.material_id, "f0000000000000a1") && b.bpm == 128.0 && b.fassung == 3 && b.mit_stems == 1);
  { cdj::osc::Schreiber s(v::k_deck_entladen); s.h(2).s("leitstand").i(4); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_ENTLADEN && b.deck == 4);
  { cdj::osc::Schreiber s(v::k_deck_start); s.h(3).s("cypher").s("p7").s("b_rein").s("h3").i(1).d(32.0).d(16.5).i(0); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_START && b.deck == 1 && b.ab_beat == 32.0 && b.quell_beat == 16.5 &&
        b.politik == 0 && !std::strcmp(b.plan, "p7") && !std::strcmp(b.gruppe, "b_rein") && !std::strcmp(b.hoerschein, "h3"));
  { cdj::osc::Schreiber s(v::k_deck_stopp); s.h(4).s("andreas").s("").s("").s("").i(3).d(64.0).i(1); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_STOPP && b.deck == 3 && b.ab_beat == 64.0 && b.politik == 1);

  // 2) Fehlerfall Bereiche: Quittung 6 mit Grund, nichts im Ring
  auto abgelehnt = [&](int64_t id, const char* grund) {
    const bool q = g.warte("/q", 500);
    PRUEF(q && g.h(0) == id && g.i(2) == 6 && !std::strcmp(g.s(5), grund));
    PRUEF(!bef->hole(b));
  };
  { cdj::osc::Schreiber s(v::k_deck_laden); s.h(10).s("leitstand").i(5).s("f0000000000000a1").d(128.0).i(1).i(0); g.sende(s); }
  abgelehnt(10, "unbekanntes_deck");
  { cdj::osc::Schreiber s(v::k_deck_laden); s.h(11).s("leitstand").i(1).s("F0000000000000A1").d(128.0).i(1).i(0); g.sende(s); }
  abgelehnt(11, "ausserhalb_bereich");  // §1.4: Kleinbuchstaben
  { cdj::osc::Schreiber s(v::k_deck_laden); s.h(12).s("leitstand").i(1).s("f0000000000000a1").d(128.0).i(0).i(0); g.sende(s); }
  abgelehnt(12, "ausserhalb_bereich");  // fassung ≥ 1
  { cdj::osc::Schreiber s(v::k_deck_laden); s.h(13).s("leitstand").i(1).s("f0000000000000a1").d(128.0).i(1).i(2); g.sende(s); }
  abgelehnt(13, "ausserhalb_bereich");  // mit_stems 0/1
  { cdj::osc::Schreiber s(v::k_deck_start); s.h(14).s("andreas").s("").s("").s("").i(1).d(32.0).d(0.0).i(2); g.sende(s); }
  abgelehnt(14, "ausserhalb_bereich");  // Politik 2 braucht raster_beats
  { cdj::osc::Schreiber s(v::k_deck_start); s.h(15).s("dj").s("").s("").s("").i(1).d(32.0).d(0.0).i(0); g.sende(s); }
  abgelehnt(15, "ausserhalb_bereich");  // §1.4: unbekannte Quelle
  // Negativ-Kontrolle: Deck-Adressen späterer Scheiben (roll, Scheibe 38/52) bleiben unbekannt
  { cdj::osc::Schreiber s(v::k_deck_roll); s.h(16).s("andreas").s("").s("").s("").i(1).d(32.0).d(4.0).i(0).i(0).d(1.0); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500) && !std::strcmp(g.s(0), "/k/deck/roll") &&
        !std::strcmp(g.s(1), "unbekannte_adresse"));
  PRUEF(!bef->hole(b));

  // Plan E9: loop, sprung, hotcue, hotcue_setzen mit allen Feldern im Ring
  { cdj::osc::Schreiber s(v::k_deck_loop); s.h(20).s("andreas").s("").s("").s("").i(1).d(32.0).d(4.0).i(2).d(16.0); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_LOOP && b.deck == 1 && b.ab_beat == 32.0 && b.wert_beats == 4.0 &&
        b.politik == 2 && b.raster_beats == 16.0);
  { cdj::osc::Schreiber s(v::k_deck_sprung); s.h(21).s("cypher").s("p1").s("").s("").i(2).d(40.0).d(-8.5).i(1).d(0.0); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_SPRUNG && b.deck == 2 && b.wert_beats == -8.5 && b.politik == 1 &&
        !std::strcmp(b.plan, "p1"));
  { cdj::osc::Schreiber s(v::k_deck_hotcue); s.h(22).s("andreas").s("").s("").s("").i(1).d(48.0).i(8).i(2).d(0.25); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_HOTCUE && b.nr == 8 && b.politik == 2 && b.raster_beats == 0.25);
  { cdj::osc::Schreiber s(v::k_deck_hotcue_setzen); s.h(23).s("andreas").i(1).i(3).d(64.0); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_HOTCUE_SETZEN && b.deck == 1 && b.nr == 3 && b.quell_beat == 64.0);
  { cdj::osc::Schreiber s(v::k_deck_hotcue_setzen); s.h(24).s("andreas").i(1).i(3).d(NAN); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_HOTCUE_SETZEN && std::isnan(b.quell_beat));   // NaN löscht
  // Plan E9: Bereichsfehler
  { cdj::osc::Schreiber s(v::k_deck_sprung); s.h(30).s("andreas").s("").s("").s("").i(1).d(32.0).d(2.0).i(2).d(3.0); g.sende(s); }
  abgelehnt(30, "ausserhalb_bereich");  // Raster 3 gibt es nicht
  { cdj::osc::Schreiber s(v::k_deck_sprung); s.h(31).s("andreas").s("").s("").s("").i(1).d(32.0).d(2.0).i(3).d(1.0); g.sende(s); }
  abgelehnt(31, "ausserhalb_bereich");  // Politik 3
  { cdj::osc::Schreiber s(v::k_deck_sprung); s.h(32).s("andreas").s("").s("").s("").i(1).d(32.0).d(NAN).i(1).d(0.0); g.sende(s); }
  abgelehnt(32, "ausserhalb_bereich");  // delta NaN
  { cdj::osc::Schreiber s(v::k_deck_loop); s.h(33).s("andreas").s("").s("").s("").i(1).d(32.0).d(1.0 / 64).i(1).d(0.0); g.sende(s); }
  abgelehnt(33, "ausserhalb_bereich");  // Loop kürzer als 1/32
  { cdj::osc::Schreiber s(v::k_deck_hotcue); s.h(34).s("andreas").s("").s("").s("").i(1).d(32.0).i(9).i(1).d(0.0); g.sende(s); }
  abgelehnt(34, "ausserhalb_bereich");  // Hotcue 9
  { cdj::osc::Schreiber s(v::k_deck_hotcue_setzen); s.h(35).s("andreas").i(1).i(0).d(8.0); g.sende(s); }
  abgelehnt(35, "ausserhalb_bereich");  // Hotcue 0
  { cdj::osc::Schreiber s(v::k_deck_sprung); s.h(36).s("andreas").s("").s("").s("").i(5).d(32.0).d(2.0).i(1).d(0.0); g.sende(s); }
  abgelehnt(36, "unbekanntes_deck");
  // Plan Grid: /k/deck/raster mit allen Feldern im Ring, Bereiche
  { cdj::osc::Schreiber s(v::k_deck_raster); s.h(50).s("andreas").i(2).s("1ac28792d355a38b").d(128.0).i(1).i(-240); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::DECK_RASTER && b.deck == 2 && !std::strcmp(b.material_id, "1ac28792d355a38b") &&
        b.bpm == 128.0 && b.fassung == 1 && b.versatz_f == -240);
  { cdj::osc::Schreiber s(v::k_deck_raster); s.h(51).s("andreas").i(1).s("1ac28792d355a38b").d(128.0).i(1).i(192001); g.sende(s); }
  abgelehnt(51, "ausserhalb_bereich");  // über 1 s
  { cdj::osc::Schreiber s(v::k_deck_raster); s.h(52).s("andreas").i(1).s("kein-hex").d(128.0).i(1).i(0); g.sende(s); }
  abgelehnt(52, "ausserhalb_bereich");  // material_id nicht §1.4
  { cdj::osc::Schreiber s(v::k_deck_raster); s.h(53).s("andreas").i(5).s("1ac28792d355a38b").d(128.0).i(1).i(0); g.sende(s); }
  abgelehnt(53, "unbekanntes_deck");
  // AUFTRAG 2026-09-28: /k/fx (Einheits-Parameter, drei Parameter) mit allen Feldern, Bereiche
  { cdj::osc::Schreiber s(v::k_fx); s.h(40).s("andreas").i(1).i(3).d(0.25).d(0.7).d(0.4).d(0.5).d(0.5).i(1); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::FX && b.deck == 1 && b.nr == 3 && b.dauer_beats == 0.25 &&
        std::fabs(b.wert - 0.7f) < 1e-6f && b.wert_beats == 0.4 && b.raster_beats == 0.5 && b.quell_beat == 0.5 && b.an == 1);
  { cdj::osc::Schreiber s(v::k_fx); s.h(41).s("andreas").i(3).i(1).d(1.0).d(1.0).d(0.0).d(0.0).d(0.0).i(1); g.sende(s); }
  abgelehnt(41, "ausserhalb_bereich");  // Einheit 3 gibt es nicht (§4.10)
  { cdj::osc::Schreiber s(v::k_fx); s.h(42).s("andreas").i(2).i(1).d(3.0).d(1.0).d(0.0).d(0.0).d(0.0).i(1); g.sende(s); }
  abgelehnt(42, "ausserhalb_bereich");  // beats 3 gibt es nicht
  { cdj::osc::Schreiber s(v::k_fx); s.h(43).s("andreas").i(2).i(5).d(1.0).d(1.0).d(0.0).d(0.0).d(0.0).i(1); g.sende(s); }
  abgelehnt(43, "ausserhalb_bereich");  // art 5
  { cdj::osc::Schreiber s(v::k_fx); s.h(44).s("andreas").i(2).i(1).d(1.0).d(1.5).d(0.0).d(0.0).d(0.0).i(1); g.sende(s); }
  abgelehnt(44, "ausserhalb_bereich");  // wet > 1
  // /k/fx/zuweisung mit allen Feldern, Bereiche
  { cdj::osc::Schreiber s(v::k_fx_zuweisung); s.h(45).s("andreas").i(2).s("pad/2").i(1); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::FX_ZUWEISUNG && b.deck == 2 && !std::strcmp(b.pfad, "pad/2") && b.an == 1);
  { cdj::osc::Schreiber s(v::k_fx_zuweisung); s.h(46).s("andreas").i(1).s("deck/3").i(1); g.sende(s); }
  abgelehnt(46, "ausserhalb_bereich");  // deck/3 hat keine FX-Zuweisung (§4.10)
  { cdj::osc::Schreiber s(v::k_fx_zuweisung); s.h(47).s("andreas").i(1).s("master").i(0); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::FX_ZUWEISUNG && b.deck == 1 && !std::strcmp(b.pfad, "master") && b.an == 0);
  { cdj::osc::Schreiber s(v::k_fx_zuweisung); s.h(48).s("andreas").i(0).s("deck/1").i(1); g.sende(s); }
  abgelehnt(48, "ausserhalb_bereich");  // Einheit 0 gibt es nicht
  // Ohr T17: /k/fx/routing ,hsi — Insert und Post Fader im Ring, Wert 2 abgelehnt; die Quelle prüft der Kern (nur_hand)
  { cdj::osc::Schreiber s(v::k_fx_routing); s.h(54).s("andreas").i(1); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::FX_ROUTING && b.an == 1 && !std::strcmp(b.quelle, "andreas"));
  { cdj::osc::Schreiber s(v::k_fx_routing); s.h(55).s("cypher").i(0); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::FX_ROUTING && b.an == 0 && !std::strcmp(b.quelle, "cypher"));
  { cdj::osc::Schreiber s(v::k_fx_routing); s.h(56).s("andreas").i(2); g.sende(s); }
  abgelehnt(56, "ausserhalb_bereich");

  // 3) Ereignisse: /zustand/deck, /e/geladen, /e/frist
  cdj::Ereignis e{};
  e.art = cdj::Ereignis::DECK;
  e.deck = 1; e.status = 2; std::strcpy(e.material_id, "f0000000000000a1"); e.basis_bpm = 128.0; e.fassung = 1;
  e.quell_beat = 24.5; e.beats_bis_ende = 231.5; e.faktor = 1.0; e.vorlauf_ms = 10.666667f;
  e.hoerweg = 0; e.stretcher_fuell = -1;  // Keylock Task 2b: die Felder trägt jetzt das Ereignis
  e.keylock_unterlauf = 3; e.keylock_aufgegeben = 7;  // Keylock Task 3 (Fassung 4.1 Punkt 3): Zähler des Decks
  ere->schiebe(e);
  PRUEF(g.warte("/zustand/deck", 500));
  PRUEF(!std::strcmp(g.m.typen, "iisdidddfiifii") && g.i(0) == 1 && g.i(1) == 2 && !std::strcmp(g.s(2), "f0000000000000a1") &&
        g.d(3) == 128.0 && g.i(4) == 1 && g.d(5) == 24.5 && g.d(6) == 231.5 && g.d(7) == 1.0 && g.i(9) == 0 && g.i(10) == -1);
  PRUEF(!std::strcmp(g.m.typen, "iisdidddfiifii") && g.i(12) == 3 && g.i(13) == 7);
  PRUEF_NAH(g.f(8), 10.666667, 1e-5);
  cdj::Ereignis ge{};
  ge.art = cdj::Ereignis::GELADEN;
  ge.deck = 2; std::strcpy(ge.material_id, "f0000000000000c3"); ge.basis_bpm = 128.0; ge.fassung = 1; ge.mit_stems = 0;
  ge.sample = 45056;
  ere->schiebe(ge);
  PRUEF(g.warte("/e/geladen", 500) && !std::strcmp(g.m.typen, "isdiih") && g.i(0) == 2 &&
        !std::strcmp(g.s(1), "f0000000000000c3") && g.d(2) == 128.0 && g.i(3) == 1 && g.i(4) == 0 && g.h(5) == 45056);
  cdj::Ereignis fr{};
  fr.art = cdj::Ereignis::FRIST;
  fr.deck = 1; fr.beats_bis_ende = 32.0; fr.beat = 133.0; fr.sample = 2992500;
  ere->schiebe(fr);
  PRUEF(g.warte("/e/frist", 500) && !std::strcmp(g.m.typen, "iddh") && g.i(0) == 1 && g.d(1) == 32.0 &&
        g.d(2) == 133.0 && g.h(3) == 2992500);
  cdj::Ereignis fx{};   // AUFTRAG 2026-09-28: /e/fx ,iidddddi — Einheits-Parameter, drei Parameter
  fx.art = cdj::Ereignis::FX;
  fx.deck = 2; fx.fx_art = 2; fx.fx_beats = 4.0; fx.fx_wet = 0.5f; fx.fx_param = 0.25f; fx.beats_bis_ende = 0.5; fx.faktor = 0.5; fx.status = 1;
  ere->schiebe(fx);
  PRUEF(g.warte("/e/fx", 500) && !std::strcmp(g.m.typen, "iidddddi") && g.i(0) == 2 && g.i(1) == 2 &&
        g.d(2) == 4.0 && g.d(3) == 0.5 && g.d(4) == 0.25 && g.d(5) == 0.5 && g.d(6) == 0.5 && g.i(7) == 1);
  cdj::Ereignis fxz{};   // /e/fx/zuweisung ,isi
  fxz.art = cdj::Ereignis::FX_ZUWEISUNG;
  fxz.deck = 1; std::strcpy(fxz.pfad, "erz/1"); fxz.status = 1;
  ere->schiebe(fxz);
  PRUEF(g.warte("/e/fx/zuweisung", 500) && !std::strcmp(g.m.typen, "isi") && g.i(0) == 1 &&
        !std::strcmp(g.s(1), "erz/1") && g.i(2) == 1);
  cdj::Ereignis fxr{};   // Ohr T17: /e/fx/routing ,i
  fxr.art = cdj::Ereignis::FX_ROUTING;
  fxr.status = 1;
  ere->schiebe(fxr);
  PRUEF(g.warte("/e/fx/routing", 500) && !std::strcmp(g.m.typen, "i") && g.i(0) == 1);
  cdj::Ereignis hc{};   // Plan E9: /e/hotcue ,isidh (deck, material_id, nr, quell_beat, sample)
  hc.art = cdj::Ereignis::HOTCUE;
  hc.deck = 2; std::strcpy(hc.material_id, "f0000000000000c3"); hc.status = 5; hc.quell_beat = 96.0; hc.sample = 123456;
  ere->schiebe(hc);
  PRUEF(g.warte("/e/hotcue", 500) && !std::strcmp(g.m.typen, "isidh") && g.i(0) == 2 &&
        !std::strcmp(g.s(1), "f0000000000000c3") && g.i(2) == 5 && g.d(3) == 96.0 && g.h(4) == 123456);

  cdj::Ereignis ra{};   // Plan Grid: /e/raster ,isdfh
  ra.art = cdj::Ereignis::RASTER;
  ra.deck = 1; std::strcpy(ra.material_id, "1ac28792d355a38b"); ra.quell_beat = 33.5; ra.wert = -5.0f; ra.sample = 123456;
  ere->schiebe(ra);
  PRUEF(g.warte("/e/raster", 500) && !std::strcmp(g.m.typen, "isdfh") && g.i(0) == 1 &&
        !std::strcmp(g.s(1), "1ac28792d355a38b") && g.d(2) == 33.5 && g.f(3) == -5.0f && g.h(4) == 123456);
  // Keylock 3b (Prüfung MINOR 4): ein NEUER Abonnent (etwa die Seite nach ihrem Neustart) bekommt den Stand des Knopfs als
  // /e/regler keylock, aus /uhr (Ereignis::keylock_aus); ein Herzschlag eines Bekannten nicht.
  for (int aus = 1; aus >= 0; --aus) {
    cdj::Ereignis u{};
    u.art = cdj::Ereignis::UHR;
    u.sample = 480000; u.beat = 20.0; u.bpm = 128.0; u.keylock_aus = aus;
    ere->schiebe(u);
    PRUEF(g.warte("/uhr", 500));
    Gegenstelle n(netz.port());
    { cdj::osc::Schreiber s(v::k_hallo); s.s(aus ? "seite1" : "seite0").i(n.port).i(1); n.sende(s); }
    PRUEF(n.warte("/e/regler", 500) && !std::strcmp(n.m.typen, "sfshd") && !std::strcmp(n.s(0), "keylock") &&
          n.f(1) == (aus ? 0.0f : 1.0f) && n.h(3) == 480000);
    { cdj::osc::Schreiber s(v::k_hallo); s.s(aus ? "seite1" : "seite0").i(n.port).i(1); n.sende(s); }
    PRUEF(n.warte("/k/willkommen", 500) && !n.warte("/e/regler", 100));  // Herzschlag: kein zweites Mal
    { cdj::osc::Schreiber s(v::k_tschuess); s.s(aus ? "seite1" : "seite0"); n.sende(s); }
  }
  stop = true;
  faden.join();
  delete bef;  // ASan/LSan: Ringe wie in test_netz25 freigeben
  delete ere;
  PRUEF_ENDE();
}
