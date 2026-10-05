// Stellwerk-RT, intern: die Formel eines Teils (§4.3, §1.2) an einer Stelle, damit Ablauf (je Sample) und Vorschau
// (Prüfer) dieselben Zahlen rechnen. Nicht Teil der öffentlichen Kopfdatei.
#pragma once
#include <algorithm>
#include <cstdint>

namespace cypherdj::stellwerk::formel {

// Rampe in Beats: u = (beat - bA) / (ende - bA); fertig am ersten Sample mit beat >= ende (1e-9 Beats Rundung)
inline double anteil_rampe(double beat, double bA, double ende, bool* fertig) {
  const double spanne = ende - bA;
  if (spanne <= 0 || beat >= ende - 1e-9) {
    *fertig = true;
    return 1.0;
  }
  *fertig = false;
  return std::min(1.0, std::max(0.0, (beat - bA) / spanne));
}

// Setzen mit Schaltrampe in Samples; schalt <= 0: sofort
inline double anteil_setzen(int64_t sample, int64_t sA, int32_t schalt, bool* fertig) {
  const double u = schalt <= 0 ? 1.0 : std::min(1.0, std::max(0.0, static_cast<double>(sample - sA) / schalt));
  *fertig = u >= 1.0;
  return u;
}

// Wert aus Anteil; S-Kurve u -> 3u^2 - 2u^3 (§4.3 Feld 9, und jede Schaltrampe, F2); am Ende genau der Zielwert (stumm: -200)
inline float wert(double u, bool fertig, bool s_kurve, float wA, float ziel_intern, float end_wert) {
  if (fertig) return end_wert;
  const double g = s_kurve ? u * u * (3.0 - 2.0 * u) : u;
  return static_cast<float>(wA + (static_cast<double>(ziel_intern) - wA) * g);
}

}  // namespace cypherdj::stellwerk::formel
