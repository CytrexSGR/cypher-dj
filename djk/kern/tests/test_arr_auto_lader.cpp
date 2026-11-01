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
  PRUEF_ENDE();
}
