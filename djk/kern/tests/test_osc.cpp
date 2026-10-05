// OSC gegen unabhängig erzeugte Bytes (Python struct, 2026-09-23) und Rundlauf; Formfehler werden erkannt.
#include <cstdio>
#include <cstring>
#include <string>

#include "cypherdj/osc.h"
#include "pruef.h"

static std::string hex(const char* p, size_t n) {
  std::string h;
  char b[3];
  for (size_t i = 0; i < n; ++i) { std::snprintf(b, sizeof b, "%02x", (unsigned char)p[i]); h += b; }
  return h;
}

int main() {
  using namespace cdj::osc;
  Schreiber a("/k/set/neu", "hsd");
  a.h(7).s("pruefstand").d(128.0);
  PRUEF(a.ok());
  PRUEF(hex(a.daten(), a.groesse()) ==
        "2f6b2f7365742f6e657500002c68736400000000000000000000000770727565667374616e6400004060000000000000");

  Schreiber q("/q", "hsihds");
  q.h(-5).s("pruefstand").i(2).h(22500).d(1.0).s("");
  PRUEF(q.ok());
  PRUEF(hex(q.daten(), q.groesse()) ==
        "2f7100002c68736968647300fffffffffffffffb70727565667374616e6400000000000200000000000057e43ff000000000000000000000");

  Nachricht n;
  const bool gelesen = lesen(q.daten(), q.groesse(), n);
  PRUEF(gelesen);
  if (gelesen) {  // nur ein gelesenes Paket hat gültige Zeiger
    PRUEF(std::strcmp(n.adresse, "/q") == 0);
    PRUEF(std::strcmp(n.typen, "hsihds") == 0);
    PRUEF(n.anzahl == 6);
    PRUEF(n.werte[0].h == -5);
    PRUEF(std::strcmp(n.werte[1].s, "pruefstand") == 0);
    PRUEF(n.werte[2].i == 2);
    PRUEF(n.werte[3].h == 22500);
    PRUEF(n.werte[4].d == 1.0);
    PRUEF(std::strcmp(n.werte[5].s, "") == 0);
  }

  // Negativ: falscher Typ beim Schreiben, abgeschnittenes Paket, Bundle, fehlendes Komma
  Schreiber falsch("/k/hallo", "sii");
  falsch.s("x").h(1);
  PRUEF(!falsch.ok());
  PRUEF(!lesen(q.daten(), q.groesse() - 4, n));
  const char bundle[16] = {'#', 'b', 'u', 'n', 'd', 'l', 'e', 0, 0, 0, 0, 0, 0, 0, 0, 1};
  PRUEF(!lesen(bundle, sizeof bundle, n));
  const char ohne_komma[8] = {'/', 'x', 0, 0, 'h', 0, 0, 0};
  PRUEF(!lesen(ohne_komma, sizeof ohne_komma, n));

  PRUEF_ENDE();
}
