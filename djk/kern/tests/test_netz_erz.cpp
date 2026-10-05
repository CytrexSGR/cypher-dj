// Plan 2026-09-27 Task 5: Erzeuger-OSC im Netz (SCHNITTSTELLEN §4.8, ADR 024). /erz/strom kit:<name> lädt das Kit und
// reicht es als Zeiger weiter; Fehler als /q Status 6. Bundles /erz/fenster + /erz/ev werden als ein ErzFenster
// weitergereicht; Formfehler als /e/protokollfehler, nichts im Ring. ERZ_QUITTUNG wird /erz/quittung, ERZ_ALT frei.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "cypherdj/erzeuger.h"
#include "cypherdj/netz.h"
#include "pruef.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;

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

static std::vector<char> bundle(std::initializer_list<const cdj::osc::Schreiber*> msgs) {
  std::vector<char> b(16, 0);
  std::memcpy(b.data(), "#bundle", 8);
  b[15] = 1;  // Zeitmarke 1 = sofort
  for (const auto* m : msgs) {
    const uint32_t n = htonl((uint32_t)m->groesse());
    const char* p = reinterpret_cast<const char*>(&n);
    b.insert(b.end(), p, p + 4);
    b.insert(b.end(), m->daten(), m->daten() + m->groesse());
  }
  return b;
}

static void strom(cdj::Netz& n, int64_t id, const char* ziel, const char* kanal) {
  cdj::osc::Schreiber s(v::erz_strom);
  s.h(id).s("erzeuger").i(1).s(ziel).s(kanal);
  n.paket(s.daten(), s.groesse());
}

int main() {
  const fs::path dir = fs::path("/dev/shm") / ("test_netz_erz_" + std::to_string(getpid()));
  fs::create_directories(dir / "gut");
  {
    const float d[4] = {0.5f, 0.5f, 0.25f, 0.25f};
    std::ofstream(dir / "gut/bd_0.f32", std::ios::binary).write(reinterpret_cast<const char*>(d), sizeof d);
    std::ofstream(dir / "gut/kit.json") << R"({"schema":1,"name":"gut","klaenge":[{"note":0,"name":"bd:0","datei":"bd_0.f32","frames":2}]})";
  }
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  cdj::Befehl b;
  {
    cdj::Netz netz(0, false, bef, ere);
    netz.setze_kit_ordner(dir.string());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    // 1. gutes Kit
    strom(netz, 51, "kit:gut", "erz/1");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_STROM && b.id == 51 && b.nr == 1 && !std::strcmp(b.pfad, "erz/1"));
    if (b.zeiger) {
      const auto* k = static_cast<const cdj::Kit*>(b.zeiger);
      PRUEF(k->n == 1 && k->klang[0].frames == 2);
      delete k;
    }
    // 2. Kit fehlt → pruefung; 3. midi: noch nicht gebaut; 4. Kanal deck/1; 5. Name mit Pfad
    strom(netz, 52, "kit:fehlt", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 52 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
    // Studio S5.1 T2: midi:<port>:<kanal> wird angenommen (kein /q vom Netz; Quittung 1/3 kommt vom Kern): ein
    // ERZ_STROM-Befehl mit form = Port, politik = Kanal, ohne Kit; midi:5:1 (Port ausserhalb) → Status 6, kein Befehl.
    strom(netz, 53, "midi:1:1", "erz/1");
    {
      cdj::Befehl mb{};
      PRUEF(bef->hole(mb) && mb.art == cdj::Befehl::ERZ_STROM && mb.id == 53 && mb.form == 1 && mb.politik == 1 &&
            mb.zeiger == nullptr);
      PRUEF(!bef->hole(mb));
    }
    strom(netz, 57, "midi:5:1", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 57 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    {
      cdj::Befehl mb{};
      PRUEF(!bef->hole(mb));
    }
    strom(netz, 54, "kit:gut", "deck/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 54 && g.m.werte[2].i == 6);
    strom(netz, 55, "kit:../gut", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 55 && g.m.werte[2].i == 6);
    PRUEF(!bef->hole(b));
    // MVP 2 Scheibe 3 (E2): kit:<a>+<b> verschmilzt; b fehlt → nur a; zwei '+' oder leerer Teil → ausserhalb_bereich
    fs::create_directories(dir / "rec");
    {
      const float d[2] = {0.75f, 0.75f};
      std::ofstream(dir / "rec/rec0_0.f32", std::ios::binary).write(reinterpret_cast<const char*>(d), sizeof d);
      std::ofstream(dir / "rec/kit.json") << R"({"schema":1,"name":"rec","klaenge":[{"note":112,"name":"rec0:0","datei":"rec0_0.f32","frames":1}]})";
    }
    b = cdj::Befehl{};
    strom(netz, 56, "kit:gut+rec", "erz/1");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_STROM && b.id == 56 && b.zeiger);
    if (b.zeiger) {
      const auto* k = static_cast<const cdj::Kit*>(b.zeiger);
      PRUEF(k->n == 2 && k->klang[0].frames == 2 && k->klang[112].frames == 1 && k->name == "gut+rec");
      delete k;
    }
    b = cdj::Befehl{};
    strom(netz, 57, "kit:gut+nochnicht", "erz/1");
    PRUEF(bef->hole(b) && b.id == 57 && b.zeiger);
    if (b.zeiger) {
      PRUEF(static_cast<const cdj::Kit*>(b.zeiger)->n == 1);
      delete static_cast<const cdj::Kit*>(b.zeiger);
    }
    strom(netz, 58, "kit:gut+rec+rec", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 58 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    strom(netz, 59, "kit:gut+", "erz/1");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 59 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    b = cdj::Befehl{};
    PRUEF(!bef->hole(b));
    // 6. gutes Bundle: Fenster [4, 12) mit zwei Ereignissen
    cdj::osc::Schreiber f(v::erz_fenster);
    f.i(1).i(9).i(66).i(0).d(4.0).d(12.0).h(0);
    cdj::osc::Schreiber e1(v::erz_ev);
    e1.i(1).i(3).i(1).i(0).d(8.0).d(0.25).f(1.0f);
    cdj::osc::Schreiber e2(v::erz_ev);
    e2.i(1).i(3).i(2).i(0).d(8.5).d(0.25).f(0.5f);
    const auto gut = bundle({&f, &e1, &e2});
    netz.paket(gut.data(), gut.size());
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_FENSTER && b.zeiger);
    if (b.zeiger) {
      const auto* fe = static_cast<const cdj::ErzFenster*>(b.zeiger);
      PRUEF(fe->strom == 1 && fe->sendung == 9 && fe->n == 2 && fe->ev[1].beat == 8.5 && fe->ev[1].velocity == 0.5f);
      delete fe;
    }
    // 7. Ereignis außerhalb des Fensters → protokoll, nichts im Ring
    cdj::osc::Schreiber e3(v::erz_ev);
    e3.i(1).i(3).i(3).i(0).d(12.0).d(0.25).f(1.0f);
    const auto draussen = bundle({&f, &e3});
    netz.paket(draussen.data(), draussen.size());
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "protokoll"));
    PRUEF(!bef->hole(b));
    // 8. /erz/ev ohne Bundle → protokoll
    netz.paket(e1.daten(), e1.groesse());
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(0), "/erz/ev") && !std::strcmp(g.s(1), "protokoll"));
    // 9. Bundle, das mit /erz/ev beginnt → unbekannte_adresse
    const auto verkehrt = bundle({&e1});
    netz.paket(verkehrt.data(), verkehrt.size());
    PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "unbekannte_adresse"));
    PRUEF(!bef->hole(b));
    // 11. Scheibe 3: Parameter-Schwanz (nr, wert). begin/end kommen an, ohne Schwanz gelten 0 und 1,
    //     eine unbekannte nr wird überlesen, zehn Paare (27 Werte) passen.
    {
      cdj::osc::Schreiber p1("/erz/ev", "iiiiddfifif");
      p1.i(1).i(3).i(4).i(0).d(8.0).d(0.25).f(1.0f).i(0).f(0.5f).i(1).f(0.75f);
      cdj::osc::Schreiber p2("/erz/ev", "iiiiddfif");
      p2.i(1).i(3).i(5).i(0).d(9.0).d(0.25).f(1.0f).i(7).f(3.0f);
      const std::string t3 = std::string("iiiiddf") + "ifififififififififif";  // zehn Paare
      cdj::osc::Schreiber p3("/erz/ev", t3.c_str());
      p3.i(1).i(3).i(6).i(0).d(10.0).d(0.25).f(1.0f);
      for (int k = 0; k < 9; ++k) p3.i(9).f(1.0f);
      p3.i(0).f(0.25f);
      PRUEF(p1.ok() && p2.ok() && p3.ok());
      const auto mit = bundle({&f, &e1, &p1, &p2, &p3});
      netz.paket(mit.data(), mit.size());
      b = cdj::Befehl{};  // kein alter Zeiger aus Fall 6, falls hole() scheitert
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_FENSTER && b.zeiger);
      if (b.zeiger) {
        const auto* fe = static_cast<const cdj::ErzFenster*>(b.zeiger);
        PRUEF(fe->n == 4);
        PRUEF(fe->ev[0].begin == 0.0f && fe->ev[0].end == 1.0f);
        PRUEF(fe->ev[1].begin == 0.5f && fe->ev[1].end == 0.75f);
        PRUEF(fe->ev[2].begin == 0.0f && fe->ev[2].end == 1.0f);
        PRUEF(fe->ev[3].begin == 0.25f && fe->ev[3].end == 1.0f);
        delete fe;
      }
    }
    // 12. halber Schwanz (nr ohne wert) → falsche_typen, nichts im Ring
    {
      cdj::osc::Schreiber h("/erz/ev", "iiiiddfi");
      h.i(1).i(3).i(7).i(0).d(8.0).d(0.25).f(1.0f).i(0);
      const auto halb = bundle({&f, &h});
      netz.paket(halb.data(), halb.size());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "falsche_typen"));
      PRUEF(!bef->hole(b));
    }
    // 13. begin nicht endlich → protokoll
    {
      cdj::osc::Schreiber n("/erz/ev", "iiiiddfif");
      n.i(1).i(3).i(8).i(0).d(8.0).d(0.25).f(1.0f).i(0).f(std::nanf(""));
      const auto nan = bundle({&f, &n});
      netz.paket(nan.data(), nan.size());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(1), "protokoll"));
      PRUEF(!bef->hole(b));
    }
    // 14. (Abschluss-Review Scheibe 3 Fund 7) unbekannte nr mit NaN wird überlesen; begin = +Inf gilt (der Kern klemmt
    //     beim Spielen), nur NaN bei einem bekannten Parameter ist ein Formfehler.
    {
      cdj::osc::Schreiber u("/erz/ev", "iiiiddfifif");
      u.i(1).i(3).i(9).i(0).d(8.0).d(0.25).f(1.0f).i(9).f(std::nanf("")).i(0).f(INFINITY);
      const auto paket_u = bundle({&f, &u});
      netz.paket(paket_u.data(), paket_u.size());
      b = cdj::Befehl{};
      PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_FENSTER && b.zeiger);
      if (b.zeiger) {
        const auto* fe = static_cast<const cdj::ErzFenster*>(b.zeiger);
        PRUEF(fe->n == 1 && std::isinf(fe->ev[0].begin));
        delete fe;
      }
    }
    // 10. Quittung und Freigaben aus dem Callback
    cdj::Ereignis q{};
    q.art = cdj::Ereignis::ERZ_QUITTUNG;
    q.deck = 1;
    q.fassung = 9;
    q.erz_zahl[0] = 2; q.erz_zahl[1] = 1; q.erz_zahl[2] = 3; q.erz_zahl[3] = 4; q.erz_zahl[4] = 0;
    q.zeiger = new cdj::ErzFenster();
    ere->schiebe(q);
    cdj::Ereignis a{};
    a.art = cdj::Ereignis::ERZ_ALT;
    a.zeiger = new cdj::Kit();
    ere->schiebe(a);
    netz.ereignisse_senden();  // gibt beide frei (ASan-Bau: kein Leck)
    PRUEF(g.warte("/erz/quittung", 200) && g.m.werte[0].i == 1 && g.m.werte[1].i == 9 && g.m.werte[2].i == 2 &&
          g.m.werte[3].i == 1 && g.m.werte[4].i == 3 && g.m.werte[5].i == 4 && g.m.werte[6].i == 0);
  }
  delete bef;
  delete ere;
  fs::remove_all(dir);
  PRUEF_ENDE();
}
