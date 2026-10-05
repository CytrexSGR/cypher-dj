// Prüft die zur Bauzeit aus baender.json eingebauten Koeffizienten (Scheibe 14, SCHNITTSTELLEN 6.2).
#include <cmath>
#include <cstdio>

#include "cypherdj/dsp/analyse_baender.h"
#include "frequenzgang.h"
#include "pruef.h"

using namespace cypherdj::dsp;

int main() {
  const BaenderKoeff& k = vertrag_baender();
  const double grenzen[6][2] = {{30, 90}, {90, 250}, {250, 800}, {800, 2000}, {2000, 6000}, {6000, 16000}};
  for (int b = 0; b < kBaender; ++b) {
    const BandKoeff& q = k.band[b];
    PRUEFE(q.n_sektionen >= 1 && q.n_sektionen <= kMaxSektionen);
    for (int s = 0; s < q.n_sektionen; ++s) PRUEFE(q.sos[s][3] == 1.0);
    PRUEFE(q.von_hz == grenzen[b][0] && q.bis_hz == grenzen[b][1]);
    // Mitte (geometrisch) lässt durch, an beiden Grenzen -3 dB auf 2 % (Abnahme von Scheibe 09).
    const double mitte = std::sqrt(q.von_hz * q.bis_hz);
    const double h_mitte = betrag_frequenzgang(q, mitte);
    const double h_von = betrag_frequenzgang(q, q.von_hz);
    const double h_bis = betrag_frequenzgang(q, q.bis_hz);
    std::printf("band %d %6.0f bis %6.0f Hz: |H| Mitte %.4f, unten %.4f, oben %.4f\n", b, q.von_hz, q.bis_hz, h_mitte,
                h_von, h_bis);
    PRUEFE(h_mitte > 0.9);
    PRUEFE_NAHE(h_von, std::sqrt(0.5), 0.02 * std::sqrt(0.5));
    PRUEFE_NAHE(h_bis, std::sqrt(0.5), 0.02 * std::sqrt(0.5));
  }
  // K-Filter aus baender.json gleich den Normwerten BS.1770-4 (48 kHz)
  PRUEFE(k.k_filter.n_sektionen == 2);
  for (int s = 0; s < 2; ++s)
    for (int j = 0; j < 6; ++j) PRUEFE(k.k_filter.sos[s][j] == kKFilterNorm[s][j]);
  return pruef_ende("test_baender_koeff");
}
