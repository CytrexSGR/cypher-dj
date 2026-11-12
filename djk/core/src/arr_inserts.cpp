// 1.10 slice 4a T2 / 4b T12 (arr-fx: and utility, arr-bk: and Baukasten effect graphs): pooled compressor, EQ, saturator, limiter, utility and Baukasten inserts of the arrangement strips (see arr_inserts.h for the life of a stage).
#include "cypherdj/arr_inserts.h"

#include "cypherdj/arr_arbeit.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/cypher_bk_ffi.h"

#include <cypherdj/dsp/denormal.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cdj {

ArrInserts::ArrInserts() : arbeit0_(std::make_unique<ArrArbeit>()) {
  for (int s = 0; s < ARR_INS_KOMP; ++s) komp_[s] = std::make_unique<Komp>();   // throws if the Rust side cannot build one
  for (int s = 0; s < ARR_INS_EQ; ++s) eq_[s] = std::make_unique<EqNativ>();
  for (int s = 0; s < ARR_INS_SAETT; ++s) saett_[s] = std::make_unique<SaettNativ>();
  for (int s = 0; s < ARR_INS_LIM; ++s) lim_[s] = std::make_unique<cypherdj::dsp::KanalLimiter>(INS_LIM_FS, ins_lim_einstellung());
  for (int s = 0; s < ARR_INS_UTIL; ++s) util_[s] = std::make_unique<cypherdj::dsp::Utility>(INS_LIM_FS);
  for (int& b : besitzer_) b = -1;
  for (int s = 0; s < INS_G_HOST0; ++s) {   // the native kinds; a host slot takes the latency of its stage at the swap (tausche)
    lat_[s] = ins_latenz(ins_art(s));
    if (lat_[s] < 0 || lat_[s] > INS_LAT_MAX) throw std::runtime_error("insert stage latency exceeds the dry ring");
  }
  schl_l_.assign(static_cast<size_t>(ARR_SPUREN) * INS_BLOCK, 0.0f);
  schl_r_.assign(static_cast<size_t>(ARR_SPUREN) * INS_BLOCK, 0.0f);
  key_l_.assign(static_cast<size_t>(ARR_INS_KOMP) * INS_BLOCK, 0.0f);   // slice 5 U1: one key buffer per komp slot
  key_r_.assign(static_cast<size_t>(ARR_INS_KOMP) * INS_BLOCK, 0.0f);
  ring_l_.assign(static_cast<size_t>(ARR_INS_KOMP) * ARR_SCHL_VERZ_MAX, 0.0f);   // slice 5 U2b: the key delay rings and the delayed key
  ring_r_.assign(static_cast<size_t>(ARR_INS_KOMP) * ARR_SCHL_VERZ_MAX, 0.0f);
  verz_l_.assign(static_cast<size_t>(ARR_INS_KOMP) * INS_BLOCK, 0.0f);
  verz_r_.assign(static_cast<size_t>(ARR_INS_KOMP) * INS_BLOCK, 0.0f);
}
ArrInserts::~ArrInserts() = default;

void ArrInserts::binde(int slot, int param, float vorgabe, float mn, float mx) {
  if (slot >= 0 && slot < ARR_INS_ALLE && param >= 0 && param < n_param(slot)) {
    p_[slot][param].w = vorgabe;
    mn_[slot][param] = mn;
    mx_[slot][param] = mx;
  }
}

// ---- lanes (1.12 slice 6): one value per block from Arrangement::auto_kette(), before makros_planen()
void ArrInserts::lane_stufe(int strip, const ArrKette& k, int stufe, int param, float v) {
  if (stufe < 0 || stufe >= k.n || stufe >= ARR_KETTE) return;
  const int g = ins_global(k.st[stufe].art, k.st[stufe].slot);
  if (g < 0 || besitzer_[g] != strip || param < 1 || param >= n_param(g) || (g < ARR_INS_KOMP && param == 9)) return;   // not the stage switch, not the compressor key
  if (!std::isfinite(v)) return;   // a lane never hands NaN to a module (the loader checks the points; this guards a hand-built snapshot)
  if (mn_[g][param] < mx_[g][param]) v = v < mn_[g][param] ? mn_[g][param] : (v > mx_[g][param] ? mx_[g][param] : v);
  lane_w_[g][param] = v;
  lane_[g][param] = true;
  lane_aktiv_ = true;
}
void ArrInserts::lane_makro(int rack, int nr, float v) {
  if (rack < 0 || rack >= ARR_RACKS || nr < 0 || nr >= ARR_MAKROS || !std::isfinite(v)) return;
  lane_mkw_[rack][nr] = v > 0.0f ? (v < 1.0f ? v : 1.0f) : 0.0f;
  lane_mk_[rack][nr] = true;
  lane_aktiv_ = true;
}
void ArrInserts::setze_sofort(int slot, int param, float w) {
  if (slot < 0 || slot >= ARR_INS_ALLE || param < 0 || param >= n_param(slot)) return;
  p_[slot][param].w = w;
  p_[slot][param].vl = nullptr;
#ifdef CYPHERDJ_MUTATION_MAKRO_ROW_GEWINNT
  p_[slot][param].geschrieben = true;
#endif
}
void ArrInserts::verlauf(int slot, int param, const float* werte) {
  if (slot < 0 || slot >= ARR_INS_ALLE || param < 0 || param >= n_param(slot) || !werte) return;
  p_[slot][param].vl = werte;
}
void ArrInserts::nachfuehren(int m) {
  for (int k = 0; k < ARR_RACKS; ++k)
    for (int n = 0; n < ARR_MAKROS; ++n) {
      Wert& w = mk_[k][n];
      if (w.vl) {
        w.w = w.vl[m - 1];
        w.vl = nullptr;
      }
    }
  for (int s = 0; s < ARR_INS_ALLE; ++s)
    for (int k = 0; k < n_param(s); ++k) {
      Wert& w = p_[s][k];
      if (w.vl) {
        w.w = w.vl[m - 1];
        w.vl = nullptr;
      }
    }
}

// ---- rack macros (slice 4c T15, spec D13)
void ArrInserts::makro_binde(int rack, int nr, float vorgabe) {
  if (rack >= 0 && rack < ARR_RACKS && nr >= 0 && nr < ARR_MAKROS) mk_[rack][nr].w = vorgabe;
}
void ArrInserts::makro_sofort(int rack, int nr, float w) {
  if (rack < 0 || rack >= ARR_RACKS || nr < 0 || nr >= ARR_MAKROS) return;
  mk_[rack][nr].w = w;
  mk_[rack][nr].vl = nullptr;
}
void ArrInserts::makro_verlauf(int rack, int nr, const float* werte) {
  if (rack < 0 || rack >= ARR_RACKS || nr < 0 || nr >= ARR_MAKROS || !werte) return;
  mk_[rack][nr].vl = werte;
}

float ArrInserts::makro_wert(int rack, int nr, int m) const noexcept {
  if (rack < 0 || rack >= ARR_RACKS || nr < 0 || nr >= ARR_MAKROS || m < 1) return 0.0f;
  if (lane_mk_[rack][nr]) return lane_mkw_[rack][nr];   // 1.12 slice 6: a lane drives the macro in this block (already clamped)
  const Wert& w = mk_[rack][nr];
  const float mv = w.vl ? w.vl[m - 1] : w.w;
  return mv > 0.0f ? (mv < 1.0f ? mv : 1.0f) : 0.0f;   // a NaN reads as 0, as in makros_planen()
}

// Once per block, before any parameter is read: every mapping of every strip with a rack turns its macro (the value at the end of the block, like every parameter) into
// `von + m * (bis - von)` for the parameter of the stage. A strip without a rack costs nothing; entries of the block before are cleared once when nothing maps any more.
void ArrInserts::makros_planen(const ArrKette* ketten, const ArrRack* racks, int m) {
#ifndef CYPHERDJ_MUTATION_MAKRO_BLEIBT
  if (ueber_aktiv_) {   // error case (mutation): the entries of a rack that has gone stay
    std::memset(ueber_, 0, sizeof ueber_);
    ueber_aktiv_ = false;
  }
#endif
  if (!ketten || !racks) return;
  for (int st = 0; st < ARR_KETTEN; ++st) {
    const ArrRack& r = racks[st];
    if (r.slot < 0 || r.slot >= ARR_RACKS || r.n == 0) continue;
    const ArrKette& k = ketten[st];
    for (int i = 0; i < r.n && i < ARR_MAKRO_ZIELE; ++i) {
      const ArrMakroZiel& z = r.z[i];
      if (z.makro >= ARR_MAKROS || z.stufe >= k.n || z.stufe >= ARR_KETTE) continue;
      const int g = ins_global(k.st[z.stufe].art, k.st[z.stufe].slot);
      if (g < 0 || besitzer_[g] != st || z.param >= n_param(g)) continue;
      const Wert& w = mk_[r.slot][z.makro];
      float mv = lane_mk_[r.slot][z.makro] ? lane_mkw_[r.slot][z.makro] : (w.vl ? w.vl[m - 1] : w.w);   // 1.12 slice 6: a lane on the macro replaces the macro row
#ifdef CYPHERDJ_MUTATION_MAKRO_SPAET
      { const float jetzt = mv; mv = mk_alt_[r.slot][z.makro]; mk_alt_[r.slot][z.makro] = jetzt; }   // error case: the move acts one block late (the value of the block before)
#endif
      mv = mv > 0.0f ? (mv < 1.0f ? mv : 1.0f) : 0.0f;   // a NaN reads as 0
#ifdef CYPHERDJ_MUTATION_MAKRO_VERTAUSCHT
      ueber_w_[g][z.param] = z.bis + mv * (z.von - z.bis);   // error case: von and bis swapped
#else
      ueber_w_[g][z.param] = z.von + mv * (z.bis - z.von);
#endif
      ueber_[g][z.param] = true;
      ueber_aktiv_ = true;
    }
  }
}

// a key the stage can listen to (the loader has checked the table; a snapshot built by hand with something else simply has no structural key)
static bool struktureller_schluessel(const ArrSchluessel& k) {
  switch (k.quelle) {
    case ARR_SCHL_SPUR: return k.punkt == ARR_SCHL_POST && k.nr >= 1 && k.nr <= ARR_SPUREN;
    case ARR_SCHL_GRP: return k.nr >= 1 && k.nr <= ARR_GRUPPEN;
    case ARR_SCHL_RET: return k.nr >= 1 && k.nr <= ARR_RETURNS;
    case ARR_SCHL_DECK: return k.nr >= 1 && k.nr <= 4;   // slice 5 U2b: the DJ inputs deck/1..4 and erz/1
    case ARR_SCHL_ERZ: return k.nr == 1;
    default: return false;
  }
}

void ArrInserts::schluessel_planen(int m) {
  schl_maske_ = 0;
  strukt_n_ = 0;
  for (int s = 0; s < ARR_INS_KOMP; ++s) {
    sc_[s] = 0;
    strukt_[s] = false;
    if (besitzer_[s] < 0) continue;
#ifndef CYPHERDJ_MUTATION_SC_STRUKTUR_IGNORIERT   // error case: a structural key is ignored, the row path (sc = 0: the stage's own signal) is used
    if (struktureller_schluessel(skey_[s])) {
      strukt_[s] = true;   // a structural key wins over the row sc (plan E8: a stage carries at most one of the two; the server keeps the row at 0)
      ++strukt_n_;
#ifndef CYPHERDJ_MUTATION_SC_KEIN_NULLEN   // error case: the buffer keeps the samples of the block before when the capture point does not run
      std::memset(&key_l_[static_cast<size_t>(s) * INS_BLOCK], 0, sizeof(float) * static_cast<size_t>(m));
      std::memset(&key_r_[static_cast<size_t>(s) * INS_BLOCK], 0, sizeof(float) * static_cast<size_t>(m));
#endif
      continue;
    }
#endif
    const long n = std::lround(eff(s, 9, m));
    if (n >= 1 && n <= ARR_SPUREN) {
      sc_[s] = static_cast<int>(n);
      schl_maske_ |= uint64_t{1} << (n - 1);
    }
  }
}
void ArrInserts::schluessel_sichern(int spur, const float* l, const float* r, int m) {
  if (spur < 0 || spur >= ARR_SPUREN || m > INS_BLOCK) return;
  std::memcpy(&schl_l_[static_cast<size_t>(spur) * INS_BLOCK], l, sizeof(float) * static_cast<size_t>(m));
  std::memcpy(&schl_r_[static_cast<size_t>(spur) * INS_BLOCK], r, sizeof(float) * static_cast<size_t>(m));
#ifndef CYPHERDJ_MUTATION_INS_SC_NAN_DURCHLASS
  // A non-finite key sample would poison the detector high-pass state (schp > 0) for good; the stage output guard does not see it.
  // The key is silenced at those samples and the block is counted like a NaN block of a stage output.
  bool unrein = false;
  float* kl = &schl_l_[static_cast<size_t>(spur) * INS_BLOCK];
  float* kr = &schl_r_[static_cast<size_t>(spur) * INS_BLOCK];
  for (int t = 0; t < m; ++t) {
    if (!std::isfinite(kl[t])) { kl[t] = 0.0f; unrein = true; }
    if (!std::isfinite(kr[t])) { kr[t] = 0.0f; unrein = true; }
  }
  if (unrein) ++nan_;
#endif
}

int ArrInserts::ziele(uint8_t quelle, uint8_t punkt, int nr, float** l, float** r) {
  int n = 0;
  if (strukt_n_ == 0) return 0;
  for (int s = 0; s < ARR_INS_KOMP; ++s)
    if (strukt_[s] && skey_[s].quelle == quelle && skey_[s].punkt == punkt && skey_[s].nr == nr) {
      l[n] = &key_l_[static_cast<size_t>(s) * INS_BLOCK];
      r[n] = &key_r_[static_cast<size_t>(s) * INS_BLOCK];
      ++n;
    }
  return n;
}
void ArrInserts::fertig(uint8_t quelle, uint8_t punkt, int nr, int m) {
  if (strukt_n_ == 0) return;
  bool unrein = false;
  for (int s = 0; s < ARR_INS_KOMP; ++s) {
    if (!strukt_[s] || skey_[s].quelle != quelle || skey_[s].punkt != punkt || skey_[s].nr != nr) continue;
    float* kl = &key_l_[static_cast<size_t>(s) * INS_BLOCK];
    float* kr = &key_r_[static_cast<size_t>(s) * INS_BLOCK];
    for (int t = 0; t < m; ++t) {   // a non-finite key sample would poison the detector for good (see schluessel_sichern)
      if (!std::isfinite(kl[t])) { kl[t] = 0.0f; unrein = true; }
      if (!std::isfinite(kr[t])) { kr[t] = 0.0f; unrein = true; }
    }
  }
  if (unrein) ++nan_;
}
void ArrInserts::kopiere(uint8_t quelle, uint8_t punkt, int nr, const float* l, const float* r, int m) {
  float* zl[ARR_INS_KOMP];
  float* zr[ARR_INS_KOMP];
  const int n = ziele(quelle, punkt, nr, zl, zr);
  if (n == 0) return;
  for (int q = 0; q < n; ++q) {
    std::memcpy(zl[q], l, sizeof(float) * static_cast<size_t>(m));
    std::memcpy(zr[q], r, sizeof(float) * static_cast<size_t>(m));
  }
  fertig(quelle, punkt, nr, m);
}

void ArrInserts::ring_leere(int s) {
  if (s >= ARR_INS_KOMP || !ring_voll_[s]) return;
  std::memset(&ring_l_[static_cast<size_t>(s) * ARR_SCHL_VERZ_MAX], 0, sizeof(float) * ARR_SCHL_VERZ_MAX);
  std::memset(&ring_r_[static_cast<size_t>(s) * ARR_SCHL_VERZ_MAX], 0, sizeof(float) * ARR_SCHL_VERZ_MAX);
  ring_p_[s] = 0;
  ring_voll_[s] = false;
}

void ArrInserts::leere(int s) {
  ring_leere(s);   // slice 5 U2b: a cleared stage starts with a clean key history
  if (s < ARR_INS_KOMP) komp_[s]->leeren();
  else if (s < INS_G_SAETT0) eq_[s - ARR_INS_KOMP]->leeren();
  else if (s < INS_G_LIM0) saett_[s - INS_G_SAETT0]->leeren();
  else if (s < INS_G_UTIL0) lim_[s - INS_G_LIM0]->leeren();
  else if (s < INS_G_BK0) util_[s - INS_G_UTIL0]->leeren();
  else if (s < INS_G_HOST0) {   // arr-bk slice 3: the instance starts from the beginning (phases, envelopes, delay lines); the knobs stay
    if (CypherBk* h = bk_[s - INS_G_BK0].h) cypher_bk_zuruecksetzen(h);
  } else host_.leere(s - INS_G_HOST0 + 1);
  gr_[s] = 0.0f;
  lief_[s] = false;
}

// The dry ring of a stage with latency holds the last lat_ input samples. Every block the stage is asked for pushes its input; the output of a bypassed stage, a
// stage that is fully off and a tail is this delayed signal, so the path keeps its length (D10).
void ArrInserts::trocken_speise(int s, const float* l, const float* r, int m, float* aus_l, float* aus_r) {
  const int n = lat_[s];
  float* rl = tl_[s];
  float* rr = tr_[s];
  int p = tp_[s];
  for (int t = 0; t < m; ++t) {
    const float xl = l[t], xr = r[t];
    if (aus_l) {
      aus_l[t] = rl[p];
      aus_r[t] = rr[p];
    }
    rl[p] = xl;
    rr[p] = xr;
    if (++p == n) p = 0;
  }
  tp_[s] = p;
}
void ArrInserts::trocken_leere(int s) {
  if (s >= INS_G_HOST0) {   // plan 1.11: the dry ring of a host stage is the host module's
    host_.trocken_leere(s - INS_G_HOST0 + 1, lat_[s]);
    return;
  }
  std::memset(tl_[s], 0, sizeof tl_[s]);
  std::memset(tr_[s], 0, sizeof tr_[s]);
  tp_[s] = 0;
}

void ArrInserts::tausche(const ArrKette* ketten) {
  int anspruch[ARR_INS_ALLE];
  ArrSchluessel neu_key[ARR_INS_KOMP];
  int neu_vs[ARR_INS_KOMP] = {}, neu_vz[ARR_INS_KOMP] = {}, neu_sp[ARR_INS_KOMP] = {};
  int neu_lat[ARR_INS_ALLE] = {};   // plan 1.11: the latency of the host stages of the new snapshot (arr-bk: and of the Baukasten stages)
  CypherBk* neu_bk[ARR_INS_BK] = {};   // arr-bk slice 3: the instance of each Baukasten stage of the new snapshot
  uint64_t neu_bk_gen[ARR_INS_BK] = {};
  for (int& a : anspruch) a = -1;
  if (ketten)
    for (int st = 0; st < ARR_KETTEN; ++st)
      for (int j = 0; j < ketten[st].n && j < ARR_KETTE; ++j) {
        const ArrStufe& x = ketten[st].st[j];
        const int g = ins_global(x.art, x.slot);
        if (g >= 0) anspruch[g] = st;
        if (g >= INS_G_HOST0) neu_lat[g] = x.latenz;
        if (g >= INS_G_BK0 && g < INS_G_HOST0) {
          neu_lat[g] = x.latenz;
          neu_bk[g - INS_G_BK0] = x.bk;
          neu_bk_gen[g - INS_G_BK0] = x.bk_gen;
        }
        if (g >= 0 && g < ARR_INS_KOMP) {
          neu_key[g] = x.key;
          neu_vs[g] = x.schl_verz;
          neu_vz[g] = x.schl_verz_zeile;
          neu_sp[g] = x.schl_spaet;
        }
      }
  // plan 1.11 (fix round 3): ONE host process serves one strip at a time. A host slot whose owner strip is another one in the new snapshot, while the slot is still active or in its tail, is a removal
  // only: the old owner leaves with its normal exit tail, the new owner's stage is not taken over (it stays out, the strip plays its undelayed input) until a later load claims the slot again after the
  // tail has ended. A move must therefore be a removal in one load and an entry in a later load at least latenz + HOST_BLENDE samples apart (contract rule for the server, T7; INTERFACES 4.11).
#ifndef CYPHERDJ_MUTATION_HOST_VERSCHIEBUNG_HART   // error case: the slot moves strips inside one swap, the tail of the old owner is cut (a click)
  for (int s = INS_G_HOST0; s < ARR_INS_ALLE; ++s)
    if (anspruch[s] >= 0 && besitzer_[s] >= 0 && besitzer_[s] != anspruch[s]) anspruch[s] = -1;
#endif
  maske_ = 0;
  for (int s = 0; s < ARR_INS_ALLE; ++s) {
    if (anspruch[s] >= 0) {
      if (s < ARR_INS_KOMP) {
        const bool gleich = skey_[s].quelle == neu_key[s].quelle && skey_[s].nr == neu_key[s].nr && skey_[s].punkt == neu_key[s].punkt && verz_s_[s] == neu_vs[s] && verz_z_[s] == neu_vz[s];
        if (!gleich) ring_leere(s);   // another key or another delay: the history of the old one does not belong to the new
        skey_[s] = neu_key[s];
        verz_s_[s] = neu_vs[s];
        verz_z_[s] = neu_vz[s];
        spaet_[s] = neu_sp[s];
      }
      if (s >= INS_G_HOST0) lat_[s] = std::min<int>(neu_lat[s], ARR_HOST_LAT_MAX - 1);   // a host stage's latency is structure: taken over with the snapshot (a tail keeps the one it had)
      if (s >= INS_G_BK0 && s < INS_G_HOST0) {   // arr-bk slice 3: the instance and its latency are structure of the snapshot (the loader measured it, at most INS_LAT_MAX)
        const int nl = std::min<int>(neu_lat[s], INS_LAT_MAX);
        const bool neuer = besitzer_[s] != anspruch[s];
        BkSlot& b = bk_[s - INS_G_BK0];
        if (!neuer && (neu_bk[s - INS_G_BK0] != b.h || neu_bk_gen[s - INS_G_BK0] != b.gen)) {   // the same owner, another instance: the old one fades out in the next block
          b.alt = b.h;
          b.blende.store(b.alt, std::memory_order_release);   // published before aktiv is overwritten: the loader never sees the old instance unprotected
          b.h = neu_bk[s - INS_G_BK0];
          b.gen = neu_bk_gen[s - INS_G_BK0];
          b.aktiv.store(b.h, std::memory_order_release);
          if (b.h) cypher_bk_zuruecksetzen(b.h);   // a shared instance may carry state of an earlier use
          gesetzt_[s] = false;   // the knobs jump to their values on the new instance
          if (nl != lat_[s]) trocken_leere(s);
        } else if (neuer) {   // a new owner: a tail of the old one is cut (the stage starts cleared below)
          b.alt = nullptr;
          b.blende.store(nullptr, std::memory_order_release);
          b.h = neu_bk[s - INS_G_BK0];
          b.gen = neu_bk_gen[s - INS_G_BK0];
          b.aktiv.store(b.h, std::memory_order_release);
          gesetzt_[s] = false;
        }
        lat_[s] = nl;
      }
      if (besitzer_[s] != anspruch[s]) {   // a new owner: a tail of the old one is cut, the new stage starts cleared and fades in
        leere(s);
        trocken_leere(s);
        pos_[s] = s >= INS_G_HOST0 ? INS_BLENDE : 0;   // a host stage has no outer blend: its own entry/exit blend (ArrHostStufe) keeps the strip playing; pos_ > 0 keeps it a tail when it leaves
        besitzer_[s] = anspruch[s];
      }
#ifdef CYPHERDJ_MUTATION_INS_TAUSCH_LEERT
      else leere(s);   // error case: the state is cleared on every swap
#endif
      in_kette_[s] = true;
      maske_ |= uint64_t{1} << anspruch[s];
    } else {
      in_kette_[s] = false;
      if (besitzer_[s] >= 0 && pos_[s] > 0) {   // leaves the chain: a tail on its former strip
        maske_ |= uint64_t{1} << besitzer_[s];
      } else {
        if (lief_[s]) leere(s);
        besitzer_[s] = -1;
        pos_[s] = 0;
        bk_besitz_frei(s);
      }
    }
  }
  spiegel_neu();
}

void ArrInserts::ruhe() {
  lanen_loeschen();   // 1.12 slice 6: nothing plays, no lane drives a parameter
  for (ArrSchluessel& k : skey_) k = ArrSchluessel{};
  for (int s = 0; s < ARR_INS_KOMP; ++s) {
    ring_leere(s);
    verz_s_[s] = verz_z_[s] = spaet_[s] = 0;
  }
  for (int s = 0; s < ARR_INS_ALLE; ++s) {
    if (lief_[s]) leere(s);
    trocken_leere(s);
    besitzer_[s] = -1;
    in_kette_[s] = false;
    pos_[s] = 0;
    bk_besitz_frei(s);
  }
  maske_ = 0;
  spiegel_neu();
}

// arr-bk slice 3: the slot has no owner any more (tail ended, stage removed, rest): the instance is not ours any more, so it is unpublished and the loader may free it.
void ArrInserts::bk_besitz_frei(int s) {
  if (s < INS_G_BK0 || s >= INS_G_HOST0) return;
  BkSlot& b = bk_[s - INS_G_BK0];
  b.h = nullptr;
  b.gen = 0;
  b.alt = nullptr;
  b.blende.store(nullptr, std::memory_order_release);
  b.aktiv.store(nullptr, std::memory_order_release);
  gesetzt_[s] = false;
}

bool ArrInserts::nutzt(const CypherBk* h) const noexcept {
  if (!h) return false;
  for (const BkSlot& b : bk_)   // aktiv first, blende second: tausche() publishes blende before it overwrites aktiv
    if (b.aktiv.load(std::memory_order_acquire) == h || b.blende.load(std::memory_order_acquire) == h) return true;
  return false;
}

// Gives the parameter set of a slot to its module when a value changed since the last block (the first block always).
void ArrInserts::setze_dsp(int s, int m) {
  const int n = s < ARR_INS_KOMP ? 9 : n_param(s);   // komp: the key (index 9) is not a module setting; the values 1 .. n - 1 are
  float e[INS_PARAM_MAX];
  for (int k = 1; k < n; ++k) e[k] = eff(s, k, m);
  const bool neu = !gesetzt_[s];
  if (!neu && std::memcmp(e + 1, angewandt_[s] + 1, sizeof(float) * static_cast<size_t>(n - 1)) == 0) return;
  if (s < ARR_INS_KOMP) {
    komp_[s]->setze(CypherKompEinstellung{e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8]});
  } else if (s < INS_G_SAETT0) {
    EqNativ& q = *eq_[s - ARR_INS_KOMP];
    const float* alt = angewandt_[s];
    if (neu || e[1] != alt[1] || e[2] != alt[2]) q.setze_global(e[2] >= 0.5f, static_cast<double>(e[1]));
    for (int b = 0; b < 8; ++b) {
      const int o = 3 + b * INS_EQ_BAND_PARAM;
      if (!neu && std::memcmp(e + o, alt + o, sizeof(float) * INS_EQ_BAND_PARAM) == 0) continue;   // setze_band only for a band that changed
      q.setze_band(b, CypherEqBand{static_cast<double>(e[o + 2]), static_cast<double>(e[o + 3]), static_cast<double>(e[o + 4]),
                                      static_cast<uint8_t>(e[o] >= 0.5f ? 1 : 0), static_cast<uint8_t>(std::lround(e[o + 1])),
                                      static_cast<uint8_t>(std::lround(e[o + 5])), static_cast<uint8_t>(std::lround(e[o + 6]))});
    }
  } else if (s < INS_G_LIM0) {
#ifdef CYPHERDJ_MUTATION_INS_SAETT_AUS_NACH_DRIVE
    saett_[s - INS_G_SAETT0]->setze(static_cast<double>(e[2]), static_cast<double>(e[1]), static_cast<double>(e[3]));   // error case: drive and output gain swapped
#else
    saett_[s - INS_G_SAETT0]->setze(static_cast<double>(e[1]), static_cast<double>(e[2]), static_cast<double>(e[3]));
#endif
  } else if (s >= INS_G_HOST0) {
    // plan 1.11: a host stage has no setting to give (the row an is read by the chain); it must never fall into the limiter branch below
  } else if (s >= INS_G_BK0) {   // arr-bk slice 3: the knobs k1..k64 (rows 1..64) go to the instance; the first application (also after a take-over) jumps, later changes are smoothed over 20 ms by the instance
    if (CypherBk* h = bk_[s - INS_G_BK0].h)
      for (int k = 1; k <= BK_KNOEPFE; ++k) {
        if (neu) cypher_bk_regler_sofort(h, static_cast<uint32_t>(k), e[k]);
        else if (e[k] != angewandt_[s][k]) cypher_bk_regler(h, static_cast<uint32_t>(k), e[k]);
      }
  } else if (s >= INS_G_UTIL0) {
#ifdef CYPHERDJ_MUTATION_INS_UTIL_BREITE_FEST
    cypherdj::dsp::UtilityParameter p = util_einstellung(e);   // error case: the stage ignores the breite row and keeps the width at 100 %
    p.breite_prozent = 100.0f;
    util_[s - INS_G_UTIL0]->setze(p);
#else
    util_[s - INS_G_UTIL0]->setze(util_einstellung(e));   // arr-fx slice 1: the module ramps a changed matrix over 10 ms itself
#endif
  } else {
    cypherdj::dsp::KanalLimiter& q = *lim_[s - INS_G_LIM0];
#ifdef CYPHERDJ_MUTATION_INS_LIM_DECKE_FEST
    q.setze_decke_db(-1.0f);   // error case: the stage ignores the decke row and stays at the default ceiling
#else
    q.setze_decke_db(e[1]);
#endif
    q.setze_abklingen_ms(e[2]);
  }
  std::memcpy(angewandt_[s] + 1, e + 1, sizeof(float) * static_cast<size_t>(n - 1));
  gesetzt_[s] = true;
}

void ArrInserts::rechne(int s, float* l, float* r, int m, bool ziel_an, float* tl, float* tr, ArrArbeit* a) {
  if (s >= INS_G_HOST0) {   // plan 1.11: the host stage (its own latency, its own dry ring)
    const int h = s - INS_G_HOST0 + 1;
    host_.block(h, l, r, l, r, m, lat_[s], ziel_an, host_.gesund(h), tl, tr, in_kette_[s]);
    return;
  }
  if (s < ARR_INS_KOMP) {
    const float* kl = nullptr;
    const float* kr = nullptr;
    int verz = 0;
    if (strukt_[s]) {   // slice 5 U1: the detector listens to the key buffer of the slot (filled at the capture point of the source before this stage ran)
      const size_t o = static_cast<size_t>(s) * INS_BLOCK;
      kl = &key_l_[o];
      kr = &key_r_[o];
      verz = verz_s_[s];
    }
#ifndef CYPHERDJ_MUTATION_INS_SC_IGNORIERT
    else if (sc_[s] > 0) {   // the detector listens to the key track's input (copied before the chains ran)
      const size_t o = static_cast<size_t>(sc_[s] - 1) * INS_BLOCK;
      kl = &schl_l_[o];
      kr = &schl_r_[o];
      verz = verz_z_[s];
    }
#endif
    if (!kl) {
      ring_leere(s);   // the stage runs on its own signal: no key history
      komp_[s]->block(l, r, m);
      return;
    }
#ifdef CYPHERDJ_MUTATION_SC_KEIN_VERSATZ
    verz = 0;   // error case: no key ring, the key meets the stage input as the capture point left it
#endif
    if (verz > 0) {   // slice 5 U2b (E9): the key is earlier than the stage input; it goes through the ring of the slot and comes out `verz` samples later
      const size_t ro = static_cast<size_t>(s) * ARR_SCHL_VERZ_MAX;
      float* rl = &ring_l_[ro];
      float* rr = &ring_r_[ro];
      float* dl = &verz_l_[static_cast<size_t>(s) * INS_BLOCK];
      float* dr = &verz_r_[static_cast<size_t>(s) * INS_BLOCK];
      constexpr int MASKE = ARR_SCHL_VERZ_MAX - 1;
      int p = ring_p_[s];
      for (int t = 0; t < m; ++t) {
        rl[p] = kl[t];
        rr[p] = kr[t];
        const int q = (p - verz) & MASKE;
        dl[t] = rl[q];
        dr[t] = rr[q];
        p = (p + 1) & MASKE;
      }
      ring_p_[s] = p;
      ring_voll_[s] = true;
      kl = dl;
      kr = dr;
    }
    komp_[s]->block_sc(l, r, kl, kr, m);
  } else if (s < INS_G_SAETT0) {
    eq_[s - ARR_INS_KOMP]->block(l, r, m);
  } else if (s < INS_G_LIM0) {
    saett_[s - INS_G_SAETT0]->block(l, r, m);
  } else if (s < INS_G_UTIL0) {
    static_assert(INS_BLOCK <= cypherdj::dsp::kMaxFrames, "the limiter takes a whole block in one call");
    lim_[s - INS_G_LIM0]->verarbeite(l, r, l, r, m);   // in place
  } else if (s < INS_G_BK0) {
    static_assert(INS_BLOCK <= cypherdj::dsp::kMaxFrames, "the utility takes a whole block in one call");
    util_[s - INS_G_UTIL0]->verarbeite(l, r, l, r, m);   // in place
  } else if (a) {
    rechne_bk(s, l, r, m, *a);
  }
}

// arr-bk slice 3: one block of the Baukasten effect graph of slot s, in place from the caller's point of view. cypher_bk_effekt takes separate input and output, so the graph writes into the
// scratch of the lane and the result is copied back. A changed instance (tausche() set `alt`) is rendered too, on the same input, and the two outputs are crossfaded linearly over this block;
// the old instance is then reset and unpublished. The output is clamped to INS_BK_AUS_MAX (a non-finite sample is left to the guard in stufe(), which silences the block and counts it).
void ArrInserts::rechne_bk(int s, float* l, float* r, int m, ArrArbeit& a) {
  BkSlot& b = bk_[s - INS_G_BK0];
  if (!b.h || m <= 0 || m > INS_BLOCK) return;   // no instance (a hand-built snapshot): the stage passes the signal through
  float* const nl = a.bke_l[0];
  float* const nr = a.bke_r[0];
  cypherdj::dsp::DenormalSchutz schutz;
  cypher_bk_takt(b.h, takt_beat0_, takt_bps_);
  if (cypher_bk_effekt(b.h, l, r, nl, nr, static_cast<size_t>(m)) != 0) ++a.nan_zaehler;   // a panic inside gives silence, a reset and rc -1: the output is zeros, the event is counted
  if (b.alt) {
    float* const ol = a.bke_l[1];
    float* const orr = a.bke_r[1];
    cypher_bk_takt(b.alt, takt_beat0_, takt_bps_);
    cypher_bk_effekt(b.alt, l, r, ol, orr, static_cast<size_t>(m));
    for (int t = 0; t < m; ++t) {
#ifdef CYPHERDJ_MUTATION_INS_BK_WECHSEL_HART
      const float g = 0.0f;   // error case: the old instance is cut at the first sample of the block (a step)
#else
      const float g = static_cast<float>(m - 1 - t) / static_cast<float>(m);
#endif
      nl[t] += g * (ol[t] - nl[t]);
      nr[t] += g * (orr[t] - nr[t]);
    }
    cypher_bk_zuruecksetzen(b.alt);   // a later take-over of the same instance (an undo) starts clean
    b.alt = nullptr;
    b.blende.store(nullptr, std::memory_order_release);
  }
  for (int t = 0; t < m; ++t) {
    l[t] = std::isfinite(nl[t]) ? std::clamp(nl[t], -INS_BK_AUS_MAX, INS_BK_AUS_MAX) : nl[t];
    r[t] = std::isfinite(nr[t]) ? std::clamp(nr[t], -INS_BK_AUS_MAX, INS_BK_AUS_MAX) : nr[t];
  }
}

void ArrInserts::spiegel_neu() {
  for (uint64_t& e : slot_eigen_) e = 0;
  for (int s = 0; s < ARR_INS_ALLE; ++s)
    if (besitzer_[s] >= 0 && besitzer_[s] < ARR_KETTEN) slot_eigen_[besitzer_[s]] |= uint64_t{1} << s;
}

// One stage over m samples in place. ziel_an: the stage should run (project flag and row an). Scratch and NaN count come from the lane `a`.
void ArrInserts::stufe(int s, bool ziel_an, float* l, float* r, int m, ArrArbeit& a) {
#ifdef CYPHERDJ_MUTATION_SPUR_DRY_GEMEINSAM
  float* const dry_l = arbeit0_->dry_l;   // error case: the dry scratch ignores the lane, every lane blends against the lane-0 buffer
  float* const dry_r = arbeit0_->dry_r;
#else
  float* const dry_l = a.dry_l;
  float* const dry_r = a.dry_r;
#endif
  const int ziel = ziel_an ? INS_BLENDE : 0;
  const bool host = s >= INS_G_HOST0;   // plan 1.11: the host stage keeps its own dry ring (ArrHostStufe) and gives the delayed dry signal back; tl_/tr_ are for the native kinds
  const bool lat = lat_[s] > 0 && !host;
  if (host) {   // plan 1.11 (fix round 2): the host stage does everything itself in one pass: return against delayed dry (an, health), and the entry/exit blend against the undelayed input
    rechne(s, l, r, m, ziel_an, nullptr, nullptr);
#ifndef CYPHERDJ_MUTATION_INS_NAN_DURCHLASS
    bool endlich = true;
    for (int t = 0; t < m; ++t) endlich = endlich && std::isfinite(l[t]) && std::isfinite(r[t]);
    if (!endlich) {   // NaN or Inf: this block of the strip is silent, the stage is cleared, counted
      std::memset(l, 0, sizeof(float) * static_cast<size_t>(m));
      std::memset(r, 0, sizeof(float) * static_cast<size_t>(m));
      leere(s);
      trocken_leere(s);
      lief_[s] = true;
      ++a.nan_zaehler;
      return;
    }
#endif
    lief_[s] = true;
    gr_[s] = 0.0f;
    if (!in_kette_[s] && host_.ruhig(s - INS_G_HOST0 + 1)) pos_[s] = 0;   // a tail ends when the blends have run out
    return;
  }
  if (pos_[s] == 0 && ziel == 0) {   // fully off: not computed, state cleared; the signal still passes the latency of the stage
    if (lief_[s]) leere(s);
#ifndef CYPHERDJ_MUTATION_INS_BYPASS_OHNE_LATENZ
    if (lat) trocken_speise(s, l, r, m, l, r);
#endif
    return;
  }
  setze_dsp(s, m);
#ifdef CYPHERDJ_MUTATION_INS_BYPASS_SPRUNG
  if (in_kette_[s]) pos_[s] = ziel;   // error case: no blend on the bypass of a stage in the chain, the weight jumps (the tail of a removed stage still fades)
#endif
  const bool fest = pos_[s] == INS_BLENDE && ziel == INS_BLENDE;
  {
    if (lat) {
      // dry_ = the input delayed by the latency of the stage (the ring is fed with the input, also when the stage is fully on and the dry signal is not read)
      if (!fest) trocken_speise(s, l, r, m, dry_l, dry_r);
      else trocken_speise(s, l, r, m, nullptr, nullptr);
    } else if (!fest) {
      std::memcpy(dry_l, l, sizeof(float) * static_cast<size_t>(m));
      std::memcpy(dry_r, r, sizeof(float) * static_cast<size_t>(m));
    }
    rechne(s, l, r, m, true, nullptr, nullptr, &a);
  }
  if (!fest) {
    int pos = pos_[s];
    for (int t = 0; t < m; ++t) {
      if (pos < ziel) ++pos;
      else if (pos > ziel) --pos;
      const float w = pos == INS_BLENDE ? 1.0f : static_cast<float>(pos) * (1.0f / static_cast<float>(INS_BLENDE));
      l[t] = dry_l[t] + w * (l[t] - dry_l[t]);
      r[t] = dry_r[t] + w * (r[t] - dry_r[t]);
    }
    pos_[s] = pos;
  }
#ifndef CYPHERDJ_MUTATION_INS_NAN_DURCHLASS
  bool endlich = true;
  for (int t = 0; t < m; ++t) endlich = endlich && std::isfinite(l[t]) && std::isfinite(r[t]);
  if (!endlich) {   // NaN or Inf: this block of the strip is silent, the stage is cleared, counted (pattern of ArrReturns)
#ifdef CYPHERDJ_MUTATION_INS_NAN_NUR_PROBEN
    for (int t = 0; t < m; ++t) {   // error case: only the non-finite samples are zeroed, the rest of the block plays
      if (!std::isfinite(l[t])) l[t] = 0.0f;
      if (!std::isfinite(r[t])) r[t] = 0.0f;
    }
#else
    std::memset(l, 0, sizeof(float) * static_cast<size_t>(m));
    std::memset(r, 0, sizeof(float) * static_cast<size_t>(m));
#endif
    leere(s);
    trocken_leere(s);
    lief_[s] = true;
    ++a.nan_zaehler;
    return;
  }
#endif
  lief_[s] = true;
  if (s < ARR_INS_KOMP) {
#ifdef CYPHERDJ_MUTATION_INS_MIX0_GR_STEHT
    gr_[s] = komp_[s]->gr_db();   // error case: Komp returns early at mix 0, its last reduction stays on the display
#else
    gr_[s] = angewandt_[s][7] <= 0.0f ? 0.0f : komp_[s]->gr_db();   // mix 0: the Komp does not compute (lib.rs Komp::block), nothing is applied, so nothing is shown
#endif
  } else if (s >= INS_G_LIM0 && s < INS_G_UTIL0) {
    gr_[s] = std::max(0.0f, -lim_[s - INS_G_LIM0]->groesste_absenkung_db());   // the deepest reduction of the block, >= 0
  } else {
    gr_[s] = 0.0f;
  }
}

void ArrInserts::schweige(int streifen) {
  schweige_bahn(streifen, *arbeit0_);
  nach_join(arbeit0_.get(), 1);
}

void ArrInserts::schweige_bahn(int streifen, ArrArbeit& a) {
  bool noch = false;
  uint64_t eigen = slot_eigen_[streifen];
  for (int s = 0; s < ARR_INS_ALLE; ++s) {
    if (!((eigen >> s) & 1u)) continue;
    if (lief_[s]) leere(s);
    trocken_leere(s);
    pos_[s] = s >= INS_G_HOST0 && in_kette_[s] ? INS_BLENDE : 0;   // when the signal comes back the stage fades in again; a host stage has no outer blend (its entry blend is armed by trocken_leere), pos_ > 0 keeps its exit tail
    if (!in_kette_[s]) {   // a tail has nothing left to fade
      eigen &= ~(uint64_t{1} << s);
      a.slot_frei |= uint64_t{1} << s;
#ifdef CYPHERDJ_MUTATION_SPUR_BESITZER_GEMEINSAM
      besitzer_[s] = -1;   // error case: the shared owner table is written during the fork
#endif
    } else {
      noch = true;
    }
  }
  slot_eigen_[streifen] = eigen;
  if (!noch) a.maske_loeschen |= uint64_t{1} << streifen;
}

void ArrInserts::kette(int streifen, const ArrKette* k, float* l, float* r, int m) {
  kette_bahn(streifen, k, l, r, m, *arbeit0_);
  nach_join(arbeit0_.get(), 1);
}

void ArrInserts::kette_bahn(int streifen, const ArrKette* k, float* l, float* r, int m, ArrArbeit& a) {
#ifdef CYPHERDJ_MUTATION_SPUR_BESITZER_GELESEN
  uint64_t eigen = 0;   // error case: the lane form reads the shared owner table instead of its own mirror entry
  for (int s = 0; s < ARR_INS_ALLE; ++s)
    if (besitzer_[s] == streifen) eigen |= uint64_t{1} << s;
#else
  uint64_t eigen = slot_eigen_[streifen];
#endif
  if (k)
    for (int j = 0; j < k->n && j < ARR_KETTE; ++j) {
      const ArrStufe& x = k->st[j];
      const int g = ins_global(x.art, x.slot);
      if (g < 0 || !((eigen >> g) & 1u)) continue;
      stufe(g, x.an && eff(g, 0, m) >= 0.5f, l, r, m, a);
    }
  bool noch = false;
  for (int s = 0; s < ARR_INS_ALLE; ++s) {
    if (!((eigen >> s) & 1u)) continue;
    if (!in_kette_[s]) {   // a tail: the stage left the chain and fades out on its strip
      stufe(s, false, l, r, m, a);
      if (pos_[s] == 0) {
        if (lief_[s]) leere(s);
        eigen &= ~(uint64_t{1} << s);   // own mirror bit now; the shared owner entry is cleared by nach_join
        a.slot_frei |= uint64_t{1} << s;
#ifdef CYPHERDJ_MUTATION_SPUR_BESITZER_GEMEINSAM
        besitzer_[s] = -1;   // error case: the shared owner table is written during the fork
#endif
        continue;
      }
    }
    noch = true;
  }
  slot_eigen_[streifen] = eigen;
  if (!noch) a.maske_loeschen |= uint64_t{1} << streifen;
}

void ArrInserts::nach_join(ArrArbeit* lanes, int n) {
  for (int i = 0; i < n; ++i) {
    ArrArbeit& a = lanes[i];
    for (int s = 0; s < ARR_INS_ALLE; ++s)
      if ((a.slot_frei >> s) & 1u) {
        besitzer_[s] = -1;
        bk_besitz_frei(s);
      }
    maske_ &= ~a.maske_loeschen;
    nan_ += a.nan_zaehler;
    a.slot_frei = 0;
    a.maske_loeschen = 0;
    a.nan_zaehler = 0;
  }
}

}  // namespace cdj
