// Multiband stereo imager, three bands (strand 5, slice 3: "bild" insert kind).
//
// Split: Linkwitz-Riley 4th order (two cascaded Butterworth 2nd-order sections, Q = 1/sqrt(2)), same topology as
// multiband.h but 4th instead of 8th order: the high split first (LP -> rest, HP -> high band), then the low split on
// the rest (LP -> low, HP -> mid); the high band runs through the allpass of the low crossover (LP + HP of an LR4 is a
// 2nd-order allpass with the Butterworth Q). With all widths 1 the sum is AP_low * AP_high: magnitude exactly 1.
//
// Per band M/S: M = (L + R) / 2, S = (L - R) / 2 * width, L = M + S, R = M - S. breite_tief is clamped to 0..1 (the low band
// can be narrowed, never widened), breite_mitte and breite_hoch to 0..2. Width changes move along a linear 10 ms ramp.
//
// mono_unter_hz > 0: an extra LR4 split at that frequency on the output makes everything below it mono (L = R = (L + R) / 2 of
// the lows), crossfaded in and out over the same 10 ms (proc = HP + mono(LP), out = dry + mu * (proc - dry)); at 0 the stage is
// skipped and costs nothing, and the output stays bit-exact with the three-band sum.
//
// Crossover changes: the filter set that was running is copied, the new coefficients go to the live set, and the old set fades
// out over 10 ms (equal-gain crossfade of the two band-processed outputs, like the mb crossfade in ArrInserts). Costs a second
// split only while fading.
//
// korrelation_tief(): correlation of the LOW band (after its width and the mono-under blend, measured on the band signal), -1..1,
// 1 when there was no energy; read-and-reset. When mono_unter_hz is above the low crossover the whole low band is mono and the value is exact; below it
// the meter treats the whole low band as blended by the same mono amount (an approximation, for the face only).
//
// Latency 0 samples. Real time: verarbeite(), setze() and the getters do not allocate, lock, throw or do I/O; the object has no
// buffers (works in place). Non-finite input samples count as 0. Plain doubles inside, floats at the edge.
#pragma once

#include <algorithm>
#include <cmath>

#include <cypherdj/dsp/biquad.h>
#include <cypherdj/dsp/denormal.h>
#include <cypherdj/dsp/values.h>

namespace cypherdj::dsp {

inline constexpr float kBildGrenzeMinHz = 20.0f;
inline constexpr float kBildBreiteTiefMax = 1.0f, kBildBreiteMax = 2.0f;
inline constexpr float kBildMonoUnterMinHz = 20.0f, kBildMonoUnterMaxHz = 500.0f;
inline constexpr double kBildRampeMs = 10.0;

struct ImagerParameter {
    float grenze_tief_hz = 150.0f;
    float grenze_hoch_hz = 4000.0f;
    float breite_tief = 1.0f;    // 0..1
    float breite_mitte = 1.0f;   // 0..2
    float breite_hoch = 1.0f;    // 0..2
    float mono_unter_hz = 0.0f;  // 0 = off, else 20..500
};

class Imager {
public:
    explicit Imager(double fs = kAbtastrate) : fs_(fs), ramp_samples_(std::max(1, static_cast<int>(std::lround(kBildRampeMs * 1e-3 * fs)))) {
        entwerfe(live_, p_.grenze_tief_hz, p_.grenze_hoch_hz);
        mono_entwerfen();
        for (Rampe& r : breite_) r.wert = r.ziel = 1.0;
    }

    // Clamps into the ranges; NaN keeps the previous value of that field. Not allocating.
    void setze(const ImagerParameter& in) {
        ImagerParameter n = p_;
        const double hi = 0.45 * fs_;
        if (!std::isnan(in.grenze_tief_hz)) n.grenze_tief_hz = static_cast<float>(std::clamp<double>(in.grenze_tief_hz, kBildGrenzeMinHz, hi));
        if (!std::isnan(in.grenze_hoch_hz)) n.grenze_hoch_hz = static_cast<float>(std::clamp<double>(in.grenze_hoch_hz, kBildGrenzeMinHz, hi));
        n.grenze_hoch_hz = std::max(n.grenze_hoch_hz, n.grenze_tief_hz);
        if (!std::isnan(in.breite_tief)) n.breite_tief = std::clamp(in.breite_tief, 0.0f, kBildBreiteTiefMax);
        if (!std::isnan(in.breite_mitte)) n.breite_mitte = std::clamp(in.breite_mitte, 0.0f, kBildBreiteMax);
        if (!std::isnan(in.breite_hoch)) n.breite_hoch = std::clamp(in.breite_hoch, 0.0f, kBildBreiteMax);
        if (!std::isnan(in.mono_unter_hz)) {
            n.mono_unter_hz = in.mono_unter_hz <= 0.0f ? 0.0f : std::clamp(in.mono_unter_hz, kBildMonoUnterMinHz, kBildMonoUnterMaxHz);
        }
        if (n.grenze_tief_hz != p_.grenze_tief_hz || n.grenze_hoch_hz != p_.grenze_hoch_hz) {
            alt_ = live_;  // old coefficients and states keep running while they fade out
            entwerfe(live_, n.grenze_tief_hz, n.grenze_hoch_hz);
            kreuz_rest_ = ramp_samples_;
        }
        if (n.breite_tief != p_.breite_tief) breite_[0].setze(n.breite_tief, ramp_samples_);
        if (n.breite_mitte != p_.breite_mitte) breite_[1].setze(n.breite_mitte, ramp_samples_);
        if (n.breite_hoch != p_.breite_hoch) breite_[2].setze(n.breite_hoch, ramp_samples_);
        if (n.mono_unter_hz != p_.mono_unter_hz) {
            if (n.mono_unter_hz > 0.0f) {
                p_.mono_unter_hz = n.mono_unter_hz;
                mono_entwerfen();
            }
            mono_.setze(n.mono_unter_hz > 0.0f ? 1.0 : 0.0, ramp_samples_);
        }
        p_ = n;
    }
    const ImagerParameter& parameter() const { return p_; }

    // States empty, ramps at their targets, settings stay.
    void leeren() {
        live_.leeren();
        alt_.leeren();
        kreuz_rest_ = 0;
        for (Rampe& r : breite_) r.wert = r.ziel, r.rest = 0;
        mono_.wert = mono_.ziel;
        mono_.rest = 0;
        mono_aktiv_ = false;
        for (auto& k : mono_lp_) k[0].leeren(), k[1].leeren();
        for (auto& k : mono_hp_) k[0].leeren(), k[1].leeren();
        s_ll_ = s_rr_ = s_lr_ = 0.0;
    }

    // in -> out, 1 <= n <= kMaxFrames; in and out may be the same buffers.
    void verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n) {
        const DenormalSchutz schutz;
        for (int i = 0; i < n; ++i) {
            const double xl = std::isfinite(in_l[i]) ? static_cast<double>(in_l[i]) : 0.0;
            const double xr = std::isfinite(in_r[i]) ? static_cast<double>(in_r[i]) : 0.0;
            double w[3] = {breite_[0].weiter(), breite_[1].weiter(), breite_[2].weiter()};
            double ol, orr, tl, tr;
            satz(live_, xl, xr, w, ol, orr, tl, tr);
            if (kreuz_rest_ > 0) {
                const double a = static_cast<double>(kreuz_rest_) / static_cast<double>(ramp_samples_);  // weight of the old set
                double al, ar, atl, atr;
                satz(alt_, xl, xr, w, al, ar, atl, atr);
                ol += a * (al - ol);
                orr += a * (ar - orr);
                tl += a * (atl - tl);
                tr += a * (atr - tr);
                --kreuz_rest_;
            }
            const double mu = mono_.weiter();
            if (mu > 0.0 || mono_.ziel > 0.0) {
                double pl = ol, pr = orr;
                if (mu > 0.0) mono_unter(ol, orr, mu, pl, pr);
                ol = pl;
                orr = pr;
                mono_aktiv_ = true;
            } else if (mono_aktiv_) {  // ramp-down finished: start the next switch-on from empty states
                mono_leer();
                mono_aktiv_ = false;
            }
            // meter: low band with the mono blend
            const double m = 0.5 * (tl + tr), bl = tl + mu * (m - tl), br = tr + mu * (m - tr);
            s_ll_ += bl * bl;
            s_rr_ += br * br;
            s_lr_ += bl * br;
            out_l[i] = static_cast<float>(ol);
            out_r[i] = static_cast<float>(orr);
        }
    }

    // Correlation of the low band since the last call, -1..1 (1 = mono or silent); resets.
    float korrelation_tief() {
        const double d = std::sqrt(s_ll_ * s_rr_);
        const float k = d > 1e-20 ? static_cast<float>(std::clamp(s_lr_ / d, -1.0, 1.0)) : 1.0f;
        s_ll_ = s_rr_ = s_lr_ = 0.0;
        return k;
    }

    int latenz_samples() const { return 0; }
    int rampe_samples() const { return ramp_samples_; }

private:
    struct Rampe {
        double wert = 0.0, ziel = 0.0, schritt = 0.0;
        int rest = 0;
        void setze(double z, int dauer) {
            ziel = z;
            rest = dauer;
            schritt = (z - wert) / dauer;
        }
        double weiter() {
            if (rest > 0) {
                wert += schritt;
                if (--rest == 0) wert = ziel;
            }
            return wert;
        }
    };
    struct Lr4 {  // two Butterworth sections
        Biquad b[2];
        double schritt(double x) { return b[1].schritt(b[0].schritt(x)); }
        void leeren() { b[0].leeren(); b[1].leeren(); }
    };
    // One complete split with its own coefficients and states (copied as a whole for the crossover fade).
    struct Zug {
        Lr4 tp_hoch[2], hp_hoch[2], tp_tief[2], hp_tief[2];
        Biquad ap_tief[2];
        void leeren() {
            for (int c = 0; c < 2; ++c) {
                tp_hoch[c].leeren(); hp_hoch[c].leeren(); tp_tief[c].leeren(); hp_tief[c].leeren();
                ap_tief[c].leeren();
            }
        }
    };

    static constexpr double kQ = 0.70710678118654752440;

    void entwerfe(Zug& z, double tief, double hoch) const {
        const BiquadKoeff tp_h = tiefpass_2(hoch, kQ, fs_), hp_h = hochpass_2(hoch, kQ, fs_);
        const BiquadKoeff tp_t = tiefpass_2(tief, kQ, fs_), hp_t = hochpass_2(tief, kQ, fs_);
        BiquadKoeff ap = tp_t;  // LR4 low + high = ONE 2nd-order allpass (Butterworth Q): b = (a2, a1, 1)
        ap.b0 = ap.a2;
        ap.b1 = ap.a1;
        ap.b2 = 1.0;
        for (int c = 0; c < 2; ++c) {
            for (int s = 0; s < 2; ++s) {
                z.tp_hoch[c].b[s].k = tp_h;
                z.hp_hoch[c].b[s].k = hp_h;
                z.tp_tief[c].b[s].k = tp_t;
                z.hp_tief[c].b[s].k = hp_t;
            }
            z.ap_tief[c].k = ap;
        }
    }

    static void ms(double& l, double& r, double w) {
        const double m = 0.5 * (l + r), s = 0.5 * (l - r) * w;
        l = m + s;
        r = m - s;
    }

    // Split, widen, sum. tl/tr: the low band after its width (for the meter).
    static void satz(Zug& z, double xl, double xr, const double w[3], double& ol, double& orr, double& tl, double& tr) {
        const double rl = z.tp_hoch[0].schritt(xl), rr = z.tp_hoch[1].schritt(xr);
        double hl = z.hp_hoch[0].schritt(xl), hr = z.hp_hoch[1].schritt(xr);
        double ll = z.tp_tief[0].schritt(rl), lr = z.tp_tief[1].schritt(rr);
        double ml = z.hp_tief[0].schritt(rl), mr = z.hp_tief[1].schritt(rr);
        hl = z.ap_tief[0].schritt(hl);
        hr = z.ap_tief[1].schritt(hr);
        ms(ll, lr, w[0]);
        ms(ml, mr, w[1]);
        ms(hl, hr, w[2]);
        tl = ll;
        tr = lr;
        ol = ll + ml + hl;
        orr = lr + mr + hr;
    }

    void mono_entwerfen() {
        const BiquadKoeff tp = tiefpass_2(p_.mono_unter_hz, kQ, fs_), hp = hochpass_2(p_.mono_unter_hz, kQ, fs_);
        for (int c = 0; c < 2; ++c)
            for (int s = 0; s < 2; ++s) {
                mono_lp_[c][s].k = tp;
                mono_hp_[c][s].k = hp;
            }
    }
    void mono_leer() {
        for (auto& k : mono_lp_) k[0].leeren(), k[1].leeren();
        for (auto& k : mono_hp_) k[0].leeren(), k[1].leeren();
    }
    // proc = HP(x) + mono(LP(x)); out = x + mu * (proc - x)
    void mono_unter(double ol, double orr, double mu, double& pl, double& pr) {
        const double ll = mono_lp_[0][1].schritt(mono_lp_[0][0].schritt(ol)), lr = mono_lp_[1][1].schritt(mono_lp_[1][0].schritt(orr));
        const double hl = mono_hp_[0][1].schritt(mono_hp_[0][0].schritt(ol)), hr = mono_hp_[1][1].schritt(mono_hp_[1][0].schritt(orr));
        const double m = 0.5 * (ll + lr);
        pl = ol + mu * (hl + m - ol);
        pr = orr + mu * (hr + m - orr);
    }

    double fs_;
    int ramp_samples_;
    ImagerParameter p_;
    Zug live_, alt_;
    int kreuz_rest_ = 0;
    Rampe breite_[3];
    Rampe mono_;
    bool mono_aktiv_ = false;
    Biquad mono_lp_[2][2], mono_hp_[2][2];
    double s_ll_ = 0.0, s_rr_ = 0.0, s_lr_ = 0.0;
};

}  // namespace cypherdj::dsp
