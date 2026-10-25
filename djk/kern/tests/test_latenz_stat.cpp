// I08 Task 13: Auswertung der Schleifenmessung. Ohne Treffer oder mit zu wenigen Läufen kein Wert (keine_schleife / zu_wenige_laeufe).
#include <cmath>
#include <cstring>
#include <vector>

#include "../pruef/latenz_stat.h"
#include "pruef.h"

int main() {
  {  // 20 Läufe: Mittel, Streuung (Standardabweichung der Grundgesamtheit), Min, Max
    std::vector<int> d;
    for (int i = 0; i < 10; ++i) { d.push_back(1000); d.push_back(1002); }
    const LatenzErgebnis e = latenz_auswerten(d, 20);
    PRUEF(e.ok && e.laeufe == 20);
    PRUEF_NAH(e.mittel, 1001.0, 1e-9);
    PRUEF_NAH(e.streuung, 1.0, 1e-9);
    PRUEF(e.min == 1000 && e.max == 1002);
  }
  {  // gleichbleibende Reihe: Streuung 0, nicht NaN
    const LatenzErgebnis e = latenz_auswerten(std::vector<int>(25, 480), 20);
    PRUEF(e.ok && e.streuung == 0.0 && e.mittel == 480.0);
  }
  {  // Negativ-Kontrolle: nichts gemessen = keine Schleife, und es gibt keinen Wert
    const LatenzErgebnis e = latenz_auswerten({}, 20);
    PRUEF(!e.ok && std::strcmp(e.grund, "keine_schleife") == 0);
  }
  {  // 19 Läufe sind zu wenige; ungültige Einträge (< 0 = kein Treffer) zählen nicht mit
    std::vector<int> d(19, 500);
    PRUEF(!latenz_auswerten(d, 20).ok && std::strcmp(latenz_auswerten(d, 20).grund, "zu_wenige_laeufe") == 0);
    std::vector<int> mit_fehlversuchen(30, -1);
    for (int i = 0; i < 20; ++i) mit_fehlversuchen[i] = 500;
    const LatenzErgebnis e = latenz_auswerten(mit_fehlversuchen, 20);
    PRUEF(e.ok && e.laeufe == 20 && e.mittel == 500.0);
  }
  PRUEF_ENDE();
}
