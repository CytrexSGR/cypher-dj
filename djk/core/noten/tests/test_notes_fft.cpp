// FFT (src/fft.cpp) and the synthetic test tones (tests/synth.h).
#include <complex>
#include <cstdio>
#include <vector>

#include "intern.h"
#include "check.h"
#include "synth.h"

using namespace cdj::noten;
using Komplex = std::complex<double>;

static double maxFehler(const std::vector<Komplex>& a, const std::vector<Komplex>& b) {
  double m = 0;
  for (size_t i = 0; i < a.size(); ++i) m = std::max(m, std::abs(a[i] - b[i]));
  return m;
}

int main() {
  // forward then inverse returns the input within 1e-12, every size 64..65536
  synth::Zufall z(42);
  for (size_t n = 64; n <= 65536; n *= 2) {
    std::vector<Komplex> x(n);
    for (auto& v : x) v = Komplex(2.0 * z.gleich() - 1.0, 2.0 * z.gleich() - 1.0);
    const auto orig = x;
    fft(x, false);
    fft(x, true);
    const double f = maxFehler(x, orig);
    if (!(f < 1e-12)) std::fprintf(stderr, "n=%zu: roundtrip error %g\n", n, f);
    PRUEF(f < 1e-12);
  }

  // against the definition (naive DFT), n = 64 and 256
  for (size_t n : {size_t(64), size_t(256)}) {
    std::vector<Komplex> x(n), soll(n);
    for (auto& v : x) v = Komplex(z.gleich() - 0.5, z.gleich() - 0.5);
    for (size_t k = 0; k < n; ++k) {
      Komplex s = 0;
      for (size_t t = 0; t < n; ++t) s += x[t] * std::polar(1.0, -2.0 * std::acos(-1.0) * static_cast<double>(k * t % n) / static_cast<double>(n));
      soll[k] = s;
    }
    fft(x, false);
    PRUEF(maxFehler(x, soll) < 1e-11);
  }

  // a sine at bin k peaks at bin k (and at n - k for the mirror), every other bin is empty
  for (size_t n : {size_t(64), size_t(1024), size_t(65536)}) {
    for (size_t k : {size_t(1), size_t(5), n / 8 + 1, n / 2 - 1}) {
      std::vector<Komplex> x(n);
      for (size_t t = 0; t < n; ++t) x[t] = std::sin(2.0 * std::acos(-1.0) * static_cast<double>(k * t % n) / static_cast<double>(n));
      fft(x, false);
      size_t spitze = 0;
      for (size_t b = 0; b <= n / 2; ++b) if (std::abs(x[b]) > std::abs(x[spitze])) spitze = b;
      PRUEF(spitze == k);
      PRUEF_NAH(std::abs(x[k]), static_cast<double>(n) / 2.0, 1e-8 * static_cast<double>(n));
      double rest = 0;
      for (size_t b = 0; b < n; ++b) if (b != k && b != n - k) rest = std::max(rest, std::abs(x[b]));
      PRUEF(rest < 1e-8 * static_cast<double>(n));
    }
  }

  // sizes that are no power of two are refused
  bool geworfen = false;
  try { std::vector<Komplex> x(100); fft(x, false); } catch (const std::invalid_argument&) { geworfen = true; }
  PRUEF(geworfen);

  // ---- synthetic tones: deterministic, and the pitch and the partials are where they should be
  {
    synth::Ton t;
    t.midi = 69.0;                       // 440 Hz
    t.dauer_s = 1.0;
    t.anstieg_s = 0;
    t.abfall_s = 0;
    const auto a = synth::melodie({t}, 1.0), b = synth::melodie({t}, 1.0);
    PRUEF(a == b);
    PRUEF(a.size() == 48000);
    // 16384 samples at a fundamental on an exact bin (40 * 48000 / 16384 Hz): no leakage, the partial k has the weight 1/k
    const size_t n = 16384, bin = 40;
    synth::Ton u;
    u.midi = 69.0 + 12.0 * std::log2(static_cast<double>(bin) * synth::SR / static_cast<double>(n) / 440.0);
    u.dauer_s = static_cast<double>(n) / synth::SR;
    u.anstieg_s = 0;
    u.abfall_s = 0;
    const auto x = synth::melodie({u}, u.dauer_s);
    std::vector<Komplex> sp(n);
    for (size_t i = 0; i < n; ++i) sp[i] = x[i];
    fft(sp, false);
    size_t spitze = 0;
    for (size_t b2 = 0; b2 <= n / 2; ++b2) if (std::abs(sp[b2]) > std::abs(sp[spitze])) spitze = b2;
    PRUEF(spitze == bin);
    PRUEF_NAH(std::abs(sp[2 * bin]) / std::abs(sp[bin]), 0.5, 2e-3);
    PRUEF_NAH(std::abs(sp[3 * bin]) / std::abs(sp[bin]), 1.0 / 3.0, 2e-3);
    PRUEF_NAH(std::abs(sp[20 * bin]) / std::abs(sp[bin]), 1.0 / 20.0, 2e-3);
    PRUEF(std::abs(sp[21 * bin]) < 1e-3 * std::abs(sp[bin]));   // only 20 partials
    // noise: the requested level, the same for the same seed, another one for another seed
    const auto r1 = synth::rauschen(2.0, -20.0, 7), r2 = synth::rauschen(2.0, -20.0, 7), r3 = synth::rauschen(2.0, -20.0, 8);
    PRUEF(r1 == r2);
    PRUEF(r1 != r3);
    double s = 0;
    for (float v : r1) s += static_cast<double>(v) * v;
    PRUEF_NAH(std::sqrt(s / static_cast<double>(r1.size())), 0.1, 0.002);
    // glide and vibrato: the pitch function
    synth::Ton g;
    g.midi = 60;
    g.midi_ende = 72;
    g.dauer_s = 2;
    PRUEF_NAH(synth::tonHoehe(g, 1.0), 66.0, 1e-12);
    g.midi_ende = -1;
    g.vib_ct = 50;
    g.vib_hz = 5;
    PRUEF_NAH(synth::tonHoehe(g, 0.05), 60.5, 1e-9);   // quarter of a vibrato period: the peak
    // the two-peak envelope has its maxima at 700 and 1800 Hz
    PRUEF(synth::huelle(700) > synth::huelle(400) && synth::huelle(700) > synth::huelle(1100));
    PRUEF(synth::huelle(1800) > synth::huelle(1300) && synth::huelle(1800) > synth::huelle(2600));
  }
  PRUEF_ENDE();
}
