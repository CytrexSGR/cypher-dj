#include "cypherdj/dsp/analyse_baender.h"

#include <cmath>

namespace cypherdj::dsp {

AnalyseBaender::AnalyseBaender(const BaenderKoeff& k) {
  for (int b = 0; b < kBaender; ++b) {
    n_sek_[b] = k.band[b].n_sektionen;
    for (int s = 0; s < n_sek_[b]; ++s) {
      const double* c = k.band[b].sos[s];
      sek_[b][s] = {c[0] / c[3], c[1] / c[3], c[2] / c[3], c[4] / c[3], c[5] / c[3]};
    }
  }
  for (int s = 0; s < 2; ++s) {
    const double* c = k.k_filter.sos[s];
    ksek_[s] = {c[0] / c[3], c[1] / c[3], c[2] / c[3], c[4] / c[3], c[5] / c[3]};
  }
  zuruecksetzen(0);
}

void AnalyseBaender::zuruecksetzen(int64_t erstes_sample) {
  for (auto& band : z_)
    for (auto& sek : band)
      for (auto& kanal : sek) kanal[0] = kanal[1] = 0.0;
  for (auto& sek : kz_)
    for (auto& kanal : sek) kanal[0] = kanal[1] = 0.0;
  for (double& s : summe_band_) s = 0.0;
  summe_k_ = 0.0;
  spitze_ = 0.0f;
  int64_t rest = erstes_sample % kFenster;
  if (rest < 0) rest += kFenster;
  im_fenster_ = static_cast<int>(rest);
}

// Eine Biquad-Sektion in Direktform II transponiert, dieselbe Rechenfolge wie scipy.signal.sosfilt.
static inline double biquad(double x, double b0, double b1, double b2, double a1, double a2, double* z) {
  const double y = b0 * x + z[0];
  z[0] = b1 * x - a1 * y + z[1];
  z[1] = b2 * x - a2 * y;
  return y;
}

int AnalyseBaender::verarbeite(const float* l, const float* r, int n, HuellenWerte* aus, int max_aus) {
  int geschrieben = 0;
  bool ueberlauf = false;
  for (int i = 0; i < n; ++i) {
    const double x[2] = {static_cast<double>(l[i]), static_cast<double>(r[i])};
    const float a = std::fmax(std::fabs(l[i]), std::fabs(r[i]));
    if (a > spitze_) spitze_ = a;
    for (int c = 0; c < 2; ++c) {
      double y = x[c];
      for (int s = 0; s < 2; ++s) {
        const Sektion& q = ksek_[s];
        y = biquad(y, q.b0, q.b1, q.b2, q.a1, q.a2, kz_[s][c]);
      }
      summe_k_ += y * y;
      for (int b = 0; b < kBaender; ++b) {
        double v = x[c];
        for (int s = 0; s < n_sek_[b]; ++s) {
          const Sektion& q = sek_[b][s];
          v = biquad(v, q.b0, q.b1, q.b2, q.a1, q.a2, z_[b][s][c]);
        }
        summe_band_[b] += v * v;
      }
    }
    if (++im_fenster_ == kFenster) {
      if (geschrieben < max_aus) {
        HuellenWerte& h = aus[geschrieben++];
        for (int b = 0; b < kBaender; ++b) h.band[b] = static_cast<float>(std::sqrt(summe_band_[b] / (2 * kFenster)));
        h.k_leistung = static_cast<float>(summe_k_ / kFenster);
        h.spitze = spitze_;
        h.ende_offset = i;
      } else {
        ueberlauf = true;
      }
      for (double& s : summe_band_) s = 0.0;
      summe_k_ = 0.0;
      spitze_ = 0.0f;
      im_fenster_ = 0;
    }
  }
  // Denormalisierte Zahlen vermeiden (Zustände klingen nach Stille ab): winzige Zustände auf 0.
  // Beitrag unter 1e-30 (-600 dB), ändert keinen float32-Wert eines Datensatzes.
  for (auto& band : z_)
    for (auto& sek : band)
      for (auto& kanal : sek)
        for (double& v : kanal)
          if (std::fabs(v) < 1e-30) v = 0.0;
  for (auto& sek : kz_)
    for (auto& kanal : sek)
      for (double& v : kanal)
        if (std::fabs(v) < 1e-30) v = 0.0;
  return ueberlauf ? -1 : geschrieben;
}

}  // namespace cypherdj::dsp
