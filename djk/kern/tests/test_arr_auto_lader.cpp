// Automation Slice 1, task 4 (AK3): the loader reads `auto` per track in cypherdj-arr/2 (ADR 032). A lane has a target (fader, pan, mute, solo, geraet.*; slice 2) and points
// [beat, wert dB, formcode]; beats not falling (two at one beat are a jump, three are not), wert -200..6, form 0..2, at most 8192 points
// per lane (zu_gross), 65536 per playback (zu_gross). /1 knows no `auto`. An error leaves the previous playback running (here: the result
// carries no snapshot, the caller keeps the old one). Every error case has its positive control.
// The point storage sits in the booked, locked pages of the snapshot (account), nothing stays after release.
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/arr_wiedergabe.h"
#include "pruef.h"

using P = std::vector<std::tuple<double, double, int>>;
static const int64_t F = 48000;

int main() {
  arrdatei::Ordner o("test_arr_auto_lader");
  const std::string a = o.audio('a', F);
  cdj::SpeicherKonto konto(200LL << 20);
  cdj::ArrAudioCache cache(&konto, 100LL << 20, false);
  int64_t nr = 100;
  const auto spur = [&](const std::string& lanes) {
    return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 4.0, a, F) + "]" + (lanes.empty() ? "" : ",\"auto\":[" + lanes + "]") + "}";
  };
  const auto grund = [&](bool v2, const std::string& spuren) {
    ++nr;
    if (v2) o.wiedergabe2_auto(nr, spuren); else o.wiedergabe(nr, spuren);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    const std::string g = e.snap ? "" : e.grund;
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    return g;
  };
  const P gut = {{0.0, 0.0, 0}, {16.0, -30.0, 0}};
  const auto mit = [&](const P& p) { return spur(o.auto_lane(p)); };
  {  // (a) /2 with a lane loads: fields, pointers
    ++nr;
    o.wiedergabe2_auto(nr, spur(o.auto_lane({{0.0, 0.0, 0}, {8.0, -6.0, 1}, {8.0, -12.0, 2}, {16.0, -30.0, 0}})));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSpur& s = e.snap->spur[0];
      PRUEF(s.n_auto == 1 && s.auto_lanes != nullptr);
      if (s.n_auto == 1) {
        const cdj::ArrAutoLane& l = s.auto_lanes[0];
        PRUEF(l.ziel == cdj::ARR_AUTO_FADER && l.n == 4);
        if (l.n == 4) {
          PRUEF(l.p[0].beat == 0.0 && l.p[0].wert == 0.0f && l.p[0].form == 0);
          PRUEF(l.p[1].beat == 8.0 && l.p[1].wert == -6.0f && l.p[1].form == 1);
          PRUEF(l.p[2].beat == 8.0 && l.p[2].wert == -12.0f && l.p[2].form == 2);
          PRUEF(l.p[3].beat == 16.0 && l.p[3].wert == -30.0f);
        }
      }
      PRUEF(e.snap->n_auto_lanes == 1 && e.snap->auto_punkte.size() == 4);
      PRUEF(sizeof(cdj::ArrAutoPunkt) == 16);
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // (h) /2 without auto loads unchanged; tracks without a lane have n_auto 0
    ++nr;
    o.wiedergabe2_auto(nr, spur(""));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(e.snap && e.snap->spur[0].n_auto == 0 && e.snap->spur[0].auto_lanes == nullptr && e.snap->n_auto_lanes == 0);
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(grund(false, spur("")).empty());   // /1 without auto loads as before
  }
  {  // (b) /1 with auto: format; the positive control, the same file in /2, loads
    PRUEF(grund(true, mit(gut)).empty());
    PRUEF(grund(false, mit(gut)) == "format");
  }
  {  // (c) targets (slice 2): every target loads on its own track kind; the same file with a bad target or value is refused
    const P bin = {{0.0, 0.0, 2}, {4.0, 1.0, 2}};
    const P norm = {{0.0, 0.0, 0}, {4.0, 1.0, 0}};
    const auto intern = [&](const std::string& lanes) {
      return "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]" + (lanes.empty() ? "" : ",\"auto\":[" + lanes + "]") + "}";
    };
    PRUEF(grund(true, spur(o.auto_lane(gut, "fader"))).empty());
    PRUEF(grund(true, spur(o.auto_lane({{0.0, -1.0, 0}, {4.0, 1.0, 1}}, "pan"))).empty());
    PRUEF(grund(true, spur(o.auto_lane(bin, "mute"))).empty());
    PRUEF(grund(true, spur(o.auto_lane(bin, "solo"))).empty());
    for (const char* z : {"geraet.lautstaerke", "geraet.cutoff", "geraet.resonanz", "geraet.env_mod"}) {
      PRUEF(grund(true, intern(o.auto_lane(norm, z))).empty());     // positive control: the device target on an internal track
      PRUEF(grund(true, spur(o.auto_lane(norm, z))) == "format");   // the same lane on an audio track
    }
    PRUEF(grund(true, intern(o.auto_lane(norm, "geraet.decay"))) == "format");       // only four device parameters
    PRUEF(grund(true, intern(o.auto_lane(norm, "geraet.wellenform"))) == "format");
    PRUEF(grund(true, intern(o.auto_lane(norm, "geraet.accent"))) == "format");
    PRUEF(grund(true, intern(o.auto_lane(norm, "geraet.cutoff") + "," + o.auto_lane(norm, "geraet.resonanz"))).empty());   // two device lanes, different parameters
    PRUEF(grund(true, intern(o.auto_lane(norm, "geraet.cutoff") + "," + o.auto_lane(norm, "geraet.cutoff"))) == "format");   // the same parameter twice
    PRUEF(grund(true, spur(o.auto_lane(gut, "bogus"))) == "format");
    PRUEF(grund(true, spur(o.auto_lane({{0.0, 1.5, 0}, {4.0, 0.0, 0}}, "pan"))) == "format");    // pan above 1
    PRUEF(grund(true, spur(o.auto_lane({{0.0, -1.5, 0}, {4.0, 0.0, 0}}, "pan"))) == "format");   // pan below -1
    PRUEF(grund(true, intern(o.auto_lane({{0.0, 1.5, 0}, {4.0, 0.0, 0}}, "geraet.cutoff"))) == "format");   // device value above 1
    PRUEF(grund(true, spur(o.auto_lane({{0.0, 0.5, 2}, {4.0, 1.0, 2}}, "mute"))) == "format");   // mute 0.5
    PRUEF(grund(true, spur(o.auto_lane({{0.0, 0.0, 0}, {4.0, 1.0, 2}}, "mute"))) == "format");   // mute with form 0
    PRUEF(grund(true, spur(o.auto_lane({{0.0, 0.0, 2}, {4.0, 1.0, 1}}, "solo"))) == "format");   // solo with form 1
    PRUEF(grund(true, spur(o.auto_lane(bin, "mute") + "," + o.auto_lane(bin, "mute"))) == "format");   // two mute lanes
    PRUEF(grund(true, spur(o.auto_lane(gut, "fader") + "," + o.auto_lane({{0.0, 0.0, 0}, {4.0, 1.0, 0}}, "pan"))).empty());   // two targets
    {  // all eight on one internal track: the order is kept, ziel and param are filled from the one table
      ++nr;
      o.wiedergabe2_auto(nr, intern(o.auto_lane(gut, "fader") + "," + o.auto_lane(norm, "pan") + "," + o.auto_lane(bin, "mute") + "," +
                                    o.auto_lane(bin, "solo") + "," + o.auto_lane(norm, "geraet.lautstaerke") + "," + o.auto_lane(norm, "geraet.cutoff") +
                                    "," + o.auto_lane(norm, "geraet.resonanz") + "," + o.auto_lane(norm, "geraet.env_mod")));
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(e.snap && e.snap->spur[0].n_auto == 8);
      if (e.snap && e.snap->spur[0].n_auto == 8) {
        const cdj::ArrAutoLane* l = e.snap->spur[0].auto_lanes;
        const uint8_t ziel[8] = {cdj::ARR_AUTO_FADER, cdj::ARR_AUTO_PAN, cdj::ARR_AUTO_MUTE, cdj::ARR_AUTO_SOLO,
                                 cdj::ARR_AUTO_GERAET, cdj::ARR_AUTO_GERAET, cdj::ARR_AUTO_GERAET, cdj::ARR_AUTO_GERAET};
        const uint8_t param[8] = {0, 0, 0, 0, 0, 1, 2, 3};
        for (int i = 0; i < 8; ++i) PRUEF(l[i].ziel == ziel[i] && l[i].param == param[i]);
        const char* zn[4] = {"geraet.lautstaerke", "geraet.cutoff", "geraet.resonanz", "geraet.env_mod"};
        for (int i = 4; i < 8; ++i)   // the parameter name of a device lane is the suffix of its target string
          PRUEF(std::string(cdj::ARR_GERAET_PARAM_NAME[l[i].param]) == std::string(zn[i - 4]).substr(7));
        PRUEF(e.snap->n_auto_lanes == 8);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
  }
  {  // (c2) slice 2 / 1.12: geraet.* lanes belong to the RB-338 only; a bk track (also art "intern") refuses them, its other lanes load
    cdj::SpeicherKonto konto2(200LL << 20);
    cdj::ArrAudioCache cache2(&konto2, 100LL << 20, false);
    const std::string bk = o.pfad + "/bk";
    std::filesystem::create_directories(bk);
    std::ofstream(bk + "/t.json")
        << R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"o.x"}]})";
    cache2.setze_bk_ordner(bk);
    const P norm = {{0.0, 0.0, 0}, {4.0, 1.0, 0}};
    const auto bkspur = [&](const std::string& lanes) {
      return "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"t\",\"parameter\":{},\"noten\":[]" + (lanes.empty() ? "" : ",\"auto\":[" + lanes + "]") + "}";
    };
    const auto lade2 = [&](const std::string& spuren) {
      ++nr;
      o.wiedergabe2_auto(nr, spuren);
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache2);
      const std::string g = e.snap ? "" : e.grund;
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache2);
      PRUEF(cache2.eintraege() == 0 && konto2.gesperrt() == 0);   // refused or released: nothing stays booked
      return g;
    };
    PRUEF(lade2(bkspur("")).empty());                                  // positive control: the bk track loads
    PRUEF(lade2(bkspur(o.auto_lane({{0.0, -1.0, 0}, {4.0, 1.0, 0}}, "pan"))).empty());   // a pan lane on a bk track loads
    for (const char* z : {"geraet.lautstaerke", "geraet.cutoff", "geraet.resonanz", "geraet.env_mod"})
      PRUEF(lade2(bkspur(o.auto_lane(norm, z))) == "format");           // the device target on a bk track is refused (rb338: line above loads)
  }
  {  // (d)(e) beats, values, forms
    PRUEF(grund(true, mit({{8.0, 0.0, 0}, {4.0, 0.0, 0}})) == "format");                           // falling
    PRUEF(grund(true, mit({{4.0, 0.0, 0}, {4.0, -3.0, 0}, {4.0, -6.0, 0}})) == "format");          // three at one beat
    PRUEF(grund(true, mit({{4.0, 0.0, 0}, {4.0, -3.0, 0}})).empty());                              // two: a jump, valid
    PRUEF(grund(true, mit({{0.0, 6.5, 0}, {4.0, 0.0, 0}})) == "format");                           // above +6
    PRUEF(grund(true, mit({{0.0, -200.5, 0}, {4.0, 0.0, 0}})) == "format");                        // below -200
    PRUEF(grund(true, mit({{0.0, 6.0, 0}, {4.0, -200.0, 0}})).empty());                            // limits inclusive
    PRUEF(grund(true, mit({{-1.0, 0.0, 0}, {4.0, 0.0, 0}})) == "format");                          // beat negative
    PRUEF(grund(true, mit({{0.0, 0.0, 3}, {4.0, 0.0, 0}})) == "format");                           // form 3
    PRUEF(grund(true, mit({{0.0, 0.0, 0}, {4.0, 0.0, 2}})).empty());                               // form 2 valid
    PRUEF(grund(true, mit({})) == "format");                                                       // no points
    PRUEF(grund(true, spur(o.auto_lane(gut) + "," + o.auto_lane(gut))) == "format");               // two lanes on fader
    // text as a value: not a number
    PRUEF(grund(true, spur("{\"ziel\":\"fader\",\"punkte\":[[0,\"x\",0],[4,0,0]]}")) == "format");
    PRUEF(grund(true, spur("{\"ziel\":\"fader\",\"punkte\":[[0,0],[4,0,0]]}")) == "format");        // not a triple
    PRUEF(grund(true, spur("{\"ziel\":\"fader\"}")) == "format");                                   // punkte missing
  }
  {  // (f) limits
    P viele;
    for (int i = 0; i < 8193; ++i) viele.push_back({static_cast<double>(i), 0.0, 0});
    PRUEF(grund(true, mit(viele)) == "zu_gross");
    viele.pop_back();
    PRUEF(grund(true, mit(viele)).empty());   // 8192 pass
    // total limit 65536: eight tracks of 8192 pass, a ninth lane with one point does not
    const auto n_spuren = [&](int n, int extra) {
      std::string s;
      for (int k = 1; k <= n; ++k) {
        s += std::string(k > 1 ? "," : "") + "{\"nr\":" + std::to_string(k) + ",\"art\":\"audio\",\"clips\":[],\"auto\":[" + o.auto_lane(viele) + "]}";
      }
      if (extra) s += ",{\"nr\":" + std::to_string(n + 1) + ",\"art\":\"audio\",\"clips\":[],\"auto\":[" + o.auto_lane({{0.0, 0.0, 0}}) + "]}";
      return s;
    };
    PRUEF(grund(true, n_spuren(8, 0)).empty());
    PRUEF(grund(true, n_spuren(8, 1)) == "zu_gross");
  }
  {  // (g) the point storage sits in booked pages: before/after on the same snapshot
    ++nr;
    o.wiedergabe2_auto(nr, spur(""));
    cdj::ArrLadeErgebnis ohne = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(ohne.snap != nullptr);
    const int64_t b0 = ohne.snap ? ohne.snap->gesperrt_bytes : 0;
    cdj::gib_wiedergabe(ohne.snap.release(), cache);
    P viele;
    for (int i = 0; i < 100; ++i) viele.push_back({static_cast<double>(i), 0.0, 0});
    ++nr;
    o.wiedergabe2_auto(nr, mit(viele));
    cdj::ArrLadeErgebnis mitl = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(mitl.snap != nullptr);
    if (mitl.snap) {
      const int64_t b1 = mitl.snap->gesperrt_bytes;
      PRUEF(b1 >= b0 + static_cast<int64_t>(100 * sizeof(cdj::ArrAutoPunkt)));
      PRUEF(konto.gesperrt() == F * 8 + cdj::arr_audio_kopf() + b1);
    }
    cdj::gib_wiedergabe(mitl.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // an error leaves no account behind, a loaded state stays untouched (the caller keeps the old snapshot)
    ++nr;
    o.wiedergabe2_auto(nr, mit(gut));
    cdj::ArrLadeErgebnis alt = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(alt.snap != nullptr);
    const int64_t vorher = konto.gesperrt();
    ++nr;
    o.wiedergabe2_auto(nr, mit({{8.0, 0.0, 0}, {4.0, 0.0, 0}}));
    cdj::ArrLadeErgebnis kaputt = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(!kaputt.snap && kaputt.grund == "format");
    PRUEF(konto.gesperrt() == vorher);
    PRUEF(alt.snap && alt.snap->spur[0].n_auto == 1 && alt.snap->spur[0].auto_lanes[0].n == 2);
    ++nr;   // slice 2: a refused new target (pan 1.5) leaves the loaded one as well
    o.wiedergabe2_auto(nr, spur(o.auto_lane({{0.0, 1.5, 0}, {4.0, 0.0, 0}}, "pan")));
    cdj::ArrLadeErgebnis kaputt2 = cdj::lade_wiedergabe(o.pfad, nr, cache);
    PRUEF(!kaputt2.snap && kaputt2.grund == "format");
    PRUEF(konto.gesperrt() == vorher);
    PRUEF(alt.snap && alt.snap->spur[0].n_auto == 1 && alt.snap->spur[0].auto_lanes[0].ziel == cdj::ARR_AUTO_FADER);
    cdj::gib_wiedergabe(alt.snap.release(), cache);
  }
  {  // 1.12 slice 5 U8a T8.1: `gain_hk` on an audio clip, the gain envelope of that loop copy [copy beat, dB, formcode] (cypherdj-arr/2 only)
    const auto hk_text = [](const P& p) {
      std::string t = "[";
      char b[96];
      for (size_t i = 0; i < p.size(); ++i) {
        std::snprintf(b, sizeof b, "%s[%.17g,%.17g,%d]", i ? "," : "", std::get<0>(p[i]), std::get<1>(p[i]), std::get<2>(p[i]));
        t += b;
      }
      return t + "]";
    };
    const auto clip_hk = [&](const char* id, const std::string& hk) {
      std::string c = o.clip(id, 0.0, 4.0, a, F);
      if (!hk.empty()) c.insert(c.size() - 1, ",\"gain_hk\":" + hk);
      return c;
    };
    const auto spur_hk = [&](const std::string& hk, const std::string& lanes = "") {
      return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clip_hk("c1", hk) + "]" + (lanes.empty() ? "" : ",\"auto\":[" + lanes + "]") + "}";
    };
    const P hk_gut = {{0.0, -12.0, 0}, {2.0, -6.0, 1}, {4.0, 0.0, 0}};
    {  // (a) /2 loads: the table, its form codes, and a clip without gain_hk has none
      ++nr;
      o.wiedergabe2_auto(nr, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clip_hk("c1", hk_text(hk_gut)) + "," + o.clip("c2", 8.0, 4.0, a, F) + "]}");
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(e.snap && e.grund.empty());
      if (e.snap && e.snap->spur[0].n_clips == 2) {
        const cdj::ArrClip& c1 = e.snap->spur[0].clips[0];
        const cdj::ArrClip& c2 = e.snap->spur[0].clips[1];
        PRUEF(c1.hk_n == 3 && c1.hk != nullptr);
        if (c1.hk_n == 3 && c1.hk) {
          PRUEF(c1.hk[0].beat == 0.0 && c1.hk[0].wert == -12.0f && c1.hk[0].form == 0);
          PRUEF(c1.hk[1].beat == 2.0 && c1.hk[1].wert == -6.0f && c1.hk[1].form == 1);
          PRUEF(c1.hk[2].beat == 4.0 && c1.hk[2].wert == 0.0f && c1.hk[2].form == 0);
        }
        PRUEF(c2.hk_n == 0 && c2.hk == nullptr);   // negative control: no gain_hk, no table
      } else {
        PRUEF(false);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    {  // (b) /1 knows no gain_hk: format; the same text in /2 loads (positive control)
      PRUEF(grund(true, spur_hk(hk_text(hk_gut))).empty());
      PRUEF(grund(false, spur_hk(hk_text(hk_gut))) == "format");
      PRUEF(grund(false, spur_hk("")).empty());   // /1 without gain_hk loads as before
    }
    {  // (c) the point checks of a lane, range -200..0; every refusal has its positive control right next to it
      PRUEF(grund(true, spur_hk(hk_text({{4.0, -12.0, 0}, {2.0, 0.0, 0}}))) == "format");                      // falling beats
      PRUEF(grund(true, spur_hk(hk_text({{2.0, -12.0, 0}, {2.0, -6.0, 0}, {2.0, 0.0, 0}}))) == "format");      // three at one beat
      PRUEF(grund(true, spur_hk(hk_text({{2.0, -12.0, 0}, {2.0, -6.0, 0}}))).empty());                         // two at one beat: a jump, valid
      PRUEF(grund(true, spur_hk(hk_text({{0.0, 0.5, 0}, {4.0, 0.0, 0}}))) == "format");                        // above 0 dB (boost stays the clip gain)
      PRUEF(grund(true, spur_hk(hk_text({{0.0, 0.0, 0}, {4.0, -200.0, 0}}))).empty());                         // 0 and -200 inclusive
      PRUEF(grund(true, spur_hk(hk_text({{0.0, -200.5, 0}, {4.0, 0.0, 0}}))) == "format");                     // below -200
      PRUEF(grund(true, spur_hk(hk_text({{-1.0, -3.0, 0}, {4.0, 0.0, 0}}))) == "format");                      // beat negative
      PRUEF(grund(true, spur_hk(hk_text({{0.0, -3.0, 3}, {4.0, 0.0, 0}}))) == "format");                       // form 3
      PRUEF(grund(true, spur_hk(hk_text({{0.0, -3.0, 2}, {4.0, 0.0, 2}}))).empty());                           // form 2 valid
      PRUEF(grund(true, spur_hk("[]")) == "format");                                                           // no points
      PRUEF(grund(true, spur_hk("5")) == "format");                                                            // not a list
      PRUEF(grund(true, spur_hk("[[0,\"x\",0],[4,0,0]]")) == "format");                                        // text as a value
      PRUEF(grund(true, spur_hk("[[0,-3],[4,0,0]]")) == "format");                                             // not a triple
    }
    {  // (d) an error leaves no account behind and the loaded state alone (the caller keeps the old snapshot)
      ++nr;
      o.wiedergabe2_auto(nr, spur_hk(hk_text(hk_gut)));
      cdj::ArrLadeErgebnis alt = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(alt.snap != nullptr);
      const int64_t vorher = konto.gesperrt();
      ++nr;
      o.wiedergabe2_auto(nr, spur_hk(hk_text({{4.0, -12.0, 0}, {2.0, 0.0, 0}})));
      cdj::ArrLadeErgebnis kaputt = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(!kaputt.snap && kaputt.grund == "format");
      PRUEF(konto.gesperrt() == vorher);
      PRUEF(alt.snap && alt.snap->spur[0].clips[0].hk_n == 3 && alt.snap->spur[0].clips[0].hk[2].wert == 0.0f);
      cdj::gib_wiedergabe(alt.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    {  // (e) lanes AND gain_hk: every lane pointer stays valid (the hk points live in an own vector, never in auto_punkte)
       // The lane values read after the build equal those of the same snapshot without gain_hk.
      const P lane_p = {{0.0, 0.0, 0}, {8.0, -6.0, 1}, {8.0, -12.0, 2}, {16.0, -30.0, 0}};
      const std::string zwei = [&](bool mit_hk) {
        return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clip_hk("c1", mit_hk ? hk_text(hk_gut) : "") + "," + o.clip("c2", 8.0, 4.0, a, F) +
               "],\"auto\":[" + o.auto_lane(lane_p) + "," + o.auto_lane({{0.0, -0.5, 0}, {4.0, 0.5, 1}}, "pan") + "]},"
               "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + clip_hk("d1", mit_hk ? hk_text({{0.0, -3.0, 0}, {4.0, -200.0, 0}}) : "") +
               "],\"auto\":[" + o.auto_lane({{0.0, 0.0, 2}, {4.0, 1.0, 2}}, "mute") + "]}";
      }(true);
      const std::string zwei_ohne = [&] {
        return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clip_hk("c1", "") + "," + o.clip("c2", 8.0, 4.0, a, F) +
               "],\"auto\":[" + o.auto_lane(lane_p) + "," + o.auto_lane({{0.0, -0.5, 0}, {4.0, 0.5, 1}}, "pan") + "]},"
               "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + clip_hk("d1", "") + "],\"auto\":[" + o.auto_lane({{0.0, 0.0, 2}, {4.0, 1.0, 2}}, "mute") + "]}";
      }();
      ++nr;
      o.wiedergabe2_auto(nr, zwei);
      cdj::ArrLadeErgebnis m = cdj::lade_wiedergabe(o.pfad, nr, cache);
      ++nr;
      o.wiedergabe2_auto(nr, zwei_ohne);
      cdj::ArrLadeErgebnis ohne = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(m.snap && ohne.snap);
      if (m.snap && ohne.snap) {
        PRUEF(m.snap->n_auto_lanes == 3 && ohne.snap->n_auto_lanes == 3);
        int gleich = 0, gesamt = 0;
        for (int sp = 0; sp < 2; ++sp)
          for (int li = 0; li < m.snap->spur[sp].n_auto; ++li) {
            const cdj::ArrAutoLane& x = m.snap->spur[sp].auto_lanes[li];
            const cdj::ArrAutoLane& y = ohne.snap->spur[sp].auto_lanes[li];
            PRUEF(x.ziel == y.ziel && x.n == y.n);
            for (int k = 0; k < x.n && k < y.n; ++k) {
              ++gesamt;
              gleich += x.p[k].beat == y.p[k].beat && x.p[k].wert == y.p[k].wert && x.p[k].form == y.p[k].form;
            }
          }
        PRUEF(gesamt == 4 + 2 + 2 && gleich == gesamt);   // 8 lane points compared; none read the hk points
        PRUEF(m.snap->auto_punkte.size() == 8);           // the lane vector holds the lane points only
        PRUEF(m.snap->spur[0].clips[0].hk_n == 3 && m.snap->spur[1].clips[0].hk_n == 2);   // and the tables are there
        PRUEF(ohne.snap->spur[0].clips[0].hk_n == 0);
        // gesperrt_bytes: the hk points sit in booked pages of their own, so the snapshot with them is heavier by at least their page-rounded bytes
        PRUEF(m.snap->gesperrt_bytes >= ohne.snap->gesperrt_bytes + static_cast<int64_t>(cdj::arr_seiten(5 * sizeof(cdj::ArrAutoPunkt))));
      }
      if (m.snap) cdj::gib_wiedergabe(m.snap.release(), cache);
      if (ohne.snap) cdj::gib_wiedergabe(ohne.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    {  // (f) the booking is exact: audio + head + the snapshot bytes, hk pages included (before/after on the same file, as (g) above)
      ++nr;
      o.wiedergabe2_auto(nr, spur_hk(""));
      cdj::ArrLadeErgebnis ohne = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(ohne.snap != nullptr);
      const int64_t b0 = ohne.snap ? ohne.snap->gesperrt_bytes : 0;
      cdj::gib_wiedergabe(ohne.snap.release(), cache);
      P viele;
      for (int i = 0; i < 100; ++i) viele.push_back({static_cast<double>(i) * 0.04, -100.0 + i * 0.5, 0});
      ++nr;
      o.wiedergabe2_auto(nr, spur_hk(hk_text(viele)));
      cdj::ArrLadeErgebnis mit = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(mit.snap != nullptr);
      if (mit.snap) {
        const int64_t b1 = mit.snap->gesperrt_bytes;
        PRUEF(b1 >= b0 + static_cast<int64_t>(100 * sizeof(cdj::ArrAutoPunkt)));
        PRUEF(konto.gesperrt() == F * 8 + cdj::arr_audio_kopf() + b1);
      }
      cdj::gib_wiedergabe(mit.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    {  // (g) the budget of 65536 points counts lanes and gain_hk together: seven lanes of 8192 and one table of 8192 pass, one point more does not
      P lane8k, hk8k;
      for (int i = 0; i < 8192; ++i) {
        lane8k.push_back({static_cast<double>(i), 0.0, 0});
        hk8k.push_back({static_cast<double>(i), -3.0, 0});
      }
      const auto viele = [&](int hk_n) {
        std::string s;
        for (int k = 1; k <= 7; ++k)
          s += std::string(k > 1 ? "," : "") + "{\"nr\":" + std::to_string(k) + ",\"art\":\"audio\",\"clips\":[],\"auto\":[" + o.auto_lane(lane8k) + "]}";
        P h(hk8k.begin(), hk8k.begin() + hk_n);
        return s + ",{\"nr\":8,\"art\":\"audio\",\"clips\":[" + clip_hk("c1", hk_text(h)) + "]}";
      };
      PRUEF(grund(true, viele(8192)).empty());   // 7 x 8192 lane points + 8192 hk points = 65536: the positive control
      P neun = hk8k;
      neun.push_back({8192.0, -3.0, 0});
      const std::string zu_viel = [&] {
        std::string s;
        for (int k = 1; k <= 7; ++k)
          s += std::string(k > 1 ? "," : "") + "{\"nr\":" + std::to_string(k) + ",\"art\":\"audio\",\"clips\":[],\"auto\":[" + o.auto_lane(lane8k) + "]}";
        return s + ",{\"nr\":8,\"art\":\"audio\",\"clips\":[" + clip_hk("c1", hk_text(neun)) + "]}";
      }();
      PRUEF(grund(true, zu_viel) == "zu_gross");
    }
  }
  {  // (r) 1.12 slice 5 U9 T9.1: `relativ: true` lanes (summand lanes of the value stack, D9). One absolute and one relative lane per (target, parameter).
     // Ranges of the relative values (D7): fader -60..6 dB, pan -2..2, geraet.* -1..1; mute and solo take none.
    const P norm = {{0.0, 0.0, 0}, {4.0, 1.0, 0}};
    const P kl = {{0.0, -6.0, 0}, {4.0, -6.0, 0}};   // a relative fader line
    const auto intern = [&](const std::string& lanes) {
      return "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]" + (lanes.empty() ? "" : ",\"auto\":[" + lanes + "]") + "}";
    };
    const auto rel = [](const P& p, const char* z = "fader") { return arrdatei::Ordner::auto_lane_rel(p, z); };
    {  // (r1) an absolute and a relative lane of the same target load together, in file order, with the flag set only on the relative one
      ++nr;
      o.wiedergabe2_auto(nr, spur(o.auto_lane(gut, "fader") + "," + rel(kl)));
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(e.snap && e.grund.empty());
      if (e.snap && e.snap->spur[0].n_auto == 2) {
        const cdj::ArrAutoLane* l = e.snap->spur[0].auto_lanes;
        PRUEF(l[0].ziel == cdj::ARR_AUTO_FADER && !l[0].relativ && l[0].n == 2 && l[0].p[1].wert == -30.0f);
        PRUEF(l[1].ziel == cdj::ARR_AUTO_FADER && l[1].relativ && l[1].n == 2 && l[1].p[1].wert == -6.0f);
        PRUEF(e.snap->n_auto_lanes == 2 && e.snap->auto_punkte.size() == 4);
      } else {
        PRUEF(false);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    PRUEF(grund(true, spur(rel(kl) + "," + o.auto_lane(gut, "fader"))).empty());   // the relative lane may come first
    PRUEF(grund(true, spur(rel(kl))).empty());                                      // relative only, no absolute lane
    PRUEF(grund(true, spur(rel(kl) + "," + rel(kl))) == "format");                  // two relative lanes of one target
    PRUEF(grund(true, spur(o.auto_lane(gut, "fader") + "," + o.auto_lane(gut, "fader"))) == "format");   // control: two absolute ones stay refused
    PRUEF(grund(true, spur(rel(kl) + "," + rel({{0.0, 0.0, 0}, {4.0, 1.0, 0}}, "pan"))).empty());       // relative fader and relative pan: different targets
    PRUEF(grund(true, spur("{\"ziel\":\"fader\",\"punkte\":[[0,-6,0],[4,-6,0]],\"relativ\":false}," + o.auto_lane(gut, "fader"))) == "format");   // false is an absolute lane: two of them
    PRUEF(grund(true, spur("{\"ziel\":\"fader\",\"punkte\":[[0,-6,0],[4,-6,0]],\"relativ\":false}")).empty());                                     // ... and one loads
    PRUEF(grund(true, spur("{\"ziel\":\"fader\",\"punkte\":[[0,-6,0],[4,-6,0]],\"relativ\":1}")) == "format");        // not a boolean
    PRUEF(grund(true, spur("{\"ziel\":\"fader\",\"punkte\":[[0,-6,0],[4,-6,0]],\"relativ\":\"true\"}")) == "format");
    // mute and solo take no relative lane
    PRUEF(grund(true, spur(rel({{0.0, 0.0, 2}, {4.0, 1.0, 2}}, "mute"))) == "format");
    PRUEF(grund(true, spur(rel({{0.0, 0.0, 2}, {4.0, 1.0, 2}}, "solo"))) == "format");
    // the ranges of D7, inclusive at both ends, refused just outside; the absolute range of the same target stays wider (control)
    PRUEF(grund(true, spur(rel({{0.0, -60.0, 0}, {4.0, 6.0, 0}}))).empty());
    PRUEF(grund(true, spur(rel({{0.0, -60.5, 0}, {4.0, 0.0, 0}}))) == "format");
    PRUEF(grund(true, spur(rel({{0.0, 0.0, 0}, {4.0, 6.5, 0}}))) == "format");
    PRUEF(grund(true, spur(o.auto_lane({{0.0, -100.0, 0}, {4.0, 0.0, 0}}, "fader"))).empty());   // absolute -100 dB is fine
    PRUEF(grund(true, spur(rel({{0.0, -100.0, 0}, {4.0, 0.0, 0}}))) == "format");                 // relative -100 dB is not
    PRUEF(grund(true, spur(rel({{0.0, -2.0, 0}, {4.0, 2.0, 0}}, "pan"))).empty());
    PRUEF(grund(true, spur(rel({{0.0, -2.5, 0}, {4.0, 0.0, 0}}, "pan"))) == "format");
    PRUEF(grund(true, spur(rel({{0.0, 0.0, 0}, {4.0, 2.5, 0}}, "pan"))) == "format");
    PRUEF(grund(true, spur(o.auto_lane({{0.0, -2.0, 0}, {4.0, 0.0, 0}}, "pan"))) == "format");     // absolute pan -2 is refused (control)
    for (const char* z : {"geraet.lautstaerke", "geraet.cutoff", "geraet.resonanz", "geraet.env_mod"}) {
      PRUEF(grund(true, intern(rel({{0.0, -1.0, 0}, {4.0, 1.0, 0}}, z))).empty());
      PRUEF(grund(true, intern(rel({{0.0, -1.5, 0}, {4.0, 0.0, 0}}, z))) == "format");
      PRUEF(grund(true, intern(rel({{0.0, 0.0, 0}, {4.0, 1.5, 0}}, z))) == "format");
      PRUEF(grund(true, spur(rel(norm, z))) == "format");   // a device lane belongs to the RB-338, also a relative one
      PRUEF(grund(true, intern(o.auto_lane(norm, z) + "," + rel(norm, z))).empty());   // absolute + relative of one parameter
      PRUEF(grund(true, intern(rel(norm, z) + "," + rel(norm, z))) == "format");
    }
    PRUEF(grund(true, intern(rel(norm, "geraet.cutoff") + "," + rel(norm, "geraet.resonanz"))).empty());   // two parameters
    {  // (r2) all 14 lanes that can exist on one RB-338 track (8 absolute + 6 relative) load, ziel/param/relativ from the one table
      std::string alle = o.auto_lane(gut, "fader") + "," + o.auto_lane(norm, "pan") + "," + o.auto_lane({{0.0, 0.0, 2}, {4.0, 1.0, 2}}, "mute") + "," +
                         o.auto_lane({{0.0, 0.0, 2}, {4.0, 1.0, 2}}, "solo");
      const char* zn[4] = {"geraet.lautstaerke", "geraet.cutoff", "geraet.resonanz", "geraet.env_mod"};
      for (const char* z : zn) alle += "," + o.auto_lane(norm, z);
      alle += "," + rel(kl) + "," + rel({{0.0, -1.0, 0}, {4.0, 1.0, 0}}, "pan");
      for (const char* z : zn) alle += "," + rel({{0.0, -0.5, 0}, {4.0, 0.5, 0}}, z);
      ++nr;
      o.wiedergabe2_auto(nr, intern(alle));
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(e.snap && e.snap->spur[0].n_auto == 14 && e.snap->n_auto_lanes == 14);
      if (e.snap && e.snap->spur[0].n_auto == 14) {
        const cdj::ArrAutoLane* l = e.snap->spur[0].auto_lanes;
        for (int i = 0; i < 14; ++i) PRUEF(l[i].relativ == (i >= 8));
        PRUEF(l[8].ziel == cdj::ARR_AUTO_FADER && l[9].ziel == cdj::ARR_AUTO_PAN);
        for (int g = 0; g < 4; ++g) PRUEF(l[10 + g].ziel == cdj::ARR_AUTO_GERAET && l[10 + g].param == g && l[10 + g].p[0].wert == -0.5f);
      }
      cdj::gib_wiedergabe(e.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    }
    {  // (r3) /1 knows neither `auto` nor `relativ`: the file is refused, and the same text in /2 loads (control)
      ++nr;
      o.wiedergabe(nr, spur(rel(kl)));
      cdj::ArrLadeErgebnis e1 = cdj::lade_wiedergabe(o.pfad, nr, cache);
      PRUEF(!e1.snap && e1.grund == "format");
      PRUEF(grund(true, spur(rel(kl))).empty());
    }
  }
  PRUEF_ENDE();
}
