#include "cypherdj/dsp/pegel_messer.h"

#include <cmath>

#include "ebur128.h"

namespace cypherdj::dsp {

// Ohne EBUR128_MODE_I und ohne LRA: dann ruft ebur128_add_frames_float nie malloc
// (ebur128.c: calc_gating_block nur mit MODE_I; Nachprüfung 04 K3: Standardmodus mit I 5997 malloc in 10 min).
static constexpr int kModus = EBUR128_MODE_S | EBUR128_MODE_TRUE_PEAK;

float in_db(double linear) {
  if (!(linear > 0.0)) return kStummDb;
  const double db = 20.0 * std::log10(linear);
  return db <= -120.0 ? kStummDb : static_cast<float>(db);
}

float leistung_in_db(double leistung) {
  if (!(leistung > 0.0)) return kStummDb;
  const double db = 10.0 * std::log10(leistung);
  return db <= -120.0 ? kStummDb : static_cast<float>(db);
}

PegelMesser::PegelMesser() : st_(ebur128_init(2, 48000, kModus)), spitze_(0.0f), echtspitze_(0.0), n_iso_(0) {
  for (double& s : summe_iso_) s = 0.0;
}

PegelMesser::~PegelMesser() {
  if (st_) ebur128_destroy(&st_);
}

void PegelMesser::verarbeite(const float* l, const float* r, int n, const IsoBaender* iso) {
  if (!st_) return;
  for (int anfang = 0; anfang < n; anfang += kMesserMaxBlock) {
    const int k = (n - anfang) < kMesserMaxBlock ? (n - anfang) : kMesserMaxBlock;
    for (int i = 0; i < k; ++i) {
      const float a = l[anfang + i], b = r[anfang + i];
      verschraenkt_[2 * i] = a;
      verschraenkt_[2 * i + 1] = b;
      const float m = std::fmax(std::fabs(a), std::fabs(b));
      if (m > spitze_) spitze_ = m;
    }
    ebur128_add_frames_float(st_, verschraenkt_, static_cast<size_t>(k));
    for (unsigned c = 0; c < 2; ++c) {
      double tp = 0.0;
      if (ebur128_prev_true_peak(st_, c, &tp) == EBUR128_SUCCESS && tp > echtspitze_) echtspitze_ = tp;
    }
  }
  if (iso) {
    const float* const* baender[3] = {iso->tief, iso->mitte, iso->hoch};
    for (int b = 0; b < 3; ++b)
      for (int c = 0; c < 2; ++c)
        for (int i = 0; i < n; ++i) {
          const double v = baender[b][c][i];
          summe_iso_[b] += v * v;
        }
    n_iso_ += n;
  }
}

PegelWerte PegelMesser::schnappschuss() {
  PegelWerte w{kStummDb, kStummDb, kStummDb, kStummDb, kStummDb, kStummDb, kStummDb};
  if (!st_) return w;
  double m = -HUGE_VAL, s = -HUGE_VAL;
  ebur128_loudness_momentary(st_, &m);
  ebur128_loudness_shortterm(st_, &s);
  w.spitze_db = in_db(spitze_);
  w.echtspitze_dbtp = in_db(echtspitze_);
  w.lufs_m = (std::isfinite(m) && m > -120.0) ? static_cast<float>(m) : kStummDb;
  w.lufs_s = (std::isfinite(s) && s > -120.0) ? static_cast<float>(s) : kStummDb;
  if (n_iso_ > 0) {
    // RMS über beide Kanäle: Leistung gemittelt über 2 * n Samples
    w.band_tief_db = leistung_in_db(summe_iso_[0] / (2.0 * n_iso_));
    w.band_mitte_db = leistung_in_db(summe_iso_[1] / (2.0 * n_iso_));
    w.band_hoch_db = leistung_in_db(summe_iso_[2] / (2.0 * n_iso_));
  }
  spitze_ = 0.0f;
  echtspitze_ = 0.0;
  for (double& x : summe_iso_) x = 0.0;
  n_iso_ = 0;
  return w;
}

}  // namespace cypherdj::dsp
