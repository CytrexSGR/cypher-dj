// K2 Task 1.3: Duck-Hüllkurve, Auslöser am Sample, über Blockgrenzen, Tiefe 0 dB ist bitgleich
#include "cypherdj/duck.h"
#include "pruef.h"
#include <cmath>
#include <vector>

int main() {
  const int N = 256;
  std::vector<float> g(N);
  {   // Tiefe 0 dB: nichts ändert sich, auch mit Auslöser (bitgleich 1.0f)
    cdj::Duck d; d.setze(0.0f, 200.0f); d.ausloesen(10);
    d.block(g.data(), N);
    bool eins = true; for (float x : g) eins = eins && x == 1.0f;
    PRUEF(eins);
  }
  {   // −12 dB, Auslöser bei 100: davor 1, nach Attack (240) am Ziel, danach Erholung
    cdj::Duck d; d.setze(-12.0f, 200.0f); d.ausloesen(100);
    d.block(g.data(), N);
    PRUEF(g[99] == 1.0f);
    PRUEF(g[100] < 1.0f);
    std::vector<float> g2(N); d.block(g2.data(), N);        // Attack endet in Block 2 bei Index 100+240-256 = 84
    PRUEF_NAH(g2[83], std::pow(10.0f, -12.0f / 20.0f), 1e-3f);
    PRUEF(g2[255] > g2[84]);                               // erholt sich
    // Ausklang bis 1 − g ≤ 1e-4: ln(0,749/1e-4) ≈ 8,9 τ, τ = 200 ms/5 = 1920 Samples → 17 100 Samples ≈ 67 Blöcke ab Attack
    for (int b = 0; b < 80; ++b) d.block(g2.data(), N);
    PRUEF(g2[N - 1] == 1.0f);
    PRUEF(d.ruhig());
  }
  {   // Auslöser jenseits des Blocks wartet: versatz 300 greift in Block 2 bei 44
    cdj::Duck d; d.setze(-12.0f, 200.0f); d.ausloesen(300);
    d.block(g.data(), N);
    PRUEF(g[N - 1] == 1.0f);
    d.block(g.data(), N);
    PRUEF(g[43] == 1.0f);
    PRUEF(g[44] < 1.0f);
  }
  {   // neuer Auslöser mitten in der Erholung setzt vom aktuellen Wert aus neu an, ohne Sprung nach oben
    cdj::Duck d; d.setze(-12.0f, 200.0f); d.ausloesen(0);
    d.block(g.data(), N); d.block(g.data(), N);
    const float vorher = g[N - 1];
    d.ausloesen(0); d.block(g.data(), N);
    PRUEF(g[0] <= vorher + 1e-6f);
  }
  {   // Tiefe mitten in der Erholung auf 0 zurückgedreht: Erholung endet trotzdem (Schwelle nie 0), gain exakt 1
    cdj::Duck d; d.setze(-12.0f, 200.0f); d.ausloesen(0);
    d.block(g.data(), N); d.block(g.data(), N);
    PRUEF(g[N - 1] < 1.0f);
    d.setze(0.0f, 200.0f);
    int b = 0;
    for (; b < 100 && !d.ruhig(); ++b) d.block(g.data(), N);
    PRUEF(d.ruhig());
    PRUEF(g[N - 1] == 1.0f);
  }
  {   // Erholung ohne Sprung: −24 dB, release 600 (τ = 5760, erster Erholungsschritt (1−ziel)/τ = 1,6e-4)
    cdj::Duck d; d.setze(-24.0f, 600.0f); d.ausloesen(0);
    const float ziel = std::pow(10.0f, -24.0f / 20.0f);
    float vor = 1.0f, gr_attack = 0.0f, gr_rest = 0.0f;
    int i_gesamt = 0;
    for (int b = 0; b < 400 && !(b > 2 && d.ruhig()); ++b) {
      d.block(g.data(), N);
      for (int i = 0; i < N; ++i, ++i_gesamt) {
        const float schritt = std::fabs(g[i] - vor);
        if (i_gesamt <= cdj::Duck::ATTACK) gr_attack = std::fmax(gr_attack, schritt);
        else gr_rest = std::fmax(gr_rest, schritt);
        vor = g[i];
      }
    }
    std::printf("Sprung: Attack-Schritt %.3g, größter Schritt in der Erholung %.3g\n", gr_attack, gr_rest);
    PRUEF(d.ruhig());
    PRUEF(g[N - 1] == 1.0f);
    PRUEF_NAH(gr_attack, (1.0f - ziel) / cdj::Duck::ATTACK, 1e-5f);   // der Attack-Schritt darf groß sein: getrennt
    PRUEF(gr_rest < 2e-4f);                                           // inklusive des letzten Schritts auf 1,0 (≤ 1e-4)
  }
  {   // Tiefenwechsel mitten im Attack (−24 → 0 dB bei Attack-Sample 56): kein Sprung, die Tiefe gilt ab dem nächsten Auslöser
    cdj::Duck d; d.setze(-24.0f, 600.0f); d.ausloesen(0);
    const float ziel = std::pow(10.0f, -24.0f / 20.0f);
    std::vector<float> a(56);
    d.block(a.data(), 56);
    d.setze(0.0f, 600.0f);
    std::vector<float> rest(2 * 48000);
    d.block(rest.data(), static_cast<int>(rest.size()));
    float vor = a.back(), groesster = 0.0f, tief = 1.0f;
    for (float x : rest) { groesster = std::fmax(groesster, std::fabs(x - vor)); tief = std::fmin(tief, x); vor = x; }
    std::printf("Tiefenwechsel im Attack: größter Schritt %.3g (Attack-Schritt %.3g), tiefster Gain %.4f (Ziel %.4f)\n",
                groesster, (1.0f - ziel) / cdj::Duck::ATTACK, tief, ziel);
    PRUEF(groesster <= (1.0f - ziel) / cdj::Duck::ATTACK + 1e-6f);
    PRUEF_NAH(tief, ziel, 1e-4f);   // der laufende Attack erreicht das ALTE Ziel; die Erholung läuft gegen 1
    PRUEF(d.ruhig());
  }
  PRUEF_ENDE();
}
