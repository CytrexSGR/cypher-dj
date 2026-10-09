// Prüft den Dehner-Stub (stub/dehner_stub.cpp): die Fabrik liefert nullptr, also Keylock immer aus. Gebaut ohne
// dehner.cpp und ohne librubberband (Ziel test_dehner_stub in CMakeLists.txt). Heißt nicht test_*.cpp, damit der
// Test-GLOB es nicht mit cypherdj_kernbib (die dehner.cpp enthält) bindet: die Fabrik wäre doppelt definiert.
#include "cypherdj/dehner.h"
#include "pruef.h"

int main() {
  PRUEF(cdj::dehner_neu(1) == nullptr);
  cdj::DehnerOptionen o;
  o.vorhalt_samples = 2400.0;
  PRUEF(cdj::dehner_neu(4, o) == nullptr);
  PRUEF_ENDE();
}
