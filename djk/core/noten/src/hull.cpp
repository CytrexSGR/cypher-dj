// The envelope reading of the pitch edit (BERICHT_teilton2.md section 8, B step 9): the amplitudes of the partials of the moved pitch,
// read from the old amplitudes across the harmonic index. ONE place, so that a later improvement of the envelope replaces only this
// file. A port of the amplitude part of `_umrechnen` of m21_k_teilton.py (phase "index", energy kept, falling spectrum continued below the
// first partial).
#include <algorithm>
#include <cmath>

#include "render.h"

namespace cdj::noten {
namespace {

constexpr double FMAX = 16000.0;      // highest partial frequency in Hz (also limited to 0.49 sr)
constexpr double EXTRAP_MIN = 0.25;   // below the first partial the continued spectrum stops at kappa = 0.25

/// Last partial (1 based) of the frame that has an amplitude in either channel: the prototype reads the number of valid partials over both.
int gueltige(const Teiltoene& t, int frame) {
  int nv = 0;
  for (const std::vector<std::complex<double>>* b : {&t.b_l[static_cast<size_t>(frame)], &t.b_r[static_cast<size_t>(frame)]}) {
    for (size_t k = b->size(); k > static_cast<size_t>(nv); --k)
      if (std::abs((*b)[k - 1]) > 0.0) { nv = static_cast<int>(k); break; }
  }
  return nv;
}

}  // namespace

int neueTeiltoene(const Teiltoene& t, int frame, double faktor, double mischung) {
  if (frame < 0 || static_cast<size_t>(frame) >= t.f0.size() || static_cast<size_t>(frame) >= t.b_l.size() || static_cast<size_t>(frame) >= t.b_r.size())
    return 0;
  const int nv = gueltige(t, frame);
  const double f0n = t.f0[static_cast<size_t>(frame)] * faktor;
  if (nv == 0 || !(f0n > 0.0) || !(faktor > 0.0)) return 0;
  const double fmx = std::min(FMAX, 0.49 * SR);
  const int kmax = static_cast<int>(std::floor(fmx / std::max(f0n, 1e-9)));
  const double r = std::pow(faktor, 1.0 - mischung);
  int n = std::min(kmax, static_cast<int>(std::floor((nv + 1e-9) / r)));
  while (n > 0 && n * r > nv + 1e-9) --n;
  while (n + 1 <= kmax && (n + 1) * r <= nv + 1e-9) ++n;
  return std::max(n, 0);
}

void leseHuelle(const Teiltoene& t, int kanal, int frame, double faktor, std::vector<double>& amp, double mischung) {
  const int nneu = neueTeiltoene(t, frame, faktor, mischung);
  amp.assign(static_cast<size_t>(nneu), 0.0);
  if (nneu == 0) return;
  const std::vector<std::complex<double>>& b = kanal == 0 ? t.b_l[static_cast<size_t>(frame)] : t.b_r[static_cast<size_t>(frame)];
  const int nv = gueltige(t, frame);
  const int kk = static_cast<int>(std::max(t.b_l[static_cast<size_t>(frame)].size(), t.b_r[static_cast<size_t>(frame)].size()));
  std::vector<double> a(static_cast<size_t>(kk), 0.0);   // the amplitudes of this channel, zero padded to the common length
  double amax = 0.0, eAlt = 0.0;
  for (size_t k = 0; k < b.size(); ++k) {
    a[k] = std::abs(b[k]);
    amax = std::max(amax, a[k]);
    eAlt += a[k] * a[k];
  }
  if (!(amax > 0.0)) return;
  const double boden = std::max(amax * 1e-6, 1e-30);
  std::vector<double> lg(static_cast<size_t>(kk));
  for (int k = 0; k < kk; ++k) lg[static_cast<size_t>(k)] = std::log(std::max(a[static_cast<size_t>(k)], boden));
  // slopes of ln A per index step at the valid partials: central differences inside, one sided at both ends, zero for a single partial
  auto steigung = [&](int i) -> double {
    if (nv < 2 || i < 0 || i >= nv) return 0.0;
    if (i == 0) return lg[1] - lg[0];
    if (i == nv - 1) return lg[static_cast<size_t>(i)] - lg[static_cast<size_t>(i - 1)];
    return 0.5 * (lg[static_cast<size_t>(i + 1)] - lg[static_cast<size_t>(i - 1)]);
  };
  // the slope of a falling start (a1 > a2) continues below the first partial
  const double a1 = a[0], a2 = a[static_cast<size_t>(std::min(1, kk - 1))];
  const double sl = (a1 > a2 && a2 > 0.0) ? std::clamp(std::log2(std::max(a2, 1e-30) / std::max(a1, 1e-30)), -2.0, 0.0) : 0.0;
  const double r = std::pow(faktor, 1.0 - mischung);
  double eNeu = 0.0;
  for (int k = 1; k <= nneu; ++k) {
    const double kap = k * r;
    const double pos = std::clamp(kap - 1.0, 0.0, static_cast<double>(std::max(nv - 1, 0)));
    const int k0 = static_cast<int>(std::floor(pos));
    const int k1 = std::min(k0 + 1, kk - 1);
    const double t = pos - k0;
    const double t2 = t * t, t3 = t2 * t;
    const double h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    double v = std::exp(h00 * lg[static_cast<size_t>(k0)] + h10 * steigung(k0) + h01 * lg[static_cast<size_t>(k1)] + h11 * steigung(k1));
    if (kap < 1.0) v *= std::pow(std::max(kap, EXTRAP_MIN), sl);
    amp[static_cast<size_t>(k - 1)] = v;
    eNeu += v * v;
  }
  const double g = eNeu > 0.0 ? std::sqrt(eAlt / std::max(eNeu, 1e-300)) : 1.0;   // the energy of the frame is kept
  for (double& v : amp) v *= g;
}

}  // namespace cdj::noten
