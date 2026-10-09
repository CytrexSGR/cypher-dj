// Stellwerk-RT: Takt der Meldungen. /e/regler bei jeder Änderung höchstens 50 Hz je Regler (§5.7; Teilstart,
// Teilende und Halterwechsel meldet kern.cpp sofort), /e/hand erstes und letztes Ereignis einer Geste plus
// höchstens 20 Hz (§5.8). Beides als Drossel mit Nachzügler: was im Fenster unterdrückt wurde, kommt am Fensterende.
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

void Stellwerk::melde_hand(int r, int64_t sample) {
  ReglerZustand& z = reg_[r];
  z.hand_wert = fest(z);
  z.hand_sample = sample;
  if (sample - z.hand_gemeldet_sample >= HAND_MELDUNG_ABSTAND) {
    Ereignis* e = neues_ereignis(EreignisArt::hand, sample);
    if (e) {
      e->regler = static_cast<int16_t>(r);
      e->wert = fest(z);
    }
    z.hand_gemeldet_sample = sample;
    return;
  }
  if (!z.hand_ausstehend) {
    z.hand_ausstehend = true;
    ausstehend_hand_[n_ausstehend_hand_++] = static_cast<int16_t>(r);
  }
}

void Stellwerk::melder_zyklusende(int64_t s_letzt) {
  // Hand: Nachzügler, sobald das 20-Hz-Fenster vorbei ist
  for (int k = 0; k < n_ausstehend_hand_;) {
    const int r = ausstehend_hand_[k];
    ReglerZustand& z = reg_[r];
    if (s_letzt - z.hand_gemeldet_sample >= HAND_MELDUNG_ABSTAND) {
      Ereignis* e = neues_ereignis(EreignisArt::hand, z.hand_sample);
      if (e) {
        e->regler = static_cast<int16_t>(r);
        e->wert = z.hand_wert;
      }
      z.hand_gemeldet_sample = s_letzt;   // Fenster zählt ab dem Senden
      z.hand_ausstehend = false;
      ausstehend_hand_[k] = ausstehend_hand_[--n_ausstehend_hand_];
    } else {
      k++;
    }
  }
  // Regler: bewegt in diesem Zyklus oder noch ausstehend
  for (int k = 0; k < n_aend_; k++) {
    const int r = aend_[k].regler;
    ReglerZustand& z = reg_[r];
    if (fest(z) != z.gemeldet && !z.ausstehend) {
      z.ausstehend = true;
      ausstehend_regler_[n_ausstehend_regler_++] = static_cast<int16_t>(r);
    }
  }
  for (int k = 0; k < n_ausstehend_regler_;) {
    const int r = ausstehend_regler_[k];
    ReglerZustand& z = reg_[r];
    if (fest(z) == z.gemeldet) {
      z.ausstehend = false;
      ausstehend_regler_[k] = ausstehend_regler_[--n_ausstehend_regler_];
    } else if (s_letzt - z.gemeldet_sample >= REGLER_MELDUNG_ABSTAND) {
      melde_regler(r, s_letzt);
      z.ausstehend = false;
      ausstehend_regler_[k] = ausstehend_regler_[--n_ausstehend_regler_];
    } else {
      k++;
    }
  }
}

}  // namespace cypherdj::stellwerk
