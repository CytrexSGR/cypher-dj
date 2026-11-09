// 1.15 A5c: the kern reports its channel limiter state on the first /k/hallo of a generation (/e/kanal_limiter ,ii = gebaut, latenz_samples).
//  (H1) built (vorhalt 0.5 ms): the first hallo gets "1, 26"; with true peak "1, 38" (L = round(vorhalt_ms * 48) + 2, + 12)
//  (H2) not built: the first hallo gets "0, 0" (the server tells "not built" from "kern never said")
//  (H3) a heartbeat hallo of the same subscriber in the same generation gets it NOT again; after /e/neustart (a new generation) it gets it again
#include <atomic>
#include <cstring>
#include <memory>
#include <thread>

#include "cypherdj/core.h"
#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;

static void fall(const char* name, double vorhalt_ms, bool echtspitze, int soll_gebaut, int soll_latenz) {
  std::printf("-- %s\n", name);
  // the real numbers come from the Mixer, exactly as main.cpp hands them over (setze_kanal_limiter, then kanal_latenz)
  std::unique_ptr<unsigned char[]> mem{new unsigned char[CDJ_RING_BYTES]()};
  auto* ring = reinterpret_cast<cdj_ring_kopf*>(mem.get());
  ring->version = CDJ_RING_VERSION; ring->rate = CDJ_RING_RATE; ring->kanaele = CDJ_RING_KANAELE; ring->cap = CDJ_RING_CAP;
  std::memcpy(ring->magic, "CDJB", 4);
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Kern kern(128.0, ring, bef.get(), ere.get());
  kern.setze_kanal_limiter(vorhalt_ms, echtspitze);
  const int gebaut = kern.mixer().kanal_limiter_gebaut() ? 1 : 0, latenz = kern.mixer().kanal_latenz();
  PRUEF(gebaut == soll_gebaut && latenz == soll_latenz);

  auto bef2 = std::make_unique<cdj::Befehlsring>();
  auto ere2 = std::make_unique<cdj::Ereignisring>();
  std::atomic<bool> stop{false};
  cdj::Netz netz(0, true, bef2.get(), ere2.get());
  netz.setze_kanal_limiter(gebaut != 0, latenz);   // main.cpp: right after Kern::setze_kanal_limiter, before the net thread serves hallos
  std::thread faden([&] { netz.laufen(stop); });
  Gegenstelle g(netz.port());
  auto hallo = [&] { cdj::osc::Schreiber s(v::k_hallo); s.s("seite").i(g.port).i(1); g.sende(s); };

  hallo();   // (H1/H2) first hallo
  PRUEF(g.warte("/k/willkommen", 500));
  const bool da = g.warte("/e/kanal_limiter", 500);
  PRUEF(da && !std::strcmp(g.m.typen, "ii") && g.i(0) == soll_gebaut && g.i(1) == soll_latenz);

  hallo();   // (H3) heartbeat, same generation
  PRUEF(g.warte("/k/willkommen", 500));
  PRUEF(!g.warte("/e/kanal_limiter", 150));

  cdj::Ereignis nst{};   // a new generation
  nst.art = cdj::Ereignis::NEUSTART; nst.generation = 1; nst.sample = 1000;
  ere2->schiebe(nst);
  PRUEF(g.warte("/e/neustart", 500));
  hallo();
  PRUEF(g.warte("/k/willkommen", 500));
  PRUEF(g.warte("/e/kanal_limiter", 500) && g.i(0) == soll_gebaut && g.i(1) == soll_latenz);
  hallo();   // heartbeat in the new generation: not again
  PRUEF(g.warte("/k/willkommen", 500));
  PRUEF(!g.warte("/e/kanal_limiter", 150));

  stop = true;
  faden.join();
}

int main() {
  fall("H1 built, sample peaks", 0.5, false, 1, 26);
  fall("H1 built, true peak", 0.5, true, 1, 38);
  fall("H2 not built", 0.0, false, 0, 0);
  PRUEF_ENDE();
}
