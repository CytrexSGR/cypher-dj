// Bremse gegen Absturzschleifen (Audit F20, Paket 2 Slice 4). Betrieb::starte zählt Starts ohne Fortschritt; ab dem
// dritten setzt der Kern nicht mehr aus dem Zustand fort (er startet frisch), damit ein Absturz, der am Zustand hängt,
// nicht endlos wiederkehrt. Reine Funktion: kein Dateizugriff.
#pragma once

#include <cstdint>

namespace cdj {

constexpr uint64_t BREMSE_FORTSCHRITT = 1000;  // Zyklen Stand-Zuwachs (≈ 5 s bei 256/48000), die als Fortschritt zählen
constexpr int BREMSE_SCHWELLE = 3;             // Starts ohne Fortschritt, ab denen ohne Zustand gestartet wird

constexpr int BREMSE_MAX = 1000;                // Sättigung des Zählers (kein INT_MAX-Überlauf)

struct BremsUrteil {
  int zaehler = 0;           // Starts ohne Fortschritt, einschließlich dieses
  bool ohne_zustand = false; // true: dieser Start setzt nicht aus dem Zustand fort
};

// stand_neu == 0: kein Fach, Frischstart, nichts zu bremsen. Sonst Fortschritt = stand_neu - stand_alt >= 1000.
BremsUrteil bremse(int zaehler_alt, uint64_t stand_alt, uint64_t stand_neu) noexcept;

}  // namespace cdj
