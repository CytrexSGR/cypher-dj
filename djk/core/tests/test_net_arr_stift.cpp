// Kraken patch field: /k/arr/stift ,hsiiiif in the net thread (INTERFACES 4.11).
//   (a) good commands become Befehl ARR_STIFT: nr = spur (1..128), form = satz, politik = zeile, fassung = spalte, wert = wert; the edges (satz 1, zeile 15, spalte 15, wert -1 and 1, 0) pass
//   (b) refusals as /q 6 with nothing in the ring, in this order: spur outside 1..128 -> spur_bereich (before the others); satz, zeile, spalte or wert outside the range, NaN and inf
//       -> ausserhalb_bereich; a source that is none of the list -> ausserhalb_bereich
//   (c) in the AI stop cypher is refused with ki_gestoppt before any range check, andreas is not
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
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
    auto sende = [&](int64_t id, const char* quelle, int32_t spur, int32_t satz, int32_t zeile, int32_t spalte, float wert) {
      cdj::osc::Schreiber s(v::k_arr_stift);
      s.h(id).s(quelle).i(spur).i(satz).i(zeile).i(spalte).f(wert);
      netz.paket(s.daten(), s.groesse());
    };
    auto abgelehnt = [&](int64_t id, const char* grund) {
      return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund) && !bef->hole(b);
    };
    const float inf = std::numeric_limits<float>::infinity(), nan = std::nanf("");
    // (a) good commands
    sende(901, "andreas", 1, 0, 0, 0, 0.5f);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_STIFT && b.id == 901 && b.nr == 1 && b.form == 0 && b.politik == 0 && b.fassung == 0 && b.wert == 0.5f && !std::strcmp(b.quelle, "andreas"));
    sende(902, "andreas", 128, 1, 15, 15, -1.0f);
    PRUEF(bef->hole(b) && b.nr == 128 && b.form == 1 && b.politik == 15 && b.fassung == 15 && b.wert == -1.0f);
    sende(903, "andreas", 5, 0, 7, 9, 1.0f);
    PRUEF(bef->hole(b) && b.nr == 5 && b.politik == 7 && b.fassung == 9 && b.wert == 1.0f);
    sende(904, "cypher", 2, 1, 3, 4, 0.0f);   // 0 is a valid value (the pin is cleared); not in the AI stop: cypher plays
    PRUEF(bef->hole(b) && b.id == 904 && b.wert == 0.0f && !std::strcmp(b.quelle, "cypher"));
    // (b) refusals
    sende(911, "andreas", 0, 0, 0, 0, 0.5f);
    PRUEF(abgelehnt(911, "spur_bereich"));
    sende(912, "andreas", 129, 0, 0, 0, 0.5f);
    PRUEF(abgelehnt(912, "spur_bereich"));
    sende(913, "andreas", -1, 0, 0, 0, 0.5f);
    PRUEF(abgelehnt(913, "spur_bereich"));
    sende(914, "andreas", 0, 2, 0, 0, 0.5f);   // the track first, then the rest
    PRUEF(abgelehnt(914, "spur_bereich"));
    sende(915, "andreas", 1, 2, 0, 0, 0.5f);
    PRUEF(abgelehnt(915, "ausserhalb_bereich"));
    sende(916, "andreas", 1, -1, 0, 0, 0.5f);
    PRUEF(abgelehnt(916, "ausserhalb_bereich"));
    sende(917, "andreas", 1, 0, 16, 0, 0.5f);
    PRUEF(abgelehnt(917, "ausserhalb_bereich"));
    sende(918, "andreas", 1, 0, -1, 0, 0.5f);
    PRUEF(abgelehnt(918, "ausserhalb_bereich"));
    sende(919, "andreas", 1, 0, 0, 16, 0.5f);
    PRUEF(abgelehnt(919, "ausserhalb_bereich"));
    sende(920, "andreas", 1, 0, 0, -1, 0.5f);
    PRUEF(abgelehnt(920, "ausserhalb_bereich"));
    sende(921, "andreas", 1, 0, 0, 0, 1.01f);
    PRUEF(abgelehnt(921, "ausserhalb_bereich"));
    sende(922, "andreas", 1, 0, 0, 0, -1.01f);
    PRUEF(abgelehnt(922, "ausserhalb_bereich"));
    sende(923, "andreas", 1, 0, 0, 0, nan);
    PRUEF(abgelehnt(923, "ausserhalb_bereich"));
    sende(924, "andreas", 1, 0, 0, 0, inf);
    PRUEF(abgelehnt(924, "ausserhalb_bereich"));
    sende(925, "andreas", 1, 0, 0, 0, -inf);
    PRUEF(abgelehnt(925, "ausserhalb_bereich"));
    sende(926, "gibtsnicht", 1, 0, 0, 0, 0.5f);
    PRUEF(abgelehnt(926, "ausserhalb_bereich"));
    // (c) AI stop
    {
      cdj::Ereignis ki{};
      ki.art = cdj::Ereignis::KI;
      ki.status = 1;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
      sende(931, "cypher", 1, 0, 0, 0, 0.5f);
      PRUEF(abgelehnt(931, "ki_gestoppt"));
      sende(932, "cypher", 99, 9, 9, 99, nan);   // before any range check
      PRUEF(abgelehnt(932, "ki_gestoppt"));
      sende(933, "andreas", 1, 0, 0, 0, 0.5f);
      PRUEF(bef->hole(b) && b.id == 933);
    }
  }
  PRUEF_ENDE();
}
