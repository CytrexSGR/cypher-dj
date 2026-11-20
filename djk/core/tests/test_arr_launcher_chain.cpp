// Loop deck channel strip KZ4: a launcher voice and the strip state (DJ filter, isolator) of a deck track across a snapshot swap that changes the insert chain of that track.
// The effect slot is set by a playback rebuild (a snapshot swap with the same track id and one utility stage more or less). test_arr_launcher_halt (cases 1 to 3) and test_arr_launcher_tausch (case 1)
// prove that voices survive a swap with the same id, but none of them changes the chain of the playing track in that swap.
// 128 BPM: 22 500 samples per beat; the cell is 4 beats (90 000 frames) of a 440 Hz sine (amplitude 0.5), blocks of 256, the voice starts at beat 1.
//   1  chain +1 stage (utility): the launcher state keeps the cell (same cell, not verwaist, same kennung), no block of zeros in the track bus, no step above the run without the swap
//   2  the same swap back (stage removed): same
//   3  filter -0.5 and EQ tief -200 on a 100 Hz cell before the swap: after the swap filter_leer(0) and eq_leer(0) are false (the same id keeps the state) and the low band stays down
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "check.h"

bool g_waechter = false;

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;
using cdj::ArrZelle;
using cdj::ArrZellArt;
using cdj::LaunchGrund;
using cdj::LaunchStand;

static const uint64_t ID = cdj::arr_id("s1");
static constexpr int64_t CELL = 4 * SPB;
static constexpr int64_t BLK = 256;

// the deck track "s1" (track 1) with cell 1 (a loop of the audio) and, if mit_stufe, a utility stage in its insert chain
static cdj::ArrSnapshot* bauen(Audio& a, bool mit_stufe, int64_t nr) {
  Bau b(nr);
  b.spur(1, ArrArt::audio);
  if (mit_stufe) b.kette(1, {ArrStufe{ArrInsArt::utility, 0, true}});
  cdj::ArrSnapshot* s = b.fertig();
  cdj::ArrSpur& sp = s->spur[0];
  sp.kennung = ID;
  std::snprintf(sp.kennung_text, sizeof sp.kennung_text, "s1");
  ArrZelle z;
  z.art = ArrZellArt::loop;
  z.audio = &a.a;
  z.frames = a.a.frames;
  z.beats = 4.0;
  z.gain = 1.0f;
  z.modus = 2;
  sp.zellen[0] = z;
  sp.n_zellen = 1;
  return s;
}

struct Lauf {
  Treiber t;
  std::vector<float> bus;
  void bis(int64_t ziel) {
    while (t.s < ziel) {
      t.lauf(t.s + t.n);
      bus.insert(bus.end(), t.arr.spur_bus_l(0), t.arr.spur_bus_l(0) + t.n);
    }
  }
  void setze(const char* pfad, float w) {
    const int r = t.tab.suche(pfad);
    PRUEF(r >= 0);
    t.arr.setze_sofort(r, w);
  }
  bool zelle_steht() const {
    LaunchStand st[8];
    const int n = t.arr.launch_stand(st, 8);
    return n == 1 && st[0].kennung == ID && st[0].zelle == 1 && !st[0].verwaist;
  }
  // no block of the range [von, bis) is silent (a block of zeros would be a gap in the voice)
  bool ohne_luecke(int64_t von, int64_t bis) const {
    for (int64_t s = von; s + BLK <= bis; s += BLK) {
      float p = 0.0f;
      for (int64_t i = s; i < s + BLK; ++i) p = std::max(p, std::fabs(bus[static_cast<size_t>(i)]));
      if (p < 0.05f) return false;
    }
    return true;
  }
  float spitze(int64_t von, int64_t bis) const {
    float p = 0.0f;
    for (int64_t i = von; i < bis && i < static_cast<int64_t>(bus.size()); ++i) p = std::max(p, std::fabs(bus[static_cast<size_t>(i)]));
    return p;
  }
};
static double max_sprung(const std::vector<float>& x, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von + 1; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(x[static_cast<size_t>(i)] - x[static_cast<size_t>(i - 1)])));
  return m;
}

int main() {
  auto a440 = Audio::sinus(CELL, 440.0, 0.5f);
  const int64_t ENDE = 8 * SPB;
  const int64_t SW = 355 * BLK;   // the swap sample (90 880), a block boundary, while the voice plays (it started at beat 1)
  // the run without any swap: the bound for the step of the bus (the sine has its own steps)
  Lauf ref;
  ref.t.laden(bauen(*a440, false, 1));
  PRUEF(ref.t.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
  ref.bis(ENDE);
  const double j_ref = max_sprung(ref.bus, 2 * SPB, ENDE);
  PRUEF(ref.ohne_luecke(2 * SPB, ENDE));   // control: the check sees a playing voice
  for (const bool vorwaerts : {true, false}) {   // 1: stage added, 2: the same swap back (stage removed)
    Lauf x;
    x.t.laden(bauen(*a440, !vorwaerts, 1));
    PRUEF(x.t.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(SW);
    PRUEF(x.zelle_steht());
    PRUEF(x.t.s == SW);
    x.t.laden(bauen(*a440, vorwaerts, 2));
    PRUEF(x.zelle_steht());   // right at the swap: the same cell, not verwaist, the same kennung
    x.bis(ENDE);
    PRUEF(x.zelle_steht());
    const double j = max_sprung(x.bus, 2 * SPB, ENDE);
    std::printf("%d: %s, step %.4f (run without swap %.4f), cell stays: %d, gaps: %d\n", vorwaerts ? 1 : 2, vorwaerts ? "stage added" : "stage removed", j, j_ref, x.zelle_steht(), !x.ohne_luecke(SW, ENDE));
    PRUEF(x.ohne_luecke(SW, ENDE));   // no block of zeros from the swap on (a voice that restarted would be silent until the next onset)
    PRUEF(j <= j_ref * 1.05 + 1e-4);
    PRUEF(x.t.arr.launch_stimmen() == 1);
  }
  {  // 3: the strip state survives the swap of the chain (same id): a filter at -0.5 and the EQ low band at -200 dB on a 100 Hz cell
    auto a100 = Audio::sinus(CELL, 100.0, 0.5f);
    Lauf x, o_eq, o_ref;   // x: the swap; o_eq: filter only (control that 100 Hz passes); o_ref: filter and EQ, no swap
    for (Lauf* l : {&x, &o_eq, &o_ref}) {
      l->t.laden(bauen(*a100, false, 1));
      l->setze("spur/1/filter", -0.5f);
      PRUEF(l->t.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
    }
    x.setze("spur/1/eq/tief", -200.0f);
    o_ref.setze("spur/1/eq/tief", -200.0f);
    x.bis(SW);
    o_eq.bis(ENDE);
    o_ref.bis(ENDE);
    PRUEF(!x.t.arr.filter_leer(0) && !x.t.arr.eq_leer(0));
    const float vorher = x.spitze(SW - 4000, SW);
    x.t.laden(bauen(*a100, true, 2));
    PRUEF(!x.t.arr.filter_leer(0) && !x.t.arr.eq_leer(0));   // the same id keeps the state
    x.bis(ENDE);
    PRUEF(!x.t.arr.filter_leer(0) && !x.t.arr.eq_leer(0));
    // the cell wraps at beat 5 (sample 112 500) and a 100 Hz cell has a click there, which any low cut lets through a little: the quiet window ends before it, the whole run is held against the run without swap
    const float nachher = x.spitze(SW + 2000, 4 * SPB + 20000);
    const float gesamt = x.spitze(SW + 2000, ENDE), gesamt_ref = o_ref.spitze(SW + 2000, ENDE);
    const float frei = o_eq.spitze(SW + 2000, ENDE);
    std::printf("3: 100 Hz peak: control (filter only) %.3f, before the swap %.4f, after the swap %.4f (to the loop wrap), whole run %.4f (without swap %.4f); filter_leer %d, eq_leer %d\n", frei, vorher, nachher,
                gesamt, gesamt_ref, x.t.arr.filter_leer(0), x.t.arr.eq_leer(0));
    PRUEF(frei > 0.2f);
    PRUEF(vorher < 0.05f);
    PRUEF(nachher < 0.05f);   // the low band stays down across the swap
    PRUEF(gesamt <= gesamt_ref * 1.05f + 1e-3f);
    PRUEF(x.zelle_steht());
  }
  PRUEF_ENDE();
}
