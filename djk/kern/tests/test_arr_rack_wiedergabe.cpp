// Package 1.9 U6 (T6.2): the instrument rack in the playback file (arr_wiedergabe.h). A rack track {art:"intern", geraet:"rack", kette, glieder:[...],
// noten} holds 1 to 4 members; each member is a device object like a track ({art, geraet, parameter, graph, kit, slot}) plus id, zones and gain.
//   1 accept: three members (rb338 with a parameter, kit, Surge slot 1), zones, chain range, gain, the notes of the rack track; member slots
//     32, 33, 34; the devices sit in glied_spur; the kit reference is held by the snapshot and given back with it
//   2 refusals, each with grund "format" and a text that names the member: no member / five members, a zone upside down or outside its range or
//     not a pair, gain outside -60..+12, a nested rack, a repeated member id, a Surge slot used twice, rack field on a /1 file, a field a rack
//     does not have; after each of them no kit reference is left (a member loaded before the bad one is given back)
//   3 accounting across 8 racks: 8 racks x 4 members take the member slots 32..63 once each; a 9th rack is "zu_gross"; kit tracks and kit members
//     count together (8 racks with one kit member each, then one kit track more: "zu_gross"); two plain Surge tracks of one slot stay legal
// Mutations: ARR_RACK_ZONE_UNGEPRUEFT (case 2: zones), ARR_RACK_SLOT_DOPPELT (case 2: Surge slot twice).
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <set>
#include <string>

#include "arr_datei.h"
#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/kit.h"
#include "pruef.h"

namespace {

namespace fs = std::filesystem;
using cdj::ArrArt;

// the loader of the test: a one-sound Kit, whatever the folder (the store only needs a loadable kit.json to exist)
std::unique_ptr<cdj::Kit> kleiner_lader(const std::string& ordner, std::string*) {
  auto k = std::make_unique<cdj::Kit>();
  k->name = fs::path(ordner).filename().string();
  k->n = 1;
  k->klang[0].name = "t:0";
  k->klang[0].frames = 16;
  k->klang[0].daten.assign(32, 0.5f);
  return k;
}

std::string glied_json(const std::string& id, const std::string& geraet, const std::string& extra = "") {
  std::string g = "{\"id\":\"" + id + "\",";
  if (geraet == "surge1") g += "\"art\":\"wirt\",\"slot\":1";
  else if (geraet == "surge2") g += "\"art\":\"wirt\",\"slot\":2";
  else if (geraet == "kit") g += "\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_a\"";
  else g += "\"art\":\"intern\",\"geraet\":\"" + geraet + "\"";
  return g + (extra.empty() ? "" : "," + extra) + "}";
}

std::string rack_spur(int nr, const std::string& glieder, int kette = 0, const std::string& extra = "") {
  return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":" + std::to_string(kette) + ",\"glieder\":[" + glieder + "]" +
         (extra.empty() ? "" : "," + extra) + ",\"noten\":[{\"id\":\"n1\",\"beat\":0.0,\"laenge\":1.0,\"ton\":60,\"vel\":100}]}";
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_arr_rack_wiedergabe");
  const std::string kits = o.pfad + "/kits";
  fs::create_directories(kits + "/kit_a");
  std::ofstream(kits + "/kit_a/kit.json") << "{}";   // exists; the test loader does not read it
  auto frische_cache = [&](cdj::SpeicherKonto& k) {
    auto c = std::make_unique<cdj::ArrAudioCache>(&k, 50LL << 20, false);
    c->setze_kit_ordner(kits);
    c->setze_kit_lader(&kleiner_lader);
    return c;
  };
  auto ev2 = [&](int64_t nr, const std::string& spuren) { o.wiedergabe2_warp(nr, spuren); };

  {  // 1: accept
    cdj::SpeicherKonto konto(100LL << 20);
    auto cache = frische_cache(konto);
    ev2(1, rack_spur(2,
                     glied_json("lo", "rb338", "\"parameter\":{\"cutoff\":0.25},\"ton\":[0,59],\"gain_db\":-6.0") + "," +
                         glied_json("hi", "kit", "\"ton\":[60,127],\"vel\":[64,127],\"kette\":[10,20]") + "," + glied_json("lead", "surge1"),
                     5));
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 1, *cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSnapshot& s = *e.snap;
      const cdj::ArrSpur& r = s.spur[1];
      PRUEF(r.art == ArrArt::rack && std::string(r.geraet) == "rack" && r.nr == 2 && r.kette == 5 && r.n_glieder == 3);
      PRUEF(r.n_noten == 1 && r.noten[0].ton == 60);
      PRUEF(r.glied[0].platz == 32 && r.glied[1].platz == 33 && r.glied[2].platz == 34);
      PRUEF(r.glied[0].art == ArrArt::intern && r.glied[0].ton_lo == 0 && r.glied[0].ton_hi == 59);
      PRUEF(r.glied[0].vel_lo == 1 && r.glied[0].vel_hi == 127 && r.glied[0].kette_lo == 0 && r.glied[0].kette_hi == 127);   // absent: the whole range
      PRUEF_NAH(r.glied[0].gain, 0.50118723, 1e-6);
      PRUEF(r.glied[1].ton_lo == 60 && r.glied[1].vel_lo == 64 && r.glied[1].kette_lo == 10 && r.glied[1].kette_hi == 20 && r.glied[1].gain == 1.0f);
      PRUEF(r.glied[2].art == ArrArt::wirt && r.glied[2].slot == 1 && s.rack_wirt == 1);
      const cdj::ArrSpur& d0 = s.glied_spur[0];
      PRUEF(d0.art == ArrArt::intern && std::string(d0.geraet) == "rb338" && d0.n_param == 1 && d0.param[0].wert == 0.25f);
      const cdj::ArrSpur& d1 = s.glied_spur[1];
      PRUEF(d1.art == ArrArt::intern && std::string(d1.geraet) == "kit" && d1.kit_ptr != nullptr && d1.kit_gen != 0);
      PRUEF(s.glied_spur[2].art == ArrArt::wirt && s.glied_spur[2].slot == 1);
      PRUEF(s.glied_spur[3].art == ArrArt::leer);   // an unused member slot
      PRUEF(s.kit_refs.size() == 1 && cache->kit_eintraege() == 1);
      PRUEF(s.platz(33).kit_ptr == d1.kit_ptr && &s.platz(2) == &s.spur[2]);
    }
    cdj::gib_wiedergabe(e.snap.release(), *cache);
    PRUEF(cache->kit_eintraege() == 0);
  }
  {  // 2: refusals
    cdj::SpeicherKonto konto(100LL << 20);
    auto cache = frische_cache(konto);
    struct Fall {
      const char* was;
      std::string datei;   // the whole spuren text
      const char* im_text;
      bool v1 = false;   // written as a /1 file
    };
    const std::string ok = glied_json("a", "rb338");
    const std::vector<Fall> faelle = {
        {"no member", rack_spur(1, ""), "glieder hat 0"},
        {"five members", rack_spur(1, ok + "," + glied_json("b", "rb338") + "," + glied_json("c", "rb338") + "," + glied_json("d", "rb338") + "," +
                                         glied_json("e", "rb338")),
         "glieder hat 5"},
        {"zone upside down", rack_spur(1, glied_json("a", "rb338", "\"ton\":[60,59]")), "glieder[0].ton"},
        {"key zone above 127", rack_spur(1, glied_json("a", "rb338", "\"ton\":[0,128]")), "glieder[0].ton"},
        {"velocity zone from 0", rack_spur(1, glied_json("a", "rb338", "\"vel\":[0,100]")), "glieder[0].vel"},
        {"chain range above 127", rack_spur(1, ok + "," + glied_json("b", "rb338", "\"kette\":[0,128]")), "glieder[1].kette"},
        {"zone not a pair", rack_spur(1, glied_json("a", "rb338", "\"ton\":[1,2,3]")), "glieder[0].ton"},
        {"gain below -60", rack_spur(1, glied_json("a", "rb338", "\"gain_db\":-60.5")), "gain_db"},
        {"gain above +12", rack_spur(1, glied_json("a", "rb338", "\"gain_db\":12.5")), "gain_db"},
        {"nested rack", rack_spur(1, glied_json("a", "rack")), "does not nest"},
        {"member id twice", rack_spur(1, ok + "," + glied_json("a", "rb338")), "id doppelt"},
        {"Surge slot twice in one rack", rack_spur(1, glied_json("a", "surge1") + "," + glied_json("b", "surge1")), "used twice"},
        {"Surge slot of a track and a member", "{\"nr\":3,\"art\":\"wirt\",\"slot\":2,\"noten\":[]}," + rack_spur(1, glied_json("a", "surge2")), "used twice"},
        {"Surge slot of a member and a later track", rack_spur(1, glied_json("a", "surge2")) + ",{\"nr\":3,\"art\":\"wirt\",\"slot\":2,\"noten\":[]}",
         "used twice"},
        {"Surge slot twice in two racks", rack_spur(1, glied_json("a", "surge1")) + "," + rack_spur(2, glied_json("b", "surge1")), "used twice"},
        {"rack chain value above 127", rack_spur(1, ok, 128), "kette"},
        {"parameter on the rack", rack_spur(1, ok, 0, "\"parameter\":{\"cutoff\":0.5}"), "parameter gibt es nicht bei geraet rack"},
        {"notes on a member", rack_spur(1, glied_json("a", "rb338", "\"noten\":[]")), "noten gibt es nicht bei einem Glied"},
        {"kit on an rb338 member", rack_spur(1, glied_json("a", "rb338", "\"kit\":\"kit_a\"")), "kit gibt es nur bei geraet kit"},
        {"unknown member device", rack_spur(1, glied_json("a", "tb303")), "unbekannt"},
        {"a kit member loaded before a bad member", rack_spur(1, glied_json("k", "kit") + "," + glied_json("b", "rb338", "\"ton\":[5,4]")), "glieder[1].ton"},
        {"rack in a /1 file", rack_spur(1, ok), "cypherdj-arr/2", true},
    };
    int nr = 10;
    for (const Fall& f : faelle) {
      if (f.v1) o.wiedergabe(nr, f.datei);
      else ev2(nr, f.datei);
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, *cache);
      if (e.snap || e.grund != "format" || e.meldung.find(f.im_text) == std::string::npos)
        std::fprintf(stderr, "case %s: grund=%s meldung=%s\n", f.was, e.grund.c_str(), e.meldung.c_str());
      PRUEF(e.snap == nullptr && e.grund == "format");
      PRUEF(e.meldung.find(f.im_text) != std::string::npos);
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), *cache);
      PRUEF(cache->kit_eintraege() == 0 && konto.gesperrt() == 0);   // nothing left held
      ++nr;
    }
    // negative controls: each shape the refusals used, once valid
    ev2(nr, rack_spur(1, glied_json("a", "rb338", "\"ton\":[60,60],\"vel\":[1,1],\"kette\":[127,127],\"gain_db\":12.0") + "," +
                             glied_json("b", "rb338", "\"gain_db\":-60.0") + "," + glied_json("c", "surge1") + "," + glied_json("d", "kit")) +
                 ",{\"nr\":3,\"art\":\"wirt\",\"slot\":2,\"noten\":[]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, *cache);
    PRUEF(e.snap != nullptr);
    if (e.snap) {
      PRUEF(e.snap->spur[0].n_glieder == 4 && e.snap->spur[0].glied[0].ton_lo == 60 && e.snap->spur[0].glied[0].ton_hi == 60);   // a one-key zone
      PRUEF(e.snap->spur[0].glied[1].gain < 0.00101f && e.snap->spur[0].glied[1].gain > 0.00099f);                                  // -60 dB
      cdj::gib_wiedergabe(e.snap.release(), *cache);
    }
    ++nr;
    ev2(nr, "{\"nr\":1,\"art\":\"wirt\",\"slot\":1,\"noten\":[]},{\"nr\":2,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}");   // two plain Surge tracks, one slot
    e = cdj::lade_wiedergabe(o.pfad, nr, *cache);
    PRUEF(e.snap != nullptr);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), *cache);
  }
  {  // 3: accounting across 8 racks
    cdj::SpeicherKonto konto(100LL << 20);
    auto cache = frische_cache(konto);
    std::string acht;
    for (int r = 0; r < cdj::ARR_RACK_MAX; ++r) {
      std::string gl;
      for (int g = 0; g < cdj::ARR_RACK_GLIEDER; ++g) gl += (g ? "," : "") + glied_json("m" + std::to_string(g), g == 0 ? "kit" : "rb338");
      acht += (r ? "," : "") + rack_spur(r + 1, gl);
    }
    ev2(100, acht);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 100, *cache);
    PRUEF(e.snap != nullptr);   // 8 racks, 8 kit members: exactly at both limits
    if (e.snap) {
      std::set<int> platz;
      bool geordnet = true;
      for (int r = 0; r < cdj::ARR_RACK_MAX; ++r) {
        PRUEF(e.snap->spur[r].n_glieder == 4);
        for (int g = 0; g < 4; ++g) {
          const int p = e.snap->spur[r].glied[g].platz;
          platz.insert(p);
          geordnet = geordnet && p == cdj::ARR_SPUREN + r * 4 + g;
          PRUEF(e.snap->glied_spur[p - cdj::ARR_SPUREN].art == ArrArt::intern);
        }
      }
      PRUEF(platz.size() == 32 && *platz.begin() == 32 && *platz.rbegin() == 63 && geordnet);
      PRUEF(e.snap->kit_refs.size() == 8 && cache->kit_eintraege() == 1);   // eight references on one shared Kit
      cdj::gib_wiedergabe(e.snap.release(), *cache);
    }
    PRUEF(cache->kit_eintraege() == 0);
    ev2(101, acht + "," + rack_spur(9, glied_json("x", "rb338")));   // a 9th rack
    e = cdj::lade_wiedergabe(o.pfad, 101, *cache);
    PRUEF(e.snap == nullptr && e.grund == "zu_gross" && e.meldung.find("more than 8 racks") != std::string::npos);
    PRUEF(cache->kit_eintraege() == 0 && konto.gesperrt() == 0);
    ev2(102, acht + ",{\"nr\":9,\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_a\",\"noten\":[]}");   // kit tracks and kit members count together
    e = cdj::lade_wiedergabe(o.pfad, 102, *cache);
    PRUEF(e.snap == nullptr && e.grund == "zu_gross" && e.meldung.find("kit tracks") != std::string::npos);
    PRUEF(cache->kit_eintraege() == 0);
  }
  PRUEF_ENDE();
}
