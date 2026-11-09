// Measuring tool of the production export null test (1.10 slice 2, task 23, N7): reference for the null test of the export.
// Reads a render WAV (float32 stereo), runs it through a fresh cypherdj::dsp::Isolator (gains 1, 0, blocks of 256 like
// test_render.cpp case 10) and writes the result as a WAV. Usage: iso_ref <in.wav> <out.wav>
#include <cstdio>
#include <string>
#include <vector>
#include <algorithm>
#include <cypherdj/dsp/isolator.h>
#include "cypherdj/wav.h"

int main(int argc, char** argv) {
  if (argc != 3) { std::fprintf(stderr, "iso_ref <ein.wav> <aus.wav>\n"); return 2; }
  std::vector<float> l, r, ol, orr;
  std::string f;
  if (!cdj::lies_wav_f32(argv[1], l, r, f)) { std::fprintf(stderr, "%s\n", f.c_str()); return 2; }
  ol.resize(l.size()); orr.resize(r.size());
  cypherdj::dsp::Isolator iso;
  const std::vector<float> eins(256, 1.0f);
  for (size_t i = 0; i < l.size(); i += 256) {
    const int m = static_cast<int>(std::min<size_t>(256, l.size() - i));
    iso.verarbeite(&l[i], &r[i], &ol[i], &orr[i], m, eins.data(), eins.data(), eins.data());
  }
  if (!cdj::schreibe_wav_f32(argv[2], ol, orr, f)) { std::fprintf(stderr, "%s\n", f.c_str()); return 2; }
  std::printf("{\"frames\":%zu}\n", l.size());
  return 0;
}
