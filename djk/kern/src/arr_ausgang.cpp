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

#include "cypherdj/arrangement.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;

static_assert(ARR_SPUREN == sw::SPUR_REGLER_SPUREN, "Spur-Slots und Spur-Regler müssen gleich viele sein (E3)");
static_assert(ARR_GRUPPEN == sw::GRP_REGLER_GRUPPEN, "Gruppen-Slots und Gruppen-Regler müssen gleich viele sein (1.10)");
static_assert(ARR_RETURNS == sw::RET_REGLER_RETURNS, "return slots and return controls must be the same number (1.10 slice 3)");
static_assert(ARR_RETURNS == sw::SND_REGLER, "send controls per source must match the return slots (1.10 slice 3)");

namespace {

inline float db_lin(float db) { return db <= -120.0f ? 0.0f : std::pow(10.0f, db / 20.0f); }   // §1.2 Stumm-Grenze

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

}  // namespace

void Arrangement::regler_binden(const sw::ReglerTabelle& tab) {
  for (int r = 0; r < sw::MAX_REGLER; ++r) {
    regler_spur_[r] = -1;   // strip index (track 0..31, group 32..39, PM 40, returns 41..44), name from D1 K1
    regler_feld_[r] = -1;
  }
  for (int r = 0; r < tab.anzahl(); ++r) {
    const sw::ReglerDef& d = tab.def(r);
    int feld = -1, streifen = -1;
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
    w_[streifen][feld].w = d.vorgabe;
  }
  for (float& g : ms_gain_) g = 1.0f;
  for (float& w : ziel_w_) w = 1.0f;
  hall_sofort();   // the Halls start on the default controls (constructor, outside the callback)
}

void Arrangement::setze_sofort(int regler, float wert) {
  if (regler < 0 || regler >= sw::MAX_REGLER || regler_spur_[regler] < 0) return;
  Wert& w = w_[regler_spur_[regler]][regler_feld_[regler]];
  w.w = wert;
  w.vl = nullptr;
  w.sw_vl = nullptr;
}

void Arrangement::verlauf(int regler, const float* werte) {
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
  // 1. Spuren → Ziel
  for (int i = 0; i < ARR_SPUREN; ++i) {
    const Wert& fa = w_[i][0];
    const Wert& pa = w_[i][1];
    const Wert& mu = w_[i][2];
    const Wert& so = w_[i][3];
    float lin = db_lin(fa.w), gl = 0.0f, gr = 0.0f;
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
    for (int t = 0; t < m; ++t) {
      if (fa.vl && (t == 0 || fa.vl[t] != fa.vl[t - 1])) lin = db_lin(fa.vl[t]);   // the same value gives the same gain: pow only on a change
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
      if (!blende) {
        zl[t] += l;
        zr[t] += r;
      } else {
        zw = std::min(1.0f, zw + 1.0f / ARR_ZIEL_BLENDE);
        al[t] += l * (1.0f - zw);
        ar[t] += r * (1.0f - zw);
        zl[t] += l * zw;
        zr[t] += r * zw;
        blende = zw < 1.0f;
      }
      if (n_sends) {   // post fader, pan and mute/solo of the track (P5), times the fade of its group (P14)
#ifdef CYPHERDJ_MUTATION_ARR_SEND_OHNE_GRUPPEN_BLENDE
        const float gb = 1.0f;   // error case: a muted group does not silence the sends of its members
#else
        const float gb = gbl ? gbl[t] : 1.0f;
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
          const float k = sd[q].lin * gb;
          ret_.ein_l(q)[t] += sl * k;
          ret_.ein_r(q)[t] += sr * k;
        }
      }
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    ms_gain_[i] = g_ms;
    spitze_[i] = sp;
    ziel_w_[i] = zw;
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
    for (int t = 0; t < m; ++t) {
      if (fa.vl) lin = db_lin(fa.vl[t]);
      if (pa.vl) balance_gain(pa.vl[t], gl, gr);
      const float g_ms = gblende_[g][t];
      const float l = bl[t] * lin * gl * g_ms;
      const float r = br[t] * lin * gr * g_ms;
      pm_l_[t] += l;
      pm_r_[t] += r;
      if (n_sends) {   // the group sends after its own fader, balance and fade (spec 5.4)
        for (int q = 0; q < ARR_RETURNS; ++q) {
          if (!sd[q].aktiv) continue;
          if (sd[q].vl && (t == 0 || sd[q].vl[t] != sd[q].vl[t - 1])) sd[q].lin = db_lin(sd[q].vl[t]);
          ret_.ein_l(q)[t] += l * sd[q].lin;
          ret_.ein_r(q)[t] += r * sd[q].lin;
        }
      }
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    spitze_[s] = sp;
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
  ret_.hall_vorlauf(m, hx, han, hrech);
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
    if (nass) ret_.hall_block(r, m);
    const float* bl = ret_.ein_l(r);
    const float* br = ret_.ein_r(r);
    const float* nl = nass ? ret_.nass_l(r) : nullptr;
    const float* nr = nass ? ret_.nass_r(r) : nullptr;
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
      const float ql = bl[t] * (1.0f - ag) + (nl ? nl[t] * ag : 0.0f);   // dry share falling, wet share rising
      const float qr = br[t] * (1.0f - ag) + (nr ? nr[t] * ag : 0.0f);
      const float l = ql * lin * gl * g_ms * dg;
      const float rr = qr * lin * gr * g_ms * dg;
#ifdef CYPHERDJ_MUTATION_ARR_RET_NACH_PM_FADER
      ret_.ein_l(r)[t] = l;   // error case: the return output is added after the PM fader (collected here, added below)
      ret_.ein_r(r)[t] = rr;
#else
      pm_l_[t] += l;
      pm_r_[t] += rr;
#endif
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(rr)));
    }
    ms_gain_[s] = g_ms;
    spitze_[s] = sp;
    if (az == 0.0f && ag == 0.0f) ret_.schlafen(r);   // hall off and faded: no tail may hang on for later
    if (!dd && dg == 0.0f) ret_.schlafen(r);          // the return is gone (P9, P15): state to zero after the fade
  }
  // 3. PM-Fader, dann in den Eingang von erz/4. Bei 0 dB ist die Multiplikation x · 1,0f (bitgleich zu vorher, AK1).
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
      aus_l[t] += l;
      aus_r[t] += r;
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    spitze_[ARR_PM] = sp;
  }
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
