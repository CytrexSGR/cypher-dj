// messer_limiter_datei <eingang.f32> <ausgang.f32> <verstaerkung_db> <mit|ohne>
// Eingang float32 LE Stereo verschränkt 48 kHz. Verstärkt, lässt den Master-Limiter (Vorgaben:
// Decke -1,0 dBTP) laufen oder nicht (Fehlerfall) und misst die Echtspitze von Eingang (nach Verstärkung)
// und Ausgang mit libebur128 (BS.1770, 4-fach). Schreibt den Ausgang für die unabhängige Gegenprobe.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "cypherdj/dsp/master_limiter.h"
#include "ebur128.h"

using namespace cypherdj::dsp;

static double dbtp(ebur128_state* st) {
  double a = 0.0, b = 0.0;
  ebur128_true_peak(st, 0, &a);
  ebur128_true_peak(st, 1, &b);
  const double m = a > b ? a : b;
  return m > 0.0 ? 20.0 * std::log10(m) : -200.0;
}

int main(int argc, char** argv) {
  if (argc != 5) {
    std::fprintf(stderr, "Aufruf: messer_limiter_datei <eingang.f32> <ausgang.f32> <verstaerkung_db> <mit|ohne>\n");
    return 2;
  }
  std::FILE* ein = std::fopen(argv[1], "rb");
  std::FILE* aus = std::fopen(argv[2], "wb");
  if (!ein || !aus) {
    std::fprintf(stderr, "Datei nicht offen\n");
    return 2;
  }
  const float g = static_cast<float>(std::pow(10.0, std::atof(argv[3]) / 20.0));
  const bool mit = std::strcmp(argv[4], "mit") == 0;
  MasterLimiter lim;
  ebur128_state* st_ein = ebur128_init(2, 48000, EBUR128_MODE_TRUE_PEAK);
  ebur128_state* st_aus = ebur128_init(2, 48000, EBUR128_MODE_TRUE_PEAK);
  std::vector<float> v(2 * 256), l(256), r(256);
  long frames = 0;
  float min_absenkung = 0.0f;
  for (;;) {
    const size_t k = std::fread(v.data(), sizeof(float) * 2, 256, ein);
    if (k == 0) break;
    for (size_t i = 0; i < k; ++i) {
      v[2 * i] *= g;
      v[2 * i + 1] *= g;
      l[i] = v[2 * i];
      r[i] = v[2 * i + 1];
    }
    ebur128_add_frames_float(st_ein, v.data(), k);
    if (mit) {
      lim.verarbeite(l.data(), r.data(), static_cast<int>(k));
      const float a = lim.groesste_absenkung_db();
      if (a < min_absenkung) min_absenkung = a;
    }
    for (size_t i = 0; i < k; ++i) {
      v[2 * i] = l[i];
      v[2 * i + 1] = r[i];
    }
    ebur128_add_frames_float(st_aus, v.data(), k);
    std::fwrite(v.data(), sizeof(float) * 2, k, aus);
    frames += static_cast<long>(k);
  }
  std::printf("frames %ld limiter %s vorhalt %d echtspitze_ein_dbtp %.3f echtspitze_aus_dbtp %.3f groesste_absenkung_db %.2f\n",
              frames, mit ? "mit" : "ohne", lim.vorhalt_samples(), dbtp(st_ein), dbtp(st_aus), min_absenkung);
  ebur128_destroy(&st_ein);
  ebur128_destroy(&st_aus);
  std::fclose(ein);
  std::fclose(aus);
  return 0;
}
