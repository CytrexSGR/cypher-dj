// 1.12 Automation slice 3, task 7: /k/arr/arm ,hsiii in the net thread (INTERFACES 4.11) and /e/auto_punkt ,sdf (5.13).
//   (a) good commands become Befehl ARR_ARM: nr = spur (0..32), an, politik = modus (0 touch, 1 latch, 2 write); spur 0 with an 0 passes
//   (b) refusals as /q 6 with nothing in the ring: spur outside 0..32, an outside 0/1, modus outside 0..2, spur 0 with an 1 -> format;
//       cypher and every other source than andreas -> nur_andreas (for an 1 and an 0); andreas passes (negative control)
//   (c) in the AI stop cypher is refused with ki_gestoppt before any range check, andreas is not
//   (d) the kern event AUTO_PUNKT leaves as /e/auto_punkt with pfad, projekt_beat and wert
// Mutation (WILL_FAIL): ARR_ARM_CYPHER (the net thread lets every source arm).
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
    auto sende = [&](int64_t id, const char* quelle, int32_t spur, int32_t an, int32_t modus) {
      cdj::osc::Schreiber s(v::k_arr_arm);
      s.h(id).s(quelle).i(spur).i(an).i(modus);
      netz.paket(s.daten(), s.groesse());
    };
    auto abgelehnt = [&](int64_t id, const char* grund) {
      return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund) && !bef->hole(b);
    };
    // (a) good commands
    sende(701, "andreas", 3, 1, 2);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_ARM && b.id == 701 && b.nr == 3 && b.an == 1 && b.politik == 2 && !std::strcmp(b.quelle, "andreas"));
    sende(702, "andreas", 32, 1, 0);
    PRUEF(bef->hole(b) && b.nr == 32 && b.an == 1 && b.politik == 0);
    sende(703, "andreas", 1, 0, 1);
    PRUEF(bef->hole(b) && b.nr == 1 && b.an == 0 && b.politik == 1);
    sende(704, "andreas", 0, 0, 0);   // disarm everything
    PRUEF(bef->hole(b) && b.nr == 0 && b.an == 0);
    // (b) refusals
    sende(711, "andreas", 33, 1, 0);
    PRUEF(abgelehnt(711, "format"));
    sende(712, "andreas", -1, 1, 0);
    PRUEF(abgelehnt(712, "format"));
    sende(713, "andreas", 1, 2, 0);
    PRUEF(abgelehnt(713, "format"));
    sende(714, "andreas", 1, 1, 3);
    PRUEF(abgelehnt(714, "format"));
    sende(715, "andreas", 1, 1, -1);
    PRUEF(abgelehnt(715, "format"));
    sende(716, "andreas", 0, 1, 1);
    PRUEF(abgelehnt(716, "format"));
    sende(717, "cypher", 1, 1, 1);
    PRUEF(abgelehnt(717, "nur_andreas"));
    sende(718, "cypher", 1, 0, 1);
    PRUEF(abgelehnt(718, "nur_andreas"));
    sende(719, "leitstand", 1, 1, 1);
    PRUEF(abgelehnt(719, "nur_andreas"));
    sende(720, "gibtsnicht", 1, 1, 1);
    PRUEF(abgelehnt(720, "ausserhalb_bereich"));
    sende(721, "cypher", 99, 1, 1);   // the range is checked before the source
    PRUEF(abgelehnt(721, "format"));
    // (c) AI stop
    {
      cdj::Ereignis ki{};
      ki.art = cdj::Ereignis::KI;
      ki.status = 1;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
      sende(731, "cypher", 1, 1, 1);
      PRUEF(abgelehnt(731, "ki_gestoppt"));
      sende(732, "cypher", 99, 1, 1);   // before any range check
      PRUEF(abgelehnt(732, "ki_gestoppt"));
      sende(733, "andreas", 1, 1, 1);
      PRUEF(bef->hole(b) && b.id == 733);
    }
    // (d) the event
    {
      cdj::Ereignis e{};
      e.art = cdj::Ereignis::AUTO_PUNKT;
      std::strcpy(e.pfad, "spur/5/pan");
      e.beat = 12.625;
      e.wert = -0.25f;
      PRUEF(ere->schiebe(e));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/auto_punkt", 300) && !std::strcmp(g.m.typen, "sdf"));
      PRUEF(!std::strcmp(g.s(0), "spur/5/pan") && g.m.werte[1].d == 12.625 && g.m.werte[2].f == -0.25f);
    }
  }
  PRUEF_ENDE();
}
