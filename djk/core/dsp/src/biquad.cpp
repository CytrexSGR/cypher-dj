#include <cypherdj/dsp/biquad.h>

#include <cmath>

namespace cypherdj::dsp {

namespace {
constexpr double kPi = 3.14159265358979323846;
// Güten der Butterworth-Pole 4. Ordnung: q = 1 / (2 sin((2k−1)π/8)), k = 1, 2
// (so auch proben/04-mixer-effekte/nachpruefung/lauf2/kreuz_isolator.py).
const double kQ1 = 1.0 / (2.0 * std::sin(1.0 * kPi / 8.0));  // 1,3066
const double kQ2 = 1.0 / (2.0 * std::sin(3.0 * kPi / 8.0));  // 0,5412
}  // namespace

BiquadKoeff tiefpass_2(double fc, double q, double fs) {
    const double k = std::tan(kPi * fc / fs);
    const double norm = 1.0 / (1.0 + k / q + k * k);
    BiquadKoeff c;
    c.b0 = k * k * norm;
    c.b1 = 2.0 * c.b0;
    c.b2 = c.b0;
    c.a1 = 2.0 * (k * k - 1.0) * norm;
    c.a2 = (1.0 - k / q + k * k) * norm;
    return c;
}

BiquadKoeff hochpass_2(double fc, double q, double fs) {
    const double k = std::tan(kPi * fc / fs);
    const double norm = 1.0 / (1.0 + k / q + k * k);
    BiquadKoeff c;
    c.b0 = norm;
    c.b1 = -2.0 * norm;
    c.b2 = norm;
    c.a1 = 2.0 * (k * k - 1.0) * norm;
    c.a2 = (1.0 - k / q + k * k) * norm;
    return c;
}

Lr8 lr8_tiefpass(double fc, double fs) {
    Lr8 f;
    f.b[0].k = tiefpass_2(fc, kQ1, fs);
    f.b[1].k = tiefpass_2(fc, kQ2, fs);
    f.b[2].k = tiefpass_2(fc, kQ1, fs);
    f.b[3].k = tiefpass_2(fc, kQ2, fs);
    return f;
}

Lr8 lr8_hochpass(double fc, double fs) {
    Lr8 f;
    f.b[0].k = hochpass_2(fc, kQ1, fs);
    f.b[1].k = hochpass_2(fc, kQ2, fs);
    f.b[2].k = hochpass_2(fc, kQ1, fs);
    f.b[3].k = hochpass_2(fc, kQ2, fs);
    return f;
}

}  // namespace cypherdj::dsp
