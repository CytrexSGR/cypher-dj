#include "cypherdj/klick.h"

#include <cmath>

namespace cdj {

Klick::Klick() {
  for (int i = 0; i < KLICK_LAENGE; ++i)
    form_[i] = (float)(std::exp(-i / 12.0) * std::cos(2.0 * M_PI * 2000.0 * i / 48000.0));
}

int Klick::block(const Karte& k, int64_t n0, int n, float* links, float* rechts, KlickEinsatz* einsaetze, int max) {
  // Einsätze in diesem Block: ganze Beats b mit llround(sample_at(b)) in [n0, n0 + n),
  // also sample_at(b) in [n0 - 0,5; n0 + n - 0,5) (Vorlage uhrkern.cpp, Schritt 2).
  int anzahl = 0;
  int versatz[8];
  float pegel[8];
  if (aktiv_) {
    const double b_lo = k.beat_at((double)n0 - 0.5);
    const double b_hi = k.beat_at((double)(n0 + n) - 0.5);
    for (double b = std::ceil(b_lo); b < b_hi && anzahl < 8; b += 1.0) {
      const int64_t s = std::llround(k.sample_at(b));
      if (s < n0 || s >= n0 + n) continue;
#ifdef CYPHERDJ_MUTATION_KLICK_BLOCKANFANG
      versatz[anzahl] = 0;  // Mutation für den Fehlerfall: Klick auf den Blockanfang statt auf das Sample
#else
      versatz[anzahl] = (int)(s - n0);
#endif
      pegel[anzahl] = (schlag_im_takt(b) == 1) ? KLICK_PEGEL_EINS : KLICK_PEGEL;
      if (anzahl < max) einsaetze[anzahl] = KlickEinsatz{b, s};
      ++anzahl;
    }
  }
  int j = 0;
  for (int t = 0; t < n; ++t) {
    while (j < anzahl && versatz[j] == t) { rest_ = KLICK_LAENGE; pegel_ = pegel[j]; ++j; }
    if (rest_ > 0) {
      const float v = pegel_ * form_[KLICK_LAENGE - rest_];
      links[t] += v;
      rechts[t] += v;
      --rest_;
    }
  }
  return anzahl < max ? anzahl : max;
}

}  // namespace cdj
