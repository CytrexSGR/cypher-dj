// Prüft den Dehner-Stub (stub/stretcher_stub.cpp): die Fabrik liefert nullptr, also Keylock immer aus. Gebaut ohne
// stretcher.cpp und ohne librubberband (Ziel test_dehner_stub in CMakeLists.txt). Heißt nicht test_*.cpp, damit der
// Test-GLOB es nicht mit cypherdj_kernbib (die stretcher.cpp enthält) bindet: die Fabrik wäre doppelt definiert.
#include "cypherdj/stretcher.h"
#include "check.h"

int main() {
  PRUEF(cdj::dehner_neu(1) == nullptr);
  cdj::DehnerOptionen o;
  o.vorhalt_samples = 2400.0;
  PRUEF(cdj::dehner_neu(4, o) == nullptr);
  PRUEF_ENDE();
}
