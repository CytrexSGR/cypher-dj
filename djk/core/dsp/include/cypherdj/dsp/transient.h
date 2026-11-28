// Transient shaper: stereo-linked attack/sustain control as a channel insert (strand 5, slice 3).
//
// Signal path per sample:
//   detector:  x = max(|l|, |r|)                       (a NaN or Inf sample counts as 0)
//   envelopes: e_f  one-pole, attack 0.5 ms, release tempo_ms        (fast)
//              e_s  one-pole, attack tempo_ms, release 4 * tempo_ms  (slow)
//   shape:     d = dB(e_f) - dB(e_s)
//              g_db = angriff * clamp(d / 6, 0, 1) + halten * clamp(-d / 6, 0, 1), clamped to +-24 dB
//              (d > 0: a transient is rising, the attack gain acts; d < 0: the tail is falling, the sustain gain acts)
//              below kTransientStilleDb detector level the target glides to 0 dB (no pumping on noise floor)
//   smooth:    g_db moves to the target with a one-pole of 0.2 ms; mix and output level with 2 ms
//   out:       (dry * (1 - mix) + dry * gain * mix) * ausgang
//
// With angriff = halten = ausgang = 0 and mix = 1 the output is bit-identical to the input.
// Latency: 0 samples. Real time: verarbeite(), setze() and the getters do not allocate, lock, throw or do I/O.
#pragma once

#include <cypherdj/dsp/values.h>

namespace cypherdj::dsp {

inline constexpr double kTransientSchnellAttackMs = 0.5;   // attack of the fast envelope
inline constexpr double kTransientGlaettungMs = 0.2;       // smoothing of the gain in dB
inline constexpr double kTransientParamGlaettungMs = 2.0;  // smoothing of mix and output level
inline constexpr double kTransientSpanneDb = 6.0;          // envelope difference that gives the full effect
inline constexpr float kTransientGainMaxDb = 24.0f;        // gain clamp, +- dB
inline constexpr double kTransientStilleDb = -80.0;        // detector level below which the gain glides to 0 dB

// Parameters with their ranges. setze() clamps into the range; a NaN keeps the previous value of that field.
struct TransientParameter {
    float angriff_db = 0.0f;   // attack gain, [-24, 24]
    float halten_db = 0.0f;    // sustain gain, [-24, 24]
    float tempo_ms = 15.0f;    // detector time, [1, 200]
    float ausgang_db = 0.0f;   // output level, [-24, 24]
    float mix = 1.0f;          // dry/wet, [0, 1]
};

class Transient {
public:
    explicit Transient(double fs = kAbtastrate);

    // Real-time safe. Takes effect from the next sample; the gain keeps moving from where it is.
    void setze(const TransientParameter& p);
    const TransientParameter& parameter() const { return p_; }

    // Envelopes and gain empty. Real-time safe.
    void leeren();

    // 1 <= n <= kMaxFrames. in and out may be the same. A NaN or Inf input sample is processed as 0.
    void verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n);

    // Largest |gain in dB| since the last call of this function (read and reset). For a gain meter.
    float groesste_aenderung_db() {
        const float w = static_cast<float>(groesste_);
        groesste_ = 0.0;
        return w;
    }

private:
    void neu_rechnen();

    double fs_;
    TransientParameter p_;
    // derived from p_
    double ef_auf_ = 0.0, ef_ab_ = 0.0, es_auf_ = 0.0, es_ab_ = 0.0, glatt_ = 0.0, param_glatt_ = 0.0, aus_lin_ = 1.0;
    // state
    double ef_ = 0.0, es_ = 0.0, g_db_ = 0.0, groesste_ = 0.0, mix_ = 1.0, aus_ = 1.0;
};

}  // namespace cypherdj::dsp
