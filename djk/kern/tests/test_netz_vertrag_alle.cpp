// Paket 1 „Nie still" Slice 1 (Audit 2026-10-01, F02): jede an_kern-Adresse des Vertrags mit gültigen Typen an
// Netz::paket(), jede in einem Kindprozess. Kein Kind darf an einem Signal sterben: eine Vertragsadresse ohne eigenen
// Zweig fiel bis hierher durch bis deck_paket(), das werte[1] als Zeichenkette las (/erz/cc ,iiidf: SIGSEGV).
// Negativ-Kontrolle: mindestens 20 Adressen gesendet, /k/ki/stufe (gebaut, harmlos) endet mit Exit 0.
#include <sys/wait.h>
#include <unistd.h>

#include <cstdio>
#include <memory>
#include <string>

#include "cypherdj/netz.h"
#include "cypherdj/osc.h"
#include "pruef.h"

namespace v = cypherdj::osc;

// Exit-Code des Kindes, oder −Signal.
static int lauf(const cdj::osc::Schreiber& w) {
  const pid_t p = fork();
  if (p == 0) {
    auto bef = std::make_unique<cdj::Befehlsring>();
    auto ere = std::make_unique<cdj::Ereignisring>();
    cdj::Netz netz(0, true, bef.get(), ere.get());
    netz.paket(w.daten(), w.groesse());
    _exit(0);
  }
  int st = 0;
  waitpid(p, &st, 0);
  if (WIFSIGNALED(st)) return -WTERMSIG(st);
  return WIFEXITED(st) ? WEXITSTATUS(st) : 99;
}

int main() {
  int gesendet = 0, gestorben = 0;
  for (const v::Adresse& a : v::alle) {
    if (a.richtung != v::Richtung::an_kern) continue;
    const std::string pfad(a.pfad), typen(a.typen.substr(1));
    cdj::osc::Schreiber w(pfad.c_str(), typen.c_str());
    for (char t : typen) {
      if (t == 'h') w.h(1);
      else if (t == 's') w.s("andreas");
      else if (t == 'i') w.i(0);
      else if (t == 'f') w.f(0.0f);
      else if (t == 'd') w.d(0.0);
    }
    PRUEF(w.ok());
    const int r = lauf(w);
    ++gesendet;
    if (r < 0) {
      ++gestorben;
      std::fprintf(stderr, "%s ,%s: Signal %d\n", pfad.c_str(), typen.c_str(), -r);
    }
  }
  std::printf("an_kern-Adressen gesendet: %d, an Signal gestorben: %d\n", gesendet, gestorben);
  PRUEF(gesendet >= 20);
  PRUEF(gestorben == 0);

  cdj::osc::Schreiber k("/k/ki/stufe", "hsi");  // Negativ-Kontrolle: gebaute Adresse, harmlos
  k.h(1).s("andreas").i(1);
  PRUEF(lauf(k) == 0);
  PRUEF_ENDE();
}
