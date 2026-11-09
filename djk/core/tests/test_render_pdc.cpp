// 1.10 slice 4b T13/T14: the export of the production tap with latency stages.
//  1 pdc_vorhalt_export (T13): a project with an eq on its only track is exported at the tap `produktion`; the impulse sits at the same sample of the file as in the same
//    project without the stage (the first valid sample of the export accounts for the largest path latency, RenderErgebnis::pdc_latenz).
//  2 render_inserts_paritaet (AK-S4-10): 8 bars with komp, eq and saett inserts (a group chain and a delayed plain track among them) are bit-equal between the
//    quantum 128, 256, 480 and 1024. The render drives the same Kern::audio path as the live callback with the block size of the quantum, so this is the live-block
//    parity; the the render lets the stages settle on silence before the transport starts (RENDER_EINSCHWINGEN), so the distance between the load and the start (a few blocks, which depends on the quantum) does not reach the export.
//  3 (master limiter plan, Task 4): a master `lim` holds the ceiling in the export (peak <= -1 dBFS from about +3 dBFS), `an` 0 is bit-equal to no stage, the onset lag is 0.
// Mutations (CMakeLists.txt): RENDER_OHNE_PDC_VORHALT (1), RENDER_OHNE_EINSCHWINGEN (2: the EQ smoothing is still running at the start of the music and quantum 128 differs), PDC_BLOCK_NEU (2).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "arr_file.h"
#include "cypherdj/render.h"
#include "check.h"

namespace {

std::string spur(const arrdatei::Ordner& o, int nr, const std::string& sha, const char* kette, int gruppe = 0) {
  std::string s = "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\",\"clips\":[" + o.clip(("c" + std::to_string(nr)).c_str(), 0.0, 16.0, sha, 400000) + "]";
  if (kette[0]) s += std::string(",\"chain\":[") + kette + "]";
  if (gruppe) s += ",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" + std::to_string(gruppe) + "}";
  return s + "}";
}
const char* ST(const char* art, int slot) {
  static char b[8][96];
  static int i = 0;
  i = (i + 1) % 8;
  std::snprintf(b[i], sizeof b[i], "{\"art\":\"%s\",\"slot\":%d,\"an\":true}", art, slot);
  return b[i];
}

cdj::RenderErgebnis render(const std::string& ordner, const std::vector<cdj::SpurRegler>& regler, int quantum) {
  cdj::RenderAuftrag r;
  r.arr_ordner = ordner;
  r.nr = 1;
  r.von_beat = 0.0;
  r.bis_beat = 32.0;   // 8 bars
  r.bpm = 128.0;
  r.quantum = quantum;
  r.regler_projekt = true;
  r.spur_regler = regler;
  r.abgriff = cdj::RenderAbgriff::produktion;
  return cdj::rendere(r);
}

}  // namespace

int main() {
  std::vector<cdj::SpurRegler> an_eq = {{"ins/eq/1/an", 1.0f}};
  {  // 1 pdc_vorhalt_export
    arrdatei::Ordner o("test_render_pdc1");
    const std::string imp = o.impuls('e', 400000);
    auto projekt = [&](bool mit) {
      const std::string kette = mit ? ST("eq", 1) : "";
      o.roh(1, "{\"format\":\"cypherdj-arr/2\",\"nr\":1,\"spuren\":[" + spur(o, 1, imp, kette.c_str()) + "]}");
    };
    auto spitze_pos = [](const cdj::RenderErgebnis& e) {
      int64_t p = -1;
      float m = 0.0f;
      for (size_t i = 0; i < e.l.size(); ++i)
        if (std::fabs(e.l[i]) > m) { m = std::fabs(e.l[i]); p = static_cast<int64_t>(i); }
      return p;
    };
    projekt(false);
    const cdj::RenderErgebnis ohne = render(o.pfad, {}, 256);
    projekt(true);
    const cdj::RenderErgebnis mit = render(o.pfad, an_eq, 256);
    if (!ohne.fehler.empty() || !mit.fehler.empty()) std::fprintf(stderr, "render: %s %s | %s %s\n", ohne.fehler.c_str(), ohne.meldung.c_str(), mit.fehler.c_str(), mit.meldung.c_str());
    PRUEF(ohne.fehler.empty() && mit.fehler.empty());
    std::printf("1: no stage: impulse at file sample %lld (pdc %d); eq: impulse at %lld (pdc %d)\n", static_cast<long long>(spitze_pos(ohne)), ohne.pdc_latenz,
                static_cast<long long>(spitze_pos(mit)), mit.pdc_latenz);
    PRUEF(ohne.pdc_latenz == 0);
    PRUEF(mit.pdc_latenz > 0);                                   // positive control: the stage has a latency to skip
    PRUEF(std::fabs(ohne.l[static_cast<size_t>(spitze_pos(ohne))]) > 0.5f);   // the impulse is in the file
    PRUEF((spitze_pos(mit)) == (spitze_pos(ohne)));
  }

  {  // 2 render_inserts_paritaet
    arrdatei::Ordner o("test_render_pdc2");
    const std::string a = o.sinus('a', 400000, 220.0, 0.30f), b = o.sinus('b', 400000, 330.0, 0.25f), c = o.sinus('c', 400000, 440.0, 0.20f), d = o.sinus('d', 400000, 110.0, 0.30f);
    const std::string k1 = std::string(ST("komp", 1)) + "," + ST("eq", 1);
    o.roh(1, "{\"format\":\"cypherdj-arr/2\",\"nr\":1,\"spuren\":[" + spur(o, 1, a, k1.c_str()) + "," + spur(o, 2, b, "") + "," + spur(o, 3, c, "", 1) + "," + spur(o, 4, d, "", 1) +
                  "],\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"chain\":[" + ST("saett", 1) + "]}],\"pm\":{\"chain\":[" + ST("komp", 2) + "]}}");
    std::vector<cdj::SpurRegler> regler = {{"ins/komp/1/an", 1.0f},   {"ins/komp/1/schwelle", -30.0f}, {"ins/komp/1/ratio", 4.0f},   {"ins/komp/2/an", 1.0f},
                                           {"ins/komp/2/schwelle", -24.0f}, {"ins/eq/1/an", 1.0f},     {"ins/eq/1/b1/an", 1.0f},     {"ins/eq/1/b1/freq", 440.0f},
                                           {"ins/eq/1/b1/gain", 6.0f},      {"ins/eq/1/b1/q", 1.0f},   {"ins/saett/1/an", 1.0f},     {"ins/saett/1/drive", 12.0f},
                                           {"ins/saett/1/out", -6.0f},      {"ins/saett/1/mix", 1.0f}};
    std::vector<cdj::SpurRegler> trocken;
    const cdj::RenderErgebnis ref = render(o.pfad, regler, 256);
    PRUEF(ref.fehler.empty());
    PRUEF(ref.pdc_latenz > 0);
    double e = 0.0, ed = 0.0;
    const cdj::RenderErgebnis tr = render(o.pfad, trocken, 256);
    for (size_t i = 0; i < ref.l.size(); ++i) {
      e += static_cast<double>(ref.l[i]) * ref.l[i];
      ed += (static_cast<double>(ref.l[i]) - tr.l[i]) * (static_cast<double>(ref.l[i]) - tr.l[i]);
    }
    std::printf("2: 8 bars, quantum 256: %lld frames, pdc %d, energy %.1f, energy of the difference to the dry export %.1f\n", static_cast<long long>(ref.frames), ref.pdc_latenz, e, ed);
    PRUEF(e > 100.0);          // the signal is there (positive control)
    PRUEF(ed > 0.1 * e);       // and the stages change it: the comparison below is not a comparison of silence or of the dry export
    for (int q : {128, 480, 1024}) {
      const cdj::RenderErgebnis x = render(o.pfad, regler, q);
      PRUEF(x.fehler.empty());
      const bool gleich = x.frames == ref.frames && std::memcmp(x.l.data(), ref.l.data(), sizeof(float) * ref.l.size()) == 0 &&
                          std::memcmp(x.r.data(), ref.r.data(), sizeof(float) * ref.r.size()) == 0;
      size_t ersterf = 0;
      while (ersterf < ref.l.size() && x.l[ersterf] == ref.l[ersterf]) ++ersterf;
      std::printf("2: quantum %d against 256: %s (first difference at file sample %zu of %zu)\n", q, gleich ? "bit-equal" : "DIFFERENT", ersterf, ref.l.size());
      PRUEF(gleich);
    }
  }
  {  // 3 export with a lim on the master (master limiter plan, Task 4)
    arrdatei::Ordner o("test_render_pdc3");
    // white-ish noise (fixed LCG, so every run is the same): a sine is periodic and cannot show a lag; peak 0.5
    const std::string sha(64, 'b');
    {
      std::vector<float> d(400000 * 2);
      uint32_t x = 12345u;
      for (size_t i = 0; i < d.size(); i += 2) {
        x = x * 1664525u + 1013904223u;
        d[i] = d[i + 1] = (static_cast<float>(x >> 8) / 8388608.0f - 1.0f) * 0.5f;
      }
      std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary).write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
    }
    // one audio clip with +12 dB gain: 0.5 * 3.98 = 1.99, centre pan law -3 dB -> the PM sum peaks at about +3 dBFS (a sine at +9 dB measured -0.03 dBFS, so the pan law is in)
    const std::string clip = o.clip("c1", 0.0, 16.0, sha, 400000, 0, 12.0);
    auto projekt = [&](bool mit) {
      const std::string pm = mit ? std::string(",\"pm\":{\"chain\":[") + ST("lim", 1) + "]}" : "";
      o.roh(1, "{\"format\":\"cypherdj-arr/2\",\"nr\":1,\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clip + "]}]" + pm + "}");
    };
    auto spitze_db = [](const cdj::RenderErgebnis& e) {
      float m = 0.0f;
      for (size_t i = 0; i < e.l.size(); ++i) m = std::max(m, std::max(std::fabs(e.l[i]), std::fabs(e.r[i])));
      return 20.0 * std::log10(static_cast<double>(m) + 1e-20);
    };
    auto erster = [](const cdj::RenderErgebnis& e) {   // first sample with a clearly audible value
      size_t i = 0;
      while (i < e.l.size() && std::fabs(e.l[i]) < 0.01f) ++i;
      return i;
    };
    projekt(false);
    const cdj::RenderErgebnis a = render(o.pfad, {}, 256);
    projekt(true);
    const cdj::RenderErgebnis b = render(o.pfad, {{"ins/lim/1/an", 1.0f}, {"ins/lim/1/decke", -1.0f}}, 256);
    const cdj::RenderErgebnis c = render(o.pfad, {{"ins/lim/1/an", 0.0f}}, 256);
    if (!a.fehler.empty() || !b.fehler.empty() || !c.fehler.empty())
      std::fprintf(stderr, "render: %s | %s | %s\n", a.fehler.c_str(), b.fehler.c_str(), c.fehler.c_str());
    PRUEF(a.fehler.empty() && b.fehler.empty() && c.fehler.empty());
    PRUEF(a.frames > 0 && a.frames == b.frames && a.frames == c.frames);
    const double pa = spitze_db(a), pb = spitze_db(b), pc = spitze_db(c);
    const bool gleich = c.frames == a.frames && std::memcmp(c.l.data(), a.l.data(), sizeof(float) * a.l.size()) == 0 &&
                        std::memcmp(c.r.data(), a.r.data(), sizeof(float) * a.r.size()) == 0;
    // cross-correlation of (b) against (a) over the first beat (one beat at 128 bpm is 22500 samples), lag searched in +-200
    int lag = 0;
    {
      const size_t n = 22500;
      double best = -1e300;
      for (int k = -200; k <= 200; ++k) {
        double s = 0.0;
        for (size_t i = 300; i < n; ++i) s += static_cast<double>(a.l[i]) * b.l[i + k];
        if (s > best) { best = s; lag = k; }
      }
    }
    std::printf("3: peak a %.3f dBFS, b %.3f dBFS, c %.3f dBFS; limiter_db_max a %.3f b %.3f; pdc a %d b %d c %d; c vs a %s; onset a %zu b %zu c %zu; lag(b,a) %d\n", pa, pb, pc,
                a.limiter_db_max, b.limiter_db_max, a.pdc_latenz, b.pdc_latenz, c.pdc_latenz, gleich ? "bit-equal" : "DIFFERENT", erster(a), erster(b), erster(c), lag);
    std::printf("ZAHLEN3 {\"peak_a_dbfs\":%.4f,\"peak_b_dbfs\":%.4f,\"peak_c_dbfs\":%.4f,\"limiter_db_max_a\":%.4f,\"limiter_db_max_b\":%.4f,\"pdc_a\":%d,\"pdc_b\":%d,\"pdc_c\":%d,"
                "\"bit_equal_c_a\":%s,\"onset_a\":%zu,\"onset_b\":%zu,\"lag\":%d}\n",
                pa, pb, pc, a.limiter_db_max, b.limiter_db_max, a.pdc_latenz, b.pdc_latenz, c.pdc_latenz, gleich ? "true" : "false", erster(a), erster(b), lag);
    PRUEF(pa > 0.0);                          // the failure case exists: without the stage the master is over full scale
    PRUEF(pb <= -1.0 + 0.01);                 // the ceiling holds in the file
    PRUEF(b.limiter_db_max < a.limiter_db_max);   // the set limiter has less to take
    PRUEF(gleich);                            // bypassed stage: same file as without (74 samples delay, skipped by pdc_latenz)
    PRUEF(erster(b) == erster(a));            // on the grid
    PRUEF(lag == 0);
  }
  PRUEF_ENDE();
}
