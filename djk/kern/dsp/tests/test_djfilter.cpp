// Task 5: DJ-Filter (04 §4.6, NP K6): k = 0 bitgleich trocken, Endstellungen, ruhende Seite umgangen.
#include <cypherdj/dsp/djfilter.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "messen.h"
#include "pruef.h"

using namespace cypherdj::dsp;

namespace {
std::vector<float> durch(const std::vector<float>& x, double k) {
    auto f = std::make_unique<DjFilter>();
    std::vector<float> l = x, r = x;
    std::vector<double> kk(kMaxFrames, k);
    for (std::size_t p = 0; p < x.size(); p += 256) {
        const int n = static_cast<int>(std::min<std::size_t>(256, x.size() - p));
        f->verarbeite(&l[p], &r[p], n, kk.data());
    }
    return l;
}
double daempfung_db(double f, double k) {
    const auto x = messen::sinus(f, 0.5, 96000);
    const auto y = durch(x, k);
    return messen::db(messen::rms(y, 48000, 96000) / messen::rms(x, 48000, 96000));
}

// Fehlerfall zum Vergleich (04 §4.6, djfilter.lib `filt_svf = svf.lp : svf.hp`): beide Filter in Reihe,
// die ruhende Seite wirkt mit (Hochpass 20 Hz bei k < 0). Dieselbe TPT-Formel wie die Bibliothek.
double reihe_daempfung_db(double f, double k) {
    const double pi = messen::kPi, fs = messen::kFs, d = 1.0 / 0.707;
    const double ftp = 20000.0 * std::pow(60.0 / 20000.0, std::max(0.0, -k));
    const double fhp = 20.0 * std::pow(8000.0 / 20.0, std::max(0.0, k));
    const double gt = std::tan(pi * ftp / fs), gh = std::tan(pi * fhp / fs);
    const double at = 1.0 / (1.0 + gt * (gt + d)), ah = 1.0 / (1.0 + gh * (gh + d));
    const double nass = std::min(1.0, std::fabs(k) / 0.05);
    double t1 = 0, t2 = 0, h1 = 0, h2 = 0;
    const auto x = messen::sinus(f, 0.5, 96000);
    std::vector<float> y(x.size());
    for (std::size_t i = 0; i < x.size(); ++i) {
        double v1 = (t1 + gt * (x[i] - t2)) * at, v2 = t2 + gt * v1;
        t1 = 2 * v1 - t1; t2 = 2 * v2 - t2;
        const double tp = v2;
        v1 = (h1 + gh * (tp - h2)) * ah; v2 = h2 + gh * v1;
        h1 = 2 * v1 - h1; h2 = 2 * v2 - h2;
        y[i] = static_cast<float>(x[i] * (1.0 - nass) + (tp - d * v1 - v2) * nass);
    }
    return messen::db(messen::rms(y, 48000, 96000) / messen::rms(x, 48000, 96000));
}
}  // namespace

int main() {
    // Negativ-Kontrolle: k = 0 ist bitgleich trocken (04 §4.6: max|y−x| = 0), Rauschen und Sinus.
    std::vector<float> x(48000);
    unsigned s = 1;
    for (float& v : x) { s = s * 1664525u + 1013904223u; v = static_cast<float>((s >> 8) * (1.0 / 16777216.0) - 0.5); }
    const auto y0 = durch(x, 0.0);
    PRUEF(std::memcmp(x.data(), y0.data(), x.size() * sizeof(float)) == 0);
    // Fehlerfall zum Vergleich: schon k = 0,001 (Totzone, nass = 0,02) ist nicht mehr bitgleich.
    const auto y1 = durch(x, 0.001);
    PRUEF(std::memcmp(x.data(), y1.data(), x.size() * sizeof(float)) != 0);

    // Endstellungen: k = −1 Tiefpass 60 Hz, k = +1 Hochpass 8 kHz (2. Ordnung, 12 dB/Oktave).
    const double tp1k = daempfung_db(1000.0, -1.0);
    const double hp1k = daempfung_db(1000.0, 1.0);
    const double tp30 = daempfung_db(30.0, -1.0);
    const double hp16k = daempfung_db(16000.0, 1.0);
    std::printf("k=-1: 1 kHz %.2f dB, 30 Hz %.2f dB | k=+1: 1 kHz %.2f dB, 16 kHz %.2f dB\n", tp1k, tp30, hp1k, hp16k);
    PRUEF_NAH(tp1k, -48.90, 0.05);
    PRUEF_NAH(hp1k, -37.80, 0.05);
    PRUEF_NAH(tp30, -0.26, 0.05);    // nur der Tiefpass 60 Hz (in Reihe: −1,05 mit dem 20-Hz-Hochpass)
    PRUEF_NAH(hp16k, -0.05, 0.05);   // nur der Hochpass 8 kHz (in Reihe: −0,25 mit dem 20-kHz-Tiefpass)

    // 04 NP K6 am selben Fall vorher und nachher: erster Dreh auf die Tiefpass-Seite (k = −0,05, −0,1 und in
    // der Totzone −0,025), Frequenzgang unter 60 Hz; ebenso die Hochpass-Seite über 10 kHz.
    struct Fall { double k, f; };
    const Fall faelle[] = {{-0.025, 20.0}, {-0.05, 20.0}, {-0.05, 30.0}, {-0.1, 30.0}, {-0.1, 40.0},
                           {0.025, 16000.0}, {0.05, 16000.0}, {0.1, 10000.0}};
    for (const Fall& c : faelle) {
        const double neu = daempfung_db(c.f, c.k), alt = reihe_daempfung_db(c.f, c.k);
        std::printf("k=%+.3f %6.0f Hz: umgangen %+.4f dB, in Reihe %+.4f dB\n", c.k, c.f, neu, alt);
        PRUEF(std::fabs(neu) <= 0.01);
    }
    // Das Instrument sieht den Fehler: in Reihe fehlt bei k = −0,05 und 30 Hz der Sub-Bass (NP K6: −0,78 dB).
    PRUEF_NAH(reihe_daempfung_db(30.0, -0.05), -0.78, 0.05);
    PRUEF(reihe_daempfung_db(20.0, -0.05) < -2.5);

    // Mitte des Durchlasses bleibt bei k = ±0,5 unter 1 dB Abweichung am anderen Ende
    PRUEF(std::fabs(daempfung_db(200.0, -0.5)) < 1.0);   // Tiefpass bei 1095 Hz
    PRUEF(std::fabs(daempfung_db(4000.0, 0.5)) < 1.0);   // Hochpass bei 400 Hz
    return pruef::ende();
}
