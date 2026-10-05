// Leere Schnittstelle (Scheibe 11, Fehlerfall vorher): KI-Befehle ohne Wirkung.
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

void Stellwerk::ki_stopp(int64_t, Quelle) {}
void Stellwerk::ki_frei(int64_t, Quelle) {}
void Stellwerk::ki_spur(int64_t, Quelle, const char*) {}

}  // namespace cypherdj::stellwerk
