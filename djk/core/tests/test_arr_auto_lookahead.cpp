// Automation Slice 2 (1.12), the look-ahead inside a hold window of Arrangement::auto_block: it must change nothing but the cost.
// Every scene runs twice on the same snapshot, once with the look-ahead (the default) and once with the test seam setze_auto_vorausschau(false), which evaluates
// every lane sample as before the optimisation. Per block the hash covers the six block outputs, the PM tap, the lane buffers auto_buf_ of all tracks and fields,
// the project beats ap_, the hold state, the blend state and the cursor of every lane. Both runs must give the same hash, block for block.
// Scenes: a loop shorter than the hold (11 samples), block sizes other than 256, a tempo ramp, a zigzag lane (20 dB per 0.01 beat), dense points
// (small wiggles 9 samples apart, ties), a mix of all lane shapes with a loop seam. Positive control: the hold of 16 against a hold of 1 gives another hash.
// Mutations (WILL_FAIL): ARR_AUTO_VORAUS_CURSOR (no check that the cursor stayed on its point), ARR_AUTO_VORAUS_NAHT (no look for the loop seam),
// ARR_AUTO_VORAUS_TOL (no tolerance check at the end of the look-ahead): each makes this test red.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "arr_build.h"
#include "check.h"

namespace cdj {
struct ArrPruefZugang {
  static const float* puffer(const Arrangement& a, int i, int f) { return a.auto_buf_[i][f]; }
  template <class F> static void zustand(const Arrangement& a, int m, F&& feed) {
    for (int i = 0; i < ARR_SPUREN; ++i)
      for (int f = 0; f < 4; ++f) {
        feed(a.auto_buf_[i][f], sizeof(float) * static_cast<size_t>(m));
        feed(&a.auto_halt_n_[i][f], sizeof(int));
        feed(&a.auto_halt_v_[i][f], sizeof(float));
        const unsigned char war = a.auto_war_[i][f];
        feed(&war, 1);
        feed(&a.auto_zuletzt_[i][f], sizeof(float));
        feed(&a.blende_n_[i][f], sizeof(int));
        feed(&a.blende_g0_[i][f], sizeof(float));
        feed(&a.blende_s_[i][f], sizeof(int64_t));
        const int cur = a.auto_l_[i][f].cursor();
        feed(&cur, sizeof(int));
        if (f < 2) {   // 1.12 slice 5: the cursor of the relative lane (value stack)
          const int rcur = a.auto_r_[i][f].cursor();
          feed(&rcur, sizeof(int));
        }
      }
    feed(a.ap_, sizeof(double) * static_cast<size_t>(m));
  }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;
using Z = cdj::ArrPruefZugang;

namespace {
struct Hash {
  uint64_t h = 1469598103934665603ull;
  void feed(const void* p, size_t n) {
    const unsigned char* b = static_cast<const unsigned char*>(p);
    for (size_t i = 0; i < n; ++i) h = (h ^ b[i]) * 1099511628211ull;
  }
};

ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }

enum Lage { MISCH, ZICKZACK, DICHT };

std::vector<ArrAutoPunkt> fader(Lage lage, int k) {
  std::vector<ArrAutoPunkt> p;
  if (lage == ZICKZACK) {   // 20 dB per 0.01 beat: nearly every hold window leaves the tolerance
    for (int j = 0; j < 1200; ++j) p.push_back(P(j * 0.01, (j + k) % 2 ? 0.f : -20.f));
  } else if (lage == DICHT) {   // 9 samples (0.0004 beat) apart, wiggles around 0.1 dB, now and then two points on one beat
    for (int j = 0; j < 3000; ++j) {
      const double b = j * 0.0004;
      p.push_back(P(b, -6.f + ((j * 7 + k) % 5) * 0.025f - 0.05f, static_cast<uint8_t>((j % 11) == 0 ? 2 : 0)));
      if (j % 97 == 0) p.push_back(P(b, -6.f + 0.2f));
    }
  } else {
    const float a = -3.0f - static_cast<float>(k % 7);
    switch (k % 8) {
      case 0: p = {P(0, 0.f), P(8, a), P(16, 0.f), P(24, a * 0.5f), P(32, -2.f)}; break;
      case 1: p = {P(0, 0.f), P(8, a, 1), P(16, 0.f, 1), P(24, a, 1)}; break;
      case 2: p = {P(0, 0.f), P(5, a, 2), P(9, 0.f, 2), P(13, a * 2, 2), P(20, -1.f, 0)}; break;
      case 3: p = {P(0, 0.f), P(6, -200.f), P(10, -200.f), P(11, a), P(20, -130.f), P(22, 0.f), P(30, -150.f)}; break;
      case 4: p = {P(0, 0.f), P(4, 0.f), P(4.5, -60.f), P(10, -60.f), P(10.25, 0.f), P(12, 0.f), P(12.01, -40.f), P(30, -41.f)}; break;
      case 5: p = {P(0, 0.f), P(8.0 - 1e-10, a), P(8, 0.f), P(8, -9.f), P(16, -9.f), P(16, 0.f), P(24, a)}; break;
      case 6: p = {P(3.5, a)}; break;
      default: p = {P(2, 0.f), P(2.001, -0.04f), P(2.002, 0.f), P(3, -0.05f), P(30, -0.2f)}; break;
    }
  }
  return p;
}

std::vector<ArrAutoPunkt> pan(Lage lage, int k) {
  std::vector<ArrAutoPunkt> p;
  const float a = -1.0f + 0.07f * static_cast<float>(k % 29);
  if (lage == ZICKZACK) {
    for (int j = 0; j < 1200; ++j) p.push_back(P(j * 0.01, (j + k) % 2 ? 1.f : -1.f));
  } else if (lage == DICHT) {
    for (int j = 0; j < 3000; ++j) p.push_back(P(j * 0.0004, 0.1f + ((j * 3 + k) % 5) * 0.0015f));
  } else {
    switch (k % 4) {
      case 0: p = {P(0, -1.f), P(10, 1.f), P(20, -1.f), P(30, a)}; break;
      case 1: p = {P(0, a), P(30, -a)}; break;
      case 2: p = {P(0, 0.f), P(7, 1.f, 1), P(14, -1.f, 1), P(21, 0.f, 2), P(25, a, 2)}; break;
      default: p = {P(0, 0.f), P(0.01, 0.f), P(0.02, 0.5f), P(5, 0.5f), P(5.001, -0.5f), P(30, 0.5f)}; break;
    }
  }
  return p;
}

struct Szene {
  const char* name;
  Lage lage = MISCH;
  int bloecke = 1200;
  bool schleife = false;
  double loop_von = 0.0, loop_bis = 16.0;
  bool rampe = false;
  bool blockwechsel = false;
  double start_beat = 0.0;
  int schritt = 16;
  int stapel = 0;   // 1.12 slice 5: 0 only absolute lanes, 1 absolute and relative lanes (value stack), 2 relative lanes only (base value + relative)
};

// A relative lane from an absolute shape: the same points, values scaled into the (narrower) relative range
std::vector<ArrAutoPunkt> skaliert(std::vector<ArrAutoPunkt> p, float faktor) {
  for (ArrAutoPunkt& x : p) x.wert *= faktor;
  return p;
}

std::unique_ptr<Audio> g_audio;

uint64_t lauf(const Szene& sz, bool vorausschau) {
  Treiber t;
  t.k = cdj::Karte(128.0, 0);
  if (sz.rampe) {
    t.k.rampe(1.0, 190.0, 3.0);
    t.k.rampe(6.0, 70.0, 0.5);
    t.k.rampe(9.0, 133.0, 5.0);
  }
  t.arr.setze_auto_schritt(sz.schritt);
  t.arr.setze_auto_vorausschau(vorausschau);
  Bau b;
  for (int sp = 1; sp <= 8; ++sp) {
    b.spur(sp, ArrArt::audio).clip(sp, ("c" + std::to_string(sp)).c_str(), 0.0, 60.0, &g_audio->a, (sp * 977) % 20000);
    if (sz.stapel != 2) {
      b.lane(sp, fader(sz.lage, sp));
      b.lane(sp, pan(sz.lage, sp), cdj::ARR_AUTO_PAN);
    }
    if (sz.stapel != 0) {
      b.lane(sp, skaliert(fader(sz.lage, sp + 3), 0.3f), cdj::ARR_AUTO_FADER, 0, true);
      b.lane(sp, skaliert(pan(sz.lage, sp + 1), 0.5f), cdj::ARR_AUTO_PAN, 0, true);
    }
  }
  t.laden(b.fertig());
  if (sz.schleife) t.arr.loop(true, sz.loop_von, sz.loop_bis, 0, t.k);
  t.arr.start(sz.start_beat, 0, false, 0, 537, 256, t.k);
  static const int groessen[] = {256, 5, 37, 64, 100, 513, 1024, 1000, 31, 256};
  Hash h;
  float buf[6][cdj::ARR_BLOCK];
  for (int blk = 0; blk < sz.bloecke; ++blk) {
    t.n = sz.blockwechsel ? groessen[blk % 10] : 256;
    for (auto& x : buf) std::fill(x, x + t.n, 0.0f);
    t.arr.block(t.k, t.s, t.n, buf[0], buf[1], buf[2], buf[3], buf[4], buf[5]);
    for (auto& x : buf) h.feed(x, sizeof(float) * static_cast<size_t>(t.n));
    h.feed(t.arr.pm_l(), sizeof(float) * static_cast<size_t>(t.n));
    h.feed(t.arr.pm_r(), sizeof(float) * static_cast<size_t>(t.n));
    Z::zustand(t.arr, t.n, [&](const void* p, size_t n) { h.feed(p, n); });
    t.s += t.n;
  }
  return h.h;
}
}  // namespace

int main() {
  g_audio = Audio::sinus(48000 * 40, 220.0, 0.3f);
  std::vector<Szene> szenen;
  { Szene s{"loop_unter_halten"}; s.schleife = true; s.loop_von = 0.0; s.loop_bis = 0.0005; s.bloecke = 600; szenen.push_back(s); }
  { Szene s{"loop_unter_halten_versetzt"}; s.schleife = true; s.loop_von = 3.0; s.loop_bis = 3.0007; s.start_beat = 2.9999; s.bloecke = 600; szenen.push_back(s); }
  { Szene s{"blockgroessen"}; s.blockwechsel = true; s.bloecke = 1500; szenen.push_back(s); }
  { Szene s{"blockgroessen_loop"}; s.blockwechsel = true; s.schleife = true; s.loop_von = 1.0; s.loop_bis = 5.5; s.bloecke = 1500; szenen.push_back(s); }
  { Szene s{"tempo_rampe"}; s.rampe = true; s.bloecke = 1600; szenen.push_back(s); }
  { Szene s{"tempo_rampe_loop"}; s.rampe = true; s.schleife = true; s.loop_von = 0.5; s.loop_bis = 7.0; s.blockwechsel = true; s.bloecke = 1600; szenen.push_back(s); }
  { Szene s{"zickzack"}; s.lage = ZICKZACK; s.bloecke = 800; szenen.push_back(s); }
  { Szene s{"zickzack_blockgroessen"}; s.lage = ZICKZACK; s.blockwechsel = true; s.bloecke = 800; szenen.push_back(s); }
  { Szene s{"dichte_punkte"}; s.lage = DICHT; s.bloecke = 800; szenen.push_back(s); }
  { Szene s{"dichte_punkte_loop"}; s.lage = DICHT; s.schleife = true; s.loop_von = 0.0, s.loop_bis = 0.31; s.blockwechsel = true; s.bloecke = 900; szenen.push_back(s); }
  { Szene s{"mischung_loop"}; s.schleife = true; s.bloecke = 2000; szenen.push_back(s); }
  { Szene s{"mischung_start_mitte"}; s.start_beat = 5.3; s.bloecke = 1200; szenen.push_back(s); }
  { Szene s{"halten_7"}; s.schritt = 7; s.blockwechsel = true; s.bloecke = 1200; szenen.push_back(s); }
  // 1.12 slice 5 U9: the same equality with a value stack (absolute + relative lanes) and with relative lanes only
  { Szene s{"stapel_mischung_loop"}; s.stapel = 1; s.schleife = true; s.bloecke = 2000; szenen.push_back(s); }
  { Szene s{"stapel_blockgroessen"}; s.stapel = 1; s.blockwechsel = true; s.bloecke = 1500; szenen.push_back(s); }
  { Szene s{"stapel_tempo_rampe_loop"}; s.stapel = 1; s.rampe = true; s.schleife = true; s.loop_von = 0.5; s.loop_bis = 7.0; s.blockwechsel = true; s.bloecke = 1600; szenen.push_back(s); }
  { Szene s{"stapel_zickzack"}; s.stapel = 1; s.lage = ZICKZACK; s.bloecke = 800; szenen.push_back(s); }
  { Szene s{"stapel_dichte_punkte_loop"}; s.stapel = 1; s.lage = DICHT; s.schleife = true; s.loop_von = 0.0, s.loop_bis = 0.31; s.blockwechsel = true; s.bloecke = 900; szenen.push_back(s); }
  { Szene s{"stapel_start_mitte"}; s.stapel = 1; s.start_beat = 5.3; s.bloecke = 1200; szenen.push_back(s); }
  { Szene s{"nur_relativ_loop"}; s.stapel = 2; s.schleife = true; s.bloecke = 2000; szenen.push_back(s); }
  { Szene s{"nur_relativ_blockgroessen"}; s.stapel = 2; s.blockwechsel = true; s.bloecke = 1500; szenen.push_back(s); }
  for (const Szene& s : szenen) {
    const uint64_t mit = lauf(s, true), ohne = lauf(s, false);
    std::printf("%-28s mit %016llx ohne %016llx %s\n", s.name, static_cast<unsigned long long>(mit), static_cast<unsigned long long>(ohne), mit == ohne ? "gleich" : "VERSCHIEDEN");
    PRUEF(mit == ohne);
  }
  {  // positive control: another hold gives another hash, so the hash is not blind to the buffers
    Szene s{"kontrolle"};
    s.lage = DICHT;
    s.bloecke = 300;
    const uint64_t h16 = lauf(s, false);
    s.schritt = 1;
    const uint64_t h1 = lauf(s, false);
    PRUEF(h16 != h1);
    Szene t{"kontrolle_stapel"};   // the stack changes the hash: the relative lanes are not ignored
    t.bloecke = 300;
    const uint64_t ohne_rel = lauf(t, false);
    t.stapel = 1;
    PRUEF(lauf(t, false) != ohne_rel);
  }
  PRUEF_ENDE();
}
