// Keylock Slice 1: Loop offline auf ein anderes Tempo bringen, ohne die Tonhöhe zu ändern (Plan 2026-09-30-keylock-plan).
// Rubber Band R3 (OptionEngineFiner), offline, im Nicht-Echtzeit-Faden. Reine Funktion, keine globalen Zustände: mehrere
// Aufrufe dürfen gleichzeitig laufen. NICHT im Audio-Callback aufrufen (rechnet 0,3 bis mehrere Sekunden).
#pragma once

#include <atomic>
#include <vector>

#include "cypherdj/loop.h"

namespace cdj {

// Loop-Daten (Stereo verschränkt, 48 kHz, F Frames bei LOOP_BPM = 128) auf bpm bringen: Zeitverhältnis 128/bpm,
// Tonhöhe 1,0. Ergebnis hat genau llround(F · 128 / bpm) Frames (verschränkt, also doppelt so viele Werte).
// Leer, wenn nichts zu rendern ist: bpm == 128 (|bpm − 128| < 1e-9; R3 ist bei 1,0 nicht transparent, ADR 020), bpm
// nicht endlich oder außerhalb [LOOP_MIN_BPM, LOOP_KEYLOCK_MAX_BPM], Eingang leer oder mit ungerader Werte-Zahl.
// Der Aufrufer bleibt dann beim Varispeed.
constexpr double LOOP_KEYLOCK_MAX_BPM = 200.0;
// abbruch (optional): wird zwischen den R3-Stücken gelesen; gesetzt heißt: leer zurück (Slice 3b, F6).
std::vector<float> rendere_keylock(const std::vector<float>& daten, double bpm, const std::atomic<bool>* abbruch = nullptr);
inline std::vector<float> rendere_keylock(const Loop& l, double bpm) { return rendere_keylock(l.daten, bpm); }

// Keylock Slice 4: REC-Umrechnung. daten = roh_frames Stereo-Frames (verschränkt) beim Tempo T der Aufnahme (beats · 48000 ·
// 60 / T), Ergebnis genau frames (= beats · LOOP_SPB) Frames bei 128 BPM, Tonhöhe erhalten (Zeitverhältnis frames /
// roh_frames = T / 128). Leer bei: daten null, roh_frames oder frames ≤ 0, roh_frames == frames (nichts umzurechnen: der
// Aufrufer schreibt direkt), implizitem T = 128 · frames / roh_frames außerhalb [LOOP_MIN_BPM, LOOP_KEYLOCK_MAX_BPM]
// (0,1 % Toleranz für die Rundung der Frames) oder zu kurzem R3-Ergebnis. Reine Funktion, nicht im Audio-Callback.
std::vector<float> rendere_rec(const float* daten, int64_t roh_frames, int64_t frames, const std::atomic<bool>* abbruch = nullptr);

}  // namespace cdj
