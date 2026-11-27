// Partial analysis `analysiere`, resynthesis `harmonisch`, `hrrDb` and `hrrFrames` (the port of the engine `teilton-2`) against the golden
// vectors of `m21_gold.py --teil analyse` (per gold voice item: the prototype's HRR per evaluated frame and the partial amplitudes of
// 20 frames in the middle of a note) and against clean synthetic tones, including a 41 Hz note at the very start and at the very end of
// a source (the prototype raises there: the window is sized from the curve pitch but fitted with the refined pitch).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <variant>
#include <vector>

#include <nlohmann/json.hpp>

#include "intern.h"
#include "check.h"
#include "synth.h"
#include "teiltoene.h"

using namespace cdj::noten;
using json = nlohmann::json;

static const std::string GOLD = std::string(NOTEN_DATEN) + "/gold/";

static json leseJson(const std::string& pfad) {
  auto t = liesText(pfad);
  if (std::holds_alternative<Fehler>(t)) {
    std::fprintf(stderr, "%s: %s\n", pfad.c_str(), std::get<Fehler>(t).text.c_str());
    ++pruef_fehler;
    return json::object();
  }
  return json::parse(std::get<std::string>(t));
}

static Kurve goldKurve(const std::string& name) {
  auto k = liesSeitendatei(GOLD + name + ".kurve.json");
  if (std::holds_alternative<Fehler>(k)) {
    std::fprintf(stderr, "%s: %s\n", name.c_str(), std::get<Fehler>(k).text.c_str());
    ++pruef_fehler;
    return Kurve{};
  }
  return std::get<Seitendatei>(k).k;
}

/// A curve of a constant pitch: voiced for the frames whose centre lies in [von, bis] seconds.
static Kurve konstanteKurve(int64_t frames, double midi, double von, double bis) {
  Kurve k;
  k.frames = frames;
  k.detektor = "pyin";
  k.kurve = "pyin-1.noten_hmm-1";
  const int64_t nf = frameZahl(frames);
  k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
  k.konf.assign(static_cast<size_t>(nf), 1.0);
  for (int64_t j = 0; j < nf; ++j) {
    const double t = static_cast<double>(j * HOP) / SR;
    if (t >= von && t <= bis) k.f0_ct[static_cast<size_t>(j)] = midi * 100.0;
  }
  return k;
}

static bool endlich(const Teiltoene& t) {
  for (double v : t.psi) if (!std::isfinite(v)) return false;
  for (double v : t.f0) if (!std::isfinite(v)) return false;
  for (const auto* b : {&t.b_l, &t.b_r})
    for (const auto& f : *b)
      for (const auto& c : f) if (!std::isfinite(c.real()) || !std::isfinite(c.imag())) return false;
  return true;
}

int main() {
  const json index = leseJson(GOLD + "gold.json");
  PRUEF(index.contains("analyse"));
  const std::vector<std::string> items = index["analyse"]["items"].get<std::vector<std::string>>();
  PRUEF(items.size() == 9);

  // ---- per gold item: HRR per frame within 0.5 dB on at least 95 % of the voiced frames; partial amplitudes within 1 %
  for (const std::string& name : items) {
    const json g = leseJson(GOLD + name + ".teiltoene.json");
    PRUEF(g.value("format", "") == "cdj-noten-teiltoene/1");
    const Stereo x = synth::stereoAusMono(liesS16(GOLD + name + ".s16"));
    const Kurve k = goldKurve(name);
    PRUEF(x.frames() == k.frames && x.frames() > 0);

    std::vector<int64_t> frames;
    std::vector<double> soll;
    const auto& fr = g["hrr"]["frames"];
    const auto& db = g["hrr"]["db"];
    for (size_t i = 0; i < fr.size(); ++i) {
      if (db[i].is_null()) continue;
      frames.push_back(fr[i].get<int64_t>());
      soll.push_back(db[i].get<double>());
    }
    const std::vector<double> ist = hrrFrames(x, k, frames);
    PRUEF(ist.size() == frames.size());
    size_t gut = 0, n = 0;
    double schlimmst = 0;
    for (size_t i = 0; i < ist.size() && i < soll.size(); ++i) {
      ++n;
      const double d = std::fabs(ist[i] - soll[i]);
      if (std::isfinite(d) && d <= 0.5) ++gut;
      if (std::isfinite(d)) schlimmst = std::max(schlimmst, d);
    }
    std::printf("%-28s HRR frames %4zu, within 0.5 dB %5.1f %%, worst %.3f dB\n", name.c_str(), n, n ? 100.0 * gut / n : 0.0, schlimmst);
    PRUEF(n > 0 || name == "kurz");
    PRUEF(n == 0 || static_cast<double>(gut) >= 0.95 * static_cast<double>(n));

    // partial amplitudes of the 20 frames of the table
    const json& tab = g["tabelle"];
    const int64_t f0i = tab["frame0"].get<int64_t>();
    const int nfr = tab["frames"].get<int>(), nk = tab["teiltoene"].get<int>();
    const Teiltoene t = analysiere(x, k, f0i * HOP, (f0i + nfr - 1) * HOP);
    PRUEF(t.j0 <= f0i);
    PRUEF(endlich(t));
    double maxRel = 0;
    size_t zahl = 0, ausser = 0;
    for (int i = 0; i < nfr; ++i) {
      const size_t jl = static_cast<size_t>(f0i + i - t.j0);
      if (jl >= t.f0.size()) { PRUEF(false); continue; }
      PRUEF_NAH(t.f0[jl], tab["f0_hz"][static_cast<size_t>(i)].get<double>(), 0.01 * std::max(1.0, t.f0[jl] / 100.0));
      double groesst = 0;
      for (int q = 0; q < nk; ++q) groesst = std::max(groesst, std::fabs(tab["amp"][static_cast<size_t>(i)][static_cast<size_t>(q)].get<double>()));
      for (int q = 0; q < nk; ++q) {
        const double soll1 = tab["amp"][static_cast<size_t>(i)][static_cast<size_t>(q)].get<double>();
        const double ist1 = static_cast<size_t>(q) < t.b_l[jl].size() ? std::abs(t.b_l[jl][static_cast<size_t>(q)]) : 0.0;
        ++zahl;
        if (groesst > 0 && soll1 < 1e-4 * groesst) continue;   // partials 80 dB below the largest are not compared in percent
        const double rel = std::fabs(ist1 - soll1) / std::max(soll1, 1e-12);
        maxRel = std::max(maxRel, rel);
        if (rel > 0.01) ++ausser;
      }
    }
    std::printf("%-28s amplitudes: %zu values, worst relative deviation %.4f, %zu above 1 %%\n", name.c_str(), zahl, maxRel, ausser);
    PRUEF(ausser == 0);
  }

  // ---- x - h + h == x exactly in an unedited region (double arithmetic), and the region analysis equals the whole-file analysis
  {
    const std::string name = "stimme_vibrato";
    const Stereo x = synth::stereoAusMono(liesS16(GOLD + name + ".s16"));
    const Kurve k = goldKurve(name);
    const int64_t s0 = 20000, s1 = 50000;
    const Teiltoene t = analysiere(x, k, s0, s1);
    PRUEF(t.s0 == s0 && t.s1 == s1 && static_cast<int64_t>(t.psi.size()) == s1 - s0 && static_cast<int64_t>(t.phi.size()) == s1 - s0);
    std::vector<double> h;
    harmonisch(t, 0, h);
    PRUEF(static_cast<int64_t>(h.size()) == s1 - s0);
    double maxAbw = 0, spitze = 0;
    for (int64_t i = 0; i < s1 - s0; ++i) {
      const double xi = x.l[static_cast<size_t>(s0 + i)];
      const double y = (xi - h[static_cast<size_t>(i)]) + h[static_cast<size_t>(i)];
      maxAbw = std::max(maxAbw, std::fabs(y - xi));
      spitze = std::max(spitze, std::fabs(h[static_cast<size_t>(i)]));
    }
    PRUEF(maxAbw <= 1e-12);
    PRUEF(spitze > 0.01);
    // identical channels: fitted once
    PRUEF(t.b_l == t.b_r);
    std::vector<double> hr;
    harmonisch(t, 1, hr);
    PRUEF(hr == h);
    // the whole file gives the same partials in the middle (the phase origin is free, b and psi mod 2 pi are not)
    const Teiltoene w = analysiere(x, k, 0, x.frames());
    PRUEF(w.j0 == 0 && static_cast<int64_t>(w.f0.size()) == frameZahl(x.frames()));
    double maxB = 0;
    size_t zahl = 0;
    for (size_t i = 0; i < t.f0.size(); ++i) {
      const int64_t j = t.j0 + static_cast<int64_t>(i);
      if (j * HOP < s0 + 2048 || j * HOP > s1 - 2048) continue;
      const auto& a = t.b_l[i];
      const auto& b = w.b_l[static_cast<size_t>(j)];
      PRUEF(a.size() == b.size());
      for (size_t q = 0; q < std::min(a.size(), b.size()); ++q) { maxB = std::max(maxB, std::abs(a[q] - b[q])); ++zahl; }
    }
    std::printf("region against whole file: %zu partials, max difference %.3g\n", zahl, maxB);
    PRUEF(zahl > 1000 && maxB <= 1e-4);
    std::vector<double> hw;
    harmonisch(w, 0, hw);
    double maxH = 0;
    for (int64_t i = 2048; i < s1 - s0 - 2048; ++i) maxH = std::max(maxH, std::fabs(hw[static_cast<size_t>(s0 + i)] - h[static_cast<size_t>(i)]));
    std::printf("harmonic signal, region against whole file: max difference %.3g\n", maxH);
    PRUEF(maxH <= 1e-3);
  }

  // ---- clean synthetic tones: HRR of at least 30 dB (41 Hz bass tone and 1000 Hz tone)
  // The engine fits partials up to 16 kHz (as the prototype): the 1000 Hz tone has 15 partials, so none lies above that limit (with the
  // default 20 partials at 1/k the partials 17 to 20 hold 0.7 percent of the energy and cap the HRR at 21 dB).
  struct Fall { const char* name; double midi; int teiltoene; };
  for (const Fall& f : {Fall{"41 Hz", 28.0, 20}, Fall{"1000 Hz", 83.2135, 15}}) {
    synth::Ton ton;
    ton.start_s = 0.0;
    ton.dauer_s = 2.0;
    ton.midi = f.midi;
    ton.pegel = 0.3;
    ton.anstieg_s = 0.05;
    ton.abfall_s = 0.05;
    ton.teiltoene = f.teiltoene;
    const std::vector<float> m = synth::melodie({ton}, 2.0);
    const Stereo x = synth::stereoAusMono(m);
    const Kurve k = konstanteKurve(x.frames(), f.midi, 0.1, 1.9);
    const double h = hrrDb(x, k, 24000, 72000);
    std::printf("tone %-8s HRR %.2f dB\n", f.name, h);
    PRUEF(h >= 30.0);
  }

  // ---- a 41 Hz note at the very start (full level from the first sample) and one at the very end of a source: no failure, finite, good fit
  for (int ende = 0; ende < 2; ++ende) {
    synth::Ton ton;
    ton.start_s = 0.0;
    ton.dauer_s = 1.0;
    ton.midi = 28.0;
    ton.pegel = 0.3;
    ton.anstieg_s = 0.0;
    ton.abfall_s = 0.0;
    const std::vector<float> m = synth::melodie({ton}, 1.0);
    const Stereo x = synth::stereoAusMono(m);
    // start: voiced from frame 0 to the middle; end: voiced from the middle to the last frame
    const double mitte = 0.5;
    const Kurve k = ende ? konstanteKurve(x.frames(), 28.0, mitte, 10.0) : konstanteKurve(x.frames(), 28.0, 0.0, mitte);
    const int64_t nf = frameZahl(x.frames());
    const Teiltoene t = analysiere(x, k, 0, x.frames());
    PRUEF(static_cast<int64_t>(t.f0.size()) == nf);
    PRUEF(endlich(t));
    const size_t rand = ende ? static_cast<size_t>(nf - 1) : 0;
    PRUEF(t.f0[rand] > 40.0 && t.f0[rand] < 42.5);
    PRUEF(!t.b_l[rand].empty());
    PRUEF_NAH(std::abs(t.b_l[rand][0]) > 0.02 ? 1.0 : 0.0, 1.0, 0.0);
    const double h = ende ? hrrDb(x, k, 30000, x.frames()) : hrrDb(x, k, 0, 18000);
    std::printf("41 Hz note %s of the source: HRR %.2f dB\n", ende ? "at the end" : "at the start", h);
    PRUEF(h >= 15.0);   // the window reaches past the file there (zeros), so the fit is worse than inside
  }

  // ---- two different channels: each channel keeps its own partials, the phase reference is shared
  {
    synth::Ton a;
    a.dauer_s = 1.5;
    a.midi = 57.0;
    a.vib_ct = 20.0;
    const std::vector<float> m = synth::melodie({a}, 1.5);
    Stereo x;
    x.l = m;
    x.r.resize(m.size());
    for (size_t i = 0; i < m.size(); ++i) x.r[i] = 0.5f * (i >= 7 ? m[i - 7] : 0.0f);   // a quieter, delayed copy
    Kurve k;
    k.frames = x.frames();
    k.detektor = "pyin";
    k.kurve = "pyin-1.noten_hmm-1";
    const int64_t nf = frameZahl(x.frames());
    k.f0_ct.resize(static_cast<size_t>(nf));
    k.konf.assign(static_cast<size_t>(nf), 1.0);
    for (int64_t j = 0; j < nf; ++j) {
      const double t = static_cast<double>(j * HOP) / SR;
      k.f0_ct[static_cast<size_t>(j)] = (t >= 0.1 && t <= 1.4) ? 100.0 * synth::tonHoehe(a, t) : 0.0;
    }
    const Teiltoene t = analysiere(x, k, 0, x.frames());
    PRUEF(endlich(t));
    PRUEF(!(t.b_l == t.b_r));
    const size_t mid = t.f0.size() / 2;
    PRUEF(t.b_l[mid].size() > 5 && t.b_r[mid].size() > 5);
    PRUEF_NAH(std::abs(t.b_r[mid][0]) / std::abs(t.b_l[mid][0]), 0.5, 0.02);
    const double h = hrrDb(x, k, 12000, 60000);
    std::printf("two different channels: HRR %.2f dB\n", h);
    PRUEF(h >= 25.0);
  }

  // ---- a source without a voiced frame: empty partials, silence, no failure; a curve of another length is the caller's check
  {
    const Stereo x = synth::stereoAusMono(synth::stille(0.5));
    const Kurve k = konstanteKurve(x.frames(), 60.0, 9.0, 10.0);
    const Teiltoene t = analysiere(x, k, 0, x.frames());
    PRUEF(endlich(t));
    std::vector<double> h;
    harmonisch(t, 0, h);
    PRUEF(static_cast<int64_t>(h.size()) == x.frames());
    for (double v : h) PRUEF(v == 0.0);
  }

  PRUEF_ENDE();
}
