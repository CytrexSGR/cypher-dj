// Leere Schnittstelle (Scheibe 11, Fehlerfall vorher): Regler-Tabelle ohne Einträge.
#include "cypherdj/stellwerk/regler.h"

namespace cypherdj::stellwerk {

ReglerTabelle::ReglerTabelle() {}
int ReglerTabelle::suche(const char*) const { return -1; }
int ReglerTabelle::kanal_suche(const char*) const { return -1; }
int ReglerTabelle::regler_von(int, Rolle) const { return -1; }
float ReglerTabelle::zu_x(const Kurve&, float) { return 0.0f; }
float ReglerTabelle::aus_x(const Kurve&, float) { return 0.0f; }

}  // namespace cypherdj::stellwerk
