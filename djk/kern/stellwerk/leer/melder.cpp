// Leere Schnittstelle (Scheibe 11, Fehlerfall vorher): keine Meldungen.
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

void Stellwerk::melde_hand(int, int64_t) {}
void Stellwerk::melder_zyklusende(int64_t) {}

}  // namespace cypherdj::stellwerk
