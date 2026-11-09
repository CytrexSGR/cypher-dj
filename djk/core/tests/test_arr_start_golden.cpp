// 1.8 S4a.1: golden table of Arrangement::start. The count-in is the only change to start(); with the default (no count-in) every start must stay
// byte-identical to the code before the change. 2000 seeded random starts (start beat, quant 0..2, tempo 60..200, sample s, cycle n 64..1024, loop bracket
// on/off, a Warp-Werk clip at the start yes/no) record start_s_ (einsatz_sample), ursprung_ and klammer_vorn_. The table data/arr_start_golden.txt was written
// on the code BEFORE the parameter existed (commit parent of S4a.1); the test compares line by line.
// Usage: test_arr_start_golden [--schreibe <file>] writes the table, without arguments it compares against tests/daten/arr_start_golden.txt.
// Mutation CYPHERDJ_MUTATION_VORZAEHL_IMMER_EINS (one count-in beat also when 0 is passed) turns it red.
#include <cstdio>
#include <cstring>
#include <memory>
#include <random>
#include <string>
#include <vector>

#include "arr_build.h"
#include "check.h"

bool g_waechter = false;

namespace cdj {
struct ArrPruefZugang {
  static double ursprung(const Arrangement& a) { return a.ursprung_; }
  static bool klammer_vorn(const Arrangement& a) { return a.klammer_vorn_; }
};
}  // namespace cdj

namespace {

// A work that does nothing: werk_am_start only asks whether a work is set and whether the snapshot holds a work clip.
struct Stumm final : cdj::WarpWerk {
  cdj::StreckRing ring_{12288};
  int belege() noexcept override { return -1; }
  void ansetzen(int, cdj::WarpAnsatz&) noexcept override {}
  void gib(int) noexcept override {}
  cdj::StreckRing& ring(int) noexcept override { return ring_; }
  int64_t ende_s(int) const noexcept override { return INT64_MAX; }
  void takt(int64_t) noexcept override {}
  int belegt() const noexcept override { return 0; }
  bool liest(const cdj::ArrSnapshot*) const noexcept override { return true; }
  int faeden() const noexcept override { return 0; }
  int prioritaet(int) override { return 0; }
  void stoppe() override {}
  cdj::WarpZaehler zaehler() const noexcept override { return {}; }
  std::string schluss_json() const override { return "{}"; }
  void test_halte(bool) noexcept override {}
  void test_halte_block(bool) noexcept override {}
};

struct Zufall {
  std::mt19937_64 g{20261105};   // the raw generator only: the standard fixes its sequence, the distributions it does not
  double u() { return static_cast<double>(g() >> 11) * (1.0 / 9007199254740992.0); }
  int64_t i(int64_t a, int64_t b) { return a + static_cast<int64_t>(g() % static_cast<uint64_t>(b - a + 1)); }
};

}  // namespace

int main(int argc, char** argv) {
  using namespace arrtest;
  const bool schreibe = argc >= 3 && !std::strcmp(argv[1], "--schreibe");
  auto audio = Audio::gleich(96000 * 4);
  Bau plain(1), werk(2);
  plain.spur(1, cdj::ArrArt::audio).clip(1, "p", 0.0, 64.0, &audio->a);
  werk.spur(1, cdj::ArrArt::audio).clip(1, "w", 0.0, 64.0, &audio->a).warp({0.0, 64.0}, {0.0, 64.0 * 24000.0}, cdj::ARR_WARP_COMPLEX);
  std::unique_ptr<cdj::ArrSnapshot> snap_plain(plain.fertig()), snap_werk(werk.fertig());
  Stumm stumm;
  cypherdj::stellwerk::ReglerTabelle tab;
  Zufall z;
  std::vector<std::string> zeilen;
  for (int j = 0; j < 2000; ++j) {
    const double bpm = 60.0 + 140.0 * z.u();
    const double start_beat = z.u() < 0.5 ? static_cast<double>(z.i(0, 40)) : 40.0 * z.u();
    const int quant = static_cast<int>(z.i(0, 2));
    const int64_t s = z.i(0, 3000000);
    const int n = static_cast<int>(z.i(64, 1024));
    const bool loop = z.u() < 0.5;
    const double loop_von = static_cast<double>(z.i(0, 8)), loop_bis = loop_von + 1.0 + static_cast<double>(z.i(0, 30));
    const bool mit_werk = z.u() < 0.5;
    const int64_t vorhalt = z.i(0, 20000);
    cdj::Karte k(bpm, 0);
    cdj::Arrangement arr(tab, false);
    if (mit_werk) arr.setze_warp_werk(&stumm);
    arr.tausche(mit_werk ? snap_werk.get() : snap_plain.get(), 0, k);
    if (loop) arr.loop(true, loop_von, loop_bis, s, k);
    const bool ok = arr.start(start_beat, quant, false, s, vorhalt, n, k);
    char zeile[160];
    std::snprintf(zeile, sizeof zeile, "%d %d %lld %.17g %d", j, ok ? 1 : 0, static_cast<long long>(arr.einsatz_sample()),
                  cdj::ArrPruefZugang::ursprung(arr), cdj::ArrPruefZugang::klammer_vorn(arr) ? 1 : 0);
    zeilen.push_back(zeile);
  }
  const std::string pfad = schreibe ? argv[2] : std::string(CYPHERDJ_DJK) + "/core/tests/data/arr_start_golden.txt";
  if (schreibe) {
    std::FILE* f = std::fopen(pfad.c_str(), "w");
    PRUEF(f != nullptr);
    if (!f) return 1;
    for (const std::string& zl : zeilen) std::fprintf(f, "%s\n", zl.c_str());
    std::fclose(f);
    std::printf("Tabelle geschrieben: %zu Zeilen nach %s\n", zeilen.size(), pfad.c_str());
    return 0;
  }
  std::FILE* f = std::fopen(pfad.c_str(), "r");
  PRUEF(f != nullptr);
  if (!f) return 1;
  char puffer[256];
  size_t j = 0, fehl = 0;
  while (std::fgets(puffer, sizeof puffer, f)) {
    std::string soll(puffer);
    while (!soll.empty() && (soll.back() == '\n' || soll.back() == '\r')) soll.pop_back();
    if (j >= zeilen.size() || zeilen[j] != soll) {
      if (fehl++ < 5) std::fprintf(stderr, "Zeile %zu: ist '%s', soll '%s'\n", j, j < zeilen.size() ? zeilen[j].c_str() : "-", soll.c_str());
    }
    ++j;
  }
  std::fclose(f);
  PRUEF(j == 2000 && zeilen.size() == 2000);
  PRUEF(fehl == 0);
  // the table can see something: the 2000 starts are not all alike (counter-check against a frozen table)
  size_t verschieden = 0;
  for (size_t i = 1; i < zeilen.size(); ++i) verschieden += zeilen[i].substr(zeilen[i].find(' ')) != zeilen[i - 1].substr(zeilen[i - 1].find(' '));
  PRUEF(verschieden > 1900);
  std::printf("arr_start_golden: %zu Zeilen, %zu Abweichungen\n", j, fehl);
  PRUEF_ENDE();
}
