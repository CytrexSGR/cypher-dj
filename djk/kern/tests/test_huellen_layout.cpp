// Layout des Hüllkurven-Rings (SCHNITTSTELLEN §6.2): Kopf 64 Bytes, w bei 32, Datensatz 64 Bytes, Lage r·16+c.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "cypherdj/huellen.h"

static int fehler = 0;
#define PRUEFE(x) do { if (!(x)) { std::printf("FEHLER %s:%d %s\n", __FILE__, __LINE__, #x); ++fehler; } } while (0)

int main() {
  PRUEFE(sizeof(cdj_huellen_kopf) == 64);
  PRUEFE(sizeof(cdj_huellen_satz) == 64);
  PRUEFE(offsetof(cdj_huellen_kopf, w) == 32);
  PRUEFE(offsetof(cdj_huellen_satz, band) == 24);
  PRUEFE(CDJ_HUELLEN_BYTES == 64u + 16384u * 16u * 64u);
  void* p = std::aligned_alloc(64, CDJ_HUELLEN_BYTES);
  std::memset(p, 0x5a, CDJ_HUELLEN_BYTES);
  auto* k = static_cast<cdj_huellen_kopf*>(p);
  PRUEFE(!cdj_huellen_gueltig(k));
  cdj_huellen_init(k);
  PRUEFE(cdj_huellen_gueltig(k));
  PRUEFE(std::memcmp(k->magic, "CDJH", 4) == 0 && k->rate_hz == 1000 && k->n_kanaele == 16 && k->cap == 16384);
  PRUEFE(cdj_lade(&k->w) == 0);
  // Lage: Datensatz r=16385 (läuft um auf 1), Kanal 3
  cdj_huellen_satz* s = cdj_huellen_ort(k, 16385, 3);
  PRUEFE((char*)s - (char*)p == 64 + (1 * 16 + 3) * 64);
  std::free(p);
  std::printf("%s\n", fehler ? "ROT" : "GRUEN");
  return fehler ? 1 : 0;
}
