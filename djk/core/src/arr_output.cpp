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
#include <cstdio>

#include "arr_gain_intern.h"
#include "cypherdj/arrangement.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;

static_assert(ARR_SPUREN == sw::SPUR_REGLER_SPUREN, "track slots and track rows must be the same number (E3; strand 1 slice 6: 128)");
static_assert(ARR_GRUPPEN == sw::GRP_REGLER_GRUPPEN_ALLE, "Gruppen-Slots und Gruppen-Regler müssen gleich viele sein (1.10)");
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
  if (r >= sw::Rolle::ins_bk_an && r <= sw::Rolle::ins_bk_k64) {   // arr-bk slice 3: ins/bk/<n>/an and k1..k64 (parameter 0..64)
    const int n = ins_nr(d.pfad, "ins/bk/", ARR_INS_BK, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::bk, n - 1);
    *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_bk_an);
    return true;
  }
  if (r >= sw::Rolle::ins_gate_an && r <= sw::Rolle::ins_gate_release) {   // strand 1 slice 4: ins/gate/<n>/<parameter>, parameter 0..7 in the order of the roles
    const int n = ins_nr(d.pfad, "ins/gate/", ARR_INS_GATE, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::gate, n - 1);
    *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_gate_an);
    return true;
  }
  if (r >= sw::Rolle::ins_mb_an && r <= sw::Rolle::ins_mb_b_umgehen) {   // strand 1 slice 4: ins/mb/<n>/{an,grenze_tief,grenze_hoch} and ins/mb/<n>/b<m>/<parameter>, m = 1..3
    const int n = ins_nr(d.pfad, "ins/mb/", ARR_INS_MB, &rest);
    if (n < 1) return false;
    *slot = ins_global(ArrInsArt::mb, n - 1);
    if (r <= sw::Rolle::ins_mb_grenze_hoch) {
      *param = static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_mb_an);
    } else {   // "b<m>/<name>"
      if (rest[0] != 'b' || rest[1] < '1' || rest[1] > '3' || rest[2] != '/') return false;
      *param = 3 + (rest[1] - '1') * INS_MB_BAND_PARAM + (static_cast<int>(r) - static_cast<int>(sw::Rolle::ins_mb_b_schwelle));
    }
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
  for (auto& je_spur : feld_regler_)
    for (int16_t& r : je_spur) r = -1;
  for (int r = 0; r < sw::MAX_REGLER; ++r) {
    regler_spur_[r] = -1;   // strip index (track 0..127, group 128..143, PM 144, returns 145..152), name from D1 K1
    regler_feld_[r] = -1;
    regler_ins_[r] = -1;
    regler_rack_[r] = -1;
    regler_bkz_[r] = -1;
  }
  for (auto& je_slot : bk_ueber_)
    for (BkUeber& u : je_slot) u = BkUeber{};
  for (int8_t& s : bk_slot_) s = -1;
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
    if (d.rolle == sw::Rolle::spur_bk) {   // production plan task 8: spur/<slot>/bk/<k>
      int slot = 0, knopf = 0;
      if (std::sscanf(d.pfad, "spur/%d/bk/%d", &slot, &knopf) == 2 && slot >= 1 && slot <= BK_UEBER_SLOTS && knopf >= 1 && knopf <= BK_UEBER_KNOEPFE)
        regler_bkz_[r] = static_cast<int16_t>((slot - 1) * BK_UEBER_KNOEPFE + (knopf - 1));
      continue;
    }
    if ((d.rolle >= sw::Rolle::ins_komp_an && d.rolle <= sw::Rolle::ins_saett_mix) ||
        (d.rolle >= sw::Rolle::ins_lim_an && d.rolle <= sw::Rolle::ins_bk_k64) ||
        (d.rolle >= sw::Rolle::ins_gate_an && d.rolle <= sw::Rolle::ins_mb_b_umgehen)) {   // strand 1 slice 4: gate and mb   // 1.10 slice 4a/4b + limiter + plan 1.11 host + arr-fx utility: the pooled insert rows (komp, eq, saett, lim, host, utility)
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
      case sw::Rolle::grp_cue: feld = ARR_F_CUE; break;   // live modules task 6
      case sw::Rolle::spur_filter: feld = ARR_F_FILTER; break;   // loop deck K7a
      case sw::Rolle::spur_eq_tief: feld = ARR_F_EQ0 + 0; break;   // loop deck channel strip KZ1
      case sw::Rolle::spur_eq_mitte: feld = ARR_F_EQ0 + 1; break;
      case sw::Rolle::spur_eq_hoch: feld = ARR_F_EQ0 + 2; break;
      case sw::Rolle::spur_pfl: feld = ARR_F_CUE; break;   // container core K7: the track pfl rides on the cue field (groups use it as their cue switch)
      case sw::Rolle::spur_trim: feld = ARR_F_TRIM; break;
      case sw::Rolle::spur_kill_tief: feld = ARR_F_KILL0 + 0; break;
      case sw::Rolle::spur_kill_mitte: feld = ARR_F_KILL0 + 1; break;
      case sw::Rolle::spur_kill_hoch: feld = ARR_F_KILL0 + 2; break;
      case sw::Rolle::spur_fx_1: feld = ARR_F_FX0 + 0; break;   // loop lane strip K1
      case sw::Rolle::spur_fx_2: feld = ARR_F_FX0 + 1; break;
      case sw::Rolle::spur_fx_3: feld = ARR_F_FX0 + 2; break;
      case sw::Rolle::snd_spur: case sw::Rolle::snd_grp: {
        const int ri = sw::send_nr(d.pfad) - 1;   // "…/send/<r>"
        if (ri >= 0 && ri < ARR_RETURNS) feld = arr_f_send(ri);
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
               d.rolle == sw::Rolle::grp_solo || d.rolle == sw::Rolle::grp_cue) {
      const int g = sw::grp_nr(d.pfad) - 1;   // "grp/<n>/…"
      if (g >= 0 && g < ARR_GRUPPEN) streifen = ARR_SPUREN + g;
    } else {
      const int s = sw::spur_nr(d.pfad) - 1;   // "spur/<n>/…", mehrstellig (E3)
      if (s >= 0 && s < ARR_SPUREN) streifen = s;
    }
    if (streifen < 0) continue;
    regler_spur_[r] = static_cast<int16_t>(streifen);
    regler_feld_[r] = static_cast<int8_t>(feld);
    if (streifen < ARR_SPUREN && feld >= 0 && feld < ARR_FELDER) feld_regler_[streifen][feld] = static_cast<int16_t>(r);
    if (streifen < ARR_SPUREN && feld < 4 &&
        (d.rolle == sw::Rolle::spur_fader || d.rolle == sw::Rolle::spur_pan || d.rolle == sw::Rolle::spur_mute || d.rolle == sw::Rolle::spur_solo))
      spur_regler_[streifen][feld] = static_cast<int16_t>(r);   // 1.12 S3: only spur/1..128/{fader,pan,mute,solo} can be grabbed (D1)
    if (d.rolle == sw::Rolle::ret_fader && streifen >= ARR_RET0 && streifen < ARR_RET0 + ARR_RETURNS && feld == ARR_AUTO_FADER)
      spur_regler_[ARR_SPUREN + (streifen - ARR_RET0)][ARR_AUTO_FADER] = static_cast<int16_t>(r);   // the hand overrides a return fader lane like a track fader lane
    w_[streifen][feld].w = d.vorgabe;
  }
  for (float& g : ms_gain_) g = 1.0f;
  for (float& w : ziel_w_) w = 1.0f;
  for (float& w : gziel_w_) w = 1.0f;
  hall_sofort();   // the Halls start on the default controls (constructor, outside the callback)
}

void Arrangement::setze_sofort(int regler, float wert) {
  if (regler >= 0 && regler < sw::MAX_REGLER && regler_bkz_[regler] >= 0) {   // production plan task 8: before the track branch, like the rack and insert rows
    BkUeber& u = bk_ueber_[regler_bkz_[regler] / BK_UEBER_KNOEPFE][regler_bkz_[regler] % BK_UEBER_KNOEPFE];
    u.wert = wert;
    u.vl = nullptr;
    u.da = true;
    return;
  }
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
  if (regler >= 0 && regler < sw::MAX_REGLER && regler_bkz_[regler] >= 0) {   // production plan task 8: the block takes the last sample (bk_ueber_nehmen), as ArrInserts::nachfuehren does
    if (werte) bk_ueber_[regler_bkz_[regler] / BK_UEBER_KNOEPFE][regler_bkz_[regler] % BK_UEBER_KNOEPFE].vl = werte;
    return;
  }
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
// Nur eine Spur, die schon vorher gehalten wurde und weiter gehalten wird, blendet (Live-Module: ein Reload, der nur Modul B ändert, darf B nicht in den Master lecken):
//  - Platz leer im neuen Schnappschuss (Spur weg): das letzte Ziel bleibt, der Ausklang der Spur läuft durch ihre Gruppe, nicht an den Fadern vorbei in den Master.
//  - Platz vorher leer, jetzt gehalten (Spur neu): das Ziel gilt sofort, es gibt nichts auszublenden (die Blende ließ den neuen Klang 10 ms lang in den Master laufen).
void Arrangement::ziele_pruefen() {
  if (!snap_) return;
  for (int i = 0; i < ARR_SPUREN; ++i) {
#ifdef CYPHERDJ_MUTATION_ARR_ZIEL_IGNORIERT
    const int8_t soll = 0;   // Fehlerfall: jede Spur bleibt auf master, die Gruppe bekommt nie ein Signal
#else
    const int8_t soll = snap_->spur[i].ausgang;
#endif
#ifndef CYPHERDJ_MUTATION_ARR_ZIEL_BLENDE_IMMER   // Fehlerfall (Live-Module-Reload): jede Änderung blendet, auch eine neue oder weggefallene Spur (B leckt in den Master)
    if (snap_->spur[i].art == ArrArt::leer) {
      ziel_ok_[i] = false;
      continue;
    }
    if (!ziel_ok_[i]) {
      ziel_ok_[i] = true;
      ziel_[i] = soll;
      ziel_w_[i] = 1.0f;
      continue;
    }
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
  // Nested groups, decision 4: a group changes its target like a track, but the blend needs the old target to be open when the group adds, i.e. its level in the NEW order is higher than the
  // group's (the master always is). An old target on the same or a lower level has run already in the new order, a blend into it would lose the tail: a hard switch at the block start (at most
  // one block of discontinuity, only in these moves; A in B becoming B in A needs no blend into a cycle). A blend that runs on into a block whose order closed the old target ends the same way.
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    const int8_t soll = snap_->gruppe_ausgang[g];
#ifndef CYPHERDJ_MUTATION_ARR_ZIEL_BLENDE_IMMER
    if (!grp_belegt_[g]) {   // nobody feeds the group (but the tail of tracks that just left): its target follows the snapshot at once. It must, the order of the passes (parents first) comes from the snapshot
      gziel_ok_[g] = false;
      gziel_[g] = soll;
      gziel_alt_[g] = 0;
      gziel_w_[g] = 1.0f;
      continue;
    }
    if (!gziel_ok_[g]) {   // the group is fed from now on: its target holds at once, nothing to blend
      gziel_ok_[g] = true;
      gziel_[g] = soll;
      gziel_alt_[g] = 0;
      gziel_w_[g] = 1.0f;
      continue;
    }
#endif
    if (soll != gziel_[g]) {
      const int alt = gziel_[g];
      gziel_alt_[g] = static_cast<int8_t>(alt);
      gziel_[g] = soll;
      gziel_w_[g] = (alt == 0 || snap_->gruppen_ebene[alt - 1] > snap_->gruppen_ebene[g]) ? 0.0f : 1.0f;
    } else if (gziel_w_[g] < 1.0f && gziel_alt_[g] > 0 && snap_->gruppen_ebene[gziel_alt_[g] - 1] <= snap_->gruppen_ebene[g]) {
      gziel_w_[g] = 1.0f;
    }
  }
}

// Container core K7: the track trim of track i over m samples, in place (strand 12 B2: one function for the unit and for mischen())
void Arrangement::trim_anwenden(int i, int m) {
  const Wert& tr = w_[i][ARR_F_TRIM];
  if (!tr.vl && (tr.w == 0.0f || tr.w != tr.w)) return;
  auto klemm = [](float v) { return v != v ? 0.0f : std::min(24.0f, std::max(-24.0f, v)); };
  float g = db_lin(klemm(tr.w));
  for (int t = 0; t < m; ++t) {
    if (tr.vl && (t == 0 || tr.vl[t] != tr.vl[t - 1])) g = db_lin(klemm(tr.vl[t]));
    bus_l_[i][t] *= g;
    bus_r_[i][t] *= g;
  }
}

void Arrangement::mischen(int m, float* aus_l, float* aus_r) {
  ziele_pruefen();
  for (bool& b : dj_fx3_da_) b = false;   // loop lane strip K4: the pairs of the diverted FX 3 share are untouched until a track adds to them
  const bool dj_rest_gilt = dj_rest_n_ > 0;   // DJ view places: the held DJ channels of groups that just left (tausche); block() counts them down AFTER this pass, so the block that ends the hold still uses it
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
  // nested groups: the groups in the order they run (level, then index; the identity without a snapshot) and the level of a group
  const auto g_ordnung = [&](int k) { return snap_ ? static_cast<int>(snap_->gruppen_ordnung[k]) : k; };
  const auto g_ebene = [&](int g) { return snap_ ? static_cast<int>(snap_->gruppen_ebene[g]) : 0; };
  bool benutzt[ARR_GRUPPEN] = {};   // schickt irgendeine Spur oder eine benutzte Untergruppe in diesem Block in die Gruppe (auch in der Blende)?
  for (int i = 0; i < ARR_SPUREN; ++i) {
    if (ziel_[i] > 0) benutzt[ziel_[i] - 1] = true;
    if (ziel_w_[i] < 1.0f && ziel_alt_[i] > 0) benutzt[ziel_alt_[i] - 1] = true;
  }
  for (int k = 0; k < ARR_GRUPPEN; ++k) {   // transitive: children come before their parents in the order, so one pass marks every ancestor of a used group
    const int g = g_ordnung(k);
    if (!benutzt[g]) continue;
    if (gziel_[g] > 0) benutzt[gziel_[g] - 1] = true;
    if (gziel_w_[g] < 1.0f && gziel_alt_[g] > 0) benutzt[gziel_alt_[g] - 1] = true;
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
  // Nested groups, solo (decision 1), once per block: msolo = a track or a group below has solo (the group must play, so that the soloed signal reaches the master),
  // vsolo = the group or an ancestor has solo (everything below plays). Children before parents for the first, parents before children for the second; flat: vsolo = the group's own solo.
  bool vsolo_fest[ARR_GRUPPEN] = {};
  if (solo_vl) {
    for (int k = 0; k < ARR_GRUPPEN; ++k) {
      const int g = g_ordnung(k);
      if (!benutzt[g] || gziel_[g] == 0) continue;
      const int p = gziel_[g] - 1;
      for (int t = 0; t < m; ++t) msolo_t_[p][t] = msolo_t_[p][t] || solo_bei(ARR_SPUREN + g, t) || msolo_t_[g][t];
    }
    for (int k = ARR_GRUPPEN - 1; k >= 0; --k) {
      const int g = g_ordnung(k);
      if (!benutzt[g]) continue;
      const int p = gziel_[g] - 1;
      for (int t = 0; t < m; ++t) vsolo_t_[g][t] = solo_bei(ARR_SPUREN + g, t) || (p >= 0 && vsolo_t_[p][t]);
    }
  } else {
    for (int k = 0; k < ARR_GRUPPEN; ++k) {
      const int g = g_ordnung(k);
      if (benutzt[g] && gziel_[g] > 0 && (w_[ARR_SPUREN + g][3].w >= 0.5f || msolo_fest[g])) msolo_fest[gziel_[g] - 1] = true;
    }
    for (int k = ARR_GRUPPEN - 1; k >= 0; --k) {
      const int g = g_ordnung(k);
      if (benutzt[g]) vsolo_fest[g] = w_[ARR_SPUREN + g][3].w >= 0.5f || (gziel_[g] > 0 && vsolo_fest[gziel_[g] - 1]);
    }
  }
  // 0. Gruppen-Blende im Vorlauf (P14): Mute/Solo-Blende jeder benutzten Gruppe je Sample. Sie hängt nur an Reglern, nicht am Audio; die Sends der Mitglieder
  // (Schritt 1) und die Gruppen-Schleife (Schritt 2) lesen sie. Dieselbe Arithmetik wie früher in der Gruppen-Schleife (bitgleich, AK1).
  for (int g = 0; g < ARR_GRUPPEN; ++g) {
    if (!benutzt[g]) continue;
    const int s = ARR_SPUREN + g;
    const Wert& mu = w_[s][2];
    const Wert& so = w_[s][3];
    float g_ms = ms_gain_[s];
    const int gp = gziel_[g];
    for (int t = 0; t < m; ++t) {
      const bool solo_irgendwo = solo_vl ? solo_t_[t] : solo_fest;
      const bool stumm = (mu.vl ? mu.vl[t] : mu.w) >= 0.5f;
      const bool solo = (so.vl ? so.vl[t] : so.w) >= 0.5f;
      const bool mitglied_solo = solo_vl ? msolo_t_[g][t] : msolo_fest[g];
      const bool oben_solo = gp > 0 && (solo_vl ? vsolo_t_[gp - 1][t] : vsolo_fest[gp - 1]);   // an ancestor has solo: everything below it plays
      const float ziel = (stumm || (solo_irgendwo && !solo && !mitglied_solo && !oben_solo)) ? 0.0f : 1.0f;
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
  // Nested groups: what a send is scaled by is the product of the fades of the group and of all its ancestors (decision 2: the fader and pan of a parent do not act on the sends of its
  // children, only mute and solo do). A top-level group: its own fade is the product (gblende_ itself, no copy, no extra multiplication); parents come first.
  const float* gsend[ARR_GRUPPEN] = {};
  for (int k = ARR_GRUPPEN - 1; k >= 0; --k) {
    const int g = g_ordnung(k);
    if (!benutzt[g]) continue;
    const int p = gziel_[g] - 1;
    if (p < 0) {
      gsend[g] = gblende_[g];
      continue;
    }
    for (int t = 0; t < m; ++t) gblende_s_[g][t] = gblende_[g][t] * gsend[p][t];
    gsend[g] = gblende_s_[g];
  }
  // Send einer Quelle (Spur oder Gruppe) in die Returns vorbereiten: aktiv = der Return rechnet, und der Send hat einen Verlauf oder liegt über −120 dB
  // (sonst bleibt ein Projekt ohne Sends bitgleich, AK1). Gibt die Zahl der aktiven Sends zurück.
  struct Send {
    bool aktiv = false;
    const float* vl = nullptr;
    float lin = 0.0f;
    // send automation: a lane ramp of this block (auto_send), the gain in closed form per sample so a skipped sample cannot drift it. Part one runs a0 -> b0 over [0, ts), part two
    // (a loop seam inside the block, ts < m) a1 -> b1 over [ts, m). Unused (rampe false) for a cell envelope, a knob and every group.
    bool rampe = false;
    float a0 = 0.0f, b0 = 0.0f, a1 = 0.0f, b1 = 0.0f;
    int ts = 0, m = 0;
  };
  // K5 (D-K3): the structural send mask of a live cypherdj-arr/4 snapshot. A strip whose top group leads into DJ output N reaches only the returns with ret_dj N; the weight of any other send is
  // ignored, whatever a row write set. dj = the DJ output of the strip's top group (0 = none: nothing is masked).
  const auto top_dj = [&](int g) {   // g = 1-based group number, 0 = none
    for (int n = 0; g > 0 && n <= ARR_GRUPPEN; ++n) {
      if (snap_->gruppe_ausgang[g - 1] <= 0) return static_cast<int>(snap_->gruppe_dj[g - 1]);
      g = snap_->gruppe_ausgang[g - 1];
    }
    return 0;
  };
  const auto sends_bereiten = [&](int streifen, Send* sd, int dj) {
    int n = 0;
    for (int r = 0; r < ARR_RETURNS; ++r) {
      const Wert sw_ = wert_ueber(streifen, arr_f_send(r));   // S1b K5: a cell envelope wins over the knob
      // send automation: cell envelope > lane > knob. A track only (a group has no lane); the lane plan holds the gain ramp of this block
      const bool zelle_da = streifen >= 0 && streifen < ARR_SPUREN && zell_ueber_[streifen][arr_f_send(r)].da && zell_ueber_[streifen][arr_f_send(r)].zeile >= 0;
      const SendPlan* sl = streifen >= 0 && streifen < ARR_SPUREN && !zelle_da && send_plan_[streifen][r].da ? &send_plan_[streifen][r] : nullptr;
#ifdef CYPHERDJ_MUTATION_ARR_SENDMASKE_AUS
      const bool fremd = false;   // error case: the mask is off, a row write crosses modules
#else
      const bool fremd = snap_ && snap_->send_maske && snap_->ret_da[r] && snap_->ret_dj[r] != dj;
#endif
      if (sl) {   // the lane: exact 0 at -200 dB (db_lin), such a send does not feed the return at all
        const bool zwei = sl->ts < m;
        sd[r].aktiv = !fremd && ret_.rechnet(r, da(r)) && (sl->a0 > 0.0f || sl->b0 > 0.0f || (zwei && (sl->a1 > 0.0f || sl->b1 > 0.0f)));
        sd[r].vl = nullptr;
        sd[r].rampe = sl->a0 != sl->b0 || zwei;
        sd[r].a0 = sl->a0, sd[r].b0 = sl->b0, sd[r].a1 = sl->a1, sd[r].b1 = sl->b1;
        sd[r].ts = sl->ts, sd[r].m = m;
        sd[r].lin = sl->a0;
      } else {
      sd[r].aktiv = !fremd && ret_.rechnet(r, da(r)) && (sw_.vl || sw_.w > -120.0f);
      sd[r].vl = sw_.vl;
      sd[r].lin = db_lin(sw_.w);
      }
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
  // Strand 12 B2: makros_planen(), schluessel_planen() and the DJ key copies run in block() before phase Q (a track chain may run inside its unit); kette_einheit_ marks the tracks
  // whose trim and chain ran there. Their trim, key copy and chain are skipped below; PDC, filter, the fader loop, sends and the post capture are unchanged.
  // Container core K7: the track trim (spur/<n>/trim, dB, -24..+24) in front of everything the strip does, also in front of the key copy below: the strip, the sidechain keys and the sends all see the
  // trimmed signal, like the trim of a container strip. A base value of 0 and no course is skipped (bit-equal). The gain is computed again only where the value changes. No allocation.
  for (int i = 0; i < ARR_SPUREN; ++i)
    if (!kette_einheit_.test(i)) trim_anwenden(i, m);
#ifndef CYPHERDJ_MUTATION_INS_SC_NACH_KETTE
  ins_.schluessel_maske().je_bit([&](int t) { ins_.schluessel_sichern(t, bus_l_[t], bus_r_[t], m); });   // ascending, as the loop before
#endif
  // 1.10 slice 5 U1: one pass per track in snap_->spur_ordnung: the chain, the delay compensation, then the fader loop of the track below. A track whose stage listens to the
  // post of another track runs after it (arr_key.h); the order is the identity without such keys, so the sums are formed in the order of the build before this slice.
  for (int ii = 0; ii < ARR_SPUREN; ++ii) {
#ifdef CYPHERDJ_MUTATION_INS_SC_NACH_KETTE
    const int i = ARR_SPUREN - 1 - ii;   // error case: the key is taken after the key track's own chain (high tracks run first so that it is there in time)
#else
    const int i = snap_ ? static_cast<int>(snap_->spur_ordnung[ii]) : ii;
#endif
    if (ins_.hat(i) && !kette_einheit_.test(i)) {   // strand 12 B2: a track of kette_einheit_ ran its chain in its unit
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
    // Loop deck K7b: the DJ filter of the track (spur/<n>/filter, -1 low-pass .. +1 high-pass), behind the chain and the delay compensation, in front of the monitor join and the fader loop.
    // The value is read per sample like the fader (a lane or a stellwerk course in vl, else the base value). Skipped while it is 0 over the whole block and the filter holds no state:
    // that is bit-equal to running it (DjFilter is exactly dry at k = 0). Scratch is a member: no allocation, no lock.
    // Loop lane strip K2: while the colour art is not FILTER the same value drives the track's ColorFx instead of the DjFilter, with the per-sample k the DjFilter would get (cell envelopes included), the
    // switching of the mixer's Kanalzug: an art change clears the states of the instance (and of the DjFilter when it comes from FILTER), the dead zone |k| < 0.05 is bit-dry unless a tail runs, and an idle
    // track (dead zone over the whole block, no tail, states clear) skips the work. With the art FILTER nothing of this runs and the DjFilter path below is what it was.
    {
      const Wert fi = wert_ueber(i, ARR_F_FILTER);   // S1b K5: a cell envelope wins over the knob
#ifdef CYPHERDJ_MUTATION_ARR_COLOR_ART_STARR
      const int col_art_ = 0;   // error case: the colour art is never taken over, the track always runs the DjFilter
#endif
      if (col_art_ != col_lage_[i]) {   // the art changed since this track last ran its filter stage
        if (col_lage_[i] == 0) filt_[i].leeren();
        col_[i].setze(col_art_, col_param_, col_spb_);   // an art change clears the instance (back to FILTER: idle, nothing runs)
        if (col_art_ == 0) col_[i].leeren();
        col_lage_[i] = static_cast<int8_t>(col_art_);
      }
      if (col_art_ != 0) {
        double kmax = 0.0;
        if (fi.vl) {
          for (int t = 0; t < m; ++t) {
            const float v = fi.vl[t];
            const double k = v != v ? 0.0 : std::min(1.0, std::max(-1.0, static_cast<double>(v)));
            filt_k_[t] = k;
            kmax = std::max(kmax, std::fabs(k));
          }
        } else {
          const double k = fi.w != fi.w ? 0.0 : std::min(1.0, std::max(-1.0, static_cast<double>(fi.w)));
          std::fill(filt_k_, filt_k_ + m, k);
          kmax = std::fabs(k);
        }
        if (!col_[i].ruhig(kmax)) {
          col_[i].setze(col_art_, col_param_, col_spb_);
          col_[i].verarbeite(bus_l_[i], bus_r_[i], m, filt_k_);
        }
      } else {
      bool alle_null = !fi.vl && fi.w == 0.0f;
      if (!alle_null || !filt_[i].leer()) {
        if (fi.vl) {
          alle_null = true;
          for (int t = 0; t < m; ++t) {
            const float v = fi.vl[t];
            const double k = v != v ? 0.0 : std::min(1.0, std::max(-1.0, static_cast<double>(v)));   // NaN is centre, the range is -1..+1
            filt_k_[t] = k;
            if (k != 0.0) alle_null = false;
          }
        } else {
          const double k = fi.w != fi.w ? 0.0 : std::min(1.0, std::max(-1.0, static_cast<double>(fi.w)));
          std::fill(filt_k_, filt_k_ + m, k);
          alle_null = k == 0.0;
        }
        if (!alle_null || !filt_[i].leer()) {
          filt_[i].verarbeite(bus_l_[i], bus_r_[i], m, filt_k_);
          filt_[i].abschneiden(1e-300);   // as Kanalzug does: a decayed state becomes exactly 0, so a silent track at k = 0 skips the filter again
        }
      }
      }
    }
    // Loop deck channel strip KZ2: the 3-band isolator of the track (spur/<n>/eq/{tief,mitte,hoch}, dB per sample from ARR_F_EQ0 + 0..2), directly behind the DJ filter. While all three bands are
    // 0 dB (no course, base 0) the track is in bypass and nothing runs: bit-equal. An LR8 split summed at unity is an allpass, not the identity, so entering and leaving the processed state
    // crossfade dry <-> wet over ARR_NAHT samples; after leaving the isolator is cleared. No allocation, no lock: the isolators are heap objects of the constructor, the scratch is a member.
    {
      bool neutral = true;
      for (int b = 0; b < 3; ++b) {
        const Wert& fb = w_[i][ARR_F_EQ0 + b];
        if (fb.vl) {
          for (int t = 0; t < m; ++t) {
            const float v = fb.vl[t];
            if (v != v || v == 0.0f) continue;
            neutral = false;
            break;
          }
        } else if (fb.w == fb.w && fb.w != 0.0f) {
          neutral = false;
        }
        const Wert& fk = w_[i][ARR_F_KILL0 + b];   // container core K7: a kill is not neutral while it is above 0 (anywhere in the block)
        if (fk.vl) {
          for (int t = 0; t < m; ++t) {
            const float v = fk.vl[t];
            if (v != v || v <= 0.0f) continue;
            neutral = false;
            break;
          }
        } else if (fk.w == fk.w && fk.w > 0.0f) {
          neutral = false;
        }
      }
      uint8_t lage = iso_lage_[i];
      if (lage == 0 && !neutral) { lage = 1; iso_blende_[i] = 0; }
      else if (lage == 3 && !neutral) lage = 1;                         // back from the current share, no jump
      else if ((lage == 1 || lage == 2) && neutral) lage = 3;           // a share of ARR_NAHT (running) or the current one (entering) falls to dry
      if (lage != 0) {
        for (int b = 0; b < 3; ++b) {   // gains per sample: NaN is 0 dB, the range is -200..+6; db_lin gives exactly 0 for a kill
          const Wert& fb = w_[i][ARR_F_EQ0 + b];
          if (fb.vl) {
            for (int t = 0; t < m; ++t) {
              const float v = fb.vl[t];
              iso_g_[b][t] = db_lin(v != v ? 0.0f : std::min(6.0f, std::max(-200.0f, v)));
            }
          } else {
            std::fill(iso_g_[b], iso_g_[b] + m, db_lin(fb.w != fb.w ? 0.0f : std::min(6.0f, std::max(-200.0f, fb.w))));
          }
          // Container core K7: the kill (spur/<n>/kill/<band>, 0/1) scales the band gain by (1 - kill), as Kanalzug does; the eq value itself is never touched, so the stored eq returns on release.
          const Wert& fk = w_[i][ARR_F_KILL0 + b];
#ifdef CYPHERDJ_MUTATION_SPUR_KILL_OHNE_RUECKKEHR
          if ((fk.vl ? fk.vl[0] : fk.w) > 0.5f) w_[i][ARR_F_EQ0 + b].w = -200.0f;   // error case: the kill overwrites the stored eq value, nothing brings it back
#endif
          if (fk.vl) {
            for (int t = 0; t < m; ++t) {
              const float v = fk.vl[t];
              iso_g_[b][t] *= 1.0f - (v != v ? 0.0f : std::min(1.0f, std::max(0.0f, v)));
            }
          } else if (fk.w == fk.w && fk.w > 0.0f) {
            const float k = 1.0f - std::min(1.0f, fk.w);
            for (int t = 0; t < m; ++t) iso_g_[b][t] *= k;
          }
        }
        const bool blende = lage != 2 || iso_blende_[i] < ARR_NAHT;
        if (blende) {
          std::copy(bus_l_[i], bus_l_[i] + m, iso_trocken_l_);
          std::copy(bus_r_[i], bus_r_[i] + m, iso_trocken_r_);
        }
        iso_[i].verarbeite(bus_l_[i], bus_r_[i], bus_l_[i], bus_r_[i], m, iso_g_[0], iso_g_[1], iso_g_[2]);
        if (blende) {
          int u = iso_blende_[i];
          const int schritt = lage == 3 ? -1 : 1;
          for (int t = 0; t < m; ++t) {
            u = std::min(ARR_NAHT, std::max(0, u + schritt));
            const float a = static_cast<float>(u) / static_cast<float>(ARR_NAHT);   // the wet share
            bus_l_[i][t] = iso_trocken_l_[t] + (bus_l_[i][t] - iso_trocken_l_[t]) * a;
            bus_r_[i][t] = iso_trocken_r_[t] + (bus_r_[i][t] - iso_trocken_r_[t]) * a;
          }
          iso_blende_[i] = static_cast<int16_t>(u);
        }
        iso_[i].abschneiden(1e-300);
        if (lage == 1 && iso_blende_[i] >= ARR_NAHT) lage = 2;
        else if (lage == 3 && iso_blende_[i] <= 0) {   // dry again: clear the state and fall back to bypass
          iso_[i].leeren();
          lage = 0;
        }
      }
      iso_lage_[i] = lage;
    }
#ifndef CYPHERDJ_MUTATION_MONITOR_NACH_FADER
    // 1.8 T1 (slice 3b-lite): the dry monitor of an external input joins the track here, after the chain and the delay (no latency of the chains), before the fader loop below
    if (mon_[i].klingt) monitor_spur_addieren(i, m, bus_l_[i], bus_r_[i]);
#endif
#ifdef CYPHERDJ_MUTATION_INS_SC_NACH_KETTE
    if (ins_.schluessel_maske().test(i)) ins_.schluessel_sichern(i, bus_l_[i], bus_r_[i], m);
#endif
    // Container core K7: the track pfl (spur/<n>/pfl, rides on the cue field) puts the track signal as it stands here (behind trim, chain, filter, EQ and kill, in front of fader, pan and the mute fade, like the
    // group cue and the PFL of a container strip) into the cue sum; the master path is not touched. With the row at 0 nothing is written: the cue bus stays bit-identical.
    if (cue_l_ && cue_r_) {
      const Wert& pf = w_[i][ARR_F_CUE];
      if (pf.vl) {
        for (int t = 0; t < m; ++t)
          if (pf.vl[t] >= 0.5f) {
            cue_l_[t] += bus_l_[i][t];
            cue_r_[t] += bus_r_[i][t];
          }
      } else if (pf.w >= 0.5f) {
        for (int t = 0; t < m; ++t) {
          cue_l_[t] += bus_l_[i][t];
          cue_r_[t] += bus_r_[i][t];
        }
      }
    }
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
    const bool* gso_t = zg > 0 && solo_vl ? vsolo_t_[zg - 1] : nullptr;   // solo of the group or of an ancestor: the track plays along
    const bool gso_f = zg > 0 && !solo_vl && vsolo_fest[zg - 1];
    float zw = ziel_w_[i];
    bool blende = zw < 1.0f;
    float* al = nullptr;
    float* ar = nullptr;
    if (blende) {
      const int za = ziel_alt_[i];
      al = za == 0 ? pm_l_ : grp_l_[za - 1];
      ar = za == 0 ? pm_r_ : grp_r_[za - 1];
    }
    const int dj_k = snap_ && snap_->spur[i].ausgang > 0 ? top_dj(snap_->spur[i].ausgang) : 0;   // the DJ channel the track's top group leads into (0 = none)
    Send sd[ARR_RETURNS];
    const int n_sends = sends_bereiten(i, sd, dj_k);
    // Loop lane strip K3: the track's beat FX instances (spur/<n>/fx/1, /2). A row switch opens or closes the input of the instance of the track's pool slot (Mixer::fx_zuweisung_setze); an instance that is open
    // or still ringing takes the track's signal after fader, pan and mute/solo fade, FX 1 then FX 2 in series, before it goes into the target. Nothing of this runs for an idle lane: bit-equal.
    const int fx_s = fx_slot_[i];
    bool fx_weg = false;
    if (fx_s >= 0) {
      for (int u = 0; u < ARR_FX_EINHEITEN; ++u) {
        const Wert& fw = w_[i][ARR_F_FX0 + u];
        const bool auf = (fw.vl ? fw.vl[m - 1] : fw.w) >= 0.5f;
        cdj::BeatFx& b = fx_pool_[u * ARR_FX_POOL + fx_s];
        if (auf != fx_auf_[u][fx_s]) {
          fx_auf_[u][fx_s] = auf;
          b.setze(fx_art_[u], fx_beats_[u], fx_wet_[u], fx_p1_[u], fx_an_[u] && auf);
        }
#ifdef CYPHERDJ_MUTATION_ARR_FX_OHNE_SCHWANZ
        fx_weg = fx_weg || (auf && b.klingt());   // error case: closing the input drops the instance at once, the tail is cut
#else
        fx_weg = fx_weg || b.klingt();
#endif
      }
    }
    // Loop lane strip K4: spur/<n>/fx/3 with a graph on fx/3 sends what the track adds into its target into the fx/3 bus input instead (scaled by the container strip in the core); assign and release blend over
    // ARR_FX3_BLENDE samples (S-curve, as Mixer::fx3_zuweisung_setze). A track that does not lead into a DJ channel, or without a graph on fx/3, stays on its normal path: never silent.
    const bool fx3_kann = dj_k > 0 && !dj_master_ && dj_fx3_l_[dj_k - 1] && dj_fx3_r_[dj_k - 1] && dj_aus_l_[dj_k - 1];
    {
      const Wert& f3 = w_[i][ARR_F_FX0 + 2];
      const bool wunsch = fx3_kann && fx3_graph_ && (f3.vl ? f3.vl[m - 1] : f3.w) >= 0.5f;
      if (!fx3_kann) {
        fx3_gew_[i] = fx3_von_[i] = 0.0f;
        fx3_rest_[i] = 0;
        fx3_zuw_[i] = false;
      } else if (wunsch != fx3_zuw_[i]) {
        fx3_von_[i] = fx3_gew_[i];   // continue from the weight reached, also when a blend is interrupted
        fx3_zuw_[i] = wunsch;
        fx3_rest_[i] = ARR_FX3_BLENDE;
      }
    }
    const bool fx3 = fx3_kann && (fx3_zuw_[i] || fx3_gew_[i] > 0.0f || fx3_rest_[i] > 0);
    const bool puffer = fx_weg || fx3;   // what goes into the target is held back for the second pass after this loop
    const float* gbl = zg > 0 ? gsend[zg - 1] : nullptr;   // fade of the target group and of its ancestors: a muted group silences the sends of its members too
    float* kpl[ARR_INS_SCHL];   // structural post keys (slice 5 U1): the key buffers of the stages listening to the post of this track, mostly none
    float* kpr[ARR_INS_SCHL];
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
      const bool gruppe_solo = gso_t ? gso_t[t] : gso_f;
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
      if (puffer) {   // loop lane strip K3/K4: held back, the second pass below runs the fx chain and splits off the fx/3 share (the target blend advances as in the cases below)
        if (blende) {
          zw = std::min(1.0f, zw + 1.0f / ARR_ZIEL_BLENDE);
          blende = zw < 1.0f;
        }
        fxs_l_[t] = lz;
        fxs_r_[t] = rz;
        fxs_zw_[t] = zw;
      } else if (!blende) {
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
          if (sd[q].rampe) {   // send lane: part one over [0, ts), after a loop seam part two
            const Send& z = sd[q];
            sd[q].lin = t < z.ts ? z.a0 + (z.b0 - z.a0) * static_cast<float>(t + 1) / static_cast<float>(z.ts)
                                 : z.a1 + (z.b1 - z.a1) * static_cast<float>(t - z.ts) / static_cast<float>(std::max(1, z.m - 1 - z.ts));
          } else if (sd[q].vl && (t == 0 || sd[q].vl[t] != sd[q].vl[t - 1])) {
            sd[q].lin = db_lin(sd[q].vl[t]);
          }
          const float k = sd[q].lin * gb * gs;
          ret_.ein_l(q)[t] += pre_post(sl, pl, ret_pre_t_[q][t]) * k;
          ret_.ein_r(q)[t] += pre_post(sr, pr, ret_pre_t_[q][t]) * k;
        }
      }
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    if (puffer) {   // loop lane strip K3/K4: the second pass of the target add
      if (fx_weg) {
        for (int u = 0; u < ARR_FX_EINHEITEN; ++u) {   // FX 1 then FX 2, in series, in place (the Mixer's fx_kette)
          cdj::BeatFx& b = fx_pool_[u * ARR_FX_POOL + fx_s];
          if (b.klingt()) b.block(fxs_l_, fxs_r_, m, fx_beat0_, fx_bps_);
        }
      }
      float* d3l = fx3 ? dj_fx3_l_[dj_k - 1] : nullptr;
      float* d3r = fx3 ? dj_fx3_r_[dj_k - 1] : nullptr;
      // FX 3 is a post-fader send of the track's group (decision 2026-11-23): the diverted portion is multiplied by the fader gain and the mute/solo fade of the group and of every enclosing
      // group, exactly the values the group loop applies to its own sum in this block (fader per sample as there, gsend = the product of the fades). No new smoothing; the group's inserts
      // and balance do not act on the send. The chain of enclosing groups is walked on the stack, nothing is allocated.
      const Wert* g3f[ARR_GRUPPEN];
      float g3l[ARR_GRUPPEN];
      int g3n = 0;
      const float* g3b = nullptr;
      if (fx3 && zg > 0) {
        g3b = gsend[zg - 1];
        for (int e = zg - 1; e >= 0 && g3n < ARR_GRUPPEN; e = gziel_[e] - 1) {
          g3f[g3n] = &w_[ARR_SPUREN + e][0];
          g3l[g3n] = db_lin(g3f[g3n]->w);
          ++g3n;
        }
      }
      if (fx3) dj_fx3_da_[dj_k - 1] = true;
      for (int t = 0; t < m; ++t) {
        float nl = fxs_l_[t], nr = fxs_r_[t];
        if (fx3) {
          float a = fx3_zuw_[i] ? 1.0f : 0.0f;
          if (fx3_rest_[i] > 0) {
#ifdef CYPHERDJ_MUTATION_ARR_FX3_OHNE_BLENDE
            fx3_rest_[i] = 0;   // error case: the assignment jumps, no blend
#else
            const float v = 1.0f - static_cast<float>(fx3_rest_[i]) / ARR_FX3_BLENDE;
            a = fx3_von_[i] + (a - fx3_von_[i]) * (v * v * (3.0f - 2.0f * v));
            --fx3_rest_[i];
#endif
          }
          fx3_gew_[i] = a;
#ifdef CYPHERDJ_MUTATION_ARR_FX3_KOPIE
          d3l[t] += nl * a;   // error case: the share stays on the normal path as well (copy, not insert)
          d3r[t] += nr * a;
#else
          float gk = 1.0f;   // the group gain of the send: fader of the group and its ancestors times the fade product
          if (g3b) {
            gk = g3b[t];
            for (int q = 0; q < g3n; ++q) {
              if (g3f[q]->vl) g3l[q] = db_lin(g3f[q]->vl[t]);
              gk *= g3l[q];
            }
          }
          d3l[t] += nl * a * gk;
          d3r[t] += nr * a * gk;
          nl *= 1.0f - a;
          nr *= 1.0f - a;
#endif
        }
        if (!al) {
          zl[t] += nl;
          zr[t] += nr;
        } else {
          const float w1 = fxs_zw_[t];
          al[t] += nl * (1.0f - w1);
          ar[t] += nr * (1.0f - w1);
          zl[t] += nl * w1;
          zr[t] += nr * w1;
        }
      }
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
  // Nested groups, the place where the tracks' sums stand: every group buffer now holds the sum of its DIRECT tracks, and a project without nested groups has exactly one level.
  // Nested groups, delay compensation: the direct-track sum of a group waits in place for the latest child before the children add (place PDC_GRPEIN0 + g, delay ein(g) - T_trk; 0 when no child is late).
  // The ring is fed in every block of a used group, so a stage added later finds history.
  for (int g = 0; g < ARR_GRUPPEN; ++g)
    if (benutzt[g]) pdc_.verzoegere(PDC_GRPEIN0 + g, pd(PDC_GRPEIN0 + g), grp_l_[g], grp_r_[g], m);
  const int d_gruppen = pd(PDC_PM_GRP);
  float* gpm_l = pm_l_;   // where the top-level groups add: the PM sum, or a sum of their own that is delayed and then joins it (bit-equal without a delay)
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
  // Nested groups: the groups run level by level, lowest first, and inside a level in index order (the order of snap_->gruppen_ordnung). A group of level L adds into its parent's sum buffer,
  // the parent is on a higher level and runs later, so its sum is open (children before parents). One level (a flat project): the four passes below run once over all groups, as before nesting.
  const int ebenen = snap_ ? static_cast<int>(snap_->ebenen) : 1;
  int k0 = 0;
  for (int ee = 0; ee < ebenen && k0 < ARR_GRUPPEN; ++ee) {
    int k1 = k0;
    while (k1 < ARR_GRUPPEN && g_ebene(g_ordnung(k1)) == ee) ++k1;
    // 1.10 slice 5 U2a: the key `pre` of a group = the sum of its members (tracks and child groups) before ANY chain of the groups of its level. Copied for all groups of the level before the first
    // chain runs, so a group keyed by another group (or a return, or the PM) sees the sum, not the chain output. An unused group has no signal and no capture: its key buffer stays at the zero of the block start.
#ifndef CYPHERDJ_MUTATION_SC_GRUPPE_NACH_KETTE   // error case: the copy sits behind the chains (below)
    for (int k = k0; k < k1; ++k) {
      const int g = g_ordnung(k);
      if (benutzt[g]) ins_.kopiere(ARR_SCHL_GRP, ARR_SCHL_PRE, g + 1, grp_l_[g], grp_r_[g], m);
    }
#endif
    for (int k = k0; k < k1; ++k) {
      const int g = g_ordnung(k);
      if (abg_ziel(1, 0) && abg_->nr == g + 1 && benutzt[g])   // 1.10 slice 7: tap, group pre = the sum of the members in front of any chain
        abg_ernte(grp_l_[g], grp_r_[g], m);
    }
    // 1.10 slice 4a: the insert chains of the groups, over the sum of the members, before the group fader and the group sends. An unused group has no signal and no pass.
#ifndef CYPHERDJ_MUTATION_INS_GRUPPE_UEBERSPRUNGEN   // error case: the group pass is skipped
    for (int k = k0; k < k1; ++k) {
      const int g = g_ordnung(k);
      if (!ins_.hat(ARR_SPUREN + g)) continue;
      if (benutzt[g]) ins_.kette(ARR_SPUREN + g, snap_ ? &snap_->kette[ARR_SPUREN + g] : nullptr, grp_l_[g], grp_r_[g], m);
#ifndef CYPHERDJ_MUTATION_INS_GRUPPE_LEER_LAEUFT
      else ins_.schweige(ARR_SPUREN + g);   // no member, no signal, no pass: the stages are cleared and report nothing (review echtzeit-3)
#endif
    }
#endif
#ifdef CYPHERDJ_MUTATION_SC_GRUPPE_NACH_KETTE
    for (int k = k0; k < k1; ++k) {
      const int g = g_ordnung(k);
      if (benutzt[g]) ins_.kopiere(ARR_SCHL_GRP, ARR_SCHL_PRE, g + 1, grp_l_[g], grp_r_[g], m);   // error case: the group pre key is the chain output
    }
#endif
    for (int k = k0; k < k1; ++k) {   // 1.10 slice 4b T13: the group is aligned with the group of the longest arrival (T_G); its sends are taken from the aligned sum
      const int g = g_ordnung(k);
      if (benutzt[g]) pdc_.verzoegere(PDC_GRP0 + g, pd(PDC_GRP0 + g), grp_l_[g], grp_r_[g], m);
    }
    // Live modules task 6, headphone cue per group: the group signal behind its chain and its delay alignment, in front of fader, balance and the mute/solo fade (so the cue is
    // independent of mute and solo, like the PFL of a DJ channel with the fader down), goes to the PFL input of the mixer. A parent's signal already holds its children. Two cued
    // groups add. Only a used group has a signal. With every row at 0 nothing is written: the master and the cue bus stay bit-identical to a project without the rows.
#if !defined(CYPHERDJ_MUTATION_ARR_GRUPPE_CUE_AUS) && !defined(CYPHERDJ_MUTATION_ARR_GRUPPE_CUE_NACH_FADER)   // error cases: the tap is skipped / taken behind the fader (below)
    if (cue_l_ && cue_r_) {
      for (int k = k0; k < k1; ++k) {
        const int g = g_ordnung(k);
        if (!benutzt[g] || w_[ARR_SPUREN + g][ARR_F_CUE].w < 0.5f) continue;
        const float* bl = grp_l_[g];
        const float* br = grp_r_[g];
        for (int t = 0; t < m; ++t) {
          cue_l_[t] += bl[t];
          cue_r_[t] += br[t];
#ifdef CYPHERDJ_MUTATION_ARR_GRUPPE_CUE_MASTER   // error case: the tap also lands on the master (input erz/4)
          aus_l[t] += bl[t];
          aus_r[t] += br[t];
#endif
        }
      }
    }
#endif
    // 2. Gruppen → target (PM sum, or the sum of the parent group). Eine Gruppe ohne Mitglieder rechnet nicht, ihre Blende steht sofort auf dem Ziel (es klingt nichts).
    for (int k = k0; k < k1; ++k) {
      const int g = g_ordnung(k);
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
      const int zg = gziel_[g];   // the target: 0 = the PM sum, else the parent group (a higher level: its sum is open)
      // DJ view places (decision 7): a top group with a DJ output adds into the DJ pair of its channel instead of the PM sum, unless the offline switch sends it to the master or the pair is not
      // there (a caller without dj_ausgang): then it is a master group as before. The DJ pair is not the PM: no PM chain, no PM fader, no production master tap, no PM-group delay place.
      const int dn = snap_ ? (snap_->gruppe_dj[g] ? snap_->gruppe_dj[g] : (dj_rest_gilt ? dj_rest_[g] : 0)) : 0;
#ifdef CYPHERDJ_MUTATION_ARR_DJ_OFFLINE_AUS
      const bool dj_ziel = dn > 0 && zg == 0 && dj_aus_l_[dn - 1] && dj_aus_r_[dn - 1];   // error case: the offline switch is ignored
#else
      const bool dj_ziel = dn > 0 && zg == 0 && !dj_master_ && dj_aus_l_[dn - 1] && dj_aus_r_[dn - 1];
#endif
      float* dpl = dj_ziel ? dj_aus_l_[dn - 1] : nullptr;
      float* dpr = dj_ziel ? dj_aus_r_[dn - 1] : nullptr;
      float* zl = dj_ziel ? dpl : zg == 0 ? gpm_l : grp_l_[zg - 1];
      float* zr = dj_ziel ? dpr : zg == 0 ? gpm_r : grp_r_[zg - 1];
      float zw = gziel_w_[g];
      bool blende = zw < 1.0f;
      float* al = nullptr;
      float* ar = nullptr;
      const int za = gziel_alt_[g];
      if (blende) {   // the old target of a blend: a DJ group's tail from the master (it was nested before) goes into the pair too, so nothing of it reaches the master
        al = za == 0 ? (dj_ziel ? dpl : gpm_l) : grp_l_[za - 1];
        ar = za == 0 ? (dj_ziel ? dpr : gpm_r) : grp_r_[za - 1];
      }
      const bool z_pm = zg == 0 && !dj_ziel, a_pm = blende && za == 0 && !dj_ziel;   // the side sum of the PM place is fed by what goes into the PM sum only
      // a group's sends: its own fade is in the signal already; the fades of its ancestors scale them on top (decision 2). A top-level group: nothing more (bit-equal to before nesting)
      const float* ganc = zg > 0 ? gsend[zg - 1] : nullptr;
      Send sd[ARR_RETURNS];
      const int n_sends = sends_bereiten(s, sd, snap_ ? top_dj(g + 1) : 0);
      float* kpl[ARR_INS_SCHL];   // structural post keys of this group (slice 5 U2a): the key buffers of the stages listening to it, mostly none
      float* kpr[ARR_INS_SCHL];
      const int nk = ins_.ziele(ARR_SCHL_GRP, ARR_SCHL_POST, g + 1, kpl, kpr);
      // 1.10 T9, T10: render-only key mask and dry-out (live: both 1.0f). The dry-out zeroes a group only when it goes to the master, as it does a track (zg == 0)
      const float gz = nur_schl_ && (nur_ziel_aus_[s] || (trocken_aus_ && zg == 0)) ? 0.0f : 1.0f, gs = nur_schl_ && nur_sends_aus_[s] ? 0.0f : 1.0f;
      const bool abg_post = abg_ziel(1, 1) && abg_->nr == g + 1;   // 1.10 slice 7: the tap of this group's post
      // The sends of the group arrive where its target expects the output (after the group's output place above). The returns wait for the latest source, so the sends are delayed by
      // T_S - ank(g) at the place PDC_GRPSEND0 + g. One place per group: it delays the pre signal (the sum times the mute/solo fade) and the post signal is rebuilt from it with fader and balance.
      // With a delay of 0 and no crossfade nothing changes: the original expressions below run (bit-equal). The ring is fed in every block of a used group.
      const int d_gs = pd(PDC_GRPSEND0 + g);
      const bool gs_verz = d_gs > 0 || pdc_.kreuzt(PDC_GRPSEND0 + g, d_gs);
      {
        const float* gbm = gblende_[g];
        for (int t = 0; t < m; ++t) {
          gsd_l_[t] = bl[t] * gbm[t];
          gsd_r_[t] = br[t] * gbm[t];
        }
        pdc_.verzoegere(PDC_GRPSEND0 + g, d_gs, gsd_l_, gsd_r_, m);
      }
      for (int t = 0; t < m; ++t) {
        if (fa.vl) lin = db_lin(fa.vl[t]);
        if (pa.vl) balance_gain(pa.vl[t], gl, gr);
        const float g_ms = gblende_[g][t];
        const float l = bl[t] * lin * gl * g_ms;
        const float r = br[t] * lin * gr * g_ms;
#ifdef CYPHERDJ_MUTATION_ARR_GRUPPE_CUE_NACH_FADER   // error case: the group cue is taken behind fader, balance and mute fade
        if (cue_l_ && cue_r_ && w_[s][ARR_F_CUE].w >= 0.5f) {
          cue_l_[t] += l;
          cue_r_[t] += r;
        }
#endif
        if (abg_post) {
#ifdef CYPHERDJ_MUTATION_ABGRIFF_VOR_FADER
          abg_l_[t] = bl[t];   // error case: the group tap is taken in front of the group fader
          abg_r_[t] = br[t];
#else
          abg_l_[t] = l;
          abg_r_[t] = r;
#endif
        }
        for (int q = 0; q < nk; ++q) {   // the capture point of the group post: what the group sends on to its target after its fader, balance and mute/solo fade
#ifdef CYPHERDJ_MUTATION_NUR_SCHLUESSEL_STUMM
          kpl[q][t] = l * gz;   // error case (T9): the render mask zeroes the key as well
          kpr[q][t] = r * gz;
#else
          kpl[q][t] = l;
          kpr[q][t] = r;
#endif
        }
        const float lz = l * gz, rz = r * gz;
        if (!blende) {
          zl[t] += lz;
          zr[t] += rz;
#ifdef CYPHERDJ_MUTATION_ARR_DJ_INS_MASTER
          if (dj_ziel) {   // error case: the DJ group is also in the production master
            gpm_l[t] += lz;
            gpm_r[t] += rz;
          }
#endif
          if (gfl && z_pm) {
            gfl[t] += lz;
            gfr[t] += rz;
          }
        } else {   // a target change that blends (decision 4): the old target is still open, so the tail goes there
          zw = std::min(1.0f, zw + 1.0f / ARR_ZIEL_BLENDE);
          al[t] += lz * (1.0f - zw);
          ar[t] += rz * (1.0f - zw);
          zl[t] += lz * zw;
          zr[t] += rz * zw;
          if (gfl) {
            if (a_pm) {
              gfl[t] += lz * (1.0f - zw);
              gfr[t] += rz * (1.0f - zw);
            }
            if (z_pm) {
              gfl[t] += lz * zw;
              gfr[t] += rz * zw;
            }
          }
          blende = zw < 1.0f;
        }
        if (n_sends) {   // the group sends after its own fader, balance and fade (spec 5.4)
          const float ka = ganc ? ganc[t] : 1.0f;
          for (int q = 0; q < ARR_RETURNS; ++q) {
            if (!sd[q].aktiv) continue;
            if (sd[q].vl && (t == 0 || sd[q].vl[t] != sd[q].vl[t - 1])) sd[q].lin = db_lin(sd[q].vl[t]);
#ifdef CYPHERDJ_MUTATION_INS_GRUPPE_PRE_NACH_FADER
            const float pl = l, pr = r;   // error case: the pre tap of a group is taken after its fader
#else
            const float pl = bl[t] * g_ms, pr = br[t] * g_ms;   // pre tap of a group: the chain output times its mute/solo fade
#endif
            if (gs_verz) {   // the delayed pre signal; the post signal is it times fader and balance
              const float dpl = gsd_l_[t], dpr = gsd_r_[t];
              ret_.ein_l(q)[t] += pre_post(dpl * lin * gl, dpl, ret_pre_t_[q][t]) * sd[q].lin * gs * ka;
              ret_.ein_r(q)[t] += pre_post(dpr * lin * gr, dpr, ret_pre_t_[q][t]) * sd[q].lin * gs * ka;
              continue;
            }
            ret_.ein_l(q)[t] += pre_post(l, pl, ret_pre_t_[q][t]) * sd[q].lin * gs * ka;
            ret_.ein_r(q)[t] += pre_post(r, pr, ret_pre_t_[q][t]) * sd[q].lin * gs * ka;
          }
        }
        sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
      }
      gziel_w_[g] = zw;
      if (nk) ins_.fertig(ARR_SCHL_GRP, ARR_SCHL_POST, g + 1, m);
      if (abg_post) abg_ernte(abg_l_, abg_r_, m);
      spitze_[s] = sp;
    }
    k0 = k1;
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
    float* kpl[ARR_INS_SCHL];   // structural keys of this return (slice 5 U2a): pre = the Hall blend before the chain, post = after fader, fades and presence; mostly none
    float* kpr[ARR_INS_SCHL];
    float* kql[ARR_INS_SCHL];
    float* kqr[ARR_INS_SCHL];
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
    // loop deck channel strip KZ3: a return of the live container can lead into a DJ pair (the group rule above: held tail after a swap, never in the offline switch, never without the pair). The post-fader
    // sample then goes into the pair and into nothing of the PM (no PM sum, no PM-return delay place, no feed of it); the return's own taps and keys above stay.
    const int dn = snap_ ? (snap_->ret_dj[r] ? snap_->ret_dj[r] : (dj_rest_gilt ? ret_dj_rest_[r] : 0)) : 0;
    const bool dj_ziel = dn > 0 && !dj_master_ && dj_aus_l_[dn - 1] && dj_aus_r_[dn - 1];
    int d_ret = dj_ziel ? 0 : pd(PDC_PM_RET0 + r);
#ifdef CYPHERDJ_MUTATION_PDC_DOPPELT
    d_ret += pd(PDC_RETSPUR0 + r);   // error case: the send path is delayed once at the return input and once more at the return output
#endif
    float* rpm_l = dj_ziel ? dj_aus_l_[dn - 1] : pm_l_;
    float* rpm_r = dj_ziel ? dj_aus_r_[dn - 1] : pm_r_;
    const bool ret_sep = !dj_ziel && (d_ret > 0 || pdc_.kreuzt(PDC_PM_RET0 + r, d_ret));   // plan 1.11 (fix round 2): as the groups above, a side sum feeds the ring when there is no delay
#ifdef CYPHERDJ_MUTATION_HOST_PM_NICHT_GEFUETTERT
    float* rfl = nullptr;   // error case: PM_RET is fed only while delayed
    float* rfr = nullptr;
#else
    float* rfl = ret_sep || dj_ziel ? nullptr : pdcs_l_;
    float* rfr = ret_sep || dj_ziel ? nullptr : pdcs_r_;
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

// Production plan task 8: a pointer course becomes the written value; the pointer is good for one block (bk_ueber_melden takes it first, this catches the quiet path and a block without a sink).
void Arrangement::bk_ueber_nehmen(int m) {
  for (auto& je_slot : bk_ueber_)
    for (BkUeber& u : je_slot)
      if (u.vl) {
        u.wert = u.vl[m - 1];
        u.da = true;
        u.vl = nullptr;
      }
}

// Every block, before auto_geraet(): the written override of a knob goes to the sink of the bk track in that slot. The sink clears its report flag per block, so one report would last one
// block. A lane reported later in the same block overwrites it (the later auto_parameter wins). A slot without a bk instance in the snapshot does nothing.
void Arrangement::bk_ueber_melden(int m) {
  bk_ueber_nehmen(m);
  if (!snap_) return;
  for (int i = 0; i < ARR_SPUREN; ++i) {
    const int slot = bk_slot_[i];
    if (slot < 0 || !snap_->spur[i].bk) continue;
    ArrSenke* se = senke_fuer(snap_, i);
    if (!se) continue;
    for (int k = 0; k < BK_UEBER_KNOEPFE; ++k) {
      const BkUeber& u = bk_ueber_[slot][k];
      if (u.da) se->auto_parameter(i, k, u.wert);
    }
  }
}

// In tausche(): every playback build ends the override (the project value is authoritative again, D11) and numbers the bk tracks of the snapshot being installed (D10).
void Arrangement::bk_ueber_loeschen() {
  for (auto& je_slot : bk_ueber_)
    for (BkUeber& u : je_slot) u = BkUeber{};
}

float Arrangement::feld_ziel(int streifen, int feld) const {
  return wert_ueber(streifen, feld).w;
}

// The value the strip mixes with: the cell envelope while a launcher cell plays one for the field (end value in w, the ramp of this block in vl), else the knob.
Arrangement::Wert Arrangement::wert_ueber(int streifen, int feld) const {
  if (streifen >= 0 && streifen < ARR_SPUREN && feld >= 0 && feld < ARR_FELDER && zell_ueber_[streifen][feld].da && zell_ueber_[streifen][feld].zeile >= 0) {
    Wert w;
    w.w = zell_ueber_[streifen][feld].w;
    w.vl = zell_buf_[zell_ueber_[streifen][feld].zeile];
    return w;
  }
  return w_[streifen][feld];
}

bool Arrangement::huelle_wert(int streifen, int feld, float& w) const {
  if (streifen < 0 || streifen >= ARR_SPUREN || feld < 0 || feld >= ARR_FELDER) return false;
  const ZellUeber& u = zell_ueber_[streifen][feld];
  if (!u.da || u.frei || u.zeile < 0) return false;
  w = u.w;
  return true;
}

bool Arrangement::regler_huelle(int regler, float& w) const {
  if (!zell_an_ || regler < 0 || regler >= sw::MAX_REGLER || regler_spur_[regler] < 0) return false;
  return huelle_wert(regler_spur_[regler], regler_feld_[regler], w);
}

void Arrangement::verlaeufe_nachfuehren(int m) {
  bk_ueber_nehmen(m);
  ins_.nachfuehren(m);
  for (int s = 0; s < ARR_STREIFEN; ++s)
    for (int f = 0; f < ARR_FELDER; ++f) {
      Wert& w = w_[s][f];
      if (w.vl) {
#ifdef CYPHERDJ_MUTATION_ARR_AUTO_GRUND_UEBERSCHRIEBEN
        w.w = w.vl[m - 1];   // error case: the lane value becomes the base value of the fader
#else
        // Automation Slice 1 (D5a point 4): w.w stays the stellwerk or base value, never a lane value; a stellwerk course that ran this block ends in w.w
        // the lane buffer of the strip: a track is its own slot, a return is slot ARR_SPUREN + r (field 0 only: the other fields of a return have no lane buffer); groups and PM none
        const int slot = s < ARR_SPUREN ? s : (s >= ARR_RET0 ? s - ARR_RET0 + ARR_SPUREN : -1);
        if (slot >= 0 && f < AUTO_FELDER && w.vl == auto_buf_[slot][f]) {
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
