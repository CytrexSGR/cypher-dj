// Hardening: messer/master_limiter.h / .cpp (look-ahead true-peak limiter). Fixed seed. The limiter is defined for
// 48 kHz only (interpolator (b) and the grid reserve are computed for 48 kHz, abklingen_ms is converted with 48000);
// the sample-rate checks of the other modules do not apply here.
//   1. Fuzz: settings over their range and beyond (anstieg 0..2000, halten -5..600, decke -20..0 dBTP, abklingen
//      1..1000 ms), input from -40 to +40 dBFS with NaN, +-inf, 1e9 and subnormals sprinkled in: output finite and
//      every sample <= the ceiling (sample peak; the true peak is test_master_limiter's job).
//   2. Delay: vorhalt_samples() == anstieg + halten + 12 for valid settings; an impulse below the ceiling comes out
//      unchanged exactly vorhalt_samples() later. Out-of-range settings fall back as documented.
//   3. Transparent below the ceiling: quiet input comes out bit-identical (delayed); after a loud burst the gain
//      returns to exactly 1 and the output is bit-identical to the delayed input again.
//   4. Segmentation independence: blocks of 1, 7, 64, kMaxFrames and 4096 are bit-identical.
//   5. zuruecksetzen(): after loud input bit-identical to a fresh limiter; groesste_absenkung_db() resets to 0.
//   6. Denormals: silence after loud input gives exact zeros, no subnormal output.
//   7. No clicks: the gain moves by at most 1 / (anstieg + 1) per sample (moving average), also at level jumps
//      from -20 to +6 dBFS and back.
//   Former bugs (fixed, now normal ctest entries, see BERICHT-haertung.md and BERICHT-fixes.md):
//   befund_limiter_einstellung (B5)  abklingen_ms < 0 or NaN and decke_dbtp NaN are not validated (anstieg and
//                                    halten are): the output blows up, or nothing is limited.
//   befund_limiter_riesig (B6)       a finite input sample far above full scale breaks the ceiling (from about +230 dBFS
//                                    with anstieg 1000, +360 dBFS with the defaults): the running sum of the moving
//                                    average cancels, the gain comes out wrong and even negative.
//
// Mutation check (automatic, test_haertung_master_limiter_mutation_ohne_mittel): master_limiter.cpp is copied with the
// moving average removed (the gain is h_rel_ directly). The gain-step check 7 is PRUEF_M and fails (verified
// 2026-11-02: gain step 0.60 per sample at every anstieg instead of <= 1 / (anstieg + 1)).
#include <cypherdj/dsp/master_limiter.h>
#include <cypherdj/dsp/werte.h>

#include <cstdio>
#include <limits>
#include <memory>
#include <vector>

#include "haertung.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

void lauf(MasterLimiter& m, std::vector<float>& l, std::vector<float>& r, int block) {
    for (std::size_t p = 0; p < l.size(); p += static_cast<std::size_t>(block)) {
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), l.size() - p));
        m.verarbeite(&l[p], &r[p], n);
    }
}

float decke_lin(float dbtp) { return static_cast<float>(std::pow(10.0, dbtp / 20.0)); }

void pruefe_fuzz() {
    Zufall z(501);
    bool endlich = true;
    double ueber_db = -400.0;  // largest output sample relative to the ceiling
    int faelle = 0;
    for (int f = 0; f < 60; ++f) {
        LimiterEinstellung e;
        e.anstieg = f < 4 ? (f & 1 ? 1 : 1000) : z.ganz(0, 2000);
        e.halten = f < 4 ? (f & 2 ? 0 : 11) : z.ganz(-5, 600);
        e.decke_dbtp = f < 4 ? (f & 1 ? 0.0f : -20.0f) : static_cast<float>(z.zwischen(-20.0, 0.0));
        e.abklingen_ms = static_cast<float>(f < 4 ? (f & 2 ? 1.0 : 1000.0) : std::exp(z.zwischen(0.0, std::log(1000.0))));
        auto m = std::make_unique<MasterLimiter>(e);
        const int n = 48000;
        std::vector<float> l(static_cast<std::size_t>(n)), r(static_cast<std::size_t>(n));
        double pegel = z.zwischen(0.01, 100.0);
        for (int i = 0; i < n; ++i) {
            if (z.gleich() < 0.002) pegel = std::pow(10.0, z.zwischen(-40.0, 40.0) / 20.0);
            float a = static_cast<float>(z.zwischen(-pegel, pegel)), b = static_cast<float>(z.zwischen(-pegel, pegel));
            const double w = z.gleich();
            if (w < 0.0005) a = std::numeric_limits<float>::quiet_NaN();
            else if (w < 0.0010) b = std::numeric_limits<float>::infinity();
            else if (w < 0.0015) a = -std::numeric_limits<float>::infinity();
            else if (w < 0.0020) b = 1e9f;  // +180 dBFS; larger values: befund_limiter_riesig  // +240 dBFS; larger values: befund_limiter_riesig
            else if (w < 0.0030) a = 1e-40f;
            l[static_cast<std::size_t>(i)] = a;
            r[static_cast<std::size_t>(i)] = b;
        }
        lauf(*m, l, r, z.ganz(1, 4096));
        endlich = endlich && haertung::endlich(l) && haertung::endlich(r);
        const double s = std::fmax(haertung::spitze(l), haertung::spitze(r));
        if (haertung::db(s) > e.decke_dbtp)
            std::printf("  over the ceiling: anstieg %d halten %d decke %.2f abklingen %.1f: %+.3f dB\n", e.anstieg, e.halten,
                        static_cast<double>(e.decke_dbtp), static_cast<double>(e.abklingen_ms), haertung::db(s) - e.decke_dbtp);
        ueber_db = std::fmax(ueber_db, haertung::db(s) - e.decke_dbtp);
        ++faelle;
    }
    std::printf("fuzz: %d settings, output finite %d, largest sample %.3f dB relative to the ceiling\n", faelle, endlich, ueber_db);
    PRUEF(endlich);
    PRUEF(ueber_db <= 0.0);
}

void pruefe_verzug() {
    bool ok = true;
    for (auto [anstieg, halten] : {std::pair{64, 8}, {1, 0}, {1000, 11}, {200, 100}}) {
        LimiterEinstellung e;
        e.anstieg = anstieg;
        e.halten = halten;
        MasterLimiter m(e);
        const int v = m.vorhalt_samples();
        ok = ok && v == anstieg + halten + MasterLimiter::kInterpVerzug;
        std::vector<float> l(4096, 0.0f), r(4096, 0.0f);
        l[100] = 0.5f;
        r[100] = -0.25f;
        lauf(m, l, r, 333);
        for (int i = 0; i < 4096; ++i) {
            const bool hier = i == 100 + v;
            ok = ok && l[static_cast<std::size_t>(i)] == (hier ? 0.5f : 0.0f) && r[static_cast<std::size_t>(i)] == (hier ? -0.25f : 0.0f);
        }
    }
    for (auto [anstieg, halten, a_soll, h_soll] : {std::tuple{0, -5, 1, 0}, {2000, 8, 64, 8}, {64, 600, 64, 8}}) {
        LimiterEinstellung e;
        e.anstieg = anstieg;
        e.halten = halten;
        MasterLimiter m(e);
        ok = ok && m.vorhalt_samples() == a_soll + h_soll + MasterLimiter::kInterpVerzug;
    }
    std::printf("delay equals vorhalt_samples(), fallbacks: %d\n", ok);
    PRUEF(ok);
}

void pruefe_transparenz() {
    MasterLimiter m;
    const int v = m.vorhalt_samples();
    const int n = 48000 * 5;
    std::vector<float> x = haertung::rauschen(n, 0.2, 511);              // about -14 dBFS peak, true peak far below -1
    for (int i = 48000; i < 48000 + 4800; ++i) x[static_cast<std::size_t>(i)] *= 10.0f;  // 100 ms burst at +6 dBFS
    std::vector<float> l = x, r = x;
    for (float& s : r) s = -s;
    lauf(m, l, r, 512);
    bool vorher = true, nachher = true;
    for (int i = v; i < 48000; ++i) vorher = vorher && l[static_cast<std::size_t>(i)] == x[static_cast<std::size_t>(i - v)];
    for (int i = 48000 * 3; i < n; ++i)
        nachher = nachher && l[static_cast<std::size_t>(i)] == x[static_cast<std::size_t>(i - v)] && r[static_cast<std::size_t>(i)] == -x[static_cast<std::size_t>(i - v)];
    const float absenkung = m.groesste_absenkung_db();
    std::printf("transparent before the burst %d, bit-identical again 2 s after it %d, burst reduction %.2f dB\n", vorher,
                nachher, absenkung);
    PRUEF(vorher && nachher);
    PRUEF(absenkung < -6.0f);
    PRUEF(m.groesste_absenkung_db() == 0.0f);
}

void pruefe_bloecke() {
    double abw = 0.0;
    for (int f = 0; f < 3; ++f) {
        std::vector<float> x = haertung::rauschen(48000, 3.0, 521 + static_cast<std::uint64_t>(f)), y = haertung::rauschen(48000, 0.5, 531);
        LimiterEinstellung e;
        e.anstieg = 32 + 100 * f;
        MasterLimiter a(e);
        std::vector<float> ref_l = x, ref_r = y;
        lauf(a, ref_l, ref_r, 1);
        for (int b : {7, 64, kMaxFrames, 4096}) {
            MasterLimiter c(e);
            std::vector<float> l = x, r = y;
            lauf(c, l, r, b);
            abw = std::fmax(abw, std::fmax(haertung::groesste_abweichung(ref_l, l), haertung::groesste_abweichung(ref_r, r)));
        }
    }
    std::printf("block sizes 1/7/64/%d/4096: max deviation %.3g\n", kMaxFrames, abw);
    PRUEF(abw == 0.0);
}

void pruefe_zuruecksetzen() {
    auto frisch = std::make_unique<MasterLimiter>(), benutzt = std::make_unique<MasterLimiter>();
    std::vector<float> laut = haertung::rauschen(30000, 8.0, 541), laut_r = laut;
    lauf(*benutzt, laut, laut_r, 1000);
    benutzt->zuruecksetzen();
    PRUEF(benutzt->groesste_absenkung_db() == 0.0f);
    const std::vector<float> x = haertung::rauschen(20000, 2.0, 542);
    std::vector<float> a = x, ar = x, b = x, br = x;
    lauf(*frisch, a, ar, 256);
    lauf(*benutzt, b, br, 256);
    const double d = haertung::groesste_abweichung(a, b);
    std::printf("zuruecksetzen vs fresh: max deviation %.3g\n", d);
    PRUEF(d == 0.0);
}

void pruefe_denormal() {
    MasterLimiter m;
    std::vector<float> l = haertung::rauschen(48000, 4.0, 551);
    l.resize(48000 * 31, 0.0f);
    std::vector<float> r = l;
    lauf(m, l, r, kMaxFrames);
    long sub = haertung::subnormale(l.data(), l.size()) + haertung::subnormale(r.data(), r.size());
    bool null = true;
    for (std::size_t i = 48000 + static_cast<std::size_t>(m.vorhalt_samples()); i < l.size(); ++i) null = null && l[i] == 0.0f && r[i] == 0.0f;
    std::printf("denormal: subnormal output samples %ld, exact zeros after the input stopped %d\n", sub, null);
    PRUEF(sub == 0);
    PRUEF(null);
}

void pruefe_verstaerkung() {
    double groesster = 0.0, grenze = 1.0;
    for (int anstieg : {1, 16, 64, 500}) {
        LimiterEinstellung e;
        e.anstieg = anstieg;
        MasterLimiter m(e);
        const int v = m.vorhalt_samples();
        // DC level jumps -20 dBFS -> +6 dBFS -> -20 dBFS -> +20 dBFS: the gain is out / delayed input
        std::vector<float> x(48000 * 2);
        for (std::size_t i = 0; i < x.size(); ++i) {
            const std::size_t s = i / 12000;
            x[i] = s == 0 ? 0.1f : s == 1 ? 2.0f : s == 2 ? 0.1f : s == 3 ? 10.0f : s == 4 ? 0.1f : 1.5f;
        }
        std::vector<float> l = x, r = x;
        lauf(m, l, r, 777);
        double alt = 1.0;
        double schritt = 0.0;
        for (std::size_t i = static_cast<std::size_t>(v); i < x.size(); ++i) {
            const double g = static_cast<double>(l[i]) / x[i - static_cast<std::size_t>(v)];
            schritt = std::fmax(schritt, std::fabs(g - alt));
            alt = g;
        }
        groesster = std::fmax(groesster, schritt * (anstieg + 1));
        std::printf("  anstieg %d: largest gain step %.5f (bound 1/%d = %.5f)\n", anstieg, schritt, anstieg + 1, 1.0 / (anstieg + 1));
    }
    std::printf("gain step times (anstieg + 1): worst %.4f (bound %.1f)\n", groesster, grenze);
    PRUEF_M(groesster <= grenze + 1e-4);
}

void befund_einstellung() {
    struct Fall {
        const char* name;
        float decke, abklingen;
    };
    const float nan = std::numeric_limits<float>::quiet_NaN();
    const Fall faelle[] = {{"abklingen_ms = 0", -1.0f, 0.0f}, {"abklingen_ms = -50", -1.0f, -50.0f},
                           {"abklingen_ms = NaN", -1.0f, nan}, {"decke_dbtp = NaN", nan, 50.0f},
                           {"decke_dbtp = +inf", std::numeric_limits<float>::infinity(), 50.0f}};
    for (const Fall& f : faelle) {
        LimiterEinstellung e;
        e.decke_dbtp = f.decke;
        e.abklingen_ms = f.abklingen;
        MasterLimiter m(e);
        std::vector<float> l = haertung::rauschen(48000 * 3, 4.0, 561), r = l;
        lauf(m, l, r, 512);
        const bool endlich = haertung::endlich(l);
        const double s = haertung::spitze(l);
        // expected: invalid values fall back like anstieg / halten do (ceiling -1 dBTP, 50 ms)
        const bool ok = endlich && s <= decke_lin(-1.0f);
        std::printf("  %-20s output finite %d, peak %.3g (%.2f dBFS) %s\n", f.name, endlich, s, haertung::db(s), ok ? "ok" : "WRONG");
        PRUEF(ok);
    }
}

void befund_riesig() {
    struct Fall {
        int anstieg, halten;
        float decke;
        float spitze;
    };
    const Fall faelle[] = {{64, 8, -1.0f, 1e16f}, {64, 8, -1.0f, 1e17f}, {64, 8, -1.0f, 1e18f}, {64, 8, -1.0f, 1e30f},
                           {64, 8, -1.0f, std::numeric_limits<float>::max()}, {1000, 0, -20.0f, 1e11f},
                           {1000, 0, -20.0f, 1e12f}, {1000, 0, -20.0f, 1e15f}};
    for (const Fall& f : faelle) {
        LimiterEinstellung e;
        e.anstieg = f.anstieg;
        e.halten = f.halten;
        e.decke_dbtp = f.decke;
        e.abklingen_ms = 1.0f;
        MasterLimiter m(e);
        std::vector<float> l = haertung::rauschen(20000, 0.05, 571), r(l.size(), 0.0f);
        l[10000] = f.spitze;  // one sample, L only
        lauf(m, l, r, 512);
        const double s = haertung::spitze(l);
        const std::size_t wo = 10000 + static_cast<std::size_t>(m.vorhalt_samples());
        std::printf("  anstieg %4d decke %+.0f, spike %.3g (%+.0f dBFS): output peak %+.2f dBFS, sample at the spike %+.3g\n",
                    f.anstieg, static_cast<double>(f.decke), static_cast<double>(f.spitze), haertung::db(f.spitze),
                    haertung::db(s), static_cast<double>(l[wo]));
        PRUEF(s <= decke_lin(f.decke));
        PRUEF(l[wo] >= 0.0f);  // never inverted
    }
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_fuzz();
        pruefe_verzug();
        pruefe_transparenz();
        pruefe_bloecke();
        pruefe_zuruecksetzen();
        pruefe_denormal();
        pruefe_verstaerkung();
    }
    if (haertung::befund_lauf("limiter_einstellung")) befund_einstellung();
    if (haertung::befund_lauf("limiter_riesig")) befund_riesig();
    return haertung::ende();
}
