// K2 Task 1.1: ein Kit-Klang mit Strudel-Namen bd:* ist Duck-Auslöser, alles andere nicht
#include "cypherdj/kit.h"
#include "pruef.h"
#include <cstdlib>
#include <filesystem>
#include <string>
#include <unistd.h>
#include <fstream>

namespace fs = std::filesystem;

static void klang(const fs::path& d, const char* datei) {
  std::ofstream f(d / datei, std::ios::binary);
  const float null[2] = {0.5f, 0.5f};
  f.write(reinterpret_cast<const char*>(null), sizeof null);   // 1 Frame
}

int main() {
  const fs::path d = fs::temp_directory_path() / ("kit_duck_" + std::to_string(::getpid()));
  fs::create_directories(d);
  klang(d, "a.f32"); klang(d, "b.f32"); klang(d, "c.f32"); klang(d, "e.f32");
  std::ofstream(d / "kit.json") << R"({"schema":1,"name":"t","klaenge":[
    {"note":0,"name":"bd:0","datei":"a.f32","frames":1},
    {"note":1,"name":"hh:0","datei":"b.f32","frames":1},
    {"note":2,"name":"bd","datei":"c.f32","frames":1},
    {"note":3,"name":"bdx:0","datei":"e.f32","frames":1}]})";
  std::string fehler;
  auto kit = cdj::lade_kit(d.string(), &fehler);
  PRUEF(kit != nullptr);
  if (kit) {
    PRUEF(kit->klang[0].duck);
    PRUEF(!kit->klang[1].duck);
    PRUEF(kit->klang[2].duck);    // "bd" ohne Index ist in Strudel bd:0
    PRUEF(!kit->klang[3].duck);   // nur der Teil vor ':' zählt, "bdx" ist kein bd
  }
  // lade_kits: das Flag überlebt das Zusammenführen (b-Klänge werden samt Feldern verschoben)
  const fs::path d2 = fs::temp_directory_path() / ("kit_duck2_" + std::to_string(::getpid()));
  fs::create_directories(d2);
  klang(d2, "x.f32");
  std::ofstream(d2 / "kit.json") << R"({"schema":1,"name":"u","klaenge":[
    {"note":10,"name":"bd:3","datei":"x.f32","frames":1}]})";
  auto beide = cdj::lade_kits(d.string(), d2.string(), &fehler);
  PRUEF(beide != nullptr);
  if (beide) {
    PRUEF(beide->klang[0].duck);
    PRUEF(beide->klang[cdj::KIT_NOTEN + 10].duck);
    PRUEF(!beide->klang[1].duck);
  }
  fs::remove_all(d);
  fs::remove_all(d2);
  PRUEF_ENDE();
}
