// Baukasten S20: helpers shared by the bk sink tests (graph instances, a bk track in a test snapshot).
#pragma once

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <initializer_list>
#include <sstream>
#include <string>
#include <utility>

#include "cypherdj/arr_playback.h"
#include "cypherdj/cypher_bk_ffi.h"

namespace bkt {

// saw x gate x knob 1: exact silence as soon as the gate is off (rest rule, step and fade measurements)
inline const char* G_T =
    R"({"format":"baukasten/2","name":"t","stimmen":2,"knoten":[{"id":"n","art":"note"},{"id":"s","art":"saege"},{"id":"v","art":"mul"},{"id":"k","art":"regler","nr":1,"min":0,"max":1},{"id":"vk","art":"mul"},{"id":"o","art":"ausgang"}],"kanten":[{"von":"n.hz","nach":"s.hz"},{"von":"s.aus","nach":"v.a"},{"von":"n.gate","nach":"v.b"},{"von":"v.aus","nach":"vk.a"},{"von":"k.aus","nach":"vk.b"},{"von":"vk.aus","nach":"o.x"}]})";

inline std::string datei(const std::string& pfad) {
  std::ifstream f(pfad);
  std::stringstream s;
  s << f.rdbuf();
  return s.str();
}

// an example graph of the repository (instruments/modular_dsp/demos)
inline std::string beispiel(const char* name) {
  return datei(std::string(CYPHERDJ_DJK) + "/instruments/modular_dsp/demos/" + name + ".json");
}

inline CypherBk* neu(const std::string& json) {
  char fe[256] = {};
  CypherBk* h = cypher_bk_neu(json.c_str(), 48000.0, fe, sizeof fe);
  if (!h) std::fprintf(stderr, "bk_hilfe: cypher_bk_neu: %s\n", fe);
  return h;
}

// makes track nr of the snapshot a bk track with the instance h (generation gen) and the knobs
inline void spur(cdj::ArrSnapshot* s, int nr, CypherBk* h, uint64_t gen, std::initializer_list<std::pair<const char*, float>> knoepfe = {}) {
  cdj::ArrSpur& sp = s->spur[nr - 1];
  std::snprintf(sp.geraet, sizeof sp.geraet, "bk");
  std::snprintf(sp.graph, sizeof sp.graph, "t");
  sp.bk = h;
  sp.bk_gen = gen;
  sp.n_param = 0;
  for (const auto& k : knoepfe) {
    std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", k.first);
    sp.param[sp.n_param++].wert = k.second;
  }
}

}  // namespace bkt
