// Leere Schnittstelle (Scheibe 11, Fehlerfall vorher): Hand ohne Wirkung.
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

void Stellwerk::hand(const Griff&) {}
void Stellwerk::deck_taste(int, int64_t) {}
bool Stellwerk::deck_beruehrt(int) const { return false; }
bool Stellwerk::mensch_bei(int, int64_t, int) const { return false; }
void Stellwerk::uebernehmen(int, int64_t) {}
void Stellwerk::hand_anwenden(const Griff&, int64_t, int, double) {}

}  // namespace cypherdj::stellwerk
