// Scheibe 10k: Kern-Ausgang daneben (ADR 016 Nachtrag 2026-09-25). Aus dem gerade geschriebenen Ring-Block, NaN/Inf -> 0,
// Clip auf ±1, Einblende über CDJ_EINBLENDE Samples nach dem Start (auch über Blockgrenzen). Mutation ohne Riegel: rot.
#include <cmath>
#include <vector>

#include "cypherdj/ausgang.h"
#include "cypherdj/ring.h"
#include "pruef.h"

int main() {
  std::vector<float> ring((size_t)CDJ_RING_CAP * CDJ_RING_KANAELE, 0.0f);
  float a0[256], a1[256], a2[256], a3[256];
  float* aus[4] = {a0, a1, a2, a3};
  // Block ab w = CAP - 100 (über das Ringende): Kanal 0 = 1, Kanal 1 = NaN, Kanal 2 = 4, Kanal 3 = -Inf
  const uint64_t w0 = CDJ_RING_CAP - 100;
  for (int i = 0; i < 256; ++i) {
    float* f = &ring[((w0 + (uint64_t)i) % CDJ_RING_CAP) * CDJ_RING_KANAELE];
    f[0] = 1.0f; f[1] = NAN; f[2] = 4.0f; f[3] = -INFINITY;
  }
  uint64_t eingeblendet = 0;
  cdj_ausgang(ring.data(), w0, 256, aus, &eingeblendet);
  PRUEF(eingeblendet == 256);
  PRUEF(a0[0] == 0.0f);                              // Einblende beginnt bei 0
  PRUEF_NAH(a0[128], 128.0 / 256.0, 1e-6);           // linear
  PRUEF_NAH(a0[255], 255.0 / 256.0, 1e-6);
  bool nan_frei = true, im_bereich = true;
  for (int i = 0; i < 256; ++i) {
    for (int k = 0; k < 4; ++k) {
      nan_frei &= std::isfinite(aus[k][i]);
      im_bereich &= std::fabs(aus[k][i]) <= 1.0f;
    }
  }
  PRUEF(nan_frei);
  PRUEF(im_bereich);
  PRUEF(a1[200] == 0.0f);                            // NaN -> 0
  PRUEF_NAH(a2[255], 255.0 / 256.0, 1e-6);           // 4 -> 1, dann Einblende
  // zweiter Block: Einblende vorbei, volle Werte
  cdj_ausgang(ring.data(), w0, 256, aus, &eingeblendet);
  PRUEF(a0[0] == 1.0f && a2[0] == 1.0f && a3[0] == 0.0f && a1[0] == 0.0f);  // Inf wie NaN -> 0
  return pruef_fehler ? 1 : 0;
}
