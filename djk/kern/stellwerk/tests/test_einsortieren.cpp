// Scheibe 11, Task 6: /k/teil beim Einsortieren (§4.3, §16.1, §16.2, §17 I4) und /k/abbruch wartender Teile.
#include "pruef.h"
#include "szenario.h"

using namespace probe;

FALL(angenommen_mit_quittung_1_am_jetzt) {
  Lauf l;
  l.bis(T(9));
  const int64_t id = l.teil("deck/1/fader", B(17), 32, -200, "p1", 0);
  PRUEFE_GLEICH(l.sw->jetzt(), 720128);              // erster Zyklusanfang ab Takt 9 (720 000 liegt mitten im Block)
  PRUEFE_GLEICH(l.bei(id, Status::angenommen), 720128);
  PRUEFE_GLEICH(l.quittungen(id).size(), 1);
}

FALL(unbekannt_nur_hand_bereich_stems) {
  Lauf l;
  PRUEFE(l.grund(l.teil("deck/9/fader", 8, 0, 0), Status::abgelehnt) == Grund::unbekannter_regler);
  PRUEFE(l.grund(l.teil("xfader", 8, 4, 0.5f), Status::abgelehnt) == Grund::nur_hand);
  PRUEFE(l.grund(l.teil("bus/1/fader", 8, 4, -6), Status::abgelehnt) == Grund::nur_hand);
  PRUEFE(l.bei(l.teil("bus/1/fader", 8, 4, -6, "", 0, "", Quelle::andreas), Status::angenommen) == 0);   // die Hand darf
  PRUEFE(l.grund(l.teil("deck/1/fader", 8, 4, 3.0f), Status::abgelehnt) == Grund::ausserhalb_bereich);
  PRUEFE(l.grund(l.teil("deck/1/kill/tief", 8, 4, 1), Status::abgelehnt) == Grund::ausserhalb_bereich);   // Schalter ohne Rampe
  PRUEFE(l.grund(l.teil("deck/1/kill/tief", 8, 0, 0.5f), Status::abgelehnt) == Grund::ausserhalb_bereich);
  PRUEFE(l.grund(l.teil("deck/1/fader", 8, -1, -6), Status::abgelehnt) == Grund::ausserhalb_bereich);
  PRUEFE(l.grund(l.teil("deck/1/fader", 8, 4, -6, "", 0, "", Quelle::cypher, 2), Status::abgelehnt) == Grund::ausserhalb_bereich);
  PRUEFE(l.grund(l.teil("deck/1/fader", 8, 4, -6, "", 0, "", Quelle::cypher, 0, 2), Status::abgelehnt) == Grund::ausserhalb_bereich);
  PRUEFE(l.grund(l.teil("deck/2/stem/bass", 8, 4, -6), Status::abgelehnt) == Grund::keine_stems);
  l.sw->stems_geladen(2, true);
  PRUEFE(l.bei(l.teil("deck/2/stem/bass", 8, 4, -6), Status::angenommen) == 0);
  PRUEFE(l.grund(l.teil("deck/3/stem/bass", 8, 4, -6), Status::abgelehnt) == Grund::keine_stems);
}

// Keylock Task 3: der globale Schalter `keylock`, Quelle cypher darf (kein nur_hand), nur Setzen (keine Rampe), 0 und 1
FALL(keylock_cypher_darf_setzen) {
  Lauf l;
  const int r = l.r("keylock");
  PRUEFE(r >= 0);
  PRUEFE_NAH(l.sw->wert(r), 1, 0);  // Vorgabe an
  const int64_t a = l.teil("keylock", 8, 0, 0, "", 0, "", Quelle::cypher);
  PRUEFE_GLEICH(l.bei(a, Status::angenommen), 0);
  PRUEFE(l.grund(l.teil("keylock", 16, 4, 1), Status::abgelehnt) == Grund::ausserhalb_bereich);    // Schalter ohne Rampe
  PRUEFE(l.grund(l.teil("keylock", 16, 0, 0.5f), Status::abgelehnt) == Grund::ausserhalb_bereich);  // nur 0 oder 1
  PRUEFE(l.grund(l.teil("deck/1/keylock", 16, 0, 0), Status::abgelehnt) == Grund::unbekannter_regler);
  l.bis(T(4));
  PRUEFE_NAH(l.sw->wert(r), 0, 0);  // ab Beat 8 aus
  const int64_t b = l.teil("keylock", 16, 0, 1, "", 0, "", Quelle::leitstand);
  PRUEFE_GLEICH(l.bei(b, Status::angenommen), l.sw->jetzt());
  l.bis(T(6));
  PRUEFE_NAH(l.sw->wert(r), 1, 0);
}

FALL(zu_spaet_politik_0_verworfen_politik_1_angenommen) {
  Lauf l;
  l.bis(25600);
  const int64_t a = l.teil("deck/2/fader", 0.5, 0, -3, "z", 0, "", Quelle::cypher, 0);
  const int64_t b = l.teil("deck/2/eq/hoch", 0.5, 0, -3, "z", 1, "", Quelle::cypher, 1);
  PRUEFE_GLEICH(l.bei(a, Status::verspaetet_verworfen), 25600);
  PRUEFE(l.grund(a, Status::verspaetet_verworfen) == Grund::zu_spaet);
  PRUEFE_GLEICH(l.quittungen(a).size(), 1);
  PRUEFE_GLEICH(l.bei(b, Status::angenommen), 25600);
  // Negativ-Kontrolle: genau am jetzt ist nicht zu spät
  const int64_t c = l.teil("deck/2/eq/mitte", 25600.0 * 128 / 60 / SR, 0, -3);
  PRUEFE_GLEICH(l.bei(c, Status::angenommen), 25600);
}

FALL(i4_ueberlappung_auch_im_selben_plan) {
  Lauf l;
  const int64_t a = l.teil("deck/1/fader", 64, 32, -30, "p", 1);
  const int64_t b = l.teil("deck/1/fader", 72, 32, -60, "p", 2);
  const int64_t c = l.teil("deck/1/fader", 80, 8, 0, "q", 0, "", Quelle::leitstand);
  const int64_t d = l.teil("deck/1/fader", 96, 8, -10, "p", 3);          // angrenzend: erlaubt
  const int64_t e = l.teil("deck/1/fader", 60, 4, -10, "p", 4);          // endet genau am Start: erlaubt
  const int64_t f = l.teil("deck/1/fader", 70, 0, -10, "r", 1);          // Setzen mitten in der Rampe: abgelehnt
  PRUEFE_GLEICH(l.bei(a, Status::angenommen), 0);
  PRUEFE(l.grund(b, Status::abgelehnt) == Grund::ueberlappung);
  PRUEFE(l.grund(c, Status::abgelehnt) == Grund::ueberlappung);
  PRUEFE_GLEICH(l.bei(d, Status::angenommen), 0);
  PRUEFE_GLEICH(l.bei(e, Status::angenommen), 0);
  PRUEFE(l.grund(f, Status::abgelehnt) == Grund::ueberlappung);
  const int64_t h = l.teil("deck/1/eq/tief", 72, 32, -60, "p", 5);        // anderer Regler: erlaubt
  PRUEFE_GLEICH(l.bei(h, Status::angenommen), 0);
}

FALL(i4_setzen_und_rampe_am_selben_beat_nach_startfolge) {
  // Herleitung der Golden-Folgen (09, herleitung.py i4_ueberlappt): Setzen vor der Rampe erlaubt, danach nicht
  Lauf l;
  const int64_t a = l.teil("deck/1/fader", 64, 32, -30, "p", 1);          // Rampe, Teil 1
  const int64_t b = l.teil("deck/1/fader", 64, 0, -10, "p", 0);           // Setzen, Teil 0: vor der Rampe, erlaubt
  const int64_t c = l.teil("deck/1/fader", 64, 0, -12, "p", 2);           // Setzen, Teil 2: nach der Rampe, abgelehnt
  const int64_t d = l.teil("deck/1/fader", 64, 0, -12, "r", 0);           // anderer Plan, später: nach der Rampe
  PRUEFE_GLEICH(l.bei(a, Status::angenommen), 0);
  PRUEFE_GLEICH(l.bei(b, Status::angenommen), 0);
  PRUEFE(l.grund(c, Status::abgelehnt) == Grund::ueberlappung);
  PRUEFE(l.grund(d, Status::abgelehnt) == Grund::ueberlappung);
  // zwei Setzen am selben Beat überlappen, auch planübergreifend
  const int64_t e = l.teil("deck/1/eq/tief", 40, 0, -10, "p", 3);
  const int64_t f = l.teil("deck/1/eq/tief", 40, 0, -20, "s", 0);
  PRUEFE_GLEICH(l.bei(e, Status::angenommen), 0);
  PRUEFE(l.grund(f, Status::abgelehnt) == Grund::ueberlappung);
  // Negativ-Kontrolle: schon angenommenes Setzen eines anderen Plans, neue Rampe am selben Beat: erlaubt (Setzen zuerst,
  // der Ablauf dazu steht in test_ablauf: setzen_fremder_plan_vor_rampe_am_selben_beat)
  const int64_t g = l.teil("deck/1/eq/mitte", 40, 0, -10, "q", 0);
  const int64_t h = l.teil("deck/1/eq/mitte", 40, 8, -30, "t", 0);
  PRUEFE_GLEICH(l.bei(g, Status::angenommen), 0);
  PRUEFE_GLEICH(l.bei(h, Status::angenommen), 0);
  // Setzen nach einer Rampe am selben Beat, ohne ein weiteres Setzen dort (sonst verdeckt die Regel „zwei Setzen“
  // diesen Fall, Mutation M30): höhere Nummer im selben Plan und fremder Plan werden abgelehnt
  const int64_t i = l.teil("deck/1/eq/hoch", 48, 8, -30, "p", 6);
  const int64_t j = l.teil("deck/1/eq/hoch", 48, 0, -10, "p", 7);
  const int64_t k = l.teil("deck/1/eq/hoch", 48, 0, -10, "u", 0);
  PRUEFE_GLEICH(l.bei(i, Status::angenommen), 0);
  PRUEFE(l.grund(j, Status::abgelehnt) == Grund::ueberlappung);
  PRUEFE(l.grund(k, Status::abgelehnt) == Grund::ueberlappung);
}

FALL(transport_ist_kein_regler_fuer_teile) {
  Lauf l;
  PRUEFE(l.grund(l.teil("deck/1/transport", 8, 0, 0, "", 0, "", Quelle::andreas), Status::abgelehnt) == Grund::unbekannter_regler);
}

FALL(abbruch_quittiert_angenommen_und_fertig_ohne_plan_nur_eigene_quelle) {
  Lauf l;
  const int64_t a = l.teil("deck/1/eq/hoch", 64, 32, -26, "", 0, "", Quelle::leitstand);
  const int64_t b = l.teil("deck/1/eq/mitte", 64, 32, -26, "", 0, "", Quelle::andreas);
  l.sw->abbruch(90, Quelle::leitstand, "", nullptr, -1);
  l.nachlese_ereignisse();
  PRUEFE_GLEICH(l.bei(90, Status::angenommen), 0);
  PRUEFE_GLEICH(l.bei(90, Status::fertig), 0);
  PRUEFE(l.grund(a, Status::abgebrochen) == Grund::abbruch);
  PRUEFE_GLEICH(l.bei(b, Status::abgebrochen), -1);   // Negativ-Kontrolle: fremde Quelle bleibt
}

FALL(abbruch_wartender_teile_samt_gruppe) {
  Lauf l;
  const int64_t a = l.teil("deck/1/fader", 64, 32, -30, "p", 0, "a_raus");
  const int64_t b = l.teil("deck/1/eq/mitte", 64, 32, -26, "p", 1, "a_raus");
  const int64_t c = l.teil("deck/1/eq/hoch", 64, 32, -26, "p", 2, "");
  const int64_t d = l.teil("deck/2/fader", 64, 32, 0, "q", 0, "a_raus");   // andere Pläne bleiben
  const int32_t nrs[] = {0};
  l.sw->abbruch(77, Quelle::leitstand, "p", nrs, 1);
  l.nachlese_ereignisse();
  PRUEFE(l.grund(a, Status::abgebrochen) == Grund::abbruch);
  PRUEFE(l.grund(b, Status::abgebrochen) == Grund::abbruch);   // gleiche Gruppe fällt mit
  PRUEFE_GLEICH(l.bei(c, Status::abgebrochen), -1);             // Negativ-Kontrolle: ohne Gruppe bleibt
  PRUEFE_GLEICH(l.bei(d, Status::abgebrochen), -1);
  PRUEFE_GLEICH(l.bei(77, Status::fertig), 0);
  l.sw->abbruch(78, Quelle::leitstand, "p", nullptr, -1);
  l.nachlese_ereignisse();
  PRUEFE(l.grund(c, Status::abgebrochen) == Grund::abbruch);
}

PRUEF_MAIN
