// Session view S1b, K3: re-pitch and one-shot launcher voices read through the cell map (slice order, reverse, seam fades, blende).
// 128 BPM: 22 500 samples per beat; 4-beat cells of 90 000 frames, 16 slots of 5 625 frames. Blocks of 256, transport stopped.
//   1  identity: no slice table, no reverse, no blende: the bus is bit-equal to the build before K3 (checksums recorded on that build), loop and
//      one-shot, also launched mid-cell; an identity table of 16 slots and a table-less cell give the same bits
//   2  shuffled 16-slot table: the click of source slot folge[k] sounds at the sample of played slot k (within 1 sample)
//   3  no seam click on a sine cell: the largest step around every seam stays below 1.5 times the step of the sine
//   4  rueckwaerts on a ramp cell: the ramp falls, the next pass restarts on the grid
//   5  einmal with rueckwaerts plays from its last frame, then silence
//   6  blende: loop seam dips, a hard onset mid-cell fades in over ARR_NAHT, an identity cell without blende does not
//   7  blende + slot table, hard start d samples before a non-continuous seam: the onset fade-in is a factor on the mix, no step
//   9  blende, start on the cell start at ratios 1.007 / 0.99 / 0.97 / 1.03 (and reversed): the dip is the fade-in, no second factor
//   8  a phase a hair below a slot seam reads no silence (tolerance of the source slot end)
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arrangement.h"
#include "check.h"

bool g_waechter = false;

using namespace arrtest;
using cdj::ArrArt;
using cdj::ArrZelle;
using cdj::ArrZellArt;
using cdj::LaunchGrund;

static const uint64_t ID = cdj::arr_id("s1");
static constexpr int64_t CELL = 4 * SPB;
static constexpr int64_t SLOT = CELL / 16;
static constexpr int64_t T0 = SPB;   // launch at beat 1

static ArrZelle zelle(Audio& a, ArrZellArt art = ArrZellArt::loop) {
  ArrZelle z;
  z.art = art;
  z.audio = &a.a;
  z.frames = a.a.frames;
  z.beats = art == ArrZellArt::loop ? 4.0 : 0.0;
  z.gain = 1.0f;
  z.modus = 0;
  return z;
}

// the map as the K2 loader sets it: slot starts g, table s (empty: n 0)
static void karte(ArrZelle& z, const std::vector<int>& folge, bool rueck = false, bool blende = false) {
  cdj::ZellKarte& k = z.karte;
  k.frames = z.frames;
  k.kreis = z.art == ArrZellArt::loop;
  k.rueck = rueck;
  k.blende = blende;
  k.n = static_cast<int>(folge.size());
  for (int i = 0; i < k.n; ++i) {
    k.g[i] = static_cast<double>(i) * static_cast<double>(z.frames) / k.n;
    k.s[i] = static_cast<uint8_t>(folge[static_cast<size_t>(i)]);
  }
  if (k.n) k.g[k.n] = static_cast<double>(z.frames);
}

struct Lauf {
  Treiber t;
  std::vector<float> b;
  explicit Lauf(const ArrZelle& z, double bpm = 128.0) {
    t.k = cdj::Karte{bpm, 0};
    Bau bau;
    bau.spur(1, ArrArt::audio);
    cdj::ArrSnapshot* s = bau.fertig();
    s->spur[0].kennung = ID;
    std::snprintf(s->spur[0].kennung_text, sizeof s->spur[0].kennung_text, "s1");
    s->spur[0].zellen[0] = z;
    s->spur[0].n_zellen = 1;
    t.laden(s);
  }
  void start(double versatz = 0.0) { PRUEF(t.arr.launch_start(ID, 1, 1.0, versatz, 1, false) == LaunchGrund::ok); }
  void bis(int64_t ziel) {
    while (t.s < ziel) {
      t.lauf(t.s + t.n);
      b.insert(b.end(), t.arr.spur_bus_l(0), t.arr.spur_bus_l(0) + t.n);
    }
  }
  float at(int64_t s) const { return b[static_cast<size_t>(s)]; }
};

static uint64_t fnv(const std::vector<float>& v) {
  uint64_t h = 1469598103934665603ull;
  for (float x : v) {
    uint32_t u;
    std::memcpy(&u, &x, 4);
    for (int i = 0; i < 4; ++i) h = (h ^ ((u >> (8 * i)) & 0xff)) * 1099511628211ull;
  }
  return h;
}

// checksums of the bus recorded on the build before K3 (base 2d52baf60)
static constexpr uint64_t SUMME_LOOP = 0x8f53a259a42d229eull, SUMME_MITTE = 0x7d2917d568d2f169ull, SUMME_EINMAL = 0xa21cfbd7848239aeull;

int main() {
  auto sin = Audio::sinus(CELL, 440.0, 0.5f);
  auto sin1 = Audio::sinus(20000, 440.0, 0.5f);
  const int64_t ENDE = T0 + 3 * CELL + 2 * SPB;

  {  // 1: identity bit-equal
    Lauf a(zelle(*sin));
    a.start();
    a.bis(ENDE);
    Lauf m(zelle(*sin));
    m.start(1.0);
    m.bis(ENDE);
    Lauf e(zelle(*sin1, ArrZellArt::einmal));
    e.start();
    e.bis(T0 + 40000);
    std::printf("summe loop 0x%llxull mitte 0x%llxull einmal 0x%llxull\n", static_cast<unsigned long long>(fnv(a.b)),
                static_cast<unsigned long long>(fnv(m.b)), static_cast<unsigned long long>(fnv(e.b)));
    PRUEF(fnv(a.b) == SUMME_LOOP);
    PRUEF(fnv(m.b) == SUMME_MITTE);
    PRUEF(fnv(e.b) == SUMME_EINMAL);
    std::vector<int> id16;
    for (int i = 0; i < 16; ++i) id16.push_back(i);
    ArrZelle z = zelle(*sin);
    karte(z, id16);
    Lauf t(z);
    t.start();
    t.bis(ENDE);
    PRUEF(t.b == a.b);   // identity table through the map path: the same bits
    ArrZelle ze = zelle(*sin1, ArrZellArt::einmal);
    karte(ze, {0});
    Lauf te(ze);
    te.start();
    te.bis(T0 + 40000);
    PRUEF(te.b == e.b);
  }

  const std::vector<int> folge = {3, 0, 15, 7, 1, 12, 5, 9, 2, 14, 6, 11, 4, 8, 13, 10};
  {  // 2: slot onsets (a click 100 frames into each source slot, value by slot number)
    auto kl = std::make_unique<Audio>();
    kl->d.assign(static_cast<size_t>(CELL) * 2, 0.0f);
    for (int k = 0; k < 16; ++k) kl->d[static_cast<size_t>(2 * (k * SLOT + 100))] = kl->d[static_cast<size_t>(2 * (k * SLOT + 100)) + 1] = (k + 1) / 32.0f;
    kl->fuellen(CELL);
    ArrZelle z = zelle(*kl);
    karte(z, folge);
    Lauf l(z);
    l.start();
    l.bis(T0 + CELL + 256);
    for (int k = 0; k < 16; ++k) {
      const int64_t s = T0 + k * SLOT + 100;
      float best = 0.0f;
      int64_t wo = -1;
      for (int64_t x = s - 3; x <= s + 3; ++x)
        if (std::fabs(l.at(x)) > best) best = std::fabs(l.at(x)), wo = x;
      PRUEF(wo >= 0 && std::llabs(wo - s) <= 1);
      PRUEF_NAH(best, (folge[static_cast<size_t>(k)] + 1) / 32.0, 1e-4);
    }
  }
  for (const double ratio : {1.0, 0.93, 1.07}) {  // 3: no seam click on a sine cell, at the cell tempo and at 0.93x / 1.07x (re-pitch)
    ArrZelle z = zelle(*sin);
    karte(z, folge);
    Lauf l(z, 128.0 * ratio);
    l.start();
    const int64_t t0 = static_cast<int64_t>(std::llround(l.t.k.sample_at(1.0)));
    const double slot_s = static_cast<double>(CELL) / 16.0 / ratio;   // played slot length in samples
    l.bis(t0 + static_cast<int64_t>(2.0 * 16.0 * slot_s) + 512);
    const double sinus_schritt = 0.5 * 2.0 * 3.14159265358979323846 * 440.0 / 48000.0 * std::max(1.0, ratio);
    double gross = 0.0;
    for (int k = 1; k < 32; ++k) {   // 16 slot seams per pass (k 16: the loop seam); k 0 is the hard onset of the launch, not a seam
      const int64_t naht = t0 + static_cast<int64_t>(std::llround(k * slot_s));
      for (int64_t x = naht - 150; x < naht + 150; ++x) gross = std::max(gross, static_cast<double>(std::fabs(l.at(x + 1) - l.at(x))));
    }
    std::printf("ratio %.2f seam step max %.5f, sine step %.5f\n", ratio, gross, sinus_schritt);
    PRUEF(gross < 1.5 * sinus_schritt);
  }
  {  // 4: rueckwaerts on a ramp: falls from the last frame, the loop stays on the grid
    auto ram = Audio::rampe(CELL);
    ArrZelle z = zelle(*ram);
    karte(z, {}, true);
    Lauf l(z);
    l.start();
    l.bis(T0 + 2 * CELL + 256);
    for (int64_t j = 0; j < CELL; j += 997) {
      PRUEF_NAH(l.at(T0 + j), static_cast<double>(CELL - 1 - j), 1e-2);
      PRUEF_NAH(l.at(T0 + CELL + j), static_cast<double>(CELL - 1 - j), 1e-2);
    }
  }
  {  // 5: einmal with rueckwaerts
    auto ram = Audio::rampe(20000);
    ArrZelle z = zelle(*ram, ArrZellArt::einmal);
    karte(z, {}, true);
    Lauf l(z);
    l.start();
    l.bis(T0 + 21000);
    for (int64_t j = 0; j < 20000; j += 499) PRUEF_NAH(l.at(T0 + j), static_cast<double>(19999 - j), 1e-2);
    PRUEF(l.at(T0 + 20500) == 0.0f);
    PRUEF(l.at(T0 + 19999) < 1e-3f);
  }
  {  // 6: blende: dip at the loop seam, fade-in at a hard onset mid-cell; without blende neither
    auto g = Audio::gleich(CELL, 0.5f);
    ArrZelle z = zelle(*g);
    karte(z, {}, false, true);
    Lauf l(z);
    l.start();
    l.bis(T0 + 2 * CELL);
    PRUEF_NAH(l.at(T0), 0.0, 1e-6);
    PRUEF_NAH(l.at(T0 + 48), 0.25, 1e-3);
    PRUEF_NAH(l.at(T0 + 200), 0.5, 1e-6);
    PRUEF_NAH(l.at(T0 + CELL - 48), 0.25, 2e-2);   // fade-out half way (read at the last frames)
    PRUEF_NAH(l.at(T0 + CELL - 1), 0.0, 1e-2);
    PRUEF_NAH(l.at(T0 + CELL), 0.0, 1e-6);
    PRUEF_NAH(l.at(T0 + CELL + 48), 0.25, 1e-3);
    PRUEF_NAH(l.at(T0 + CELL + 200), 0.5, 1e-6);
    Lauf m(z);
    m.start(1.0);   // hard onset one beat into the cell
    m.bis(T0 + 1000);
    PRUEF_NAH(m.at(T0), 0.0, 1e-6);
    PRUEF_NAH(m.at(T0 + 48), 0.25, 1e-3);
    PRUEF_NAH(m.at(T0 + 96), 0.5, 1e-6);
    ArrZelle z2 = zelle(*g);
    Lauf n(z2);
    n.start(1.0);
    n.bis(T0 + 1000);
    PRUEF_NAH(n.at(T0), 0.5, 1e-6);
    PRUEF_NAH(n.at(T0 + 48), 0.5, 1e-6);
  }
  {  // 7: blende cell with a slot table, hard start d samples before a non-continuous slot seam (beat 0.25): the onset fade-in stays a factor on
     // the finished mix, no step above 1.5x the sine step (the seam crossfade must not keep the onset at full level)
    ArrZelle z = zelle(*sin);
    karte(z, folge, false, true);
    const double sinus_schritt = 0.5 * 2.0 * 3.14159265358979323846 * 440.0 / 48000.0;
    for (const int d : {1, 2, 5, 20, 48, 70, 95}) {
      Lauf l(z);
      l.start(0.25 - static_cast<double>(d) / static_cast<double>(SPB));
      l.bis(T0 + 600);
      double gross = 0.0;
      for (int64_t x = T0 - 5; x < T0 + 500; ++x) gross = std::max(gross, static_cast<double>(std::fabs(l.at(x + 1) - l.at(x))));
      if (!(gross < 1.5 * sinus_schritt)) std::printf("d %d step %.5f\n", d, gross);
      PRUEF(gross < 1.5 * sinus_schritt);
    }
  }
  {  // 8: a phase a hair below a slot seam must not read silence: constant cell, shuffled table, start d samples before the seam at beat 0.25
    auto g = Audio::gleich(CELL, 0.5f);
    ArrZelle z = zelle(*g);
    karte(z, folge);
    for (int d = 0; d <= 100; ++d) {
      Lauf l(z);
      l.start(0.25 - static_cast<double>(d) / static_cast<double>(SPB));
      l.bis(T0 + 1200);
      float lo = 1.0f;
      for (int64_t x = T0; x < T0 + 1000; ++x) lo = std::min(lo, l.at(x));
      if (!(lo > 0.499999f)) std::printf("d %d min %.6f\n", d, lo);
      PRUEF(lo > 0.499999f);
    }
  }
  {  // 9: blende, start on the cell start at tempo ratios off 1 (re-pitch: the read position and the fade-in index no longer move in lockstep):
     // the map's dip is the fade-in, no second factor, so no step above 1.5x the sine step in the first 400 samples (also reversed)
    for (const double ratio : {1.0, 1.007, 0.99, 0.97, 1.03}) {
      for (const bool rueck : {false, true}) {
        ArrZelle z = zelle(*sin);
        karte(z, {}, rueck, true);
        Lauf l(z, 128.0 * ratio);
        l.start();
        const int64_t t0 = static_cast<int64_t>(std::llround(l.t.k.sample_at(1.0)));
        l.bis(t0 + 700);
        const double sinus_schritt = 0.5 * 2.0 * 3.14159265358979323846 * 440.0 / 48000.0 * std::max(1.0, ratio);
        double gross = 0.0;
        for (int64_t x = t0 - 2; x < t0 + 400; ++x) gross = std::max(gross, static_cast<double>(std::fabs(l.at(x + 1) - l.at(x))));
        if (!(gross < 1.5 * sinus_schritt)) std::printf("ratio %.3f rueck %d step %.5f (sine %.5f)\n", ratio, rueck, gross, sinus_schritt);
        PRUEF(gross < 1.5 * sinus_schritt);
      }
    }
  }
  PRUEF_ENDE();
}
