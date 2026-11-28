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
// The send lane of a track for return r (0-based), or nullptr. Absolute only (the reader refuses a relative one).
const ArrAutoLane* send_lane(const ArrSpur& sp, int r) {
  for (int k = 0; k < sp.n_auto; ++k)
    if (sp.auto_lanes[k].ziel == ARR_AUTO_SEND && sp.auto_lanes[k].param == r) return &sp.auto_lanes[k];
  return nullptr;
}
// The relative lane of a device parameter, or nullptr.
const ArrAutoLane* geraet_rel(const ArrSpur& sp, int param) {
  for (int k = 0; k < sp.n_auto; ++k)
    if (sp.auto_lanes[k].ziel == ARR_AUTO_GERAET && sp.auto_lanes[k].param == param && sp.auto_lanes[k].relativ) return &sp.auto_lanes[k];
  return nullptr;
}
// The lane of an automation slot (0..ARR_AUTO_SLOTS - 1): a track slot is the track, slot ARR_SPUREN + r is return r with field 0 (fader) only, absolute, no relative lane.
// ArrSnapshot::ret_fader is the one place of a return lane.
const ArrAutoLane* slot_lane(const ArrSnapshot& sn, int slot, int feld) {
  if (slot < ARR_SPUREN) return feld_lane(sn.spur[slot], feld);
  if (feld != ARR_AUTO_FADER) return nullptr;
#ifdef CYPHERDJ_MUTATION_ARR_RET_FADER_SLOT_VERSATZ   // error case: a return reads the fader lane of the next return
  const int r = (slot - ARR_SPUREN + 1) % ARR_RETURNS;
#else
  const int r = slot - ARR_SPUREN;
#endif
  return sn.ret_fader_da[r] ? &sn.ret_fader[r] : nullptr;
}
const ArrAutoLane* slot_rel(const ArrSnapshot& sn, int slot, int feld) { return slot < ARR_SPUREN ? feld_rel(sn.spur[slot], feld) : nullptr; }
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

// The value stack of one device parameter at project beat p: the absolute lane (`ab`, cursor `al`), the relative lane (`rel`, cursor `rl`), either may be nullptr. Cursors are searched anew
// (once per call: a start in the middle, a loop seam or a swap needs no special case). false: no lane at all. *nur_summand true: a relative lane alone, *wert is its summand; otherwise *wert
// is the (clamped, when both lanes are there) value. Used by auto_geraet (once per block, on the cursors of the Arrangement) and arr_geraet_lane_wert (per note, on fresh cursors).
inline bool geraet_stapel(const ArrAutoLane* ab, AutoLane* al, const ArrAutoLane* rel, AutoLane* rl, double p, float* wert, bool* nur_summand) noexcept {
  if (!ab && !rel) return false;
  float v = 0.0f;
  if (ab) {
    al->neu_suchen(p);
    v = al->wert_bei(p);
  }
  *nur_summand = false;
  if (rel) {
    rl->neu_suchen(p);
    const float summand = rl->wert_bei(p);
    if (!ab) {
      *wert = summand;
      *nur_summand = true;
      return true;
    }
    v = stapel_klemme_geraet(v + summand);
  }
  *wert = v;
  return true;
}
}  // namespace

void Arrangement::auto_segment(const Karte& k, int64_t a, int64_t b, int64_t s0) {
  if (!snap_ || (snap_->n_auto_lanes == 0 && snap_->n_klanes == 0 && snap_->n_mod == 0) || b <= a) return;   // 1.12 slice 6: an insert or rack lane needs the project beat too; strand 6: a modulator too (D4)
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
  for (int i = 0; i < ARR_AUTO_SLOTS; ++i)   // the tracks and the returns (slot ARR_SPUREN + r)
    for (int f = 0; f < AUTO_FELDER; ++f) {
      const bool alt_lane = snap_ && slot_lane(*snap_, i, f);
      const ArrAutoLane* nl = neu ? slot_lane(*neu, i, f) : nullptr;
      const bool neu_lane = nl != nullptr;
      const bool alt_rel = snap_ && slot_rel(*snap_, i, f);   // 1.12 slice 5: the relative lane of the field (fader, pan), before and after
      const ArrAutoLane* nr = neu ? slot_rel(*neu, i, f) : nullptr;
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
  for (int k = 0; k < ARR_KLANES_MAX; ++k)   // 1.12 slice 6: the insert and rack lanes: only the table (auto_kette searches the cursor once per block)
    auto_k_[k] = neu && k < neu->n_klanes ? AutoLane(neu->klane[k].p, neu->klane[k].n) : AutoLane();
  for (int i = 0; i < ARR_SPUREN; ++i)   // send lanes: the cursor of the new table, searched from the start; the held gain and the "lane drove it" flag stay, so the swap ramps from what was heard
    for (int r = 0; r < ARR_RETURNS; ++r) {
      const ArrAutoLane* sl = neu ? send_lane(neu->spur[i], r) : nullptr;
      auto_s_[i][r] = sl ? AutoLane(sl->p, sl->n) : AutoLane();
      if (sl) auto_s_[i][r].neu_suchen(0.0);
    }
  for (int i = 0; i < ARR_SPUREN; ++i)   // device lanes: only the cursor, the sink sees the lane value per block and handles a change itself
    for (int g = 0; g < ARR_GERAET_LANE_PARAMS; ++g) {
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
    for (int g = 0; g < ARR_GERAET_LANE_PARAMS; ++g) {
      float v = 0.0f;
      bool nur_summand = false;
      if (!geraet_stapel(geraet_lane(sp, g), &auto_g_[i][g], geraet_rel(sp, g), &auto_gr_[i][g], p, &v, &nur_summand)) continue;
      if (nur_summand) {   // the sink owns the base value of the parameter: it adds the summand itself
        se->auto_parameter_summand(i, g, v);
        continue;
      }
      se->auto_parameter(i, g, v);
    }
  }
}

// Send automation: per track and return ONE gain ramp per block (Arrangement::SendPlan), read by sends_bereiten() in mischen(). Like auto_geraet the lane is read once per block, at the project
// beat of the last running sample; the gain runs there from the gain at the end of the last block (a0 = send_lin_), so the first sample of a block is the lane value of the block before and
// a step in a lane is smoothed over one block. A hard start (the lane value at the first running sample instead of a ramp) at a transport start (the last block did not run), a jump back
// (the first project beat is below the last one) and, inside a block, at a loop seam: the ramp breaks there into two parts. While the transport stands the gain is held. A lane that is new
// while playing (swap) ramps from the knob, a lane that is gone (swap) ramps back to the knob over one block, then the knob rules (send_da_ false). The ramp is in the LINEAR gain, so
// -200 dB is exactly 0 (db_lin) and there is no logarithm per sample. A cell envelope is not looked at here: sends_bereiten gives it the precedence. No allocation, no lock.
void Arrangement::auto_send(int m) {
  const bool lanes = snap_ && snap_->n_auto_lanes > 0;
  if (!lanes && !send_aktiv_ && mod_send_n_ == 0) {   // nothing to play, but keep the transport memory current for a lane that arrives with a swap
    send_lief_ = snap_ && auto_bis_ > auto_von_;
    if (send_lief_) send_p_ende_ = ap_[auto_bis_ - 1];
    send_spielte_ = status_ == ArrStatus::spielt;
    return;
  }
  const bool laeuft = snap_ && auto_bis_ > auto_von_;
  double p0 = 0.0, p1 = 0.0;
  int abfall = m;   // first running sample whose project beat is below the one before it (a loop seam), else m
  if (laeuft) {
    p0 = ap_[auto_von_];
    p1 = ap_[auto_bis_ - 1];
    for (int k = auto_von_ + 1; k < auto_bis_; ++k)
      if (ap_[k] < ap_[k - 1]) {
        abfall = k;
        break;
      }
  }
  const bool stetig = laeuft && send_lief_ && p0 >= send_p_ende_ - 1e-9;   // this block goes on where the last one ended
  // Strand 6 task 4.1: a modulator on the send adds its offset in dB to the lane value (or the knob) before db_lin, clamped to the send range; a base at -200 dB (off) stays off.
  // Without a modulator the gains are the ones of the lane alone, bit for bit. With one, the plan runs also without a lane (from the knob) and while the transport stands (from the
  // lane value held at the end of the last running block, send_db_), and the gain ramps over the block from the gain heard at its start (lin).
  bool md = false;
  float off = 0.0f;
  const auto lin_von = [&md, &off](float db) {
    if (!md) return db_lin(db);
    if (!(db > -200.0f)) return 0.0f;
    const float x = db + off;
    return db_lin(x < -200.0f ? -200.0f : (x > 6.0f ? 6.0f : x));
  };
  const auto wert_db = [](AutoLane& al, double p) {
    al.neu_suchen(p);
    return al.wert_bei(p);
  };
  bool aktiv = false;
  for (int i = 0; i < ARR_SPUREN; ++i)
    for (int r = 0; r < ARR_RETURNS; ++r) {
      SendPlan& pl = send_plan_[i][r];
      pl = SendPlan();
      const ArrAutoLane* l = lanes ? send_lane(snap_->spur[i], r) : nullptr;
      md = mod_send_an_[i][r];
      off = mod_send_db_[i][r];
      float& lin = send_lin_[i][r];
      if (l && laeuft) {
        AutoLane& al = auto_s_[i][r];
        const float ende_db = wert_db(al, p1);
        const float ende = lin_von(ende_db);
        float a;
        if (send_da_[i][r] && stetig) a = lin;
        else if (!send_da_[i][r] && send_spielte_) a = db_lin(w_[i][arr_f_send(r)].w);   // a lane that is new while playing (swap): from the knob that was heard
        else a = lin_von(wert_db(al, p0));                                          // transport start or jump back: the lane value
        pl.da = true;
        pl.a0 = a;
        if (abfall < m) {   // a loop seam inside the block: up to it the old course, from it the lane at the loop start
          pl.b0 = lin_von(wert_db(al, ap_[abfall - 1]));
          pl.a1 = lin_von(wert_db(al, ap_[abfall]));
          pl.b1 = ende;
          pl.ts = abfall;
        } else {
          pl.b0 = ende;
          pl.ts = m;
        }
        lin = ende;
        send_db_[i][r] = ende_db;
        send_da_[i][r] = true;
        send_ld_[i][r] = true;
      } else if (l && send_da_[i][r] && send_ld_[i][r]) {   // the transport stands: the lane gain is held (a modulator swings around the held lane value)
        pl.da = true;
        pl.a0 = lin;
        pl.b0 = md ? lin_von(send_db_[i][r]) : lin;
        pl.ts = m;
        lin = pl.b0;
      } else if (md) {   // task 4.1: a modulator on the knob (no lane, or a lane that has not run yet): from the gain heard to knob + offset over this block
        const float k = w_[i][arr_f_send(r)].w;
        pl.da = true;
        pl.a0 = send_da_[i][r] ? lin : db_lin(k);
        pl.b0 = lin_von(k);
        pl.ts = m;
        lin = pl.b0;
        send_da_[i][r] = true;
        send_ld_[i][r] = false;
      } else if (send_da_[i][r]) {   // the lane (or the modulator) is gone: back to the knob over this block
        pl.da = true;
        pl.a0 = lin;
        pl.b0 = db_lin(w_[i][arr_f_send(r)].w);
        pl.ts = m;
        send_da_[i][r] = false;
        send_ld_[i][r] = false;
      }
      aktiv = aktiv || pl.da || send_da_[i][r];
    }
  send_aktiv_ = aktiv;
  send_lief_ = laeuft;
  if (laeuft) send_p_ende_ = p1;
  send_spielte_ = status_ == ArrStatus::spielt;
}

// sampler A2: one device lane value at an arbitrary project beat, on fresh cursors (the Arrangement's own cursors keep their place).
bool arr_geraet_lane_wert(const ArrSpur& sp, int param, double beat, float* wert, bool* relativ) noexcept {
  const ArrAutoLane* a = geraet_lane(sp, param);
  const ArrAutoLane* r = geraet_rel(sp, param);
  if (!a && !r) return false;
  AutoLane al = a ? AutoLane(a->p, a->n) : AutoLane();
  AutoLane rl = r ? AutoLane(r->p, r->n) : AutoLane();
  return geraet_stapel(a, &al, r, &rl, beat, wert, relativ);
}

// 1.12 slice 6: the insert-parameter and rack-macro lanes. Per block ONE value per lane, the lane at the project beat of the last running sample (like auto_geraet), handed to ArrInserts, which
// lets it replace the row of the parameter (or the macro row) for this block. A block without a running sample (transport stands or waits) hands nothing: ArrInserts has cleared the previous
// block's values, so a lane that ends gives its parameter back to the row in the next block. Runs before mischen() (makros_planen reads the macro lanes there), on the callback thread: no
// allocation, no lock, no logarithm.
void Arrangement::auto_kette() {
  ins_.lanen_loeschen();
  if (!snap_ || snap_->n_klanes == 0) return;
  // Running: the beat of the last running sample. Waiting for the start (lead time, quantum wait, count-in): the lane's value AT the start beat, so a stage opens the playback on the value it
  // will play and its module does not glide from the row value to the lane (the start glide the RB-338 had, 1.9 T9). Stopped: nothing, the rows rule.
  double p;
  if (auto_bis_ > auto_von_) p = ap_[auto_bis_ - 1];
  else if (status_ == ArrStatus::wartet) p = start_beat_;
  else return;
  for (int k = 0; k < snap_->n_klanes; ++k) {
    const ArrKettenLane& l = snap_->klane[k];
    AutoLane& al = auto_k_[k];
    al.neu_suchen(p);   // once per block: a start in the middle, a loop seam or a swap needs no special case
    const float v = al.wert_bei(p);
    if (l.makro >= 0) {
      const ArrRack& r = snap_->rack[l.strip];
      if (r.slot >= 0) ins_.lane_makro(r.slot, l.makro, v);
    } else {
      ins_.lane_stufe(l.strip, snap_->kette[l.strip], l.stufe, l.param, v);
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

// From here on `spur` of the override calls is an automation SLOT (slot_lane): a track index, or ARR_SPUREN + r for the fader lane of return r (the hand overrides a
// return fader lane like a track fader lane). The OSC side (/k/arr/auto, /e/auto) stays at tracks 1..ARR_SPUREN: it never names a slot above ARR_SPUREN - 1.
bool Arrangement::auto_lane_da(int spur, int feld) const {
  return spur >= 0 && spur < ARR_AUTO_SLOTS && feld >= 0 && feld < AUTO_FELDER && snap_ && slot_lane(*snap_, spur, feld);
}

bool Arrangement::auto_kann_uebersteuern(int spur, int feld) const {
  return spur >= 0 && spur < ARR_AUTO_SLOTS && feld >= 0 && feld < AUTO_FELDER && status_ == ArrStatus::spielt && snap_ && slot_lane(*snap_, spur, feld) &&
         !auto_ueber_[spur][feld];
}

bool Arrangement::auto_uebersteuern(int spur, int feld, bool an, int64_t sample) {
  if (spur < 0 || spur >= ARR_AUTO_SLOTS || feld < 0 || feld >= AUTO_FELDER) return false;
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_FREIGABE_IM_STOPP
  if (status_ != ArrStatus::spielt) return false;   // error case: the re-enable is refused while stopped as well
#elif !defined(CYPHERDJ_MUTATION_ARR_AUTO_UEBER_IM_STOPP)
  if (an && status_ != ArrStatus::spielt) return false;   // D5: while the transport does not play, no override starts
#endif
  if (!snap_ || !slot_lane(*snap_, spur, feld)) return false;   // nothing to override
  if (auto_ueber_[spur][feld] == an) return false;
  if (!an && status_ != ArrStatus::spielt) {   // D6: re-enable while stopped just clears the state (nothing plays, no blend), like auto_alle_freigeben
    auto_ueber_loeschen(spur, feld, sample);
    return true;
  }
  auto_ueber_setzen(spur, feld, an, sample);
  return true;
}

void Arrangement::auto_alle_freigeben(int64_t sample) {
  for (int i = 0; i < ARR_AUTO_SLOTS; ++i)
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
  return spur >= 0 && spur < ARR_AUTO_SLOTS && feld >= 0 && feld < AUTO_FELDER ? auto_lane_v_[spur][feld] : 0.0f;
}

// D2 and Task-1 condition 1: the Stellwerk asks this for every applied hand step. True only for the FIRST step of an override start (auto_pickup_), never while the field
// is overridden, so a relative encoder or a moving fader accumulates from the lane value instead of falling back to it at every step.
bool Arrangement::auto_lane_wert(int regler, float& wert) {
  if (status_ != ArrStatus::spielt || !snap_ || regler < 0 || regler >= cypherdj::stellwerk::MAX_REGLER) return false;
  const int streifen = regler_spur_[regler], fe = regler_feld_[regler];
  const int sp = streifen >= ARR_RET0 && streifen < ARR_RET0 + ARR_RETURNS ? ARR_SPUREN + (streifen - ARR_RET0) : streifen;   // strip index -> automation slot
  // only spur/1..128/{fader,pan,mute,solo} and ret/<r>/fader
  if (sp < 0 || sp >= ARR_AUTO_SLOTS || (sp >= ARR_SPUREN && streifen < ARR_RET0) || fe < 0 || fe >= AUTO_FELDER || spur_regler_[sp][fe] != regler)
    return false;
  if (!slot_lane(*snap_, sp, fe)) return false;
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
  for (int i = 0; i < ARR_AUTO_SLOTS; ++i)
    for (int f = 0; f < AUTO_FELDER; ++f)
      if (auto_ueber_n_[i][f] > 0 && std::max(auto_ueber_s_[i][f], auto_ueber_n_[i][f] == 2 ? auto_ueber_s2_[i][f] : auto_ueber_s_[i][f]) < s_ende) {
        auto_ueber_alt_[i][f] = auto_ueber_[i][f];
        auto_ueber_n_[i][f] = 0;
        --auto_ueber_offen_;
      }
}

void Arrangement::auto_stopp(int64_t s) {
  if (!snap_) return;
#ifdef CYPHERDJ_MUTATION_ARR_RET_STOPP_HART   // error case: a return takes the Stellwerk value back at once at the stop (no blend)
  for (int i = 0; i < ARR_SPUREN; ++i)
#else
  for (int i = 0; i < ARR_AUTO_SLOTS; ++i)
#endif
    for (int f = 0; f < AUTO_BLENDE_FELDER; ++f)
      if ((slot_lane(*snap_, i, f) || slot_rel(*snap_, i, f)) && !auto_ueber_[i][f]) blende_vormerken(i, f, s);   // an overridden field plays the hand on: no source change
}

void Arrangement::auto_beginn() {
  for (int i = 0; i < ARR_AUTO_SLOTS; ++i)   // a start takes the hard lane value (AK6), no blend from an earlier stop
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
  for (int i = 0; i < ARR_AUTO_SLOTS && !irgendwo; ++i)
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
  for (int i = 0; i < ARR_AUTO_SLOTS; ++i)
    for (int f = 0; f < AUTO_FELDER; ++f) {
      Wert& w = i < ARR_SPUREN ? w_[i][f] : w_[ARR_RET0 + i - ARR_SPUREN][f];   // the strip of the slot (a return: the same fields 0..3, only the fader has a lane)
      const bool lane = laeuft && slot_lane(*snap_, i, f);
      const bool rel = laeuft && slot_rel(*snap_, i, f) != nullptr;   // 1.12 slice 5: the summand lane of the field (fader, pan)
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
