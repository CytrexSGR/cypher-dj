#include "cypherdj/kit.h"

#include <cmath>
#include <fstream>
#include <nlohmann/json.hpp>

namespace cdj {

namespace {

bool datei_name_ok(const std::string& d) {  // nur ein Name im Kit-Ordner, Endung .f32
  if (d.size() < 5 || d.size() > 64 || d.find('/') != std::string::npos || d.find("..") != std::string::npos) return false;
  return d.compare(d.size() - 4, 4, ".f32") == 0;
}

}  // namespace

std::unique_ptr<Kit> lade_kit(const std::string& ordner, std::string* fehler) {
  auto fail = [&](const std::string& t) {
    if (fehler) *fehler = ordner + "/kit.json: " + t;
    return std::unique_ptr<Kit>();
  };
  std::ifstream in(ordner + "/kit.json");
  if (!in) return fail("fehlt");
  nlohmann::json j;
  try {
    in >> j;
  } catch (const std::exception& e) {
    return fail(std::string("unlesbar: ") + e.what());
  }
  if (!j.is_object() || !j.contains("schema") || j["schema"] != 1) return fail("schema ist nicht 1");
  if (!j.contains("klaenge") || !j["klaenge"].is_array()) return fail("klaenge fehlt");
  auto kit = std::make_unique<Kit>();
  kit->name = j.value("name", std::string());
  kit->ordner = ordner;
  int64_t bytes = 0;
  for (const auto& k : j["klaenge"]) {
    if (!k.is_object() || !k.contains("note") || !k["note"].is_number_integer()) return fail("klang ohne ganze note");
    const int note = k["note"].get<int>();
    if (note < 0 || note >= KIT_NOTEN) return fail("note " + std::to_string(note) + " ausserhalb 0..127");
    KitKlang& kl = kit->klang[note];
    if (kl.frames > 0) return fail("note " + std::to_string(note) + " doppelt");
    const std::string datei = k.value("datei", std::string());
    if (!datei_name_ok(datei)) return fail("datei \"" + datei + "\" unzulaessig");
    const int64_t frames = k.value("frames", (int64_t)0);
    if (frames <= 0 || frames > KIT_MAX_FRAMES) return fail(datei + ": frames " + std::to_string(frames));
    bytes += frames * 8;
    if (bytes > KIT_MAX_BYTES) return fail("groesser als " + std::to_string(KIT_MAX_BYTES >> 20) + " MiB");
    std::ifstream f(ordner + "/" + datei, std::ios::binary | std::ios::ate);
    if (!f) return fail(datei + " fehlt");
    if ((int64_t)f.tellg() != frames * 8) return fail(datei + ": Groesse passt nicht zu frames");
    f.seekg(0);
    kl.daten.resize((size_t)frames * 2);
    f.read(reinterpret_cast<char*>(kl.daten.data()), (std::streamsize)(frames * 8));
    for (float x : kl.daten)
      if (!std::isfinite(x)) return fail(datei + ": NaN oder Inf");
    kl.name = k.value("name", datei);
    {   // K2 Task 1.1: Duck-Auslöser aus dem Namen, einmal beim Laden (im Callback kein Stringvergleich)
      const std::string& nm = kl.name;
      const size_t dp = nm.find(':');
      kl.duck = nm.compare(0, dp == std::string::npos ? nm.size() : dp, "bd") == 0;
    }
    kl.frames = frames;
    ++kit->n;
  }
  if (kit->n == 0) return fail("keine klaenge");
  return kit;
}

std::unique_ptr<Kit> lade_kits(const std::string& ordner_a, const std::string& ordner_b, std::string* fehler) {
  std::unique_ptr<Kit> a = lade_kit(ordner_a, fehler);
  if (!a) return a;
  std::ifstream probe(ordner_b + "/kit.json");
  if (!probe) return a;  // b gibt es noch nicht
  std::unique_ptr<Kit> b = lade_kit(ordner_b, fehler);
  if (!b) return b;
  for (int n = 0; n < KIT_NOTEN; ++n) {  // F08: b auf KIT_NOTEN + n, eine Kollision ist ausgeschlossen
    if (b->klang[n].frames <= 0) continue;
    a->klang[KIT_NOTEN + n] = std::move(b->klang[n]);
    ++a->n;
  }
  a->name += "+" + b->name;
  return a;
}

}  // namespace cdj
