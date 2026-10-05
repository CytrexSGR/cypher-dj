#include "cypherdj/konfig.h"

#include <cstdlib>
#include <fstream>
#include <sstream>

#include <toml++/toml.hpp>

#include "cypherdj/instanz.h"

namespace cdj {

const KonfigSchluessel KERN_SCHLUESSEL[17] = {
    {"version", "version"},          {"start_bpm", "float"},       {"udp_port", "int"},
    {"arbeitsbestand", "Pfad"},      {"speicher_budget_mib", "int"}, {"controller_geraet", "str"},
    {"ziel_lufs", "float"},          {"hoerbar_db", "float"},      {"tief_offen_db", "float"},
    {"max_stretcher", "int"},        {"stretcher_threads", "int"}, {"limiter_dbtp", "float"},
    {"pruefmodus", "bool"},          {"filter_guete", "float"},    {"hand_osc", "bool"},
    {"hoerschein_pflicht", "bool"},
    {nullptr, nullptr},
};

namespace {

[[noreturn]] void fehler(const std::string& quelle, const std::string& text) {
  throw KonfigFehler(quelle + ": " + text);
}

double als_zahl(const toml::node& n, std::string_view s, const std::string& quelle) {
  if (auto v = n.as_floating_point()) return v->get();
  if (auto v = n.as_integer()) return static_cast<double>(v->get());
  fehler(quelle, "Schlüssel '" + std::string(s) + "' muss eine Zahl sein");
}

int als_ganzzahl(const toml::node& n, std::string_view s, const std::string& quelle) {
  if (auto v = n.as_integer()) return static_cast<int>(v->get());
  fehler(quelle, "Schlüssel '" + std::string(s) + "' muss eine ganze Zahl sein");
}

std::string als_text(const toml::node& n, std::string_view s, const std::string& quelle) {
  if (auto v = n.as_string()) return v->get();
  fehler(quelle, "Schlüssel '" + std::string(s) + "' muss eine Zeichenkette sein");
}

bool als_schalter(const toml::node& n, std::string_view s, const std::string& quelle) {
  if (auto v = n.as_boolean()) return v->get();
  fehler(quelle, "Schlüssel '" + std::string(s) + "' muss true oder false sein");
}

}  // namespace

KernKonfig lies_kern_toml_text(std::string_view text, const std::string& quelle) {
  toml::table t;
  try {
    t = toml::parse(text, quelle);
  } catch (const toml::parse_error& e) {
    std::ostringstream o;
    o << "kein gültiges TOML: " << e.description() << " (Zeile " << e.source().begin.line << ")";
    fehler(quelle, o.str());
  }
  KernKonfig k;
  bool hat_version = false;
  for (auto&& [schluessel, wert] : t) {
    const std::string_view s = schluessel.str();
    if (s == "version") {
      if (als_ganzzahl(wert, s, quelle) != 1) fehler(quelle, "Schlüssel 'version' muss 1 sein");
      hat_version = true;
    } else if (s == "start_bpm") {
      k.start_bpm = als_zahl(wert, s, quelle);
    } else if (s == "udp_port") {
      k.udp_port = als_ganzzahl(wert, s, quelle);
    } else if (s == "arbeitsbestand") {
      k.arbeitsbestand = als_text(wert, s, quelle);
    } else if (s == "speicher_budget_mib") {
      k.speicher_budget_mib = als_ganzzahl(wert, s, quelle);
    } else if (s == "controller_geraet") {
      k.controller_geraet = als_text(wert, s, quelle);
    } else if (s == "ziel_lufs") {
      k.ziel_lufs = als_zahl(wert, s, quelle);
    } else if (s == "hoerbar_db") {
      k.hoerbar_db = als_zahl(wert, s, quelle);
    } else if (s == "tief_offen_db") {
      k.tief_offen_db = als_zahl(wert, s, quelle);
    } else if (s == "max_stretcher") {
      k.max_stretcher = als_ganzzahl(wert, s, quelle);
    } else if (s == "stretcher_threads") {
      k.stretcher_threads = als_ganzzahl(wert, s, quelle);
    } else if (s == "limiter_dbtp") {
      k.limiter_dbtp = als_zahl(wert, s, quelle);
    } else if (s == "pruefmodus") {
      k.pruefmodus = als_schalter(wert, s, quelle);
    } else if (s == "hand_osc") {  // Scheibe 35, B-O Weg 1
      k.hand_osc = als_schalter(wert, s, quelle);
    } else if (s == "filter_guete") {  // Scheibe 25 (A27 Weg a, Nachtrag 04)
      k.filter_guete = als_zahl(wert, s, quelle);
    } else if (s == "hoerschein_pflicht") {  // Ohr T13: schaltet PrueferI3 (I3a, §17) an
      k.hoerschein_pflicht = als_schalter(wert, s, quelle);
    } else {
      fehler(quelle, "unbekannter Schlüssel '" + std::string(s) + "'");  // §2.1: Tippfehler fallen sofort auf
    }
  }
  if (!hat_version) fehler(quelle, "Schlüssel 'version' fehlt (erste Zeile: version = 1)");
  if (k.start_bpm < 60.0 || k.start_bpm > 200.0) fehler(quelle, "Schlüssel 'start_bpm' außerhalb 60 bis 200");
  if (k.udp_port < 1024 || k.udp_port > 65535 - 9000) fehler(quelle, "Schlüssel 'udp_port' außerhalb 1024 bis 56535");
  if (k.speicher_budget_mib < 1 || k.speicher_budget_mib >= 4096)
    fehler(quelle, "Schlüssel 'speicher_budget_mib' muss zwischen 1 und 4095 liegen (10 Probe d)");
  if (!(k.filter_guete >= 0.5 && k.filter_guete <= 4.0))  // auch NaN; über 4 gesperrt bis zum Hörvergleich (Stand 04, Subbass +12 dB)
    fehler(quelle, "Schlüssel 'filter_guete' außerhalb 0,5 bis 4");
  if (k.stretcher_threads < 1) fehler(quelle, "Schlüssel 'stretcher_threads' muss mindestens 1 sein");
  if (k.max_stretcher < 0) fehler(quelle, "Schlüssel 'max_stretcher' darf nicht negativ sein");
  return k;
}

KernKonfig lies_kern_toml(const std::string& pfad) {
  std::ifstream f(pfad);
  if (!f) throw KonfigFehler(pfad + ": Datei fehlt oder ist nicht lesbar");
  std::ostringstream o;
  o << f.rdbuf();
  return lies_kern_toml_text(o.str(), pfad);
}

std::string standard_konfig_pfad(const char* instanz) {
  const char* home = std::getenv("HOME");
  const std::string ordner = (instanz && instanz[0]) ? std::string("cypherdj-") + instanz : "cypherdj";
  return std::string(home ? home : "") + "/.config/" + ordner + "/kern.toml";
}

void wende_instanz_an(KernKonfig& k, const char* instanz) {
  if (!instanz || !instanz[0]) return;
  k.udp_port = cdj_port(k.udp_port, instanz);
  const std::string alt = "/cypherdj/";
  const auto pos = k.arbeitsbestand.find(alt);
  if (pos != std::string::npos) k.arbeitsbestand.replace(pos, alt.size(), std::string("/cypherdj-") + instanz + "/");
}

}  // namespace cdj
