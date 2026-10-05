// Keylock Slice 3b (F1): Lage und Tonhöhe der Variante bei 1 bis 32 Beats. Bis Slice 3 prüfte kein Test mehr als 4 Beats und
// nur reine Sinustöne (ein Sinus zeigt keine Lage): R3 nimmt je Aufruf höchstens 524 288 Frames an, ab 8 Beats war die
// ausgeschnittene Mitte falsch (8 Beats 0,25 Beats daneben, 16 Beats 7,7 bis 12 Beats, 32 Beats leer), und der Kern prüft
// nur die Länge (LoopBoxen::passt).
//
// Klick-Marker-Loop: auf jedem Beat ein Klick (96 Frames, 4 kHz, Hann-Hülle), die Lautstärke trägt die Beat-Nummer (Beat 0
// laut, jeder vierte mittel, die übrigen leise: eine Verschiebung um ganze Beats ändert das Muster), dazu ein Ton von 416 Hz.
// Gemessen wird der ONSET des Klicks (erste Stelle, an der die geglättete Hochpass-Energie 20 % ihres Maximums im Fenster
// erreicht), nicht sein Schwerpunkt: R3 dehnt Transienten nicht mit, sondern setzt ihren Anfang an die gedehnte Stelle; der
// Schwerpunkt eines gedehnten Klicks läge je nach Tempo bis 75 Frames daneben, ohne dass etwas falsch wäre. Soll-Lage des
// Onsets im Ausgang: Beat b · 22500 · 128/bpm + (Onset im Eingang).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

#include "cypherdj/loop_stretch.h"
#include "pruef.h"

static constexpr double PI = 3.14159265358979323846;
static constexpr int SPB = 22500;  // Frames je Beat bei 128 BPM

static float amp(int b) { return b == 0 ? 0.95f : (b % 4 == 0 ? 0.45f : 0.2f); }

static std::vector<float> marker_loop(int beats) {
  const size_t F = (size_t)beats * SPB;
  std::vector<float> d(2 * F);
  for (size_t i = 0; i < F; ++i) {
    const int b = (int)(i / SPB);
    const size_t k = i % SPB;
    double s = 0.25 * std::sin(2 * PI * 416.0 * (double)i / 48000.0);
    if (k < 96) s += amp(b) * std::sin(2 * PI * 4000.0 * (double)k / 48000.0) * (0.5 - 0.5 * std::cos(2 * PI * (double)k / 96.0));
    d[2 * i] = d[2 * i + 1] = (float)s;
  }
  return d;
}

// Ein Loop läuft im Kreis: Fenster an den Rändern sehen das Ende bzw. den Anfang des Loops (sonst läge ein Onset kurz vor
// Frame 0 außerhalb der Messung). Zugriff auf Frame i (auch negativ oder >= n) der linken Spur.
static double frame_l(const std::vector<float>& o, long i) {
  const long n = (long)(o.size() / 2);
  return (double)o[(size_t)(2 * (((i % n) + n) % n))];
}

// Onset im Fenster [mitte - rad, mitte + rad] der linken Spur (zyklisch); NaN: nichts da. energie: Energie des Maximums.
static double onset(const std::vector<float>& o, double mitte, double rad, double* energie) {
  const long lo = (long)(mitte - rad), hi = (long)(mitte + rad);
  if (hi - lo < 64) return std::nan("");
  std::vector<double> g((size_t)(hi - lo), 0.0);
  const int W = 16;
  double acc = 0;
  std::vector<double> e((size_t)(hi - lo));
  for (long i = lo; i < hi; ++i) {
    const double h = frame_l(o, i) - 2.0 * frame_l(o, i - 1) + frame_l(o, i - 2);
    e[(size_t)(i - lo)] = h * h;
  }
  for (size_t i = 0; i < e.size(); ++i) {
    acc += e[i];
    if (i >= (size_t)W) acc -= e[i - W];
    g[i] = acc;
  }
  double mx = 0;
  for (double v : g) mx = std::max(mx, v);
  if (mx <= 0) return std::nan("");
  size_t j = 0;
  while (j < g.size() && g[j] < 0.2 * mx) ++j;
  if (energie) *energie = mx;
  return (double)lo + (double)j - W / 2.0;
}

// Frequenz des 416-Hz-Tons: Goertzel-Suche ±1 % in 0,05-Hz-Schritten, Hann, 32768 Frames ab einem Drittel
static double ton_hz(const std::vector<float>& o) {
  const size_t n = o.size() / 2, len = std::min<size_t>(32768, n / 2), st = n / 3;
  double bf = 0, bv = -1;
  for (double f = 416.0 * 0.99; f <= 416.0 * 1.01; f += 0.05) {
    double re = 0, im = 0;
    for (size_t i = 0; i < len; ++i) {
      const double w = 0.5 - 0.5 * std::cos(2 * PI * (double)i / (double)len);
      const double x = o[2 * (st + i)] * w, ph = 2 * PI * f * (double)(st + i) / 48000.0;
      re += x * std::cos(ph);
      im += x * std::sin(ph);
    }
    const double v = re * re + im * im;
    if (v > bv) { bv = v; bf = f; }
  }
  return bf;
}

struct Mass {
  bool leer = true;
  size_t frames = 0;
  double dev_min = 0, dev_max = 0, ct = 0;
  bool beats_ok = false;  // das Lautstärke-Muster der Beats steht an der richtigen Stelle
};

static Mass messe(int beats, double bpm) {
  Mass m;
  const auto ein = marker_loop(beats);
  const auto o = cdj::rendere_keylock(ein, bpm);
  m.frames = o.size() / 2;
  if (o.empty()) return m;
  m.leer = false;
  const double ratio = 128.0 / bpm, spb = SPB * ratio;
  double e0 = 0;
  const double o_ein = onset(ein, 50.0, 4000.0, &e0);  // Onset des Klicks im Eingang (gleiche Messung, Beat 0)
  m.dev_min = 1e9;
  m.dev_max = -1e9;
  std::vector<double> en((size_t)beats, 0.0);
  for (int b = 0; b < beats; ++b) {
    const double soll = b * spb + o_ein;
    const double got = onset(o, soll, spb * 0.45, &en[(size_t)b]);
    if (std::isnan(got)) { m.dev_min = -1e9; m.dev_max = 1e9; continue; }
    m.dev_min = std::min(m.dev_min, got - soll);
    m.dev_max = std::max(m.dev_max, got - soll);
  }
  // Muster: Beat 0 lauter als jeder andere, die mittleren (jeder vierte) im Median lauter als die leisen. R3 schwankt die Energie
  // gleich lauter Klicks um bis 2x (gemessen 0,024 bis 0,049 bei amp 0,35), darum die Abstände: Energie ~ amp^2 = 0,90 / 0,20 / 0,04
  m.beats_ok = true;
  std::vector<double> mittel, leise;
  for (int b = 1; b < beats; ++b) {
    (b % 4 == 0 ? mittel : leise).push_back(en[(size_t)b]);
    if (en[0] < (b % 4 == 0 ? 1.25 : 3.0) * en[(size_t)b]) m.beats_ok = false;
  }
  auto median = [](std::vector<double> v) { std::sort(v.begin(), v.end()); return v[v.size() / 2]; };
  if (!mittel.empty() && !leise.empty() && median(mittel) < 2.0 * median(leise)) m.beats_ok = false;
  m.ct = 1200.0 * std::log2(ton_hz(o) / 416.0);
  return m;
}

int main() {
  // Toleranzen (gemessen am 2026-09-30, siehe Bericht slice-03b): Onset-Abweichung höchstens ±64 Frames (1,3 ms; gemessen
  // -55 bis +45 über die ganze Matrix), Tonhöhe ±3 ct (gemessen -0,04). Vorher, mit dem Ein-Block-Render: 8 Beats bei 170 BPM
  // bis -400, 16 Beats bei 135 BPM bis -1240, 32 Beats leer.
  constexpr double TOL_FRAMES = 64.0, TOL_CT = 3.0;
  int gut = 0, gesamt = 0;
  for (double bpm : {100.0, 130.0, 170.0})
    for (int beats : {1, 4, 8, 16, 32}) {
      const Mass m = messe(beats, bpm);
      const size_t soll = (size_t)std::llround((double)beats * SPB * 128.0 / bpm);
      std::printf("%2d Beats %3.0f BPM: %zu Frames (soll %zu), Onset-Abweichung %+.1f .. %+.1f Frames, Ton %+.2f ct, Muster %s\n", beats,
                  bpm, m.frames, soll, m.dev_min, m.dev_max, m.ct, m.beats_ok ? "ok" : "FALSCH");
      ++gesamt;
      PRUEF(!m.leer);
      PRUEF(m.frames == soll);
      PRUEF(m.dev_min >= -TOL_FRAMES && m.dev_max <= TOL_FRAMES);
      PRUEF(m.beats_ok);
      PRUEF(std::fabs(m.ct) <= TOL_CT);
      if (!m.leer && m.frames == soll && m.dev_min >= -TOL_FRAMES && m.dev_max <= TOL_FRAMES && m.beats_ok && std::fabs(m.ct) <= TOL_CT) ++gut;
    }
  std::printf("%d von %d Fällen innerhalb der Toleranz\n", gut, gesamt);

  // Negativ-Kontrolle des Instruments: ein um 1 Beat (22500 Frames) zyklisch verschobener Eingang muss das Muster FALSCH melden,
  // ein um 200 Frames verschobener die Toleranz reißen, sonst sähe die Messung die Fehler nicht, um die es hier geht
  {
    const int beats = 8;
    const double bpm = 130.0, ratio = 128.0 / bpm, spb = SPB * ratio;
    auto ein = marker_loop(beats);
    const size_t F = ein.size() / 2;
    auto o = cdj::rendere_keylock(ein, bpm);
    PRUEF(!o.empty());
    for (size_t zyk : {(size_t)std::llround(spb), (size_t)200}) {
      std::vector<float> v(o.size());
      const size_t N = o.size() / 2;
      for (size_t i = 0; i < N; ++i) { v[2 * i] = o[2 * ((i + zyk) % N)]; v[2 * i + 1] = o[2 * ((i + zyk) % N)]; }
      double e0 = 0, o_ein = onset(ein, 50.0, 4000.0, &e0), emax = 0, emin = 1e300;
      (void)F;
      std::vector<double> en((size_t)beats);
      double dmin = 1e9, dmax = -1e9;
      for (int b = 0; b < beats; ++b) {
        const double soll = b * spb + o_ein;
        const double got = onset(v, soll, spb * 0.45, &en[(size_t)b]);
        if (std::isnan(got)) continue;
        dmin = std::min(dmin, got - soll);
        dmax = std::max(dmax, got - soll);
        emax = std::max(emax, en[(size_t)b]);
        emin = std::min(emin, en[(size_t)b]);
      }
      bool muster = true;
      for (int b = 1; b < beats; ++b)
        if (en[0] < (b % 4 == 0 ? 1.25 : 3.0) * en[(size_t)b]) muster = false;
      const bool sieht = zyk > 1000 ? !muster : (dmax > TOL_FRAMES || dmin < -TOL_FRAMES);
      std::printf("Negativ-Kontrolle: um %zu Frames verschoben: Abweichung %+.0f .. %+.0f, Muster %s, Instrument sieht es: %s\n", zyk, dmin,
                  dmax, muster ? "ok" : "falsch", sieht ? "ja" : "NEIN");
      PRUEF(sieht);
    }
  }
  PRUEF_ENDE();
}
