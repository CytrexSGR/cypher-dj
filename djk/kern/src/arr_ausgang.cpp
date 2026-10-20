// D1 K1 Slice 5: Spur-Mixer des Moduls Arrangement (Spec D1 2.3). Je Spur Fader (dB), Pan (Gesetz −3 dB in der Mitte:
// links cos, rechts sin über (pan + 1)·π/4), Mute und Solo mit 10-ms-Blende (linear, 480 Samples), Spitze nach dem
// Fader. Werte je Sample aus dem Stellwerk (Regler spur/<n>/*, Rollen spur_fader/_pan/_mute/_solo an Kanal −1).
#include <algorithm>
#include <cmath>

#include "cypherdj/arrangement.h"

namespace cdj {

namespace sw = cypherdj::stellwerk;

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

}  // namespace

void Arrangement::regler_binden(const sw::ReglerTabelle& tab) {
  for (int r = 0; r < sw::MAX_REGLER; ++r) {
    regler_spur_[r] = -1;
    regler_feld_[r] = -1;
  }
  for (int r = 0; r < tab.anzahl(); ++r) {
    const sw::ReglerDef& d = tab.def(r);
    int feld = -1;
    switch (d.rolle) {
      case sw::Rolle::spur_fader: feld = 0; break;
      case sw::Rolle::spur_pan: feld = 1; break;
      case sw::Rolle::spur_mute: feld = 2; break;
      case sw::Rolle::spur_solo: feld = 3; break;
      default: break;
    }
    const int spur = d.pfad[5] - '1';   // "spur/<n>/…"
    if (feld < 0 || spur < 0 || spur >= ARR_SPUREN) continue;
    regler_spur_[r] = static_cast<int16_t>(spur);
    regler_feld_[r] = static_cast<int8_t>(feld);
    w_[spur][feld].w = d.vorgabe;
  }
  for (float& g : ms_gain_) g = 1.0f;
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

void Arrangement::mischen(int m, float* aus_l, float* aus_r) {
  bool solo_vl = false, solo_fest = false;
  for (int i = 0; i < ARR_SPUREN; ++i) {
    solo_vl = solo_vl || w_[i][3].vl;
    solo_fest = solo_fest || w_[i][3].w >= 0.5f;
  }
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
    for (int t = 0; t < m; ++t) {
      if (fa.vl) lin = db_lin(fa.vl[t]);
      if (pa.vl) pan_gain(pa.vl[t], gl, gr);
      bool solo_irgendwo = solo_fest;
      if (solo_vl) {
        solo_irgendwo = false;
        for (int j = 0; j < ARR_SPUREN; ++j) solo_irgendwo = solo_irgendwo || (w_[j][3].vl ? w_[j][3].vl[t] : w_[j][3].w) >= 0.5f;
      }
      const bool stumm = (mu.vl ? mu.vl[t] : mu.w) >= 0.5f;
      const bool solo = (so.vl ? so.vl[t] : so.w) >= 0.5f;
      const float ziel = (stumm || (solo_irgendwo && !solo)) ? 0.0f : 1.0f;
#ifdef CYPHERDJ_MUTATION_ARR_MUTE_HART
      g_ms = ziel;   // Fehlerfall: Mute und Solo ohne Blende (Knack)
#else
      if (g_ms < ziel) g_ms = std::min(ziel, g_ms + 1.0f / ARR_STUMM_BLENDE);
      else if (g_ms > ziel) g_ms = std::max(ziel, g_ms - 1.0f / ARR_STUMM_BLENDE);
#endif
      const float l = bl[t] * lin * gl * g_ms;
      const float r = br[t] * lin * gr * g_ms;
      aus_l[t] += l;
      aus_r[t] += r;
      sp = std::max(sp, std::max(std::fabs(l), std::fabs(r)));
    }
    ms_gain_[i] = g_ms;
    spitze_[i] = sp;
  }
}

void Arrangement::verlaeufe_nachfuehren(int m) {
  for (auto& spur : w_)
    for (Wert& w : spur)
      if (w.vl) {
        w.w = w.vl[m - 1];
        w.vl = nullptr;
      }
}

}  // namespace cdj
