// Utility: channel-insert tool (package 1.15 "Mix tools", part A).
//
// Signal path per sample:
//   DC blocker (one-pole high-pass, kUtilityDcHz, optional)
//   → bass mono (LR8 split at bass_mono_hz: lows summed to mono, highs unchanged; optional)
//   → 2×2 matrix:  gain · balance · width (M/S) · swap · phase invert
//
// Click-free: every change of the matrix, and switching DC blocker or bass mono on or off, ramps linearly over
// kUtilityRampeMs. DC blocker and bass mono crossfade between dry and filtered while switching. A changed bass-mono
// frequency (both values > 0) recomputes the LR8 coefficients and keeps the filter state.
// Neutral parameters (all defaults) give the input bit-identically.
//
// Latency: 0 samples (IIR only). With bass mono on, the sum of the LR8 low and high part is an all-pass: flat
// magnitude, phase shift around the cutoff (same as the isolator).
// Real time: verarbeite(), setze() and getters do not allocate, lock, throw or do I/O.
#pragma once

#include <cypherdj/dsp/biquad.h>
#include <cypherdj/dsp/values.h>

namespace cypherdj::dsp {

inline constexpr double kUtilityRampeMs = 10.0;  // ramp of all switches and matrix changes
inline constexpr double kUtilityDcHz = 5.0;      // -3 dB point of the DC blocker
inline constexpr float kUtilityBassMonoMinHz = 20.0f;
inline constexpr float kUtilityBassMonoMaxHz = 500.0f;

// Parameters with their ranges. setze() clamps; a NaN keeps the previous value of that field.
struct UtilityParameter {
    float gain_db = 0.0f;           // [-120, +24]; ≤ -120 = silent (gain exactly 0)
    float balance = 0.0f;           // [-1, +1]; +0.5 = left at 0.5 (-6.02 dB), right 1; linear balance law
    float breite_prozent = 100.0f;  // [0, 200]; 0 = mono, 100 = unchanged, 200 = side doubled
    float bass_mono_hz = 0.0f;      // 0 = off, else [20, 500]
    bool phase_umkehren_l = false;  // invert the input left channel
    bool phase_umkehren_r = false;
    bool seiten_tauschen = false;   // left/right swap (after phase invert)
    bool dc_sperre = false;         // DC blocker
};

class Utility {
public:
    explicit Utility(double fs = kAbtastrate);

    // Real-time safe. Changes ramp over kUtilityRampeMs from the current state.
    void setze(const UtilityParameter& p);
    const UtilityParameter& parameter() const { return p_; }

    // Filter states empty, all ramps at their target. Real-time safe.
    void leeren();

    // 1 ≤ n ≤ kMaxFrames. in and out may be the same.
    void verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n);

    // Matrix out = M · in at the moment (row major: ll, lr, rl, rr), for tests and display.
    const double* matrix() const { return m_; }
    bool faehrt() const { return rest_ > 0 || dc_rest_ > 0 || bass_rest_ > 0; }

private:
    void ziel_matrix(double* z) const;

    double fs_;
    int rampe_ = 1;
    UtilityParameter p_;
    // matrix ramp
    double m_[4] = {1.0, 0.0, 0.0, 1.0};
    double m_ziel_[4] = {1.0, 0.0, 0.0, 1.0};
    double m_schritt_[4] = {};
    int rest_ = 0;
    // DC blocker: y = x − x1 + R · y1, per channel; mix d ∈ [0, 1]
    double dc_r_ = 0.0;
    double dc_x1_[2] = {}, dc_y1_[2] = {};
    double dc_mix_ = 0.0, dc_schritt_ = 0.0;
    int dc_rest_ = 0;
    // bass mono: LR8 low/high per channel; mix b ∈ [0, 1]
    Lr8 tp_[2], hp_[2];
    float bass_hz_ = 0.0f;  // frequency the filters are tuned to (0 = never tuned)
    double bass_mix_ = 0.0, bass_schritt_ = 0.0;
    int bass_rest_ = 0;
};

}  // namespace cypherdj::dsp
