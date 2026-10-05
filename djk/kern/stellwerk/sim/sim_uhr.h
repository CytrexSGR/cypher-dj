// Simulierte Uhr nach SCHNITTSTELLEN §1.3 (Tempo-Karte, linear in der Zeit), für Tests und den Folgenleser.
// Die echte Kern-Uhr baut Strang A (Scheiben 01, 08); beide müssen die Golden-Werte aus §1.3 treffen.
#pragma once
#include <cmath>
#include <cstdint>

#include "cypherdj/stellwerk/uhr.h"

namespace cypherdj::stellwerk {

class SimUhr final : public Uhr {
 public:
  explicit SimUhr(double bpm);
  void setze(double bpm);                                            // neue Zeitachse: konstant ab Sample 0 (§4.2 /k/set/neu)
  double beat(int64_t sample) const override { return beat_d(static_cast<double>(sample)); }
  double sample_genau(double beat) const override;
  double bpm(int64_t sample) const override { return bpm_d(static_cast<double>(sample)); }
  void konstant_ab(int64_t sample, double bpm);                       // Tempo ab sample konstant
  bool rampe(double ab_beat, double ziel_bpm, double dauer_beats);    // false: Karte voll (64 Segmente)
  int segmente() const { return n_; }
  double beat_d(double s) const;
  double bpm_d(double s) const;

 private:
  struct Seg { double s0, b0, bpm0, k; };
  const Seg& seg_s(double s) const;
  const Seg& seg_b(double b) const;
  Seg seg_[64];
  int n_ = 1;
};

// §1.1: Takt, Schlag, Phrase (1-basiert, 4/4)
inline int takt_von(double beat) { return static_cast<int>(std::floor(beat / 4.0)) + 1; }
inline int schlag_von(double beat) { return static_cast<int>(std::floor(std::fmod(beat, 4.0))) + 1; }
inline int phrase_von(double beat) { return static_cast<int>(std::floor(beat / 32.0)) + 1; }

}  // namespace cypherdj::stellwerk
