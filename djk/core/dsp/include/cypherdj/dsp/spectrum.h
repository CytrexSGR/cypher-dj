// Spectrum analyser for a UI (package 1.15 "Mix tools", part C).
//
// Two sides, two threads:
//   audio thread:     schreibe() only copies the mono sum (l + r) / 2 into a lock-free single-producer /
//                     single-consumer ring. No allocation, no lock, no FFT. A full ring drops the new samples
//                     and counts them (verlorene_samples()), it never waits.
//   analysis thread:  analysiere() takes everything that is in the ring and computes one frame per hop
//                     (hop = groesse / ueberlappung): Hann window, own radix-2 FFT, power per band on a
//                     logarithmic grid (default 1/6 octave, centres 1000 Hz * 2^(i/b)), smoothing, peak hold.
//                     Every other method belongs to this thread as well, except schreibe() and the two atomic
//                     getters named below.
// Thread rules in one place:
//   audio thread only:    schreibe().
//   any thread:           schreib_position() (acquire load), verlorene_samples() (relaxed load); these two are the
//                         only getters that are safe across threads. A source switch stores the position
//                         on the audio thread at the moment the new source starts; the analysis thread hands it on.
//   analysis thread only: analysiere(), verwerfe_bis(), leeren(), setze_*(), and all other getters (rahmen(), groesse(), hop(), the
//                         band getters, pegel_db(), spitze_db()): they read plain members.
// Source change: leeren() only clears the analysis side (window, levels, peaks); samples of the old source that are
// still in the ring are analysed afterwards. verwerfe_bis(cut) drops everything written before the cut (index from
// schreib_position()) and then calls leeren(), so the first frame after it holds the new source only.
// All buffers are fixed members (largest size 4096); nothing allocates after construction.
//
// Level scale: a full-scale sine (amplitude 1) reads 0 dB in the band that contains it, independent of the FFT
// size and of where the sine falls between bins (Hann: the power of the main lobe is summed and divided by the
// equivalent noise bandwidth of 1.5 bins). White noise reads its power in the band relative to a full-scale sine.
// A band narrower than one bin (low bands with small sizes) takes the power density interpolated at its centre
// times its width, so noise stays continuous there and a tone reads lower than in a wide band.
// Smoothing: exponential in power per frame with time constant glaettung_ms. Peak hold: a band's peak stays for
// halten_ms, then falls by fallen_db_pro_s, never below the current level. Values are floored at kStummDb.
#pragma once

#include <atomic>
#include <cstddef>

#include <cypherdj/dsp/values.h>

namespace cypherdj::dsp {

// Complex in-place radix-2 FFT (decimation in time), sizes 2 ... kMax, twiddles from one table for kMax.
class Fft {
public:
    static constexpr int kMax = 4096;
    Fft();
    bool setze_groesse(int n);   // power of two in [2, kMax]; false (and unchanged) otherwise
    int groesse() const { return n_; }
    // X[k] = sum_j x[j] * exp(-2 pi i j k / n), in place on re/im (n values each).
    void transformiere(double* re, double* im) const;

private:
    int n_ = 0;
    double cos_[kMax / 2];
    double sin_[kMax / 2];
    int umkehr_[kMax];
};

struct SpektrumEinstellung {
    int groesse = 2048;              // FFT size: 1024, 2048 or 4096
    int ueberlappung = 4;            // 1, 2, 4 or 8 frames per FFT length (hop = groesse / ueberlappung)
    int baender_pro_oktave = 6;      // 1 ... 24 (6 = 1/6 octave)
    float f_min_hz = 20.0f;          // lowest band centre at or above this
    float f_max_hz = 20000.0f;       // highest band centre at or below this (and below fs / 2)
    float glaettung_ms = 100.0f;     // 0 = off; 0 ... 10000
    float halten_ms = 1000.0f;       // peak hold, 0 ... 10000
    float fallen_db_pro_s = 20.0f;   // peak fall after the hold, 0 ... 1000 dB/s
};

class SpektrumAnalysator {
public:
    static constexpr int kMinGroesse = 1024;
    static constexpr int kMaxGroesse = Fft::kMax;
    static constexpr int kRing = 16384;          // power of two; > kMaxFrames + kMaxGroesse
    static constexpr int kMaxBaender = 256;

    explicit SpektrumAnalysator(double fs = kAbtastrate, const SpektrumEinstellung& e = {});
    SpektrumAnalysator(const SpektrumAnalysator&) = delete;
    SpektrumAnalysator& operator=(const SpektrumAnalysator&) = delete;

    // --- audio thread (single producer) ---
    // Copies (l + r) / 2, or l alone when r == nullptr. 1 <= n <= kMaxFrames. NaN/Inf count as 0.
    void schreibe(const float* l, const float* r, int n);
    long verlorene_samples() const { return verloren_.load(std::memory_order_relaxed); }
    // Number of samples accepted into the ring since construction (monotonic, never wraps in practice).
    // Callable from any thread; the audio thread stores it at a source switch, the analysis thread passes it to verwerfe_bis().
    std::size_t schreib_position() const { return schreib_.load(std::memory_order_acquire); }

    // --- analysis thread (single consumer) ---
    int analysiere();                    // computes all complete frames in the ring; returns their number
    bool setze_groesse(int groesse);     // 1024 / 2048 / 4096; clears history and values; false if invalid
    bool setze_ueberlappung(int u);      // 1 / 2 / 4 / 8; false if invalid
    void setze_glaettung_ms(float ms);
    void setze_spitze(float halten_ms, float fallen_db_pro_s);
    // Drops every sample written before the cut: lese_ = max(lese_, min(pos, schreib_)), then leeren().
    // pos beyond the write index is clamped to it, pos in the past never rewinds. Analysis thread only.
    void verwerfe_bis(std::size_t pos);
    void leeren();                       // history, levels and peaks back to silence (the ring stays)

    int groesse() const { return groesse_; }
    int hop() const { return hop_; }
    long rahmen() const { return rahmen_; }                  // frames computed since construction / leeren()
    int anzahl_baender() const { return baender_; }
    float band_mitte_hz(int b) const { return mitte_hz_[b]; }
    float band_unten_hz(int b) const { return unten_hz_[b]; }
    float band_oben_hz(int b) const { return oben_hz_[b]; }
    int band_bins(int b) const { return bin_hi_[b] - bin_lo_[b]; }  // FFT bins summed; 0 = interpolated
    const float* pegel_db() const { return pegel_db_; }       // smoothed level per band
    const float* spitze_db() const { return spitze_db_; }     // peak hold per band

private:
    void baender_anlegen();
    void bins_zuordnen();
    void rahmen_rechnen();
    void zeiten_rechnen();

    double fs_;
    int groesse_, ueberlappung_, hop_;
    int pro_oktave_;
    float f_min_, f_max_;
    float glaettung_ms_;
    double glaett_a_;
    float halten_ms_, fallen_db_s_;
    int halten_rahmen_;
    float fallen_db_rahmen_;

    // ring (audio thread writes, analysis thread reads); indices count samples and wrap via the mask
    alignas(64) std::atomic<std::size_t> schreib_{0};
    alignas(64) std::atomic<std::size_t> lese_{0};
    alignas(64) std::atomic<long> verloren_{0};
    float ring_[kRing];

    // analysis side
    Fft fft_;
    float verlauf_[kMaxGroesse];     // last groesse_ samples, circular
    int verlauf_pos_;
    int seit_rahmen_;                // samples since the last frame
    long rahmen_;
    double fenster_[kMaxGroesse];
    double re_[kMaxGroesse], im_[kMaxGroesse];
    double leistung_[kMaxGroesse / 2 + 1];

    int baender_;
    float mitte_hz_[kMaxBaender], unten_hz_[kMaxBaender], oben_hz_[kMaxBaender];
    int bin_lo_[kMaxBaender], bin_hi_[kMaxBaender];
    double glatt_[kMaxBaender];      // smoothed power
    float pegel_db_[kMaxBaender];
    float spitze_db_[kMaxBaender];
    int halten_rest_[kMaxBaender];
};

}  // namespace cypherdj::dsp
