// Leere Schnittstelle (Scheibe 11, Fehlerfall vorher): Prüfer wird nie gefragt.
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

Grund Stellwerk::pruefe_vor_start(int) { return Grund::kein; }
void Stellwerk::pruefe_je_zyklus() {}
void Stellwerk::pruefe_nach_hand(int, int64_t) {}
void Stellwerk::melde_gruppe_gefallen(const char*, const char*, Grund, int64_t) {}

}  // namespace cypherdj::stellwerk
