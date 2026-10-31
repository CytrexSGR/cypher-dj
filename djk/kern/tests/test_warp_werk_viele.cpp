// Paket 1.13 Warp, Slice 3a, Task 4 (AK10 im Kern): ein Marker je Schlag einer driftenden Quelle (Tempokurve von proben/07-werkstatt-zerleger/b_timemap.py:
// bpm(t) = 127,5 + t/120 + 0,5 sin(2π t/45)), abgespielt im 128er Projekt (22 500 Samples je Beat, Treiber des Arrangement-Moduls).
//  1  RE-PITCH     96 Beats, ein Marker je Schlag (97): jeder Klick liegt auf ±1 Sample im Raster; Negativ-Kontrolle: konstanter Warp zur Ausgleichs-BPM (zwei
//                  Marker, Kleinste Quadrate) liegt p90 > 5 ms (240 Samples) daneben, mit derselben Messung
//  2  COMPLEX,TONES dasselbe mit Hann-Klicks (1 kHz unter Hann-Hülle, 144 Samples, Hüllkurven-Messer lage_huelle.h): p90 ≤ 1 ms (48 Samples, AK10), das Maximum
//                  wird ausgewiesen; Negativ-Kontrolle wie in 1 (p90 > 5 ms)
//  3  4096 Marker  dieselbe Abbildung mit 4096 statt 97 Markern (die 97 Schlag-Marker bleiben, dazwischen dicht auf der Polylinie aufgefüllt, W bis auf
//                  Rundung gleich, gerechnet 5e-10 Frames; die Suche geht 12 Schritte tief): RE-PITCH gleich dem Lauf aus 1 (Betrag der Differenz < 1e-4),
//                  COMPLEX/TONES p90 ≤ 48 Samples
//  4  Eins bei 2   die ersten Marker haben negative Beats (Karten-Beat minus Eins 2): der Klick 2 liegt auf dem Clip-Start, die Klicks 0 und 1 klingen nicht
// Mutation ARR_WARP_ERSTES_SEGMENT (warp_abbildung.h): die Abbildung kennt nur das erste Segment; die Fälle 1 bis 4 werden rot.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <vector>

#include "arr_bau.h"
#include "lage_huelle.h"
#include "pruef.h"

bool g_waechter = false;   // wie die anderen Werk-Tests (test_warp_werk_pitch.cpp:22)

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr int HANN = 144;
constexpr int N_SCHLAEGE = 97;      // Beat 0 bis 96
constexpr double LAGE_P90 = 48.0;   // Samples = 1 ms (AK10)
constexpr double NK_P90 = 240.0;    // Samples = 5 ms: der konstante Warp muss darüber liegen

double bpm_bei(double t) { return 127.5 + t / 120.0 + 0.5 * std::sin(2.0 * PI * t / 45.0); }

// Schlag k der Quelle bei fr[k] Frames (48 kHz); der erste bei 0,25 s, der nächste nach 60 / bpm(t) Sekunden
std::vector<double> schlag_frames(int n) {
  std::vector<double> f;
  double t = 0.25;
  for (int k = 0; k < n; ++k) {
    f.push_back(static_cast<double>(std::llround(t * 48000.0)));
    t += 60.0 / bpm_bei(t);
  }
  return f;
}

// Quelle: ein Impuls (1.0) oder ein Hann-Klick (Anfang bei fr[k], Mitte 71,5 Frames später) je Schlag
std::unique_ptr<Audio> quelle(const std::vector<double>& fr, bool hann) {
  const int64_t frames = static_cast<int64_t>(fr.back()) + 3 * 48000;
  auto x = Audio::gleich(frames, 0.0f);
  for (double f : fr) {
    const int64_t a = static_cast<int64_t>(f);
    if (!hann) {
      x->d[static_cast<size_t>(2 * a)] = x->d[static_cast<size_t>(2 * a + 1)] = 1.0f;
      continue;
    }
    for (int i = 0; i < HANN; ++i) {
      const float v = static_cast<float>(0.5 * std::sin(2.0 * PI * 1000.0 * i / 48000.0) * 0.5 * (1.0 - std::cos(2.0 * PI * i / 143.0)));
      x->d[static_cast<size_t>(2 * (a + i))] = x->d[static_cast<size_t>(2 * (a + i) + 1)] = v;
    }
  }
  x->fuellen(frames);
  return x;
}

// Spielt den Clip (ein Warp aus mb/mf, Clip-Länge laenge Beats ab Beat 0) bis laenge + 3 Beats; l = linker Ausgang, s_c = Sample des Clip-Starts.
// false: ohne Bungee gebaut (COMPLEX/TONES nicht spielbar)
bool spiele(int modus, const std::vector<double>& mb, const std::vector<double>& mf, const Audio& q, double laenge, std::vector<float>& l, int64_t& s_c) {
  Treiber t;
  if (modus != cdj::ARR_WARP_REPITCH && !t.mit_werk()) return false;
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, laenge, &q.a).warp(mb, mf, modus);
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(t.k.sample_at(laenge + 3.0)));
  s_c = t.arr.einsatz_sample();
  PRUEF(t.arr.warp_unterlauf() == 0 && t.arr.warp_kein_platz() == 0);
  l = t.l;
  return true;
}

int64_t spitze_bei(const std::vector<float>& l, int64_t mitte, int64_t radius) {
  int64_t best = std::max<int64_t>(0, mitte);
  for (int64_t i = std::max<int64_t>(0, mitte - radius); i <= mitte + radius && i < static_cast<int64_t>(l.size()); ++i)
    if (std::fabs(l[static_cast<size_t>(i)]) > std::fabs(l[static_cast<size_t>(best)])) best = i;
  return best;
}

// Abweichung der Klicks k0..k1 vom Raster in Samples (1e9: nicht gefunden). eins: der Schlag, der auf dem Clip-Start liegt (Beat 0).
// hann: Hüllkurven-Mitte (COMPLEX/TONES), sonst Spitze des Impulses (RE-PITCH). radius: Suchfenster um das Soll.
std::vector<double> abweichungen(const std::vector<float>& l, int64_t s_c, const std::vector<double>& fr, int k0, int k1, int eins, bool hann, int radius) {
  std::vector<double> d;
  for (int k = k0; k <= k1; ++k) {
    const double b = static_cast<double>(k - eins) + (hann ? 71.5 / (fr[static_cast<size_t>(k) + 1] - fr[static_cast<size_t>(k)]) : 0.0);
    const double soll = static_cast<double>(s_c) + b * static_cast<double>(SPB);
    double ist = -1e9;
    if (hann) {
      ist = lagetest::huelle_mitte(l, soll, radius);
    } else {
      const int64_t p = spitze_bei(l, std::llround(soll), radius);
      if (std::fabs(l[static_cast<size_t>(p)]) > 0.2f) ist = static_cast<double>(p);
    }
    d.push_back(ist < -1e8 ? 1e9 : std::fabs(ist - soll));
  }
  return d;
}

double p90(std::vector<double> v) {
  std::sort(v.begin(), v.end());
  return v[static_cast<size_t>(std::ceil(0.9 * static_cast<double>(v.size()))) - 1];
}
double groesste(const std::vector<double>& v) { return *std::max_element(v.begin(), v.end()); }

// Ausgleichsgerade Frame = c + a · k (Kleinste Quadrate über alle Schläge): die konstante Tempo-Annahme der Negativ-Kontrolle
void ausgleich(const std::vector<double>& fr, double& c, double& a) {
  double sk = 0, sf = 0, skk = 0, skf = 0;
  const double n = static_cast<double>(fr.size());
  for (size_t k = 0; k < fr.size(); ++k) {
    sk += static_cast<double>(k);
    sf += fr[k];
    skk += static_cast<double>(k * k);
    skf += static_cast<double>(k) * fr[k];
  }
  a = (n * skf - sk * sf) / (n * skk - sk * sk);
  c = (sf - a * sk) / n;
}

// n Marker über Beat 0..96: die 97 Schlag-Marker (ganze Beats) bleiben, dazwischen werden die übrigen n − 97 gleichmäßig auf die 96 Segmente verteilt, auf der
// Polylinie der Schläge. So bleibt W bis auf Rundung dieselbe; Marker, die die Schläge nicht enthalten (gleichmäßig über 0..96), legen an jedem Knick eine
// Sehne unter die Polylinie (bis 0,0385 Frames daneben, gerechnet) und ließen Fall 3 RE-PITCH nie unter 1e-4 kommen.
void dicht(const std::vector<double>& fr, int n, std::vector<double>& mb, std::vector<double>& mf) {
  const int seg = static_cast<int>(fr.size()) - 1;      // 96 Segmente
  const int extra = n - static_cast<int>(fr.size());    // 3999 Zusatzmarker
  for (int k = 0; k < seg; ++k) {
    const int m = extra / seg + (k < extra % seg ? 1 : 0);
    mb.push_back(static_cast<double>(k));
    mf.push_back(fr[static_cast<size_t>(k)]);
    for (int j = 1; j <= m; ++j) {
      const double x = static_cast<double>(j) / (m + 1);
      mb.push_back(k + x);
      mf.push_back(fr[static_cast<size_t>(k)] + x * (fr[static_cast<size_t>(k) + 1] - fr[static_cast<size_t>(k)]));
    }
  }
  mb.push_back(static_cast<double>(seg));
  mf.push_back(fr.back());
}

const char* name(int modus) { return modus == cdj::ARR_WARP_COMPLEX ? "COMPLEX" : "TONES"; }

}  // namespace

int main() {
  const std::vector<double> fr = schlag_frames(N_SCHLAEGE);
  std::vector<double> mb, mf;   // ein Marker je Schlag: Beat k ↔ Frame fr[k]
  for (int k = 0; k < N_SCHLAEGE; ++k) {
    mb.push_back(k);
    mf.push_back(fr[static_cast<size_t>(k)]);
  }
  double c = 0, a = 0;
  ausgleich(fr, c, a);
  const std::vector<double> kb = {0.0, 96.0}, kf = {c, c + 96.0 * a};   // konstanter Warp zur Ausgleichs-BPM
  std::vector<float> rp_viele;   // RE-PITCH-Lauf aus Fall 1 (Vergleich in Fall 3)

  {  // 1: RE-PITCH
    auto q = quelle(fr, false);
    std::vector<float> l, ln;
    int64_t s = 0, sn = 0;
    PRUEF(spiele(cdj::ARR_WARP_REPITCH, mb, mf, *q, 96.0, l, s));
    const auto d = abweichungen(l, s, fr, 1, 95, 0, false, 8);
    std::printf("Fall 1 RE-PITCH, ein Marker je Schlag: 95 Klicks, größte Abweichung %.2f Samples, p90 %.2f\n", groesste(d), p90(d));
    PRUEF(groesste(d) <= 1.0);
    PRUEF(spiele(cdj::ARR_WARP_REPITCH, kb, kf, *q, 96.0, ln, sn));
    const auto dn = abweichungen(ln, sn, fr, 1, 95, 0, false, 6000);
    std::printf("Fall 1 Negativ-Kontrolle (konstanter Warp, Ausgleichs-BPM %.4f): größte Abweichung %.1f Samples, p90 %.1f\n", 60.0 * 48000.0 / a, groesste(dn), p90(dn));
    PRUEF(groesste(dn) < 1e8);   // das Messgerät sieht die Klicks auch dort (sonst wäre p90 > 240 ein Blindwert)
    PRUEF(p90(dn) > NK_P90);
    rp_viele = l;
  }
  for (int modus : {cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES}) {  // 2 und 3: Werk
    auto q = quelle(fr, true);
    std::vector<float> l, ln, l4;
    int64_t s = 0, sn = 0, s4 = 0;
    if (!spiele(modus, mb, mf, *q, 96.0, l, s)) {
      std::printf("Fall 2 und 3 (%s): übersprungen, ohne Bungee gebaut\n", name(modus));
      continue;
    }
    const auto d = abweichungen(l, s, fr, 1, 95, 0, true, 300);
    std::printf("Fall 2 %s, ein Marker je Schlag: größte Abweichung %.2f Samples, p90 %.2f (Grenze p90 %.0f)\n", name(modus), groesste(d), p90(d), LAGE_P90);
    PRUEF(groesste(d) < 1e8);
    PRUEF(p90(d) <= LAGE_P90);
    PRUEF(spiele(modus, kb, kf, *q, 96.0, ln, sn));
    const auto dn = abweichungen(ln, sn, fr, 1, 95, 0, true, 6000);
    std::printf("Fall 2 %s Negativ-Kontrolle (konstanter Warp): größte Abweichung %.1f Samples, p90 %.1f\n", name(modus), groesste(dn), p90(dn));
    PRUEF(groesste(dn) < 1e8);
    PRUEF(p90(dn) > NK_P90);
    std::vector<double> db, df;
    dicht(fr, 4096, db, df);
    PRUEF(db.size() == 4096 && df.size() == 4096);
    PRUEF(spiele(modus, db, df, *q, 96.0, l4, s4));
    const auto d4 = abweichungen(l4, s4, fr, 1, 95, 0, true, 300);
    std::printf("Fall 3 %s, 4096 Marker: größte Abweichung %.2f Samples, p90 %.2f\n", name(modus), groesste(d4), p90(d4));
    PRUEF(groesste(d4) < 1e8);
    PRUEF(p90(d4) <= LAGE_P90);
  }
  {  // 3 (RE-PITCH): 4096 Marker spielen dasselbe wie 97
    auto q = quelle(fr, false);
    std::vector<double> db, df;
    dicht(fr, 4096, db, df);
    PRUEF(db.size() == 4096 && df.size() == 4096);
    std::vector<float> l4;
    int64_t s4 = 0;
    PRUEF(spiele(cdj::ARR_WARP_REPITCH, db, df, *q, 96.0, l4, s4));
    PRUEF(l4.size() == rp_viele.size());
    double m = 0.0;
    for (size_t i = 0; i < l4.size(); ++i) m = std::max(m, static_cast<double>(std::fabs(l4[i] - rp_viele[i])));
    std::printf("Fall 3 RE-PITCH, 4096 gegen 97 Marker: größter Unterschied %.3g\n", m);
    PRUEF(m < 1e-4);
    const auto d = abweichungen(l4, s4, fr, 1, 95, 0, false, 8);
    PRUEF(groesste(d) <= 1.0);
  }
  {  // 4: die Eins liegt bei Karten-Beat 2: Marker-Beat = k − 2, der Clip beginnt bei Beat 0 = Schlag 2
    std::vector<double> eb;
    for (int k = 0; k < N_SCHLAEGE; ++k) eb.push_back(k - 2);
    auto qi = quelle(fr, false);
    std::vector<float> l;
    int64_t s = 0;
    PRUEF(spiele(cdj::ARR_WARP_REPITCH, eb, mf, *qi, 94.0, l, s));
    const auto d = abweichungen(l, s, fr, 2, 95, 2, false, 8);
    std::printf("Fall 4 RE-PITCH, Eins bei 2: Klick 2 auf dem Clip-Start, größte Abweichung %.2f Samples\n", groesste(d));
    PRUEF(groesste(d) <= 1.0);
    auto qh = quelle(fr, true);
    std::vector<float> lw;
    int64_t sw = 0;
    if (spiele(cdj::ARR_WARP_COMPLEX, eb, mf, *qh, 94.0, lw, sw)) {
      const auto dw = abweichungen(lw, sw, fr, 3, 95, 2, true, 300);
      std::printf("Fall 4 COMPLEX, Eins bei 2: p90 %.2f Samples\n", p90(dw));
      PRUEF(groesste(dw) < 1e8);
      PRUEF(p90(dw) <= LAGE_P90);
    }
  }
  PRUEF_ENDE();
}
