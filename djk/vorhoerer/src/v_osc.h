/* OSC 1.0 für den Vorhörer, ohne liblo und ohne Allokation (Typen s, i, h, f, d; Big Endian, 4-Byte-Raster).
 * Nur im Hauptfaden benutzt, nie im Callback. Pakete höchstens 1 400 Bytes (SCHNITTSTELLEN.md §2). */
#ifndef CYPHERDJ_V_OSC_H
#define CYPHERDJ_V_OSC_H

#include <stdint.h>
#include <string.h>

#define V_OSC_MAX 1400
#define V_OSC_WERTE 8

typedef struct { char t; int64_t i; double d; const char* s; } v_osc_wert;
typedef struct {
  const char* adresse;
  const char* typen; /* ohne Komma */
  int n;
  v_osc_wert w[V_OSC_WERTE];
} v_osc_nachricht;

static inline uint32_t v_be32(const unsigned char* p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }
static inline void v_set32(unsigned char* p, uint32_t v) { p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v; }

/* Zeichenkette ab off lesen, gibt das nächste 4-Byte-Raster zurück oder -1 */
static inline int v_text(const unsigned char* b, int n, int off, const char** aus) {
  if (off >= n) return -1;
  const void* e = memchr(b + off, 0, (size_t)(n - off));
  if (!e) return -1;
  *aus = (const char*)(b + off);
  const int l = (int)((const unsigned char*)e - (b + off)) + 1;
  return off + ((l + 3) & ~3);
}

/* Liest ein Paket; 0 bei Erfolg, -1 bei Formfehler. Zahlen gleich welchen Typs landen in i und d. */
static inline int v_osc_lesen(const unsigned char* b, int n, v_osc_nachricht* m) {
  int off = v_text(b, n, 0, &m->adresse);
  const char* t;
  if (off < 0 || m->adresse[0] != '/') return -1;
  if (off >= n) { m->typen = ""; m->n = 0; return 0; }
  if ((off = v_text(b, n, off, &t)) < 0 || t[0] != ',') return -1;
  m->typen = t + 1;
  m->n = 0;
  for (const char* p = m->typen; *p; p++) {
    if (m->n >= V_OSC_WERTE) return -1;
    v_osc_wert* w = &m->w[m->n++];
    w->t = *p;
    if (*p == 'i' || *p == 'f') {
      if (off + 4 > n) return -1;
      const uint32_t u = v_be32(b + off);
      off += 4;
      if (*p == 'i') { w->i = (int32_t)u; w->d = (double)(int32_t)u; }
      else { float f; memcpy(&f, &u, 4); w->d = f; w->i = (int64_t)f; }
    } else if (*p == 'h' || *p == 'd') {
      if (off + 8 > n) return -1;
      const uint64_t u = (uint64_t)v_be32(b + off) << 32 | v_be32(b + off + 4);
      off += 8;
      if (*p == 'h') { w->i = (int64_t)u; w->d = (double)(int64_t)u; }
      else { double d; memcpy(&d, &u, 8); w->d = d; w->i = (int64_t)d; }
    } else if (*p == 's') {
      if ((off = v_text(b, n, off, &w->s)) < 0) return -1;
    } else return -1;
  }
  return 0;
}

/* Schreiber: v_osc_neu, dann je Typ ein Anhängen; Rückgabe Länge oder -1 bei Überlauf */
typedef struct { unsigned char b[V_OSC_MAX]; int n, ok; } v_osc_puffer;

static inline void v_anh_text(v_osc_puffer* p, const char* s) {
  const int l = (int)strlen(s) + 1, r = (l + 3) & ~3;
  if (!p->ok || p->n + r > V_OSC_MAX) { p->ok = 0; return; }
  memset(p->b + p->n, 0, (size_t)r);
  memcpy(p->b + p->n, s, (size_t)l);
  p->n += r;
}
static inline void v_osc_neu(v_osc_puffer* p, const char* adresse, const char* typen_mit_komma) {
  p->n = 0; p->ok = 1;
  v_anh_text(p, adresse);
  v_anh_text(p, typen_mit_komma);
}
static inline void v_anh_s(v_osc_puffer* p, const char* s) { v_anh_text(p, s); }
static inline void v_anh_d(v_osc_puffer* p, double d) {
  if (!p->ok || p->n + 8 > V_OSC_MAX) { p->ok = 0; return; }
  uint64_t u; memcpy(&u, &d, 8);
  v_set32(p->b + p->n, (uint32_t)(u >> 32)); v_set32(p->b + p->n + 4, (uint32_t)u); p->n += 8;
}
static inline void v_anh_h(v_osc_puffer* p, int64_t v) {
  if (!p->ok || p->n + 8 > V_OSC_MAX) { p->ok = 0; return; }
  v_set32(p->b + p->n, (uint32_t)((uint64_t)v >> 32)); v_set32(p->b + p->n + 4, (uint32_t)v); p->n += 8;
}

#endif
