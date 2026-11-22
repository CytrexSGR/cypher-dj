// Session view S1b, K1: the source read map of a launcher cell (slice order, reverse, seam fades). Pure, no state, real-time safe.
// The rules are written once in contract/zell_karte_referenz.json (core test, page server twin).
#pragma once

#include <cstdint>

namespace cdj {

constexpr int ZELL_SCHEIBEN_MAX = 64, ZELL_HUELLEN_MAX = 4, ZELL_PUNKTE_MAX = 64;
// Minimum length in frames of a played slot and of a source slot (2 * ARR_NAHT, asserted in zell_map.cpp). Shorter slots would overlap the
// crossfade of their neighbour and jump; the K2 loader refuses them with zellen_ungueltig. The map itself stays defined for shorter slots.
constexpr int ZELL_SLOT_MIN = 192;

struct ZellKarte {                  // a voice owns a copy; trivially copyable
  int n = 0;                        // slots, 0 = identity
  double g[ZELL_SCHEIBEN_MAX + 1];  // slot starts in source frames, g[n] = frames
  uint8_t s[ZELL_SCHEIBEN_MAX];     // source slot of played slot k
  bool rueck = false, blende = false;
  bool kreis = false;               // loop cell: reads past the source end wrap (lies_kreis convention); one-shot (einmal): silence
  int64_t frames = 0;
};

// The frame to read for played frame f (0 <= f < frames) and, inside ARR_NAHT after a discontinuous seam, the second read and its weight
// (the old read; with blende the loop seam is a dip: b stays silent, only wb moves). The first read weighs 1 - wb.
// Contract: a and b are each in [0, frames) or exactly -1.0 (silence). A reversed fractional frame in (frames-1, frames) wraps to +frames
// for kreis (the reader interpolates last to first sample) and clamps to 0 for one-shots.
struct ZellLesung { double a; double b; float wb; };  // wb 0: only a; a or b < 0: silence for that read
ZellLesung zell_lesen(const ZellKarte& k, double f) noexcept;

// Fade-in weight of the read i frames after a hard onset (launch): 0 at i <= 0, i / ARR_NAHT, 1 from ARR_NAHT on. The voice (K3) applies it at
// launch; the map itself cannot know the launch. Same shape as the blende fade-in after the loop seam (wb = 1 - zell_einblende(f)).
float zell_einblende(double i) noexcept;

}  // namespace cdj
