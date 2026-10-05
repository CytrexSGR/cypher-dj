// Ring-Layout §6.1 (Größen und Lage der Felder, geprüft auch zur Bauzeit) und Z2-Namen, -Pfade, -Ports.
#include <cstring>

#include "cypherdj/instanz.h"
#include "cypherdj/ring.h"
#include "pruef.h"

int main() {
  PRUEF(sizeof(cdj_ring_kopf) == 64);
  PRUEF(offsetof(cdj_ring_kopf, magic) == 0 && offsetof(cdj_ring_kopf, version) == 4);
  PRUEF(offsetof(cdj_ring_kopf, rate) == 8 && offsetof(cdj_ring_kopf, kanaele) == 12);
  PRUEF(offsetof(cdj_ring_kopf, cap) == 16 && offsetof(cdj_ring_kopf, reserve) == 20);
  PRUEF(offsetof(cdj_ring_kopf, w) == 32 && offsetof(cdj_ring_kopf, takt_frames) == 40);
  PRUEF(offsetof(cdj_ring_kopf, takt_anfang_w) == 48 && offsetof(cdj_ring_kopf, reserve2) == 56);
  PRUEF(CDJ_RING_BYTES == 64u + 65536u * 4u * 4u);

  PRUEF(cdj_instanz_k("") == 0);
  PRUEF(cdj_instanz_k(nullptr) == 0);
  PRUEF(cdj_instanz_k("a") == 1);
  PRUEF(cdj_instanz_k("i") == 9);
  PRUEF(cdj_instanz_k("j") == -1);
  PRUEF(cdj_instanz_k("ab") == -1);
  PRUEF(cdj_instanz_k("A") == -1);
  PRUEF(cdj_port(47100, "") == 47100);
  PRUEF(cdj_port(47100, "a") == 48100);
  PRUEF(cdj_port(47140, "i") == 56140);
  char s[128];
  cdj_name(s, sizeof s, "cypherdj-kern", "a");
  PRUEF(!std::strcmp(s, "cypherdj-kern-a"));
  cdj_name(s, sizeof s, "cypherdj-kern", "");
  PRUEF(!std::strcmp(s, "cypherdj-kern"));
  cdj_shm_ordner(s, sizeof s, "c");
  PRUEF(!std::strcmp(s, "/dev/shm/cypherdj-c"));
  cdj_shm_ordner(s, sizeof s, "");
  PRUEF(!std::strcmp(s, "/dev/shm/cypherdj"));
  PRUEF_ENDE();
}
