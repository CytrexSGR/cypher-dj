// 1.10 slice 4b T13: latency compensation (PDC) of the arrangement mixer (spec 2.4, D9, D10).
//
// Model (worst case, fixed per snapshot). A stage reports a constant latency (komp 0, eq and saett 69 samples at 48 kHz, from cypher_*_latenz(), lim 86 from the KanalLimiter, never hard-coded here).
// A chain adds the sum of its stages, a bypassed stage counts like a running one (D10). The mixer has three sums above the tracks and the arrival times are aligned at
// every sum by delaying the earlier inputs, so each path is delayed exactly once:
//   tracks:   A_i = latency of the chain of track i; all existing tracks are aligned at the output of their chain to T_trk = max A_i (in place, key PDC_SPUR0 + i). The
//             sends of a track are taken from this aligned signal, so a send needs no delay of its own against its own track.
//   groups:   groups nest (a group's output goes to the master or into a parent group), so the arrival is per group. T_trk is the arrival of every track. ein(g) = the arrival of the
//             sum of group g in front of its chain = max(T_trk if a track sits directly in g, aus(c) for every used child c). aus(g) = ein(g) + latency of the chain of g. A group is used when
//             some existing track targets it or a used child does.
//             PDC_GRPEIN0 + g delays the direct-track sum of g in place by ein(g) - T_trk before the children add (children run on lower levels, so they add later).
//             PDC_GRP0 + g delays the output of g to the arrival its target expects: ank(g) = ein(parent) for a parent, T_G for the master, so a child's output arrives at ein(parent) exactly.
//             T_G = max(T_trk, aus(g) over the top-level groups); T_G = T_trk when no group is used.
//   returns:  the sends of tracks (arrival T_trk) and of groups (arrival ank(g), taken after the group's output place) meet at the return input at in_r = T_S = T_G (a top-level group arrives
//             at T_G and every other arrival is earlier). The track part of the sum is delayed by T_S - T_trk (key PDC_RETSPUR0 + r, applied to the sum of the track sends before the groups add
//             theirs), the sends of group g by T_S - ank(g) (key PDC_GRPSEND0 + g, one place per group, not per group and return, at the price that the returns wait for the latest source).
//             A_r = in_r + latency of the return chain.
//   Limits of the send place: one place per group delays the PRE signal of the group (its sum times the mute/solo fade). The send level, the pre/post choice, the fader and balance and the
//             ancestor blend factor are applied after the ring, so automation of those on the sends of a child group under latency runs early by up to the delay of the place; static settings are
//             exact. The tail in the send ring is dropped when a group becomes unused, as for PDC_GRP0 and the chain of the group today.
//   PM:       P_in = max(T_trk, T_G, A_r of the existing returns). The master tracks' sum is delayed by P_in - T_trk (PDC_PM_SPUR), the groups' sum by P_in - T_G
//             (PDC_PM_GRP, only when a group is used), each return's output by P_in - A_r (PDC_PM_RET0 + r). The largest path latency is P_in + latency of the PM chain.
// The sends of a source are not known to the snapshot (they are controls and may be raised at any time), so the model assumes that every track and every used group may
// feed every existing return. The price: a group chain with latency raises the arrival of every track; the model can be more than the longest real path, never less.
// With one level the model is the one before nesting (ein = T_trk). No latency stage anywhere: every delay is 0, no ring is touched and the output is bit-equal to the build before the slice.
//
// ArrPdc holds the rings, owned by the Arrangement (all memory exists after the constructor, nothing allocates in the callback). A ring is a history of `d` samples per
// channel; a place that is not asked in a block loses its history (silence), so a place that comes back starts clean. A change of d (a swap) pads zeros in front or drops
// the oldest samples: the delay changes at the swap and never inside a playback.
#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>

#include "cypherdj/arr_playback.h"
#include "cypherdj/eq.h"
#include "cypherdj/ins_lim.h"
#include "cypherdj/sat.h"

namespace cdj {

constexpr int PDC_SPUR0 = 0;
constexpr int PDC_GRP0 = PDC_SPUR0 + ARR_SPUREN;
constexpr int PDC_RETSPUR0 = PDC_GRP0 + ARR_GRUPPEN;
constexpr int PDC_PM_SPUR = PDC_RETSPUR0 + ARR_RETURNS;
constexpr int PDC_PM_GRP = PDC_PM_SPUR + 1;
constexpr int PDC_PM_RET0 = PDC_PM_GRP + 1;
constexpr int PDC_GRPEIN0 = PDC_PM_RET0 + ARR_RETURNS;     // nested groups: the direct-track sum of group g, delayed in place before its child groups add
constexpr int PDC_GRPSEND0 = PDC_GRPEIN0 + ARR_GRUPPEN;    // nested groups: the sends of group g (one place per group, not per return)
static_assert(PDC_GRPSEND0 + ARR_GRUPPEN == ARR_PDC_SCHLUESSEL, "the key list and the table size must agree");
// longest delay of one place; the loader refuses a playback that needs more (pdc_zu_lang). Plan 1.11 (D5): 1024 -> 8192, so that a host stage of up to ARR_HOST_LAT_MAX - 1 samples fits and every
// other place can still be delayed by it. Memory: ARR_PDC_SCHLUESSEL places x 2 channels x ARR_PDC_RING floats in ArrPdc (3.1 MiB), 32 KiB shift scratch per lane (ArrArbeit), all preallocated.
constexpr int ARR_PDC_RING = 8192;
static_assert(ARR_HOST_LAT_MAX <= ARR_PDC_RING, "the longest host latency must fit one PDC place");
constexpr int PDC_BLENDE = 480;         // plan 1.11: a changed delay (reload with another host latency) crosses over to the new one in this many samples of the block of the change
constexpr int PDC_BLOCK_MAX = 1024;     // longest block ArrPdc::verzoegere() takes (= ARR_BLOCK, arrangement.h; static_assert in arrangement.h)
// Slice 5 U2b (plan E9): the key rings of the compressor slots hold as many samples as one PDC place (T13 defines this constant, the 8192 fallback of the plan is not needed). A key
// delay must be shorter than the ring (d < ARR_SCHL_VERZ_MAX); the loader refuses a structural key that needs more.
constexpr int ARR_SCHL_VERZ_MAX = ARR_PDC_RING;
static_assert((ARR_SCHL_VERZ_MAX & (ARR_SCHL_VERZ_MAX - 1)) == 0, "the key rings are indexed with a mask");

// Latency of one NATIVE stage kind in samples (the core runs at 48 kHz only). Read from the modules once, outside the callback (the first call builds one module of each kind).
// A host stage and a Baukasten stage (graph) have no fixed latency: it is a property of the stage, see ins_latenz(const ArrStufe&) below (this overload returns 0 for it).
inline int ins_latenz(ArrInsArt art) {
  static const int eq = EqNativ().latenz();
  static const int saett = SaettNativ().latenz();
  switch (art) {
    case ArrInsArt::eq: return eq;
    case ArrInsArt::saett: return saett;
    case ArrInsArt::lim: return ins_lim_latenz();   // from a KanalLimiter with the fixed settings of ins_lim.h (86 samples, true-peak mode)
    case ArrInsArt::utility: return 0;              // arr-fx: the Utility module is IIR only, the impulse comes out at sample 0 (dsp/tests/test_utility.cpp, pinned in test_arr_inserts_util)
    default: return 0;
  }
}

// Plan 1.11 (D4): the latency of a stage as a function of the stage. Native kinds: the kind's latency. Host: the value the playback file carries (ArrStufe::latenz, samples).
inline int ins_latenz(const ArrStufe& st) {
#ifdef CYPHERDJ_MUTATION_HOST_LATENZ_NULL
  return ins_latenz(st.art);   // error case: the stage's own value is ignored, a host stage counts as 0 (the click of the host strip arrives late by its latency)
#else
  return st.art == ArrInsArt::host || st.art == ArrInsArt::bk ? static_cast<int>(st.latenz) : ins_latenz(st.art);   // arr-bk: a Baukasten stage carries the latency of its graph, measured by the loader
#endif
}

inline int arr_kette_latenz(const ArrKette& k) {
  int n = 0;
  for (int j = 0; j < k.n && j < ARR_KETTE; ++j) {
#ifdef CYPHERDJ_MUTATION_PDC_NUR_BEI_AN
    if (!k.st[j].an) continue;   // error case: a stage switched off in the project does not count (a bypass shifts the path)
#endif
    n += ins_latenz(k.st[j]);
  }
  return n;
}

// Fills s.pdc from the chains and the routing of the snapshot (see the model above). Returns false when a delay would not fit a ring (the loader refuses the playback).
inline bool arr_pdc_rechnen(ArrSnapshot& s) {
#ifdef CYPHERDJ_MUTATION_PDC_FEHLT_TABELLE
  s.pdc = ArrPdcTabelle{};   // error case: the table stays empty, nothing is compensated (the core and the tests see a project without compensation)
  return true;
#endif
  ArrPdcTabelle t{};
  for (int c = 0; c < ARR_KETTEN; ++c)   // plan 1.11 (D5): the dry ring of a host stage holds ARR_HOST_LAT_MAX - 1 samples; a stage that reports more is refused here (also when no other place would need a delay)
    for (int j = 0; j < s.kette[c].n && j < ARR_KETTE; ++j)
      if (s.kette[c].st[j].art == ArrInsArt::host && s.kette[c].st[j].latenz >= ARR_HOST_LAT_MAX) return false;
  int a_spur[ARR_SPUREN] = {};
  int t_trk = 0;
  bool grp_benutzt[ARR_GRUPPEN] = {};
  for (int i = 0; i < ARR_SPUREN; ++i) {
    if (s.spur[i].nr <= 0) continue;
    a_spur[i] = arr_kette_latenz(s.kette[i]);
    t_trk = std::max(t_trk, a_spur[i]);
    if (s.spur[i].ausgang > 0 && s.spur[i].ausgang <= ARR_GRUPPEN) grp_benutzt[s.spur[i].ausgang - 1] = true;
  }
  for (int pass = 0; pass < ARR_GRUPPEN; ++pass)   // nested groups: a group that holds only child groups is used when a child is (bounded passes)
    for (int g = 0; g < ARR_GRUPPEN; ++g)
      if (grp_benutzt[g] && s.gruppe_ausgang[g] > 0) grp_benutzt[s.gruppe_ausgang[g] - 1] = true;
  // Nested groups, the level-aware model (header comment). ein(g) = what the sum of group g waits for before its chain: the direct tracks (T_trk) and every used child's aus. aus(g) = ein(g) + chain.
  // Computed by relaxation over at most ARR_GRUPPEN + 1 passes (the tree is acyclic, the loader refuses a cycle), so it needs no order and is bounded.
  bool grp_spur[ARR_GRUPPEN] = {};   // the group holds a track directly
  for (int i = 0; i < ARR_SPUREN; ++i)
    if (s.spur[i].nr > 0 && s.spur[i].ausgang > 0 && s.spur[i].ausgang <= ARR_GRUPPEN) grp_spur[s.spur[i].ausgang - 1] = true;
  int ein_g[ARR_GRUPPEN] = {}, aus_g[ARR_GRUPPEN] = {}, ank_g[ARR_GRUPPEN] = {};
  for (int pass = 0; pass <= ARR_GRUPPEN; ++pass) {
    for (int g = 0; g < ARR_GRUPPEN; ++g) {
      if (!grp_benutzt[g]) continue;
      int e = grp_spur[g] ? t_trk : 0;
      for (int c = 0; c < ARR_GRUPPEN; ++c)
        if (grp_benutzt[c] && s.gruppe_ausgang[c] == g + 1) e = std::max(e, aus_g[c]);
      ein_g[g] = e;
      aus_g[g] = e + arr_kette_latenz(s.kette[ARR_SPUREN + g]);
    }
  }
  int t_g = t_trk;   // the master's arrival: the longest top-level group (a top-level group's aus already contains everything below it)
  bool gruppen = false;
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    if (!grp_benutzt[g]) continue;
    gruppen = true;
    if (!(s.gruppe_ausgang[g] > 0 && s.gruppe_ausgang[g] <= ARR_GRUPPEN)) t_g = std::max(t_g, aus_g[g]);
  }
  for (int g = 0; g < ARR_GRUPPEN; ++g)   // the arrival of a group's output (and sends) = what its target expects
    if (grp_benutzt[g]) ank_g[g] = s.gruppe_ausgang[g] > 0 && s.gruppe_ausgang[g] <= ARR_GRUPPEN ? ein_g[s.gruppe_ausgang[g] - 1] : t_g;
  const int in_r = t_g;
  int p_in = t_g;
  int a_ret[ARR_RETURNS] = {};
  for (int r = 0; r < ARR_RETURNS; ++r) {
    if (!s.ret_da[r]) continue;
    a_ret[r] = in_r + arr_kette_latenz(s.kette[ARR_KETTE_RET0 + r]);
    p_in = std::max(p_in, a_ret[r]);
  }
  auto setze = [&](int key, int d) -> bool {
    if (d < 0 || d >= ARR_PDC_RING) return false;
    t.d[key] = static_cast<uint16_t>(d);
    return true;
  };
  bool ok = true;
  for (int i = 0; i < ARR_SPUREN; ++i)
    if (s.spur[i].nr > 0) ok = setze(PDC_SPUR0 + i, t_trk - a_spur[i]) && ok;
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    if (!grp_benutzt[g]) continue;
    ok = setze(PDC_GRP0 + g, ank_g[g] - aus_g[g]) && ok;
    if (grp_spur[g]) ok = setze(PDC_GRPEIN0 + g, ein_g[g] - t_trk) && ok;
    ok = setze(PDC_GRPSEND0 + g, in_r - ank_g[g]) && ok;
    t.ein_g[g] = static_cast<uint16_t>(std::min(ein_g[g], 65535));
    t.ank_g[g] = static_cast<uint16_t>(std::min(ank_g[g], 65535));
  }
  for (int r = 0; r < ARR_RETURNS; ++r) {
    if (!s.ret_da[r]) continue;
    ok = setze(PDC_RETSPUR0 + r, in_r - t_trk) && ok;
    ok = setze(PDC_PM_RET0 + r, p_in - a_ret[r]) && ok;
  }
  ok = setze(PDC_PM_SPUR, p_in - t_trk) && ok;
  if (gruppen) ok = setze(PDC_PM_GRP, p_in - t_g) && ok;
  const int gesamt = p_in + arr_kette_latenz(s.kette[ARR_KETTE_PM]);
  if (gesamt >= ARR_PDC_RING * 4) ok = false;
  t.gesamt = static_cast<uint16_t>(std::min(gesamt, 65535));
  t.t_trk = static_cast<uint16_t>(std::min(t_trk, 65535));   // slice 5 U2b: the arrivals the key alignment (arr_key.h) reads
  t.t_g = static_cast<uint16_t>(std::min(t_g, 65535));
  t.in_r = static_cast<uint16_t>(std::min(in_r, 65535));
  t.p_in = static_cast<uint16_t>(std::min(p_in, 65535));
  for (int k = 0; k < ARR_PDC_SCHLUESSEL; ++k)
    if (t.d[k] > 0) ++t.ringe;
  s.pdc = t;
  return ok;
}

// One delay place per key: a write-index ring (ARR_PDC_RING samples per channel, a power of two) that is fed in EVERY block the place is asked, whatever its delay is (also 0), so that
// the history exists for any delay a later swap asks for (a host stage added or removed on another strip changes this place from 0 to d or back; plan 1.11 review). The output is the
// input read at the delay in force; a change of the delay crosses over from the old tap to the new in PDC_BLENDE samples and the state of the fade spans blocks. A delay of 0 without a
// fade leaves the signal untouched (bit-equal to a project without latency). Cost per block and place: m floats written per channel, m more read while delayed or fading (the old shift
// moved d floats per block, up to 8192 now).
class ArrPdc {
 public:
  ArrPdc() {
    for (int k = 0; k < N; ++k) {
      hl_[k] = speicher_.get() + static_cast<size_t>(2 * k) * ARR_PDC_RING;
      hr_[k] = hl_[k] + ARR_PDC_RING;
      zuletzt_[k] = -10;   // never asked: the first call is a clean start
    }
  }
  ArrPdc(const ArrPdc&) = delete;
  ArrPdc& operator=(const ArrPdc&) = delete;
  // A new block of the mixer begins (also a block that takes the quiet path): the places not asked since the last block lose their history.
  void neuer_block() { ++blk_; }

  // Delays m samples (m <= PDC_BLOCK_MAX) in place by d samples (d in 0..ARR_PDC_RING - 1; 0 only feeds the ring). signal = false: the input is silence that the caller has written (a tail
  // is flushed). The old form uses the member scratch (lane 0). The lane form takes the scratch from the caller (ArrArbeit::pdc_tmp): two keys processed at the same time on different lanes
  // must not share it; after the call it holds the output of the right channel. Per-key state (rings, h_, ha_, fr_, wp_, valid_, rest_, zuletzt_) is not shared.
  void verzoegere(int key, int d, float* l, float* r, int m, bool signal = true) { verzoegere(key, d, l, r, m, tmp_, signal); }
  void verzoegere(int key, int d, float* l, float* r, int m, float* tmp, bool signal = true) {
#ifdef CYPHERDJ_MUTATION_SPUR_PDC_GEMEINSAM
    tmp = tmp_;   // error case: the shift scratch ignores the lane
#endif
    if (m <= 0 || m > PDC_BLOCK_MAX) return;
    d = std::clamp(d, 0, ARR_PDC_RING - 1);
#ifdef CYPHERDJ_MUTATION_PDC_ALLOKATION
    { void* a = std::malloc(8); __asm__ volatile("" : : "r"(a) : "memory"); std::free(a); }   // error case: the callback allocates (test_arr_pdc case 9 must see it)
#endif
#ifdef CYPHERDJ_MUTATION_PDC_BLOCK_NEU
    valid_[key] = 0;   // error case: the history is dropped at every block
#endif
    if (zuletzt_[key] + 1 != blk_) {   // not asked in the block before: a clean start (no history, no fade, the delay is the asked one)
      valid_[key] = 0;
      h_[key] = d;
      fr_[key] = 0;
    }
    zuletzt_[key] = blk_;
    if (d != h_[key]) {   // the delay in force differs from the asked one (a reload with another host latency, a stage added or removed): cross over from the old tap to the new
      ha_[key] = h_[key];   // a change inside a running fade restarts from the old target (one small step at most; a second change inside 480 samples does not happen in practice)
      h_[key] = d;
#ifdef CYPHERDJ_MUTATION_HOST_PDC_OHNE_BLENDE
      fr_[key] = 0;   // error case: the change is not faded, the new tap starts at once
#else
      fr_[key] = PDC_BLENDE;
#endif
    }
    const int fr0 = fr_[key];
    const int valid0 = valid_[key];
    const uint32_t wp0 = wp_[key];
    const bool rechnen = d > 0 || fr0 > 0;
    kanal(hl_[key], l, m, d, ha_[key], fr0, valid0, wp0, tmp, rechnen);
    kanal(hr_[key], r, m, d, ha_[key], fr0, valid0, wp0, tmp, rechnen);
    fr_[key] = std::max(0, fr0 - m);
    wp_[key] = wp0 + static_cast<uint32_t>(m);
    valid_[key] = std::min(valid0 + m, ARR_PDC_RING);
    rest_[key] = signal ? d : std::max(0, rest_[key] - m);
  }
  // true when the place still holds signal that has not come out (a tail after the input stopped)
  bool schwanz(int key, int d) const { return d > 0 && zuletzt_[key] + 1 == blk_ && rest_[key] > 0; }
  // true when the place changes its delay in this block or still fades from the last change (the caller then routes the sum through verzoegere() as the output); only for a place asked in the block before
  bool kreuzt(int key, int d) const { return zuletzt_[key] + 1 == blk_ && (fr_[key] > 0 || h_[key] != std::clamp(d, 0, ARR_PDC_RING - 1)); }
  int historie(int key) const { return h_[key]; }   // test seam: the delay in force (0: none; the ring is fed anyway)

 private:
  static constexpr int N = ARR_PDC_SCHLUESSEL;
  static constexpr uint32_t MASKE = static_cast<uint32_t>(ARR_PDC_RING - 1);
  static_assert((ARR_PDC_RING & (ARR_PDC_RING - 1)) == 0, "the rings are indexed with a mask");

  // One channel: the output (into tmp, then into x) reads the ring for samples before this block and x for samples of it; only then the ring takes the input block. A tap v at block
  // sample t is the input sample t - v: in the ring when t - v < 0 and it is not older than the valid history, else 0. y[t] = A + g (B - A) while the fade runs (A the old delay ha,
  // B the new d, g rising 1/PDC_BLENDE .. 1 over the fr0 samples left), then B.
  static void kanal(float* ring, float* x, int m, int d, int ha, int fr0, int valid, uint32_t wp0, float* tmp, bool rechnen) {
    if (rechnen) {
      const auto abgriff = [&](int v, int t) -> float {
        const int q = t - v;
        if (q >= 0) return x[q];
        return q >= -valid ? ring[(wp0 + static_cast<uint32_t>(q)) & MASKE] : 0.0f;
      };
      for (int t = 0; t < m; ++t) {
        const float neu = abgriff(d, t);
        if (t < fr0) {
          const float g = static_cast<float>(PDC_BLENDE - fr0 + t + 1) / static_cast<float>(PDC_BLENDE);
          const float alt = abgriff(ha, t);
          tmp[t] = g >= 1.0f ? neu : alt + g * (neu - alt);
        } else {
          tmp[t] = neu;
        }
      }
    }
    const uint32_t i0 = wp0 & MASKE;
    const int erste = std::min(m, ARR_PDC_RING - static_cast<int>(i0));
    std::memcpy(ring + i0, x, sizeof(float) * static_cast<size_t>(erste));
    if (erste < m) std::memcpy(ring, x + erste, sizeof(float) * static_cast<size_t>(m - erste));
    if (rechnen) std::memcpy(x, tmp, sizeof(float) * static_cast<size_t>(m));
  }

  // The histories are 2 x N x ARR_PDC_RING floats (3.1 MiB at 8192): preallocated once in the constructor on the heap, never in the callback. As members of the object they overflowed
  // the stack of every test (and of any caller) that holds an Arrangement by value; the per-place pointers keep the indexing as it was.
  std::unique_ptr<float[]> speicher_ = std::make_unique<float[]>(static_cast<size_t>(2) * N * ARR_PDC_RING);   // value-initialised: zeros
  float* hl_[N] = {};
  float* hr_[N] = {};
  float tmp_[ARR_PDC_RING] = {};
  int h_[N] = {};       // the delay in force
  int ha_[N] = {};      // the old delay while a fade runs
  int fr_[N] = {};      // samples of the fade left
  int valid_[N] = {};   // samples of history in the ring (up to ARR_PDC_RING)
  uint32_t wp_[N] = {};
  int rest_[N] = {};
  int64_t zuletzt_[N] = {};
  int64_t blk_ = 1;
};

}  // namespace cdj
