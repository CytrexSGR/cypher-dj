// Messhilfen für die Offline-Tests (keine Echtzeit, Allokation erlaubt).
#pragma once

#include <cmath>
#include <complex>
#include <vector>

namespace messen {

constexpr double kPi = 3.14159265358979323846;
constexpr double kFs = 48000.0;

inline double db(double lin) { return 20.0 * std::log10(lin); }

// DFT einer Impulsantwort bei Frequenz f; mit gewichtet = true die DFT von n·h[n].
inline std::complex<double> dft(const std::vector<float>& h, double f, bool gewichtet = false) {
    std::complex<double> s(0.0, 0.0);
    const double w = -2.0 * kPi * f / kFs;
    for (std::size_t i = 0; i < h.size(); ++i) {
        const double a = static_cast<double>(h[i]) * (gewichtet ? static_cast<double>(i) : 1.0);
        s += a * std::polar(1.0, w * static_cast<double>(i));
    }
    return s;
}

// Betrag der DFT einer Impulsantwort bei Frequenz f, in dB.
inline double betrag_db(const std::vector<float>& h, double f) { return db(std::abs(dft(h, f))); }

// Gruppenlaufzeit in ms: tau(w) = Re( DFT(n·h) / DFT(h) ) Samples (exakt, ohne numerische Ableitung).
inline double laufzeit_ms(const std::vector<float>& h, double f) {
    return std::real(dft(h, f, true) / dft(h, f)) / kFs * 1000.0;
}

// Frequenzen logarithmisch verteilt, beide Enden eingeschlossen.
inline std::vector<double> log_frequenzen(double f0, double f1, int n) {
    std::vector<double> f(n);
    for (int i = 0; i < n; ++i) f[i] = f0 * std::pow(f1 / f0, static_cast<double>(i) / (n - 1));
    return f;
}

inline std::vector<float> sinus(double f, double amp, int n) {
    std::vector<float> x(n);
    for (int i = 0; i < n; ++i) x[i] = static_cast<float>(amp * std::sin(2.0 * kPi * f * i / kFs));
    return x;
}

inline double rms(const std::vector<float>& x, int a, int b) {
    double s = 0.0;
    for (int i = a; i < b; ++i) s += static_cast<double>(x[i]) * x[i];
    return std::sqrt(s / (b - a));
}

}  // namespace messen
