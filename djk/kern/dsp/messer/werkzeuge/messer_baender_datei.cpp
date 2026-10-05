// messer_baender_datei <eingang.f32> <ausgang.f32>
// Eingang: float32 LE, Stereo verschränkt, 48 kHz, ohne Kopf. Rechnet in 256er-Blöcken wie der Kern
// (Fenster ab Frame 0, Index i = frame / 48 wie huelle_1khz.npy) und schreibt je Datensatz 8 float32:
// band[0..5], k_leistung, spitze. Für den Vergleich mit pruefung/referenz_baender.py.
#include <cstdio>
#include <vector>

#include "cypherdj/dsp/analyse_baender.h"

using namespace cypherdj::dsp;

int main(int argc, char** argv) {
  if (argc != 3) {
    std::fprintf(stderr, "Aufruf: messer_baender_datei <eingang.f32> <ausgang.f32>\n");
    return 2;
  }
  std::FILE* ein = std::fopen(argv[1], "rb");
  std::FILE* aus = std::fopen(argv[2], "wb");
  if (!ein || !aus) {
    std::fprintf(stderr, "Datei nicht offen\n");
    return 2;
  }
  AnalyseBaender a(vertrag_baender());
  std::vector<float> v(2 * 256), l(256), r(256);
  HuellenWerte h[8];
  long frames = 0, saetze = 0;
  for (;;) {
    const size_t k = std::fread(v.data(), sizeof(float) * 2, 256, ein);
    if (k == 0) break;
    for (size_t i = 0; i < k; ++i) {
      l[i] = v[2 * i];
      r[i] = v[2 * i + 1];
    }
    const int n = a.verarbeite(l.data(), r.data(), static_cast<int>(k), h, 8);
    for (int j = 0; j < n; ++j) {
      float z[8] = {h[j].band[0], h[j].band[1], h[j].band[2], h[j].band[3],
                    h[j].band[4], h[j].band[5], h[j].k_leistung, h[j].spitze};
      std::fwrite(z, sizeof(float), 8, aus);
    }
    frames += static_cast<long>(k);
    saetze += n;
  }
  std::fclose(ein);
  std::fclose(aus);
  std::printf("frames %ld datensaetze %ld\n", frames, saetze);
  return 0;
}
