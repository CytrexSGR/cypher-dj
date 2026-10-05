// Scheibe 11, Task 2: SimUhr trifft die Golden-Werte aus SCHNITTSTELLEN §1.3 (Abweichung <= 1e-6 Samples vor dem Runden).
#include "pruef.h"
#include "sim_uhr.h"

using namespace cypherdj::stellwerk;

FALL(konstant_128_sample_64_und_zurueck) {
  SimUhr u(128.0);
  PRUEFE_NAH(u.sample_genau(64.0), 1440000.0, 1e-6);
  PRUEFE_NAH(u.beat(1440000), 64.0, 1e-9);
  PRUEFE_GLEICH(sample_von(u, 64.0), 1440000);
}

FALL(rampe_128_nach_132_ab_beat_128_ueber_32) {
  SimUhr u(128.0);
  PRUEFE(u.rampe(128.0, 132.0, 32.0));
  PRUEFE_NAH(u.sample_genau(128.0), 2880000.0, 1e-6);
  const double t = 32.0 * 60.0 / 130.0;
  PRUEFE_NAH(t, 14.769231, 1e-6);
  PRUEFE_NAH(4.0 / t, 0.270833, 1e-6);
  PRUEFE_NAH(u.sample_genau(144.0), 3237188.004, 1e-3);
  PRUEFE_GLEICH(sample_von(u, 144.0), 3237188);
  PRUEFE_NAH(u.bpm_d(u.sample_genau(144.0)), 130.015384, 1e-6);
  PRUEFE_NAH(u.sample_genau(160.0), 3588923.077, 1e-3);
  PRUEFE_GLEICH(sample_von(u, 160.0), 3588923);
  PRUEFE_NAH(u.sample_genau(192.0), 4287104.895, 1e-3);
  PRUEFE_GLEICH(sample_von(u, 192.0), 4287105);
}

FALL(hin_und_zurueck_in_der_rampe) {
  SimUhr u(128.0);
  u.rampe(128.0, 132.0, 32.0);
  for (double b : {10.0, 130.5, 144.0, 159.999, 175.25}) PRUEFE_NAH(u.beat_d(u.sample_genau(b)), b, 1e-9);
}

FALL(takt_schlag_phrase) {
  PRUEFE_GLEICH(takt_von(0.0), 1);
  PRUEFE_GLEICH(schlag_von(0.0), 1);
  PRUEFE_GLEICH(phrase_von(0.0), 1);
  PRUEFE_GLEICH(takt_von(3.5), 1);
  PRUEFE_GLEICH(schlag_von(3.5), 4);
  PRUEFE_GLEICH(takt_von(64.0), 17);
  PRUEFE_GLEICH(phrase_von(64.0), 3);
  PRUEFE_GLEICH(takt_von(127.99), 32);
  PRUEFE_GLEICH(schlag_von(127.99), 4);
  PRUEFE_GLEICH(phrase_von(127.99), 4);
  PRUEFE_GLEICH(takt_von(128.0), 33);
  PRUEFE_GLEICH(phrase_von(128.0), 5);
}

FALL(tempo_ab_takt_18_verschiebt_beat_80) {
  // Negativ-Kontrolle für die Umrechnung je Zyklus: ohne Tempowechsel Beat 80 bei 1 800 000, mit 132 ab Takt 18 bei 1 791 818
  SimUhr u(128.0);
  PRUEFE_GLEICH(sample_von(u, 80.0), 1800000);
  u.konstant_ab(1530000, 132.0);
  PRUEFE_GLEICH(sample_von(u, 80.0), 1791818);
  PRUEFE_NAH(u.beat(1530000), 68.0, 1e-9);
}

PRUEF_MAIN
