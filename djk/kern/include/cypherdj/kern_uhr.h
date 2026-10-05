// Die Kern-Uhr als Uhr des Stellwerks (SCHNITTSTELLEN.md §1.1, §1.3; djk/kern/stellwerk/include/cypherdj/stellwerk/uhr.h,
// Scheibe 11). Das Stellwerk hält keine eigene Tempo-Karte: es fragt je Zyklus die Karte, die im Kern gerade gilt
// (Grundkarte plus wartende Tempo-Rampen, Scheibe 08). Keine Allokation, keine Sperre: im Callback erlaubt. Scheibe 25.
#pragma once

#include <cstdint>

#include "cypherdj/stellwerk/uhr.h"
#include "cypherdj/tempoplan.h"

namespace cdj {

class KernUhr final : public cypherdj::stellwerk::Uhr {
 public:
  explicit KernUhr(const Tempoplan& plan) : plan_(plan) {}
  double beat(int64_t sample) const override { return plan_.karte().beat_at(static_cast<double>(sample)); }
  double sample_genau(double beat) const override { return plan_.karte().sample_at(beat); }
  double bpm(int64_t sample) const override { return plan_.karte().bpm_at(static_cast<double>(sample)); }

 private:
  const Tempoplan& plan_;
};

}  // namespace cdj
