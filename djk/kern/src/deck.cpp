// Ein Deck im Direktweg (deck.h). Scheibe 31.
#include "cypherdj/deck.h"

#include <algorithm>
#include <cmath>

#include <cypherdj/dsp/werte.h>

namespace cdj {

namespace {

// Ein Frame des Materials mit den Stem-Gewichten g (nur bei Stems); außerhalb der Datei Stille.
// Summenreihenfolge drums, bass, vocals, other: ((d + b) + v) + o, wie die Offline-Summe (Festlegung F3).
inline void lies(const Material* m, int64_t f, const float* g, float& l, float& r) noexcept {
  if (!m || f < 0 || f >= m->frames) {
    l = r = 0.0f;
    return;
  }
  const int64_t i = 2 * f;
  if (m->n_quellen == 1) {
    l = m->quelle[0][i];
    r = m->quelle[0][i + 1];
    return;
  }
  float a = m->quelle[0][i] * g[0], b = m->quelle[0][i + 1] * g[0];
  for (int k = 1; k < m->n_quellen; ++k) {
    a = a + m->quelle[k][i] * g[k];
    b = b + m->quelle[k][i + 1] * g[k];
  }
  l = a;
  r = b;
}

inline float lin(float db) noexcept { return static_cast<float>(cypherdj::dsp::db_zu_linear(db)); }

}  // namespace

void Deck::zurueck(const Material* m) noexcept {
  if (!m) return;
  for (int i = 0; i < n_rueck_; ++i)
    if (rueck_[i] == m) return;
  if (n_rueck_ < 4) rueck_[n_rueck_++] = m;  // mehr als 4 Wechsel in 128 Frames kommen nicht vor (Kern: 1 je Block)
}

const Material* Deck::rueckgabe() noexcept {
  if (n_rueck_ == 0) return nullptr;
  const Material* m = rueck_[0];
  for (int i = 1; i < n_rueck_; ++i) rueck_[i - 1] = rueck_[i];
  --n_rueck_;
  return m;
}

void Deck::blende_von(const Material* alt, int64_t alt_f, float gain) noexcept {
  if (blende_rest_ > 0 && alt_m_ && alt_m_ != alt && alt_m_ != m_) zurueck(alt_m_);  // ältere Blende bricht ab
  alt_m_ = alt;
  alt_f_ = alt_f;
  alt_gain_ = gain;
  blende_rest_ = DECK_BLENDE;
}

void Deck::lade(const Material* m, int64_t s) noexcept {
  const Material* alt = m_;
  if (laeuft_ && alt) {
    blende_von(alt, frame_bei(s), stopp_rest_ > 0 ? static_cast<float>(stopp_rest_) / DECK_STOPP_RAMPE : 1.0f);
  } else {
    if (blende_rest_ > 0 && alt_m_ && alt_m_ != m) {  // eine laufende Blende des alten Materials endet hier
      zurueck(alt_m_);
      alt_m_ = nullptr;
      blende_rest_ = 0;
    }
    zurueck(alt);
  }
  m_ = m;
  laeuft_ = false;
  loop_l_ = 0;
  stopp_rest_ = 0;
  anker_s_ = anker_f_ = 0;
  raster_f_ = 0;
  pos_f_ = schlag0();
}

void Deck::entlade(int64_t s) noexcept { lade(nullptr, s); }

// Neuer Lesekopf ab s, vom alten 128 Frames geblendet; Stopp-Rampe und Loop bleiben (Naht, Sprung, Hotcue: Plan E9).
void Deck::neu_anker(int64_t s, int64_t f) noexcept {
  if (laeuft_ && m_)
    blende_von(m_, frame_bei(s), stopp_rest_ > 0 ? static_cast<float>(stopp_rest_) / DECK_STOPP_RAMPE : 1.0f);
  anker_s_ = s;
  anker_f_ = f;
}

void Deck::start(int64_t s, int64_t f, bool loop_halten) noexcept {
  neu_anker(s, f);
  laeuft_ = m_ != nullptr;
  stopp_rest_ = 0;
  if (!loop_halten) loop_l_ = 0;  // Plan E9: Start beendet einen Loop (Attrappe decks.mjs starteDeck), Play der Hand nicht
}

void Deck::setze_kopf(int64_t s, int64_t f) noexcept {
  if (laeuft_) neu_anker(s, f);
  else pos_f_ = std::clamp<int64_t>(f, 0, m_ ? m_->frames : 0);
}

int64_t Deck::stopp(int64_t s, bool loop_halten) noexcept {
  if (!laeuft_) return s;
  if (!loop_halten) loop_l_ = 0;  // Plan E9: Stopp beendet einen Loop (Attrappe decks.mjs stoppeDeck), Pause der Hand nicht
  if (stopp_rest_ == 0) stopp_rest_ = DECK_STOPP_RAMPE;
  return s + stopp_rest_;
}

void Deck::setze_lauf(int64_t anker_s, int64_t anker_f) noexcept {
  laeuft_ = m_ != nullptr;
  stopp_rest_ = 0;
  anker_s_ = anker_s;
  anker_f_ = anker_f;
}

void Deck::setze_position(int64_t f) noexcept {
  laeuft_ = false;
  stopp_rest_ = 0;
  pos_f_ = f;
}

void Deck::springe(int64_t s, int64_t d) noexcept {
  if (loop_l_ > 0) loop_a_ += d;
  setze_kopf(s, (laeuft_ ? frame_bei(s) : pos_f_) + d);
}

void Deck::setze_raster(int64_t s, int64_t v) noexcept {
  if (!m_) return;
  const int64_t d = v - raster_f_;
  raster_f_ = v;
#ifndef CYPHERDJ_MUTATION_RASTER_OHNE_KOPF
  if (d != 0) springe(s, d);  // Fehlerfall der Abnahme: nur die Linien wandern, der Ton bleibt, Quell-Beat springt
  // Audit F09: das Raster ist schon quittiert; schiebt es den Loop aus dem Material, endet der Loop statt still zu laufen
  if (loop_l_ > 0 && (loop_a_ < 0 || loop_a_ + loop_l_ > m_->frames)) loop_l_ = 0;
#else
  (void)s;
  (void)d;
#endif
}

void Deck::stem_db(int stem, float db) noexcept {
  if (stem < 0 || stem >= STEM_ANZAHL) return;
  stem_db_[stem] = db;
  stem_lin_[stem] = lin(db);
  stem_vl_[stem] = nullptr;
}

void Deck::stem_verlauf(int stem, const float* db) noexcept {
  if (stem >= 0 && stem < STEM_ANZAHL) stem_vl_[stem] = db;
}

void Deck::verlauf_ende(int m) noexcept {
  for (int k = 0; k < STEM_ANZAHL; ++k)
    if (stem_vl_[k] && m > 0) stem_db(k, stem_vl_[k][m - 1]);
}

int64_t Deck::frame_bei(int64_t s) const noexcept {
  if (!laeuft_) return pos_f_;
#ifdef CYPHERDJ_MUTATION_DECK_DRIFT
  // Positiv-Kontrolle des Drift-Messers (wie 03 Probe 4a --drift 1e-5): Lesekopf 1e-5 zu schnell
  return anker_f_ + std::llround(static_cast<double>(s - anker_s_) * (1.0 + 1e-5));
#else
  return anker_f_ + (s - anker_s_);
#endif
}

double Deck::quell_beat_bei(int64_t s) const noexcept {
  if (!m_) return 0.0;
  return quell_beat_von(static_cast<double>(frame_bei(s)), schlag0(), m_->basis_bpm);
}

double Deck::beats_bis_ende_bei(int64_t s) const noexcept {
  if (!m_) return 0.0;
  if (loop_l_ > 0) return INFINITY;  // Plan E9: im Loop kein Ende (Attrappe: d.loop ? Infinity)
  const double rest = static_cast<double>(m_->frames - frame_bei(s)) * m_->basis_bpm / FRAMES_JE_MINUTE;
  return rest > 0.0 ? rest : 0.0;
}

void Deck::block(int64_t s, int n, float* l, float* r, int vl_off) noexcept {
  const bool verlauf = stem_vl_[0] || stem_vl_[1] || stem_vl_[2] || stem_vl_[3];
  float g[STEM_ANZAHL] = {stem_lin_[0], stem_lin_[1], stem_lin_[2], stem_lin_[3]};
  for (int i = 0; i < n; ++i) {
    if (!laeuft_ && blende_rest_ == 0) break;  // steht und nichts klingt aus: Stille (nichts zu addieren)
    if (verlauf)
      for (int k = 0; k < STEM_ANZAHL; ++k)
        if (stem_vl_[k]) g[k] = lin(stem_vl_[k][vl_off + i]);
    float a = 0.0f, b = 0.0f;
    if (laeuft_) {
      // Plan E9: Naht. Die 128-Frame-Blende liegt VOR der Naht (der neue Kopf beginnt 128 Frames vor dem Loop-Anfang),
      // damit der Loop-Anfang voll klingt: ab der Naht eingeblendet verlor die Takt-Eins am Loop-Anfang ihren Transienten
      // (gemessen: Takt-Eins im 2-Beat-Loop nicht mehr von einem Viertel-Klick zu unterscheiden).
      if (loop_l_ > 0 && frame_bei(s + i) >= loop_a_ + loop_l_ - DECK_BLENDE)
        neu_anker(s + i, loop_a_ - DECK_BLENDE + (frame_bei(s + i) - (loop_a_ + loop_l_ - DECK_BLENDE)) % loop_l_);
      const int64_t f = frame_bei(s + i);
      lies(m_, f, g, a, b);
      if (stopp_rest_ > 0) {
        const float gs = static_cast<float>(stopp_rest_ - 1) / DECK_STOPP_RAMPE;
        a *= gs;
        b *= gs;
        if (--stopp_rest_ == 0) {
          laeuft_ = false;
          pos_f_ = f + 1;
        }
      } else if (loop_l_ == 0 && f + 1 >= m_->frames) {  // letztes Frame gespielt: zu Ende gelaufen (§1.6: nicht mehr hörbar)
        laeuft_ = false;
        pos_f_ = m_->frames;
      }
    }
    if (blende_rest_ > 0) {
      const float w = static_cast<float>(DECK_BLENDE - blende_rest_ + 1) / DECK_BLENDE;
      float c = 0.0f, d = 0.0f;
      lies(alt_m_, alt_f_++, g, c, d);
      a = a * w + c * (1.0f - w) * alt_gain_;
      b = b * w + d * (1.0f - w) * alt_gain_;
      if (--blende_rest_ == 0) {
        if (alt_m_ != m_) zurueck(alt_m_);
        alt_m_ = nullptr;
      }
    }
    l[i] += a;
    r[i] += b;
  }
}

}  // namespace cdj
