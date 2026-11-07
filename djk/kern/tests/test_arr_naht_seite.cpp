// 1.10 slice 4a, seam S4: the real kern loader reads the request that the page writes (wiedergabe.ts, uebersetze) for a project with a compressor
// on a track, a group, a return (pre) and the production master. The file is daten/wiedergabe_ketten.json; the node test
// oberflaeche/tests/naht_kern_wiedergabe.test.mjs regenerates it from the project and fails when it is stale.
// Cases: 1 four chains built (strips 0, 32 group 1, 41 return 1, 40 PM), pre on the return, no chain where none was written;
// 2 the bypass of the project lives in the row: the flag in the file is true, the row 0 keeps the stage silent, the row 1 switches it on LIVE
//   (insert_an is a light command that sends only the row, the stage must wake up without a new playback);
// 3 the PM stage really computes (the chain is not only parsed).
// Mutation (CMakeLists.txt): NAHT_PM_UMBENANNT writes the PM chain under the old page key `master` before loading, case 1 must go red.
#include <cstdio>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>

#include "arr_bau.h"
#include "arr_datei.h"
#include "cypherdj/arr_wiedergabe.h"
#include "pruef.h"

using namespace arrtest;

static std::string lies(const std::string& pfad) {
  std::ifstream in(pfad);
  std::stringstream s;
  s << in.rdbuf();
  return s.str();
}

int main() {
  const std::string text0 = lies(std::string(CYPHERDJ_DJK) + "/kern/tests/daten/wiedergabe_ketten.json");
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
  PRUEF_ENDE();
}
