// Plan 1.11 T4: the effect-host insert stage (insert kind `host`, ArrHostStufe) and its place in the arrangement mixer.
// The synthetic host: the round trip of the real system is a fixed number of samples (T1: exactly 2 x quantum plus the latency the plugin reports); here the return of a block is the
// send of earlier blocks, scaled and delayed by 600 samples (a synthetic value, larger than the block of 256 so that the return of a block exists before the block runs).
// Cases: 1 host_stufe_durchreichen (the return reaches the output), 2 host_stufe_bypass_haelt_zeit (an = false or an unhealthy host: the input delayed by exactly the latency, residual 0),
// 3 host_stufe_waechter (NaN, 100.0 and -100.0 in the return: 0, 8.0, -8.0, one count per frame), 3b the negative control (10,000 blocks of ordinary signal: 0 guard events),
// 4 host_an_und_gesund_zugleich (an and gesund fall in the same block: every frame between the return and the delayed dry signal, no gap; direct and through the mixer with the outer blend),
// 5 pdc_host_ausrichtung (the click of a host strip and of a plain strip coincide at the PM: on tracks, inside a group, through a send into a return; healthy and unhealthy),
// 6 pdc_host_latenzwechsel (reload with another latency 600 -> 700, 900, 1500, none -> 752, 752 -> none at n = 64..512 while a sine plays on another strip of the group: no step beyond 2 x the sine's own, no run of zeros),
// 7 host_slot_nicht_lim (a host stage on pool slot 4 with the master limiter active: the limiter is untouched; under AddressSanitizer a host slot that fell into lim_[] aborts),
// 8 lader_host (slot 5 and a slot twice are refused, a core without the host ports and the plain loader refuse with host_fehlt, latenz 8192 is pdc_zu_lang, 8191 loads),
// 9 keine_allokation (2000 blocks with a running host stage and a swap that changes its latency: 0 allocations; positive control: constructing the pool counts).
// Mutations (CMakeLists.txt): HOST_OHNE_WAECHTER (3), HOST_RING_KURZ (2), HOST_LATENZ_NULL (5), HOST_PDC_OHNE_BLENDE (6).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "arr_file.h"
#include "cypherdj/arr_host_stufe.h"
#include "cypherdj/arr_playback.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrInsArt;
using cdj::ArrStufe;

#define TR(x) auto x##_p = std::make_unique<Treiber>(); Treiber& x = *x##_p;
static constexpr int64_t V = 537;
static constexpr int LAT = 600;   // the synthetic round trip

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static void setze(Treiber& t, const std::string& pfad, float w) { t.arr.setze_sofort(reg(t, pfad), w); }

static ArrStufe host_stufe(int slot, int latenz, bool an = true) {
  ArrStufe s{ArrInsArt::host, static_cast<uint8_t>(slot), an};
  s.latenz = static_cast<uint16_t>(latenz);
  return s;
}

// the host process of the tests: the return of the block starting at s is gain x the send of the samples s - lat ..; a send buffer is zeroed before every block (as main.cpp does)
struct Synth {
  int h = 1, lat = LAT, n = 256;
  float gain = 0.5f;
  bool gesund = true;
  std::vector<float> sl, sr;                     // every sample sent so far, indexed by kern sample
  std::vector<float> aus_l = std::vector<float>(cdj::ARR_BLOCK), aus_r = std::vector<float>(cdj::ARR_BLOCK);
  std::vector<float> ret_l = std::vector<float>(cdj::ARR_BLOCK), ret_r = std::vector<float>(cdj::ARR_BLOCK);
  int gesendet = 0;                              // samples of the previous block in aus_*
  void anbinden(Treiber& t) {
    n = t.n;
    t.vor_block = [this, &t](int64_t s) { vor(t, s); };
  }
  void vor(Treiber& t, int64_t s) {
    sl.insert(sl.end(), aus_l.begin(), aus_l.begin() + gesendet);
    sr.insert(sr.end(), aus_r.begin(), aus_r.begin() + gesendet);
    gesendet = n;
    PRUEF(static_cast<int64_t>(sl.size()) == s);
    for (int i = 0; i < n; ++i) {
      const int64_t q = s + i - lat;
      ret_l[i] = q >= 0 ? gain * sl[static_cast<size_t>(q)] : 0.0f;
      ret_r[i] = q >= 0 ? gain * sr[static_cast<size_t>(q)] : 0.0f;
    }
    std::fill(aus_l.begin(), aus_l.begin() + n, 0.0f);
    std::fill(aus_r.begin(), aus_r.begin() + n, 0.0f);
    t.arr.host_stufe().setze_zeiger(h, aus_l.data(), aus_r.data(), ret_l.data(), ret_r.data());
    t.arr.host_stufe().setze_gesund(h, gesund);
  }
};

// a signal that is never zero and never repeats inside a test
static float signal_von(int64_t i) {
  return 0.4f * std::sin(0.031f * static_cast<float>(i)) + 0.3f * std::sin(0.0117f * static_cast<float>(i) + 1.0f) + 0.001f * static_cast<float>(i % 7);
}

// ---------------------------------------------------------------- 1, 2, 3: the stage on its own
static void direkt() {
  constexpr int N = 256, BLOECKE = 40;
  {  // 1 host_stufe_durchreichen: the return is the input x 0.5 delayed 600 -> the output is that, exactly
    cdj::ArrHostStufe st;
    std::vector<float> ein(N * BLOECKE), aus(N * BLOECKE);
    for (size_t i = 0; i < ein.size(); ++i) ein[i] = signal_von(static_cast<int64_t>(i));
    float send_l[N], send_r[N], ret[N];
    bool ok = true;
    for (int b = 0; b < BLOECKE; ++b) {
      for (int i = 0; i < N; ++i) {
        const int q = b * N + i - LAT;
        ret[i] = q >= 0 ? 0.5f * ein[static_cast<size_t>(q)] : 0.0f;
      }
      st.setze_zeiger(1, send_l, send_r, ret, ret);
      st.block(1, &ein[static_cast<size_t>(b) * N], &ein[static_cast<size_t>(b) * N], &aus[static_cast<size_t>(b) * N], &aus[static_cast<size_t>(b) * N], N, LAT, true, true);
      for (int i = 0; i < N; ++i) ok = ok && send_l[i] == ein[static_cast<size_t>(b) * N + i] && send_r[i] == ein[static_cast<size_t>(b) * N + i];   // the send is the input
    }
    PRUEF(ok);
    double rest = 0.0;
    for (size_t i = 0; i < aus.size(); ++i) {
      const float soll = static_cast<int64_t>(i) >= LAT ? 0.5f * ein[i - LAT] : 0.0f;
      rest = std::max(rest, static_cast<double>(std::fabs(aus[i] - soll)));
    }
    std::printf("1: host_stufe_durchreichen: residual against 0.5 x input delayed %d = %g, counter %llu\n", LAT, rest, static_cast<unsigned long long>(st.wachter_zaehler()));
    PRUEF(rest == 0.0);
    PRUEF(st.wachter_zaehler() == 0);
    PRUEF(st.gewicht(1) == cdj::HOST_BLENDE);   // positive control: the return weight reached its end, the check above was on the return path
  }
  for (const bool gesund : {true, false}) {  // 2 host_stufe_bypass_haelt_zeit: an = false (or an unhealthy host) -> the input delayed by exactly LAT, residual 0
    cdj::ArrHostStufe st;
    std::vector<float> ein(N * BLOECKE), aus(N * BLOECKE), ein2(N * BLOECKE), aus2(N * BLOECKE);
    for (size_t i = 0; i < ein.size(); ++i) {
      ein[i] = signal_von(static_cast<int64_t>(i));
      ein2[i] = -signal_von(static_cast<int64_t>(i) + 99);
    }
    float send[N], ret[N];
    for (float& x : ret) x = 3.0f;   // whatever the host sends back is not heard
    for (int b = 0; b < BLOECKE; ++b) {
      st.setze_zeiger(1, send, send, ret, ret);
      st.setze_zeiger(2, send, send, ret, ret);
      // host 1: an = false (the weight starts on the dry side). host 2 (another latency) runs alongside and must not disturb it
      st.block(1, &ein[static_cast<size_t>(b) * N], &ein[static_cast<size_t>(b) * N], &aus[static_cast<size_t>(b) * N], &aus[static_cast<size_t>(b) * N], N, LAT, gesund ? false : true, gesund);
      st.block(2, &ein2[static_cast<size_t>(b) * N], &ein2[static_cast<size_t>(b) * N], &aus2[static_cast<size_t>(b) * N], &aus2[static_cast<size_t>(b) * N], N, 200, false, true);
    }
    double rest = 0.0, rest2 = 0.0;
    for (size_t i = 0; i < aus.size(); ++i) {
      const float soll = static_cast<int64_t>(i) >= LAT ? signal_von(static_cast<int64_t>(i) - LAT) : 0.0f;
      const float soll2 = static_cast<int64_t>(i) >= 200 ? -signal_von(static_cast<int64_t>(i) - 200 + 99) : 0.0f;
      rest = std::max(rest, static_cast<double>(std::fabs(aus[i] - soll)));
      rest2 = std::max(rest2, static_cast<double>(std::fabs(aus2[i] - soll2)));
    }
    std::printf("2: host_stufe_bypass_haelt_zeit (%s): residual against the input delayed %d = %g (host 2, latency 200: %g)\n", gesund ? "an = false" : "gesund = false", LAT, rest, rest2);
    PRUEF(rest == 0.0);
    PRUEF(rest2 == 0.0);
    PRUEF(st.gewicht(1) == 0);
  }
  {  // 3 host_stufe_waechter: a NaN, 100.0 and -100.0 in the return (stage on and healthy, steady state) read 0, 8.0 and -8.0; one count per frame in which the guard acted
    cdj::ArrHostStufe st;
    float ein[N], aus[N], send[N], ret_l[N], ret_r[N];
    for (int b = 0; b < 8; ++b) {   // the weight reaches the return side
      for (int i = 0; i < N; ++i) { ein[i] = 0.1f; ret_l[i] = ret_r[i] = 0.25f; }
      st.setze_zeiger(1, send, send, ret_l, ret_r);
      st.block(1, ein, ein, aus, aus, N, LAT, true, true);
    }
    PRUEF(st.gewicht(1) == cdj::HOST_BLENDE && st.wachter_zaehler() == 0);
    for (int i = 0; i < N; ++i) { ein[i] = 0.1f; ret_l[i] = ret_r[i] = 0.25f; }
    ret_l[10] = std::numeric_limits<float>::quiet_NaN();
    ret_l[20] = 100.0f;
    ret_r[30] = -100.0f;
    st.setze_zeiger(1, send, send, ret_l, ret_r);
    float aus_r[N];
    st.block(1, ein, ein, aus, aus_r, N, LAT, true, true);
    std::printf("3: host_stufe_waechter: NaN -> %g, 100.0 -> %g, -100.0 -> %g, counter %llu\n", static_cast<double>(aus[10]), static_cast<double>(aus[20]), static_cast<double>(aus_r[30]),
                static_cast<unsigned long long>(st.wachter_zaehler()));
    PRUEF(aus[10] == 0.0f);
    PRUEF(aus[20] == 8.0f);
    PRUEF(aus_r[30] == -8.0f);
    PRUEF(st.wachter_zaehler() == 3);
    PRUEF(aus[11] == 0.25f && aus[9] == 0.25f && aus_r[10] == 0.25f);   // the neighbours are untouched
    bool endlich = true;
    for (int i = 0; i < N; ++i) endlich = endlich && std::isfinite(aus[i]) && std::isfinite(aus_r[i]);
    PRUEF(endlich);
  }
  {  // 3b negative control: 10,000 blocks of ordinary signal give 0 guard events
    cdj::ArrHostStufe st;
    float ein[N], aus[N], send[N], ret[N];
    int64_t s = 0;
    for (int b = 0; b < 10000; ++b) {
      for (int i = 0; i < N; ++i) {
        ein[i] = signal_von(s + i);
        ret[i] = 0.9f * signal_von(s + i - LAT);   // |signal| < 0.75: nothing near the bound
      }
      st.setze_zeiger(1, send, send, ret, ret);
      st.block(1, ein, ein, aus, aus, N, LAT, true, true);
      s += N;
    }
    std::printf("3b: 10,000 blocks of ordinary signal: guard events %llu\n", static_cast<unsigned long long>(st.wachter_zaehler()));
    PRUEF(st.wachter_zaehler() == 0);
  }
  {  // 4 host_an_und_gesund_zugleich (direct): dry delayed = 1.0, return = 0.2; an and gesund fall in the same block: every frame stays in [0.2, 1.0], no gap, and the end is the dry side
    cdj::ArrHostStufe st;
    float ein[N], aus[N], send[N], ret[N];
    for (float& x : ret) x = 0.2f;
    float lo = 10.0f, hi = -10.0f, voriger = 0.2f, max_schritt = 0.0f;
    for (int b = 0; b < 30; ++b) {
      const bool an = b < 12;   // fully up by block 4 (HOST_BLENDE 480 < 2 blocks), then both fall at block 12
      for (float& x : ein) x = 1.0f;
      st.setze_zeiger(1, send, send, ret, ret);
      st.block(1, ein, ein, aus, aus, N, 300, an, an);
      if (b >= 6)
        for (int i = 0; i < N; ++i) {
          lo = std::min(lo, aus[i]);
          hi = std::max(hi, aus[i]);
          max_schritt = std::max(max_schritt, std::fabs(aus[i] - voriger));
          voriger = aus[i];
        }
    }
    std::printf("4: host_an_und_gesund_zugleich (direct): output range [%.4f, %.4f], largest step %.5f, end %.4f\n", static_cast<double>(lo), static_cast<double>(hi), static_cast<double>(max_schritt), static_cast<double>(voriger));
    PRUEF(lo >= 0.2f - 1e-6f && hi <= 1.0f + 1e-6f);
    PRUEF(max_schritt < 0.01f);   // (1.0 - 0.2) over 480 samples = 0.0017 per sample: a gap or a jump would be far above
    PRUEF(voriger == 1.0f);
  }
}

// ---------------------------------------------------------------- 4 through the mixer, 5, 6
// where the host stages sit
enum Form { OHNE, HOST_SPUR, HOST_GRUPPE };

// 4 tracks: 1 plain or with a host stage, 2 plain, 3 in group 1, 4 sends to return 1 (pre, its own fader at -120 dB so that only the send is heard). Only track `wer` holds the clip (clicks, one per beat).
static cdj::ArrSnapshot* bauen(Form f, int wer, const cdj::ArrAudio* a, int latenz, int64_t nr = 1) {
  Bau b(nr);
  for (int i = 1; i <= 4; ++i) b.spur(i, ArrArt::audio);
  b.ausgang(3, 1);
  b.clip(wer, "c1", 0.0, 8.0, a);
  if (f == HOST_SPUR) b.kette(1, {host_stufe(0, latenz)});
  if (f == HOST_GRUPPE) b.gruppen_kette(1, {host_stufe(0, latenz)});
  cdj::ArrSnapshot* s = b.fertig();
  s->ret_da[0] = true;
  s->ret_pre[0] = true;
  cdj::arr_pdc_rechnen(*s);
  return s;
}

struct Lauf {
  std::vector<int64_t> klicks;   // PM samples above 0.2, one per click (the first sample of a click)
  double spitze = 0.0;
  int gesamt = 0;
  int ringe = 0;
};
static Lauf lauf(Form f, int wer, bool gesund, int64_t bis = 168000) {   // the project starts at sample 90000; clicks every 22500 from there
  auto au = Audio::klicks(400000, 22500);
  TR(t)
  t.n = 256;
  Synth host;
  host.gesund = gesund;
  host.anbinden(t);
  setze(t, "ret/1/hall/an", 0.0f);   // the return passes dry
  setze(t, "ins/host/1/an", 1.0f);
  if (wer == 4) {
    setze(t, "spur/4/send/1", 0.0f);
    setze(t, "spur/4/fader", -120.0f);   // the direct path of track 4 is silent: the send alone is under test
  }
  cdj::ArrSnapshot* s = bauen(f, wer, &au->a, LAT);
  t.laden(s);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  t.lauf(bis);
  Lauf l;
  for (int64_t i = 0; i < static_cast<int64_t>(t.pml.size()); ++i) {
    const double a = std::fabs(t.pml[static_cast<size_t>(i)]);
    l.spitze = std::max(l.spitze, a);
    if (a > 0.2 && (l.klicks.empty() || i - l.klicks.back() > 2000)) l.klicks.push_back(i);
  }
  l.gesamt = t.arr.snapshot()->pdc.gesamt;
  l.ringe = t.arr.snapshot()->pdc.ringe;
  return l;
}

static double groesster_schritt(const std::vector<float>& v, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(v[static_cast<size_t>(i) + 1] - v[static_cast<size_t>(i)])));
  return m;
}

static void ausrichtung() {
  const Lauf ref = lauf(OHNE, 1, true);
  std::printf("5: reference without a host stage: %zu clicks, first at %lld, gesamt %d\n", ref.klicks.size(), ref.klicks.empty() ? -1LL : static_cast<long long>(ref.klicks[0]), ref.gesamt);
  PRUEF(ref.klicks.size() >= 3 && ref.gesamt == 0 && ref.ringe == 0);
  for (const Form f : {HOST_SPUR, HOST_GRUPPE}) {
    for (const bool gesund : {true, false}) {
      std::vector<int64_t> erste;
      for (int wer = 1; wer <= 4; ++wer) {
        const Lauf l = lauf(f, wer, gesund);
        PRUEF(l.gesamt == LAT);
        PRUEF(l.klicks.size() == ref.klicks.size());   // every click arrives, on every path (the send path included)
        for (size_t k = 0; k < l.klicks.size() && k < ref.klicks.size(); ++k) PRUEF(l.klicks[k] == ref.klicks[k] + LAT);   // the project is late by exactly the host latency, nowhere else
        erste.push_back(l.klicks.empty() ? -1 : l.klicks[0]);
      }
      std::printf("5: pdc_host_ausrichtung (%s, %s): first click on tracks 1..4 at %lld %lld %lld %lld, expected %lld\n", f == HOST_SPUR ? "host on track 1" : "host on group 1", gesund ? "healthy" : "unhealthy",
                  static_cast<long long>(erste[0]), static_cast<long long>(erste[1]), static_cast<long long>(erste[2]), static_cast<long long>(erste[3]), static_cast<long long>(ref.klicks[0] + LAT));
      for (int w = 0; w < 4; ++w) PRUEF(erste[static_cast<size_t>(w)] == erste[0]);   // offset 0 samples between the paths
    }
  }
  {  // the return path is really heard: with the synthetic gain of 0.5 a later click of the host track is half the level of the same click on a plain track (the first click is at the start of the stage, weight 0: dry)
    auto au = Audio::klicks(400000, 22500);
    float pegel[2] = {};
    for (int wer = 1; wer <= 2; ++wer) {
      TR(t)
      Synth host;
      host.anbinden(t);
      setze(t, "ins/host/1/an", 1.0f);
      t.laden(bauen(HOST_SPUR, wer, &au->a, LAT));
      t.arr.start(0.0, 2, false, 0, V, 256, t.k);
      t.lauf(168000);
      for (int64_t i = 90000 + 2 * 22500; i < 90000 + 2 * 22500 + 3000; ++i) pegel[wer - 1] = std::max(pegel[wer - 1], std::fabs(t.pml[static_cast<size_t>(i + LAT)]));
    }
    std::printf("5: third click level on the host track %.4f, on the plain track %.4f\n", static_cast<double>(pegel[0]), static_cast<double>(pegel[1]));
    PRUEF(pegel[1] > 0.05f);
    PRUEF(std::fabs(pegel[0] - 0.5f * pegel[1]) < 1e-5f);
  }
}

// 6 pdc_host_latenzwechsel: the sine plays on track 2, the host stage sits on track 1 (silent), both in group 1; at sample ~100000 the playback is reloaded with another latency of the host stage
// (-1: no host stage). The delay of track 2 changes with it: the places are fed in every block, so the history exists for any new delay, and the change crosses over in 480 samples. Realistic
// host latencies are 2 x quantum + the plugin latency, so rises by more than a block (600 -> 900, 600 -> 1500, none -> 752) are the normal case.
// where the host stage sits and how the sine reaches the PM (fix round 2: the places PM_GRP and PM_RET, a stage on a return chain; and the stage on the strip of the sine itself)
enum Wo { H_SPUR, H_RET1, H_PM, H_EIGENE };
enum Sig { S_GRP1, S_RET2, S_DIREKT };
struct Wechsel { double plain, nach, schritt; int64_t nullen; int gesamt; double spitze; };
static Wechsel latenzwechsel(int n, int lat_a, int lat_b, Wo wo = H_SPUR, Sig sig = S_GRP1) {
  auto au = Audio::sinus(400000, 440.0, 0.3f);
  // the sine plays on track 2 (H_EIGENE: on track 1, the strip that carries the stage)
  const int sp = wo == H_EIGENE ? 1 : 2;
  auto bauen2 = [&](int latenz) {
    Bau b(1);
    b.spur(1, ArrArt::audio).spur(2, ArrArt::audio);
    if (sig == S_GRP1) b.ausgang(1, 1).ausgang(2, 1);
    b.clip(sp, "c2", 0.0, 8.0, &au->a);
    if (latenz >= 0) {
      if (wo == H_SPUR || wo == H_EIGENE) b.kette(1, {host_stufe(0, latenz)});
      if (wo == H_RET1) b.ret_kette(1, {host_stufe(0, latenz)});
      if (wo == H_PM) b.pm_kette({host_stufe(0, latenz)});
    }
    cdj::ArrSnapshot* s = b.fertig();
    s->ret_da[0] = true;
    s->ret_da[1] = true;
    s->ret_pre[0] = true;
    s->ret_pre[1] = true;
    cdj::arr_pdc_rechnen(*s);
    return s;
  };
  TR(t)
  t.n = n;
  Synth sh;
  sh.anbinden(t);
  sh.n = n;
  setze(t, "ins/host/1/an", 1.0f);
  setze(t, "ret/1/hall/an", 0.0f);
  setze(t, "ret/2/hall/an", 0.0f);
  if (sig == S_RET2) {   // only the send of track 2 into return 2 is heard
    setze(t, "spur/2/send/2", 0.0f);
    setze(t, "spur/2/fader", -120.0f);
  }
  t.laden(bauen2(lat_a));
  t.arr.start(0.0, 2, false, 0, V, n, t.k);
  t.lauf(100000 - 100000 % n);
  const int64_t wechsel = t.s;
  if (lat_b >= 0) sh.lat = lat_b;
  t.laden(bauen2(lat_b));
  t.lauf(135000);
  const std::vector<float>& v = t.pml;
  Wechsel w{};
  w.plain = groesster_schritt(v, 92000, wechsel - 10);   // the sine before the swap (its own steepest step)
  w.nach = groesster_schritt(v, wechsel - 5, 134000);
  w.schritt = 0;
  int64_t lauf_nullen = 0;
  for (int64_t i = wechsel; i < 134000; ++i) {
    if (std::fabs(v[static_cast<size_t>(i)]) < 1e-9f) w.nullen = std::max(w.nullen, ++lauf_nullen);
    else lauf_nullen = 0;
  }
  w.gesamt = t.arr.snapshot()->pdc.gesamt;
  for (int64_t i = 120000; i < 134000; ++i) w.spitze = std::max(w.spitze, static_cast<double>(std::fabs(v[static_cast<size_t>(i)])));
  // the stage on the strip of the sine itself (or on the PM chain) returns 0.5 x the signal (the synthetic host's gain): the levels before and after the swap are scaled back to the sine's own
  const bool halb = wo == H_EIGENE || wo == H_PM;
  if (halb && lat_a >= 0) w.plain *= 2.0;
  if (halb && lat_b >= 0) w.spitze *= 2.0;
  w.schritt = w.nach / w.plain;
  return w;
}

static void latenzwechsel_faelle() {
  struct Fall { const char* name; int a, b; };
  const Fall faelle[] = {{"600 -> 700", 600, 700}, {"600 -> 900", 600, 900}, {"600 -> 1500", 600, 1500}, {"none -> 752", -1, 752}, {"752 -> none", 752, -1}, {"700 -> 600", 700, 600}};
  for (const int n : {64, 128, 256, 512}) {
    for (const Fall& f : faelle) {
      const Wechsel w = latenzwechsel(n, f.a, f.b);
      std::printf("6: pdc_host_latenzwechsel n=%3d %-12s: plain step %.5f, after the swap %.5f (x%.2f, limit x2), longest run of zeros %lld, gesamt %d, peak %.4f\n", n, f.name, w.plain, w.nach, w.schritt,
                  static_cast<long long>(w.nullen), w.gesamt, w.spitze);
      PRUEF(w.plain > 0.005);   // the sine is there
      PRUEF(w.nach < 2.0 * w.plain);
      PRUEF(w.nullen <= 3);     // no gap of silence (a sine crosses zero between two samples, it does not rest on it)
      PRUEF(w.gesamt == std::max(f.b, 0));
      PRUEF(w.spitze > 0.2 && w.spitze < 0.22);   // 0.3 x the centre law 0.7071: the sine goes on at its level
    }
  }
  // fix round 2: a stage on a RETURN chain (the places PM_GRP and PM_RET of the other paths change), and a stage newly added on the strip of the sine itself and on the PM chain
  struct Fall2 { const char* name; Wo wo; Sig sig; int a, b; double peak; };
  const Fall2 faelle2[] = {{"RET1 sine GRP1 none -> 752", H_RET1, S_GRP1, -1, 752, 0.2121}, {"RET1 sine GRP1 752 -> none", H_RET1, S_GRP1, 752, -1, 0.2121},
                           {"RET1 sine RET2 none -> 752", H_RET1, S_RET2, -1, 752, 0.3}, {"RET1 sine RET2 752 -> none", H_RET1, S_RET2, 752, -1, 0.3},
                           {"strip itself none -> 752", H_EIGENE, S_DIREKT, -1, 752, 0.2121}, {"strip itself 752 -> none", H_EIGENE, S_DIREKT, 752, -1, 0.2121},
                           {"PM chain none -> 752", H_PM, S_DIREKT, -1, 752, 0.2121}, {"PM chain 752 -> none", H_PM, S_DIREKT, 752, -1, 0.2121}};
  for (const int n : {128, 256}) {
    for (const Fall2& f : faelle2) {
      const Wechsel w = latenzwechsel(n, f.a, f.b, f.wo, f.sig);
      std::printf("6: pdc_host_latenzwechsel n=%3d %-28s: plain step %.5f, after the swap %.5f (x%.2f, limit x2), longest run of zeros %lld, gesamt %d, peak %.4f\n", n, f.name, w.plain, w.nach, w.schritt,
                  static_cast<long long>(w.nullen), w.gesamt, w.spitze);
      PRUEF(w.plain > 0.005);
      PRUEF(w.nach < 2.0 * w.plain);
      PRUEF(w.nullen <= 3);
      PRUEF(w.gesamt == std::max(f.b, 0));
      PRUEF(std::fabs(w.spitze - f.peak) < 0.01);
    }
  }
}

// 6b pdc_host_verschiebung (fix round 3): the stage of the host slot sits on track 1, which carries the sine; then the slot is given to track 2. ONE load that does it is a removal only (the sine's strip
// leaves with its exit tail, the stage on track 2 stays out until a later load claims the slot again); the contract way is removal in one load and entry in a later load after the tail.
struct Verschiebung { double plain, nach; int64_t nullen; int gesamt; };
static Verschiebung verschiebung(int n, bool zwei_laden) {
  auto au = Audio::sinus(400000, 440.0, 0.3f);
  auto bauen2 = [&](int wo /* 0 none, 1 track 1, 2 track 2 */) {
    Bau b(1);
    b.spur(1, ArrArt::audio).spur(2, ArrArt::audio);
    b.clip(1, "c1", 0.0, 8.0, &au->a);
    if (wo > 0) b.kette(wo, {host_stufe(0, 600)});
    cdj::ArrSnapshot* s = b.fertig();
    cdj::arr_pdc_rechnen(*s);
    return s;
  };
  TR(t)
  t.n = n;
  Synth sh;
  sh.anbinden(t);
  sh.n = n;
  setze(t, "ins/host/1/an", 1.0f);
  t.laden(bauen2(1));
  t.arr.start(0.0, 2, false, 0, V, n, t.k);
  t.lauf(100000 - 100000 % n);
  const int64_t wechsel = t.s;
  if (zwei_laden) {
    t.laden(bauen2(0));
    t.lauf(t.s + 60 * n + 1200);   // longer than latenz + 480
  }
  t.laden(bauen2(2));
  t.lauf(t.s + 60 * n);
  if (!zwei_laden) t.laden(bauen2(2));   // a later load claims the slot again for track 2 (the tail has ended): the entry
  t.lauf(wechsel + 60000);
  const std::vector<float>& v = t.pml;
  Verschiebung w{};
  w.plain = groesster_schritt(v, 92000, wechsel - 10) * 2.0;   // the stage returns 0.5 x: the sine's own step
  w.nach = groesster_schritt(v, wechsel - 5, wechsel + 59000);
  int64_t lauf_nullen = 0;
  for (int64_t i = wechsel; i < wechsel + 59000; ++i) {
    if (std::fabs(v[static_cast<size_t>(i)]) < 1e-9f) w.nullen = std::max(w.nullen, ++lauf_nullen);
    else lauf_nullen = 0;
  }
  w.gesamt = t.arr.snapshot()->pdc.gesamt;
  return w;
}

static void verschiebung_faelle() {
  for (const int n : {128, 256}) {
    for (const bool zwei : {true, false}) {
      const Verschiebung w = verschiebung(n, zwei);
      std::printf("6b: pdc_host_verschiebung n=%3d %s: plain step %.5f, after %.5f (x%.2f, limit x2), longest run of zeros %lld, gesamt %d\n", n, zwei ? "removal + later entry" : "one load (removal only)", w.plain, w.nach,
                  w.nach / w.plain, static_cast<long long>(w.nullen), w.gesamt);
      PRUEF(w.plain > 0.005);
      PRUEF(w.nach < 2.0 * w.plain);
      PRUEF(w.nullen <= 1);
      PRUEF(w.gesamt == 600);
    }
  }
}

// 4 through the mixer: the outer blend (row an) and the health fade fall in the same block
static void mixer_zugleich() {
  auto au = Audio::gleich(400000, 0.5f);
  auto fahre = [&](int modus /* 0 steady, 1 healthy + on, 2 dry */, bool zugleich) {
    TR(t)
    t.n = 256;
    Synth sh;
    sh.lat = 300;
    sh.gain = 0.4f;
    sh.gesund = modus != 2;
    sh.anbinden(t);
    setze(t, "ins/host/1/an", modus == 2 ? 0.0f : 1.0f);
    Bau b(1);
    b.spur(1, ArrArt::audio);
    b.clip(1, "c1", 0.0, 8.0, &au->a);
    b.kette(1, {host_stufe(0, 300)});
    cdj::ArrSnapshot* s = b.fertig();
    cdj::arr_pdc_rechnen(*s);
    t.laden(s);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(100000);
    if (zugleich) {
      setze(t, "ins/host/1/an", 0.0f);
      sh.gesund = false;   // the same block: the row and the health fall together
    }
    t.lauf(115000);
    return t.pml;
  };
  const std::vector<float> wet = fahre(1, false);   // return path, steady
  const std::vector<float> dry = fahre(2, false);   // dry path, steady
  const std::vector<float> beide = fahre(1, true);
  const float a = wet[99000], d = dry[99000];
  std::printf("4: host_an_und_gesund_zugleich (mixer): return path level %.5f, dry path level %.5f\n", static_cast<double>(a), static_cast<double>(d));
  PRUEF(std::fabs(a) < std::fabs(d) && std::fabs(a) > 0.01f);   // the two states are different signals
  const float lo = std::min(a, d) - 1e-5f, hi = std::max(a, d) + 1e-5f;
  float mn = 10.0f, mx = -10.0f;
  for (int64_t i = 100500; i < 114000; ++i) {
    mn = std::min(mn, beide[static_cast<size_t>(i)]);
    mx = std::max(mx, beide[static_cast<size_t>(i)]);
  }
  std::printf("4: both fall in one block: range [%.5f, %.5f], limits [%.5f, %.5f], end %.5f\n", static_cast<double>(mn), static_cast<double>(mx), static_cast<double>(lo), static_cast<double>(hi), static_cast<double>(beide[114000]));
  PRUEF(mn >= lo && mx <= hi);   // never below the quieter of the two (a gap), never above the louder
  PRUEF(std::fabs(beide[114000] - d) < 1e-5f);   // and it ends on the dry path
}

// 7 host_slot_nicht_lim: the host stage on pool slot 4 (global slot 19) next to the master limiter on the PM (global slot 15); the limiter is the same as in the project without the host stage
static void slot_nicht_lim() {
  auto au = Audio::sinus(400000, 220.0, 0.9f);
  auto fahre = [&](bool mit_host) {
    TR(t)
    t.n = 256;
    Synth sh;
    sh.h = 4;
    sh.anbinden(t);
    setze(t, "ins/lim/1/an", 1.0f);
    setze(t, "ins/lim/1/decke", -12.0f);   // the sine of 0.9 is limited hard: the limiter state is audible
    setze(t, "ins/host/4/an", 1.0f);
    Bau b(1);
    b.spur(1, ArrArt::audio);
    b.clip(1, "c1", 0.0, 8.0, &au->a);
    if (mit_host) b.kette(1, {host_stufe(3, 0)});   // latency 0: with the stage unhealthy it passes the signal through unchanged
    b.pm_kette({ArrStufe{ArrInsArt::lim, 0, true}});
    cdj::ArrSnapshot* s = b.fertig();
    cdj::arr_pdc_rechnen(*s);
    sh.gesund = false;   // the dry path: blending dry with dry is the identity
    t.laden(s);
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    t.lauf(125000);
    const int g_lim = cdj::ins_global(ArrInsArt::lim, 0), g_host = cdj::ins_global(ArrInsArt::host, 3);
    PRUEF(g_host == cdj::INS_G_HOST0 + 3 && g_lim == cdj::INS_G_LIM0 && cdj::ins_art(g_host) == ArrInsArt::host && cdj::ins_art(g_lim) == ArrInsArt::lim);
    PRUEF(t.arr.inserts().lief(g_lim));
    PRUEF(t.arr.inserts().lief(g_host) == mit_host);
    PRUEF(t.arr.inserts().latenz(g_host) == 0);
    struct R { std::vector<float> pm; float gr; };
    return R{t.pml, t.arr.inserts().gr_db(g_lim)};
  };
  const auto ohne = fahre(false);
  const auto mit = fahre(true);
  std::printf("7: host_slot_nicht_lim: limiter reduction %.3f dB without / %.3f dB with the host stage; PM bit-equal: %s\n", static_cast<double>(ohne.gr), static_cast<double>(mit.gr),
              std::memcmp(ohne.pm.data(), mit.pm.data(), sizeof(float) * ohne.pm.size()) == 0 ? "yes" : "no");
  PRUEF(ohne.gr > 1.0f);   // the limiter works (positive control)
  PRUEF(mit.gr == ohne.gr);
  PRUEF(ohne.pm.size() == mit.pm.size() && std::memcmp(ohne.pm.data(), mit.pm.data(), sizeof(float) * ohne.pm.size()) == 0);
}

// ---------------------------------------------------------------- 8 the loader
static void lader() {
  arrdatei::Ordner o("test_arr_host_stufe");
  const std::string a = o.audio('a', 48000);
  cdj::SpeicherKonto konto(100LL << 20);
  cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
  auto spur = [&](const std::string& chain) {
    return "{\"nr\":1,\"art\":\"audio\"" + chain + ",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, 48000) + "]}";
  };
  auto grund = [&](int64_t nr, const std::string& chain, bool host_da, std::string* meldung = nullptr) {
    o.wiedergabe2_ret(nr, spur(chain), "", "");
    cache.setze_host_da(host_da);
    cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
    if (meldung) *meldung = x.meldung;
    const std::string g = x.grund + (x.snap ? "+snap" : "");
    cdj::gib_wiedergabe(x.snap.release(), cache);
    return g;
  };
  auto stufe = [](int slot, const std::string& rest = "") { return "{\"art\":\"host\",\"slot\":" + std::to_string(slot) + rest + "}"; };
  {  // a host stage loads and carries its latency into the stage
    o.wiedergabe2_ret(80, spur(",\"chain\":[" + stufe(2, ",\"latenz\":600") + ",{\"art\":\"komp\",\"slot\":1}," + stufe(4, ",\"an\":false") + "]"), "", "");
    cache.setze_host_da(true);
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 80, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrKette& k = e.snap->kette[0];
      PRUEF(k.n == 3 && k.st[0].art == ArrInsArt::host && k.st[0].slot == 1 && k.st[0].latenz == 600 && k.st[0].an);
      PRUEF(k.st[1].art == ArrInsArt::komp && k.st[1].latenz == 0);   // the native kinds carry 0
      PRUEF(k.st[2].art == ArrInsArt::host && k.st[2].slot == 3 && k.st[2].latenz == 0 && !k.st[2].an);   // latenz defaults to 0
      PRUEF(e.snap->pdc.gesamt == 600);   // the stage counts in the compensation like a native one
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
  }
  PRUEF(grund(81, "", true) == "+snap");   // a project without a host stage loads with or without ports (neutral)
  PRUEF(grund(82, "", false) == "+snap");
  PRUEF(grund(83, ",\"chain\":[" + stufe(5) + "]", true) == "format");   // slot 5: outside the pool
  PRUEF(grund(84, ",\"chain\":[" + stufe(0) + "]", true) == "format");
  PRUEF(grund(85, ",\"chain\":[" + stufe(1) + "," + stufe(1) + "]", true) == "format");   // the same host twice
  PRUEF(grund(86, ",\"chain\":[" + stufe(4) + "," + stufe(1) + "]", true) == "+snap");     // the pool ends at 4
  {
    std::string m;
    grund(87, ",\"chain\":[" + stufe(5) + "]", true, &m);
    std::printf("8: slot 5: %s\n", m.c_str());
    PRUEF(m.find("ungueltig") != std::string::npos && m.find("slot") != std::string::npos);
  }
  {  // a core without the host ports (JACK refused): the playback with a host stage is refused, named host_fehlt; the same file with ports loads (negative control)
    std::string m;
    PRUEF(grund(88, ",\"chain\":[" + stufe(1, ",\"latenz\":600") + "]", false, &m) == "format");
    std::printf("8: no host ports: %s\n", m.c_str());
    PRUEF(m.find("host_fehlt") != std::string::npos);
    PRUEF(grund(89, ",\"chain\":[" + stufe(1, ",\"latenz\":600") + "]", true) == "+snap");
    // a host stage on a group, a return and the PM is refused the same way (the check is in the chain reader, not on tracks only)
    o.wiedergabe2_ret(90, spur(""), "{\"nr\":2,\"ausgang\":{\"art\":\"master\"},\"chain\":[" + stufe(2) + "]}", "");
    cache.setze_host_da(false);
    cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, 90, cache);
    PRUEF(!x.snap && x.grund == "format" && x.meldung.find("host_fehlt") != std::string::npos);
    cdj::gib_wiedergabe(x.snap.release(), cache);
  }
  {  // a fresh cache (as the offline render has it) refuses too: the default is "no host"
    cdj::ArrAudioCache frisch(&konto, 50LL << 20, false);
    PRUEF(!frisch.host_da());
    o.wiedergabe2_ret(91, spur(",\"chain\":[" + stufe(1) + "]"), "", "");
    cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, 91, frisch);
    PRUEF(!x.snap && x.meldung.find("host_fehlt") != std::string::npos);
    cdj::gib_wiedergabe(x.snap.release(), frisch);
  }
  {  // latency: 8192 is refused (pdc_zu_lang), 8191 loads; latenz on a native stage and a negative or fractional latenz are format
    std::string m;
    PRUEF(grund(92, ",\"chain\":[" + stufe(1, ",\"latenz\":8192") + "]", true, &m) == "zu_gross");
    std::printf("8: pdc_host_zu_lang: %s\n", m.c_str());
    PRUEF(m.find("pdc_zu_lang") != std::string::npos);
    PRUEF(grund(93, ",\"chain\":[" + stufe(1, ",\"latenz\":8191") + "]", true) == "+snap");
    {  // the chain adds up on the other tracks: 2 x 8191 on track 1 needs a delay of 16382 on track 2 -> refused; the same two stages with 4000 each need 8000 -> loads
      auto zwei = [&](int64_t nr, int lat) {
        const std::string chain = ",\"chain\":[" + stufe(1, ",\"latenz\":" + std::to_string(lat)) + "," + stufe(2, ",\"latenz\":" + std::to_string(lat)) + "]";
        o.wiedergabe2_ret(nr, spur(chain) + ",{\"nr\":2,\"art\":\"audio\",\"clips\":[" + o.clip("c2", 0.0, 1.0, a, 48000) + "]}", "", "");
        cache.setze_host_da(true);
        cdj::ArrLadeErgebnis x = cdj::lade_wiedergabe(o.pfad, nr, cache);
        const std::string g = x.grund + (x.snap ? "+snap" : "");
        cdj::gib_wiedergabe(x.snap.release(), cache);
        return g;
      };
      PRUEF(zwei(99, 8191) == "zu_gross");
      PRUEF(zwei(100, 4000) == "+snap");
    }
    PRUEF(grund(95, ",\"chain\":[{\"art\":\"komp\",\"slot\":1,\"latenz\":5}]", true) == "format");
    PRUEF(grund(96, ",\"chain\":[" + stufe(1, ",\"latenz\":-1") + "]", true) == "format");
    PRUEF(grund(97, ",\"chain\":[" + stufe(1, ",\"latenz\":600.5") + "]", true) == "format");
    PRUEF(grund(98, ",\"chain\":[" + stufe(1, ",\"latenz\":70000") + "]", true) == "format");
  }
}

// ---------------------------------------------------------------- 9 the allocation guard
static void allokation() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("9: allocation guard unavailable under this runtime: skipped, not passed\n");
    return;
  }
  auto au = Audio::sinus(900000, 330.0, 0.3f);
  auto bauen3 = [&](int latenz) {
    Bau b(1);
    b.spur(1, ArrArt::audio).spur(2, ArrArt::audio);
    b.ausgang(1, 1).ausgang(2, 1);
    b.clip(1, "c1", 0.0, 32.0, &au->a).clip(2, "c2", 0.0, 32.0, &au->a);
    b.kette(1, {host_stufe(0, latenz), host_stufe(1, 100)});
    b.pm_kette({host_stufe(3, 50)});
    cdj::ArrSnapshot* s = b.fertig();
    cdj::arr_pdc_rechnen(*s);
    return s;
  };
  TR(t)
  t.n = 256;
  Synth sh;
  sh.n = 256;
  sh.sl.reserve(1000000);   // the synthetic host and the block loop below must not allocate inside the window
  sh.sr.reserve(1000000);
  for (int h = 1; h <= 4; ++h) setze(t, "ins/host/" + std::to_string(h) + "/an", 1.0f);
  cdj::ArrSnapshot* s_a = bauen3(600);
  cdj::ArrSnapshot* s_b = bauen3(700);
  cdj::ArrSnapshot* s_c = bauen3(600);
  std::vector<const cdj::ArrSnapshot*> alt;
  alt.reserve(8);
  t.laden(s_a);
  t.arr.start(0.0, 2, false, 0, V, 256, t.k);
  float b[6][cdj::ARR_BLOCK];
  int64_t s = 0;
  auto block = [&]() {
    for (auto& x : b) std::fill(x, x + 256, 0.0f);
    sh.vor(t, s);
    t.arr.block(t.k, s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
    s += 256;
  };
  while (s < 100000) block();   // warm-up outside the window: the project runs from sample 90000
  abfang_an();
  for (int blk = 0; blk < 1500; ++blk) {
    if (blk == 500) alt.push_back(t.arr.tausche(s_b, s, t.k));   // the latency change: the crossfade path of ArrPdc and the new dry ring read position
    if (blk == 1000) alt.push_back(t.arr.tausche(s_c, s, t.k));
    block();
  }
  const long events = abfang_aus();
  std::printf("9: allocations in 1500 blocks with running host stages and two latency swaps = %ld\n", events);
  PRUEF(events == 0);
  PRUEF(t.arr.inserts().lief(cdj::ins_global(ArrInsArt::host, 0)) && t.arr.host_stufe().gewicht(1) > 0);   // the stages really ran (0 allocations of an idle run prove nothing)
  PRUEF(t.arr.inserts().latenz(cdj::ins_global(ArrInsArt::host, 0)) == 600);
  for (const cdj::ArrSnapshot* x : alt) delete x;
  abfang_an();
  { cdj::ArrInserts zweites; }
  const long bau_zaehlt = abfang_aus();
  std::printf("9: allocations while constructing a second pool = %ld\n", bau_zaehlt);
  PRUEF(bau_zaehlt > 0);   // positive control: the guard counts
}

int main() {
  direkt();
  mixer_zugleich();
  ausrichtung();
  latenzwechsel_faelle();
  verschiebung_faelle();
  slot_nicht_lim();
  lader();
  allokation();
  PRUEF_ENDE();
}
