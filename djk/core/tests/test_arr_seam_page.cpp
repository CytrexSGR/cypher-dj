// 1.10 slice 4a, seam S4: the real kern loader reads the request that the page writes (playback.ts, uebersetze) for a project with a compressor
// on a track, a group, a return (pre) and the production master. The file is data/wiedergabe_ketten.json; the node test
// ui/tests/seam_core_playback.test.mjs regenerates it from the project and fails when it is stale.
// Cases: 1 four chains built (strips 0, 32 group 1, 41 return 1, 40 PM), pre on the return, no chain where none was written;
// 2 the bypass of the project lives in the row: the flag in the file is true, the row 0 keeps the stage silent, the row 1 switches it on LIVE
//   (insert_an is a light command that sends only the row, the stage must wake up without a new playback);
// 3 the PM stage really computes (the chain is not only parsed).
// Mutation (CMakeLists.txt): NAHT_PM_UMBENANNT writes the PM chain under the old page key `master` before loading, case 1 must go red.
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

#include "arr_build.h"
#include "arr_file.h"
#include "bk_help.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/kit.h"
#include "check.h"

using namespace arrtest;

static std::string lies(const std::string& pfad) {
  std::ifstream in(pfad);
  std::stringstream s;
  s << in.rdbuf();
  return s.str();
}

int main() {
  const std::string text0 = lies(std::string(CYPHERDJ_DJK) + "/core/tests/data/wiedergabe_ketten.json");
  PRUEF(text0.size() > 100);   // the fixture exists (an empty read would make every case below pass for the wrong reason)
  arrdatei::Ordner o("test_arr_naht_seite");
  o.sinus('c', 400000, 1000.0, 0.5f);   // the sha of the fixture clips is 64 times 'c'
  std::string text = text0;
  for (size_t at; (at = text.find("@AUDIO@")) != std::string::npos;) text.replace(at, 7, o.pfad + "/audio");
#ifdef CYPHERDJ_MUTATION_NAHT_PM_UMBENANNT
  for (size_t at; (at = text.find("\"pm\"")) != std::string::npos;) text.replace(at, 4, "\"master\"");   // the key the page wrote before the seam fix
#endif
  o.roh(1, text);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 1, cache);
  std::printf("load: grund='%s' snap=%d\n", e.grund.c_str(), e.snap ? 1 : 0);
  PRUEF(e.snap && e.grund.empty());
  if (!e.snap) { PRUEF_ENDE(); return 1; }
  {  // 1
    const cdj::ArrKette& s1 = e.snap->kette[0];
    PRUEF(s1.n == 1 && s1.st[0].slot == 0 && s1.st[0].art == cdj::ArrInsArt::komp);
    PRUEF(e.snap->kette[1].n == 0 && e.snap->kette[2].n == 0);   // negative control: tracks 2 and 3 carry no chain
    const cdj::ArrKette& g = e.snap->kette[cdj::ARR_SPUREN + 0];
    PRUEF(g.n == 1 && g.st[0].slot == 1);
    const cdj::ArrKette& r = e.snap->kette[cdj::ARR_KETTE_RET0 + 0];
    PRUEF(r.n == 1 && r.st[0].slot == 2);
    PRUEF(e.snap->ret_pre[0] && e.snap->ret_da[0]);
    const cdj::ArrKette& pm = e.snap->kette[cdj::ARR_KETTE_PM];
    PRUEF(pm.n == 1 && pm.st[0].slot == 3);
    std::printf("1: chains track %d group %d return %d pm %d\n", s1.n, g.n, r.n, pm.n);
  }
  {  // 2 and 3: play the very snapshot
    PRUEF(e.snap->kette[0].st[0].an);   // the page wrote the flag true although the project stage is in bypass
    auto t = std::make_unique<Treiber>();
    auto setze = [&](const char* pfad, float w) { const int r = t->tab.suche(pfad); PRUEF(r >= 0); t->arr.setze_sofort(r, w); };
    for (int s = 1; s <= 4; ++s) {   // the four stages: threshold low, hard ratio, full mix, on; the track stage (slot 1) in bypass like the project
      const std::string b = "ins/komp/" + std::to_string(s) + "/";
      setze((b + "schwelle").c_str(), -30.0f); setze((b + "ratio").c_str(), 8.0f); setze((b + "mix").c_str(), 1.0f);
      setze((b + "an").c_str(), s == 1 ? 0.0f : 1.0f);
    }
    t->laden(e.snap.release());
    t->arr.start(0.0, 2, false, 0, 537, 256, t->k);
    t->lauf(98000);
    PRUEF(!t->arr.inserts().lief(0));    // slot 1: flag true, row 0 -> silent
    PRUEF(t->arr.inserts().lief(1) && t->arr.inserts().lief(2) && t->arr.inserts().lief(3));   // group, return and PM stages run (case 3)
    PRUEF(t->arr.inserts().gr_db(3) > 1.0f);   // the PM stage reduces the gain: the chain is not only parsed
    std::printf("2: stage 1 ran=%d (row 0), PM gr=%.2f dB\n", (int)t->arr.inserts().lief(0), t->arr.inserts().gr_db(3));
    setze("ins/komp/1/an", 1.0f);          // exactly what insert_an sends, no new playback
    t->lauf(150000);
    PRUEF(t->arr.inserts().lief(0));       // the stage wakes up live
    std::printf("2: after the row 1 stage 1 ran=%d gr=%.2f dB\n", (int)t->arr.inserts().lief(0), t->arr.inserts().gr_db(0));
  }
  {  // 4 (1.9 U8 T7) member targets: data/wiedergabe_rack_glieder.json (RB-338 + Baukasten graph t + kit, one target per kind plus an insert target)
    const std::string t0 = lies(std::string(CYPHERDJ_DJK) + "/core/tests/data/wiedergabe_rack_glieder.json");
    PRUEF(t0.size() > 100);
    arrdatei::Ordner og("test_arr_naht_glieder");
    const std::string bkdir = og.pfad + "/bk";
    std::filesystem::create_directories(bkdir);
    std::ofstream(bkdir + "/t.json") << bkt::G_T;
    cdj::SpeicherKonto konto4(100LL << 20);
    cdj::ArrAudioCache cache4(&konto4, 50LL << 20, false);
    cache4.setze_bk_ordner(bkdir);
    cache4.setze_kit_ordner(std::string(CYPHERDJ_DJK) + "/core/tests/data/kits");
    cache4.setze_kit_lader(&cdj::lade_kit);
    og.roh(1, t0);
    cdj::ArrLadeErgebnis g = cdj::lade_wiedergabe(og.pfad, 1, cache4);
    std::printf("4: load grund='%s' meldung='%s' snap=%d\n", g.grund.c_str(), g.meldung.c_str(), g.snap ? 1 : 0);
    PRUEF(g.snap && g.grund.empty());
    if (g.snap) {
      const cdj::ArrRack& r = g.snap->rack[0];
      PRUEF(r.n == 1 && r.ng == 3);   // the insert target and the three member targets
      PRUEF(r.g[0].glied == 0 && r.g[0].param == 1 && r.g[1].glied == 1 && r.g[1].param == 8 && r.g[2].glied == 2 && r.g[2].param == 16);
      std::printf("4: insert targets %d, member targets %d\n", r.n, r.ng);
      cdj::gib_wiedergabe(g.snap.release(), cache4);
    }
    // negative control: the same file with a member index beyond the three members (glied 2 -> 3) is refused by the real loader
    std::string kaputt = t0;
    const size_t nr1 = kaputt.find("\"nr\": 1");   // the file names its own number
    PRUEF(nr1 != std::string::npos);
    if (nr1 != std::string::npos) kaputt.replace(nr1, 7, "\"nr\": 2");
    const size_t at = kaputt.find("\"glied\": 2");
    PRUEF(at != std::string::npos);
    if (at != std::string::npos) kaputt.replace(at, 10, "\"glied\": 3");
    og.roh(2, kaputt);
    cdj::ArrLadeErgebnis h = cdj::lade_wiedergabe(og.pfad, 2, cache4);
    std::printf("4: broken member index: grund='%s' meldung='%s'\n", h.grund.c_str(), h.meldung.c_str());
    PRUEF(h.snap == nullptr && h.grund == "format" && h.meldung.find("is not a member of the rack") != std::string::npos);
    if (h.snap) cdj::gib_wiedergabe(h.snap.release(), cache4);
  }
  {  // 5 (review fix) a frozen rack track (Surge member) goes out as an audio strip with its freeze clip: the chain and the insert target stay, the member target is
     // not written; the real loader accepts it. Negative control: the same file with a member target added back is refused.
    const std::string t5 = lies(std::string(CYPHERDJ_DJK) + "/core/tests/data/wiedergabe_rack_eingefroren.json");
    PRUEF(t5.size() > 100);
    arrdatei::Ordner of("test_arr_naht_eingefroren");
    of.sinus('c', 400000, 1000.0, 0.5f);
    auto fest = [&](std::string t) {
      for (size_t at; (at = t.find("@ARBEIT@")) != std::string::npos;) t.replace(at, 8, of.pfad);
      return t;
    };
    cdj::SpeicherKonto konto5(100LL << 20);
    cdj::ArrAudioCache cache5(&konto5, 50LL << 20, false);
    of.roh(1, fest(t5));
    cdj::ArrLadeErgebnis f = cdj::lade_wiedergabe(of.pfad, 1, cache5);
    std::printf("5: frozen rack load grund='%s' meldung='%s' snap=%d\n", f.grund.c_str(), f.meldung.c_str(), f.snap ? 1 : 0);
    PRUEF(f.snap && f.grund.empty());
    if (f.snap) {
      PRUEF(f.snap->kette[0].n == 1 && f.snap->rack[0].n == 1 && f.snap->rack[0].ng == 0);
      cdj::gib_wiedergabe(f.snap.release(), cache5);
    }
    std::string mit = t5;   // the member target the translator no longer writes
    const size_t at = mit.rfind("}\n    ]\n   }");
    PRUEF(at != std::string::npos);
    if (at != std::string::npos) mit.replace(at, 1, "},{\"makro\":0,\"glied\":0,\"param\":1,\"von\":0,\"bis\":1}");
    of.roh(2, fest(mit).replace(fest(mit).find("\"nr\": 1"), 7, "\"nr\": 2"));
    cdj::ArrLadeErgebnis h = cdj::lade_wiedergabe(of.pfad, 2, cache5);
    std::printf("5: with a member target: grund='%s' meldung='%s'\n", h.grund.c_str(), h.meldung.c_str());
    PRUEF(h.snap == nullptr && h.meldung.find("member targets exist only on a rack track strip") != std::string::npos);
    if (h.snap) cdj::gib_wiedergabe(h.snap.release(), cache5);
  }
  PRUEF_ENDE();
}
