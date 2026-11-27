// Synthetic test tones of the note editor tests (tasks A3 to A6): deterministic on every machine (own pseudo random generator, no
// std distributions), header only. A tone is a sum of harmonic partials at 1/k (or weighted by a fixed two-peak envelope), with
// vibrato, glide, linear onset and release ramps; notes are summed into a mono signal. Noise and silence are here too.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "cdj_noten/contract.h"

namespace cdj::noten::synth {

constexpr int SR = cdj::noten::SR;

inline double midiHz(double midi) { return 440.0 * std::pow(2.0, (midi - 69.0) / 12.0); }

/// splitmix64: the same sequence for the same seed everywhere.
struct Zufall {
  uint64_t s;
  explicit Zufall(uint64_t seed) : s(seed) {}
  uint64_t naechste() {
    uint64_t z = (s += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }
  /// uniform in [0, 1)
  double gleich() { return static_cast<double>(naechste() >> 11) * (1.0 / 9007199254740992.0); }
  /// standard normal (Box-Muller)
  double normal() {
    const double u1 = 1.0 - gleich(), u2 = gleich();
    return std::sqrt(-2.0 * std::log(u1)) * std::cos(2.0 * std::acos(-1.0) * u2);
  }
};

/// The fixed two-peak spectral envelope (a stand-in for two formants): a gain that peaks at 700 Hz and at 1800 Hz (log-frequency
/// Gaussians, width 0.35 and 0.30 octaves) on a small floor. The first two maxima of a tone that uses it sit at these frequencies.
inline double huelle(double hz) {
  if (hz <= 0.0) return 0.0;
  const double a = std::log2(hz / 700.0) / 0.35, b = std::log2(hz / 1800.0) / 0.30;
  return 0.05 + std::exp(-0.5 * a * a) + 0.8 * std::exp(-0.5 * b * b);
}

/// One note of a test melody.
struct Ton {
  double start_s = 0;         // start in the signal
  double dauer_s = 1;
  double midi = 60;           // pitch at the start (float MIDI, A4 = 69)
  double midi_ende = -1;      // glide: the pitch moves linearly (in cents) to this over the duration; below 0 = no glide
  double vib_ct = 0;          // vibrato depth in cents (peak), 0 = none
  double vib_hz = 5.5;        // vibrato rate
  double pegel = 0.3;         // peak amplitude of the partial sum (the weights are normalised to sum 1)
  double anstieg_s = 0.01;    // linear onset ramp (0 = none: the first sample is at full level)
  double abfall_s = 0.03;     // linear release ramp (0 = none)
  bool mit_huelle = false;    // weight the partial k by huelle(k * f) instead of 1/k (formant tests)
  int teiltoene = 20;         // number of partials (those above 0.45 * sr are left out)
};

/// Pitch of a note at time t (seconds from its start), in float MIDI: glide plus vibrato.
inline double tonHoehe(const Ton& n, double t) {
  double m = n.midi;
  if (n.midi_ende >= 0 && n.dauer_s > 0) m += (n.midi_ende - n.midi) * std::min(1.0, t / n.dauer_s);
  if (n.vib_ct != 0) m += n.vib_ct / 100.0 * std::sin(2.0 * std::acos(-1.0) * n.vib_hz * t);
  return m;
}

/// Adds one note into `x` (mono, SR).
inline void addiere(std::vector<float>& x, const Ton& n) {
  const double pi2 = 2.0 * std::acos(-1.0);
  const int64_t a = static_cast<int64_t>(std::llround(n.start_s * SR));
  const int64_t len = static_cast<int64_t>(std::llround(n.dauer_s * SR));
  std::vector<double> w(static_cast<size_t>(std::max(n.teiltoene, 1)));
  double phase = 0.0;
  for (int64_t i = 0; i < len; ++i) {
    const int64_t pos = a + i;
    const double t = static_cast<double>(i) / SR;
    const double f = midiHz(tonHoehe(n, t));
    if (i % 32 == 0) {   // the weights follow the pitch slowly
      double summe = 0.0;
      for (size_t k = 0; k < w.size(); ++k) {
        const double fk = f * static_cast<double>(k + 1);
        w[k] = fk > 0.45 * SR ? 0.0 : (n.mit_huelle ? huelle(fk) : 1.0 / static_cast<double>(k + 1));
        summe += w[k];
      }
      if (summe > 0) for (double& v : w) v /= summe;
    }
    double s = 0.0;
    for (size_t k = 0; k < w.size(); ++k) if (w[k] != 0.0) s += w[k] * std::sin(phase * static_cast<double>(k + 1));
    double g = 1.0;
    if (n.anstieg_s > 0 && t < n.anstieg_s) g = t / n.anstieg_s;
    const double rest = n.dauer_s - t;
    if (n.abfall_s > 0 && rest < n.abfall_s) g = std::min(g, rest / n.abfall_s);
    if (pos >= 0 && pos < static_cast<int64_t>(x.size())) x[static_cast<size_t>(pos)] += static_cast<float>(n.pegel * g * s);
    phase += pi2 * f / SR;
    if (phase > pi2) phase -= pi2;
  }
}

/// A mono signal of `sekunden` with the notes summed in.
inline std::vector<float> melodie(const std::vector<Ton>& noten, double sekunden) {
  std::vector<float> x(static_cast<size_t>(std::llround(sekunden * SR)), 0.0f);
  for (const Ton& n : noten) addiere(x, n);
  return x;
}

/// White Gaussian noise of the given RMS (dBFS), deterministic for the seed.
inline std::vector<float> rauschen(double sekunden, double rms_dbfs, uint64_t seed) {
  Zufall z(seed);
  const double rms = std::pow(10.0, rms_dbfs / 20.0);
  std::vector<float> x(static_cast<size_t>(std::llround(sekunden * SR)));
  for (float& v : x) v = static_cast<float>(rms * z.normal());
  return x;
}

inline std::vector<float> stille(double sekunden) { return std::vector<float>(static_cast<size_t>(std::llround(sekunden * SR)), 0.0f); }

/// The signal repeated until it is `sekunden` long (a long source out of a short tone).
inline std::vector<float> wiederhole(const std::vector<float>& x, double sekunden) {
  const size_t n = static_cast<size_t>(std::llround(sekunden * SR));
  std::vector<float> out(n);
  if (x.empty()) return out;
  for (size_t i = 0; i < n; ++i) out[i] = x[i % x.size()];
  return out;
}

/// Two identical channels (a mono file decoded as stereo).
inline Stereo stereoAusMono(const std::vector<float>& m) {
  Stereo s;
  s.l = m;
  s.r = m;
  return s;
}

}  // namespace cdj::noten::synth
