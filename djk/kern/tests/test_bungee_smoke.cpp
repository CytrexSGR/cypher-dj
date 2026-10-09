// S0 (Umbauplan 2026-10-09-bungee-umbau): Bungee ist eingebunden und rechnet, ohne den Kern. Gebaut nur mit
// -DCYPHERDJ_BUNGEE=ON (CMake schließt test_*bungee* sonst aus).
//  1. Version git-8cb6977 (der gepinnte Commit, djk/third_party/herkunft.json).
//  2. 1-kHz-Sinus bei Tempofaktor 1,0547 (135/128): Bungee behält die Tonhöhe, gemessen auf ±2 ct.
//  3. Gegenprobe des Messers: dieselbe Länge als Varispeed gelesen (Tonhöhe × 1,0547 = +90 ct) muss er als weit daneben sehen.
#include <bungee/Bungee.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "pruef.h"

namespace {
constexpr int SR = 48000;
constexpr double F = 135.0 / 128.0;

// Frequenz aus steigenden Nulldurchgängen (linear interpoliert) von l[a, b)
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
}  // namespace

int main() {
  using St = Bungee::Stretcher<Bungee::Basic>;
  PRUEF(std::strcmp(St::version(), "git-8cb6977") == 0);
  std::printf("Bungee %s %s\n", St::edition(), St::version());

  const int N = 12 * SR;  // Quelle 12 s
  std::vector<float> q(static_cast<size_t>(N));
  for (int i = 0; i < N; ++i) q[static_cast<size_t>(i)] = static_cast<float>(0.5 * std::sin(2.0 * M_PI * 1000.0 * i / SR));

  St st(Bungee::SampleRates{SR, SR}, 1, 0);
  const int hop = 512;
  std::vector<float> in(static_cast<size_t>(st.maxInputFrameCount()), 0.0f), aus;
  Bungee::Request req{};
  req.position = 2.0 * SR;  // mitten im Sinus
  req.speed = F;
  req.pitch = 1.0;
  req.reset = true;
  req.resampleMode = resampleMode_autoOut;
  st.preroll(req);
  for (int k = 0; k < 400; ++k) {  // 400 Körner = 4,3 s Ausgabe
    const Bungee::InputChunk ch = st.specifyGrain(req);
    for (int i = ch.begin; i < ch.end; ++i)
      in[static_cast<size_t>(i - ch.begin)] = (i >= 0 && i < N) ? q[static_cast<size_t>(i)] : 0.0f;
    st.analyseGrain(in.data(), 0, 0, 0);
    Bungee::OutputChunk oc{};
    st.synthesiseGrain(oc);
    for (int i = 0; i < oc.frameCount; ++i) aus.push_back(oc.data[i]);
    req.position += hop * F;
    req.reset = false;
  }
  PRUEF(aus.size() > static_cast<size_t>(3 * SR));
  const double fb = frequenz(aus, SR / 2, aus.size() - SR / 4);  // Einschwingen weg
  std::printf("Bungee bei Faktor %.4f: %.3f Hz (%+.2f ct)\n", F, fb, cent(fb, 1000.0));
  PRUEF(std::fabs(cent(fb, 1000.0)) <= 2.0);

  // Gegenprobe: Varispeed mit demselben Faktor ist +90 ct daneben, das muss der Messer sehen
  std::vector<float> v(static_cast<size_t>(3 * SR));
  for (size_t i = 0; i < v.size(); ++i) {
    const double p = 2.0 * SR + static_cast<double>(i) * F;
    const size_t j = static_cast<size_t>(p);
    const double fr = p - static_cast<double>(j);
    v[i] = static_cast<float>((1.0 - fr) * static_cast<double>(q[j]) + fr * static_cast<double>(q[j + 1]));
  }
  const double fv = frequenz(v, 1000, v.size() - 1000);
  std::printf("Varispeed (Gegenprobe): %.3f Hz (%+.2f ct)\n", fv, cent(fv, 1000.0));
  PRUEF(std::fabs(cent(fv, 1000.0)) > 50.0);
  PRUEF_ENDE();
}
