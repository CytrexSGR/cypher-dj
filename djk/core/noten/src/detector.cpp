// Pitch detector `erkenne`: port of `pyin_hmm` (messungen/M21-noten/m21_k_pyin.py), parameters and constants verbatim.
//
//   1. Pre-filter: zero-phase Butterworth (order 6 x 2) at 5 kHz, so that all scales see the same band.
//   2. Three scales (400..1632 Hz at the input rate with a 10 ms window, 120..400 Hz at half the rate with 20 ms, 29.4..120 Hz at a quarter
//      with 33 ms; decimation by a zero-phase Kaiser FIR like scipy's resample_poly). Per frame and scale the YIN difference function by
//      FFT, its cumulative mean normalised version, the local minima refined by a parabola.
//   3. Candidate weights from a Beta(2, b) threshold distribution (closed form), the eight heaviest candidates per frame.
//   4. HMM: one state per 20 cent bin plus one unvoiced state; Viterbi path and forward-backward voiced posterior.
//   5. Absolute silence gate: RMS over 21 ms below -66 dBFS means no candidates.
// The prototype works on whole arrays; this port works frame by frame (and keeps only what the HMM needs), so memory grows by about 1.5 kB
// per frame. Rounding differs from numpy at the 1e-12 level (own FFT).
#include "detector.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace cdj::noten {
namespace {

// ---- constants of the prototype -----------------------------------------------------------------------------------------------

constexpr double PI = 3.14159265358979323846;
constexpr double F_MIN = 30.0, F_MAX = 1600.0, BIN_CT = 20.0;
constexpr double RAND = 1.02;   // the range is searched 2 percent wider at both ends
constexpr double F_BIN0 = F_MIN / RAND;
const int N_BINS = static_cast<int>(std::ceil(1200.0 * std::log2(F_MAX * RAND / (F_MIN / RAND)) / BIN_CT)) + 1;

struct SkalaDef {
  double rate, w_ms, f_lo, f_hi;
};
// target sample rate, integration window in ms, lowest and highest f. Order: high pitch first.
const std::array<SkalaDef, 3> SKALEN = {{{48000.0, 10.0, 400.0, F_MAX * RAND},
                                         {24000.0, 20.0, 120.0, 400.0},
                                         {12000.0, 33.0, F_MIN / RAND, 120.0}}};

constexpr double BETA_V = 3.0;        // voiced evidence: s ~ Beta(2, b)
constexpr double BETA_C = 6.0;        // relative weight of the candidates
constexpr double GAIN = 1.0;          // likelihood of a voiced bin relative to the unvoiced state
constexpr double P_VU = 0.02;         // voiced -> unvoiced per frame
constexpr double P_UV = 0.10;         // unvoiced -> voiced per frame (spread uniformly over the bins)
constexpr int SPRUNG = 7;             // triangular transition half width in bins
constexpr double SIGMA_BINS = 0.8;    // observation kernel width in bins
constexpr double BAND_HZ = 5000.0;    // common band limit
constexpr double GATE_DB = -66.0;     // absolute silence gate
constexpr double REFINE_BINS = 1.5;   // a refined candidate within this many bins of the decoded bin replaces the bin centre
constexpr int MAX_KAND = 8;           // candidates kept per frame

/// Progress of the detector as stage 2: one line per ten percent at most (the writer of the lines has its own rate limit on top).
struct Meldung {
  Fortschritt* f;
  int letzte = -1;
  void operator()(double prozent) {
    const int s = static_cast<int>(prozent / 10.0);
    if (!f || s == letzte) return;
    letzte = s;
    f->stufe(2, "tonhoehe", prozent);
  }
};

// ---- pre-filter and decimation ------------------------------------------------------------------------------------------------

struct Biquad {
  double b0, b1, b2, a1, a2;
};

/// Butterworth low pass of order 6 as three biquads (bilinear transform, zeros at -1, DC gain 1 per section).
std::array<Biquad, 3> butter6(double fc, double sr) {
  const double wa = std::tan(PI * fc / sr);
  std::array<Biquad, 3> s{};
  for (int m = 0; m < 3; ++m) {
    const double alpha = PI * (2.0 * m + 7.0) / 12.0;   // analog poles at 105, 135, 165 degrees (and their conjugates)
    const double sr_ = wa * std::cos(alpha), si = wa * std::sin(alpha);
    // z = (1 + s) / (1 - s)
    const double dr = 1.0 - sr_, di = -si, nr = 1.0 + sr_, ni = si;
    const double den = dr * dr + di * di;
    const double zr = (nr * dr + ni * di) / den, zi = (ni * dr - nr * di) / den;
    const double a1 = -2.0 * zr, a2 = zr * zr + zi * zi;
    const double g = (1.0 + a1 + a2) / 4.0;
    s[static_cast<size_t>(m)] = {g, 2.0 * g, g, a1, a2};
  }
  return s;
}

/// One biquad section in place, direct form II transposed, state started at the steady state of a constant `x0`.
void biquadLauf(const Biquad& q, std::vector<double>& v, double x0) {
  double z1 = (1.0 - q.b0) * x0, z2 = (q.b2 - q.a2) * x0;
  for (double& s : v) {
    const double in = s;
    const double out = q.b0 * in + z1;
    z1 = q.b1 * in - q.a1 * out + z2;
    z2 = q.b2 * in - q.a2 * out;
    s = out;
  }
}

/// scipy.signal.sosfiltfilt: odd extension by 3 * 7 samples, forward and backward pass with steady state initial conditions. n > 21.
std::vector<double> filtfilt(const std::array<Biquad, 3>& sos, const std::vector<float>& x) {
  const size_t n = x.size();
  const size_t pad = 21;
  std::vector<double> e(n + 2 * pad);
  for (size_t i = 0; i < pad; ++i) e[i] = 2.0 * x[0] - x[pad - i];
  for (size_t i = 0; i < n; ++i) e[pad + i] = x[i];
  for (size_t j = 0; j < pad; ++j) e[pad + n + j] = 2.0 * x[n - 1] - x[n - 2 - j];
  double x0 = e[0];
  for (const Biquad& q : sos) biquadLauf(q, e, x0);
  std::reverse(e.begin(), e.end());
  x0 = e[0];
  for (const Biquad& q : sos) biquadLauf(q, e, x0);
  std::reverse(e.begin(), e.end());
  return std::vector<double>(e.begin() + static_cast<std::ptrdiff_t>(pad), e.begin() + static_cast<std::ptrdiff_t>(pad + n));
}

double besselI0(double x) {
  double s = 1.0, t = 1.0;
  const double q = x * x / 4.0;
  for (int k = 1; k < 200; ++k) {
    t *= q / (static_cast<double>(k) * k);
    s += t;
    if (t < 1e-17 * s) break;
  }
  return s;
}

/// firwin(2 * 10 * dec + 1, 1 / dec, window=('kaiser', 5.0)): the low pass of scipy's resample_poly(x, 1, dec), DC gain 1.
std::vector<double> decimierFilter(int dec) {
  const int half = 10 * dec;
  const int m = 2 * half + 1;
  const double alpha = (m - 1) / 2.0, c = 1.0 / dec, beta = 5.0;
  std::vector<double> h(static_cast<size_t>(m));
  double sum = 0.0;
  for (int i = 0; i < m; ++i) {
    const double t = i - alpha;
    const double sinc = t == 0.0 ? 1.0 : std::sin(PI * c * t) / (PI * c * t);
    const double u = t / alpha;
    const double win = besselI0(beta * std::sqrt(std::max(0.0, 1.0 - u * u))) / besselI0(beta);
    h[static_cast<size_t>(i)] = c * sinc * win;
    sum += h[static_cast<size_t>(i)];
  }
  for (double& v : h) v /= sum;
  return h;
}

/// resample_poly(x, 1, dec): y[n] = sum_i h[i] x[n dec + 10 dec - i], zeros outside, ceil(len / dec) samples.
std::vector<double> dezimiere(const std::vector<double>& x, int dec) {
  const std::vector<double> h = decimierFilter(dec);
  const int64_t half = 10 * dec, len = static_cast<int64_t>(x.size());
  const int64_t nout = len / dec + (len % dec != 0 ? 1 : 0);
  std::vector<double> y(static_cast<size_t>(nout));
  for (int64_t n = 0; n < nout; ++n) {
    const int64_t c = n * dec;   // the centre tap sits on x[c]; h is symmetric
    double acc = h[static_cast<size_t>(half)] * x[static_cast<size_t>(c)];
    for (int64_t k = 1; k <= half; ++k) {
      const int64_t lo = c - k, hi = c + k;
      const double a = lo >= 0 ? x[static_cast<size_t>(lo)] : 0.0;
      const double b = hi < len ? x[static_cast<size_t>(hi)] : 0.0;
      acc += h[static_cast<size_t>(half + k)] * (a + b);
    }
    y[static_cast<size_t>(n)] = acc;
  }
  return y;
}

// ---- FFT without bit reversal -------------------------------------------------------------------------------------------------

/// Complex FFT of a power of two size N in split (re, im) form: `vor` takes natural order and leaves bit reversed order (decimation in
/// frequency), `rueck` takes bit reversed order and gives natural order, scaled by 1 / N (decimation in time). The point wise work between
/// them goes through `pos[k]`, the position of frequency k.
class Fft {
 public:
  explicit Fft(int n) : n_(n), pos_(static_cast<size_t>(n)) {
    int bits = 0;
    while ((1 << bits) < n) ++bits;
    for (int k = 0; k < n; ++k) {
      int r = 0;
      for (int b = 0; b < bits; ++b) if (k & (1 << b)) r |= 1 << (bits - 1 - b);
      pos_[static_cast<size_t>(k)] = r;
    }
    for (int len = 2; len <= n; len <<= 1) {
      std::vector<double> wr(static_cast<size_t>(len / 2)), wi(static_cast<size_t>(len / 2));
      for (int j = 0; j < len / 2; ++j) {
        const double ph = 2.0 * PI * j / len;
        wr[static_cast<size_t>(j)] = std::cos(ph);
        wi[static_cast<size_t>(j)] = std::sin(ph);   // conjugated in the forward direction
      }
      twr_.push_back(std::move(wr));
      twi_.push_back(std::move(wi));
    }
  }
  int n() const { return n_; }
  int pos(int k) const { return pos_[static_cast<size_t>(k)]; }

  void vor(double* re, double* im) const {
    int stage = static_cast<int>(twr_.size()) - 1;
    for (int len = n_; len >= 2; len >>= 1, --stage) {
      const int half = len >> 1;
      const double* wr = twr_[static_cast<size_t>(stage)].data();
      const double* wi = twi_[static_cast<size_t>(stage)].data();
      for (int i = 0; i < n_; i += len) {
        double* ar = re + i; double* ai = im + i;
        double* br = ar + half; double* bi = ai + half;
        for (int j = 0; j < half; ++j) {
          const double ur = ar[j], ui = ai[j], vr = br[j], vi = bi[j];
          ar[j] = ur + vr;
          ai[j] = ui + vi;
          const double dr = ur - vr, di = ui - vi;
          br[j] = dr * wr[j] + di * wi[j];     // times exp(-i ph)
          bi[j] = di * wr[j] - dr * wi[j];
        }
      }
    }
  }

  void rueck(double* re, double* im) const {
    int stage = 0;
    for (int len = 2; len <= n_; len <<= 1, ++stage) {
      const int half = len >> 1;
      const double* wr = twr_[static_cast<size_t>(stage)].data();
      const double* wi = twi_[static_cast<size_t>(stage)].data();
      for (int i = 0; i < n_; i += len) {
        double* ar = re + i; double* ai = im + i;
        double* br = ar + half; double* bi = ai + half;
        for (int j = 0; j < half; ++j) {
          const double vr = br[j] * wr[j] - bi[j] * wi[j];    // times exp(+i ph)
          const double vi = br[j] * wi[j] + bi[j] * wr[j];
          const double ur = ar[j], ui = ai[j];
          ar[j] = ur + vr;
          ai[j] = ui + vi;
          br[j] = ur - vr;
          bi[j] = ui - vi;
        }
      }
    }
    const double s = 1.0 / n_;
    for (int i = 0; i < n_; ++i) { re[i] *= s; im[i] *= s; }
  }

 private:
  int n_;
  std::vector<int> pos_;
  std::vector<std::vector<double>> twr_, twi_;   // per stage (len 2, 4, ..., N): exp(+2 pi i j / len), j < len / 2
};

// ---- one analysis scale -------------------------------------------------------------------------------------------------------

struct Dip {
  double v;   // dip value of d' (parabola refined)
  double f;   // refined frequency in Hz
};

/// The dips of one scale for every frame: dips[off[t] .. off[t + 1]) in the order of rising lag (falling pitch).
struct SkalaErgebnis {
  std::vector<Dip> dips;
  std::vector<uint32_t> off;
};

double survival(double v, double b) {
  v = std::min(1.0, std::max(0.0, v));
  return std::pow(1.0 - v, b) * (1.0 + b * v);
}

/// One analysis scale (`_skala` of the prototype). xs is the signal at rate rs = sr / dec. Frames with aktiv[t] == 0 are skipped (the silence
/// gate zeroes their candidates anyway). Progress p0..p1 percent of the whole detector.
void skala(const std::vector<double>& xs, double rs, int dec, int nf, const SkalaDef& sd, const std::vector<char>& aktiv, SkalaErgebnis& out,
           Meldung& fort, double p0, double p1) {
  const int lagLo = std::max(2, static_cast<int>(std::floor(rs / sd.f_hi)) - 1);
  const int lagHi = static_cast<int>(std::ceil(rs / sd.f_lo)) + 1;
  const int w = static_cast<int>(std::nearbyint(sd.w_ms * 1e-3 * rs));
  const double lagMid = 0.5 * (rs / sd.f_hi + rs / sd.f_lo);
  const int length = w + lagHi + 2;
  int nfft = 1;
  while (nfft < length) nfft <<= 1;
  const int ntau = lagHi + 3;   // d and d' are needed for tau = 0 .. lagHi + 2
  const double centreStep = static_cast<double>(HOP) / dec;
  const int64_t len = static_cast<int64_t>(xs.size());

  const Fft fft(nfft);
  std::vector<double> zr[2], zi[2], wr(static_cast<size_t>(nfft)), wi(static_cast<size_t>(nfft));
  for (int k = 0; k < 2; ++k) { zr[k].assign(static_cast<size_t>(nfft), 0.0); zi[k].assign(static_cast<size_t>(nfft), 0.0); }
  std::vector<double> fr[2], e[2];
  for (int k = 0; k < 2; ++k) { fr[k].assign(static_cast<size_t>(length), 0.0); e[k].assign(static_cast<size_t>(length) + 1, 0.0); }
  std::vector<double> dn(static_cast<size_t>(ntau));

  out.off.assign(static_cast<size_t>(nf) + 1, 0);
  out.dips.clear();

  // frames in pairs: two real correlations per complex inverse FFT
  std::vector<int> frames;
  for (int t = 0; t < nf; ++t) if (aktiv[static_cast<size_t>(t)]) frames.push_back(t);

  std::vector<std::vector<Dip>> neu(2);
  size_t next = 0;   // frame t of the output offsets still to close
  auto schliesse = [&](int bis, const std::vector<Dip>* d0, int t0) {
    // closes offsets up to frame `bis` (exclusive), adding the dips of frame t0 (if any) at its place
    while (static_cast<int>(next) < bis) {
      if (d0 && static_cast<int>(next) == t0) out.dips.insert(out.dips.end(), d0->begin(), d0->end());
      ++next;
      out.off[next] = static_cast<uint32_t>(out.dips.size());
    }
  };

  for (size_t fi = 0; fi < frames.size(); fi += 2) {
    if (abbruchAngefordert()) return;
    const int cnt = fi + 1 < frames.size() ? 2 : 1;
    for (int k = 0; k < 2; ++k) {
      std::fill(zr[k].begin(), zr[k].end(), 0.0);
      std::fill(zi[k].begin(), zi[k].end(), 0.0);
      if (k >= cnt) continue;
      const int t = frames[fi + static_cast<size_t>(k)];
      const double centre = t * centreStep;
      const int64_t st = static_cast<int64_t>(std::nearbyint(centre - 0.5 * (w + lagMid)));
      double* f = fr[k].data();
      for (int j = 0; j < length; ++j) {
        const int64_t p = st + j;
        f[j] = (p >= 0 && p < len) ? xs[static_cast<size_t>(p)] : 0.0;
      }
      double* ek = e[k].data();
      ek[0] = 0.0;
      for (int j = 0; j < length; ++j) ek[j + 1] = ek[j] + f[j] * f[j];
      for (int j = 0; j < w; ++j) zr[k][static_cast<size_t>(j)] = f[j];
      for (int j = 0; j < length; ++j) zi[k][static_cast<size_t>(j)] = f[j];
      fft.vor(zr[k].data(), zi[k].data());
    }
    // C[k] = conj(FFT(a)) FFT(fr) of both frames in one spectrum W = C1 + i C2
    for (int k = 0; k < nfft; ++k) {
      const size_t p = static_cast<size_t>(fft.pos(k)), q = static_cast<size_t>(fft.pos((nfft - k) & (nfft - 1)));
      double c[2][2] = {{0, 0}, {0, 0}};
      for (int m = 0; m < cnt; ++m) {
        const double zre = zr[m][p], zim = zi[m][p], qre = zr[m][q], qim = zi[m][q];
        const double ar = 0.5 * (zre + qre), ai = 0.5 * (zim - qim);       // A = FFT(a)
        const double br = 0.5 * (zim + qim), bi = -0.5 * (zre - qre);      // B = FFT(fr)
        c[m][0] = ar * br + ai * bi;
        c[m][1] = ar * bi - ai * br;
      }
      wr[p] = c[0][0] - c[1][1];
      wi[p] = c[0][1] + c[1][0];
    }
    fft.rueck(wr.data(), wi.data());

    for (int m = 0; m < cnt; ++m) {
      const int t = frames[fi + static_cast<size_t>(m)];
      const double* r = m == 0 ? wr.data() : wi.data();
      const double* ek = e[m].data();
      const double ea = ek[w];
      double cs = 0.0;
      dn[0] = 1.0;
      for (int tau = 1; tau < ntau; ++tau) {
        const double eb = ek[w + tau] - ek[tau];
        double dv = ea + eb - 2.0 * r[tau];
        if (dv < 0.0) dv = 0.0;
        cs += dv;
        dn[static_cast<size_t>(tau)] = cs > 1e-12 * (1.0 + ea) ? dv * tau / cs : 1.0;
      }
      std::vector<Dip>& dl = neu[static_cast<size_t>(m)];
      dl.clear();
      for (int lag = lagLo; lag <= lagHi; ++lag) {
        const double left = dn[static_cast<size_t>(lag - 1)], mid = dn[static_cast<size_t>(lag)], right = dn[static_cast<size_t>(lag + 1)];
        if (!(mid < left && mid <= right && mid < 1.0)) continue;
        const double den = left - 2.0 * mid + right;
        double delta = den > 1e-12 ? 0.5 * (left - right) / den : 0.0;
        delta = std::min(0.5, std::max(-0.5, delta));
        const double freq = rs / (lag + delta);
        if (!(freq >= sd.f_lo && freq <= sd.f_hi)) continue;
        dl.push_back({mid - 0.25 * delta * (left - right), freq});
      }
      schliesse(t, nullptr, 0);
      schliesse(t + 1, &dl, t);
    }
    fort(p0 + (p1 - p0) * static_cast<double>(fi) / static_cast<double>(std::max<size_t>(frames.size(), 1)));
  }
  schliesse(nf, nullptr, 0);
}

// ---- HMM ----------------------------------------------------------------------------------------------------------------------

struct Kandidaten {
  std::vector<double> f, w;   // nf * MAX_KAND, weight 0 = unused
};

/// Observation of frame t: likelihood of the voiced bins (float like the prototype) and of the unvoiced state.
struct Beobachtung {
  const Kandidaten& k;
  std::vector<float> lv;
  explicit Beobachtung(const Kandidaten& kk) : k(kk), lv(static_cast<size_t>(N_BINS)) {}
  double zeile(size_t t) {
    std::fill(lv.begin(), lv.end(), 0.0f);
    double sum = 0.0;
    for (int c = 0; c < MAX_KAND; ++c) {
      const double wgt = k.w[t * MAX_KAND + static_cast<size_t>(c)];
      sum += wgt;
      if (!(wgt > 0.0)) continue;
      const double pos = 1200.0 * std::log2(k.f[t * MAX_KAND + static_cast<size_t>(c)] / F_BIN0) / BIN_CT;
      const int base = static_cast<int>(std::nearbyint(pos));
      for (int off = -3; off <= 3; ++off) {
        const int kk = base + off;
        if (kk < 0 || kk >= N_BINS) continue;
        const double g = wgt * std::exp(-((kk - pos) * (kk - pos)) / (2.0 * SIGMA_BINS * SIGMA_BINS));
        lv[static_cast<size_t>(kk)] += static_cast<float>(g);
      }
    }
    return 1.0 - std::min(sum, 1.0);
  }
};

struct Modell {
  std::array<double, 2 * SPRUNG + 1> tri;   // triangular transition weights (sum 1)
  Modell() {
    double s = 0.0;
    for (int o = -SPRUNG; o <= SPRUNG; ++o) { tri[static_cast<size_t>(o + SPRUNG)] = SPRUNG + 1 - std::abs(o); s += tri[static_cast<size_t>(o + SPRUNG)]; }
    for (double& v : tri) v /= s;
  }
};

/// Most probable path: bin index, or -1 for unvoiced.
std::vector<int> viterbi(const Kandidaten& kand, size_t nf, const Modell& mod, Meldung& fort, double p0, double p1) {
  const int N = N_BINS;
  std::array<double, 2 * SPRUNG + 1> ltri{};
  for (size_t k = 0; k < ltri.size(); ++k) ltri[k] = std::log(mod.tri[k] * (1.0 - P_VU));
  const double lpvu = std::log(P_VU), luu = std::log(1.0 - P_UV), lub = std::log(P_UV / N);
  const double lEps = std::log(static_cast<double>(static_cast<float>(1e-9)));
  Beobachtung obs(kand);
  std::vector<double> sb(static_cast<size_t>(N)), nb(static_cast<size_t>(N)), lov(static_cast<size_t>(N));
  std::vector<int8_t> bpB(nf * static_cast<size_t>(N), 0);
  std::vector<int32_t> bpU(nf, 0);
  auto logZeile = [&](size_t t) {
    const double lu = obs.zeile(t);
    for (int b = 0; b < N; ++b) {
      const float v = obs.lv[static_cast<size_t>(b)];
      lov[static_cast<size_t>(b)] = v == 0.0f ? lEps : std::log(static_cast<double>(v) + 1e-9);
    }
    return std::log(lu + 1e-9);
  };
  double lou = logZeile(0);
  for (int b = 0; b < N; ++b) sb[static_cast<size_t>(b)] = lov[static_cast<size_t>(b)] + lub;
  double su = lou + luu;
  for (size_t t = 1; t < nf; ++t) {
    if ((t & 1023) == 0) {
      if (abbruchAngefordert()) return std::vector<int>(nf, -1);
      fort(p0 + (p1 - p0) * static_cast<double>(t) / static_cast<double>(nf));
    }
    lou = logZeile(t);
    const double fu = su + lub;
    int8_t* bp = &bpB[t * static_cast<size_t>(N)];
    for (int b = 0; b < N; ++b) {
      double best = -std::numeric_limits<double>::infinity();
      int kb = 0;
      const int kLo = std::max(0, SPRUNG - b), kHi = std::min(2 * SPRUNG, N - 1 - b + SPRUNG);
      for (int k = kLo; k <= kHi; ++k) {
        const double c = sb[static_cast<size_t>(b + k - SPRUNG)] + ltri[static_cast<size_t>(k)];
        if (c > best) { best = c; kb = k; }
      }
      if (fu > best) { nb[static_cast<size_t>(b)] = fu + lov[static_cast<size_t>(b)]; bp[b] = 127; }
      else { nb[static_cast<size_t>(b)] = best + lov[static_cast<size_t>(b)]; bp[b] = static_cast<int8_t>(kb - SPRUNG); }
    }
    int kbest = 0;
    for (int b = 1; b < N; ++b) if (sb[static_cast<size_t>(b)] > sb[static_cast<size_t>(kbest)]) kbest = b;
    const double fb = sb[static_cast<size_t>(kbest)] + lpvu;
    double nu;
    if (fb > su + luu) { nu = fb + lou; bpU[t] = kbest; }
    else { nu = su + luu + lou; bpU[t] = -1; }
    sb.swap(nb);
    su = nu;
  }
  std::vector<int> path(nf, -1);
  int bmax = 0;
  for (int b = 1; b < N; ++b) if (sb[static_cast<size_t>(b)] > sb[static_cast<size_t>(bmax)]) bmax = b;
  int state = su >= sb[static_cast<size_t>(bmax)] ? -1 : bmax;
  for (size_t t = nf; t-- > 0;) {
    path[t] = state;
    if (t == 0) break;
    if (state < 0) state = bpU[t];
    else {
      const int o = bpB[t * static_cast<size_t>(N) + static_cast<size_t>(state)];
      state = o == 127 ? -1 : state + o;
    }
  }
  return path;
}

/// Voiced posterior per frame by scaled forward-backward.
std::vector<double> posterior(const Kandidaten& kand, size_t nf, const Modell& mod, Meldung& fort, double p0, double p1) {
  const int N = N_BINS;
  const int d = SPRUNG;
  std::array<double, 2 * SPRUNG + 1> wt{};
  for (size_t k = 0; k < wt.size(); ++k) wt[k] = mod.tri[k] * (1.0 - P_VU);
  Beobachtung obs(kand);
  std::vector<float> al(nf * static_cast<size_t>(N));
  std::vector<double> au(nf), ov(static_cast<size_t>(N)), pad(static_cast<size_t>(N + 2 * d), 0.0), nbv(static_cast<size_t>(N));
  auto zeile = [&](size_t t) {
    const double lu = obs.zeile(t);
    for (int b = 0; b < N; ++b) ov[static_cast<size_t>(b)] = static_cast<double>(obs.lv[static_cast<size_t>(b)]) + 1e-9;
    return lu + 1e-9;
  };
  double ou = zeile(0);
  double sum = 0.0;
  for (int b = 0; b < N; ++b) { pad[static_cast<size_t>(d + b)] = ov[static_cast<size_t>(b)] / N; sum += pad[static_cast<size_t>(d + b)]; }
  double aU = ou;
  {
    const double s = sum + aU;
    sum = 0.0;
    for (int b = 0; b < N; ++b) { pad[static_cast<size_t>(d + b)] /= s; sum += pad[static_cast<size_t>(d + b)]; }
    aU /= s;
    for (int b = 0; b < N; ++b) al[static_cast<size_t>(b)] = static_cast<float>(pad[static_cast<size_t>(d + b)]);
    au[0] = aU;
  }
  for (size_t t = 1; t < nf; ++t) {
    if ((t & 1023) == 0) {
      if (abbruchAngefordert()) return std::vector<double>(nf, 0.0);
      fort(p0 + (p1 - p0) * 0.5 * static_cast<double>(t) / static_cast<double>(nf));
    }
    ou = zeile(t);
    const double entry = aU * P_UV / N;
    double s = 0.0;
    for (int b = 0; b < N; ++b) {
      double acc = 0.0;
      for (int k = 0; k <= 2 * d; ++k) acc += pad[static_cast<size_t>(b + k)] * wt[static_cast<size_t>(k)];
      nbv[static_cast<size_t>(b)] = (acc + entry) * ov[static_cast<size_t>(b)];
      s += nbv[static_cast<size_t>(b)];
    }
    const double nu = (sum * P_VU + aU * (1.0 - P_UV)) * ou;
    s += nu;
    sum = 0.0;
    for (int b = 0; b < N; ++b) {
      pad[static_cast<size_t>(d + b)] = nbv[static_cast<size_t>(b)] / s;
      sum += pad[static_cast<size_t>(d + b)];
      al[t * static_cast<size_t>(N) + static_cast<size_t>(b)] = static_cast<float>(pad[static_cast<size_t>(d + b)]);
    }
    aU = nu / s;
    au[t] = aU;
  }
  std::vector<double> post(nf, 0.0);
  {
    double s = 0.0;
    for (int b = 0; b < N; ++b) s += al[(nf - 1) * static_cast<size_t>(N) + static_cast<size_t>(b)];
    post[nf - 1] = s;
  }
  std::vector<double> bb(static_cast<size_t>(N), 1.0), gb(static_cast<size_t>(N));
  std::fill(pad.begin(), pad.end(), 0.0);
  double bu = 1.0;
  for (size_t t = nf - 1; t-- > 0;) {
    if ((t & 1023) == 0) {
      if (abbruchAngefordert()) return std::vector<double>(nf, 0.0);
      fort(p0 + (p1 - p0) * (0.5 + 0.5 * (1.0 - static_cast<double>(t) / static_cast<double>(nf))));
    }
    const double ouN = zeile(t + 1);
    double gsum = 0.0;
    for (int b = 0; b < N; ++b) {
      gb[static_cast<size_t>(b)] = ov[static_cast<size_t>(b)] * bb[static_cast<size_t>(b)];
      pad[static_cast<size_t>(d + b)] = gb[static_cast<size_t>(b)];
      gsum += gb[static_cast<size_t>(b)];
    }
    const double gu = ouN * bu;
    double mx = 0.0;
    for (int b = 0; b < N; ++b) {
      double acc = 0.0;
      for (int k = 0; k <= 2 * d; ++k) acc += pad[static_cast<size_t>(b + k)] * wt[static_cast<size_t>(k)];
      nbv[static_cast<size_t>(b)] = acc + P_VU * gu;
      mx = std::max(mx, nbv[static_cast<size_t>(b)]);
    }
    const double nbu = P_UV / N * gsum + (1.0 - P_UV) * gu;
    const double sc = std::max(mx, nbu);
    for (int b = 0; b < N; ++b) bb[static_cast<size_t>(b)] = nbv[static_cast<size_t>(b)] / sc;
    bu = nbu / sc;
    double v = 0.0;
    for (int b = 0; b < N; ++b) v += static_cast<double>(al[t * static_cast<size_t>(N) + static_cast<size_t>(b)]) * bb[static_cast<size_t>(b)];
    const double u = au[t] * bu;
    post[t] = v + u > 0.0 ? v / (v + u) : 0.0;
  }
  return post;
}

}  // namespace

Kurve erkenne(const std::vector<float>& monoIn, int sr, Fortschritt* fortschritt) {
  Meldung fort{fortschritt};
  const size_t n = monoIn.size();
  const size_t nf = n / HOP + 1;
  Kurve kurve;
  kurve.sr = sr;
  kurve.hop = HOP;
  kurve.frames = static_cast<int64_t>(n);
  kurve.detektor = "pyin";
  kurve.kurve = std::string(DETEKTOR_VERSION) + "." + std::string(SEGMENTIERER_VERSION);
  kurve.f0_ct.assign(nf, 0.0);
  kurve.konf.assign(nf, 0.0);
  if (n == 0) return kurve;

  // non finite samples count as 0 (the prototype's nan_to_num would turn an infinity into the largest double)
  std::vector<float> sauber;
  const std::vector<float>* px = &monoIn;
  for (float v : monoIn) {
    if (!std::isfinite(v)) {
      sauber = monoIn;
      for (float& s : sauber) if (!std::isfinite(s)) s = 0.0f;
      px = &sauber;
      break;
    }
  }
  const std::vector<float>& x = *px;

  // absolute silence gate: RMS over 21 ms around the frame centre
  const int64_t h = static_cast<int64_t>(0.0105 * sr);
  const double gate = std::pow(10.0, GATE_DB / 20.0);
  std::vector<char> aktiv(nf, 0);
  {
    // direct window sums (about 1000 samples per frame): no running prefix, so no memory per sample and no cancellation
    const int64_t len = static_cast<int64_t>(n);
    for (size_t t = 0; t < nf; ++t) {
      const int64_t ctr = std::min<int64_t>(static_cast<int64_t>(t) * HOP, len);
      const int64_t lo = std::max<int64_t>(ctr - h, 0), hi = std::min<int64_t>(ctr + h, len);
      double s = 0.0;
      for (int64_t i = lo; i < hi; ++i) s += static_cast<double>(x[static_cast<size_t>(i)]) * static_cast<double>(x[static_cast<size_t>(i)]);
      const double rms = std::sqrt(s / static_cast<double>(std::max<int64_t>(hi - lo, 1)));
      aktiv[t] = rms < gate ? 0 : 1;
    }
  }
  bool irgendwas = false;
  for (char a : aktiv) irgendwas = irgendwas || a;
  if (!irgendwas) return kurve;

  // pre-filter (common band limit) and the three scales
  std::vector<double> xf;
  if (n > 64) xf = filtfilt(butter6(std::min(BAND_HZ, 0.45 * sr), sr), x);
  else xf.assign(x.begin(), x.end());

  std::array<SkalaErgebnis, 3> skalen;
  for (size_t s = 0; s < SKALEN.size(); ++s) {
    const int dec = std::max(1, static_cast<int>(std::nearbyint(sr / SKALEN[s].rate)));
    const double p0 = 75.0 * static_cast<double>(s) / 3.0, p1 = 75.0 * static_cast<double>(s + 1) / 3.0;
    if (dec > 1) {
      const std::vector<double> xs = dezimiere(xf, dec);
      skala(xs, static_cast<double>(sr) / dec, dec, static_cast<int>(nf), SKALEN[s], aktiv, skalen[s], fort, p0, p1);
    } else {
      skala(xf, static_cast<double>(sr), dec, static_cast<int>(nf), SKALEN[s], aktiv, skalen[s], fort, p0, p1);
    }
    if (abbruchAngefordert()) return kurve;
  }
  xf = std::vector<double>();

  // candidates: the dips in the order high to low pitch; a dip lower than every dip of higher pitch gets the weight S(v) - S(previous lowest)
  Kandidaten kand;
  kand.f.assign(nf * MAX_KAND, 0.0);
  kand.w.assign(nf * MAX_KAND, 0.0);
  {
    struct Roh { double f, wv, rel; };
    std::vector<Roh> roh;
    std::vector<size_t> idx;
    for (size_t t = 0; t < nf; ++t) {
      if (!aktiv[t]) continue;
      roh.clear();
      double lowest = 1.0, sumWv = 0.0, sumRel = 0.0;
      for (const auto& sk : skalen) {
        for (uint32_t i = sk.off[t]; i < sk.off[t + 1]; ++i) {
          const Dip& dp = sk.dips[i];
          if (dp.v < lowest) {
            const double wv = survival(dp.v, BETA_V) - survival(lowest, BETA_V);
            const double wc = survival(dp.v, BETA_C) - survival(lowest, BETA_C);
            const double rel = wc + 1e-3 * wv;
            roh.push_back({dp.f, wv, rel});
            sumWv += wv;
            sumRel += rel;
            lowest = dp.v;
          }
        }
      }
      if (roh.empty()) continue;
      const double scale = sumWv / std::max(sumRel, 1e-300);
      idx.resize(roh.size());
      for (size_t i = 0; i < idx.size(); ++i) idx[i] = i;
      const size_t k = std::min<size_t>(MAX_KAND, idx.size());
      std::partial_sort(idx.begin(), idx.begin() + static_cast<std::ptrdiff_t>(k), idx.end(), [&](size_t a, size_t b) {
        const double wa = scale * roh[a].rel, wb = scale * roh[b].rel;
        return wa > wb || (wa == wb && a < b);
      });
      for (size_t i = 0; i < k; ++i) {
        kand.f[t * MAX_KAND + i] = roh[idx[i]].f;
        kand.w[t * MAX_KAND + i] = scale * roh[idx[i]].rel;
      }
    }
  }
  skalen = std::array<SkalaErgebnis, 3>();

  bool irgendeine = false;
  for (double wv : kand.w) if (wv > 0.0) { irgendeine = true; break; }
  if (!irgendeine) return kurve;

  const Modell mod;
  const std::vector<int> path = viterbi(kand, nf, mod, fort, 75.0, 87.5);
  if (abbruchAngefordert()) return kurve;
  const std::vector<double> post = posterior(kand, nf, mod, fort, 87.5, 100.0);
  if (abbruchAngefordert()) return kurve;

  for (size_t t = 0; t < nf; ++t) {
    kurve.konf[t] = post[t];
    if (path[t] < 0) continue;
    const int b = path[t];
    double fc = F_BIN0 * std::pow(2.0, b * BIN_CT / 1200.0);
    double bestW = 0.0;
    bool found = false;
    for (int c = 0; c < MAX_KAND; ++c) {
      const double wgt = kand.w[t * MAX_KAND + static_cast<size_t>(c)];
      if (!(wgt > 0.0)) continue;
      const double fcand = kand.f[t * MAX_KAND + static_cast<size_t>(c)];
      const double pos = 1200.0 * std::log2(std::max(fcand, 1e-9) / F_BIN0) / BIN_CT;
      if (std::fabs(pos - b) <= REFINE_BINS && (!found || wgt > bestW)) { found = true; bestW = wgt; fc = fcand; }
    }
    kurve.f0_ct[t] = 6900.0 + 1200.0 * std::log2(fc / 440.0);
  }
  return kurve;
}

}  // namespace cdj::noten
