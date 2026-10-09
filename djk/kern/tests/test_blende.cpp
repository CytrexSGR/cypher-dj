// Welle 2 Slice 2.2 (Erhebung proto_blende/pruefe.cpp): der gemeinsame Blend-Baustein. Fehlerfall am selben Reiz: harter
// Einsatz eines 100-Hz-Sinus (0,5) nahe der Spitze; nachher Einblende über n Samples, größter Sprung <= 0,5/n + natürlich.
// Negativ-Kontrolle: ruhende Blende bitgleich. Umzielen mitten in der Rampe beginnt beim Ist-Wert (Klasse F27); Fehlerfall
// test_blende_mutation (CYPHERDJ_MUTATION_BLENDE_ABBRUCH): Umzielen ab dem alten Ziel, muss scheitern.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

#include "cypherdj/blende.h"
#include "pruef.h"
#include "sprungmass.h"

int main() {
  const int F = 4096;
  const double f = 100.0, A = 0.5;
  std::vector<float> sinus(F);
  for (int i = 0; i < F; ++i) sinus[i] = (float)(A * std::sin(2.0 * M_PI * f * (i + 17) / 48000.0));
  const double nat = sprung::natuerlich(f, A);
  // 1) Fehlerfall: harter Einsatz bei Sample 1000 (Erhebung: 0,3394)
  std::vector<float> hart(F, 0.0f);
  for (int i = 1000; i < F; ++i) hart[i] = sinus[i];
  const sprung::Mass mh = sprung::messe(hart, 900, 1300);
  std::printf("hart: größter Sprung %.5f (x%.1f natürlich %.5f)\n", mh.d1, mh.d1 / nat, nat);
  PRUEF(mh.d1 > 0.3);
  for (int n : {16, 32, 48, 128}) {
    std::vector<float> y(F, 0.0f);
    cdj::Blende b(0.0f);
    for (int i = 0; i < F; ++i) {
      if (i == 1000) b.ziel(1.0f, n);
      const float g = b.schritt();
      y[i] = i >= 1000 ? sinus[i] * g : 0.0f;
    }
    const sprung::Mass m = sprung::messe(y, 900, 1300);
    std::printf("Einblende %3d: größter Sprung %.5f (Grenze %.5f)\n", n, m.d1, A / n + nat);
    PRUEF(m.d1 <= A / n + nat + 1e-6);
    PRUEF(std::fabs(y[1000] - sinus[1000] / (float)n) < 1e-6f);  // erstes Sample mit Gain 1/n
  }
  // 2) Negativ-Kontrolle: ruhende Blende rührt nichts an (nicht einmal x * 1.0f)
  {
    std::vector<float> a = sinus, b = sinus;
    cdj::Blende bl;
    PRUEF(bl.offen() && bl.ruht() && !bl.stumm());
    bl.anwenden(b.data(), F);
    PRUEF(std::memcmp(a.data(), b.data(), sizeof(float) * F) == 0);
  }
  // 3) Umzielen mitten in der Rampe: aus(64), nach 20 Samples ziel(1, 64): größter Gain-Schritt 1/64, Minimum 0,6875
  {
    cdj::Blende b(1.0f);
    b.aus(64);
    double mx = 0.0, vor = 1.0, minimum = 1.0;
    for (int i = 0; i < 200; ++i) {
      if (i == 20) b.ziel(1.0f, 64);
      const float g = b.schritt();
      mx = std::max(mx, std::fabs((double)g - vor));
      minimum = std::min(minimum, (double)g);
      vor = g;
    }
    std::printf("Umzielen: größter Gain-Schritt %.5f (Soll 1/64 = %.5f), Minimum %.4f\n", mx, 1.0 / 64, minimum);
    PRUEF(mx <= 1.0 / 64 + 1e-6 && minimum > 0.68 && b.offen());
  }
  // 4) Ausblende endet genau auf 0 (stumm); S-Kurve: größter Schritt 1,5/n; samples <= 0: sofort
  {
    cdj::Blende b(1.0f);
    b.aus(144);
    float g = 1.0f;
    for (int i = 0; i < 144; ++i) g = b.schritt();
    PRUEF(g == 0.0f && b.stumm());
  }
  {
    cdj::Blende b(0.0f);
    b.ziel(1.0f, 100, cdj::Blende::Form::s_kurve);
    double mx = 0.0, vor = 0.0;
    for (int i = 0; i < 120; ++i) {
      const float g = b.schritt();
      mx = std::max(mx, std::fabs((double)g - vor));
      vor = g;
    }
    PRUEF(mx <= 1.5 / 100 + 1e-6 && b.offen());
  }
  {
    cdj::Blende b(1.0f);
    b.ziel(0.0f, 0);
    PRUEF(b.stumm() && b.schritt() == 0.0f);
  }
  // 5) gleich_laut: alt² + neu² = 1 über die ganze Blende, Enden genau
  {
    double fehler = 0.0;
    for (int k = 0; k <= 960; ++k) {
      float a, n;
      cdj::gleich_laut((float)k / 960.0f, a, n);
      fehler = std::max(fehler, std::fabs((double)a * a + (double)n * n - 1.0));
    }
    float a0, n0, a1, n1;
    cdj::gleich_laut(0.0f, a0, n0);
    cdj::gleich_laut(1.0f, a1, n1);
    PRUEF(fehler < 1e-6 && a0 == 1.0f && n0 == 0.0f && n1 > 0.9999999f && std::fabs(a1) < 1e-7f);
  }
  PRUEF_ENDE();
}
