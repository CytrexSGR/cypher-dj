// Lader (lader.h, SCHNITTSTELLEN §4.4, §6.4, §13.2; ADR 015): einblenden, sperren, prüfen, Budget, Rückgabe.
// Material aus tests/deck/klick_fassung.py in einem eigenen Arbeitsbestand unter /dev/shm (tmpfs wie im Betrieb).
// Scheibe 31.
#include <sys/resource.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>

#include <nlohmann/json.hpp>

#include "cypherdj/lader.h"
#include "pruef.h"

namespace fs = std::filesystem;

static const std::string DJK = CYPHERDJ_DJK;
static std::string AB;  // Arbeitsbestand dieses Tests

static void klick(const std::string& args) {
  const std::string cmd = "python3 " + DJK + "/kern/tests/deck/klick_fassung.py --ziel " + AB + " " + args + " > /dev/null";
  PRUEF(std::system(cmd.c_str()) == 0);
}

static long vm_lck_kib() {
  std::ifstream f("/proc/self/status");
  std::string z;
  while (std::getline(f, z))
    if (z.rfind("VmLck:", 0) == 0) return std::atol(z.c_str() + 6);
  return -1;
}

static cdj::LadeAuftrag auftrag(const char* id, int mit_stems = 0, double bpm = 128.0, int fassung = 1) {
  cdj::LadeAuftrag a{};
  a.id = 1;
  std::strcpy(a.quelle, "pruefstand");
  a.deck = 1;
  a.fassung = fassung;
  a.mit_stems = mit_stems;
  a.basis_bpm = bpm;
  std::snprintf(a.material_id, sizeof a.material_id, "%s", id);
  return a;
}

int main() {
  AB = "/dev/shm/test_lader_" + std::to_string(::getpid());
  fs::create_directories(AB);
  klick("--material-id c1c0000000000101 --beats 8 --erster-schlag-frame 1234");
  klick("--material-id c1c0000000000102 --beats 8 --stems");
  klick("--material-id c1c0000000000103 --beats 8 --nan-bei 0");     // Frame 0 liegt in der Stichprobe
  klick("--material-id c1c0000000000104 --beats 8 --nan-bei 1");     // Frame 1 nicht (Grenze der Stichprobe)
  klick("--material-id c1c0000000000105 --beats 8 --falsche-pruefsumme");
  klick("--material-id c1c0000000000106 --beats 8");
  klick("--material-id c1c0000000000107 --beats 8");
  const int64_t bytes = (int64_t)(1234 + 9 * 22500) * 8;  // frames · 8, frames = erster + (beats + 1) · 22500

  cdj::Lader lader(AB, 3800LL << 20);
  // AddressSanitizer fängt mlock ab und sperrt nichts („AddressSanitizer ignores mlock/mlockall/munlock/munlockall“,
  // ASAN_OPTIONS=verbosity=1): im ASan-Bau entfallen die Prüfungen, die VmLck oder die Sperrgrenze messen.
#ifdef __SANITIZE_ADDRESS__
  constexpr bool MLOCK_WIRKT = false;
  std::printf("ASan-Bau: Prüfungen an VmLck und an der Sperrgrenze entfallen (mlock ist dort ohne Wirkung)\n");
#else
  constexpr bool MLOCK_WIRKT = true;
#endif
  cdj::LadeGrund g;
  std::string m;

  // 1) Basis: eingeblendet, gesperrt, Raster: der erste Klick liegt auf erster_schlag_frame (§13.1)
  const long lck0 = vm_lck_kib();
  cdj::Material* a = lader.lade(auftrag("c1c0000000000101"), g, m);
  PRUEF(a && g == cdj::LadeGrund::ok);
  PRUEF(a && a->n_quellen == 1 && a->frames == 1234 + 9 * 22500 && a->erster_schlag_frame == 1234);
  PRUEF(a && a->quelle[0][2 * 1234] == 0.5f && a->quelle[0][2 * 1233] == 0.0f);
  PRUEF(lader.gesperrt() == bytes);
  PRUEF(!MLOCK_WIRKT || vm_lck_kib() - lck0 >= bytes / 1024);  // mlock wirkt (VmLck wächst um die Datei)
  lader.gib_frei(a);
  PRUEF(lader.gesperrt() == 0);
  PRUEF(vm_lck_kib() == lck0);

  // 2) Stems: vier Quellen, nie die Basis (§4.4); falsches mit_stems -> pruefung (beide Richtungen)
  cdj::Material* s = lader.lade(auftrag("c1c0000000000102", 1), g, m);
  PRUEF(s && s->n_quellen == 4 && s->mit_stems == 1 && lader.gesperrt() == 4 * (int64_t)(9 * 22500) * 8);
  lader.gib_frei(s);
  PRUEF(!lader.lade(auftrag("c1c0000000000102", 0), g, m) && g == cdj::LadeGrund::pruefung);
  PRUEF(!lader.lade(auftrag("c1c0000000000101", 1), g, m) && g == cdj::LadeGrund::pruefung);

  // 3) material_fehlt: unbekanntes Material, fehlende Fassung, anderes Basis-Tempo (anderer Ordner)
  PRUEF(!lader.lade(auftrag("f0000000000000ff"), g, m) && g == cdj::LadeGrund::material_fehlt);
  PRUEF(!lader.lade(auftrag("c1c0000000000101", 0, 128.0, 2), g, m) && g == cdj::LadeGrund::material_fehlt);
  PRUEF(!lader.lade(auftrag("c1c0000000000101", 0, 126.0), g, m) && g == cdj::LadeGrund::material_fehlt);

  // 4) Fehlerfall pruefung: NaN in der Stichprobe, falsche Prüfsumme, falsche Größe, Raster deckt frames nicht
  PRUEF(!lader.lade(auftrag("c1c0000000000103"), g, m) && g == cdj::LadeGrund::pruefung);
  PRUEF(m.find("NaN") != std::string::npos);
  PRUEF(!lader.lade(auftrag("c1c0000000000105"), g, m) && g == cdj::LadeGrund::pruefung);
  PRUEF(m.find("sha256") != std::string::npos);
  const std::string o6 = AB + "/c1c0000000000106/fassungen/128000_r1/";
  fs::resize_file(o6 + "basis.f32", fs::file_size(o6 + "basis.f32") - 8);
  PRUEF(!lader.lade(auftrag("c1c0000000000106"), g, m) && g == cdj::LadeGrund::pruefung);
  PRUEF(m.find("Größe") != std::string::npos);
  {
    const std::string p = AB + "/c1c0000000000107/fassungen/128000_r1/fassung.json";
    nlohmann::json j = nlohmann::json::parse(std::ifstream(p));
    j["beats"] = j["beats"].get<double>() * 48000.0 / 44100.0;  // als wäre die Datei mit 44,1 kHz gerechnet
    std::ofstream(p) << j.dump(1);
  }
  PRUEF(!lader.lade(auftrag("c1c0000000000107"), g, m) && g == cdj::LadeGrund::pruefung);
  PRUEF(lader.gesperrt() == 0);  // nach jedem Fehler nichts gesperrt
  // Negativ-Kontrollen: NaN außerhalb der Stichprobe (Frame 1) geht durch; falsche Prüfsumme ohne Prüfung (Neustart)
  cdj::Material* n = lader.lade(auftrag("c1c0000000000104"), g, m);
  PRUEF(n && g == cdj::LadeGrund::ok);
  lader.gib_frei(n);
  cdj::LaderOptionen ohne_summe;
  ohne_summe.pruefsumme = false;
  cdj::Material* f = lader.lade(auftrag("c1c0000000000105"), g, m, ohne_summe);
  PRUEF(f && g == cdj::LadeGrund::ok);
  lader.gib_frei(f);

  // 5) Budget: 3 MiB fassen zwei Basis-Dateien zu 1,6 MiB nicht; nach Freigabe wieder
  cdj::Lader klein(AB, 3LL << 20);
  cdj::Material* k1 = klein.lade(auftrag("c1c0000000000101"), g, m);
  PRUEF(k1 && g == cdj::LadeGrund::ok);
  PRUEF(!klein.lade(auftrag("c1c0000000000104"), g, m) && g == cdj::LadeGrund::budget_speicher);
  klein.gib_frei(k1);
  cdj::Material* k2 = klein.lade(auftrag("c1c0000000000104"), g, m);
  PRUEF(k2 && g == cdj::LadeGrund::ok);
  klein.gib_frei(k2);

  // 6) mlock scheitert an der Sperrgrenze (10 Probe d): weiche Grenze knapp über dem Gesperrten -> budget_speicher
  if (MLOCK_WIRKT) {
  rlimit alt;
  getrlimit(RLIMIT_MEMLOCK, &alt);
  rlimit eng = alt;
  eng.rlim_cur = (rlim_t)(vm_lck_kib() + 512) * 1024;  // 0,5 MiB Luft, die Datei braucht 1,6 MiB
  PRUEF(setrlimit(RLIMIT_MEMLOCK, &eng) == 0);
  PRUEF(!lader.lade(auftrag("c1c0000000000101"), g, m) && g == cdj::LadeGrund::budget_speicher);
  PRUEF(m.find("mlock") != std::string::npos);
  PRUEF(lader.gesperrt() == 0 && vm_lck_kib() <= (long)(eng.rlim_cur / 1024));
  // Negativ-Kontrolle: ohne Sperren lädt es trotz enger Grenze (nur der Fehlerfall M8 schaltet so)
  cdj::LaderOptionen ohne_sperre;
  ohne_sperre.sperren = false;
  cdj::Material* u = lader.lade(auftrag("c1c0000000000101"), g, m, ohne_sperre);
  PRUEF(u && g == cdj::LadeGrund::ok);
  lader.gib_frei(u);
  PRUEF(setrlimit(RLIMIT_MEMLOCK, &alt) == 0);
  }

  // 7) Ringe: Auftrag -> Ergebnis, Rückgabe -> Freigabe (so läuft es im Lade-Faden)
  auto* r = new cdj::LaderRinge();
  PRUEF(r->auftraege.schiebe(auftrag("c1c0000000000101")));
  PRUEF(lader.einmal(*r));
  cdj::LadeErgebnis e{};
  PRUEF(r->ergebnisse.hole(e) && e.material && e.grund == cdj::LadeGrund::ok && e.auftrag.deck == 1);
  PRUEF(lader.gesperrt() == bytes);
  PRUEF(r->rueckgabe.schiebe(e.material));
  PRUEF(lader.einmal(*r));
  PRUEF(lader.gesperrt() == 0);
  PRUEF(!lader.einmal(*r));  // nichts mehr zu tun
  delete r;

  fs::remove_all(AB);
  PRUEF_ENDE();
}
