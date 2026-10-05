// Biquad in transponierter Direktform II (double), Butterworth-Abschnitte mit bilinearer
// Transformation und Vorverzerrung auf die Eckfrequenz (wie Faust fi.lowpass/fi.highpass, tf2s).
// Teil der öffentlichen Naht von cypherdj_dsp (14 baut die Analyse-Bänder daraus).
#pragma once

namespace cypherdj::dsp {

struct BiquadKoeff {
    double b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0;
};

// Ein Butterworth-Abschnitt zweiter Ordnung mit Güte q (Pole der Normalform).
BiquadKoeff tiefpass_2(double fc, double q, double fs);
BiquadKoeff hochpass_2(double fc, double q, double fs);

struct Biquad {
    BiquadKoeff k;
    double z1 = 0.0, z2 = 0.0;
    double schritt(double x) {
        const double y = k.b0 * x + z1;
        z1 = k.b1 * x - k.a1 * y + z2;
        z2 = k.b2 * x - k.a2 * y;
        return y;
    }
    void leeren() { z1 = z2 = 0.0; }
};

// Linkwitz-Riley 8. Ordnung = Butterworth 4. Ordnung zweimal = vier Abschnitte (48 dB/Oktave).
struct Lr8 {
    Biquad b[4];
    double schritt(double x) {
        return b[3].schritt(b[2].schritt(b[1].schritt(b[0].schritt(x))));
    }
    void leeren() { for (Biquad& q : b) q.leeren(); }
};
Lr8 lr8_tiefpass(double fc, double fs);
Lr8 lr8_hochpass(double fc, double fs);

}  // namespace cypherdj::dsp
