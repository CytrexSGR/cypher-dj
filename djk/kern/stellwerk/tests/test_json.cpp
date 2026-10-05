// Scheibe 11, Task 3: der kleine JSON-Leser liest Folgen-Zeilen; IDs bleiben ganzzahlig, Fehler werden gemeldet.
#include <string>

#include "json_mini.h"
#include "pruef.h"

FALL(folgenzeile_sende) {
  const std::string z = R"({"t":"sende","sample":1620000,"osc":["/k/teil",",hssisddfiiss",9007199254740993,"cypher","p",0,"deck/2/fader",64.0,32,-7.5,0,1,"b_rein",""]})";
  jm::Wert w;
  std::string f;
  jm::Leser l(z);
  PRUEFE(l.lies(w, f));
  PRUEFE(w.feld("t")->s == "sende");
  PRUEFE_GLEICH(w.feld("sample")->i, 1620000);
  const jm::Wert& osc = *w.feld("osc");
  PRUEFE_GLEICH(osc.l.size(), 14);
  PRUEFE(osc.l[2].ganz);
  PRUEFE_GLEICH(osc.l[2].i, 9007199254740993LL);   // größer als 2^53: bleibt exakt
  PRUEFE_NAH(osc.l[7].d, 64.0, 0);
  PRUEFE(!osc.l[7].ganz);
  PRUEFE_NAH(osc.l[9].d, -7.5, 0);
  PRUEFE(osc.l[13].art == jm::Wert::text && osc.l[13].s.empty());
}

FALL(null_escape_und_zahlen) {
  const std::string z = R"({"a":null,"b":true,"c":"ä\n","d":-1.5e3,"e":[]})";
  jm::Wert w;
  std::string f;
  jm::Leser l(z);
  PRUEFE(l.lies(w, f));
  PRUEFE(w.feld("a")->art == jm::Wert::nichts);
  PRUEFE(w.feld("b")->b);
  PRUEFE(w.feld("c")->s == "\xC3\xA4\n");
  PRUEFE_NAH(w.feld("d")->d, -1500.0, 0);
  PRUEFE(w.feld("e")->art == jm::Wert::liste && w.feld("e")->l.empty());
}

FALL(kaputte_zeile_wird_gemeldet) {
  for (const char* z : {R"({"t":"sende",)", R"({"t" "x"})", R"([1,2)", R"({"t":"x"} rest)"}) {
    jm::Wert w;
    std::string f;
    const std::string s = z;
    jm::Leser l(s);
    PRUEFE(!l.lies(w, f));
    PRUEFE(!f.empty());
  }
}

PRUEF_MAIN
