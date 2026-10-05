// Prüfsignal auf dem Cue (Scheibe 18, nur mit Prüfmodus und Aufrufparameter --pruef-cue): ein Rauschen, dessen Wert
// allein vom Kern-Sample abhängt, x(S) = 0,1 · (k − 2^22) / 2^22 mit k = splitmix64(S) >> 41 (23 Bit). Setzt der Kern
// nach einem Neustart auf dem richtigen Sample fort, ist das Signal am Ziel bitgleich mit der Rechnung
// (djk/kern/tests/neustart/auswertung.py rechnet dieselbe Formel); jeder Versatz um ein Sample und jede Lücke fällt dort
// auf. Ein Lauf von 48 Samples unter 1e-3 kommt im Signal praktisch nie vor (je Sample 1 %), darum misst derselbe Kanal
// Stille. Kein OSC, kein Vertragszusatz: Kern-intern. Scheibe 25 (Master und Cue) ersetzt den Cue-Inhalt; das Prüfsignal
// bleibt nur hinter --pruef-cue.
#pragma once

#include <cstdint>

namespace cdj {

inline uint64_t splitmix64(uint64_t x) noexcept {
  x += 0x9E3779B97F4A7C15ull;
  x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ull;
  x = (x ^ (x >> 27)) * 0x94D049BB133111EBull;
  return x ^ (x >> 31);
}

inline float pruef_cue_wert(int64_t s) noexcept {
  const int64_t k = static_cast<int64_t>(splitmix64(static_cast<uint64_t>(s)) >> 41);
  return static_cast<float>(k - 4194304) * (0.1f / 4194304.0f);
}

}  // namespace cdj
