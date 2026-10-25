// I08 Task 1: EingangsBank. Zeiger je Paar, Spitze über beide Kanäle (Lesen setzt zurück), Impuls-Flanke nach >= 64 Samples Ruhe.
#include <cmath>
#include <limits>
#include <vector>

#include "cypherdj/eingang.h"
#include "pruef.h"

int main() {
  {  // Spitze: der rechte Kanal zählt mit; Lesen setzt zurück
    std::vector<float> l(64, 0.0f), r(64, 0.0f);
    l[10] = 0.5f;
    r[40] = -0.8f;
    cdj::EingangsBank b;
    b.zeiger(2, l.data(), r.data());
    PRUEF(b.da(2) && !b.da(1) && !b.da(0) && !b.da(5));
    b.messe(1000, 0, 32);  // r[40] liegt noch nicht im Fenster
    PRUEF_NAH(b.spitze_lesen(2), 0.5, 1e-9);
    b.messe(1032, 32, 32);  // jetzt r[40]
    PRUEF_NAH(b.spitze_lesen(2), 0.8, 1e-6);
    PRUEF_NAH(b.spitze_lesen(2), 0.0, 1e-9);
    // Negativ-Kontrolle: Paare ohne Zeiger und außerhalb 1..4 bleiben 0
    PRUEF_NAH(b.spitze_lesen(1), 0.0, 1e-9);
    PRUEF_NAH(b.spitze_lesen(0), 0.0, 1e-9);
    PRUEF_NAH(b.spitze_lesen(5), 0.0, 1e-9);
  }
  {  // Ausreißer: nicht endliche Werte werden als 8,0 gemeldet, nie als NaN
    std::vector<float> l(8, 0.0f);
    l[3] = std::numeric_limits<float>::quiet_NaN();
    cdj::EingangsBank b;
    b.zeiger(3, l.data(), l.data());
    b.messe(0, 0, 8);
    PRUEF_NAH(b.spitze_lesen(3), 8.0, 1e-9);
  }
  {  // Flanke: erster Ausschlag nach >= 64 Samples Ruhe; ein zweiter dicht dahinter zählt nicht
    std::vector<float> x(400, 0.0f);
    x[100] = 1.0f;
    x[110] = 1.0f;  // 9 Samples Ruhe: keine neue Flanke
    x[300] = 1.0f;  // 189 Samples Ruhe: neue Flanke
    cdj::EingangsBank f;
    PRUEF(f.flanke(1) == -1);
    f.zeiger(1, x.data(), x.data());
    f.messe(5000, 0, 200);
    PRUEF(f.flanke(1) == 5100);
    f.messe(5200, 200, 200);
    PRUEF(f.flanke(1) == 5300);
  }
  PRUEF_ENDE();
}
