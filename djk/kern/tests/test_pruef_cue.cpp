// Scheibe 18: Prüfsignal auf dem Cue (pruef_cue.h). Die Werte sind festgenagelt (dieselben stehen in
// tests/neustart/test_auswertung.py, damit Kern und Auswertung bitgleich rechnen). Der Kern schreibt das Signal nur mit
// setze_pruef_cue(true) in die Cue-Kanäle des Rings (Negativ-Kontrolle: sonst 0), und zwar zum Kern-Sample, nicht zum
// Ring-Index (Fehlerfall zum Vergleich: ein Kern, der bei einem anderen Sample beginnt, liefert andere Werte).
#include <cstring>
#include <memory>

#include "cypherdj/kern.h"
#include "cypherdj/pruef_cue.h"
#include "pruef.h"

static cdj_ring_kopf* neuer_ring(std::unique_ptr<unsigned char[]>& mem) {
  mem.reset(new unsigned char[CDJ_RING_BYTES]());
  auto* r = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  std::memcpy(r->magic, "CDJB", 4);
  return r;
}

int main() {
  // Festwerte (float32; %.9g gibt jeden float eindeutig wieder)
  PRUEF(cdj::pruef_cue_wert(0) == 0.0766621605f);
  PRUEF(cdj::pruef_cue_wert(1) == 0.0133122923f);
  PRUEF(cdj::pruef_cue_wert(1440000) == 0.0115677118f);
  PRUEF(cdj::pruef_cue_wert(1665536) == -0.00506503601f);
  PRUEF(cdj::pruef_cue_wert(1LL << 40) == -0.0751054808f);

  std::unique_ptr<unsigned char[]> m1, m2;
  cdj_ring_kopf* r1 = neuer_ring(m1);
  cdj_ring_kopf* r2 = neuer_ring(m2);
  auto b1 = std::make_unique<cdj::Befehlsring>();
  auto e1 = std::make_unique<cdj::Ereignisring>();
  auto b2 = std::make_unique<cdj::Befehlsring>();
  auto e2 = std::make_unique<cdj::Ereignisring>();
  cdj::Kern an(128.0, r1, b1.get(), e1.get());
  cdj::Kern aus(128.0, r2, b2.get(), e2.get());
  an.setze_pruef_cue(true);
  for (int z = 0; z < 10; ++z) {
    an.zyklus(256, 0);
    aus.zyklus(256, 0);
  }
  const float* d1 = cdj_ring_daten_c(r1);
  const float* d2 = cdj_ring_daten_c(r2);
  int gleich = 0, still = 0;
  for (int i = 0; i < 2560; ++i) {
    gleich += (d1[i * 4 + 2] == cdj::pruef_cue_wert(i) && d1[i * 4 + 3] == cdj::pruef_cue_wert(i)) ? 1 : 0;
    still += (d2[i * 4 + 2] == 0.0f && d2[i * 4 + 3] == 0.0f) ? 1 : 0;
  }
  PRUEF(gleich == 2560);
  PRUEF(still == 2560);
  // Fehlerfall zum Vergleich: um 1 Sample versetzt stimmt fast nichts mehr
  int versetzt = 0;
  for (int i = 1; i < 2560; ++i) versetzt += (d1[i * 4 + 2] == cdj::pruef_cue_wert(i - 1)) ? 1 : 0;
  PRUEF(versetzt < 10);
  PRUEF_ENDE();
}
