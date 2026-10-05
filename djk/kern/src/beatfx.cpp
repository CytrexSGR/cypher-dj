// Beat-FX-Einheit (beatfx.h). Plan 3.
#include "cypherdj/beatfx.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include <cypherdj/dsp/denormal.h>

namespace cdj {

namespace {
constexpr double SR = 48000.0;
constexpr float STILL = 1e-6f;   // ECHO: darunter gilt ein Schreiben als still
inline double frac(double x) { return x - std::floor(x); }
inline double dreieck(double p) { return p < 0.5 ? 2.0 * p : 2.0 - 2.0 * p; }
inline float naeher(float ist, float ziel, float schritt) {
  return ist < ziel ? std::min(ist + schritt, ziel) : std::max(ist - schritt, ziel);
}
}  // namespace

BeatFx::BeatFx() {
  for (int k = 0; k < 2; ++k) {
    echo_[k].reset(new float[ECHO_FRAMES]());
    flanger_[k].reset(new float[FLANGER_FRAMES]());
  }
}

void BeatFx::setze(int art, double beats, float wet, float param, bool an) noexcept {
  if (art < AUS || art > FILTER) art = AUS;
  ziel_art_ = art;
  ziel_beats_ = beats > 0.0 ? beats : 1.0;
  ziel_param_ = std::clamp(param, 0.0f, 1.0f);
  // OFF schließt bei jeder Art nur den Eingang: das Trockene läuft voll, der Nachhall klingt mit dem Wet aus (Spec E8;
  // Andreas 2026-09-28: „effekte laufen besser immer aus“)
  ziel_wet_ = std::clamp(wet, 0.0f, 1.0f);
  ziel_ein_ = an ? 1.0f : 0.0f;
}

void BeatFx::leeren() noexcept {
  for (int k = 0; k < 2; ++k) {
    std::memset(echo_[k].get(), 0, sizeof(float) * ECHO_FRAMES);
    std::memset(flanger_[k].get(), 0, sizeof(float) * FLANGER_FRAMES);
    for (float& z : ap_z_[k]) z = 0.0f;
    ap_rueck_[k] = svf_ic1_[k] = svf_ic2_[k] = 0.0f;
  }
  still_ = INT64_MAX / 2;
}

bool BeatFx::klingt() const noexcept {
  if (pause_) return wet_ > 0.0f || ein_ > 0.0f;
  // ECHO: nach mehr als einer Verzögerung stiller Schreibvorgänge kann nichts Hörbares mehr aus der Leitung kommen
  // Nachhall: ECHO bis eine Verzögerung lang nichts Hörbares mehr in die Leitung ging, die anderen bis NACHHALL Samples
  // lang nichts Hörbares mehr aus dem Effekt kam
  if (ein_ > 0.0f || ziel_ein_ > 0.0f || art_ != ziel_art_) return true;
  return wet_ > 0.0f && still_ <= (art_ == ECHO ? echo_d_ : NACHHALL);
}

// Mischung für Flanger, Phaser, Filter: y ist der Effekt aus dem Eingang ein_·x. An: (1 − wet)·x + wet·y wie bisher; aus
// (ein_ = 0): x + wet·Nachhall. still_ zählt, wie lange y unhörbar war (klingt()).
float BeatFx::nachhall(int k, float x, float y) noexcept {
  if (k == 1) still_ = std::fabs(y) > STILL || std::fabs(nachhall_l_) > STILL ? 0 : still_ + 1;
  else nachhall_l_ = y;
  return x * (1.0f - wet_ * ein_) + wet_ * y;
}

float BeatFx::eins(int k, float x, double beat, double spb) noexcept {
  const double p = frac(beat / beats_);
  switch (art_) {
    case ECHO: {  // Verzögerung beats · SPB, Rückkopplung 0..0,9: aus = x + wet · e
      const int d = static_cast<int>(std::clamp<long long>(std::llround(beats_ * spb), 1, ECHO_FRAMES - 1));
      echo_d_ = d;
      int lese = echo_pos_ - d;
      if (lese < 0) lese += ECHO_FRAMES;
      const float e = echo_[k][lese];
      const float w = ein_ * x + 0.9f * param_ * e;
      echo_[k][echo_pos_] = w;
      if (k == 1) still_ = std::fabs(w) > STILL || std::fabs(echo_[0][echo_pos_]) > STILL ? 0 : still_ + 1;
      return x + wet_ * e;
    }
    case FLANGER: {  // 1 bis 5 ms: 48 + 192 · dreieck(p) Samples, linear interpoliert; Effekt 0,5 · (x + d)
      const double v = 48.0 + 192.0 * dreieck(p);
      const int vi = static_cast<int>(v);
      const float t = static_cast<float>(v - vi);
      int a = flanger_pos_ - vi, b = a - 1;
      if (a < 0) a += FLANGER_FRAMES;
      if (b < 0) b += FLANGER_FRAMES;
      const float y = flanger_[k][a] * (1.0f - t) + flanger_[k][b] * t;
      const float u = ein_ * x;
      flanger_[k][flanger_pos_] = u + 0.9f * param_ * y;
      return nachhall(k, x, 0.5f * (u + y));
    }
    case PHASER: {  // 6 Allpässe 1. Ordnung, fc = 300 · 2^(4 · dreieck(p)) Hz, Resonanz 0..0,9; Effekt 0,5 · (x + ap)
      const double fc = 300.0 * std::exp2(4.0 * dreieck(p));
      const double tn = std::tan(M_PI * fc / SR);
      const float c = static_cast<float>((tn - 1.0) / (tn + 1.0));
      const float ein = ein_ * x;
      float u = ein + 0.9f * param_ * ap_rueck_[k];
      for (int s = 0; s < PHASER_STUFEN; ++s) {
        const float y = c * u + ap_z_[k][s];
        ap_z_[k][s] = u - c * y;
        u = y;
      }
      ap_rueck_[k] = u;
      return nachhall(k, x, 0.5f * (ein + u));
    }
    case FILTER: {  // TPT-SVF-Tiefpass, fc = 200 · 2^(5 · (0,5 − 0,5 cos 2πp)) Hz, Q 0,7..8
      const double fc = 200.0 * std::exp2(5.0 * (0.5 - 0.5 * std::cos(2.0 * M_PI * p)));
      const double g = std::tan(M_PI * fc / SR);
      const double q = 0.7 + param_ * (8.0 - 0.7);
      const double a1 = 1.0 / (1.0 + g * (g + 1.0 / q)), a2 = g * a1, a3 = g * a2;
      const double v3 = ein_ * x - svf_ic2_[k];
      const double v1 = a1 * svf_ic1_[k] + a2 * v3;
      const double v2 = svf_ic2_[k] + a2 * svf_ic1_[k] + a3 * v3;
      svf_ic1_[k] = static_cast<float>(2.0 * v1 - svf_ic1_[k]);
      svf_ic2_[k] = static_cast<float>(2.0 * v2 - svf_ic2_[k]);
      return nachhall(k, x, static_cast<float>(v2));
    }
    default:
      return x;
  }
}

void BeatFx::block(float* l, float* r, int n, double beat0, double bps) noexcept {
  cypherdj::dsp::DenormalSchutz schutz;
  const float schritt = 1.0f / GLEIT;
  const double spb = bps > 0.0 ? 1.0 / bps : 22500.0;
  for (int i = 0; i < n; ++i) {
    // Wechsel der Art oder der Beat-Länge: erst Wet und Eingang auf 0, dann umschalten (D3). Die Beat-Länge darf nicht
    // vorher wechseln, sonst springt der Lesekopf der Echo-Leitung bzw. die LFO-Phase (gemessen: Stufe 0,61 am Sinus).
    // Geleert wird bei jedem Wechsel: mit neuer Verzögerung läse die Rückkopplung sofort aus einem anderen Abstand und
    // schriebe eine Stufe in die Leitung, die eine Verzögerung später bei vollem Wet herauskam (gemessen: 0,33).
    if (pause_) {  // Kanalwechsel: aus und leer, bis der Mixer umgehängt hat
      wet_ = naeher(wet_, 0.0f, schritt);
      ein_ = naeher(ein_, 0.0f, schritt);
      if (wet_ == 0.0f && ein_ == 0.0f) {
        if (!pause_leer_) {   // einmal, nicht je Sample: leeren() löscht rund 3 MB
          leeren();
          pause_leer_ = true;
        }
        art_ = ziel_art_;
        beats_ = ziel_beats_;
      }
    } else if (ziel_art_ != art_ || (art_ != AUS && ziel_beats_ != beats_)) {
      wet_ = naeher(wet_, 0.0f, schritt);
      ein_ = naeher(ein_, 0.0f, schritt);
      if (wet_ == 0.0f && ein_ == 0.0f) {
        leeren();
        art_ = ziel_art_;
        beats_ = ziel_beats_;
      }
    } else {
      beats_ = ziel_beats_;
      wet_ = naeher(wet_, ziel_wet_, schritt);
      ein_ = naeher(ein_, ziel_ein_, schritt);
    }
    param_ = ziel_param_;
#ifdef CYPHERDJ_MUTATION_FX_LFO_AB_START
    const double beat = static_cast<double>(gezaehlt_) * bps;  // Fehlerfall: LFO-Phase 0 beim ersten Block
#else
    const double beat = beat0 + i * bps;
#endif
    ++gezaehlt_;
    if (art_ == AUS) continue;
    if (wet_ == 0.0f && ein_ == 0.0f && art_ != ECHO) continue;   // trocken: bitgleich (Negativ-Kontrolle Wet 0)
    l[i] = eins(0, l[i], beat, spb);
    r[i] = eins(1, r[i], beat, spb);
    if (art_ == ECHO && ++echo_pos_ == ECHO_FRAMES) echo_pos_ = 0;
    if (art_ == FLANGER && ++flanger_pos_ == FLANGER_FRAMES) flanger_pos_ = 0;
  }
}

}  // namespace cdj
