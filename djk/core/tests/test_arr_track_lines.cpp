// Container core K7: the track rows spur/<n>/pfl, spur/<n>/trim and spur/<n>/kill/{tief,mitte,hoch} (fields ARR_F_CUE, ARR_F_TRIM, ARR_F_KILL0 + band of the track strip).
// Cases: 1 neutral rows (trim 0, kill 0, pfl 0 written explicitly) are bit-equal to a run that never touched them, 2 kill of the low band cuts a 60 Hz sine (more than 60 dB), and the release
// brings back the stored eq (-3 dB on tief): the output after the release equals the run with eq -3 dB and no kill (within 0.05 dB) -- the kill does not overwrite the eq row, 3 trim +6 dB lifts
// the output by 6.0 dB (+-0.01) and trim -6 lowers it by the same, 4 pfl: the cue pair carries the track (pre-fader: also with the fader closed), the master pair is bit-equal to the run without
// pfl, and the run without pfl has a silent cue, 5 the rows are per track (track 2 untouched while track 1 is killed and trimmed).
// Mutation (CMakeLists.txt): SPUR_KILL_OHNE_RUECKKEHR (the kill leaves -200 in the eq field for good: case 2 red).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arrangement.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static constexpr int64_t FRAMES = 200000;
#define TR(n) auto n##_p = std::make_unique<Treiber>(); Treiber& n = *n##_p;

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, int n_spuren) {
  Bau b(1);
  for (int sp = 1; sp <= n_spuren; ++sp) {
    const std::string id = "c" + std::to_string(sp);
    b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, a);
  }
  return b.fertig();
}
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis) {
  t.laden(s);
  t.arr.start(0.0, 0, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static double rms(const std::vector<float>& x, int64_t von, int64_t bis) {
  double e = 0.0;
  for (int64_t i = von; i < bis; ++i) e += static_cast<double>(x[i]) * x[i];
  return std::sqrt(e / static_cast<double>(bis - von));
}
static double db(double v, double ref) { return 20.0 * std::log10(std::max(v, 1e-12) / ref); }
static bool gleich(const std::vector<float>& a, const std::vector<float>& b) { return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0; }

int main() {
  const auto s60 = Audio::sinus(FRAMES, 60.0, 0.25f);
  const auto s1k = Audio::sinus(FRAMES, 1000.0, 0.25f);
  const int64_t BIS = 120000, VON = 90000;

  // 1 neutral
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 1), BIS);
    PRUEF(rms(ref.l, VON, BIS) > 0.05);
    TR(n0)
    n0.arr.setze_sofort(reg(n0, "spur/1/trim"), 0.0f);
    n0.arr.setze_sofort(reg(n0, "spur/1/pfl"), 0.0f);
    for (const char* b : {"tief", "mitte", "hoch"}) n0.arr.setze_sofort(reg(n0, std::string("spur/1/kill/") + b), 0.0f);
    spiele(n0, snap(&s1k->a, 1), BIS);
    PRUEF(gleich(ref.l, n0.l) && gleich(ref.r, n0.r));
    PRUEF(n0.arr.eq_leer(0));
  }

  // 2 kill of the low band, release restores the stored eq
  {
    TR(ref)   // eq tief -3 dB, no kill
    ref.arr.setze_sofort(reg(ref, "spur/1/eq/tief"), -3.0f);
    spiele(ref, snap(&s60->a, 1), BIS);
    TR(k)       // kill 1 for the first half, 0 afterwards, delivered as a course per sample
    k.arr.setze_sofort(reg(k, "spur/1/eq/tief"), -3.0f);
    const int rk = reg(k, "spur/1/kill/tief");
    const int64_t FREI = 80000;
    k.laden(snap(&s60->a, 1));
    k.arr.start(0.0, 0, false, 0, V, 256, k.k);
    static float kurs[256];
    k.vor_block = [&](int64_t s0) {
      for (int i = 0; i < 256; ++i) kurs[i] = (s0 + i < FREI) ? 1.0f : 0.0f;
      k.arr.verlauf(rk, kurs);
    };
    k.lauf(BIS);
    const double ist_ref = rms(ref.l, VON, BIS);
    const double gekillt = db(rms(k.l, 50000, 78000), ist_ref);
    const double danach = db(rms(k.l, VON, BIS), ist_ref);
    std::printf("2: killed %.2f dB, after release %.3f dB vs eq -3 dB\n", gekillt, danach);
    PRUEF(gekillt < -60.0);
    PRUEF(std::fabs(danach) < 0.05);
  }

  // 3 trim
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 2), BIS);
    TR(hoch)
    hoch.arr.setze_sofort(reg(hoch, "spur/2/trim"), 6.0f);
    spiele(hoch, snap(&s1k->a, 2), BIS);
    TR(tief)
    tief.arr.setze_sofort(reg(tief, "spur/2/trim"), -6.0f);
    spiele(tief, snap(&s1k->a, 2), BIS);
    const double r0 = rms(ref.l, VON, BIS);
    const double dh = db(rms(hoch.l, VON, BIS), r0), dt = db(rms(tief.l, VON, BIS), r0);
    std::printf("3: trim +6 gives %.4f dB, trim -6 gives %.4f dB (two tracks, each 1 kHz)\n", dh, dt);
    // the reference has two tracks; the trimmed run lifts track 2 only: mix of 1.0 and 1.995 -> compare via the single-track form below
    PRUEF(dh > 0.0 && dt < 0.0);
    TR(r1)
    spiele(r1, snap(&s1k->a, 1), BIS);
    TR(t1)
    t1.arr.setze_sofort(reg(t1, "spur/1/trim"), 6.0f);
    spiele(t1, snap(&s1k->a, 1), BIS);
    TR(t2)
    t2.arr.setze_sofort(reg(t2, "spur/1/trim"), -6.0f);
    spiele(t2, snap(&s1k->a, 1), BIS);
    const double e = rms(r1.l, VON, BIS);
    PRUEF_NAH(db(rms(t1.l, VON, BIS), e), 6.0, 0.01);
    PRUEF_NAH(db(rms(t2.l, VON, BIS), e), -6.0, 0.01);
  }

  // 4 pfl
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 3), BIS);
    PRUEF(rms(ref.cl, VON, BIS) == 0.0 && rms(ref.cr, VON, BIS) == 0.0);
    TR(p)
    p.arr.setze_sofort(reg(p, "spur/3/pfl"), 1.0f);
    spiele(p, snap(&s1k->a, 3), BIS);
    PRUEF(rms(p.cl, VON, BIS) > 0.05 && rms(p.cr, VON, BIS) > 0.05);
    PRUEF(gleich(ref.l, p.l) && gleich(ref.r, p.r));   // the master does not move
    TR(zu)   // pre-fader: the cue stays while the fader is shut
    zu.arr.setze_sofort(reg(zu, "spur/3/pfl"), 1.0f);
    zu.arr.setze_sofort(reg(zu, "spur/3/fader"), -200.0f);
    spiele(zu, snap(&s1k->a, 3), BIS);
    PRUEF(rms(zu.cl, VON, BIS) > 0.05);
    PRUEF(rms(zu.l, VON, BIS) < 0.75 * rms(ref.l, VON, BIS));   // two of the three equal tracks are left: 2/3
  }

  // 5 per track
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 2), BIS);
    TR(t)
    t.arr.setze_sofort(reg(t, "spur/1/trim"), 6.0f);
    t.arr.setze_sofort(reg(t, "spur/1/kill/hoch"), 1.0f);
    spiele(t, snap(&s1k->a, 2), BIS);
    for (int f : {cdj::ARR_F_CUE, cdj::ARR_F_TRIM, cdj::ARR_F_KILL0, cdj::ARR_F_KILL0 + 1, cdj::ARR_F_KILL0 + 2}) PRUEF(t.arr.wert(1, f) == 0.0f);
    PRUEF(t.arr.wert(0, cdj::ARR_F_TRIM) == 6.0f && t.arr.wert(0, cdj::ARR_F_KILL0 + 2) == 1.0f);
  }
  PRUEF_ENDE();
}
