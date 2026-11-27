// strand 1 task 2.1: a fixed multi-word bit mask for the insert pool (strips with a stage or a tail, slots a strip owns, the lane reports of
// finished tails). (N + 63) / 64 words of uint64_t; with N <= 64 it is one word and compiles to the single uint64_t it replaces.
// Real-time: header-only, no allocation, no lock. There is deliberately no conversion to an integer, so a leftover shift access
// (`(m >> s) & 1u`) does not compile.
#pragma once

#include <cstdint>

#include "cypherdj/arr_playback.h"

namespace cdj {

template <int N>
struct ArrMaske {
  static_assert(N > 0, "a mask holds at least one bit");
  static constexpr int W = (N + 63) / 64;
  uint64_t w[W] = {};

  constexpr void setze(int i) noexcept { w[i >> 6] |= uint64_t{1} << (i & 63); }
  constexpr void loesche(int i) noexcept { w[i >> 6] &= ~(uint64_t{1} << (i & 63)); }
  constexpr bool test(int i) const noexcept { return (w[i >> 6] >> (i & 63)) & 1u; }
  constexpr bool leer() const noexcept {   // all words 0
    uint64_t o = 0;
    for (int k = 0; k < W; ++k) o |= w[k];
    return o == 0;
  }
  constexpr int anzahl() const noexcept {   // set bits over all words
    int n = 0;
    for (int k = 0; k < W; ++k) n += __builtin_popcountll(w[k]);
    return n;
  }
  constexpr void leeren() noexcept {   // all words to 0
    for (int k = 0; k < W; ++k) w[k] = 0;
  }
  constexpr ArrMaske& operator|=(const ArrMaske& o) noexcept {
    for (int k = 0; k < W; ++k) w[k] |= o.w[k];
    return *this;
  }
  constexpr void ohne(const ArrMaske& o) noexcept {   // *this &= ~o
    for (int k = 0; k < W; ++k) w[k] &= ~o.w[k];
  }
  constexpr bool operator==(const ArrMaske& o) const noexcept {
    for (int k = 0; k < W; ++k)
      if (w[k] != o.w[k]) return false;
    return true;
  }
  static constexpr ArrMaske eins(int i) noexcept {   // test seam: a mask with only bit i
    ArrMaske m;
    m.setze(i);
    return m;
  }
  // Calls f(i) for every set bit in ASCENDING i. Each word is copied when the walk reaches it, before the calls for its bits: a callback
  // that clears its own bit (or another bit of the same word) in *this does not disturb the walk. A bit cleared in a LATER word before
  // the walk reaches that word is not visited. The insert slot loops only ever clear the bit they are on.
  template <class F>
  constexpr void je_bit(F&& f) const {
    for (int k = 0; k < W; ++k) {
      uint64_t b = w[k];
      while (b) {
        const int i = k * 64 + __builtin_ctzll(b);
        b &= b - 1;
        f(i);
      }
    }
  }
};

using ArrStreifenMaske = ArrMaske<ARR_KETTEN>;   // one bit per strip (tracks, groups, production master, returns)
using ArrSlotMaske = ArrMaske<ARR_INS_ALLE>;     // one bit per insert pool slot

}  // namespace cdj
