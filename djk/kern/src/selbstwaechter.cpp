#include "cypherdj/selbstwaechter.h"

#include <signal.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <time.h>
#include <unistd.h>

#include <cstdio>

namespace cdj {

static const int64_t KARENZ_GRENZE_NS = 300000000LL;  // Grenze in der Karenz (MAJOR-2)

static int64_t mono_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

WaechterSeite* waechter_seite() noexcept {
  void* p = mmap(nullptr, sizeof(WaechterSeite), PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANONYMOUS, -1, 0);
  if (p == MAP_FAILED) return nullptr;
  auto* s = (WaechterSeite*)p;
  s->zaehler = 0;
  s->ende = 0;
  s->scharf_ab = 0;
  return s;
}

pid_t starte_selbstwaechter(const uint64_t* zaehler, const int* ende, int ms, void* loesen, size_t n,
                            const int64_t* scharf_ab) noexcept {
  if (ms <= 0) return 0;
  const pid_t kern = getpid();
  const pid_t p = fork();
  if (p != 0) return p;  // Kern (oder -1)
  // Wächter: stirbt mit dem Kern; ab hier nur einfache Aufrufe
  prctl(PR_SET_PDEATHSIG, SIGKILL);
  prctl(PR_SET_NAME, "kern-waechter");
  if (getppid() != kern) _exit(0);  // Kern schon weg
  if (loesen && n) munmap(loesen, n);  // der Wächter hält den Ring nicht
  const int64_t grenze = (int64_t)ms * 1000000;
  const long takt_ns = ms >= 10 ? 2000000L : 500000L;  // 2 ms Abfragetakt: Tod höchstens 2 ms nach der Grenze
  uint64_t alt = __atomic_load_n(zaehler, __ATOMIC_ACQUIRE);
  bool scharf = false;
  int64_t seit = mono_ns();
  for (;;) {
    timespec t{0, takt_ns};
    nanosleep(&t, nullptr);
    if (getppid() != kern) _exit(0);
    if (__atomic_load_n(ende, __ATOMIC_ACQUIRE)) _exit(0);  // geordnetes Ende
    const uint64_t w = __atomic_load_n(zaehler, __ATOMIC_ACQUIRE);
    const int64_t jetzt = mono_ns();
    if (w != alt) {
      alt = w;
      if (!scharf && scharf_ab) {  // erst nach dem Verbinden plus Karenz (selbstwaechter.h)
        const int64_t ab = __atomic_load_n(scharf_ab, __ATOMIC_ACQUIRE);
        scharf = ab > 0 && jetzt >= ab;
      } else {
        scharf = true;
      }
      seit = jetzt;
      continue;
    }
    // Paket 2 Slice 1 (B1, MAJOR-2): die Karenz gilt vor JEDEM Kill, aber als höhere Grenze, nicht als keine: setzt der Kern
    // vor einem späteren jack_connect (oder bei Port-Ereignissen im Graphen) scharf_ab in die Zukunft, wird erst bei
    // Stillstand >= 300 ms getötet. `seit` bleibt, sonst hielten Ereignisse alle 300 ms den Wächter für immer blind
    // (gemessen: 5-s-Hänger ohne Kill). Ein Graph-Umbau hielt w gemessen 100,5 ms an.
    // MINOR-5: die Grenze zählt ab dem Karenz-Ende (max(seit, ab)), die höhere Karenz-Grenze ab Beginn des Stillstands.
    // Ein Stillstand, der in der Karenz beginnt und über ihr Ende läuft, wird so nicht sofort nach dem Ende getötet.
    const int64_t ab = scharf && scharf_ab ? __atomic_load_n(scharf_ab, __ATOMIC_ACQUIRE) : 0;
    const int64_t kill_grenze = grenze < KARENZ_GRENZE_NS ? KARENZ_GRENZE_NS : grenze;
#ifdef CYPHERDJ_MUTATION_WAECHTER_GRENZE_AB_SEIT  // Fehlerfall MINOR-5: die Grenze zählt nur ab dem Beginn, nie ab dem Karenz-Ende
    if (scharf && (jetzt - seit >= kill_grenze || (seit >= ab && jetzt - seit >= grenze))) {
#else
    if (scharf && (jetzt - seit >= kill_grenze || jetzt - (seit > ab ? seit : ab) >= grenze)) {
#endif
      std::fprintf(stderr, "Selbst-Waechter: SIGKILL an %d, w steht seit %.1f ms bei %llu\n", (int)kern,
                   (double)(jetzt - seit) / 1e6, (unsigned long long)w);
#ifndef CYPHERDJ_MUTATION_WAECHTER_OHNE_KILL
      kill(kern, SIGKILL);
#endif
      _exit(0);
    }
  }
}

}  // namespace cdj
