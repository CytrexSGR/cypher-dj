// 1.12 Automation slice 3, task 3: /k/arr/auto ,hsisi in the net thread (INTERFACES 4.11) and /e/auto ,isi (5.13).
//   (a) good commands become Befehl ARR_AUTO: nr = spur (0..32), politik = field (fader 0, pan 1, mute 2, solo 3), an
//   (b) refusals as /q 6 with nothing in the ring: spur outside 0..32 -> format, an outside 0/1 -> format, spur 0 with an 0 -> format,
//       unknown ziel -> auto_ziel_unbekannt, cypher with an 0 -> nur_andreas; cypher with an 1 passes (negative control), andreas with an 0 passes
//   (c) in the AI stop cypher is refused with ki_gestoppt before any range check (like every /k/arr command but stopp), andreas is not
//   (d) the kern event AUTO_ZUSTAND leaves as /e/auto with spur, the ziel name and zustand
// Mutation (WILL_FAIL): ARR_AUTO_CYPHER_UEBERSTEUERT (the net thread lets cypher override).
#include <cstdio>
#include <cstring>
#include <memory>
#include <utility>

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
    auto sende = [&](int64_t id, const char* quelle, int32_t spur, const char* ziel, int32_t an) {
      cdj::osc::Schreiber s(v::k_arr_auto);
      s.h(id).s(quelle).i(spur).s(ziel).i(an);
      netz.paket(s.daten(), s.groesse());
    };
    auto abgelehnt = [&](int64_t id, const char* grund) {
      return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund) && !bef->hole(b);
    };
    // (a) good commands
    sende(601, "andreas", 3, "pan", 0);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_AUTO && b.id == 601 && b.nr == 3 && b.politik == 1 && b.an == 0 && !std::strcmp(b.quelle, "andreas"));
    sende(602, "andreas", 32, "solo", 1);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_AUTO && b.nr == 32 && b.politik == 3 && b.an == 1);
    sende(603, "andreas", 1, "fader", 0);
    PRUEF(bef->hole(b) && b.nr == 1 && b.politik == 0 && b.an == 0);
    sende(604, "andreas", 7, "mute", 1);
    PRUEF(bef->hole(b) && b.nr == 7 && b.politik == 2 && b.an == 1);
    sende(605, "andreas", 0, "fader", 1);   // all tracks: ziel is checked, then ignored
    PRUEF(bef->hole(b) && b.nr == 0 && b.an == 1);
    // cypher may re-enable (negative control for nur_andreas)
    sende(606, "cypher", 2, "fader", 1);
    PRUEF(bef->hole(b) && b.id == 606 && b.an == 1 && !std::strcmp(b.quelle, "cypher"));
    // (b) refusals
    sende(611, "andreas", 33, "fader", 0);
    PRUEF(abgelehnt(611, "format"));
    sende(612, "andreas", -1, "fader", 0);
    PRUEF(abgelehnt(612, "format"));
    sende(613, "andreas", 1, "fader", 2);
    PRUEF(abgelehnt(613, "format"));
    sende(614, "andreas", 0, "fader", 0);
    PRUEF(abgelehnt(614, "format"));
    sende(615, "andreas", 1, "geraet.cutoff", 0);
    PRUEF(abgelehnt(615, "auto_ziel_unbekannt"));
    sende(616, "andreas", 1, "", 1);
    PRUEF(abgelehnt(616, "auto_ziel_unbekannt"));
    sende(617, "cypher", 1, "fader", 0);
    PRUEF(abgelehnt(617, "nur_andreas"));
    sende(618, "gibtsnicht", 1, "fader", 0);
    PRUEF(abgelehnt(618, "ausserhalb_bereich"));
    // order of the refusals: range of spur/an, then ziel, then spur 0 with an 0, then nur_andreas
    sende(631, "andreas", 99, "x", 0);
    PRUEF(abgelehnt(631, "format"));
    sende(632, "andreas", 0, "x", 0);
    PRUEF(abgelehnt(632, "auto_ziel_unbekannt"));
    sende(633, "cypher", 1, "x", 0);
    PRUEF(abgelehnt(633, "auto_ziel_unbekannt"));
    sende(634, "cypher", 0, "fader", 0);
    PRUEF(abgelehnt(634, "format"));
    // (c) AI stop
    {
      cdj::Ereignis ki{};
      ki.art = cdj::Ereignis::KI;
      ki.status = 1;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
      sende(621, "cypher", 1, "fader", 1);
      PRUEF(abgelehnt(621, "ki_gestoppt"));
      sende(622, "cypher", 99, "fader", 1);   // before any range check
      PRUEF(abgelehnt(622, "ki_gestoppt"));
      sende(623, "andreas", 1, "fader", 0);
      PRUEF(bef->hole(b) && b.id == 623);
    }
    // (d) the event
    {
      // an event that is no field of the contract is dropped, never mapped to another field (deck 3 with field 4 must not come out as 3/fader)
      cdj::Ereignis bad{};
      bad.art = cdj::Ereignis::AUTO_ZUSTAND;
      for (const auto& p : {std::pair<int, int>{3, 4}, {3, -1}, {0, 0}, {33, 0}}) {
        bad.deck = p.first;
        bad.fassung = p.second;
        bad.status = 1;
        PRUEF(ere->schiebe(bad));
      }
      bad.deck = 9;
      bad.fassung = 3;
      PRUEF(ere->schiebe(bad));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/auto", 300) && g.m.werte[0].i == 9 && !std::strcmp(g.s(1), "solo") && g.m.werte[2].i == 1);   // the first one that arrives is the good one
    }
    {
      cdj::Ereignis e{};
      e.art = cdj::Ereignis::AUTO_ZUSTAND;
      e.deck = 5;       // spur
      e.fassung = 2;    // field mute
      e.status = 1;
      PRUEF(ere->schiebe(e));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/auto", 300) && !std::strcmp(g.m.typen, "isi"));
      PRUEF(g.m.werte[0].i == 5 && !std::strcmp(g.s(1), "mute") && g.m.werte[2].i == 1);
      e.deck = 32;
      e.fassung = 0;
      e.status = 0;
      PRUEF(ere->schiebe(e));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/auto", 300) && g.m.werte[0].i == 32 && !std::strcmp(g.s(1), "fader") && g.m.werte[2].i == 0);
    }
  }
  PRUEF_ENDE();
}
