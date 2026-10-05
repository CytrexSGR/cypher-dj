// Scheibe 19: JSON-Leser mit Zeilennummern (Grundlage der Zeilenangabe bei fehlerhaften Mappings).
#include <string>

#include "json_zeilen.h"
#include "pruef.h"

using hand::json::Leser;
using hand::json::Wert;

namespace {
bool lies(const char* t, Wert& w, std::string& f, int& z) { return Leser(std::string(t)).lies(w, f, z); }
}  // namespace

FALL(zeile_je_wert_und_schluessel) {
  Wert w;
  std::string f;
  int z = 0;
  PRUEFE(lies("{\"a\":1,\n \"b\":\n  [true,\n   \"x\"]}", w, f, z));
  PRUEFE_GLEICH(w.zeile, 1);
  PRUEFE_GLEICH(w.feld("a")->zeile, 1);
  PRUEFE_GLEICH(w.feld("b")->zeile, 2);
  PRUEFE_GLEICH(w.feld("b")->wert.zeile, 3);
  PRUEFE_GLEICH(w.feld("b")->wert.l[0].zeile, 3);
  PRUEFE_GLEICH(w.feld("b")->wert.l[1].zeile, 4);
  PRUEFE(w.feld("b")->wert.l[1].s == "x");
}

FALL(zahlen_ganz_und_gebrochen) {
  Wert w;
  std::string f;
  int z = 0;
  PRUEFE(lies("[7, -26.0, 1e2, -200]", w, f, z));
  PRUEFE(w.l[0].ganz && w.l[0].d == 7);
  PRUEFE(!w.l[1].ganz && w.l[1].d == -26.0);
  PRUEFE(!w.l[2].ganz && w.l[2].d == 100.0);
  PRUEFE(w.l[3].ganz && w.l[3].d == -200);
}

FALL(fehler_mit_zeile) {
  Wert w;
  std::string f;
  int z = 0;
  PRUEFE(!lies("{\"a\":1,\n\"b\":2\n\"c\":3}", w, f, z));   // Komma fehlt nach Zeile 2
  PRUEFE_GLEICH(z, 3);
  PRUEFE(!lies("{\"a\":1,\n\"a\":2}", w, f, z));             // doppelter Schlüssel
  PRUEFE_GLEICH(z, 2);
  PRUEFE(f.find("doppelt") != std::string::npos);
  PRUEFE(!lies("{\"a\":\n\n", w, f, z));                     // Dateiende
  PRUEFE_GLEICH(z, 3);
}

FALL(negativ_kontrolle_gueltiges_json_ohne_fehler) {
  Wert w;
  std::string f = "unberührt";
  int z = -1;
  PRUEFE(lies("  {\"leer\": {}, \"liste\": [], \"t\": \"ä\\u00e4\"}  \n", w, f, z));
  PRUEFE(f == "unberührt");
  PRUEFE_GLEICH(z, -1);
  PRUEFE(w.feld("t")->wert.s == "ää");
}

PRUEF_MAIN
