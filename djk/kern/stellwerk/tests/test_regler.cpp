// Scheibe 11, Task 4: Regler-Tabelle gegen INTERFACES §1.5 und Standard-Kurven gegen §7.2.
#include <cstdio>
#include <cstring>

#include "pruef.h"
#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/stellwerk/typen.h"
#include "cypherdj/stellwerk/werkzeug_regler.h"

using namespace cypherdj::stellwerk;

namespace {
const ReglerTabelle& tab() {
  static ReglerTabelle t;
  return t;
}
const ReglerDef& d(const char* pfad) {
  static const ReglerDef leer{};   // fehlt der Pfad, prüfen die Fälle gegen einen leeren Eintrag und werden rot
  const int r = tab().suche(pfad);
  PRUEFE(r >= 0);
  return r >= 0 ? tab().def(r) : leer;
}
}  // namespace

FALL(zahl_der_regler_und_kanaele) {
  // 4 Decks x 21 (mit transport), 8 Erzeuger x 16, 2 Pads x 16, 4 Busse x 15 (ohne ziel), 18 globale (seit Keylock 3
  // mit `keylock`, seit 2026-10-10 mit `master/pfl`, seit 2026-10-11 mit `color/art` und `color/param`), dazu 14 Quellkanäle
  // x 8 `komp/*` (2026-10-11, mit komp/sc): 436; D1 K1/E3: dazu 32 Spuren x 4 Spur-Regler (spur/<n>/*, global): 564;
  // 1.10 Slice 1: dazu 8 Gruppen x 4 Gruppen-Regler (grp/<n>/*) und pm/fader: 597; S5r: dazu 12 Graph-Kanäle x 8
  // Graph-Regler (<kanal>/bk/<1..8>): 693; 1.10 Slice 3: dazu 128 + 32 Sends, 16 Return-Regler und 28 Hall-Regler: 897
  // S14: plus 2 send returns x 8 graph knobs (fx/3, fx/4): 913
  // 1.15 A1b: plus the mix tools, 345 rows (gate 9 x 13, utility 7 x 17, multiband 24 x 4, limiter 3 x 4, spektrum/kanal): 1258
  // 1.10 slice 4a T1: plus the 120 insert rows ins/komp/<1..12>/<10 parameters>: 1378
  // 1.10 slice 4b T12: plus the eq rows (59 per instance, 1 instance) and the saett rows (4 per instance, 1 instance): 1378 + 63 = 1441.
  // The pool sizes are the measured ones (T11): a change of either is a decision with a new measurement, and this pin goes red first.
  // 2026-11-06: the eq pool has 2 instances (Andreas' decision of 2026-11-05, lane measured quiet): 59 more rows.
  PRUEFE_GLEICH(tab().anzahl(), 597 + 12 * 8 + 204 + 2 * 8 + WERKZEUG_REGLER + 120 + 2 * 59 + 4 + 48 + 3);   // + the 48 rack rows (slice 4c), + the 3 ins/lim rows (master limiter)
  // 1.10 slice 4c T15: plus the 48 rack macro rows rack/<1..12>/m1..m4: 1500 + 48 = 1548.
  // Master limiter: plus the 3 rows ins/lim/1/{an,decke,abklingen}: 1548 + 3 = 1551.
  PRUEFE_GLEICH(tab().anzahl(), 913 + 345 + 120 + 122 + 48 + 3);
  PRUEFE_GLEICH(tab().anzahl(), 1551);
  // the contract (INTERFACES 1.5) says indices 1258 to 1377: the table counts the 4 deck/<n>/transport rows, the dump of stellwerk_regler_liste does not (1374 lines)
  PRUEFE_GLEICH(tab().suche("ins/komp/1/an"), 1258);
  PRUEFE_GLEICH(tab().suche("ins/komp/12/sc"), 1377);
  // slice 4b: the eq block follows the komp block (indices 1378 to 1495, two instances of 59), then the saett block (1496 to 1499)
  PRUEFE_GLEICH(tab().suche("ins/eq/1/an"), 1378);
  PRUEFE_GLEICH(tab().suche("ins/eq/1/b8/platz"), 1436);
  PRUEFE_GLEICH(tab().suche("ins/eq/2/an"), 1437);
  PRUEFE_GLEICH(tab().suche("ins/eq/2/b8/platz"), 1495);
  PRUEFE_GLEICH(tab().suche("ins/saett/1/an"), 1496);
  PRUEFE_GLEICH(tab().suche("ins/saett/1/mix"), 1499);
  // slice 4c: the rack block follows the saett block (1500 to 1547)
  PRUEFE_GLEICH(tab().suche("rack/1/m1"), 1500);
  PRUEFE_GLEICH(tab().suche("rack/12/m4"), 1547);
  // master limiter: the lim block is appended after the rack block (1548 to 1550), so every earlier index stays
  PRUEFE_GLEICH(tab().suche("ins/lim/1/an"), 1548);
  PRUEFE_GLEICH(tab().suche("ins/lim/1/decke"), 1549);
  PRUEFE_GLEICH(tab().suche("ins/lim/1/abklingen"), 1550);
  PRUEFE(tab().suche("ins/lim/2/an") < 0);   // pool 1
  PRUEFE(tab().anzahl() < cypherdj::stellwerk::MAX_REGLER);
  PRUEFE_GLEICH(tab().kanaele(), 20);
  PRUEFE_GLEICH(tab().kanal_suche("deck/1"), 0);
  PRUEFE_GLEICH(tab().kanal_suche("bus/4"), 17);
  PRUEFE_GLEICH(tab().kanal_suche("cue"), 19);
  PRUEFE_GLEICH(tab().kanal_suche("deck/5"), -1);
}

FALL(spur_regler_global_mit_vorgaben) {
  // D1 K1 (Spec 2.3, E3: 32 Slots): spur/1..32 je fader, pan, mute, solo an Kanal −1, keine neuen Kanäle, alle dürfen
  PRUEFE_GLEICH(tab().kanaele(), 20);
  for (int n = 1; n <= SPUR_REGLER_SPUREN; n++) {
    char p[32];
    std::snprintf(p, sizeof p, "spur/%d/fader", n);
    PRUEFE(d(p).kanal == -1 && d(p).rolle == Rolle::spur_fader && d(p).vorgabe == 0.0f && d(p).min == -200.0f &&
           d(p).db && !d(p).nur_hand && d(p).schalt_samples == 480);
    std::snprintf(p, sizeof p, "spur/%d/pan", n);
    PRUEFE(d(p).kanal == -1 && d(p).rolle == Rolle::spur_pan && d(p).min == -1.0f && d(p).max == 1.0f && !d(p).nur_hand);
    std::snprintf(p, sizeof p, "spur/%d/mute", n);
    PRUEFE(d(p).rolle == Rolle::spur_mute && d(p).ganzzahlig && d(p).keine_rampe && d(p).schalt_samples == 0);
    std::snprintf(p, sizeof p, "spur/%d/solo", n);
    PRUEFE(d(p).rolle == Rolle::spur_solo && d(p).ganzzahlig && d(p).keine_rampe && d(p).schalt_samples == 0);
  }
  PRUEFE(tab().suche("spur/32/fader") >= 0);   // letzter Slot (T03)
  PRUEFE(tab().suche("spur/33/fader") < 0);    // Negativ-Kontrolle: n+1 (T01)
  PRUEFE(tab().suche("spur/9/fader") >= 0);    // seit E3 gültig
  PRUEFE(tab().suche("spur/0/pan") < 0);
}

FALL(spur_fader_bis_plus_6_db) {
  // D1 Spec 6.16 (§4 Wertebereiche): spur/<n>/fader −200..+6 dB, Vorgabe 0. Hand-Kurve fader_db bis +6: ganz oben +6,
  // 0 dB bei Stellung 10^(−6/20) ≈ 0,501. Kanal-Fader bleiben −200..0 (Negativ-Kontrolle).
  for (int n = 1; n <= SPUR_REGLER_SPUREN; n++) {
    char p[32];
    std::snprintf(p, sizeof p, "spur/%d/fader", n);
    PRUEFE(d(p).min == -200.0f && d(p).max == 6.0f && d(p).vorgabe == 0.0f);
    PRUEFE(d(p).kurve.typ == KurvenTyp::fader_db && d(p).kurve.max == 6.0f);
    PRUEFE_NAH(ReglerTabelle::aus_x(d(p).kurve, 1.0f), 6.0f, 1e-5);
    PRUEFE_NAH(ReglerTabelle::zu_x(d(p).kurve, 0.0f), 0.501187f, 1e-5);
  }
  PRUEFE(d("deck/1/fader").max == 0.0f && d("deck/1/fader").kurve.max == 0.0f);
  PRUEFE_NAH(ReglerTabelle::aus_x(d("deck/1/fader").kurve, 1.0f), 0.0f, 1e-6);
}

FALL(kapazitaet_hat_luft_fuer_k2) {
  // K2 Task 0.2: Luft für neue Pfade, und ein voller Speicher darf nicht überlaufen
  PRUEFE(cypherdj::stellwerk::MAX_REGLER >= 384);
  // Package 1.10 slice 4 T0: the capacity of package 1.15 A1a (2048) is the start state of the insert rows
  PRUEFE(cypherdj::stellwerk::MAX_REGLER == 2048);
  // D1 K1 (Spec 2.3) verlangte 512 − 468 >= 44. E1 (2026-10-20): Reserve gegen 1024. 32 Spuren statt 8 brauchen
  // 24 · 4 = 96 Regler mehr (468 → 564, Paket E3), dazu dieselbe Luft von 44. Bei MAX_REGLER 512 sind es nur 44: rot.
  // 1.10 Slice 3: the 96 of E3 are spent and 204 send/return/hall controls took more of the 1024; the reserve is 127 now (S14: 111 with the 16 send-return knobs), so the
  // check keeps only the margin of 44 (the E3 surcharge of 96 is history). Slice 4 (+96) needs the ceiling raised first (plan P13).
  PRUEFE(cypherdj::stellwerk::MAX_REGLER - tab().anzahl() >= 44);
  // 1.10 slice 4a T1: the reservation RESERVIERT_SLICE4 (96 rows, package 1.15 A1a) is replaced by the real rows: the 120 `komp` rows
  // are in the table, the margin of 44 stays on top of them (the eq, saett and rack rows of 4b and 4c are not counted here).
  PRUEFE(cypherdj::stellwerk::MAX_REGLER - tab().anzahl() >= 44);
  std::printf("Regler %d von %d, Reserve %d\n", tab().anzahl(), cypherdj::stellwerk::MAX_REGLER,
              cypherdj::stellwerk::MAX_REGLER - tab().anzahl());
}

FALL(jeder_pfad_wird_gefunden_und_unbekannte_nicht) {
  for (int r = 0; r < tab().anzahl(); r++) PRUEFE_GLEICH(tab().suche(tab().def(r).pfad), r);
  for (const char* p : {"deck/5/fader", "deck/1/fade", "bus/1/ziel", "erz/1/stem/bass", "fx/3/rueckkopplung", "", "xfader/"})
    PRUEFE_GLEICH(tab().suche(p), -1);
}

FALL(bereiche_vorgaben_schaltrampen) {
  PRUEFE_NAH(d("deck/2/fader").vorgabe, -200, 0);
  PRUEFE_GLEICH(d("deck/2/fader").schalt_samples, 480);    // 10 ms
  PRUEFE(d("deck/2/fader").db);
  PRUEFE_NAH(d("deck/1/trim").min, -24, 0);
  PRUEFE_NAH(d("deck/1/trim").max, 24, 0);
  PRUEFE_NAH(d("deck/1/eq/tief").max, 6, 0);
  PRUEFE_GLEICH(d("deck/1/kill/tief").schalt_samples, 240);   // 5 ms
  PRUEFE(d("deck/1/kill/tief").keine_rampe && d("deck/1/kill/tief").ganzzahlig);
  PRUEFE_GLEICH(d("erz/3/filter").schalt_samples, 960);       // 20 ms
  PRUEFE_NAH(d("cue/pegel").vorgabe, -12, 0);
  PRUEFE_NAH(d("cue/mix").vorgabe, -1, 0);
  PRUEFE_NAH(d("fx/1/notenwert").vorgabe, 0.75, 0);
  PRUEFE_NAH(d("fx/2/rueckkopplung").max, 0.95, 1e-6);
  PRUEFE_NAH(d("deck/3/xseite").vorgabe, 1, 0);
  PRUEFE_GLEICH(d("deck/4/stem/bass").deck, 4);
  PRUEFE_GLEICH(d("deck/4/fader").deck, 0);
}

FALL(wer_darf_nur_hand) {
  for (const char* p : {"bus/1/fader", "deck/1/ziel", "deck/1/xseite", "deck/1/pfl", "xfader", "master/pegel", "master/kleber", "cue/mix",
                        "cue/pegel", "cue/split", "master/pfl"})
    PRUEFE(d(p).nur_hand);
  for (const char* p : {"deck/1/fader", "bus/1/trim", "erz/2/send/3", "fx/1/notenwert", "fx/4/rueckweg", "pad/2/eq/hoch", "duck/tiefe", "duck/release", "color/art", "color/param", "erz/1/komp/schwelle", "pad/2/komp/an"})
    PRUEFE(!d(p).nur_hand);
}

// Keylock Task 3 (Plan 2026-10-06-keylock-echtzeit.md, Fassung 4): EIN globaler Schalter `keylock` für alle Quellen
// (Decks, Loop-Boxen, Loop auf dem Deck), Vorgabe 1, kein Deck-Argument, kein `deck/<n>/keylock`; jede Quelle darf.
FALL(keylock_globaler_schalter) {
  const ReglerDef& k = d("keylock");
  PRUEFE_GLEICH(k.kanal, -1);
  PRUEFE_GLEICH(k.deck, 0);
  PRUEFE(k.rolle == Rolle::keylock);
  PRUEFE_NAH(k.min, 0, 0);
  PRUEFE_NAH(k.max, 1, 0);
  PRUEFE_NAH(k.vorgabe, 1, 0);
  PRUEFE_GLEICH(k.schalt_samples, 0);
  PRUEFE(!k.nur_hand);
  PRUEFE(!k.db && k.keine_rampe && k.ganzzahlig && !k.transport);
  PRUEFE(k.kurve.typ == KurvenTyp::schalter);
  for (const char* p : {"deck/1/keylock", "deck/4/keylock", "pad/1/keylock"}) PRUEFE_GLEICH(tab().suche(p), -1);
}

FALL(deck_halter_eintraege) {
  for (const char* p : {"deck/1/transport", "deck/4/transport"}) {
    PRUEFE(d(p).transport);
    PRUEFE(d(p).nur_hand);
  }
  PRUEFE_GLEICH(d("deck/3/transport").deck, 3);
  PRUEFE_GLEICH(tab().suche("erz/1/transport"), -1);
  PRUEFE_GLEICH(tab().suche("bus/1/transport"), -1);
  int n = 0;
  for (int r = 0; r < tab().anzahl(); r++) n += tab().def(r).transport;
  PRUEFE_GLEICH(n, 4);
}

FALL(regler_von_kanal_und_rolle) {
  PRUEFE_GLEICH(tab().regler_von(tab().kanal_suche("deck/3"), Rolle::fader), tab().suche("deck/3/fader"));
  PRUEFE_GLEICH(tab().regler_von(tab().kanal_suche("bus/2"), Rolle::ziel), -1);
  PRUEFE_GLEICH(tab().regler_von(tab().kanal_suche("erz/1"), Rolle::stem_bass), -1);
}

FALL(kurve_fader_db) {
  const Kurve& k = d("deck/1/fader").kurve;
  PRUEFE_NAH(ReglerTabelle::zu_x(k, 0.0f), 1.0, 1e-6);
  PRUEFE_NAH(ReglerTabelle::zu_x(k, -200.0f), 0.0, 0);
  PRUEFE_NAH(ReglerTabelle::zu_x(k, -6.0206f), 0.5, 1e-5);
  PRUEFE_NAH(ReglerTabelle::aus_x(k, 0.5f), -6.0206, 1e-3);
  PRUEFE_NAH(ReglerTabelle::aus_x(k, 0.0009f), -200, 0);   // §7.2: unter -60 dB stumm
  PRUEFE_NAH(ReglerTabelle::aus_x(k, 0.001f), -60, 1e-3);
}

FALL(kurve_eq_mit_kill_unter_min) {
  const Kurve& k = d("deck/1/eq/tief").kurve;
  PRUEFE_NAH(ReglerTabelle::zu_x(k, 0.0f), 26.0 / 32.0, 1e-6);
  PRUEFE_NAH(ReglerTabelle::zu_x(k, -30.0f), 0.0, 0);
  PRUEFE_NAH(ReglerTabelle::aus_x(k, 0.0f), -200, 0);
  PRUEFE_NAH(ReglerTabelle::aus_x(k, 1.0f), 6, 1e-6);
}

FALL(kurve_schalter_und_stufen) {
  PRUEFE_NAH(ReglerTabelle::aus_x(d("deck/1/kill/tief").kurve, 0.49f), 0, 0);
  PRUEFE_NAH(ReglerTabelle::aus_x(d("deck/1/kill/tief").kurve, 0.5f), 1, 0);
  PRUEFE_NAH(ReglerTabelle::aus_x(d("deck/1/ziel").kurve, 0.6f), 2, 0);
  PRUEFE_NAH(ReglerTabelle::zu_x(d("deck/1/xseite").kurve, 2.0f), 1.0, 0);
}

FALL(spur_nr_liest_mehrstellige_nummern) {
  using cypherdj::stellwerk::spur_nr;
  PRUEFE_GLEICH(spur_nr("spur/1/fader"), 1);
  PRUEFE_GLEICH(spur_nr("spur/8/solo"), 8);
  PRUEFE_GLEICH(spur_nr("spur/10/fader"), 10);   // der Fehlerfall von arr_ausgang.cpp:46 (heute Index 0)
  PRUEFE_GLEICH(spur_nr("spur/32/mute"), 32);
  PRUEFE_GLEICH(spur_nr("spur/0/fader"), 0);     // 0 ist keine Spur
  PRUEFE_GLEICH(spur_nr("spur/01/fader"), 0);    // keine führende Null
  PRUEFE_GLEICH(spur_nr("spur/10"), 0);          // ohne Feld
  PRUEFE_GLEICH(spur_nr("spur//fader"), 0);
  PRUEFE_GLEICH(spur_nr("spur/1000/fader"), 0);  // höchstens drei Ziffern
  PRUEFE_GLEICH(spur_nr("erz/4/fader"), 0);      // Negativ-Kontrolle: anderer Kanal
  PRUEFE_GLEICH(spur_nr(""), 0);
  PRUEFE_GLEICH(spur_nr("spur/1x/fader"), 0);    // Ziffernfolge muss mit '/' enden
  PRUEFE_GLEICH(spur_nr("spur/10/"), 0);         // Feld darf nicht leer sein
}

FALL(gruppen_regler_und_pm_global_mit_vorgaben) {
  // 1.10 Slice 1: grp/1..8 je fader, pan, mute, solo an Kanal −1, alle dürfen, Werte und Rampen wie spur/*; pm/fader −200..+6, Vorgabe 0
  PRUEFE_GLEICH(tab().kanaele(), 20);   // keine neuen Kanäle
  for (int n = 1; n <= GRP_REGLER_GRUPPEN; n++) {
    char p[32];
    std::snprintf(p, sizeof p, "grp/%d/fader", n);
    PRUEFE(d(p).kanal == -1 && d(p).rolle == Rolle::grp_fader && d(p).vorgabe == 0.0f && d(p).min == -200.0f && d(p).max == 6.0f &&
           d(p).db && !d(p).nur_hand && d(p).schalt_samples == 480 && d(p).kurve.typ == KurvenTyp::fader_db && d(p).kurve.max == 6.0f);
    std::snprintf(p, sizeof p, "grp/%d/pan", n);
    PRUEFE(d(p).kanal == -1 && d(p).rolle == Rolle::grp_pan && d(p).min == -1.0f && d(p).max == 1.0f && !d(p).nur_hand);
    std::snprintf(p, sizeof p, "grp/%d/mute", n);
    PRUEFE(d(p).rolle == Rolle::grp_mute && d(p).ganzzahlig && d(p).keine_rampe && d(p).schalt_samples == 0);
    std::snprintf(p, sizeof p, "grp/%d/solo", n);
    PRUEFE(d(p).rolle == Rolle::grp_solo && d(p).ganzzahlig && d(p).keine_rampe && d(p).schalt_samples == 0);
  }
  const ReglerDef& pm = d("pm/fader");
  PRUEFE(pm.kanal == -1 && pm.rolle == Rolle::pm_fader && pm.min == -200.0f && pm.max == 6.0f && pm.vorgabe == 0.0f && pm.db && !pm.nur_hand &&
         pm.schalt_samples == 480);
  // Negativ-Kontrollen: n+1, 0, fremde Felder, PM hat nur den Fader
  for (const char* p : {"grp/9/fader", "grp/0/pan", "grp/1/trim", "grp/1/send/0", "pm/pan", "pm/mute", "pm/fader/x"}) PRUEFE_GLEICH(tab().suche(p), -1);
}

FALL(neue_regler_stehen_hinter_spur_32_ohne_index_verschiebung) {
  // spur/32/solo war der letzte Eintrag (Index 563, E3); die neuen Regler hängen dahinter, kein bestehender Index wandert
  PRUEFE_GLEICH(tab().suche("spur/32/solo"), 563);
  PRUEFE_GLEICH(tab().suche("grp/1/fader"), 564);
  PRUEFE_GLEICH(tab().suche("grp/8/solo"), 595);
  PRUEFE_GLEICH(tab().suche("pm/fader"), 596);
  PRUEFE_GLEICH(tab().suche("deck/1/fader"), 0);
}

FALL(grp_nr_liest_nummern) {
  using cypherdj::stellwerk::grp_nr;
  PRUEFE_GLEICH(grp_nr("grp/1/fader"), 1);
  PRUEFE_GLEICH(grp_nr("grp/8/solo"), 8);
  PRUEFE_GLEICH(grp_nr("grp/12/pan"), 12);       // der Parser prüft die Form, den Bereich prüft der Binder
  PRUEFE_GLEICH(grp_nr("grp/0/fader"), 0);
  PRUEFE_GLEICH(grp_nr("grp/01/fader"), 0);
  PRUEFE_GLEICH(grp_nr("grp/1"), 0);
  PRUEFE_GLEICH(grp_nr("grp//fader"), 0);
  PRUEFE_GLEICH(grp_nr("spur/1/fader"), 0);      // Negativ-Kontrolle: anderer Namensraum
  PRUEFE_GLEICH(grp_nr("pm/fader"), 0);
  PRUEFE_GLEICH(cypherdj::stellwerk::spur_nr("grp/1/fader"), 0);   // und umgekehrt
}

FALL(send_und_return_regler_global_mit_vorgaben) {
  // 1.10 Slice 3 (Spec 5.3): spur/<n>/send/<r> 32x4, grp/<n>/send/<r> 8x4, ret/<r>/{fader,pan,mute,solo} 4x4, ret/<r>/hall/* 4x7 = 204
  PRUEFE_GLEICH(tab().kanaele(), 20);   // keine neuen Kanäle
  int gezaehlt = 0;
  for (int r = 1; r <= RET_REGLER_RETURNS; r++) {
    char p[40];
    for (int n = 1; n <= SPUR_REGLER_SPUREN; n++) {
      std::snprintf(p, sizeof p, "spur/%d/send/%d", n, r);
      PRUEFE(d(p).kanal == -1 && d(p).rolle == Rolle::snd_spur && d(p).vorgabe == -200.0f && d(p).min == -200.0f && d(p).max == 6.0f &&
             d(p).db && !d(p).nur_hand && d(p).schalt_samples == 480 && d(p).kurve.typ == KurvenTyp::fader_db && d(p).kurve.max == 6.0f);
      gezaehlt++;
    }
    for (int n = 1; n <= GRP_REGLER_GRUPPEN; n++) {
      std::snprintf(p, sizeof p, "grp/%d/send/%d", n, r);
      PRUEFE(d(p).kanal == -1 && d(p).rolle == Rolle::snd_grp && d(p).vorgabe == -200.0f && d(p).min == -200.0f && d(p).max == 6.0f &&
             d(p).db && !d(p).nur_hand && d(p).schalt_samples == 480 && d(p).kurve.typ == KurvenTyp::fader_db);
      gezaehlt++;
    }
    std::snprintf(p, sizeof p, "ret/%d/fader", r);
    PRUEFE(d(p).kanal == -1 && d(p).rolle == Rolle::ret_fader && d(p).vorgabe == 0.0f && d(p).min == -200.0f && d(p).max == 6.0f && d(p).db &&
           !d(p).nur_hand && d(p).schalt_samples == 480 && d(p).kurve.typ == KurvenTyp::fader_db);
    std::snprintf(p, sizeof p, "ret/%d/pan", r);
    PRUEFE(d(p).rolle == Rolle::ret_pan && d(p).min == -1.0f && d(p).max == 1.0f && d(p).vorgabe == 0.0f && !d(p).nur_hand && d(p).schalt_samples == 480);
    std::snprintf(p, sizeof p, "ret/%d/mute", r);
    PRUEFE(d(p).rolle == Rolle::ret_mute && d(p).ganzzahlig && d(p).keine_rampe && d(p).schalt_samples == 0 && d(p).vorgabe == 0.0f);
    std::snprintf(p, sizeof p, "ret/%d/solo", r);
    PRUEFE(d(p).rolle == Rolle::ret_solo && d(p).ganzzahlig && d(p).keine_rampe && d(p).schalt_samples == 0 && d(p).vorgabe == 0.0f);
    gezaehlt += 4;
    struct H { const char* feld; Rolle rolle; float vorgabe; bool schalter; };
    const H hall[] = {{"an", Rolle::ret_hall_an, 1.0f, true},          {"pre", Rolle::ret_hall_pre, 0.04f, false},
                      {"decay", Rolle::ret_hall_decay, 0.5252f, false}, {"groesse", Rolle::ret_hall_groesse, 0.282f, false},
                      {"tief", Rolle::ret_hall_tief, 0.5658f, false},   {"highcut", Rolle::ret_hall_highcut, 0.8039f, false},
                      {"fahne", Rolle::ret_hall_fahne, 0.66667f, false}};
    for (const H& h : hall) {
      std::snprintf(p, sizeof p, "ret/%d/hall/%s", r, h.feld);
      PRUEFE(d(p).kanal == -1 && d(p).rolle == h.rolle && d(p).min == 0.0f && d(p).max == 1.0f && !d(p).nur_hand && !d(p).db && !d(p).transport);
      PRUEFE_NAH(d(p).vorgabe, h.vorgabe, 1e-6);
      if (h.schalter) PRUEFE(d(p).ganzzahlig && d(p).keine_rampe && d(p).schalt_samples == 0 && d(p).kurve.typ == KurvenTyp::schalter);
      else PRUEFE(!d(p).ganzzahlig && !d(p).keine_rampe && d(p).schalt_samples == 480 && d(p).kurve.typ == KurvenTyp::linear);
      gezaehlt++;
    }
  }
  PRUEFE_GLEICH(gezaehlt, 204);
  // Negativ-Kontrollen: n+1, 0, fremde Felder, Returns senden nicht an Returns
  for (const char* p : {"spur/33/send/1", "spur/1/send/5", "spur/1/send/0", "grp/9/send/1", "grp/1/send/5", "ret/5/fader", "ret/0/fader", "ret/1/hall/mix",
                        "ret/1/send/1", "ret/1/trim", "ret/1/hall", "ret/1/hall/an/x", "spur/1/send/01", "spur/1/send/10"})
    PRUEFE_GLEICH(tab().suche(p), -1);
}

FALL(send_und_return_regler_stehen_hinter_dem_bk_block_ohne_index_verschiebung) {
  // kein bestehender Index wandert: pm/fader 596, bk-Block 597..692, die 204 neuen Regler ab 693 (N0 = 693 vor Slice 3)
  PRUEFE_GLEICH(tab().suche("pm/fader"), 596);
  PRUEFE_GLEICH(tab().suche("deck/1/fader"), 0);
  PRUEFE_GLEICH(tab().suche("pad/2/bk/8"), 692);
  PRUEFE_GLEICH(tab().suche("spur/1/send/1"), 693);
  int kleinster = tab().anzahl();
  for (int r = 0; r < tab().anzahl(); r++) {
    const Rolle x = tab().def(r).rolle;
    if (x >= Rolle::snd_spur) kleinster = r < kleinster ? r : kleinster;
  }
  PRUEFE_GLEICH(kleinster, 693);
  // S14: the 16 send-return knobs fx/3|4/bk/<n> are the tail (897..912) and have the role bk_regler (before snd_spur), so the
  // 204 controls of slice 3 are still exactly the roles from snd_spur on
  int ab_snd = 0;
  for (int r = 0; r < tab().anzahl(); r++)
    if (tab().def(r).rolle >= Rolle::snd_spur && tab().def(r).rolle <= Rolle::ret_hall_fahne) ab_snd++;
  PRUEFE_GLEICH(ab_snd, 204);
  PRUEFE_GLEICH(tab().suche("fx/4/bk/8") - 897 + 1, 16);   // A1b: the tail of the old table is fx/4/bk/8 (912), the mix-tool block follows
}

FALL(ret_nr_und_send_nr_lesen_nummern) {
  using cypherdj::stellwerk::ret_nr;
  using cypherdj::stellwerk::send_nr;
  PRUEFE_GLEICH(ret_nr("ret/1/fader"), 1);
  PRUEFE_GLEICH(ret_nr("ret/4/hall/decay"), 4);
  PRUEFE_GLEICH(ret_nr("ret/12/pan"), 12);         // the parser checks the form, the binder checks the range
  PRUEFE_GLEICH(ret_nr("ret/0/fader"), 0);
  PRUEFE_GLEICH(ret_nr("ret/01/fader"), 0);
  PRUEFE_GLEICH(ret_nr("ret/1"), 0);
  PRUEFE_GLEICH(ret_nr("grp/1/fader"), 0);         // negative control: other namespace
  PRUEFE_GLEICH(ret_nr("spur/1/send/1"), 0);
  PRUEFE_GLEICH(send_nr("spur/3/send/2"), 2);
  PRUEFE_GLEICH(send_nr("grp/8/send/4"), 4);
  PRUEFE_GLEICH(send_nr("spur/3/send/0"), 0);
  PRUEFE_GLEICH(send_nr("spur/3/send/"), 0);
  PRUEFE_GLEICH(send_nr("spur/3/send/10"), 10);
  PRUEFE_GLEICH(send_nr("spur/3/send/02"), 0);
  PRUEFE_GLEICH(send_nr("spur/3/fader"), 0);       // negative control: other field
  PRUEFE_GLEICH(send_nr("ret/1/fader"), 0);
  PRUEFE_GLEICH(send_nr("spur/3/send/2/x"), 0);
}

// 1.15 A1b: the 345 mix-tool rows. The expectation below is written out here, NOT read from werkzeug_regler.h (a test that
// derives its expectation from the table under test cannot see a wrong table). Source: docs/architecture/INTERFACES.md section 1.5.
namespace {
const char* const Q13[] = {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3",
                           "erz/4",  "erz/5",  "erz/6",  "erz/7",  "pad/1", "pad/2"};
const char* const B4[] = {"bus/1", "bus/2", "bus/3", "bus/4"};
enum Art { NUR_QUELLEN, QUELLEN_UND_BUSSE, NUR_BUSSE, GLOBAL };
struct Z {
  const char* suffix;
  float min, max, vorgabe;
  bool ganz;   // switch or steps: no ramp, integer; otherwise a 10 ms ramp, linear curve
  bool schalter;
  Art art;
};
const Z ZEILEN[] = {
    {"gate/an", 0, 1, 0, true, true, NUR_QUELLEN},
    {"gate/schwelle", -90, 0, -40, false, false, NUR_QUELLEN},
    {"gate/hysterese", 0, 24, 4, false, false, NUR_QUELLEN},
    {"gate/ratio", 1, 100, 100, false, false, NUR_QUELLEN},
    {"gate/bereich", -120, 0, -80, false, false, NUR_QUELLEN},
    {"gate/attack", 0.1f, 500, 1, false, false, NUR_QUELLEN},
    {"gate/hold", 0, 2000, 20, false, false, NUR_QUELLEN},
    {"gate/release", 1, 5000, 100, false, false, NUR_QUELLEN},
    {"gate/sc", 0, 14, 0, true, false, NUR_QUELLEN},
    {"util/balance", -1, 1, 0, false, false, QUELLEN_UND_BUSSE},
    {"util/breite", 0, 200, 100, false, false, QUELLEN_UND_BUSSE},
    {"util/bassmono", 0, 500, 0, false, false, QUELLEN_UND_BUSSE},
    {"util/phase_l", 0, 1, 0, true, true, QUELLEN_UND_BUSSE},
    {"util/phase_r", 0, 1, 0, true, true, QUELLEN_UND_BUSSE},
    {"util/tausch", 0, 1, 0, true, true, QUELLEN_UND_BUSSE},
    {"util/dc", 0, 1, 0, true, true, QUELLEN_UND_BUSSE},
    {"mb/an", 0, 1, 0, true, true, NUR_BUSSE},
    {"mb/grenze_tief", 20, 20000, 200, false, false, NUR_BUSSE},
    {"mb/grenze_hoch", 20, 20000, 2000, false, false, NUR_BUSSE},
    {"mb/tief/schwelle", -60, 0, 0, false, false, NUR_BUSSE},
    {"mb/tief/ratio", 1, 20, 1, false, false, NUR_BUSSE},
    {"mb/tief/attack", 0.1f, 500, 10, false, false, NUR_BUSSE},
    {"mb/tief/release", 1, 5000, 100, false, false, NUR_BUSSE},
    {"mb/tief/knie", 0, 24, 0, false, false, NUR_BUSSE},
    {"mb/tief/makeup", -24, 24, 0, false, false, NUR_BUSSE},
    {"mb/tief/umgehen", 0, 1, 0, true, true, NUR_BUSSE},
    {"mb/mitte/schwelle", -60, 0, 0, false, false, NUR_BUSSE},
    {"mb/mitte/ratio", 1, 20, 1, false, false, NUR_BUSSE},
    {"mb/mitte/attack", 0.1f, 500, 10, false, false, NUR_BUSSE},
    {"mb/mitte/release", 1, 5000, 100, false, false, NUR_BUSSE},
    {"mb/mitte/knie", 0, 24, 0, false, false, NUR_BUSSE},
    {"mb/mitte/makeup", -24, 24, 0, false, false, NUR_BUSSE},
    {"mb/mitte/umgehen", 0, 1, 0, true, true, NUR_BUSSE},
    {"mb/hoch/schwelle", -60, 0, 0, false, false, NUR_BUSSE},
    {"mb/hoch/ratio", 1, 20, 1, false, false, NUR_BUSSE},
    {"mb/hoch/attack", 0.1f, 500, 10, false, false, NUR_BUSSE},
    {"mb/hoch/release", 1, 5000, 100, false, false, NUR_BUSSE},
    {"mb/hoch/knie", 0, 24, 0, false, false, NUR_BUSSE},
    {"mb/hoch/makeup", -24, 24, 0, false, false, NUR_BUSSE},
    {"mb/hoch/umgehen", 0, 1, 0, true, true, NUR_BUSSE},
    {"lim/an", 0, 1, 0, true, true, NUR_BUSSE},
    {"lim/decke", -60, 0, -0.3f, false, false, NUR_BUSSE},
    {"lim/abklingen", 1, 2000, 80, false, false, NUR_BUSSE},
    {"spektrum/kanal", 0, 19, 0, true, false, GLOBAL},
};

// calls f(path, row) for every one of the 345 expected paths
template <class F>
void je_erwarteter_pfad(F f) {
  char p[48];
  for (const Z& z : ZEILEN) {
    if (z.art == GLOBAL) {
      f(z.suffix, z);
      continue;
    }
    if (z.art != NUR_BUSSE)
      for (const char* k : Q13) { std::snprintf(p, sizeof p, "%s/%s", k, z.suffix); f(p, z); }
    if (z.art != NUR_QUELLEN)
      for (const char* k : B4) { std::snprintf(p, sizeof p, "%s/%s", k, z.suffix); f(p, z); }
  }
}
}  // namespace

FALL(werkzeug_zeilen_345_und_ihre_zaehlung) {
  int gate = 0, util = 0, mb = 0, lim = 0, spektrum = 0, gesamt = 0;
  je_erwarteter_pfad([&](const char* p, const Z& z) {
    PRUEFE(tab().suche(p) >= 0);   // each one is found
    gesamt++;
    if (!std::strncmp(z.suffix, "gate/", 5)) gate++;
    else if (!std::strncmp(z.suffix, "util/", 5)) util++;
    else if (!std::strncmp(z.suffix, "mb/", 3)) mb++;
    else if (!std::strncmp(z.suffix, "lim/", 4)) lim++;
    else spektrum++;
  });
  PRUEFE_GLEICH(gate, 117);
  PRUEFE_GLEICH(util, 119);
  PRUEFE_GLEICH(mb, 96);
  PRUEFE_GLEICH(lim, 12);
  PRUEFE_GLEICH(spektrum, 1);
  PRUEFE_GLEICH(gesamt, 345);
  PRUEFE_GLEICH(WERKZEUG_REGLER, 345);
  PRUEFE_GLEICH(tab().anzahl(), 1258 + 120 + 122 + 48 + 3);   // 1.10 slice 4a/4b/4c + limiter: the 293 insert rows (120 komp, 2 x 59 eq, 4 saett, 48 rack, 3 lim) follow the tool block
  // and the table holds no other row of this kind: the count by role is 345 as well
  int rollen = 0;
  for (int r = 0; r < tab().anzahl(); r++)
    rollen += tab().def(r).rolle == Rolle::werkzeug || tab().def(r).rolle == Rolle::spektrum_kanal;
  PRUEFE_GLEICH(rollen, 345);
}

FALL(werkzeug_zeilen_hinter_dem_bk_block_zusammenhaengend) {
  const int ende_alt = tab().suche("fx/4/bk/8");
  PRUEFE_GLEICH(ende_alt, 912);
  PRUEFE(tab().suche("deck/1/gate/an") > ende_alt);
  int kleinster = tab().anzahl(), groesster = -1, n = 0;
  for (int r = 0; r < tab().anzahl(); r++) {
    const Rolle x = tab().def(r).rolle;
    if (x != Rolle::werkzeug && x != Rolle::spektrum_kanal) continue;
    kleinster = r < kleinster ? r : kleinster;
    groesster = r > groesster ? r : groesster;
    n++;
  }
  PRUEFE_GLEICH(kleinster, ende_alt + 1);   // no row of the block has an index below 913
  PRUEFE_GLEICH(kleinster, 913);
  PRUEFE_GLEICH(groesster - kleinster + 1, n);   // contiguous
  PRUEFE_GLEICH(groesster, 1257);
  // every old pin survives
  PRUEFE_GLEICH(tab().suche("pm/fader"), 596);
  PRUEFE_GLEICH(tab().suche("pad/2/bk/8"), 692);
  PRUEFE_GLEICH(tab().suche("spur/1/send/1"), 693);
  PRUEFE_GLEICH(tab().suche("deck/1/fader"), 0);
  // the new roles are appended after the last old one: no role number moves
  PRUEFE(Rolle::werkzeug > Rolle::ret_hall_fahne && Rolle::spektrum_kanal > Rolle::werkzeug);
}

FALL(werkzeug_zeilen_bereich_vorgabe_rampe_ganz) {
  je_erwarteter_pfad([&](const char* p, const Z& z) {
    const int r = tab().suche(p);
    PRUEFE(r >= 0);
    if (r < 0) return;
    const ReglerDef& x = tab().def(r);
    PRUEFE_NAH(x.min, z.min, 0);
    PRUEFE_NAH(x.max, z.max, 0);
    PRUEFE_NAH(x.vorgabe, z.vorgabe, 1e-6);
    PRUEFE(!x.nur_hand && !x.db && !x.transport);
    PRUEFE_GLEICH(x.ganzzahlig, z.ganz);
    PRUEFE_GLEICH(x.keine_rampe, z.ganz);
    PRUEFE_GLEICH(x.schalt_samples, z.ganz ? 0 : 480);   // 10 ms for continuous rows, none for switches and steps (like komp/*)
    PRUEFE(x.rolle == (z.art == GLOBAL ? Rolle::spektrum_kanal : Rolle::werkzeug));
    PRUEFE(x.kurve.typ == (z.schalter ? KurvenTyp::schalter : z.ganz ? KurvenTyp::stufen : KurvenTyp::linear));
    PRUEFE(x.kurve.min == z.min && x.kurve.max == z.max);
    if (z.art == GLOBAL) {
      PRUEFE_GLEICH(x.kanal, -1);
    } else {
      PRUEFE(x.kanal >= 0);
      PRUEFE(x.kanal >= 0 && !std::strncmp(p, tab().kanal_name(x.kanal), std::strlen(tab().kanal_name(x.kanal))));
    }
  });
}

FALL(werkzeug_negativkontrollen) {
  // erz/8 is cue only (returns before every insert): no tool row. Buses get no gate, sources no multiband or limiter.
  for (const char* p : {"erz/8/gate/an", "erz/8/util/dc", "bus/1/gate/an", "deck/1/mb/an", "deck/1/lim/an", "bus/5/util/dc", "spektrum/kanal/1",
                        "bus/1/mb/tief/solo", "bus/1/util/gain_db", "erz/8/gate/schwelle", "master/gate/an", "bus/0/mb/an", "bus/1/mb/mitte",
                        "bus/1/lim/vorhalt_ms", "bus/1/lim/echtspitze", "deck/1/gate/sc/1", "spektrum", "deck/5/gate/an"})
    PRUEFE_GLEICH(tab().suche(p), -1);
  // harmless control: a path that must exist is found
  PRUEFE(tab().suche("bus/4/mb/hoch/umgehen") >= 0);
  PRUEFE(tab().suche("erz/4/gate/an") >= 0);   // erz/4 is a live channel (the production feeds it)
  PRUEFE(tab().suche("spektrum/kanal") >= 0);
}


FALL(bk_regler_nur_fuer_kanaele_mit_graph) {
  // S5r K2: <kanal>/bk/<1..8> gibt es genau für Kanäle, auf denen der Kern einen Baukasten-Graphen annimmt: deck/1..4
  // (Effekt, /k/kanal/graph) und die Instrument-Kanäle erz/1,2,3,5,6,7 und pad/1,2. Nicht erz/4 (reserviert für die
  // Produktion), nicht erz/8 (Nur-Cue-Vorhöreingang), nicht bus/*, master, cue. Gegen das echte Verhalten des Kerns
  // pinnt das test_netz_erz ("bk-Pfade genau auf den Kanälen, die einen Graphen annehmen").
  const char* mit[] = {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3", "erz/5", "erz/6", "erz/7", "pad/1", "pad/2"};
  for (int k = 0; k < tab().kanaele(); k++) {
    bool soll = false;
    for (const char* m : mit) soll = soll || !std::strcmp(m, tab().kanal_name(k));
    for (int nr = 1; nr <= 8; nr++) {
      char p[40];
      std::snprintf(p, sizeof p, "%s/bk/%d", tab().kanal_name(k), nr);
      PRUEFE_GLEICH(tab().suche(p) >= 0, soll);
    }
  }
  PRUEFE_GLEICH(tab().suche("erz/4/bk/1"), -1);
  PRUEFE_GLEICH(tab().suche("erz/8/bk/1"), -1);
  PRUEFE_GLEICH(tab().suche("bus/1/bk/1"), -1);
  PRUEFE_GLEICH(tab().suche("deck/1/bk/9"), -1);
  PRUEFE_GLEICH(tab().suche("deck/1/bk/0"), -1);
  // Definition: Rolle bk_regler, 0..1, Vorgabe 0,5, Schaltrampe 0 (K15: die FFI glättet), darf jeder, Kurve linear 0..1
  for (const char* p : {"deck/1/bk/1", "erz/3/bk/4", "erz/5/bk/8", "pad/2/bk/8"}) {
    const ReglerDef& x = d(p);
    PRUEFE(x.rolle == Rolle::bk_regler && x.min == 0.0f && x.max == 1.0f && x.vorgabe == 0.5f);
    PRUEFE(x.schalt_samples == 0 && !x.nur_hand && !x.db && !x.keine_rampe && !x.ganzzahlig && !x.transport);
    PRUEFE(x.kurve.typ == KurvenTyp::linear && x.kurve.min == 0.0f && x.kurve.max == 1.0f);
  }
  PRUEFE_GLEICH(d("erz/3/bk/4").kanal, tab().kanal_suche("erz/3"));
  PRUEFE_GLEICH(d("deck/2/bk/1").kanal, tab().kanal_suche("deck/2"));
  // D3: alle hinter pm/fader, kein bestehender Index wandert
  for (int r = 0; r < tab().anzahl(); r++)
    if (tab().def(r).rolle == Rolle::bk_regler) PRUEFE(r > tab().suche("pm/fader"));
  PRUEFE_GLEICH(tab().suche("pm/fader"), 596);
  PRUEFE_GLEICH(tab().suche("deck/1/fader"), 0);
}

FALL(fx_send_bk_regler_global_hinter_dem_ret_block) {
  // S14: eight graph knobs per send return fx/3, fx/4, global (channel -1) like fx/<n>/rueckweg, appended behind the ret block
  const ReglerDef& ref = d("deck/1/bk/1");
  int index = 897;
  for (const char* fx : {"fx/3", "fx/4"}) {
    for (int nr = 1; nr <= 8; nr++) {
      char p[40];
      std::snprintf(p, sizeof p, "%s/bk/%d", fx, nr);
      PRUEFE_GLEICH(tab().suche(p), index);
      index++;
      const ReglerDef& x = d(p);
      PRUEFE_GLEICH(x.kanal, -1);
      PRUEFE(x.rolle == Rolle::bk_regler && x.min == 0.0f && x.max == 1.0f && x.vorgabe == 0.5f);
      PRUEFE(x.schalt_samples == 0 && !x.nur_hand && !x.db && !x.keine_rampe && !x.ganzzahlig && !x.transport);
      PRUEFE(x.kurve.typ == ref.kurve.typ && x.kurve.min == ref.kurve.min && x.kurve.max == ref.kurve.max);
      PRUEFE(x.kurve.typ == KurvenTyp::linear);
    }
  }
  PRUEFE_GLEICH(index, 913);
  // negative controls: other send buses and the channel namespace stay free, the n form is checked
  for (const char* p : {"fx/1/bk/1", "fx/2/bk/1", "fx/5/bk/1", "fx/3/bk/0", "fx/3/bk/9", "fx/3/bk/01", "fx/3/bk/10", "fx/3/bk", "fx/4/bk/9", "fx/0/bk/1"})
    PRUEFE_GLEICH(tab().suche(p), -1);
}

// 1.10 slice 4a T1, negative control: the first 1258 rows (package 1.15 state) are unchanged by the insert rows. The hash is FNV-1a 64 of
// the text dump `pfad|rolle|min|max|vorgabe` per row (`%s|%d|%.9g|%.9g|%.9g`), taken at the parent commit before T1
// (docs/architecture/stand/routing-1-10.md, "Slice 4 start state"; sha256 of the same dump 16d6e933...0da9).
FALL(die_ersten_1258_zeilen_sind_unveraendert) {
  uint64_t h = 0xcbf29ce484222325ull;
  for (int r = 0; r < 1258; r++) {
    const ReglerDef& z = tab().def(r);
    char zeile[160];
    const int n = std::snprintf(zeile, sizeof zeile, "%s|%d|%.9g|%.9g|%.9g\n", z.pfad, static_cast<int>(z.rolle), static_cast<double>(z.min),
                                static_cast<double>(z.max), static_cast<double>(z.vorgabe));
    for (int i = 0; i < n; i++) h = (h ^ static_cast<unsigned char>(zeile[i])) * 0x100000001b3ull;
  }
  PRUEFE_GLEICH(static_cast<long long>(h), static_cast<long long>(0xc01227d2bfc9b294ull));
  PRUEFE_GLEICH(std::strcmp(tab().def(1257).pfad, "spektrum/kanal"), 0);
  PRUEFE_GLEICH(std::strcmp(tab().def(1258).pfad, "ins/komp/1/an"), 0);   // the insert block starts right behind the tool block
  PRUEFE_GLEICH(std::strcmp(tab().def(1377).pfad, "ins/komp/12/sc"), 0);
}

PRUEF_MAIN
