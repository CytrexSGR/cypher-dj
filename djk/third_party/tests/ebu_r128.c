/* EBU-Tech-3341-Probe für die gepinnte libebur128 (Vorlage: proben/04-mixer-effekte/meter_probe.c).
   Aufruf: ebu_r128 <pegel_dbfs> <soll_lufs> <grenze_lu> <standard|histogramm>   oder   ebu_r128 stille
   Stereo-Sinus 1 kHz, 20 s, 48 kHz. Rückgabewert 0, wenn |I - soll| <= grenze (bzw. Stille: I = -inf). */
#include "ebur128.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RATE 48000
#define BLOCK 4800

static double integriert(double pegel_dbfs, int modus) {
  ebur128_state* st = ebur128_init(2, RATE, EBUR128_MODE_I | modus);
  float* puffer = malloc(sizeof(float) * 2 * BLOCK);
  const double a = pegel_dbfs <= -300.0 ? 0.0 : pow(10.0, pegel_dbfs / 20.0);
  const long n = 20L * RATE;
  for (long p = 0; p < n; p += BLOCK) {
    for (long i = 0; i < BLOCK; i++) {
      const float v = (float)(a * sin(2.0 * M_PI * 1000.0 * (double)(p + i) / RATE));
      puffer[2 * i] = v;
      puffer[2 * i + 1] = v;
    }
    ebur128_add_frames_float(st, puffer, BLOCK);
  }
  double i_lufs = 0.0;
  ebur128_loudness_global(st, &i_lufs);
  ebur128_destroy(&st);
  free(puffer);
  return i_lufs;
}

int main(int argc, char** argv) {
  if (argc == 2 && strcmp(argv[1], "stille") == 0) {
    const double i_lufs = integriert(-400.0, 0);
    printf("stille: I=%f LUFS (Soll -inf)\n", i_lufs);
    return isinf(i_lufs) && i_lufs < 0 ? 0 : 1;
  }
  if (argc != 5) {
    fprintf(stderr, "Aufruf: ebu_r128 <pegel_dbfs> <soll_lufs> <grenze_lu> <standard|histogramm> | stille\n");
    return 2;
  }
  const double pegel = atof(argv[1]), soll = atof(argv[2]), grenze = atof(argv[3]);
  const int modus = strcmp(argv[4], "histogramm") == 0 ? EBUR128_MODE_HISTOGRAM : 0;
  const double i_lufs = integriert(pegel, modus);
  const double abw = fabs(i_lufs - soll);
  printf("1 kHz %.2f dBFS %s: I=%.4f LUFS, Soll %.1f, Abweichung %.4f LU, Grenze %.3f LU -> %s\n", pegel, argv[4],
         i_lufs, soll, abw, grenze, abw <= grenze ? "GRÜN" : "ROT");
  return abw <= grenze ? 0 : 1;
}
