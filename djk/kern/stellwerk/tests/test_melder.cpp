// Scheibe 11, Task 10: Takt der Meldungen: /e/regler höchstens 50 Hz je Regler plus Start, Ende, Halterwechsel (§5.7),
// /e/hand erstes und letztes Ereignis einer Geste plus höchstens 20 Hz (§5.8).
#include <vector>

#include "pruef.h"
#include "szenario.h"

using namespace probe;

FALL(regler_waehrend_der_rampe_hoechstens_50_hz) {
  Lauf l;
  l.sw->setze_direkt(l.r("deck/2/fader"), -15.0f);
  l.teil("deck/2/fader", 64, 32, 0, "p1", 0);
  l.bis(2200000);
  std::vector<int64_t> s;
  int direkt = 0;
  for (const Ereignis& e : l.ereignisse) {
    if (e.art != EreignisArt::regler || e.regler != l.r("deck/2/fader")) continue;
    if (e.sample < 1440000) direkt += e.sample == 255 && e.wert == -15.0f;   // setze_direkt ist auch eine Änderung
    else s.push_back(e.sample);
  }
  PRUEFE_GLEICH(direkt, 1);
  PRUEFE(s.size() > 600);                               // bei jeder Änderung gemeldet (15 s Rampe)
  PRUEFE(s.size() < 760);                               // höchstens 50 Hz: 720 000 / 960 = 750, plus Start und Ende
  PRUEFE_GLEICH(s.front(), 1440000);                    // Teilstart
  int zu_dicht = 0;
  for (size_t k = 1; k < s.size(); k++) {
    const bool pflicht = s[k] == 2160000 || s[k - 1] == 1440000;
    if (!pflicht && s[k] - s[k - 1] < REGLER_MELDUNG_ABSTAND) zu_dicht++;
  }
  PRUEFE_GLEICH(zu_dicht, 0);
  bool ende = false;
  for (const Ereignis& e : l.ereignisse)
    ende = ende || (e.art == EreignisArt::regler && e.sample == 2160000 && e.wert == 0.0f);
  PRUEFE(ende);                                         // Teilende mit Endwert
}

FALL(ohne_bewegung_keine_reglermeldung) {
  Lauf l;
  l.bis(500000);
  PRUEFE_GLEICH(l.zahl(EreignisArt::regler), 0);
}

FALL(hand_geste_erstes_letztes_und_hoechstens_20_hz) {
  Lauf l;
  l.griff(1000, "deck/1/fader", 0.5f);   // Stellung, keine Meldung
  for (int j = 1; j <= 12; j++) l.griff(100000 + static_cast<int64_t>(j * 937.5), "deck/1/fader", 0.5f + j / 127.0f);
  l.bis(130000);
  std::vector<const Ereignis*> h;
  for (const Ereignis& e : l.ereignisse)
    if (e.art == EreignisArt::hand) h.push_back(&e);
  PRUEFE(h.size() >= 2);
  PRUEFE(h.size() <= 1 + (11250 / HAND_MELDUNG_ABSTAND) + 1);   // Anfang, höchstens 20 Hz, Nachzügler
  if (h.empty()) return;
  PRUEFE_GLEICH(h.front()->sample, 100000 + 937);               // erstes Ereignis der Geste
  PRUEFE_GLEICH(h.back()->sample, 100000 + 11250);              // letztes Ereignis der Geste
  PRUEFE_NAH(h.back()->wert, l.sw->wert(l.r("deck/1/fader")), 0);
}

FALL(nur_stellung_meldet_keine_hand) {
  Lauf l;
  l.griff(1000, "deck/1/fader", 0.5f);
  l.bis(10000);
  PRUEFE_GLEICH(l.zahl(EreignisArt::hand), 0);
}

PRUEF_MAIN
