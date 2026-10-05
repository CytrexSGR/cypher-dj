// Fassungen im Arbeitsbestand (fassung.h). Scheibe 31.
#include "cypherdj/fassung.h"

#include <cmath>
#include <cstdio>
#include <fstream>

#include <nlohmann/json.hpp>

namespace cdj {

const char* const STEM_NAMEN[STEM_ANZAHL] = {"drums", "bass", "vocals", "other"};

std::string bpm_text(double basis_bpm) { return std::to_string(std::llround(basis_bpm * 1000.0)); }

std::string fassung_ordner(const std::string& arbeitsbestand, const std::string& material_id, double basis_bpm,
                           int fassung) {
  return arbeitsbestand + "/" + material_id + "/fassungen/" + bpm_text(basis_bpm) + "_r" + std::to_string(fassung);
}

bool material_id_gueltig(const char* id) {
  if (!id) return false;
  int n = 0;
  for (; id[n]; ++n) {
    const char c = id[n];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return n == 16;
}

namespace {

using json = nlohmann::json;

// Holt ein Pflichtfeld; wirft mit Feldnamen, wenn es fehlt oder den falschen Typ hat.
const json& feld(const json& o, const char* name, json::value_t typ, const char* pfad) {
  if (!o.is_object() || !o.contains(name)) throw std::runtime_error(std::string("Feld ") + pfad + name + " fehlt");
  const json& w = o.at(name);
  const bool zahl = typ == json::value_t::number_float;
  const bool ganz = typ == json::value_t::number_integer;
  if ((zahl && !w.is_number()) || (ganz && !w.is_number_integer()) ||
      (!zahl && !ganz && w.type() != typ))
    throw std::runtime_error(std::string("Feld ") + pfad + name + " hat den falschen Typ");
  return w;
}

// Dateinamen aus fassung.json bleiben im Fassungs-Ordner: relativ, ohne "..".
bool datei_im_ordner(const std::string& d) {
  return !d.empty() && d.front() != '/' && d.find("..") == std::string::npos;
}

bool hex64(const std::string& s) {
  if (s.size() != 64) return false;
  for (char c : s)
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  return true;
}

}  // namespace

FassungFehler lies_fassung(const std::string& ordner, FassungInfo& aus, std::string& meldung) {
  const std::string pfad = ordner + "/fassung.json";
  std::ifstream f(pfad);
  if (!f) {
    meldung = pfad + " fehlt";
    return FassungFehler::fehlt;
  }
  try {
    const json j = json::parse(f);
    using T = json::value_t;
    FassungInfo x;
    x.schema = feld(j, "schema", T::number_integer, "").get<int>();
    if (x.schema != 1) throw std::runtime_error("schema " + std::to_string(x.schema) + " statt 1");
    x.material_id = feld(j, "material_id", T::string, "").get<std::string>();
    x.basis_bpm = feld(j, "basis_bpm", T::number_float, "").get<double>();
    x.fassung = feld(j, "fassung", T::number_integer, "").get<int>();
    x.datei = feld(j, "datei", T::string, "").get<std::string>();
    x.frames = feld(j, "frames", T::number_integer, "").get<int64_t>();
    x.sha256 = feld(j, "sha256", T::string, "").get<std::string>();
    x.erster_schlag_frame = feld(j, "erster_schlag_frame", T::number_integer, "").get<int64_t>();
    x.beats = feld(j, "beats", T::number_float, "").get<double>();
    x.erste_eins_quell_beat = feld(j, "erste_eins_quell_beat", T::number_integer, "").get<int>();
    x.analyse_quelle = feld(j, "analyse_quelle", T::string, "").get<std::string>();
    const json& stems = feld(j, "stems", T::object, "");
    const json& laut = feld(j, "lautheit", T::object, "");
    x.lufs_integriert = feld(laut, "lufs_integriert", T::number_float, "lautheit.").get<double>();
    if (!material_id_gueltig(x.material_id.c_str())) throw std::runtime_error("material_id nicht 16 Hex-Zeichen");
    if (!(x.basis_bpm > 0.0 && x.basis_bpm < 1000.0)) throw std::runtime_error("basis_bpm außerhalb (0, 1000)");
    if (x.fassung < 1) throw std::runtime_error("fassung < 1");
    if (x.frames < 1) throw std::runtime_error("frames < 1");
    if (!hex64(x.sha256)) throw std::runtime_error("sha256 nicht 64 Hex-Zeichen");
    if (x.erster_schlag_frame < 0 || x.erster_schlag_frame >= x.frames)
      throw std::runtime_error("erster_schlag_frame außerhalb [0, frames)");
    if (!(x.beats > 0.0) || !std::isfinite(x.beats)) throw std::runtime_error("beats nicht positiv");
    if (x.erste_eins_quell_beat < 0 || x.erste_eins_quell_beat > 3)
      throw std::runtime_error("erste_eins_quell_beat außerhalb 0 bis 3");
    if (x.analyse_quelle != "stems" && x.analyse_quelle != "basis")
      throw std::runtime_error("analyse_quelle weder stems noch basis");
    if (!datei_im_ordner(x.datei)) throw std::runtime_error("datei verlässt den Fassungs-Ordner");
    if (!std::isfinite(x.lufs_integriert)) throw std::runtime_error("lautheit.lufs_integriert nicht endlich");
    int n_stems = 0;
    for (int i = 0; i < STEM_ANZAHL; ++i) {
      if (!stems.contains(STEM_NAMEN[i])) continue;
      const json& s = stems.at(STEM_NAMEN[i]);
      const std::string p = std::string("stems.") + STEM_NAMEN[i] + ".";
      x.stems[i].datei = feld(s, "datei", T::string, p.c_str()).get<std::string>();
      x.stems[i].sha256 = feld(s, "sha256", T::string, p.c_str()).get<std::string>();
      x.stems[i].frames = feld(s, "frames", T::number_integer, p.c_str()).get<int64_t>();
      if (!hex64(x.stems[i].sha256)) throw std::runtime_error(p + "sha256 nicht 64 Hex-Zeichen");
      if (!datei_im_ordner(x.stems[i].datei)) throw std::runtime_error(p + "datei verlässt den Fassungs-Ordner");
      ++n_stems;
    }
    if (n_stems != 0 && n_stems != STEM_ANZAHL) throw std::runtime_error("stems: nicht alle vier (§13.1)");
    x.hat_stems = n_stems == STEM_ANZAHL;
    aus = std::move(x);
    return FassungFehler::keiner;
  } catch (const std::exception& e) {
    meldung = pfad + ": " + e.what();
    return FassungFehler::form;
  }
}

}  // namespace cdj
