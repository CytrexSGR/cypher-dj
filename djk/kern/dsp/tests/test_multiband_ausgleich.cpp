// Fix mb-ausgleich: a compressed band must not come out quieter than it went in. The 1.15 multiband had no automatic make-up: compressing
// the low band by 6 dB only lowered it (measured 2026-11-05: -6.3 dB below 200 Hz, -1.4 LU on a mix), so the tool made the mix quieter instead
// of denser. Each band now adds back its own average gain reduction (default "auto", MbBandEinstellung::aufholen_auto, on top of aufholen_db).
//  (A1) a band compressed by about 6 dB keeps its RMS within 1 dB of the same band uncompressed (red before the fix: -6 dB)
//  (A2) the compression itself is real (about 6 dB of reduction on the meter), so A1 is not met by a band that never compressed
//  (A3) negative control: a band that does not compress (ratio 1) gets no make-up, the output equals the uncompressed run
// The build with CYPHERDJ_DSP_MUTATION_MB_OHNE_AUSGLEICH (auto make-up switched off) MUST turn A1 red.
#include <cypherdj/dsp/multiband.h>

#include <cmath>
#include <cstdio>
#include <memory>
#include <vector>

#include "messen.h"
#include "pruef.h"

using namespace cypherdj::dsp;

namespace {
// 100 Hz sits in the low band (crossover 200 Hz), peak 0.5 = -6.02 dBFS. Threshold -18 dB, ratio 2: reduction (1 - 1/2) * 11.98 = 5.99 dB.
// 6 s of signal, the last second is measured: the make-up average (500 ms) has settled to 1e-5 of its step.
struct Lauf {
    double rms_db;     // RMS of the last second, dBFS
    float absenkung;   // reduction at the last sample, dB
};

Lauf lauf(float verhaeltnis) {
    auto k = std::make_unique<MultibandKompressor>();
    MbBandEinstellung e;
    e.schwelle_db = -18.0f;
    e.verhaeltnis = verhaeltnis;
    e.anstieg_ms = 5.0f;
    e.abklingen_ms = 80.0f;
    k->setze_band(Band::tief, e);
    k->leeren();
    const int n = 6 * 48000;
    const auto x = messen::sinus(100.0, 0.5, n);
    std::vector<float> y(x.size());
    for (std::size_t p = 0; p < x.size(); p += 256) {
        const int m = static_cast<int>(std::min<std::size_t>(256, x.size() - p));
        k->verarbeite(&x[p], &x[p], &y[p], &y[p], m);
    }
    return {messen::db(messen::rms(y, n - 48000, n)), k->aktuelle_absenkung_db(Band::tief)};
}
}  // namespace

int main() {
    const Lauf roh = lauf(1.0f), komp = lauf(2.0f);
    const double diff = komp.rms_db - roh.rms_db;
    std::printf("uncompressed band %.3f dBFS; compressed (reduction %.2f dB) %.3f dBFS; difference %+.3f dB\n", roh.rms_db, komp.absenkung,
                komp.rms_db, diff);
    PRUEF(std::fabs(diff) <= 1.0);                          // A1
    PRUEF(komp.absenkung < -5.0f && komp.absenkung > -7.0f);   // A2
    PRUEF(roh.absenkung == 0.0f);                           // A3: ratio 1 never reduces ...
    PRUEF_NAH(roh.rms_db, messen::db(0.5 / std::sqrt(2.0)), 0.05);   // ... and the band passes at its own level (no make-up from nothing)
    return pruef::ende();
}
