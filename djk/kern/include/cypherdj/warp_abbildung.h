// Paket 1.13 Warp (Slice 1, ADR 031): die Abbildung W(b) eines gewarpten Audio-Clips und das Lesen eines gebrochenen Frames.
// Ein Warp ist eine Liste von Markern (Clip-Beat, Quell-Frame), beide streng steigend. W(b) ist zwischen zwei Markern linear, davor
// und danach gilt das Randsegment weiter (wie werkstatt/warp.py: „Vor dem ersten und nach dem letzten Eintrag gilt das Randtempo“).
// Dieselbe Rechnung steht in projekt/warp.ts und oeffentlich/produktion/warp.js; die Referenzdatei vertrag/warp_referenz.json
// bindet alle drei (Test test_warp_abbildung, tests/warp_abbildung.test.mjs). Alles inline und ohne Allokation: erlaubt im Callback.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace cdj {

constexpr int ARR_WARP_MARKER_MAX = 4096;      // Marker je Clip (Spec 1.13 5.1)
constexpr int32_t ARR_BEATS_EINHEITEN_MAX = 32768;   // Slice 4: Einheiten je Clip, gleich MAX_BEATS_EINHEITEN im Server (warp.ts, D9)
constexpr int ARR_WARP_PUNKTE_MAX = 262144;    // Marker aller Clips einer Wiedergabe zusammen (Plan 1.13 S1, Entscheidung D2): 4 MiB
constexpr int32_t ARR_WARP_REPITCH = 0;        // Modus 0: Catmull-Rom im Callback
constexpr int32_t ARR_WARP_BEATS = 1;          // Modus 1 (Slice 4): Einheiten starten je auf ihrem Projekt-Sample, Quelle mit Faktor 1, im Callback
constexpr int32_t ARR_WARP_COMPLEX = 2;        // Modus 2 (Slice 2): Bungee, Korn 512, im Warp-Werk
constexpr int32_t ARR_WARP_TONES = 3;          // Modus 3 (Slice 2): Bungee, Korn 256, im Warp-Werk

// Rechnet der Clip im Warp-Werk (Bungee)?
inline bool arr_warp_werk_modus(int32_t modus) noexcept { return modus == ARR_WARP_COMPLEX || modus == ARR_WARP_TONES; }

constexpr double ARR_WARP_PITCH_MIN = 0.25;    // Slice 5: Vorgabe D1; die Untergrenze 0,25 ist belegt (djk/third_party/bungee/src/Timing.cpp:31-35 Ausgabepuffer);
constexpr double ARR_WARP_PITCH_MAX = 4.0;     // Vorgabe D1 (Andreas entscheidet); Bungee hält auch darüber (Prüfung zu Task 1: TONES 4,5/6 und COMPLEX 16 sauber, ±0 ct). Die frühere "Wand" war ein leeres Messfenster im Test

// Gehört dem Schnappschuss (ArrSnapshot::warps); die Zeiger zeigen in dessen Vektoren und ändern sich nie.
struct ArrWarp {
  int32_t modus = ARR_WARP_REPITCH;
  int32_t n = 0;                   // Marker, 2 bis ARR_WARP_MARKER_MAX
  const double* beat = nullptr;    // Clip-Beats, bereits um versatz_beats verschoben, streng steigend
  const double* frame = nullptr;   // Quell-Frames (48 kHz), streng steigend
  double pitch = 1.0;              // Slice 5: Frequenzfaktor 2^(transpose_st/12 + detune_ct/1200) des Servers; nur complex/tones (Bungee Request.pitch)
  int32_t e_n = 0;                 // Slice 4, nur modus 1: Einheiten
  const double* e_beat = nullptr;  // Clip-Beats der Kopie, streng steigend
  const double* e_frame = nullptr; // Quell-Frames des Einheitsbeginns, streng steigend
  int32_t loop = 0;                // 0 aus, 1 vor, 2 vor_zurueck
  int32_t huelle = 100;            // 0..100
};

// Slice 4: Index der Einheit, in der Clip-Beat b liegt; vor der ersten 0
inline int beats_einheit(const ArrWarp& w, double b) noexcept {
  const int i = static_cast<int>(std::upper_bound(w.e_beat, w.e_beat + w.e_n, b) - w.e_beat) - 1;
  return i < 0 ? 0 : i;
}

// Index i des Segments [beat[i], beat[i+1]), in dem b liegt; vor dem ersten Marker 0, hinter dem letzten n − 2 (Randsegment).
inline int warp_segment(const ArrWarp& w, double b) noexcept {
#ifdef CYPHERDJ_MUTATION_ARR_WARP_ERSTES_SEGMENT
  (void)w;
  (void)b;
  return 0;   // Fehlerfall: nur das erste Segment, die Abbildung ist eine Gerade durch die ersten beiden Marker
#else
  const double* ende = w.beat + (w.n - 1);                    // der letzte Marker beginnt kein Segment
  const int i = static_cast<int>(std::upper_bound(w.beat, ende, b) - w.beat) - 1;
  return i < 0 ? 0 : i;
#endif
}

// Quell-Frame (gebrochen) zum Clip-Beat b
inline double warp_frame(const ArrWarp& w, double b) noexcept {
  const int i = warp_segment(w, b);
  return w.frame[i] + (b - w.beat[i]) * (w.frame[i + 1] - w.frame[i]) / (w.beat[i + 1] - w.beat[i]);
}

// Quell-Frames je Beat im Segment, in dem b liegt (die Steigung W'(b)); dort ist W linear
inline double warp_steigung(const ArrWarp& w, double b) noexcept {
  const int i = warp_segment(w, b);
  return (w.frame[i + 1] - w.frame[i]) / (w.beat[i + 1] - w.beat[i]);
}

// Catmull-Rom wie deck.cpp (LoopBoxen::spiele_frei, ADR 026); auf einer Geraden exakt, bei x = 0 genau y1
inline float warp_catmull(float y0, float y1, float y2, float y3, float x) noexcept {
  return y1 + 0.5f * x * (y2 - y0 + x * (2.0f * y0 - 5.0f * y1 + 4.0f * y2 - y3 + x * (3.0f * (y1 - y2) + y3 - y0)));
}

// Gebrochenes Frame fr einer Stereo-Datei (L, R verschränkt, n Frames); außerhalb der Datei Stille
inline void warp_lies(const float* d, int64_t n, double fr, float& l, float& r) noexcept {
  const int64_t i1 = static_cast<int64_t>(std::floor(fr));
  const float x = static_cast<float>(fr - static_cast<double>(i1));
  float a[4][2];
  for (int j = 0; j < 4; ++j) {
    const int64_t i = i1 - 1 + j;
    if (i < 0 || i >= n) {
      a[j][0] = a[j][1] = 0.0f;
    } else {
      a[j][0] = d[2 * i];
      a[j][1] = d[2 * i + 1];
    }
  }
  l = warp_catmull(a[0][0], a[1][0], a[2][0], a[3][0], x);
  r = warp_catmull(a[0][1], a[1][1], a[2][1], a[3][1], x);
}

}  // namespace cdj
