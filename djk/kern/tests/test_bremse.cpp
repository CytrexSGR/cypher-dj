// Audit F20, Slice 4: die Bremse gegen Absturzschleifen als reine Funktion. Fortschritt heißt: der Stand des Echtzeit-
// Fachs ist seit dem letzten Start um mindestens 1000 Zyklen (≈ 5 s) gewachsen.
#include "cypherdj/bremse.h"
#include "pruef.h"

int main() {
  using cdj::bremse;
  { auto u = bremse(0, 100, 100); PRUEF(u.zaehler == 1 && !u.ohne_zustand); }
  { auto u = bremse(1, 100, 100); PRUEF(u.zaehler == 2 && !u.ohne_zustand); }
  { auto u = bremse(2, 100, 100); PRUEF(u.zaehler == 3 && u.ohne_zustand); }
  { auto u = bremse(3, 100, 1250); PRUEF(u.zaehler == 0 && !u.ohne_zustand); }       // Fortschritt löst die Bremse
  { auto u = bremse(2, 100, 600); PRUEF(u.zaehler == 3 && u.ohne_zustand); }         // 500 Zyklen sind kein Fortschritt
  { auto u = bremse(2, 100, 1100); PRUEF(u.zaehler == 0 && !u.ohne_zustand); }       // genau 1000: Fortschritt
  { auto u = bremse(2, 100, 1099); PRUEF(u.zaehler == 3); }                          // 999: keiner
  { auto u = bremse(0, 0, 0); PRUEF(u.zaehler == 0 && !u.ohne_zustand); }            // Negativ-Kontrolle: erster Start, kein Fach
  { auto u = bremse(5, 900, 0); PRUEF(u.zaehler == 0 && !u.ohne_zustand); }          // B2: Frischstart (kein Fach) setzt zurück
  { auto u = bremse(0, 5000, 10); PRUEF(u.zaehler == 1 && !u.ohne_zustand); }        // Unterlauf-Wächter: kleinerer Stand ist kein Fortschritt
  { auto u = bremse(2147483647, 100, 100); PRUEF(u.zaehler == cdj::BREMSE_MAX && u.ohne_zustand); }  // gesättigt, kein Überlauf
  PRUEF_ENDE();
}
