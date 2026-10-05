// Scheibe 25: Verteilung der Callback-Dauer (telemetrie.h) für die Zusage ARCHITEKTUR §7 (p99,9 unter 1,07 ms bei 256).
// Positiv-Kontrolle: zwei Ausreißer unter 1 002 Zyklen heben p99,9, nicht p99. Negativ-Kontrolle: ohne Werte −1.
// Über 20 ms landet ein Wert in der letzten Klasse, das Maximum bleibt genau.
#include "cypherdj/telemetrie.h"
#include "pruef.h"

int main() {
  cdj::Verteilung v;
  PRUEF(v.anzahl() == 0 && v.quantil(0.5) == -1 && v.max() == -1);
  for (int i = 0; i < 1000; ++i) v.zaehle(100);
  v.zaehle(2000);
  PRUEF(v.quantil(0.5) == 100 && v.quantil(0.99) == 100 && v.quantil(0.999) == 100);  // 1 von 1 001: unter p99,9
  v.zaehle(2000);
  PRUEF(v.quantil(0.99) == 100 && v.quantil(0.999) == 2000 && v.max() == 2000);        // 2 von 1 002: darüber
  v.zaehle(50'000);
  PRUEF(v.max() == 50'000 && v.quantil(1.0) == 20'000 && v.anzahl() == 1003);
  v.zaehle(-5);  // Uhrensprung: zählt als 0
  PRUEF(v.quantil(0.0) == 0);
  PRUEF_ENDE();
}
