// Baukasten S20 (task 5): the offline render plays a project track with device bk like the live kern (render.h bk_ordner).
//   1 a bk track renders: peak above -60 dBFS, silent before its first note (the graph rests until the note)
//   2 the render is deterministic (two runs bit-identical) and the knob of the playback arrives (k1 0.8 against 0.1)
//   3 the same project with the track muted (spur/2/mute 1, regler source projekt) renders silence
//   4 negative controls: a graph that is not in the folder, and no graph folder at all, are refused with fehler "format" (no crash,
//     no silent export)
// Mutation: RENDER_OHNE_BK_ORDNER (the render does not hand the folder to the loader) turns cases 1 and 2 red.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>

#include "arr_datei.h"
#include "bk_hilfe.h"
#include "cypherdj/render.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

double db(float x) { return x > 0.0f ? 20.0 * std::log10(static_cast<double>(x)) : -200.0; }

std::unique_ptr<cdj_z_echtzeit> fach_erz4() {
  auto f = std::make_unique<cdj_z_echtzeit>();
  f->n_regler = 1;
  std::snprintf(f->regler[0].pfad, sizeof f->regler[0].pfad, "erz/4/fader");
  f->regler[0].wert = 0.0f;
  return f;
}

std::string projekt(const char* graph, const char* k1) {
  return std::string("{\"nr\":2,\"art\":\"intern\",\"geraet\":\"bk\",\"graph\":\"") + graph + "\",\"parameter\":{\"k1\":" + k1 +
         "},\"noten\":[{\"id\":\"c2/n1\",\"beat\":0.5,\"laenge\":0.5,\"ton\":57,\"vel\":100},"
         "{\"id\":\"c2/n2\",\"beat\":2.0,\"laenge\":0.5,\"ton\":64,\"vel\":100}]}";
}

cdj::RenderErgebnis render(const std::string& arr, int64_t nr, const std::string& bk, bool mute = false) {
  cdj::RenderAuftrag r;
  r.arr_ordner = arr;
  r.nr = nr;
  r.von_beat = 0.0;
  r.bis_beat = 4.0;
  r.bpm = 128.0;
  r.bk_ordner = bk;
  const auto fach = fach_erz4();
  if (mute) {
    r.regler_projekt = true;
    r.spur_regler = {{"spur/2/mute", 1.0f}};
  } else {
    r.regler = fach.get();
  }
  return cdj::rendere(r);
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_render_bk");
  const std::string bk = o.pfad + "/bk";
  std::filesystem::create_directories(bk);
  std::ofstream(bk + "/t.json") << bkt::G_T;
  o.wiedergabe(1, projekt("t", "0.8"));
  o.wiedergabe(2, projekt("t", "0.1"));
  o.wiedergabe(3, projekt("fehlt", "0.8"));
  {  // 1: renders, silent before the first note (beat 0.5 = 11250 samples)
    const cdj::RenderErgebnis e = render(o.pfad, 1, bk);
    std::printf("case 1: error '%s' %s, peak %.1f dBFS\n", e.fehler.c_str(), e.meldung.c_str(), db(e.spitze));
    PRUEF(e.fehler.empty() && db(e.spitze) > -60.0);
    float vor = 0.0f;
    for (size_t i = 0; i < 11000 && i < e.l.size(); ++i) vor = std::max(vor, std::fabs(e.l[i]));
    PRUEF(vor == 0.0f);
  }
  {  // 2: deterministic, and the knob arrives
    const cdj::RenderErgebnis a = render(o.pfad, 1, bk), b = render(o.pfad, 1, bk), c = render(o.pfad, 2, bk);
    PRUEF(a.fehler.empty() && b.fehler.empty() && c.fehler.empty());
    PRUEF(a.l == b.l && a.r == b.r);
    PRUEF(a.spitze > 0.0f && c.spitze > 0.0f && a.spitze > 4.0f * c.spitze);   // 0.8 against 0.1: the level follows the knob
    std::printf("case 2: peak k1 0.8 %.5f, k1 0.1 %.5f\n", a.spitze, c.spitze);
  }
  {  // 3: muted track renders silence (source projekt: erz/4 neutral, the project controls on top)
    const cdj::RenderErgebnis e = render(o.pfad, 1, bk, true);
    PRUEF(e.fehler.empty() && e.spitze == 0.0f);
    const cdj::RenderErgebnis laut = render(o.pfad, 1, bk, false);
    PRUEF(laut.spitze > 0.0f);   // control: without the mute the same project sounds
  }
  {  // 4: refused, not silent
    const cdj::RenderErgebnis a = render(o.pfad, 3, bk);
    PRUEF(a.fehler == "format");
    PRUEF(a.meldung.find("fehlt") != std::string::npos);
    const cdj::RenderErgebnis b = render(o.pfad, 1, "");
    PRUEF(b.fehler == "format");
    std::printf("case 4: missing graph -> '%s' (%s); no folder -> '%s' (%s)\n", a.fehler.c_str(), a.meldung.c_str(), b.fehler.c_str(), b.meldung.c_str());
  }
  PRUEF_ENDE();
}
