// Scheibe 18, Selbst-Wächter (Plan-Befund B5): ein eigener kleiner Prozess, der den Kern tötet, wenn dessen Callback
// steht. Er muss auch SIGSTOP fangen (ein Faden im Kern stünde mit), darum ein Prozess, kein Faden.
// Fehlerfall: die Kern-Attrappe zählt, hält dann an (SIGSTOP an sich selbst) -> SIGKILL binnen Grenze + Takt.
// Negativ-Kontrollen: Zähler läuft durch; geordnetes Ende (Flag) mit stehendem Zähler; nie gestiegener Zähler (nicht
// scharf); Wächter aus (0 ms). Dazu: stirbt die Attrappe, stirbt der Wächter mit (PR_SET_PDEATHSIG).
#include <signal.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

#include "cypherdj/kanten.h"
#include "cypherdj/selbstwaechter.h"
#include "pruef.h"

struct Geteilt {
  uint64_t zaehler;
  int ende;
  int64_t t_halt_ns;  // letzte Erhöhung des Zählers vor dem Anhalten
  int waechter_pid;
  int ring_beim_waechter;  // 1: die freizugebende Abbildung steht noch in /proc/<wächter>/maps
  int64_t scharf_ab;       // 2026-09-27: 0 = noch nicht verbunden; sonst scharf erst ab diesem mono_ns
};

static bool abgebildet(int pid, const void* adr) {  // steht adr als Anfang einer Abbildung in /proc/pid/maps?
  char pfad[64], zeile[512], soll[32];
  std::snprintf(pfad, sizeof pfad, "/proc/%d/maps", pid);
  std::snprintf(soll, sizeof soll, "%lx-", (unsigned long)adr);
  FILE* f = std::fopen(pfad, "r");
  if (!f) return false;
  bool ja = false;
  while (std::fgets(zeile, sizeof zeile, f)) ja = ja || !std::strncmp(zeile, soll, std::strlen(soll));
  std::fclose(f);
  return ja;
}

static int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
}

enum class Art { anhalten, durchlaufen, geordnet, nie_scharf, aus, haenger_in_karenz, haenger_nach_karenz,
                 neue_karenz, stillstand_ohne_neue_karenz, dauer_unruhe, karenz_rand, karenz_rand_haenger };

// Kern-Attrappe als Kindprozess: startet den Wächter, zählt `zaehl_ms` lang alle 5 ms um 256, dann je nach Art.
static int attrappe(Geteilt* g, Art art, int grenze_ms, int zaehl_ms, void* ring = nullptr, size_t ring_n = 0) {
  std::memset(g, 0, sizeof *g);
  const pid_t p = fork();
  if (p == 0) {
    const bool nachverbinden = art == Art::neue_karenz || art == Art::stillstand_ohne_neue_karenz || art == Art::dauer_unruhe || art == Art::karenz_rand || art == Art::karenz_rand_haenger;
    const bool karenz = art == Art::haenger_in_karenz || art == Art::haenger_nach_karenz || nachverbinden;
    const pid_t w = cdj::starte_selbstwaechter(&g->zaehler, &g->ende, art == Art::aus ? 0 : grenze_ms, ring, ring_n,
                                               karenz ? &g->scharf_ab : nullptr);
    __atomic_store_n(&g->waechter_pid, (int)w, __ATOMIC_RELEASE);
    if (nachverbinden) __atomic_store_n(&g->scharf_ab, jetzt_ns(), __ATOMIC_RELEASE);  // schon verbunden, Karenz vorbei
    if (ring && w > 0) {
      usleep(20000);
      g->ring_beim_waechter = abgebildet(w, ring) ? 1 : 0;
    }
    if (art != Art::nie_scharf) {
      const int64_t bis = jetzt_ns() + (int64_t)zaehl_ms * 1000000;
      while (jetzt_ns() < bis) {
        __atomic_fetch_add(&g->zaehler, 256, __ATOMIC_RELEASE);
        __atomic_store_n(&g->t_halt_ns, jetzt_ns(), __ATOMIC_RELEASE);
        usleep(5000);
      }
    }
    auto zaehle_bis = [&](int64_t bis) {
      while (jetzt_ns() < bis) {
        __atomic_fetch_add(&g->zaehler, 256, __ATOMIC_RELEASE);
        __atomic_store_n(&g->t_halt_ns, jetzt_ns(), __ATOMIC_RELEASE);
        usleep(5000);
      }
    };
    if (art == Art::haenger_in_karenz) {  // wie main: verbunden, Karenz 300 ms; der Graph steht 3 Grenzen darin
      __atomic_store_n(&g->scharf_ab, jetzt_ns() + 300 * 1000000LL, __ATOMIC_RELEASE);
      usleep((useconds_t)grenze_ms * 3 * 1000);
      zaehle_bis(__atomic_load_n(&g->scharf_ab, __ATOMIC_ACQUIRE) + (int64_t)grenze_ms * 4 * 1000000);
      _exit(7);
    }
    if (art == Art::haenger_nach_karenz) {  // Karenz 100 ms vorbei, danach steht der Zähler: das bleibt ein Hänger
      __atomic_store_n(&g->scharf_ab, jetzt_ns() + 100 * 1000000LL, __ATOMIC_RELEASE);
      zaehle_bis(jetzt_ns() + 200 * 1000000LL);
      usleep((useconds_t)grenze_ms * 4 * 1000);
      _exit(7);
    }
    if (art == Art::neue_karenz || art == Art::stillstand_ohne_neue_karenz) {
      // Paket 2 Slice 1 (B1): der Verbinder setzt vor einem späteren jack_connect eine NEUE Karenz. Der Graph-Umbau
      // hält w 150 ms an (3 Grenzen); mit neuer Karenz kein Kill, ohne sie (Negativ-Kontrolle, Verhalten bis heute) Kill.
      if (art == Art::neue_karenz) __atomic_store_n(&g->scharf_ab, jetzt_ns() + 400 * 1000000LL, __ATOMIC_RELEASE);
      usleep((useconds_t)grenze_ms * 3 * 1000);
      zaehle_bis(jetzt_ns() + 100 * 1000000LL);
      _exit(7);
    }
    if (art == Art::karenz_rand_haenger) {
      // MINOR-1: der Hänger beginnt 420 ms nach Karenz-Beginn (Ende 500 ms) und hört nie auf. Erwartet: Kill grenze (50 ms)
      // nach dem Karenz-Ende, also 80 + 50 ms nach der letzten Erhöhung; die Mutation (Grenze nur ab Beginn) tötet erst bei
      // 300 ms.
      const int64_t t0 = jetzt_ns();
      __atomic_store_n(&g->scharf_ab, t0 + 500 * 1000000LL, __ATOMIC_RELEASE);
      zaehle_bis(t0 + 420 * 1000000LL);
      usleep(1000 * 1000);
      _exit(7);
    }
    if (art == Art::karenz_rand) {
      // MINOR-5: 101 ms Stillstand, der 420 ms nach Karenz-Beginn anfängt und über das Karenz-Ende (500 ms) hinausläuft:
      // nach dem Ende sind erst 21 ms vergangen (< Grenze 50), also kein Kill. Heute zählt er ab seinem Beginn.
      const int64_t t0 = jetzt_ns();
      __atomic_store_n(&g->scharf_ab, t0 + 500 * 1000000LL, __ATOMIC_RELEASE);
      zaehle_bis(t0 + 420 * 1000000LL);
      usleep(101 * 1000);
      zaehle_bis(jetzt_ns() + 200 * 1000000LL);
      _exit(7);
    }
    if (art == Art::dauer_unruhe) {
      // MAJOR-2: Port-Ereignisse alle 300 ms (jedes setzt +500 ms Karenz) halten einen echten Hänger nicht ewig blind:
      // in der Karenz gilt die höhere Grenze (300 ms), der Kill kommt dann nach ~300 ms Stillstand statt nie.
      const int64_t bis = jetzt_ns() + 1500 * 1000000LL;
      while (jetzt_ns() < bis) {
        cdj::karenz_verlaengern(&g->scharf_ab, jetzt_ns() + 500 * 1000000LL);
        usleep(300 * 1000);
      }
      _exit(7);
    }
    if (art == Art::geordnet) __atomic_store_n(&g->ende, 1, __ATOMIC_RELEASE);
    if (art == Art::anhalten) raise(SIGSTOP);  // wie serie.sh --art stop
    if (art == Art::durchlaufen) {             // zählt weiter, bis 4 Grenzen vergangen sind
      const int64_t bis = jetzt_ns() + (int64_t)grenze_ms * 4 * 1000000;
      while (jetzt_ns() < bis) {
        __atomic_fetch_add(&g->zaehler, 256, __ATOMIC_RELEASE);
        usleep(5000);
      }
    } else {
      usleep((useconds_t)grenze_ms * 4 * 1000);  // steht 4 Grenzen lang
    }
    _exit(7);
  }
  int st = 0;  // höchstens 2 s warten; hat der Wächter bis dahin nicht getötet, tötet der Test (SIGTERM, zählt als Fehler)
  for (int i = 0; i < 400 && waitpid(p, &st, WNOHANG) == 0; ++i) usleep(5000);
  if (waitpid(p, &st, WNOHANG) == 0) {
    kill(p, SIGTERM);
    kill(p, SIGCONT);
    waitpid(p, &st, 0);
  }
  return st;
}

static bool lebt(int pid) {  // Prozess da und kein Zombie
  if (pid <= 0) return false;
  char pfad[64], b[256] = {0};
  std::snprintf(pfad, sizeof pfad, "/proc/%d/stat", pid);
  FILE* f = std::fopen(pfad, "r");
  if (!f) return false;
  const size_t n = std::fread(b, 1, sizeof b - 1, f);
  std::fclose(f);
  const char* z = std::strrchr(b, ')');
  return n > 0 && z && z[1] == ' ' && z[2] != 'Z' && z[2] != 'X';
}

int main() {
  auto* g = (Geteilt*)mmap(nullptr, sizeof(Geteilt), PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANONYMOUS, -1, 0);
  PRUEF(g != MAP_FAILED);
  const int grenze = 50;

  // 1) Fehlerfall: Attrappe hält an (SIGSTOP) -> SIGKILL vom Wächter, frühestens nach der Grenze, spätestens Grenze + 30 ms
  {
    const int st = attrappe(g, Art::anhalten, grenze, 100);
    const double ms = (double)(jetzt_ns() - g->t_halt_ns) / 1e6;
    std::fprintf(stderr, "   angehalten: %s, %.1f ms nach der letzten Erhöhung\n",
                 WIFSIGNALED(st) ? strsignal(WTERMSIG(st)) : "nicht getötet", ms);
    PRUEF(WIFSIGNALED(st) && WTERMSIG(st) == SIGKILL);
    PRUEF(ms >= grenze && ms <= grenze + 80);  // Obergrenze misst nur die Planung unter Last (ctest -j8)
  }
  // 2) Negativ-Kontrolle: Zähler läuft durch -> normales Ende mit 7
  {
    const int st = attrappe(g, Art::durchlaufen, grenze, 100);
    PRUEF(WIFEXITED(st) && WEXITSTATUS(st) == 7);
  }
  // 3) Negativ-Kontrolle: geordnetes Ende (Flag), danach steht der Zähler 4 Grenzen lang -> kein Kill
  {
    const int st = attrappe(g, Art::geordnet, grenze, 100);
    PRUEF(WIFEXITED(st) && WEXITSTATUS(st) == 7);
  }
  // 4) Negativ-Kontrolle: Zähler nie gestiegen (Kern bekam noch keinen Zyklus) -> nicht scharf, kein Kill
  {
    const int st = attrappe(g, Art::nie_scharf, grenze, 0);
    PRUEF(WIFEXITED(st) && WEXITSTATUS(st) == 7);
  }
  // 5) Negativ-Kontrolle: Wächter aus (0 ms) -> kein Prozess, kein Kill
  {
    const int st = attrappe(g, Art::aus, grenze, 100);
    PRUEF(WIFEXITED(st) && WEXITSTATUS(st) == 7);
    PRUEF(g->waechter_pid == 0);
  }
  // 6) Der Wächter stirbt mit der Attrappe (PR_SET_PDEATHSIG): nach Fall 2 ist er binnen 100 ms weg
  {
    (void)attrappe(g, Art::durchlaufen, grenze, 20);
    const int w = g->waechter_pid;
    PRUEF(w > 0);
    for (int i = 0; i < 20 && lebt(w); ++i) usleep(5000);
    PRUEF(!lebt(w));
  }
  // 7) Der Wächter gibt den Ring frei (sonst zählt er als zweiter Halter, Prüfstand 16); Kontrolle: die Attrappe hält ihn
  {
    void* ring = mmap(nullptr, 1 << 16, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANONYMOUS, -1, 0);
    PRUEF(abgebildet(getpid(), ring));  // Positiv-Kontrolle des Instruments
    (void)attrappe(g, Art::durchlaufen, grenze, 100, ring, 1 << 16);
    PRUEF(g->waechter_pid > 0 && g->ring_beim_waechter == 0);
    munmap(ring, 1 << 16);
  }
  // 8) 2026-09-27 (Kern am Digital-Out: beim Anschließen an die Karte stand w 100,5 ms, der Wächter tötete ihn): mit
  //    scharf_ab wird er erst nach dem Verbinden plus Karenz scharf. Hänger in der Karenz: kein Kill. Derselbe Hänger
  //    nach der Karenz: Kill (Negativ-Kontrolle, der Wächter bleibt wirksam).
  {
    const int st = attrappe(g, Art::haenger_in_karenz, grenze, 30);
    std::fprintf(stderr, "   Hänger in der Karenz: %s\n", WIFSIGNALED(st) ? strsignal(WTERMSIG(st)) : "lebt, Ende 7");
    PRUEF(WIFEXITED(st) && WEXITSTATUS(st) == 7);
  }
  {
    const int st = attrappe(g, Art::haenger_nach_karenz, grenze, 30);
    std::fprintf(stderr, "   Hänger nach der Karenz: %s\n", WIFSIGNALED(st) ? strsignal(WTERMSIG(st)) : "lebt, Ende 7");
    PRUEF(WIFSIGNALED(st) && WTERMSIG(st) == SIGKILL);
  }
  // 9) Paket 2 Slice 1 (B1): scharf_ab mitten im Lauf in die Zukunft gesetzt wirkt auch nach dem ersten Scharf-Werden
  {
    const int st = attrappe(g, Art::neue_karenz, grenze, 100);
    std::fprintf(stderr, "   150 ms Stillstand mit neuer Karenz: %s\n", WIFSIGNALED(st) ? strsignal(WTERMSIG(st)) : "lebt, Ende 7");
    PRUEF(WIFEXITED(st) && WEXITSTATUS(st) == 7);
  }
  {
    const int st = attrappe(g, Art::stillstand_ohne_neue_karenz, grenze, 100);
    std::fprintf(stderr, "   150 ms Stillstand ohne neue Karenz: %s\n", WIFSIGNALED(st) ? strsignal(WTERMSIG(st)) : "lebt, Ende 7");
    PRUEF(WIFSIGNALED(st) && WTERMSIG(st) == SIGKILL);
  }
  // 10) MAJOR-2: Dauerereignisse alle 300 ms + Hänger => Kill nach ~300 ms (Karenz-Grenze), nicht nie
  {
    const int st = attrappe(g, Art::dauer_unruhe, grenze, 100);
    const double ms = (double)(jetzt_ns() - g->t_halt_ns) / 1e6;
    std::fprintf(stderr, "   Dauerunruhe + Hänger: %s\n", WIFSIGNALED(st) ? strsignal(WTERMSIG(st)) : "lebt, Ende 7");
    PRUEF(WIFSIGNALED(st) && WTERMSIG(st) == SIGKILL);
    std::fprintf(stderr, "   Kill %.1f ms nach der letzten Erhöhung (Karenz-Grenze 300 ms)\n", ms);
    PRUEF(ms >= 300 && ms <= 400);  // Obergrenze unter Last; alt (ohne Grenze) lebte der Hänger
  }
  // 11) MINOR-5: Stillstand über das Karenz-Ende hinaus zählt ab dem Karenz-Ende für die Grenze
  {
    const int st = attrappe(g, Art::karenz_rand, grenze, 100);
    std::fprintf(stderr, "   101 ms Stillstand über das Karenz-Ende: %s\n", WIFSIGNALED(st) ? strsignal(WTERMSIG(st)) : "lebt, Ende 7");
    PRUEF(WIFEXITED(st) && WEXITSTATUS(st) == 7);
  }
  // 12) MINOR-1: ein Hänger, der über das Karenz-Ende hinausläuft, wird grenze nach dem Karenz-Ende getötet
  {
    const int st = attrappe(g, Art::karenz_rand_haenger, grenze, 100);
    const double ms = (double)(jetzt_ns() - g->t_halt_ns) / 1e6;
    std::fprintf(stderr, "   Hänger über das Karenz-Ende: %s nach %.1f ms (erwartet ~130)\n",
                 WIFSIGNALED(st) ? strsignal(WTERMSIG(st)) : "lebt, Ende 7", ms);
    PRUEF(WIFSIGNALED(st) && WTERMSIG(st) == SIGKILL);
    PRUEF(ms >= 125 && ms <= 240);  // Obergrenze unter Last; die Mutation tötet erst nach ~303 ms
  }
  PRUEF_ENDE();
}
