// audit U36: /k/hallo with a subscriber name of 48 bytes or more. The core stored the name cut to 47 characters but looked a known
// subscriber up with the full name, so a long-named client never matched its own entry: every heartbeat took a new slot, sent
// /k/willkommen and the full state dump again, and the 8 slots filled with copies of one client. OSC strings are at most 47 bytes
// (INTERFACES 1.4): a longer name is refused with /e/protokollfehler ausserhalb_bereich (to all subscribers), takes no slot
// and gets no /k/willkommen. A name of exactly 47 bytes is a valid name and is welcomed (negative control).
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#include <atomic>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <thread>

#include "cypherdj/net.h"
#include "cypherdj/osc.h"
#include "check.h"

static int64_t ms() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

namespace {
struct Gegenstelle {
  int s = -1, port = 0;
  Gegenstelle() {
    s = socket(AF_INET, SOCK_DGRAM, 0);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    bind(s, (sockaddr*)&a, sizeof a);
    socklen_t l = sizeof a;
    getsockname(s, (sockaddr*)&a, &l);
    port = ntohs(a.sin_port);
    struct timeval tv{0, 1000};
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  }
  ~Gegenstelle() { close(s); }
  void hallo(int kern_port, const std::string& name) const {
    cdj::osc::Schreiber w("/k/hallo", "sii");
    w.s(name.c_str()).i(port).i(1);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons((uint16_t)kern_port);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    sendto(s, w.daten(), w.groesse(), 0, (sockaddr*)&a, sizeof a);
  }
  // reads for ms_max, counts /k/willkommen and /e/protokollfehler
  void lesen(int ms_max, long& willkommen, long& fehler) const {
    char buf[2048];
    const int64_t t0 = ms();
    while (ms() - t0 < ms_max) {
      const ssize_t r = recv(s, buf, sizeof buf, 0);
      if (r <= 0) continue;
      if (!std::strncmp(buf, "/k/willkommen", 14)) ++willkommen;
      else if (!std::strncmp(buf, "/e/protokollfehler", 19)) ++fehler;
    }
  }
};
}  // namespace

int main() {
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Netz netz(0, false, bef.get(), ere.get());
  PRUEF(netz.offen());
  const int kp = netz.port();
  std::atomic<bool> stop{false};
  std::thread t([&] { netz.laufen(stop); });
  Gegenstelle b, lang, grenze;
  b.hallo(kp, "b");
  long bw = 0, bf = 0;
  b.lesen(150, bw, bf);
  PRUEF(bw == 1);   // the observer is subscribed
  const std::string name50(50, 'x'), name47(47, 'y');
  for (int i = 0; i < 3; ++i) lang.hallo(kp, name50);   // three heartbeats of a 50-byte name
  grenze.hallo(kp, name47);
  long lw = 0, lf = 0, gw = 0, gf = 0;
  const int64_t t0 = ms();
  while (ms() - t0 < 300) {   // all three read in turns, each socket has a 1 ms timeout
    b.lesen(5, bw, bf);
    lang.lesen(5, lw, lf);
    grenze.lesen(5, gw, gf);
  }
  stop = true;
  t.join();
  std::printf("long name: /k/willkommen %ld (want 0), observer /e/protokollfehler %ld (want 3); 47-byte name: /k/willkommen %ld (want 1)\n", lw, bf, gw);
  PRUEF(lw == 0);    // no slot, no welcome, no state dump (unfixed: 3)
  PRUEF(bf == 3);    // each refusal is reported to the subscribers
  PRUEF(gw >= 1);    // negative control: exactly 47 bytes is a valid name
  PRUEF_ENDE();
}
