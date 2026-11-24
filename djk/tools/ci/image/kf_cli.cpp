// keyfinder-stdin: liest float32-Mono-PCM von stdin, Argument = Abtastrate.
// Ausgabe: Zeile 1 Schluesselindex (libKeyFinder key_t), Zeile 2 kollabierter Chromavektor (72 Baender).
#include <keyfinder/keyfinder.h>
#include <keyfinder/workspace.h>
#include <cstdio>
#include <cstdlib>
#include <vector>
int main(int argc, char** argv) {
  unsigned int sr = argc > 1 ? atoi(argv[1]) : 44100;
  std::vector<float> buf; float tmp[65536]; size_t n;
  while ((n = fread(tmp, sizeof(float), 65536, stdin)) > 0) buf.insert(buf.end(), tmp, tmp + n);
  KeyFinder::AudioData a; a.setFrameRate(sr); a.setChannels(1); a.addToSampleCount(buf.size());
  for (size_t i = 0; i < buf.size(); i++) a.setSample(i, buf[i]);
  static KeyFinder::KeyFinder k; KeyFinder::Workspace ws;
  k.progressiveChromagram(a, ws); k.finalChromagram(ws);
  std::vector<double> cv = ws.chromagram->collapseToOneHop();
  printf("%d\n", (int)k.keyOfChromagram(ws));
  for (size_t i = 0; i < cv.size(); i++) printf(i ? " %.6g" : "%.6g", cv[i]);
  printf("\n"); return 0;
}
