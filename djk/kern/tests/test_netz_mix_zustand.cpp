// 1.15 A6: /zustand/mix on the wire. MIX_ZUSTAND becomes ,sfffff in the order of the contract (osc_adressen.h zustand_mix: kanal, gate_db,
// mb_tief_db, mb_mitte_db, mb_hoch_db, lim_db); five different values so that no swap of two fields goes unnoticed.
// Mutation: CYPHERDJ_MUTATION_MIX_FELDER_VERTAUSCHT (mb_tief and mb_hoch swapped in netz_loop.cpp) turns case 1 red.
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
  cdj::Ereignis z{};
  z.art = cdj::Ereignis::MIX_ZUSTAND;
  std::snprintf(z.pfad, sizeof z.pfad, "bus/3");
  z.pegel[0] = 1.5f;
  z.pegel[1] = 2.5f;
  z.pegel[2] = 3.5f;
  z.pegel[3] = 4.5f;
  z.pegel[4] = 5.5f;
  PRUEF(ere->schiebe(z));
  netz.ereignisse_senden();
  PRUEF(g.warte("/zustand/mix", 200));
  PRUEF(g.m.anzahl == 6);
  PRUEF(std::strcmp(g.s(0), "bus/3") == 0);
  PRUEF(g.f(1) == 1.5f);   // gate_db
  PRUEF(g.f(2) == 2.5f);   // mb_tief_db
  PRUEF(g.f(3) == 3.5f);   // mb_mitte_db
  PRUEF(g.f(4) == 4.5f);   // mb_hoch_db
  PRUEF(g.f(5) == 5.5f);   // lim_db
  // negative control: an all-zero event of a source channel arrives as zeros, not as leftovers
  z = cdj::Ereignis{};
  z.art = cdj::Ereignis::MIX_ZUSTAND;
  std::snprintf(z.pfad, sizeof z.pfad, "deck/1");
  PRUEF(ere->schiebe(z));
  netz.ereignisse_senden();
  PRUEF(g.warte("/zustand/mix", 200));
  PRUEF(std::strcmp(g.s(0), "deck/1") == 0);
  for (int k = 1; k <= 5; ++k) PRUEF(g.f(k) == 0.0f);
  PRUEF_ENDE();
}
