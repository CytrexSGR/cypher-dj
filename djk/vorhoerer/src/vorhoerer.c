/* cypherdj-vorhoerer: nativer Vorhörer für Werkzeuge, deren Oberfläche nur noch anzeigt (Andreas 2026-09-26: „wir sollten
 * uns langsam davon lösen das der browser die audioausgabe mache. das muss seperat eben wegen echtzeit erfolgen. browser
 * dann nur anzeige dann“). Erster Nutzer: djk/cues. Stand und Messungen: docs/architektur/stand/vorhoerer.md.
 *
 * JACK-Client „cypherdj-vorhoerer“ mit aus_L/aus_R. Eine Datei wird im Lade-Faden per ffmpeg in den Speicher dekodiert
 * (float32 stereo, Rate des JACK-Graphen, ffmpeg-Vorgabe: MP3-Encoder-Vorlauf abgeschnitten wie in djk/cues/welle.ts)
 * und dem Callback lock-frei übergeben (ein Zeiger, atomar getauscht; Freigabe der alten Spur im Hauptfaden).
 * Im Callback keine Allokation, keine Sperre, kein Systemaufruf: Befehle kommen über einen SPSC-Ring.
 * Steuerung OSC/UDP auf 127.0.0.1:47740 (+1000·k je Prüfinstanz, instanz.h): /v/laden s · /v/play · /v/pause ·
 * /v/springe d · /v/loop d d · /v/loop_aus · /v/blende i · /v/hallo [i Port]. Meldungen an die Abonnenten:
 * /v/position ,dh (Dateisekunde des ersten Samples im laufenden Zyklus, JACK-Frame-Zeit dieses Zyklusanfangs) mit 30 Hz,
 * /v/geladen ,sd, /v/fehler ,s. Loop sample-genau im Callback (Rücksprung genau am Sample B, 64 Samples Überblendung,
 * abschaltbar mit --ohne-blende oder /v/blende 0). Ausgang nur an --ausgang <präfix> hinter dem Riegel (riegel.h);
 * ohne --ausgang verbindet er nichts. Kein Ton ohne /v/play; nach /v/laden steht er.
 * Aufruf: pw-jack -p 256 cypherdj-vorhoerer [--ausgang <präfix>] [--ton-frei] [--port N] [--ohne-blende]
 * Rückgabe: 0 regulär, 1 JACK/Netz, 2 Aufruf, 3 Riegel. Übersetzt mit -DVORHOERER_MUTANTE_BLOCK entsteht die Messmutante,
 * die den Loop-Rücksprung am Blockanfang statt am Sample B ausführt. */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <jack/jack.h>
#include <math.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "cypherdj/instanz.h"
#include "cypherdj/riegel.h"
#include "v_osc.h"

extern char** environ;

#define BLENDE 64
#define RING 256
#define ABOS 4

typedef struct { float* d; uint64_t n; double dauer; char pfad[1024]; } spur;
enum { B_PLAY = 1, B_PAUSE, B_SPRINGE, B_LOOP, B_LOOP_AUS, B_BLENDE };
typedef struct { int typ; int64_t a, b; } befehl;

static jack_client_t* cl;
static jack_port_t* aus[2];
static uint32_t rate;
static volatile sig_atomic_t stop;

/* Übergabe Lade-Faden → Callback → Hauptfaden */
static _Atomic(spur*) wartend, alt;
/* Befehle Hauptfaden → Callback */
static befehl ring[RING];
static _Atomic uint32_t r_kopf, r_schwanz;
/* Positions-Seqlock Callback → Hauptfaden */
static _Atomic uint32_t seq;
static _Atomic uint64_t pub_pos, pub_frame, pub_spielt;
static _Atomic uint64_t n_zyklen, n_xruns, n_rueck, n_verworfen;

/* Zustand, nur im Callback */
static spur* akt;
static uint64_t pos, la, lb, bq, merk;
static int spielt, loop_an, ohne_blende, b_rest, ein_rest, aus_rest;

static void on_sig(int s) { (void)s; stop = 1; }
static int on_xrun(void* a) { (void)a; atomic_fetch_add_explicit(&n_xruns, 1, memory_order_relaxed); return 0; }

static int senden(int typ, int64_t a, int64_t b) {
  const uint32_t k = atomic_load_explicit(&r_kopf, memory_order_relaxed);
  if (k - atomic_load_explicit(&r_schwanz, memory_order_acquire) >= RING) { atomic_fetch_add(&n_verworfen, 1); return -1; }
  ring[k % RING] = (befehl){typ, a, b};
  atomic_store_explicit(&r_kopf, k + 1, memory_order_release);
  return 0;
}

static void ausfuehren(const befehl* b) {
  const uint64_t n = akt ? akt->n : 0;
  switch (b->typ) {
    case B_PLAY:
      if (akt && !spielt && pos < n) { spielt = 1; ein_rest = ohne_blende ? 0 : BLENDE; aus_rest = 0; }
      break;
    case B_PAUSE:
      if (spielt && !aus_rest) {
        if (ohne_blende) spielt = 0;
        else { aus_rest = BLENDE; merk = pos; }
      }
      break;
    case B_SPRINGE: {
      const uint64_t z = b->a < 0 ? 0 : ((uint64_t)b->a > n ? n : (uint64_t)b->a);
      if (spielt && !ohne_blende) { bq = pos; b_rest = BLENDE; }
      if (aus_rest) { aus_rest = 0; spielt = 0; }
      pos = z;
      break;
    }
    case B_LOOP:
      if (b->a >= 0 && b->a < b->b && (uint64_t)b->b <= n) { la = (uint64_t)b->a; lb = (uint64_t)b->b; loop_an = 1; }
      break;
    case B_LOOP_AUS: loop_an = 0; break;
    case B_BLENDE: ohne_blende = !b->a; break;
  }
}

static int process(jack_nframes_t nf, void* arg) {
  (void)arg;
  float* o[2] = {jack_port_get_buffer(aus[0], nf), jack_port_get_buffer(aus[1], nf)};
  atomic_fetch_add_explicit(&n_zyklen, 1, memory_order_relaxed);
  if (!atomic_load_explicit(&alt, memory_order_acquire)) {
    spur* p = atomic_exchange_explicit(&wartend, NULL, memory_order_acq_rel);
    if (p) {
      atomic_store_explicit(&alt, akt, memory_order_release);
      akt = p; pos = 0; spielt = 0; loop_an = 0; b_rest = ein_rest = aus_rest = 0;
    }
  }
  uint32_t s = atomic_load_explicit(&r_schwanz, memory_order_relaxed);
  const uint32_t k = atomic_load_explicit(&r_kopf, memory_order_acquire);
  for (; s != k; s++) ausfuehren(&ring[s % RING]);
  atomic_store_explicit(&r_schwanz, s, memory_order_release);

  const uint32_t q0 = atomic_load_explicit(&seq, memory_order_relaxed);
  atomic_store_explicit(&seq, q0 + 1, memory_order_relaxed);
  atomic_thread_fence(memory_order_release);
  atomic_store_explicit(&pub_pos, pos, memory_order_relaxed);
  atomic_store_explicit(&pub_frame, jack_last_frame_time(cl), memory_order_relaxed);
  atomic_store_explicit(&pub_spielt, (uint64_t)spielt, memory_order_relaxed);
  atomic_store_explicit(&seq, q0 + 2, memory_order_release);

#ifdef VORHOERER_MUTANTE_BLOCK
  /* Mutante: der Rücksprung fällt auf den Blockanfang, sobald B in diesen Block fiele */
  if (spielt && loop_an && pos < lb && pos + nf > lb) { pos = la; atomic_fetch_add_explicit(&n_rueck, 1, memory_order_relaxed); }
#endif
  const float* d = akt ? akt->d : NULL;
  const uint64_t n = akt ? akt->n : 0;
  for (jack_nframes_t i = 0; i < nf; i++) {
    float l = 0.0f, r = 0.0f;
    if (spielt && pos >= n) spielt = 0;
    if (spielt) {
      l = d[2 * pos]; r = d[2 * pos + 1];
      if (b_rest > 0) {
        const float g = (float)b_rest / (BLENDE + 1);
        if (bq < n) { l = l * (1.0f - g) + d[2 * bq] * g; r = r * (1.0f - g) + d[2 * bq + 1] * g; }
        else { l *= 1.0f - g; r *= 1.0f - g; }
        bq++; b_rest--;
      }
      if (ein_rest > 0) { const float g = 1.0f - (float)ein_rest / (BLENDE + 1); l *= g; r *= g; ein_rest--; }
      if (aus_rest > 0) {
        const float g = (float)aus_rest / (BLENDE + 1);
        l *= g; r *= g;
        if (--aus_rest == 0) { spielt = 0; pos = merk; o[0][i] = l; o[1][i] = r; continue; }
      }
      pos++;
      if (loop_an && pos == lb) {
        if (!ohne_blende) { bq = lb; b_rest = BLENDE; }
        pos = la;
        atomic_fetch_add_explicit(&n_rueck, 1, memory_order_relaxed);
      }
    }
    o[0][i] = l; o[1][i] = r;
  }
  return 0;
}

/* ---------- Lade-Faden ---------- */
static pthread_mutex_t mx = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t cv = PTHREAD_COND_INITIALIZER;
static char wunsch[1024];
static int wunsch_da;
static char meldung[8][1100]; /* 'g' geladen / 'f' fehler, dann Text; Dauer hinter \t */
static int n_meldung;

static void melden(const char* m) {
  pthread_mutex_lock(&mx);
  if (n_meldung < 8) snprintf(meldung[n_meldung++], sizeof meldung[0], "%s", m);
  pthread_mutex_unlock(&mx);
}

static void spur_frei(spur* p) {
  if (!p) return;
  munlock(p->d, p->n * 2 * sizeof(float));
  free(p->d);
  free(p);
}

static spur* dekodieren(const char* pfad, char* fehler, size_t nf) {
  if (access(pfad, R_OK) != 0) { snprintf(fehler, nf, "Datei nicht lesbar: %s", pfad); return NULL; }
  char r[16];
  snprintf(r, sizeof r, "%u", rate);
  char* argv[] = {"ffmpeg", "-nostdin", "-v", "error", "-i", (char*)pfad, "-map", "0:a:0", "-ac", "2", "-ar", r,
                  "-f", "f32le", "pipe:1", NULL};
  int rohr[2];
  if (pipe2(rohr, O_CLOEXEC) != 0) { snprintf(fehler, nf, "pipe: %s", strerror(errno)); return NULL; }
  posix_spawn_file_actions_t fa;
  posix_spawn_file_actions_init(&fa);
  posix_spawn_file_actions_adddup2(&fa, rohr[1], 1);
  posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
  pid_t pid;
  const int e = posix_spawnp(&pid, "ffmpeg", &fa, NULL, argv, environ);
  posix_spawn_file_actions_destroy(&fa);
  close(rohr[1]);
  if (e) { close(rohr[0]); snprintf(fehler, nf, "ffmpeg nicht startbar: %s", strerror(e)); return NULL; }
  size_t kap = (size_t)rate * 2 * sizeof(float) * 60, len = 0;
  char* b = malloc(kap);
  for (;;) {
    if (len == kap) { char* nb = b ? realloc(b, kap *= 2) : NULL; if (!nb) { free(b); b = NULL; break; } b = nb; }
    if (!b) break;
    const ssize_t k = read(rohr[0], b + len, kap - len);
    if (k < 0 && errno == EINTR) continue;
    if (k <= 0) break;
    len += (size_t)k;
  }
  close(rohr[0]);
  int st = 0;
  waitpid(pid, &st, 0);
  const uint64_t frames = len / (2 * sizeof(float));
  if (!b || !WIFEXITED(st) || WEXITSTATUS(st) != 0 || frames == 0) {
    free(b);
    snprintf(fehler, nf, "ffmpeg rc %d, %llu Frames: %s", WIFEXITED(st) ? WEXITSTATUS(st) : -1,
             (unsigned long long)frames, pfad);
    return NULL;
  }
  spur* p = calloc(1, sizeof *p);
  void* t = realloc(b, frames * 2 * sizeof(float)); /* Überhang aus der Verdopplung zurückgeben */
  if (t) b = t;
  p->d = (float*)b;
  p->n = frames;
  p->dauer = (double)frames / rate;
  snprintf(p->pfad, sizeof p->pfad, "%s", pfad);
  if (mlock(p->d, frames * 2 * sizeof(float)) != 0) fprintf(stderr, "mlock %s: %s\n", pfad, strerror(errno));
  return p;
}

static void* lader(void* a) {
  (void)a;
  char pfad[1024], fehler[1000], m[1100];
  for (;;) {
    pthread_mutex_lock(&mx);
    while (!wunsch_da && !stop) pthread_cond_wait(&cv, &mx);
    if (stop) { pthread_mutex_unlock(&mx); return NULL; }
    snprintf(pfad, sizeof pfad, "%s", wunsch);
    wunsch_da = 0;
    pthread_mutex_unlock(&mx);
    spur* p = dekodieren(pfad, fehler, sizeof fehler);
    if (!p) { snprintf(m, sizeof m, "f%s", fehler); melden(m); continue; }
    spur_frei(atomic_exchange_explicit(&wartend, p, memory_order_acq_rel)); /* nie vom Callback gesehen */
    snprintf(m, sizeof m, "g%.1000s\t%.6f", p->pfad, p->dauer);
    melden(m);
  }
}

/* ---------- Hauptfaden: OSC ---------- */
static struct sockaddr_in abo[ABOS];
static int n_abo;

static void an_alle(int fd, const v_osc_puffer* p) {
  if (!p->ok) return;
  for (int i = 0; i < n_abo; i++) sendto(fd, p->b, (size_t)p->n, 0, (const struct sockaddr*)&abo[i], sizeof abo[i]);
}

static void fehler_melden(int fd, const char* t) {
  v_osc_puffer p;
  v_osc_neu(&p, "/v/fehler", ",s");
  v_anh_s(&p, t);
  an_alle(fd, &p);
  fprintf(stderr, "fehler: %s\n", t);
}

static int64_t frames_aus(double s) { return (int64_t)llround(s * rate); }

static void empfangen(int fd, const unsigned char* b, int n, const struct sockaddr_in* von) {
  v_osc_nachricht m;
  if (v_osc_lesen(b, n, &m) != 0) { fehler_melden(fd, "OSC-Formfehler"); return; }
  const char* a = m.adresse;
  const int zahlen = m.n >= 1 && m.w[0].t != 's';
  if (!strcmp(a, "/v/hallo")) {
    struct sockaddr_in z = *von;
    if (m.n >= 1 && m.w[0].t != 's') z.sin_port = htons((uint16_t)m.w[0].i);
    for (int i = 0; i < n_abo; i++)
      if (abo[i].sin_port == z.sin_port && abo[i].sin_addr.s_addr == z.sin_addr.s_addr) return;
    if (n_abo == ABOS) memmove(abo, abo + 1, sizeof abo[0] * (ABOS - 1)), n_abo--;
    abo[n_abo++] = z;
    fprintf(stderr, "abonnent %s:%u\n", inet_ntoa(z.sin_addr), ntohs(z.sin_port));
  } else if (!strcmp(a, "/v/laden") && m.n == 1 && m.w[0].t == 's') {
    pthread_mutex_lock(&mx);
    snprintf(wunsch, sizeof wunsch, "%s", m.w[0].s);
    wunsch_da = 1;
    pthread_cond_signal(&cv);
    pthread_mutex_unlock(&mx);
  } else if (!strcmp(a, "/v/play")) senden(B_PLAY, 0, 0);
  else if (!strcmp(a, "/v/pause")) senden(B_PAUSE, 0, 0);
  else if (!strcmp(a, "/v/loop_aus")) senden(B_LOOP_AUS, 0, 0);
  else if (!strcmp(a, "/v/springe") && m.n == 1 && zahlen) senden(B_SPRINGE, frames_aus(m.w[0].d), 0);
  else if (!strcmp(a, "/v/loop") && m.n == 2 && zahlen && m.w[1].t != 's') {
    const int64_t fa = frames_aus(m.w[0].d), fb = frames_aus(m.w[1].d);
    if (fa < 0 || fb <= fa) { fehler_melden(fd, "/v/loop: A < B verlangt"); return; }
    senden(B_LOOP, fa, fb);
  } else if (!strcmp(a, "/v/blende") && m.n == 1 && zahlen) senden(B_BLENDE, m.w[0].i != 0, 0);
  else {
    char t[200];
    snprintf(t, sizeof t, "unbekannt oder falsche Argumente: %.120s ,%.20s", a, m.typen);
    fehler_melden(fd, t);
  }
}

static int64_t mono_ns(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000 + t.tv_nsec;
}

int main(int argc, char** argv) {
  const char* inst = cdj_instanz();
  if (cdj_instanz_k(inst) < 0) { fprintf(stderr, "CYPHERDJ_INSTANZ='%s' ungültig\n", inst); return 2; }
  const char* ausgang = NULL;
  int ton_frei = 0, falsch = 0, port = cdj_port(47740, inst);
  for (int i = 1; i < argc && !falsch; i++) {
    if (!strcmp(argv[i], "--ausgang") && i + 1 < argc) ausgang = argv[++i];
    else if (!strcmp(argv[i], "--port") && i + 1 < argc) port = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--ton-frei")) ton_frei = 1;
    else if (!strcmp(argv[i], "--ohne-blende")) ohne_blende = 1;
    else falsch = 1;
  }
  if (falsch || port <= 0 || port > 65535) {
    fprintf(stderr, "Aufruf: cypherdj-vorhoerer [--ausgang <präfix>] [--ton-frei] [--port N] [--ohne-blende]\n");
    return 2;
  }
  char ziel[2][256];
  for (int k = 0; k < 2 && ausgang; k++) {
    snprintf(ziel[k], sizeof ziel[k], "%s%s", ausgang, k ? "R" : "L");
    if (!riegel_erlaubt(ziel[k], ton_frei)) { fprintf(stderr, "Riegel: %s ohne --ton-frei\n", ziel[k]); return 3; }
  }
  const int fd = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, 0);
  struct sockaddr_in an = {.sin_family = AF_INET, .sin_port = htons((uint16_t)port)};
  an.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (fd < 0 || bind(fd, (struct sockaddr*)&an, sizeof an) != 0) { fprintf(stderr, "Port %d: %s\n", port, strerror(errno)); return 1; }

  char gruppe[64], props[160], name[64];
  cdj_name(gruppe, sizeof gruppe, "cypherdj", inst);
  snprintf(props, sizeof props, "{ node.group = \"%s\" node.lock-quantum = true }", gruppe);
  setenv("PIPEWIRE_PROPS", props, 1);
  cdj_name(name, sizeof name, "cypherdj-vorhoerer", inst);
  struct sigaction sa = {.sa_handler = on_sig};
  sigaction(SIGINT, &sa, NULL);
  sigaction(SIGTERM, &sa, NULL);
  signal(SIGPIPE, SIG_IGN);
  jack_status_t st;
  if (!(cl = jack_client_open(name, JackNoStartServer | JackUseExactName, &st))) { fprintf(stderr, "kein JACK-Server oder Name belegt\n"); return 1; }
  rate = jack_get_sample_rate(cl);
  aus[0] = jack_port_register(cl, "aus_L", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  aus[1] = jack_port_register(cl, "aus_R", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  jack_set_process_callback(cl, process, NULL);
  jack_set_xrun_callback(cl, on_xrun, NULL);
  if (jack_activate(cl)) return 1;
  mlockall(MCL_CURRENT);
  for (int k = 0; k < 2 && ausgang; k++)
    if (jack_connect(cl, jack_port_name(aus[k]), ziel[k])) { fprintf(stderr, "Verbinden %s gescheitert\n", ziel[k]); jack_client_close(cl); return 1; }
  pthread_t lt;
  pthread_create(&lt, NULL, lader, NULL);
  fprintf(stderr, "%s läuft: Rate %u, OSC 127.0.0.1:%d, Ausgang %s, Blende %s%s\n", jack_get_client_name(cl), rate, port,
          ausgang ? ausgang : "(keiner)", ohne_blende ? "aus" : "an",
#ifdef VORHOERER_MUTANTE_BLOCK
          ", MUTANTE Rücksprung am Blockanfang"
#else
          ""
#endif
  );
  const int64_t takt = 1000000000 / 30;
  int64_t naechst = mono_ns() + takt;
  unsigned char b[V_OSC_MAX + 1];
  while (!stop) {
    int64_t warte = (naechst - mono_ns()) / 1000000;
    struct pollfd pf = {.fd = fd, .events = POLLIN};
    if (poll(&pf, 1, warte > 0 ? (int)warte : 0) > 0) {
      struct sockaddr_in von;
      socklen_t vl = sizeof von;
      const ssize_t n = recvfrom(fd, b, V_OSC_MAX, 0, (struct sockaddr*)&von, &vl);
      if (n > 0) empfangen(fd, b, (int)n, &von);
    }
    spur_frei(atomic_exchange_explicit(&alt, NULL, memory_order_acq_rel));
    pthread_mutex_lock(&mx);
    for (int i = 0; i < n_meldung; i++) {
      v_osc_puffer p;
      if (meldung[i][0] == 'g') {
        char* tab = strrchr(meldung[i] + 1, '\t');
        *tab = 0;
        v_osc_neu(&p, "/v/geladen", ",sd");
        v_anh_s(&p, meldung[i] + 1);
        v_anh_d(&p, atof(tab + 1));
        an_alle(fd, &p);
        fprintf(stderr, "geladen %s %s s\n", meldung[i] + 1, tab + 1);
      } else fehler_melden(fd, meldung[i] + 1);
    }
    n_meldung = 0;
    pthread_mutex_unlock(&mx);
    if (mono_ns() >= naechst) {
      naechst += takt;
      if (naechst < mono_ns()) naechst = mono_ns() + takt;
      uint64_t ps, fr;
      uint32_t q1, q2;
      do {
        q1 = atomic_load_explicit(&seq, memory_order_acquire);
        ps = atomic_load_explicit(&pub_pos, memory_order_relaxed);
        fr = atomic_load_explicit(&pub_frame, memory_order_relaxed);
        atomic_thread_fence(memory_order_acquire);
        q2 = atomic_load_explicit(&seq, memory_order_relaxed);
      } while (q1 != q2 || (q1 & 1));
      if (q1 == 0) continue; /* noch kein Zyklus */
      v_osc_puffer p;
      v_osc_neu(&p, "/v/position", ",dh");
      v_anh_d(&p, (double)ps / rate);
      v_anh_h(&p, (int64_t)(uint32_t)fr);
      an_alle(fd, &p);
    }
  }
  pthread_mutex_lock(&mx);
  pthread_cond_signal(&cv);
  pthread_mutex_unlock(&mx);
  jack_deactivate(cl);
  jack_client_close(cl);
  fprintf(stderr, "{\"zyklen\":%llu,\"xruns\":%llu,\"rueckspruenge\":%llu,\"befehle_verworfen\":%llu}\n",
          (unsigned long long)n_zyklen, (unsigned long long)n_xruns, (unsigned long long)n_rueck,
          (unsigned long long)n_verworfen);
  return 0;
}
