// K2 Task 2.1: der erzeugte Hall klingt nach einem Impuls aus, bleibt endlich, und Stille bleibt Stille
#include "cypherdj/hall.h"
#include "pruef.h"
#include <cmath>
#include <vector>

int main() {
  const int N = 256;
  cdj::Hall h;                     // allokiert im Konstruktor (außerhalb des Callbacks)
  std::vector<float> l(N, 0.0f), r(N, 0.0f), ol(N), orr(N);
  // Stille rein → Stille raus (kein Rauschen, kein Denormal-Müll)
  h.block(l.data(), r.data(), ol.data(), orr.data(), N);
  bool still = true; for (int i = 0; i < N; ++i) still = still && ol[i] == 0.0f && orr[i] == 0.0f;
  PRUEF(still);
  // Impuls → Energie über mehrere hundert Millisekunden, endlich
  l[0] = r[0] = 1.0f;
  double e_frueh = 0, e_spaet = 0; bool endlich = true;
  for (int b = 0; b < 400; ++b) {    // ~2,1 s
    h.block(l.data(), r.data(), ol.data(), orr.data(), N);
    if (b == 0) l[0] = r[0] = 0.0f;
    for (int i = 0; i < N; ++i) {
      endlich = endlich && std::isfinite(ol[i]) && std::isfinite(orr[i]);
      (b < 40 ? e_frueh : e_spaet) += ol[i] * ol[i];
    }
  }
  PRUEF(endlich);
  PRUEF(e_frueh > 0.01);              // Probe 2026-09-30: Gesamtenergie 0,14 bei diesem Impuls
  PRUEF(e_spaet > 0.0 && e_spaet < e_frueh);   // klingt aus
  PRUEF_ENDE();
}
