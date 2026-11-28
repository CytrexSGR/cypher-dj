// Imager (strand 5, slice 3): flat LR4 sum, mono stays mono, clamp of the low width, mono high band, correlation-safe low band.
#include <cypherdj/dsp/imager.h>

#include <cmath>
#include <cstdio>
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

Lauf durch(Imager& im, const std::vector<float>& l, const std::vector<float>& r, int block = 256) {
    Lauf a{std::vector<float>(l.size()), std::vector<float>(l.size())};
    for (std::size_t p = 0; p < l.size(); p += static_cast<std::size_t>(block)) {
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), l.size() - p));
        im.verarbeite(&l[p], &r[p], &a.l[p], &a.r[p], n);
    }
    return a;
}

std::vector<float> sinus(std::size_t n, double f, double amp, double phase = 0.0) {
    std::vector<float> x(n);
    for (std::size_t i = 0; i < n; ++i) x[i] = static_cast<float>(amp * std::sin(2.0 * kPi * f * static_cast<double>(i) / kFs + phase));
    return x;
}

double rms(const std::vector<float>& x, std::size_t a, std::size_t b) {
    double s = 0.0;
    for (std::size_t i = a; i < b; ++i) s += static_cast<double>(x[i]) * x[i];
    return std::sqrt(s / static_cast<double>(b - a));
}

// Steady-state level of the side signal (L - R) / 2 relative to the input side signal, in dB.
double seite_db(Imager& im, double f) {
    const std::size_t n = 48000;
    const auto l = sinus(n, f, 0.25), r = sinus(n, f, 0.25, kPi);  // antiphase: all side
    const Lauf a = durch(im, l, r);
    std::vector<float> s(n);
    for (std::size_t i = 0; i < n; ++i) s[i] = 0.5f * (a.l[i] - a.r[i]);
    return messen::db(rms(s, 24000, 48000) / rms(l, 24000, 48000));
}

}  // namespace

int main() {
    // 1) all widths 1: magnitude flat (LR4 sum is an allpass), both channels
    {
        auto im = std::make_unique<Imager>(kFs);
        std::vector<float> imp(16384, 0.0f), nul(16384, 0.0f);
        imp[0] = 1.0f;
        const Lauf a = durch(*im, imp, imp);
        double lo = 1e9, hi = -1e9;
        for (double f : messen::log_frequenzen(30.0, 18000.0, 60)) {
            const double d = messen::betrag_db(a.l, f);
            lo = std::min(lo, d);
            hi = std::max(hi, d);
            PRUEF_NAH(messen::betrag_db(a.r, f), d, 1e-6);
        }
        std::printf("flat: %.4f .. %.4f dB\n", lo, hi);
        PRUEF_NAH(lo, 0.0, 0.05);
        PRUEF_NAH(hi, 0.0, 0.05);
    }
    // 2) mono input stays mono (exact), with non-neutral widths too
    {
        auto im = std::make_unique<Imager>(kFs);
        ImagerParameter p;
        p.breite_tief = 0.3f;
        p.breite_mitte = 2.0f;
        p.breite_hoch = 0.0f;
        p.mono_unter_hz = 90.0f;
        im->setze(p);
        im->leeren();
        std::vector<float> x(24000);
        unsigned s = 5;
        for (float& v : x) { s = s * 1664525u + 1013904223u; v = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5); }
        const Lauf a = durch(*im, x, x);
        double d = 0.0;
        for (std::size_t i = 0; i < x.size(); ++i) d = std::max(d, std::fabs(static_cast<double>(a.l[i]) - a.r[i]));
        PRUEF(d == 0.0);
    }
    // 3) breite_tief = 2 is clamped to 1: low band side unchanged
    {
        auto a = std::make_unique<Imager>(kFs), b = std::make_unique<Imager>(kFs);
        ImagerParameter p;
        p.breite_tief = 2.0f;
        a->setze(p);
        PRUEF_NAH(a->parameter().breite_tief, 1.0, 0.0);
        const double s_a = seite_db(*a, 60.0), s_b = seite_db(*b, 60.0);
        std::printf("low side: clamped %.4f dB, neutral %.4f dB\n", s_a, s_b);
        PRUEF_NAH(s_a, s_b, 1e-9);
        p.breite_tief = 0.0f;
        auto c = std::make_unique<Imager>(kFs);
        c->setze(p);
        PRUEF_KLEINER(seite_db(*c, 60.0), -25.0);  // narrowing works (what is left is the 60 Hz skirt in the mid band, -32 dB)
    }
    // 4) breite_hoch = 0: the band above 4 kHz is mono (side below -80 dB at 20 kHz; the mid band's own LR4 skirt there is -91 dB)
    {
        auto im = std::make_unique<Imager>(kFs);
        ImagerParameter p;
        p.breite_hoch = 0.0f;
        im->setze(p);
        const double s20 = seite_db(*im, 20000.0);
        auto im2 = std::make_unique<Imager>(kFs);
        im2->setze(p);
        const double s12 = seite_db(*im2, 12000.0);
        std::printf("side at 20 kHz %.1f dB, at 12 kHz %.1f dB\n", s20, s12);
        PRUEF_KLEINER(s20, -80.0);
        PRUEF_KLEINER(s12, -40.0);
        auto im3 = std::make_unique<Imager>(kFs);
        im3->setze(p);
        PRUEF_NAH(seite_db(*im3, 1000.0), 0.0, 0.05);  // mid band untouched
    }
    // 5) mono_unter 120: antiphase 60 Hz becomes fully correlated; without it the correlation is -1
    {
        const std::size_t n = 48000;
        const auto l = sinus(n, 60.0, 0.5), r = sinus(n, 60.0, 0.5, kPi);
        auto aus = std::make_unique<Imager>(kFs);
        durch(*aus, l, r);
        PRUEF_NAH(aus->korrelation_tief(), -1.0, 1e-3);
        auto an = std::make_unique<Imager>(kFs);
        ImagerParameter p;
        p.mono_unter_hz = 120.0f;
        an->setze(p);
        durch(*an, l, r);
        an->korrelation_tief();  // settle (ramp), discard
        const Lauf a = durch(*an, l, r);
        const float k = an->korrelation_tief();
        std::printf("correlation with mono_unter 120: %.6f, output rms L %.2e\n", static_cast<double>(k), rms(a.l, 24000, 48000));
        PRUEF_NAH(k, 1.0, 1e-3);
        PRUEF_KLEINER(rms(a.l, 24000, 48000), 0.1 * rms(l, 24000, 48000));  // the lows cancel in the mono sum; the rest is the 120 Hz LR4 skirt (-24 dB per octave)
    }
    // 6) correlation: silence reads 1, in-phase reads 1; crossover change does not click (largest step small)
    {
        auto im = std::make_unique<Imager>(kFs);
        PRUEF_NAH(im->korrelation_tief(), 1.0, 0.0);
        const auto x = sinus(48000, 440.0, 0.5);
        durch(*im, x, x);
        PRUEF_NAH(im->korrelation_tief(), 1.0, 1e-6);
        ImagerParameter p;
        p.grenze_tief_hz = 300.0f;
        p.grenze_hoch_hz = 2500.0f;
        im->setze(p);
        const Lauf a = durch(*im, x, x);
        double mx = 0.0;
        for (std::size_t i = 1; i < a.l.size(); ++i) mx = std::max(mx, std::fabs(static_cast<double>(a.l[i]) - a.l[i - 1]));
        PRUEF_KLEINER(mx, 0.5 * 2.0 * kPi * 440.0 / kFs * 1.5);  // within 1.5x the sine's own steepest step
    }
    // 7) bad input: NaN/Inf count as 0, no output NaN
    {
        auto im = std::make_unique<Imager>(kFs);
        std::vector<float> x(512, 0.1f);
        x[10] = NAN;
        x[20] = INFINITY;
        const Lauf a = durch(*im, x, x);
        bool ok = true;
        for (float v : a.l) ok = ok && std::isfinite(v);
        PRUEF(ok);
    }
    return pruef::ende();
}
