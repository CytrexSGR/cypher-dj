// Fortsetzen auf dem Anker (ADR 004 Regel 3, ARCHITEKTUR §4 Regel 2, SCHNITTSTELLEN §1.1): der neue Kern rechnet, wo
// er ohne Absturz stünde. Der alte Kern schrieb in jedem Zyklus (Kern-Sample, Frame-Zähler des Treibers,
// CLOCK_MONOTONIC) desselben Blockanfangs in den Zustand. Der neue Kern nimmt im ersten Zyklus dieselben zwei Uhren und
// zählt die dazwischen vergangenen Frames auf das Kern-Sample. Vorrang hat der Frame-Zähler des Treibers (samplegenau
// über Neustarts, 10 F2 Probe c: 40 von 40); weicht er von der monotonen Uhr um mehr als ANKER_TOLERANZ ab
// (Treiberwechsel, PipeWire-Neustart: der Zähler beginnt neu, 02 Probe b), gilt die monotone Uhr. Rein rechnend: im
// Callback erlaubt. Scheibe 18.
#pragma once

#include <cstdint>

namespace cdj {

inline constexpr int64_t ANKER_TOLERANZ = 480;  // Samples (10 ms bei 48 kHz), gesetzt

struct Anker {
  int64_t sample;   // Kern-Sample am Blockanfang
  int64_t mono_ns;  // derselbe Blockanfang, CLOCK_MONOTONIC in ns
  uint32_t frames;  // Frame-Zähler des Treibers am selben Blockanfang
};

enum class AnkerQuelle : int32_t { frames = 1, mono = 2 };

struct Fortsetzung {
  int64_t sample;      // Kern-Sample am Anfang des jetzigen Blocks
  AnkerQuelle quelle;  // welche Uhr gezählt hat
  int64_t d_frames;    // vergangene Frames laut Treiber (modulo 2^32 gerechnet)
  int64_t d_mono;      // vergangene Samples laut CLOCK_MONOTONIC, gerundet
};

// frames_jetzt, mono_ns_jetzt: Blockanfang des ersten Zyklus des neuen Kerns (jack_get_cycle_times).
Fortsetzung setze_fort(const Anker& a, uint32_t frames_jetzt, int64_t mono_ns_jetzt) noexcept;

}  // namespace cdj
