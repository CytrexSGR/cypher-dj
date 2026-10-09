// Scheibe 08: die Schlüssel des Lesers (KERN_SCHLUESSEL) sind genau die aus djk/vertrag/konfig.schema.json
// $defs["kern.toml"] (Scheibe 02), mit demselben x-typ; jede Vorgabe aus dem Schema liest der Leser als Wert zurück.
// Fehlerfall: ein Schlüssel, den das Schema nicht kennt, wird vom Leser abgelehnt.
// Scheibe 25: Schlüssel unter $defs["kern.toml"]["x-vorgemerkt"] (filter_guete, Nachtrag 04) liest der Leser schon;
// solange das Schema sie nicht nach properties hebt, zählen sie hier wie properties.
#include <fstream>
#include <set>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>

#include "cypherdj/konfig.h"
#include "pruef.h"

int main() {
  std::ifstream f(std::string(CYPHERDJ_DJK) + "/vertrag/konfig.schema.json");
  PRUEF(f.good());
  if (!f.good()) PRUEF_ENDE();
  const nlohmann::json schema = nlohmann::json::parse(f);
  nlohmann::json props = schema["$defs"]["kern.toml"]["properties"];
  if (schema["$defs"]["kern.toml"].contains("x-vorgemerkt"))
    for (auto it = schema["$defs"]["kern.toml"]["x-vorgemerkt"].begin();
         it != schema["$defs"]["kern.toml"]["x-vorgemerkt"].end(); ++it)
      props[it.key()] = it.value();
  std::set<std::string> im_schema, im_leser;
  for (auto it = props.begin(); it != props.end(); ++it) im_schema.insert(it.key());
  for (int i = 0; cdj::KERN_SCHLUESSEL[i].name; ++i) {
    const std::string n = cdj::KERN_SCHLUESSEL[i].name;
    im_leser.insert(n);
    if (n == "version") continue;
    PRUEF(props.contains(n));
    if (props.contains(n)) PRUEF(props[n]["x-typ"].get<std::string>() == cdj::KERN_SCHLUESSEL[i].typ);
  }
  PRUEF(im_schema == im_leser);
  PRUEF(im_leser.size() == 18);  // Keylock Task 3: keylock dazu; Bungee S2: keylock_maschine

  // Jede Vorgabe aus dem Schema als TOML-Zeile: der Leser nimmt sie an (Negativ-Kontrolle)
  std::ostringstream toml;
  toml << "version = 1\n";
  for (auto it = props.begin(); it != props.end(); ++it) {
    if (it.key() == "version") continue;
    const auto& d = it.value()["default"];
    toml << it.key() << " = ";
    if (d.is_string()) toml << '"' << d.get<std::string>() << '"';
    else if (d.is_boolean()) toml << (d.get<bool>() ? "true" : "false");
    else toml << d.dump();
    toml << "\n";
  }
  bool gelesen = true;
  try {
    cdj::lies_kern_toml_text(toml.str(), "schema-vorgaben");
  } catch (const cdj::KonfigFehler&) {
    gelesen = false;
  }
  PRUEF(gelesen);
  // Fehlerfall: ein Schlüssel außerhalb des Schemas
  bool abgelehnt = false;
  try {
    cdj::lies_kern_toml_text(toml.str() + "puffer = 256\n", "schema-plus-eins");
  } catch (const cdj::KonfigFehler& e) {
    abgelehnt = std::string(e.what()).find("'puffer'") != std::string::npos;
  }
  PRUEF(abgelehnt);
  // Scheibe 25: filter_guete (A27 Weg a) wird gelesen und ist außerhalb 0,5 bis 4 ein Startfehler
  cdj::KernKonfig k = cdj::lies_kern_toml_text("version = 1\nfilter_guete = 2.5\n", "guete");
  PRUEF(k.filter_guete == 2.5);
  PRUEF(cdj::lies_kern_toml_text("version = 1\n", "ohne").filter_guete == 0.707);
  for (const char* z : {"filter_guete = 8.5\n", "filter_guete = 4.5\n", "filter_guete = 0.4\n", "filter_guete = nan\n"}) {
    bool nein = false;
    try {
      cdj::lies_kern_toml_text(std::string("version = 1\n") + z, "guete-aus");
    } catch (const cdj::KonfigFehler& e) {
      nein = std::string(e.what()).find("'filter_guete'") != std::string::npos;
    }
    PRUEF(nein);
  }
  // Keylock Task 3: kern.toml keylock (bool, Vorgabe true): false -> Kern ohne Dehner (main.cpp, Kern::keylock_nach_konfig)
  PRUEF(cdj::lies_kern_toml_text("version = 1\n", "ohne").keylock == true);
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkeylock = false\n", "keylock-aus").keylock == false);
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkeylock = true\n", "keylock-an").keylock == true);
  bool kein_bool = false;
  try {
    cdj::lies_kern_toml_text("version = 1\nkeylock = 0\n", "keylock-zahl");
  } catch (const cdj::KonfigFehler& e) {
    kein_bool = std::string(e.what()).find("'keylock'") != std::string::npos;
  }
  PRUEF(kein_bool);
  bool im_schema_kl = props.contains("keylock") && props["keylock"]["default"] == true;
  PRUEF(im_schema_kl);
  // Bungee S2: keylock_maschine r3 (Vorgabe, Rückfall) | bungee | bungee_fein; alles andere ist ein Startfehler
  PRUEF(cdj::lies_kern_toml_text("version = 1\n", "ohne").keylock_maschine == "r3");
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkeylock_maschine = \"bungee\"\n", "b").keylock_maschine == "bungee");
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkeylock_maschine = \"bungee_fein\"\n", "bf").keylock_maschine == "bungee_fein");
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkeylock_maschine = \"r3\"\n", "r").keylock_maschine == "r3");
  for (const char* z : {"keylock_maschine = \"rubberband\"\n", "keylock_maschine = 1\n", "keylock_maschine = \"\"\n"}) {
    bool nein = false;
    try {
      cdj::lies_kern_toml_text(std::string("version = 1\n") + z, "maschine-falsch");
    } catch (const cdj::KonfigFehler& e) {
      nein = std::string(e.what()).find("'keylock_maschine'") != std::string::npos;
    }
    PRUEF(nein);
  }
  PRUEF(props.contains("keylock_maschine") && props["keylock_maschine"]["default"] == "r3");
  PRUEF_ENDE();
}
