// Plan MVP 2 Scheibe 2 (INTERFACES 4.9, 5.11, ADR 025), container core K1: /k/loop/rec in the net thread. A good call queues
// MITSCHNITT with a buffer that reaches down to 60 BPM, bad forms are refused with /q status 6; /e/mitschnitt comes back from the
// callback (finished: the file is written, refused: no file). The loop boxes and their commands are gone (K1); this is what is left
// of test_netz_loop.
#include <filesystem>
#include <fstream>
#include <vector>

#include "cypherdj/loop.h"
#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;

static void rec(cdj::Netz& n, int64_t id, const char* quelle, int beats, const char* name, int summe = 0) {
  cdj::osc::Schreiber s(v::k_loop_rec);
  s.h(id).s(quelle).i(beats).s(name).i(summe);
  n.paket(s.daten(), s.groesse());
}

int main() {
  const fs::path dir = fs::path("/dev/shm") / ("test_netz_mitschnitt_" + std::to_string(getpid()));
  fs::create_directories(dir / "gut");
  auto* bef = new cdj::Befehlsring();
  auto* ere = new cdj::Ereignisring();
  cdj::Befehl b;
  {
    cdj::Netz netz(0, false, bef, ere);
    netz.setze_loop_ordner(dir.string());
    Gegenstelle g;
    {
      cdj::osc::Schreiber s(v::k_hallo);
      s.s("x").i(g.port).i(1);
      netz.paket(s.daten(), s.groesse());
      PRUEF(g.warte("/k/willkommen", 200));
    }
    // 1. /k/loop/rec: guter Aufruf reiht MITSCHNITT ein, der Puffer reicht bis 60 BPM (2 · mitschnitt_max_frames)
    rec(netz, 69, "andreas", 4, "rec1", 1);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::MITSCHNITT && b.id == 69 && b.nr == 4 && !std::strcmp(b.pfad, "rec1"));
    cdj::Mitschnitt* mt = nullptr;
    if (b.zeiger) {
      mt = static_cast<cdj::Mitschnitt*>(const_cast<void*>(b.zeiger));
      PRUEF(mt->beats == 4 && mt->frames == 90000 && mt->daten.size() == (size_t)cdj::mitschnitt_max_frames(4) * 2 && !std::strcmp(mt->name, "rec1") && mt->summe);
    }
    rec(netz, 72, "andreas", 4, "rec9", 2);  // summe 2 ist weder 0 noch 1: ausserhalb_bereich, nichts im Ring
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 72 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
    rec(netz, 70, "andreas", 3, "rec2");  // Beats 3 ist nicht 1, 2, 4, 8, 16 oder 32: ausserhalb_bereich, nichts im Ring
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 70 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    rec(netz, 71, "bogus", 4, "rec3");  // fremde Quelle
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 71 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
    // 6. (Scheibe 2) /e/mitschnitt aus dem Callback: fertig geschrieben (Datei entsteht) oder abgelehnt (keine Datei)
    if (mt) {
      mt->daten.assign(mt->daten.size(), 0.25f);
      cdj::Ereignis f{};
      f.art = cdj::Ereignis::MITSCHNITT;
      f.status = 0;
      f.beat = 4.0;
      f.fassung = 1;
      std::snprintf(f.pfad, sizeof f.pfad, "rec1");
      f.zeiger = mt;
      ere->schiebe(f);
      netz.ereignisse_senden();
      PRUEF(g.warte("/e/mitschnitt", 200) && !std::strcmp(g.s(0), "rec1") && g.m.werte[1].i == 1 &&
            g.m.werte[2].i == 0 && g.m.werte[3].d == 4.0);
      PRUEF(fs::exists(dir / "rec1" / "loop.f32") && fs::exists(dir / "rec1" / "loop.json"));
    }
    auto* mt2 = new cdj::Mitschnitt();
    mt2->beats = 4;
    mt2->frames = 90000;
    mt2->daten.assign(180000, 0.0f);
    std::snprintf(mt2->name, sizeof mt2->name, "abgelehnt");
    cdj::Ereignis ab{};
    ab.art = cdj::Ereignis::MITSCHNITT;
    ab.status = 1;
    ab.fassung = 1;
    std::snprintf(ab.pfad, sizeof ab.pfad, "abgelehnt");
    ab.zeiger = mt2;
    ere->schiebe(ab);
    netz.ereignisse_senden();
    PRUEF(g.warte("/e/mitschnitt", 200) && !std::strcmp(g.s(0), "abgelehnt") && g.m.werte[2].i == 1);
    PRUEF(!fs::exists(dir / "abgelehnt"));
  }
  delete bef;
  delete ere;
  fs::remove_all(dir);
  PRUEF_ENDE();
}
