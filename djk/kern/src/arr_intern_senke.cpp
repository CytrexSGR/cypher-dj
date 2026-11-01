// Baukasten S20: the dispatcher of the internal tracks (arr_intern_senke.h).
#include "cypherdj/arr_intern_senke.h"

#include <cstring>

#include "cypherdj/arr_wiedergabe.h"

namespace cdj {

ArrSenke* ArrInternSenke::innen(int spur) const noexcept {
  const ArrSnapshot* s = arr_.snapshot();
  if (!s || spur < 0 || spur >= ARR_SPUREN) return nullptr;
  const ArrSpur& x = s->spur[spur];
  if (x.art != ArrArt::intern) return nullptr;
  return std::strcmp(x.geraet, "bk") == 0 ? bk_ : rb_;
}

ArrSenke* ArrInternSenke::ziel(int spur) const noexcept {
  if (ArrSenke* s = innen(spur)) return s;
  return spur >= 0 && spur < ARR_SPUREN ? zuletzt_[spur] : nullptr;
}

void ArrInternSenke::note(int spur, int64_t z, uint8_t ton, uint8_t vel, bool an) noexcept {
  if (ArrSenke* s = ziel(spur)) s->note(spur, z, ton, vel, an);
}

void ArrInternSenke::alle_aus(int spur, int64_t z) noexcept {
  if (ArrSenke* s = ziel(spur)) s->alle_aus(spur, z);
}

void ArrInternSenke::transport_start(int spur, int64_t z) noexcept {
  if (ArrSenke* s = innen(spur)) s->transport_start(spur, z);
}

bool ArrInternSenke::spur_weg(int spur, int64_t s, bool andere_spur) noexcept {
  ArrSenke* a = ziel(spur);
  if (!a) return false;
  // the sink this track last played on fades it out; zuletzt_ stays until the block runs (it clears it)
  if (spur >= 0 && spur < ARR_SPUREN && zuletzt_[spur]) a = zuletzt_[spur];
  return a->spur_weg(spur, s, andere_spur);
}

void ArrInternSenke::auto_parameter(int spur, int param, float wert) noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_INTERN_OHNE_AUTO
  (void)spur; (void)param; (void)wert;   // error case: the dispatcher drops the lane values (the base class ignores them)
#else
  if (ArrSenke* s = innen(spur)) s->auto_parameter(spur, param, wert);
#endif
}

void ArrInternSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  ArrSenke* cur = innen(spur);
  ArrSenke*& z = zuletzt_[spur];
  // The arrangement sees one sink for every internal track, so it calls no spur_weg when the device of a track changes (rb338 <-> bk)
  // or when the track leaves after a swap; the dispatcher does it: the old sink fades the track out in this block.
#ifndef CYPHERDJ_MUTATION_ARR_INTERN_OHNE_WECHSEL
  if (z && z != cur) {
    if (z->spur_weg(spur, s0, false)) z->block(spur, s0, m, l, r);
    z = nullptr;
  }
#endif
  if (cur) {
    z = cur;
    cur->block(spur, s0, m, l, r);
  }
}

}  // namespace cdj
