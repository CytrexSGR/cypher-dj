// Baukasten S20: a Baukasten graph as the sink of the internal project tracks (arr_bk_sink.h). Order per block: take over a new
// instance (fading out the old one), knobs, transport start (reset, all notes off), the collected events with offsets from the block
// start, then the FFI block under the denormal guard, short fade, rest rule.
#include "cypherdj/arr_bk_sink.h"

#include <algorithm>
#include <cstring>

#include <cypherdj/dsp/denormal.h>

namespace cdj {

namespace {

// k1..k64 of the playback. A knob the playback does not name starts at the graph's own default position (`vorgabe`: the array of the
// slot, read when the instance was taken over; 0.5 for a graph without one): a playback written before the 32- or 64-knob widening names
// fewer knobs, and the knobs it leaves out must sound as the graph starts, not at 0.5.
float knopf_wert(const ArrSpur& q, int k, const float* vorgabe) {
  char name[4] = {'k', 0, 0, 0};
  if (k >= 10) { name[1] = static_cast<char>('0' + k / 10); name[2] = static_cast<char>('0' + k % 10); }
  else name[1] = static_cast<char>('0' + k);
  for (int i = 0; i < q.n_param; ++i)
    if (std::strncmp(q.param[i].name, name, sizeof q.param[i].name) == 0) return q.param[i].wert;
  return vorgabe[k - 1];
}

}  // namespace

void ArrBkSenke::lade_vorgaben(Spur& p, const CypherBk* h) noexcept {
  for (int k = 1; k <= BK_KNOEPFE; ++k) {
    const float v = cypher_bk_regler_vorgabe(const_cast<CypherBk*>(h), static_cast<uint32_t>(k));
    p.knopf_vorgabe[k - 1] = v >= 0.0f && v <= 1.0f ? v : 0.5f;   // -1: the engine knows no such knob (a library older than the widening)
  }
}

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
  return zweiter_ && zweiter_->nutzt(h);
}

void ArrBkSenke::schiebe(Spur& p, const Ev& e) noexcept {
  if (p.n >= ARR_BK_WARTE) {   // more than the FFI takes until the next block: counted, not reported
    verloren_.fetch_add(1, std::memory_order_relaxed);
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

void ArrBkSenke::stift(int spur, int satz, int zeile, int spalte, float wert, uint64_t gen) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || satz < 0 || satz > 1 || zeile < 0 || zeile > 15 || spalte < 0 || spalte > 15 || !(wert == wert)) return;
  Spur& p = sp_[spur];
  const int i = satz * BK_STIFTE_SATZ + zeile * 16 + spalte;   // dense: the last write of a position wins, nothing can overflow
  p.stift_wert[i] = wert;
  p.stift_gen[i] = gen;
  p.stift_offen[i >> 6] |= uint64_t{1} << (i & 63);
}

void ArrBkSenke::transport_start(int spur, int64_t ziel) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  sp_[spur].start = ziel;   // acts in the block that holds ziel
}

void ArrBkSenke::transport_abbruch(int spur) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return;
  sp_[spur].start = -1;      // the abandoned entry never comes: no reset, no all-off, no fade before it
  sp_[spur].stumm = false;   // a fade that already ran for it ends (the track sounds again from the next block)
}

bool ArrBkSenke::spur_weg(int spur, int64_t, bool) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || !sp_[spur].h_last) return false;
  sp_[spur].weg = true;   // acts in the next block() of this track: fade out, reset, release
  return true;
}

void ArrBkSenke::auto_parameter(int spur, int param, float wert) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || param < 0 || param >= BK_KNOEPFE || !(wert == wert)) return;
  Spur& p = sp_[spur];
  p.knopf_wert[param] = wert < 0.0f ? 0.0f : (wert > 1.0f ? 1.0f : wert);
  p.knopf_da[param] = true;
}

void ArrBkSenke::auto_parameter_summand(int spur, int param, float delta) noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_BK_OHNE_SUMMAND
  (void)spur; (void)param; (void)delta;   // error case: the sink drops the summand of a relative lane
  return;
#endif
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || param < 0 || param >= BK_KNOEPFE || !(delta == delta)) return;
  Spur& p = sp_[spur];
  p.knopf_delta[param] = delta;
  p.delta_da[param] = true;
}

void ArrBkSenke::note_regler(int spur, int64_t ziel, int param, float wert, bool relativ) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || param < 0 || param >= BK_KNOEPFE || !(wert == wert)) return;
  Spur& p = sp_[spur];
  if (p.n_rev >= ARR_BK_WARTE) {   // its own queue is full: this value is lost, the note is not
    verloren_.fetch_add(1, std::memory_order_relaxed);
    return;
  }
  p.rev[p.n_rev++] = Rev{ziel, wert, static_cast<uint8_t>(param), relativ};
}

void ArrBkSenke::fx(int spur, int64_t ziel, bool pegel, float wert, int64_t gleit_samples) noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || !(wert == wert)) return;
  Spur& p = sp_[spur];
  if (p.n_fev >= ARR_BK_WARTE) {   // its own queue is full: this event is lost (counted), notes are not touched
    verloren_.fetch_add(1, std::memory_order_relaxed);
    return;
  }
  const int64_t g = gleit_samples < 0 ? 0 : (gleit_samples > 0xffffffffll ? 0xffffffffll : gleit_samples);
  p.fev[p.n_fev++] = Fev{ziel, wert, static_cast<uint32_t>(g), pegel};
}

void ArrBkSenke::block(int spur, int64_t s0, int m, float* l, float* r) noexcept { block_bahn(spur, s0, m, l, r, arbeit0_); }

// What the plan builder reads is the published instance (aktiv, blende: acquire) and the plain fields weg and gen_last. The plain fields are written only by block_bahn() and spur_weg()
// of this very track, which run before the join of the previous block or on the caller itself: the join (or the caller's own order) is what orders them before this read, as for every
// other state of the sinks the plan builder looks at (ArrRbSenke::parallel_faehig reads sp_[spur].h the same way). A lock is not needed.
bool ArrBkSenke::parallel_faehig(int spur) const noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return false;
  const Spur& p = sp_[spur];
  const CypherBk* in_use = p.aktiv.load(std::memory_order_acquire);
  if (!in_use) return false;   // no instance taken over yet (its first block runs in the remainder), or the track has none
  const ArrSnapshot* snap = arr_.snapshot();
  if (!snap) return false;
  const ArrSpur& x = snap->platz(spur);
  if (x.art != ArrArt::intern || std::strcmp(x.geraet, "bk") != 0 || !x.bk) return false;
#ifndef CYPHERDJ_MUTATION_BK_BAHN_IM_TAUSCH
  if (p.blende.load(std::memory_order_acquire)) return false;   // a fade is in flight (never seen between blocks, but the answer must not depend on it)
  if (p.weg || x.bk != in_use || x.bk_gen != p.gen_last) return false;   // a change of instance is due in the next block: it runs in the serial remainder
#endif   // error case: the sink says yes during a swap, the plan puts the swap block on a lane
  return true;
}

bool ArrBkSenke::leer(int spur) const noexcept {
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE) return true;
  const Spur& p = sp_[spur];
  if (!p.aktiv.load(std::memory_order_acquire)) return true;
  return p.ruht && p.n == 0 && p.start < 0;
}

void ArrBkSenke::block_bahn(int spur, int64_t s0, int m, float* l, float* r, ArrArbeit& a) noexcept {
  float* const puf_l = a.bk_l;
  float* const puf_r = a.bk_r;
  ++a.einheiten;
  if (spur < 0 || spur >= ARR_SENKEN_PLAETZE || m <= 0 || m > ARR_BLOCK) return;
  Spur& p = sp_[spur];
  float k_gemeldet[BK_KNOEPFE], k_delta[BK_KNOEPFE];   // the knobs and summands reported for this block (auto_parameter, auto_parameter_summand): taken and cleared at once, so a block that returns early leaves nothing for a later one
  bool k_da[BK_KNOEPFE], d_da[BK_KNOEPFE];
  for (int i = 0; i < BK_KNOEPFE; ++i) {
    k_gemeldet[i] = p.knopf_wert[i];
    k_da[i] = p.knopf_da[i];
    p.knopf_da[i] = false;
    k_delta[i] = p.knopf_delta[i];
    d_da[i] = p.delta_da[i];
    p.delta_da[i] = false;
  }
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
    if (h_neu) lade_vorgaben(p, h_neu);
#ifndef CYPHERDJ_MUTATION_ARR_BK_OHNE_AKTIV
    p.aktiv.store(h_neu, std::memory_order_release);
#endif
    {
      cypherdj::dsp::DenormalSchutz schutz;
      cypher_bk_block(alt, puf_l, puf_r, static_cast<size_t>(m));
    }
    for (int i = 0; i < m; ++i) {
#ifdef CYPHERDJ_MUTATION_ARR_BK_WECHSEL_HART
      const float g = 0.0f;   // error case: the old tail ends with a step at the start of the block
#else
      const float g = static_cast<float>(m - 1 - i) / static_cast<float>(m);
#endif
      l[i] += g * puf_l[i];
      r[i] += g * puf_r[i];
    }
    cypher_bk_zuruecksetzen(alt);
    p.blende.store(nullptr, std::memory_order_release);
    p.weg = false;
    p.stumm = false;
    p.ruht = false;
    p.still = 0;
    p.neu = h_neu != nullptr;
    if (!h_neu) {   // the track is gone: nothing pending applies any more
      std::memset(p.stift_offen, 0, sizeof p.stift_offen);
      p.n = 0;
      p.n_rev = 0;
      p.n_fev = 0;
      p.start = -1;
      return;
    }
  } else if (!p.h_last && h_neu) {   // first instance on this track
    p.h_last = h_neu;
    p.gen_last = gen_neu;
    lade_vorgaben(p, h_neu);
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
    std::memset(p.stift_offen, 0, sizeof p.stift_offen);
    p.n = 0;
    p.n_rev = 0;
    p.n_fev = 0;
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
  // Knobs k1..k64 in every block (also while the transport stands). At a take-over and at a transport start they jump to their values,
  // otherwise the instance smooths over 20 ms.
  const bool sofort = p.neu || start_hier;
  // Pin matrix (kraken patch field), before the knobs and so before cypher_bk_block: first the pins of the snapshot, then the live pins that are still pending. A graph without a matrix skips all of it.
  {
    const bool hat_matrix = cypher_bk_hat_matrix(h) != 0;
    if (p.neu || snap->folge != p.stift_folge) {   // a take-over or another snapshot (its serial differs): the snapshot's pins replace what the slot holds, a live pin before it is gone
      if (hat_matrix) {
        const int32_t s_sofort = sofort ? 1 : 0;
        cypher_bk_stifte_grund(h, q->stifte_da ? 0u : 1u, static_cast<uint32_t>(s_sofort));   // no pins of its own: the graph's own; else everything 0 and the listed pins
        if (q->stifte_da) {
          const int64_t von = q->stift_von < 0 ? 0 : q->stift_von;
          const int64_t bis = std::min<int64_t>(von + (q->stift_n < 0 ? 0 : q->stift_n), static_cast<int64_t>(snap->stifte.size()));
          for (int64_t i = von; i < bis; ++i) {
            const ArrStift& e = snap->stifte[static_cast<size_t>(i)];
            if (sofort)
              cypher_bk_stift_sofort(h, e.satz, e.zeile, e.spalte, e.wert);
            else
              cypher_bk_stift(h, e.satz, e.zeile, e.spalte, e.wert);
          }
        }
      }
      p.stift_folge = snap->folge;
    }
    // Live pins: bounded (8 mask words, at most 512 pins). One stamped before the swap to the snapshot in force is dropped: that snapshot was built from a project that already held it or undid it.
    const uint64_t gen_jetzt = arr_.snapshot_generation();
    for (int w = 0; w < 2 * BK_STIFTE_SATZ / 64; ++w) {
      uint64_t bits = p.stift_offen[w];
      p.stift_offen[w] = 0;
      while (hat_matrix && bits) {
        const int i = w * 64 + __builtin_ctzll(bits);
        bits &= bits - 1;
        if (p.stift_gen[i] < gen_jetzt) continue;   // stamped before the swap to the snapshot in force: dropped
        const uint32_t satz = static_cast<uint32_t>(i / BK_STIFTE_SATZ), zeile = static_cast<uint32_t>((i % BK_STIFTE_SATZ) / 16), spalte = static_cast<uint32_t>(i % 16);
        if (sofort)
          cypher_bk_stift_sofort(h, satz, zeile, spalte, p.stift_wert[i]);
        else
          cypher_bk_stift(h, satz, zeile, spalte, p.stift_wert[i]);
      }
    }
  }
  for (int k = 1; k <= BK_KNOEPFE; ++k) {
#ifdef CYPHERDJ_MUTATION_ARR_BK_REGLER_NUR_START
    if (!sofort) continue;   // error case: knobs only at the start, a knob edited during playback never arrives
#endif
    float w = k_da[k - 1] ? k_gemeldet[k - 1] : knopf_wert(*q, k, p.knopf_vorgabe);   // a value reported for this block wins over the snapshot
    if (!k_da[k - 1] && d_da[k - 1]) {   // a relative lane only: the snapshot's knob plus the summand
      w += k_delta[k - 1];
      w = w < 0.0f ? 0.0f : (w > 1.0f ? 1.0f : w);
    }
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
    if (cypher_bk_alle_aus(h, versatz(p.start)) != 0) verloren_.fetch_add(1, std::memory_order_relaxed);
    p.start = -1;
    p.ruht = false;
    p.stumm = false;
    p.still = 0;
  }
  bool ereignis = p.n > 0 || p.n_fev > 0;
  for (int i = 0; i < p.n; ++i) {
    const Ev& e = p.ev[i];
    int32_t rc = 0;
    if (e.art == 0)
      rc = cypher_bk_note_an(h, versatz(e.ziel), e.ton, static_cast<float>(e.vel) / 127.0f);
    else if (e.art == 1)
      rc = cypher_bk_note_aus(h, versatz(e.ziel), e.ton);
    else
      rc = cypher_bk_alle_aus(h, versatz(e.ziel));
    if (rc != 0) verloren_.fetch_add(1, std::memory_order_relaxed);
  }
  p.n = 0;
  // tracker task 16: bend and pegel events after the notes (the FFI queue is shared: a surplus costs these, never notes), before the knob values. At one sample the instance orders them after
  // all-off and note-off and before note-on whatever the order here.
  for (int i = 0; i < p.n_fev; ++i) {
    const Fev& e = p.fev[i];
    const int32_t rc = e.pegel ? cypher_bk_pegel_bei(h, versatz(e.ziel), e.wert, e.gleit) : cypher_bk_bend_bei(h, versatz(e.ziel), e.wert, e.gleit);
    if (rc != 0) verloren_.fetch_add(1, std::memory_order_relaxed);
  }
  p.n_fev = 0;
  // sampler A2: the per-note knob values go in AFTER every note of the block, so the FFI queue (256 events together) is full of notes first and a surplus costs knob values, never notes.
  // At one sample the instance puts the value before the note-on whatever the order of the reports. -2: the instance of the block has no latched knob there (a swap between the report and
  // this block): nothing to say. -1: queue full, counted.
  for (int i = 0; i < p.n_rev; ++i) {
    const Rev& e = p.rev[i];
    const int k = e.param + 1;
    float w = e.wert;
    if (e.relativ) {   // a relative lane only: the same rule as the knob loop above
      if (k_da[k - 1]) {   // a value reported for this block (the live override spur/<slot>/bk/<k>) wins and the summand drops
        w = k_gemeldet[k - 1];
      } else {   // the snapshot's knob plus the summand
        w += knopf_wert(*q, k, p.knopf_vorgabe);
        w = w < 0.0f ? 0.0f : (w > 1.0f ? 1.0f : w);
      }
    }
    if (cypher_bk_regler_bei(h, versatz(e.ziel), static_cast<uint32_t>(k), w) == -1) verloren_.fetch_add(1, std::memory_order_relaxed);
  }
  p.n_rev = 0;
  if (ereignis) {
    p.ruht = false;
    p.still = 0;
  }
  if (p.ruht) return;   // at rest: reset after 1 s of silence, nothing is computed until a note or a start
  {
    cypherdj::dsp::DenormalSchutz schutz;
    cypher_bk_block(h, puf_l, puf_r, static_cast<size_t>(m));
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
    l[i] += g * puf_l[i];
    r[i] += g * puf_r[i];
    null = null && puf_l[i] == 0.0f && puf_r[i] == 0.0f;
  }
  p.still = null ? p.still + m : 0;
  if (p.still >= ARR_BK_RUHE && arr_.status() == ArrStatus::steht && p.start < 0) {
    cypher_bk_zuruecksetzen(h);
    p.ruht = true;
    p.still = 0;
  }
}

}  // namespace cdj
