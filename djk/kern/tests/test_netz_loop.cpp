// Plan MVP 2 Task 5: Loop-OSC im Netz (SCHNITTSTELLEN §4.9, §5.11, ADR 025). /k/loop/laden liest den Loop aus dem
// Loop-Ordner und reicht ihn als Zeiger weiter; Fehler als /q Status 6. start/stopp gehen als Befehl durch. LOOP wird
// /e/loop, LOOP_ALT wird freigegeben (ASan-Bau: kein Leck).
#include <filesystem>
#include <fstream>
#include <vector>

#include "cypherdj/loop.h"
#include "cypherdj/netz.h"
#include "gegenstelle.h"
#include "pruef.h"

namespace v = cypherdj::osc;
namespace fs = std::filesystem;

static void laden(cdj::Netz& n, int64_t id, const char* quelle, int box, const char* name) {
  cdj::osc::Schreiber s(v::k_loop_laden);
  s.h(id).s(quelle).i(box).s(name);
  n.paket(s.daten(), s.groesse());
}
static void start_stopp(cdj::Netz& n, const cypherdj::osc::Adresse& a, int64_t id, int box) {
  cdj::osc::Schreiber s(a);
  s.h(id).s("andreas").i(box);
  n.paket(s.daten(), s.groesse());
}

static void rec(cdj::Netz& n, int64_t id, const char* quelle, int beats, const char* name) {
  cdj::osc::Schreiber s(v::k_loop_rec);
  s.h(id).s(quelle).i(beats).s(name);
  n.paket(s.daten(), s.groesse());
}

int main() {
  const fs::path dir = fs::path("/dev/shm") / ("test_netz_loop_" + std::to_string(getpid()));
  fs::create_directories(dir / "gut");
  {
    std::vector<float> x(2 * 90000, 0.125f);
    std::ofstream(dir / "gut/loop.f32", std::ios::binary).write(reinterpret_cast<const char*>(x.data()), (std::streamsize)(x.size() * 4));
    std::ofstream(dir / "gut/loop.json") << R"({"schema":1,"name":"anders","takte":1,"bpm":128,"frames":90000,"datei":"loop.f32"})";
  }
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
    // 1. guter Loop: der Ordnername gilt als Name
    laden(netz, 61, "andreas", 1, "gut");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::LOOP_LADEN && b.id == 61 && b.deck == 1 && !std::strcmp(b.pfad, "gut"));
    if (b.zeiger) {
      const auto* l = static_cast<const cdj::Loop*>(b.zeiger);
      PRUEF(l->beats == 4 && l->frames == 90000 && l->name == "gut" && l->daten[5] == 0.125f);
      delete l;
    }
    // 2. Fehler: fehlt → pruefung; Box 3, Name mit Pfad, fremde Quelle → ausserhalb_bereich; nichts im Ring
    laden(netz, 62, "andreas", 1, "fehlt");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 62 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "pruefung"));
    laden(netz, 63, "andreas", 3, "gut");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 63 && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    laden(netz, 64, "andreas", 1, "../gut");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 64 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    laden(netz, 65, "bogus", 1, "gut");
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 65 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
    // 3. start und stopp gehen durch, Box 0 nicht
    start_stopp(netz, v::k_loop_start, 66, 2);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::LOOP_START && b.id == 66 && b.deck == 2 && !std::strcmp(b.quelle, "andreas"));
    start_stopp(netz, v::k_loop_stopp, 67, 1);
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::LOOP_STOPP && b.deck == 1);
    start_stopp(netz, v::k_loop_start, 68, 0);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 68 && g.m.werte[2].i == 6);
    PRUEF(!bef->hole(b));
    // Plan Grid: /k/loop/raster (an die Datei angepasst: netz.paket, bef->hole, g.warte)
    { cdj::osc::Schreiber s(v::k_loop_raster); s.h(160).s("andreas").i(2).i(-4500); netz.paket(s.daten(), s.groesse()); }
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::LOOP_RASTER && b.deck == 2 && b.versatz_f == -4500);
    { cdj::osc::Schreiber s(v::k_loop_raster); s.h(161).s("andreas").i(3).i(0); netz.paket(s.daten(), s.groesse()); }
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 161 && !std::strcmp(g.s(5), "ausserhalb_bereich"));
    PRUEF(!bef->hole(b));
    // 4. /e/loop aus dem Callback, LOOP_ALT wird frei
    cdj::Ereignis e{};
    e.art = cdj::Ereignis::LOOP;
    e.deck = 2;
    e.status = 3;
    std::snprintf(e.pfad, sizeof e.pfad, "gut");
    e.fassung = 1;
    e.fx_beats = 1.0;
    ere->schiebe(e);
    cdj::Ereignis a{};
    a.art = cdj::Ereignis::LOOP_ALT;
    a.zeiger = new cdj::Loop();
    ere->schiebe(a);
    netz.ereignisse_senden();
    PRUEF(g.warte("/e/loop", 200) && g.m.werte[0].i == 2 && g.m.werte[1].i == 3 && !std::strcmp(g.s(2), "gut") &&
          g.m.werte[3].i == 1 && g.m.werte[4].i == 0 && g.m.werte[5].d == 1.0 && g.m.werte[6].f == 0.0f);
    // 5. (Scheibe 2) /k/loop/rec: guter Aufruf reiht MITSCHNITT ein, der Puffer reicht bis 60 BPM (2 · mitschnitt_max_frames)
    rec(netz, 69, "andreas", 4, "rec1");
    PRUEF(bef->hole(b) && b.art == cdj::Befehl::MITSCHNITT && b.id == 69 && b.nr == 4 && !std::strcmp(b.pfad, "rec1"));
    cdj::Mitschnitt* mt = nullptr;
    if (b.zeiger) {
      mt = static_cast<cdj::Mitschnitt*>(const_cast<void*>(b.zeiger));
      PRUEF(mt->beats == 4 && mt->frames == 90000 && mt->daten.size() == (size_t)cdj::mitschnitt_max_frames(4) * 2 && !std::strcmp(mt->name, "rec1"));
    }
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
