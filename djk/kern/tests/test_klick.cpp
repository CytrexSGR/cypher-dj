// Prüfklick offline: jeder Einsatz liegt auf llround(sample_at(b)), bei konstantem Tempo und in einer Rampe,
// bei Quantum 256 und 128; Schlag 1 lauter; "an" wirkt ab dem nächsten Schlag, "aus" beendet.
// Derselbe Test mit -DCYPHERDJ_MUTATION_KLICK_BLOCKANFANG muss scheitern (CTest WILL_FAIL).
#include <cmath>
#include <cstdint>
#include <vector>

#include "cypherdj/klick.h"
#include "pruef.h"

// Rendert n_bloecke Blöcke der Größe N ab Sample 0 und gibt den linken Kanal zurück; an ab Block an_ab.
static std::vector<float> rendern(const cdj::Karte& k, int N, int n_bloecke, int an_ab, int aus_ab,
                                  std::vector<cdj::KlickEinsatz>& gemeldet) {
  cdj::Klick klick;
  std::vector<float> L((size_t)N * n_bloecke, 0.0f), R((size_t)N * n_bloecke, 0.0f);
  cdj::KlickEinsatz e[8];
  for (int b = 0; b < n_bloecke; ++b) {
    if (b == an_ab) klick.an();
    if (b == aus_ab) klick.aus();
    const int n = klick.block(k, (int64_t)b * N, N, &L[(size_t)b * N], &R[(size_t)b * N], e, 8);
    for (int i = 0; i < n; ++i) gemeldet.push_back(e[i]);
  }
  for (size_t i = 0; i < L.size(); ++i) PRUEF(L[i] == R[i]);
  return L;
}

// Prüft, dass jeder ganze Beat im Bereich genau am Soll-Sample mit dem richtigen Pegel einsetzt.
static void pruefe_einsaetze(const cdj::Karte& k, const std::vector<float>& L, double b_von, double b_bis) {
  for (double b = b_von; b <= b_bis; b += 1.0) {
    const int64_t s = std::llround(k.sample_at(b));
    if (s + cdj::KLICK_LAENGE >= (int64_t)L.size()) break;
    const float soll = (cdj::schlag_im_takt(b) == 1) ? cdj::KLICK_PEGEL_EINS : cdj::KLICK_PEGEL;
    PRUEF(L[(size_t)s] == soll);            // Einsatz: erster Wert der Klickform ist 1,0
    if (s > 0) PRUEF(L[(size_t)s - 1] == 0.0f);  // davor Stille
  }
}

int main() {
  // 1) konstant 128, Quantum 256, 101 Schläge ab Beat 0
  {
    cdj::Karte k(128.0, 0);
    std::vector<cdj::KlickEinsatz> g;
    const int N = 256, bloecke = (int)(101 * 22500 / N) + 2;
    auto L = rendern(k, N, bloecke, 0, -1, g);
    pruefe_einsaetze(k, L, 0.0, 100.0);
    PRUEF(g.size() >= 101);
    for (size_t i = 0; i < g.size(); ++i) {
      PRUEF(g[i].beat == (double)i);
      PRUEF(g[i].sample == (int64_t)i * 22500);
    }
  }
  // 2) Quantum 128 und eine Rampe 128 -> 132 ab Beat 16 über 32 Beats
  {
    cdj::Karte k(128.0, 0);
    PRUEF(k.rampe(16.0, 132.0, 32.0));
    std::vector<cdj::KlickEinsatz> g;
    const int N = 128, bloecke = (int)(k.sample_at(64.0) / N) + 2;
    auto L = rendern(k, N, bloecke, 0, -1, g);
    pruefe_einsaetze(k, L, 0.0, 64.0);
    for (auto& e : g) PRUEF(e.sample == std::llround(k.sample_at(e.beat)));
  }
  // 3) an mitten im Beat 3: erster Klick auf Beat 4 (Takt-Eins, lauter); aus nach Beat 7: kein Klick ab Beat 8
  {
    cdj::Karte k(128.0, 0);
    std::vector<cdj::KlickEinsatz> g;
    const int N = 256;
    const int an_block = (int)(3.5 * 22500 / N), aus_block = (int)(7.5 * 22500 / N);
    auto L = rendern(k, N, (int)(12 * 22500 / N), an_block, aus_block, g);
    PRUEF(g.size() == 4);
    if (g.size() == 4) { PRUEF(g.front().beat == 4.0); PRUEF(g.back().beat == 7.0); }
    PRUEF(L[(size_t)(4 * 22500)] == cdj::KLICK_PEGEL_EINS);
    for (size_t i = 0; i < (size_t)(4 * 22500); ++i) PRUEF(L[i] == 0.0f);
    for (size_t i = (size_t)(7 * 22500 + cdj::KLICK_LAENGE); i < L.size(); ++i) PRUEF(L[i] == 0.0f);
  }
  PRUEF_ENDE();
}
