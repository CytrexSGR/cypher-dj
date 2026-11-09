// Shared helpers for the hardening tests test_haertung_<modul>.cpp (cloud session "Haertung", 2026-11-02).
// Offline only (allocation allowed). Builds on check.h.
//
// Modes of every hardening test (first argument):
//   (none)        normal run: every check must hold, known-bug checks are skipped.
//   1             mutation run: the binary is linked against a deliberately broken variant of the module
//                 (see the "# --- Haertung (cloud) ---" block in CMakeLists.txt). The run passes only if at
//                 least one check marked PRUEF_M fails; ordinary PRUEF failures are printed but not counted.
//   befund_<name> runs only the check that exposes the known bug <name> (registered DISABLED in CMake, see
//                 REPORT-hardening.md); it fails as long as the bug is there.
#pragma once

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "check.h"

namespace haertung {

inline bool& mutationsmodus() { static bool m = false; return m; }
inline int& mutation_rot() { static int n = 0; return n; }
inline std::string& befund() { static std::string b; return b; }

// Parses the mode argument (see file head).
inline void starte(int argc, char** argv) {
    if (argc > 1) {
        const std::string a = argv[1];
        if (a == "1") mutationsmodus() = true;
        else if (a.rfind("befund_", 0) == 0) befund() = a;
    }
    if (mutationsmodus()) std::printf("mutation run: at least one PRUEF_M check must fail\n");
    if (!befund().empty()) std::printf("known-bug run: %s\n", befund().c_str());
}

// true if the check of known bug `name` should run (only in its own befund_ run).
inline bool befund_lauf(const char* name) { return befund() == std::string("befund_") + name; }
// true if the ordinary checks should run (not in a befund_ run).
inline bool normal_lauf() { return befund().empty(); }

inline int ende() {
    if (mutationsmodus()) {
        if (mutation_rot() > 0) {
            std::printf("OK: mutation detected by %d PRUEF_M check(s)\n", mutation_rot());
            return 0;
        }
        std::printf("FEHLER: mutation NOT detected, no PRUEF_M check failed\n");
        return 1;
    }
    return pruef::ende();
}

// Fixed-seed generator (xorshift64*), the same sequence on every platform.
struct Zufall {
    std::uint64_t s;
    explicit Zufall(std::uint64_t saat = 0x2026110201ULL) : s(saat ? saat : 1) {}
    std::uint64_t naechste() {
        s ^= s >> 12;
        s ^= s << 25;
        s ^= s >> 27;
        return s * 0x2545F4914F6CDD1DULL;
    }
    double gleich() { return static_cast<double>(naechste() >> 11) * (1.0 / 9007199254740992.0); }  // [0, 1)
    double zwischen(double a, double b) { return a + (b - a) * gleich(); }
    int ganz(int a, int b) { return a + static_cast<int>(naechste() % static_cast<std::uint64_t>(b - a + 1)); }  // [a, b]
};

inline std::vector<float> rauschen(int n, double amp, std::uint64_t saat) {
    Zufall z(saat);
    std::vector<float> x(static_cast<std::size_t>(n));
    for (float& v : x) v = static_cast<float>(z.zwischen(-amp, amp));
    return x;
}

inline std::vector<float> sinus(double f, double amp, int n, double fs) {
    std::vector<float> x(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) x[static_cast<std::size_t>(i)] = static_cast<float>(amp * std::sin(2.0 * 3.14159265358979323846 * f * i / fs));
    return x;
}

inline bool endlich(const float* x, std::size_t n) {
    for (std::size_t i = 0; i < n; ++i)
        if (!std::isfinite(x[i])) return false;
    return true;
}
inline bool endlich(const std::vector<float>& x) { return endlich(x.data(), x.size()); }

inline double spitze(const std::vector<float>& x, std::size_t a = 0, std::size_t b = SIZE_MAX) {
    double m = 0.0;
    for (std::size_t i = a; i < x.size() && i < b; ++i) m = std::fmax(m, std::fabs(static_cast<double>(x[i])));
    return m;
}

inline long subnormale(const float* x, std::size_t n) {
    long z = 0;
    for (std::size_t i = 0; i < n; ++i) z += std::fpclassify(x[i]) == FP_SUBNORMAL;
    return z;
}

// Largest absolute difference; 0 means bit-identical up to the sign of zero.
inline double groesste_abweichung(const std::vector<float>& a, const std::vector<float>& b) {
    if (a.size() != b.size()) return INFINITY;
    double m = 0.0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        if (std::isnan(a[i]) != std::isnan(b[i])) return INFINITY;
        m = std::fmax(m, std::fabs(static_cast<double>(a[i]) - static_cast<double>(b[i])));
    }
    return m;
}

inline double db(double lin) { return lin > 0.0 ? 20.0 * std::log10(lin) : -400.0; }

// Click metric of 04 §4.2 / tests/knack.py in C++: 4th-order Butterworth high-pass at 5 kHz, applied forward and
// backward (zero phase), peak in the window [a, b) in dBFS. Threshold: the 16-bit step, -96.33 dBFS
// (04 §4.3, INTERFACES §1.3). Stimulus as in 04 §4.2: 780 Hz at -6 dBFS.
inline constexpr double kKnackSchwelleDbfs = -96.32959861247399;  // 20·log10(2^-16)
inline constexpr double kKnackReizHz = 780.0;
inline constexpr double kKnackReizAmp = 0.5011872336272722;      // -6 dBFS

inline double knack_spitze_dbfs(const std::vector<float>& x, double fs, std::size_t a, std::size_t b) {
    const double pi = 3.14159265358979323846;
    const double qs[2] = {1.0 / (2.0 * std::sin(pi / 8.0)), 1.0 / (2.0 * std::sin(3.0 * pi / 8.0))};
    std::vector<double> y(x.begin(), x.end());
    auto durchgang = [&](bool rueckwaerts) {
        for (double q : qs) {
            const double k = std::tan(pi * 5000.0 / fs);
            const double norm = 1.0 / (1.0 + k / q + k * k);
            const double b0 = norm, b1 = -2.0 * norm, b2 = norm;
            const double a1 = 2.0 * (k * k - 1.0) * norm, a2 = (1.0 - k / q + k * k) * norm;
            double z1 = 0.0, z2 = 0.0;
            const std::size_t n = y.size();
            for (std::size_t j = 0; j < n; ++j) {
                double& v = y[rueckwaerts ? n - 1 - j : j];
                const double o = b0 * v + z1;
                z1 = b1 * v - a1 * o + z2;
                z2 = b2 * v - a2 * o;
                v = o;
            }
        }
    };
    durchgang(false);
    durchgang(true);
    double m = 0.0;
    for (std::size_t i = a; i < b && i < y.size(); ++i) m = std::fmax(m, std::fabs(y[i]));
    return db(m);
}

inline constexpr double kRaten[3] = {44100.0, 48000.0, 96000.0};

}  // namespace haertung

// Like PRUEF, but this check is a mutation detector: in a mutation run its failure is the expected outcome.
#define PRUEF_M(bed)                                                                              \
    do {                                                                                          \
        if (haertung::mutationsmodus()) {                                                         \
            if (!(bed)) {                                                                         \
                std::printf("%s:%d: PRUEF_M(%s) red (mutation detected)\n", __FILE__, __LINE__, #bed); \
                ++haertung::mutation_rot();                                                       \
            }                                                                                     \
        } else {                                                                                  \
            PRUEF(bed);                                                                           \
        }                                                                                         \
    } while (0)
