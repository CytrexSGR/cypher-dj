#include "cypherdj/dsp/master_limiter.h"

#include <cmath>

namespace cypherdj::dsp {

static constexpr int kA_Taps = 49;
static constexpr int kB_Taps = MasterLimiter::kB_Phasen * MasterLimiter::kB_Abgriffe;  // 192
static constexpr double kB_Beta = 6.0;

MasterLimiter::MasterLimiter(const LimiterEinstellung& e) {
  // (a) wie libebur128 interp_create(49, 4, ...): Sinc mit Hann-Fenster, Nullen weggelassen.
  for (int f = 0; f < kA_Phasen; ++f) a_n_[f] = 0;
  for (int j = 0; j < kA_Taps; ++j) {
    const double m = static_cast<double>(j) - (kA_Taps - 1) / 2.0;
    double c = 1.0;
    if (std::fabs(m) > 1e-10) c = std::sin(m * M_PI / kA_Phasen) / (m * M_PI / kA_Phasen);
    c *= 0.5 * (1.0 - std::cos(2.0 * M_PI * j / (kA_Taps - 1)));
    if (std::fabs(c) > 1e-10) {
      const int f = j % kA_Phasen;
      a_koeff_[f][a_n_[f]] = c;
      a_index_[f][a_n_[f]] = j / kA_Phasen;
      ++a_n_[f];
    }
  }
  // (b) Kaiser-Sinc, Grenzfrequenz 24 kHz, Summe der Koeffizienten = 8 (Gleichanteil 1 je Phase).
  double h[kB_Taps], summe = 0.0;
  const double i0_beta = std::cyl_bessel_i(0.0, kB_Beta);
  for (int j = 0; j < kB_Taps; ++j) {
    const double m = (j - (kB_Taps - 1) / 2.0) / kB_Phasen;
    const double sinc = std::fabs(m) < 1e-12 ? 1.0 : std::sin(M_PI * m) / (M_PI * m);
    const double r = 2.0 * j / (kB_Taps - 1) - 1.0;
    const double w = std::cyl_bessel_i(0.0, kB_Beta * std::sqrt(1.0 - r * r)) / i0_beta;
    h[j] = sinc * w;
    summe += h[j];
  }
  for (int j = 0; j < kB_Taps; ++j) b_koeff_[j % kB_Phasen][j / kB_Phasen] = static_cast<float>(h[j] * kB_Phasen / summe);

  // Rundungsreserve: Erkennung (a) und Messgerät (libebur128) rechnen mit demselben Interpolator; ohne Reserve
  // landet ein stehender Sinus auf -1,000000 und Rauschen bei -0,99996 dBTP (Probe plan-14, 2026-09-23).
  // Gitterreserve: (b) sieht die Kurve nur alle 1/8 Sample; ein Sinus bei 20 kHz kann zwischen zwei Gitterpunkten
  // um -20*log10(cos(pi * 20000 / (8 * 48000))) = 0,119 dB höher liegen (Probe: ohne Gitterreserve MFB +6 dB
  // 8-fach -0,958, 32-fach -0,963 dBTP).
  const double gitter_db = -20.0 * std::log10(std::cos(M_PI * 20000.0 / (kB_Phasen * 48000.0)));
  decke_ = static_cast<float>(std::pow(10.0, (e.decke_dbtp - kRundungsReserveDb - gitter_db) / 20.0));
  anstieg_ = e.anstieg < 1 ? 1 : e.anstieg;
  halten_ = e.halten < 0 ? 0 : e.halten;
  if (anstieg_ + 2 * halten_ + 1 > kMaxFenster) {  // ausserhalb der Grenzen: auf Vorgabe zurück
    anstieg_ = 64;
    halten_ = 8;
  }
  fenster_ = anstieg_ + 2 * halten_ + 1;
  vorhalt_ = anstieg_ + halten_ + kInterpVerzug;
  abkling_koeff_ = 1.0 - std::exp(-1.0 / (static_cast<double>(e.abklingen_ms) * 0.001 * 48000.0));
  zuruecksetzen();
}

void MasterLimiter::zuruecksetzen() {
  for (auto& k : a_z_)
    for (float& v : k) v = 0.0f;
  a_zi_ = 0;
  for (float& v : a_nachzug_) v = 0.0f;
  a_nachzug_pos_ = 0;
  for (auto& k : b_verlauf_)
    for (float& v : k) v = 0.0f;
  b_pos_ = 0;
  min_kopf_ = min_ende_ = min_n_ = 0;
  zeit_ = 0;
  h_rel_ = 1.0;
  for (float& v : mittel_ring_) v = 1.0f;
  mittel_pos_ = 0;
  mittel_summe_ = anstieg_ + 1;
  unter_eins_ = 0;
  for (auto& k : verz_)
    for (float& v : k) v = 0.0f;
  verz_pos_ = 0;
  kleinste_verstaerkung_ = 1.0f;
}

float MasterLimiter::naechste_verstaerkung(float xl, float xr) {
  // 1a. Echtspitze wie libebur128 (Zeiten n - 6 + f/4), um 6 Schritte nachgezogen
  a_z_[0][a_zi_] = xl;
  a_z_[1][a_zi_] = xr;
  float spitze_a = 0.0f;
  for (int c = 0; c < 2; ++c)
    for (int f = 0; f < kA_Phasen; ++f) {
      double acc = 0.0;
      for (int t = 0; t < a_n_[f]; ++t) {
        int i = a_zi_ - a_index_[f][t];
        if (i < 0) i += kA_Abgriffe;
        acc += static_cast<double>(a_z_[c][i]) * a_koeff_[f][t];
      }
      const float v = std::fabs(static_cast<float>(acc));
      if (v > spitze_a) spitze_a = v;
    }
  if (++a_zi_ == kA_Abgriffe) a_zi_ = 0;
  const float spitze_a_nach = a_nachzug_[a_nachzug_pos_];
  a_nachzug_[a_nachzug_pos_] = spitze_a;
  if (++a_nachzug_pos_ == 6) a_nachzug_pos_ = 0;

  // 1b. Echtspitze 8-fach (Zeiten n - 12 + f/8, auf 1/16 Sample genau)
  b_pos_ = (b_pos_ == 0 ? kB_Abgriffe : b_pos_) - 1;
  b_verlauf_[0][b_pos_] = b_verlauf_[0][b_pos_ + kB_Abgriffe] = xl;
  b_verlauf_[1][b_pos_] = b_verlauf_[1][b_pos_ + kB_Abgriffe] = xr;
  float spitze_b = 0.0f;
  for (int c = 0; c < 2; ++c) {
    const float* w = &b_verlauf_[c][b_pos_];  // w[t] = x[n - t]
    for (int f = 0; f < kB_Phasen; ++f) {
      float acc = 0.0f;
      for (int t = 0; t < kB_Abgriffe; ++t) acc += b_koeff_[f][t] * w[t];
      const float v = std::fabs(acc);
      if (v > spitze_b) spitze_b = v;
    }
  }
  const float spitze = spitze_a_nach > spitze_b ? spitze_a_nach : spitze_b;

  // 2. nötige Verstärkung
  const float q = spitze > decke_ ? decke_ / spitze : 1.0f;

  // 3. gleitendes Minimum über fenster_ Werte (monotone Schlange im festen Ring)
  const int cap = kMaxFenster + 1;
  while (min_n_ > 0) {
    const int letzte = (min_ende_ - 1 + cap) % cap;
    if (min_wert_[letzte] >= q) {
      min_ende_ = letzte;
      --min_n_;
    } else {
      break;
    }
  }
  min_wert_[min_ende_] = q;
  min_pos_[min_ende_] = zeit_;
  min_ende_ = (min_ende_ + 1) % cap;
  ++min_n_;
  while (min_pos_[min_kopf_] <= zeit_ - fenster_) {
    min_kopf_ = (min_kopf_ + 1) % cap;
    --min_n_;
  }
  ++zeit_;
  const double h = min_wert_[min_kopf_];

  // 4. Abklingen: sofort nach unten, einpolig nach oben, nie über h
  if (h < h_rel_) {
    h_rel_ = h;
  } else {
    h_rel_ += (h - h_rel_) * abkling_koeff_;
    if (h - h_rel_ < 1e-7) h_rel_ = h;
  }

  // 5. gleitender Mittelwert über anstieg_ + 1 Werte; exakt 1, wenn alle Werte 1 sind
  const float neu = static_cast<float>(h_rel_);
  const float alt = mittel_ring_[mittel_pos_];
  mittel_ring_[mittel_pos_] = neu;
  if (++mittel_pos_ == anstieg_ + 1) mittel_pos_ = 0;
  if (alt < 1.0f) --unter_eins_;
  if (neu < 1.0f) ++unter_eins_;
  if (unter_eins_ == 0) {
    mittel_summe_ = anstieg_ + 1;
    return 1.0f;
  }
  mittel_summe_ += static_cast<double>(neu) - static_cast<double>(alt);
  return static_cast<float>(mittel_summe_ / (anstieg_ + 1));
}

void MasterLimiter::verarbeite(float* l, float* r, int n) {
  for (int i = 0; i < n; ++i) {
    const float xl = std::isfinite(l[i]) ? l[i] : 0.0f;
    const float xr = std::isfinite(r[i]) ? r[i] : 0.0f;
    const float g = naechste_verstaerkung(xl, xr);
    if (g < kleinste_verstaerkung_) kleinste_verstaerkung_ = g;
    // Verzögerung um vorhalt_ Samples
    const int lese = (verz_pos_ - vorhalt_ + (kMaxVorhalt + 1)) % (kMaxVorhalt + 1);
    verz_[0][verz_pos_] = xl;
    verz_[1][verz_pos_] = xr;
    l[i] = verz_[0][lese] * g;
    r[i] = verz_[1][lese] * g;
    if (++verz_pos_ == kMaxVorhalt + 1) verz_pos_ = 0;
  }
}

float MasterLimiter::groesste_absenkung_db() {
  const float db = static_cast<float>(20.0 * std::log10(static_cast<double>(kleinste_verstaerkung_)));
  kleinste_verstaerkung_ = 1.0f;
  return db;
}

}  // namespace cypherdj::dsp
