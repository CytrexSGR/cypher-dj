// quelle_logik.h: Signal der Prüfquelle ohne JACK (offline prüfbar). Kanal L: Dauerton 220 Hz, Amplitude 0,1
// (412,5 Schwingungen je Takt bei 128 BPM: jede harte Naht springt, Nulldurchgänge liegen nie 16 Samples unter 1e-4);
// Kanal R: Klick je Schlag mit Einsatz auf llround(n * spb), Takt-Eins 0,5, sonst 0,25, Form wie der Prüfklick (Z1,
// proben/01-audio-kern/a-cpp-jack/klick_kern.cpp Z. 385). Ring-Block wie der Kern (§6.1): Daten, Taktfelder, dann w.
#pragma once
#include <math.h>
#include <stdint.h>
#include "pq_ring.h"
#define PQ_SR 48000.0
#define PQ_KLICK_LEN 96
static inline double pq_spb(double bpm) { return PQ_SR * 60.0 / bpm; }
static inline int64_t pq_einsatz(double spb, int64_t n) { return llround((double)n * spb); }
// Letzter Schlag n mit Einsatz <= s (s >= 0).
static inline int64_t pq_schlag(double spb, int64_t s) {
    int64_t n = (int64_t)floor((double)s / spb);
    while (pq_einsatz(spb, n + 1) <= s) n++;
    while (n > 0 && pq_einsatz(spb, n) > s) n--;
    return n;
}
// 220 Hz bei 48 kHz: 2400 Samples sind genau 11 Schwingungen, so bleibt die Phase über jede Laufzeit exakt.
static inline float pq_ton(int64_t s) {
    int64_t m = s % 2400; if (m < 0) m += 2400;
    return (float)(0.1 * sin(2.0 * M_PI * 11.0 * (double)m / 2400.0));
}
static inline float pq_klick(double spb, int64_t s) {
    if (s < 0) return 0.0f;
    int64_t n = pq_schlag(spb, s), j = s - pq_einsatz(spb, n);
    if (j < 0 || j >= PQ_KLICK_LEN) return 0.0f;
    double pegel = (n % 4 == 0) ? 0.5 : 0.25;
    return (float)(pegel * exp(-(double)j / 12.0) * cos(2.0 * M_PI * 2000.0 * (double)j / PQ_SR));
}
static inline void pq_ring_init(pq_ring_t *r) {
    r->magic[0] = 'C'; r->magic[1] = 'D'; r->magic[2] = 'J'; r->magic[3] = 'B';
    r->version = 1; r->rate = 48000; r->kanaele = PQ_KANAELE; r->cap = PQ_CAP;
}
// Schreibt die Kern-Samples s .. s+nf-1 an Ring-Position w (L Ton, R Klick, Cue still), setzt takt_frames (Länge des
// zuletzt vollendeten Takts; im ersten Takt gibt es keinen, dann die Länge des laufenden, wie der Kern aus Scheibe 08)
// und takt_anfang_w (w an der Takt-Eins des laufenden Takts), dann w += nf (Release).
static inline void pq_ring_block(pq_ring_t *r, double spb, int64_t s, uint32_t nf) {
    uint64_t w = atomic_load_explicit(&r->w, memory_order_relaxed);
    for (uint32_t i = 0; i < nf; i++) {
        float *f = r->daten[(w + i) % PQ_CAP];
        f[0] = pq_ton(s + i); f[1] = pq_klick(spb, s + i); f[2] = 0.0f; f[3] = 0.0f;
    }
    int64_t t = pq_schlag(spb, s + nf - 1) / 4;                    // laufender Takt (0-basiert)
    int64_t anf = pq_einsatz(spb, 4 * t);
    uint64_t tf = (uint64_t)(t >= 1 ? anf - pq_einsatz(spb, 4 * (t - 1)) : pq_einsatz(spb, 4) - anf);
    int64_t aw = (int64_t)w + (anf - s);
    atomic_store_explicit(&r->takt_frames, tf, memory_order_relaxed);
    atomic_store_explicit(&r->takt_anfang_w, aw > 0 ? (uint64_t)aw : 0, memory_order_relaxed);
    atomic_store_explicit(&r->w, w + nf, memory_order_release);
}
