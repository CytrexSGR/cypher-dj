// cypherdj-kern, Scheibe 01, 08, 18 und 25: JACK-Client unter pw-jack, eine Uhr, Befehle mit Quittungen, Tempo-Rampen,
// Telemetrie, Prüfklick, Audio-Ring und eigene Ausgänge (10k); Neustart-Zustand, Fortsetzen auf dem Anker, sd_notify (18).
// Aufruf: pw-jack -p 256 cypherdj-kern [--konfig <kern.toml>] [--pruefmodus] [--start-bpm 128] [--udp-port N]
//         [--test-last-alle N --test-last-perioden F]   (nur mit Prüfmodus: künstliche Callback-Last, 10 K1b)
//         [--pruef-cue] [--ohne-zustand]                  (nur mit Prüfmodus, Scheibe 18: Prüfsignal auf dem Cue;
//                                                          Neustart ohne Zustand wie Scheibe 08, Fehlerfall)
//         [--test-lader-ohne-sperre]                      (nur mit Prüfmodus, Scheibe 31: Lader ohne MAP_POPULATE,
//                                                          mlock und sha256, so berührt der Callback die Seiten als
//                                                          Erster: Fehlerfall der Seitenfehler-Zählung M8)
// Scheibe 31: Lade-Faden (lader.h) für /k/deck/laden, /k/deck/entladen; Seitenfehler des Callbacks in der Schlusszeile.
// Scheibe 31, Neustart: das Material der Decks aus dem Neustart-Zustand vor dem ersten Zyklus wieder eingeblendet.
// Scheibe 35 (Teil A): JACK-MIDI-Eingang hand_in; Mapping beim Start aus <Konfig-Ordner nach Z2>/controller/
// <controller_geraet>.json (fehlt oder bricht es: Kern ohne Controller, kein Startfehler); Verbinder im Hauptfaden beim
// Start und alle 500 ms (quelle_port des Mappings -> hand_in, jede neue Verbindung: erster Wert nur Stellung).
//         [--waechter-ms N]                               (Scheibe 18: Selbst-Wächter, tötet bei N ms Stillstand)
// Konfiguration: kern.toml nach INTERFACES.md §2.1 (Vorgabe ~/.config/cypherdj[-<i>]/kern.toml; fehlt sie, gelten
// die Vorgaben aus §2.1), Aufrufparameter gehen vor. Rückgabe 2: Aufruf- oder Konfigurationsfehler (Startfehler).
// Ausgänge (Scheibe 10k, ADR 016 Nachtrag 2026-09-25): master_L/R, cue_L/R mit Riegel und Einblende; mit --master
// <präfix> [--cue <präfix>] verbindet der Kern sie selbst (nur stumm/cypherdj-pruef-*, sonst --ton-frei), ohne bleiben
// sie unverbunden und der Ton geht wie in Scheibe 01 über Ring und Notbahn. Umgebung: CYPHERDJ_INSTANZ (Z2).
#include <fcntl.h>
#include <jack/jack.h>
#include <jack/midiport.h>
#include <pthread.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <map>
#include <set>
#include <string>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <memory>
#include <string>
#include <thread>
#include <utility>

#include "cypherdj/ausgang.h"
#include "cypherdj/erzeuger.h"
#include "cypherdj/huellen.h"
#include "cypherdj/instanz.h"
#include "cypherdj/kanten.h"
#include "cypherdj/kern.h"
#include "cypherdj/konfig.h"
#include "cypherdj/arr_lader.h"
#include "cypherdj/graph_werk.h"
#include "cypherdj/warp_werk.h"
#include "cypherdj/lader.h"
#include "cypherdj/midi_ausgabe.h"
#include "cypherdj/netz.h"
#include "cypherdj/riegel.h"
#include "cypherdj/neustart.h"
#include "cypherdj/ring.h"
#include "cypherdj/selbstwaechter.h"
#include "cypherdj/telemetrie.h"
#include "cypherdj/wachhund.h"
#include "hand/mapping.h"

static std::atomic<bool> g_stop{false};
static char g_faehig_pfad[160] = "";  // S7: kern-faehigkeiten.json, beim sauberen Ende gelöscht (kein Rest mit toter PID)
static jack_client_t* g_client = nullptr;
static cdj::Kern* g_kern = nullptr;
static cdj::Zyklusmesser* g_messer = nullptr;
static cdj_ring_kopf* g_ring = nullptr;
static jack_port_t* g_aus[4];
static uint64_t g_eingeblendet = 0;  // nur im Callback
static cdj::Betrieb* g_betrieb = nullptr;  // Scheibe 18
static std::atomic<int> g_cb_tid{0};       // Scheibe 31: Faden des Callbacks, für die Seitenfehler-Zählung (M8)
static jack_port_t* g_notbahn_vor = nullptr;  // nie gelesen, Ziel der Notbahn-Kante (--vor)
static std::atomic<int> g_cb_prio{-1};     // Keylock Task 2.5 (Vertrag 12): Echtzeit-Priorität des JACK-Fadens, 0 ohne
static std::atomic<uint64_t> g_graph_ereignisse{0};  // Fixup M1: Zähler für die Diagnosezeile im Verbinder
static cdj::WaechterSeite* g_ws = nullptr;  // Scheibe 18: Selbst-Wächter, nullptr wenn aus
static jack_port_t* g_hand_in = nullptr;    // Scheibe 35: JACK-MIDI vom Controller (§7.1)
static jack_port_t* g_ein[cdj::EIN_PAARE][2] = {};  // I08: ein_<k>_L/R
static jack_port_t* g_midi_ein = nullptr;           // I08: midi_ein_1
static jack_port_t* g_midi_aus[cdj::ERZ_MIDI_PORTS] = {};  // Studio S5: §7.1 midi_aus_1 bis _4
// Slice 3 (F06/B10/B17): All-Off nach Neuverbindung eines MIDI-Ausgangs. Der Verbinder setzt je Port zwei Fälligkeiten
// (mono_ns; 0 = keine), process() sendet und löscht sie. g_allaus_pos/_maske nur im Callback.
static cdj::AllAusPlan g_allaus_plan[cdj::ERZ_MIDI_PORTS];                  // Verbinder setzt, process() arbeitet ab
static std::atomic<uint64_t> g_allaus_gesendet[cdj::ERZ_MIDI_PORTS] = {};   // B17: vollständig geschriebene All-Offs
static std::atomic<uint64_t> g_allaus_luecken[cdj::ERZ_MIDI_PORTS] = {};    // Zyklen, in denen ein Write scheiterte
static uint8_t g_allaus_tab[cdj::ALLE_AUS_N][3];  // einmal in main() gefüllt, vor jack_activate
static jack_port_t* g_rueck[8][2] = {};                    // Studio S5: §8 rueck_erz_1_L/R bis _8
// D1 K2b (Spec 2.4): Wirt-Slots des Arrangements, §7.1 arr_midi_<s> hinaus, §8 arr_rueck_<s>_L/R herein, je mit All-Off-Plan
static jack_port_t* g_arr_midi[cdj::ARR_WIRT_SLOTS] = {};
static jack_port_t* g_arr_rueck[cdj::ARR_WIRT_SLOTS][2] = {};
static cdj::AllAusPlan g_arr_allaus_plan[cdj::ARR_WIRT_SLOTS];
static std::atomic<uint64_t> g_arr_allaus_gesendet[cdj::ARR_WIRT_SLOTS] = {};
static std::atomic<uint64_t> g_arr_allaus_luecken[cdj::ARR_WIRT_SLOTS] = {};
// Review K2b F9: Verlust-Zähler der Senken, im Callback nach zyklus() gespiegelt (der Hauptfaden liest nur die Atomics):
// MidiAus::verloren je Wirt-Slot, ArrRbSenke::verloren() und parameter_abgelehnt(). Nur Diagnose, kein Vertragsfeld.
static std::atomic<uint64_t> g_arr_midi_verloren[cdj::ARR_WIRT_SLOTS] = {};
static std::atomic<uint64_t> g_arr_rb_verloren{0}, g_arr_rb_abgelehnt{0};

static void on_signal(int) { g_stop = true; }

static int64_t mono_ns() {
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

// Fixup M1: Graph hat sich geändert (JACK-Benachrichtigungsfaden): Karenz des Selbst-Wächters verlängern, zählen.
static void graph_ereignis() {
  if (g_ws && cdj::karenz_verlaengern(&g_ws->scharf_ab, mono_ns() + 500000000LL))  // nur echte Verlängerungen zählen
    g_graph_ereignisse.fetch_add(1, std::memory_order_relaxed);
}

// D1 K2b: MIDI eines Wirt-Slots des Arrangements in diesem Zyklus: All-Off-Plan zuerst (F06), dann die Ereignisse nach
// Versatz (midi_ausgabe.h), in derselben Reihenfolge wie die Schleife der Studio-Ströme midi_aus_<p> in process(), die
// wörtlich bleibt (Spec 6.28). Nur im Callback.
static void midi_ausgeben(jack_port_t* port, jack_nframes_t n, int64_t jetzt_ns, cdj::AllAusPlan& plan,
                          std::atomic<uint64_t>& gesendet, std::atomic<uint64_t>& luecken, const cdj::MidiAus& m) {
  if (!port) return;
  void* mb = jack_port_get_buffer(port, n);
  jack_midi_clear_buffer(mb);
  const auto r = cdj::midi_zyklus(plan, jetzt_ns, g_allaus_tab, m, n,
                                  [&](uint32_t t, const uint8_t* b) { return jack_midi_event_write(mb, t, b, 3) == 0; });
  if (r == cdj::AllAusPlan::GESENDET) gesendet.fetch_add(1, std::memory_order_relaxed);
  else if (r == cdj::AllAusPlan::PUFFER_VOLL) luecken.fetch_add(1, std::memory_order_relaxed);
}

// Diagnose Baukasten S3b (Spitzen im Maximum): mit CYPHERDJ_STOLPER=1 misst der Callback je Zyklus Faden-CPU-Zeit,
// Seitenfehler und Kontextwechsel (4 Systemaufrufe) und legt Zyklen über 1500 µs in ein vorbelegtes Feld; Ausgabe am Ende.
struct Stolper { int64_t zyklus, t_ns, wall_ns, vor_ns, cpu_ns, aufwach_ns; long minflt, majflt, nvcsw, nivcsw; };
static bool g_stolper_an = false;
static Stolper g_stolper[64];
static std::atomic<int> g_stolper_n{0};
static int64_t g_stolper_zyklus = 0;
static int64_t faden_cpu_ns() {
  timespec ts;
  clock_gettime(CLOCK_THREAD_CPUTIME_ID, &ts);
  return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

static int process(jack_nframes_t n, void*) {
  int64_t st_t0 = 0, st_cpu0 = 0, st_vor = 0;
  rusage st_r0{};
  if (g_stolper_an) {
    st_t0 = mono_ns();
    st_cpu0 = faden_cpu_ns();
    getrusage(RUSAGE_THREAD, &st_r0);
  }
  if (g_cb_tid.load(std::memory_order_relaxed) == 0) {  // Scheibe 31: einmal im ersten Zyklus (ein Systemaufruf)
    g_cb_tid.store(gettid(), std::memory_order_relaxed);
    // Keylock Task 2.5 (Vertrag 12): Priorität aus dem JACK-Faden selbst, einmal; sched_getscheduler/sched_getparam mit
    // 0 = dieser Faden sind reine Systemaufrufe (pthread_getschedparam nähme die Sperre des Fadens in glibc)
    const int pol = sched_getscheduler(0) & ~SCHED_RESET_ON_FORK;  // Prüfung F5: rtkit setzt das Bit mit
    sched_param sp{};
    const bool rt = (pol == SCHED_FIFO || pol == SCHED_RR) && sched_getparam(0, &sp) == 0;
    g_cb_prio.store(rt ? sp.sched_priority : 0, std::memory_order_release);
  }
  jack_nframes_t cf;
  jack_time_t cu, nu;
  float per;
  jack_get_cycle_times(g_client, &cf, &cu, &nu, &per);
  g_betrieb->zyklus_anfang(cf, (int64_t)cu * 1000, *g_kern);  // 18: erster Zyklus nach Neustart auf den Anker
  g_messer->anfang(cf, cu, mono_ns(), n, g_kern->sample());  // Lücken, Quantum, Aufwachen; Prüf-Last (10 K1b)
  if (g_hand_in) {  // Scheibe 35: jedes Ereignis roh mit Versatz, übersetzt wird in zyklus() (Plan 35 E1)
    void* mb = jack_port_get_buffer(g_hand_in, n);
    const uint32_t ne = jack_midi_get_event_count(mb);
    for (uint32_t i = 0; i < ne; ++i) {
      jack_midi_event_t ev;
      if (jack_midi_event_get(&ev, mb, i) == 0) g_kern->hand_midi(ev.buffer, ev.size, ev.time);
    }
  }
  if (g_midi_ein) {  // I08: roher MIDI-Eingang, jedes Ereignis mit Versatz
    void* mb = jack_port_get_buffer(g_midi_ein, n);
    const uint32_t ne = jack_midi_get_event_count(mb);
    for (uint32_t i = 0; i < ne; ++i) {
      jack_midi_event_t ev;
      if (jack_midi_event_get(&ev, mb, i) == 0) g_kern->midi_ein(ev.buffer, ev.size, ev.time);
    }
  }
  for (int k = 0; k < cdj::EIN_PAARE; ++k)  // I08: Audio-Eingänge dieses Zyklus
    g_kern->ein(k + 1, g_ein[k][0] ? (const float*)jack_port_get_buffer(g_ein[k][0], n) : nullptr,
                g_ein[k][1] ? (const float*)jack_port_get_buffer(g_ein[k][1], n) : nullptr);
  for (int e = 0; e < 8; ++e)  // Studio S5: Rückwege dieses Zyklus; unverbunden liefert JACK Nullen
    g_kern->rueck(e + 1, g_rueck[e][0] ? (const float*)jack_port_get_buffer(g_rueck[e][0], n) : nullptr,
                  g_rueck[e][1] ? (const float*)jack_port_get_buffer(g_rueck[e][1], n) : nullptr);
  for (int s = 0; s < cdj::ARR_WIRT_SLOTS; ++s)  // D1 K2b: Rückwege der Wirt-Slots in die Spur, die den Slot spielt
    g_kern->arr_rueck(s + 1, g_arr_rueck[s][0] ? (const float*)jack_port_get_buffer(g_arr_rueck[s][0], n) : nullptr,
                      g_arr_rueck[s][1] ? (const float*)jack_port_get_buffer(g_arr_rueck[s][1], n) : nullptr);
  g_kern->zyklus((int)n, (int64_t)cu * 1000);                // cu: Blockanfang in µs (CLOCK_MONOTONIC)
  if (g_stolper_an) st_vor = mono_ns();
  for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p) {  // Studio S5: MIDI dieses Zyklus, nach Versatz sortiert
    if (!g_midi_aus[p]) continue;
    void* mb = jack_port_get_buffer(g_midi_aus[p], n);
    jack_midi_clear_buffer(mb);
    {  // F06: All-Off vor den regulären Ereignissen bei t=0 (Plan und Fortsetzung bei vollem Puffer: kanten.h)
      const auto r = g_allaus_plan[p].zyklus((int64_t)cu * 1000, [&](int i) { return jack_midi_event_write(mb, 0, g_allaus_tab[i], 3) == 0; });
      if (r == cdj::AllAusPlan::GESENDET) g_allaus_gesendet[p].fetch_add(1, std::memory_order_relaxed);
      else if (r == cdj::AllAusPlan::PUFFER_VOLL) g_allaus_luecken[p].fetch_add(1, std::memory_order_relaxed);
    }
    const cdj::MidiAus& m = g_kern->midi_aus(p + 1);
    int idx[cdj::ERZ_MIDI_EV];
    for (int i = 0; i < m.n; ++i) idx[i] = i;
    for (int i = 1; i < m.n; ++i)  // Einfügesortierung, stabil (On nach Off am selben Sample bleibt so)
      for (int j = i; j > 0 && m.ev[idx[j]].t < m.ev[idx[j - 1]].t; --j) std::swap(idx[j], idx[j - 1]);
    for (int i = 0; i < m.n; ++i) {
      const auto& ev = m.ev[idx[i]];
      if (ev.t < n) jack_midi_event_write(mb, ev.t, ev.b, 3);
    }
  }
  for (int s = 0; s < cdj::ARR_WIRT_SLOTS; ++s)  // D1 K2b: Wirt-Slots des Arrangements (Noten um 2n + 25 vorgezogen)
    midi_ausgeben(g_arr_midi[s], n, (int64_t)cu * 1000, g_arr_allaus_plan[s], g_arr_allaus_gesendet[s],
                  g_arr_allaus_luecken[s], g_kern->arr_midi_aus(s + 1));
  for (int s = 0; s < cdj::ARR_WIRT_SLOTS; ++s)  // F9: Zähler fortlaufend seit Start, gespiegelt für die Diagnosezeile
    g_arr_midi_verloren[s].store((uint64_t)g_kern->arr_midi_aus(s + 1).verloren, std::memory_order_relaxed);
  g_arr_rb_verloren.store(g_kern->arr_rb().verloren(), std::memory_order_relaxed);
  g_arr_rb_abgelehnt.store(g_kern->arr_rb().parameter_abgelehnt(), std::memory_order_relaxed);
  if (g_kern->neue_zeitachse()) g_messer->neue_generation();
  float* aus[4];
  for (int k = 0; k < 4; ++k) aus[k] = (float*)jack_port_get_buffer(g_aus[k], n);
  cdj_ausgang(cdj_ring_daten(g_ring), cdj_lade(&g_ring->w) - n, (int)n, aus, &g_eingeblendet);  // Block dieses Zyklus
  g_betrieb->zyklus_ende(cf, (int64_t)cu * 1000, n, *g_kern);  // 18: Anker, Karte, Befehle ins Echtzeit-Fach
  if (g_ws) __atomic_store_n(&g_ws->zaehler, cdj_lade(&g_ring->w), __ATOMIC_RELEASE);  // 18: Lebenszeichen an den Wächter
  g_messer->ende(mono_ns(), g_kern->wartend(), g_kern->generation(), g_kern->sample() - (int64_t)n);
  if (g_stolper_an) {
    const int64_t t1 = mono_ns();
    if (t1 - st_t0 > 1500000) {
      const int i = g_stolper_n.load(std::memory_order_relaxed);
      if (i < 64) {
        rusage r1{};
        getrusage(RUSAGE_THREAD, &r1);
        g_stolper[i] = {g_stolper_zyklus, st_t0, t1 - st_t0, st_vor - st_t0, faden_cpu_ns() - st_cpu0, st_t0 - (int64_t)cu * 1000,
                        r1.ru_minflt - st_r0.ru_minflt, r1.ru_majflt - st_r0.ru_majflt, r1.ru_nvcsw - st_r0.ru_nvcsw,
                        r1.ru_nivcsw - st_r0.ru_nivcsw};
        g_stolper_n.store(i + 1, std::memory_order_release);
      }
    }
    ++g_stolper_zyklus;
  }
  return 0;
}

// Legt den Ring an (Größe, Kopf) oder öffnet einen vorhandenen gültigen; nullptr mit Meldung sonst.
static cdj_ring_kopf* oeffne_ring(const char* inst) {
  char ordner[128], pfad[160];
  cdj_shm_ordner(ordner, sizeof ordner, inst);
  if (mkdir(ordner, 0700) != 0 && errno != EEXIST) { std::perror(ordner); return nullptr; }
  std::snprintf(pfad, sizeof pfad, "%s/bus", ordner);
  int fd = open(pfad, O_RDWR | O_CREAT, 0600);
  if (fd < 0) { std::perror(pfad); return nullptr; }
  struct stat st;
  fstat(fd, &st);
  const bool neu = st.st_size == 0;
  if (neu && ftruncate(fd, (off_t)CDJ_RING_BYTES) != 0) { std::perror("ftruncate"); close(fd); return nullptr; }
  if (!neu && st.st_size != (off_t)CDJ_RING_BYTES) {
    std::fprintf(stderr, "%s hat %lld Bytes statt %zu: kein Ring der Version 1\n", pfad, (long long)st.st_size,
                 CDJ_RING_BYTES);
    close(fd);
    return nullptr;
  }
  void* p = mmap(nullptr, CDJ_RING_BYTES, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (p == MAP_FAILED) { std::perror("mmap"); return nullptr; }
  auto* r = (cdj_ring_kopf*)p;
  if (neu) {
    r->version = CDJ_RING_VERSION;
    r->rate = CDJ_RING_RATE;
    r->kanaele = CDJ_RING_KANAELE;
    r->cap = CDJ_RING_CAP;
    cdj_setze(&r->w, 0);
    std::memcpy(r->magic, "CDJB", 4);  // zuletzt: erst dann gilt der Kopf
  } else if (!cdj_ring_gueltig(r)) {
    std::fprintf(stderr, "%s: Kopf ungültig (Magic, Version, Rate, Kanäle oder Kapazität)\n", pfad);
    munmap(p, CDJ_RING_BYTES);
    return nullptr;
  }
  if (mlock(p, CDJ_RING_BYTES) != 0) std::perror("mlock Ring");
  std::fprintf(stderr, "Ring %s %s, w=%llu\n", pfad, neu ? "angelegt" : "fortgesetzt", (unsigned long long)r->w);
  return r;
}

// Legt den Hüllkurven-Ring an (§6.2) oder öffnet einen vorhandenen gültigen; nullptr mit Meldung sonst. Ohr ist nicht
// lebenswichtig: ein Fehlschlag ist kein Abbruch des Kerns, der Kern läuft dann ohne Hüllkurven-Ring weiter.
static cdj_huellen_kopf* oeffne_huellen(const char* inst) {
  char ordner[128], pfad[160];
  cdj_shm_ordner(ordner, sizeof ordner, inst);
  if (mkdir(ordner, 0700) != 0 && errno != EEXIST) { std::perror(ordner); return nullptr; }
  std::snprintf(pfad, sizeof pfad, "%s/huellen", ordner);
  int fd = open(pfad, O_RDWR | O_CREAT, 0600);
  if (fd < 0) { std::perror(pfad); return nullptr; }
  struct stat st;
  fstat(fd, &st);
  const bool neu = st.st_size == 0;
  if (neu && ftruncate(fd, (off_t)CDJ_HUELLEN_BYTES) != 0) { std::perror("ftruncate"); close(fd); return nullptr; }
  if (!neu && st.st_size != (off_t)CDJ_HUELLEN_BYTES) {
    std::fprintf(stderr, "%s hat %lld Bytes statt %zu: kein Hüllkurven-Ring der Version 1\n", pfad,
                 (long long)st.st_size, CDJ_HUELLEN_BYTES);
    close(fd);
    return nullptr;
  }
  void* p = mmap(nullptr, CDJ_HUELLEN_BYTES, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  close(fd);
  if (p == MAP_FAILED) { std::perror("mmap"); return nullptr; }
  auto* h = (cdj_huellen_kopf*)p;
  if (neu) {
    cdj_huellen_init(h);
  } else if (!cdj_huellen_gueltig(h)) {
    std::fprintf(stderr, "%s: Kopf ungültig (Magic, Version, Rate, Kanäle oder Kapazität)\n", pfad);
    munmap(p, CDJ_HUELLEN_BYTES);
    return nullptr;
  }
  if (mlock(p, CDJ_HUELLEN_BYTES) != 0) std::perror("mlock Hüllkurven-Ring");
  std::fprintf(stderr, "Hüllkurven-Ring %s %s, w=%llu\n", pfad, neu ? "angelegt" : "fortgesetzt",
               (unsigned long long)cdj_lade(&h->w));
  return h;
}

// Scheibe 31: Seitenfehler eines Fadens dieses Prozesses (Felder 10 und 12 von /proc/self/task/<tid>/stat).
static bool seitenfehler(int tid, long long& minflt, long long& majflt) {
  char pfad[64], buf[1024];
  std::snprintf(pfad, sizeof pfad, "/proc/self/task/%d/stat", tid);
  FILE* f = std::fopen(pfad, "r");
  if (!f) return false;
  const size_t n = std::fread(buf, 1, sizeof buf - 1, f);
  std::fclose(f);
  buf[n] = '\0';
  const char* p = std::strrchr(buf, ')');  // nach dem Namen (comm) zählen, er darf Leerzeichen enthalten
  if (!p) return false;
  long long feld[12] = {0};
  int k = 0;
  for (const char* q = p + 2; *q && k < 12; ++k) {  // Feld 3 (Zustand) bis Feld 14
    feld[k] = std::atoll(q);
    while (*q && *q != ' ') ++q;
    while (*q == ' ') ++q;
  }
  minflt = feld[7];  // Feld 10
  majflt = feld[9];  // Feld 12
  return k == 12;
}

static void hilfe() {
  std::fprintf(stderr, "Aufruf: cypherdj-kern [--konfig kern.toml] [--pruefmodus] [--start-bpm 60..200] [--udp-port N]"
                       " [--test-last-alle N --test-last-perioden F] [--master <präfix> [--cue <präfix>] [--ton-frei]]"
                       " [--pruef-cue] [--ohne-zustand] [--waechter-ms 0..1000] [--test-lader-ohne-sperre]\n");
}

int main(int argc, char** argv) {
  // 1 MiB Stack je Faden statt 8 MiB: mlockall sperrt jeden Stack ganz, nach kill -9 hielt das Abräumen der 16 Stacks
  // den Graphen mit auf (Höchststand je Faden 60 KiB; ~/messungen/2026-10-29-neustart/STILLE.md)
  {
    pthread_attr_t a;
    if (pthread_attr_init(&a) == 0) {
      if (pthread_attr_setstacksize(&a, 1u << 20) != 0 || pthread_setattr_default_np(&a) != 0)
        std::fprintf(stderr, "Faden-Stack: Vorgabe 1 MiB nicht gesetzt\n");
      pthread_attr_destroy(&a);
    }
  }
  const char* inst = cdj_instanz();
  g_stolper_an = std::getenv("CYPHERDJ_STOLPER") != nullptr;  // Diagnose S3b, siehe Stolper
  std::memset(g_stolper, 0, sizeof g_stolper);
  if (g_stolper_an) std::fprintf(stderr, "Stolper: an, Schwelle 1500 us, höchstens 64 Zyklen\n");
  if (cdj_instanz_k(inst) < 0) {
    std::fprintf(stderr, "CYPHERDJ_INSTANZ='%s' ungültig: leer oder ein Buchstabe a bis i\n", inst);
    return 2;
  }
  const char* konfig_pfad = nullptr;
  bool pruefmodus_arg = false, pruef_cue = false, ohne_zustand = false, ohne_sperre = false;
  int waechter_ms = 0;  // Scheibe 18: Selbst-Wächter (0 aus)
  double start_bpm_arg = 0.0;
  int udp_port_arg = 0, last_alle = 0;
  const char *master = nullptr, *cue = nullptr;
  bool ton_frei = false;
  double last_perioden = 0.0;
  for (int i = 1; i < argc; ++i) {
    if (!std::strcmp(argv[i], "--konfig") && i + 1 < argc) konfig_pfad = argv[++i];
    else if (!std::strcmp(argv[i], "--pruefmodus")) pruefmodus_arg = true;
    else if (!std::strcmp(argv[i], "--start-bpm") && i + 1 < argc) start_bpm_arg = std::atof(argv[++i]);
    else if (!std::strcmp(argv[i], "--udp-port") && i + 1 < argc) udp_port_arg = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--test-last-alle") && i + 1 < argc) last_alle = std::atoi(argv[++i]);
    else if (!std::strcmp(argv[i], "--test-last-perioden") && i + 1 < argc) last_perioden = std::atof(argv[++i]);
    else if (!std::strcmp(argv[i], "--master") && i + 1 < argc) master = argv[++i];
    else if (!std::strcmp(argv[i], "--cue") && i + 1 < argc) cue = argv[++i];
    else if (!std::strcmp(argv[i], "--ton-frei")) ton_frei = true;
    else if (!std::strcmp(argv[i], "--pruef-cue")) pruef_cue = true;
    else if (!std::strcmp(argv[i], "--ohne-zustand")) ohne_zustand = true;
    else if (!std::strcmp(argv[i], "--test-lader-ohne-sperre")) ohne_sperre = true;
    else if (!std::strcmp(argv[i], "--waechter-ms") && i + 1 < argc) waechter_ms = std::atoi(argv[++i]);
    else { hilfe(); return 2; }
  }
  // §2.1: kern.toml lesen; ein unbekannter Schlüssel ist ein Startfehler mit Schlüsselnamen
  cdj::KernKonfig konf;
  const std::string pfad = konfig_pfad ? konfig_pfad : cdj::standard_konfig_pfad(inst);
  try {
    if (konfig_pfad || access(pfad.c_str(), F_OK) == 0) konf = cdj::lies_kern_toml(pfad);
    else std::fprintf(stderr, "%s fehlt: Vorgaben aus INTERFACES.md §2.1\n", pfad.c_str());
  } catch (const cdj::KonfigFehler& e) {
    std::fprintf(stderr, "Startfehler: %s\n", e.what());
    return 2;
  }
  cdj::wende_instanz_an(konf, inst);
  const bool pruefmodus = pruefmodus_arg || konf.pruefmodus;
  const double start_bpm = start_bpm_arg > 0.0 ? start_bpm_arg : konf.start_bpm;
  const int udp_port = udp_port_arg > 0 ? udp_port_arg : konf.udp_port;
  if (!(start_bpm >= 60.0 && start_bpm <= 200.0)) { hilfe(); return 2; }
  if ((last_alle != 0 || last_perioden != 0.0) && (!pruefmodus || last_alle < 1 || !(last_perioden > 0.0))) {
    std::fprintf(stderr, "Startfehler: --test-last-* nur mit Prüfmodus, alle >= 1 und perioden > 0\n");
    return 2;
  }
  if (waechter_ms < 0 || waechter_ms > 1000) {
    std::fprintf(stderr, "Startfehler: --waechter-ms 0..1000\n");
    return 2;
  }
  if ((pruef_cue || ohne_zustand || ohne_sperre) && !pruefmodus) {
    std::fprintf(stderr, "Startfehler: --pruef-cue, --ohne-zustand und --test-lader-ohne-sperre nur mit Prüfmodus\n");
    return 2;
  }

  // Riegel vor allem anderen (INTERFACES §8): ohne Freigabe weder Ring noch JACK-Client
  char ziel[4][256];
  const int n_ziele = master ? (cue ? 4 : 2) : 0;
  for (int k = 0; k < n_ziele; ++k) {
    std::snprintf(ziel[k], sizeof ziel[k], "%s%s", k < 2 ? master : cue, k % 2 ? "R" : "L");
    if (!riegel_erlaubt(ziel[k], ton_frei)) {
      std::fprintf(stderr, "Riegel: %s ist weder stumm noch cypherdj-pruef-*; ohne --ton-frei verbinde ich nichts\n", ziel[k]);
      return 3;
    }
  }
  cdj_ring_kopf* ring = oeffne_ring(inst);
  if (!ring) return 4;
  cdj_huellen_kopf* huellen = oeffne_huellen(inst);  // Ohr (§6.2): nicht lebenswichtig, kein Abbruch bei Fehlschlag
  // Scheibe 18: Selbst-Wächter als eigener Prozess, bevor Fäden existieren (selbstwaechter.h): tötet den Kern, wenn w
  // waechter_ms lang steht, auch bei SIGSTOP; systemd (WatchdogSec) bleibt die zweite Linie
  g_ws = waechter_ms > 0 ? cdj::waechter_seite() : nullptr;
  if (waechter_ms > 0) {
    const pid_t wp = g_ws ? cdj::starte_selbstwaechter(&g_ws->zaehler, &g_ws->ende, waechter_ms, ring, CDJ_RING_BYTES,
                                                       &g_ws->scharf_ab) : -1;
    if (wp <= 0) { std::fprintf(stderr, "Selbst-Wächter startet nicht\n"); return 1; }
    std::fprintf(stderr, "Selbst-Wächter %d: SIGKILL, wenn w %d ms steht\n", (int)wp, waechter_ms);
  }

  char gruppe[64], props[160], name[64];
  cdj_name(gruppe, sizeof gruppe, "cypherdj", inst);
  std::snprintf(props, sizeof props, "{ node.group = \"%s\" node.lock-quantum = true }", gruppe);
  setenv("PIPEWIRE_PROPS", props, 1);  // INTERFACES §8: selbe Gruppe wie die Notbahn, Quantum fest
  cdj_name(name, sizeof name, "cypherdj-kern", inst);

  auto* befehle = new cdj::Befehlsring();      // vor dem Callback angelegt, mlockall unten sperrt sie
  auto* ereignisse = new cdj::Ereignisring();

  cdj::Netz netz(udp_port, pruefmodus, befehle, ereignisse);
  netz.setze_hand_osc(konf.hand_osc);  // Scheibe 35, B-O Weg 1
  const std::string std_pfad_netz = cdj::standard_konfig_pfad(inst);
  netz.setze_controller_ordner(std_pfad_netz.substr(0, std_pfad_netz.rfind('/')) + "/controller");  // Scheibe 35: /k/mapping
  netz.setze_kit_ordner(std::string(std::getenv("HOME") ? std::getenv("HOME") : "") + "/.config/cypherdj/kits");  // ADR 024
  netz.setze_bk_ordner(std::string(std::getenv("HOME") ? std::getenv("HOME") : "") + "/.config/cypherdj/baukasten");  // Baukasten S3a
  {  // MVP 2 (ADR 025, §4.9): Loops der Vorgabe-Instanz in ~/.config/cypherdj/loops, einer Prüfinstanz in /dev/shm
    char shm[64];
    cdj_shm_ordner(shm, sizeof shm, inst);
    const std::string loops = inst[0] ? std::string(shm) + "/loops"
                                      : std::string(std::getenv("HOME") ? std::getenv("HOME") : "") + "/.config/cypherdj/loops";
    std::error_code ec;
    std::filesystem::create_directories(loops, ec);
    netz.setze_loop_ordner(loops);
  }
  if (!netz.offen()) { std::fprintf(stderr, "UDP-Port %d nicht zu binden\n", udp_port); return 1; }

  jack_status_t st;
  std::fprintf(stderr, "JACK-Client %s öffnet (mono_ns %lld)\n", name, (long long)mono_ns());  // Scheibe 35: Bezug für Task 7
  g_client = jack_client_open(name, JackNoStartServer, &st);
  if (!g_client) { std::fprintf(stderr, "kein JACK-Server (pw-jack?) status=0x%x\n", (unsigned)st); return 1; }
  if (jack_get_sample_rate(g_client) != 48000) {
    std::fprintf(stderr, "Abtastrate %u statt 48000\n", jack_get_sample_rate(g_client));
    return 1;
  }
  g_kern = new cdj::Kern(start_bpm, ring, befehle, ereignisse);
  g_kern->setze_pruef_cue(pruef_cue);
  // Scheibe 35, Plan E7: Mapping beim Start aus <Konfig-Ordner nach Z2>/controller/<controller_geraet>.json. Fehlt oder
  // bricht es, läuft der Kern ohne Controller und meldet den Fehler mit Zeile (die Musik hängt nicht an der Hand).
  const std::string std_pfad = cdj::standard_konfig_pfad(inst);
  const std::string controller_ordner = std_pfad.substr(0, std_pfad.rfind('/')) + "/controller";
  std::unique_ptr<hand::Mapping> mapping;  // bis zur Übergabe an den Kern (Besitz danach dort, /k/mapping gibt es frei)
  char hand_quelle[hand::PORT_TEXT + 16] = "";
  if (!konf.controller_geraet.empty()) {
    const std::string mpfad = controller_ordner + "/" + konf.controller_geraet + ".json";
    auto m = std::make_unique<hand::Mapping>();
    hand::Fehler fe{};
    if (konf.controller_geraet.find('/') != std::string::npos || konf.controller_geraet[0] == '.') {
      std::fprintf(stderr, "Mapping: controller_geraet '%s' ist kein Gerätename (Kern ohne Controller)\n",
                   konf.controller_geraet.c_str());
    } else if (!hand::lade_datei(mpfad.c_str(), g_kern->stellwerk().tabelle(), m.get(), &fe)) {
      std::fprintf(stderr, "Mapping %s: %s (Kern ohne Controller)\n", mpfad.c_str(), fe.text);  // fe.text trägt Zeile und Art
    } else if (!cdj::hand_port_name(m->quelle_port, inst, hand_quelle, sizeof hand_quelle)) {
      std::fprintf(stderr, "Mapping %s: quelle_port zu lang (Kern ohne Controller)\n", mpfad.c_str());
    } else {
      mapping = std::move(m);
      std::fprintf(stderr, "Mapping %s: Gerät %s, %d Einträge, Quelle %s\n", mpfad.c_str(), mapping->geraet,
                   mapping->n_eintraege, hand_quelle);
      g_kern->setze_mapping(mapping.release());  // Besitz beim Kern: ein Tausch über /k/mapping gibt es dem Netz-Faden zurück
    }
  }
  // Scheibe 31: Lader mit Budget (§2.1 speicher_budget_mib) und Ringen zum Callback, vor mlockall angelegt
  auto* lringe = new cdj::LaderRinge();
  cdj::Lader lader(konf.arbeitsbestand, (int64_t)konf.speicher_budget_mib << 20);
  cdj::LaderOptionen lopt;
  lopt.sperren = !ohne_sperre;
  lopt.pruefsumme = !ohne_sperre;  // sha256 läse jede Seite und nähme dem Fehlerfall seine Seitenfehler
  g_kern->verbinde_lader(lringe);
  // D1 K1 (Spec 2.1): ein Speicher-Konto für Decks und Arrangement; eigener Arrangement-Lade-Faden mit Ringen zum Netz
  auto* konto = new cdj::SpeicherKonto((int64_t)konf.speicher_budget_mib << 20);
  lader.verbinde_konto(konto);
  const std::string arr_ordner = cdj::arr_ordner_von(konf, inst);
  {
    std::error_code ec;
    std::filesystem::create_directories(arr_ordner + "/audio", ec);
    if (ec) std::fprintf(stderr, "Arrangement: Arbeitsordner %s nicht anlegbar: %s\n", arr_ordner.c_str(), ec.message().c_str());
  }
  auto* aringe = new cdj::ArrLaderRinge();
  cdj::ArrLader arr_lader(arr_ordner, konto, (int64_t)konf.arr_budget_mib << 20, !ohne_sperre);
  netz.verbinde_arr(aringe);
  netz.setze_arr_ordner(arr_ordner);  // Paket K3: Freeze im Arbeitsordner (Spec 6.14), geschrieben vom arr_faden (6.29)
  // 1.13 Slice 2 (ADR 031 Teil 2): das Warp-Werk für COMPLEX und TONES. Pool, Ringe und Bungee-Instanzen entstehen hier, vor jack_activate und mlockall (der Speicher
  // wird mitgesperrt); die Fäden warten auf den Callback, ihre Priorität setzt ein eigener Faden, sobald der JACK-Faden seine kennt. Ohne Bungee im Bau: kein
  // Werk, der Lader lehnt COMPLEX und TONES mit warp_maschine_fehlt ab.
  std::unique_ptr<cdj::WarpWerk> warp_werk = cdj::warp_werk_neu({konf.warp_faeden});
  if (warp_werk) {
    g_kern->setze_arr_warp_werk(warp_werk.get());
    arr_lader.setze_warp_werk(warp_werk.get());
    std::fprintf(stderr, "Warp-Werk: %d Fäden, %d Plätze, Vorlauf %d Frames, Frist %d Samples\n", warp_werk->faeden(), cdj::ARR_WARP_PLAETZE, cdj::ARR_WARP_VORLAUF, cdj::ARR_WARP_FRIST);
  } else {
    std::fprintf(stderr, "Warp-Werk: nicht angelegt (Kern ohne Bungee oder keine Fäden): COMPLEX und TONES werden mit warp_maschine_fehlt abgelehnt\n");
  }
  // Baukasten S3b: das Graph-Werk. Plätze und Fäden entstehen hier, vor jack_activate und mlockall; die Priorität setzt
  // gr_prio, sobald der JACK-Faden seine kennt (ohne Echtzeit-Recht rechnet das Werk synchron im Callback, D10).
  std::unique_ptr<cdj::GraphWerk> graph_werk = cdj::graph_werk_neu({konf.graph_faeden});
  g_kern->setze_graph_werk(graph_werk.get());
  std::fprintf(stderr, "Graph-Werk: %d Fäden, %d Plätze, ein Block Vorlauf\n", graph_werk->faeden(), cdj::GW_PLAETZE);
  static cdj::AufnahmeFaden rec_faden(arr_ordner);   // 1.8: Aufnahme-Faden, Take-Dateien im Arbeitsordner (statisch: überlebt den Netz-Faden; sein Destruktor fasst keine RecSpur an)
  rec_faden.starte();
  netz.verbinde_rec(&rec_faden);
  g_kern->verbinde_huellen(huellen);  // Ohr (§6.2), vor mlockall
  g_kern->setze_deck_konfig((float)konf.ziel_lufs, (float)konf.hoerbar_db);
  g_kern->setze_pruefmodus(pruefmodus);  // Scheibe 25, B7: vor dem Lesen des Neustart-Zustands
  g_kern->setze_filter_guete(konf.filter_guete);  // Scheibe 25: kern.toml filter_guete (A27 Weg a)
  g_kern->setze_limiter_dbtp(konf.limiter_dbtp);  // Scheibe 25: Master-Limiter aus 14, Decke aus kern.toml
  g_kern->hoerschein_pflicht(konf.hoerschein_pflicht);  // Ohr T14: kern.toml hoerschein_pflicht (Vorgabe true, §17 I3a)
  std::fprintf(stderr, "Master-Limiter: Decke %.2f dBTP, Vorhalt %d Samples (Cue gleich verzögert)\n", konf.limiter_dbtp,
               g_kern->mixer().limiter_vorhalt());
  std::fprintf(stderr, "Filter-Güte %.3f in %d Kanalzügen\n", g_kern->mixer().kanalzug(0).filter_guete(),
               cdj::MIX_KANAELE);
  g_messer = new cdj::Zyklusmesser(ereignisse);
  if (last_alle > 0) g_messer->setze_pruef_last(last_alle, last_perioden);
  static const char* NAMEN[4] = {"master_L", "master_R", "cue_L", "cue_R"};
  for (int k = 0; k < 4; ++k) g_aus[k] = jack_port_register(g_client, NAMEN[k], JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  // Nie gelesen: die Notbahn verbindet ihren stummen Ausgang hierher (--vor) und rechnet so immer vor dem Kern
  g_notbahn_vor = jack_port_register(g_client, "notbahn_vor", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
  if (!g_notbahn_vor)
    std::fprintf(stderr, "Port notbahn_vor nicht angelegt: die Notbahn braucht zwei stehende Zyklen\n");
  // Scheibe 35: Eingang der Hand (§7.1); hand_led bleibt in Teil A unregistriert (LEDs kommen mit Teil B)
  g_hand_in = jack_port_register(g_client, "hand_in", JACK_DEFAULT_MIDI_TYPE, JackPortIsInput, 0);
  if (!g_hand_in) std::fprintf(stderr, "Port hand_in nicht angelegt: Kern ohne Controller\n");
  for (int k = 0; k < cdj::EIN_PAARE; ++k)  // I08: Audio-Eingänge; unverbunden liefert JACK Nullen
    for (int s = 0; s < 2; ++s) {
      char name[32];
      std::snprintf(name, sizeof name, "ein_%d_%c", k + 1, s ? 'R' : 'L');
      g_ein[k][s] = jack_port_register(g_client, name, JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    }
  g_midi_ein = jack_port_register(g_client, "midi_ein_1", JACK_DEFAULT_MIDI_TYPE, JackPortIsInput, 0);
  if (!g_midi_ein) std::fprintf(stderr, "Port midi_ein_1 nicht angelegt: Kern ohne rohen MIDI-Eingang\n");
  for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p) {
    char name[32];
    std::snprintf(name, sizeof name, "midi_aus_%d", p + 1);
    g_midi_aus[p] = jack_port_register(g_client, name, JACK_DEFAULT_MIDI_TYPE, JackPortIsOutput, 0);
  }
  for (int e = 0; e < 8; ++e)
    for (int s = 0; s < 2; ++s) {
      char name[32];
      std::snprintf(name, sizeof name, "rueck_erz_%d_%c", e + 1, s ? 'R' : 'L');
      g_rueck[e][s] = jack_port_register(g_client, name, JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    }
  for (int a = 0; a < cdj::ARR_WIRT_SLOTS; ++a) {  // D1 K2b (Spec 2.4): Wirt-Slots des Arrangements
    char name[32];
    std::snprintf(name, sizeof name, "arr_midi_%d", a + 1);
    g_arr_midi[a] = jack_port_register(g_client, name, JACK_DEFAULT_MIDI_TYPE, JackPortIsOutput, 0);
    for (int s = 0; s < 2; ++s) {
      std::snprintf(name, sizeof name, "arr_rueck_%d_%c", a + 1, s ? 'R' : 'L');
      g_arr_rueck[a][s] = jack_port_register(g_client, name, JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    }
    if (!g_arr_midi[a] || !g_arr_rueck[a][0] || !g_arr_rueck[a][1])
      std::fprintf(stderr, "Wirt-Slot %d des Arrangements: Ports nicht vollständig angelegt\n", a + 1);
  }
  g_ring = ring;
  // Scheibe 18: Neustart-Zustand lesen und übernehmen (INTERFACES §6.3), gespeicherte Abonnenten ans Netz
  // Keylock Task 2.5b (Vertrag 17, Prüfung F2): Vorgabe 1 im Betrieb, hier nur angekündigt (kostet nichts); Dehner und
  // Fäden baut keylock_bauen nach READY in einem eigenen Faden, die Decks spielen bis dahin Varispeed
  const bool keylock = g_kern->keylock_nach_konfig(konf.keylock);  // Task 3: kern.toml keylock (§2.1)
  if (konf.keylock_maschine != "r3")  // Bungee S2: kern.toml keylock_maschine; r3 ist der Rückfall und die Vorgabe
    g_kern->setze_keylock_maschine(cdj::DehnerMaschine::Bungee, konf.keylock_maschine == "bungee_fein");
  std::fprintf(stderr, "Keylock-Maschine: %s\n", konf.keylock_maschine.c_str());
  g_betrieb = new cdj::Betrieb();
  const cdj::Wiederaufnahme wa = g_betrieb->starte(cdj::ZustandDatei::pfad_fuer(inst), *g_kern, ohne_zustand);
  std::fprintf(stderr, "Zustand %s: %s, %s, Generation %d, Stand %llu, %d Segmente, %d Befehle, %d Abonnenten\n",
               cdj::ZustandDatei::pfad_fuer(inst).c_str(), wa.meldung.c_str(),
               wa.fortgesetzt ? "fortgesetzt" : "neue Zeitachse", wa.generation, (unsigned long long)wa.stand,
               wa.n_segmente, wa.n_befehle, wa.n_abonnenten);
  // Scheibe 31: Decks aus dem Zustand wieder einblenden (ohne sha256), bevor der erste Zyklus läuft
  if (const int nd = g_kern->decks_nachladen(lader); nd > 0)
    std::fprintf(stderr, "Neustart: %d Deck(s) wieder eingeblendet, %lld MiB gesperrt\n", nd,
                 (long long)(lader.gesperrt() >> 20));
  g_betrieb->netz_anschliessen(netz, mono_ns());
  cdj::alle_aus_ereignisse(g_allaus_tab, cdj::ALLE_AUS_N);  // Tabelle einmal, der Callback liest nur
  jack_set_process_callback(g_client, process, nullptr);
  // Fixup M1: kommt eine Senke oder ein Wirt wieder, baut PipeWire den Graphen um, bevor der 500-ms-Verbinder seine Karenz
  // setzt (w stand dabei 10-20 ms). Jede Port-An-/Abmeldung und jede Verbindungsänderung verlängert die Karenz.
  // Gemessen/gelesen (pipewire-jack 1.6.8): jack_set_graph_order_callback feuert dort nie, do_graph läuft nur bei
  // NOTIFY_TYPE_CONNECT, und das wird nur eingereiht, wenn ein connect_callback gesetzt ist; darum der Port-Connect-Callback.
  // Alle Callbacks kommen aus dem JACK-Benachrichtigungsfaden (jack.h: "separated non RT thread"); nur Atomics, kein I/O.
  jack_set_port_registration_callback(g_client, [](jack_port_id_t, int, void*) { graph_ereignis(); }, nullptr);
  jack_set_port_connect_callback(g_client, [](jack_port_id_t, jack_port_id_t, int, void*) { graph_ereignis(); }, nullptr);
  std::signal(SIGINT, on_signal);
  std::signal(SIGTERM, on_signal);
  {  // S7 (Review S7 M5): Fähigkeiten-Datei {pid, nur_cue}, atomar (Temp + rename), vor jack_activate. Der Seiten-Server
     // prüft PID und /proc/<pid>/comm, ehe er den Vorhörer auf rueck_erz_8 schaltet; ein Kern ohne S7 schreibt sie nicht.
    char ordner[128], tmp[176];
    char* pfad = g_faehig_pfad;
    cdj_shm_ordner(ordner, sizeof ordner, inst);
    std::snprintf(pfad, sizeof g_faehig_pfad, "%s/kern-faehigkeiten.json", ordner);
    std::snprintf(tmp, sizeof tmp, "%s.tmp", pfad);
    if (FILE* f = std::fopen(tmp, "w")) {
      const int k = cdj::Mixer::kanal_index(cdj::VORHOER_KANAL);
      if (g_kern->mixer().nur_cue(k))
        std::fprintf(f, "{\"pid\": %d, \"nur_cue\": \"%s\"}\n", (int)getpid(), cdj::VORHOER_KANAL);
      else
        std::fprintf(f, "{\"pid\": %d}\n", (int)getpid());
      const bool ok = std::fclose(f) == 0;
      if (!ok || std::rename(tmp, pfad) != 0) std::perror(pfad);
    } else {
      std::perror(tmp);
    }
  }
  // vor jack_activate: lief die Sperre danach (rund 17 ms), wartete Zyklus 0 mit seinen ersten Seitenfehlern auf sie
  // (Spitzen bis 17 ms, nur in Zyklus 0; ~/messungen/2026-10-29-mlock/)
  if (mlockall(MCL_CURRENT) != 0) std::perror("mlockall");  // nicht MCL_FUTURE (10 NP K7)
  if (jack_activate(g_client) != 0) {
    std::fprintf(stderr, "jack_activate fehlgeschlagen\n");
    g_kern->keylock_faeden_stoppen();  // Prüfung F4 (seit 2.5b laufen hier noch keine; bleibt als Schutz)
    return 1;
  }
  // Die Kante der Notbahn (vor -> notbahn_vor) vor den Ausgängen selbst verbinden: zog sie erst die Notbahn nach, ordnete
  // PipeWire den Graphen um, während der Kern schon spielte, und der Kern verlor einen Zyklus (Raster 1 Block versetzt,
  // 29.10.). Läuft keine Notbahn, scheitert es still; sie verbindet dann selbst.
  {
    char nb[64], vor[96];
    cdj_name(nb, sizeof nb, "cypherdj-notbahn", inst);
    std::snprintf(vor, sizeof vor, "%s:vor", nb);
    jack_connect(g_client, vor, jack_port_name(g_notbahn_vor));
  }
  // Review Slice 4 Q1: ein gescheitertes Verbinden beim Start ist nicht mehr tödlich. Vorher endete der Kern mit 1, die
  // Unit startete sofort neu, und die Bremse (F20) zählte das als Absturz ohne Fortschritt: fehlte das Ziel nur kurz, war
  // nach drei Runden der Zustand weg. Der 500-ms-Verbinder (Slice 1) holt die Kante nach; djk-start prüft die Ausgänge am
  // Ziel nach dem Start weiterhin.
  for (int k = 0; k < n_ziele; ++k) {
    if (jack_connect(g_client, jack_port_name(g_aus[k]), ziel[k]) != 0)
      std::fprintf(stderr, "Verbinden %s -> %s beim Start gescheitert, der Verbinder versucht es alle 500 ms\n",
                   jack_port_name(g_aus[k]), ziel[k]);
  }
  // 2026-09-27: Selbst-Wächter erst nach dem Verbinden plus 500 ms Karenz scharf (PipeWire baut den Graphen danach
  // asynchron um; am Digital-Out stand w dabei 100,5 ms und der Wächter tötete den frischen Kern)
  if (g_ws) {
    timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    __atomic_store_n(&g_ws->scharf_ab, (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec + 500000000LL, __ATOMIC_RELEASE);
  }
  // Scheibe 18: erst nach dem ersten Zyklus READY=1 und der Netz-Faden, damit /e/neustart die erste Nachricht der
  // neuen Generation ist (§4.1); /k/hallo, die bis dahin kommen, warten im Socket.
  while (!g_stop.load() && !g_betrieb->warte_erster_zyklus(100)) {}
  netz.ereignisse_senden();
  cdj::sd_melde("READY=1");
  if (g_betrieb->fortgesetzt()) {
    const cdj::Fortsetzung& f = g_betrieb->fortsetzung();
    std::fprintf(stderr, "fortgesetzt auf dem Anker: Sample %lld, Quelle %s, %lld Frames laut Treiber, %lld laut Uhr\n",
                 (long long)f.sample, f.quelle == cdj::AnkerQuelle::frames ? "Treiber" : "Uhr",
                 (long long)f.d_frames, (long long)f.d_mono);
  }
  std::fprintf(stderr, "%s läuft: UDP %d, Prüfmodus %s, Start %.3f BPM, Quantum %u, Konfiguration %s, mono_ns %lld\n",
               jack_get_client_name(g_client), netz.port(), pruefmodus ? "an" : "aus", start_bpm,
               jack_get_buffer_size(g_client), pfad.c_str(), (long long)mono_ns());  // Scheibe 35: Bezug für Task 7

  std::fprintf(stderr, "Decks: Arbeitsbestand %s, Budget %d MiB%s, Callback-Faden %d\n", konf.arbeitsbestand.c_str(),
               konf.speicher_budget_mib, ohne_sperre ? ", Lader OHNE Sperre (Prüfschalter)" : "", g_cb_tid.load());
  std::thread faden([&] { netz.laufen(g_stop); });
  std::thread lader_faden([&] { lader.laufen(*lringe, g_stop, lopt); });  // Scheibe 31
  std::thread arr_faden([&] { arr_lader.laufen(*aringe, g_stop); });   // D1 K1: Arrangement-Lade-Faden
  // Keylock Task 2.5b: Dehner und Fäden nach dem ersten Zyklus in einem eigenen Faden (Prüfung F2: nicht im Startpfad);
  // Priorität (Vertrag 12) = JACK-Priorität − 5 aus dem JACK-Faden; Task 2.5c: danach nur den Dehner-Speicher sperren
  // (keylock_bauen sperren = true, kein zweites mlockall); erst nach Netz- und Lade-Faden, damit ihre Stapel schon vorher
  // da sind und nicht als neu gelten.
  std::thread wk_prio;   // 1.13 Slice 2: Priorität der Fäden des Warp-Werks (JACK − 6), sobald der JACK-Faden seine Priorität kennt
  if (warp_werk)
    wk_prio = std::thread([&warp_werk] {
      for (int i = 0; i < 100 && g_cb_prio.load(std::memory_order_acquire) < 0; ++i) usleep(50'000);
      const int jp = g_cb_prio.load(std::memory_order_acquire);
      if (jp > 0) warp_werk->prioritaet(jp);
      else std::fprintf(stderr, "Warp-Werk: JACK-Faden ohne Echtzeit-Priorität (%d), die Fäden bleiben SCHED_OTHER\n", jp);
    });
  std::thread gr_prio;   // Baukasten S3b: Priorität der Fäden des Graph-Werks (JACK − 7)
  if (graph_werk->faeden() > 0)
    gr_prio = std::thread([&graph_werk] {
      for (int i = 0; i < 100 && g_cb_prio.load(std::memory_order_acquire) < 0; ++i) usleep(50'000);
      graph_werk->prioritaet(g_cb_prio.load(std::memory_order_acquire));   // jp <= 0: Meldung, synchron
    });
  std::thread kl_bau;
  if (keylock)
    kl_bau = std::thread([] {
      const int64_t t0 = mono_ns();
      const int jp = g_cb_prio.load(std::memory_order_acquire);
      if (jp <= 0) std::fprintf(stderr, "Keylock: JACK-Faden ohne Echtzeit-Priorität (%d), Keylock-Fäden bleiben SCHED_OTHER\n", jp);
      if (g_kern->keylock_bauen(jp, true)) {
        std::fprintf(stderr, "Keylock bereit nach %.1f ms (6 Dehner: 4 Decks, 2 Boxen; %s), die Quellen hängen ab dem nächsten Zyklus\n",
                     (double)(mono_ns() - t0) / 1e6, g_kern->keylock_faeden_laufen() ? "Fäden laufen" : "synchron im Callback, keine Fäden");
      }
    });
  // Scheibe 35, Plan E8: Verbinder im Hauptfaden, beim Start und alle 500 ms, wenn quelle_port da, aber nicht mit
  // hand_in verbunden ist. Jede neue Verbindung: erster Wert nur Stellung (§7.3 Punkt 2). Verbunden wird nur MIDI
  // (kein Ton, kein Riegel nötig, §8).
  uint64_t neuverbindungen = 0;
  // Paket 2 Slice 1 (B1): vor JEDEM eigenen jack_connect eine neue Karenz für den Selbst-Wächter (ein Graph-Umbau
  // hielt w gemessen 100,5 ms an); der Wächter prüft scharf_ab vor jedem Kill.
  // Fixup m1: scheitert der Connect, wird die Karenz zurückgenommen (sonst verlängerte jeder Fehlversuch sie alle 500 ms).
  auto karenz = [&]() {
    return g_ws ? cdj::karenz_beginnen(&g_ws->scharf_ab, mono_ns() + 500000000LL) : cdj::KarenzMarke{0, 0};
  };
  auto karenz_zurueck = [&](cdj::KarenzMarke m) {
    if (g_ws) cdj::karenz_zuruecknehmen(&g_ws->scharf_ab, m);
  };
  cdj::ZielUebergaenge ziel_uebergaenge;  // Fixup m2
  // Paket 2 Slice 1 (F05): Ausgänge g_aus[k] -> ziel[k] stehen im Betrieb nicht nur beim Start. Ziel-Liste ist die vom
  // Riegel beim Start geprüfte (riegel_erlaubt); es kommen keine neuen Ziele dazu.
  std::vector<cdj::Kante> soll_aus;
  for (int k = 0; k < n_ziele; ++k) soll_aus.push_back({jack_port_name(g_aus[k]), ziel[k]});
  std::vector<cdj::Kante> soll_alle = soll_aus;  // Slice 2: dazu die gefilterten Wirt-Kanten aus der Kanten-Datei
  std::vector<cdj::Kante> soll_datei, soll_ein;  // I08: Quelle 1 = Kanten-Datei, Quelle 2 = eingaenge-kanten; soll_alle = soll_aus + beide
  auto soll_neu = [&]() {
    soll_alle = soll_aus;
    soll_alle.insert(soll_alle.end(), soll_datei.begin(), soll_datei.end());
    soll_alle.insert(soll_alle.end(), soll_ein.begin(), soll_ein.end());
  };
  char kdir[128];
  cdj_shm_ordner(kdir, sizeof kdir, inst);
  const std::string kanten_pfad = std::string(kdir) + "/kanten";
  const std::string kern_praefix = std::string(jack_get_client_name(g_client)) + ":";
  struct stat kst_alt {};
  bool kanten_da = false;
  bool lesefehler_gemeldet = false;
  auto lade_kanten_datei = [&]() {  // bei Änderung (mtime, Größe) neu lesen; B9: nur Kern-MIDI-Ausgänge und Rückwege
    struct stat st {};
    if (stat(kanten_pfad.c_str(), &st) != 0) {
      if (kanten_da) { kanten_da = false; soll_datei.clear(); soll_neu(); }
      return;
    }
    if (kanten_da && st.st_mtim.tv_sec == kst_alt.st_mtim.tv_sec && st.st_mtim.tv_nsec == kst_alt.st_mtim.tv_nsec &&
        st.st_size == kst_alt.st_size)
      return;
    FILE* f = std::fopen(kanten_pfad.c_str(), "r");
    if (!f) {  // MINOR-4: Stand erst nach erfolgreichem Öffnen merken, nächster Takt versucht es neu
      if (!lesefehler_gemeldet)
        std::fprintf(stderr, "Kanten-Datei %s nicht lesbar: %s (neuer Versuch alle 500 ms, mono_ns %lld)\n",
                     kanten_pfad.c_str(), std::strerror(errno), (long long)mono_ns());
      lesefehler_gemeldet = true;
      return;
    }
    lesefehler_gemeldet = false;
    kst_alt = st;
    kanten_da = true;
    std::string text;
    char b[4096];
    size_t n;
    bool zu_gross = false;
    while ((n = std::fread(b, 1, sizeof b, f)) > 0) {  // MINOR-5: höchstens 64 KiB
      if (text.size() + n > cdj::KANTEN_DATEI_MAX) { text.append(b, cdj::KANTEN_DATEI_MAX - text.size()); zu_gross = true; break; }
      text.append(b, n);
    }
    std::fclose(f);
    const std::vector<cdj::Kante> alle = cdj::lies_kanten(text);
    size_t doppelt_oder_ueber = 0, reserviert = 0;
    const std::vector<cdj::Kante> ok = cdj::entdoppeln_begrenzen(cdj::filtere_kanten(alle, kern_praefix, &reserviert),
                                                                 cdj::KANTEN_MAX, &doppelt_oder_ueber);
    if (reserviert)  // D1 K1 (Spec 2.3): Grund reserviert, erz/4 gehört der Produktion
      std::fprintf(stderr, "Kanten-Datei %s: %zu Kanten auf rueck_erz_4 abgelehnt (reserviert)\n", kanten_pfad.c_str(), reserviert);
    soll_datei = ok;
    soll_neu();
    std::fprintf(stderr, "Kanten-Datei %s: %zu Kanten gelesen, %zu angenommen, %zu verworfen (davon %zu Duplikate oder über %zu)%s (mono_ns %lld)\n",
                 kanten_pfad.c_str(), alle.size(), ok.size(), alle.size() - ok.size(), doppelt_oder_ueber,
                 cdj::KANTEN_MAX, zu_gross ? ", Datei über 64 KiB abgeschnitten" : "", (long long)mono_ns());
  };
  // Review-Nachzug (MAJOR 2): ändert sich die Zuordnung oder fällt die Datei weg, werden die Eingangs-Kanten getrennt, die vorher aus dieser Datei
  // kamen und im Soll nicht mehr stehen (sonst liefen alte und neue Quelle summiert in ein_k). Fremde Kanten bleiben unberührt.
  auto ein_setzen = [&](std::vector<cdj::Kante> neu) {
    const std::vector<cdj::Kante> alt = std::move(soll_ein);
    soll_ein = std::move(neu);
    soll_neu();
    for (const cdj::Kante& k : cdj::wegfallende_kanten(alt, soll_alle)) {
      jack_port_t* pa = jack_port_by_name(g_client, k.quelle.c_str());
      if (!pa || !jack_port_connected_to(pa, k.ziel.c_str())) continue;
      const cdj::KarenzMarke km = karenz();
      if (jack_disconnect(g_client, k.quelle.c_str(), k.ziel.c_str()) != 0) { karenz_zurueck(km); continue; }
      std::fprintf(stderr, "Eingangs-Kante getrennt: %s -> %s (mono_ns %lld)\n", k.quelle.c_str(), k.ziel.c_str(), (long long)mono_ns());
    }
  };
  const std::string ein_pfad = std::string(kdir) + "/eingaenge-kanten";  // I08: vom Seiten-Server atomar geschrieben (Temp + rename)
  struct stat ein_st_alt {};
  bool ein_da = false;
  auto lade_ein_kanten = [&]() {
    struct stat st {};
    if (stat(ein_pfad.c_str(), &st) != 0) {
      if (ein_da) { ein_da = false; ein_setzen({}); }
      return;
    }
    if (ein_da && st.st_mtim.tv_sec == ein_st_alt.st_mtim.tv_sec && st.st_mtim.tv_nsec == ein_st_alt.st_mtim.tv_nsec &&
        st.st_size == ein_st_alt.st_size)
      return;
    FILE* f = std::fopen(ein_pfad.c_str(), "r");
    if (!f) return;  // nächster Takt versucht es neu
    ein_st_alt = st;
    ein_da = true;
    std::string text;
    char b[4096];
    size_t n;
    while ((n = std::fread(b, 1, sizeof b, f)) > 0) {
      if (text.size() + n > cdj::KANTEN_DATEI_MAX) { text.append(b, cdj::KANTEN_DATEI_MAX - text.size()); break; }
      text.append(b, n);
    }
    std::fclose(f);
    const std::vector<cdj::Kante> alle = cdj::lies_eingangs_kanten(text, kern_praefix);
    size_t doppelt = 0;
    ein_setzen(cdj::entdoppeln_begrenzen(alle, cdj::KANTEN_MAX, &doppelt));
    std::fprintf(stderr, "Eingangs-Kanten %s: %zu angenommen (mono_ns %lld)\n", ein_pfad.c_str(), soll_ein.size(), (long long)mono_ns());
  };
  cdj::KantenIst ist_jack{[](void*, const char* p) { return jack_port_by_name(g_client, p) != nullptr; },
                          [](void*, const char* a, const char* b) {
                            // von der eigenen Seite fragen: bei Wirt-Kanten ist a oder b ein fremder Port
                            jack_port_t* pa = jack_port_by_name(g_client, a);
                            if (pa && jack_port_is_mine(g_client, pa)) return jack_port_connected_to(pa, b) != 0;
                            jack_port_t* pb = jack_port_by_name(g_client, b);
                            return pb && jack_port_connected_to(pb, a) != 0;
                          },
                          nullptr};
  uint64_t aus_neu = 0;
  cdj::VerlustBuch buch;  // MINOR-2/6: Verlust einmal je Verlust, Scheitern höchstens alle 10 s, fremde Heilung löscht beides
  auto verbinde_ausgaenge = [&]() {
    lade_kanten_datei();
    lade_ein_kanten();
    buch.geheilte_abgleichen(soll_alle, ist_jack);
    for (const cdj::ZielEreignis& e : ziel_uebergaenge.pruefe(soll_alle, ist_jack))  // Fixup m2: einmalig je Richtung
      std::fprintf(stderr, e.wieder ? "Kante: Ziel wieder da: %s (mono_ns %lld)\n" : "Kante ohne Ziel: %s fehlt (mono_ns %lld)\n",
                   e.ziel.c_str(), (long long)mono_ns());
    for (const cdj::Kante& k : cdj::fehlende_kanten(soll_alle, ist_jack)) {
      if (buch.verlust_melden(k))
        std::fprintf(stderr, "Kante verloren: %s -> %s (mono_ns %lld)\n", k.quelle.c_str(), k.ziel.c_str(), (long long)mono_ns());
      const cdj::KarenzMarke km = karenz();
      if (jack_connect(g_client, k.quelle.c_str(), k.ziel.c_str()) != 0) {  // nächster Versuch in 500 ms
        karenz_zurueck(km);
        if (buch.scheitern_melden(k, mono_ns())) {
          std::fprintf(stderr, "Kante: Verbinden %s -> %s gescheitert, neuer Versuch alle 500 ms, Meldung höchstens alle 10 s (mono_ns %lld)\n",
                       k.quelle.c_str(), k.ziel.c_str(), (long long)mono_ns());
        }
        continue;
      }
      buch.verbunden(k);
      ++aus_neu;
      for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p) {  // F06/B10: PipeWire baut asynchron um, deshalb 150 ms und 500 ms später
        if (!g_midi_aus[p] || k.quelle != jack_port_name(g_midi_aus[p])) continue;
        g_allaus_plan[p].setze(mono_ns());
      }
      for (int s = 0; s < cdj::ARR_WIRT_SLOTS; ++s) {  // D1 K2b: dasselbe für die Wirt-Slots des Arrangements
        if (!g_arr_midi[s] || k.quelle != jack_port_name(g_arr_midi[s])) continue;
        g_arr_allaus_plan[s].setze(mono_ns());
      }
      std::fprintf(stderr, "Kante neu verbunden: %s -> %s (mono_ns %lld, Neuverbindung %llu)\n", k.quelle.c_str(),
                   k.ziel.c_str(), (long long)mono_ns(), (unsigned long long)aus_neu);
    }
  };
  auto verbinde = [&]() {
    verbinde_ausgaenge();
    uint32_t maske = 0;  // I08: was ist verbunden (Bit k-1: ein_k beide Kanäle, Bit 8: midi_ein_1)
    for (int k = 0; k < cdj::EIN_PAARE; ++k)
      if (g_ein[k][0] && g_ein[k][1] && jack_port_connected(g_ein[k][0]) > 0 && jack_port_connected(g_ein[k][1]) > 0) maske |= 1u << k;
    if (g_midi_ein && jack_port_connected(g_midi_ein) > 0) maske |= 1u << 8;
    g_kern->ein_verbunden(maske);
    if (!g_hand_in || !hand_quelle[0]) return;
    if (!jack_port_by_name(g_client, hand_quelle)) return;
    if (jack_port_connected_to(g_hand_in, hand_quelle)) return;
    const cdj::KarenzMarke km = karenz();
    if (jack_connect(g_client, hand_quelle, jack_port_name(g_hand_in)) != 0) {
      karenz_zurueck(km);
      return;
    }
    g_kern->hand_neu_verbunden();
    ++neuverbindungen;
    std::fprintf(stderr, "Hand: %s -> %s verbunden (mono_ns %lld, Verbindung %llu)\n", hand_quelle,
                 jack_port_name(g_hand_in), (long long)mono_ns(), (unsigned long long)neuverbindungen);
  };
  verbinde();
  int64_t naechster_verbinder = mono_ns() + 500'000'000LL;
  // Scheibe 18, ADR 016 Entscheidung 2: WATCHDOG=1 nur, wenn der Callback seit dem letzten Blick weitergelaufen ist
  cdj::Wachhund wachhund(cdj::Wachhund::aus_umgebung());
  int64_t naechster_wachhund = mono_ns();
  while (!g_stop.load()) {
    const int64_t jetzt = mono_ns();
    if (jetzt >= naechster_wachhund) {
      wachhund.pruefe(g_betrieb->zyklen());
      naechster_wachhund = jetzt + wachhund.takt_us() * 1000;
    }
    if (jetzt >= naechster_verbinder) {
#ifndef CYPHERDJ_MUTATION_HAND_VERBINDER_NUR_START  // Fehlerfall Plan 35 Task 7: nur der Versuch beim Start
      verbinde();
#endif
      // MVP 2 Scheibe 3 (E4, Review Scheibe 2 Fund 1): verlorene Ereignisse im Betrieb sichtbar (Journal), nicht erst
      // beim Beenden. Nur lesen, Diagnose; höchstens eine Zeile je 500 ms.
      static uint64_t verloren_gemeldet = 0;
      const uint64_t verloren = g_kern->ereignisse_verloren();
      if (verloren != verloren_gemeldet) {
        std::fprintf(stderr, "Ereignisring voll: %llu Ereignisse seit Start verworfen (+%llu)\n",
                     (unsigned long long)verloren, (unsigned long long)(verloren - verloren_gemeldet));
        verloren_gemeldet = verloren;
      }
      static uint64_t graph_gemeldet = 0;  // höchstens eine Zeile je 500 ms, nur bei Änderung
      if (const uint64_t ge = g_graph_ereignisse.load(std::memory_order_relaxed); ge != graph_gemeldet) {
        std::fprintf(stderr, "Graph geändert: Wächter-Karenz %llu Mal verlängert (mono_ns %lld)\n",
                     (unsigned long long)(ge - graph_gemeldet), (long long)mono_ns());
        graph_gemeldet = ge;
      }
      static uint64_t allaus_gemeldet[cdj::ERZ_MIDI_PORTS] = {}, luecken_gemeldet[cdj::ERZ_MIDI_PORTS] = {};
      for (int p = 0; p < cdj::ERZ_MIDI_PORTS; ++p) {  // B17: höchstens eine Zeile je Port und 500 ms
        const uint64_t g = g_allaus_gesendet[p].load(std::memory_order_relaxed);
        if (g != allaus_gemeldet[p]) {
          std::fprintf(stderr, "MIDI All-Off an midi_aus_%d gesendet (%llu) (mono_ns %lld)\n", p + 1, (unsigned long long)g,
                       (long long)mono_ns());
          allaus_gemeldet[p] = g;
        }
        const uint64_t l = g_allaus_luecken[p].load(std::memory_order_relaxed);
        if (l != luecken_gemeldet[p]) {
          std::fprintf(stderr, "MIDI All-Off an midi_aus_%d: Puffer voll, Rest im nächsten Zyklus (%llu Zyklen) (mono_ns %lld)\n",
                       p + 1, (unsigned long long)l, (long long)mono_ns());
          luecken_gemeldet[p] = l;
        }
      }
      static uint64_t arr_allaus_gemeldet[cdj::ARR_WIRT_SLOTS] = {}, arr_verloren_gemeldet[cdj::ARR_WIRT_SLOTS] = {};
      static uint64_t rb_verloren_gemeldet = 0, rb_abgelehnt_gemeldet = 0;
      const uint64_t rb_v = g_arr_rb_verloren.load(std::memory_order_relaxed);
      const uint64_t rb_a = g_arr_rb_abgelehnt.load(std::memory_order_relaxed);
      // K2b-Rest (Re-Review F9): „gesendet“ steht nur, wenn ein neues All-Off hinausging; verlorenes MIDI eines Slots und die
      // Zähler der RB-Senke (intern, kein Slot) haben je eine eigene Zeile mit eigener Kennung
      if (rb_v != rb_verloren_gemeldet || rb_a != rb_abgelehnt_gemeldet)
        std::fprintf(stderr, "RB-Senke (intern): Ereignisse verloren %llu, Parameter abgelehnt %llu (mono_ns %lld)\n",
                     (unsigned long long)rb_v, (unsigned long long)rb_a, (long long)mono_ns());
      for (int s = 0; s < cdj::ARR_WIRT_SLOTS; ++s) {  // D1 K2b: All-Off der Wirt-Slots, höchstens eine Zeile je 500 ms
        const uint64_t g = g_arr_allaus_gesendet[s].load(std::memory_order_relaxed);
        const uint64_t v = g_arr_midi_verloren[s].load(std::memory_order_relaxed);
        if (g != arr_allaus_gemeldet[s]) {
          std::fprintf(stderr, "MIDI All-Off an arr_midi_%d gesendet (%llu, Puffer voll in %llu Zyklen) (mono_ns %lld)\n",
                       s + 1, (unsigned long long)g,
                       (unsigned long long)g_arr_allaus_luecken[s].load(std::memory_order_relaxed), (long long)mono_ns());
          arr_allaus_gemeldet[s] = g;
        }
        if (v != arr_verloren_gemeldet[s]) {
          std::fprintf(stderr, "arr_midi_%d: MIDI verloren %llu (mono_ns %lld)\n", s + 1, (unsigned long long)v,
                       (long long)mono_ns());
          arr_verloren_gemeldet[s] = v;
        }
        // Messpunkt A4: jede Messung als JSON-Zeile an <shm>/arr-a4.jsonl, nur wenn die Datei schon da ist (die Messung
        // legt sie an und räumt sie weg); sonst still verworfen
        cdj::ArrWirtMessung me;
        while (g_kern->arr_wirt_messung(s + 1, me)) {
          const int fd = open((std::string(kdir) + "/arr-a4.jsonl").c_str(), O_WRONLY | O_APPEND | O_CLOEXEC);
          if (fd < 0) continue;
          char z[192];
          const int nz = std::snprintf(z, sizeof z,
                                       "{\"slot\":%d,\"ziel\":%lld,\"einsatz\":%lld,\"versatz\":%lld,\"vorhalt\":%lld}\n",
                                       (int)me.slot, (long long)me.ziel, (long long)me.einsatz,
                                       me.einsatz < 0 ? 0LL : (long long)(me.einsatz - me.ziel), (long long)me.vorhalt);
          if (nz > 0 && write(fd, z, (size_t)nz) != nz) std::perror("arr-a4.jsonl");
          close(fd);
        }
      }
      rb_verloren_gemeldet = rb_v;
      rb_abgelehnt_gemeldet = rb_a;
      naechster_verbinder += 500'000'000LL;
      if (naechster_verbinder < jetzt) naechster_verbinder = jetzt + 500'000'000LL;
    }
    const int64_t bis = std::min(naechster_wachhund, naechster_verbinder) - mono_ns();
    if (bis > 0) usleep((useconds_t)(bis / 1000));
  }
  if (g_ws) __atomic_store_n(&g_ws->ende, 1, __ATOMIC_RELEASE);  // geordnetes Ende: Wächter geht still
  long long cb_minflt = -1, cb_majflt = -1;  // Scheibe 31: vor dem Abmelden, solange der Faden lebt
  seitenfehler(g_cb_tid.load(), cb_minflt, cb_majflt);
  if (kl_bau.joinable()) kl_bau.join();  // Task 2.5b: ein laufender Bau (rund 270 ms) endet vor dem Abbau
  if (wk_prio.joinable()) wk_prio.join();
  if (gr_prio.joinable()) gr_prio.join();
  jack_deactivate(g_client);
  g_kern->keylock_faeden_stoppen();  // Keylock Task 2.5: Join (Wecker plus höchstens 20 ms Warten je Faden)
  graph_werk->stoppe();   // Baukasten S3b: nach jack_deactivate rechnet niemand mehr; danach die Schlusszeile
  {
    const cdj::GraphZaehler gz = graph_werk->zaehler();
    std::fprintf(stderr, "Graph-Werk: %llu Aufträge, %llu gestohlen, %llu Anlauf, %llu verspätet, %llu verworfen, %llu hängt, %llu Panik\n",
                 (unsigned long long)gz.auftraege, (unsigned long long)gz.gestohlen, (unsigned long long)gz.anlauf,
                 (unsigned long long)gz.verspaetet, (unsigned long long)gz.verworfen, (unsigned long long)gz.haengt,
                 (unsigned long long)gz.panik);
  }
  for (int i = 0, k = g_stolper_n.load(std::memory_order_acquire); i < k; ++i) {
    const Stolper& x = g_stolper[i];
    std::fprintf(stderr, "Stolper: zyklus %lld t_ns %lld wall_us %lld vor_ausgang_us %lld cpu_us %lld aufwach_us %lld minflt %ld majflt %ld nvcsw %ld nivcsw %ld\n",
                 (long long)x.zyklus, (long long)x.t_ns, (long long)(x.wall_ns / 1000), (long long)(x.vor_ns / 1000),
                 (long long)(x.cpu_ns / 1000), (long long)(x.aufwach_ns / 1000), x.minflt, x.majflt, x.nvcsw, x.nivcsw);
  }
  if (warp_werk) warp_werk->stoppe();   // 1.13 Slice 2: kein Faden liest mehr Audio; erst danach darf der Lade-Faden alles freigeben
  faden.join();
  lader_faden.join();
  arr_faden.join();
  jack_client_close(g_client);
  if (g_faehig_pfad[0]) unlink(g_faehig_pfad);   // S7 (Review-Kern n1)
  netz.ereignisse_senden();  // Scheibe 25: die letzten ZYKLUS-Ereignisse in die Verteilung
  const cdj::Verteilung& vt = netz.verteilung();
  std::fprintf(stderr,
               "{\"zyklen\":%llu,\"frame_luecken_gesamt\":%lld,\"ausgelassen_gesamt\":%lld,\"verbrannt\":%llu,"
               "\"ereignisse_verloren\":%llu,\"w\":%llu,\"cb_n\":%llu,\"cb_p50_us\":%d,\"cb_p99_us\":%d,"
               "\"cb_p999_us\":%d,\"cb_max_us\":%d,\"cb_minflt\":%lld,\"cb_majflt\":%lld,\"gesperrt_mib\":%lld,"
               "\"hand_ereignisse\":%llu,\"hand_ohne_wirkung\":%llu,\"hand_ueberlauf\":%llu,"
               "\"hand_neuverbindungen\":%llu}\n",
               (unsigned long long)g_messer->zyklen(), (long long)g_messer->luecken_gesamt(),
               (long long)g_messer->ausgelassen_gesamt(), (unsigned long long)g_messer->verbrannt(),
               (unsigned long long)g_kern->ereignisse_verloren(), (unsigned long long)cdj_lade(&ring->w),
               (unsigned long long)vt.anzahl(), vt.quantil(0.5), vt.quantil(0.99), vt.quantil(0.999), vt.max(),
               cb_minflt, cb_majflt, (long long)(lader.gesperrt() >> 20),
               (unsigned long long)g_kern->hand_ereignisse(), (unsigned long long)g_kern->hand_ohne_wirkung(),
               (unsigned long long)g_kern->hand_ueberlauf(), (unsigned long long)neuverbindungen);
  // Keylock Task 7 Step 1 (Gate G1): Kosten und Zähler je Quelle, nach dem Join der Keylock-Fäden (oben)
  std::fprintf(stderr, "%s\n", g_kern->keylock_schluss_json().c_str());
  if (warp_werk) std::fprintf(stderr, "%s\n", warp_werk->schluss_json().c_str());   // 1.13 Slice 2: Kosten je Block und Auftrag, CPU je Faden
  return 0;
}
