// messer_kosten [bloecke]  (Vorgabe 20000 Blöcke zu 256 Frames, rund 107 s Audio je Messgröße)
// Rechenzeit je Aufruf in Mikrosekunden (CLOCK_MONOTONIC), Median, p99, Maximum:
//   leer      zwei Zeitstempel ohne Arbeit (Boden des Instruments)
//   baender   AnalyseBaender::verarbeite, ein Stereo-Kanal, Rauschen -20 dBFS
//   baender_stille  dasselbe nach 10 s Stille (Fehlerfall Denormalisierte, wenn nicht abgefangen)
//   messer    PegelMesser::verarbeite mit Isolator-Bändern
//   schnapp   PegelMesser::schnappschuss (einmal je 10 Blöcke, wie 20 Hz bei 256)
//   limiter   MasterLimiter::verarbeite, Rauschen mit Spitzen bis +6 dBFS
// Unter flock "$CYPHERDJ_ECHTZEIT_SCHLOSS" starten; die Last steht im Bericht, nicht hier.
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <vector>

#include "cypherdj/dsp/analyse_baender.h"
#include "cypherdj/dsp/master_limiter.h"
#include "cypherdj/dsp/pegel_messer.h"

using namespace cypherdj::dsp;

static double jetzt_us() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e6 + t.tv_nsec * 1e-3;
}

static void bericht(const char* name, std::vector<double>& d) {
  std::sort(d.begin(), d.end());
  std::printf("%-15s n %zu median_us %.2f p99_us %.2f max_us %.2f\n", name, d.size(), d[d.size() / 2],
              d[static_cast<size_t>(d.size() * 0.99)], d.back());
}

int main(int argc, char** argv) {
  const int bloecke = argc > 1 ? std::atoi(argv[1]) : 20000;
  std::vector<float> l(256), r(256), t(256);
  uint32_t s = 99;
  auto rauschen = [&](float amp) {
    for (int i = 0; i < 256; ++i) {
      s = s * 1664525u + 1013904223u;
      l[i] = (static_cast<float>(s >> 8) / 16777216.0f - 0.5f) * amp;
      s = s * 1664525u + 1013904223u;
      r[i] = (static_cast<float>(s >> 8) / 16777216.0f - 0.5f) * amp;
      t[i] = 0.5f * l[i];
    }
  };
  double pruefsumme = 0.0;
  HuellenWerte h[8];

  {  // Negativ-Kontrolle des Instruments: zwei Zeitstempel ohne Arbeit dazwischen
    std::vector<double> d;
    d.reserve(bloecke);
    for (int b = 0; b < bloecke; ++b) {
      const double t0 = jetzt_us();
      d.push_back(jetzt_us() - t0);
    }
    bericht("leer", d);
  }
  {  // sechs Bänder auf Rauschen
    AnalyseBaender a(vertrag_baender());
    std::vector<double> d;
    d.reserve(bloecke);
    for (int b = 0; b < bloecke; ++b) {
      rauschen(0.35f);
      const double t0 = jetzt_us();
      const int n = a.verarbeite(l.data(), r.data(), 256, h, 8);
      d.push_back(jetzt_us() - t0);
      pruefsumme += n > 0 ? h[0].band[0] : 0.0f;
    }
    bericht("baender", d);
  }
  {  // sechs Bänder: erst Rauschen, dann 10 s Stille, gemessen wird die Stille danach
    AnalyseBaender a(vertrag_baender());
    rauschen(0.35f);
    for (int b = 0; b < 100; ++b) a.verarbeite(l.data(), r.data(), 256, h, 8);
    std::fill(l.begin(), l.end(), 0.0f);
    std::fill(r.begin(), r.end(), 0.0f);
    for (int b = 0; b < 1875; ++b) a.verarbeite(l.data(), r.data(), 256, h, 8);  // 10 s
    std::vector<double> d;
    d.reserve(bloecke);
    for (int b = 0; b < bloecke; ++b) {
      const double t0 = jetzt_us();
      a.verarbeite(l.data(), r.data(), 256, h, 8);
      d.push_back(jetzt_us() - t0);
    }
    bericht("baender_stille", d);
  }
  {  // Pegelmesser und Schnappschuss
    PegelMesser m;
    IsoBaender iso{{t.data(), t.data()}, {t.data(), t.data()}, {t.data(), t.data()}};
    std::vector<double> d, e;
    d.reserve(bloecke);
    for (int b = 0; b < bloecke; ++b) {
      rauschen(0.35f);
      const double t0 = jetzt_us();
      m.verarbeite(l.data(), r.data(), 256, &iso);
      d.push_back(jetzt_us() - t0);
      if (b % 10 == 9) {
        const double t1 = jetzt_us();
        PegelWerte w = m.schnappschuss();
        e.push_back(jetzt_us() - t1);
        pruefsumme += w.lufs_s;
      }
    }
    bericht("messer", d);
    bericht("schnapp", e);
  }
  {  // Limiter
    MasterLimiter lim;
    std::vector<double> d;
    d.reserve(bloecke);
    for (int b = 0; b < bloecke; ++b) {
      rauschen(4.0f);
      const double t0 = jetzt_us();
      lim.verarbeite(l.data(), r.data(), 256);
      d.push_back(jetzt_us() - t0);
      pruefsumme += l[0];
    }
    bericht("limiter", d);
  }
  std::printf("pruefsumme %.6g\n", pruefsumme);
  return 0;
}
