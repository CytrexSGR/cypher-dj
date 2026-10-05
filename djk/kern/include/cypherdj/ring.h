/* Audio-Ring Kern -> Notbahn nach SCHNITTSTELLEN.md §6.1, Version 1. Gemeinsam für C (Notbahn) und C++ (Kern).
 * Little Endian, Kopf 64 Bytes, Daten float32[cap][4] verschränkt (0 master_L, 1 master_R, 2 cue_L, 3 cue_R).
 * Die drei Zähler sind 64-Bit-Worte, geschrieben mit Release und gelesen mit Acquire (GCC-__atomic-Eingebaute,
 * gleiche Darstellung wie _Atomic uint64 auf x86-64). Anlegen: nur der Kern (O_CREAT, 0600). */
#ifndef CYPHERDJ_RING_H
#define CYPHERDJ_RING_H

#include <stddef.h>
#include <stdint.h>

#define CDJ_RING_VERSION 1u
#define CDJ_RING_RATE 48000u
#define CDJ_RING_KANAELE 4u
#define CDJ_RING_CAP 65536u
#define CDJ_RING_KOPF 64u
#define CDJ_RING_BYTES ((size_t)CDJ_RING_KOPF + (size_t)CDJ_RING_CAP * CDJ_RING_KANAELE * sizeof(float))

typedef struct {
  char magic[4];          /*  0: "CDJB" */
  uint32_t version;       /*  4 */
  uint32_t rate;          /*  8 */
  uint32_t kanaele;       /* 12 */
  uint32_t cap;           /* 16: Frames */
  uint32_t reserve[3];    /* 20 */
  uint64_t w;             /* 32: geschriebene Frames, monoton über Kern-Neustarts */
  uint64_t takt_frames;   /* 40: Länge des zuletzt vollendeten Master-Takts in Frames */
  uint64_t takt_anfang_w; /* 48: w am Anfang des laufenden Master-Takts */
  uint8_t reserve2[8];    /* 56 */
} cdj_ring_kopf;

#ifdef __cplusplus
static_assert(sizeof(cdj_ring_kopf) == 64, "Ring-Kopf muss 64 Bytes haben");
static_assert(offsetof(cdj_ring_kopf, w) == 32, "w bei 32");
static_assert(offsetof(cdj_ring_kopf, takt_frames) == 40, "takt_frames bei 40");
static_assert(offsetof(cdj_ring_kopf, takt_anfang_w) == 48, "takt_anfang_w bei 48");
#else
_Static_assert(sizeof(cdj_ring_kopf) == 64, "Ring-Kopf muss 64 Bytes haben");
_Static_assert(offsetof(cdj_ring_kopf, w) == 32, "w bei 32");
_Static_assert(offsetof(cdj_ring_kopf, takt_frames) == 40, "takt_frames bei 40");
_Static_assert(offsetof(cdj_ring_kopf, takt_anfang_w) == 48, "takt_anfang_w bei 48");
#endif

static inline float* cdj_ring_daten(cdj_ring_kopf* r) { return (float*)((char*)r + CDJ_RING_KOPF); }
static inline const float* cdj_ring_daten_c(const cdj_ring_kopf* r) {
  return (const float*)((const char*)r + CDJ_RING_KOPF);
}
static inline uint64_t cdj_lade(const uint64_t* p) { return __atomic_load_n(p, __ATOMIC_ACQUIRE); }
static inline void cdj_setze(uint64_t* p, uint64_t v) { __atomic_store_n(p, v, __ATOMIC_RELEASE); }

/* 1, wenn Magic, Version, Rate, Kanäle und Kapazität stimmen */
static inline int cdj_ring_gueltig(const cdj_ring_kopf* r) {
  return r->magic[0] == 'C' && r->magic[1] == 'D' && r->magic[2] == 'J' && r->magic[3] == 'B' &&
         r->version == CDJ_RING_VERSION && r->rate == CDJ_RING_RATE && r->kanaele == CDJ_RING_KANAELE &&
         r->cap == CDJ_RING_CAP;
}

#endif
