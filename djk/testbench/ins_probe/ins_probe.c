/* ins_probe: measuring client for the insert-host round trip (plan 1.11, task 1). Not product code.
 *
 * JACK client (name --name, default cypherdj-probe): ports arr_ins_1_L/R out, arr_insret_1_L/R in. Per cycle it logs the
 * callback start (CLOCK_MONOTONIC), the gap to the previous start, the peak of the return and whether the return block
 * equals the previous return block. It also keeps the raw samples (out L, return L, return R) for the offline impulse search
 * in ins_probe.py. All buffers are allocated before the client is activated; the callback allocates and locks nothing.
 *
 * --fake <delay:N|wdh|stille> replaces JACK by a paced thread plus a fake producer thread (self-test of the analysis).
 * Exit code 0 also when the host dies during the run: the probe only measures what comes back.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <jack/jack.h>
#include <math.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define IMPULSE_PERIOD 16384
#define IMPULSE_OFFSET 100
#define IMPULSE_AMP 0.5f
#define TONE_AMP 0.25f

enum { SIG_PULS, SIG_TON };

typedef struct {
    uint64_t t_ns;
    uint32_t nframes;
    float out_peak, ret_peak;
    uint8_t equal_prev, zero;
} Cyc;

static struct {
    int signal;
    uint32_t rate, nframes;
    size_t max_cycles, max_frames;
    Cyc *cyc;
    size_t ncyc, nfr;
    float *raw; /* 3 floats per frame: out L, ret L, ret R */
    float *prev_ret;
    int have_prev;
    uint64_t frame; /* frames processed so far */
    double phase;
    /* fake mode */
    int fake;      /* 0 off, 1 delay, 2 repeat, 3 silence */
    uint32_t fake_delay;
    float *fring_out; /* out history, fake producer reads it */
    float *fring_ret; /* return ring written by the producer */
    size_t fmask;
    _Atomic uint64_t fpub; /* frames published by the cycle */
    _Atomic int stop;
} S;

static inline uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + ts.tv_nsec;
}

/* One cycle: generate the output block, take the return block, log. Same code for JACK and fake mode. */
static void cycle(float *outl, float *outr, const float *retl, const float *retr, uint32_t n) {
    uint64_t t = now_ns();
    if (n > 8192 || S.ncyc >= S.max_cycles || S.nfr + n > S.max_frames) return;
    if (S.ncyc == 0) S.nframes = n; /* the real block size (pipewire-jack reports the default one before the first cycle) */
    float opk = 0, rpk = 0;
    for (uint32_t i = 0; i < n; i++) {
        uint64_t f = S.frame + i;
        float v = 0;
        if (S.signal == SIG_PULS) {
            if (f % IMPULSE_PERIOD == IMPULSE_OFFSET) v = IMPULSE_AMP;
        } else {
            v = TONE_AMP * sinf((float)S.phase);
            S.phase += 2.0 * M_PI * 440.0 / S.rate;
            if (S.phase > 2.0 * M_PI) S.phase -= 2.0 * M_PI;
        }
        outl[i] = outr[i] = v;
        if (fabsf(v) > opk) opk = fabsf(v);
    }
    if (S.fake) {
        for (uint32_t i = 0; i < n; i++) S.fring_out[(S.frame + i) & S.fmask] = outl[i];
        atomic_store(&S.fpub, S.frame + n);
    }
    float *raw = S.raw + 3 * S.nfr;
    for (uint32_t i = 0; i < n; i++) {
        float l = retl[i], r = retr[i];
        raw[3 * i] = outl[i];
        raw[3 * i + 1] = l;
        raw[3 * i + 2] = r;
        if (fabsf(l) > rpk) rpk = fabsf(l);
        if (fabsf(r) > rpk) rpk = fabsf(r);
    }
    Cyc *c = &S.cyc[S.ncyc];
    c->t_ns = t;
    c->nframes = n;
    c->out_peak = opk;
    c->ret_peak = rpk;
    c->zero = rpk == 0.0f;
    c->equal_prev = S.have_prev && memcmp(S.prev_ret, retl, n * sizeof(float)) == 0;
    memcpy(S.prev_ret, retl, n * sizeof(float));
    S.have_prev = 1;
    S.ncyc++;
    S.nfr += n;
    S.frame += n;
}

static jack_port_t *po[2], *pi[2];
static jack_client_t *cl;

static int jack_cb(jack_nframes_t n, void *arg) {
    (void)arg;
    cycle(jack_port_get_buffer(po[0], n), jack_port_get_buffer(po[1], n), jack_port_get_buffer(pi[0], n),
          jack_port_get_buffer(pi[1], n), n);
    return 0;
}

static void jack_down(void *arg) {
    (void)arg;
    atomic_store(&S.stop, 1);
}

static void on_sig(int s) {
    (void)s;
    atomic_store(&S.stop, 1);
}

/* fake producer: copies the published out samples D frames later into the return ring; modes: delay, repeat, silence. */
static void *producer(void *arg) {
    (void)arg;
    uint64_t done = 0;
    uint32_t blk = S.nframes;
    float held[4096];
    long since = 0;
    while (!atomic_load(&S.stop)) {
        uint64_t pub = atomic_load(&S.fpub);
        while (done + blk <= pub) {
            if (S.fake == 1) {
                for (uint32_t i = 0; i < blk; i++) S.fring_ret[(done + i + S.fake_delay) & S.fmask] = S.fring_out[(done + i) & S.fmask];
            } else if (S.fake == 2) { /* hold one block for 5 blocks, then take the next */
                if (since % 5 == 0)
                    for (uint32_t i = 0; i < blk; i++) held[i] = S.fring_out[(done + i) & S.fmask];
                since++;
                for (uint32_t i = 0; i < blk; i++) S.fring_ret[(done + i + S.fake_delay) & S.fmask] = held[i];
            } else {
                for (uint32_t i = 0; i < blk; i++) S.fring_ret[(done + i + S.fake_delay) & S.fmask] = 0;
            }
            done += blk;
        }
        struct timespec ts = {0, 200000};
        nanosleep(&ts, NULL);
    }
    return NULL;
}

static void run_fake(double dauer) {
    S.fmask = (1u << 20) - 1;
    S.fring_out = calloc(S.fmask + 1, sizeof(float));
    S.fring_ret = calloc(S.fmask + 1, sizeof(float));
    pthread_t th;
    pthread_create(&th, NULL, producer, NULL);
    float *ol = calloc(S.nframes, sizeof(float)), *or_ = calloc(S.nframes, sizeof(float));
    float *rl = calloc(S.nframes, sizeof(float)), *rr = calloc(S.nframes, sizeof(float));
    struct timespec next;
    clock_gettime(CLOCK_MONOTONIC, &next);
    uint64_t period = (uint64_t)S.nframes * 1000000000ull / S.rate;
    uint64_t end = now_ns() + (uint64_t)(dauer * 1e9);
    while (!atomic_load(&S.stop) && now_ns() < end) {
        for (uint32_t i = 0; i < S.nframes; i++) rl[i] = rr[i] = S.fring_ret[(S.frame + i) & S.fmask];
        cycle(ol, or_, rl, rr, S.nframes);
        next.tv_nsec += period;
        while (next.tv_nsec >= 1000000000L) { next.tv_nsec -= 1000000000L; next.tv_sec++; }
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, NULL);
    }
    atomic_store(&S.stop, 1);
    pthread_join(th, NULL);
}

static int write_out(const char *prefix) {
    char p[4096];
    snprintf(p, sizeof p, "%s.cyc.csv", prefix);
    FILE *f = fopen(p, "w");
    if (!f) { perror(p); return 1; }
    fprintf(f, "cycle,t_ns,gap_ns,nframes,out_peak,ret_peak,equal_prev,zero\n");
    for (size_t i = 0; i < S.ncyc; i++) {
        Cyc *c = &S.cyc[i];
        fprintf(f, "%zu,%llu,%llu,%u,%.6f,%.6f,%d,%d\n", i, (unsigned long long)c->t_ns,
                (unsigned long long)(i ? c->t_ns - S.cyc[i - 1].t_ns : 0), c->nframes, c->out_peak, c->ret_peak, c->equal_prev, c->zero);
    }
    fclose(f);
    snprintf(p, sizeof p, "%s.raw.f32", prefix);
    f = fopen(p, "wb");
    if (!f) { perror(p); return 1; }
    fwrite(S.raw, sizeof(float), 3 * S.nfr, f);
    fclose(f);
    snprintf(p, sizeof p, "%s.meta.json", prefix);
    f = fopen(p, "w");
    if (!f) { perror(p); return 1; }
    fprintf(f, "{\"rate\": %u, \"nframes\": %u, \"signal\": \"%s\", \"cycles\": %zu, \"frames\": %zu, \"impulse_period\": %d, \"impulse_offset\": %d, \"fake\": %d}\n",
            S.rate, S.nframes, S.signal == SIG_PULS ? "puls" : "ton", S.ncyc, S.nfr, IMPULSE_PERIOD, IMPULSE_OFFSET, S.fake);
    fclose(f);
    return 0;
}

int main(int argc, char **argv) {
    const char *name = "cypherdj-probe", *prefix = NULL, *fake = NULL;
    double dauer = 30;
    S.signal = SIG_PULS;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--name") && i + 1 < argc) name = argv[++i];
        else if (!strcmp(argv[i], "--dauer") && i + 1 < argc) dauer = atof(argv[++i]);
        else if (!strcmp(argv[i], "--prefix") && i + 1 < argc) prefix = argv[++i];
        else if (!strcmp(argv[i], "--signal") && i + 1 < argc) S.signal = !strcmp(argv[++i], "ton") ? SIG_TON : SIG_PULS;
        else if (!strcmp(argv[i], "--fake") && i + 1 < argc) fake = argv[++i];
        else { fprintf(stderr, "usage: ins_probe --prefix P [--name N] [--dauer S] [--signal puls|ton] [--fake delay:N|wdh|stille]\n"); return 2; }
    }
    if (!prefix) { fprintf(stderr, "--prefix required\n"); return 2; }
    signal(SIGTERM, on_sig);
    signal(SIGINT, on_sig);
    S.rate = 48000;
    S.nframes = 64; /* fake default; JACK overrides */
    if (fake) {
        if (!strncmp(fake, "delay:", 6)) { S.fake = 1; S.fake_delay = atoi(fake + 6); }
        else if (!strcmp(fake, "wdh")) { S.fake = 2; S.fake_delay = 300; }
        else if (!strcmp(fake, "stille")) { S.fake = 3; S.fake_delay = 300; }
        else { fprintf(stderr, "unknown --fake %s\n", fake); return 2; }
    } else {
        cl = jack_client_open(name, JackNoStartServer, NULL);
        if (!cl) { fprintf(stderr, "cannot open JACK client %s\n", name); return 3; }
        S.rate = jack_get_sample_rate(cl);
        S.nframes = jack_get_buffer_size(cl);
    }
    S.max_cycles = (size_t)((dauer + 5) * S.rate / (fake ? S.nframes : 32)) + 16; /* real block size unknown until the first cycle: assume >= 32 */
    S.max_frames = (size_t)((dauer + 5) * S.rate * 1.25) + 16384;
    S.cyc = calloc(S.max_cycles, sizeof(Cyc));
    S.raw = calloc(3 * S.max_frames, sizeof(float));
    S.prev_ret = calloc(8192, sizeof(float));
    if (!S.cyc || !S.raw || !S.prev_ret) { fprintf(stderr, "out of memory\n"); return 3; }
    if (fake) {
        run_fake(dauer);
    } else {
        po[0] = jack_port_register(cl, "arr_ins_1_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
        po[1] = jack_port_register(cl, "arr_ins_1_R", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
        pi[0] = jack_port_register(cl, "arr_insret_1_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
        pi[1] = jack_port_register(cl, "arr_insret_1_R", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
        jack_set_process_callback(cl, jack_cb, NULL);
        jack_on_shutdown(cl, jack_down, NULL);
        if (jack_activate(cl)) { fprintf(stderr, "cannot activate\n"); return 3; }
        printf("probe %s rate %u nframes %u ready\n", name, S.rate, S.nframes);
        fflush(stdout);
        uint64_t end = now_ns() + (uint64_t)(dauer * 1e9);
        while (!atomic_load(&S.stop) && now_ns() < end) usleep(20000);
        jack_deactivate(cl);
        jack_client_close(cl);
    }
    return write_out(prefix);
}
