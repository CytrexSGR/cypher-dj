// Keylock Slice 1: rendere_keylock (R3 offline). Länge exakt, Tonhöhe gehalten, Naht ohne Klick, leer wo der Varispeed bleibt.
#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

#include "cypherdj/loop_stretch.h"
#include "pruef.h"

static constexpr int F = 90000;  // 4 Beats bei 128
static constexpr double PI = 3.14159265358979323846;

// 245 ganze Perioden in 90000 Frames = 130,667 Hz (ein Sinus, der als Loop nahtlos schließt)
static std::vector<float> sinus() {
  std::vector<float> d((size_t)F * 2);
  for (int i = 0; i < F; ++i) {
    const float v = 0.5f * (float)std::sin(2 * PI * 245.0 * i / F);
    d[2 * i] = v;
    d[2 * i + 1] = v;
  }
  return d;
}

// Frequenz aus den aufwärts gerichteten Nulldurchgängen (linear interpoliert), mittlere 80 % der linken Spur
static double frequenz(const std::vector<float>& d) {
  const size_t n = d.size() / 2, a = n / 10, b = n - n / 10;
  double erste = -1, letzte = -1;
  int zahl = 0;
  for (size_t i = a; i + 1 < b; ++i) {
    const double x0 = d[2 * i], x1 = d[2 * (i + 1)];
    if (x0 < 0 && x1 >= 0) {
      const double t = (double)i + (-x0) / (x1 - x0);
      if (erste < 0) erste = t;
      letzte = t;
      ++zahl;
    }
  }
  return zahl < 2 ? 0.0 : (zahl - 1) * 48000.0 / (letzte - erste);
}

int main() {
  const std::vector<float> ein = sinus();
  const double f0 = 245.0 * 48000.0 / F;
  PRUEF_NAH(frequenz(ein), f0, 0.01);  // Messkontrolle am Eingang

  // (1) 135 BPM: Länge exakt, Tonhöhe innerhalb ±10 ct (R3 am Ton gemessen fein −5,2 ct)
  const auto aus = cdj::rendere_keylock(ein, 135.0);
  PRUEF(aus.size() == 2 * 85333u);
  PRUEF(std::llround(90000 * 128.0 / 135.0) == 85333);
  const double ct = 1200.0 * std::log2(frequenz(aus) / f0);
  std::printf("135 BPM: %zu Frames, Frequenz %.3f Hz, %+.2f ct\n", aus.size() / 2, frequenz(aus), ct);
  PRUEF(std::fabs(ct) <= 10.0);
  // Gegenprobe der Messung: Varispeed-Tonhöhe wäre +92 ct, das Instrument sähe es
  PRUEF(std::fabs(1200.0 * std::log2(f0 * 135.0 / 128.0 / f0) - 92.18) < 0.1);

  // (2) 128 → leer; 130 und 140 (und die Ränder des Bereichs) → Länge exakt
  PRUEF(cdj::rendere_keylock(ein, 128.0).empty());
  PRUEF(cdj::rendere_keylock(ein, 128.0 + 5e-10).empty());
  for (double bpm : {130.0, 140.0, 60.0, 200.0, 128.5}) {
    const auto r = cdj::rendere_keylock(ein, bpm);
    PRUEF(r.size() == 2 * (size_t)std::llround(F * 128.0 / bpm));
  }
  // außerhalb [60, 200], unsinnig, leerer oder schiefer Eingang → leer
  PRUEF(cdj::rendere_keylock(ein, 59.9).empty());
  PRUEF(cdj::rendere_keylock(ein, 200.1).empty());
  PRUEF(cdj::rendere_keylock(ein, 0.0).empty());
  PRUEF(cdj::rendere_keylock(ein, std::numeric_limits<double>::quiet_NaN()).empty());
  PRUEF(cdj::rendere_keylock(std::vector<float>{}, 135.0).empty());
  PRUEF(cdj::rendere_keylock(std::vector<float>(7, 0.1f), 135.0).empty());

  // (3) Naht: Sprung vom letzten zum ersten Frame gegen den Sprung im Inneren (p99,9). Ein Ton schließt nur, wenn er in Eingang
  // UND Ausgang ganze Perioden hat: 135 BPM (Ausgang 85333,3 Frames): m = 270 Perioden im Eingang, 256 im Ausgang (144 Hz);
  // 130 BPM (88615,4 Frames): m = 260 und 256 (138,67 Hz). Der Ton von (1) (245 Perioden) schließt bei 128/135 nicht, das ist
  // keine Naht des Renders (Befund beim Bau: 0,79 Sprung, die Phase war über die ganze Länge stetig).
  struct Fall { double bpm; int m; };
  for (Fall fa : {Fall{135.0, 270}, Fall{130.0, 260}}) {
    std::vector<float> ton((size_t)F * 2);
    for (int i = 0; i < F; ++i) ton[2 * i] = ton[2 * i + 1] = 0.5f * (float)std::sin(2 * PI * fa.m * i / F);
    const auto r = cdj::rendere_keylock(ton, fa.bpm);
    const size_t n = r.size() / 2;
    std::vector<double> s;
    for (size_t i = 0; i + 1 < n; ++i) s.push_back(std::fabs((double)r[2 * (i + 1)] - r[2 * i]));
    std::sort(s.begin(), s.end());
    const double p999 = s[(size_t)(0.999 * (double)(s.size() - 1))];
    const double naht = std::fabs((double)r[0] - r[2 * (n - 1)]);
    std::printf("%.0f BPM: Naht %.5f, Inneres p99,9 %.5f\n", fa.bpm, naht, p999);
    PRUEF(naht <= 0.15);
    PRUEF(naht <= 3 * p999 + 1e-3);
  }
  // Kanäle bleiben getrennt und gleich (Eingang L == R)
  for (size_t i = 0; i < aus.size(); i += 2) PRUEF_NAH(aus[i], aus[i + 1], 1e-6);
  // Loop-Überladung gibt dasselbe
  cdj::Loop l;
  l.daten = ein;
  l.frames = F;
  l.beats = 4;
  PRUEF(cdj::rendere_keylock(l, 135.0) == aus);  // deterministisch
  PRUEF_ENDE();
}
