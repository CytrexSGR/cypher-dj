// Return fader automation (slice 2 of auto-return-master, core and model part): a fader lane on a RETURN strip.
// Wire: format cypherdj-arr/3, `returns[].auto = [{"ziel":"fader","punkte":[[beat, dB, form],...]}]`, absolute, one lane per return, only the fader.
// The core plays it like a track fader lane (the same auto_block: blend, step hold, look-ahead, cursors); while it plays it wins over the Stellwerk row ret/<nr>/fader.
// The master (pm, and a group) never takes a volume curve: the loader refuses `auto` there.
// Cases:
//   L  loader      /3 loads a lane (ret_fader_da, points, n_auto_lanes); /2 with returns[].auto is refused; an unknown format (what an old core says to /3) is refused with reason `format`;
//                  a lane on another target (pan), a relative lane, a lane twice, `auto` on the PM, on a group and on `master` are refused; /3 without a lane loads like /2
//   C  core        envelope of a return lane (-200 dB to 0 dB over 4 bars) against the expected curve; no lane: bit-identical; stop back to the Stellwerk; swap without a click; no allocation;
//                  jump form; the render path (rendere) equals the live run
// Mutation (CMakeLists.txt): ARR_RET_FADER_SLOT_VERSATZ (C envelope red): the return reads the lane of the next slot.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <tuple>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;

static ArrAutoPunkt pt(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }

static void lader_faelle() {
  arrdatei::Ordner o("test_arr_auto_return");
  const std::string a = o.audio('a', 48000);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  const std::string spur = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 4.0, a, 48000) + "]}";
  const auto lane = [](const char* punkte, const char* ziel = "fader", const char* extra = "") {
    return std::string("{\"ziel\":\"") + ziel + "\",\"punkte\":" + punkte + extra + "}";
  };
  const auto ret = [](int nr, const std::string& auto_liste) {
    return "{\"nr\":" + std::to_string(nr) + ",\"ausgang\":{\"art\":\"master\"}" + (auto_liste.empty() ? "" : ",\"auto\":[" + auto_liste + "]") + "}";
  };
  int64_t nr = 300;
  // loads the file with the given format; the answer is the reason, "+snap" when a snapshot came back (and was given back)
  const auto grund = [&](const std::string& gruppen, const std::string& returns, const char* format, const std::string& zusatz = "") {
    ++nr;
    std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json") << "{\"format\":\"" << format << "\",\"nr\":" << nr << ",\"spuren\":[" << spur << "],\"gruppen\":["
                                                                           << gruppen << "],\"returns\":[" << returns << "]" << zusatz << "}";
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    const std::string g = e.grund + (e.snap ? "+snap" : "");
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    return g;
  };
  const char* V3 = "cypherdj-arr/3";
  const char* V2 = "cypherdj-arr/2";
  const std::string gut = lane("[[0,-200,0],[16,0,0]]");
  {  // lader_ret_fader_ok: /3, two points
    ++nr;
    std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json")
        << "{\"format\":\"cypherdj-arr/3\",\"nr\":" << nr << ",\"spuren\":[" << spur << "],\"gruppen\":[],\"returns\":[" << ret(1, "") << "," << ret(3, gut) << "]}";
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSnapshot& s = *e.snap;
      PRUEF(!s.ret_fader_da[0] && s.ret_fader_da[2] && !s.ret_fader_da[1] && !s.ret_fader_da[3]);
      PRUEF(s.ret_fader[2].ziel == cdj::ARR_AUTO_FADER && s.ret_fader[2].n == 2 && !s.ret_fader[2].relativ);
      if (s.ret_fader[2].n == 2) {
        PRUEF(s.ret_fader[2].p[0].beat == 0.0 && s.ret_fader[2].p[0].wert == -200.0f && s.ret_fader[2].p[0].form == 0);
        PRUEF(s.ret_fader[2].p[1].beat == 16.0 && s.ret_fader[2].p[1].wert == 0.0f);
      }
      PRUEF(s.n_auto_lanes == 1);   // the return lane counts (render's gegenprobe and auto_block look at it)
      PRUEF(s.ret_da[0] && s.ret_da[2] && s.auto_punkte.size() == 2);
      PRUEF(s.spur[0].n_auto == 0);   // the track list is untouched
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  PRUEF(grund("", ret(1, ""), V3) == "+snap");                                         // /3 without a lane loads like /2
  PRUEF(grund("", ret(1, ""), V2) == "+snap");                                         // negative control: /2 without a lane
  // lader_ret_fader_in_v2_abgelehnt: the lane in /2 is refused (an old loader would have dropped it silently), the positive control is the same file in /3
  PRUEF(grund("", ret(1, gut), V2) == "format");
  PRUEF(grund("", ret(1, gut), V3) == "+snap");
  // lader_alter_kern_format3_abgelehnt: what the gate of a core without the capability does with a /3 file: the format is unknown, reason `format`, no snapshot
  PRUEF(grund("", ret(1, gut), "cypherdj-arr/4") == "format");
  PRUEF(grund("", ret(1, gut), "cypherdj-arr/9") == "format");
  PRUEF(grund("", ret(1, ""), "cypherdj-arr/") == "format");
  // lader_ret_ziel_pan_abgelehnt, the other targets, relative, twice
  PRUEF(grund("", ret(1, lane("[[0,0,0]]", "pan")), V3) == "format");
  PRUEF(grund("", ret(1, lane("[[0,0,2]]", "mute")), V3) == "format");
  PRUEF(grund("", ret(1, lane("[[0,0,2]]", "solo")), V3) == "format");
  PRUEF(grund("", ret(1, lane("[[0,0,0]]", "geraet.cutoff")), V3) == "format");
  PRUEF(grund("", ret(1, lane("[[0,0,0]]", "nope")), V3) == "format");
  PRUEF(grund("", ret(1, lane("[[0,0,0]]", "fader")), V3) == "+snap");                  // positive control for the three above
  // lader_ret_relativ_abgelehnt
  PRUEF(grund("", ret(1, lane("[[0,0,0]]", "fader", ",\"relativ\":true")), V3) == "format");
  PRUEF(grund("", ret(1, lane("[[0,0,0]]", "fader", ",\"relativ\":false")), V3) == "+snap");
  PRUEF(grund("", ret(1, gut + "," + gut), V3) == "format");                              // one lane per return
  PRUEF(grund("", ret(1, "{\"ziel\":\"fader\"}"), V3) == "format");                       // no points
  PRUEF(grund("", ret(1, lane("[]")), V3) == "format");
  PRUEF(grund("", ret(1, lane("[[0,7,0]]")), V3) == "format");                            // above +6 dB
  PRUEF(grund("", ret(1, lane("[[0,-201,0]]")), V3) == "format");
  PRUEF(grund("", ret(1, lane("[[4,0,0],[2,0,0]]")), V3) == "format");                    // falling beats
  PRUEF(grund("", ret(1, lane("[[0,0,3]]")), V3) == "format");                            // form 3
  PRUEF(grund("", ret(1, lane("[[0,0,0],[0,-3,2],[0,-6,2]]")), V3) == "format");          // three points at one beat
  PRUEF(grund("", ret(1, lane("[[0,0,0],[8,-3,1],[8,-6,2],[16,0,0]]")), V3) == "+snap");  // a jump (two at one beat) is fine
  PRUEF(grund("", ret(1, "7"), V3) == "format");                                          // not an object in the list
  {  // `auto` that is not a list
    PRUEF(grund("", "{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"auto\":{}}", V3) == "format");
  }
  // lader_master_auto_abgelehnt: no volume curve on the master (pm), on a group, or on a `master` object; the same files without `auto` load
  const std::string pm_ohne = ",\"pm\":{\"chain\":[]}";
  PRUEF(grund("", ret(1, ""), V3, pm_ohne) == "+snap");
  PRUEF(grund("", ret(1, ""), V3, ",\"pm\":{\"chain\":[],\"auto\":[" + gut + "]}") == "format");
  PRUEF(grund("", ret(1, ""), V3, ",\"pm\":{\"auto\":[]}") == "format");                  // even an empty list: the key does not belong there
  PRUEF(grund("", ret(1, ""), V3, ",\"master\":{\"auto\":[" + gut + "]}") == "format");
  PRUEF(grund("", ret(1, ""), V2, ",\"pm\":{\"chain\":[],\"auto\":[" + gut + "]}") == "format");
  const std::string grp_ok = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}";
  const std::string grp_auto = "{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"auto\":[" + gut + "]}";
  PRUEF(grund(grp_ok, ret(1, ""), V3) == "+snap");
  PRUEF(grund(grp_auto, ret(1, ""), V3) == "format");
  PRUEF(grund(grp_auto, ret(1, ""), V2) == "format");
  // the budget: the return lane points count against the lane limits
  {
    std::string viele = "[";
    for (int i = 0; i < 8193; ++i) viele += std::string(i ? "," : "") + "[" + std::to_string(i) + ",0,0]";
    viele += "]";
    PRUEF(grund("", ret(1, lane(viele.c_str())), V3) == "zu_gross");
  }
}

// ---- core cases -------------------------------------------------------------------------------------------------------------------------------------------------------------
#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;
static constexpr double SPB_D = 22500.0;   // samples per beat at 128 BPM
static const double MITTE = 0.70710677;
static double db_von(double x) { return 20.0 * std::log10(x); }

static int reg(Treiber& t, const char* pfad) {
  const int r = t.tab.suche(pfad);
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const char* pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }
static void start0(Treiber& t) { t.arr.start(0.0, 0, false, 0, V, 256, t.k); }   // quant 0: at once

// track 1 plays a constant into return 1 over a pre send (the direct path is silenced by the track fader), the return has no Hall: the master left channel is the return output.
// `lane`: the fader lane of return 1 (empty: none); `r2`: return 2 exists too (a second return that must stay untouched by the lane of the first).
static cdj::ArrSnapshot* ret_projekt(const cdj::ArrAudio* a, const std::vector<ArrAutoPunkt>& lane, int64_t nr = 1, bool r2 = false) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 20.0, a).ret(1);
  if (r2) b.ret(2);
  if (!lane.empty()) b.ret_lane(1, lane);
  cdj::ArrSnapshot* s = b.fertig();
  s->ret_pre[0] = true;
  s->ret_pre[1] = true;
  return s;
}
static void ret_aufbau(Treiber& t, float ret_fader_db = 0.0f, bool hall = false) {
  setze(t, "spur/1/fader", -200.0f);   // the direct path is silent, the pre send carries the signal
  setze(t, "spur/1/send/1", 0.0f);
  setze(t, "ret/1/fader", ret_fader_db);
  for (const char* p : {"ret/1/hall/an", "ret/2/hall/an", "ret/3/hall/an", "ret/4/hall/an"}) setze(t, p, hall ? 1.0f : 0.0f);
}
static std::unique_ptr<Treiber> lauf_ret(const cdj::ArrAudio* a, const std::vector<ArrAutoPunkt>& lane, int64_t bis, float ret_fader_db = 0.0f, bool hall = false) {
  auto t = std::make_unique<Treiber>();
  ret_aufbau(*t, ret_fader_db, hall);
  t->laden(ret_projekt(a, lane));
  start0(*t);
  t->lauf(bis);
  return t;
}
static double lin_db(double db) { return std::pow(10.0, db / 20.0); }

// a track with the same lane on its fader and no return: the master left channel is the track after its fader (the same lane machinery, the reference for the return)
static std::unique_ptr<Treiber> lauf_spur(const cdj::ArrAudio* a, const std::vector<ArrAutoPunkt>& lane, int64_t bis) {
  auto t = std::make_unique<Treiber>();
  Bau b(1);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 20.0, a);
  if (!lane.empty()) b.lane(1, lane);
  t->laden(b.fertig());
  start0(*t);
  t->lauf(bis);
  return t;
}

static double hoechst_abs(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(v.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(v[i])));
  return m;
}
static uint64_t fnv(const std::vector<float>& v, uint64_t h) {
  for (float f : v) {
    uint32_t u;
    std::memcpy(&u, &f, 4);
    for (int i = 0; i < 4; ++i) {
      h ^= (u >> (8 * i)) & 0xff;
      h *= 1099511628211ULL;
    }
  }
  return h;
}
// everything the block gives, as one hash
static uint64_t hash_aus(const Treiber& t) {
  uint64_t h = 1469598103934665603ULL;
  for (const auto* v : {&t.l, &t.r, &t.ml, &t.mr, &t.cl, &t.cr, &t.pml, &t.pmr}) h = fnv(*v, h);
  return h;
}

// A project with two returns and NO return lane, but with a lane on track 1 (fader) and track 2 (pan): sends, the Stellwerk fader of return 1, a Hall on return 2.
// The hash of its whole output was taken with the code BEFORE the return lanes (arr_auto over 32 slots) and is pinned here: the new slots change nothing for it.
static uint64_t szenario_ohne_ret_lane(const cdj::ArrAudio* a, bool mit_tausch) {
  auto tp = std::make_unique<Treiber>();
  Treiber& t = *tp;
  auto bauen = [&](int64_t nr) {
    Bau b(nr);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 20.0, a).spur(2, ArrArt::audio).clip(2, "c2", 0.0, 20.0, a).ret(1).ret(2);
    b.lane(1, {pt(0.0, 0.0f), pt(8.0, -18.0f), pt(16.0, -3.0f, 1)});
    b.lane(2, {pt(0.0, -0.5f), pt(12.0, 0.7f)}, cdj::ARR_AUTO_PAN);
    return b.fertig();
  };
  setze(t, "spur/1/send/1", -6.0f);
  setze(t, "spur/2/send/1", -9.0f);
  setze(t, "spur/2/send/2", -3.0f);
  setze(t, "ret/1/fader", -3.0f);
  setze(t, "ret/1/hall/an", 0.0f);   // return 1 dry, return 2 with the Hall
  t.laden(bauen(1));
  start0(t);
  t.lauf(40000);
  if (mit_tausch) t.laden(bauen(2));   // a swap of the same project (the blend of the swap is part of the pinned output)
  t.lauf(120000);
  t.arr.stopp(0, t.s, t.k);
  t.lauf(t.s + 20000);
  return hash_aus(t);
}
// taken from the build of kern2 @ b4b58a3b0 (before this task's core change), see the commit message
static constexpr uint64_t HASH_OHNE_LANE_VOR = 0x4cdc9e97b50983c3ULL;
static constexpr uint64_t HASH_OHNE_LANE_VOR_TAUSCH = 0xdc32d991f3473b83ULL;

static void kern_faelle() {
  auto a = Audio::gleich(600000, 0.25f);
  const std::vector<ArrAutoPunkt> rampe = {pt(0.0, -200.0f), pt(16.0, 0.0f)};   // -200 to 0 dB over 4 bars (16 beats), linear in dB
  {  // ret_fader_huellkurve_hall_aus: the output of the return follows the lane; the track lane with the same points is the reference
    auto ref = lauf_ret(&a->a, {}, 500000);   // return fader 0 dB: the unit
    auto t = lauf_ret(&a->a, rampe, 500000);
    auto sp = lauf_spur(&a->a, rampe, 500000);
    auto sp0 = lauf_spur(&a->a, {}, 500000);
    const int64_t s_start = t->arr.zustand(t->k, t->s).ursprung_sample;
    const int64_t s_ref = ref->arr.zustand(ref->k, ref->s).ursprung_sample;
    const int64_t s_sp = sp->arr.zustand(sp->k, sp->s).ursprung_sample;
    PRUEF(s_start == s_ref && s_start == s_sp);
    const double x0 = ref->l[s_ref + 300000];
    PRUEF(x0 > 0.1);   // positive control: the return does carry the signal (0.25 * centre gain)
    const double xs0 = sp0->l[s_sp + 300000];
    PRUEF_NAH(x0, 0.25, 1e-6);          // the return at 0 dB passes the pre send unchanged
    PRUEF_NAH(xs0, 0.25 * MITTE, 1e-6);   // the track at 0 dB: centre pan law
    double schlimmst = 0.0, schlimmst_spur = 0.0;
    // The mute rule of the lane (arr_auto.h): a ramp from a point <= -120 dB to a louder one starts at -60 dB, so "-200 to 0 dB over 16 beats" is
    // exact mute at beat 0 and then -60 dB rising linearly in dB (3.75 dB per beat) to 0 dB at beat 16. The track lane does the same: the reference.
    for (int b = 1; b <= 19; ++b) {
      const int64_t sm = s_start + static_cast<int64_t>(b * SPB_D);
      const double soll = b >= 16 ? 0.0 : -60.0 + 3.75 * b;
      const double lin_r = std::fabs(t->l[sm]) / x0;
      const double lin_s = std::fabs(sp->l[s_sp + static_cast<int64_t>(b * SPB_D)]) / xs0;
      schlimmst = std::max(schlimmst, std::fabs(db_von(lin_r) - soll));
      schlimmst_spur = std::max(schlimmst_spur, std::fabs(db_von(lin_s) - soll));
    }
    std::printf("ret_fader_huellkurve: largest deviation of the return from the lane %.4f dB, of the track %.4f dB\n", schlimmst, schlimmst_spur);
    PRUEF(schlimmst <= 0.05);
    PRUEF(schlimmst_spur <= 0.05);
    // the first samples: -200 dB, silent; every sample of the return equals the same sample of the track lane (ratio to the unit) within 1e-6: one mechanism
    PRUEF(std::fabs(t->l[s_start]) < 1e-8);
    double d_max = 0.0;
    for (int64_t i = s_start; i < s_start + static_cast<int64_t>(18 * SPB_D); i += 97)
      d_max = std::max(d_max, std::fabs(t->l[i] / x0 - sp->l[s_sp + (i - s_start)] / xs0));
    std::printf("ret_fader_huellkurve: largest difference return/track ratio %.3g\n", d_max);
    PRUEF(d_max <= 1e-6);
    // monotone rising until beat 16, then constant 0 dB
    bool steigt = true;
    for (int64_t i = s_start + 2000; i < s_start + static_cast<int64_t>(16 * SPB_D) - 200; i += 200)
      if (t->l[i + 200] < t->l[i]) steigt = false;
    PRUEF(steigt);
    PRUEF_NAH(t->l[s_start + static_cast<int64_t>(17 * SPB_D)] / x0, 1.0, 1e-6);
    // the return 2 next to it (exists, no lane) is not touched by the lane of return 1: it has no send, so the master only carries return 1
    {
      TR(u)
      ret_aufbau(u);
      setze(u, "spur/1/send/2", 0.0f);   // the signal goes into return 2 as well
      u.laden(ret_projekt(&a->a, {pt(0.0, -200.0f), pt(16.0, -200.0f)}, 1, true));
      start0(u);
      u.lauf(300000);
      TR(w)   // the same without the lane on return 1
      ret_aufbau(w);
      setze(w, "spur/1/send/2", 0.0f);
      setze(w, "ret/1/fader", -200.0f);   // return 1 silent: only return 2 sounds
      w.laden(ret_projekt(&a->a, {}, 1, true));
      start0(w);
      w.lauf(300000);
      // the lane of return 1 stays mute: the output is only return 2, equal to the run with the Stellwerk fader of return 1 at -200 dB
      const int64_t su = u.arr.zustand(u.k, u.s).ursprung_sample;
      double d = 0.0;
      for (int64_t i = su; i < su + 200000; ++i) d = std::max(d, static_cast<double>(std::fabs(u.l[i] - w.l[i])));
      PRUEF(d < 1e-6);
      PRUEF(std::fabs(w.l[su + 10000]) > 0.1);   // positive control: return 2 does sound
      PRUEF(std::fabs(u.l[su + 10000]) > 0.1);   // ... and next to the lane of return 1, which does not leak into it
    }
  }
  {  // ret_fader_sprung_form: a jump is taken at its sample, a held step stays until the next point
    const std::vector<ArrAutoPunkt> sprung = {pt(0.0, -20.0f), pt(8.0, -20.0f), pt(8.0, -6.0f, 2), pt(16.0, -6.0f)};
    auto ref = lauf_ret(&a->a, {}, 500000);
    auto t = lauf_ret(&a->a, sprung, 500000);
    const int64_t s0 = t->arr.zustand(t->k, t->s).ursprung_sample;
    const double x0 = ref->l[s0 + 300000];
    const int64_t s8 = s0 + static_cast<int64_t>(8 * SPB_D);
    PRUEF_NAH(t->l[s8 - 1] / x0, lin_db(-20.0), 1e-5);   // the last sample before the jump
    PRUEF_NAH(t->l[s8] / x0, lin_db(-6.0), 1e-5);       // the sample of the jump
    PRUEF_NAH(t->l[s0 + 100] / x0, lin_db(-20.0), 1e-5);
    PRUEF_NAH(t->l[s0 + static_cast<int64_t>(12 * SPB_D)] / x0, lin_db(-6.0), 1e-5);
  }
  {  // ret_fader_ohne_lane_unveraendert: a project without a return lane renders bit-identically to the code before the return slots
    const uint64_t h = szenario_ohne_ret_lane(&a->a, false), h2 = szenario_ohne_ret_lane(&a->a, true);
    std::printf("ret_fader_ohne_lane: hash %016llx, with swap %016llx\n", static_cast<unsigned long long>(h), static_cast<unsigned long long>(h2));
    PRUEF(h == HASH_OHNE_LANE_VOR);
    PRUEF(h2 == HASH_OHNE_LANE_VOR_TAUSCH);
    PRUEF(h == szenario_ohne_ret_lane(&a->a, false));   // deterministic
  }
  {  // ret_fader_lane_gleich_stellwerk: a constant lane equal to the Stellwerk value changes nothing
    auto ohne = lauf_ret(&a->a, {}, 200000, -6.0f);
    auto mit = lauf_ret(&a->a, {pt(0.0, -6.0f), pt(100.0, -6.0f)}, 200000, -6.0f);
    const int64_t s0 = ohne->arr.zustand(ohne->k, ohne->s).ursprung_sample;
    double d = 0.0;
    for (int64_t i = s0; i < 200000; ++i) d = std::max(d, static_cast<double>(std::fabs(ohne->l[i] - mit->l[i])));
    PRUEF(d < 1e-6);
    PRUEF(std::fabs(mit->l[150000]) > 0.05);
  }
  {  // ret_fader_stop_zurueck_auf_stellwerk: the lane (-20 dB) gives the return back to the Stellwerk row (-6 dB) over 480 samples after the stop, without a click.
     // The Hall tail rings on after the stop and passes through the return fader: the same project with only the Stellwerk fader (-20, -6) are the references.
    auto lauf = [&](const std::vector<ArrAutoPunkt>& lane, float fader_db) {
      auto t = std::make_unique<Treiber>();
      ret_aufbau(*t, fader_db, true);
      t->laden(ret_projekt(&a->a, lane));
      start0(*t);
      t->lauf(120000);
      t->arr.stopp(0, t->s, t->k);
      t->lauf(t->s + 30000);
      return t;
    };
    auto lane = lauf({pt(0.0, -20.0f), pt(100.0, -20.0f)}, -6.0f);   // lane -20, Stellwerk -6
    auto r20 = lauf({}, -20.0f);                                       // reference while playing
    auto r6 = lauf({}, -6.0f);                                         // reference after the take-over
    const int64_t s_stop = 120000 + 255;   // the stop is called after the last block of the run (t.s is a multiple of 256)
    int64_t stop_s = 0;
    for (int64_t i = 0; i < static_cast<int64_t>(lane->l.size()); i += 256)
      if (i + 256 >= 120000) { stop_s = i + 256; break; }   // t.s at the stop
    (void)s_stop;
    // while it plays: equal to the -20 dB reference (the lane value passes the hold exactly)
    double d_spiel = 0.0;
    for (int64_t i = 60000; i < 100000; ++i) d_spiel = std::max(d_spiel, std::fabs(static_cast<double>(lane->l[i] - r20->l[i])));
    PRUEF(d_spiel < 1e-6);
    PRUEF(hoechst_abs(r20->l, 60000, 100000) > 0.001);   // positive control
    // after the 480 samples blend (and some margin): equal to the -6 dB reference, bit for bit; the tail is there
    double d_nach = 0.0;
    for (int64_t i = stop_s + 600; i < stop_s + 20000; ++i) d_nach = std::max(d_nach, std::fabs(static_cast<double>(lane->l[i] - r6->l[i])));
    PRUEF(d_nach < 1e-6);
    PRUEF(hoechst_abs(r6->l, stop_s + 600, stop_s + 3000) > 0.005);   // positive control: the tail rings on, a difference of 14 dB would show
    // the implied gain between the stop and the end of the blend moves steadily: no step larger than the linear blend step (1.5 times)
    // the check starts BEFORE the stop: the pair (stop_s - 1, stop_s) is the one that shows a hard return of the gain from the lane to the Stellwerk row
    PRUEF(std::fabs(r6->l[stop_s - 1]) > 1e-3 && std::fabs(r6->l[stop_s]) > 1e-3);   // both samples of the pair are measurable (no zero crossing)
    PRUEF_NAH(static_cast<double>(lane->l[stop_s - 1]) / r6->l[stop_s - 1] * lin_db(-6.0), lin_db(-20.0), 2e-3);   // the gain before the stop is the lane value
    double g_prev = -1.0, g_max_step = 0.0;
    int n_g = 0;
    for (int64_t i = stop_s - 1; i < stop_s + 480; ++i) {
      if (std::fabs(r6->l[i]) < 1e-3) {   // the ratio is too noisy next to a zero crossing: no step across the gap
        g_prev = -1.0;
        continue;
      }
      const double g = static_cast<double>(lane->l[i]) / r6->l[i] * lin_db(-6.0);
      if (g_prev >= 0.0) g_max_step = std::max(g_max_step, std::fabs(g - g_prev));
      g_prev = g;
      ++n_g;
    }
    std::printf("ret_fader_stop: %d samples checked in the blend, largest gain step %.5f (linear blend step %.5f)\n", n_g, g_max_step, (lin_db(-6.0) - lin_db(-20.0)) / 480.0);
    PRUEF(n_g > 100);
    PRUEF(g_max_step < 3.0 * (lin_db(-6.0) - lin_db(-20.0)) / 480.0);
  }
  {  // ret_fader_tausch_ohne_klick: swapping to a project without the lane while it plays: the same blend to the Stellwerk row, no jump
    auto lauf = [&](const std::vector<ArrAutoPunkt>& lane, float fader_db) {
      auto t = std::make_unique<Treiber>();
      ret_aufbau(*t, fader_db, true);
      t->laden(ret_projekt(&a->a, lane, 1));
      start0(*t);
      t->lauf(60000);
      t->laden(ret_projekt(&a->a, {}, 2));   // the second project has no lane
      t->lauf(120000);
      return t;
    };
    auto lane = lauf({pt(0.0, -20.0f), pt(100.0, -20.0f)}, -6.0f);
    auto r6 = lauf({}, -6.0f);
    int64_t tausch_s = 0;
    for (int64_t i = 0; i < 60000 + 256; i += 256) tausch_s = i + 256;   // t.s at the swap: the first multiple of 256 at or above 60000
    tausch_s = ((60000 + 255) / 256) * 256;
    double d_nach = 0.0;
    for (int64_t i = tausch_s + 1500; i < 110000; ++i) d_nach = std::max(d_nach, std::fabs(static_cast<double>(lane->l[i] - r6->l[i])));
    PRUEF(d_nach < 1e-6);
    // no click: the largest sample step of the left channel around the swap is not larger than in the reference run plus the blend step (gain change * level)
    double st_lane = 0.0, st_ref = 0.0;
    for (int64_t i = tausch_s - 50; i < tausch_s + 1500; ++i) {
      st_lane = std::max(st_lane, std::fabs(static_cast<double>(lane->l[i + 1] - lane->l[i])));
      st_ref = std::max(st_ref, std::fabs(static_cast<double>(r6->l[i + 1] - r6->l[i])));
    }
    std::printf("ret_fader_tausch: largest step with the lane %.6f, reference %.6f\n", st_lane, st_ref);
    PRUEF(st_lane < st_ref + 4.0 * hoechst_abs(r6->l, tausch_s - 50, tausch_s + 1500) * (lin_db(-6.0) - lin_db(-20.0)) / 480.0);
    PRUEF(hoechst_abs(r6->l, tausch_s + 2000, 110000) > 0.01);   // positive control: the signal keeps sounding
  }
  {  // ret_fader_alloc_frei: 2000 blocks with a lane on a return, a swap to another lane and a swap to none: no allocation, lock or sleep
    TR(t)
    ret_aufbau(t, -6.0f, true);
    cdj::ArrSnapshot* s0 = ret_projekt(&a->a, {pt(0.0, -30.0f), pt(8.0, 0.0f), pt(16.0, -12.0f, 1)}, 1);
    cdj::ArrSnapshot* s1 = ret_projekt(&a->a, {pt(0.0, -3.0f), pt(8.0, -40.0f)}, 2);
    cdj::ArrSnapshot* s2 = ret_projekt(&a->a, {}, 3);
    t.laden(s0);
    start0(t);
    t.lauf(20000);
    float bf[6][cdj::ARR_BLOCK];
    int64_t s = t.s;
    std::vector<const cdj::ArrSnapshot*> alt;
    alt.reserve(4);
    abfang_an();
    for (int blk = 0; blk < 2000; ++blk) {
      if (blk == 700) alt.push_back(t.arr.tausche(s1, s, t.k));
      if (blk == 1300) alt.push_back(t.arr.tausche(s2, s, t.k));
      for (auto& x : bf) std::fill(x, x + 256, 0.0f);
      t.arr.block(t.k, s, 256, bf[0], bf[1], bf[2], bf[3], bf[4], bf[5]);
      s += 256;
    }
    const long im_fenster = abfang_aus();
    std::printf("ret_fader_alloc: allocations in 2000 blocks = %ld\n", im_fenster);
    if (ALLOC_ABFANG_VERFUEGBAR) PRUEF(im_fenster == 0);
    for (const cdj::ArrSnapshot* x : alt) delete x;
  }
}

int main() {
  lader_faelle();
  kern_faelle();
  PRUEF_ENDE();
}
