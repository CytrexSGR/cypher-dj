// Scheibe 11, Task 4: Regler-Tabelle gegen SCHNITTSTELLEN §1.5 und Standard-Kurven gegen §7.2.
#include <cstring>

#include "pruef.h"
#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/stellwerk/typen.h"

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
  // x 8 `komp/*` (2026-10-11, mit komp/sc): 436; D1 K1: dazu 8 Spuren x 4 Spur-Regler (spur/<n>/*, global): 468
  PRUEFE_GLEICH(tab().anzahl(), 468);
  PRUEFE_GLEICH(tab().kanaele(), 20);
  PRUEFE_GLEICH(tab().kanal_suche("deck/1"), 0);
  PRUEFE_GLEICH(tab().kanal_suche("bus/4"), 17);
  PRUEFE_GLEICH(tab().kanal_suche("cue"), 19);
  PRUEFE_GLEICH(tab().kanal_suche("deck/5"), -1);
}

FALL(spur_regler_global_mit_vorgaben) {
  // D1 K1 (Spec 2.3): spur/1..8 je fader, pan, mute, solo an Kanal −1, keine neuen Kanäle, alle dürfen
  PRUEFE_GLEICH(tab().kanaele(), 20);
  for (int n = 1; n <= 8; n++) {
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
  PRUEFE(tab().suche("spur/9/fader") < 0);   // Negativ-Kontrolle
  PRUEFE(tab().suche("spur/0/pan") < 0);
}

FALL(spur_fader_bis_plus_6_db) {
  // D1 Spec 6.16 (§4 Wertebereiche): spur/<n>/fader −200..+6 dB, Vorgabe 0. Hand-Kurve fader_db bis +6: ganz oben +6,
  // 0 dB bei Stellung 10^(−6/20) ≈ 0,501. Kanal-Fader bleiben −200..0 (Negativ-Kontrolle).
  for (int n = 1; n <= 8; n++) {
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
  PRUEFE(cypherdj::stellwerk::MAX_REGLER - tab().anzahl() >= 44);   // D1 K1: 512 − 468 (Spec 2.3)
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

PRUEF_MAIN
