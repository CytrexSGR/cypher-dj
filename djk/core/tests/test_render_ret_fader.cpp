// Return fader lane (slice 2 of the return automation), task 3: export = playing. "Live" is a core in the process (arr35::Lauf) with a playback /3 (track 1: noise
// into return 1 over a pre send, the direct path silent; return 1 carries a fader lane, no Hall); its master is recorded through the ring head as in operation.
// "Render" is rendere() with the restart tray of the live core. Expected (form of test_arr_auto_null):
//   1. main probe: the lane runs from mute (-200 dB) to 0 dB over 16 beats: rest under -90 dB (NULL_SCHWELLE_DB) at 128 and at 120 BPM.
//   2. counter-check: a lane with a jump (-10 | -40 dB at beat 8) on the return. With gegenprobe_auto the render shifts all points by one sample: red; the same
//      set-up without it passes (negative control). The counter-check without any lane is refused (grund gegenprobe): a return lane counts as a lane.
//   3. negative control: a render of the playback WITHOUT the lane against the live run WITH it is red.
//   4. a /2 project with two returns and no return lane renders bit-identically to the code before the return slots: the hash of the output was taken with the
//      code before this slice (render_ohne_ret_lane_bitgleich).
// Mutation RENDER_GEGENPROBE_AUTO_BLIND: case 2 goes red.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <tuple>
#include <vector>

#include "arr_build.h"
#include "arr_run.h"
#include "cypherdj/null_test.h"
#include "cypherdj/render.h"
#include "cypherdj/ring_capture.h"
#include "cypherdj/state.h"

bool g_waechter = false;

using k35::N;

namespace {

using Lane = std::vector<std::tuple<double, double, int>>;

std::string rauschen(const arrdatei::Ordner& o, char z, int64_t frames) {
  const std::string sha(64, z);
  std::vector<float> d(static_cast<size_t>(frames) * 2);
  uint32_t x = 12345u + static_cast<uint32_t>(z);
  for (float& v : d) {
    x = x * 1664525u + 1013904223u;
    v = 0.2f * (static_cast<float>(x >> 8) / 8388608.0f - 1.0f);
  }
  std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary)
      .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
  return sha;
}

void start_tempo(arr35::Lauf& x, double bpm) {
  PRUEF(x.kern->sample() == 0);
  x.kern.reset(new cdj::Kern(bpm, x.ring, x.bef.get(), x.ere.get()));
  x.kern->verbinde_lader(x.lr.get());
  x.kern->setze_pruefmodus(false);
  x.vh = x.kern->mixer().limiter_vorhalt();
}

std::string spur_text(const arrdatei::Ordner& o, double bpm) {
  const int64_t spb = static_cast<int64_t>(std::ceil(48000.0 * 60.0 / bpm));
  const std::string a = rauschen(o, 'd', 18 * spb);
  return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 17.0, a, 18 * spb) + "]}";
}
// return 1 over a pre send; `lane` empty: no lane
std::string returns_text(const Lane& lane) {
  return std::string("{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"pre\":true") + (lane.empty() ? "" : ",\"auto\":[" + arrdatei::Ordner::auto_lane(lane) + "]") + "}";
}
const char* format_von(const Lane& lane) { return lane.empty() ? "cypherdj-arr/2" : "cypherdj-arr/3"; }

void schreibe(arrdatei::Ordner& o, double bpm, const Lane& lane) { o.wiedergabe2_ret(1, spur_text(o, bpm), "", returns_text(lane), format_von(lane)); }

int64_t lade_ret(arr35::Lauf& x, double bpm, const Lane& lane) {
  schreibe(x.ordner, bpm, lane);
  cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
  PRUEF(e.snap != nullptr);
  if (!e.snap) return -1;
  cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  b.zeiger = e.snap.release();
  b.arr_nr = 1;
  return x.sende(b);
}

struct Live {
  cdj::RingMitschnitt m;
  int64_t ursprung = -1;
  std::unique_ptr<cdj_z_echtzeit> fach{new cdj_z_echtzeit()};
};

Live live_lauf(arr35::Lauf& x, double bpm, int beats) {
  Live v;
  const int64_t spb = static_cast<int64_t>(std::ceil(48000.0 * 60.0 / bpm));
  cdj::RingLeser leser(x.ring);
  x.lauf(x.kern->sample() + 37 * N);
  PRUEF(leser.lies(v.m));
  const int64_t id = x.start(0.0, 0);
  const int64_t frist = x.kern->sample() + 20 * spb;
  while ((v.ursprung < 0 && x.kern->sample() < frist) || (v.ursprung >= 0 && x.kern->sample() < v.ursprung + (beats + 2) * spb)) {
    x.lauf(x.kern->sample() + N);
    PRUEF(leser.lies(v.m));
    if (v.ursprung < 0 && x.quittung(id, 2)) v.ursprung = x.quittung(id, 2)->sample;
  }
  x.kern->abbild(*v.fach);
  return v;
}

cdj::NullErgebnis vergleiche(const Live& v, const cdj::RenderErgebnis& r) {
  const int64_t ab = v.ursprung + r.vorhalt - v.m.s0;
  const int64_t n_live = static_cast<int64_t>(v.m.l.size()) - ab;
  PRUEF(ab >= 0 && n_live > 0);
  if (!(ab >= 0 && n_live > 0)) return cdj::NullErgebnis{};
  return cdj::null_vergleich(v.m.l.data() + ab, v.m.r.data() + ab, n_live, r.l.data(), r.r.data(), static_cast<int64_t>(r.l.size()), r.frames);
}

cdj::RenderAuftrag auftrag(const arr35::Lauf& x, const Live& v, double bpm) {
  cdj::RenderAuftrag auf;
  auf.arr_ordner = x.ordner.pfad;
  auf.nr = 1;
  auf.von_beat = 0.0;
  auf.bis_beat = 16.0;
  auf.bpm = bpm;
  auf.quantum = N;
  auf.regler = v.fach.get();
  return auf;
}

struct Lauf1 {
  std::unique_ptr<arr35::Lauf> x;
  Live v;
};
Lauf1 aufbau(const std::string& ab, const char* name, double bpm, const Lane& lane) {
  Lauf1 l;
  l.x.reset(new arr35::Lauf(ab, name));
  start_tempo(*l.x, bpm);
  l.x->teil("spur/1/fader", -200.0f, 0.0, 0.0);   // the direct path is silent: the pre send into return 1 carries the track
  l.x->teil("spur/1/send/1", 0.0f, 0.0, 0.0);
  l.x->teil("ret/1/fader", 0.0f, 0.0, 0.0);
  l.x->teil("ret/1/hall/an", 0.0f, 0.0, 0.0);     // no Hall: the return passes its input dry
  lade_ret(*l.x, bpm, lane);
  l.v = live_lauf(*l.x, bpm, 16);
  PRUEF(l.v.ursprung > 0 && l.v.m.fehler.empty());
  return l;
}

uint64_t hash_von(const cdj::RenderErgebnis& r) {
  uint64_t h = 1469598103934665603ULL;
  for (const std::vector<float>* v : {&r.l, &r.r})
    for (float f : *v) {
      uint32_t u;
      std::memcpy(&u, &f, 4);
      for (int i = 0; i < 4; ++i) {
        h ^= (u >> (8 * i)) & 0xff;
        h *= 1099511628211ULL;
      }
    }
  return h;
}
// the pinned output of case 4, taken with the code before the return slots (see the commit message)
constexpr uint64_t HASH_RENDER_OHNE_RET_LANE_VOR = 0x97c674a6c8c8a8f6ULL;

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_render_ret_fader");
  const Lane rampe = {{0.0, -200.0, 0}, {16.0, 0.0, 0}};
  const Lane sprung = {{2.0, 0.0, 0}, {8.0, -10.0, 0}, {8.0, -40.0, 0}, {14.0, -50.0, 0}};
  for (double bpm : {128.0, 120.0}) {
    // 1. main probe
    Lauf1 l = aufbau(ab.pfad, bpm == 128.0 ? "test_render_ret_fader_r128" : "test_render_ret_fader_r120", bpm, rampe);
    const cdj::RenderErgebnis r = cdj::rendere(auftrag(*l.x, l.v, bpm));
    if (!r.fehler.empty()) std::printf("render error: %s: %s\n", r.fehler.c_str(), r.meldung.c_str());
    PRUEF(r.fehler.empty() && r.regler > 0 && r.phase == 0);
    PRUEF(r.frames == std::llround(16.0 * 48000.0 * 60.0 / bpm));
    const cdj::NullErgebnis e = vergleiche(l.v, r);
    std::printf("case 1 (return ramp, %.0f BPM): %s rest %.1f dB, signal %.1f dB\n", bpm, cdj::null_urteil_text(e.urteil), e.rest_db, e.signal_db);
    PRUEF(e.urteil == cdj::NullUrteil::bestanden && e.rest_db < cdj::NULL_SCHWELLE_DB && e.signal_db > -30.0);
    // positive control: the lane is really heard. The first beat (about -60 dB) is far below the last (0 dB): the render itself shows the ramp
    const int64_t spb = static_cast<int64_t>(std::ceil(48000.0 * 60.0 / bpm));
    auto rms = [&](int64_t von, int64_t n) {
      double q = 0.0;
      for (int64_t i = von; i < von + n; ++i) q += static_cast<double>(r.l[i]) * r.l[i];
      return 10.0 * std::log10(q / static_cast<double>(n) + 1e-30);
    };
    const double erste = rms(0, spb), letzte = rms(14 * spb, spb);
    std::printf("case 1: render rms in beat 1 %.1f dB, in beat 15 %.1f dB\n", erste, letzte);
    PRUEF(letzte - erste > 30.0);
  }
  for (double bpm : {128.0, 120.0}) {
    // 2. counter-check lane with the jump, on the return
    Lauf1 l = aufbau(ab.pfad, bpm == 128.0 ? "test_render_ret_fader_s128" : "test_render_ret_fader_s120", bpm, sprung);
    const cdj::NullErgebnis gleich = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, bpm)));
    cdj::RenderAuftrag g = auftrag(*l.x, l.v, bpm);
    g.gegenprobe_auto = true;
    const cdj::RenderErgebnis rg = cdj::rendere(g);
    PRUEF(rg.fehler.empty());
    const cdj::NullErgebnis e = vergleiche(l.v, rg);
    std::printf("case 2 (jump, %.0f BPM): without counter-check %s rest %.1f dB signal %.1f dB, with it %s rest %.1f dB\n", bpm, cdj::null_urteil_text(gleich.urteil),
                gleich.rest_db, gleich.signal_db, cdj::null_urteil_text(e.urteil), e.rest_db);
    PRUEF(gleich.urteil == cdj::NullUrteil::bestanden && gleich.rest_db < cdj::NULL_SCHWELLE_DB && gleich.signal_db > -30.0);   // negative control
    PRUEF(e.urteil == cdj::NullUrteil::rot && e.rest_db >= cdj::NULL_SCHWELLE_DB);
    // 3. negative control: the render without the lane against the live run with it
    schreibe(l.x->ordner, bpm, {});
    const cdj::NullErgebnis ohne = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, bpm)));
    std::printf("case 3 (render without the lane against live with it, %.0f BPM): %s rest %.1f dB\n", bpm, cdj::null_urteil_text(ohne.urteil), ohne.rest_db);
    PRUEF(ohne.urteil == cdj::NullUrteil::rot && ohne.rest_db > -40.0);
    // the counter-check without any lane in the file is refused with grund gegenprobe
    cdj::RenderAuftrag k = auftrag(*l.x, l.v, bpm);
    k.gegenprobe_auto = true;
    const cdj::RenderErgebnis rk = cdj::rendere(k);
    PRUEF(rk.fehler == "gegenprobe");
  }
  {  // 4. render_ohne_ret_lane_bitgleich: a /2 project with returns and no return lane: tracks with a fader lane, sends into two returns, a Hall on return 2
    arrdatei::Ordner o("test_render_ret_fader_h");
    const std::string spb_text = spur_text(o, 128.0);
    const int64_t spb = static_cast<int64_t>(std::ceil(48000.0 * 60.0 / 128.0));
    const std::string sha = rauschen(o, 'e', 18 * spb);
    const std::string s2 = "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + o.clip("c2", 0.0, 17.0, sha, 18 * spb) + "]}";
    const std::string s1 = spb_text.substr(0, spb_text.size() - 1) + ",\"auto\":[" + arrdatei::Ordner::auto_lane({{0.0, 0.0, 0}, {8.0, -18.0, 0}, {12.0, -3.0, 1}}) + "]}";
    o.wiedergabe2_ret(1, s1 + "," + s2, "", "{\"nr\":1,\"ausgang\":{\"art\":\"master\"},\"pre\":true},{\"nr\":2,\"ausgang\":{\"art\":\"master\"}}");
    cdj::RenderAuftrag a;
    a.arr_ordner = o.pfad;
    a.nr = 1;
    a.von_beat = 0.0;
    a.bis_beat = 8.0;
    a.bpm = 128.0;
    a.regler_projekt = true;
    a.spur_regler = {{"spur/1/send/1", -6.0f}, {"spur/2/send/1", -9.0f}, {"spur/2/send/2", -3.0f}, {"ret/1/fader", -3.0f}, {"ret/1/hall/an", 0.0f}};
    const cdj::RenderErgebnis r = cdj::rendere(a);
    PRUEF(r.fehler.empty() && r.frames > 0);
    double spitze = 0.0;
    for (float f : r.l) spitze = std::max(spitze, static_cast<double>(std::fabs(f)));
    const uint64_t h = hash_von(r);
    std::printf("case 4: render without a return lane: hash %016llx, peak %.3f, %lld frames\n", static_cast<unsigned long long>(h), spitze, static_cast<long long>(r.frames));
    PRUEF(spitze > 0.05);   // not silence
    PRUEF(h == HASH_RENDER_OHNE_RET_LANE_VOR);
  }
  PRUEF_ENDE();
}
