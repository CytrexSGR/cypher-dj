// Scheibe 08: SPSC-Ring. Kapazität, Reihenfolge, und ein Zwei-Faden-Stresstest, der unter ThreadSanitizer
// (Bau mit -DCYPHERDJ_TSAN=ON, Start mit setarch -R) keinen Datenwettlauf melden darf. Gegen die Mutation
// CYPHERDJ_MUTATION_RING_RELAXED meldet ThreadSanitizer einen Wettlauf (Fehlerfall, Task 2).
#include <cstdint>
#include <thread>

#include "cypherdj/spsc_ring.h"
#include "pruef.h"

struct Satz {
  uint64_t nr;
  uint64_t pruef;  // nr * 2654435761, erkennt zerrissene Sätze
};

static cdj::SpscRing<Satz, 1024> g_ring;

int main() {
  // Kapazität: genau N passen hinein, der N+1-te nicht (voll wird gemeldet, nicht überschrieben)
  static cdj::SpscRing<int, 8> klein;
  int geschrieben = 0;
  for (int i = 0; i < 10; ++i) geschrieben += klein.schiebe(i) ? 1 : 0;
  PRUEF(geschrieben == 8);
  PRUEF(klein.belegt() == 8);
  int v = -1, erwartet = 0;
  bool reihenfolge = true;
  while (klein.hole(v)) reihenfolge &= (v == erwartet++);
  PRUEF(reihenfolge);
  PRUEF(erwartet == 8);
  PRUEF(!klein.hole(v));  // Negativ-Kontrolle: leer liefert nichts

  // Stresstest: 5 Millionen Sätze über zwei Fäden, keiner verloren, keiner doppelt, keiner zerrissen
  constexpr uint64_t N = 5'000'000;
  std::thread schreiber([] {
    for (uint64_t i = 0; i < N;) {
      if (g_ring.schiebe(Satz{i, i * 2654435761ULL})) ++i;
    }
  });
  uint64_t naechster = 0, zerrissen = 0, falsch = 0;
  Satz s{};
  while (naechster < N) {
    if (!g_ring.hole(s)) continue;
    if (s.pruef != s.nr * 2654435761ULL) ++zerrissen;
    if (s.nr != naechster) ++falsch;
    ++naechster;
  }
  schreiber.join();
  PRUEF(zerrissen == 0);
  PRUEF(falsch == 0);
  PRUEF(g_ring.belegt() == 0);
  PRUEF_ENDE();
}
