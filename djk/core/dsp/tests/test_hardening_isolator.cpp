// Hardening: isolator.h / isolator.cpp (LR8 three-band isolator). Property and fuzz checks, fixed seed.
//   1. Unity gains: the sum is an all-pass, |H| = 1 within 0.001 dB from 20 Hz to 0.45 fs, at 44.1 / 48 / 96 kHz
//      (the band corners stay 246 / 2484 Hz at every rate).
//   2. Bands sum to the output at unity gains (within float rounding, 1e-6 of full scale).
//   3. Fuzz: random per-sample gains in [0, 2] (EQ +6 dB max, kill 0), full-scale noise and square: finite, bounded.
//   4. Segmentation independence: blocks of 1, 7, 64, kMaxFrames give bit-identical outputs and bands;
//      in place (in == out) is bit-identical to out of place.
//   5. leeren(): after loud input, the output is bit-identical to a fresh isolator.
//   6. Denormals: under DenormalSchutz, 30 s of silence after loud input yield no subnormal output or band sample.
//
// Mutation check (automatic, test_haertung_isolator_mutation_hoch_ohne_abgleich): isolator.cpp is copied with the
// phase-alignment high-pass of the high band removed (h = b instead of hp_tief_hoch.schritt(b)). The all-pass
// check 1 is PRUEF_M and fails on that variant (verified 2026-11-02: deviation 0.31 dB instead of 4.8e-7 dB).
#include <cypherdj/dsp/denormal.h>
#include <cypherdj/dsp/isolator.h>

#include <complex>
#include <cstdio>
#include <memory>
#include <vector>

#include "hardening.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

constexpr double kPi = 3.14159265358979323846;

struct Ergebnis {
    std::vector<float> l, r, band[3];
};

// Runs x (L) and y (R) through `iso` in blocks of `block`; gains per sample from g (3 arrays) or 1.
Ergebnis lauf(Isolator& iso, const std::vector<float>& x, const std::vector<float>& y, int block,
              const std::vector<float>* g = nullptr, bool an_ort = false) {
    const std::size_t n = x.size();
    Ergebnis e{std::vector<float>(n), std::vector<float>(n), {std::vector<float>(n), std::vector<float>(n), std::vector<float>(n)}};
    std::vector<float> eins(kMaxFrames, 1.0f);
    if (an_ort) { e.l = x; e.r = y; }
    for (std::size_t p = 0; p < n; p += static_cast<std::size_t>(block)) {
        const int m = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), n - p));
        const float* gt = g ? &g[0][p] : eins.data();
        const float* gm = g ? &g[1][p] : eins.data();
        const float* gh = g ? &g[2][p] : eins.data();
        if (an_ort) iso.verarbeite(&e.l[p], &e.r[p], &e.l[p], &e.r[p], m, gt, gm, gh);
        else iso.verarbeite(&x[p], &y[p], &e.l[p], &e.r[p], m, gt, gm, gh);
        for (int b = 0; b < 3; ++b)
            std::copy(iso.band(static_cast<Band>(b), 0), iso.band(static_cast<Band>(b), 0) + m, &e.band[b][p]);
    }
    return e;
}

void pruefe_allpass() {
    double fehler_db = 0.0;
    for (double fs : haertung::kRaten) {
        auto iso = std::make_unique<Isolator>(fs);
        const int n = static_cast<int>(fs / 2);  // 0.5 s impulse response (LR8 at 246 Hz has decayed below 1e-12)
        std::vector<float> imp(static_cast<std::size_t>(n), 0.0f);
        imp[0] = 1.0f;
        const Ergebnis e = lauf(*iso, imp, imp, kMaxFrames);
        for (int j = 0; j <= 300; ++j) {
            const double f = 20.0 * std::pow(0.45 * fs / 20.0, j / 300.0);
            std::complex<double> s = 0.0, w = 1.0;
            const std::complex<double> dw = std::polar(1.0, -2.0 * kPi * f / fs);
            for (int i = 0; i < n; ++i) {
                s += static_cast<double>(e.l[static_cast<std::size_t>(i)]) * w;
                w *= dw;
            }
            fehler_db = std::fmax(fehler_db, std::fabs(haertung::db(std::abs(s))));
        }
    }
    std::printf("all-pass at unity gains: max |dB| = %.3g\n", fehler_db);
    PRUEF_M(fehler_db < 1e-3);
}

void pruefe_summe_und_fuzz() {
    const int n = 96000;
    Zufall z(51);
    std::vector<float> x = haertung::rauschen(n, 1.0, 52), y(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) y[static_cast<std::size_t>(i)] = ((i / 53) & 1) ? 1.0f : -1.0f;
    double summe_abw = 0.0, groesste = 0.0;
    bool ok = true;
    for (double fs : haertung::kRaten) {
        auto iso = std::make_unique<Isolator>(fs);
        const Ergebnis e = lauf(*iso, x, y, 256);
        for (int i = 0; i < n; ++i) {
            const std::size_t k = static_cast<std::size_t>(i);
            summe_abw = std::fmax(summe_abw, std::fabs(static_cast<double>(e.band[0][k]) + e.band[1][k] + e.band[2][k] - e.l[k]));
        }
        // random gains per sample: steps between [0, 2] every few samples (harsher than any ramp)
        std::vector<float> g[3];
        for (auto& v : g) {
            v.resize(static_cast<std::size_t>(n));
            float w = 1.0f;
            for (float& s : v) {
                if (z.gleich() < 0.01) w = static_cast<float>(z.gleich() < 0.2 ? (z.gleich() < 0.5 ? 0.0 : 1.9952623) : z.zwischen(0.0, 2.0));
                s = w;
            }
        }
        auto iso2 = std::make_unique<Isolator>(fs);
        const Ergebnis f = lauf(*iso2, x, y, 64, g);
        ok = ok && haertung::endlich(f.l) && haertung::endlich(f.r);
        groesste = std::fmax(groesste, std::fmax(haertung::spitze(f.l), haertung::spitze(f.r)));
    }
    std::printf("band sum vs output: max %.3g; fuzz gains: finite %d, peak %.4g\n", summe_abw, ok, groesste);
    PRUEF(summe_abw < 1e-6);
    PRUEF(ok);
    PRUEF(groesste < 8.0);  // 2 (gain) x LR8 overshoot on a square (< 4, test_haertung_biquad)
}

void pruefe_bloecke() {
    const int n = 20000;
    const std::vector<float> x = haertung::rauschen(n, 1.0, 61), y = haertung::rauschen(n, 0.7, 62);
    std::vector<float> g[3];
    Zufall z(63);
    for (auto& v : g) {
        v.resize(static_cast<std::size_t>(n));
        for (float& s : v) s = static_cast<float>(z.zwischen(0.0, 2.0));
    }
    double abw = 0.0;
    for (double fs : haertung::kRaten) {
        auto a = std::make_unique<Isolator>(fs);
        const Ergebnis ref = lauf(*a, x, y, 1, g);
        for (int b : {7, 64, kMaxFrames}) {
            for (bool an_ort : {false, true}) {
                auto c = std::make_unique<Isolator>(fs);
                const Ergebnis e = lauf(*c, x, y, b, g, an_ort);
                abw = std::fmax(abw, haertung::groesste_abweichung(ref.l, e.l));
                abw = std::fmax(abw, haertung::groesste_abweichung(ref.r, e.r));
                for (int k = 0; k < 3; ++k) abw = std::fmax(abw, haertung::groesste_abweichung(ref.band[k], e.band[k]));
            }
        }
    }
    std::printf("block sizes 1/7/64/%d, in place: max deviation %.3g\n", kMaxFrames, abw);
    PRUEF(abw == 0.0);
}

void pruefe_leeren() {
    const std::vector<float> laut = haertung::rauschen(30000, 1.0, 71), x = haertung::rauschen(9000, 0.5, 72);
    double abw = 0.0;
    for (double fs : haertung::kRaten) {
        auto frisch = std::make_unique<Isolator>(fs), benutzt = std::make_unique<Isolator>(fs);
        lauf(*benutzt, laut, laut, 512);
        benutzt->leeren();
        const Ergebnis a = lauf(*frisch, x, x, 333), b = lauf(*benutzt, x, x, 333);
        abw = std::fmax(abw, haertung::groesste_abweichung(a.l, b.l));
        for (int k = 0; k < 3; ++k) abw = std::fmax(abw, haertung::groesste_abweichung(a.band[k], b.band[k]));
    }
    std::printf("leeren vs fresh: max deviation %.3g\n", abw);
    PRUEF(abw == 0.0);
}

void pruefe_denormal() {
    long sub = 0;
    for (double fs : haertung::kRaten) {
        auto iso = std::make_unique<Isolator>(fs);
        const std::vector<float> laut = haertung::rauschen(static_cast<int>(fs / 2), 1.0, 81);
        std::vector<float> stille(kMaxFrames, 0.0f), l(kMaxFrames), r(kMaxFrames), g(kMaxFrames, 1.0f);
        DenormalSchutz schutz;
        for (std::size_t p = 0; p + kMaxFrames <= laut.size(); p += kMaxFrames)
            iso->verarbeite(&laut[p], &laut[p], l.data(), r.data(), kMaxFrames, g.data(), g.data(), g.data());
        for (int b = 0; b < static_cast<int>(30 * fs / kMaxFrames); ++b) {
            iso->verarbeite(stille.data(), stille.data(), l.data(), r.data(), kMaxFrames, g.data(), g.data(), g.data());
            sub += haertung::subnormale(l.data(), kMaxFrames) + haertung::subnormale(r.data(), kMaxFrames);
            for (int k = 0; k < 3; ++k)
                for (int c = 0; c < 2; ++c) sub += haertung::subnormale(iso->band(static_cast<Band>(k), c), kMaxFrames);
        }
    }
    std::printf("denormal: subnormal samples over 30 s silence (3 rates): %ld\n", sub);
#if defined(__x86_64__) || defined(__i386__)
    PRUEF(sub == 0);
#endif
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_allpass();
        pruefe_summe_und_fuzz();
        pruefe_bloecke();
        pruefe_leeren();
        pruefe_denormal();
    }
    return haertung::ende();
}
