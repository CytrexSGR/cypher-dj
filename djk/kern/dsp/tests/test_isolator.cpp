// Task 4: LR8-Isolator gegen Dossier 04 §4.1 (analytisch nachgerechnet: kreuz_isolator.py).
#include <cypherdj/dsp/biquad.h>
#include <cypherdj/dsp/isolator.h>

#include <algorithm>
#include <cstdio>
#include <memory>
#include <vector>

#include "messen.h"
#include "pruef.h"

using namespace cypherdj::dsp;

namespace {

// Läuft x in 256er-Blöcken durch den Isolator, konstante Band-Gains, Mono auf beiden Kanälen.
std::vector<float> durch(const std::vector<float>& x, float gt, float gm, float gh) {
    auto iso = std::make_unique<Isolator>();
    std::vector<float> y(x.size()), r(x.size());
    std::vector<float> g0(kMaxFrames, gt), g1(kMaxFrames, gm), g2(kMaxFrames, gh);
    for (std::size_t p = 0; p < x.size(); p += 256) {
        const int n = static_cast<int>(std::min<std::size_t>(256, x.size() - p));
        iso->verarbeite(&x[p], &x[p], &y[p], &r[p], n, g0.data(), g1.data(), g2.data());
    }
    return y;
}

std::vector<float> impulsantwort(float gt, float gm, float gh) {
    std::vector<float> x(65536, 0.0f);
    x[0] = 1.0f;
    return durch(x, gt, gm, gh);
}

double max_abweichung_db(const std::vector<float>& h) {
    double m = 0.0;
    for (double f : messen::log_frequenzen(30.0, 16000.0, 200)) m = std::max(m, std::fabs(messen::betrag_db(h, f)));
    return m;
}

// Dämpfung eines Sinus der Frequenz f in dB (Einschwingen 1 s, Messung 1 s bis 2 s).
double daempfung_db(double f, float gt, float gm, float gh) {
    const auto x = messen::sinus(f, 0.5, 96000);
    const auto y = durch(x, gt, gm, gh);
    return messen::db(messen::rms(y, 48000, 96000) / messen::rms(x, 48000, 96000));
}

// Fehlerfall für die Flachheits-Messung: Butterworth-Weiche 4. Ordnung, parallel (04 §4.1: +2,94 dB).
std::vector<float> impulsantwort_bw4() {
    const double q1 = 1.0 / (2.0 * std::sin(messen::kPi / 8.0)), q2 = 1.0 / (2.0 * std::sin(3.0 * messen::kPi / 8.0));
    auto bw4 = [&](bool hoch, double fc) {
        Lr8 f;  // nur die ersten zwei Abschnitte werden benutzt: Butterworth 4
        f.b[0].k = hoch ? hochpass_2(fc, q1, messen::kFs) : tiefpass_2(fc, q1, messen::kFs);
        f.b[1].k = hoch ? hochpass_2(fc, q2, messen::kFs) : tiefpass_2(fc, q2, messen::kFs);
        return f;
    };
    Lr8 t = bw4(false, 246), m1 = bw4(true, 246), m2 = bw4(false, 2484), h = bw4(true, 2484);
    std::vector<float> y(65536);
    for (std::size_t i = 0; i < y.size(); ++i) {
        const double x = i == 0 ? 1.0 : 0.0;
        const double a = t.b[1].schritt(t.b[0].schritt(x));
        const double b = m2.b[1].schritt(m2.b[0].schritt(m1.b[1].schritt(m1.b[0].schritt(x))));
        const double c = h.b[1].schritt(h.b[0].schritt(x));
        y[i] = static_cast<float>(a + b + c);
    }
    return y;
}

}  // namespace

int main() {
    // Summe der drei Bänder bei EQ 0 dB flach, 30 Hz bis 16 kHz (Abnahme ±0,1 dB; analytisch 7,5e−8 dB).
    const double flach = max_abweichung_db(impulsantwort(1, 1, 1));
    std::printf("neutral: max |dB| 30 Hz..16 kHz = %.6f\n", flach);
    PRUEF(flach <= 0.1);
    // Positiv-Kontrolle der Messung: die Butterworth-Weiche muss auffallen (04 §4.1: 2,9382 dB).
    const double bw = max_abweichung_db(impulsantwort_bw4());
    std::printf("bw4-Weiche: max |dB| = %.4f\n", bw);
    PRUEF_NAH(bw, 2.938, 0.01);

    // Kill Mitte: Bandmitte √(246·2484) = 781,7 Hz ≥ 74 dB (04 §4.1: 74,619). Der Steckbrief nennt „1 kHz“;
    // dort liegt der LR8 246/2484 bei 63,57 dB (scipy-Gegenrechnung tests/kill_1khz_scipy.py: 63,571),
    // ≥ 74 dB ist bei 1 kHz mit diesen Grenzen nicht erreichbar (Befund B1 im Plan).
    const double km = -daempfung_db(781.7, 1, 0, 1);
    const double k1k = -daempfung_db(1000.0, 1, 0, 1);
    std::printf("kill mitte: 781,7 Hz %.3f dB, 1 kHz %.3f dB\n", km, k1k);
    PRUEF(km >= 74.0);
    PRUEF_NAH(km, 74.62, 0.3);
    PRUEF_NAH(k1k, 63.57, 0.3);
    // Kill Tief bei 60 Hz (04: 98,05) und Kill Hoch bei 10 kHz (04: 107,2)
    const double kt = -daempfung_db(60.0, 0, 1, 1);
    const double kh = -daempfung_db(10000.0, 1, 1, 0);
    std::printf("kill tief 60 Hz %.3f dB, kill hoch 10 kHz %.3f dB\n", kt, kh);
    PRUEF_NAH(kt, 98.05, 0.5);
    PRUEF_NAH(kh, 107.21, 0.5);
    // Negativ-Kontrolle: Kill Mitte lässt 60 Hz und 10 kHz unberührt (04: höchstens 0,006 dB)
    PRUEF(std::fabs(daempfung_db(60.0, 1, 0, 1)) <= 0.01);
    PRUEF(std::fabs(daempfung_db(10000.0, 1, 0, 1)) <= 0.01);
    // Mitte −12 dB in der Bandmitte (04: −11,995)
    const double m12 = daempfung_db(781.7, 1, static_cast<float>(std::pow(10.0, -12.0 / 20.0)), 1);
    std::printf("mitte -12 dB: %.4f dB\n", m12);
    PRUEF_NAH(m12, -11.995, 0.01);

    // Gruppenlaufzeit neutral wie 04 §4.1 (aus der Faust-Impulsantwort, NP analytisch bestätigt):
    // 3,734 / 3,995 / 5,116 / 0,570 / 0,027 ms. Gleiche Laufzeit heißt gleicher Aufbau wie die gemessene Kette.
    {
        const auto h = impulsantwort(1, 1, 1);
        const double f[5] = {30.0, 100.0, 246.0, 1000.0, 10000.0};
        const double soll[5] = {3.734, 3.995, 5.116, 0.570, 0.027};
        for (int i = 0; i < 5; ++i) {
            const double t = messen::laufzeit_ms(h, f[i]);
            std::printf("laufzeit %7.0f Hz: %.4f ms (04: %.3f)\n", f[i], t, soll[i]);
            PRUEF_NAH(t, soll[i], 0.005);
        }
    }

    // Bandabgriffe: Summe der drei Bänder gleich Ausgang bei Gain 1
    {
        auto iso = std::make_unique<Isolator>();
        const auto x = messen::sinus(440.0, 0.5, 256);
        std::vector<float> y(256), r(256), g(kMaxFrames, 1.0f);
        iso->verarbeite(x.data(), x.data(), y.data(), r.data(), 256, g.data(), g.data(), g.data());
        double m = 0.0;
        for (int i = 0; i < 256; ++i) {
            const double s = static_cast<double>(iso->band(Band::tief, 0)[i]) + iso->band(Band::mitte, 0)[i] +
                             iso->band(Band::hoch, 0)[i];
            m = std::max(m, std::fabs(s - y[i]));
        }
        PRUEF(m < 1e-6);
    }
    return pruef::ende();
}
