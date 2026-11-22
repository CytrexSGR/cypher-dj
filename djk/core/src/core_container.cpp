// Container core K8: the container inputs. A container (A..D = deck/1, deck/2, pad/1, pad/2) hears the player of its strip (art 1, default), the DJ pair of the arrangement
// (art 2) or nothing (art 0). The two sources have a weight each (0..CONTAINER_BLENDE) that steps one per sample toward its target, so a change blends linearly over 480 samples
// and a change inside a blend continues from the weight reached. The sample is used first, then the weights step: the first sample of a change still has the old weights and the
// new source is complete after exactly CONTAINER_BLENDE samples. Real-time safe: integers and float multiplies, no allocation.
#include <cstring>

#include "cypherdj/core.h"

namespace cdj {

static_assert(ARR_FX3_BLENDE == MIX_ZIEL_BLENDE, "the FX 3 share of an arrangement track blends like the mixer channels' (Mixer::fx3_zuweisung_setze)");

void Kern::container_fuellen(int m) noexcept {
#ifdef CYPHERDJ_MUTATION_CONTAINER_ALLOK
  {   // mutation (positive control of the allocation guard of test_kern_container_alloc): one allocation per block
    volatile char* v = new char[1];
    v[0] = 1;
    delete[] v;
  }
#endif
  for (int c = 0; c < PULT_CONTAINER; ++c) {
    const int k = dj_kanal_[c];
    if (k < 0) continue;
    const int art = container_art_[c];
    const int zp = art == CONTAINER_ART_PLAYER ? CONTAINER_BLENDE : 0;
    const int zm = art == CONTAINER_ART_MODUL ? CONTAINER_BLENDE : 0;
    int gp = container_gp_[c], gm = container_gm_[c];
#ifdef CYPHERDJ_MUTATION_CONTAINER_OHNE_BLENDE
    gp = zp;   // mutation: a hard switch, no blend
    gm = zm;
#endif
    const float* pl = quell_.player_l[PULT_CONTAINER_PLAYER[c] - 1];
    const float* pr = quell_.player_r[PULT_CONTAINER_PLAYER[c] - 1];
    const bool modul = dj_gereicht_[c];   // the pair was zeroed, handed to and filled by Arrangement::block in this sub-block
    float* l = mixer_->eingang_l(k);
    float* r = mixer_->eingang_r(k);
    float* ml = l;
    float* mr = r;
#ifdef CYPHERDJ_MUTATION_ARR_DJ_NACH_STRIP
    ml = mixer_->summe_eingang_l();   // error case: the module behind the strip, into the master sum in front of the limiter (the channel fader, trim and EQ do not act on it)
    mr = mixer_->summe_eingang_r();
#endif
    constexpr float EINS = 1.0f / static_cast<float>(CONTAINER_BLENDE);
    const int gm0 = gm;
    for (int i = 0; i < m; ++i) {
      if (gp > 0) {
        const float w = static_cast<float>(gp) * EINS;
        l[i] += pl[i] * w;
        r[i] += pr[i] * w;
      }
      if (modul && gm > 0) {
        const float w = static_cast<float>(gm) * EINS;
        ml[i] += dj_aus_l_[c][i] * w;
        mr[i] += dj_aus_r_[c][i] * w;
      }
      if (gp != zp) gp += gp < zp ? 1 : -1;
      if (gm != zm) gm += gm < zm ? 1 : -1;
    }
    container_gp_[c] = gp;
    container_gm_[c] = gm;
    if (modul && k < MIX_QUELLEN && arr_->dj_fx3_da(c + 1)) {   // loop lane strip K4: the diverted FX 3 share, weighted by the same module weight (gm, per sample, from the value this sub-block started with), then through the strip's fader
      float* fl3 = mixer_->arr_fx3_eingang_l(k);
      float* fr3 = mixer_->arr_fx3_eingang_r(k);
      int g3 = gm0;
      for (int i = 0; i < m; ++i) {
        const float w = static_cast<float>(g3) * EINS;
        fl3[i] = dj_fx3_l_[c][i] * w;
        fr3[i] = dj_fx3_r_[c][i] * w;
        if (g3 != zm) g3 += g3 < zm ? 1 : -1;
      }
      mixer_->arr_fx3_markiere(k);
    }
  }
}

// player d (0-based) is what its container hears: the container whose PULT_CONTAINER_PLAYER is d + 1 has art player
bool Kern::player_gehoert(int d) const noexcept {
  for (int c = 0; c < PULT_CONTAINER; ++c)
    if (PULT_CONTAINER_PLAYER[c] == d + 1) return container_art_[c] == CONTAINER_ART_PLAYER;
  return false;
}

}  // namespace cdj
