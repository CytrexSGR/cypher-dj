// `rendere` with the factors `vib` and `drift` (strand 8 T9): measures on a synthetic sung-like tone, no gold. The tone has a 6 Hz
// vibrato of +-50 ct and a linear drift of 40 ct; the curve is the synthetic truth. The output is measured with the own detector and the
// decomposition of the contract (notes.md, "Vibrato and drift"): drift = centred moving mean of the deviation over 47 frames, vibrato =
// the rest; vibrato width = 2 sqrt(2) rms (peak to peak of a sine), drift width = max - min. Cases: vib 0, drift 0, vib 2, absent factors
// leave a pitch-only render bit-identical, vib 0 together with a stretch, incremental == full. Each width is checked against the width
// the same decomposition gives on the target curve qton + drift_f * drift + vib_f * vibrato (so the test holds the render to the
// contract's definition); the plan's absolute limits (vib 0 under 10 ct, drift 0 under 5 ct, vib 2 at 200 ct) are printed beside them:
// a 47-frame moving mean passes about a fifth of a 6 Hz vibrato into the drift, so they hold only for a decomposition that separates it.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <set>
#include <string>
#include <variant>
#include <vector>

#include "detector.h"
#include "intern.h"
#include "check.h"
#include "render.h"
#include "synth.h"

using namespace cdj::noten;
using Bereiche = std::vector<std::pair<int64_t, int64_t>>;

static bool bytesGleich(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && (a.empty() || std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0);
}
static bool gleich(const Stereo& a, const Stereo& b) { return bytesGleich(a.l, b.l) && bytesGleich(a.r, b.r); }

struct Material {
  Stereo x;
  Kurve k;
  std::vector<AudioNote> liste;
};

/// t1: 0.3 .. 1.5 s, MIDI 62 rising linearly by 40 ct, vibrato 6 Hz +-50 ct; t2: 1.9 .. 2.5 s, MIDI 66, vibrato 5.5 Hz +-30 ct. 3 s.
static Material material() {
  Material m;
  std::vector<synth::Ton> toene(2);
  toene[0].start_s = 0.3;
  toene[0].dauer_s = 1.2;
  toene[0].midi = 62.0;
  toene[0].midi_ende = 62.4;
  toene[0].vib_ct = 50.0;
  toene[0].vib_hz = 6.0;
  toene[1].start_s = 1.9;
  toene[1].dauer_s = 0.6;
  toene[1].midi = 66.0;
  toene[1].vib_ct = 30.0;
  for (size_t i = 0; i < toene.size(); ++i) {
    toene[i].mit_huelle = true;
    AudioNote n;
    n.id = "t" + std::to_string(i + 1);
    n.qa = toene[i].start_s;
    n.qe = toene[i].start_s + toene[i].dauer_s;
    n.qton = i == 0 ? 62.2 : 66.0;
    n.p = 0.8;
    m.liste.push_back(n);
  }
  m.x = synth::stereoAusMono(synth::melodie(toene, 3.0));
  m.k.frames = m.x.frames();
  m.k.detektor = "pyin";
  m.k.kurve = "pyin-1.noten_hmm-1";
  const int64_t nf = frameZahl(m.x.frames());
  m.k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
  m.k.konf.assign(static_cast<size_t>(nf), 1.0);
  for (int64_t j = 0; j < nf; ++j) {
    const double ts = static_cast<double>(j * HOP) / SR;
    for (const synth::Ton& t : toene)
      if (ts >= t.start_s + 0.02 && ts <= t.start_s + t.dauer_s - 0.03) m.k.f0_ct[static_cast<size_t>(j)] = 100.0 * synth::tonHoehe(t, ts - t.start_s);
  }
  return m;
}

struct Breiten {
  double vib = -1, drift = -1;   // cents
};

struct Zerlegung {
  int64_t j0 = 0;
  std::vector<double> drift, vib;   // semitones
};

/// The decomposition of the contract on the curve `ct` over the frames with a <= j hop / sr <= b, against `qton`.
static Zerlegung zerlegung(const std::vector<double>& ct, double a, double b, double qton) {
  Zerlegung z;
  const int64_t j0 = static_cast<int64_t>(std::ceil(a * SR / HOP - 1e-9)), j1 = static_cast<int64_t>(std::floor(b * SR / HOP + 1e-9));
  std::vector<double> dev;
  std::vector<size_t> stimm;
  for (int64_t j = j0; j <= j1 && j < static_cast<int64_t>(ct.size()); ++j) {
    const double c = ct[static_cast<size_t>(j)];
    dev.push_back(c > 0 ? c / 100.0 - qton : 0.0);
    if (c > 0) stimm.push_back(dev.size() - 1);
  }
  if (stimm.empty()) return z;
  const size_t m = dev.size();
  for (size_t i = 0; i < stimm.front(); ++i) dev[i] = dev[stimm.front()];
  for (size_t i = stimm.back() + 1; i < m; ++i) dev[i] = dev[stimm.back()];
  for (size_t s = 0; s + 1 < stimm.size(); ++s)
    for (size_t i = stimm[s] + 1; i < stimm[s + 1]; ++i)
      dev[i] = dev[stimm[s]] + (dev[stimm[s + 1]] - dev[stimm[s]]) * static_cast<double>(i - stimm[s]) / static_cast<double>(stimm[s + 1] - stimm[s]);
  z.j0 = j0;
  auto mittel = [m](const std::vector<double>& x) {   // centred mean over 47 frames, truncated at the edges
    std::vector<double> y(m);
    for (size_t i = 0; i < m; ++i) {
      const size_t l = i >= 23 ? i - 23 : 0, r = std::min(m, i + 24);
      double s = 0;
      for (size_t j = l; j < r; ++j) s += x[j];
      y[i] = s / static_cast<double>(r - l);
    }
    return y;
  };
  z.drift = mittel(mittel(dev));   // applied twice, as the contract says
  for (size_t i = 0; i < m; ++i) z.vib.push_back(dev[i] - z.drift[i]);
  return z;
}

/// Vibrato width 2 sqrt(2) rms and drift width max - min (cents) of the decomposition.
static Breiten breiten(const std::vector<double>& ct, double a, double b, double qton) {
  Breiten w;
  const Zerlegung z = zerlegung(ct, a, b, qton);
  if (z.drift.empty()) return w;
  double q = 0;
  for (double v : z.vib) q += v * v;
  w.drift = 100.0 * (*std::max_element(z.drift.begin(), z.drift.end()) - *std::min_element(z.drift.begin(), z.drift.end()));
  w.vib = 100.0 * 2.0 * std::sqrt(2.0) * std::sqrt(q / static_cast<double>(z.vib.size()));
  return w;
}

/// The own detector on the left channel, widths of t1 over [a + 0.05, b - 0.05] (the edges of a note are left out of the measure).
static Breiten gemessen(const Stereo& y, double a, double b, double qton) {
  const Kurve k = erkenne(y.l, SR, nullptr);
  return breiten(k.f0_ct, a + 0.05, b - 0.05, qton);
}

/// RMS (cents) of the detected pitch of `y` against the target qton + drift_f * drift + vib_f * vibrato of the note [qa, qe] of the curve
/// `k` (the render's own definition), over [qa + 0.05, qe - 0.05].
static double abweichung(const Stereo& y, const Kurve& k, const AudioNote& n, double vibF, double driftF) {
  const Zerlegung z = zerlegung(k.f0_ct, n.qa, n.qe, n.qton);
  const Kurve ky = erkenne(y.l, SR, nullptr);
  double q = 0;
  int c = 0;
  for (size_t i = 0; i < z.drift.size(); ++i) {
    const int64_t j = z.j0 + static_cast<int64_t>(i);
    const double t = static_cast<double>(j * HOP) / SR;
    if (t < n.qa + 0.05 || t > n.qe - 0.05 || ky.f0_ct[static_cast<size_t>(j)] <= 0) continue;
    const double ziel = 100.0 * (n.qton + driftF * z.drift[i] + vibF * z.vib[i]);
    q += (ky.f0_ct[static_cast<size_t>(j)] - ziel) * (ky.f0_ct[static_cast<size_t>(j)] - ziel);
    ++c;
  }
  return c ? std::sqrt(q / c) : 1e9;
}

/// The widths the decomposition gives on the target curve of the note (the curve with qton + drift_f * drift + vib_f * vibrato inside it).
static Breiten vorhergesagt(const Kurve& k, const AudioNote& n, double vibF, double driftF) {
  const Zerlegung z = zerlegung(k.f0_ct, n.qa, n.qe, n.qton);
  std::vector<double> ct = k.f0_ct;
  for (size_t i = 0; i < z.drift.size(); ++i) ct[static_cast<size_t>(z.j0) + i] = 100.0 * (n.qton + driftF * z.drift[i] + vibF * z.vib[i]);
  return breiten(ct, n.qa + 0.05, n.qe - 0.05, n.qton);
}

static bool voll(const Material& m, const std::vector<AudioNote>& l, Stereo& aus) {
  auto r = rendere(m.x, m.k, l, nullptr, nullptr, aus, nullptr);
  if (auto* f = std::get_if<Fehler>(&r)) {
    std::fprintf(stderr, "render failed: %s %s\n", f->code.c_str(), f->text.c_str());
    ++pruef_fehler;
    return false;
  }
  return true;
}

int main() {
  const Material m = material();
  const AudioNote& t1 = m.liste[0];
  const Breiten src = gemessen(m.x, t1.qa, t1.qe, t1.qton);
  const Breiten wahr = breiten(m.k.f0_ct, t1.qa + 0.05, t1.qe - 0.05, t1.qton);
  std::printf("source t1: vibrato %.1f ct, drift %.1f ct (curve: %.1f, %.1f)\n", src.vib, src.drift, wahr.vib, wahr.drift);
  PRUEF(src.vib > 0 && src.drift > 0);
  double vib0 = 0;

  // ---- vib 0: flat vibrato, drift kept
  {
    std::vector<AudioNote> l = m.liste;
    l[0].vib = 0.0;
    Stereo aus;
    PRUEF(voll(m, l, aus));
    const Breiten b = gemessen(aus, t1.qa, t1.qe, t1.qton), p = vorhergesagt(m.k, t1, 0.0, 1.0);
    const double ab = abweichung(aus, m.k, t1, 0.0, 1.0);
    std::printf("vib 0: pitch against the target %.1f ct rms; vibrato %.1f ct (definition %.1f, plan limit 10), drift %.1f ct (definition %.1f, source %.1f)\n",
                ab, b.vib, p.vib, b.drift, p.drift, src.drift);
    PRUEF(b.vib < 10.0);   // the triangular window: a flattened vibrato stays under 10 ct peak to peak
    PRUEF(ab < 5.0);
    PRUEF(b.vib < 0.3 * src.vib);
    PRUEF_NAH(b.vib, p.vib, 5.0);
    PRUEF_NAH(b.drift, p.drift, 5.0);
    vib0 = b.vib;
    PRUEF(bytesGleich(aus.l, aus.r));
  }

  // ---- drift 0: flat drift, vibrato kept
  {
    std::vector<AudioNote> l = m.liste;
    l[0].drift = 0.0;
    Stereo aus;
    PRUEF(voll(m, l, aus));
    const Breiten b = gemessen(aus, t1.qa, t1.qe, t1.qton), p = vorhergesagt(m.k, t1, 1.0, 0.0);
    const double ab = abweichung(aus, m.k, t1, 1.0, 0.0);
    std::printf("drift 0: pitch against the target %.1f ct rms; drift %.1f ct (definition %.1f, plan limit 5), vibrato %.1f ct (definition %.1f, source %.1f)\n",
                ab, b.drift, p.drift, b.vib, p.vib, src.vib);
    PRUEF(ab < 5.0);
    PRUEF_NAH(b.drift, p.drift, 5.0);
    PRUEF_NAH(b.vib, p.vib, 0.1 * p.vib);
  }

  // ---- vib 2: twice the width
  {
    std::vector<AudioNote> l = m.liste;
    l[0].vib = 2.0;
    Stereo aus;
    PRUEF(voll(m, l, aus));
    const Breiten b = gemessen(aus, t1.qa, t1.qe, t1.qton), p = vorhergesagt(m.k, t1, 2.0, 1.0);
    const double ab = abweichung(aus, m.k, t1, 2.0, 1.0);
    std::printf("vib 2: pitch against the target %.1f ct rms; vibrato %.1f ct (definition %.1f, plan 200 +- 15), drift %.1f ct\n", ab, b.vib, p.vib, b.drift);
    PRUEF(ab < 5.0);
    PRUEF_NAH(b.vib, p.vib, 15.0);
  }

  // ---- absent factors: a pitch-only render stays bit-identical where no factor acts
  {
    std::vector<AudioNote> l = m.liste;
    l[1].ton = 67.0;
    Stereo a0, a1;
    PRUEF(voll(m, l, a0));
    l[0].vib = 0.5;                       // t1 is its own group, far from t2
    PRUEF(voll(m, l, a1));
    bool t2gleich = true;
    for (size_t i = static_cast<size_t>(1.6 * SR); i < a0.l.size(); ++i) t2gleich &= std::memcmp(&a0.l[i], &a1.l[i], 4) == 0;
    bool t1quelle = true;
    for (size_t i = 0; i < static_cast<size_t>(1.6 * SR); ++i) t1quelle &= std::memcmp(&a0.l[i], &m.x.l[i], 4) == 0;
    PRUEF(t2gleich);
    PRUEF(t1quelle);
    // a note without voiced frames ignores the factors
    Material st = m;
    for (double& c : st.k.f0_ct) c = 0.0;
    std::vector<AudioNote> l2 = st.liste;
    l2[0].vib = 0.0;
    l2[0].drift = 3.0;
    Stereo a2;
    PRUEF(voll(st, l2, a2));
    PRUEF(gleich(a2, st.x));
    std::printf("absent factors: pitch-only output unchanged: %s\n", t2gleich && t1quelle && gleich(a2, st.x) ? "yes" : "no");
  }

  // ---- vib 0 with e stretched 1.5: the decomposition is read at tau, the width stays small (the rate scales with the stretch)
  {
    std::vector<AudioNote> l = m.liste;
    const double e = rundeS(t1.qa + 1.5 * (t1.qe - t1.qa));
    l[0].e = e;
    l[0].vib = 0.0;
    std::vector<AudioNote> l2 = l;
    l2[1].a = rundeS(e + 0.2);            // t2 makes room
    l2[1].e = rundeS(e + 0.2 + (l2[1].qe - l2[1].qa));
    Stereo aus;
    PRUEF(voll(m, l2, aus));
    const Breiten b = gemessen(aus, t1.qa, e, t1.qton);
    std::printf("e x1.5 and vib 0: vibrato %.1f ct (unstretched %.1f, plan limit 10)\n", b.vib, vib0);
    PRUEF(b.vib < vib0 + 5.0);
  }

  // ---- incremental == full
  {
    std::vector<AudioNote> L1 = m.liste;
    L1[0].vib = 0.0;
    std::vector<AudioNote> L2 = m.liste;
    L2[0].drift = 0.0;
    L2[1].vib = 2.0;
    Stereo v1, f2, i2;
    PRUEF(voll(m, L1, v1));
    PRUEF(voll(m, L2, f2));
    const std::set<std::string> nur = {"t1", "t2"};
    auto r = rendere(m.x, m.k, L2, &v1, &nur, i2, nullptr);
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    PRUEF(gleich(i2, f2));
    std::printf("incremental == full: %s\n", gleich(i2, f2) ? "yes" : "no");
  }

  PRUEF_ENDE();
}
