// Kosten je Kanal (Stereo) und Block (256 Frames) von Kanalzug::verarbeite().
//   kosten <leer|ruhend|faehrt> [bloecke=3750]
// leer:   nur die Zeitmessung um eine Kopie (Nulllauf, Negativ-Kontrolle des Instruments)
// ruhend: alle Regler stehen (Trim 0, Fader 0, EQ 0, Filter 0), der häufige Fall
// faehrt: EQ, Kill, Filter, Fader und Send fahren fast in jedem Block (schlechter Fall)
// Ausgabe eine Zeile: szenario bloecke median_us p99_us max_us mittel_us
// Nur unter flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" messen (werkzeuge/kosten.sh).
#include <cypherdj/dsp/kanalzug.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    using namespace cypherdj::dsp;
    if (argc < 2) { std::fprintf(stderr, "kosten <leer|ruhend|faehrt> [bloecke]\n"); return 2; }
    const std::string sz = argv[1];
    if (sz != "leer" && sz != "ruhend" && sz != "faehrt") { std::fprintf(stderr, "unbekannt: %s\n", argv[1]); return 2; }
    const int bloecke = argc > 2 ? std::atoi(argv[2]) : 3750;  // 3750 · 256 = 20 s wie 04 §4.8
    const int vorlauf = 188;                                     // 1 s ungezählt
    const int n = 256;
    std::vector<float> x(static_cast<std::size_t>(bloecke + vorlauf) * n);
    unsigned s = 1;
    for (float& v : x) { s = s * 1664525u + 1013904223u; v = static_cast<float>(0.2 * ((s >> 8) * (1.0 / 16777216.0) - 0.5)); }
    auto kz = std::make_unique<Kanalzug>();
    kz->setze_sofort(Regler::trim, 0.0f);
    kz->setze_sofort(Regler::fader, 0.0f);
    std::vector<float> hl(n), hr(n), s1l(n), s1r(n);
    KanalzugAusgang aus;
    aus.haupt_l = hl.data();
    aus.haupt_r = hr.data();
    aus.send_l[0] = s1l.data();
    aus.send_r[0] = s1r.data();
    std::vector<double> us;
    us.reserve(bloecke);
    for (int b = 0; b < bloecke + vorlauf; ++b) {
        const float* in = &x[static_cast<std::size_t>(b) * n];
        if (sz == "faehrt") {
            if (b % 64 == 0) kz->setze(Regler::eq_tief, (b / 64) % 2 ? 0.0f : -26.0f);
            if (b % 32 == 16) kz->setze(Regler::kill_mitte, (b / 32) % 2 ? 1.0f : 0.0f);
            if (b % 60 == 0) kz->rampe(Regler::filter, (b / 60) % 2 ? 0.5f : -0.5f, 60 * n, Form::s_kurve);
            if (b % 30 == 0) kz->rampe(Regler::fader, (b / 30) % 2 ? 0.0f : -6.0f, 30 * n, Form::linear);
            if (b % 50 == 0) kz->rampe(Regler::send_1, (b / 50) % 2 ? -200.0f : 0.0f, 40 * n, Form::linear);
        }
        const auto t0 = std::chrono::steady_clock::now();
        if (sz == "leer") {
            std::memcpy(hl.data(), in, n * sizeof(float));
            std::memcpy(hr.data(), in, n * sizeof(float));
        } else {
            kz->verarbeite(in, in, n, aus);
        }
        const auto t1 = std::chrono::steady_clock::now();
        if (b >= vorlauf) us.push_back(std::chrono::duration<double, std::micro>(t1 - t0).count());
    }
    std::vector<double> t = us;
    std::sort(t.begin(), t.end());
    double summe = 0.0;
    for (double v : t) summe += v;
    std::printf("%s bloecke=%zu median_us=%.3f p99_us=%.3f max_us=%.3f mittel_us=%.3f\n", sz.c_str(), t.size(),
                t[t.size() / 2], t[static_cast<std::size_t>(t.size() * 0.99)], t.back(), summe / t.size());
    return 0;
}
