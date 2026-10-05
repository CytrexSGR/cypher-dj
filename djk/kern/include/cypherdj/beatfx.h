// Beat-FX-Einheit (Plan 3, Spec E8, Rechnung aus dem MVP-2-Plan „Folgepläne, Scheibe 3“): ECHO, FLANGER, PHASER,
// FILTER (LFO) mit der Periode in Beats; die LFO-Phase kommt aus dem absoluten Beat (p = frac(beat / beats)), so klingen
// zwei Starts im selben Takt gleich. Wet gleitet über 480 Samples; ein Art-Wechsel bei ON gleitet erst auf 0, leert
// dann den Zustand und gleitet wieder hoch (ebenso ein Wechsel der Beat-Länge). OFF schließt bei jeder Art den Eingang,
// der Nachhall klingt mit der Rückkopplung aus (Andreas 2026-09-28). Echtzeitfest: Leitungen im Konstruktor, block() allokiert nicht.
#pragma once

#include <cstdint>
#include <memory>

namespace cdj {

class BeatFx {
 public:
  enum Art : int { AUS = 0, ECHO = 1, FLANGER = 2, PHASER = 3, FILTER = 4 };
  static constexpr int GLEIT = 480;              // Samples für Wet und Echo-Eingang (10 ms)
  static constexpr int ECHO_FRAMES = 360000;     // 16 Beats bei 128 BPM je Seite
  static constexpr int FLANGER_FRAMES = 1024;
  static constexpr int PHASER_STUFEN = 6;
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
  float nachhall(int k, float x, float y) noexcept;               // Mischung mit Ausklang (Flanger, Phaser, Filter)
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
  bool pause_ = false;
  bool pause_leer_ = false;                // pause(): die Leitungen sind schon geleert
  int64_t gezaehlt_ = 0;                   // Samples seit dem ersten Block (nur für die Mutation LFO_AB_START)
};

}  // namespace cdj
