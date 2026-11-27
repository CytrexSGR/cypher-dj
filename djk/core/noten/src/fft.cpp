// Own iterative radix-2 complex FFT in double (sizes 64..65536 tested): no new run-time library in the .deb.
#include <cmath>
#include <map>
#include <stdexcept>

#include "intern.h"

namespace cdj::noten {
namespace {

using Komplex = std::complex<double>;

/// w[k] = exp(-2 pi i k / n) for k < n / 2, each from its own cos and sin (no recurrence, so no drift). One table per size and thread.
const std::vector<Komplex>& zwirbel(size_t n) {
  thread_local std::map<size_t, std::vector<Komplex>> tabellen;
  auto it = tabellen.find(n);
  if (it != tabellen.end()) return it->second;
  std::vector<Komplex> w(n / 2);
  const double pi2 = 2.0 * std::acos(-1.0);
  for (size_t k = 0; k < w.size(); ++k) {
    const double ph = pi2 * static_cast<double>(k) / static_cast<double>(n);
    w[k] = Komplex(std::cos(ph), -std::sin(ph));
  }
  return tabellen.emplace(n, std::move(w)).first->second;
}

}  // namespace

void fft(std::vector<Komplex>& x, bool invers) {
  const size_t n = x.size();
  if (n == 0 || (n & (n - 1)) != 0) throw std::invalid_argument("fft: the size must be a power of two");
  if (n == 1) return;
  // bit reversal permutation
  for (size_t i = 1, j = 0; i < n; ++i) {
    size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(x[i], x[j]);
  }
  const std::vector<Komplex>& w = zwirbel(n);
  const double vz = invers ? -1.0 : 1.0;   // the inverse uses the conjugate kernel
  for (size_t len = 2; len <= n; len <<= 1) {
    const size_t half = len >> 1, schritt = n / len;
    for (size_t i = 0; i < n; i += len) {
      for (size_t j = 0; j < half; ++j) {
        const double wr = w[j * schritt].real(), wi = vz * w[j * schritt].imag();
        Komplex& u = x[i + j];
        Komplex& v = x[i + j + half];
        const double tr = v.real() * wr - v.imag() * wi;
        const double ti = v.real() * wi + v.imag() * wr;
        v = Komplex(u.real() - tr, u.imag() - ti);
        u = Komplex(u.real() + tr, u.imag() + ti);
      }
    }
  }
  if (invers) {
    const double s = 1.0 / static_cast<double>(n);
    for (auto& c : x) c = Komplex(c.real() * s, c.imag() * s);
  }
}

}  // namespace cdj::noten
