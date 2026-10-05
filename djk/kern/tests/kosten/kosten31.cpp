// Scheibe 31: Kosten eines Kern-Zyklus ohne JACK (Kern::zyklus, 256 Samples) mit Decks, als Vergleichsmessung zur
// Messung im Callback (tests/deck/ziel_lauf.py --art kosten). Zwei Lagen, je N Zyklen nach 2 000 zum Einschwingen:
//   ohne    kein Deck geladen (Stand 25: Stellwerk, 18 Kanalzüge, Master und Cue)
//   4       vier Decks spielen, Fader −6 dB: Deck 1 mit vier Stems (vier Quellen), Decks 2 bis 4 Basis
// Material aus tests/deck/klick_fassung.py in einem eigenen Arbeitsbestand unter /dev/shm (wird entfernt).
// Ausgabe je Lage: Median, p99, p99,9, Maximum in µs. Kein Test: die Zahlen gehören in den Bericht, unter flock und
// mit Fremdlast (ROADMAP §8.5). Aufruf: kern_kosten31 [zyklen]
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/huellen.h"
#include "cypherdj/kern.h"

static int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

static std::string AB;

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
    // Ohr T3 (Nachmessung): KOSTEN_HUELLEN=1 schließt den Hüllkurven-Ring an; ohne ihn rechnet der Kern keine Bänder
    if (std::getenv("KOSTEN_HUELLEN")) {
      huellen.reset(static_cast<unsigned char*>(std::aligned_alloc(64, CDJ_HUELLEN_BYTES)));
      cdj_huellen_init(reinterpret_cast<cdj_huellen_kopf*>(huellen.get()));
      kern->verbinde_huellen(reinterpret_cast<cdj_huellen_kopf*>(huellen.get()));
    }
  }
  struct Frei { void operator()(unsigned char* p) const { std::free(p); } };
  std::unique_ptr<unsigned char, Frei> huellen;
  void sende(cdj::Befehl b, const char* quelle) {
    b.id = ++id;
    std::snprintf(b.quelle, sizeof b.quelle, "%s", quelle);
    bef->schiebe(b);
  }
  void zyklen(int64_t bis) {
    cdj::Ereignis e;
    while (kern->sample() < bis) {
      kern->zyklus(256, 0);
      lader.einmal(*lr);
      while (ere->hole(e)) {}
    }
  }
};

static void messe(const char* name, bool decks, int n) {
  Lauf l;
  if (decks) {
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
      cdj::Befehl s{};
      s.art = cdj::Befehl::DECK_START;
      s.deck = d;
      s.ab_beat = 8.0;
      s.quell_beat = 0.0;
      l.sende(s, "andreas");
    }
  }
  l.zyklen(2'000 * 256);
  int laufend = 0;
  for (int d = 1; d <= 4; ++d) laufend += l.kern->deck(d).laeuft() ? 1 : 0;
  std::vector<double> t;
  t.reserve((size_t)n);
  cdj::Ereignis e;
  for (int z = 0; z < n; ++z) {
    const int64_t t0 = jetzt_ns();
    l.kern->zyklus(256, 0);
    t.push_back((jetzt_ns() - t0) / 1000.0);
    while (l.ere->hole(e)) {}
  }
  std::sort(t.begin(), t.end());
  auto q = [&](double p) { return t[std::min(t.size() - 1, (size_t)(p * (double)t.size()))]; };
  std::printf("%-6s Decks laufend %d, Zyklen %d: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs\n", name,
              laufend, n, q(0.5), q(0.99), q(0.999), t.back());
}

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20'000;
  AB = "/dev/shm/kern_kosten31_" + std::to_string(::getpid());
  std::filesystem::create_directories(AB);
  const std::string k = std::string("python3 ") + CYPHERDJ_DJK + "/kern/tests/deck/klick_fassung.py --ziel " + AB;
  const int beats = n * 256 / 22500 + 2'000 * 256 / 22500 + 16;
  const std::string b = " --beats " + std::to_string(beats);
  int rc = std::system((k + " --material-id c1c00000000000c1" + b + " --stems > /dev/null").c_str());
  for (const char* m : {"c1c00000000000c2", "c1c00000000000c3", "c1c00000000000c4"})
    rc |= std::system((k + " --material-id " + m + b + " > /dev/null").c_str());
  if (rc != 0) {
    std::fprintf(stderr, "Material nicht erzeugt\n");
    return 2;
  }
  messe("ohne", false, n);
  messe("4", true, n);
  std::filesystem::remove_all(AB);
  return 0;
}
