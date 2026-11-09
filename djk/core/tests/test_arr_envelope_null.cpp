// 1.12 automation slice 5, unit U8b (T8.5, AK12 part): export = playing, with a gain envelope on the clip. "Live" is a core in the process (arr35::Lauf) with a playback /2
// (one track, one noise clip of 17 beats with `gain_hk`, loop bracket OFF: the render knows no bracket), its master recorded through the ring head as in operation. "Render" is
// rendere() with the restart tray of the live core (the A7 rule: rest peak under -90 dBFS, silence in both runs is invalid, the live run shifted by one sample is red).
// Five voice paths, one track each: plain (0), RE-PITCH (1), BEATS (2), COMPLEX (3), TONES (4, the last two through the warp werk, synchronous in the process and in the render).
// For every path, at 120 and 128 BPM:
//   1. main probe, ramp: gain_hk -30 -> 0 dB over 14 beats: rest under -90 dB, signal over -20 dB.
//   2. counter-check: an envelope with a jump (-3 dB | -24 dB at beat 8, form jump). The render gets a playback file in which every point of the envelope stands 1/48000 s later
//      (bpm / 60 / 48000 beats), the live run keeps the unshifted one -> red (rest at or above -90 dB). The same set-up with the unshifted file passes (negative control).
//      2b. measured, not assumed: unlike a fader lane (test_arr_auto_null: a 1-sample shift of a 30 dB ramp leaves -104 dB, under the threshold) the shifted RAMP is red here too
//      (-69.4 dB), because the voice holds the dB value within 0.03 dB and a shift moves every hold step by one sample. The test holds that number.
//   3. negative control: the render of a playback WITHOUT the envelope against the live run WITH it is red (rest over -40 dB). Under the mutation ARR_HK_WARP_OHNE
//      (RE-PITCH and BEATS voices ignore the envelope) or ARR_HK_WERK_SCHNELLPFAD (the fast path of the werk voice ignores it) live and render both lose the envelope, the
//      main probe stays green, and this control turns red for that path: a bug that live and render share is found by what the envelope does at all.
//   4. silence in both runs (envelope -200 dB all the way): invalid, not passed.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "arr_run.h"
#include "cypherdj/null_test.h"
#include "cypherdj/render.h"
#include "cypherdj/ring_capture.h"
#include "cypherdj/warp_factory.h"
#include "cypherdj/state.h"

bool g_waechter = false;

using k35::N;

namespace {

constexpr int64_t FPB125 = 23040;   // source frames per beat of the warped clips (a 125 BPM source)

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

void start_tempo(arr35::Lauf& x, double bpm, cdj::WarpWerk* werk) {
  PRUEF(x.kern->sample() == 0);
  x.kern.reset(new cdj::Kern(bpm, x.ring, x.bef.get(), x.ere.get()));
  x.kern->verbinde_lader(x.lr.get());
  x.kern->setze_pruefmodus(false);
  if (werk) x.kern->setze_arr_warp_werk(werk);
  x.vh = x.kern->mixer().limiter_vorhalt();
}

struct Punkt { double beat, db; int form; };
using Huelle = std::vector<Punkt>;

// the points as the JSON of gain_hk, every beat moved by `schieb` samples of 1/48000 s at bpm
std::string hk_json(const Huelle& h, double bpm, int schieb) {
  const double schritt = bpm / 60.0 / 48000.0 * schieb;
  std::string s = ",\"gain_hk\":[";
  char z[96];
  for (size_t i = 0; i < h.size(); ++i) {
    std::snprintf(z, sizeof z, "%s[%.17g,%.17g,%d]", i ? "," : "", h[i].beat + schritt, h[i].db, h[i].form);
    s += z;
  }
  return s + "]";
}

std::string beats_clip(std::string clip, int einheiten, int64_t frames_je_einheit) {   // 1/4 beat units, loop "vor", envelope 100
  std::string e = ",\"e\":[";
  for (int k = 0; k < einheiten; ++k) e += (k ? "," : "") + std::string("[") + std::to_string(k * 0.25) + "," + std::to_string(k * frames_je_einheit) + "]";
  e += "],\"loop\":1,\"huelle\":100";
  const size_t m = clip.find("\"modus\":0");
  PRUEF(m != std::string::npos);
  clip.replace(m, 9, "\"modus\":1" + e);
  return clip;
}

const char* kind_name(int kind) { return kind == 0 ? "plain" : kind == 1 ? "RE-PITCH" : kind == 2 ? "BEATS" : kind == 3 ? "COMPLEX" : "TONES"; }

// the playback text of one track with one clip of 17 beats. h empty: no envelope
std::string spur_text(const arrdatei::Ordner& o, int kind, double bpm, const Huelle& h, int schieb) {
  const int64_t spb = static_cast<int64_t>(std::ceil(48000.0 * 60.0 / bpm));
  const int64_t frames = 19 * std::max<int64_t>(spb, FPB125);
  const std::string a = rauschen(o, 'd', frames);
  std::string c;
  if (kind == 0) c = o.clip("c1", 0.0, 17.0, a, frames);
  else {
    const int modus = kind == 3 ? cdj::ARR_WARP_COMPLEX : kind == 4 ? cdj::ARR_WARP_TONES : 0;
    c = o.clip_warp("c1", 0.0, 17.0, a, frames, {{0.0, 0.0}, {17.0, 17.0 * FPB125}}, 0.0, modus);
    if (kind == 2) c = beats_clip(c, 68, FPB125 / 4);
  }
  if (!h.empty()) c.insert(c.size() - 1, hk_json(h, bpm, schieb));
  return "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + c + "]}";
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
  std::unique_ptr<cdj::WarpWerk> werk;   // before the run, after it ends (the core holds the pointer)
  std::unique_ptr<arr35::Lauf> x;
  Live v;
};
void aufbau(Lauf1& l, const std::string& ab, const char* name, int kind, double bpm, const Huelle& h) {
  if (kind >= 3) {
    l.werk = cdj::warp_werk_neu({});
    PRUEF(l.werk != nullptr);
  }
  l.x.reset(new arr35::Lauf(ab, name));
  start_tempo(*l.x, bpm, l.werk.get());
  l.x->laden(1, spur_text(l.x->ordner, kind, bpm, h, 0), "andreas", true);
  l.v = live_lauf(*l.x, bpm, 16);
  PRUEF(l.v.ursprung > 0 && l.v.m.fehler.empty());
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_arr_huellkurve_null");
  if (!cdj::warp_werk_neu({})) std::printf("note: this build has no Bungee: the COMPLEX and TONES cases are skipped\n");
  const Huelle rampe = {{0.0, -30.0, 0}, {14.0, 0.0, 0}};
  const Huelle sprung = {{0.0, -3.0, 0}, {8.0, -24.0, 2}, {14.0, -6.0, 0}};
  for (int kind = 0; kind < 5; ++kind) {
    if (kind >= 3 && !cdj::warp_werk_neu({})) continue;
    for (double bpm : {128.0, 120.0}) {
      const std::string tag = std::string("test_arr_huellkurve_null_") + std::to_string(kind) + (bpm == 128.0 ? "a" : "b");
      {  // 1. main probe, ramp
        Lauf1 l;
        aufbau(l, ab.pfad, (tag + "_r").c_str(), kind, bpm, rampe);
        const cdj::RenderErgebnis r = cdj::rendere(auftrag(*l.x, l.v, bpm));
        if (!r.fehler.empty()) std::printf("Render error: %s: %s\n", r.fehler.c_str(), r.meldung.c_str());
        PRUEF(r.fehler.empty() && r.regler > 0 && r.phase == 25);
        PRUEF(r.frames == std::llround(16.0 * 48000.0 * 60.0 / bpm));
        const cdj::NullErgebnis e = vergleiche(l.v, r);
        std::printf("Case 1 (%s, ramp, %.0f BPM): %s rest %.1f dB, signal %.1f dB\n", kind_name(kind), bpm, cdj::null_urteil_text(e.urteil), e.rest_db, e.signal_db);
        PRUEF(e.urteil == cdj::NullUrteil::bestanden && e.rest_db < cdj::NULL_SCHWELLE_DB && e.signal_db > -20.0);
        // 3. negative control: the render without the envelope against the live run with it
        l.x->ordner.wiedergabe2_warp(1, spur_text(l.x->ordner, kind, bpm, {}, 0));
        const cdj::NullErgebnis ohne = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, bpm)));
        std::printf("Case 3 (%s, render without the envelope against live with it, %.0f BPM): %s rest %.1f dB\n", kind_name(kind), bpm, cdj::null_urteil_text(ohne.urteil), ohne.rest_db);
        PRUEF(ohne.urteil == cdj::NullUrteil::rot && ohne.rest_db > -40.0);
      }
      {  // 2. counter-check with the jump: the render gets the envelope 1/48000 s later
        Lauf1 l;
        aufbau(l, ab.pfad, (tag + "_s").c_str(), kind, bpm, sprung);
        const cdj::NullErgebnis gleich = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, bpm)));
        l.x->ordner.wiedergabe2_warp(1, spur_text(l.x->ordner, kind, bpm, sprung, 1));
        const cdj::RenderErgebnis rg = cdj::rendere(auftrag(*l.x, l.v, bpm));
        PRUEF(rg.fehler.empty());
        const cdj::NullErgebnis e = vergleiche(l.v, rg);
        std::printf("Case 2 (%s, jump, %.0f BPM): unshifted %s rest %.1f dB, envelope 1 sample later in the render %s rest %.1f dB\n", kind_name(kind), bpm,
                    cdj::null_urteil_text(gleich.urteil), gleich.rest_db, cdj::null_urteil_text(e.urteil), e.rest_db);
        PRUEF(gleich.urteil == cdj::NullUrteil::bestanden && gleich.rest_db < cdj::NULL_SCHWELLE_DB);   // negative control
        PRUEF(e.urteil == cdj::NullUrteil::rot && e.rest_db >= cdj::NULL_SCHWELLE_DB);
      }
    }
  }
  {  // 2b. the ramp alone: a shift of 1 sample is already red (hold steps of 0.03 dB move by a sample): -69.4 dB measured
    Lauf1 l;
    aufbau(l, ab.pfad, "test_arr_huellkurve_null_rs", 0, 128.0, rampe);
    l.x->ordner.wiedergabe2_warp(1, spur_text(l.x->ordner, 0, 128.0, rampe, 1));
    const cdj::NullErgebnis e = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, 128.0)));
    std::printf("Case 2b (plain, ramp shifted by 1 sample): %s rest %.1f dB\n", cdj::null_urteil_text(e.urteil), e.rest_db);
    PRUEF(e.urteil == cdj::NullUrteil::rot && e.rest_db >= cdj::NULL_SCHWELLE_DB && e.rest_db < -50.0);
  }
  {  // 4. silence in both runs: invalid, not passed
    Lauf1 l;
    aufbau(l, ab.pfad, "test_arr_huellkurve_null_still", 0, 128.0, {{0.0, -200.0, 0}, {17.0, -200.0, 0}});
    const cdj::NullErgebnis e = vergleiche(l.v, cdj::rendere(auftrag(*l.x, l.v, 128.0)));
    std::printf("Case 4 (envelope -200 dB): %s cause %s\n", cdj::null_urteil_text(e.urteil), e.ursache.c_str());
    PRUEF(e.urteil == cdj::NullUrteil::ungueltig);
  }
  PRUEF_ENDE();
}
