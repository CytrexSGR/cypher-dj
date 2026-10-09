// Gegenstelle (gegenstelle.h) selbst: ein Warten auf eine Adresse darf nicht an Paketen scheitern, die der Empfangspuffer
// verworfen hat, wenn der Test eine Weile nicht gelesen hat (Befund 2026-10-08: das Netz schickt je Zyklus mehrere Pakete,
// unter Last lief der Puffer voll und /e/mitschnitt ging verloren). Fehlerfall: Flut vor dem gesuchten Paket. Negativ-
// Kontrollen: Reihenfolge und Verbrauch bleiben wie zuvor, "kein Paket X" bleibt falsch und dauert die Frist.
#include <chrono>
#include <cstdio>

#include "gegenstelle.h"
#include "pruef.h"

static int sender() {
  const int s = socket(AF_INET, SOCK_DGRAM, 0);
  return s;
}
static void schick(int s, int port, const char* adresse, int32_t zahl) {
  cdj::osc::Schreiber w(adresse, "is");
  w.i(zahl).s("fuellung-fuellung-fuellung-fuellung-fuellung-fuellung-fuellung-fuellung");
  sockaddr_in a{};
  a.sin_family = AF_INET;
  a.sin_port = htons((uint16_t)port);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  sendto(s, w.daten(), w.groesse(), 0, (sockaddr*)&a, sizeof a);
}

int main() {
  const int tx = sender();

  {  // Fehlerfall: 3000 Pakete einer anderen Adresse stehen an, das gesuchte kommt zuletzt. Ein Puffer von ~1 MB hält nur
     // gut tausend davon, das gesuchte ginge verloren (alte Gegenstelle: false).
    Gegenstelle g;
    for (int n = 0; n < 3000; ++n) schick(tx, g.port, "/uhr", n);
    schick(tx, g.port, "/e/mitschnitt", 7);
    PRUEF(g.warte("/e/mitschnitt", 200));
    PRUEF(g.m.werte[0].i == 7);
  }
  {  // Treffer mitten im Strom: Pakete davor sind verbraucht, Pakete danach bleiben für das nächste warte() stehen
    Gegenstelle g;
    schick(tx, g.port, "/a", 1);
    schick(tx, g.port, "/b", 2);
    schick(tx, g.port, "/c", 3);
    PRUEF(g.warte("/b", 200) && g.m.werte[0].i == 2);
    PRUEF(g.warte("/c", 200) && g.m.werte[0].i == 3);
    PRUEF(!g.warte("/a", 30));  // war vor /b, ist verbraucht
  }
  {  // Negativ-Kontrolle: kein Paket X bleibt falsch, auch wenn andere eintreffen, und es dauert die Frist
    Gegenstelle g;
    schick(tx, g.port, "/uhr", 1);
    const auto t0 = std::chrono::steady_clock::now();
    PRUEF(!g.warte("/e/mitschnitt", 50));
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
    PRUEF(ms >= 45 && ms < 2000);
    schick(tx, g.port, "/e/mitschnitt", 9);
    PRUEF(g.warte("/e/mitschnitt", 200) && g.m.werte[0].i == 9);  // ein später eintreffendes wird gefunden
  }
  close(tx);
  PRUEF_ENDE();
}
