// Welle 2 Slice 2.2 (Erhebung ~/messungen/2026-10-01-klickfrei, proto_blende/kante.h): gemeinsames Messinstrument
// "größter Sample-Sprung" für Kanten-Tests. Name nicht kante(n).h: include/cypherdj/kanten.h ist der JACK-Kanten-Abgleich (F05).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace sprung {
struct Mass {
  double d1 = 0.0, d2 = 0.0;
  int64_t ort1 = -1, ort2 = -1;
};
// größte erste |y[i] − y[i−1]| und zweite |y[i] − 2·y[i−1] + y[i−2]| Differenz für i in [von, bis)
inline Mass messe(const std::vector<float>& y, int64_t von, int64_t bis) {
  Mass m;
  for (int64_t i = std::max<int64_t>(von, 2); i < bis && i < (int64_t)y.size(); ++i) {
    const double a = std::fabs((double)y[i] - y[i - 1]);
    const double b = std::fabs((double)y[i] - 2.0 * y[i - 1] + y[i - 2]);
    if (a > m.d1) { m.d1 = a; m.ort1 = i; }
    if (b > m.d2) { m.d2 = b; m.ort2 = i; }
  }
  return m;
}
// natürlicher Höchstsprung eines Sinus der Amplitude amp bei f Hz und 48 kHz: amp · 2 · sin(π f / 48000)
inline double natuerlich(double f, double amp) { return amp * 2.0 * std::sin(M_PI * f / 48000.0); }
}  // namespace sprung
