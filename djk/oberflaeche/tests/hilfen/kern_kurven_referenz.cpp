// Referenz-Erzeuger (Oberfläche, Scheibe 60m, Plan M-1 Blocker 4): ruft die ECHTEN Kern-Funktionen auf
// (ReglerTabelle::aus_x / zu_x mit den Standard-Kurven der Regler-Tabelle, djk/kern/stellwerk/src/regler.cpp) und
// schreibt Stützpunkte als JSON nach stdout. Nur lesend gegen den Kern, kein Audio, kein Netz.
// Bau (klein, ein Übersetzungs-Einheit):
//   g++ -std=c++20 -O1 -I djk/kern/stellwerk/include djk/oberflaeche/tests/hilfen/kern_kurven_referenz.cpp \
//       djk/kern/stellwerk/src/regler.cpp -o /tmp/kern_kurven_referenz
//   /tmp/kern_kurven_referenz > djk/oberflaeche/tests/hilfen/kern_kurven_referenz.json
#include <cstdio>
#include <cstring>

#include "cypherdj/stellwerk/regler.h"

using namespace cypherdj::stellwerk;

int main() {
  ReglerTabelle t;
  const char* pfade[] = {"deck/1/fader", "deck/2/fader", "master/pegel", "cue/pegel", "deck/1/eq/tief", "deck/1/eq/mitte",
                         "deck/2/eq/hoch", "deck/1/trim", "deck/1/filter", "xfader", "cue/mix"};
  const int nx = 41;   // Stellung 0, 0.025 ... 1
  const float wdb[] = {-200, -120, -80, -60.5f, -60, -40, -30, -26, -20, -12, -6, -3, 0, 3, 6, 12, 24};
  std::printf("{\n");
  for (size_t i = 0; i < sizeof pfade / sizeof pfade[0]; i++) {
    const int r = t.suche(pfade[i]);
    if (r < 0) { std::fprintf(stderr, "unbekannt: %s\n", pfade[i]); return 1; }
    const Kurve& k = t.def(r).kurve;
    std::printf("  \"%s\": {\"aus_x\": [", pfade[i]);
    for (int j = 0; j < nx; j++) {
      const float x = static_cast<float>(j) / (nx - 1);
      std::printf("%s[%.9g, %.9g]", j ? ", " : "", x, ReglerTabelle::aus_x(k, x));
    }
    // Sonderstützpunkte um die Grenzen (Kill, Stumm)
    const float xs[] = {0.0005f, 0.001f, 0.0011f, 1e-6f, 0.002f, 0.0001f};
    for (float x : xs) std::printf(", [%.9g, %.9g]", x, ReglerTabelle::aus_x(k, x));
    std::printf("], \"zu_x\": [");
    for (size_t j = 0; j < sizeof wdb / sizeof wdb[0]; j++)
      std::printf("%s[%.9g, %.9g]", j ? ", " : "", wdb[j], ReglerTabelle::zu_x(k, wdb[j]));
    std::printf("]}%s\n", i + 1 < sizeof pfade / sizeof pfade[0] ? "," : "");
  }
  std::printf("}\n");
  return 0;
}
