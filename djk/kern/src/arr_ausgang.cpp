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
    regler_spur_[r] = -1;   // Streifen-Index (Spur 0..31, Gruppe 32..39, PM 40), Name aus D1 K1
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
      default: break;
    }
    if (feld < 0) continue;
    if (d.rolle == sw::Rolle::pm_fader) {
      streifen = ARR_PM;
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
}

void Arrangement::setze_sofort(int regler, float wert) {
  if (regler < 0 || regler >= sw::MAX_REGLER || regler_spur_[regler] < 0) return;
  Wert& w = w_[regler_spur_[regler]][regler_feld_[regler]];
  w.w = wert;
  w.vl = nullptr;
}

void Arrangement::verlauf(int regler, const float* werte) {
  if (regler < 0 || regler >= sw::MAX_REGLER || regler_spur_[regler] < 0 || !werte) return;
  w_[regler_spur_[regler]][regler_feld_[regler]].vl = werte;
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
  // Solo irgendwo (Spuren und Gruppen). E3 P5: ein Scan je Block statt je Spur und Sample, Ergebnis bitgleich.
  bool solo_vl = false, solo_fest = false;
  for (int i = 0; i < ARR_PM; ++i) {
    solo_vl = solo_vl || w_[i][3].vl;
    solo_fest = solo_fest || w_[i][3].w >= 0.5f;
  }
  const auto solo_bei = [&](int s, int t) { return (w_[s][3].vl ? w_[s][3].vl[t] : w_[s][3].w) >= 0.5f; };
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
  bool msolo_fest[ARR_GRUPPEN] = {};   // hat ein Mitglied der Gruppe Solo (ohne Verlauf)
  if (solo_vl) {
    for (int t = 0; t < m; ++t) {
      bool s = false;
      for (int j = 0; j < ARR_PM; ++j) s = s || solo_bei(j, t);
      solo_t_[t] = s;
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
    for (int t = 0; t < m; ++t) {
      if (fa.vl) lin = db_lin(fa.vl[t]);
      if (pa.vl) pan_gain(pa.vl[t], gl, gr);
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
    float g_ms = ms_gain_[s];
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
    for (int t = 0; t < m; ++t) {
      if (fa.vl) lin = db_lin(fa.vl[t]);
      if (pa.vl) balance_gain(pa.vl[t], gl, gr);
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
      const float l = bl[t] * lin * gl * g_ms;
      const float r = br[t] * lin * gr * g_ms;
      pm_l_[t] += l;
      pm_r_[t] += r;
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    ms_gain_[s] = g_ms;
    spitze_[s] = sp;
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
}

void Arrangement::verlaeufe_nachfuehren(int m) {
  for (auto& streifen : w_)
    for (Wert& w : streifen)
      if (w.vl) {
        w.w = w.vl[m - 1];
        w.vl = nullptr;
      }
}

}  // namespace cdj
