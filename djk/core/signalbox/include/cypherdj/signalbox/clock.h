// Stellwerk-RT: Schnittstelle zur Uhr des Kerns (§1.1, §1.3). Das Stellwerk hält keine eigene Tempo-Karte;
// es fragt je Zyklus die Uhr, die in diesem Moment gilt. Im Kern (Scheibe 25) ist das die Kern-Uhr, in Tests SimUhr.
#pragma once
#include <cmath>
#include <cstdint>

namespace cypherdj::stellwerk {

class Uhr {
 public:
  virtual ~Uhr() = default;
  virtual double beat(int64_t sample) const = 0;       // §1.3 beat(s)
  virtual double sample_genau(double beat) const = 0;  // §1.3 sample(b), ungerundet
  virtual double bpm(int64_t sample) const = 0;        // §1.3 bpm(s)
};

// §1.1: ziel_sample = llround(sample_at(beat))
inline int64_t sample_von(const Uhr& uhr, double beat) { return std::llround(uhr.sample_genau(beat)); }

}  // namespace cypherdj::stellwerk
