// Pitch-only render of the engine `teilton-2`: a port of the pitch edit of m21_k_teilton.py as BERICHT_teilton2.md section 8, B states it
// (steps 6 to 13, without the time edit): edit groups, shift per sample with raised cosine ramps, the oscillator bank of the moved partials
// and y = x - h + h'. The envelope and phase readings are in hull.cpp and phase.cpp. What differs from the numpy prototype, and why:
//  - the fundamental phase and the partials are per channel (A5 analyses against the partial 1 of each channel, as the prototype does);
//  - the window of the analysis, the outside of the file and the frames are as in teiltoene.cpp (samples outside the source are zero);
//  - the oscillator bank is a float kernel on 8 lanes like harmonisch (target_clones), the sine and cosine come from double;
//  - the estimate of the envelope mixing reads the refined analysis (the port has no analysis without the f0 refinement).
#pragma GCC diagnostic ignored "-Wpsabi"
#include "render.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cdj::noten {
namespace {

using Komplex = std::complex<double>;
using Bereiche = std::vector<std::pair<int64_t, int64_t>>;

constexpr double PI = 3.14159265358979323846;
constexpr double RAMPE_S = 0.020;          // the pitch change is ramped in and out over at most 20 ms
constexpr int RAND = 2048;                 // margin of the analysis around a region
constexpr double NUR_RAND_S = 0.040;       // incremental: the range around a named note

constexpr double MISCH_FENSTER0 = 0.10, MISCH_FENSTER1 = 0.35;   // the part of a note used for the estimate: seconds after its start
constexpr size_t MISCH_NMAX = 6;
constexpr double MISCH_MIN_ST = 2.5;
constexpr double MISCH_GITTER[5] = {0.0, 0.25, 0.5, 0.75, 1.0};
constexpr double MISCH_VORTEIL_DB = 2.0;

typedef float v8 __attribute__((vector_size(32)));
inline v8 laden(const float* p) { v8 v; std::memcpy(&v, p, sizeof v); return v; }
inline void speichern(float* p, v8 v) { std::memcpy(p, &v, sizeof v); }

double cosRampe(double t) { t = std::clamp(t, 0.0, 1.0); return 0.5 * (1.0 - std::cos(PI * t)); }

int rampeSamples() { return static_cast<int>(RAMPE_S * SR); }

// ------------------------------------------------------------------------------------------------ edit groups

struct Eintrag {
  int64_t a = 0, e = 0;   // samples of the note (old = new interval: a pitch edit does not move the note)
  double st = 0;          // semitone offset
};

struct Gruppe {
  std::vector<Eintrag> it;
  int64_t r0 = 0, r1 = 0;
};

std::vector<Eintrag> eintraege(const std::vector<AudioNote>& liste, int64_t n) {
  std::vector<Eintrag> out;
  for (const AudioNote& nt : liste) {
    if (!nt.ton) continue;
    Eintrag it;
    it.a = std::clamp<int64_t>(static_cast<int64_t>(std::nearbyint(nt.qa * SR)), 0, n);
    it.e = std::clamp<int64_t>(static_cast<int64_t>(std::nearbyint(nt.qe * SR)), 0, n);
    it.st = *nt.ton - nt.qton;
    if (it.e - it.a < 8) continue;
    if (std::fabs(it.st) < 1e-9) continue;
    out.push_back(it);
  }
  return out;
}

/// Edits whose regions overlap or lie closer than two ramps form one group.
bool gruppiere(const std::vector<Eintrag>& items, std::vector<Gruppe>& gr) {
  const int w = rampeSamples();
  int64_t ende = 0;
  for (const Eintrag& it : items) {
    if (!gr.empty() && it.a < ende + 2 * w) {
      if (it.a < gr.back().it.back().e) return false;   // edited notes overlap
      gr.back().it.push_back(it);
      ende = std::max(ende, it.e);
    } else {
      Gruppe g;
      g.it.push_back(it);
      gr.push_back(g);
      ende = it.e;
    }
  }
  for (Gruppe& g : gr) {
    g.r0 = g.it.front().a;
    g.r1 = g.it.front().e;
    for (const Eintrag& it : g.it) { g.r0 = std::min(g.r0, it.a); g.r1 = std::max(g.r1, it.e); }
  }
  return true;
}

/// Semitone shift per sample of a group over [r0, r1): constant per note, raised cosine ramps (at most w samples) at every change; at the
/// outer edges the ramps lie inside the note, between touching notes they are centred.
std::vector<double> rampen(const Gruppe& g, int w) {
  const int64_t nreg = g.r1 - g.r0;
  std::vector<double> st(static_cast<size_t>(nreg), 0.0), stufe(static_cast<size_t>(nreg) + 1, 0.0);
  auto ev = [&](int64_t p0, int64_t p1, double delta) {
    const double nenner = static_cast<double>(std::max<int64_t>(p1 - p0, 1));
    for (int64_t u = std::max(p0, g.r0); u <= std::min(p1, g.r1 - 1); ++u) st[static_cast<size_t>(u - g.r0)] += delta * cosRampe(static_cast<double>(u - p0) / nenner);
    const int64_t von = std::clamp<int64_t>(p1 + 1 - g.r0, 0, nreg);
    stufe[static_cast<size_t>(von)] += delta;   // after the ramp the whole delta stands
  };
  auto breite = [&](const Eintrag& it) { return static_cast<int64_t>(std::max<int64_t>(2, std::min<int64_t>(w, (it.e - it.a) / 4))); };
  const Eintrag* prev = nullptr;
  for (const Eintrag& it : g.it) {
    const int64_t wi = breite(it);
    if (prev && it.a - prev->e <= 1) {
      const int64_t wc = std::min(wi, breite(*prev));
      ev(it.a - wc / 2, it.a - wc / 2 + wc - 1, it.st - prev->st);
    } else {
      if (prev) ev(prev->e - breite(*prev), prev->e - 1, -prev->st);
      ev(it.a, it.a + wi - 1, it.st);
    }
    prev = &it;
  }
  ev(prev->e - breite(*prev), prev->e - 1, -prev->st);
  double lauf = 0.0;
  for (int64_t i = 0; i < nreg; ++i) {
    lauf += stufe[static_cast<size_t>(i)];
    st[static_cast<size_t>(i)] += lauf;
  }
  return st;
}

// ------------------------------------------------------------------------------------------------ oscillator bank

/// out[n] = sum_k (br0 cos(k psi) - bi0 sin(k psi)) + lam (dbr cos(k psi) - dbi sin(k psi)); cc, sc, c2: cos, sin, 2 cos of psi, the lanes
/// past the stretch are zero. The powers come from the Chebyshev recurrence c(k+1) = 2 cos(psi) c(k) - c(k-1).
__attribute__((target_clones("avx2,fma", "default")))
void bankKern(int n16, int kn, const float* cc, const float* sc, const float* c2, const float* lam, const float* br0, const float* bi0,
              const float* dbr, const float* dbi, float* out) {
  for (int t = 0; t < n16; t += 16) {
    v8 cp0 = {1, 1, 1, 1, 1, 1, 1, 1}, cp1 = cp0, sp0 = {0, 0, 0, 0, 0, 0, 0, 0}, sp1 = sp0;
    v8 cc0 = laden(cc + t), cc1 = laden(cc + t + 8), sc0 = laden(sc + t), sc1 = laden(sc + t + 8);
    const v8 d0 = laden(c2 + t), d1 = laden(c2 + t + 8);
    v8 a0 = sp0, a1 = sp0, b0 = sp0, b1 = sp0;
    for (int k = 0; k < kn; ++k) {
      const float r0 = br0[k], i0 = bi0[k], r1 = dbr[k], i1 = dbi[k];
      a0 += r0 * cc0 - i0 * sc0;
      a1 += r0 * cc1 - i0 * sc1;
      b0 += r1 * cc0 - i1 * sc0;
      b1 += r1 * cc1 - i1 * sc1;
      const v8 n0 = d0 * cc0 - cp0, n1 = d1 * cc1 - cp1, m0 = d0 * sc0 - sp0, m1 = d1 * sc1 - sp1;
      cp0 = cc0; cp1 = cc1; cc0 = n0; cc1 = n1;
      sp0 = sc0; sp1 = sc1; sc0 = m0; sc1 = m1;
    }
    speichern(out + t, a0 + laden(lam + t) * b0);
    speichern(out + t + 8, a1 + laden(lam + t + 8) * b1);
  }
}

/// The partials b[c][m] (frame m at the sample uf[m], linear in time between the frames) of `nkan` channels on the samples
/// [uf.front(), uf.back()] with the phase of the fundamental psi[c] (one value per sample and channel). out[c] has uf.back() -
/// uf.front() + 1 values. Returns false when a SIGTERM is pending.
bool bank(const std::vector<std::vector<Komplex>>* b, int nkan, const std::vector<int64_t>& uf, const std::vector<double>* psi,
          std::vector<double>* out) {
  const size_t nfr = uf.size();
  const int64_t n0 = uf.front();
  for (int c = 0; c < nkan; ++c) out[c].assign(static_cast<size_t>(uf.back() - n0 + 1), 0.0);
  if (nfr < 2) return true;
  std::vector<float> cc, sc, c2, lam, ob, br0, bi0, dbr, dbi;
  for (size_t m = 0; m + 1 < nfr; ++m) {
    if ((m & 15) == 0 && abbruchAngefordert()) return false;
    const int64_t a = uf[m], e = uf[m + 1] + (m + 2 == nfr ? 1 : 0);
    const int len = static_cast<int>(e - a), n16 = (len + 15) & ~15;
    if (len <= 0) continue;
    cc.assign(static_cast<size_t>(n16), 1.0f);
    sc.assign(static_cast<size_t>(n16), 0.0f);
    c2.assign(static_cast<size_t>(n16), 2.0f);
    lam.assign(static_cast<size_t>(n16), 0.0f);
    ob.assign(static_cast<size_t>(n16), 0.0f);
    const double dt = static_cast<double>(uf[m + 1] - uf[m]);
    for (int i = 0; i < len; ++i) lam[static_cast<size_t>(i)] = static_cast<float>(std::clamp(static_cast<double>(a + i - uf[m]) / dt, 0.0, 1.0));
    for (int c = 0; c < nkan; ++c) {
      for (int i = 0; i < len; ++i) {
        const double p = psi[c][static_cast<size_t>(a + i - n0)];
        const float cs = static_cast<float>(std::cos(p));
        cc[static_cast<size_t>(i)] = cs;
        sc[static_cast<size_t>(i)] = static_cast<float>(std::sin(p));
        c2[static_cast<size_t>(i)] = cs + cs;
      }
      const std::vector<Komplex>& u0 = b[c][m];
      const std::vector<Komplex>& u1 = b[c][m + 1];
      const size_t kn = std::max(u0.size(), u1.size());
      if (kn == 0) continue;
      br0.assign(kn, 0.0f); bi0.assign(kn, 0.0f); dbr.assign(kn, 0.0f); dbi.assign(kn, 0.0f);
      for (size_t k = 0; k < kn; ++k) {
        const Komplex p = k < u0.size() ? u0[k] : Komplex(0.0, 0.0), r = k < u1.size() ? u1[k] : Komplex(0.0, 0.0);
        br0[k] = static_cast<float>(p.real());
        bi0[k] = static_cast<float>(p.imag());
        dbr[k] = static_cast<float>(r.real() - p.real());
        dbi[k] = static_cast<float>(r.imag() - p.imag());
      }
      bankKern(n16, static_cast<int>(kn), cc.data(), sc.data(), c2.data(), lam.data(), br0.data(), bi0.data(), dbr.data(), dbi.data(), ob.data());
      for (int i = 0; i < len; ++i) out[c][static_cast<size_t>(a + i - n0)] = ob[static_cast<size_t>(i)];
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ one group

/// f in Hz per sample over [t.s0, t.s1): the track the phase was integrated from, from the differences of the phase (phi[i] = 2 pi / sr
/// sum_{m<i} f[m]); the last sample holds the one before.
std::vector<double> frequenzAusPhase(const Teiltoene& t) {
  const size_t n = t.phi.size();
  std::vector<double> f(n, 0.0);
  const double k = SR / (2.0 * PI);
  for (size_t i = 0; i + 1 < n; ++i) f[i] = (t.phi[i + 1] - t.phi[i]) * k;
  if (n >= 2) f[n - 1] = f[n - 2];
  return f;
}

/// The partials of the analysis at the sample `pos` (linear between the frame centres, held outside), both channels, zero padded to one
/// length, as one frame of `tmp` with the pitch `f`.
void frameBei(const Teiltoene& an, int64_t pos, double f, Teiltoene& tmp) {
  const size_t nfr = an.f0.size();
  size_t m0 = 0, m1 = 0;
  double lam = 0.0;
  if (nfr > 1) {
    const int64_t t0 = an.j0 * HOP;
    int64_t m = pos >= t0 ? (pos - t0) / HOP : -1;
    m = std::clamp<int64_t>(m, 0, static_cast<int64_t>(nfr) - 2);
    lam = std::clamp(static_cast<double>(pos - (an.j0 + m) * HOP) / HOP, 0.0, 1.0);
    m0 = static_cast<size_t>(m);
    m1 = m0 + 1;
  }
  size_t kk = 0;
  for (const auto* v : {&an.b_l[m0], &an.b_l[m1], &an.b_r[m0], &an.b_r[m1]}) kk = std::max(kk, v->size());
  tmp.f0.assign(1, f);
  tmp.b_l.assign(1, {});
  tmp.b_r.assign(1, {});
  for (int c = 0; c < 2; ++c) {
    const auto& v0 = c == 0 ? an.b_l[m0] : an.b_r[m0];
    const auto& v1 = c == 0 ? an.b_l[m1] : an.b_r[m1];
    auto& o = c == 0 ? tmp.b_l[0] : tmp.b_r[0];
    o.assign(kk, Komplex(0.0, 0.0));
    for (size_t k = 0; k < kk; ++k) {
      const Komplex p = k < v0.size() ? v0[k] : Komplex(0.0, 0.0), q = k < v1.size() ? v1[k] : Komplex(0.0, 0.0);
      o[k] = p * (1.0 - lam) + q * lam;
    }
  }
}

/// Renders the group into `aus` (which holds the source, or the earlier render with the range of the group restored from the source).
/// False on SIGTERM.
bool rendereGruppe(const Stereo& x, const Teiltoene& an, const Gruppe& g, double mischung, Stereo& aus) {
  const int64_t r0 = g.r0, r1 = g.r1, nreg = r1 - r0, w0 = an.s0;
  const int w = rampeSamples();
  bool stimmhaft = false;
  for (double f : an.f0) if (f > 0.0) { stimmhaft = true; break; }
  if (!stimmhaft) return true;                       // no partials: y = x - 0 + 0
  const std::vector<double> st = rampen(g, w);
  std::vector<double> rho(static_cast<size_t>(nreg));
  for (int64_t i = 0; i < nreg; ++i) rho[static_cast<size_t>(i)] = std::pow(2.0, st[static_cast<size_t>(i)] / 12.0);
  const std::vector<double> fs = frequenzAusPhase(an);
  auto fAt = [&](int64_t pos) { return fs[static_cast<size_t>(pos - w0)]; };

  const std::vector<double>* alphaC[2] = {&an.alpha1, &an.alpha1_r};

  // ---- frames of the new partials: the first sample, every hop inside, the last sample
  std::vector<int64_t> uf;
  uf.push_back(r0);
  for (int64_t p = (r0 / HOP + 1) * HOP; p < r1 - 1; p += HOP) uf.push_back(p);
  uf.push_back(r1 - 1);
  const size_t nfr = uf.size();
  std::vector<std::vector<Komplex>> bneu[2];
  bneu[0].assign(nfr, {});
  bneu[1].assign(nfr, {});
  Teiltoene tmp;
  std::vector<double> amp, ph;
  bool gleich = true;
  for (size_t m = 0; m < nfr; ++m) {
    const int64_t pos = uf[m];
    const double rf = rho[static_cast<size_t>(pos - r0)];
    frameBei(an, pos, fAt(pos), tmp);
    if (tmp.b_l[0] != tmp.b_r[0]) gleich = false;
    if (std::fabs(rf - 1.0) < 1e-12) {               // no shift here: the partials stay exactly as they are
      bneu[0][m] = tmp.b_l[0];
      bneu[1][m] = tmp.b_r[0];
      continue;
    }
    for (int c = 0; c < 2; ++c) {
      leseHuelle(tmp, c, 0, rf, amp, mischung);
      lesePhase(tmp, c, 0, rf, ph, mischung);
      auto& o = bneu[c][m];
      o.resize(amp.size());
      for (size_t k = 0; k < amp.size(); ++k) o[k] = std::polar(amp[k], ph[k]);
    }
  }

  // ---- phase of the fundamental: the integral of the moved track plus the measured drift of partial 1 (its increments times rho)
  std::vector<double> phiN(static_cast<size_t>(nreg));
  {
    double summe = 0.0;
    const double kf = 2.0 * PI / SR;
    const double start = an.phi[static_cast<size_t>(r0 - w0)];
    for (int64_t i = 0; i < nreg; ++i) {
      phiN[static_cast<size_t>(i)] = start + kf * summe;
      summe += fAt(r0 + i) * rho[static_cast<size_t>(i)];
    }
    // the region ends at an unedited point: a smooth extra phase over the last ramp makes the phase at the end the old one modulo 2 pi
    const double d = phiN.back() - an.phi[static_cast<size_t>(r1 - 1 - w0)];
    const double korr = -(d - 2.0 * PI * std::nearbyint(d / (2.0 * PI)));
    const int64_t wo = std::max<int64_t>(2, std::min<int64_t>(w, nreg / 2));
    for (int64_t j = 0; j < wo; ++j) phiN[static_cast<size_t>(nreg - wo + j)] += korr * cosRampe(static_cast<double>(j) / (wo - 1.0));
  }
  std::vector<double> psi[2];
  for (int c = 0; c < (gleich ? 1 : 2); ++c) {
    psi[c].resize(static_cast<size_t>(nreg));
    const std::vector<double>& ak = *alphaC[c];
    const size_t nfa = ak.size();
    auto alpha = [&](int64_t pos) {
      const double fpos = static_cast<double>(pos - an.j0 * HOP) / HOP;
      if (fpos <= 0.0) return ak.front();
      if (fpos >= static_cast<double>(nfa - 1)) return ak.back();
      const size_t m = static_cast<size_t>(fpos);
      return ak[m] + (fpos - static_cast<double>(m)) * (ak[m + 1] - ak[m]);
    };
    double al = alpha(r0), vor = al;
    for (int64_t i = 0; i < nreg; ++i) {
      const double a = alpha(r0 + i);
      if (i > 0) al += rho[static_cast<size_t>(i)] * (a - vor);
      vor = a;
      psi[c][static_cast<size_t>(i)] = phiN[static_cast<size_t>(i)] + al;
    }
  }

  // ---- synthesis, the old partials on the margin range, and y = x - h + h' inside the notes
  std::vector<double> hneu[2];
  if (!bank(bneu, gleich ? 1 : 2, uf, psi, hneu)) return false;
  if (gleich) hneu[1] = hneu[0];
  std::vector<double> halt;
  for (int c = 0; c < (gleich ? 1 : 2); ++c) {
    harmonisch(an, c, halt);
    if (abbruchAngefordert()) return false;
    for (const Eintrag& it : g.it) {
      for (int64_t u = it.a; u < it.e; ++u) {
        const std::vector<float>& q = c == 0 ? x.l : x.r;
        const float y = static_cast<float>(static_cast<double>(q[static_cast<size_t>(u)]) - halt[static_cast<size_t>(u - w0)] + hneu[c][static_cast<size_t>(u - r0)]);
        (c == 0 ? aus.l : aus.r)[static_cast<size_t>(u)] = y;
        if (gleich) aus.r[static_cast<size_t>(u)] = y;
      }
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ ranges

void vereinige(Bereiche& b) {
  std::sort(b.begin(), b.end());
  Bereiche o;
  for (const auto& r : b) {
    if (r.second <= r.first) continue;
    if (!o.empty() && r.first <= o.back().second) o.back().second = std::max(o.back().second, r.second);
    else o.push_back(r);
  }
  b = o;
}

bool ueberlappt(const Bereiche& b, int64_t a, int64_t e) {
  for (const auto& r : b) if (a < r.second && r.first < e) return true;
  return false;
}

bool bedeckt(const Bereiche& b, int64_t a, int64_t e) {
  for (const auto& r : b) if (r.first <= a && e <= r.second) return true;
  return false;
}

}  // namespace

// ------------------------------------------------------------------------------------------------ envelope mixing

namespace {

struct Probe {
  double f = 0;
  std::vector<double> la;    // mean log amplitude per partial
  int nv = 0;                // number of partials
  std::vector<double> amp;   // mean amplitude per partial
};

double median(std::vector<double> v) {
  std::sort(v.begin(), v.end());
  const size_t n = v.size();
  return n % 2 ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
}

/// np.interp(x, arange(n), fp[:n]) for x in [0, n - 1].
double interp1(double x, const std::vector<double>& fp, int n) {
  const int i = std::min(static_cast<int>(std::floor(x)), n - 2);
  if (n < 2) return fp[0];
  const double l = x - i;
  return fp[static_cast<size_t>(i)] * (1.0 - l) + fp[static_cast<size_t>(i) + 1] * l;
}

/// Mean over the ordered pairs (A, B) of notes of the rms error (dB) with which the partials of B follow from those of A when the envelope
/// is read with the mixing `beta`, the mean level difference removed; NaN without a pair; and the number of pairs.
std::pair<double, int> mischFehler(const std::vector<Probe>& sn, double beta) {
  std::vector<double> es;
  for (size_t ia = 0; ia < sn.size(); ++ia) {
    for (size_t ib = 0; ib < sn.size(); ++ib) {
      const Probe& A = sn[ia];
      const Probe& B = sn[ib];
      if (ia == ib || std::fabs(12.0 * std::log2(B.f / A.f)) < MISCH_MIN_ST) continue;
      const int nvb = B.nv, nva = A.nv;
      const double r = std::pow(B.f / A.f, 1.0 - beta);
      std::vector<double> db(static_cast<size_t>(nvb));
      double dbmax = -1e300;
      for (int k = 0; k < nvb; ++k) {
        db[static_cast<size_t>(k)] = 20.0 * std::log10(std::max(B.amp[static_cast<size_t>(k)], 1e-12));
        dbmax = std::max(dbmax, db[static_cast<size_t>(k)]);
      }
      std::vector<double> d;
      for (int k = 0; k < nvb; ++k) {
        const double kap = (k + 1) * r;
        if (!(kap <= nva && db[static_cast<size_t>(k)] > dbmax - 50.0)) continue;
        const double pred = interp1(std::clamp(kap - 1.0, 0.0, static_cast<double>(nva - 1)), A.la, nva);
        d.push_back((pred - B.la[static_cast<size_t>(k)]) * (20.0 / std::log(10.0)));
      }
      if (d.size() < 4) continue;
      double mu = 0;
      for (double v : d) mu += v;
      mu /= static_cast<double>(d.size());
      double s = 0;
      for (double v : d) s += (v - mu) * (v - mu);
      es.push_back(std::sqrt(s / static_cast<double>(d.size())));
    }
  }
  if (es.empty()) return {std::nan(""), 0};
  double m = 0;
  for (double v : es) m += v;
  return {m / static_cast<double>(es.size()), static_cast<int>(es.size())};
}

}  // namespace

double schaetzeMischung(const Stereo& x, const Kurve& k, const std::vector<AudioNote>& liste) {
  std::vector<const AudioNote*> cand;
  for (const AudioNote& n : liste) if (n.qe - n.qa >= MISCH_FENSTER1 - MISCH_FENSTER0 + 0.1) cand.push_back(&n);
  std::stable_sort(cand.begin(), cand.end(), [](const AudioNote* a, const AudioNote* b) { return a->qton < b->qton; });
  if (cand.size() > MISCH_NMAX) {
    std::vector<const AudioNote*> w;
    int letzte = -1;
    const double schritt = static_cast<double>(cand.size() - 1) / static_cast<double>(MISCH_NMAX - 1);
    for (size_t i = 0; i < MISCH_NMAX; ++i) {
      const int idx = static_cast<int>(std::nearbyint(static_cast<double>(i) * schritt));
      if (idx != letzte) w.push_back(cand[static_cast<size_t>(idx)]);
      letzte = idx;
    }
    cand = w;
  }
  std::vector<Probe> sn;
  for (const AudioNote* n : cand) {
    const int64_t s0 = static_cast<int64_t>((n->qa + MISCH_FENSTER0) * SR);
    const int64_t s1 = static_cast<int64_t>(std::min(n->qa + MISCH_FENSTER1, n->qe - 0.03) * SR);
    if (static_cast<double>(s1 - s0) < 0.15 * SR || s1 > x.frames()) continue;
    const Teiltoene an = analysiere(x, k, s0, s1);
    std::vector<size_t> ok;
    for (size_t i = 0; i < an.f0.size(); ++i) if (an.f0[i] > 0.0) ok.push_back(i);
    if (ok.size() < 3) continue;
    size_t kk = 0;
    for (size_t i : ok) kk = std::max({kk, an.b_l[i].size(), an.b_r[i].size()});
    std::vector<double> mean(kk, 0.0), lmean(kk, 0.0), mx(kk, 0.0);
    for (size_t i : ok) {
      for (size_t j = 0; j < kk; ++j) {
        const double a = 0.5 * ((j < an.b_l[i].size() ? std::abs(an.b_l[i][j]) : 0.0) + (j < an.b_r[i].size() ? std::abs(an.b_r[i][j]) : 0.0));
        mean[j] += a;
        lmean[j] += std::log(std::max(a, 1e-12));
        mx[j] = std::max(mx[j], a);
      }
    }
    int nv = 0;
    for (size_t j = 0; j < kk; ++j) if (mx[j] > 0.0) nv = static_cast<int>(j) + 1;
    if (nv == 0) continue;
    Probe p;
    std::vector<double> f;
    for (size_t i : ok) f.push_back(an.f0[i]);
    p.f = median(f);
    p.la.resize(kk);
    p.amp.resize(kk);
    for (size_t j = 0; j < kk; ++j) {
      p.la[j] = lmean[j] / static_cast<double>(ok.size());
      p.amp[j] = mean[j] / static_cast<double>(ok.size());
    }
    p.nv = nv;
    sn.push_back(std::move(p));
  }
  std::pair<double, int> es[5];
  for (int i = 0; i < 5; ++i) es[i] = mischFehler(sn, MISCH_GITTER[i]);
  if (sn.size() < 2 || es[0].second < 3 || std::isnan(es[0].first)) return 0.0;
  int best = 0;
  double bw = 1e300;
  for (int i = 0; i < 5; ++i) {
    const double v = std::isnan(es[i].first) ? 1e300 : es[i].first;
    if (v < bw) { bw = v; best = i; }
  }
  return es[0].first - es[best].first >= MISCH_VORTEIL_DB ? MISCH_GITTER[best] : 0.0;
}

// ------------------------------------------------------------------------------------------------ the render

std::variant<RenderErgebnis, Fehler> rendere(const Stereo& quelle, const Kurve& k, const std::vector<AudioNote>& liste, const Stereo* vorher,
                                             const std::set<std::string>* nur, Stereo& aus, Fortschritt* f) {
  const int64_t n = quelle.frames();
  if (k.frames != n || k.sr != SR || k.hop != HOP || static_cast<int64_t>(k.f0_ct.size()) != frameZahl(n) ||
      static_cast<int64_t>(k.konf.size()) != frameZahl(n))
    return Fehler{"kurve_passt_nicht", "the curve has " + std::to_string(k.frames) + " frames (sr " + std::to_string(k.sr) + ", hop " + std::to_string(k.hop) +
                                           ", " + std::to_string(k.f0_ct.size()) + " values), the source has " + std::to_string(n)};
  if (quelle.r.size() != quelle.l.size()) return Fehler{"datei_kaputt", "the channels of the source differ in length"};
  const bool teil = vorher != nullptr && nur != nullptr;
  if (vorher && (vorher->l.size() != quelle.l.size() || vorher->r.size() != quelle.r.size()))
    return Fehler{"vorher_passt_nicht", "the earlier render has " + std::to_string(vorher->frames()) + " frames, the source has " + std::to_string(n)};
  for (const AudioNote& nt : liste) {
    if (nt.a || nt.e || nt.vib || nt.drift || nt.formant || nt.gain_db)
      return Fehler{"nicht_unterstuetzt", "note " + nt.id + ": only the target ton is rendered in this version"};
  }
  for (const AudioNote& nt : liste) {
    if (!(nt.qe * SR <= static_cast<double>(n + HOP)))
      return Fehler{"noten_ungueltig", "note " + nt.id + " ends after the source"};
  }
  if (teil) {
    for (const std::string& id : *nur) {
      bool da = false;
      for (const AudioNote& nt : liste) da |= nt.id == id;
      if (!da) return Fehler{"argument", "the id " + id + " of --nur is not in the note list"};
    }
  }

  const std::vector<Eintrag> items = eintraege(liste, n);
  std::vector<Gruppe> gruppen;
  if (!gruppiere(items, gruppen)) return Fehler{"noten_ungueltig", "edited notes overlap"};

  RenderErgebnis erg;
  Bereiche R;
  if (teil) {
    aus = *vorher;
    const int64_t rand = static_cast<int64_t>(NUR_RAND_S * SR);
    for (const std::string& id : *nur) {
      for (const AudioNote& nt : liste) {
        if (nt.id != id) continue;
        const int64_t a = static_cast<int64_t>(std::nearbyint(nt.qa * SR)) - rand, e = static_cast<int64_t>(std::nearbyint(nt.qe * SR)) + rand;
        R.push_back({std::clamp<int64_t>(a, 0, n), std::clamp<int64_t>(e, 0, n)});
      }
    }
    vereinige(R);
    for (bool wieder = true; wieder;) {   // grow until every edit group that R touches lies inside it
      wieder = false;
      for (const Gruppe& g : gruppen) {
        if (ueberlappt(R, g.r0, g.r1) && !bedeckt(R, g.r0, g.r1)) {
          R.push_back({g.r0, g.r1});
          vereinige(R);
          wieder = true;
        }
      }
    }
    for (const auto& r : R) {
      std::copy(quelle.l.begin() + r.first, quelle.l.begin() + r.second, aus.l.begin() + r.first);
      std::copy(quelle.r.begin() + r.first, quelle.r.begin() + r.second, aus.r.begin() + r.first);
    }
    erg.bereiche = R;
  } else {
    aus = quelle;
  }

  std::vector<const Gruppe*> zu;
  int64_t gesamt = 0;
  for (const Gruppe& g : gruppen) {
    if (g.r1 - g.r0 < 8) continue;
    if (teil && !ueberlappt(R, g.r0, g.r1)) continue;
    zu.push_back(&g);
    gesamt += g.r1 - g.r0;
  }
  if (zu.empty()) return erg;
  if (f) f->stufe(2, "rendern", 0);
  const double mischung = schaetzeMischung(quelle, k, liste);
  if (abbruchAngefordert()) return Fehler{"abbruch", "interrupted"};
  int64_t fertig = 0;
  for (const Gruppe* g : zu) {
    const int64_t w0 = std::max<int64_t>(0, g->r0 - RAND), w1 = std::min<int64_t>(n, g->r1 + RAND);
    const Teiltoene an = analysiere(quelle, k, w0, w1);
    if (abbruchAngefordert() || !rendereGruppe(quelle, an, *g, mischung, aus)) return Fehler{"abbruch", "interrupted"};
    if (!teil) erg.bereiche.push_back({g->r0, g->r1});
    fertig += g->r1 - g->r0;
    if (f) f->stufe(2, "rendern", 100.0 * static_cast<double>(fertig) / static_cast<double>(gesamt));
  }
  return erg;
}

}  // namespace cdj::noten
