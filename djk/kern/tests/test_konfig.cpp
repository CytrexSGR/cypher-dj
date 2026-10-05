// Scheibe 08: kern.toml nach §2.1. Die ausgelieferte djk/konfig/kern.toml liest ohne Fehler mit den Vorgaben aus §2.1
// (Negativ-Kontrolle); ein unbekannter Schlüssel ist ein Startfehler, der den Schlüssel nennt (Fehlerfall).
#include <cstdlib>
#include <string>

#include "cypherdj/konfig.h"
#include "pruef.h"

static std::string fehlertext(const std::string& toml) {
  try {
    cdj::lies_kern_toml_text(toml, "test.toml");
  } catch (const cdj::KonfigFehler& e) {
    return e.what();
  }
  return "";
}

int main() {
  // Negativ-Kontrolle: die ausgelieferte Datei liest sauber, Werte wie §2.1
  const cdj::KernKonfig k = cdj::lies_kern_toml(std::string(CYPHERDJ_DJK) + "/konfig/kern.toml");
  PRUEF(k.start_bpm == 128.0);
  PRUEF(k.udp_port == 47100);
  PRUEF(k.arbeitsbestand == "/dev/shm/cypherdj/material");
  PRUEF(k.speicher_budget_mib == 3800);
  PRUEF(k.controller_geraet.empty());
  PRUEF(k.ziel_lufs == -16.0);
  PRUEF(k.hoerbar_db == -26.0 && k.tief_offen_db == -12.0);
  PRUEF(k.max_stretcher == 4 && k.stretcher_threads == 2);
  PRUEF(k.limiter_dbtp == -1.0);
  PRUEF(k.pruefmodus == false);

  // Fehlerfall: Tippfehler im Schlüssel, Meldung nennt Schlüssel und Datei
  const std::string f1 = fehlertext("version = 1\nudp_prot = 47100\n");
  PRUEF(f1.find("unbekannter Schlüssel 'udp_prot'") != std::string::npos);
  PRUEF(f1.find("test.toml") != std::string::npos);
  // Abschnitt statt Schlüssel, falscher Typ, fehlende und falsche Version, Bereich, kaputtes TOML
  PRUEF(fehlertext("version = 1\n[kern]\nstart_bpm = 128.0\n").find("'kern'") != std::string::npos);
  PRUEF(fehlertext("version = 1\nudp_port = \"47100\"\n").find("'udp_port' muss eine ganze Zahl") != std::string::npos);
  PRUEF(fehlertext("start_bpm = 128.0\n").find("'version' fehlt") != std::string::npos);
  PRUEF(fehlertext("version = 2\n").find("'version' muss 1") != std::string::npos);
  PRUEF(fehlertext("version = 1\nspeicher_budget_mib = 4200\n").find("speicher_budget_mib") != std::string::npos);
  PRUEF(fehlertext("version = 1\nstart_bpm = 250.0\n").find("start_bpm") != std::string::npos);
  PRUEF(fehlertext("version = 1\nstart_bpm = = 1\n").find("kein gültiges TOML") != std::string::npos);
  // Negativ-Kontrolle: ganze Zahl für einen float-Schlüssel ist erlaubt, nur version reicht
  PRUEF(fehlertext("version = 1\nstart_bpm = 124\n").empty());
  PRUEF(cdj::lies_kern_toml_text("version = 1\nstart_bpm = 124\n", "t").start_bpm == 124.0);
  PRUEF(fehlertext("version = 1\n").empty());
  // Datei fehlt: Fehler mit Pfad
  bool geworfen = false;
  try {
    cdj::lies_kern_toml("/nicht/da/kern.toml");
  } catch (const cdj::KonfigFehler& e) {
    geworfen = std::string(e.what()).find("/nicht/da/kern.toml") != std::string::npos;
  }
  PRUEF(geworfen);

  // Prüfinstanzen (Z2)
  cdj::KernKonfig ka = k;
  cdj::wende_instanz_an(ka, "a");
  PRUEF(ka.udp_port == 48100);
  PRUEF(ka.arbeitsbestand == "/dev/shm/cypherdj-a/material");
  cdj::KernKonfig k0 = k;
  cdj::wende_instanz_an(k0, "");
  PRUEF(k0.udp_port == 47100);  // Negativ-Kontrolle: ohne Instanz nichts verschoben
  setenv("HOME", "/home/x", 1);
  PRUEF(cdj::standard_konfig_pfad("a") == "/home/x/.config/cypherdj-a/kern.toml");
  PRUEF(cdj::standard_konfig_pfad("") == "/home/x/.config/cypherdj/kern.toml");
  PRUEF_ENDE();
}
