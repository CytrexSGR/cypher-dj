// 1.10 slice 4a, seam S3: the export carries the insert chains. The project of daten/wiedergabe_ketten.json (compressor on a track in bypass, a group, a return
// with pre and the production master) is rendered with the controls file the page writes for it (daten/render_regler_ketten.json, regenerated and
// checked by oberflaeche/tests/naht_kern_wiedergabe.test.mjs), tap `produktion`. Three renders of the same file:
//   full: all ins/komp rows; dry: every ins/* row removed (the mutation "routingRegler without inserts"); no_pm: only the PM stage (slot 4) removed.
// AK-S4-4/18d: full differs from dry by >= 6 dB RMS, and the PM stage alone changes the level by >= 3 dB (the PM chain is part of the export tap).
// Mutation (CMakeLists.txt): RENDER_OHNE_INS_ZEILEN drops the ins rows from the full render, the 6 dB case must go red.
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/render.h"
#include "pruef.h"

namespace {
double rms_db(const cdj::RenderErgebnis& e) {
  double q = 0.0;
  for (size_t i = 0; i < e.l.size(); ++i) q += static_cast<double>(e.l[i]) * e.l[i] + static_cast<double>(e.r[i]) * e.r[i];
  return 10.0 * std::log10(q / static_cast<double>(2 * e.l.size()) + 1e-20);
}
}  // namespace

int main() {
  const std::string daten = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/";
  arrdatei::Ordner o("test_render_ketten");
  o.sinus('c', 400000, 1000.0, 0.5f);
  {
    std::string text;
    {
      std::FILE* f = std::fopen((daten + "wiedergabe_ketten.json").c_str(), "rb");
      PRUEF(f != nullptr);
      if (!f) { PRUEF_ENDE(); return 1; }
      char b[4096];
      size_t n;
      while ((n = std::fread(b, 1, sizeof b, f)) > 0) text.append(b, n);
      std::fclose(f);
    }
    for (size_t at; (at = text.find("@AUDIO@")) != std::string::npos;) text.replace(at, 7, o.pfad + "/audio");
    o.roh(1, text);
  }
  std::vector<cdj::SpurRegler> alle;
  std::string fehler;
  PRUEF(cdj::lies_spur_regler(daten + "render_regler_ketten.json", alle, fehler));
  std::printf("controls file: %zu rows %s\n", alle.size(), fehler.c_str());
  auto ohne = [&](const std::string& praefix) {
    std::vector<cdj::SpurRegler> v;
    for (const cdj::SpurRegler& r : alle)
      if (r.pfad.compare(0, praefix.size(), praefix) != 0) v.push_back(r);
    return v;
  };
  auto render = [&](const std::vector<cdj::SpurRegler>& regler) {
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = 1;
    r.von_beat = 0.0;
    r.bis_beat = 8.0;
    r.bpm = 128.0;
    r.regler_projekt = true;
    r.spur_regler = regler;
    r.abgriff = cdj::RenderAbgriff::produktion;
    return cdj::rendere(r);
  };
#ifndef CYPHERDJ_MUTATION_RENDER_OHNE_INS_ZEILEN
  const cdj::RenderErgebnis voll = render(alle);
#else
  const cdj::RenderErgebnis voll = render(ohne("ins/"));   // error case: the export is built without the insert rows
#endif
  const cdj::RenderErgebnis trocken = render(ohne("ins/"));
  const cdj::RenderErgebnis kein_pm = render(ohne("ins/komp/4/"));
  PRUEF(voll.fehler.empty() && trocken.fehler.empty() && kein_pm.fehler.empty());
  PRUEF(voll.frames > 0 && voll.frames == trocken.frames);
  const double dv = rms_db(voll), dt = rms_db(trocken), dp = rms_db(kein_pm);
  std::printf("RMS full %.2f dBFS, dry (no ins rows) %.2f dBFS, without the PM stage %.2f dBFS; rows %d / %d / %d\n", dv, dt, dp, voll.regler, trocken.regler, kein_pm.regler);
  PRUEF(dt > -20.0);                            // the dry export is loud: silence in both runs would make the comparison pass for the wrong reason
  PRUEF(dt - dv >= 6.0);                        // the chains compress: the export with rows is at least 6 dB below the one without
  PRUEF(dp - dv >= 3.0);                        // the PM stage alone is audible in the export tap
  PRUEF(voll.regler == trocken.regler + 40);    // the rows really arrived (4 stages x 10)
  PRUEF_ENDE();
}
