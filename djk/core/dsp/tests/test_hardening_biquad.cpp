// Hardening: biquad.h / biquad.cpp (Butterworth sections, LR8 cascades). Property and fuzz checks, fixed seed.
//   1. Coefficients finite and stable (poles inside the unit circle) for fc in [1 Hz, 0.49 fs], q in [0.3, 10],
//      fs 44.1 / 48 / 96 kHz, including the range limits.
//   2. DC and Nyquist gains: low-pass 1 / 0, high-pass 0 / 1 (analytic, from the coefficients).
//   3. LR8 low-pass + high-pass at the same corner sum to an all-pass: |H_tp + H_hp| = 1 within 1e-6.
//   4. No NaN/Inf, bounded output for full-scale fuzz and square input.
//   5. Segmentation independence: Lr8 run in blocks of 1, 7, 64, kMaxFrames is bit-identical (per-sample state).
//   6. leeren(): after loud input, leeren() restores the bit-exact behaviour of a fresh object; a deliberately broken
//      leeren (in-file stand-in that clears only z1) is detected by the same check.
//   7. Denormals: under DenormalSchutz the state of an LR8 decaying after loud input never becomes subnormal.
//
// Mutation check (automatic, CMake target test_haertung_biquad_mutation): biquad.cpp is copied at configure time with
// the high-pass coefficient b1 = -2·norm replaced by -1.999·norm. The DC-gain check (2) and the all-pass check (3)
// are PRUEF_M and fail on that variant (verified 2026-11-02: |H_hp(0)| up to 2.3e5 at fc = 1 Hz, all-pass error
// 1.2e11; the fuzz peak check 4 fails as well). The negative control in check 6 runs in every normal run.
#include <cypherdj/dsp/biquad.h>
#include <cypherdj/dsp/denormal.h>
#include <cypherdj/dsp/values.h>

#include <complex>
#include <cstdio>
#include <vector>

#include "hardening.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

constexpr double kPi = 3.14159265358979323846;

std::complex<double> antwort(const BiquadKoeff& k, double f, double fs) {
    const std::complex<double> z1 = std::polar(1.0, -2.0 * kPi * f / fs);
    return (k.b0 + k.b1 * z1 + k.b2 * z1 * z1) / (1.0 + k.a1 * z1 + k.a2 * z1 * z1);
}
std::complex<double> antwort(const Lr8& l, double f, double fs) {
    std::complex<double> h = 1.0;
    for (const Biquad& b : l.b) h *= antwort(b.k, f, fs);
    return h;
}

bool endlich(const BiquadKoeff& k) {
    return std::isfinite(k.b0) && std::isfinite(k.b1) && std::isfinite(k.b2) && std::isfinite(k.a1) &&
           std::isfinite(k.a2);
}
// Stability triangle of a second-order denominator 1 + a1 z^-1 + a2 z^-2.
bool stabil(const BiquadKoeff& k) { return std::fabs(k.a2) < 1.0 && std::fabs(k.a1) < 1.0 + k.a2; }

// Broken stand-in for check 6: leeren() clears only z1 (negative control of the check itself).
struct BiquadKaputt : Biquad {
    void leeren() { z1 = 0.0; }
};

void pruefe_koeffizienten() {
    Zufall z(11);
    int faelle = 0, instabil = 0, unendlich = 0;
    double dc_tp = 0.0, dc_hp = 0.0, ny_tp = 0.0, ny_hp = 0.0;
    for (double fs : haertung::kRaten) {
        for (int i = 0; i < 2000; ++i) {
            // range limits first, then log-uniform fuzz
            double fc, q;
            if (i < 4) {
                fc = (i & 1) ? 0.49 * fs : 1.0;
                q = (i & 2) ? 10.0 : 0.3;
            } else {
                fc = std::exp(z.zwischen(std::log(1.0), std::log(0.49 * fs)));
                q = std::exp(z.zwischen(std::log(0.3), std::log(10.0)));
            }
            const BiquadKoeff tp = tiefpass_2(fc, q, fs), hp = hochpass_2(fc, q, fs);
            ++faelle;
            unendlich += !endlich(tp) + !endlich(hp);
            instabil += !stabil(tp) + !stabil(hp);
            dc_tp = std::fmax(dc_tp, std::abs(antwort(tp, 0.0, fs) - 1.0));
            dc_hp = std::fmax(dc_hp, std::abs(antwort(hp, 0.0, fs)));
            ny_tp = std::fmax(ny_tp, std::abs(antwort(tp, fs / 2, fs)));
            ny_hp = std::fmax(ny_hp, std::abs(antwort(hp, fs / 2, fs) - 1.0));
        }
    }
    std::printf("coefficients: %d cases, non-finite %d, unstable %d\n", faelle, unendlich, instabil);
    std::printf("  |H_tp(0)-1| %.3g  |H_hp(0)| %.3g  |H_tp(fs/2)| %.3g  |H_hp(fs/2)-1| %.3g\n", dc_tp, dc_hp, ny_tp, ny_hp);
    PRUEF(unendlich == 0);
    PRUEF(instabil == 0);
    // Poles near z = 1 (fc = 1 Hz at 96 kHz) cost precision: measured |H_tp(0) - 1| = 5.5e-8 there (cancellation in
    // 1 + a1 + a2), i.e. 5e-7 dB. Tolerance 1e-6.
    PRUEF_M(dc_tp < 1e-6);
    PRUEF_M(dc_hp < 1e-6);
    PRUEF(ny_tp < 1e-9);
    PRUEF(ny_hp < 1e-9);
}

void pruefe_allpass() {
    double fehler = 0.0;
    for (double fs : haertung::kRaten) {
        for (double fc : {20.0, 246.0, 1000.0, 2484.0, 8000.0, 16000.0}) {
            const Lr8 tp = lr8_tiefpass(fc, fs), hp = lr8_hochpass(fc, fs);
            for (int j = 0; j <= 200; ++j) {
                const double f = 10.0 * std::pow(0.499 * fs / 10.0, j / 200.0);
                fehler = std::fmax(fehler, std::fabs(std::abs(antwort(tp, f, fs) + antwort(hp, f, fs)) - 1.0));
            }
        }
    }
    std::printf("LR8 all-pass sum: max ||H_tp + H_hp| - 1| = %.3g\n", fehler);
    PRUEF_M(fehler < 1e-6);
}

std::vector<float> lauf(Lr8 f, const std::vector<float>& x, int block) {
    std::vector<float> y(x.size());
    for (std::size_t p = 0; p < x.size(); p += static_cast<std::size_t>(block)) {
        const std::size_t e = std::min(x.size(), p + static_cast<std::size_t>(block));
        for (std::size_t i = p; i < e; ++i) y[i] = static_cast<float>(f.schritt(x[i]));
    }
    return y;
}

void pruefe_fuzz_und_bloecke() {
    const int n = 48000;
    std::vector<float> rau = haertung::rauschen(n, 1.0, 21), eck(n);
    for (int i = 0; i < n; ++i) eck[static_cast<std::size_t>(i)] = ((i / 37) & 1) ? 1.0f : -1.0f;  // full-scale square
    double groesste = 0.0;
    bool alles_endlich = true;
    double block_abw = 0.0;
    for (double fs : haertung::kRaten) {
        for (double fc : {20.0, 246.0, 2484.0, 0.45 * fs}) {
            for (int seite = 0; seite < 2; ++seite) {
                const Lr8 f = seite ? lr8_hochpass(fc, fs) : lr8_tiefpass(fc, fs);
                for (const auto* x : {&rau, &eck}) {
                    const std::vector<float> a = lauf(f, *x, 1);
                    alles_endlich = alles_endlich && haertung::endlich(a);
                    groesste = std::fmax(groesste, haertung::spitze(a));
                    for (int b : {7, 64, kMaxFrames}) block_abw = std::fmax(block_abw, haertung::groesste_abweichung(a, lauf(f, *x, b)));
                }
            }
        }
    }
    std::printf("fuzz: finite %d, peak %.4g (input 1.0), block-size deviation %.3g\n", alles_endlich, groesste, block_abw);
    PRUEF(alles_endlich);
    PRUEF(groesste < 4.0);  // LR8 overshoot on a square stays well below 4x
    PRUEF(block_abw == 0.0);
}

template <class B>
bool leeren_wirkt() {
    const BiquadKoeff k = tiefpass_2(300.0, 1.3, 48000.0);
    B frisch, benutzt;
    frisch.k = benutzt.k = k;
    const std::vector<float> laut = haertung::rauschen(4096, 1.0, 31), x = haertung::rauschen(4096, 0.5, 32);
    for (float v : laut) benutzt.schritt(v);
    benutzt.leeren();
    for (float v : x)
        if (frisch.schritt(v) != benutzt.schritt(v)) return false;
    return true;
}

void pruefe_leeren() {
    PRUEF(leeren_wirkt<Biquad>());
    PRUEF(!leeren_wirkt<BiquadKaputt>());  // negative control: the check sees a leeren() that forgets z2
    Lr8 frisch = lr8_hochpass(246.0, 48000.0), benutzt = frisch;
    const std::vector<float> laut = haertung::rauschen(4096, 1.0, 33), x = haertung::rauschen(4096, 0.5, 34);
    for (float v : laut) benutzt.schritt(v);
    benutzt.leeren();
    bool gleich = true;
    for (float v : x) gleich = gleich && frisch.schritt(v) == benutzt.schritt(v);
    PRUEF(gleich);
}

long subnormale_zustaende(const Lr8& f) {
    long n = 0;
    for (const Biquad& b : f.b) n += (std::fpclassify(b.z1) == FP_SUBNORMAL) + (std::fpclassify(b.z2) == FP_SUBNORMAL);
    return n;
}

void pruefe_denormal() {
    long mit = 0, ohne = 0;
    for (double fs : haertung::kRaten) {
        Lr8 a = lr8_tiefpass(246.0, fs), b = a;
        const std::vector<float> laut = haertung::rauschen(static_cast<int>(fs / 10), 1.0, 41);
        {
            DenormalSchutz schutz;
            for (float v : laut) a.schritt(v);
            for (int i = 0; i < static_cast<int>(60 * fs); ++i) {
                a.schritt(0.0);
                mit += subnormale_zustaende(a);
            }
        }
        for (float v : laut) b.schritt(v);
        for (int i = 0; i < static_cast<int>(60 * fs); ++i) {
            b.schritt(0.0);
            ohne += subnormale_zustaende(b);
        }
    }
    // Without the guard the bare Biquad does reach subnormal states (expected: the library relies on DenormalSchutz,
    // Kanalzug sets it per call); printed for the report, not asserted.
    std::printf("denormal: subnormal LR8 states over 60 s silence, with DenormalSchutz %ld, without %ld\n", mit, ohne);
#if defined(__x86_64__) || defined(__i386__)
    PRUEF(mit == 0);
#endif
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_koeffizienten();
        pruefe_allpass();
        pruefe_fuzz_und_bloecke();
        pruefe_leeren();
        pruefe_denormal();
    }
    return haertung::ende();
}
