// kern.toml nach INTERFACES.md §2.1 (Scheibe 08). Unbekannter Schlüssel, falscher Typ, fehlende oder falsche
// `version` und Werte außerhalb ihres Bereichs sind ein Startfehler, der den Schlüssel nennt. Die Schlüsselliste ist
// dieselbe wie djk/vertrag/konfig.schema.json $defs["kern.toml"] (Test test_konfig_schema).
// Prüfinstanzen (ROADMAP Z2): Pfad ~/.config/cypherdj-<i>/kern.toml, udp_port + 1000·k, "/cypherdj/" -> "/cypherdj-<i>/".
#pragma once

#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace cdj {

struct KernKonfig {
  double start_bpm = 128.0;
  int udp_port = 47100;
  std::string arbeitsbestand = "/dev/shm/cypherdj/material";
  int speicher_budget_mib = 3800;
  std::string controller_geraet = "";
  double ziel_lufs = -16.0;
  double hoerbar_db = -26.0;
  double tief_offen_db = -12.0;
  int max_stretcher = 4;
  int stretcher_threads = 2;
  double limiter_dbtp = -1.0;
  bool pruefmodus = false;
  bool hand_osc = false;  // Scheibe 35, B-O Weg 1: /test/hand auch ohne Prüfmodus (Oberfläche 60m)
  double filter_guete = 0.707;  // Scheibe 25: Güte des DJ-Filters, 0,5 bis 4 (A27 Weg a, Nachtrag 04)
  bool hoerschein_pflicht = true;  // Ohr T13: schaltet PrueferI3 (I3a, §17) an
  // Keylock Task 2.5 (Plan 2026-10-06-keylock-echtzeit.md, Vertrag 17): Vorgabe 1 im Betrieb (Kern::keylock_nach_konfig,
  // dann keylock_bauen mit Fäden). Task 3: kern.toml-Schlüssel `keylock` (§2.1); false -> Kern ohne Dehner, der Regler
  // keylock wirkt dann nur auf die Loop-Boxen.
  bool keylock = true;
  // Umbauplan Bungee S2: die Maschine des Keylocks. "r3" (Vorgabe, Rubber Band in Fäden), "bungee" (Bungee synchron im Callback,
  // Korn 512) oder "bungee_fein" (Korn 256). Bungee nur in einem Kern, der mit CYPHERDJ_BUNGEE gebaut ist; sonst Keylock aus.
  std::string keylock_maschine = "r3";
  // D1 K1 (Spec 2.1, 2.9): Arbeitsordner der Wiedergaben je Instanz ("" = ~/.cache/cypherdj[-<i>]/arr) und Teilbetrag
  // des gesperrten Speichers für Arrangement-Audio (zählt zugleich gegen speicher_budget_mib)
  std::string arr_ordner = "";
  int arr_budget_mib = 1024;
  // 1.13 Slice 2 (ADR 031 Teil 2): Arbeitsfäden des Warp-Werks (COMPLEX, TONES), 1 bis 8; sie laufen unter den Keylock-Fäden (JACK − 6)
  int warp_faeden = 4;
  // Baukasten S3b: Arbeitsfäden der Baukasten-Graphen (ein Block Vorlauf), 0 bis 8; 0 rechnet im Callback. SCHED_FIFO JACK − 7
  int graph_faeden = 2;
  // 1.15 A1b (mix tools): the channel limiter on bus/1..4 is built once and cannot change afterwards (vorhalt and true peak set the
  // latency). D8: 0 (default) = the four limiters are not built, latency 0, the lim/* rows exist but do nothing (the "not built" behaviour
  // itself is A5b: setze_kanal_limiter); 0.1 to 20 builds them with this lookahead. True peak off = sample peaks, on adds 12 samples.
  double kanal_limiter_vorhalt_ms = 0.0;
  bool kanal_limiter_echtspitze = false;
  // Multi-core work: the Hall pool (hall_pool.h): 0 to 3 worker threads for the Halls of the arrangement's return strips (0 = no pool, the callback computes
  // all Halls itself), pinned to the CPUs of hall_cpus (comma separated CPU ids; fewer ids than workers start as many workers as ids and say so; ids outside the unit's CPU mask or SMT siblings give a warning) or, when empty, to distinct physical cores
  // chosen by waehle_hall_cpus inside the CPU mask the process may use, and the JACK thread is pinned to the reserved core. Fewer free cores than workers asked for gives
  // fewer workers and a line at start.
  int hall_faeden = 3;
  std::string hall_cpus = "";
  // Voice channel (stimme.h): input pair ein_<k> summed into the master in front of the limiter, music ducked while it
  // speaks. 0 (default) = off, the master is bit-identical to a kern without it.
  int stimme_eingang = 0;
  double stimme_duck_db = -12.0;
  double stimme_pegel_db = 0.0;
};

// Schlüssel mit TOML-Typ, wie §2.1 sie schreibt: "version", dann je Schlüssel "float", "int", "str", "Pfad", "bool"
struct KonfigSchluessel {
  const char* name;
  const char* typ;
};
extern const KonfigSchluessel KERN_SCHLUESSEL[30];

class KonfigFehler : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

// Reads TOML text; `quelle` appears in error messages. Throws KonfigFehler. `anzahl_cpus` < 0: hall_cpus is checked against the CPUs of this machine
// (/sys/devices/system/cpu/cpu<N> exists and is online), else against 0 to anzahl_cpus - 1 (tests). Only with hall_faeden > 0: with 0 (no pool) the key
// is unused, so only its syntax is checked and a warning goes to stderr. A hall_cpus of only blanks is empty (automatic), like "".
KernKonfig lies_kern_toml_text(std::string_view text, const std::string& quelle, int anzahl_cpus = -1);
// Liest eine Datei; fehlt sie, wirft sie KonfigFehler.
KernKonfig lies_kern_toml(const std::string& pfad);
// Standardpfad ~/.config/cypherdj[-<instanz>]/kern.toml (instanz "" oder a bis i, aus instanz.h)
std::string standard_konfig_pfad(const char* instanz);
// Wendet Z2 an: udp_port + 1000·k, "/cypherdj/" in arbeitsbestand und arr_ordner -> "/cypherdj-<instanz>/".
void wende_instanz_an(KernKonfig& k, const char* instanz);
// D1 K1: wirksamer Arbeitsordner der Wiedergaben: arr_ordner, sonst $HOME/.cache/cypherdj[-<instanz>]/arr
std::string arr_ordner_von(const KernKonfig& k, const char* instanz);


// hall_cpus "1,2,3" -> {1, 2, 3}. Blanks around the ids are allowed, "" gives an empty list. Anything else (not a non-negative decimal number, a range like
// "1-3", an empty element, a duplicate) throws KonfigFehler naming 'hall_cpus'.
std::vector<int> hall_cpus_liste(const std::string& text);

// One logical CPU with the physical core it belongs to: CPUs with the same (package, core_id) are SMT siblings.
struct CpuKern {
  int cpu;
  int core_id;
  int package;
};
// Reads cpu<N>/topology/core_id and physical_package_id below `wurzel`, sorted by cpu; a CPU without readable files is left out. An unreadable tree gives {}.
std::vector<CpuKern> lies_cpu_topologie(const std::string& wurzel = "/sys/devices/system/cpu");

struct HallCpuWahl {
  std::vector<int> cpus;       // one CPU per worker, ascending; fewer than `gewollt` when there are not enough free physical cores
  std::vector<int> reserviert; // the CPUs (allowed siblings) of the core kept for the callback and the rest; the JACK thread is pinned to them
  int gewollt = 0;
  bool unbekannt = false;      // the topology was empty (unreadable): no choice made, cpus empty; the caller starts the workers unpinned
  std::string meldung;         // "" when everything asked for was found, else one line for the start log
};
// Automatic CPU choice for the Hall workers (pure function). `erlaubt` is the CPU mask the process may run on (main: sched_getaffinity), nullptr = all.
// Only allowed CPUs count; a physical core is a group of equal (package, core_id) among them, ordered by its lowest allowed cpu. The first one (normally
// CPU 0 and its sibling) stays with the JACK callback and the rest of the system (HallCpuWahl::reserviert). Each further core takes one worker on its
// lowest allowed cpu, so no worker has an SMT sibling that is another worker. `faeden` <= 0 gives an empty choice. An empty (not null) mask allows nothing.
HallCpuWahl waehle_hall_cpus(const std::vector<CpuKern>& topologie, int faeden, const std::vector<int>* erlaubt = nullptr);

// Warnings (never errors) for an explicit hall_cpus list: an id outside the allowed mask (the pin would leave the unit's CPUAffinity), two ids that are SMT
// siblings of each other. With an unreadable topology only the mask check can run. One line per finding, empty when all is well.
std::vector<std::string> hall_cpus_warnungen(const std::vector<int>& ids, const std::vector<CpuKern>& topologie, const std::vector<int>* erlaubt);

}  // namespace cdj
