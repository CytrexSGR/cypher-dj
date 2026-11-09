// Package 1.15: gate against analytic expectations (timing in samples, levels in dB).
// Measurement trick: the main input is DC 0.5 on both channels and the sidechain carries the test signal,
// so out / 0.5 is exactly the gain curve.
// Call: test_gate [1]   (1 = mutation build CYPHERDJ_DSP_MUTATION_GATE_HART, where the gain jumps to its
//                         target without a ramp: the click check MUST then fail, i.e. see a step > the bound)
#include <cypherdj/dsp/gate.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>

#include "measure.h"
#include "check.h"

using namespace cypherdj::dsp;

namespace {

constexpr double kFs = 48000.0;
double lin(double db) { return std::pow(10.0, db / 20.0); }

struct Lauf {
    std::vector<float> l, r;
};

// Runs main (ml, mr) with sidechain (sl, sr; may be empty = no sidechain) in blocks of `block` samples
// (block <= 0: a fixed pseudo-random pattern of sizes 1..kMaxFrames).
Lauf durch(Gate& g, const std::vector<float>& ml, const std::vector<float>& mr, const std::vector<float>* sl,
           const std::vector<float>* sr, int block) {
    Lauf a{std::vector<float>(ml.size()), std::vector<float>(ml.size())};
    unsigned s = 12345;
    for (std::size_t p = 0; p < ml.size();) {
        int b = block;
        if (b <= 0) { s = s * 1664525u + 1013904223u; b = 1 + static_cast<int>((s >> 8) % kMaxFrames); }
        const int n = static_cast<int>(std::min<std::size_t>(static_cast<std::size_t>(b), ml.size() - p));
        g.verarbeite(&ml[p], &mr[p], &a.l[p], &a.r[p], n, sl ? &(*sl)[p] : nullptr, sr ? &(*sr)[p] : nullptr);
        p += static_cast<std::size_t>(n);
    }
    return a;
}

std::vector<float> konstant(std::size_t n, float v) { return std::vector<float>(n, v); }

// First index >= ab where pred(gain) holds; -1 if never.
template <class P>
long erster(const std::vector<float>& y, long ab, P pred) {
    for (std::size_t i = static_cast<std::size_t>(ab); i < y.size(); ++i)
        if (pred(y[i] / 0.5)) return static_cast<long>(i);
    return -1;
}

// Closed gate, sidechain silent except one +Inf sample: the gain 20000 samples later (floor if the follower recovered, 1 if Inf stuck it).
double gain_nach_inf() {
    Gate g(kFs);
    GateParameter q;
    g.setze(q);
    const std::size_t n = 20000;
    std::vector<float> dc = konstant(n, 0.5f), sc = konstant(n, 0.0f);
    sc[100] = INFINITY;
    const Lauf a = durch(g, dc, dc, &sc, &sc, 256);
    return a.l[n - 1] / 0.5;
}

}  // namespace

int main(int argc, char** argv) {
    const bool mutation = argc > 1 && std::atoi(argv[1]) == 1;
    const bool mutation_inf = argc > 1 && std::atoi(argv[1]) == 2;   // build CYPHERDJ_DSP_MUTATION_GATE_INF_KLEBT: the Inf check MUST then fail

    GateParameter p;          // threshold -40, hysteresis 4, hard, floor -80, attack 1 ms, hold 20 ms, release 100 ms
    const long kAuf = 1000;   // sidechain step up
    const long kZu = 20000;   // sidechain step down
    const std::size_t kN = 40000;
    std::vector<float> sc(kN, 0.0f);
    for (long i = kAuf; i < kZu; ++i) sc[static_cast<std::size_t>(i)] = 0.5f;  // -6.02 dBFS
    const auto dc = konstant(kN, 0.5f);

    auto g = std::make_unique<Gate>(kFs);
    g->setze(p);
    const Lauf a = durch(*g, dc, dc, &sc, &sc, 256);

    // 1) Click check (the one that MUST fail on the mutation): attack 1 ms = 48 samples, floor 1e-4, so the
    //    largest gain step is (1 - 1e-4) / 48 = 0.02083; release 4800 samples. A hard switch makes a step of ~1.
    double groesster_schritt = 0.0;
    for (std::size_t i = 1; i < kN; ++i) groesster_schritt = std::max(groesster_schritt, std::fabs(a.l[i] - a.l[i - 1]) / 0.5);
    const double schranke = (1.0 - lin(-80.0)) / 48.0 + 1e-6;
    std::printf("largest gain step per sample: %.6f (bound %.6f)\n", groesster_schritt, schranke);
    if (mutation_inf) {
        PRUEF(gain_nach_inf() < 0.01);   // on the mutation build the Inf sticks the follower: this check must see the open gate and FAIL
        return pruef::ende();
    }
    if (mutation) {
        PRUEF(groesster_schritt > 0.5);  // mutation build: the check must see the click
        return pruef::ende();
    }
    PRUEF(groesster_schritt <= schranke);

    // 2) Closed at the start: gain = floor -80 dB.
    PRUEF_NAH(messen::db(a.l[500] / 0.5), -80.0, 0.001);
    PRUEF_NAH(messen::db(a.r[500] / 0.5), -80.0, 0.001);

    // 3) Attack timing: opens at the step sample, 48 samples linear ramp, first sample at 0 dB is kAuf + 47.
    const long voll = erster(a.l, kAuf, [](double v) { return v >= 1.0 - 1e-6; });
    std::printf("attack: first sample at 0 dB = step + %ld (expected 47)\n", voll - kAuf);
    PRUEF(voll == kAuf + 47);
    PRUEF(a.l[kAuf - 1] / 0.5 < 2e-4);
    PRUEF_NAH(a.l[kAuf] / 0.5, lin(-80.0) + (1.0 - lin(-80.0)) / 48.0, 1e-6);
    PRUEF_NAH(a.l[kAuf + 23] / 0.5, lin(-80.0) + 24.0 * (1.0 - lin(-80.0)) / 48.0, 1e-5);  // half way

    // 4) Close timing: the detector decays as 0.5 · exp(-(k+1) / (10 ms · fs)) after the step down; it is below
    //    the close threshold -44 dB from k_unter on; after hold (960 samples) the release starts, 4800 samples long.
    const double tau = kGateDetektorAbfallMs * 1e-3 * kFs;  // 480 samples
    const long k_unter = static_cast<long>(std::ceil(tau * std::log(0.5 / lin(-44.0)))) - 1;
    const long soll_start = kZu + k_unter + 960;
    const long start = erster(a.l, kZu, [](double v) { return v < 1.0 - 1e-6; });
    const long boden = erster(a.l, kZu, [](double v) { return v <= lin(-80.0) + 1e-6; });
    std::printf("release starts at step + %ld (expected %ld = detector %ld + hold 960), floor after %ld samples (4800)\n",
                start - kZu, soll_start - kZu, k_unter, boden - start + 1);
    PRUEF(std::labs(start - soll_start) <= 1);
    PRUEF(std::labs((boden - start + 1) - 4800) <= 1);
    PRUEF_NAH(messen::db(a.l[kN - 1] / 0.5), -80.0, 0.001);

    // 5) Stereo link: same gain on both channels.
    {
        double m = 0.0;
        for (std::size_t i = 0; i < kN; ++i) m = std::max(m, static_cast<double>(std::fabs(a.l[i] - a.r[i])));
        PRUEF(m == 0.0);
    }

    // 6) Hysteresis: a sidechain at -42 dB (between close -44 and open -40) keeps a closed gate closed and an
    //    open gate open. A gate without hysteresis would close in the second case.
    {
        std::vector<float> s2(kN, static_cast<float>(lin(-42.0)));
        auto g2 = std::make_unique<Gate>(kFs);
        g2->setze(p);
        const Lauf b = durch(*g2, dc, dc, &s2, &s2, 256);
        PRUEF_NAH(messen::db(b.l[kN - 1] / 0.5), -80.0, 0.001);
        PRUEF(!g2->offen());
        for (std::size_t i = 0; i < 2000; ++i) s2[i] = 0.5f;  // open first, then -42 dB
        auto g3 = std::make_unique<Gate>(kFs);
        g3->setze(p);
        const Lauf c = durch(*g3, dc, dc, &s2, &s2, 256);
        PRUEF_NAH(c.l[kN - 1] / 0.5, 1.0, 1e-6);
        PRUEF(g3->offen());
        // and at -45 dB (below close) it closes
        for (std::size_t i = 2000; i < kN; ++i) s2[i] = static_cast<float>(lin(-45.0));
        auto g4 = std::make_unique<Gate>(kFs);
        g4->setze(p);
        const Lauf d = durch(*g4, dc, dc, &s2, &s2, 256);
        PRUEF_NAH(messen::db(d.l[kN - 1] / 0.5), -80.0, 0.001);
    }

    // 7) Ratio (downward expander below the threshold): sidechain constant -50 dB, threshold -40:
    //    ratio 2 → (-50 + 40) · 1 = -10 dB, ratio 4 → -30 dB, ratio 10 → -90 dB clamped to the floor -80 dB.
    {
        const double soll[3][2] = {{2.0, -10.0}, {4.0, -30.0}, {10.0, -80.0}};
        std::vector<float> s3(kN, static_cast<float>(lin(-50.0)));
        for (const auto& z : soll) {
            GateParameter q = p;
            q.ratio = static_cast<float>(z[0]);
            auto g5 = std::make_unique<Gate>(kFs);
            g5->setze(q);
            const Lauf e = durch(*g5, dc, dc, &s3, &s3, 256);
            const double ist = messen::db(e.l[kN - 1] / 0.5);
            std::printf("ratio %.0f at -50 dB: %.4f dB (expected %.1f)\n", z[0], ist, z[1]);
            PRUEF_NAH(ist, z[1], 0.01);
        }
    }

    // 8) Floor -120 = fully closed: output exactly 0. Floor -30 → -30 dB.
    {
        GateParameter q = p;
        q.bereich_db = -120.0f;
        auto g6 = std::make_unique<Gate>(kFs);
        g6->setze(q);
        const auto still = konstant(4096, 0.0f);
        const auto dc4 = konstant(4096, 0.5f);
        const Lauf e = durch(*g6, dc4, dc4, &still, &still, 256);
        PRUEF(e.l[4095] == 0.0f && e.r[4095] == 0.0f);
        q.bereich_db = -30.0f;
        g6->setze(q);
        g6->leeren();
        const Lauf f = durch(*g6, dc4, dc4, &still, &still, 256);
        PRUEF_NAH(messen::db(f.l[4095] / 0.5), -30.0, 0.001);
        PRUEF_NAH(g6->gain_db(), -30.0, 0.001);
    }

    // 9) Sidechain vs. own input: loud main with a silent sidechain stays closed; without a sidechain it opens.
    //    Stereo link: a signal only on R opens the gate for L too.
    {
        const auto x = messen::sinus(1000.0, 0.5, 9600);
        const auto null = konstant(9600, 0.0f);
        auto g7 = std::make_unique<Gate>(kFs);
        g7->setze(p);
        const Lauf e = durch(*g7, x, x, &null, &null, 256);
        PRUEF(messen::db(messen::rms(e.l, 4800, 9600) / messen::rms(x, 4800, 9600)) < -79.9);
        g7->leeren();
        const Lauf f = durch(*g7, x, x, nullptr, nullptr, 256);
        PRUEF_NAH(messen::db(messen::rms(f.l, 4800, 9600) / messen::rms(x, 4800, 9600)), 0.0, 1e-4);
        g7->leeren();
        const auto dc9 = konstant(9600, 0.5f);
        const Lauf h = durch(*g7, dc9, dc9, &null, &x, 256);  // sidechain only right
        PRUEF_NAH(h.l[9599] / 0.5, 1.0, 1e-6);
    }

    // 10) Block size independence: random block sizes 1..kMaxFrames give bit-identical output.
    {
        auto g8 = std::make_unique<Gate>(kFs);
        g8->setze(p);
        const Lauf e = durch(*g8, dc, dc, &sc, &sc, 0);
        bool gleich = true;
        for (std::size_t i = 0; i < kN; ++i) gleich = gleich && e.l[i] == a.l[i] && e.r[i] == a.r[i];
        PRUEF(gleich);
        auto g9 = std::make_unique<Gate>(kFs);
        g9->setze(p);
        const Lauf f = durch(*g9, dc, dc, &sc, &sc, 1);
        gleich = true;
        for (std::size_t i = 0; i < kN; ++i) gleich = gleich && f.l[i] == a.l[i];
        PRUEF(gleich);
    }

    // 11) Parameters: NaN keeps the old value, out of range is clamped.
    {
        Gate g10(kFs);
        GateParameter q;
        q.schwelle_db = std::nanf("");
        q.attack_ms = 0.0f;
        q.ratio = 1000.0f;
        q.bereich_db = -500.0f;
        g10.setze(q);
        PRUEF(g10.parameter().schwelle_db == -40.0f);
        PRUEF(g10.parameter().attack_ms == 0.1f);
        PRUEF(g10.parameter().ratio == 100.0f);
        PRUEF(g10.parameter().bereich_db == -120.0f);
    }

    // 12) Sample rate from the constructor: at 96 kHz the 1 ms attack takes 96 samples.
    {
        auto g11 = std::make_unique<Gate>(96000.0);
        g11->setze(p);
        const Lauf e = durch(*g11, dc, dc, &sc, &sc, 256);
        const long v = erster(e.l, kAuf, [](double w) { return w >= 1.0 - 1e-6; });
        std::printf("attack at 96 kHz: %ld samples (expected 96)\n", v - kAuf + 1);
        PRUEF(v - kAuf + 1 == 96);
    }

    // 13) Inf / NaN on the sidechain: counts as silence, cannot hold the gate open (A3 review: +Inf on a key kept a foreign gate open for good).
    {
        PRUEF(gain_nach_inf() < 0.01);
        Gate gn(kFs);
        gn.setze(p);
        std::vector<float> dc2 = konstant(20000, 0.5f), sc2 = konstant(20000, 0.0f);
        sc2[100] = std::nanf("");
        const Lauf a = durch(gn, dc2, dc2, &sc2, &sc2, 256);
        PRUEF(a.l[19999] / 0.5 < 0.01);
    }

    // 14) leeren_offen(): switching on while a signal runs. Over the threshold: gain 1 from the first sample, no step, stays open.
    // Under it: stays open for hold, then goes to the floor within release (regular close). leeren() still starts closed.
    {
        const std::size_t n = 30000;
        std::vector<float> dc2 = konstant(n, 0.5f), laut = konstant(n, 0.0f), leise = konstant(n, 0.0f);
        for (std::size_t i = 0; i < n; ++i) {
            laut[i] = static_cast<float>(0.3 * std::sin(2.0 * 3.14159265358979 * 1000.0 * static_cast<double>(i) / kFs));
            leise[i] = laut[i] * 0.001f;   // -70 dBFS
        }
        Gate go(kFs);
        go.setze(p);
        go.leeren_offen();
        const Lauf a = durch(go, dc2, dc2, &laut, &laut, 256);
        PRUEF(a.l[0] / 0.5 == 1.0);
        bool immer_offen = true;
        for (std::size_t i = 0; i < n; ++i) immer_offen = immer_offen && a.l[i] == 0.5f;
        PRUEF(immer_offen);
        Gate gq(kFs);
        gq.setze(p);
        gq.leeren_offen();
        const Lauf b = durch(gq, dc2, dc2, &leise, &leise, 256);
        const long hold = static_cast<long>(std::lround(p.hold_ms * 1e-3 * kFs));
        const long zu = erster(b.l, 0, [](double v) { return v < 1.0 - 1e-6; });
        const long boden = erster(b.l, 0, [](double v) { return v <= lin(-80.0) + 1e-6; });
        std::printf("leeren_offen under the threshold: first drop at sample %ld (hold %ld), floor at %ld (release 4800 after)\n", zu, hold, boden);
        PRUEF(zu >= hold && zu <= hold + 2);
        PRUEF(boden > zu && boden <= zu + 4800 + 2);
        Gate gc(kFs);
        gc.setze(p);
        gc.leeren();
        const Lauf c = durch(gc, dc2, dc2, &laut, &laut, 256);
        PRUEF(c.l[0] / 0.5 < 0.01);   // control: leeren() is still closed
    }
    return pruef::ende();
}
