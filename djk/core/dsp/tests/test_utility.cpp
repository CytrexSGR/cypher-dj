// Package 1.15: utility against analytic expectations (matrix values, levels in dB, LR8 and DC-blocker
// magnitude formulas, ramp length in samples).
// Call: test_utility [1]   (1 = mutation build CYPHERDJ_DSP_MUTATION_UTILITY_HART, where matrix changes jump
//                            without a ramp: the click check on the phase switch MUST then fail)
#include <cypherdj/dsp/utility.h>

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>

#include "measure.h"
#include "check.h"

using namespace cypherdj::dsp;

namespace {

constexpr double kFs = 48000.0;
constexpr double kPi = 3.14159265358979323846;

struct Lauf {
    std::vector<float> l, r;
};

// block <= 0: pseudo-random block sizes 1..kMaxFrames.
Lauf durch(Utility& u, const std::vector<float>& l, const std::vector<float>& r, int block) {
    Lauf a{std::vector<float>(l.size()), std::vector<float>(l.size())};
    unsigned s = 777;
    for (std::size_t p = 0; p < l.size();) {
        int b = block;
        if (b <= 0) { s = s * 1664525u + 1013904223u; b = 1 + static_cast<int>((s >> 8) % kMaxFrames); }
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(b), l.size() - p));
        u.verarbeite(&l[p], &r[p], &a.l[p], &a.r[p], n);
        p += static_cast<std::size_t>(n);
    }
    return a;
}

std::vector<float> konstant(std::size_t n, float v) { return std::vector<float>(n, v); }

std::vector<float> rauschen(std::size_t n, unsigned s) {
    std::vector<float> x(n);
    for (float& v : x) { s = s * 1664525u + 1013904223u; v = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5); }
    return x;
}

// Steady-state DC output for DC inputs a (L) and b (R) after the ramp.
Lauf dc_test(const UtilityParameter& p, float a, float b) {
    auto u = std::make_unique<Utility>(kFs);
    u->setze(p);
    return durch(*u, konstant(2048, a), konstant(2048, b), 256);
}

// Prewarped frequency ratio of the bilinear transform, as used by biquad.cpp.
double r_bilinear(double f, double fc) { return std::tan(kPi * f / kFs) / std::tan(kPi * fc / kFs); }

// Level of channel y relative to x in dB, measured over 1 s after 1 s settling.
double pegel_db(const std::vector<float>& y, const std::vector<float>& x) {
    return messen::db(messen::rms(y, 48000, 96000) / messen::rms(x, 48000, 96000));
}

}  // namespace

int main(int argc, char** argv) {
    const bool mutation = argc > 1 && std::atoi(argv[1]) == 1;
    const int kRampe = static_cast<int>(std::lround(kUtilityRampeMs * 1e-3 * kFs));  // 480

    // 1) Click check (MUST fail on the mutation): L = DC 0.5, phase invert L switched on. With the ramp the output
    //    goes linearly from +0.5 to -0.5 in 480 samples: step 1/480 = 0.002083, the hard switch makes a step of 1.
    {
        auto u = std::make_unique<Utility>(kFs);
        const auto dc = konstant(2048, 0.5f);
        durch(*u, dc, dc, 256);
        UtilityParameter p;
        p.phase_umkehren_l = true;
        u->setze(p);
        const Lauf a = durch(*u, dc, dc, 256);
        double schritt = std::fabs(a.l[0] - 0.5);
        for (std::size_t i = 1; i < a.l.size(); ++i) schritt = std::max(schritt, static_cast<double>(std::fabs(a.l[i] - a.l[i - 1])));
        std::printf("phase switch: largest step %.6f (bound %.6f)\n", schritt, 1.0 / kRampe + 1e-7);
        if (mutation) {
            PRUEF(schritt > 0.5);
            return pruef::ende();
        }
        PRUEF(schritt <= 1.0 / kRampe + 1e-7);
        // ramp timing: half way (zero) after 240 samples, -0.5 exactly at sample 479
        PRUEF_NAH(a.l[239], 0.0, 1e-6);
        PRUEF(a.l[kRampe - 1] == -0.5f);
        PRUEF(a.l[kRampe - 2] > -0.5f);
        PRUEF(a.r[0] == 0.5f);  // right untouched
    }

    // 2) Neutral = bit-identical, also after a round trip through other settings.
    {
        const auto xl = rauschen(20000, 1), xr = rauschen(20000, 2);
        auto u = std::make_unique<Utility>(kFs);
        Lauf a = durch(*u, xl, xr, 0);
        bool gleich = true;
        for (std::size_t i = 0; i < xl.size(); ++i) gleich = gleich && a.l[i] == xl[i] && a.r[i] == xr[i];
        PRUEF(gleich);
        UtilityParameter p;
        p.gain_db = 6.0f; p.breite_prozent = 150.0f; p.bass_mono_hz = 100.0f; p.dc_sperre = true; p.seiten_tauschen = true;
        u->setze(p);
        durch(*u, xl, xr, 0);
        u->setze(UtilityParameter{});
        durch(*u, xl, xr, 0);  // ramps back
        PRUEF(!u->faehrt());
        a = durch(*u, xl, xr, 0);
        gleich = true;
        for (std::size_t i = 0; i < xl.size(); ++i) gleich = gleich && a.l[i] == xl[i] && a.r[i] == xr[i];
        PRUEF(gleich);
    }

    // 3) Matrix values with DC inputs L = 0.3, R = 0.1 (M = 0.2, S = 0.1).
    {
        UtilityParameter p;
        auto pr = [](const Lauf& a, double l, double r, const char* was) {
            std::printf("%-22s L %.6f R %.6f (expected %.6f %.6f)\n", was, a.l.back(), a.r.back(), l, r);
            PRUEF_NAH(a.l.back(), l, 1e-6);
            PRUEF_NAH(a.r.back(), r, 1e-6);
        };
        p = {}; p.breite_prozent = 0.0f;   pr(dc_test(p, 0.3f, 0.1f), 0.2, 0.2, "width 0 % (mono)");
        p = {}; p.breite_prozent = 200.0f; pr(dc_test(p, 0.3f, 0.1f), 0.4, 0.0, "width 200 %");
        p = {}; p.breite_prozent = 50.0f;  pr(dc_test(p, 0.3f, 0.1f), 0.25, 0.15, "width 50 %");
        p = {}; p.balance = 0.5f;          pr(dc_test(p, 0.3f, 0.1f), 0.15, 0.1, "balance +0.5");
        p = {}; p.balance = -1.0f;         pr(dc_test(p, 0.3f, 0.1f), 0.3, 0.0, "balance -1");
        p = {}; p.gain_db = 6.0f;          pr(dc_test(p, 0.3f, 0.1f), 0.3 * std::pow(10.0, 0.3), 0.1 * std::pow(10.0, 0.3), "gain +6 dB");
        p = {}; p.gain_db = -200.0f;       pr(dc_test(p, 0.3f, 0.1f), 0.0, 0.0, "gain silent");
        p = {}; p.phase_umkehren_r = true; pr(dc_test(p, 0.3f, 0.1f), 0.3, -0.1, "phase R");
        p = {}; p.seiten_tauschen = true;  pr(dc_test(p, 0.3f, 0.1f), 0.1, 0.3, "swap");
        p = {}; p.seiten_tauschen = true; p.phase_umkehren_l = true;
        pr(dc_test(p, 0.3f, 0.1f), 0.1, -0.3, "phase L, then swap");
        p = {}; p.gain_db = -200.0f;
        const Lauf s = dc_test(p, 0.3f, 0.1f);
        PRUEF(s.l.back() == 0.0f && s.r.back() == 0.0f);
    }

    // 4) Levels in dB with a 1 kHz sine: gain -12 dB, balance +0.5 → L -6.0206 dB, width 200 % with L only:
    //    L = 1.5 x (+3.5218 dB), R = -0.5 x (-6.0206 dB).
    {
        const auto x = messen::sinus(1000.0, 0.25, 96000);
        const auto null = konstant(96000, 0.0f);
        UtilityParameter p;
        p.gain_db = -12.0f;
        auto u = std::make_unique<Utility>(kFs);
        u->setze(p);
        Lauf a = durch(*u, x, x, 256);
        PRUEF_NAH(pegel_db(a.l, x), -12.0, 1e-4);
        p = {}; p.balance = 0.5f;
        u->setze(p); u->leeren();
        a = durch(*u, x, x, 256);
        PRUEF_NAH(pegel_db(a.l, x), -6.0206, 1e-3);
        PRUEF_NAH(pegel_db(a.r, x), 0.0, 1e-4);
        p = {}; p.breite_prozent = 200.0f;
        u->setze(p); u->leeren();
        a = durch(*u, x, null, 256);
        std::printf("width 200 %%, L only: L %.4f dB, R %.4f dB (expected 3.5218, -6.0206)\n", pegel_db(a.l, x), pegel_db(a.r, x));
        PRUEF_NAH(pegel_db(a.l, x), 3.5218, 1e-3);
        PRUEF_NAH(pegel_db(a.r, x), -6.0206, 1e-3);
    }

    // 5) Bass mono at 120 Hz. Side signal (L = x, R = -x): L out = HP_LR8(x), |HP| = r^8 / (1 + r^8) with the
    //    prewarped ratio r. Mid signal (L = R = x): LP + HP = all-pass, 0 dB at every frequency.
    {
        const double fc = 120.0;
        UtilityParameter p;
        p.bass_mono_hz = static_cast<float>(fc);
        const double f[4] = {30.0, 60.0, 120.0, 1000.0};
        for (double fi : f) {
            const auto x = messen::sinus(fi, 0.5, 96000);
            std::vector<float> minus(x.size());
            for (std::size_t i = 0; i < x.size(); ++i) minus[i] = -x[i];
            auto u = std::make_unique<Utility>(kFs);
            u->setze(p);
            u->leeren();
            const Lauf seite = durch(*u, x, minus, 256);
            const double r8 = std::pow(r_bilinear(fi, fc), 8.0);
            const double soll = messen::db(r8 / (1.0 + r8));
            const double ist = pegel_db(seite.l, x);
            u->leeren();
            const Lauf mitte = durch(*u, x, x, 256);
            const double ist_m = pegel_db(mitte.l, x);
            std::printf("bass mono 120 Hz at %6.0f Hz: side %.4f dB (expected %.4f), mid %.5f dB (expected 0)\n", fi,
                        ist, soll, ist_m);
            PRUEF_NAH(ist, soll, 0.02);
            PRUEF_NAH(ist_m, 0.0, 1e-3);
            PRUEF_NAH(pegel_db(seite.r, x), soll, 0.02);
        }
    }

    // 6) DC blocker: DC 0.5 is removed (time constant 1 / (2π · 5 Hz) = 31.8 ms, after 2 s below 1e-6),
    //    sine levels follow |H| = |1 − e^{-jw}| / |1 − R e^{-jw}| with R = exp(−2π · 5 Hz / fs).
    {
        UtilityParameter p;
        p.dc_sperre = true;
        auto u = std::make_unique<Utility>(kFs);
        u->setze(p);
        u->leeren();
        const Lauf a = durch(*u, konstant(96000, 0.5f), konstant(96000, -0.25f), 256);
        std::printf("dc blocker: residual after 2 s L %.3g R %.3g\n", a.l.back(), a.r.back());
        PRUEF(std::fabs(a.l.back()) < 1e-6 && std::fabs(a.r.back()) < 1e-6);
        const double rr = std::exp(-2.0 * kPi * kUtilityDcHz / kFs);
        for (double fi : {5.0, 20.0, 1000.0}) {
            const std::complex<double> z = std::polar(1.0, -2.0 * kPi * fi / kFs);
            const double soll = messen::db(std::abs((1.0 - z) / (1.0 - rr * z)));
            const auto x = messen::sinus(fi, 0.5, 96000);
            u->leeren();
            const Lauf b = durch(*u, x, x, 256);
            const double ist = pegel_db(b.l, x);
            std::printf("dc blocker at %6.0f Hz: %.4f dB (expected %.4f)\n", fi, ist, soll);
            PRUEF_NAH(ist, soll, 0.01);
        }
    }

    // 7) Switching DC blocker and bass mono on and off is click-free: with L = DC 0.5 the DC blocker fades its
    //    filtered output (≈ 0) in over 480 samples, a step of about 0.5 / 480 per sample.
    {
        auto u = std::make_unique<Utility>(kFs);
        const auto dc = konstant(9600, 0.5f);
        durch(*u, dc, dc, 256);
        UtilityParameter p;
        p.dc_sperre = true;
        u->setze(p);
        Lauf a = durch(*u, dc, dc, 256);
        double schritt = std::fabs(a.l[0] - 0.5);
        for (std::size_t i = 1; i < a.l.size(); ++i) schritt = std::max(schritt, static_cast<double>(std::fabs(a.l[i] - a.l[i - 1])));
        std::printf("dc blocker on: largest step %.6f (bound %.6f)\n", schritt, 0.5 / kRampe + 1e-4);
        PRUEF(schritt <= 0.5 / kRampe + 1e-4);
        const auto x = messen::sinus(50.0, 0.5, 9600);
        auto v = std::make_unique<Utility>(kFs);
        durch(*v, x, konstant(9600, 0.0f), 256);
        p = {}; p.bass_mono_hz = 200.0f;
        v->setze(p);
        a = durch(*v, x, konstant(9600, 0.0f), 256);
        schritt = 0.0;
        for (std::size_t i = 1; i < a.l.size(); ++i) schritt = std::max(schritt, static_cast<double>(std::fabs(a.l[i] - a.l[i - 1])));
        const double sinus_schritt = 0.5 * 2.0 * kPi * 50.0 / kFs;  // largest step of the dry 50 Hz sine: 0.00327
        std::printf("bass mono on (50 Hz, L only): largest step %.6f (dry sine %.6f)\n", schritt, sinus_schritt);
        PRUEF(schritt <= sinus_schritt * 1.5);
    }

    // 8) Block size independence and latency 0.
    {
        UtilityParameter p;
        p.gain_db = 3.0f; p.breite_prozent = 130.0f; p.bass_mono_hz = 90.0f; p.dc_sperre = true; p.balance = -0.2f;
        const auto xl = rauschen(30000, 5), xr = rauschen(30000, 6);
        auto u1 = std::make_unique<Utility>(kFs);
        auto u2 = std::make_unique<Utility>(kFs);
        u1->setze(p);
        u2->setze(p);
        const Lauf a = durch(*u1, xl, xr, 256), b = durch(*u2, xl, xr, 0);
        bool gleich = true;
        for (std::size_t i = 0; i < xl.size(); ++i) gleich = gleich && a.l[i] == b.l[i] && a.r[i] == b.r[i];
        PRUEF(gleich);
        UtilityParameter q;
        q.gain_db = 6.0f;
        q.breite_prozent = 0.0f;
        auto u3 = std::make_unique<Utility>(kFs);
        u3->setze(q);
        u3->leeren();  // ramps at their target
        std::vector<float> imp(64, 0.0f);
        imp[0] = 1.0f;
        const Lauf c = durch(*u3, imp, konstant(64, 0.0f), 64);
        PRUEF_NAH(c.l[0], 0.5 * std::pow(10.0, 0.3), 1e-6);
        PRUEF_NAH(c.r[0], 0.5 * std::pow(10.0, 0.3), 1e-6);
        PRUEF(c.l[1] == 0.0f);
    }

    // 9) No denormals: 1 s noise, then 30 s silence with DC blocker and bass mono on.
    {
        UtilityParameter p;
        p.dc_sperre = true;
        p.bass_mono_hz = 80.0f;
        auto u = std::make_unique<Utility>(kFs);
        u->setze(p);
        const auto x = rauschen(48000, 9);
        durch(*u, x, x, 256);
        long denormal = 0;
        const auto still = konstant(48000, 0.0f);
        for (int s = 0; s < 30; ++s) {
            const Lauf a = durch(*u, still, still, 256);
            for (std::size_t i = 0; i < a.l.size(); ++i)
                denormal += (std::fpclassify(a.l[i]) == FP_SUBNORMAL) + (std::fpclassify(a.r[i]) == FP_SUBNORMAL);
        }
        PRUEF(denormal == 0);
    }

    // 10) Parameters: NaN keeps, out of range clamps; bass mono below 20 Hz (but > 0) clamps to 20.
    {
        Utility u(kFs);
        UtilityParameter p;
        p.gain_db = std::nanf("");
        p.breite_prozent = 500.0f;   // above 400 %
        p.balance = -3.0f;
        p.bass_mono_hz = 5.0f;
        u.setze(p);
        PRUEF(u.parameter().gain_db == 0.0f);
        PRUEF(u.parameter().breite_prozent == 400.0f);   // arr-fx: the limit is 400 % (was 200 %)
        PRUEF(u.parameter().balance == -1.0f);
        PRUEF(u.parameter().bass_mono_hz == 20.0f);
    }
    return pruef::ende();
}
