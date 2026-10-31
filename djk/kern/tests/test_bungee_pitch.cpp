// Paket 1.13 Warp, Slice 5, Task 1: Bungee Basic mit pitch != 1 (Positions-API, resampleMode_autoOut wie die Warp-Maschine), ohne den Kern.
//  1. 1-kHz-Sinus bei Geschwindigkeit 1,024 und pitch 0,5 / 2^(-7/12) / 1 / 2^(7/12) / 2 / 4: Ausgabefrequenz = 1000 · pitch, +-2 ct (Messer: wie test_bungee_smoke)
//  2. Positionsabstand: Request.position nach next() liegt um speed · Hop / pitch weiter (Kontrolle von Timing.cpp:next(); der Beleg für gout_ += Hop / pitch in der Maschine ist Task 3 Fall 3 + Mutation HOP_FEST)
//  3. Korn-Länge: im Mittel Hop / pitch Ausgabeframes je Korn (+-1 %), nie mehr als Hop · 4 + 1 (maxOutputFrameCount bei maxPitchOctaves = 2)
//  4. Gegenprobe des Messers: dieselbe Quelle ohne pitch (1,0) liegt bei 1000 Hz, die Messung unterscheidet also 2^(7/12) von 1 um 700 ct
// Mit BUNGEE_PITCH_GRENZE=1 laufen zusätzlich, mit ZWEI Kanälen wie die Maschine (warp_werk_bungee.cpp:24), pitch 0,25 / 0,2431 / 0,125 / 0,0625 / 8 / 16 / 16,7 und MELDEN (kein PRUEF), was sie liefern.
// Kanal 1 bekommt Stille: Energie dort ist Überlauf aus Kanal 0 (liegt der Überlauf innerhalb eines Vektors, sieht ASan ihn nicht; BUNGEE_SELF_TEST=0, die Bungee-Asserts sind wegkompiliert).
// Die ersten drei Zeilen der Grenzliste (0,5 / +7 st / 4) sind die Referenz für das Nebensprechen.
#include <bungee/Bungee.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

#include "pruef.h"

namespace {
constexpr int SR = 48000;

double frequenz(const std::vector<float>& l, size_t a, size_t b) {
  double erst = -1, letzt = -1;
  int n = 0;
  for (size_t i = a + 1; i < b; ++i)
    if (l[i - 1] < 0.0f && l[i] >= 0.0f) {
      const double t = static_cast<double>(i - 1) + static_cast<double>(-l[i - 1]) / static_cast<double>(l[i] - l[i - 1]);
      if (erst < 0) erst = t;
      letzt = t;
      ++n;
    }
  return n < 2 ? 0.0 : (n - 1) * SR / (letzt - erst);
}
double cent(double f, double soll) { return 1200.0 * std::log2(f / soll); }

struct Messung {
  double hz = 0.0, frames_je_korn = 0.0, abstand_fehler = 0.0, neben_db = -999.0, pegel0_db = -999.0;   // pegel0_db: RMS von Kanal 0 im Messfenster (Zeuge gegen stille Ausgabe)
  int max_korn = 0, max_eingabe = 0, eingabe_puffer = 0;
};

Messung miss(double pitch, double speed, int hop, int log2_adjust, int kanaele = 1) {
  using St = Bungee::Stretcher<Bungee::Basic>;
  const int N = 12 * SR;
  std::vector<float> q(static_cast<size_t>(N));
  for (int i = 0; i < N; ++i) q[static_cast<size_t>(i)] = static_cast<float>(0.5 * std::sin(2.0 * M_PI * 1000.0 * i / SR));
  St st(Bungee::SampleRates{SR, SR}, kanaele, log2_adjust);
  const size_t stride = static_cast<size_t>(st.maxInputFrameCount());
  std::vector<float> in(static_cast<size_t>(kanaele) * stride, 0.0f), aus, aus1;   // Kanal 1 (falls vorhanden) bleibt still
  Bungee::Request req{};
  req.position = 2.0 * SR;
  req.speed = speed;
  req.pitch = pitch;
  req.reset = true;
  req.resampleMode = resampleMode_autoOut;
  st.preroll(req);
  Messung m;
  m.eingabe_puffer = static_cast<int>(stride);
  const int koerner = 600;
  long summe = 0;
  for (int k = 0; k < koerner; ++k) {
    const Bungee::InputChunk ch = st.specifyGrain(req);
    m.max_eingabe = std::max(m.max_eingabe, ch.end - ch.begin);
    for (int i = ch.begin; i < ch.end && static_cast<size_t>(i - ch.begin) < stride; ++i) in[static_cast<size_t>(i - ch.begin)] = (i >= 0 && i < N) ? q[static_cast<size_t>(i)] : 0.0f;
    st.analyseGrain(in.data(), kanaele == 2 ? static_cast<int>(stride) : 0, 0, 0);
    Bungee::OutputChunk oc{};
    st.synthesiseGrain(oc);
    for (int i = 0; i < oc.frameCount; ++i) {
      aus.push_back(oc.data[i]);
      if (kanaele == 2) aus1.push_back(oc.data[oc.channelStride + i]);
    }
    if (k >= 3) summe += oc.frameCount;
    m.max_korn = std::max(m.max_korn, oc.frameCount);
    const double vorher = req.position;
    st.next(req);
    m.abstand_fehler = std::max(m.abstand_fehler, std::fabs((req.position - vorher) - speed * hop / pitch));
  }
  m.frames_je_korn = static_cast<double>(summe) / (koerner - 3);
  // Messfenster nur dort, wo die Quelle noch reicht: Ausgabeframe t liest Quelle 2·SR + t·speed, bei pitch < 1 ist die Ausgabe länger als der Rest der 12-s-Quelle (Kornzahl fest),
  // und das Ausklingen am Quellende liefert unregelmäßige Nulldurchgänge (gemessen: pitch 0,5 -5,6 ct im ganzen Fenster, +-0,06 ct in jedem 0,25-s-Fenster davor). Grenze bleibt +-2 ct.
  const size_t quelle_bis = static_cast<size_t>(std::max(0.0, (N - 2.5 * SR) / speed));
  const size_t ende = std::min(aus.size() - SR / 4, quelle_bis);
  m.hz = frequenz(aus, SR / 2, ende);
  if (kanaele == 2) {
    double e0 = 0.0, e1 = 0.0;
    for (size_t i = SR / 2; i < ende && i < aus1.size(); ++i) {
      e0 += static_cast<double>(aus[i]) * aus[i];
      e1 += static_cast<double>(aus1[i]) * aus1[i];
    }
    m.neben_db = 10.0 * std::log10((e1 + 1e-30) / (e0 + 1e-30));
    m.pegel0_db = 10.0 * std::log10(e0 / static_cast<double>(std::max<size_t>(1, ende - SR / 2)) + 1e-30);
  }
  return m;
}
}  // namespace

int main() {
  const double v = 1.024;
  const struct { double p; const char* n; } faelle[] = {{0.5, "-12 st"}, {std::pow(2.0, -7.0 / 12.0), "-7 st"}, {1.0, "0 st (Gegenprobe)"}, {std::pow(2.0, 7.0 / 12.0), "+7 st"},
                                                         {2.0, "+12 st"}, {4.0, "+24 st"}};
  for (int fein = 0; fein < 2; ++fein) {
    const int hop = fein ? 256 : 512;
    for (const auto& f : faelle) {
      const Messung m = miss(f.p, v, hop, fein ? -1 : 0);
      const double ct = cent(m.hz, 1000.0 * f.p);
      std::printf("%s %s: pitch %.6f -> %.3f Hz (%+.2f ct vom Soll), Korn %.1f Frames (soll %.1f), größtes Korn %d, Positionsabstand-Fehler %.3g\n", fein ? "TONES  " : "COMPLEX", f.n, f.p,
                  m.hz, ct, m.frames_je_korn, hop / f.p, m.max_korn, m.abstand_fehler);
      PRUEF(std::fabs(ct) <= 2.0);
      PRUEF(m.abstand_fehler < 1e-9);
      PRUEF(std::fabs(m.frames_je_korn - hop / f.p) <= 0.01 * hop / f.p + 1.0);
      PRUEF(m.max_korn <= 4 * hop + 1);
    }
  }
  // Gegenprobe des Messers: +7 st und 0 st unterscheiden sich um 700 ct
  const Messung eins = miss(1.0, v, 512, 0), sieben = miss(std::pow(2.0, 7.0 / 12.0), v, 512, 0);
  PRUEF(std::fabs(cent(sieben.hz, eins.hz) - 700.0) <= 2.0);
  if (std::getenv("BUNGEE_PITCH_GRENZE")) {
    for (double p : {0.5, std::pow(2.0, 7.0 / 12.0), 4.0, 0.25, std::pow(2.0, -2.0 - 50.0 / 1200.0), 0.125, 0.0625, 8.0, 8.5, 8.75, 16.0, std::pow(2.0, 4.0 + 50.0 / 1200.0)}) {
      const Messung m = miss(p, v, 512, 0, 2);
      std::printf("GRENZE COMPLEX 2 Kanäle pitch %.6f: %.3f Hz (%+.2f ct vom Soll), Korn %.1f Frames (soll %.1f), größtes Korn %d (Ausgabepuffer %d), Eingabechunk %d (Puffer %d), Nebensprechen %.1f dB, Pegel Kanal 0 %.1f dB\n",
                  p, m.hz, cent(m.hz, 1000.0 * p), m.frames_je_korn, 512.0 / p, m.max_korn, 4 * 512 + 1, m.max_eingabe, m.eingabe_puffer, m.neben_db, m.pegel0_db);
    }
    for (double p : {2.0, 4.0, 4.5, 6.0}) {   // TONES (Hop 256): das Ausgabekorn ist Hop/pitch Frames, bei 4,5 nur noch 57
      const Messung m = miss(p, v, 256, -1, 2);
      std::printf("GRENZE TONES 2 Kanäle pitch %.6f: %.3f Hz (%+.2f ct vom Soll), Korn %.1f Frames (soll %.1f), größtes Korn %d, Pegel Kanal 0 %.1f dB\n", p, m.hz, cent(m.hz, 1000.0 * p),
                  m.frames_je_korn, 256.0 / p, m.max_korn, m.pegel0_db);
    }
  }
  PRUEF_ENDE();
}
