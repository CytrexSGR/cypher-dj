// Monophonic check of A2 (BERICHT_einstimmig.md, m21_einstimmig.py): per evaluated frame the HRR of its 20 ms block and, where that is
// low, the CMNDF minimum of the residual. The audio is the mono mix; the partial fit runs in groups of nearby evaluated frames.
#pragma GCC diagnostic ignored "-Wpsabi"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <functional>
#include <limits>

#include "teiltoene.h"

namespace cdj::noten {
namespace {

constexpr int64_t BLOCK_HALB = 480;      // half of the 20 ms HRR block
constexpr double ABSTAND_DB = 40.0;      // checked: block RMS >= P95 - 40 dB
constexpr size_t JEDER = 4;              // every fourth checked frame is evaluated
constexpr int CM_FENSTER = 2048;         // CMNDF segment, centred on the frame
constexpr int CM_LAG_MIN = 48, CM_LAG_MAX = 960;
constexpr int64_t GRUPPE_LUECKE = 16;    // frames: a larger gap between evaluated voiced frames starts a new group
constexpr int64_t GRUPPE_MAX = 1024;     // frames per group at most
constexpr int64_t GRUPPE_RAND = 1024;    // samples of margin around a group (the CMNDF segment reaches that far)

typedef float v8 __attribute__((vector_size(32)));

/// Block bounds [lo, hi) of frame i and the cumulative sum of squares of the mono signal.
struct Bloecke {
  std::vector<double> c;
  int64_t n;
  int64_t lo(int64_t i) const { return std::max<int64_t>(std::min<int64_t>(i * HOP, n) - BLOCK_HALB, 0); }
  int64_t hi(int64_t i) const { return std::min<int64_t>(std::min<int64_t>(i * HOP, n) + BLOCK_HALB, n); }
  double rms(int64_t i) const {
    const int64_t a = lo(i), b = hi(i);
    return std::sqrt(std::max(c[static_cast<size_t>(b)] - c[static_cast<size_t>(a)], 0.0) / static_cast<double>(std::max<int64_t>(b - a, 1)));
  }
};

Bloecke bloecke(const std::vector<float>& x) {
  Bloecke b;
  b.n = static_cast<int64_t>(x.size());
  b.c.assign(x.size() + 1, 0.0);
  double s = 0.0;
  for (size_t i = 0; i < x.size(); ++i) { s += static_cast<double>(x[i]) * static_cast<double>(x[i]); b.c[i + 1] = s; }
  return b;
}

struct Gruppe {
  size_t i0, i1;        // [i0, i1) of the list of voiced evaluated frames
  int64_t s0, s1;       // analysed samples
};

std::vector<Gruppe> gruppiere(const std::vector<int64_t>& fv, int64_t n) {
  std::vector<Gruppe> g;
  size_t i = 0;
  while (i < fv.size()) {
    size_t e = i + 1;
    while (e < fv.size() && fv[e] - fv[e - 1] <= GRUPPE_LUECKE && fv[e] - fv[i] < GRUPPE_MAX) ++e;
    g.push_back({i, e, std::max<int64_t>(fv[i] * HOP - GRUPPE_RAND, 0), std::min<int64_t>(fv[e - 1] * HOP + GRUPPE_RAND, n)});
    i = e;
  }
  return g;
}

/// Calls `fn(group, h)` for each group with the harmonic signal h of the mono source over [group.s0, group.s1). False from fn or a
/// pending SIGTERM ends the run (the result is then false).
bool gruppenLauf(const Stereo& mono, const Kurve& k, const std::vector<int64_t>& fv,
                 const std::function<bool(const Gruppe&, const std::vector<double>&)>& fn) {
  std::vector<double> h;
  for (const Gruppe& g : gruppiere(fv, mono.frames())) {
    const Teiltoene t = analysiere(mono, k, g.s0, g.s1);
    if (abbruchAngefordert()) return false;
    harmonisch(t, 0, h);
    if (!fn(g, h)) return false;
  }
  return true;
}

double hrrBlock(const std::vector<float>& x, const std::vector<double>& h, int64_t s0, const Bloecke& b, int64_t frame) {
  double eh = 0.0, er = 0.0;
  for (int64_t i = b.lo(frame); i < b.hi(frame); ++i) {
    const double hv = h[static_cast<size_t>(i - s0)], r = static_cast<double>(x[static_cast<size_t>(i)]) - hv;
    eh += hv * hv;
    er += r * r;
  }
  return 10.0 * std::log10((eh + 1e-20) / (er + 1e-20));
}

inline v8 laden(const float* p) { v8 v; std::memcpy(&v, p, sizeof v); return v; }

/// d[t - 1] = sum_{j < W} (s[j] - s[j + t])^2 for t = 1 .. 960 (W = 2048 - 960), non-negative by construction.
__attribute__((target_clones("avx2,fma", "default")))
void differenzen(const float* s, float* d) {
  constexpr int W = CM_FENSTER - CM_LAG_MAX;
  for (int t = 1; t <= CM_LAG_MAX; ++t) {
    v8 a0 = {0, 0, 0, 0, 0, 0, 0, 0}, a1 = a0;
    for (int j = 0; j < W; j += 16) {
      const v8 u0 = laden(s + j) - laden(s + j + t), u1 = laden(s + j + 8) - laden(s + j + 8 + t);
      a0 += u0 * u0;
      a1 += u1 * u1;
    }
    const v8 a = a0 + a1;
    d[t - 1] = ((a[0] + a[1]) + (a[2] + a[3])) + ((a[4] + a[5]) + (a[6] + a[7]));
  }
}

/// CMNDF minimum over the lags 48 .. 960 of the 2048 samples [c - 1024, c + 1024) of the residual (zero outside [lo, hi)).
double cmndfMin(const std::vector<float>& x, const std::vector<double>& h, int64_t s0, int64_t frame, std::vector<float>& seg, std::vector<float>& d) {
  const int64_t n = static_cast<int64_t>(x.size());
  const int64_t a = frame * HOP - CM_FENSTER / 2;
  seg.assign(static_cast<size_t>(CM_FENSTER + 16), 0.0f);
  const int64_t lo = std::max<int64_t>(a, 0), hi = std::min<int64_t>(a + CM_FENSTER, n);
  for (int64_t i = lo; i < hi; ++i)
    seg[static_cast<size_t>(i - a)] = static_cast<float>(static_cast<double>(x[static_cast<size_t>(i)]) - h[static_cast<size_t>(i - s0)]);
  d.resize(static_cast<size_t>(CM_LAG_MAX));
  differenzen(seg.data(), d.data());
  double cum = 0.0, best = 1.0;
  bool erster = true;
  for (int t = 1; t <= CM_LAG_MAX; ++t) {
    const double dt = std::max<double>(d[static_cast<size_t>(t - 1)], 0.0);
    cum += dt;
    const double cm = cum > 0 ? dt * t / cum : 1.0;
    if (t >= CM_LAG_MIN) { if (erster || cm < best) best = cm; erster = false; }
  }
  return best;
}

}  // namespace

std::vector<int64_t> gepruefteFrames(const std::vector<float>& mono, int64_t nf) {
  std::vector<int64_t> out;
  if (mono.empty() || nf <= 0) return out;
  const Bloecke b = bloecke(mono);
  std::vector<double> rms(static_cast<size_t>(nf));
  for (int64_t i = 0; i < nf; ++i) rms[static_cast<size_t>(i)] = b.rms(i);
  std::vector<double> s = rms;
  std::sort(s.begin(), s.end());
  const double pos = 0.95 * static_cast<double>(nf - 1);   // numpy percentile, linear interpolation
  const size_t p = static_cast<size_t>(pos);
  const double p95 = p + 1 < s.size() ? s[p] + (s[p + 1] - s[p]) * (pos - static_cast<double>(p)) : s[p];
  const double schwelle = p95 * std::pow(10.0, -ABSTAND_DB / 20.0);
  size_t z = 0;
  for (int64_t i = 0; i < nf; ++i)
    if (rms[static_cast<size_t>(i)] >= schwelle && rms[static_cast<size_t>(i)] > 0) { if (z++ % JEDER == 0) out.push_back(i); }
  return out;
}

std::vector<double> hrrFrames(const Stereo& x, const Kurve& k, const std::vector<int64_t>& frames) {
  std::vector<double> out(frames.size(), std::numeric_limits<double>::quiet_NaN());
  Stereo m;
  m.l = mitte(x);
  const Bloecke b = bloecke(m.l);
  std::vector<int64_t> fv;
  std::vector<size_t> pos;
  for (size_t i = 0; i < frames.size(); ++i)
    if (frames[i] >= 0 && frames[i] < static_cast<int64_t>(k.f0_ct.size()) && k.f0_ct[static_cast<size_t>(frames[i])] > 0) { fv.push_back(frames[i]); pos.push_back(i); }
  gruppenLauf(m, k, fv, [&](const Gruppe& g, const std::vector<double>& h) {
    for (size_t i = g.i0; i < g.i1; ++i) out[pos[i]] = hrrBlock(m.l, h, g.s0, b, fv[i]);
    return true;
  });
  return out;
}

Mono pruefeEinstimmig(const Stereo& x, const Kurve& k, Fortschritt* f) {
  Mono ergebnis;
  ergebnis.hrr_db_schwelle = MONO_HRR_DB;
  ergebnis.periode_schwelle = MONO_PERIODE;
  Stereo m;
  m.l = mitte(x);
  const int64_t nf = static_cast<int64_t>(k.f0_ct.size());
  const std::vector<int64_t> geprueft = gepruefteFrames(m.l, nf);
  ergebnis.geprueft_frames = static_cast<int64_t>(geprueft.size());
  if (geprueft.empty()) return ergebnis;
  const Bloecke b = bloecke(m.l);
  std::vector<int64_t> fv;
  for (int64_t j : geprueft) if (k.f0_ct[static_cast<size_t>(j)] > 0) fv.push_back(j);   // the unvoiced rule is off: they only count
  int64_t mehrstimmig = 0, fertig = 0;
  std::vector<float> seg, d;
  const bool ok = gruppenLauf(m, k, fv, [&](const Gruppe& g, const std::vector<double>& h) {
    for (size_t i = g.i0; i < g.i1; ++i) {
      if (hrrBlock(m.l, h, g.s0, b, fv[i]) < MONO_HRR_DB && cmndfMin(m.l, h, g.s0, fv[i], seg, d) <= MONO_PERIODE) ++mehrstimmig;
    }
    fertig += static_cast<int64_t>(g.i1 - g.i0);
    if (f) f->stufe(2, "pruefen", 100.0 * static_cast<double>(fertig) / static_cast<double>(fv.size()));
    return true;
  });
  if (!ok) return ergebnis;   // interrupted: the caller sees abbruchAngefordert()
  ergebnis.anteil = static_cast<double>(mehrstimmig) / static_cast<double>(geprueft.size());
  ergebnis.mehrstimmig = ergebnis.anteil > MONO_ANTEIL_MAX;
  return ergebnis;
}

}  // namespace cdj::noten
