// Übersetzt und benutzt die gepinnten Einzel-Header: nlohmann/json (kiste.json, §6.5) und toml++ (kern.toml, §2.1).
#include <nlohmann/json.hpp>
#include <toml++/toml.hpp>

#include <cstdio>
#include <string_view>

using namespace std::string_view_literals;

static int fehler = 0;
static void pruefe(bool ok, const char* was) {
  std::printf("%s: %s\n", ok ? "GRÜN" : "ROT", was);
  if (!ok) ++fehler;
}

int main() {
  // Beispiel aus SCHNITTSTELLEN.md §6.5
  const auto kiste = nlohmann::json::parse(R"({"version":1,"geaendert_sample":1800000,"eintraege":[
    {"material_id":"3fa1c09b2e7d4410","titel":"Nightshift","quelle_bpm":124.86,
     "fassungen":[{"basis_bpm":128.0,"fassung":1,"stems":true}],
     "dauer_beats":352.0,"lufs":-9.4,"camelot":"8A","tore_ok":true,"nur_fuer_andreas":false}]})");
  pruefe(kiste.at("version") == 1, "kiste.json version = 1");
  pruefe(kiste.at("eintraege").at(0).at("fassungen").at(0).at("basis_bpm").get<double>() == 128.0,
         "kiste.json basis_bpm = 128.0");
  pruefe(kiste.at("geaendert_sample").get<long long>() == 1800000, "kiste.json geaendert_sample als int64");

  // kern.toml mit den Vorgaben aus §2.1
  const auto kern = toml::parse(R"(version = 1
start_bpm = 128.0
udp_port = 47100
arbeitsbestand = "/dev/shm/cypherdj/material"
pruefmodus = false
ziel_lufs = -16.0
)"sv);
  pruefe(kern["version"].value<int64_t>() == 1, "kern.toml version = 1");
  pruefe(kern["udp_port"].value<int64_t>() == 47100, "kern.toml udp_port = 47100");
  pruefe(kern["ziel_lufs"].value<double>() == -16.0, "kern.toml ziel_lufs = -16.0");
  pruefe(kern["arbeitsbestand"].value<std::string_view>() == "/dev/shm/cypherdj/material"sv, "kern.toml arbeitsbestand");

  // Fehlerfall: kaputtes TOML muss als Fehler ankommen, nicht still als leere Tabelle
  bool geworfen = false;
  try {
    (void)toml::parse("udp_port = = 1"sv);
  } catch (const toml::parse_error&) {
    geworfen = true;
  }
  pruefe(geworfen, "kaputtes TOML wirft toml::parse_error");
  return fehler == 0 ? 0 : 1;
}
