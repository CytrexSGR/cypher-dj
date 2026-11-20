// Loop deck K6: /k/arr/zelle_start ,hssidd and /k/arr/zelle_stopp ,hssd in the net thread (index 1.3).
//   (a) good commands become Befehl ARR_ZELLE_START (pfad = track id, nr = zelle, ab_beat, wert_beats = versatz_beats) and ARR_ZELLE_STOPP (pfad, ab_beat); id and source carried
//   (b) wrong type tags are refused as /e/protokollfehler falsche_typen with nothing in the ring
//   (c) a track id of 33 chars is refused with spur_bereich (32 chars pass); an unknown source is ausserhalb_bereich
//   (d) in the AI stop cypher is refused with ki_gestoppt (stopp included: a stop is as much an intervention as a start), andreas is not
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

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
    auto start = [&](int64_t id, const char* quelle, const std::string& spur, int32_t zelle, double ab, double versatz) {
      cdj::osc::Schreiber s(v::k_arr_zelle_start);
      s.h(id).s(quelle).s(spur.c_str()).i(zelle).d(ab).d(versatz);
      netz.paket(s.daten(), s.groesse());
    };
    auto stopp = [&](int64_t id, const char* quelle, const std::string& spur, double ab) {
      cdj::osc::Schreiber s(v::k_arr_zelle_stopp);
      s.h(id).s(quelle).s(spur.c_str()).d(ab);
      netz.paket(s.daten(), s.groesse());
    };
    auto abgelehnt = [&](int64_t id, const char* grund) {
      return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund) && !bef->hole(b);
    };
    // (a) good commands
    start(801, "andreas", "s12", 3, 16.0, 1.5);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_ZELLE_START && b.id == 801 && !std::strcmp(b.pfad, "s12") && b.nr == 3 && b.ab_beat == 16.0 &&
          b.wert_beats == 1.5 && !std::strcmp(b.quelle, "andreas"));
    stopp(802, "cypher", "s12", 20.0);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_ZELLE_STOPP && b.id == 802 && !std::strcmp(b.pfad, "s12") && b.ab_beat == 20.0 && !std::strcmp(b.quelle, "cypher"));
    start(803, "andreas", std::string(32, 'x'), 8, 0.0, 0.0);   // 32 chars and the edges pass the net thread (the kern checks cell and range)
    PRUEF(bef->hole(b) && b.id == 803 && std::strlen(b.pfad) == 32 && b.nr == 8);
    // (b) wrong type tags
    {
      cdj::osc::Schreiber s("/k/arr/zelle_start", "hssidi");   // versatz_beats as i
      s.h(811).s("andreas").s("s12").i(1).d(4.0).i(0);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(0), "/k/arr/zelle_start") && !std::strcmp(g.s(1), "falsche_typen") && !bef->hole(b));
      cdj::osc::Schreiber t("/k/arr/zelle_stopp", "hssi");   // ab_beat as i
      t.h(812).s("andreas").s("s12").i(4);
      netz.paket(t.daten(), t.groesse());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(0), "/k/arr/zelle_stopp") && !std::strcmp(g.s(1), "falsche_typen") && !bef->hole(b));
      cdj::osc::Schreiber u("/k/arr/zelle_start", "hssid");   // a field short
      u.h(813).s("andreas").s("s12").i(1).d(4.0);
      netz.paket(u.daten(), u.groesse());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "falsche_typen") && !bef->hole(b));
    }
    // (c) refusals
    start(821, "andreas", std::string(33, 'x'), 1, 4.0, 0.0);
    PRUEF(abgelehnt(821, "spur_bereich"));
    stopp(822, "andreas", std::string(33, 'x'), 4.0);
    PRUEF(abgelehnt(822, "spur_bereich"));
    start(823, "gibtsnicht", "s12", 1, 4.0, 0.0);
    PRUEF(abgelehnt(823, "ausserhalb_bereich"));
    stopp(824, "gibtsnicht", "s12", 4.0);
    PRUEF(abgelehnt(824, "ausserhalb_bereich"));
    // (d) AI stop
    {
      cdj::Ereignis ki{};
      ki.art = cdj::Ereignis::KI;
      ki.status = 1;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
      start(831, "cypher", "s12", 1, 4.0, 0.0);
      PRUEF(abgelehnt(831, "ki_gestoppt"));
      stopp(832, "cypher", "s12", 4.0);
      PRUEF(abgelehnt(832, "ki_gestoppt"));
      start(833, "andreas", "s12", 1, 4.0, 0.0);
      PRUEF(bef->hole(b) && b.id == 833);
      stopp(834, "andreas", "s12", 4.0);
      PRUEF(bef->hole(b) && b.id == 834);
    }
  }
  PRUEF_ENDE();
}
