// Plan Mediathek-Browser S7 (Review S7 M2): der Kern selbst macht erz/8 zum Nur-Cue-Kanal (kern.cpp, nach dem Mixer).
// Rauschen über den Rückweg rueck(8), erz/8-Fader, -Send/2 und fx/2-Rückweg auf 0 dB: Master im Ring exakt 0, Cue hörbar.
// Ohne die Zeile in kern.cpp (Mutationsziel test_kern_vorhoeren_mutation) ist der Master hörbar — gemessen am 2026-10-11: 0,2453 (Review 0,2427 war ein älterer Stand).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>

#include "cypherdj/kern.h"
#include "pruef.h"

constexpr int N = 256;

static void teil(cdj::Befehlsring& bef, int id, const char* pfad, float wert) {
  cdj::Befehl b{};
  b.art = cdj::Befehl::TEIL;
  b.id = id;
  std::snprintf(b.quelle, sizeof b.quelle, "pruefstand");
  std::snprintf(b.pfad, sizeof b.pfad, "%s", pfad);
  b.ab_beat = 1.0;
  b.wert = wert;
  b.politik = 1;
  PRUEF(bef.schiebe(b));
}

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
  PRUEF(kern->mixer().nur_cue(cdj::Mixer::kanal_index(cdj::VORHOER_KANAL)));
  teil(*bef, 1, "erz/8/fader", 0.0f);       // alles auf, was erz/8 in den Master tragen könnte
  teil(*bef, 2, "erz/8/send/2", 0.0f);
  teil(*bef, 3, "fx/2/rueckweg", 0.0f);
  float l[N], r[N];
  uint32_t z = 7;
  float master = 0.0f, cue = 0.0f;
  for (int zyk = 0; zyk < 400; ++zyk) {
    for (int i = 0; i < N; ++i) {
      z = z * 1664525u + 1013904223u;
      l[i] = r[i] = 0.2f * (static_cast<float>(z >> 8) / 16777216.0f - 0.5f);
    }
    kern->rueck(8, l, r);
    const int64_t n0 = kern->sample();
    const uint64_t w0 = cdj_lade(&ring->w);
    kern->zyklus(N, n0 * 20833);
    const float* d = cdj_ring_daten_c(ring);
    if (zyk >= 100)                            // nach Beat 1 (Befehle wirksam) und Limiter-Vorhalt
      for (int i = 0; i < N; ++i) {
        const float* s = &d[((w0 + (uint64_t)i) % CDJ_RING_CAP) * 4];   // 0/1 Master, 2/3 Cue
        master = std::max(master, std::max(std::fabs(s[0]), std::fabs(s[1])));
        cue = std::max(cue, std::max(std::fabs(s[2]), std::fabs(s[3])));
      }
    cdj::Ereignis e;
    while (ere->hole(e)) {}
  }
  std::printf("S7 Vorhören im Kern: Master %.6f, Cue %.6f\n", master, cue);
  PRUEF(master == 0.0f);                     // nie im Master, obwohl Fader, Send und Hall offen sind
  PRUEF(cue > 0.01f);                        // Positiv-Kontrolle: im Kopfhörer hörbar (Review: 0,0508)
  PRUEF_ENDE();
}
