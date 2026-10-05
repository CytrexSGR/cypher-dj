// pq_ring.h: Sicht der Prüfquelle auf den Audio-Ring nach SCHNITTSTELLEN §6.1, Version 1 (Kopf 64 Bytes, dann
// float32[cap][4]). Eigene Kopie mit Lage-Prüfung, damit der Prüfstand nicht an einer Kopfdatei aus Kern oder Notbahn
// hängt: stimmen beide mit dem Vertrag, stimmen sie mit dieser Datei.
#pragma once
#include <stdatomic.h>
#include <stddef.h>
#include <stdint.h>
#define PQ_KANAELE 4                      // 0 master_L, 1 master_R, 2 cue_L, 3 cue_R
#define PQ_CAP 65536u
typedef struct {
    char magic[4];                        // "CDJB"
    uint32_t version, rate, kanaele, cap, reserve[3];
    _Atomic uint64_t w;                   // geschriebene Frames, monoton über Neustarts
    _Atomic uint64_t takt_frames;         // Länge des zuletzt vollendeten Master-Takts
    _Atomic uint64_t takt_anfang_w;       // w am Anfang des laufenden Master-Takts
    uint8_t reserve2[8];
    float daten[][PQ_KANAELE];            // Frame f liegt bei Index f % cap
} pq_ring_t;
_Static_assert(offsetof(pq_ring_t, w) == 32, "w bei Byte 32 (§6.1)");
_Static_assert(offsetof(pq_ring_t, takt_frames) == 40, "takt_frames bei Byte 40 (§6.1)");
_Static_assert(offsetof(pq_ring_t, takt_anfang_w) == 48, "takt_anfang_w bei Byte 48 (§6.1)");
_Static_assert(offsetof(pq_ring_t, daten) == 64, "Daten ab Byte 64 (§6.1)");
static inline size_t pq_ring_bytes(void) { return 64 + (size_t)PQ_CAP * PQ_KANAELE * sizeof(float); }
