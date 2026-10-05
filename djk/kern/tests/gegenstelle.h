// UDP-Gegenstelle für Netz-Tests: bindet einen freien Port auf 127.0.0.1 und wartet auf eine Adresse (Plan MVP 2).
#pragma once

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>

#include "cypherdj/osc.h"

struct Gegenstelle {
  int sock;
  int port;
  char buf[2048];
  cdj::osc::Nachricht m;
  Gegenstelle() {
    sock = socket(AF_INET, SOCK_DGRAM, 0);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    bind(sock, (sockaddr*)&a, sizeof a);
    socklen_t l = sizeof a;
    getsockname(sock, (sockaddr*)&a, &l);
    port = ntohs(a.sin_port);
  }
  ~Gegenstelle() { close(sock); }
  bool warte(const char* adresse, int ms) {
    for (int t = 0; t < ms; ++t) {
      pollfd pf{sock, POLLIN, 0};
      if (poll(&pf, 1, 1) > 0) {
        ssize_t r = recv(sock, buf, sizeof buf, 0);
        if (r > 0 && cdj::osc::lesen(buf, (size_t)r, m) && !std::strcmp(m.adresse, adresse)) return true;
      }
    }
    return false;
  }
  const char* s(int i) const { return (i < m.anzahl && m.werte[i].typ == 's') ? m.werte[i].s : "<fehlt>"; }
};
