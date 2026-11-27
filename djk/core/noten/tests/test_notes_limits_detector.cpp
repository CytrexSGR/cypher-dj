// Limits of the spec for the detector, pooled over synthetic material (synth.h): ten tones from 41 Hz to 1000 Hz with vibrato up to
// 100 ct at 5.5 Hz, glides and 120 ms notes. Raw pitch at 50 ct >= 97 percent of the voiced frames, octave errors <= 0.5 percent,
// voicing >= 95 percent correct, onsets (segmentiere on the curve) within 30 ms for >= 90 percent of the true notes.
// Label ruhig (heavy): a whole 30 second signal per run.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "detector.h"
#include "check.h"
#include "synth.h"

using namespace cdj::noten;

namespace {

/// A melody: every note is followed by a pause of 0.15 s. Returns the notes with their start times (the truth) and the signal.
std::vector<synth::Ton> melodie() {
  std::vector<synth::Ton> n;
  double t = 0.2;
  auto dazu = [&](double midi, double dauer, double vibCt, double ende = -1.0, double pegel = 0.3) {
    synth::Ton x;
    x.start_s = t;
    x.dauer_s = dauer;
    x.midi = midi;
    x.midi_ende = ende;
    x.vib_ct = vibCt;
    x.pegel = pegel;
    n.push_back(x);
    t += dauer + 0.15;
  };
  // ten sustained tones 41 Hz .. 1000 Hz, vibrato depth from 0 to 100 ct
  const double midi[10] = {28.0, 33.0, 40.0, 47.0, 54.0, 61.0, 68.0, 75.0, 81.0, 83.2};
  for (int i = 0; i < 10; ++i) dazu(midi[i], 0.9, 100.0 * i / 9.0);
  // glides (an octave over 0.6 s up and down, a fifth over 0.4 s, a bass glide)
  dazu(48.0, 0.6, 0.0, 60.0);
  dazu(69.0, 0.6, 0.0, 57.0);
  dazu(55.0, 0.4, 0.0, 62.0);
  dazu(36.0, 0.7, 0.0, 43.0);
  // short notes of 120 ms
  for (double m : {55.0, 60.0, 64.0, 67.0, 72.0, 59.0}) dazu(m, 0.12, 0.0);
  // a few notes with vibrato at a different level
  dazu(62.0, 0.8, 60.0, -1.0, 0.1);
  dazu(50.0, 0.8, 80.0, -1.0, 0.5);
  return n;
}

}  // namespace

int main() {
  const std::vector<synth::Ton> noten = melodie();
  const double dauer = noten.back().start_s + noten.back().dauer_s + 0.5;
  const std::vector<float> x = synth::melodie(noten, dauer);
  const Kurve k = erkenne(x, 48000, nullptr);
  const size_t nf = k.f0_ct.size();
  PRUEF(nf == x.size() / 256 + 1);

  // truth per frame: voiced inside a note, unvoiced outside; frames within 20 ms of a note boundary are not scored
  const double guard = 0.020;
  size_t stimmhaftWahr = 0, genau = 0, oktav = 0, voicingOk = 0, bewertet = 0;
  for (size_t f = 0; f < nf; ++f) {
    const double t = static_cast<double>(f) * 256.0 / 48000.0;
    bool nahe = false, innen = false;
    double wahrMidi = 0.0;
    for (const auto& n : noten) {
      if (std::fabs(t - n.start_s) < guard || std::fabs(t - (n.start_s + n.dauer_s)) < guard) nahe = true;
      if (t >= n.start_s && t <= n.start_s + n.dauer_s) { innen = true; wahrMidi = synth::tonHoehe(n, t - n.start_s); }
    }
    if (nahe) continue;
    ++bewertet;
    const bool erkannt = k.f0_ct[f] > 0;
    if (erkannt == innen) ++voicingOk;
    if (!innen) continue;
    ++stimmhaftWahr;
    if (!erkannt) continue;
    const double abw = k.f0_ct[f] - wahrMidi * 100.0;
    if (std::fabs(abw) <= 50.0) { ++genau; continue; }
    for (int o : {-2, -1, 1, 2}) if (std::fabs(abw - 1200.0 * o) <= 50.0) { ++oktav; break; }
  }
  const double rpa = static_cast<double>(genau) / static_cast<double>(stimmhaftWahr);
  const double okt = static_cast<double>(oktav) / static_cast<double>(stimmhaftWahr);
  const double voicing = static_cast<double>(voicingOk) / static_cast<double>(bewertet);
  std::printf("frames %zu, scored %zu, voiced %zu: raw pitch at 50 ct %.4f, octave errors %.4f, voicing %.4f\n", nf, bewertet, stimmhaftWahr, rpa, okt, voicing);
  PRUEF(rpa >= 0.97);
  PRUEF(okt <= 0.005);
  PRUEF(voicing >= 0.95);

  // onsets: segmentiere on the curve; a true note is found when a detected note starts within 30 ms of its start
  const auto gefunden = segmentiere(k, x, 48000);
  size_t treffer = 0;
  for (const auto& n : noten) {
    bool ok = false;
    for (const auto& g : gefunden) if (std::fabs(g.qa - n.start_s) <= 0.030) ok = true;
    if (ok) ++treffer;
    else std::printf("  onset missed: note at %.3f s, midi %.1f, %.2f s\n", n.start_s, n.midi, n.dauer_s);
  }
  const double onset = static_cast<double>(treffer) / static_cast<double>(noten.size());
  std::printf("true notes %zu, detected %zu, onsets within 30 ms %.4f\n", noten.size(), gefunden.size(), onset);
  PRUEF(onset >= 0.90);
  PRUEF_ENDE();
}
