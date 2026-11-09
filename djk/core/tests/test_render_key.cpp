// 1.10 slice 5 U2b (plan E7): DJ keys are live only. An export has no deck signal: Kern::audio always hands the DJ input pointers to the arrangement, and in the render those inputs are silent by
// construction (render.cpp drives Kern::zyklus, no deck plays, no Strudel stream). Two production stages are keyed deck/1 and erz/1; the render must show no reduction and be bit-equal to the same project
// without any key. Positive control: the same stage keyed by a loud track ducks the bass by >= 6 dB in the same render path (so a silent result is not a silent project).
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "arr_file.h"
#include "cypherdj/render.h"
#include "check.h"

namespace {
double rms_db(const cdj::RenderErgebnis& e) {
  double q = 0.0;
  for (size_t i = 0; i < e.l.size(); ++i) q += static_cast<double>(e.l[i]) * e.l[i] + static_cast<double>(e.r[i]) * e.r[i];
  return 10.0 * std::log10(q / static_cast<double>(2 * e.l.size()) + 1e-20);
}
}  // namespace

int main() {
  arrdatei::Ordner o("test_render_schluessel");
  const std::string bass = o.sinus('a', 400000, 220.0, 0.01f);    // -40 dBFS: below the threshold of its own detector, so a stage on it reduces only when the key is loud
  const std::string laut = o.sinus('b', 400000, 1000.0, 0.5f);
  const auto spur = [&](int nr, const std::string& sha, const std::string& kette) {
    return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\"" + (kette.empty() ? "" : ",\"chain\":[" + kette + "]") + ",\"clips\":[" + o.clip(("c" + std::to_string(nr)).c_str(), 0.0, 16.0, sha, 400000) + "]}";
  };
  const auto stufe = [](int slot, const std::string& key) { return "{\"art\":\"komp\",\"slot\":" + std::to_string(slot) + (key.empty() ? "" : ",\"key\":" + key) + "}"; };
  // 1: deck/1 on track 1, erz/1 on track 2.  2: no keys.  3: the positive control, the stage of track 1 keyed by the row sc = track 3 (loud, fader down: the key is taken before the fader).
  o.roh(1, "{\"format\":\"cypherdj-arr/2\",\"nr\":1,\"spuren\":[" + spur(1, bass, stufe(1, "{\"q\":\"deck\",\"nr\":1}")) + "," + spur(2, bass, stufe(2, "{\"q\":\"erz\",\"nr\":1}")) + "],\"gruppen\":[]}");
  o.roh(2, "{\"format\":\"cypherdj-arr/2\",\"nr\":2,\"spuren\":[" + spur(1, bass, stufe(1, "")) + "," + spur(2, bass, stufe(2, "")) + "],\"gruppen\":[]}");
  o.roh(3, "{\"format\":\"cypherdj-arr/2\",\"nr\":3,\"spuren\":[" + spur(1, bass, stufe(1, "")) + "," + spur(2, bass, stufe(2, "")) + "," + spur(3, laut, "") +
                "],\"gruppen\":[]}");
  std::vector<cdj::SpurRegler> regler;
  for (int s = 1; s <= 3; ++s) {
    const std::string p = "spur/" + std::to_string(s) + "/";
    regler.push_back({p + "fader", s == 3 ? -200.0f : 0.0f});
    regler.push_back({p + "pan", 0.0f});
    regler.push_back({p + "mute", 0.0f});
    regler.push_back({p + "solo", 0.0f});
  }
  for (int sl = 1; sl <= 2; ++sl) {
    const std::string p = "ins/komp/" + std::to_string(sl) + "/";
    const std::pair<const char*, float> zeilen[] = {{"schwelle", -30.0f}, {"ratio", 8.0f}, {"knie", 0.0f}, {"attack", 1.0f}, {"release", 50.0f}, {"makeup", 0.0f}, {"mix", 1.0f}, {"schp", 0.0f}, {"sc", 0.0f}, {"an", 1.0f}};
    for (const auto& z : zeilen) regler.push_back({p + z.first, z.second});
  }
  const auto render = [&](int nr) {
    cdj::RenderAuftrag r;
    r.arr_ordner = o.pfad;
    r.nr = nr;
    r.von_beat = 0.0;
    r.bis_beat = 8.0;
    r.bpm = 128.0;
    r.regler_projekt = true;
    r.spur_regler = regler;
    if (nr == 3)
      for (cdj::SpurRegler& z : r.spur_regler)
        if (z.pfad == "ins/komp/1/sc") z.wert = 3.0f;
    r.abgriff = cdj::RenderAbgriff::produktion;
    return cdj::rendere(r);
  };
  const cdj::RenderErgebnis mit = render(1), ohne = render(2), kontrolle = render(3);
  std::printf("render: deck/1 + erz/1 keyed: %s%s, frames %lld; no keys: %s, frames %lld; control (track 3 key): %s\n", mit.fehler.c_str(), mit.meldung.c_str(), static_cast<long long>(mit.frames), ohne.fehler.c_str(),
              static_cast<long long>(ohne.frames), kontrolle.fehler.c_str());
  PRUEF(mit.fehler.empty() && ohne.fehler.empty() && kontrolle.fehler.empty());
  PRUEF(mit.frames > 0 && mit.frames == ohne.frames && mit.l.size() == ohne.l.size() && mit.r.size() == ohne.r.size());
  const bool gleich = mit.l.size() == ohne.l.size() && std::memcmp(mit.l.data(), ohne.l.data(), mit.l.size() * sizeof(float)) == 0 && std::memcmp(mit.r.data(), ohne.r.data(), mit.r.size() * sizeof(float)) == 0;
  const double d_mit = rms_db(mit), d_ohne = rms_db(ohne), d_kontrolle = rms_db(kontrolle);
  std::printf("render: RMS with the DJ keys %.3f dBFS, without keys %.3f dBFS (bit-equal: %s); control with a loud key on track 1: %.3f dBFS (reduction %.2f dB)\n", d_mit, d_ohne, gleich ? "yes" : "NO", d_kontrolle,
              d_ohne - d_kontrolle);
  PRUEF(d_ohne > -60.0 && d_ohne < -30.0);       // there is a bass in the render (two sines of -40 dBFS peak), not silence
  PRUEF(gleich);                                 // a DJ key with a silent input does nothing in the export
  PRUEF(d_ohne - d_kontrolle >= 3.0);            // positive control: the stage of track 1 ducked by a loud key (one of two equal tracks: about 5 dB on the sum)
  PRUEF_ENDE();
}
