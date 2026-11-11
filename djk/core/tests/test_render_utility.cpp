// arr-fx slice 1: the export carries the utility stage. The same mono-near source as test_arr_inserts_util.cpp (L = M + S, R = M - S, Side/Mid -20 dB at 60 Hz and 1 kHz) on one track,
// rendered offline (tap `produktion`) with the controls the project sends, 8 beats at 128 BPM. Renders: reference (no stage), a utility stage on the track (width 2), the same stage on the
// production master, width 2 with mono below 120 Hz, and the stage with its switch off. Side/Mid is read by a correlation over 24000 samples (whole periods of both tones) after the 480 sample blend.
// What must hold: the export widens exactly as the live blocks do (+6.02 dB Side/Mid, the same mono sum, the 60 Hz side gone with the bass setting), and a stage with `an` 0 changes nothing.
// Mutation (CMakeLists.txt): RENDER_OHNE_INS_ZEILEN drops the ins rows of the controls: the width assertion must go red.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

#include "arr_file.h"
#include "cypherdj/render.h"
#include "check.h"

namespace {
constexpr int64_t VON = 93000, BIS = 117000;
double komponente(const std::vector<float>& x, double hz) {
  const double w = 2.0 * 3.14159265358979323846 * hz / 48000.0;
  double re = 0.0, im = 0.0;
  for (int64_t i = VON; i < BIS; ++i) {
    re += static_cast<double>(x[i]) * std::cos(w * static_cast<double>(i));
    im -= static_cast<double>(x[i]) * std::sin(w * static_cast<double>(i));
  }
  return 2.0 * std::sqrt(re * re + im * im) / static_cast<double>(BIS - VON);
}
double db(double x) { return 20.0 * std::log10(std::max(x, 1e-12)); }
double mitte_db(const cdj::RenderErgebnis& e, double hz) {
  std::vector<float> m(e.l.size());
  for (size_t i = 0; i < m.size(); ++i) m[i] = 0.5f * (e.l[i] + e.r[i]);
  return db(komponente(m, hz));
}
double seite_db(const cdj::RenderErgebnis& e, double hz) {
  std::vector<float> s(e.l.size());
  for (size_t i = 0; i < s.size(); ++i) s[i] = 0.5f * (e.l[i] - e.r[i]);
  return db(komponente(s, hz));
}
double sm_db(const cdj::RenderErgebnis& e, double hz) { return seite_db(e, hz) - mitte_db(e, hz); }
}  // namespace

int main() {
  arrdatei::Ordner o("test_render_utility");
  const int64_t frames = 400000;
  const std::string sha(64, 'a');
  {
    std::vector<float> d(static_cast<size_t>(frames) * 2);
    const double w = 2.0 * 3.14159265358979323846 / 48000.0;
    for (int64_t f = 0; f < frames; ++f) {
      const double m = 0.2 * (std::sin(w * 60.0 * static_cast<double>(f)) + std::sin(w * 1000.0 * static_cast<double>(f)));
      const double s = 0.02 * (std::sin(w * 60.0 * static_cast<double>(f)) + std::sin(w * 1000.0 * static_cast<double>(f)));
      d[2 * f] = static_cast<float>(m + s);
      d[2 * f + 1] = static_cast<float>(m - s);
    }
    std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary).write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  }
  const std::string clip = o.clip("c1", 0.0, 8.0, sha, frames);
  const auto schreibe = [&](int64_t nr, const std::string& spur_kette, const std::string& pm) {
    o.roh(nr, "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"master\"}" + spur_kette + ",\"clips\":[" + clip + "]}],\"gruppen\":[],\"returns\":[]" + pm + "}");
  };
  const std::string kette = ",\"chain\":[{\"art\":\"utility\",\"slot\":1,\"an\":true}]";
  schreibe(1, "", "");
  schreibe(2, kette, "");
  schreibe(3, "", ",\"pm\":{\"chain\":[{\"art\":\"utility\",\"slot\":1,\"an\":true}]}");
  const auto render = [&](int64_t nr, const std::vector<cdj::SpurRegler>& regler) {
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = nr;
    r.von_beat = 0.0;
    r.bis_beat = 8.0;
    r.bpm = 128.0;
    r.regler_projekt = true;
    r.spur_regler = regler;
    r.abgriff = cdj::RenderAbgriff::produktion;
    return cdj::rendere(r);
  };
  const auto zeilen = [&](float an, float breite, float mono) {
    std::vector<cdj::SpurRegler> v;
#ifndef CYPHERDJ_MUTATION_RENDER_OHNE_INS_ZEILEN
    v.push_back({"ins/utility/1/an", an});
    v.push_back({"ins/utility/1/breite", breite});
    v.push_back({"ins/utility/1/mono_unter", mono});
#else
    (void)an; (void)breite; (void)mono;   // error case: the export is built without the insert rows
#endif
    return v;
  };
  const cdj::RenderErgebnis ref = render(1, {});
  const cdj::RenderErgebnis breit = render(2, zeilen(1.0f, 2.0f, 0.0f));
  const cdj::RenderErgebnis pm = render(3, zeilen(1.0f, 2.0f, 0.0f));
  const cdj::RenderErgebnis bass = render(2, zeilen(1.0f, 2.0f, 120.0f));
  const cdj::RenderErgebnis aus = render(2, zeilen(0.0f, 2.0f, 0.0f));
  std::fprintf(stderr, "meldung [%s] errors: ref [%s] breit [%s] pm [%s] bass [%s] aus [%s]\n", ref.meldung.c_str(), ref.fehler.c_str(), breit.fehler.c_str(), pm.fehler.c_str(), bass.fehler.c_str(), aus.fehler.c_str());
  PRUEF(ref.fehler.empty() && breit.fehler.empty() && pm.fehler.empty() && bass.fehler.empty() && aus.fehler.empty());
  PRUEF(ref.frames > BIS && breit.frames == ref.frames && pm.frames == ref.frames);
  const double sm0 = sm_db(ref, 1000.0);
  std::printf("reference Side/Mid %.3f dB; width 2 on the track %.3f dB, on the master %.3f dB; rows %d\n", sm0, sm_db(breit, 1000.0), sm_db(pm, 1000.0), breit.regler);
  PRUEF(std::fabs(sm0 + 20.0) < 0.05);                                    // the source and the export path keep the -20 dB
  PRUEF(std::fabs(sm_db(breit, 1000.0) - sm0 - 6.0206) < 0.05);           // the export widens like the live blocks
  PRUEF(std::fabs(sm_db(pm, 1000.0) - sm0 - 6.0206) < 0.05);              // also on the production master
  PRUEF(std::fabs(mitte_db(breit, 1000.0) - mitte_db(ref, 1000.0)) < 0.01);   // the mono sum keeps its level
  // the bass setting: the 60 Hz side is gone, the 60 Hz mid and the 1 kHz widening stay
  std::printf("side at 60 Hz: reference %.1f dBFS, width 2 %.1f, with mono below 120 Hz %.1f\n", seite_db(ref, 60.0), seite_db(breit, 60.0), seite_db(bass, 60.0));
  PRUEF(seite_db(bass, 60.0) < seite_db(ref, 60.0) - 40.0);
  PRUEF(seite_db(breit, 60.0) > seite_db(ref, 60.0) + 5.0);               // negative control: without the setting the bass side is wider
  PRUEF(std::fabs(mitte_db(bass, 60.0) - mitte_db(ref, 60.0)) < 0.05);
  PRUEF(std::fabs(sm_db(bass, 1000.0) - sm0 - 6.0206) < 0.05);
  // the stage with its switch off changes nothing: bit-equal to the reference over the window
  bool gleich = true;
  for (int64_t i = VON; i < BIS; ++i) gleich = gleich && aus.l[i] == ref.l[i] && aus.r[i] == ref.r[i];
  PRUEF(gleich);
  PRUEF_ENDE();
}
