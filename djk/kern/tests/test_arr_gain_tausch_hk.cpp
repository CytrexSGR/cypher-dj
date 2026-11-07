// Integration of AK33 F4 (a gain-only edit on a sounding RE-PITCH, BEATS or plain voice ramps the gain in place) with 1.12 slice 5 (the gain envelope of the voice).
// The two were built on separate branches: the in-place branch of F4 takes `gleich_ausser_gain`, which ignores the envelope table, so an edit that changes the gain
// of a clip WITH an envelope must also (a) keep the envelope running (the gain edit alone must leave the factor of the table in force), and (b) follow a table that
// changes in the same swap: the cursor of the voice moves to the new table and the factor glides, as the werk voice branch does (hk_gleich / hk_umbinden).
// Constant source 0.5, centre pan: the level at the master is 0.5 * 0.7071 * gain * hk, so every dB value can be computed back.
//   case 1: gain 1 -> 0.5, same table (a ramp -12 -> 0 dB over 16 beats): the ratio of the edited run to the run without the edit ramps from 1 to 0.5 (no overshoot,
//           no step larger than a ramp over ARR_NAHT) and the level at later beats still follows the line of the table (-12 + 12 * b / 16 dB) minus 6.02 dB
//   case 2: gain 1 -> 0.5 and the table becomes flat -6 dB in the same swap: after the glide the level is -6.02 - 6.02 dB = -12.04 dB (the new table, not the old line)
// Negative control: the run without any edit holds the line of the table (0.05 dB).
// Mutation CYPHERDJ_MUTATION_ARR_GAIN_HK_BINDUNG_OHNE (the in-place gain branch leaves the cursor on the table of the old snapshot): case 2 goes red.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;   // centre pan, -3 dB
static constexpr int EDIT_BLOCK = 190;     // the edit at the start of block 190 (sample 48 640, beat 2.03 at 120 bpm)

static ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
static double db_von_pegel(double pegel, double voll) { return 20.0 * std::log10(std::max(std::fabs(pegel) / voll, 1e-12)); }
static constexpr double BEAT_S = 24000.0;     // 120 bpm

static cdj::ArrSnapshot* bauen(const cdj::ArrAudio* a, int art, float gain, std::vector<ArrAutoPunkt> hk, int64_t nr) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, a, 0, gain);
  if (art == 1) b.warp({0.0, 16.0}, {0.0, 16.0 * BEAT_S}, 0);
  if (art == 2) {
    std::vector<double> eb, ef;
    for (int k = 0; k < 16; ++k) {
      eb.push_back(k);
      ef.push_back(BEAT_S * k);
    }
    b.warp({0.0, 16.0}, {0.0, 16.0 * BEAT_S}, 1).beats(eb, ef, 0, 100);
  }
  b.hk(std::move(hk));
  return b.fertig();
}

// edit: at the start of block EDIT_BLOCK the snapshot is swapped for one with the given gain and table; a run without edit keeps the first one
static void fahre(Treiber& t, const cdj::ArrAudio* a, int art, bool edit, float g1, std::vector<ArrAutoPunkt> hk1) {
  t.k = cdj::Karte(120.0, 0);
  t.laden(bauen(a, art, 1.0f, {P(0, -12.f), P(16, 0.f)}, 1));
  t.arr.start(0.0, 0, false, 0, V, 256, t.k);
  t.lauf(static_cast<int64_t>(EDIT_BLOCK) * 256);
  if (edit) t.laden(bauen(a, art, g1, std::move(hk1), 2));
  t.lauf(static_cast<int64_t>(17 * BEAT_S));
}

int main() {
  auto a = Audio::gleich(1200000);   // 25 s at 48 kHz, constant 0.5
  for (int art : {0, 1, 2}) {
    Treiber ohne, mit;
    fahre(ohne, &a->a, art, false, 1.0f, {});
    fahre(mit, &a->a, art, true, 0.5f, {P(0, -12.f), P(16, 0.f)});
    const int64_t s0 = ohne.arr.zustand(ohne.k, ohne.s).ursprung_sample;
    const int64_t se = static_cast<int64_t>(EDIT_BLOCK) * 256;
    // case 1: ratio of the edited run to the run without the edit over the 800 samples after the edit
    double ueber = 0.0, schritt = 0.0, ende = 0.0, letzte = -1.0;
    int n = 0;
    for (int64_t i = se - 50; i < se + 800; ++i) {
      const double x = ohne.l[i], y = mit.l[i];
      if (std::fabs(x) < 0.01) continue;
      const double r = y / x;
      ++n;
      ueber = std::max(ueber, std::max(0.5 - r, r - 1.0));
      if (letzte >= 0.0) schritt = std::max(schritt, std::fabs(r - letzte));
      letzte = r;
      if (i >= se + 400) ende = std::max(ende, std::fabs(r - 0.5));
    }
    std::printf("MESS art %d case 1: samples %d, overshoot %.5f, largest step %.6f (ramp limit %.6f), end error %.6f\n", art, n, ueber, schritt, 0.5 / cdj::ARR_NAHT * 1.2, ende);
    PRUEF(n > 100);
    PRUEF(ueber < 2e-3);
    PRUEF(schritt <= 0.5 / cdj::ARR_NAHT * 1.2);   // exactly one ramp over ARR_NAHT (measured 0.5/96), not a step
    PRUEF(ende < 3e-3);
    for (int b : {6, 10, 14}) {   // the envelope still runs after the edit
      const double soll = -12.0 + 12.0 * (b + (art == 2 ? 0.5 : 0.0)) / 16.0 + 20.0 * std::log10(0.5);
      const int64_t sm = s0 + std::llround((b + (art == 2 ? 0.5 : 0.0)) * BEAT_S);
      PRUEF_NAH(db_von_pegel(mit.l[sm], 0.5 * MITTE), soll, 0.05);
      PRUEF_NAH(db_von_pegel(ohne.l[sm], 0.5 * MITTE), soll - 20.0 * std::log10(0.5), 0.05);   // negative control: no edit, the line of the table
    }
    // case 2: gain and table change in one swap
    Treiber zwei;
    fahre(zwei, &a->a, art, true, 0.5f, {P(0, -6.f), P(16, -6.f)});
    for (int b : {6, 10, 14}) {
      const double bp = b + (art == 2 ? 0.5 : 0.0);
      PRUEF_NAH(db_von_pegel(zwei.l[s0 + std::llround(bp * BEAT_S)], 0.5 * MITTE), -6.0 + 20.0 * std::log10(0.5), 0.05);
    }
  }
  PRUEF_ENDE();
}
