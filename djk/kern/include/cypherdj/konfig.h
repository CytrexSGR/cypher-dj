// kern.toml nach SCHNITTSTELLEN.md §2.1 (Scheibe 08). Unbekannter Schlüssel, falscher Typ, fehlende oder falsche
// `version` und Werte außerhalb ihres Bereichs sind ein Startfehler, der den Schlüssel nennt. Die Schlüsselliste ist
// dieselbe wie djk/vertrag/konfig.schema.json $defs["kern.toml"] (Test test_konfig_schema).
// Prüfinstanzen (ROADMAP Z2): Pfad ~/.config/cypherdj-<i>/kern.toml, udp_port + 1000·k, "/cypherdj/" -> "/cypherdj-<i>/".
#pragma once

#include <stdexcept>
#include <string>
#include <string_view>

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
};

// Schlüssel mit TOML-Typ, wie §2.1 sie schreibt: "version", dann je Schlüssel "float", "int", "str", "Pfad", "bool"
struct KonfigSchluessel {
  const char* name;
  const char* typ;
};
extern const KonfigSchluessel KERN_SCHLUESSEL[17];

class KonfigFehler : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

// Liest TOML-Text; `quelle` erscheint in Fehlermeldungen. Wirft KonfigFehler.
KernKonfig lies_kern_toml_text(std::string_view text, const std::string& quelle);
// Liest eine Datei; fehlt sie, wirft sie KonfigFehler.
KernKonfig lies_kern_toml(const std::string& pfad);
// Standardpfad ~/.config/cypherdj[-<instanz>]/kern.toml (instanz "" oder a bis i, aus instanz.h)
std::string standard_konfig_pfad(const char* instanz);
// Wendet Z2 an: udp_port + 1000·k, "/cypherdj/" in arbeitsbestand -> "/cypherdj-<instanz>/".
void wende_instanz_an(KernKonfig& k, const char* instanz);

}  // namespace cdj
