// UDP-Gegenstelle für Netz-Tests: bindet einen freien Port auf 127.0.0.1 und wartet auf eine Adresse (Plan MVP 2).
//
// Lastfest (Befund 2026-10-08, ~/messungen/2026-10-08-rec-zeit): Das Netz schickt je Zyklus mehrere Pakete (/uhr, /pegel ...).
// Wer je Aufruf nur eines liest, lässt den Empfangspuffer unter CPU-Last volllaufen (rx_queue ~0,8 MB, ~26000 Drops), und
// ein spätes Paket wie /e/mitschnitt geht verloren. Darum zweierlei:
//   1. SO_RCVBUF so groß, wie der Kern erlaubt (net.core.rmem_max): mehrere tausend Pakete passen hinein.
//   2. warte() holt bei jedem Aufruf ALLES Anstehende aus dem Socket in einen eigenen Vorrat und sucht darin der Reihe
//      nach. Semantik wie zuvor: Pakete vor dem Treffer sind verbraucht, Pakete nach dem Treffer bleiben für das nächste
//      warte() stehen. Ein Aufruf, der nichts findet, verbraucht alles Anstehende (wie die alte Schleife bis zur Frist).
#pragma once

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstdint>
#include <cstring>
#include <deque>
#include <string>

#include "cypherdj/osc.h"

struct Gegenstelle {
  int sock;
  int port;
  int kern_port;  // nur für sende(): der Port des Kerns, 0 wenn die Gegenstelle nur hört
  char buf[2048];
  cdj::osc::Nachricht m;
  explicit Gegenstelle(int kp = 0) : kern_port(kp) {
    sock = socket(AF_INET, SOCK_DGRAM, 0);
    int gross = 64 * 1024 * 1024;  // der Kern kappt auf rmem_max
    setsockopt(sock, SOL_SOCKET, SO_RCVBUF, &gross, sizeof gross);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    bind(sock, (sockaddr*)&a, sizeof a);
    socklen_t l = sizeof a;
    getsockname(sock, (sockaddr*)&a, &l);
    port = ntohs(a.sin_port);
  }
  ~Gegenstelle() { close(sock); }
  Gegenstelle(const Gegenstelle&) = delete;
  Gegenstelle& operator=(const Gegenstelle&) = delete;

  void sende(const cdj::osc::Schreiber& s) {
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons((uint16_t)kern_port);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    sendto(sock, s.daten(), s.groesse(), 0, (sockaddr*)&a, sizeof a);
  }

  // Holt alles, was jetzt im Socket steht, in den Vorrat. Gibt die Zahl der geholten Pakete zurück.
  size_t sammeln() {
    size_t n = 0;
    char tmp[2048];
    for (;;) {
      const ssize_t r = recv(sock, tmp, sizeof tmp, MSG_DONTWAIT);
      if (r <= 0) break;
      vorrat_.emplace_back(tmp, (size_t)r);
      if (vorrat_.size() > K_VORRAT_MAX) vorrat_.pop_front();  // Deckel gegen Speicherflut, ältestes zuerst
      ++n;
    }
    return n;
  }
  // Pakete, die gesammelt, aber noch nicht von warte() verbraucht sind.
  size_t vorrat() const { return vorrat_.size(); }

  // Wartet bis zu ms auf eine Nachricht mit dieser Adresse (andere werden übersprungen); sonst ist m leer.
  // Die Frist zählt wie zuvor in Runden von höchstens 1 ms Wartezeit (ein Aufruf mit 50 dauert also rund 50 bis 55 ms);
  // test_netz08 zählt damit 20 Meldungen je Sekunde. Anders als zuvor verbraucht ein fremdes Paket keine Runde.
  bool warte(const char* adresse, int ms) {
    for (int t = 0; t < ms; ++t) {
      sammeln();
      if (nimm(adresse)) return true;
      pollfd pf{sock, POLLIN, 0};
      poll(&pf, 1, 1);
    }
    sammeln();  // zuletzt Eingetroffenes noch mitnehmen
    if (nimm(adresse)) return true;
    m.anzahl = 0;
    m.typen = "";
    return false;
  }

  // Werte der letzten Nachricht; außerhalb der Nachricht ein Wert, der keine Prüfung besteht
  const char* s(int i) const { return (i < m.anzahl && m.werte[i].typ == 's') ? m.werte[i].s : "<fehlt>"; }
  int32_t i(int k) const { return (k < m.anzahl && m.werte[k].typ == 'i') ? m.werte[k].i : -999; }
  int64_t h(int k) const { return (k < m.anzahl && m.werte[k].typ == 'h') ? m.werte[k].h : -999; }
  float f(int k) const { return (k < m.anzahl && m.werte[k].typ == 'f') ? m.werte[k].f : -999.0f; }
  double d(int k) const { return (k < m.anzahl && m.werte[k].typ == 'd') ? m.werte[k].d : -999.0; }

 private:
  static constexpr size_t K_VORRAT_MAX = 200000;
  std::deque<std::string> vorrat_;
  // Verbraucht Pakete von vorn bis zum ersten mit dieser Adresse; das Treffer-Paket landet in buf/m.
  bool nimm(const char* adresse) {
    while (!vorrat_.empty()) {
      const std::string p = std::move(vorrat_.front());
      vorrat_.pop_front();
      std::memcpy(buf, p.data(), p.size());
      if (cdj::osc::lesen(buf, p.size(), m) && !std::strcmp(m.adresse, adresse)) return true;
    }
    return false;
  }
};
