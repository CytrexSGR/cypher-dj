/* Hüllkurven-Ring Kern -> Analyse nach SCHNITTSTELLEN.md §6.2, Version 1 (cap 16384, Änderung 2026-09-28).
 * Little Endian, Kopf 64 Bytes, dann cap·16 Datensätze zu 64 Bytes; Datensatz r von Kanal c bei 64 + ((r % cap)·16 + c)·64.
 * Der Kern schreibt alle 16 Kanäle eines Datensatzes, dann w = r + 1 (Release). Anlegen: nur der Kern. */
#ifndef CYPHERDJ_HUELLEN_H
#define CYPHERDJ_HUELLEN_H
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "cypherdj/ring.h"   /* cdj_lade, cdj_setze */

#define CDJ_HUELLEN_VERSION 1u
#define CDJ_HUELLEN_RATE 1000u
#define CDJ_HUELLEN_KANAELE 16u
#define CDJ_HUELLEN_CAP 16384u
#define CDJ_HUELLEN_BYTES ((size_t)64 + (size_t)CDJ_HUELLEN_CAP * CDJ_HUELLEN_KANAELE * 64u)

typedef struct {
  char magic[4];        /*  0: "CDJH" */
  uint32_t version;     /*  4 */
  uint32_t rate_hz;     /*  8 */
  uint32_t n_kanaele;   /* 12 */
  uint32_t cap;         /* 16 */
  uint32_t reserve[3];  /* 20 */
  uint64_t w;           /* 32: geschriebene Datensätze, monoton */
  uint8_t reserve2[24]; /* 40 */
} cdj_huellen_kopf;

typedef struct {
  int64_t sample;       /*  0: letztes Sample des 48er-Fensters */
  double beat;           /*  8: Master-Beat an `sample` */
  double quell_beat;    /* 16: Quell-Beat des Decks an `sample`, NaN außer Decks */
  float band[6];        /* 24: RMS linear, Sub Tief Tiefmitte Mitte Präsenz Hoch */
  float k_leistung;     /* 48: mittlere K-gewichtete Leistung, Kanäle addiert */
  float spitze;         /* 52: Betragsmaximum */
  float reserve[2];     /* 56 */
} cdj_huellen_satz;

static inline void cdj_huellen_init(cdj_huellen_kopf* k) {
  memset(k, 0, 64);
  k->version = CDJ_HUELLEN_VERSION;
  k->rate_hz = CDJ_HUELLEN_RATE;
  k->n_kanaele = CDJ_HUELLEN_KANAELE;
  k->cap = CDJ_HUELLEN_CAP;
  cdj_setze(&k->w, 0);
  memcpy(k->magic, "CDJH", 4);  /* zuletzt: erst dann gilt der Kopf */
}
static inline int cdj_huellen_gueltig(const cdj_huellen_kopf* k) {
  return memcmp(k->magic, "CDJH", 4) == 0 && k->version == CDJ_HUELLEN_VERSION && k->rate_hz == CDJ_HUELLEN_RATE &&
         k->n_kanaele == CDJ_HUELLEN_KANAELE && k->cap == CDJ_HUELLEN_CAP;
}
static inline cdj_huellen_satz* cdj_huellen_ort(cdj_huellen_kopf* k, uint64_t r, unsigned c) {
  return (cdj_huellen_satz*)((char*)k + 64 + ((r % CDJ_HUELLEN_CAP) * CDJ_HUELLEN_KANAELE + c) * 64u);
}
#ifdef __cplusplus
static_assert(sizeof(cdj_huellen_kopf) == 64, "Kopf 64");
static_assert(sizeof(cdj_huellen_satz) == 64, "Satz 64");
static_assert(offsetof(cdj_huellen_kopf, w) == 32, "w bei 32");
#endif
#endif
