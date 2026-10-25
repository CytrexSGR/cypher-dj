// I08 (Feature I08, Plan 2026-10-22-i08): Audio-Eingänge des Kerns, ein_1..4_L/R. Nur Zeiger auf die JACK-Puffer des laufenden Zyklus,
// Spitzen und die Lage des letzten Impulses (Messung MIDI gegen Audio). Echtzeit: keine Allokation, keine Sperre, kein I/O.
// Rein Header: der Kern führt keine zusätzliche .cpp (CMakeLists.txt, explizite Quellenlisten).
#pragma once

#include <cmath>
#include <cstdint>

namespace cdj {

constexpr int EIN_PAARE = 4;
constexpr float EIN_FLANKE_SCHWELLE = 0.1f;  // |linker Kanal| ab diesem Wert ist ein Ausschlag
constexpr int EIN_FLANKE_RUHE = 64;          // so viele Samples darunter vorher: dann ist es eine Flanke

class EingangsBank {
 public:
  // paar 1..4; nullptr = Port fehlt. main.cpp setzt es vor jedem zyklus() mit den JACK-Puffern dieses Zyklus.
  void zeiger(int paar, const float* l, const float* r) noexcept {
    if (paar >= 1 && paar <= EIN_PAARE) { l_[paar - 1] = l; r_[paar - 1] = r; }
  }
  bool da(int paar) const noexcept { return paar >= 1 && paar <= EIN_PAARE && l_[paar - 1] && r_[paar - 1]; }
  // Spitze und Flanke über m Samples ab Index off der Zyklus-Puffer; s0 = Kern-Sample von Index off.
  void messe(int64_t s0, int off, int m) noexcept {
    for (int k = 0; k < EIN_PAARE; ++k) {
      if (!l_[k] || !r_[k]) continue;
      const float* a = l_[k] + off;
      const float* b = r_[k] + off;
      float sp = sp_[k];
      int ruhe = ruhe_[k];
      for (int i = 0; i < m; ++i) {
        const float x = std::fabs(a[i]);
#ifdef CYPHERDJ_MUTATION_EIN_SPITZE_NUR_L
        const float y = x;  // Fehlerfall: der rechte Kanal zählt nicht
#else
        const float y = std::fmax(x, std::fabs(b[i]));
#endif
        sp = std::fmax(sp, std::isfinite(y) ? y : 8.0f);
        if (x >= EIN_FLANKE_SCHWELLE) {
          if (ruhe >= EIN_FLANKE_RUHE) flanke_[k] = s0 + i;
          ruhe = 0;
        } else if (ruhe < EIN_FLANKE_RUHE) {
          ++ruhe;
        }
      }
      sp_[k] = sp;
      ruhe_[k] = ruhe;
    }
  }
  // Spitze (linear, höchstens 8,0) seit dem letzten Lesen; setzt zurück. 0 ohne Zeiger oder außerhalb 1..4.
  float spitze_lesen(int paar) noexcept {
    if (paar < 1 || paar > EIN_PAARE) return 0.0f;
    const float v = sp_[paar - 1];
    sp_[paar - 1] = 0.0f;
    return v;
  }
  // Neue Zeitachse (/k/set/neu): die letzten Flanken gehören zur alten Achse.
  void achse_neu() noexcept { for (int k = 0; k < EIN_PAARE; ++k) flanke_[k] = -1; }
  // Kern-Sample der letzten Flanke (linker Kanal), −1 ohne.
  int64_t flanke(int paar) const noexcept { return paar >= 1 && paar <= EIN_PAARE ? flanke_[paar - 1] : -1; }

 private:
  const float* l_[EIN_PAARE] = {};
  const float* r_[EIN_PAARE] = {};
  float sp_[EIN_PAARE] = {};
  int ruhe_[EIN_PAARE] = {EIN_FLANKE_RUHE, EIN_FLANKE_RUHE, EIN_FLANKE_RUHE, EIN_FLANKE_RUHE};
  int64_t flanke_[EIN_PAARE] = {-1, -1, -1, -1};
};

}  // namespace cdj
