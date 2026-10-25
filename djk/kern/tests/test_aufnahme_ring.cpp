// 1.8 Task 20: Ring aus 256-Frame-Chunks je scharfer Spur. 512 Chunks = 2,73 s: ein Stall von 1,5 s verliert nichts, einer von 3 s wird gezählt,
// nie still. Die Reihenfolge und das Kern-Sample jedes Chunks bleiben erhalten.
#include <cstring>

#include "cypherdj/aufnahme_ring.h"
#include "pruef.h"

static cdj::AufnahmeChunk chunk(int64_t s0, float v) {
  cdj::AufnahmeChunk c{};
  c.s0 = s0;
  c.n = cdj::REC_CHUNK;
  for (int i = 0; i < cdj::REC_CHUNK; ++i) { c.l[i] = v + i; c.r[i] = -(v + i); }
  return c;
}

int main() {
  static_assert(cdj::REC_RING_CHUNKS * cdj::REC_CHUNK == 131072, "2,73 s bei 48 kHz");
  cdj::RecSpur* p = cdj::RecSpur::neu(3, 11);
  PRUEF(p && p->spur == 3 && p->eingang == 11 && p->phase.load() == 0 && p->stage.n == 0);
  PRUEF(p->ring.schiebe(chunk(1000, 5.0f)) && p->ring.schiebe(chunk(1256, 9.0f)));
  cdj::AufnahmeChunk c{};
  PRUEF(p->ring.hole(c) && c.s0 == 1000 && c.n == 256 && c.l[0] == 5.0f && c.r[255] == -260.0f);
  PRUEF(p->ring.hole(c) && c.s0 == 1256 && c.l[1] == 10.0f);
  PRUEF(!p->ring.hole(c));  // leer
  // Stall von 1,5 s (281 Chunks): nichts geht verloren
  int abgelehnt = 0;
  for (int i = 0; i < 281; ++i) abgelehnt += p->ring.schiebe(chunk(i * 256, 0.0f)) ? 0 : 1;
  PRUEF(abgelehnt == 0);
  while (p->ring.hole(c)) {}
  // Stall von 3 s (563 Chunks): die letzten 51 werden abgelehnt (512 passen)
  abgelehnt = 0;
  for (int i = 0; i < 563; ++i) abgelehnt += p->ring.schiebe(chunk(i * 256, 0.0f)) ? 0 : 1;
  PRUEF(abgelehnt == 51);
  PRUEF(p->ring.hole(c) && c.s0 == 0);  // das Älteste steht noch da
  cdj::RecSpur::frei(p);
  PRUEF_ENDE();
}
