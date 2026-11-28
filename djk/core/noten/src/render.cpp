// Pitch-only render of the engine `teilton-2`: a port of the pitch edit of m21_k_teilton.py as BERICHT_teilton2.md section 8, B states it
// (steps 6 to 13, without the time edit): edit groups, shift per sample with raised cosine ramps, the oscillator bank of the moved partials
// and y = x - h + h'. The envelope and phase readings are in hull.cpp and phase.cpp. What differs from the numpy prototype, and why:
//  - the fundamental phase and the partials are per channel (A5 analyses against the partial 1 of each channel, as the prototype does);
//  - the window of the analysis, the outside of the file and the frames are as in teiltoene.cpp (samples outside the source are zero);
//  - the oscillator bank is a float kernel on 8 lanes like harmonisch (target_clones), the sine and cosine come from double;
//  - the estimate of the envelope mixing reads the refined analysis (the port has no analysis without the f0 refinement).
#pragma GCC diagnostic ignored "-Wpsabi"
#include "render.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <memory>

namespace cdj::noten {
namespace {

using Komplex = std::complex<double>;
using Bereiche = std::vector<std::pair<int64_t, int64_t>>;

constexpr double PI = 3.14159265358979323846;
constexpr double RAMPE_S = 0.020;          // the pitch change is ramped in and out over at most 20 ms
constexpr int RAND = 2048;                 // margin of the analysis around a region
constexpr double NUR_RAND_S = 0.040;       // incremental: the range around a named note

// time edits (prototype m21_k_teilton.py)
constexpr double DEHNUNG_MIN = 0.25, DEHNUNG_MAX = 4.0;   // stretch of a note: new length / detected length
constexpr double PRE_S = 0.006, POST_S = 0.012;           // release margins of a time-edited note
constexpr double KOPF_S = 0.040;                          // attack after the unvoiced lead that keeps its length
constexpr int64_t MESS_MIN = 4096;                        // the shortest range the pitch of a note is measured over (samples)
constexpr double RAND_FREI_S = 0.012;                     // the tail that keeps its length after the last voiced frame
constexpr double FADE_S = 0.004;                          // fade of h' and cross fade where a note edge was moved in time
constexpr double KOPIE_S = 0.008;                         // cross fade between the rate-1 zones and the stretched middle
constexpr double LEER_S = 0.010;                          // fade into the silence of a vacated stretch
constexpr int NOISE_N = 1024, NOISE_HOP = 256;            // STFT of the noise stretch
constexpr int FORM_FENSTER = 47;                          // vibrato and drift: the drift is the centred moving mean over 47 frames
constexpr double NOISE_GAIN = 1.0 / 0.75;                 // 1 / sqrt(0.5625): the incoherent addition of the random-phase frames

constexpr double MISCH_FENSTER0 = 0.10, MISCH_FENSTER1 = 0.35;   // the part of a note used for the estimate: seconds after its start
constexpr size_t MISCH_NMAX = 6;
constexpr double MISCH_MIN_ST = 2.5;
constexpr double MISCH_GITTER[5] = {0.0, 0.25, 0.5, 0.75, 1.0};
constexpr double MISCH_VORTEIL_DB = 2.0;

typedef float v8 __attribute__((vector_size(32)));
inline v8 laden(const float* p) { v8 v; std::memcpy(&v, p, sizeof v); return v; }
inline void speichern(float* p, v8 v) { std::memcpy(p, &v, sizeof v); }

double cosRampe(double t) { t = std::clamp(t, 0.0, 1.0); return 0.5 * (1.0 - std::cos(PI * t)); }

int rampeSamples() { return static_cast<int>(RAMPE_S * SR); }

// ------------------------------------------------------------------------------------------------ vibrato and drift

/// The pitch deviation of a note split into drift and vibrato (contract notes.md, "Vibrato and drift"; D12 of the strand plan), per
/// frame j0 .. j0 + size - 1 of the curve, in semitones. Empty when the note has no voiced frame.
struct Form {
  int64_t j0 = 0;
  std::vector<double> drift, vib;
};

/// The frames j with qa <= j * hop / sr <= qe; voiced frames give dev = ct / 100 - qton, unvoiced ones are interpolated linearly between
/// the voiced neighbours (held at the ends); drift = centred moving mean of dev over 47 frames applied twice (truncated at the note
/// edges), vibrato = dev - drift.
Form zerlege(const Kurve& k, const AudioNote& nt) {
  Form f;
  const int64_t nf = static_cast<int64_t>(k.f0_ct.size());
  const int64_t j0 = std::max<int64_t>(0, static_cast<int64_t>(std::ceil(nt.qa * SR / HOP - 1e-9)));
  const int64_t j1 = std::min<int64_t>(nf - 1, static_cast<int64_t>(std::floor(nt.qe * SR / HOP + 1e-9)));
  if (j1 < j0) return f;
  const size_t m = static_cast<size_t>(j1 - j0 + 1);
  std::vector<double> dev(m, 0.0);
  std::vector<size_t> stimm;
  for (size_t i = 0; i < m; ++i) {
    const double ct = k.f0_ct[static_cast<size_t>(j0) + i];
    if (ct > 0.0) {
      dev[i] = ct / 100.0 - nt.qton;
      stimm.push_back(i);
    }
  }
  if (stimm.empty()) return f;
  for (size_t i = 0; i < stimm.front(); ++i) dev[i] = dev[stimm.front()];
  for (size_t i = stimm.back() + 1; i < m; ++i) dev[i] = dev[stimm.back()];
  for (size_t s = 0; s + 1 < stimm.size(); ++s) {
    const size_t a = stimm[s], b = stimm[s + 1];
    for (size_t i = a + 1; i < b; ++i) dev[i] = dev[a] + (dev[b] - dev[a]) * static_cast<double>(i - a) / static_cast<double>(b - a);
  }
  // the moving mean applied twice (a triangular window): one pass leaves about a fifth of a 6 Hz vibrato in the drift (its first side lobe)
  const size_t h = FORM_FENSTER / 2;
  auto mittel = [&](const std::vector<double>& x) {
    std::vector<double> kum(m + 1, 0.0), y(m);
    for (size_t i = 0; i < m; ++i) kum[i + 1] = kum[i] + x[i];
    for (size_t i = 0; i < m; ++i) {
      const size_t a = i >= h ? i - h : 0, b = std::min(m, i + h + 1);
      y[i] = (kum[b] - kum[a]) / static_cast<double>(b - a);
    }
    return y;
  };
  f.j0 = j0;
  f.drift = mittel(mittel(dev));
  f.vib.resize(m);
  for (size_t i = 0; i < m; ++i) f.vib[i] = dev[i] - f.drift[i];
  return f;
}

// ------------------------------------------------------------------------------------------------ edit groups

struct Eintrag {
  int64_t ao = 0, eo = 0;   // old interval in samples (a time edit: with its release margins)
  int64_t an = 0, en = 0;   // new interval (a pitch edit: the old one)
  int64_t kan = 0, ken = 0; // the new interval without the release margins (the overlap check)
  int64_t H = 0, T = 0;     // time edit: head and tail zones (samples) that keep their length
  double st = 0;            // semitone offset
  bool zeit = false;        // the interval moves or changes its length
  int index = 0;            // index of the note in the list (seed of the noise)
  double vibF = 1, driftF = 1;   // vibrato and drift factors (1 = unchanged)
  std::shared_ptr<const Form> form;   // their decomposition; null when neither factor acts

  /// The extra semitone shift (drift_f - 1) * drift + (vib_f - 1) * vibrato at the OLD sample position `pos` (linear between the frames,
  /// held outside the note).
  double formBei(double pos) const {
    const std::vector<double>& d = form->drift;
    const std::vector<double>& v = form->vib;
    const double x = pos / HOP - static_cast<double>(form->j0);
    double dd, vv;
    if (x <= 0.0) { dd = d.front(); vv = v.front(); }
    else if (x >= static_cast<double>(d.size() - 1)) { dd = d.back(); vv = v.back(); }
    else {
      const size_t m = static_cast<size_t>(x);
      const double l = x - static_cast<double>(m);
      dd = d[m] + l * (d[m + 1] - d[m]);
      vv = v[m] + l * (v[m + 1] - v[m]);
    }
    return (driftF - 1.0) * dd + (vibF - 1.0) * vv;
  }
};

struct Gruppe {
  std::vector<Eintrag> it;
  int64_t r0 = 0, r1 = 0;
};

int64_t samples(double s) { return static_cast<int64_t>(std::nearbyint(s * SR)); }

/// One entry per note with an effect, in list order (prototype `_items`). The stretch limit is checked by the caller on the seconds of
/// the list; here the new interval is clamped to the source, a time edit gets its head zone (unvoiced lead + 40 ms attack) and tail zone
/// (unvoiced tail + 12 ms), both reduced when they would take more than 60 % of the note or leave no room for the stretch, and release
/// margins (6 ms before, 12 ms after) that move with the note. A margin never reaches past a neighbour, neither in the old nor in the
/// new timeline: the gap to a neighbour (the smaller of the detected and the new gap) is the budget of the two margins that face each
/// other; when both neighbours are time-edited and the gap is shorter than 18 ms it is split 1 : 2. So neighbours that touch after the
/// edit (D3) touch with their margined intervals too and no sample is written twice.
std::vector<Eintrag> eintraege(const std::vector<AudioNote>& liste, int64_t n, const Kurve& k) {
  std::vector<Eintrag> out;
  // which notes end up as a time edit (the same tests as below), and the budget of the margins at the gap before note i
  std::vector<char> zeitig(liste.size(), 0);
  for (size_t i = 0; i < liste.size(); ++i) {
    const AudioNote& nt = liste[i];
    const int64_t ao = std::clamp<int64_t>(samples(nt.qa), 0, n), eo = std::clamp<int64_t>(samples(nt.qe), 0, n);
    const int64_t an = std::clamp<int64_t>(nt.a ? samples(*nt.a) : ao, 0, n), en = std::clamp<int64_t>(nt.e ? samples(*nt.e) : eo, 0, n);
    const bool z = (nt.a && samples(*nt.a) != ao) || (nt.e && samples(*nt.e) != eo);
    zeitig[i] = z && eo - ao >= 8 && en - an >= 8;
  }
  const int64_t PRE = static_cast<int64_t>(PRE_S * SR), POST = static_cast<int64_t>(POST_S * SR);
  // the margins at the gap before note i: {post of i - 1, pre of i}
  auto randLuecke = [&](size_t i) -> std::pair<int64_t, int64_t> {
    const AudioNote& p = liste[i - 1];
    const AudioNote& q = liste[i];
    const int64_t alt = samples(q.qa) - samples(p.qe);
    const int64_t neu = samples(q.a.value_or(q.qa)) - samples(p.e.value_or(p.qe));
    const int64_t g = std::max<int64_t>(0, std::min(alt, neu));
    if (!zeitig[i - 1]) return {0, std::min(PRE, g)};
    if (!zeitig[i]) return {std::min(POST, g), 0};
    if (g >= PRE + POST) return {POST, PRE};
    const int64_t pre = g * PRE / (PRE + POST);
    return {g - pre, pre};
  };
  for (size_t i = 0; i < liste.size(); ++i) {
    const AudioNote& nt = liste[i];
    if (!nt.ton && !nt.a && !nt.e && !nt.vib && !nt.drift) continue;
    Eintrag it;
    it.index = static_cast<int>(i);
    it.vibF = nt.vib.value_or(1.0);
    it.driftF = nt.drift.value_or(1.0);
    if (it.vibF != 1.0 || it.driftF != 1.0) {
      Form fo = zerlege(k, nt);
      if (!fo.drift.empty()) it.form = std::make_shared<const Form>(std::move(fo));
    }
    it.ao = std::clamp<int64_t>(samples(nt.qa), 0, n);
    it.eo = std::clamp<int64_t>(samples(nt.qe), 0, n);
    it.an = nt.a ? samples(*nt.a) : it.ao;
    it.en = nt.e ? samples(*nt.e) : it.eo;
    it.st = nt.ton ? *nt.ton - nt.qton : 0.0;
    it.zeit = it.an != it.ao || it.en != it.eo;
    if (it.eo - it.ao < 8) continue;
    if (it.zeit) {
      it.an = std::clamp<int64_t>(it.an, 0, n);
      it.en = std::clamp<int64_t>(it.en, 0, n);
      if (it.en - it.an < 8) continue;
    } else if (std::fabs(it.st) < 1e-9 && !it.form) {
      continue;
    }
    it.kan = it.an;
    it.ken = it.en;
    if (it.zeit) {
      int64_t v0 = -1, v1 = -1;
      for (int64_t j = (it.ao + HOP - 1) / HOP; j * HOP < it.eo && j < static_cast<int64_t>(k.f0_ct.size()); ++j) {
        if (k.f0_ct[static_cast<size_t>(j)] > 0.0) {
          if (v0 < 0) v0 = j;
          v1 = j;
        }
      }
      int64_t h = 0, t = 0;
      if (v0 >= 0) {
        h = std::max<int64_t>(0, v0 * HOP - it.ao) + static_cast<int64_t>(KOPF_S * SR);
        t = std::max<int64_t>(0, it.eo - v1 * HOP) + static_cast<int64_t>(RAND_FREI_S * SR);
      }
      const int64_t lo = it.eo - it.ao, ln = it.en - it.an;
      int64_t z = h + t;
      if (static_cast<double>(z) > 0.6 * static_cast<double>(lo)) {
        h = static_cast<int64_t>(static_cast<double>(h) * 0.6 * static_cast<double>(lo) / static_cast<double>(z));
        t = static_cast<int64_t>(static_cast<double>(t) * 0.6 * static_cast<double>(lo) / static_cast<double>(z));
        z = h + t;
      }
      if (z > 0) {
        const double f = static_cast<double>(ln) / static_cast<double>(lo);
        double lam = f < 1 ? std::min(1.0, (static_cast<double>(ln) - DEHNUNG_MIN * static_cast<double>(lo)) / (0.75 * static_cast<double>(z)))
                           : std::min(1.0, static_cast<double>(4 * lo - ln) / (3.0 * static_cast<double>(z)));
        lam = std::max(lam, 0.0);
        h = static_cast<int64_t>(static_cast<double>(h) * lam);
        t = static_cast<int64_t>(static_cast<double>(t) * lam);
      }
      const int64_t pre = std::max<int64_t>(0, std::min({i > 0 ? randLuecke(i).second : PRE, it.an, it.ao}));
      const int64_t post = std::max<int64_t>(0, std::min({i + 1 < liste.size() ? randLuecke(i + 1).first : POST, n - it.en, n - it.eo}));
      it.ao -= pre;
      it.an -= pre;
      it.eo += post;
      it.en += post;
      it.H = h + pre;
      it.T = t + post;
    }
    out.push_back(it);
  }
  return out;
}

/// Edits whose regions (union of the old and the new interval) overlap or lie closer than two ramps form one group. False when two edited
/// notes of a group overlap in the new timeline.
bool gruppiere(const std::vector<Eintrag>& items, std::vector<Gruppe>& gr) {
  const int w = rampeSamples();
  int64_t ende = 0;
  for (const Eintrag& it : items) {
    const int64_t a = std::min(it.ao, it.an), e = std::max(it.eo, it.en);
    if (!gr.empty() && a < ende + 2 * w) {
      if (it.kan < gr.back().it.back().ken) return false;   // edited notes overlap (without their release margins)
      gr.back().it.push_back(it);
      ende = std::max(ende, e);
    } else {
      Gruppe g;
      g.it.push_back(it);
      gr.push_back(g);
      ende = e;
    }
  }
  for (Gruppe& g : gr) {
    g.r0 = std::min(g.it.front().ao, g.it.front().an);
    g.r1 = std::max(g.it.front().eo, g.it.front().en);
    for (const Eintrag& it : g.it) { g.r0 = std::min({g.r0, it.ao, it.an}); g.r1 = std::max({g.r1, it.eo, it.en}); }
  }
  return true;
}

/// Semitone shift per sample of a group over [r0, r1): constant per note, raised cosine ramps (at most w samples) at every change; at the
/// outer edges the ramps lie inside the note, between touching notes they are centred.
std::vector<double> rampen(const Gruppe& g, int w) {
  const int64_t nreg = g.r1 - g.r0;
  std::vector<double> st(static_cast<size_t>(nreg), 0.0), stufe(static_cast<size_t>(nreg) + 1, 0.0);
  auto ev = [&](int64_t p0, int64_t p1, double delta) {
    const double nenner = static_cast<double>(std::max<int64_t>(p1 - p0, 1));
    for (int64_t u = std::max(p0, g.r0); u <= std::min(p1, g.r1 - 1); ++u) st[static_cast<size_t>(u - g.r0)] += delta * cosRampe(static_cast<double>(u - p0) / nenner);
    const int64_t von = std::clamp<int64_t>(p1 + 1 - g.r0, 0, nreg);
    stufe[static_cast<size_t>(von)] += delta;   // after the ramp the whole delta stands
  };
  auto breite = [&](const Eintrag& it) { return static_cast<int64_t>(std::max<int64_t>(2, std::min<int64_t>(w, (it.en - it.an) / 4))); };
  const Eintrag* prev = nullptr;
  for (const Eintrag& it : g.it) {
    const int64_t wi = breite(it);
    if (prev && it.an - prev->en <= 1) {
      const int64_t wc = std::min(wi, breite(*prev));
      ev(it.an - wc / 2, it.an - wc / 2 + wc - 1, it.st - prev->st);
    } else {
      if (prev) ev(prev->en - breite(*prev), prev->en - 1, -prev->st);
      ev(it.an, it.an + wi - 1, it.st);
    }
    prev = &it;
  }
  ev(prev->en - breite(*prev), prev->en - 1, -prev->st);
  double lauf = 0.0;
  for (int64_t i = 0; i < nreg; ++i) {
    lauf += stufe[static_cast<size_t>(i)];
    st[static_cast<size_t>(i)] += lauf;
  }
  return st;
}

/// Adds the vibrato and drift shift of every note of the group with a form target to `st` (over [r0, r1)): the extra shift read at the
/// old position tau (`tau(i)` for the index i of the region), shaped by the edge ramps of `rampen` with unit delta.
template <class Tau>
void formDazu(const Gruppe& g, int w, Tau tau, std::vector<double>& st) {
  for (size_t idx = 0; idx < g.it.size(); ++idx) {
    if (!g.it[idx].form) continue;
    Gruppe eins = g;
    for (size_t j = 0; j < eins.it.size(); ++j) eins.it[j].st = j == idx ? 1.0 : 0.0;
    const std::vector<double> gew = rampen(eins, w);
    const Eintrag& it = g.it[idx];
    for (size_t i = 0; i < st.size(); ++i) if (gew[i] != 0.0) st[i] += gew[i] * it.formBei(tau(i));
  }
}

// ------------------------------------------------------------------------------------------------ oscillator bank

/// out[n] = sum_k (br0 cos(k psi) - bi0 sin(k psi)) + lam (dbr cos(k psi) - dbi sin(k psi)); cc, sc, c2: cos, sin, 2 cos of psi, the lanes
/// past the stretch are zero. The powers come from the Chebyshev recurrence c(k+1) = 2 cos(psi) c(k) - c(k-1).
__attribute__((target_clones("avx2,fma", "default")))
void bankKern(int n16, int kn, const float* cc, const float* sc, const float* c2, const float* lam, const float* br0, const float* bi0,
              const float* dbr, const float* dbi, float* out) {
  for (int t = 0; t < n16; t += 16) {
    v8 cp0 = {1, 1, 1, 1, 1, 1, 1, 1}, cp1 = cp0, sp0 = {0, 0, 0, 0, 0, 0, 0, 0}, sp1 = sp0;
    v8 cc0 = laden(cc + t), cc1 = laden(cc + t + 8), sc0 = laden(sc + t), sc1 = laden(sc + t + 8);
    const v8 d0 = laden(c2 + t), d1 = laden(c2 + t + 8);
    v8 a0 = sp0, a1 = sp0, b0 = sp0, b1 = sp0;
    for (int k = 0; k < kn; ++k) {
      const float r0 = br0[k], i0 = bi0[k], r1 = dbr[k], i1 = dbi[k];
      a0 += r0 * cc0 - i0 * sc0;
      a1 += r0 * cc1 - i0 * sc1;
      b0 += r1 * cc0 - i1 * sc0;
      b1 += r1 * cc1 - i1 * sc1;
      const v8 n0 = d0 * cc0 - cp0, n1 = d1 * cc1 - cp1, m0 = d0 * sc0 - sp0, m1 = d1 * sc1 - sp1;
      cp0 = cc0; cp1 = cc1; cc0 = n0; cc1 = n1;
      sp0 = sc0; sp1 = sc1; sc0 = m0; sc1 = m1;
    }
    speichern(out + t, a0 + laden(lam + t) * b0);
    speichern(out + t + 8, a1 + laden(lam + t + 8) * b1);
  }
}

/// The partials b[c][m] (frame m at the sample uf[m], linear in time between the frames) of `nkan` channels on the samples
/// [uf.front(), uf.back()] with the phase of the fundamental psi[c] (one value per sample and channel). out[c] has uf.back() -
/// uf.front() + 1 values. Returns false when a SIGTERM is pending.
bool bank(const std::vector<std::vector<Komplex>>* b, int nkan, const std::vector<int64_t>& uf, const std::vector<double>* psi,
          std::vector<double>* out) {
  const size_t nfr = uf.size();
  const int64_t n0 = uf.front();
  for (int c = 0; c < nkan; ++c) out[c].assign(static_cast<size_t>(uf.back() - n0 + 1), 0.0);
  if (nfr < 2) return true;
  std::vector<float> cc, sc, c2, lam, ob, br0, bi0, dbr, dbi;
  for (size_t m = 0; m + 1 < nfr; ++m) {
    if ((m & 15) == 0 && abbruchAngefordert()) return false;
    const int64_t a = uf[m], e = uf[m + 1] + (m + 2 == nfr ? 1 : 0);
    const int len = static_cast<int>(e - a), n16 = (len + 15) & ~15;
    if (len <= 0) continue;
    cc.assign(static_cast<size_t>(n16), 1.0f);
    sc.assign(static_cast<size_t>(n16), 0.0f);
    c2.assign(static_cast<size_t>(n16), 2.0f);
    lam.assign(static_cast<size_t>(n16), 0.0f);
    ob.assign(static_cast<size_t>(n16), 0.0f);
    const double dt = static_cast<double>(uf[m + 1] - uf[m]);
    for (int i = 0; i < len; ++i) lam[static_cast<size_t>(i)] = static_cast<float>(std::clamp(static_cast<double>(a + i - uf[m]) / dt, 0.0, 1.0));
    for (int c = 0; c < nkan; ++c) {
      for (int i = 0; i < len; ++i) {
        const double p = psi[c][static_cast<size_t>(a + i - n0)];
        const float cs = static_cast<float>(std::cos(p));
        cc[static_cast<size_t>(i)] = cs;
        sc[static_cast<size_t>(i)] = static_cast<float>(std::sin(p));
        c2[static_cast<size_t>(i)] = cs + cs;
      }
      const std::vector<Komplex>& u0 = b[c][m];
      const std::vector<Komplex>& u1 = b[c][m + 1];
      const size_t kn = std::max(u0.size(), u1.size());
      if (kn == 0) continue;
      br0.assign(kn, 0.0f); bi0.assign(kn, 0.0f); dbr.assign(kn, 0.0f); dbi.assign(kn, 0.0f);
      for (size_t k = 0; k < kn; ++k) {
        const Komplex p = k < u0.size() ? u0[k] : Komplex(0.0, 0.0), r = k < u1.size() ? u1[k] : Komplex(0.0, 0.0);
        br0[k] = static_cast<float>(p.real());
        bi0[k] = static_cast<float>(p.imag());
        dbr[k] = static_cast<float>(r.real() - p.real());
        dbi[k] = static_cast<float>(r.imag() - p.imag());
      }
      bankKern(n16, static_cast<int>(kn), cc.data(), sc.data(), c2.data(), lam.data(), br0.data(), bi0.data(), dbr.data(), dbi.data(), ob.data());
      for (int i = 0; i < len; ++i) out[c][static_cast<size_t>(a + i - n0)] = ob[static_cast<size_t>(i)];
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ one group

/// f in Hz per sample over [t.s0, t.s1): the track the phase was integrated from, from the differences of the phase (phi[i] = 2 pi / sr
/// sum_{m<i} f[m]); the last sample holds the one before.
std::vector<double> frequenzAusPhase(const Teiltoene& t) {
  const size_t n = t.phi.size();
  std::vector<double> f(n, 0.0);
  const double k = SR / (2.0 * PI);
  for (size_t i = 0; i + 1 < n; ++i) f[i] = (t.phi[i + 1] - t.phi[i]) * k;
  if (n >= 2) f[n - 1] = f[n - 2];
  return f;
}

/// The partials of the analysis at the sample `pos` (linear between the frame centres, held outside), both channels, zero padded to one
/// length, as one frame of `tmp` with the pitch `f`.
void frameBei(const Teiltoene& an, int64_t pos, double f, Teiltoene& tmp) {
  const size_t nfr = an.f0.size();
  size_t m0 = 0, m1 = 0;
  double lam = 0.0;
  if (nfr > 1) {
    const int64_t t0 = an.j0 * HOP;
    int64_t m = pos >= t0 ? (pos - t0) / HOP : -1;
    m = std::clamp<int64_t>(m, 0, static_cast<int64_t>(nfr) - 2);
    lam = std::clamp(static_cast<double>(pos - (an.j0 + m) * HOP) / HOP, 0.0, 1.0);
    m0 = static_cast<size_t>(m);
    m1 = m0 + 1;
  }
  size_t kk = 0;
  for (const auto* v : {&an.b_l[m0], &an.b_l[m1], &an.b_r[m0], &an.b_r[m1]}) kk = std::max(kk, v->size());
  tmp.f0.assign(1, f);
  tmp.b_l.assign(1, {});
  tmp.b_r.assign(1, {});
  for (int c = 0; c < 2; ++c) {
    const auto& v0 = c == 0 ? an.b_l[m0] : an.b_r[m0];
    const auto& v1 = c == 0 ? an.b_l[m1] : an.b_r[m1];
    auto& o = c == 0 ? tmp.b_l[0] : tmp.b_r[0];
    o.assign(kk, Komplex(0.0, 0.0));
    for (size_t k = 0; k < kk; ++k) {
      const Komplex p = k < v0.size() ? v0[k] : Komplex(0.0, 0.0), q = k < v1.size() ? v1[k] : Komplex(0.0, 0.0);
      o[k] = p * (1.0 - lam) + q * lam;
    }
  }
}

/// Renders the group into `aus` (which holds the source, or the earlier render with the range of the group restored from the source).
/// False on SIGTERM.
bool rendereGruppe(const Stereo& x, const Teiltoene& an, const Gruppe& g, double mischung, Stereo& aus) {
  const int64_t r0 = g.r0, r1 = g.r1, nreg = r1 - r0, w0 = an.s0;
  const int w = rampeSamples();
  bool stimmhaft = false;
  for (double f : an.f0) if (f > 0.0) { stimmhaft = true; break; }
  if (!stimmhaft) return true;                       // no partials: y = x - 0 + 0
  std::vector<double> st = rampen(g, w);
  formDazu(g, w, [&](size_t i) { return static_cast<double>(r0) + static_cast<double>(i); }, st);
  std::vector<double> rho(static_cast<size_t>(nreg));
  for (int64_t i = 0; i < nreg; ++i) rho[static_cast<size_t>(i)] = std::pow(2.0, st[static_cast<size_t>(i)] / 12.0);
  const std::vector<double> fs = frequenzAusPhase(an);
  auto fAt = [&](int64_t pos) { return fs[static_cast<size_t>(pos - w0)]; };

  const std::vector<double>* alphaC[2] = {&an.alpha1, &an.alpha1_r};

  // ---- frames of the new partials: the first sample, every hop inside, the last sample
  std::vector<int64_t> uf;
  uf.push_back(r0);
  for (int64_t p = (r0 / HOP + 1) * HOP; p < r1 - 1; p += HOP) uf.push_back(p);
  uf.push_back(r1 - 1);
  const size_t nfr = uf.size();
  std::vector<std::vector<Komplex>> bneu[2];
  bneu[0].assign(nfr, {});
  bneu[1].assign(nfr, {});
  Teiltoene tmp;
  std::vector<double> amp, ph;
  bool gleich = true;
  for (size_t m = 0; m < nfr; ++m) {
    const int64_t pos = uf[m];
    const double rf = rho[static_cast<size_t>(pos - r0)];
    frameBei(an, pos, fAt(pos), tmp);
    if (tmp.b_l[0] != tmp.b_r[0]) gleich = false;
    if (std::fabs(rf - 1.0) < 1e-12) {               // no shift here: the partials stay exactly as they are
      bneu[0][m] = tmp.b_l[0];
      bneu[1][m] = tmp.b_r[0];
      continue;
    }
    for (int c = 0; c < 2; ++c) {
      leseHuelle(tmp, c, 0, rf, amp, mischung);
      lesePhase(tmp, c, 0, rf, ph, mischung);
      auto& o = bneu[c][m];
      o.resize(amp.size());
      for (size_t k = 0; k < amp.size(); ++k) o[k] = std::polar(amp[k], ph[k]);
    }
  }

  // ---- phase of the fundamental: the integral of the moved track plus the measured drift of partial 1 (its increments times rho)
  std::vector<double> phiN(static_cast<size_t>(nreg));
  {
    double summe = 0.0;
    const double kf = 2.0 * PI / SR;
    const double start = an.phi[static_cast<size_t>(r0 - w0)];
    for (int64_t i = 0; i < nreg; ++i) {
      phiN[static_cast<size_t>(i)] = start + kf * summe;
      summe += fAt(r0 + i) * rho[static_cast<size_t>(i)];
    }
    // the region ends at an unedited point: a smooth extra phase over the last ramp makes the phase at the end the old one modulo 2 pi
    const double d = phiN.back() - an.phi[static_cast<size_t>(r1 - 1 - w0)];
    const double korr = -(d - 2.0 * PI * std::nearbyint(d / (2.0 * PI)));
    const int64_t wo = std::max<int64_t>(2, std::min<int64_t>(w, nreg / 2));
    for (int64_t j = 0; j < wo; ++j) phiN[static_cast<size_t>(nreg - wo + j)] += korr * cosRampe(static_cast<double>(j) / (wo - 1.0));
  }
  std::vector<double> psi[2];
  for (int c = 0; c < (gleich ? 1 : 2); ++c) {
    psi[c].resize(static_cast<size_t>(nreg));
    const std::vector<double>& ak = *alphaC[c];
    const size_t nfa = ak.size();
    auto alpha = [&](int64_t pos) {
      const double fpos = static_cast<double>(pos - an.j0 * HOP) / HOP;
      if (fpos <= 0.0) return ak.front();
      if (fpos >= static_cast<double>(nfa - 1)) return ak.back();
      const size_t m = static_cast<size_t>(fpos);
      return ak[m] + (fpos - static_cast<double>(m)) * (ak[m + 1] - ak[m]);
    };
    double al = alpha(r0), vor = al;
    for (int64_t i = 0; i < nreg; ++i) {
      const double a = alpha(r0 + i);
      if (i > 0) al += rho[static_cast<size_t>(i)] * (a - vor);
      vor = a;
      psi[c][static_cast<size_t>(i)] = phiN[static_cast<size_t>(i)] + al;
    }
  }

  // ---- synthesis, the old partials on the margin range, and y = x - h + h' inside the notes
  std::vector<double> hneu[2];
  if (!bank(bneu, gleich ? 1 : 2, uf, psi, hneu)) return false;
  if (gleich) hneu[1] = hneu[0];
  std::vector<double> halt;
  for (int c = 0; c < (gleich ? 1 : 2); ++c) {
    harmonisch(an, c, halt);
    if (abbruchAngefordert()) return false;
    for (const Eintrag& it : g.it) {
      for (int64_t u = it.an; u < it.en; ++u) {
        const std::vector<float>& q = c == 0 ? x.l : x.r;
        const float y = static_cast<float>(static_cast<double>(q[static_cast<size_t>(u)]) - halt[static_cast<size_t>(u - w0)] + hneu[c][static_cast<size_t>(u - r0)]);
        (c == 0 ? aus.l : aus.r)[static_cast<size_t>(u)] = y;
        if (gleich) aus.r[static_cast<size_t>(u)] = y;
      }
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ one group with time edits

/// splitmix64 (D5 of the strand plan): the noise of a render depends on the seed only.
struct Zufall {
  uint64_t s;
  explicit Zufall(uint64_t seed) : s(seed) {}
  uint64_t naechste() {
    uint64_t z = (s += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }
  double phase() { return -PI + 2.0 * PI * (static_cast<double>(naechste() >> 11) * (1.0 / 9007199254740992.0)); }
};

/// np.interp of a per-sample series that starts at sample s0, at the fractional position pos (held outside).
double beiSample(const std::vector<double>& v, int64_t s0, double pos) {
  const double x = pos - static_cast<double>(s0);
  if (v.empty()) return 0.0;
  if (x <= 0.0) return v.front();
  const double last = static_cast<double>(v.size() - 1);
  if (x >= last) return v.back();
  const size_t m = static_cast<size_t>(x);
  return v[m] + (x - static_cast<double>(m)) * (v[m + 1] - v[m]);
}

/// frameBei at a fractional sample position (the prototype's `_b_bei`).
void frameBeiZeit(const Teiltoene& an, double pos, double f, Teiltoene& tmp) {
  const size_t nfr = an.f0.size();
  size_t m0 = 0, m1 = 0;
  double lam = 0.0;
  if (nfr > 1) {
    const double t0 = static_cast<double>(an.j0 * HOP);
    int64_t m = pos >= t0 ? static_cast<int64_t>(std::floor((pos - t0) / HOP)) : -1;
    m = std::clamp<int64_t>(m, 0, static_cast<int64_t>(nfr) - 2);
    lam = std::clamp((pos - static_cast<double>((an.j0 + m) * HOP)) / HOP, 0.0, 1.0);
    m0 = static_cast<size_t>(m);
    m1 = m0 + 1;
  }
  size_t kk = 0;
  for (const auto* v : {&an.b_l[m0], &an.b_l[m1], &an.b_r[m0], &an.b_r[m1]}) kk = std::max(kk, v->size());
  tmp.f0.assign(1, f);
  tmp.b_l.assign(1, {});
  tmp.b_r.assign(1, {});
  for (int c = 0; c < 2; ++c) {
    const auto& v0 = c == 0 ? an.b_l[m0] : an.b_r[m0];
    const auto& v1 = c == 0 ? an.b_l[m1] : an.b_r[m1];
    auto& o = c == 0 ? tmp.b_l[0] : tmp.b_r[0];
    o.assign(kk, Komplex(0.0, 0.0));
    for (size_t k = 0; k < kk; ++k) {
      const Komplex p = k < v0.size() ? v0[k] : Komplex(0.0, 0.0), q = k < v1.size() ? v1[k] : Komplex(0.0, 0.0);
      o[k] = p * (1.0 - lam) + q * lam;
    }
  }
}

/// The residual r (channels `nkan`, samples from o0 on) read along the time map as noise (prototype `_rauschstrecken`): STFT (1024, hop
/// 256, sin^2 window) of r at the old position of every new frame, magnitudes kept, phases uniform random (the phase differences of the
/// channels to the first one kept, so a stereo image survives), overlap-add on the new time, gain 4/3. `tauBei(u)` is the old position
/// of the new sample u. out[c] gets the samples [u_lo, u_hi).
template <class TauBei>
void rauschstrecken(const std::vector<double>* r, int nkan, int64_t o0, TauBei tauBei, int64_t u_lo, int64_t u_hi, uint64_t seed,
                    std::vector<double>* out) {
  const int64_t nn = NOISE_N, hp = NOISE_HOP, nout = u_hi - u_lo;
  const int64_t nfr = (nout + nn + hp - 1) / hp + 1;
  std::vector<double> win(static_cast<size_t>(nn));
  for (int64_t i = 0; i < nn; ++i) {
    const double s = std::sin(PI * (static_cast<double>(i) + 0.5) / static_cast<double>(nn));
    win[static_cast<size_t>(i)] = s * s;
  }
  std::vector<double> buf[2];
  for (int c = 0; c < nkan; ++c) buf[c].assign(static_cast<size_t>(hp * (nfr - 1) + nn), 0.0);
  Zufall z(seed);
  std::vector<Komplex> spec[2], y;
  std::vector<double> ph(static_cast<size_t>(nn / 2 + 1));
  const int64_t rn = static_cast<int64_t>(r[0].size());
  for (int64_t m = 0; m < nfr; ++m) {
    const int64_t tm = u_lo - nn + hp * m;
    const int64_t cold = static_cast<int64_t>(std::nearbyint(tauBei(tm + nn / 2)));
    const int64_t s0 = cold - nn / 2 - o0;
    for (int c = 0; c < nkan; ++c) {
      spec[c].assign(static_cast<size_t>(nn), Komplex(0.0, 0.0));
      for (int64_t i = 0; i < nn; ++i) {
        const int64_t j = s0 + i;
        if (j >= 0 && j < rn) spec[c][static_cast<size_t>(i)] = Komplex(r[c][static_cast<size_t>(j)] * win[static_cast<size_t>(i)], 0.0);
      }
      fft(spec[c], false);
    }
    for (size_t k = 0; k < ph.size(); ++k) ph[k] = z.phase();
    ph.front() = 0.0;
    ph.back() = 0.0;
    for (int c = 0; c < nkan; ++c) {
      y.assign(static_cast<size_t>(nn), Komplex(0.0, 0.0));
      for (int64_t k = 0; k <= nn / 2; ++k) {
        const Komplex sk = spec[c][static_cast<size_t>(k)];
        const double dif = std::arg(sk) - std::arg(spec[0][static_cast<size_t>(k)]);
        Komplex v = std::polar(std::abs(sk), ph[static_cast<size_t>(k)] + dif);
        if (k == 0 || k == nn / 2) v = Komplex(v.real(), 0.0);   // irfft reads the real part of DC and Nyquist
        y[static_cast<size_t>(k)] = v;
        if (k > 0 && k < nn / 2) y[static_cast<size_t>(nn - k)] = std::conj(v);
      }
      fft(y, true);
      double* b = buf[c].data() + hp * m;
      for (int64_t i = 0; i < nn; ++i) b[i] += y[static_cast<size_t>(i)].real() * win[static_cast<size_t>(i)];
    }
  }
  for (int c = 0; c < nkan; ++c) {
    out[c].resize(static_cast<size_t>(nout));
    for (int64_t i = 0; i < nout; ++i) out[c][static_cast<size_t>(i)] = buf[c][static_cast<size_t>(nn + i)] * NOISE_GAIN;
  }
}

/// Renders a group with at least one time edit into `aus` (prototype `_render_gruppe`): the whole region [r0, r1) is written. A
/// time-edited note is read along a piecewise linear time map tau (head and tail zones at rate 1, the middle stretched; a pure move is a
/// shift over the whole note), its partials at tau shifted by st, the residual copied where the map runs at rate 1 and made as noise in
/// the stretched middle (D4: a pure move copies it everywhere); what the new interval vacates fades to silence. False on SIGTERM.
bool rendereGruppeZeit(const Stereo& x, const Teiltoene& an, const Gruppe& g, double mischung, Stereo& aus) {
  const int64_t r0 = g.r0, r1 = g.r1, nreg = r1 - r0, w0 = an.s0;
  const int w = rampeSamples();
  const int64_t q = static_cast<int64_t>(FADE_S * SR), cz = static_cast<int64_t>(KOPIE_S * SR), leer = static_cast<int64_t>(LEER_S * SR);
  const size_t N = static_cast<size_t>(nreg);
  std::vector<double> tau(N), mc(N, 0.0), fa(N, 1.0), wb(N, 1.0), gg(N, 1.0);
  std::vector<char> innote(N, 0);
  for (int64_t i = 0; i < nreg; ++i) tau[static_cast<size_t>(i)] = static_cast<double>(r0 + i);
  // v[a, a + c) = fn(j), j = 0 .. c - 1, clipped to the region
  auto setze = [&](std::vector<double>& v, int64_t a, int64_t c, auto fn) {
    for (int64_t j = 0; j < c; ++j) {
      const int64_t i = a + j;
      if (i >= 0 && i < nreg) v[static_cast<size_t>(i)] = fn(v[static_cast<size_t>(i)], j);
    }
  };
  auto rauf = [](int64_t j, int64_t c) { return cosRampe((static_cast<double>(j) + 1.0) / (static_cast<double>(c) + 1.0)); };
  for (const Eintrag& it : g.it) {
    const int64_t i0 = it.an - r0, i1 = it.en - r0;
    for (int64_t i = i0; i < i1; ++i) innote[static_cast<size_t>(i)] = 1;
    if (!it.zeit) {
      for (int64_t i = i0; i < i1; ++i) mc[static_cast<size_t>(i)] = 1.0;
      continue;
    }
    if (it.en - it.an == it.eo - it.ao) {   // D4: a pure move is a shift, the residual is copied over the whole note
      const int64_t d = it.an - it.ao;
      for (int64_t i = i0; i < i1; ++i) {
        tau[static_cast<size_t>(i)] = static_cast<double>(r0 + i - d);
        mc[static_cast<size_t>(i)] = 1.0;
      }
    } else {
      const int64_t p[4] = {it.an, it.an + it.H, it.en - it.T, it.en};
      const int64_t qq[4] = {it.ao, it.ao + it.H, it.eo - it.T, it.eo};
      std::vector<int> keep = {0};
      for (int kx : {1, 2}) if (p[kx] > p[kx - 1] && p[kx] < p[3]) keep.push_back(kx);
      keep.push_back(3);
      size_t s = 0;
      for (int64_t i = i0; i < i1; ++i) {
        const double u = static_cast<double>(r0 + i);
        while (s + 2 < keep.size() && u >= static_cast<double>(p[keep[s + 1]])) ++s;
        const double x0 = static_cast<double>(p[keep[s]]), x1 = static_cast<double>(p[keep[s + 1]]);
        const double y0 = static_cast<double>(qq[keep[s]]), y1 = static_cast<double>(qq[keep[s + 1]]);
        double v;
        if (u <= x0) v = y0;
        else if (u >= x1) v = y1;
        else v = y0 + (u - x0) * (y1 - y0) / (x1 - x0);
        tau[static_cast<size_t>(i)] = v;
      }
      if (it.H > 0) {
        const int64_t c = std::min(cz, it.H / 2);
        setze(mc, i0, it.H - c, [](double, int64_t) { return 1.0; });
        setze(mc, i0 + it.H - c, c, [&](double, int64_t j) { return 1.0 - rauf(j, c); });
      }
      if (it.T > 0) {
        const int64_t c = std::min(cz, it.T / 2);
        setze(mc, i1 - it.T + c, it.T - c, [](double, int64_t) { return 1.0; });
        setze(mc, i1 - it.T, c, [&](double, int64_t j) { return rauf(j, c); });
      }
    }
    if (it.an != it.ao) setze(fa, i0, q, [&](double v, int64_t j) { return v * rauf(j, q); });
    if (it.en != it.eo) setze(fa, i1 - q, q, [&](double v, int64_t j) { return v * (1.0 - rauf(j, q)); });
    if (it.an < it.ao) setze(gg, i0, q, [&](double, int64_t j) { return rauf(j, q); });
    if (it.en > it.eo) setze(gg, i1 - q, q, [&](double, int64_t j) { return 1.0 - rauf(j, q); });
    // what the new interval vacates is silent, but only inside the old interval (with its margins): a move by more than the note's
    // length leaves the source between the old and the new interval alone
    if (it.an > it.ao) {   // vacated start: the old head fades out, then silence (and the source returns after the old end)
      const int64_t b = std::min(it.an, it.eo);
      const int64_t c = std::min(leer, (b - it.ao) / (b < it.an ? 2 : 1));
      setze(wb, it.ao - r0, b - it.ao, [](double, int64_t) { return 0.0; });
      setze(wb, it.ao - r0, c, [&](double, int64_t j) { return 1.0 - rauf(j, c); });
      if (b < it.an) setze(wb, b - r0 - c, c, [&](double, int64_t j) { return rauf(j, c); });
    }
    if (it.en < it.eo) {   // vacated end: silence, then the old tail returns (and the source fades out before the old start)
      const int64_t b = std::max(it.en, it.ao);
      const int64_t c = std::min(leer, (it.eo - b) / (b > it.en ? 2 : 1));
      setze(wb, b - r0, it.eo - b, [](double, int64_t) { return 0.0; });
      setze(wb, it.eo - r0 - c, c, [&](double, int64_t j) { return rauf(j, c); });
      if (b > it.en) setze(wb, b - r0, c, [&](double, int64_t j) { return 1.0 - rauf(j, c); });
    }
  }
  std::vector<double> st = rampen(g, w);
  formDazu(g, w, [&](size_t i) { return tau[i]; }, st);
  std::vector<double> rho(N);
  for (size_t i = 0; i < N; ++i) rho[i] = std::pow(2.0, st[i] / 12.0);
  // anchors: the samples where the time map jumps (and the start of every time-edited note). There the phase of the fundamental and
  // the drift of partial 1 start again from the old values at tau (a pure move is then an exact copy, deviation from the prototype),
  // and the frames of the new partials get a frame on both sides, so no frame interpolates across the jump.
  std::vector<char> anker(N, 0);
  for (size_t i = 1; i < N; ++i) {
    const double d = tau[i] - tau[i - 1];
    if (d < 0.0 || d > DEHNUNG_MAX + 0.5) anker[i] = 1;
  }
  for (const Eintrag& it : g.it)
    if (it.zeit && it.an > r0) anker[static_cast<size_t>(it.an - r0)] = 1;

  bool stimmhaft = false;
  for (double f : an.f0) if (f > 0.0) { stimmhaft = true; break; }
  bool gleich = x.l == x.r || std::equal(x.l.begin() + w0, x.l.begin() + an.s1, x.r.begin() + w0);
  gleich = gleich && an.alpha1 == an.alpha1_r;
  for (size_t m = 0; gleich && m < an.b_l.size(); ++m) gleich = an.b_l[m] == an.b_r[m];
  const int nkan = gleich ? 1 : 2;

  // ---- old partials and residual on the analysis range
  std::vector<double> rw[2];
  {
    std::vector<double> halt;
    for (int c = 0; c < nkan; ++c) {
      const std::vector<float>& src = c == 0 ? x.l : x.r;
      if (stimmhaft) harmonisch(an, c, halt);
      else halt.assign(static_cast<size_t>(an.s1 - an.s0), 0.0);
      rw[c].resize(halt.size());
      for (size_t i = 0; i < halt.size(); ++i) rw[c][i] = static_cast<double>(src[static_cast<size_t>(w0) + i]) - halt[i];
      if (abbruchAngefordert()) return false;
    }
  }

  // ---- new partials: frames on the new timeline, read at tau, shifted by st
  std::vector<double> hneu[2];
  if (stimmhaft) {
    const std::vector<double> fs = frequenzAusPhase(an);
    auto fAt = [&](double pos) { return beiSample(fs, w0, pos); };
    std::vector<int64_t> uf;
    uf.push_back(r0);
    for (int64_t p = (r0 / HOP + 1) * HOP; p < r1 - 1; p += HOP) uf.push_back(p);
    uf.push_back(r1 - 1);
    for (size_t i = 1; i < N; ++i) {
      if (!anker[i]) continue;
      uf.push_back(r0 + static_cast<int64_t>(i) - 1);
      uf.push_back(r0 + static_cast<int64_t>(i));
    }
    std::sort(uf.begin(), uf.end());
    uf.erase(std::unique(uf.begin(), uf.end()), uf.end());
    const size_t nfr = uf.size();
    std::vector<std::vector<Komplex>> bneu[2];
    bneu[0].assign(nfr, {});
    bneu[1].assign(nfr, {});
    Teiltoene tmp;
    std::vector<double> amp, ph;
    for (size_t m = 0; m < nfr; ++m) {
      const double pos = tau[static_cast<size_t>(uf[m] - r0)];
      const double rf = rho[static_cast<size_t>(uf[m] - r0)];
      frameBeiZeit(an, pos, fAt(pos), tmp);
      if (std::fabs(rf - 1.0) < 1e-12) {
        bneu[0][m] = tmp.b_l[0];
        bneu[1][m] = tmp.b_r[0];
        continue;
      }
      for (int c = 0; c < nkan; ++c) {
        leseHuelle(tmp, c, 0, rf, amp, mischung);
        lesePhase(tmp, c, 0, rf, ph, mischung);
        auto& o = bneu[c][m];
        o.resize(amp.size());
        for (size_t k = 0; k < amp.size(); ++k) o[k] = std::polar(amp[k], ph[k]);
      }
    }
    std::vector<double> phiN(N);
    {
      double summe = 0.0;
      const double kf = 2.0 * PI / SR;
      double start = beiSample(an.phi, w0, tau[0]);
      for (size_t i = 0; i < N; ++i) {
        if (anker[i]) {
          start = beiSample(an.phi, w0, tau[i]);
          summe = 0.0;
        }
        phiN[i] = start + kf * summe;
        summe += fAt(tau[i]) * rho[i];
      }
      const Eintrag& last = g.it.back();
      if (last.en == last.eo && r1 == last.eo) {
        const double d = phiN.back() - beiSample(an.phi, w0, tau.back());
        const double korr = -(d - 2.0 * PI * std::nearbyint(d / (2.0 * PI)));
        const int64_t wo = std::max<int64_t>(2, std::min<int64_t>(w, nreg / 2));
        for (int64_t j = 0; j < wo; ++j) phiN[static_cast<size_t>(nreg - wo + j)] += korr * cosRampe(static_cast<double>(j) / (wo - 1.0));
      }
    }
    // the drift of partial 1 is a frequency offset of the old timeline: its increments are multiplied by rho and divided by the rate
    // rate = np.gradient(tau) within each stretch between anchors (one-sided at its ends), at least 1e-3
    std::vector<double> rate(N, 1.0);
    for (size_t i = 0; i < N; ++i) {
      const bool links = i > 0 && !anker[i], rechts = i + 1 < N && !anker[i + 1];
      if (links && rechts) rate[i] = 0.5 * (tau[i + 1] - tau[i - 1]);
      else if (rechts) rate[i] = tau[i + 1] - tau[i];
      else if (links) rate[i] = tau[i] - tau[i - 1];
      rate[i] = std::max(rate[i], 1e-3);
    }
    const std::vector<double>* alphaC[2] = {&an.alpha1, &an.alpha1_r};
    std::vector<double> psi[2];
    for (int c = 0; c < nkan; ++c) {
      psi[c].resize(N);
      const std::vector<double>& ak = *alphaC[c];
      const size_t nfa = ak.size();
      auto alpha = [&](double pos) {
        const double fpos = (pos - static_cast<double>(an.j0 * HOP)) / HOP;
        if (fpos <= 0.0) return ak.front();
        if (fpos >= static_cast<double>(nfa - 1)) return ak.back();
        const size_t m = static_cast<size_t>(fpos);
        return ak[m] + (fpos - static_cast<double>(m)) * (ak[m + 1] - ak[m]);
      };
      double al = alpha(tau[0]), vor = al;
      for (size_t i = 0; i < N; ++i) {
        const double a = alpha(tau[i]);
        if (anker[i]) al = a;
        else if (i > 0) al += rho[i] / rate[i] * (a - vor);
        vor = a;
        psi[c][i] = phiN[i] + al;
      }
    }
    if (!bank(bneu, nkan, uf, psi, hneu)) return false;
  } else {
    for (int c = 0; c < nkan; ++c) hneu[c].assign(N, 0.0);
  }

  // ---- residual along the time map: copied where mc = 1, noise in the stretched middle
  std::vector<double> rt[2];
  for (int c = 0; c < nkan; ++c) {
    rt[c].resize(N);
    const int64_t rn = static_cast<int64_t>(rw[c].size());
    for (size_t i = 0; i < N; ++i) {
      const int64_t cop = std::clamp<int64_t>(static_cast<int64_t>(std::nearbyint(tau[i])) - w0, 0, rn - 1);
      rt[c][i] = mc[i] * rw[c][static_cast<size_t>(cop)];
    }
  }
  const int64_t nn = NOISE_N;
  auto tauBei = [&](int64_t uu) {
    uu = std::clamp<int64_t>(uu, r0 - nn, r1 + nn - 1);
    if (uu < r0) return tau.front() - static_cast<double>(r0 - uu);
    if (uu > r1 - 1) return tau.back() + static_cast<double>(uu - (r1 - 1));
    return tau[static_cast<size_t>(uu - r0)];
  };
  for (const Eintrag& it : g.it) {
    if (!it.zeit) continue;
    const int64_t i0 = it.an - r0, i1 = it.en - r0;
    double mmin = 1.0;
    for (int64_t i = i0; i < i1; ++i) mmin = std::min(mmin, mc[static_cast<size_t>(i)]);
    if (!(mmin < 1.0)) continue;
    if (abbruchAngefordert()) return false;
    std::vector<double> rs[2];
    const uint64_t seed = (static_cast<uint64_t>(r0) << 16) ^ static_cast<uint64_t>(it.index);
    rauschstrecken(rw, nkan, w0, tauBei, it.an, it.en, seed, rs);
    for (int c = 0; c < nkan; ++c)
      for (int64_t i = i0; i < i1; ++i) rt[c][static_cast<size_t>(i)] += (1.0 - mc[static_cast<size_t>(i)]) * rs[c][static_cast<size_t>(i - i0)];
  }

  // ---- y: the new note inside, the faded source outside the new intervals, and the outer fade against the source
  for (int c = 0; c < nkan; ++c) {
    const std::vector<float>& src = c == 0 ? x.l : x.r;
    for (size_t i = 0; i < N; ++i) {
      const double xr = static_cast<double>(src[static_cast<size_t>(r0) + i]);
      const double y = innote[i] ? rt[c][i] + hneu[c][i] * fa[i] : wb[i] * xr;
      const float v = static_cast<float>((1.0 - gg[i]) * xr + gg[i] * y);
      (c == 0 ? aus.l : aus.r)[static_cast<size_t>(r0) + i] = v;
      if (gleich) aus.r[static_cast<size_t>(r0) + i] = v;
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ ranges

void vereinige(Bereiche& b) {
  std::sort(b.begin(), b.end());
  Bereiche o;
  for (const auto& r : b) {
    if (r.second <= r.first) continue;
    if (!o.empty() && r.first <= o.back().second) o.back().second = std::max(o.back().second, r.second);
    else o.push_back(r);
  }
  b = o;
}

bool ueberlappt(const Bereiche& b, int64_t a, int64_t e) {
  for (const auto& r : b) if (a < r.second && r.first < e) return true;
  return false;
}

bool bedeckt(const Bereiche& b, int64_t a, int64_t e) {
  for (const auto& r : b) if (r.first <= a && e <= r.second) return true;
  return false;
}

}  // namespace

// ------------------------------------------------------------------------------------------------ envelope mixing

namespace {

struct Probe {
  double f = 0;
  std::vector<double> la;    // mean log amplitude per partial
  int nv = 0;                // number of partials
  std::vector<double> amp;   // mean amplitude per partial
};

double median(std::vector<double> v) {
  std::sort(v.begin(), v.end());
  const size_t n = v.size();
  return n % 2 ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
}

/// np.interp(x, arange(n), fp[:n]) for x in [0, n - 1].
double interp1(double x, const std::vector<double>& fp, int n) {
  const int i = std::min(static_cast<int>(std::floor(x)), n - 2);
  if (n < 2) return fp[0];
  const double l = x - i;
  return fp[static_cast<size_t>(i)] * (1.0 - l) + fp[static_cast<size_t>(i) + 1] * l;
}

/// Mean over the ordered pairs (A, B) of notes of the rms error (dB) with which the partials of B follow from those of A when the envelope
/// is read with the mixing `beta`, the mean level difference removed; NaN without a pair; and the number of pairs.
std::pair<double, int> mischFehler(const std::vector<Probe>& sn, double beta) {
  std::vector<double> es;
  for (size_t ia = 0; ia < sn.size(); ++ia) {
    for (size_t ib = 0; ib < sn.size(); ++ib) {
      const Probe& A = sn[ia];
      const Probe& B = sn[ib];
      if (ia == ib || std::fabs(12.0 * std::log2(B.f / A.f)) < MISCH_MIN_ST) continue;
      const int nvb = B.nv, nva = A.nv;
      const double r = std::pow(B.f / A.f, 1.0 - beta);
      std::vector<double> db(static_cast<size_t>(nvb));
      double dbmax = -1e300;
      for (int k = 0; k < nvb; ++k) {
        db[static_cast<size_t>(k)] = 20.0 * std::log10(std::max(B.amp[static_cast<size_t>(k)], 1e-12));
        dbmax = std::max(dbmax, db[static_cast<size_t>(k)]);
      }
      std::vector<double> d;
      for (int k = 0; k < nvb; ++k) {
        const double kap = (k + 1) * r;
        if (!(kap <= nva && db[static_cast<size_t>(k)] > dbmax - 50.0)) continue;
        const double pred = interp1(std::clamp(kap - 1.0, 0.0, static_cast<double>(nva - 1)), A.la, nva);
        d.push_back((pred - B.la[static_cast<size_t>(k)]) * (20.0 / std::log(10.0)));
      }
      if (d.size() < 4) continue;
      double mu = 0;
      for (double v : d) mu += v;
      mu /= static_cast<double>(d.size());
      double s = 0;
      for (double v : d) s += (v - mu) * (v - mu);
      es.push_back(std::sqrt(s / static_cast<double>(d.size())));
    }
  }
  if (es.empty()) return {std::nan(""), 0};
  double m = 0;
  for (double v : es) m += v;
  return {m / static_cast<double>(es.size()), static_cast<int>(es.size())};
}

}  // namespace

double schaetzeMischung(const Stereo& x, const Kurve& k, const std::vector<AudioNote>& liste) {
  std::vector<const AudioNote*> cand;
  for (const AudioNote& n : liste) if (n.qe - n.qa >= MISCH_FENSTER1 - MISCH_FENSTER0 + 0.1) cand.push_back(&n);
  std::stable_sort(cand.begin(), cand.end(), [](const AudioNote* a, const AudioNote* b) { return a->qton < b->qton; });
  if (cand.size() > MISCH_NMAX) {
    std::vector<const AudioNote*> w;
    int letzte = -1;
    const double schritt = static_cast<double>(cand.size() - 1) / static_cast<double>(MISCH_NMAX - 1);
    for (size_t i = 0; i < MISCH_NMAX; ++i) {
      const int idx = static_cast<int>(std::nearbyint(static_cast<double>(i) * schritt));
      if (idx != letzte) w.push_back(cand[static_cast<size_t>(idx)]);
      letzte = idx;
    }
    cand = w;
  }
  std::vector<Probe> sn;
  for (const AudioNote* n : cand) {
    const int64_t s0 = static_cast<int64_t>((n->qa + MISCH_FENSTER0) * SR);
    const int64_t s1 = static_cast<int64_t>(std::min(n->qa + MISCH_FENSTER1, n->qe - 0.03) * SR);
    if (static_cast<double>(s1 - s0) < 0.15 * SR || s1 > x.frames()) continue;
    const Teiltoene an = analysiere(x, k, s0, s1);
    std::vector<size_t> ok;
    for (size_t i = 0; i < an.f0.size(); ++i) if (an.f0[i] > 0.0) ok.push_back(i);
    if (ok.size() < 3) continue;
    size_t kk = 0;
    for (size_t i : ok) kk = std::max({kk, an.b_l[i].size(), an.b_r[i].size()});
    std::vector<double> mean(kk, 0.0), lmean(kk, 0.0), mx(kk, 0.0);
    for (size_t i : ok) {
      for (size_t j = 0; j < kk; ++j) {
        const double a = 0.5 * ((j < an.b_l[i].size() ? std::abs(an.b_l[i][j]) : 0.0) + (j < an.b_r[i].size() ? std::abs(an.b_r[i][j]) : 0.0));
        mean[j] += a;
        lmean[j] += std::log(std::max(a, 1e-12));
        mx[j] = std::max(mx[j], a);
      }
    }
    int nv = 0;
    for (size_t j = 0; j < kk; ++j) if (mx[j] > 0.0) nv = static_cast<int>(j) + 1;
    if (nv == 0) continue;
    Probe p;
    std::vector<double> f;
    for (size_t i : ok) f.push_back(an.f0[i]);
    p.f = median(f);
    p.la.resize(kk);
    p.amp.resize(kk);
    for (size_t j = 0; j < kk; ++j) {
      p.la[j] = lmean[j] / static_cast<double>(ok.size());
      p.amp[j] = mean[j] / static_cast<double>(ok.size());
    }
    p.nv = nv;
    sn.push_back(std::move(p));
  }
  std::pair<double, int> es[5];
  for (int i = 0; i < 5; ++i) es[i] = mischFehler(sn, MISCH_GITTER[i]);
  if (sn.size() < 2 || es[0].second < 3 || std::isnan(es[0].first)) return 0.0;
  int best = 0;
  double bw = 1e300;
  for (int i = 0; i < 5; ++i) {
    const double v = std::isnan(es[i].first) ? 1e300 : es[i].first;
    if (v < bw) { bw = v; best = i; }
  }
  return es[0].first - es[best].first >= MISCH_VORTEIL_DB ? MISCH_GITTER[best] : 0.0;
}

// ------------------------------------------------------------------------------------------------ the render

std::variant<RenderErgebnis, Fehler> rendere(const Stereo& quelle, const Kurve& k, const std::vector<AudioNote>& liste, const Stereo* vorher,
                                             const std::set<std::string>* nur, Stereo& aus, Fortschritt* f, const std::vector<AudioNote>* vorherListe) {
  const int64_t n = quelle.frames();
  if (k.frames != n || k.sr != SR || k.hop != HOP || static_cast<int64_t>(k.f0_ct.size()) != frameZahl(n) ||
      static_cast<int64_t>(k.konf.size()) != frameZahl(n))
    return Fehler{"kurve_passt_nicht", "the curve has " + std::to_string(k.frames) + " frames (sr " + std::to_string(k.sr) + ", hop " + std::to_string(k.hop) +
                                           ", " + std::to_string(k.f0_ct.size()) + " values), the source has " + std::to_string(n)};
  if (quelle.r.size() != quelle.l.size()) return Fehler{"datei_kaputt", "the channels of the source differ in length"};
  bool teil = vorher != nullptr && nur != nullptr;
  if (vorher && (vorher->l.size() != quelle.l.size() || vorher->r.size() != quelle.r.size()))
    return Fehler{"vorher_passt_nicht", "the earlier render has " + std::to_string(vorher->frames()) + " frames, the source has " + std::to_string(n)};
  for (const AudioNote& nt : liste) {
    if (nt.formant || nt.gain_db)
      return Fehler{"nicht_unterstuetzt", "note " + nt.id + ": only the targets a, e, ton, vib and drift are rendered in this version"};
  }
  for (const AudioNote& nt : liste) {
    if (!(nt.qe * SR <= static_cast<double>(n + HOP)))
      return Fehler{"noten_ungueltig", "note " + nt.id + " ends after the source"};
  }
  if (teil) {
    for (const std::string& id : *nur) {
      bool da = false;
      for (const AudioNote& nt : liste) da |= nt.id == id;
      if (!da) return Fehler{"argument", "the id " + id + " of --nur is not in the note list"};
    }
  }

  bool zeitZiel = false;
  for (const AudioNote& nt : liste) {
    if (!nt.a && !nt.e) continue;
    zeitZiel = true;
    const double fd = (nt.e.value_or(nt.qe) - nt.a.value_or(nt.qa)) / (nt.qe - nt.qa);
    if (!(fd >= DEHNUNG_MIN - 1e-9 && fd <= DEHNUNG_MAX + 1e-9))
      return Fehler{"noten_dehnung_grenze", "note " + nt.id + ": a note can be stretched to at most 4 times and compressed to a quarter of its detected length"};
  }
  for (size_t i = 1; i < liste.size(); ++i) {
    const AudioNote& p = liste[i - 1];
    const AudioNote& q = liste[i];
    if (p.e.value_or(p.qe) > q.a.value_or(q.qa))
      return Fehler{"noten_ueberlappen", "notes overlap after the edit (end of " + p.id + " is after the start of " + q.id + ")"};
  }

  const std::vector<Eintrag> items = eintraege(liste, n, k);
  std::vector<Gruppe> gruppen;
  if (!gruppiere(items, gruppen)) return Fehler{"noten_ueberlappen", "edited notes overlap in the new timeline"};
  // without the list `vorher` was rendered from, a time target may have left a copy of a note anywhere: render in full
  if (teil && zeitZiel && !vorherListe) teil = false;

  RenderErgebnis erg;
  // the measuring ranges of the edited notes (T13): the middle of the new interval between the head and tail zones
  for (const Eintrag& it : items) {
    const AudioNote& nt = liste[static_cast<size_t>(it.index)];
    const int64_t lo = it.an + std::max<int64_t>(it.H, static_cast<int64_t>(KOPF_S * SR));
    const int64_t hi = it.en - std::max<int64_t>(it.T, static_cast<int64_t>(RAND_FREI_S * SR));
    if (hi - lo >= MESS_MIN) erg.mitten.push_back({nt.id, lo, hi, nt.ton.value_or(nt.qton)});
  }
  Bereiche R;
  if (teil) {
    aus = *vorher;
    const int64_t rand = static_cast<int64_t>(NUR_RAND_S * SR);
    const int64_t pre = static_cast<int64_t>(PRE_S * SR), post = static_cast<int64_t>(POST_S * SR);
    // the range of a note: detected and target interval, the margin, and the release margins of a time edit
    auto bereich = [&](const AudioNote& nt) {
      const bool z = nt.a || nt.e;
      const int64_t a = samples(std::min(nt.qa, nt.a.value_or(nt.qa))) - rand - (z ? pre : 0);
      const int64_t e = samples(std::max(nt.qe, nt.e.value_or(nt.qe))) + rand + (z ? post : 0);
      R.push_back({std::clamp<int64_t>(a, 0, n), std::clamp<int64_t>(e, 0, n)});
    };
    for (const std::string& id : *nur) {
      for (const AudioNote& nt : liste) if (nt.id == id) bereich(nt);
      if (vorherListe) for (const AudioNote& nt : *vorherListe) if (nt.id == id) bereich(nt);
    }
    vereinige(R);
    for (bool wieder = true; wieder;) {   // grow until every edit group that R touches lies inside it
      wieder = false;
      for (const Gruppe& g : gruppen) {
        if (ueberlappt(R, g.r0, g.r1) && !bedeckt(R, g.r0, g.r1)) {
          R.push_back({g.r0, g.r1});
          vereinige(R);
          wieder = true;
        }
      }
    }
    for (const auto& r : R) {
      std::copy(quelle.l.begin() + r.first, quelle.l.begin() + r.second, aus.l.begin() + r.first);
      std::copy(quelle.r.begin() + r.first, quelle.r.begin() + r.second, aus.r.begin() + r.first);
    }
    erg.bereiche = R;
  } else {
    aus = quelle;
  }

  std::vector<const Gruppe*> zu;
  int64_t gesamt = 0;
  for (const Gruppe& g : gruppen) {
    if (g.r1 - g.r0 < 8) continue;
    if (teil && !ueberlappt(R, g.r0, g.r1)) continue;
    zu.push_back(&g);
    gesamt += g.r1 - g.r0;
  }
  if (zu.empty()) return erg;
  if (f) f->stufe(2, "rendern", 0);
  const double mischung = schaetzeMischung(quelle, k, liste);
  if (abbruchAngefordert()) return Fehler{"abbruch", "interrupted"};
  int64_t fertig = 0;
  for (const Gruppe* g : zu) {
    const int64_t w0 = std::max<int64_t>(0, g->r0 - RAND), w1 = std::min<int64_t>(n, g->r1 + RAND);
    const Teiltoene an = analysiere(quelle, k, w0, w1);
    bool zeit = false;
    for (const Eintrag& it : g->it) zeit |= it.zeit;
    if (abbruchAngefordert() || !(zeit ? rendereGruppeZeit(quelle, an, *g, mischung, aus) : rendereGruppe(quelle, an, *g, mischung, aus)))
      return Fehler{"abbruch", "interrupted"};
    if (!teil) erg.bereiche.push_back({g->r0, g->r1});
    fertig += g->r1 - g->r0;
    if (f) f->stufe(2, "rendern", 100.0 * static_cast<double>(fertig) / static_cast<double>(gesamt));
  }
  return erg;
}

}  // namespace cdj::noten
