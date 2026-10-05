// Plan Tempo-Folge Task 4.1: umtasten() bringt einen Mitschnitt von n_ein auf n_aus Frames (Loop: mit Umlauf).
// Ein Sinus mit ganzer Periodenzahl bleibt ein Sinus derselben Periodenzahl; gleiche Länge ist die Identität.
// Dazu die Dauer des größten Falls: umtasten läuft im Netz-Faden, der auch /uhr und Quittungen trägt.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <vector>

#include "cypherdj/loop.h"
#include "pruef.h"

int main() {
  const double PI = 3.14159265358979323846;
  {  // 4 Beats bei 130 BPM (88 616 Frames) auf 4 Beats bei 128 (90 000): 800 Perioden bleiben 800 Perioden
    const int64_t n_ein = 88616, n_aus = 90000;
    std::vector<float> ein((size_t)n_ein * 2), aus((size_t)n_aus * 2, -9.0f);
    for (int64_t i = 0; i < n_ein; ++i) {
      ein[(size_t)(2 * i)] = (float)std::sin(2.0 * PI * 800.0 * (double)i / (double)n_ein);
      ein[(size_t)(2 * i + 1)] = -ein[(size_t)(2 * i)];
    }
    cdj::umtasten(ein.data(), n_ein, aus.data(), n_aus);
    double groesste = 0.0;
    for (int64_t j = 0; j < n_aus; ++j) {
      const double soll = std::sin(2.0 * PI * 800.0 * (double)j / (double)n_aus);
      groesste = std::max({groesste, std::fabs((double)aus[(size_t)(2 * j)] - soll),
                           std::fabs((double)aus[(size_t)(2 * j + 1)] + soll)});
    }
    std::printf("umtasten 88616 -> 90000: größte Abweichung %.6f (Soll < 0.001)\n", groesste);
    PRUEF(groesste < 1e-3);
  }
  {  // Abwärts (4 Beats bei 120 BPM = 96 000 Frames auf 90 000): derselbe Sinus, der Tiefpass darf ihn nicht dämpfen
    const int64_t n_ein = 96000, n_aus = 90000;
    std::vector<float> ein((size_t)n_ein * 2), aus((size_t)n_aus * 2);
    for (int64_t i = 0; i < n_ein; ++i)
      ein[(size_t)(2 * i)] = ein[(size_t)(2 * i + 1)] = (float)std::sin(2.0 * PI * 800.0 * (double)i / (double)n_ein);
    cdj::umtasten(ein.data(), n_ein, aus.data(), n_aus);
    double groesste = 0.0;
    for (int64_t j = 0; j < n_aus; ++j)
      groesste = std::max(groesste, std::fabs((double)aus[(size_t)(2 * j)] - std::sin(2.0 * PI * 800.0 * (double)j / (double)n_aus)));
    std::printf("umtasten 96000 -> 90000: größte Abweichung %.6f (Soll < 0.001)\n", groesste);
    PRUEF(groesste < 1e-3);
  }
  {  // Negativ-Kontrolle: gleiche Länge ist die Identität
    std::vector<float> ein = {0.1f, -0.1f, 0.5f, -0.5f, -0.3f, 0.3f, 0.0f, 0.0f}, aus(8, 9.0f);
    cdj::umtasten(ein.data(), 4, aus.data(), 4);
    for (size_t i = 0; i < 8; ++i) PRUEF_NAH(aus[i], ein[i], 1e-6);
  }
  {  // Dauer im ungünstigsten Fall: 32 Beats bei 60 BPM (1 536 000 Frames) auf 720 000
    const int64_t n_ein = 1536000, n_aus = 720000;
    std::vector<float> ein((size_t)n_ein * 2), aus((size_t)n_aus * 2);
    uint32_t z = 12345;
    for (float& x : ein) {
      z = z * 1664525u + 1013904223u;
      x = (float)((double)(z >> 8) / 8388608.0 - 1.0) * 0.5f;
    }
    const auto t0 = std::chrono::steady_clock::now();
    cdj::umtasten(ein.data(), n_ein, aus.data(), n_aus);
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    bool endlich = true;
    for (float x : aus) endlich = endlich && std::isfinite(x) && std::fabs(x) < 1.0f;
    std::printf("umtasten 1536000 -> 720000 (32 Beats, 60 BPM): %.0f ms (Soll < 400)\n", ms);
    PRUEF(endlich);
    PRUEF(ms < 400.0);
  }
  PRUEF_ENDE();
}
