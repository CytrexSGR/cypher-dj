// Task 7: nach dem Ende eines Signals klingen die IIR-Zustände ab. Ohne Flush-to-Zero landen sie in
// denormalen Zahlen (vielfache Rechenzeit). Gezählt werden denormale Ausgangswerte über 30 s Stille.
// Aufruf: test_denormal [erwarte_denormale]   (Mutationsbau ohne FTZ: Argument 1 → muss > 0 zählen)
#include <cypherdj/dsp/kanalzug.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>

#include "pruef.h"

using namespace cypherdj::dsp;

int main(int argc, char** argv) {
    const bool erwarte_denormale = argc > 1 && std::atoi(argv[1]) == 1;
    auto kz = std::make_unique<Kanalzug>();
    kz->setze_sofort(Regler::trim, 0.0f);
    kz->setze_sofort(Regler::fader, 0.0f);
    kz->setze_sofort(Regler::filter, -0.3f);  // Filter aktiv, damit auch seine Zustände abklingen
    std::vector<float> x(256), l(256), r(256);
    unsigned s = 5;
    long denormal = 0, bloecke = 0;
    for (int b = 0; b < 31 * 48000 / 256; ++b) {
        for (float& v : x) {
            if (b < 48000 / 256) { s = s * 1664525u + 1013904223u; v = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5); }
            else v = 0.0f;
        }
        KanalzugAusgang aus;
        aus.haupt_l = l.data();
        aus.haupt_r = r.data();
        kz->verarbeite(x.data(), x.data(), 256, aus);
        for (int i = 0; i < 256; ++i) {
            denormal += std::fpclassify(l[i]) == FP_SUBNORMAL;
            denormal += std::fpclassify(kz->abgriff(0)[i]) == FP_SUBNORMAL;
            denormal += std::fpclassify(kz->band(Band::tief, 0)[i]) == FP_SUBNORMAL;
        }
        ++bloecke;
    }
    std::printf("denormale Ausgangswerte in %ld Blöcken: %ld\n", bloecke, denormal);
    if (erwarte_denormale) PRUEF(denormal > 0);   // Mutationsbau: die Zählung muss den Fehler sehen
    else PRUEF(denormal == 0);
    return pruef::ende();
}
