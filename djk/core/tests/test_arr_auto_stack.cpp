// 1.12 slice 5 U9 (T9.2, T9.3; plan D9, spec 5.11 a): the value stack in the core. A track can carry, next to the absolute lane of a target, a RELATIVE lane (`relativ`: a
// summand). The core plays base value or absolute lane, plus the relative lane, clamped to the range of the target. Measured two ways, as the other lane tests do: (A) the lane
// buffers auto_buf_[track][field] through the friend struct (everything that hangs on one sample), (B) the audio level of a constant clip (0.5) at the master.
//   1. AK21: absolute fader lane 0 -> -30 dB (beats 4..20) plus a relative lane of -6 dB: the output is the lane minus 6 dB within 0.05 dB at five beats. Control: the same
//      track without the relative lane plays the lane itself.
//   2. two moving lanes (absolute flat -10, relative 0 -> -12 over 16 beats; the same for pan): the sum, and the run with the look-ahead of the hold equals the run
//      without it sample for sample (the stacked look-ahead changes nothing but the cost).
//   3. relative lane only (no absolute lane): base value plus relative lane; the hand moving the base moves the stack with it (nothing to override, nothing yields);
//      after the stop the base value alone.
//   4. clamp (mutation ARR_AUTO_REL_OHNE_KLEMME): fader base 4 dB + 6 dB relative plays +6 dB, not +10; absolute pan 0.8 + relative 0.7 plays 1.0 (R only), relative
//      pan -2 on pan 0 plays -1; a sum inside the range is not touched (0.2 + -0.5 = -0.3).
//   5. T9.3 blend: a relative lane that appears at a snapshot swap blends over 480 samples (no gain step above the blend slope), one that vanishes blends back, one that
//      appears on a track without any lane blends too (mutation ARR_AUTO_REL_OHNE_BLENDE: the summand is added after the blend, a hard step: red).
//   6. T9.3 override (D9): while the hand overrides the fader, absolute AND relative lane yield (the hand value alone plays, 480 blend), the re-enable brings both back
//      (mutation ARR_AUTO_REL_BEI_UEBERSTEUERUNG: the relative lane stays on the hand value: red). Control: without a grip the stack plays all along.
//   7. a loop seam with a relative lane only: the first sample after the wrap is the stack at beat 0, the cursor of the relative lane is searched anew (mutation
//      ARR_AUTO_CURSOR_ALT, which every AutoLane honours, turns it red).
//   8. no relative lane: the absolute lane alone plays the lane value, as before.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <vector>

#include "arr_build.h"
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

ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }
double lin(double db) { return db <= -120.0 ? 0.0 : std::pow(10.0, db / 20.0); }
double db_von(double g) { return 20.0 * std::log10(std::max(g, 1e-12)); }

struct Spec {
  std::vector<ArrAutoPunkt> p;
  uint8_t ziel;
  bool rel;
};
std::vector<ArrAutoPunkt> FLACH(double wert) { return {P(0, static_cast<float>(wert)), P(40, static_cast<float>(wert))}; }

cdj::ArrSnapshot* snap(Audio& au, int64_t nr, const std::vector<Spec>& ls) {
  Bau b(nr);
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 40.0, &au.a);
  for (const Spec& l : ls) b.lane(1, l.p, l.ziel, 0, l.rel);
  return b.fertig();
}

struct Szene {
  std::unique_ptr<Audio> au = Audio::gleich(1200000);
  // arr-bk: the driver holds a whole Stellwerk (about 4 MB since the table ceiling is 4096), so it lives on the heap; several scenes at once overflowed the 8 MB stack
  std::unique_ptr<Treiber> tp = std::make_unique<Treiber>();
  Treiber& t = *tp;
  float hand[4][cdj::ARR_BLOCK];
  int r[4];
  std::vector<float> buf[4];   // auto_buf_ of track 0 per field, index = core sample
  explicit Szene(const std::vector<Spec>& ls, bool vorausschau = true) {
    t.k = cdj::Karte(120.0, 0);
    t.arr.setze_auto_vorausschau(vorausschau);
    t.laden(snap(*au, 1, ls));
    r[0] = t.tab.suche("spur/1/fader");
    r[1] = t.tab.suche("spur/1/pan");
    r[2] = t.tab.suche("spur/1/mute");
    r[3] = t.tab.suche("spur/1/solo");
    PRUEF(r[0] >= 0 && r[1] >= 0);
  }
  void starten() { PRUEF(t.arr.start(0.0, 0, false, t.s, V, 256, t.k)); }
  int64_t start_sample() { return t.arr.zustand(t.k, t.s).ursprung_sample; }
  template <class F> void lauf(int64_t bis, F&& vor) {
    float b[6][cdj::ARR_BLOCK];
    while (t.s < bis) {
      for (auto& x : b) std::fill(x, x + t.n, 0.0f);
      vor(t.s);
      t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
      t.l.insert(t.l.end(), b[0], b[0] + t.n);
      t.r.insert(t.r.end(), b[1], b[1] + t.n);
      for (int f = 0; f < 4; ++f) {
        if (buf[f].size() < static_cast<size_t>(t.s + t.n)) buf[f].resize(static_cast<size_t>(t.s + t.n), 0.0f);
        std::copy(Z::buf(t.arr, 0, f), Z::buf(t.arr, 0, f) + t.n, buf[f].begin() + t.s);
      }
      t.s += t.n;
    }
  }
  void lauf(int64_t bis) { lauf(bis, [](int64_t) {}); }
  void hand_setzen(int f, float v) {   // the Stellwerk course of the field from the next block on: a constant
    std::fill(hand[f], hand[f] + cdj::ARR_BLOCK, v);
    t.arr.verlauf(r[f], hand[f]);
  }
  double gain_db(int64_t s) const { return db_von(std::fabs(t.l[static_cast<size_t>(s)]) / (0.5 * MITTE)); }
  int64_t block_bei(double beat) { return (static_cast<int64_t>(start_sample() + beat * SPB120) / 256 + 1) * 256; }
  int64_t bei(double beat) { return start_sample() + static_cast<int64_t>(beat * SPB120); }
  float fb(int f, int64_t s) const { return buf[f][static_cast<size_t>(s)]; }
};

double groesster_schritt(const Szene& z, int64_t von, int64_t bis) {   // largest sample-to-sample step of the fader GAIN in the buffer
  double g = 0.0;
  for (int64_t x = von; x < bis; ++x) g = std::max(g, std::fabs(lin(z.fb(0, x)) - lin(z.fb(0, x - 1))));
  return g;
}
}  // namespace

int main() {
  const std::vector<ArrAutoPunkt> LANE = {P(4, 0.f), P(20, -30.f)};   // as AK4
  {  // 1. AK21: absolute lane 0 -> -30 dB plus relative -6 dB
    Szene z({{LANE, cdj::ARR_AUTO_FADER, false}, {FLACH(-6.0), cdj::ARR_AUTO_FADER, true}});
    Szene k({{LANE, cdj::ARR_AUTO_FADER, false}});   // control: no relative lane
    z.starten();
    k.starten();
    z.lauf(z.bei(21.0));
    k.lauf(k.bei(21.0));
    for (int b : {4, 8, 12, 16, 20}) {
      const double lane = b <= 4 ? 0.0 : -30.0 * (b - 4) / 16.0;
      PRUEF_NAH(z.gain_db(z.bei(b)), lane - 6.0, 0.05);
      PRUEF_NAH(k.gain_db(k.bei(b)), lane, 0.05);   // the control plays the lane itself, so the 6 dB difference is the relative lane
      PRUEF_NAH(z.fb(0, z.bei(b)), lane - 6.0, 0.03);   // the buffer holds the stack
    }
  }
  {  // 2. two moving lanes, look-ahead against no look-ahead
    const std::vector<Spec> fader = {{FLACH(-10.0), cdj::ARR_AUTO_FADER, false}, {{P(0, 0.f), P(16, -12.f)}, cdj::ARR_AUTO_FADER, true}};
    std::vector<Spec> beide = fader;
    beide.push_back({{P(0, -0.5f), P(16, 0.5f)}, cdj::ARR_AUTO_PAN, false});
    beide.push_back({{P(0, 0.25f), P(16, -0.25f)}, cdj::ARR_AUTO_PAN, true});
    Szene f(fader);
    f.starten();
    f.lauf(f.bei(15.0));
    for (double b : {2.0, 6.0, 10.0, 14.0}) PRUEF_NAH(f.gain_db(f.bei(b)), -10.0 - 12.0 * b / 16.0, 0.05);
    Szene a(beide, true), o(beide, false);
    a.starten();
    o.starten();
    a.lauf(a.bei(15.0));
    o.lauf(o.bei(15.0));
    int ungleich = 0;
    double lo = 1e9, hi = -1e9, plo = 1e9, phi = -1e9;
    for (size_t x = static_cast<size_t>(a.start_sample()); x < static_cast<size_t>(a.bei(14.0)); ++x) {
      if (a.buf[0][x] != o.buf[0][x] || a.buf[1][x] != o.buf[1][x]) ++ungleich;
      lo = std::min<double>(lo, a.buf[0][x]);
      hi = std::max<double>(hi, a.buf[0][x]);
      plo = std::min<double>(plo, a.buf[1][x]);
      phi = std::max<double>(phi, a.buf[1][x]);
    }
    std::printf("stack 2: %d differing samples between look-ahead and per-sample run; fader buffer %.3f .. %.3f dB, pan buffer %.3f .. %.3f\n", ungleich, lo, hi, plo, phi);
    PRUEF(ungleich == 0);
    PRUEF(hi > lo + 8.0 && phi > plo + 0.4);   // the buffers really moved: the equality is not that of two constants
    PRUEF_NAH(a.fb(0, a.bei(8.0)), -10.0 - 6.0, 0.03);
    PRUEF_NAH(a.fb(1, a.bei(8.0)), 0.0, 0.003);   // pan: -0.5 + u + 0.25 - 0.5 u at u = 0.5 is 0
    PRUEF_NAH(a.fb(1, a.bei(12.0)), -0.5 + 0.75 + 0.25 - 0.375, 0.003);
  }
  {  // 3. relative lane only: base value + relative; the hand moves the base; after the stop the base alone
    Szene z({{FLACH(-6.0), cdj::ARR_AUTO_FADER, true}});
    z.t.arr.setze_sofort(z.r[0], -3.0f);
    z.starten();
    PRUEF(!z.t.arr.auto_lane_da(0, 0));   // there is no absolute lane to override
    z.lauf(z.bei(4.0));
    for (double b : {1.0, 2.0, 3.0}) PRUEF_NAH(z.fb(0, z.bei(b)), -9.0, 0.001);
    PRUEF_NAH(z.gain_db(z.bei(3.0)), -9.0, 0.05);
    PRUEF(!z.t.arr.auto_uebersteuern(0, 0, true, z.t.s));   // nothing to take over
    const int64_t G = z.block_bei(4.0);
    z.lauf(G + 4000, [&](int64_t s0) {
      if (s0 == G) z.hand_setzen(0, -20.0f);   // the hand (a Stellwerk course) moves the base
    });
    PRUEF_NAH(z.fb(0, G + 3000), -26.0, 0.001);   // -20 + -6: the relative lane modulates the live base
    PRUEF_NAH(z.gain_db(G + 3000), -26.0, 0.05);
    const int64_t halt = z.t.s + 64;
    z.t.arr.stopp(0, halt, z.t.k);
    z.lauf(halt + 4000);
    PRUEF_NAH(z.fb(0, halt + 700), -20.0, 1e-4);   // after the stop and the blend: the base alone
    Szene n(std::vector<Spec>{});   // control: no lane at all plays 0 dB
    n.starten();
    n.lauf(n.bei(1.0));
    PRUEF_NAH(n.gain_db(n.bei(0.5)), 0.0, 0.05);
  }
  {  // 4. clamp
    {  // fader: base 4 dB + relative 6 dB = 10, clamped to 6
      Szene z({{FLACH(6.0), cdj::ARR_AUTO_FADER, true}});
      z.t.arr.setze_sofort(z.r[0], 4.0f);
      z.starten();
      z.lauf(z.bei(3.0));
      float hoechst = -1e9f;
      for (int64_t x = z.bei(0.5); x < z.bei(3.0); ++x) hoechst = std::max(hoechst, z.fb(0, x));
      PRUEF_NAH(hoechst, 6.0, 1e-6);
      PRUEF_NAH(z.gain_db(z.bei(2.0)), 6.0, 0.05);
      Szene k({{FLACH(2.0), cdj::ARR_AUTO_FADER, true}});   // control: 4 + 2 = 6 inside the range plays 6
      k.t.arr.setze_sofort(k.r[0], 4.0f);
      k.starten();
      k.lauf(k.bei(3.0));
      PRUEF_NAH(k.gain_db(k.bei(2.0)), 6.0, 0.05);
      Szene m({{FLACH(1.0), cdj::ARR_AUTO_FADER, true}});   // control: 4 + 1 = 5 plays 5
      m.t.arr.setze_sofort(m.r[0], 4.0f);
      m.starten();
      m.lauf(m.bei(3.0));
      PRUEF_NAH(m.gain_db(m.bei(2.0)), 5.0, 0.05);
    }
    {  // pan: absolute 0.8 + relative 0.7 = 1.5, clamped to 1: R only
      Szene z({{FLACH(0.8), cdj::ARR_AUTO_PAN, false}, {FLACH(0.7), cdj::ARR_AUTO_PAN, true}});
      z.starten();
      z.lauf(z.bei(3.0));
      PRUEF_NAH(z.fb(1, z.bei(2.0)), 1.0, 1e-6);
      PRUEF_NAH(z.t.l[static_cast<size_t>(z.bei(2.0))], 0.0, 1e-6);
      PRUEF_NAH(z.t.r[static_cast<size_t>(z.bei(2.0))], 0.5, 1e-5);
      Szene a({{FLACH(0.8), cdj::ARR_AUTO_PAN, false}});   // control: the absolute lane alone plays 0.8
      a.starten();
      a.lauf(a.bei(3.0));
      PRUEF_NAH(a.fb(1, a.bei(2.0)), 0.8, 1e-6);
      Szene u({{FLACH(0.2), cdj::ARR_AUTO_PAN, false}, {FLACH(-0.5), cdj::ARR_AUTO_PAN, true}});   // inside the range: plain sum
      u.starten();
      u.lauf(u.bei(3.0));
      PRUEF_NAH(u.fb(1, u.bei(2.0)), -0.3, 1e-6);
      Szene n({{FLACH(-2.0), cdj::ARR_AUTO_PAN, true}});   // relative only: pan 0 + -2 = -2, clamped to -1
      n.starten();
      n.lauf(n.bei(3.0));
      PRUEF_NAH(n.fb(1, n.bei(2.0)), -1.0, 1e-6);
      PRUEF_NAH(n.t.r[static_cast<size_t>(n.bei(2.0))], 0.0, 1e-6);
    }
  }
  {  // 5. T9.3 blend of a relative lane that appears or vanishes at a swap
    const double g_alt = lin(-10.0), g_neu = lin(-30.0), SCHRITT = std::fabs(g_neu - g_alt) / 480.0;
    {  // appears: absolute -10 | absolute -10 + relative -20
      Szene z({{FLACH(-10.0), cdj::ARR_AUTO_FADER, false}});
      z.starten();
      z.lauf(z.bei(8.0));
      const int64_t tausch = z.t.s;
      PRUEF_NAH(z.fb(0, tausch - 1), -10.0, 1e-4);   // positive control: the lane plays before the swap
      z.t.laden(snap(*z.au, 2, {{FLACH(-10.0), cdj::ARR_AUTO_FADER, false}, {FLACH(-20.0), cdj::ARR_AUTO_FADER, true}}));
      z.lauf(tausch + 3000);
      const double g = groesster_schritt(z, tausch, tausch + 700);
      std::printf("stack 5a: largest gain step %.6f, blend slope %.6f, buffer 240 samples after the swap %.2f dB, at 1000 %.3f dB\n", g, SCHRITT, z.fb(0, tausch + 240), z.fb(0, tausch + 1000));
      PRUEF(g <= SCHRITT * 1.5 + 5e-4);
      PRUEF_NAH(z.fb(0, tausch + 1000), -30.0, 0.03);
      PRUEF(z.fb(0, tausch + 240) < -12.0 && z.fb(0, tausch + 240) > -29.0);   // in the middle of the blend
      PRUEF(z.t.arr.stimmen_verloren() == 0 && z.t.arr.noten_verloren() == 0);
    }
    {  // vanishes: stack -30 | absolute -10 alone
      Szene z({{FLACH(-10.0), cdj::ARR_AUTO_FADER, false}, {FLACH(-20.0), cdj::ARR_AUTO_FADER, true}});
      z.starten();
      z.lauf(z.bei(8.0));
      const int64_t tausch = z.t.s;
      PRUEF_NAH(z.fb(0, tausch - 1), -30.0, 0.03);
      z.t.laden(snap(*z.au, 2, {{FLACH(-10.0), cdj::ARR_AUTO_FADER, false}}));
      z.lauf(tausch + 3000);
      PRUEF(groesster_schritt(z, tausch, tausch + 700) <= SCHRITT * 1.5 + 5e-4);
      PRUEF_NAH(z.fb(0, tausch + 1000), -10.0, 0.03);
    }
    {  // appears on a track without any lane: base -3 | base -3 + relative -6
      Szene z(std::vector<Spec>{});
      z.t.arr.setze_sofort(z.r[0], -3.0f);
      z.starten();
      z.lauf(z.bei(8.0));
      const int64_t tausch = z.t.s;
      z.t.laden(snap(*z.au, 2, {{FLACH(-6.0), cdj::ARR_AUTO_FADER, true}}));
      z.lauf(tausch + 3000);
      const double s2 = std::fabs(lin(-9.0) - lin(-3.0)) / 480.0;
      const double gs = groesster_schritt(z, tausch + 1, tausch + 700);   // the buffer of a field without a lane is not written, so the sample before the swap is not a played value
      std::printf("stack 5c: largest gain step %.6f (limit %.6f), first samples %.3f %.3f %.3f\n", gs, s2 * 1.5 + 5e-4, z.fb(0, tausch), z.fb(0, tausch + 1), z.fb(0, tausch + 2));
      PRUEF(gs <= s2 * 1.5 + 5e-4);
      PRUEF_NAH(z.fb(0, tausch + 1000), -9.0, 0.03);
    }
    {  // pan: relative lane appears (blend in the pan value): 0.2 | 0.2 + 0.6
      Szene z({{FLACH(0.2), cdj::ARR_AUTO_PAN, false}});
      z.starten();
      z.lauf(z.bei(8.0));
      const int64_t tausch = z.t.s;
      z.t.laden(snap(*z.au, 2, {{FLACH(0.2), cdj::ARR_AUTO_PAN, false}, {FLACH(0.6), cdj::ARR_AUTO_PAN, true}}));
      z.lauf(tausch + 3000);
      double g = 0.0;
      for (int64_t x = tausch; x < tausch + 700; ++x) g = std::max(g, std::fabs(static_cast<double>(z.fb(1, x)) - z.fb(1, x - 1)));
      PRUEF(g <= 0.6 / 480.0 * 1.2 + 1e-5);
      PRUEF_NAH(z.fb(1, tausch + 1000), 0.8, 1e-4);
    }
  }
  {  // 6. T9.3 override (D9): absolute -10 + relative -6 = -16; the hand holds -20
    const std::vector<Spec> ls = {{FLACH(-10.0), cdj::ARR_AUTO_FADER, false}, {FLACH(-6.0), cdj::ARR_AUTO_FADER, true}};
    Szene z(ls);
    z.starten();
    const int64_t G = z.block_bei(4.0), sg = G + 100;
    bool ok = false;
    z.lauf(G + 8000, [&](int64_t s0) {
      if (s0 != G) return;
      z.hand_setzen(0, -20.0f);
      ok = z.t.arr.auto_uebersteuern(0, 0, true, sg);
    });
    PRUEF(ok);
    PRUEF_NAH(z.fb(0, sg - 1), -16.0, 0.03);       // positive control: the stack plays up to the grip
    PRUEF_NAH(z.gain_db(G + 3000), -20.0, 0.05);
    // the buffer of a field is written only while the lane or a blend plays; once the hand plays the whole block it is stale, so the step is measured over the 480 blend only
    PRUEF(groesster_schritt(z, sg, sg + 500) <= std::fabs(lin(-20.0) - lin(-16.0)) / 480.0 * 1.5 + 5e-4);
    PRUEF_NAH(z.fb(0, sg + 479), -20.0, 1e-4);   // the blend ends exactly on the hand value (no summand on it)
    const int64_t R = z.block_bei(7.0), sr = R + 100;
    bool frei = false;
    z.lauf(R + 8000, [&](int64_t s0) {
      if (s0 == R) frei = z.t.arr.auto_uebersteuern(0, 0, false, sr);
    });
    PRUEF(frei);
    PRUEF_NAH(z.fb(0, R + 3000), -16.0, 0.03);   // re-enable: both lanes are back
    PRUEF_NAH(z.gain_db(R + 3000), -16.0, 0.05);
    PRUEF(groesster_schritt(z, sr, sr + 700) <= std::fabs(lin(-20.0) - lin(-16.0)) / 480.0 * 1.5 + 5e-4);
    Szene k(ls);   // control: no grip, the stack plays all along
    k.starten();
    k.lauf(k.bei(8.0));
    for (double b : {1.0, 4.0, 7.0}) PRUEF_NAH(k.fb(0, k.bei(b)), -16.0, 0.03);
  }
  {  // 7. loop seam with a relative lane only (no absolute cursor exists, so a stale relative cursor is the only way to fail)
    Szene z({{{P(0, 0.f), P(8, -6.f), P(16, -24.f)}, cdj::ARR_AUTO_FADER, true}});
    z.t.arr.setze_sofort(z.r[0], -3.0f);
    z.t.arr.loop(true, 0.0, 16.0, 0, z.t.k);
    z.starten();
    z.lauf(z.bei(17.0));
    const int64_t naht = z.bei(16.0);
    PRUEF_NAH(z.fb(0, naht - 2), -3.0 - 24.0, 0.05);                 // the end of the lane before the wrap
    PRUEF_NAH(z.fb(0, naht + 5), -3.0, 0.03);                        // the stack at beat 0 right after the wrap
    PRUEF_NAH(z.fb(0, naht + 12000), -3.0 - 6.0 * 0.5 / 8.0, 0.05);   // half a beat into the first segment: -3 + (-6 * 0.5 / 8)
  }
  {  // 8. no relative lane: the absolute lane alone plays the lane value, as before
    Szene z({{LANE, cdj::ARR_AUTO_FADER, false}});
    z.starten();
    z.lauf(z.bei(13.0));
    PRUEF_NAH(z.fb(0, z.bei(12.0)), -15.0, 0.03);
    PRUEF_NAH(z.gain_db(z.bei(12.0)), -15.0, 0.05);
  }
  PRUEF_ENDE();
}
