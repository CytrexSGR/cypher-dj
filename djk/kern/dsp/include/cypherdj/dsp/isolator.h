// LR8-Isolator 246/2484 Hz, drei Bänder, Stereo (ADR 008, Dossier 04 §4.1).
// Aufbau wie Mixxx linkwitzriley8eqeffect.cpp: zuerst bei 2484 Hz teilen, dann bei 246 Hz;
// das Hoch-Band läuft zum Phasenabgleich durch den Hochpass bei 246 Hz. Die drei Bänder werden
// getrennt gerechnet, damit sie vor dem Band-Gain abgreifbar sind (SCHNITTSTELLEN §5.6).
// Teil der öffentlichen Naht von cypherdj_dsp.
#pragma once

#include <cstdint>

#include <cypherdj/dsp/biquad.h>
#include <cypherdj/dsp/werte.h>

namespace cypherdj::dsp {

enum class Band : std::uint8_t { tief = 0, mitte = 1, hoch = 2 };

class Isolator {
public:
    explicit Isolator(double fs = kAbtastrate, double grenze_tief_hz = 246.0, double grenze_hoch_hz = 2484.0);
    void leeren();
    // in → out, 1 ≤ n ≤ kMaxFrames; in und out dürfen gleich sein.
    // g_*: linearer Band-Gain je Sample (EQ mal (1 − Kill)).
    void verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n,
                    const float* g_tief, const float* g_mitte, const float* g_hoch);
    // Bandsignal vor dem Band-Gain aus dem letzten verarbeite()-Aufruf (kanal 0 = L, 1 = R).
    const float* band(Band b, int kanal) const { return band_[static_cast<int>(b)][kanal]; }

private:
    struct Kanal {
        Lr8 tp_hoch, hp_hoch, tp_tief, hp_tief_mitte, hp_tief_hoch;
    };
    Kanal k_[2];
    float band_[3][2][kMaxFrames] = {};
};

}  // namespace cypherdj::dsp
