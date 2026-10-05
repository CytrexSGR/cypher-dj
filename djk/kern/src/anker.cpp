#include "cypherdj/anker.h"

#include <cmath>

namespace cdj {

Fortsetzung setze_fort(const Anker& a, uint32_t frames_jetzt, int64_t mono_ns_jetzt) noexcept {
  Fortsetzung f{};
  f.d_frames = static_cast<int64_t>(static_cast<uint32_t>(frames_jetzt - a.frames));  // Überlauf nach 2^32 heil
  f.d_mono = std::llround(static_cast<double>(mono_ns_jetzt - a.mono_ns) * 48000.0 / 1e9);
  if (f.d_mono < 0) f.d_mono = 0;  // CLOCK_MONOTONIC läuft nie rückwärts; ein Anker aus der Zukunft ist kaputt
  const int64_t abweichung = f.d_frames > f.d_mono ? f.d_frames - f.d_mono : f.d_mono - f.d_frames;
  if (abweichung <= ANKER_TOLERANZ) {
    f.quelle = AnkerQuelle::frames;
    f.sample = a.sample + f.d_frames;
  } else {
    f.quelle = AnkerQuelle::mono;
    f.sample = a.sample + f.d_mono;
  }
  return f;
}

}  // namespace cdj
