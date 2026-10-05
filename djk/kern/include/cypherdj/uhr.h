// Die eine Uhr: Tempo-Karte nach SCHNITTSTELLEN.md §1.3 (normativ) und Takt-Zählung nach §1.1.
// Vorlage: proben/02-uhr-sync-planer/kern/uhrkern.cpp (Formeln Z. 72 bis 88), hier mit int64-Start-Sample
// je Segment und höchstens 64 Segmenten. Keine Allokation: alle Funktionen sind im Callback erlaubt.
#pragma once

#include <cmath>
#include <cstdint>

namespace cdj {

constexpr double RATE = 48000.0;
constexpr int MAX_SEGMENTE = 64;

// Ein Segment, linear in der Zeit (konstant bei k = 0).
struct Segment {
  int64_t s0;      // Start-Sample
  double b0;       // Start-Beat
  double bpm0;     // Tempo am Start
  double k;        // BPM je Sekunde
  double dauer_s;  // INFINITY für das letzte Segment
};

class Karte {
 public:
  explicit Karte(double start_bpm = 128.0, int64_t s0 = 0) { neu(start_bpm, s0); }

  // Neue Zeitachse: Beat 0 liegt auf Sample s0, konstantes Tempo.
  void neu(double start_bpm, int64_t s0);

  // Rampe linear in der Zeit ab ab_beat vom dort gültigen Tempo auf ziel_bpm über dauer_beats; danach konstant.
  // Ersetzt alle Segmente ab ab_beat. false, wenn die Karte dafür keinen Platz hat (dann unverändert).
  bool rampe(double ab_beat, double ziel_bpm, double dauer_beats);

  // §1.3: Segmente, die vor dem Sample s enden, fallen weg; das Segment, in dem s liegt, wird das erste.
  // Gibt die Zahl der verworfenen Segmente zurück (Scheibe 08).
  int verwerfe_vor(int64_t s);

  double beat_at(double s) const;
  double sample_at(double b) const;
  double bpm_at(double s) const;
  double k_at(double s) const;

  int anzahl() const { return n_; }
  const Segment& segment(int i) const { return seg_[i]; }

  // Scheibe 18: Segmente aus dem Neustart-Zustand übernehmen (1 bis 64). false: Anzahl ungültig, Karte unverändert.
  bool setze(const Segment* s, int n) noexcept;

 private:
  int index_sample(double s) const;
  int index_beat(double b) const;
  static double beat_im(const Segment& g, double s);
  static double sample_im(const Segment& g, double b);

  Segment seg_[MAX_SEGMENTE];
  int n_ = 0;
};

// §1.1: Takt-Nr, Schlag im Takt, Phrase-Nr (1-basiert, nur 4/4).
inline int64_t takt_nr(double beat) { return (int64_t)std::floor(beat / 4.0) + 1; }
inline int schlag_im_takt(double beat) { return (int)std::floor(beat - 4.0 * std::floor(beat / 4.0)) + 1; }
inline int64_t phrase_nr(double beat) { return (int64_t)std::floor(beat / 32.0) + 1; }

}  // namespace cdj
