// Strand 6 task 1.3 (plan 2026-11-27, D3..D11): the project modulators in the core. Measured like test_arr_auto_stapel: (A) the lane buffers auto_buf_[slot][field] through the friend
// struct (the course the mixer reads), (B) the audio level of a constant clip (0.5) at the master.
//   1. the shapes, the offset formula and splitmix32 against djk/contract/mod_ref.json (the reference the server and the page tests read too).
//   2. a sine LFO, takt 4, tiefe -6 dB on a track fader (base -10 dB): the master level follows base + offset within 0.05 dB at eight beats, locked to the project beat (a start at beat 2
//      begins on the curve at beat 2), and across a loop seam the curve restarts at beat 0.
//   3. the same while the transport stands: the course runs on (tempo-map beat), no clip needed.
//   4. a fader lane plus the LFO plays lane + offset; a hand override (auto_uebersteuern) keeps the offset on the hand value (D3: the modulator does not yield).
//   5. a snapshot swap that changes the depth: a free-rate LFO keeps its phase (same nr), and the swap step stays inside the smoothing slope (no click). A different nr restarts.
//   6. a free rate restarts at every transport start: two runs from the same start give the same course.
//   7. no modulator: nothing is written (auto_buf_ untouched, 0 dB); a modulator of depth 0 gives the master output bit for bit of the run without it.
//   8. edges: a fader at -200 dB with a bipolar modulator stays silent; pan is clamped to -1..1; a modulator on a return fader; unipolar polarity.
//   9. the reader: the key `mod` of a playback file (valid file, and the refusals).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_playback.h"
#include "check.h"

namespace cdj {
struct ArrPruefZugang {
  static const float* buf(const Arrangement& a, int i, int f) { return a.auto_buf_[i][f]; }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;
using Z = cdj::ArrPruefZugang;

namespace {
constexpr int64_t V = 537;
constexpr double MITTE = 0.70710677;
constexpr double SPB120 = 24000.0;   // samples per beat at 120 BPM
constexpr double PI2 = 6.283185307179586;

double lin(double db) { return db <= -120.0 ? 0.0 : std::pow(10.0, db / 20.0); }
double db_von(double g) { return 20.0 * std::log10(std::max(g, 1e-12)); }
ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }

cdj::ArrModZiel fader_ziel(int slot, float tiefe, bool uni = false, int feld = cdj::ARR_AUTO_FADER) {
  cdj::ArrModZiel z{};
  z.art = 0;
  z.slot = static_cast<int16_t>(slot);
  z.feld = static_cast<uint8_t>(feld);
  z.tiefe = tiefe;
  z.uni = uni;
  return z;
}
cdj::ArrMod lfo(int nr, int form, double takt, std::vector<cdj::ArrModZiel> ziele, double phase = 0.0, float glatt_ms = 1.0f) {
  cdj::ArrMod md{};
  md.nr = static_cast<uint8_t>(nr);
  md.form = static_cast<uint8_t>(form);
  md.takt = takt;
  md.phase = phase;
  md.glatt_ms = glatt_ms;
  md.saat = 2166136261u;
  for (const cdj::ArrModZiel& z : ziele) md.z[md.n++] = z;
  return md;
}
cdj::ArrMod frei(int nr, int form, double hz, std::vector<cdj::ArrModZiel> ziele, double phase = 0.0) {
  cdj::ArrMod md = lfo(nr, form, 4.0, std::move(ziele), phase);
  md.frei = true;
  md.hz = hz;
  return md;
}
// Adds the modulators to a built snapshot and numbers the fader/pan buffers as the reader does.
cdj::ArrSnapshot* mit_mods(cdj::ArrSnapshot* s, std::vector<cdj::ArrMod> mods) {
  for (cdj::ArrMod md : mods) {
    for (int q = 0; q < md.n; ++q) {
      cdj::ArrModZiel& z = md.z[q];
      if (z.art != 0) continue;
      int b = 0;
      while (b < s->n_mod_felder && !(s->mod_feld[b].slot == z.slot && s->mod_feld[b].feld == z.feld)) ++b;
      if (b == s->n_mod_felder) {
        s->mod_feld[b].slot = z.slot;
        s->mod_feld[b].feld = z.feld;
        ++s->n_mod_felder;
      }
      z.puffer = static_cast<int8_t>(b);
    }
    s->mod[s->n_mod++] = md;
  }
  return s;
}

struct Szene {
  std::unique_ptr<Audio> au = Audio::gleich(2400000);
  std::unique_ptr<Treiber> tp = std::make_unique<Treiber>();
  Treiber& t = *tp;
  float hand[cdj::ARR_BLOCK];
  int r_fader = -1, r_pan = -1, r_ret = -1;
  std::vector<float> buf[2];   // auto_buf_ of track 0 per field (fader, pan), index = core sample
  std::vector<float> rbuf;     // auto_buf_ of return 1, fader
  int64_t start_s = 0;
  Szene() { t.k = cdj::Karte(120.0, 0); }
  cdj::ArrSnapshot* bau(int64_t nr, std::vector<cdj::ArrMod> mods, const std::vector<ArrAutoPunkt>& fader_lane = {}, bool mit_ret = false) {
    Bau b(nr);
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 90.0, &au->a);
    if (!fader_lane.empty()) b.lane(1, fader_lane, cdj::ARR_AUTO_FADER);
    if (mit_ret) b.ret(1);
    return mit_mods(b.fertig(), std::move(mods));
  }
  void laden(cdj::ArrSnapshot* s) {
    t.laden(s);
    if (r_fader < 0) {
      r_fader = t.tab.suche("spur/1/fader");
      r_pan = t.tab.suche("spur/1/pan");
      r_ret = t.tab.suche("ret/1/fader");
    }
  }
  void starten(double beat = 0.0) {
    PRUEF(t.arr.start(beat, 0, false, t.s, V, 256, t.k));
    start_s = t.arr.zustand(t.k, t.s).ursprung_sample;
  }
  template <class F> void lauf(int64_t bis, F&& vor) {
    float b[6][cdj::ARR_BLOCK];
    while (t.s < bis) {
      for (auto& x : b) std::fill(x, x + t.n, 0.0f);
      vor(t.s);
      t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
      t.l.insert(t.l.end(), b[0], b[0] + t.n);
      t.r.insert(t.r.end(), b[1], b[1] + t.n);
      const size_t e = static_cast<size_t>(t.s + t.n);
      for (int f = 0; f < 2; ++f) {
        if (buf[f].size() < e) buf[f].resize(e, 0.0f);
        std::copy(Z::buf(t.arr, 0, f), Z::buf(t.arr, 0, f) + t.n, buf[f].begin() + t.s);
      }
      if (rbuf.size() < e) rbuf.resize(e, 0.0f);
      std::copy(Z::buf(t.arr, cdj::ARR_SPUREN, 0), Z::buf(t.arr, cdj::ARR_SPUREN, 0) + t.n, rbuf.begin() + t.s);
      t.s += t.n;
    }
  }
  void lauf(int64_t bis) { lauf(bis, [](int64_t) {}); }
  double gain_db(int64_t s) const { return db_von(std::fabs(t.l[static_cast<size_t>(s)]) / (0.5 * MITTE)); }
  int64_t bei(double beat_seit_start) const { return start_s + static_cast<int64_t>(beat_seit_start * SPB120); }
  float fb(int f, int64_t s) const { return buf[f][static_cast<size_t>(s)]; }
};

double groesster_schritt(const std::vector<float>& b, int64_t von, int64_t bis) {
  double g = 0.0;
  for (int64_t x = von; x < bis; ++x) g = std::max(g, std::fabs(static_cast<double>(b[static_cast<size_t>(x)]) - b[static_cast<size_t>(x - 1)]));
  return g;
}

void formeln() {   // 1.
  std::ifstream f(std::string(CYPHERDJ_DJK) + "/contract/mod_ref.json");
  PRUEF(f.good());
  const nlohmann::json j = nlohmann::json::parse(f, nullptr, false);
  PRUEF(!j.is_discarded());
  int n = 0;
  for (const auto& fo : j.at("formen")) {
    const int form = fo.at("form").get<int>();
    const uint32_t saat = fo.at("saat").get<uint32_t>();
    for (const auto& p : fo.at("punkte")) {
      const float ist = cdj::arr_mod_form(form, p[0].get<double>(), p[1].get<double>(), p[2].get<double>(), saat);
      PRUEF_NAH(ist, p[3].get<double>(), 2e-6);
      ++n;
    }
  }
  for (const auto& v : j.at("versatz")) {
    PRUEF_NAH(cdj::arr_mod_versatz(v[0].get<float>(), v[1].get<float>(), v[2].get<bool>()), v[3].get<double>(), 1e-6);
    ++n;
  }
  for (const auto& s : j.at("splitmix32")) {
    PRUEF(cdj::arr_mod_splitmix32(s[0].get<uint32_t>()) == s[1].get<uint32_t>());
    ++n;
  }
  std::printf("1. %d reference rows of mod_ref.json\n", n);
  PRUEF(n >= 5 * 16 + 6 + 4);
}

void sinus_lfo() {   // 2.
  {
    Szene z;
    z.laden(z.bau(1, {lfo(1, 0, 4.0, {fader_ziel(0, -6.0f)})}));
    z.t.arr.setze_sofort(z.r_fader, -10.0f);
    z.starten();
    z.lauf(z.bei(9.0));
    double max_ab = 0.0;
    for (double b = 0.5; b <= 8.0; b += 0.5) {
      const double soll = -10.0 - 6.0 * std::sin(PI2 * b / 4.0);
      max_ab = std::max(max_ab, std::fabs(z.gain_db(z.bei(b)) - soll));
      PRUEF_NAH(z.gain_db(z.bei(b)), soll, 0.05);
      PRUEF_NAH(z.fb(0, z.bei(b)), soll, 0.03);
    }
    std::printf("2. sine LFO on the fader: largest deviation of the master level %.4f dB over 16 points\n", max_ab);
  }
  {  // a start at beat 2: the curve is the one of the project beat, not of the time since the start
    Szene z;
    z.laden(z.bau(1, {lfo(1, 0, 4.0, {fader_ziel(0, -6.0f)})}));
    z.t.arr.setze_sofort(z.r_fader, -10.0f);
    z.starten(2.0);
    z.lauf(z.bei(3.0));
    for (double b : {0.25, 1.0, 2.5}) PRUEF_NAH(z.gain_db(z.bei(b)), -10.0 - 6.0 * std::sin(PI2 * (b + 2.0) / 4.0), 0.05);
  }
  {  // loop 0..6: after the seam the curve is at beat 0 again
    Szene z;
    z.laden(z.bau(1, {lfo(1, 0, 4.0, {fader_ziel(0, -6.0f)})}));
    z.t.arr.setze_sofort(z.r_fader, -10.0f);
    z.t.arr.loop(true, 0.0, 6.0, 0, z.t.k);
    z.starten();
    z.lauf(z.bei(8.0));
    const int64_t naht = z.bei(6.0);
    PRUEF_NAH(z.fb(0, naht - 2400), -10.0 - 6.0 * std::sin(PI2 * 5.9 / 4.0), 0.03);
    PRUEF_NAH(z.fb(0, naht + 2400), -10.0 - 6.0 * std::sin(PI2 * 0.1 / 4.0), 0.03);
    PRUEF_NAH(z.fb(0, naht + 24000), -10.0 - 6.0, 0.03);    // beat 1 of the second pass
    PRUEF_NAH(z.gain_db(naht + 24000), -16.0, 0.05);
  }
}

void im_stand() {   // 3.
  Szene z;
  z.laden(z.bau(1, {lfo(1, 0, 4.0, {fader_ziel(0, -6.0f)})}));
  z.t.arr.setze_sofort(z.r_fader, -10.0f);
  z.lauf(9 * 24000);   // never started: the tempo-map beat of the core sample
  double lo = 1e9, hi = -1e9;
  for (int64_t s = 24000; s < 9 * 24000; ++s) {
    lo = std::min<double>(lo, z.fb(0, s));
    hi = std::max<double>(hi, z.fb(0, s));
  }
  for (double b : {1.0, 2.5, 3.0, 5.0, 7.25}) PRUEF_NAH(z.fb(0, static_cast<int64_t>(b * SPB120)), -10.0 - 6.0 * std::sin(PI2 * b / 4.0), 0.03);
  std::printf("3. stopped transport: the fader course swings %.3f .. %.3f dB\n", lo, hi);
  PRUEF(hi > -4.1 && lo < -15.9);
}

void lane_und_hand() {   // 4.
  Szene z;
  z.laden(z.bau(1, {lfo(1, 0, 4.0, {fader_ziel(0, -6.0f)})}, {P(0, -10.f), P(80, -10.f)}));
  z.starten();
  z.lauf(z.bei(4.0));
  for (double b : {1.0, 2.0, 3.0}) {
    PRUEF_NAH(z.fb(0, z.bei(b)), -10.0 - 6.0 * std::sin(PI2 * b / 4.0), 0.03);   // lane + offset
    PRUEF_NAH(z.gain_db(z.bei(b)), -10.0 - 6.0 * std::sin(PI2 * b / 4.0), 0.05);
  }
  const int64_t G = (z.bei(4.0) / 256 + 1) * 256, sg = G + 100;
  bool ok = false;
  z.lauf(G + 4 * 24000, [&](int64_t s0) {
    if (s0 != G) return;
    std::fill(z.hand, z.hand + cdj::ARR_BLOCK, -20.0f);
    z.t.arr.verlauf(z.r_fader, z.hand);
    ok = z.t.arr.auto_uebersteuern(0, 0, true, sg);
  });
  PRUEF(ok);
  for (double b : {5.0, 6.0, 7.0}) {   // the hand value is the centre now, the modulator swings around it
    PRUEF_NAH(z.fb(0, z.bei(b)), -20.0 - 6.0 * std::sin(PI2 * b / 4.0), 0.03);
    PRUEF_NAH(z.gain_db(z.bei(b)), -20.0 - 6.0 * std::sin(PI2 * b / 4.0), 0.05);
  }
}

void tausch() {   // 5.
  // free rate 1 Hz, sine, tiefe -6, swapped at G to tiefe -3 (same nr): from then on the curve is half the control curve (same phase), after the smoothing has settled
  const auto mods = [](float tiefe, int nr) { return std::vector<cdj::ArrMod>{frei(nr, 0, 1.0, {fader_ziel(0, tiefe)})}; };
  Szene z, k, n;
  for (Szene* s : {&z, &k, &n}) {
    s->laden(s->bau(1, mods(-6.0f, 1)));
    s->t.arr.setze_sofort(s->r_fader, -10.0f);
  }
  const int64_t T = 256 * 100;   // a block start that is not a period start (t.n = 256)
  z.lauf(T + 48000, [&](int64_t s0) {
    if (s0 == T) z.laden(z.bau(2, mods(-3.0f, 1)));
  });
  k.lauf(T + 48000);
  n.lauf(T + 48000, [&](int64_t s0) {
    if (s0 == T) n.laden(n.bau(2, mods(-3.0f, 2)));   // another nr: a new modulator, its phase starts afresh
  });
  int abw = 0;
  for (int64_t s = T + 2000; s < T + 48000; s += 97) {
    const double soll = -10.0 + 0.5 * (k.fb(0, s) + 10.0);
    if (std::fabs(z.fb(0, s) - soll) > 1e-3) ++abw;
  }
  const double schritt = groesster_schritt(z.buf[0], T - 200, T + 200);
  const double lauf_schritt = groesster_schritt(k.buf[0], T - 200, T + 200);
  std::printf("5. swap of the depth: %d samples off the half control curve, largest step around the swap %.5f dB (control %.5f dB)\n", abw, schritt, lauf_schritt);
  PRUEF(abw == 0);
  const double a = 1.0 - std::exp(-1.0 / 48.0);
  PRUEF(schritt <= 3.0 * a + lauf_schritt + 1e-4);   // the swap jumps by up to 3 dB in the target; the smoothing takes a share a of it per sample
  PRUEF(schritt > lauf_schritt);                      // and the swap did change something
  int gleich_n = 0;   // the new nr starts at phase 0: off the half control curve
  for (int64_t s = T + 2000; s < T + 48000; s += 97)
    if (std::fabs(n.fb(0, s) - (-10.0 + 0.5 * (k.fb(0, s) + 10.0))) < 1e-3) ++gleich_n;
  PRUEF(gleich_n < 50);
}

void frei_start() {   // 6.
  Szene z;
  z.laden(z.bau(1, {frei(1, 2, 1.3, {fader_ziel(0, -6.0f)}, 0.25)}));
  z.t.arr.setze_sofort(z.r_fader, -10.0f);
  z.lauf(10000);   // the phase runs while it stands
  z.starten();
  const int64_t s1 = z.start_s;
  z.lauf(s1 + 60000);
  const int64_t halt = z.t.s + 64;
  z.t.arr.stopp(0, halt, z.t.k);
  z.lauf(halt + 33333);   // 33333 samples at 1.3 Hz is not a whole number of periods
  z.starten();
  const int64_t s2 = z.start_s;
  z.lauf(s2 + 60000);
  int abw = 0, vorher_gleich = 0;
  for (int64_t d = 2000; d < 50000; ++d)
    if (std::fabs(z.fb(0, s1 + d) - z.fb(0, s2 + d)) > 1e-3) ++abw;
  for (int64_t d = 100; d < 400; ++d)
    if (std::fabs(z.fb(0, s1 - d) - z.fb(0, s2 - d)) < 1e-3) ++vorher_gleich;
  std::printf("6. free rate: %d samples differ between the two runs after the start (%d equal before the starts)\n", abw, vorher_gleich);
  PRUEF(abw == 0);
  PRUEF(vorher_gleich < 300);   // before the starts the phases differ: the equality comes from the restart
  // and the run starts on the curve of phase 0.25 (saw 2t - 1): 2000 samples in, t = 0.25 + 2000 * 1.3 / 48000
  const double t = 0.25 + 2000.0 * 1.3 / 48000.0;
  PRUEF_NAH(z.fb(0, s1 + 2000), -10.0 - 6.0 * (2.0 * t - 1.0), 0.03);
}

void ohne() {   // 7.
  {
    Szene z;
    z.laden(z.bau(1, {}));
    z.starten();
    z.lauf(z.bei(2.0));
    bool null = true;
    for (float v : z.buf[0]) null = null && v == 0.0f;
    PRUEF(null);   // nothing wrote the buffer
    PRUEF_NAH(z.gain_db(z.bei(1.0)), 0.0, 0.01);
  }
  for (bool lane : {false, true}) {
    const std::vector<ArrAutoPunkt> l = lane ? std::vector<ArrAutoPunkt>{P(0, -3.f), P(4, -12.f)} : std::vector<ArrAutoPunkt>{};
    Szene a, b;
    a.laden(a.bau(1, {}, l));
    b.laden(b.bau(1, {lfo(1, 0, 4.0, {fader_ziel(0, 0.0f), fader_ziel(0, 0.0f, false, cdj::ARR_AUTO_PAN)})}, l));
    for (Szene* s : {&a, &b}) {
      s->t.arr.setze_sofort(s->r_fader, -4.0f);
      s->starten();
      s->lauf(s->bei(5.0));
    }
    int ungleich = 0;
    for (size_t x = 0; x < a.t.l.size(); ++x) ungleich += a.t.l[x] != b.t.l[x] || a.t.r[x] != b.t.r[x];
    std::printf("7. depth 0 against no modulator (%s): %d differing output samples\n", lane ? "with a fader lane" : "no lane", ungleich);
    PRUEF(ungleich == 0);
  }
}

void raender() {   // 8.
  {  // -200 dB stays silent under a bipolar modulator of the full depth
    Szene z;
    z.laden(z.bau(1, {lfo(1, 3, 1.0, {fader_ziel(0, 24.0f)})}));
    z.t.arr.setze_sofort(z.r_fader, -200.0f);
    z.starten();
    z.lauf(z.bei(4.0));
    float spitze = 0.0f;
    for (int64_t s = z.start_s; s < z.bei(4.0); ++s) spitze = std::max(spitze, std::fabs(z.t.l[static_cast<size_t>(s)]));
    PRUEF(spitze == 0.0f);
  }
  {  // pan clamp: base 0.8 + square of depth 0.5 plays 1.0 and 0.3
    Szene z;
    z.laden(z.bau(1, {lfo(1, 3, 4.0, {fader_ziel(0, 0.5f, false, cdj::ARR_AUTO_PAN)})}));
    z.t.arr.setze_sofort(z.r_pan, 0.8f);
    z.starten();
    z.lauf(z.bei(5.0));
    PRUEF_NAH(z.fb(1, z.bei(1.0)), 1.0, 1e-6);
    PRUEF_NAH(z.fb(1, z.bei(3.0)), 0.3, 1e-4);
    float hoechst = -2.0f;
    for (int64_t s = z.start_s; s < z.bei(5.0); ++s) hoechst = std::max(hoechst, z.fb(1, s));
    PRUEF(hoechst <= 1.0f);
  }
  {  // a return fader, unipolar: base 0 dB + 3 * (out + 1) / 2 of a saw, clamped at +6
    Szene z;
    z.laden(z.bau(1, {lfo(1, 2, 4.0, {fader_ziel(cdj::ARR_SPUREN, 3.0f, true)})}, {}, true));
    PRUEF(z.r_ret >= 0);
    z.t.arr.setze_sofort(z.r_ret, -6.0f);
    z.starten();
    z.lauf(z.bei(4.0));
    for (double b : {1.0, 2.0, 3.0}) PRUEF_NAH(z.rbuf[static_cast<size_t>(z.bei(b))], -6.0 + 3.0 * (2.0 * b / 4.0 - 1.0 + 1.0) / 2.0, 0.03);
  }
}

void lader() {   // 9.
  arrdatei::Ordner o("test_arr_mod");
  const std::string a = o.audio('a', 48000);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  const std::string spuren = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 4.0, a, 48000) + "]},{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[]}";
  const std::string returns = "[{\"nr\":1,\"ausgang\":{\"art\":\"master\"}}]";
  int64_t nr = 100;
  const auto lade = [&](const char* format, const std::string& mod, cdj::ArrSnapshot* kopie = nullptr) {
    ++nr;
    std::ofstream(o.pfad + "/wiedergabe-" + std::to_string(nr) + ".json")
        << "{\"format\":\"" << format << "\",\"nr\":" << nr << ",\"spuren\":[" << spuren << "],\"gruppen\":[],\"returns\":" << returns << (mod.empty() ? "" : ",\"mod\":" + mod) << "}";
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
    const std::string g = e.grund + (e.snap ? "+snap" : "");
    if (e.snap && kopie) {
      kopie->n_mod = e.snap->n_mod;
      for (int k = 0; k < e.snap->n_mod; ++k) kopie->mod[k] = e.snap->mod[k];
      kopie->n_mod_felder = e.snap->n_mod_felder;
      for (int b = 0; b < e.snap->n_mod_felder; ++b) kopie->mod_feld[b] = e.snap->mod_feld[b];
    }
    if (!e.snap) std::printf("   refused: %s\n", e.meldung.c_str());
    cdj::gib_wiedergabe(e.snap.release(), cache);
    return g;
  };
  const auto m1 = [](const std::string& ziele, const std::string& rate = "\"takt\":4.0") {
    return "[{\"nr\":1,\"art\":\"lfo\",\"form\":0," + rate + ",\"phase\":0.0,\"glatt_ms\":1.0,\"saat\":2166136261,\"ziele\":[" + ziele + "]}]";
  };
  {  // the example of the formats section of the plan, plus an rb338 target
    auto k = std::make_unique<cdj::ArrSnapshot>();
    const std::string gut = m1("{\"spur\":1,\"ziel\":\"fader\",\"tiefe\":-6.0,\"uni\":false},{\"ret\":1,\"ziel\":\"fader\",\"tiefe\":3.0,\"uni\":true},"
                               "{\"spur\":2,\"ziel\":\"geraet.cutoff\",\"tiefe\":0.25,\"uni\":false},{\"spur\":1,\"ziel\":\"pan\",\"tiefe\":0.5}");
    PRUEF(lade("cypherdj-arr/3", gut, k.get()) == "+snap");
    PRUEF(k->n_mod == 1 && k->mod[0].nr == 1 && k->mod[0].n == 4 && !k->mod[0].frei && k->mod[0].takt == 4.0 && k->mod[0].saat == 2166136261u);
    PRUEF(k->n_mod_felder == 3);   // track 1 fader, return 1 fader, track 1 pan
    const cdj::ArrModZiel* z = k->mod[0].z;
    PRUEF(z[0].art == 0 && z[0].slot == 0 && z[0].feld == 0 && z[0].tiefe == -6.0f && !z[0].uni && z[0].puffer == 0);
    PRUEF(z[1].art == 0 && z[1].slot == cdj::ARR_SPUREN && z[1].feld == 0 && z[1].uni && z[1].puffer == 1);
    PRUEF(z[2].art == 1 && z[2].slot == 1 && z[2].param == 1 && z[2].puffer == -1);
    PRUEF(z[3].art == 0 && z[3].feld == 1 && z[3].puffer == 2);
    PRUEF(lade("cypherdj-arr/4", m1("{\"spur\":1,\"ziel\":\"fader\",\"tiefe\":-6.0}", "\"hz\":2.5")) == "+snap");
    PRUEF(lade("cypherdj-arr/3", "") == "+snap");   // without the key: no modulator
  }
  const std::string f = "{\"spur\":1,\"ziel\":\"fader\",\"tiefe\":-6.0}";
  PRUEF(lade("cypherdj-arr/2", m1(f)) == "format");                                                    // only /3 and /4
  PRUEF(lade("cypherdj-arr/3", m1(f, "\"takt\":4.0,\"hz\":1.0")) == "format");                         // takt xor hz
  PRUEF(lade("cypherdj-arr/3", m1(f, "\"takt\":300.0")) == "format");                                  // takt range
  PRUEF(lade("cypherdj-arr/3", m1(f, "\"hz\":41.0")) == "format");                                     // hz range
  PRUEF(lade("cypherdj-arr/3", m1("{\"spur\":1,\"ziel\":\"fader\",\"tiefe\":-25.0}")) == "format");    // depth range (dB)
  PRUEF(lade("cypherdj-arr/3", m1("{\"spur\":1,\"ziel\":\"pan\",\"tiefe\":1.5}")) == "format");        // depth range (pan)
  PRUEF(lade("cypherdj-arr/3", m1("{\"spur\":3,\"ziel\":\"fader\",\"tiefe\":-6.0}")) == "format");     // no such track
  PRUEF(lade("cypherdj-arr/3", m1("{\"ret\":2,\"ziel\":\"fader\",\"tiefe\":-6.0}")) == "format");      // no such return
  PRUEF(lade("cypherdj-arr/3", m1("{\"ret\":1,\"ziel\":\"pan\",\"tiefe\":0.5}")) == "format");         // a return: fader only
  PRUEF(lade("cypherdj-arr/3", m1("{\"spur\":1,\"ziel\":\"geraet.cutoff\",\"tiefe\":0.5}")) == "format");   // the device target needs its device
  PRUEF(lade("cypherdj-arr/3", m1("{\"spur\":1,\"ziel\":\"send.1\",\"tiefe\":3.0}")) == "+snap");      // slice 4 (task 4.1): a send to a return in the playback
  PRUEF(lade("cypherdj-arr/3", m1("{\"spur\":1,\"ziel\":\"send.2\",\"tiefe\":3.0}")) == "format");     // return 2 is not in the playback
  PRUEF(lade("cypherdj-arr/3", m1("{\"spur\":1,\"ziel\":\"mute\",\"tiefe\":1.0}")) == "format");
  PRUEF(lade("cypherdj-arr/3", m1(f + "," + f)) == "format");                                          // the same target twice in one modulator
  PRUEF(lade("cypherdj-arr/3", m1("")) == "+snap");                                                    // no core target: only plugin targets, it runs and reports (task 4.1)
  PRUEF(lade("cypherdj-arr/3", "[{\"nr\":17,\"art\":\"lfo\",\"form\":0,\"takt\":4,\"saat\":1,\"ziele\":[" + f + "]}]") == "format");
  PRUEF(lade("cypherdj-arr/3", "[{\"nr\":1,\"art\":\"lfo\",\"form\":5,\"takt\":4,\"saat\":1,\"ziele\":[" + f + "]}]") == "format");
  PRUEF(lade("cypherdj-arr/3", "[{\"nr\":1,\"art\":\"folger\",\"form\":0,\"takt\":4,\"saat\":1,\"ziele\":[" + f + "]}]") == "format");   // slice 3
  {  // the same nr twice; one target in two modulators is fine (they add up) and shares one buffer
    const std::string zwei = "[{\"nr\":1,\"art\":\"lfo\",\"form\":0,\"takt\":4,\"saat\":1,\"ziele\":[" + f + "]},{\"nr\":1,\"art\":\"lfo\",\"form\":1,\"takt\":2,\"saat\":1,\"ziele\":[" + f + "]}]";
    PRUEF(lade("cypherdj-arr/3", zwei) == "format");
    auto k = std::make_unique<cdj::ArrSnapshot>();
    const std::string ok = "[{\"nr\":1,\"art\":\"lfo\",\"form\":0,\"takt\":4,\"saat\":1,\"ziele\":[" + f + "]},{\"nr\":5,\"art\":\"lfo\",\"form\":1,\"takt\":2,\"saat\":1,\"ziele\":[" + f + "]}]";
    PRUEF(lade("cypherdj-arr/3", ok, k.get()) == "+snap");
    PRUEF(k->n_mod == 2 && k->n_mod_felder == 1 && k->mod[1].nr == 5 && k->mod[1].z[0].puffer == 0 && k->mod[0].glatt_ms == 1.0f && k->mod[0].phase == 0.0);
  }
}
}  // namespace

int main() {
  formeln();
  sinus_lfo();
  im_stand();
  lane_und_hand();
  tausch();
  frei_start();
  ohne();
  raender();
  lader();
  PRUEF_ENDE();
}
