// Container core K3 (index plan F2/F3): stage 1 of Kern::audio. One call per sub-block fills the source buffers (quell_) in a fixed order:
//   1. clear all 48 buffers (m frames)
//   2. the decks into player[0..3]
//   3. the Erzeuger streams into strom[0..15] (stream n = index n - 1), then the graphs that rang out go back to the net thread
//   4. the host returns rueck(e) into strom[e - 1] for e in {1,2,3,5,6,7}; rueck(4) (production) reaches no stream, rueck(8) is the previewer service
//   5. the previewer return into the PFL sum (Mixer::vorhoer_eingang): never master, bus, send or beat FX
//   6. the four external input pairs into ein[0..3] (a missing port stays missing for the consumers: ein_da_)
//   7. the duck: the kick events of this sub-block trigger it, it acts on the buffers of streams 2 and 3 (DUCK_STROEME)
//   8. the players go into the container inputs in stage 3 (core_container.cpp); the stream buffers reach no mixer input
// Real-time safe: no allocation, no I/O.
#include <algorithm>
#include <cmath>
#include <cstring>

#include "cypherdj/core.h"

namespace cdj {

void Kern::quellen_block(int64_t s0, int m, int off, ErzAusloeser& ausl) noexcept {
  const Karte& karte = plan_.karte();
  quell_.leeren(m);
  decks_block(s0, m);   // Scheibe 31: the decks into player[0..3], starts and stops at the sample
  erz_->block(karte, s0, m, quell_.strom_l, quell_.strom_r, midi_aus_, zyklus_n0_, &ausl);   // Plan 2026-09-27 + Studio S5 (MIDI streams)
  {   // Baukasten S3a: graphs that rang out go to the net thread for release
    CypherBk* frei[8];
    for (int nf; (nf = erz_->bk_frei(frei, 8)) > 0;)
      for (int i = 0; i < nf; ++i) {
        Ereignis x{};
        x.art = Ereignis::ERZ_BK_ALT;
        x.sample = s0;
        x.zeiger = frei[i];
        melde(x);
      }
  }
  // Studio S5: host returns of the Wirte into the streams, before the duck. Audit F01: the only audio input without a check, so NaN/Inf out and outliers clamped to +-8.
  bool vorhoer = false;
  const int64_t o = s0 - zyklus_n0_;
  for (int e = 0; e < 8; ++e) {
    if (!rueck_l_[e] || !rueck_r_[e]) continue;
    float* l;
    float* r;
    if (e == 7) {   // rueck_erz_8: the previewer service (the browser pre-listen), not a stream
      if (!vorhoer) {
        std::memset(vorhoer_l_, 0, sizeof(float) * static_cast<size_t>(m));
        std::memset(vorhoer_r_, 0, sizeof(float) * static_cast<size_t>(m));
        vorhoer = true;
      }
      l = vorhoer_l_;
      r = vorhoer_r_;
    } else {
#ifndef CYPHERDJ_MUTATION_ARR_RUECK_ERZ4
      if (e == 3) continue;   // D1 K1 (Spec 2.3), K3: rueck_erz_4 belongs to no stream, it does not sound
#endif
      l = quell_.strom_l[e];
      r = quell_.strom_r[e];
    }
    for (int i = 0; i < m; ++i) {
      const float a = rueck_l_[e][o + i], c = rueck_r_[e][o + i];
      const bool ok = std::isfinite(a) && std::isfinite(c);
      l[i] += ok ? std::clamp(a, -8.0f, 8.0f) : 0.0f;
      r[i] += ok ? std::clamp(c, -8.0f, 8.0f) : 0.0f;
      if (!ok) ++rueck_unendlich_;
    }
  }
  if (vorhoer) mixer_->vorhoer_eingang(vorhoer_l_, vorhoer_r_, m);
  for (int k = 0; k < EIN_PAARE; ++k) {   // I08: the external pairs of this sub-block (the JACK buffers of the cycle plus the sub-block offset)
    const float* pl = ein_bank_.links(k + 1);
    const float* pr = ein_bank_.rechts(k + 1);
    ein_da_[k][0] = pl != nullptr;
    ein_da_[k][1] = pr != nullptr;
    if (pl) std::memcpy(quell_.ein_l[k], pl + off, sizeof(float) * static_cast<size_t>(m));
    if (pr) std::memcpy(quell_.ein_r[k], pr + off, sizeof(float) * static_cast<size_t>(m));
  }
  // K2: the duck starts AT the kick event, not delayed by the host round trip. Since Glanz 2.7 (F19) MIDI notes leave earlier by the round trip: a bass note with the kick arrives
  // together with it (before: ~545 samples later, acceptance 2026-09-30) and meets the duck in its attack (240 samples, duck.h:17), not in the level that is already lowered.
#ifdef CYPHERDJ_MUTATION_DUCK_VERSATZ_NULL
  for (int i = 0; i < ausl.n; ++i) mixer_->duck_ausloesen(0);   // mutation: duck at the block start, without the trigger sample
#else
  for (int i = 0; i < ausl.n; ++i) mixer_->duck_ausloesen(ausl.sample[i] - s0);
#endif
  mixer_->duck_quellen(quell_.strom_l, quell_.strom_r, DUCK_STROEME, 2, m);
  for (int s = 0; s < QP_STROEME; ++s) {   // K4: the peak of a set stream for /pegel, taken from the final stream buffer (after the host return and the duck)
    if (!erz_->strom_gesetzt(s + 1)) continue;
    float sp = strom_spitze_[s];
    for (int i = 0; i < m; ++i) sp = std::max(sp, std::max(std::fabs(quell_.strom_l[s][i]), std::fabs(quell_.strom_r[s][i])));
    strom_spitze_[s] = sp;
  }
}

}  // namespace cdj
