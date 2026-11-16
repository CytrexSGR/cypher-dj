// Sampler A2 T6: the core hands each note the value of a LATCHED device knob (graph `regler` with `rastet` 1) at the note's own beat, as an event at the note's sample, placed before the note
// (Arrangement::noten_fenster, ArrSenke::note_regler, ArrInternSenke, ArrBkSenke, cypher_bk_regler_bei). The graphs G_T / G_R play a saw times the gate times knob 1, so the level of the
// first samples of a note is proportional to the knob value the instance holds at the note's onset; G_R is G_T with k1 `rastet 1`.
//   R1 eigener_schritt   notes at beats 0 and 0.25; an absolute k1 lane holds 0.2 and jumps to 1.0 at beat 0.25: over the first 64 samples note 1 plays 0.2, note 2 plays 1.0 (ratio to the same
//                        notes with the knob steady at 1.0, within 1 %)
//   R2 vor_der_stufe     note 2 100 samples before the step, both in one block: note 2 plays 0.2 (its own cell), not the 1.0 of the block's last sample; also 10 samples before at the usual lead
//   R3 relativ           a relative lane on k1 (snapshot knob 0.5, summand -0.3, then +0.5 at beat 0.25): note 2 plays clamp(1.0) = 1.0, and 0.2 when it sits before the step
//   R4 ohne_maske        G_T (no `rastet`) gives the fingerprint recorded on the tree before the change, and a recording sink sees no note_regler call; positive control: the same snapshot with a
//                        mask sees one call per note, each right before its note-on, with the lane value of the note's beat
//   R5 keine_allokation  2000 blocks with R1's lane and a swap: 0 allocations, locks and sleeps (positive control: the counter sees an allocation)
//   R6 noten_vorrang     200 note-ons in one block: every note reaches the instance, the knob values that no longer fit in the FFI queue are lost and counted (144), no crash
//   R7 live              a live note takes the block value only (no note_regler)
//   R8 ueber_relativ     a relative lane on the latched knob with a live override of the knob (spur/<slot>/bk/<k>): the override wins and the summand drops, in the block loop (oracle: the same plan on
//                        G_T, which has only the block path) and for the note
//   R9 ueber_absolut     an absolute lane with an override: the lane wins (the lane value is reported after the override), in the block loop (oracle G_T, flat lane) and for the note (stepped lane too)
//   R10 ohne_lane        no lane: a turned track knob (snapshot value) and a live override reach the note through the block value (oracle G_T)
// Mutations: none of its own; R2 (and the mask-1 case of R4, R3 before the step, R6) fail against a noten_fenster that sends nothing (checked by hand once).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
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

// the fingerprint of R4: FNV-64 of the left and right output of the plan below, recorded on the tree BEFORE this task's change (graph G_T, an absolute lane on k1, 8 notes over 4 beats)
constexpr uint64_t FINGERABDRUCK_OHNE_RASTET = 0x659746b44621e3c7ull;

struct Sinken {
  cdj::ArrRbSenke rb;
  cdj::ArrBkSenke bk;
  cdj::ArrKitSenke kit;
  cdj::ArrInternSenke intern;
  explicit Sinken(cdj::Arrangement& a) : rb(a), bk(a), kit(a), intern(a, &rb, &bk, &kit) { a.setze_senke_intern(&intern); }
};

uint64_t fnv(const std::vector<float>& v, uint64_t h) {
  for (float f : v) {
    uint32_t u;
    std::memcpy(&u, &f, 4);
    for (int i = 0; i < 4; ++i) {
      h ^= (u >> (8 * i)) & 0xffu;
      h *= 1099511628211ull;
    }
  }
  return h;
}

double rms(const std::vector<float>& v, int64_t von, int64_t bis) {
  double q = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(v.size()); ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}

// G_R: G_T with k1 latched
std::string graph_r() {
  std::string g = bkt::G_T;
  const std::string a = "\"nr\":1,\"min\":0,\"max\":1";
  g.replace(g.find(a), a.size(), a + ",\"rastet\":1");
  return g;
}

using Punkte = std::vector<cdj::ArrAutoPunkt>;
constexpr uint8_t GER = cdj::ARR_AUTO_GERAET;

struct Bahn {
  int knopf;
  Punkte p;
  bool relativ = false;
};
struct Ton {
  double beat, laenge;
  int ton;
};
struct Plan {
  std::string graph;
  float k1 = 0.5f;
  std::vector<Bahn> lanen;
  std::vector<Ton> noten;
  double beats = 1.0;
  int vorhalt = 537;
  float ueber = -1.0f;   // >= 0: a live override of k1 (spur/1/bk/1) set after the snapshot is loaded
};
struct Lauf {
  std::vector<float> l, r;
  uint64_t verloren = 0;
};

cdj::ArrSnapshot* baue(const Plan& p, CypherBk* h, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::intern);
  int i = 0;
  for (const Ton& n : p.noten) b.note(1, ("v/n" + std::to_string(i++)).c_str(), n.beat, n.laenge, n.ton, 127);
  for (const Bahn& x : p.lanen) b.lane(1, x.p, GER, static_cast<uint8_t>(x.knopf), x.relativ);
  cdj::ArrSnapshot* s = b.fertig();
  bkt::spur(s, 1, h, 1, {{"k1", p.k1}});
  return s;
}

Lauf spiele(const Plan& p) {
  Lauf f;
  Treiber t;
  Sinken sk(t.arr);
  CypherBk* h = bkt::neu(p.graph);
  t.laden(baue(p, h));
  if (p.ueber >= 0.0f) {
    const int zeile = t.tab.suche("spur/1/bk/1");
    PRUEF(zeile >= 0);
    t.arr.setze_sofort(zeile, p.ueber);
  }
  t.arr.start(0.0, 0, false, t.s, p.vorhalt, 256, t.k);
  t.lauf(static_cast<int64_t>(p.beats * static_cast<double>(SPB)) + p.vorhalt + 256);
  f.l = t.l;
  f.r = t.r;
  f.verloren = sk.bk.verloren();
  t.arr.setze_senke_intern(nullptr);
  cypher_bk_frei(h);
  return f;
}

// the sample of a project beat in a run with lead `vorhalt` (the first sample of the playback is vorhalt + 256)
int64_t sample_bei(double beat, int vorhalt) { return vorhalt + 256 + std::llround(beat * static_cast<double>(SPB)); }

// level of the first 64 samples of the note at `an`, against the same notes with the knob steady at 1.0
double verhaeltnis(const Lauf& mit, const Lauf& ref, int64_t an) { return rms(mit.l, an, an + 64) / rms(ref.l, an, an + 64); }

const Punkte STUFE = {{0.0, 0.2f, 0}, {0.25, 1.0f, 2}};   // 0.2, a jump to 1.0 at beat 0.25

// a sink that records what the Arrangement hands over (order and values)
struct RecSenke final : cdj::ArrSenke {
  struct Ereignis {
    char art;   // 'R' note_regler, 'N' note on
    int64_t ziel;
    int param;
    float wert;
    bool relativ;
  };
  std::vector<Ereignis> ev;
  RecSenke() { ev.reserve(4096); }
  int64_t vorhalt() const noexcept override { return 0; }
  void note(int, int64_t ziel, uint8_t, uint8_t, bool an) noexcept override {
    if (an) ev.push_back({'N', ziel, 0, 0.0f, false});
  }
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int, float*, float*) noexcept override {}
  void note_regler(int, int64_t ziel, int param, float wert, bool relativ) noexcept override { ev.push_back({'R', ziel, param, wert, relativ}); }
  int n(char art) const {
    int c = 0;
    for (const Ereignis& e : ev) c += e.art == art ? 1 : 0;
    return c;
  }
};

}  // namespace

int main() {
  const std::string GR = graph_r();
  const std::vector<Ton> zwei = {{0.0, 0.2, 45}, {0.25, 0.2, 52}};
  {  // R4 first: the fingerprint of a graph without `rastet`
    Plan p;
    p.graph = bkt::G_T;
    p.k1 = 0.5f;
    p.lanen = {{0, {{0.0, 0.2f, 0}, {4.0, 1.0f, 0}}}};
    for (int i = 0; i < 8; ++i) p.noten.push_back({0.5 * i, 0.4, 45 + i});
    p.beats = 4.5;
    const Lauf f = spiele(p);
    uint64_t fp = 1469598103934665603ull;
    fp = fnv(f.l, fp);
    fp = fnv(f.r, fp);
    std::printf("R4: fingerprint %016llx (%zu samples), recorded %016llx\n", static_cast<unsigned long long>(fp), f.l.size(), static_cast<unsigned long long>(FINGERABDRUCK_OHNE_RASTET));
    PRUEF(rms(f.l, 4096, 8192) > 1e-3);   // the run is not silent
    PRUEF(fp == FINGERABDRUCK_OHNE_RASTET);
    PRUEF(f.verloren == 0);
    // recording sink: a graph without a mask gets no call; the same snapshot with a mask gets one per note, right before it
    for (const bool maske : {false, true}) {
      Treiber t;
      RecSenke rec;
      t.arr.setze_senke_intern(&rec);
      CypherBk* h = bkt::neu(bkt::G_T);
      cdj::ArrSnapshot* s = baue(p, h);
      if (maske) s->spur[0].bk_rastet = 1;   // positive control: the track names k1 as latched
      t.laden(s);
      t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
      t.lauf(static_cast<int64_t>(4.5 * static_cast<double>(SPB)) + 537 + 256);
      std::printf("R4: mask %d: %d note-ons, %d note_regler calls\n", maske ? 1 : 0, rec.n('N'), rec.n('R'));
      PRUEF(rec.n('N') == 8);
      if (!maske) {
        PRUEF(rec.n('R') == 0);
      } else {
        PRUEF(rec.n('R') == 8);
        bool ordnung = true, werte = true;
        for (size_t i = 0; i + 1 < rec.ev.size(); ++i) {
          if (rec.ev[i].art != 'R') continue;
          ordnung = ordnung && rec.ev[i + 1].art == 'N' && rec.ev[i + 1].ziel == rec.ev[i].ziel && rec.ev[i].param == 0 && !rec.ev[i].relativ;
          const double beat = static_cast<double>(rec.ev[i].ziel - (537 + 256)) / static_cast<double>(SPB);
          werte = werte && std::fabs(rec.ev[i].wert - (0.2 + 0.8 * beat / 4.0)) < 2e-3;   // the lane at the note's own beat
        }
        PRUEF(ordnung);
        PRUEF(werte);
      }
      t.arr.setze_senke_intern(nullptr);
      cypher_bk_frei(h);
    }
  }
  {  // R1: each note plays the lane value of its own beat
    Plan p;
    p.graph = GR;
    p.lanen = {{0, STUFE}};
    p.noten = zwei;
    p.beats = 0.6;
    Plan r = p;
    r.k1 = 1.0f;
    r.lanen.clear();
    const Lauf mit = spiele(p), ref = spiele(r);
    const double a1 = verhaeltnis(mit, ref, sample_bei(0.0, 537)), a2 = verhaeltnis(mit, ref, sample_bei(0.25, 537));
    std::printf("R1: note 1 ratio %.4f (0.2), note 2 ratio %.4f (1.0), lost %llu\n", a1, a2, static_cast<unsigned long long>(mit.verloren));
    PRUEF(rms(ref.l, sample_bei(0.0, 537), sample_bei(0.0, 537) + 64) > 1e-3);
    PRUEF(std::fabs(a1 - 0.2) < 0.2 * 0.01);
    PRUEF(std::fabs(a2 - 1.0) < 0.01);
    PRUEF(mit.verloren == 0);
  }
  {  // R2: the note sits before the step in the block of the step: it plays its own cell
    for (const int davor : {100, 10}) {
      Plan p;
      p.graph = GR;
      p.lanen = {{0, STUFE}};
      p.beats = 0.6;
      // lead 669: the step (sample 669 + 256 + 5625 = 6550) lies 150 samples into the block [6400, 6656), so a note 100 or 10 samples before it is in the same block
      p.vorhalt = 669;
      p.noten = {{0.0, 0.2, 45}, {0.25 - static_cast<double>(davor) / static_cast<double>(SPB), 0.2, 52}};
      const int64_t stufe = sample_bei(0.25, p.vorhalt), an = sample_bei(p.noten[1].beat, p.vorhalt);
      PRUEF(an == stufe - davor && an / 256 == stufe / 256);   // both in one block
      Plan r = p;
      r.k1 = 1.0f;
      r.lanen.clear();
      const Lauf mit = spiele(p), ref = spiele(r);
      const double a2 = verhaeltnis(mit, ref, an);
      std::printf("R2: note %d samples before the step, same block %lld: ratio %.4f (its own cell 0.2, the block end would give 1.0)\n", davor, static_cast<long long>(an / 256), a2);
      PRUEF(std::fabs(a2 - 0.2) < 0.2 * 0.01);
    }
  }
  {  // R3: a relative lane: the snapshot knob plus the summand at the note's beat, clamped
    const Punkte summand = {{0.0, -0.3f, 0}, {0.25, 0.5f, 2}};
    Plan p;
    p.graph = GR;
    p.k1 = 0.5f;
    p.lanen = {{0, summand, true}};
    p.noten = zwei;
    p.beats = 0.6;
    Plan r = p;
    r.k1 = 1.0f;
    r.lanen.clear();
    const Lauf mit = spiele(p), ref = spiele(r);
    const double a1 = verhaeltnis(mit, ref, sample_bei(0.0, 537)), a2 = verhaeltnis(mit, ref, sample_bei(0.25, 537));
    std::printf("R3: relative lane: note 1 ratio %.4f (0.2), note 2 ratio %.4f (clamp 1.0)\n", a1, a2);
    PRUEF(std::fabs(a1 - 0.2) < 0.2 * 0.01);
    PRUEF(std::fabs(a2 - 1.0) < 0.01);
    // and before the step in the block of the step (as R2): the summand of its own cell
    p.vorhalt = r.vorhalt = 669;
    p.noten = r.noten = {{0.0, 0.2, 45}, {0.25 - 100.0 / static_cast<double>(SPB), 0.2, 52}};
    const Lauf mit2 = spiele(p), ref2 = spiele(r);
    const double b2 = verhaeltnis(mit2, ref2, sample_bei(p.noten[1].beat, 669));
    std::printf("R3: relative lane, note 100 samples before the step: ratio %.4f (0.2)\n", b2);
    PRUEF(std::fabs(b2 - 0.2) < 0.2 * 0.01);
  }
  {  // R5: no allocation, lock or sleep with per-note knob values (a lane with steps, notes every 1/16, a swap)
    Treiber t;
    Sinken sk(t.arr);
    CypherBk* h = bkt::neu(GR);
    auto plan = [&](float k1) {
      Plan p;
      p.graph = GR;
      p.k1 = k1;
      p.lanen = {{0, {{0.0, 0.2f, 0}, {4.0, 1.0f, 2}, {8.0, 0.3f, 2}, {12.0, 0.9f, 2}}}};
      for (int i = 0; i < 96; ++i) p.noten.push_back({0.25 * i, 0.2, 40 + i % 24});
      return p;
    };
    cdj::ArrSnapshot* s1 = baue(plan(0.7f), h, 2);
    t.laden(baue(plan(0.5f), h, 1));
    t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
    t.lauf(20000);
    float bf[6][cdj::ARR_BLOCK];
    int64_t smp = t.s;
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(2);
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 1000) alt.push_back(t.arr.tausche(s1, smp, t.k));
      for (auto& x : bf) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, smp, 256, bf[0], bf[1], bf[2], bf[3], bf[4], bf[5]);
      smp += 256;
    }
    const long im_fenster = abfang_aus();
    std::printf("R5: allocations in 2000 blocks = %ld, knob values lost %llu\n", im_fenster, static_cast<unsigned long long>(sk.bk.verloren()));
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(im_fenster == 0);
    PRUEF(sk.bk.verloren() == 0);
    for (const cdj::ArrSnapshot* x : alt) delete x;
    t.arr.setze_senke_intern(nullptr);
    cypher_bk_frei(h);
    abfang_an();
    { std::vector<int> v(100); }
    const long positiv = abfang_aus();
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(positiv > 0);   // positive control: the watcher counts
  }
  {  // R6: more events in one block than the instance's queue takes: the notes win, knob values are lost and counted
    Plan p;
    p.graph = GR;
    p.lanen = {{0, STUFE}};
    for (int i = 0; i < 200; ++i) p.noten.push_back({0.1, 4.0, 24 + i % 100});   // 200 note-ons at one beat, held
    p.beats = 0.3;
    Plan o = p;
    o.graph = bkt::G_T;
    const Lauf mit = spiele(p), ohne = spiele(o);
    std::printf("R6: 200 note-ons with a latched knob: %llu events lost (200 knob values do not fit next to 200 notes in 256: 144); without the mask: %llu\n",
                static_cast<unsigned long long>(mit.verloren), static_cast<unsigned long long>(ohne.verloren));
    PRUEF(ohne.verloren == 0);       // all 200 notes fit
    PRUEF(mit.verloren == 144);      // 256 - 200 = 56 knob values fit, 144 do not; no note is among the lost
    // the instance really got all the notes: the run sounds the same as without the mask (stimmen 2 plays the last two notes in both; level scaled by the knob only)
    const int64_t an = sample_bei(0.1, 537);
    PRUEF(rms(mit.l, an, an + 4096) > 1e-4 && rms(ohne.l, an, an + 4096) > 1e-4);
  }
  {  // R7: a live note takes the block value only: no note_regler
    Treiber t;
    RecSenke rec;
    t.arr.setze_senke_intern(&rec);
    CypherBk* h = bkt::neu(GR);
    Plan p;
    p.graph = GR;
    p.lanen = {{0, STUFE}};
    t.laden(baue(p, h));
    t.arr.live_note(0, 1000, 60, 100, true);
    t.arr.live_note(0, 3000, 60, 0, false);
    std::printf("R7: live note: %d note-ons, %d note_regler calls\n", rec.n('N'), rec.n('R'));
    PRUEF(rec.n('N') == 1);
    PRUEF(rec.n('R') == 0);
    t.arr.setze_senke_intern(nullptr);
    cypher_bk_frei(h);
  }
  {  // R8 to R10: the note path follows the rule of the block loop for an overridden knob
    // The block loop (ArrBkSenke::block_bahn): a knob reported in the block (the override, then a lane's absolute value, the last report wins) is used as it is; a relative lane only (no
    // report) adds its summand to the snapshot knob; no lane: the snapshot knob. G_T has only that path (no `rastet`), its flat-lane runs are the oracle for the note path of G_R.
    const Punkte summand_stufe = {{0.0, -0.3f, 0}, {0.25, 0.5f, 2}};
    const Punkte summand_flach = {{0.0, -0.3f, 0}, {8.0, -0.3f, 0}};
    const Punkte absolut_flach = {{0.0, 0.4f, 0}, {8.0, 0.4f, 0}};
    auto lauf = [&](const std::string& g, float k1, const std::vector<Bahn>& lanen, float ueber, double beat, int vorhalt = 537) {
      Plan p;
      p.graph = g;
      p.k1 = k1;
      p.lanen = lanen;
      p.ueber = ueber;
      p.noten = zwei;
      p.beats = 0.6;
      p.vorhalt = vorhalt;
      Plan r = p;
      r.k1 = 1.0f;
      r.lanen.clear();
      r.ueber = -1.0f;
      return verhaeltnis(spiele(p), spiele(r), sample_bei(beat, vorhalt));
    };
    const double N1 = 0.0, N2 = 0.25;
    {  // R8: relative lane + override
      double mit[2], orakel[2], ohne[2];
      for (int i = 0; i < 2; ++i) {
        mit[i] = lauf(GR, 0.5f, {{0, summand_stufe, true}}, 0.8f, i ? N2 : N1);
        orakel[i] = lauf(bkt::G_T, 0.5f, {{0, summand_flach, true}}, 0.8f, i ? N2 : N1);
        ohne[i] = lauf(GR, 0.5f, {{0, summand_stufe, true}}, -1.0f, i ? N2 : N1);
      }
      std::printf("R8: relative lane, override 0.8: note 1 %.4f, note 2 %.4f (block loop %.4f, %.4f); without the override %.4f, %.4f (R3: 0.2, 1.0)\n", mit[0], mit[1], orakel[0], orakel[1], ohne[0], ohne[1]);
      for (int i = 0; i < 2; ++i) {
        PRUEF(std::fabs(orakel[i] - 0.8) < 0.8 * 0.01);   // the block loop: the override, the summand drops
        PRUEF(std::fabs(mit[i] - 0.8) < 0.8 * 0.01);      // the note: the same
      }
      PRUEF(std::fabs(ohne[0] - 0.2) < 0.2 * 0.01 && std::fabs(ohne[1] - 1.0) < 0.01);   // R3 unchanged without the override
    }
    {  // R9: absolute lane + override: the lane wins
      const double o = lauf(bkt::G_T, 0.5f, {{0, absolut_flach}}, 0.8f, N1), a1 = lauf(GR, 0.5f, {{0, absolut_flach}}, 0.8f, N1), a2 = lauf(GR, 0.5f, {{0, absolut_flach}}, 0.8f, N2);
      const double s1 = lauf(GR, 0.5f, {{0, STUFE}}, 0.8f, N1), s2 = lauf(GR, 0.5f, {{0, STUFE}}, 0.8f, N2);
      std::printf("R9: absolute lane 0.4, override 0.8: block loop %.4f, notes %.4f %.4f; stepped lane 0.2 -> 1.0 with override: notes %.4f %.4f\n", o, a1, a2, s1, s2);
      PRUEF(std::fabs(o - 0.4) < 0.4 * 0.01);
      PRUEF(std::fabs(a1 - 0.4) < 0.4 * 0.01 && std::fabs(a2 - 0.4) < 0.4 * 0.01);
      PRUEF(std::fabs(s1 - 0.2) < 0.2 * 0.01 && std::fabs(s2 - 1.0) < 0.01);
    }
    {  // R10: no lane: the turned track knob and a live override
      const double o_k = lauf(bkt::G_T, 0.3f, {}, -1.0f, N2), g_k = lauf(GR, 0.3f, {}, -1.0f, N2);
      const double o_u = lauf(bkt::G_T, 0.5f, {}, 0.8f, N2), g_u = lauf(GR, 0.5f, {}, 0.8f, N2), g_u1 = lauf(GR, 0.5f, {}, 0.8f, N1);
      std::printf("R10: no lane: track knob 0.3: block loop %.4f, note %.4f; override 0.8 over knob 0.5: block loop %.4f, notes %.4f %.4f\n", o_k, g_k, o_u, g_u1, g_u);
      PRUEF(std::fabs(o_k - 0.3) < 0.3 * 0.01 && std::fabs(g_k - 0.3) < 0.3 * 0.01);
      PRUEF(std::fabs(o_u - 0.8) < 0.8 * 0.01 && std::fabs(g_u - 0.8) < 0.8 * 0.01 && std::fabs(g_u1 - 0.8) < 0.8 * 0.01);
    }
  }
  PRUEF_ENDE();
}
