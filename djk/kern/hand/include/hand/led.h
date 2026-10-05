// Hand-Weg: LED-Namen (SCHNITTSTELLEN §7.4) und Nachrichtenbau für den Ausgang cypherdj-kern:hand_led (§7.1).
// Zustände wie /k/led (§4.7): 0 aus, 1 an, 2 blinkt, 3 blinkt schnell. §7.2 kennt nur die Werte aus/an/blinkt;
// "blinkt schnell" sendet darum den Wert von blinkt (Festlegung F6 dieser Scheibe).
#pragma once
#include <cstdint>

#include "hand/mapping.h"

namespace hand {

// true, wenn `name` ein LED-Name aus §7.4 ist (deck<n>_* mit n = 1 bis 4)
bool led_name_gueltig(const char* name);

// Baut die 3 Bytes für LED `name` im Zustand `zustand` (0 bis 3). Rückgabe 3, oder 0, wenn das Mapping die LED nicht
// führt oder der Zustand ungültig ist. Echtzeitfest (keine Allokation, lineare Suche über höchstens MAX_LEDS).
int led_nachricht(const Mapping& m, const char* name, int zustand, uint8_t aus[3]);

}  // namespace hand
