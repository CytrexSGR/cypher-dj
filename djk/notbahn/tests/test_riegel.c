/* Riegel: Positivliste ohne --ton-frei, alles mit --ton-frei; leere Namen nie. */
#include <stdio.h>

#include "riegel.h"

static int fehler = 0;
#define PRUEF(b) do { if (!(b)) { fprintf(stderr, "%s:%d: PRUEF(%s) gescheitert\n", __FILE__, __LINE__, #b); ++fehler; } } while (0)

int main(void) {
  PRUEF(riegel_erlaubt("cypher-stumm-probe:playback_FL", 0));
  PRUEF(riegel_erlaubt("cypherdj-pruef-a-3:playback_FR", 0));
  PRUEF(!riegel_erlaubt("alsa_output.pci-0000_16_00.6.iec958-stereo:playback_FL", 0));
  PRUEF(!riegel_erlaubt("riegelprobe-a:playback_FL", 0));
  PRUEF(!riegel_erlaubt("x-cypherdj-pruef-a:playback_FL", 0)); /* muss am Anfang stehen */
  PRUEF(!riegel_erlaubt("", 0));
  PRUEF(!riegel_erlaubt(NULL, 0));
  PRUEF(riegel_erlaubt("alsa_output.pci-0000_16_00.6.iec958-stereo:playback_FL", 1));
  PRUEF(!riegel_erlaubt("", 1));
  if (fehler) { fprintf(stderr, "%d Pruefung(en) gescheitert\n", fehler); return 1; }
  printf("alle Pruefungen gruen\n");
  return 0;
}
