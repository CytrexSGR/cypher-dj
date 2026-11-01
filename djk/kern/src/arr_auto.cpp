// Automation (ADR 032): the lanes of a track, evaluated per sample in the core. Slice 1 played the fader lane; slice 2 task 3 plays the fields 0..3
// (fader, pan, mute, solo) the same way, one buffer auto_buf_[track][field] each (E7); device lanes (ziel geraet) are not played in the mixer: auto_geraet hands their value to the sink once per block (E9). Three jobs:
//  - auto_segment: while the transport plays and the snapshot carries a lane, the exact project beat of every sample of a sub-block goes
//    into ap_ (Karte::beat_at per sample, D3: not linear between segment borders, so a tempo ramp stays right);
//  - auto_block: before mischen(), for every track and field with a lane (or a running blend) the course of the whole block goes into
//    auto_buf_[track][field] and Wert::vl points there; samples outside the playing range carry the source value (stellwerk course or base value);
//  - the blend (D6, E8): when the fader or pan changes its source between lane and base value (stop, lane gone, snapshot swap) it runs 480 samples
//    linearly from the last played value to the new target: in the GAIN for the fader, in the pan VALUE for pan; start and loop seam take the hard lane
//    value. Mute and solo have no blend of their own: the 0/1 values go through the mixer fade (ARR_STUMM_BLENDE, 480 samples).
// The base value in Wert::w stays true: verlaeufe_nachfuehren never writes a lane value into it (D5a). mischen() only checks pan for a change per sample.
// No allocation, no locks. The logarithm runs only in the at most 480 blend samples per source change, never in steady operation.
#include <algorithm>
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace {
constexpr int64_t KEIN = INT64_MIN;
constexpr float AUTO_HALT_DB = 0.03f;   // largest drift of the held value against the exact lane value (AK4 tolerance is 0.05 dB)
constexpr float AUTO_HALT_PAN = 0.002f;   // the same for pan, in pan units (d gain / d pan <= pi/4, so at most 0.0016 in the gain)
inline float db_lin_(float db) { return db <= -120.0f ? 0.0f : std::pow(10.0f, db / 20.0f); }   // as mischen(): below -120 dB the gain is 0
inline float lin_db_(float g) { return 20.0f * std::log10(std::max(g, 1e-10f)); }                // clamps at -200 dB
// The target constants are the field numbers of the mixer (Wert fields 0..3); feld_lane and the buffers rely on it.
static_assert(ARR_AUTO_FADER == 0 && ARR_AUTO_PAN == 1 && ARR_AUTO_MUTE == 2 && ARR_AUTO_SOLO == 3, "lane target = mixer field");
// The lane of a track for field 0..3 (fader, pan, mute, solo), or nullptr. Never by position: a pan lane may sit before the fader lane.
const ArrAutoLane* feld_lane(const ArrSpur& sp, int feld) {
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_LANE_NULL   // error case: lane 0 by position is taken as the fader lane (a pan lane in front plays as gain)
  if (feld == ARR_AUTO_FADER) return sp.n_auto > 0 ? sp.auto_lanes : nullptr;
#endif
  for (int k = 0; k < sp.n_auto; ++k)
    if (sp.auto_lanes[k].ziel == feld) return &sp.auto_lanes[k];   // ARR_AUTO_FADER..SOLO = field 0..3
  return nullptr;
}
// The `geraet` lane of a track for the device parameter 0..3 (ARR_GERAET_PARAM_NAME), or nullptr.
const ArrAutoLane* geraet_lane(const ArrSpur& sp, int param) {
  for (int k = 0; k < sp.n_auto; ++k)
    if (sp.auto_lanes[k].ziel == ARR_AUTO_GERAET && sp.auto_lanes[k].param == param) return &sp.auto_lanes[k];
  return nullptr;
}
}  // namespace

void Arrangement::auto_segment(const Karte& k, int64_t a, int64_t b, int64_t s0) {
  if (!snap_ || snap_->n_auto_lanes == 0 || b <= a) return;
  const int von = static_cast<int>(a - s0), bis = static_cast<int>(b - s0);
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_BEAT_LINEAR
  {   // error case: the project beat is linear between the two ends of the sub-block (wrong inside a tempo ramp)
    const double pa = projekt_beat(k, static_cast<double>(s0 + von)), pb = projekt_beat(k, static_cast<double>(s0 + bis));
    for (int t = von; t < bis; ++t) ap_[t] = pa + (pb - pa) * static_cast<double>(t - von) / static_cast<double>(bis - von);
  }
#else
  for (int t = von; t < bis; ++t) ap_[t] = projekt_beat(k, static_cast<double>(s0 + t));
#endif
  if (auto_bis_ > auto_von_ && von == auto_bis_) {
    auto_bis_ = bis;   // the next sub-block of the same run (seam, or the block was split)
  } else {
    auto_von_ = von;
    auto_bis_ = bis;
  }
}

void Arrangement::auto_tausch(const ArrSnapshot* neu, int64_t s) {
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int f = 0; f < AUTO_FELDER; ++f) {
      const bool alt_lane = snap_ && feld_lane(snap_->spur[i], f);
      const ArrAutoLane* nl = neu ? feld_lane(neu->spur[i], f) : nullptr;
      const bool neu_lane = nl != nullptr;
      if (neu_lane) {
        const ArrAutoLane& l = *nl;
        auto_l_[i][f] = AutoLane(l.p, l.n);
        auto_l_[i][f].neu_suchen(0.0);
      } else {
        auto_l_[i][f] = AutoLane();
      }
      if (f < AUTO_BLENDE_FELDER && status_ == ArrStatus::spielt && (alt_lane || neu_lane)) blende_s_[i][f] = s;   // the new source may differ: AK23, lane gone, lane new
    }
  for (int i = 0; i < ARR_SPUREN; ++i)   // device lanes: only the cursor, the sink sees the lane value per block and handles a change itself
    for (int g = 0; g < ARR_GERAET_PARAMS; ++g) {
      const ArrAutoLane* gl = neu ? geraet_lane(neu->spur[i], g) : nullptr;
      auto_g_[i][g] = gl ? AutoLane(gl->p, gl->n) : AutoLane();
    }
}

// E9: per block and device lane ONE value, the lane at the project beat of the last running sample of the block (ap_ is filled only for
// [auto_von_, auto_bis_)). Without a running sample (transport stands, waits) there is no call; the sink treats a missing call as "lane gone".
void Arrangement::auto_geraet() {
  if (!snap_ || snap_->n_auto_lanes == 0 || auto_bis_ <= auto_von_) return;
#ifdef CYPHERDJ_MUTATION_ARR_GERAET_ERSTES_SAMPLE
  const double p = ap_[auto_von_];   // error case: the value at the FIRST running sample of the block
#else
  const double p = ap_[auto_bis_ - 1];
#endif
  for (int i = 0; i < ARR_SPUREN; ++i) {
    const ArrSpur& sp = snap_->spur[i];
    if (sp.n_auto == 0) continue;
    ArrSenke* se = senke_fuer(snap_, i);
    if (!se) continue;
    for (int g = 0; g < ARR_GERAET_PARAMS; ++g) {
      if (!geraet_lane(sp, g)) continue;
      AutoLane& al = auto_g_[i][g];
      al.neu_suchen(p);   // once per block: a start in the middle, a loop seam or a swap needs no special case
      se->auto_parameter(i, g, al.wert_bei(p));
    }
  }
}

void Arrangement::auto_stopp(int64_t s) {
  if (!snap_) return;
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int f = 0; f < AUTO_BLENDE_FELDER; ++f)
      if (feld_lane(snap_->spur[i], f)) blende_s_[i][f] = s;
}

void Arrangement::auto_beginn() {
  for (int i = 0; i < ARR_SPUREN; ++i)   // a start takes the hard lane value (AK6), no blend from an earlier stop
    for (int f = 0; f < AUTO_FELDER; ++f) {
      blende_n_[i][f] = 0;
      blende_s_[i][f] = KEIN;
    }
}

void Arrangement::auto_block(int64_t s0, int m) {
  const bool laeuft = auto_bis_ > auto_von_ && snap_ && snap_->n_auto_lanes > 0;
  bool irgendwo = laeuft;
  for (int i = 0; i < ARR_SPUREN && !irgendwo; ++i)
    for (int f = 0; f < AUTO_FELDER && !irgendwo; ++f) irgendwo = blende_n_[i][f] > 0 || blende_s_[i][f] != KEIN;
  if (!irgendwo) {
    for (auto& je_spur : auto_war_)
      for (bool& b : je_spur) b = false;
    return;
  }
  int abfall = m;   // first sample of the playing range whose project beat is below the one before it (a loop seam), else m: one scan for all lanes
  if (laeuft)
    for (int k = auto_von_ + 1; k < auto_bis_; ++k)
      if (ap_[k] < ap_[k - 1]) {
        abfall = k;
        break;
      }
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int f = 0; f < AUTO_FELDER; ++f) {
      Wert& w = w_[i][f];
      const bool lane = laeuft && feld_lane(snap_->spur[i], f);
      if (!lane && blende_n_[i][f] <= 0 && blende_s_[i][f] == KEIN) {
        auto_war_[i][f] = false;
        continue;
      }
      const bool fader = f == ARR_AUTO_FADER, pan = f == ARR_AUTO_PAN;
      const float halt_schwelle = pan ? AUTO_HALT_PAN : AUTO_HALT_DB;
      float* buf = auto_buf_[i][f];
      AutoLane& al = auto_l_[i][f];
      const int t0 = blende_s_[i][f] == KEIN ? -1 : static_cast<int>(std::clamp<int64_t>(blende_s_[i][f] - s0, 0, m - 1));
      float vorher = auto_war_[i][f] ? auto_zuletzt_[i][f] : (w.sw_vl ? w.sw_vl[0] : w.w);   // the value played just before this block
      double p_vorher = -1e300;
      for (int t = 0; t < m; ++t) {
        const float quelle = w.sw_vl ? w.sw_vl[t] : w.w;
        float v;
        bool gehalten_lane = false;   // this sample was taken from the lane through the step hold (fader, pan)
        if (lane && t >= auto_von_ && t < auto_bis_) {
          const double p = ap_[t];
          const bool anfang = t == auto_von_ || p < p_vorher;
          if (anfang) al.neu_suchen(p);   // start in the middle, loop seam: search the cursor anew
          p_vorher = p;
          v = al.wert_bei(p);
          if (fader || pan) {   // mute and solo are 0/1 jumps: taken exactly, no hold
            if (anfang && (t != auto_von_ || !auto_war_[i][f])) auto_halt_n_[i][f] = 0;   // a new run (start, seam) takes the exact value first
            if (auto_halt_n_[i][f] <= 0 || std::fabs(v - auto_halt_v_[i][f]) > halt_schwelle || auto_schritt_ <= 1) {
              // A hold that ran out (or a new run) is worth one look-ahead; a latch because the lane left the tolerance means a steep lane: no try in this window
              auto_probe_aus_[i][f] = auto_halt_n_[i][f] > 0;
              auto_halt_v_[i][f] = v;
              auto_halt_n_[i][f] = auto_schritt_;
            }
            v = auto_halt_v_[i][f];
            --auto_halt_n_[i][f];
            gehalten_lane = true;
          }
        } else {
          v = quelle;
        }
        if (t == t0) {   // a source change: blend from the value played just before
          blende_g0_[i][f] = fader ? db_lin_(vorher) : vorher;
          blende_n_[i][f] = ARR_STUMM_BLENDE;
          blende_s_[i][f] = KEIN;
        }
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_BLENDE_HART
        if (fader) blende_n_[i][f] = 0;   // error case: no blend, the fader jumps in one sample
#endif
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_PAN_BLENDE_HART
        if (pan) blende_n_[i][f] = 0;   // error case: no blend, pan jumps in one sample
#endif
        if (blende_n_[i][f] > 0) {
          const int k = ARR_STUMM_BLENDE - blende_n_[i][f] + 1;   // 1..480
          const float anteil = static_cast<float>(k) / static_cast<float>(ARR_STUMM_BLENDE);
          if (fader) {
            const float g1 = db_lin_(v);
            const float g = blende_g0_[i][f] + (g1 - blende_g0_[i][f]) * anteil;
            if (blende_n_[i][f] > 1) v = lin_db_(g);   // the last step is exactly the target
          } else if (pan) {
            if (blende_n_[i][f] > 1) v = blende_g0_[i][f] + (v - blende_g0_[i][f]) * anteil;   // linear in the pan value
          }
          --blende_n_[i][f];
        }
        buf[t] = v;
        vorher = v;
        // Skip ahead inside a running hold. The samples t+1..t+r would each evaluate the lane only to find the exact value within the tolerance
        // of the held one and play the held value. If the lane value at t+r is within the tolerance and the value is monotone in between
        // (AutoLane::vorausschau), every sample between is within it too, so the result is the held value r times, the cursor ends where the
        // per-sample run would have left it, and no state differs. Anything else (blend, source change, seam, other segment, s-curve) runs per sample.
        // At most one try per hold window, and none in a window that began because the lane left the tolerance (auto_probe_aus_): if the try fails
        // (the lane leaves the tolerance, another segment, an s-curve), the rest of the window runs per sample up to the next latch. Latches by expiry are
        // at least auto_schritt_ samples apart, so the worst case is one extra evaluation per hold step (17/16 of the per-sample cost), however steep the lane.
        if (gehalten_lane && auto_vorausschau_ && auto_schritt_ > 1 && auto_halt_n_[i][f] > 1 && blende_n_[i][f] == 0 && !auto_probe_aus_[i][f]) {
          int r = std::min({auto_halt_n_[i][f], auto_bis_ - 1 - t, m - 1 - t});
          if (t0 > t) r = std::min(r, t0 - t - 1);   // the source change at t0 is a per-sample step
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_NAHT
          if (r >= 2) {   // error case: the loop seam is not looked for
#else
          if (r >= 2 && abfall > t + r) {
#endif
            float v_ende = 0.0f;
            bool ok = al.vorausschau(ap_[t + r], v_ende);
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_TOL
            ok = ok && !(std::fabs(v_ende - auto_halt_v_[i][f]) > halt_schwelle);   // (error case without this: a lane that left the tolerance is held)
#endif
            if (ok) {
              std::fill(buf + t + 1, buf + t + r + 1, auto_halt_v_[i][f]);
              auto_halt_n_[i][f] -= r;
              p_vorher = ap_[t + r];
              t += r;
            } else {
              auto_probe_aus_[i][f] = true;
            }
          }
        }
      }
      auto_zuletzt_[i][f] = vorher;
      auto_war_[i][f] = true;
      w.vl = buf;
    }
}

}  // namespace cdj
