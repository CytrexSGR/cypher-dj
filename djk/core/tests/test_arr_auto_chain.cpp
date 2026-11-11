// 1.12 slice 6: automation lanes on the parameters of an insert stage and on the macros of a rack (ArrKettenLane, Arrangement::auto_kette, ArrInserts::lane_stufe / lane_makro).
// A lane hands ONE value per block (the lane at the project beat of the last running sample) to ArrInserts, which lets it replace the row of the parameter, or the macro row, for that block.
// Track 1 carries a 1 kHz sine of 0.5 and a chain komp (stage 0), eq (stage 1); parameter indices as in the contract (komp schwelle = 1, ratio = 2; eq b1/gain = 6, b1/freq = 5).
// Cases:
//   K1 stage lane      a lane on eq b1/gain (0 dB at beat 0, 12 dB at beat 8, linear) drives the stage in the blocks of the playback: the value the module got follows the lane block by block, the row (-9 dB)
//                      is ignored while it plays; a parameter without a lane keeps its row (negative control); after the transport stops the row is back in the next block; audible: the sine gets louder
//   K2 neutral         a lane whose value equals the row value renders bit-equal to the same project without a lane; a project without lanes has n_klanes 0 and no lane drives anything
//   K3 macro lane      a lane on macro 1 drives the mapped komp threshold (-60 .. 0) through the macro, the macro row is ignored while the lane plays and is back when it ends
//   K4 one writer      a hand-built snapshot with a lane on a parameter that a rack macro maps: the macro wins (second line of defence behind the loader's refusal)
//   K5 other strips    stage lanes on a group chain, a return chain and the PM chain drive their stages (ownership by strip), a lane aimed at a stage another strip owns does nothing
//   K6 loader          chain_auto: a lane on a track, a group, a return and the PM loads and arrives as written (strip, stufe, param, makro, points); refusals with reason `format`: a stage not in the chain, the stage
//                      switch, the compressor key, a host stage, a parameter beyond the kind, a lane twice, a lane on a parameter a rack target maps, a macro lane without a rack, makro beyond 3, makro and stufe in one lane,
//                      a non-finite value, a macro value outside 0..1, falling beats, a bad form, /1 format; `zu_gross` beyond ARR_KLANES_MAX lanes; the negative control loads
//   K7 swap            a swap to a snapshot without the lane gives the parameter back to its row in the next block; a swap to one with another lane value takes the new one
//   K8 keine_allokation 2000 blocks with lanes on stages and a macro and two swaps: 0 allocations, locks and sleeps; positive control
// Mutation (CMakeLists.txt): ARR_KETTE_LANE_BLEIBT (K1, K3, K7): the values of the block before are not cleared.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;
using cdj::ArrInsArt;
using cdj::ArrMakroZiel;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
static std::string rk(int k, int n) { return "rack/" + std::to_string(k) + "/m" + std::to_string(n); }
static void laden_start(Treiber& t, cdj::ArrSnapshot* s) {
  t.laden(s);
  t.arr.start(0.0, 0, false, 0, V, 256, t.k);   // quant 0: at once (quant 2 would wait for the next bar line)
}
static double rms(const std::vector<float>& v, int64_t von, int64_t bis) {
  double q = 0.0;
  for (int64_t i = von; i < bis; ++i) q += static_cast<double>(v[i]) * v[i];
  return std::sqrt(q / static_cast<double>(bis - von));
}
static bool gleich_bits(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis) {
  return std::memcmp(a.data() + von, b.data() + von, sizeof(float) * static_cast<size_t>(bis - von)) == 0;
}

static const ArrStufe KOMP{ArrInsArt::komp, 0, true};
static const ArrStufe EQ{ArrInsArt::eq, 0, true};
static constexpr int P_SCHWELLE = 1, P_RATIO = 2, P_B1_GAIN = 6, P_B1_FREQ = 5;
static const int G_KOMP = cdj::ins_global(ArrInsArt::komp, 0), G_EQ = cdj::ins_global(ArrInsArt::eq, 0);
static ArrMakroZiel ziel(int makro, int stufe, int param, float von, float bis) {
  ArrMakroZiel z;
  z.makro = static_cast<uint8_t>(makro);
  z.stufe = static_cast<uint8_t>(stufe);
  z.param = static_cast<uint8_t>(param);
  z.von = von;
  z.bis = bis;
  return z;
}
static ArrAutoPunkt pt(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
static void stufen_an(Treiber& t) {
  setze(t, "ins/komp/1/an", 1.0f);
  setze(t, "ins/eq/1/an", 1.0f);
  setze(t, "ins/eq/1/b1/an", 1.0f);
  setze(t, "ins/eq/1/b1/typ", 0.0f);
  setze(t, "ins/eq/1/b1/freq", 1000.0f);
  setze(t, "ins/eq/1/b1/q", 4.0f);
}
// track 1: komp, eq; optional lane on eq b1/gain 0 -> 12 dB over beats 0..8
static cdj::ArrSnapshot* spur_lane(const cdj::ArrAudio* a, bool lane, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, a);
  b.kette(1, {KOMP, EQ});
  if (lane) b.kette_lane(0, 1, P_B1_GAIN, {pt(0.0, 0.0f), pt(8.0, 12.0f)});
  return b.fertig();
}
static constexpr double BEAT_S = 48000.0 * 60.0 / 128.0;   // 22500 samples per beat at 128 BPM

int main() {
  auto s1k = Audio::sinus(900000, 1000.0, 0.5f);

  {  // K1 stage lane
    TR(t)
    stufen_an(t);
    setze(t, "ins/eq/1/b1/gain", -9.0f);   // the row holds something else: the lane drives the parameter
    laden_start(t, spur_lane(&s1k->a, true));
    t.lauf(256 * 3);
    const float a0 = t.arr.inserts().wirksam(G_EQ, P_B1_GAIN);
    t.lauf(static_cast<int64_t>(4.0 * BEAT_S));   // about beat 4 (lauf takes an absolute sample)
    const float a4 = t.arr.inserts().wirksam(G_EQ, P_B1_GAIN);
    t.lauf(static_cast<int64_t>(9.0 * BEAT_S));   // about beat 9: past the last point
    const float a9 = t.arr.inserts().wirksam(G_EQ, P_B1_GAIN);
    const float a9b = t.arr.inserts().wirksam(G_EQ, P_B1_GAIN);
    std::printf("K1: eq b1/gain at the start %.3f, near beat 4 %.3f, past beat 8 %.3f\n", a0, a4, a9);
    PRUEF(a0 >= -0.01f && a0 < 0.5f);                 // the lane starts at 0 dB, not at the row's -9
    PRUEF(a4 > 4.5f && a4 < 7.5f);                    // half way, give or take the ramp of a few blocks
    PRUEF_NAH(a9, 12.0, 1e-4);                        // after the last point the last value holds
    PRUEF(a9 == a9b);
    PRUEF(t.arr.inserts().lane_treibt(G_EQ, P_B1_GAIN));
    PRUEF(!t.arr.inserts().lane_treibt(G_EQ, P_B1_FREQ) && !t.arr.inserts().lane_treibt(G_KOMP, P_SCHWELLE));   // negative control: no lane, no drive
    PRUEF_NAH(t.arr.inserts().wirksam(G_EQ, P_B1_FREQ), 1000.0, 1e-3);                                       // the row of a parameter without a lane still acts
    t.arr.stopp(0, t.s, t.k);
    t.lauf(t.s + 256 * 8);
    std::printf("K1: after stop %.3f\n", t.arr.inserts().wirksam(G_EQ, P_B1_GAIN));
    PRUEF(!t.arr.inserts().lane_treibt(G_EQ, P_B1_GAIN));   // the lane has ended: the row is back (the stage may be idle; the flag is the point)
  }
  {  // K1 audible: the lane raises the sine of the eq band (1 kHz, peak) as it rises
    TR(t) TR(r)
    stufen_an(t); stufen_an(r);
    setze(t, "ins/eq/1/b1/gain", 0.0f);
    setze(r, "ins/eq/1/b1/gain", 0.0f);
    laden_start(t, spur_lane(&s1k->a, true));
    laden_start(r, spur_lane(&s1k->a, false));
    t.lauf(static_cast<int64_t>(10.0 * BEAT_S));
    r.lauf(static_cast<int64_t>(10.0 * BEAT_S));
    const int64_t f0 = 24000, f1 = static_cast<int64_t>(9.0 * BEAT_S);
    const double lane0 = rms(t.l, f0, f0 + 4800), lane1 = rms(t.l, f1, f1 + 4800), ref0 = rms(r.l, f0, f0 + 4800), ref1 = rms(r.l, f1, f1 + 4800);
    const double dz = 20.0 * std::log10(lane1 / lane0), dr = 20.0 * std::log10(ref1 / ref0);
    std::printf("K1 audible: level rise %.2f dB with the lane, %.2f dB without\n", dz, dr);
    PRUEF(dz > 9.0);              // 12 dB of EQ gain on the sine at the band centre, minus the early blocks
    PRUEF(std::fabs(dr) < 0.3);   // negative control: without the lane the level stays
  }

  {  // K2 neutral: a lane equal to the row renders bit-equal to no lane
    TR(a) TR(b) TR(c)
    for (Treiber* t : {&a, &b, &c}) { stufen_an(*t); setze(*t, "ins/eq/1/b1/gain", 3.0f); }
    Bau x(1);
    x.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &s1k->a).kette(1, {KOMP, EQ}).kette_lane(0, 1, P_B1_GAIN, {pt(0.0, 3.0f), pt(8.0, 3.0f)});
    laden_start(a, x.fertig());
    laden_start(b, spur_lane(&s1k->a, false));
    a.lauf(60000);
    b.lauf(60000);
    PRUEF(gleich_bits(a.l, b.l, 0, 60000) && gleich_bits(a.r, b.r, 0, 60000));
    PRUEF(a.arr.snapshot()->n_klanes == 1 && b.arr.snapshot()->n_klanes == 0);
    PRUEF(a.arr.inserts().lane_treibt(G_EQ, P_B1_GAIN) && !b.arr.inserts().lane_treibt(G_EQ, P_B1_GAIN));
    // the same lane at another value is audible (the control that the bit equality above is not an artefact of a lane that never acts)
    Bau y(1);
    y.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &s1k->a).kette(1, {KOMP, EQ}).kette_lane(0, 1, P_B1_GAIN, {pt(0.0, 12.0f), pt(8.0, 12.0f)});
    laden_start(c, y.fertig());
    c.lauf(60000);
    PRUEF(!gleich_bits(c.l, b.l, 40000, 60000));
    PRUEF(rms(c.l, 40000, 52000) > 1.5 * rms(b.l, 40000, 52000));
  }

  {  // K3 macro lane
    TR(t)
    stufen_an(t);
    setze(t, rk(1, 1), 1.0f);   // the macro row says 1 (threshold 0 dB): the lane drives the macro
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &s1k->a).kette(1, {KOMP, EQ}).rack(1, 0, {ziel(0, 0, P_SCHWELLE, -60.0f, 0.0f)});
    b.makro_lane(0, 0, {pt(0.0, 0.0f), pt(8.0, 1.0f)});
    laden_start(t, b.fertig());
    t.lauf(256 * 3);
    const float s0 = t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE);
    t.lauf(static_cast<int64_t>(4.0 * BEAT_S));
    const float s4 = t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE);
    t.lauf(static_cast<int64_t>(9.0 * BEAT_S));
    const float s9 = t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE);
    std::printf("K3: komp schwelle by macro lane: start %.2f, beat 4 %.2f, beat 9 %.2f\n", s0, s4, s9);
    PRUEF(s0 < -55.0f);                    // macro 0 -> -60, not the row's macro 1 -> 0
    PRUEF(s4 > -35.0f && s4 < -25.0f);     // about -30
    PRUEF_NAH(s9, 0.0, 1e-4);
    PRUEF(t.arr.inserts().lane_makro_treibt(0, 0) && !t.arr.inserts().lane_makro_treibt(0, 1));   // negative control: macro 2 has no lane
    t.arr.stopp(0, t.s, t.k);
    t.lauf(t.s + 256 * 8);
    PRUEF(!t.arr.inserts().lane_makro_treibt(0, 0));
  }

  {  // K4 one writer: the macro wins over a lane on the same parameter in a hand-built snapshot
    TR(t)
    stufen_an(t);
    setze(t, rk(1, 1), 0.5f);
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &s1k->a).kette(1, {KOMP, EQ}).rack(1, 0, {ziel(0, 0, P_SCHWELLE, -60.0f, 0.0f)});
    b.kette_lane(0, 0, P_SCHWELLE, {pt(0.0, -6.0f), pt(8.0, -6.0f)});
    laden_start(t, b.fertig());
    t.lauf(256 * 6);
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -30.0, 1e-3);   // macro 0.5 -> -30, the lane's -6 loses
    PRUEF(t.arr.inserts().makro_treibt(G_KOMP, P_SCHWELLE));
  }

  {  // K5 other strips: group, return, PM
    TR(t)
    Bau b(1);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &s1k->a).ausgang(1, 1);
    b.gruppen_kette(1, {ArrStufe{ArrInsArt::saett, 0, true}});
    b.pm_kette({ArrStufe{ArrInsArt::lim, 0, true}});
    b.s->ret_da[0] = true;
    b.ret_kette(1, {ArrStufe{ArrInsArt::komp, 0, true}});
    b.kette_lane(cdj::ARR_SPUREN + 0, 0, 1, {pt(0.0, 24.0f), pt(8.0, 24.0f)});            // group chain stage 0 (saett): drive 24
    b.kette_lane(cdj::ARR_KETTE_PM, 0, 1, {pt(0.0, -12.0f), pt(8.0, -12.0f)});            // PM stage 0 (lim): decke -12
    b.kette_lane(cdj::ARR_KETTE_RET0, 0, 3, {pt(0.0, 9.0f), pt(8.0, 9.0f)});              // return 1 stage 0 (komp): knie 9
    setze(t, "ins/saett/1/an", 1.0f);
    setze(t, "ins/lim/1/an", 1.0f);
    setze(t, "ins/komp/1/an", 1.0f);
    laden_start(t, b.fertig());
    t.lauf(256 * 6);
    const int g_saett = cdj::ins_global(ArrInsArt::saett, 0), g_lim = cdj::ins_global(ArrInsArt::lim, 0);
    std::printf("K5: group saett drive %.2f, PM lim decke %.2f, return komp knie %.2f\n", t.arr.inserts().wirksam(g_saett, 1), t.arr.inserts().wirksam(g_lim, 1), t.arr.inserts().wirksam(G_KOMP, 3));
    PRUEF(t.arr.inserts().lane_treibt(g_saett, 1) && t.arr.inserts().lane_treibt(g_lim, 1) && t.arr.inserts().lane_treibt(G_KOMP, 3));
    PRUEF_NAH(t.arr.inserts().wirksam(g_saett, 1), 24.0, 1e-4);
    PRUEF_NAH(t.arr.inserts().wirksam(g_lim, 1), -12.0, 1e-4);
    PRUEF_NAH(t.arr.inserts().wirksam(G_KOMP, 3), 9.0, 1e-4);
    // a lane aimed at stage 0 of the TRACK strip (no chain there) does nothing, and a lane of a strip never reaches the stage another strip owns
    TR(u)
    Bau c(1);
    c.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &s1k->a).kette(1, {KOMP});
    c.kette_lane(cdj::ARR_SPUREN + 3, 0, 2, {pt(0.0, 8.0f), pt(8.0, 8.0f)});   // group 4 has no chain
    laden_start(u, c.fertig());
    u.lauf(256 * 6);
    PRUEF(!u.arr.inserts().lane_treibt(G_KOMP, 2));
  }

  {  // K7 swap
    TR(t)
    stufen_an(t);
    setze(t, "ins/eq/1/b1/gain", -9.0f);
    laden_start(t, spur_lane(&s1k->a, true, 1));
    t.lauf(256 * 20);
    PRUEF(t.arr.inserts().lane_treibt(G_EQ, P_B1_GAIN));
    t.laden(spur_lane(&s1k->a, false, 2));   // a swap to the same project without the lane
    t.lauf(t.s + 256 * 4);
    PRUEF(!t.arr.inserts().lane_treibt(G_EQ, P_B1_GAIN));
    PRUEF_NAH(t.arr.inserts().wirksam(G_EQ, P_B1_GAIN), -9.0, 1e-4);   // the row's value is back in the next block
    Bau b(3);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &s1k->a).kette(1, {KOMP, EQ}).kette_lane(0, 1, P_B1_GAIN, {pt(0.0, 6.0f), pt(100.0, 6.0f)});
    t.laden(b.fertig());
    t.lauf(t.s + 256 * 4);
    PRUEF_NAH(t.arr.inserts().wirksam(G_EQ, P_B1_GAIN), 6.0, 1e-4);   // another lane takes over
  }

  {  // K6 loader
    arrdatei::Ordner o("test_arr_auto_kette");
    const std::string a = o.audio('a', 48000);
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    const std::string kette = ",\"chain\":[{\"art\":\"komp\",\"slot\":1},{\"art\":\"eq\",\"slot\":1}]";
    const std::string rackj = ",\"rack\":{\"slot\":1,\"ziele\":[{\"makro\":0,\"stufe\":0,\"param\":1,\"von\":-60,\"bis\":0}]}";
    auto ca = [](const std::string& l) { return ",\"chain_auto\":[" + l + "]"; };
    auto st = [](int stufe, int param, const char* punkte = "[[0,1,0],[8,2,0]]") {
      return "{\"stufe\":" + std::to_string(stufe) + ",\"param\":" + std::to_string(param) + ",\"punkte\":" + punkte + "}";
    };
    auto mk = [](int makro, const char* punkte = "[[0,0,0],[8,1,0]]") { return "{\"makro\":" + std::to_string(makro) + ",\"punkte\":" + punkte + "}"; };
    auto spur = [&](const std::string& extra, int nr = 1, const char* id = "c1") {
      return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\"" + extra + ",\"clips\":[" + o.clip(id, 0.0, 1.0, a, 48000) + "]}";
    };
    auto grund = [&](int64_t nr, const std::string& spuren, const char* format = "cypherdj-arr/2") {
      o.wiedergabe2_ret(nr, spuren, "", "", format);
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
      const std::string g = x.grund + (x.snap ? "+snap" : "");
      cdj::gib_wiedergabe(x.snap.release(), cache);
      return g;
    };
    {   // a lane on a track, a group, a return and the PM, arriving as written
      const std::string sp = spur(kette + ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":2}" + rackj + ca(st(1, 6, "[[0,0,0],[4,12,1],[4,6,2]]") + "," + mk(2)));
      const std::string gr = "{\"nr\":2,\"ausgang\":{\"art\":\"master\"},\"chain\":[{\"art\":\"saett\",\"slot\":1}]" + ca(st(0, 2, "[[1,-6,0]]")) + "}";
      const std::string re = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"chain\":[{\"art\":\"komp\",\"slot\":2}]" + ca(st(0, 3, "[[0,9,0],[2,3,0]]")) + "}";
      const std::string pm = "\"pm\":{\"chain\":[{\"art\":\"lim\",\"slot\":1}]" + ca(st(0, 1, "[[0,-3,0]]")) + "}";
      std::ofstream(o.pfad + "/wiedergabe-120.json") << "{\"format\":\"cypherdj-arr/2\",\"nr\":120,\"spuren\":[" << sp << "],\"gruppen\":[" << gr << "],\"returns\":[" << re << "]," << pm << "}";
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 120, cache);
      std::printf("K6: load grund '%s'\n", e.grund.c_str());
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        const cdj::ArrSnapshot& s = *e.snap;
        PRUEF(s.n_klanes == 5);
        if (s.n_klanes == 5) {
          PRUEF(s.klane[0].strip == 0 && s.klane[0].makro == -1 && s.klane[0].stufe == 1 && s.klane[0].param == 6 && s.klane[0].n == 3);
          PRUEF(s.klane[0].p[1].beat == 4.0 && s.klane[0].p[1].wert == 12.0f && s.klane[0].p[1].form == 1 && s.klane[0].p[2].form == 2);
          PRUEF(s.klane[1].strip == 0 && s.klane[1].makro == 2 && s.klane[1].n == 2 && s.klane[1].p[1].wert == 1.0f);
          PRUEF(s.klane[2].strip == cdj::ARR_SPUREN + 1 && s.klane[2].makro == -1 && s.klane[2].stufe == 0 && s.klane[2].param == 2 && s.klane[2].n == 1);   // group nr 2
          PRUEF(s.klane[3].strip == cdj::ARR_KETTE_PM && s.klane[3].param == 1 && s.klane[3].p[0].wert == -3.0f);   // the order: tracks, groups, PM, returns
          PRUEF(s.klane[4].strip == cdj::ARR_KETTE_RET0 && s.klane[4].param == 3 && s.klane[4].n == 2 && s.klane[4].p[0].wert == 9.0f);
          PRUEF(s.auto_punkte.size() == 3 + 2 + 1 + 1 + 2);   // the points of all lanes behind each other in the one vector
        }
        PRUEF(s.n_auto_lanes == 0);   // the track's own lane list is untouched (negative control)
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    PRUEF(grund(121, spur(kette + ca(st(1, 6)))) == "+snap");                                            // the negative control
    PRUEF(grund(122, spur(kette + ca(st(2, 1)))) == "format");                                           // stage 2 is not in the chain of two
    PRUEF(grund(123, spur(kette + ca(st(0, 0)))) == "format");                                           // the stage switch
    PRUEF(grund(124, spur(kette + ca(st(0, 9)))) == "format");                                           // the compressor key
    PRUEF(grund(125, spur(kette + ca(st(0, 10)))) == "format");                                          // beyond the compressor
    PRUEF(grund(126, spur(kette + ca(st(1, 58)))) == "+snap");                                           // the last eq parameter is fine
    PRUEF(grund(127, spur(kette + ca(st(1, 59)))) == "format");                                          // one beyond the eq
    {   // a host stage keeps its own parameters (the cache must know the host ports, else the chain itself is refused host_fehlt)
      cdj::ArrAudioCache cache_h(&konto, 50LL << 20, false);
      cache_h.setze_host_da(true);
      const std::string hk = ",\"chain\":[{\"art\":\"host\",\"slot\":1,\"an\":false,\"latenz\":0}]";
      o.wiedergabe2_ret(128, spur(hk), "", "");
      cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, 128, cache_h);
      PRUEF(x.snap && x.grund.empty());   // the chain alone loads
      cdj::gib_wiedergabe(x.snap.release(), cache_h);
      o.wiedergabe2_ret(129, spur(hk + ca(st(0, 1))), "", "");
      cdj::ArrLadeErgebnis y = cdj::lade_wiedergabe(o.pfad, 129, cache_h);
      PRUEF(!y.snap && y.grund == "format");
      cdj::gib_wiedergabe(y.snap.release(), cache_h);
    }
    PRUEF(grund(159, spur(kette + ca(st(0, 1) + "," + st(0, 1)))) == "format");                           // the same target twice
    PRUEF(grund(160, spur(kette + ca(st(0, 1) + "," + st(0, 2)))) == "+snap");                            // two targets are fine
    PRUEF(grund(161, spur(kette + rackj + ca(st(0, 1)))) == "format");                                   // a parameter a rack target maps
    PRUEF(grund(162, spur(kette + rackj + ca(st(0, 2)))) == "+snap");                                    // another parameter is fine
    PRUEF(grund(163, spur(kette + ca(mk(0)))) == "format");                                              // a macro lane without a rack
    PRUEF(grund(164, spur(kette + rackj + ca(mk(0)))) == "+snap");
    PRUEF(grund(165, spur(kette + rackj + ca(mk(4)))) == "format");                                      // macro 4 (0..3)
    PRUEF(grund(166, spur(kette + rackj + ca(mk(0) + "," + mk(0)))) == "format");                         // a macro lane twice
    PRUEF(grund(167, spur(kette + rackj + ca("{\"makro\":0,\"stufe\":0,\"param\":2,\"punkte\":[[0,0,0]]}"))) == "format");   // makro and stufe in one lane
    PRUEF(grund(168, spur(kette + ca(st(0, 1, "[[0,1e999,0]]")))) == "format");                           // not finite
    PRUEF(grund(169, spur(kette + rackj + ca(mk(0, "[[0,1.5,0]]")))) == "format");                        // a macro value outside 0..1
    PRUEF(grund(170, spur(kette + ca(st(0, 1, "[[4,1,0],[2,1,0]]")))) == "format");                       // falling beats
    PRUEF(grund(171, spur(kette + ca(st(0, 1, "[[0,1,3]]")))) == "format");                               // form 3
    PRUEF(grund(172, spur(kette + ca(st(0, 1, "[]")))) == "format");                                     // no points
    PRUEF(grund(173, spur(kette + ca(st(0, 1, "[[0,1,0],[0,2,0],[0,3,0]]")))) == "format");               // three points at one beat
    PRUEF(grund(174, spur(kette + ca(st(0, 1))), "cypherdj-arr/1") == "format");                          // /1 has no chain at all
    {   // ARR_KLANES_MAX lanes load, one more is refused zu_gross: 32 tracks with 3 stages... two lanes a track on 33 tracks is not possible, so tracks with up to 16 lanes of eq b1..b2 each
      std::string spuren;
      int n = 0;
      for (int nr = 1; nr <= 9 && n < cdj::ARR_KLANES_MAX + 1; ++nr) {
        std::string l;
        for (int p = 1; p <= 8 && n < cdj::ARR_KLANES_MAX + 1; ++p, ++n) l += (l.empty() ? "" : ",") + st(0, p);
        const std::string eigene = ",\"chain\":[{\"art\":\"komp\",\"slot\":" + std::to_string(nr) + "}]";   // every track its own compressor: a pool slot belongs to one stage
        spuren += (nr > 1 ? "," : "") + spur(eigene + ca(l), nr, ("c" + std::to_string(nr)).c_str());
      }
      PRUEF(n == cdj::ARR_KLANES_MAX + 1);
      PRUEF(grund(175, spuren) == "zu_gross");
    }
  }

  {  // K8 keine_allokation
    TR(t)
    stufen_an(t);
    Bau b0(1), b1(2), b2(3);
    for (Bau* b : {&b0, &b1, &b2}) {
      b->spur(1, ArrArt::audio).clip(1, "c1", 0.0, 64.0, &s1k->a).kette(1, {KOMP, EQ}).rack(1, 0, {ziel(0, 0, P_SCHWELLE, -60.0f, 0.0f)});
    }
    b0.kette_lane(0, 1, P_B1_GAIN, {pt(0.0, 0.0f), pt(8.0, 12.0f), pt(16.0, -6.0f, 1)}).makro_lane(0, 0, {pt(0.0, 0.0f), pt(4.0, 1.0f)});
    b1.kette_lane(0, 1, P_B1_FREQ, {pt(0.0, 200.0f), pt(8.0, 4000.0f)});
    b2.kette_lane(0, 1, P_B1_GAIN, {pt(0.0, 3.0f), pt(8.0, 9.0f)}).makro_lane(0, 0, {pt(0.0, 1.0f), pt(4.0, 0.0f, 2)});
    cdj::ArrSnapshot* s0 = b0.fertig();
    cdj::ArrSnapshot* s1 = b1.fertig();
    cdj::ArrSnapshot* s2 = b2.fertig();
    laden_start(t, s0);
    t.lauf(20000);
    float bf[6][cdj::ARR_BLOCK];
    int64_t s = t.s;
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(4);   // the vector itself must not allocate inside the window
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 700) alt.push_back(t.arr.tausche(s1, s, t.k));
      if (blk == 1300) alt.push_back(t.arr.tausche(s2, s, t.k));
      for (auto& x : bf) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, s, 256, bf[0], bf[1], bf[2], bf[3], bf[4], bf[5]);
      s += 256;
    }
    const long im_fenster = abfang_aus();
    std::printf("K8: allocations in 2000 blocks = %ld\n", im_fenster);
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(im_fenster == 0);   // the watcher does not exist in a sanitizer build (-1)
    PRUEF(t.arr.inserts().lief(G_KOMP) && t.arr.inserts().lief(G_EQ));   // the stages ran
    PRUEF(t.arr.inserts().lane_treibt(G_EQ, P_B1_GAIN));                // the last snapshot's lane drives
    for (const cdj::ArrSnapshot* x : alt) delete x;
    abfang_an();
    { cdj::ArrInserts zweites; }
    const long bau_zaehlt = abfang_aus();
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(bau_zaehlt > 0);   // positive control: the watcher counts
  }

  PRUEF_ENDE();
}
