// (Merge 2026-11-07: renamed from test_render_rack.cpp, which on main is the 1.10 slice 4c rack-macro export test.)
// Package 1.9 U6 (T6.5, AK-R7): the offline render plays an instrument-rack track like the live kern.
//   1 a rack with three members (two kit zones with different gains and an RB-338 member) renders sound, and the render is independent of the quantum:
//     128 and 1024 are bit-equal, and a second run is bit-equal
//   2 negative control: a rack with ONE member covering everything is bit-equal to the plain kit track with the same notes
//   3 a rack whose zones hold none of its notes renders silence (the render reaches the rack, not a default device)
// Mutation: RENDER_OHNE_KIT_ORDNER of the kit test also reddens this test (the kit members get no folder), see CMake; the refusal of a rack with a Surge
// member is tested in test_render.cpp (mutation RENDER_RACK_OHNE_SURGE_PRUEFUNG).
#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/render.h"
#include "cypherdj/zustand.h"
#include "pruef.h"

namespace {

const std::string KITS = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/kits";

std::unique_ptr<cdj_z_echtzeit> fach() {
  auto f = std::make_unique<cdj_z_echtzeit>();
  f->n_regler = 1;
  std::snprintf(f->regler[0].pfad, sizeof f->regler[0].pfad, "erz/4/fader");
  f->regler[0].wert = 0.0f;
  return f;
}

std::string noten(const std::vector<std::pair<double, int>>& n) {
  std::string s;
  for (size_t i = 0; i < n.size(); ++i) {
    char b[128];
    std::snprintf(b, sizeof b, "%s{\"id\":\"n%zu\",\"beat\":%.17g,\"laenge\":0.5,\"ton\":%d,\"vel\":110}", i ? "," : "", i, n[i].first, n[i].second);
    s += b;
  }
  return s;
}

cdj::RenderErgebnis render(const std::string& arr, int64_t nr, int quantum = 128) {
  cdj::RenderAuftrag r;
  r.arr_ordner = arr;
  r.nr = nr;
  r.von_beat = 0.0;
  r.bis_beat = 4.0;
  r.bpm = 120.0;
  r.quantum = quantum;
  r.kit_ordner = KITS;
  const auto f = fach();
  r.regler = f.get();
  return cdj::rendere(r);
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_render_rack");
  const std::string n3 = noten({{0.0, 59}, {1.0, 60}, {2.0, 40}});
  const std::string kit_n = noten({{0.0, 59}, {1.0, 60}});
  o.wiedergabe2_warp(1, "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":0,\"glieder\":["
                  "{\"id\":\"lo\",\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_rack\",\"ton\":[0,59]},"
                  "{\"id\":\"hi\",\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_rack\",\"ton\":[60,127],\"gain_db\":-6.0},"
                  "{\"id\":\"bass\",\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5},\"ton\":[36,47]}],\"noten\":[" + n3 + "]}");
  o.wiedergabe2_warp(2, "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":0,\"glieder\":["
                  "{\"id\":\"all\",\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_rack\"}],\"noten\":[" + kit_n + "]}");
  o.wiedergabe(3, "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_rack\",\"noten\":[" + kit_n + "]}");
  o.wiedergabe2_warp(4, "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rack\",\"kette\":0,\"glieder\":["
                  "{\"id\":\"a\",\"art\":\"intern\",\"geraet\":\"kit\",\"kit\":\"kit_rack\",\"ton\":[0,10]}],\"noten\":[" + kit_n + "]}");
  {  // 1: sound, quantum independent
    const cdj::RenderErgebnis a = render(o.pfad, 1, 128), b = render(o.pfad, 1, 1024), c = render(o.pfad, 1, 128);
    std::printf("case 1: error '%s' %s, frames %lld, peak %.4f; quantum 128 == 1024: %d; run == run: %d\n", a.fehler.c_str(), a.meldung.c_str(),
                static_cast<long long>(a.frames), a.spitze, a.l == b.l && a.r == b.r ? 1 : 0, a.l == c.l && a.r == c.r ? 1 : 0);
    PRUEF(a.fehler.empty() && b.fehler.empty() && c.fehler.empty());
    PRUEF(a.spitze > 0.05f && a.frames == 96000);
    PRUEF(a.l == b.l && a.r == b.r);   // AK-R7
    PRUEF(a.l == c.l && a.r == c.r);
  }
  {  // 2: one member covering everything equals the plain kit track
    const cdj::RenderErgebnis a = render(o.pfad, 2), b = render(o.pfad, 3);
    PRUEF(a.fehler.empty() && b.fehler.empty() && a.spitze > 0.05f);
    PRUEF(a.l == b.l && a.r == b.r);
    std::printf("case 2: rack with one member vs plain kit track: bit-equal %d, peak %.4f\n", a.l == b.l && a.r == b.r ? 1 : 0, a.spitze);
  }
  {  // 3: zones that hold no note: silence
    const cdj::RenderErgebnis a = render(o.pfad, 4);
    PRUEF(a.fehler.empty() && a.spitze == 0.0f);
    std::printf("case 3: zones without a note -> peak %.6f\n", a.spitze);
  }
  PRUEF_ENDE();
}
