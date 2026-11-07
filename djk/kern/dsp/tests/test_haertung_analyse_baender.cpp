// Hardening: messer/analyse_baender.h / .cpp (six analysis bands, K-weighted power, peak per 48-sample window).
// Fixed seed. The band coefficients are those of baender.json at 48 kHz (built in at compile time, no rate
// parameter), so the sample-rate checks of the other modules do not apply here.
//   1. Fuzz: full-scale noise, square, impulses, steps from silence, very quiet input (1e-30), random block sizes:
//      every record finite and >= 0, peak exactly the largest |sample| of its window, ende_offset correct.
//   2. Window alignment: for random erstes_sample (also negative and near the int64 limits) the first record ends at
//      the first sample s with (s + 1) % 48 == 0.
//   3. Segmentation independence: blocks of 1, 7, 64, kMaxFrames give bit-identical records for loud input; with a
//      decay into silence the records agree within 1e-6 (the denormal flush runs once per call).
//   4. Overflow of the record array: -1, exactly max_aus records written, nothing behind them touched.
//   5. zuruecksetzen(): after loud input, bit-identical to a fresh object.
//   6. Denormals: after 30 s silence following loud input every record is exactly 0 (states flushed).
//   Former bug B4 (fixed, now a normal ctest entry, see BERICHT-haertung.md and BERICHT-fixes.md): befund_analyse_subnormal - during the decay the
//   records carry subnormal float values (k_leistung, band) to the consumer.
//
// Mutation check (automatic, test_haertung_analyse_baender_mutation_flush): analyse_baender.cpp is copied with the
// denormal flush threshold 1e-30 raised to 1e-3 (a flush that changes audible states). The block-size check 3 is
// PRUEF_M and fails (verified 2026-11-02: records of blocks 1 and 7/64/1024 differ by 0.229).
#include <cypherdj/dsp/analyse_baender.h>
#include <cypherdj/dsp/werte.h>

#include <cstdio>
#include <limits>
#include <memory>
#include <vector>

#include "haertung.h"

using namespace cypherdj::dsp;
using haertung::Zufall;

namespace {

struct Satz {
    std::int64_t ende;  // absolute sample index of the last sample of the window
    HuellenWerte w;
};

std::vector<Satz> lauf(AnalyseBaender& a, const std::vector<float>& l, const std::vector<float>& r, int block,
                       std::int64_t start = 0, bool* struktur_ok = nullptr) {
    std::vector<Satz> s;
    std::vector<HuellenWerte> aus(static_cast<std::size_t>(kMaxFrames / kFenster + 2));
    for (std::size_t p = 0; p < l.size(); p += static_cast<std::size_t>(block)) {
        const int m = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), l.size() - p));
        const int n = a.verarbeite(&l[p], &r[p], m, aus.data(), static_cast<int>(aus.size()));
        for (int i = 0; i < n; ++i) {
            const HuellenWerte& h = aus[static_cast<std::size_t>(i)];
            if (struktur_ok) {
                bool ok = h.ende_offset >= 0 && h.ende_offset < m && (i == 0 || h.ende_offset > aus[static_cast<std::size_t>(i - 1)].ende_offset);
                ok = ok && (start + static_cast<std::int64_t>(p) + h.ende_offset + 1) % kFenster == 0;
                *struktur_ok = *struktur_ok && ok;
            }
            s.push_back({start + static_cast<std::int64_t>(p) + h.ende_offset, h});
        }
    }
    return s;
}

double abw(const std::vector<Satz>& a, const std::vector<Satz>& b) {
    if (a.size() != b.size()) return INFINITY;
    double m = 0.0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (a[i].ende != b[i].ende) return INFINITY;
        for (int k = 0; k < kBaender; ++k) m = std::fmax(m, std::fabs(static_cast<double>(a[i].w.band[k]) - b[i].w.band[k]));
        m = std::fmax(m, std::fabs(static_cast<double>(a[i].w.k_leistung) - b[i].w.k_leistung));
        m = std::fmax(m, std::fabs(static_cast<double>(a[i].w.spitze) - b[i].w.spitze));
    }
    return m;
}

std::vector<float> fuzz_signal(int n, int art, Zufall& z) {
    std::vector<float> x(static_cast<std::size_t>(n), 0.0f);
    for (int i = 0; i < n; ++i) {
        float& v = x[static_cast<std::size_t>(i)];
        switch (art) {
            case 0: v = static_cast<float>(z.zwischen(-1.0, 1.0)); break;
            case 1: v = ((i / 61) & 1) ? 1.0f : -1.0f; break;
            case 2: v = (z.gleich() < 0.001) ? (z.gleich() < 0.5 ? 1.0f : -1.0f) : 0.0f; break;
            case 3: v = i < n / 2 ? 0.0f : 1.0f; break;
            default: v = static_cast<float>(z.zwischen(-1e-30, 1e-30)); break;
        }
    }
    return x;
}

void pruefe_fuzz() {
    Zufall z(401);
    bool endlich = true, struktur = true, spitze_ok = true;
    double groesste_band = 0.0;
    const int n = 48000;
    for (int art = 0; art < 5; ++art) {
        const std::vector<float> l = fuzz_signal(n, art, z), r = fuzz_signal(n, (art + 1) % 5, z);
        auto a = std::make_unique<AnalyseBaender>(vertrag_baender());
        const std::vector<Satz> s = lauf(*a, l, r, z.ganz(1, kMaxFrames), 0, &struktur);
        struktur = struktur && s.size() == static_cast<std::size_t>(n / kFenster);
        for (const Satz& q : s) {
            for (int k = 0; k < kBaender; ++k) {
                endlich = endlich && std::isfinite(q.w.band[k]) && q.w.band[k] >= 0.0f;
                groesste_band = std::fmax(groesste_band, q.w.band[k]);
            }
            endlich = endlich && std::isfinite(q.w.k_leistung) && q.w.k_leistung >= 0.0f && std::isfinite(q.w.spitze);
            float m = 0.0f;
            for (std::int64_t i = q.ende - kFenster + 1; i <= q.ende; ++i)
                m = std::fmax(m, std::fmax(std::fabs(l[static_cast<std::size_t>(i)]), std::fabs(r[static_cast<std::size_t>(i)])));
            spitze_ok = spitze_ok && q.w.spitze == m;
        }
    }
    std::printf("fuzz: records finite and >= 0 %d, structure %d, peak exact %d, largest band RMS %.4g\n", endlich, struktur,
                spitze_ok, groesste_band);
    PRUEF(endlich);
    PRUEF(struktur);
    PRUEF(spitze_ok);
    PRUEF(groesste_band < 2.0);
}

void pruefe_ausrichtung() {
    Zufall z(411);
    bool ok = true;
    const std::int64_t grenzen[] = {0, 1, 47, 48, -1, -47, -48, std::numeric_limits<std::int64_t>::max(),
                                    std::numeric_limits<std::int64_t>::min(), std::numeric_limits<std::int64_t>::max() - 100};
    std::vector<float> x(200, 0.1f);
    for (int f = 0; f < 200; ++f) {
        const std::int64_t s0 = f < 10 ? grenzen[f] : static_cast<std::int64_t>(z.naechste());
        auto a = std::make_unique<AnalyseBaender>(vertrag_baender());
        a->zuruecksetzen(s0);
        HuellenWerte aus[8];
        const int n = a->verarbeite(x.data(), x.data(), 200, aus, 8);
        // first window end: smallest i >= 0 with (s0 + i + 1) % 48 == 0, computed without overflow
        std::int64_t rest = s0 % kFenster;
        if (rest < 0) rest += kFenster;
        const int erstes = static_cast<int>((kFenster - 1 - rest + kFenster) % kFenster);
        ok = ok && n >= 1 && aus[0].ende_offset == erstes && n == (200 - erstes - 1) / kFenster + 1;
    }
    std::printf("window alignment for 200 start samples (limits included): %d\n", ok);
    PRUEF(ok);
}

void pruefe_bloecke() {
    double laut = 0.0, abklingen = 0.0;
    for (int f = 0; f < 3; ++f) {
        const std::vector<float> l = haertung::rauschen(48000, 1.0, 421 + static_cast<std::uint64_t>(f)),
                                 r = haertung::rauschen(48000, 0.5, 431 + static_cast<std::uint64_t>(f));
        auto a = std::make_unique<AnalyseBaender>(vertrag_baender());
        const std::vector<Satz> ref = lauf(*a, l, r, 1);
        for (int b : {7, 64, kMaxFrames}) {
            auto c = std::make_unique<AnalyseBaender>(vertrag_baender());
            laut = std::fmax(laut, abw(ref, lauf(*c, l, r, b)));
        }
        std::vector<float> l2 = l, r2 = r;
        l2.resize(48000 * 8, 0.0f);
        r2.resize(48000 * 8, 0.0f);
        auto d = std::make_unique<AnalyseBaender>(vertrag_baender());
        const std::vector<Satz> ref2 = lauf(*d, l2, r2, 1);
        for (int b : {7, 64, kMaxFrames}) {
            auto c = std::make_unique<AnalyseBaender>(vertrag_baender());
            abklingen = std::fmax(abklingen, abw(ref2, lauf(*c, l2, r2, b)));
        }
    }
    std::printf("block sizes 1/7/64/%d: loud input max deviation %.3g, with 7 s decay %.3g\n", kMaxFrames, laut, abklingen);
    PRUEF_M(laut == 0.0);
    PRUEF_M(abklingen <= 1e-6);
}

void pruefe_ueberlauf() {
    std::vector<float> x = haertung::rauschen(kMaxFrames, 1.0, 441);
    auto a = std::make_unique<AnalyseBaender>(vertrag_baender());
    std::vector<HuellenWerte> aus(25);
    HuellenWerte waechter{};
    waechter.k_leistung = -12345.0f;
    for (auto& h : aus) h = waechter;
    const int n = a->verarbeite(x.data(), x.data(), kMaxFrames, aus.data(), 5);  // 21 windows complete
    bool unberuehrt = true;
    for (std::size_t i = 5; i < aus.size(); ++i) unberuehrt = unberuehrt && aus[i].k_leistung == -12345.0f;
    bool geschrieben = true;
    for (std::size_t i = 0; i < 5; ++i) geschrieben = geschrieben && aus[i].k_leistung != -12345.0f;
    // the next call continues the window grid as if nothing was lost
    const int n2 = a->verarbeite(x.data(), x.data(), 48, aus.data(), 25);
    std::printf("overflow: return %d, 5 written %d, rest untouched %d, next call %d records\n", n, geschrieben, unberuehrt, n2);
    PRUEF(n == -1 && geschrieben && unberuehrt && n2 == 1);
    const int n0 = a->verarbeite(x.data(), x.data(), 96, nullptr, 0);
    PRUEF(n0 == -1);
}

void pruefe_zuruecksetzen() {
    const std::vector<float> laut = haertung::rauschen(48000, 1.0, 451), x = haertung::rauschen(20000, 0.3, 452);
    auto frisch = std::make_unique<AnalyseBaender>(vertrag_baender()), benutzt = std::make_unique<AnalyseBaender>(vertrag_baender());
    lauf(*benutzt, laut, laut, 333);  // ends in the middle of a window
    benutzt->zuruecksetzen(0);
    const double d = abw(lauf(*frisch, x, x, 256), lauf(*benutzt, x, x, 256));
    std::printf("zuruecksetzen vs fresh: max deviation %.3g\n", d);
    PRUEF(d == 0.0);
}

struct Denormal {
    long band = 0, k = 0;
    bool am_ende_null = true;
};

Denormal denormal_lauf() {
    std::vector<float> l = haertung::rauschen(48000, 1.0, 461);
    l.resize(48000 * 31, 0.0f);
    auto a = std::make_unique<AnalyseBaender>(vertrag_baender());
    const std::vector<Satz> s = lauf(*a, l, l, kMaxFrames);
    Denormal d;
    for (const Satz& q : s) {
        for (int k = 0; k < kBaender; ++k) d.band += std::fpclassify(q.w.band[k]) == FP_SUBNORMAL;
        d.k += std::fpclassify(q.w.k_leistung) == FP_SUBNORMAL;
    }
    // the last second: every state flushed, every record exactly 0
    for (std::size_t i = s.size() - 1000; i < s.size(); ++i) {
        for (int k = 0; k < kBaender; ++k) d.am_ende_null = d.am_ende_null && s[i].w.band[k] == 0.0f;
        d.am_ende_null = d.am_ende_null && s[i].w.k_leistung == 0.0f && s[i].w.spitze == 0.0f;
    }
    return d;
}

void pruefe_denormal() {
    const Denormal d = denormal_lauf();
    std::printf("denormal: after 30 s silence all records exactly 0: %d (states flushed)\n", d.am_ende_null);
    PRUEF(d.am_ende_null);
}

void befund_subnormal() {
    const Denormal d = denormal_lauf();
    std::printf("  records with a subnormal field during the decay: band %ld, k_leistung %ld\n", d.band, d.k);
    PRUEF(d.band == 0);
    PRUEF(d.k == 0);
}

}  // namespace

int main(int argc, char** argv) {
    haertung::starte(argc, argv);
    if (haertung::normal_lauf()) {
        pruefe_fuzz();
        pruefe_ausrichtung();
        pruefe_bloecke();
        pruefe_ueberlauf();
        pruefe_zuruecksetzen();
        pruefe_denormal();
    }
    if (haertung::befund_lauf("analyse_subnormal")) befund_subnormal();
    return haertung::ende();
}
