// Baukasten S20: a Baukasten graph as the sink of the internal project tracks (arr_bk_senke.h). Order per block: take over a new
// instance (fading out the old one), knobs, transport start (reset, all notes off), the collected events with offsets from the block
// start, then the FFI block under the denormal guard, short fade, rest rule.
#include "cypherdj/arr_bk_senke.h"

#include <cstring>

#include <cypherdj/dsp/denormal.h>

namespace cdj {

namespace {

// k1..k8 of the playback (absent = 0.5, the default of an untouched knob)
float knopf_wert(const ArrSpur& q, int k) {
  const char name[3] = {'k', static_cast<char>('0' + k), 0};
  for (int i = 0; i < q.n_param; ++i)
    if (std::strncmp(q.param[i].name, name, sizeof q.param[i].name) == 0) return q.param[i].wert;
  return 0.5f;
}

}  // namespace

int ArrBkSenke::ruhend() const {
  int n = 0;
  for (const Spur& p : sp_) n += p.h_last && p.ruht ? 1 : 0;
  return n;
}

int ArrBkSenke::spielend() const {
  int n = 0;
  for (const Spur& p : sp_) n += p.h_last ? 1 : 0;
  return n;
}

bool ArrBkSenke::nutzt(const CypherBk* h) const noexcept {
  if (!h) return false;
  for (const Spur& p : sp_)   // aktiv first, blende second: the sink publishes blende before it overwrites aktiv and clears it last
    if (p.aktiv.load(std::memory_order_acquire) == h || p.blende.load(std::memory_order_acquire) == h) return true;
  return false;
}

void ArrBkSenke::schiebe(Spur& p, const Ev& e) noexcept {
  if (p.n >= ARR_BK_WARTE) {   // more than the FFI takes until the next block: counted, not reported
    ++verloren_;
    return;
  }
  p.ev[p.n++] = e;
}

void ArrBkSenke::note(int spur, int64_t ziel, uint8_t ton, uint8_t vel, bool an) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  schiebe(sp_[spur], Ev{ziel, static_cast<uint8_t>(an ? 0 : 1), ton, vel});
}

void ArrBkSenke::alle_aus(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  schiebe(sp_[spur], Ev{ziel, 2, 0, 0});
}

void ArrBkSenke::transport_start(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  sp_[spur].start = ziel;   // acts in the block that holds ziel
}

bool ArrBkSenke::spur_weg(int spur, int64_t, bool) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || !sp_[spur].h_last) return false;
  sp_[spur].weg = true;   // acts in the next block() of this track: fade out, reset, release
  return true;
}

void ArrBkSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || m <= 0 || m > ARR_BLOCK) return;
  Spur& p = sp_[spur];
  const ArrSnapshot* snap = arr_.snapshot();
  const ArrSpur* q = nullptr;   // the track of the current snapshot when it is a bk track with an instance
  if (snap) {
    const ArrSpur& x = snap->platz(spur);
    if (x.art == ArrArt::intern && std::strcmp(x.geraet, "bk") == 0 && x.bk) q = &x;
  }
  CypherBk* h_neu = q ? q->bk : nullptr;
  const uint64_t gen_neu = q ? q->bk_gen : 0;
  // Change of instance: another graph, a changed graph file, the track left (spur_weg), or it returned within the cycle (weg and the
  // snapshot holds a bk track again). The old instance is rendered once more with a linear fade to 0, then reset (a later take-over of
  // the same instance, e.g. after an undo, starts clean). It stays published (blende) until then so the loader does not free it.
  if (p.h_last && (p.weg || h_neu != p.h_last || gen_neu != p.gen_last)) {
    CypherBk* alt = p.h_last;
    p.blende.store(alt, std::memory_order_release);
    p.h_last = h_neu;
    p.gen_last = gen_neu;
#ifndef CYPHERDJ_MUTATION_ARR_BK_OHNE_AKTIV
    p.aktiv.store(h_neu, std::memory_order_release);
#endif
    {
      cypherdj::dsp::DenormalSchutz schutz;
      cypher_bk_block(alt, puf_l_, puf_r_, static_cast<size_t>(m));
    }
    for (int i = 0; i < m; ++i) {
#ifdef CYPHERDJ_MUTATION_ARR_BK_WECHSEL_HART
      const float g = 0.0f;   // error case: the old tail ends with a step at the start of the block
#else
      const float g = static_cast<float>(m - 1 - i) / static_cast<float>(m);
#endif
      l[i] += g * puf_l_[i];
      r[i] += g * puf_r_[i];
    }
    cypher_bk_zuruecksetzen(alt);
    p.blende.store(nullptr, std::memory_order_release);
    p.weg = false;
    p.stumm = false;
    p.ruht = false;
    p.still = 0;
    p.neu = h_neu != nullptr;
    if (!h_neu) {   // the track is gone: nothing pending applies any more
      p.n = 0;
      p.start = -1;
      return;
    }
  } else if (!p.h_last && h_neu) {   // first instance on this track
    p.h_last = h_neu;
    p.gen_last = gen_neu;
#ifndef CYPHERDJ_MUTATION_ARR_BK_OHNE_AKTIV
    p.aktiv.store(h_neu, std::memory_order_release);
#endif
    p.neu = true;
    p.ruht = false;
    p.still = 0;
    p.stumm = false;
  }
  p.weg = false;
  if (!p.h_last || !q) {   // not a bk track: notes for it (an old queue) are dropped
    p.n = 0;
    return;
  }
  CypherBk* h = p.h_last;
  auto versatz = [&](int64_t ziel) -> uint32_t {
#ifdef CYPHERDJ_MUTATION_ARR_BK_VERSATZ_NULL
    (void)ziel;
    return 0;   // error case: every event at the block start instead of its sample
#else
    return ziel > s0 ? static_cast<uint32_t>(ziel - s0) : 0u;
#endif
  };
  const bool start_hier = p.start >= 0 && p.start < s0 + m;
  // Knobs k1..k8 in every block (also while the transport stands). At a take-over and at a transport start they jump to their values,
  // otherwise the instance smooths over 20 ms.
  const bool sofort = p.neu || start_hier;
  for (int k = 1; k <= 8; ++k) {
#ifdef CYPHERDJ_MUTATION_ARR_BK_REGLER_NUR_START
    if (!sofort) continue;   // error case: knobs only at the start, a knob edited during playback never arrives
#endif
    const float w = knopf_wert(*q, k);
    if (sofort)
      cypher_bk_regler_sofort(h, static_cast<uint32_t>(k), w);
    else
      cypher_bk_regler(h, static_cast<uint32_t>(k), w);
  }
  p.neu = false;
  cypher_bk_takt(h, beat0_, bps_);
  if (start_hier) {
#ifndef CYPHERDJ_MUTATION_ARR_BK_OHNE_ZURUECKSETZEN
    cypher_bk_zuruecksetzen(h);   // phases, envelopes, delay lines: the output from the start on does not depend on what played before
#endif
    if (cypher_bk_alle_aus(h, versatz(p.start)) != 0) ++verloren_;
    p.start = -1;
    p.ruht = false;
    p.stumm = false;
    p.still = 0;
  }
  bool ereignis = p.n > 0;
  for (int i = 0; i < p.n; ++i) {
    const Ev& e = p.ev[i];
    int32_t rc = 0;
    if (e.art == 0)
      rc = cypher_bk_note_an(h, versatz(e.ziel), e.ton, static_cast<float>(e.vel) / 127.0f);
    else if (e.art == 1)
      rc = cypher_bk_note_aus(h, versatz(e.ziel), e.ton);
    else
      rc = cypher_bk_alle_aus(h, versatz(e.ziel));
    if (rc != 0) ++verloren_;
  }
  p.n = 0;
  if (ereignis) {
    p.ruht = false;
    p.still = 0;
  }
  if (p.ruht) return;   // at rest: reset after 1 s of silence, nothing is computed until a note or a start
  {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_bk_block(h, puf_l_, puf_r_, static_cast<size_t>(m));
  }
  // Short fade before a reset: a pending start in the next block (same size as this one) fades this block to 0; the track stays silent
  // until the block of the start (the instance computes on, only its output is dropped).
  int blende = 0;   // 0 full, 1 fade in this block, 2 silent
  if (p.start >= s0 + m) {
    if (p.stumm) {
      blende = 2;
    } else if (p.start < s0 + 2 * static_cast<int64_t>(m)) {
      blende = 1;
      p.stumm = true;
    }
  }
  bool null = true;
  for (int i = 0; i < m; ++i) {
    const float g = blende == 0 ? 1.0f : blende == 1 ? static_cast<float>(m - 1 - i) / static_cast<float>(m) : 0.0f;
    l[i] += g * puf_l_[i];
    r[i] += g * puf_r_[i];
    null = null && puf_l_[i] == 0.0f && puf_r_[i] == 0.0f;
  }
  p.still = null ? p.still + m : 0;
  if (p.still >= ARR_BK_RUHE && arr_.status() == ArrStatus::steht && p.start < 0) {
    cypher_bk_zuruecksetzen(h);
    p.ruht = true;
    p.still = 0;
  }
}

}  // namespace cdj
