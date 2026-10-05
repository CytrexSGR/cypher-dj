// Scheibe 25: Kosten eines Kern-Zyklus ohne JACK (Kern::zyklus, 256 Samples), als Vergleichsmessung zur Messung im
// Callback (tests/ziel/kosten25.sh). Drei Lagen, je 20 000 Zyklen nach 2 000 zum Einschwingen:
//   leer   alle Kanäle auf Vorgabe (Fader −200), kein Klick: nur Stellwerk, 18 Kanalzüge, Master und Cue
//   16     16 belegte Kanäle: Prüfklick in deck/1..4, erz/1..8, pad/1..2, bus/1..2, Fader 0 dB (Busse per Hand)
//   16+    wie 16, dazu je Zyklus eine laufende Rampe an 16 Fadern (Stellwerk rechnet je Sample)
// Ausgabe je Lage: Median, p99, p99,9, Maximum in µs. Kein Test: die Zahlen gehören in den Bericht, unter flock und mit
// Fremdlast (ROADMAP §8.5). Aufruf: kern_kosten25 [zyklen]
#include <time.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "../kern25.h"

static int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

static const char* const QUELLEN[16] = {"deck/1", "deck/2", "deck/3", "deck/4", "erz/1", "erz/2", "erz/3", "erz/4",
                                        "erz/5",  "erz/6",  "erz/7",  "erz/8",  "pad/1", "pad/2", "bus/1", "bus/2"};

static void messe(const char* name, int lage, int n) {
  Kern25 k;
  char pfad[48];
  if (lage >= 1) {
    for (int i = 0; i < 16; ++i) {
      k.klick(100 + i, QUELLEN[i], 1);
      std::snprintf(pfad, sizeof pfad, "%s/fader", QUELLEN[i]);
      if (i < 14) {
        k.teil(200 + i, "leitstand", "k", i, pfad, 1.0, 0.0, 0.0f, 0, 1, "", "");
      } else {  // bus/<n>/fader nur Hand (§1.5): erster Wert Stellung, zweiter wirkt
        k.hand(pfad, 0.99f, 10'000);
        k.hand(pfad, 1.0f, 20'000);
      }
    }
  }
  k.bis(2'000 * 256);
  if (lage == 2) {
    for (int i = 0; i < 16; ++i) {
      std::snprintf(pfad, sizeof pfad, "%s/eq/tief", QUELLEN[i]);
      k.teil(300 + i, "leitstand", "r", i, pfad, 30.0, 1'000.0, -20.0f, 1, 1, "", "");
    }
  }
  std::vector<double> d;
  d.reserve((size_t)n);
  cdj::Ereignis e;
  for (int z = 0; z < n; ++z) {
    const int64_t t0 = jetzt_ns();
    k.kern->zyklus(256, 0);
    d.push_back((jetzt_ns() - t0) / 1000.0);
    while (k.ere->hole(e)) {}
  }
  std::sort(d.begin(), d.end());
  auto q = [&](double p) { return d[std::min(d.size() - 1, (size_t)(p * (double)d.size()))]; };
  std::printf("%-6s Zyklen %d: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs\n", name, n, q(0.5),
              q(0.99), q(0.999), d.back());
}

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20'000;
  messe("leer", 0, n);
  messe("16", 1, n);
  messe("16+", 2, n);
  return 0;
}
