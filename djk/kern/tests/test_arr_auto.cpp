// Automation Slice 1, tasks 6a and 6b (AK4, AK5, AK6, AK23): the core evaluates the fader lane of a track per sample (ADR 032).
// Two ways of measuring, kept apart: (A) the buffer auto_buf_[track][t] and ap_[t] through ArrPruefZugang (friend of Arrangement), for everything that
// hangs on a single sample (seam, start in the middle, jump, tempo ramp, blend steps); (B) the audio level of a constant-signal clip at the master
// (0.5 clip value, centre pan -3 dB), where every dB value can be computed back, for the stretch in the middle of a lane, away from entry, seam and stop
// (the entry ramp, the seam short blend and the blend sit there).
// Mutations: ARR_AUTO_CURSOR_ALT (seam: red), ARR_AUTO_BEAT_LINEAR (tempo ramp: red), ARR_AUTO_BLENDE_HART (stop: red),
// ARR_AUTO_GRUND_UEBERSCHRIEBEN (base value overwritten by the lane value: red). Slice 2 task 3 (pan, field 1): ARR_AUTO_PAN_BLENDE_HART (pan stop: red).
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "arr_bau.h"
#include "pruef.h"

namespace cdj {
struct ArrPruefZugang {
  static const float* auto_buf(const Arrangement& a, int i, int feld = 0) { return a.auto_buf_[i][feld]; }
  static const double* ap(const Arrangement& a) { return a.ap_; }
  static double projekt_beat(const Arrangement& a, const Karte& k, double s) { return a.projekt_beat(k, s); }
  static int von(const Arrangement& a) { return a.auto_von_; }
  static int bis(const Arrangement& a) { return a.auto_bis_; }
  static bool vl_ist_puffer(const Arrangement& a, int i) { return a.w_[i][0].vl == a.auto_buf_[i][0]; }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrAutoPunkt;
using Z = cdj::ArrPruefZugang;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;

static ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
static double lin(double db) { return db <= -120.0 ? 0.0 : std::pow(10.0, db / 20.0); }
static double db_von_pegel(double pegel, double voll) { return 20.0 * std::log10(std::max(std::fabs(pegel) / voll, 1e-12)); }

// a run that records the lane buffer and the project beats of track 1 per sample (index = core sample)
struct Aufz {
  std::vector<float> buf;
  std::vector<double> ap;
  std::vector<char> hat;   // the buffer was valid in this sample (Wert::vl pointed at it)
};
static void lauf(Treiber& t, int64_t bis, Aufz& z, int spur = 0, int feld = 0) {
  float b[6][cdj::ARR_BLOCK];
  while (t.s < bis) {
    for (auto& x : b) std::fill(x, x + t.n, 0.0f);
    t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
    t.l.insert(t.l.end(), b[0], b[0] + t.n);
    t.r.insert(t.r.end(), b[1], b[1] + t.n);
    const bool lane = Z::von(t.arr) < Z::bis(t.arr);
    (void)lane;
    for (int j = 0; j < t.n; ++j) {
      z.buf.push_back(Z::auto_buf(t.arr, spur, feld)[j]);
      z.ap.push_back(Z::ap(t.arr)[j]);
      z.hat.push_back(0);
    }
    t.s += t.n;
  }
}

static void aufbau(Treiber& t, const cdj::ArrAudio* a, std::vector<ArrAutoPunkt> lane, double bpm = 120.0, double clip_beats = 40.0) {
  t.k = cdj::Karte(bpm, 0);
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, clip_beats, a);
  if (!lane.empty()) b.lane(1, std::move(lane));
  t.laden(b.fertig());
}

static const ArrAutoPunkt ref_rampe[2] = {{0.0, 0.f, 0}, {16.0, -24.f, 0}};
static const ArrAutoPunkt ref_sprung[4] = {{0.0, 0.f, 0}, {8.0, -10.f, 0}, {8.0, -40.f, 0}, {16.0, -50.f, 0}};

int main() {
  auto a = Audio::gleich(1200000);   // 25 s at 48 kHz, constant 0.5
  const double SPB = 24000.0;        // samples per beat at 120 BPM
  {  // 1. AK4 linear (way B): lane 0 -> -30 dB over beats 4..20, level at beats 4, 8, 12, 16, 20 within 0.05 dB of the straight line
     // before case: the same track without a lane holds its level at the five beats (+-0.01 dB)
    Treiber t;
    aufbau(t, &a->a, {P(4, 0.f), P(20, -30.f)});
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(500000);
    const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
    for (int b : {4, 8, 12, 16, 20}) {
      const double soll = b <= 4 ? 0.0 : -30.0 * (b - 4) / 16.0;
      const int64_t sm = s_start + static_cast<int64_t>(b * SPB);
      PRUEF_NAH(db_von_pegel(t.l[sm], 0.5 * MITTE), soll, 0.05);
    }
    Treiber v;
    aufbau(v, &a->a, {});
    v.arr.start(0.0, 0, false, 0, V, 256, v.k);
    v.lauf(500000);
    const int64_t v_start = v.arr.zustand(v.k, v.s).ursprung_sample;
    for (int b : {4, 8, 12, 16, 20}) PRUEF_NAH(db_von_pegel(v.l[v_start + static_cast<int64_t>(b * SPB)], 0.5 * MITTE), 0.0, 0.01);
  }
  {  // 2. AK4 s-curve (way B): 0 -> -30 dB over beats 4..20 with 3u^2 - 2u^3
    Treiber t;
    aufbau(t, &a->a, {P(4, 0.f), P(20, -30.f, 1)});
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(500000);
    const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
    for (int b : {6, 8, 12, 16, 18}) {
      const double u = (b - 4) / 16.0;
      PRUEF_NAH(db_von_pegel(t.l[s_start + static_cast<int64_t>(b * SPB)], 0.5 * MITTE), -30.0 * u * u * (3.0 - 2.0 * u), 0.05);
    }
  }
  {  // 3. AK5 seam (way A): bracket 0..32, lane 0 -> -30 over 0..32. The first sample after the wrap is Lane(0), the one before Lane(32 - eps).
     // Whole samples per beat (120 BPM): gain within 1e-6; a fractional seam sample (127 BPM): within 5e-6 (calculation about 2.3e-6)
    for (double bpm : {120.0, 127.0}) {
      Treiber t;
      aufbau(t, &a->a, {P(0, 0.f), P(16, -5.f), P(32, -30.f)}, bpm, 40.0);   // three points, not on a line: a stale cursor after the wrap gives a wrong value
      t.arr.loop(true, 0.0, 32.0, 0, t.k);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      Aufz z;
      const int64_t spb_ganz = static_cast<int64_t>(48000.0 * 60.0 / bpm);
      lauf(t, 900 + 33 * spb_ganz, z);
      const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
      const int64_t naht = std::llround(t.k.sample_at(32.0 + t.k.beat_at(static_cast<double>(s_start))));
      PRUEF(naht > 0 && naht < static_cast<int64_t>(z.buf.size()));
      if (naht > 0 && naht < static_cast<int64_t>(z.buf.size())) {
        const double tor = bpm == 120.0 ? 1e-6 : 5e-6;
        PRUEF_NAH(lin(z.buf[naht]), 1.0, tor);                                        // Lane(0) = 0 dB
        PRUEF_NAH(z.ap[naht], 0.0, bpm == 120.0 ? 1e-9 : 3e-5);                       // project beat just after the wrap
        const double vor = -30.0 + 25.0 * (1.0 / (60.0 / bpm * 48000.0)) / 16.0;      // Lane(32 - one sample)
        PRUEF_NAH(z.buf[naht - 1], vor, 1e-3);                                        // no jump ahead of the seam
        PRUEF(z.buf[naht - 1] < -29.99);                                              // and it is the end of the lane, not the start
        // way B: the level 10 ms after the wrap is Lane(0) within 0.05 dB (the seam short blend sits in between)
        PRUEF_NAH(db_von_pegel(t.l[naht + 480 + 1], 0.5 * MITTE), -5.0 * (480.0 + 1.0) / spb_ganz / 16.0, 0.05);
      }
    }
  }
  {  // 3b. Seam, played value (after the step-16 hold): auto_buf_ is written after the hold, so the first 64 samples after the wrap must follow the exact lane
     // value within the hold tolerance (0.03 dB), with the hold at 16 and at 1 (diagnosis of the Z2 seam deviation, hypothesis H1: hold not reset at the wrap)
    for (int schritt : {16, 1}) {
      Treiber t;
      aufbau(t, &a->a, {P(0, 0.f), P(16, -5.f), P(32, -30.f)}, 120.0, 40.0);
      t.arr.setze_auto_schritt(schritt);
      t.arr.loop(true, 0.0, 32.0, 0, t.k);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      Aufz z;
      lauf(t, 900 + 33 * 24000, z);
      const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
      const int64_t naht = std::llround(t.k.sample_at(32.0 + t.k.beat_at(static_cast<double>(s_start))));
      double worst = 0.0;
      int first_bad = -1;
      for (int j = 0; j < 64; ++j) {
        const double soll = -5.0 * z.ap[naht + j] / 16.0;   // first segment of the lane
        const double d = std::fabs(z.buf[naht + j] - soll);
        if (d > worst) worst = d;
        if (d > 0.03 + 1e-4 && first_bad < 0) first_bad = j;
      }
      std::printf("arr_auto seam 64 samples, hold %d: largest deviation of the played value from the exact lane %.5f dB, first sample outside 0.03 dB: %d\n", schritt, worst, first_bad);
      PRUEF(worst <= 0.03 + 1e-4);
    }
  }
  {  // 3c. Seam at the output (way B, sample-exact): the loop 0..16 with the lane 0 -> -30 dB over 0..16 against the same loop without a lane. From 1000 samples
     // before the wrap to 1500 after it, the master output of the lane run is the output of the control run times lin(Lane(project beat)), per sample.
     // This separates the core (the seam short blend and the entry ramp are linear and equal in both runs) from the measurement at the target (Z2 diagnosis).
     // Step 1: exact (1e-5 relative). Step 16 (default): within the hold tolerance (0.03 dB = 0.35 %). A sine and a constant clip.
    auto sin_a = Audio::sinus(1200000, 440.0, 0.3f);
    struct Quelle { const char* name; const cdj::ArrAudio* audio; };
    // two lane shapes: the straight line (Z2) and a knee at beat 8 (-5 dB), where a cursor stale after the wrap gives a wrong value (negative control of the mutation)
    auto lane_db = [](int knie, double b) { return knie ? (b < 8.0 ? -5.0 * b / 8.0 : -5.0 - 25.0 * (b - 8.0) / 8.0) : -30.0 * b / 16.0; };
    for (int knie : {0, 1})
    for (const Quelle& q : {Quelle{"dc", &a->a}, Quelle{"sine", &sin_a->a}}) {
      for (int schritt : {1, 16}) {
        std::vector<float> ausgang[2];
        Aufz zl;
        int64_t naht = 0;
        for (int mit_lane = 0; mit_lane < 2; ++mit_lane) {
          Treiber t;
          aufbau(t, q.audio, mit_lane ? (knie ? std::vector<ArrAutoPunkt>{P(0, 0.f), P(8, -5.f), P(16, -30.f)} : std::vector<ArrAutoPunkt>{P(0, 0.f), P(16, -30.f)}) : std::vector<ArrAutoPunkt>{}, 120.0, 40.0);
          t.arr.setze_auto_schritt(schritt);
          t.arr.loop(true, 0.0, 16.0, 0, t.k);
          t.arr.start(0.0, 0, false, 0, V, 256, t.k);
          Aufz z;
          lauf(t, 900 + 17 * 24000, z);
          ausgang[mit_lane] = t.l;
          if (mit_lane) {
            zl = z;
            const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
            naht = std::llround(t.k.sample_at(16.0 + t.k.beat_at(static_cast<double>(s_start))));
          }
        }
        PRUEF(naht > 1000 && naht + 1500 < static_cast<int64_t>(ausgang[0].size()) && ausgang[0].size() == ausgang[1].size());
        const double tor = schritt == 1 ? 1e-5 : 0.0036;
        int64_t schlecht = 0, erste = -1, geprueft = 0;
        double schlechtester = 0.0;
        for (int64_t x = naht - 1000; x < naht + 1500; ++x) {
          const double c = ausgang[0][x];
          if (std::fabs(c) < 1e-3) continue;   // close to zero: the ratio is noise
          ++geprueft;
          const double soll = lin(lane_db(knie, zl.ap[x]));
          const double rel = std::fabs(ausgang[1][x] - c * soll) / std::fabs(c * soll > 1e-6 ? c * soll : c);
          if (rel > schlechtester) schlechtester = rel;
          if (rel > tor) { ++schlecht; if (erste < 0) erste = x; }
        }
        std::printf("arr_auto seam output, %s, knee %d, hold %d: %lld samples checked, %lld outside %.1e, largest relative deviation %.2e\n", q.name, knie, schritt,
                    static_cast<long long>(geprueft), static_cast<long long>(schlecht), tor, schlechtester);
        if (erste >= 0) {
          std::printf("  first deviating sample: wrap%+lld; next 20 (ratio lane/control, expected ratio, auto_buf dB):\n", static_cast<long long>(erste - naht));
          for (int64_t x = erste; x < erste + 20 && x < naht + 1500; ++x) {
            const double c = ausgang[0][x];
            std::printf("    wrap%+lld  %.6f  %.6f  %.4f\n", static_cast<long long>(x - naht), std::fabs(c) > 1e-6 ? ausgang[1][x] / c : 0.0,
                        lin(lane_db(knie, zl.ap[x])), zl.buf[x]);
          }
        }
        PRUEF(geprueft > 2000 && schlecht == 0);
      }
    }
  }
  {  // 4. AK6 start in the middle (way A): start at beat 6, the first lane sample of the entry sub-block is Lane(6), not Lane(0); start at 0 gives Lane(0)
    for (double ab : {6.0, 0.0}) {
      Treiber t;
      aufbau(t, &a->a, {P(0, 0.f), P(16, -32.f)});
      t.arr.start(ab, 0, false, 0, V, 256, t.k);
      Aufz z;
      lauf(t, 40000, z);
      const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
      const double soll_db = -32.0 * ab / 16.0;
      PRUEF_NAH(lin(z.buf[s_start]), lin(soll_db), 1e-6);
      PRUEF_NAH(z.ap[s_start], ab, 1e-9);
      if (ab > 0) PRUEF(z.buf[s_start] < -11.9);   // Lane(0) would be 0 dB: the positive control that the start takes the middle value
    }
  }
  {  // 5. jump (way A): two points at beat 8 (-10 | 0): at sample 8 - 1 the value is -10, at 8 it is 0, nothing in between
    Treiber t;
    aufbau(t, &a->a, {P(0, -10.f), P(8, -10.f), P(8, 0.f)});
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    Aufz z;
    lauf(t, 250000, z);
    const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
    const int64_t j = s_start + 8 * 24000;
    PRUEF_NAH(z.buf[j - 1], -10.0, 1e-6);
    PRUEF_NAH(z.buf[j], 0.0, 1e-6);
    for (int64_t x = j - 50; x < j + 50; ++x) PRUEF(z.buf[x] == -10.0f || z.buf[x] == 0.0f);   // no value in between
  }
  {  // 6. tempo ramp (way A): ap_[t] equals projekt_beat(k, t) at every sample (max deviation 0); a jump inside the ramp sits at the same sample
    //    as the exact beat map says. Mutation ARR_AUTO_BEAT_LINEAR (linear between the ends of the sub-block) makes this red.
    Treiber t;
    t.n = 1024;
    t.k = cdj::Karte(60.0, 0);
    PRUEF(t.k.rampe(2.0, 300.0, 2.0));
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
    b.lane(1, {P(0, 0.f), P(3.0, -10.f), P(3.0, -20.f), P(8.0, -20.f)});
    t.laden(b.fertig());
    t.arr.start(0.0, 0, false, 0, V, 1024, t.k);
    Aufz z;
    lauf(t, 4 * 48000, z);
    double worst = 0.0;
    int64_t sprung = -1;
    for (size_t x = 0; x < z.buf.size(); ++x) {
      if (z.ap[x] == 0.0 && z.buf[x] == 0.0f) continue;   // not part of a lane sub-block
      worst = std::max(worst, std::fabs(z.ap[x] - Z::projekt_beat(t.arr, t.k, static_cast<double>(x))));
      if (sprung < 0 && z.buf[x] <= -19.0f) sprung = static_cast<int64_t>(x);
    }
    PRUEF(worst == 0.0);
    // the exact first sample with a project beat >= 3: the jump to -20 must start there
    int64_t erwartet = -1;
    for (int64_t x = 0; x < 4 * 48000 && erwartet < 0; ++x)
      if (Z::projekt_beat(t.arr, t.k, static_cast<double>(x)) >= 3.0) erwartet = x;
    PRUEF(erwartet > 0 && sprung == erwartet);
  }

  // ---- task 6b: the base value stays true, the source blend (AK23) -------------------------------------------------------------------------
  const auto fader = [](Treiber& x) { return x.tab.suche("spur/1/fader"); };
  {  // K1 stop: lane 0 -> -24 dB over beats 0..16, stop at beat 12 (level -18 dB), base value 0 dB. The gain runs to the base value in 480 samples
     // (+-1) linearly, no single step: the largest sample-to-sample step of the gain is at most 1/480 + eps. Mutation ARR_AUTO_BLENDE_HART: red.
    Treiber t;
    aufbau(t, &a->a, {P(0, 0.f), P(16, -24.f)});
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    Aufz z;
    lauf(t, 800 + 12 * 24000, z);
    const int64_t halt = t.s + 64;   // the stop falls in the middle of a block
    t.arr.stopp(0, halt, t.k);
    lauf(t, halt + 4000, z);
    const double g_vor = lin(z.buf[halt - 1]);
    PRUEF(g_vor < 0.13 && g_vor > 0.12);   // about -18 dB before the stop: the positive control that the lane played
    double groesster = 0.0;
    for (int64_t x = halt; x < halt + 600; ++x) groesster = std::max(groesster, std::fabs(lin(z.buf[x]) - lin(z.buf[x - 1])));
    PRUEF(groesster <= 1.0 / 480.0 + 1e-4);
    PRUEF_NAH(lin(z.buf[halt + 479]), 1.0, 1e-5);       // the blend ends on the base value ...
    PRUEF_NAH(z.buf[halt + 700], 0.0, 0.0);             // ... and stays exactly there
    for (int j : {0, 119, 239, 359, 478}) PRUEF_NAH(lin(z.buf[halt + j]), g_vor + (1.0 - g_vor) * (j + 1) / 480.0, 2e-4);   // linear in the gain
  }
  {  // K2 lane deleted: base value -6 dB, lane 0 -> -30 dB playing; ARR_LADEN of a playback without a lane: the same blend, then wert(0, 0) is the base
     // value -6 (not the last lane value: the invariant of D5a point 4). Mutation ARR_AUTO_GRUND_UEBERSCHRIEBEN: red.
    Treiber t;
    aufbau(t, &a->a, {P(0, 0.f), P(16, -30.f)});
    t.arr.setze_sofort(fader(t), -6.0f);
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    Aufz z;
    lauf(t, 800 + 8 * 24000, z);
    PRUEF_NAH(t.arr.wert(0, 0), -6.0, 1e-6);   // while the lane plays the base value stays
    const int64_t tausch = t.s;
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
    t.laden(b.fertig());                        // the same clip, no lane
    lauf(t, tausch + 3000, z);
    PRUEF_NAH(t.arr.wert(0, 0), -6.0, 1e-6);   // after the swap: the base value, not the lane value of about -15 dB
    PRUEF_NAH(db_von_pegel(t.l[tausch + 2500], 0.5 * MITTE), -6.0, 0.05);
    const double vor = -30.0 * (static_cast<double>(tausch) - t.arr.zustand(t.k, t.s).ursprung_sample) / 24000.0 / 16.0;   // about -15 dB
    PRUEF(vor < -14.0 && vor > -16.0);
    PRUEF(t.arr.stimmen_verloren() == 0 && t.arr.noten_verloren() == 0);
  }
  {  // K3 snapshot swap (AK23): the lane plays, a point moves under the head (new value at the head differs by 5 dB): the level at the swap block
     // changes within the 10 ms blend (no step larger than the blend slope), no voice is lost
    Treiber t;
    aufbau(t, &a->a, {P(0, 0.f), P(16, -30.f)});
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    Aufz z;
    lauf(t, 800 + 8 * 24000, z);
    const int64_t tausch = t.s;
    Bau b;   // lane 0 -> -30 over 0..12 then flat: at beat 8 the value is -20 dB instead of -15
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
    b.lane(1, {P(0, 0.f), P(12, -30.f), P(16, -30.f)});
    t.laden(b.fertig());
    lauf(t, tausch + 3000, z);
    const double g_alt = lin(-15.0), g_neu = lin(-20.0);
    double groesster = 0.0;
    for (int64_t x = tausch; x < tausch + 700; ++x) groesster = std::max(groesster, std::fabs(lin(z.buf[x]) - lin(z.buf[x - 1])));
    PRUEF(groesster <= std::fabs(g_neu - g_alt) / 480.0 * 1.5 + 5e-4);
    PRUEF(z.buf[tausch + 1000] < -20.0 && z.buf[tausch + 1000] > -21.0);                         // the new lane: -20 dB at the swap, falling 2.5 dB/beat
    PRUEF(t.arr.stimmen_verloren() == 0 && t.arr.noten_verloren() == 0);
  }
  {  // K4 stellwerk course under a lane: a course on spur/1/fader while the lane plays does not change the played level (the lane wins, slice 1 has no
     // takeover), but after the stop the level goes to the TARGET of the course (sw), not to the old base value
    Treiber t;
    aufbau(t, &a->a, {P(0, 0.f), P(16, -24.f)});
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    static float sw[cdj::ARR_BLOCK];
    Aufz z;
    const int64_t halt = 800 + 6 * 24000;
    bool gestoppt = false;
    float b6[6][cdj::ARR_BLOCK];
    while (t.s < halt + 6000) {
      for (int j = 0; j < t.n; ++j) sw[j] = -40.0f;   // the course: the fader goes (and stays) at -40 dB
      t.arr.verlauf(fader(t), sw);
      if (!gestoppt && t.s + t.n > halt) {
        t.arr.stopp(0, halt, t.k);
        gestoppt = true;
      }
      for (auto& x : b6) std::fill(x, x + t.n, 0.0f);
      t.arr.block(t.k, t.s, t.n, b6[0], b6[1], b6[2], b6[3], b6[4], b6[5]);
      t.l.insert(t.l.end(), b6[0], b6[0] + t.n);
      for (int j = 0; j < t.n; ++j) {
        z.buf.push_back(Z::auto_buf(t.arr, 0)[j]);
        z.ap.push_back(Z::ap(t.arr)[j]);
      }
      t.s += t.n;
    }
    const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
    PRUEF_NAH(z.buf[s_start + 2 * 24000], -3.0, 0.01);   // lane at beat 2: -3 dB, not the course (-40)
    PRUEF_NAH(db_von_pegel(t.l[s_start + 5 * 24000], 0.5 * MITTE), -7.5, 0.05);    // way B at beat 5: lane -7.5 dB
    PRUEF_NAH(z.buf[halt + 479], -40.0, 1e-6);    // the last blend sample is the target of the course (sw), not the old base value 0 dB
    PRUEF_NAH(t.arr.wert(0, 0), -40.0, 1e-6);
  }
  {  // 6 without a lane the core calculates as before: ap_ stays unwritten (no beat_at call), the buffer is never used, no lane pointer, and a start in the
     // middle of a block and a stop in the middle of a block carry the SOURCE value outside [auto_von_, auto_bis_) (way A)
    Treiber t;
    aufbau(t, &a->a, {});
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    Aufz z;
    lauf(t, 50000, z);
    bool nichts = true;
    for (size_t x = 0; x < z.ap.size(); ++x) nichts = nichts && z.ap[x] == 0.0 && z.buf[x] == 0.0f;
    PRUEF(nichts);
    PRUEF(!Z::vl_ist_puffer(t.arr, 0));
    Treiber u;   // the part-block case: lane on, base value -6; start at sample 793 (block 768..1023), stop in the middle of a later block
    aufbau(u, &a->a, {P(0, 0.f), P(16, -24.f)});
    u.arr.setze_sofort(fader(u), -6.0f);
    u.arr.start(0.0, 0, false, 0, V, 256, u.k);
    Aufz y;
    lauf(u, 5000, y);
    const int64_t s_start = u.arr.zustand(u.k, u.s).ursprung_sample;
    PRUEF(s_start % 256 != 0);
    for (int64_t x = (s_start / 256) * 256; x < s_start; ++x) PRUEF(y.buf[x] == -6.0f);   // before the entry: the base value, no rest of the block before
    PRUEF_NAH(y.buf[s_start], 0.0, 1e-6);                                                // from the entry: the lane
    PRUEF(u.arr.wert(0, 0) == -6.0f);
  }

  {  // 7 step hold (task 8 fallback): the held value stays up to 16 samples, never drifts more than 0.03 dB from the exact lane value, a jump is exact,
     // and the mixer recomputes the gain only on a change. Without the hold (step 1) the buffer changes at (nearly) every sample.
    const auto zaehle = [&](int schritt, bool sprung, double& groesste_abw, int64_t& sprung_sample) {
      Treiber t;
      if (sprung) aufbau(t, &a->a, {P(0, 0.f), P(8, -10.f), P(8, -40.f), P(16, -50.f)});
      else aufbau(t, &a->a, {P(0, 0.f), P(16, -24.f)});
      t.arr.setze_auto_schritt(schritt);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      Aufz z;
      lauf(t, 800 + 10 * 24000, z);
      int aenderungen = 0;
      groesste_abw = 0.0;
      sprung_sample = -1;
      for (size_t x = 1; x < z.buf.size() && x < z.ap.size(); ++x) {
        if (z.ap[x] <= 0.0) continue;   // before the entry the buffer carries the source value
        aenderungen += z.buf[x] != z.buf[x - 1];
        cdj::AutoLane exakt(sprung ? ref_sprung : ref_rampe, sprung ? 4 : 2);
        groesste_abw = std::max(groesste_abw, std::fabs(static_cast<double>(z.buf[x]) - exakt.wert_bei(z.ap[x])));
        if (sprung && sprung_sample < 0 && z.buf[x] < -30.0f) sprung_sample = static_cast<int64_t>(x);
      }
      return aenderungen;
    };
    double abw16 = 0, abw1 = 0;
    int64_t sp16 = -1, sp1 = -1, d1 = -1, d2 = -1;
    const int n16 = zaehle(16, false, abw16, d1);
    const int n1 = zaehle(1, false, abw1, d2);
    std::printf("hold: changes with step 16: %d, with step 1: %d, largest deviation %.4f dB (step 1: %.4f dB)\n", n16, n1, abw16, abw1);
    PRUEF(n1 > 100000 && n16 < n1 / 8);             // the hold thins the gain computations by about 16
    PRUEF(abw16 <= 0.0301 && abw1 <= 1e-4);           // the held value stays within AUTO_HALT_DB, step 1 is exact
    double u1 = 0, u2 = 0;
    zaehle(16, true, u1, sp16);
    zaehle(1, true, u2, sp1);
    PRUEF(sp16 > 0 && sp16 == sp1);                   // the jump sits at the same sample with and without the hold
    PRUEF(u1 <= 0.0301);
  }
  {  // 8 slice 2: a track with lanes [pan, fader] plays the fader lane as gain, never the pan lane; a track with only a pan lane keeps its level
     // way B as in case 1 but the level is the power sqrt(L^2 + R^2) / 0.5 (constant-power pan keeps it whatever the pan): fader 0 -> -30 dB over beats 4..20;
     // the pan lane (0 -> -1 over the same beats) would read as a 1 dB drop if it were taken as gain
    const auto pegel = [&](bool mit_fader, bool pan_zuerst, int b) {
      Treiber t;
      t.k = cdj::Karte(120.0, 0);
      Bau bb;
      bb.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
      if (pan_zuerst) bb.lane(1, {P(4, 0.f), P(20, -1.f)}, cdj::ARR_AUTO_PAN);
      if (mit_fader) bb.lane(1, {P(4, 0.f), P(20, -30.f)});
      if (!pan_zuerst) bb.lane(1, {P(4, 0.f), P(20, -1.f)}, cdj::ARR_AUTO_PAN);
      t.laden(bb.fertig());
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      t.lauf(500000);
      const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
      const int64_t sm = s_start + static_cast<int64_t>(b * SPB);
      return db_von_pegel(std::sqrt(static_cast<double>(t.l[sm]) * t.l[sm] + static_cast<double>(t.r[sm]) * t.r[sm]), 0.5);
    };
    for (int b : {8, 12, 16, 20}) {
      const double soll = -30.0 * (b - 4) / 16.0;
      PRUEF_NAH(pegel(true, true, b), soll, 0.05);    // [pan, fader]
      PRUEF_NAH(pegel(true, false, b), soll, 0.05);   // [fader, pan]: positive control, the order does not matter
    }
    for (int b : {8, 20}) PRUEF_NAH(pegel(false, true, b), 0.0, 0.01);   // only a pan lane: the level is the base value
  }
  {  // 9 slice 2 task 3 (way A, pan = field 1): the pan buffer. Lane -1 -> 1 over beats 0..16 with a loop bracket 0..16.
     // (a) hold 1: the buffer equals the exact lane value at every played sample and at the seam (1e-6); (b) hold 16: within AUTO_HALT_PAN 0.002, the seam
     // sample exact, and far fewer value changes (the hold thins the cos/sin work of the mixer).
    static const ArrAutoPunkt pan_lane[2] = {{0.0, -1.f, 0}, {16.0, 1.f, 0}};
    int aend[2] = {0, 0};
    for (int schritt : {1, 16}) {
      Treiber t;
      t.k = cdj::Karte(120.0, 0);
      Bau bb;
      bb.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
      bb.lane(1, {pan_lane[0], pan_lane[1]}, cdj::ARR_AUTO_PAN);
      t.laden(bb.fertig());
      t.arr.setze_auto_schritt(schritt);
      t.arr.loop(true, 0.0, 16.0, 0, t.k);
      t.arr.start(0.0, 0, false, 0, V, 256, t.k);
      Aufz z;
      lauf(t, 900 + 17 * 24000, z, 0, 1);
      const int64_t s_start = t.arr.zustand(t.k, t.s).ursprung_sample;
      const int64_t naht = std::llround(t.k.sample_at(16.0 + t.k.beat_at(static_cast<double>(s_start))));
      PRUEF(naht > 0 && naht < static_cast<int64_t>(z.buf.size()));
      double abw = 0.0;
      int n = 0, aenderungen = 0;
      for (size_t x = 1; x < z.buf.size() && x < z.ap.size(); ++x) {
        if (z.ap[x] <= 0.0 || static_cast<int64_t>(x) < s_start) continue;
        cdj::AutoLane exakt(pan_lane, 2);
        abw = std::max(abw, std::fabs(static_cast<double>(z.buf[x]) - exakt.wert_bei(z.ap[x])));
        aenderungen += z.buf[x] != z.buf[x - 1];
        ++n;
      }
      aend[schritt == 1 ? 0 : 1] = aenderungen;
      std::printf("pan buffer, hold %d: %d played samples, largest deviation %.7f, value changes %d\n", schritt, n, abw, aenderungen);
      PRUEF(n > 300000);
      PRUEF(abw <= (schritt == 1 ? 1e-6 : 0.0020001));
      if (naht > 0 && naht < static_cast<int64_t>(z.buf.size())) {
        PRUEF_NAH(z.buf[naht], -1.0, 1e-6);                                 // the first sample after the wrap is Lane(0)
        PRUEF_NAH(z.buf[naht - 1], 1.0 - 2.0 / 24000.0 / 16.0, schritt == 1 ? 1e-6 : 0.0020001);   // the one before is Lane(16 - one sample), within the hold: no jump ahead of the seam
      }
    }
    PRUEF(aend[0] > 100000 && aend[1] < aend[0] / 8);
  }
  {  // 9b pan stop: lane -1 -> 1 over beats 0..16, stop at beat 12 (pan 0.5), base pan 0. The pan runs to the base value in 480 samples, linear in the pan
     // VALUE (not in a gain), no step. Mutation ARR_AUTO_PAN_BLENDE_HART: red.
    Treiber t;
    t.k = cdj::Karte(120.0, 0);
    Bau bb;
    bb.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &a->a);
    bb.lane(1, {P(0, -1.f), P(16, 1.f)}, cdj::ARR_AUTO_PAN);
    t.laden(bb.fertig());
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    Aufz z;
    lauf(t, 800 + 12 * 24000, z, 0, 1);
    const int64_t halt = t.s + 64;
    t.arr.stopp(0, halt, t.k);
    lauf(t, halt + 4000, z, 0, 1);
    const double vor = z.buf[halt - 1];
    PRUEF(vor > 0.45 && vor < 0.55);   // about 0.5 before the stop: the positive control that the pan lane played
    double groesster = 0.0;
    for (int64_t x = halt; x < halt + 600; ++x) groesster = std::max(groesster, std::fabs(static_cast<double>(z.buf[x]) - z.buf[x - 1]));
    PRUEF(groesster <= vor / 480.0 * 1.01 + 1e-6);
    for (int j : {0, 119, 239, 359, 478}) PRUEF_NAH(z.buf[halt + j], vor * (1.0 - (j + 1) / 480.0), 2e-5);
    PRUEF_NAH(z.buf[halt + 479], 0.0, 0.0);
    PRUEF_NAH(z.buf[halt + 700], 0.0, 0.0);
  }
  PRUEF_ENDE();
}
