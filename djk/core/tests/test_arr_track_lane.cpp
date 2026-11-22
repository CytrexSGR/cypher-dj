// Loop lane strip K2..K4: the lane strip of an arrangement track: COLOR (spur/<n>/filter with the colour art, ColorFx), FX 1 and FX 2 (spur/<n>/fx/1, /2: beat FX instances of the launcher tracks)
// and FX 3 (spur/<n>/fx/3: the track's share goes into the fx/3 bus input instead of its DJ channel pair). The mixer half of FX 3 (the container fader) is test_mixer_fx3_lane.
// 128 BPM: 22 500 samples per beat, blocks of 256.
// Cases: 1 an idle lane is bit-equal: the colour art set with the knob in the dead zone, the beat FX units configured with the rows off, the fx/3 graph flag set with the row off (master, DJ pairs, fx/3 pairs)
//        2 COLOR: every art 1..5 with the knob away from centre changes the signal against the DjFilter, the arts differ from each other, and a switch back to FILTER at k = 0 is bit-equal to a run that never
//          had a colour art from that block on (the instance state is cleared, color_leer)
//        3 FX 1 and FX 2 (unit 0 and 1, a launcher track with a 2250-sample burst): assigned from the start the echo repeats are there; unit off is dry (bit-equal); closing the row in the silence after the
//          burst lets the repeats ring out (the tail is there, the dry run is silent); a track that is not a launcher track plays dry
//        4 FX 3 assign and release (track in a group on DJ channel 1, graph there): before the assignment the whole signal is in the DJ pair, the share moves over 480 samples (S-curve),
//          the sum of pair and fx/3 pair equals the unassigned signal all the time (insert, not copy), after the assignment the DJ pair is silent, after the release the fx/3 pair is silent and the pair is the
//          original again
//        5 FX 3 without a graph on fx/3: the row on, the flag off: the whole run is bit-equal to the unassigned one, the fx/3 pair stays zero (the track stays audible on its normal path)
// Mutations (CMakeLists.txt): ARR_COLOR_ART_STARR (2), ARR_FX_OHNE_SCHWANZ (3), ARR_FX3_OHNE_BLENDE (4), ARR_FX3_KOPIE (4).
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
using cdj::ArrZelle;
using cdj::ArrZellArt;
using cdj::LaunchGrund;

static constexpr int64_t V = 537;
static constexpr int64_t BLK = 256;
static constexpr int64_t CELL = 4 * SPB;
static const uint64_t ID = cdj::arr_id("s1");
#define TR(n) auto n##_p = std::make_unique<Treiber>(); Treiber& n = *n##_p;

static bool gleich(const std::vector<float>& a, const std::vector<float>& b, size_t von = 0) {
  return a.size() == b.size() && a.size() >= von && std::memcmp(a.data() + von, b.data() + von, (a.size() - von) * sizeof(float)) == 0;
}
static double spitze(const std::vector<float>& x, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(x[static_cast<size_t>(i)])));
  return m;
}
static double max_diff(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(a[static_cast<size_t>(i)] - b[static_cast<size_t>(i)])));
  return m;
}
static int reg(Treiber& t, const char* pfad) {
  const int r = t.tab.suche(pfad);
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad);
  PRUEF(r >= 0);
  return r;
}

// a plain track 1 (sine clip of 8 beats) into the master
static cdj::ArrSnapshot* snap_clip(const cdj::ArrAudio* a) {
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  return b.fertig();
}
// track 1 as a launcher track (kennung "s1", one looping cell); launcher = false: the same track without cells
static cdj::ArrSnapshot* snap_launcher(Audio& a, bool launcher = true) {
  Bau b(1);
  b.spur(1, ArrArt::audio);
  cdj::ArrSnapshot* s = b.fertig();
  if (!launcher) return s;
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
// track 1 into group 1, the group on DJ channel 1 (live)
static cdj::ArrSnapshot* snap_dj(const cdj::ArrAudio* a) {
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a).ausgang(1, 1);
  cdj::ArrSnapshot* s = b.fertig();
  s->live = true;
  s->gruppe_dj[0] = 1;
  return s;
}

static constexpr int KAN = 4;
struct Paare {   // the DJ pair 1 and the fx/3 pair 1 (what the kernel hands before every block)
  std::vector<float> l, r, fl, fr;
};
// like Treiber::lauf plus the pairs; hook(s) runs before every block
template <class F>
static void lauf3(Treiber& t, Paare& p, int64_t bis, F hook) {
  float b[6][cdj::ARR_BLOCK];
  float dl[KAN][cdj::ARR_BLOCK], dr[KAN][cdj::ARR_BLOCK], fl[KAN][cdj::ARR_BLOCK], fr[KAN][cdj::ARR_BLOCK];
  while (t.s < bis) {
    const int n = t.n;
    for (auto& x : b) std::fill(x, x + n, 0.0f);
    float* pl[KAN];
    float* pr[KAN];
    float* ql[KAN];
    float* qr[KAN];
    for (int c = 0; c < KAN; ++c) {
      std::fill(dl[c], dl[c] + n, 0.0f);
      std::fill(dr[c], dr[c] + n, 0.0f);
      std::fill(fl[c], fl[c] + n, 0.0f);
      std::fill(fr[c], fr[c] + n, 0.0f);
      pl[c] = dl[c];
      pr[c] = dr[c];
      ql[c] = fl[c];
      qr[c] = fr[c];
    }
    hook(t.s);
    t.arr.dj_ausgang(pl, pr);
    t.arr.dj_fx3_ausgang(ql, qr);
    t.arr.block(t.k, t.s, n, b[0], b[1], b[2], b[3], b[4], b[5]);
    t.l.insert(t.l.end(), b[0], b[0] + n);
    t.r.insert(t.r.end(), b[1], b[1] + n);
    p.l.insert(p.l.end(), dl[0], dl[0] + n);
    p.r.insert(p.r.end(), dr[0], dr[0] + n);
    p.fl.insert(p.fl.end(), fl[0], fl[0] + n);
    p.fr.insert(p.fr.end(), fr[0], fr[0] + n);
    t.s += n;
  }
}
static void nichts(int64_t) {}

// a cell of 4 beats that holds a 2250-sample burst of 440 Hz and then silence
static std::unique_ptr<Audio> stoss() {
  auto x = Audio::sinus(CELL, 440.0, 0.5f);
  for (int64_t f = 2250; f < CELL; ++f) x->d[static_cast<size_t>(2 * f)] = x->d[static_cast<size_t>(2 * f + 1)] = 0.0f;
  return x;
}
static int64_t einsatz(const std::vector<float>& x) {
  for (size_t i = 0; i < x.size(); ++i)
    if (std::fabs(x[i]) > 1e-4f) return static_cast<int64_t>(i);
  return -1;
}

int main() {
  const double BPS = 1.0 / static_cast<double>(SPB);   // beats per sample, as Mixer::fx_takt hands it
  const int64_t BIS = 8 * SPB;
  const auto s440 = Audio::sinus(16 * SPB, 440.0, 0.5f);

  // 1 an idle lane is bit-equal
  {
    TR(ref)
    Paare pr;
    ref.laden(snap_dj(&s440->a));
    ref.arr.start(0.0, 0, false, 0, V, 256, ref.k);
    lauf3(ref, pr, 100000, nichts);
    PRUEF(spitze(ref.l, 60000, 100000) + spitze(pr.l, 60000, 100000) > 0.1);   // the reference plays (on the master or in the pair)
    PRUEF(spitze(pr.l, 60000, 100000) > 0.1);                                  // in the DJ pair
    PRUEF(spitze(pr.fl, 0, 100000) == 0.0);                                    // no flag, no row: nothing in the fx/3 pair
    for (int art = 0; art <= 5; ++art) {   // the colour art set, the knob (the filter row) in the dead zone
      TR(t)
      Paare p;
      t.arr.setze_color(art, 0.5f, static_cast<double>(SPB));
      t.arr.fx_einheit_setze(0, cdj::BeatFx::ECHO, 0.25, 1.0f, 0.5f, true);   // unit settings that do nothing without a row
      t.arr.fx_einheit_setze(1, cdj::BeatFx::PHASER, 1.0, 1.0f, 0.5f, true);
      t.arr.setze_fx3_graph(true);                                           // a graph is there, but no track is assigned
      t.laden(snap_dj(&s440->a));
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      lauf3(t, p, 100000, nichts);
      PRUEF(gleich(ref.l, t.l) && gleich(ref.r, t.r) && gleich(pr.l, p.l) && gleich(pr.r, p.r));
      PRUEF(spitze(p.fl, 0, 100000) == 0.0);
      PRUEF(t.arr.color_leer(0));
    }
    {  // a launcher track with units configured and all rows off: bit-equal to the same track with no unit settings
      auto loop = Audio::sinus(CELL, 440.0, 0.5f);
      TR(a)
      TR(b)
      a.laden(snap_launcher(*loop));
      b.laden(snap_launcher(*loop));
      b.arr.fx_einheit_setze(0, cdj::BeatFx::ECHO, 0.25, 1.0f, 0.5f, true);
      b.arr.fx_einheit_setze(1, cdj::BeatFx::PHASER, 1.0, 1.0f, 0.5f, true);
      b.arr.fx_takt(0.0, BPS);
      PRUEF(a.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
      PRUEF(b.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
      a.lauf(BIS);
      b.lauf(BIS);
      PRUEF(spitze(a.l, 3 * SPB, BIS) > 0.1);
      PRUEF(gleich(a.l, b.l) && gleich(a.r, b.r));
      PRUEF(b.arr.fx_slot(0) >= 0);
    }
  }

  // 2 COLOR
  {
    TR(ref)
    ref.arr.setze_sofort(reg(ref, "spur/1/filter"), 0.8f);   // the DjFilter (art FILTER) at 0.8
    ref.laden(snap_clip(&s440->a));
    ref.arr.start(0.0, 0, false, 0, V, 256, ref.k);
    ref.lauf(100000);
    std::vector<float> aus[6];
    aus[0] = ref.l;
    for (int art = 1; art <= 5; ++art) {
      TR(t)
      t.arr.setze_sofort(reg(t, "spur/1/filter"), 0.8f);
      t.arr.setze_color(art, 0.5f, static_cast<double>(SPB));
      t.laden(snap_clip(&s440->a));
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(100000);
      aus[art] = t.l;
      const double d = max_diff(t.l, ref.l, 50000, 100000);
      std::printf("2: art %d at 0.8: largest difference to the DjFilter %.4f\n", art, d);
      PRUEF(d > 1e-3);   // a colour art is not the DjFilter
    }
    for (int a = 1; a <= 5; ++a)
      for (int b = a + 1; b <= 5; ++b) PRUEF(max_diff(aus[a], aus[b], 50000, 100000) > 1e-4);   // the arts differ from each other
    // the switch back: art 2 (DUB ECHO) until block S, then art FILTER with the knob at 0: bit-equal to a run that never had a colour art
    const int64_t S = 200 * BLK;
    TR(neutral)
    neutral.laden(snap_clip(&s440->a));
    neutral.arr.start(0.0, 0, false, 0, V, 256, neutral.k);
    neutral.lauf(100000);
    TR(t)
    const int r = reg(t, "spur/1/filter");
    t.arr.setze_sofort(r, 0.8f);
    t.arr.setze_color(2, 0.5f, static_cast<double>(SPB));
    t.laden(snap_clip(&s440->a));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.vor_block = [&](int64_t s) {
      if (s == S) {
        t.arr.setze_color(0, 0.5f, static_cast<double>(SPB));
        t.arr.setze_sofort(r, 0.0f);
      }
    };
    t.lauf(100000);
    PRUEF(S + 2 * BLK < 100000);
    PRUEF(max_diff(t.l, neutral.l, 40000, S) > 1e-3);   // before the switch the colour is on
    PRUEF(gleich(t.l, neutral.l, static_cast<size_t>(S)));
    PRUEF(t.arr.color_leer(0));
    PRUEF(t.arr.color_art() == 0);
  }

  // 3 FX 1 and FX 2
  {
    auto st = stoss();
    TR(ref)
    ref.laden(snap_launcher(*st));
    PRUEF(ref.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
    ref.lauf(BIS);
    const int64_t s0 = einsatz(ref.l);
    PRUEF(s0 > 0);
    const int64_t ende = s0 + 2250;                               // the dry burst is over here
    const int64_t S = ((ende + 1000) / BLK + 1) * BLK;            // a block start in the silence after the burst, before the first echo repeat (5625 after the onset)
    PRUEF(S < s0 + 5625);
    PRUEF(spitze(ref.l, ende + 600, s0 + 80000) < 1e-6);                 // the dry run is silent after the burst (and its fade)
    const char* zeile[2] = {"spur/1/fx/1", "spur/1/fx/2"};
    for (int u = 0; u < 2; ++u) {
      auto einheit = [&](Treiber& t, bool an) {
        t.arr.fx_einheit_setze(u, cdj::BeatFx::ECHO, 0.25, 1.0f, 0.5f, an);
        t.arr.fx_einheit_setze(1 - u, cdj::BeatFx::AUS, 1.0, 0.0f, 0.5f, false);
        t.arr.fx_takt(0.0, BPS);
      };
      TR(offen)   // the row open from the start: the repeats are there
      einheit(offen, true);
      offen.arr.setze_sofort(reg(offen, zeile[u]), 1.0f);
      offen.laden(snap_launcher(*st));
      PRUEF(offen.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
      offen.lauf(BIS);
      const double wiederholung = spitze(offen.l, s0 + 5625 + 200, s0 + 5625 + 2000);
      std::printf("3: unit %d open: peak in the first repeat %.4f (dry run %.2g)\n", u + 1, wiederholung, spitze(ref.l, s0 + 5625 + 200, s0 + 5625 + 2000));
      PRUEF(wiederholung > 0.01);
      PRUEF(offen.arr.fx_slot(0) >= 0);

      TR(aus)   // the unit off: dry, bit-equal
      einheit(aus, false);
      aus.arr.setze_sofort(reg(aus, zeile[u]), 1.0f);
      aus.laden(snap_launcher(*st));
      PRUEF(aus.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
      aus.lauf(BIS);
      PRUEF(gleich(ref.l, aus.l) && gleich(ref.r, aus.r));

      TR(zu)   // the row closed in the silence after the burst: the tail rings out
      einheit(zu, true);
      const int r = reg(zu, zeile[u]);
      zu.arr.setze_sofort(r, 1.0f);
      zu.laden(snap_launcher(*st));
      PRUEF(zu.arr.launch_start(ID, 1, 1.0, 0.0, 1, false) == LaunchGrund::ok);
      zu.vor_block = [&](int64_t s) {
        if (s == S) zu.arr.setze_sofort(r, 0.0f);
      };
      zu.lauf(BIS);
      const double schwanz = spitze(zu.l, S + 2 * BLK, S + 2 * BLK + 8000);
      const double spaet = spitze(zu.l, s0 + 12 * 5625, s0 + 80000);
      std::printf("3: unit %d closed at %lld: tail peak %.4f, late %.4f\n", u + 1, static_cast<long long>(S), schwanz, spaet);
      PRUEF(schwanz > 0.01);            // the repeats still come after the row closed
      PRUEF(spaet < schwanz * 0.5);     // and they die out
      PRUEF(gleich(zu.l, offen.l) || max_diff(zu.l, offen.l, 0, S) == 0.0);   // the same up to the close
    }
    {  // a track that is not a launcher track has no instance: the switch plays dry
      TR(t)
      t.arr.fx_einheit_setze(0, cdj::BeatFx::ECHO, 0.25, 1.0f, 0.5f, true);
      t.arr.fx_takt(0.0, BPS);
      t.arr.setze_sofort(reg(t, "spur/1/fx/1"), 1.0f);
      TR(r2)
      t.laden(snap_clip(&s440->a));
      r2.laden(snap_clip(&s440->a));
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      r2.arr.start(0.0, 0, false, 0, V, 256, r2.k);
      t.lauf(100000);
      r2.lauf(100000);
      PRUEF(t.arr.fx_slot(0) < 0);
      PRUEF(gleich(t.l, r2.l) && gleich(t.r, r2.r));
    }
  }

  // 4 FX 3 assign and release
  {
    const int64_t A = 150 * BLK, L = 300 * BLK, E = 400 * BLK;   // assign at A, release at L (block starts), end at E
    TR(ref)
    Paare pr;
    ref.laden(snap_dj(&s440->a));
    ref.arr.start(0.0, 0, false, 0, V, 256, ref.k);
    lauf3(ref, pr, E, nichts);
    PRUEF(spitze(pr.l, 20000, 30000) > 0.1);

    TR(t)
    Paare p;
    const int r = reg(t, "spur/1/fx/3");
    t.arr.setze_fx3_graph(true);
    t.laden(snap_dj(&s440->a));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    lauf3(t, p, E, [&](int64_t s) {
      if (s == A) t.arr.setze_sofort(r, 1.0f);
      if (s == L) t.arr.setze_sofort(r, 0.0f);
    });
    PRUEF(gleich(pr.l, p.l) == false);
    PRUEF(max_diff(pr.l, p.l, 0, A) == 0.0 && max_diff(pr.r, p.r, 0, A) == 0.0);   // before the assignment: all in the pair
    PRUEF(spitze(p.fl, 0, A) == 0.0 && spitze(p.fr, 0, A) == 0.0);
    // conservation: pair plus fx/3 pair is the unassigned signal at every sample (an insert, not a copy)
    double cons = 0.0;
    for (int64_t i = 0; i < E; ++i)
      cons = std::max(cons, static_cast<double>(std::fabs(p.l[static_cast<size_t>(i)] + p.fl[static_cast<size_t>(i)] - pr.l[static_cast<size_t>(i)])));
    std::printf("4: largest deviation of pair + fx/3 pair from the unassigned pair %.3g\n", cons);
    PRUEF(cons < 1e-5);
    // the blend: the share starts at 0, an S-curve over 480 samples, full after
    const auto anteil = [&](int64_t i) {
      const double g = std::fabs(pr.l[static_cast<size_t>(i)]);
      return g > 0.05 ? p.fl[static_cast<size_t>(i)] / pr.l[static_cast<size_t>(i)] : -1.0;
    };
    double zuletzt = 0.0;
    int geprueft = 0;
    bool steigt = true;
    for (int64_t i = A; i < A + 480; ++i) {
      const double a = anteil(i);
      if (a < 0.0) continue;
      ++geprueft;
      if (a < zuletzt - 1e-3 || a > 1.0 + 1e-3) steigt = false;   // the sine changes sign, the ratio is the weight itself
      zuletzt = a;
    }
    std::printf("4: %d samples of the blend checked, share at the start %.3f, near the end %.3f\n", geprueft, anteil(A + 8), anteil(A + 470));
    PRUEF(geprueft > 100);
    PRUEF(steigt);
    PRUEF(anteil(A + 8) < 0.1 || anteil(A + 8) < 0.0);                   // not a jump
    PRUEF(spitze(p.fl, A, A + 100) < 0.2 * spitze(pr.l, A, A + 100) + 1e-6);   // the first 100 samples carry only a small part
    PRUEF(max_diff(p.fl, pr.l, A + 480 + 8, L) < 1e-5);                   // assigned: the whole signal is in the fx/3 pair
    PRUEF(spitze(p.l, A + 480 + 8, L) < 1e-6);                            // and the DJ pair is silent
    PRUEF(spitze(p.fl, L + 480 + 8, E) == 0.0 && spitze(p.fr, L + 480 + 8, E) == 0.0);   // released: the fx/3 pair is silent
    PRUEF(max_diff(p.l, pr.l, L + 480 + 8, E) < 1e-6);                    // and the pair is the original again
  }

  // 5 FX 3 without a graph stays audible
  {
    const int64_t E = 300 * BLK;
    TR(ref)
    Paare pr;
    ref.laden(snap_dj(&s440->a));
    ref.arr.start(0.0, 0, false, 0, V, 256, ref.k);
    lauf3(ref, pr, E, nichts);
    TR(t)
    Paare p;
    const int r = reg(t, "spur/1/fx/3");
    t.arr.setze_fx3_graph(false);   // no graph on fx/3
    t.arr.setze_sofort(r, 1.0f);
    t.laden(snap_dj(&s440->a));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    lauf3(t, p, E, nichts);
    PRUEF(spitze(p.l, 60000, E) > 0.1);   // audible
    PRUEF(gleich(pr.l, p.l) && gleich(pr.r, p.r) && gleich(ref.l, t.l) && gleich(ref.r, t.r));
    PRUEF(spitze(p.fl, 0, E) == 0.0 && spitze(p.fr, 0, E) == 0.0);
  }
  PRUEF_ENDE();
}
