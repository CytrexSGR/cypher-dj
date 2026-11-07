// 1.10 slice 4c T15: the export carries the rack macros. One track with a compressor and a rack: macro 1 drives the threshold from 0 dB (macro at 0, nothing
// to compress) to -60 dB (macro at 1, ratio 20). The same file is rendered with the macro rows at 0 and at 1:
//   - the macro at 1 is at least 6 dB quieter than the macro at 0 (the rows rack/1/m1 reach the shared core path in the render);
//   - the own row ins/komp/1/schwelle is ignored while the parameter is mapped (AK-S4-16): a render with schwelle -60 and macro 0 equals the render with
//     schwelle 0 and macro 0, sample for sample;
//   - negative control: without the rack the same own row does compress (the mapping, not the row, made the difference).
// Mutation (CMakeLists.txt): RENDER_OHNE_RACK_ZEILEN drops the rack rows from the render at macro 1, the 6 dB case must go red.
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
std::string lies(const std::string& pfad) {
  std::string text;
  std::FILE* f = std::fopen(pfad.c_str(), "rb");
  if (!f) return text;
  char b[4096];
  size_t n;
  while ((n = std::fread(b, 1, sizeof b, f)) > 0) text.append(b, n);
  std::fclose(f);
  return text;
}
}  // namespace

int main() {
  // the request and the control rows are the two files the page writes for the project of oberflaeche/tests/naht_kern_wiedergabe.test.mjs (checked there
  // against what wiedergabe.ts and render.ts write today): one track, a compressor (ratio 20) and a rack whose macro 1 drives the threshold from 0 to -60 dB
  const std::string daten = std::string(CYPHERDJ_DJK) + "/kern/tests/daten/";
  arrdatei::Ordner o("test_render_rack");
  o.sinus('c', 400000, 1000.0, 0.5f);
  std::string text = lies(daten + "wiedergabe_rack.json");
  PRUEF(!text.empty());
  for (size_t at; (at = text.find("@AUDIO@")) != std::string::npos;) text.replace(at, 7, o.pfad + "/audio");
  o.roh(1, text);
  const std::string text_ohne_rack = [&] {   // the same request without the rack: the key is cut out (negative control)
    std::string t = text;
    const size_t a = t.find(",\n   \"rack\"");
    if (a == std::string::npos) return t;
    const size_t e = t.find("\n   }", a) + 5;   // the closing brace of the rack object (same indent as its key)
    return t.erase(a, e - a);
  }();
  PRUEF(text_ohne_rack.size() < text.size() && text_ohne_rack.find("\"rack\"") == std::string::npos && text.find("\"rack\"") != std::string::npos);
  std::vector<cdj::SpurRegler> basis;
  std::string fehler;
  PRUEF(cdj::lies_spur_regler(daten + "render_regler_rack.json", basis, fehler));
  std::printf("controls file: %zu rows %s\n", basis.size(), fehler.c_str());
  // a copy with changed values: schwelle (own row), macro 1; `mit_rack_zeile` false drops the rack rows
  auto regler = [&](float schwelle, float makro, bool mit_rack_zeile) {
    std::vector<cdj::SpurRegler> v;
    for (cdj::SpurRegler r : basis) {
      if (r.pfad == "ins/komp/1/schwelle") r.wert = schwelle;
      if (r.pfad == "rack/1/m1") r.wert = makro;
      if (!mit_rack_zeile && r.pfad.compare(0, 5, "rack/") == 0) continue;
      v.push_back(r);
    }
    return v;
  };
  auto render = [&](bool rack, const std::vector<cdj::SpurRegler>& r) {
    o.roh(1, rack ? text : text_ohne_rack);
    cdj::RenderAuftrag a;
    a.arr_ordner = o.pfad;
    a.nr = 1;
    a.von_beat = 0.0;
    a.bis_beat = 8.0;
    a.bpm = 128.0;
    a.regler_projekt = true;
    a.spur_regler = r;
    a.abgriff = cdj::RenderAbgriff::produktion;
    return cdj::rendere(a);
  };
  const cdj::RenderErgebnis m0 = render(true, regler(-18.0f, 0.0f, true));
#ifndef CYPHERDJ_MUTATION_RENDER_OHNE_RACK_ZEILEN
  const cdj::RenderErgebnis m1 = render(true, regler(-18.0f, 1.0f, true));
#else
  const cdj::RenderErgebnis m1 = render(true, regler(-18.0f, 1.0f, false));   // error case: the export is built without the rack rows
#endif
  std::printf("render macro 0: '%s' %lld frames, macro 1: '%s' %lld frames\n", m0.fehler.c_str(), static_cast<long long>(m0.frames), m1.fehler.c_str(), static_cast<long long>(m1.frames));
  PRUEF(m0.fehler.empty() && m1.fehler.empty());
  PRUEF(m0.frames > 0 && m0.frames == m1.frames);
  const double d0 = rms_db(m0), d1 = rms_db(m1);
  std::printf("RMS macro 0 %.2f dBFS, macro 1 %.2f dBFS; rows %d / %d\n", d0, d1, m0.regler, m1.regler);
  PRUEF(d0 > -20.0);              // macro 0 = threshold 0 dB: the sine passes; silence in both runs would make the comparison pass for the wrong reason
  PRUEF(d0 - d1 >= 6.0);          // macro 1 = threshold -60 dB at ratio 20: at least 6 dB quieter
  // the own row is ignored while mapped: schwelle -60 with macro 0 renders as schwelle 0 with macro 0
  const cdj::RenderErgebnis a = render(true, regler(-60.0f, 0.0f, true)), b = render(true, regler(0.0f, 0.0f, true));
  PRUEF(a.fehler.empty() && b.fehler.empty() && a.l.size() == b.l.size() && !a.l.empty());
  size_t ungleich = 0;
  for (size_t i = 0; i < a.l.size() && i < b.l.size(); ++i) ungleich += (a.l[i] != b.l[i]) + (a.r[i] != b.r[i]);
  std::printf("own row -60 vs 0 while mapped: %zu differing samples of %zu\n", ungleich, a.l.size() * 2);
  PRUEF(ungleich == 0);
  // negative control: without the rack the same own row does compress
  const cdj::RenderErgebnis frei_a = render(false, regler(-60.0f, 0.0f, false)), frei_b = render(false, regler(0.0f, 0.0f, false));
  PRUEF(frei_a.fehler.empty() && frei_b.fehler.empty());
  std::printf("without a rack: schwelle -60 %.2f dBFS, 0 %.2f dBFS\n", rms_db(frei_a), rms_db(frei_b));
  PRUEF(rms_db(frei_b) - rms_db(frei_a) >= 6.0);
  PRUEF_ENDE();
}
