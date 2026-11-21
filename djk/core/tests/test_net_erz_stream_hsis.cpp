// Container core K1: /erz/strom is ,hsis (id, quelle, strom, ziel) with no channel argument. The stream number alone says
// where the sound goes. Stream 4 (was erz/4, ARR_KANAL) is reserved, everything outside 1..10 is out of range, and the old
// five-argument form ,hsiss is a format error. `bk:` with an empty name replays the stored target of the same stream.
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>

#include <unistd.h>

#include "cypherdj/generator.h"
#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;

static void strom(cdj::Netz& n, int64_t id, const char* ziel, int strom_nr) {
  cdj::osc::Schreiber s(v::erz_strom);
  s.h(id).s("erzeuger").i(strom_nr).s(ziel);
  n.paket(s.daten(), s.groesse());
}

int main() {
  const fs::path dir = fs::path("/dev/shm") / ("test_netz_erz_strom_hsis_" + std::to_string(getpid()));
  fs::create_directories(dir / "gut");
  {
    const float d[4] = {0.5f, 0.5f, 0.25f, 0.25f};
    std::ofstream(dir / "gut/bd_0.f32", std::ios::binary).write(reinterpret_cast<const char*>(d), sizeof d);
    std::ofstream(dir / "gut/kit.json") << R"({"schema":1,"name":"gut","klaenge":[{"note":0,"name":"bd:0","datei":"bd_0.f32","frames":2}]})";
  }
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
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
    cdj::Befehl b{};
    const auto frei = [&](cdj::Befehl& x) {
      if (x.zeiger) delete static_cast<const cdj::Kit*>(x.zeiger);
      x.zeiger = nullptr;
    };
    // ,hsis accepted for stream 5: one command with the stream number and no channel path
    strom(netz, 1, "kit:gut", 5);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::ERZ_STROM && b.id == 1 && b.nr == 5 && b.pfad[0] == '\0');
    frei(b);
    // every stream of the range 1,2,3,5,6,7,9,10 is accepted
    int64_t id = 10;
    for (int n : {1, 2, 3, 5, 6, 7, 9, 10}) {
      strom(netz, id++, "kit:gut", n);
      PRUEF(bef->hole(b) && b.nr == n);
      frei(b);
    }
    // the old five-argument form ,hsiss no longer matches the contract: /e/protokollfehler falsche_typen (the generic type
    // check of the net thread, not a /q), nothing queued
    {
      cdj::osc::Schreiber s("/erz/strom", "hsiss");
      s.h(2).s("erzeuger").i(5).s("kit:gut").s("erz/5");
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/e/protokollfehler", 200) && !std::strcmp(g.s(0), "/erz/strom") && !std::strcmp(g.s(1), "falsche_typen"));
      PRUEF(!bef->hole(b));
    }
    // stream 4 is reserved, 8 and 11 are out of range
    strom(netz, 3, "kit:gut", 4);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 3 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "reserviert"));
    PRUEF(!bef->hole(b));
    strom(netz, 4, "kit:gut", 11);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 4 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    strom(netz, 5, "kit:gut", 8);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 5 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
  }
  {
    // `bk:` replay on a fresh net thread: the stored target belongs to the stream; stream 6 replays its own, stream 7 has none
    cdj::Netz netz(0, false, bef, ere);
    netz.setze_kit_ordner(dir.string());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    cdj::Befehl b{};
    strom(netz, 30, "midi:1:2", 6);
    PRUEF(bef->hole(b) && b.form == 1 && b.politik == 2 && b.nr == 6);
    strom(netz, 31, "bk:", 6);
    PRUEF(bef->hole(b) && b.id == 31 && b.nr == 6 && b.form == 1 && b.politik == 2);
    strom(netz, 32, "bk:", 7);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 32 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
  }
  delete bef;
  delete ere;
  fs::remove_all(dir);
  PRUEF_ENDE();
}
