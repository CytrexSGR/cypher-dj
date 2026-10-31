// Paket 1.13 Warp, Slice 5 (Prüfung r1 M2, D9): Klick-Lage nach der Hüllkurve, unabhängig von der Trägerphase.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace lagetest {

// Mitte des Klicks nahe `soll` (Sample-Koordinate der Mitte, Klick von 144 Samples hat seine Mitte bei Anfang + 71,5): Spitze der über 48 Samples
// summierten Beträge im Fenster +-radius, parabolisch verfeinert. Das Fenster [s-24, s+24) hat seine Mitte bei s - 0,5. -1e9: kein Klick.
inline double huelle_mitte(const std::vector<float>& l, double soll, int radius = 300) {
  const int64_t c = std::llround(soll);
  std::vector<double> e;
  double beste = -1.0;
  int64_t bs = 0;
  for (int64_t s = c - radius; s <= c + radius; ++s) {
    double x = 0.0;
    for (int i = -24; i < 24; ++i) {
      const int64_t j = s + i;
      if (j >= 0 && j < static_cast<int64_t>(l.size())) x += std::fabs(static_cast<double>(l[static_cast<size_t>(j)]));
    }
    e.push_back(x);
    if (x > beste) {
      beste = x;
      bs = s;
    }
  }
  if (beste < 1e-3) return -1e9;
  const size_t ix = static_cast<size_t>(bs - (c - radius));
  const double davor = ix > 0 ? e[ix - 1] : beste, danach = ix + 1 < e.size() ? e[ix + 1] : beste;
  const double nenner = davor - 2.0 * beste + danach;
  return static_cast<double>(bs) - 0.5 + (nenner != 0.0 ? 0.5 * (davor - danach) / nenner : 0.0);
}

struct Ergebnis {
  bool ok = true;
  double max_abs = 0.0, steigung_je_16 = 0.0;
};

// Klicks von_klick bis bis_klick; soll(k) = erwartete Mitte des k-ten Klicks in Sample-Koordinaten von `l`.
template <class F>
Ergebnis messen(const std::vector<float>& l, int von_klick, int bis_klick, F soll) {
  Ergebnis g;
  std::vector<double> xs, ys;
  for (int k = von_klick; k <= bis_klick; ++k) {
    const double s = soll(k), ist = huelle_mitte(l, s);
    if (ist < -1e8) {
      g.ok = false;
      continue;
    }
    xs.push_back(k);
    ys.push_back(ist - s);
    g.max_abs = std::max(g.max_abs, std::fabs(ist - s));
  }
  if (xs.size() < 2) {
    g.ok = false;
    return g;
  }
  double mx = 0, my = 0, sxy = 0, sxx = 0;
  for (size_t i = 0; i < xs.size(); ++i) { mx += xs[i]; my += ys[i]; }
  mx /= static_cast<double>(xs.size());
  my /= static_cast<double>(xs.size());
  for (size_t i = 0; i < xs.size(); ++i) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
  g.steigung_je_16 = 16.0 * sxy / sxx;
  return g;
}

// Eichung: der Messer an synthetischen Hann-Klicks (144 Samples) mit Träger 500 / 1000 / 1498,3 / 2000 Hz in vier Trägerphasen, Lage-Versätze bis +-30 Samples
// (auch gebrochen). Rückgabe: der größte Fehler in Samples = die Unschärfe u des Messers; Gates für pitch != 1 sind LAGE_GRENZE + u.
inline double eichung() {
  const double offs[8] = {-30.0, -17.5, -4.0, 0.0, 3.25, 11.0, 26.0, 30.0};
  double u = 0.0;
  for (double hz : {500.0, 1000.0, 1498.3070768766815, 2000.0})
    for (int ph = 0; ph < 4; ++ph) {
      std::vector<float> l(200000, 0.0f);
      for (int k = 0; k < 8; ++k) {
        const double start = 10000.0 + 20000.0 * k + offs[k];
        for (int64_t j = static_cast<int64_t>(std::floor(start)); j < static_cast<int64_t>(std::floor(start)) + 146; ++j) {
          const double t = static_cast<double>(j) - start;
          if (t < 0.0 || t > 143.0) continue;
          l[static_cast<size_t>(j)] = static_cast<float>(0.5 * std::sin(2.0 * M_PI * hz * t / 48000.0 + ph * M_PI / 2.0) * 0.5 * (1.0 - std::cos(2.0 * M_PI * t / 143.0)));
        }
      }
      for (int k = 0; k < 8; ++k) {
        const double nominal = 10000.0 + 20000.0 * k + 71.5;
        const double ist = huelle_mitte(l, nominal);
        u = ist < -1e8 ? 1e9 : std::max(u, std::fabs(ist - (nominal + offs[k])));
      }
    }
  return u;
}

}  // namespace lagetest
