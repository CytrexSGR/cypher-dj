// 1.12 automation slice 5, unit U8b (plan T8.3): the gain envelope of an audio clip through the voices of the warp werk (COMPLEX, TONES). The werk voice reads its ring and
// holds v.gain; the envelope is a second factor per sample at the clip beat of the sample (karte.beat_at(t) + beat_versatz), with a cursor that is rebound at every swap.
// Measuring: every case compares two (or three) runs of the SAME project that differ in the envelope only. The ring of the werk is deterministic (synchronous werk, same
// source, same map), so the output of the run with the envelope is the output of the run without it times the factor, and the ratio of the RMS over a window is the factor
// in dB, exact to the float. No absolute level of Bungee's output is used.
//   1  AK18       COMPLEX and TONES: -12 -> 0 dB over 16 beats; the ratio at five beats is on the line (+-0.05 dB). Mutation ARR_HK_WERK_SCHNELLPFAD (the fast path of the
//                 werk voice for a block without ramps ignores the envelope): red.
//   2  T8.3       a swap that changes only the table (-6 -> -18 dB, none -> -12 dB, -12 dB -> none) glides over ARR_NAHT: swap run = A + (B - A) * u(t) per sample, A and B being
//                 the runs with the table before and after for the whole time, u the linear ramp of ARR_NAHT samples at the swap sample; no new voice (werk_stimmen, warp_stimmen,
//                 ansaetze unchanged, stimmen_verloren 0). The old snapshot is deleted two blocks after the swap and the run goes on (under ASan: the cursor is on the new table).
//                 Negative control: the same table in the new snapshot is bit-identical to no swap. Mutations ARR_HK_WERK_BINDUNG_OHNE (the cursor stays on the old table: the
//                 level never goes to the new one) and ARR_HK_TAUSCH_HART (the factor jumps): red.
//   3  T8.3       start in the middle (beat 6): the first sound is hk(6), not hk(0).
//   4  T8.3       loop 0..8 over three passes: the voice of every pass starts on hk(0) (the cursor of a pool slot that ended on the seam is not kept). Mutation ARR_HK_CURSOR_ALT: red.
//   5  T8.3       a swap that changes the MAP while the voice plays (the voice becomes a bridge, then the successor takes over): the old snapshot is deleted right after the swap
//                 (under ASan: the bridge keeps no pointer into it), the bridge plays at the factor in force at the swap, the successor on the live envelope. Mutation
//                 ARR_HK_BRUECKE_OHNE (the bridge plays at 0 dB): red.
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/warp_werk.h"
#include "pruef.h"

bool g_waechter = false;

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;
using Tab = std::vector<ArrAutoPunkt>;

namespace {

constexpr double FB = 24000.0;   // source frames per beat: the source is a 120 BPM source and the project runs at 120 BPM (identity map)

ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
double lin(double db) { return db <= -120.0 ? 0.0 : std::pow(10.0, db / 20.0); }

double rms(const std::vector<float>& l, int64_t a, int64_t b) {
  double s = 0.0;
  for (int64_t i = a; i < b; ++i) s += static_cast<double>(l[static_cast<size_t>(i)]) * l[static_cast<size_t>(i)];
  return std::sqrt(s / static_cast<double>(b - a));
}
// the ratio of two runs over [a, b) in dB
double verhaeltnis_db(const std::vector<float>& mit, const std::vector<float>& ohne, int64_t a, int64_t b) {
  return 20.0 * std::log10(std::max(rms(mit, a, b), 1e-12) / std::max(rms(ohne, a, b), 1e-12));
}

struct Opt {
  double clip_beats = 16.0;
  double start_beat = 0.0;
  bool loop = false;
  double loop_bis = 8.0;
  double bis_beat = 16.5;       // run until this beat after the start sample
  bool swap = false;            // a second snapshot at swap_beat after the start sample (a block boundary at or after it)
  double swap_beat = 4.5;
  bool tab_gleich = false;      // the new snapshot carries the table of the old one
  Tab tab2;                     // the table of the new snapshot (empty: none)
  double ende_marker2 = 0.0;    // != 0: the new snapshot has another map (the last marker at this frame): the voice becomes a bridge
  bool freigeben = false;       // delete the old snapshot two blocks after the swap
};
struct Erg {
  std::vector<float> l;
  int64_t s0 = 0, s_swap = 0;
  bool kein_werk = false;
  int werk_vor = -1, werk_nach = -1, warp_vor = -1, warp_nach = -1;
  uint64_t ans_vor = 0, ans_nach = 0, verloren = 0, spaet = 0, unterlauf = 0, kein_platz = 0;
};

// one run: clip c1 (map: identity, last marker at 24000 * clip_beats), sine 1 kHz, modus COMPLEX or TONES, table tab (empty: none)
Erg lauf(const cdj::ArrAudio* a, int modus, const Tab& tab, const Opt& o) {
  Erg e;
  Treiber t;
  if (!t.mit_werk()) {
    e.kein_werk = true;
    return e;
  }
  t.k = cdj::Karte(120.0, 0);
  const auto bau = [&](const Tab& tb, double ende_marker) {
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, o.clip_beats, a);
    b.warp({0.0, o.clip_beats}, {0.0, ende_marker}, modus);
    if (!tb.empty()) b.hk(tb);
    return b.fertig();
  };
  t.laden(bau(tab, o.clip_beats * FB));
  if (o.loop) t.arr.loop(true, 0.0, o.loop_bis, 0, t.k);
  t.arr.start(o.start_beat, 0, false, 0, 537, 256, t.k);
  t.lauf(1024);
  e.s0 = t.arr.einsatz_sample();
  const int64_t ziel = e.s0 + static_cast<int64_t>(o.bis_beat * FB);
  if (!o.swap) {
    t.lauf(ziel);
  } else {
    t.lauf(e.s0 + static_cast<int64_t>(o.swap_beat * FB));
    e.s_swap = t.s;
    e.werk_vor = t.arr.werk_stimmen();
    e.warp_vor = t.arr.warp_stimmen();
    e.ans_vor = t.werk->zaehler().ansaetze;
    t.laden(bau(o.tab_gleich ? tab : o.tab2, o.ende_marker2 != 0.0 ? o.ende_marker2 : o.clip_beats * FB));
    t.lauf(t.s + 512);
#ifdef CYPHERDJ_MUTATION_ARR_HK_WERK_BINDUNG_OHNE
    // error case: the cursor of the voice stays on the table of the OLD snapshot. Deleting that snapshot would end the run in a use after free (SEGV, which ctest does not count as
    // a failed assertion); so the snapshot stays alive here and the mutation turns the level checks red. The real use after free is shown with WERK_HK_FREIGABE_ECHT=1 (under ASan).
    const bool freigeben = o.freigeben && std::getenv("WERK_HK_FREIGABE_ECHT") != nullptr;
#else
    const bool freigeben = o.freigeben;
#endif
    if (freigeben && !t.alt.empty()) {   // the old snapshot goes: from here on nothing may read it
      delete t.alt.front();
      t.alt.erase(t.alt.begin());
    }
    e.werk_nach = t.arr.werk_stimmen();
    e.warp_nach = t.arr.warp_stimmen();
    e.ans_nach = t.werk->zaehler().ansaetze;
    t.lauf(ziel);
  }
  e.l = t.l;
  e.verloren = t.arr.stimmen_verloren();
  e.spaet = t.arr.warp_spaet();
  e.unterlauf = t.arr.warp_unterlauf();
  e.kein_platz = t.arr.warp_kein_platz();
  t.werk->stoppe();   // the threads (none: synchronous) end before the source goes
  return e;
}

const char* name(int modus) { return modus == cdj::ARR_WARP_COMPLEX ? "COMPLEX" : "TONES"; }

}  // namespace

int main() {
  auto src = Audio::sinus(40 * 24000, 1000.0, 0.5f);
  const int modi[2] = {cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES};
  {  // 1: AK18 through the werk
    for (int modus : modi) {
      Opt o;
      o.bis_beat = 16.0;
      const Erg mit = lauf(&src->a, modus, {P(0, -12.f), P(16, 0.f)}, o);
      if (mit.kein_werk) {
        std::printf("Fall 1 uebersprungen: dieser Bau hat kein Bungee (kein Warp-Werk)\n");
        PRUEF_ENDE();
      }
      const Erg ohne = lauf(&src->a, modus, {}, o);
      PRUEF(mit.s0 == ohne.s0 && mit.s0 > 0 && mit.l.size() == ohne.l.size());
      for (int b : {2, 4, 8, 12, 15}) {
        const int64_t c = mit.s0 + static_cast<int64_t>(b * FB);
        const double db = verhaeltnis_db(mit.l, ohne.l, c - 1200, c + 1200);
        std::printf("Fall 1 (%s) beat %d: ratio %.3f dB, line %.3f dB\n", name(modus), b, db, -12.0 + 12.0 * b / 16.0);
        PRUEF_NAH(db, -12.0 + 12.0 * b / 16.0, 0.05);
      }
      PRUEF(rms(ohne.l, mit.s0 + 8 * 24000 - 1200, mit.s0 + 8 * 24000 + 1200) > 0.1);   // the run is not silent (the ratio is not 0 / 0)
      PRUEF(mit.spaet == 0 && mit.unterlauf == 0 && mit.kein_platz == 0 && mit.verloren == 0);
    }
  }
  {  // 2: a swap that changes only the table glides over ARR_NAHT
    struct Fall { const char* text; Tab von, nach; };
    const Fall faelle[] = {{"-6 -> -18 dB", {P(0, -6.f), P(16, -6.f)}, {P(0, -18.f), P(16, -18.f)}},
                           {"none -> -12 dB", {}, {P(0, -12.f), P(16, -12.f)}},
                           {"-12 dB -> none", {P(0, -12.f), P(16, -12.f)}, {}}};
    for (int modus : modi)
      for (const Fall& f : faelle) {
        Opt oa;
        oa.bis_beat = 6.0;
        Opt os = oa;
        os.swap = true;
        os.tab2 = f.nach;
        os.freigeben = true;
        const Erg a_von = lauf(&src->a, modus, f.von, oa);
        const Erg b_nach = lauf(&src->a, modus, f.nach, oa);
        const Erg sw = lauf(&src->a, modus, f.von, os);
        PRUEF(a_von.s0 == sw.s0 && b_nach.s0 == sw.s0 && sw.s_swap > sw.s0 + 4 * 24000);
        // swap run = A + (B - A) * u(t); u = 0 before the swap sample, ramp over ARR_NAHT, 1 after
        double fehler = 0.0;
        for (int64_t t = sw.s_swap - 300; t < sw.s_swap + 600; ++t) {
          const double u = std::min(1.0, std::max(0.0, static_cast<double>(t - sw.s_swap) / cdj::ARR_NAHT));
          const double soll = a_von.l[static_cast<size_t>(t)] + (b_nach.l[static_cast<size_t>(t)] - a_von.l[static_cast<size_t>(t)]) * u;
          fehler = std::max(fehler, std::fabs(soll - static_cast<double>(sw.l[static_cast<size_t>(t)])));
        }
        const double ab = verhaeltnis_db(sw.l, a_von.l, sw.s_swap + 300, sw.s_swap + 1500);   // after the glide: the new table
        const double soll_ab = 20.0 * std::log10(std::max(1e-12, f.nach.empty() ? 1.0 : lin(f.nach[0].wert)) / std::max(1e-12, f.von.empty() ? 1.0 : lin(f.von[0].wert)));
        std::printf("Fall 2 (%s, %s): max |swap - line| %.2e, after the glide %.3f dB (want %.3f), voices werk %d -> %d, warp %d -> %d, ansaetze %llu -> %llu, lost %llu\n", name(modus), f.text,
                    fehler, ab, soll_ab, sw.werk_vor, sw.werk_nach, sw.warp_vor, sw.warp_nach, static_cast<unsigned long long>(sw.ans_vor),
                    static_cast<unsigned long long>(sw.ans_nach), static_cast<unsigned long long>(sw.verloren));
        PRUEF(fehler < 3e-6);
        PRUEF_NAH(ab, soll_ab, 0.05);
        PRUEF(sw.werk_vor == 1 && sw.werk_nach == 1 && sw.warp_vor == sw.warp_nach && sw.ans_vor == sw.ans_nach && sw.verloren == 0);   // no new voice, no new job
      }
    // negative control: the same table in the new snapshot is bit-identical to no swap
    for (int modus : modi) {
      Opt oa;
      oa.bis_beat = 6.0;
      Opt os = oa;
      os.swap = true;
      os.tab_gleich = true;
      os.freigeben = true;
      const Tab tab = {P(0, -6.f), P(16, -6.f)};
      const Erg a = lauf(&src->a, modus, tab, oa);
      const Erg s = lauf(&src->a, modus, tab, os);
      PRUEF(a.l.size() == s.l.size() && a.l == s.l && s.werk_vor == 1 && s.werk_nach == 1 && s.ans_vor == s.ans_nach);
      std::printf("Fall 2 control (%s): same table in a new snapshot is bit-identical to no swap: %s\n", name(modus), a.l == s.l ? "yes" : "NO");
    }
  }
  {  // 3: transport start in the middle of the clip
    for (int modus : modi) {
      Opt o;
      o.start_beat = 6.0;
      o.bis_beat = 5.0;
      const Tab tab = {P(0, -12.f), P(16, 0.f)};
      const Erg mit = lauf(&src->a, modus, tab, o);
      const Erg ohne = lauf(&src->a, modus, {}, o);
      PRUEF(mit.s0 == ohne.s0);
      for (double d : {1.0, 2.0, 4.0}) {   // beats after the start sample (clip beat 6 + d)
        const int64_t c = mit.s0 + static_cast<int64_t>(d * FB);
        const double db = verhaeltnis_db(mit.l, ohne.l, c - 1200, c + 1200);
        std::printf("Fall 3 (%s) start at 6, +%.0f beats: ratio %.3f dB, line %.3f dB\n", name(modus), d, db, -12.0 + 12.0 * (6.0 + d) / 16.0);
        PRUEF_NAH(db, -12.0 + 12.0 * (6.0 + d) / 16.0, 0.05);
      }
    }
  }
  {  // 4: loop 0..8, three passes: each pass starts on hk(0)
    for (int modus : modi) {
      Opt o;
      o.loop = true;
      o.clip_beats = 8.0;
      o.loop_bis = 8.0;
      o.bis_beat = 23.0;
      // three points: a cursor left on the middle point by the pass before answers with the value of that point (-6 dB) for every beat before it, instead of the line (-10.5 dB at beat 1)
      const Tab tab = {P(0, -12.f), P(4, -6.f), P(8, 0.f)};
      const Erg mit = lauf(&src->a, modus, tab, o);
      const Erg ohne = lauf(&src->a, modus, {}, o);
      PRUEF(mit.s0 == ohne.s0);
      for (int pass = 0; pass < 3; ++pass) {
        const double lb = 1.0;   // one beat into the pass
        const int64_t c = mit.s0 + static_cast<int64_t>((8.0 * pass + lb) * FB);
        const double db = verhaeltnis_db(mit.l, ohne.l, c - 1200, c + 1200);
        std::printf("Fall 4 (%s) pass %d, beat %.0f of the pass: ratio %.3f dB, line %.3f dB\n", name(modus), pass + 1, lb, db, -12.0 + 6.0 * lb / 4.0);
        PRUEF_NAH(db, -12.0 + 6.0 * lb / 4.0, 0.05);
      }
    }
  }
  {  // 5: a swap that changes the map: the voice becomes a bridge
    for (int modus : modi) {
      Opt oa;
      oa.bis_beat = 8.0;
      oa.swap = true;
      oa.swap_beat = 4.5;
      oa.ende_marker2 = 16.0 * FB + 1200.0;   // a slightly different map: another job, the old voice plays on as a bridge
      oa.freigeben = true;
      oa.tab_gleich = true;
      const Tab tab = {P(0, -60.f), P(16, 0.f)};   // 3.75 dB per beat
      const Erg mit = lauf(&src->a, modus, tab, oa);
      const Erg ohne = lauf(&src->a, modus, {}, oa);
      PRUEF(mit.s0 == ohne.s0 && mit.s_swap == ohne.s_swap && mit.verloren == 0);
      const double hk_swap = -60.0 + 60.0 * (static_cast<double>(mit.s_swap - mit.s0) / FB) / 16.0;
      const double vor = verhaeltnis_db(mit.l, ohne.l, mit.s_swap - 1600, mit.s_swap - 200);
      const double bruecke = verhaeltnis_db(mit.l, ohne.l, mit.s_swap + 200, mit.s_swap + 1800);   // the bridge plays up to s + ARR_WARP_FRIST (2048)
      const int64_t c = mit.s_swap + 8000;
      const double danach = verhaeltnis_db(mit.l, ohne.l, c - 800, c + 800);
      const double hk_c = -60.0 + 60.0 * (static_cast<double>(c - mit.s0) / FB) / 16.0;
      std::printf("Fall 5 (%s): before the swap %.3f dB, bridge %.3f dB (held factor at the swap: %.3f dB), successor %.3f dB (line %.3f dB), ansaetze %llu -> %llu\n", name(modus), vor, bruecke,
                  hk_swap, danach, hk_c, static_cast<unsigned long long>(mit.ans_vor), static_cast<unsigned long long>(mit.ans_nach));
      PRUEF(mit.ans_nach > mit.ans_vor);   // it really was a new job (the map changed), not the gain-only swap
      PRUEF_NAH(vor, hk_swap, 0.4);
      PRUEF_NAH(bruecke, hk_swap, 0.05);
      PRUEF_NAH(danach, hk_c, 0.05);
    }
  }
  PRUEF_ENDE();
}
