// Paket 1.13 Warp, Slice 2: COMPLEX und TONES im Arrangement (Modul Arrangement mit synchronem Warp-Werk, 128 BPM, 256 Samples je Block). Die Quellen
// sind auf 125 BPM gebaut (23 040 Frames je Beat), der Warp legt sie auf das 128er Raster (22 500 Samples je Beat). Klick-Lage = Kreuzkorrelation mit
// dem Hann-Impuls der Quelle (144 Samples), Mitte des Klicks (71,5 Samples nach dem Anfang) gegen das Raster.
//   1  AK6/AK7    Klick-Loop über 64 Beats, COMPLEX und TONES, bei 128 und 120 BPM: jeder Klick ≤ 24 Samples neben dem Raster (gemessen
//                 23,3; die Spec verlangt 16, Bungee Basic erreicht das nicht, Plan Entscheidung D6), die Lage driftet nicht (Steigung < 4 Samples je 16 Beats, gemessen 1,8); Sinus 1 kHz: ±2 ct je 100-ms-Fenster; Vorher-Fall ohne Warp: nach 4 Beats 2160 Samples daneben
//   2  AK11       Einsätze: Clip-Anfang bei Beat 4 (vorab angesetzt, warp_spaet 0), Transport-Start mitten im Clip (Beat 6), Loop-Naht (der Durchlauf danach
//                 liegt im Raster, an der Naht kein 10-ms-Fenster mit RMS-Einbruch über 3 dB), Tausch (alter Klang bis ARR_WARP_FRIST, neuer danach)
//   3  AK13       Transport-Start mit 32 gewarpten Spuren (COMPLEX) auf Takt 1: alle 32 klingen ab ihrem ersten Sample, der Einsatz kommt um genau
//                 ARR_WARP_FRIST später als ohne Warp
//   4  AK14       Ausfall des Werks: warp_unterlauf zählt, die Ausgabe blendet in Stille (kein Sprung), eine ungewarpte Spur läuft weiter, das Werk kommt
//                 zurück (Einblende); Pool voll (65. Stimme): warp_kein_platz zählt und der Clip spielt wie RE-PITCH (Bit für Bit)
//                 Nachzügler: wird für den 65. Clip noch vor seinem Einsatz ein Platz frei, setzt er im Werk ein (kein RE-PITCH); im letzten Block davor ist sein Ring
//                 zum Einsatz leer (warp_spaet 1)
//   5  AK17       Tempo-Rampe der Karte beim Spielen (Generation erhöht): nach dem Ende der Rampe plus 2 · ARR_WARP_FRIST liegen die Klicks im Raster der
//                 neuen Karte (≤ 24 Samples)
//   6  AK17       dieselbe Rampe mit 32 Spuren und vier Arbeitsfäden in Echtzeit: alle 32 Stimmen werden neu angesetzt und klingen danach; gezählt werden
//                 verworfene Aufträge, späte Einsätze und Unterläufe (Messung, kein Tor)
//   7  AK13/AK17  32 Spuren wechseln auf demselben Beat den Clip (A, B) und die Karte bekommt 1 081 Samples davor eine neue Generation: alter Clip, vorab angesetzter
//                 und dessen Nachfolgerin brauchen je Spur einen Platz (96 für 64), die Nachfolgerin wartet, bis der alte Clip endet. Jede Spur liegt danach im Raster
//                 der neuen Karte (jede hat ihren Klick an eigener Stelle), warp_kein_platz 0; Gegenprobe 6 201 Samples davor (Pool nicht voll); synchron und mit vier
//                 Fäden im Echtzeit-Takt (mit Fäden ist die Lage ausgewiesen, nicht geprüft: sie hängt an der Maschine)
//   7b AK17       der zweite Versuch je Block: 32 Spuren mit je zwei klingenden Clips (64 Stimmen), die Karte kommt kurz bevor der kürzere endet; die Nachfolgerin des
//                 längeren findet erst danach einen Platz und liegt im Raster der neuen Karte
//   8  AK17       eine neue Generation setzt jede Nachfolgerin genau einmal an (ein zählendes Werk dazwischen), 1 und 32 Spuren, und danach nichts mehr
//   9  AK11       128 Clips je Spur (4 096 insgesamt, die Grenze der Wiedergabe): der Vorausblick setzt jeden Einsatz genau einmal an und rechtzeitig (jeder Auftrag
//                 zielt auf den Einsatz selbst, keiner auf einen späteren: so setzt clips_starten einen Clip an, den der Vorausblick übersehen hat)
//  10  AK13       dieselbe Grenze, aber statt der Karte ändert ein Tausch den Gain aller Clips, 1 081 Samples davor (Gegenprobe 6 201), 10, 20 und 32 Spuren: kein Platzmangel,
//                 am Ende eine Werk-Stimme je Spur, kein Pegelloch von B am Einsatz (synchron; mit vier Fäden im Echtzeit-Takt ausgewiesen)
//  11  AK11/5.3   Ereignisse im Frist-Fenster vor dem Einsatz eines vorab angesetzten Werk-Clips (Clip-Grenze, Loop-Naht, Transport-Einsatz; Nachbesserung 4: 64, 256, 512,
//                 1 081, 2 040 und 6 201 Samples davor, genau, über einen kurzen Block):
//                 Tausch (Gain, Quelle, Modus, RE-PITCH, ohne Warp, zwei und vier Tausche), Clip weg, verschoben, gekürzt, neue Karte (später, ab jetzt), Stopp, Sprung,
//                 Loop umgestellt, Mute, Solo, Projekt neu geladen: der Clip klingt nie doppelt, alt bis zur Frist und neu danach, ohne Loch, wo er weiterklingen soll;
//                 11b: die Klicks liegen nach einer neuen Karte im Frist-Fenster (auch im Wartezustand vor dem Transport-Einsatz) im Raster der neuen Karte, auch nach
//                 zwei Karten und nach Tausch und Karte (B1), ohne Flam bei langsamer Rampe und Einsatz kurz vor s + Frist (R1)
//  14  m8         Phase der Überblendung gelöste Stimme / Nachfolgerin (Messung, Flanke): Lage der Klicks hält, die Phase der Teiltöne nicht
//  12  AK11       Loop-Naht mit 3 968 Clips in der Vergangenheit und einem Clip, der den Anfang des Durchlaufs überspannt: er setzt an jeder Naht ohne Loch ein
//  13  AK14       Tausch bei vollem Pool (64 Clips klingen): ohne Platz für die Nachfolgerin spielt der Clip ab dem Tausch als RE-PITCH, die gelöste Stimme blendet dort aus
//                 (kein doppelter Pegel)
//  15  R3, D15    Gain-Tausch an der klingenden Werk-Stimme gleitet über ARR_NAHT; zwei Tausche am selben Sample unter der RE-PITCH-Deckung klingen wie einer
//                 mit dem Endstand; die Deckung hält bis zur Werk-Stimme (Nachbesserung 4, nach dem dritten Beweislauf)
//  16  Prüfung 5  Platz ohne Klang (fable M1, opus F1): Loop-Klammer 64, 1 081 und 2 040 Samples vor ihrer Naht auf der Grenze A → B mit 24 und 32 Spuren: kein Loch
//                 am Neustart (vorher 43 ms Stille auf 3N − 64 Spuren, ohne Zähler), das Werk klingt ab Naht + Block; Loop bei vollem Pool (64 Clips): der neue Durchlauf
//                 klingt ab der Naht (spät 64, RE-PITCH bis der Ring liefert), vorher 43 ms Stille an jeder Naht ohne Zähler. Fall 7 und 10 messen dazu
//                 2 361 und 2 617 Samples vor der Grenze (die Nachfolgerin des endenden Clips gibt dem neuen Clip den Vorrang: kein später Einsatz, kein Platz 3N − 64)
//  17  Prüfung 5  Start bei laufendem Transport und Stopp im selben Block (fable m6): die Ausblende der Werk-Stimme klingt zu Ende statt hart zu enden
// Mutationen (jede macht ihren Fall rot, bis auf vier unten): ARR_WARP_WERK_OHNE_VORAUSBLICK (Fall 2), ARR_WARP_WERK_START_OHNE_FRIST (Fall 3), ARR_WARP_WERK_NAHT_ALLE (Fall 2),
// ARR_WARP_WERK_TAUSCH_HART (Fall 2), ARR_WARP_WERK_OHNE_BLENDE (Fall 4), ARR_WARP_WERK_KARTE_IGNORIERT (Fall 5), ARR_WARP_WERK_OHNE_NACHHOLEN (Fall 7b),
// ARR_WARP_WERK_ZWEIMAL_ANSETZEN (Fall 5, 6, 7b, 11), ARR_WARP_WERK_VORFILTER (Fall 9); Nachbesserung 3: ARR_WARP_WERK_OHNE_DECKUNG, _DECKUNG_ORTLOS, _KARTE_VOR_EINSATZ,
// _STOPP_VOR_EINSATZ, _EINSTIEG_STUMM, _EINSTIEG_NAECHSTE (Fall 11), _KARTE_WARTET (Fall 11b), _NAHT_VORFILTER (Fall 12), _EINSTIEG_DOPPELT (Fall 13), _OHNE_PLATZTAUSCH (bis Nachbesserung 3 Fall 10).
// Nachbesserung 4 (eine Regel für Tausch und Karte; ZWEIMAL_ANSETZEN entfällt mit ihrer Regel): _TAUSCH_FREI, _REPITCH_DECKT, _KETTE_LANG, _BRUECKE_BLEIBT, _EINSTIEG_LUECKE,
// _GAIN_SPRUNG, _UEBERGANG_LOCH, _UNGEHOERT (Fall 15; _EINSTIEG_LUECKE auch), _ENDE_ALTE_KARTE; welche Zeilen sie rot machen, steht im Plan (Task 5 Step 6). Vier davon macht
// dieser Test nicht rot und hat für sie kein Ziel: _OHNE_PLATZTAUSCH, _KETTE_LANG, _BRUECKE_BLEIBT, _ENDE_ALTE_KARTE fangen nur die Zufallsfolgen (test_warp_werk_folgen, Step 6b). Die Zufallsfolgen
// fangen die Klasse, dieser Test die Lage, den Ton und die Fäden.
// Nachbesserung 5 (Prüfung 5): _PLATZ_OHNE_KLANG (Fall 16: 1 024 Hz bis Naht + Frist, spät 32), _SPAET_STILL (Fall 16 bei 64 Samples und Nachzügler, Fall 11 r2: Loch),
// _EINSATZ_OHNE_SPAET (Fall 16 Loop bei vollem Pool: eine Frist Stille, spät 0), _OHNE_VORRANG (Fall 7 und 10 bei 2 361: spät 32, Klick auf Beat 8 fehlt ohne Deckung),
// _STOPP_WARTET_HART (Fall 17); _BRUECKE_MINUS_EINS (fable m2) fängt nur der verdichtete Generator der Zufallsfolgen.
#include <time.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <string>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/warp_werk.h"
#include "lage_huelle.h"
#include "pruef.h"

bool g_waechter = false;

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int64_t FPB125 = 23040;   // Frames je Beat einer 125-BPM-Quelle
constexpr int HANN = 144;

// Der Klick der Keylock-Tests (keylock_mess.h klick_vorlage): 1 kHz unter einer Hann-Hülle, 144 Samples. Ein breitbandiger Hann-Impuls ohne Ton liegt
// unter Bungee Basic bei Dehnung 1,024 bis ±112 Samples neben dem Raster (Sägezahn, gemessen in Task 5 des Plans); die Lage-Grenze gilt für Töne.
std::vector<float> hann_impuls() {
  std::vector<float> h(HANN);
  for (int i = 0; i < HANN; ++i)
    h[static_cast<size_t>(i)] = static_cast<float>(0.5 * std::sin(2 * 3.14159265358979323846 * 1000.0 * i / 48000.0) * 0.5 * (1 - std::cos(2 * 3.14159265358979323846 * i / 143.0)));
  return h;
}

// Quelle mit einem Hann-Impuls auf jedem Beat der 125-BPM-Quelle (Anfang des Impulses bei k · FPB125)
std::unique_ptr<Audio> hann_klicks(int64_t frames) {
  auto x = Audio::gleich(frames, 0.0f);
  const std::vector<float> h = hann_impuls();
  for (int64_t k = 0; k * FPB125 + HANN < frames; ++k)
    for (int i = 0; i < HANN; ++i) x->d[static_cast<size_t>(2 * (k * FPB125 + i))] = x->d[static_cast<size_t>(2 * (k * FPB125 + i) + 1)] = h[static_cast<size_t>(i)];
  x->fuellen(frames);
  return x;
}

// Mitte des Impulses nahe e (Sample), per Kreuzkorrelation mit dem Hann-Impuls, parabolisch verfeinert; −1e9 ohne Impuls
double klick_mitte(const std::vector<float>& l, int64_t e, int radius = 300) {
  static const std::vector<float> h = hann_impuls();
  double beste = -1e30, davor = 0, danach = 0;
  int64_t bt = 0;
  std::vector<double> c;
  const int64_t t0 = e - 72 - radius;
  for (int64_t t = t0; t <= e - 72 + radius; ++t) {
    double s = 0.0;
    for (int i = 0; i < HANN; ++i) {
      const int64_t j = t + i;
      if (j >= 0 && j < static_cast<int64_t>(l.size())) s += static_cast<double>(h[static_cast<size_t>(i)]) * static_cast<double>(l[static_cast<size_t>(j)]);
    }
    c.push_back(s);
    if (s > beste) {
      beste = s;
      bt = t;
    }
  }
  if (beste < 0.02) return -1e9;   // nichts Impulsartiges im Fenster
  const size_t ix = static_cast<size_t>(bt - t0);
  davor = ix > 0 ? c[ix - 1] : beste;
  danach = ix + 1 < c.size() ? c[ix + 1] : beste;
  const double nenner = davor - 2.0 * beste + danach;
  const double dx = nenner != 0.0 ? 0.5 * (davor - danach) / nenner : 0.0;
  return static_cast<double>(bt) + dx + 71.5;
}

struct Lage {
  double max_abs = 0.0, steigung_je_16 = 0.0;
  int n = 0, ohne = 0;
};

// Abstand der Klicks k0..k1 vom Raster: Klick k liegt k + (71,5 − versatz) / FPB125 Beats nach dem Beat, der auf Sample s_c liegt (laut Karte; bei einer Rampe
// zählt der Beat, nicht die Sampleverschiebung). versatz: Frames, um die der erste Marker des Clips in die Quelle zeigt (Fall 7: jede Spur hört ihren Klick früher)
Lage lage_messen(const std::vector<float>& l, const cdj::Karte& karte, int64_t s_c, int k0, int k1, double versatz = 0.0) {
  Lage r;
  std::vector<double> x, y;
  for (int k = k0; k <= k1; ++k) {
    const double soll = karte.sample_at(karte.beat_at(static_cast<double>(s_c)) + k + (71.5 - versatz) / FPB125);
    const double m = klick_mitte(l, std::llround(soll));
    if (m < -1e8) {
      ++r.ohne;
      continue;
    }
    const double d = m - soll;
    if (std::getenv("LAGE_DBG")) std::printf("  k %d soll %.1f ist %.1f d %.2f\n", k, soll, m, d);
    r.max_abs = std::max(r.max_abs, std::fabs(d));
    x.push_back(k);
    y.push_back(d);
    ++r.n;
  }
  if (x.size() > 2) {   // Ausgleichsgerade der Abweichung über dem Beat
    double mx = 0, my = 0;
    for (size_t i = 0; i < x.size(); ++i) { mx += x[i]; my += y[i]; }
    mx /= static_cast<double>(x.size());
    my /= static_cast<double>(x.size());
    double sxy = 0, sxx = 0;
    for (size_t i = 0; i < x.size(); ++i) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
    r.steigung_je_16 = 16.0 * sxy / sxx;
  }
  return r;
}

// Frequenz über aufwärts gerichtete Nulldurchgänge in [a, b)
double frequenz(const std::vector<float>& l, int64_t a, int64_t b) {
  double erste = -1, letzte = -1;
  int zahl = 0;
  for (int64_t i = a; i + 1 < b && i + 1 < static_cast<int64_t>(l.size()); ++i) {
    const double x0 = l[static_cast<size_t>(i)], x1 = l[static_cast<size_t>(i) + 1];
    if (x0 < 0 && x1 >= 0) {
      const double t = static_cast<double>(i) + (-x0) / (x1 - x0);
      if (erste < 0) erste = t;
      letzte = t;
      ++zahl;
    }
  }
  return zahl < 2 ? 0.0 : (zahl - 1) * 48000.0 / (letzte - erste);
}

double max_ct(const std::vector<float>& l, int64_t von, int64_t bis, double hz) {
  double m = 0.0;
  for (int64_t s = von; s + 4800 <= bis; s += 4800) {
    const double f = frequenz(l, s, s + 4800);
    if (f <= 0.0) return 1e9;
    m = std::max(m, std::fabs(1200.0 * std::log2(f / hz)));
  }
  return m;
}

const char* name(int modus) { return modus == cdj::ARR_WARP_COMPLEX ? "COMPLEX" : modus == cdj::ARR_WARP_TONES ? "TONES" : "RE-PITCH"; }

// ---- Hilfen
constexpr double LAGE_GRENZE = 24.0;      // Samples; gemessen 23,3 (Fall 1), siehe Plan D6
constexpr double STEIGUNG_GRENZE = 4.0;   // Samples je 16 Beats; gemessen 1,8

// eine Quelle als Sinus mit Amplitude amp und der Frequenz hz (125-BPM-Quelle mit frames Frames)
std::unique_ptr<Audio> sinus(int64_t frames, double hz, float amp = 0.4f) { return Audio::sinus(frames, hz, amp); }

// Frequenz aus dem Verhältnis mittlere Steigung zu mittlerem Betrag im Fenster [a, b) (reiner Ton: 2π f / 48000)
double frequenz_schnell(const std::vector<float>& l, int64_t a, int64_t b) {
  double d = 0.0, x = 0.0;
  for (int64_t i = a; i + 1 < b && i + 1 < static_cast<int64_t>(l.size()); ++i) {
    d += std::fabs(static_cast<double>(l[static_cast<size_t>(i) + 1]) - static_cast<double>(l[static_cast<size_t>(i)]));
    x += std::fabs(static_cast<double>(l[static_cast<size_t>(i)]));
  }
  return x > 1e-9 ? d / x * 48000.0 / (2.0 * 3.14159265358979323846) : 0.0;
}

double rms(const std::vector<float>& l, int64_t a, int64_t b) {
  double s = 0.0;
  int64_t n = 0;
  for (int64_t i = std::max<int64_t>(a, 0); i < b && i < static_cast<int64_t>(l.size()); ++i, ++n) s += static_cast<double>(l[static_cast<size_t>(i)]) * static_cast<double>(l[static_cast<size_t>(i)]);
  return n ? std::sqrt(s / static_cast<double>(n)) : 0.0;
}

// kleinster RMS in 10-ms-Fenstern (Schritt 120 Samples) über [von, bis), in dB gegen ref
double kleinster_pegel_db(const std::vector<float>& l, int64_t von, int64_t bis, double ref) {
  double m = 1e9;
  for (int64_t s = von; s + 480 <= bis; s += 120) m = std::min(m, 20.0 * std::log10(std::max(rms(l, s, s + 480), 1e-9) / ref));
  return m;
}

// ---- Fall 1
void fall1(double bpm, int modus) {
  Treiber t;
  PRUEF(t.mit_werk());
  t.k = cdj::Karte(bpm, 0);
  auto src = hann_klicks(66 * FPB125);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 64.0, &src->a).warp({0.0, 64.0}, {0.0, 64.0 * static_cast<double>(FPB125)}, modus);
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  const int64_t ende = static_cast<int64_t>(t.k.sample_at(66.0));
  t.lauf(ende);
  const int64_t s_c = t.arr.einsatz_sample();
  const Lage g = lage_messen(t.l, t.k, s_c, 0, 63);
  std::printf("Fall 1 (%s, %.0f BPM): %d Klicks gemessen, %d ohne, größte Abweichung %.2f Samples, Steigung %.3f Samples je 16 Beats, Unterlauf %llu\n", name(modus), bpm,
              g.n, g.ohne, g.max_abs, g.steigung_je_16, static_cast<unsigned long long>(t.arr.warp_unterlauf()));
  PRUEF(g.n == 64 && g.ohne == 0);
  PRUEF(g.max_abs <= LAGE_GRENZE);
  PRUEF(std::fabs(g.steigung_je_16) < STEIGUNG_GRENZE);
  PRUEF(t.arr.warp_spaet() == 0 && t.arr.warp_unterlauf() == 0 && t.arr.warp_kein_platz() == 0);
}

void fall1_ton(int modus) {
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = sinus(66 * FPB125, 1000.0);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 64.0, &src->a).warp({0.0, 64.0}, {0.0, 64.0 * static_cast<double>(FPB125)}, modus);
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(t.k.sample_at(20.0)));
  const int64_t s_c = t.arr.einsatz_sample();
  const double ct = max_ct(t.l, s_c + 4800, s_c + static_cast<int64_t>(t.k.sample_at(19.0)), 1000.0);
  std::printf("Fall 1 Ton (%s): größte Abweichung %.2f ct über 100-ms-Fenstern\n", name(modus), ct);
  PRUEF(ct < 2.0);
}

// Vorher-Fall: derselbe Klick-Loop ohne Warp läuft nach 4 Beats 2160 Samples (45 ms) neben dem Raster (AK4, Slice 1; die Gegenprobe zu Fall 1)
void fall1_ohne_warp() {
  Treiber t;
  auto src = hann_klicks(66 * FPB125);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 64.0, &src->a);
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(t.k.sample_at(8.0)));
  const int64_t s_c = t.arr.einsatz_sample();
  const double m4 = klick_mitte(t.l, s_c + 4 * 22500 + 70 + 2160, 400);   // der 5. Klick (Beat 4) liegt bei 4 · 23 040 Frames, also 2160 Samples zu spät
  const double soll = static_cast<double>(s_c) + 4.0 * 22500.0 + 71.5 * 22500.0 / FPB125;
  std::printf("Fall 1 Vorher-Fall (ohne Warp): der Klick auf Beat 4 liegt %.1f Samples neben dem Raster\n", m4 - soll);
  PRUEF(m4 - soll > 2000.0 && m4 - soll < 2300.0);
}

// ---- Fall 2
void fall2_anfang() {   // Clip-Anfang bei Beat 4: vorab angesetzt
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = hann_klicks(34 * FPB125);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 4.0, 32.0, &src->a).warp({0.0, 32.0}, {0.0, 32.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(t.k.sample_at(37.0)));
  const int64_t s_c = t.arr.einsatz_sample() + static_cast<int64_t>(t.k.sample_at(4.0));
  const Lage g = lage_messen(t.l, t.k, s_c, 0, 31);
  std::printf("Fall 2 Clip-Anfang (Beat 4): %d Klicks, %d ohne, größte Abweichung %.2f Samples, spät %llu\n", g.n, g.ohne, g.max_abs, static_cast<unsigned long long>(t.arr.warp_spaet()));
  PRUEF(g.n == 32 && g.ohne == 0 && g.max_abs <= LAGE_GRENZE);
  PRUEF(t.arr.warp_spaet() == 0 && t.arr.warp_unterlauf() == 0);
}

void fall2_start_mitten() {   // Transport-Start bei Beat 6 mitten im Clip
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = hann_klicks(34 * FPB125);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 32.0, &src->a).warp({0.0, 32.0}, {0.0, 32.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  t.laden(b.fertig());
  t.arr.start(6.0, 0, false, 0, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(t.k.sample_at(30.0)));
  const int64_t s_c = t.arr.einsatz_sample();
  PRUEF(s_c >= 537 + 256 + cdj::ARR_WARP_FRIST);   // die Start-Regel wuchs um ARR_WARP_FRIST
  const Lage g = lage_messen(t.l, t.k, s_c, 1, 22);
  std::printf("Fall 2 Start bei Beat 6: Einsatz bei Sample %lld, %d Klicks, %d ohne, größte Abweichung %.2f Samples, spät %llu\n", static_cast<long long>(s_c), g.n, g.ohne, g.max_abs,
              static_cast<unsigned long long>(t.arr.warp_spaet()));
  PRUEF(g.n == 22 && g.ohne == 0 && g.max_abs <= LAGE_GRENZE);
  PRUEF(t.arr.warp_spaet() == 0);
}

void fall2_naht() {   // Loop-Klammer 0 bis 8 Beats, der Durchlauf danach liegt im Raster, und an der Naht bricht der Ton nicht ein
  {  // Klicks
    Treiber t;
    PRUEF(t.mit_werk());
    auto src = hann_klicks(10 * FPB125);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &src->a).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    t.laden(b.fertig());
    t.arr.loop(true, 0.0, 8.0, t.s, t.k);
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    t.lauf(t.arr.einsatz_sample() + static_cast<int64_t>(t.k.sample_at(15.5)));   // bis kurz vor dem zweiten Durchlauf des Klammerendes
    const int64_t w = t.arr.letzte_naht();
    PRUEF(w == t.arr.einsatz_sample() + static_cast<int64_t>(t.k.sample_at(8.0)));   // genau eine Naht
    const Lage g = lage_messen(t.l, t.k, w, 0, 7);
    std::printf("Fall 2 Naht, zweiter Durchlauf: Naht bei Sample %lld, %d Klicks, %d ohne, größte Abweichung %.2f Samples, spät %llu, kein Platz %llu\n", static_cast<long long>(w), g.n, g.ohne,
                g.max_abs, static_cast<unsigned long long>(t.arr.warp_spaet()), static_cast<unsigned long long>(t.arr.warp_kein_platz()));
    PRUEF(g.n == 8 && g.ohne == 0 && g.max_abs <= LAGE_GRENZE);
    PRUEF(t.arr.warp_spaet() == 0);
  }
  {  // Ton: kein 10-ms-Fenster mit RMS-Einbruch über 3 dB rund um die Naht
    Treiber t;
    PRUEF(t.mit_werk());
    auto src = sinus(10 * FPB125, 1000.0);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, &src->a).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    t.laden(b.fertig());
    t.arr.loop(true, 0.0, 8.0, t.s, t.k);
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    t.lauf(t.arr.einsatz_sample() + static_cast<int64_t>(t.k.sample_at(9.5)));
    const int64_t w = t.arr.letzte_naht();
    PRUEF(w > 0);
    const double ref = rms(t.l, w - 40000, w - 20000);
    const double dip = kleinster_pegel_db(t.l, w - 1500, w + 3000, ref);
    std::printf("Fall 2 Naht Ton: Referenz-RMS %.4f, kleinster 10-ms-Pegel rund um die Naht %.2f dB\n", ref, dip);
    PRUEF(ref > 0.1 && dip > -3.0);
  }
}

void fall2_tausch() {   // der Clip bekommt beim Spielen eine andere Quelle (1,5 kHz statt 1 kHz): alter Klang bis ARR_WARP_FRIST, neuer danach, ohne Einbruch
  Treiber t;
  PRUEF(t.mit_werk());
  auto a = sinus(34 * FPB125, 1000.0), c = sinus(34 * FPB125, 1500.0);
  const auto bauen = [&](Audio* au) {
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 32.0, &au->a).warp({0.0, 32.0}, {0.0, 32.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    return b.fertig();
  };
  t.laden(bauen(a.get()));
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(5 * 22500);
  const int64_t s_t = t.s;   // das Tausch-Sample (Blockanfang)
  t.laden(bauen(c.get()));
  t.lauf(s_t + 20000);
  int64_t neu = -1;
  for (int64_t s = s_t; s + 480 < static_cast<int64_t>(t.l.size()); s += 48)
    if (frequenz_schnell(t.l, s, s + 480) > 1250.0) {
      neu = s;
      break;
    }
  const double ref = rms(t.l, s_t - 20000, s_t - 5000);
  const double dip = kleinster_pegel_db(t.l, s_t - 2000, s_t + 6000, ref);
  std::printf("Fall 2 Tausch: Tausch bei Sample %lld, der neue Klang (1,5 kHz) ab Sample %lld (+%lld, Frist %d + Zyklus 256), kleinster 10-ms-Pegel %.2f dB\n", static_cast<long long>(s_t), static_cast<long long>(neu),
              static_cast<long long>(neu - s_t), cdj::ARR_WARP_FRIST, dip);
  PRUEF(neu > 0 && neu - s_t <= cdj::ARR_WARP_FRIST + 256);    // spätestens ARR_WARP_FRIST + 1 Zyklus
  PRUEF(neu - s_t >= cdj::ARR_WARP_FRIST - 480);               // und nicht früher: der alte Klang spielt bis dahin aus seinem Ring
  PRUEF(ref > 0.1 && dip > -3.0);
  PRUEF(t.arr.warp_spaet() == 0 && t.arr.warp_unterlauf() == 0);
}

// ---- Fall 3: 32 Spuren
void fall3() {
  int64_t einsatz[2] = {0, 0}, hoerbar[2] = {0, 0};
  for (int mit : {0, 1}) {
    Treiber t;
    if (mit) PRUEF(t.mit_werk());
    auto src = sinus(10 * FPB125, 800.0, 0.02f);
    Bau b;
    for (int sp = 1; sp <= 32; ++sp) {
      b.spur(sp, ArrArt::audio).clip(sp, ("c" + std::to_string(sp)).c_str(), 0.0, 8.0, &src->a);
      b.warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, mit ? cdj::ARR_WARP_COMPLEX : cdj::ARR_WARP_REPITCH);
    }
    t.laden(b.fertig());
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    einsatz[mit] = t.arr.einsatz_sample();
    float spitze[32] = {};
    for (int blk = 0; blk < 60; ++blk) {   // 60 Blöcke = 320 ms
      const int64_t s_b = t.s;
      t.lauf(t.s + 256);
      for (int sp = 0; sp < 32; ++sp) {
        const float p = t.arr.spitze_lesen(sp);
        if (s_b + 256 > einsatz[mit] && s_b < einsatz[mit] + 480) spitze[sp] = std::max(spitze[sp], p);   // Blöcke, die das erste 10-ms-Fenster ab dem Einsatz berühren
      }
    }
    for (int64_t i = 0; i < static_cast<int64_t>(t.l.size()); ++i)
      if (std::fabs(t.l[static_cast<size_t>(i)]) > 1e-6f) {
        hoerbar[mit] = i;
        break;
      }
    int klingen = 0;
    for (int sp = 0; sp < 32; ++sp) klingen += spitze[sp] > 0.00316f * 0.02f;   // −60 dBFS bei dieser Quelle (Spitze 0,02, nach Fader 1,0)
    std::printf("Fall 3 (%s): Einsatz bei Sample %lld, erstes hörbares Sample %lld, %d von 32 Spuren klingen im ersten 10-ms-Fenster, Stimmen im Werk %d, spät %llu, Unterlauf %llu\n",
                mit ? "COMPLEX" : "RE-PITCH", static_cast<long long>(einsatz[mit]), static_cast<long long>(hoerbar[mit]), klingen, t.arr.werk_stimmen(),
                static_cast<unsigned long long>(t.arr.warp_spaet()), static_cast<unsigned long long>(t.arr.warp_unterlauf()));
    PRUEF(hoerbar[mit] > 0 && klingen == 32);
    if (mit) PRUEF(t.arr.warp_spaet() == 0 && t.arr.warp_unterlauf() == 0 && t.arr.werk_stimmen() == 32);
  }
  std::printf("Fall 3: Einsatz gegen dasselbe Projekt ohne das Werk +%lld Samples (ARR_WARP_FRIST %d), erstes hörbares Sample +%lld\n", static_cast<long long>(einsatz[1] - einsatz[0]),
              cdj::ARR_WARP_FRIST, static_cast<long long>(hoerbar[1] - hoerbar[0]));
  PRUEF(einsatz[1] - einsatz[0] == cdj::ARR_WARP_FRIST);
  PRUEF(hoerbar[1] - hoerbar[0] <= cdj::ARR_WARP_FRIST + 256);
}

// ---- Fall 4: Ausfall des Werks, Pool voll
void fall4_ausfall() {
  for (int mit_zweiter : {0, 1}) {
    Treiber t;
    PRUEF(t.mit_werk());
    auto a = sinus(34 * FPB125, 1000.0, 0.3f), c = sinus(34 * FPB125, 2000.0, 0.3f);
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 32.0, &a->a).warp({0.0, 32.0}, {0.0, 32.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    if (mit_zweiter) b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 32.0, &c->a);   // ungewarpt: läuft weiter
    t.laden(b.fertig());
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    t.lauf(40000);
    t.werk->test_halte(true);   // das Werk steht: der Ring leert sich in 171 ms, dann bleibt nur Stille
    float p1_aus = 1.0f;
    int bloecke_halt = 0, p2_laeuft = 0;
    const int64_t s_halt = t.s;
    while (t.s < s_halt + 30000) {
      t.lauf(t.s + 256);
      const float p1 = t.arr.spitze_lesen(0), p2 = mit_zweiter ? t.arr.spitze_lesen(1) : 0.0f;
      ++bloecke_halt;
      p2_laeuft += p2 > 0.2f;
      if (t.s > s_halt + 20000) p1_aus = std::min(p1_aus, p1);   // die Werk-Spur nach dem Leerlaufen des Rings (171 ms = 8192 Samples + Blende)
    }
    const uint64_t ausfaelle = t.arr.warp_unterlauf();
    t.werk->test_halte(false);
    t.lauf(t.s + 20000);
    // Sprünge im Ausgang: ein Sinus mit 1 kHz und Spitze 0,3 steigt höchstens um 0,3 · 2π · 1000/48000 = 0,039 je Sample; beide Töne zusammen höchstens 0,117
    float sprung = 0.0f;
    for (int64_t i = s_halt - 2000; i + 1 < static_cast<int64_t>(t.l.size()); ++i) sprung = std::max(sprung, std::fabs(t.l[static_cast<size_t>(i) + 1] - t.l[static_cast<size_t>(i)]));
    std::printf("Fall 4 Ausfall%s: Ausfälle %llu (nach dem Halt), zuletzt %llu, Spitze der Werk-Spur nach 20 000 Samples Halt %.4f, größter Sprung %.4f, wieder da: Spitze %.3f\n",
                mit_zweiter ? " mit ungewarpter Spur" : "", static_cast<unsigned long long>(ausfaelle), static_cast<unsigned long long>(t.arr.warp_unterlauf()), p1_aus, sprung, t.arr.spitze_lesen(0));
    PRUEF(ausfaelle == 1 && t.arr.warp_unterlauf() == 1);   // ein Ausfall ist ein Ereignis, nicht jeder Block
    PRUEF(p1_aus < 0.001f);                                  // Stille statt Klang
    PRUEF(sprung < (mit_zweiter ? 0.12f : 0.06f));           // mit Blende, kein Sprung
    if (mit_zweiter) PRUEF(p2_laeuft == bloecke_halt);       // die ungewarpte Spur lief in allen Blöcken des Halts weiter
    PRUEF(t.arr.spitze_lesen(0) >= 0.0f);
    PRUEF(t.arr.warp_kein_platz() == 0);
  }
}

void fall4_pool() {   // 65. Stimme: warp_kein_platz zählt, der Clip spielt wie RE-PITCH, Bit für Bit
  std::vector<float> aus[2];
  for (int fallback : {1, 0}) {
    Treiber t;
    PRUEF(t.mit_werk());
    auto src = sinus(10 * FPB125, 1000.0, 0.01f);
    Bau b;
    for (int sp = 1; sp <= 32; ++sp)
      for (int zwei = 0; zwei < 2; ++zwei) {
        b.spur(sp, ArrArt::audio).clip(sp, zwei ? "b" : "a", 0.0, 2.0, &src->a);
        b.warp({0.0, 2.0}, {0.0, 2.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
      }
    b.spur(32, ArrArt::audio).clip(32, "x", 0.5, 1.5, &src->a);   // der 65. Clip, später als alle anderen
    b.warp({0.0, 1.5}, {0.0, 1.5 * static_cast<double>(FPB125)}, fallback ? cdj::ARR_WARP_COMPLEX : cdj::ARR_WARP_REPITCH);
    t.laden(b.fertig());
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    int groesste = 0;
    while (t.s < 3 * 22500 + 4000) {
      t.lauf(t.s + 256);
      groesste = std::max(groesste, t.arr.werk_stimmen());
    }
    aus[fallback] = t.l;
    std::printf("Fall 4 Pool (65. Clip %s): höchstens %d Stimmen im Werk, warp_kein_platz %llu\n", fallback ? "COMPLEX" : "RE-PITCH", groesste, static_cast<unsigned long long>(t.arr.warp_kein_platz()));
    PRUEF(groesste == cdj::ARR_WARP_PLAETZE);
    PRUEF(t.arr.warp_kein_platz() == (fallback ? 1u : 0u));
  }
  int ungleich = 0;
  for (size_t i = 0; i < aus[0].size() && i < aus[1].size(); ++i) ungleich += aus[0][i] != aus[1][i];
  float spitze = 0.0f;
  for (float x : aus[0]) spitze = std::max(spitze, std::fabs(x));
  std::printf("Fall 4 Pool: %d abweichende Samples zwischen Fallback und RE-PITCH, Spitze %.3f\n", ungleich, spitze);
  PRUEF(aus[0].size() == aus[1].size() && ungleich == 0 && spitze > 0.3f);
}

// 65. Clip, aber ein Platz wird frei, bevor er einsetzt: der Vorausblick versucht es in jedem Block erneut und setzt die Stimme im Werk an, sobald ein Platz da ist (nicht RE-PITCH,
// der Weg über clips_starten gilt nur, wenn bis zum Einsatz keiner frei wird). Bei 675 Samples Vorlauf klingt sie im Raster; wird der Platz erst im letzten Block vor dem Einsatz
// frei, ist ihr Ring zum Einsatz leer: Stille mit Blende, `warp_spaet` zählt 1 (synchrones Werk, deterministisch). Eine Stimme mit weniger als ARR_WARP_FRIST Vorlauf ist
// damit möglich (Befund der Prüfung fable), kein Fehler.
void fall4_nachzuegler() {
  for (double ende : {0.44, 0.47, 0.49}) {   // das Ende des kurzen Clips auf Spur 1, in Beats: der Platz wird 1350, 675 und 225 Samples vor dem Einsatz von x frei
    Treiber t;
    PRUEF(t.mit_werk());
    auto src = sinus(10 * FPB125, 1000.0, 0.01f);
    Bau b;
    for (int sp = 1; sp <= 32; ++sp)
      for (int zwei = 0; zwei < 2; ++zwei) {
        const double laenge = sp == 1 && zwei == 1 ? ende : 2.0;
        b.spur(sp, ArrArt::audio).clip(sp, zwei ? "b" : "a", 0.0, laenge, &src->a);
        b.warp({0.0, laenge}, {0.0, laenge * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
      }
    b.spur(32, ArrArt::audio).clip(32, "x", 0.5, 1.5, &src->a);   // der 65. Clip
    b.warp({0.0, 1.5}, {0.0, 1.5 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    t.laden(b.fertig());
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    while (t.s < 3 * 22500 + 4000) t.lauf(t.s + 256);
    std::printf("Fall 4 Nachzügler (Platz %.0f Samples vor dem Einsatz frei): kein Platz %llu, spät %llu, Unterlauf %llu\n", (0.5 - ende) * 22500.0,
                static_cast<unsigned long long>(t.arr.warp_kein_platz()), static_cast<unsigned long long>(t.arr.warp_spaet()), static_cast<unsigned long long>(t.arr.warp_unterlauf()));
    PRUEF(t.arr.warp_kein_platz() == 0 && t.arr.warp_unterlauf() == 0);
    PRUEF(t.arr.warp_spaet() == (ende > 0.48 ? 1u : 0u));
  }
}

// ---- Fall 5: Tempo-Rampe beim Spielen
void fall5() {
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = hann_klicks(44 * FPB125);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &src->a).warp({0.0, 40.0}, {0.0, 40.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(t.k.sample_at(8.0)));
  PRUEF(t.k.rampe(12.0, 130.0, 4.0));   // ab Beat 12 von 128 auf 130 über 4 Beats, danach 130
  ++t.gen;                               // die Karte hat eine neue Generation (wie nach einer angenommenen Rampe im Kern)
  t.lauf(static_cast<int64_t>(t.k.sample_at(44.0)));
  const int64_t s_c = t.arr.einsatz_sample();
  const Lage vor = lage_messen(t.l, t.k, s_c, 1, 10);
  const Lage in = lage_messen(t.l, t.k, s_c, 12, 16);
  const Lage nach = lage_messen(t.l, t.k, s_c, 18, 38);
  std::printf("Fall 5 Rampe 128 -> 130 ab Beat 12: Klicks vor der Rampe max %.1f Samples, in der Rampe max %.1f (ausgewiesen), nach Rampenende + 2 Fristen max %.1f (%d Klicks), spät %llu, kein Platz %llu\n",
              vor.max_abs, in.max_abs, nach.max_abs, nach.n, static_cast<unsigned long long>(t.arr.warp_spaet()), static_cast<unsigned long long>(t.arr.warp_kein_platz()));
  if (std::getenv("LAGE_DBG")) lage_messen(t.l, t.k, s_c, 12, 38);
  PRUEF(vor.n == 10 && vor.max_abs <= LAGE_GRENZE);
  PRUEF(nach.n == 21 && nach.ohne == 0 && nach.max_abs <= LAGE_GRENZE);
  PRUEF(t.arr.warp_spaet() == 0 && t.arr.warp_kein_platz() == 0);
}

// ---- Fall 6: Tempo-Rampe mit 32 Spuren und vier Arbeitsfäden in Echtzeit (AK17 mit Fäden; D4: ein neuer Auftrag überholt einen offenen). Die Fäden rechnen
// neben dem Callback; die Rampe setzt alle 32 Stimmen neu an. Danach klingen alle 32. Gezählt (nicht Teil der Prüfung, sie hängen an der Maschine): verworfene
// Aufträge, späte Einsätze, Unterläufe.
void fall6() {
  Treiber t;
  PRUEF(t.mit_werk(4));
  auto src = sinus(10 * FPB125, 800.0, 0.02f);
  Bau b;
  for (int sp = 1; sp <= 32; ++sp) {
    b.spur(sp, ArrArt::audio).clip(sp, ("c" + std::to_string(sp)).c_str(), 0.0, 8.0, &src->a);
    b.warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  }
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  timespec nx;
  clock_gettime(CLOCK_MONOTONIC, &nx);
  const auto zyklus = [&]() {   // ein Zyklus in Echtzeit (256 Samples = 5,333 ms)
    nx.tv_nsec += 5333333;
    if (nx.tv_nsec >= 1000000000L) {
      nx.tv_nsec -= 1000000000L;
      ++nx.tv_sec;
    }
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &nx, nullptr);
    t.lauf(t.s + 256);
  };
  while (t.s < static_cast<int64_t>(t.k.sample_at(3.0))) zyklus();
  PRUEF(t.k.rampe(3.0, 130.0, 2.0));   // ab Beat 3 von 128 auf 130 über 2 Beats
  ++t.gen;
  while (t.s < static_cast<int64_t>(t.k.sample_at(7.0))) zyklus();
  float spitze[32] = {}, kleinste = 0.0f;
  for (int blk = 0; blk < 120 && kleinste <= 0.00316f * 0.02f; ++blk) {   // bis jede Spur einmal geklungen hat (höchstens 0,64 s): auf einer belegten Maschine kommen die Fäden später
    zyklus();
    kleinste = 1.0f;
    for (int sp = 0; sp < 32; ++sp) {
      spitze[sp] = std::max(spitze[sp], t.arr.spitze_lesen(sp));
      kleinste = std::min(kleinste, spitze[sp]);
    }
  }
  const cdj::WarpZaehler z = t.werk->zaehler();
  std::printf("Fall 6 Rampe mit 32 Spuren und 4 Fäden: Stimmen im Werk %d, schwächste Spur nach der Rampe %.4f, Aufträge übernommen %llu, verworfen %llu, spät %llu, Unterlauf %llu, kein Platz %llu\n",
              t.arr.werk_stimmen(), kleinste, static_cast<unsigned long long>(z.ansaetze), static_cast<unsigned long long>(z.verworfen), static_cast<unsigned long long>(t.arr.warp_spaet()),
              static_cast<unsigned long long>(t.arr.warp_unterlauf()), static_cast<unsigned long long>(t.arr.warp_kein_platz()));
  PRUEF(t.arr.werk_stimmen() == 32 && kleinste > 0.00316f * 0.02f);   // alle 32 klingen (−60 dBFS bei dieser Quelle)
  PRUEF(t.arr.warp_kein_platz() == 0);
  t.werk->stoppe();   // die Fäden enden vor der Quelle `src`, die vor dem Treiber abgebaut wird
}

// ---- Hilfe für Fall 8 und 9: ein Werk, das die Aufrufe von ansetzen() zählt und alles andere an das echte (synchrone) Werk gibt
struct Zaehlwerk final : cdj::WarpWerk {
  std::unique_ptr<cdj::WarpWerk> w;
  long angesetzt = 0;
  int64_t raster0 = 0, raster_abstand = 0;   // Fall 9: die Einsätze der Clips liegen auf raster0 + j · raster_abstand
  long neben_raster = 0;                     // Aufträge, deren Ziel-Sample nicht auf dem Raster liegt (ein spät angesetzter Clip setzt erst ARR_WARP_FRIST nach seinem Einsatz ein)
  int belege() noexcept override { return w->belege(); }
  void ansetzen(int p, cdj::WarpAnsatz& a) noexcept override {
    ++angesetzt;
    if (raster_abstand > 0 && (a.s_h - raster0) % raster_abstand != 0) ++neben_raster;
    w->ansetzen(p, a);
  }
  void gib(int p) noexcept override { w->gib(p); }
  cdj::StreckRing& ring(int p) noexcept override { return w->ring(p); }
  int64_t ende_s(int p) const noexcept override { return w->ende_s(p); }
  void takt(int64_t s) noexcept override { w->takt(s); }
  int belegt() const noexcept override { return w->belegt(); }
  bool liest(const cdj::ArrSnapshot* s) const noexcept override { return w->liest(s); }
  int faeden() const noexcept override { return w->faeden(); }
  int prioritaet(int j) override { return w->prioritaet(j); }
  void stoppe() override { w->stoppe(); }
  cdj::WarpZaehler zaehler() const noexcept override { return w->zaehler(); }
  std::string schluss_json() const override { return w->schluss_json(); }
  void test_halte(bool a) noexcept override { w->test_halte(a); }
  void test_halte_block(bool a) noexcept override { w->test_halte_block(a); }
};

Zaehlwerk* mit_zaehlwerk(Treiber& t) {   // wie Treiber::mit_werk(0), aber mit dem zählenden Werk davor
  auto z = std::make_unique<Zaehlwerk>();
  z->w = cdj::warp_werk_neu({0});
  if (!z->w) return nullptr;
  Zaehlwerk* roh = z.get();
  t.werk = std::move(z);
  t.arr.setze_warp_werk(t.werk.get());
  t.arr.setze_karten_generation(&t.gen);
  return roh;
}

// ---- Fall 7: neue Karte an einer Clip-Grenze, an der alle Spuren zugleich wechseln (Prüfung 2, N1). Jede Spur: Clip A [0, 8) und Clip B [8, 16) aus derselben
// Quelle (Klick auf jedem Beat), COMPLEX. Vor der Grenze hält jede Spur drei Stimmen, wenn die Generation wechselt: A (spielt noch), B (vorab angesetzt, ARR_WARP_FRIST
// vor der Grenze) und die Nachfolgerin von B. Bei 32 Spuren sind das 96 Stimmen für 64 Plätze: A endet an der Grenze, und erst dann ist für jede Nachfolgerin ein Platz da.
// Jede Spur hört ihren Klick an eigener Stelle (der erste Marker zeigt sp · 640 Frames in die Quelle), die Mischung trennt sie. Rampe 128 → 130 ab Beat 12, angenommen
// `vor` Samples vor Beat 8. Ohne den zweiten Versuch (Mutation OHNE_NACHHOLEN) spielen alle 32 B bis zu ihrem Ende auf der alten Karte: bei Beat 15 rund 740 Samples daneben.
// Nachbesserung 5 (Prüfung 5, opus F1): dazu 2 361 und 2 617 Samples, zwischen Frist + Naht und 2 Fristen. Dort wird A Brücke bis s + Frist, seine Nachfolgerin klingt nur
// noch 313 bzw. 569 Samples und nahm vorher den Platz, den B für seinen Vorlauf brauchte: B setzte spät ein (spät 32, Loch 288 Samples synchron, 768 mit vier Fäden, der
// Klick auf Beat 8 fehlte). Jetzt gibt die Nachfolgerin B den Vorrang, und A spielt mit dem alten Raster zu Ende (gezählt: kein Platz 32 = 3 · 32 − 64), B klingt ab Beat 8.
void fall7_grenze() {
  for (int faeden : {0, 4})
    for (int vor : {1081, 2361, 2617, 6201}) {
      Treiber t;
      PRUEF(t.mit_werk(faeden));
      auto src = hann_klicks(10 * FPB125);
      Bau b;
      for (int sp = 1; sp <= 32; ++sp) {
        const double off = 640.0 * sp;
        b.spur(sp, ArrArt::audio);
        b.clip(sp, ("a" + std::to_string(sp)).c_str(), 0.0, 8.0, &src->a).warp({0.0, 8.0}, {off, off + 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
        b.clip(sp, ("b" + std::to_string(sp)).c_str(), 8.0, 8.0, &src->a).warp({0.0, 8.0}, {off, off + 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
      }
      timespec nx;
      clock_gettime(CLOCK_MONOTONIC, &nx);
      const auto bis = [&](int64_t ziel) {   // mit Fäden im Echtzeit-Takt von 256 Samples (5,333 ms), synchron so schnell wie möglich
        while (t.s < ziel) {
          if (faeden) {
            nx.tv_nsec += 5333333;
            if (nx.tv_nsec >= 1000000000L) {
              nx.tv_nsec -= 1000000000L;
              ++nx.tv_sec;
            }
            clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &nx, nullptr);
          }
          t.lauf(t.s + 256);
        }
      };
      t.laden(b.fertig());
      t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
      bis(20 * 256);
      const int64_t s_c = t.arr.einsatz_sample();
      const int64_t grenze = static_cast<int64_t>(t.k.sample_at(t.k.beat_at(static_cast<double>(s_c)) + 8.0));
      int hoechstens = 0;
      while (t.s + 256 <= grenze - vor) {
        bis(t.s + 256);
        hoechstens = std::max(hoechstens, t.arr.werk_stimmen());
      }
      const int64_t abstand = grenze - t.s;   // Samples bis zur Grenze, wenn die neue Generation kommt
      PRUEF(t.k.rampe(12.0, 130.0, 2.0));
      ++t.gen;
      bis(static_cast<int64_t>(t.k.sample_at(t.k.beat_at(static_cast<double>(s_c)) + 16.0)) + 2048);   // bis hinter das Ende von B (die Fäden liefern bis dorthin)
      int ohne = 0;
      double schlechteste = 0.0;
      for (int sp = 1; sp <= 32; ++sp) {
        const double off = 640.0 * sp;
        const Lage a = lage_messen(t.l, t.k, s_c, 8, 12, off);    // vor der Rampe (Beat 12 beginnt sie); Nachbesserung 5: mit dem ersten Klick von B (Beat 8), ein Loch am Einsatz lässt ihn fehlen
        const Lage z = lage_messen(t.l, t.k, s_c, 15, 15, off);   // nach dem Ende der Rampe (Beat 14)
        ohne += a.ohne + z.ohne;
        schlechteste = std::max({schlechteste, a.max_abs, z.max_abs});
      }
      // Nachbesserung 5: zwischen Frist + Naht und 2 Fristen + Naht + Block vor der Grenze reicht der Pool nicht für A, seine Nachfolgerin und B (96 für 64): die
      // Nachfolgerin von A (klänge 313 bis 569 Samples) gibt B (acht Beats) den Vorrang, A spielt mit dem alten Raster zu Ende, gezählt je Spur
      const bool eng = abstand > cdj::ARR_WARP_FRIST + cdj::ARR_NAHT && abstand < 2 * cdj::ARR_WARP_FRIST + cdj::ARR_NAHT + 256;
      std::printf("Fall 7 (%s, Karte %lld Samples vor der Grenze): höchstens %d Stimmen im Werk davor, Klicks der 32 Spuren (Beat 8 bis 12 und 15): %d ohne, größte Abweichung %.1f Samples, kein Platz %llu (erwartet %d), spät %llu, Unterlauf %llu\n",
                  faeden ? "4 Fäden" : "synchron", static_cast<long long>(abstand), hoechstens, ohne, schlechteste, static_cast<unsigned long long>(t.arr.warp_kein_platz()), eng ? 32 : 0,
                  static_cast<unsigned long long>(t.arr.warp_spaet()), static_cast<unsigned long long>(t.arr.warp_unterlauf()));
      PRUEF(abstand > 0);
      PRUEF(hoechstens == (abstand < cdj::ARR_WARP_FRIST ? cdj::ARR_WARP_PLAETZE : 32));   // knapp vor der Grenze ist der Pool voll, davor halten 32 Stimmen
      // mit Fäden hängen Lage, spät und (über die Deckung) auch die Wege der Stimmen an der Maschine: die Tore gelten dort, solange das Werk mithält (kein Unterlauf; unter
      // ASan mit vier Fäden hungert es: spät 98, Unterlauf 99, kein Platz 2 statt 32), sonst nur ausgewiesen
      const bool haelt_mit = !faeden || t.arr.warp_unterlauf() == 0;
      if (haelt_mit) PRUEF(t.arr.warp_kein_platz() == (eng ? 32u : 0u));
      if (haelt_mit) PRUEF(ohne == 0);   // Nachbesserung 5: kein Klick fehlt, auch der auf Beat 8 nicht (vorher bei 2 361: Loch 288 Samples am Einsatz von B); mit Fäden deckt RE-PITCH einen späten Einsatz
      if (!faeden) PRUEF(schlechteste <= LAGE_GRENZE && t.arr.warp_spaet() == 0);   // Nachbesserung 5: kein später Einsatz (vorher 32 bei 2 361)
      t.werk->stoppe();   // die Fäden enden vor der Quelle `src`, die vor dem Treiber abgebaut wird
    }
}

// ---- Fall 7b (Nachbesserung 3): der zweite Versuch je Block (warp_karte_neu, Prüfung 2 Nr. 1) an einem Fall, den er allein trägt. Seit Nachbesserung 3 löst eine neue Karte
// eine vorab angesetzte Stimme, und der Vorausblick setzt die Nachfolgerin (Fall 7 braucht den zweiten Versuch nicht mehr, die Mutation OHNE_NACHHOLEN blieb dort grün). Hier
// klingen je Spur zwei Clips: L [0, 16) mit den Klicks und K [0, 9), stumm (Gain 0, er hält trotzdem einen Platz): 64 klingende Stimmen, der Pool ist voll. Die Karte kommt
// im letzten Block, der mindestens 3 000 Samples vor dem Ende von K beginnt (Nachbesserung 4: vorher 1 081; seit der einen Regel setzt die Nachfolgerin von L dann schon
// am Ende der Brücke an, weil K vorher endet, und der zweite Versuch wurde nicht mehr gebraucht): K endet nach der Brücke, findet bis zu seinem Ende keinen Platz und
// spielt mit der alten Karte zu Ende (stumm, je Spur ein „kein Platz“); L findet erst einen Platz, wenn K endet, die Brücke von L wird bis dahin je Block verlängert.
// Ohne zweiten Versuch blendet die Brücke von L an ihrem Ende aus, und L schweigt bis zu seinem Ende.
void fall7b_nachholen() {
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = hann_klicks(18 * FPB125);
  Bau b;
  for (int sp = 1; sp <= 32; ++sp) {
    const double off = 640.0 * sp;
    b.spur(sp, ArrArt::audio);
    b.clip(sp, ("l" + std::to_string(sp)).c_str(), 0.0, 16.0, &src->a).warp({0.0, 16.0}, {off, off + 16.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    b.clip(sp, ("k" + std::to_string(sp)).c_str(), 0.0, 9.0, &src->a, 0, 0.0f).warp({0.0, 9.0}, {off, off + 9.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  }
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(20 * 256);
  const int64_t s_c = t.arr.einsatz_sample();
  const int64_t ende_k = static_cast<int64_t>(t.k.sample_at(t.k.beat_at(static_cast<double>(s_c)) + 9.0));
  while (t.s + 256 <= ende_k - 3000) t.lauf(t.s + 256);
  const int64_t abstand = ende_k - t.s;
  const int davor = t.arr.werk_stimmen();
  PRUEF(t.k.rampe(12.0, 130.0, 2.0));
  ++t.gen;
  while (t.s < static_cast<int64_t>(t.k.sample_at(t.k.beat_at(static_cast<double>(s_c)) + 16.0)) + 2048) t.lauf(t.s + 256);
  int ohne = 0;
  double schlechteste = 0.0;
  for (int sp = 1; sp <= 32; ++sp) {
    const Lage a = lage_messen(t.l, t.k, s_c, 10, 12, 640.0 * sp);
    const Lage z = lage_messen(t.l, t.k, s_c, 15, 15, 640.0 * sp);
    ohne += a.ohne + z.ohne;
    schlechteste = std::max({schlechteste, a.max_abs, z.max_abs});
  }
  std::printf("Fall 7b (zwei Clips je Spur, Karte %lld Samples vor dem Ende von K): Stimmen im Werk davor %d, Klicks von L (Beat 10 bis 12 und 15): %d ohne, größte Abweichung %.1f Samples, kein Platz %llu, spät %llu\n",
              static_cast<long long>(abstand), davor, ohne, schlechteste, static_cast<unsigned long long>(t.arr.warp_kein_platz()), static_cast<unsigned long long>(t.arr.warp_spaet()));
  PRUEF(davor == cdj::ARR_WARP_PLAETZE);
  PRUEF(t.arr.warp_kein_platz() == 32 && t.arr.warp_spaet() == 0);   // je Spur K (stumm), L nie
  PRUEF(ohne == 0 && schlechteste <= LAGE_GRENZE);
}

// ---- Fall 8: eine neue Generation setzt jede Nachfolgerin genau einmal an (Prüfung 2, N2). Die Schleife über die Stimmen erreichte die Nachfolgerin, die sie selbst
// gerade angelegt hatte, und setzte sie ein zweites Mal an: 64 Aufträge für 32 Nachfolgerinnen. Der Zähler des Werks sieht das nicht (der Dreifachpuffer gibt dem Faden nur
// den letzten Auftrag), darum zählt das Werk dazwischen die Aufrufe.
void fall8_einmal() {
  for (int spuren : {1, 32}) {
    Treiber t;
    Zaehlwerk* z = mit_zaehlwerk(t);
    PRUEF(z != nullptr);
    auto src = sinus(10 * FPB125, 800.0, 0.02f);
    Bau b;
    for (int sp = 1; sp <= spuren; ++sp) {
      b.spur(sp, ArrArt::audio).clip(sp, ("c" + std::to_string(sp)).c_str(), 0.0, 8.0, &src->a);
      b.warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    }
    t.laden(b.fertig());
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    while (t.s < static_cast<int64_t>(t.k.sample_at(3.0))) t.lauf(t.s + 256);
    const long vor = z->angesetzt;
    PRUEF(t.k.rampe(3.0, 130.0, 2.0));
    ++t.gen;
    t.lauf(t.s + 256);
    const long im_block = z->angesetzt - vor;
    t.lauf(t.s + 4 * 256);
    const long danach = z->angesetzt - vor - im_block;
    std::printf("Fall 8 (%d Spuren): Aufträge im Block der neuen Karte %ld (erwartet %d), in den vier Blöcken danach %ld, Stimmen im Werk %d\n", spuren, im_block, spuren, danach, t.arr.werk_stimmen());
    PRUEF(im_block == spuren && danach == 0);
    PRUEF(t.arr.warp_kein_platz() == 0);
  }
}

// ---- Fall 9: 128 Clips je Spur auf 32 Spuren (4 096, die Grenze der Wiedergabe), jeder ein Beat lang, COMPLEX. Der Vorausblick sucht im Beat und bricht beim ersten Clip
// hinter dem Horizont ab (Prüfung 2, N3): Er muss trotzdem jeden Einsatz einmal ansetzen und keinen zu spät. Nach 5 Beats sind es 32 · (Clips, die bis dahin plus
// ARR_WARP_FRIST einsetzen) Aufträge, jeder genau einmal.
void fall9_viele_clips() {
  Treiber t;
  Zaehlwerk* z = mit_zaehlwerk(t);
  PRUEF(z != nullptr);
  auto src = sinus(2 * FPB125, 800.0, 0.02f);
  Bau b;
  for (int sp = 1; sp <= 32; ++sp) {
    b.spur(sp, ArrArt::audio);
    for (int j = 0; j < 128; ++j) {
      b.clip(sp, ("c" + std::to_string(sp) + "_" + std::to_string(j)).c_str(), static_cast<double>(j), 1.0, &src->a);
      b.warp({0.0, 1.0}, {0.0, static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    }
  }
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  const int64_t s_c = t.arr.einsatz_sample();
  z->raster0 = s_c;
  z->raster_abstand = SPB;
  while (t.s < s_c + 5 * SPB) t.lauf(t.s + 256);
  // Einsätze bei s_c + j · 22 500 Samples (128 BPM): angesetzt sind alle, die vor dem Horizont des letzten Blocks liegen (sein Anfang + 256 + ARR_WARP_FRIST)
  const int64_t horizont = t.s + cdj::ARR_WARP_FRIST;
  long erwartet = 0;
  for (int j = 0; j < 128; ++j) erwartet += (s_c + static_cast<int64_t>(j) * SPB < horizont) ? 1 : 0;
  std::printf("Fall 9 (4 096 Clips): Aufträge %ld (erwartet 32 · %ld = %ld), davon neben dem Raster der Einsätze %ld, spät %llu, Unterlauf %llu, kein Platz %llu\n", z->angesetzt,
              erwartet, 32 * erwartet, z->neben_raster, static_cast<unsigned long long>(t.arr.warp_spaet()), static_cast<unsigned long long>(t.arr.warp_unterlauf()),
              static_cast<unsigned long long>(t.arr.warp_kein_platz()));
  PRUEF(z->angesetzt == 32 * erwartet && z->neben_raster == 0);
  PRUEF(t.arr.warp_spaet() == 0 && t.arr.warp_kein_platz() == 0);
}

// ---- Fall 10: ein Tausch kurz vor einer Clip-Grenze, an der alle Spuren zugleich wechseln (seit Nachbesserung 4 die Marker aller Clips, vorher der Gain). Bis Nachbesserung 2 war das ein Befund ohne Behebung
// (bei 32 Spuren 64 Stimmen als RE-PITCH): die vorab angesetzte Stimme von B verlor beim Tausch ihre Bindung und bekam eine zweite darüber (Prüfung 3 M1), und die
// Ersatzstimme für A setzte nach dem Ende von A ein und klang nie (m2). Jetzt: A und B je eine Stimme, die Nachfolgerin von B dort, wo die gelöste endet (oder, ohne Platz,
// am Einsatz); kein Platzmangel bei 10, 20 und 32 Spuren, der Pegel von B am Einsatz ohne Loch. Synchron geprüft; mit vier Fäden im Echtzeit-Takt (32 Spuren) ausgewiesen.
// Nachbesserung 5 (Prüfung 5, opus F1): dazu 2 361 Samples (zwischen Frist + Naht und 2 Fristen), synchron. Dort nahm die Nachfolgerin von A (313 Samples) den Platz von B:
// B spät (32), Loch 288 Samples. Jetzt gibt sie B den Vorrang; A spielt ab dem Block, in dem B seinen Platz nimmt, als RE-PITCH (Tausch: der alte Inhalt gilt nicht
// mehr), gezählt: kein Platz 3 · Spuren − 64 (32 Spuren: 32; 20 und 10: 0).
void fall10_tausch_an_der_grenze() {
  for (int faeden : {0, 4})
  for (int vor : {1081, 2361, 6201})
    for (int spuren : {10, 20, 32}) {
      if (faeden && (spuren != 32 || vor == 2361)) continue;   // Nachbesserung 3: mit vier Fäden im Echtzeit-Takt nur der volle Fall (ausgewiesen: spät und Pegel am Einsatz)
      Treiber t;
      PRUEF(t.mit_werk(faeden));
      auto src = sinus(10 * FPB125, 1000.0, 0.02f);
      // Nachbesserung 4 (R3): ein Gain ist keine Werk-Angabe (er gleitet an der gebundenen Stimme); der Tausch verschiebt die Marker um 480 Frames (zehn Perioden des
      // Sinus: derselbe Klang, neue Werk-Daten)
      const auto bau = [&](double off, int64_t nr) {
        Bau b(nr);
        for (int sp = 1; sp <= spuren; ++sp) {
          b.spur(sp, ArrArt::audio);
          b.clip(sp, ("a" + std::to_string(sp)).c_str(), 0.0, 8.0, &src->a, 0, 1.0f).warp({0.0, 8.0}, {off, off + 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
          b.clip(sp, ("b" + std::to_string(sp)).c_str(), 8.0, 8.0, &src->a, 0, 1.0f).warp({0.0, 8.0}, {off, off + 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
        }
        return b.fertig();
      };
      timespec nx;
      clock_gettime(CLOCK_MONOTONIC, &nx);
      const auto block = [&]() {   // mit Fäden im Echtzeit-Takt von 256 Samples (wie Fall 7)
        if (faeden) {
          nx.tv_nsec += 5333333;
          if (nx.tv_nsec >= 1000000000L) {
            nx.tv_nsec -= 1000000000L;
            ++nx.tv_sec;
          }
          clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &nx, nullptr);
        }
        t.lauf(t.s + 256);
      };
      t.laden(bau(0.0, 1));
      t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
      while (t.s < 20 * 256) block();
      const int64_t grenze = t.arr.einsatz_sample() + 8 * SPB;
      while (t.s + 256 <= grenze - vor) block();
      const int64_t abstand = grenze - t.s;
      t.laden(bau(480.0, 2));
      while (t.s < grenze + 3 * SPB) block();
      // Pegel von B: kleinster 10-ms-Pegel in [Grenze + 200, Grenze + 6 000) gegen den Pegel lange danach (eine Lücke am Einsatz zeigt sich hier)
      const double b_ref = rms(t.l, grenze + 2 * SPB, grenze + 2 * SPB + 8000);
      const double b_min = kleinster_pegel_db(t.l, grenze + 200, grenze + 6000, b_ref);
      std::printf("Fall 10 (%s, Tausch %lld Samples vor der Grenze, %d Spuren): kein Platz %llu (Stimmen als RE-PITCH), Stimmen im Werk am Ende %d, spät %llu, Unterlauf %llu, kleinster 10-ms-Pegel von B am Einsatz %.2f dB\n",
                  faeden ? "4 Fäden" : "synchron", static_cast<long long>(abstand), spuren, static_cast<unsigned long long>(t.arr.warp_kein_platz()), t.arr.werk_stimmen(),
                  static_cast<unsigned long long>(t.arr.warp_spaet()), static_cast<unsigned long long>(t.arr.warp_unterlauf()), b_min);
      if (!faeden) PRUEF(b_min > -3.0 && t.arr.warp_spaet() == 0);   // mit Fäden hängt „spät“ an der Maschine: ausgewiesen, nicht geprüft
      // Nachbesserung 3: geprüft in allen sechs Fällen (vorher 1 081 Samples: 20 Spuren kein Platz 16, 32 Spuren 64, als RE-PITCH): die vorab angesetzte Stimme, die
      // noch nicht klingt, gibt ohne Platz ihren her (Mutation ARR_WARP_WERK_OHNE_PLATZTAUSCH macht den Fall rot)
      // Nachbesserung 5: bei 2 361 Samples und 32 Spuren gibt die Nachfolgerin von A den Platz an B (Vorrang), A spielt als RE-PITCH zu Ende (kein Platz 32, B ohne Loch)
      const unsigned erwartet_kp = (vor == 2361 && 3 * spuren > cdj::ARR_WARP_PLAETZE) ? static_cast<unsigned>(3 * spuren - cdj::ARR_WARP_PLAETZE) : 0u;
      if (!faeden || t.arr.warp_unterlauf() == 0) PRUEF(t.arr.warp_kein_platz() == erwartet_kp && t.arr.werk_stimmen() == spuren);   // mit Fäden nur, solange das Werk mithält (wie Fall 7)
      t.werk->stoppe();
    }
}

// ---- Fall 11 (Nachbesserung 3): Ereignisse im Frist-Fenster. Ein Werk-Clip ist vorab angesetzt (sein Einsatz X liegt weniger als ARR_WARP_FRIST vor dem Ereignis,
// Gegenprobe 6 201 Samples davor); je Grenze (Clip-Grenze A [0, 8) → B [8, 16), Loop-Naht C [0, 16) in der Klammer 0 bis 8, Transport-Einsatz C ab Beat 4 auf Takt) und
// Ereignis ein Lauf gegen einen Referenzlauf ohne Ereignis, synchrones Werk. Gemessen: Pegel im Fenster [X + 200, Ereignis + Frist − 50) (ein) und lange danach (spaet)
// gegen die Referenz, größter 10-ms-Pegel um den Einsatz gegen die Referenz (spitze: über 1 klingt der Clip doppelt), kleinster 10-ms-Pegel ab dem Ereignis (loch),
// Rest nach einem Stopp, Zähler. Prüfung 3 M1: ein Tausch 1 081 Samples vor dem Einsatz ließ den Clip doppelt klingen (spitze 1,50).
namespace f11 {
constexpr int FRIST = cdj::ARR_WARP_FRIST;
enum Grenze { CLIP = 0, NAHT = 1, START = 2 };
const char* gname[] = {"Clip-Grenze", "Loop-Naht", "Transport-Einsatz"};
enum Ereignis {
  KEIN, TAUSCH_GAIN, TAUSCH_QUELLE, TAUSCH_TONES, TAUSCH_REPITCH, WARP_AUS, CLIP_WEG, CLIP_VERSCHIEBEN, CLIP_KUERZEN, KARTE_SPAETER, KARTE_JETZT,
  STOPP, STOPP_KNAPP, SPRUNG, LOOP_UM, MUTE, SOLO, PROJEKT_NEU, ZWEI_TAUSCHE, TAUSCH_FOLGE, TAUSCH_MARKER, KARTE_ZWEIMAL, TAUSCH_KARTE, N_EREIGNIS
};
const char* ename[] = {"kein", "tausch_gain", "tausch_quelle", "tausch_tones", "tausch_repitch", "warp_aus", "clip_weg", "clip_verschieben", "clip_kuerzen",
                       "karte_spaeter", "karte_jetzt", "stopp", "stopp_knapp", "sprung", "loop_um", "mute", "solo", "projekt_neu", "zwei_tausche",
                       "tausch_folge", "tausch_marker", "karte_zweimal", "tausch_karte"};
struct Z {   // Stand des Projekts
  float gain = 1.0f;
  int modus = cdj::ARR_WARP_COMPLEX;   // −1: ohne Warp
  bool quelle2 = false;
  double off = 0.0;                    // Nachbesserung 4: erster Marker in der Quelle (480 Frames sind zehn Perioden des Sinus: derselbe Klang, neue Werk-Daten)
  double start = 8.0, laenge = 8.0;    // CLIP: Clip B; NAHT und START: Clip C [start − 8, start + laenge)
  bool da = true;
  std::string praefix;
};
double sprung(const std::vector<float>& l, int64_t a, int64_t b) {
  double m = 0.0;
  for (int64_t i = std::max<int64_t>(a, 1); i < b && i < static_cast<int64_t>(l.size()); ++i) m = std::max(m, static_cast<double>(std::fabs(l[i] - l[i - 1])));
  return m;
}
struct Lauf {
  std::vector<float> l;
  int64_t X = 0, s_ev = 0;
  int max_werk = 0;
  unsigned long long kp = 0, sp = 0, ul = 0;
  bool anwendbar = true;
};
Lauf fahre(Grenze g, Ereignis e, int vor) {
  Lauf r;
  Treiber t;
  PRUEF(t.mit_werk());
  auto q1 = Audio::sinus(20 * FPB125, 1000.0, 0.2f);
  auto q2 = Audio::sinus(20 * FPB125, 1500.0, 0.2f);
  int64_t nr = 1;
  const auto bau = [&](const Z& z) {
    Bau b(nr++);
    b.spur(1, ArrArt::audio);
    b.spur(2, ArrArt::audio);   // leer: ihr Solo schaltet Spur 1 stumm
    const cdj::ArrAudio* qa = z.quelle2 ? &q2->a : &q1->a;
    const auto warp = [&](double len) {
      if (z.modus >= 0) b.warp({0.0, len}, {z.off, z.off + len * static_cast<double>(FPB125)}, z.modus);
    };
    if (g == CLIP) {
      b.clip(1, (z.praefix + "a").c_str(), 0.0, 8.0, &q1->a, 0, 1.0f).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
      if (z.da) {
        b.clip(1, (z.praefix + "b").c_str(), z.start, z.laenge, qa, 0, z.gain);
        warp(z.laenge);
      }
    } else if (z.da) {
      b.clip(1, (z.praefix + "c").c_str(), z.start - 8.0, z.laenge + 8.0, qa, 0, z.gain);
      warp(z.laenge + 8.0);
    }
    return b.fertig();
  };
  Z z;
  t.laden(bau(z));
  if (g == START) {
    t.arr.start(4.0, 1, false, 0, 537, 256, t.k);
    r.X = t.arr.einsatz_sample();
  } else {
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    if (g == NAHT) t.arr.loop(true, 0.0, 8.0, 0, t.k);
    t.lauf(20 * 256);
    r.X = t.arr.einsatz_sample() + 8 * SPB;
  }
  while (t.s + 256 <= r.X - vor) t.lauf(t.s + 256);
  if (t.s < r.X - vor) {   // Nachbesserung 4: ein kürzerer Block, damit das Ereignis genau `vor` Samples vor dem Einsatz liegt
    t.n = static_cast<int>(r.X - vor - t.s);
    t.lauf(r.X - vor);
    t.n = 256;
  }
  r.s_ev = t.s;
  const auto tausch = [&](auto f) {
    Z z2 = z;
    f(z2);
    t.laden(bau(z2));
    z = z2;
  };
  int folge = 0;   // weitere Tausche (zwei_tausche, tausch_folge) je 512 Samples
  switch (e) {
    case KEIN: break;
    case TAUSCH_GAIN: tausch([](Z& x) { x.gain = 0.5f; }); break;
    case TAUSCH_QUELLE: tausch([](Z& x) { x.quelle2 = true; }); break;
    case TAUSCH_TONES: tausch([](Z& x) { x.modus = cdj::ARR_WARP_TONES; }); break;
    case TAUSCH_REPITCH: tausch([](Z& x) { x.modus = cdj::ARR_WARP_REPITCH; }); break;
    case WARP_AUS: tausch([](Z& x) { x.modus = -1; }); break;
    case CLIP_WEG: tausch([](Z& x) { x.da = false; }); break;
    case CLIP_VERSCHIEBEN:   // B rückt einen Beat nach hinten (nur an der Clip-Grenze sinnvoll)
      if (g != CLIP) r.anwendbar = false;
      else tausch([](Z& x) { x.start = 9.0; });
      break;
    case CLIP_KUERZEN: tausch([](Z& x) { x.laenge = 4.0; }); break;
    case KARTE_SPAETER: PRUEF(t.k.rampe(12.0, 130.0, 2.0)); ++t.gen; break;                                  // Rampe ab Beat 12, nach dem Einsatz
    case KARTE_JETZT: PRUEF(t.k.rampe(t.k.beat_at(static_cast<double>(t.s)), 135.0, 1.0)); ++t.gen; break;   // Rampe ab jetzt (Tempo-Hand, verspätete Rampe): der Einsatz rückt
    case STOPP: t.arr.stopp(0, t.s, t.k); break;
    case STOPP_KNAPP: t.arr.stopp(0, r.X - 40, t.k); break;   // 40 Samples vor dem Einsatz
    case SPRUNG: t.arr.start(0.0, 0, false, t.s, 537, 256, t.k); break;
    case LOOP_UM:
      if (g == CLIP) t.arr.loop(true, 0.0, 8.0, t.s, t.k);         // die Klammer endet auf der Grenze: B klingt nie, A beginnt von vorn
      else if (g == NAHT) t.arr.loop(false, 0.0, 8.0, t.s, t.k);   // die Klammer fällt weg: C läuft linear weiter
      else r.anwendbar = false;
      break;
    case MUTE: t.arr.setze_sofort(t.tab.suche("spur/1/mute"), 1.0f); break;
    case SOLO: t.arr.setze_sofort(t.tab.suche("spur/2/solo"), 1.0f); break;
    case PROJEKT_NEU: tausch([](Z& x) { x.praefix = "n"; }); break;   // neues Projekt: dieselben Clips mit anderen IDs
    // Nachbesserung 4: die Ketten tauschen Marker (Werk-Daten), nicht den Gain (der gleitet an der gebundenen Stimme, R3)
    case ZWEI_TAUSCHE: tausch([](Z& x) { x.off += 480.0; }); folge = 1; break;
    case TAUSCH_FOLGE: tausch([](Z& x) { x.off += 480.0; }); folge = 7; break;   // acht Tausche, je 512 Samples (Marker gezogen)
    case TAUSCH_MARKER: tausch([](Z& x) { x.off = 480.0; }); break;
    case KARTE_ZWEIMAL: PRUEF(t.k.rampe(12.0, 130.0, 2.0)); ++t.gen; folge = 1; break;   // B1 (Prüfung 4): zwei Generationen im Frist-Fenster
    case TAUSCH_KARTE: tausch([](Z& x) { x.off = 480.0; }); folge = 1; break;           // B1: Tausch, 512 Samples später eine Karte
    default: break;
  }
  if (!r.anwendbar) return r;
  int64_t naechster = r.s_ev + 512;
  while (t.s < r.X + 3 * SPB) {
    if (folge > 0 && t.s >= naechster) {
      if (e == KARTE_ZWEIMAL) {
        PRUEF(t.k.rampe(14.0, 126.0, 1.0));
        ++t.gen;
      } else if (e == TAUSCH_KARTE) {
        PRUEF(t.k.rampe(12.0, 130.0, 2.0));
        ++t.gen;
      } else {
        tausch([&](Z& x) { x.off += 480.0; });
      }
      --folge;
      naechster += 512;
    }
    t.lauf(t.s + 256);
    if (t.s <= r.X + FRIST + 1024) r.max_werk = std::max(r.max_werk, t.arr.werk_stimmen());
  }
  r.kp = t.arr.warp_kein_platz();
  r.sp = t.arr.warp_spaet();
  r.ul = t.arr.warp_unterlauf();
  r.l = t.l;
  t.werk->stoppe();
  return r;
}
}  // namespace f11

// Normierte Korrelation zweier Läufe in [a, b): 1,0 heißt derselbe Klang (m7: der alte Stand spielt bis zur Frist)
namespace f11 {
double korr(const std::vector<float>& x, const std::vector<float>& y, int64_t a, int64_t b) {
  double xy = 0.0, xx = 0.0, yy = 0.0;
  for (int64_t i = std::max<int64_t>(a, 0); i < b && i < static_cast<int64_t>(std::min(x.size(), y.size())); ++i) {
    xy += static_cast<double>(x[i]) * y[i];
    xx += static_cast<double>(x[i]) * x[i];
    yy += static_cast<double>(y[i]) * y[i];
  }
  return xx > 0.0 && yy > 0.0 ? xy / std::sqrt(xx * yy) : 0.0;
}
}  // namespace f11

void fall11_frist_fenster() {
  using namespace f11;
  for (int g = 0; g < 3; ++g)
    for (int vor : {64, 256, 512, 1081, 2040, 6201}) {   // Prüfung 4 R2: Abstände über die Frist verteilt (vorher nur 1 081 und 6 201)
      const Lauf ref = fahre(static_cast<Grenze>(g), KEIN, vor);
      for (int e = 1; e < N_EREIGNIS; ++e) {
        const Lauf r = fahre(static_cast<Grenze>(g), static_cast<Ereignis>(e), vor);
        if (!r.anwendbar) continue;
        // das Fenster [max(X + 200, Ereignis + 1 024), Ereignis + Frist − 50): nicht leer bis etwa 1 800 Samples Abstand (Nachbesserung 4: ab dem Ereignis plus
        // 1 024, damit die Rampe von Mute und Solo bei 64 Samples Abstand vorbei ist)
        const int64_t X = r.X, w0 = std::max(X + 200, r.s_ev + 1024), w1 = r.s_ev + FRIST - 50;
        const bool fenster = w1 > w0 + 200;
        const double ein = fenster ? rms(r.l, w0, w1) / std::max(rms(ref.l, w0, w1), 1e-12) : -1.0;
        const double alt = fenster ? korr(r.l, ref.l, w0, w1) : -1.0;   // m7: bis zur Frist der alte Stand (die Referenz), Sample für Sample
        const double spaet = rms(r.l, X + 6000, X + 14000) / std::max(rms(ref.l, X + 6000, X + 14000), 1e-12);
        double spitze = 0.0, loch = 1e9;
        for (int64_t s = X + 480; s + 480 <= X + FRIST + 2000; s += 120) {   // ab dem Einsatz plus ein Fenster (davor zählen die Rampen der Einsätze)
          const double rr = rms(ref.l, s, s + 480);
          if (rr > 1e-3) spitze = std::max(spitze, rms(r.l, s, s + 480) / rr);
        }
        for (int64_t s = r.s_ev; s + 480 <= X + FRIST + 2000; s += 120) {
          const double rr = rms(ref.l, s, s + 480);
          if (rr > 1e-3) loch = std::min(loch, rms(r.l, s, s + 480) / rr);
        }
        const double rest = rms(r.l, g == NAHT ? X + 400 : X, X + 4000);   // nach einem Stopp; an der Naht blendet die klingende Stimme erst nach dem Einsatz aus
        // der verschobene Clip B (Beat 9): eine Beat-Länge später so laut wie B in der Referenz
        const double versch = rms(r.l, X + SPB + 2000, X + SPB + 10000) / std::max(rms(ref.l, X + 2000, X + 10000), 1e-12);
        std::printf("Fall 11 %-17s %5lld %-16s ein %6.3f alt %6.3f spaet %.3f spitze %.3f loch %.3f sprung %.4f rest %.5f versch %.3f werk %d | kp %llu sp %llu ul %llu\n", gname[g],
                    static_cast<long long>(X - r.s_ev), ename[e], ein, alt, spaet, spitze, loch, sprung(r.l, X + 100, X + FRIST + 2000), rest, versch, r.max_werk, r.kp, r.sp, r.ul);
        // Flanke R2 (Nachbesserung 4): ein Ereignis, das eine neue Stimme braucht (neues Projekt: neue IDs; Loop um), weniger als einen Block (256 Samples) vor dem
        // Einsatz: das Werk liefert erst im Block danach, der Einsatz kommt spät (gezählt) und mit Einblende; gemessen 64 Samples: kleinster Pegel 0,60 bis 0,71
        const bool r2 = (e == PROJEKT_NEU || e == LOOP_UM) && X - r.s_ev < 256;
        if (r2) PRUEF(r.kp == 0 && r.sp <= 1 && r.ul == 0 && loch > 0.8);   // Nachbesserung 5: der späte Einsatz klingt als RE-PITCH, bis der Ring liefert, dann Überblendung zweier Phasen (gemessen 0,878 bis 0,944; vorher Loch 0,60 bis 0,71, Flanke 13)
        else PRUEF(r.kp == 0 && r.sp == 0 && r.ul == 0);   // kein Platzmangel, kein später Einsatz (tausch_folge vorher: spät 1)
        if (e != SPRUNG && e != LOOP_UM) PRUEF(spitze < 1.05);   // nie doppelt (Sprung und Loop ändern den Ort: dort gilt die Referenz nicht)
        PRUEF(!fenster || ein < 1.05);
        switch (e) {
          case TAUSCH_GAIN: PRUEF(std::fabs(spaet - 0.5) < 0.02); break;   // der neue Stand gilt
          case TAUSCH_QUELLE: case TAUSCH_TONES: case TAUSCH_MARKER: case ZWEI_TAUSCHE: case TAUSCH_FOLGE: case KARTE_ZWEIMAL: case TAUSCH_KARTE:
            // durchgehend (B1, Prüfung 4: zwei Generationen oder Tausch und Karte im Fenster ließen den Clip schweigen). Quelle: zwei verschiedene Signale, die lineare
            // Überblendung hat in der Mitte −3 dB; im 10-ms-Fenster am Transport-Einsatz (Überblendung 8 Samples nach dem Einsatz) gemessen 0,787
            PRUEF(loch > (e == TAUSCH_QUELLE ? 0.75 : 0.9) && spaet > 0.97);
            PRUEF(!fenster || alt > 0.99);        // m7: bis Ereignis + Frist der alte Stand (untere Grenze; vorher nur ein < 1,05)
            break;
          case TAUSCH_REPITCH: case WARP_AUS: case CLIP_KUERZEN: case KARTE_SPAETER: case LOOP_UM:
            if (!r2) PRUEF(loch > 0.9 && spaet > 0.97);   // durchgehend, nur die Überblendung (vorher wie nachher)
            break;
          case CLIP_WEG: case STOPP: case STOPP_KNAPP:
            PRUEF(rest < 1e-4);   // vorher: stopp_knapp an der Clip-Grenze 0,0038 (ein Stück der Ausblende einer Stimme, die nie eingesetzt hat)
            break;
          case CLIP_VERSCHIEBEN:
            PRUEF(!fenster || ein < 0.01);   // vorher 1,00: der alte Ort klang bis zur Frist
            PRUEF(versch > 0.97);            // am neuen Ort rechtzeitig
            break;
          case MUTE: case SOLO: case SPRUNG: PRUEF(!fenster || ein < 0.01); break;
          case PROJEKT_NEU:
            if (vor < FRIST && !r2) PRUEF(loch > 0.9);   // vorher 0,000 an Clip-Grenze und Naht; bei 6 201 Samples ist die Lücke die der Frist (Flanke 4)
            break;
          case KARTE_JETZT: PRUEF(r.max_werk <= 3); break;   // vorher karte_jetzt an der Clip-Grenze: 4 Stimmen, doppelt
          default: break;
        }
      }
    }
}

// Fall 11b: neue Karte im Frist-Fenster, an der Lage der Klicks gemessen (Hann-Klick je Beat der 125er Quelle) gegen die neue Karte. Prüfung 3 sah die Karte im
// Wartezustand nicht: die vorab angesetzte Stimme behielt die alte Karte bis zum Ende des Clips (vorher: am Transport-Einsatz 0 von 8 Klicks in ±300 Samples).
const char* kname[] = {"keine", "später", "jetzt", "auf 100", "auf 60", "zweimal", "Tausch+K"};

void fall11_karte_lage() {
  for (int g = 0; g < 3; ++g)
    for (int vor : {1081, 2047, 6201})   // 2 047: der Einsatz liegt in den letzten Samples vor s + Frist, wo eine langsamere Karte ihn hinter die Frist schiebt (R1)
      for (int karte : {0, 1, 2, 3, 4, 5, 6}) {
        // 0 keine, 1 Rampe ab Beat 12 auf 130, 2 Rampe ab jetzt auf 135 über 1 Beat; Nachbesserung 4: 3 und 4 langsame Rampen ab jetzt auf 100 und 60 über 4 Beats
        // (R1: alte und neue Karte liegen im Fenster nah beieinander, ein Flam statt zweier getrennter Klicks), 5 zwei Generationen im Frist-Fenster (ab jetzt auf 135,
        // 512 Samples später ab Beat 14 auf 126), 6 Tausch der Marker (ein Beat weiter in der Quelle, dasselbe Raster) und 512 Samples später ab jetzt auf 135 (B1)
        Treiber t;
        PRUEF(t.mit_werk());
        auto src = hann_klicks(20 * FPB125);
        const auto bau = [&](double off, int64_t nr) {
          Bau b(nr);
          b.spur(1, ArrArt::audio);
          if (g == 0) {
            b.clip(1, "a", 0.0, 8.0, &src->a).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
            b.clip(1, "b", 8.0, 8.0, &src->a).warp({0.0, 8.0}, {off, off + 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
          } else {
            b.clip(1, "c", 0.0, 16.0, &src->a).warp({0.0, 16.0}, {off, off + 16.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
          }
          return b.fertig();
        };
        t.laden(bau(0.0, 1));
        int64_t X;
        int j0, j1;
        if (g == 2) {
          t.arr.start(4.0, 1, false, 0, 537, 256, t.k);
          X = t.arr.einsatz_sample();
          j0 = 1;
          j1 = 8;
        } else {
          t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
          if (g == 1) t.arr.loop(true, 0.0, 8.0, 0, t.k);
          t.lauf(20 * 256);
          X = t.arr.einsatz_sample() + 8 * SPB;
          j0 = g == 0 ? 9 : 1;
          j1 = g == 0 ? 15 : 7;
        }
        const double kb = t.k.beat_at(static_cast<double>(t.arr.einsatz_sample())) + (g == 1 ? 8.0 : 0.0);   // Karten-Beat des Clip-Beats 0 (Naht: des Durchlaufs danach)
        while (t.s + 256 <= X - vor) t.lauf(t.s + 256);
        if (t.s < X - vor) {   // Nachbesserung 4: genau `vor` Samples vor dem Einsatz
          t.n = static_cast<int>(X - vor - t.s);
          t.lauf(X - vor);
          t.n = 256;
        }
        const int64_t s_ev = t.s;
        const double b_jetzt = t.k.beat_at(static_cast<double>(t.s));
        if (karte == 1) { PRUEF(t.k.rampe(12.0, 130.0, 2.0)); ++t.gen; }
        if (karte == 2 || karte == 5) { PRUEF(t.k.rampe(b_jetzt, 135.0, 1.0)); ++t.gen; }
        if (karte == 3) { PRUEF(t.k.rampe(b_jetzt, 100.0, 4.0)); ++t.gen; }
        if (karte == 4) { PRUEF(t.k.rampe(b_jetzt, 60.0, 4.0)); ++t.gen; }
        if (karte == 6) t.laden(bau(static_cast<double>(FPB125), 2));
        bool zweite = karte == 5 || karte == 6;
        int hoechst = 0;
        while (t.s < std::max<int64_t>(X + 9 * SPB, static_cast<int64_t>(t.k.sample_at(kb + j1 + 1.0)) + 2048)) {
          if (zweite && t.s >= s_ev + 512) {
            zweite = false;
            if (karte == 5) PRUEF(t.k.rampe(14.0, 126.0, 1.0));
            else PRUEF(t.k.rampe(t.k.beat_at(static_cast<double>(t.s)), 135.0, 1.0));
            ++t.gen;
          }
          t.lauf(t.s + 256);
          hoechst = std::max(hoechst, t.arr.werk_stimmen());
        }
        double max_abs = 0.0, spitze = 0.0;
        int ohne = 0, n = 0;
        const auto energie = [&](int j) {   // Energie um den Klick j (±400 Samples), für den Flam (R1): ein doppelter Anschlag hat mehr Energie als ein einzelner
          const int64_t m0 = std::llround(t.k.sample_at(kb + j + 71.5 / FPB125));
          double e = 0.0;
          for (int64_t s = m0 - 400; s < m0 + 400 && s < static_cast<int64_t>(t.l.size()); ++s) e += static_cast<double>(t.l[s]) * t.l[s];
          return e;
        };
        const double flam = energie(g == 0 ? 8 : g == 1 ? 0 : j0) / std::max(energie(j1), 1e-12);   // der erste Klick des Clips gegen den letzten gemessenen
        for (int j = j0; j <= j1; ++j) {
          const double soll = t.k.sample_at(kb + j + 71.5 / FPB125);
          const double m = klick_mitte(t.l, std::llround(soll));
          if (m < -1e8) {
            ++ohne;
            continue;
          }
          max_abs = std::max(max_abs, std::fabs(m - soll));
          for (int64_t s = std::llround(soll) - 400; s < std::llround(soll) + 400 && s < static_cast<int64_t>(t.l.size()); ++s)
            spitze = std::max(spitze, static_cast<double>(std::fabs(t.l[s])));
          ++n;
        }
        std::printf("Fall 11b %-17s Karte %-7s %5lld vor dem Einsatz: Klicks %d, ohne %d, größte Abweichung %.1f Samples, Spitze %.3f, erster Klick %.3f, Werk-Stimmen höchstens %d, kp %llu sp %llu\n",
                    f11::gname[g], kname[karte], static_cast<long long>(X - s_ev), n, ohne, max_abs, spitze, flam, hoechst,
                    static_cast<unsigned long long>(t.arr.warp_kein_platz()), static_cast<unsigned long long>(t.arr.warp_spaet()));
        PRUEF(ohne == 0 && max_abs <= 24.0);   // jeder Klick im Raster der neuen Karte
        PRUEF(spitze < 0.4);                    // ein Klick, nicht zwei übereinander (vorher Clip-Grenze, Rampe ab jetzt: 0,657)
        PRUEF(flam < 1.1);                      // R1: vorher (r3) an der Clip-Grenze bei 2 047 Samples 1,519 (auf 100) und 1,330 (auf 60), nachher 0,945 und 0,886
        PRUEF(t.arr.warp_kein_platz() == 0 && t.arr.warp_spaet() == 0);
        t.werk->stoppe();
      }
}

// ---- Fall 12 (Nachbesserung 3, Prüfung 3 m1): an der Naht sucht der Vorausblick auch für den Durchlauf danach; der Vorfilter dieser Suche lässt die Clips aus, die
// vor dem Durchlauf enden, und behält die, die seinen Anfang überspannen. 31 Spuren mit je 128 Clips in der Vergangenheit (Beat 0 bis 127), Spur 1 mit einem Clip
// [1 990, 2 010), Transport ab Beat 2 000 in der Klammer 2 000 bis 2 004: an jeder Naht setzt Spur 1 vorab angesetzt ein (kein Einbruch, nicht spät).
void fall12_naht_vorfilter() {
  Treiber t;
  PRUEF(t.mit_werk());
  auto kurz = sinus(2 * FPB125, 800.0, 0.1f);
  auto lang = sinus(24 * FPB125, 1000.0, 0.2f);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "lang", 1990.0, 20.0, &lang->a).warp({0.0, 20.0}, {0.0, 20.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  for (int sp = 2; sp <= 32; ++sp) {
    b.spur(sp, ArrArt::audio);
    for (int j = 0; j < 128; ++j)
      b.clip(sp, ("c" + std::to_string(sp) + "_" + std::to_string(j)).c_str(), static_cast<double>(j), 1.0, &kurz->a).warp({0.0, 1.0}, {0.0, static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  }
  t.laden(b.fertig());
  t.arr.start(2000.0, 0, false, 0, 537, 256, t.k);
  t.arr.loop(true, 2000.0, 2004.0, 0, t.k);
  const int64_t e0 = t.arr.einsatz_sample();
  while (t.s < e0 + 4 * 4 * SPB + 2000) t.lauf(t.s + 256);   // vier Durchläufe
  const double ref = rms(t.l, e0 + 2 * SPB, e0 + 3 * SPB);
  double dip = 0.0;
  for (int n = 1; n <= 3; ++n) dip = std::min(dip, kleinster_pegel_db(t.l, e0 + n * 4 * SPB - 2000, e0 + n * 4 * SPB + 6000, ref));
  std::printf("Fall 12 (Naht, 3 968 Clips in der Vergangenheit, Spur 1 überspannt den Durchlauf): kleinster 10-ms-Pegel an den drei Nähten %.2f dB, spät %llu, kein Platz %llu, Unterlauf %llu, Stimmen im Werk %d\n",
              dip, static_cast<unsigned long long>(t.arr.warp_spaet()), static_cast<unsigned long long>(t.arr.warp_kein_platz()),
              static_cast<unsigned long long>(t.arr.warp_unterlauf()), t.arr.werk_stimmen());
  PRUEF(ref > 0.1 && dip > -3.0);
  PRUEF(t.arr.warp_spaet() == 0 && t.arr.warp_kein_platz() == 0 && t.arr.warp_unterlauf() == 0);
  t.werk->stoppe();
}

// ---- Fall 13 (Nachbesserung 3, Prüfung 3 m2; Nachbesserung 4: Marker statt Gain): Tausch bei vollem Pool. 32 Spuren mit je zwei Werk-Clips [0, 4) belegen alle 64
// Plätze; ein Tausch verschiebt die Marker aller Clips: keine Nachfolgerin findet einen Platz, jeder Clip spielt ab dem Tausch als RE-PITCH (warp_kein_platz 64). Die
// gelöste Stimme blendet dort aus; vorher spielte sie bis Tausch + ARR_WARP_FRIST unter dem RE-PITCH weiter (doppelt, der Pegel im Fenster 2,0 statt 1,0).
void fall13_tausch_pool_voll() {
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = sinus(6 * FPB125, 1000.0, 0.01f);
  // Nachbesserung 4 (R3): der Tausch verschiebt die Marker um 480 Frames (zehn Perioden des Sinus: derselbe Klang, neue Werk-Daten); ein Gain allein gleitet an der
  // gebundenen Stimme und braucht keine Nachfolgerin
  const auto bau = [&](double off, int64_t nr) {
    Bau b(nr);
    for (int sp = 1; sp <= 32; ++sp)
      for (int zwei = 0; zwei < 2; ++zwei) {
        b.spur(sp, ArrArt::audio).clip(sp, zwei ? "b" : "a", 0.0, 4.0, &src->a, 0, 1.0f);
        b.warp({0.0, 4.0}, {off, off + 4.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
      }
    return b.fertig();
  };
  t.laden(bau(0.0, 1));
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  const int64_t e0 = t.arr.einsatz_sample();
  while (t.s < e0 + 2 * SPB) t.lauf(t.s + 256);
  const int64_t s_t = t.s;
  const int werk_davor = t.arr.werk_stimmen();
  t.laden(bau(480.0, 2));
  while (t.s < e0 + 3 * SPB) t.lauf(t.s + 256);
  const double vor = rms(t.l, s_t - 8000, s_t);
  const double fenster = rms(t.l, s_t + 300, s_t + cdj::ARR_WARP_FRIST - 50) / vor;
  const double danach = rms(t.l, s_t + cdj::ARR_WARP_FRIST + 500, s_t + cdj::ARR_WARP_FRIST + 8000) / vor;
  std::printf("Fall 13 (Tausch bei vollem Pool, 64 Clips): Stimmen im Werk davor %d, kein Platz %llu, Pegel im Fenster der Frist %.3f, danach %.3f (gegen vor dem Tausch)\n", werk_davor,
              static_cast<unsigned long long>(t.arr.warp_kein_platz()), fenster, danach);
  PRUEF(werk_davor == cdj::ARR_WARP_PLAETZE && t.arr.warp_kein_platz() == 64u);
  PRUEF(fenster < 1.1 && fenster > 0.9);   // der neue Stand, einmal (alter und neuer übereinander: 2,0, phasengleich)
  PRUEF(danach < 1.1 && danach > 0.9);
}

// ---- Fall 14 (Nachbesserung 4, Prüfung 4 m8): Phase der Überblendung Brücke → Nachfolgerin, mit dem echten Werk (Bungee, synchron). Ein Clip [0, 16) COMPLEX oder
// TONES, Quelle 300 + 700 + 1 100 Hz (Periode 480 Frames); bei Beat 6 verschiebt ein Tausch die Marker um 480 Frames: derselbe Klang, neue Werk-Daten. Die Brücke
// spielt bis d = Tausch + Frist den Lauf ohne Tausch Sample für Sample weiter; danach klingt die Nachfolgerin (ein frisch angesetztes Werk). Gemessen nach der
// Überblendung: Korrelation mit dem Lauf ohne Tausch bei Versatz 0 und beim besten Versatz (±240 Samples), und der kleinste 1-ms-Pegel in der Überblendung.
// Bei gleicher Phase läge die Korrelation bei 1 und der Pegel bei 1; eine lineare Überblendung zweier Signale mit Korrelation r hat in der Mitte den Pegel
// sqrt((1 + r) / 2).
void fall14_phase() {
  for (int klicks = 0; klicks < 2; ++klicks)
  for (int modus : {cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES}) {
    const int64_t fr = 20 * FPB125;
    std::unique_ptr<Audio> src;
    if (klicks) {
      src = hann_klicks(fr);   // Gegenprobe: ein Klick je Beat, die Marker rücken einen Beat (dasselbe Raster); hier zeigt der Versatz die Zeit, nicht die Phase
    } else {
      src = std::make_unique<Audio>();
      src->d.resize(static_cast<size_t>(fr) * 2);
      for (int64_t f = 0; f < fr; ++f) {
        const double x = 2.0 * 3.14159265358979323846 * static_cast<double>(f) / 48000.0;
        src->d[2 * f] = src->d[2 * f + 1] = static_cast<float>(0.15 * std::sin(300.0 * x) + 0.1 * std::sin(700.0 * x + 0.3) + 0.07 * std::sin(1100.0 * x + 1.1));
      }
      src->fuellen(fr);
    }
    const double schub = klicks ? static_cast<double>(FPB125) : 480.0;
    std::vector<float> l[2];
    int64_t s_t = 0;
    double lage[2][4] = {};   // Klicks: Abweichung der Klick-Mitte vom Raster der Karte bei Beat 2, 5, 8 und 9 (Samples)
    for (int lauf = 0; lauf < 2; ++lauf) {
      Treiber t;
      PRUEF(t.mit_werk());
      const auto bau = [&](double off, int64_t nr) {
        Bau b(nr);
        b.spur(1, ArrArt::audio).clip(1, "c", 0.0, 16.0, &src->a).warp({0.0, 16.0}, {off, off + 16.0 * static_cast<double>(FPB125)}, modus);
        return b.fertig();
      };
      t.laden(bau(0.0, 1));
      t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
      const int64_t e0 = t.arr.einsatz_sample();
      while (t.s < e0 + 6 * SPB) t.lauf(t.s + 256);
      s_t = t.s;
      if (lauf == 1) t.laden(bau(schub, 2));
      while (t.s < e0 + 10 * SPB) t.lauf(t.s + 256);
      l[lauf] = t.l;
      if (klicks) {
        const double kb = t.k.beat_at(static_cast<double>(e0));
        const int beats[4] = {2, 5, 8, 9};
        for (int q = 0; q < 4; ++q) {
          const double soll = t.k.sample_at(kb + beats[q] + 71.5 / FPB125);
          lage[lauf][q] = klick_mitte(t.l, std::llround(soll)) - soll;
        }
      }
      t.werk->stoppe();
    }
    const int64_t d = s_t + cdj::ARR_WARP_FRIST, a = d + cdj::ARR_NAHT + 200, b = a + 2 * SPB;
    if (klicks)
      std::printf("Fall 14 Lage der Klicks gegen das Raster (%s), Beat 2/5/8/9: ohne Tausch %.1f %.1f %.1f %.1f, mit Tausch (Nachfolgerin ab Beat ~6,1) %.1f %.1f %.1f %.1f\n",
                  modus == cdj::ARR_WARP_COMPLEX ? "COMPLEX" : "TONES", lage[0][0], lage[0][1], lage[0][2], lage[0][3], lage[1][0], lage[1][1], lage[1][2], lage[1][3]);
    const double r0 = f11::korr(l[1], l[0], a, b);
    double rb = -2.0;
    int lb = 0;
    for (int lag = -240; lag <= 240; ++lag) {
      double xy = 0.0, xx = 0.0, yy = 0.0;
      for (int64_t i = a; i < b; ++i) {
        xy += static_cast<double>(l[1][i]) * l[0][i + lag];
        xx += static_cast<double>(l[1][i]) * l[1][i];
        yy += static_cast<double>(l[0][i + lag]) * l[0][i + lag];
      }
      const double r = xy / std::sqrt(xx * yy);
      if (r > rb) { rb = r; lb = lag; }
    }
    double dip = 1e9;
    for (int64_t s = d - 96; s + 48 <= d + 192; s += 8)
      if (rms(l[0], s, s + 48) > 1e-3) dip = std::min(dip, rms(l[1], s, s + 48) / rms(l[0], s, s + 48));
    std::printf("Fall 14 Phase der Überblendung (%s, %s): Korrelation nach der Überblendung %.3f bei Versatz 0, %.3f bei Versatz %d Samples; kleinster 1-ms-Pegel %.3f (%.2f dB)\n",
                klicks ? "Klicks" : "300+700+1100 Hz", modus == cdj::ARR_WARP_COMPLEX ? "COMPLEX" : "TONES", r0, rb, lb, klicks ? 0.0 : dip, klicks ? 0.0 : 20.0 * std::log10(dip));
    // Flanke m8 (Prüfung 4): nicht phasengleich. Die Zeit hält (Klicks der Nachfolgerin wie die der Brücke im Raster, ±24 Samples), die Phase der Teiltöne nicht (ein
    // frisch angesetzter Phasen-Vocoder): gemessen Korrelation −0,33 (COMPLEX) und −0,37 (TONES) bei Versatz 0, kleinster 1-ms-Pegel 0,29 und 0,33. Geprüft wird,
    // dass es nicht schlechter wird; der Hörzettel (Task 14) hat den Punkt dazu.
    if (klicks) {
      for (int q = 2; q < 4; ++q) PRUEF(std::fabs(lage[1][q]) <= LAGE_GRENZE);
    } else {
      PRUEF(dip > 0.25);
    }
  }
}

}  // namespace

// ---- Fall 15 (Nachbesserung 4, nach dem Beweislauf: GAIN_SPRUNG und UNGEHOERT machten keinen Test rot): (a) ein Gain-Tausch an einer klingenden Werk-Stimme
// gleitet über ARR_NAHT (D15, R3), gemessen als Verhältnis zum Lauf ohne Tausch Sample für Sample; (b) zwei Tausche am selben Sample klingen wie einer mit dem
// Endstand, solange eine RE-PITCH-Stimme den Clip bis zur Werk-Stimme deckt (Warp an, der Clip klang eben noch ohne Warp), und die Deckung hat kein Loch.
namespace f15 {
struct Z {
  float gain = 1.0f;
  int modus = cdj::ARR_WARP_COMPLEX;   // −1: ohne Warp
  double off = 0.0;
};
struct Lauf {
  std::vector<float> l;
  int64_t s1 = 0, s2 = 0;
};
// z0 von Beginn; am Sample s1 (Clip-Beat 8) der Tausch t1; 512 Samples später nacheinander am selben Sample die Tausche t2
Lauf fahre(const Z& z0, const std::vector<Z>& t1, const std::vector<Z>& t2) {
  Lauf r;
  Treiber t;
  PRUEF(t.mit_werk());
  auto q = Audio::sinus(40 * FPB125, 1000.0, 0.2f);
  int64_t nr = 1;
  const auto bau = [&](const Z& z) {
    Bau b(nr++);
    b.spur(1, ArrArt::audio);
    b.clip(1, "c", 0.0, 32.0, &q->a, 0, z.gain);
    if (z.modus >= 0) b.warp({0.0, 32.0}, {z.off, z.off + 32.0 * static_cast<double>(FPB125)}, z.modus);
    return b.fertig();
  };
  t.laden(bau(z0));
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(256);
  r.s1 = t.arr.einsatz_sample() + 8 * SPB;
  while (t.s + 256 <= r.s1) t.lauf(t.s + 256);
  if (t.s < r.s1) {
    t.n = static_cast<int>(r.s1 - t.s);
    t.lauf(r.s1);
    t.n = 256;
  }
  for (const Z& z : t1) t.laden(bau(z));
  r.s2 = r.s1 + 512;
  t.lauf(r.s2);
  for (const Z& z : t2) t.laden(bau(z));
  t.lauf(r.s1 + cdj::ARR_WARP_FRIST + 3 * SPB);
  r.l = t.l;
  t.werk->stoppe();
  return r;
}
}  // namespace f15

void fall15_gain_und_doppelter_tausch() {
  using namespace f15;
  {  // (a) Gain 1 → 0,5 am Sample s1 an der klingenden Werk-Stimme
    const Z z0;
    Z g = z0;
    g.gain = 0.5f;
    const Lauf ref = fahre(z0, {}, {}), r = fahre(z0, {g}, {});
    double erst = 1e9, spaeter = 0.0;
    int n = 0;
    for (int64_t t = r.s1; t < r.s1 + 24; ++t)   // die ersten 24 Samples: gleitend höchstens 1 − 0,5·24/96 = 0,875 tief
      if (std::fabs(ref.l[t]) > 0.05f) erst = std::min(erst, static_cast<double>(r.l[t] / ref.l[t]));
    for (int64_t t = r.s1 + 200; t < r.s1 + 2200; ++t)
      if (std::fabs(ref.l[t]) > 0.05f) {
        spaeter += r.l[t] / ref.l[t];
        ++n;
      }
    spaeter /= std::max(n, 1);
    std::printf("Fall 15a Gain 1 auf 0,5 an der klingenden Werk-Stimme: kleinstes Verhältnis in den ersten 24 Samples %.3f (gleitend ≥ 0,875, Sprung 0,5), danach %.3f\n",
                erst, spaeter);
    PRUEF(erst > 0.85 && erst < 1.01);
    PRUEF(std::fabs(spaeter - 0.5) < 0.01);
  }
  {  // (b) ohne Warp → COMPLEX am Sample s1 (RE-PITCH deckt bis s1 + Frist), am Sample s2 zwei Marker-Tausche gegen einen mit dem Endstand
    Z z0;
    z0.modus = -1;
    Z an = z0;
    an.modus = cdj::ARR_WARP_COMPLEX;
    Z m1 = an, m2 = an;
    m1.off = 480.0;
    m2.off = 960.0;
    const Lauf ref = fahre(z0, {}, {}), zwei = fahre(z0, {an}, {m1, m2}), einer = fahre(z0, {an}, {m2});
    const int64_t a = zwei.s2, b = zwei.s1 + cdj::ARR_WARP_FRIST - 100;   // bis kurz vor der Werk-Stimme: nur die RE-PITCH-Deckung klingt
    double diff = 0.0, loch = 1e9;
    for (int64_t t = a; t < b; ++t) diff = std::max(diff, static_cast<double>(std::fabs(zwei.l[t] - einer.l[t])));
    for (int64_t s = a + 200; s + 480 <= b; s += 120) loch = std::min(loch, rms(einer.l, s, s + 480) / std::max(rms(ref.l, s, s + 480), 1e-12));
    std::printf("Fall 15b zwei Marker-Tausche am selben Sample unter der RE-PITCH-Deckung: größte Abweichung von einem Tausch mit dem Endstand %.6f, kleinster 10-ms-Pegel %.3f\n",
                diff, loch);
    PRUEF(diff < 1e-4);   // die eben gestartete Stimme des ersten Tauschs hat nie geklungen und klingt nicht aus
    PRUEF(loch > 0.9);    // die Deckung hält bis zur Werk-Stimme
  }
}

// ---- Fall 16 (Nachbesserung 5, Prüfung 5 fable M1 und opus F1, die Klasse „Platz ohne Klang“): 24 und 32 Spuren, je A [0, 8) und B [8, 16) COMPLEX (Sinus 1 kHz,
// gleicher Versatz: die Summe ist ein Sinus), Pool 64. (a) Eine Loop-Klammer 0..8 wird D Samples vor ihrer Naht gesetzt, die auf der Grenze A → B liegt: B ist vorab
// angesetzt und klingt mit der Klammer nie, hielt aber vorher seinen Platz bis zur Naht; der Vorausblick für A′ (Durchlauf danach) fand keinen (3 · 32 = 96 für 64) und
// gab still auf; an der Naht setzte clips_starten A′ erst bei Naht + Frist an: 43 ms Stille auf 3N − 64 Spuren (32 von 32, 8 von 24), kein Zähler. Jetzt gibt B seinen
// Platz im Block der Klammer (werk_decken Punkt 0), A′ wird mit Vorlauf D angesetzt; unter einem Block (D 64) ist sein Ring zur Naht leer (spät, gezählt) und RE-PITCH
// deckt bis zum ersten Ring-Block. Referenz: dieselbe Klammer vom Start an. (b) Loop bei vollem Pool: 32 Spuren mit je zwei Clips [0, 8) (einer stumm, Gain 0) in der
// Klammer 0..8 vom Start an belegen alle 64 Plätze; der Vorausblick für den Durchlauf danach findet keinen, an der Naht gibt stimmen_naht alle frei und clips_starten
// setzt den neuen Durchlauf an: vorher schwieg jeder Clip eine Frist lang (43 ms an jeder Naht, ungezählt), jetzt klingt er ab der Naht als RE-PITCH (spät 64, gezählt)
// und blendet in das Werk über. Referenz: ein Clip je Spur (der Vorausblick setzt den Durchlauf danach rechtzeitig an).
namespace f16 {
struct Lauf {
  std::vector<float> l;
  std::vector<std::vector<float>> spitze;   // [Block][Spur] Spitze nach dem Fader
  std::vector<int64_t> blk;                 // Anfang je Block (am Ereignis ist einer kürzer)
  int64_t X = 0;
  unsigned long long kp = 0, sp = 0, ul = 0;
};
Lauf fahre(int spuren, int D, bool referenz, bool nachzuegler) {
  Lauf r;
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = sinus(20 * FPB125, 1000.0, 0.02f);
  Bau b;
  for (int sp = 1; sp <= spuren; ++sp) {
    b.spur(sp, ArrArt::audio);
    if (nachzuegler) {   // (b): je Spur C [0, 8) und, nur im Ereignislauf, der stumme D [0, 8): 64 Plätze
      b.clip(sp, ("c" + std::to_string(sp)).c_str(), 0.0, 8.0, &src->a, 0, 1.0f).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
      if (!referenz) b.clip(sp, ("d" + std::to_string(sp)).c_str(), 0.0, 8.0, &src->a, 0, 0.0f).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
      continue;
    }
    b.clip(sp, ("a" + std::to_string(sp)).c_str(), 0.0, 8.0, &src->a, 0, 1.0f).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    b.clip(sp, ("b" + std::to_string(sp)).c_str(), 8.0, 8.0, &src->a, 0, 1.0f).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  }
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  if (nachzuegler || referenz) t.arr.loop(true, 0.0, 8.0, 0, t.k);
  const auto block = [&](int64_t bis) {   // Blöcke zu 256, der letzte kürzer: das Ereignis liegt genau bei bis
    while (t.s < bis) {
      const int n0 = t.n;
      if (t.s + t.n > bis) t.n = static_cast<int>(bis - t.s);
      r.blk.push_back(t.s);
      t.lauf(t.s + t.n);
      t.n = n0;
      std::vector<float> sp(static_cast<size_t>(spuren));
      for (int i = 0; i < spuren; ++i) sp[static_cast<size_t>(i)] = t.arr.spitze_lesen(i);
      r.spitze.push_back(std::move(sp));
    }
  };
  block(20 * 256);
  r.X = t.arr.einsatz_sample() + 8 * SPB;
  block(r.X - D);
  if (!nachzuegler && !referenz) t.arr.loop(true, 0.0, 8.0, t.s, t.k);
  block(r.X + 3 * SPB);
  r.kp = t.arr.warp_kein_platz();
  r.sp = t.arr.warp_spaet();
  r.ul = t.arr.warp_unterlauf();
  r.l = t.l;
  t.werk->stoppe();
  return r;
}
}  // namespace f16

void fall16_platz_ohne_klang() {
  using namespace f16;
  for (int spuren : {24, 32})
    for (int D : {64, 1081, 2040}) {
      const Lauf ref = fahre(spuren, D, true, false), r = fahre(spuren, D, false, false);
      const int64_t X = r.X;
      // 1-ms-Verhältnis der Summe gegen die Referenz in [X − Frist, X + Frist + 4 000): Fenster unter 0,5 jenseits einer Überblendung (Lauflänge > 3) sind ein Loch
      double mn = 1e9;
      long lang_loch = 0;
      int lauf = 0;
      for (int64_t s = X - cdj::ARR_WARP_FRIST; s + 48 <= X + cdj::ARR_WARP_FRIST + 4000; s += 48) {
        const double rr = rms(ref.l, s, s + 48);
        if (rr < 1e-5) { lauf = 0; continue; }
        const double q = rms(r.l, s, s + 48) / rr;
        mn = std::min(mn, q);
        if (q < 0.5) { if (++lauf > 3) ++lang_loch; } else lauf = 0;
      }
      // je Spur: Blöcke in [X, X + Frist + 2 000) mit Spitze unter 0,3 der Referenz; zwei in Folge sind ein Loch dieser Spur (bei 24 Spuren schwiegen vorher 8 von 24, die Summe sah es kaum)
      int loch_spuren = 0;
      for (int i = 0; i < spuren; ++i) {
        int folge = 0, max_folge = 0;
        for (size_t q = 0; q < r.spitze.size() && q < ref.spitze.size(); ++q) {
          const int64_t s0 = r.blk[q];
          if (s0 < X || s0 >= X + cdj::ARR_WARP_FRIST + 2000) continue;
          const float rs = ref.spitze[q][static_cast<size_t>(i)];
          if (rs > 1e-4f && r.spitze[q][static_cast<size_t>(i)] < 0.3f * rs) max_folge = std::max(max_folge, ++folge);
          else folge = 0;
        }
        loch_spuren += max_folge >= 2;
      }
      const double hz = frequenz(r.l, X + 400, X + 1800);   // nach der Deckung (D 64: bis zum Ende des Blocks plus Naht) klingt das Werk mit 1 000 Hz, RE-PITCH mit 1 024
      std::printf("Fall 16 Loop-Klammer %lld Samples vor der Naht, %d Spuren: kleinstes 1-ms-Verhältnis %.3f, Loch (lang) %ld Fenster, Spuren mit Loch %d, Frequenz nach dem Einsatz %.1f Hz | kp %llu sp %llu ul %llu\n",
                  static_cast<long long>(D), spuren, mn, lang_loch, loch_spuren, hz, r.kp, r.sp, r.ul);
      PRUEF(lang_loch == 0 && loch_spuren == 0);                                 // vorher: 40 Fenster, 32 von 32 bzw. 8 von 24 Spuren
      PRUEF(r.kp == 0 && r.ul == 0 && r.sp == (D < 256 ? static_cast<unsigned long long>(spuren) : 0u));   // unter einem Block spät (gedeckt), sonst rechtzeitig
      PRUEF(hz > 988.0 && hz < 1012.0);                                           // das Werk, nicht die Deckung (Mutation PLATZ_OHNE_KLANG: 1 024 Hz bis Naht + Frist)
    }
  {
    const Lauf ref = fahre(32, 1081, true, true), r = fahre(32, 1081, false, true);
    const int64_t X = r.X;
    double mn = 1e9;
    long lang_loch = 0;
    int lauf = 0;
    for (int64_t s = X - 2000; s + 48 <= X + cdj::ARR_WARP_FRIST + 4000; s += 48) {
      const double rr = rms(ref.l, s, s + 48);
      if (rr < 1e-5) { lauf = 0; continue; }
      const double q = rms(r.l, s, s + 48) / rr;
      mn = std::min(mn, q);
      if (q < 0.5) { if (++lauf > 3) ++lang_loch; } else lauf = 0;
    }
    int loch_spuren = 0;
    for (int i = 0; i < 32; ++i) {
      int folge = 0, max_folge = 0;
      for (size_t q = 0; q < r.spitze.size() && q < ref.spitze.size(); ++q) {
        const int64_t s0 = r.blk[q];
        if (s0 < X || s0 >= X + cdj::ARR_WARP_FRIST + 2000) continue;
        const float rs = ref.spitze[q][static_cast<size_t>(i)];
        if (rs > 1e-4f && r.spitze[q][static_cast<size_t>(i)] < 0.3f * rs) max_folge = std::max(max_folge, ++folge);
        else folge = 0;
      }
      loch_spuren += max_folge >= 2;
    }
    const double hz_deckung = frequenz(r.l, X + 300, X + 1700), hz_werk = frequenz(r.l, X + cdj::ARR_WARP_FRIST + 400, X + cdj::ARR_WARP_FRIST + 1800);
    std::printf("Fall 16 Loop bei vollem Pool (64 Clips, Plätze erst an der Naht frei): kleinstes 1-ms-Verhältnis %.3f, Loch (lang) %ld Fenster, Spuren mit Loch %d, Frequenz in der Frist %.1f Hz, danach %.1f Hz | kp %llu sp %llu ul %llu\n",
                mn, lang_loch, loch_spuren, hz_deckung, hz_werk, r.kp, r.sp, r.ul);
    PRUEF(lang_loch == 0 && loch_spuren == 0);                                  // vorher: 43 ms Stille auf allen 32 Spuren an der Naht
    PRUEF(r.kp == 0 && r.sp == 64 && r.ul == 0);                                // alle 64 Einsätze spät (der Ring beginnt bei Naht + Frist), gezählt und gedeckt
    PRUEF(hz_deckung > 1012.0 && hz_werk > 988.0 && hz_werk < 1012.0);         // in der Frist die Deckung (RE-PITCH, 1 024 Hz), danach das Werk
  }
}

// ---- Fall 17 (Nachbesserung 5, Prüfung 5 fable m6): Start bei laufendem Transport und Stopp im selben Block. Der Start schickt die klingende Werk-Stimme in die Ausblende
// (stopp, beende) und wartet; der Stopp im Wartezustand gab vorher ALLE Werk-Stimmen frei, auch die ausblendende: harter Schnitt (Knack). Jetzt nur die, die nie geklungen haben.
void fall17_start_stopp_im_block() {
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = sinus(10 * FPB125, 1000.0, 0.5f);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c", 0.0, 8.0, &src->a).warp({0.0, 8.0}, {0.0, 8.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  while (t.s < 2 * SPB) t.lauf(t.s + 256);
  const int64_t s = t.s;
  t.arr.start(0.0, 0, false, s, 537, 256, t.k);   // läuft schon: Kurzblende ab s, der neue Start wartet
  t.arr.stopp(0, s, t.k);                          // im selben Zyklus: der wartende Start fällt
  t.lauf(s + 4000);
  const double blende = rms(t.l, s, s + cdj::ARR_NAHT);   // die Ausblende klingt (linear über 96 Samples: RMS rund 0,5 / √2 · √(1/3) = 0,20); hart geschnitten: 0
  const double sprung = f11::sprung(t.l, s - 100, s + 400);   // 1 kHz mit Spitze 0,5 steigt höchstens 0,065 je Sample, die Blende dazu 0,005
  const double rest = rms(t.l, s + cdj::ARR_NAHT + 50, s + 4000);
  std::printf("Fall 17 Start und Stopp im selben Block: Pegel der Ausblende %.3f, größter Sprung %.4f, Rest danach %.6f, Stimmen %d, im Werk %d\n", blende, sprung, rest, t.arr.stimmen(), t.arr.werk_stimmen());
  PRUEF(blende > 0.1 && sprung < 0.12);   // vorher: 0,000 und bis 0,5 (Mutation STOPP_WARTET_HART)
  PRUEF(rest < 1e-4 && t.arr.stimmen() == 0 && t.arr.werk_stimmen() == 0);
}

// ---- Fall 18 (Slice 5, AK9 live): die Tonhöhe ändert sich beim Spielen. Der Clip klingt 1000 Hz, ab dem Tausch +7 st: alter Klang bis ARR_WARP_FRIST, neuer danach
// (1498,31 Hz +-2 ct), ohne Einbruch, mit genau einer neuen Stimme im Werk. Gegenprobe: derselbe pitch noch einmal geladen (neuer Schnappschuss) ändert nichts (keine Stimme).
void fall18_transpose_tausch() {
  Treiber t;
  PRUEF(t.mit_werk());
  auto a = sinus(34 * FPB125, 1000.0);
  const double p7 = std::pow(2.0, 7.0 / 12.0);
  const auto bauen = [&](double pitch) {
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 32.0, &a->a).warp({0.0, 32.0}, {0.0, 32.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX, pitch);
    return b.fertig();
  };
  t.laden(bauen(1.0));
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(5 * 22500);
  const int64_t s_t = t.s;
  const uint64_t ansaetze0 = t.werk->zaehler().ansaetze;
  t.laden(bauen(p7));
  t.lauf(s_t + 30000);
  int64_t neu = -1;
  for (int64_t s = s_t; s + 480 < static_cast<int64_t>(t.l.size()); s += 48)
    if (frequenz_schnell(t.l, s, s + 480) > 1250.0) {
      neu = s;
      break;
    }
  const double ref = rms(t.l, s_t - 20000, s_t - 5000);
  const double dip = kleinster_pegel_db(t.l, s_t - 2000, s_t + 6000, ref);
  const double hz = frequenz(t.l, s_t + 12000, s_t + 28000);
  const double ct = 1200.0 * std::log2(hz / (1000.0 * p7));
  std::printf("Fall 18 Transpose-Tausch: Tausch bei %lld, der neue Klang (> 1,25 kHz) ab +%lld (Frist %d + Zyklus 256), %.2f Hz (%+.2f ct vom Soll), kleinster 10-ms-Pegel %.2f dB, Ansätze +%llu\n",
              static_cast<long long>(s_t), static_cast<long long>(neu - s_t), cdj::ARR_WARP_FRIST, hz, ct, dip, static_cast<unsigned long long>(t.werk->zaehler().ansaetze - ansaetze0));
  PRUEF(neu > 0 && neu - s_t <= cdj::ARR_WARP_FRIST + 256);
  PRUEF(neu - s_t >= cdj::ARR_WARP_FRIST - 480);   // der alte Klang spielt bis dahin aus seinem Ring
  PRUEF(std::fabs(ct) < 2.0);
  PRUEF(ref > 0.1 && dip > -3.0);
  PRUEF(t.werk->zaehler().ansaetze == ansaetze0 + 1);   // genau eine neue Stimme
  PRUEF(t.arr.warp_spaet() == 0 && t.arr.warp_unterlauf() == 0 && t.arr.warp_kein_platz() == 0);
  // Gegenprobe: gleicher pitch, neuer Schnappschuss -> keine neue Stimme, kein Dip
  const int64_t s_g = t.s;
  const uint64_t davor = t.werk->zaehler().ansaetze;
  t.laden(bauen(p7));
  t.lauf(s_g + 6000);
  PRUEF(t.werk->zaehler().ansaetze == davor);
}

// ---- Fall 19 (Slice 5, AK9 Klick-Lage im Arrangement): Klick-Loop 125 -> 128 BPM, COMPLEX, 32 Beats, bei pitch 1 (Bezug), +7 st und -12 st: Lage <= 24 Samples + u (D9), Steigung < 4 Samples je 16 Beats
void fall19_transpose_lage(double pitch, const char* name) {
  Treiber t;
  PRUEF(t.mit_werk());
  auto src = hann_klicks(34 * FPB125);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 32.0, &src->a).warp({0.0, 32.0}, {0.0, 32.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX, pitch);
  t.laden(b.fertig());
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  t.lauf(static_cast<int64_t>(t.k.sample_at(34.0)));
  const int64_t s_c = t.arr.einsatz_sample();
  // lage_messen (Kreuzkorrelation mit dem 1-kHz-Impuls) taugt bei pitch != 1 nicht: der Klick trägt dort 1000·pitch Hz. Der Messer ist die Hüllkurve (lage_huelle.h), geeicht an Klicks bekannter Lage.
  const double u = lagetest::eichung();
  const double grenze = LAGE_GRENZE + std::ceil(2.0 * u) / 2.0;
  const lagetest::Ergebnis g = lagetest::messen(t.l, 1, 29, [&](int k) { return t.k.sample_at(t.k.beat_at(static_cast<double>(s_c)) + k + 71.5 / FPB125); });
  std::printf("Fall 19 (%s): Eichung u = %.2f, 29 Klicks nach der Hüllkurve, größte Abweichung %.2f Samples (Grenze %.1f, Reserve %.2f), Steigung %.3f Samples je 16 Beats\n", name, u, g.max_abs, grenze, grenze - g.max_abs,
              g.steigung_je_16);
  PRUEF(u <= 2.0);
  PRUEF(g.ok);
  PRUEF(g.max_abs <= grenze);
  PRUEF(std::fabs(g.steigung_je_16) < STEIGUNG_GRENZE);
}

int main() {
  for (double bpm : {128.0, 120.0})
    for (int modus : {cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES}) fall1(bpm, modus);
  for (int modus : {cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES}) fall1_ton(modus);
  fall1_ohne_warp();
  fall2_anfang();
  fall2_start_mitten();
  fall2_naht();
  fall2_tausch();
  fall3();
  fall4_ausfall();
  fall4_pool();
  fall4_nachzuegler();
  fall5();
  fall6();
  fall7_grenze();
  fall7b_nachholen();
  fall8_einmal();
  fall9_viele_clips();
  fall10_tausch_an_der_grenze();
  fall11_frist_fenster();
  fall11_karte_lage();
  fall12_naht_vorfilter();
  fall13_tausch_pool_voll();
  fall14_phase();
  fall15_gain_und_doppelter_tausch();
  fall16_platz_ohne_klang();
  fall17_start_stopp_im_block();
  fall18_transpose_tausch();
  fall19_transpose_lage(1.0, "0 st (Bezug)");
  fall19_transpose_lage(std::pow(2.0, 7.0 / 12.0), "+7 st");
  fall19_transpose_lage(0.5, "-12 st");
  PRUEF_ENDE();
}
