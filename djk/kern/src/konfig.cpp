#include "cypherdj/konfig.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <utility>
#include <filesystem>
#include <fstream>
#include <sstream>

#include <toml++/toml.hpp>

#include "cypherdj/instanz.h"

namespace cdj {

const KonfigSchluessel KERN_SCHLUESSEL[30] = {
    {"version", "version"},          {"start_bpm", "float"},       {"udp_port", "int"},
    {"arbeitsbestand", "Pfad"},      {"speicher_budget_mib", "int"}, {"controller_geraet", "str"},
    {"ziel_lufs", "float"},          {"hoerbar_db", "float"},      {"tief_offen_db", "float"},
    {"max_stretcher", "int"},        {"stretcher_threads", "int"}, {"limiter_dbtp", "float"},
    {"pruefmodus", "bool"},          {"filter_guete", "float"},    {"hand_osc", "bool"},
    {"hoerschein_pflicht", "bool"},  {"keylock", "bool"},
    {"keylock_maschine", "str"},
    {"arr_ordner", "Pfad"},          {"arr_budget_mib", "int"},     // D1 K1
    {"warp_faeden", "int"},                                         // 1.13 Slice 2
    {"graph_faeden", "int"},                                        // Baukasten S3b
    {"kanal_limiter_vorhalt_ms", "float"}, {"kanal_limiter_echtspitze", "bool"},   // 1.15 A1b
    {"hall_faeden", "int"}, {"hall_cpus", "str"},                  // mehrkern Task 5
    {"stimme_eingang", "int"}, {"stimme_duck_db", "float"}, {"stimme_pegel_db", "float"},   // voice channel (demo)
    {nullptr, nullptr},
};

namespace {

// The CPUs that are online ("0-3,8-11" in /sys/devices/system/cpu/online); empty when the file cannot be read or parsed (then only existence is checked).
std::vector<int> cpus_online() {
  std::ifstream f("/sys/devices/system/cpu/online");
  std::string z;
  std::vector<int> r;
  if (!f || !std::getline(f, z)) return r;
  size_t i = 0;
  while (i < z.size()) {
    size_t j = i;
    while (j < z.size() && z[j] != ',') ++j;
    const std::string t = z.substr(i, j - i);
    const size_t strich = t.find('-');
    try {
      const int a = std::stoi(t.substr(0, strich)), b = strich == std::string::npos ? a : std::stoi(t.substr(strich + 1));
      for (int c = a; c <= b; ++c) r.push_back(c);
    } catch (...) {
      return {};
    }
    i = j + 1;
  }
  return r;
}

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

KernKonfig lies_kern_toml_text(std::string_view text, const std::string& quelle, int anzahl_cpus) {
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
    } else if (s == "keylock") {  // Keylock Task 3: false -> Kern ohne Dehner (Decks und Knopf im Varispeed)
      k.keylock = als_schalter(wert, s, quelle);
    } else if (s == "keylock_maschine") {  // Umbauplan Bungee S2: r3 | bungee | bungee_fein
      k.keylock_maschine = als_text(wert, s, quelle);
      if (k.keylock_maschine != "r3" && k.keylock_maschine != "bungee" && k.keylock_maschine != "bungee_fein")
        fehler(quelle, "Schlüssel 'keylock_maschine' muss \"r3\", \"bungee\" oder \"bungee_fein\" sein");
    } else if (s == "arr_ordner") {  // D1 K1 (Spec 2.9)
      k.arr_ordner = als_text(wert, s, quelle);
    } else if (s == "arr_budget_mib") {  // D1 K1 (Spec 2.1)
      k.arr_budget_mib = als_ganzzahl(wert, s, quelle);
    } else if (s == "warp_faeden") {  // 1.13 Slice 2 (ADR 031 Teil 2)
      k.warp_faeden = als_ganzzahl(wert, s, quelle);
    } else if (s == "graph_faeden") {  // Baukasten S3b
      k.graph_faeden = als_ganzzahl(wert, s, quelle);
    } else if (s == "kanal_limiter_vorhalt_ms") {  // 1.15 A1b
      k.kanal_limiter_vorhalt_ms = als_zahl(wert, s, quelle);
    } else if (s == "kanal_limiter_echtspitze") {  // 1.15 A1b
      k.kanal_limiter_echtspitze = als_schalter(wert, s, quelle);
    } else if (s == "hall_faeden") {  // mehrkern Task 5
      k.hall_faeden = als_ganzzahl(wert, s, quelle);
    } else if (s == "hall_cpus") {  // mehrkern Task 5
      k.hall_cpus = als_text(wert, s, quelle);
    } else if (s == "stimme_eingang") {  // voice channel
      k.stimme_eingang = als_ganzzahl(wert, s, quelle);
    } else if (s == "stimme_duck_db") {
      k.stimme_duck_db = als_zahl(wert, s, quelle);
    } else if (s == "stimme_pegel_db") {
      k.stimme_pegel_db = als_zahl(wert, s, quelle);
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
  // 1.15 mix tools: 0 (not built) or 0.1 to 20 ms (also rejects NaN)
  if (!(k.kanal_limiter_vorhalt_ms == 0.0 || (k.kanal_limiter_vorhalt_ms >= 0.1 && k.kanal_limiter_vorhalt_ms <= 20.0)))
    fehler(quelle, "key 'kanal_limiter_vorhalt_ms' must be 0 or between 0.1 and 20");
  if (k.arr_budget_mib < 1 || k.arr_budget_mib > k.speicher_budget_mib)
    fehler(quelle, "Schlüssel 'arr_budget_mib' muss zwischen 1 und speicher_budget_mib liegen (D1 2.1)");
  if (!k.arr_ordner.empty() && k.arr_ordner[0] != '/') fehler(quelle, "Schlüssel 'arr_ordner' muss ein absoluter Pfad sein");
  if (k.warp_faeden < 1 || k.warp_faeden > 8) fehler(quelle, "Schlüssel 'warp_faeden' muss zwischen 1 und 8 liegen (1.13 Slice 2)");
  if (k.graph_faeden < 0 || k.graph_faeden > 8) fehler(quelle, "Schlüssel 'graph_faeden' muss zwischen 0 und 8 liegen (Baukasten S3b)");
  if (k.hall_faeden < 0 || k.hall_faeden > 3) fehler(quelle, "key 'hall_faeden' must be between 0 and 3");
  if (k.stimme_eingang < 0 || k.stimme_eingang > 4) fehler(quelle, "key 'stimme_eingang' must be between 0 and 4");
  if (!(k.stimme_duck_db >= -40.0 && k.stimme_duck_db <= 0.0)) fehler(quelle, "key 'stimme_duck_db' must be between -40 and 0");
  if (!(k.stimme_pegel_db >= -40.0 && k.stimme_pegel_db <= 12.0)) fehler(quelle, "key 'stimme_pegel_db' must be between -40 and 12");
  if (!k.hall_cpus.empty()) {   // an unusable list is an error at load time, not when the workers pin themselves
    std::vector<int> ids;
    try {
      ids = hall_cpus_liste(k.hall_cpus);
    } catch (const KonfigFehler& e) {
      fehler(quelle, e.what());
    }
    if (k.hall_faeden == 0 && !ids.empty()) {
      // No pool: the key is unused, so it must not stop the start on a machine that lacks these CPUs. Syntax was checked above.
      std::fprintf(stderr, "kern.toml: warning, 'hall_cpus' is ignored because 'hall_faeden' is 0\n");
      ids.clear();
    }
    const std::vector<int> online = anzahl_cpus >= 0 || ids.empty() ? std::vector<int>{} : cpus_online();
    for (int id : ids) {
      if (anzahl_cpus >= 0) {
        if (id >= anzahl_cpus) fehler(quelle, "key 'hall_cpus': CPU " + std::to_string(id) + " does not exist on this machine");
        continue;
      }
      std::error_code ec;
      if (!std::filesystem::exists("/sys/devices/system/cpu/cpu" + std::to_string(id), ec))
        fehler(quelle, "key 'hall_cpus': CPU " + std::to_string(id) + " does not exist on this machine");
      if (!online.empty() && std::find(online.begin(), online.end(), id) == online.end())
        fehler(quelle, "key 'hall_cpus': CPU " + std::to_string(id) + " is offline");
    }
  }
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
  const auto pa = k.arr_ordner.find(alt);
  if (pa != std::string::npos) k.arr_ordner.replace(pa, alt.size(), std::string("/cypherdj-") + instanz + "/");
}

// D1 Spec 6.14: normalisiert (lexically_normal, ohne abschließenden Schrägstrich), damit die Prüfung „Audio nur unterhalb
// von arr_ordner“ nicht an // oder einem Schrägstrich am Ende scheitert. Erst hier, nach Z2: wende_instanz_an sucht
// "/cypherdj/" im Text, wie er in kern.toml steht.
std::string arr_ordner_von(const KernKonfig& k, const char* instanz) {
  std::string roh = k.arr_ordner;
  if (roh.empty()) {
    const char* home = std::getenv("HOME");
    const std::string ordner = (instanz && instanz[0]) ? std::string("cypherdj-") + instanz : "cypherdj";
    roh = std::string(home ? home : "") + "/.cache/" + ordner + "/arr";
  }
  std::string n = std::filesystem::path(roh).lexically_normal().string();
  while (n.size() > 1 && n.back() == '/') n.pop_back();
  return n;
}


std::vector<int> hall_cpus_liste(const std::string& text) {
  std::vector<int> ids;
  const auto blank = [](char c) { return c == ' ' || c == '\t'; };
  size_t i = 0;
  const size_t n = text.size();
  while (i < n && blank(text[i])) ++i;
  if (i == n) return ids;   // "" or only blanks: automatic
  for (;;) {
    while (i < n && blank(text[i])) ++i;
    const size_t a = i;
    long v = 0;
    while (i < n && text[i] >= '0' && text[i] <= '9') {
      v = v * 10 + (text[i] - '0');
      if (v > 100000) throw KonfigFehler("key 'hall_cpus': CPU number too large in \"" + text + "\"");
      ++i;
    }
    if (i == a) throw KonfigFehler("key 'hall_cpus' must be a list of CPU numbers, e.g. \"1,2,3\" (read: \"" + text + "\")");
    if (std::find(ids.begin(), ids.end(), static_cast<int>(v)) != ids.end())
      throw KonfigFehler("key 'hall_cpus': CPU " + std::to_string(v) + " appears twice in the list");
    ids.push_back(static_cast<int>(v));
    while (i < n && blank(text[i])) ++i;
    if (i == n) break;
    if (text[i] == '-') throw KonfigFehler("key 'hall_cpus': ranges like \"1-3\" are not supported, only a comma list like \"1,2,3\" (read: \"" + text + "\")");
    if (text[i] != ',') throw KonfigFehler("key 'hall_cpus' must be a list of CPU numbers, e.g. \"1,2,3\" (read: \"" + text + "\")");
    ++i;
  }
  return ids;
}

namespace {
bool lies_zahl_datei(const std::filesystem::path& p, int& v) {
  std::ifstream f(p);
  return static_cast<bool>(f >> v);
}
}  // namespace

std::vector<CpuKern> lies_cpu_topologie(const std::string& wurzel) {
  std::vector<CpuKern> r;
  std::error_code ec;
  for (const auto& e : std::filesystem::directory_iterator(wurzel, ec)) {
    const std::string name = e.path().filename().string();
    if (name.size() < 4 || name.compare(0, 3, "cpu") != 0) continue;
    if (name.find_first_not_of("0123456789", 3) != std::string::npos) continue;   // cpufreq, cpuidle
    int cpu = 0, core = 0, pkg = 0;
    try {
      cpu = std::stoi(name.substr(3));
    } catch (...) {
      continue;
    }
    if (!lies_zahl_datei(e.path() / "topology" / "core_id", core) || !lies_zahl_datei(e.path() / "topology" / "physical_package_id", pkg)) continue;
    r.push_back({cpu, core, pkg});
  }
  std::sort(r.begin(), r.end(), [](const CpuKern& a, const CpuKern& b) { return a.cpu < b.cpu; });
  return r;
}

HallCpuWahl waehle_hall_cpus(const std::vector<CpuKern>& topologie, int faeden, const std::vector<int>* erlaubt) {
  HallCpuWahl w;
  w.gewollt = faeden < 0 ? 0 : faeden;
  if (w.gewollt == 0) return w;
  if (topologie.empty()) {
    w.unbekannt = true;
    w.meldung = "CPU topology not readable, the workers stay without a fixed CPU";
    return w;
  }
  const auto darf = [&](int cpu) { return !erlaubt || std::find(erlaubt->begin(), erlaubt->end(), cpu) != erlaubt->end(); };
  std::map<std::pair<int, int>, std::vector<int>> kerne;   // (package, core_id) -> allowed cpus of the core, ascending
  for (const CpuKern& c : topologie)
    if (darf(c.cpu)) kerne[std::make_pair(c.package, c.core_id)].push_back(c.cpu);
  std::vector<std::vector<int>> gruppen;
  for (auto& kv : kerne) {
    std::sort(kv.second.begin(), kv.second.end());
    gruppen.push_back(kv.second);
  }
  std::sort(gruppen.begin(), gruppen.end(), [](const std::vector<int>& a, const std::vector<int>& b) { return a[0] < b[0]; });
  if (!gruppen.empty()) w.reserviert = gruppen[0];
  for (size_t i = 1; i < gruppen.size() && static_cast<int>(w.cpus.size()) < w.gewollt; ++i) w.cpus.push_back(gruppen[i][0]);
  if (static_cast<int>(w.cpus.size()) < w.gewollt)
    w.meldung = "fewer free physical cores than hall_faeden: " + std::to_string(w.cpus.size()) + " instead of " + std::to_string(w.gewollt) + " (" +
                std::to_string(gruppen.size()) + (erlaubt ? " cores in the allowed CPU mask" : " cores") + ", the first stays with the callback and the rest)";
  return w;
}

std::vector<std::string> hall_cpus_warnungen(const std::vector<int>& ids, const std::vector<CpuKern>& topologie, const std::vector<int>* erlaubt) {
  std::vector<std::string> r;
  if (erlaubt)
    for (int id : ids)
      if (std::find(erlaubt->begin(), erlaubt->end(), id) == erlaubt->end())
        r.push_back("hall_cpus: CPU " + std::to_string(id) + " is outside the kern's allowed CPU mask (CPUAffinity), the worker pins itself beyond it");
  if (!topologie.empty()) {
    const auto kern_von = [&](int cpu, std::pair<int, int>& k) {
      for (const CpuKern& c : topologie)
        if (c.cpu == cpu) { k = {c.package, c.core_id}; return true; }
      return false;
    };
    for (size_t a = 0; a < ids.size(); ++a)
      for (size_t b = a + 1; b < ids.size(); ++b) {
        std::pair<int, int> ka, kb;
        if (kern_von(ids[a], ka) && kern_von(ids[b], kb) && ka == kb)
          r.push_back("hall_cpus: CPU " + std::to_string(ids[a]) + " and " + std::to_string(ids[b]) + " are SMT siblings (one physical core), the workers share its compute time");
      }
  }
  return r;
}

}  // namespace cdj
