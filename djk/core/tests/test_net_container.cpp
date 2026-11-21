// Container core K8 (INTERFACES §4.10 /k/container/quelle, §5.12 /e/container/quelle) in the net thread over real UDP on loopback.
// Cases: 1 /k/container/quelle with all fields lands in the command ring (nr = container, an = art); 2 container 5, container 0, art 3 and art -1 are
// answered with receipt 6 ausserhalb_bereich and leave the ring empty; an unknown source likewise; 3 under the AI stop quelle cypher gets 6 ki_gestoppt
// (before the range check) and the ring stays empty, quelle andreas goes through; 4 the core's event CONTAINER_QUELLE goes out as /e/container/quelle ,ii
// to every subscriber and a new subscriber learns the changed state on its first /k/hallo, the other three containers still as player (art 1).
// (The four events after /e/neustart are in test_net_restart.cpp.)
#include <atomic>
#include <cstring>
#include <string>
#include <thread>

#include "cypherdj/core.h"
#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;

static bool hole(cdj::Befehlsring* rb, cdj::Befehl& b) {
  for (int t = 0; t < 500; ++t) {
    if (rb->hole(b)) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return false;
}

int main() {
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  std::atomic<bool> stop{false};
  cdj::Netz netz(0, true, bef, ere);
  std::thread faden([&] { netz.laufen(stop); });
  Gegenstelle g(netz.port());
  { cdj::osc::Schreiber s(v::k_hallo); s.s("pruefstand").i(g.port).i(1); g.sende(s); }
  PRUEF(g.warte("/k/willkommen", 500));
  cdj::Befehl b{};
  auto abgelehnt = [&](int64_t id, const char* grund) {
    const bool q = g.warte("/q", 500);
    PRUEF(q && g.h(0) == id && g.i(2) == 6 && !std::strcmp(g.s(5), grund));
    PRUEF(!bef->hole(b));
  };

  // 1) all fields in the ring
  { cdj::osc::Schreiber s(v::k_container_quelle); s.h(1).s("leitstand").i(3).i(2); g.sende(s); }
  PRUEF(hole(bef, b) && b.art == cdj::Befehl::CONTAINER_QUELLE && b.id == 1 && b.nr == 3 && b.an == 2 && !std::strcmp(b.quelle, "leitstand"));
  { cdj::osc::Schreiber s(v::k_container_quelle); s.h(2).s("andreas").i(1).i(0); g.sende(s); }
  PRUEF(hole(bef, b) && b.nr == 1 && b.an == 0);

  // 2) out of range
  const int werte[4][2] = {{5, 1}, {0, 1}, {1, 3}, {2, -1}};
  for (int i = 0; i < 4; ++i) {
    { cdj::osc::Schreiber s(v::k_container_quelle); s.h(10 + i).s("andreas").i(werte[i][0]).i(werte[i][1]); g.sende(s); }
    abgelehnt(10 + i, "ausserhalb_bereich");
  }
  { cdj::osc::Schreiber s(v::k_container_quelle); s.h(20).s("dj").i(1).i(1); g.sende(s); }
  abgelehnt(20, "ausserhalb_bereich");   // §1.4: unknown source

  // 3) the AI stop
  {
    cdj::Ereignis k{};
    k.art = cdj::Ereignis::KI;
    k.status = 1;
    std::strcpy(k.grund, "stopp");
    ere->schiebe(k);
    PRUEF(g.warte("/e/ki", 500));
    { cdj::osc::Schreiber s(v::k_container_quelle); s.h(30).s("cypher").i(2).i(0); g.sende(s); }
    abgelehnt(30, "ki_gestoppt");
    { cdj::osc::Schreiber s(v::k_container_quelle); s.h(31).s("cypher").i(9).i(7); g.sende(s); }
    abgelehnt(31, "ki_gestoppt");   // the stop is named before the range
    { cdj::osc::Schreiber s(v::k_container_quelle); s.h(32).s("andreas").i(2).i(0); g.sende(s); }
    PRUEF(hole(bef, b) && b.id == 32 && b.nr == 2 && b.an == 0);
  }

  // 4) the event goes out to everybody and a new subscriber learns the state
  {
    cdj::Ereignis e{};
    e.art = cdj::Ereignis::CONTAINER_QUELLE;
    e.deck = 3;
    e.status = 2;
    ere->schiebe(e);
    PRUEF(g.warte("/e/container/quelle", 500) && !std::strcmp(g.m.typen, "ii") && g.i(0) == 3 && g.i(1) == 2);
    Gegenstelle n(netz.port());
    { cdj::osc::Schreiber s(v::k_hallo); s.s("seite-neu").i(n.port).i(1); n.sende(s); }
    PRUEF(n.warte("/k/willkommen", 500));
    int art[4] = {0, 0, 0, 0};
    for (int i = 0; i < 4; ++i) {
      if (!n.warte("/e/container/quelle", 300)) break;
      const int c = n.i(0);
      if (c >= 1 && c <= 4) art[c - 1] = n.i(1);
    }
    PRUEF(art[0] == 1 && art[1] == 1 && art[2] == 2 && art[3] == 1);
    { cdj::osc::Schreiber s(v::k_hallo); s.s("seite-neu").i(n.port).i(1); n.sende(s); }
    PRUEF(n.warte("/k/willkommen", 500) && !n.warte("/e/container/quelle", 100));   // a heartbeat does not repeat it
    { cdj::osc::Schreiber s(v::k_tschuess); s.s("seite-neu"); n.sende(s); }
  }
  stop = true;
  faden.join();
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
