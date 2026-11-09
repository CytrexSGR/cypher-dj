// Gate: stereo-linked noise gate as a channel insert (package 1.15 "Mix tools", part A).
//
// Signal path per sample:
//   detector:  e = max(|sc_l|, |sc_r|, e · a)          peak follower, instant rise, fixed decay kGateDetektorAbfallMs
//                                                       (a NaN or Inf sample of the key counts as 0: it cannot stick the follower)
//                                                       (sidechain = main input when no sidechain pointer is given)
//   state:     closed → open      when e ≥ threshold
//              open   → closed    when e < threshold − hysteresis for longer than hold
//   target:    open: 1 (0 dB); closed: floor (ratio ≥ kGateRatioUnendlich) or the downward expander curve
//              (level − threshold) · (ratio − 1) dB, never below the floor
//   gain:      moves to the target LINEARLY IN AMPLITUDE: attack = time for floor → 1, release = time for 1 → floor.
//              The largest gain step per sample is (1 − floor) / (attack or release in samples): no clicks.
//   out = in · gain, the same gain on both channels (stereo link).
//
// Latency: 0 samples (no look-ahead). Real time: verarbeite(), setze() and all getters do not allocate, lock,
// throw or do I/O. Fixed buffers for kMaxFrames: create the object on the heap.
#pragma once

#include <cypherdj/dsp/values.h>

namespace cypherdj::dsp {

inline constexpr double kGateDetektorAbfallMs = 10.0;   // time constant of the detector decay
inline constexpr float kGateRatioUnendlich = 100.0f;    // ratio ≥ this = hard gate (target = floor)
inline constexpr float kGateBereichStummDb = -120.0f;   // floor ≤ this = fully closed (gain exactly 0)

// Parameters with their ranges. setze() clamps into the range; a NaN keeps the previous value of that field.
struct GateParameter {
    float schwelle_db = -40.0f;    // open threshold in dBFS, [-90, 0]
    float hysterese_db = 4.0f;     // close threshold = schwelle_db − hysterese_db, [0, 24]
    float ratio = 100.0f;          // [1, 100]; 100 = hard gate, 1 = no gating
    float bereich_db = -80.0f;     // floor (range), [-120, 0]; -120 = fully closed
    float attack_ms = 1.0f;        // floor → 0 dB, [0.1, 500]
    float hold_ms = 20.0f;         // [0, 2000]
    float release_ms = 100.0f;     // 0 dB → floor, [1, 5000]
};

class Gate {
public:
    explicit Gate(double fs = kAbtastrate);

    // Real-time safe. Takes effect from the next sample; the gain keeps ramping from where it is.
    void setze(const GateParameter& p);
    const GateParameter& parameter() const { return p_; }

    // Closed, gain at the floor, detector empty. Real-time safe.
    void leeren();
    // Detector empty, but OPEN (gain 1, hold running): for switching the gate on while a signal runs. A signal under the
    // threshold closes it the regular way after hold and release; a signal over it keeps it open. No step at the switch.
    void leeren_offen();

    // 1 ≤ n ≤ kMaxFrames. in and out may be the same. sc_l/sc_r: optional sidechain (both or none);
    // nullptr = detect on the input. A sidechain with only one channel: pass the same pointer twice.
    void verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n,
                    const float* sc_l = nullptr, const float* sc_r = nullptr);

    bool offen() const { return offen_; }
    // Current linear gain and the same in dB (kStummDb when 0); for a gain-reduction meter.
    float gain() const { return static_cast<float>(g_); }
    float gain_db() const;
    // Linear gain per sample from the last verarbeite() call.
    const float* gain_verlauf() const { return verlauf_; }

private:
    void neu_rechnen();

    double fs_;
    GateParameter p_;
    // derived from p_
    double schwelle_auf_ = 0.0, schwelle_zu_ = 0.0, boden_ = 0.0;
    double schritt_auf_ = 0.0, schritt_ab_ = 0.0, abfall_ = 0.0;
    long hold_samples_ = 0;
    // state
    double e_ = 0.0, g_ = 0.0;
    long hold_rest_ = 0;
    bool offen_ = false;
    float verlauf_[kMaxFrames] = {};
};

}  // namespace cypherdj::dsp
