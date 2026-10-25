// Paket 1.13 Warp, Slice 1 (Kern): RE-PITCH im Callback. Ein gewarpter Audio-Clip liest die Quelle an der Stelle W(b), b = Projekt-Beat
// des Samples minus Clip-Anfang (Marker streng steigend, linear dazwischen). Der Treiber fährt das Modul mit 128 BPM (22 500 Samples
// je Beat), die Quellen sind auf 125 BPM gebaut (23 040 Frames je Beat). Fälle:
//   1  AK4   Klick-Loop 125 → 128 BPM, 64 Beats: jeder Klick liegt auf dem Projektraster ±1 Sample; Vorher-Fall ohne Warp: nach 4 Beats
//            2160 Samples (45 ms) daneben
//   2  AK5   Sinus 1 kHz klingt um +41,06 ct (1200 · log2(128/125)) ± 0,5 ct höher, ungewarpt ±0,5 ct um 0
//   3  AK16  Projekttempo 120: dieselbe Wiedergabe liegt wieder auf dem Raster (Länge in Beats gleich), ungewarpt läuft sie auseinander
//   4        Start mitten im Clip (Beat 6,5): der Klick auf Beat 7 liegt 11 250 Samples nach dem Einsatz
//   5        Tempo-Rampe in der Karte: die Quellposition folgt dem Projekt-Beat (Rampe als Quelle, Frame = Wert)
//   6        Tausch: geänderter Warp blendet den alten aus und setzt den neuen ein; unveränderter Warp bindet ohne Blende neu
//   7        Warp mit Steigung 1 = ungewarpt (Gains, Fades, Naht, Einstieg, Stopp), bis auf 1e-6
//   8        Blockgröße ist kein Parameter des Klangs (97, 256, 1024 gleich bis 1e-3)
//   9        Ende der Datei beendet die Stimme; vor dem Anfang der Datei Stille
//  10        Loop-Naht eines gewarpten Clips absolut: 96 Samples Ausblende, neuer Durchlauf voll
//  11        Neustart beim Spielen (start() bei laufendem Transport): die ausblendende Stimme liest weiter an ihrer alten Abbildung, kein Sprung
//  12        Neustart beim Spielen und, noch innerhalb der 96 Samples Ausblende, ein Tausch, der den Clip entfernt: die Ausklang-Kopie liest an der alten Abbildung weiter
// Mutationen: ARR_WARP_TAUSCH_GLEICH (Fall 6 rot), ARR_NAHT_HART (Fall 10 rot), ARR_WARP_OHNE_DATEIENDE (Fall 9 rot),
// ARR_WARP_BLOCKANFANG (gemessen rot: Fall 1, 2, 5, 6, 8, 9, 11; Fall 3 bleibt grün), ARR_WARP_NEUSTART_URSPRUNG (Fall 11 rot), ARR_WARP_AUSKLANG_URSPRUNG (Fall 12 rot, Fall 11 bleibt grün).
#include <algorithm>
#include <cmath>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static constexpr int64_t EINSATZ = V + 256;       // Start sofort bei Sample 0: Einsatz bei 793
static constexpr int64_t FPB = 23040;             // Quell-Frames je Beat der 125-BPM-Quellen: 48 000 · 60 / 125
static const double MITTE = 0.70710677;           // Pan Mitte (Gesetz −3 dB)

namespace {

// Sample im Fenster ±radius um mitte mit dem größten |l|
int64_t spitze_bei(const std::vector<float>& l, int64_t mitte, int64_t radius) {
  int64_t best = mitte;
  for (int64_t i = std::max<int64_t>(0, mitte - radius); i <= mitte + radius && i < static_cast<int64_t>(l.size()); ++i)
    if (std::fabs(l[i]) > std::fabs(l[best])) best = i;
  return best;
}

// Frequenz aus steigenden Nulldurchgängen (linear interpoliert) von l[a, b)
double frequenz(const std::vector<float>& l, int64_t a, int64_t b) {
  double erst = -1, letzt = -1;
  int n = 0;
  for (int64_t i = a + 1; i < b; ++i)
    if (l[i - 1] < 0.0f && l[i] >= 0.0f) {
      const double t = static_cast<double>(i - 1) + static_cast<double>(-l[i - 1]) / static_cast<double>(l[i] - l[i - 1]);
      if (erst < 0) erst = t;
      letzt = t;
      ++n;
    }
  return n < 2 ? 0.0 : (n - 1) * 48000.0 / (letzt - erst);
}
double cent(double f, double soll) { return 1200.0 * std::log2(f / soll); }

// Marker einer 125-BPM-Quelle: Beat 0 bei Frame 0, Beat n bei n · 23 040 (zwei Marker, wie der Auto-Warp aus Takten)
Bau& mit_warp(Bau& b, double beats, double versatz = 0.0) {
  return b.warp({0.0 - versatz, beats - versatz}, {0.0, beats * static_cast<double>(FPB)});
}

}  // namespace

int main() {
  {  // 1: AK4 Klick-Loop 125 BPM im 128er Projekt, 64 Beats
    Treiber t;
    auto q = Audio::klicks(66 * FPB, FPB);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 64.0, &q->a);
    t.laden(mit_warp(b, 64.0).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(EINSATZ + 64 * 22500 + 2000);
    PRUEF(t.arr.warp_stimmen() == 0);   // der Clip ist zu Ende
    int daneben = 0;
    for (int k = 0; k < 64; ++k) {
      const int64_t soll = EINSATZ + k * 22500;
      const int64_t ist = spitze_bei(t.l, soll, 8);
      if (std::llabs(ist - soll) > 1 || std::fabs(t.l[ist] - MITTE) > 1e-3) {
        ++daneben;
        std::fprintf(stderr, "Klick %d: ist %lld soll %lld (%.4f)\n", k, (long long)ist, (long long)soll, t.l[ist]);
      }
    }
    PRUEF(daneben == 0);
    // Vorher-Fall: ohne Warp liegt der vierte Klick 2160 Samples (45 ms) hinter dem Raster
    Treiber u;
    auto q2 = Audio::klicks(66 * FPB, FPB);
    u.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 64.0, &q2->a).fertig());
    u.arr.start(0.0, 0, false, 0, V, 256, u.k);
    u.lauf(EINSATZ + 6 * 22500);
    const int64_t ohne = spitze_bei(u.l, EINSATZ + 4 * FPB, 8);
    PRUEF(ohne == EINSATZ + 4 * FPB);
    PRUEF(ohne - (EINSATZ + 4 * 22500) == 2160);
    PRUEF(ohne - (EINSATZ + 4 * 22500) >= 1920);   // ≥ 40 ms
  }
  {  // 2: AK5 Tonhöhe: Sinus 1 kHz, Faktor 23040 / 22500 = 1,024
    Treiber t, u;
    auto q = Audio::sinus(4 * FPB + 4000, 1000.0, 0.5f);   // die Hilfe von 1.10 (arr_bau.h) hat keine Vorgabe für amp
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &q->a);
    t.laden(mit_warp(b, 4.0).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(EINSATZ + 4 * 22500);
    const double f = frequenz(t.l, EINSATZ + 3000, EINSATZ + 4 * 22500 - 3000);
    const double soll = 1200.0 * std::log2(128.0 / 125.0);
    std::printf("Fall 2: %.3f Hz = %+.3f ct (soll %+.3f ct)\n", f, cent(f, 1000.0), soll);
    PRUEF_NAH(cent(f, 1000.0), soll, 0.5);
    u.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &q->a).fertig());
    u.arr.start(0.0, 0, false, 0, V, 256, u.k);
    u.lauf(EINSATZ + 4 * 22500);
    PRUEF_NAH(cent(frequenz(u.l, EINSATZ + 3000, EINSATZ + 4 * 22500 - 3000), 1000.0), 0.0, 0.5);   // Gegenprobe: ungewarpt 1000 Hz
  }
  {  // 3: AK16 Projekttempo 120 (24 000 Samples je Beat): dieselbe Wiedergabe, Länge in Beats gleich
    Treiber t, u;
    t.k.neu(120.0, 0);
    u.k.neu(120.0, 0);
    auto q = Audio::klicks(34 * FPB, FPB);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 32.0, &q->a);
    t.laden(mit_warp(b, 32.0).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(EINSATZ + 32 * 24000 + 1000);
    int daneben = 0;
    for (int k = 0; k < 32; ++k) {
      const int64_t soll = EINSATZ + k * 24000;
      if (std::llabs(spitze_bei(t.l, soll, 8) - soll) > 1) ++daneben;
    }
    PRUEF(daneben == 0);
    PRUEF(t.treffer(EINSATZ + 32 * 24000, EINSATZ + 32 * 24000 + 1000).empty());   // 32 Beats lang, nicht länger (der Klick auf Beat 32 liegt hinter dem Clip)
    u.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 32.0, &q->a).fertig());
    u.arr.start(0.0, 0, false, 0, V, 256, u.k);
    u.lauf(EINSATZ + 8 * 24000);
    PRUEF(spitze_bei(u.l, EINSATZ + 4 * FPB, 8) == EINSATZ + 4 * FPB);   // ungewarpt: vierter Klick bei 4 · 23 040, 3 840 vor dem Raster
    PRUEF(EINSATZ + 4 * 24000 - (EINSATZ + 4 * FPB) == 3840);
  }
  {  // 4: Start auf Beat 6,5 mitten im Clip: nächster Klick (Beat 7) 0,5 Beat nach dem Einsatz, davor Stille
    Treiber t;
    auto q = Audio::klicks(66 * FPB, FPB);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 64.0, &q->a);
    t.laden(mit_warp(b, 64.0).fertig());
    t.arr.start(6.5, 0, false, 0, V, 256, t.k);
    t.lauf(EINSATZ + 3 * 22500);
    PRUEF(spitze_bei(t.l, EINSATZ + 11250, 8) == EINSATZ + 11250);
    PRUEF(spitze_bei(t.l, EINSATZ + 11250 + 22500, 8) == EINSATZ + 11250 + 22500);
    PRUEF(t.treffer(EINSATZ - 100, EINSATZ + 11250 - 8, 1e-3f).empty());
    PRUEF(t.arr.warp_stimmen() == 1);
  }
  {  // 5: Tempo-Rampe 128 → 140 über 4 Beats ab Beat 4: Quellposition = W(Projekt-Beat der Karte), Quelle Rampe (Frame = Wert)
    Treiber t;
    t.k.rampe(4.0, 140.0, 4.0);
    auto q = Audio::rampe(20 * FPB);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 16.0, &q->a);
    t.laden(mit_warp(b, 16.0).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(EINSATZ + 16 * 22500);
    const double b0 = t.k.beat_at(static_cast<double>(EINSATZ));
    int daneben = 0;
    for (int64_t s : {EINSATZ + 1000, EINSATZ + 50000, EINSATZ + 90000, EINSATZ + 100000, EINSATZ + 110000, EINSATZ + 150000, EINSATZ + 300000}) {
      const double soll = (t.k.beat_at(static_cast<double>(s)) - b0) * static_cast<double>(FPB);
      if (std::fabs(t.l[s] / MITTE - soll) > 0.5) {
        ++daneben;
        std::fprintf(stderr, "Fall 5 Sample %lld: ist %.3f soll %.3f\n", (long long)s, t.l[s] / MITTE, soll);
      }
    }
    PRUEF(daneben == 0);
    // die Rampe ist wirklich in der Karte: das Tempo am Ende ist 140
    PRUEF_NAH(t.k.bpm_at(static_cast<double>(EINSATZ + 300000)), 140.0, 1e-9);
  }
  {  // 6: Tausch. A: Quelle Rampe, Frame = b · 23 040; B: derselbe Warp um 1 Beat versetzt (Frame = (b + 1) · 23 040)
    auto wa = [](int64_t t) { return static_cast<double>(t - EINSATZ) / 22500.0 * static_cast<double>(FPB); };
    auto wb = [&](int64_t t) { return wa(t) + static_cast<double>(FPB); };
    Treiber t;
    auto q = Audio::rampe(70 * FPB);
    Bau a;
    a.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 60.0, &q->a);
    t.laden(mit_warp(a, 60.0).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(100000);
    const int64_t s = t.s;
    PRUEF_NAH(t.l[s - 1] / MITTE, wa(s - 1), 0.5);
    Bau b(2);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 60.0, &q->a);
    t.laden(mit_warp(b, 60.0, 1.0).fertig());   // Marker um einen Beat nach links: W_B(b) = W_A(b + 1)
    t.lauf(s + 400);
    // Ausklang des alten Warps (96 Samples, linear) und Einblende des neuen (32 Samples) überlappen
    for (int q2 : {10, 40, 70, 95}) {
      const double alt = wa(s + q2) * (96.0 - q2) / 96.0;
      const double neu = wb(s + q2) * std::min(1.0, q2 / 32.0);
      PRUEF_NAH(t.l[s + q2] / MITTE, alt + neu, 0.5);
    }
    PRUEF_NAH(t.l[s + 200] / MITTE, wb(s + 200), 0.5);   // danach nur noch der neue Warp
    PRUEF(t.arr.warp_stimmen() == 1);
    // unveränderter Warp (neuer Schnappschuss, gleiche Marker): bindet ohne Blende neu, die Ausgabe läuft ununterbrochen weiter
    Treiber u;
    auto q3 = Audio::rampe(70 * FPB);
    Bau c;
    c.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 60.0, &q3->a);
    u.laden(mit_warp(c, 60.0).fertig());
    u.arr.start(0.0, 0, false, 0, V, 256, u.k);
    u.lauf(100000);
    const int64_t s2 = u.s;
    Bau d(2);
    d.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 60.0, &q3->a);
    u.laden(mit_warp(d, 60.0).fertig());
    u.lauf(s2 + 400);
    for (int q2 : {0, 5, 40, 120})
      PRUEF_NAH(u.l[s2 + q2] / MITTE, wa(s2 + q2), 0.5);
  }
  {  // 7: Warp mit Steigung 1 (Beat n bei Frame n · 22 500) = ungewarpt: Gains, Fades, Naht, Einstieg, Stopp. Quelle konstant 0,5
    auto lauf = [](bool warp, int fall) {
      Treiber t;
      auto q = Audio::gleich(300000);
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &q->a, 0, 0.8f, 0.5, 0.5);
      if (warp) b.warp({0.0, 4.0}, {0.0, 90000.0});
      t.laden(b.fertig());
      if (fall == 1) {                // Naht: Loop 0..4, Start auf den Takt
        t.arr.loop(true, 0.0, 4.0, t.s, t.k);
        t.arr.start(0.0, 2, false, 0, V, 256, t.k);
        t.lauf(185000);
      } else if (fall == 2) {         // Einstieg mitten im Clip (Beat 1)
        t.arr.start(1.0, 0, false, 0, V, 256, t.k);
        t.lauf(70000);
      } else {                        // Stopp mitten im Clip
        t.arr.start(0.0, 0, false, 0, V, 256, t.k);
        t.lauf(30000);
        t.arr.stopp(0, t.s, t.k);
        t.lauf(31000);
      }
      return t.l;
    };
    for (int fall = 0; fall < 3; ++fall) {
      const std::vector<float> a = lauf(false, fall), w = lauf(true, fall);
      PRUEF(a.size() == w.size());
      double groesst = 0.0, summe = 0.0;
      for (size_t i = 0; i < a.size() && i < w.size(); ++i) {
        groesst = std::max(groesst, std::fabs(static_cast<double>(a[i]) - static_cast<double>(w[i])));
        summe += std::fabs(a[i]);
      }
      std::printf("Fall 7.%d: größte Abweichung %.3g, Summe |l| %.1f\n", fall, groesst, summe);
      PRUEF(summe > 1000.0);   // nicht beide still
      PRUEF(groesst <= 1e-6);
    }
  }
  {  // 8: Blockgröße ist kein Parameter des Klangs. Quelle Rampe; Einsatz bei V + n, darum gegen den Einsatz ausgerichtet verglichen
    std::vector<std::vector<float>> ausgabe;
    for (int n : {97, 256, 1024}) {
      Treiber t;
      t.n = n;
      auto q = Audio::rampe(30 * FPB);
      Bau b;
      b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a, 0, 1.0f, 0.25, 0.25);
      t.laden(mit_warp(b, 8.0).fertig());
      t.arr.start(0.0, 0, false, 0, V, n, t.k);
      t.lauf(V + n + 8 * 22500 + 5000);
      ausgabe.emplace_back(t.l.begin() + (V + n), t.l.begin() + (V + n) + 8 * 22500);
    }
    double groesst = 0.0;
    for (size_t i = 0; i < ausgabe[0].size(); ++i)
      for (int k = 1; k < 3; ++k) groesst = std::max(groesst, std::fabs(static_cast<double>(ausgabe[0][i]) - static_cast<double>(ausgabe[k][i])));
    std::printf("Fall 8: größte Abweichung 97/256/1024 %.3g\n", groesst);
    PRUEF(groesst <= 1e-3);
    PRUEF(*std::max_element(ausgabe[0].begin(), ausgabe[0].end()) > 1000.0f);
  }
  {  // 9: Ende der Datei und Anfang der Datei
    Treiber t;
    auto q = Audio::gleich(30000);   // 30 000 Frames; der Clip ist 4 Beats = 90 000 Samples lang, Steigung 1 (22 500 Frames je Beat)
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 4.0, &q->a).warp({0.0, 4.0}, {0.0, 90000.0}).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(EINSATZ + 40000);
    PRUEF_NAH(t.l[EINSATZ + 29000], 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.l[EINSATZ + 30001], 0.0, 0.0);
    PRUEF(t.arr.warp_stimmen() == 0);   // die Stimme ist mit der Datei zu Ende, nicht erst mit dem Clip
    // vor dem Anfang: Marker bei Beat 2 auf Frame 0 (Quelle beginnt erst bei Beat 2 des Clips), weiter unten ein Frame je Sample
    Treiber u;
    auto r = Audio::rampe(10 * FPB);
    u.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 6.0, &r->a).warp({2.0, 6.0}, {0.0, 4.0 * 22500.0}).fertig());
    u.arr.start(0.0, 0, false, 0, V, 256, u.k);
    u.lauf(EINSATZ + 6 * 22500);
    for (int64_t s : {EINSATZ + 100, EINSATZ + 30000, EINSATZ + 44990}) PRUEF_NAH(u.l[s], 0.0, 0.0);   // Beat < 2 − 2 Frames: Stille
    PRUEF_NAH(u.l[EINSATZ + 2 * 22500 + 1000] / MITTE, 1000.0, 0.05);   // Beat 2 + 1000 Samples = Frame 1000
  }
  {  // 10: Loop-Naht eines gewarpten Clips absolut (nicht nur gegen den ungewarpten Weg): die letzten 96 Samples vor der Naht blenden
     // linear aus, der neue Durchlauf setzt voll ein (wie test_arr_clips Fall 6; Naht bei 180 000: Start auf den Takt, Einsatz 90 000)
    Treiber t;
    auto q = Audio::gleich(400000);
    t.laden(Bau().spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &q->a).warp({0.0, 8.0}, {0.0, 180000.0}).fertig());
    t.arr.loop(true, 0.0, 4.0, t.s, t.k);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(181000);
    PRUEF_NAH(t.l[179904], 0.5 * MITTE, 1e-6);
    PRUEF_NAH(t.l[179952], 0.5 * 48.0 / 96.0 * MITTE, 1e-6);
    PRUEF_NAH(t.l[179999], 0.5 / 96.0 * MITTE, 1e-6);
    PRUEF_NAH(t.l[180000], 0.5 * MITTE, 1e-6);
    PRUEF(t.arr.warp_stimmen() == 1);
  }
  {  // 11: Neustart beim Spielen. Arrangement::start() blendet die alten Stimmen aus (ab_aus = s, 96 Samples) und setzt im selben Aufruf
     // ursprung_ und start_beat_ neu; die ausblendende Stimme muss an ihrer alten Abbildung weiterlesen (kein Sprung der Quellstelle,
     // kein Knack). Quelle Rampe (Frame = Wert), Gain 1. Ohne Korrektur liest sie bei s etwa Frame 183 500 statt 101 700 (Beat 7,96 statt 4,41)
    auto wa = [](int64_t t) { return static_cast<double>(t - EINSATZ) / 22500.0 * static_cast<double>(FPB); };
    Treiber t;
    auto q = Audio::rampe(70 * FPB);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 60.0, &q->a);
    t.laden(mit_warp(b, 60.0).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(100000);
    const int64_t s = t.s;
    PRUEF_NAH(t.l[s - 1] / MITTE, wa(s - 1), 0.5);
    t.arr.start(8.0, 0, false, s, V, 256, t.k);   // Neustart auf Beat 8 mitten im Spiel: der neue Einsatz liegt frühestens bei s + V + 256
    t.lauf(s + 2200);
    for (int q2 : {0, 10, 40, 70, 95}) {
      const double soll = wa(s + q2) * (96.0 - q2) / 96.0;   // die alte Abbildung läuft weiter, linear ausgeblendet
      if (std::fabs(t.l[s + q2] / MITTE - soll) > 0.5)
        std::fprintf(stderr, "Fall 11 q=%d: ist %.1f soll %.1f\n", q2, t.l[s + q2] / MITTE, soll);
      PRUEF_NAH(t.l[s + q2] / MITTE, soll, 0.5);
    }
    const int64_t neu = s + V + 256;
    PRUEF(t.treffer(s + 96, neu - 8, 1e-3f).empty());   // zwischen Ausblende und neuem Einsatz still
    PRUEF_NAH(t.l[neu + 1000] / MITTE, 8.0 * static_cast<double>(FPB) + 1000.0 * static_cast<double>(FPB) / 22500.0, 0.5);   // neu: Beat 8 ist Frame 8 · FPB
    PRUEF(t.arr.warp_stimmen() == 1);
  }
  {  // 12: Neustart beim Spielen und, noch innerhalb der 96 Samples Ausblende, ein Tausch, der den Clip entfernt (Prüfung 2, MINOR 2).
     // Blockgröße 32: nach dem Neustart sind 32 der 96 Samples Ausblende gespielt, dann kopiert `stimme_ausklang` die übrigen 64 aus dem alten Audio.
     // Die Kopie muss an der alten Abbildung weiterlesen; ohne die Korrektur liest sie mit dem neuen Ursprung (Frame 183 500 statt 101 700). Fall 11 deckt nur den Spielweg.
     // Der Verlauf der Hüllkurve: Ausblende des Neustarts (96 − (32 + q)) / 96 mal Ausklang-Rampe (96 − q) / 96 mal die Quellstelle.
    auto wa = [](int64_t t) { return static_cast<double>(t - EINSATZ) / 22500.0 * static_cast<double>(FPB); };
    Treiber t;
    t.n = 32;
    auto q = Audio::rampe(70 * FPB);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 60.0, &q->a);
    t.laden(mit_warp(b, 60.0).fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(100000);   // 100 000 = 3125 · 32: der Neustart liegt auf einer Blockgrenze
    const int64_t s = t.s;
    PRUEF(s == 100000);
    t.arr.start(8.0, 0, false, s, V, 256, t.k);
    t.lauf(s + 32);
    t.laden(Bau(2).spur(1, ArrArt::audio).fertig());   // der Clip fällt weg: Ausklang aus der eigenen Kopie
    t.lauf(s + 400);
    for (int q2 : {0, 10, 31, 63}) {
      const int64_t u = s + 32 + q2;
      const double soll = wa(u) * (96.0 - (32 + q2)) / 96.0 * (96.0 - q2) / 96.0;
      if (std::fabs(t.l[u] / MITTE - soll) > 0.5)
        std::fprintf(stderr, "Fall 12 q=%d: ist %.1f soll %.1f\n", q2, t.l[u] / MITTE, soll);
      PRUEF_NAH(t.l[u] / MITTE, soll, 0.5);
    }
    PRUEF(t.treffer(s + 96, s + 400, 1e-3f).empty());   // nach den 96 Samples still: kein neuer Einsatz, kein Rest
    PRUEF(t.arr.warp_stimmen() == 0);
  }
  PRUEF_ENDE();
}
