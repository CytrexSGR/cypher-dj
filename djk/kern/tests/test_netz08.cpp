// Scheibe 08: Netz-Faden über echtes UDP auf Loopback. Rampe und Storno landen mit allen Feldern im Befehlsring,
// Bereichsfehler als /q 6 ausserhalb_bereich, Ring voll als /q 4 zu_spaet, Form über osc_adressen.h (falsche Typen,
// Ausgabe-Adresse, nicht gebaut), Quittungen mit Grund, /e/luecke, /e/quantum, /zustand/kern, Frist 5 s mit
// eingespeister Zeit und höchstens 8 Abonnenten (§4.1; den Herzschlag über echte Zeit prüft test_netz aus Scheibe 01).
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cmath>
#include <cstring>
#include <thread>

#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

static void hallo(Gegenstelle& g, const char* name, int port) {
  cdj::osc::Schreiber s(cypherdj::osc::k_hallo);
  s.s(name).i(port).i(1);
  g.sende(s);
}

int main() {
  namespace v = cypherdj::osc;
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  std::atomic<bool> stop{false};
  cdj::Netz netz(0, false, bef, ere);
  PRUEF(netz.offen());
  std::thread faden([&] { netz.laufen(stop); });
  Gegenstelle g(netz.port());
  hallo(g, "pruefstand", g.port);
  PRUEF(g.warte("/k/willkommen", 500));
  PRUEF(!std::strcmp(g.s(5), cdj::KERN_VERSION));
  cdj::Befehl b{};

  // 1) /k/tempo/rampe: alle Felder im Ring, keine Quittung vom Netz (angenommen kommt aus dem Callback)
  { cdj::osc::Schreiber s(v::k_tempo_rampe); s.h(21).s("pruefstand").d(128.0).d(132.0).d(32.0); g.sende(s); }
  PRUEF(!g.warte("/q", 100));
  int n = 0;
  while (bef->hole(b)) ++n;
  PRUEF(n == 1 && b.art == cdj::Befehl::TEMPO_RAMPE && b.id == 21 && b.ab_beat == 128.0 && b.ziel_bpm == 132.0 &&
        b.dauer_beats == 32.0 && !std::strcmp(b.quelle, "pruefstand"));
  // 2) Bereich §4.2: ziel_bpm 60 bis 200, dauer_beats >= 1, ab_beat endlich -> 6 ausserhalb_bereich, nichts im Ring
  const double faelle[3][3] = {{128.0, 250.0, 32.0}, {128.0, 132.0, 0.5}, {NAN, 132.0, 32.0}};
  for (int k = 0; k < 3; ++k) {
    cdj::osc::Schreiber s(v::k_tempo_rampe);
    s.h(22 + k).s("pruefstand").d(faelle[k][0]).d(faelle[k][1]).d(faelle[k][2]);
    g.sende(s);
    PRUEF(g.warte("/q", 500));
    PRUEF(g.h(0) == 22 + k && g.i(2) == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
  }
  PRUEF(!bef->hole(b));
  // Negativ-Kontrolle der Grenzen: 60, 200 und dauer 1,0 sind erlaubt
  { cdj::osc::Schreiber s(v::k_tempo_rampe); s.h(25).s("pruefstand").d(8.0).d(200.0).d(1.0); g.sende(s); }
  PRUEF(!g.warte("/q", 100));
  PRUEF(bef->hole(b) && b.id == 25);
  // 3) /k/storno: ziel_id im Ring
  { cdj::osc::Schreiber s(v::k_storno); s.h(26).s("pruefstand").h(21); g.sende(s); }
  PRUEF(!g.warte("/q", 100));
  PRUEF(bef->hole(b) && b.art == cdj::Befehl::STORNO && b.id == 26 && b.ziel_id == 21);
  // 3b) Befehlsring voll (der Callback liest nicht): nach 100 ms verworfen und gemeldet, 4 zu_spaet (B6 f)
  {
    cdj::Befehl f{};
    int rein = 0;
    while (bef->schiebe(f)) ++rein;
    PRUEF(rein == (int)cdj::Befehlsring::kapazitaet());
    { cdj::osc::Schreiber s(v::k_storno); s.h(31).s("pruefstand").h(21); g.sende(s); }
    PRUEF(g.warte("/q", 500));
    PRUEF(g.h(0) == 31 && g.i(2) == 4 && !std::strcmp(g.s(5), "zu_spaet"));
    int raus = 0;
    while (bef->hole(b)) ++raus;
    PRUEF(raus == rein);  // der verworfene Befehl steht nicht im Ring
  }
  // 4) Form gegen osc_adressen.h: falsche Typen, eine Ausgabe-Adresse, eine noch nicht gebaute Adresse
  { cdj::osc::Schreiber s("/k/tempo/rampe", "hsdd"); s.h(27).s("pruefstand").d(64.0).d(132.0); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500));
  PRUEF(!std::strcmp(g.s(0), "/k/tempo/rampe") && !std::strcmp(g.s(1), "falsche_typen"));
  { cdj::osc::Schreiber s("/k/storno", "hsi"); s.h(28).s("pruefstand").i(2); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500));
  PRUEF(!std::strcmp(g.s(0), "/k/storno") && !std::strcmp(g.s(1), "falsche_typen"));
  { cdj::osc::Schreiber s(v::uhr); s.h(0).h(0).d(0).d(0).d(0); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500));
  PRUEF(!std::strcmp(g.s(0), "/uhr") && !std::strcmp(g.s(1), "unbekannte_adresse"));
  // noch nicht gebaut (seit Scheibe 25 ist /k/ki/stopp gebaut; /k/led kommt mit Scheibe 35)
  { cdj::osc::Schreiber s(v::k_led); s.h(29).s("leitstand").s("vorschlag").i(1); g.sende(s); }
  PRUEF(g.warte("/e/protokollfehler", 500));
  PRUEF(!std::strcmp(g.s(0), "/k/led") && !std::strcmp(g.s(1), "unbekannte_adresse"));
  PRUEF(!bef->hole(b));
  // 5) Ereignisse aus dem Callback: Quittung mit Grund, /e/luecke, /e/quantum
  cdj::Ereignis e{};
  e.art = cdj::Ereignis::QUITTUNG; e.id = 30; e.status = 6; e.sample = 512; e.beat = 0.02;
  std::strcpy(e.quelle, "pruefstand");
  std::strcpy(e.grund, "karte_voll");
  ere->schiebe(e);
  PRUEF(g.warte("/q", 500));
  PRUEF(!std::strcmp(g.m.typen, "hsihds") && g.h(0) == 30 && g.i(2) == 6 && g.h(3) == 512 &&
        !std::strcmp(g.s(5), "karte_voll"));
  cdj::Ereignis l{};
  l.art = cdj::Ereignis::LUECKE; l.sample = 90000; l.frames = 256; l.zyklen = 1;
  ere->schiebe(l);
  PRUEF(g.warte("/e/luecke", 500));
  PRUEF(!std::strcmp(g.m.typen, "hii") && g.h(0) == 90000 && g.i(1) == 256 && g.i(2) == 1);
  cdj::Ereignis qu{};
  qu.art = cdj::Ereignis::QUANTUM; qu.alt = 256; qu.neu = 128; qu.sample = 1024;
  ere->schiebe(qu);
  PRUEF(g.warte("/e/quantum", 500));
  PRUEF(!std::strcmp(g.m.typen, "iih") && g.i(0) == 256 && g.i(1) == 128 && g.h(2) == 1024);
  // 6) /zustand/kern: 20-mal je Sekunde, Werte aus dem letzten Zyklus
  cdj::Ereignis zy{};
  zy.art = cdj::Ereignis::ZYKLUS; zy.sample = 4096; zy.nframes = 256; zy.frame_luecken = 2; zy.ausgelassen = 3;
  zy.wartend = 1; zy.dauer_us = 7; zy.aufwach_us = 11;
  timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  zy.mono_ns = (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
  ere->schiebe(zy);
  PRUEF(g.warte("/zustand/kern", 500));
  PRUEF(g.warte("/zustand/kern", 500));  // die zweite Meldung trägt sicher den Zyklus
  PRUEF(!std::strcmp(g.m.typen, "iihiiiiiiii") && g.i(1) == 256 && g.h(2) == 4096 && g.i(3) == 2 && g.i(4) == 3 &&
        g.i(5) == 7 && g.i(6) == 7 && g.i(7) == 11 && g.i(9) == 1);
  int zustaende = 0;
  for (int t = 0; t < 1000; t += 50) zustaende += g.warte("/zustand/kern", 50) ? 1 : 0;
  PRUEF(zustaende >= 15 && zustaende <= 21);  // rund 20 je Sekunde
  stop = true;
  faden.join();

  // 7) Herzschlag und Obergrenze, ohne Faden mit eingespeister Zeit (§4.1)
  cdj::Netz n2(0, false, bef, ere);
  Gegenstelle g2(n2.port());
  auto hallo_direkt = [&](const char* name, int port, int64_t t) {
    cdj::osc::Schreiber s(v::k_hallo);
    s.s(name).i(port).i(1);
    n2.paket(s.daten(), s.groesse(), t);
  };
  const int64_t S = 1000000000LL;
  hallo_direkt("a", g2.port, 0);
  PRUEF(g2.warte("/k/willkommen", 200));
  hallo_direkt("a", g2.port, 4 * S);  // Herzschlag: frischt auf (Willkommen wie auf jedes /k/hallo)
  PRUEF(g2.warte("/k/willkommen", 200));
  n2.abonnenten_pruefen(8 * S);
  PRUEF(n2.abonnenten() == 1);        // letzte Meldung vor 4 s
  n2.abonnenten_pruefen(9 * S + 1);
  PRUEF(n2.abonnenten() == 0);        // mehr als 5 s still: gestrichen
  const char* namen[9] = {"n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"};
  for (int k = 0; k < 8; ++k) hallo_direkt(namen[k], 1, 10 * S);  // Port 1: niemand hört, zählt trotzdem
  PRUEF(n2.abonnenten() == 8);
  hallo_direkt(namen[8], g2.port, 10 * S);
  PRUEF(!g2.warte("/k/willkommen", 100));  // der neunte bekommt keinen Platz
  PRUEF(n2.abonnenten() == 8);
  n2.abonnenten_pruefen(16 * S);
  hallo_direkt(namen[8], g2.port, 16 * S);
  PRUEF(g2.warte("/k/willkommen", 200));   // nach dem Streichen ist Platz
  PRUEF(n2.abonnenten() == 1);
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
