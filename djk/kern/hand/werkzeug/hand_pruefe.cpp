// hand_pruefe: lädt Mapping-Dateien nach SCHNITTSTELLEN §7.2 und meldet je Datei "OK ..." oder
// "<datei>:<zeile>: <fehlerart>: <text>". Rückgabe 0, wenn alle laden, sonst 1. Für Scheibe 19 (Abnahme) und 40.
#include <cstdio>
#include <memory>

#include "hand/mapping.h"

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "Aufruf: hand_pruefe <mapping.json> ...\n");
    return 2;
  }
  const stellwerk::ReglerTabelle tab;
  auto m = std::make_unique<hand::Mapping>();
  int rc = 0;
  for (int i = 1; i < argc; i++) {
    hand::Fehler f;
    if (hand::lade_datei(argv[i], tab, m.get(), &f)) {
      std::printf("OK %s: %d Eintraege, %d LEDs, Geraet %s\n", argv[i], m->n_eintraege, m->n_leds, m->geraet);
    } else {
      // f.text beginnt mit "Zeile <n>: "; für Editoren als <datei>:<zeile>: ausgeben
      const char* rest = f.text;
      while (*rest && *rest != ':') rest++;
      std::printf("%s:%d%s\n", argv[i], f.zeile, rest);
      rc = 1;
    }
  }
  return rc;
}
