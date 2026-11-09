// Automation Slice 1, task 7 (AK8): export = playing, with a fader lane. "Live" is a core in the process (arr35::Lauf) with a playback /2 (track 1: noise,
// a lane on the fader, loop bracket OFF: the render knows no bracket, plan A6); its master is recorded through the ring head as in operation. "Render" is
// rendere() with the restart tray of the live core. Expected (form of test_arr_warp_null):
//   1. main probe, ramp: fader lane 0 -> -30 dB over beats 2..14: rest under -90 dB (NULL_SCHWELLE_DB) at 128 and at 120 BPM.
//   2. why the ramp alone is not enough (the review's calculation, written into the test): a shift of 1 sample at 30 dB over 12 beats (5.6 s at 128 BPM) leaves
//      a rest of about -103.9 dBFS (120 BPM: -104.5), UNDER the threshold. A counter-check on this lane alone would stay green and prove nothing. The test holds the
//      measured number and so asks for a counter-check lane with a jump.
//   3. counter-check lane: the ramp plus a jump (two points at beat 8: -10 | -40 dB). With gegenprobe_auto the render shifts all points by one sample: rest at or
//      above -90 dB, red; the same set-up without gegenprobe_auto passes (negative control: the jump alone does not make the run red).
//   4. silence in both runs is "invalid", not "passed" (lane -200 dB all the way).
//   5. negative control: a render of a playback WITHOUT the lane against the live run WITH it is red (rest far above -90 dB).
// Mutation RENDER_GEGENPROBE_AUTO_BLIND (the counter-check does not touch a lane): case 3 goes red (the counter-check stays green = blind).
#include <algorithm>
#include <cmath>
#include <cstdint>
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

// noise (fixed sequence), peak 0.2: every shift by 1 sample shows in the rest
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

// lanes_json: the comma separated lane objects of the "auto" array (empty: no lane)
std::string spur_text_roh(const arrdatei::Ordner& o, double bpm, const std::string& lanes_json) {
  const int64_t spb = static_cast<int64_t>(std::ceil(48000.0 * 60.0 / bpm));
  const std::string a = rauschen(o, 'd', 18 * spb);
  const std::string auto_teil = lanes_json.empty() ? "" : ",\"auto\":[" + lanes_json + "]";
  return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 17.0, a, 18 * spb) + "]" + auto_teil + "}";
}

std::string spur_text(const arrdatei::Ordner& o, double bpm, const Lane& lane) {
  return spur_text_roh(o, bpm, lane.empty() ? "" : arrdatei::Ordner::auto_lane(lane));
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
Lauf1 aufbau_roh(const std::string& ab, const char* name, double bpm, const std::string& lanes_json) {
  Lauf1 l;
  l.x.reset(new arr35::Lauf(ab, name));
  start_tempo(*l.x, bpm);
  l.x->laden(1, spur_text_roh(l.x->ordner, bpm, lanes_json), "andreas", true);
  l.v = live_lauf(*l.x, bpm, 16);
  PRUEF(l.v.ursprung > 0 && l.v.m.fehler.empty());
  return l;
}
Lauf1 aufbau(const std::string& ab, const char* name, double bpm, const Lane& lane) {
  return aufbau_roh(ab, name, bpm, lane.empty() ? "" : arrdatei::Ordner::auto_lane(lane));
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_arr_auto_null");
  const Lane rampe = {{2.0, 0.0, 0}, {14.0, -30.0, 0}};
  const Lane sprung = {{2.0, 0.0, 0}, {8.0, -10.0, 0}, {8.0, -40.0, 0}, {14.0, -50.0, 0}};
  double rest_ohne_sprung[2] = {0, 0};
  int ib = 0;
  for (double bpm : {128.0, 120.0}) {
    // 1. main probe, ramp
    Lauf1 l = aufbau(ab.pfad, bpm == 128.0 ? "test_arr_auto_null_r128" : "test_arr_auto_null_r120", bpm, rampe);
    const cdj::RenderErgebnis r = cdj::rendere(auftrag(*l.x, l.v, bpm));
    if (!r.fehler.empty()) std::printf("Render-Fehler: %s: %s\n", r.fehler.c_str(), r.meldung.c_str());
    PRUEF(r.fehler.empty() && r.regler > 0 && r.phase == 25);
    PRUEF(r.frames == std::llround(16.0 * 48000.0 * 60.0 / bpm));
    const cdj::NullErgebnis e = vergleiche(l.v, r);
    std::printf("Fall 1 (Rampe, %.0f BPM): %s rest %.1f dB, signal %.1f dB\n", bpm, cdj::null_urteil_text(e.urteil), e.rest_db, e.signal_db);
    PRUEF(e.urteil == cdj::NullUrteil::bestanden && e.rest_db < cdj::NULL_SCHWELLE_DB && e.signal_db > -20.0);
    // 2. the counter-check on the ramp alone: the rest of one sample stays UNDER the threshold (the measured number)
    cdj::RenderAuftrag g = auftrag(*l.x, l.v, bpm);
    g.gegenprobe_auto = true;
    const cdj::RenderErgebnis rg = cdj::rendere(g);
    PRUEF(rg.fehler.empty());
    const cdj::NullErgebnis eg = vergleiche(l.v, rg);
    rest_ohne_sprung[ib++] = eg.rest_db;
    std::printf("Fall 2 (Gegenprobe nur auf der Rampe, %.0f BPM): %s rest %.1f dB (unter der Schwelle: die Rampe allein beweist nichts)\n", bpm,
                cdj::null_urteil_text(eg.urteil), eg.rest_db);
    PRUEF(eg.rest_db < cdj::NULL_SCHWELLE_DB && eg.rest_db > -115.0);
  }
  for (double bpm : {128.0, 120.0}) {
    // 3. counter-check lane with the jump
    Lauf1 l = aufbau(ab.pfad, bpm == 128.0 ? "test_arr_auto_null_s128" : "test_arr_auto_null_s120", bpm, sprung);
    const cdj::NullErgebnis gleich = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, bpm)));
    cdj::RenderAuftrag g = auftrag(*l.x, l.v, bpm);
    g.gegenprobe_auto = true;
    const cdj::RenderErgebnis rg = cdj::rendere(g);
    PRUEF(rg.fehler.empty());
    const cdj::NullErgebnis e = vergleiche(l.v, rg);
    std::printf("Fall 3 (Sprung, %.0f BPM): ohne Gegenprobe %s rest %.1f dB, mit Gegenprobe %s rest %.1f dB\n", bpm, cdj::null_urteil_text(gleich.urteil),
                gleich.rest_db, cdj::null_urteil_text(e.urteil), e.rest_db);
    PRUEF(gleich.urteil == cdj::NullUrteil::bestanden && gleich.rest_db < cdj::NULL_SCHWELLE_DB);   // negative control
    PRUEF(e.urteil == cdj::NullUrteil::rot && e.rest_db >= cdj::NULL_SCHWELLE_DB);
    // 5. negative control: the render without the lane against the live run with it
    l.x->ordner.wiedergabe2_warp(1, spur_text(l.x->ordner, bpm, {}));
    const cdj::NullErgebnis ohne = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, bpm)));
    std::printf("Fall 5 (Render ohne Lane gegen Live mit Lane, %.0f BPM): %s rest %.1f dB\n", bpm, cdj::null_urteil_text(ohne.urteil), ohne.rest_db);
    PRUEF(ohne.urteil == cdj::NullUrteil::rot && ohne.rest_db > -40.0);
    // the counter-check without any lane in the file is refused with grund gegenprobe
    cdj::RenderAuftrag k = auftrag(*l.x, l.v, bpm);
    k.gegenprobe_auto = true;
    const cdj::RenderErgebnis rk = cdj::rendere(k);
    PRUEF(rk.fehler == "gegenprobe");
  }
  {  // 6. slice 2: pan and mute lanes. Each case: the same set-up without the counter-check passes (negative control), with gegenprobe_auto (all points one
     // sample later, pan and mute included) it is red. A pan jump moves one sample of both channels by the whole step; a mute jump moves a 480-sample
     // linear fade by one sample. Under the mutation RENDER_GEGENPROBE_AUTO_BLIND the counter-check stays green and these cases go red as well.
    using O = arrdatei::Ordner;
    const Lane pan_sprung = {{0.0, -1.0, 0}, {8.0, 1.0, 2}};
    const Lane mute_sprung = {{0.0, 0.0, 2}, {8.0, 1.0, 2}, {11.0, 0.0, 2}};
    const struct { const char* name; std::string lanes; } faelle[] = {
        {"pan", O::auto_lane(pan_sprung, "pan")},
        {"mute", O::auto_lane(mute_sprung, "mute")},
        {"fader+pan+mute", O::auto_lane(rampe) + "," + O::auto_lane(pan_sprung, "pan") + "," + O::auto_lane(mute_sprung, "mute")}};
    int fall = 0;
    for (const auto& f : faelle) {
      Lauf1 l = aufbau_roh(ab.pfad, (std::string("test_arr_auto_null_z") + std::to_string(fall++)).c_str(), 128.0, f.lanes);
      const cdj::NullErgebnis gleich = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, 128.0)));
      cdj::RenderAuftrag g = auftrag(*l.x, l.v, 128.0);
      g.gegenprobe_auto = true;
      const cdj::RenderErgebnis rg = cdj::rendere(g);
      PRUEF(rg.fehler.empty());
      const cdj::NullErgebnis e = vergleiche(l.v, rg);
      std::printf("Fall 6 (%s, 128 BPM): ohne Gegenprobe %s rest %.1f dB signal %.1f dB, mit Gegenprobe %s rest %.1f dB\n", f.name,
                  cdj::null_urteil_text(gleich.urteil), gleich.rest_db, gleich.signal_db, cdj::null_urteil_text(e.urteil), e.rest_db);
      PRUEF(gleich.urteil == cdj::NullUrteil::bestanden && gleich.rest_db < cdj::NULL_SCHWELLE_DB && gleich.signal_db > -30.0);
      PRUEF(e.urteil == cdj::NullUrteil::rot && e.rest_db >= cdj::NULL_SCHWELLE_DB);
    }
  }
  {  // 4. silence in both runs: invalid, not passed
    Lauf1 l = aufbau(ab.pfad, "test_arr_auto_null_still", 128.0, {{0.0, -200.0, 0}, {20.0, -200.0, 0}});
    const cdj::NullErgebnis e = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, 128.0)));
    std::printf("Fall 4 (Lane -200 dB): %s ursache %s\n", cdj::null_urteil_text(e.urteil), e.ursache.c_str());
    PRUEF(e.urteil == cdj::NullUrteil::ungueltig);
  }
  PRUEF_ENDE();
}
