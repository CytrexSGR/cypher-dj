// S18 task 2: which `eingang` codes /k/rec/spur accepts. Valid codes reach the record-thread check (this fixture has no
// record thread, so they answer "datei_fehlt"); invalid ones are refused earlier with "ausserhalb_bereich".
// Codes (contract osc.json): 11..13 = erz/1..3, 15..17 = erz/5..7, 21, 22 = pad/1, pad/2, 20 = master (not tapped yet).
// 14 (erz/4, production), 18 (erz/8, cue) and everything else are refused.
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cstring>
#include <string>

#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;

static void spur(cdj::Netz& n, int64_t id, int eingang, int scharf = 1) {
  cdj::osc::Schreiber s(v::k_rec_spur);
  s.h(id).s("andreas").i(1).i(scharf).i(eingang);
  n.paket(s.daten(), s.groesse());
}

int main() {
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  {
    cdj::Netz netz(0, false, bef, ere);
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    int64_t id = 100;
    auto antwort = [&](int eingang, const char* grund) {
      spur(netz, ++id, eingang);
      const bool da = g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6;
      const bool ok = da && !std::strcmp(g.s(5), grund);
      if (!ok) std::printf("eingang %d: erwartet %s, bekommen %s\n", eingang, grund, da ? g.s(5) : "(keine Antwort)");
      PRUEF(ok);
    };
    for (int c : {11, 12, 13}) antwort(c, "datei_fehlt");   // control: the codes that always worked
    for (int c : {15, 16, 17, 21, 22}) antwort(c, "datei_fehlt");   // S18: erz/5..7, pad/1..2 pass the range check
    for (int c : {14, 18, 19, 23, 10, 24, -1, 99}) antwort(c, "ausserhalb_bereich");   // erz/4, erz/8 and strays
    antwort(20, "eingang_fehlt");   // master before the fader: valid code, no tap yet
    // arming "none" with eingang 0 is still "kein_eingang"; disarming (scharf 0) with a code is not an error of this check
    spur(netz, ++id, 0, 1);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == id && !std::strcmp(g.s(5), "kein_eingang"));
  }
  delete bef;
  delete ere;
  PRUEF_ENDE();
}
