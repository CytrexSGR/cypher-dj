// MVP 2 (Spec docs/specs/2026-09-27-djk-mvp2-loops-design.md, ADR 025): Loop für die Loop-Boxen des Kerns. Ein Loop
// ist genau beats Beats bei 128 BPM (MVP 2 Scheibe 3: vorher takte Takte) (Set-Basis), Stereo float32 verschränkt, 48 kHz. Geladen und geprüft im
// Nicht-Echtzeit-Faden (Netz); der Callback liest nur.
#pragma once

#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace cdj {

constexpr double LOOP_BPM = 128.0;
constexpr int64_t LOOP_SPB = 22500;                                 // Samples je Beat bei 128 BPM
constexpr int LOOP_MAX_BEATS = 32;
constexpr int64_t LOOP_MAX_FRAMES = LOOP_MAX_BEATS * LOOP_SPB;  // 720 000
constexpr double LOOP_MIN_BPM = 60.0;  // langsamstes Tempo der Karte (§4.2): so lang kann ein Mitschnitt je Beat werden
inline int64_t mitschnitt_max_frames(int beats) { return (int64_t)beats * 48000; }  // beats · 60 s / 60 BPM · 48 kHz

inline bool loop_beats_ok(int b) { return b == 1 || b == 2 || b == 4 || b == 8 || b == 16 || b == 32; }
inline bool loop_takte_ok(int t) { return t == 1 || t == 2 || t == 4 || t == 8; }  // nur für alte loop.json

inline bool loop_name_ok(const char* s) {  // [a-z0-9_-]{1,32}
  const size_t n = std::strlen(s);
  if (n == 0 || n > 32) return false;
  for (size_t i = 0; i < n; ++i) {
    const char c = s[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return true;
}

struct Loop {
  std::string name;
  int beats = 0;
  int64_t frames = 0;        // beats · LOOP_SPB
  std::vector<float> daten;  // 2 · frames Werte, L R verschränkt
  int64_t versatz = 0;       // Plan Grid: Raster im Loop um so viele Frames später (loop.json versatz_frames, |v| < frames)
  // Keylock (Plan 2026-09-30): Tempo, bei dem daten beats Beats lang ist. 128 = gewöhnlicher Loop (frames = beats ·
  // LOOP_SPB). Eine Keylock-Variante hat dieselben beats, frames = llround(frames_orig · 128 / bpm) und bpm = T_r.
  double bpm = LOOP_BPM;
};

// Liest <ordner>/loop.json und <ordner>/loop.f32. Fehler: nullptr, *fehler nennt Datei und Grund.
std::unique_ptr<Loop> lade_loop(const std::string& ordner, std::string* fehler);

// MVP 2 Scheibe 2 (ADR 025 Folgeplan, §4.9 /k/loop/rec, §5.11 /e/mitschnitt): ein laufender Mitschnitt. Das Netz legt
// ihn mit daten.resize(2 · frames) an, bevor es /k/loop/rec einreiht; LoopBoxen::block() (Echtzeit) füllt daten von
// gefuellt an weiter, ohne Allokation. name ist der Ordnername (nicht geprüft: das prüft loop_name_ok beim Einreihen).
struct Mitschnitt {
  char name[48] = {};
  int beats = 0;
  int64_t frames = 0;        // beats · LOOP_SPB (Länge der geschriebenen Datei, Set-Basis 128 BPM)
  int64_t roh_frames = 0;     // Plan Tempo-Folge: beim Tempo der Aufnahme zu kopierende Frames (bei 128 BPM = frames)
  double bpm = 0.0;           // Tempo der Aufnahme (fest; ändert es sich, bricht der Mitschnitt ab)
  double ab_beat = 0.0;       // nächstes Vielfaches von beats Beats ab dem Beat von /k/loop/rec
  int64_t ab_sample = 0;      // llround(sample_at(ab_beat))
  int64_t gefuellt = 0;       // Frames schon kopiert (0 bis frames)
  bool abgebrochen = false;   // MVP 2 Scheibe 3 (E4): Tempo änderte sich vor dem Einsatz; /e/mitschnitt Status 1
  bool umgerechnet = false;   // Keylock Slice 4: daten sind schon auf frames Frames bei 128 BPM gebracht (R3, Tonhöhe erhalten)
  std::vector<float> daten;   // mindestens 2 · roh_frames Werte (das Netz legt 2 · mitschnitt_max_frames an), L R verschränkt
};

// Plan Tempo-Folge: tastet n_ein Stereo-Frames (L R verschränkt) auf n_aus um, Anfang auf Anfang, mit Umlauf (der
// Mitschnitt ist ein Loop). Fenster-Sinc (Hann, 16 Nulldurchgänge je Seite) aus einer Tabelle, beim Verkürzen mit
// Tiefpass. Alloziert die Tabelle: nicht im Callback.
void umtasten(const float* ein, int64_t n_ein, float* aus, int64_t n_aus);

// Schreibt <ordner>/<name>/loop.json + loop.f32 aus einem fertigen Mitschnitt (Keylock Slice 4: daten = frames Frames bei
// 128 BPM; bei roh_frames != frames muss umgerechnet gesetzt sein, sonst Fehler): erst nach <ordner>/.<name>.neu/, dann
// umbenennen (wie loop_bauen.py), damit ein Leser nie einen halben Ordner sieht. Nicht im Callback (Datei-I/O).
// false und *fehler gesetzt: <ordner>/<name> gibt es schon, oder ein Schreibfehler; die Neu-Datei bleibt dann nicht
// liegen.
bool schreibe_loop(const std::string& ordner, const Mitschnitt& m, std::string* fehler);

}  // namespace cdj
