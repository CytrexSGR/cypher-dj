// Session view S1b, K1: the source read map against the shared reference (contract/zell_karte_referenz.json).
#include "cypherdj/arrangement.h"  // ARR_NAHT
#include "cypherdj/zell_map.h"

#include <cmath>
#include <fstream>
#include <iostream>
#include <string>
#include <type_traits>

#include <nlohmann/json.hpp>

using namespace cdj;

static_assert(std::is_trivially_copyable_v<ZellKarte>);
static_assert(sizeof(ZellKarte) <= 1100);

int main() {
  const std::string datei = std::string(CYPHERDJ_DJK) + "/contract/zell_karte_referenz.json";
  std::ifstream f(datei);
  if (!f) {
    std::cerr << "FAIL: cannot open " << datei << "\n";
    return 1;
  }
  const nlohmann::json j = nlohmann::json::parse(f);
  int fehler = 0, geprueft = 0;
  if (j.at("naht").get<int>() != ARR_NAHT) {
    std::cerr << "FAIL: reference naht != ARR_NAHT\n";
    return 1;
  }
  if (zell_einblende(-5) != 0.0f || zell_einblende(0) != 0.0f || zell_einblende(48) != 0.5f || zell_einblende(ARR_NAHT) != 1.0f ||
      zell_einblende(1e6) != 1.0f) {
    std::cerr << "FAIL: zell_einblende\n";
    ++fehler;
  }
  for (const nlohmann::json& fall : j.at("faelle")) {
    ZellKarte k;
    const auto& g = fall.at("g");
    const auto& s = fall.at("s");
    k.n = static_cast<int>(s.size());
    if (k.n > ZELL_SCHEIBEN_MAX || g.size() != (k.n ? k.n + 1u : 0u)) {
      std::cerr << "FAIL: bad table in " << fall.at("name") << "\n";
      return 1;
    }
    for (size_t i = 0; i < g.size(); ++i) k.g[i] = g[i].get<double>();
    for (size_t i = 0; i < s.size(); ++i) k.s[i] = static_cast<uint8_t>(s[i].get<int>());
    k.kreis = fall.at("kreis").get<bool>();
    k.rueck = fall.at("rueck").get<bool>();
    k.blende = fall.at("blende").get<bool>();
    k.frames = fall.at("frames").get<int64_t>();
    for (const nlohmann::json& p : fall.at("punkte")) {
      const double pos = p.at(0).is_string() ? std::nan("") : p.at(0).get<double>();  // "nan" stands for NaN
      const ZellLesung r = zell_lesen(k, pos);
      ++geprueft;
      if (std::fabs(r.a - p.at(1).get<double>()) > 1e-9 || std::fabs(r.b - p.at(2).get<double>()) > 1e-9 ||
          std::fabs(static_cast<double>(r.wb) - p.at(3).get<double>()) > 1e-6) {
        ++fehler;
        std::cerr << "FAIL " << fall.at("name") << " f=" << p.at(0) << ": got " << r.a << "," << r.b << "," << r.wb << " want " << p << "\n";
      }
    }
  }
  std::cout << geprueft << " points, " << fehler << " failures\n";
  return fehler || geprueft == 0 ? 1 : 0;
}
