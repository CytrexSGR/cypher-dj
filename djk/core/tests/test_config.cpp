// Scheibe 08: kern.toml nach §2.1. Die ausgelieferte djk/config/kern.toml liest ohne Fehler mit den Vorgaben aus §2.1
// (Negativ-Kontrolle); ein unbekannter Schlüssel ist ein Startfehler, der den Schlüssel nennt (Fehlerfall).
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include <unistd.h>

#include "cypherdj/config.h"
#include "check.h"

static std::string fehlertext(const std::string& toml) {
  try {
    cdj::lies_kern_toml_text(toml, "test.toml");
  } catch (const cdj::KonfigFehler& e) {
    return e.what();
  }
  return "";
}

static std::string fehlertext_cpus(const std::string& zeile) {   // 16 CPUs
  try {
    cdj::lies_kern_toml_text("version = 1\n" + zeile, "test.toml", 16);
  } catch (const cdj::KonfigFehler& e) {
    return e.what();
  }
  return "";
}

int main() {
  // Negativ-Kontrolle: die ausgelieferte Datei liest sauber, Werte wie §2.1
  const cdj::KernKonfig k = cdj::lies_kern_toml(std::string(CYPHERDJ_DJK) + "/config/kern.toml");
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
  PRUEF(k.spur_pool == "an");                                // mehrkern slice 3.2: the track phases are on by default, in the shipped file too
  PRUEF(k.hall_faeden == 3 && k.hall_cpus.empty());          // multi-core work: default 3 Hall pool workers, CPUs automatic
  PRUEF(k.kanal_limiter_vorhalt_ms == 0.0);                  // 1.15 A1b, D8: default 0 = the four channel limiters are not built
  PRUEF(k.kanal_limiter_echtspitze == false);                // 1.15 A1b: sample peaks unless true peak is asked for

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
  // 1.15 A1b (h): kanal_limiter_vorhalt_ms is 0 or 0.1 to 20 ms (the library clamps to 0.1 ... 20), kanal_limiter_echtspitze is a bool
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkanal_limiter_vorhalt_ms = 0\n", "t").kanal_limiter_vorhalt_ms == 0.0);
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkanal_limiter_vorhalt_ms = 0.1\n", "t").kanal_limiter_vorhalt_ms == 0.1);
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkanal_limiter_vorhalt_ms = 20\n", "t").kanal_limiter_vorhalt_ms == 20.0);
  for (const char* z : {"kanal_limiter_vorhalt_ms = 0.05\n", "kanal_limiter_vorhalt_ms = 25\n", "kanal_limiter_vorhalt_ms = -1\n",
                        "kanal_limiter_vorhalt_ms = nan\n", "kanal_limiter_vorhalt_ms = 20.5\n"})
    PRUEF(fehlertext(std::string("version = 1\n") + z).find("kanal_limiter_vorhalt_ms") != std::string::npos);
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkanal_limiter_echtspitze = true\n", "t").kanal_limiter_echtspitze == true);
  PRUEF(cdj::lies_kern_toml_text("version = 1\nkanal_limiter_echtspitze = false\n", "t").kanal_limiter_echtspitze == false);
  for (const char* z : {"kanal_limiter_echtspitze = 1\n", "kanal_limiter_echtspitze = \"ja\"\n"})
    PRUEF(fehlertext(std::string("version = 1\n") + z).find("kanal_limiter_echtspitze") != std::string::npos);
  // Baukasten S3b: graph_faeden 0 (synchron im Callback) bis 8
  PRUEF(cdj::lies_kern_toml_text("version = 1\ngraph_faeden = 0\n", "t").graph_faeden == 0);
  PRUEF(cdj::lies_kern_toml_text("version = 1\ngraph_faeden = 8\n", "t").graph_faeden == 8);
  PRUEF(fehlertext("version = 1\ngraph_faeden = -1\n").find("graph_faeden") != std::string::npos);
  PRUEF(fehlertext("version = 1\ngraph_faeden = 9\n").find("graph_faeden") != std::string::npos);

  // mehrkern slice 3.2 task 7: spur_pool = aus | an | auto (text, default an); any other text is an error that names the key and the three values
  PRUEF(cdj::lies_kern_toml_text("version = 1\n", "t").spur_pool == "an");
  for (const char* m : {"aus", "an", "auto"})
    PRUEF(cdj::lies_kern_toml_text(std::string("version = 1\nspur_pool = \"") + m + "\"\n", "t").spur_pool == m);
  for (const char* schlecht : {"spur_pool = \"ein\"\n", "spur_pool = \"\"\n", "spur_pool = \"AN\"\n", "spur_pool = \"an \"\n", "spur_pool = 1\n", "spur_pool = true\n"}) {
    const std::string f = fehlertext(std::string("version = 1\n") + schlecht);
    PRUEF(f.find("spur_pool") != std::string::npos);
    if (schlecht[12] == '"') PRUEF(f.find("aus") != std::string::npos && f.find("an") != std::string::npos && f.find("auto") != std::string::npos);
  }
  // mehrkern Task 5: hall_faeden 0..3 and hall_cpus (comma separated CPU ids, "" = automatic). A file without the keys loads with the defaults.
  PRUEF(cdj::lies_kern_toml_text("version = 1\n", "t").hall_faeden == 3);
  PRUEF(cdj::lies_kern_toml_text("version = 1\n", "t").hall_cpus.empty());
  for (int n = 0; n <= 3; ++n)
    PRUEF(cdj::lies_kern_toml_text("version = 1\nhall_faeden = " + std::to_string(n) + "\n", "t").hall_faeden == n);
  PRUEF(fehlertext("version = 1\nhall_faeden = -1\n").find("hall_faeden") != std::string::npos);
  PRUEF(fehlertext("version = 1\nhall_faeden = 4\n").find("hall_faeden") != std::string::npos);
  PRUEF(fehlertext("version = 1\nhall_faeden = \"drei\"\n").find("hall_faeden") != std::string::npos);
  {  // hall_cpus with 16 CPUs (the machine of the plan): valid lists, then every kind of invalid text (all name the key)
    const auto lies = [](const std::string& z) { return cdj::lies_kern_toml_text("version = 1\n" + z, "t", 16); };
    PRUEF(lies("hall_cpus = \"11,12,13\"\n").hall_cpus == "11,12,13");
    PRUEF(lies("hall_cpus = \" 11 , 12,13 \"\n").hall_cpus == " 11 , 12,13 ");
    PRUEF(lies("hall_cpus = \"\"\n").hall_cpus.empty());
    PRUEF(lies("hall_faeden = 1\nhall_cpus = \"5,6,7\"\n").hall_faeden == 1);   // more ids than workers is fine
    PRUEF(lies("hall_cpus = \"4,5\"\n").hall_cpus == "4,5");   // fewer ids than workers is no error: main starts as many workers as ids and says so
    PRUEF(lies("hall_faeden = 0\nhall_cpus = \"\"\n").hall_faeden == 0);
    // hall_faeden = 0: the key is unused, so a CPU this machine lacks is no error (a warning goes to stderr); the syntax is still checked
    PRUEF(cdj::lies_kern_toml_text("version = 1\nhall_faeden = 0\nhall_cpus = \"11,12,13\"\n", "t", 4).hall_faeden == 0);
    PRUEF(cdj::lies_kern_toml_text("version = 1\nhall_faeden = 0\nhall_cpus = \"99\"\n", "t").hall_cpus == "99");   // machine check: CPU 99 absent
    PRUEF(fehlertext_cpus("hall_faeden = 0\nhall_cpus = \"a,b\"\n").find("hall_cpus") != std::string::npos);
    PRUEF(fehlertext_cpus("hall_faeden = 0\nhall_cpus = \"4,5,4\"\n").find("twice") != std::string::npos);
    {   // with a pool the same file is still an error
      bool abgelehnt = false;
      try { cdj::lies_kern_toml_text("version = 1\nhall_faeden = 1\nhall_cpus = \"11\"\n", "t", 4); } catch (const cdj::KonfigFehler&) { abgelehnt = true; }
      PRUEF(abgelehnt);
    }
    const std::vector<int> erw{11, 12, 13};
    PRUEF(cdj::hall_cpus_liste("11,12,13") == erw);
    PRUEF(cdj::hall_cpus_liste(" 11 , 12,13 ") == erw);
    PRUEF(cdj::hall_cpus_liste("").empty());
    PRUEF(cdj::hall_cpus_liste("   ").empty());      // only blanks = automatic like "": main.cpp decides on this list, not on the raw text
    PRUEF(cdj::hall_cpus_liste(" \t ").empty());
    PRUEF(lies("hall_cpus = \"  \"\n").hall_cpus == "  ");   // loads (no id to check on the machine)
    for (const char* z : {"hall_cpus = \"a,b\"\n", "hall_cpus = \"1,\"\n", "hall_cpus = \",1\"\n", "hall_cpus = \"1,,2\"\n", "hall_cpus = \"-1,2,3\"\n",
                          "hall_cpus = \"1.5,2,3\"\n", "hall_cpus = \"1 2 3\"\n", "hall_cpus = 12\n", "hall_cpus = \"99,1,2\"\n", "hall_cpus = \"16,1,2\"\n",
                          "hall_cpus = \"4,5,4\"\n"})
      PRUEF(fehlertext_cpus(z).find("hall_cpus") != std::string::npos);
    PRUEF(fehlertext_cpus("hall_cpus = \"1-3\"\n").find("ranges") != std::string::npos);   // a range says so, it is not just "not a list"
    PRUEF(fehlertext_cpus("hall_cpus = \"1-3\"\n").find("not supported") != std::string::npos);
    // control: the same text with 16 CPUs is fine, with 12 CPUs the ids 12 and 13 do not exist
    PRUEF(cdj::lies_kern_toml_text("version = 1\nhall_cpus = \"11,12,13\"\n", "t", 16).hall_faeden == 3);
    bool abgelehnt = false;
    try { cdj::lies_kern_toml_text("version = 1\nhall_cpus = \"11,12,13\"\n", "t", 12); } catch (const cdj::KonfigFehler&) { abgelehnt = true; }
    PRUEF(abgelehnt);
  }

  // mehrkern Task 5: CPU choice as a pure function. Invented topology 8 cores / 16 threads like the plan's machine (Ryzen 7 7800X3D): cpu i and i + 8 share core i.
  {
    std::vector<cdj::CpuKern> t16;
    for (int c = 0; c < 16; ++c) t16.push_back({c, c % 8, 0});
    const cdj::HallCpuWahl w = cdj::waehle_hall_cpus(t16, 3);
    const std::vector<int> erw{1, 2, 3};
    PRUEF(w.cpus == erw);                                  // core 0 (cpu 0 and 8) stays with the callback, one thread per further core
    PRUEF(w.gewollt == 3 && w.meldung.empty() && !w.unbekannt);
    for (int a : w.cpus) for (int b : w.cpus) PRUEF(a == b || a % 8 != b % 8);   // no SMT sibling of another worker
    for (int a : w.cpus) PRUEF(a % 8 != 0);                // none on the reserved core
    PRUEF(cdj::waehle_hall_cpus(t16, 1).cpus.size() == 1);
    PRUEF(cdj::waehle_hall_cpus(t16, 0).cpus.empty());
    PRUEF(cdj::waehle_hall_cpus(t16, 7).cpus.size() == 7);          // 8 cores minus the reserved one
    const cdj::HallCpuWahl w8 = cdj::waehle_hall_cpus(t16, 9);       // more than there are: fewer workers and a line that says so
    PRUEF(w8.cpus.size() == 7 && w8.gewollt == 9 && !w8.meldung.empty());
    // siblings in another order (cpu 0 and 1 share core 0, as on many Intel machines) and a second package with the same core ids
    std::vector<cdj::CpuKern> t2p;
    for (int c = 0; c < 8; ++c) t2p.push_back({c, (c / 2) % 2, c / 4});   // package 0: cpu 0..3 (cores 0,0,1,1), package 1: cpu 4..7 (cores 0,0,1,1)
    const cdj::HallCpuWahl wp = cdj::waehle_hall_cpus(t2p, 3);
    const std::vector<int> erwp{2, 4, 6};                   // physical cores are (package, core_id): four of them, the one with cpu 0 is reserved
    PRUEF(wp.cpus == erwp);
    PRUEF(wp.gewollt == 3 && wp.meldung.empty());
    // two cores / four threads: fewer workers than asked
    std::vector<cdj::CpuKern> t2;
    for (int c = 0; c < 4; ++c) t2.push_back({c, c % 2, 0});
    const cdj::HallCpuWahl w2 = cdj::waehle_hall_cpus(t2, 3);
    PRUEF(w2.cpus.size() == 1 && w2.cpus[0] == 1 && w2.gewollt == 3 && !w2.unbekannt);
    PRUEF(w2.meldung.find("1") != std::string::npos && w2.meldung.find("3") != std::string::npos);
    // one core only: no worker at all; unreadable topology (empty): flagged, the caller decides
    std::vector<cdj::CpuKern> t1{{0, 0, 0}, {1, 0, 0}};
    PRUEF(cdj::waehle_hall_cpus(t1, 3).cpus.empty() && !cdj::waehle_hall_cpus(t1, 3).unbekannt);
    PRUEF(cdj::waehle_hall_cpus({}, 3).cpus.empty() && cdj::waehle_hall_cpus({}, 3).unbekannt);
    // mehrkern fix round: the allowed CPU mask (the unit's CPUAffinity). Only allowed CPUs count; the lowest allowed physical core stays reserved.
    {
      const std::vector<int> m4{0, 1, 2, 3, 8, 9, 10, 11};   // the production mask: four physical cores with their siblings
      const cdj::HallCpuWahl a = cdj::waehle_hall_cpus(t16, 3, &m4);
      const std::vector<int> e123{1, 2, 3};
      const std::vector<int> r08{0, 8};
      PRUEF(a.cpus == e123 && a.reserviert == r08 && a.meldung.empty());
      const std::vector<int> m2{0, 1, 8, 9};                  // the old two-core mask: exactly one worker and the line
      const cdj::HallCpuWahl b = cdj::waehle_hall_cpus(t16, 3, &m2);
      const std::vector<int> e1{1};
      PRUEF(b.cpus == e1 && b.reserviert == r08 && b.gewollt == 3);
      PRUEF(b.meldung.find("fewer free physical cores than hall_faeden") != std::string::npos && b.meldung.find("1 instead of 3") != std::string::npos);
      std::printf("Line (mask 0,1,8,9): Hall pool: %s\n", b.meldung.c_str());
      const std::vector<int> mt{0, 1, 2, 9};                   // partial mask: core 1 is in the mask with its sibling 9 only, cores 2 with 2 only
      const cdj::HallCpuWahl c = cdj::waehle_hall_cpus(t16, 3, &mt);
      const std::vector<int> e12{1, 2};
      const std::vector<int> r0{0};
      PRUEF(c.cpus == e12 && c.reserviert == r0);
      const std::vector<int> mo{4, 5, 12};                     // the lowest allowed core is reserved, whichever it is
      const cdj::HallCpuWahl d = cdj::waehle_hall_cpus(t16, 3, &mo);
      const std::vector<int> e5{5};
      const std::vector<int> r4{4, 12};
      PRUEF(d.cpus == e5 && d.reserviert == r4);
      const std::vector<int> mleer;                            // an empty mask allows nothing: no worker, no reserved core, a line
      const cdj::HallCpuWahl e = cdj::waehle_hall_cpus(t16, 3, &mleer);
      PRUEF(e.cpus.empty() && e.reserviert.empty() && !e.meldung.empty() && !e.unbekannt);
      const std::vector<int> mfremd{40, 41};                   // CPUs the topology does not know: same
      PRUEF(cdj::waehle_hall_cpus(t16, 3, &mfremd).cpus.empty());
      PRUEF(cdj::waehle_hall_cpus(t16, 3, nullptr).cpus == e123);   // no mask: as before
      PRUEF(cdj::waehle_hall_cpus(t16, 0, &m4).cpus.empty());
      // warnings for an explicit list
      PRUEF(cdj::hall_cpus_warnungen({1, 2, 3}, t16, &m4).empty());
      const auto w1 = cdj::hall_cpus_warnungen({1, 9, 2}, t16, &m4);      // 1 and 9 are siblings
      PRUEF(w1.size() == 1 && w1[0].find("SMT siblings") != std::string::npos);
      const auto w2 = cdj::hall_cpus_warnungen({4, 12, 13}, t16, &m4);     // all outside the mask, and 4/12 siblings
      PRUEF(w2.size() == 4);
      const auto w3 = cdj::hall_cpus_warnungen({1, 9}, {}, &m4);           // unreadable topology: no sibling check
      PRUEF(w3.empty());
      PRUEF(cdj::hall_cpus_warnungen({7}, t16, nullptr).empty());          // no mask: no mask check
      for (const std::string& z : w1) std::printf("Line (hall_cpus \"1,9,2\"): Hall pool: %s\n", z.c_str());
    }
    // reading a (fake) sysfs tree
    const std::filesystem::path wurzel = std::filesystem::temp_directory_path() / ("cdj_topo_" + std::to_string(getpid()));
    for (int c = 0; c < 4; ++c) {
      const auto d = wurzel / ("cpu" + std::to_string(c)) / "topology";
      std::filesystem::create_directories(d);
      std::ofstream(d / "core_id") << (c % 2) << "\n";
      std::ofstream(d / "physical_package_id") << 0 << "\n";
    }
    std::filesystem::create_directories(wurzel / "cpufreq");   // not a cpuN directory
    std::filesystem::create_directories(wurzel / "cpu9");      // cpu without topology files: skipped
    const std::vector<cdj::CpuKern> gelesen = cdj::lies_cpu_topologie(wurzel.string());
    std::filesystem::remove_all(wurzel);
    PRUEF(gelesen.size() == 4);
    if (gelesen.size() == 4) PRUEF(gelesen[3].cpu == 3 && gelesen[3].core_id == 1 && gelesen[3].package == 0);
    PRUEF(cdj::lies_cpu_topologie("/gibt/es/nicht").empty());
  }
  PRUEF_ENDE();
}
