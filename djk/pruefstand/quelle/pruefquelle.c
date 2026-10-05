// pruefquelle: bekanntes Signal für den Chaos-Prüfstand (Scheibe 16). L Dauerton 220 Hz, R Klick je Schlag.
//   --ring <pfad>       schreibt den Audio-Ring nach SCHNITTSTELLEN §6.1 wie der Kern (Stellvertreter des Kerns für die
//                       Notbahn: abschießbar, anhaltbar, ohne Kern-Code). w läuft über Neustarts weiter.
//   --master <präfix>   spielt zugleich selbst über master_L/R an <präfix>L/R wie der Kern aus 10k (Notbahn daneben,
//                       ADR 016 Nachtrag 2026-09-25); nur mit --ring.
//   --direkt <präfix>   spielt dasselbe Signal über master_L/R an <präfix>L/R, ohne Ring (künstliche Lücke am Ziel, E3).
//                       Ziele nur stumm oder cypherdj-pruef-* (Riegel §8), sonst Rückgabe 3.
//   --bpm <b>           Tempo (Vorgabe 128), konstant.
//   --anker <datei>     Sample 0 = Treiber-Frame aus der Datei; fehlt sie, wird sie beim ersten Zyklus geschrieben.
//                       So setzt ein Neustart (systemd Restart=always) auf dem Raster fort (Vorlage minikern2.c).
//   --spin-alle N --spin-anteil F   jeder N-te Zyklus verbrennt F Perioden im Callback (Fehlerfall 10 K1b).
// Ausgabe: "pruefquelle start ...", je Spin "pruefquelle spin <n> t_ns <CLOCK_MONOTONIC beim Spin-Beginn>", am Ende "pruefquelle ende zyklen Z spins S luecken L luecken_frames F w W".
// Rückgabewert: 1 JACK, 2 Aufruf, 3 Riegel, 5 Ring.
#define _GNU_SOURCE
#include <jack/jack.h>
#include <errno.h>
#include <fcntl.h>
#include <libgen.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include "quelle_logik.h"
static jack_client_t *cl;
static jack_port_t *port[2];
static pq_ring_t *ring;
static double spb;
static _Atomic int64_t f0 = -1;                    // Treiber-Frame bei Sample 0
static int anker_neu = 0;
static int spin_alle = 0; static double spin_anteil = 0.0;
static _Atomic uint64_t zyklen, spins, luecken, luecken_frames;
#define SPIN_MAX 4096
static int64_t spin_t[SPIN_MAX];                 // Beginn je Spin (µs, CLOCK_MONOTONIC), Ausgabe im Hauptfaden
static uint32_t letzt_cf, letzt_n; static int erster = 1;
static volatile sig_atomic_t stop;
static int64_t mono_us(void) { struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return (int64_t)ts.tv_sec * 1000000 + ts.tv_nsec / 1000; }
static int process(jack_nframes_t nf, void *arg) {
    (void)arg;
    int64_t start = mono_us();
    jack_nframes_t cf; jack_time_t cu, nu; float per;
    jack_get_cycle_times(cl, &cf, &cu, &nu, &per);
    if (!erster && cf != letzt_cf + letzt_n) { atomic_fetch_add(&luecken, 1); atomic_fetch_add(&luecken_frames, (uint32_t)(cf - letzt_cf - letzt_n)); }
    erster = 0; letzt_cf = cf; letzt_n = nf;
    if (atomic_load(&f0) < 0) { atomic_store(&f0, (int64_t)cf); anker_neu = 1; }
    int64_t s = (int64_t)(uint32_t)((uint32_t)cf - (uint32_t)atomic_load(&f0));
    if (ring) pq_ring_block(ring, spb, s, nf);
    if (port[0]) {
        float *l = jack_port_get_buffer(port[0], nf), *r = jack_port_get_buffer(port[1], nf);
        for (jack_nframes_t i = 0; i < nf; i++) { l[i] = pq_ton(s + i); r[i] = pq_klick(spb, s + i); }
    }
    uint64_t z = atomic_fetch_add(&zyklen, 1) + 1;
    if (spin_alle > 0 && z % (uint64_t)spin_alle == 0) {
        int64_t bis = start + (int64_t)(spin_anteil * per);
        while (mono_us() < bis) { }
        uint64_t n = atomic_load(&spins);
        if (n < SPIN_MAX) spin_t[n] = start;
        atomic_fetch_add(&spins, 1);
    }
    return 0;
}
static int riegel(const char *z) { return strstr(z, "stumm") || !strncmp(z, "cypherdj-pruef-", 15); }
static void ende(int sig) { (void)sig; stop = 1; }
int main(int argc, char **argv) {
    const char *ringpfad = NULL, *direkt = NULL, *master = NULL, *anker = NULL, *inst = getenv("CYPHERDJ_INSTANZ");
    double bpm = 128.0;
    for (int i = 1; i < argc; i++) {
        if (i + 1 >= argc) { fprintf(stderr, "pruefquelle: Wert fehlt nach %s\n", argv[i]); return 2; }
        if (!strcmp(argv[i], "--ring")) ringpfad = argv[++i];
        else if (!strcmp(argv[i], "--direkt")) direkt = argv[++i];
        else if (!strcmp(argv[i], "--master")) master = argv[++i];
        else if (!strcmp(argv[i], "--bpm")) bpm = atof(argv[++i]);
        else if (!strcmp(argv[i], "--anker")) anker = argv[++i];
        else if (!strcmp(argv[i], "--spin-alle")) spin_alle = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--spin-anteil")) spin_anteil = atof(argv[++i]);
        else { fprintf(stderr, "pruefquelle: unbekannt %s\n", argv[i]); return 2; }
    }
    if (!ringpfad == !direkt || (master && !ringpfad) || bpm < 60.0 || bpm > 200.0 || spin_alle < 0 || spin_anteil < 0.0) {
        fprintf(stderr, "Aufruf: pruefquelle (--ring <pfad> [--master <präfix>] | --direkt <präfix>) [--bpm 60..200] [--anker <datei>] [--spin-alle N --spin-anteil F]\n");
        return 2;
    }
    const char *ziel = direkt ? direkt : master;       // Ports master_L/R nur mit Ziel
    if (ziel && !riegel(ziel)) { fprintf(stderr, "pruefquelle: Riegel: Ziel %s weder stumm noch cypherdj-pruef-*\n", ziel); return 3; }
    spb = pq_spb(bpm);
    uint64_t w_start = 0; int fortsetzen = 0;
    if (ringpfad) {
        char ordner[256]; snprintf(ordner, sizeof ordner, "%s", ringpfad);
        if (mkdir(dirname(ordner), 0700) && errno != EEXIST) { perror("pruefquelle: Ordner"); return 5; }
        int fd = open(ringpfad, O_RDWR | O_CREAT, 0600);
        struct stat st;
        if (fd < 0 || fstat(fd, &st)) { perror("pruefquelle: Ring"); return 5; }
        if (st.st_size != (off_t)pq_ring_bytes() && ftruncate(fd, (off_t)pq_ring_bytes())) { perror("pruefquelle: ftruncate"); return 5; }
        ring = mmap(NULL, pq_ring_bytes(), PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        close(fd);
        if (ring == MAP_FAILED) { perror("pruefquelle: mmap"); return 5; }
        fortsetzen = !memcmp(ring->magic, "CDJB", 4) && ring->version == 1 && ring->cap == PQ_CAP;
        if (!fortsetzen) atomic_store(&ring->w, 0);
        pq_ring_init(ring);
        w_start = atomic_load(&ring->w);
    }
    if (anker) {
        FILE *a = fopen(anker, "r"); long long v; double b;
        if (a && fscanf(a, "f0 %lld bpm %lf", &v, &b) == 2 && b == bpm) atomic_store(&f0, (int64_t)v);
        if (a) fclose(a);
    }
    int anker_gelesen = atomic_load(&f0) >= 0;
    mlockall(MCL_CURRENT | MCL_FUTURE);
    signal(SIGINT, ende); signal(SIGTERM, ende);
    char gruppe[32], props[128], name[64];
    snprintf(gruppe, sizeof gruppe, "cypherdj%s%s", inst && *inst ? "-" : "", inst && *inst ? inst : "");
    snprintf(props, sizeof props, "{ node.group = \"%s\" node.lock-quantum = true }", gruppe);
    setenv("PIPEWIRE_PROPS", props, 1);                 // §8: dieselbe Gruppe wie Kern und Notbahn, also derselbe Treiber
    snprintf(name, sizeof name, "cypherdj-pruefquelle%s%s", inst && *inst ? "-" : "", inst && *inst ? inst : "");
    jack_status_t js; cl = jack_client_open(name, JackNoStartServer, &js);
    if (!cl || jack_get_sample_rate(cl) != 48000) { fprintf(stderr, "pruefquelle: kein JACK mit 48 kHz (0x%x)\n", js); return 1; }
    if (ziel) {                                         // Namen wie der Kern (§8, 10k): die Notbahn-Kante zeigt auf master_L
        port[0] = jack_port_register(cl, "master_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
        port[1] = jack_port_register(cl, "master_R", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
    }
    jack_set_process_callback(cl, process, NULL);
    if (jack_activate(cl)) { fprintf(stderr, "pruefquelle: jack_activate gescheitert\n"); return 1; }
    if (ziel) {
        char a[256], b[256]; snprintf(a, sizeof a, "%sL", ziel); snprintf(b, sizeof b, "%sR", ziel);
        if (jack_connect(cl, jack_port_name(port[0]), a) || jack_connect(cl, jack_port_name(port[1]), b)) {
            fprintf(stderr, "pruefquelle: Verbinden mit %sL/R gescheitert\n", ziel); jack_client_close(cl); return 1;
        }
    }
    setvbuf(stdout, NULL, _IOLBF, 0);
    printf("pruefquelle start modus %s%s bpm %.4f ring_fortgesetzt %d w %llu anker %s spin_alle %d spin_anteil %.3f puffer %u\n",
           ring ? "ring" : "direkt", ring && master ? "+master" : "", bpm, fortsetzen, (unsigned long long)w_start, anker_gelesen ? "gelesen" : "neu",
           spin_alle, spin_anteil, jack_get_buffer_size(cl));
    int geschrieben = 0;
    uint64_t gemeldet = 0;
    while (!stop) {
        usleep(10000);
        for (uint64_t n = atomic_load(&spins); gemeldet < n && gemeldet < SPIN_MAX; gemeldet++)
            printf("pruefquelle spin %llu t_ns %lld\n", (unsigned long long)gemeldet + 1, (long long)spin_t[gemeldet] * 1000);
        if (!geschrieben && atomic_load(&f0) >= 0) {
            printf("pruefquelle f0 %lld\n", (long long)atomic_load(&f0));
            if (anker && anker_neu) { FILE *a = fopen(anker, "w"); if (a) { fprintf(a, "f0 %lld bpm %.6f\n", (long long)atomic_load(&f0), bpm); fclose(a); } }
            geschrieben = 1;
        }
    }
    jack_deactivate(cl);
    printf("pruefquelle ende zyklen %llu spins %llu luecken %llu luecken_frames %llu w %llu\n",
           (unsigned long long)atomic_load(&zyklen), (unsigned long long)atomic_load(&spins), (unsigned long long)atomic_load(&luecken),
           (unsigned long long)atomic_load(&luecken_frames), ring ? (unsigned long long)atomic_load(&ring->w) : 0ULL);
    jack_client_close(cl);
    return 0;
}
