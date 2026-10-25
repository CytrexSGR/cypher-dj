// 1.8 Slice 1: Ring je scharfer Spur. Der Callback schiebt Chunks von 256 Frames mit ihrem Kern-Sample (SpscRing, Schreiber = Callback, Leser =
// Aufnahme-Faden); eine Lücke (Ring voll) fällt dem Faden an der Sprungstelle der Samples auf und wird mit Stille gefüllt und gezählt (take_schreiber.h).
// RecSpur liegt auf dem Heap (1 MB), wird vom Netz-Faden angelegt und vorgewärmt und vom Netz-Faden wieder freigegeben (Ereignis REC_ALT), nie im Callback.
#pragma once

#include <sys/mman.h>

#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <new>

#include "cypherdj/spsc_ring.h"

namespace cdj {

constexpr int REC_CHUNK = 256;
constexpr std::size_t REC_RING_CHUNKS = 512;
constexpr int REC_MAX_ARM = 8;   // gleichzeitig scharfe Audio-Spuren (Spec 1.8 R9), unabhängig von der Spurzahl

struct AufnahmeChunk {
  int64_t s0;      // Kern-Sample des ersten Frames
  int32_t n;       // 1..REC_CHUNK
  int32_t pad;
  float l[REC_CHUNK];
  float r[REC_CHUNK];
};

struct RecSpur {
  int spur = 0;       // 1..ARR_SPUREN
  int eingang = 0;    // 11..13 = erz/1..3
  SpscRing<AufnahmeChunk, REC_RING_CHUNKS> ring;
  // Take: der Callback setzt start_s/ende_s/kennung, dann phase mit release; der Faden liest nach acquire.
  // 0 bereit · 1 nimmt auf · 2 Callback fertig (Ende gesetzt) · 3 Faden fertig (Datei geschlossen, gemeldet)
  std::atomic<int32_t> phase{0};
  int32_t kennung = 0;
  int64_t start_s = -1, ende_s = -1;
  std::atomic<uint64_t> abgelehnt{0};   // Chunks, die der Callback nicht loswurde (Ring voll)
  AufnahmeChunk stage;                  // Sammelchunk des Callbacks (Nachbesserung 1, m4): Teilblöcke füllen ihn, voll oder am Take-Ende geht er in den Ring; n = 0: leer

  // Anlegen: ausgerichtet, genullt (die Seiten sind damit angefasst) und, soweit erlaubt, gesperrt. Nur Netz-Faden.
  static RecSpur* neu(int spur, int eingang) {
    void* m = std::aligned_alloc(64, sizeof(RecSpur));
    if (!m) return nullptr;
    std::memset(m, 0, sizeof(RecSpur));
    (void)mlock(m, sizeof(RecSpur));   // Best Effort: scheitert das Limit, bleibt es beim Vorwärmen durch memset
    RecSpur* p = new (m) RecSpur();
    p->spur = spur;
    p->eingang = eingang;
    return p;
  }
  static void frei(RecSpur* p) {
    if (!p) return;
    munlock(p, sizeof(RecSpur));
    p->~RecSpur();
    std::free(p);
  }
};

}  // namespace cdj
