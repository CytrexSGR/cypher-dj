// Automation (ADR 032): the lanes of a track, evaluated per sample in the core. Slice 1 played the fader lane; slice 2 task 3 plays the fields 0..3
// (fader, pan, mute, solo) the same way, one buffer auto_buf_[track][field] each (E7); device lanes (ziel geraet) are not played in the mixer: auto_geraet hands their value to the sink once per block (E9). Three jobs:
//  - auto_segment: while the transport plays and the snapshot carries a lane, the exact project beat of every sample of a sub-block goes
//    into ap_ (Karte::beat_at per sample, D3: not linear between segment borders, so a tempo ramp stays right);
//  - auto_block: before mischen(), for every track and field with a lane (or a running blend) the course of the whole block goes into
//    auto_buf_[track][field] and Wert::vl points there; samples outside the playing range carry the source value (stellwerk course or base value);
//  - the blend (D6, E8): when the fader or pan changes its source between lane and base value (stop, lane gone, snapshot swap) it runs 480 samples
//    linearly from the last played value to the new target: in the GAIN for the fader, in the pan VALUE for pan; start and loop seam take the hard lane
//    value. Mute and solo have no blend of their own: the 0/1 values go through the mixer fade (ARR_STUMM_BLENDE, 480 samples).
// 1.12 slice 3: a lane can be overridden per track and field (auto_uebersteuern, D6): the hand course plays from the grip sample, with the same 480 blend as every source change; see below.
// 1.12 slice 5 (D9, spec 5.11 a): the VALUE STACK. Next to the absolute lane of fader and pan (and of a device parameter) a track can carry a RELATIVE lane (ArrAutoLane::relativ, a
// summand: dB, pan units, device units). The field plays base value (the Stellwerk course) or the absolute lane, plus the relative lane, clamped to the range of the target, and that sum
// is what the step hold, the look-ahead and the 480 blend work on (a relative lane that appears or vanishes at a swap blends like an absolute one). While the hand overrides the field the
// whole stack yields (absolute and relative); a field with a relative lane only has no override (there is nothing absolute to take over): the hand moves the base, the stack follows it.
// The base value in Wert::w stays true: verlaeufe_nachfuehren never writes a lane value into it (D5a). mischen() only checks pan for a change per sample.
// No allocation, no locks. The logarithm runs only in the at most 480 blend samples per source change, never in steady operation.
#include <algorithm>
#include <cmath>

#include "arr_gain_intern.h"
#include "cypherdj/arrangement.h"

namespace cdj {

namespace {
constexpr int64_t KEIN = INT64_MIN;
constexpr float AUTO_HALT_PAN = 0.002f;   // the same for pan, in pan units (d gain / d pan <= pi/4, so at most 0.0016 in the gain)
inline float lin_db_(float g) { return 20.0f * std::log10(std::max(g, 1e-10f)); }                // clamps at -200 dB
// The target constants are the field numbers of the mixer (Wert fields 0..3); feld_lane and the buffers rely on it.
static_assert(ARR_AUTO_FADER == 0 && ARR_AUTO_PAN == 1 && ARR_AUTO_MUTE == 2 && ARR_AUTO_SOLO == 3, "lane target = mixer field");
// The lane of a track for field 0..3 (fader, pan, mute, solo), or nullptr. Never by position: a pan lane may sit before the fader lane.
const ArrAutoLane* feld_lane(const ArrSpur& sp, int feld) {
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_LANE_NULL   // error case: lane 0 by position is taken as the fader lane (a pan lane in front plays as gain)
  if (feld == ARR_AUTO_FADER) return sp.n_auto > 0 ? sp.auto_lanes : nullptr;
#endif
  for (int k = 0; k < sp.n_auto; ++k)
    if (sp.auto_lanes[k].ziel == feld && !sp.auto_lanes[k].relativ) return &sp.auto_lanes[k];   // ARR_AUTO_FADER..SOLO = field 0..3
  return nullptr;
}
// The `geraet` lane of a track for the device parameter 0..3 (ARR_GERAET_PARAM_NAME), or nullptr.
const ArrAutoLane* geraet_lane(const ArrSpur& sp, int param) {
  for (int k = 0; k < sp.n_auto; ++k)
    if (sp.auto_lanes[k].ziel == ARR_AUTO_GERAET && sp.auto_lanes[k].param == param && !sp.auto_lanes[k].relativ) return &sp.auto_lanes[k];
  return nullptr;
}
// The relative (summand) lane of a track for field 0 (fader) or 1 (pan), or nullptr. The reader allows at most one per target and none for mute and solo.
const ArrAutoLane* feld_rel(const ArrSpur& sp, int feld) {
  if (feld >= ARR_AUTO_MUTE) return nullptr;
  for (int k = 0; k < sp.n_auto; ++k)
    if (sp.auto_lanes[k].ziel == feld && sp.auto_lanes[k].relativ) return &sp.auto_lanes[k];
  return nullptr;
}
// The relative lane of a device parameter, or nullptr.
const ArrAutoLane* geraet_rel(const ArrSpur& sp, int param) {
  for (int k = 0; k < sp.n_auto; ++k)
    if (sp.auto_lanes[k].ziel == ARR_AUTO_GERAET && sp.auto_lanes[k].param == param && sp.auto_lanes[k].relativ) return &sp.auto_lanes[k];
  return nullptr;
}
// The end of the value stack: the sum is clamped to the range of the target (the ranges of the absolute lanes: fader -200..6 dB, pan -1..1, device 0..1).
inline float stapel_klemme(int feld, float v) {
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME   // error case: the stack is not clamped
  (void)feld;
  return v;
#else
  return feld == ARR_AUTO_PAN ? std::clamp(v, -1.0f, 1.0f) : std::clamp(v, -200.0f, 6.0f);
#endif
}
inline float stapel_klemme_geraet(float v) {
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_KLEMME
  return v;
#else
  return std::clamp(v, 0.0f, 1.0f);
#endif
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
      const bool alt_rel = snap_ && feld_rel(snap_->spur[i], f);   // 1.12 slice 5: the relative lane of the field (fader, pan), before and after
      const ArrAutoLane* nr = neu ? feld_rel(neu->spur[i], f) : nullptr;
      const bool ue = auto_ueber_[i][f];
      // D6: deleting the lane clears the override, checked here at the swap (also while stopped); the state is reported. A swap that keeps the lane keeps it.
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_UEBER_TAUSCH_LOESCHT
      if (ue) {   // error case: every swap clears the override
#else
      if (ue && !neu_lane) {
#endif
        auto_ueber_loeschen(i, f, s);
      }
      if (neu_lane) {
        const ArrAutoLane& l = *nl;
        auto_l_[i][f] = AutoLane(l.p, l.n);
        auto_l_[i][f].neu_suchen(0.0);
      } else {
        auto_l_[i][f] = AutoLane();
      }
      if (f < AUTO_BLENDE_FELDER) {
        auto_r_[i][f] = nr ? AutoLane(nr->p, nr->n) : AutoLane();
        if (nr) auto_r_[i][f].neu_suchen(0.0);
      }
      // an overridden field plays the hand before and after the swap: no source change, no blend. One exception: the absolute lane is gone (the override just cleared) and a relative
      // lane is new, then the hand value gets a summand: that is a change of the source too.
      if (f < AUTO_BLENDE_FELDER && status_ == ArrStatus::spielt && (alt_lane || neu_lane || alt_rel || nr) && (!ue || (!neu_lane && nr)))
        blende_vormerken(i, f, s);   // the new source may differ: AK23, lane gone, lane new
    }
  for (int i = 0; i < ARR_SPUREN; ++i)   // device lanes: only the cursor, the sink sees the lane value per block and handles a change itself
    for (int g = 0; g < ARR_GERAET_PARAMS; ++g) {
      const ArrAutoLane* gl = neu ? geraet_lane(neu->spur[i], g) : nullptr;
      auto_g_[i][g] = gl ? AutoLane(gl->p, gl->n) : AutoLane();
      const ArrAutoLane* gr = neu ? geraet_rel(neu->spur[i], g) : nullptr;
      auto_gr_[i][g] = gr ? AutoLane(gr->p, gr->n) : AutoLane();
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
      const bool absolut = geraet_lane(sp, g) != nullptr, relativ = geraet_rel(sp, g) != nullptr;
      if (!absolut && !relativ) continue;
      float v = 0.0f;
      if (absolut) {
        AutoLane& al = auto_g_[i][g];
        al.neu_suchen(p);   // once per block: a start in the middle, a loop seam or a swap needs no special case
        v = al.wert_bei(p);
      }
      if (relativ) {
        AutoLane& rl = auto_gr_[i][g];
        rl.neu_suchen(p);
        const float summand = rl.wert_bei(p);
        if (!absolut) {   // the sink owns the base value of the parameter: it adds the summand itself
          se->auto_parameter_summand(i, g, summand);
          continue;
        }
        v = stapel_klemme_geraet(v + summand);
      }
      se->auto_parameter(i, g, v);
    }
  }
}

// ---- 1.12 slice 3: the lane override (D1, D2, D5, D6, D7). Everything runs in the callback thread; the override lives in the core only.
void Arrangement::auto_ereignis_melden(int spur, int feld, bool zustand, int64_t sample) {
  const ArrAutoEreignis e{static_cast<int16_t>(spur), static_cast<int8_t>(feld), static_cast<int8_t>(zustand ? 1 : 0), sample};
  if (!auto_ev_.schiebe(e)) auto_ev_verloren_.fetch_add(1, std::memory_order_relaxed);   // full: the reader is behind; count, never block (see the header)
}

// A source blend starts at `sample`. At most two per block (a swap or stop and a grip, or a re-enable and a grip): the second one does not swallow the first, auto_block
// starts each from the value that is audible at its sample (D7).
void Arrangement::blende_vormerken(int i, int f, int64_t sample) {
  if (blende_s_[i][f] == KEIN) {
    blende_s_[i][f] = sample;
  } else if (blende_s2_[i][f] == KEIN) {
    if (sample >= blende_s_[i][f]) {
      blende_s2_[i][f] = sample;
    } else {
      blende_s2_[i][f] = blende_s_[i][f];
      blende_s_[i][f] = sample;
    }
  } else {   // a third one in the same block: the later two stay
    blende_s2_[i][f] = std::max(sample, blende_s_[i][f]);
  }
}

// Clears the state without a blend and reports 0: the transport stands (nothing plays) or the lane is gone (the source stays the hand).
void Arrangement::auto_ueber_loeschen(int i, int f, int64_t sample) {
  if (auto_ueber_n_[i][f] > 0) {
    auto_ueber_n_[i][f] = 0;
    --auto_ueber_offen_;
  }
  auto_ueber_[i][f] = auto_ueber_alt_[i][f] = false;
  auto_pickup_[i][f] = false;
  auto_ereignis_melden(i, f, false, sample);
}

// The state change itself, called only for a real change. The hand (or the lane) takes over at `sample`: auto_block plays the old source before it and the new one from it.
void Arrangement::auto_ueber_setzen(int i, int f, bool an, int64_t sample) {
  int8_t& n = auto_ueber_n_[i][f];
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_UEBER_ZWEI_UEBERSCHREIBT
  if (n >= 1) {   // error case: a second change in the block takes the first as passed, and its blend start is overwritten
    auto_ueber_alt_[i][f] = auto_ueber_[i][f];
    n = 0;
    --auto_ueber_offen_;
  }
#endif
  if (n == 0) {
    auto_ueber_alt_[i][f] = auto_ueber_[i][f];
    auto_ueber_s_[i][f] = sample;
    n = 1;
    ++auto_ueber_offen_;
  } else if (n == 1) {
    auto_ueber_s2_[i][f] = std::max(sample, auto_ueber_s_[i][f]);
    n = 2;
  } else {   // a third change in the block: the first two (which cancel each other) are taken as passed
    auto_ueber_alt_[i][f] = auto_ueber_[i][f];
    auto_ueber_s_[i][f] = sample;
    n = 1;
  }
  auto_ueber_[i][f] = an;
  auto_pickup_[i][f] = false;   // the pickup of this override start is used up (or was not needed)
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_UEBER_ZWEI_UEBERSCHREIBT
  if (f < AUTO_BLENDE_FELDER) blende_s_[i][f] = sample;
#elif !defined(CYPHERDJ_MUTATION_ARR_AUTO_UEBER_OHNE_BLENDE)
  if (f < AUTO_BLENDE_FELDER) blende_vormerken(i, f, sample);   // D7: the source changes between lane and hand, 480 samples (mute and solo jump, the mixer fade applies)
#endif
  auto_ereignis_melden(i, f, an, sample);
}

bool Arrangement::auto_lane_da(int spur, int feld) const {
  return spur >= 0 && spur < ARR_SPUREN && feld >= 0 && feld < AUTO_FELDER && snap_ && feld_lane(snap_->spur[spur], feld);
}

bool Arrangement::auto_kann_uebersteuern(int spur, int feld) const {
  return spur >= 0 && spur < ARR_SPUREN && feld >= 0 && feld < AUTO_FELDER && status_ == ArrStatus::spielt && snap_ && feld_lane(snap_->spur[spur], feld) &&
         !auto_ueber_[spur][feld];
}

bool Arrangement::auto_uebersteuern(int spur, int feld, bool an, int64_t sample) {
  if (spur < 0 || spur >= ARR_SPUREN || feld < 0 || feld >= AUTO_FELDER) return false;
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_FREIGABE_IM_STOPP
  if (status_ != ArrStatus::spielt) return false;   // error case: the re-enable is refused while stopped as well
#elif !defined(CYPHERDJ_MUTATION_ARR_AUTO_UEBER_IM_STOPP)
  if (an && status_ != ArrStatus::spielt) return false;   // D5: while the transport does not play, no override starts
#endif
  if (!snap_ || !feld_lane(snap_->spur[spur], feld)) return false;   // nothing to override
  if (auto_ueber_[spur][feld] == an) return false;
  if (!an && status_ != ArrStatus::spielt) {   // D6: re-enable while stopped just clears the state (nothing plays, no blend), like auto_alle_freigeben
    auto_ueber_loeschen(spur, feld, sample);
    return true;
  }
  auto_ueber_setzen(spur, feld, an, sample);
  return true;
}

void Arrangement::auto_alle_freigeben(int64_t sample) {
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int f = 0; f < AUTO_FELDER; ++f) {
      if (!auto_ueber_[i][f]) continue;
      if (status_ == ArrStatus::spielt) {
        auto_ueber_setzen(i, f, false, sample);
      } else {   // stopped: nothing plays, no blend; the state just goes
        auto_ueber_loeschen(i, f, sample);
      }
    }
}

float Arrangement::auto_letzter_wert(int spur, int feld) const {
  return spur >= 0 && spur < ARR_SPUREN && feld >= 0 && feld < AUTO_FELDER ? auto_lane_v_[spur][feld] : 0.0f;
}

// D2 and Task-1 condition 1: the Stellwerk asks this for every applied hand step. True only for the FIRST step of an override start (auto_pickup_), never while the field
// is overridden, so a relative encoder or a moving fader accumulates from the lane value instead of falling back to it at every step.
bool Arrangement::auto_lane_wert(int regler, float& wert) {
  if (status_ != ArrStatus::spielt || !snap_ || regler < 0 || regler >= cypherdj::stellwerk::MAX_REGLER) return false;
  const int sp = regler_spur_[regler], fe = regler_feld_[regler];
  if (sp < 0 || sp >= ARR_SPUREN || fe < 0 || fe >= AUTO_FELDER || spur_regler_[sp][fe] != regler) return false;   // only spur/1..32/{fader,pan,mute,solo}
  if (!feld_lane(snap_->spur[sp], fe)) return false;
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_UEBER_PICKUP_IMMER
  if (auto_ueber_[sp][fe] || auto_pickup_[sp][fe] || !auto_war_[sp][fe]) return false;   // overridden, already picked up, or the lane has not played yet
  auto_pickup_[sp][fe] = true;
#endif
  wert = auto_lane_v_[sp][fe];
  return true;
}

// After a block: an override change inside it has passed, the old state is no longer needed.
void Arrangement::auto_ueber_abschluss(int64_t s_ende) {
  if (auto_ueber_offen_ == 0) return;
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int f = 0; f < AUTO_FELDER; ++f)
      if (auto_ueber_n_[i][f] > 0 && std::max(auto_ueber_s_[i][f], auto_ueber_n_[i][f] == 2 ? auto_ueber_s2_[i][f] : auto_ueber_s_[i][f]) < s_ende) {
        auto_ueber_alt_[i][f] = auto_ueber_[i][f];
        auto_ueber_n_[i][f] = 0;
        --auto_ueber_offen_;
      }
}

void Arrangement::auto_stopp(int64_t s) {
  if (!snap_) return;
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int f = 0; f < AUTO_BLENDE_FELDER; ++f)
      if ((feld_lane(snap_->spur[i], f) || feld_rel(snap_->spur[i], f)) && !auto_ueber_[i][f]) blende_vormerken(i, f, s);   // an overridden field plays the hand on: no source change
}

void Arrangement::auto_beginn() {
  for (int i = 0; i < ARR_SPUREN; ++i)   // a start takes the hard lane value (AK6), no blend from an earlier stop
    for (int f = 0; f < AUTO_FELDER; ++f) {
      blende_n_[i][f] = 0;
      blende_s_[i][f] = KEIN;
      blende_s2_[i][f] = KEIN;
      auto_pickup_[i][f] = false;
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
      const bool rel = laeuft && feld_rel(snap_->spur[i], f) != nullptr;   // 1.12 slice 5: the summand lane of the field (fader, pan)
      // 1.12 S3 (D6): the lane override. alt = state at the block start, neu = state after the pending changes, at block samples t_ue and t_ue2 (n = 0, 1 or 2 changes)
      const bool ue_alt = auto_ueber_alt_[i][f], ue_neu = auto_ueber_[i][f];
      const int ue_n = auto_ueber_n_[i][f];
      const int t_ue = ue_n >= 1 ? static_cast<int>(std::clamp<int64_t>(auto_ueber_s_[i][f] - s0, 0, m)) : 0;
      const int t_ue2 = ue_n >= 2 ? static_cast<int>(std::clamp<int64_t>(auto_ueber_s2_[i][f] - s0, 0, m)) : 0;
      const bool ue_ganz = ue_n == 0 ? ue_neu : (ue_n == 1 && ue_alt && ue_neu);   // the hand plays the whole block
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_REL_BEI_UEBERSTEUERUNG
      const bool ue_stapel = ue_ganz && !rel;   // error case: a relative lane stays on the hand value
#else
      const bool ue_stapel = ue_ganz;           // D9: the hand yields the whole stack
#endif
      if ((!(lane || rel) || ue_stapel) && blende_n_[i][f] <= 0 && blende_s_[i][f] == KEIN) {   // no lane, or the hand plays the whole block: the Stellwerk course stands
        auto_war_[i][f] = false;
        continue;
      }
      const bool fader = f == ARR_AUTO_FADER, pan = f == ARR_AUTO_PAN;
      const float halt_schwelle = pan ? AUTO_HALT_PAN : AUTO_HALT_DB;
      float* buf = auto_buf_[i][f];
      AutoLane& al = auto_l_[i][f];
      AutoLane& rl = auto_r_[i][f < AUTO_BLENDE_FELDER ? f : 0];   // only read when `rel` (fader, pan)
      const int t0 = blende_s_[i][f] == KEIN ? -1 : static_cast<int>(std::clamp<int64_t>(blende_s_[i][f] - s0, 0, m - 1));
      const int t1 = blende_s2_[i][f] == KEIN ? -1 : static_cast<int>(std::clamp<int64_t>(blende_s2_[i][f] - s0, 0, m - 1));   // a second source change in this block
      // the value played just before this block; after an override it is the hand value of the block before (w.w, the Stellwerk course ended there)
      float vorher = auto_war_[i][f] ? auto_zuletzt_[i][f] : (ue_alt ? w.w : (w.sw_vl ? w.sw_vl[0] : w.w));
      double p_vorher = -1e300;
      bool lane_davor = false;   // the sample before was a lane sample (after the hand played, the cursor is searched anew)
      for (int t = 0; t < m; ++t) {
        const float quelle = w.sw_vl ? w.sw_vl[t] : w.w;
        float v;
        bool gehalten_lane = false;   // this sample was taken from the lane through the step hold (fader, pan)
        const bool ue = ue_n == 0 ? ue_neu : (t < t_ue ? ue_alt : (ue_n == 1 || t >= t_ue2 ? ue_neu : !ue_alt));   // the hand plays this sample (override)
        const bool im_lauf = t >= auto_von_ && t < auto_bis_;
        const bool abs_spielt = lane && !ue && im_lauf;
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_REL_BEI_UEBERSTEUERUNG
        const bool rel_spielt = rel && im_lauf;   // error case: the relative lane is added to the hand value as well
#else
        const bool rel_spielt = rel && !ue && im_lauf;
#endif
        [[maybe_unused]] float rel_nach = 0.0f;   // only the mutation ARR_AUTO_REL_OHNE_BLENDE: the summand that is added after the blend
        if (abs_spielt || rel_spielt) {
          const double p = ap_[t];
          const bool anfang = t == auto_von_ || p < p_vorher || !lane_davor;
          lane_davor = true;
          if (anfang) {   // start in the middle, loop seam: search the cursors anew
            if (lane) al.neu_suchen(p);
            if (rel) rl.neu_suchen(p);
          }
          p_vorher = p;
          v = abs_spielt ? al.wert_bei(p) : quelle;   // the stack: absolute lane, else the base value ...
          if (rel_spielt) {                            // ... plus the relative lane, clamped
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_BLENDE
            rel_nach = rl.wert_bei(p);   // error case: added after the blend below
#else
            v = stapel_klemme(f, v + rl.wert_bei(p));
#endif
          }
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
          auto_lane_v_[i][f] = v;   // what the lane itself played (D2: the pickup and the page path start from it)
        } else {
          v = quelle;
          lane_davor = false;
        }
        if (t == t0 || t == t1) {   // a source change: blend from the value played just before (a second one in the block starts from where the first has got to)
          blende_g0_[i][f] = fader ? db_lin(vorher) : vorher;
          blende_n_[i][f] = ARR_STUMM_BLENDE;
          if (t == t0) blende_s_[i][f] = KEIN;
          if (t == t1) blende_s2_[i][f] = KEIN;
        }
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_BLENDE_HART
        if (fader) blende_n_[i][f] = 0;   // error case: no blend, the fader jumps in one sample
#endif
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_PAN_BLENDE_HART
        if (pan) blende_n_[i][f] = 0;   // error case: no blend, pan jumps in one sample
#endif
        if (blende_n_[i][f] > 0) {   // 1.12 slice 5: v is the whole stack here, so the blend ends on it
          const int k = ARR_STUMM_BLENDE - blende_n_[i][f] + 1;   // 1..480
          const float anteil = static_cast<float>(k) / static_cast<float>(ARR_STUMM_BLENDE);
          if (fader) {
            const float g1 = db_lin(v);
            const float g = blende_g0_[i][f] + (g1 - blende_g0_[i][f]) * anteil;
            if (blende_n_[i][f] > 1) v = lin_db_(g);   // the last step is exactly the target
          } else if (pan) {
            if (blende_n_[i][f] > 1) v = blende_g0_[i][f] + (v - blende_g0_[i][f]) * anteil;   // linear in the pan value
          }
          --blende_n_[i][f];
        }
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_BLENDE
        if (rel_nach != 0.0f) v = stapel_klemme(f, v + rel_nach);
#endif
        buf[t] = v;
        vorher = v;
        // Skip ahead inside a running hold. The samples t+1..t+r would each evaluate the lane only to find the exact value within the tolerance
        // of the held one and play the held value. If the lane value at t+r is within the tolerance and the value is monotone in between
        // (AutoLane::vorausschau), every sample between is within it too, so the result is the held value r times, the cursor ends where the
        // per-sample run would have left it, and no state differs. Anything else (blend, source change, seam, other segment, s-curve) runs per sample.
        // At most one try per hold window, and none in a window that began because the lane left the tolerance (auto_probe_aus_): if the try fails
        // (the lane leaves the tolerance, another segment, an s-curve), the rest of the window runs per sample up to the next latch. Latches by expiry are
        // at least auto_schritt_ samples apart, so the worst case is one extra evaluation per hold step (17/16 of the per-sample cost), however steep the lane.
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_REL_OHNE_BLENDE
        const bool stapel_voraus = !rel;   // the mutation adds the summand after the hold: no skipping with a relative lane
#else
        const bool stapel_voraus = true;
#endif
        if (gehalten_lane && stapel_voraus && auto_vorausschau_ && auto_schritt_ > 1 && auto_halt_n_[i][f] > 1 && blende_n_[i][f] == 0 && !auto_probe_aus_[i][f]) {
          int r = std::min({auto_halt_n_[i][f], auto_bis_ - 1 - t, m - 1 - t});
          if (t0 > t) r = std::min(r, t0 - t - 1);   // the source change at t0 is a per-sample step
          if (t1 > t) r = std::min(r, t1 - t - 1);
          if (ue_n >= 1 && t_ue > t) r = std::min(r, t_ue - t - 1);   // the hand takes over (or gives back) at t_ue and t_ue2 (mute and solo have no blend, so no t0)
          if (ue_n >= 2 && t_ue2 > t) r = std::min(r, t_ue2 - t - 1);
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_VORAUS_NAHT
          if (r >= 2) {   // error case: the loop seam is not looked for
#else
          if (r >= 2 && abfall > t + r) {
#endif
            float v_ende = 0.0f;
            bool ok = true;
            if (lane) {
              ok = al.vorausschau(ap_[t + r], v_ende);
            } else if (!w.sw_vl) {
              v_ende = w.w;   // relative lane only, a constant base value in this block
            } else {
              ok = false;     // relative lane only over a moving hand course: every sample is evaluated
            }
            // The stack: on the segment each cursor stays on, an allowed form (0 linear, 2 jump) is affine in the beat, so the sum of the absolute and the relative lane is
            // affine too, hence monotone; the clamp is monotone as well. The tolerance test at the end of the look-ahead then covers every sample in between.
#ifndef CYPHERDJ_MUTATION_ARR_AUTO_REL_VORAUS_OHNE   // error case: the relative lane is left out of the look-ahead (the held value runs on while the sum leaves the tolerance)
            if (ok && rel) {
              float v_rel = 0.0f;
              ok = rl.vorausschau(ap_[t + r], v_rel);
              v_ende = stapel_klemme(f, v_ende + v_rel);
            }
#endif
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
