// Plan 1.11 T12 (INTERFACES §4.11 /k/arr/export_lauf, §5.13 /e/export_lauf): the net side, no core and no threads of the kern. The net checks the request, allocates the job, starts its
// writer thread and queues it as command ARR_EXPORT_LAUF; a test plays the core (chunks into the ring, the result fields, phase 1) and the net answers /e/export_lauf when the writer is done.
// Cases: 1 refusals as /q 6 (relative path, not .f32, von < 0, bis - von < 1, NaN, a stranger, the AI stop for cypher before the range check, zu_gross above 3600 beats, belegt for a second
// request while one is open), 2 a run: the command carries the job, the file is written from the chunks (exact content, never replacing), the answer carries frames, spitze, luecken
// (the growth of frame_luecken between the request and the answer, from the same window as /zustand/kern), ungesund and an empty grund, 3 a refusal of the core (verwerfen): the
// answer carries the reason and no file is left, 4 a file that is already there: grund datei_fehlt, 5 a command ring that is full: /q 4 zu_spaet and the answer zu_spaet.
#include <unistd.h>

#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <thread>
#include <vector>

#include "cypherdj/arr_export_run.h"
#include "cypherdj/core.h"
#include "cypherdj/net.h"
#include "peer.h"
#include "check.h"

namespace v = cypherdj::osc;

namespace {

void zyklus(cdj::Ereignisring& ere, int32_t luecken) {
  cdj::Ereignis e{};
  e.art = cdj::Ereignis::ZYKLUS;
  e.nframes = 256;
  e.frame_luecken = luecken;
  e.sample = 1000;
  ere.schiebe(e);
}

// plays the core for one job: `n` frames from sample `s0` in chunks of 256 with the value of the frame index (L) and its negative (R); the end is published with phase 1
void kern_spielt(cdj::ArrExportLauf& j, int64_t s0, int n, int32_t ungesund) {
  j.start_s = s0;
  j.frames = n;
  for (int64_t i = 0; i < n;) {
    cdj::AufnahmeChunk c{};
    c.s0 = s0 + i;
    c.n = static_cast<int32_t>(std::min<int64_t>(256, n - i));
    for (int k = 0; k < c.n; ++k) {
      c.l[k] = static_cast<float>(i + k) * 0.001f;
      c.r[k] = -static_cast<float>(i + k) * 0.001f;
    }
    PRUEF(j.ring.schiebe(c));
    i += c.n;
  }
  j.status = 0;
  j.ungesund = ungesund;
  j.ende_s = s0 + n;
  j.phase.store(1, std::memory_order_release);
}

}  // namespace

int main() {
  const std::string dir = "/dev/shm/test_netz_arr_export_lauf_" + std::to_string(::getpid());
  std::filesystem::create_directories(dir);
  auto bef = std::make_unique<cdj::Befehlsring>();
  auto ere = std::make_unique<cdj::Ereignisring>();
  cdj::Netz netz(0, false, bef.get(), ere.get());
  Gegenstelle g;
  {
    cdj::osc::Schreiber s(v::k_hallo);
    s.s("x").i(g.port).i(1);
    netz.paket(s.daten(), s.groesse());
    PRUEF(g.warte("/k/willkommen", 200));
  }
  auto anfrage = [&](int64_t id, const char* quelle, const std::string& pfad, double von, double bis) {
    cdj::osc::Schreiber s(v::k_arr_export_lauf);
    s.h(id).s(quelle).s(pfad.c_str()).d(von).d(bis);
    netz.paket(s.daten(), s.groesse());
  };
  auto q6 = [&](int64_t id, const char* grund) { return g.warte("/q", 200) && g.m.werte[0].h == id && g.m.werte[2].i == 6 && !std::strcmp(g.s(5), grund); };
  auto antwort = [&](int ms) {
    for (int i = 0; i < ms; ++i) {
      netz.ereignisse_senden();
      if (g.warte("/e/export_lauf", 1)) return true;
      std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return false;
  };
  cdj::Befehl b;
  // 1: refusals
  struct Bf { const char* quelle; std::string pfad; double von, bis; const char* grund; };
  const Bf bfs[] = {{"andreas", "relativ.f32", 0.0, 4.0, "ausserhalb_bereich"},      {"andreas", dir + "/a.wav", 0.0, 4.0, "ausserhalb_bereich"},
                    {"andreas", dir + "/a.f32", -1.0, 4.0, "ausserhalb_bereich"},    {"andreas", dir + "/a.f32", 0.0, 0.5, "ausserhalb_bereich"},
                    {"andreas", dir + "/a.f32", 0.0, std::nan(""), "ausserhalb_bereich"}, {"fremd", dir + "/a.f32", 0.0, 4.0, "ausserhalb_bereich"},
                    {"andreas", "", 0.0, 4.0, "ausserhalb_bereich"},                 {"andreas", dir + "/a.f32", 0.0, 3601.0, "zu_gross"}};
  int64_t id = 10;
  for (const Bf& x : bfs) {
    anfrage(++id, x.quelle, x.pfad, x.von, x.bis);
    const bool ok = q6(id, x.grund);
    if (!ok) std::fprintf(stderr, "case '%s' %g..%g: expected %s\n", x.pfad.c_str(), x.von, x.bis, x.grund);
    PRUEF(ok);
  }
  PRUEF(!bef->hole(b));
  {
    cdj::Ereignis ki{};
    ki.art = cdj::Ereignis::KI;
    ki.status = 1;
    PRUEF(ere->schiebe(ki));
    netz.ereignisse_senden();
    anfrage(40, "cypher", dir + "/a.f32", 0.0, 0.5);   // invalid and in the AI stop: ki_gestoppt first
    PRUEF(q6(40, "ki_gestoppt"));
    PRUEF(!bef->hole(b));
    ki.status = 0;
    PRUEF(ere->schiebe(ki));
    netz.ereignisse_senden();
  }
  // 2: a run
  zyklus(*ere, 2);
  netz.ereignisse_senden();
  const std::string a = dir + "/a.f32";
  anfrage(50, "andreas", a, 0.0, 3600.0);   // the maximum is allowed
  PRUEF(bef->hole(b) && b.art == cdj::Befehl::ARR_EXPORT_LAUF && b.id == 50 && b.zeiger && !std::strcmp(b.quelle, "andreas"));
  auto* j = static_cast<cdj::ArrExportLauf*>(const_cast<void*>(b.zeiger));
  PRUEF(j->von_beat == 0.0 && j->bis_beat == 3600.0 && j->phase.load() == 0);
  anfrage(51, "andreas", dir + "/b.f32", 0.0, 4.0);   // one export at a time
  PRUEF(q6(51, "belegt") && !bef->hole(b));
  PRUEF(!g.warte("/e/export_lauf", 20));
  zyklus(*ere, 5);   // the core lost 3 frames meanwhile
  netz.ereignisse_senden();
  kern_spielt(*j, 5000, 700, 3);
  PRUEF(antwort(5000));
  std::printf("2: /e/export_lauf frames %lld spitze %g luecken %d ungesund %d grund '%s'\n", static_cast<long long>(g.m.werte[0].h), static_cast<double>(g.m.werte[1].f), g.m.werte[2].i,
              g.m.werte[3].i, g.s(4));
  PRUEF(g.m.werte[0].h == 700 && std::fabs(g.m.werte[1].f - 0.699f) < 1e-6f && g.m.werte[2].i == 3 && g.m.werte[3].i == 3 && !std::strcmp(g.s(4), ""));
  PRUEF(std::filesystem::exists(a) && std::filesystem::file_size(a) == 700 * 8);
  {
    std::vector<float> d(1400);
    std::ifstream(a, std::ios::binary).read(reinterpret_cast<char*>(d.data()), 1400 * 4);
    PRUEF(d[0] == 0.0f && d[1] == -0.0f && std::fabs(d[2 * 699] - 0.699f) < 1e-6f && std::fabs(d[2 * 699 + 1] + 0.699f) < 1e-6f);
  }
  // 3: a refusal of the core
  anfrage(60, "andreas", dir + "/c.f32", 0.0, 4.0);
  PRUEF(bef->hole(b) && b.id == 60);
  static_cast<cdj::ArrExportLauf*>(const_cast<void*>(b.zeiger))->verwerfen("belegt");
  PRUEF(antwort(5000));
  PRUEF(g.m.werte[0].h == 0 && !std::strcmp(g.s(4), "belegt") && g.m.werte[2].i == 0);
  PRUEF(!std::filesystem::exists(dir + "/c.f32"));
  // 4: a file that is there already is never replaced
  anfrage(70, "andreas", a, 0.0, 4.0);
  PRUEF(bef->hole(b) && b.id == 70);
  kern_spielt(*static_cast<cdj::ArrExportLauf*>(const_cast<void*>(b.zeiger)), 0, 300, 0);
  PRUEF(antwort(5000));
  PRUEF(g.m.werte[0].h == 0 && !std::strcmp(g.s(4), "datei_fehlt"));
  PRUEF(std::filesystem::file_size(a) == 700 * 8);   // untouched
  // 5: a full command ring: /q 4 zu_spaet from the net and the answer of the writer with the same reason
  {
    cdj::Befehl fuell{};
    fuell.art = cdj::Befehl::KLICK;
    while (bef->schiebe(fuell)) {}
    anfrage(80, "andreas", dir + "/e.f32", 0.0, 4.0);
    PRUEF(g.warte("/q", 200) && g.m.werte[0].h == 80 && g.m.werte[2].i == 4 && !std::strcmp(g.s(5), "zu_spaet"));
    PRUEF(antwort(5000));
    PRUEF(g.m.werte[0].h == 0 && !std::strcmp(g.s(4), "zu_spaet"));
    PRUEF(!std::filesystem::exists(dir + "/e.f32"));
  }
  std::filesystem::remove_all(dir);
  PRUEF_ENDE();
}
