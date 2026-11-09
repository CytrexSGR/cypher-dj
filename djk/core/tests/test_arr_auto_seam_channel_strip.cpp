// Automation slice 1, Z2 diagnosis step 3: which stage behind arr.block smooths the lane step at the loop wrap.
// The production output enters the mixer as source channel erz/4 (core_signalbox.cpp), and every source channel runs the
// DJ channel strip (Kanalzug: trim, LR8 isolator 246/2484 Hz, filter, fader). The isolator always runs; at neutral EQ its
// three bands sum to an allpass, so the steady level is unchanged but a level step is not.
// The test runs the Z2 case of test_arr_auto case 3c (sine 440 Hz 0.3, loop 0..16, lane 0 -> -30 dB over 0..16, against
// the same loop without a lane) and measures the Z2 quantity (level of the 10 ms after the wrap, lane run minus control
// run, dB) twice: at the arrangement output and behind a neutral Kanalzug.
// Expected: at the arrangement output 0 dB within 0.03 (the hold tolerance) (the core is exact, case 3c); behind the Kanalzug the target
// value of Z2 (-0.486 dB, docs/architecture/stand/produktion-automation.md item 10) within 0.1 dB.
// Negative control: a run without the lane step (constant lane at 0 dB) gives 0 dB behind the Kanalzug as well.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include <cypherdj/dsp/channel_strip.h>

#include "arr_build.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;

static constexpr int64_t V = 537;

static ArrAutoPunkt P(double beat, float wert) { return ArrAutoPunkt{beat, wert, 0}; }

static void aufbau(Treiber& t, const cdj::ArrAudio* a, std::vector<ArrAutoPunkt> lane) {
  t.k = cdj::Karte(120.0, 0);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, a);
  if (!lane.empty()) b.lane(1, std::move(lane));
  t.laden(b.fertig());
}

// one run of the loop 0..16 over the wrap; returns the left output and the wrap sample
static std::vector<float> lauf(const cdj::ArrAudio* a, std::vector<ArrAutoPunkt> lane, int64_t& naht) {
  Treiber t;
  aufbau(t, a, std::move(lane));
  t.arr.loop(true, 0.0, 16.0, 0, t.k);
  t.arr.start(0.0, 0, false, 0, V, 256, t.k);
  float b[6][cdj::ARR_BLOCK];
  const int64_t bis = 900 + 17 * 24000;
  while (t.s < bis) {
    for (auto& x : b) std::fill(x, x + t.n, 0.0f);
    t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
    t.l.insert(t.l.end(), b[0], b[0] + t.n);
    t.s += t.n;
  }
  const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
  naht = std::llround(t.k.sample_at(16.0 + t.k.beat_at(static_cast<double>(s_start))));
  return t.l;
}

// the signal through a neutral channel strip (default controls), in blocks of 256 like the core
static std::vector<float> kanalzug(const std::vector<float>& x) {
  cypherdj::dsp::Kanalzug kz;
  kz.setze_sofort(cypherdj::dsp::Regler::fader, 0.0f);   // as render.cpp sets erz/4/fader (the default is -200 dB); EQ, trim and filter stay neutral
  std::vector<float> aus(x.size()), aus_r(x.size());
  for (size_t o = 0; o < x.size(); o += 256) {
    const int n = static_cast<int>(std::min<size_t>(256, x.size() - o));
    cypherdj::dsp::KanalzugAusgang ka;
    ka.haupt_l = &aus[o];
    ka.haupt_r = &aus_r[o];
    kz.verarbeite(&x[o], &x[o], n, ka);
  }
  return aus;
}

static double pegel_db(const std::vector<float>& x, int64_t von, int64_t n) {
  double e = 0.0;
  for (int64_t i = von; i < von + n; ++i) e += static_cast<double>(x[i]) * x[i];
  return 10.0 * std::log10(std::max(e / static_cast<double>(n), 1e-30));
}

int main() {
  auto sin_a = Audio::sinus(1200000, 440.0, 0.3f);
  const int64_t ZEHN_MS = 480;
  int64_t n_k = 0, n_l = 0, n_c = 0;
  const auto kontrolle = lauf(&sin_a->a, {}, n_k);
  const auto mit_lane = lauf(&sin_a->a, {P(0, 0.f), P(16, -30.f)}, n_l);
  const auto konstant = lauf(&sin_a->a, {P(0, 0.f), P(16, 0.f)}, n_c);   // negative control: a lane without a step
  PRUEF(n_k == n_l && n_l == n_c && n_k > 1000 && n_k + ZEHN_MS < static_cast<int64_t>(kontrolle.size()));
  const int64_t w = n_k;

  const double arr_z2 = pegel_db(mit_lane, w, ZEHN_MS) - pegel_db(kontrolle, w, ZEHN_MS);
  const auto kz_k = kanalzug(kontrolle), kz_l = kanalzug(mit_lane), kz_c = kanalzug(konstant);
  const double kz_z2 = pegel_db(kz_l, w, ZEHN_MS) - pegel_db(kz_k, w, ZEHN_MS);
  const double kz_nk = pegel_db(kz_c, w, ZEHN_MS) - pegel_db(kz_k, w, ZEHN_MS);
  const double kz_vor = pegel_db(kz_k, w - ZEHN_MS, ZEHN_MS), kz_nach = pegel_db(kz_k, w, ZEHN_MS);
  const double voll = 20.0 * std::log10(0.3 * 0.70710677 / std::sqrt(2.0));   // sine 0.3 at centre pan (-3 dB), RMS

  std::printf("Z2 at the arrangement output: lane minus control %.3f dB\n", arr_z2);
  std::printf("Z2 behind a neutral Kanalzug: lane minus control %.3f dB (target measurement: -0.486, channel strip alone measured -0.200)\n", kz_z2);
  std::printf("negative control behind the Kanalzug (lane without a step): %.3f dB\n", kz_nk);
  std::printf("control behind the Kanalzug, 10 ms before / after the wrap: %.3f / %.3f dB re full (target: -0.217 / -0.638)\n",
              kz_vor - voll, kz_nach - voll);

  if (std::getenv("CYPHERDJ_Z2_VERSATZ")) {   // diagnosis: the three target numbers with the measurement window shifted by d samples
    for (int d = -120; d <= 120; d += 8) {
      const int64_t x = w + d;
      std::printf("shift %+4d: Z2 %.3f  control before %.3f after %.3f\n", d, pegel_db(kz_l, x, ZEHN_MS) - pegel_db(kz_k, x, ZEHN_MS),
                  pegel_db(kz_k, x - ZEHN_MS, ZEHN_MS) - voll, pegel_db(kz_k, x, ZEHN_MS) - voll);
    }
  }
  PRUEF(std::fabs(arr_z2) < 0.03);   // the hold tolerance of the gain step (AUTO_HALT_DB 0.03 dB)
  PRUEF(kz_z2 < -0.15 && kz_z2 > -0.25);   // the channel strip smooths the step: -0.200 dB measured
  PRUEF(std::fabs(kz_nk) < 0.01);
  PRUEF_ENDE();
}
