// Automation Slice 1, task 5 (AK26 part): AutoLane, the pure evaluation of a fader lane (ADR 032). Four things are measured:
// (1) hand values (the same as the server test projekt_automation_modell, case 7), (2) the cursor: a monotone forward query over 1024 beats gives the
// same values as a binary search per query, and a backward jump (seam, start) searches anew and is right (mutation ARR_AUTO_CURSOR_ALT: no re-search
// after a backward jump, red), (3) 1000 pairs against lane_ref.json, which tests/daten/erzeuge_lane_ref.py wrote independently of this code, relative
// 1e-4, (4) the mute rule against the mixer formula of the stellwerk (STUMM -200, STUMM_GRENZE -120, STUMM_RAMPE -60, kern/stellwerk/src/kern.cpp:213),
// copied here with its source because the test target does not see the private include path of the stellwerk.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "cypherdj/arr_auto.h"
#include "pruef.h"

using cdj::ArrAutoPunkt;
using cdj::AutoLane;
using json = nlohmann::json;

static ArrAutoPunkt P(double beat, float wert, uint8_t form = 0) { return ArrAutoPunkt{beat, wert, form}; }

// the reference of this test: binary search per query, written independently of AutoLane (same rules, other structure)
static double ref_wert(const std::vector<ArrAutoPunkt>& p, double beat) {
  if (p.empty()) return 0.0;
  if (!(beat >= p[0].beat)) return p[0].wert;
  size_t lo = 0, hi = p.size() - 1;
  while (lo < hi) {
    const size_t mid = (lo + hi + 1) / 2;
    if (p[mid].beat <= beat) lo = mid; else hi = mid - 1;
  }
  if (lo == p.size() - 1 || p[lo].beat == beat) return p[lo].wert;
  const ArrAutoPunkt &a = p[lo], &b = p[lo + 1];
  if (b.form == 2) return a.wert;
  const double u = (beat - a.beat) / (b.beat - a.beat);
  const double g = b.form == 1 ? u * u * (3.0 - 2.0 * u) : u;
  double va = a.wert, vb = b.wert;
  if (va <= -120.0 && vb > -120.0) va = std::min(-60.0, vb);   // stellwerk kern.cpp:213, start_parameter
  if (vb <= -120.0) vb = va <= -120.0 ? -200.0 : std::min(-60.0, va);
  return va + (vb - va) * g;
}

int main() {
  {  // (1) hand values: 0 dB at beat 4 to -30 dB at beat 20, linear; midpoint -15
    const std::vector<ArrAutoPunkt> p = {P(4, 0.f), P(20, -30.f)};
    AutoLane l(p.data(), static_cast<int>(p.size()));
    PRUEF_NAH(l.wert_bei(0.0), 0.0, 1e-6);       // before the first point: its value
    PRUEF_NAH(l.wert_bei(4.0), 0.0, 1e-6);
    PRUEF_NAH(l.wert_bei(12.0), -15.0, 1e-5);
    PRUEF_NAH(l.wert_bei(20.0), -30.0, 1e-6);
    PRUEF_NAH(l.wert_bei(99.0), -30.0, 1e-6);    // after the last: the last value
    // s-curve at u = 0.25: 3u^2 - 2u^3 = 0.15625
    const std::vector<ArrAutoPunkt> s = {P(0, 0.f), P(8, -16.f, 1)};
    AutoLane ls(s.data(), 2);
    PRUEF_NAH(ls.wert_bei(2.0), -16.0 * 0.15625, 1e-5);
    // jump: two points at beat 8 (-10 | 0), the value at 8 - eps is -10, at 8 it is 0
    const std::vector<ArrAutoPunkt> j = {P(0, -10.f), P(8, -10.f), P(8, 0.f)};
    AutoLane lj(j.data(), 3);
    PRUEF_NAH(lj.wert_bei(7.9999), -10.0, 1e-6);
    PRUEF_NAH(lj.wert_bei(8.0), 0.0, 1e-6);
    // form jump: the left value holds up to the beat of the right point
    const std::vector<ArrAutoPunkt> fs = {P(0, -6.f), P(4, 0.f, 2)};
    AutoLane lf(fs.data(), 2);
    PRUEF_NAH(lf.wert_bei(3.999), -6.0, 1e-6);
    PRUEF_NAH(lf.wert_bei(4.0), 0.0, 1e-6);
    // a lane without points: 0 dB, no crash
    AutoLane leer(nullptr, 0);
    PRUEF_NAH(leer.wert_bei(3.0), 0.0, 0.0);
  }
  {  // (2) cursor: forward over 1024 beats equals the binary search; a backward jump with neu_suchen is right
    std::vector<ArrAutoPunkt> p;
    for (int i = 0; i < 64; ++i) p.push_back(P(i * 16.0, static_cast<float>(-(i % 7) * 5.0), static_cast<uint8_t>(i % 3)));
    AutoLane l(p.data(), static_cast<int>(p.size()));
    double worst = 0.0;
    for (int k = 0; k <= 1024 * 8; ++k) {
      const double b = k / 8.0;
      worst = std::max(worst, std::fabs(l.wert_bei(b) - ref_wert(p, b)));
    }
    PRUEF(worst <= 1e-5);
    // seam: the head jumps back to beat 3.5 (a loop wrap); the caller says so with neu_suchen
    l.neu_suchen(3.5);
    PRUEF_NAH(l.wert_bei(3.5), ref_wert(p, 3.5), 1e-5);
    PRUEF_NAH(l.wert_bei(3.75), ref_wert(p, 3.75), 1e-5);
    // the start in the middle: search anew at 700.25, then forward
    l.neu_suchen(700.25);
    PRUEF_NAH(l.wert_bei(700.25), ref_wert(p, 700.25), 1e-5);
    PRUEF_NAH(l.wert_bei(716.5), ref_wert(p, 716.5), 1e-5);
    // and back to the start: a second wrap
    l.neu_suchen(0.0);
    PRUEF_NAH(l.wert_bei(0.0), ref_wert(p, 0.0), 1e-5);
    PRUEF_NAH(l.wert_bei(40.0), ref_wert(p, 40.0), 1e-5);
  }
  {  // (3) 1000 pairs against the reference file (written by tests/daten/erzeuge_lane_ref.py)
    std::ifstream f(std::string(CYPHERDJ_DJK) + "/kern/tests/daten/lane_ref.json");
    PRUEF(static_cast<bool>(f));
    if (f) {
      const json j = json::parse(f);
      std::vector<std::vector<ArrAutoPunkt>> lanes;
      for (const json& lj : j.at("lanes")) {
        std::vector<ArrAutoPunkt> p;
        for (const json& q : lj) {
          const std::string fm = q.at("form").get<std::string>();
          p.push_back(P(q.at("beat").get<double>(), q.at("wert").get<float>(), static_cast<uint8_t>(fm == "linear" ? 0 : fm == "s" ? 1 : 2)));
        }
        lanes.push_back(std::move(p));
      }
      PRUEF(j.at("paare").size() == 1000);
      int schlecht = 0, mute_paare = 0;
      for (const json& pr : j.at("paare")) {
        const auto& p = lanes.at(pr.at("lane").get<size_t>());
        AutoLane l(p.data(), static_cast<int>(p.size()));
        l.neu_suchen(pr.at("beat").get<double>());   // random access: search anew
        const double ist = l.wert_bei(pr.at("beat").get<double>()), soll = pr.at("wert").get<double>();
        if (!(std::fabs(ist - soll) <= 1e-4 * std::max(1.0, std::fabs(soll)))) {
          if (schlecht++ < 5) std::fprintf(stderr, "lane %zu beat %.6f: ist %.6f soll %.6f\n", pr.at("lane").get<size_t>(), pr.at("beat").get<double>(), ist, soll);
        }
        if (soll <= -120.0) ++mute_paare;
      }
      PRUEF(schlecht == 0);
      PRUEF(mute_paare > 10);   // the file does hold mute cases (the positive control of the mute rule)
    }
  }
  {  // (4) mute rule: a ramp from mute to -20 starts at -60 (min(-60, -20)), a ramp to mute runs towards min(-60, left), mute to mute stays mute
    const std::vector<ArrAutoPunkt> a = {P(0, -200.f), P(8, -20.f)};
    AutoLane la(a.data(), 2);
    PRUEF_NAH(la.wert_bei(0.0), -200.0, 1e-6);   // the point itself is exact
    PRUEF_NAH(la.wert_bei(4.0), -60.0 + (-20.0 - -60.0) * 0.5, 1e-4);
    const std::vector<ArrAutoPunkt> b = {P(0, -10.f), P(8, -200.f)};
    AutoLane lb(b.data(), 2);
    PRUEF_NAH(lb.wert_bei(4.0), -10.0 + (-60.0 - -10.0) * 0.5, 1e-4);
    PRUEF_NAH(lb.wert_bei(8.0), -200.0, 1e-6);
    const std::vector<ArrAutoPunkt> c = {P(0, -200.f), P(8, -150.f)};
    AutoLane lc(c.data(), 2);
    PRUEF_NAH(lc.wert_bei(4.0), -200.0, 1e-6);
  }
  PRUEF_ENDE();
}
