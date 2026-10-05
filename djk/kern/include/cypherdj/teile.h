// Buchführung des Kerns neben dem Stellwerk (Scheibe 25), alles echtzeitfest (feste Felder, keine Allokation):
//  * TeilSchatten: jeder Planteil, den der Kern ans Stellwerk gibt, mit seinem Stand aus den Quittungen (§5.1: 1 wartet,
//    2 läuft). Daraus schreibt der Kern den Neustart-Zustand (§6.3 „ausstehende Befehle mit Stand“), /q/stand und
//    befehle_wartend (§5.4); nach einem Neustart reicht er die Teile daraus nach (Kern::teile_nachreichen).
//  * HandSchlange: Griffe des Prüf-Handeingangs /test/hand (§19.0) bis zu dem Zyklus, der ihr Sample enthält; dort
//    gehen sie mit ihrem Sample ins Stellwerk (Hand am Versatz, §7.3 Punkt 1). So läuft später auch JACK-MIDI (35).
//  * fortsetzwert(): Wert eines laufenden Teils an einem Beat nach dem Neustart, aus dem letzten Schnappschuss.
#pragma once

#include <cstdint>

namespace cypherdj::stellwerk {
struct Kurve;  // Scheibe 35: eigene Kurve eines Griffs aus dem Mapping (stellwerk/regler.h)
}

namespace cdj {

struct SchattenTeil {
  bool belegt = false;
  uint8_t stand = 0;   // 0 unbestätigt, 1 wartet, 2 läuft
  uint8_t wieder = 0;  // Neustart: 1 wartete, 2 lief; ihre Quittungen 1 (und 2/5 bei 2) schluckt der Kern
  int64_t id = 0;
  char quelle[16] = {};
  char plan[32] = {};
  int32_t nr = 0;
  char pfad[32] = {};
  double ab_beat = 0.0;      // Anfang der Kurve, die das Stellwerk gerade fährt (nach Quittung 5: der späte Start)
  double dauer_beats = 0.0;  // ab_beat + dauer_beats ist der unveränderte Ende-Beat
  float nach = 0.0f;
  uint8_t form = 0, politik = 0;
  char gruppe[40] = {};
  char hoerschein[40] = {};
  int64_t ist_sample = 0;    // §5.1: Start-Sample (läuft) bzw. Ziel-Sample (wartet)
  double ist_beat = 0.0;
  float w_s = 0.0f;          // Neustart: Wert am letzten Schnappschuss ...
  double b_s = 0.0;          // ... und sein Beat (nur wieder == 2)
};

class TeilSchatten {
 public:
  static constexpr int MAX = 256;   // wie stellwerk::MAX_TEILE und CDJ_Z_BEFEHLE
  SchattenTeil* neu();               // freier Platz (geleert) oder nullptr
  SchattenTeil* finde(int64_t id, const char* quelle);
  void entferne(SchattenTeil* t) { t->belegt = false; }
  // Quittung aus dem Stellwerk einarbeiten. Rückgabe true: die Quittung gehört zum Nachreichen nach einem Neustart
  // und geht nicht hinaus (die alte Generation hat sie schon gemeldet).
  bool quittung(int64_t id, const char* quelle, int status, int64_t sample, double beat);
  int wartend() const;               // Stand 1 (für /zustand/kern befehle_wartend)
  SchattenTeil* teil(int i) { return &t_[i]; }
  const SchattenTeil* teil(int i) const { return &t_[i]; }
  void leeren();

 private:
  SchattenTeil t_[MAX];
};

struct HandGriff {
  int64_t sample;
  int16_t regler;
  float x;   // midi_roh 0..1 (absolut) bzw. Änderung in Stellungs-Einheiten (relativ)
  // Scheibe 35: Art des Griffs (cypherdj::stellwerk::GriffArt als Zahl: 0 absolut, 1 relativ, 2 beruehrung,
  // 3 freigabe) und eigene Kurve aus dem Mapping (nullptr: Standard-Kurve des Reglers). /test/hand: 0 und nullptr.
  uint8_t art = 0;
  const cypherdj::stellwerk::Kurve* kurve = nullptr;
};

class HandSchlange {
 public:
  static constexpr int MAX = 256;
  bool rein(const HandGriff& g);                       // nach Sample sortiert; false: voll
  // Nimmt den frühesten Griff mit sample < bis heraus; false: keiner.
  bool raus_vor(int64_t bis, HandGriff& g);
  int anzahl() const { return n_; }
  void leeren() { n_ = 0; }

 private:
  HandGriff g_[MAX];
  int n_ = 0;
};

// Wert eines laufenden Teils am Beat b: Schnappschuss (b_s, w_s), Kurve vom Anfang ab_beat bis zum Ende-Beat
// ab_beat + dauer_beats nach `nach` in Form 0 (linear) oder 1 (S). db: Regler in dB mit der Stumm-Regel §1.2
// (eine Rampe nach stumm läuft bis −60 dB, wie das Stellwerk sie fährt, stellwerk/src/kern.cpp start_parameter).
// Linear ist exakt (zwei Punkte legen die Gerade fest); bei S rechnet sie den Anfangswert aus dem Schnappschuss zurück.
double fortsetzwert(const SchattenTeil& t, bool db, double b);

}  // namespace cdj
