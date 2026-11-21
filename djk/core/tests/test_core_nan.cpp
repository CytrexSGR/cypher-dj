// Paket 1 „Nie still" Slice 4 (Audit 2026-10-01, F01), erste Linie: der Wirt-Rückweg rueck_erz_* war der einzige
// Audio-Eingang ohne Endlichkeitsprüfung. Ein NaN aus Surge kam in erz/1 an und machte den Master bis zum Neustart
// still. Jetzt verwirft der Kern nicht endliche Rückweg-Samples (gezählt), die zweite Linie im Mixer muss gar nicht
// greifen. Container core X1: there is no erz/1 strip any more, so the return is read where it lands, in the stream buffer of
// stream 1 (Quellpuffer strom_l[0], one cycle of 256 fits one sub-block). Rahmen ohne JACK (Kern, Ring im Speicher).
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "cypherdj/core.h"
#include "cypherdj/quellpuffer.h"
#include "check.h"

constexpr int N = 256;

int main() {
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  auto* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  ring->version = CDJ_RING_VERSION;
  ring->rate = CDJ_RING_RATE;
  ring->kanaele = CDJ_RING_KANAELE;
  ring->cap = CDJ_RING_CAP;
  std::memcpy(ring->magic, "CDJB", 4);
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  auto kern = std::make_unique<cdj::Kern>(128.0, ring, bef.get(), ere.get());

  float l[N], r[N];
  uint32_t z = 11;
  float max_vor = 0.0f, max_nach = 0.0f;
  bool endlich = true;
  for (int zyk = 0; zyk < 400; ++zyk) {
    for (int i = 0; i < N; ++i) {
      z = z * 1664525u + 1013904223u;
      l[i] = r[i] = 0.2f * (static_cast<float>(z >> 8) / 16777216.0f - 0.5f);
    }
    if (zyk == 200) l[33] = std::nanf("");  // ein einziges NaN aus dem Wirt
    if (zyk == 201) r[5] = INFINITY;
    kern->rueck(1, l, r);
    const int64_t n0 = kern->sample();
    kern->zyklus(N, n0 * 20833);
    const cdj::Quellpuffer& qp = kern->quellpuffer();
    for (int i = 0; i < N; ++i) {
      const float m = qp.strom_l[0][i];
      endlich = endlich && std::isfinite(m);
      if (zyk >= 150 && zyk < 200) max_vor = std::max(max_vor, std::fabs(m));
      if (zyk >= 220) max_nach = std::max(max_nach, std::fabs(m));
    }
    cdj::Ereignis e;
    while (ere->hole(e)) {}
  }
  std::printf("F01 Rückweg: vorher %.4f, nachher %.4f, endlich %d, verworfen %lld, Mixer-Treffer %lld\n", max_vor,
              max_nach, (int)endlich, (long long)kern->rueck_unendlich(), (long long)kern->mixer().nan_treffer());
  PRUEF(max_vor > 0.01f);                       // Positiv-Kontrolle: Strom 1 trägt den Rückweg vor dem NaN
  PRUEF(endlich && max_nach > 0.01f);           // und danach weiter
  PRUEF(kern->rueck_unendlich() == 2);          // genau die zwei Samples verworfen
  PRUEF(kern->mixer().nan_treffer() == 0);      // die erste Linie hat es gefangen, nicht die zweite
  PRUEF_ENDE();
}
