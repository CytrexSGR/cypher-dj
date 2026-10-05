// stellwerk_kosten: Rechenzeit von prozess() samt Befehlen und Abholen je Zyklus (256 Samples) mit 64 laufenden Reglern,
// jeder Zyklus einzeln mit CLOCK_MONOTONIC gestoppt.
// Modi: last  64 Rampen ständig aktiv (Wellen alle 32 Beats, angrenzend), dazu zwei Handregler alle 7 Zyklen
//       null  keine Teile, keine Hand (schneller Pfad; Nullpunkt des Instruments)
//       nadel wie last, dazu im Zyklus n/2 500 µs aktives Warten (Instrument-Kontrolle: das Maximum muss es zeigen)
// Takt: --takt-us T wartet nach jedem Zyklus bis zum nächsten Vielfachen von T (wie ein Callback; 09 NP b3 fand ohne
// Pause Ausreißer bis 38 ms, im Takt nie), --takt-us 0 läuft ohne Pause (Vergleich).
// Aufruf (unter flock "$CYPHERDJ_ECHTZEIT_SCHLOSS"): stellwerk_kosten <modus> <zyklen> [--takt-us T] [--kein-fifo]
// Die ersten EIN = 1500 Zyklen zählen nicht (die erste Welle beginnt bei Beat 16 = Zyklus 1406). Ausgabe: eine
// JSON-Zeile. Kein Ton, keine Ports.
#include <sched.h>
#include <time.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <vector>

#include "sim_uhr.h"
#include "cypherdj/stellwerk/stellwerk.h"

using namespace cypherdj::stellwerk;

namespace {
int64_t ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}
void schlafe_bis(int64_t ziel_ns) {
  timespec t;
  t.tv_sec = ziel_ns / 1000000000LL;
  t.tv_nsec = ziel_ns % 1000000000LL;
  while (clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &t, nullptr) != 0) {
  }
}
double last1() {
  double l = -1;
  if (FILE* f = std::fopen("/proc/loadavg", "r")) {
    if (std::fscanf(f, "%lf", &l) != 1) l = -1;
    std::fclose(f);
  }
  return l;
}
}  // namespace

int main(int argc, char** argv) {
  const char* modus = argc > 1 ? argv[1] : "last";
  const long zyklen = argc > 2 ? std::atol(argv[2]) : 100000;
  long takt_us = 1000;
  bool fifo_wunsch = true;
  for (int k = 3; k < argc; k++) {
    if (!std::strcmp(argv[k], "--takt-us") && k + 1 < argc) takt_us = std::atol(argv[++k]);
    else if (!std::strcmp(argv[k], "--kein-fifo")) fifo_wunsch = false;
  }
  constexpr long EIN = 1500;
  if ((std::strcmp(modus, "last") && std::strcmp(modus, "null") && std::strcmp(modus, "nadel")) || zyklen < 2 * EIN) {
    std::fprintf(stderr, "stellwerk_kosten last|null|nadel <zyklen >= %ld> [--takt-us T] [--kein-fifo]\n", 2 * EIN);
    return 2;
  }
  const bool mit_teilen = std::strcmp(modus, "null") != 0;
  bool fifo = false;
  if (fifo_wunsch) {
    sched_param sp{};
    sp.sched_priority = 70;   // unter den PipeWire-Datenfäden, wie 09 NP b3
    fifo = sched_setscheduler(0, SCHED_FIFO, &sp) == 0;
  }
  const double last_vorher = last1();

  SimUhr uhr(128.0);
  auto sw = std::make_unique<Stellwerk>(uhr);
  const ReglerTabelle& t = sw->tabelle();
  int regler[64];
  int n = 0;
  for (int r = 0; r < t.anzahl() && n < 64; r++)
    if (!t.def(r).nur_hand && !t.def(r).keine_rampe && t.def(r).deck == 0) regler[n++] = r;
  if (n != 64) {
    std::fprintf(stderr, "nur %d rampenfähige Regler\n", n);
    return 2;
  }
  const int hand1 = t.suche("erz/7/eq/mitte"), hand2 = t.suche("erz/8/eq/mitte");
  std::vector<int32_t> dauer(zyklen);
  std::vector<int32_t> aktiv(zyklen);
  int64_t id = 10;
  int welle = 0;
  const int64_t takt_ns = takt_us * 1000;
  int64_t naechster = ns();
  for (long z = 0; z < zyklen; z++) {
    const int64_t s0 = static_cast<int64_t>(z) * 256;
    const int64_t t0 = ns();
    if (mit_teilen) {
      const double beat = uhr.beat(s0);
      if (beat + 8 >= 32.0 * welle + 16) {   // nächste Welle angrenzend: es laufen immer 64 Rampen
        const double ab = 32.0 * welle + 16;
        char plan[4] = {'w', static_cast<char>('a' + welle % 26), 0, 0};
        for (int k = 0; k < 64; k++) {
          const ReglerDef& d = t.def(regler[k]);
          const float ziel = d.db ? (welle % 2 ? -30.0f : 0.0f) : ((welle % 2) ? d.min + 0.25f * (d.max - d.min) : d.max);
          sw->teil(TeilBefehl{id++, Quelle::cypher, plan, k, d.pfad, ab, 32, ziel, k % 2, 0, (k % 4 == 0) ? "g" : "", ""});
        }
        welle++;
      }
      if (z % 7 == 0) {
        sw->hand(Griff{s0 + 13, static_cast<int16_t>(hand1), GriffArt::absolut, 0.8f + 0.001f * (z % 5), nullptr});
        sw->hand(Griff{s0 + 97, static_cast<int16_t>(hand2), GriffArt::relativ, (z % 2) ? 0.01f : -0.01f, nullptr});
      }
    }
    sw->prozess(s0, 256);
    const Aenderung* a;
    aktiv[z] = sw->aenderungen(&a);
    const Ereignis* e;
    volatile int ne = sw->ereignisse(&e);
    (void)ne;
    sw->ereignisse_leeren();
    if (!std::strcmp(modus, "nadel") && z == zyklen / 2) {
      const int64_t w = ns();
      while (ns() - w < 500000) {
      }
    }
    dauer[z] = static_cast<int32_t>(ns() - t0);
    if (takt_ns > 0) {
      naechster += takt_ns;
      const int64_t jetzt = ns();
      if (naechster < jetzt) naechster = jetzt;   // Takt verpasst: nicht nachholen
      schlafe_bis(naechster);
    }
  }
  std::vector<int32_t> s(dauer.begin() + EIN, dauer.end());
  std::sort(s.begin(), s.end());
  auto q = [&](double p) { return s[std::min<size_t>(s.size() - 1, static_cast<size_t>(std::ceil(p * s.size())) - 1)] / 1000.0; };
  const double budget = 256.0 / SR * 1e6;
  long ueber20 = 0, ueber50 = 0, min_aktiv = 1 << 30;
  for (long z = EIN; z < zyklen; z++) {
    ueber20 += dauer[z] > 0.2 * budget * 1000;
    ueber50 += dauer[z] > 0.5 * budget * 1000;
    min_aktiv = std::min<long>(min_aktiv, aktiv[z]);
  }
  const long max_z = static_cast<long>(std::max_element(dauer.begin() + EIN, dauer.end()) - dauer.begin());
  std::printf("{\"modus\":\"%s\",\"zyklen\":%ld,\"takt_us\":%ld,\"sched_fifo\":%s,\"regler_bewegt_min\":%ld,\"p50_us\":%.2f,"
              "\"p99_us\":%.2f,\"p999_us\":%.2f,\"max_us\":%.2f,\"max_zyklus\":%ld,\"zyklus_n_halbe_us\":%.2f,\"budget_us\":%.1f,\"p999_anteil_prozent\":%.3f,"
              "\"max_anteil_prozent\":%.3f,\"ueber_20_prozent\":%ld,\"ueber_50_prozent\":%ld,\"last_vorher\":%.2f,"
              "\"last_nachher\":%.2f,\"verloren\":%lld,\"bewegt_voll\":%lld,\"teile_voll\":%lld}\n",
              modus, zyklen, takt_us, fifo ? "true" : "false", mit_teilen ? min_aktiv : 0L, q(0.5), q(0.99), q(0.999),
              s.back() / 1000.0, max_z, dauer[zyklen / 2] / 1000.0, budget, 100.0 * q(0.999) / budget, 100.0 * s.back() / 1000.0 / budget, ueber20, ueber50,
              last_vorher, last1(), static_cast<long long>(sw->zaehler().ereignisse_verloren),
              static_cast<long long>(sw->zaehler().bewegt_voll), static_cast<long long>(sw->zaehler().teile_voll));
  return 0;
}
