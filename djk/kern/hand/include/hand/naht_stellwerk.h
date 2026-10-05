// Hand-Weg: Naht zum Stellwerk (Scheibe 11). Macht aus einer Regler-Ausgabe des Übersetzers einen stellwerk::Griff,
// den der Kern (Scheibe 35) mit Stellwerk::hand() einreicht, und baut denselben Griff aus /test/hand (§19.0), damit
// Prüfeingang und Controller dieselbe Semantik haben (erster Wert nur Stellung, Totzone 3/128: beides im Stellwerk).
// Echtzeitfest.
#pragma once
#include <cstdint>

#include "hand/mapping.h"
#include "hand/uebersetzer.h"
#include "cypherdj/stellwerk/stellwerk.h"
// stellwerk = cypherdj::stellwerk (Alias in hand/mapping.h); erneute, gleichlautende Deklaration ist erlaubt.
namespace stellwerk = cypherdj::stellwerk;

namespace hand {

// false für Ausgaben ohne Griff (deck, tempo, taste). wert_jetzt = Stellwerk::wert(regler) im Moment des Aufrufs;
// gebraucht nur für regler_umschalten (Schalter an -> relativ -1, aus -> relativ +1, Festlegung F5).
// g->kurve zeigt in das Mapping, solange es lebt (eigene Kurve), sonst nullptr (Standard-Kurve des Reglers).
bool zu_griff(const Ausgabe& a, const Mapping& m, float wert_jetzt, stellwerk::Griff* g);

// /test/hand ,sfh: pfad, midi_roh (0 bis 1), sample -> absoluter Griff mit Standard-Kurve. false: Pfad unbekannt oder
// deck/<n>/transport.
bool test_hand_griff(const stellwerk::ReglerTabelle& tab, const char* pfad, float midi_roh, int64_t sample,
                     stellwerk::Griff* g);

}  // namespace hand
