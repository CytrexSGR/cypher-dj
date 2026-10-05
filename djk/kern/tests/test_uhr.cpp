// Golden-Werte SCHNITTSTELLEN.md §1.3: Abweichung <= 1e-6 Samples vor dem Runden.
// Referenzen mit 50 Stellen (Python decimal) aus den Formeln in §1.3 nachgerechnet am 2026-09-23.
#include <cmath>

#include "cypherdj/uhr.h"
#include "pruef.h"

int main() {
  const double TOL = 1e-6;  // Samples

  // Fall 1 und 2: konstant 128 ab Sample 0
  cdj::Karte k(128.0, 0);
  PRUEF_NAH(k.sample_at(64.0), 1440000.0, TOL);
  PRUEF_NAH(k.sample_at(k.beat_at(1440000.0)), 1440000.0, TOL);
  PRUEF_NAH(k.beat_at(1440000.0), 64.0, TOL * 128.0 / 60.0 / 48000.0);

  // Fall 3 bis 6: Rampe 128 -> 132 ab Beat 128 über 32 Beats, danach konstant 132
  PRUEF(k.rampe(128.0, 132.0, 32.0));
  PRUEF(k.anzahl() == 3);
  PRUEF_NAH(k.sample_at(128.0), 2880000.0, TOL);
  PRUEF_NAH(k.segment(1).dauer_s, 14.769230769230769, 1e-9);
  PRUEF_NAH(k.segment(1).k, 0.270833333333333, 1e-9);
  const double s144 = k.sample_at(144.0);
  PRUEF_NAH(s144, 3237188.004360675214, TOL);
  PRUEF(std::llround(s144) == 3237188);
  PRUEF_NAH(k.bpm_at(s144), 130.015383705160, 1e-6);
  const double s160 = k.sample_at(160.0);
  PRUEF_NAH(s160, 3588923.076923076923, TOL);
  PRUEF(std::llround(s160) == 3588923);
  const double s192 = k.sample_at(192.0);
  PRUEF_NAH(s192, 4287104.895104895105, TOL);
  PRUEF(std::llround(s192) == 4287105);
  // Hin und zurück über die ganze Karte
  for (double b = 0.0; b <= 256.0; b += 0.25) PRUEF_NAH(k.beat_at(k.sample_at(b)), b, 1e-9);

  // Takt/Schlag/Phrase: 0 / 3,5 / 64 / 127,99 / 128 -> 1.1 P1 / 1.4 P1 / 17.1 P3 / 32.4 P4 / 33.1 P5
  const double beats[5] = {0.0, 3.5, 64.0, 127.99, 128.0};
  const int takt[5] = {1, 1, 17, 32, 33}, schlag[5] = {1, 4, 1, 4, 1}, phrase[5] = {1, 1, 3, 4, 5};
  for (int i = 0; i < 5; ++i) {
    PRUEF(cdj::takt_nr(beats[i]) == takt[i]);
    PRUEF(cdj::schlag_im_takt(beats[i]) == schlag[i]);
    PRUEF(cdj::phrase_nr(beats[i]) == phrase[i]);
  }

  // Karte voll: 64 Segmente, dann false und unverändert
  cdj::Karte v(128.0, 0);
  int ok = 0;
  for (int i = 0; i < 40; ++i) ok += v.rampe(8.0 * (i + 1), (i % 2) ? 128.0 : 130.0, 1.0) ? 1 : 0;
  PRUEF(v.anzahl() <= cdj::MAX_SEGMENTE);
  PRUEF(ok < 40);
  const int n_vorher = v.anzahl();
  PRUEF(!v.rampe(1000.0, 131.0, 4.0));
  PRUEF(v.anzahl() == n_vorher);

  PRUEF_ENDE();
}
