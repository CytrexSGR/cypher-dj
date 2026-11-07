// AK33 review finding F4 (stream 1.13-AK33-fix, unit G1): a clip gain edit on a SOUNDING BEATS or RE-PITCH clip must ramp the gain, not swap voices.
//
// Defect (before the fix): Arrangement::stimmen_tauschen bound a voice in place for an unchanged clip (gleich) and, for a gain-only edit, only for voices of the warp
// engine (v.werk >= 0). A RE-PITCH / BEATS / plain voice (v.werk < 0) fell through to the else branch: stimme_ausklang (old gain, linear fade-out over ARR_NAHT = 96
// samples) plus a new voice from stimmen_einstieg (new gain, fade-in over ARR_EIN = 32 samples). The two fades are not complementary: the sum of the gains peaks at
// 1.67 around 32 samples after the edit, an audible click at every edit (13 of 14 edits of the repro ak33_wiedergabe.mjs --reload gain, 12 to 26 dB below block level).
//
// Method: a steady tone (so a gain error is not hidden in a transient). Run A: no edit (reference). Run B: at a block start the gain changes g0 -> g1.
// The ratio B/A at every sample with |A| above a floor is the applied gain curve. It must (1) stay inside [min(g0,g1), max(g0,g1)] (no overshoot),
// (2) move at most (g1 - g0) / ARR_NAHT * 1.5 per sample (a ramp, not a step), (3) arrive at g1 and stay there. The edit is made small (0.01 dB, the repro) and large (-6 dB).
// Cases: 1 RE-PITCH · 2 BEATS · 3 plain (no warp) · 4 COMPLEX (control, warp engine, unchanged path; skipped without Bungee) ·
//        5 edit on a clip that does not sound: no effect on the sounding clip, the new gain applies when it starts (control).
// Mutation: CYPHERDJ_MUTATION_ARR_GAIN_TAUSCH_NEU (the gain-only edit takes the old voice swap again) must turn cases 1 to 3 red; case 4 stays green.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;            // start offset (same as the other warp tests)
static constexpr int64_t QUELLE = 4 * SPB;   // 90 000 frames: 4 beats at 128 BPM
static constexpr int EDIT_BEAT_BLOECKE = 70; // the edit happens at the start of block 70 (sample 17 920)

namespace {

enum class Modus { repitch, beats, plain, complex_ };

struct Lauf {
  Treiber t;
  std::unique_ptr<Audio> q;
  int64_t s_edit = 0;
};

const char* name(Modus m) {
  switch (m) {
    case Modus::repitch: return "RE-PITCH";
    case Modus::beats: return "BEATS";
    case Modus::plain: return "plain";
    default: return "COMPLEX";
  }
}

// One clip (c1, beats 0..4) of the given mode, optionally a second clip c2 at beats 6..8 that has not started when the edit happens.
cdj::ArrSnapshot* bauen(Audio* a, Modus m, float gain1, float gain2, bool zweiter, int64_t nr) {
  Bau b(nr);
  b.spur(1, ArrArt::audio);
  const auto clip = [&](const char* id, double start, float g) {
    b.clip(1, id, start, 4.0, &a->a, 0, g);
    if (m == Modus::repitch) b.warp({0.0, 4.0}, {0.0, static_cast<double>(QUELLE)}, cdj::ARR_WARP_REPITCH);
    if (m == Modus::complex_) b.warp({0.0, 4.0}, {0.0, static_cast<double>(QUELLE)}, cdj::ARR_WARP_COMPLEX);
    if (m == Modus::beats) {
      std::vector<double> eb, ef;
      for (int k = 0; k < 16; ++k) {
        eb.push_back(k * 0.25);
        ef.push_back(static_cast<double>(k * (QUELLE / 16)));
      }
      b.warp({0.0, 4.0}, {0.0, static_cast<double>(QUELLE)}, cdj::ARR_WARP_BEATS).beats(eb, ef, 0, 100);
    }
  };
  clip("c1", 0.0, gain1);
  if (zweiter) clip("c2", 6.0, gain2);
  return b.fertig();
}

// edit: gain of c1 (or c2 when edit_zweiter) changes from g0 to g1 at the block start EDIT_BEAT_BLOECKE; a run without edit uses g0 throughout
std::unique_ptr<Lauf> fahre(Modus m, float g0, float g1, bool edit, bool zweiter = false, bool edit_zweiter = false, int64_t bis_beats = 5) {
  auto l = std::make_unique<Lauf>();
  l->q.reset(new Audio());
  *l->q = *Audio::sinus(QUELLE + 2000, 1002.6, 0.5f);
  l->q->fuellen(QUELLE + 2000);
  if (m == Modus::complex_) {
    if (!l->t.mit_werk()) return nullptr;
  }
  const float c1 = edit_zweiter ? 1.0f : g0;
  const float c2 = edit_zweiter ? g0 : 1.0f;
  l->t.laden(bauen(l->q.get(), m, c1, c2, zweiter, 1));
  l->t.arr.start(0.0, 0, false, 0, V, 256, l->t.k);
  l->t.lauf(static_cast<int64_t>(EDIT_BEAT_BLOECKE) * 256);
  l->s_edit = l->t.s;
  if (edit) l->t.laden(bauen(l->q.get(), m, edit_zweiter ? 1.0f : g1, edit_zweiter ? g1 : 1.0f, zweiter, 2));
  l->t.lauf(bis_beats * SPB);
  return l;
}

struct Verlauf {
  double ueber = 0.0;      // largest excursion of the ratio outside [lo, hi]
  double schritt = 0.0;    // largest change of the ratio between two samples that both qualify
  double ende_fehler = 0.0;  // |ratio - g1| for the last samples of the window
  int n = 0;               // qualifying samples
};

// ratio B/A in [s_edit - 50, s_edit + 800) over samples with |A| > 0.1 (the tone peaks at about 0.35 after the pan law)
Verlauf messe(const Lauf& a, const Lauf& b, float g0, float g1) {
  Verlauf v;
  const double lo = std::min(g0, g1), hi = std::max(g0, g1);
  double letzte = -1.0;
  int64_t letzte_i = -10;
  for (int64_t i = a.s_edit - 50; i < a.s_edit + 800; ++i) {
    const double x = a.t.l[i], y = b.t.l[i];
    if (std::fabs(x) < 0.1) continue;
    const double r = y / x;
    ++v.n;
    v.ueber = std::max(v.ueber, std::max(lo - r, r - hi));
    if (i - letzte_i <= 40 && letzte >= 0.0) v.schritt = std::max(v.schritt, std::fabs(r - letzte) / static_cast<double>(i - letzte_i));
    letzte = r;
    letzte_i = i;
    if (i >= a.s_edit + 400) v.ende_fehler = std::max(v.ende_fehler, std::fabs(r - g1));
  }
  return v;
}

void rampe_fall(Modus m, float g0, float g1) {
  auto a = fahre(m, g0, g1, false);
  auto b = fahre(m, g0, g1, true);
  if (!a || !b) {
    std::printf("SKIP %s: no warp engine in this build\n", name(m));
    return;
  }
  // run A carries g0, so the ratio B/A is the applied gain relative to g0: it runs from 1 to g1/g0
  const double rel1 = static_cast<double>(g1) / static_cast<double>(g0);
  const Verlauf v = messe(*a, *b, 1.0f, static_cast<float>(rel1));
  const double dg = std::fabs(rel1 - 1.0);
  std::printf("MESS %s %.4f -> %.4f: samples %d, overshoot %.5f, largest step %.6f/sample (ramp limit %.6f), end error %.6f\n", name(m), g0, g1, v.n, v.ueber,
              v.schritt, dg / cdj::ARR_NAHT * 1.5, v.ende_fehler);
  PRUEF(v.n > 100);                                       // the window sounds (positive control: the tone is there)
  PRUEF(v.ueber < 1e-3 + 0.01 * dg);                      // no overshoot beyond the two gains
  PRUEF(v.schritt <= dg / cdj::ARR_NAHT * 1.5 + 1e-6);    // a ramp over ARR_NAHT, not a step
  PRUEF(v.ende_fehler < 2e-3);                            // arrives at the new gain
}

// edit of a clip that does not sound yet (c2 at beats 6..8): the sounding clip c1 is bit-identical, c2 later plays with the new gain
void ruhender_clip() {
  const Modus modi[] = {Modus::repitch, Modus::beats};
  for (Modus m : modi) {
    const float g1 = 0.5f;
    auto a = fahre(m, 1.0f, g1, false, true, true, 8);
    auto b = fahre(m, 1.0f, g1, true, true, true, 8);
    double diff = 0.0;
    for (int64_t i = a->s_edit - 50; i < 4 * SPB; ++i) diff = std::max(diff, std::fabs(static_cast<double>(a->t.l[i]) - static_cast<double>(b->t.l[i])));
    // c2 sounds from 6 beats: the level ratio over a late window is the new gain
    double sa = 0, sb = 0;
    for (int64_t i = 6 * SPB + 3000; i < 6 * SPB + 15000; ++i) {
      sa += static_cast<double>(a->t.l[i]) * a->t.l[i];
      sb += static_cast<double>(b->t.l[i]) * b->t.l[i];
    }
    const double pegel = sa > 0 ? std::sqrt(sb / sa) : -1.0;
    std::printf("MESS %s non-sounding clip: change of the sounding clip %.9f, level of c2 later %.4f (new gain %.2f)\n", name(m), diff, pegel, g1);
    PRUEF(diff == 0.0);
    PRUEF(sa > 1.0);
    PRUEF(std::fabs(pegel - g1) < 0.01);
  }
}

}  // namespace

int main() {
  const Modus modi[] = {Modus::repitch, Modus::beats, Modus::plain, Modus::complex_};
  for (Modus m : modi) {
    rampe_fall(m, 1.0f, 1.00116f);   // +0.01 dB, the repro of the review
    rampe_fall(m, 1.0f, 0.5f);       // -6 dB
    rampe_fall(m, 0.5f, 1.0f);       // up
  }
  ruhender_clip();
  PRUEF_ENDE();
}
