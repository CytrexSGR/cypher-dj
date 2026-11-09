// 1.8 Slice 3 (R10, D11, D14): monitoring of the external inputs in the Arrangement. The core hands the input pair of every armed track with an external
// source to monitor_quelle() before block(). monitor_planen() (in block(), after freeze_abgriff) decides per track whether it sounds; mischen() then adds the source
// with monitor_spur_addieren() AFTER the insert chain and the PDC delay of the track and before its fader loop (1.8 T1, slice 3b-lite): the monitor is dry and does not wait for
// the longest path, while fader, pan, mute and solo of the track still take effect (AK16). The recording (the tap in Aufnahme::block, before this) is untouched.
// Real time: no allocation, no lock.
#include <algorithm>

#include "cypherdj/arrangement.h"

namespace cdj {

// The transport plays and a clip of the track covers the project beat of the last sample of the block. The state at the end of the block is the one the segments
// left behind (origin, status), so a block that crosses a seam or a stop is judged by its end. The clips are sorted by start_beat: the scan stops at the first
// clip that starts behind the beat (overlapping clips are still found).
bool Arrangement::spur_klingt(int i, const Karte& k, int64_t s0, int m) const {
  if (status_ != ArrStatus::spielt || !snap_) return false;
  const ArrSpur& sp = snap_->spur[i];
  const double beat = projekt_beat(k, static_cast<double>(s0 + m - 1));
  for (int c = 0; c < sp.n_clips; ++c) {
    const ArrClip& cl = sp.clips[c];
    if (cl.start_beat > beat) break;
    if (beat < cl.start_beat + cl.laenge_beats) return true;
  }
  return false;
}

void Arrangement::monitor_planen(const Karte& k, int64_t s0, int m) {
#ifdef CYPHERDJ_MUTATION_MONITOR_ALLOC
  {   // mutation (S3.4, positive control of the allocation guard): one allocation per block
    volatile char* v = new char[1];
    v[0] = 1;
    delete[] v;
  }
#endif
  for (int i = 0; i < ARR_SPUREN; ++i) {
    MonQuelle& q = mon_[i];
    q.klingt = false;
    if (!q.l && !q.r) continue;                       // no port: silence, nothing to add
    if (q.monitor == 0) continue;                     // aus: never
#ifdef CYPHERDJ_MUTATION_MONITOR_AUTO_IST_EIN
    // mutation (AK15): auto behaves like ein, the input also sounds while a clip of the track plays back
#else
    if (q.monitor == 1 && !q.aufnahme && spur_klingt(i, k, s0, m)) continue;   // auto: not while a clip plays back, unless a take records
#endif
    q.klingt = true;
  }
}

void Arrangement::monitor_spur_addieren(int i, int m, float* bl, float* br) const {
  const MonQuelle& q = mon_[i];
  const float* l = q.l;
  const float* r = q.r;
  switch (q.modus) {
    case 1:   // links: L to both
      if (!l) break;
      for (int t = 0; t < m; ++t) { bl[t] += l[t]; br[t] += l[t]; }
      break;
    case 2:   // rechts: R to both
      if (!r) break;
      for (int t = 0; t < m; ++t) { bl[t] += r[t]; br[t] += r[t]; }
      break;
    case 3:   // summe: 0.5 * (L + R) to both (a missing channel counts as silence)
      for (int t = 0; t < m; ++t) {
        const float v = ((l ? l[t] : 0.0f) + (r ? r[t] : 0.0f)) * 0.5f;
        bl[t] += v;
        br[t] += v;
      }
      break;
    default:  // stereo: L to L, R to R
      if (l) for (int t = 0; t < m; ++t) bl[t] += l[t];
      if (r) for (int t = 0; t < m; ++t) br[t] += r[t];
      break;
  }
}

}  // namespace cdj
