// 1.10 slice 4a T2 / 4b T12: pooled compressor, EQ, saturator and limiter inserts of the arrangement strips (see arr_inserts.h for the life of a stage).
#include "cypherdj/arr_inserts.h"

#include "cypherdj/arr_arbeit.h"
#include "cypherdj/arr_pdc.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cdj {

ArrInserts::ArrInserts() : arbeit0_(std::make_unique<ArrArbeit>()) {
  for (int s = 0; s < ARR_INS_KOMP; ++s) komp_[s] = std::make_unique<Komp>();   // throws if the Rust side cannot build one
  for (int s = 0; s < ARR_INS_EQ; ++s) eq_[s] = std::make_unique<EqNativ>();
  for (int s = 0; s < ARR_INS_SAETT; ++s) saett_[s] = std::make_unique<SaettNativ>();
  for (int s = 0; s < ARR_INS_LIM; ++s) lim_[s] = std::make_unique<cypherdj::dsp::KanalLimiter>(INS_LIM_FS, ins_lim_einstellung());
  for (int& b : besitzer_) b = -1;
  for (int s = 0; s < ARR_INS_ALLE; ++s) {
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

void ArrInserts::binde(int slot, int param, float vorgabe) {
  if (slot >= 0 && slot < ARR_INS_ALLE && param >= 0 && param < n_param(slot)) p_[slot][param].w = vorgabe;
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
      float mv = w.vl ? w.vl[m - 1] : w.w;
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
  else if (s < ARR_INS_KOMP + ARR_INS_EQ) eq_[s - ARR_INS_KOMP]->leeren();
  else if (s < ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT) saett_[s - ARR_INS_KOMP - ARR_INS_EQ]->leeren();
  else lim_[s - ARR_INS_KOMP - ARR_INS_EQ - ARR_INS_SAETT]->leeren();
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
  std::memset(tl_[s], 0, sizeof tl_[s]);
  std::memset(tr_[s], 0, sizeof tr_[s]);
  tp_[s] = 0;
}

void ArrInserts::tausche(const ArrKette* ketten) {
  int anspruch[ARR_INS_ALLE];
  ArrSchluessel neu_key[ARR_INS_KOMP];
  int neu_vs[ARR_INS_KOMP] = {}, neu_vz[ARR_INS_KOMP] = {}, neu_sp[ARR_INS_KOMP] = {};
  for (int& a : anspruch) a = -1;
  if (ketten)
    for (int st = 0; st < ARR_KETTEN; ++st)
      for (int j = 0; j < ketten[st].n && j < ARR_KETTE; ++j) {
        const ArrStufe& x = ketten[st].st[j];
        const int g = ins_global(x.art, x.slot);
        if (g >= 0) anspruch[g] = st;
        if (g >= 0 && g < ARR_INS_KOMP) {
          neu_key[g] = x.key;
          neu_vs[g] = x.schl_verz;
          neu_vz[g] = x.schl_verz_zeile;
          neu_sp[g] = x.schl_spaet;
        }
      }
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
      if (besitzer_[s] != anspruch[s]) {   // a new owner: a tail of the old one is cut, the new stage starts cleared and fades in
        leere(s);
        trocken_leere(s);
        pos_[s] = 0;
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
      }
    }
  }
  spiegel_neu();
}

void ArrInserts::ruhe() {
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
  }
  maske_ = 0;
  spiegel_neu();
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
  } else if (s < ARR_INS_KOMP + ARR_INS_EQ) {
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
  } else if (s < ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT) {
#ifdef CYPHERDJ_MUTATION_INS_SAETT_AUS_NACH_DRIVE
    saett_[s - ARR_INS_KOMP - ARR_INS_EQ]->setze(static_cast<double>(e[2]), static_cast<double>(e[1]), static_cast<double>(e[3]));   // error case: drive and output gain swapped
#else
    saett_[s - ARR_INS_KOMP - ARR_INS_EQ]->setze(static_cast<double>(e[1]), static_cast<double>(e[2]), static_cast<double>(e[3]));
#endif
  } else {
    cypherdj::dsp::KanalLimiter& q = *lim_[s - ARR_INS_KOMP - ARR_INS_EQ - ARR_INS_SAETT];
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

void ArrInserts::rechne(int s, float* l, float* r, int m) {
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
  } else if (s < ARR_INS_KOMP + ARR_INS_EQ) {
    eq_[s - ARR_INS_KOMP]->block(l, r, m);
  } else if (s < ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT) {
    saett_[s - ARR_INS_KOMP - ARR_INS_EQ]->block(l, r, m);
  } else {
    static_assert(INS_BLOCK <= cypherdj::dsp::kMaxFrames, "the limiter takes a whole block in one call");
    lim_[s - ARR_INS_KOMP - ARR_INS_EQ - ARR_INS_SAETT]->verarbeite(l, r, l, r, m);   // in place
  }
}

void ArrInserts::spiegel_neu() {
  for (uint32_t& e : slot_eigen_) e = 0;
  for (int s = 0; s < ARR_INS_ALLE; ++s)
    if (besitzer_[s] >= 0 && besitzer_[s] < ARR_KETTEN) slot_eigen_[besitzer_[s]] |= uint32_t{1} << s;
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
  const bool lat = lat_[s] > 0;
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
  if (lat) {
    // dry_ = the input delayed by the latency of the stage (the ring is fed with the input, also when the stage is fully on and the dry signal is not read)
    if (!fest) trocken_speise(s, l, r, m, dry_l, dry_r);
    else trocken_speise(s, l, r, m, nullptr, nullptr);
  } else if (!fest) {
    std::memcpy(dry_l, l, sizeof(float) * static_cast<size_t>(m));
    std::memcpy(dry_r, r, sizeof(float) * static_cast<size_t>(m));
  }
  rechne(s, l, r, m);
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
  } else if (s >= ARR_INS_KOMP + ARR_INS_EQ + ARR_INS_SAETT) {
    gr_[s] = std::max(0.0f, -lim_[s - ARR_INS_KOMP - ARR_INS_EQ - ARR_INS_SAETT]->groesste_absenkung_db());   // the deepest reduction of the block, >= 0
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
  uint32_t eigen = slot_eigen_[streifen];
  for (int s = 0; s < ARR_INS_ALLE; ++s) {
    if (!((eigen >> s) & 1u)) continue;
    if (lief_[s]) leere(s);
    trocken_leere(s);
    pos_[s] = 0;   // when the signal comes back the stage fades in again
    if (!in_kette_[s]) {   // a tail has nothing left to fade
      eigen &= ~(uint32_t{1} << s);
      a.slot_frei |= uint32_t{1} << s;
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
  uint32_t eigen = 0;   // error case: the lane form reads the shared owner table instead of its own mirror entry
  for (int s = 0; s < ARR_INS_ALLE; ++s)
    if (besitzer_[s] == streifen) eigen |= uint32_t{1} << s;
#else
  uint32_t eigen = slot_eigen_[streifen];
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
        eigen &= ~(uint32_t{1} << s);   // own mirror bit now; the shared owner entry is cleared by nach_join
        a.slot_frei |= uint32_t{1} << s;
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
      if ((a.slot_frei >> s) & 1u) besitzer_[s] = -1;
    maske_ &= ~a.maske_loeschen;
    nan_ += a.nan_zaehler;
    a.slot_frei = 0;
    a.maske_loeschen = 0;
    a.nan_zaehler = 0;
  }
}

}  // namespace cdj
