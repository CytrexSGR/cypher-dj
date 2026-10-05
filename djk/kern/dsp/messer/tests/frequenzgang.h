// Betrag des Frequenzgangs eines Bands aus seinen SOS-Zeilen, im Frequenzbereich gerechnet
// (unabhängiger Weg zur Zeitbereichs-Filterung). Nur für Tests.
#pragma once
#include <complex>

#include "cypherdj/dsp/analyse_baender.h"

inline double betrag_frequenzgang(const cypherdj::dsp::BandKoeff& b, double f_hz) {
  const std::complex<double> z1 = std::polar(1.0, -2.0 * M_PI * f_hz / 48000.0);
  const std::complex<double> z2 = z1 * z1;
  std::complex<double> h = 1.0;
  for (int s = 0; s < b.n_sektionen; ++s) {
    const double* c = b.sos[s];
    h *= (c[0] + c[1] * z1 + c[2] * z2) / (c[3] + c[4] * z1 + c[5] * z2);
  }
  return std::abs(h);
}
