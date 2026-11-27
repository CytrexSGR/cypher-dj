// The phase reading of the pitch edit (BERICHT_teilton2.md section 8, B step 10): the phases of the partials at the moved pitch. ONE place,
// so that a later improvement replaces only this file. Rule "index": the new partial k takes the phase of the old partial k (the waveform
// keeps its shape: crest factor and round trip are better than with a phase read at the new frequency).
#include <cmath>

#include "render.h"

namespace cdj::noten {

void lesePhase(const Teiltoene& t, int kanal, int frame, double faktor, std::vector<double>& phase, double mischung) {
  const int nneu = neueTeiltoene(t, frame, faktor, mischung);
  phase.assign(static_cast<size_t>(nneu), 0.0);
  if (nneu == 0) return;
  const std::vector<std::complex<double>>& b = kanal == 0 ? t.b_l[static_cast<size_t>(frame)] : t.b_r[static_cast<size_t>(frame)];
  for (size_t k = 0; k < b.size() && k < phase.size(); ++k) phase[k] = std::arg(b[k]);
}

}  // namespace cdj::noten
