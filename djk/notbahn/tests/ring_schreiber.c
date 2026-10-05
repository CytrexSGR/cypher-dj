/* ring_schreiber: Prüf-Kern für Scheibe 10 (Notbahn daneben, ADR 016 Nachtrag 2026-09-25). Schreibt je Schlag einen
 * Klick (ein Sample 0,5 auf master_L/R, cue still) in den Audio-Ring nach SCHNITTSTELLEN.md §6.1, hält takt_frames und
 * takt_anfang_w, und gibt dasselbe Signal wie der Kern daneben direkt an die Prüf-Senke aus. Tempo fest (--bpm) oder als
 * Rampe (--bpm-bis, --rampe-takte, linear in der Zeit). w setzt über Neustarts fort (Ring besteht schon).
 * --nan-takt K: im Takt K steht im Ring statt des Klicks NaN und ein Sample 4,0 (Clip), am eigenen Ausgang nicht.
 * Aufruf: pw-jack -p 256 ring_schreiber --ziel <präfix> --bpm <b> [--bpm-bis <b2> --rampe-takte <n>] [--nan-takt K]
 * Log auf stdout: "klick <w>" je Schlag, "takt <takt_anfang_w> <takt_frames>" je Takt. Rückgabe 3: Riegel. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <jack/jack.h>
#include <math.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "cypherdj/instanz.h"
#include "cypherdj/ring.h"
#include "riegel.h"

static jack_port_t* aus[2];
static cdj_ring_kopf* ring;
static double bpm0, bpm1, rampe_frames, phase; /* phase in Schlägen seit Start */
static uint64_t s_lauf, schlag_letzt, takt_anfang, takt_vorher;
static long nan_takt = -1;
static volatile sig_atomic_t stop;
static uint64_t log_klick[4096], log_takt[4096][2];
static volatile unsigned n_klick, n_takt;

static void on_sig(int s) { (void)s; stop = 1; }

static int process(jack_nframes_t nf, void* arg) {
  (void)arg;
  float* o[2] = {jack_port_get_buffer(aus[0], nf), jack_port_get_buffer(aus[1], nf)};
  float* d = cdj_ring_daten(ring);
  const uint64_t w = cdj_lade(&ring->w);
  for (jack_nframes_t i = 0; i < nf; i++) {
    const double t = (double)s_lauf;
    const double bpm = (rampe_frames > 0 && t < rampe_frames) ? bpm0 + (bpm1 - bpm0) * t / rampe_frames
                       : (rampe_frames > 0 ? bpm1 : bpm0);
    phase += bpm / (60.0 * CDJ_RING_RATE);
    float x = 0.0f, r = 0.0f;
    const uint64_t schlag = (uint64_t)floor(phase);
    if (schlag != schlag_letzt || s_lauf == 0) {
      schlag_letzt = schlag;
      x = 0.5f;
      r = ((long)(schlag / 4) == nan_takt) ? NAN : 0.5f;
      if (n_klick < 4096) log_klick[n_klick++] = w + i;
      if (schlag % 4 == 0) {
        takt_vorher = takt_anfang;
        takt_anfang = w + i;
        if (n_takt < 4096) { log_takt[n_takt][0] = takt_anfang; log_takt[n_takt][1] = takt_anfang - takt_vorher; n_takt++; }
      }
    } else if ((long)(schlag / 4) == nan_takt && (s_lauf % 997) == 0) r = 4.0f;
    o[0][i] = o[1][i] = x;
    float* f = d + ((w + i) % CDJ_RING_CAP) * CDJ_RING_KANAELE;
    f[0] = f[1] = r;
    f[2] = f[3] = 0.0f;
    s_lauf++;
  }
  if (takt_vorher && takt_anfang > takt_vorher) cdj_setze(&ring->takt_frames, takt_anfang - takt_vorher);
  cdj_setze(&ring->takt_anfang_w, takt_anfang);
  cdj_setze(&ring->w, w + nf);
  return 0;
}

static cdj_ring_kopf* ring_anlegen(const char* ordner) {
  char pfad[200];
  mkdir(ordner, 0700);
  snprintf(pfad, sizeof pfad, "%s/bus", ordner);
  int fd = open(pfad, O_RDWR | O_CREAT, 0600);
  if (fd < 0 || ftruncate(fd, CDJ_RING_BYTES) != 0) return NULL;
  cdj_ring_kopf* r = mmap(NULL, CDJ_RING_BYTES, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (r == MAP_FAILED) return NULL;
  if (!cdj_ring_gueltig(r)) {
    memset(r, 0, CDJ_RING_KOPF);
    memcpy(r->magic, "CDJB", 4);
    r->version = CDJ_RING_VERSION; r->rate = CDJ_RING_RATE; r->kanaele = CDJ_RING_KANAELE; r->cap = CDJ_RING_CAP;
  }
  return r;
}

int main(int argc, char** argv) {
  const char* ziel = NULL;
  double takte_rampe = 0;
  bpm0 = bpm1 = 0;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--ziel") && i + 1 < argc) ziel = argv[++i];
    else if (!strcmp(argv[i], "--bpm") && i + 1 < argc) bpm0 = bpm1 = atof(argv[++i]);
    else if (!strcmp(argv[i], "--bpm-bis") && i + 1 < argc) bpm1 = atof(argv[++i]);
    else if (!strcmp(argv[i], "--rampe-takte") && i + 1 < argc) takte_rampe = atof(argv[++i]);
    else if (!strcmp(argv[i], "--nan-takt") && i + 1 < argc) nan_takt = atol(argv[++i]);
    else { fprintf(stderr, "unbekannt: %s\n", argv[i]); return 2; }
  }
  if (!ziel || bpm0 <= 0) { fprintf(stderr, "Aufruf: ring_schreiber --ziel <präfix> --bpm <b> ...\n"); return 2; }
  char zl[256], zr[256];
  snprintf(zl, sizeof zl, "%sL", ziel);
  snprintf(zr, sizeof zr, "%sR", ziel);
  if (!riegel_erlaubt(zl, 0) || !riegel_erlaubt(zr, 0)) { fprintf(stderr, "Riegel: %s\n", ziel); return 3; }
  /* Rampe linear in der Zeit: mittleres Tempo über die Rampe bestimmt ihre Dauer in Frames */
  if (takte_rampe > 0) rampe_frames = takte_rampe * 4.0 * 60.0 * CDJ_RING_RATE / ((bpm0 + bpm1) / 2.0);
  const char* inst = cdj_instanz();
  char ordner[128], gruppe[64], props[160], name[64];
  cdj_shm_ordner(ordner, sizeof ordner, inst);
  ring = ring_anlegen(ordner);
  if (!ring) { perror("Ring"); return 1; }
  cdj_name(gruppe, sizeof gruppe, "cypherdj", inst);
  snprintf(props, sizeof props, "{ node.group = \"%s\" node.lock-quantum = true }", gruppe);
  setenv("PIPEWIRE_PROPS", props, 1);
  cdj_name(name, sizeof name, "cypherdj-ringschreiber", inst);
  signal(SIGINT, on_sig);
  signal(SIGTERM, on_sig);
  jack_status_t st;
  jack_client_t* cl = jack_client_open(name, JackNoStartServer, &st);
  if (!cl) return 1;
  aus[0] = jack_port_register(cl, "master_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  aus[1] = jack_port_register(cl, "master_R", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  jack_set_process_callback(cl, process, NULL);
  mlockall(MCL_CURRENT | MCL_FUTURE);
  if (jack_activate(cl)) return 1;
  if (jack_connect(cl, jack_port_name(aus[0]), zl) || jack_connect(cl, jack_port_name(aus[1]), zr)) return 1;
  unsigned gk = 0, gt = 0;
  printf("start w %llu bpm %.3f bis %.3f\n", (unsigned long long)cdj_lade(&ring->w), bpm0, bpm1);
  fflush(stdout);
  while (!stop) {
    usleep(20000);
    for (; gk < n_klick; gk++) printf("klick %llu\n", (unsigned long long)log_klick[gk]);
    for (; gt < n_takt; gt++) printf("takt %llu %llu\n", (unsigned long long)log_takt[gt][0], (unsigned long long)log_takt[gt][1]);
    fflush(stdout);
  }
  jack_client_close(cl);
  return 0;
}
