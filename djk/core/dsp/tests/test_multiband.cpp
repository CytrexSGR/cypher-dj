// Package 1.15 part B: multiband compressor (multiband.h) against analytic expectations.
// Call: test_multiband [mutation]
//   no argument: every check must be green.
//   "allpass":  mutation build without the allpass in the high band (CYPHERDJ_DSP_MUTATION_MB_OHNE_ALLPASS);
//               the neutral flatness check MUST be red (deliberately wrong implementation).
//   "kopplung": mutation build with per-channel detection (CYPHERDJ_DSP_MUTATION_MB_UNGEKOPPELT);
//               the stereo-link check MUST be red.
#include <cypherdj/dsp/multiband.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <memory>
#include <random>
#include <vector>

#include "measure.h"
#include "check.h"

using namespace cypherdj::dsp;

namespace {

using Komp = MultibandKompressor;

struct Stereo {
    std::vector<float> l, r;
};

// Runs l/r through k in blocks of `block` samples.
Stereo durch(Komp& k, const std::vector<float>& l, const std::vector<float>& r, int block = 256) {
    Stereo y{std::vector<float>(l.size()), std::vector<float>(r.size())};
    for (std::size_t p = 0; p < l.size(); p += static_cast<std::size_t>(block)) {
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), l.size() - p));
        k.verarbeite(&l[p], &r[p], &y.l[p], &y.r[p], n);
    }
    return y;
}

std::vector<float> impulsantwort(Komp& k) {
    std::vector<float> x(65536, 0.0f);
    x[0] = 1.0f;
    return durch(k, x, x).l;
}

double max_abweichung_db(const std::vector<float>& h, double f0, double f1) {
    double m = 0.0;
    for (double f : messen::log_frequenzen(f0, f1, 400)) m = std::max(m, std::fabs(messen::betrag_db(h, f)));
    return m;
}

// LR8 with bilinear transform and prewarping: |LP| = 1 / (1 + W^8), |HP| = W^8 / (1 + W^8),
// W = tan(pi f / fs) / tan(pi fc / fs) (Butterworth 4 squared, exact for the prewarped design).
double omega8(double f, double fc) {
    const double w = std::tan(messen::kPi * f / messen::kFs) / std::tan(messen::kPi * fc / messen::kFs);
    return std::pow(w, 8.0);
}
double lr8_tp(double f, double fc) { return 1.0 / (1.0 + omega8(f, fc)); }
double lr8_hp(double f, double fc) { const double w = omega8(f, fc); return w / (1.0 + w); }

MbBandEinstellung komp(float schwelle, float verh, float knie = 0.0f, float auf = 0.0f, float an = 1.0f,
                       float ab = 50.0f) {
    MbBandEinstellung e;
    e.schwelle_db = schwelle;
    e.verhaeltnis = verh;
    e.knie_db = knie;
    e.aufholen_db = auf;
    e.aufholen_auto = false;   // these checks measure the static curve and the manual make-up; the automatic one has test_multiband_ausgleich
    e.anstieg_ms = an;
    e.abklingen_ms = ab;
    return e;
}

// Static curve (Giannoulis et al. 2012, eq. 4), here as the expected value.
double kurve_soll(double x, double t, double r, double w) {
    const double d = x - t;
    if (2.0 * d < -w) return 0.0;
    if (2.0 * std::fabs(d) <= w) return (1.0 / r - 1.0) * (d + w / 2.0) * (d + w / 2.0) / (2.0 * w);
    return (1.0 / r - 1.0) * d;
}

// ---------------------------------------------------------------------------------------------------------
// 1. Neutral bands sum to flat magnitude, 20 Hz .. 20 kHz within 0.1 dB.
//    MUST fail without the allpass in the high band (mutation "allpass": the high band lacks the phase of the
//    lower crossover and the sum dips near the upper crossover).
void test_flach() {
    const double grenzen[3][2] = {{200.0, 2000.0}, {80.0, 5000.0}, {500.0, 800.0}};
    for (const auto& g : grenzen) {
        auto k = std::make_unique<Komp>(kAbtastrate, g[0], g[1]);
        const double m = max_abweichung_db(impulsantwort(*k), 20.0, 20000.0);
        std::printf("neutral %4.0f/%4.0f Hz: max |dB| 20 Hz..20 kHz = %.6f\n", g[0], g[1], m);
        PRUEF(m <= 0.1);
        PRUEF(m <= 0.001);  // float rounding only; the design is exactly flat
    }
    // New crossovers at run time (coefficients only): still flat; tief > hoch is raised to hoch = tief.
    {
        auto k2 = std::make_unique<Komp>();
        k2->setze_grenzen(300.0, 3000.0);
        k2->leeren();
        const double m2 = max_abweichung_db(impulsantwort(*k2), 20.0, 20000.0);
        std::printf("setze_grenzen 300/3000 Hz: max |dB| = %.6f\n", m2);
        PRUEF(m2 <= 0.001);
        k2->setze_grenzen(1000.0, 500.0);
        PRUEF(k2->grenze_tief_hz() == 1000.0 && k2->grenze_hoch_hz() == 1000.0);
        k2->setze_grenzen(5.0, 1e9);
        PRUEF(k2->grenze_tief_hz() == kMbGrenzeMinHz && k2->grenze_hoch_hz() == 0.45 * kAbtastrate);
    }
    // All bands bypassed with heavy settings and a 0 dBFS impulse: still flat (bypass ignores the detector).
    auto k = std::make_unique<Komp>();
    for (int b = 0; b < 3; ++b) {
        MbBandEinstellung e = komp(-40.0f, 10.0f, 0.0f, 12.0f);
        e.umgehen = true;
        k->setze_band(static_cast<Band>(b), e);
    }
    k->leeren();
    const double m = max_abweichung_db(impulsantwort(*k), 20.0, 20000.0);
    std::printf("bypass all (T -40, R 10, makeup +12): max |dB| = %.6f\n", m);
    PRUEF(m <= 0.001);
}

// 2. Band split: each band soloed against the analytic LR8 magnitudes (|AP| = 1 drops out).
void test_baender() {
    const double ft = 200.0, fh = 2000.0;
    const double fr[] = {30.0, 100.0, 200.0, 632.5, 2000.0, 6000.0, 15000.0};
    for (int b = 0; b < 3; ++b) {
        auto k = std::make_unique<Komp>(kAbtastrate, ft, fh);
        MbBandEinstellung e;
        e.solo = true;
        k->setze_band(static_cast<Band>(b), e);
        k->leeren();
        const auto h = impulsantwort(*k);
        for (double f : fr) {
            double soll = 0.0;
            if (b == 0) soll = lr8_tp(f, fh) * lr8_tp(f, ft);
            if (b == 1) soll = lr8_tp(f, fh) * lr8_hp(f, ft);
            if (b == 2) soll = lr8_hp(f, fh);
            const double soll_db = messen::db(soll), ist_db = messen::betrag_db(h, f);
            if (soll_db < -80.0) {
                PRUEF_KLEINER(ist_db, -80.0);
                continue;
            }
            if (f == ft || f == fh) std::printf("solo band %d at %5.0f Hz: %.4f dB (analytic %.4f)\n", b, f, ist_db, soll_db);
            PRUEF_NAH(ist_db, soll_db, 0.01);
        }
    }
}

// 3. Static curve with DC in the low band (LR8 low pass: gain exactly 1 at DC). After settling the reduction
//    equals the curve at x = 20 log10(0.5) = -6.0206 dBFS.
void test_kurve() {
    const double a = 0.5, x = messen::db(a);
    struct Fall {
        double d, r, w, auf;  // threshold = x - d
    };
    const Fall faelle[] = {{-6.1, 4, 12, 0},  // below the knee: 0
                           {0.0, 4, 12, 0},   // at the threshold: (1/R-1) W/8 = -1.125
                           {3.0, 4, 12, 0},   // inside the knee: -0.75 * 81 / 24 = -2.53125
                           {10.0, 4, 12, 0},  // above the knee: -7.5
                           {13.9794, 4, 0, 0},  // threshold -20, hard knee: -10.4846
                           {10.0, 2, 0, 3}};  // ratio 2: -5, makeup +3
    std::vector<float> dc(24000, static_cast<float>(a));
    for (const Fall& f : faelle) {
        auto k = std::make_unique<Komp>();
        k->setze_band(Band::tief, komp(static_cast<float>(x - f.d), static_cast<float>(f.r), static_cast<float>(f.w),
                                       static_cast<float>(f.auf)));
        k->leeren();
        const auto y = durch(*k, dc, dc);
        const double soll = kurve_soll(x, x - f.d, f.r, f.w);
        const double gr = k->aktuelle_absenkung_db(Band::tief);
        const double aus = messen::db(y.l.back());
        std::printf("curve x-T %+7.3f R %.0f W %2.0f: GR %.5f dB (analytic %.5f), out %.5f dBFS (analytic %.5f)\n",
                    f.d, f.r, f.w, gr, soll, aus, x + soll + f.auf);
        PRUEF_NAH(gr, soll, 0.001);
        PRUEF_NAH(aus, x + soll + f.auf, 0.001);
        PRUEF_NAH(messen::db(y.r.back()), x + soll + f.auf, 0.001);
    }
}

// 4. Timing in samples. Detector alone, exactly: a level step reaches 1 - 1/e of its reduction after
//    anstieg_ms * fs samples. Release is the cascade peak hold (a_R) -> attack pole (a_A); from a settled
//    reduction G the closed form is  yL[n] = G a_A^n + (1 - a_A) G a_R (a_R^n - a_A^n) / (a_R - a_A).
//    (Swapped attack/release, a single-pole release or a time constant off by one sample per ms are red.)
void test_zeiten() {
    MbDetektor d;
    MbBandEinstellung e = komp(-20.0f, 4.0f, 0.0f, 0.0f, 10.0f, 100.0f);
    d.setze(e, messen::kFs);
    const double ziel = d.statisch_db(messen::db(0.5));
    PRUEF_NAH(ziel, (messen::db(0.5) + 20.0) * (0.25 - 1.0), 1e-12);
    const double schwelle63 = ziel * (1.0 - std::exp(-1.0));
    int n63 = -1;
    double g = 0.0;
    for (int n = 1; n <= 480; ++n) {
        g = d.schritt(0.5);
        if (n63 < 0 && g <= schwelle63 + 1e-9) n63 = n;
    }
    std::printf("attack 10 ms: GR after 480 samples %.6f dB (analytic %.6f), 63.2 %% reached at sample %d (480)\n", g,
                schwelle63, n63);
    PRUEF_NAH(g, schwelle63, 1e-9);
    PRUEF(n63 == 480);
    for (int n = 481; n <= 48000; ++n) g = d.schritt(0.5);
    PRUEF_NAH(g, ziel, 1e-9);
    const double G = -g;
    const double aA = std::exp(-1.0 / 480.0), aR = std::exp(-1.0 / 4800.0);
    auto soll = [&](int n) {
        return -(G * std::pow(aA, n) + (1.0 - aA) * G * aR * (std::pow(aR, n) - std::pow(aA, n)) / (aR - aA));
    };
    int n37 = -1, n37_soll = -1;
    double m = 0.0;
    for (int n = 1; n <= 20000; ++n) {
        g = d.schritt(0.0);
        m = std::max(m, std::fabs(g - soll(n)));
        if (n37 < 0 && g >= -G * std::exp(-1.0)) n37 = n;
        if (n37_soll < 0 && soll(n) >= -G * std::exp(-1.0)) n37_soll = n;
    }
    std::printf("release 100 ms (attack 10 ms): max |GR - closed form| %.3g dB, 1/e at sample %d (analytic %d)\n", m,
                n37, n37_soll);
    PRUEF_KLEINER(m, 1e-9);
    PRUEF(n37 == n37_soll);
    PRUEF(std::abs(n37 - (4800 + 480)) < 48);  // rule of thumb in multiband.h: abklingen + anstieg

    // Whole chain, 6 kHz sine burst in the high band: 63.2 % of the final reduction after 5 ms = 240 samples
    // (-20 % / +10 %: the band filter onset overshoots, sample 12 is 1.1 dB above the settled sample peak, so the
    // reduction starts with a slightly larger step and crosses earlier). The final reduction is the static curve at the sample peak of the high band
    // (measured with a neutral, soloed twin; a 6 kHz sine has 8 samples per period, so the sample peak lies
    // up to 0.69 dB below the sine amplitude).
    const auto s = messen::sinus(6000.0, 0.5, 48000);
    double spitze = 0.0;
    {
        auto z = std::make_unique<Komp>();
        MbBandEinstellung solo;
        solo.solo = true;
        z->setze_band(Band::hoch, solo);
        z->leeren();
        const auto y = durch(*z, s, s);
        for (std::size_t i = 24000; i < y.l.size(); ++i) spitze = std::max(spitze, std::fabs(static_cast<double>(y.l[i])));
    }
    auto k = std::make_unique<Komp>();
    k->setze_band(Band::hoch, komp(-20.0f, 4.0f, 0.0f, 0.0f, 5.0f, 2000.0f));
    k->leeren();
    std::vector<double> gr(s.size());
    float yl = 0, yr = 0;
    for (std::size_t i = 0; i < s.size(); ++i) {
        k->verarbeite(&s[i], &s[i], &yl, &yr, 1);
        gr[i] = k->aktuelle_absenkung_db(Band::hoch);
    }
    const double ende = gr.back(), ende_soll = (messen::db(spitze) + 20.0) * -0.75;
    int n = 0;
    while (n < static_cast<int>(gr.size()) && gr[n] > ende * (1.0 - std::exp(-1.0))) ++n;
    std::printf("chain 6 kHz: sample peak %.4f dBFS, final GR %.4f dB (analytic %.4f), 63.2 %% at sample %d (240)\n",
                messen::db(spitze), ende, ende_soll, n);
    PRUEF_NAH(ende, ende_soll, 0.01);
    PRUEF(n >= 192 && n <= 264);
}

// 5. Stereo-linked detection: L loud, R 20 dB lower, same 1 kHz sine in the mid band. Both channels get the
//    reduction of L. MUST fail with per-channel detection (mutation "kopplung": R would get only -2.98 dB).
void test_kopplung() {
    auto k = std::make_unique<Komp>();
    k->setze_band(Band::mitte, komp(-30.0f, 4.0f, 0.0f, 0.0f, 1.0f, 2000.0f));
    k->leeren();
    const auto l = messen::sinus(632.5, 0.5, 96000);
    const auto r = messen::sinus(632.5, 0.05, 96000);
    const auto y = durch(*k, l, r);
    const double soll = (messen::db(0.5) + 30.0) * -0.75;  // -17.98 dB
    const double gl = messen::db(messen::rms(y.l, 48000, 96000) / messen::rms(l, 48000, 96000));
    const double gr = messen::db(messen::rms(y.r, 48000, 96000) / messen::rms(r, 48000, 96000));
    std::printf("linked: L %.4f dB, R %.4f dB (analytic %.4f each)\n", gl, gr, soll);
    PRUEF_NAH(gl, soll, 0.1);
    PRUEF_NAH(gr, soll, 0.1);
}

// 6. Makeup and bypass: mid band +6 dB at the band centre sqrt(200 * 2000) = 632.5 Hz, where the other bands
//    leak below -80 dB; bypass ignores the makeup.
void test_aufholen() {
    const auto x = messen::sinus(632.5, 0.25, 48000);
    for (int umg = 0; umg < 2; ++umg) {
        auto k = std::make_unique<Komp>();
        MbBandEinstellung e = komp(0.0f, 1.0f, 0.0f, 6.0f);
        e.umgehen = umg == 1;
        k->setze_band(Band::mitte, e);
        k->leeren();
        const auto y = durch(*k, x, x);
        const double g = messen::db(messen::rms(y.l, 24000, 48000) / messen::rms(x, 24000, 48000));
        std::printf("makeup +6 dB, bypass %d: %.4f dB\n", umg, g);
        PRUEF_NAH(g, umg ? 0.0 : 6.0, 0.01);
    }
}

// 7. Solo switches with a linear ramp of exactly kSchaltMs = 5 ms = 240 samples: DC 0.5 lives only in the low
//    band; soloing the mid band takes the output from 0.5 to 0 along 0.5 * (1 - k / 240).
void test_schalten() {
    auto k = std::make_unique<Komp>();
    PRUEF(k->schalt_samples() == 240);
    std::vector<float> dc(48000, 0.5f);
    durch(*k, dc, dc);  // settle the filters
    MbBandEinstellung e;
    e.solo = true;
    k->setze_band(Band::mitte, e);
    std::vector<float> a(400, 0.5f), yl(400), yr(400);
    k->verarbeite(a.data(), a.data(), yl.data(), yr.data(), 400);
    double m = 0.0;
    for (int i = 0; i < 400; ++i) {
        const double soll = i < 240 ? 0.5 * (1.0 - (i + 1) / 240.0) : 0.0;
        m = std::max(m, std::fabs(yl[i] - soll));
    }
    std::printf("solo ramp: max deviation from 0.5 (1 - k/240) = %.3g, out[119] %.5f, out[239] %.5f\n", m, yl[119],
                yl[239]);
    PRUEF_KLEINER(m, 1e-4);
}

// 8. Block size independence: blocks of 1, 7, 333 and kMaxFrames are bit-identical to blocks of 256.
void test_bloecke() {
    std::mt19937 rng(7);
    std::normal_distribution<float> nd(0.0f, 0.3f);
    std::vector<float> l(20000), r(20000);
    for (std::size_t i = 0; i < l.size(); ++i) { l[i] = nd(rng); r[i] = 0.5f * nd(rng); }
    auto mach = [] {
        auto k = std::make_unique<Komp>();
        k->setze_band(Band::tief, komp(-30.0f, 4.0f, 6.0f, 3.0f, 2.0f, 80.0f));
        k->setze_band(Band::mitte, komp(-25.0f, 8.0f, 0.0f, 0.0f, 0.5f, 30.0f));
        k->setze_band(Band::hoch, komp(-35.0f, 2.0f, 12.0f, -3.0f, 10.0f, 300.0f));
        k->leeren();
        return k;
    };
    auto k0 = mach();
    const auto y0 = durch(*k0, l, r, 256);
    for (int b : {1, 7, 333, kMaxFrames}) {
        auto k = mach();
        const auto y = durch(*k, l, r, b);
        PRUEF(std::memcmp(y.l.data(), y0.l.data(), l.size() * sizeof(float)) == 0);
        PRUEF(std::memcmp(y.r.data(), y0.r.data(), r.size() * sizeof(float)) == 0);
    }
}

// 9. Metering readout and robustness: groesste resets on read, bypass reads 0, NaN input does not poison states.
void test_anzeige() {
    auto k = std::make_unique<Komp>();
    k->setze_band(Band::tief, komp(-20.0f, 4.0f));
    MbBandEinstellung e = komp(-20.0f, 4.0f);
    e.umgehen = true;
    k->setze_band(Band::mitte, e);
    k->leeren();
    std::vector<float> dc(24000, 0.5f);
    durch(*k, dc, dc);
    const double soll = (messen::db(0.5) + 20.0) * -0.75;
    // The largest reduction includes the overshoot of the LR8 low pass step response (about +1 dB of level).
    const double groesste = k->groesste_absenkung_db(Band::tief);
    std::printf("readout low band: largest %.4f dB, current %.4f dB (analytic settled %.4f)\n", groesste,
                k->aktuelle_absenkung_db(Band::tief), soll);
    PRUEF(groesste <= soll + 0.001 && groesste >= soll - 1.5);
    PRUEF(k->groesste_absenkung_db(Band::tief) == 0.0f);  // reset by the read, no new samples since
    PRUEF_NAH(k->aktuelle_absenkung_db(Band::tief), soll, 0.001);
    PRUEF(k->aktuelle_absenkung_db(Band::mitte) == 0.0f);
    PRUEF(k->groesste_absenkung_db(Band::mitte) == 0.0f);
    PRUEF(k->aktuelle_absenkung_db(Band::hoch) == 0.0f);
    // NaN/Inf for one block, then the signal again: output finite and back to the settled value.
    std::vector<float> bad(64, std::numeric_limits<float>::quiet_NaN()), yl(64), yr(64);
    bad[3] = std::numeric_limits<float>::infinity();
    k->verarbeite(bad.data(), bad.data(), yl.data(), yr.data(), 64);
    bool endlich = true;
    for (float v : yl) endlich = endlich && std::isfinite(v);
    const auto y = durch(*k, dc, dc);
    for (float v : y.l) endlich = endlich && std::isfinite(v);
    PRUEF(endlich);
    PRUEF_NAH(messen::db(y.l.back()), messen::db(0.5) + soll, 0.001);
    // Range clamping and NaN keep the previous value.
    MbBandEinstellung w = komp(-100.0f, 0.5f, 99.0f, 40.0f, 0.0f, 1e6f);
    k->setze_band(Band::hoch, w);
    const MbBandEinstellung& g = k->band_einstellung(Band::hoch);
    PRUEF(g.schwelle_db == kMbSchwelleMinDb && g.verhaeltnis == kMbVerhaeltnisMin && g.knie_db == kMbKnieMaxDb &&
          g.aufholen_db == kMbAufholenMaxDb && g.anstieg_ms == kMbAnstiegMinMs && g.abklingen_ms == kMbAbklingenMaxMs);
    w.schwelle_db = std::numeric_limits<float>::quiet_NaN();
    k->setze_band(Band::hoch, w);
    PRUEF(k->band_einstellung(Band::hoch).schwelle_db == kMbSchwelleMinDb);
}

int rot_in(void (*t)()) {
    const int vor = pruef::fehler();
    t();
    return pruef::fehler() - vor;
}

}  // namespace

int main(int argc, char** argv) {
    const char* mutation = argc > 1 ? argv[1] : nullptr;
    const int flach = rot_in(test_flach);
    rot_in(test_baender);
    rot_in(test_kurve);
    rot_in(test_zeiten);
    const int kopplung = rot_in(test_kopplung);
    rot_in(test_aufholen);
    rot_in(test_schalten);
    rot_in(test_bloecke);
    rot_in(test_anzeige);
    if (mutation) {
        const bool rot = std::strcmp(mutation, "allpass") == 0 ? flach > 0 : kopplung > 0;
        std::printf("mutation build \"%s\": %s\n", mutation, rot ? "red as expected" : "GREEN, the test misses it");
        return rot ? 0 : 1;
    }
    return pruef::ende();
}
