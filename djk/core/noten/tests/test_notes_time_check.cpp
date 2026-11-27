// Run time of the monophonic check on a four-minute stereo source (label `ruhig` by the CMake loop): process CPU time (getrusage), never
// a wall clock. Budget: 3 CPU seconds for `pruefeEinstimmig` on 240 s (the full analysis of the detector, 12 s, plus this 3 s keep the
// 15 s limit of the spec).
#include <cmath>
#include <cstdio>
#include <vector>

#include "intern.h"
#include "check.h"
#include "synth.h"
#include "teiltoene.h"

using namespace cdj::noten;

int main() {
  // 12 s of a sung line (notes of 0.45 to 0.8 s with vibrato, short gaps, one glide) repeated to 240 s; the right channel is a quieter,
  // slightly delayed copy (a stereo recording of one voice)
  std::vector<synth::Ton> linie;
  double t = 0.1;
  const double midis[] = {62, 65, 69, 67, 64, 60, 62, 67, 72, 69, 65, 63, 60, 64, 67};
  const double laenge[] = {0.6, 0.5, 0.8, 0.45, 0.7, 0.6, 0.5, 0.8, 0.9, 0.6, 0.5, 0.7, 0.6, 0.5, 0.8};
  for (int i = 0; i < 15; ++i) {
    synth::Ton n;
    n.start_s = t;
    n.dauer_s = laenge[i];
    n.midi = midis[i];
    n.vib_ct = 30.0;
    n.pegel = 0.3;
    if (i == 7) n.midi_ende = midis[i] + 2.0;
    n.mit_huelle = (i % 2) == 0;
    linie.push_back(n);
    t += laenge[i] + 0.12;
  }
  const double periode_s = std::ceil(t);
  const std::vector<float> eins = synth::melodie(linie, periode_s);
  const std::vector<float> m = synth::wiederhole(eins, 240.0);
  Stereo x;
  x.l = m;
  x.r.resize(m.size());
  for (size_t i = 0; i < m.size(); ++i) x.r[i] = 0.8f * (i >= 5 ? m[i - 5] : 0.0f);

  Kurve k;
  k.frames = x.frames();
  k.detektor = "pyin";
  k.kurve = "pyin-1.noten_hmm-1";
  const int64_t nf = frameZahl(x.frames());
  k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
  k.konf.assign(static_cast<size_t>(nf), 1.0);
  for (int64_t j = 0; j < nf; ++j) {
    const double ts = std::fmod(static_cast<double>(j * HOP) / SR, periode_s);
    for (const synth::Ton& n : linie)
      if (ts >= n.start_s + 0.02 && ts <= n.start_s + n.dauer_s - 0.03) k.f0_ct[static_cast<size_t>(j)] = 100.0 * synth::tonHoehe(n, ts - n.start_s);
  }

  const double c0 = cpuSekunden();
  const Mono mo = pruefeEinstimmig(x, k, nullptr);
  const double sek = cpuSekunden() - c0;
  std::printf("pruefeEinstimmig on 240 s stereo: %.3f CPU s, checked %lld frames, share %.4f, polyphonic %d\n", sek,
              static_cast<long long>(mo.geprueft_frames), mo.anteil, mo.mehrstimmig);
  PRUEF(mo.geprueft_frames > 5000);
  PRUEF(!mo.mehrstimmig);
  PRUEF(sek <= 3.0);
  PRUEF_ENDE();
}
