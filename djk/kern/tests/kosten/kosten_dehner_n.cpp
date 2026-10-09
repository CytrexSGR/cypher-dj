// Keylock Task 7 Step 1a (Plan 2026-10-06-keylock-echtzeit.md, Detailschnitt 7a, Gate G1 offline): trägt der Arbeits-
// Thread N rechnende Dehner? N Dehner mit je einem echten Arbeits-Thread und einem Vorbereiter für alle, wie im Kern
// (kern_deck.cpp kl_arbeiter, kl_vorbereiter); ein Callback-Faden im 5,33-ms-Takt (256 Frames, clock_nanosleep absolut)
// liest je Quelle über einen StreckLeser (block_anfang, mische je Sample in einen Wegwerf-Puffer) und weckt danach
// Vorbereiter und Arbeits-Threads. Band jeder Quelle: BoxBand (loopbox.h), abwechselnd ein 4-Beat-Klick-Loop (erzeugt)
// und ein Musik-Loop (Datei). Karte fest oder Rampe.
//   Gezählt: Ring-Unterläufe (unterlauf_n, hart_n), verpasst_n, aufgegeben_n, ring_voll(), Zyklen des Callback-Fadens über
//   der Frist (Dauer > 5333 µs oder Aufwachen > 1 Takt zu spät), Callback-Dauer (p50/p99/p99,9/max), nach dem Join
//   kosten_render() je Dehner (p50/p99/p99,9/max, nur synchron lesbar, dehner.h), CPU je Faden aus /proc/self/task/<tid>/stat,
//   VmRSS und VmLck. Kein Test: die Zahlen gehören in den Bericht (Echtzeit-Schloss, ruhige Maschine).
// Aufruf: kern_kosten_dehner_n --n 4 --fall 132 --sek 60 --musik <loop-ordner> [--fifo 80] [--json]
//   --fall: Tempo (z. B. 100, 132, 170) oder "rampe" (100 -> 170 über 32 Beats ab Beat 8, dann 170 -> 100 über 32, im Wechsel)
//   --fifo P: Callback SCHED_FIFO P, Vorbereiter und Arbeits-Threads P − 5 (wie Vertrag 12); 0: alles SCHED_OTHER
//   --last K: K zusätzliche Busy-Fäden SCHED_FIFO P − 5 ab --last-ab S Sekunden (Instrument-Check, mit taskset auf einen
//   Kern: die Arbeits-Threads verhungern, Unterläufe MÜSSEN dann erscheinen)
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "cypherdj/dehner.h"
#include "cypherdj/loop.h"
#include "cypherdj/loopbox.h"
#include "cypherdj/streck_quelle.h"

namespace {

constexpr int B = 256;
constexpr int64_t TAKT_NS = 5333333;  // 256 / 48000 s

int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}
long tid() { return syscall(SYS_gettid); }

struct Faden {
  pthread_t t{};
  std::atomic<long> tid{0};
  std::string name;
};

struct Lauf {
  int n = 4;
  double bpm = 132.0;
  bool rampe = false;
  int sek = 60;
  int fifo = 80;
  int last = 0;
  int last_ab_s = 0;  // die Last-Fäden beginnen erst nach so vielen Sekunden (der Ring läuft dann schon)
  cdj::Karte k;
  uint32_t gen = 1;
  std::vector<std::unique_ptr<cdj::DehnerBasis>> d;
  std::vector<cdj::StreckPost> post;
  std::vector<cdj::StreckLeser> les;
  std::vector<cdj::BoxBand> band;
  std::vector<sem_t> sem;  // 0 Vorbereiter, 1..n Arbeits-Threads
  std::atomic<bool> stop{false};
  std::vector<Faden> faeden;  // 0 Callback, 1 Vorbereiter, 2..n+1 Arbeits, dann Last
  // Callback-Statistik (nur der Callback-Faden schreibt, gelesen nach dem Join)
  std::vector<uint32_t> cb_us = std::vector<uint32_t>(20001, 0);
  uint64_t cb_n = 0, cb_ueber = 0, cb_spaet = 0;
  int64_t cb_max_ns = 0;
  double cb_cpu_s = 0.0;  // CLOCK_THREAD_CPUTIME_ID am Ende des Callback-Fadens
};

Lauf* L = nullptr;

void setze_prio(int p) {
  if (p <= 0) return;
  sched_param sp{};
  sp.sched_priority = p;
  if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp) != 0)
    std::fprintf(stderr, "SCHED_FIFO %d nicht gesetzt: %s\n", p, std::strerror(errno));
}

void warte(sem_t* s, int ms) {
  timespec t;
  clock_gettime(CLOCK_REALTIME, &t);
  t.tv_nsec += (long)ms * 1000000L;
  while (t.tv_nsec >= 1000000000L) {
    t.tv_nsec -= 1000000000L;
    ++t.tv_sec;
  }
  while (sem_timedwait(s, &t) != 0 && errno == EINTR) {
  }
  while (sem_trywait(s) == 0) {
  }
}
void wecke(sem_t* s) {
  int v = 0;
  if (sem_getvalue(s, &v) == 0 && v > 0) return;
  sem_post(s);
}

void* vorbereiter(void*) {
  L->faeden[1].tid = tid();
  pthread_setname_np(pthread_self(), "kl-vorbereiter");
  setze_prio(L->fifo > 0 ? L->fifo - 5 : 0);
  while (!L->stop.load(std::memory_order_acquire)) {
    warte(&L->sem[0], 20);
    for (int i = 0; i < L->n; ++i) {
      const uint64_t vor = L->post[i].antwort();
      L->post[i].takt(*L->d[i]);
      if (L->post[i].antwort() != vor) wecke(&L->sem[1 + i]);
    }
  }
  return nullptr;
}

void* arbeiter(void* p) {
  const int i = (int)(intptr_t)p;
  L->faeden[2 + i].tid = tid();
  char nm[16];
  std::snprintf(nm, sizeof nm, "kl-arbeit-%d", i + 1);
  pthread_setname_np(pthread_self(), nm);
  setze_prio(L->fifo > 0 ? L->fifo - 5 : 0);
  while (!L->stop.load(std::memory_order_acquire)) {
    warte(&L->sem[1 + i], 20);
    L->d[i]->fuelle_synchron();
    L->d[i]->fuelle_synchron();
  }
  return nullptr;
}

void* belaste(void* p) {
  const int i = (int)(intptr_t)p;
  L->faeden[2 + L->n + i].tid = tid();
  pthread_setname_np(pthread_self(), "kl-last");
  setze_prio(L->fifo > 0 ? L->fifo - 5 : 0);
  const int64_t ab = jetzt_ns() + (int64_t)L->last_ab_s * 1000000000LL;
  while (jetzt_ns() < ab && !L->stop.load(std::memory_order_relaxed)) usleep(10000);
  volatile uint64_t x = 0;
  while (!L->stop.load(std::memory_order_relaxed)) x = x + 1;
  return nullptr;
}

void* rueckruf(void*) {
  L->faeden[0].tid = tid();
  pthread_setname_np(pthread_self(), "callback");
  setze_prio(L->fifo);
  static float wl[B], wr[B], vl[cdj::STRECK_BLENDE] = {}, vr[cdj::STRECK_BLENDE] = {};
  const int64_t ende_s = (int64_t)L->sek * 48000;
  int64_t s = 0;
  int64_t t_soll = jetzt_ns() + TAKT_NS;
  for (int i = 0; i < L->n; ++i) {
    const cdj::Loop& lp = *L->band[i].loop;
    L->les[i].ansetzen(0, &L->band[i], cdj::box_anker(L->k, 0, lp.beats, lp.frames, 0));
  }
  while (s < ende_s) {
    timespec ts{(time_t)(t_soll / 1000000000LL), (long)(t_soll % 1000000000LL)};
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, nullptr);
    const int64_t t0 = jetzt_ns();
    if (t0 - t_soll > TAKT_NS) ++L->cb_spaet;
    for (int i = 0; i < L->n; ++i) {
      cdj::StreckLeser& r = L->les[i];
      if (r.block_anfang(s, B)) {
        r.einfrieren(s, 1.0f, 1.0f, vl, vr, cdj::STRECK_BLENDE);
        r.unterlauf(s);
      }
      for (int j = 0; j < B; ++j) {
        float a = 0.0f, b = 0.0f;
        r.mische(j, s + j, true, 1.0f, false, 1.0f, false, a, b);
        wl[j] = a;
        wr[j] = b;
      }
    }
    wecke(&L->sem[0]);
    for (int i = 0; i < L->n; ++i) wecke(&L->sem[1 + i]);
    const int64_t dt = jetzt_ns() - t0;
    ++L->cb_n;
    if (dt > L->cb_max_ns) L->cb_max_ns = dt;
    if (dt > TAKT_NS) ++L->cb_ueber;
    ++L->cb_us[(size_t)std::min<int64_t>(dt / 1000, 20000)];
    s += B;
    t_soll += TAKT_NS;
  }
  (void)wl;
  (void)wr;
  timespec c;
  clock_gettime(CLOCK_THREAD_CPUTIME_ID, &c);
  L->cb_cpu_s = (double)c.tv_sec + (double)c.tv_nsec / 1e9;
  return nullptr;
}

double quantil(const std::vector<uint32_t>& h, uint64_t n, double q) {
  if (!n) return 0;
  const uint64_t ziel = (uint64_t)(q * (double)n + 0.999999);
  uint64_t a = 0;
  for (size_t i = 0; i < h.size(); ++i) {
    a += h[i];
    if (a >= ziel) return (double)i;
  }
  return (double)h.size() - 1;
}

long cpu_ticks(long t) {
  std::ifstream f("/proc/self/task/" + std::to_string(t) + "/stat");
  std::string s((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  const size_t p = s.rfind(')');
  if (p == std::string::npos) return -1;
  std::istringstream is(s.substr(p + 2));
  std::string x;
  long ut = 0, st = 0;
  for (int i = 0; i < 13 && is >> x; ++i) {
    if (i == 11) ut = std::atol(x.c_str());
    if (i == 12) st = std::atol(x.c_str());
  }
  return ut + st;
}

long status_kib(const char* feld) {
  std::ifstream f("/proc/self/status");
  std::string z;
  while (std::getline(f, z))
    if (z.rfind(feld, 0) == 0) return std::atol(z.c_str() + std::strlen(feld));
  return -1;
}

std::unique_ptr<cdj::Loop> klick_loop() {
  auto l = std::make_unique<cdj::Loop>();
  l->name = "klick4";
  l->beats = 4;
  l->frames = 4 * cdj::LOOP_SPB;
  l->daten.assign((size_t)(2 * l->frames), 0.0f);
  for (int b = 0; b < 4; ++b)
    for (int j = 0; j < 480; ++j) {
      const float v = (float)(0.5 * std::exp(-j / 80.0) * std::sin(2.0 * M_PI * 2000.0 * j / 48000.0));
      const size_t i = (size_t)(b * cdj::LOOP_SPB + j);
      l->daten[2 * i] = l->daten[2 * i + 1] = v;
    }
  return l;
}

}  // namespace

int main(int argc, char** argv) {
  Lauf lauf;
  L = &lauf;
  std::string musik, fall = "132";
  for (int i = 1; i + 1 < argc; i += 2) {
    const std::string a = argv[i], v = argv[i + 1];
    if (a == "--n") lauf.n = std::atoi(v.c_str());
    else if (a == "--fall") fall = v;
    else if (a == "--sek") lauf.sek = std::atoi(v.c_str());
    else if (a == "--musik") musik = v;
    else if (a == "--fifo") lauf.fifo = std::atoi(v.c_str());
    else if (a == "--last") lauf.last = std::atoi(v.c_str());
    else if (a == "--last-ab") lauf.last_ab_s = std::atoi(v.c_str());
  }
  if (fall == "rampe") {
    lauf.rampe = true;
    lauf.k = cdj::Karte(100.0, 0);
    double b = 8.0;
    bool hoch = true;
    while (b < 400.0) {  // 60 s bei höchstens 170 BPM sind 170 Beats; 64 Segmente reichen für rund 30 Rampen
      if (!lauf.k.rampe(b, hoch ? 170.0 : 100.0, 32.0)) break;
      b += 40.0;
      hoch = !hoch;
    }
  } else {
    lauf.bpm = std::atof(fall.c_str());
    lauf.k = cdj::Karte(lauf.bpm, 0);
  }
  std::string fehler;
  std::unique_ptr<cdj::Loop> mloop = musik.empty() ? nullptr : cdj::lade_loop(musik, &fehler);
  if (!musik.empty() && !mloop) {
    std::fprintf(stderr, "Musik-Loop %s: %s\n", musik.c_str(), fehler.c_str());
    return 2;
  }
  std::unique_ptr<cdj::Loop> kloop = klick_loop();
  rlimit rl{};
  getrlimit(RLIMIT_RTPRIO, &rl);
  const int64_t t_bau = jetzt_ns();
  lauf.d.resize((size_t)lauf.n);
  lauf.post = std::vector<cdj::StreckPost>((size_t)lauf.n);
  lauf.les = std::vector<cdj::StreckLeser>((size_t)lauf.n);
  lauf.band.resize((size_t)lauf.n);
  for (int i = 0; i < lauf.n; ++i) {
    lauf.d[i] = cdj::dehner_neu(i + 1);
    if (!lauf.d[i]) {
      std::fprintf(stderr, "kein Dehner (Stub?)\n");
      return 2;
    }
    lauf.band[i].loop = (i % 2 == 1 && mloop) ? mloop.get() : kloop.get();
    lauf.les[i].verbinde(lauf.d[i].get(), &lauf.post[i], &lauf.k, &lauf.gen);
  }
  const double bau_ms = (double)(jetzt_ns() - t_bau) / 1e6;
  lauf.sem.resize((size_t)lauf.n + 1);
  for (sem_t& s : lauf.sem) sem_init(&s, 0, 0);
  const int ml = mlockall(MCL_CURRENT | MCL_FUTURE);
  lauf.faeden = std::vector<Faden>((size_t)(2 + lauf.n + lauf.last));
  pthread_create(&lauf.faeden[1].t, nullptr, vorbereiter, nullptr);
  for (int i = 0; i < lauf.n; ++i) pthread_create(&lauf.faeden[2 + i].t, nullptr, arbeiter, (void*)(intptr_t)i);
  for (int i = 0; i < lauf.last; ++i)
    pthread_create(&lauf.faeden[2 + lauf.n + i].t, nullptr, belaste, (void*)(intptr_t)i);
  const int64_t t0 = jetzt_ns();
  pthread_create(&lauf.faeden[0].t, nullptr, rueckruf, nullptr);
  pthread_join(lauf.faeden[0].t, nullptr);
  const double wand_s = (double)(jetzt_ns() - t0) / 1e9;
  // CPU vor dem Join der übrigen (danach sind die tids weg)
  std::vector<long> cpu(lauf.faeden.size());
  for (size_t i = 0; i < lauf.faeden.size(); ++i) cpu[i] = cpu_ticks(lauf.faeden[i].tid.load());
  const long rss = status_kib("VmRSS:"), lck = status_kib("VmLck:");
  lauf.stop.store(true);
  for (sem_t& s : lauf.sem) sem_post(&s);
  for (size_t i = 1; i < lauf.faeden.size(); ++i) pthread_join(lauf.faeden[i].t, nullptr);
  const long hz = sysconf(_SC_CLK_TCK);
  std::printf("{\"n\":%d,\"fall\":\"%s\",\"sek\":%d,\"wand_s\":%.2f,\"fifo\":%d,\"last\":%d,\"rtprio_max\":%ld,"
              "\"mlockall\":%d,\"bau_ms\":%.1f,\"vmrss_kib\":%ld,\"vmlck_kib\":%ld,",
              lauf.n, fall.c_str(), lauf.sek, wand_s, lauf.fifo, lauf.last, (long)rl.rlim_cur, ml, bau_ms, rss, lck);
  std::printf("\"cb\":{\"n\":%llu,\"p50_us\":%.0f,\"p99_us\":%.0f,\"p999_us\":%.0f,\"max_us\":%.1f,\"ueber_frist\":%llu,"
              "\"spaet\":%llu,\"cpu_s\":%.2f},",
              (unsigned long long)lauf.cb_n, quantil(lauf.cb_us, lauf.cb_n, 0.5), quantil(lauf.cb_us, lauf.cb_n, 0.99),
              quantil(lauf.cb_us, lauf.cb_n, 0.999), lauf.cb_max_ns / 1e3, (unsigned long long)lauf.cb_ueber,
              (unsigned long long)lauf.cb_spaet, lauf.cb_cpu_s);
  std::printf("\"vorbereiter_cpu_s\":%.2f,\"quellen\":[", (double)cpu[1] / hz);
  uint64_t su = 0, sh = 0, sa = 0, sv = 0, sr = 0;
  for (int i = 0; i < lauf.n; ++i) {
    const cdj::DehnerKosten& kr = lauf.d[i]->kosten_render();
    const cdj::StreckLeser& r = lauf.les[i];
    su += r.unterlauf_n();
    sh += r.hart_n();
    sa += r.aufgegeben_n();
    sv += r.verpasst_n();
    sr += lauf.d[i]->ring_voll();
    std::printf("%s{\"q\":%d,\"band\":\"%s\",\"cpu_s\":%.2f,\"render_n\":%llu,\"render_p50_us\":%.0f,\"render_p99_us\":%.0f,"
                "\"render_p999_us\":%.0f,\"render_max_us\":%.1f,\"unterlauf\":%llu,\"hart\":%llu,\"verpasst\":%llu,"
                "\"aufgegeben\":%llu,\"ring_voll\":%llu,\"gelesen\":%llu,\"ring_hoerbar\":%d,\"kurz\":%llu,"
                "\"auffuellen_kurz\":%llu}",
                i ? "," : "", i + 1, lauf.band[i].loop->name.c_str(), (double)cpu[2 + i] / hz, (unsigned long long)kr.n,
                kr.quantil_us(0.5), kr.quantil_us(0.99), kr.quantil_us(0.999), kr.max_ns / 1e3,
                (unsigned long long)r.unterlauf_n(), (unsigned long long)r.hart_n(), (unsigned long long)r.verpasst_n(),
                (unsigned long long)r.aufgegeben_n(), (unsigned long long)lauf.d[i]->ring_voll(),
                (unsigned long long)r.gelesen(), r.ring_hoerbar() ? 1 : 0, (unsigned long long)r.kurz_n(),
                (unsigned long long)lauf.d[i]->auffuellen_kurz());
  }
  std::printf("],\"summe\":{\"unterlauf\":%llu,\"hart\":%llu,\"verpasst\":%llu,\"aufgegeben\":%llu,\"ring_voll\":%llu}}\n",
              (unsigned long long)su, (unsigned long long)sh, (unsigned long long)sv, (unsigned long long)sa,
              (unsigned long long)sr);
  return 0;
}
