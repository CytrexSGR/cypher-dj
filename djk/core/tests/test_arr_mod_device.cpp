// Strand 6 task 1.4 (plan 2026-11-27, D1, D3, D6): modulators on device knobs (`geraet.*`: the Baukasten knobs k1..k64, the RB-338 parameters), once per block through
// ArrSenke::mod_summand, handed by Arrangement::mod_planen before bk_ueber_melden and auto_geraet. The sink adds the offset after its whole stack (snapshot knob or reported value,
// plus a relative summand) and clamps to 0..1.
//   G1 fake sink     one mod_summand per block and (track, knob), before block() of that block, with the offsets of every modulator on it summed: tiefe * sin(2 pi (beat / takt + phase))
//                    at the beat of the block's last sample (the project beat while playing, the tempo-map beat while stopped, so the calls run while the transport stands too);
//                    a unipolar target gets tiefe * (out + 1) / 2; no call for a track without a modulator; no sink: nothing happens (no crash)
//   G2 bk sink       the graph G_T plays saw * gate * k1, so the level of a held note is proportional to the knob. A square LFO (takt 8: +1 in beats [0, 4), -1 in [4, 8)): the level
//                    follows clamp(base + offset) within 4 % for the snapshot knob, an absolute lane (the path of a reported controller value, spur/<slot>/bk/<k>), a relative lane
//                    alone, and the clamp at 1 and at 0
//   G3 bk stopped    a note sent straight to the sink while the transport stands: the knob still swings with the tempo-map beat
//   G4 RB sink       the cutoff the sink sets is clamp(base + offset): playback base 0.4, an absolute lane, the clamp at 0; a swap that drops the modulator puts the base value back
//   G5 no allocation 2000 blocks with a modulator on a bk knob and a swap: 0 allocations (positive control: the counter sees one)
#include <algorithm>
#include <cmath>
#include <cstdio>
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

namespace cdj {
struct ArrRbPruefZugang {
  static uint64_t n(const ArrRbSenke& s) { return s.protokoll_n_; }
  static void eintrag(const ArrRbSenke& s, uint64_t i, int& spur, std::string& name, float& wert) {
    const ArrRbSenke::Protokoll* e = s.protokoll_lies(i);
    spur = e ? e->spur : -1;
    name = e ? e->name : "";
    wert = e ? e->wert : 0.0f;
  }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;

namespace {
constexpr double PI2 = 6.283185307179586;
constexpr uint8_t GER = cdj::ARR_AUTO_GERAET;
using Punkte = std::vector<cdj::ArrAutoPunkt>;

cdj::ArrModZiel knopf_ziel(int spur0, int param, float tiefe, bool uni = false) {
  cdj::ArrModZiel z{};
  z.art = 1;
  z.slot = static_cast<int16_t>(spur0);
  z.param = static_cast<uint8_t>(param);
  z.tiefe = tiefe;
  z.uni = uni;
  return z;
}
cdj::ArrMod lfo(int nr, int form, double takt, std::vector<cdj::ArrModZiel> ziele, double phase = 0.0) {
  cdj::ArrMod md{};
  md.nr = static_cast<uint8_t>(nr);
  md.form = static_cast<uint8_t>(form);
  md.takt = takt;
  md.phase = phase;
  md.glatt_ms = 1.0f;
  md.saat = 2166136261u;
  for (const cdj::ArrModZiel& z : ziele) md.z[md.n++] = z;
  return md;
}
cdj::ArrSnapshot* mit_mods(cdj::ArrSnapshot* s, const std::vector<cdj::ArrMod>& mods) {
  for (const cdj::ArrMod& md : mods) s->mod[s->n_mod++] = md;   // geraet targets only: no fader/pan buffers
  return s;
}

// G1: records the summand handed before each block()
struct FakeSenke final : cdj::ArrSenke {
  struct Eintrag {
    int64_t s0;
    int spur, param;
    float delta;
  };
  std::vector<Eintrag> log;
  float wartend[cdj::ARR_SPUREN][cdj::BK_KNOEPFE] = {};
  int n_wartend[cdj::ARR_SPUREN][cdj::BK_KNOEPFE] = {};   // calls since the last block() of the track
  bool doppelt = false;
  FakeSenke() { log.reserve(4096); }
  int64_t vorhalt() const noexcept override { return 0; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override {}
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void mod_summand(int spur, int param, float delta) noexcept override {
    if (spur < 0 || spur >= cdj::ARR_SPUREN || param < 0 || param >= cdj::BK_KNOEPFE) return;
    wartend[spur][param] = delta;
    if (++n_wartend[spur][param] > 1) doppelt = true;
  }
  void block(int spur, int64_t s0, int, float*, float*) noexcept override {
    for (int p = 0; p < cdj::BK_KNOEPFE; ++p)
      if (n_wartend[spur][p] > 0) {
        log.push_back(Eintrag{s0, spur, p, wartend[spur][p]});
        n_wartend[spur][p] = 0;
      }
  }
};

void fake_senke() {
  Treiber t;   // 128 BPM, SPB samples per beat, the tempo map starts at sample 0
  FakeSenke fk;
  t.arr.setze_senke_intern(&fk);
  Bau b(1);
  b.spur(1, ArrArt::intern).spur(2, ArrArt::intern);
  cdj::ArrSnapshot* s = b.fertig();
  mit_mods(s, {lfo(1, 0, 4.0, {knopf_ziel(0, 2, 0.25f), knopf_ziel(0, 5, 0.4f, true)}), lfo(2, 0, 4.0, {knopf_ziel(0, 2, 0.1f)}, 0.25)});
  t.laden(s);
  t.lauf(8 * 256);   // stopped: 8 blocks
  const size_t n_steht = fk.log.size();
  PRUEF(t.arr.start(0.0, 0, false, t.s, 537, 256, t.k));
  const int64_t start_s = t.arr.zustand(t.k, t.s).ursprung_sample;
  t.lauf(t.s + 4 * SPB);
  PRUEF(!fk.doppelt);
  int n2 = 0, n5 = 0, n_lauf = 0, falsche_spur = 0;
  double max_ab = 0.0;
  for (size_t i = 0; i < fk.log.size(); ++i) {
    const FakeSenke::Eintrag& e = fk.log[i];
    if (e.spur != 0) {
      ++falsche_spur;
      continue;
    }
    const int64_t letzt = e.s0 + 255;
    const bool laeuft = e.s0 >= start_s;   // the whole block runs (the start lies inside the block before)
    if (!laeuft && letzt >= start_s) continue;   // the start block: half stopped, half running
    const double beat = laeuft ? static_cast<double>(letzt - start_s) / static_cast<double>(SPB) : static_cast<double>(letzt) / static_cast<double>(SPB);
    double soll;
    if (e.param == 2) {
      soll = 0.25 * std::sin(PI2 * beat / 4.0) + 0.1 * std::sin(PI2 * (beat / 4.0 + 0.25));
      ++n2;
    } else if (e.param == 5) {
      soll = 0.4 * (std::sin(PI2 * beat / 4.0) + 1.0) / 2.0;
      ++n5;
    } else {
      soll = 1e9;   // no other knob gets a call
    }
    if (laeuft) ++n_lauf;
    max_ab = std::max(max_ab, std::fabs(static_cast<double>(e.delta) - soll));
  }
  std::printf("G1: %zu calls while stopped, %d while running; k3 %d, k6 %d; largest deviation from the summed offsets %.2e\n", n_steht, n_lauf, n2, n5, max_ab);
  PRUEF(n_steht == 16);   // 8 blocks, two knobs, one call each: the modulators run while the transport stands (D4)
  PRUEF(n2 > 100 && n5 == n2);
  PRUEF(n_lauf > 100);
  PRUEF(falsche_spur == 0);   // track 2 has no modulator: no call
  PRUEF(max_ab < 2e-5);
  // without a sink nothing happens
  t.arr.setze_senke_intern(nullptr);
  t.lauf(t.s + 4 * 256);
  t.arr.setze_senke_intern(&fk);
  t.lauf(t.s + 256);
  t.arr.setze_senke_intern(nullptr);
}

// G2 / G5: a held note on track 1 (bk, G_T)
struct Sinken {
  cdj::ArrRbSenke rb;
  std::unique_ptr<cdj::ArrBkSenke> bk_h;
  cdj::ArrBkSenke& bk;
  cdj::ArrKitSenke kit;
  cdj::ArrInternSenke intern;
  explicit Sinken(cdj::Arrangement& a) : rb(a), bk_h(std::make_unique<cdj::ArrBkSenke>(a)), bk(*bk_h), kit(a), intern(a, &rb, &bk, &kit) { a.setze_senke_intern(&intern); }
};
double rms(const std::vector<float>& v, int64_t von, int64_t bis) {
  double q = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(v.size()); ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}
struct Bahn {
  int knopf;
  Punkte p;
  bool relativ = false;
};
std::vector<float> spiele(float k1, const std::vector<Bahn>& lanen, const std::vector<cdj::ArrMod>& mods, double beats) {
  Treiber t;
  Sinken sk(t.arr);
  CypherBk* h = bkt::neu(bkt::G_T);
  Bau b;
  b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 64.0, 45, 127);
  for (const Bahn& x : lanen) b.lane(1, x.p, GER, static_cast<uint8_t>(x.knopf), x.relativ);
  cdj::ArrSnapshot* s = b.fertig();
  bkt::spur(s, 1, h, 1, {{"k1", k1}});
  mit_mods(s, mods);
  t.laden(s);
  t.arr.start(0.0, 0, false, t.s, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(beats * static_cast<double>(SPB)) + 537 + 256);
  PRUEF(sk.bk.verloren() == 0);
  t.arr.setze_senke_intern(nullptr);
  cypher_bk_frei(h);
  return t.l;
}
double pegel(const std::vector<float>& l, double beat) {
  const int64_t mitte = 537 + 256 + static_cast<int64_t>(beat * static_cast<double>(SPB));
  return rms(l, mitte - 2048, mitte + 2048);
}
// square, takt 8: +1 in beats [0, 4), -1 in [4, 8)
cdj::ArrMod rechteck(float tiefe) { return lfo(1, 3, 8.0, {knopf_ziel(0, 0, tiefe)}); }

double abweichung(const std::vector<float>& ref, const std::vector<float>& mit, double base, double tiefe, const char* was) {
  double schlimmster = 0.0;
  for (double b : {1.0, 3.0, 5.0, 7.0}) {
    const double soll = std::clamp(base + (b < 4.0 ? tiefe : -tiefe), 0.0, 1.0);
    const double ist = pegel(mit, b) / pegel(ref, b);
    schlimmster = std::max(schlimmster, soll < 1e-6 ? ist : std::fabs(ist - soll) / soll);   // a knob at 0: the level itself must be ~0
  }
  std::printf("G2: %s: worst deviation of the level from clamp(base + offset) %.4f\n", was, schlimmster);
  return schlimmster;
}

void bk_senke() {
  const std::vector<float> ref = spiele(1.0f, {}, {}, 8.0);
  PRUEF(rms(ref, 4096, 8192) > 1e-3);
  PRUEF(abweichung(ref, spiele(0.5f, {}, {rechteck(0.3f)}, 8.0), 0.5, 0.3, "snapshot knob 0.5, depth 0.3") < 0.04);
  PRUEF(abweichung(ref, spiele(0.8f, {}, {rechteck(0.4f)}, 8.0), 0.8, 0.4, "snapshot knob 0.8, depth 0.4 (clamp at 1)") < 0.04);
  PRUEF(abweichung(ref, spiele(0.1f, {}, {rechteck(0.4f)}, 8.0), 0.1, 0.4, "snapshot knob 0.1, depth 0.4 (clamp at 0)") < 0.04);
  PRUEF(abweichung(ref, spiele(0.9f, {{0, {{0.0, 0.3f, 0}, {64.0, 0.3f, 0}}}}, {rechteck(0.2f)}, 8.0), 0.3, 0.2, "absolute lane 0.3 (snapshot 0.9), depth 0.2") < 0.04);
  PRUEF(abweichung(ref, spiele(0.6f, {{0, {{0.0, -0.2f, 0}, {64.0, -0.2f, 0}}, true}}, {rechteck(0.2f)}, 8.0), 0.4, 0.2, "relative lane -0.2 on 0.6, depth 0.2") < 0.04);
  // negative control: the modulator on k2 (the graph reads k1) leaves the level alone
  const std::vector<float> k2 = spiele(0.5f, {}, {lfo(1, 3, 8.0, {knopf_ziel(0, 1, 0.3f)})}, 8.0);
  PRUEF(abweichung(ref, k2, 0.5, 0.0, "modulator on k2 (control)") < 0.04);
}

void bk_steht() {   // G3
  std::vector<float> stufen[2];
  for (int mit = 0; mit < 2; ++mit) {
    Treiber u;
    Sinken su(u.arr);
    CypherBk* h = bkt::neu(bkt::G_T);
    Bau b;
    b.spur(1, ArrArt::intern);
    cdj::ArrSnapshot* s = b.fertig();
    bkt::spur(s, 1, h, 1, {{"k1", 0.5f}});
    if (mit == 1) mit_mods(s, {rechteck(0.3f)});
    u.laden(s);
    u.lauf(256);
    su.intern.note(0, u.s, 45, 127, true);   // a live note while the transport stands
    u.lauf(8 * SPB + 4096);
    stufen[mit] = u.l;
    u.arr.setze_senke_intern(nullptr);
    cypher_bk_frei(h);
  }
  double schlimmster = 0.0;
  for (double b : {1.0, 3.0, 5.0, 7.0}) {
    const int64_t mitte = static_cast<int64_t>(b * static_cast<double>(SPB));
    const double ist = rms(stufen[1], mitte - 2048, mitte + 2048) / rms(stufen[0], mitte - 2048, mitte + 2048);
    const double soll = (0.5 + (b < 4.0 ? 0.3 : -0.3)) / 0.5;
    schlimmster = std::max(schlimmster, std::fabs(ist - soll) / soll);
  }
  std::printf("G3: transport stopped, worst deviation of the level ratio from (0.5 + offset) / 0.5: %.4f (level without modulator %.4f)\n", schlimmster,
              rms(stufen[0], SPB - 2048, SPB + 2048));
  PRUEF(rms(stufen[0], SPB - 2048, SPB + 2048) > 1e-3);
  PRUEF(schlimmster < 0.04);
}

// G4: the RB sink
struct RbLauf {
  Treiber t;
  cdj::ArrRbSenke rb{t.arr};
  uint64_t gesehen = 0;
  RbLauf() { t.arr.setze_senke_intern(&rb); }
  ~RbLauf() { t.arr.setze_senke_intern(nullptr); }
  float letzter_cutoff() {   // the last cutoff set since the last call, -1: none
    const uint64_t n = cdj::ArrRbPruefZugang::n(rb);
    float w = -1.0f;
    for (uint64_t i = gesehen; i < n; ++i) {
      int spur;
      std::string name;
      float x;
      cdj::ArrRbPruefZugang::eintrag(rb, i, spur, name, x);
      if (name == "cutoff") w = x;
    }
    gesehen = n;
    return w;
  }
};
cdj::ArrSnapshot* rb_snap(int64_t nr, bool mit_mod, const Punkte& lane = {}) {
  Bau b(nr);
  b.spur(1, ArrArt::intern);
  if (!lane.empty()) b.lane(1, lane, GER, 1);
  cdj::ArrSnapshot* s = b.fertig();
  cdj::ArrSpur& sp = s->spur[0];
  std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", "cutoff");
  sp.param[sp.n_param++].wert = 0.4f;
  if (mit_mod) mit_mods(s, {lfo(1, 3, 8.0, {knopf_ziel(0, 1, 0.3f)})});
  return s;
}
// the cutoff in force at beat b after the start: the last one the sink set up to there (an unchanged value is not set again)
float cutoff_bei(RbLauf& l, int64_t start_s, double b, float& zuletzt) {
  while (l.t.s < start_s + static_cast<int64_t>(b * static_cast<double>(SPB))) {
    l.t.lauf(l.t.s + 256);
    const float x = l.letzter_cutoff();
    if (x >= 0.0f) zuletzt = x;
  }
  return zuletzt;
}

void rb_senke() {
  {
    RbLauf l;
    l.t.laden(rb_snap(1, true));
    l.t.lauf(4 * 256);
    float zuletzt = l.letzter_cutoff();
    const float steht = zuletzt;
    PRUEF(l.t.arr.start(0.0, 0, false, l.t.s, 537, 256, l.t.k));
    const int64_t s0 = l.t.arr.zustand(l.t.k, l.t.s).ursprung_sample;
    const float a = cutoff_bei(l, s0, 2.0, zuletzt), c = cutoff_bei(l, s0, 6.0, zuletzt);
    std::printf("G4: RB cutoff while stopped %.4f, beat 2 %.4f (0.4 + 0.3), beat 6 %.4f (0.4 - 0.3)\n", steht, a, c);
    PRUEF(steht >= 0.0f);   // set while the transport stands too
    PRUEF_NAH(a, 0.7, 1e-5);
    PRUEF_NAH(c, 0.1, 1e-5);
    l.t.laden(rb_snap(2, false));   // the modulator goes: the base value comes back once
    l.t.lauf(l.t.s + 2 * 256);
    const float zurueck = l.letzter_cutoff();
    l.t.lauf(l.t.s + 4 * 256);
    std::printf("G4: after the swap without the modulator %.4f (base 0.4)\n", zurueck);
    PRUEF_NAH(zurueck, 0.4, 1e-6);
    PRUEF(l.letzter_cutoff() < 0.0f);   // and nothing more after that
    PRUEF(l.rb.parameter_abgelehnt() == 0);
  }
  {  // an absolute lane 0.2 plus the modulator: 0.5 and clamp(-0.1) = 0
    RbLauf l;
    l.t.laden(rb_snap(1, true, {{0.0, 0.2f, 0}, {64.0, 0.2f, 0}}));
    PRUEF(l.t.arr.start(0.0, 0, false, l.t.s, 537, 256, l.t.k));
    const int64_t s0 = l.t.arr.zustand(l.t.k, l.t.s).ursprung_sample;
    float zuletzt = -1.0f;
    const float a = cutoff_bei(l, s0, 2.0, zuletzt), c = cutoff_bei(l, s0, 6.0, zuletzt);
    std::printf("G4: lane 0.2 + modulator: beat 2 %.4f (0.5), beat 6 %.4f (clamped at 0)\n", a, c);
    PRUEF_NAH(a, 0.5, 1e-5);
    PRUEF_NAH(c, 0.0, 1e-6);
  }
}

void ohne_allokation() {   // G5
  Treiber t;
  Sinken sk(t.arr);
  CypherBk* h = bkt::neu(bkt::G_T);
  auto snap = [&](int64_t nr, float tiefe) {
    Bau b(nr);
    b.spur(1, ArrArt::intern).note(1, "v/n1", 0.0, 64.0, 45, 127);
    cdj::ArrSnapshot* s = b.fertig();
    bkt::spur(s, 1, h, 1, {{"k1", 0.5f}});
    return mit_mods(s, {lfo(1, 0, 1.0, {knopf_ziel(0, 0, tiefe), knopf_ziel(0, 1, tiefe)})});
  };
  cdj::ArrSnapshot* s1 = snap(2, 0.4f);
  t.laden(snap(1, 0.2f));
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
  std::printf("G5: allocations in 2000 blocks = %ld\n", im_fenster);
  if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(im_fenster == 0);
  for (const cdj::ArrSnapshot* x : alt) delete x;
  t.arr.setze_senke_intern(nullptr);
  cypher_bk_frei(h);
  abfang_an();
  { std::vector<int> v(100); }
  const long positiv = abfang_aus();
  if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(positiv > 0);
}

}  // namespace

int main() {
  fake_senke();
  bk_senke();
  bk_steht();
  rb_senke();
  ohne_allokation();
  PRUEF_ENDE();
}
