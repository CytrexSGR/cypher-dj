// DJ view places task 5, case 11 (decision 8): the render program (rendere(), what cypherdj-render runs) sets the offline switch. A live file with the group on dj 1 (and, ADR 038, on dj 3 or dj 6) renders equal to the same
// file with the group on the master, in the master tap and in the production master tap (export, loudness, merge, bounce and areas/live/level.ts hang on them). Without the
// kern->setze_arr_dj_als_master() call in render.cpp the module would be missing from every offline file of a live project.
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "arr_file.h"
#include "cypherdj/render.h"
#include "check.h"

static bool gleich(const std::vector<float>& a, const std::vector<float>& b) { return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0; }
static double spitze(const std::vector<float>& x) {
  double m = 0.0;
  for (float v : x) m = v > m ? v : (-v > m ? -v : m);
  return m;
}

int main() {
  {  // (cypherdj-render, rendere()) sets the offline switch: a live file with the group on dj 1 renders equal to the same file with the group on the master, in the master tap
     // and in the production master tap (export, loudness, merge, bounce and level.ts hang on it)
    arrdatei::Ordner o("test_arr_dj_kanal_render");
    const int64_t frames = 400000;
    const std::string sha = o.audio('a', frames, 0.25f);
    const std::string clip = o.clip("c1", 0.0, 8.0, sha, frames);
    auto schreibe = [&](int64_t nr, int dj) {   // dj: the DJ channel of the group, 0 = master
      o.roh(nr, "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + clip +
                  "]}],\"live\":true,\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"" + (dj ? "dj\",\"nr\":" + std::to_string(dj) : std::string("master\"")) + "}}],\"returns\":[]}");
    };
    schreibe(1, 0);
    schreibe(2, 1);
    schreibe(3, 3);   // ADR 038: deck/1
    schreibe(4, 4);   // K5: pad/2
    for (cdj::RenderAbgriff ab : {cdj::RenderAbgriff::set, cdj::RenderAbgriff::produktion}) {
      auto rendere = [&](int64_t nr) {
        cdj::RenderAuftrag r;
        r.arr_ordner = o.pfad;
        r.nr = nr;
        r.von_beat = 0.0;
        r.bis_beat = 4.0;
        r.bpm = 128.0;
        r.abgriff = ab;
        r.regler_projekt = true;   // erz/4 neutral: the master tap carries the production
        return cdj::rendere(r);
      };
      const cdj::RenderErgebnis ref = rendere(1);
      PRUEF(ref.fehler.empty() && ref.frames > 0);
      std::fprintf(stderr, "abgriff %d: ref peak %g frames %lld [%s]\n", static_cast<int>(ab), spitze(ref.l), static_cast<long long>(ref.frames), ref.fehler.c_str());
      PRUEF(spitze(ref.l) > 0.1);
      for (int64_t nr : {2, 3, 4}) {   // dj 1 (ADR 037), and ADR 038: dj 3 = pad/1 and dj 4 = pad/2 route into the master offline like dj 1
        const cdj::RenderErgebnis dj = rendere(nr);
        PRUEF(dj.fehler.empty() && dj.frames == ref.frames);
        PRUEF(gleich(dj.l, ref.l) && gleich(dj.r, ref.r));
      }
    }
  }
  PRUEF_ENDE();
}
