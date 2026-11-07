// Automation slice 2, task 3: the core plays the pan, mute and solo lanes of a track (E7, E8). Way B throughout: the audio level at the master of constant
// clips (0.5 and 0.25), where gains, fades and jumps can be computed back.
//   1. AK27: a pan lane -1 -> 1 over beats 0..16 and a fader lane on tracks 1, 10 and 32 (same numbers; not track 9): the per-sample L/R gains equal
//      pan_gain(Lane(beat)) within the hold tolerance (0.002 pan) at beats 4, 8, 12; the fader level within 0.05 dB.
//   2. AK7: mute lane 0 -> 1 at beat 8 (tracks 1, 10, 32): the output falls over exactly 480 samples, linear (ARR_STUMM_BLENDE), not in one sample.
//      Mutation ARR_MUTE_HART (the existing mixer mutation): red.
//   3. solo lane 0 -> 1 at beat 4 on the solo track (2, 10, 32) silences track 1 with the 480 fade, back at beat 8; 3a: a solo lane that holds 1 is deleted by a
//      snapshot swap, track 1 returns over the 480 blend to exactly the full level.
//   4. base value protection: base mute 1, mute lane 0: plays while running, base value 1 while running and after the stop. Mutation
//      ARR_AUTO_GRUND_UEBERSCHRIEBEN: red on field 2.
//   5. pan source blend: a pan lane at -1 deleted while playing moves the pan to the base 0 over 480 samples, no step.
//      5b: a pan lane -1 swapped for a pan lane +1: no step. Mutation ARR_AUTO_PAN_BLENDE_HART: red (5 and 5b).
//   6. negative controls: a track with only a device lane plays like a track without lanes; a pan lane at constant 0 equals no lane.
//   7. task 4 (E9): a `geraet` lane reaches the internal sink as ONE auto_parameter per block, the lane value at the project beat of the last RUNNING
//      sample of the block (ramp 0 -> 1 over beats 0..8, three blocks checked, plus the block with the start sample in its middle). The block that holds
//      the stop gets the value at the last sample before the stop, the block after it gets no call; no call before the start. A track without a `geraet`
//      lane gets none. Mutation ARR_GERAET_ERSTES_SAMPLE (value at the first running sample) goes red.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <utility>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;

static constexpr int64_t V = 537;
static constexpr double BEAT_SAMPLES = 24000.0;   // samples per beat at 120 BPM
static constexpr double MITTE = 0.70710678118654752;

static ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
static void pan_soll(double pan, double& gl, double& gr) {
  const double th = (std::clamp(pan, -1.0, 1.0) + 1.0) * 0.78539816339744830962;
  gl = std::cos(th);
  gr = std::sin(th);
}

// Spy sink for case 7: records every auto_parameter with the start sample of its block (PruefSenke::block_s0, set by the driver).
struct AutoSpy : PruefSenke {
  struct R { int spur, param; float wert; int64_t block_s0; };
  std::vector<R> r;
  AutoSpy() { r.reserve(4096); su.reserve(4096); }
  std::vector<R> su;   // 1.12 slice 5: auto_parameter_summand calls (a relative lane without an absolute one), wert = the summand
  void auto_parameter(int spur, int param, float wert) noexcept override { r.push_back({spur, param, wert, block_s0}); }
  void auto_parameter_summand(int spur, int param, float delta) noexcept override { su.push_back({spur, param, delta, block_s0}); }
};

struct Ablauf {
  Treiber t;
  int64_t s_start = 0;
  int64_t bei(double beat) const { return s_start + static_cast<int64_t>(beat * BEAT_SAMPLES); }
};

static void aufbau(Ablauf& x, const cdj::ArrAudio* a, int spur, const std::vector<ArrAutoPunkt>& fader, const std::vector<ArrAutoPunkt>& pan,
                   const std::vector<ArrAutoPunkt>& mute = {}, const std::vector<ArrAutoPunkt>& solo = {}) {
  x.t.k = cdj::Karte(120.0, 0);
  Bau b;
  b.spur(spur, ArrArt::audio).clip(spur, "c1", 0.0, 40.0, a);
  if (!fader.empty()) b.lane(spur, fader);
  if (!pan.empty()) b.lane(spur, pan, cdj::ARR_AUTO_PAN);
  if (!mute.empty()) b.lane(spur, mute, cdj::ARR_AUTO_MUTE);
  if (!solo.empty()) b.lane(spur, solo, cdj::ARR_AUTO_SOLO);
  x.t.laden(b.fertig());
}
static void starte(Ablauf& x, int64_t bis) {
  x.t.arr.start(0.0, 0, false, 0, V, 256, x.t.k);
  x.t.lauf(bis);
  x.s_start = x.t.arr.zustand(x.t.k, x.t.s).ursprung_sample;
}

int main() {
  auto a = Audio::gleich(1200000);   // 25 s at 48 kHz, constant 0.5
  const double L0 = 0.5 * MITTE;     // centre pan, no fader
  {  // 1. AK27 pan and fader on tracks 1, 10, 32
    for (int spur : {1, 10, 32}) {
      Ablauf x;
      aufbau(x, &a->a, spur, {P(4, 0.f), P(20, -30.f)}, {P(0, -1.f), P(16, 1.f)});
      starte(x, 500000);
      for (int b : {4, 8, 12}) {
        const double pan = -1.0 + 2.0 * b / 16.0;
        double gl, gr;
        pan_soll(pan, gl, gr);
        const double fader = b <= 4 ? 1.0 : std::pow(10.0, -30.0 * (b - 4) / 16.0 / 20.0);
        const int64_t sm = x.bei(b);
        // hold tolerance 0.002 pan = at most 0.00158 in the gain, times the clip 0.5 and the fader gain
        PRUEF_NAH(x.t.l[sm], 0.5 * fader * gl, 0.0009 * fader + 1e-6);
        PRUEF_NAH(x.t.r[sm], 0.5 * fader * gr, 0.0009 * fader + 1e-6);
      }
      PRUEF(x.t.r[x.bei(12)] > x.t.l[x.bei(12)] * 1.5);   // pan 0.5: right clearly louder, so the lane really panned
    }
  }
  for (int spur : {1, 10, 32}) {  // 2. AK7 mute lane 0 -> 1 at beat 8: linear fall over exactly 480 samples, on tracks 1, 10 and 32 (same numbers)
    Ablauf x;
    aufbau(x, &a->a, spur, {}, {}, {P(0, 0.f, 2), P(8, 1.f, 2)});
    starte(x, 450000);
    const int64_t sm = x.bei(8);
    PRUEF_NAH(x.t.l[sm - 100], L0, 1e-5);   // positive control: audible before the jump
    int64_t j0 = -1;
    for (int64_t j = sm - 50; j < sm + 50 && j0 < 0; ++j)
      if (x.t.l[j] < L0 * (1.0 - 1e-4)) j0 = j;
    PRUEF(j0 >= sm - 1 && j0 <= sm + 1);
    if (j0 > 0) {
      for (int k : {0, 100, 239, 478}) PRUEF_NAH(x.t.l[j0 + k], L0 * (1.0 - (k + 1) / 480.0), 2e-5);
      PRUEF_NAH(x.t.l[j0 + 479], 0.0, 1e-7);
      PRUEF_NAH(x.t.l[j0 + 2000], 0.0, 0.0);
      double groesster = 0.0;
      for (int64_t j = j0; j < j0 + 600; ++j) groesster = std::max(groesster, std::fabs(static_cast<double>(x.t.l[j]) - x.t.l[j - 1]));
      PRUEF(groesster <= L0 / 480.0 * 1.05);
    }
  }
  auto b25 = Audio::gleich(1200000, 0.25f);
  const double voll = 0.75 * MITTE, nur2 = 0.25 * MITTE;
  const auto solo_bau = [&](Ablauf& x, int solo_spur, bool mit_lane) {   // track 1 (0.5) and the solo track (0.25); the lane holds solo from beat 4
    x.t.k = cdj::Karte(120.0, 0);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
    b.spur(solo_spur, ArrArt::audio).clip(solo_spur, "c2", 0.0, 40.0, &b25->a);
    if (mit_lane) b.lane(solo_spur, {P(0, 0.f, 2), P(4, 1.f, 2), P(40, 1.f, 2)}, cdj::ARR_AUTO_SOLO);
    return b.fertig();
  };
  for (int spur : {2, 10, 32}) {  // 3. solo lane 0 -> 1 at beat 4 on the solo track, back to 0 at beat 8: track 1 falls and returns over 480 samples
    Ablauf x;
    x.t.k = cdj::Karte(120.0, 0);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
    b.spur(spur, ArrArt::audio).clip(spur, "c2", 0.0, 40.0, &b25->a);
    b.lane(spur, {P(0, 0.f, 2), P(4, 1.f, 2), P(8, 0.f, 2)}, cdj::ARR_AUTO_SOLO);
    x.t.laden(b.fertig());
    starte(x, 450000);
    PRUEF_NAH(x.t.l[x.bei(2)], voll, 1e-5);
    PRUEF_NAH(x.t.l[x.bei(4) + 2000], nur2, 1e-5);
    PRUEF_NAH(x.t.l[x.bei(8) - 100], nur2, 1e-5);
    PRUEF_NAH(x.t.l[x.bei(8) + 2000], voll, 1e-5);
    int64_t j0 = -1, j1 = -1;
    for (int64_t j = x.bei(4) - 50; j < x.bei(4) + 50 && j0 < 0; ++j)
      if (x.t.l[j] < voll * (1.0 - 1e-4)) j0 = j;
    for (int64_t j = x.bei(8) - 50; j < x.bei(8) + 50 && j1 < 0; ++j)
      if (x.t.l[j] > nur2 * (1.0 + 1e-4)) j1 = j;
    PRUEF(j0 >= x.bei(4) - 1 && j0 <= x.bei(4) + 1);
    PRUEF(j1 >= x.bei(8) - 1 && j1 <= x.bei(8) + 1);
    if (j0 > 0) for (int k : {0, 239, 478}) PRUEF_NAH(x.t.l[j0 + k], nur2 + 0.5 * MITTE * (1.0 - (k + 1) / 480.0), 2e-5);
    if (j1 > 0) for (int k : {0, 239, 478}) PRUEF_NAH(x.t.l[j1 + k], nur2 + 0.5 * MITTE * ((k + 1) / 480.0), 2e-5);
  }
  {  // 3a. a solo lane that holds solo is deleted by a snapshot swap while playing: track 1 returns over the 480 blend to exactly the full level
    Ablauf x;
    x.t.laden(solo_bau(x, 2, true));
    starte(x, 800 + 6 * 24000);   // beat 6: the solo fade from beat 4 is over
    PRUEF_NAH(x.t.l[x.t.s - 10], nur2, 1e-5);   // before the swap track 1 is silenced by the solo lane
    const int64_t t0 = x.t.s;
    x.t.laden(solo_bau(x, 2, false));            // the same clips, no lane
    x.t.lauf(t0 + 4000);
    int64_t j1 = -1;
    for (int64_t j = t0; j < t0 + 50 && j1 < 0; ++j)
      if (x.t.l[j] > nur2 * (1.0 + 1e-4)) j1 = j;
    PRUEF(j1 >= t0 && j1 <= t0 + 1);
    if (j1 > 0) {
      for (int k : {0, 119, 239, 358, 478}) PRUEF_NAH(x.t.l[j1 + k], nur2 + 0.5 * MITTE * ((k + 1) / 480.0), 2e-5);
      PRUEF_NAH(x.t.l[j1 + 479], voll, 1e-6);   // exactly the full level
      PRUEF_NAH(x.t.l[j1 + 1500], voll, 1e-6);
    }
  }
  {  // 4. base value protection: base mute 1, mute lane 0
    Ablauf x;
    aufbau(x, &a->a, 1, {}, {}, {P(0, 0.f, 2), P(30, 0.f, 2)});
    x.t.arr.setze_sofort(x.t.tab.suche("spur/1/mute"), 1.0f);
    starte(x, 800 + 4 * 24000);
    PRUEF_NAH(x.t.l[x.bei(3)], L0, 1e-5);          // the lane plays: audible although the base value is mute
    PRUEF_NAH(x.t.arr.wert(0, 2), 1.0, 0.0);       // the base value stays while the lane plays
    const int64_t halt = x.t.s + 64;
    x.t.arr.stopp(0, halt, x.t.k);
    x.t.lauf(halt + 4000);
    PRUEF_NAH(x.t.arr.wert(0, 2), 1.0, 0.0);       // and after the stop
    PRUEF_NAH(x.t.l[halt + 2000], 0.0, 1e-7);      // the base mute is back
  }
  {  // 5. pan source blend: lane at -1, base pan 0; the lane is deleted while playing (the stop blend of pan is measured on the buffer in test_arr_auto)
    Ablauf x;
    aufbau(x, &a->a, 1, {}, {P(0, -1.f), P(40, -1.f)});
    starte(x, 800 + 4 * 24000);
    PRUEF_NAH(x.t.r[x.t.s - 10], 0.0, 1e-6);   // pan -1: right is silent (the lane plays)
    const int64_t t0 = x.t.s;
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
    x.t.laden(b.fertig());
    x.t.lauf(t0 + 4000);
    double groesster = 0.0;
    for (int64_t j = t0; j < t0 + 600; ++j) groesster = std::max(groesster, std::fabs(static_cast<double>(x.t.r[j]) - x.t.r[j - 1]));
    PRUEF(groesster <= 0.5 * (0.78539816339744830962 / 480.0) * 1.1 + 1e-6);   // gr = sin((p+1) pi/4): slope at most pi/4 per pan unit
    for (int k : {0, 119, 239, 359, 478}) {
      double gl, gr;
      pan_soll(-1.0 + (k + 1) / 480.0, gl, gr);
      PRUEF_NAH(x.t.r[t0 + k], 0.5 * gr, 1e-3);
    }
    PRUEF_NAH(x.t.r[t0 + 1500], L0, 1e-6);   // the base pan 0
  }
  {  // 5b. a pan lane at -1 is swapped for a pan lane at +1 while playing: the pan moves over the 480 blend, no step. A hard change moves a channel by 0.5.
    Ablauf x;
    aufbau(x, &a->a, 1, {}, {P(0, -1.f), P(40, -1.f)});
    starte(x, 800 + 4 * 24000);
    PRUEF_NAH(x.t.r[x.t.s - 10], 0.0, 1e-6);
    PRUEF_NAH(x.t.l[x.t.s - 10], 0.5, 1e-6);
    const int64_t t0 = x.t.s;
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
    b.lane(1, {P(0, 1.f), P(40, 1.f)}, cdj::ARR_AUTO_PAN);
    x.t.laden(b.fertig());
    x.t.lauf(t0 + 4000);
    double groesster = 0.0;
    for (int64_t j = t0; j < t0 + 700; ++j)
      groesster = std::max({groesster, std::fabs(static_cast<double>(x.t.l[j]) - x.t.l[j - 1]), std::fabs(static_cast<double>(x.t.r[j]) - x.t.r[j - 1])});
    std::printf("pan swap -1 -> +1: largest step per sample %.5f (hard change 0.5, blend slope %.5f)\n", groesster, 0.5 * 0.78539816339744830962 * 2.0 / 480.0);
    PRUEF(groesster <= 0.0018);
    for (int k : {0, 119, 239, 359, 478}) {
      double gl, gr;
      pan_soll(-1.0 + 2.0 * (k + 1) / 480.0, gl, gr);
      PRUEF_NAH(x.t.l[t0 + k], 0.5 * gl, 1e-3);
      PRUEF_NAH(x.t.r[t0 + k], 0.5 * gr, 1e-3);
    }
    PRUEF_NAH(x.t.l[t0 + 1500], 0.0, 1e-6);   // the new lane: pan +1
    PRUEF_NAH(x.t.r[t0 + 1500], 0.5, 1e-6);
  }
  {  // 6. negative controls
    const auto lauf = [&](int art, Ablauf& x) {
      x.t.k = cdj::Karte(120.0, 0);
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
      if (art == 1) b.lane(1, {P(0, 0.f), P(40, 1.f)}, cdj::ARR_AUTO_GERAET, 1);
      if (art == 2) b.lane(1, {P(0, 0.f), P(40, 0.f)}, cdj::ARR_AUTO_PAN);
      x.t.laden(b.fertig());
      starte(x, 300000);
    };
    Ablauf o, g, p;
    lauf(0, o);
    lauf(1, g);
    lauf(2, p);
    double dg = 0.0, dp = 0.0;
    for (size_t j = 0; j < o.t.l.size(); ++j) {
      dg = std::max({dg, std::fabs(static_cast<double>(o.t.l[j]) - g.t.l[j]), std::fabs(static_cast<double>(o.t.r[j]) - g.t.r[j])});
      dp = std::max({dp, std::fabs(static_cast<double>(o.t.l[j]) - p.t.l[j]), std::fabs(static_cast<double>(o.t.r[j]) - p.t.r[j])});
    }
    std::printf("negative controls: device-only lane max diff %.3g, pan 0 lane max diff %.3g\n", dg, dp);
    PRUEF(o.t.l.size() == g.t.l.size() && o.t.l.size() == p.t.l.size() && o.t.l.size() > 100000);
    PRUEF(dg == 0.0);
    PRUEF(dp == 0.0);
    PRUEF_NAH(o.t.l[o.bei(4)], L0, 1e-6);   // the control really plays
  }
  {  // 7. E9: one value per block and lane, at the last running sample
    Treiber t;
    AutoSpy spy;
    t.arr.setze_senke_intern(&spy);
    t.senken.push_back(&spy);
    Bau b;
    b.spur(1, ArrArt::intern).spur(2, ArrArt::intern);   // track 2 has no lane
    b.lane(1, {P(0, 0.f), P(8, 1.f)}, cdj::ARR_AUTO_GERAET, 1);
    t.laden(b.fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    const int64_t einsatz = V + 256;   // start rule: now + lead + one cycle (quant 0)
    t.lauf(256 * 6);
    PRUEF(t.arr.zustand(t.k, t.s).ursprung_sample == einsatz);
    for (const auto& x : spy.r) PRUEF(x.spur == 0 && x.param == 1);   // never track 2, never another parameter
    PRUEF(spy.r.size() == 3);   // blocks 3, 4, 5 run (the start sample 793 lies in block 3), blocks 0..2 do not
    for (size_t j = 0; j < spy.r.size() && j < 3; ++j) {
      const int64_t s0 = 256 * (3 + static_cast<int64_t>(j)), letzt = s0 + 255;
      PRUEF(spy.r[j].block_s0 == s0);
      const double beat = static_cast<double>(letzt - einsatz) / static_cast<double>(SPB);
      PRUEF_NAH(spy.r[j].wert, beat / 8.0, 1e-6);   // 0 -> 1 over 8 beats; SPB = 22500 samples per beat at 128 BPM
      std::printf("E9 block %lld: auto_parameter(%d, %d) = %.7f, expected %.7f\n", static_cast<long long>(s0), spy.r[j].spur, spy.r[j].param,
                  spy.r[j].wert, beat / 8.0);
    }
    // stop inside block 7 (sample 1792 + 100): the block gets the value at its last running sample 1891, the block after it nothing
    spy.r.clear();
    t.lauf(256 * 7);
    const size_t vor = spy.r.size();
    t.arr.stopp(0, t.s + 100, t.k);
    t.lauf(256 * 8);
    PRUEF(spy.r.size() == vor + 1);
    if (spy.r.size() == vor + 1) {
      PRUEF(spy.r.back().block_s0 == 256 * 7);
      PRUEF_NAH(spy.r.back().wert, static_cast<double>(256 * 7 + 99 - einsatz) / static_cast<double>(SPB) / 8.0, 1e-6);
    }
    const size_t nach_stopp = spy.r.size();
    t.lauf(256 * 12);
    PRUEF(spy.r.size() == nach_stopp);   // the block after the stop and every later one: no call
    PRUEF(t.arr.status() == cdj::ArrStatus::steht);
  }
  {  // 8. 1.12 slice 5 U9 (D9, spec 5.11 a): the device lane stack. Absolute + relative reach the sink stacked and clamped through auto_parameter; a relative lane alone
     // reaches it as a summand (the sink owns the base value). Mutation ARR_AUTO_REL_OHNE_KLEMME (no clamp): red.
    const auto sp_lauf = [&](const std::vector<std::pair<std::vector<ArrAutoPunkt>, bool>>& lanes, uint8_t param, AutoSpy& spy, Treiber& t) {
      t.arr.setze_senke_intern(&spy);
      t.senken.push_back(&spy);
      Bau b;
      b.spur(1, ArrArt::intern).spur(2, ArrArt::intern);   // track 2 carries no lane
      for (const auto& l : lanes) b.lane(1, l.first, cdj::ARR_AUTO_GERAET, param, l.second);
      t.laden(b.fertig());
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(256 * 6);
    };
    {  // a. absolute 0.5 + relative 0.7 = 1.2, clamped to 1; the absolute lane alone is 0.5 (control)
      Treiber t;
      AutoSpy spy;
      sp_lauf({{{P(0, 0.5f), P(40, 0.5f)}, false}, {{P(0, 0.7f), P(40, 0.7f)}, true}}, 1, spy, t);
      PRUEF(spy.r.size() == 3 && spy.su.empty());
      for (const auto& x : spy.r) PRUEF(x.spur == 0 && x.param == 1);
      for (const auto& x : spy.r) PRUEF_NAH(x.wert, 1.0, 1e-7);
      Treiber t2;
      AutoSpy spy2;
      sp_lauf({{{P(0, 0.5f), P(40, 0.5f)}, false}}, 1, spy2, t2);
      PRUEF(spy2.r.size() == 3 && spy2.su.empty());
      for (const auto& x : spy2.r) PRUEF_NAH(x.wert, 0.5, 1e-7);
    }
    {  // b. inside the range: absolute ramp 0 -> 1 over 8 beats + relative -0.25 = ramp - 0.25, clamped below at 0 (the first blocks), exact above
      Treiber t;
      AutoSpy spy;
      sp_lauf({{{P(0, 0.f), P(8, 1.f)}, false}, {{P(0, -0.25f), P(40, -0.25f)}, true}}, 1, spy, t);
      PRUEF(spy.r.size() == 3);
      const int64_t einsatz = V + 256;
      for (size_t j = 0; j < spy.r.size() && j < 3; ++j) {
        const double beat = static_cast<double>(256 * (3 + static_cast<int64_t>(j)) + 255 - einsatz) / static_cast<double>(SPB);
        PRUEF_NAH(spy.r[j].wert, std::clamp(beat / 8.0 - 0.25, 0.0, 1.0), 1e-6);
      }
      Treiber t3;
      AutoSpy spy3;   // the same with a base well inside: absolute 0.6 + relative -0.25 = 0.35 (plain sum, no clamp involved)
      sp_lauf({{{P(0, 0.6f), P(40, 0.6f)}, false}, {{P(0, -0.25f), P(40, -0.25f)}, true}}, 2, spy3, t3);
      PRUEF(spy3.r.size() == 3);
      for (const auto& x : spy3.r) PRUEF(x.param == 2);
      for (const auto& x : spy3.r) PRUEF_NAH(x.wert, 0.35, 1e-6);
    }
    {  // c. relative only: no auto_parameter, one summand per block (the value at the last running sample), never on track 2
      Treiber t;
      AutoSpy spy;
      sp_lauf({{{P(0, -1.f), P(8, 1.f)}, true}}, 1, spy, t);
      PRUEF(spy.r.empty());
      PRUEF(spy.su.size() == 3);
      const int64_t einsatz = V + 256;
      for (size_t j = 0; j < spy.su.size() && j < 3; ++j) {
        PRUEF(spy.su[j].spur == 0 && spy.su[j].param == 1 && spy.su[j].block_s0 == 256 * (3 + static_cast<int64_t>(j)));
        const double beat = static_cast<double>(256 * (3 + static_cast<int64_t>(j)) + 255 - einsatz) / static_cast<double>(SPB);
        PRUEF_NAH(spy.su[j].wert, -1.0 + 2.0 * beat / 8.0, 1e-6);
      }
    }
  }
  PRUEF_ENDE();
}
