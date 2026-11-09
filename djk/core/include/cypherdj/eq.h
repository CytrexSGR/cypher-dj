// Native EQ insert (Rust eq_dsp over hall_ffi): 8 bands, stereo in place, fixed latency (see cypher_eq_ffi.h).
// RAII wrapper like comp.h: throws if the allocation fails or the sample rate is invalid (non-finite or <= 0), guards denormals around the block.
#pragma once
#include <stdexcept>
#include <cypherdj/dsp/denormal.h>
#include "cypherdj/cypher_eq_ffi.h"

namespace cdj {

class EqNativ {
 public:
  explicit EqNativ(int sr = 48000) : h_(cypher_eq_neu(sr)) {
    if (!h_) throw std::runtime_error("Cypher EQ: Anlegen gescheitert");
  }
  ~EqNativ() { cypher_eq_frei(h_); }
  EqNativ(const EqNativ&) = delete;
  EqNativ& operator=(const EqNativ&) = delete;
  void block(float* l, float* r, int n) {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_eq_block(h_, l, r, static_cast<size_t>(n));
  }
  void setze_band(int i, const CypherEqBand& b) { cypher_eq_setze_band(h_, static_cast<uint32_t>(i), b); }
  void setze_global(bool prop_q, double ausgang_db) { cypher_eq_setze_global(h_, prop_q ? 1 : 0, ausgang_db); }
  void leeren() { cypher_eq_leeren(h_); }
  int latenz() const { return static_cast<int>(cypher_eq_latenz(h_)); }
 private:
  CypherEq* h_;
};

}  // namespace cdj
