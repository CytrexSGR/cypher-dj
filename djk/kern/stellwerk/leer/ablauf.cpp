// Leere Schnittstelle (Scheibe 11, Fehlerfall vorher): die Zeit läuft, sonst nichts.
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

void Stellwerk::starte(int, int64_t, int, double) {}
int Stellwerk::rechne_strecke(int, int, int) { return -1; }
void Stellwerk::prozess(int64_t s0, int n) {
  n_aend_ = 0;
  jetzt_ = s0 + n;
}

}  // namespace cypherdj::stellwerk
