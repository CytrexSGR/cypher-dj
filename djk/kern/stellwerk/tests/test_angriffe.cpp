// Scheibe 11, Task 13: Angriffsfälle a3 bis a5 aus proben/09-ki-steuerung/nachpruefung/angriff.mjs, portiert.
// Jeder Fall mit Negativ-Kontrolle (derselbe Aufbau ohne den auslösenden Umstand) wie im Original.
// Ergebnis des Prototyps (angriff_ergebnis.json): a3 Sprung 0,4; a4 Sprung 0,3675; a5 Plan abgebrochen, A bei 0,5941.
#include "pruef.h"
#include "szenario.h"

using namespace probe;

namespace {
const float A08 = dB(0.8);
Lauf* neu() {
  Lauf* l = new Lauf();
  l->sw->setze_direkt(l->r("deck/1/fader"), A08);
  l->beobachte("deck/1/fader");
  l->bis(T(9));
  return l;
}
}  // namespace

// a3: zwei überlappende Teile am selben Regler im selben Plan. Prototyp: angenommen, Sprünge 0,175 -> 0,4 und 0,4 -> 0.
FALL(a3_ueberlappung_im_selben_plan_abgelehnt_kein_sprung) {
  std::unique_ptr<Lauf> l(neu());
  const int64_t a = l->teil("deck/1/fader", B(17), 32, dB(0.4), "pu", 0);
  const int64_t b = l->teil("deck/1/fader", B(19), 32, -200, "pu", 1);
  l->bis(T(29));
  PRUEFE(l->grund(b, Status::abgelehnt) == Grund::ueberlappung);
  PRUEFE_GLEICH(l->bei(a, Status::fertig), T(25));
  PRUEFE(l->max_schritt("deck/1/fader") < 1e-4);
}

FALL(a3_negativ_kontrolle_nacheinander) {
  std::unique_ptr<Lauf> l(neu());
  const int64_t a = l->teil("deck/1/fader", B(17), 16, dB(0.4), "pu", 0);
  const int64_t b = l->teil("deck/1/fader", B(21), 24, -200, "pu", 1);
  l->bis(T(29));
  PRUEFE_GLEICH(l->bei(a, Status::fertig), T(21));
  PRUEFE_GLEICH(l->bei(b, Status::gestartet), T(21));
  PRUEFE_GLEICH(l->bei(b, Status::fertig), T(27));
  PRUEFE(l->max_schritt("deck/1/fader") <= 0.0011);   // nur -60 dB -> stumm am Ende
}

// a4: Knopfstellung unbekannt (steht bei 0,31), Andreas dreht leicht auf. Prototyp: Sprung 0,3675 am Griff-Sample.
FALL(a4_knopf_unbekannt_erster_wert_nur_stellung_kein_sprung) {
  std::unique_ptr<Lauf> l(neu());
  const int64_t id = l->teil("deck/1/fader", B(17), 32, -200, "p1", 0);
  for (int j = 0; j < 12; j++) l->griff(T(19) + j * 937, "deck/1/fader", 0.31f + j / 127.0f);
  l->bis(T(21));
  PRUEFE_GLEICH(l->bei(id, Status::abgebrochen), T(19) + 3 * 937);   // Übernahme nach der Totzone (3/127 > 3/128)
  PRUEFE(l->max_schritt("deck/1/fader") < 0.05);
}

FALL(a4_negativ_kontrolle_knopf_wie_angenommen) {
  std::unique_ptr<Lauf> l(neu());
  l->griff(1000, "deck/1/fader", 0.8f);
  const int64_t id = l->teil("deck/1/fader", B(17), 32, -200, "p1", 0);
  for (int j = 1; j <= 12; j++) l->griff(T(19) + j * 937, "deck/1/fader", 0.8f + j / 127.0f);
  l->bis(T(21));
  PRUEFE_GLEICH(l->bei(id, Status::abgebrochen), T(19) + 3 * 937);
  PRUEFE(l->max_schritt("deck/1/fader") < 0.05);
}

// a5: ein einzelnes Rauschereignis einen MIDI-Schritt unter der Stellung. Prototyp: Plan teilweise, A bei 0,5941.
FALL(a5_ein_rauschschritt_unter_der_totzone_bricht_nichts_ab) {
  std::unique_ptr<Lauf> l(neu());
  l->griff(1000, "deck/1/fader", 0.8f);
  const int64_t id = l->teil("deck/1/fader", B(17), 32, -200, "p1", 0);
  l->griff(T(19), "deck/1/fader", 0.8f - 1.0f / 127);
  l->bis(T(27));
  PRUEFE_GLEICH(l->bei(id, Status::abgebrochen), -1);
  PRUEFE_GLEICH(l->bei(id, Status::fertig), T(25));
  PRUEFE_NAH(l->wert_bei("deck/1/fader", T(25)), -200, 0);
}

FALL(a5_negativ_kontrolle_ohne_rauschen) {
  std::unique_ptr<Lauf> l(neu());
  l->griff(1000, "deck/1/fader", 0.8f);
  const int64_t id = l->teil("deck/1/fader", B(17), 32, -200, "p1", 0);
  l->bis(T(27));
  PRUEFE_GLEICH(l->bei(id, Status::fertig), T(25));
  PRUEFE_NAH(l->wert_bei("deck/1/fader", T(25)), -200, 0);
}

FALL(a5_positiv_kontrolle_ein_griff_ueber_der_totzone_bricht_ab) {
  std::unique_ptr<Lauf> l(neu());
  l->griff(1000, "deck/1/fader", 0.8f);
  const int64_t id = l->teil("deck/1/fader", B(17), 32, -200, "p1", 0);
  l->griff(T(19), "deck/1/fader", 0.8f - 4.0f / 128);
  l->bis(T(27));
  PRUEFE_GLEICH(l->bei(id, Status::abgebrochen), T(19));
}

PRUEF_MAIN
