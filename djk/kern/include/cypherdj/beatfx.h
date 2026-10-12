// Beat-FX-Einheit (Plan 3, Spec E8, Rechnung aus dem MVP-2-Plan „Folgepläne, Scheibe 3“): ECHO, FLANGER, PHASER,
// FILTER (LFO) mit der Periode in Beats; die LFO-Phase kommt aus dem absoluten Beat (p = frac(beat / beats)), so klingen
// zwei Starts im selben Takt gleich. Wet gleitet über 480 Samples; ein Art-Wechsel bei ON gleitet erst auf 0, leert
// dann den Zustand und gleitet wieder hoch (ebenso ein Wechsel der Beat-Länge). OFF schließt bei jeder Art den Eingang,
// der Nachhall klingt mit der Rückkopplung aus (Andreas 2026-09-28). Echtzeitfest: Leitungen im Konstruktor, block() allokiert nicht.
// DELAY (eine Wiederholung, PARAM TONE 1–20 kHz), PINGPONG (Wiederholungen wechseln L/R, PARAM Rückkopplung), TRANS
// (Gate im Takt, PARAM DUTY 0,1–0,9, Flanken 2 ms), alle 2026-10-11 nach dem XDJ-XZ.
// ROLL/SLIP ROLL (Aufnahme ab ON, wiederholt in BEAT-Länge; Slip nimmt beim BEAT-Wechsel neu auf), VINYL BRAKE (Geschwindig-
// keit fällt linear über BEAT bis zum Stillstand), SPIRAL (Echo mit Allpass in der Rückkopplung, die Zeit gleitet: Tonhöhe
// wandert mit), nach dem Pioneer-Handbuch DJM-900NXS2 S. 16-17, 2026-10-11.
// REVERB (2026-10-11): Cypher Hall, Ausklingzeit = beats (T60 bei 1 kHz), PARAM SIZE; der nasse Weg ist um HALL_BLOCK
// Samples verzögert (der Hall rechnet blockweise) und das wird von der Vorverzögerung abgezogen.
#pragma once

#include <cstdint>
#include <memory>

#include "cypherdj/hall.h"

namespace cdj {

class BeatFx {
 public:
  enum Art : int { AUS = 0, ECHO = 1, FLANGER = 2, PHASER = 3, FILTER = 4, REVERB = 5, DELAY = 6, PINGPONG = 7, TRANS = 8, ROLL = 9, SLIPROLL = 10, VINYL = 11, SPIRAL = 12 };
  static constexpr bool echoartig(int a) noexcept { return a == ECHO || a == DELAY || a == PINGPONG || a == SPIRAL; }   // Fahne
  static constexpr bool puffernd(int a) noexcept { return echoartig(a) || a == ROLL || a == SLIPROLL || a == VINYL; }  // Leitung
  // BEAT-Wechsel ohne Ausgleiten und Leeren: Roll behält (Slip Roll erneuert) die Aufnahme, Vinyl bremst weiter, Spiral gleitet
  static constexpr bool ohne_leeren(int a) noexcept { return a == ROLL || a == SLIPROLL || a == VINYL || a == SPIRAL; }
  static constexpr int SPIRAL_AP = 337;          // Allpass in der Rückkopplung (7 ms, g 0,5): verschmiert zum Nachhall
  static constexpr int GLEIT = 480;              // Samples für Wet und Echo-Eingang (10 ms)
  static constexpr int ECHO_FRAMES = 360000;     // 16 Beats bei 128 BPM je Seite
  static constexpr int FLANGER_FRAMES = 1024;
  static constexpr int PHASER_STUFEN = 6;
  static constexpr int HALL_BLOCK = 256;         // REVERB: nasser Weg um einen Hall-Block verzögert (5,33 ms)
  static constexpr int NACHHALL = 4096;          // so lange unhörbar, dann ist der Ausklang vorbei (nicht ECHO)

  BeatFx();
  // Ziel setzen; param 0..1 (ECHO, FLANGER: Rückkopplung 0..0,9; PHASER: Resonanz 0..0,9; FILTER: Q 0,7..8).
  void setze(int art, double beats, float wet, float param, bool an) noexcept;
  // [n] Samples in place; beat0 = Beat am ersten Sample, bps = Beats je Sample (bpm / 60 / 48 000).
  void block(float* l, float* r, int n, double beat0, double bps) noexcept;
  bool klingt() const noexcept;   // Wet > 0, Echo-Eingang offen oder Fahne in der Leitung
  void leeren() noexcept;         // Leitungen, Allpässe, Filter auf 0
  // Kanalwechsel (Mixer): ausgleiten und leeren, bis weiter(); pausiert() = ausgeglitten und leer. Geleert wird genau
  // einmal, sobald Wet und Eingang auf 0 sind (Ohr T17: vorher hätte jedes weitere Sample des Blocks neu geleert).
  void pause() noexcept { pause_ = true; pause_leer_ = false; }
  bool pausiert() const noexcept { return pause_ && wet_ == 0.0f && ein_ == 0.0f; }
  void weiter() noexcept { pause_ = false; pause_leer_ = false; }
  int art() const noexcept { return art_; }

 private:
  float eins(int k, float x, double beat, double spb) noexcept;   // ein Sample der aktuellen Art, Kanal k
  float nachhall(int k, float x, float y) noexcept;
  void pingpong(float& l, float& r, double spb) noexcept;
  float lies(int k, double pos) const noexcept;
  double vinyl_tempo(double spb) const noexcept;                   // Leitung linear interpoliert (VINYL, SPIRAL)         // beide Kanäle zugleich (Kreuzkopplung)               // Mischung mit Ausklang (Flanger, Phaser, Filter)
  void hall_stellen(double spb) noexcept;        // REVERB: decay/size aus beats_, param_ (nur bei Änderung)
  int art_ = AUS, ziel_art_ = AUS;
  double beats_ = 1.0, ziel_beats_ = 1.0;
  float wet_ = 0.0f, ziel_wet_ = 0.0f, param_ = 0.5f, ziel_param_ = 0.5f;
  float ein_ = 0.0f, ziel_ein_ = 0.0f;     // ECHO: Eingang der Leitung (OFF: 0, die Fahne bleibt hörbar)
  std::unique_ptr<float[]> echo_[2];
  std::unique_ptr<float[]> flanger_[2];
  int echo_pos_ = 0, flanger_pos_ = 0;
  float nachhall_l_ = 0.0f;               // letzter Effektwert links (still_ prüft beide Seiten)
  int echo_d_ = 1;                         // ECHO: aktuelle Verzögerung in Samples
  int64_t still_ = INT64_MAX / 2;          // ECHO: Samples seit dem letzten hörbaren Schreiben in die Leitung
  float ap_z_[2][PHASER_STUFEN] = {}, ap_rueck_[2] = {};
  float svf_ic1_[2] = {}, svf_ic2_[2] = {};
  float delay_lp_[2] = {}, trans_g_[2] = {};
  bool neu_ausloesen_ = false;             // ROLL/SLIP/VINYL: beim nächsten Sample Aufnahme bzw. Bremse starten
  int roll_start_ = 0;                     // ROLL: Leitungsposition der Aufnahme
  int64_t roll_n_ = 0;                     // ROLL: Samples seit der Aufnahme; VINYL: seit Bremsbeginn
  double vinyl_lese_ = 0.0;                // VINYL: Lesekopf (gebremst)
  double spiral_d_ = 0.0;                  // SPIRAL: gleitende Verzögerung in Samples (0 = noch nicht gesetzt)
  float spiral_ap_[2][SPIRAL_AP] = {};
  int spiral_ap_pos_ = 0;   // DELAY: Tiefpass der Wiederholung; TRANS: geglättetes Gate
  std::unique_ptr<Hall> hall_;            // REVERB: 2,6 MB, im Konstruktor
  float hall_ein_[2][HALL_BLOCK] = {}, hall_aus_[2][HALL_BLOCK] = {};
  int hall_pos_ = 0;
  double hall_decay_ = 0.0;
  float hall_size_ = -1.0f;
  bool pause_ = false;
  bool pause_leer_ = false;                // pause(): die Leitungen sind schon geleert
  int64_t gezaehlt_ = 0;                   // Samples seit dem ersten Block (nur für die Mutation LFO_AB_START)
};

}  // namespace cdj
