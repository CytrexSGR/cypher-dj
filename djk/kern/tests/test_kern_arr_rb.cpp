// D1 K2b (Spec 1, 2.4): die interne Instrument-Spur klingt im Kern ohne weiteres Zutun über die RB-338, die der Kern
// selbst als Senke anlegt. Wiedergabe mit Spur 2 (intern, rb338), Note auf Beat 0,5 nach einem Start aus dem Stand:
//   1 vor der Note bleibt der Master still, ab Note-Ziel + Limiter-Vorhalt klingt er; /pegel spur/2 meldet sie
//   2 die Parameter der Wiedergabe kommen an: cutoff 0,05 und 0,95 klingen verschieden
//   3 Negativ-Kontrolle: dieselbe Wiedergabe ohne Start bleibt still
// Mutation: ARR_OHNE_RB_SENKE (der Kern hängt die RB-338 nicht ein) macht Fall 1 rot.
#include <cmath>
#include <cstdio>
#include <string>

#include "arr_lauf.h"

bool g_waechter = false;

using k35::N;
using k35::SPB;

namespace {

struct Ergebnis {
  int64_t note = -1;     // Kern-Sample der Note
  int64_t erster = -1;   // erstes Master-Sample ungleich 0
  double energie = 0.0;  // Master links ab der Note, eine Viertel-Note lang
  float pegel_max = -200.0f;
};

Ergebnis lauf(const std::string& ab, const char* cutoff, bool starten = true) {
  Ergebnis e;
  arr35::Lauf x(ab, "test_kern_arr_rb");
  x.laden(1, std::string("{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":") + cutoff +
                 ",\"resonanz\":0.6},\"noten\":[{\"id\":\"c2/n1\",\"beat\":0.5,\"laenge\":0.5,\"ton\":36,\"vel\":100}]}");
  x.lauf(4 * N);
  const int64_t st = starten ? x.start(0.0, 0) : -1;
  x.lauf(4 * N + 2 * SPB);
  if (starten) {
    const k35::Q* q2 = x.quittung(st, 2);
    PRUEF(q2 != nullptr);
    if (q2) e.note = q2->sample + SPB / 2;
  }
  e.erster = arr35::Lauf::erster(x.l, 0, static_cast<int64_t>(x.l.size()));
  if (e.note >= 0)
    for (int64_t i = e.note + x.vh; i < e.note + x.vh + SPB / 4; ++i) e.energie += static_cast<double>(x.l[i]) * x.l[i];
  for (const cdj::Ereignis& p : x.alle(cdj::Ereignis::PEGEL, "spur/2")) e.pegel_max = std::max(e.pegel_max, p.pegel[0]);
  return e;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_rb");
  arr35::Lauf vh_lauf(ab.pfad, "test_kern_arr_rb_vh");
  const int vh = vh_lauf.vh;
  const Ergebnis a = lauf(ab.pfad, "0.05"), b = lauf(ab.pfad, "0.95"), c = lauf(ab.pfad, "0.05", false);
  std::printf("rb: Note %lld, erster Master-Wert %lld (Vorhalt %d), Energie %.4f / %.4f, Pegel spur/2 %.1f dB\n",
              (long long)a.note, (long long)a.erster, vh, a.energie, b.energie, a.pegel_max);
  // 1: still bis zur Note, danach klingt sie (die Stimme ruht bis zum Note-Ein, 6.10)
  PRUEF(a.note > 0 && a.erster >= a.note + vh && a.erster < a.note + vh + 64);
  PRUEF(a.energie > 1e-3);
  PRUEF(a.pegel_max > -60.0f);
  // 2: die Parameter wirken
  PRUEF(b.energie > 1e-3 && std::fabs(a.energie - b.energie) > 0.05 * std::max(a.energie, b.energie));
  // 3: ohne Start kein Ton
  PRUEF(c.erster == -1 && c.pegel_max == -200.0f);
  PRUEF_ENDE();
}
