// `rendere` with time targets (`a`, `e`): measures on synthetic sung-like tones, no gold (the gold folder is full, and the pure move and
// the noise generator differ from the prototype on purpose). Two tones with vibrato, the second 0.4 s after the first; the curve is the
// synthetic truth. Cases: a move later into the gap (onset, pitch, untouched samples, length), stretch 1.5 and compress 0.6 (end, pitch,
// level of the middle), a pure move copies the residual (the output is the shifted source), a move with a pitch target, the limit and the
// overlap errors, incremental == full with the list `vorher` was rendered from, and the run time on a four-minute stereo source.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <set>
#include <string>
#include <variant>
#include <vector>

#include "intern.h"
#include "check.h"
#include "render.h"
#include "synth.h"

using namespace cdj::noten;
using Bereiche = std::vector<std::pair<int64_t, int64_t>>;

#if defined(__SANITIZE_ADDRESS__)
#define MIT_ASAN 1
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
#define MIT_ASAN 1
#endif
#endif

static bool bytesGleich(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && (a.empty() || std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0);
}
static bool gleich(const Stereo& a, const Stereo& b) { return bytesGleich(a.l, b.l) && bytesGleich(a.r, b.r); }

/// Median pitch (cents) of [a, b) of x: YIN difference over one period window, frames every 2400 samples (as test_noten_render).
static double mittlereTonhoehe(const std::vector<float>& x, int64_t a, int64_t b, double erwartet_midi) {
  const double fe = synth::midiHz(erwartet_midi), T = SR / fe;
  const int tmin = static_cast<int>(0.7 * T), tmax = static_cast<int>(1.45 * T) + 2;
  const int W = std::max(2048, static_cast<int>(2.5 * T));
  std::vector<double> cts;
  std::vector<double> d(static_cast<size_t>(tmax + 2));
  for (int64_t pos = a; pos + W + tmax + 2 < b; pos += 2400) {
    if (pos < 0 || pos + W + tmax + 2 > static_cast<int64_t>(x.size())) continue;
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

/// RMS envelope over 2 ms (96 samples, centred) of x at every sample of [a, b).
static std::vector<double> huelle(const std::vector<float>& x, int64_t a, int64_t b) {
  const int64_t h = 48;
  std::vector<double> kum(x.size() + 1, 0.0);
  for (size_t i = 0; i < x.size(); ++i) kum[i + 1] = kum[i] + static_cast<double>(x[i]) * x[i];
  std::vector<double> e;
  for (int64_t i = a; i < b; ++i) {
    const int64_t l = std::clamp<int64_t>(i - h, 0, static_cast<int64_t>(x.size())), r = std::clamp<int64_t>(i + h, 0, static_cast<int64_t>(x.size()));
    e.push_back(std::sqrt((kum[static_cast<size_t>(r)] - kum[static_cast<size_t>(l)]) / static_cast<double>(std::max<int64_t>(r - l, 1))));
  }
  return e;
}

/// First and last sample of [a, b) where the envelope reaches -20 dB of its peak in [a, b).
static std::pair<int64_t, int64_t> kanten(const std::vector<float>& x, int64_t a, int64_t b) {
  const std::vector<double> e = huelle(x, a, b);
  double peak = 0;
  for (double v : e) peak = std::max(peak, v);
  int64_t on = -1, off = -1;
  for (size_t i = 0; i < e.size(); ++i) {
    if (e[i] >= 0.1 * peak) {
      if (on < 0) on = a + static_cast<int64_t>(i);
      off = a + static_cast<int64_t>(i);
    }
  }
  return {on, off};
}

static double rmsDb(const std::vector<float>& x, int64_t a, int64_t b) {
  double s = 0;
  for (int64_t i = a; i < b; ++i) s += static_cast<double>(x[static_cast<size_t>(i)]) * x[static_cast<size_t>(i)];
  return 10.0 * std::log10(s / static_cast<double>(b - a) + 1e-30);
}

struct Material {
  Stereo x;
  Kurve k;
  std::vector<AudioNote> liste;
};

/// t1: 0.3 .. 0.9 s, MIDI 62; t2: 1.3 .. 1.9 s, MIDI 66; both with `vib_ct` vibrato at 5.5 Hz and the two-peak envelope. `sekunden` long.
/// `zeiten` (qa1, qe1, qa2, qe2) replaces the default times.
static Material zweiToene(double sekunden, double vib_ct = 20, const double* zeiten = nullptr) {
  Material m;
  double start[] = {0.3, 1.3}, dauer[] = {0.6, 0.6};
  const double midi[] = {62, 66};
  if (zeiten) {
    start[0] = zeiten[0];
    dauer[0] = zeiten[1] - zeiten[0];
    start[1] = zeiten[2];
    dauer[1] = zeiten[3] - zeiten[2];
  }
  std::vector<synth::Ton> toene;
  for (int i = 0; i < 2; ++i) {
    synth::Ton t;
    t.start_s = start[i];
    t.dauer_s = dauer[i];
    t.midi = midi[i];
    t.vib_ct = vib_ct;
    t.mit_huelle = true;
    toene.push_back(t);
    AudioNote n;
    n.id = "t" + std::to_string(i + 1);
    n.qa = start[i];
    n.qe = start[i] + dauer[i];
    n.qton = midi[i];
    n.p = 0.8;
    m.liste.push_back(n);
  }
  m.x = synth::stereoAusMono(synth::melodie(toene, sekunden));
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

static bool voll(const Material& m, const std::vector<AudioNote>& l, Stereo& aus, Bereiche* b = nullptr) {
  auto r = rendere(m.x, m.k, l, nullptr, nullptr, aus, nullptr);
  if (auto* f = std::get_if<Fehler>(&r)) {
    std::fprintf(stderr, "render failed: %s %s\n", f->code.c_str(), f->text.c_str());
    ++pruef_fehler;
    return false;
  }
  if (b) *b = std::get<RenderErgebnis>(r).bereiche;
  return true;
}

static std::string fehlerCode(const std::variant<RenderErgebnis, Fehler>& r) {
  return std::holds_alternative<Fehler>(r) ? std::get<Fehler>(r).code : std::string();
}

static int64_t s(double sek) { return static_cast<int64_t>(std::llround(sek * SR)); }

int main() {
  const Material m = zweiToene(2.5);
  const std::vector<float>& x = m.x.l;
  const AudioNote& t1 = m.liste[0];
  const auto [on0, off0] = kanten(x, s(0.1), s(1.1));   // t1 in the source
  const double ton0 = mittlereTonhoehe(x, s(t1.qa + 0.1), s(t1.qe - 0.1), 62.0);
  std::printf("source t1: onset %.2f ms, end %.2f ms, pitch %.1f ct\n", 1000.0 * on0 / SR, 1000.0 * off0 / SR, ton0);

  // ---- 1. move later by 125 ms into the gap
  {
    std::vector<AudioNote> l = m.liste;
    l[0].a = t1.qa + 0.125;
    l[0].e = t1.qe + 0.125;
    Stereo aus;
    Bereiche b;
    PRUEF(voll(m, l, aus, &b));
    PRUEF(aus.frames() == m.x.frames());
    const auto [on, off] = kanten(aus.l, s(0.1), s(1.2));
    const double ct = mittlereTonhoehe(aus.l, s(*l[0].a + 0.1), s(*l[0].e - 0.1), 62.0);
    std::printf("1 move +125 ms: onset %+.2f ms, end %+.2f ms from the target, pitch %.1f ct (source %.1f)\n", 1000.0 * (on - on0 - s(0.125)) / SR,
                1000.0 * (off - off0 - s(0.125)) / SR, ct, ton0);
    PRUEF(std::llabs(on - on0 - s(0.125)) <= s(0.005));
    PRUEF(std::llabs(off - off0 - s(0.125)) <= s(0.005));
    PRUEF_NAH(ct, ton0, 5.0);
    bool aussen = true;
    for (int64_t i = 0; i < aus.frames(); ++i) {
      if (i >= s(t1.qa - 0.006) && i < s(*l[0].e + 0.012 + 0.020)) continue;
      aussen &= std::memcmp(&aus.l[static_cast<size_t>(i)], &x[static_cast<size_t>(i)], 4) == 0 &&
                std::memcmp(&aus.r[static_cast<size_t>(i)], &m.x.r[static_cast<size_t>(i)], 4) == 0;
    }
    PRUEF(aussen);
    PRUEF(bytesGleich(aus.l, aus.r));   // identical channels stay identical
    // the vacated start is silent after its fade
    PRUEF(rmsDb(aus.l, s(t1.qa + 0.02), s(t1.qa + 0.1)) < rmsDb(x, s(t1.qa + 0.02), s(t1.qa + 0.1)) - 40.0);
  }

  // ---- 2. stretch 1.5 and compress 0.6: end, pitch, level of the middle. The pitch is measured on the same tones without vibrato: a
  // stretch changes the vibrato rate, and the median over a non-integer number of vibrato cycles moves by a few cents by itself.
  const Material glatt = zweiToene(2.5, 0.0);
  const double tonGlatt0 = mittlereTonhoehe(glatt.x.l, s(t1.qa + 0.1), s(t1.qe - 0.1), 62.0);
  for (double faktor : {1.5, 0.6}) {
    std::vector<AudioNote> l = m.liste;
    const double e = t1.qa + faktor * (t1.qe - t1.qa);
    l[0].e = rundeS(e);
    Stereo aus;
    PRUEF(voll(m, l, aus));
    const auto [on, off] = kanten(aus.l, s(0.1), s(1.25));
    Stereo ausGlatt;
    PRUEF(voll(glatt, l, ausGlatt));
    const double ct = mittlereTonhoehe(ausGlatt.l, s(t1.qa + 0.1), s(e - 0.1), 62.0);
    const double mitte = rmsDb(aus.l, s(t1.qa + 0.25 * (e - t1.qa)), s(t1.qa + 0.75 * (e - t1.qa)));
    const double mitte0 = rmsDb(x, s(t1.qa + 0.15), s(t1.qa + 0.45));
    std::printf("2 stretch %.1f: onset %+.2f ms, end %+.2f ms from the target, pitch %.1f ct (source %.1f, no vibrato), middle %+.2f dB\n", faktor,
                1000.0 * (on - on0) / SR, 1000.0 * (off - off0 - s(e - t1.qe)) / SR, ct, tonGlatt0, mitte - mitte0);
    PRUEF(std::llabs(on - on0) <= s(0.005));
    PRUEF(std::llabs(off - off0 - s(e - t1.qe)) <= s(0.005));
    PRUEF_NAH(ct, tonGlatt0, 5.0);
    PRUEF_NAH(mitte, mitte0, 1.5);
    PRUEF(aus.frames() == m.x.frames());
  }

  // ---- 2b. the noise middle keeps the level: an unvoiced note (a noise burst, the curve unvoiced there) stretched by 1.5 and 3
  {
    Material r = zweiToene(2.5);
    const std::vector<float> rs = synth::rauschen(0.6, -20.0, 7);
    for (size_t i = 0; i < rs.size(); ++i) {
      r.x.l[static_cast<size_t>(s(t1.qa)) + i] = rs[i];
      r.x.r[static_cast<size_t>(s(t1.qa)) + i] = rs[i];
    }
    for (int64_t j = 0; j < static_cast<int64_t>(r.k.f0_ct.size()); ++j)
      if (j * HOP < s(1.0)) r.k.f0_ct[static_cast<size_t>(j)] = 0.0;
    const double mitte0 = rmsDb(r.x.l, s(t1.qa + 0.15), s(t1.qa + 0.45));
    for (double faktor : {1.5, 0.5}) {
      std::vector<AudioNote> l = r.liste;
      const double e = t1.qa + faktor * (t1.qe - t1.qa);
      l[0].e = rundeS(e);
      Stereo aus;
      PRUEF(voll(r, l, aus));
      const double mitte = rmsDb(aus.l, s(t1.qa + 0.25 * (e - t1.qa)), s(t1.qa + 0.75 * (e - t1.qa)));
      std::printf("2b noise burst stretched %.1f: middle %+.2f dB\n", faktor, mitte - mitte0);
      PRUEF_NAH(mitte, mitte0, 1.5);
      PRUEF(bytesGleich(aus.l, aus.r));
    }
  }

  // ---- 3. pure move: the residual is copied, the output is the shifted source over the middle of the note
  {
    for (double d : {0.125, -0.1}) {
      std::vector<AudioNote> l = m.liste;
      l[0].a = rundeS(t1.qa + d);
      l[0].e = rundeS(t1.qe + d);
      Stereo aus;
      PRUEF(voll(m, l, aus));
      double e = 0, f = 0;
      const int64_t dd = s(d);
      for (int64_t i = s(*l[0].a + 0.1); i < s(*l[0].e - 0.1); ++i) {
        const double r = x[static_cast<size_t>(i - dd)], df = static_cast<double>(aus.l[static_cast<size_t>(i)]) - r;
        e += r * r;
        f += df * df;
      }
      const double db = 10.0 * std::log10((f + 1e-30) / (e + 1e-30));
      std::printf("3 pure move %+.3f s: error to the shifted source %.1f dB\n", d, db);
      PRUEF(db < -40.0);
    }
  }

  // ---- 4. a move with a pitch target: the pitch at the new place
  {
    std::vector<AudioNote> l = m.liste;
    l[0].a = t1.qa + 0.125;
    l[0].e = t1.qe + 0.125;
    l[0].ton = 64.0;
    Stereo aus;
    PRUEF(voll(m, l, aus));
    const double ct = mittlereTonhoehe(aus.l, s(*l[0].a + 0.1), s(*l[0].e - 0.1), 64.0);
    std::printf("4 move +125 ms and +2: pitch %.1f ct (target %.1f)\n", ct, ton0 + 200.0);
    PRUEF_NAH(ct, ton0 + 200.0, 5.0);
  }

  // ---- 5. the stretch limit and the overlap
  {
    Stereo aus;
    const Material lang = zweiToene(4.0);
    std::vector<AudioNote> l = lang.liste;
    l[0].e = rundeS(t1.qa + 4.2 * (t1.qe - t1.qa));
    PRUEF(fehlerCode(rendere(lang.x, lang.k, l, nullptr, nullptr, aus, nullptr)) == "noten_dehnung_grenze");
    l = lang.liste;
    l[0].e = rundeS(t1.qa + 0.2 * (t1.qe - t1.qa));
    PRUEF(fehlerCode(rendere(lang.x, lang.k, l, nullptr, nullptr, aus, nullptr)) == "noten_dehnung_grenze");
    l = lang.liste;
    l[0].e = rundeS(t1.qa + 0.25 * (t1.qe - t1.qa));   // the limit itself is allowed
    PRUEF(fehlerCode(rendere(lang.x, lang.k, l, nullptr, nullptr, aus, nullptr)).empty());
    l = lang.liste;
    l[0].a = 1.0;                                       // t1 moved onto t2, t2 edited too
    l[0].e = 1.6;
    l[1].ton = 67.0;
    PRUEF(fehlerCode(rendere(lang.x, lang.k, l, nullptr, nullptr, aus, nullptr)) == "noten_ueberlappen");
    l[1].ton.reset();                                   // and onto an unedited neighbour
    PRUEF(fehlerCode(rendere(lang.x, lang.k, l, nullptr, nullptr, aus, nullptr)) == "noten_ueberlappen");
    l = lang.liste;                                     // touching after the edit is allowed
    l[0].e = 1.3;
    PRUEF(fehlerCode(rendere(lang.x, lang.k, l, nullptr, nullptr, aus, nullptr)).empty());
  }

  // ---- 6. incremental == full: L1 moves t1, L2 moves it back and stretches t2
  {
    std::vector<AudioNote> L1 = m.liste;
    L1[0].a = t1.qa + 0.125;
    L1[0].e = t1.qe + 0.125;
    std::vector<AudioNote> L2 = m.liste;
    L2[1].e = rundeS(m.liste[1].qa + 1.5 * (m.liste[1].qe - m.liste[1].qa));
    Stereo v1, f2, i2;
    PRUEF(voll(m, L1, v1));
    PRUEF(voll(m, L2, f2));
    const std::set<std::string> nur = {"t1", "t2"};
    auto r = rendere(m.x, m.k, L2, &v1, &nur, i2, nullptr, &L1);
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    PRUEF(gleich(i2, f2));
    // only t1 back to the detected list: the moved copy in `vorher` is cleared
    Stereo i3;
    const std::set<std::string> nur1 = {"t1"};
    r = rendere(m.x, m.k, m.liste, &v1, &nur1, i3, nullptr, &L1);
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    PRUEF(gleich(i3, m.x));
    // a pitch edit on top of a moved note, incremental
    std::vector<AudioNote> L3 = L1;
    L3[1].ton = 64.0;
    Stereo f3, i4;
    PRUEF(voll(m, L3, f3));
    const std::set<std::string> nur2 = {"t2"};
    r = rendere(m.x, m.k, L3, &v1, &nur2, i4, nullptr, &L1);
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    PRUEF(gleich(i4, f3));
    // without the earlier list, a list with a time target renders in full
    Stereo i5;
    r = rendere(m.x, m.k, L2, &v1, &nur, i5, nullptr);
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    PRUEF(gleich(i5, f2));
    std::printf("6 incremental == full: %s\n", gleich(i2, f2) && gleich(i3, m.x) && gleich(i4, f3) && gleich(i5, f2) ? "yes" : "no");
  }

  // ---- 8. two edited neighbours that touch after the edit (D3): detected gap 10.7 ms, times on the frame grid (256 / 48000 s). t2 moves
  // 5 ms later and t1's end follows to t2's new start; and t1's end stretched to the detected start of t2 while t2 only has its end
  // stretched (0.4 s gap). The render succeeds, the seam has no click, the source outside the edited span is unchanged.
  {
    const double fr = static_cast<double>(HOP) / SR;
    const double zeiten[] = {56 * fr, 168 * fr, 170 * fr, 282 * fr};
    const Material nb = zweiToene(2.5, 20, zeiten);
    const std::vector<float>& xn = nb.x.l;
    double sprung0 = 0;   // the largest sample step of the source inside the two notes
    for (int64_t i = s(zeiten[0] + 0.05); i < s(zeiten[3] - 0.05); ++i)
      sprung0 = std::max(sprung0, std::fabs(static_cast<double>(xn[static_cast<size_t>(i)]) - xn[static_cast<size_t>(i - 1)]));
    std::vector<AudioNote> l = nb.liste;
    l[1].a = rundeS(zeiten[2] + 0.005);
    l[1].e = rundeS(zeiten[3] + 0.005);
    l[0].e = *l[1].a;
    Stereo aus;
    PRUEF(voll(nb, l, aus));
    if (aus.frames() == nb.x.frames()) {
      const int64_t naht = s(*l[1].a);
      double sprung = 0;
      for (int64_t i = naht - s(0.02); i < naht + s(0.02); ++i)
        sprung = std::max(sprung, std::fabs(static_cast<double>(aus.l[static_cast<size_t>(i)]) - aus.l[static_cast<size_t>(i - 1)]));
      bool aussen = true;
      for (int64_t i = 0; i < aus.frames(); ++i) {
        if (i >= s(zeiten[0] - 0.006) && i < s(*l[1].e + 0.012 + 0.020)) continue;
        aussen &= std::memcmp(&aus.l[static_cast<size_t>(i)], &xn[static_cast<size_t>(i)], 4) == 0;
      }
      std::printf("8 touching neighbours (gap 10.7 ms): largest step at the seam %.4f (source %.4f), outside unchanged %s\n", sprung, sprung0,
                  aussen ? "yes" : "no");
      PRUEF(sprung <= 1.5 * sprung0);
      PRUEF(aussen);
    }
    std::vector<AudioNote> l2 = m.liste;
    l2[0].e = m.liste[1].qa;
    l2[1].e = rundeS(m.liste[1].qe + 0.1);
    PRUEF(voll(m, l2, aus));
  }

  // ---- 9. a move by more than the note's own length keeps the source between the old and the new interval (a breath there)
  {
    Material r = zweiToene(2.5);
    const std::vector<float> atem = synth::rauschen(0.05, -30.0, 11);
    for (double von : {0.93, 1.22}) {
      for (size_t i = 0; i < atem.size(); ++i) {
        r.x.l[static_cast<size_t>(s(von)) + i] += atem[i];
        r.x.r[static_cast<size_t>(s(von)) + i] += atem[i];
      }
    }
    struct Fall { size_t note; double um, von; };
    for (const Fall& fa : {Fall{0, 0.7, 0.93}, Fall{1, -0.7, 1.22}}) {
      std::vector<AudioNote> l = {r.liste[fa.note]};   // the other tone is no note: the moved note may cover it
      l[0].a = rundeS(l[0].qa + fa.um);
      l[0].e = rundeS(l[0].qe + fa.um);
      Stereo aus;
      PRUEF(voll(r, l, aus));
      const double db = rmsDb(aus.l, s(fa.von), s(fa.von + 0.05)), db0 = rmsDb(r.x.l, s(fa.von), s(fa.von + 0.05));
      std::printf("9 move %+.2f s (more than the length): breath at %.2f s %+.2f dB against the source\n", fa.um, fa.von, db - db0);
      PRUEF_NAH(db, db0, 1.0);
    }
  }

  // ---- 7. run time: a one-note time edit of a 240 s stereo source
#ifndef MIT_ASAN
  {
    const double periode = 2.5;
    Material lang;
    lang.x.l = synth::wiederhole(m.x.l, 240.0);
    lang.x.r.resize(lang.x.l.size());
    for (size_t i = 0; i < lang.x.l.size(); ++i) lang.x.r[i] = 0.8f * (i >= 5 ? lang.x.l[i - 5] : 0.0f);
    lang.k = m.k;
    lang.k.frames = lang.x.frames();
    const int64_t nf = frameZahl(lang.x.frames());
    lang.k.f0_ct.assign(static_cast<size_t>(nf), 0.0);
    lang.k.konf.assign(static_cast<size_t>(nf), 1.0);
    const int64_t pf = static_cast<int64_t>(m.k.f0_ct.size());
    const int wdh = static_cast<int>(240.0 / periode);
    for (int64_t j = 0; j < nf; ++j) {
      const int64_t pos = j * HOP, w = pos / s(periode), rest = pos - w * s(periode);
      if (w < wdh && rest / HOP < pf) lang.k.f0_ct[static_cast<size_t>(j)] = m.k.f0_ct[static_cast<size_t>(rest / HOP)];   // the frame below
    }
    for (int w = 0; w < wdh; ++w) {
      for (size_t i = 0; i < m.liste.size(); ++i) {
        AudioNote n = m.liste[i];
        n.id = "t" + std::to_string(w * 2 + static_cast<int>(i) + 1);
        n.qa = rundeS(n.qa + w * periode);
        n.qe = rundeS(n.qe + w * periode);
        lang.liste.push_back(n);
      }
    }
    std::vector<AudioNote> l = lang.liste;
    AudioNote& n = l[l.size() / 2];
    n.e = rundeS(n.qa + 1.5 * (n.qe - n.qa));
    Stereo aus;
    const auto t0 = std::chrono::steady_clock::now();
    auto r = rendere(lang.x, lang.k, l, nullptr, nullptr, aus, nullptr);
    const double sek = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    PRUEF(std::holds_alternative<RenderErgebnis>(r));
    std::printf("7 one-note stretch of a 240 s stereo source: %.3f s wall time (limit 1 s)\n", sek);
    PRUEF(sek < 1.0);
  }
#else
  std::printf("7 run time: skipped under ASan\n");
#endif

  PRUEF_ENDE();
}
