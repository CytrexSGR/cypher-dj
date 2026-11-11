// Plan 1.11 T5: /k/arr/ins_host ,hsii and /k/arr/ins_mess ,hsi in the net thread (INTERFACES 4.11) and the answers /e/ins_host ,ii, /e/ins_mess ,iis, /zustand/ins_host (5.13).
//   (a) good commands become Befehl ARR_INS_HOST (nr = h, an = gesund) and ARR_INS_MESS (nr = h)
//   (b) refusals as /q 6 ausserhalb_bereich with nothing in the ring: h outside 1..4, gesund outside 0/1, an unknown source; leitstand and andreas pass (negative control)
//   (c) in the AI stop cypher is refused with ki_gestoppt before any range check, leitstand is not
//   (d) the kern events leave as /e/ins_host (h, gesund), /e/ins_mess (h, rundweg, grund) and /zustand/ins_host (12 integers)
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
    auto host = [&](int64_t id, const char* quelle, int32_t h, int32_t gesund) {
      cdj::osc::Schreiber s(v::k_arr_ins_host);
      s.h(id).s(quelle).i(h).i(gesund);
      netz.paket(s.daten(), s.groesse());
    };
    auto mess = [&](int64_t id, const char* quelle, int32_t h) {
      cdj::osc::Schreiber s(v::k_arr_ins_mess);
      s.h(id).s(quelle).i(h);
      netz.paket(s.daten(), s.groesse());
    };
    auto abgelehnt = [&](int64_t id, const char* grund) {
      return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund) && !bef->hole(b);
    };
    // (a)
    host(801, "leitstand", 2, 1);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_INS_HOST && b.id == 801 && b.nr == 2 && b.an == 1 && !std::strcmp(b.quelle, "leitstand"));
    host(802, "andreas", 4, 0);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_INS_HOST && b.nr == 4 && b.an == 0);
    mess(803, "leitstand", 1);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_INS_MESS && b.id == 803 && b.nr == 1);
    // (b)
    host(811, "leitstand", 0, 1);
    PRUEF(abgelehnt(811, "ausserhalb_bereich"));
    host(812, "leitstand", 5, 1);
    PRUEF(abgelehnt(812, "ausserhalb_bereich"));
    host(813, "leitstand", 1, 2);
    PRUEF(abgelehnt(813, "ausserhalb_bereich"));
    host(814, "leitstand", 1, -1);
    PRUEF(abgelehnt(814, "ausserhalb_bereich"));
    host(815, "gibtsnicht", 1, 1);
    PRUEF(abgelehnt(815, "ausserhalb_bereich"));
    mess(816, "leitstand", 0);
    PRUEF(abgelehnt(816, "ausserhalb_bereich"));
    mess(817, "leitstand", 5);
    PRUEF(abgelehnt(817, "ausserhalb_bereich"));
    mess(818, "gibtsnicht", 1);
    PRUEF(abgelehnt(818, "ausserhalb_bereich"));
    // (c)
    {
      cdj::Ereignis ki{};
      ki.art = cdj::Ereignis::KI;
      ki.status = 1;
      PRUEF(ere->schiebe(ki));
      netz.ereignisse_senden();
      host(831, "cypher", 1, 1);
      PRUEF(abgelehnt(831, "ki_gestoppt"));
      host(832, "cypher", 9, 1);   // before any range check
      PRUEF(abgelehnt(832, "ki_gestoppt"));
      mess(833, "cypher", 1);
      PRUEF(abgelehnt(833, "ki_gestoppt"));
      host(834, "leitstand", 1, 1);
      PRUEF(bef->hole(b) && b.id == 834);
      mess(835, "leitstand", 1);
      PRUEF(bef->hole(b) && b.id == 835);
    }
    // (d)
    {
      cdj::Ereignis e{};
      e.art = cdj::Ereignis::INS_HOST;
      e.deck = 3;
      e.status = 1;
      PRUEF(ere->schiebe(e));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/ins_host", 300) && !std::strcmp(g.m.typen, "ii") && g.m.werte[0].i == 3 && g.m.werte[1].i == 1);
      cdj::Ereignis m{};
      m.art = cdj::Ereignis::INS_MESS;
      m.deck = 2;
      m.status = 512;
      PRUEF(ere->schiebe(m));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/ins_mess", 300) && !std::strcmp(g.m.typen, "iis") && g.m.werte[0].i == 2 && g.m.werte[1].i == 512 && !std::strcmp(g.s(2), ""));
      cdj::Ereignis f{};
      f.art = cdj::Ereignis::INS_MESS;
      f.deck = 4;
      f.status = -1;
      std::strcpy(f.grund, "kein_rueckweg");
      PRUEF(ere->schiebe(f));
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/ins_mess", 300) && g.m.werte[0].i == 4 && g.m.werte[1].i == -1 && !std::strcmp(g.s(2), "kein_rueckweg"));
      cdj::Ereignis z{};
      z.art = cdj::Ereignis::INS_HOST_ZUSTAND;
      for (int h = 0; h < 4; ++h) {
        z.host_gesund[h] = h % 2;
        z.host_rundweg[h] = 500 + h;
      }
      PRUEF(ere->schiebe(z));
      netz.ereignisse_senden();
      PRUEF(g.warte("/zustand/ins_host", 300) && !std::strcmp(g.m.typen, "iiiiiiiiiiii"));
      for (int h = 0; h < 4; ++h)
        PRUEF(g.m.werte[3 * h].i == h + 1 && g.m.werte[3 * h + 1].i == h % 2 && g.m.werte[3 * h + 2].i == 500 + h);
    }
  }
  PRUEF_ENDE();
}
