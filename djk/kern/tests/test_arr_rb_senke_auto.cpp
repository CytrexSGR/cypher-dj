// Automation slice 2, task 4 (E9): the `geraet` lanes drive the parameters of the internal RB-338 through ArrRbSenke.
// The sink logs the last 64 calls it made to cypher_rb_setze (and cypher_rb_vorgaben as "<vorgaben>") in a fixed ring; the test reads it through the
// friend struct ArrRbPruefZugang. Blocks of 256, track 1 internal, base values in the playback: cutoff 0.4, resonanz 0.5.
//   1. start block: vorgaben -> base values -> lane value, in this order, the lane value is the last cutoff set in the block (mutation
//      ARR_RB_LANE_VOR_VORGABE applies the lane BEFORE the defaults and goes red here).
//   2. an unchanged lane value is not set twice (constant lane: nothing in the blocks after the start block); a ramp is set once per block, rising.
//   3. a second start with the same constant lane applies it again (the stop had put the base value back).
//   4. the lane deleted by a snapshot swap while playing sets the BASE value once (playback value 0.4); a swap that also drops the playback value sets
//      the RB default 0.62565 as the last cutoff; a stop sets the base value once, in the block after the one that held the stop.
//   5. all four parameters reach cypher_rb_setze under their own name (index 0..3 -> lautstaerke, cutoff, resonanz, env_mod), rc 0 for each name straight
//      at the FFI and no rejection in the sink; negative control: an unknown name is rejected (rc != 0).
//   6. the RB default table of the sink equals the FFI's own defaults: set to the table, the audio equals the audio after cypher_rb_vorgaben.
//   8. fix round 1, finding 1: a double swap in one cycle (internal -> empty -> internal, both before the same block) keeps the lane value that block
//      reports: cutoff 0.2 is set in the same block. Controls: a single swap to a playback with the same lane sets nothing; internal -> empty (a block
//      without any lane set, no stray base value) -> back later sets the lane value in the block of the return.
//   9. fix round 1, finding 2: lanes on tracks 2, 11 and 32 (index 1, 10, 31), one parameter each, arrive as exactly (1, lautstaerke), (10, cutoff),
//      (31, env_mod). Mutation ARR_RB_SPUR_NULL (the sink files every value under index 0) goes red.
//   7. glide lag on the audio (print only, no gate except the direction): a held RB note, cutoff lane step 0.2 -> 0.8; the spectral centroid (bins of a Hann-windowed 256 DFT) per block of 256 rises; the samples until it is within 5 % of its final value go to stdout as numbers and CSV.
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/arr_rb_senke.h"
#include "cypherdj/cypher_rb_ffi.h"
#include <cypherdj/dsp/denormal.h>
#include "pruef.h"

namespace cdj {
struct ArrRbPruefZugang {
  static uint64_t n(const ArrRbSenke& s) { return s.protokoll_n_; }
  static void eintrag(const ArrRbSenke& s, uint64_t i, int& spur, std::string& name, float& wert) {
    const ArrRbSenke::Protokoll& e = s.protokoll_[i % ArrRbSenke::PROTOKOLL_N];
    spur = e.spur;
    name = e.name;
    wert = e.wert;
  }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;

namespace {

constexpr float KONST = 0.2f;

ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }

struct Eintrag {
  std::string name;
  float wert;
  int spur;   // 0-based index of the track
};

void param(cdj::ArrSnapshot* s, int nr, const char* name, float wert) {
  cdj::ArrSpur& sp = s->spur[nr - 1];
  std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", name);
  sp.param[sp.n_param++].wert = wert;
}

// Track 1 internal with the playback values cutoff 0.4 / resonanz 0.5 (optional) and the given lanes (param index -> points)
cdj::ArrSnapshot* snapshot(int64_t nr, const std::vector<std::pair<int, std::vector<ArrAutoPunkt>>>& lanes, bool mit_grundwerten = true) {
  Bau b(nr);
  b.spur(1, ArrArt::intern);
  for (const auto& l : lanes) b.lane(1, l.second, cdj::ARR_AUTO_GERAET, static_cast<uint8_t>(l.first));
  cdj::ArrSnapshot* s = b.fertig();
  if (mit_grundwerten) {
    param(s, 1, "cutoff", 0.4f);
    param(s, 1, "resonanz", 0.5f);
  }
  return s;
}

struct Lauf {
  Treiber t;
  cdj::ArrRbSenke rb{t.arr};
  uint64_t gesehen = 0;
  int nur_spur = 0;   // every logged call must belong to this track index; -1: any
  Lauf() { t.arr.setze_senke_intern(&rb); }
  // one block of 256; returns the setze calls the sink made in it
  std::vector<Eintrag> block() {
    t.lauf(t.s + 256);
    std::vector<Eintrag> e;
    const uint64_t n = cdj::ArrRbPruefZugang::n(rb);
    PRUEF(n - gesehen <= 64);
    for (uint64_t i = gesehen; i < n; ++i) {
      int spur;
      Eintrag x;
      cdj::ArrRbPruefZugang::eintrag(rb, i, spur, x.name, x.wert);
      x.spur = spur;
      PRUEF(nur_spur < 0 || spur == nur_spur);
      e.push_back(x);
    }
    gesehen = n;
    return e;
  }
  void blocks(int n) {
    for (int i = 0; i < n; ++i) block();
  }
};

int index_von(const std::vector<Eintrag>& e, const char* name, int von = 0) {
  for (size_t i = static_cast<size_t>(von); i < e.size(); ++i)
    if (e[i].name == name) return static_cast<int>(i);
  return -1;
}
int zaehle(const std::vector<Eintrag>& e, const char* name) {
  int n = 0;
  for (const Eintrag& x : e) n += x.name == name ? 1 : 0;
  return n;
}
float letzter(const std::vector<Eintrag>& e, const char* name) {
  float w = -1.0f;
  for (const Eintrag& x : e)
    if (x.name == name) w = x.wert;
  return w;
}

constexpr std::pair<int, int> kein_lane = {0, 0};

// Run until the start block (the block with the start sample 793 in it) is done and return its log
std::vector<Eintrag> bis_start(Lauf& l) {
  l.t.arr.start(0.0, 0, false, l.t.s, 537, 256, l.t.k);
  std::vector<Eintrag> e;
  for (int i = 0; i < 4; ++i) e = l.block();   // blocks at s0 + 0, 256, 512, 768: the last one holds the start sample 793
  return e;
}

}  // namespace

int main() {
  {  // 1 + 2: start block order, no double set
    Lauf l;
    l.t.laden(snapshot(1, {{1, {P(0, KONST), P(100, KONST)}}}));
    const auto e = bis_start(l);
    int dump = 0;
    for (const Eintrag& x : e) std::printf("start block: %s %.5f\n", x.name.c_str(), x.wert), ++dump;
    const int v = index_von(e, "<vorgaben>"), c0 = index_von(e, "cutoff"), lane = index_von(e, "cutoff", c0 + 1);
    PRUEF(v == 0 && c0 > v);             // vorgaben, then the base value cutoff 0.4
    PRUEF_NAH(e[c0].wert, 0.4, 1e-6);
    PRUEF(lane > c0);                    // the lane value comes after the base value
    PRUEF_NAH(letzter(e, "cutoff"), KONST, 1e-6);   // and is the last word on the cutoff in the start block
    PRUEF(index_von(e, "resonanz") > v && index_von(e, "resonanz") < lane);   // the other base value is also before the lane value
    for (int i = 0; i < 6; ++i) PRUEF(l.block().empty());   // 2: a constant lane is not set again
    PRUEF(l.rb.parameter_abgelehnt() == 0 && l.rb.verloren() == 0);
    PRUEF(dump > 0);
  }
  {  // 2b: a ramp changes every block, one set each, rising (control: an unchanged value is skipped, a changing one is not)
    Lauf l;
    l.t.laden(snapshot(1, {{1, {P(0, 0.1f), P(8, 0.9f)}}}));
    bis_start(l);
    float vorher = -1.0f;
    for (int i = 0; i < 6; ++i) {
      const auto e = l.block();
      PRUEF(zaehle(e, "cutoff") == 1 && e.size() == 1);
      if (!e.empty()) {
        PRUEF(e[0].wert > vorher);
        vorher = e[0].wert;
      }
    }
    PRUEF(vorher > 0.1f);
  }
  {  // 3 + 4: stop sets the base value once, a second start applies the lane again
    Lauf l;
    l.t.laden(snapshot(1, {{1, {P(0, KONST), P(100, KONST)}}}));
    bis_start(l);
    l.blocks(2);
    l.t.arr.stopp(0, l.t.s + 100, l.t.k);
    const auto stopp_block = l.block();   // holds the stop: the lane value is still the same, nothing to set
    PRUEF(stopp_block.empty());
    const auto danach = l.block();        // the block after the stop: no lane value -> the base value, once
    PRUEF(danach.size() == 1 && zaehle(danach, "cutoff") == 1);
    if (!danach.empty()) PRUEF_NAH(danach[0].wert, 0.4, 1e-6);
    for (int i = 0; i < 4; ++i) PRUEF(l.block().empty());   // and not again
    // second start: same constant lane, applied again after the defaults
    l.t.arr.start(0.0, 0, false, l.t.s, 537, 256, l.t.k);
    std::vector<Eintrag> e;
    for (int i = 0; i < 4; ++i) e = l.block();
    PRUEF(index_von(e, "<vorgaben>") == 0);
    PRUEF_NAH(letzter(e, "cutoff"), KONST, 1e-6);
    PRUEF(index_von(e, "cutoff", index_von(e, "cutoff") + 1) > 0);
    PRUEF(l.rb.parameter_abgelehnt() == 0);
  }
  {  // 4b: the lane deleted by a swap while playing: the base value once
    Lauf l;
    l.t.laden(snapshot(1, {{1, {P(0, KONST), P(100, KONST)}}}));
    bis_start(l);
    l.blocks(2);
    l.t.laden(snapshot(2, {}));   // same playback values, no lane
    const auto e = l.block();
    PRUEF(e.size() == 1 && zaehle(e, "cutoff") == 1);
    if (!e.empty()) PRUEF_NAH(e[0].wert, 0.4, 1e-6);
    for (int i = 0; i < 4; ++i) PRUEF(l.block().empty());
    // 4c: a swap that drops the playback value too: the RB default is the last word
    Lauf m;
    m.t.laden(snapshot(1, {{1, {P(0, KONST), P(100, KONST)}}}));
    bis_start(m);
    m.blocks(2);
    m.t.laden(snapshot(2, {}, false));
    const auto f = m.block();
    PRUEF_NAH(letzter(f, "cutoff"), 0.62565, 1e-6);
    for (int i = 0; i < 4; ++i) PRUEF(m.block().empty());
  }
  {  // 5: all four parameters under their own name
    Lauf l;
    l.t.laden(snapshot(1, {{0, {P(0, 0.11f), P(100, 0.11f)}}, {1, {P(0, 0.22f), P(100, 0.22f)}}, {2, {P(0, 0.33f), P(100, 0.33f)}}, {3, {P(0, 0.44f), P(100, 0.44f)}}},
                       false));
    const auto e = bis_start(l);
    PRUEF_NAH(letzter(e, "lautstaerke"), 0.11, 1e-6);
    PRUEF_NAH(letzter(e, "cutoff"), 0.22, 1e-6);
    PRUEF_NAH(letzter(e, "resonanz"), 0.33, 1e-6);
    PRUEF_NAH(letzter(e, "env_mod"), 0.44, 1e-6);
    PRUEF(l.rb.parameter_abgelehnt() == 0);
    // rc straight at the FFI for each name of the table, and the negative control
    CypherRb* h = cypher_rb_neu(48000.0);
    for (int i = 0; i < 4; ++i) {
      const int32_t rc = cypher_rb_setze(h, cdj::ARR_GERAET_PARAM_NAME[i], 0.5f);
      std::printf("cypher_rb_setze(\"%s\") rc %d\n", cdj::ARR_GERAET_PARAM_NAME[i], rc);
      PRUEF(rc == 0);
    }
    PRUEF(cypher_rb_setze(h, "cutoff_gibt_es_nicht", 0.5f) != 0);
    cypher_rb_frei(h);
  }
  {  // 6: the default table of the sink = the defaults of the FFI (audio of both instances, the same held note)
    auto spiel = [](bool tabelle) {
      CypherRb* h = cypher_rb_neu(48000.0);
      if (tabelle) {
        cypher_rb_setze(h, "lautstaerke", 0.71034f);
        cypher_rb_setze(h, "cutoff", 0.62565f);
        cypher_rb_setze(h, "resonanz", 0.3f);
        cypher_rb_setze(h, "env_mod", 0.4f);
      } else {
        cypher_rb_vorgaben(h);
      }
      cypher_rb_note_an(h, 0, 48, 100);
      std::vector<float> l(256), r(256), alle;
      for (int i = 0; i < 40; ++i) {
        cypherdj::dsp::DenormalSchutz schutz;
        cypher_rb_block(h, l.data(), r.data(), 256);
        alle.insert(alle.end(), l.begin(), l.end());
      }
      cypher_rb_frei(h);
      return alle;
    };
    const auto a = spiel(true), b = spiel(false);
    double d = 0.0, e = 0.0;
    for (size_t i = 0; i < a.size(); ++i) {
      d = std::max(d, std::fabs(static_cast<double>(a[i]) - b[i]));
      e = std::max(e, static_cast<double>(std::fabs(b[i])));
    }
    std::printf("default table vs cypher_rb_vorgaben: max diff %.3g of peak %.3g\n", d, e);
    PRUEF(e > 0.01);          // the note really sounds
    PRUEF(d <= 1e-3 * e);     // same defaults (the physical value differs only in float rounding)
  }
  {  // 8: double swap in one cycle (finding 1) and its controls
    auto lane_snap = [](int64_t nr) { return snapshot(nr, {{1, {P(0, KONST), P(100, KONST)}}}); };
    {  // internal -> empty -> internal before the same block: the lane value of that block must be set in it
      Lauf l;
      l.t.laden(lane_snap(1));
      bis_start(l);
      l.blocks(2);
      l.t.laden(Bau(2).fertig());   // empty
      l.t.laden(lane_snap(3));      // and back, no block in between
      const auto e = l.block();
      for (const Eintrag& x : e) std::printf("double swap block: %s %.5f\n", x.name.c_str(), x.wert);
      PRUEF(index_von(e, "<vorgaben>") >= 0);          // the playback values were set anew (n_param -1)
      PRUEF_NAH(letzter(e, "cutoff"), KONST, 1e-6);    // and the lane value follows in the same block, after the defaults
      PRUEF(index_von(e, "cutoff", index_von(e, "<vorgaben>")) > index_von(e, "<vorgaben>"));
      for (int i = 0; i < 3; ++i) PRUEF(l.block().empty());   // then quiet again: it is applied once
    }
    {  // control 1: a single swap to a playback with the same lane changes nothing (the value is unchanged and applied)
      Lauf l;
      l.t.laden(lane_snap(1));
      bis_start(l);
      l.blocks(2);
      l.t.laden(lane_snap(2));
      PRUEF(l.block().empty());
    }
    {  // control 2: internal -> empty (one block without lane sets) -> later back: the lane value comes in the block of the return
      Lauf l;
      l.t.laden(lane_snap(1));
      bis_start(l);
      l.blocks(2);
      l.t.laden(Bau(2).fertig());
      const auto weg = l.block();
      PRUEF(zaehle(weg, "cutoff") == 0);   // the track left the sink: no stray base value
      l.blocks(2);
      l.t.laden(lane_snap(3));
      const auto zurueck = l.block();
      PRUEF_NAH(letzter(zurueck, "cutoff"), KONST, 1e-6);
      PRUEF(l.rb.parameter_abgelehnt() == 0);
    }
  }
  {  // 9: the track index reaches the log: tracks 2, 11, 32 = index 1, 10, 31
    Lauf l;
    l.nur_spur = -1;
    Bau b(1);
    b.spur(2, ArrArt::intern).spur(11, ArrArt::intern).spur(32, ArrArt::intern);
    b.lane(2, {P(0, 0.11f), P(100, 0.11f)}, cdj::ARR_AUTO_GERAET, 0);
    b.lane(11, {P(0, 0.22f), P(100, 0.22f)}, cdj::ARR_AUTO_GERAET, 1);
    b.lane(32, {P(0, 0.44f), P(100, 0.44f)}, cdj::ARR_AUTO_GERAET, 3);
    l.t.laden(b.fertig());
    const auto e = bis_start(l);
    std::vector<Eintrag> sets;
    for (const Eintrag& x : e)
      if (x.name != "<vorgaben>") sets.push_back(x);
    PRUEF(sets.size() == 3);
    if (sets.size() == 3) {
      // order of the sink: by track index
      PRUEF(sets[0].spur == 1 && sets[0].name == "lautstaerke");
      PRUEF(sets[1].spur == 10 && sets[1].name == "cutoff");
      PRUEF(sets[2].spur == 31 && sets[2].name == "env_mod");
      PRUEF_NAH(sets[0].wert, 0.11, 1e-6);
      PRUEF_NAH(sets[1].wert, 0.22, 1e-6);
      PRUEF_NAH(sets[2].wert, 0.44, 1e-6);
    }
    for (const Eintrag& x : sets) std::printf("track index %d: %s %.5f\n", x.spur, x.name.c_str(), x.wert);
  }
  {  // 7: glide lag on the audio, print only (direction gated)
    // A: the lane steps 0.2 -> 0.8 at beat 2. C and B: the same run with the constant lane 0.2 / 0.8. The three runs share the oscillator phase (same
    // start, same note), so per block of 256 the progress m = <A - C, B - C> / <B - C, B - C> is 0 while A equals C and 1 when A has reached B, without
    // the phase noise a spectral measure of a held saw has in blocks this short.
    constexpr double SPRUNG_BEAT = 2.0;
    auto spiel = [&](const std::vector<ArrAutoPunkt>& punkte, int64_t& einsatz) {
      Lauf l;
      Bau b(1);
      b.spur(1, ArrArt::intern).note(1, "a/n1", 0.0, 6.0, 48, 100);
      b.lane(1, punkte, cdj::ARR_AUTO_GERAET, 1);
      cdj::ArrSnapshot* s = b.fertig();
      param(s, 1, "env_mod", 0.0f);   // no filter envelope: the cutoff moves only by the lane
      param(s, 1, "resonanz", 0.0f);
      l.t.laden(s);
      l.t.arr.start(0.0, 0, false, l.t.s, 537, 256, l.t.k);
      l.t.lauf(256 * 360);   // 92160 samples, the jump is at 793 + 45000
      einsatz = l.t.arr.zustand(l.t.k, l.t.s).ursprung_sample;
      return l.t.l;
    };
    int64_t einsatz = 0;
    const auto A = spiel({P(0, 0.2f), P(SPRUNG_BEAT, 0.8f, 2)}, einsatz);
    const auto C = spiel({P(0, 0.2f), P(100, 0.2f)}, einsatz);
    const auto B = spiel({P(0, 0.8f), P(100, 0.8f)}, einsatz);
    const int64_t sprung = einsatz + static_cast<int64_t>(SPRUNG_BEAT * SPB);
    std::vector<double> m;
    for (size_t s0 = 0; s0 + 256 <= A.size(); s0 += 256) {
      double ab = 0.0, bb = 0.0;
      for (size_t i = s0; i < s0 + 256; ++i) {
        const double bc = static_cast<double>(B[i]) - C[i];
        ab += (static_cast<double>(A[i]) - C[i]) * bc;
        bb += bc * bc;
      }
      m.push_back(bb > 1e-18 ? ab / bb : 0.0);
    }
    const size_t kb = static_cast<size_t>(sprung / 256);   // block that holds the jump sample (and, with the lane value at its last sample, the new cutoff)
    size_t ersten = 0;
    for (size_t k = kb; k < m.size(); ++k)
      if (std::fabs(m[k] - 1.0) <= 0.05) {
        ersten = k;
        break;
      }
    std::printf("glide lag: jump sample %lld (block %zu), progress before %.4f, final %.4f\n", static_cast<long long>(sprung), kb, m[kb - 2], m.back());
    if (ersten) {
      std::printf("glide lag: first block within 5 %% of final: block %zu (%zu blocks after the jump block), %lld samples from the jump sample to its end, %lld to its start\n",
                  ersten, ersten - kb, static_cast<long long>(static_cast<int64_t>(ersten + 1) * 256 - sprung),
                  static_cast<long long>(static_cast<int64_t>(ersten) * 256 - sprung));
    }
    std::printf("CSV block,start_sample,progress\n");
    for (size_t k = kb - 2; k < kb + 14 && k < m.size(); ++k) std::printf("CSV %zu,%zu,%.5f\n", k, k * 256, m[k]);
    PRUEF(std::fabs(m[kb - 2]) < 0.01);   // before the jump A is C (the lane step is not early)
    PRUEF(m.back() > 0.95 && m.back() < 1.05);   // the cutoff opened: A ends where B is
    PRUEF(m[kb + 2] > 0.3);               // direction: within three blocks after the jump the sound has moved most of the way toward B (not monotone before: the projection of a mid cutoff is not linear)
    PRUEF(ersten != 0);
  }
  PRUEF_ENDE();
}
