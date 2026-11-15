// Initial mute of a playback (`stumm_start` on a track of cypherdj-arr/2): the swap that loads it starts the track muted in the block of the swap, with no fade from the old state,
// and the mixer row of the track shows the muted value. Live modules use it so that the loop track goes silent in the very block in which the stems come in (card t_7e463bcc).
//  1 kein_doppelt   playback 1 plays track 1; playback 2 holds the same content on track 1 (stumm_start) and on track 2: across the swap the master never exceeds the louder of the two
//                   alone by more than 0.5 dB (no doubled block); the row spur/1/mute reads 1 after the swap
//  2 gegenprobe     the same swap without stumm_start doubles the level for the mute fade at least (positive control: the test sees a doubled block)
//  3 ohne_feld      a playback without the field behaves as before: no mute row is written
//  4 format         `stumm_start` in a /1 file or that is not a boolean is refused with `format`
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

#include "arr_run.h"

bool g_waechter = false;

using k35::N;
using k35::SPB;

namespace {

float spitze(const std::vector<float>& x, int64_t von, int64_t bis) {
  float m = 0.0f;
  for (int64_t i = von; i < bis && i < static_cast<int64_t>(x.size()); ++i) m = std::max(m, std::fabs(x[static_cast<size_t>(i)]));
  return m;
}

constexpr int64_t FRAMES = 20 * SPB;

// a stereo sine of 441 Hz (a steady signal with no DC: the master chain does not ring on it) in the audio folder of the run; returns its sha text
std::string sinus(arr35::Lauf& x) {
  const std::string sha(64, 'e');
  std::vector<float> d(static_cast<size_t>(FRAMES) * 2);
  for (int64_t i = 0; i < FRAMES; ++i) d[static_cast<size_t>(2 * i)] = d[static_cast<size_t>(2 * i + 1)] = 0.4f * static_cast<float>(std::sin(2.0 * 3.14159265358979 * 441.0 * static_cast<double>(i) / 48000.0));
  std::ofstream(x.ordner.pfad + "/audio/" + sha + ".f32", std::ios::binary).write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return sha;
}

std::string spur(arr35::Lauf& x, int nr, const std::string& sha, bool stumm) {
  return "{\"nr\":" + std::to_string(nr) + ",\"art\":\"audio\"" + (stumm ? ",\"stumm_start\":true" : "") + ",\"clips\":[" +
         x.ordner.clip(("c" + std::to_string(nr)).c_str(), 0.0, 16.0, sha, FRAMES) + "]}";
}

struct Lauf1 {
  float vorher = 0.0f, rund = 0.0f;   // steady level before the swap, peak from the swap on
  std::vector<cdj::Ereignis> reihen;
  int64_t tausch = -1;
};

// playback 1 (track 1) plays for two beats, then playback 2 swaps in; `zwei`: the tracks of playback 2 as text, nr 1 and nr 2 given by the caller
Lauf1 lauf(const std::string& ab, bool nur2, bool stumm, bool feld) {
  Lauf1 r;
  arr35::Lauf x(ab, "test_kern_arr_stumm_start");
  const std::string a = sinus(x);
  x.laden(1, spur(x, nur2 ? 2 : 1, a, false), "andreas", true);
  x.lauf(4 * N);
  x.start(0.0, 0);
  x.lauf(2 * SPB);
  r.vorher = spitze(x.l, SPB, 2 * SPB);
  r.tausch = x.kern->sample();
  if (feld) x.laden(2, spur(x, 1, a, stumm) + "," + spur(x, 2, a, false), "andreas", true);
  x.lauf(3 * SPB);
  r.rund = spitze(x.l, r.tausch, 3 * SPB);
  r.reihen = x.alle(cdj::Ereignis::REGLER, "spur/1/mute");
  return r;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_arr_stumm_start");
  // references: track 1 alone, track 2 alone (never swapped)
  const float a = [&] { arr35::Lauf x(ab.pfad, "test_kern_arr_stumm_start"); x.laden(1, spur(x, 1, sinus(x), false), "andreas", true); x.lauf(4 * N); x.start(0.0, 0); x.lauf(3 * SPB); return spitze(x.l, SPB, 3 * SPB); }();
  PRUEF(a > 0.05f);   // positive control: the reference sounds
  const float grenze = a * std::pow(10.0f, 0.5f / 20.0f);
  {  // 1 kein_doppelt
    const Lauf1 r = lauf(ab.pfad, false, true, true);
    std::printf("1: reference %.5f, limit %.5f, steady before the swap %.5f, peak from the swap on %.5f, mute rows %zu\n", a, grenze, r.vorher, r.rund, r.reihen.size());
    PRUEF(r.rund <= grenze);
    PRUEF(r.rund > 0.9f * a);   // the stems did come in (no silence)
    float zuletzt = -1.0f;
    for (const cdj::Ereignis& e : r.reihen)
      if (e.sample >= r.tausch) zuletzt = e.wert;
    PRUEF(zuletzt == 1.0f);   // the row reads muted
  }
  {  // 2 gegenprobe
    const Lauf1 r = lauf(ab.pfad, false, false, true);
    std::printf("2: without stumm_start the peak is %.5f (reference %.5f)\n", r.rund, a);
    PRUEF(r.rund > 1.5f * a);
    for (const cdj::Ereignis& e : r.reihen) PRUEF(!(e.sample >= r.tausch && e.wert == 1.0f));
  }
  {  // 3 ohne_feld: no swap at all, no mute row
    const Lauf1 r = lauf(ab.pfad, false, false, false);
    PRUEF(r.reihen.empty());
  }
  {  // 4 format
    arr35::Lauf x(ab.pfad, "test_kern_arr_stumm_start");
    const std::string a2 = sinus(x);
    const std::string clip = x.ordner.clip("c1", 0.0, 4.0, a2, FRAMES);
    x.ordner.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"stumm_start\":true,\"clips\":[" + clip + "]}");   // /1
    const cdj::ArrLadeErgebnis e1 = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
    PRUEF(!e1.snap && e1.grund == "format" && e1.meldung.find("stumm_start") != std::string::npos);
    x.ordner.wiedergabe2_warp(1, "{\"nr\":1,\"art\":\"audio\",\"stumm_start\":1,\"clips\":[" + clip + "]}");
    const cdj::ArrLadeErgebnis e2 = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
    PRUEF(!e2.snap && e2.grund == "format" && e2.meldung.find("stumm_start") != std::string::npos);
    x.ordner.wiedergabe2_warp(1, "{\"nr\":1,\"art\":\"audio\",\"stumm_start\":true,\"clips\":[" + clip + "]}");
    cdj::ArrLadeErgebnis e3 = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
    PRUEF(e3.snap && e3.snap->spur[0].stumm_start);
    if (e3.snap) cdj::gib_wiedergabe(e3.snap.release(), x.cache);
  }
  PRUEF_ENDE();
}
