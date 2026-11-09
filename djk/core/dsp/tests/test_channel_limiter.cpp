// Package 1.15, part C: channel limiter (KanalLimiter). Numeric checks against analytic expectations:
// latency in samples, ceiling in dB, attack/hold/release timing in samples, true peak of a sine.
// Call: test_kanal_limiter [mutation]
//   no argument:   every check must pass;
//   "vorhalt":     mutation build without signal delay; the onset check MUST fail (a limiter without lookahead
//                  lets the first samples of a burst through above the ceiling);
//   "echtspitze":  mutation build that detects sample peaks only; the true-peak check MUST fail (a sine at fs/4
//                  with 45 degrees phase has its peaks between the samples, 3.01 dB above them).
#include <cypherdj/dsp/channel_limiter.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "measure.h"
#include "check.h"

using namespace cypherdj::dsp;

namespace {

double db(double x) { return 20.0 * std::log10(x); }
double lin(double db) { return std::pow(10.0, db / 20.0); }

// Mono signal through the limiter (both channels equal), in blocks of the given size.
std::vector<float> durch(KanalLimiter& lim, const std::vector<float>& x, int block = 256) {
    std::vector<float> l(x), r(x);
    for (std::size_t a = 0; a < x.size(); a += static_cast<std::size_t>(block)) {
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(block), x.size() - a));
        lim.verarbeite(&l[a], &r[a], &l[a], &r[a], n);
    }
    return l;
}

double spitze(const std::vector<float>& x, std::size_t a = 0, std::size_t b = 0) {
    if (b == 0) b = x.size();
    double m = 0.0;
    for (std::size_t i = a; i < b; ++i) m = std::max(m, std::fabs(static_cast<double>(x[i])));
    return m;
}

// Each check reports whether it passed; main decides what is expected (normal or mutation build).
bool pruefe(bool ok, const char* name) {
    std::printf("  %-44s %s\n", name, ok ? "ok" : "ROT");
    return ok;
}

// 1. Latency: below the ceiling the limiter is a pure delay of exactly latenz_samples() (bit-exact, gain 1).
bool latenz() {
    bool ok = true;
    struct Fall { double fs; float ms; bool tp; int erwartet; };
    const Fall faelle[] = {
        {48000.0, 1.5f, false, 72 + KanalLimiter::kHalten},
        {48000.0, 1.5f, true, 72 + KanalLimiter::kHalten + KanalLimiter::kInterpVerzug},
        {44100.0, 1.5f, false, 66 + KanalLimiter::kHalten},  // round(66.15)
        {96000.0, 5.0f, true, 480 + KanalLimiter::kHalten + KanalLimiter::kInterpVerzug},
    };
    for (const Fall& f : faelle) {
        KanalLimiterEinstellung e;
        e.vorhalt_ms = f.ms;
        e.echtspitze = f.tp;
        auto lim = std::make_unique<KanalLimiter>(f.fs, e);
        std::vector<float> x(2048, 0.0f);
        x[100] = 0.5f;
        x[101] = -0.25f;
        const auto y = durch(*lim, x, 64);
        std::printf("    fs %.0f, %.1f ms, true peak %d: latency %d samples (expected %d)\n", f.fs, f.ms, f.tp,
                    lim->latenz_samples(), f.erwartet);
        ok &= lim->latenz_samples() == f.erwartet;
        for (std::size_t i = 0; i < y.size(); ++i) {
            const long j = static_cast<long>(i) - lim->latenz_samples();
            const float soll = j >= 0 ? x[static_cast<std::size_t>(j)] : 0.0f;
            if (y[i] != soll) { ok = false; break; }
        }
        ok &= lim->groesste_absenkung_db() == 0.0f;
    }
    return ok;
}

// 2. Onset of a burst at +6 dBFS after silence: not a single output sample above the ceiling, and the steady
//    state sits on the ceiling (ceiling minus the rounding reserve) with 7.02 dB gain reduction.
bool einsatz(double& absenkung_db, double& stand_db) {
    KanalLimiterEinstellung e;
    e.decke_db = -1.0f;
    auto lim = std::make_unique<KanalLimiter>(48000.0, e);
    std::vector<float> x(48000, 0.0f);
    for (int i = 1000; i < 48000; ++i) x[i] = static_cast<float>(2.0 * std::sin(2.0 * messen::kPi * 1000.0 * (i - 1000) / 48000.0));
    const auto y = durch(*lim, x);
    const double decke = lin(-1.0);
    const double gesamt = spitze(y);
    stand_db = db(spitze(y, 24000, 48000));
    absenkung_db = lim->groesste_absenkung_db();
    std::printf("    peak overall %.6f dBFS, steady %.6f dBFS, largest reduction %.4f dB\n", db(gesamt), stand_db,
                absenkung_db);
    return gesamt <= decke * (1.0 + 1e-7);
}

// 3. Timing of attack, hold and release with a DC burst (gain readable at every sample: out / delayed in).
bool zeiten() {
    bool ok = true;
    KanalLimiterEinstellung e;
    e.decke_db = -6.0f;
    e.vorhalt_ms = 1.0f;       // anstieg 48
    e.abklingen_ms = 10.0f;    // 480 samples
    auto lim = std::make_unique<KanalLimiter>(48000.0, e);
    const int A = lim->anstieg_samples(), H = KanalLimiter::kHalten, L = lim->latenz_samples();
    const int start = 4000, ende = 6000;  // burst = input samples [start, ende)
    std::vector<float> x(20000, 0.1f);
    for (int i = start; i < ende; ++i) x[i] = 1.0f;
    const auto y = durch(*lim, x, 100);
    std::vector<double> g(x.size() - static_cast<std::size_t>(L));  // gain for input sample i
    for (std::size_t i = 0; i < g.size(); ++i) g[i] = y[i + static_cast<std::size_t>(L)] / static_cast<double>(x[i]);
    const double q = lin(-6.0 - KanalLimiter::kRundungsReserveDb);
    int erste_absenkung = -1, volle_absenkung = -1, erste_rueckkehr = -1;
    for (int i = 0; i < static_cast<int>(g.size()); ++i) {
        if (erste_absenkung < 0 && g[i] < 1.0) erste_absenkung = i;
        if (volle_absenkung < 0 && std::fabs(g[i] - q) < 1e-6) volle_absenkung = i;
        if (i >= start && erste_rueckkehr < 0 && g[i] > q + 1e-6) erste_rueckkehr = i;
    }
    std::printf("    anstieg %d, halten %d: first reduced input sample %d (expected %d), full reduction from %d "
                "(expected %d), back up from %d (expected %d)\n", A, H, erste_absenkung, start - A - H,
                volle_absenkung, start - H, erste_rueckkehr, ende + H);
    ok &= erste_absenkung == start - A - H;
    ok &= volle_absenkung == start - H;
    ok &= erste_rueckkehr == ende + H;
    // Release: after the moving average has passed (A + 1 samples), 1 - g decays as exp(-t / tau).
    const int t0 = ende + H + A + 100, tau = 480;
    const double verhaeltnis = (1.0 - g[t0 + tau]) / (1.0 - g[t0]);
    std::printf("    release: (1-g) after tau / (1-g) = %.6f (expected %.6f)\n", verhaeltnis, std::exp(-1.0));
    ok &= std::fabs(verhaeltnis - std::exp(-1.0)) < 1e-3;
    return ok;
}

// 4. True peak: sine at fs/4 with 45 degrees phase, sample peaks at -1.5 dBFS, true peak +1.51 dBTP.
//    For a steady sine the true peak is sqrt(2) * RMS (exact, independent of any interpolator).
bool echtspitze(double& ohne_db, double& mit_db) {
    const double a = lin(-1.5) * std::sqrt(2.0);
    std::vector<float> x(48000);
    for (int i = 0; i < 48000; ++i) x[i] = static_cast<float>(a * std::sin(messen::kPi / 2.0 * i + messen::kPi / 4.0));
    for (int tp = 0; tp < 2; ++tp) {
        KanalLimiterEinstellung e;
        e.decke_db = -1.0f;
        e.echtspitze = tp == 1;
        auto lim = std::make_unique<KanalLimiter>(48000.0, e);
        const auto y = durch(*lim, x);
        const double wahr = db(std::sqrt(2.0) * messen::rms(y, 24000, 48000));
        (tp ? mit_db : ohne_db) = wahr;
    }
    std::printf("    true peak of the output: sample-peak mode %.4f dBTP, true-peak mode %.4f dBTP (ceiling -1)\n",
                ohne_db, mit_db);
    bool ok = mit_db <= -1.0 + 1e-3 && mit_db >= -1.0 - 0.03;
    // Sweep up to 19.5 kHz at +3 dBFS: the interpolator must not droop (libebur128's 49 taps lose 1.8 dB at 20 kHz).
    for (double f : {1000.0, 5000.0, 12345.0, 15000.0, 17000.0, 19500.0}) {
        KanalLimiterEinstellung e;
        e.decke_db = -1.0f;
        e.echtspitze = true;
        auto lim = std::make_unique<KanalLimiter>(48000.0, e);
        const auto y = durch(*lim, messen::sinus(f, lin(3.0), 48000));
        const double wahr = db(std::sqrt(2.0) * messen::rms(y, 24000, 48000));
        std::printf("    %7.0f Hz at +3 dBFS: output true peak %.4f dBTP\n", f, wahr);
        ok &= wahr <= -1.0 + 1e-3 && wahr >= -1.0 - 0.03;
    }
    return ok;
}

// 5. Block sizes 1 ... kMaxFrames and in-place vs. separate buffers give bit-identical output.
bool bloecke() {
    std::vector<float> l(30000), r(30000);
    unsigned s = 7;
    for (std::size_t i = 0; i < l.size(); ++i) {
        s = s * 1664525u + 1013904223u;
        const float v = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5);
        l[i] = v * (i % 5000 < 1500 ? 6.0f : 0.5f);
        r[i] = -0.7f * l[i];
    }
    KanalLimiterEinstellung e;
    e.echtspitze = true;
    auto a = std::make_unique<KanalLimiter>(48000.0, e);
    auto b = std::make_unique<KanalLimiter>(48000.0, e);
    std::vector<float> al(l), ar(r), bl(l.size()), br(r.size());
    for (std::size_t i = 0; i < l.size(); i += kMaxFrames) {
        const int n = static_cast<int>(std::min<std::size_t>(kMaxFrames, l.size() - i));
        a->verarbeite(&al[i], &ar[i], &al[i], &ar[i], n);
    }
    const int laengen[] = {1, 17, 1024, 3, 256, 999, 64};
    std::size_t i = 0;
    for (int k = 0; i < l.size(); ++k) {
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(laengen[k % 7]), l.size() - i));
        b->verarbeite(&l[i], &r[i], &bl[i], &br[i], n);
        i += static_cast<std::size_t>(n);
    }
    return std::memcmp(al.data(), bl.data(), al.size() * sizeof(float)) == 0 &&
           std::memcmp(ar.data(), br.data(), ar.size() * sizeof(float)) == 0;
}

// 6. NaN and Inf at the input count as 0: the output stays finite and the gain is not destroyed.
bool nan_inf() {
    auto lim = std::make_unique<KanalLimiter>();
    std::vector<float> x(4000, 0.25f);
    x[500] = std::nanf("");
    x[900] = INFINITY;
    x[901] = -INFINITY;
    const auto y = durch(*lim, x);
    bool ok = true;
    for (float v : y) ok &= std::isfinite(v);
    ok &= y.back() == 0.25f;
    return ok;
}

// 7. Denormal input and decaying silence produce no subnormal output.
bool denormal() {
    auto lim = std::make_unique<KanalLimiter>(48000.0, KanalLimiterEinstellung{-0.3f, 1.5f, 80.0f, true});
    std::vector<float> x(96000, 0.0f);
    for (int i = 0; i < 4800; ++i) x[i] = static_cast<float>(3.0 * std::sin(0.05 * i));
    for (int i = 4800; i < 9600; ++i) x[i] = 1e-39f;  // subnormal
    const auto y = durch(*lim, x);
    long n = 0;
    for (float v : y) n += std::fpclassify(v) == FP_SUBNORMAL;
    std::printf("    subnormal output samples: %ld\n", n);
    return n == 0;
}

// 8. Changing ceiling and release at run time: the new ceiling holds once the lookahead window has passed.
bool umstellen() {
    auto lim = std::make_unique<KanalLimiter>();
    std::vector<float> x(48000);
    for (int i = 0; i < 48000; ++i) x[i] = static_cast<float>(1.5 * std::sin(2.0 * messen::kPi * 440.0 * i / 48000.0));
    std::vector<float> l(x), r(x);
    lim->verarbeite(l.data(), r.data(), l.data(), r.data(), 1000);
    lim->setze_decke_db(-12.0f);
    lim->setze_abklingen_ms(500.0f);
    bool ok = lim->decke_db() == -12.0f;
    for (int a = 1000; a < 48000; a += 1000) lim->verarbeite(&l[a], &r[a], &l[a], &r[a], 1000);
    const double nach = spitze(l, 1000 + static_cast<std::size_t>(lim->latenz_samples()) + KanalLimiter::kMaxFenster);
    std::printf("    peak after the ceiling change to -12 dB: %.4f dBFS\n", db(nach));
    ok &= nach <= lin(-12.0) * (1.0 + 1e-7);
    lim->setze_decke_db(+20.0f);  // out of range: clamped to 0 dB
    ok &= lim->decke_db() == 0.0f;
    return ok;
}

}  // namespace

int main(int argc, char** argv) {
    const std::string mutation = argc > 1 ? argv[1] : "";
    std::printf("KanalLimiter%s\n", mutation.empty() ? "" : (" (mutation build: " + mutation + ")").c_str());
    double absenkung = 0.0, stand = 0.0, ohne = 0.0, mit = 0.0;
    const bool r_latenz = pruefe(latenz(), "latency = anstieg + halten (+12 true peak)");
    const bool r_einsatz = pruefe(einsatz(absenkung, stand), "burst onset never above the ceiling");
    const bool r_zeiten = pruefe(zeiten(), "attack / hold / release timing");
    const bool r_echt = pruefe(echtspitze(ohne, mit), "true-peak mode holds -1 dBTP");
    const bool r_bloecke = pruefe(bloecke(), "block sizes bit-identical");
    const bool r_nan = pruefe(nan_inf(), "NaN/Inf at the input");
    const bool r_denormal = pruefe(denormal(), "no subnormal output");
    const bool r_umstellen = pruefe(umstellen(), "ceiling and release changeable at run time");

    if (mutation == "vorhalt") {
        PRUEF(!r_einsatz);  // the wrong implementation must be caught
        return pruef::ende();
    }
    if (mutation == "echtspitze") {
        PRUEF(!r_echt);
        return pruef::ende();
    }
    PRUEF(r_latenz);
    PRUEF(r_einsatz);
    PRUEF_NAH(absenkung, db(lin(-1.0 - KanalLimiter::kRundungsReserveDb) / 2.0), 0.005);  // -7.021 dB
    PRUEF_NAH(stand, -1.0 - KanalLimiter::kRundungsReserveDb, 0.002);
    PRUEF(r_zeiten);
    PRUEF(r_echt);
    PRUEF_NAH(ohne, -1.5 + 3.0103, 0.01);  // sample-peak mode leaves the inter-sample peak alone
    PRUEF(r_bloecke);
    PRUEF(r_nan);
    PRUEF(r_denormal);
    PRUEF(r_umstellen);
    return pruef::ende();
}
