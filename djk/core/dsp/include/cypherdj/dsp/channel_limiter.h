// Channel limiter as an insert (package 1.15 "Mix tools", part C): brickwall peak limiter with lookahead,
// stereo linked, optional true-peak detection with 4x oversampling.
//
// Method (the same gain computer as MasterLimiter in messer/, see master_limiter.h; reimplemented here because
// that one is fixed to 48 kHz and stereo inside one function, lives in cypherdj_dsp_messer with libebur128, and
// must not change):
//   1. peak per input sample: max(|l|, |r|), or in true-peak mode the largest of the four 4x-interpolated values
//      (Kaiser sinc, 97 taps, beta 6: flat within -0.007 ... +0.014 dB up to 20 kHz at 48 kHz. The 49-tap
//      libebur128 interpolator that MasterLimiter (a) uses droops 0.033 dB at 12 kHz and 1.8 dB at 20 kHz, so a
//      limiter relying on it alone overshoots; measured in tests/test_channel_limiter.cpp);
//   2. needed gain q = min(1, ceiling / peak);
//   3. sliding minimum of q over anstieg + 2 * halten + 1 values (monotonic queue in a fixed ring);
//   4. release: falls at once, rises one-pole with the release time constant, never above the minimum;
//   5. moving average over anstieg + 1 values (the attack ramp).
// The signal is delayed by latenz_samples() = anstieg + halten (+ 12 in true-peak mode, the interpolator delay).
// Then the gain at every output sample is <= the needed gain of every input sample within +-halten of it:
// no output sample (no 4x-interpolated output value in true-peak mode) exceeds the ceiling.
// Real-time safe: verarbeite() does not allocate, lock, throw or do I/O. NaN/Inf at the input count as 0.
#pragma once

#include <cypherdj/dsp/values.h>

namespace cypherdj::dsp {

struct KanalLimiterEinstellung {
    float decke_db = -0.3f;        // ceiling in dBFS (dBTP in true-peak mode), -60 ... 0
    float vorhalt_ms = 1.5f;       // lookahead = attack ramp, 0.1 ... 20 ms (fixed after construction)
    float abklingen_ms = 80.0f;    // release time constant, 1 ... 2000 ms
    bool echtspitze = false;       // true-peak detection with 4x oversampling (fixed after construction)
};

class KanalLimiter {
public:
    static constexpr int kHalten = 2;                  // samples of full reduction on both sides of a peak
    static constexpr int kInterpVerzug = 12;           // delay of the 4x interpolator in input samples
    static constexpr int kInterpPhasen = 4, kInterpAbgriffe = 25;  // 97 taps; phase 0 is the sample itself
    static constexpr int kMaxAnstieg = 2048;           // 20 ms at 96 kHz fits
    static constexpr int kMaxFenster = kMaxAnstieg + 2 * kHalten + 1;
    static constexpr int kMaxLatenz = kMaxAnstieg + kHalten + kInterpVerzug;
    static constexpr float kRundungsReserveDb = 0.001f;  // ceiling internally this much lower (float rounding)
    static constexpr float kInterpReserveDb = 0.01f;     // true-peak mode: further reserve for the interpolator ripple

    explicit KanalLimiter(double fs = kAbtastrate, const KanalLimiterEinstellung& e = {});

    // in -> out, 1 <= n <= kMaxFrames; in and out may be the same buffers.
    void verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n);

    // Real-time safe, take effect from the next sample (no allocation, no latency change).
    void setze_decke_db(float db);
    void setze_abklingen_ms(float ms);

    int latenz_samples() const { return latenz_; }      // constant for the lifetime of the object
    int anstieg_samples() const { return anstieg_; }
    bool echtspitze() const { return echtspitze_; }
    float decke_db() const { return decke_db_; }
    float aktuelle_verstaerkung() const { return letzte_verstaerkung_; }  // linear, last output sample
    float groesste_absenkung_db();   // since the last call, <= 0; resets
    void leeren();

private:
    float spitze(float xl, float xr);
    float naechste_verstaerkung(float spitze);

    double fs_;
    bool echtspitze_;
    int anstieg_, fenster_, latenz_;
    float decke_db_, decke_;
    double abkling_koeff_;

    // 4x interpolator (true-peak mode)
    double i_koeff_[kInterpPhasen][kInterpAbgriffe];
    int i_index_[kInterpPhasen][kInterpAbgriffe];
    int i_n_[kInterpPhasen];
    float i_z_[2][kInterpAbgriffe];
    int i_pos_;

    // sliding minimum (monotonic queue in a fixed ring)
    float min_wert_[kMaxFenster + 1];
    long min_zeit_[kMaxFenster + 1];
    int min_kopf_, min_ende_, min_n_;
    long zeit_;

    // release and moving average
    double h_rel_;
    float mittel_ring_[kMaxAnstieg + 1];
    int mittel_pos_;
    double mittel_summe_;
    int unter_eins_;

    // signal delay
    float verz_[2][kMaxLatenz + 1];
    int verz_pos_;

    float kleinste_verstaerkung_;
    float letzte_verstaerkung_;
};

}  // namespace cypherdj::dsp
