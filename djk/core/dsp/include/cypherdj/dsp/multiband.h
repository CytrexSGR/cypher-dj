// Multiband compressor, three bands, stereo-linked (package 1.15 "Mix tools", part B).
//
// Crossovers: Linkwitz-Riley 8th order (Lr8 from biquad.h), like the isolator split first at the upper and
// then at the lower crossover. Unlike the isolator the high band runs through the allpass of the lower
// crossover (AP_tief = LP_tief + HP_tief, built as two second-order allpass sections with the Butterworth Qs).
// With all bands neutral the sum is AP_hoch * AP_tief: magnitude exactly 1 at every frequency, only phase.
//
// Per band: detection on max(|L|, |R|) of the band signal (stereo-linked: both channels get the same gain),
// static curve in dB with soft knee (Giannoulis, Massberg, Reiss 2012), the reduction smoothed in the dB domain
// by their smooth decoupled peak detector: a release-only peak hold (abklingen_ms) followed by a one-pole
// attack (anstieg_ms). After anstieg_ms the reduction has covered 1 - 1/e of a level step; release is the
// cascade of both poles (for anstieg << abklingen it falls to 1/e after about abklingen_ms + anstieg_ms).
// Then makeup gain: the automatic part (aufholen_auto, default on) adds back the band's own average gain reduction, so compressing a band
// makes it denser, not quieter; aufholen_db is a trim on top of it. The average is a one-pole mean of the reduction in the dB domain, slow
// where the reduction grows (kMbAusgleichSteigtMs) and faster where it shrinks (kMbAusgleichFaelltMs). A band that stops compressing still rings
// out for a moment (measured 2026-11-05, 9 dB reduction then a drop to just under the threshold: +3.6 dB after 0.1 s, +1.2 dB after 0.3 s, never more than 0.25 dB above
// the earlier loud peak). Solo, bypass and makeup changes move along a linear ramp of kSchaltMs (no clicks).
//
// Upward compression per band (strand 13 slice 4, D10): below auf_schwelle_db the band is lifted by
//   up = min(auf_bereich_db, (auf_schwelle_db - L) * (1 - 1/auf_verhaeltnis))
// with L the band's OWN level (a peak envelope of max(|L|, |R|) of the band signal that decays with abklingen_ms, so the lift does not follow
// the zero crossings of a tone). Below -80 dBFS the lift fades linearly to 0 at -90 dBFS, so silence and the noise floor are not raised. The
// lift is smoothed in the dB domain by a one-pole that rises with abklingen_ms and falls with anstieg_ms (a quiet passage is lifted slowly,
// a loud onset drops the lift quickly). The automatic make-up averages the reduction only, never the lift. auf_verhaeltnis 1 = off: the
// arithmetic of the band is then exactly the one without the upward path (bit-identical).
//
// Key (strand 13 slice 4, D9): verarbeite() takes an optional external key. It is split through a second set of crossovers with the same
// coefficients (own states), and band b detects its DOWNWARD reduction on max(|key_b_l|, |key_b_r|). The lift always uses the band's own
// level, never the key: a silent key gives no reduction and no lift from the key. All three bands listen to the key; a band that should
// not compress stays at ratio 1. Without a key the key filters do not run; their states are cleared once, so a key that comes back starts
// clean. Non-finite key samples count as 0.
//
// Latency: 0 samples (no lookahead). Real-time: verarbeite(), setze_band(), setze_grenzen() and every read
// do not allocate, lock, throw or do I/O. Constructor only outside the callback. The object carries fixed
// buffers for kMaxFrames: create it on the heap. Non-finite input samples count as 0.
#pragma once

#include <algorithm>
#include <cstdint>

#include <cypherdj/dsp/biquad.h>
#include <cypherdj/dsp/isolator.h>
#include <cypherdj/dsp/values.h>

namespace cypherdj::dsp {

// Ranges (setze_band clamps into them, NaN keeps the previous value).
inline constexpr float kMbSchwelleMinDb = -60.0f, kMbSchwelleMaxDb = 0.0f;
inline constexpr float kMbVerhaeltnisMin = 1.0f, kMbVerhaeltnisMax = 20.0f;
inline constexpr float kMbAnstiegMinMs = 0.1f, kMbAnstiegMaxMs = 500.0f;
inline constexpr float kMbAbklingenMinMs = 1.0f, kMbAbklingenMaxMs = 5000.0f;
inline constexpr float kMbKnieMinDb = 0.0f, kMbKnieMaxDb = 24.0f;
inline constexpr float kMbAufholenMinDb = -24.0f, kMbAufholenMaxDb = 24.0f;
inline constexpr float kMbAufSchwelleMinDb = -80.0f, kMbAufSchwelleMaxDb = 0.0f;   // upward threshold
inline constexpr float kMbAufVerhaeltnisMin = 1.0f, kMbAufVerhaeltnisMax = 4.0f;    // upward ratio, 1 = off
inline constexpr float kMbAufBereichMinDb = 0.0f, kMbAufBereichMaxDb = 24.0f;       // largest lift
inline constexpr double kMbAufBodenDb = -90.0;     // no lift at or below this band level ...
inline constexpr double kMbAufVollDb = -80.0;      // ... full lift from this level up (linear in dB between)
inline constexpr double kMbAusgleichSteigtMs = 500.0;  // automatic make-up: time constant while the average reduction grows
inline constexpr double kMbAusgleichFaelltMs = 100.0;  // ... and while it shrinks
inline constexpr double kMbAusgleichMaxDb = 24.0;      // the automatic part never adds more than this (same as the manual range)
inline constexpr double kMbGrenzeMinHz = 20.0;  // crossovers are clamped to [20 Hz, 0.45 fs]

struct MbBandEinstellung {
    float schwelle_db = 0.0f;     // threshold in dBFS (band signal, sample peak of max(|L|, |R|))
    float verhaeltnis = 1.0f;     // ratio, 1 = no compression
    float anstieg_ms = 10.0f;     // attack time constant
    float abklingen_ms = 100.0f;  // release time constant
    float knie_db = 0.0f;         // knee width (total), 0 = hard knee
    float aufholen_db = 0.0f;     // makeup gain; with aufholen_auto a trim on top of the automatic part
    bool aufholen_auto = true;    // automatic make-up: adds back the band's average gain reduction (up to kMbAusgleichMaxDb)
    bool solo = false;            // if any band is solo, only solo bands are heard
    bool umgehen = false;         // bypass: band passes with gain 1 (no compression, no makeup)
    float auf_schwelle_db = -40.0f;  // upward: threshold in dBFS (the band's own level)
    float auf_verhaeltnis = 1.0f;    // upward ratio, 1 = off
    float auf_bereich_db = 6.0f;     // upward: largest lift in dB
};

// Detector and gain computer of one band, on its own so the timing can be tested sample by sample.
class MbDetektor {
public:
    void setze(const MbBandEinstellung& e, double fs);
    // pegel: max(|L|, |R|) of the band sample; returns the smoothed gain reduction in dB (<= 0). The lift follows the same level.
    double schritt(double pegel);
    // With a key: pegel_ab (the key band) drives the reduction, pegel_auf (the band itself) the lift.
    double schritt(double pegel_ab, double pegel_auf);
    // Static upward curve: lift in dB (>= 0) for a band level in dBFS, with the floor fade.
    double aufwaerts_statisch_db(double x_db) const;
    // Smoothed lift in dB (>= 0); 0 with auf_verhaeltnis 1 once settled.
    double anhebung_db() const { return u_db_; }
    // Static curve: gain reduction in dB (<= 0) for an input level in dBFS.
    double statisch_db(double x_db) const;
    double absenkung_db() const { return g_db_; }
    // Average gain reduction in dB (<= 0), the basis of the automatic make-up, and the make-up itself (>= 0, capped).
    double mittel_db() const { return m_db_; }
    double ausgleich_db() const { return std::min(-m_db_, kMbAusgleichMaxDb); }
    void leeren() { y1_ = g_db_ = m_db_ = h_ = u_db_ = 0.0; }

private:
    double schwelle_ = 0.0, steigung_ = 0.0, knie_ = 0.0;  // steigung_ = 1/R - 1
    double a_anstieg_ = 0.0, a_abklingen_ = 0.0;
    double a_mittel_steigt_ = 0.0, a_mittel_faellt_ = 0.0;   // mean of the reduction: coefficients for growing / shrinking
    double y1_ = 0.0;   // peak-held reduction (dB, >= 0)
    double g_db_ = 0.0;  // smoothed gain reduction (dB, <= 0)
    double m_db_ = 0.0;  // mean of g_db_ (dB, <= 0)
    double schritt_ab(double pegel);
    void schritt_auf(double pegel);
    double auf_schwelle_ = -40.0, auf_steigung_ = 0.0, auf_bereich_ = 6.0;  // auf_steigung_ = 1 - 1/R_u (0 = off)
    double h_abfall_ = 0.0;  // per-sample decay of the level envelope (linear, release time)
    double h_ = 0.0;         // peak envelope of the band's own level (linear)
    double u_db_ = 0.0;      // smoothed lift (dB, >= 0)
};

class MultibandKompressor {
public:
    static constexpr int kBaender = 3;
    static constexpr double kSchaltMs = 5.0;  // solo/bypass/makeup ramp

    explicit MultibandKompressor(double fs = kAbtastrate, double grenze_tief_hz = 200.0,
                                 double grenze_hoch_hz = 2000.0);

    // Filter and detector states empty, ramps at their targets, settings stay.
    void leeren();
    // New crossovers (coefficients only, states stay). hoch is raised to at least tief.
    void setze_grenzen(double grenze_tief_hz, double grenze_hoch_hz);
    double grenze_tief_hz() const { return grenze_tief_; }
    double grenze_hoch_hz() const { return grenze_hoch_; }

    // Takes over the DYNAMICS of another object of the same sample rate: settings, detector states (peak hold and smoothed reduction) and
    // the gain ramps of every band, so the compression does not settle in again. The filter states and the crossovers stay as they are.
    // For the crossover change by crossfade (the Mixer runs two objects with different crossovers side by side). Real-time safe.
    void uebernehme_dynamik(const MultibandKompressor& o);
    // The two halves of it, for tests that must tell them apart: the detectors (peak hold and smoothed reduction, largest reduction) and the
    // settings with their gain ramps.
    void uebernehme_detektoren(const MultibandKompressor& o);
    void uebernehme_rampen(const MultibandKompressor& o);

    void setze_band(Band b, const MbBandEinstellung& e);
    const MbBandEinstellung& band_einstellung(Band b) const { return einst_[static_cast<int>(b)]; }

    // in -> out, 1 <= n <= kMaxFrames; in and out may be the same buffers. key_l/key_r: optional external key (both nullptr = none; a
    // nullptr key_r with a key_l uses key_l for both channels). See the key paragraph at the top.
    void verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n, const float* key_l = nullptr,
                    const float* key_r = nullptr);

    // Metering, read from the audio thread after verarbeite(). Values in dB, <= 0; a bypassed band shows 0.
    // aktuelle: at the last sample; groesste: largest reduction since the last call of groesste (resets).
    float aktuelle_absenkung_db(Band b) const;
    // The automatic part of the make-up at the last sample, in dB (>= 0; 0 with aufholen_auto off or a bypassed band).
    float ausgleich_db(Band b) const;
    float groesste_absenkung_db(Band b);
    // Upward lift at the last sample in dB (>= 0; 0 for a bypassed band).
    float aktuelle_anhebung_db(Band b) const;
    // Largest change since the last call (resets), signed: positive = reduction, negative = lift, the larger magnitude wins. 0 when bypassed.
    // Independent of groesste_absenkung_db (each has its own reset).
    float groesste_aenderung_db(Band b);

    int latenz_samples() const { return 0; }
    int schalt_samples() const { return schalt_samples_; }

private:
    struct Kanal {
        Lr8 tp_hoch, hp_hoch, tp_tief, hp_tief;
        Biquad ap_tief[2];  // allpass of the lower crossover for the high band
        void leeren();
    };
    static void teile(Kanal& k, double x, double* band);
    struct Rampe {
        double wert = 0.0, ziel = 0.0, schritt = 0.0;
        int rest = 0;
        void setze(double z, int dauer);
        double weiter() {
            if (rest > 0) {
                wert += schritt;
                if (--rest == 0) wert = ziel;
            }
            return wert;
        }
    };
    void ziele_neu(bool sofort);

    double fs_;
    double grenze_tief_ = 200.0, grenze_hoch_ = 2000.0;
    int schalt_samples_;
    Kanal k_[2];
    Kanal ks_[2];          // key split: the same coefficients as k_, own states
    bool ks_laeuft_ = false;  // the key filters ran since they were last cleared
    MbBandEinstellung einst_[kBaender];
    MbDetektor det_[kBaender];
    Rampe nass_[kBaender], trocken_[kBaender];  // band gain = trocken + nass * 10^((GR + auto_ * ausgleich) / 20)
    Rampe auto_[kBaender];                      // 1 = the automatic make-up counts (switching it moves along the same 5 ms ramp)
    float groesste_[kBaender] = {0.0f, 0.0f, 0.0f};
    float aenderung_[kBaender] = {0.0f, 0.0f, 0.0f};  // signed, see groesste_aenderung_db
};

}  // namespace cypherdj::dsp
