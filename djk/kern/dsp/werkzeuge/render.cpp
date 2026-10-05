// Rendert Knack-Szenarien als float-WAV (mono, 48 kHz) für tests/knack.py.
// Reiz wie proben/04-mixer-effekte/reize.py: 780-Hz-Sinus, Amplitude 0,5, 6 s, 50 ms Einblendung.
// Ereignis am Blockanfang 563·256 = 144128 (3,002667 s), wie probe_a2_kill.sh (--at 3.0).
//   render <szenario> <aus.wav>
//   szenario: ohne | kill | fader_aus | filter | kill_verlauf_linear | kill_verlauf_o2
//   kill:                setze(kill_mitte, 1) mit der Schaltrampe der Bibliothek
//   kill_verlauf_linear: Kill-Verlauf von außen, linear über 5 ms (so fährt ein Stellwerk ohne S-Form)
//   kill_verlauf_o2:     Kill-Verlauf von außen, zwei Einpol-Glätter mit je 2,5 ms (04 §4.2 „Ordnung 2“)
#include <cypherdj/dsp/kanalzug.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {

bool schreibe_wav(const char* pfad, const std::vector<float>& x) {
    std::FILE* f = std::fopen(pfad, "wb");
    if (!f) return false;
    const std::uint32_t daten = static_cast<std::uint32_t>(x.size() * 4), rate = 48000;
    auto u32 = [&](std::uint32_t v) { std::fwrite(&v, 4, 1, f); };
    auto u16 = [&](std::uint16_t v) { std::fwrite(&v, 2, 1, f); };
    std::fwrite("RIFF", 1, 4, f); u32(36 + daten); std::fwrite("WAVE", 1, 4, f);
    std::fwrite("fmt ", 1, 4, f); u32(16); u16(3 /* IEEE float */); u16(1); u32(rate); u32(rate * 4); u16(4); u16(32);
    std::fwrite("data", 1, 4, f); u32(daten);
    std::fwrite(x.data(), 4, x.size(), f);
    return std::fclose(f) == 0;
}

}  // namespace

int main(int argc, char** argv) {
    using namespace cypherdj::dsp;
    if (argc != 3) { std::fprintf(stderr, "render <szenario> <aus.wav>\n"); return 2; }
    const std::string sz = argv[1];
    const bool verlauf = sz == "kill_verlauf_linear" || sz == "kill_verlauf_o2";
    if (sz != "ohne" && sz != "kill" && sz != "fader_aus" && sz != "filter" && !verlauf) {
        std::fprintf(stderr, "unbekanntes Szenario %s\n", argv[1]);
        return 2;
    }
    const int n = 6 * 48000, ereignis = 563 * 256, fade = 2400;
    const double pi = 3.14159265358979323846;
    std::vector<float> x(n), y(n), r(n);
    for (int i = 0; i < n; ++i) {
        double v = 0.5 * std::sin(2.0 * pi * 780.0 * i / 48000.0);
        if (i < fade) v *= 0.5 - 0.5 * std::cos(pi * i / fade);
        x[i] = static_cast<float>(v);
    }
    // Kill-Verlauf von außen je Sample (nur für die Verlauf-Szenarien): 0 vor dem Ereignis.
    std::vector<float> kv(n, 0.0f);
    if (verlauf) {
        const double p = std::exp(-1.0 / (0.0025 * 48000.0));
        double y1 = 0.0, y2 = 0.0;
        for (int i = ereignis; i < n; ++i) {
            if (sz == "kill_verlauf_linear") {
                kv[i] = static_cast<float>(std::min(1.0, (i - ereignis) / 240.0));
            } else {
                y1 = (1.0 - p) + p * y1;
                y2 = (1.0 - p) * y1 + p * y2;
                kv[i] = static_cast<float>(y2);
            }
        }
    }
    auto kz = std::make_unique<Kanalzug>();
    kz->setze_sofort(Regler::trim, 0.0f);
    kz->setze_sofort(Regler::fader, 0.0f);
    for (int p = 0; p < n; p += 256) {
        if (p == ereignis) {
            if (sz == "kill") kz->setze(Regler::kill_mitte, 1.0f);
            else if (sz == "fader_aus") kz->setze(Regler::fader, -200.0f);
            else if (sz == "filter") kz->setze(Regler::filter, -0.5f);
        }
        if (verlauf) kz->verlauf(Regler::kill_mitte, &kv[p]);
        KanalzugAusgang aus;
        aus.haupt_l = &y[p];
        aus.haupt_r = &r[p];
        kz->verarbeite(&x[p], &x[p], std::min(256, n - p), aus);
    }
    if (!schreibe_wav(argv[2], y)) { std::fprintf(stderr, "kann %s nicht schreiben\n", argv[2]); return 1; }
    return 0;
}
