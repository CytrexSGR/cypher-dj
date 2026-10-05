// Ein Deck im Direktweg (SCHNITTSTELLEN.md §4.4, §5.5, §13.1; ADR 007, ADR 020 Entscheidung 1): liest das
// eingeblendete Material am Soll-Lesekopf ohne Stretcher. Mit Stems klingt deren Summe (Reihenfolge STEM_NAMEN, je
// Stem mit seinem Pegel stem/*), sonst die Basis-Datei. Scheibe 31; Loop, Roll, Sprung, Hotcue kommen mit 38.
// Echtzeitfest: keine Allokation, keine Sperre, kein Systemaufruf.
#pragma once

#include <cstdint>

#include "cypherdj/lader.h"

namespace cdj {

constexpr int DECK_BLENDE = 128;       // §4.4: 128-Frame-Blende beim Start auf laufendem Deck
constexpr int DECK_STOPP_RAMPE = 480;  // §4.4: Stopp mit 10-ms-Rampe
constexpr int DECKS = 4;

class Deck {
 public:
  // Material übernehmen (am Blockanfang s): Status geladen, Position Quell-Beat 0. Klingt das Deck, blendet das
  // bisherige Material über 128 Frames aus; danach liefert rueckgabe() es genau einmal (Freigabe erst nach Rückgabe).
  void lade(const Material* m, int64_t s) noexcept;
  void entlade(int64_t s) noexcept;
  const Material* rueckgabe() noexcept;
  const Material* material() const noexcept { return m_; }
  // Ab Sample s erklingt Frame f. Läuft das Deck (auch in der Stopp-Rampe), blendet es 128 Frames vom alten Lesekopf.
  // loop_halten (Plan E9, Review F2): Play der Hand nach einer Pause behält den Loop (Traktor, Spec „läuft bis Loop
  // aus“); /k/deck/start und CUE beenden ihn (Attrappe).
  void start(int64_t s, int64_t f, bool loop_halten = false) noexcept;
  // Ab Sample s die 10-ms-Rampe; der Lesekopf läuft in ihr weiter. Rückgabe: Sample, ab dem das Deck steht.
  int64_t stopp(int64_t s, bool loop_halten = false) noexcept;
  // Neustart (§6.3): Zustand ohne Blende setzen.
  void setze_lauf(int64_t anker_s, int64_t anker_f) noexcept;
  void setze_position(int64_t f) noexcept;
  // Plan E9 (§4.4 /k/deck/sprung): um delta Frames ab Sample s. Läuft das Deck, blendet es 128 Frames vom alten Lesekopf
  // (wie start); ein aktiver Loop wandert mit. Steht es, verschiebt sich die Position, begrenzt auf [0, frames].
  void springe(int64_t s, int64_t delta_f) noexcept;
  // Plan E9 (Hotcue): Lesekopf ab s auf Frame f (läuft: mit Blende, Stopp-Rampe bleibt) bzw. Position (steht).
  void setze_kopf(int64_t s, int64_t f) noexcept;
  // Plan E9 (§4.4 /k/deck/loop): Loop [a_f, a_f + laenge_f); an der Naht zurück mit 128-Frame-Blende. Laden, Start und
  // Stopp löschen ihn (Attrappe). Im Loop gibt es kein Materialende (beats_bis_ende unendlich, wie die Attrappe).
  void loop_an(int64_t a_f, int64_t laenge_f) noexcept { loop_a_ = a_f; loop_l_ = laenge_f > 0 ? laenge_f : 0; }
  void loop_aus() noexcept { loop_l_ = 0; }
  bool loop_aktiv() const noexcept { return loop_l_ > 0; }
  int64_t loop_anfang() const noexcept { return loop_a_; }   // Audit F09: Prüfung vor Sprung und Loop
  int64_t loop_laenge() const noexcept { return loop_l_; }
  // Stem-Pegel in dB (§1.5 stem/*, stumm ≤ −120): konstant, oder je Sample im nächsten Block ab Index vl_off.
  void stem_db(int stem, float db) noexcept;
  void stem_verlauf(int stem, const float* db) noexcept;
  void verlauf_ende(int m) noexcept;  // letzter Wert (Index m − 1) gilt weiter, Verläufe gelöst
  // Rendert [s, s + n) und addiert auf l und r; vl_off ist der Index des Samples s in den Stem-Verläufen.
  void block(int64_t s, int n, float* l, float* r, int vl_off) noexcept;

  bool laeuft() const noexcept { return laeuft_; }
  bool geladen() const noexcept { return m_ != nullptr; }
  int64_t frame_bei(int64_t s) const noexcept;       // Lesekopf (läuft) bzw. Position (steht)
  double quell_beat_bei(int64_t s) const noexcept;   // §5.5 quell_beat (hörbare Position)
  double beats_bis_ende_bei(int64_t s) const noexcept;  // §5.5, Faktor 1: Quell-Beats gleich Master-Beats
  int64_t anker_s() const noexcept { return anker_s_; }
  int64_t anker_f() const noexcept { return anker_f_; }
  int64_t position() const noexcept { return pos_f_; }
  // Plan Grid (§4.4 /k/deck/raster): Raster der Fassung auf diesem Deck, Takt-Eins-Linie auf erster_schlag_frame + v.
  // Alle Rechnungen Quell-Beat ↔ Frame laufen über schlag0(). Laden setzt v auf 0.
  int64_t schlag0() const noexcept { return m_ ? m_->erster_schlag_frame + raster_f_ : 0; }
  int64_t raster_versatz() const noexcept { return raster_f_; }
  // Neuer Versatz v ab s (absolut): der Quell-Beat unter dem Kopf bleibt, der Ton rückt um v − alt (wie springe, mit
  // Blende; ein Loop wandert mit).
  void setze_raster(int64_t s, int64_t v) noexcept;

 private:
  void zurueck(const Material* m) noexcept;
  void neu_anker(int64_t s, int64_t f) noexcept;
  void blende_von(const Material* alt, int64_t alt_f, float gain) noexcept;
  const Material* m_ = nullptr;
  bool laeuft_ = false;
  int64_t anker_s_ = 0, anker_f_ = 0;  // läuft: Frame(s) = anker_f_ + (s − anker_s_)
  int64_t pos_f_ = 0;                  // steht: Position
  int64_t raster_f_ = 0;               // Plan Grid: Versatz des Rasters in Frames
  int stopp_rest_ = 0;
  int64_t loop_a_ = 0, loop_l_ = 0;    // Plan E9: Loop [loop_a_, loop_a_ + loop_l_), loop_l_ 0 = aus
  // Blende: alter Lesekopf (auch eines abgelösten Materials) klingt 128 Frames lang aus
  const Material* alt_m_ = nullptr;
  int64_t alt_f_ = 0;
  float alt_gain_ = 1.0f;
  int blende_rest_ = 0;
  const Material* rueck_[4] = {};
  int n_rueck_ = 0;
  float stem_db_[STEM_ANZAHL] = {0.0f, 0.0f, 0.0f, 0.0f};
  float stem_lin_[STEM_ANZAHL] = {1.0f, 1.0f, 1.0f, 1.0f};
  const float* stem_vl_[STEM_ANZAHL] = {};
};

}  // namespace cdj
