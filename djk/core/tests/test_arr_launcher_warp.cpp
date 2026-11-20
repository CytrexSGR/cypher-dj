// Loop deck K3: keylock voices of the launcher (loop cells through the warp works). Synchronous werk (Treiber::mit_werk(0)), 128 BPM (22 500 samples
// per beat), blocks of 256. The cells are 125 BPM sources (23 040 frames per beat) with a Hann click on every beat, measured as in test_warp_factory_arr.cpp
// (cross-correlation with the click, tolerance 24 samples, plan decision D6). The track bus (spur_bus_l) is recorded per block.
//   1  on time: a launch commanded far ahead (more than ARR_WARP_FRIST): warp_spaet unchanged, the onset lies on T
//   2  late: commanded 288 samples before T: warp_spaet +1, sound from T on (re-pitch cover until the ring fills), no silent block, no underrun
//   3  pass wrap: a 1-beat cell over 8 passes: every click on its beat, no underrun, no late start
//   4  tempo change 128 -> 140 mid pass: the clicks follow the new grid from s0 + ARR_WARP_FRIST + ARR_NAHT on (after the ramp), no underrun
//   5  werk pressure: 64 clip voices fill the pool: the launcher voice plays as re-pitch (warp_kein_platz counted); 63: it gets a slot (not counted)
//   6  transport stop and start while the keylock loop plays: the track bus is bit-identical to a run without them
//   7  no werk: the re-pitch path of K2 (onset on T, loop wrap)
//   8  seam level: a 220 Hz sine whose period divides the loop, 5 passes at a tempo other than the cell's: no 10 ms window across a seam more than 1 dB below
//      the steady level, no click (largest step <= 120 % of the tone's own)
//   9  pool exhausted (no pass slot): the pass plays as re-pitch, sound and no step above the bound at the keylock -> re-pitch and re-pitch -> keylock joins
//  10  133.33 BPM, 16 one-beat passes: consecutive passes butt-join exactly (no gap, no overlap)
//  11  threaded werk (2 threads), a tempo change every few blocks: the launcher never touches a pass the werk thread may still read (the TSan target)
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <chrono>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "arr_build.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrZelle;
using cdj::ArrZellArt;
using cdj::LaunchGrund;

#if defined(CYPHERDJ_BUNGEE)

namespace {

constexpr int64_t FPB125 = 23040;
constexpr int HANN = 144;
constexpr double LAGE_GRENZE = 24.0;
const uint64_t ID = cdj::arr_id("s1");

std::vector<float> hann_impuls() {
  std::vector<float> h(HANN);
  for (int i = 0; i < HANN; ++i)
    h[static_cast<size_t>(i)] = static_cast<float>(0.5 * std::sin(2 * 3.14159265358979323846 * 1000.0 * i / 48000.0) * 0.5 * (1 - std::cos(2 * 3.14159265358979323846 * i / 143.0)));
  return h;
}

// A source with a Hann click at the start of every beat of the 125 BPM source
std::unique_ptr<Audio> hann_klicks(int64_t frames) {
  auto x = Audio::gleich(frames, 0.0f);
  const std::vector<float> h = hann_impuls();
  for (int64_t k = 0; k * FPB125 + HANN < frames; ++k)
    for (int i = 0; i < HANN; ++i) x->d[static_cast<size_t>(2 * (k * FPB125 + i))] = x->d[static_cast<size_t>(2 * (k * FPB125 + i) + 1)] = h[static_cast<size_t>(i)];
  x->fuellen(frames);
  return x;
}

// Centre of the click near e (cross-correlation, parabolic), -1e9 without a click
double klick_mitte(const std::vector<float>& l, int64_t e, int radius = 300) {
  static const std::vector<float> h = hann_impuls();
  double beste = -1e30;
  int64_t bt = 0;
  std::vector<double> c;
  const int64_t t0 = e - 72 - radius;
  for (int64_t t = t0; t <= e - 72 + radius; ++t) {
    double s = 0.0;
    for (int i = 0; i < HANN; ++i) {
      const int64_t j = t + i;
      if (j >= 0 && j < static_cast<int64_t>(l.size())) s += static_cast<double>(h[static_cast<size_t>(i)]) * static_cast<double>(l[static_cast<size_t>(j)]);
    }
    c.push_back(s);
    if (s > beste) {
      beste = s;
      bt = t;
    }
  }
  if (beste < 0.02) return -1e9;
  const size_t ix = static_cast<size_t>(bt - t0);
  const double davor = ix > 0 ? c[ix - 1] : beste;
  const double danach = ix + 1 < c.size() ? c[ix + 1] : beste;
  const double nenner = davor - 2.0 * beste + danach;
  const double dx = nenner != 0.0 ? 0.5 * (davor - danach) / nenner : 0.0;
  return static_cast<double>(bt) + dx + 71.5;
}

// The click of beat `beat` (core beat) of the loop: distance to the grid of the map k, 1e9 when there is none
double klick_abstand(const std::vector<float>& l, const cdj::Karte& k, double beat) {
  const double soll = k.sample_at(beat + 71.5 / static_cast<double>(FPB125));
  const double m = klick_mitte(l, std::llround(soll));
  return m < -1e8 ? 1e9 : m - soll;
}

ArrZelle zelle(Audio& a, double beats) {
  ArrZelle z;
  z.art = ArrZellArt::loop;
  z.audio = &a.a;
  z.frames = a.a.frames;
  z.beats = beats;
  z.gain = 1.0f;
  z.modus = 2;
  return z;
}

// A snapshot with the deck track on track 1 (id "s1") and the cells; more tracks with clips for the pressure case
cdj::ArrSnapshot* bauen(const std::vector<ArrZelle>& zs, Bau* b = nullptr) {
  Bau lokal;
  Bau& bb = b ? *b : lokal;
  bb.spur(1, ArrArt::audio);
  cdj::ArrSnapshot* s = bb.fertig();
  cdj::ArrSpur& sp = s->spur[0];
  sp.kennung = ID;
  std::snprintf(sp.kennung_text, sizeof sp.kennung_text, "s1");
  for (size_t i = 0; i < zs.size(); ++i) {
    sp.zellen[i] = zs[i];
    ++sp.n_zellen;
  }
  return s;
}

int g_faelle = 0;   // cases executed (printed at the end: a skipped build must not look like a pass)

struct Lauf {
  Treiber t;
  std::vector<float> bus;
  bool werk;
  explicit Lauf(bool mit = true, int faeden = 0) : werk(mit) {
    if (mit) PRUEF(t.mit_werk(faeden));
  }
  void bis(int64_t ziel) {
    while (t.s < ziel) {
      t.lauf(t.s + t.n);
      bus.insert(bus.end(), t.arr.spur_bus_l(0), t.arr.spur_bus_l(0) + t.n);
    }
  }
  float at(int64_t i) const { return bus[static_cast<size_t>(i)]; }
};

void fall1() {
  ++g_faelle;   // on time
  auto src = hann_klicks(FPB125 * 4);
  Lauf x;
  x.t.laden(bauen({zelle(*src, 4.0)}));
  const uint64_t spaet0 = x.t.arr.warp_spaet();
  PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(14 * SPB);
  const double d = klick_abstand(x.bus, x.t.k, 8.0);
  std::printf("Fall 1: onset %.2f samples from the grid, spaet +%llu, unterlauf %llu\n", d, static_cast<unsigned long long>(x.t.arr.warp_spaet() - spaet0),
              static_cast<unsigned long long>(x.t.arr.warp_unterlauf()));
  PRUEF(std::fabs(d) <= LAGE_GRENZE);
  PRUEF(x.t.arr.warp_spaet() == spaet0 && x.t.arr.warp_unterlauf() == 0 && x.t.arr.warp_kein_platz() == 0);
  for (int64_t i = 0; i < 8 * SPB - 100; ++i) PRUEF(std::fabs(x.at(i)) < 1e-6f);   // silent before T
}

void fall2() {
  ++g_faelle;   // late: 288 samples before T
  auto src = Audio::gleich(FPB125 * 4, 0.5f);
  Lauf x;
  x.t.laden(bauen({zelle(*src, 4.0)}));
  const int64_t T = 8 * SPB;
  x.bis(T - 500);   // the block grid ends at 179 712, 288 samples before T
  const int64_t s_cmd = x.t.s;
  PRUEF(T - s_cmd > 0 && T - s_cmd < cdj::ARR_WARP_FRIST);
  const uint64_t spaet0 = x.t.arr.warp_spaet();
  PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(T + 20000);
  int64_t erster = -1, loch = 0;
  for (int64_t i = 0; i < static_cast<int64_t>(x.bus.size()) && erster < 0; ++i)
    if (std::fabs(x.at(i)) > 1e-6f) erster = i;
  for (int64_t i = T + 1; i < T + 12000; ++i) loch += x.at(i) < 0.15f ? 1 : 0;   // cover (re-pitch) first, then the ring: never silent
  std::printf("Fall 2: first sound at %lld (T %lld), silent samples in [T, T + 12000): %lld, spaet +%llu, unterlauf %llu\n", static_cast<long long>(erster), static_cast<long long>(T),
              static_cast<long long>(loch), static_cast<unsigned long long>(x.t.arr.warp_spaet() - spaet0), static_cast<unsigned long long>(x.t.arr.warp_unterlauf()));
  PRUEF(erster == T);
  PRUEF(loch == 0);
  PRUEF(x.t.arr.warp_spaet() == spaet0 + 1);
  PRUEF(x.t.arr.warp_unterlauf() == 0);
  PRUEF_NAH(x.at(T + 10000), 0.5, 0.05);   // the ring has taken over: constant source stays constant
}

void fall3() {
  ++g_faelle;   // pass wrap: 8 passes of a 1-beat cell
  auto src = hann_klicks(FPB125);
  Lauf x;
  x.t.laden(bauen({zelle(*src, 1.0)}));
  PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(14 * SPB);
  double schlimmste = 0.0;
  int ohne = 0;
  for (int p = 0; p < 8; ++p) {
    const double d = klick_abstand(x.bus, x.t.k, 4.0 + p);
    if (d > 1e8) ++ohne;
    else schlimmste = std::max(schlimmste, std::fabs(d));
  }
  std::printf("Fall 3: 8 passes, %d without a click, worst %.2f samples, spaet %llu, unterlauf %llu\n", ohne, schlimmste, static_cast<unsigned long long>(x.t.arr.warp_spaet()),
              static_cast<unsigned long long>(x.t.arr.warp_unterlauf()));
  PRUEF(ohne == 0 && schlimmste <= LAGE_GRENZE);
  PRUEF(x.t.arr.warp_unterlauf() == 0 && x.t.arr.warp_spaet() == 0 && x.t.arr.warp_kein_platz() == 0);
}

void fall4() {
  ++g_faelle;   // tempo change 128 -> 140 in the middle of a pass
  auto src = hann_klicks(FPB125);
  Lauf x;
  x.t.laden(bauen({zelle(*src, 1.0)}));
  PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(static_cast<int64_t>(x.t.k.sample_at(6.3)));
  const int64_t s0 = x.t.s;
  PRUEF(x.t.k.rampe(6.5, 140.0, 1.0));   // from beat 6.5 over 1 beat to 140, then 140
  ++x.t.gen;
  x.bis(static_cast<int64_t>(x.t.k.sample_at(18.0)));
  double vor = 0.0, nach = 0.0;
  int ohne = 0;
  for (int p = 4; p <= 6; ++p) vor = std::max(vor, std::fabs(klick_abstand(x.bus, x.t.k, static_cast<double>(p))));
  for (int p = 9; p <= 16; ++p) {   // after the ramp end (beat 7.5) plus the lead
    const double d = klick_abstand(x.bus, x.t.k, static_cast<double>(p));
    if (d > 1e8) ++ohne;
    else nach = std::max(nach, std::fabs(d));
  }
  std::printf("Fall 4: tempo change at %lld, clicks before %.2f, after the ramp %.2f samples (%d without), spaet %llu, unterlauf %llu, kein_platz %llu\n", static_cast<long long>(s0),
              vor, nach, ohne, static_cast<unsigned long long>(x.t.arr.warp_spaet()), static_cast<unsigned long long>(x.t.arr.warp_unterlauf()),
              static_cast<unsigned long long>(x.t.arr.warp_kein_platz()));
  PRUEF(vor <= LAGE_GRENZE);
  PRUEF(ohne == 0 && nach <= LAGE_GRENZE);
  PRUEF(x.t.arr.warp_unterlauf() == 0 && x.t.arr.warp_kein_platz() == 0);
}

// 64 (or 63) clip voices of zero audio fill the werk pool; the launcher then asks for a slot
void fall5_druck(int n_clips, bool platz_erwartet) {
  ++g_faelle;
  auto leer = Audio::gleich(FPB125 * 70, 0.0f);
  auto src = Audio::gleich(FPB125 * 4, 0.5f);
  Lauf x;
  Bau b;
  int n = 0;
  for (int sp = 1; sp <= 32; ++sp) {
    b.spur(sp, ArrArt::audio);
    for (int c = 0; c < 2 && n < n_clips; ++c, ++n) {
      b.clip(sp, ("c" + std::to_string(sp) + "_" + std::to_string(c)).c_str(), 0.0, 64.0, &leer->a);
      b.warp({0.0, 64.0}, {0.0, 64.0 * static_cast<double>(FPB125)}, cdj::ARR_WARP_COMPLEX);
    }
  }
  x.t.laden(bauen({zelle(*src, 4.0)}, &b));
  x.t.arr.start(0.0, 0, false, x.t.s, 537, 256, x.t.k);
  x.bis(6 * SPB);
  PRUEF(x.t.arr.werk_stimmen() == n_clips);
  const uint64_t kp0 = x.t.arr.warp_kein_platz();
  PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(8 * SPB + 6000);
  int loch = 0;
  for (int64_t i = 8 * SPB + 3000; i < 8 * SPB + 5000; ++i) loch += x.at(i) < 0.3f ? 1 : 0;
  const uint64_t kp = x.t.arr.warp_kein_platz() - kp0;
  std::printf("Fall 5 (%d clip voices): launcher sound present (silent samples %d), kein_platz +%llu\n", n_clips, loch, static_cast<unsigned long long>(kp));
  PRUEF(loch == 0);
  PRUEF(platz_erwartet ? kp == 0 : kp == 1);
}

void fall6() {
  ++g_faelle;   // transport stop and start while the loop plays
  auto src = hann_klicks(FPB125);
  std::vector<float> ref;
  for (int variante = 0; variante < 2; ++variante) {
    Lauf x;
    x.t.laden(bauen({zelle(*src, 1.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(6 * SPB);
    if (variante) {
      x.t.arr.start(0.0, 0, false, x.t.s, 537, 256, x.t.k);
      x.bis(8 * SPB);
      x.t.arr.stopp(0, x.t.s, x.t.k);
      x.bis(9 * SPB);
      x.t.arr.start(0.0, 0, false, x.t.s, 537, 256, x.t.k);
    }
    x.bis(14 * SPB);
    if (!variante) {
      ref = x.bus;
    } else {
      PRUEF(x.bus.size() == ref.size());
      size_t ungleich = 0;
      for (size_t i = 0; i < ref.size() && i < x.bus.size(); ++i) ungleich += std::memcmp(&ref[i], &x.bus[i], sizeof(float)) != 0 ? 1 : 0;
      double worst = 0.0;
      for (int p = 4; p < 13; ++p) worst = std::max(worst, std::fabs(klick_abstand(x.bus, x.t.k, static_cast<double>(p))));
      std::printf("Fall 6: %zu samples differ from the run without transport events, worst click %.2f\n", ungleich, worst);
      PRUEF(ungleich == 0);
      PRUEF(worst <= LAGE_GRENZE);
      PRUEF(x.t.arr.warp_unterlauf() == 0);
    }
  }
}

void fall7() {
  ++g_faelle;   // no werk: the K2 re-pitch path
  auto imp = Audio::impuls(4 * SPB);
  auto ram = Audio::rampe(4 * SPB);
  {
    Lauf x(false);
    x.t.laden(bauen({zelle(*imp, 4.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(3 * 4 * SPB);
    int64_t erster = -1;
    for (int64_t i = 0; i < static_cast<int64_t>(x.bus.size()) && erster < 0; ++i)
      if (std::fabs(x.at(i)) > 1e-6f) erster = i;
    PRUEF(erster == 4 * SPB);
  }
  {
    Lauf x(false);
    x.t.laden(bauen({zelle(*ram, 4.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(10 * SPB);
    PRUEF_NAH(x.at(8 * SPB - 1), 4 * SPB - 1, 1e-2);
    PRUEF_NAH(x.at(8 * SPB), 0.0, 1e-4);
    PRUEF_NAH(x.at(8 * SPB + 1), 1.0, 1e-3);
  }
}

double rms(const std::vector<float>& l, int64_t a, int64_t n) {
  double q = 0.0;
  for (int64_t i = a; i < a + n; ++i) q += static_cast<double>(l[static_cast<size_t>(i)]) * static_cast<double>(l[static_cast<size_t>(i)]);
  return std::sqrt(q / static_cast<double>(n));
}
double groesster_schritt(const std::vector<float>& l, int64_t a, int64_t b) {
  double m = 0.0;
  for (int64_t i = a; i + 1 < b; ++i) m = std::max(m, std::fabs(static_cast<double>(l[static_cast<size_t>(i + 1)]) - static_cast<double>(l[static_cast<size_t>(i)])));
  return m;
}
constexpr double PI = 3.14159265358979323846;
constexpr double SINUS_HZ = 220.0;
constexpr float SINUS_AMP = 0.5f;
constexpr int64_t SINUS_FRAMES = 48000;   // 220 Hz: 220 whole periods in one second of 48 kHz

void fall8_naht() {   // seam level
  ++g_faelle;
  auto src = Audio::sinus(SINUS_FRAMES, SINUS_HZ, SINUS_AMP);   // 220 whole periods in 2 beats of the cell (120 BPM source); the core plays 128 BPM
  Lauf x;
  x.t.laden(bauen({zelle(*src, 2.0)}));
  PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(static_cast<int64_t>(x.t.k.sample_at(19.0)));
  const int64_t T = static_cast<int64_t>(std::llround(x.t.k.sample_at(8.0)));
  const double stetig = rms(x.bus, T + 15000, 15000);
  const double eigen = static_cast<double>(SINUS_AMP) * 2.0 * PI * SINUS_HZ / 48000.0;   // largest step of the tone itself
  double tiefster = 0.0, schritt = 0.0;
  for (int p = 1; p <= 4; ++p) {
    const int64_t J = static_cast<int64_t>(std::llround(x.t.k.sample_at(8.0 + 2.0 * p)));
    for (int w = -5; w < 5; ++w) {
      const double r = rms(x.bus, J + 480 * w, 480);
      tiefster = std::min(tiefster, 20.0 * std::log10(r / stetig));
    }
    schritt = std::max(schritt, groesster_schritt(x.bus, J - 2400, J + 2400));
  }
  std::printf("Fall 8: steady RMS %.4f, deepest 10 ms window across 4 seams %.2f dB, largest step %.1f %% of the tone's own, unterlauf %llu\n", stetig, tiefster,
              100.0 * schritt / eigen, static_cast<unsigned long long>(x.t.arr.warp_unterlauf()));
  PRUEF(tiefster > -1.0);
  PRUEF(schritt <= 1.2 * eigen);
}

// Pool exhaustion: Arrangement::test_launch_paesse_sperren() takes every pass slot that is free now (the passes already set up go on)
void fall9_pool() {
  ++g_faelle;
  const double schnell = static_cast<double>(SINUS_AMP) * 2.0 * PI * (SINUS_HZ * 128.0 / 120.0) / 48000.0;   // re-pitch at 128 BPM: the cell runs 128/120 fast
  {  // all slots taken before the launch: sound from T on, counted
    auto src = Audio::sinus(SINUS_FRAMES, SINUS_HZ, SINUS_AMP);
    Lauf x;
    x.t.laden(bauen({zelle(*src, 2.0)}));
    x.t.arr.test_launch_paesse_sperren();
    const uint64_t kp0 = x.t.arr.warp_kein_platz();
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(11.0)));
    const int64_t T = static_cast<int64_t>(std::llround(x.t.k.sample_at(8.0)));
    double tiefster = 1.0;
    for (int w = 0; w < 60; ++w) tiefster = std::min(tiefster, rms(x.bus, T + 480 * w, 480));
    std::printf("Fall 9a: pool exhausted before the launch: quietest 10 ms window %.4f (tone %.4f), kein_platz +%llu\n", tiefster, SINUS_AMP / std::sqrt(2.0),
                static_cast<unsigned long long>(x.t.arr.warp_kein_platz() - kp0));
    PRUEF(tiefster > 0.30);
    PRUEF(x.t.arr.warp_kein_platz() > kp0);
  }
  {  // taken while pass 1 plays: pass 2 (beat 12) is a re-pitch pass; when pass 1 has ended its slot is free again and pass 3 (beat 14) is keylock again
    auto src = Audio::sinus(SINUS_FRAMES, SINUS_HZ, SINUS_AMP);
    Lauf x;
    x.t.laden(bauen({zelle(*src, 2.0)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(10.5)));
    x.t.arr.test_launch_paesse_sperren();
    const uint64_t kp0 = x.t.arr.warp_kein_platz();
    x.bis(static_cast<int64_t>(x.t.k.sample_at(17.0)));
    double tiefster = 1.0, schritt = 0.0;
    const int64_t J2 = static_cast<int64_t>(std::llround(x.t.k.sample_at(12.0)));
    const int64_t J3 = static_cast<int64_t>(std::llround(x.t.k.sample_at(14.0)));
    for (int w = 0; w < 150; ++w) tiefster = std::min(tiefster, rms(x.bus, J2 - 2400 + 480 * w, 480));
    schritt = std::max(groesster_schritt(x.bus, J2 - 400, J2 + 400), groesster_schritt(x.bus, J3 - 400, J3 + 400));
    std::printf("Fall 9b: keylock -> re-pitch -> keylock: quietest window %.4f, largest step at the joins %.1f %% of the re-pitch tone's, kein_platz +%llu\n", tiefster,
                100.0 * schritt / schnell, static_cast<unsigned long long>(x.t.arr.warp_kein_platz() - kp0));
    PRUEF(tiefster > 0.30);
    PRUEF(schritt <= 2.0 * schnell);
    PRUEF(x.t.arr.warp_kein_platz() > kp0);
  }
}

void fall10_naht_exakt() {   // 133.33 BPM: 16 passes butt-join
  ++g_faelle;
  auto src = Audio::gleich(FPB125, 0.5f);
  Lauf x;
  x.t.k = cdj::Karte(133.33, 0);
  x.t.laden(bauen({zelle(*src, 1.0)}));
  PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(static_cast<int64_t>(x.t.k.sample_at(22.0)));
  int luecke = 0, doppelt = 0;
  for (int p = 1; p < 16; ++p) {
    const int64_t J = static_cast<int64_t>(std::llround(x.t.k.sample_at(4.0 + p)));
    for (int64_t i = J - 3; i <= J + 3; ++i) {
      const float v = x.at(i);
      if (v < 0.25f) ++luecke;
      if (v > 0.75f) ++doppelt;
    }
  }
  std::printf("Fall 10: 133.33 BPM, 15 joins of 16 passes: %d samples in a gap, %d in an overlap, unterlauf %llu\n", luecke, doppelt,
              static_cast<unsigned long long>(x.t.arr.warp_unterlauf()));
  PRUEF(luecke == 0 && doppelt == 0);
}

void fall11_faeden() {   // threaded werk, tempo changes while passes are prepared and freed
  ++g_faelle;
  auto src = Audio::sinus(SINUS_FRAMES / 2, SINUS_HZ, SINUS_AMP);
  Lauf x(true, 2);
  x.t.laden(bauen({zelle(*src, 1.0)}));
  PRUEF(x.t.arr.launch_start(ID, 1, 4.0, 0.0, 1, false) == LaunchGrund::ok);
  double bpm = 140.0;
  double ab = 5.0;
  for (int i = 0; i < 40; ++i) {
    const int64_t bis = x.t.s + 5 * 256;
    while (x.t.s < bis) {
      x.t.lauf(x.t.s + x.t.n);
      std::this_thread::sleep_for(std::chrono::microseconds(150));
    }
    ab = std::max(ab, x.t.k.beat_at(static_cast<double>(x.t.s)) + 0.5);
    if (x.t.k.rampe(ab, bpm, 0.25)) ++x.t.gen;
    ab += 0.5;
    bpm = bpm == 140.0 ? 120.0 : 140.0;
  }
  std::printf("Fall 11: threaded werk, 40 tempo changes, unterlauf %llu, kein_platz %llu\n", static_cast<unsigned long long>(x.t.arr.warp_unterlauf()),
              static_cast<unsigned long long>(x.t.arr.warp_kein_platz()));
  PRUEF(x.t.arr.warp_kein_platz() == 0);
}

}  // namespace

int main() {
  fall1();
  fall2();
  fall3();
  fall4();
  fall5_druck(64, false);
  fall5_druck(63, true);
  fall6();
  fall7();
  fall8_naht();
  fall9_pool();
  fall10_naht_exakt();
  fall11_faeden();
  std::printf("test_arr_launcher_warp: %d cases executed\n", g_faelle);
  PRUEF(g_faelle == 12);   // 1, 2, 3, 4, 5 (two runs), 6, 7, 8, 9, 10, 11
  PRUEF_ENDE();
}

#else

int main() {
  std::printf("skipped: built without Bungee\n");
  return 0;
}

#endif
