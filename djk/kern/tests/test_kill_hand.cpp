// F18 (Audit 2026-10-01, Welle 2 Slice 2.3), Ankunft: Kill-Taste der Hand -> Stellwerk -> Verlauf -> Kanalzug, derselbe Weg
// wie Kern::audio (kern_stellwerk.cpp:315-327: sw_->hand, sw_->prozess, aenderungen -> mixer_->verlauf -> Kanalzug::verlauf).
// Griff wie die echte Taste (hand_ein.cpp:40, naht_stellwerk.cpp:26-28: relativ +1). Reiz 60 Hz 0,5, Griff in Block 6 bei
// Sample 100; Maß: größte zweite Differenz um den Griff gegen die ruhigen Blöcke 2..5 (Erhebung probe_kz).
// Vorher (hand.cpp:139 Stufe): Erhebung x14685, rot. Positiv-Kontrolle des Instruments: dieselbe Stufe direkt als Verlauf
// > x100. Negativ-Kontrolle: kein Griff < x2.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <vector>

#include <cypherdj/dsp/kanalzug.h>

#include "cypherdj/stellwerk/stellwerk.h"
#include "pruef.h"

namespace sw = cypherdj::stellwerk;
using cypherdj::dsp::Kanalzug;
using cypherdj::dsp::KanalzugAusgang;
using cypherdj::dsp::Regler;

namespace {
constexpr int N = 256, EVB = 6, EVS = 100, RAMPE = 240;
struct Uhr128 final : sw::Uhr {
  double beat(int64_t s) const override { return (double)s / 22500.0; }
  double sample_genau(double b) const override { return b * 22500.0; }
  double bpm(int64_t) const override { return 128.0; }
};
enum class Art { griff, stufe, nichts };
double verhaeltnis(Art art) {
  Uhr128 uhr;
  auto st = std::make_unique<sw::Stellwerk>(uhr, nullptr);
  const int r = st->tabelle().suche("deck/1/kill/tief");
  const int64_t e = (int64_t)EVB * N + EVS;
  if (art == Art::griff) st->hand(sw::Griff{e, (int16_t)r, sw::GriffArt::relativ, 1.0f, nullptr});
  auto kz = std::make_unique<Kanalzug>();
  kz->setze_sofort(Regler::fader, 0.0f);
  std::vector<float> y, stufe(N);
  double ph = 0.0;
  for (int b = 0; b < 12; ++b) {
    std::vector<float> in(N), ol(N), orr(N);
    for (int i = 0; i < N; ++i) {
      in[i] = (float)(0.5 * std::sin(ph));
      ph += 2.0 * M_PI * 60.0 / 48000.0;
    }
    st->prozess((int64_t)b * N, N);
    const sw::Aenderung* a;
    const int na = st->aenderungen(&a);
    for (int k = 0; k < na; ++k)
      if (a[k].regler == r) (void)kz->verlauf(Regler::kill_tief, a[k].verlauf);
    if (art == Art::stufe && (b == EVB || b == EVB + 1)) {
      for (int i = 0; i < N; ++i) stufe[i] = (int64_t)b * N + i < e ? 0.0f : 1.0f;
      (void)kz->verlauf(Regler::kill_tief, stufe.data());
    }
    KanalzugAusgang aus;
    aus.haupt_l = ol.data();
    aus.haupt_r = orr.data();
    kz->verarbeite(in.data(), in.data(), N, aus);
    y.insert(y.end(), ol.begin(), ol.end());
  }
  auto d2 = [&](int64_t a0, int64_t a1) {
    double m = 0.0;
    for (int64_t i = a0; i < a1; ++i) m = std::max(m, std::fabs((double)y[i] - 2.0 * y[i - 1] + y[i - 2]));
    return m;
  };
  return d2(e - 40, e + RAMPE + 40) / d2(2 * N, 6 * N);
}
}  // namespace

int main() {
  const double g = verhaeltnis(Art::griff), s = verhaeltnis(Art::stufe), o = verhaeltnis(Art::nichts);
  std::printf("kill/tief 60 Hz, zweite Differenz gegen ruhig: Hand-Griff x%.2f, Stufe (Instrument) x%.1f, ohne Griff x%.2f\n",
              g, s, o);
  PRUEF(s > 100.0);  // Instrument sieht den Fehlerfall (Erhebung x14685)
  PRUEF(g < 10.0);   // Schaltrampe am Kanalzug angekommen (Schwelle der Erhebung)
  PRUEF(o < 2.0);    // Negativ-Kontrolle
  PRUEF_ENDE();
}
