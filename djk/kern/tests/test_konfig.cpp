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
  PRUEF(k.arr_ordner.empty() && k.arr_budget_mib == 1024);   // D1 K1: Vorgaben wie §2.1
  PRUEF(k.warp_faeden == 4);                                 // 1.13 Slice 2: Vorgabe 4 Arbeitsfäden
  PRUEF(k.graph_faeden == 2);                                // Baukasten S3b: Vorgabe 2 Fäden des Graph-Werks

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
  // D1 K1: Arbeitsordner der Wiedergaben je Instanz, Teilbetrag höchstens speicher_budget_mib
  PRUEF(cdj::arr_ordner_von(k, "") == "/home/x/.cache/cypherdj/arr");
  PRUEF(cdj::arr_ordner_von(k, "b") == "/home/x/.cache/cypherdj-b/arr");
  cdj::KernKonfig kb = cdj::lies_kern_toml_text("version = 1\narr_ordner = \"/srv/cypherdj/arr\"\narr_budget_mib = 512\n", "t");
  PRUEF(kb.arr_budget_mib == 512 && cdj::arr_ordner_von(kb, "") == "/srv/cypherdj/arr");
  cdj::wende_instanz_an(kb, "b");
  PRUEF(kb.arr_ordner == "/srv/cypherdj-b/arr");
  PRUEF(fehlertext("version = 1\narr_budget_mib = 3900\n").find("arr_budget_mib") != std::string::npos);
  PRUEF(fehlertext("version = 1\narr_budget_mib = 0\n").find("arr_budget_mib") != std::string::npos);
  PRUEF(fehlertext("version = 1\narr_ordner = \"relativ/arr\"\n").find("arr_ordner") != std::string::npos);
  // D1 Spec 6.14: arr_ordner normalisiert (abschließender Schrägstrich, //, ./ und ..), auch nach Z2
  cdj::KernKonfig kn = cdj::lies_kern_toml_text("version = 1\narr_ordner = \"/srv//cypherdj/./x/../arr/\"\n", "t");
  PRUEF(cdj::arr_ordner_von(kn, "") == "/srv/cypherdj/arr");
  cdj::wende_instanz_an(kn, "b");
  PRUEF(cdj::arr_ordner_von(kn, "b") == "/srv/cypherdj-b/arr");
  PRUEF(cdj::arr_ordner_von(cdj::lies_kern_toml_text("version = 1\narr_ordner = \"/srv/arr/\"\n", "t"), "") == "/srv/arr");
  // 1.13 Slice 2: Arbeitsfäden des Warp-Werks, 1 bis 8; Negativ-Kontrolle: 0 und 9 sind ein Startfehler, der den Schlüssel nennt
  PRUEF(cdj::lies_kern_toml_text("version = 1\nwarp_faeden = 8\n", "t").warp_faeden == 8);
  PRUEF(cdj::lies_kern_toml_text("version = 1\nwarp_faeden = 1\n", "t").warp_faeden == 1);
  PRUEF(fehlertext("version = 1\nwarp_faeden = 0\n").find("warp_faeden") != std::string::npos);
  PRUEF(fehlertext("version = 1\nwarp_faeden = 9\n").find("warp_faeden") != std::string::npos);
  PRUEF(fehlertext("version = 1\nwarp_faeden = \"vier\"\n").find("warp_faeden") != std::string::npos);
  // Baukasten S3b: graph_faeden 0 (synchron im Callback) bis 8
  PRUEF(cdj::lies_kern_toml_text("version = 1\ngraph_faeden = 0\n", "t").graph_faeden == 0);
  PRUEF(cdj::lies_kern_toml_text("version = 1\ngraph_faeden = 8\n", "t").graph_faeden == 8);
  PRUEF(fehlertext("version = 1\ngraph_faeden = -1\n").find("graph_faeden") != std::string::npos);
  PRUEF(fehlertext("version = 1\ngraph_faeden = 9\n").find("graph_faeden") != std::string::npos);
  PRUEF_ENDE();
}
