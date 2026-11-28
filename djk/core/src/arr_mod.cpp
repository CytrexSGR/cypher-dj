// Strand 6 (plan 2026-11-27, D1..D11): the project modulators in the core. A modulator (slice 1: an LFO, the five shapes of the Baukasten block lfo.rs) adds an OFFSET to each of its
// targets, after the whole existing value stack (D3: base value, Stellwerk course, hand override, absolute lane, relative lane): result = clamp(stack + sum of offsets, target range).
//  - mod_planen (before bk_ueber_melden): the beat source of the block and the output at its last sample (mod_aus_, for the report of 1.5), and the device targets (task 1.4): the summed
//    offset per (track, parameter) at that sample goes to the track's sink through ArrSenke::mod_summand, which adds it after its own stack (bk knobs, RB-338 parameters) and clamps;
//  - mod_block (after auto_block): per fader/pan target the summed offset per sample, one-pole smoothed (D7), added to the course the mixer reads (Wert::vl, else Wert::w) and written into
//    the lane buffer auto_buf_ of that slot and field; Wert::vl then points there. verlaeufe_nachfuehren treats a lane buffer as "not a base value", so Wert::w stays the base and the
//    offset never accumulates. The lane state (auto_zuletzt_, auto_lane_v_, blends) is never written.
//  - the envelope follower (slice 3, D12) has no beat: mod_block hears its source track at the end of a block, and the next block plays that course (one block of latency).
// Beat (D4): while the transport plays the project beat per sample (ap_, so a loop seam is exact), otherwise the tempo-map beat k.beat_at(s0) + t * bps. A free rate (hz) runs an
// accumulator per sample that restarts at `phase` at every transport start. The modulators run while the transport stands, too. No allocation, no lock, no log; nothing at all
// without a modulator in the snapshot.
#include <algorithm>
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace {
constexpr double MOD_SR = 48000.0;
constexpr double ZWEI_PI = 6.283185307179586;

inline float mod_welle(int form, double x, int64_t n, uint32_t saat) noexcept {
  switch (form) {
    case 0: return static_cast<float>(std::sin(ZWEI_PI * x));
    case 1: return static_cast<float>(1.0 - 4.0 * std::fabs(x - 0.5));
    case 2: return static_cast<float>(2.0 * x - 1.0);
    case 3: return x < 0.5 ? 1.0f : -1.0f;
    default: return static_cast<float>(static_cast<double>(arr_mod_splitmix32(saat + static_cast<uint32_t>(n))) / 4294967296.0 * 2.0 - 1.0);
  }
}

// The smoothing coefficient of a one-pole with time constant ms at 48 kHz; 0 ms (or less) is no smoothing.
inline float mod_koeff(float ms) noexcept { return ms <= 0.0f ? 1.0f : static_cast<float>(1.0 - std::exp(-1000.0 / (static_cast<double>(ms) * MOD_SR))); }

inline float mod_klemme(int feld, float v) noexcept { return feld == ARR_AUTO_PAN ? std::clamp(v, -1.0f, 1.0f) : std::clamp(v, -200.0f, 6.0f); }

// The largest glatt_ms of the modulators routed to fader/pan buffer b of snapshot sn (the coefficient of its smoothing).
float mod_glatt_ms(const ArrSnapshot& sn, int b) noexcept {
  float g = 0.0f;
  for (int k = 0; k < sn.n_mod; ++k)
    for (int q = 0; q < sn.mod[k].n; ++q)
      if (sn.mod[k].z[q].art == 0 && sn.mod[k].z[q].puffer == b) g = std::max(g, sn.mod[k].glatt_ms);
  return g;
}
}  // namespace

uint32_t arr_mod_splitmix32(uint32_t x) noexcept {
  x += 0x9e3779b9u;
  uint32_t z = x;
  z = (z ^ (z >> 16)) * 0x85ebca6bu;
  z = (z ^ (z >> 13)) * 0xc2b2ae35u;
  return z ^ (z >> 16);
}

float arr_mod_form(int form, double beat, double takt, double phase, uint32_t saat) noexcept {
  const double u = beat / takt + phase;
  const double fl = std::floor(u);
  return mod_welle(form, u - fl, static_cast<int64_t>(fl), saat);
}

float arr_mod_versatz(float out, float tiefe, bool uni) noexcept { return uni ? tiefe * (out + 1.0f) * 0.5f : tiefe * out; }

float Arrangement::mod_wert(const ArrMod& md, int t) const {
  if (md.art == 1) {   // follower (D12): the course of the block before, held at its last value if this block is longer; no course yet = silence
    const int i = md.nr - 1, n = mod_folger_m_[i];
    return n == 0 ? -1.0f : mod_folger_[i][t < n ? t : n - 1];
  }
  if (!md.frei) {
    const double beat = t >= auto_von_ && t < auto_bis_ ? ap_[t] : mod_beat0_ + static_cast<double>(t) * mod_bps_;
    return arr_mod_form(md.form, beat, md.takt, md.phase, md.saat);
  }
  const int i = md.nr - 1;
  const double inc = md.hz / MOD_SR;
  double u;
  int64_t n0;
  if (mod_t_neu_ >= 0 && t >= mod_t_neu_) {   // the transport started inside this block: the accumulator restarts at `phase` there
    u = md.phase + static_cast<double>(t - mod_t_neu_) * inc;
    n0 = 0;
  } else {
    u = mod_frei_phase_[i] + static_cast<double>(t) * inc;
    n0 = mod_halt_[i];
  }
  const double fl = std::floor(u);
  return mod_welle(md.form, u - fl, n0 + static_cast<int64_t>(fl), md.saat);
}

void Arrangement::mod_planen(const Karte& k, int64_t s0, int m) {
  for (int i = 0; i < mod_send_n_; ++i) {   // task 4.1: the send offsets of the block before (also when this snapshot has no modulator any more)
    const int sp = mod_send_liste_[i] / ARR_RETURNS, r = mod_send_liste_[i] % ARR_RETURNS;
    mod_send_an_[sp][r] = false;
    mod_send_db_[sp][r] = 0.0f;
  }
  mod_send_n_ = 0;
  if (!snap_ || snap_->n_mod == 0) return;
  mod_s0_ = s0;
  mod_beat0_ = k.beat_at(static_cast<double>(s0));
  mod_bps_ = k.bpm_at(static_cast<double>(s0)) / 60.0 / MOD_SR;
  mod_t_neu_ = mod_start_s_ >= s0 && mod_start_s_ < s0 + m ? static_cast<int>(mod_start_s_ - s0) : -1;
  for (int k2 = 0; k2 < snap_->n_mod; ++k2) {
    const ArrMod& md = snap_->mod[k2];
    mod_aus_[md.nr - 1] = mod_wert(md, m - 1);
  }
  // Task 1.4: the device targets (art 1), once per block at the output of the last sample. One call per (track, parameter): the first routing to it sums every routing to it (D9) and
  // hands the sum on; later routings to the same pair are skipped. At most ARR_MODS * ARR_MOD_ZIELE routings, so the search stays bounded. The sink clamps after its own stack.
  const ArrSnapshot& sn = *snap_;
  for (int k2 = 0; k2 < sn.n_mod; ++k2)
    for (int q = 0; q < sn.mod[k2].n; ++q) {
      const ArrModZiel& z = sn.mod[k2].z[q];
      if (z.art != 1) continue;
      bool frueher = false;
      for (int k3 = 0; k3 <= k2 && !frueher; ++k3)
        for (int q3 = 0; q3 < (k3 == k2 ? q : sn.mod[k3].n) && !frueher; ++q3) {
          const ArrModZiel& y = sn.mod[k3].z[q3];
          frueher = y.art == 1 && y.slot == z.slot && y.param == z.param;
        }
      if (frueher) continue;
      float summe = 0.0f;
      for (int k3 = k2; k3 < sn.n_mod; ++k3)
        for (int q3 = 0; q3 < sn.mod[k3].n; ++q3) {
          const ArrModZiel& y = sn.mod[k3].z[q3];
          if (y.art == 1 && y.slot == z.slot && y.param == z.param) summe += arr_mod_versatz(mod_aus_[sn.mod[k3].nr - 1], y.tiefe, y.uni);
        }
      if (ArrSenke* se = senke_fuer(snap_, z.slot)) se->mod_summand(z.slot, z.param, summe);
    }
  // Task 4.1: the send targets (art 2), summed per (track, return) at the output of the last sample; auto_send() adds them in dB to the lane or the knob (D3, D9).
  for (int k2 = 0; k2 < sn.n_mod; ++k2)
    for (int q = 0; q < sn.mod[k2].n; ++q) {
      const ArrModZiel& z = sn.mod[k2].z[q];
      if (z.art != 2 || z.slot < 0 || z.slot >= ARR_SPUREN || z.param >= ARR_RETURNS) continue;
      if (!mod_send_an_[z.slot][z.param]) {
        if (mod_send_n_ >= ARR_MODS * ARR_MOD_ZIELE) continue;
        mod_send_liste_[mod_send_n_++] = static_cast<uint16_t>(z.slot * ARR_RETURNS + z.param);
        mod_send_an_[z.slot][z.param] = true;
      }
      mod_send_db_[z.slot][z.param] += arr_mod_versatz(mod_aus_[sn.mod[k2].nr - 1], z.tiefe, z.uni);
    }
}

// Task 4.1: the stage and macro targets (art 3, 4), once per block at the output of the last sample, after auto_kette() cleared the values of the block before and set the lanes, before
// makros_planen() and the chains read them (also the chains inside the track units). ArrInserts adds several offsets on one target (D9) and clamps after its own stack (D3).
void Arrangement::mod_ketten() {
  if (!snap_ || snap_->n_mod == 0) return;
  const ArrSnapshot& sn = *snap_;
  for (int k2 = 0; k2 < sn.n_mod; ++k2)
    for (int q = 0; q < sn.mod[k2].n; ++q) {
      const ArrModZiel& z = sn.mod[k2].z[q];
      if ((z.art != 3 && z.art != 4) || z.slot < 0 || z.slot >= ARR_KETTEN) continue;
      const float v = arr_mod_versatz(mod_aus_[sn.mod[k2].nr - 1], z.tiefe, z.uni);
      if (z.art == 3) ins_.mod_stufe(z.slot, sn.kette[z.slot], z.stufe, z.param, v);
      else if (sn.rack[z.slot].slot >= 0) ins_.mod_makro(sn.rack[z.slot].slot, z.param, v);
    }
}

void Arrangement::mod_block(int m) {
  if (!snap_ || (snap_->n_mod == 0 && mod_rest_n_ == 0)) return;
  const ArrSnapshot& sn = *snap_;
  const auto wert_von = [this](int slot, int feld) -> Wert& { return slot < ARR_SPUREN ? w_[slot][feld] : w_[ARR_RET0 + slot - ARR_SPUREN][feld]; };
  // 1. the output per sample of every modulator with a fader/pan target
  for (int k = 0; k < sn.n_mod; ++k) {
    const ArrMod& md = sn.mod[k];
    bool feld = false;
    for (int q = 0; q < md.n; ++q) feld = feld || md.z[q].art == 0;
    if (!feld) continue;
    float* kv = mod_kurve_[k];
    for (int t = 0; t < m; ++t) kv[t] = mod_wert(md, t);
  }
  // 2. per fader/pan buffer: the summed, smoothed offset on top of the course the mixer would read now
  for (int b = 0; b < sn.n_mod_felder; ++b) {
    const int slot = sn.mod_feld[b].slot, feld = sn.mod_feld[b].feld;
    struct Weg {
      const float* kurve;
      float tiefe;
      bool uni;
    } wege[ARR_MODS];
    int n_wege = 0;
    float glatt = 0.0f;
    for (int k = 0; k < sn.n_mod; ++k)
      for (int q = 0; q < sn.mod[k].n; ++q) {
        const ArrModZiel& z = sn.mod[k].z[q];
        if (z.art != 0 || z.puffer != b) continue;
        wege[n_wege++] = Weg{mod_kurve_[k], z.tiefe, z.uni};   // one routing per modulator and buffer (the reader refuses a target twice in one modulator)
        glatt = std::max(glatt, sn.mod[k].glatt_ms);
      }
    const float a = mod_koeff(glatt);
    Wert& w = wert_von(slot, feld);
    float* buf = auto_buf_[slot][feld];
    const float* quelle = w.vl;   // may be buf itself (auto_block wrote a lane there): each sample is read before it is written
    const float grund = w.w;
    float y = mod_glatt_[slot][feld];
    for (int t = 0; t < m; ++t) {
      float x = 0.0f;
      for (int r = 0; r < n_wege; ++r) x += arr_mod_versatz(wege[r].kurve[t], wege[r].tiefe, wege[r].uni);
      y += a * (x - y);
      buf[t] = mod_klemme(feld, (quelle ? quelle[t] : grund) + y);
    }
    mod_glatt_[slot][feld] = y;
    w.vl = buf;
  }
  // 3. fields whose modulators went away at a swap: the offset glides to 0, then the field is left alone
  for (int r = 0; r < mod_rest_n_;) {
    const ModRest& re = mod_rest_[r];
    Wert& w = wert_von(re.slot, re.feld);
    float* buf = auto_buf_[re.slot][re.feld];
    const float* quelle = w.vl;
    const float grund = w.w;
    float y = mod_glatt_[re.slot][re.feld];
    for (int t = 0; t < m; ++t) {
      y -= re.a * y;
      buf[t] = mod_klemme(re.feld, (quelle ? quelle[t] : grund) + y);
    }
    w.vl = buf;
    if (std::fabs(y) < 1e-6f) {
      mod_glatt_[re.slot][re.feld] = 0.0f;
      mod_rest_[r] = mod_rest_[--mod_rest_n_];
    } else {
      mod_glatt_[re.slot][re.feld] = y;
      ++r;
    }
  }
  // 4. the free phase runs on to the start of the next block (every free modulator, with or without a fader/pan target)
  for (int k = 0; k < sn.n_mod; ++k) {
    const ArrMod& md = sn.mod[k];
    if (!md.frei) continue;
    const int i = md.nr - 1;
    const double inc = md.hz / MOD_SR;
    double u;
    int64_t n0;
    if (mod_t_neu_ >= 0) {
      u = md.phase + static_cast<double>(m - mod_t_neu_) * inc;
      n0 = 0;
    } else {
      u = mod_frei_phase_[i] + static_cast<double>(m) * inc;
      n0 = mod_halt_[i];
    }
    const double fl = std::floor(u);
    mod_frei_phase_[i] = u - fl;
    mod_halt_[i] = n0 + static_cast<int64_t>(fl);
  }
  mod_folgen(m);
  mod_t_neu_ = -1;
}

// Slice 3 (D12): every follower hears the raw signal of its source track in this block: bus_l_/bus_r_ after spur_quelle (sink, clip voices, launcher), before mischen() applies
// trim, chain, PDC, monitor and fader in place. A track that did not run holds the zeros of the block start (silence). Peak follower on max(|L|, |R|) with the one-pole coefficients
// exp(-1 / (ms * 48)) of attack and release; output clamp((dBFS(env) + 60 + empfindlich_db) / 60, 0, 1), kept as 2 * out - 1 for the next block.
// A source track never runs its trim and chain inside its track unit (kette_einheit_planen keeps it out), so this is the signal before them on every path.
void Arrangement::mod_folgen(int m) {
  const ArrSnapshot& sn = *snap_;
  for (int k = 0; k < sn.n_mod; ++k) {
    const ArrMod& md = sn.mod[k];
    if (md.art != 1 || md.quelle < 0 || md.quelle >= ARR_SPUREN) continue;
    const int i = md.nr - 1;
    const float aa = static_cast<float>(std::exp(-1.0 / (static_cast<double>(md.angriff_ms) * MOD_SR / 1000.0)));
    const float ar = static_cast<float>(std::exp(-1.0 / (static_cast<double>(md.abfall_ms) * MOD_SR / 1000.0)));
    const float* l = bus_l_[md.quelle];
    const float* r = bus_r_[md.quelle];
    const float off = 60.0f + md.empfindlich_db;
    float env = mod_folger_env_[i];
    float* aus = mod_folger_[i];
    for (int t = 0; t < m; ++t) {
      const float x = std::max(std::fabs(l[t]), std::fabs(r[t]));
      const float a = x > env ? aa : ar;
      env = x + a * (env - x);
      if (!(env >= 1e-9f)) env = 0.0f;   // below -180 dBFS (and NaN): exact silence, no denormals in the callback (no FTZ there)
      const float o = env > 0.0f ? std::clamp((20.0f * std::log10(env) + off) / 60.0f, 0.0f, 1.0f) : 0.0f;
      aus[t] = 2.0f * o - 1.0f;
    }
    mod_folger_env_[i] = env;
    mod_folger_m_[i] = m;
  }
}

void Arrangement::mod_tausch(const ArrSnapshot* neu) {
  const ArrMod* md_neu[ARR_MODS] = {};
  if (neu)
    for (int k = 0; k < neu->n_mod; ++k) md_neu[neu->mod[k].nr - 1] = &neu->mod[k];
  for (int i = 0; i < ARR_MODS; ++i) {   // D11: the same nr with the same art keeps phase accumulator and random hold; any other change starts afresh
    const uint8_t art = md_neu[i] ? static_cast<uint8_t>(md_neu[i]->art + 1) : 0;
    if (art != mod_art_[i]) {
      mod_frei_phase_[i] = md_neu[i] ? md_neu[i]->phase : 0.0;
      mod_halt_[i] = 0;
      mod_aus_[i] = 0.0f;
      mod_folger_env_[i] = 0.0f;   // a follower starts from silence
      mod_folger_m_[i] = 0;
    }
    mod_art_[i] = art;
  }
  const auto im_neuen = [neu](int slot, int feld) {
    if (!neu) return false;
    for (int b = 0; b < neu->n_mod_felder; ++b)
      if (neu->mod_feld[b].slot == slot && neu->mod_feld[b].feld == feld) return true;
    return false;
  };
  for (int r = 0; r < mod_rest_n_;)   // a gliding field that the new snapshot modulates again goes on from its state in the normal path
    if (im_neuen(mod_rest_[r].slot, mod_rest_[r].feld)) mod_rest_[r] = mod_rest_[--mod_rest_n_];
    else ++r;
  if (!neu) {   // unloaded: nothing sounds any more, no offset is left to glide
    for (auto& je : mod_glatt_) je[0] = je[1] = 0.0f;
    mod_rest_n_ = 0;
    return;
  }
  if (!snap_) return;
  for (int b = 0; b < snap_->n_mod_felder; ++b) {   // a field that loses every modulator glides out with the smoothing it had
    const int slot = snap_->mod_feld[b].slot, feld = snap_->mod_feld[b].feld;
    if (im_neuen(slot, feld)) continue;
    const float a = mod_koeff(mod_glatt_ms(*snap_, b));
    if (std::fabs(mod_glatt_[slot][feld]) < 1e-6f || a >= 1.0f || mod_rest_n_ >= ARR_MOD_FELDER) {   // nothing to glide, or no smoothing asked: the offset ends here
      mod_glatt_[slot][feld] = 0.0f;
      continue;
    }
    mod_rest_[mod_rest_n_++] = ModRest{static_cast<int16_t>(slot), static_cast<uint8_t>(feld), a};
  }
}

void Arrangement::mod_beginn(int64_t s) { mod_start_s_ = s; }

}  // namespace cdj
