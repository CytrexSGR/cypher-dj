// 1.8 Slice 3 (R10, D11, D14; AK15, AK16 monitor part): the monitor of the external inputs in the Arrangement. A constant input (L 0.25, R 0.5) is handed to a track
// before every block(); the track holds a SILENT clip over beats 0..8, so whatever is audible comes from the monitor. Rule: ein always; auto when a take records or no clip
// of the track plays back; aus never. The input goes in before the fader (fader, pan, mute take effect). Mutation CYPHERDJ_MUTATION_MONITOR_AUTO_IST_EIN: auto = ein.
// 1.8 T1 (slice 3b-lite): the monitor is added AFTER the insert chain and the PDC delay of its track (dry, no latency of the chain and no alignment to the longest
// path), still before the fader. Cases 8 to 10 feed an impulse at a known sample and require the first audible sample at exactly that index, at n = 256 and 64, with the
// chain on another track and on the monitored track, bit-equal to the run without any insert. Mutations: CYPHERDJ_MUTATION_MONITOR_VOR_KETTE (old position, before the
// chain: 8 and 9 red), CYPHERDJ_MUTATION_MONITOR_NACH_FADER (after the fader, gain and mute ignored: 10 red).
#include <cmath>
#include <cstring>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static const double MITTE = 0.70710677;

// Everything audible on the output (aus_l/aus_r) since the last call is in t.l/t.r; this runs blocks with the monitor source set before each one.
struct Lauf {
  Treiber& t;
  std::vector<float> in_l, in_r;
  explicit Lauf(Treiber& tt, float l = 0.25f, float r = 0.5f) : t(tt), in_l(cdj::ARR_BLOCK, l), in_r(cdj::ARR_BLOCK, r) {}
  // bis: Kern-Sample to run to; spur0 < 0: no source at all (the feed is not called)
  void bis(int64_t ziel, int spur0, int modus, int monitor, bool rec, bool nur_l = false, bool nur_r = false) {
    float b[6][cdj::ARR_BLOCK];
    while (t.s < ziel) {
      for (auto& x : b) std::fill(x, x + t.n, 0.0f);
      if (spur0 >= 0) t.arr.monitor_quelle(spur0, nur_r ? nullptr : in_l.data(), nur_l ? nullptr : in_r.data(), modus, monitor, rec);
      t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
      t.l.insert(t.l.end(), b[0], b[0] + t.n);
      t.r.insert(t.r.end(), b[1], b[1] + t.n);
      t.s += t.n;
    }
  }
  // peak of |l| and |r| over the samples [von, bis) of the output
  float spitze(bool links, int64_t von, int64_t bis) const {
    float m = 0.0f;
    const std::vector<float>& v = links ? t.l : t.r;
    for (int64_t i = von; i < bis && i < static_cast<int64_t>(v.size()); ++i) m = std::max(m, std::fabs(v[i]));
    return m;
  }
};

// Track 1, silent clip over beats 0..8; the transport is NOT started (stopped) unless 'start'. Playing: the start at beat 0 with quant 2 begins at sample 90 000.
static void aufbau(Treiber& t, const cdj::ArrAudio* a, bool start) {
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  t.laden(b.fertig());
  if (start) t.arr.start(0.0, 2, false, 0, V, 256, t.k);
}

// 1.8 T1: runs the project with blocks of t.n samples to `bis`; the monitor source of track 1 (ein, stereo) is zero except for ONE sample of amplitude 1.0 at the kernel sample `pos`.
static void impuls_lauf(Treiber& t, int64_t bis, int64_t pos) {
  float b[6][cdj::ARR_BLOCK];
  std::vector<float> in(cdj::ARR_BLOCK, 0.0f);
  while (t.s < bis) {
    for (auto& x : b) std::fill(x, x + t.n, 0.0f);
    std::fill(in.begin(), in.end(), 0.0f);
    if (pos >= t.s && pos < t.s + t.n) in[static_cast<size_t>(pos - t.s)] = 1.0f;
    t.arr.monitor_quelle(0, in.data(), in.data(), 0, 2, false);
    t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
    t.l.insert(t.l.end(), b[0], b[0] + t.n);
    t.r.insert(t.r.end(), b[1], b[1] + t.n);
    t.s += t.n;
  }
}
// index of the first non-zero sample of both channels, -1 = none
static int64_t erster(const Treiber& t) {
  for (size_t i = 0; i < t.l.size(); ++i)
    if (t.l[i] != 0.0f || t.r[i] != 0.0f) return static_cast<int64_t>(i);
  return -1;
}
// transport stopped, silent clips on tracks 1 and 2 (the output is the monitor and nothing else), `kette_spur` 0: no chain, else the track that holds an eq and a saett (69 + 69 samples)
static void aufbau_kette(Treiber& t, const cdj::ArrAudio* a, int kette_spur, int n) {
  static const cdj::ArrStufe EQ{cdj::ArrInsArt::eq, 0, true}, SA{cdj::ArrInsArt::saett, 0, true};
  Bau b;
  b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 8.0, a);
  b.spur(2, ArrArt::audio).clip(2, "c2", 0.0, 8.0, a);
  if (kette_spur) b.kette(kette_spur, {EQ, SA});
  t.n = n;
  t.laden(b.fertig());
}

int main() {
  auto stille = Audio::gleich(400000, 0.0f);   // the clip is silent: the output holds the monitor and nothing else
  const double EIN_L = 0.25 * MITTE, EIN_R = 0.5 * MITTE;   // stereo, pan centre (-3 dB each side), fader 0 dB
  {  // 1: transport stopped, auto: the input is audible, L and R each (stereo mode)
    auto tp = std::make_unique<Treiber>();   // heap: seven stack Treibers overflow the 8 MiB stack under ASan (no slot reuse)
    Treiber& t = *tp;
    aufbau(t, &stille->a, false);
    Lauf x(t);
    x.bis(8192, 0, 0, 1, false);
    PRUEF(t.arr.status() == cdj::ArrStatus::steht);
    PRUEF_NAH(x.spitze(true, 4096, 8192), EIN_L, 1e-5);
    PRUEF_NAH(x.spitze(false, 4096, 8192), EIN_R, 1e-5);
    PRUEF(t.arr.spitze_lesen(0) > 0.1f);   // the peak of the track (after the fader) sees it
    PRUEF(t.arr.spitze_lesen(1) == 0.0f);  // the neighbour track 2 stays silent (negative control)
  }
  {  // 2: the transport plays inside the clip: auto is silent, ein audible, aus silent, auto with a take recording audible (AK15)
    auto tp = std::make_unique<Treiber>();   // heap: seven stack Treibers overflow the 8 MiB stack under ASan (no slot reuse)
    Treiber& t = *tp;
    aufbau(t, &stille->a, true);
    Lauf x(t);
    x.bis(100000, -1, 0, 1, false);   // run up to the start (90 000) and 10 000 samples into the clip, without a source
    PRUEF(t.arr.status() == cdj::ArrStatus::spielt);
    const int64_t a0 = t.s;
    x.bis(a0 + 8192, 0, 0, 1, false);   // auto, no take
    PRUEF(x.spitze(true, a0, a0 + 8192) < 1e-6f && x.spitze(false, a0, a0 + 8192) < 1e-6f);
    const int64_t e0 = t.s;
    x.bis(e0 + 8192, 0, 0, 2, false);   // ein
    PRUEF_NAH(x.spitze(true, e0 + 4096, e0 + 8192), EIN_L, 1e-5);
    const int64_t o0 = t.s;
    x.bis(o0 + 8192, 0, 0, 0, true);    // aus, even while recording
    PRUEF(x.spitze(true, o0, o0 + 8192) < 1e-6f && x.spitze(false, o0, o0 + 8192) < 1e-6f);
    const int64_t r0 = t.s;
    x.bis(r0 + 8192, 0, 0, 1, true);    // auto while a take records
    PRUEF_NAH(x.spitze(true, r0 + 4096, r0 + 8192), EIN_L, 1e-5);
    PRUEF(t.arr.status() == cdj::ArrStatus::spielt);   // all of it happened inside the clip (beats 0..8 reach sample 90 000 + 8 * 22 500)
  }
  {  // 3: auto outside the clip while the transport plays (clip ends at beat 8, the project goes on): audible again
    auto tp = std::make_unique<Treiber>();   // heap: seven stack Treibers overflow the 8 MiB stack under ASan (no slot reuse)
    Treiber& t = *tp;
    Bau b;
    b.spur(1, ArrArt::audio).clip(1, "c1", 0.0, 1.0, &stille->a);   // one beat only
    t.laden(b.fertig());
    t.arr.start(0.0, 2, false, 0, V, 256, t.k);
    Lauf x(t);
    x.bis(90000 + 10000, -1, 0, 1, false);   // 10 000 samples into beat 0: inside the clip
    const int64_t i0 = t.s;
    x.bis(i0 + 4096, 0, 0, 1, false);
    PRUEF(x.spitze(true, i0, i0 + 4096) < 1e-6f);   // inside: silent
    const int64_t a0 = 90000 + 3 * 22500;           // beat 3: far behind the clip
    x.bis(a0, -1, 0, 1, false);
    const int64_t a1 = t.s;
    x.bis(a1 + 4096, 0, 0, 1, false);
    PRUEF_NAH(x.spitze(true, a1 + 1024, a1 + 4096), EIN_L, 1e-5);   // behind the clip: the track does not sound, the input does
  }
  {  // 4: fader, mute, pan take effect (AK16 monitor part)
    auto tp = std::make_unique<Treiber>();   // heap: seven stack Treibers overflow the 8 MiB stack under ASan (no slot reuse)
    Treiber& t = *tp;
    aufbau(t, &stille->a, false);
    Lauf x(t);
    t.arr.setze_sofort(t.tab.suche("spur/1/fader"), -200.0f);
    x.bis(4096, 0, 0, 2, false);
    PRUEF(x.spitze(true, 1024, 4096) == 0.0f && x.spitze(false, 1024, 4096) == 0.0f);   // fader -200: silent
    PRUEF(t.arr.spitze_lesen(0) == 0.0f);                                              // also at the track peak
    t.arr.setze_sofort(t.tab.suche("spur/1/fader"), 0.0f);
    x.bis(8192, 0, 0, 2, false);
    PRUEF_NAH(x.spitze(true, 7168, 8192), EIN_L, 1e-5);   // fader back to 0 dB: audible again (the check above could see a difference)
    t.arr.setze_sofort(t.tab.suche("spur/1/mute"), 1.0f);
    x.bis(8192 + 4096, 0, 0, 2, false);                   // the mute fades over 480 samples
    PRUEF(x.spitze(true, 8192 + 1024, 8192 + 4096) == 0.0f);
    t.arr.setze_sofort(t.tab.suche("spur/1/mute"), 0.0f);
    t.arr.setze_sofort(t.tab.suche("spur/1/pan"), -1.0f);   // full left: R is zero, L full
    x.bis(8192 + 4096 + 4096, 0, 0, 2, false);
    const int64_t p0 = t.s - 2048;
    PRUEF(x.spitze(false, p0, t.s) < 1e-6f);
    PRUEF_NAH(x.spitze(true, p0, t.s), 0.25, 1e-5);
  }
  {  // 5: channel modes (D14): stereo, links, rechts, summe; a missing channel counts as silence
    struct Fall { int modus; bool nur_l, nur_r; double erwartet_l, erwartet_r; };
    const Fall f[] = {{0, false, false, 0.25, 0.5}, {1, false, false, 0.25, 0.25}, {2, false, false, 0.5, 0.5}, {3, false, false, 0.375, 0.375},
                      {0, true, false, 0.25, 0.0},  {0, false, true, 0.0, 0.5},   {3, true, false, 0.125, 0.125}};
    for (const Fall& c : f) {
      auto tp = std::make_unique<Treiber>();   // heap: seven stack Treibers overflow the 8 MiB stack under ASan (no slot reuse)
      Treiber& t = *tp;
      aufbau(t, &stille->a, false);
      Lauf x(t);
      t.arr.setze_sofort(t.tab.suche("spur/1/pan"), 0.0f);
      x.bis(4096, 0, c.modus, 2, false, c.nur_l, c.nur_r);
      // pan centre costs -3 dB each side
      PRUEF_NAH(x.spitze(true, 1024, 4096), c.erwartet_l * MITTE, 1e-5);
      PRUEF_NAH(x.spitze(false, 1024, 4096), c.erwartet_r * MITTE, 1e-5);
    }
  }
  {  // 6: valid for one block only: without a call before the block nothing is added (negative control: the feed itself works)
    auto tp = std::make_unique<Treiber>();   // heap: seven stack Treibers overflow the 8 MiB stack under ASan (no slot reuse)
    Treiber& t = *tp;
    aufbau(t, &stille->a, false);
    Lauf x(t);
    x.bis(4096, 0, 0, 2, false);
    PRUEF(x.spitze(true, 1024, 4096) > 0.1f);   // the feed works
    const int64_t s1 = t.s;
    x.bis(s1 + 4096, -1, 0, 2, false);          // no feed
    PRUEF(x.spitze(true, s1, s1 + 4096) == 0.0f && x.spitze(false, s1, s1 + 4096) == 0.0f);
    // no port at all (both nullptr) adds nothing either
    const int64_t s2 = t.s;
    float b[6][cdj::ARR_BLOCK];
    for (int i = 0; i < 4; ++i) {
      for (auto& v : b) std::fill(v, v + t.n, 0.0f);
      t.arr.monitor_quelle(0, nullptr, nullptr, 0, 2, false);
      t.arr.block(t.k, t.s, t.n, b[0], b[1], b[2], b[3], b[4], b[5]);
      for (int j = 0; j < t.n; ++j) PRUEF(b[0][j] == 0.0f && b[1][j] == 0.0f);
      t.s += t.n;
    }
    (void)s2;
  }
  {  // 7: without a snapshot the quiet path stays: nothing is added, and the call does no harm
    auto tp = std::make_unique<Treiber>();   // heap: seven stack Treibers overflow the 8 MiB stack under ASan (no slot reuse)
    Treiber& t = *tp;
    Lauf x(t);
    x.bis(4096, 0, 0, 2, false);
    PRUEF(x.spitze(true, 0, 4096) == 0.0f);
    PRUEF(t.arr.snapshot() == nullptr);
  }
  {  // 8 (1.8 T1): the chain sits on ANOTHER track, so track 1 is aligned by the PDC; the monitor must not wait for it: the first audible sample is the impulse itself
    for (int n : {256, 64}) {
      const int64_t pos = 3 * 256 + 37;   // index 37 of a block at n = 256 and at n = 64
      auto rp = std::make_unique<Treiber>();
      Treiber& ref = *rp;
      aufbau_kette(ref, &stille->a, 0, n);
      impuls_lauf(ref, 4096, pos);
      auto tp = std::make_unique<Treiber>();
      Treiber& t = *tp;
      aufbau_kette(t, &stille->a, 2, n);
      PRUEF(t.arr.pdc_latenz() > 0);   // positive control: the project has a delay compensation at all
      impuls_lauf(t, 4096, pos);
      PRUEF(erster(ref) == pos);
      PRUEF(erster(t) == pos);
      PRUEF(t.l.size() == ref.l.size() && std::memcmp(t.l.data(), ref.l.data(), t.l.size() * sizeof(float)) == 0);
      PRUEF(t.r.size() == ref.r.size() && std::memcmp(t.r.data(), ref.r.data(), t.r.size() * sizeof(float)) == 0);
    }
  }
  {  // 9 (1.8 T1): the chain sits on the MONITORED track: the monitor leaves the chain (no latency of eq + saett), the run is bit-equal to the one without inserts
    for (int n : {256, 64}) {
      const int64_t pos = 5 * 256 + 101;
      auto rp = std::make_unique<Treiber>();
      Treiber& ref = *rp;
      aufbau_kette(ref, &stille->a, 0, n);
      impuls_lauf(ref, 4096, pos);
      auto tp = std::make_unique<Treiber>();
      Treiber& t = *tp;
      aufbau_kette(t, &stille->a, 1, n);
      impuls_lauf(t, 4096, pos);
      PRUEF(erster(ref) == pos);
      PRUEF(erster(t) == pos);
      PRUEF(t.l.size() == ref.l.size() && std::memcmp(t.l.data(), ref.l.data(), t.l.size() * sizeof(float)) == 0);
      PRUEF(t.r.size() == ref.r.size() && std::memcmp(t.r.data(), ref.r.data(), t.r.size() * sizeof(float)) == 0);
    }
  }
  {  // 10 (1.8 T1): with a chain on another track the fader, pan and mute still act on the dry monitor (AK16): fader -6 dB halves it, mute silences it
    auto tp = std::make_unique<Treiber>();
    Treiber& t = *tp;
    aufbau_kette(t, &stille->a, 2, 256);
    Lauf x(t);
    t.arr.setze_sofort(t.tab.suche("spur/1/fader"), -6.0206f);
    x.bis(4096, 0, 0, 2, false);
    PRUEF_NAH(x.spitze(true, 2048, 4096), EIN_L * 0.5, 1e-4);
    PRUEF_NAH(x.spitze(false, 2048, 4096), EIN_R * 0.5, 1e-4);
    t.arr.setze_sofort(t.tab.suche("spur/1/mute"), 1.0f);
    x.bis(4096 + 4096, 0, 0, 2, false);   // the mute fades over 480 samples
    PRUEF(x.spitze(true, 4096 + 1024, 4096 + 4096) == 0.0f && x.spitze(false, 4096 + 1024, 4096 + 4096) == 0.0f);
  }
  PRUEF_ENDE();
}
