// Ein Deck im Direktweg (deck.h). Scheibe 31. Keylock: Task 2 des Plans 2026-10-06-keylock-echtzeit.md.
#include "cypherdj/deck.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

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

// Welle 3: wie TEMPO_GLEICH in kern_deck.cpp (§4.4): direkt, solange |bpm/basis − 1| < 10⁻⁶
constexpr double TEMPO_GLEICH_DECK = 1e-6;

// Catmull-Rom wie LoopBoxen::spiele_frei (ADR 026); auf einer Geraden exakt
inline float catmull(float y0, float y1, float y2, float y3, float x) noexcept {
  return y1 + 0.5f * x * (y2 - y0 + x * (2.0f * y0 - 5.0f * y1 + 4.0f * y2 - y3 + x * (3.0f * (y1 - y2) + y3 - y0)));
}

// Gebrochenes Frame pos mit den Stem-Gewichten g; außerhalb der Datei Stille (über lies)
inline void lies_frei(const Material* m, double pos, const float* g, float& l, float& r) noexcept {
  const int64_t i1 = static_cast<int64_t>(std::floor(pos));
  const float x = static_cast<float>(pos - static_cast<double>(i1));
  float a[4][2];
  for (int j = 0; j < 4; ++j) lies(m, i1 - 1 + j, g, a[j][0], a[j][1]);
  l = catmull(a[0][0], a[1][0], a[2][0], a[3][0], x);
  r = catmull(a[0][1], a[1][1], a[2][1], a[3][1], x);
}

inline float lin(float db) noexcept { return static_cast<float>(cypherdj::dsp::db_zu_linear(db)); }

}  // namespace

// Task 5: mit Loop wickelt das Band selbst, zustandslos über die UNGEWICKELTE Quellposition p (der Dehner rechnet Kopf und
// Regler ungewickelt, dehner.cpp kopf() und P_; ein Regler-Modulo braucht es darum nicht). Der Strom ist genau der des
// Direktwegs (Deck::block, Naht): bis zum Beginn der Naht-Blende E = a + L − 128 das Material, danach periodisch mit
// Periode L, q = a − 128 + (p − E) mod L; in [a − 128, a) die 128-Frame-Blende des neuen Kopfs q gegen den alten q + L
// mit denselben Gewichten und derselben Rechnung wie Deck::block (bitgleich, test_deck_keylock Test 28).
#ifdef CYPHERDJ_PRUEF_GEN
namespace {
std::atomic<uint64_t> g_gen_verletzt{0};
}
uint64_t deck_band_gen_verletzt() noexcept { return g_gen_verletzt.load(std::memory_order_relaxed); }
#endif

void DeckBand::band(int64_t ab, int n, float* l, float* r) const noexcept {
#ifdef CYPHERDJ_PRUEF_GEN
  {  // Plan 3.6: Lesung auf einem freien Platz der Leihe (Generation gerade, > 0)
    const uint32_t gn = pruef_gen.load(std::memory_order_acquire);
    if (gn != 0 && (gn & 1u) == 0) g_gen_verletzt.fetch_add(1, std::memory_order_relaxed);
  }
#endif
  float gw[STEM_ANZAHL];
  for (int k = 0; k < STEM_ANZAHL; ++k) gw[k] = g ? g[k].load(std::memory_order_relaxed) : 1.0f;
  if (p_sw == INT64_MAX) {
    deck_lies(m, gw, off, loop_a, loop_l, loop_lx, ab, n, l, r);  // gewöhnliches Band (off 0: Stand vor 6b, bitgleich)
  } else {
    // Keylock 6b (3.3): [ab, e) in drei Stücke: alt bis p_sw − x, Blende bis p_sw, neu ab p_sw. Jedes Stück zustandslos über die
    // ungewickelte Position (deck_lies), damit zwei Fäden mit verschiedenen Stücken dasselbe lesen.
    const int64_t e = ab + n, b0 = p_sw - x;
    const int64_t a_bis = std::clamp<int64_t>(b0, ab, e), n_ab = std::clamp<int64_t>(p_sw, ab, e);
    if (a_bis > ab) deck_lies(m, gw, off, loop_a, loop_l, loop_lx, ab, static_cast<int>(a_bis - ab), l, r);
    if (n_ab > a_bis) {  // Blende: höchstens x <= DECK_PLAN_BLENDE_MAX Frames in diesem Stück
      const int i0 = static_cast<int>(a_bis - ab), k = static_cast<int>(n_ab - a_bis);
      float nl[DECK_PLAN_BLENDE_MAX], nr[DECK_PLAN_BLENDE_MAX];
      deck_lies(m, gw, off, loop_a, loop_l, loop_lx, a_bis, k, l + i0, r + i0);
      deck_lies(m, gw, off_neu, loop2_a, loop2_l, loop2_lx, a_bis, k, nl, nr);
      for (int i = 0; i < k; ++i) {
        const float w = static_cast<float>(a_bis + i - b0 + 1) / static_cast<float>(x);
        l[i0 + i] = nl[i] * w + l[i0 + i] * (1.0f - w);
        r[i0 + i] = nr[i] * w + r[i0 + i] * (1.0f - w);
      }
    }
    if (e > n_ab) {
      const int i0 = static_cast<int>(n_ab - ab);
      deck_lies(m, gw, off_neu, loop2_a, loop2_l, loop2_lx, n_ab, static_cast<int>(e - n_ab), l + i0, r + i0);
    }
  }
  const int64_t sb = still_bis.load(std::memory_order_relaxed);
  if (ab < sb) {  // Keylock 6a: vor dem Startframe Stille (Start aus dem Stand, geplant)
    const int64_t k = std::min<int64_t>(n, sb - ab);
    std::fill(l, l + k, 0.0f);
    std::fill(r, r + k, 0.0f);
  }
}

void deck_lies(const Material* m, const float* gw, int64_t off, int64_t loop_a, int64_t loop_l, double lx_exakt, int64_t ab,
               int n, float* l, float* r) noexcept {
  ab += off;
#ifdef CYPHERDJ_MUTATION_KEYLOCK_LOOP_OHNE_WICKELN
  for (int i = 0; i < n; ++i) lies(m, ab + i, gw, l[i], r[i]);  // Fehlerfall: das Band läuft am Loop-Ende weiter (Test 23, 24, 28)
#else
  if (loop_l <= 0) {
    for (int i = 0; i < n; ++i) lies(m, ab + i, gw, l[i], r[i]);
    return;
  }
  // Loop-Drift: Naht j beginnt bei der ungewickelten Position a0 + R(j) (a0 = loop_a − 128, R = loop_naht_r); bis zur ersten
  // (R(1)) das Material, danach im Durchlauf j das Frame q = p − R(j), in [a0, loop_a) geblendet gegen den alten Kopf
  // q + (R(j) − R(j − 1)). Bei ganzzahliger Länge ist das die Rechnung vor dem Fix (R(j) = j · L, bitgleich).
  const double lx = lx_exakt > 0.0 ? lx_exakt : static_cast<double>(loop_l);  // wie DeckBand::loop_lx_wirk
  const int64_t a0 = loop_a - DECK_BLENDE, r1 = loop_naht_r(lx, 1);
  int64_t j = 0, rv = 0, rj = 0, rn = 0;  // Durchlauf j des laufenden Frames, R(j − 1), R(j), R(j + 1)
  for (int i = 0; i < n; ++i) {
    const int64_t p = ab + i;
#ifdef CYPHERDJ_MUTATION_KEYLOCK_LOOP_NAHT_HART
    // Fehlerfall: hart gewickelt, ohne die 128-Frame-Blende des Direktwegs (Test 28)
    (void)a0;
    (void)r1;
    (void)j;
    (void)rv;
    (void)rj;
    (void)rn;
    lies(m, p < loop_a + loop_l ? p : loop_a + (p - loop_a - loop_l) % loop_l, gw, l[i], r[i]);
#else
    const int64_t x = p - a0;
    if (x < r1) {
      lies(m, p, gw, l[i], r[i]);
      continue;
    }
    if (j == 0) {  // erstes Frame hinter der ersten Naht in diesem Aufruf: Durchlauf aus der Lage, danach schrittweise
      j = std::max<int64_t>(1, static_cast<int64_t>(std::floor(static_cast<double>(x) / lx)));
      while (j > 1 && loop_naht_r(lx, j) > x) --j;
      while (loop_naht_r(lx, j + 1) <= x) ++j;
      rv = loop_naht_r(lx, j - 1);
      rj = loop_naht_r(lx, j);
      rn = loop_naht_r(lx, j + 1);
    }
    while (rn <= x) {
      ++j;
      rv = rj;
      rj = rn;
      rn = loop_naht_r(lx, j + 1);
    }
    const int64_t q = p - rj;
    if (q >= loop_a) {
      lies(m, q, gw, l[i], r[i]);
      continue;
    }
    const float w = static_cast<float>(q - a0 + 1) / static_cast<float>(DECK_BLENDE);
    float a, b, c, d;
    lies(m, q, gw, a, b);
    lies(m, q + (rj - rv), gw, c, d);
    l[i] = a * w + c * (1.0f - w);
    r[i] = b * w + d * (1.0f - w);
#endif
  }
#endif
}

void Deck::zurueck(const Material* m) noexcept {
  if (!m) return;
  for (int i = 0; i < n_rueck_; ++i)
    if (rueck_[i] == m) return;
  // mehr als RUECK Wechsel, bevor der Dehner quittiert (rund 85 ms), kommen nicht vor; voll: das Material bleibt liegen
  // (Leck statt Zugriff auf freigegebenen Speicher)
  if (n_rueck_ < RUECK) rueck_[n_rueck_++] = m;
  else ++rueck_verloren_;  // darf nicht vorkommen: der Kern fragt vor jedem Wechsel rueck_frei() (Vertrag 4)
}

// Vertrag 4: zurück nur, was der Dehner nicht mehr lesen kann (Leihe frei); ohne Keylock die Reihenfolge wie bisher.
const Material* Deck::rueckgabe() noexcept {
  if (kl_ && kl_post_) kl_leihe_.pflege(kl_post_->antwort(), kl_->quittiert_e(), kl_wechsel_frei_nr());
  for (int i = 0; i < n_rueck_; ++i) {
    const Material* m = rueck_[i];
    if (kl_leihe_.verliehen([m](const DeckBand& b) { return b.m == m; })) continue;
    for (int j = i + 1; j < n_rueck_; ++j) rueck_[j - 1] = rueck_[j];
    --n_rueck_;
    return m;
  }
  return nullptr;
}

void Deck::blende_von(const Material* alt, int64_t alt_f, float gain) noexcept {
  if (blende_rest_ > 0 && alt_m_ && alt_m_ != alt && alt_m_ != m_) zurueck(alt_m_);  // ältere Blende bricht ab
  alt_m_ = alt;
  alt_f_ = alt_f;
  alt_gain_ = gain;
  blende_rest_ = blende_len_ = DECK_BLENDE;
  alt_schritt_ = 1.0;  // Welle 3: Blenden außerhalb des Tauschs lesen den alten Kopf ganzzahlig wie bis Welle 2
}

void Deck::tausche(int64_t s, const Material* neu) noexcept {
  if (!m_ || !neu || neu == m_) return;
  const Material* alt = m_;
  const double fpb_alt = FRAMES_JE_MINUTE / alt->basis_bpm, fpb_neu = FRAMES_JE_MINUTE / neu->basis_bpm;
  const double kopf_alt = kopf_bei(s);
  const double q = (kopf_alt - static_cast<double>(schlag0())) / fpb_alt;  // Quell-Beat unter dem Kopf
  if (loop_l_ > 0) {  // Loop in die neue Fassung umrechnen (Quell-Beats bleiben)
    const double qa = (static_cast<double>(loop_a_) - static_cast<double>(schlag0())) / fpb_alt;
    loop_a_ = std::llround(static_cast<double>(neu->erster_schlag_frame) + qa * fpb_neu);
    // Loop-Drift: die exakte Länge rechnet um (Quell-Beats bleiben), die Nähte zählen ab dem neuen Loop-Anfang neu
#ifndef CYPHERDJ_MUTATION_TAUSCH_OHNE_LX
    loop_lx_ = loop_lx_ * fpb_neu / fpb_alt;  // Fehlerfall der Prüfung (F3): Zeile weg, Test 36 loop_tausch rot
#endif
    loop_l_ = std::llround(loop_lx_);
    loop_durchlauf_setzen(0);
  }
  if (laeuft_) {
    float g = stopp_rest_ > 0 ? static_cast<float>(stopp_rest_) / DECK_STOPP_RAMPE : 1.0f;
    if (!ein_.offen()) g *= ein_.wert();
    if (kl_einfrieren(s)) {  // Keylock: was klang, blendet aus (Vertrag 8)
      zurueck(alt);
    } else {
      blende_von(alt, std::llround(kopf_alt), g);
      blende_rest_ = blende_len_ = DECK_TAUSCH_BLENDE;
      alt_pos_ = kopf_alt;
      alt_schritt_ = (k_ && !direkt_) ? k_->bpm_at(static_cast<double>(s)) / alt->basis_bpm : 1.0;
    }
  } else {
    zurueck(alt);
  }
  m_ = neu;
  raster_f_ = 0;  // das Raster der alten Fassung (Versatz von Hand) gilt nicht für die neue
  const double f_neu = static_cast<double>(neu->erster_schlag_frame) + q * fpb_neu;
  if (laeuft_) {
    anker_s_ = s;
    anker_f_ = std::llround(f_neu);
    anker_b_ = k_ ? k_->beat_at(static_cast<double>(s)) : 0.0;
    direkt_ = direkt_ueber(s, 1);  // der nächste Block wechselt den Pfad nicht noch einmal
  } else {
    pos_f_ = std::clamp<int64_t>(std::llround(f_neu), 0, neu->frames);
  }
  kl_ereignis(s);
}

void Deck::lade(const Material* m, int64_t s) noexcept {
  const Material* alt = m_;
  if (laeuft_ && alt) {
    float g = stopp_rest_ > 0 ? static_cast<float>(stopp_rest_) / DECK_STOPP_RAMPE : 1.0f;
    if (!ein_.offen()) g *= ein_.wert();  // F10: das alte Material steht noch in der Einblende
    if (kl_einfrieren(s)) zurueck(alt);  // Keylock: was klang, blendet aus (Vertrag 8)
    else blende_von(alt, frame_bei(s), g);
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
  ein_ = Blende();
  anker_s_ = anker_f_ = 0;
  raster_f_ = 0;
  pos_f_ = schlag0();
  kl_ereignis(s);  // Leer-Epoche (steht); das Band des alten Materials wird abgegeben
}

void Deck::entlade(int64_t s) noexcept { lade(nullptr, s); }

// Neuer Lesekopf ab s, vom alten 128 Frames geblendet; Stopp-Rampe und Loop bleiben (Naht, Sprung, Hotcue: Plan E9).
// ereignis = false: kein Ereignis für den Keylock (Naht, Pfadwechsel); klingt der Ring, gibt es dann keine eigene Blende.
void Deck::neu_anker(int64_t s, int64_t f, bool ereignis) noexcept {
  if (laeuft_ && m_) {
    float g = stopp_rest_ > 0 ? static_cast<float>(stopp_rest_) / DECK_STOPP_RAMPE : 1.0f;
    if (!ein_.offen()) g *= ein_.wert();  // F10: der alte Kopf steht noch in der Einblende, er blendet vom Ist-Gain aus
    if (ereignis ? !kl_einfrieren(s) : !kl_les_.ring_hoerbar()) blende_von(m_, frame_bei(s), g);
  }
  anker_s_ = s;
  anker_f_ = f;
  anker_b_ = k_ ? k_->beat_at(static_cast<double>(s)) : 0.0;
}

// Naht im Loop bei s: der alte Kopf blendet 128 Frames aus (wie neu_anker ohne Ereignis), der neue liegt genau d Frames
// davor. Im Direktweg ist das dasselbe Frame wie bisher (bitgleich), im Varispeed bleibt der Bruchteil des Kopfs.
void Deck::naht(int64_t s, int64_t d) noexcept {
  float g = stopp_rest_ > 0 ? static_cast<float>(stopp_rest_) / DECK_STOPP_RAMPE : 1.0f;
  if (!ein_.offen()) g *= ein_.wert();
  if (!kl_les_.ring_hoerbar()) blende_von(m_, frame_bei(s), g);
  anker_f_ -= d;
}

void Deck::start(int64_t s, int64_t f, bool loop_halten, uint64_t plan, double plan_b) noexcept {
  if (laeuft_ && m_ && stopp_rest_ == 0 && loop_l_ == 0 && kl_wplan_traegt(plan, plan_b, f, 0, 0, 0.0)) {
    kl_wplan_zuende(s, f, true);  // Keylock 6b: Start auf laufendem Deck (Cue-Sprung), geplant
    loop_kopf_gesetzt(f);
    return;
  }
  if (kl_plan_.aktiv) {
    if (kl_plan_traegt(f, plan)) {
      // Keylock 6a: geplanter Start aus dem Stand. Der Ring ist mit Vorlauf angesetzt (Anker {b_t, f}, Band still bis f) und
      // klingt meist schon seit s − DECK_VORLAGE: Zustand setzen wie neu_anker ohne Ereignis, KEIN neuer Ansatz (keine Brücke).
      neu_anker(s, f, false);  // steht: keine Blende
      laeuft_ = m_ != nullptr;
      stopp_rest_ = 0;
      const bool hoer = kl_les_.ring_hoerbar();
#ifdef CYPHERDJ_MUTATION_PLAN_START_MIT_EIN
      (void)hoer;  // Fehlerfall (Entwurf 6a, F10 behalten): Einblende auch über den schon klingenden Ring (Kerbe)
      ein_ = Blende(0.0f);
      ein_.ziel(1.0f, DECK_START_EIN);
#else
      // 3.8 Punkt 1 (wie loopbox.cpp 7b.2): klingt der Ring schon vor dem Einsatz, kommt der Einsatz aus Stille (Band) und
      // braucht keine Einblende; sie multiplizierte den Ring bei s mit 1/48 (mische, ge). Sonst F10 wie jeder Start.
      if (!hoer) {
        ein_ = Blende(0.0f);
        ein_.ziel(1.0f, DECK_START_EIN);
      }
#endif
#ifndef CYPHERDJ_MUTATION_PLAN_START_STILL_NACH_UMZIEL
      // 3.8 Punkt 2 (7c.1): rückt der Einsatz vor s_h + STRECK_EINSCHWING (Rampe in der Wartezeit), setzt das Deck im
      // Varispeed ein; der Ring kommt danach über die Brücke, nicht als Start aus Stille (der spränge ohne Blende ein).
      if (!hoer && kl_les_.s_h() + STRECK_EINSCHWING > s) kl_les_.aus_stille(false);
#endif
      if (!hoer && direkt_ueber(s, 1)) kl_les_.aus_stille(false);  // Basis: Direktweg, ein späterer Ring braucht die Blende
      if (!loop_halten) loop_l_ = 0;
      loop_kopf_gesetzt(f);
      if (!kl_plan_.still) ++kl_geplant_frueh_;
      kl_plan_.aktiv = false;
      kl_vor_ = false;
      ++kl_geplant_ok_;
      return;
    }
    kl_plan_fallen(s);  // trägt nicht (anderer Zustand, Ring nicht bereit): der heutige Weg, die Vorlage blendet vorher aus
  }
  // F10 (Audit 2026-10-01): steht das Deck, gibt es keinen alten Kopf, aus dem die 128-Frame-Blende käme (neu_anker
  // blendet nur bei laeuft_): der Einsatz mitten in der Wellenform bekommt eine eigene Einblende.
  const bool aus_dem_stand = !(laeuft_ && m_);
  neu_anker(s, f);
  laeuft_ = m_ != nullptr;
  stopp_rest_ = 0;
#ifndef CYPHERDJ_MUTATION_DECK_OHNE_EIN
  if (aus_dem_stand && laeuft_) {
    ein_ = Blende(0.0f);
    ein_.ziel(1.0f, DECK_START_EIN);
  }
#else
  (void)aus_dem_stand;  // Fehlerfall der Abnahme: harter Einsatz wie vor Welle 2
#endif
  if (!loop_halten) loop_l_ = 0;  // Plan E9: Start beendet einen Loop (Attrappe decks.mjs starteDeck), Play der Hand nicht
  loop_kopf_gesetzt(f);  // Prüfung F1: vor dem Loop-Anfang Durchlauf 0 (vor dem Ansatz, der ihn in den Anker nimmt)
  kl_ereignis(s);
}

void Deck::setze_kopf(int64_t s, int64_t f, uint64_t plan, double plan_b) noexcept {
  if (laeuft_ && kl_wplan_traegt(plan, plan_b, f, 0, 0, 0.0)) {  // Keylock 6b: geplanter Sprung bzw. Hotcue, der Wechsel trägt
    kl_wplan_zuende(s, f, true);
    loop_kopf_gesetzt(f);
    return;
  }
  if (laeuft_) {
    neu_anker(s, f);
    loop_kopf_gesetzt(f);  // Prüfung F1 (Sprung mit dem Loop: f und Loop-Anfang wandern gleich, im Loop bleibt der Durchlauf)
    kl_ereignis(s);
  } else {
    pos_f_ = std::clamp<int64_t>(f, 0, m_ ? m_->frames : 0);
  }
}

int64_t Deck::stopp(int64_t s, bool loop_halten) noexcept {
  if (!laeuft_) return s;
  if (kl_wplan_.aktiv) kl_wplan_verwerfen(s);  // 6b: der Stopp nimmt das geplante Ereignis zurück (Gegenwechsel, 3.7)
  if (!loop_halten) loop_l_ = 0;  // Plan E9: Stopp beendet einen Loop (Attrappe decks.mjs stoppeDeck), Pause der Hand nicht
  if (stopp_rest_ == 0) stopp_rest_ = DECK_STOPP_RAMPE;
  return s + stopp_rest_;
}

void Deck::setze_lauf(int64_t anker_s, int64_t anker_f) noexcept {
  laeuft_ = m_ != nullptr;
  stopp_rest_ = 0;
  ein_ = Blende();
  anker_s_ = anker_s;
  anker_f_ = anker_f;
  anker_b_ = k_ ? k_->beat_at(static_cast<double>(anker_s)) : 0.0;
  kl_offen_ = laeuft_ ? KlOffen::ANSATZ : KlOffen::LEER;  // Neustart: der Anker kann zurückliegen, angesetzt wird am Block
}

void Deck::setze_lauf_beat(int64_t anker_s, double anker_b, int64_t anker_f) noexcept {
  laeuft_ = m_ != nullptr;
  stopp_rest_ = 0;
  ein_ = Blende();
  anker_s_ = anker_s;
  anker_f_ = anker_f;
  anker_b_ = anker_b;
  direkt_ = false;  // der nächste Block entscheidet den Pfad; im Varispeed gilt der Beat-Anker
#ifndef CYPHERDJ_MUTATION_KEYLOCK_NEUSTART_OHNE_ANSATZ
  kl_offen_ = laeuft_ ? KlOffen::ANSATZ : KlOffen::LEER;  // Keylock: Ansatz am nächsten Blockanfang (Task 2 Test 8)
#endif
}

bool Deck::direkt_ueber(int64_t s, int n) const noexcept {
  if (!k_ || !m_) return true;
#ifdef CYPHERDJ_MUTATION_DECK_VARISPEED_STARR
  (void)s;
  (void)n;
  return true;  // Fehlerfall der Abnahme: ein Frame je Sample wie bis Welle 2, das Tempo zählt nicht
#else
  const double b = m_->basis_bpm;
  return std::fabs(k_->bpm_at(static_cast<double>(s)) / b - 1.0) < TEMPO_GLEICH_DECK &&
         std::fabs(k_->bpm_at(static_cast<double>(s + n)) / b - 1.0) < TEMPO_GLEICH_DECK &&
         k_->k_at(static_cast<double>(s)) == 0.0 && k_->k_at(static_cast<double>(s + n)) == 0.0;
#endif
}

double Deck::kopf_bei(int64_t s) const noexcept {
  if (!laeuft_) return static_cast<double>(pos_f_);
  if (direkt_ || !k_ || !m_) return static_cast<double>(frame_bei(s));
  return static_cast<double>(anker_f_) + (k_->beat_at(static_cast<double>(s)) - anker_b_) * (FRAMES_JE_MINUTE / m_->basis_bpm);
}

void Deck::setze_position(int64_t f) noexcept {
  if (laeuft_) kl_offen_ = KlOffen::LEER;
  laeuft_ = false;
  stopp_rest_ = 0;
  ein_ = Blende();
  pos_f_ = f;
}

void Deck::springe(int64_t s, int64_t d, uint64_t plan, double plan_b) noexcept {
  if (loop_l_ > 0) loop_a_ += d;
  setze_kopf(s, (laeuft_ ? frame_bei(s) : pos_f_) + d, plan, plan_b);
}

void Deck::setze_raster(int64_t s, int64_t v) noexcept {
  if (!m_) return;
  const int64_t d = v - raster_f_;
  raster_f_ = v;
#ifndef CYPHERDJ_MUTATION_RASTER_OHNE_KOPF
#ifdef CYPHERDJ_MUTATION_KEYLOCK_RASTER_LOOP_NACH_ANSATZ
  // Fehlerfall (Stand Task 5): der Ansatz in springe trägt den verschobenen Loop, danach endet er ohne Ereignis (Test 29)
  if (d != 0) springe(s, d);
  if (loop_l_ > 0 && (loop_a_ < 0 || loop_a_ + loop_l_ > m_->frames)) loop_l_ = 0;
#else
  // Audit F09: das Raster ist schon quittiert; schiebt es den Loop aus dem Material, endet der Loop statt still zu laufen.
  // Task 5b (Prüfung MAJOR): entschieden VOR dem Sprung, damit dessen Ansatz (Keylock) schon ohne Loop ansetzt; sonst wickelte
  // der Ring einen Loop, den das Deck nicht mehr hat.
  if (loop_l_ > 0 && (loop_a_ + d < 0 || loop_a_ + d + loop_laenge_max() > m_->frames)) loop_l_ = 0;
  if (d != 0) springe(s, d);  // Fehlerfall der Abnahme: nur die Linien wandern, der Ton bleibt, Quell-Beat springt
#endif
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
  if (!direkt_ && k_ && m_) return std::llround(kopf_bei(s));  // Welle 3: Varispeed, nächstes ganzes Frame
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

// Keylock (Task 5, Vertrag 6): Loop an und aus sind Ereignisse wie jedes andere: was klingt, blendet gegen die Varispeed-
// Brücke aus, der Ansatz trägt das Band mit dem neuen Loop (bzw. ohne).
void Deck::loop_an(int64_t s, int64_t a_f, int64_t laenge_f, double laenge_exakt, uint64_t plan, double plan_b) noexcept {
  const double lx = laenge_exakt > 0.0 ? laenge_exakt : static_cast<double>(laenge_f > 0 ? laenge_f : 0);
  if (laenge_f > 0 && kl_wplan_traegt(plan, plan_b, -1, a_f, laenge_f, lx)) {  // Keylock 6b: Loop an geplant, das Band wickelt schon
    loop_a_ = a_f;
    loop_l_ = laenge_f;
    loop_lx_ = lx;
    loop_durchlauf_setzen(0);
    kl_wplan_zuende(s, 0, false);
    return;
  }
  if (kl_bereit()) kl_einfrieren(s);
  loop_a_ = a_f;
  loop_l_ = laenge_f > 0 ? laenge_f : 0;
  loop_lx_ = laenge_exakt > 0.0 ? laenge_exakt : static_cast<double>(loop_l_);
  loop_durchlauf_setzen(0);
  kl_ereignis(s);
}

// loop_aus braucht kein eigenes Einfrieren: der Kopf bleibt, und der Ansatz legt s_h in die Zukunft, der Leser friert darum
// beim ersten Sample selbst ein (StreckLeser::mische, Ring hörbar und nicht mehr gewollt). Gemessen 08.10.: ein zusätzliches
// kl_einfrieren(s) hier ändert Test 27 um kein Bit (task-05/mut_deck_loop_aus.txt).
void Deck::loop_aus(int64_t s) noexcept {
  const bool war = loop_l_ > 0;
  loop_l_ = 0;
  if (war) kl_ereignis(s);
}

// ------------------------------------------------------------------------------------------------ Keylock (Task 2)

void Deck::setze_keylock(DehnerBasis* d, StreckPost* post) noexcept {
  kl_ = d;
  kl_post_ = post;
  kl_les_.verbinde(d, post, k_, gen_);
  // Task 2.5b: der Kern hängt den Dehner im Betrieb erst an, wenn er gebaut ist (Kern::keylock_bauen); läuft das Deck da
  // schon (Varispeed seit dem Start oder dem Neustart), setzt es am nächsten Blockanfang an
  // Beim Neustart hängen die Dehner immer erst nach decks_nachladen an: diese Zeile trägt den Ansatz nach dem Neustart
  // darum mit (neben setze_anker oben); die Mutation NEUSTART_OHNE_ANSATZ nimmt beide Träger weg.
#if !defined(CYPHERDJ_MUTATION_KEYLOCK_SPAET_OHNE_ANSATZ) && !defined(CYPHERDJ_MUTATION_KEYLOCK_NEUSTART_OHNE_ANSATZ)
  if (d && laeuft_ && kl_offen_ == KlOffen::NICHTS) kl_offen_ = KlOffen::ANSATZ;
#endif
}

void Deck::keylock(int64_t s, bool an) noexcept {
  if (an == kl_an_) return;
  // Keylock 7c.4 (a, Entscheidung der Hauptinstanz 08.10.): Knopf aus auf der Basis bei hörbarem Ring: der Ring bleibt
  // hörbar bis zum nächsten Ereignis bzw. bis das Tempo die Basis verlässt (dann normal in den Varispeed-Weg)
#ifndef CYPHERDJ_MUTATION_KEYLOCK_AUS_BASIS_EINFRIEREN
  if (!an && kl_bereit() && direkt_ && kl_les_.ring_hoerbar() && !kl_les_.blendet()) {
    kl_an_ = false;
    kl_halten_ = true;
    return;
  }
#endif
  if (an && kl_halten_) {  // wieder an: der gehaltene Ring läuft weiter
    kl_an_ = true;
    kl_halten_ = false;
    return;
  }
#ifdef CYPHERDJ_MUTATION_PLAN_KNOPF_VOLL
  if (!an) kl_einfrieren(s);  // Fehlerfall (Stand e0968ef9): auch in der Vorlage 960 Frames, der Keylock-Einsatz klingt neben dem Varispeed
#else
  // Fix-Runde 2 Doppel-1: in der Vorlage eines geplanten Starts nur die kurze Ausblende; der Einsatz kommt danach im Varispeed, der
  // eingefrorene Keylock-Einsatz klänge sonst rund 20 ms daneben (60 BPM 416 Hz 0,271 neben 195 Hz 0,179)
  if (!an) kl_einfrieren(s, kl_vor_ ? DECK_VORLAGE_AUS : STRECK_BLENDE);
#endif
  kl_an_ = an;
  kl_ereignis(s);
}

// Nach einem Ereignis bei s: läuft das Deck (Keylock an; mit oder ohne Loop, Task 5), ein Ansatz auf s + ANSATZ_FRIST, sonst
// die Leer-Epoche.
void Deck::kl_ereignis(int64_t s) noexcept {
  if (!kl_bereit()) return;
  kl_halten_ = false;  // 7c.4: ein Ereignis beendet den gehaltenen Ring (es friert vorher ein)
  const bool band = kl_an_ && laeuft_ && m_ && kl_loop_ok();
  if (!band && kl_les_.ist_leer() && kl_les_.anfrage() != 0 && (!kl_band_ || kl_band_->m == m_)) return;  // schon leer
  kl_anfordern(s, band);
}

// Auftrag an den Leser: mit_band Ansatz mit dem Band des geladenen Materials, Anker = Kopf bei s; sonst Leer-Epoche.
// Wechselte das Material oder der Loop, wird das alte Band mit diesem Auftrag abgegeben (StreckLeihe, Vertrag 4). Ein Band
// ändert sich nie, solange es verliehen ist (der Dehner liest es aus zwei Fäden, dehner.h): ein neuer Loop nimmt einen
// neuen Platz (Task 5).
bool Deck::kl_band_passt(const DeckBand* b) const noexcept {
  // 6b (3.5): ein PlanBand passt nie (Versatz, Wechsel); das nächste Ereignis nimmt ein gewöhnliches Band mit Anker in Material
  return !b->plan() && b->m == m_ && b->loop_l == loop_l_ && (loop_l_ == 0 || (b->loop_a == loop_a_ && b->loop_lx == loop_lx_));
}

void Deck::kl_anfordern(int64_t s, bool mit_band) noexcept {
  if (!kl_bereit()) return;
  if (kl_plan_.aktiv || kl_vor_) kl_plan_fallen(s);  // Keylock 6a: jedes Ereignis nimmt einen geplanten Start zurück
  // Keylock 6b (3.6 Punkt 3, 3.7): ein Ereignis mit neuem Auftrag nimmt den Wechselplan und einen offenen Gegenwechsel zurück; ihre
  // PlanBänder gehen über den Epochenweg (abgeben mit diesem Auftrag), der neue Ansatz liest sie nicht
  const DeckBand* plan_ab[2] = {nullptr, nullptr};
  if (kl_wplan_.aktiv) {
    plan_ab[0] = kl_wplan_.neu;
    if (!kl_wplan_.selbst) kl_verw6b();  // „gespielt“ ist schon gezählt (S3)
    kl_wplan_.aktiv = false;
  }
  if (kl_gegen_.aktiv) {
    plan_ab[1] = kl_gegen_.plan.neu;
    kl_gegen_.aktiv = false;
    kl_verw6b();  // Gegenwechsel offen: der Abbruch endet hier (Zone 3 mit Brücke oder Ereignis)
  }
  DeckBand* alt = nullptr;
  if (kl_band_ && !kl_band_passt(kl_band_)) {
    alt = kl_band_;
    kl_band_ = nullptr;
  }
  if (mit_band && !kl_band_) {
    kl_band_ = kl_nimm();
    if (kl_band_) {
      kl_band_->m = m_;
      kl_band_->g = kl_g_;
      kl_band_->loop_a = loop_l_ > 0 ? loop_a_ : 0;
      kl_band_->loop_l = loop_l_;
      kl_band_->loop_lx = loop_l_ > 0 ? loop_lx_ : 0.0;
    } else {
      ++kl_kein_platz_;  // alle Plätze verliehen: diesmal ohne Ring (Varispeed), kein Zugriff auf fremdes Material
      mit_band = false;
    }
  }
  uint32_t nr;
  if (mit_band) {
#ifdef CYPHERDJ_MUTATION_KEYLOCK_ANKER_DANEBEN
    const double fehl = 1920.0;  // Fehlerfall der Prüfung: Anker 40 ms daneben (ganze Perioden eines 1-kHz-Sinus)
#else
    const double fehl = 0.0;
#endif
    // Loop-Drift: der Anker ist die UNGEWICKELTE Quellposition (Kopf + R(j), j Nähte seit loop_an), in der das Band seine
    // Nähte zählt (DeckBand::band); so wickelt der Ring auch nach einem Ansatz im Durchlauf j dieselben Längen wie das Deck
#ifdef CYPHERDJ_MUTATION_KEYLOCK_ANKER_OHNE_WICKEL
    const double wickel = 0.0;  // Fehlerfall der Prüfung (F4): gewickelter Anker, Test 35 loop_ansatz_band rot
#else
    const double wickel = loop_l_ > 0 ? static_cast<double>(loop_naht_r(loop_lx_, loop_j_)) : 0.0;
#endif
    kl_band_->still_bis.store(INT64_MIN, std::memory_order_relaxed);  // 6a: ein gewöhnlicher Ansatz ist nie still
    nr = kl_les_.ansetzen(s, kl_band_, DehnerAnker{k_->beat_at(static_cast<double>(s)), kopf_bei(s) + wickel + fehl});
    kl_les_merke(kl_band_);
  } else {
    nr = kl_les_.leer(s);
  }
  if (alt) kl_leihe_.abgeben(alt, nr);
  for (const DeckBand* b : plan_ab)
    if (b) kl_leihe_.abgeben(b, nr);
}

// ------------------------------------------------------------------------------------------------ Keylock 6a
// Start aus dem Stand, geplant (Plan Task 6, Detailschnitt 3.8; Muster LoopBoxen::kl_ansetzen mit Vorlauf, 7b.2, 7c.1 bis 7c.3).
bool Deck::kl_plane_start(int64_t n0, int64_t s_t, double b_t, int64_t f, uint64_t schluessel) noexcept {
#ifdef CYPHERDJ_MUTATION_PLAN_START_AUS
  (void)n0, (void)s_t, (void)b_t, (void)f, (void)schluessel;
  return false;  // Fehlerfall: Stand vor 6a (kein Plan, jeder Start über die Brücke)
#else
  // 2.3: nur ein stehendes Deck ohne Loop im Keylock, Ziel außerhalb der Basis (dort klingt der Direktweg), Ziel nicht vorbei
#ifdef CYPHERDJ_MUTATION_PLAN_BASIS_PLANEN
  const bool basis = false;  // Fehlerfall: der Planer ignoriert die Basis (geplant_negativ a rot)
#else
  const bool basis = direkt_ueber(s_t, 1);
#endif
#ifdef CYPHERDJ_MUTATION_PLAN_OHNE_F_MIN
  const bool langsam = false;  // Fehlerfall (Stand 9f78da53): jeder Faktor wird geplant
#else
  // Fix-Runde 1 F4: unter DECK_START_F_MIN ist die Vorlage nicht gemessen (rohes R3 liegt dort schon vor E − 768)
  const bool langsam = k_ && m_ && k_->bpm_at(static_cast<double>(s_t)) / m_->basis_bpm < DECK_START_F_MIN - 1e-9;
#endif
  const bool moeglich =
      kl_bereit() && kl_an_ && m_ && !laeuft_ && loop_l_ == 0 && schluessel != 0 && s_t >= n0 && !basis && !langsam;
  if (!moeglich) {
    if (kl_plan_.aktiv) kl_plan_verwerfen(n0);
    return false;
  }
  if (kl_plan_.aktiv && kl_plan_.schluessel == schluessel && kl_plan_.f == f && kl_plan_.b == b_t &&
      kl_les_.anfrage() == kl_plan_.nr) {
    kl_plan_.s_t = s_t;  // derselbe Plan; eine Rampe verschiebt nur das Einsatz-Sample (der Anker hängt am Beat)
    return true;
  }
#ifdef CYPHERDJ_MUTATION_PLAN_OHNE_FRUEHANSATZ
  const int64_t v_min = DECK_START_VORLAUF;  // Fehlerfall (Stand 9f78da53): unter dem vollen Vorlauf kein Plan, volle Brücke
#else
  const int64_t v_min = ANSATZ_FRIST + 1;  // F3: der frühe Ansatz muss vor s_t liegen (s_h = n0 + ANSATZ_FRIST < s_t)
#endif
  if (s_t - n0 < v_min) {  // zu kurz: kein Plan (ein Neuanker so spät nimmt den alten zurück)
    if (kl_plan_.aktiv) kl_plan_verwerfen(n0);
    if (kl_kurz_schluessel_ != schluessel) {
      kl_kurz_schluessel_ = schluessel;
      ++kl_geplant_kurz_;
    }
    return false;
  }
  if (kl_vor_) kl_vorlage_aus(n0);  // 7c.2: Neuanker, während der Ring der Vorlage klingt: er blendet erst aus
  DeckBand* alt = nullptr;
#ifdef CYPHERDJ_MUTATION_PLAN_RASTER_NEUER_PLATZ
  if (kl_band_ && kl_plan_.aktiv) {  // Fehlerfall (Box Stand 7b): ein Neuanker im wartenden Deck nimmt einen neuen Platz
    alt = kl_band_;
    kl_band_ = nullptr;
  }
#endif
  if (kl_band_ && !kl_band_passt(kl_band_)) {
    alt = kl_band_;
    kl_band_ = nullptr;
  }
  if (!kl_band_) {
    kl_band_ = kl_nimm();
    if (!kl_band_) {  // alle Plätze verliehen: kein Plan (am Ziel der heutige Weg)
      ++kl_kein_platz_;
      if (alt) kl_leihe_.abgeben(alt, kl_les_.leer(n0));
      kl_plan_.aktiv = false;
      return false;
    }
    kl_band_->m = m_;
    kl_band_->g = kl_g_;
    kl_band_->loop_a = 0;
    kl_band_->loop_l = 0;
    kl_band_->loop_lx = 0.0;
  }
#ifdef CYPHERDJ_MUTATION_PLAN_START_OHNE_VORLAGE
  // Fehlerfall: Ansatz wie bei jedem Ereignis (s_h = n0 + ANSATZ_FRIST), kein Start aus Stille, keine Vorlage
  const int64_t s_h = n0 + ANSATZ_FRIST;
  const bool still = false;
#else
  const int64_t s_h = std::max<int64_t>(n0 + ANSATZ_FRIST, s_t - STRECK_EINSCHWING - DECK_VORLAGE);
#ifdef CYPHERDJ_MUTATION_PLAN_STILL_KURZE_VORLAGE
  const bool still = s_h + STRECK_EINSCHWING <= s_t;  // Fehlerfall (Stand e0968ef9, wie die Box): still auch mit verkürzter Vorlage
#else
  // Fix-Runde 2 F3-R1 (Entscheid der Hauptinstanz): Start aus Stille nur mit voller Vorlage (V ≥ DECK_START_VORLAUF). Mit verkürzter
  // Vorlage (V 5504 bis 6271) setzte der Ring nach dem Beginn des R3-Vorlaufs hart ein (80 BPM Klick bis 0,4889).
  const bool still = s_h == s_t - STRECK_EINSCHWING - DECK_VORLAGE;
#endif
#endif
  // Quellframe des Einsatzes (kopf(s_t) im Dehner, ohne Loop ungewickelt = f); davor liefert das Band Stille. Gleiches Band
  // bei einem Neuanker: der Wert wird atomar nachgezogen (7c.3), eine alte, noch rechnende Epoche ist im Stand nicht hörbar.
  kl_band_->still_bis.store(still ? f : INT64_MIN, std::memory_order_relaxed);
#ifndef CYPHERDJ_MUTATION_PLAN_LEER_NIMMT_PLAN
  // Fix-Runde 1 F1/Q1: ein offener Auftrag des stehenden Decks (Leer-Epoche nach dem Ende der Stopp-Rampe, setze_position) ist mit
  // diesem Ansatz erledigt; Deck::block nähme sonst am selben Blockanfang den eben gebauten Plan zurück (Brücke trotz Vorlauf).
  kl_offen_ = KlOffen::NICHTS;
#endif
  const uint32_t nr = kl_les_.ansetzen_ab(n0, s_h, kl_band_, DehnerAnker{b_t, static_cast<double>(f)});
  kl_les_merke(kl_band_);
  if (still) kl_les_.aus_stille();
  if (alt) kl_leihe_.abgeben(alt, nr);
  kl_plan_.aktiv = true;
  kl_plan_.schluessel = schluessel;
  kl_plan_.f = f;
  kl_plan_.b = b_t;
  kl_plan_.s_t = s_t;
  kl_plan_.nr = nr;
  kl_plan_.still = still;
  return true;
#endif
}

// Trägt der Plan den Start bei Frame f mit diesem Schlüssel? Dieselbe Aktion (Schlüssel), derselbe Startframe, kein Ereignis
// seit dem Planen (Anfrage des Lesers), das Deck steht noch ohne Loop, und der Ring ist da oder als Start aus Stille bereit.
bool Deck::kl_plan_traegt(int64_t f, uint64_t schluessel) const noexcept {
#ifdef CYPHERDJ_MUTATION_PLAN_AUSFUEHRUNG_FRIERT
  (void)f, (void)schluessel;
  return false;  // Fehlerfall: am Ziel trotz Plan der heutige Weg (neuer Ansatz, Brücke)
#else
  return kl_plan_.aktiv && schluessel != 0 && schluessel == kl_plan_.schluessel && f == kl_plan_.f && !laeuft_ && m_ &&
         loop_l_ == 0 && kl_bereit() && kl_an_ && kl_les_.anfrage() == kl_plan_.nr && !kl_les_.ist_leer() &&
         // Start aus Stille: Ring da oder bereit (3.8 Punkt 5). Früher Ansatz ohne still (F3): der Ring darf noch nicht klingen,
         // das Deck setzt im Varispeed ein und der Leser blendet bei s_h + STRECK_EINSCHWING über die Brücke ein.
         (kl_plan_.still ? (kl_les_.ring_hoerbar() || kl_les_.still_bereit()) : !kl_les_.ring_beteiligt());
#endif
}

void Deck::kl_plan_fallen(int64_t s) noexcept {
  if (kl_plan_.aktiv) ++kl_geplant_verw_;
  kl_plan_.aktiv = false;
  if (kl_vor_) kl_vorlage_aus(s);
}

void Deck::kl_plan_verwerfen(int64_t s) noexcept {
  if (kl_wplan_.aktiv) kl_wplan_verwerfen(s);  // 6b: Zonen, Gegenwechsel (3.7)
  if (!kl_plan_.aktiv) return;
  kl_plan_fallen(s);
  kl_ereignis(s);  // das Deck steht: Leer-Epoche, der R3 ruht (Vertrag 18)
}

// 7c.2 (Box: LoopBoxen::kl_vorlage_aus): ein Ereignis in der Vorlage schaltete den schon hörbaren Ring sonst hart ab. Der Leser
// friert ein, was klingt (ist es schon eingefroren, etwa vom Knopf, bleibt diese Blende), und block() spielt die Ausblende
// gegen Stille (das Deck steht: der Varispeed-Weg ist 0); setzt das Deck derweil ein, blendet sie in dessen Weg.
void Deck::kl_vorlage_aus(int64_t s) noexcept {
  kl_vor_ = false;
#ifdef CYPHERDJ_MUTATION_PLAN_VORLAGE_STUMM
  (void)s;
  kl_les_.stumm();  // Fehlerfall (Box Stand 7b): hart aus
#else
  // Fix-Runde 1 Q2: der Start fällt, sein Einsatz darf nicht mehr klingen: kurze Ausblende (DECK_VORLAGE_AUS) statt bis zu 960
  // Frames, in denen der Einsatz läge
#if defined(CYPHERDJ_MUTATION_PLAN_VORLAGE_VOLL)
  const int lang = STRECK_BLENDE;  // Fehlerfall (Stand 9f78da53): volle Ausblende, der Einsatz klingt darin
#elif defined(CYPHERDJ_PROBE_VORLAGE_BIS_EINSATZ)
  // Probe (Vorschlag der Prüfung): nur Frames vor dem Einsatz, min(960, s_t − s); unter 128 lehnt der Leser ab (hart stumm)
  const int lang = static_cast<int>(std::clamp<int64_t>(kl_plan_.s_t - s, 0, STRECK_BLENDE));
#else
  const int lang = DECK_VORLAGE_AUS;
#endif
  if (!kl_les_.blendet() && !kl_einfrieren(s, lang)) kl_les_.stumm();  // weniger als STRECK_ALT_MIN Frames: nichts zum Ausblenden
#endif
}

// ------------------------------------------------------------------------------------------------ Keylock 6b
// Geplantes Ereignis auf laufendem Deck, Wechsel in der Quelle (Plan Task 6, Detailschnitt 3.3 bis 3.7, Bauart Q).
bool Deck::kl_plane(int64_t n0, const KlAktion& a) noexcept {
  KlWPlan& P = kl_wplan_;
  if (P.aktiv) {  // ein Plan je Deck: derselbe bleibt (s_t folgt der Karte, kl_wplan_s_t), ein anderer wartet
    return !P.selbst && a.id == P.id && a.ab_beat == P.ab_beat;
  }
  auto nein = [this](int grund) {
    ++kl_plan_abgelehnt_;
    ++kl_plan_grund_[grund];
    return false;
  };
  // Hat der Thread diese Aktion schon verfehlt (zu spät), wäre jeder weitere Versuch noch später: einmal, nicht je Block
  if (a.id == kl_wplan_fehl_id_ && a.ab_beat == kl_wplan_fehl_b_) return nein(0);
  // 2.3 und 3.4: laufend im Ring, ohne Loop (6b-1), kein anderer Plan, kein Gegenwechsel offen (ein Wechsel je Deck zugleich)
  if (!kl_bereit() || !kl_an_ || !m_ || !laeuft_ || stopp_rest_ > 0 || kl_halten_ || loop_l_ != 0 || a.id == 0) return nein(1);
  if (kl_plan_.aktiv || kl_vor_ || kl_gegen_.aktiv || !kl_band_ || !ein_.offen()) return nein(2);
  const bool loop_an = a.art == KL_LOOP_AN;
  if (!loop_an && a.art != KL_SPRUNG && a.art != KL_HOTCUE && a.art != KL_START) return nein(3);
#ifdef CYPHERDJ_MUTATION_PLAN_LOOP_LEER
  if (loop_an) return nein(4);  // Fehlerfall: kein Plan für Loop an (P5 rot)
#endif
  if (loop_an ? a.loop_l <= 0 : a.loop_l != 0) return nein(5);
  if (a.s_t <= n0 || direkt_ || direkt_ueber(a.s_t, 1)) return nein(6);  // 2.3 Punkt 2: Ziel auf der Basis
  if (!kl_les_.ring_hoerbar() || kl_les_.blendet() || kl_les_.ist_leer()) return nein(7);  // 2.3 Punkt 4
  const uint32_t e = kl_les_.epoche();
  if (e == EPOCHE_KEINE || kl_->quittiert_e() != e || kl_->epoche() != e) return nein(8);  // Epoche bestätigt und aktiv
  // Zustand der Epoche vor dem Wechsel: bei einem PlanBand der Zustand nach dessen Wechsel (das Deck spielt ihn schon). Gilt nur für
  // Bandpositionen hinter dem alten p_sw; vorher liest niemand mehr (Thread und Ansätze liegen dahinter, Ansätze lesen ab kopf(s_h)).
  const DeckBand& alt = *kl_band_;
  const bool alt_plan = alt.p_sw != INT64_MAX;
  const int64_t off_c = alt_plan ? alt.off_neu : alt.off;
  const int64_t la = alt_plan ? alt.loop2_a : alt.loop_a, ll = alt_plan ? alt.loop2_l : alt.loop_l;
  const double llx = alt_plan ? alt.loop2_lx : alt.loop_lx;
  if (ll != 0) return nein(9);  // das Band wickelt (Loop): 6b-2, nicht hier
  const DehnerAnker an = kl_les_.anker();
  const double fpb = FRAMES_JE_MINUTE / m_->basis_bpm;
  // Kopf des Decks = Kopf des Dehners + Versatz (sonst stimmt das PlanBand nicht zum Zustand des Decks)
  const double kopf_d = an.f + (k_->beat_at(static_cast<double>(n0)) - an.b) * fpb + static_cast<double>(off_c);
  if (std::fabs(kopf_bei(n0) - kopf_d) > 2.0) {
    return nein(10);
  }
#ifdef CYPHERDJ_MUTATION_PLAN_P_SW_AUS_SAMPLE
  // Fehlerfall: p_sw aus dem Ziel-Sample, linear mit dem Tempo beim Planen (eine Rampe dazwischen verschiebt den Sprung, P9 rot)
  const int64_t p_sw = std::llround(kopf_d - static_cast<double>(off_c) +
                                    static_cast<double>(a.s_t - n0) * k_->bpm_at(static_cast<double>(n0)) / m_->basis_bpm);
#else
  const int64_t p_sw = std::llround(an.f + (a.ab_beat - an.b) * fpb);  // 3.1: am Beat
#endif
  int64_t p_gleich;
  int x;
  int64_t off_neu;
  if (loop_an) {
    // Q ohne Sprung (2.2): das Band mit Loop liefert bis zur ersten Naht dasselbe; sie beginnt bei Material a − 128 + R(1)
    const double lx = a.loop_lx > 0.0 ? a.loop_lx : static_cast<double>(a.loop_l);
    p_gleich = a.loop_a - DECK_BLENDE + loop_naht_r(lx, 1) - off_c;
    if (p_gleich <= p_sw) return nein(11);  // der Kopf läge am Ziel schon hinter der ersten Naht
    x = 0;
    off_neu = off_c;
  } else {
#ifdef CYPHERDJ_MUTATION_PLAN_OHNE_BLENDE
    x = 0;  // Fehlerfall: harter Schnitt (P2 rot über den Rest-RMS)
#else
    x = PLAN_BLENDE_VOR;
#endif
    p_gleich = p_sw - x;
#ifdef CYPHERDJ_MUTATION_PLAN_OHNE_SPRUNG
    off_neu = off_c;  // Fehlerfall: kein Sprung im Band (P1m, P3 rot; P1 bleibt grün)
#else
    off_neu = a.f_neu - p_sw;
#endif
  }
  DeckBand* nb = kl_nimm();
  if (!nb) {
    ++kl_kein_platz_;
    return nein(12);
  }
  nb->m = m_;
  nb->g = kl_g_;
  nb->off = off_c;
  nb->loop_a = la;
  nb->loop_l = ll;
  nb->loop_lx = llx;
  nb->still_bis.store(alt.still_bis.load(std::memory_order_relaxed), std::memory_order_relaxed);
  nb->p_sw = p_sw;
  nb->off_neu = off_neu;
  nb->x = x;
  nb->loop2_a = loop_an ? a.loop_a : 0;
  nb->loop2_l = loop_an ? a.loop_l : 0;
  nb->loop2_lx = loop_an ? (a.loop_lx > 0.0 ? a.loop_lx : static_cast<double>(a.loop_l)) : 0.0;
  WechselAuftrag w;
  w.epoche = e;
  w.neu = nb;
  w.p_gleich_bis = p_gleich;
  P = KlWPlan{};
  P.aktiv = true;
  P.id = a.id;
  P.ab_beat = a.ab_beat;
  P.art = a.art;
  P.f_neu = a.f_neu;
  P.loop_a = nb->loop2_a;
  P.loop_l = nb->loop2_l;
  P.loop_lx = nb->loop2_lx;
  P.wnr = kl_->wechsel(w);
  P.epoche = e;
  P.anfrage = kl_les_.anfrage();
  P.neu = nb;
  P.p_sw = p_sw;
  P.p_gleich = p_gleich;
#ifdef CYPHERDJ_MUTATION_PLAN_LEIHE_FRUEH_FREI
  kl_leihe_.abgeben_wechsel(kl_band_, P.wnr);  // Fehlerfall (Entwurf): Altband frei mit der Annahme (pflege mit wechsel_gelesen)
#endif
  return true;
}

// Einen Platz der Leihe nehmen. Ein Eintrag in kl_frei_, der auf diesen Platz zeigt, ist veraltet (der Platz war frei, sonst hätte nimm
// ihn nicht gegeben) und fällt hier, bevor er den neu verliehenen Platz über den Epochenweg freigibt (Fund aus P20: rueckgabe() pflegt
// die Leihe zwischen zwei Blöcken, das nächste Ereignis nahm den Platz, kl_wplan_pflege gab ihn als „Altband“ frei; test frei_veraltet).
// Der genommene Platz beginnt als gewöhnliches Band (kein Wechsel, nicht still): kl_anfordern und kl_plane_start setzen nur Material und
// Loop; ein Platz, der ein PlanBand war, trüge sonst dessen Sprung in den neuen Ansatz (Fund aus P20, test platz_wieder: 6 von 6 Runden
// verborgener Sprung). Die Generation des Prüfbaus bleibt (die Zuweisung kopiert sie nicht).
DeckBand* Deck::kl_nimm() noexcept {
  DeckBand* b = kl_leihe_.nimm();
#ifndef CYPHERDJ_MUTATION_PLAN_PLATZ_ALT  // Fehlerfall (Stand vor dem Fund): die Felder des alten PlanBands bleiben
  if (b) *b = DeckBand{};
#endif
#ifndef CYPHERDJ_MUTATION_PLAN_FREI_VERALTET  // Fehlerfall (Stand vor dem Fund): der veraltete Eintrag bleibt
  for (int i = 0; b && i < kl_n_frei_;)
    if (kl_frei_[i].b == b) kl_frei_[i] = kl_frei_[--kl_n_frei_];
    else ++i;
#endif
  return b;
}

int64_t Deck::kl_wplan_s_t(const KlWPlan& p) const noexcept {
  return k_ ? std::llround(k_->sample_at(p.ab_beat)) : 0;
}

// So viele Ring-Frames ab s sind sicher ohne den geplanten Sprung: liegt ein Wechsel möglicherweise im R3 (angenommen oder noch
// offen, Gegenwechsel nicht angenommen), bis zum Ausgabe-Sample von p_gleich (Blende vor dem Ziel bzw. erste Naht). Ein Einfrieren
// (Ereignis, Unterlauf, Zone 3) nimmt höchstens so viel, damit der verworfene Sprung nicht im Eingefrorenen klingt.
// Ungeprüft [H]: R3 lässt eine Abweichung schon rund 2,8k Samples vor p_gleich_bis wirken (W2, W1b); diese Vorwirkung bleibt.
int Deck::kl_rein_bis(int64_t s) const noexcept {
  const KlWPlan* p = nullptr;
  if (kl_wplan_.aktiv && kl_ && kl_->wechsel_verfehlt() != kl_wplan_.wnr) p = &kl_wplan_;
  else if (kl_gegen_.aktiv && kl_ && kl_->wechsel_gelesen() != kl_gegen_.wnr2) p = &kl_gegen_.plan;
  if (!p || !k_ || !m_) return STRECK_BLENDE;
  const double fpb = FRAMES_JE_MINUTE / m_->basis_bpm;
  const int64_t s_g = std::llround(k_->sample_at(p->ab_beat + static_cast<double>(p->p_gleich - p->p_sw) / fpb));
  return static_cast<int>(std::clamp<int64_t>(s_g - s, 0, STRECK_BLENDE));
}

// Trägt der Plan das Ereignis am Ziel? Dieselbe Aktion (Schlüssel und Ziel-Beat, nicht s == s_t: eine Rampe verschiebt das
// Ziel-Sample, 3.4), dasselbe Ziel (f_neu bis DECK_PLAN_TOL_F, Loop gleich), kein Ereignis seit dem Planen (Anfrage des Lesers),
// dieselbe Epoche, der Wechsel angenommen (wechsel_gelesen() == wnr: ein Wechsel je Deck zugleich, dehner.h; nicht von einer
// Erneuerung zurückgenommen), der Ring hörbar und nicht in einer Blende.
bool Deck::kl_wplan_traegt(uint64_t id, double b, int64_t f, int64_t la, int64_t ll, double llx) const noexcept {
#ifdef CYPHERDJ_MUTATION_PLAN_AUSFUEHRUNG_FRIERT
  (void)id, (void)b, (void)f, (void)la, (void)ll, (void)llx;
  return false;  // Fehlerfall: am Ziel trotz Plan der heutige Weg (Einfrieren, Brücke)
#else
  const KlWPlan& P = kl_wplan_;
  if (!P.aktiv || P.selbst || id == 0 || id != P.id || !(b == P.ab_beat)) return false;
#ifndef CYPHERDJ_MUTATION_PLAN_OHNE_PRUEFUNG  // Fehlerfall: f_neu, Loop und Anfrage ungeprüft (P17 rot)
  if (P.art != KL_LOOP_AN && std::llabs(f - P.f_neu) > DECK_PLAN_TOL_F) return false;
  if (ll != P.loop_l || (ll > 0 && (la != P.loop_a || llx != P.loop_lx))) return false;
  if (kl_les_.anfrage() != P.anfrage) return false;
#else
  (void)f, (void)la, (void)ll, (void)llx;
#endif
  return kl_bereit() && kl_an_ && laeuft_ && m_ && stopp_rest_ == 0 && loop_l_ == 0 && kl_les_.epoche() == P.epoche &&
         kl_->wechsel_gelesen() == P.wnr && kl_->wechsel_zurueckgenommen() != P.wnr && kl_les_.ring_hoerbar() &&
         !kl_les_.blendet();
#endif
}

// Ausführung: Zustand wie neu_anker ohne Ereignis (der Ring klingt: keine Blende, kein Einfrieren, kein Ansatz), der Leser nimmt das
// PlanBand, es wird Band der Epoche; das Altband geht auf den zweiten Freigabeweg (3.6: (L) jetzt erfüllt, (A) die Anfrage ist die
// des Planens, (T) mit der Bestätigung). kopf = false: der Kopf bleibt (Loop an).
void Deck::kl_wplan_zuende(int64_t s, int64_t f, bool kopf) noexcept {
  KlWPlan& P = kl_wplan_;
#ifdef CYPHERDJ_MUTATION_PLAN_KOPF_NEGATIV
  kopf = kopf && f >= 0;  // Fehlerfall (Stand vor dem Fund): f < 0 hieß „Kopf bleibt“ (sprung_vor_anfang rot)
#endif
  if (kopf) {  // (nicht f >= 0: ein Sprung vor den Materialanfang ist ein gültiger Kopf, Fund P20 bei s 5890909)
    neu_anker(s, f, false);
    // Der Kopf des Decks = Materialposition des PlanBands (Kopf des Dehners + off_neu), nicht nur bis auf die Rundung des Ziel-Samples
    // (s_t = round(sample_at(ab_beat)), bis 0,5 Frames): sonst trüge der nächste geplante Sprung ein Frame Phasensprung
    // (gemessen P13: 4 von 20 Hotcues, ±5 ct). Der Master-Beat des Ankers ist der, an dem das Band Frame f liefert.
    const DehnerAnker an = kl_les_.anker();
    anker_b_ = an.b + (static_cast<double>(f - P.neu->off_neu) - an.f) / (FRAMES_JE_MINUTE / m_->basis_bpm);
  }
  DeckBand* alt = kl_band_;
  const bool gespielt = P.selbst;  // Fix-Runde W3 S3: ein gespielter Abbruch zählt nur in kl_abbr_gespielt_
  kl_les_.plan_uebernehmen(P.neu, !gespielt);
  kl_les_merke(P.neu);
  kl_band_ = P.neu;
  if (alt && alt != P.neu) {
    kl_leihe_.abgeben_wechsel(alt, P.wnr);
    if (kl_n_frei_ < DECK_KEYLOCK_BAENDER) kl_frei_[kl_n_frei_++] = KlFrei{alt, kl_les_.anfrage()};
  }
  P.aktiv = false;
  P.selbst = false;
  if (!gespielt) ++kl_geplant_ok_;
}

// 3.7, Abbruch nach der Planung. Zone 1/2 (Auftrag ungelesen oder angenommen, Einspeisung vor p_gleich): Gegenwechsel aufs Altband,
// der Thread entscheidet (kl_wplan_pflege wertet aus). Nie angenommen (verfehlt): nichts rückgängig zu machen. Angenommen und so nah
// am Ziel, dass der Ring den Sprung schon trägt (weniger als STRECK_ALT_MIN sauberer Frames): der Sprung wird gespielt, das Deck führt
// ihn am Ziel selbst aus (Zustand gleich dem, was klingt).
void Deck::kl_wplan_verwerfen(int64_t s) noexcept {
  KlWPlan& P = kl_wplan_;
  if (!P.aktiv || P.selbst) return;
#ifdef CYPHERDJ_MUTATION_PLAN_ABBRUCH_IGNORIERT
  (void)s;
  return;  // Fehlerfall: der Abbruch verwirft den Plan nicht (P8 Zone 1/2 rot)
#else
  if (kl_->wechsel_verfehlt() == P.wnr) {  // nie im R3
    kl_leihe_.abgeben(P.neu, kl_les_.anfrage());
    P.aktiv = false;
    kl_verw6b();
    ++kl_abbr_frei_;
    return;
  }
#ifdef CYPHERDJ_MUTATION_PLAN_RUECKWECHSEL_AUS
  // Fehlerfall: Abbruch friert immer ein und setzt neu an (Brücke auch in Zone 2, P8 rot)
  if (!kl_einfrieren(s)) blende_von(m_, frame_bei(s), 1.0f);
  ++kl_abbr_bruecke_;
  kl_anfordern(s, true);
  return;
#endif
  if (kl_->wechsel_gelesen() == P.wnr && kl_rein_bis(s) < STRECK_ALT_MIN) {
    P.selbst = true;
    ++kl_abbr_gespielt_;
    return;
  }
  WechselAuftrag w;
  w.epoche = P.epoche;
  w.neu = kl_band_;  // Altband
  w.p_gleich_bis = P.p_gleich;
  kl_gegen_.aktiv = true;
  kl_gegen_.wnr1 = P.wnr;
  kl_gegen_.wnr2 = kl_->wechsel(w);
  kl_gegen_.anfrage = kl_les_.anfrage();
  kl_gegen_.plan = P;
  P.aktiv = false;  // gezählt wird, wenn der Thread entschieden hat (kl_wplan_pflege, S3)
#endif
}

// Je Block nach block_anfang (und einem Unterlauf): was der Leser und der Thread inzwischen entschieden haben.
void Deck::kl_wplan_pflege(int64_t s) noexcept {
  const uint32_t anf = kl_les_.anfrage();
  // 3.6 Punkt 3: Altbänder auf dem zweiten Weg, deren Anfrage sich änderte (Neuansatz vor der Bestätigung): der Epochenweg
  for (int i = 0; i < kl_n_frei_;) {
    const DeckBand* b = kl_frei_[i].b;
    const bool noch = kl_leihe_.verliehen([b](const DeckBand& x) { return &x == b; });
    if (noch && kl_frei_[i].anfrage != anf) kl_leihe_.abgeben(b, anf);
    if (!noch || kl_frei_[i].anfrage != anf) {
      kl_frei_[i] = kl_frei_[--kl_n_frei_];
      continue;
    }
    ++i;
  }
  KlWPlan& P = kl_wplan_;
  if (P.aktiv) {
    if (anf != P.anfrage || kl_les_.epoche() != P.epoche) {
      // Neuansatz des Lesers (Unterlauf, Wandern) oder neue Epoche: der Plan trägt nie mehr; das PlanBand frei mit dem Epochenweg
      kl_leihe_.abgeben(P.neu, anf);
      if (!P.selbst) kl_verw6b();
      P.aktiv = false;
    } else if (kl_->wechsel_verfehlt() == P.wnr) {  // der Thread nahm nicht an (zu spät): nie gelesen, gleich frei
      kl_wplan_fehl_id_ = P.id;
      kl_wplan_fehl_b_ = P.ab_beat;
      kl_leihe_.abgeben(P.neu, anf);
      P.aktiv = false;
      kl_verw6b();
    } else if (s >= kl_wplan_s_t(P)) {
      // Ziel erreicht, das Ereignis kam nicht (Abbruch ohne kl_plan_verwerfen, abgewiesen): wie ein Abbruch am Ziel
      if (!P.selbst) kl_wplan_verwerfen(s);
      if (P.aktiv && P.selbst) {
        const int64_t st = kl_wplan_s_t(P);
        if (P.art == KL_LOOP_AN) {
          loop_a_ = P.loop_a;
          loop_l_ = P.loop_l;
          loop_lx_ = P.loop_lx;
          loop_durchlauf_setzen(0);
          kl_wplan_zuende(st, 0, false);
        } else {
          kl_wplan_zuende(st, P.f_neu, true);
          loop_kopf_gesetzt(P.f_neu);
        }
      }
    }
  }
  KlGegen& G = kl_gegen_;
  if (!G.aktiv) return;
  if (anf != G.anfrage) {  // Neuansatz: das PlanBand mit dem Epochenweg
    kl_leihe_.abgeben(G.plan.neu, anf);
    G.aktiv = false;
    kl_verw6b();
  } else if (kl_->wechsel_gelesen() == G.wnr2) {  // Zone 1/2: Gegenwechsel angenommen, der R3 liest das Altband, keine Brücke
    kl_leihe_.abgeben_wechsel(G.plan.neu, G.wnr2);
    if (kl_n_frei_ < DECK_KEYLOCK_BAENDER) kl_frei_[kl_n_frei_++] = KlFrei{G.plan.neu, anf};
    G.aktiv = false;
    ++kl_abbr_zurueck_;
    kl_verw6b();
  } else if (kl_->wechsel_verfehlt() == G.wnr2) {
    if (kl_->wechsel_gelesen() == G.wnr1) {  // Zone 3: der Sprung liegt im R3
      if (kl_rein_bis(s) >= STRECK_ALT_MIN) {
        // Preis von Q: einfrieren (höchstens bis vor den Sprung), neuer Ansatz ohne Wechsel, Brücke
        if (!kl_einfrieren(s, STRECK_BLENDE, true)) blende_von(m_, frame_bei(s), 1.0f);
        ++kl_abbr_bruecke_;
        kl_anfordern(s, true);  // gibt das PlanBand mit dem neuen Auftrag ab
      } else {  // der Ring trägt den Sprung schon: gespielt
        kl_wplan_ = G.plan;
        kl_wplan_.aktiv = true;
        kl_wplan_.selbst = true;
        G.aktiv = false;
        ++kl_abbr_gespielt_;
      }
    } else {  // der erste Wechsel war nie angenommen (überschrieben oder verfehlt): nichts im R3
      kl_leihe_.abgeben(G.plan.neu, anf);
      G.aktiv = false;
      ++kl_abbr_frei_;
      kl_verw6b();
    }
  }
}

// Der Varispeed-Weg des jetzigen Kopfs für die nächsten n Samples, ohne Gain und ohne Blenden (für das Einfrieren).
void Deck::vari_vorab(int64_t s, int n, float* l, float* r) const noexcept {
  const float g[STEM_ANZAHL] = {stem_lin_[0], stem_lin_[1], stem_lin_[2], stem_lin_[3]};
  for (int j = 0; j < n; ++j) {
    if (!laeuft_ || !m_) {
      l[j] = r[j] = 0.0f;
    } else if (direkt_) {
      lies(m_, frame_bei(s + j), g, l[j], r[j]);
    } else {
      lies_frei(m_, kopf_bei(s + j), g, l[j], r[j]);
    }
  }
}

// Vertrag 8, Prüfung M1: ist der Ring am Hörbaren beteiligt (Ring hörbar oder Keylock-Blende läuft), friert der Leser ein,
// was gerade klingt, und blendet es vom aktuellen Gewicht weiter aus. Vor der Änderung des Kopfs aufrufen.
bool Deck::kl_einfrieren(int64_t s, int max_n, bool sprung_grenze) noexcept {
  if (!kl_bereit() || !kl_les_.ring_beteiligt()) return false;
  // Keylock 6b (3.7): liegt ein geplanter Sprung womöglich im R3, enthält das Eingefrorene ab kl_rein_bis(s) schon ein Stück davon.
  // Zone 3 (Abbruch ohne neues Ereignis, sprung_grenze): nur bis davor einfrieren; unter STRECK_ALT_MIN entscheidet der Aufrufer
  // („gespielt“). Ein Ereignis, das den Plan nicht trägt (Fix-Runde W3 S1, Entscheid der Hauptinstanz 09.10.): einfrieren wie ohne Plan
  // (max_n wie HEAD), das Stück Sprung in der Ausblende ist der Preis; gezählt in keylock_abbruch_ausblende. Vorher schaltete das Deck den
  // Ring dort hart stumm (Nachbarsprung bis 11 × des Ablaufs ohne Plan, w3-fix/s1).
  const int rein = kl_rein_bis(s);
#ifdef CYPHERDJ_MUTATION_PLAN_EREIGNIS_STUMM
  sprung_grenze = true;  // Fehlerfall (Stand 37fc3db4): auch ein Ereignis friert nur bis vor den Sprung ein bzw. schaltet stumm
#endif
  if (rein < max_n) {
    if (!sprung_grenze) {
      ++kl_abbr_ausblende_;
    } else {
      if (rein < STRECK_ALT_MIN) {
        kl_les_.stumm();
        return false;
      }
      max_n = rein;
    }
  }
  // Nachprüfung N1: Gain wie blende_von (Stopp-Rampe × Einblende); gs0 = Stopp-Gain, damit eine weiterlaufende Rampe
  // vom Stand beim Ereignis weiter wirkt
#ifdef CYPHERDJ_MUTATION_KEYLOCK_EINFRIEREN_OHNE_STOPP
  const float gs0 = 1.0f;  // Fehlerfall (Stand 2b/2c): Einfrieren nur mit der Einblende, ohne den Stand der Stopp-Rampe
#else
  const float gs0 = stopp_rest_ > 0 ? static_cast<float>(stopp_rest_) / DECK_STOPP_RAMPE : 1.0f;
#endif
  const float e = gs0 * (ein_.offen() ? 1.0f : ein_.wert());
  if (kl_les_.braucht_vari()) {
    float vl[STRECK_BLENDE], vr[STRECK_BLENDE];
    vari_vorab(s, STRECK_BLENDE, vl, vr);
    return kl_les_.einfrieren(s, e, gs0, vl, vr, STRECK_BLENDE, false, max_n);
  }
  return kl_les_.einfrieren(s, e, gs0, nullptr, nullptr, 0, false, max_n);
}

void Deck::block(int64_t s, int n, float* l, float* r, int vl_off) noexcept {
  // Welle 3: Pfad je Block. Direkt → Varispeed an derselben Stelle ohne Blende (die Lage ist exakt dieselbe);
  // Varispeed → Direkt auf das nächste ganze Frame mit der 128er Blende (der Kopf rückt um höchstens 0,5 Frame).
  // Keylock: klingt der Ring, liefert der Pfadwechsel keine eigene Blende (der zweite Blendenplatz blendet Ring <-> Direkt).
  if (n > DECK_MAX_BLOCK) {
    block(s, DECK_MAX_BLOCK, l, r, vl_off);
    block(s + DECK_MAX_BLOCK, n - DECK_MAX_BLOCK, l + DECK_MAX_BLOCK, r + DECK_MAX_BLOCK, vl_off + DECK_MAX_BLOCK);
    return;
  }
  const bool d_neu = direkt_ueber(s, n);
  if (laeuft_ && m_ && d_neu != direkt_) {
    if (d_neu) {
      neu_anker(s, std::llround(kopf_bei(s)), false);  // blendet vom gebrochenen Kopf (frame_bei rundet)
    } else {
      const int64_t f = frame_bei(s);
      anker_s_ = s;
      anker_f_ = f;
      anker_b_ = k_->beat_at(static_cast<double>(s));
    }
  }
  direkt_ = d_neu;
  const bool verlauf = stem_vl_[0] || stem_vl_[1] || stem_vl_[2] || stem_vl_[3];
  float g[STEM_ANZAHL] = {stem_lin_[0], stem_lin_[1], stem_lin_[2], stem_lin_[3]};
  if (verlauf)
    for (int k = 0; k < STEM_ANZAHL; ++k)
      if (stem_vl_[k]) g[k] = lin(stem_vl_[k][vl_off]);
  const bool kl = kl_bereit();
  if (kl) {  // Keylock am Blockanfang: offene Aufträge, Stem-Gewichte, Leihe, dann der Leser (Antwort, Stand, Ring)
    if (kl_offen_ != KlOffen::NICHTS) {
      const bool band = kl_offen_ == KlOffen::ANSATZ && kl_an_ && laeuft_ && m_ && kl_loop_ok();
      kl_offen_ = KlOffen::NICHTS;
      kl_anfordern(s, band);
    }
    for (int k = 0; k < STEM_ANZAHL; ++k) kl_g_[k].store(g[k], std::memory_order_relaxed);
    kl_leihe_.pflege(kl_post_->antwort(), kl_->quittiert_e(), kl_wechsel_frei_nr());
    kl_les_.basis(direkt_);  // 7c.4 (b): auf der Basis blendet das Einfrieren gleich laut
    if (kl_halten_ && !kl_les_.ring_beteiligt()) kl_ereignis(s);  // 7c.4 (a): der gehaltene Ring ist aus, Leer-Epoche
    if (kl_les_.block_anfang(s, n)) {  // Prüfung m2: Unterlauf droht, was klingt blendet über die vorhandenen Frames aus
      kl_einfrieren(s);
      kl_les_.unterlauf(s);
    }
    if (kl_wplan_.aktiv || kl_gegen_.aktiv || kl_n_frei_ > 0) kl_wplan_pflege(s);  // Keylock 6b
#ifdef CYPHERDJ_PRUEF_GEN
    // Plan 3.6 (L): der Leser hält ein Band, dessen Platz seit der Übergabe freigegeben oder neu verliehen wurde
    if (!kl_les_.ist_leer() && kl_les_.quelle() && kl_les_.quelle() == kl_les_band_ &&
        kl_les_band_->pruef_gen.load(std::memory_order_relaxed) != kl_les_gen_)
      ++kl_les_gen_verletzt_;
#endif
  }
  // Keylock 6a: geplanter Start aus dem Stand mit bereitem Ring: das stehende Deck hört ihn schon ab s_t − DECK_VORLAGE (das
  // Band liefert vor dem Startframe Stille, der Leser bleibt vor s_h + STRECK_EINSCHWING still), wie die Box (7b.2).
#ifndef CYPHERDJ_MUTATION_PLAN_OHNE_SELBSTFALL
  // Fix-Runde 1 Q3: erreicht ein Block das Ziel und das Deck steht noch, wurde die Aktion nicht ausgeführt (KI-Stopp mitten im
  // Zyklus, abgewiesen, zu spät): der Plan fällt hier, die Vorlage blendet am Ziel aus statt ungemischt liegen zu bleiben
  if (kl && kl_plan_.aktiv && !laeuft_ && s >= kl_plan_.s_t) kl_plan_verwerfen(s);
#endif
  int64_t vor_ab = INT64_MAX, vor_bis = INT64_MIN;
#ifndef CYPHERDJ_MUTATION_PLAN_START_OHNE_VORLAGE
  if (kl && kl_plan_.aktiv && !laeuft_ && kl_an_ && (kl_vor_ || kl_les_.still_bereit())) {
    vor_ab = std::max<int64_t>(s, kl_plan_.s_t - DECK_VORLAGE);
    vor_bis = std::min<int64_t>(s + n, kl_plan_.s_t);
  }
#endif
  for (int i = 0; i < n; ++i) {
    const bool vor = s + i >= vor_ab && s + i < vor_bis;
    if (!laeuft_ && blende_rest_ == 0 && !kl_les_.blendet() && !vor) {  // steht und nichts klingt aus: Stille (nichts zu addieren)
      if (s + i < vor_ab && vor_ab < vor_bis) {  // 6a: bis zur Vorlage weiter Stille
        i = static_cast<int>(vor_ab - s) - 1;
        continue;
      }
      break;
    }
    if (verlauf)
      for (int k = 0; k < STEM_ANZAHL; ++k)
        if (stem_vl_[k]) g[k] = lin(stem_vl_[k][vl_off + i]);
    float a = 0.0f, b = 0.0f;
    float ge = 1.0f, gs = 1.0f;  // Keylock: dieselben Gains für den Ring (Stopp-Rampe und Einblende des gewählten Wegs)
    bool ge_an = false, gs_an = false;
    if (laeuft_) {
      // Plan E9: Naht. Die 128-Frame-Blende liegt VOR der Naht (der neue Kopf beginnt 128 Frames vor dem Loop-Anfang),
      // damit der Loop-Anfang voll klingt: ab der Naht eingeblendet verlor die Takt-Eins am Loop-Anfang ihren Transienten
      // (gemessen: Takt-Eins im 2-Beat-Loop nicht mehr von einem Viertel-Klick zu unterscheiden).
      // Task 5b (Prüfung MAJOR): der Kopf wickelt um genau k · L Frames (der Anker rückt, Master-Beat und Bruchteil bleiben);
      // vorher setzte die Naht den Anker auf das gerundete Frame, im Varispeed ging der Bruchteil je Durchlauf verloren
      // (132 BPM, 4 Beats: −0,266 Frames je Durchlauf) und der Ring, der exakt wickelt, lief davon weg (Test 30).
#ifdef CYPHERDJ_MUTATION_DECK_NAHT_RUNDET
      if (loop_l_ > 0 && frame_bei(s + i) >= loop_a_ + loop_l_ - DECK_BLENDE)
        neu_anker(s + i, loop_a_ - DECK_BLENDE + (frame_bei(s + i) - (loop_a_ + loop_l_ - DECK_BLENDE)) % loop_l_, false);
#else
      // Loop-Drift: der laufende Durchlauf j ist loop_lj_ = R(j + 1) − R(j) Frames lang (loop_naht_r), nicht fest round(lx)
      if (loop_l_ > 0 && frame_bei(s + i) >= loop_a_ + loop_lj_ - DECK_BLENDE) {
        const int64_t f = frame_bei(s + i);
        int64_t d = 0;
        do {
          d += loop_lj_;
          loop_durchlauf_setzen(loop_j_ + 1);
        } while (f - d >= loop_a_ + loop_lj_ - DECK_BLENDE);
        naht(s + i, d);
      }
#endif
      const int64_t f = frame_bei(s + i);
      if (direkt_) lies(m_, f, g, a, b);
      else lies_frei(m_, kopf_bei(s + i), g, a, b);
      if (!ein_.offen()) {  // F10: Einblende aus dem Stand; ruhend keine Rechnung (bitgleich)
        ge = ein_.schritt();
        ge_an = true;
        a *= ge;
        b *= ge;
      }
      if (stopp_rest_ > 0) {
        gs = static_cast<float>(stopp_rest_ - 1) / DECK_STOPP_RAMPE;
        gs_an = true;
        a *= gs;
        b *= gs;
        if (--stopp_rest_ == 0) {
          laeuft_ = false;
          pos_f_ = f + 1;
          if (kl) {  // Vertrag 18: steht, der R3 ruht (Leer-Epoche am nächsten Block); der Ring ist mit der Rampe aus
            kl_offen_ = KlOffen::LEER;
            kl_les_.stumm();
          }
        }
      } else if (loop_l_ == 0 && f + 1 >= m_->frames) {  // letztes Frame gespielt: zu Ende gelaufen (§1.6: nicht mehr hörbar)
        laeuft_ = false;
        pos_f_ = m_->frames;
        if (kl) {
          kl_offen_ = KlOffen::LEER;
          kl_les_.stumm();
        }
      }
    }
    if (blende_rest_ > 0) {
      const float w = static_cast<float>(blende_len_ - blende_rest_ + 1) / static_cast<float>(blende_len_);
      float c = 0.0f, d = 0.0f;
      if (alt_schritt_ == 1.0) {
        lies(alt_m_, alt_f_++, g, c, d);
      } else {  // Welle 3: alter Kopf im Varispeed (Tausch), mit seinem Schritt
        lies_frei(alt_m_, alt_pos_, g, c, d);
        alt_pos_ += alt_schritt_;
      }
      a = a * w + c * (1.0f - w) * alt_gain_;
      b = b * w + d * (1.0f - w) * alt_gain_;
      if (--blende_rest_ == 0) {
        if (alt_m_ != m_) zurueck(alt_m_);
        alt_m_ = nullptr;
      }
    }
    // Keylock 7b.1: auf der Basis (direkt_) bleibt ein klingender Ring hörbar bis zum nächsten Ereignis (basis_halten)
    if (kl) {
      kl_les_.mische(i, s + i,
                     vor || (laeuft_ && m_ && kl_loop_ok() &&
                             (kl_an_ ? (!direkt_ || kl_les_.basis_halten())
                                     : (kl_halten_ && direkt_ && kl_les_.basis_halten()))),
                     ge, ge_an, gs, gs_an, a, b);
      if (vor) kl_vor_ = kl_les_.ring_hoerbar();  // 6a: der Ring klingt in der Vorlage
    }
    l[i] += a;
    r[i] += b;
  }
}

}  // namespace cdj
