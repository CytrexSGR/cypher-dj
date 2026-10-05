// Scheibe 18: Abonnenten über einen Neustart (SCHNITTSTELLEN §4.1, §5.1, §5.9, §6.3), Netz-Faden über echtes UDP auf
// Loopback, Zeit eingespeist. Ein Kern der Generation 0 schreibt seine Abonnenten ins Abonnenten-Fach; ein neuer Kern
// übernimmt sie, schickt /e/neustart als erste Nachricht an den gespeicherten Abonnenten, und wer sich in der neuen
// Generation zum ersten Mal meldet, bekommt /k/willkommen, /e/neustart und je offenem Befehl /q/stand. Negativ-
// Kontrollen: Herzschlag in derselben Generation (nur /k/willkommen), Generation 0 (kein /e/neustart). Fehlerfall: ein
// Netz ohne Zustand (wie Scheibe 08) erreicht nach dem Neustart niemanden.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "cypherdj/netz.h"
#include "pruef.h"

namespace v = cypherdj::osc;

struct Meldung {
  std::string adresse;
  int32_t i[4];
  int64_t h[4];
  std::string s[2];
};

struct Gegenstelle {
  int sock;
  int port;
  explicit Gegenstelle() {
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
  // alle Nachrichten, die binnen ms eintreffen, in Reihenfolge
  std::vector<Meldung> alle(int ms = 30) {
    std::vector<Meldung> aus;
    char buf[2048];
    for (int t = 0; t < ms; ++t) {
      pollfd pf{sock, POLLIN, 0};
      while (poll(&pf, 1, 1) > 0) {
        const ssize_t r = recv(sock, buf, sizeof buf, 0);
        cdj::osc::Nachricht m;
        if (r <= 0 || !cdj::osc::lesen(buf, (size_t)r, m)) continue;
        Meldung x{m.adresse, {0, 0, 0, 0}, {0, 0, 0, 0}, {"", ""}};
        int ni = 0, nh = 0, ns = 0;
        for (int k = 0; k < m.anzahl; ++k) {
          if (m.werte[k].typ == 'i' && ni < 4) x.i[ni++] = m.werte[k].i;
          if (m.werte[k].typ == 'h' && nh < 4) x.h[nh++] = m.werte[k].h;
          if (m.werte[k].typ == 's' && ns < 2) x.s[ns++] = m.werte[k].s;
        }
        aus.push_back(x);
      }
    }
    return aus;
  }
};

static void hallo(cdj::Netz& n, const char* name, int port, int64_t t) {
  cdj::osc::Schreiber s(v::k_hallo);
  s.s(name).i(port).i(1);
  n.paket(s.daten(), s.groesse(), t);
}

static void tschuess(cdj::Netz& n, const char* name, int64_t t) {
  cdj::osc::Schreiber s(v::k_tschuess);
  s.s(name);
  n.paket(s.daten(), s.groesse(), t);
}

static void ereignis(cdj::Ereignisring& r, int art, int32_t generation, int64_t sample) {
  cdj::Ereignis e{};
  e.art = art;
  e.generation = generation;
  e.sample = sample;
  e.beat = (double)sample * 128.0 / (60.0 * 48000.0);
  e.bpm = 128.0;
  r.schiebe(e);
}

int main() {
  const std::string ordner = "/dev/shm/cypherdj-test18n-" + std::to_string(getpid());
  const std::string pfad = ordner + "/zustand";
  unlink(pfad.c_str());
  cdj::ZustandDatei z;
  PRUEF(z.oeffne(pfad) && z.neu());
  Gegenstelle x, y, neu, w;

  // 1) Generation 0: x und y melden sich an, y geht wieder; das Abonnenten-Fach hält x mit letzter Meldung
  {
    auto bef = std::make_unique<cdj::Befehlsring>();
    auto ere = std::make_unique<cdj::Ereignisring>();
    cdj::Netz a(0, false, bef.get(), ere.get());
    PRUEF(a.offen());
    a.verbinde_zustand(z.daten(), 0);
    ereignis(*ere, cdj::Ereignis::UHR, 0, 256);
    a.ereignisse_senden();
    hallo(a, "leitstand", x.port, 1'000'000'000);
    hallo(a, "pruefstand", y.port, 1'100'000'000);
    hallo(a, "wirt", w.port, 1'200'000'000);
    auto mx = x.alle();
    PRUEF(mx.size() == 1 && mx[0].adresse == "/k/willkommen" && mx[0].i[1] == 0);  // Negativ: Generation 0, kein neustart
    tschuess(a, "pruefstand", 1'300'000'000);
    y.alle();
    w.alle();
    cdj_z_abos f{};
    PRUEF(cdj::z_neuestes(z.daten()->abos, f) >= 0);
    PRUEF(f.n == 2 && std::string(f.a[0].name) == "leitstand" && f.a[0].port == x.port);
    PRUEF(f.a[0].letzte_ns == 1'000'000'000 && f.a[0].protokoll == 1);
    PRUEF(std::string(f.a[1].name) == "wirt");
  }  // "kill -9"

  // 2) Das Echtzeit-Fach des toten Kerns: eine laufende Rampe (7), ein wartender Klick (8), ein fertiger Eintrag (9)
  {
    cdj::FachSchreiber<cdj_z_echtzeit> s;
    s.verbinde(z.daten()->echtzeit, 0);
    cdj_z_echtzeit* e = s.beginne();
    e->n_befehle = 3;
    const int64_t ids[3] = {7, 8, 9};
    const uint8_t staende[3] = {2, 1, 3};
    for (int i = 0; i < 3; ++i) {
      cdj_z_befehl& b = e->befehle[i];
      b.id = ids[i];
      std::snprintf(b.quelle, sizeof b.quelle, "leitstand");
      b.stand = staende[i];
      b.ist_sample = 1'440'000 + i;
      b.ist_beat = 64.0 + i;
    }
    s.beende();
  }

  // 3) Neuer Kern (Generation 1): übernimmt die Abonnenten, /e/neustart geht als erste Nachricht an sie
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Netz b(0, false, bef.get(), ere.get());
  cdj_z_abos f{};
  PRUEF(cdj::z_neuestes(z.daten()->abos, f) >= 0);
  b.verbinde_zustand(z.daten(), f.stand);
  const int64_t t_neu = 10'000'000'000LL;
  b.setze_abonnenten(f.a, f.n, t_neu);
  PRUEF(b.abonnenten() == 2);
  ereignis(*ere, cdj::Ereignis::NEUSTART, 1, 1'665'536);
  ereignis(*ere, cdj::Ereignis::UHR, 1, 1'665'536);
  b.ereignisse_senden();
  auto mx = x.alle();
  PRUEF(mx.size() == 3);
  PRUEF(!mx.empty() && mx[0].adresse == "/e/neustart" && mx[0].i[0] == 1 && mx[0].h[0] == 1'665'536);
  PRUEF(mx.size() > 1 && mx[1].adresse == "/e/fx/routing" && mx[1].i[0] == 0);  // Ohr T17 (§5.12): gleich danach die Vorgabe 0
  PRUEF(mx.size() > 2 && mx[2].adresse == "/uhr");
  PRUEF(w.alle().size() == 3);
  PRUEF(b.generation() == 1);

  // 4) x meldet sich (sein Herzschlag): /k/willkommen, /e/neustart, /q/stand für 7 (läuft) und 8 (wartet), nicht 9
  hallo(b, "leitstand", x.port, t_neu + 800'000'000);
  mx = x.alle();
  PRUEF(mx.size() == 5);
  if (mx.size() == 5) {
    PRUEF(mx[0].adresse == "/k/willkommen" && mx[0].i[1] == 1);
    PRUEF(mx[1].adresse == "/e/neustart" && mx[1].i[0] == 1 && mx[1].h[0] == 1'665'536);
    PRUEF(mx[2].adresse == "/e/fx/routing" && mx[2].i[0] == 0);  // Ohr T17
    PRUEF(mx[3].adresse == "/q/stand" && mx[3].h[0] == 7 && mx[3].i[0] == 2 && mx[3].h[1] == 1'440'000);
    PRUEF(mx[3].s[0] == "leitstand" && mx[3].s[1].empty());
    PRUEF(mx[4].adresse == "/q/stand" && mx[4].h[0] == 8 && mx[4].i[0] == 1);
  }

  // 5) Negativ-Kontrolle: der nächste Herzschlag in derselben Generation bekommt nur /k/willkommen
  hallo(b, "leitstand", x.port, t_neu + 2'800'000'000LL);
  mx = x.alle();
  PRUEF(mx.size() == 1 && mx[0].adresse == "/k/willkommen");

  // 6) Ein neuer Abonnent in Generation 1 bekommt dasselbe wie x beim ersten Mal
  hallo(b, "analyse", neu.port, t_neu + 900'000'000);
  auto mn = neu.alle();
  PRUEF(mn.size() == 5 && mn[1].adresse == "/e/neustart" && mn[2].adresse == "/e/fx/routing" && mn[4].adresse == "/q/stand");

  // 7) Die 5-s-Frist der übernommenen Abonnenten beginnt mit dem Neustart: "wirt" meldet sich nie
  b.abonnenten_pruefen(t_neu + 4'900'000'000LL);
  PRUEF(b.abonnenten() == 3);
  b.abonnenten_pruefen(t_neu + 5'100'000'000LL);
  PRUEF(b.abonnenten() == 2);
  PRUEF(cdj::z_neuestes(z.daten()->abos, f) >= 0 && f.n == 2);  // das Fach folgt

  // 7b) Ohr T17: meldet der Kern später ein anderes FX-Routing, kommt es an alle, und ein neuer Abonnent bekommt beim
  // Anmelden den aktuellen Stand (nicht fest die Vorgabe 0)
  {
    cdj::Ereignis r{};
    r.art = cdj::Ereignis::FX_ROUTING;
    r.status = 1;
    ere->schiebe(r);
    b.ereignisse_senden();
    mx = x.alle();
    PRUEF(mx.size() == 1 && mx[0].adresse == "/e/fx/routing" && mx[0].i[0] == 1);
    neu.alle();
    Gegenstelle spaet;
    hallo(b, "spaet", spaet.port, t_neu + 5'200'000'000LL);
    auto ms = spaet.alle();
    PRUEF(ms.size() >= 3 && ms[1].adresse == "/e/neustart" && ms[2].adresse == "/e/fx/routing" && ms[2].i[0] == 1);
  }

  // 8) Fehlerfall: Netz ohne Zustand (wie Scheibe 08) nach demselben Neustart: niemand bekommt /e/neustart
  {
    auto bef2 = std::make_unique<cdj::Befehlsring>();
    auto ere2 = std::make_unique<cdj::Ereignisring>();
    cdj::Netz c(0, false, bef2.get(), ere2.get());
    ereignis(*ere2, cdj::Ereignis::NEUSTART, 1, 1'665'536);
    c.ereignisse_senden();
    PRUEF(x.alle(50).empty());
    PRUEF(c.abonnenten() == 0);
  }
  unlink(pfad.c_str());
  rmdir(ordner.c_str());
  PRUEF_ENDE();
}
