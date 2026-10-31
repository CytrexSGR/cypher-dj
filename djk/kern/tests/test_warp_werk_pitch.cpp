// Paket 1.13 Warp, Slice 5 (AK9): das Warp-Werk allein mit pitch != 1, synchron (faeden 0), COMPLEX und TONES.
//  1  Ton      Sinus 1 kHz, 125 -> 128 BPM: +7 st = 1498,31 Hz +-2 ct (AK9), -12 st = 500 Hz, +12 st = 2000 Hz, +50 ct = 1029,30 Hz, jeweils je 100-ms-Fenster
//  2  Gegenprobe pitch 1 liefert 1000 Hz (Messer) und ist wiederholbar (zwei Läufe desselben Codes, Bit für Bit). **Kein** Vergleich mit dem Stand vor Slice 5: den macht test_warp_werk_strom (Task 0, D10)
//  3  Lage     Hann-Klick auf jedem Beat (125-BPM-Quelle) im 128-BPM-Projekt bei 0 (Bezug) / +7 / -12 / +12 st (gegatet) und +-24 st (Bericht): Messer = Hüllkurve (lage_huelle.h, D9),
//              zuerst geeicht an synthetischen Klicks (Unschärfe u); Gate = 24 Samples (Slice-2-D6 a) + u, Steigung < 4 Samples je 16 Beats
//              (ein Ton verrät eine falsche Korn-Abstandsrechnung nicht, ein Klick-Loop schon: Mutation HOP_FEST)
//  4  Epoche   ein neuer Auftrag mit anderem pitch auf demselben Platz klingt in der neuen Tonhöhe (die Stimme übernimmt pitch aus dem Auftrag: Mutation PITCH_VERGESSEN)
// Mutationen (WILL_FAIL): WARP_PITCH_VERGESSEN (Fall 1: uebernehmen kopiert pitch nicht, alles klingt 1000 Hz), WARP_HOP_FEST (Fall 3: gout_ += Hop statt Hop / pitch).
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <memory>
#include <thread>
#include <vector>

#include "arr_bau.h"
#include "cypherdj/warp_werk.h"
#include "lage_huelle.h"
#include "pruef.h"

bool g_waechter = false;

namespace {
constexpr int64_t FPB125 = 23040;
constexpr int64_t SPB = arrtest::SPB;
constexpr int HANN = 144;
constexpr double LAGE_GRENZE = 24.0;   // Slice-2-D6 (a), wie test_warp_werk_arr.cpp:194

struct Quelle {
  std::unique_ptr<arrtest::Audio> audio;
  std::vector<double> beat{0.0, 16.0}, frame{0.0, 16.0 * static_cast<double>(FPB125)};
  cdj::ArrWarp warp;
  cdj::ArrClip clip{};
  Quelle(std::unique_ptr<arrtest::Audio> a, int modus, double pitch) : audio(std::move(a)) {
    warp.modus = modus;
    warp.n = 2;
    warp.beat = beat.data();
    warp.frame = frame.data();
    warp.pitch = pitch;
    clip.id = 1;
    clip.start_beat = 0.0;
    clip.laenge_beats = 16.0;
    clip.audio = &audio->a;
    clip.gain = 1.0f;
    clip.warp = &warp;
  }
};

cdj::WarpAnsatz auftrag(const Quelle& q, int64_t s_c, int64_t s_h) {
  cdj::WarpAnsatz a;
  a.clip = &q.clip;
  a.s_h = s_h;
  a.s_ende = s_c + 16 * SPB;
  a.beat_versatz = -static_cast<double>(s_c) / static_cast<double>(SPB);
  a.karte = cdj::Karte(128.0, 0);
  return a;
}

bool lies(cdj::WarpWerk& w, int p, int64_t s_h, int64_t n, std::vector<float>& l, std::vector<float>& r) {
  l.assign(static_cast<size_t>(n), 0.0f);
  r.assign(static_cast<size_t>(n), 0.0f);
  const auto frist = std::chrono::steady_clock::now() + std::chrono::seconds(3);
  for (int64_t s = s_h; s < s_h + n; s += 256) {
    const int m = static_cast<int>(std::min<int64_t>(256, s_h + n - s));
    w.takt(s);
    while (!w.ring(p).lies(s, m, l.data() + (s - s_h), r.data() + (s - s_h))) {
      if (std::chrono::steady_clock::now() > frist) return false;
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
      w.takt(s);
    }
  }
  return true;
}

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

// Hann-Impuls mit Träger hz (144 Samples); bei pitch p behält ein Klick seine Länge (Fall 3 misst nur die Hüllkurve)
std::vector<float> hann(double hz) {
  std::vector<float> h(HANN);
  for (int i = 0; i < HANN; ++i)
    h[static_cast<size_t>(i)] = static_cast<float>(0.5 * std::sin(2 * M_PI * hz * i / 48000.0) * 0.5 * (1 - std::cos(2 * M_PI * i / 143.0)));
  return h;
}

}  // namespace

int main() {
  auto werk = cdj::warp_werk_neu({});
  PRUEF(werk != nullptr);
  if (!werk) PRUEF_ENDE();
  const int64_t S_C = 10000;
  // ---- 1 und 2: Ton
  const struct { double st, ct; double hz; } toene[] = {{7, 0, 1498.3070768766815}, {-12, 0, 500.0}, {12, 0, 2000.0}, {0, 50, 1029.3022366434919}, {0, 0, 1000.0}};
  for (int modus : {cdj::ARR_WARP_COMPLEX, cdj::ARR_WARP_TONES}) {
    for (const auto& t : toene) {
      const double pitch = std::pow(2.0, t.st / 12.0 + t.ct / 1200.0);
      Quelle q(arrtest::Audio::sinus(17 * FPB125, 1000.0, 0.5f), modus, pitch);
      const int p = werk->belege();
      PRUEF(p >= 0);
      cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
      werk->ansetzen(p, a);
      std::vector<float> l, r;
      PRUEF(lies(*werk, p, S_C, 6 * SPB, l, r));
      const double ct = max_ct(l, 4800, 6 * SPB - 4800, t.hz);   // erstes und letztes Fenster sind Ein- und Ausschwingen
      std::printf("Fall 1 (%s, %+.0f st %+.0f ct, pitch %.6f): größte Abweichung von %.2f Hz: %.2f ct\n", modus == cdj::ARR_WARP_COMPLEX ? "COMPLEX" : "TONES", t.st, t.ct, pitch, t.hz, ct);
      PRUEF(ct < 2.0);
      werk->gib(p);
    }
  }
  // ---- 2: pitch 1 gleich pitch nicht gesetzt (Bit für Bit)
  {
    Quelle a1(arrtest::Audio::klicks(17 * FPB125, 11520), cdj::ARR_WARP_COMPLEX, 1.0), a0(arrtest::Audio::klicks(17 * FPB125, 11520), cdj::ARR_WARP_COMPLEX, 1.0);
    std::vector<float> l0, r0, l1, r1;
    for (int k = 0; k < 2; ++k) {
      Quelle& q = k ? a1 : a0;
      const int p = werk->belege();
      cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
      werk->ansetzen(p, a);
      PRUEF(lies(*werk, p, S_C, 48000, k ? l1 : l0, k ? r1 : r0));
      werk->gib(p);
    }
    int ungleich = 0;
    for (size_t i = 0; i < l0.size(); ++i) ungleich += (l0[i] != l1[i] || r0[i] != r1[i]) ? 1 : 0;
    PRUEF(ungleich == 0);   // Wiederholbarkeit (Voraussetzung für den Null-Test), nicht mehr; der Vergleich mit dem Strom von VOR Slice 5 ist test_warp_werk_strom (Task 0, Step 6 unten)
  }
  // ---- 3: Klick-Lage (Prüfung r1 M2, D9). Messer: Hüllkurve (lage_huelle.h), unabhängig von der Trägerphase. Eichung zuerst (Positivkontrolle an Klicks, die nicht von Bungee stammen).
  //      Gate je pitch = LAGE_GRENZE + u. 0 st ist der Bezug: liegt schon er über der Grenze, ist es das Messer und kein Befund.
  {
    const double u = lagetest::eichung();
    std::printf("Fall 3 Eichung: Messer-Unschärfe u = %.2f Samples\n", u);
    PRUEF(u <= 2.0);
    const double grenze = LAGE_GRENZE + std::ceil(2.0 * u) / 2.0;
    const struct { double st; const char* name; bool tor; } lagen[] = {{0, "0 st (Bezug)", true}, {7, "+7 st", true}, {-12, "-12 st", true}, {12, "+12 st", true},
                                                                         {24, "+24 st (Rand, nur Bericht)", false}, {-24, "-24 st (Rand, nur Bericht)", false}};
    for (const auto& e : lagen) {
      const double pitch = std::pow(2.0, e.st / 12.0);
      Quelle q(arrtest::Audio::gleich(17 * FPB125, 0.0f), cdj::ARR_WARP_COMPLEX, pitch);
      const std::vector<float> h = hann(1000.0);   // die Quelle trägt 1 kHz; was Bungee daraus macht, misst die Hüllkurve
      for (int64_t k = 0; k * FPB125 + HANN < 17 * FPB125; ++k)
        for (int i = 0; i < HANN; ++i) q.audio->d[static_cast<size_t>(2 * (k * FPB125 + i))] = q.audio->d[static_cast<size_t>(2 * (k * FPB125 + i) + 1)] = h[static_cast<size_t>(i)];
      q.audio->fuellen(17 * FPB125);
      const int p = werk->belege();
      PRUEF(p >= 0);
      cdj::WarpAnsatz a = auftrag(q, S_C, S_C);
      werk->ansetzen(p, a);
      std::vector<float> l, r;
      PRUEF(lies(*werk, p, S_C, 15 * SPB, l, r));
      // Klick 0 liegt im Einschwingen, die letzten im Ausschwingen; Mitte des Klicks k relativ zu s_h
      const lagetest::Ergebnis g = lagetest::messen(l, 1, 13, [](int k) { return static_cast<double>(k) * static_cast<double>(SPB) + 71.5 * static_cast<double>(SPB) / static_cast<double>(FPB125); });
      std::printf("Fall 3 (%s, pitch %.4f): größte Abweichung %.2f Samples (Grenze %.1f, Reserve %.2f), Steigung %.3f Samples je 16 Beats\n", e.name, pitch, g.max_abs, grenze, grenze - g.max_abs, g.steigung_je_16);
      PRUEF(g.ok);
      if (e.tor) {
        PRUEF(g.max_abs <= grenze);
        PRUEF(std::fabs(g.steigung_je_16) < 4.0);
      }
      werk->gib(p);
    }
  }
  // ---- 4: ein zweiter Auftrag auf demselben Platz mit anderem pitch
  {
    Quelle q1(arrtest::Audio::sinus(17 * FPB125, 1000.0, 0.5f), cdj::ARR_WARP_COMPLEX, 1.0), q2(arrtest::Audio::sinus(17 * FPB125, 1000.0, 0.5f), cdj::ARR_WARP_COMPLEX, std::pow(2.0, 7.0 / 12.0));
    const int p = werk->belege();
    cdj::WarpAnsatz a1 = auftrag(q1, S_C, S_C);
    werk->ansetzen(p, a1);
    std::vector<float> l, r;
    PRUEF(lies(*werk, p, S_C, 2 * SPB, l, r));
    PRUEF(max_ct(l, 4800, 2 * SPB - 4800, 1000.0) < 2.0);
    cdj::WarpAnsatz a2 = auftrag(q2, S_C, S_C + 3 * SPB);
    werk->ansetzen(p, a2);
    PRUEF(lies(*werk, p, S_C + 3 * SPB, 4 * SPB, l, r));
    PRUEF(max_ct(l, 4800, 4 * SPB - 4800, 1498.3070768766815) < 2.0);
    werk->gib(p);
  }
  PRUEF_ENDE();
}
