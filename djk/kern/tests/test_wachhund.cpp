// Scheibe 18: WATCHDOG=1 nur bei Echtzeit-Fortschritt (ADR 016 Entscheidung 2). Ein echter Unix-Datagramm-Socket
// steht für systemd (NOTIFY_SOCKET, auch im abstrakten Namensraum). Fehlerfall: der Callback steht (gleiche
// Zyklenzahl) -> keine Meldung, damit systemd nach WatchdogSec tötet. Negativ-Kontrolle: ohne WATCHDOG_USEC nichts.
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <cstdlib>
#include <cstring>
#include <string>

#include "cypherdj/wachhund.h"
#include "pruef.h"

static int empfaenger(const std::string& adresse, bool abstrakt) {
  const int fd = socket(AF_UNIX, SOCK_DGRAM, 0);
  sockaddr_un a{};
  a.sun_family = AF_UNIX;
  std::memcpy(a.sun_path, adresse.c_str(), adresse.size());
  if (abstrakt) a.sun_path[0] = 0;
  bind(fd, (sockaddr*)&a, (socklen_t)(offsetof(sockaddr_un, sun_path) + adresse.size()));
  return fd;
}

static std::string hole(int fd) {
  pollfd p{fd, POLLIN, 0};
  if (poll(&p, 1, 20) <= 0) return "";
  char b[64] = {0};
  const ssize_t r = recv(fd, b, sizeof b - 1, 0);
  return r > 0 ? std::string(b, (size_t)r) : "";
}

int main() {
  const char* tmp = getenv("TMPDIR");
  const std::string pfad = std::string(tmp && *tmp ? tmp : "/tmp") + "/test-wachhund-" + std::to_string(getpid());
  unlink(pfad.c_str());
  const int fd = empfaenger(pfad, false);
  setenv("NOTIFY_SOCKET", pfad.c_str(), 1);

  PRUEF(cdj::sd_melde("READY=1"));
  PRUEF(hole(fd) == "READY=1");

  cdj::Wachhund w(200000);  // WatchdogSec=200ms
  PRUEF(w.takt_us() == 50000);
  PRUEF(!w.pruefe(10));      // erster Blick: kein Vergleich möglich
  PRUEF(hole(fd).empty());
  PRUEF(w.pruefe(47));       // Fortschritt -> WATCHDOG=1
  PRUEF(hole(fd) == "WATCHDOG=1");
  PRUEF(!w.pruefe(47));      // Fehlerfall: Callback steht -> nichts
  PRUEF(!w.pruefe(47));
  PRUEF(hole(fd).empty());
  PRUEF(w.ohne_fortschritt() == 3);
  PRUEF(w.pruefe(48));       // läuft wieder
  PRUEF(hole(fd) == "WATCHDOG=1");
  PRUEF(w.gemeldet() == 2);

  // Negativ-Kontrolle: ohne Watchdog (WATCHDOG_USEC fehlt) meldet pruefe() nie
  unsetenv("WATCHDOG_USEC");
  cdj::Wachhund aus(cdj::Wachhund::aus_umgebung());
  PRUEF(aus.takt_us() == 100000);
  PRUEF(!aus.pruefe(1) && !aus.pruefe(2));
  PRUEF(hole(fd).empty());
  setenv("WATCHDOG_USEC", "200000", 1);
  PRUEF(cdj::Wachhund::aus_umgebung() == 200000);

  // abstrakter Namensraum ('@' wie bei systemd --user)
  const std::string abstrakt = "@cypherdj-test-wachhund-" + std::to_string(getpid());
  const int fd2 = empfaenger(abstrakt, true);
  setenv("NOTIFY_SOCKET", abstrakt.c_str(), 1);
  PRUEF(cdj::sd_melde("WATCHDOG=1"));
  PRUEF(hole(fd2) == "WATCHDOG=1");

  // ohne NOTIFY_SOCKET: false, kein Absturz
  unsetenv("NOTIFY_SOCKET");
  PRUEF(!cdj::sd_melde("READY=1"));
  close(fd);
  close(fd2);
  unlink(pfad.c_str());
  PRUEF_ENDE();
}
