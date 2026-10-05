// Scheibe 25: die Kern-Uhr als Uhr des Stellwerks (kern_uhr.h). Sie muss die Golden-Werte aus SCHNITTSTELLEN §1.3 der
// Karte liefern, die im Kern gerade gilt, auch mit einer wartenden Tempo-Rampe (Scheibe 08: die Karte ist Grundkarte
// plus wartende Rampen). Negativ-Kontrolle: ohne Rampe liegt Beat 144 auf 144 · 22 500 = 3 240 000.
#include <cmath>

#include "cypherdj/kern_uhr.h"
#include "cypherdj/stellwerk/uhr.h"
#include "pruef.h"

int main() {
  cdj::Tempoplan ohne(128.0);
  const cdj::KernUhr u0(ohne);
  PRUEF_NAH(u0.sample_genau(144.0), 3'240'000.0, 1e-6);  // Negativ-Kontrolle
  PRUEF_NAH(u0.beat(1'440'000), 64.0, 1e-9);
  PRUEF(cypherdj::stellwerk::sample_von(u0, 64.0) == 1'440'000);

  cdj::Tempoplan plan(128.0);
  PRUEF(plan.rampe(1, "pruefstand", 128.0, 132.0, 32.0, 0) == cdj::Einsortiert::angenommen);
  const cdj::KernUhr u(plan);
  PRUEF_NAH(u.sample_genau(128.0), 2'880'000.0, 1e-6);    // §1.3: Start der Rampe
  PRUEF_NAH(u.sample_genau(144.0), 3'237'188.004, 1e-3);  // §1.3: sample(144,0)
  PRUEF_NAH(u.sample_genau(160.0), 3'588'923.077, 1e-3);  // Ende der Rampe
  PRUEF_NAH(u.sample_genau(192.0), 4'287'104.895, 1e-3);  // danach konstant 132
  PRUEF(cypherdj::stellwerk::sample_von(u, 144.0) == 3'237'188);
  PRUEF_NAH(u.bpm(3'237'188), 130.015384, 1e-5);
  PRUEF_NAH(u.beat(3'588'923), 160.0 - 0.077 * 132.0 / 60.0 / 48000.0, 1e-6);
  PRUEF_ENDE();
}
