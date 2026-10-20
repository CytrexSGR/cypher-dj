// D1 K1 Slice 7: Metronom des Moduls Arrangement (Spec D1 2.6). Eigener Klick-Renderer auf ganzen Projekt-Beats (nicht
// Kern-Beats wie der Prüfklick), Betonung bei p mod 4 == 0 mit dem vollen Pegel, sonst halber Pegel; Pegel aus pegel_db.
// Klickform wie der Prüfklick (klick.h: 2 kHz, abklingend, 96 Samples). Ziel 0 master: in die Master-Summe VOR dem
// Limiter; Ziel 1 cue: in die PFL-Summe. Gesperrt (Prüfmodus, Render): klingt nicht.
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace {
constexpr double EPS = 1e-9;
}  // namespace

void Arrangement::klick_form_bauen() {
  for (int i = 0; i < ARR_KLICK_LAENGE; ++i)
    klick_form_[i] = static_cast<float>(std::exp(-i / 12.0) * std::cos(2.0 * M_PI * 2000.0 * i / 48000.0));
}

void Arrangement::metronom(bool an, float pegel_db, int ziel) {
  metro_an_ = an;
  metro_g_ = std::pow(10.0f, pegel_db / 20.0f);
  metro_ziel_ = ziel == 1 ? 1 : 0;
  geaendert_ = true;
}

void Arrangement::metronom_segment(const Karte& k, int64_t a, int64_t b, int64_t s0) {
  int64_t einsatz[8];
  float pegel[8];
  int n = 0;
  if (status_ == ArrStatus::spielt && metro_an_ && !metronom_gesperrt_) {
    const double p_lo = projekt_beat(k, static_cast<double>(a) - 0.5);
    const double p_hi = projekt_beat(k, static_cast<double>(b) - 0.5);
    for (double p = std::ceil(p_lo - EPS); p < p_hi && n < 8; p += 1.0) {
      if (klammer() && p >= bis_) break;
      const int64_t s = sample_von_p(k, p, ursprung_);
      if (s < a || s >= b) continue;
      einsatz[n] = s;
#ifdef CYPHERDJ_MUTATION_ARR_METRONOM_KERN_TAKT
      const double kt = k.beat_at(static_cast<double>(s));   // Fehlerfall: Betonung nach dem Kern-Takt wie der Prüfklick
      pegel[n++] = std::fabs(kt - 4.0 * std::round(kt / 4.0)) < 1e-6 ? metro_g_ : 0.5f * metro_g_;
#else
      pegel[n++] = std::fabs(p - 4.0 * std::floor(p / 4.0 + EPS)) < 1e-6 ? metro_g_ : 0.5f * metro_g_;
#endif
    }
  }
  if (!metro_l_ || !metro_r_) return;
  int j = 0;
  for (int64_t t = a; t < b; ++t) {
    while (j < n && einsatz[j] == t) {
      klick_rest_ = ARR_KLICK_LAENGE;
      klick_pegel_ = pegel[j++];
    }
    if (klick_rest_ > 0) {
      const float v = klick_pegel_ * klick_form_[ARR_KLICK_LAENGE - klick_rest_];
      metro_l_[t - s0] += v;
      metro_r_[t - s0] += v;
      --klick_rest_;
    }
  }
}

}  // namespace cdj
