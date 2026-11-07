// Shared scaffolding of the 1.15 A3 tests (gate and utility in the channel strip): a Mixer on the default controller table,
// channel helpers and measuring helpers. Header only, one translation unit per test.
#pragma once
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/mixer.h"
#include "pruef.h"

namespace wzt {

namespace sw = cypherdj::stellwerk;

constexpr int N = 256;
constexpr double PI = 3.14159265358979323846;
// mixer channel indices
constexpr int DECK1 = 0, ERZ1 = 4, ERZ2 = 5, ERZ4 = 7, ERZ8 = 11, PAD1 = 12, PAD2 = 13, BUS1 = 14, BUS2 = 15;

inline const char* kname(int k) { return cdj::Mixer::kanal_name(k); }

struct Lauf {
  sw::ReglerTabelle tab;
  std::unique_ptr<cdj::Mixer> m;
  float ml[cdj::MIX_BLOCK] = {}, mr[cdj::MIX_BLOCK] = {}, cl[cdj::MIX_BLOCK] = {}, cr[cdj::MIX_BLOCK] = {};
  long t = 0;
  // mb_auto: the multiband's automatic make-up. Off by default: the checks written before it measure the reduction in the output level, which
  // the make-up would cancel. test_mixer_multiband (M3b) runs with the production default.
  explicit Lauf(bool mb_auto = false) : m(std::make_unique<cdj::Mixer>(tab)) {
    m->mb_ausgleich_automatisch(mb_auto);
    for (int k = 0; k < cdj::MIX_KANAELE; ++k) setze((std::string(kname(k)) + "/fader").c_str(), 0.0f);
  }
  int r(const char* pfad) const {
    const int i = tab.suche(pfad);
    PRUEF(i >= 0);
    return i;
  }
  void setze(const char* pfad, float w) { m->setze_sofort(r(pfad), w); }
  void setze(int k, const char* suffix, float w) { setze((std::string(kname(k)) + "/" + suffix).c_str(), w); }
  // sine of frequency f on the input of channel k, amplitude al/ar left/right, for the next block of n samples
  void sinus(int k, double f, double al, double ar, int n = N) {
    for (int i = 0; i < n; ++i) {
      const double s = std::sin(2.0 * PI * f * static_cast<double>(t + i) / 48000.0);
      m->eingang_l(k)[i] = static_cast<float>(al * s);
      m->eingang_r(k)[i] = static_cast<float>(ar * s);
    }
  }
  // deterministic noise (xorshift), seeded per channel
  void rausch(int k, double a, int n = N) {
    for (int i = 0; i < n; ++i) {
      m->eingang_l(k)[i] = static_cast<float>(a * noise(k * 2));
      m->eingang_r(k)[i] = static_cast<float>(a * noise(k * 2 + 1));
    }
  }
  void verarbeite(int n = N) {
    m->verarbeite(n, ml, mr, cl, cr);
    t += n;
  }

 private:
  uint32_t zust_[64] = {};
  double noise(int s) {
    uint32_t& x = zust_[s & 63];
    if (!x) x = 2463534242u + static_cast<uint32_t>(s) * 7919u;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return static_cast<double>(x) / 2147483648.0 - 1.0;
  }
};

// All four outputs and both ear taps bit-identical?
inline bool gleich(const Lauf& a, const Lauf& b, int n = N) {
  const size_t z = sizeof(float) * static_cast<size_t>(n);
  return !std::memcmp(a.ml, b.ml, z) && !std::memcmp(a.mr, b.mr, z) && !std::memcmp(a.cl, b.cl, z) && !std::memcmp(a.cr, b.cr, z) &&
         !std::memcmp(a.m->master_summe_l(), b.m->master_summe_l(), z) && !std::memcmp(a.m->master_summe_r(), b.m->master_summe_r(), z);
}
inline double rms_db(const float* x, int n) {
  double s = 0.0;
  for (int i = 0; i < n; ++i) s += static_cast<double>(x[i]) * x[i];
  return 10.0 * std::log10(std::fmax(s / n, 1e-30));
}
inline double spitze_db(const float* x, int n) {
  float p = 0.0f;
  for (int i = 0; i < n; ++i) p = std::fmax(p, std::fabs(x[i]));
  return 20.0 * std::log10(std::fmax(p, 1e-15f));
}
inline double max_abstand(const float* a, const float* b, int n) {
  double d = 0.0;
  for (int i = 0; i < n; ++i) d = std::fmax(d, std::fabs(static_cast<double>(a[i]) - b[i]));
  return d;
}

}  // namespace wzt
