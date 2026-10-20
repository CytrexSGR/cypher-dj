// Hörbares Ziehen: Kosten eines Kern-Zyklus ohne JACK (Kern::zyklus, 256 Samples), Vergleichsmessung wie kosten31.cpp (A10, Teil
// ohne JACK). Je Lage N Zyklen nach 2 000 zum Einschwingen; Deck 1 trägt vier Stems (der teuerste Lesefall), Decks 2 bis 4 Basis:
//   spielen      vier Decks spielen (Bezug)
//   spielen+zug  vier Decks spielen, die Hand zieht Deck 1 (Folgemodus: Deck-Weg und Ziehen werden beide gerechnet)
//   steht        Deck 1 steht, Decks 2 bis 4 spielen (Bezug)
//   steht+zug    Deck 1 steht und wird gezogen (3 spielen)
// Die Hand zieht ein Dreieck (±2,5 Frames je Sample, ±6 Beats), alle 768 Samples eine Meldung wie die Seite (≈ 62,5 Hz).
// Ausgabe je Lage: Median, p99, p99,9, Maximum in µs. Kein Test: die Zahlen gehören in den Bericht. Aufruf: kern_kosten_scrub [zyklen]
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/kern.h"

static int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

static std::string AB;
constexpr double FPB = 22500.0;

struct Lauf {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  cdj_ring_kopf* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::unique_ptr<cdj::Befehlsring> bef{new cdj::Befehlsring()};
  std::unique_ptr<cdj::Ereignisring> ere{new cdj::Ereignisring()};
  std::unique_ptr<cdj::LaderRinge> lr{new cdj::LaderRinge()};
  cdj::Lader lader{AB, 3800LL << 20};
  std::unique_ptr<cdj::Kern> kern;
  int64_t id = 100;
  Lauf() {
    ring->version = CDJ_RING_VERSION;
    ring->rate = CDJ_RING_RATE;
    ring->kanaele = CDJ_RING_KANAELE;
    ring->cap = CDJ_RING_CAP;
    std::memcpy(ring->magic, "CDJB", 4);
    kern.reset(new cdj::Kern(128.0, ring, bef.get(), ere.get()));
    kern->verbinde_lader(lr.get());
  }
  void sende(cdj::Befehl b, const char* quelle) {
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    bef->schiebe(b);
  }
  void scrub(int phase, double delta_beats) {
    cdj::Befehl b{};
    b.art = cdj::Befehl::DECK_SCRUB;
    b.deck = 1;
    b.nr = phase;
    b.wert_beats = delta_beats;
    sende(b, "andreas");
  }
  void zyklus_ohne_messung() {
    cdj::Ereignis e;
    kern->zyklus(256, 0);
    lader.einmal(*lr);
    while (ere->hole(e)) {}
  }
};

// Dreieck der Hand in Beats über die Zyklusnummer z: ±6 Beats bei ±2,5 Frames je Sample
static double handweg(int64_t z) {
  const double ein_weg = 6.0 * FPB / 2.5 / 256.0;   // Zyklen für einen Weg
  const double u = std::fmod((double)z, 2.0 * ein_weg) / ein_weg;
  return 6.0 * (u < 1.0 ? u : 2.0 - u);
}

static void messe(const char* name, bool deck1_spielt, bool zug, int n) {
  Lauf l;
  const char* mid[4] = {"c1c00000000000c1", "c1c00000000000c2", "c1c00000000000c3", "c1c00000000000c4"};
  for (int d = 1; d <= 4; ++d) {
    cdj::Befehl b{};
    b.art = cdj::Befehl::DECK_LADEN;
    b.deck = d;
    std::snprintf(b.material_id, sizeof b.material_id, "%s", mid[d - 1]);
    b.bpm = 128.0;
    b.fassung = 1;
    b.mit_stems = d == 1;
    l.sende(b, "leitstand");
    cdj::Befehl f{};
    f.art = cdj::Befehl::TEIL;
    std::snprintf(f.pfad, sizeof f.pfad, "deck/%d/fader", d);
    f.ab_beat = 4.0;
    f.wert = -6.0f;
    f.politik = 1;
    l.sende(f, "pruefstand");
    if (d == 1 && !deck1_spielt) continue;
    cdj::Befehl s{};
    s.art = cdj::Befehl::DECK_START;
    s.deck = d;
    s.ab_beat = 8.0;
    s.quell_beat = d == 1 ? 8.0 : 0.0;   // Deck 1 mit Luft nach hinten für das Dreieck
    l.sende(s, "andreas");
  }
  int64_t z = 0;
  for (; z < 2'000; ++z) l.zyklus_ohne_messung();
  bool gegriffen = false;
  std::vector<double> t;
  t.reserve((size_t)n);
  cdj::Ereignis e;
  for (int i = 0; i < n; ++i, ++z) {
    if (zug && z % 3 == 0) {
      if (!gegriffen) {
        l.scrub(1, 0.0);
        gegriffen = true;
      }
      l.scrub(2, handweg(z));
    }
    const int64_t t0 = jetzt_ns();
    l.kern->zyklus(256, 0);
    t.push_back((jetzt_ns() - t0) / 1000.0);
    l.lader.einmal(*l.lr);
    while (l.ere->hole(e)) {}
  }
  const bool scrubbt = l.kern->deck(1).scrubbt();
  const double pos = l.kern->deck(1).scrub_lage(), rate = l.kern->deck(1).scrub_rate();
  std::sort(t.begin(), t.end());
  auto q = [&](double p) { return t[std::min(t.size() - 1, (size_t)(p * (double)t.size()))]; };
  std::printf("%-12s Zyklen %d: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs   [Deck 1 scrubbt %d, Lage %.0f, Rate %.3f]\n", name, n,
              q(0.5), q(0.99), q(0.999), t.back(), scrubbt ? 1 : 0, pos, rate);
}

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20'000;
  AB = "/dev/shm/kern_kosten_scrub_" + std::to_string(::getpid());
  std::filesystem::create_directories(AB);
  const std::string k = std::string("python3 ") + CYPHERDJ_DJK + "/kern/tests/deck/klick_fassung.py --ziel " + AB;
  const int beats = n * 256 / 22500 + 2'000 * 256 / 22500 + 40;
  const std::string b = " --beats " + std::to_string(beats);
  int rc = std::system((k + " --material-id c1c00000000000c1" + b + " --stems > /dev/null").c_str());
  for (const char* m : {"c1c00000000000c2", "c1c00000000000c3", "c1c00000000000c4"})
    rc |= std::system((k + " --material-id " + m + b + " > /dev/null").c_str());
  if (rc != 0) {
    std::fprintf(stderr, "Material nicht erzeugt\n");
    return 2;
  }
  messe("spielen", true, false, n);
  messe("spielen+zug", true, true, n);
  messe("steht", false, false, n);
  messe("steht+zug", false, true, n);
  std::filesystem::remove_all(AB);
  return 0;
}
