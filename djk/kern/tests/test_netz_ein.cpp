// I08 Task 4, Review-Nachzug (MINOR 5): /zustand/ein auf dem Draht. EIN_ZUSTAND wird in netz.cpp in die Reihenfolge des Vertrags
// (osc_adressen.h zustand_ein: verbunden, midi_gesehen, midi_verloren, midi_sample, flanke_sample) gebracht; sieben verschiedene Werte,
// damit kein Vertauschen zweier Felder unbemerkt bleibt.
// Mutation: EIN_ZUSTAND_VERTAUSCHT (gesehen und verloren getauscht) macht Fall 1 rot.
#include <cstring>
#include <memory>

#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;

int main() {
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Netz netz(0, false, bef.get(), ere.get());
  Gegenstelle g;
  {
    cdj::osc::Schreiber s(v::k_hallo);
    s.s("x").i(g.port).i(1);
    netz.paket(s.daten(), s.groesse());
    PRUEF(g.warte("/k/willkommen", 200));
  }
  // 1: alle fünf Felder an ihrer Stelle, jedes mit einem eigenen Wert
  cdj::Ereignis z{};
  z.art = cdj::Ereignis::EIN_ZUSTAND;
  z.status = 0b10000101;
  z.ein_gesehen = 1234;
  z.ein_verloren = 7;
  z.ein_midi_sample = 987654321;
  z.ein_flanke = 55555;
  PRUEF(ere->schiebe(z));
  netz.ereignisse_senden();
  PRUEF(g.warte("/zustand/ein", 200));
  PRUEF(g.m.werte[0].i == 0b10000101);
  PRUEF(g.m.werte[1].h == 1234);       // midi_gesehen
  PRUEF(g.m.werte[2].h == 7);          // midi_verloren
  PRUEF(g.m.werte[3].h == 987654321);  // midi_sample
  PRUEF(g.m.werte[4].h == 55555);      // flanke_sample
  // 2: Negativ-Kontrolle, der Fall „nichts gesehen“ (−1 bleibt −1, 0 bleibt 0)
  z.status = 0; z.ein_gesehen = 0; z.ein_verloren = 0; z.ein_midi_sample = -1; z.ein_flanke = -1;
  PRUEF(ere->schiebe(z));
  netz.ereignisse_senden();
  PRUEF(g.warte("/zustand/ein", 200));
  PRUEF(g.m.werte[0].i == 0 && g.m.werte[1].h == 0 && g.m.werte[2].h == 0 && g.m.werte[3].h == -1 && g.m.werte[4].h == -1);
  PRUEF_ENDE();
}
