// Paket 1 „Nie still" Slice 3 (Audit 2026-10-01, F17): ein /k/hallo mit dem Port des Kerns machte den Kern zu seinem
// eigenen Abonnenten. Er schickte sich /uhr, beantwortete jede vom_kern-Adresse mit /e/protokollfehler an alle (wieder
// an sich), und die unbegrenzte recv-Schleife kam nie mehr zu ereignisse_senden(): Abonnent B bekam 0 statt ~200 /uhr
// je s (Probe ~/messungen/2026-10-01-audio-audit/probe-netz/). Hier: Selbst-Abo und Ports außerhalb 1..65535 werden
// abgewiesen, B bekommt seine /uhr. Negativ-Kontrolle: B selbst wird willkommen geheißen.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#include <atomic>
#include <cstdio>
#include <cstring>
#include <memory>
#include <thread>

#include "cypherdj/netz.h"
#include "cypherdj/osc.h"
#include "pruef.h"

static int64_t ms() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

static void sende(int s, int port, const cdj::osc::Schreiber& w) {
  sockaddr_in a{};
  a.sin_family = AF_INET;
  a.sin_port = htons((uint16_t)port);
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  sendto(s, w.daten(), w.groesse(), 0, (sockaddr*)&a, sizeof a);
}

int main() {
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Netz netz(0, false, bef.get(), ere.get());
  PRUEF(netz.offen());
  const int kp = netz.port();
  int b = socket(AF_INET, SOCK_DGRAM, 0);
  sockaddr_in a{};
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  bind(b, (sockaddr*)&a, sizeof a);
  socklen_t l = sizeof a;
  getsockname(b, (sockaddr*)&a, &l);
  const int bp = ntohs(a.sin_port);
  struct timeval tv{0, 1000};
  setsockopt(b, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);

  cdj::osc::Schreiber hb("/k/hallo", "sii");
  hb.s("b").i(bp).i(1);
  sende(b, kp, hb);
  std::atomic<bool> stop{false};
  std::thread t([&] { netz.laufen(stop); });
  usleep(20000);
  cdj::osc::Schreiber hs("/k/hallo", "sii");  // Fehlerfall: der Kern-Port als Abonnent
  hs.s("selbst").i(kp).i(1);
  sende(b, kp, hs);
  cdj::osc::Schreiber hw("/k/hallo", "sii");  // Port außerhalb 1..65535 (htons bräche 70000 auf 4464 um)
  hw.s("weit").i(70000).i(1);
  sende(b, kp, hw);

  long n_uhr = 0, n_pf = 0, n_willkommen = 0;
  char buf[2048];
  const int64_t t0 = ms();
  int64_t naechste = t0;
  while (ms() - t0 < 1000) {
    if (ms() >= naechste) {  // wie der Callback: alle 5 ms ein UHR-Ereignis
      cdj::Ereignis e{};
      e.art = cdj::Ereignis::UHR;
      e.bpm = 128.0;
      ere->schiebe(e);
      naechste += 5;
    }
    ssize_t r = recv(b, buf, sizeof buf, 0);
    if (r > 0) {
      if (!std::strncmp(buf, "/uhr", 5)) ++n_uhr;
      else if (!std::strncmp(buf, "/e/protokollfehler", 19)) ++n_pf;
      else if (!std::strncmp(buf, "/k/willkommen", 14)) ++n_willkommen;
    }
  }
  stop = true;
  t.join();
  std::printf("bei B: /uhr %ld, /e/protokollfehler %ld, /k/willkommen %ld\n", n_uhr, n_pf, n_willkommen);
  PRUEF(n_willkommen >= 1);          // Negativ-Kontrolle: ein gültiger Abonnent wird angenommen
  PRUEF(n_uhr >= 100);               // Soll ~200; im Fehlerfall 0
  PRUEF(n_pf >= 2 && n_pf <= 10);    // genau die zwei Abweisungen gemeldet, keine Flut (Fehlerfall: ~333 000 je s)
  close(b);
  PRUEF_ENDE();
}
