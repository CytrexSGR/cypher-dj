// Device faces T9: STUFE_PEGEL (event 50) on the wire as /e/stufe_pegel ,sff (kanal, ein_db, aus_db), §5.5g. Three paths (insert compressor, insert limiter, channel compressor) with
// different values, so that neither the path nor one of the two levels can be taken from a leftover or swapped; -200 passes unchanged (silence, no NaN or -inf on the wire).
#include <cmath>
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
  const auto sende = [&](const char* pfad, float ein, float aus) {
    cdj::Ereignis z{};
    z.art = cdj::Ereignis::STUFE_PEGEL;
    std::snprintf(z.pfad, sizeof z.pfad, "%s", pfad);
    z.pegel[0] = ein;
    z.pegel[1] = aus;
    PRUEF(ere->schiebe(z));
    netz.ereignisse_senden();
    PRUEF(g.warte("/e/stufe_pegel", 200));
  };
  sende("ins/komp/7", -12.0f, -15.25f);
  PRUEF(g.m.anzahl == 3);
  PRUEF(std::strcmp(g.s(0), "ins/komp/7") == 0);
  PRUEF(g.f(1) == -12.0f);
  PRUEF(g.f(2) == -15.25f);
  sende("ins/lim/2", -3.5f, -6.0f);
  PRUEF(std::strcmp(g.s(0), "ins/lim/2") == 0);
  PRUEF(g.f(1) == -3.5f);
  PRUEF(g.f(2) == -6.0f);
  sende("komp/erz/1", -200.0f, -200.0f);   // silence
  PRUEF(std::strcmp(g.s(0), "komp/erz/1") == 0);
  PRUEF(g.f(1) == -200.0f && g.f(2) == -200.0f);
  PRUEF(std::isfinite(g.f(1)) && std::isfinite(g.f(2)));
  PRUEF_ENDE();
}
