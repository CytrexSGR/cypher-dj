// Kompressor je Quellkanal (Effekt-Sektion, Plan 2026-10-11-effekt-sektion.md): Cypher Komp (Rust komp_dsp über
// hall_ffi), Feed-forward nach Giannoulis, Massberg, Reiss 2012; im Mixer zwischen verarbeite_vor und verarbeite_nach,
// also nach EQ und Filter, vor dem Fader (Andreas 2026-10-11: „1 ja so“). Knie fest 6 dB, kein Sidechain im Kern.
#pragma once
#include <stdexcept>
#include <cypherdj/dsp/denormal.h>
#include "cypherdj/cypher_komp_ffi.h"

namespace cdj {

class Komp {
 public:
  explicit Komp(int sr = 48000) : h_(cypher_komp_neu(sr)) {
    if (!h_) throw std::runtime_error("Cypher Komp: Anlegen gescheitert");
  }
  ~Komp() { cypher_komp_frei(h_); }
  Komp(const Komp&) = delete;
  Komp& operator=(const Komp&) = delete;
  void block(float* l, float* r, int n) {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_komp_block(h_, l, r, static_cast<size_t>(n));
  }
  // Externer Sidechain: der Detektor hört auf kl/kr (in place auf l/r)
  void block_sc(float* l, float* r, const float* kl, const float* kr, int n) {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_komp_block_sc(h_, l, r, kl, kr, static_cast<size_t>(n));
  }
  void setze(const CypherKompEinstellung& e) { cypher_komp_setze(h_, e); }
  void leeren() { cypher_komp_leeren(h_); }
  float gr_db() const { return static_cast<float>(cypher_komp_gr_db(h_)); }
 private:
  CypherKomp* h_;
};

}  // namespace cdj
