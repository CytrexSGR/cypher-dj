// Native saturation insert (Rust saett_dsp over hall_ffi): tanh with ADAA1, stereo in place, fixed latency (see cypher_saett_ffi.h).
// RAII wrapper like komp.h: throws if the allocation fails, guards denormals around the block.
#pragma once
#include <stdexcept>
#include <cypherdj/dsp/denormal.h>
#include "cypherdj/cypher_saett_ffi.h"

namespace cdj {

class SaettNativ {
 public:
  explicit SaettNativ(int sr = 48000) : h_(cypher_saett_neu(sr)) {
    if (!h_) throw std::runtime_error("Cypher Saett: Anlegen gescheitert");
  }
  ~SaettNativ() { cypher_saett_frei(h_); }
  SaettNativ(const SaettNativ&) = delete;
  SaettNativ& operator=(const SaettNativ&) = delete;
  void block(float* l, float* r, int n) {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_saett_block(h_, l, r, static_cast<size_t>(n));
  }
  void setze(double drive_db, double ausgang_db, double mix) { cypher_saett_setze(h_, drive_db, ausgang_db, mix); }
  void leeren() { cypher_saett_leeren(h_); }
  int latenz() const { return static_cast<int>(cypher_saett_latenz(h_)); }
 private:
  CypherSaett* h_;
};

}  // namespace cdj
