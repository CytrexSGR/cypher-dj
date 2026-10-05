#include "cypherdj/uhr.h"

namespace cdj {

void Karte::neu(double start_bpm, int64_t s0) {
  seg_[0] = Segment{s0, 0.0, start_bpm, 0.0, INFINITY};
  n_ = 1;
}

int Karte::index_sample(double s) const {
  int i = 0;
  while (i + 1 < n_ && (double)seg_[i + 1].s0 <= s) ++i;
  return i;
}

int Karte::index_beat(double b) const {
  int i = 0;
  while (i + 1 < n_ && seg_[i + 1].b0 <= b) ++i;
  return i;
}

double Karte::beat_im(const Segment& g, double s) {
  const double dt = (s - (double)g.s0) / RATE;
  return g.b0 + (g.bpm0 * dt + 0.5 * g.k * dt * dt) / 60.0;
}

double Karte::sample_im(const Segment& g, double b) {
  const double db = b - g.b0;
  const double dt = 120.0 * db / (g.bpm0 + std::sqrt(g.bpm0 * g.bpm0 + 120.0 * g.k * db));
  return (double)g.s0 + dt * RATE;
}

double Karte::beat_at(double s) const { return beat_im(seg_[index_sample(s)], s); }
double Karte::sample_at(double b) const { return sample_im(seg_[index_beat(b)], b); }

double Karte::bpm_at(double s) const {
  const Segment& g = seg_[index_sample(s)];
  return g.bpm0 + g.k * (s - (double)g.s0) / RATE;
}

double Karte::k_at(double s) const { return seg_[index_sample(s)].k; }

bool Karte::rampe(double ab_beat, double ziel_bpm, double dauer_beats) {
  if (!(dauer_beats > 0.0) || !(ziel_bpm > 0.0)) return false;
  const int64_t s0 = std::llround(sample_at(ab_beat));
  const double b0 = beat_at((double)s0);
  const double bpm0 = bpm_at((double)s0);
  const double b_ende = ab_beat + dauer_beats;  // Ende-Beat bleibt, wie bestellt
#ifdef CYPHERDJ_MUTATION_RAMPE_IN_SAMPLES
  // Fehlerfall der Abnahme (Scheibe 08): Dauer als feste Sample-Zahl beim Starttempo statt in Beats nach §1.3
  const double T = (b_ende - b0) * 60.0 / bpm0;
#else
  const double T = (b_ende - b0) * 60.0 / ((bpm0 + ziel_bpm) / 2.0);
#endif
  const double k = (ziel_bpm - bpm0) / T;
  const int m = index_sample((double)s0);
  const int behalten = (seg_[m].s0 == s0) ? m : m + 1;
  if (behalten + 2 > MAX_SEGMENTE) return false;
  if (behalten == m + 1) seg_[m].dauer_s = (double)(s0 - seg_[m].s0) / RATE;
  n_ = behalten;
  seg_[n_++] = Segment{s0, b0, bpm0, k, T};
  const double s_ende = (double)s0 + T * RATE;
  const int64_t s1 = std::llround(s_ende);
  const double b1 = b_ende + ((double)s1 - s_ende) * ziel_bpm / (60.0 * RATE);
  seg_[n_++] = Segment{s1, b1, ziel_bpm, 0.0, INFINITY};
  return true;
}

bool Karte::setze(const Segment* s, int n) noexcept {
  if (n < 1 || n > MAX_SEGMENTE) return false;
  for (int i = 0; i < n; ++i) seg_[i] = s[i];
  n_ = n;
  return true;
}

int Karte::verwerfe_vor(int64_t s) {
  int weg = 0;
  while (weg + 1 < n_ && seg_[weg + 1].s0 <= s) ++weg;
  if (weg == 0) return 0;
  for (int i = weg; i < n_; ++i) seg_[i - weg] = seg_[i];
  n_ -= weg;
  return weg;
}

}  // namespace cdj
