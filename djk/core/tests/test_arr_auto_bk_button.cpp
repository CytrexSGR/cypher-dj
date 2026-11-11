// 1.12 slice 7: automation lanes on the Baukasten knobs of a bk track (`geraet.k1` .. `geraet.k8`, ARR_AUTO_GERAET with param 0..7), through Arrangement::auto_geraet and the bk sink
// (ArrBkSenke::auto_parameter, auto_parameter_summand). The graph G_T plays a saw times the gate times knob 1, so the level of a held note is proportional to k1.
//   B1 absolute lane   a lane on k1 (0.2 at beat 0, 1.0 at beat 8) drives the knob in the blocks of the playback: the RMS of the held note at beats 1, 2, 4, 6 follows the lane
//                      within 4 % (ratio to the same note with the knob steady at 1.0); the same note without a lane stays flat at its knob (negative control: no lane, 0.2: flat);
//                      a lane on k2 (not used by the graph) leaves the level of k1 alone (negative control: the lane reaches the right knob)
//   B2 start           a start in the middle of the lane (beat 4): the first blocks already play the lane value of that beat (the knob jumps at the start, no glide from the snapshot knob)
//   B3 swap            a swap to a snapshot without the lane glides the knob back to the snapshot value without a step (no sample step larger than the steady note's own, at most 20 % over)
//   B4 relative lane   a relative lane (clip envelope) alone adds to the snapshot knob: snapshot k1 0.5, summand -0.3 at beat 0 to +0.5 at beat 8: the level follows clamp(0.5 + summand);
//                      an absolute and a relative lane together give the clamped sum
//   B5 no allocation   2000 blocks with lanes on k1 and k2 and a swap: 0 allocations, locks and sleeps (positive control: the counter sees an allocation)
// Mutations (CMakeLists.txt): none of its own: the dispatch is covered by ARR_INTERN_OHNE_AUTO (test_arr_intern_senke) and ARR_BK_REGLER_NUR_START (test_arr_bk_senke).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "bk_help.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_kit_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;

namespace {

// the dispatcher with all three sinks, as in the kern (a lane value goes through ArrInternSenke::auto_parameter to the sink of the device)
struct Sinken {
  cdj::ArrRbSenke rb;
  cdj::ArrBkSenke bk;
  cdj::ArrKitSenke kit;
  cdj::ArrInternSenke intern;
  explicit Sinken(cdj::Arrangement& a) : rb(a), bk(a), kit(a), intern(a, &rb, &bk, &kit) { a.setze_senke_intern(&intern); }
};

double rms(const std::vector<float>& v, int64_t von, int64_t bis) {
  double q = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(v.size()); ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}
double max_schritt(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von + 1; i < bis && i < static_cast<int64_t>(v.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(v[i] - v[i - 1])));
  return m;
}

struct Lauf {
  std::vector<float> l;
  uint64_t verloren = 0;
};
using Punkte = std::vector<cdj::ArrAutoPunkt>;
constexpr uint8_t GER = cdj::ARR_AUTO_GERAET;

// a held note on track 1 (bk, G_T), knob k1 `k1` in the snapshot, the lanes given as {knob index, points, relative}; start at `ab_beat`, `beats` of playback
struct Bahn {
  int knopf;
  Punkte p;
  bool relativ = false;
};
Lauf spiele(float k1, const std::vector<Bahn>& lanen, double beats, double ab_beat = 0.0, double note_beat = 0.0) {
  Lauf f;
  Treiber t;
  Sinken sk(t.arr);
  CypherBk* h = bkt::neu(bkt::G_T);
  Bau b;
  b.spur(1, ArrArt::intern).note(1, "v/n1", note_beat, 64.0, 45, 127);
  for (const Bahn& x : lanen) b.lane(1, x.p, GER, static_cast<uint8_t>(x.knopf), x.relativ);
  cdj::ArrSnapshot* s = b.fertig();
  bkt::spur(s, 1, h, 1, {{"k1", k1}});
  t.laden(s);
  t.arr.start(ab_beat, 0, false, t.s, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(beats * static_cast<double>(SPB)) + 537 + 256);
  f.l = t.l;
  f.verloren = sk.bk.verloren();
  t.arr.setze_senke_intern(nullptr);
  cypher_bk_frei(h);
  return f;
}

// the RMS of a window of 4096 samples centred on `beat` (the playback started at beat `ab`, sample 537 + 256 is its first sample)
double pegel(const Lauf& f, double beat, double ab = 0.0) {
  const int64_t mitte = 537 + 256 + static_cast<int64_t>((beat - ab) * static_cast<double>(SPB));
  return rms(f.l, mitte - 2048, mitte + 2048);
}

float lane_wert(double beat) { return 0.2f + 0.8f * static_cast<float>(std::min(beat, 8.0) / 8.0); }

}  // namespace

int main() {
  const Punkte steigend = {{0.0, 0.2f, 0}, {8.0, 1.0f, 0}};
  {  // B1: the knob follows the lane
    const Lauf ref = spiele(1.0f, {}, 8.0);                                  // the steady note at the full knob
    const Lauf mit = spiele(0.5f, {{0, steigend}}, 8.0);                      // the snapshot knob 0.5 is ignored while the lane plays
    const Lauf flach = spiele(0.2f, {}, 8.0);                                 // negative control: no lane, knob 0.2
    const Lauf falsch = spiele(0.5f, {{1, steigend}}, 8.0);                   // negative control: a lane on k2, the graph uses k1
    PRUEF(mit.verloren == 0 && ref.verloren == 0);
    PRUEF(rms(ref.l, 4096, 8192) > 1e-3);
    double schlimmster = 0.0, flach_spanne = 0.0, falsch_abw = 0.0;
    for (double b : {1.0, 2.0, 4.0, 6.0}) {
      const double r = pegel(ref, b);
      const double soll = static_cast<double>(lane_wert(b));
      const double ist = pegel(mit, b) / r;
      schlimmster = std::max(schlimmster, std::fabs(ist - soll) / soll);
      flach_spanne = std::max(flach_spanne, std::fabs(pegel(flach, b) / r - 0.2) / 0.2);
      falsch_abw = std::max(falsch_abw, std::fabs(pegel(falsch, b) / r - 0.5) / 0.5);
    }
    std::printf("B1: worst deviation of the level from the lane %.3f, steady note %.3f from its knob, k2 lane %.3f from the k1 snapshot\n", schlimmster, flach_spanne, falsch_abw);
    PRUEF(schlimmster < 0.04);
    PRUEF(flach_spanne < 0.04);      // the measurement itself is exact for a steady knob
    PRUEF(falsch_abw < 0.04);        // the k2 lane did not touch k1
    PRUEF(pegel(mit, 1.0) < pegel(mit, 6.0) * 0.5);   // and the lane is audible: beat 1 (0.3) against beat 6 (0.8)
  }
  {  // B2: a start in the middle of the lane, the note starts at the start beat: the knob is at the lane value from the first sample (no glide up from the snapshot knob)
    const Lauf ref = spiele(1.0f, {}, 2.0, 4.0, 4.0);
    const Lauf mit = spiele(0.0f, {{0, steigend}}, 2.0, 4.0, 4.0);   // snapshot knob 0.0: a glide of 20 ms would put the first 1000 samples far below 0.6
    const double soll = static_cast<double>(lane_wert(4.0));
    const int64_t a = 537 + 256 + 200;   // the first 1000 samples after the note on (the 20 ms glide would still be running)
    const double ist = rms(mit.l, a, a + 1000) / rms(ref.l, a, a + 1000);
    std::printf("B2: level in the first 1000 samples %.3f of the full knob (lane %.3f)\n", ist, soll);
    PRUEF(std::fabs(ist - soll) / soll < 0.05);
  }
  {  // B3: a swap that drops the lane: the knob glides back to the snapshot value without a step
    Treiber t;
    Sinken sk(t.arr);
    CypherBk* h = bkt::neu(bkt::G_T);
    auto snap = [&](int64_t nr, bool lane) {
      Bau b(nr);
      b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 64.0, 45, 127);
      if (lane) b.lane(1, {{0.0, 1.0f, 0}, {64.0, 1.0f, 0}}, GER, 0);
      cdj::ArrSnapshot* s = b.fertig();
      bkt::spur(s, 1, h, 1, {{"k1", 0.25f}});
      return s;
    };
    t.laden(snap(1, true));
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(2 * SPB);
    const int64_t T = t.s;
    t.laden(snap(2, false));
    t.lauf(T + 2 * SPB);
    const std::vector<float> l = t.l;
    t.arr.setze_senke_intern(nullptr);
    cypher_bk_frei(h);
    const double vorher = rms(l, T - 8192, T - 4096), nachher = rms(l, T + 2 * SPB - 8192, T + 2 * SPB - 4096);
    std::printf("B3: level before the swap %.4f (lane 1.0), long after %.4f (snapshot knob 0.25): ratio %.3f\n", vorher, nachher, nachher / vorher);
    PRUEF(std::fabs(nachher / vorher - 0.25) < 0.02);
    // the saw's own steepest step at the full knob is the bound: the glide (20 ms) adds no step beyond 20 %
    const double eigen = max_schritt(l, T - 8192, T - 256);
    const double glide = max_schritt(l, T - 256, T + 6000);
    std::printf("B3: steepest sample step %.4f before the swap, %.4f across it\n", eigen, glide);
    PRUEF(eigen > 0.0 && glide <= eigen * 1.2);
  }
  {  // B4: a relative lane alone, and an absolute one with a relative one
    const Lauf ref = spiele(1.0f, {}, 8.0);
    const Punkte summand = {{0.0, -0.3f, 0}, {8.0, 0.5f, 0}};
    const Lauf nur_rel = spiele(0.5f, {{0, summand, true}}, 8.0);
    double schlimmster = 0.0;
    for (double b : {1.0, 3.0, 5.0, 7.0}) {
      const double s = std::clamp(0.5 + (-0.3 + 0.8 * b / 8.0), 0.0, 1.0);
      schlimmster = std::max(schlimmster, std::fabs(pegel(nur_rel, b) / pegel(ref, b) - s) / s);
    }
    std::printf("B4: relative lane alone, worst deviation from clamp(0.5 + summand) %.3f\n", schlimmster);
    PRUEF(schlimmster < 0.04);
    const Lauf beide = spiele(0.5f, {{0, {{0.0, 0.6f, 0}, {8.0, 0.6f, 0}}}, {0, {{0.0, 0.0f, 0}, {8.0, 0.8f, 0}}, true}}, 8.0);   // 0.6 + summand up to 0.8: clamped at 1.0
    double schlimmster2 = 0.0;
    for (double b : {1.0, 3.0, 5.0, 7.0}) {
      const double s = std::min(1.0, 0.6 + 0.8 * b / 8.0);
      schlimmster2 = std::max(schlimmster2, std::fabs(pegel(beide, b) / pegel(ref, b) - s) / s);
    }
    std::printf("B4: absolute + relative, worst deviation from min(1, sum) %.3f\n", schlimmster2);
    PRUEF(schlimmster2 < 0.04);
  }
  {  // B5: no allocation, lock or sleep in the callback with knob lanes (two lanes, a swap)
    Treiber t;
    Sinken sk(t.arr);
    CypherBk* h = bkt::neu(bkt::G_T);
    auto snap = [&](int64_t nr, float k1) {
      Bau b(nr);
      b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 64.0, 45, 127);
      b.lane(1, steigend, GER, 0).lane(1, {{0.0, 0.0f, 0}, {8.0, 1.0f, 0}}, GER, 1);
      cdj::ArrSnapshot* s = b.fertig();
      bkt::spur(s, 1, h, 1, {{"k1", k1}});
      return s;
    };
    cdj::ArrSnapshot* s1 = snap(2, 0.7f);
    t.laden(snap(1, 0.5f));
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(20000);
    float bf[6][cdj::ARR_BLOCK];
    int64_t smp = t.s;
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(2);   // the vector itself must not allocate inside the window
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 1000) alt.push_back(t.arr.tausche(s1, smp, t.k));
      for (auto& x : bf) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, smp, 256, bf[0], bf[1], bf[2], bf[3], bf[4], bf[5]);
      smp += 256;
    }
    const long im_fenster = abfang_aus();
    std::printf("B5: allocations in 2000 blocks = %ld\n", im_fenster);
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(im_fenster == 0);   // the watcher does not exist in a sanitizer build (-1)
    for (const cdj::ArrSnapshot* x : alt) delete x;
    t.arr.setze_senke_intern(nullptr);
    cypher_bk_frei(h);
    abfang_an();
    { std::vector<int> v(100); }
    const long positiv = abfang_aus();
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(positiv > 0);   // positive control: the watcher counts
  }
  PRUEF_ENDE();
}
