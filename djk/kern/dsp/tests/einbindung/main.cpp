// Ein Block durch einen Kanalzug, gebaut als Unterprojekt: Ausgang nicht stumm, Fader −200 stumm.
#include <cypherdj/dsp/kanalzug.h>

#include <cstdio>
#include <memory>

int main() {
    using namespace cypherdj::dsp;
    auto kz = std::make_unique<Kanalzug>();
    float in[256], l[256], r[256];
    for (int i = 0; i < 256; ++i) in[i] = (i % 32) / 32.0f - 0.5f;
    KanalzugAusgang aus;
    aus.haupt_l = l;
    aus.haupt_r = r;
    kz->setze_sofort(Regler::trim, 0.0f);
    kz->verarbeite(in, in, 256, aus);  // Fader auf Vorgabe −200
    float spitze = 0.0f;
    for (float v : l) spitze = v > spitze ? v : (-v > spitze ? -v : spitze);
    kz->setze_sofort(Regler::fader, 0.0f);
    kz->verarbeite(in, in, 256, aus);
    float spitze2 = 0.0f;
    for (float v : l) spitze2 = v > spitze2 ? v : (-v > spitze2 ? -v : spitze2);
    std::printf("einbindung: Fader -200 Spitze %g, Fader 0 Spitze %g\n", spitze, spitze2);
    return (spitze == 0.0f && spitze2 > 0.1f) ? 0 : 1;
}
