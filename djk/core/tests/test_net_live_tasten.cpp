// Task N2: /k/live/tasten ,hsi in the net thread (INTERFACES 4.7).
//   (a) good commands become Befehl TASTEN_ZIEL: nr = strom for 0 (off), 2, 3, 5, 6, 7, 9, 10 from andreas and from the other sources that are no cypher
//   (b) refusals as /q 6 with nothing in the ring: strom 1, 4, 8, 11, -1 -> ausserhalb_bereich; unknown source -> ausserhalb_bereich; cypher -> nur_hand (also for strom 0), the range first
#include <cstdio>
#include <cstring>
#include <memory>

#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;

int main() {
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Befehl b;
  {
    cdj::Netz netz(0, false, bef.get(), ere.get());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    auto sende = [&](int64_t id, const char* quelle, int32_t strom) {
      cdj::osc::Schreiber s(v::k_live_tasten);
      s.h(id).s(quelle).i(strom);
      netz.paket(s.daten(), s.groesse());
    };
    auto abgelehnt = [&](int64_t id, const char* grund) {
      return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund) && !bef->hole(b);
    };
    int64_t id = 900;
    for (int strom : {0, 2, 3, 5, 6, 7, 9, 10}) {
      sende(++id, "andreas", strom);
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::TASTEN_ZIEL && b.id == id && b.nr == strom && !std::strcmp(b.quelle, "andreas"));
    }
    sende(++id, "leitstand", 2);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::TASTEN_ZIEL && !std::strcmp(b.quelle, "leitstand"));
    for (int strom : {1, 4, 8, 11, -1}) {
      sende(++id, "andreas", strom);
      PRUEF(abgelehnt(id, "ausserhalb_bereich"));
    }
    sende(++id, "gibtsnicht", 2);
    PRUEF(abgelehnt(id, "ausserhalb_bereich"));
    sende(++id, "cypher", 2);
    PRUEF(abgelehnt(id, "nur_hand"));
    sende(++id, "cypher", 0);
    PRUEF(abgelehnt(id, "nur_hand"));
    sende(++id, "cypher", 4);
    PRUEF(abgelehnt(id, "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
  }
  PRUEF_ENDE();
}
