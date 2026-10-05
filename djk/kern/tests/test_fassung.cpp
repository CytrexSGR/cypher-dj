// fassung.json lesen (SCHNITTSTELLEN §13.2), Pfade (§6.4, §13.1) und Raster der Fassung (§13.1). Scheibe 31.
// Positiv: die Fixtures der Golden-Folgen (djk/vertrag/folgen/material/). Fehlerfall: kaputte Kopien davon.
#include <unistd.h>

#include <filesystem>
#include <fstream>
#include <string>

#include <nlohmann/json.hpp>

#include "cypherdj/fassung.h"
#include "pruef.h"

namespace fs = std::filesystem;
using nlohmann::json;

static const std::string FIXTURES = std::string(CYPHERDJ_DJK) + "/vertrag/folgen/material/";

// Schreibt eine veränderte Kopie der Fixture a1 nach <tmp>/<name>/fassung.json und gibt den Ordner zurück.
static std::string kopie(const fs::path& tmp, const std::string& name, void (*aendere)(json&)) {
  std::ifstream f(FIXTURES + "f0000000000000a1/fassungen/128000_r1/fassung.json");
  json j = json::parse(f);
  aendere(j);
  const fs::path o = tmp / name;
  fs::create_directories(o);
  std::ofstream(o / "fassung.json") << j.dump(1);
  return o.string();
}

int main() {
  // Pfade und Kennungen
  PRUEF(cdj::bpm_text(128.0) == "128000");
  PRUEF(cdj::bpm_text(124.5) == "124500");
  PRUEF(cdj::fassung_ordner("/dev/shm/cypherdj-a/material", "f0000000000000a1", 128.0, 1) ==
        "/dev/shm/cypherdj-a/material/f0000000000000a1/fassungen/128000_r1");
  PRUEF(cdj::material_id_gueltig("f0000000000000a1"));
  PRUEF(!cdj::material_id_gueltig("F0000000000000A1"));  // §1.4: Kleinbuchstaben
  PRUEF(!cdj::material_id_gueltig("f0000000000000a"));
  PRUEF(!cdj::material_id_gueltig("../../etc/passwd"));

  // Raster §13.1: bei 128 BPM 22 500 Frames je Beat; Quell-Beat 16,5 ab erstem Schlag 1234
  PRUEF_NAH(cdj::frame_von(16.5, 0, 128.0), 371250.0, 0.0);
  PRUEF_NAH(cdj::frame_von(16.5, 1234, 128.0), 372484.0, 0.0);
  PRUEF_NAH(cdj::frame_von(1.0, 0, 124.0), 23225.806451612903, 1e-9);
  PRUEF_NAH(cdj::quell_beat_von(cdj::frame_von(100.25, 777, 124.0), 777, 124.0), 100.25, 1e-12);

  // Positiv: Fixtures a1 (256 Beats, −16 LUFS) und c3 (64 Beats, −9,4 LUFS)
  cdj::FassungInfo a;
  std::string m;
  PRUEF(cdj::lies_fassung(FIXTURES + "f0000000000000a1/fassungen/128000_r1", a, m) == cdj::FassungFehler::keiner);
  PRUEF(a.material_id == "f0000000000000a1" && a.basis_bpm == 128.0 && a.fassung == 1 && a.datei == "basis.f32");
  PRUEF(a.frames == 5760000 && a.erster_schlag_frame == 0 && a.beats == 256.0 && a.erste_eins_quell_beat == 0);
  PRUEF(a.analyse_quelle == "basis" && !a.hat_stems && a.lufs_integriert == -16.0 && a.sha256.size() == 64);
  cdj::FassungInfo c;
  PRUEF(cdj::lies_fassung(FIXTURES + "f0000000000000c3/fassungen/128000_r1", c, m) == cdj::FassungFehler::keiner);
  PRUEF_NAH(c.lufs_integriert, -9.4, 1e-12);

  // Fehlerfall: fehlender Ordner, kaputtes JSON, falsches Schema, fehlendes Feld, halbe Stems
  const fs::path tmp = fs::temp_directory_path() / ("test_fassung_" + std::to_string(::getpid()));
  fs::create_directories(tmp);
  PRUEF(cdj::lies_fassung((tmp / "gibt_es_nicht").string(), a, m) == cdj::FassungFehler::fehlt);
  fs::create_directories(tmp / "kaputt");
  std::ofstream(tmp / "kaputt" / "fassung.json") << "{\"schema\": 1,";
  PRUEF(cdj::lies_fassung((tmp / "kaputt").string(), a, m) == cdj::FassungFehler::form);
  PRUEF(cdj::lies_fassung(kopie(tmp, "schema2", [](json& j) { j["schema"] = 2; }), a, m) ==
        cdj::FassungFehler::form);
  PRUEF(m.find("schema 2") != std::string::npos);
  PRUEF(cdj::lies_fassung(kopie(tmp, "ohne_frames", [](json& j) { j.erase("frames"); }), a, m) ==
        cdj::FassungFehler::form);
  PRUEF(m.find("frames") != std::string::npos);
  PRUEF(cdj::lies_fassung(kopie(tmp, "halbe_stems", [](json& j) {
          j["stems"]["drums"] = {{"datei", "stems/drums.f32"}, {"sha256", std::string(64, 'a')}, {"frames", 5760000}};
        }), a, m) == cdj::FassungFehler::form);
  PRUEF(cdj::lies_fassung(kopie(tmp, "lufs_text", [](json& j) { j["lautheit"]["lufs_integriert"] = "laut"; }), a,
                          m) == cdj::FassungFehler::form);
  PRUEF(cdj::lies_fassung(kopie(tmp, "datei_raus", [](json& j) { j["datei"] = "../../f0000000000000c3/basis.f32"; }),
                          a, m) == cdj::FassungFehler::form);
  PRUEF(m.find("verlässt") != std::string::npos);
  // Negativ-Kontrolle: dieselbe Kopie ohne Änderung liest sich wie das Original
  PRUEF(cdj::lies_fassung(kopie(tmp, "unveraendert", [](json&) {}), a, m) == cdj::FassungFehler::keiner);
  PRUEF(a.frames == 5760000);
  // vier Stems: gelesen, hat_stems
  PRUEF(cdj::lies_fassung(kopie(tmp, "vier_stems", [](json& j) {
          for (const char* n : {"drums", "bass", "vocals", "other"})
            j["stems"][n] = {{"datei", std::string("stems/") + n + ".f32"}, {"sha256", std::string(64, 'b')},
                             {"frames", 5760000}};
          j["analyse_quelle"] = "stems";
        }), a, m) == cdj::FassungFehler::keiner);
  PRUEF(a.hat_stems && a.stems[2].datei == "stems/vocals.f32" && a.analyse_quelle == "stems");
  fs::remove_all(tmp);
  PRUEF_ENDE();
}
