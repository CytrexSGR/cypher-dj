// D1 K3 Fix L8: Werte der Kommandozeile der Export-Programme (cypherdj-render, -mitschnitt, -nulltest) streng lesen. Eine
// Zahl gilt nur, wenn der ganze Text sie ist (kein Rest wie „128x“), sie endlich ist und in den Wertebereich passt; sonst
// meldet das Programm den Schalter auf stderr und gibt 2 zurück (vorher las atoll „abc“ als 0). Dazu die Prüfung von
// CYPHERDJ_INSTANZ (Z2: leer oder ein Buchstabe a bis i) mit Hinweis.
#pragma once

#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>

#include "cypherdj/instanz.h"

namespace cdj {

inline bool lies_ganz(const char* s, int64_t min, int64_t max, int64_t& aus) {
  if (!s || !*s) return false;
  errno = 0;
  char* ende = nullptr;
  const long long v = std::strtoll(s, &ende, 10);
  if (errno != 0 || ende == s || *ende != '\0' || v < min || v > max) return false;
  aus = static_cast<int64_t>(v);
  return true;
}

inline bool lies_zahl(const char* s, double& aus) {
  if (!s || !*s) return false;
  errno = 0;
  char* ende = nullptr;
  const double v = std::strtod(s, &ende);
  if (errno != 0 || ende == s || *ende != '\0' || !std::isfinite(v)) return false;
  aus = v;
  return true;
}

// Meldung für einen ungültigen Wert; Rückgabe 2 (Aufruf)
inline int wert_falsch(const char* programm, const char* schalter, const char* wert, const char* erwartet) {
  std::fprintf(stderr, "%s: %s %s ist keine %s\n", programm, schalter, wert, erwartet);
  return 2;
}

// false mit Hinweis auf stderr, wenn CYPHERDJ_INSTANZ gesetzt, aber kein Buchstabe a bis i ist
inline bool instanz_gueltig(const char* programm) {
  const char* i = cdj_instanz();
  if (cdj_instanz_k(i) >= 0) return true;
  std::fprintf(stderr, "%s: CYPHERDJ_INSTANZ=%s ist ungültig: leer oder ein Buchstabe a bis i (Prüfinstanzen, Z2)\n",
               programm, i);
  return false;
}

}  // namespace cdj
