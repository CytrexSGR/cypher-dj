// Vergleichsmessung im selben Lauf: der Faust-LR8 aus Dossier 04 (mono, Glättung Ordnung 1),
// der die Zahl 04 §4.8 (5,4 bis 10,9 µs) erzeugt hat, mit derselben Zeitmessung wie kosten.cpp.
// Wird nur gebaut, wenn proben/04-mixer-effekte/build/gen_iso_lr8_double.h auf der Platte liegt.
#include <faust/dsp/dsp.h>
#include <faust/gui/MapUI.h>
#include <faust/gui/meta.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <vector>

#include "gen_iso_lr8_double.h"

int main() {
    const int n = 256, bloecke = 3750, vorlauf = 188;
    mydsp d;
    d.init(48000);
    std::vector<float> x(static_cast<std::size_t>(bloecke + vorlauf) * n), y(n);
    unsigned s = 1;
    for (float& v : x) { s = s * 1664525u + 1013904223u; v = static_cast<float>(0.2 * ((s >> 8) * (1.0 / 16777216.0) - 0.5)); }
    std::vector<double> us;
    for (int b = 0; b < bloecke + vorlauf; ++b) {
        float* in[1] = {&x[static_cast<std::size_t>(b) * n]};
        float* out[1] = {y.data()};
        const auto t0 = std::chrono::steady_clock::now();
        d.compute(n, in, out);
        const auto t1 = std::chrono::steady_clock::now();
        if (b >= vorlauf) us.push_back(std::chrono::duration<double, std::micro>(t1 - t0).count());
    }
    std::sort(us.begin(), us.end());
    double summe = 0.0;
    for (double v : us) summe += v;
    std::printf("faust_lr8_mono bloecke=%zu median_us=%.3f p99_us=%.3f max_us=%.3f mittel_us=%.3f\n", us.size(),
                us[us.size() / 2], us[static_cast<std::size_t>(us.size() * 0.99)], us.back(), summe / us.size());
    return 0;
}
