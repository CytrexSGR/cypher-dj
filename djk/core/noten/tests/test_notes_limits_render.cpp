// Limits of the spec for the pitch edit (label `ruhig` by the CMake loop): one note shifted by -12 .. +12 semitones ends within 5 cents of
// the target (median over the note core, measured with a YIN style difference function of the test, not with the library's detector); the
// first two maxima of the partial envelope move by at most 3 percent at shifts of -5 .. +5 (the measure is a local-maximum search on the
// partial amplitudes of `analysiere`; shifts of +-12 are measured and printed, not asserted); nothing is offset in time. Tones of
// `synth.h` with the fixed two-peak envelope: 220 Hz with 50 cent vibrato at 5 Hz and 82 Hz without.
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdio>
#include <string>
#include <variant>
#include <vector>

#include "intern.h"
#include "check.h"
#include "render.h"
#include "synth.h"

using namespace cdj::noten;

struct Quelle {
  Stereo x;
  Kurve k;
  AudioNote note;
  std::string name;
};

static Quelle bauen(const std::string& name, double midi, double vib_ct) {
  Quelle q;
  q.name = name;
  synth::Ton t;
  t.start_s = 0.4;
  t.dauer_s = 2.0;
  t.midi = midi;
  t.vib_ct = vib_ct;
  t.vib_hz = 5.0;
  t.mit_huelle = true;
  t.teiltoene = 400;
  const std::vector<float> mono = synth::melodie({t}, 3.0);
  q.x = synth::stereoAusMono(mono);
  q.k.frames = q.x.frames();
  q.k.detektor = "pyin";
  q.k.kurve = "pyin-1.noten_hmm-1";
  const int64_t nf = frameZahl(q.x.frames());
  q.k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
  q.k.konf.assign(static_cast<size_t>(nf), 1.0);
  for (int64_t j = 0; j < nf; ++j) {
    const double ts = static_cast<double>(j * HOP) / SR;
    if (ts >= t.start_s + 0.02 && ts <= t.start_s + t.dauer_s - 0.03) q.k.f0_ct[static_cast<size_t>(j)] = 100.0 * synth::tonHoehe(t, ts - t.start_s);
  }
  q.note.id = "t1";
  q.note.qa = t.start_s + 0.02;
  q.note.qe = t.start_s + t.dauer_s - 0.03;
  q.note.qton = midi;
  q.note.p = 0.8;
  return q;
}

/// Median pitch (cents) of [a, b): the difference function of YIN over a window of 2.5 periods, minimum within 0.7 to 1.45 periods of the
/// expected pitch, parabolic interpolation; frames every 1777 samples (a hop that does not alias with the 5 Hz vibrato: 2400 samples are a quarter of its period).
static double mittlereTonhoehe(const std::vector<float>& x, int64_t a, int64_t b, double erwartet_midi) {
  const double fe = synth::midiHz(erwartet_midi), T = SR / fe;
  const int tmin = static_cast<int>(0.7 * T), tmax = static_cast<int>(1.45 * T) + 2;
  const int W = std::max(2048, static_cast<int>(2.5 * T));
  std::vector<double> cts, d(static_cast<size_t>(tmax + 2));
  for (int64_t pos = a; pos + W + tmax + 2 < b; pos += 1777) {
    for (int tau = tmin - 1; tau <= tmax + 1; ++tau) {
      double s = 0;
      for (int j = 0; j < W; ++j) {
        const double df = static_cast<double>(x[static_cast<size_t>(pos + j)]) - x[static_cast<size_t>(pos + j + tau)];
        s += df * df;
      }
      d[static_cast<size_t>(tau)] = s;
    }
    int best = tmin;
    for (int tau = tmin; tau <= tmax; ++tau) if (d[static_cast<size_t>(tau)] < d[static_cast<size_t>(best)]) best = tau;
    const double y0 = d[static_cast<size_t>(best - 1)], y1 = d[static_cast<size_t>(best)], y2 = d[static_cast<size_t>(best + 1)];
    const double den = y0 - 2 * y1 + y2;
    const double tau = best + (den > 0 ? 0.5 * (y0 - y2) / den : 0.0);
    cts.push_back(100.0 * (69.0 + 12.0 * std::log2((SR / tau) / 440.0)));
  }
  if (cts.empty()) return -1;
  std::sort(cts.begin(), cts.end());
  return cts[cts.size() / 2];
}

/// The first two local maxima (Hz) of the partial amplitude envelope: median over the frames of the core of the per-frame peak
/// frequencies (parabola through three partials in dB). Only maxima that stand 6 dB above both neighbouring valleys count.
static bool ersteZweiMaxima(const Stereo& x, const Kurve& k, int64_t a, int64_t b, double& f1, double& f2) {
  const Teiltoene t = analysiere(x, k, a, b);
  std::vector<double> p1, p2;
  for (size_t i = 0; i < t.f0.size(); ++i) {
    const int64_t centre = (t.j0 + static_cast<int64_t>(i)) * HOP;
    if (t.f0[i] <= 0 || centre < a || centre >= b) continue;
    const auto& bb = t.b_l[i];
    std::vector<double> db(bb.size());
    for (size_t j = 0; j < bb.size(); ++j) db[j] = 20.0 * std::log10(std::abs(bb[j]) + 1e-12);
    std::vector<double> gipfel;
    for (size_t j = 1; j + 1 < db.size(); ++j) {
      if (!(db[j] > db[j - 1] && db[j] >= db[j + 1])) continue;
      double tal_l = db[j], tal_r = db[j];
      for (size_t m = j; m-- > 0;) { tal_l = std::min(tal_l, db[m]); if (db[m] > db[j]) break; }
      for (size_t m = j; m < db.size(); ++m) { tal_r = std::min(tal_r, db[m]); if (db[m] > db[j]) break; }
      if (db[j] - tal_l < 6.0 || db[j] - tal_r < 6.0) continue;
      const double den = db[j - 1] - 2 * db[j] + db[j + 1];
      const double off = den < 0 ? 0.5 * (db[j - 1] - db[j + 1]) / den : 0.0;
      gipfel.push_back((static_cast<double>(j + 1) + off) * t.f0[i]);
    }
    if (gipfel.size() < 2) continue;
    p1.push_back(gipfel[0]);
    p2.push_back(gipfel[1]);
  }
  if (p1.size() < 3) return false;
  std::sort(p1.begin(), p1.end());
  std::sort(p2.begin(), p2.end());
  f1 = p1[p1.size() / 2];
  f2 = p2[p2.size() / 2];
  return true;
}

/// ln amplitude of the known family of the test tone (`synth::huelle` with free level, centres and ratio of the second bump):
/// lnG + ln(0.05 + exp(-a^2 / 2) + r exp(-b^2 / 2)), a = log2(hz / c1) / 0.35, b = log2(hz / c2) / 0.30 (the model of m21_masse.py).
static double familieLn(double hz, double c1, double c2, double r) {
  const double a = std::log2(hz / c1) / 0.35, b = std::log2(hz / c2) / 0.30;
  return std::log(0.05 + std::exp(-0.5 * a * a) + r * std::exp(-0.5 * b * b));
}

/// Centres (Hz) of the two bumps of the known family fitted to the partial amplitudes of one frame (partials up to 8 kHz and within 60 dB
/// of the maximum): the level is solved in closed form, centres and ratio by a coarse grid and two refinements. False if fewer than 6 partials count.
static bool familieMitten(const std::vector<std::complex<double>>& b, double f0, double& c1, double& c2) {
  double amax = 0;
  for (const auto& z : b) amax = std::max(amax, std::abs(z));
  std::vector<double> hz, ln;
  for (size_t k = 0; k < b.size(); ++k) {
    const double h = static_cast<double>(k + 1) * f0, a = std::abs(b[k]);
    if (h <= 8000.0 && a > amax * 1e-3) { hz.push_back(h); ln.push_back(std::log(a)); }
  }
  if (hz.size() < 6) return false;
  auto kosten = [&](double x1, double x2, double r) {
    double m = 0;
    std::vector<double> d(hz.size());
    for (size_t i = 0; i < hz.size(); ++i) { d[i] = ln[i] - familieLn(hz[i], x1, x2, r); m += d[i]; }
    m /= static_cast<double>(d.size());
    double e = 0;
    for (double v : d) e += (v - m) * (v - m);
    return e;
  };
  double b1 = 700, b2 = 1800, br = 0.8, best = 1e300;
  auto suche = [&](double lo1, double hi1, double s1, double lo2, double hi2, double s2, double lor, double hir, double sr) {
    double n1 = b1, n2 = b2, nr = br;
    for (double x1 = lo1; x1 <= hi1 + 1e-9; x1 += s1)
      for (double x2 = lo2; x2 <= hi2 + 1e-9; x2 += s2)
        for (double r = lor; r <= hir + 1e-9; r += sr) {
          const double e = kosten(x1, x2, r);
          if (e < best) { best = e; n1 = x1; n2 = x2; nr = r; }
        }
    b1 = n1; b2 = n2; br = nr;
  };
  suche(300, 1200, 10, 1200, 4000, 40, 0.2, 2.0, 0.2);
  suche(std::max(300.0, b1 - 10), b1 + 10, 1, std::max(1200.0, b2 - 40), b2 + 40, 4, std::max(0.05, br - 0.2), br + 0.2, 0.04);
  suche(std::max(300.0, b1 - 1), b1 + 1, 0.1, std::max(1200.0, b2 - 4), b2 + 4, 0.4, std::max(0.05, br - 0.04), br + 0.04, 0.01);
  c1 = b1;
  c2 = b2;
  return true;
}

/// Median over the frames of the core [a, b) of 100 (c_y / c_ideal - 1) for both bump centres: y against the ideal tone of the same
/// envelope at the target pitch, each fitted at its own pitch (the bias of the fit at that pitch cancels, floor 0.01 percent in the report).
static bool formantFehler(const Stereo& y, const Kurve& ky, const Stereo& ideal, const Kurve& ki, int64_t a, int64_t b, double& d1, double& d2) {
  const Teiltoene ty = analysiere(y, ky, a, b), ti = analysiere(ideal, ki, a, b);
  std::vector<double> r1, r2;
  for (size_t i = 0; i < ty.f0.size(); ++i) {
    const int64_t j = ty.j0 + static_cast<int64_t>(i), centre = j * HOP;
    if (ty.f0[i] <= 0 || centre < a || centre >= b) continue;
    if (j < ti.j0 || static_cast<size_t>(j - ti.j0) >= ti.f0.size() || ti.f0[static_cast<size_t>(j - ti.j0)] <= 0) continue;
    const size_t m = static_cast<size_t>(j - ti.j0);
    if ((i % 8) != 0) continue;   // every 8th frame (2048 samples) is enough
    double y1, y2, i1, i2;
    if (!familieMitten(ty.b_l[i], ty.f0[i], y1, y2) || !familieMitten(ti.b_l[m], ti.f0[m], i1, i2)) continue;
    r1.push_back(100.0 * (y1 / i1 - 1.0));
    r2.push_back(100.0 * (y2 / i2 - 1.0));
  }
  if (r1.size() < 5) return false;
  std::sort(r1.begin(), r1.end());
  std::sort(r2.begin(), r2.end());
  d1 = r1[r1.size() / 2];
  d2 = r2[r2.size() / 2];
  return true;
}

static Kurve verschoben(const Kurve& k, double st) {
  Kurve o = k;
  for (double& v : o.f0_ct) if (v > 0) v += 100.0 * st;
  return o;
}


/// A 220 Hz tone (midi 57) of 2 s with the two-peak envelope and a weak 5 Hz vibrato: `s1` = -1 inverts partial 1 (a wide stereo source in
/// which partial 1 of the right channel is in exact antiphase to the left one, so the mid signal has no partial 1).
static std::vector<float> tonVorzeichen1(double s1) {
  const double pi2 = 2.0 * std::acos(-1.0);
  std::vector<float> x(static_cast<size_t>(3.0 * SR), 0.0f);
  const int K = 60;
  double phase = 0.0;
  const int64_t a0 = static_cast<int64_t>(0.4 * SR), len = static_cast<int64_t>(2.0 * SR);
  std::vector<double> w(K);
  for (int64_t i = 0; i < len; ++i) {
    const double t = static_cast<double>(i) / SR;
    const double f = synth::midiHz(57.0 + 0.3 * std::sin(pi2 * 5.0 * t));
    if (i % 32 == 0) {
      double sum = 0;
      for (int k = 0; k < K; ++k) { w[static_cast<size_t>(k)] = f * (k + 1) > 0.45 * SR ? 0.0 : synth::huelle(f * (k + 1)); sum += w[static_cast<size_t>(k)]; }
      for (double& v : w) v /= sum;
    }
    double sum = 0;
    for (int k = 0; k < K; ++k) sum += (k == 0 ? s1 : 1.0) * w[static_cast<size_t>(k)] * std::sin(phase * (k + 1));
    double g = std::min(1.0, t / 0.01);
    g = std::min(g, (2.0 - t) / 0.03);
    x[static_cast<size_t>(a0 + i)] = static_cast<float>(0.3 * g * sum);
    phase += pi2 * f / SR;
    if (phase > pi2) phase -= pi2;
  }
  return x;
}

static double effektivwert(const std::vector<float>& x, int64_t a, int64_t b) {
  double s = 0;
  for (int64_t i = a; i < b; ++i) s += static_cast<double>(x[static_cast<size_t>(i)]) * x[static_cast<size_t>(i)];
  return std::sqrt(s / static_cast<double>(b - a));
}

int main() {
  const std::vector<Quelle> quellen = {bauen("220 Hz, vibrato 50 ct", 57.0, 50.0), bauen("82 Hz plain", 40.0, 0.0)};
  const double schritte[] = {-12, -7, -3, -1, 1, 3, 7, 12};
  for (const Quelle& q : quellen) {
    const double laenge = q.note.qe - q.note.qa;
    const int64_t a = static_cast<int64_t>((q.note.qa + 0.2 * laenge) * SR), b = static_cast<int64_t>((q.note.qe - 0.2 * laenge) * SR);
    double f1q = 0, f2q = 0;
    const bool quelleOk = ersteZweiMaxima(q.x, q.k, a, b, f1q, f2q);
    std::printf("%s: source maxima %.1f Hz and %.1f Hz (envelope peaks of the tone: 700 and 1800 Hz)\n", q.name.c_str(), f1q, f2q);
    PRUEF(quelleOk);

    // ---- pitch: -12 .. +12, absolute target of the note
    const double quelleCt = mittlereTonhoehe(q.x.l, a, b, q.note.qton);
    std::printf("%s: source median pitch %.2f ct (note %.2f ct)\n", q.name.c_str(), quelleCt, 100.0 * q.note.qton);
    double schlechtest = 0;
    for (double st : schritte) {
      std::vector<AudioNote> liste = {q.note};
      liste[0].ton = rundeTon(q.note.qton + st);
      Stereo aus;
      auto r = rendere(q.x, q.k, liste, nullptr, nullptr, aus, nullptr);
      PRUEF(std::holds_alternative<RenderErgebnis>(r));
      if (!std::holds_alternative<RenderErgebnis>(r)) continue;
      PRUEF(aus.frames() == q.x.frames());
      const double ziel = 100.0 * (q.note.qton + st);
      const double ist = mittlereTonhoehe(aus.l, a, b, q.note.qton + st);
      std::printf("%-22s shift %+3.0f: median pitch %8.2f ct, target %8.2f ct, error %+6.2f ct\n", q.name.c_str(), st, ist, ziel, ist - ziel);
      PRUEF_NAH(ist, ziel, 5.0);
      schlechtest = std::max(schlechtest, std::fabs(ist - ziel));
    }
    std::printf("%-22s worst pitch error %.2f ct\n", q.name.c_str(), schlechtest);

    // ---- formant: the first two maxima of the partial envelope (measured on the result with the curve moved by the shift)
    for (double st : {-12.0, -5.0, -3.0, -1.0, 1.0, 3.0, 5.0, 12.0}) {
      std::vector<AudioNote> liste = {q.note};
      liste[0].ton = rundeTon(q.note.qton + st);
      Stereo aus;
      auto r = rendere(q.x, q.k, liste, nullptr, nullptr, aus, nullptr);
      if (!std::holds_alternative<RenderErgebnis>(r)) { PRUEF(false); continue; }
      double f1 = 0, f2 = 0;
      const bool ok = ersteZweiMaxima(aus, verschoben(q.k, st), a, b, f1, f2);
      const double d1 = 100.0 * (f1 / f1q - 1.0), d2 = 100.0 * (f2 / f2q - 1.0);
      std::printf("%-22s shift %+3.0f: maxima %.1f Hz (%+.2f %%) and %.1f Hz (%+.2f %%)%s\n", q.name.c_str(), st, f1, d1, f2, d2,
                  std::fabs(st) > 5 ? "  (measured, not asserted)" : "");
      // the maxima are read off the partial grid of the pitch: with partials 220 Hz apart that reading itself scatters by several percent
      // (the source alone reads 726.8 Hz for 700), so the 3 percent limit is asserted for the dense grid (82 Hz) and printed for the other
      if (std::fabs(st) <= 5.0 && q.name.find("82") != std::string::npos) {
        PRUEF(ok);
        PRUEF(std::fabs(d1) <= 3.0 && std::fabs(d2) <= 3.0);
      }
    }

    // ---- formant at 220 Hz against the ideal: the tone of the same envelope at the target pitch, known-family fit of both (the centres of
    // the two bumps; the report BERICHT_teilton3.md measures 0.5 to 2.2 percent for F1 within +-5 with the Catmull-Rom read, 4.8 with the linear one)
    if (q.name.find("220") != std::string::npos) {
      for (double st : {-12.0, -7.0, -5.0, -3.0, 3.0, 5.0, 7.0, 12.0}) {
        std::vector<AudioNote> liste = {q.note};
        liste[0].ton = rundeTon(q.note.qton + st);
        Stereo aus;
        auto r = rendere(q.x, q.k, liste, nullptr, nullptr, aus, nullptr);
        if (!std::holds_alternative<RenderErgebnis>(r)) { PRUEF(false); continue; }
        const Quelle ideal = bauen("ideal", q.note.qton + st, 50.0);
        double d1 = 0, d2 = 0;
        const bool ok = formantFehler(aus, verschoben(q.k, st), ideal.x, ideal.k, a, b, d1, d2);
        const bool geprueft = std::fabs(st) <= 5.0;
        std::printf("%-22s shift %+3.0f: known-family centres against the ideal tone: F1 %+.2f %%, F2 %+.2f %%%s\n", q.name.c_str(), st, d1, d2,
                    geprueft ? "" : "  (measured, not asserted)");
        if (geprueft) {
          PRUEF(ok);
          PRUEF(std::fabs(d1) <= 3.0 && std::fabs(d2) <= 3.0);
        }
      }
    }

    // ---- no offset: the untouched part and the level envelope of the edited note stay at lag 0
    {
      std::vector<AudioNote> liste = {q.note};
      liste[0].ton = rundeTon(q.note.qton + 2.0);
      Stereo aus;
      auto r = rendere(q.x, q.k, liste, nullptr, nullptr, aus, nullptr);
      if (!std::holds_alternative<RenderErgebnis>(r)) { PRUEF(false); continue; }
      const auto& bereiche = std::get<RenderErgebnis>(r).bereiche;
      PRUEF(bereiche.size() == 1);
      // (1) untouched part with signal: the 20 ms onset ramp of the tone lies before the note; the cross correlation peaks at lag 0
      {
        const int64_t n0 = static_cast<int64_t>(0.4 * SR), n1 = static_cast<int64_t>(q.note.qa * SR);
        int beste = 0;
        double bestWert = -1e300;
        for (int lag = -24; lag <= 24; ++lag) {
          double s = 0;
          for (int64_t i = n0 + 30; i < n1 - 30; ++i) s += static_cast<double>(aus.l[static_cast<size_t>(i + lag)]) * q.x.l[static_cast<size_t>(i)];
          if (s > bestWert) { bestWert = s; beste = lag; }
        }
        PRUEF(bestWert > 0.0);   // there is signal in the stretch
        PRUEF(beste == 0);
      }
      // (2) level envelope over the whole file: 2 ms blocks of the rectified signal, mean removed; the onset and the end of the note give
      // a sharp peak of the cross correlation, whose best lag within +-10 blocks is 0
      {
        const int blk = 96;
        std::vector<double> es, ea;
        for (int64_t p = 0; p + blk <= q.x.frames(); p += blk) {
          double s = 0, t = 0;
          for (int i = 0; i < blk; ++i) { s += std::fabs(q.x.l[static_cast<size_t>(p + i)]); t += std::fabs(aus.l[static_cast<size_t>(p + i)]); }
          es.push_back(s);
          ea.push_back(t);
        }
        double ms = 0, ma = 0;
        for (size_t i = 0; i < es.size(); ++i) { ms += es[i]; ma += ea[i]; }
        ms /= static_cast<double>(es.size());
        ma /= static_cast<double>(ea.size());
        int beste = 0;
        double bestWert = -1e300;
        for (int lag = -10; lag <= 10; ++lag) {
          double s = 0;
          for (size_t i = 12; i + 12 < es.size(); ++i) s += (es[i] - ms) * (ea[static_cast<size_t>(static_cast<int>(i) + lag)] - ma);
          if (s > bestWert) { bestWert = s; beste = lag; }
        }
        std::printf("%-22s level envelope: best lag %d blocks of 2 ms\n", q.name.c_str(), beste);
        PRUEF(beste == 0);
      }
    }
  }

  // ---- wide stereo with partial 1 in exact antiphase (mid has no partial 1), and R = -L: level within 1 percent, pitch within 5 ct per channel
  {
    const std::vector<float> l = tonVorzeichen1(1.0);
    for (int fall = 0; fall < 3; ++fall) {   // 0: partial 1 inverted, 1: R = -L, 2: control, R = L
      Stereo x;
      x.l = l;
      x.r = fall == 0 ? tonVorzeichen1(-1.0) : std::vector<float>(l.size());
      if (fall == 1) for (size_t i = 0; i < l.size(); ++i) x.r[i] = -l[i];
      if (fall == 2) x.r = l;
      Quelle q;
      q.x = x;
      q.k.frames = x.frames();
      q.k.detektor = "pyin";
      q.k.kurve = "pyin-1.noten_hmm-1";
      const int64_t nf = frameZahl(x.frames());
      q.k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
      q.k.konf.assign(static_cast<size_t>(nf), 1.0);
      const double pi2 = 2.0 * std::acos(-1.0);
      for (int64_t j = 0; j < nf; ++j) {
        const double ts = static_cast<double>(j * HOP) / SR - 0.4;
        if (ts >= 0.02 && ts <= 1.97) q.k.f0_ct[static_cast<size_t>(j)] = 5700.0 + 30.0 * std::sin(pi2 * 5.0 * ts);
      }
      AudioNote n;
      n.id = "t1";
      n.qa = 0.42;
      n.qe = 2.37;
      n.qton = 57.0;
      n.p = 0.8;
      const int64_t a = static_cast<int64_t>(0.8 * SR), b = static_cast<int64_t>(2.0 * SR);
      for (double st : {-7.0, 5.0}) {
        std::vector<AudioNote> liste = {n};
        liste[0].ton = rundeTon(57.0 + st);
        Stereo aus;
        auto r = rendere(x, q.k, liste, nullptr, nullptr, aus, nullptr);
        PRUEF(std::holds_alternative<RenderErgebnis>(r));
        if (!std::holds_alternative<RenderErgebnis>(r)) continue;
        for (int c = 0; c < 2; ++c) {
          const std::vector<float>& xs = c == 0 ? x.l : x.r;
          const std::vector<float>& ys = c == 0 ? aus.l : aus.r;
          const double pegel = effektivwert(ys, a, b) / effektivwert(xs, a, b);
          const double ist = mittlereTonhoehe(ys, a, b, 57.0 + st), ziel = 100.0 * (57.0 + st);
          std::printf("antiphase case %d shift %+.0f channel %d: level ratio %.4f, median pitch %.2f ct (target %.0f)\n", fall, st, c, pegel, ist, ziel);
          PRUEF(std::fabs(pegel - 1.0) <= 0.01);
          PRUEF_NAH(ist, ziel, 5.0);
        }
      }
    }
  }
  PRUEF_ENDE();
}
