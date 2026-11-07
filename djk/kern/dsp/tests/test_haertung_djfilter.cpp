// Hardening: djfilter.h / djfilter.cpp (DJ filter, TPT state-variable filters, Q as config value).
//   1. Fuzz: q in {0.5, 0.707, 4, NaN, -1, 100} (clamped / ignored), k random per sample, random walk, constant
//      +-1, full-scale noise, 44.1 / 48 / 96 kHz: finite and bounded.
//   2. k = 0 gives the input bit-exactly (contract), at every rate and q.
//   3. |H(fc)| = Q at the corner for k = -0.5 (low-pass) and k = +0.5 (high-pass), q 0.707 and 4, at every rate
//      (the corner frequencies do not depend on the sample rate).
//   4. Segmentation independence: blocks of 1, 7, 64, kMaxFrames are bit-identical with k varying per sample.
//   5. leeren(): bit-identical to a fresh filter afterwards, q is kept.
//   6. setze_guete() on a running filter acts like a fresh filter with that q (coefficient cache invalidated).
//   7. Denormals: under DenormalSchutz, 30 s silence after loud input give no subnormal output.
//   8. setze_guete() during playback: the output stays bounded; the click level is printed for the report.
// Found while writing this test: an out-of-bounds read of k in the test itself (k shorter than x) hid the cache
// mutation; AddressSanitizer (-DCYPHERDJ_DSP_SANITIZE=ON) is the guard against that class of test bug.
//
// Mutation checks (automatic): the test runs against the two existing mutation libraries of this file's module:
//   cypherdj_dsp_mut_guete_fest (q has no effect):          check 3 (PRUEF_M) fails, |H(fc)| stays 0.707.
//   cypherdj_dsp_mut_ohne_cache (setze_guete keeps cache):  check 6 (PRUEF_M) fails.
// Both verified 2026-11-02 (test_haertung_djfilter_mutation_guete_fest / _ohne_cache).
#include <cypherdj/dsp/denormal.h>
#include <cypherdj/dsp/djfilter.h>

#include <complex>
#include <cstdio>
#include <memory>
#include <vector>

#include "haertung.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

constexpr double kPi = 3.14159265358979323846;

std::vector<float> lauf(DjFilter& f, const std::vector<float>& x, const std::vector<double>& k, int block) {
    std::vector<float> l = x, r = x;
    for (std::size_t p = 0; p < x.size(); p += static_cast<std::size_t>(block)) {
        const int m = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), x.size() - p));
        f.verarbeite(&l[p], &r[p], m, &k[p]);
    }
    for (std::size_t i = 0; i < x.size(); ++i)
        if (l[i] != r[i]) l[i] = NAN;  // L and R carry the same input: they must stay identical
    return l;
}

std::vector<double> k_muster(int art, int n, Zufall& z) {
    std::vector<double> k(static_cast<std::size_t>(n));
    double w = 0.0;
    for (double& v : k) {
        switch (art) {
            case 0: v = z.zwischen(-1.0, 1.0); break;                                   // jump every sample
            case 1: w = std::clamp(w + z.zwischen(-0.01, 0.01), -1.0, 1.0); v = w; break;  // random walk
            case 2: v = 1.0; break;
            case 3: v = -1.0; break;
            default: v = (z.gleich() < 0.5) ? -1.0 : 1.0; break;                          // flip between the stops
        }
    }
    return k;
}

void pruefe_fuzz() {
    const int n = 48000;
    const std::vector<float> x = haertung::rauschen(n, 1.0, 91);
    Zufall z(92);
    bool ok = true;
    double groesste = 0.0;
    for (double fs : haertung::kRaten)
        for (double q : {0.5, 0.707, 4.0, static_cast<double>(NAN), -1.0, 100.0})
            for (int art = 0; art < 5; ++art) {
                auto f = std::make_unique<DjFilter>(fs);
                f->setze_guete(q);
                const std::vector<float> y = lauf(*f, x, k_muster(art, n, z), 256);
                ok = ok && haertung::endlich(y);
                groesste = std::fmax(groesste, haertung::spitze(y));
            }
    std::printf("fuzz: finite %d, peak %.4g (input 1.0)\n", ok, groesste);
    PRUEF(ok);
    PRUEF(groesste < 50.0);
    DjFilter f;
    f.setze_guete(NAN);
    PRUEF(f.guete() == kGueteVorgabe);
    f.setze_guete(-1.0);
    PRUEF(f.guete() == kGueteMin);
    f.setze_guete(100.0);
    PRUEF(f.guete() == kGueteMax);
}

void pruefe_mitte_trocken() {
    const std::vector<float> x = haertung::rauschen(20000, 1.0, 101);
    const std::vector<double> k(x.size(), 0.0);
    double abw = 0.0;
    for (double fs : haertung::kRaten)
        for (double q : {0.5, 0.707, 4.0}) {
            auto f = std::make_unique<DjFilter>(fs);
            f->setze_guete(q);
            abw = std::fmax(abw, haertung::groesste_abweichung(x, lauf(*f, x, k, 100)));
        }
    std::printf("k = 0: deviation from input %.3g\n", abw);
    PRUEF(abw == 0.0);
}

double betrag_bei(DjFilter& f, double k, double fhz, double fs) {
    const int n = static_cast<int>(fs / 2);
    std::vector<float> imp(static_cast<std::size_t>(n), 0.0f);
    imp[0] = 1.0f;
    const std::vector<float> h = lauf(f, imp, std::vector<double>(imp.size(), k), kMaxFrames);
    std::complex<double> s = 0.0, w = 1.0;
    const std::complex<double> dw = std::polar(1.0, -2.0 * kPi * fhz / fs);
    for (float v : h) { s += static_cast<double>(v) * w; w *= dw; }
    return std::abs(s);
}

void pruefe_eckfrequenz() {
    double abw_db = 0.0;
    for (double fs : haertung::kRaten)
        for (double q : {0.707, 4.0})
            for (double k : {-0.5, 0.5}) {
                const double fc = k < 0.0 ? 20000.0 * std::pow(60.0 / 20000.0, -k) : 20.0 * std::pow(8000.0 / 20.0, k);
                auto f = std::make_unique<DjFilter>(fs);
                f->setze_guete(q);
                const double ist = betrag_bei(*f, k, fc, fs);
                abw_db = std::fmax(abw_db, std::fabs(haertung::db(ist) - haertung::db(q)));
            }
    std::printf("|H(fc)| vs Q: max deviation %.3g dB\n", abw_db);
    PRUEF_M(abw_db < 0.01);
}

void pruefe_bloecke() {
    const int n = 30000;
    const std::vector<float> x = haertung::rauschen(n, 1.0, 111);
    Zufall z(112);
    double abw = 0.0;
    for (double fs : haertung::kRaten)
        for (int art : {0, 1, 4}) {
            const std::vector<double> k = k_muster(art, n, z);
            auto a = std::make_unique<DjFilter>(fs);
            a->setze_guete(2.0);
            const std::vector<float> ref = lauf(*a, x, k, 1);
            for (int b : {7, 64, kMaxFrames}) {
                auto c = std::make_unique<DjFilter>(fs);
                c->setze_guete(2.0);
                abw = std::fmax(abw, haertung::groesste_abweichung(ref, lauf(*c, x, k, b)));
            }
        }
    std::printf("block sizes 1/7/64/%d: max deviation %.3g\n", kMaxFrames, abw);
    PRUEF(abw == 0.0);
}

void pruefe_leeren_und_guete() {
    const std::vector<float> laut = haertung::rauschen(20000, 1.0, 121), x = haertung::rauschen(9000, 0.5, 122);
    Zufall z(123);
    const std::vector<double> k_laut = k_muster(1, 20000, z), k(9000, 0.5);
    double abw_leeren = 0.0, abw_guete = 0.0;
    bool guete_bleibt = true;
    for (double fs : haertung::kRaten) {
        // 5. leeren after loud input with moving k
        auto frisch = std::make_unique<DjFilter>(fs), benutzt = std::make_unique<DjFilter>(fs);
        frisch->setze_guete(3.0);
        benutzt->setze_guete(3.0);
        lauf(*benutzt, laut, k_laut, 256);
        benutzt->leeren();
        guete_bleibt = guete_bleibt && benutzt->guete() == 3.0;
        abw_leeren = std::fmax(abw_leeren, haertung::groesste_abweichung(lauf(*frisch, x, k, 256), lauf(*benutzt, x, k, 256)));
        // 6. setze_guete on a filter that has been running at the same k
        auto a = std::make_unique<DjFilter>(fs), b = std::make_unique<DjFilter>(fs);
        lauf(*a, laut, std::vector<double>(laut.size(), 0.5), 256);  // same k as below: the cache would hit
        a->setze_guete(4.0);
        a->leeren();
        b->setze_guete(4.0);
        abw_guete = std::fmax(abw_guete, haertung::groesste_abweichung(lauf(*a, x, k, 256), lauf(*b, x, k, 256)));
        const std::vector<double> km(9000, -0.5);
        auto a2 = std::make_unique<DjFilter>(fs), b2 = std::make_unique<DjFilter>(fs);
        lauf(*a2, laut, std::vector<double>(laut.size(), -0.5), 256);
        a2->setze_guete(0.5);
        a2->leeren();
        b2->setze_guete(0.5);
        abw_guete = std::fmax(abw_guete, haertung::groesste_abweichung(lauf(*a2, x, km, 256), lauf(*b2, x, km, 256)));
    }
    std::printf("leeren vs fresh: %.3g (q kept %d); setze_guete on a running filter vs fresh: %.3g\n", abw_leeren,
                guete_bleibt, abw_guete);
    PRUEF(abw_leeren == 0.0);
    PRUEF(guete_bleibt);
    PRUEF_M(abw_guete == 0.0);
}

void pruefe_denormal() {
    long sub = 0;
    for (double fs : haertung::kRaten)
        for (double kk : {-0.5, 0.5, -1.0, 1.0}) {
            auto f = std::make_unique<DjFilter>(fs);
            f->setze_guete(4.0);
            std::vector<float> l = haertung::rauschen(kMaxFrames, 1.0, 131), r = l;
            const std::vector<double> k(kMaxFrames, kk);
            DenormalSchutz schutz;
            for (int b = 0; b < 20; ++b) f->verarbeite(l.data(), r.data(), kMaxFrames, k.data());
            for (int b = 0; b < static_cast<int>(30 * fs / kMaxFrames); ++b) {
                std::fill(l.begin(), l.end(), 0.0f);
                std::fill(r.begin(), r.end(), 0.0f);
                f->verarbeite(l.data(), r.data(), kMaxFrames, k.data());
                sub += haertung::subnormale(l.data(), kMaxFrames) + haertung::subnormale(r.data(), kMaxFrames);
            }
        }
    std::printf("denormal: subnormal output samples over 30 s silence: %ld\n", sub);
#if defined(__x86_64__) || defined(__i386__)
    PRUEF(sub == 0);
#endif
}

void pruefe_guete_waehrend_spiel() {
    // 780 Hz at -6 dBFS through the high-pass side at k = 0.5 (fc 400 Hz), q changes 0.707 -> 4 at 1 s.
    double knack = -400.0, vor = 0.0, nach = 0.0, danach_ruhig = 0.0;
    for (double fs : haertung::kRaten) {
        const int n = static_cast<int>(2 * fs), t = static_cast<int>(fs);
        const std::vector<float> x = haertung::sinus(haertung::kKnackReizHz, haertung::kKnackReizAmp, n, fs);
        const std::vector<double> k(static_cast<std::size_t>(n), 0.5);
        auto f = std::make_unique<DjFilter>(fs);
        std::vector<float> l = x, r = x;
        f->verarbeite(l.data(), r.data(), t, k.data());
        f->setze_guete(4.0);
        for (int p = t; p < n; p += kMaxFrames) f->verarbeite(&l[static_cast<std::size_t>(p)], &r[static_cast<std::size_t>(p)], std::min(kMaxFrames, n - p), k.data());
        const std::size_t ti = static_cast<std::size_t>(t), w = static_cast<std::size_t>(0.05 * fs);
        knack = std::fmax(knack, haertung::knack_spitze_dbfs(l, fs, ti - w, ti + w));
        vor = std::fmax(vor, haertung::spitze(l, ti - w, ti));
        nach = std::fmax(nach, haertung::spitze(l, ti, ti + w));
        danach_ruhig = std::fmax(danach_ruhig, haertung::spitze(l, ti + 10 * w, ti + 15 * w));
    }
    std::printf("setze_guete 0.707 -> 4 while playing: click %.1f dBFS (16-bit step %.1f), peak before %.3f, "
                "around %.3f, settled %.3f\n", knack, haertung::kKnackSchwelleDbfs, vor, nach, danach_ruhig);
    // A config change during playback is not a ramped control (kern.toml, read at start): no click threshold. The
    // resonance at 400 Hz is excited by the step (measured 2026-11-02: peak 0.771 against 0.670 settled, click
    // -19.7 dBFS); checked is only that it stays bounded (below 1.5 x the new steady state).
    PRUEF(nach <= 1.5 * danach_ruhig);
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_fuzz();
        pruefe_mitte_trocken();
        pruefe_eckfrequenz();
        pruefe_bloecke();
        pruefe_leeren_und_guete();
        pruefe_denormal();
        pruefe_guete_waehrend_spiel();
    }
    return haertung::ende();
}
