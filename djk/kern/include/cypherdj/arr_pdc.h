// 1.10 slice 4b T13: latency compensation (PDC) of the arrangement mixer (spec 2.4, D9, D10).
//
// Model (worst case, fixed per snapshot). A stage reports a constant latency (komp 0, eq and saett 69 samples at 48 kHz, from cypher_*_latenz(), lim 74 from the KanalLimiter, never hard-coded here).
// A chain adds the sum of its stages, a bypassed stage counts like a running one (D10). The mixer has three sums above the tracks and the arrival times are aligned at
// every sum by delaying the earlier inputs, so each path is delayed exactly once:
//   tracks:   A_i = latency of the chain of track i; all existing tracks are aligned at the output of their chain to T_trk = max A_i (in place, key PDC_SPUR0 + i). The
//             sends of a track are taken from this aligned signal, so a send needs no delay of its own against its own track.
//   groups:   A_g = T_trk + latency of the group chain (a group is used when some existing track targets it); aligned in place to T_G = max A_g (key PDC_GRP0 + g).
//             T_G = T_trk when no group is used.
//   returns:  the sends of tracks (arrival T_trk) and of groups (arrival T_G) meet at the return input at in_r = T_G. The track part of the sum is delayed by T_G - T_trk
//             (key PDC_RETSPUR0 + r, applied to the sum of the track sends before the groups add theirs). A_r = in_r + latency of the return chain.
//   PM:       P_in = max(T_trk, T_G, A_r of the existing returns). The master tracks' sum is delayed by P_in - T_trk (PDC_PM_SPUR), the groups' sum by P_in - T_G
//             (PDC_PM_GRP, only when a group is used), each return's output by P_in - A_r (PDC_PM_RET0 + r). The largest path latency is P_in + latency of the PM chain.
// The sends of a source are not known to the snapshot (they are controls and may be raised at any time), so the model assumes that every track and every used group may
// feed every existing return. The price: a group chain with latency raises the arrival of every track; the model can be more than the longest real path, never less.
// No latency stage anywhere: every delay is 0, no ring is touched and the output is bit-equal to the build before the slice.
//
// ArrPdc holds the rings, owned by the Arrangement (all memory exists after the constructor, nothing allocates in the callback). A ring is a history of `d` samples per
// channel; a place that is not asked in a block loses its history (silence), so a place that comes back starts clean. A change of d (a swap) pads zeros in front or drops
// the oldest samples: the delay changes at the swap and never inside a playback.
#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <stdexcept>

#include "cypherdj/arr_wiedergabe.h"
#include "cypherdj/eq.h"
#include "cypherdj/ins_lim.h"
#include "cypherdj/saett.h"

namespace cdj {

constexpr int PDC_SPUR0 = 0;
constexpr int PDC_GRP0 = PDC_SPUR0 + ARR_SPUREN;
constexpr int PDC_RETSPUR0 = PDC_GRP0 + ARR_GRUPPEN;
constexpr int PDC_PM_SPUR = PDC_RETSPUR0 + ARR_RETURNS;
constexpr int PDC_PM_GRP = PDC_PM_SPUR + 1;
constexpr int PDC_PM_RET0 = PDC_PM_GRP + 1;
static_assert(PDC_PM_RET0 + ARR_RETURNS == ARR_PDC_SCHLUESSEL, "the key list and the table size must agree");
constexpr int ARR_PDC_RING = 1024;   // longest delay of one place; the loader refuses a playback that needs more (pdc_zu_lang)
// Slice 5 U2b (plan E9): the key rings of the compressor slots hold as many samples as one PDC place (T13 defines this constant, the 8192 fallback of the plan is not needed). A key
// delay must be shorter than the ring (d < ARR_SCHL_VERZ_MAX); the loader refuses a structural key that needs more.
constexpr int ARR_SCHL_VERZ_MAX = ARR_PDC_RING;
static_assert((ARR_SCHL_VERZ_MAX & (ARR_SCHL_VERZ_MAX - 1)) == 0, "the key rings are indexed with a mask");

// Latency of one stage kind in samples (the core runs at 48 kHz only). Read from the modules once, outside the callback (the first call builds one module of each kind).
inline int ins_latenz(ArrInsArt art) {
  static const int eq = EqNativ().latenz();
  static const int saett = SaettNativ().latenz();
  switch (art) {
    case ArrInsArt::eq: return eq;
    case ArrInsArt::saett: return saett;
    case ArrInsArt::lim: return ins_lim_latenz();   // from a KanalLimiter with the fixed settings of ins_lim.h (74 samples)
    default: return 0;
  }
}

inline int arr_kette_latenz(const ArrKette& k) {
  int n = 0;
  for (int j = 0; j < k.n && j < ARR_KETTE; ++j) {
#ifdef CYPHERDJ_MUTATION_PDC_NUR_BEI_AN
    if (!k.st[j].an) continue;   // error case: a stage switched off in the project does not count (a bypass shifts the path)
#endif
    n += ins_latenz(k.st[j].art);
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
  int a_spur[ARR_SPUREN] = {};
  int t_trk = 0;
  bool grp_benutzt[ARR_GRUPPEN] = {};
  for (int i = 0; i < ARR_SPUREN; ++i) {
    if (s.spur[i].nr <= 0) continue;
    a_spur[i] = arr_kette_latenz(s.kette[i]);
    t_trk = std::max(t_trk, a_spur[i]);
    if (s.spur[i].ausgang > 0 && s.spur[i].ausgang <= ARR_GRUPPEN) grp_benutzt[s.spur[i].ausgang - 1] = true;
  }
  int a_grp[ARR_GRUPPEN] = {};
  int t_g = t_trk;
  bool gruppen = false;
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    if (!grp_benutzt[g]) continue;
    gruppen = true;
    a_grp[g] = t_trk + arr_kette_latenz(s.kette[ARR_SPUREN + g]);
    t_g = std::max(t_g, a_grp[g]);
  }
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
  for (int g = 0; g < ARR_GRUPPEN; ++g)
    if (grp_benutzt[g]) ok = setze(PDC_GRP0 + g, t_g - a_grp[g]) && ok;
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
  t.t_trk = static_cast<uint16_t>(std::min(t_trk, 65535));   // slice 5 U2b: the arrivals the key alignment (arr_schluessel.h) reads
  t.t_g = static_cast<uint16_t>(std::min(t_g, 65535));
  t.in_r = static_cast<uint16_t>(std::min(in_r, 65535));
  t.p_in = static_cast<uint16_t>(std::min(p_in, 65535));
  for (int k = 0; k < ARR_PDC_SCHLUESSEL; ++k)
    if (t.d[k] > 0) ++t.ringe;
  s.pdc = t;
  return ok;
}

class ArrPdc {
 public:
  // A new block of the mixer begins (also a block that takes the quiet path): the places not asked since the last block lose their history.
  void neuer_block() { ++blk_; }

  // Delays m samples in place by d samples (d in 1..ARR_PDC_RING - 1). signal = false: the input is silence that the caller has written (a tail is flushed).
  void verzoegere(int key, int d, float* l, float* r, int m, bool signal = true) {
    if (d <= 0 || m <= 0) return;
    if (d >= ARR_PDC_RING) d = ARR_PDC_RING - 1;
#ifdef CYPHERDJ_MUTATION_PDC_ALLOKATION
    { void* a = std::malloc(8); __asm__ volatile("" : : "r"(a) : "memory"); std::free(a); }   // error case: the callback allocates (test_arr_pdc case 9 must see it)
#endif
#ifdef CYPHERDJ_MUTATION_PDC_BLOCK_NEU
    h_[key] = 0;   // error case: the history is dropped at every block
#endif
    if (zuletzt_[key] + 1 != blk_) h_[key] = 0;   // not asked in the block before: a clean start
    zuletzt_[key] = blk_;
    anpassen(key, d);
    rest_[key] = signal ? d : std::max(0, rest_[key] - m);
    schiebe(hl_[key], l, d, m);
    schiebe(hr_[key], r, d, m);
  }
  // true when the place still holds signal that has not come out (a tail after the input stopped)
  bool schwanz(int key, int d) const { return d > 0 && zuletzt_[key] + 1 == blk_ && rest_[key] > 0; }
  int historie(int key) const { return h_[key]; }   // test seam

 private:
  static constexpr int N = ARR_PDC_SCHLUESSEL;

  // the history of the place has h samples (the delay in force); bring it to d: zeros in front when longer, the oldest dropped when shorter
  void anpassen(int key, int d) {
    int& h = h_[key];
    if (h == d) return;
    if (h == 0) {
      std::memset(hl_[key], 0, sizeof(float) * static_cast<size_t>(d));
      std::memset(hr_[key], 0, sizeof(float) * static_cast<size_t>(d));
    } else if (d > h) {
      std::memmove(hl_[key] + (d - h), hl_[key], sizeof(float) * static_cast<size_t>(h));
      std::memmove(hr_[key] + (d - h), hr_[key], sizeof(float) * static_cast<size_t>(h));
      std::memset(hl_[key], 0, sizeof(float) * static_cast<size_t>(d - h));
      std::memset(hr_[key], 0, sizeof(float) * static_cast<size_t>(d - h));
    } else {
      std::memmove(hl_[key], hl_[key] + (h - d), sizeof(float) * static_cast<size_t>(d));
      std::memmove(hr_[key], hr_[key] + (h - d), sizeof(float) * static_cast<size_t>(d));
    }
    h = d;
  }
  // out[t] = in[t - d]: the first d samples come from the history, the history becomes the last d samples of the input
  void schiebe(float* hist, float* x, int d, int m) {
    if (m >= d) {
      std::memcpy(tmp_, x + (m - d), sizeof(float) * static_cast<size_t>(d));
      std::memmove(x + d, x, sizeof(float) * static_cast<size_t>(m - d));
      std::memcpy(x, hist, sizeof(float) * static_cast<size_t>(d));
      std::memcpy(hist, tmp_, sizeof(float) * static_cast<size_t>(d));
    } else {
      std::memcpy(tmp_, x, sizeof(float) * static_cast<size_t>(m));
      std::memcpy(x, hist, sizeof(float) * static_cast<size_t>(m));
      std::memmove(hist, hist + m, sizeof(float) * static_cast<size_t>(d - m));
      std::memcpy(hist + (d - m), tmp_, sizeof(float) * static_cast<size_t>(m));
    }
  }

  float hl_[N][ARR_PDC_RING] = {};
  float hr_[N][ARR_PDC_RING] = {};
  float tmp_[ARR_PDC_RING] = {};
  int h_[N] = {};
  int rest_[N] = {};
  int64_t zuletzt_[N] = {};
  int64_t blk_ = 1;
};

}  // namespace cdj
