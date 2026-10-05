// lastgen: Speicher-Streaming für Lastprofil P1 (ARCHITEKTUR §9.2). N Fäden (SCHED_OTHER) streamen je M MiB lesend und
// schreibend (Vorlage proben/10-robustheit-betrieb/nachpruefung/src/lastgen2.c; 16 x 64 MiB verdrängt den 96-MB-L3).
// Neu: zählt den Durchsatz und endet sauber auf SIGTERM, damit der Bericht die erzeugte Last belegt.
// Aufruf: lastgen <fäden> <sekunden> <mib>
// Ausgabe am Ende: "lastgen faeden N mib M sekunden S durchsatz_gib_s D"
#define _GNU_SOURCE
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
static int dauer; static size_t groesse;
static volatile sig_atomic_t stop;
static _Atomic unsigned long long bytes;
static double jetzt(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }
static void *lauf(void *a) {
    (void)a;
    size_t n = groesse; volatile unsigned char *b = malloc(n);
    if (!b) return NULL;
    memset((void *)b, 1, n);
    double ende = jetzt() + dauer; unsigned long s = 0;
    while (!stop && jetzt() < ende) {
        for (size_t i = 0; i < n; i += 64) { s += b[i]; b[i] = (unsigned char)s; }
        atomic_fetch_add(&bytes, (unsigned long long)n);
    }
    return (void *)s;
}
static void halt(int sig) { (void)sig; stop = 1; }
int main(int c, char **v) {
    int n = c > 1 ? atoi(v[1]) : 16; dauer = c > 2 ? atoi(v[2]) : 60; int mib = c > 3 ? atoi(v[3]) : 64;
    if (n < 1 || n > 256 || dauer < 1 || mib < 1) { fprintf(stderr, "Aufruf: lastgen <fäden 1..256> <sekunden> <mib>\n"); return 2; }
    groesse = (size_t)mib << 20;
    signal(SIGTERM, halt); signal(SIGINT, halt);
    pthread_t t[256]; double t0 = jetzt();
    for (int i = 0; i < n; i++) pthread_create(&t[i], 0, lauf, 0);
    for (int i = 0; i < n; i++) pthread_join(t[i], 0);
    double dt = jetzt() - t0;
    printf("lastgen faeden %d mib %d sekunden %.1f durchsatz_gib_s %.2f\n", n, mib, dt, (double)atomic_load(&bytes) / dt / (1ull << 30));
    return 0;
}
