// stellwerk_regler_liste: druckt die Regler-Tabelle des Stellwerks als TSV für tests/regler_gegen_vertrag.py und für
// den Abgleich mit der Tabelle des Kanalzugs (Scheibe 04, djk/kern/dsp/werkzeuge/regler_liste.cpp) in Scheibe 25:
// pfad  min  max  vorgabe  schaltrampe_ms  nur_hand   (deck/<n>/transport ist kein Regler aus §1.5 und fehlt hier)
#include <cstdio>

#include "cypherdj/stellwerk/regler.h"
#include "cypherdj/stellwerk/typen.h"

int main() {
  using namespace cypherdj::stellwerk;
  const ReglerTabelle t;
  for (int r = 0; r < t.anzahl(); r++) {
    const ReglerDef& d = t.def(r);
    if (d.transport) continue;
    std::printf("%s\t%g\t%g\t%g\t%g\t%d\n", d.pfad, d.min, d.max, d.vorgabe, d.schalt_samples * 1000.0 / SR, d.nur_hand ? 1 : 0);
  }
  return 0;
}
