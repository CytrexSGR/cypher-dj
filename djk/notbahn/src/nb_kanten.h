/* Paket 2 Slice 1 (F05): fehlt eine Ausgangskante aus[k] -> ziel[k] seit 500 ms und existiert der Zielport, wird sie
 * nachverbunden, höchstens alle 500 ms je Kante; eine Zeile ins Journal (B7). Ziele hat der Riegel beim Start geprüft. */
#pragma once
#include <jack/jack.h>
#include <stdint.h>
#include <stdio.h>
#include <time.h>

static inline void nb_nachverbinden(jack_client_t* cl, jack_port_t** aus, char (*ziel)[256], int n) {
  static int64_t seit[4], fehl[4]; /* MINOR-2: Scheitern höchstens alle 10 s je Kante */
  static int offen[4];
  static unsigned n_neu;
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  const int64_t jetzt = (int64_t)t.tv_sec * 1000000000LL + t.tv_nsec;
  for (int k = 0; k < n; k++) {
    if (jack_port_connected_to(aus[k], ziel[k])) { seit[k] = offen[k] = 0; continue; }
    if (!seit[k]) seit[k] = jetzt;
    if (jetzt - seit[k] < 500000000LL || !jack_port_by_name(cl, ziel[k])) continue;
    seit[k] = jetzt; /* nächster Versuch frühestens in 500 ms */
    if (!offen[k]++) fprintf(stderr, "Ausgang verloren: %s -> %s (mono_ns %lld)\n", jack_port_name(aus[k]), ziel[k], (long long)jetzt);
    if (jack_connect(cl, jack_port_name(aus[k]), ziel[k])) {
      if (jetzt - fehl[k] >= 10000000000LL) { fehl[k] = jetzt; fprintf(stderr, "Ausgang: Verbinden %s -> %s gescheitert (mono_ns %lld)\n", jack_port_name(aus[k]), ziel[k], (long long)jetzt); }
      continue;
    }
    offen[k] = 0;
    fprintf(stderr, "Ausgang neu verbunden: %s -> %s (Neuverbindung %u)\n", jack_port_name(aus[k]), ziel[k], ++n_neu);
  }
}
