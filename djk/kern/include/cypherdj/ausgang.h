/* Kern-Ausgang daneben (ADR 016 Nachtrag 2026-09-25, Scheibe 10k): gibt den gerade in den Ring geschriebenen Block
 * [w0, w0 + n) an die vier Ausgänge, mit dem Riegel, der vorher als letzte Stufe in der Notbahn saß (NaN/Inf -> 0,
 * Clip auf ±1), und blendet nach dem Start über CDJ_EINBLENDE Samples ein (M2b: Rückgabe an den Kern mit Blende).
 * Gemeinsam für C und C++, ohne Zustand außer dem Zähler *eingeblendet (nur im Callback). */
#ifndef CYPHERDJ_AUSGANG_H
#define CYPHERDJ_AUSGANG_H

#include <math.h>
#include <stdint.h>

#include "cypherdj/ring.h"

#define CDJ_EINBLENDE 256u

static inline float cdj_riegel_wert(float x) {
#ifdef CYPHERDJ_MUTATION_OHNE_RIEGEL
  return x;
#else
  return !isfinite(x) ? 0.0f : (x > 1.0f ? 1.0f : (x < -1.0f ? -1.0f : x));
#endif
}

static inline void cdj_ausgang(const float* daten, uint64_t w0, int n, float* const* aus, uint64_t* eingeblendet) {
  for (int i = 0; i < n; ++i) {
    const float* f = daten + ((w0 + (uint64_t)i) % CDJ_RING_CAP) * CDJ_RING_KANAELE;
    float g = 1.0f;
    if (*eingeblendet < CDJ_EINBLENDE) { g = (float)*eingeblendet / (float)CDJ_EINBLENDE; ++*eingeblendet; }
    for (int k = 0; k < 4; ++k) aus[k][i] = g * cdj_riegel_wert(f[k]);
  }
}

#endif
