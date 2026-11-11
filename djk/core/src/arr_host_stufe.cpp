// Plan 1.11 T4: the effect-host stage, see arr_host_stufe.h.
#include "cypherdj/arr_host_stufe.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cdj {

ArrHostStufe::ArrHostStufe() = default;

void ArrHostStufe::leere(int h) noexcept {
  if (h >= 1 && h <= ARR_INS_HOST) h_[h - 1].pos = 0;
}

void ArrHostStufe::trocken_leere(int h, int latenz) noexcept {
  if (h < 1 || h > ARR_INS_HOST) return;
  Wirt& w = h_[h - 1];
  if (latenz >= 0) w.lat = std::clamp(latenz, 0, ARR_HOST_LAT_MAX - 1);
#ifndef CYPHERDJ_MUTATION_HOST_OHNE_EIN_AUSBLENDUNG   // error case: no entry blend, the entering stage plays its empty dry ring (a gap of latenz samples)
  w.c = 0;           // entry: the strip plays the undelayed input until the stage's own output has history
  w.vor = w.lat;
#endif
  std::memset(w.ring_l, 0, sizeof w.ring_l);
  std::memset(w.ring_r, 0, sizeof w.ring_r);
  w.w = 0;
}

uint64_t ArrHostStufe::wachter_zaehler() const noexcept {
  uint64_t n = 0;
  for (const Wirt& w : h_) n += w.wachter.load(std::memory_order_relaxed);
  return n;
}

void ArrHostStufe::block(int h, const float* ein_l, const float* ein_r, float* aus_l, float* aus_r, int m, int latenz, bool an, bool gesund,
                         float* trocken_l, float* trocken_r, bool drin) noexcept {
  if (h < 1 || h > ARR_INS_HOST || m <= 0) return;
  Wirt& w = h_[h - 1];
  constexpr int MASKE = ARR_HOST_LAT_MAX - 1;
  const int n = std::clamp(latenz, 0, ARR_HOST_LAT_MAX - 1);
  const bool rueck_da = w.rueck_l && w.rueck_r;
  w.lat = n;
#ifdef CYPHERDJ_MUTATION_HOST_OHNE_EIN_AUSBLENDUNG
  const int cz = HOST_BLENDE;   // error case: no exit blend either, a removed stage jumps from its delayed output to the undelayed input
#else
  const int cz = drin ? HOST_BLENDE : 0;
#endif
  int c = w.c, vor = w.vor;
#ifdef CYPHERDJ_MUTATION_HOST_RING_KURZ
  const int lese_n = n > 0 ? n - 1 : 0;   // error case: the dry ring is one sample short, the bypass delays by latenz - 1
#else
  const int lese_n = n;
#endif
  const bool misst = w.messung.load(std::memory_order_acquire);
  int ruhe = w.ruhe;
  if (w.fehl.exchange(false, std::memory_order_acq_rel)) ruhe = 0;   // an outage since the last block, however short
#ifdef CYPHERDJ_MUTATION_HOST_STILLSTAND_REGEL
  int still_n = w.still_n;   // error case: a stall rule, 2048 samples of exact zeros on the return switch the stage to dry
#endif
  int pos = w.pos;
  int wp = w.w;
  uint64_t wach = 0;
  for (int t = 0; t < m; ++t) {
    const float xl = ein_l[t], xr = ein_r[t];
    w.ring_l[wp] = xl;
    w.ring_r[wp] = xr;
    const int rp = (wp - lese_n) & MASKE;
    const float dl = w.ring_l[rp], dr = w.ring_r[rp];
    wp = (wp + 1) & MASKE;
    if (w.aus_l) w.aus_l[t] = xl;
    if (w.aus_r) w.aus_r[t] = xr;
    if (trocken_l) {
      trocken_l[t] = dl;
      trocken_r[t] = dr;
    }
    if (gesund) {   // D6: the return fades in only after HOST_GESUND_HALTE healthy samples
      if (ruhe < HOST_GESUND_HALTE) ++ruhe;
    } else {
      ruhe = 0;
    }
#ifdef CYPHERDJ_MUTATION_HOST_STILLSTAND_REGEL
    if (w.rueck_l && w.rueck_l[t] == 0.0f && w.rueck_r[t] == 0.0f) ++still_n;
    else still_n = 0;
    const bool still = still_n >= 8 * 256;
#else
    const bool still = false;   // D7: NO stall rule. T1 measured that exact zeros do not separate a dead host from a legitimately silent plugin; only the health flag switches
#endif
    const int ziel = an && gesund && rueck_da && ruhe >= HOST_GESUND_HALTE && !misst && !still ? HOST_BLENDE : 0;
#ifdef CYPHERDJ_MUTATION_HOST_OHNE_BLENDE
    pos = ziel;   // error case: no fade, the weight jumps
#else
    if (pos < ziel) ++pos;
    else if (pos > ziel) --pos;
#endif
    float yl, yr;   // the stage output before the entry/exit blend
    if (pos == 0 && ziel == 0) {   // the dry path: the return is not even read (a dead host's buffer may hold anything)
      yl = dl;
      yr = dr;
    } else {
    float rl = rueck_da ? w.rueck_l[t] : 0.0f, rr = rueck_da ? w.rueck_r[t] : 0.0f;
#ifndef CYPHERDJ_MUTATION_HOST_OHNE_WAECHTER   // error case: the return reaches the strip as it is (a NaN poisons the sum, a huge sample the master)
    bool tat = false;
    if (!std::isfinite(rl)) { rl = 0.0f; tat = true; }
    else if (rl > HOST_RUECK_MAX || rl < -HOST_RUECK_MAX) { rl = std::clamp(rl, -HOST_RUECK_MAX, HOST_RUECK_MAX); tat = true; }
    if (!std::isfinite(rr)) { rr = 0.0f; tat = true; }
    else if (rr > HOST_RUECK_MAX || rr < -HOST_RUECK_MAX) { rr = std::clamp(rr, -HOST_RUECK_MAX, HOST_RUECK_MAX); tat = true; }
    if (tat) ++wach;
#endif
    if (pos >= HOST_BLENDE) {
      yl = rl;
      yr = rr;
    } else {
      const float g = static_cast<float>(pos) * (1.0f / static_cast<float>(HOST_BLENDE));
#ifdef CYPHERDJ_MUTATION_HOST_TROCKEN_UNVERZOEGERT
      yl = xl + g * (rl - xl);   // error case: the fade runs against the UNdelayed dry signal, the strip jumps by latenz samples when it ends on the delayed one
      yr = xr + g * (rr - xr);
#else
      yl = dl + g * (rl - dl);
      yr = dr + g * (rr - dr);
#endif
    }
    }
    if (vor > 0) --vor;
    else if (c < cz) ++c;
    else if (c > cz) --c;
    if (c >= HOST_BLENDE) {
      aus_l[t] = yl;
      aus_r[t] = yr;
    } else {
      const float g = static_cast<float>(c) * (1.0f / static_cast<float>(HOST_BLENDE));
      aus_l[t] = xl + g * (yl - xl);
      aus_r[t] = xr + g * (yr - xr);
    }
  }
  w.c = c;
  w.vor = vor;
  w.pos = pos;
  w.ruhe = ruhe;
#ifdef CYPHERDJ_MUTATION_HOST_STILLSTAND_REGEL
  w.still_n = still_n;
#endif
  w.w = wp;
  if (wach) w.wachter.fetch_add(wach, std::memory_order_relaxed);
}

}  // namespace cdj
