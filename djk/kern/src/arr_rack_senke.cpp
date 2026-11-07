// Package 1.9 U6: the instrument rack as a sink (arr_rack_senke.h).
#include "cypherdj/arr_rack_senke.h"

#include <algorithm>

namespace cdj {

namespace {

bool in_zone(const ArrGlied& g, uint8_t ton, uint8_t vel, int kette) noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_RACK_ZONE_EXKLUSIV
  const bool ton_ok = ton >= g.ton_lo && ton < g.ton_hi;   // error case: the upper bound of the key zone is exclusive (a zone ending at 59 loses key 59)
#else
  const bool ton_ok = ton >= g.ton_lo && ton <= g.ton_hi;
#endif
  return ton_ok && vel >= g.vel_lo && vel <= g.vel_hi && kette >= g.kette_lo && kette <= g.kette_hi;
}

}  // namespace

int64_t ArrRackSenke::vorhalt() const noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_RACK_OHNE_VORHALT
  return 0;   // error case: the Surge member gets its notes at the sample, they sound one round trip late
#else
  const ArrSnapshot* s = arr_.snapshot();
  if (!s || s->rack_wirt <= 0) return 0;
  int64_t v = 0;
  for (const ArrSenke* w : wirt_)
    if (w) v = std::max(v, w->vorhalt());
  return v;
#endif
}

int ArrRackSenke::glieder(int spur) const {
  int n = 0;
  if (spur >= 0 && spur < ARR_SPUREN)
    for (const Rec& r : sp_[spur].rec) n += r.art != 0 ? 1 : 0;
  return n;
}

ArrRackSenke::Rec* ArrRackSenke::rec_fuer(Spur& p, const ArrGlied& g) noexcept {
  const int8_t art = g.art == ArrArt::wirt ? 2 : 1;
  const int8_t slot = art == 2 ? static_cast<int8_t>(g.slot) : 0;
  Rec* frei = nullptr;
  for (Rec& r : p.rec) {
    if (r.art == 0) {
      if (!frei) frei = &r;
      continue;
    }
    if (r.art == art && r.platz == g.platz && r.slot == slot) return &r;
  }
  if (!frei) {
    ++verloren_;
    return nullptr;
  }
  *frei = Rec{};
  frei->art = art;
  frei->platz = static_cast<int16_t>(g.platz);
  frei->slot = slot;
  return frei;
}

void ArrRackSenke::sende(Spur& p, int spur, const Rec& r, int64_t ziel, uint8_t ton, uint8_t vel, uint8_t art) noexcept {
  if (r.art == 2) {   // Surge: at once, the Wirt sink sends it one round trip before the target sample
    ArrSenke* w = r.slot >= 1 && r.slot <= ARR_WIRT_SLOTS ? wirt_[r.slot - 1] : nullptr;
    if (!w) return;
    if (art == 0) w->note(spur, ziel, ton, vel, true);
    else if (art == 1) w->note(spur, ziel, ton, 0, false);
    else w->alle_aus(spur, ziel);
    return;
  }
  if (p.n >= ARR_RACK_WARTE) {   // counted, not reported (a lost note off would hang a note; the limit is far above a block's traffic)
    ++verloren_;
    return;
  }
  p.ev[p.n++] = Ev{ziel, r.platz, art, ton, vel};   // internal: held until the block that holds the target sample
}

void ArrRackSenke::faelliges_weitergeben(Spur& p, int64_t bis) noexcept {
  int w = 0;
  for (int i = 0; i < p.n; ++i) {
    const Ev& e = p.ev[i];
    if (e.ziel >= bis) {
      p.ev[w++] = e;
      continue;
    }
    if (!intern_) continue;
    if (e.art == 0) intern_->note(e.platz, e.ziel, e.ton, e.vel, true);
    else if (e.art == 1) intern_->note(e.platz, e.ziel, e.ton, 0, false);
    else intern_->alle_aus(e.platz, e.ziel);
  }
  p.n = w;
}

void ArrRackSenke::note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  Spur& p = sp_[spur];
  ton &= 0x7f;
  if (an) {
    const ArrSnapshot* s = arr_.snapshot();
    if (!s || s->spur[spur].art != ArrArt::rack) return;
    const ArrSpur& sp = s->spur[spur];
    for (int i = 0; i < sp.n_glieder; ++i) {
      const ArrGlied& g = sp.glied[i];
      if (!in_zone(g, ton, vel, sp.kette)) continue;
      Rec* r = rec_fuer(p, g);
      if (!r) continue;
      r->klingt[ton >> 6] |= 1ULL << (ton & 63);
      if (r->platz >= ARR_SPUREN && r->platz < ARR_SENKEN_PLAETZE) ++an_[r->platz - ARR_SPUREN];
      sende(p, spur, *r, ziel, ton, vel, 0);
    }
    return;
  }
  // note off: to the members that hold this note, by the record of the note on (not by the zones: a chain change in between must not strand it)
  for (Rec& r : p.rec) {
    if (r.art == 0) continue;
    const uint64_t bit = 1ULL << (ton & 63);
#ifdef CYPHERDJ_MUTATION_ARR_RACK_OFF_AN_ALLE
    r.klingt[ton >> 6] &= ~bit;   // error case: the off goes to every member, also to those that never got the note on
#else
    if (!(r.klingt[ton >> 6] & bit)) continue;
    r.klingt[ton >> 6] &= ~bit;
#endif
    sende(p, spur, r, ziel, ton, 0, 1);
  }
}

void ArrRackSenke::alle_aus(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  Spur& p = sp_[spur];
  faelliges_weitergeben(p, ziel);   // what falls before the stop still sounds, what comes after never starts
  p.n = 0;
  const ArrSnapshot* s = arr_.snapshot();
  if (s && s->spur[spur].art == ArrArt::rack)
    for (int i = 0; i < s->spur[spur].n_glieder; ++i) rec_fuer(p, s->spur[spur].glied[i]);   // every current member gets the stop, also one that never sounded
  for (Rec& r : p.rec) {
    if (r.art == 0) continue;
    r.klingt[0] = r.klingt[1] = 0;
    if (r.art == 2) {
      if (ArrSenke* w = r.slot >= 1 && r.slot <= ARR_WIRT_SLOTS ? wirt_[r.slot - 1] : nullptr) w->alle_aus(spur, ziel);
    } else if (intern_) {
      intern_->alle_aus(r.platz, ziel);
    }
  }
}

void ArrRackSenke::transport_start(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return;
  Spur& p = sp_[spur];
  p.n = 0;   // events of the run before: gone, the start rule of the sinks begins from silence
  for (Rec& r : p.rec) r.klingt[0] = r.klingt[1] = 0;
  const ArrSnapshot* s = arr_.snapshot();
  if (!s || s->spur[spur].art != ArrArt::rack) return;
  for (int i = 0; i < s->spur[spur].n_glieder; ++i) {
    const ArrGlied& g = s->spur[spur].glied[i];
    Rec* r = rec_fuer(p, g);
    if (!r) continue;
    if (r->art == 2) {
      if (ArrSenke* w = r->slot >= 1 && r->slot <= ARR_WIRT_SLOTS ? wirt_[r->slot - 1] : nullptr) w->transport_start(spur, ziel);
    } else if (intern_) {
      intern_->transport_start(r->platz, ziel);
    }
  }
}

bool ArrRackSenke::spur_weg(int spur, int64_t, bool) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN) return false;
  Spur& p = sp_[spur];
  bool da = false;
  for (const Rec& r : p.rec) da = da || r.art != 0;
  p.weg = da;   // the next block() of this track fades the members out (the snapshot of that block says what became of them)
  return da;
}

// is a Surge slot played by a track or a member of the snapshot?
bool ArrRackSenke::slot_gespielt(const ArrSnapshot* snap, int slot, int) const noexcept {
  if (!snap) return false;
  for (const ArrSpur& t : snap->spur) {
    if (t.art == ArrArt::wirt && t.slot == slot) return true;
    if (t.art == ArrArt::rack)
      for (int i = 0; i < t.n_glieder; ++i)
        if (t.glied[i].art == ArrArt::wirt && t.glied[i].slot == slot) return true;
  }
  return false;
}

void ArrRackSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept {
  if (spur < 0 || spur >= ARR_SPUREN || m <= 0 || m > ARR_BLOCK) return;
  Spur& p = sp_[spur];
  const ArrSnapshot* snap = arr_.snapshot();
  const ArrSpur* sp = snap && snap->spur[spur].art == ArrArt::rack ? &snap->spur[spur] : nullptr;
  for (Rec& x : p.rec) x.aktuell = false;
  Rec* je_glied[ARR_RACK_GLIEDER] = {};
  if (sp)
    for (int i = 0; i < sp->n_glieder; ++i) {
      je_glied[i] = rec_fuer(p, sp->glied[i]);
      if (je_glied[i]) je_glied[i]->aktuell = true;
    }
  faelliges_weitergeben(p, s0 + m);   // internal events whose target sample lies in this block go to their sink now
  // one member: render into the scratch buffers, add with the gain (a changed gain ramps over the block)
  auto addiere = [&](Rec& x, float g1, bool rampe) {
    std::fill(sl_, sl_ + m, 0.0f);
    std::fill(sr_, sr_ + m, 0.0f);
    if (x.art == 1) {
      if (intern_) intern_->block(x.platz, s0, m, sl_, sr_);
    } else if (ArrSenke* w = x.slot >= 1 && x.slot <= ARR_WIRT_SLOTS ? wirt_[x.slot - 1] : nullptr) {
      w->block(spur, s0, m, sl_, sr_);
    }
#ifdef CYPHERDJ_MUTATION_ARR_RACK_GAIN_SPRUNG
    const float g0 = g1;   // error case: a gain change is a step at the start of the block
#else
    const float g0 = rampe && x.gain_da ? x.gain : g1;
#endif
    if (g0 == g1) {
      for (int i = 0; i < m; ++i) {
        l[i] += sl_[i] * g1;
        r[i] += sr_[i] * g1;
      }
    } else {
      const float d = (g1 - g0) / static_cast<float>(m);
      for (int i = 0; i < m; ++i) {
        const float g = g0 + d * static_cast<float>(i + 1);   // the last sample reaches g1, the next block starts there
        l[i] += sl_[i] * g;
        r[i] += sr_[i] * g;
      }
    }
    x.gain = g1;
    x.gain_da = true;
  };
  if (sp)
    for (int i = 0; i < sp->n_glieder; ++i)
      if (je_glied[i]) addiere(*je_glied[i], sp->glied[i].gain, true);
  // members that left (removed from the rack, or the track is no rack any more): the old device fades for one block, then the record is freed
  for (Rec& x : p.rec) {
    if (x.art == 0 || x.aktuell) continue;
    if (x.art == 1) {
      if (!(snap && snap->platz(x.platz).art != ArrArt::leer)) addiere(x, x.gain, false);   // a new member in that slot takes over by itself
    } else if (!slot_gespielt(snap, x.slot, spur)) {
      if (ArrSenke* w = x.slot >= 1 && x.slot <= ARR_WIRT_SLOTS ? wirt_[x.slot - 1] : nullptr)
        if (w->spur_weg(spur, s0, false)) addiere(x, x.gain, false);
    }
    x = Rec{};
  }
  p.weg = false;
}

}  // namespace cdj
