// D1 K1 Slice 5 + 1.10 Slice 1: Mixer des Moduls Arrangement (Spec D1 2.3, 1.10 5.4). Je Spur Fader (dB), Pan (Gesetz −3 dB in der Mitte:
// links cos, rechts sin über (pan + 1)·π/4), Mute und Solo mit 10-ms-Blende (linear, 480 Samples), Spitze nach dem Fader. Seit 1.10 schickt jede Spur
// ihr Signal an ihr Ziel (master oder eine Gruppe, Tiefe 1, Wechsel mit linearer Blende über ARR_ZIEL_BLENDE); eine Gruppe hat Fader, Balance
// (Mitte 0 dB), Mute und Solo wie eine Spur; der Produktions-Master (PM) summiert alle Ziele master und die Gruppen, regelt sie mit pm/fader und
// reicht sie in den Eingang von erz/4. pm_l_/pm_r_ nach dem PM-Fader sind zugleich der Export-Abgriff (E2). Werte je Sample aus dem Stellwerk
// (Regler spur/<n>/*, grp/<n>/*, pm/fader, Rollen an Kanal −1).
// Solo (F2): ist irgendwo Solo, schweigt jede Spur und Gruppe, die nicht selbst Solo hat; eine Spur klingt außerdem, wenn ihre Gruppe Solo hat,
// eine Gruppe klingt, wenn eines ihrer Mitglieder Solo hat. Mute einer Gruppe nullt ihre Mitglieder.
#include <algorithm>
#include <cmath>
#include <cstring>

#include "arr_gain_intern.h"
#include "cypherdj/arrangement.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;

static_assert(ARR_SPUREN == sw::SPUR_REGLER_SPUREN, "Spur-Slots und Spur-Regler müssen gleich viele sein (E3)");
static_assert(ARR_GRUPPEN == sw::GRP_REGLER_GRUPPEN, "Gruppen-Slots und Gruppen-Regler müssen gleich viele sein (1.10)");
static_assert(ARR_RETURNS == sw::RET_REGLER_RETURNS, "return slots and return controls must be the same number (1.10 slice 3)");
static_assert(ARR_RETURNS == sw::SND_REGLER, "send controls per source must match the return slots (1.10 slice 3)");

namespace {

inline void pan_gain(float pan, float& gl, float& gr) {
  const float p = std::clamp(pan, -1.0f, 1.0f);
#ifdef CYPHERDJ_MUTATION_ARR_PAN_LINEAR
  gl = 0.5f * (1.0f - p);   // Fehlerfall: lineares Gesetz, −6 dB in der Mitte
  gr = 0.5f * (1.0f + p);
#else
  const float th = (p + 1.0f) * 0.78539816339744830962f;
  gl = std::cos(th);
  gr = std::sin(th);
#endif
}

// Gruppen-Pan (P14): Balance, in der Mitte 0 dB; die abgewandte Seite wird bis stumm leiser
inline void balance_gain(float pan, float& gl, float& gr) {
  const float p = std::clamp(pan, -1.0f, 1.0f);
  gl = p > 0.0f ? 1.0f - p : 1.0f;
  gr = p < 0.0f ? 1.0f + p : 1.0f;
}

// "ins/<art>/<n>/<rest>" -> n (1..max) and the rest after the third slash, else 0
inline int ins_nr(const char* pfad, const char* kopf, int max, const char** rest) {
  const size_t k = std::strlen(kopf);
  if (std::strncmp(pfad, kopf, k) != 0) return 0;
  const char* p = pfad + k;
  int n = 0;
  for (int z = 0; *p >= '0' && *p <= '9' && z < 3; ++p, ++z) n = n * 10 + (*p - '0');
  if (*p != '/' || n < 1 || n > max) return 0;
  *rest = p + 1;
  return n;
}

// The global slot and parameter index (arr_inserts.h) of an insert row, or false for a row that is no insert row.
bool ins_zeile(const sw::ReglerDef& d, int* slot, int* param) {
  const char* rest = nullptr;
  const sw::Rolle r = d.rolle;
  if (r >= sw::Rolle::ins_komp_an && r <= sw::Rolle::ins_komp_sc) {
    const int n = ins_nr(d.pfad, "ins/komp/", ARR_INS_KOMP, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::komp, n - 1);
    *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_komp_an);
    return true;
  }
  if (r >= sw::Rolle::ins_eq_an && r <= sw::Rolle::ins_eq_b_platz) {
    const int n = ins_nr(d.pfad, "ins/eq/", ARR_INS_EQ, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::eq, n - 1);
    if (r <= sw::Rolle::ins_eq_propq) {
      *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_eq_an);
    } else {   // "b<m>/<name>", m = 1..8
      if (rest[0] != 'b' || rest[1] < '1' || rest[1] > '8' || rest[2] != '/') return false;
#ifdef CYPHERDJ_MUTATION_INS_EQ_BAND_VERTAUSCHT
      *param = 3 + (rest[1] - '0') * INS_EQ_BAND_PARAM + (static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_eq_b_an));   // error case: the band index of the binding is off by one (b8 falls off the end)
#else
      *param = 3 + (rest[1] - '1') * INS_EQ_BAND_PARAM + (static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_eq_b_an));
#endif
    }
    return true;
  }
  if (r >= sw::Rolle::ins_saett_an && r <= sw::Rolle::ins_saett_mix) {
    const int n = ins_nr(d.pfad, "ins/saett/", ARR_INS_SAETT, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::saett, n - 1);
    *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_saett_an);
    return true;
  }
  if (r >= sw::Rolle::ins_lim_an && r <= sw::Rolle::ins_lim_abklingen) {   // the limiter roles come after rack_m4, so they need their own branch
    const int n = ins_nr(d.pfad, "ins/lim/", ARR_INS_LIM, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::lim, n - 1);
    *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_lim_an);
    return true;
  }
  if (r >= sw::Rolle::ins_util_an && r <= sw::Rolle::ins_util_balance) {   // arr-fx slice 1: the utility roles come after ins_host_an
    const int n = ins_nr(d.pfad, "ins/utility/", ARR_INS_UTIL, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::utility, n - 1);
    *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_util_an);
    return true;
  }
  if (r >= sw::Rolle::ins_bk_an && r <= sw::Rolle::ins_bk_k8) {   // arr-bk slice 3: ins/bk/<n>/an and k1..k8 (parameter 0..8)
    const int n = ins_nr(d.pfad, "ins/bk/", ARR_INS_BK, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::bk, n - 1);
    *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_bk_an);
    return true;
  }
  if (r == sw::Rolle::ins_host_an) {   // plan 1.11 T4: ins/host/<n>/an, the only row of an effect-host stage
    const int n = ins_nr(d.pfad, "ins/host/", ARR_INS_HOST, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::host, n - 1);
    *param = 0;
    return true;
  }
  return false;
}

}  // namespace

void Arrangement::regler_binden(const sw::ReglerTabelle& tab) {
  for (int r = 0; r < sw::MAX_REGLER; ++r) {
    regler_spur_[r] = -1;   // strip index (track 0..31, group 32..39, PM 40, returns 41..44), name from D1 K1
    regler_feld_[r] = -1;
    regler_ins_[r] = -1;
    regler_rack_[r] = -1;
  }
  for (auto& je_spur : spur_regler_)
    for (int16_t& x : je_spur) x = -1;
  for (int r = 0; r < tab.anzahl(); ++r) {
    const sw::ReglerDef& d = tab.def(r);
    int feld = -1, streifen = -1;
    if (d.rolle >= sw::Rolle::rack_m1 && d.rolle <= sw::Rolle::rack_m4) {   // 1.10 slice 4c: the macro rows rack/<k>/m1..m4
      const char* rest = nullptr;
      const int k = ins_nr(d.pfad, "rack/", ARR_RACKS, &rest);
      if (k >= 1) {
        const int nr = static_cast<int>(d.rolle) - static_cast<int>(sw::Rolle::rack_m1);
        regler_rack_[r] = static_cast<int16_t>((k - 1) * ARR_MAKROS + nr);
        ins_.makro_binde(k - 1, nr, d.vorgabe);
      }
      continue;
    }
    if ((d.rolle >= sw::Rolle::ins_komp_an && d.rolle <= sw::Rolle::ins_saett_mix) ||
        (d.rolle >= sw::Rolle::ins_lim_an && d.rolle <= sw::Rolle::ins_bk_k8)) {   // 1.10 slice 4a/4b + limiter + plan 1.11 host + arr-fx utility: the pooled insert rows (komp, eq, saett, lim, host, utility)
      int slot = 0, param = 0;
      if (ins_zeile(d, &slot, &param)) {
        regler_ins_[r] = static_cast<int16_t>(slot * INS_PARAM_MAX + param);
        ins_.binde(slot, param, d.vorgabe, d.min, d.max);   // 1.12 slice 6: the range clamps a lane value
      }
      continue;
    }
    switch (d.rolle) {
      case sw::Rolle::spur_fader: case sw::Rolle::grp_fader: case sw::Rolle::pm_fader: feld = 0; break;
      case sw::Rolle::spur_pan: case sw::Rolle::grp_pan: feld = 1; break;
      case sw::Rolle::spur_mute: case sw::Rolle::grp_mute: feld = 2; break;
      case sw::Rolle::spur_solo: case sw::Rolle::grp_solo: feld = 3; break;
      case sw::Rolle::snd_spur: case sw::Rolle::snd_grp: {
        const int ri = sw::send_nr(d.pfad) - 1;   // "…/send/<r>"
        if (ri >= 0 && ri < ARR_RETURNS) feld = ARR_F_SEND0 + ri;
        break;
      }
      case sw::Rolle::ret_fader: feld = 0; break;
      case sw::Rolle::ret_pan: feld = 1; break;
      case sw::Rolle::ret_mute: feld = 2; break;
      case sw::Rolle::ret_solo: feld = 3; break;
      case sw::Rolle::ret_hall_an: feld = 4; break;
      case sw::Rolle::ret_hall_pre: feld = 5; break;
      case sw::Rolle::ret_hall_decay: feld = 6; break;
      case sw::Rolle::ret_hall_groesse: feld = 7; break;
      case sw::Rolle::ret_hall_tief: feld = 8; break;
      case sw::Rolle::ret_hall_highcut: feld = 9; break;
      case sw::Rolle::ret_hall_fahne: feld = 10; break;
      default: break;
    }
    if (feld < 0) continue;
    if (d.rolle == sw::Rolle::pm_fader) {
      streifen = ARR_PM;
    } else if (d.rolle >= sw::Rolle::ret_fader && d.rolle <= sw::Rolle::ret_hall_fahne) {
      const int ri = sw::ret_nr(d.pfad) - 1;   // "ret/<r>/…"
      if (ri >= 0 && ri < ARR_RETURNS) streifen = ARR_RET0 + ri;
    } else if (d.rolle == sw::Rolle::snd_grp) {
      const int g = sw::grp_nr(d.pfad) - 1;   // "grp/<n>/send/<r>"
      if (g >= 0 && g < ARR_GRUPPEN) streifen = ARR_SPUREN + g;
    } else if (d.rolle == sw::Rolle::grp_fader || d.rolle == sw::Rolle::grp_pan || d.rolle == sw::Rolle::grp_mute ||
               d.rolle == sw::Rolle::grp_solo) {
      const int g = sw::grp_nr(d.pfad) - 1;   // "grp/<n>/…"
      if (g >= 0 && g < ARR_GRUPPEN) streifen = ARR_SPUREN + g;
    } else {
      const int s = sw::spur_nr(d.pfad) - 1;   // "spur/<n>/…", mehrstellig (E3)
      if (s >= 0 && s < ARR_SPUREN) streifen = s;
    }
    if (streifen < 0) continue;
    regler_spur_[r] = static_cast<int16_t>(streifen);
    regler_feld_[r] = static_cast<int8_t>(feld);
    if (streifen < ARR_SPUREN && feld < 4 &&
        (d.rolle == sw::Rolle::spur_fader || d.rolle == sw::Rolle::spur_pan || d.rolle == sw::Rolle::spur_mute || d.rolle == sw::Rolle::spur_solo))
      spur_regler_[streifen][feld] = static_cast<int16_t>(r);   // 1.12 S3: only spur/1..32/{fader,pan,mute,solo} can be grabbed (D1)
    w_[streifen][feld].w = d.vorgabe;
  }
  for (float& g : ms_gain_) g = 1.0f;
  for (float& w : ziel_w_) w = 1.0f;
  hall_sofort();   // the Halls start on the default controls (constructor, outside the callback)
}

void Arrangement::setze_sofort(int regler, float wert) {
  if (regler >= 0 && regler < sw::MAX_REGLER && regler_rack_[regler] >= 0) {
    ins_.makro_sofort(regler_rack_[regler] / ARR_MAKROS, regler_rack_[regler] % ARR_MAKROS, wert);
    return;
  }
  if (regler >= 0 && regler < sw::MAX_REGLER && regler_ins_[regler] >= 0) {
    ins_.setze_sofort(regler_ins_[regler] / INS_PARAM_MAX, regler_ins_[regler] % INS_PARAM_MAX, wert);
    return;
  }
  if (regler < 0 || regler >= sw::MAX_REGLER || regler_spur_[regler] < 0) return;
  Wert& w = w_[regler_spur_[regler]][regler_feld_[regler]];
  w.w = wert;
  w.vl = nullptr;
  w.sw_vl = nullptr;
}

void Arrangement::verlauf(int regler, const float* werte) {
  if (regler >= 0 && regler < sw::MAX_REGLER && regler_rack_[regler] >= 0) {
    ins_.makro_verlauf(regler_rack_[regler] / ARR_MAKROS, regler_rack_[regler] % ARR_MAKROS, werte);
    return;
  }
  if (regler >= 0 && regler < sw::MAX_REGLER && regler_ins_[regler] >= 0) {
    ins_.verlauf(regler_ins_[regler] / INS_PARAM_MAX, regler_ins_[regler] % INS_PARAM_MAX, werte);
    return;
  }
  if (regler < 0 || regler >= sw::MAX_REGLER || regler_spur_[regler] < 0 || !werte) return;
  Wert& w = w_[regler_spur_[regler]][regler_feld_[regler]];
  w.vl = werte;
  w.sw_vl = werte;   // Automation Slice 1: the stellwerk course, kept when a lane buffer takes the place of vl
}

// Am Blockanfang: weicht das Ziel einer Spur im Schnappschuss vom gültigen ab, beginnt die Blende (alt → neu).
void Arrangement::ziele_pruefen() {
  if (!snap_) return;
  for (int i = 0; i < ARR_SPUREN; ++i) {
#ifdef CYPHERDJ_MUTATION_ARR_ZIEL_IGNORIERT
    const int8_t soll = 0;   // Fehlerfall: jede Spur bleibt auf master, die Gruppe bekommt nie ein Signal
#else
    const int8_t soll = snap_->spur[i].ausgang;
#endif
    if (soll == ziel_[i]) continue;
    ziel_alt_[i] = ziel_[i];
    ziel_[i] = soll;
#ifdef CYPHERDJ_MUTATION_ARR_ZIEL_HART
    ziel_w_[i] = 1.0f;   // Fehlerfall: Ziel-Wechsel ohne Blende (Knack)
#else
    ziel_w_[i] = 0.0f;
#endif
  }
}

void Arrangement::mischen(int m, float* aus_l, float* aus_r) {
  ziele_pruefen();
  // 1.10 slice 3: a return exists when the playback knows it (ret_da); an unloaded playback knows none (P15)
  const auto da = [&](int r) { return snap_ && snap_->ret_da[r]; };
  // 1.10 slice 4b T13: the delay of a place of the latency compensation in this playback (arr_pdc.h); 0 = no ring, the place is not touched
  const auto pd = [&](int key) { return snap_ ? static_cast<int>(snap_->pdc.d[key]) : 0; };
  // Solo irgendwo (Spuren, Gruppen und vorhandene Returns). E3 P5: ein Scan je Block statt je Spur und Sample, Ergebnis bitgleich.
  bool solo_vl = false, solo_fest = false;
  for (int i = 0; i < ARR_PM; ++i) {
    solo_vl = solo_vl || w_[i][3].vl;
    solo_fest = solo_fest || w_[i][3].w >= 0.5f;
  }
  // a return with solo counts like a track with solo (P7): everything without solo falls silent, the returns without solo too (rs_*)
  bool rs_vl = false, rs_fest = false;
  for (int r = 0; r < ARR_RETURNS; ++r) {
    if (!da(r)) continue;
    rs_vl = rs_vl || w_[ARR_RET0 + r][3].vl;
    rs_fest = rs_fest || w_[ARR_RET0 + r][3].w >= 0.5f;
  }
  solo_vl = solo_vl || rs_vl;
  solo_fest = solo_fest || rs_fest;
  const auto solo_bei = [&](int s, int t) { return (w_[s][3].vl ? w_[s][3].vl[t] : w_[s][3].w) >= 0.5f; };
  // any existing return with solo at sample t (only asked when rs_vl or rs_fest)
  const auto rs_bei = [&](int t) {
    for (int r = 0; r < ARR_RETURNS; ++r)
      if (da(r) && solo_bei(ARR_RET0 + r, t)) return true;
    return false;
  };
  bool benutzt[ARR_GRUPPEN] = {};   // schickt irgendeine Spur in diesem Block in die Gruppe (auch in der Blende)?
  for (int i = 0; i < ARR_SPUREN; ++i) {
    if (ziel_[i] > 0) benutzt[ziel_[i] - 1] = true;
    if (ziel_w_[i] < 1.0f && ziel_alt_[i] > 0) benutzt[ziel_alt_[i] - 1] = true;
  }
  const size_t bytes = sizeof(float) * static_cast<size_t>(m);
  std::memset(pm_l_, 0, bytes);
  std::memset(pm_r_, 0, bytes);
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    if (!benutzt[g]) continue;
    std::memset(grp_l_[g], 0, bytes);
    std::memset(grp_r_[g], 0, bytes);
  }
  for (int r = 0; r < ARR_RETURNS; ++r) ret_.benutzt(r) = false;
  bool msolo_fest[ARR_GRUPPEN] = {};   // hat ein Mitglied der Gruppe Solo (ohne Verlauf)
  if (solo_vl) {
    for (int t = 0; t < m; ++t) {
      bool s = false;
      for (int j = 0; j < ARR_PM && !s; ++j) s = solo_bei(j, t);
      solo_t_[t] = s || (rs_vl || rs_fest ? rs_bei(t) : false);
    }
    for (int g = 0; g < ARR_GRUPPEN; ++g) {
      if (!benutzt[g]) continue;
      for (int t = 0; t < m; ++t) {
        bool s = false;
        for (int i = 0; i < ARR_SPUREN; ++i) s = s || (ziel_[i] == g + 1 && solo_bei(i, t));
        msolo_t_[g][t] = s;
      }
    }
  } else {
    for (int i = 0; i < ARR_SPUREN; ++i)
      if (ziel_[i] > 0 && w_[i][3].w >= 0.5f) msolo_fest[ziel_[i] - 1] = true;
  }
  // 0. Gruppen-Blende im Vorlauf (P14): Mute/Solo-Blende jeder benutzten Gruppe je Sample. Sie hängt nur an Reglern, nicht am Audio; die Sends der Mitglieder
  // (Schritt 1) und die Gruppen-Schleife (Schritt 2) lesen sie. Dieselbe Arithmetik wie früher in der Gruppen-Schleife (bitgleich, AK1).
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    if (!benutzt[g]) continue;
    const int s = ARR_SPUREN + g;
    const Wert& mu = w_[s][2];
    const Wert& so = w_[s][3];
    float g_ms = ms_gain_[s];
    for (int t = 0; t < m; ++t) {
      const bool solo_irgendwo = solo_vl ? solo_t_[t] : solo_fest;
      const bool stumm = (mu.vl ? mu.vl[t] : mu.w) >= 0.5f;
      const bool solo = (so.vl ? so.vl[t] : so.w) >= 0.5f;
      const bool mitglied_solo = solo_vl ? msolo_t_[g][t] : msolo_fest[g];
      const float ziel = (stumm || (solo_irgendwo && !solo && !mitglied_solo)) ? 0.0f : 1.0f;
#ifdef CYPHERDJ_MUTATION_ARR_MUTE_HART
      g_ms = ziel;
#else
      if (g_ms < ziel) g_ms = std::min(ziel, g_ms + 1.0f / ARR_STUMM_BLENDE);
      else if (g_ms > ziel) g_ms = std::max(ziel, g_ms - 1.0f / ARR_STUMM_BLENDE);
#endif
      gblende_[g][t] = g_ms;
    }
    ms_gain_[s] = g_ms;
  }
  // Send einer Quelle (Spur oder Gruppe) in die Returns vorbereiten: aktiv = der Return rechnet, und der Send hat einen Verlauf oder liegt über −120 dB
  // (sonst bleibt ein Projekt ohne Sends bitgleich, AK1). Gibt die Zahl der aktiven Sends zurück.
  struct Send {
    bool aktiv = false;
    const float* vl = nullptr;
    float lin = 0.0f;
  };
  const auto sends_bereiten = [&](int streifen, Send* sd) {
    int n = 0;
    for (int r = 0; r < ARR_RETURNS; ++r) {
      const Wert& sw_ = w_[streifen][ARR_F_SEND0 + r];
      sd[r].aktiv = ret_.rechnet(r, da(r)) && (sw_.vl || sw_.w > -120.0f);
      sd[r].vl = sw_.vl;
      sd[r].lin = db_lin(sw_.w);
      if (!sd[r].aktiv) continue;
      ++n;
      if (!ret_.benutzt(r)) {
        ret_.leere_eingang(r, m);
        ret_.benutzt(r) = true;
      }
    }
    return n;
  };
  // 1.10 slice 4a: a return set to pre takes its sends before the fader and pan of the source (after the insert chain and the mute/solo fade).
  // The flag is two different signals: a flip (swap) blends from one to the other over ARR_STUMM_BLENDE samples, 0 = post, 1 = pre (review echtzeit-1).
  for (int r = 0; r < ARR_RETURNS; ++r) {
    const float ziel = (snap_ && snap_->ret_pre[r]) ? 1.0f : 0.0f;
    float w = ret_pre_w_[r];
    for (int t = 0; t < m; ++t) {
#ifdef CYPHERDJ_MUTATION_INS_PRE_SPRUNG
      w = ziel;   // error case: the flag is a hard per-sample switch
#else
      if (w < ziel) w = std::min(ziel, w + 1.0f / ARR_STUMM_BLENDE);
      else if (w > ziel) w = std::max(ziel, w - 1.0f / ARR_STUMM_BLENDE);
#endif
      ret_pre_t_[r][t] = w;
    }
    ret_pre_w_[r] = w;
  }
  auto pre_post = [](float post, float pre, float w) { return w <= 0.0f ? post : (w >= 1.0f ? pre : post + (pre - post) * w); };
  // 1.10 slice 4a: the insert chains of the tracks, a block-wise pass in place over the track input, before the fader loop below. A track without a
  // chain (or tail) takes no pass and no copy: its output stays bit-equal to the build before this slice (AK1).
  // Sidechain keys (T4, spec 2.3): the input of a track that some stage names as its key is copied BEFORE any chain runs, so the key is never a
  // chain output and does not depend on the order of the strips. A track without signal has a silent bus (memset above): a silent key.
  ins_.makros_planen(snap_ ? snap_->kette : nullptr, snap_ ? snap_->rack : nullptr, m);   // 1.10 slice 4c: the macro values of the racks become parameter values, before any parameter is read
  ins_.schluessel_planen(m);
  // 1.10 slice 5 U2b (E6, E7): the DJ inputs of this block (deck/1..4, erz/1) go into the key buffers of the stages that listen to them. They are there before any strip runs, for every consumer. A nullptr
  // input captures nothing: the buffer keeps the zero schluessel_planen() wrote, so a deck that stopped gives a silent key, never the samples of the block before.
#ifndef CYPHERDJ_MUTATION_SC_DJ_NULL   // error case: the DJ pointers are ignored, the keys of deck and erz stay silent
  for (int i = 0; i < DJ_EINGAENGE; ++i)
    if (dj_l_[i] && dj_r_[i]) ins_.kopiere(i < 4 ? ARR_SCHL_DECK : ARR_SCHL_ERZ, ARR_SCHL_POST, i < 4 ? i + 1 : 1, dj_l_[i], dj_r_[i], m);
#endif
#ifndef CYPHERDJ_MUTATION_INS_SC_NACH_KETTE
  for (int t = 0; t < ARR_SPUREN; ++t)
    if ((ins_.schluessel_maske() >> t) & 1u) ins_.schluessel_sichern(t, bus_l_[t], bus_r_[t], m);
#endif
  // 1.10 slice 5 U1: one pass per track in snap_->spur_ordnung: the chain, the delay compensation, then the fader loop of the track below. A track whose stage listens to the
  // post of another track runs after it (arr_key.h); the order is the identity without such keys, so the sums are formed in the order of the build before this slice.
  for (int ii = 0; ii < ARR_SPUREN; ++ii) {
#ifdef CYPHERDJ_MUTATION_INS_SC_NACH_KETTE
    const int i = ARR_SPUREN - 1 - ii;   // error case: the key is taken after the key track's own chain (high tracks run first so that it is there in time)
#else
    const int i = snap_ ? static_cast<int>(snap_->spur_ordnung[ii]) : ii;
#endif
    if (ins_.hat(i)) {
#ifdef CYPHERDJ_MUTATION_INS_NACH_FADER
      {   // error case: the chain sits after the fader (the base value of the fader is applied first, the loop below then multiplies by 1)
        const float f0 = db_lin(w_[i][0].w);
        for (int t = 0; t < m; ++t) {
          bus_l_[i][t] *= f0;
          bus_r_[i][t] *= f0;
        }
      }
#endif
      ins_.kette(i, snap_ ? &snap_->kette[i] : nullptr, bus_l_[i], bus_r_[i], m);
    }
    // 1.10 slice 4b T13: the track is aligned with the track of the longest chain (arrival T_trk); its sends are taken from the aligned signal
    pdc_.verzoegere(PDC_SPUR0 + i, pd(PDC_SPUR0 + i), bus_l_[i], bus_r_[i], m);   // plan 1.11: also with d = 0, the ring is fed so that a later swap has the history
#ifndef CYPHERDJ_MUTATION_MONITOR_NACH_FADER
    // 1.8 T1 (slice 3b-lite): the dry monitor of an external input joins the track here, after the chain and the delay (no latency of the chains), before the fader loop below
    if (mon_[i].klingt) monitor_spur_addieren(i, m, bus_l_[i], bus_r_[i]);
#endif
#ifdef CYPHERDJ_MUTATION_INS_SC_NACH_KETTE
    if ((ins_.schluessel_maske() >> i) & 1u) ins_.schluessel_sichern(i, bus_l_[i], bus_r_[i], m);
#endif
    // 1. Spuren → Ziel (the fader loop of the track just processed)
    const Wert& fa = w_[i][0];
    const Wert& pa = w_[i][1];
    const Wert& mu = w_[i][2];
    const Wert& so = w_[i][3];
    float lin = db_lin(fa.w), gl = 0.0f, gr = 0.0f;
#ifdef CYPHERDJ_MUTATION_INS_NACH_FADER
    const bool fader_schon = ins_.hat(i);   // error case: the fader was applied before the chain
    if (fader_schon) lin = 1.0f;
#else
    constexpr bool fader_schon = false;
#endif
    pan_gain(pa.w, gl, gr);
    float sp = spitze_[i];
    float g_ms = ms_gain_[i];
    const float* bl = bus_l_[i];
    const float* br = bus_r_[i];
    const int zg = ziel_[i];
    float* zl = zg == 0 ? pm_l_ : grp_l_[zg - 1];
    float* zr = zg == 0 ? pm_r_ : grp_r_[zg - 1];
    const Wert* gso = zg > 0 ? &w_[ARR_SPUREN + zg - 1][3] : nullptr;   // Solo der Gruppe: die Spur klingt mit
    float zw = ziel_w_[i];
    bool blende = zw < 1.0f;
    float* al = nullptr;
    float* ar = nullptr;
    if (blende) {
      const int za = ziel_alt_[i];
      al = za == 0 ? pm_l_ : grp_l_[za - 1];
      ar = za == 0 ? pm_r_ : grp_r_[za - 1];
    }
    Send sd[ARR_RETURNS];
    const int n_sends = sends_bereiten(i, sd);
    const float* gbl = zg > 0 ? gblende_[zg - 1] : nullptr;   // fade of the target group: a muted group silences the sends of its members too
    float* kpl[ARR_INS_KOMP];   // structural post keys (slice 5 U1): the key buffers of the stages listening to the post of this track, mostly none
    float* kpr[ARR_INS_KOMP];
    const int nk = ins_.post_ziele(i, kpl, kpr);
    // 1.10 T9: render-only key mask. Live nur_schl_ is false: one branch per strip and block, the gains stay 1.0f (x * 1.0f is bit-equal)
    const float gz = nur_schl_ && (nur_ziel_aus_[i] || (trocken_aus_ && zg == 0)) ? 0.0f : 1.0f, gs = nur_schl_ && nur_sends_aus_[i] ? 0.0f : 1.0f;   // T10: dry-out too
    const bool abg_post = abg_ && abg_->art == 0 && abg_->punkt == 1 && abg_->nr == i + 1;   // 1.10 slice 7: the tap of this track's post, mostly none
    for (int t = 0; t < m; ++t) {
      if (!fader_schon && fa.vl && (t == 0 || fa.vl[t] != fa.vl[t - 1])) lin = db_lin(fa.vl[t]);   // the same value gives the same gain: pow only on a change
      if (pa.vl && (t == 0 || pa.vl[t] != pa.vl[t - 1])) pan_gain(pa.vl[t], gl, gr);   // the same pan gives the same gains: cos/sin only on a change (E8)
      const bool solo_irgendwo = solo_vl ? solo_t_[t] : solo_fest;
      const bool stumm = (mu.vl ? mu.vl[t] : mu.w) >= 0.5f;
      const bool solo = (so.vl ? so.vl[t] : so.w) >= 0.5f;
      const bool gruppe_solo = gso && (gso->vl ? gso->vl[t] : gso->w) >= 0.5f;
      const float ziel = (stumm || (solo_irgendwo && !solo && !gruppe_solo)) ? 0.0f : 1.0f;
#ifdef CYPHERDJ_MUTATION_ARR_MUTE_HART
      g_ms = ziel;   // Fehlerfall: Mute und Solo ohne Blende (Knack)
#else
      if (g_ms < ziel) g_ms = std::min(ziel, g_ms + 1.0f / ARR_STUMM_BLENDE);
      else if (g_ms > ziel) g_ms = std::max(ziel, g_ms - 1.0f / ARR_STUMM_BLENDE);
#endif
      const float l = bl[t] * lin * gl * g_ms;
      const float r = br[t] * lin * gr * g_ms;
      if (abg_post) {   // tap, track post: the same sample the track sends on (the monitor joined the bus before this loop, so it is part of it)
#ifdef CYPHERDJ_MUTATION_ABGRIFF_VOR_FADER
        abg_l_[t] = bl[t];   // error case: the tap is taken in front of the fader, pan and mute fade
        abg_r_[t] = br[t];
#else
        abg_l_[t] = l;
        abg_r_[t] = r;
#endif
      }
      for (int q = 0; q < nk; ++q) {   // the capture point of the track post: what the track sends on to its target after fader, pan and mute/solo fade
#ifdef CYPHERDJ_MUTATION_SC_POST_VOR_FADER
        kpl[q][t] = bl[t];   // error case: the post key is the chain output, before fader, pan and mute
        kpr[q][t] = br[t];
#else
#ifdef CYPHERDJ_MUTATION_NUR_SCHLUESSEL_STUMM
        kpl[q][t] = l * gz;   // error case (T9): the render mask zeroes the key as well
        kpr[q][t] = r * gz;
#else
        kpl[q][t] = l;
        kpr[q][t] = r;
#endif
#endif
      }
      const float lz = l * gz, rz = r * gz;   // what the track adds into its target (the key above is taken before the mask)
      if (!blende) {
        zl[t] += lz;
        zr[t] += rz;
      } else {
        zw = std::min(1.0f, zw + 1.0f / ARR_ZIEL_BLENDE);
        al[t] += lz * (1.0f - zw);
        ar[t] += rz * (1.0f - zw);
        zl[t] += lz * zw;
        zr[t] += rz * zw;
        blende = zw < 1.0f;
      }
      if (n_sends) {   // post fader, pan and mute/solo of the track (P5), times the fade of its group (P14)
#ifdef CYPHERDJ_MUTATION_ARR_SEND_OHNE_GRUPPEN_BLENDE
        const float gb = 1.0f;   // error case: a muted group does not silence the sends of its members
#else
        const float gb = gbl ? gbl[t] : 1.0f;
#endif
        // pre tap: the chain output times the mute/solo fade, without fader and pan (spec D6)
#if defined(CYPHERDJ_MUTATION_INS_PRE_NACH_FADER)
        const float pl = l, pr = r;   // error case: the pre tap is taken after the fader
#elif defined(CYPHERDJ_MUTATION_INS_PRE_OHNE_MUTE)
        const float pl = bl[t], pr = br[t];   // error case: the pre tap ignores mute and solo
#else
        const float pl = bl[t] * g_ms, pr = br[t] * g_ms;
#endif
#ifdef CYPHERDJ_MUTATION_ARR_SEND_PRE
        const float sl = bl[t], sr = br[t];   // error case: send before fader, pan and mute
#elif defined(CYPHERDJ_MUTATION_ARR_SEND_OHNE_MUTE)
        const float sl = bl[t] * lin * gl, sr = br[t] * lin * gr;   // error case: send before the mute/solo fade
#else
        const float sl = l, sr = r;
#endif
        for (int q = 0; q < ARR_RETURNS; ++q) {
          if (!sd[q].aktiv) continue;
          if (sd[q].vl && (t == 0 || sd[q].vl[t] != sd[q].vl[t - 1])) sd[q].lin = db_lin(sd[q].vl[t]);
          const float k = sd[q].lin * gb * gs;
          ret_.ein_l(q)[t] += pre_post(sl, pl, ret_pre_t_[q][t]) * k;
          ret_.ein_r(q)[t] += pre_post(sr, pr, ret_pre_t_[q][t]) * k;
        }
      }
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    ms_gain_[i] = g_ms;
    spitze_[i] = sp;
    ziel_w_[i] = zw;
    if (nk) ins_.post_fertig(i, m);
    if (abg_post) abg_ernte(abg_l_, abg_r_, m);
#ifdef CYPHERDJ_MUTATION_MONITOR_NACH_FADER
    if (mon_[i].klingt) monitor_spur_addieren(i, m, zl, zr);   // error case (1.8 T1): the monitor joins the target after the fader loop, so fader, pan, mute and solo do not act on it
#endif
  }
  // 1.10 slice 4b T13: the sum of the tracks that went to the master is all that the PM sum holds now: it waits for the longest of the three arrivals (groups, returns).
  // The sends of the tracks wait for the groups' sends: the sum in each return input holds the track part only until the groups add theirs below.
  pdc_.verzoegere(PDC_PM_SPUR, pd(PDC_PM_SPUR), pm_l_, pm_r_, m);
  for (int r = 0; r < ARR_RETURNS; ++r) {
    const int d = pd(PDC_RETSPUR0 + r);
    if (ret_.benutzt(r)) {
      pdc_.verzoegere(PDC_RETSPUR0 + r, d, ret_.ein_l(r), ret_.ein_r(r), m);
    } else if (pdc_.schwanz(PDC_RETSPUR0 + r, d) && ret_.rechnet(r, da(r))) {   // the sends stopped: what the ring still holds comes out first
      ret_.leere_eingang(r, m);
      ret_.benutzt(r) = true;
      pdc_.verzoegere(PDC_RETSPUR0 + r, d, ret_.ein_l(r), ret_.ein_r(r), m, false);
    }
  }
  // 1.10 slice 5 U2a: the key `pre` of a group = the sum of its members before ANY group chain. Copied for all groups before the first chain runs, so a group keyed by another group
  // (or a return, or the PM) sees the sum, not the chain output. An unused group has no signal and no capture: its key buffer stays at the zero of the block start.
#ifndef CYPHERDJ_MUTATION_SC_GRUPPE_NACH_KETTE   // error case: the copy sits behind the chains (below)
  for (int g = 0; g < ARR_GRUPPEN; ++g)
    if (benutzt[g]) ins_.kopiere(ARR_SCHL_GRP, ARR_SCHL_PRE, g + 1, grp_l_[g], grp_r_[g], m);
#endif
  if (abg_ziel(1, 0) && abg_->nr >= 1 && abg_->nr <= ARR_GRUPPEN && benutzt[abg_->nr - 1])   // 1.10 slice 7: tap, group pre = the sum of the members in front of any chain
    abg_ernte(grp_l_[abg_->nr - 1], grp_r_[abg_->nr - 1], m);
  // 1.10 slice 4a: the insert chains of the groups, over the sum of the members, before the group fader and the group sends. An unused group has no signal and no pass.
#ifndef CYPHERDJ_MUTATION_INS_GRUPPE_UEBERSPRUNGEN   // error case: the group pass is skipped
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    if (!ins_.hat(ARR_SPUREN + g)) continue;
    if (benutzt[g]) ins_.kette(ARR_SPUREN + g, snap_ ? &snap_->kette[ARR_SPUREN + g] : nullptr, grp_l_[g], grp_r_[g], m);
#ifndef CYPHERDJ_MUTATION_INS_GRUPPE_LEER_LAEUFT
    else ins_.schweige(ARR_SPUREN + g);   // no member, no signal, no pass: the stages are cleared and report nothing (review echtzeit-3)
#endif
  }
#endif
#ifdef CYPHERDJ_MUTATION_SC_GRUPPE_NACH_KETTE
  for (int g = 0; g < ARR_GRUPPEN; ++g)
    if (benutzt[g]) ins_.kopiere(ARR_SCHL_GRP, ARR_SCHL_PRE, g + 1, grp_l_[g], grp_r_[g], m);   // error case: the group pre key is the chain output
#endif
  for (int g = 0; g < ARR_GRUPPEN; ++g)   // 1.10 slice 4b T13: the group is aligned with the group of the longest arrival (T_G); its sends are taken from the aligned sum
    if (benutzt[g]) pdc_.verzoegere(PDC_GRP0 + g, pd(PDC_GRP0 + g), grp_l_[g], grp_r_[g], m);
  const int d_gruppen = pd(PDC_PM_GRP);
  float* gpm_l = pm_l_;   // where the groups add: the PM sum, or a sum of their own that is delayed and then joins it (bit-equal without a delay)
  float* gpm_r = pm_r_;
  // plan 1.11 (fix round 2): the place PM_GRP keeps its ring fed also without a delay, so that a stage added on a return chain finds history. Delayed or crossfading: the sum of its own as before.
  // Else the sum goes straight into the PM sum (bit-equal to before) and a SIDE sum of the same terms feeds the ring; the side sum is never read as output.
  const bool grp_sep = d_gruppen > 0 || pdc_.kreuzt(PDC_PM_GRP, d_gruppen);
  bool grp_benutzt = false;
  for (int g = 0; g < ARR_GRUPPEN; ++g) grp_benutzt = grp_benutzt || benutzt[g];
#ifdef CYPHERDJ_MUTATION_HOST_PM_NICHT_GEFUETTERT
  float* gfl = nullptr;   // error case: the place PM_GRP is fed only while delayed (the state of fix round 1)
  float* gfr = nullptr;
#else
  float* gfl = (!grp_sep && grp_benutzt) ? pdcs_l_ : nullptr;   // the side sum (null: nothing to feed)
  float* gfr = (!grp_sep && grp_benutzt) ? pdcs_r_ : nullptr;
#endif
  if (grp_sep) {
    gpm_l = pdcs_l_;
    gpm_r = pdcs_r_;
    std::memset(gpm_l, 0, bytes);
    std::memset(gpm_r, 0, bytes);
  } else if (gfl) {
    std::memset(gfl, 0, bytes);
    std::memset(gfr, 0, bytes);
  }
  // 2. Gruppen → PM. Eine Gruppe ohne Mitglieder rechnet nicht, ihre Blende steht sofort auf dem Ziel (es klingt nichts).
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    const int s = ARR_SPUREN + g;
    const Wert& fa = w_[s][0];
    const Wert& pa = w_[s][1];
    const Wert& mu = w_[s][2];
    const Wert& so = w_[s][3];
    if (!benutzt[g]) {
      const int e = m - 1;
      const bool stumm_e = (mu.vl ? mu.vl[e] : mu.w) >= 0.5f;
      const bool solo_e = (so.vl ? so.vl[e] : so.w) >= 0.5f;
      const bool irgendwo_e = solo_vl ? solo_t_[e] : solo_fest;
      ms_gain_[s] = (stumm_e || (irgendwo_e && !solo_e)) ? 0.0f : 1.0f;
      continue;
    }
    float lin = db_lin(fa.w), gl = 1.0f, gr = 1.0f;
    balance_gain(pa.w, gl, gr);
    float sp = spitze_[s];
    const float* bl = grp_l_[g];
    const float* br = grp_r_[g];
    Send sd[ARR_RETURNS];
    const int n_sends = sends_bereiten(s, sd);
    float* kpl[ARR_INS_KOMP];   // structural post keys of this group (slice 5 U2a): the key buffers of the stages listening to it, mostly none
    float* kpr[ARR_INS_KOMP];
    const int nk = ins_.ziele(ARR_SCHL_GRP, ARR_SCHL_POST, g + 1, kpl, kpr);
    const float gz = nur_schl_ && (nur_ziel_aus_[s] || trocken_aus_) ? 0.0f : 1.0f, gs = nur_schl_ && nur_sends_aus_[s] ? 0.0f : 1.0f;   // 1.10 T9, T10: render-only key mask and dry-out (live: both 1.0f)
    const bool abg_post = abg_ziel(1, 1) && abg_->nr == g + 1;   // 1.10 slice 7: the tap of this group's post
    for (int t = 0; t < m; ++t) {
      if (fa.vl) lin = db_lin(fa.vl[t]);
      if (pa.vl) balance_gain(pa.vl[t], gl, gr);
      const float g_ms = gblende_[g][t];
      const float l = bl[t] * lin * gl * g_ms;
      const float r = br[t] * lin * gr * g_ms;
      if (abg_post) {
#ifdef CYPHERDJ_MUTATION_ABGRIFF_VOR_FADER
        abg_l_[t] = bl[t];   // error case: the group tap is taken in front of the group fader
        abg_r_[t] = br[t];
#else
        abg_l_[t] = l;
        abg_r_[t] = r;
#endif
      }
      for (int q = 0; q < nk; ++q) {   // the capture point of the group post: what the group sends on to the PM after its fader, balance and mute/solo fade
#ifdef CYPHERDJ_MUTATION_NUR_SCHLUESSEL_STUMM
        kpl[q][t] = l * gz;   // error case (T9): the render mask zeroes the key as well
        kpr[q][t] = r * gz;
#else
        kpl[q][t] = l;
        kpr[q][t] = r;
#endif
      }
      gpm_l[t] += l * gz;
      gpm_r[t] += r * gz;
      if (gfl) {
        gfl[t] += l * gz;
        gfr[t] += r * gz;
      }
      if (n_sends) {   // the group sends after its own fader, balance and fade (spec 5.4)
        for (int q = 0; q < ARR_RETURNS; ++q) {
          if (!sd[q].aktiv) continue;
          if (sd[q].vl && (t == 0 || sd[q].vl[t] != sd[q].vl[t - 1])) sd[q].lin = db_lin(sd[q].vl[t]);
#ifdef CYPHERDJ_MUTATION_INS_GRUPPE_PRE_NACH_FADER
          const float pl = l, pr = r;   // error case: the pre tap of a group is taken after its fader
#else
          const float pl = bl[t] * g_ms, pr = br[t] * g_ms;   // pre tap of a group: the chain output times its mute/solo fade
#endif
          ret_.ein_l(q)[t] += pre_post(l, pl, ret_pre_t_[q][t]) * sd[q].lin * gs;
          ret_.ein_r(q)[t] += pre_post(r, pr, ret_pre_t_[q][t]) * sd[q].lin * gs;
        }
      }
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    if (nk) ins_.fertig(ARR_SCHL_GRP, ARR_SCHL_POST, g + 1, m);
    if (abg_post) abg_ernte(abg_l_, abg_r_, m);
    spitze_[s] = sp;
  }
  if (grp_sep) {
    pdc_.verzoegere(PDC_PM_GRP, d_gruppen, gpm_l, gpm_r, m);
    for (int t = 0; t < m; ++t) {
      pm_l_[t] += gpm_l[t];
      pm_r_[t] += gpm_r[t];
    }
  } else if (gfl) {
    pdc_.verzoegere(PDC_PM_GRP, 0, gfl, gfr, m);   // feed only: d = 0 and no fade leave the side sum as it is, and nothing reads it
  }
  // 2b. Returns → PM (before the PM fader, P2). The input goes through the Cypher Hall of the return (hall on: wet only, off: dry, 480 samples blend).
  // Presence fade 480 samples (P9), mute fade like a group, solo only by solo of another return (P7): a solo on a track or group does not silence a return.
  float hx[ARR_RETURNS][ARR_HALL_PARAM] = {};
  bool han[ARR_RETURNS] = {}, hrech[ARR_RETURNS] = {};
  for (int r = 0; r < ARR_RETURNS; ++r) {
    const int s = ARR_RET0 + r;
    for (int k = 0; k < ARR_HALL_PARAM; ++k) {
      const Wert& hw = w_[s][5 + k];
      hx[r][k] = std::clamp(hw.vl ? hw.vl[m - 1] : hw.w, 0.0f, 1.0f);   // the Hall takes the value at the end of the block (its setze is rationed)
    }
    han[r] = (w_[s][4].vl ? w_[s][4].vl[m - 1] : w_[s][4].w) >= 0.5f;
    hrech[r] = ret_.rechnet(r, da(r));
    if (hrech[r] && !ret_.benutzt(r)) {
      ret_.leere_eingang(r, m);
      ret_.benutzt(r) = true;
    }
  }
#ifdef CYPHERDJ_MUTATION_INS_RET_VOR_HALL
  // error case: the chain of a return sits in front of the Hall (over the send sum, in place)
  for (int r = 0; r < ARR_RETURNS; ++r)
    if (hrech[r] && ins_.hat(ARR_KETTE_RET0 + r))
      ins_.kette(ARR_KETTE_RET0 + r, snap_ ? &snap_->kette[ARR_KETTE_RET0 + r] : nullptr, ret_.ein_l(r), ret_.ein_r(r), m);
#endif
  ret_.hall_vorlauf(m, hx, han, hrech);
  ret_.hall_parallel(m);   // mehrkern task 4: the Halls on the HallPool (no-op without a pool)
  for (int r = 0; r < ARR_RETURNS; ++r) {
    const int s = ARR_RET0 + r;
    const bool dd = da(r);
    const Wert& fa = w_[s][0];
    const Wert& pa = w_[s][1];
    const Wert& mu = w_[s][2];
    const Wert& so = w_[s][3];
    float& dg = ret_.da_g(r);
    if (!ret_.rechnet(r, dd)) {   // does not exist and no fade running: nothing sounds, the mute fade stands on its target
      const int e = m - 1;
      const bool stumm_e = (mu.vl ? mu.vl[e] : mu.w) >= 0.5f;
      const bool solo_e = (so.vl ? so.vl[e] : so.w) >= 0.5f;
      ms_gain_[s] = (stumm_e || ((rs_vl || rs_fest) && rs_bei(e) && !solo_e)) ? 0.0f : 1.0f;
      continue;
    }
    float lin = db_lin(fa.w), gl = 1.0f, gr = 1.0f;
    balance_gain(pa.w, gl, gr);
    float sp = spitze_[s];
    float g_ms = ms_gain_[s];
    const float dz = dd ? 1.0f : 0.0f;
    const float az = han[r] ? 1.0f : 0.0f;
    float& ag = ret_.an_g(r);
    const bool nass = ret_.hall_laeuft(r);
    if (nass && !ret_.hall_vorab(r)) ret_.hall_block(r, m);
    const float* bl = ret_.ein_l(r);
    const float* br = ret_.ein_r(r);
    const float* nl = nass ? ret_.nass_l(r) : nullptr;
    const float* nr = nass ? ret_.nass_r(r) : nullptr;
    // 1.10 slice 4a T3: the insert chain of a return, over the Hall output (the dry/wet blend of the return input) and before the return fader. The blend is
    // written over the input buffer, then the chain runs in place, and the strip loop below reads the result. A return without a chain (or tail) takes
    // no pass and keeps its output bit-equal to the build before this slice. The wet/dry weight ag advances here on a copy; the loop below advances the real one.
    bool vorgemischt = false;
    float* kpl[ARR_INS_KOMP];   // structural keys of this return (slice 5 U2a): pre = the Hall blend before the chain, post = after fader, fades and presence; mostly none
    float* kpr[ARR_INS_KOMP];
    float* kql[ARR_INS_KOMP];
    float* kqr[ARR_INS_KOMP];
    const int nkp = ins_.ziele(ARR_SCHL_RET, ARR_SCHL_PRE, r + 1, kpl, kpr);
    const int nkq = ins_.ziele(ARR_SCHL_RET, ARR_SCHL_POST, r + 1, kql, kqr);
    const float gz = nur_schl_ && nur_ziel_aus_[s] ? 0.0f : 1.0f;   // 1.10 T9: render-only key mask (live: 1.0f)
    const bool abg_pre = abg_ziel(2, 0) && abg_->nr == r + 1, abg_post = abg_ziel(2, 1) && abg_->nr == r + 1;   // 1.10 slice 7: the taps of this return
#ifndef CYPHERDJ_MUTATION_INS_RET_VOR_HALL
    if (ins_.hat(ARR_KETTE_RET0 + r)) {
      float* el = ret_.ein_l(r);
      float* er = ret_.ein_r(r);
      float agl = ag;
      for (int t = 0; t < m; ++t) {
        if (agl < az) agl = std::min(az, agl + 1.0f / ARR_RET_BLENDE);
        else if (agl > az) agl = std::max(az, agl - 1.0f / ARR_RET_BLENDE);
        el[t] = el[t] * (1.0f - agl) + (nl ? nl[t] * agl : 0.0f);
        er[t] = er[t] * (1.0f - agl) + (nr ? nr[t] * agl : 0.0f);
      }
#ifndef CYPHERDJ_MUTATION_SC_RET_PRE_NACH_KETTE   // error case: the copy sits behind the chain (below)
      for (int q = 0; q < nkp; ++q) {   // the pre key of a return with a chain: the blend, as it goes into the chain
        std::memcpy(kpl[q], el, bytes);
        std::memcpy(kpr[q], er, bytes);
      }
#endif
      if (abg_pre) abg_ernte(el, er, m);   // tap, return pre with a chain: the Hall blend as it goes into the chain
      ins_.kette(ARR_KETTE_RET0 + r, snap_ ? &snap_->kette[ARR_KETTE_RET0 + r] : nullptr, el, er, m);
#ifdef CYPHERDJ_MUTATION_SC_RET_PRE_NACH_KETTE
      for (int q = 0; q < nkp; ++q) {
        std::memcpy(kpl[q], el, bytes);   // error case: the return pre key is the chain output
        std::memcpy(kpr[q], er, bytes);
      }
#endif
      vorgemischt = true;
    }
#endif
    // 1.10 slice 4b T13: the output of the return waits for the longest arrival at the PM sum; it adds into a sum of its own that is delayed and then joins the PM sum
    int d_ret = pd(PDC_PM_RET0 + r);
#ifdef CYPHERDJ_MUTATION_PDC_DOPPELT
    d_ret += pd(PDC_RETSPUR0 + r);   // error case: the send path is delayed once at the return input and once more at the return output
#endif
    float* rpm_l = pm_l_;
    float* rpm_r = pm_r_;
    const bool ret_sep = d_ret > 0 || pdc_.kreuzt(PDC_PM_RET0 + r, d_ret);   // plan 1.11 (fix round 2): as the groups above, a side sum feeds the ring when there is no delay
#ifdef CYPHERDJ_MUTATION_HOST_PM_NICHT_GEFUETTERT
    float* rfl = nullptr;   // error case: PM_RET is fed only while delayed
    float* rfr = nullptr;
#else
    float* rfl = ret_sep ? nullptr : pdcs_l_;
    float* rfr = ret_sep ? nullptr : pdcs_r_;
#endif
    if (ret_sep) {
      rpm_l = pdcs_l_;
      rpm_r = pdcs_r_;
      std::memset(rpm_l, 0, bytes);
      std::memset(rpm_r, 0, bytes);
    } else if (rfl) {
      std::memset(rfl, 0, bytes);
      std::memset(rfr, 0, bytes);
    }
    for (int t = 0; t < m; ++t) {
      if (fa.vl && (t == 0 || fa.vl[t] != fa.vl[t - 1])) lin = db_lin(fa.vl[t]);
      if (pa.vl) balance_gain(pa.vl[t], gl, gr);
      const bool stumm = (mu.vl ? mu.vl[t] : mu.w) >= 0.5f;
      const bool solo = (so.vl ? so.vl[t] : so.w) >= 0.5f;
#ifdef CYPHERDJ_MUTATION_ARR_RET_SOLO_AUS
      const bool fremd = false;   // error case: a return solo does not silence the other returns
#else
      const bool fremd = (rs_vl || rs_fest) && rs_bei(t);
#endif
      const float ziel = (stumm || (fremd && !solo)) ? 0.0f : 1.0f;
      if (g_ms < ziel) g_ms = std::min(ziel, g_ms + 1.0f / ARR_STUMM_BLENDE);
      else if (g_ms > ziel) g_ms = std::max(ziel, g_ms - 1.0f / ARR_STUMM_BLENDE);
      if (dg < dz) dg = std::min(dz, dg + 1.0f / ARR_RET_BLENDE);
      else if (dg > dz) dg = std::max(dz, dg - 1.0f / ARR_RET_BLENDE);
      if (ag < az) ag = std::min(az, ag + 1.0f / ARR_RET_BLENDE);
      else if (ag > az) ag = std::max(az, ag - 1.0f / ARR_RET_BLENDE);
      const float ql = vorgemischt ? bl[t] : bl[t] * (1.0f - ag) + (nl ? nl[t] * ag : 0.0f);   // dry share falling, wet share rising
      const float qr = vorgemischt ? br[t] : br[t] * (1.0f - ag) + (nr ? nr[t] * ag : 0.0f);
      const float l = ql * lin * gl * g_ms * dg;
      const float rr = qr * lin * gr * g_ms * dg;
      if (abg_pre && !vorgemischt) {   // tap, return pre without a chain: the blend in front of the fader
        abg_l_[t] = ql;
        abg_r_[t] = qr;
      }
      if (abg_post) {   // tap, return post
#ifdef CYPHERDJ_MUTATION_ABGRIFF_VOR_FADER
        abg_l_[t] = ql;   // error case: in front of the return fader
        abg_r_[t] = qr;
#else
        abg_l_[t] = l;
        abg_r_[t] = rr;
#endif
      }
      if (!vorgemischt)   // the pre key of a return without a chain: the blend in front of the fader (with a chain it was copied above, before the chain)
        for (int q = 0; q < nkp; ++q) {
          kpl[q][t] = ql;
          kpr[q][t] = qr;
        }
      for (int q = 0; q < nkq; ++q) {   // the capture point of the return post
#ifdef CYPHERDJ_MUTATION_NUR_SCHLUESSEL_STUMM
        kql[q][t] = l * gz;   // error case (T9): the render mask zeroes the key as well
        kqr[q][t] = rr * gz;
#else
        kql[q][t] = l;
        kqr[q][t] = rr;
#endif
      }
#ifdef CYPHERDJ_MUTATION_ARR_RET_NACH_PM_FADER
      ret_.ein_l(r)[t] = l;   // error case: the return output is added after the PM fader (collected here, added below)
      ret_.ein_r(r)[t] = rr;
#else
      rpm_l[t] += l * gz;
      rpm_r[t] += rr * gz;
      if (rfl) {
        rfl[t] += l * gz;
        rfr[t] += rr * gz;
      }
#endif
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(rr)));
    }
    if (nkp) ins_.fertig(ARR_SCHL_RET, ARR_SCHL_PRE, r + 1, m);
    if (nkq) ins_.fertig(ARR_SCHL_RET, ARR_SCHL_POST, r + 1, m);
    if ((abg_pre && !vorgemischt) || abg_post) abg_ernte(abg_l_, abg_r_, m);
    if (ret_sep) {
      pdc_.verzoegere(PDC_PM_RET0 + r, d_ret, rpm_l, rpm_r, m);
      for (int t = 0; t < m; ++t) {
        pm_l_[t] += rpm_l[t];
        pm_r_[t] += rpm_r[t];
      }
    } else if (rfl) {
      pdc_.verzoegere(PDC_PM_RET0 + r, 0, rfl, rfr, m);   // feed only (see above)
    }
    ms_gain_[s] = g_ms;
    spitze_[s] = sp;
    if (az == 0.0f && ag == 0.0f) ret_.schlafen(r);   // hall off and faded: no tail may hang on for later
    if (!dd && dg == 0.0f) ret_.schlafen(r);          // the return is gone (P9, P15): state to zero after the fade
  }
  // 3. PM-Fader, dann in den Eingang von erz/4. Bei 0 dB ist die Multiplikation x · 1,0f (bitgleich zu vorher, AK1).
  // 1.10 slice 4a T3: the insert chain of the PM, a block-wise pass over the sum (tracks, groups, returns) before the PM fader, so the export tap carries it.
  if (abg_ziel(3, 0)
#ifdef CYPHERDJ_MUTATION_ABGRIFF_VOR_FADER
      || abg_ziel(3, 1)   // error case: the PM post is taken in front of the PM fader too
#endif
  )
    abg_ernte(pm_l_, pm_r_, m);   // 1.10 slice 7: tap, PM pre = the sum of tracks, groups and returns in front of the PM chain
#ifndef CYPHERDJ_MUTATION_INS_PM_NACH_FADER
  if (ins_.hat(ARR_KETTE_PM)) ins_.kette(ARR_KETTE_PM, snap_ ? &snap_->kette[ARR_KETTE_PM] : nullptr, pm_l_, pm_r_, m);
#endif
  {
    const Wert& pf = w_[ARR_PM][0];
    float plin = db_lin(pf.w);
    float sp = spitze_[ARR_PM];
    for (int t = 0; t < m; ++t) {
      if (pf.vl) plin = db_lin(pf.vl[t]);
#ifdef CYPHERDJ_MUTATION_ARR_PM_FADER_AUS
      plin = 1.0f;   // Fehlerfall: der PM-Fader wirkt nicht
#endif
      const float l = pm_l_[t] * plin;
      const float r = pm_r_[t] * plin;
      pm_l_[t] = l;
      pm_r_[t] = r;
#ifndef CYPHERDJ_MUTATION_INS_PM_NACH_FADER
      aus_l[t] += l;
      aus_r[t] += r;
#endif
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    spitze_[ARR_PM] = sp;
  }
#ifndef CYPHERDJ_MUTATION_ABGRIFF_VOR_FADER
  if (abg_ziel(3, 1)) abg_ernte(pm_l_, pm_r_, m);   // 1.10 slice 7: tap, PM post = the export tap (after chain and PM fader)
#endif
  if (abg_) abg_blockende(m);
  if (exp_) export_blockende(m);   // plan 1.11 T12: the export run takes the PM post point (the same buffers the tap reads)
#ifdef CYPHERDJ_MUTATION_INS_PM_NACH_FADER
  {   // error case: the chain sits after the PM fader (tap and output both)
    if (ins_.hat(ARR_KETTE_PM)) ins_.kette(ARR_KETTE_PM, snap_ ? &snap_->kette[ARR_KETTE_PM] : nullptr, pm_l_, pm_r_, m);
    for (int t = 0; t < m; ++t) {
      aus_l[t] += pm_l_[t];
      aus_r[t] += pm_r_[t];
    }
  }
#endif
#ifdef CYPHERDJ_MUTATION_ARR_RET_NACH_PM_FADER
  for (int r = 0; r < ARR_RETURNS; ++r)
    if (ret_.rechnet(r, da(r)))
      for (int t = 0; t < m; ++t) {
        pm_l_[t] += ret_.ein_l(r)[t];
        pm_r_[t] += ret_.ein_r(r)[t];
        aus_l[t] += ret_.ein_l(r)[t];
        aus_r[t] += ret_.ein_r(r)[t];
      }
#endif
}

void Arrangement::verlaeufe_nachfuehren(int m) {
  ins_.nachfuehren(m);
  for (int s = 0; s < ARR_STREIFEN; ++s)
    for (int f = 0; f < ARR_FELDER; ++f) {
      Wert& w = w_[s][f];
      if (w.vl) {
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_GRUND_UEBERSCHRIEBEN
        w.w = w.vl[m - 1];   // error case: the lane value becomes the base value of the fader
#else
        // Automation Slice 1 (D5a point 4): w.w stays the stellwerk or base value, never a lane value; a stellwerk course that ran this block ends in w.w
        if (s < ARR_SPUREN && f < AUTO_FELDER && w.vl == auto_buf_[s][f]) {
          if (w.sw_vl) w.w = w.sw_vl[m - 1];
        } else {
          w.w = w.vl[m - 1];
        }
#endif
        w.vl = nullptr;
      }
      w.sw_vl = nullptr;
    }
}

}  // namespace cdj

namespace cdj {

// The hall controls of the return strips as the Halls should hold them now (base values). Main thread, kernel not running: the constructor, and the export
// before block 0, so export and playback start with the same Hall settings (P8 a).
void Arrangement::hall_sofort() {
  float hx[ARR_RETURNS][ARR_HALL_PARAM];
  for (int r = 0; r < ARR_RETURNS; ++r)
    for (int k = 0; k < ARR_HALL_PARAM; ++k) hx[r][k] = std::clamp(w_[ARR_RET0 + r][5 + k].w, 0.0f, 1.0f);
  ret_.hall_sofort(hx);
}

}  // namespace cdj
