// Container core K3 (index plan F2): the source buffers of the audio callback. Stage 1 of Kern::audio fills them once per sub-block, in this
// order: decks (player), Erzeuger streams, host returns into the streams, the four external inputs. Nothing in here is a mixer strip: the
// containers and the arrangement read these buffers, the mixer reads none of them directly (the interim copy of K3 to K9 in core.cpp aside).
// The Kern owns the memory (one block, allocated in its constructor); Quellpuffer only points into it.
#pragma once

#include <cstddef>
#include <cstring>

#include "cypherdj/generator.h"
#include "cypherdj/mixer.h"

namespace cdj {

constexpr int QP_STROEME = ERZ_STROEME;   // 16 stream buffers, stream s is index s - 1
constexpr int QP_PLAYER = 4, QP_EINGAENGE = 4;
constexpr int QP_PUFFER = 2 * (QP_STROEME + QP_PLAYER + QP_EINGAENGE);   // 48 buffers of MIX_BLOCK frames

struct Quellpuffer {
  float* strom_l[QP_STROEME] = {};
  float* strom_r[QP_STROEME] = {};
  float* player_l[QP_PLAYER] = {};
  float* player_r[QP_PLAYER] = {};
  float* ein_l[QP_EINGAENGE] = {};
  float* ein_r[QP_EINGAENGE] = {};

  // Points the 48 buffers into `speicher` (QP_PUFFER * MIX_BLOCK floats, owned by the caller). Not for the callback.
  void binde(float* speicher) noexcept {
    float* p = speicher;
    auto naechster = [&]() { float* r = p; p += MIX_BLOCK; return r; };
    for (int i = 0; i < QP_STROEME; ++i) { strom_l[i] = naechster(); strom_r[i] = naechster(); }
    for (int i = 0; i < QP_PLAYER; ++i) { player_l[i] = naechster(); player_r[i] = naechster(); }
    for (int i = 0; i < QP_EINGAENGE; ++i) { ein_l[i] = naechster(); ein_r[i] = naechster(); }
  }
  // Zeroes n frames of all 48 buffers at the start of each sub-block (n <= MIX_BLOCK). No allocation.
  void leeren(int n) noexcept {
    if (n < 0) n = 0;
    if (n > MIX_BLOCK) n = MIX_BLOCK;
    const size_t b = sizeof(float) * static_cast<size_t>(n);
    for (int i = 0; i < QP_STROEME; ++i) { std::memset(strom_l[i], 0, b); std::memset(strom_r[i], 0, b); }
    for (int i = 0; i < QP_PLAYER; ++i) { std::memset(player_l[i], 0, b); std::memset(player_r[i], 0, b); }
    for (int i = 0; i < QP_EINGAENGE; ++i) { std::memset(ein_l[i], 0, b); std::memset(ein_r[i], 0, b); }
  }
};

}  // namespace cdj
