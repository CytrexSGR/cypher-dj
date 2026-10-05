/* cypherdj-notbahn (Scheiben 01 und 10): letzte Meile nach SCHNITTSTELLEN.md §6.1, §8, ADR 016 (Nachtrag 2026-09-25).
 * --daneben: sitzt neben dem Kern am Ausgang und schweigt, solange er schreibt. Ohne: reicht den Ring einen Block
 * versetzt durch wie Scheibe 01, ohne Schleife (bis der Kern eigene Ausgänge hat, 10k). Daneben: steht w einen
 * Zyklus still (ohne verbundene Kante zwei), spielt sie den letzten vollendeten Takt aus ihrem Verlauf; Durchgänge beginnen am fortgesetzten Raster
 * (mittlere Taktlänge aus takt_anfang_w, nicht die ganzzahlige takt_frames: bei 124 BPM liefe die sonst 1,8 Samples in
 * 8 Takten weg). Nach 8 Takten ab einer Takt-Eins 2 Takte Ausblende, bei Rückkehr des Kerns 256 Samples Ausblende.
 * NaN/Inf -> 0 und Clip auf ±1 schon beim Schreiben in den Verlauf. --kante <port>: verbindet den Kern-Port auf den
 * eigenen Eingang, damit der Graph den Kern zuerst rechnet (Probe 2026-09-25: sonst 25 % der Zyklen ein Block früher).
 * Aufruf: pw-jack -p 256 cypherdj-notbahn --master <präfix> [--cue <präfix>] [--daneben] [--kante <port>] [--ton-frei]
 * Rückgabe: 0 regulär, 1 JACK, 2 Aufruf, 3 Riegel (kein JACK-Client). Log auf stderr, JSON-Zähler am Ende. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <jack/jack.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#include "cypherdj/instanz.h"
#include "cypherdj/ring.h"
#include "nb_kanten.h"
#include "nb_osc.h"
#include "riegel.h"

#define VERLAUF (1u << 19) /* 524 288 Frames je Kanal, >= 384 000 (§6.1) */
#define ANF 9              /* gemerkte Takt-Anfänge: 8 Takte für die mittlere Länge */
#define RUECK 256          /* Ausblende bei Rückkehr des Kerns */
static const char* NAMEN[4] = {"master_L", "master_R", "cue_L", "cue_R"};
static jack_client_t* cl;
static jack_port_t *aus[4], *kante;
static cdj_ring_kopf* ring;
static float hist[4][VERLAUF];
static int daneben, zustand, gesehen, bewegt, rueck_rest, stand, kante_ok; /* zustand: 0 wacht, 1 Schleife, 2 aus, 3 Rückgabe */
static uint64_t w_alt, rpos, anf[ANF], h, a_vor, t_letzt, p_anf, p_ende, f_anf, f_ende;
static int n_anf, pass;
static double mittel;
static uint64_t n_zyklen, n_nf, n_andere, n_an, n_rueck, ev_w[64], ev_z[64];
static volatile unsigned n_ev;
static volatile sig_atomic_t stop;

static void on_sig(int s) { (void)s; stop = 1; }
static void ereignis(int z, uint64_t w) { if (n_ev < 64) { ev_z[n_ev] = z; ev_w[n_ev] = w; n_ev++; } zustand = z; }
static float sauber(float x) { return !isfinite(x) ? 0.0f : (x > 1.0f ? 1.0f : (x < -1.0f ? -1.0f : x)); }
static uint64_t durchgang(int j) { return anf[(n_anf - 1) % ANF] + (uint64_t)llround(j * mittel); }

/* Übernahme bei Stillstand von w: letzter vollendeter Takt [a_vor, a_vor + t_letzt), Durchgänge ab dem laufenden Takt */
static void uebernahme(uint64_t w) {
  n_an++;
  const int n = n_anf - 1 < 8 ? n_anf - 1 : 8;
  const uint64_t a = anf[(n_anf - 1) % ANF];
  t_letzt = cdj_lade(&ring->takt_frames);
  a_vor = a - t_letzt;
  mittel = n > 0 ? (double)(a - anf[(n_anf - 1 - n) % ANF]) / n : (double)t_letzt;
  if (fabs(mittel - (double)t_letzt) > 2.0) mittel = (double)t_letzt; /* Tempo ändert sich: das Mittel hinkte nach */
  h = w; pass = 0; p_anf = a; p_ende = durchgang(1);
  int j = 1;
  while (durchgang(j) < w + (uint64_t)(8.0 * mittel)) j++;
  f_anf = durchgang(j); f_ende = durchgang(j + 2);
  ereignis(1, w);
}

static void schleife(float** o, jack_nframes_t nf) {
  for (jack_nframes_t i = 0; i < nf; i++) {
    while (h >= p_ende) { pass++; p_anf = p_ende; p_ende = durchgang(pass + 1); }
    const uint64_t q = (a_vor + (h - p_anf) % t_letzt) % VERLAUF;
    float g = 1.0f;
    if (h >= f_ende) g = 0.0f;
    else if (h >= f_anf) g = 1.0f - (float)(h - f_anf) / (float)(f_ende - f_anf);
    if (zustand == 3) g *= (float)(rueck_rest > 0 ? rueck_rest-- : 0) / RUECK;
    for (int k = 0; k < 4; k++) o[k][i] = g * hist[k][q];
    h++;
  }
  if (zustand == 1 && h >= f_ende) ereignis(2, h);
  if (zustand == 3 && rueck_rest <= 0) ereignis(0, h);
}

static int process(jack_nframes_t nf, void* arg) {
  (void)arg;
  float* o[4];
  for (int k = 0; k < 4; k++) { o[k] = jack_port_get_buffer(aus[k], nf); memset(o[k], 0, nf * sizeof(float)); }
  n_zyklen++;
  cdj_ring_kopf* r = __atomic_load_n(&ring, __ATOMIC_ACQUIRE);
  if (!r) return 0;
  const uint64_t w = cdj_lade(&r->w);
  if (!gesehen) { w_alt = w; gesehen = 1; return 0; }
  if (w != w_alt) {
    if (w - w_alt == nf) n_nf++; else n_andere++;
    if (!rpos) rpos = w - nf;
    const float* d = cdj_ring_daten_c(r);
    for (uint64_t f = (w - w_alt > CDJ_RING_CAP ? w - CDJ_RING_CAP : w_alt); f < w; f++)
      for (int k = 0; k < 4; k++) hist[k][f % VERLAUF] = sauber(d[(f % CDJ_RING_CAP) * CDJ_RING_KANAELE + k]);
    const uint64_t ta = cdj_lade(&r->takt_anfang_w);
    if (n_anf == 0 || anf[(n_anf - 1) % ANF] != ta) anf[n_anf++ % ANF] = ta;
    stand = 0;
    if (bewegt < 2) bewegt++;
    if (bewegt >= 2 && zustand == 1) { n_rueck++; rueck_rest = RUECK; ereignis(3, h); }
    else if (bewegt >= 2 && zustand == 2) { n_rueck++; ereignis(0, w); }
    w_alt = w;
  } else {
    bewegt = 0;
    stand++; /* ohne Kante kann ein Reihenfolge-Wechsel w einen Zyklus lang stehen lassen: dann 2 Zyklen verlangen */
    const int kok = __atomic_load_n(&kante_ok, __ATOMIC_RELAXED);
    if (daneben && zustand == 0 && stand >= (kok ? 1 : 2) && n_anf >= 2 && cdj_lade(&r->takt_frames) > 0) uebernahme(w);
  }
  if (zustand == 1 || zustand == 3) schleife(o, nf);
  else if (zustand == 0 && !daneben && rpos && w - rpos >= nf) { /* Scheibe 01: Leserregel wie dort */
    if (w - rpos > 3u * nf) rpos = w - nf;
    for (jack_nframes_t i = 0; i < nf; i++)
      for (int k = 0; k < 4; k++) o[k][i] = hist[k][(rpos + i) % VERLAUF];
    rpos += nf;
  }
  return 0;
}

static int ring_einbinden(const char* pfad) {
  int fd = open(pfad, O_RDONLY);
  if (fd < 0) return 0;
  struct stat st;
  if (fstat(fd, &st) != 0 || st.st_size != (off_t)CDJ_RING_BYTES) { close(fd); return 0; }
  void* p = mmap(NULL, CDJ_RING_BYTES, PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  if (p == MAP_FAILED) return 0;
  if (!cdj_ring_gueltig((const cdj_ring_kopf*)p)) { munmap(p, CDJ_RING_BYTES); return 0; }
  mlock(p, CDJ_RING_BYTES);
  __atomic_store_n(&ring, (cdj_ring_kopf*)p, __ATOMIC_RELEASE);
  return 1;
}

int main(int argc, char** argv) {
  const char* inst = cdj_instanz();
  if (cdj_instanz_k(inst) < 0) { fprintf(stderr, "CYPHERDJ_INSTANZ='%s' ungültig\n", inst); return 2; }
  const char *master = NULL, *cue = NULL, *kante_von = NULL;
  int ton_frei = 0, falsch = 0;
  for (int i = 1; i < argc && !falsch; i++) {
    if (!strcmp(argv[i], "--master") && i + 1 < argc) master = argv[++i];
    else if (!strcmp(argv[i], "--cue") && i + 1 < argc) cue = argv[++i];
    else if (!strcmp(argv[i], "--kante") && i + 1 < argc) kante_von = argv[++i];
    else if (!strcmp(argv[i], "--daneben")) daneben = 1;
    else if (!strcmp(argv[i], "--ton-frei")) ton_frei = 1;
    else falsch = 1;
  }
  if (!master || falsch) {
    fprintf(stderr, "Aufruf: cypherdj-notbahn --master <präfix> [--cue <präfix>] [--daneben] [--kante <port>] [--ton-frei]\n");
    return 2;
  }
  char ziel[4][256];
  const int n_ziele = cue ? 4 : 2;
  for (int k = 0; k < 4; k++) snprintf(ziel[k], sizeof ziel[k], "%s%s", k < 2 ? master : (cue ? cue : ""), k % 2 ? "R" : "L");
  for (int k = 0; k < n_ziele; k++)
    if (!riegel_erlaubt(ziel[k], ton_frei)) { fprintf(stderr, "Riegel: %s ohne --ton-frei\n", ziel[k]); return 3; }
  char gruppe[64], props[160], name[64], ordner[128], pfad[160];
  cdj_name(gruppe, sizeof gruppe, "cypherdj", inst);
  snprintf(props, sizeof props, "{ node.group = \"%s\" node.lock-quantum = true }", gruppe);
  setenv("PIPEWIRE_PROPS", props, 1);
  cdj_name(name, sizeof name, "cypherdj-notbahn", inst);
  cdj_shm_ordner(ordner, sizeof ordner, inst);
  snprintf(pfad, sizeof pfad, "%s/bus", ordner);
  signal(SIGINT, on_sig);
  signal(SIGTERM, on_sig);
  jack_status_t st;
  if (!(cl = jack_client_open(name, JackNoStartServer, &st))) { fprintf(stderr, "kein JACK-Server\n"); return 1; }
  for (int k = 0; k < 4; k++) aus[k] = jack_port_register(cl, NAMEN[k], JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  kante = jack_port_register(cl, "kante", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
  jack_set_process_callback(cl, process, NULL);
  if (jack_activate(cl)) return 1;
  mlockall(MCL_CURRENT | MCL_FUTURE);
  for (int k = 0; k < n_ziele; k++)
    if (jack_connect(cl, jack_port_name(aus[k]), ziel[k])) { fprintf(stderr, "Verbinden %s gescheitert\n", ziel[k]); return 1; }
  fprintf(stderr, "%s läuft: master %s, %s, Kante %s\n", jack_get_client_name(cl), master, daneben ? "daneben" : "in Reihe",
          kante_von ? kante_von : "-");
  unsigned ge = 0;
  int fd = socket(AF_INET, SOCK_DGRAM, 0), z_alt = -1, ports[2] = {cdj_port(47110, inst), cdj_port(47140, inst)};
  long tick = 0;
  while (!stop) {
    const int z = zustand;
    cdj_ring_kopf* rg = __atomic_load_n(&ring, __ATOMIC_ACQUIRE);
    if (z != z_alt || tick++ % 100 == 0)   /* bei jeder Änderung und 1 Hz (§5.10) */
      nb_osc_senden(fd, ports, 2, z, z == 1 || z == 3 ? pass : 0, (int32_t)n_rueck, rg ? cdj_lade(&rg->w) : 0);
    z_alt = z;
    if (!__atomic_load_n(&ring, __ATOMIC_ACQUIRE)) ring_einbinden(pfad);
    const int k_ok = kante_von && jack_port_connected(kante);
    if (kante_von && !k_ok) jack_connect(cl, kante_von, jack_port_name(kante));
    __atomic_store_n(&kante_ok, k_ok, __ATOMIC_RELAXED);
    nb_nachverbinden(cl, aus, ziel, n_ziele); /* F05 */
    for (; ge < n_ev; ge++) fprintf(stderr, "zustand %llu w %llu\n", (unsigned long long)ev_z[ge], (unsigned long long)ev_w[ge]);
    usleep(10000);
  }
  jack_deactivate(cl);
  jack_client_close(cl);
  fprintf(stderr, "{\"zyklen\":%llu,\"abstand_nf\":%llu,\"abstand_andere\":%llu,\"uebernahmen\":%llu,\"rueckgaben\":%llu}\n",
          (unsigned long long)n_zyklen, (unsigned long long)n_nf, (unsigned long long)n_andere, (unsigned long long)n_an,
          (unsigned long long)n_rueck);
  return 0;
}
