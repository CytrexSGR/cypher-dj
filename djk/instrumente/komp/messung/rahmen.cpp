// Offline-Rahmen: liest Stereo-f32 verschachtelt von stdin, schreibt Stereo-f32 nach stdout (48 kHz, Blöcke 256)
#include <cstdio>
#include <vector>
#include <faust/dsp/dsp.h>
#include <faust/gui/UI.h>
#include <faust/gui/meta.h>
#include "ref.h"
int main() {
  Ref d; d.init(48000);
  std::vector<float> ein(512), l(256), r(256), ol(256), orr(256), aus(512);
  size_t n;
  while ((n = fread(ein.data(), sizeof(float) * 2, 256, stdin)) > 0) {
    for (size_t i = 0; i < n; ++i) { l[i] = ein[2 * i]; r[i] = ein[2 * i + 1]; }
    float* in[2] = {l.data(), r.data()}; float* out[2] = {ol.data(), orr.data()};
    d.compute((int)n, in, out);
    for (size_t i = 0; i < n; ++i) { aus[2 * i] = ol[i]; aus[2 * i + 1] = orr[i]; }
    fwrite(aus.data(), sizeof(float) * 2, n, stdout);
  }
}
