// Leere Schnittstelle (Scheibe 11, Fehlerfall vorher): Befehle ohne Wirkung.
#include "cypherdj/stellwerk/stellwerk.h"

namespace cypherdj::stellwerk {

void Stellwerk::teil(const TeilBefehl&) {}
void Stellwerk::abbruch(int64_t, Quelle, const char*, const int32_t*, int) {}

}  // namespace cypherdj::stellwerk
