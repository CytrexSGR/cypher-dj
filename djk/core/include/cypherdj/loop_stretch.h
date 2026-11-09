// Keylock Slice 1 und 4: Audio offline auf ein anderes Tempo bringen, ohne die Tonhöhe zu ändern (Plan 2026-09-30-keylock-plan);
// seit Task 7 nur noch die REC-Umrechnung.
// Rubber Band R3 (OptionEngineFiner), offline, im Nicht-Echtzeit-Faden. Reine Funktion, keine globalen Zustände: mehrere
// Aufrufe dürfen gleichzeitig laufen. NICHT im Audio-Callback aufrufen (rechnet 0,3 bis mehrere Sekunden).
#pragma once

#include <atomic>
#include <vector>

#include "cypherdj/loop.h"

namespace cdj {

// Höchstes Tempo der REC-Umrechnung (Slice 1 bis 3 auch der Keylock-Varianten, die mit Task 7 ausgebaut sind: die Loop-Box
// dehnt live mit dem Dehner).
constexpr double LOOP_KEYLOCK_MAX_BPM = 200.0;

// Keylock Slice 4: REC-Umrechnung. daten = roh_frames Stereo-Frames (verschränkt) beim Tempo T der Aufnahme (beats · 48000 ·
// 60 / T), Ergebnis genau frames (= beats · LOOP_SPB) Frames bei 128 BPM, Tonhöhe erhalten (Zeitverhältnis frames /
// roh_frames = T / 128). Leer bei: daten null, roh_frames oder frames ≤ 0, roh_frames == frames (nichts umzurechnen: der
// Aufrufer schreibt direkt), implizitem T = 128 · frames / roh_frames außerhalb [LOOP_MIN_BPM, LOOP_KEYLOCK_MAX_BPM]
// (0,1 % Toleranz für die Rundung der Frames) oder zu kurzem R3-Ergebnis. Reine Funktion, nicht im Audio-Callback.
std::vector<float> rendere_rec(const float* daten, int64_t roh_frames, int64_t frames, const std::atomic<bool>* abbruch = nullptr);

}  // namespace cdj
