// Sampler plan A1 task 7: /k/arr/note ,hsiii in the net thread (INTERFACES 4.11).
//   (a) good commands become Befehl ARR_NOTE: nr = spur (1..128), politik = ton, fassung = vel; vel 0 (the off) and the edges pass; every source of the list passes
//   (b) refusals as /q 6 with nothing in the ring: spur 0, 129, -1 -> spur_bereich; ton or vel outside 0..127 -> ausserhalb_bereich; a source that is none of the list -> ausserhalb_bereich
//   (c) in the AI stop cypher is refused with ki_gestoppt before any range check, andreas is not
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
    auto sende = [&](int64_t id, const char* quelle, int32_t spur, int32_t ton, int32_t vel) {
      cdj::osc::Schreiber s(v::k_arr_note);
      s.h(id).s(quelle).i(spur).i(ton).i(vel);
      netz.paket(s.daten(), s.groesse());
    };
    auto abgelehnt = [&](int64_t id, const char* grund) {
      return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund) && !bef->hole(b);
    };
    // (a) good commands
    sende(801, "andreas", 1, 60, 100);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_NOTE && b.id == 801 && b.nr == 1 && b.politik == 60 && b.fassung == 100 && !std::strcmp(b.quelle, "andreas"));
    sende(802, "andreas", 128, 127, 127);
    PRUEF(bef->hole(b) && b.nr == 128 && b.politik == 127 && b.fassung == 127);
    sende(803, "andreas", 5, 0, 0);   // the off, the lowest note
    PRUEF(bef->hole(b) && b.nr == 5 && b.politik == 0 && b.fassung == 0);
    sende(804, "cypher", 2, 62, 90);   // not in the AI stop: cypher plays
    PRUEF(bef->hole(b) && b.id == 804 && !std::strcmp(b.quelle, "cypher"));
    // (b) refusals
    sende(811, "andreas", 0, 60, 100);
    PRUEF(abgelehnt(811, "spur_bereich"));
    sende(812, "andreas", 129, 60, 100);
    PRUEF(abgelehnt(812, "spur_bereich"));
    sende(813, "andreas", -1, 60, 100);
    PRUEF(abgelehnt(813, "spur_bereich"));
    sende(814, "andreas", 1, 128, 100);
    PRUEF(abgelehnt(814, "ausserhalb_bereich"));
    sende(815, "andreas", 1, -1, 100);
    PRUEF(abgelehnt(815, "ausserhalb_bereich"));
    sende(816, "andreas", 1, 60, 128);
    PRUEF(abgelehnt(816, "ausserhalb_bereich"));
    sende(817, "andreas", 1, 60, -1);
    PRUEF(abgelehnt(817, "ausserhalb_bereich"));
    sende(818, "gibtsnicht", 1, 60, 100);
    PRUEF(abgelehnt(818, "ausserhalb_bereich"));
    // (c) AI stop
    {
      cdj::Ereignis ki{};
      ki.art = cdj::Ereignis::KI;
      ki.status = 1;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
      sende(821, "cypher", 1, 60, 100);
      PRUEF(abgelehnt(821, "ki_gestoppt"));
      sende(822, "cypher", 99, 60, 100);   // before any range check
      PRUEF(abgelehnt(822, "ki_gestoppt"));
      sende(823, "andreas", 1, 60, 100);
      PRUEF(bef->hole(b) && b.id == 823);
    }
  }
  PRUEF_ENDE();
}
