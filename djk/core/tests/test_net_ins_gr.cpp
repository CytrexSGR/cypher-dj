// 1.10 slice 4a seam S2: INS_GR (event 43) on the wire as /e/ins_gr ,sf (kanal = ins/komp/<n>, gr_db >= 0), §5.5f. Two events with different values so that
// neither the path nor the value can be taken from a leftover. Mutation: CYPHERDJ_MUTATION_INS_GR_NICHT_GEROUTET (net_loop.cpp drops the event, as
// before the route existed) turns case 1 red.
#include <cstring>
#include <memory>

#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

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
  z.art = cdj::Ereignis::INS_GR;
  std::snprintf(z.pfad, sizeof z.pfad, "ins/komp/7");
  z.wert = 6.25f;
  PRUEF(ere->schiebe(z));
  netz.ereignisse_senden();
  PRUEF(g.warte("/e/ins_gr", 200));
  PRUEF(g.m.anzahl == 2);
  PRUEF(std::strcmp(g.s(0), "ins/komp/7") == 0);
  PRUEF(g.f(1) == 6.25f);
  // second stage, another value: the message follows the event, not the first one
  z = cdj::Ereignis{};
  z.art = cdj::Ereignis::INS_GR;
  std::snprintf(z.pfad, sizeof z.pfad, "ins/komp/12");
  z.wert = 0.0f;
  PRUEF(ere->schiebe(z));
  netz.ereignisse_senden();
  PRUEF(g.warte("/e/ins_gr", 200));
  PRUEF(std::strcmp(g.s(0), "ins/komp/12") == 0);
  PRUEF(g.f(1) == 0.0f);
  PRUEF_ENDE();
}
