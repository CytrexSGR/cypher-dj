// test_quelle.c: Signal und Ring-Block der Prüfquelle offline gegen die Rechnung (SCHNITTSTELLEN §1.1, §6.1, Z1).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quelle_logik.h"
static int fehler = 0;
#define PRUEFE(b) do { if (!(b)) { fprintf(stderr, "FEHLER %s:%d: %s\n", __FILE__, __LINE__, #b); fehler++; } } while (0)

static void klick_auf_dem_raster(double bpm) {
    double spb = pq_spb(bpm);
    int treffer = 0;
    for (int64_t n = 0; n < 200; n++) {
        int64_t e = pq_einsatz(spb, n);
        float soll = (n % 4 == 0) ? 0.5f : 0.25f;
        if (pq_klick(spb, e) == soll && pq_klick(spb, e - 1) == 0.0f && pq_klick(spb, e + PQ_KLICK_LEN) == 0.0f) treffer++;
    }
    PRUEFE(treffer == 200);
}

int main(void) {
    klick_auf_dem_raster(128.0);                     // spb 22500, ganzzahlig
    klick_auf_dem_raster(124.0);                     // spb 23225,806...: Einsatz = llround(n * spb)
    PRUEFE(pq_einsatz(pq_spb(124.0), 1) == 23226);    // llround(23225,806) = 23226, Abschneiden gäbe 23225
    PRUEFE(pq_einsatz(pq_spb(124.0), 3) == 69677);    // llround(69677,419) = 69677
    // Ton: exakt periodisch über 2400 Samples, gleich der Formel
    int ton_ok = 1;
    for (int64_t s = 0; s < 48000; s += 7) {
        if (pq_ton(s) != pq_ton(s + 2400 * 1000003LL)) ton_ok = 0;
        if (fabs(pq_ton(s) - 0.1 * sin(2.0 * M_PI * 220.0 * (double)s / 48000.0)) > 1e-6) ton_ok = 0;
    }
    PRUEFE(ton_ok);
    // Harte Naht um einen Takt (90 000 Samples bei 128): halbe Schwingung Versatz, der Sprung ist gleich 2 * |Ton|
    PRUEFE(fabsf(pq_ton(90000 + 55) + pq_ton(55)) < 1e-6f);
    // Ring-Block: Taktfelder wie der Kern
    pq_ring_t *r = calloc(1, pq_ring_bytes());
    pq_ring_init(r);
    double spb = pq_spb(128.0);
    for (int64_t s = 0; s < 256 * 10; s += 256) pq_ring_block(r, spb, s, 256);
    PRUEFE(atomic_load(&r->w) == 2560);
    PRUEFE(atomic_load(&r->takt_frames) == 90000);    // noch kein Takt vollendet: Länge des laufenden (wie Kern 08)
    PRUEFE(atomic_load(&r->takt_anfang_w) == 0);
    PRUEFE(r->daten[0][1] == 0.5f && r->daten[22500 % PQ_CAP][1] == 0.0f);
    for (int64_t s = 2560; s < 92160; s += 256) pq_ring_block(r, spb, s, 256);   // bis über die zweite Takt-Eins
    PRUEFE(atomic_load(&r->w) == 92160);
    PRUEFE(atomic_load(&r->takt_frames) == 90000);
    PRUEFE(atomic_load(&r->takt_anfang_w) == 90000);
    PRUEFE(r->daten[90000 % PQ_CAP][1] == 0.5f && r->daten[67500 % PQ_CAP][1] == 0.25f);
    // Fortsetzen nach Neustart mit Anker: w läuft weiter, das Sample springt um die Ausfallzeit, takt_anfang_w folgt w
    pq_ring_block(r, spb, 92160 + 256 * 20, 256);     // 20 Blöcke Ausfall
    PRUEFE(atomic_load(&r->w) == 92416);
    PRUEFE(atomic_load(&r->takt_anfang_w) == 92160 - (92160 + 256 * 20 - 90000));
    free(r);
    if (fehler) { fprintf(stderr, "%d Fehler\n", fehler); return 1; }
    printf("test_quelle: alle Prüfungen grün\n");
    return 0;
}
