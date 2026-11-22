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
//  12  K4 pins: keylock identity (no map, pitch 1) at 0.9x and 1.0x: the track bus is bit-equal to the build before K4 (checksums recorded on f82e469b5)
//  13  K4 keylock cell, shuffled 16-slot table, 0.9x: the click of source slot 3 and 12 sounds at its played slot, within 2 ms of the grid, nothing elsewhere
//  14  K4 keylock cell, shuffled table, sine: largest step around the slot seams <= 1.5x the sine's step at 0.93x, 0.97x, 1.03x, 1.07x
//  15  K4 pitch 2^(3/12): a 440 Hz sine cell sounds at 523.25 Hz +- 0.5 %, the loop length stays on the grid (click of the next pass)
//  16  K4 keylock off (modus 0) loop cell, shuffled table, 0.9x: re-pitch through the map, on the grid
//  17  K4 pool full (test_launch_paesse_sperren) with a shuffled table: the re-pitch fallback plays the map, counted in kein_platz
//  19  K4 blende on a keylock cell (constant source): one dip at the loop seam, none doubled, nothing above the level; a hard onset mid-cell fades in
//  18  K4 cost per 256 block of a keylock cell (identity and shuffled map): printed only
//  20  K4 threaded werk (2 threads), 16-slot table, +3 st, tempo changes and restarts: the cell map is copied into the pass before the order (TSan), 523.25 Hz, no underrun
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

// ---- K4: the keylock pass reads through the cell map; transpose
constexpr int64_t CELL4 = 4 * SPB;   // 4-beat cell of a 128 BPM source: 90 000 frames
constexpr int64_t SLOT4 = CELL4 / 16;

void karte_setzen(ArrZelle& z, const std::vector<int>& folge, bool rueck = false) {
  cdj::ZellKarte& k = z.karte;
  k.frames = z.frames;
  k.kreis = true;
  k.rueck = rueck;
  k.blende = false;
  k.n = static_cast<int>(folge.size());
  for (int i = 0; i < k.n; ++i) {
    k.g[i] = static_cast<double>(i) * static_cast<double>(z.frames) / k.n;
    k.s[i] = static_cast<uint8_t>(folge[static_cast<size_t>(i)]);
  }
  if (k.n) k.g[k.n] = static_cast<double>(z.frames);
}

ArrZelle zelle128(Audio& a, int modus) {
  ArrZelle z = zelle(a, 4.0);
  z.modus = static_cast<int8_t>(modus);
  return z;
}

// Hann clicks 100 frames into source slots 3 and 12 (the others silent)
std::unique_ptr<Audio> klick_scheiben() {
  auto x = Audio::gleich(CELL4, 0.0f);
  const std::vector<float> h = hann_impuls();
  for (const int sl : {3, 12})
    for (int i = 0; i < HANN; ++i) x->d[static_cast<size_t>(2 * (sl * SLOT4 + 100 + i))] = x->d[static_cast<size_t>(2 * (sl * SLOT4 + 100 + i)) + 1] = h[static_cast<size_t>(i)];
  x->fuellen(CELL4);
  return x;
}

const std::vector<int> FOLGE = {3, 0, 15, 7, 1, 12, 5, 9, 2, 14, 6, 11, 4, 8, 13, 10};

// The clicks of played slots k (folge[k] is 3 or 12) are measured against the grid; every other played slot is silent around its click position.
// Returns the worst distance (1e9: a click missing or a sound where none belongs).
double onsets(const std::vector<float>& bus, const cdj::Karte& k, double beat0, int pass) {
  double schlimmste = 0.0;
  for (int sl = 0; sl < 16; ++sl) {
    const double b = beat0 + pass * 4.0 + static_cast<double>(sl * SLOT4 + 100 + 71.5) / static_cast<double>(SPB);
    const int64_t e = static_cast<int64_t>(std::llround(k.sample_at(b)));
    if (FOLGE[static_cast<size_t>(sl)] == 3 || FOLGE[static_cast<size_t>(sl)] == 12) {
      const double m = klick_mitte(bus, e, 300);
      if (m < -1e8) return 1e9;
      schlimmste = std::max(schlimmste, std::fabs(m - static_cast<double>(e)));
    } else {
      float sp = 0.0f;
      for (int64_t i = e - 150; i < e + 150; ++i) sp = std::max(sp, std::fabs(bus[static_cast<size_t>(i)]));
      if (sp > 0.03f) return 1e9;
    }
  }
  return schlimmste;
}

uint64_t fnv_bus(const std::vector<float>& v) {
  uint64_t h = 1469598103934665603ull;
  for (float x : v) {
    uint32_t u;
    std::memcpy(&u, &x, 4);
    for (int i = 0; i < 4; ++i) h = (h ^ ((u >> (8 * i)) & 0xff)) * 1099511628211ull;
  }
  return h;
}

constexpr uint64_t SUMME_KL09 = 0x461ed38ab9702a96ull, SUMME_KL10 = 0xa442798ac0eba288ull;   // recorded on f82e469b5 (before K4)

void fall12_pins() {
  ++g_faelle;
  auto sin = Audio::sinus(CELL4, 440.0, 0.5f);
  uint64_t summe[2] = {0, 0};
  int i = 0;
  for (const double ratio : {0.9, 1.0}) {
    Lauf x;
    x.t.k = cdj::Karte{128.0 * ratio, 0};
    x.t.laden(bauen({zelle128(*sin, 2)}));
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 3 * 4.0 + 2.0)));
    summe[i++] = fnv_bus(x.bus);
  }
  std::printf("Fall 12: keylock identity checksums 0x%llxull (0.9x) 0x%llxull (1.0x)\n", static_cast<unsigned long long>(summe[0]), static_cast<unsigned long long>(summe[1]));
  PRUEF(summe[0] == SUMME_KL09);
  PRUEF(summe[1] == SUMME_KL10);
}

void fall13_onsets() {
  ++g_faelle;
  auto kl = klick_scheiben();
  ArrZelle z = zelle128(*kl, 2);
  karte_setzen(z, FOLGE);
  Lauf x;
  x.t.k = cdj::Karte{128.0 * 0.9, 0};
  x.t.laden(bauen({z}));
  PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 2 * 4.0 + 1.0)));
  const double d1 = onsets(x.bus, x.t.k, 8.0, 0), d2 = onsets(x.bus, x.t.k, 8.0, 1);
  std::printf("Fall 13: keylock, shuffled table, 0.9x: worst click distance pass 1 %.2f, pass 2 %.2f samples (limit 96), kein_platz %llu\n", d1, d2,
              static_cast<unsigned long long>(x.t.arr.warp_kein_platz()));
  PRUEF(d1 <= 96.0 && d2 <= 96.0);
  PRUEF(x.t.arr.warp_kein_platz() == 0);
}

void fall14_naehte() {
  ++g_faelle;
  auto sin = Audio::sinus(CELL4, 440.0, 0.5f);
  const double eigen = 0.5 * 2.0 * PI * 440.0 / 48000.0;
  for (const double ratio : {0.93, 0.97, 1.03, 1.07}) {
    ArrZelle z = zelle128(*sin, 2);
    karte_setzen(z, FOLGE);
    Lauf x;
    x.t.k = cdj::Karte{128.0 * ratio, 0};
    x.t.laden(bauen({z}));
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 2 * 4.0 + 1.0)));
    {  // the table is read: the pass differs clearly from the table-less cell (a shuffled table with phase jumps; the rms of the difference is large)
      ArrZelle zi = zelle128(*sin, 2);
      Lauf y;
      y.t.k = cdj::Karte{128.0 * ratio, 0};
      y.t.laden(bauen({zi}));
      PRUEF(y.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
      y.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 2 * 4.0 + 1.0)));
      const int64_t a = static_cast<int64_t>(x.t.k.sample_at(9.0));
      double q = 0.0;
      for (int64_t i = a; i < a + 20000; ++i) q += std::pow(static_cast<double>(x.bus[static_cast<size_t>(i)]) - static_cast<double>(y.bus[static_cast<size_t>(i)]), 2.0);
      const double dr = std::sqrt(q / 20000.0);
      std::printf("Fall 14: ratio %.2f: rms of the difference to the table-less cell %.3f\n", ratio, dr);
      PRUEF(dr > 0.1);
    }
    double gross = 0.0, stetig = 0.0;
    for (int k = 1; k < 32; ++k) {   // slot seams of two passes (k 16: the loop seam)
      const int64_t J = static_cast<int64_t>(std::llround(x.t.k.sample_at(8.0 + k * 0.25)));
      gross = std::max(gross, groesster_schritt(x.bus, J - 200, J + 200));
      stetig = std::max(stetig, groesster_schritt(x.bus, J + 600, J + 1400));
    }
    std::printf("Fall 14: ratio %.2f: largest step at seams %.5f, in steady sine %.5f, sine's own %.5f (%.2fx), unterlauf %llu\n", ratio, gross, stetig, eigen, gross / eigen,
                static_cast<unsigned long long>(x.t.arr.warp_unterlauf()));
    PRUEF(gross < 1.5 * eigen);
  }
}

double frequenz_bus(const std::vector<float>& l, int64_t a, int64_t b) {
  double erste = -1, letzte = -1;
  int zahl = 0;
  for (int64_t i = a; i + 1 < b; ++i) {
    const double x0 = l[static_cast<size_t>(i)], x1 = l[static_cast<size_t>(i + 1)];
    if (x0 < 0 && x1 >= 0) {
      const double t = static_cast<double>(i) + (-x0) / (x1 - x0);
      if (erste < 0) erste = t;
      letzte = t;
      ++zahl;
    }
  }
  return zahl < 2 ? 0.0 : (zahl - 1) * 48000.0 / (letzte - erste);
}

void fall15_pitch() {
  ++g_faelle;
  const double faktor = std::pow(2.0, 3.0 / 12.0);
  {  // frequency
    auto sin = Audio::sinus(CELL4, 440.0, 0.5f);
    ArrZelle z = zelle128(*sin, 2);
    z.pitch = faktor;
    Lauf x;
    x.t.laden(bauen({z}));
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 2 * 4.0)));
    const int64_t a = static_cast<int64_t>(x.t.k.sample_at(9.0)), b = static_cast<int64_t>(x.t.k.sample_at(11.0));
    const double hz = frequenz_bus(x.bus, a, b);
    std::printf("Fall 15: +3 st: %.2f Hz (440 * %.4f = %.2f), ratio %.4f\n", hz, faktor, 440.0 * faktor, hz / 440.0);
    PRUEF(std::fabs(hz / 440.0 / faktor - 1.0) < 0.005);
  }
  {  // the loop length stays on the grid: the click of beat 0 of passes 1 to 3
    auto kl = Audio::gleich(CELL4, 0.0f);   // a Hann click on every beat of the 128 BPM source
    const std::vector<float> h = hann_impuls();
    for (int b = 0; b < 4; ++b)
      for (int i = 0; i < HANN; ++i) kl->d[static_cast<size_t>(2 * (b * SPB + i))] = kl->d[static_cast<size_t>(2 * (b * SPB + i) + 1)] = h[static_cast<size_t>(i)];
    kl->fuellen(CELL4);
    ArrZelle z = zelle128(*kl, 2);
    z.pitch = faktor;
    Lauf x;
    x.t.laden(bauen({z}));
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 3 * 4.0 + 1.0)));
    double schlimmste = 0.0;
    for (int p = 0; p < 3; ++p)
      for (int b = 0; b < 4; ++b) {
        const int64_t e = static_cast<int64_t>(std::llround(x.t.k.sample_at(8.0 + p * 4.0 + b + 71.5 / static_cast<double>(SPB))));
        int64_t bt = e - 300;
        float best = 0.0f;
        for (int64_t i = e - 300; i < e + 300; ++i)
          if (std::fabs(x.at(i)) > best) best = std::fabs(x.at(i)), bt = i;
        if (best < 0.05f) schlimmste = 1e9;
        schlimmste = std::max(schlimmste, std::fabs(static_cast<double>(bt - e)));
      }
    std::printf("Fall 15: +3 st, 12 clicks of 3 passes: worst peak distance to the grid %.0f samples\n", schlimmste);
    PRUEF(schlimmste <= 96.0);
  }
}

void fall16_repitch_modus0() {
  ++g_faelle;
  auto kl = klick_scheiben();
  ArrZelle z = zelle128(*kl, 0);
  karte_setzen(z, FOLGE);
  Lauf x;
  x.t.k = cdj::Karte{128.0 * 0.9, 0};
  x.t.laden(bauen({z}));
  PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 2 * 4.0 + 1.0)));
  const double d1 = onsets(x.bus, x.t.k, 8.0, 0), d2 = onsets(x.bus, x.t.k, 8.0, 1);
  std::printf("Fall 16: keylock off, shuffled table, 0.9x: worst click distance %.2f / %.2f samples, werk voices %d\n", d1, d2, x.t.arr.werk_stimmen());
  PRUEF(d1 <= 96.0 && d2 <= 96.0);
  PRUEF(x.t.arr.werk_stimmen() == 0);
}

void fall17_pool_voll_karte() {
  ++g_faelle;
  auto kl = klick_scheiben();
  ArrZelle z = zelle128(*kl, 2);
  karte_setzen(z, FOLGE);
  Lauf x;
  x.t.k = cdj::Karte{128.0 * 0.9, 0};
  x.t.laden(bauen({z}));
  x.t.arr.test_launch_paesse_sperren();
  const uint64_t kp0 = x.t.arr.warp_kein_platz();
  PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
  x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 2 * 4.0 + 1.0)));
  const double d1 = onsets(x.bus, x.t.k, 8.0, 0), d2 = onsets(x.bus, x.t.k, 8.0, 1);
  std::printf("Fall 17: pool full, shuffled table: worst click distance %.2f / %.2f samples, kein_platz +%llu\n", d1, d2, static_cast<unsigned long long>(x.t.arr.warp_kein_platz() - kp0));
  PRUEF(d1 <= 96.0 && d2 <= 96.0);
  PRUEF(x.t.arr.warp_kein_platz() > kp0);
}

void fall18_kosten() {
  ++g_faelle;
  auto sin = Audio::sinus(CELL4, 440.0, 0.5f);
  for (const bool mit_karte : {false, true}) {
    ArrZelle z = zelle128(*sin, 2);
    if (mit_karte) karte_setzen(z, FOLGE);
    Lauf x;
    x.t.k = cdj::Karte{128.0 * 0.97, 0};
    x.t.laden(bauen({z}));
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(7.0)));
    std::vector<double> us;
    const int64_t bis = static_cast<int64_t>(x.t.k.sample_at(8.0 + 3 * 4.0));
    while (x.t.s < bis) {
      const auto a = std::chrono::steady_clock::now();
      x.t.lauf(x.t.s + x.t.n);
      us.push_back(std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - a).count());
    }
    std::sort(us.begin(), us.end());
    std::printf("Fall 18: cost per 256 block (synchronous werk, callback + werk), %s: p50 %.1f us, p99 %.1f us, max %.1f us over %zu blocks\n", mit_karte ? "shuffled map" : "identity", us[us.size() / 2],
                us[us.size() * 99 / 100], us.back(), us.size());
  }
}

void fall19_blende() {
  ++g_faelle;
  auto g = Audio::gleich(CELL4, 0.5f);
  {  // loop seams of passes 1 to 3
    ArrZelle z = zelle128(*g, 2);
    karte_setzen(z, {});
    z.karte.blende = true;
    Lauf x;
    x.t.k = cdj::Karte{128.0 * 0.97, 0};
    x.t.laden(bauen({z}));
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 0.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 3 * 4.0 + 1.0)));
    float hoch = 0.0f;
    double schritt = 0.0, tief = 1.0, stetig = 1.0;
    for (int p = 1; p <= 2; ++p) {
      const int64_t J = static_cast<int64_t>(std::llround(x.t.k.sample_at(8.0 + 4.0 * p)));
      for (int64_t i = J - 600; i < J + 600; ++i) {
        hoch = std::max(hoch, x.at(i));
        tief = std::min(tief, static_cast<double>(x.at(i)));
      }
      schritt = std::max(schritt, groesster_schritt(x.bus, J - 600, J + 600));
      stetig = std::min(stetig, static_cast<double>(x.at(J + 3000)));
    }
    std::printf("Fall 19: blende keylock: level %.3f, dip minimum %.3f, highest %.3f, largest step %.4f (a linear dip over 96 frames steps 0.0052)\n", stetig, tief, hoch, schritt);
    PRUEF_NAH(stetig, 0.5, 0.03);
    PRUEF(tief < 0.1);
    PRUEF(hoch < 0.52f);
    PRUEF(schritt < 0.012);
  }
  {  // hard onset mid-cell (one beat in): fades in over the first samples
    ArrZelle z = zelle128(*g, 2);
    karte_setzen(z, {});
    z.karte.blende = true;
    Lauf x;
    x.t.laden(bauen({z}));
    PRUEF(x.t.arr.launch_start(ID, 1, 8.0, 1.0, 1, false) == LaunchGrund::ok);
    x.bis(static_cast<int64_t>(x.t.k.sample_at(8.0 + 2.0)));
    const int64_t T = static_cast<int64_t>(std::llround(x.t.k.sample_at(8.0)));
    std::printf("Fall 19: blende keylock, onset mid-cell: x[T] %.3f x[T+48] %.3f x[T+200] %.3f, largest step in the first 400 samples %.4f\n", x.at(T), x.at(T + 48), x.at(T + 200),
                groesster_schritt(x.bus, T - 2, T + 400));
    PRUEF(x.at(T) < 0.05f);
    PRUEF_NAH(x.at(T + 200), 0.5, 0.03);
    PRUEF(groesster_schritt(x.bus, T - 2, T + 400) < 0.012);
  }
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

// K4: the cell map crosses to the werk thread. A real werk thread (2 threads), a 16-slot table (identity order: the sine stays continuous and measurable), +3 st, tempo
// changes (karte_neu sets up the passes again) and restarts (launch_start with the voice sounding: the prepared voice goes through launch_kl_vorab, launch_pass_vor
// copies the map into the pass). The copy in the pass must be written before werk->ansetzen: the TSan build reports a race otherwise (positive control: write p.zk after
// ansetzen). Restarts are placed in the middle of a pass of the sounding voice, so no pass boundary of the old voice falls into the window; for each one the werk's
// order count (WarpZaehler::ansaetze) must rise, i.e. launch_pass_vor really ran (a start overwritten before its prepared pass never gets there).
void fall20_faeden_karte() {
  ++g_faelle;
  const double faktor = std::pow(2.0, 3.0 / 12.0);
  auto sin = Audio::sinus(CELL4, 440.0, 0.5f);
  ArrZelle z = zelle128(*sin, 2);
  karte_setzen(z, {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15});
  z.pitch = faktor;
  Lauf x(true, 2);
  x.t.laden(bauen({z}));
#if defined(__SANITIZE_THREAD__)
  const auto pause = std::chrono::microseconds(3000);   // the instrumented werk threads are several times slower
#else
  const auto pause = std::chrono::microseconds(150);
#endif
  auto weiter = [&](int64_t ziel) {
    while (x.t.s < ziel) {
      x.t.lauf(x.t.s + x.t.n);
      x.bus.insert(x.bus.end(), x.t.arr.spur_bus_l(0), x.t.arr.spur_bus_l(0) + x.t.n);
      std::this_thread::sleep_for(pause);
    }
  };
  auto bis_beat = [&](double b) { weiter(static_cast<int64_t>(std::llround(x.t.k.sample_at(b)))); };
  auto jetzt = [&] { return x.t.k.beat_at(static_cast<double>(x.t.s)); };
  double ab_cur = 8.0;
  int64_t id = 1;
  PRUEF(x.t.arr.launch_start(ID, 1, ab_cur, 0.0, id++, false) == LaunchGrund::ok);
  bis_beat(ab_cur + 2 * 4.0);   // the start-up is over
  const uint64_t ul0 = x.t.arr.warp_unterlauf();
  const uint64_t an0 = x.t.werk->zaehler().ansaetze;
  int neustarts = 0, erreicht = 0;
  double bpm = 140.0;
  for (int i = 0; i < 6; ++i) {
    {  // tempo change: the passes that have not started are set up again
      const double ab = jetzt() + 0.5;
      if (x.t.k.rampe(ab, bpm, 0.25)) ++x.t.gen;
      bpm = bpm == 140.0 ? 120.0 : 140.0;
      bis_beat(ab + 1.5);
    }
    {  // restart in the middle of a pass of the sounding voice (1.0 to 1.5 beats after its pass start; the window of 1.5 beats ends before the next pass is prepared)
      const double m = std::fmod(jetzt() - ab_cur, 4.0);
      const double bis = m < 1.0 ? jetzt() + (1.0 - m) : m > 1.5 ? jetzt() + (4.0 - m) + 1.0 : jetzt();
      bis_beat(bis);
      const double ab_neu = jetzt() + 1.0;
      const uint64_t n0 = x.t.werk->zaehler().ansaetze;
      PRUEF(x.t.arr.launch_start(ID, 1, ab_neu, 0.0, id++, false) == LaunchGrund::ok);
      bis_beat(ab_neu + 0.5);
      ++neustarts;
      if (x.t.werk->zaehler().ansaetze > n0) ++erreicht;
      ab_cur = ab_neu;
    }
  }
  bis_beat(ab_cur + 12.0 + 3.0);   // steady tempo for three passes: the last tempo change lies far back
  const int64_t a = static_cast<int64_t>(std::llround(x.t.k.sample_at(ab_cur + 12.0 + 1.5))), b = static_cast<int64_t>(std::llround(x.t.k.sample_at(ab_cur + 12.0 + 2.5)));
  const double hz = frequenz_bus(x.bus, a, b);
  float spitze = 0.0f;
  for (int64_t i = a; i < b; ++i) spitze = std::max(spitze, std::fabs(x.at(i)));
  const uint64_t ansaetze = x.t.werk->zaehler().ansaetze - an0;
  std::printf("Fall 20: threaded werk, 16-slot map, +3 st, %d tempo changes and restarts: %.2f Hz (440 * %.4f = %.2f), peak %.3f, orders taken %llu, restarts reaching launch_pass_vor %d of %d, "
              "unterlauf +%llu, kein_platz %llu\n",
              6, hz, faktor, 440.0 * faktor, spitze, static_cast<unsigned long long>(ansaetze), erreicht, neustarts, static_cast<unsigned long long>(x.t.arr.warp_unterlauf() - ul0),
              static_cast<unsigned long long>(x.t.arr.warp_kein_platz()));
  PRUEF(erreicht == neustarts);
  PRUEF(ansaetze >= 20);
  PRUEF(std::fabs(hz / 440.0 / faktor - 1.0) < 0.005);
  PRUEF(spitze > 0.4f);
  PRUEF(x.t.arr.warp_unterlauf() == ul0);
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
  fall12_pins();
  fall13_onsets();
  fall14_naehte();
  fall15_pitch();
  fall16_repitch_modus0();
  fall17_pool_voll_karte();
  fall18_kosten();
  fall19_blende();
  fall20_faeden_karte();
  std::printf("test_arr_launcher_warp: %d cases executed\n", g_faelle);
  PRUEF(g_faelle == 21);   // 1, 2, 3, 4, 5 (two runs), 6, 7, 8, 9, 10, 11, 12 to 19, 20
  PRUEF_ENDE();
}

#else

int main() {
  std::printf("skipped: built without Bungee\n");
  return 0;
}

#endif
