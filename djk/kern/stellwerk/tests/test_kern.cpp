// Scheibe 11, Task 5: Zustand des Stellwerks: Vorgaben aus der Tabelle, Halter frei, Setzen ohne Teil.
#include "pruef.h"
#include "szenario.h"

using namespace probe;

FALL(vorgaben_aus_der_tabelle) {
  Lauf l;
  PRUEFE_NAH(l.sw->wert(l.r("deck/1/fader")), -200, 0);
  PRUEFE_NAH(l.sw->wert(l.r("cue/pegel")), -12, 0);
  PRUEFE_NAH(l.sw->wert(l.r("fx/1/notenwert")), 0.75, 0);
  PRUEFE_NAH(l.sw->wert(l.r("deck/2/xseite")), 1, 0);
  PRUEFE(l.sw->halter(l.r("deck/1/fader")).art == HalterArt::frei);
  PRUEFE(!l.sw->ki_gestoppt());
}

FALL(setze_direkt_aendert_den_wert_ohne_quittung) {
  Lauf l;
  l.sw->setze_direkt(l.r("deck/1/fader"), -6.0f);
  PRUEFE_NAH(l.sw->wert(l.r("deck/1/fader")), -6, 0);
  l.nachlese_ereignisse();
  PRUEFE_GLEICH(l.ereignisse.size(), 0);
  l.sw->setze_direkt(-1, 3.0f);    // Negativ-Kontrolle: ungültiger Index ändert nichts
  l.sw->setze_direkt(9999, 3.0f);
  PRUEFE_NAH(l.sw->wert(l.r("deck/1/fader")), -6, 0);
  PRUEFE_NAH(l.sw->wert(l.r("deck/1/trim")), 0, 0);
}

PRUEF_MAIN
