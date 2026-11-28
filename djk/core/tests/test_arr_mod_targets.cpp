// Strand 6 task 4.1 (plan 2026-11-27, slice 4): the block-rate modulator targets in the core: sends (art 2, dB on top of lane or knob, Arrangement::auto_send), insert stage parameters
// (art 3, a fraction of the row range, ArrInserts::mod_stufe -> eff()) and rack macros (art 4, macro units, ArrInserts::mod_makro -> makros_planen). Every case uses a square LFO (form 3)
// with takt 4 at 120 BPM: +1 over beats [0, 2), -1 over [2, 4), read in the middle of each half, so the block-rate value is the plain offset.
//   1. send: knob -6 dB, tiefe 6: the return carries the track at 0 dB, then -12 dB; with a lane at -10 dB the offset sits on the lane (-4, -16); a knob at -200 dB stays exactly silent.
//   2. stage: komp threshold row -30, tiefe 0.1: eff() = row +- 0.1 x (max - min); tiefe 1 clamps at the row range; a lane at -40 plus the offset; the ratio (no target) stays at its row.
//   3. macro: rack macro 1 maps the threshold -60..0, macro row 0.5, tiefe 0.25: macro 0.75 / 0.25 -> -15 / -45 dB; tiefe 1 clamps the macro at 1 / 0.
//   4. the reader: send, stage and macro targets of a /3 file arrive as written (track, group, return, PM); the refusals give `format`.
//   5. no allocation, no lock in 2000 blocks with all three kinds and a swap (alloc_intercept.h), positive control.
//   6. a modulator with `ziele: []` (only plugin targets, played by the page server): the reader takes it (n 0), the core gives /zustand/mod events for it at 25 Hz (MOD_ZUSTAND, values
//      sweeping the shape), and the master output is bit-equal to the same playback without the `mod` key.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "arr_run.h"
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

bool g_waechter = false;   // core35.h

namespace {
constexpr int64_t V = 537;
constexpr int NB = 256;
constexpr double BEAT = 24000.0;   // 120 BPM
const ArrStufe KOMP{ArrInsArt::komp, 0, true};
constexpr int P_SCHWELLE = 1, P_RATIO = 2;
const int G_KOMP = cdj::ins_global(ArrInsArt::komp, 0);

void setze(Treiber& t, const std::string& pfad, float w) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  t.arr.setze_sofort(r, w);
}
ArrAutoPunkt pt(double beat, float wert) { return ArrAutoPunkt{beat, wert, 0}; }
ArrMakroZiel mziel(int makro, int stufe, int param, float von, float bis) {
  ArrMakroZiel z;
  z.makro = static_cast<uint8_t>(makro);
  z.stufe = static_cast<uint8_t>(stufe);
  z.param = static_cast<uint8_t>(param);
  z.von = von;
  z.bis = bis;
  return z;
}
cdj::ArrModZiel ziel(uint8_t art, int slot, int param, float tiefe, int stufe = 0) {
  cdj::ArrModZiel z{};
  z.art = art;
  z.slot = static_cast<int16_t>(slot);
  z.param = static_cast<uint8_t>(param);
  z.stufe = static_cast<uint8_t>(stufe);
  z.tiefe = tiefe;
  return z;
}
cdj::ArrMod quadrat(int nr, std::initializer_list<cdj::ArrModZiel> zl) {
  cdj::ArrMod md{};
  md.nr = static_cast<uint8_t>(nr);
  md.form = 3;
  md.takt = 4.0;
  md.glatt_ms = 0.0f;
  for (const cdj::ArrModZiel& z : zl) md.z[md.n++] = z;
  return md;
}
cdj::ArrSnapshot* mit_mod(cdj::ArrSnapshot* s, const cdj::ArrMod& md) {
  s->mod[s->n_mod++] = md;
  return s;
}
void bereit(Treiber& t) {
  t.k = cdj::Karte(120.0, 0);
  t.n = NB;
  for (const char* p : {"ret/1/hall/an", "ret/2/hall/an"}) setze(t, p, 0.0f);
}
void starte(Treiber& t, cdj::ArrSnapshot* s) {
  t.laden(s);
  PRUEF(t.arr.start(0.0, 0, false, 0, V, NB, t.k));
}
int64_t bei(const Treiber& t, double beat) { return t.arr.zustand(t.k, t.s).ursprung_sample + static_cast<int64_t>(beat * BEAT); }
double db(double x) { return 20.0 * std::log10(std::max(x, 1e-30)); }
// the send level in dB relative to the direct signal: (run - reference) / reference, the reference has no send
double nass(const Treiber& t, const Treiber& ref, int64_t i) { return db(std::fabs(static_cast<double>(t.l[i]) - ref.l[i]) / std::fabs(static_cast<double>(ref.l[i]))); }

// track 1 (constant 0.25) into returns 1 and 2; optional send lane on return 1; optional modulator
cdj::ArrSnapshot* send_snap(const cdj::ArrAudio* a, const std::vector<ArrAutoPunkt>& lane, const cdj::ArrMod* md, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, a);
  b.ret(1).ret(2);
  if (!lane.empty()) b.lane(1, lane, cdj::ARR_AUTO_SEND, 0);
  cdj::ArrSnapshot* s = b.fertig();
  return md ? mit_mod(s, *md) : s;
}

void sends() {   // 1.
  auto au = Audio::gleich(2400000, 0.25f);
  const cdj::ArrMod md = quadrat(1, {ziel(2, 0, 0, 6.0f)});
  {
    TR(t) TR(ref)
    for (Treiber* x : {&t, &ref}) bereit(*x);
    setze(t, "spur/1/send/1", -6.0f);
    setze(ref, "spur/1/send/1", -200.0f);
    starte(t, send_snap(&au->a, {}, &md));
    starte(ref, send_snap(&au->a, {}, nullptr));
    const int64_t ende = bei(t, 4.5);
    t.lauf(ende);
    ref.lauf(ende);
    const double hoch = nass(t, ref, bei(t, 1.0)), tief = nass(t, ref, bei(t, 3.0));
    std::printf("1. send knob -6 dB, square tiefe 6: %.3f dB in the first half, %.3f dB in the second (expected 0, -12)\n", hoch, tief);
    PRUEF_NAH(hoch, 0.0, 0.05);
    PRUEF_NAH(tief, -12.0, 0.05);
    PRUEF(t.arr.snapshot()->n_auto_lanes == 0);   // no lane: the modulator alone drives the plan
  }
  {   // a lane at -10 dB: the offset sits on the lane
    TR(t) TR(ref)
    for (Treiber* x : {&t, &ref}) bereit(*x);
    setze(t, "spur/1/send/1", -40.0f);
    setze(ref, "spur/1/send/1", -200.0f);
    starte(t, send_snap(&au->a, {pt(0.0, -10.0f), pt(8.0, -10.0f)}, &md));
    starte(ref, send_snap(&au->a, {}, nullptr));
    const int64_t ende = bei(t, 4.5);
    t.lauf(ende);
    ref.lauf(ende);
    const double hoch = nass(t, ref, bei(t, 1.0)), tief = nass(t, ref, bei(t, 3.0));
    std::printf("   with a lane at -10 dB: %.3f / %.3f dB (expected -4, -16)\n", hoch, tief);
    PRUEF_NAH(hoch, -4.0, 0.05);
    PRUEF_NAH(tief, -16.0, 0.05);
  }
  {   // a knob at -200 dB stays off: bit-equal to the reference without a send
    TR(t) TR(ref)
    for (Treiber* x : {&t, &ref}) bereit(*x);
    setze(t, "spur/1/send/1", -200.0f);
    setze(ref, "spur/1/send/1", -200.0f);
    starte(t, send_snap(&au->a, {}, &md));
    starte(ref, send_snap(&au->a, {}, nullptr));
    t.lauf(bei(t, 4.5));
    ref.lauf(bei(t, 4.5));
    PRUEF(t.l == ref.l && t.r == ref.r);
    std::printf("   knob at -200 dB with the modulator: bit-equal to no send (%zu samples)\n", t.l.size());
  }
}

cdj::ArrSnapshot* komp_snap(const cdj::ArrAudio* a, const cdj::ArrMod* md, bool lane = false, bool rack = false, int64_t nr = 1) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, a).kette(1, {KOMP});
  if (lane) b.kette_lane(0, 0, P_SCHWELLE, {pt(0.0, -40.0f), pt(8.0, -40.0f)});
  if (rack) b.rack(1, 0, {mziel(0, 0, P_SCHWELLE, -60.0f, 0.0f)});
  cdj::ArrSnapshot* s = b.fertig();
  return md ? mit_mod(s, *md) : s;
}
// the threshold the komp got near beat 1 and near beat 3
std::pair<float, float> schwellen(const cdj::ArrAudio* a, const cdj::ArrMod& md, bool lane = false, bool rack = false, float* ratio = nullptr) {
  TR(t)
  bereit(t);
  setze(t, "ins/komp/1/an", 1.0f);
  setze(t, "ins/komp/1/schwelle", -30.0f);
  if (rack) setze(t, "rack/1/m1", 0.5f);
  starte(t, komp_snap(a, &md, lane, rack));
  t.lauf(bei(t, 1.0));
  const float h = t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE);
  if (!rack) PRUEF(t.arr.inserts().mod_treibt(G_KOMP, P_SCHWELLE) && !t.arr.inserts().mod_treibt(G_KOMP, P_RATIO));
  if (ratio) *ratio = t.arr.inserts().wirksam(G_KOMP, P_RATIO);
  t.lauf(bei(t, 3.0));
  return {h, t.arr.inserts().wirksam(G_KOMP, P_SCHWELLE)};
}

void stufen() {   // 2. and 3.
  auto au = Audio::sinus(2400000, 1000.0, 0.5f);
  const auto [v1h, v1t] = schwellen(&au->a, quadrat(1, {ziel(3, 0, P_SCHWELLE, 1.0f)}));   // tiefe 1: clamped to the row range
  const auto [h, t] = schwellen(&au->a, quadrat(1, {ziel(3, 0, P_SCHWELLE, 0.1f)}));
  const double spanne = v1h - v1t;
  std::printf("2. komp threshold row -30: tiefe 0.1 -> %.3f / %.3f; tiefe 1 -> %.3f / %.3f (the row range)\n", h, t, v1h, v1t);
  PRUEF(spanne > 10.0);
  PRUEF_NAH(h, -30.0 + 0.1 * spanne, 1e-3);
  PRUEF_NAH(t, -30.0 - 0.1 * spanne, 1e-3);
  float ratio = 0.0f, ratio_ref = 0.0f;
  const auto [lh, lt] = schwellen(&au->a, quadrat(1, {ziel(3, 0, P_SCHWELLE, 0.1f)}), true, false, &ratio);
  std::printf("   with a lane at -40: %.3f / %.3f\n", lh, lt);
  PRUEF_NAH(lh, -40.0 + 0.1 * spanne, 1e-3);
  PRUEF_NAH(lt, -40.0 - 0.1 * spanne, 1e-3);
  {   // the ratio has no target: the same value as without any modulator
    TR(r)
    bereit(r);
    setze(r, "ins/komp/1/an", 1.0f);
    setze(r, "ins/komp/1/schwelle", -30.0f);
    starte(r, komp_snap(&au->a, nullptr));
    r.lauf(bei(r, 1.0));
    ratio_ref = r.arr.inserts().wirksam(G_KOMP, P_RATIO);
    PRUEF_NAH(r.arr.inserts().wirksam(G_KOMP, P_SCHWELLE), -30.0, 1e-6);   // the row without a modulator (control)
    PRUEF(!r.arr.inserts().mod_treibt(G_KOMP, P_SCHWELLE));
  }
  PRUEF(ratio == ratio_ref);
  // 3. the macro: m1 0.5 maps -60..0; tiefe 0.25 -> macro 0.75 / 0.25
  const auto [mh, mt] = schwellen(&au->a, quadrat(1, {ziel(4, 0, 0, 0.25f)}), false, true);
  const auto [kh, kt] = schwellen(&au->a, quadrat(1, {ziel(4, 0, 0, 1.0f)}), false, true);
  std::printf("3. macro 0.5 +- 0.25 -> threshold %.3f / %.3f (expected -15, -45); tiefe 1 -> %.3f / %.3f (expected 0, -60)\n", mh, mt, kh, kt);
  PRUEF_NAH(mh, -15.0, 1e-3);
  PRUEF_NAH(mt, -45.0, 1e-3);
  PRUEF_NAH(kh, 0.0, 1e-4);
  PRUEF_NAH(kt, -60.0, 1e-4);
}

void lader() {   // 4.
  arrdatei::Ordner o("test_arr_mod_ziele");
  const std::string a = o.audio('a', 48000);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  const std::string kette = ",\"chain\":[{\"art\":\"komp\",\"slot\":1},{\"art\":\"eq\",\"slot\":1}]";
  const std::string rackj = ",\"rack\":{\"slot\":1,\"ziele\":[{\"makro\":0,\"stufe\":0,\"param\":1,\"von\":-60,\"bis\":0}]}";
  const std::string spur1 = "{\"nr\":1,\"art\":\"audio\"" + kette + rackj + ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":2},\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}";
  const std::string gr = "{\"nr\":2,\"ausgang\":{\"art\":\"master\"},\"chain\":[{\"art\":\"saett\",\"slot\":1}]}";
  const std::string re = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"chain\":[{\"art\":\"komp\",\"slot\":2}]}";
  const std::string pm = "\"pm\":{\"chain\":[{\"art\":\"lim\",\"slot\":1}]}";
  int64_t nr = 200;
  const auto lade = [&](const std::string& ziele, cdj::ArrMod* kopie = nullptr) {
    ++nr;
    std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json")
        << "{\"format\":\"cypherdj-arr/3\",\"nr\":" << nr << ",\"spuren\":[" << spur1 << "],\"gruppen\":[" << gr << "],\"returns\":[" << re << "]," << pm
        << ",\"mod\":[{\"nr\":2,\"art\":\"lfo\",\"form\":3,\"takt\":4,\"saat\":7,\"ziele\":[" << ziele << "]}]}";
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    const std::string g = e.grund + (e.snap ? "+snap" : "");
    if (e.snap && kopie && e.snap->n_mod > 0) *kopie = e.snap->mod[0];
    if (!e.snap) std::printf("   refused: %s\n", e.meldung.c_str());
    cdj::gib_wiedergabe(e.snap.release(), cache);
    return g;
  };
  {
    cdj::ArrMod k{};
    PRUEF(lade("{\"spur\":1,\"ziel\":\"send.1\",\"tiefe\":-6},{\"kette\":\"spur\",\"nr\":1,\"stufe\":1,\"param\":6,\"tiefe\":0.5,\"uni\":true},"
               "{\"kette\":\"spur\",\"nr\":1,\"makro\":2,\"tiefe\":-0.25},{\"kette\":\"grp\",\"nr\":2,\"stufe\":0,\"param\":2,\"tiefe\":0.1},"
               "{\"kette\":\"ret\",\"nr\":1,\"stufe\":0,\"param\":3,\"tiefe\":0.2},{\"kette\":\"pm\",\"nr\":1,\"stufe\":0,\"param\":1,\"tiefe\":-1}",
               &k) == "+snap");
    PRUEF(k.n == 6);
    PRUEF(k.z[0].art == 2 && k.z[0].slot == 0 && k.z[0].param == 0 && k.z[0].tiefe == -6.0f && k.z[0].puffer == -1);
    PRUEF(k.z[1].art == 3 && k.z[1].slot == 0 && k.z[1].stufe == 1 && k.z[1].param == 6 && k.z[1].tiefe == 0.5f && k.z[1].uni);
    PRUEF(k.z[2].art == 4 && k.z[2].slot == 0 && k.z[2].param == 2 && k.z[2].tiefe == -0.25f);
    PRUEF(k.z[3].art == 3 && k.z[3].slot == cdj::ARR_SPUREN + 1 && k.z[3].stufe == 0 && k.z[3].param == 2);
    PRUEF(k.z[4].art == 3 && k.z[4].slot == cdj::ARR_KETTE_RET0 && k.z[4].param == 3);
    PRUEF(k.z[5].art == 3 && k.z[5].slot == cdj::ARR_KETTE_PM && k.z[5].param == 1 && k.z[5].tiefe == -1.0f);
    std::printf("4. send, stage (track, group, return, PM) and macro targets arrive as written\n");
  }
  PRUEF(lade("{\"spur\":1,\"ziel\":\"send.2\",\"tiefe\":-6}") == "format");                              // return 2 is not in the playback
  PRUEF(lade("{\"spur\":1,\"ziel\":\"send.1\",\"tiefe\":25}") == "format");                              // beyond -24..24 dB
  PRUEF(lade("{\"spur\":1,\"ziel\":\"send.1\",\"tiefe\":24},{\"spur\":1,\"ziel\":\"send.1\",\"tiefe\":1}") == "format");   // twice
  PRUEF(lade("{\"ret\":1,\"ziel\":\"send.1\",\"tiefe\":1}") == "format");                                // a return has no send target
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":2,\"param\":1,\"tiefe\":0.1}") == "format");           // stage 2 not in the chain of two
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":1,\"param\":0,\"tiefe\":0.1}") == "format");           // the stage switch
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":0,\"param\":9,\"tiefe\":0.1}") == "format");           // the compressor key
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":1,\"param\":85,\"tiefe\":0.1}") == "format");          // the eq key (sc, strand 5 slice 4)
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":1,\"param\":86,\"tiefe\":0.1}") == "format");          // beyond the eq (86 parameters, 0..85)
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":0,\"param\":1,\"tiefe\":0.1}") == "format");           // mapped by the rack macro
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":0,\"param\":2,\"tiefe\":0.1}") == "+snap");            // another komp parameter is fine
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":0,\"param\":2,\"tiefe\":1.5}") == "format");           // beyond -1..1
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":0,\"param\":2,\"tiefe\":0.1},{\"kette\":\"spur\",\"nr\":1,\"stufe\":0,\"param\":2,\"tiefe\":0.2}") == "format");   // twice
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"stufe\":0,\"param\":2,\"tiefe\":0.1},{\"kette\":\"spur\",\"nr\":1,\"stufe\":1,\"param\":2,\"tiefe\":0.2}") == "+snap");   // another stage
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"makro\":4,\"tiefe\":0.1}") == "format");                      // macro 0..3
  PRUEF(lade("{\"kette\":\"grp\",\"nr\":2,\"makro\":0,\"tiefe\":0.1}") == "format");                       // the group has no rack
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"makro\":0,\"stufe\":0,\"param\":2,\"tiefe\":0.1}") == "format");   // makro and stufe
  PRUEF(lade("{\"kette\":\"pm\",\"nr\":2,\"stufe\":0,\"param\":1,\"tiefe\":0.1}") == "format");             // pm takes nr 1
  PRUEF(lade("{\"kette\":\"grp\",\"nr\":3,\"stufe\":0,\"param\":1,\"tiefe\":0.1}") == "format");            // group 3 has no chain
  PRUEF(lade("{\"kette\":\"ret\",\"nr\":2,\"stufe\":0,\"param\":1,\"tiefe\":0.1}") == "format");            // return 2 is not in the playback
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":2,\"stufe\":0,\"param\":1,\"tiefe\":0.1}") == "format");           // track 2 is not in the playback
  PRUEF(lade("{\"kette\":\"bus\",\"nr\":1,\"stufe\":0,\"param\":1,\"tiefe\":0.1}") == "format");            // unknown strip kind
  PRUEF(lade("{\"kette\":\"spur\",\"nr\":1,\"ziel\":\"fader\",\"stufe\":0,\"param\":2,\"tiefe\":0.1}") == "format");   // a chain target names no ziel
  PRUEF(lade("{\"kette\":\"spur\",\"spur\":1,\"nr\":1,\"stufe\":0,\"param\":2,\"tiefe\":0.1}") == "format");
  {   // a host stage takes no core modulator
    cdj::ArrAudioCache cache_h(&konto, 50LL << 20, false);
    cache_h.setze_host_da(true);
    ++nr;
    std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json")
        << "{\"format\":\"cypherdj-arr/3\",\"nr\":" << nr << ",\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"chain\":[{\"art\":\"host\",\"slot\":1,\"an\":false,\"latenz\":0}],\"clips\":[]}],"
        << "\"gruppen\":[],\"returns\":[],\"mod\":[{\"nr\":1,\"art\":\"lfo\",\"form\":0,\"takt\":4,\"saat\":1,\"ziele\":[{\"kette\":\"spur\",\"nr\":1,\"stufe\":0,\"param\":1,\"tiefe\":0.1}]}]}";
    cdj::ArrLadeErgebnis y = cdj::lade_wiedergabe(o.pfad, nr, cache_h);
    PRUEF(!y.snap && y.grund == "format");
    cdj::gib_wiedergabe(y.snap.release(), cache_h);
  }
}

void ohne_allokation() {   // 5.
  auto au = Audio::sinus(2400000, 1000.0, 0.5f);
  TR(t)
  bereit(t);
  setze(t, "ins/komp/1/an", 1.0f);
  setze(t, "spur/1/send/1", -6.0f);
  const auto snap = [&](int64_t nr, float tiefe) {
    Bau b(nr);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 400.0, &au->a).kette(1, {KOMP, ArrStufe{ArrInsArt::eq, 0, true}}).rack(1, 0, {mziel(0, 1, 6, -6.0f, 6.0f)});
    b.ret(1);
    cdj::ArrMod md = quadrat(1, {ziel(2, 0, 0, tiefe * 6.0f), ziel(3, 0, P_SCHWELLE, tiefe), ziel(4, 0, 0, tiefe)});
    md.form = 0;
    return mit_mod(b.fertig(), md);
  };
  starte(t, snap(1, 0.5f));
  t.lauf(t.s + 4 * NB);
  cdj::ArrSnapshot* s2 = snap(2, -0.25f);
  float bf[6][cdj::ARR_BLOCK];
  int64_t smp = t.s;
  std::vector<const cdj::ArrSnapshot*> alt;
  alt.reserve(2);
  abfang_an();
  for (int blk = 0; blk < 2000; ++blk) {
    if (blk == 1000) alt.push_back(t.arr.tausche(s2, smp, t.k));
    for (auto& x : bf) std::fill(x, x + NB, 0.0f);
    t.arr.block(t.k, smp, NB, bf[0], bf[1], bf[2], bf[3], bf[4], bf[5]);
    smp += NB;
  }
  const long im_fenster = abfang_aus();
  const AbfangZahlen n = abfang_zahlen();
  const bool getrieben = t.arr.inserts().mod_treibt(G_KOMP, P_SCHWELLE);
  std::printf("5. 2000 blocks with send, stage and macro modulators and a swap: allocations %ld, frees %ld, locks %ld, sleeps %ld; stage driven %d\n", im_fenster, n.frei, n.sperren,
              n.schlafen, getrieben ? 1 : 0);
  PRUEF(getrieben);   // the modulators really ran
  if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(im_fenster == 0 && n.summe() == 0);
  for (const cdj::ArrSnapshot* x : alt) t.alt.push_back(x);
  abfang_an();
  { std::vector<int> v(100); }
  const long positiv = abfang_aus();
  if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(positiv > 0);
}

void leere_ziele(const std::string& ab) {   // 6.
  const auto lauf = [&](const std::string& mod, int* n_ev, float* lo, float* hi, int* n_ziele) {
    auto x = std::make_unique<arr35::Lauf>(ab, "test_arr_mod_ziele_kern");
    const std::string a = x->ordner.audio('a', 96000);
    const std::string w = "{\"format\":\"cypherdj-arr/3\",\"nr\":5,\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"clips\":[" + x->ordner.clip("c1", 0.0, 8.0, a, 96000) +
                          "]}],\"gruppen\":[],\"returns\":[]" + (mod.empty() ? "" : ",\"mod\":" + mod) + "}";
    x->ordner.roh(5, w);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x->ordner.pfad, 5, x->cache);
    if (!e.snap) std::printf("   refused: %s\n", e.meldung.c_str());
    PRUEF(e.snap != nullptr);
    if (!e.snap) return std::vector<float>{};
    *n_ziele = e.snap->n_mod > 0 ? e.snap->mod[0].n : -1;
    cdj::Befehl b = x->neu(cdj::Befehl::ARR_LADEN, "andreas");
    b.zeiger = e.snap.release();
    b.arr_nr = 5;
    x->sende(b);
    x->lauf(8 * k35::N);
    x->start(0.0, 0);
    x->lauf(x->kern->sample() + 8 * k35::N);
    const int64_t von = x->kern->sample();
    x->lauf(von + 48000);
    *n_ev = 0;
    *lo = 2.0f;
    *hi = -2.0f;
    for (const cdj::Ereignis& ev : x->ev)
      if (ev.art == cdj::Ereignis::MOD_ZUSTAND && ev.sample >= von && ev.sample < von + 48000) {
        PRUEF(ev.deck == 3);
        ++*n_ev;
        *lo = std::min(*lo, ev.wert);
        *hi = std::max(*hi, ev.wert);
      }
    return x->l;
  };
  int n_mit = 0, n_ohne = 0, z_mit = 0, z_ohne = 0;
  float lo = 0, hi = 0, lo2 = 0, hi2 = 0;
  const std::vector<float> mit = lauf("[{\"nr\":3,\"art\":\"lfo\",\"form\":0,\"takt\":2,\"saat\":1,\"ziele\":[]}]", &n_mit, &lo, &hi, &z_mit);
  const std::vector<float> ohne = lauf("", &n_ohne, &lo2, &hi2, &z_ohne);
  std::printf("6. empty ziele: n %d, %d MOD_ZUSTAND events in one second (sine %.3f..%.3f), without mod %d events; master bit-equal %d (%zu samples)\n", z_mit, n_mit, lo, hi, n_ohne,
              mit == ohne ? 1 : 0, mit.size());
  PRUEF(z_mit == 0 && z_ohne == -1);
  PRUEF(n_mit >= 24 && n_mit <= 26);
  PRUEF(hi - lo > 1.5f);   // one second at 128 BPM is 2.13 beats, more than one period of takt 2: the sine sweeps nearly -1..1
  PRUEF(n_ohne == 0);
  PRUEF(!mit.empty() && mit == ohne);
}

}  // namespace

int main() {
  sends();
  stufen();
  lader();
  ohne_allokation();
  {
    k35::Arbeitsbestand ab("test_arr_mod_ziele");
    leere_ziele(ab.pfad);
  }
  PRUEF_ENDE();
}
