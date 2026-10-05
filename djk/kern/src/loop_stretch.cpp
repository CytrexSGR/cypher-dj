// Keylock Slice 1: R3 offline (Fassung wie in messung/rb.cpp des Plans 2026-09-30). Der Loop wird dreifach hintereinander
// gestretcht, die mittlere Kopie ausgeschnitten: Anlauf und Auslauf des Stretchers fallen in die äußeren Kopien, die Naht
// der mittleren Kopie ist dieselbe wie die Naht des Loops.
#include "cypherdj/loop_stretch.h"

#include <rubberband/RubberBandStretcher.h>

#include <algorithm>
#include <atomic>
#include <cmath>

namespace cdj {

namespace {

// Stückgröße der Fütterung von R3 (Slice 3b, F1). Zwei Gründe, gemessen am 2026-09-30:
// 1. R3 nimmt je study()/process()-Aufruf höchstens 524 288 Frames an ("request exceeds overall limit"). Ein Loop von 8 Beats
//    und mehr hat als Dreifach-Eingang mehr: in einem Block gefüttert wurde der Eingang gekappt, die ausgeschnittene Mitte
//    lag 0,25 Beats (8 Beats) bis 12 Beats (16 Beats) daneben, 32 Beats lieferten nichts.
// 2. Die Stückgröße bestimmt die Lage, auch unterhalb des Limits. Gemessen (Klick-Marker, Onset gegen Soll, 16 Beats bei
//    135 BPM, Mittel der mittleren Kopie): Stück 262 144: -900 Frames (bis -1240), 16 384: -79, 4096: -11, 2048: -5, 1024: +4,
//    512: +6; bei 170 BPM wächst die Abweichung mit der Stücklänge ebenso (Steigung bis -40 Frames je Beat bei einem
//    Block). Kleine Stücke bleiben ohne Drift (Steigung < 1 Frame je Beat). Mechanismus (ABGELEITET, die R3-Quellen nicht
//    gelesen): R3 rechnet mit ganzen Hops, das Verhältnis ist dadurch bis 0,25 % falsch (bei Tempo > 128: 135 BPM -0,19 %,
//    170 BPM -0,17 %, 100 BPM exakt) und wird offenbar erst am Ende eines process()-Aufrufs ausgeglichen. Der Wechsel der
//    Fütterung in Slice 1 (4096 statt ein Block: "Lage um ~133 Frames verschoben") war vereinbar damit: die Ein-Block-Fassung
//    war die mit Fehler (4 Beats bei 135 BPM: -207 Frames gegen den Varispeed-Bezug, jetzt +27), study() ändert nichts
//    (gemessen: Stück 4096 beim Studieren, ein Block beim Prozessieren: bitgleich). 1024 liegt mitten im flachen Bereich;
//    Laufzeit praktisch unverändert (4 Beats bei 135 BPM 315 → 329 ms).
constexpr size_t kBlock = 1024;

bool abgebrochen(const std::atomic<bool>* a) { return a && a->load(std::memory_order_relaxed); }

// R3 offline auf genau aus_laenge Frames: Eingang (F Stereo-Frames verschränkt) dreifach hintereinander, Zeitverhältnis
// verhaeltnis (Ausgang/Eingang), Tonhöhe 1,0, mittlere Kopie ausgeschnitten. Leer, wenn R3 zu wenig liefert oder abbruch
// gesetzt wird (zwischen den Stücken geprüft: ein 32-Beat-Render bricht in Zehntelsekunden ab, nicht nach Sekunden).
std::vector<float> stretche_mitte(const float* daten, size_t F, double verhaeltnis, size_t aus_laenge,
                                  const std::atomic<bool>* abbruch) {
  using RubberBand::RubberBandStretcher;
  const size_t K = 3;  // Kopien
  const size_t N = F * K;

  std::vector<float> L(N), R(N);
  for (size_t k = 0; k < K; ++k)
    for (size_t i = 0; i < F; ++i) {
      L[k * F + i] = daten[2 * i];
      R[k * F + i] = daten[2 * i + 1];
    }

  RubberBandStretcher s(48000, 2,
                        RubberBandStretcher::OptionProcessOffline | RubberBandStretcher::OptionEngineFiner |
                            RubberBandStretcher::OptionThreadingNever,
                        verhaeltnis, 1.0);
  s.setExpectedInputDuration(N);
  const size_t block = std::min(N, kBlock);
  s.setMaxProcessSize(block);  // sonst wachsen die Puffer mit Warnung auf stderr

  for (size_t p = 0; p < N; p += block) {
    if (abgebrochen(abbruch)) return {};
    const size_t n = std::min(block, N - p);
    const float* ein[2] = {L.data() + p, R.data() + p};
    s.study(ein, n, p + n >= N);
  }

  std::vector<float> oL, oR, bl(8192), br(8192);
  oL.reserve((size_t)((double)N * verhaeltnis) + 16384);
  oR.reserve(oL.capacity());
  float* ob[2] = {bl.data(), br.data()};
  for (size_t p = 0; p < N; p += block) {
    if (abgebrochen(abbruch)) return {};
    const size_t n = std::min(block, N - p);
    const float* ein[2] = {L.data() + p, R.data() + p};
    s.process(ein, n, p + n >= N);
    for (;;) {  // nach jedem Stück einsammeln, sonst wächst der Ausgabepuffer von R3
      const int av = s.available();
      if (av <= 0) break;  // -1: fertig; 0: R3 will mehr Eingang
      const size_t g = s.retrieve(ob, std::min<size_t>((size_t)av, bl.size()));
      if (g == 0) break;
      oL.insert(oL.end(), bl.begin(), bl.begin() + (std::ptrdiff_t)g);
      oR.insert(oR.end(), br.begin(), br.begin() + (std::ptrdiff_t)g);
    }
  }
  if (oL.size() < aus_laenge) return {};  // Stretcher hat zu wenig geliefert: Aufrufer bleibt beim Varispeed

  const size_t a = (oL.size() - aus_laenge) / 2;  // Mitte der drei Kopien
  std::vector<float> aus(aus_laenge * 2);
  for (size_t i = 0; i < aus_laenge; ++i) {
    aus[2 * i] = oL[a + i];
    aus[2 * i + 1] = oR[a + i];
  }
  return aus;
}

}  // namespace

std::vector<float> rendere_keylock(const std::vector<float>& daten, double bpm, const std::atomic<bool>* abbruch) {
  if (!std::isfinite(bpm) || bpm < LOOP_MIN_BPM || bpm > LOOP_KEYLOCK_MAX_BPM || std::fabs(bpm - LOOP_BPM) < 1e-9) return {};
  if (daten.empty() || daten.size() % 2 != 0) return {};
  const size_t F = daten.size() / 2;
  const double verhaeltnis = LOOP_BPM / bpm;
  return stretche_mitte(daten.data(), F, verhaeltnis, (size_t)std::llround((double)F * verhaeltnis), abbruch);
}

// Keylock Slice 4: REC-Umrechnung. Der Mitschnitt dauert roh_frames beim Tempo T der Aufnahme (beats · 48000 · 60 / T) und
// soll frames = beats · LOOP_SPB Frames bei 128 BPM werden: Zeitverhältnis frames / roh_frames = T / 128, Tonhöhe 1,0.
// Das ist dieselbe R3-Rechnung wie bei den Varianten, nur mit der Länge als Vorgabe. T ergibt sich zu 128 · frames / roh.
std::vector<float> rendere_rec(const float* daten, int64_t roh_frames, int64_t frames, const std::atomic<bool>* abbruch) {
  if (!daten || roh_frames <= 0 || frames <= 0 || roh_frames == frames) return {};
  const double t = LOOP_BPM * (double)frames / (double)roh_frames;  // Tempo der Aufnahme
  if (!(t >= LOOP_MIN_BPM * 0.999 && t <= LOOP_KEYLOCK_MAX_BPM * 1.001)) return {};
  return stretche_mitte(daten, (size_t)roh_frames, (double)frames / (double)roh_frames, (size_t)frames, abbruch);
}

}  // namespace cdj
