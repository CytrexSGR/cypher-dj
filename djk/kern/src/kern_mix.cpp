// 1.15 A6: /zustand/mix feed (Kern::mix_zustand), modelled on Kern::komp_zustand (kern_deck.cpp). Runs in the callback thread right
// after the cycle's clock events, so the Mixer getters read the DSP objects the same thread ran in the previous block.
#include <cstdio>

#include "cypherdj/kern.h"

namespace cdj {

// Per channel with a running tool (gate on a source channel, multiband or channel limiter on a bus) at every multiple of 4800 samples (10 Hz): one
// MIX_ZUSTAND event, pfad = channel, pegel[0] gate, pegel[1..3] multiband low/mid/high, pegel[4] channel limiter, all reductions in dB
// >= 0 (D10). A channel whose tools all switch off publishes nothing any more (the page shows "–", no reading, 500 ms after the last event).
// The channel limiter (A5b) is a criterion since A5c: a bus whose only running tool is the limiter publishes too (kanal_limiter_aktiv).
void Kern::mix_zustand(int64_t n0, int n) {
#ifndef CYPHERDJ_MUTATION_MIX_ABSTAND_4864
  constexpr int64_t ABSTAND = 4800;
#else   // error case: 9.87 Hz instead of 10 Hz
  constexpr int64_t ABSTAND = 4864;
#endif
  const int64_t naechstes = (n0 + ABSTAND - 1) / ABSTAND * ABSTAND;
#ifndef CYPHERDJ_MUTATION_MIX_JEDER_BLOCK   // error case: every block instead of 10 Hz
  if (naechstes >= n0 + n || !mixer_) return;
#else
  (void)naechstes;
  if (!mixer_) return;
#endif
  for (int k = 0; k < MIX_KANAELE; ++k) {
#ifndef CYPHERDJ_MUTATION_MIX_ALLE_KANAELE   // error case: every channel, whether a tool runs or not
#ifndef CYPHERDJ_MUTATION_MIX_OHNE_LIMITER_KRITERIUM   // error case: a bus with only the limiter running publishes nothing
    if (!mixer_->gate_aktiv(k) && !mixer_->mb_aktiv(k) && !mixer_->kanal_limiter_aktiv(k)) continue;
#else
    if (!mixer_->gate_aktiv(k) && !mixer_->mb_aktiv(k)) continue;
#endif
#endif
    const int bus = k >= MIX_QUELLEN ? k - MIX_QUELLEN : -1;
    Ereignis e{};
    e.art = Ereignis::MIX_ZUSTAND;
    e.sample = n0;
    std::snprintf(e.pfad, sizeof e.pfad, "%s", Mixer::kanal_name(k));
    e.pegel[0] = mixer_->gate_reduktion_db(k);
    e.pegel[1] = mixer_->mb_reduktion_db(bus, 0);
#ifndef CYPHERDJ_MUTATION_MIX_BAND_VERTAUSCHT
    e.pegel[2] = mixer_->mb_reduktion_db(bus, 1);
    e.pegel[3] = mixer_->mb_reduktion_db(bus, 2);
#else   // error case: mid and high swapped
    e.pegel[2] = mixer_->mb_reduktion_db(bus, 2);
    e.pegel[3] = mixer_->mb_reduktion_db(bus, 1);
#endif
    e.pegel[4] = mixer_->kanal_limiter_reduktion_db(bus);
    melde(e);
  }
}

}  // namespace cdj
