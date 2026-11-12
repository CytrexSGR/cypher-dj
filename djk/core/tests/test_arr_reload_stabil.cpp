// Live modules: a playback reload that changes only module B must leave module A bit-identical (found on test instance e, 2026-11-12:
// 22 to 54 ms of different samples in A when the stems of B arrive and when B is removed; INTERFACES 4.11 /k/arr/laden).
//
// Setup (the tree of live.ts baueModul, as the loader gets it): module A = top group 1 <- stem groups 2..5 <- one track each (2..5, a COMPLEX warp,
// the drums RE-PITCH), plus the Loop track 1 into group 1 (COMPLEX). Every clip is a loop of 32 beats, two copies (ids "<clip>~0", "<clip>~1") over
// the 64-beat region, the loop bracket 0..64 is on, 128 BPM, source tempo 125 BPM (the stretch is real). Module B is the same tree on tracks 6..10 and
// groups 6..10. The warp engine runs synchronously (deterministic, like the render).
//
// Method: run R plays A alone for the whole time (nothing is ever reloaded). Run X starts with the same A (or with A plus B) and swaps in a new
// snapshot (a new `nr`, every pointer new, the audio pointers the same: the audio cache shares them by sha256) at a block start; the new snapshot
// carries A unchanged and a B that appears, grows or goes. A is unchanged, so X - R must be zero at every sample. B's audio is exact zeros (the
// "silent" variants: B contributes exactly nothing) or audible behind a closed module fader of -200 dB (the "closed" variants, 1e-6 bound).
//   1  B appears:      A, then A + B (loop track and stems)
//   2  B grows:        A + B (loop only), then A + B (loop and stems)  [the stems arrive]
//   3  B goes:         A + B, then A alone  [leeren]
//   4  one stem track of B goes (its group stays)
//   5  B changes at every third block for 60 blocks (appears, grows, goes, ...), across the seam of the copies: A never moves
// Each case runs at several swap positions. Result per case: first and last differing sample, count, peak and RMS of the difference against RMS of A.
//
// Cause (measured here, before the fix: cases 1 and 2 with audible B: 478 samples = ARR_ZIEL_BLENDE of differing output at the swap, peak 0.02 to 0.1): a track that arrives took
// its target by a blend from the master (Arrangement::ziele_pruefen), so for 10 ms the new sound of B went into the master and not into the closed module group. A itself was
// bit-identical in every case (the silent variants). Case 3 and 4 with audible B keep a known remainder, see KNOWN below.
// KNOWN (open, decision needed, see the report 2026-11-12 reload): the 96-sample tail of a track that goes (ARR_NAHT, its own copy) runs through its stem group, and a group nobody
// feeds any more takes the target of the snapshot (the master) because the order of the group passes comes from the snapshot: the tail passes the closed module fader. It is pinned
// here as a bound (ends within ARR_NAHT of the swap block), not as zero.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "cypherdj/warp_factory.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int64_t FPB125 = 23040;          // frames per beat of the 125 BPM source
constexpr int64_t LOOP_BEATS = 32;         // one copy
constexpr int64_t LOOP_FRAMES = LOOP_BEATS * FPB125;
constexpr int N_STEM = 4;                  // drums, bass, other, vocals

struct Quellen {                           // one source per track of a module (loop + 4 stems), owned for the whole test: the audio pointers never change
  std::unique_ptr<Audio> a[2][1 + N_STEM];
  Quellen() {
    const double hz[2][1 + N_STEM] = {{110.0, 150.0, 220.0, 330.0, 440.0}, {131.0, 170.0, 260.0, 390.0, 520.0}};
    for (int m = 0; m < 2; ++m)
      for (int i = 0; i < 1 + N_STEM; ++i) {
        a[m][i] = Audio::sinus(LOOP_FRAMES, hz[m][i], 0.15f);
        // a little noise-like modulation so that a shifted copy does not look like the original (a pure sine is periodic in itself)
        for (int64_t f = 0; f < LOOP_FRAMES; ++f) {
          const float g = 0.6f + 0.4f * static_cast<float>(std::sin(2.0 * 3.14159265358979 * 3.0 * static_cast<double>(f) / static_cast<double>(LOOP_FRAMES) + i));
          a[m][i]->d[static_cast<size_t>(2 * f)] *= g;
          a[m][i]->d[static_cast<size_t>(2 * f + 1)] *= g;
        }
        a[m][i]->fuellen(LOOP_FRAMES);
      }
  }
};

enum class BTeil { keiner, nur_loop, ohne_stimme, voll };   // what module B holds in a snapshot

// the module `m` (0 = A on tracks 1..5 and groups 1..5, 1 = B on tracks 6..10 and groups 6..10) into b. loop track = tracks[0], stems = tracks[1..4]
void modul(Bau& b, Quellen& q, int m, BTeil teil, bool stumm_quelle) {
  const int t0 = m * 5 + 1;   // loop track number; the stems follow
  const int g0 = t0;          // top group number (= loop track number, like the real numbering)
  const int n = teil == BTeil::voll ? 1 + N_STEM : teil == BTeil::ohne_stimme ? N_STEM : 1;   // ohne_stimme: the last stem track (vocals) is gone, its group stays
  for (int i = 0; i < n; ++i) {
    const int nr = t0 + i;
    const std::string id = std::string(m ? "B" : "A") + "-clip-" + std::to_string(i);
    b.spur(nr, ArrArt::audio).ausgang(nr, i == 0 ? g0 : g0 + i);   // the loop track plays into the top group, every stem track into its own stem group
    Audio* au = q.a[m][i].get();
    if (stumm_quelle) std::fill(au->d.begin(), au->d.end(), 0.0f);
    for (int k = 0; k < 2; ++k) {
      const std::string cid = id + "~" + std::to_string(k);
      b.clip(nr, cid.c_str(), static_cast<double>(k * LOOP_BEATS), static_cast<double>(LOOP_BEATS), &au->a, 0, 1.0f);
      b.warp({0.0, static_cast<double>(LOOP_BEATS)}, {0.0, static_cast<double>(LOOP_FRAMES)}, i == 1 ? cdj::ARR_WARP_REPITCH : cdj::ARR_WARP_COMPLEX);
    }
  }
  for (int i = 1; i < 1 + (teil == BTeil::voll || teil == BTeil::ohne_stimme ? N_STEM : 0); ++i) b.gruppe_ausgang(g0 + i, g0);   // stem group -> top group (the vocals group stays without its track)
  b.gruppe_ausgang(g0, 0);                                                                         // top group -> master
}

struct Welt {
  Quellen q;
  bool stumm_b;   // B's audio is exact zeros
};

cdj::ArrSnapshot* bauen(Welt& w, bool a_da, BTeil b_teil, int64_t nr) {
  Bau b(nr);
  if (a_da) modul(b, w.q, 0, BTeil::voll, false);
  if (b_teil != BTeil::keiner) modul(b, w.q, 1, b_teil, w.stumm_b);
  return b.fertig();
}

struct Ergebnis {
  int64_t erste = -1, letzte = -1, n = 0;
  double spitze = 0.0, rms_diff = 0.0, rms_a = 0.0;
};

Ergebnis vergleiche(const std::vector<float>& ref, const std::vector<float>& x, double schwelle) {
  Ergebnis e;
  const size_t n = std::min(ref.size(), x.size());
  double sd = 0.0, sa = 0.0;
  for (size_t i = 0; i < n; ++i) {
    const double d = std::fabs(static_cast<double>(x[i]) - static_cast<double>(ref[i]));
    sa += static_cast<double>(ref[i]) * static_cast<double>(ref[i]);
    if (d > schwelle) {
      if (e.erste < 0) e.erste = static_cast<int64_t>(i);
      e.letzte = static_cast<int64_t>(i);
      ++e.n;
      sd += d * d;
      e.spitze = std::max(e.spitze, d);
    }
  }
  e.rms_diff = e.n ? std::sqrt(sd / static_cast<double>(e.n)) : 0.0;
  e.rms_a = n ? std::sqrt(sa / static_cast<double>(n)) : 0.0;
  return e;
}

// One run: the snapshot list is (sample, A there, B part); the first entry loads before the start, every later one at its block start.
struct Schritt { int64_t s; bool a; BTeil b; };

std::unique_ptr<Treiber> fahre(Welt& w, const std::vector<Schritt>& plan, int64_t bis, bool b_geschlossen) {
  auto t = std::make_unique<Treiber>();
  if (!t->mit_werk()) return nullptr;
  if (b_geschlossen) {
    const int r = t->tab.suche("grp/6/fader");
    PRUEF(r >= 0);
    if (r >= 0) t->arr.setze_sofort(r, -200.0f);
  }
  int64_t nr = 1;
  t->laden(bauen(w, plan[0].a, plan[0].b, nr++));
  t->arr.loop(true, 0.0, 64.0, 0, t->k);
  t->arr.start(0.0, 0, false, 0, 537, 256, t->k);
  for (size_t i = 1; i < plan.size(); ++i) {
    t->lauf(plan[i].s);
    t->laden(bauen(w, plan[i].a, plan[i].b, nr++));
  }
  t->lauf(bis);
  return t;
}

const char* teil_name(BTeil b) { return b == BTeil::keiner ? "-" : b == BTeil::nur_loop ? "loop" : b == BTeil::ohne_stimme ? "o.voc" : "voll"; }

struct Fall { Ergebnis l, r; };

// r: run R (A alone, never reloaded), the same for every case of a variant (B's audio does not touch it), so it is run once
Fall fall(Welt& w, const Treiber* r, const char* name, const std::vector<Schritt>& plan, bool b_geschlossen, int64_t bis, double schwelle) {
  auto x = fahre(w, plan, bis, b_geschlossen);
  if (!r || !x) {
    std::printf("SKIP %s: no warp engine in this build\n", name);
    return {};
  }
  Fall f{vergleiche(r->l, x->l, schwelle), vergleiche(r->r, x->r, schwelle)};
  std::string folge;
  for (const Schritt& s : plan) folge += std::string(folge.empty() ? "" : " > ") + (s.a ? "A" : "-") + "+" + teil_name(s.b) + "@" + std::to_string(s.s);
  std::printf("MESS %-30s %-52s L: %6lld samples [%lld..%lld] peak %.2e rms %.2e (A rms %.3f)   R: %lld\n", name, folge.c_str(), static_cast<long long>(f.l.n),
              static_cast<long long>(f.l.erste), static_cast<long long>(f.l.letzte), f.l.spitze, f.l.rms_diff, f.l.rms_a, static_cast<long long>(f.r.n));
  PRUEF(f.l.rms_a > 0.01);   // the positive control: A sounds
  return f;
}

// INFO (no check): the server sends the reset rows of a freed group BEFORE /k/arr/laden (reglerAenderungen in commands.ts: grp/<nr>/fader to 0 dB for a removed group;
// vollziehe in session.ts awaits them, then writes and loads the playback). The core did exactly what it was told: the closed module group of B opens while B still plays.
// `vor` samples before the swap that removes B, grp/6/fader goes from -200 to 0 dB. Measures how much of B reaches the master until the swap (A alone is the reference).
void info_reset_vor_laden(Welt& w, const Treiber* r, int64_t p, int64_t vor, int64_t bis) {
  auto t = std::make_unique<Treiber>();
  if (!t->mit_werk() || !r) return;
  const int g6 = t->tab.suche("grp/6/fader");
  PRUEF(g6 >= 0);
  t->arr.setze_sofort(g6, -200.0f);
  int64_t nr = 1;
  t->laden(bauen(w, true, BTeil::voll, nr++));
  t->arr.loop(true, 0.0, 64.0, 0, t->k);
  t->arr.start(0.0, 0, false, 0, 537, 256, t->k);
  t->lauf(p - vor);
  t->arr.setze_sofort(g6, 0.0f);   // the server's reset row (the real row glides; this is the upper bound)
  t->lauf(p);
  t->laden(bauen(w, true, BTeil::keiner, nr++));
  t->lauf(bis);
  const Ergebnis e = vergleiche(r->l, t->l, 1e-6);
  std::printf("INFO reset row %5lld samples before the swap: B leaks %lld samples [%lld..%lld] into the master, peak %.3f (A rms %.3f)\n", static_cast<long long>(vor),
              static_cast<long long>(e.n), static_cast<long long>(e.erste), static_cast<long long>(e.letzte), e.spitze, e.rms_a);
}

}  // namespace

int main() {
  const int64_t BIS = 40 * SPB;   // 40 beats: through the seam of the copies (beat 32)
  // swap positions (block starts): early, in the middle, shortly before the copy seam, after it
  const int64_t P[] = {6 * SPB + 1280, 15 * SPB + 5120, 31 * SPB + 4608, 33 * SPB + 768};
  for (int variante = 0; variante < 2; ++variante) {   // 0: B is exact silence (bound 0), 1: B is audible behind a closed module fader of -200 dB (bound 1e-6)
    auto w = std::make_unique<Welt>(Welt{Quellen(), variante == 0});
    const double schwelle = variante == 0 ? 0.0 : 1e-6;
    const bool zu = variante == 1;
    std::printf("== B %s\n", variante == 0 ? "silent" : "audible, module fader -200 dB");
    const std::unique_ptr<Treiber> r = fahre(*w, {{0, true, BTeil::keiner}}, BIS, false);
    for (int64_t p : P) {
      const Fall f1 = fall(*w, r.get(), "1 B appears (loop + stems)", {{0, true, BTeil::keiner}, {p, true, BTeil::voll}}, zu, BIS, schwelle);
      PRUEF(f1.l.n == 0 && f1.r.n == 0);
      const Fall f2 = fall(*w, r.get(), "2 B grows (loop -> stems)", {{0, true, BTeil::nur_loop}, {p, true, BTeil::voll}}, zu, BIS, schwelle);
      PRUEF(f2.l.n == 0 && f2.r.n == 0);
      const Fall f3 = fall(*w, r.get(), "3 B goes (leeren)", {{0, true, BTeil::voll}, {p, true, BTeil::keiner}}, zu, BIS, schwelle);
      if (!zu) PRUEF(f3.l.n == 0 && f3.r.n == 0);
      else PRUEF(f3.l.n == 0 || (f3.l.erste >= p && f3.l.letzte < p + cdj::ARR_NAHT + 256 && f3.r.letzte < p + cdj::ARR_NAHT + 256));   // KNOWN: the tail, bounded
    }
    if (zu)
      for (int64_t vor : {512, 1024, 2048}) info_reset_vor_laden(*w, r.get(), P[1], vor, BIS);
    {  // 4: one stem track of B goes, its group stays (a removed vocals track: the tail of one track)
      const Fall f4 = fall(*w, r.get(), "4 one B stem goes", {{0, true, BTeil::voll}, {P[1], true, BTeil::ohne_stimme}}, zu, BIS, schwelle);
      if (!zu) PRUEF(f4.l.n == 0 && f4.r.n == 0);
      else PRUEF(f4.l.n == 0 || (f4.l.erste >= P[1] && f4.l.letzte < P[1] + cdj::ARR_NAHT + 256));
    }
    {  // 5: B changes every third block for 60 blocks, A never moves (the silent variant is exact; the closed one is measured only, it carries the tails of the goings)
      std::vector<Schritt> plan = {{0, true, BTeil::keiner}};
      const BTeil folge[] = {BTeil::nur_loop, BTeil::voll, BTeil::keiner, BTeil::voll};
      for (int i = 0; i < 60; ++i) plan.push_back({31 * SPB + 3072 + i * 3 * 256, true, folge[i % 4]});
      const Fall f5 = fall(*w, r.get(), "5 B changes every 3rd block", plan, zu, BIS, schwelle);
      if (!zu) PRUEF(f5.l.n == 0 && f5.r.n == 0);
    }
  }
  PRUEF_ENDE();
}
