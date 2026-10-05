// Prüfklick nach ROADMAP Z1: je Schlag ein kurzer Klick mit Einsatz genau auf llround(sample_at(b)) für ganze b,
// Schlag 1 des Takts lauter. Klickform wie proben/01-audio-kern/a-cpp-jack/klick_kern.cpp Z. 384 f., damit
// analyse_klick.py ihn misst. Keine Allokation: block() ist für den Callback.
#pragma once

#include <cstdint>

#include "cypherdj/uhr.h"

namespace cdj {

constexpr int KLICK_LAENGE = 96;           // Samples
constexpr float KLICK_PEGEL_EINS = 0.5f;   // Schlag 1 des Takts
constexpr float KLICK_PEGEL = 0.25f;       // Schläge 2 bis 4

struct KlickEinsatz {
  double beat;
  int64_t sample;
};

class Klick {
 public:
  Klick();                        // füllt die Klickform (nicht im Callback aufrufen)
  void an() { aktiv_ = true; }    // wirkt ab dem nächsten Schlag, der im nächsten block() liegt
  void aus() { aktiv_ = false; }  // ein laufender Klick klingt zu Ende
  bool aktiv() const { return aktiv_; }

  // Addiert die Klicks für die Samples [n0, n0 + n) nach der Karte auf links und rechts. Schreibt die in diesem
  // Block begonnenen Einsätze nach einsaetze (höchstens max) und gibt ihre Zahl zurück.
  int block(const Karte& k, int64_t n0, int n, float* links, float* rechts, KlickEinsatz* einsaetze, int max);

 private:
  float form_[KLICK_LAENGE];
  bool aktiv_ = false;
  int rest_ = 0;
  float pegel_ = 0.0f;
};

}  // namespace cdj
