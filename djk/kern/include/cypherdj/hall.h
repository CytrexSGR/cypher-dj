// Hall für den Rückweg fx/2: Cypher Hall (spektral, Rust hall_dsp über hall_ffi), seit 2026-10-11 statt Faust
// re.zita_rev1_stereo (Andreas 2026-10-11: „wir nehmen auf jeden fall unseren eigenen hall“; Messung und Blindtest
// ~/messungen/2026-10-11-cypher-hall/zita/). Vorgabe wie der alte: 20 ms vor, Mitte 2 s, tief 3 s.
// Der Zustand (FFT-Pläne und Puffer aller Rahmengrößen) wird im Konstruktor angelegt; block() allokiert nicht.
#pragma once
#include <stdexcept>
#include <cypherdj/dsp/denormal.h>
#include "cypherdj/cypher_hall_ffi.h"

namespace cdj {

class Hall {
 public:
  explicit Hall(int sr = 48000) : h_(cypher_hall_neu(sr)) {
    if (!h_) throw std::runtime_error("Cypher Hall: Anlegen gescheitert");
  }
  ~Hall() { cypher_hall_frei(h_); }
  Hall(const Hall&) = delete;
  Hall& operator=(const Hall&) = delete;
  void block(const float* ein_l, const float* ein_r, float* aus_l, float* aus_r, int n) {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_hall_block(h_, ein_l, ein_r, aus_l, aus_r, static_cast<size_t>(n));
  }
  void setze(const CypherHallEinstellung& e) { cypher_hall_setze(h_, e); }
  void leeren() { cypher_hall_leeren(h_); }   // Audit F01: NaN-Riegel; Zustand auf 0, keine Allokation
 private:
  CypherHall* h_;
};

}  // namespace cdj
