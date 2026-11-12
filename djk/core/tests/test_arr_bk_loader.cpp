// Baukasten S20 task 3: the loader and the graph store for bk project tracks (arr_playback.h, arr_loader.h).
// A playback track {art:"intern", geraet:"bk", graph, parameter:{k1..k8}} gets one CypherBk, built off the callback in the
// reference-counted store of the ArrAudioCache; consecutive snapshots share it (key: track nr, graph name, hash of the file text),
// a release asks the sink (ArrBkLeser::nutzt) before it frees, and an abort frees the references taken so far.
// Mutations: ARR_BK_OHNE_TEILEN (case 3), ARR_BK_FREI_OHNE_LESER (case 4), ARR_BK_EFFEKT_OFFEN (case 2), ARR_BK_OHNE_REF (case 4).
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

#include "arr_file.h"
#include "cypherdj/arr_loader.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/cypher_bk_ffi.h"
#include "check.h"

// saw x gate x knob 1 (the graph of test_bk_ffi plus a knob)
static const char* G_T =
    R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"vk","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"vk.a"},{"von":"k.aus","nach":"vk.b"},{"von":"vk.aus","nach":"o.x"}]})";

namespace {
struct Leser final : cdj::ArrBkLeser {
  bool wert = false;
  bool nutzt(const CypherBk*) const noexcept override { return wert; }
};

std::string lies(const std::string& pfad) {
  std::ifstream f(pfad);
  std::stringstream s;
  s << f.rdbuf();
  return s.str();
}
void schreibe(const std::string& pfad, const std::string& text) { std::ofstream(pfad) << text; }

// one bk track as playback text
std::string bk_spur(int nr, const std::string& graph, const std::string& param = "{\"k1\":0.25}", int noten = 1) {
  std::string n;
  for (int i = 0; i < noten; ++i) {
    char z[160];
    std::snprintf(z, sizeof z, "%s{\"id\":\"c%d/n%d\",\"beat\":%d,\"laenge\":0.5,\"ton\":57,\"vel\":100}", i ? "," : "", nr, i, i);
    n += z;
  }
  return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"" + graph + "\",\"parameter\":" + param +
         ",\"noten\":[" + n + "]}";
}
}  // namespace

int main() {
  arrdatei::Ordner o("test_arr_bk_lader");
  const std::string bk = o.pfad + "/bk";
  std::filesystem::create_directories(bk);
  schreibe(bk + "/t.json", G_T);
  schreibe(bk + "/t2.json", G_T);
  std::string t_geaendert = G_T;
  t_geaendert.replace(t_geaendert.find("\"stimmen\":2"), 11, "\"stimmen\":3");   // one number different: another file text
  schreibe(bk + "/e.json", lies(std::string(CYPHERDJ_DJK) + "/instruments/modular_dsp/demos/fx-echo-achtel.json"));
  auto lade = [&](cdj::ArrAudioCache& c, int64_t nr) { return cdj::lade_wiedergabe(o.pfad, nr, c); };

  {  // 1: bk_spur_laedt
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_bk_ordner(bk);
    o.wiedergabe(1, bk_spur(3, "t"));
    cdj::ArrLadeErgebnis e = lade(cache, 1);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSpur& s = e.snap->spur[2];
      PRUEF(s.art == cdj::ArrArt::intern && std::string(s.geraet) == "bk" && std::string(s.graph) == "t");
      PRUEF(s.bk != nullptr && s.bk_gen > 0);
      PRUEF(s.n_param == 1 && std::string(s.param[0].name) == "k1" && s.param[0].wert == 0.25f);
      PRUEF(s.n_noten == 1 && s.noten[0].ton == 57);
      PRUEF(cache.bk_eintraege() == 1);
      PRUEF(cypher_bk_hat_eingang(s.bk) == 0);   // a real instrument graph
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    PRUEF(cache.bk_eintraege() == 0 && cache.bk_aufgeschoben() == 0);
  }
  {  // 1b: 32-knob widening. A track of the old format names k1..k8 only and loads unchanged (the missing knobs read 0.5 in the sink,
     // see test_arr_bk_senke); a track names k9, k17 and k32 and keeps them with their values.
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_bk_ordner(bk);
    std::string alt = "{";
    for (int k = 1; k <= 8; ++k) alt += (k > 1 ? ",\"k" : "\"k") + std::to_string(k) + "\":" + (k == 8 ? "0.75" : "0.5");
    alt += "}";
    o.wiedergabe(2, bk_spur(1, "t", alt));
    cdj::ArrLadeErgebnis e = lade(cache, 2);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSpur& s = e.snap->spur[0];
      PRUEF(s.n_param == 8 && std::string(s.param[7].name) == "k8" && s.param[7].wert == 0.75f);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    o.wiedergabe(3, bk_spur(1, "t", "{\"k1\":0.25,\"k9\":0.125,\"k17\":0.375,\"k32\":0.875}"));
    e = lade(cache, 3);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSpur& s = e.snap->spur[0];
      const auto wert_von = [&](const char* name) {   // the loader keeps the order of the JSON object (sorted by key), so look the knob up by name
        for (int i = 0; i < s.n_param; ++i)
          if (std::string(s.param[i].name) == name) return s.param[i].wert;
        return -1.0f;
      };
      PRUEF(s.n_param == 4 && wert_von("k1") == 0.25f && wert_von("k9") == 0.125f && wert_von("k17") == 0.375f && wert_von("k32") == 0.875f);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    // 64-knob widening: a track of the 32-knob format (k1..k32) loads unchanged; a track names k33, k48 and k64 and keeps them
    std::string mittel = "{";
    for (int k = 1; k <= 32; ++k) mittel += (k > 1 ? ",\"k" : "\"k") + std::to_string(k) + "\":" + (k == 32 ? "0.625" : "0.5");
    mittel += "}";
    o.wiedergabe(5, bk_spur(1, "t", mittel));
    e = lade(cache, 5);
    PRUEF(e.snap && e.grund.empty() && e.snap->spur[0].n_param == 32);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    o.wiedergabe(6, bk_spur(1, "t", "{\"k1\":0.25,\"k33\":0.0625,\"k48\":0.4375,\"k64\":0.9375}"));
    e = lade(cache, 6);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSpur& s = e.snap->spur[0];
      const auto wert_von = [&](const char* name) {
        for (int i = 0; i < s.n_param; ++i)
          if (std::string(s.param[i].name) == name) return s.param[i].wert;
        return -1.0f;
      };
      PRUEF(s.n_param == 4 && wert_von("k1") == 0.25f && wert_von("k33") == 0.0625f && wert_von("k48") == 0.4375f && wert_von("k64") == 0.9375f);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    // all 64 together (ARR_PARAMETER = 64); a 65th entry is refused (k65 is no knob, see the refusal table below)
    std::string alle = "{";
    for (int k = 1; k <= 64; ++k) alle += (k > 1 ? ",\"k" : "\"k") + std::to_string(k) + "\":0.5";
    alle += "}";
    o.wiedergabe(4, bk_spur(1, "t", alle));
    e = lade(cache, 4);
    PRUEF(e.snap && e.snap->spur[0].n_param == 64);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.bk_eintraege() == 0 && cache.bk_aufgeschoben() == 0);
  }
  {  // 2: refusals name track and graph; nothing leaks; the RB track loads as before (negative control)
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_bk_ordner(bk);
    struct Fall {
      const char* was;
      std::string spuren;
      const char* grund;
      const char* im_text;
    };
    std::string neun;
    for (int i = 1; i <= 9; ++i) neun += (i > 1 ? "," : "") + bk_spur(i, "t");
    const Fall faelle[] = {
        {"file missing", bk_spur(1, "nix"), "format", "nix"},
        {"effect graph", bk_spur(1, "e"), "format", "effect"},
        {"knob k65", bk_spur(1, "t", "{\"k65\":0.5}"), "format", "k65"},   // 64-knob widening: k9..k64 are knobs, k65 is not
        {"knob k033", bk_spur(1, "t", "{\"k033\":0.5}"), "format", "k033"},
        {"knob k640", bk_spur(1, "t", "{\"k640\":0.5}"), "format", "k640"},
        {"knob k0", bk_spur(1, "t", "{\"k0\":0.5}"), "format", "k0"},
        {"knob k01", bk_spur(1, "t", "{\"k01\":0.5}"), "format", "k01"},
        {"knob k100", bk_spur(1, "t", "{\"k100\":0.5}"), "format", "k100"},
        {"knob out of range", bk_spur(1, "t", "{\"k1\":1.5}"), "format", "k1"},
        {"capital letters", bk_spur(1, "T"), "format", "T"},
        {"path in the name", bk_spur(1, "../t"), "format", "../t"},
        {"nine tracks", neun, "zu_gross", "8"},
        {"graph missing in the track", "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"bk\",\"noten\":[]}", "format", "graph"},
    };
    int nr = 10;
    for (const Fall& f : faelle) {
      o.wiedergabe(nr, f.spuren);
      cdj::ArrLadeErgebnis e = lade(cache, nr);
      PRUEF(e.snap == nullptr);
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
      if (e.grund != f.grund || e.meldung.find(f.im_text) == std::string::npos || e.meldung.find("spuren[") == std::string::npos)
        std::fprintf(stderr, "case %s: grund=%s meldung=%s\n", f.was, e.grund.c_str(), e.meldung.c_str());
      PRUEF(e.grund == f.grund);
      PRUEF(e.meldung.find(f.im_text) != std::string::npos);
      PRUEF(e.meldung.find("spuren[") != std::string::npos);   // names the track
      PRUEF(cache.bk_eintraege() == 0 && cache.bk_aufgeschoben() == 0);   // the abort released what it had taken
      ++nr;
    }
    {  // no graph folder set
      cdj::ArrAudioCache leer(&konto, 50LL << 20, false);
      o.wiedergabe(nr, bk_spur(1, "t"));
      cdj::ArrLadeErgebnis e = lade(leer, nr);
      PRUEF(e.snap == nullptr && e.grund == "format" && e.meldung.find("no graph folder") != std::string::npos);
      ++nr;
    }
    {  // negative control: an RB track and a good bk track load; the RB track has no graph
      o.wiedergabe(nr, "{\"nr\":1,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5},\"noten\":[]}," + bk_spur(2, "t"));
      cdj::ArrLadeErgebnis e = lade(cache, nr);
      PRUEF(e.snap && e.grund.empty());
      if (e.snap) {
        PRUEF(std::string(e.snap->spur[0].geraet) == "rb338" && e.snap->spur[0].bk == nullptr && e.snap->spur[0].graph[0] == '\0');
        PRUEF(e.snap->spur[1].bk != nullptr);
        cdj::gib_wiedergabe(e.snap.release(), cache);
      }
      ++nr;
    }
  }
  {  // 3: bk_geteilt: consecutive snapshots share the instance; another graph, another text or another track do not
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_bk_ordner(bk);
    o.wiedergabe(31, bk_spur(3, "t"));
    o.wiedergabe(32, bk_spur(3, "t", "{\"k1\":0.9}", 2));   // one more note and another knob: same graph
    o.wiedergabe(33, bk_spur(3, "t2"));
    o.wiedergabe(34, bk_spur(3, "t") + "," + bk_spur(4, "t"));   // two tracks with the same graph: two instances
    cdj::ArrLadeErgebnis e1 = lade(cache, 31), e2 = lade(cache, 32), e3 = lade(cache, 33), e4 = lade(cache, 34);
    PRUEF(e1.snap && e2.snap && e3.snap && e4.snap);
    if (e1.snap && e2.snap && e3.snap && e4.snap) {
      PRUEF(e1.snap->spur[2].bk != nullptr);
      PRUEF(e2.snap->spur[2].bk == e1.snap->spur[2].bk && e2.snap->spur[2].bk_gen == e1.snap->spur[2].bk_gen);
      PRUEF(e3.snap->spur[2].bk != e1.snap->spur[2].bk && e3.snap->spur[2].bk_gen != e1.snap->spur[2].bk_gen);   // t2: other graph name
      PRUEF(e4.snap->spur[2].bk == e1.snap->spur[2].bk);                            // track 3 with graph t again: shared
      PRUEF(e4.snap->spur[3].bk != e4.snap->spur[2].bk);                            // track 4: its own instance
      PRUEF(cache.bk_eintraege() == 3);                                             // (3,t), (3,t2), (4,t)
      cdj::gib_wiedergabe(e1.snap.release(), cache);
      cdj::gib_wiedergabe(e2.snap.release(), cache);
      cdj::gib_wiedergabe(e3.snap.release(), cache);
      cdj::gib_wiedergabe(e4.snap.release(), cache);
    }
    PRUEF(cache.bk_eintraege() == 0);
    // the file text changes under the same name: a new instance (the hash is part of the key)
    o.wiedergabe(35, bk_spur(3, "t"));
    cdj::ArrLadeErgebnis a = lade(cache, 35);
    schreibe(bk + "/t.json", t_geaendert);
    o.wiedergabe(36, bk_spur(3, "t"));
    cdj::ArrLadeErgebnis b = lade(cache, 36);
    schreibe(bk + "/t.json", G_T);
    PRUEF(a.snap && b.snap);
    if (a.snap && b.snap) {
      PRUEF(a.snap->spur[2].bk != b.snap->spur[2].bk && a.snap->spur[2].bk_gen != b.snap->spur[2].bk_gen);
      PRUEF(cache.bk_eintraege() == 2);
      cdj::gib_wiedergabe(a.snap.release(), cache);
      cdj::gib_wiedergabe(b.snap.release(), cache);
    }
    PRUEF(cache.bk_eintraege() == 0);
  }
  {  // 4: bk_freigabe: the last release asks the sink; a deferred free waits until the sink lets go
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    cache.setze_bk_ordner(bk);
    Leser leser;
    cache.setze_bk_leser(&leser);
    o.wiedergabe(41, bk_spur(3, "t"));
    o.wiedergabe(42, bk_spur(3, "t", "{\"k1\":0.5}", 2));
    cdj::ArrLadeErgebnis s1 = lade(cache, 41), s2 = lade(cache, 42);
    PRUEF(s1.snap && s2.snap);
    if (s1.snap && s2.snap) {
      PRUEF(cache.bk_eintraege() == 1);
      cdj::gib_wiedergabe(s1.snap.release(), cache);   // snap2 still holds the instance
      PRUEF(cache.bk_eintraege() == 1 && cache.bk_aufgeschoben() == 0);
      cdj::gib_wiedergabe(s2.snap.release(), cache);   // the last one: the sink is not using it, freed at once
      PRUEF(cache.bk_eintraege() == 0 && cache.bk_aufgeschoben() == 0);
    }
    // now with a sink that still uses the handle
    leser.wert = true;
    o.wiedergabe(43, bk_spur(3, "t"));
    cdj::ArrLadeErgebnis s3 = lade(cache, 43);
    PRUEF(s3.snap != nullptr);
    if (s3.snap) {
      cdj::gib_wiedergabe(s3.snap.release(), cache);
      PRUEF(cache.bk_eintraege() == 0 && cache.bk_aufgeschoben() == 1);   // deferred, not freed
      PRUEF(!cache.bk_nachholen() && cache.bk_aufgeschoben() == 1);       // the sink still uses it: kept
      leser.wert = false;
      PRUEF(cache.bk_nachholen() && cache.bk_aufgeschoben() == 0);        // let go: freed now
      PRUEF(!cache.bk_nachholen());                                        // nothing left to do
    }
    // a deferred handle at the end of the cache is freed by the destructor without asking (checked under ASan/valgrind by hand)
    leser.wert = true;
    o.wiedergabe(44, bk_spur(3, "t"));
    cdj::ArrLadeErgebnis s4 = lade(cache, 44);
    if (s4.snap) cdj::gib_wiedergabe(s4.snap.release(), cache);
    PRUEF(cache.bk_aufgeschoben() == 1);
  }
  {  // 5: through the loader thread's function: the rings, the deferred pass
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrLader lader(o.pfad, &konto, 50LL << 20, false);
    Leser leser;
    lader.setze_bk_ordner(bk);
    lader.setze_bk_leser(&leser);
    auto r = std::make_unique<cdj::ArrLaderRinge>();
    auto auftrag = [](int64_t id, int64_t nr) {
      cdj::ArrAuftrag a{};
      a.id = id;
      std::snprintf(a.quelle, sizeof a.quelle, "andreas");
      a.nr = nr;
      return a;
    };
    o.wiedergabe(51, bk_spur(3, "t"));
    o.wiedergabe(52, bk_spur(3, "t", "{\"k1\":0.7}", 2));
    PRUEF(r->auftraege.schiebe(auftrag(1, 51)) && r->auftraege.schiebe(auftrag(2, 52)));
    PRUEF(lader.einmal(*r));
    PRUEF(lader.einmal(*r));
    cdj::ArrErgebnis e1{}, e2{};
    PRUEF(r->ergebnisse.hole(e1) && r->ergebnisse.hole(e2) && e1.snap && e2.snap);
    if (e1.snap && e2.snap) {
      PRUEF(e1.snap->spur[2].bk == e2.snap->spur[2].bk && lader.cache().bk_eintraege() == 1);
      PRUEF(r->rueckgabe.schiebe(e1.snap));
      lader.einmal(*r);
      PRUEF(lader.cache().bk_eintraege() == 1);                          // snap2 still holds it
      leser.wert = true;                                                  // the sink uses it while the last snapshot goes
      PRUEF(r->rueckgabe.schiebe(e2.snap));
      lader.einmal(*r);
      PRUEF(lader.cache().bk_eintraege() == 0 && lader.cache().bk_aufgeschoben() == 1);
      PRUEF(!lader.einmal(*r) || lader.cache().bk_aufgeschoben() == 1);   // later pass, the sink still uses it
      leser.wert = false;
      PRUEF(lader.einmal(*r));                                            // the deferred pass counts as work
      PRUEF(lader.cache().bk_aufgeschoben() == 0);
    }
  }
  PRUEF_ENDE();
}
