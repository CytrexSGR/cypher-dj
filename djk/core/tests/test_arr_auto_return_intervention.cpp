// Hand override of a RETURN fader lane (the track override of test_arr_auto_eingriff, mirrored for the return slots): while the lane of ret/1/fader plays, a grip on that
// fader (here: auto_uebersteuern on slot ARR_SPUREN + 0, the call the core makes after the Stellwerk cycle) lets the hand course play instead of the lane, from the grip sample on.
// Measured on the output of return 1 (pre send of a constant clip, no Hall, so the master left channel is the return output, 0.5 at 0 dB).
//   (a) grip in the middle of a block, lane 0 -> -30 dB over 16 beats: the lane plays up to the grip sample, from there the 480 blend (linear in the gain) to the hand value, then the hand
//   (b) re-enable in the middle of a block: blend back to the lane within 480 samples, then exactly the lane (reference run without a grip)
//   (c) the override survives stop and start; a second return with its own lane is untouched; a slot without a lane or a field other than the fader refuses an override
//   (d) while the transport does not play nothing starts (D5)
//   (e) auto_alle_freigeben (the "all lanes back" of /k/arr/auto nr 0) releases the return too
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;

namespace {
constexpr int64_t V = 537;
constexpr double SPB = 22500.0;   // samples per beat at 128 BPM (the Treiber default)
constexpr float H = -20.0f;       // the hand value of the return fader
constexpr int SLOT1 = cdj::ARR_SPUREN + 0;   // automation slot of return 1
constexpr int SLOT2 = cdj::ARR_SPUREN + 1;

ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
double lin(double db) { return std::pow(10.0, db / 20.0); }
double db_von(double g) { return 20.0 * std::log10(std::max(g, 1e-12)); }

struct Szene {
  std::unique_ptr<Audio> au = Audio::gleich(1200000);
  Treiber t;
  float hand[cdj::ARR_BLOCK];   // the Stellwerk course of ret/1/fader (the Arrangement keeps the pointer for the block)
  int r;
  Szene(std::vector<ArrAutoPunkt> lane1, std::vector<ArrAutoPunkt> lane2 = {}) {
    r = t.tab.suche("ret/1/fader");
    PRUEF(r >= 0);
    for (const char* p : {"ret/1/hall/an", "ret/2/hall/an", "ret/3/hall/an", "ret/4/hall/an"}) t.arr.setze_sofort(t.tab.suche(p), 0.0f);
    t.arr.setze_sofort(t.tab.suche("spur/1/fader"), -200.0f);   // the direct path is silent, the pre send carries the signal
    t.arr.setze_sofort(t.tab.suche("spur/1/send/1"), 0.0f);
    t.arr.setze_sofort(t.tab.suche("ret/1/fader"), 0.0f);
    t.arr.setze_sofort(t.tab.suche("ret/2/fader"), 0.0f);
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 20.0, &au->a).ret(1);
    if (!lane1.empty()) b.ret_lane(1, lane1);
    if (!lane2.empty()) b.ret_lane(2, lane2);
    cdj::ArrSnapshot* s = b.fertig();
    s->ret_pre[0] = true;
    s->ret_pre[1] = true;
    t.laden(s);
  }
  void starten() { PRUEF(t.arr.start(0.0, 0, false, 0, V, 256, t.k)); }
  int64_t start_sample() { return t.arr.zustand(t.k, t.s).ursprung_sample; }
  void hand_setzen(float v) {   // the Stellwerk course from the next block on: a constant
    std::fill(hand, hand + cdj::ARR_BLOCK, v);
    t.arr.verlauf(r, hand);
  }
  double gain(int64_t s) const { return std::fabs(t.l[static_cast<size_t>(s)]) / 0.5; }
  int64_t block_bei(double beat) { return (static_cast<int64_t>(start_sample() + beat * SPB) / 256 + 1) * 256; }
  template <class F> void lauf(int64_t bis, F&& vor) {
    t.vor_block = [&](int64_t s0) { vor(s0); };
    t.lauf(bis);
    t.vor_block = nullptr;
  }
  void lauf(int64_t bis) { t.lauf(bis); }
};

const std::vector<ArrAutoPunkt> LANE{P(0, 0.f), P(16, -30.f)};
double lane_db(Szene& z, int64_t s) { return -30.0 * static_cast<double>(s - z.start_sample()) / SPB / 16.0; }
}  // namespace

int main() {
  {  // (a) grip in the middle of a block
    Szene z(LANE);
    z.starten();
    const int64_t G = z.block_bei(6.0), sg = G + 100;
    bool ok = false;
    z.lauf(G + 8000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(H);
      ok = z.t.arr.auto_uebersteuern(SLOT1, 0, true, sg);
    });
    PRUEF(ok);
    PRUEF(z.t.arr.auto_uebersteuert(SLOT1, 0));
    for (int64_t s = sg - 600; s < sg; ++s) PRUEF_NAH(db_von(z.gain(s)), lane_db(z, s), 0.05);   // the lane plays up to the grip sample
    const double g0 = z.gain(sg - 1), gh = lin(H);
    PRUEF(g0 > 0.2 && g0 < 0.35);   // about -11 dB: the positive control that the lane played
    std::printf("a: g0 %.5f gH %.5f first %.5f last %.5f\n", g0, gh, z.gain(sg), z.gain(sg + 479));
    for (int j = 0; j < 480; ++j) PRUEF_NAH(z.gain(sg + j), g0 + (gh - g0) * (j + 1) / 480.0, 2e-4);   // linear in the gain
    for (int64_t s = sg + 480; s < sg + 4000; ++s) PRUEF_NAH(z.gain(s), gh, 2e-4);
    // negative control: the same run without a grip plays the lane on
    Szene n(LANE);
    n.starten();
    n.lauf(G + 8000);
    PRUEF_NAH(db_von(n.gain(sg + 2000)), lane_db(n, sg + 2000), 0.05);
    PRUEF(!n.t.arr.auto_uebersteuert(SLOT1, 0));
  }
  {  // (b) re-enable in the middle of a block
    Szene z(LANE), ref(LANE);
    z.starten();
    ref.starten();
    const int64_t G = z.block_bei(4.0), sg = G + 100, R = z.block_bei(8.0), sr = R + 37;
    z.lauf(R + 12000, [&](int64_t s0) {
      if (s0 == G) {
        z.hand_setzen(H);
        PRUEF(z.t.arr.auto_uebersteuern(SLOT1, 0, true, sg));
      }
      if (s0 == R) {
        PRUEF(z.t.arr.auto_uebersteuern(SLOT1, 0, false, sr));
        PRUEF(!z.t.arr.auto_uebersteuern(SLOT1, 0, false, sr));   // no change: false
      }
    });
    ref.lauf(R + 12000);
    PRUEF(!z.t.arr.auto_uebersteuert(SLOT1, 0));
    const double gh = lin(H);
    for (int64_t s = sr - 300; s < sr; ++s) PRUEF_NAH(z.gain(s), gh, 2e-4);   // the hand plays until the re-enable
    for (int j = 0; j < 480; ++j) PRUEF_NAH(z.gain(sr + j), gh + (ref.gain(sr + j) - gh) * (j + 1) / 480.0, 3e-3);
    for (int64_t s = sr + 480 + 40; s < sr + 6000; ++s) PRUEF_NAH(db_von(z.gain(s)), db_von(ref.gain(s)), 0.06);   // then exactly the lane
  }
  {  // (c) survives stop and start; the lane of return 2 is untouched; a slot without a lane refuses
    Szene z(LANE, LANE);
    z.starten();
    PRUEF(!z.t.arr.auto_uebersteuern(SLOT1 + 2, 0, true, 0));   // return 3 has no lane
    PRUEF(!z.t.arr.auto_uebersteuern(SLOT1, 1, true, 0));       // a return has only the fader field
    const int64_t G = z.block_bei(4.0), sg = G + 100;
    z.lauf(G + 3000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(H);
      PRUEF(z.t.arr.auto_uebersteuern(SLOT1, 0, true, sg));
    });
    PRUEF(z.t.arr.auto_uebersteuert(SLOT1, 0));
    PRUEF(!z.t.arr.auto_uebersteuert(SLOT2, 0));
    z.t.arr.stopp(0, z.t.s + 64, z.t.k);
    z.lauf(z.t.s + 4096);
    z.starten();
    z.lauf(z.t.s + 6 * 4096);
    PRUEF(z.t.arr.auto_uebersteuert(SLOT1, 0));   // like a track: the override survives stop and start
  }
  {  // (d) while the transport does not play nothing starts
    Szene z(LANE);
    PRUEF(!z.t.arr.auto_uebersteuern(SLOT1, 0, true, 0));
    PRUEF(!z.t.arr.auto_uebersteuert(SLOT1, 0));
  }
  {  // (e) all lanes back
    Szene z(LANE);
    z.starten();
    const int64_t G = z.block_bei(4.0);
    z.lauf(G + 512, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(H);
      PRUEF(z.t.arr.auto_uebersteuern(SLOT1, 0, true, G + 10));
    });
    PRUEF(z.t.arr.auto_uebersteuert(SLOT1, 0));
    z.t.arr.auto_alle_freigeben(z.t.s);
    PRUEF(!z.t.arr.auto_uebersteuert(SLOT1, 0));
  }
  PRUEF_ENDE();
}
