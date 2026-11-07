// Hardening: colorfx.h / colorfx.cpp (SOUND COLOR FX: SPACE, DUB ECHO, SWEEP, NOISE, CRUSH). Fixed seed.
//   1. Fuzz: every art, param in {0, 0.5, 1, NaN, -1, 2}, samples per beat in {-1, 1000, 24000, 1e6}, k random per
//      sample / random walk / stops / flips, full-scale noise, 44.1 / 48 / 96 kHz: finite and bounded.
//   2. Stability at the feedback limit: DUB ECHO and SPACE at param 1, 2 s full-scale input, then silence: the tail
//      decays (below -60 dB of the input peak after 10 s).
//   3. Dead zone: |k| < 0.05 and no tail running gives the input bit-exactly; after the tail has run out the output
//      is bit-exactly dry again and faehrt() is false.
//   4. Segmentation independence while the knob stays out of the dead zone: blocks of 1, 7, 64, kMaxFrames are
//      bit-identical.
//   5. Denormals: under DenormalSchutz, 30 s silence after loud input (knob held, or back to centre) give no
//      subnormal output.
//   6. Parameter jumps while active: no click, i.e. the HF peak (> 5 kHz, metric of tests/knack.py) around the jump
//      stays below the 16-bit step (-96.3 dBFS) or at most 6 dB above the HF peak before it. Asserted for DUB ECHO
//      PARAMETER 0 -> 1 and SPACE beat length halved; DUB ECHO beat change printed only (see pruefe_sprung).
//   Former bugs (fixed, now normal ctest entries, see BERICHT-haertung.md and BERICHT-fixes.md):
//   befund_colorfx_bloecke  segmentation dependence when the knob crosses the dead zone (breaks the bit-identity of
//                           split Kanalzug calls).
//   befund_colorfx_leeren   leeren() does not restore a fresh state (NOISE generator, last side `seite_`).
//   befund_colorfx_parameter SPACE: a PARAMETER change jumps the feedback gains of the FDN at once (click).
//
// Mutation check (automatic, test_haertung_colorfx_mutation_rueckkopplung): colorfx.cpp is copied with the DUB ECHO
// feedback 0.35 + 0.55·p replaced by 0.35 + 0.75·p (loop gain 1.1 at param 1). Checks 1 and 2 are PRUEF_M and fail
// (verified 2026-11-02: fuzz peak 77.5 instead of 5.0, tail +646 dB instead of -150 dB after 10 s).
#include <cypherdj/dsp/colorfx.h>
#include <cypherdj/dsp/denormal.h>

#include <cstdio>
#include <memory>
#include <vector>

#include "haertung.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

const char* kArtName[6] = {"filter", "space", "dub_echo", "sweep", "noise", "crush"};

struct Stereo {
    std::vector<float> l, r;
};

Stereo lauf(ColorFx& c, const std::vector<float>& x, const std::vector<double>& k, int block) {
    Stereo s{x, x};
    for (float& v : s.r) v = -v;  // R = -L: distinct channels
    for (std::size_t p = 0; p < x.size(); p += static_cast<std::size_t>(block)) {
        const int m = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), x.size() - p));
        c.verarbeite(&s.l[p], &s.r[p], m, &k[p]);
    }
    return s;
}

double abw(const Stereo& a, const Stereo& b) {
    return std::fmax(haertung::groesste_abweichung(a.l, b.l), haertung::groesste_abweichung(a.r, b.r));
}

std::vector<double> k_muster(int art, int n, Zufall& z) {
    std::vector<double> k(static_cast<std::size_t>(n));
    double w = 0.0;
    for (double& v : k) {
        switch (art) {
            case 0: v = z.zwischen(-1.0, 1.0); break;
            case 1: w = std::clamp(w + z.zwischen(-0.003, 0.003), -1.0, 1.0); v = w; break;
            case 2: v = 1.0; break;
            case 3: v = -1.0; break;
            default: if (w == 0.0 || z.gleich() < 0.001) w = w > 0.0 ? -1.0 : 1.0; v = w; break;  // flips
        }
    }
    return k;
}

// Knob held out of the dead zone on one side: random walk in [0.2, 1] times `seite`.
std::vector<double> k_aktiv(int n, double seite, Zufall& z) {
    std::vector<double> k(static_cast<std::size_t>(n));
    double w = 0.6;
    for (double& v : k) { w = std::clamp(w + z.zwischen(-0.01, 0.01), 0.2, 1.0); v = seite * w; }
    return k;
}

void pruefe_fuzz() {
    const int n = 24000;
    const std::vector<float> x = haertung::rauschen(n, 1.0, 141);
    Zufall z(142);
    bool ok = true;
    double groesste[6] = {};
    for (double fs : haertung::kRaten)
        for (int art = 1; art <= kColorArtMax; ++art)
            for (float p : {0.0f, 0.5f, 1.0f, NAN, -1.0f, 2.0f})
                for (double spb : {-1.0, 1000.0, 24000.0, 1e6})
                    for (int muster = 0; muster < 5; ++muster) {
                        if (art != 2 && spb != 24000.0) continue;  // the beat length only matters for DUB ECHO
                        auto c = std::make_unique<ColorFx>(fs);
                        c->setze(art, p, spb);
                        const Stereo s = lauf(*c, x, k_muster(muster, n, z), 256);
                        ok = ok && haertung::endlich(s.l) && haertung::endlich(s.r);
                        groesste[art] = std::fmax(groesste[art], std::fmax(haertung::spitze(s.l), haertung::spitze(s.r)));
                    }
    std::printf("fuzz: finite %d; peak per art (input 1.0):", ok);
    double m = 0.0;
    for (int a = 1; a <= kColorArtMax; ++a) { std::printf(" %s %.3g", kArtName[a], groesste[a]); m = std::fmax(m, groesste[a]); }
    std::printf("\n");
    PRUEF_M(ok);
    PRUEF_M(m < 50.0);
    ColorFx c;
    c.setze(9, 0.5f, 1.0);
    PRUEF(c.art() == ColorArt::filter);
    c.setze(-1, 0.5f, 1.0);
    PRUEF(c.art() == ColorArt::filter);
}

void pruefe_stabilitaet() {
    double schlimmste = -400.0;
    for (double fs : haertung::kRaten)
        for (int art : {1, 2})
            for (double seite : {-1.0, 1.0})
                for (double spb : {640.0, 2000.0}) {  // short echo: 1000+ repetitions in 10 s, decay visible
                    auto c = std::make_unique<ColorFx>(fs);
                    c->setze(art, 1.0f, spb);
                    const int ein = static_cast<int>(2 * fs), ges = static_cast<int>(12 * fs);
                    std::vector<float> x = haertung::rauschen(ein, 1.0, 151);
                    x.resize(static_cast<std::size_t>(ges), 0.0f);
                    const std::vector<double> k(static_cast<std::size_t>(ges), seite);  // knob held: tail fed
                    const Stereo s = lauf(*c, x, k, kMaxFrames);
                    const double rest = std::fmax(haertung::spitze(s.l, static_cast<std::size_t>(ges - fs / 2)),
                                                  haertung::spitze(s.r, static_cast<std::size_t>(ges - fs / 2)));
                    schlimmste = std::fmax(schlimmste, haertung::db(rest));
                }
    std::printf("stability at param 1: worst tail level 10 s after the input stopped: %.1f dB\n", schlimmste);
    PRUEF_M(schlimmste < -60.0);
}

void pruefe_totzone_und_fahne() {
    const std::vector<float> x = haertung::rauschen(20000, 1.0, 161);
    Zufall z(162);
    std::vector<double> k(x.size());
    for (double& v : k) v = z.zwischen(-0.0499, 0.0499);
    double tot = 0.0, nach_fahne = 0.0;
    bool faehrt_aus = true;
    for (double fs : haertung::kRaten)
        for (int art = 1; art <= kColorArtMax; ++art) {
            auto c = std::make_unique<ColorFx>(fs);
            c->setze(art, 0.7f, 20000.0);
            const Stereo s = lauf(*c, x, k, 128);
            Stereo trocken{x, x};
            for (float& v : trocken.r) v = -v;
            tot = std::fmax(tot, abw(s, trocken));
            // knob out for 0.5 s, back to centre: after the tail dry again. SPACE: 1.2 * T60 = 4.8 s at param 1;
            // DUB ECHO: (88 + 1) repetitions x 0.75 beat = 2.8 s with 2000 samples per beat.
            const int n = static_cast<int>(8 * fs);
            std::vector<float> y = haertung::rauschen(n, 0.5, 163);
            std::vector<double> kk(static_cast<std::size_t>(n), 0.0);
            for (int i = 0; i < static_cast<int>(fs / 2); ++i) kk[static_cast<std::size_t>(i)] = -0.8;
            auto d = std::make_unique<ColorFx>(fs);
            d->setze(art, 1.0f, 2000.0);
            const Stereo t = lauf(*d, y, kk, 256);
            faehrt_aus = faehrt_aus && !d->faehrt();
            const std::size_t ab = static_cast<std::size_t>(6 * fs);
            for (std::size_t i = ab; i < y.size(); ++i)
                nach_fahne = std::fmax(nach_fahne, std::fmax(std::fabs(t.l[i] - y[i]), std::fabs(t.r[i] + y[i])));
        }
    std::printf("dead zone: deviation from dry %.3g; after the tail: %.3g, tail stopped %d\n", tot, nach_fahne, faehrt_aus);
    PRUEF(tot == 0.0);
    PRUEF(nach_fahne == 0.0);
    PRUEF(faehrt_aus);
}

void pruefe_bloecke_aktiv() {
    const int n = 30000;
    const std::vector<float> x = haertung::rauschen(n, 1.0, 171);
    Zufall z(172);
    double m = 0.0;
    for (double fs : haertung::kRaten)
        for (int art = 1; art <= kColorArtMax; ++art)
            for (double seite : {-1.0, 1.0}) {
                const std::vector<double> k = k_aktiv(n, seite, z);
                auto a = std::make_unique<ColorFx>(fs);
                a->setze(art, 0.6f, 9000.0);
                const Stereo ref = lauf(*a, x, k, 1);
                for (int b : {7, 64, kMaxFrames}) {
                    auto c = std::make_unique<ColorFx>(fs);
                    c->setze(art, 0.6f, 9000.0);
                    m = std::fmax(m, abw(ref, lauf(*c, x, k, b)));
                }
            }
    std::printf("block sizes 1/7/64/%d, knob out of the dead zone: max deviation %.3g\n", kMaxFrames, m);
    PRUEF(m == 0.0);
}

// Knob sweeps slowly from -1 through the centre to +1 and back (as a DJ does).
std::vector<double> k_durch_mitte(int n) {
    std::vector<double> k(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) k[static_cast<std::size_t>(i)] = std::sin(2.0 * 3.14159265358979323846 * i / n * 1.5);
    return k;
}

void befund_bloecke() {
    const int n = 96000;
    const std::vector<float> x = haertung::rauschen(n, 0.5, 181);
    const std::vector<double> k = k_durch_mitte(n);
    double m = 0.0;
    for (int art = 1; art <= kColorArtMax; ++art) {
        double ma = 0.0;
        auto a = std::make_unique<ColorFx>(48000.0);
        a->setze(art, 0.6f, 9000.0);
        const Stereo ref = lauf(*a, x, k, 1);
        for (int b : {7, 64, kMaxFrames}) {
            auto c = std::make_unique<ColorFx>(48000.0);
            c->setze(art, 0.6f, 9000.0);
            ma = std::fmax(ma, abw(ref, lauf(*c, x, k, b)));
        }
        std::printf("  %s: block 1 vs 7/64/%d, knob through the centre: max deviation %.3g (%.1f dBFS)\n", kArtName[art],
                    kMaxFrames, ma, haertung::db(ma));
        m = std::fmax(m, ma);
    }
    PRUEF(m <= 1e-6);
}

void befund_leeren() {
    const int n = 20000;
    const std::vector<float> laut = haertung::rauschen(n, 1.0, 191), x = haertung::rauschen(n, 0.5, 192);
    Zufall z(193);
    // Knob first in the dead zone, then out to the left (fresh object: seite_ = -1 from construction).
    std::vector<double> k(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) k[static_cast<std::size_t>(i)] = -std::min(1.0, i / 2000.0);
    for (int art = 1; art <= kColorArtMax; ++art) {
        auto frisch = std::make_unique<ColorFx>(48000.0), benutzt = std::make_unique<ColorFx>(48000.0);
        frisch->setze(art, 0.6f, 9000.0);
        benutzt->setze(art, 0.6f, 9000.0);
        lauf(*benutzt, laut, k_aktiv(n, 1.0, z), 256);  // used on the right side
        benutzt->leeren();
        const double d = abw(lauf(*frisch, x, k, 256), lauf(*benutzt, x, k, 256));
        std::printf("  %s: leeren() vs fresh: max deviation %.3g (%.1f dBFS)\n", kArtName[art], d, haertung::db(d));
        PRUEF(d == 0.0);
    }
}

void pruefe_leeren_ohne_befund() {
    // leeren() for the arts without the former bug B2, knob on the same side as before (seite_ does not matter).
    const int n = 20000;
    const std::vector<float> laut = haertung::rauschen(n, 1.0, 195), x = haertung::rauschen(n, 0.5, 196);
    Zufall z(197);
    double m = 0.0;
    for (double fs : haertung::kRaten)
        for (int art : {1, 2, 3, 5}) {
            const std::vector<double> k = k_aktiv(n, 1.0, z);
            auto frisch = std::make_unique<ColorFx>(fs), benutzt = std::make_unique<ColorFx>(fs);
            frisch->setze(art, 0.6f, 9000.0);
            benutzt->setze(art, 0.6f, 9000.0);
            lauf(*benutzt, laut, k_aktiv(n, 1.0, z), 256);
            benutzt->leeren();
            m = std::fmax(m, abw(lauf(*frisch, x, k, 256), lauf(*benutzt, x, k, 256)));
        }
    std::printf("leeren vs fresh (SPACE, DUB ECHO, SWEEP, CRUSH; knob on the right): max deviation %.3g\n", m);
    PRUEF(m == 0.0);
}

void pruefe_denormal() {
    long sub = 0;
    for (double fs : haertung::kRaten)
        for (int art = 1; art <= kColorArtMax; ++art)
            for (double halten : {0.0, -0.7, 0.7}) {
                auto c = std::make_unique<ColorFx>(fs);
                c->setze(art, 0.8f, 12000.0);
                std::vector<float> l(kMaxFrames), r(kMaxFrames);
                std::vector<double> k(kMaxFrames, -0.9);
                DenormalSchutz schutz;
                for (int b = 0; b < static_cast<int>(fs / kMaxFrames); ++b) {
                    l = haertung::rauschen(kMaxFrames, 1.0, 200 + static_cast<std::uint64_t>(b));
                    r = l;
                    c->verarbeite(l.data(), r.data(), kMaxFrames, k.data());
                }
                std::fill(k.begin(), k.end(), halten);
                for (int b = 0; b < static_cast<int>(30 * fs / kMaxFrames); ++b) {
                    std::fill(l.begin(), l.end(), 0.0f);
                    std::fill(r.begin(), r.end(), 0.0f);
                    c->verarbeite(l.data(), r.data(), kMaxFrames, k.data());
                    sub += haertung::subnormale(l.data(), kMaxFrames) + haertung::subnormale(r.data(), kMaxFrames);
                }
            }
    std::printf("denormal: subnormal output samples over 30 s silence: %ld\n", sub);
#if defined(__x86_64__) || defined(__i386__)
    PRUEF(sub == 0);
#endif
}

struct Sprung {
    double um, vorher;  // HF peak (dBFS) around the jump and before it
};

// 780 Hz at -6 dBFS, knob held at `seite`, at 3 s: was 0 = PARAMETER von -> nach, was 1 = beat length halved.
Sprung sprung(double fs, int art, double seite, int was, float von = 0.0f, float nach = 1.0f) {
    const int n = static_cast<int>(4 * fs), t = static_cast<int>(3 * fs);
    const std::vector<float> x = haertung::sinus(haertung::kKnackReizHz, haertung::kKnackReizAmp, n, fs);
    const std::vector<double> k(static_cast<std::size_t>(n), seite);
    auto c = std::make_unique<ColorFx>(fs);
    c->setze(art, von, fs / 2);
    Stereo s{x, x};
    for (int p = 0; p < n;) {
        const int m = std::min({kMaxFrames, n - p, p < t ? t - p : kMaxFrames});
        if (p == t) {
            if (was == 0) c->setze(art, nach, fs / 2);
            else c->setze(art, von, fs / 4);
        }
        c->verarbeite(&s.l[static_cast<std::size_t>(p)], &s.r[static_cast<std::size_t>(p)], m, &k[static_cast<std::size_t>(p)]);
        p += m;
    }
    const std::size_t ti = static_cast<std::size_t>(t), w = static_cast<std::size_t>(0.05 * fs);
    return {haertung::knack_spitze_dbfs(s.l, fs, ti - w / 5, ti + w), haertung::knack_spitze_dbfs(s.l, fs, ti - 10 * w, ti - w)};
}

// A jump is click-free if its HF peak stays below the 16-bit step or at most 6 dB above the HF peak before it.
bool knackfrei(const Sprung& s) { return s.um < std::fmax(haertung::kKnackSchwelleDbfs, s.vorher + 6.0); }

void pruefe_sprung() {
    bool ok = true;
    for (double fs : haertung::kRaten)
        for (double seite : {-0.8, 0.8}) {
            const Sprung a = sprung(fs, 2, seite, 0), b = sprung(fs, 1, seite, 1), c = sprung(fs, 2, seite, 1);
            std::printf("  fs %.0f k %+.1f: DUB ECHO param 0->1 %.1f (before %.1f) dBFS, SPACE beat/2 %.1f (%.1f), "
                        "DUB ECHO beat/2 %.1f (%.1f, not asserted)\n", fs, seite, a.um, a.vorher, b.um, b.vorher, c.um, c.vorher);
            ok = ok && knackfrei(a) && knackfrei(b);
        }
    // DUB ECHO beat change: the one-pole glide of the delay (kEchoGleit_s) changes the read speed at once (pitch
    // jump of the echo, x3.3 at beat/2): a kink, not a step. Intended tape-like glide; kept as an observation.
    PRUEF(ok);
}

void befund_parameter() {
    bool ok = true;
    for (double fs : haertung::kRaten)
        for (double seite : {-0.8, 0.8})
            for (float von : {0.0f, 0.5f}) {
                const float nach = von == 0.0f ? 1.0f : 0.55f;
                const Sprung a = sprung(fs, 1, seite, 0, von, nach);
                std::printf("  SPACE fs %.0f k %+.1f param %.2f -> %.2f: HF peak %.1f dBFS around the jump, %.1f before\n",
                            fs, seite, von, nach, a.um, a.vorher);
                ok = ok && knackfrei(a);
            }
    PRUEF(ok);
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_fuzz();
        pruefe_stabilitaet();
        pruefe_totzone_und_fahne();
        pruefe_bloecke_aktiv();
        pruefe_leeren_ohne_befund();
        pruefe_denormal();
        pruefe_sprung();
    }
    if (haertung::befund_lauf("colorfx_bloecke")) befund_bloecke();
    if (haertung::befund_lauf("colorfx_leeren")) befund_leeren();
    if (haertung::befund_lauf("colorfx_parameter")) befund_parameter();
    return haertung::ende();
}
