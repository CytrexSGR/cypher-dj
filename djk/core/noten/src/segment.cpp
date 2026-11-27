// Segmenter `noten_hmm-1`: C++ port of `noten_hmm` of the bench (messungen/M21-noten/m21_k_pyin.py, parameters SEG verbatim).
// One pitch per frame, notes cut from that one curve. The numpy and scipy behaviour the prototype relies on is reproduced where it
// matters (median with NaN, percentile with linear interpolation, nearest-edge median and percentile filters, np.interp).
// The golden vectors (tests/daten/gold) pin the result: same note count, onsets within one frame, pitch within 2 cents.
#include <algorithm>
#include <cstdio>
#include <array>
#include <cmath>
#include <limits>
#include <set>

#include "intern.h"

namespace cdj::noten {
namespace {

// SEG of the prototype
constexpr double MIN_S = 0.060;       // shortest note
constexpr int LUECKE = 2;             // unvoiced gaps up to this many frames inside a note are bridged (if the pitch matches)
constexpr int GLAETTUNG = 21;         // median filter over this many frames on the pitch track
constexpr double SCHWELLE_CT = 70.0;  // a new note needs the smoothed pitch this far from the running centre of the current note
constexpr int DAUER = 5;              // ... for this many frames in a row
constexpr double DIP_DB = 6.0;        // re-attack: level dip of this depth against the louder side within +-0.1 s on both sides
constexpr double STUFE_DB = 4.0;      // re-attack without a dip: abrupt lasting level step of this size
constexpr double ONSET_DB = 8.0;      // note onset: level crossing this far below the note's P75 level
constexpr double KERN = 0.15;         // the note centre pitch is the median over the core, without this fraction at each end

const double NaN = std::numeric_limits<double>::quiet_NaN();

/// np.median: NaN when any element is NaN or there is none; the mean of the two middle elements for an even count.
double median(std::vector<double> v) {
  if (v.empty()) return NaN;
  for (double x : v) if (std::isnan(x)) return NaN;
  const size_t n = v.size(), h = n / 2;
  std::nth_element(v.begin(), v.begin() + static_cast<std::ptrdiff_t>(h), v.end());
  if (n % 2 == 1) return v[h];
  const double b = v[h];
  const double a = *std::max_element(v.begin(), v.begin() + static_cast<std::ptrdiff_t>(h));
  return (a + b) / 2.0;
}

/// np.nanmedian: the median of the elements that are not NaN, NaN when none is left.
double nanmedian(const std::vector<double>& m, size_t a, size_t e) {
  std::vector<double> v;
  for (size_t i = a; i < e && i < m.size(); ++i) if (!std::isnan(m[i])) v.push_back(m[i]);
  return median(std::move(v));
}

/// np.percentile (linear interpolation, numpy's lerp form) of a sample, q in 0..100.
double percentile(std::vector<double> v, double q) {
  std::sort(v.begin(), v.end());
  const double virt = static_cast<double>(v.size() - 1) * (q / 100.0);
  const size_t vor = static_cast<size_t>(std::floor(virt));
  const size_t nach = std::min(vor + 1, v.size() - 1);
  const double t = virt - static_cast<double>(vor);
  const double a = v[vor], b = v[nach];
  const double diff = b - a;
  return t >= 0.5 ? b - diff * (1.0 - t) : a + diff * t;
}

/// scipy.ndimage.median_filter(size=w, mode="nearest") of a 1-D array.
std::vector<double> medianGlatt(const std::vector<double>& m, int w) {
  const int n = static_cast<int>(m.size());
  if (n <= 1) return m;
  std::vector<double> out(m.size()), fenster(static_cast<size_t>(w));
  const int h = w / 2;
  for (int i = 0; i < n; ++i) {
    for (int k = 0; k < w; ++k) fenster[static_cast<size_t>(k)] = m[static_cast<size_t>(std::clamp(i - h + k, 0, n - 1))];
    std::nth_element(fenster.begin(), fenster.begin() + h, fenster.end());
    out[static_cast<size_t>(i)] = fenster[static_cast<size_t>(h)];
  }
  return out;
}

/// scipy.ndimage.percentile_filter(x, 90, size=w, mode="nearest"): the element of rank int(w * 90 / 100) of each window.
std::vector<double> perzentilFilter90(const std::vector<double>& x, int w) {
  const int n = static_cast<int>(x.size());
  std::vector<double> out(x.size()), fenster(static_cast<size_t>(w));
  const int h = w / 2;
  const int rang = static_cast<int>(static_cast<double>(w) * 90.0 / 100.0);
  for (int i = 0; i < n; ++i) {
    for (int k = 0; k < w; ++k) fenster[static_cast<size_t>(k)] = x[static_cast<size_t>(std::clamp(i - h + k, 0, n - 1))];
    std::nth_element(fenster.begin(), fenster.begin() + rang, fenster.end());
    out[static_cast<size_t>(i)] = fenster[static_cast<size_t>(rang)];
  }
  return out;
}

double ptp(const std::vector<double>& s, size_t a, size_t e) {
  return *std::max_element(s.begin() + static_cast<std::ptrdiff_t>(a), s.begin() + static_cast<std::ptrdiff_t>(e)) -
         *std::min_element(s.begin() + static_cast<std::ptrdiff_t>(a), s.begin() + static_cast<std::ptrdiff_t>(e));
}

std::vector<double> stueck(const std::vector<double>& v, int64_t a, int64_t e) {
  a = std::max<int64_t>(a, 0);
  e = std::min<int64_t>(e, static_cast<int64_t>(v.size()));
  if (e <= a) return {};
  return std::vector<double>(v.begin() + a, v.begin() + e);
}

/// Start indices of the notes inside one voiced run, from the median-smoothed pitch track s (cents): `_teile_hoehe` of the prototype.
std::vector<int> teileHoehe(const std::vector<double>& s, double schwelle, int dauer, const std::vector<double>& roh) {
  const double ruhig = 60.0, weite = 3.5;
  const int n = static_cast<int>(s.size());
  std::vector<double> abw(s.size());
  for (size_t i = 0; i < s.size(); ++i) abw[i] = std::fabs(roh[i] - s[i]);
  const std::vector<double> vib = perzentilFilter90(abw, 45);
  std::vector<int> starts = {0};
  int plateau = 0;   // first frame the reference is taken from
  int i = 1;
  while (i < n) {
    if (abbruchAngefordert()) return starts;
    const int von = std::max(plateau, i - 200);   // hist[-200:]
    const double ref = median(stueck(s, von, i));
    const double thr = std::max(schwelle, weite * vib[static_cast<size_t>(i)]);
    if (std::fabs(s[static_cast<size_t>(i)] - ref) > thr) {
      int j = i;
      while (j + dauer <= n && ptp(s, static_cast<size_t>(j), static_cast<size_t>(j + dauer)) > ruhig) ++j;
      const std::vector<double> seg = (j + dauer <= n) ? stueck(s, j, j + 2 * dauer) : stueck(s, i, n);
      const double neu = median(seg);
      if (std::fabs(neu - ref) > thr && static_cast<int>(seg.size()) >= std::min(dauer, n - i)) {
        int k = std::min(j, n - 1);
        while (k > starts.back() && std::fabs(s[static_cast<size_t>(k - 1)] - ref) >= 0.5 * std::fabs(neu - ref)) --k;
        if (k > starts.back()) {
          starts.push_back(k);
          plateau = std::min(j, n - 1);
          i = std::max(plateau, k) + 1;
          continue;
        }
      }
    }
    ++i;
  }
  return starts;
}

/// Re-attack split points inside [a, e): local level minima at least dip_db below the louder side on both sides (within 20 frames) and
/// at least `rand` frames from the ends: `_teile_pegel`. Note: the window of the local minimum test runs to t + 4 even beyond e.
std::vector<int> teilePegel(const std::vector<double>& lv, int a, int e, double dip_db, int rand) {
  const int weit = 20;
  const int nf = static_cast<int>(lv.size());
  std::vector<int> out;
  int t = a + rand;
  while (t < e - rand) {
    const int lo = std::max(a, t - weit), hi = std::min(e, t + weit + 1);
    const double lokal = *std::min_element(lv.begin() + std::max(a, t - 3), lv.begin() + std::min(nf, t + 4));
    const double links = *std::max_element(lv.begin() + lo, lv.begin() + t + 1);
    const double rechts = *std::max_element(lv.begin() + t, lv.begin() + hi);
    if (lv[static_cast<size_t>(t)] <= lokal && links - lv[static_cast<size_t>(t)] >= dip_db && rechts - lv[static_cast<size_t>(t)] >= dip_db) {
      out.push_back(t);
      t += rand;
    } else {
      ++t;
    }
  }
  return out;
}

/// Split points inside [a, e) at an abrupt, lasting level step of at least stufe_db: `_teile_stufe`.
std::vector<int> teileStufe(const std::vector<double>& lv, int a, int e, double stufe_db, int rand) {
  std::vector<int> out;
  const int r = std::max(rand, 14);
  int t = a + r;
  while (t < e - r) {
    const double g = lv[static_cast<size_t>(t + 3)] - lv[static_cast<size_t>(t - 3)];
    if (std::fabs(g) >= stufe_db) {
      const double before = median(stueck(lv, t - 13, t - 3));
      const double after = median(stueck(lv, t + 4, t + 14));
      const double d = after - before;
      const int sg = (d > 0) - (d < 0), sgg = (g > 0) - (g < 0);
      if (std::fabs(d) >= 0.6 * std::fabs(g) && sg == sgg) {
        // the frame of the steepest change inside the window
        int best = 0;
        double bw = -1.0;
        for (int q = 0; q < 6; ++q) {
          const double w = std::fabs(lv[static_cast<size_t>(t - 3 + q + 1)] - lv[static_cast<size_t>(t - 3 + q)]);
          if (w > bw) { bw = w; best = q; }   // first maximum
        }
        out.push_back(t - 3 + best + 1);
        t += rand;
        continue;
      }
    }
    ++t;
  }
  return out;
}

}  // namespace

double stimmhaftAnteil(const Kurve& k) {
  if (k.f0_ct.empty()) return 0.0;
  size_t n = 0;
  for (double v : k.f0_ct) if (v > 0) ++n;
  return static_cast<double>(n) / static_cast<double>(k.f0_ct.size());
}

void kappeNoten(std::vector<NoteQ>& noten) {
  if (noten.size() > static_cast<size_t>(MAX_NOTEN)) {
    std::fprintf(stderr, "note limit: %zu of %zu notes dropped (a sidecar holds at most %d)\n", noten.size() - static_cast<size_t>(MAX_NOTEN), noten.size(), MAX_NOTEN);
    noten.resize(static_cast<size_t>(MAX_NOTEN));
  }
}

std::vector<NoteQ> segmentiere(const Kurve& kurve, const std::vector<float>& audio, int sr) {
  const int hop = kurve.hop;
  const int nf = static_cast<int>(kurve.f0_ct.size());
  const int64_t nx = static_cast<int64_t>(audio.size());
  const std::vector<double>& f0 = kurve.f0_ct;
  bool irgendwo = false;
  for (double v : f0) if (v > 0) { irgendwo = true; break; }
  if (nf == 0 || !irgendwo) return {};
  const int nmin = std::max(2, static_cast<int>(std::ceil(MIN_S * sr / hop - 0.5)));
  std::vector<double> m(static_cast<size_t>(nf));
  std::vector<char> voiced(static_cast<size_t>(nf));
  for (int i = 0; i < nf; ++i) {
    voiced[static_cast<size_t>(i)] = f0[static_cast<size_t>(i)] > 0;
    m[static_cast<size_t>(i)] = voiced[static_cast<size_t>(i)] ? f0[static_cast<size_t>(i)] : NaN;
  }

  // level per frame (dB), 2 hops wide, smoothed over 3 frames
  std::vector<double> c(static_cast<size_t>(nx) + 1, 0.0);
  for (int64_t i = 0; i < nx; ++i) c[static_cast<size_t>(i) + 1] = c[static_cast<size_t>(i)] + static_cast<double>(audio[static_cast<size_t>(i)]) * static_cast<double>(audio[static_cast<size_t>(i)]);
  std::vector<double> lv0(static_cast<size_t>(nf));
  for (int i = 0; i < nf; ++i) {
    const int64_t ctr = std::min<int64_t>(static_cast<int64_t>(i) * hop, nx);
    const int64_t lo = std::max<int64_t>(ctr - hop, 0), hi = std::min<int64_t>(ctr + hop, nx);
    const double mw = (c[static_cast<size_t>(hi)] - c[static_cast<size_t>(lo)]) / static_cast<double>(std::max<int64_t>(hi - lo, 1));
    lv0[static_cast<size_t>(i)] = 10.0 * std::log10(std::max(mw, 1e-12));
  }
  std::vector<double> lv(static_cast<size_t>(nf));
  for (int i = 0; i < nf; ++i) {   // np.convolve(np.pad(lv, 2, "edge"), ones(3) / 3, "same")[2:-2]
    const double a = lv0[static_cast<size_t>(std::max(i - 1, 0))], b = lv0[static_cast<size_t>(i)], d = lv0[static_cast<size_t>(std::min(i + 1, nf - 1))];
    lv[static_cast<size_t>(i)] = a * (1.0 / 3.0) + b * (1.0 / 3.0) + d * (1.0 / 3.0);
  }

  // voiced runs; short gaps are bridged when the pitch on both sides is within 100 cents
  std::vector<std::pair<int, int>> runs;
  for (int i = 0; i < nf;) {
    if (!voiced[static_cast<size_t>(i)]) { ++i; continue; }
    const int a = i;
    for (;;) {
      int j = i;
      while (j < nf && voiced[static_cast<size_t>(j)]) ++j;
      int k = j;
      while (k < nf && !voiced[static_cast<size_t>(k)]) ++k;
      if (k < nf && k - j <= LUECKE &&
          std::fabs(median(stueck(m, std::max(a, j - 3), j)) - median(stueck(m, k, k + 3))) < 100.0) {
        i = k;
        continue;
      }
      runs.emplace_back(a, j);
      i = j;
      break;
    }
  }

  std::vector<std::array<int, 2>> notes;   // [first frame, end frame)
  for (const auto& [a, e] : runs) {
    if (abbruchAngefordert()) return {};
    std::vector<double> seg(m.begin() + a, m.begin() + e);
    // linear interpolation over the bridged gaps (np.interp; the ends of a run are voiced)
    {
      std::vector<size_t> gut;
      for (size_t q = 0; q < seg.size(); ++q) if (!std::isnan(seg[q])) gut.push_back(q);
      size_t next = 0;
      for (size_t q = 0; q < seg.size(); ++q) {
        if (!std::isnan(seg[q])) continue;
        while (next + 1 < gut.size() && gut[next + 1] < q) ++next;
        // gut[next] is the last good index before q (next advances while the following one is still before q)
        const size_t l = gut[next], r = gut[next + 1];
        const double fl = seg[l], fr = seg[r];
        const double slope = (fr - fl) / static_cast<double>(r - l);
        seg[q] = slope * static_cast<double>(q - l) + fl;
      }
    }
    const std::vector<double> sm = medianGlatt(seg, GLAETTUNG);
    std::vector<int> st;
    for (int k : teileHoehe(sm, SCHWELLE_CT, DAUER, seg)) st.push_back(a + k);
    st.push_back(e);
    for (size_t q = 0; q + 1 < st.size(); ++q) {
      const int u = st[q], v = st[q + 1];
      std::set<int> schnitte;
      for (int t : teilePegel(lv, u, v, DIP_DB, nmin)) schnitte.insert(t);
      for (int t : teileStufe(lv, u, v, STUFE_DB, nmin)) schnitte.insert(t);
      std::vector<int> cuts = {u};
      for (int t : schnitte) if (t - u >= nmin && v - t >= nmin) cuts.push_back(t);
      cuts.push_back(v);
      for (size_t z = 0; z + 1 < cuts.size(); ++z) notes.push_back({cuts[z], cuts[z + 1]});
    }
  }

  // merge short notes into a touching neighbour of nearer pitch, else drop
  auto mitteVon = [&](const std::array<int, 2>& nt) { return nanmedian(m, static_cast<size_t>(nt[0]), static_cast<size_t>(nt[1])); };
  for (bool changed = true; changed;) {
    changed = false;
    for (size_t idx = 0; idx < notes.size(); ++idx) {
      const auto nt = notes[idx];
      if (nt[1] - nt[0] >= nmin) continue;
      std::vector<size_t> nb;
      if (idx > 0 && notes[idx - 1][1] >= nt[0] - 1) nb.push_back(idx - 1);
      if (idx + 1 < notes.size() && notes[idx + 1][0] <= nt[1] + 1) nb.push_back(idx + 1);
      if (!nb.empty()) {
        // min(nb, key=...): the first of the smallest keys (a NaN key never wins against a later one)
        size_t tgt = nb[0];
        double bk = std::fabs(mitteVon(notes[tgt]) - mitteVon(nt));
        for (size_t q = 1; q < nb.size(); ++q) {
          const double kk = std::fabs(mitteVon(notes[nb[q]]) - mitteVon(nt));
          if (kk < bk) { bk = kk; tgt = nb[q]; }
        }
        notes[tgt] = {std::min(notes[tgt][0], nt[0]), std::max(notes[tgt][1], nt[1])};
      }
      notes.erase(notes.begin() + static_cast<std::ptrdiff_t>(idx));
      changed = true;
      break;
    }
  }

  // onset refinement: a note that follows an unvoiced stretch starts where the level crosses (P75 of the note level - 8 dB), searched
  // backwards over at most 0.25 s and forwards over at most 60 ms, never into the previous note
  std::set<int> startsRun;
  for (const auto& r : runs) startsRun.insert(r.first);
  const int rueck = static_cast<int>(0.25 * sr / hop), vor = static_cast<int>(0.06 * sr / hop);
  for (size_t idx = 0; idx < notes.size(); ++idx) {
    auto& nt = notes[idx];
    if (!startsRun.count(nt[0])) continue;
    const double thr = percentile(std::vector<double>(lv.begin() + nt[0], lv.begin() + nt[1]), 75.0) - ONSET_DB;
    int lim = idx > 0 ? notes[idx - 1][1] : 0;
    lim = std::max(lim, nt[0] - rueck);
    int t = nt[0];
    while (t - 1 >= lim && lv[static_cast<size_t>(t - 1)] >= thr) --t;
    if (t == nt[0]) {
      while (t < nt[1] - nmin && t < nt[0] + vor && lv[static_cast<size_t>(t)] < thr) ++t;
    }
    nt[0] = t;
  }

  // level reference: the 95th percentile of the 20 ms block RMS of the file
  const int64_t blk = std::max<int64_t>(static_cast<int64_t>(0.02 * sr), 1);
  const int64_t nb = nx / blk;
  double ref = 0.0;
  if (nb > 0) {
    std::vector<double> rms(static_cast<size_t>(nb));
    for (int64_t b = 0; b < nb; ++b) {
      double s = 0;
      for (int64_t q = 0; q < blk; ++q) {
        const double v = audio[static_cast<size_t>(b * blk + q)];
        s += v * v;
      }
      rms[static_cast<size_t>(b)] = std::sqrt(s / static_cast<double>(blk));
    }
    ref = percentile(std::move(rms), 95.0);
  }

  std::vector<NoteQ> out;
  const double dur = static_cast<double>(nx) / sr;
  for (const auto& nt : notes) {
    const int a = nt[0], e = nt[1];
    const int d = e - a;
    int k0 = a + static_cast<int>(std::ceil(KERN * d)), k1 = e - static_cast<int>(std::ceil(KERN * d));
    if (k1 <= k0) { k0 = a; k1 = e; }
    double ton = nanmedian(m, static_cast<size_t>(k0), static_cast<size_t>(k1));
    if (std::isnan(ton)) ton = nanmedian(m, static_cast<size_t>(a), static_cast<size_t>(e));   // the prototype would give NaN here
    ton /= 100.0;
    const double t0 = std::max(0.0, (a - 0.5) * hop / sr), t1 = std::min(dur, (e - 0.5) * hop / sr);
    const int64_t s0 = static_cast<int64_t>(t0 * sr), s1 = std::min<int64_t>(static_cast<int64_t>(t1 * sr), nx);
    double pp = 0.0;
    if (s1 > s0 && ref > 0) {
      double s = 0;
      for (int64_t q = s0; q < s1; ++q) {
        const double v = audio[static_cast<size_t>(q)];
        s += v * v;
      }
      pp = std::min(1.0, std::sqrt(s / static_cast<double>(s1 - s0)) / ref);
    }
    out.push_back(NoteQ{t0, t1, ton, pp});
  }
  return out;
}

}  // namespace cdj::noten
