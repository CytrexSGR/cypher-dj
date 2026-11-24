// Saturation insert (saett): no DC at the output. A sine with a DC offset of 0.02 through the drive of the factory preset acid-bite
// (drive 24 dB, out -12 dB, mix 1) must leave a mean below 1e-3 on both channels (red without the blocker: 0.013); the level of a
// 1 kHz sine stays where it was before the DC blocker (reference measured on the build without it); mix 0 stays the
// dry signal delayed by the reported latency, bit-equal.
#include <cmath>
#include <cstdio>
#include <vector>

#include "cypherdj/sat.h"
#include "check.h"

namespace {
constexpr int SR = 48000;
constexpr double PI = 3.14159265358979323846;

struct Lauf {
  double mittel_l, mittel_r, rms_db;
};

// Plays `sek` seconds of a sine at -12 dBFS (right channel the same), statistics from `ab` seconds on.
Lauf spiele(double hz, double drive, double out, double mix, double sek, double ab, std::vector<float>* l_aus = nullptr) {
  cdj::SaettNativ s(SR);
  s.setze(drive, out, mix);
  const int n = static_cast<int>(sek * SR), n0 = static_cast<int>(ab * SR), B = 128;
  const double amp = std::pow(10.0, -12.0 / 20.0);
  std::vector<float> l(n), r(n);
  for (int i = 0; i < n; ++i) l[i] = r[i] = static_cast<float>(amp * std::sin(2.0 * PI * hz * i / SR));
  if (l_aus) *l_aus = l;
  for (int i = 0; i < n; i += B) s.block(l.data() + i, r.data() + i, std::min(B, n - i));
  double sl = 0, sr = 0, q = 0;
  for (int i = n0; i < n; ++i) { sl += l[i]; sr += r[i]; q += double(l[i]) * l[i]; }
  const double m = n - n0;
  Lauf o{sl / m, sr / m, 10.0 * std::log10(q / m)};
  if (l_aus) *l_aus = l;
  return o;
}
}  // namespace

int main() {
  {  // 1 input with a DC offset of 0.02 (a pink-noise window has such a share too): the offset must not come out
    cdj::SaettNativ s(SR);
    s.setze(24.0, -12.0, 1.0);
    const int n = 3 * SR, n0 = SR;
    std::vector<float> l(n), r(n);
    for (int i = 0; i < n; ++i) l[i] = r[i] = static_cast<float>(0.02 + 0.25 * std::sin(2.0 * PI * 100.0 * i / SR));
    for (int i = 0; i < n; i += 128) s.block(l.data() + i, r.data() + i, std::min(128, n - i));
    double sl = 0, sr = 0;
    for (int i = n0; i < n; ++i) { sl += l[i]; sr += r[i]; }
    std::printf("1: input offset 0.02, mean L %.6f R %.6f\n", sl / (n - n0), sr / (n - n0));
    PRUEF(std::fabs(sl / (n - n0)) < 1e-3);
    PRUEF(std::fabs(sr / (n - n0)) < 1e-3);
  }
  {  // 2 level of a 1 kHz sine unchanged (reference from the build without the blocker)
    const Lauf o = spiele(1000.0, 24.0, -12.0, 1.0, 1.5, 0.5);
    std::printf("2: 1 kHz acid-bite rms %.4f dB\n", o.rms_db);
    PRUEF_NAH(o.rms_db, -12.787, 0.1);
  }
  {  // 3 mix 0 is the dry signal delayed by the latency, bit-equal
    cdj::SaettNativ s(SR);
    s.setze(24.0, -12.0, 0.0);
    const int n = 3 * SR, lat = s.latenz(), ab = SR;
    std::vector<float> l(n), r(n), ref(n);
    for (int i = 0; i < n; ++i) l[i] = r[i] = ref[i] = static_cast<float>(0.3 * std::sin(2.0 * PI * 100.0 * i / SR) + 0.05);
    for (int i = 0; i < n; i += 128) s.block(l.data() + i, r.data() + i, std::min(128, n - i));
    int ungleich = 0;
    for (int i = ab; i < n; ++i) if (l[i] != ref[i - lat] || r[i] != ref[i - lat]) ++ungleich;
    std::printf("3: mix 0 mismatches %d (latency %d)\n", ungleich, lat);
    PRUEF(ungleich == 0);
  }
  PRUEF_ENDE();
  return 0;
}
