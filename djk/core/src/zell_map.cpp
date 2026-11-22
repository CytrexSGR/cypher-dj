// Session view S1b, K1: the source read map of a launcher cell. Rules: contract/zell_karte_referenz.json (plan index 2.3, fix round 1).
#include "cypherdj/zell_map.h"

#include <cmath>

#include "cypherdj/arrangement.h"  // ARR_NAHT

static_assert(cdj::ZELL_SLOT_MIN == 2 * cdj::ARR_NAHT, "ZELL_SLOT_MIN is twice the seam fade");

namespace cdj {

namespace {

constexpr double STILLE = -1.0;
constexpr double GLEICH = 1e-6;  // two source frames count as the same frame (slot starts come from a linear beats to frames conversion)

// Source frame of played position pos read through played slot `slot` (n > 0) or the identity (n == 0), before reverse.
// stille_am_ende: STILLE past the end of the source slot (the current read); otherwise the read just keeps going (the old read of a seam).
inline double quelle(const ZellKarte& k, int slot, double pos, bool stille_am_ende) noexcept {
  if (k.n <= 0) return pos;
  const int s = k.s[slot];
  if (s < 0 || s >= k.n) return STILLE;  // table entry out of range: silence, g is never read outside [0, n]
  const double q = k.g[s] + (pos - k.g[slot]);
  if (stille_am_ende && q >= k.g[s + 1]) {
    // Tolerance GLEICH: a played position 1-2 ulp below its own slot end can round to q at the source slot end. That is the last frame of the source
    // slot, not silence (a one-sample dropout at full level); it is clamped to just below the end so the read stays in [0, frames). A source slot
    // that runs out early (q at its end while the played slot goes on) stays silent.
    if (k.g[slot + 1] - pos < GLEICH && q < k.g[s + 1] + GLEICH) return std::nextafter(k.g[s + 1], 0.0);
    return STILLE;
  }
  return q;
}

inline double wende(const ZellKarte& k, double q) noexcept {
  if (!(q >= 0.0 && q < static_cast<double>(k.frames))) return STILLE;
  if (!k.rueck) return q;
  // Contract: the result is in [0, frames) or exactly STILLE. A reversed fractional q in (frames-1, frames) gives (-1, 0): it wraps to
  // +frames for a loop cell (the reader interpolates between the last and the first sample) and clamps to 0 for a one-shot.
  const double v = static_cast<double>(k.frames) - 1.0 - q;
  return v >= 0.0 ? v : k.kreis ? v + static_cast<double>(k.frames) : 0.0;
}

// The old read of a seam: keeps reading the source past its slot end; past the source end it wraps (kreis) or is silence (one-shot).
// Exception: when its played slot is longer than its source slot and the read has already run out of the source slot, the output was
// silent, so the old read is silent too (no jump from 0 to the real continuation).
inline double alt(const ZellKarte& k, int slot, double pos) noexcept {
  if (k.n > 0 && k.s[slot] < k.n) {
    const double laenge = k.g[slot + 1] - k.g[slot], quelle_laenge = k.g[k.s[slot] + 1] - k.g[k.s[slot]];
    if (laenge > quelle_laenge + GLEICH && pos - k.g[slot] >= quelle_laenge) return STILLE;
  }
  double q = quelle(k, slot, pos, false);
  if (q >= static_cast<double>(k.frames)) q = k.kreis ? std::fmod(q, static_cast<double>(k.frames)) : STILLE;
  return wende(k, q);
}

// Continuity by value; for a loop cell the comparison is cyclic (frames - 1 and 0 are neighbours).
inline bool gleich(const ZellKarte& k, double x, double y) noexcept {
  if (!(x >= 0.0 && y >= 0.0)) return false;
  double d = std::fabs(x - y);
  if (k.kreis) d = std::fmin(d, static_cast<double>(k.frames) - d);
  return d < GLEICH;
}

}  // namespace

float zell_einblende(double i) noexcept { return i <= 0.0 ? 0.0f : i >= ARR_NAHT ? 1.0f : static_cast<float>(i / ARR_NAHT); }

ZellLesung zell_lesen(const ZellKarte& k, double f) noexcept {
  ZellLesung r{STILLE, STILLE, 0.0f};
  // One compare also catches NaN. n > 64 is invalid and reads silence (the loader refuses such a table anyway).
  if (!(f >= 0.0 && f < static_cast<double>(k.frames)) || k.n < 0 || k.n > ZELL_SCHEIBEN_MAX) return r;
  const double naht = static_cast<double>(ARR_NAHT);
  const double ende = static_cast<double>(k.frames);
  int slot = 0;
  while (slot + 1 < k.n && k.g[slot + 1] <= f) ++slot;
  const double q = quelle(k, slot, f, true);
  r.a = wende(k, q);

  // Slots shorter than ZELL_SLOT_MIN are refused by the K2 loader (zellen_ungueltig); the map itself stays defined for them.
  // Slot seam: crossfade over ARR_NAHT unless the audio is continuous by value (the old read's next frame is the new read's first frame).
  // A slot shorter than ARR_NAHT: this fade ends at the next seam, which takes over (the test below only looks at the current slot).
  if (slot >= 1 && f - k.g[slot] < naht) {
    const double gk = k.g[slot];
    if (!gleich(k, alt(k, slot - 1, gk), wende(k, quelle(k, slot, gk, true)))) {
      r.b = alt(k, slot - 1, f);
      r.wb = static_cast<float>(1.0 - (f - gk) / naht);
      return r;
    }
  } else if (slot == 0 && k.kreis && !k.blende && f < naht) {
    // Loop seam of a loop cell: the last slot (or the identity) keeps reading past the loop end, same test and fade as a slot seam.
    const int letzt = k.n > 0 ? k.n - 1 : 0;
    if (!gleich(k, alt(k, letzt, ende), wende(k, quelle(k, 0, 0.0, true)))) {
      r.b = alt(k, letzt, f + ende);
      r.wb = static_cast<float>(1.0 - f / naht);
      return r;
    }
  }
  // The current read runs out of its source slot before its played slot ends (unequal slots): it fades out over the last ARR_NAHT frames of
  // the source slot, then reads silence. No fade when both end together (then the next seam decides). The OLD read of a seam tail never fades.
  if (k.n > 0 && q >= 0.0) {
    const double e = k.g[k.s[slot] + 1];
    if (q >= e - naht && f + (e - q) < k.g[slot + 1] - GLEICH) r.wb = static_cast<float>((q - (e - naht)) / naht);
  }
  // blende = clip fade: a dip instead of a crossfade at the loop seam (b stays silence, the first read weighs 1 - wb). Fade-in and
  // fade-out terms overlap when frames < 2 * ARR_NAHT: the larger one counts.
  if (k.blende) {
    float w = r.wb;
    if (f < naht) w = std::fmax(w, 1.0f - zell_einblende(f));
    if (f >= ende - naht) w = std::fmax(w, static_cast<float>((f - (ende - naht)) / naht));
    r.wb = w;
  }
  return r;
}

}  // namespace cdj
