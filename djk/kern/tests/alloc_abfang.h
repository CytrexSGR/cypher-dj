// Allokations-Abfang für Tests (Plan Keylock, Messgröße „Allokation“): ersetzt malloc, calloc, realloc, posix_memalign,
// aligned_alloc, memalign, valloc und fftw_malloc im Prozess durch Zähler, die zur echten Funktion (dlsym RTLD_NEXT)
// durchreichen. operator new und delete landen in malloc und werden mitgezählt. Gezählt wird nur in dem Faden, der
// `abfang_an()` gerufen hat (thread_local), nur bis `abfang_aus()`.
// D1 K3 Fix L2: im selben Fenster zählt der Abfang auch free (ungleich null), blockierende Sperren
// (pthread_mutex_lock/timedlock/clocklock, pthread_rwlock_rdlock/wrlock und ihre timed-Formen, pthread_spin_lock,
// pthread_cond_wait/timedwait/clockwait, sem_wait/timedwait/clockwait, syscall(SYS_futex) mit einer Warte-Operation, so
// wartet std::atomic::wait) und Schlafen (nanosleep, clock_nanosleep, usleep, sleep). std::mutex, std::condition_variable
// und std::this_thread::sleep_for laufen über diese Funktionen. Nicht gezählt: trylock-Formen und futex-Wecken (beide
// blockieren nicht) und was die C-Bibliothek intern sperrt (dort ohne Umweg über diese Symbole).
// GRENZE (Fix 2/P2): Primitive, die selbst auf einem Futex-Wort arbeiten (std::binary_semaphore, std::counting_semaphore,
// std::latch, std::barrier, std::atomic::wait und die freien Formen std::atomic_wait, std::atomic_flag_wait samt
// _explicit), sieht der Wächter nur, wenn sie wirklich in den Kernel gehen (syscall SYS_futex); unbelastet bleiben sie
// im Nutzerraum und ungezählt (gemessen: binary_semaphore 1000-mal genommen, 0 gezählt; std::mutex 1000-mal, 1000
// gezählt; ~/messungen/2026-10-15-d1-k3/fix2/p2_waechter_grenze.txt; std::atomic_wait in freeze_abgriff ungezählt,
// rereview-fix2/g1_atomic_wait_frei.txt). Ein grüner Wächter belegt darum nicht, dass kein solches Primitiv im Pfad
// steht; das trägt für Arrangement und Freeze die statische Prüfung test_echtzeit_quellen.py (Liste der Echtzeit-Quellen
// dort): sie verbietet die Köpfe <mutex>, <shared_mutex>, <condition_variable>, <semaphore>, <latch>, <barrier>, die
// Methodenaufrufe .wait/.acquire/.try_acquire*/.arrive_and_wait und (Fix 3/Q1) die vier freien Warte-Funktionen aus
// <atomic>, je Form mit Positiv-Kontrolle im Lauf. `abfang_aus()` liefert wie
// bisher die Allokationen (die Keylock-Tests zählen nur sie); `abfang_zahlen()` alle vier Zähler des letzten Fensters.
// Genau EINE Übersetzungseinheit je Programm darf diesen Kopf einbinden (er definiert die Symbole selbst).
// Unter AddressSanitizer und ThreadSanitizer fehlt der Abfang (deren Laufzeit besetzt dieselben Symbole):
// ALLOC_ABFANG_VERFUEGBAR ist dann 0 und der Test meldet „übersprungen“, nie „bestanden“.
#pragma once

#include <cstddef>

// Zähler eines Fensters (abfang_an bis abfang_aus)
struct AbfangZahlen {
  long alloc = 0, frei = 0, sperren = 0, schlafen = 0;
  long summe() const { return alloc + frei + sperren + schlafen; }
  AbfangZahlen& operator+=(const AbfangZahlen& o) {
    alloc += o.alloc;
    frei += o.frei;
    sperren += o.sperren;
    schlafen += o.schlafen;
    return *this;
  }
};

#if defined(__SANITIZE_ADDRESS__) || defined(__SANITIZE_THREAD__)
#define ALLOC_ABFANG_VERFUEGBAR 0
inline void abfang_an() {}
inline long abfang_aus() { return -1; }
inline AbfangZahlen abfang_zahlen() { return AbfangZahlen{-1, -1, -1, -1}; }
#else
#define ALLOC_ABFANG_VERFUEGBAR 1

#include <dlfcn.h>
#include <pthread.h>
#include <semaphore.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>
#include <linux/futex.h>

#include <cerrno>
#include <cstdarg>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace abfang_intern {
inline thread_local bool an = false;
inline thread_local long zaehler = 0;   // Allokationen
inline thread_local long frei = 0, sperren = 0, schlafen = 0;
inline void zaehle() {
  if (an) ++zaehler;
}
inline void zaehle_frei() {
  if (an) ++frei;
}
inline void zaehle_sperre() {
  if (an) ++sperren;
}
inline void zaehle_schlaf() {
  if (an) ++schlafen;
}
// Echte Funktion beim ersten Aufruf holen (dlsym RTLD_NEXT); dlsym selbst sperrt nur intern, ohne diese Symbole
template <typename F>
inline F echt(F& f, const char* name) {
  if (!f) f = reinterpret_cast<F>(dlsym(RTLD_NEXT, name));
  return f;
}
using malloc_f = void* (*)(size_t);
using calloc_f = void* (*)(size_t, size_t);
using realloc_f = void* (*)(void*, size_t);
using pm_f = int (*)(void**, size_t, size_t);
using am_f = void* (*)(size_t, size_t);
using mem_f = void* (*)(size_t, size_t);
using valloc_f = void* (*)(size_t);
inline malloc_f r_malloc = nullptr;
inline calloc_f r_calloc = nullptr;
inline realloc_f r_realloc = nullptr;
inline pm_f r_pm = nullptr;
inline am_f r_am = nullptr;
inline mem_f r_mem = nullptr;
inline valloc_f r_valloc = nullptr;
inline malloc_f r_fftw = nullptr;
inline bool initialisiert = false, in_init = false;
// dlsym ruft selbst calloc: dafür ein kleiner statischer Vorrat
alignas(16) inline char boot[4096];
inline size_t boot_pos = 0;
inline void* boot_alloc(size_t n) {
  n = (n + 15) & ~size_t(15);
  if (boot_pos + n > sizeof boot) return nullptr;
  void* p = boot + boot_pos;
  boot_pos += n;
  return p;
}
inline void init() {
  if (initialisiert || in_init) return;
  in_init = true;
  r_malloc = reinterpret_cast<malloc_f>(dlsym(RTLD_NEXT, "malloc"));
  r_calloc = reinterpret_cast<calloc_f>(dlsym(RTLD_NEXT, "calloc"));
  r_realloc = reinterpret_cast<realloc_f>(dlsym(RTLD_NEXT, "realloc"));
  r_pm = reinterpret_cast<pm_f>(dlsym(RTLD_NEXT, "posix_memalign"));
  r_am = reinterpret_cast<am_f>(dlsym(RTLD_NEXT, "aligned_alloc"));
  r_mem = reinterpret_cast<mem_f>(dlsym(RTLD_NEXT, "memalign"));
  r_valloc = reinterpret_cast<valloc_f>(dlsym(RTLD_NEXT, "valloc"));
  r_fftw = reinterpret_cast<malloc_f>(dlsym(RTLD_NEXT, "fftw_malloc"));  // kann fehlen (kein fftw gelinkt)
  initialisiert = true;
  in_init = false;
}
inline bool im_boot(void* p) { return p >= static_cast<void*>(boot) && p < static_cast<void*>(boot + sizeof boot); }
}  // namespace abfang_intern

extern "C" {
void* malloc(size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) {
    if (in_init) return boot_alloc(n);
    init();
  }
  zaehle();
  return r_malloc(n);
}
void* calloc(size_t a, size_t b) {
  using namespace abfang_intern;
  if (!initialisiert) {
    if (in_init) {
      void* p = boot_alloc(a * b);
      if (p) std::memset(p, 0, a * b);
      return p;
    }
    init();
  }
  zaehle();
  return r_calloc(a, b);
}
void* realloc(void* p, size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  if (p && im_boot(p)) {  // Vorrat: kopieren, nie freigeben
    void* q = r_malloc(n);
    if (q) std::memcpy(q, p, n);
    return q;
  }
  return r_realloc(p, n);
}
void free(void* p) {
  using namespace abfang_intern;
  if (!p || im_boot(p)) return;
  zaehle_frei();
  using free_f = void (*)(void*);
  static free_f r_free = reinterpret_cast<free_f>(dlsym(RTLD_NEXT, "free"));
  r_free(p);
}
int posix_memalign(void** out, size_t al, size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_pm(out, al, n);
}
void* aligned_alloc(size_t al, size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_am(al, n);
}
void* memalign(size_t al, size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_mem(al, n);
}
void* valloc(size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_valloc(n);
}
void* fftw_malloc(size_t n) {
  using namespace abfang_intern;
  if (!initialisiert) init();
  zaehle();
  return r_fftw ? r_fftw(n) : r_malloc(n);
}

// ---- D1 K3 Fix L2: blockierende Sperren und Schlafen (durchgereicht wie malloc, gezählt im Fenster)
#define ABFANG_SPERRE(rueck, name, sig, args)                      \
  rueck name sig noexcept {                                        \
    using f_t = rueck(*) sig;                                      \
    static f_t r = nullptr;                                        \
    abfang_intern::zaehle_sperre();                                \
    return abfang_intern::echt(r, #name) args;                     \
  }
#define ABFANG_SCHLAF(rueck, name, sig, args)                      \
  rueck name sig noexcept {                                        \
    using f_t = rueck(*) sig;                                      \
    static f_t r = nullptr;                                        \
    abfang_intern::zaehle_schlaf();                                \
    return abfang_intern::echt(r, #name) args;                     \
  }
ABFANG_SPERRE(int, pthread_mutex_lock, (pthread_mutex_t* m), (m))
ABFANG_SPERRE(int, pthread_mutex_timedlock, (pthread_mutex_t* m, const struct timespec* t), (m, t))
ABFANG_SPERRE(int, pthread_mutex_clocklock, (pthread_mutex_t* m, clockid_t c, const struct timespec* t), (m, c, t))
ABFANG_SPERRE(int, pthread_rwlock_rdlock, (pthread_rwlock_t* m), (m))
ABFANG_SPERRE(int, pthread_rwlock_wrlock, (pthread_rwlock_t* m), (m))
ABFANG_SPERRE(int, pthread_rwlock_timedrdlock, (pthread_rwlock_t* m, const struct timespec* t), (m, t))
ABFANG_SPERRE(int, pthread_rwlock_timedwrlock, (pthread_rwlock_t* m, const struct timespec* t), (m, t))
ABFANG_SPERRE(int, pthread_spin_lock, (pthread_spinlock_t* m), (m))
ABFANG_SPERRE(int, pthread_cond_wait, (pthread_cond_t* c, pthread_mutex_t* m), (c, m))
ABFANG_SPERRE(int, pthread_cond_timedwait, (pthread_cond_t* c, pthread_mutex_t* m, const struct timespec* t), (c, m, t))
ABFANG_SPERRE(int, pthread_cond_clockwait,
              (pthread_cond_t* c, pthread_mutex_t* m, clockid_t k, const struct timespec* t), (c, m, k, t))
ABFANG_SPERRE(int, sem_wait, (sem_t* s), (s))
ABFANG_SPERRE(int, sem_timedwait, (sem_t* s, const struct timespec* t), (s, t))
ABFANG_SPERRE(int, sem_clockwait, (sem_t* s, clockid_t c, const struct timespec* t), (s, c, t))
ABFANG_SCHLAF(int, nanosleep, (const struct timespec* a, struct timespec* b), (a, b))
ABFANG_SCHLAF(int, clock_nanosleep, (clockid_t c, int f, const struct timespec* a, struct timespec* b), (c, f, a, b))
ABFANG_SCHLAF(int, usleep, (useconds_t u), (u))
ABFANG_SCHLAF(unsigned int, sleep, (unsigned int s), (s))
#undef ABFANG_SPERRE
#undef ABFANG_SCHLAF

// syscall(SYS_futex, …) mit einer Warte-Operation (std::atomic::wait, std::counting_semaphore); alle Argumente sind auf
// x86_64 und aarch64 registerbreit, darum reicht das Durchreichen von sechs long
long syscall(long nr, ...) noexcept {
  using f_t = long (*)(long, ...);
  static f_t r = nullptr;
  va_list ap;
  va_start(ap, nr);
  long a[6];
  for (long& x : a) x = va_arg(ap, long);
  va_end(ap);
  if (nr == SYS_futex) {
    const int op = static_cast<int>(a[1]) & FUTEX_CMD_MASK;
    if (op == FUTEX_WAIT || op == FUTEX_WAIT_BITSET || op == FUTEX_LOCK_PI || op == FUTEX_LOCK_PI2 ||
        op == FUTEX_WAIT_REQUEUE_PI)
      abfang_intern::zaehle_sperre();
  }
  return abfang_intern::echt(r, "syscall")(nr, a[0], a[1], a[2], a[3], a[4], a[5]);
}
}  // extern "C"

inline void abfang_an() {
  abfang_intern::zaehler = 0;
  abfang_intern::frei = abfang_intern::sperren = abfang_intern::schlafen = 0;
  abfang_intern::an = true;
}
inline long abfang_aus() {
  abfang_intern::an = false;
  return abfang_intern::zaehler;
}
// Alle Zähler des letzten Fensters (nach abfang_aus lesen)
inline AbfangZahlen abfang_zahlen() {
  return AbfangZahlen{abfang_intern::zaehler, abfang_intern::frei, abfang_intern::sperren, abfang_intern::schlafen};
}

// Positiv-Kontrolle je Art: in einem eigenen Fenster je ein Aufruf, der sofort zurückkehrt (Zeit in der Vergangenheit,
// futex mit falschem Wert, Schlaf 0); der Abfang muss jeden zählen. Rückgabe: die Zähler dieses Fensters.
inline AbfangZahlen abfang_gegenprobe() {
  pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
  pthread_cond_t c = PTHREAD_COND_INITIALIZER;
  sem_t s;
  sem_init(&s, 0, 1);
  timespec vorbei{0, 0};
  int wert = 0;
  abfang_an();
  void* p = std::malloc(16);   // alloc 1
  std::free(p);                // frei 1
  pthread_mutex_lock(&m);      // sperren 1
  pthread_cond_timedwait(&c, &m, &vorbei);   // sperren 2 (sofort ETIMEDOUT)
  pthread_mutex_unlock(&m);
  sem_wait(&s);                // sperren 3 (Wert 1: sofort)
  syscall(SYS_futex, &wert, FUTEX_WAIT_PRIVATE, 1, nullptr, nullptr, 0);   // sperren 4 (Wert 0 statt 1: sofort EAGAIN)
  timespec null{0, 0};
  nanosleep(&null, nullptr);   // schlafen 1
  usleep(0);                   // schlafen 2
  abfang_aus();
  sem_destroy(&s);
  return abfang_zahlen();
}
#endif
