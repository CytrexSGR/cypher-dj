// Naht-Prüfung von Scheibe 14: die drei öffentlichen Köpfe sind von aussen nutzbar.
#include <cstdio>

#include "cypherdj/dsp/analyse_baender.h"
#include "cypherdj/dsp/master_limiter.h"
#include "cypherdj/dsp/pegel_messer.h"

int main() {
  using namespace cypherdj::dsp;
  AnalyseBaender a(vertrag_baender());
  PegelMesser m;
  MasterLimiter lim;
  float l[256] = {}, r[256] = {};
  HuellenWerte h[8];
  const int n = a.verarbeite(l, r, 256, h, 8);
  m.verarbeite(l, r, 256, nullptr);
  lim.verarbeite(l, r, 256);
  std::printf("einbindung ok: datensaetze %d, messer %s, vorhalt %d\n", n, m.gueltig() ? "gueltig" : "UNGUELTIG",
              lim.vorhalt_samples());
  return (n == 5 && m.gueltig() && lim.vorhalt_samples() == 84) ? 0 : 1;
}
