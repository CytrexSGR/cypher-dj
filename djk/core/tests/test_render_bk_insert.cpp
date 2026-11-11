// arr-bk slice 3, the thin cut: a Baukasten effect graph as an insert stage of a track, rendered offline (tap `produktion`, the same Arrangement/ArrInserts code as the live core).
// The stock graph fx-echo-achtel (ping-pong delay, one eighth note) sits on a track that plays one impulse. The echo must come back exactly one eighth note later, at two tempi
// (the time follows the tempo: 120 BPM = 12000 samples, 90 BPM = 16000 samples), first on the left, then on the right at twice the time (ping-pong), then on the left at three times.
//   1  the first echo: sample distance to the dry impulse equals the eighth note of the tempo (+-1 sample), for 120 and 90 BPM
//   2  ping-pong: left at T, right at 2T, left at 3T; the right side is silent at T
//   3  the stage is a stage: with the row `an` at 0 the track equals the track without a stage bit for bit; a graph that is not an effect graph and one that is not there are refused
//      with the reason `format` and a message that names the graph (no silent export)
//   4  the knob k1 (echo mix, 0..0.7 over the knob) reaches the instance: mix 0 gives no echo, knob 1 gives a louder echo than the default
// Mutation (CMakeLists.txt): RENDER_OHNE_BK_ORDNER cannot be used here (it is the other test); INS_BK_WECHSEL_HART lives in test_arr_inserts_bk.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "arr_file.h"
#include "bk_help.h"
#include "cypherdj/render.h"
#include "check.h"

namespace fs = std::filesystem;

namespace {

constexpr int64_t IMPULS = 1000;   // the dry impulse sits at this frame of the audio file

std::string wiedergabe(int nr, const std::string& clip, const std::string& kette) {
  return "{\"format\":\"cypherdj-arr/2\",\"nr\":" + std::to_string(nr) + ",\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"master\"}" + kette + ",\"clips\":[" + clip +
         "]}],\"gruppen\":[],\"returns\":[]}";
}

cdj::RenderErgebnis render(const std::string& arr, const std::string& bk, int64_t nr, double bpm, const std::vector<cdj::SpurRegler>& regler) {
  cdj::RenderAuftrag r;
  r.arr_ordner = arr;
  r.nr = nr;
  r.von_beat = 0.0;
  r.bis_beat = 6.0;
  r.bpm = bpm;
  r.bk_ordner = bk;
  r.regler_projekt = true;
  r.spur_regler = regler;
  r.abgriff = cdj::RenderAbgriff::produktion;
  return cdj::rendere(r);
}

// the loudest sample of the window [a, b) of one channel, and its index
std::pair<int64_t, float> spitze(const std::vector<float>& x, int64_t a, int64_t b) {
  int64_t ix = a;
  float m = 0.0f;
  for (int64_t i = a; i < b && i < static_cast<int64_t>(x.size()); ++i)
    if (std::fabs(x[static_cast<size_t>(i)]) > m) {
      m = std::fabs(x[static_cast<size_t>(i)]);
      ix = i;
    }
  return {ix, m};
}

}  // namespace

int main() {
  arrdatei::Ordner o("test_render_bk_insert");
  const std::string bk = o.pfad + "/bk";
  fs::create_directories(bk);
  fs::copy_file(fs::path(CYPHERDJ_DJK) / "instruments/modular_dsp/demos/fx-echo-achtel.json", bk + "/fx-echo-achtel.json");
  fs::copy_file(fs::path(CYPHERDJ_DJK) / "instruments/modular_dsp/demos/fx-delay-sync.json", bk + "/fx-delay-sync.json");
  std::ofstream(bk + "/instrument.json") << bkt::G_T;   // an instrument graph: refused as an effect
  const int64_t frames = 400000;
  const std::string sha(64, 'b');
  {
    std::vector<float> d(static_cast<size_t>(frames) * 2, 0.0f);
    d[static_cast<size_t>(2 * IMPULS)] = d[static_cast<size_t>(2 * IMPULS + 1)] = 0.5f;
    std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary).write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  }
  const std::string clip = o.clip("c1", 0.0, 8.0, sha, frames);
  const auto kette = [](const char* graph) { return std::string(",\"chain\":[{\"art\":\"bk\",\"slot\":1,\"an\":true,\"graph\":\"") + graph + "\"}]"; };
  o.roh(1, wiedergabe(1, clip, ""));
  o.roh(2, wiedergabe(2, clip, kette("fx-echo-achtel")));
  o.roh(3, wiedergabe(3, clip, kette("instrument")));
  o.roh(4, wiedergabe(4, clip, kette("fehlt")));
  o.roh(5, wiedergabe(5, clip, kette("fx-delay-sync")));
  const auto zeilen = [](float an, float k1) { return std::vector<cdj::SpurRegler>{{"ins/bk/1/an", an}, {"ins/bk/1/k1", k1}}; };

  // 1 and 2: the echo at two tempi
  for (const double bpm : {120.0, 90.0}) {
    const cdj::RenderErgebnis e = render(o.pfad, bk, 2, bpm, zeilen(1.0f, 0.5f));
    PRUEF(e.fehler.empty());
    const int64_t t = static_cast<int64_t>(std::llround(0.5 * 60.0 / bpm * 48000.0));   // one eighth note in samples
    const auto [i0, p0] = spitze(e.l, 0, IMPULS + t / 2);                              // the dry impulse (the echo is not in this window)
    const auto [i1, p1] = spitze(e.l, i0 + t / 2, i0 + t + t / 2);
    const auto [r1, q1] = spitze(e.r, i0 + t / 2, i0 + t + t / 2);
    const auto [r2, q2] = spitze(e.r, i0 + t + t / 2, i0 + 2 * t + t / 2);
    const auto [i3, p3] = spitze(e.l, i0 + 2 * t + t / 2, i0 + 3 * t + t / 2);
    std::printf("%.0f BPM: expected %lld samples; dry at %lld (%.4f), left echo at +%lld (%.4f), right at T: %.6f, right at 2T: +%lld (%.4f), left at 3T: +%lld (%.4f)\n", bpm, static_cast<long long>(t),
                static_cast<long long>(i0), p0, static_cast<long long>(i1 - i0), p1, q1, static_cast<long long>(r2 - i0), q2, static_cast<long long>(i3 - i0), p3);
    PRUEF(p0 > 0.3f);   // 0.5 through the pan law of the track (-3 dB): 0.3536
    PRUEF(std::llabs((i0 - IMPULS)) <= 1);                 // the stage adds no delay (latency 0)
    PRUEF(p1 > 0.05f && std::llabs((i1 - i0) - t) <= 1);   // 1: the first echo is one eighth note later
    PRUEF(q1 < 1e-4f);                                      // 2: ping-pong, the right side is silent at T
    PRUEF(q2 > 0.01f && std::llabs((r2 - i0) - 2 * t) <= 1);
    PRUEF(p3 > 0.003f && std::llabs((i3 - i0) - 3 * t) <= 1);
  }
  // 3: the switch, and the refusals
  {
    const cdj::RenderErgebnis ref = render(o.pfad, bk, 1, 120.0, {});
    const cdj::RenderErgebnis aus = render(o.pfad, bk, 2, 120.0, zeilen(0.0f, 0.5f));
    PRUEF(ref.fehler.empty() && aus.fehler.empty() && ref.l.size() == aus.l.size());
    PRUEF(ref.l == aus.l && ref.r == aus.r);   // `an` 0: bit for bit the track without a stage
    const cdj::RenderErgebnis inst = render(o.pfad, bk, 3, 120.0, zeilen(1.0f, 0.5f));
    const cdj::RenderErgebnis fehlt = render(o.pfad, bk, 4, 120.0, zeilen(1.0f, 0.5f));
    std::printf("instrument graph: '%s' %s\nmissing graph: '%s' %s\n", inst.fehler.c_str(), inst.meldung.c_str(), fehlt.fehler.c_str(), fehlt.meldung.c_str());
    PRUEF(inst.fehler == "format" && inst.meldung.find("instrument") != std::string::npos && inst.meldung.find("effect graph is expected") != std::string::npos);
    // a graph file that is not in the folder does not fail the load: the stage plays dry (the signal passes through), here bit for bit the track without a stage
    PRUEF(fehlt.fehler.empty() && fehlt.l == ref.l && fehlt.r == ref.r);
    const cdj::RenderErgebnis ohne_ordner = render(o.pfad, "", 2, 120.0, zeilen(1.0f, 0.5f));
    PRUEF(ohne_ordner.fehler.empty() && ohne_ordner.l == ref.l);   // no graph folder: no file either, the stage plays dry
  }
  // 4: the knob
  {
    const int64_t t = 12000;
    const cdj::RenderErgebnis null = render(o.pfad, bk, 2, 120.0, zeilen(1.0f, 0.0f));
    const cdj::RenderErgebnis halb = render(o.pfad, bk, 2, 120.0, zeilen(1.0f, 0.5f));
    const cdj::RenderErgebnis voll = render(o.pfad, bk, 2, 120.0, zeilen(1.0f, 1.0f));
    const float a = spitze(null.l, IMPULS + t / 2, IMPULS + t + t / 2).second;
    const float b = spitze(halb.l, IMPULS + t / 2, IMPULS + t + t / 2).second;
    const float c = spitze(voll.l, IMPULS + t / 2, IMPULS + t + t / 2).second;
    std::printf("echo peak at k1 = 0: %.5f, 0.5: %.5f, 1: %.5f\n", a, b, c);
    PRUEF(a < 1e-5f && b > 0.05f && c > b * 1.5f);
  }
  // 5: the shipped delay of the effect return (arr-bk slice 4): wet only (the dry is subtracted inside the graph), a dotted eighth (0.75 beat) at two tempi, ping-pong, the Level knob scales it
  for (const double bpm : {120.0, 90.0}) {
    const cdj::RenderErgebnis e = render(o.pfad, bk, 5, bpm, zeilen(1.0f, 0.5f));
    PRUEF(e.fehler.empty());
    const int64_t t = static_cast<int64_t>(std::llround(0.75 * 60.0 / bpm * 48000.0));
    const float trocken_l = spitze(e.l, IMPULS - 8, IMPULS + 64).second, trocken_r = spitze(e.r, IMPULS - 8, IMPULS + 64).second;
    const auto [i1, p1] = spitze(e.l, IMPULS + t / 2, IMPULS + t + t / 2);
    const float q1 = spitze(e.r, IMPULS + t / 2, IMPULS + t + t / 2).second;
    const auto [r2, q2] = spitze(e.r, IMPULS + t + t / 2, IMPULS + 2 * t + t / 2);
    std::printf("fx-delay-sync %.0f BPM: expected %lld samples; dry part L %.6f R %.6f, left echo at +%lld (%.4f), right at T %.6f, right at 2T +%lld (%.4f)\n", bpm, static_cast<long long>(t), trocken_l,
                trocken_r, static_cast<long long>(i1 - IMPULS), p1, q1, static_cast<long long>(r2 - IMPULS), q2);
    PRUEF(trocken_l < 1e-5f && trocken_r < 1e-5f);                 // wet only: the dry impulse is gone
    PRUEF(p1 > 0.05f && std::llabs((i1 - IMPULS) - t) <= 1);       // the dotted eighth of the tempo
    PRUEF(q1 < 1e-4f && q2 > 0.01f && std::llabs((r2 - IMPULS) - 2 * t) <= 1);
  }
  PRUEF_ENDE();
}
