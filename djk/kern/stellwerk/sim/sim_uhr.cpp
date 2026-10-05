// Simulierte Uhr nach SCHNITTSTELLEN §1.3.
#include "sim_uhr.h"

#include "cypherdj/stellwerk/typen.h"

namespace cypherdj::stellwerk {

SimUhr::SimUhr(double bpm) { seg_[0] = Seg{0.0, 0.0, bpm, 0.0}; }

void SimUhr::setze(double bpm) {
  n_ = 1;
  seg_[0] = Seg{0.0, 0.0, bpm, 0.0};
}

const SimUhr::Seg& SimUhr::seg_s(double s) const {
  int i = n_ - 1;
  while (i > 0 && seg_[i].s0 > s) i--;
  return seg_[i];
}

const SimUhr::Seg& SimUhr::seg_b(double b) const {
  int i = n_ - 1;
  while (i > 0 && seg_[i].b0 > b) i--;
  return seg_[i];
}

double SimUhr::beat_d(double s) const {
  const Seg& g = seg_s(s);
  const double dt = (s - g.s0) / SR;
  return g.b0 + (g.bpm0 * dt + g.k * dt * dt / 2.0) / 60.0;
}

double SimUhr::bpm_d(double s) const {
  const Seg& g = seg_s(s);
  return g.bpm0 + g.k * (s - g.s0) / SR;
}

double SimUhr::sample_genau(double b) const {
  const Seg& g = seg_b(b);
  const double d = b - g.b0;
  return g.s0 + SR * 120.0 * d / (g.bpm0 + std::sqrt(g.bpm0 * g.bpm0 + 120.0 * g.k * d));
}

void SimUhr::konstant_ab(int64_t sample, double bpm) {
  const double s = static_cast<double>(sample);
  const double b = beat_d(s);
  while (n_ > 1 && seg_[n_ - 1].s0 >= s) n_--;
  if (n_ == 1 && seg_[0].s0 >= s) n_ = 0;
  seg_[n_++] = Seg{s, b, bpm, 0.0};
}

bool SimUhr::rampe(double ab_beat, double ziel_bpm, double dauer_beats) {
  const double s0 = sample_genau(ab_beat);
  const double bpm0 = bpm_d(s0);
  const double t = dauer_beats * 60.0 / ((bpm0 + ziel_bpm) / 2.0);
  const double k = (ziel_bpm - bpm0) / t;
  int n = n_;
  while (n > 1 && seg_[n - 1].s0 >= s0) n--;
  if (n + 2 > 64) return false;
  n_ = n;
  seg_[n_++] = Seg{s0, ab_beat, bpm0, k};
  seg_[n_++] = Seg{s0 + t * SR, ab_beat + dauer_beats, ziel_bpm, 0.0};
  return true;
}

}  // namespace cypherdj::stellwerk
