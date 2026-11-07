// Package 1.9 (E4): a Kit as the sink of the internal project tracks (arr_kit_senke.h). Order per block: take over a new Kit (fading out
// the old voices for one block), then the collected events and the transport start in the order of their target samples, with the voices
// mixed between them, then the short fade before a pending start.
#include "cypherdj/arr_kit_senke.h"

#include <algorithm>
#include <cstring>

namespace cdj {

int ArrKitSenke::stimmen(int spur) const {
  int n = 0;
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return 0;
  for (const Stimme& v : sp_[spur].sti) n += v.klang ? 1 : 0;
  return n;
}

int ArrKitSenke::ausklingend(int spur) const {
  int n = 0;
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return 0;
  for (const Stimme& v : sp_[spur].ak) n += v.klang ? 1 : 0;
  return n;
}

int ArrKitSenke::spielend() const {
  int n = 0;
  for (const Spur& p : sp_) n += p.kit ? 1 : 0;
  return n;
}

bool ArrKitSenke::nutzt(const Kit* k) const noexcept {
  if (!k) return false;
  for (const Spur& p : sp_) {   // aktiv first, blende second: the sink publishes blende before it overwrites aktiv and clears it last
    if (p.aktiv.load(std::memory_order_acquire) == k) return true;
#ifndef CYPHERDJ_MUTATION_ARR_KIT_NUTZT_FALSCH
    if (p.blende.load(std::memory_order_acquire) == k) return true;
#endif
  }
  return false;
}

void ArrKitSenke::schiebe(Spur& p, const Ev& e) noexcept {
  if (p.n >= ARR_KIT_WARTE) {   // more than fits until the next block: counted, not reported
    ++verloren_;
    return;
  }
  int i = p.n++;
  while (i > 0 && p.ev[i - 1].ziel > e.ziel) {   // keep the queue in the order of the target samples (stable for equal ones)
    p.ev[i] = p.ev[i - 1];
    --i;
  }
  p.ev[i] = e;
}

void ArrKitSenke::note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || !an) return;   // a note off is ignored: a one-shot plays to its end (no choke)
  schiebe(sp_[spur], Ev{ziel, 0, ton, vel});
}

void ArrKitSenke::alle_aus(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  schiebe(sp_[spur], Ev{ziel, 2, 0, 0});
}

void ArrKitSenke::transport_start(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  sp_[spur].start = ziel;   // acts in the block that holds ziel
}

bool ArrKitSenke::spur_weg(int spur, int64_t, bool) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || !sp_[spur].kit) return false;
  sp_[spur].weg = true;   // acts in the next block() of this track: fade out, release
  return true;
}

void ArrKitSenke::leeren(Spur& p) noexcept {
  for (Stimme& v : p.sti) v.klang = nullptr;
  for (Stimme& v : p.ak) v.klang = nullptr;
}

// A voice ends with the 5 ms fade: it moves to the pool of fading voices (a free place, else the one nearest its end is cut short).
void ArrKitSenke::ausklingen(Spur& p, Stimme& v) noexcept {
  if (!v.klang) return;
  Stimme* z = nullptr;
  for (Stimme& x : p.ak)
    if (!x.klang) {
      z = &x;
      break;
    }
  if (!z) {
    z = &p.ak[0];
    for (Stimme& x : p.ak)
      if (x.aus > z->aus) z = &x;
    ++abgeschnitten_;
  }
  *z = v;
  z->aus = 0;
  v.klang = nullptr;
}

void ArrKitSenke::einsatz(Spur& p, const Ev& e) noexcept {
  if (e.art == 2) {   // all notes off: every voice ends with the fade
    for (Stimme& v : p.sti) ausklingen(p, v);
    return;
  }
  if (e.ton >= KIT_NOTEN || !p.kit) return;
  const KitKlang& kl = p.kit->klang[e.ton];
  if (kl.frames <= 0 || kl.daten.size() < static_cast<size_t>(kl.frames) * 2) return;   // note without a sound in the Kit
  Stimme* z = nullptr;
  for (Stimme& v : p.sti)
    if (!v.klang) {
      z = &v;
      break;
    }
  if (!z) {   // all voices sound: the oldest ends with the fade while the new note starts
    z = &p.sti[0];
    for (Stimme& v : p.sti)
#ifdef CYPHERDJ_MUTATION_ARR_KIT_RAUB_JUENGSTE
      if (v.nr > z->nr) z = &v;   // error case: the youngest voice is stolen
#else
      if (v.nr < z->nr) z = &v;
#endif
    ausklingen(p, *z);
  }
  z->klang = &kl;
  z->pos = 0;
  z->g = static_cast<float>(e.vel) / 127.0f;
  z->nr = ++p.zaehler;
  ++einsaetze_;
  z->aus = 0;
}

// Adds the voices for the samples [von, bis) of the block to the work buffers.
void ArrKitSenke::mische(Spur& p, int von, int bis) noexcept {
  if (bis <= von) return;
  for (Stimme& v : p.sti) {
    if (!v.klang) continue;
    const float* d = v.klang->daten.data();
    const int64_t n = v.klang->frames;
    int i = von;
    for (; i < bis && v.pos < n; ++i, ++v.pos) {
      puf_l_[i] += d[2 * v.pos] * v.g;
      puf_r_[i] += d[2 * v.pos + 1] * v.g;
    }
    if (v.pos >= n) v.klang = nullptr;
  }
  for (Stimme& v : p.ak) {
    if (!v.klang) continue;
    const float* d = v.klang->daten.data();
    const int64_t n = v.klang->frames;
    int i = von;
    for (; i < bis && v.aus < ARR_KIT_AUSKLANG && v.pos < n; ++i, ++v.pos, ++v.aus) {
      const float g = v.g * static_cast<float>(ARR_KIT_AUSKLANG - v.aus) / static_cast<float>(ARR_KIT_AUSKLANG + 1);
      puf_l_[i] += d[2 * v.pos] * g;
      puf_r_[i] += d[2 * v.pos + 1] * g;
    }
    if (v.aus >= ARR_KIT_AUSKLANG || v.pos >= n) v.klang = nullptr;
  }
}

void ArrKitSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || m <= 0 || m > ARR_BLOCK) return;
  Spur& p = sp_[spur];
  const ArrSnapshot* snap = arr_.snapshot();
  const ArrSpur* q = nullptr;   // the track of the current snapshot when it is a kit track with a Kit
  if (snap) {
    const ArrSpur& x = snap->platz(spur);
    if (x.art == ArrArt::intern && std::strcmp(x.geraet, "kit") == 0 && x.kit_ptr) q = &x;
  }
  const Kit* kit_neu = q ? q->kit_ptr : nullptr;
  const uint64_t gen_neu = q ? q->kit_gen : 0;
  // Change of Kit: another Kit, a reloaded kit.json (new generation), the track left (spur_weg), or it returned within the cycle. The old
  // voices are rendered once more with a linear fade to 0 and dropped. The old Kit stays published (blende) until then.
  if (p.kit && (p.weg || kit_neu != p.kit || gen_neu != p.gen)) {
    p.blende.store(p.kit, std::memory_order_release);
    p.kit = kit_neu;
    p.gen = gen_neu;
    p.aktiv.store(kit_neu, std::memory_order_release);
    std::fill(puf_l_, puf_l_ + m, 0.0f);
    std::fill(puf_r_, puf_r_ + m, 0.0f);
    mische(p, 0, m);
    for (int i = 0; i < m; ++i) {
      const float g = static_cast<float>(m - 1 - i) / static_cast<float>(m);
      l[i] += g * puf_l_[i];
      r[i] += g * puf_r_[i];
    }
    leeren(p);
    p.blende.store(nullptr, std::memory_order_release);
    p.weg = false;
    p.stumm = false;
    if (!kit_neu) {   // the track is gone: nothing pending applies any more
      p.n = 0;
      p.start = -1;
      return;
    }
  } else if (!p.kit && kit_neu) {   // first Kit on this track
    p.kit = kit_neu;
    p.gen = gen_neu;
    p.aktiv.store(kit_neu, std::memory_order_release);
    p.stumm = false;
  }
  p.weg = false;
  if (!p.kit || !q) {   // not a kit track: notes for it (an old queue) are dropped
    p.n = 0;
    return;
  }
  auto rein = [&](int64_t ziel) -> int { return ziel > s0 ? static_cast<int>(std::min<int64_t>(ziel - s0, m)) : 0; };
  auto versatz = [&](int64_t ziel) -> int {
#ifdef CYPHERDJ_MUTATION_ARR_KIT_BLOCKANFANG
    (void)ziel;
    return 0;   // error case: every event at the block start instead of its sample
#else
    return rein(ziel);
#endif
  };
  std::fill(puf_l_, puf_l_ + m, 0.0f);
  std::fill(puf_r_, puf_r_ + m, 0.0f);
  bool start_offen = p.start >= 0 && p.start < s0 + m;
  const int64_t start = p.start;
  int pos = 0;
  // the clear of a transport start sits in the stream of the events at its sample: notes before it are wiped, notes at it and after it play
  auto start_ausfuehren = [&]() {
    const int off = std::max(pos, rein(start));
    mische(p, pos, off);
    pos = off;
#ifndef CYPHERDJ_MUTATION_ARR_KIT_START_OHNE_LEEREN
    leeren(p);   // RB-338 rule A3: the output from the start on does not depend on what played before
#endif
    start_offen = false;
    p.start = -1;
    p.stumm = false;
  };
  for (int i = 0; i < p.n; ++i) {
    const Ev& e = p.ev[i];
    if (start_offen && e.ziel >= start) start_ausfuehren();
    const int off = std::max(pos, versatz(e.ziel));
    mische(p, pos, off);
    pos = off;
    einsatz(p, e);
  }
  p.n = 0;
  if (start_offen) start_ausfuehren();
  mische(p, pos, m);
  // Short fade before a reset: a pending start in the next block (same size as this one) fades this block to 0; the track stays silent
  // until the block of the start (the voices play on, only their output is dropped).
  int blende = 0;   // 0 full, 1 fade in this block, 2 silent
  if (p.start >= s0 + m) {
    if (p.stumm) {
      blende = 2;
    } else if (p.start < s0 + 2 * static_cast<int64_t>(m)) {
      blende = 1;
      p.stumm = true;
    }
  }
  for (int i = 0; i < m; ++i) {
    const float g = blende == 0 ? 1.0f : blende == 1 ? static_cast<float>(m - 1 - i) / static_cast<float>(m) : 0.0f;
    l[i] += g * puf_l_[i];
    r[i] += g * puf_r_[i];
  }
}

}  // namespace cdj
