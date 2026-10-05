#include <cypherdj/dsp/isolator.h>

namespace cypherdj::dsp {

Isolator::Isolator(double fs, double grenze_tief_hz, double grenze_hoch_hz) {
    for (Kanal& k : k_) {
        k.tp_hoch = lr8_tiefpass(grenze_hoch_hz, fs);
        k.hp_hoch = lr8_hochpass(grenze_hoch_hz, fs);
        k.tp_tief = lr8_tiefpass(grenze_tief_hz, fs);
        k.hp_tief_mitte = lr8_hochpass(grenze_tief_hz, fs);
        k.hp_tief_hoch = lr8_hochpass(grenze_tief_hz, fs);
    }
}

void Isolator::leeren() {
    for (Kanal& k : k_) {
        k.tp_hoch.leeren();
        k.hp_hoch.leeren();
        k.tp_tief.leeren();
        k.hp_tief_mitte.leeren();
        k.hp_tief_hoch.leeren();
    }
}

void Isolator::verarbeite(const float* in_l, const float* in_r, float* out_l, float* out_r, int n,
                          const float* g_tief, const float* g_mitte, const float* g_hoch) {
    const float* in[2] = {in_l, in_r};
    float* out[2] = {out_l, out_r};
    for (int i = 0; i < n; ++i) {
        for (int c = 0; c < 2; ++c) {
            Kanal& k = k_[c];
            const double x = in[c][i];
            const double a = k.tp_hoch.schritt(x);   // Tief + Mitte
            const double b = k.hp_hoch.schritt(x);   // Hoch
            const double t = k.tp_tief.schritt(a);
            const double m = k.hp_tief_mitte.schritt(a);
            const double h = k.hp_tief_hoch.schritt(b);
            band_[0][c][i] = static_cast<float>(t);
            band_[1][c][i] = static_cast<float>(m);
            band_[2][c][i] = static_cast<float>(h);
            out[c][i] = static_cast<float>(t * g_tief[i] + m * g_mitte[i] + h * g_hoch[i]);
        }
    }
}

}  // namespace cypherdj::dsp
