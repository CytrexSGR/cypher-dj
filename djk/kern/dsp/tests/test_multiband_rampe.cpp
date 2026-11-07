// Package 1.15 A4 (fix round): setze_band called every block with an unchanged value must not re-arm the band gain ramp. The Mixer sets the
// bands in every block (it reads the slots there); with a block of 128 samples or less the 5 ms ramp (240 samples) used to restart before it
// was over and ran for 22 ms at n = 128 and 30 ms at n = 8 (measured 2026-11-03, review probe p3c).
//  (R1) a band switched to bypass, the same setting repeated in every block: the gain has settled (within 0.05 dB for good) after at most 260
//       samples, at every block size from 256 down to 8
//  (R2) negative control: a changed value is still taken (the ramp runs to the new target, so the call is not a no-op)
#include <cypherdj/dsp/multiband.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "pruef.h"

using namespace cypherdj::dsp;

namespace {
// DC 0.1 sits in the low band only. Makeup +12 dB, settled; then the low band goes to bypass (gain 1): the output falls from 0.398 to 0.1.
long einschwingen(int n, bool wiederholen, float& vor, float& nach) {
    MultibandKompressor k;
    MbBandEinstellung e;
    e.aufholen_db = 12.0f;
    k.setze_band(Band::tief, e);
    std::vector<float> x(static_cast<std::size_t>(n), 0.1f), y(static_cast<std::size_t>(n));
    for (int b = 0; b < 60000 / n; ++b) k.verarbeite(x.data(), x.data(), y.data(), y.data(), n);
    vor = y[static_cast<std::size_t>(n) - 1];
    e.umgehen = true;
    std::vector<float> v;
    for (int b = 0; b < 100000 / n; ++b) {
        if (b == 0 || wiederholen) k.setze_band(Band::tief, e);
        k.verarbeite(x.data(), x.data(), y.data(), y.data(), n);
        v.insert(v.end(), y.begin(), y.end());
    }
    nach = v.back();
    long idx = -1;
    for (long i = static_cast<long>(v.size()) - 1; i >= 0; --i)
        if (std::fabs(v[static_cast<std::size_t>(i)] - nach) > 0.0058f * std::fabs(nach)) {
            idx = i + 1;
            break;
        }
    return idx;
}
}  // namespace

int main() {
    for (const int n : {256, 128, 64, 32, 8}) {
        float vor = 0.0f, nach = 0.0f;
        const long einmal = einschwingen(n, false, vor, nach);
        const long jeden = einschwingen(n, true, vor, nach);
        std::printf("R1 n=%3d: before %.4f, final %.4f; settled after %ld samples (set once: %ld; limit 260)\n", n, vor, nach, jeden, einmal);
        PRUEF_NAH(vor, 0.398, 0.01);
        PRUEF_NAH(nach, 0.1, 0.005);
        PRUEF(jeden <= 260);
        PRUEF(jeden >= 100);   // R2: the ramp really ran (a changed value was taken), it did not jump
        PRUEF(einmal <= 260);
    }
    return pruef::ende();
}
