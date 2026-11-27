// Partial analysis and harmonic resynthesis of the engine `teilton-2`: a port of analysiere / harmonisch of m21_k_teilton.py as
// BERICHT_teilton2.md section 8 states it (A: steps 1 to 5, 12). What differs from the numpy prototype, and why:
//  - the window of a frame is sized from the REFINED pitch and a read outside the source gives zero (the prototype sizes it from the curve
//    pitch, fits with the refined one and raises for a very low note at a file edge; the gold of the analysis is generated on the padded path);
//  - every frame stops at its own -80 dB block (the prototype stops per batch of frames);
//  - the mid signal gives ONE phase track for both channels (the struct has one psi); the partials are fitted per channel;
//  - the phase track starts at the start of the analysed stretch (the prototype's: the start of the file). b and psi modulo 2 pi do not
//    depend on that origin except across unvoiced holes: the angle of partial 1 is wrapped to (-pi, pi] before it is interpolated over a
//    hole, as the prototype does, and the wrap depends on the origin. So a few frames next to a hole differ from the gold by more than
//    0.5 dB (6 of 2700 voiced gold frames), and a region analysis equals the whole-file analysis only away from holes;
//  - float kernels: the sums run in single precision on 8 fixed lanes (GCC vector extensions; the build picks AVX2 with FMA or the plain
//    code at run time with target_clones, so two machines agree to float rounding, not bit for bit), the sine and cosine of the window
//    phases come from a polynomial after a reduction in double, and the powers k * theta from the Chebyshev recurrence
//    c(k+1) = 2 cos(theta) c(k) - c(k-1). The prototype demodulates in single precision (complex64) as well; the port is held to the golden
//    vectors (partial amplitudes within 1 percent, block HRR within 0.5 dB on 95 percent of the frames), see test_notes_teiltoene.cpp.
#pragma GCC diagnostic ignored "-Wpsabi"
#include "teiltoene.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <unordered_map>

namespace cdj::noten {
namespace {

using Komplex = std::complex<double>;

constexpr double PI = 3.14159265358979323846;
constexpr double FMAX = 16000.0;      // highest partial frequency in Hz (also limited to 0.49 sr)
constexpr double WIN_S = 0.025;       // window: floor(WIN_S * f0) periods, between 2 and 4
constexpr double SUCHE_CT = 30.0;     // f0 refinement range
constexpr double DEMOD_STOP = 1e-4;   // blocks of 16 partials end when a block is below this share of the largest amplitude (-80 dB)
constexpr int BLOCK = 16;
constexpr int NTRIAL = 7;

typedef float v8 __attribute__((vector_size(32)));

inline v8 laden(const float* p) { v8 v; std::memcpy(&v, p, sizeof v); return v; }
inline void speichern(float* p, v8 v) { std::memcpy(p, &v, sizeof v); }

double hzVonCt(double ct) { return ct > 0 ? 440.0 * std::pow(2.0, (ct / 100.0 - 69.0) / 12.0) : 0.0; }

/// Periods of the window: 4 from 160 Hz, 3 from 120 Hz, 2 below.
double nper(double f) { return std::clamp(std::floor(WIN_S * f), 2.0, 4.0); }
int fensterLaenge(double f, int sr) { return std::max(static_cast<int>(std::nearbyint(nper(f) * sr / f)), 16); }

/// Float buffer, 32 byte aligned, grown on demand.
class Puffer {
 public:
  void groesse(size_t n) {
    if (n + 8 > v_.size()) v_.assign(n + 8, 0.0f);
    p_ = reinterpret_cast<float*>((reinterpret_cast<uintptr_t>(v_.data()) + 31) & ~static_cast<uintptr_t>(31));
    if (static_cast<size_t>(p_ - v_.data()) + n > v_.size()) { v_.assign(n + 16, 0.0f); p_ = reinterpret_cast<float*>((reinterpret_cast<uintptr_t>(v_.data()) + 31) & ~static_cast<uintptr_t>(31)); }
  }
  float* get() { return p_; }
  float& operator[](size_t i) { return p_[i]; }
 private:
  std::vector<float> v_;
  float* p_ = nullptr;
};

/// Hann window of `lf` samples (|n| < lf / 2) and its sum, from the double values as the prototype.
struct Fenster {
  int hw = 0;                  // support n = -hw .. hw
  std::vector<float> w;        // 2 hw + 1 values
  double sw = 0;
};

class FensterCache {
 public:
  const Fenster& hole(int lf) {
    auto it = m_.find(lf);
    if (it != m_.end()) return it->second;
    Fenster f;
    f.hw = (lf - 1) / 2;
    const double half = lf / 2.0;
    f.w.resize(static_cast<size_t>(2 * f.hw + 1));
    for (int n = -f.hw; n <= f.hw; ++n) {
      const double v = std::fabs(static_cast<double>(n)) < half ? 0.5 * (1.0 + std::cos(PI * n / half)) : 0.0;
      f.w[static_cast<size_t>(n + f.hw)] = static_cast<float>(v);
      f.sw += v;
    }
    return m_.emplace(lf, std::move(f)).first->second;
  }
 private:
  std::unordered_map<int, Fenster> m_;
};

typedef double d4 __attribute__((vector_size(32)));
typedef float f4 __attribute__((vector_size(16)));

inline d4 ladeD(const double* p) { d4 v; std::memcpy(&v, p, sizeof v); return v; }

/// cos, sin and 2 cos of the phases g * dphi[n] for n < n16 (a multiple of 8; the caller pads dphi with finite values). The angle is
/// reduced in double (|r| <= pi, then folded into |y| <= pi / 2: sin y = sin r, cos y = -+ cos r), the sine and cosine are float
/// polynomials of degree 11 and 12 on that range (error below 1e-7).
__attribute__((target_clones("avx2,fma", "default")))
void trigFeld(const double* dphi, int n16, double g, float* c2, float* cc, float* sc) {
  const d4 vg = {g, g, g, g};
  const d4 inv2pi = {1.0 / (2.0 * PI), 1.0 / (2.0 * PI), 1.0 / (2.0 * PI), 1.0 / (2.0 * PI)};
  const d4 magic = {6755399441055744.0, 6755399441055744.0, 6755399441055744.0, 6755399441055744.0};   // 1.5 * 2^52: round to nearest even
  const d4 zwei_pi = {2.0 * PI, 2.0 * PI, 2.0 * PI, 2.0 * PI}, pi = {PI, PI, PI, PI}, halb_pi = {0.5 * PI, 0.5 * PI, 0.5 * PI, 0.5 * PI};
  const d4 eins = {1.0, 1.0, 1.0, 1.0}, minus = {-1.0, -1.0, -1.0, -1.0};
  for (int n = 0; n < n16; n += 8) {
    f4 fy[2], fv[2];
    for (int h = 0; h < 2; ++h) {
      const d4 th = ladeD(dphi + n + 4 * h) * vg;
      const d4 q = (th * inv2pi + magic) - magic;
      const d4 r = th - q * zwei_pi;
      const d4 y = r > halb_pi ? pi - r : (r < -halb_pi ? -pi - r : r);
      const d4 vz = (r > halb_pi || r < -halb_pi) ? minus : eins;   // sign of the cosine
      fy[h] = __builtin_convertvector(y, f4);
      fv[h] = __builtin_convertvector(vz, f4);
    }
    float ya[8], va[8];
    std::memcpy(ya, fy, sizeof ya);
    std::memcpy(va, fv, sizeof va);
    const v8 x = laden(ya), sg = laden(va), x2 = x * x;
    const v8 sn = x * (1.0f + x2 * (-1.0f / 6 + x2 * (1.0f / 120 + x2 * (-1.0f / 5040 + x2 * (1.0f / 362880 + x2 * (-1.0f / 39916800))))));
    const v8 cs = sg * (1.0f + x2 * (-0.5f + x2 * (1.0f / 24 + x2 * (-1.0f / 720 + x2 * (1.0f / 40320 + x2 * (-1.0f / 3628800 + x2 * (1.0f / 479001600)))))));
    speichern(cc + n, cs);
    speichern(sc + n, sn);
    speichern(c2 + n, cs + cs);
  }
}

/// Demodulation sums of `kn` partials: accC[16 k + i] += s cos(k theta), accS[16 k + i] += s sin(k theta) (16 lanes per k, the caller adds
/// them up). The recurrence states Cp, Cc (cos of (k-1) and k times theta) and Sp, Sc are advanced and stored, so a following call
/// continues with the next partials.
__attribute__((target_clones("avx2,fma", "default")))
void demodKern(int n16, int kn, const float* s, const float* c2, float* Cp, float* Cc, float* Sp, float* Sc, float* accC, float* accS) {
  for (int t = 0; t < n16; t += 16) {
    v8 cp0 = laden(Cp + t), cp1 = laden(Cp + t + 8), cc0 = laden(Cc + t), cc1 = laden(Cc + t + 8);
    v8 sp0 = laden(Sp + t), sp1 = laden(Sp + t + 8), sc0 = laden(Sc + t), sc1 = laden(Sc + t + 8);
    const v8 s0 = laden(s + t), s1 = laden(s + t + 8), d0 = laden(c2 + t), d1 = laden(c2 + t + 8);
    for (int k = 0; k < kn; ++k) {
      float* ac = accC + 16 * k;
      float* as = accS + 16 * k;
      speichern(ac, laden(ac) + s0 * cc0);
      speichern(ac + 8, laden(ac + 8) + s1 * cc1);
      speichern(as, laden(as) + s0 * sc0);
      speichern(as + 8, laden(as + 8) + s1 * sc1);
      const v8 n0 = d0 * cc0 - cp0, n1 = d1 * cc1 - cp1, m0 = d0 * sc0 - sp0, m1 = d1 * sc1 - sp1;
      cp0 = cc0; cp1 = cc1; cc0 = n0; cc1 = n1;
      sp0 = sc0; sp1 = sc1; sc0 = m0; sc1 = m1;
    }
    speichern(Cp + t, cp0); speichern(Cp + t + 8, cp1); speichern(Cc + t, cc0); speichern(Cc + t + 8, cc1);
    speichern(Sp + t, sp0); speichern(Sp + t + 8, sp1); speichern(Sc + t, sc0); speichern(Sc + t + 8, sc1);
  }
}

/// Per frame scratch space of the fit.
struct Arbeit {
  Puffer s, c2, cc, sc, Cp, Cc, Sp, Sc, accC, accS;
  std::vector<double> dphi;
  FensterCache fenster;
  void groesse(int n16, int kmax) {
    for (Puffer* p : {&s, &c2, &cc, &sc, &Cp, &Cc, &Sp, &Sc}) p->groesse(static_cast<size_t>(n16));
    accC.groesse(static_cast<size_t>(16 * kmax));
    accS.groesse(static_cast<size_t>(16 * kmax));
    if (dphi.size() < static_cast<size_t>(n16)) dphi.resize(static_cast<size_t>(n16));
    // (the lanes of dphi past the window are set to zero by the callers)
  }
  /// States of k = 0 and k = 1 from the cos and sin arrays of the current phases.
  void start(int n16) {
    std::memcpy(Cc.get(), cc.get(), sizeof(float) * static_cast<size_t>(n16));
    std::memcpy(Sc.get(), sc.get(), sizeof(float) * static_cast<size_t>(n16));
    for (int n = 0; n < n16; ++n) { Cp[static_cast<size_t>(n)] = 1.0f; Sp[static_cast<size_t>(n)] = 0.0f; }
  }
  /// One block: accumulates `kn` partials into the (zeroed) sums, returns c_k = sum s e^{-j k theta} for k = 1 .. kn (not scaled).
  void block(int n16, int kn, Komplex* c) {
    std::memset(accC.get(), 0, sizeof(float) * static_cast<size_t>(16 * kn));
    std::memset(accS.get(), 0, sizeof(float) * static_cast<size_t>(16 * kn));
    demodKern(n16, kn, s.get(), c2.get(), Cp.get(), Cc.get(), Sp.get(), Sc.get(), accC.get(), accS.get());
    for (int k = 0; k < kn; ++k) {
      double a = 0, b = 0;
      for (int i = 0; i < 16; ++i) { a += accC[static_cast<size_t>(16 * k + i)]; b += accS[static_cast<size_t>(16 * k + i)]; }
      c[k] = Komplex(a, -b);
    }
  }
};

/// The audio of the analysis: one or two channels (two identical channels are one), reads outside [0, n) give zero.
struct Quelle {
  const float* l;
  const float* r;
  int64_t n;
  bool zwei;
  float wert(const float* x, int64_t i) const { return (i >= 0 && i < n) ? x[i] : 0.0f; }
  /// mono mix (the f0 search) or one channel, windowed by w, into out[0 .. len)
  void fenstern(int kanal, int64_t start, int len, const float* w, float* out) const {
    const bool innen = start >= 0 && start + len <= n;
    for (int i = 0; i < len; ++i) {
      const int64_t idx = start + i;
      float v;
      if (kanal == 0) v = innen ? l[idx] : wert(l, idx);
      else if (kanal == 1) v = innen ? r[idx] : wert(r, idx);
      else v = zwei ? static_cast<float>(0.5 * (static_cast<double>(wert(l, idx)) + static_cast<double>(wert(r, idx)))) : (innen ? l[idx] : wert(l, idx));
      out[i] = v * w[i];
    }
  }
};

/// f per sample on [ps0, ps0 + np): linear between the voiced frames (also across holes), held before the first and after the last.
void fProSample(const std::vector<double>& fr, int64_t jm0, int hop, int64_t ps0, int64_t np, std::vector<double>& out) {
  out.assign(static_cast<size_t>(np), 0.0);
  std::vector<size_t> v;
  for (size_t i = 0; i < fr.size(); ++i) if (fr[i] > 0) v.push_back(i);
  if (v.empty()) return;
  auto t = [&](size_t i) { return static_cast<double>((jm0 + static_cast<int64_t>(i)) * hop); };
  size_t seg = 0;   // the voiced frames v[seg], v[seg + 1] enclose the sample
  for (int64_t i = 0; i < np; ++i) {
    const double p = static_cast<double>(ps0 + i);
    double f;
    if (p <= t(v.front())) f = fr[v.front()];
    else if (p >= t(v.back())) f = fr[v.back()];
    else {
      while (seg + 1 < v.size() && t(v[seg + 1]) <= p) ++seg;
      const double ta = t(v[seg]), tb = t(v[seg + 1]);
      f = fr[v[seg]] + (fr[v[seg + 1]] - fr[v[seg]]) / (tb - ta) * (p - ta);
    }
    out[static_cast<size_t>(i)] = f;
  }
}

/// Exclusive cumulative phase 2 pi sum_{m<i} f[m] / sr.
void phaseAusF(const std::vector<double>& f, int sr, std::vector<double>& phi) {
  phi.resize(f.size());
  double summe = 0.0;
  const double k = 2.0 * PI / sr;
  for (size_t i = 0; i < f.size(); ++i) { phi[i] = k * summe; summe += f[i]; }
}

/// numpy.unwrap (period 2 pi, discontinuity pi).
void entwickle(std::vector<double>& a) {
  double korr = 0.0;
  const std::vector<double> roh = a;
  for (size_t i = 1; i < roh.size(); ++i) {
    const double dd = roh[i] - roh[i - 1];
    double mod = (dd + PI) - 2.0 * PI * std::floor((dd + PI) / (2.0 * PI));
    double ddmod = mod - PI;
    if (ddmod == -PI && dd > 0) ddmod = PI;
    double c = ddmod - dd;
    if (std::fabs(dd) < PI) c = 0.0;
    korr += c;
    a[i] = roh[i] + korr;
  }
}

}  // namespace

Teiltoene analysiere(const Stereo& x, const Kurve& k, int64_t s0, int64_t s1) {
  Teiltoene t;
  const int64_t n = x.frames();
  const int hop = k.hop > 0 ? k.hop : HOP, sr = k.sr > 0 ? k.sr : SR;
  const int64_t nf = static_cast<int64_t>(k.f0_ct.size());
  s0 = std::clamp<int64_t>(s0, 0, n);
  s1 = std::clamp<int64_t>(s1, s0, n);
  t.s0 = s0;
  t.s1 = s1;
  const size_t nsam = static_cast<size_t>(s1 - s0);
  if (nf == 0) {
    t.psi.assign(nsam, 0.0);
    t.phi.assign(nsam, 0.0);
    return t;
  }
  std::vector<double> fIn(static_cast<size_t>(nf));
  for (int64_t j = 0; j < nf; ++j) fIn[static_cast<size_t>(j)] = hzVonCt(k.f0_ct[static_cast<size_t>(j)]);

  const int64_t j0 = std::clamp<int64_t>(s0 / hop, 0, nf - 1);
  const int64_t j1 = std::max(j0, std::clamp<int64_t>((s1 + hop - 1) / hop, 0, nf - 1));
  const size_t nfr = static_cast<size_t>(j1 - j0 + 1);
  t.j0 = j0;
  t.f0.assign(nfr, 0.0);
  t.b_l.assign(nfr, {});
  t.b_r.assign(nfr, {});
  t.alpha1.assign(nfr, 0.0);
  t.alpha1_r.assign(nfr, 0.0);
  t.psi.assign(nsam, 0.0);
  t.psi_r.assign(nsam, 0.0);
  t.phi.assign(nsam, 0.0);

  // pitches around the region (half a second each side) fix the largest window and the margin
  const int64_t lo = std::max<int64_t>(0, j0 * hop - sr / 2) / hop;
  const int64_t hi = std::min<int64_t>(nf - 1, (j1 * hop + sr / 2) / hop);
  double lmaxD = 0.0;
  bool irgendwo = false, imBereich = false;
  for (int64_t j = lo; j <= hi; ++j) {
    const double f = fIn[static_cast<size_t>(j)];
    if (f <= 0) continue;
    irgendwo = true;
    lmaxD = std::max(lmaxD, std::ceil(nper(f) * sr / f));
  }
  for (int64_t j = j0; j <= j1; ++j) if (fIn[static_cast<size_t>(j)] > 0) { imBereich = true; break; }
  if (!irgendwo || !imBereich) return t;   // nothing voiced: no partials, silence
  const int lmax = static_cast<int>(lmaxD) + 2;
  const int64_t m = lmax / 2 / hop + 3;
  const int64_t jm0 = std::max<int64_t>(0, j0 - m), jm1 = std::min<int64_t>(nf - 1, j1 + m);
  // the phase track reaches over every window of a frame of the margin: refined pitches give windows up to 2 percent longer
  const int64_t hwMax = static_cast<int64_t>(lmax * 1.03) / 2 + 16;
  const int64_t ps0 = jm0 * hop - hwMax;
  const int64_t ps1 = std::max(jm1 * hop + hwMax + 1, s1 + 1);
  const int64_t np = ps1 - ps0;

  const bool zwei = x.r.size() == x.l.size() && x.l.size() == static_cast<size_t>(n) && !x.r.empty() &&
                    !(x.r.data() == x.l.data() || (std::memcmp(x.l.data() + std::max<int64_t>(ps0, 0), x.r.data() + std::max<int64_t>(ps0, 0),
                                                              sizeof(float) * static_cast<size_t>(std::max<int64_t>(0, std::min(ps1, n) - std::max<int64_t>(ps0, 0)))) == 0));
  const Quelle q{x.l.data(), zwei ? x.r.data() : x.l.data(), n, zwei};
  const int nk = zwei ? 2 : 1;
  const double fmx = std::min(FMAX, 0.49 * sr);

  Arbeit a;
  std::vector<double> fr(fIn.begin() + jm0, fIn.begin() + jm1 + 1);   // refined f0 of the frames jm0 .. jm1
  std::vector<double> fps, phi;
  const size_t nm = fr.size();

  // ---- pass 1: f0 refinement per voiced frame on the mono mix
  {
    fProSample(fr, jm0, hop, ps0, np, fps);
    phaseAusF(fps, sr, phi);
    double dl[NTRIAL];
    for (int i = 0; i < NTRIAL; ++i) dl[i] = -SUCHE_CT + 10.0 * i;
    for (size_t jr = 0; jr < nm; ++jr) {
      const double fj = fIn[static_cast<size_t>(jm0) + jr];
      if (fj <= 0) continue;
      if ((jr & 31) == 0 && abbruchAngefordert()) return t;
      const int lf = fensterLaenge(fj, sr);
      const Fenster& fw = a.fenster.hole(lf);
      const int len = 2 * fw.hw + 1, n16 = (len + 15) & ~15;
      const int kfit = static_cast<int>(std::min(std::floor(fmx / fj), std::clamp(std::floor(4000.0 / fj), 8.0, 40.0)));
      if (kfit < 1) continue;
      a.groesse(n16, std::max(kfit, 1));
      const int64_t cen = (jm0 + static_cast<int64_t>(jr)) * hop;
      const double* pc = phi.data() + (cen - ps0);
      for (int i = 0; i < len; ++i) a.dphi[static_cast<size_t>(i)] = pc[i - fw.hw] - pc[0];
      for (int i = len; i < n16; ++i) a.dphi[static_cast<size_t>(i)] = 0.0;
      // the energy of the fit summed over the channels (mid and side together; the mono mix alone loses a source whose channels cancel)
      double en[NTRIAL] = {};
      Komplex c[48];
      for (int ci = 0; ci < nk; ++ci) {
        q.fenstern(zwei ? ci : 2, cen - fw.hw, len, fw.w.data(), a.s.get());
        for (int i = len; i < n16; ++i) a.s[static_cast<size_t>(i)] = 0.0f;
        for (int tr = 0; tr < NTRIAL; ++tr) {
          trigFeld(a.dphi.data(), n16, std::pow(2.0, dl[tr] / 1200.0), a.c2.get(), a.cc.get(), a.sc.get());
          a.start(n16);
          a.block(n16, kfit, c);
          double e = 0.0;
          for (int kk = 0; kk < kfit; ++kk) e += std::norm(c[kk]);
          en[tr] += e;
        }
      }
      int im = 0;
      for (int tr = 1; tr < NTRIAL; ++tr) if (en[tr] > en[im]) im = tr;
      double ds = dl[im];
      if (im > 0 && im < NTRIAL - 1) {
        const double den = en[im - 1] - 2.0 * en[im] + en[im + 1];
        if (den < 0) ds += 10.0 * 0.5 * (en[im - 1] - en[im + 1]) / den;
      }
      fr[jr] = fj * std::pow(2.0, ds / 1200.0);
    }
  }

  // ---- pass 2: final fit with the global phase of the refined track, all frames of the region
  fProSample(fr, jm0, hop, ps0, np, fps);
  phaseAusF(fps, sr, phi);
  std::vector<std::vector<Komplex>> cEin[2];   // per channel and frame: c_k (scaled), k = 1 ..
  cEin[0].assign(nfr, {});
  cEin[1].assign(nfr, {});
  std::vector<double> phiZ(nfr, 0.0);          // phase of the track at the frame centre
  std::vector<char> stimmhaft(nfr, 0);
  for (size_t jr = 0; jr < nfr; ++jr) {
    const size_t jm = static_cast<size_t>(j0 - jm0) + jr;
    const double fj = fr[jm];
    if (fj <= 0) continue;
    if ((jr & 31) == 0 && abbruchAngefordert()) return t;
    const int lf = fensterLaenge(fj, sr);
    const Fenster& fw = a.fenster.hole(lf);
    const int len = 2 * fw.hw + 1, n16 = (len + 15) & ~15;
    const int kfr = static_cast<int>(std::floor(fmx / fj));
    if (kfr < 1) continue;
    a.groesse(n16, std::min(kfr, BLOCK));
    const int64_t cen = (j0 + static_cast<int64_t>(jr)) * hop;
    const double* pc = phi.data() + (cen - ps0);
    for (int i = 0; i < len; ++i) a.dphi[static_cast<size_t>(i)] = pc[i - fw.hw] - pc[0];
    for (int i = len; i < n16; ++i) a.dphi[static_cast<size_t>(i)] = 0.0;
    trigFeld(a.dphi.data(), n16, 1.0, a.c2.get(), a.cc.get(), a.sc.get());
    phiZ[jr] = pc[0];
    stimmhaft[jr] = 1;
    for (int ci = 0; ci < nk; ++ci) {
      q.fenstern(ci, cen - fw.hw, len, fw.w.data(), a.s.get());
      for (int i = len; i < n16; ++i) a.s[static_cast<size_t>(i)] = 0.0f;
      a.start(n16);
      std::vector<Komplex>& c = cEin[ci][jr];
      const double skala = 2.0 / std::max(fw.sw, 1e-12);
      double gross = 0.0;
      for (int k0 = 0; k0 < kfr; k0 += BLOCK) {
        const int blk = std::min(BLOCK, kfr - k0);
        Komplex tmp[BLOCK];
        a.block(n16, blk, tmp);
        double amp = 0.0;
        for (int kk = 0; kk < blk; ++kk) { tmp[kk] *= skala; amp = std::max(amp, std::abs(tmp[kk])); c.push_back(tmp[kk]); }
        gross = std::max(gross, amp);
        if (k0 > 0 && amp < DEMOD_STOP * gross) break;
      }
    }
  }

  // ---- relative representation, per channel as in the prototype: the phase reference of a channel is partial 1 of that channel
  std::vector<double> alphaK[2];
  for (int ci = 0; ci < nk; ++ci) {
    std::vector<double> alpha(nfr, 0.0), roh(nfr, 0.0);
    std::vector<Komplex> u(nfr, Komplex(1.0, 0.0));
    std::vector<size_t> ok;
    for (size_t i = 0; i < nfr; ++i) {
      if (!stimmhaft[i] || cEin[ci][i].empty()) continue;
      const Komplex a1 = cEin[ci][i][0];
      const double mag = std::abs(a1);
      u[i] = mag > 1e-12 ? a1 / mag : Komplex(1.0, 0.0);
      roh[i] = std::arg(u[i] * std::polar(1.0, -phiZ[i]));   // the angle of the global coefficient, wrapped as the prototype does
      ok.push_back(i);
    }
    if (!ok.empty()) {
      // hold the voiced values across the unvoiced frames (linear in the frame index, constant at the ends), then unwrap
      size_t seg = 0;
      for (size_t i = 0; i < nfr; ++i) {
        if (i <= ok.front()) alpha[i] = roh[ok.front()];
        else if (i >= ok.back()) alpha[i] = roh[ok.back()];
        else {
          while (seg + 1 < ok.size() && ok[seg + 1] <= i) ++seg;
          const double ta = static_cast<double>(ok[seg]), tb = static_cast<double>(ok[seg + 1]);
          alpha[i] = roh[ok[seg]] + (roh[ok[seg + 1]] - roh[ok[seg]]) / (tb - ta) * (static_cast<double>(i) - ta);
        }
      }
      entwickle(alpha);
    }
    alphaK[ci] = alpha;
    for (size_t i = 0; i < nfr; ++i) {
      if (!stimmhaft[i]) continue;
      std::vector<Komplex>& out = ci == 0 ? t.b_l[i] : t.b_r[i];
      const std::vector<Komplex>& c = cEin[ci][i];
      out.resize(c.size());
      const Komplex uc = std::conj(u[i]);
      Komplex uk(1.0, 0.0);
      for (size_t kk = 0; kk < c.size(); ++kk) { uk *= uc; out[kk] = c[kk] * uk; }
    }
  }
  if (nk == 1) {
    alphaK[1] = alphaK[0];
    for (size_t i = 0; i < nfr; ++i) t.b_r[i] = t.b_l[i];
  }
  for (size_t i = 0; i < nfr; ++i) {
    t.alpha1[i] = alphaK[0][i];
    if (stimmhaft[i]) t.f0[i] = fr[static_cast<size_t>(j0 - jm0) + i];
  }
  t.alpha1_r = alphaK[1];

  // ---- psi per sample and channel: the phase track plus the interpolated phase of partial 1 (held beyond the first and last frame centre)
  t.psi_r.assign(nsam, 0.0);
  for (size_t i = 0; i < nsam; ++i) {
    const int64_t pos = s0 + static_cast<int64_t>(i);
    t.phi[i] = phi[static_cast<size_t>(pos - ps0)];
    const double fpos = static_cast<double>(pos - j0 * hop) / hop;
    for (int ci = 0; ci < 2; ++ci) {
      const std::vector<double>& ak = ci == 0 ? t.alpha1 : t.alpha1_r;
      double al;
      if (fpos <= 0.0) al = ak.front();
      else if (fpos >= static_cast<double>(nfr - 1)) al = ak.back();
      else {
        const size_t m0 = static_cast<size_t>(fpos);
        const double lam = fpos - static_cast<double>(m0);
        al = ak[m0] + lam * (ak[m0 + 1] - ak[m0]);
      }
      (ci == 0 ? t.psi : t.psi_r)[i] = t.phi[i] + al;
    }
  }
  return t;
}

// ------------------------------------------------------------------------------------------------ oscillator bank

namespace {

/// Sum of the partials of one stretch of samples, with b(n) = b0 + lam(n) db: out[n] = sum_k br0 cos(k psi) - bi0 sin(k psi) +
/// lam (dbr cos(k psi) - dbi sin(k psi)). cc, sc, c2: cos, sin, 2 cos of psi; the lanes past the stretch are zero.
__attribute__((target_clones("avx2,fma", "default")))
void synthKern(int n16, int kn, const float* cc, const float* sc, const float* c2, const float* lam, const float* br0, const float* bi0,
               const float* dbr, const float* dbi, float* out) {
  for (int t = 0; t < n16; t += 16) {
    v8 cp0 = {1, 1, 1, 1, 1, 1, 1, 1}, cp1 = cp0, sp0 = {0, 0, 0, 0, 0, 0, 0, 0}, sp1 = sp0;
    v8 cc0 = laden(cc + t), cc1 = laden(cc + t + 8), sc0 = laden(sc + t), sc1 = laden(sc + t + 8);
    const v8 d0 = laden(c2 + t), d1 = laden(c2 + t + 8);
    v8 a0 = sp0, a1 = sp0, b0 = sp0, b1 = sp0;   // partial sums of the constant part (a) and of the slope part (b), two vectors each
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

}  // namespace

void harmonisch(const Teiltoene& t, int kanal, std::vector<double>& h) {
  const size_t nsam = static_cast<size_t>(t.s1 - t.s0);
  h.assign(nsam, 0.0);
  const size_t nfr = t.f0.size();
  if (nfr == 0 || nsam == 0) return;
  const auto& b = kanal == 0 ? t.b_l : t.b_r;
  const int64_t hop = HOP;
  auto tf = [&](size_t i) { return (t.j0 + static_cast<int64_t>(i)) * hop; };

  Puffer cc, sc, c2, lam, out, br0, bi0, dbr, dbi;
  const int maxLen = 3 * HOP + 32;
  cc.groesse(maxLen); sc.groesse(maxLen); c2.groesse(maxLen); lam.groesse(maxLen); out.groesse(maxLen);
  std::vector<double> psiTmp;

  // stretch [a, e) of samples, interval index m with b0 = b[m], b1 = b[m + 1] (or b0 alone), lam = clip((n - tf(m)) / hop, 0, 1)
  auto strecke = [&](int64_t a, int64_t e, size_t m, bool mitEnde) {
    a = std::max(a, t.s0);
    e = std::min(e, t.s1);
    if (e <= a) return;
    const std::vector<Komplex>& u0 = b[m];
    static const std::vector<Komplex> leer;
    const std::vector<Komplex>& u1 = mitEnde ? b[m + 1] : leer;
    const size_t kn = std::max(u0.size(), mitEnde ? u1.size() : size_t{0});
    if (kn == 0) return;
    br0.groesse(kn); bi0.groesse(kn); dbr.groesse(kn); dbi.groesse(kn);
    for (size_t k = 0; k < kn; ++k) {
      const Komplex p = k < u0.size() ? u0[k] : Komplex(0.0, 0.0);
      const Komplex r = mitEnde ? (k < u1.size() ? u1[k] : Komplex(0.0, 0.0)) : p;
      br0[k] = static_cast<float>(p.real());
      bi0[k] = static_cast<float>(p.imag());
      dbr[k] = static_cast<float>(r.real() - p.real());
      dbi[k] = static_cast<float>(r.imag() - p.imag());
    }
    const int len = static_cast<int>(e - a), n16 = (len + 15) & ~15;
    if (n16 > maxLen) return;   // cannot happen: a stretch is at most one hop (the held ends are cut below)
    psiTmp.assign(static_cast<size_t>(n16), 0.0);
    for (int i = 0; i < len; ++i) {
      const int64_t pos = a + i;
      psiTmp[static_cast<size_t>(i)] = (kanal == 0 ? t.psi : t.psi_r)[static_cast<size_t>(pos - t.s0)];
      const double l = mitEnde ? std::clamp(static_cast<double>(pos - tf(m)) / hop, 0.0, 1.0) : 0.0;
      lam[static_cast<size_t>(i)] = static_cast<float>(l);
    }
    for (int i = len; i < n16; ++i) lam[static_cast<size_t>(i)] = 0.0f;
    trigFeld(psiTmp.data(), n16, 1.0, c2.get(), cc.get(), sc.get());
    synthKern(n16, static_cast<int>(kn), cc.get(), sc.get(), c2.get(), lam.get(), br0.get(), bi0.get(), dbr.get(), dbi.get(), out.get());
    for (int i = 0; i < len; ++i) h[static_cast<size_t>(a + i - t.s0)] = out[static_cast<size_t>(i)];
  };
  // a stretch can be longer than the buffer (the held ends): cut it into pieces of at most 2 hops
  auto stueckweise = [&](int64_t a, int64_t e, size_t m, bool mitEnde) {
    const int64_t schritt = 2 * hop;
    for (int64_t p = a; p < e; p += schritt) strecke(p, std::min(e, p + schritt), m, mitEnde);
  };

  if (nfr == 1) {
    stueckweise(t.s0, t.s1, 0, false);
    return;
  }
  stueckweise(t.s0, std::min(t.s1, tf(0)), 0, true);               // before the first centre: b[0] held (lam = 0)
  for (size_t i = 0; i + 1 < nfr; ++i) {
    if (b[i].empty() && b[i + 1].empty()) continue;
    stueckweise(std::max(t.s0, tf(i)), std::min(t.s1, tf(i + 1)), i, true);
  }
  stueckweise(std::max(t.s0, tf(nfr - 1)), t.s1, nfr - 2, true);    // after the last centre: b[last] held (lam = 1)
}


double hrrDb(const Stereo& x, const Kurve& k, int64_t s0, int64_t s1) {
  const int64_t n = x.frames();
  s0 = std::clamp<int64_t>(s0, 0, n);
  s1 = std::clamp<int64_t>(s1, s0, n);
  const Teiltoene t = analysiere(x, k, s0, s1);
  const size_t kanaele = (x.r.size() == x.l.size() && !x.r.empty()) ? 2 : 1;
  double eh = 0.0, er = 0.0;
  std::vector<double> h;
  const int64_t nf = static_cast<int64_t>(k.f0_ct.size());
  for (size_t c = 0; c < kanaele; ++c) {
    harmonisch(t, static_cast<int>(c), h);
    const std::vector<float>& q = c == 0 ? x.l : x.r;
    for (int64_t i = s0; i < s1; ++i) {
      const int64_t j = std::min<int64_t>((i + HOP / 2) / HOP, nf - 1);   // nearest frame centre
      if (j < 0 || !(k.f0_ct[static_cast<size_t>(j)] > 0)) continue;
      const double hi = h[static_cast<size_t>(i - s0)], r = static_cast<double>(q[static_cast<size_t>(i)]) - hi;
      eh += hi * hi;
      er += r * r;
    }
  }
  return 10.0 * std::log10((eh + 1e-20) / (er + 1e-20));
}

}  // namespace cdj::noten
