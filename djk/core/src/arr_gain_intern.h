// Internal gain helpers shared by the translation units of the Arrangement module (1.12 slice 5, plan D8). One definition each, so the mixer
// (arr_output.cpp), the lane evaluation (arr_auto.cpp) and the voices (arr_voices.cpp) convert dB to a gain and hold a dB value alike.
// Not part of the public headers: only the .cpp files of this folder include it.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

#include "cypherdj/arr_auto.h"
#include "cypherdj/arrangement.h"

namespace cdj {

// dB to linear gain; below -120 dB the gain is 0 (stumm limit, spec 1.2). std::pow runs only where a value changed, never per sample in steady operation.
inline float db_lin(float db) { return db <= -120.0f ? 0.0f : std::pow(10.0f, db / 20.0f); }

// largest drift of a held dB value against the exact value (the AK4 tolerance is 0.05 dB)
constexpr float AUTO_HALT_DB = 0.03f;

// The gain envelope of a voice (1.12 slice 5, D8). The lane value at the clip beat (dB, fader rule: a ramp from -200 runs from -60, AutoLane) is held while it stays
// within AUTO_HALT_DB of the held value: db_lin (pow) runs only when it moved, so a steady or slowly moving envelope costs one compare per sample. `db` starts at 1e9
// (nothing held: the first sample takes the exact value). Returns the held linear gain.
inline float hk_halten(AutoLane& lane, double clip_beat, float& db, float& lin) {
  const float v = lane.wert_bei(clip_beat);
  if (std::fabs(v - db) > AUTO_HALT_DB) {
    db = v;
    lin = db_lin(v);
  }
  return lin;
}

// The glide after a swap that changed only the table: from `alt` (the factor played at the swap sample `ab`) to `lin` over ARR_NAHT samples, linear. ab < 0: no glide.
inline float hk_gleiten(float lin, float alt, int64_t ab, int64_t t) {
  if (ab < 0 || t - ab >= ARR_NAHT) return lin;
#ifdef CYPHERDJ_MUTATION_ARR_HK_TAUSCH_HART
  return lin;   // error case: the new table takes effect at once, the gain jumps at the swap
#else
  return alt + (lin - alt) * static_cast<float>(std::max<int64_t>(t - ab, 0)) / ARR_NAHT;
#endif
}

}  // namespace cdj
