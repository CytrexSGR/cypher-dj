// Automation Slice 1 (ADR 032): the evaluation of one fader lane, pure and header-only. No allocation, no locks, no std::pow: safe in the
// audio callback. The same formula runs in the server (project/lane.ts) and on the page (lanes.js); tests/data/lane_ref.json binds all three.
//
// Rules: before the first point the first value holds, after the last point the last one. Between two points the form of the RIGHT point
// decides (0 linear, 1 s-curve 3u^2 - 2u^3, 2 jump: the left value holds up to the beat of the right point). Two points at one beat make a jump
// (from that beat on the right value holds). Mute rule like the mixer (stellwerk types.h STUMM, STUMM_GRENZE, STUMM_RAMPE; core.cpp
// start_parameter): a ramp from a point <= -120 dB to a louder one starts at min(-60, the louder value); a ramp to a point <= -120 dB runs towards
// min(-60, the left value), or stays mute if the left one is mute too; the point itself is exact.
//
// Ties: the project beat of a sample comes from beat_at(s) - ursprung, with a rounding error around 1e-15. A point that sits on a grid beat (a jump at beat 8)
// must switch at the same sample in the live run and in the render, whatever their start samples are. So a beat within EPS_BEAT = 1e-9 (2e-5 of a sample)
// BEFORE a point already counts as at the point. Measured: without it the live run and the render differed by one sample at a jump on beat 8 (128 BPM).
//
// Cursor: the audio thread asks with rising beats, so the lookup moves a cursor forward (amortised O(1) per sample). Where the beat jumps
// (start in the middle, loop wrap, snapshot swap) the caller calls neu_suchen(beat) first; wert_bei also guards itself against a backward step.
#pragma once
#include <algorithm>
#include <cstdint>

#include "cypherdj/arr_playback.h"

namespace cdj {

class AutoLane {
 public:
  static constexpr double EPS_BEAT = 1e-9;
  AutoLane() noexcept = default;
  AutoLane(const ArrAutoPunkt* p, int n) noexcept : p_(p), n_(n) {}

  // 1.12 slice 5: the table moves to an equal copy in another snapshot (a swap of equal content): same index, new pointer. The cursor stays, clamped to the table.
  void binde(const ArrAutoPunkt* p, int n) noexcept {
    p_ = p;
    n_ = n;
    if (i_ >= n_) i_ = n_ > 0 ? n_ - 1 : 0;
  }

  // binary search for the last point with beat <= the given beat (0 when the beat lies before the first point)
  void neu_suchen(double beat) noexcept {
#if defined(CYPHERDJ_MUTATION_ARR_AUTO_CURSOR_ALT) || defined(CYPHERDJ_MUTATION_ARR_HK_CURSOR_ALT)   // (HK: the gain envelope of a voice; test_arr_huellkurve)
    (void)beat;   // error case: the cursor is not searched anew after a backward jump
#else
    int lo = 0, hi = n_ > 0 ? n_ - 1 : 0;
    while (lo < hi) {
      const int mid = (lo + hi + 1) >> 1;
      if (p_[mid].beat <= beat + EPS_BEAT) lo = mid; else hi = mid - 1;
    }
    i_ = lo;
#endif
  }

  // lane value in dB at the project beat (-200 means mute)
  float wert_bei(double beat) noexcept {
    if (n_ <= 0 || p_ == nullptr) return 0.0f;
#if !defined(CYPHERDJ_MUTATION_ARR_AUTO_CURSOR_ALT) && !defined(CYPHERDJ_MUTATION_ARR_HK_CURSOR_ALT)
    if (i_ > 0 && beat + EPS_BEAT < p_[i_].beat) neu_suchen(beat);   // a caller that forgot the seam still gets a right answer
#endif
    if (!(beat + EPS_BEAT >= p_[0].beat)) return p_[0].wert;
    while (i_ + 1 < n_ && p_[i_ + 1].beat <= beat + EPS_BEAT) ++i_;
    const ArrAutoPunkt& a = p_[i_];
    if (i_ == n_ - 1 || beat <= a.beat) return a.wert;   // beat <= a.beat: only within EPS_BEAT before the point
    const ArrAutoPunkt& b = p_[i_ + 1];
    if (b.form == 2) return a.wert;
    const double u = (beat - a.beat) / (b.beat - a.beat);
    const double g = b.form == 1 ? u * u * (3.0 - 2.0 * u) : u;
    double va = a.wert, vb = b.wert;
    if (va <= STUMM_GRENZE_DB && vb > STUMM_GRENZE_DB) va = std::min(STUMM_RAMPE_DB, vb);
    if (vb <= STUMM_GRENZE_DB) vb = va <= STUMM_GRENZE_DB ? STUMM_DB : std::min(STUMM_RAMPE_DB, va);
    return static_cast<float>(va + (vb - va) * g);
  }

  // Look-ahead for the step hold of Arrangement::auto_block. Evaluates the lane at `beat` on a COPY of the cursor and returns true only if the value
  // between the current cursor position and `beat` is monotone in the beat, so a held value that is still within tolerance at both ends is within
  // tolerance in between. That is the case when the cursor stays on the same point and the segment to its right has a form known to be monotone:
  // 0 (linear: va + (vb - va) * u is a chain of monotone rounded operations) and 2 (jump: constant). The s-curve 3u^2 - 2u^3 is not guaranteed to be
  // monotone in floating point, and any form code added later is NOT monotone until it is added here (allow list, not block list). After the last
  // point the value is constant. The cursor itself is never moved: on success it would not move either, so the caller can skip the samples in between
  // without any visible state change. The caller must pass a beat >= the beat of its last evaluation.
  bool vorausschau(double beat, float& wert) const noexcept {
    AutoLane kopie = *this;
    wert = kopie.wert_bei(beat);
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_CURSOR
    if (kopie.i_ != i_) return false;   // the cursor moved: another segment lies in between
#endif
    if (i_ + 1 >= n_) return true;
    return p_[i_ + 1].form == 0 || p_[i_ + 1].form == 2;
  }

  int cursor() const noexcept { return i_; }   // for tests: the point the cursor sits on

  int punkte() const noexcept { return n_; }
  const ArrAutoPunkt* daten() const noexcept { return p_; }

 private:
  static constexpr double STUMM_DB = -200.0, STUMM_GRENZE_DB = -120.0, STUMM_RAMPE_DB = -60.0;   // = stellwerk types.h
  const ArrAutoPunkt* p_ = nullptr;
  int n_ = 0;
  int i_ = 0;
};

}  // namespace cdj
