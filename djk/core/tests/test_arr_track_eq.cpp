// Loop deck channel strip KZ2: the 3-band isolator of an arrangement track (rows spur/<n>/eq/{tief,mitte,hoch}, fields ARR_F_EQ0 + 0..2, one cypherdj::dsp::Isolator per track in
// Arrangement::mischen, behind the K7b DJ filter, in front of the monitor join and the fader loop), with a crossfaded bypass while all three bands are 0 dB.
// Cases: 1 neutral (all bands 0 is bit-equal to a run that never enters the EQ path, the isolator stays in bypass: eq_leer), 2 kill of one band (-200): the band's sine drops by at least
// 60 dB after the crossfade, the other two sines stay within 1 dB (tief, mitte, hoch), 3 +6 dB on mitte lifts 1 kHz by 6 dB within 0.5, 4 a step 0 -> -200 -> 0 delivered as the stellwerk does
// (a 5 ms row course) and the entering and the leaving of the bypass with a broadband signal: no sample-to-sample step above the bound, 5 back to 0/0/0: after one block plus ARR_NAHT the
// bypass is back, eq_leer, and the output is bit-equal to dry, 6 a track that gets another identity in a snapshot swap starts with an empty isolator (the same id keeps the state), 7 no
// allocation, no blocking lock, no sleep over 2000 blocks with moving bands on all 32 tracks, 8 the wall time of one running isolator per 1024-sample block (printed, not asserted).
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include <cypherdj/dsp/isolator.h>

#include "arr_build.h"
#include "cypherdj/arrangement.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static constexpr int64_t FRAMES = 200000;
static constexpr double PI = 3.14159265358979323846;
#define TR(n) auto n##_p = std::make_unique<Treiber>(); Treiber& n = *n##_p;

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
static int eq_reg(Treiber& t, int spur, int band) {
  static const char* name[3] = {"tief", "mitte", "hoch"};
  return reg(t, "spur/" + std::to_string(spur) + "/eq/" + name[band]);
}
// tracks 1..n, one clip each (beats long), the same signal on every track
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, int n_spuren, int64_t nr = 1, uint64_t kennung0 = 0, double beats = 8.0) {
  Bau b(nr);
  for (int sp = 1; sp <= n_spuren; ++sp) {
    const std::string id = "c" + std::to_string(sp);
    b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, beats, a);
  }
  cdj::ArrSnapshot* s = b.fertig();
  if (kennung0) s->spur[0].kennung = kennung0;
  return s;
}
static void spiele(Treiber& t, cdj::ArrSnapshot* s, int64_t bis) {
  t.laden(s);
  t.arr.start(0.0, 0, false, 0, V, 256, t.k);
  t.lauf(bis);
}
static double rms(const std::vector<float>& x, int64_t von, int64_t bis) {
  double e = 0.0;
  for (int64_t i = von; i < bis; ++i) e += static_cast<double>(x[i]) * x[i];
  return std::sqrt(e / static_cast<double>(bis - von));
}
static bool gleich(const std::vector<float>& a, const std::vector<float>& b) { return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0; }
static bool gleich_ab(const std::vector<float>& a, const std::vector<float>& b, int64_t von, int64_t bis) {
  return a.size() >= static_cast<size_t>(bis) && b.size() >= static_cast<size_t>(bis) && std::memcmp(a.data() + von, b.data() + von, static_cast<size_t>(bis - von) * sizeof(float)) == 0;
}
static double db(double v, double ref) { return 20.0 * std::log10(std::max(v, 1e-12) / ref); }
static double max_sprung(const std::vector<float>& x, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von + 1; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(x[i] - x[i - 1])));
  return m;
}
// a sum of sines, equal amplitude each (the broadband signal of case 4)
static std::unique_ptr<Audio> mehrfach(int64_t frames, const std::vector<double>& hz, float amp) {
  auto x = std::make_unique<Audio>();
  x->d.resize(static_cast<size_t>(frames) * 2);
  for (int64_t f = 0; f < frames; ++f) {
    double v = 0.0;
    for (double h : hz) v += amp * std::sin(2.0 * PI * h * static_cast<double>(f) / 48000.0);
    x->d[2 * f] = x->d[2 * f + 1] = static_cast<float>(v);
  }
  x->fuellen(frames);
  return x;
}

int main() {
  const auto s60 = Audio::sinus(FRAMES, 60.0, 0.5f);
  const auto s1k = Audio::sinus(FRAMES, 1000.0, 0.5f);
  const auto s8k = Audio::sinus(FRAMES, 8000.0, 0.5f);
  const int64_t BIS = 90000, VON = 60000;   // measuring window; the 2 beat count-in (about 45000 samples at 128 bpm) is over long before

  // 1 neutral
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 1), BIS);
    PRUEF(rms(ref.l, VON, BIS) > 0.1);   // the reference really plays
    PRUEF(ref.arr.eq_leer(0));

    TR(nullzeilen)   // all three rows set to 0 explicitly: the same as never touched
    for (int b = 0; b < 3; ++b) nullzeilen.arr.setze_sofort(eq_reg(nullzeilen, 1, b), 0.0f);
    spiele(nullzeilen, snap(&s1k->a, 1), BIS);
    PRUEF(gleich(ref.l, nullzeilen.l) && gleich(ref.r, nullzeilen.r));
    PRUEF(nullzeilen.arr.eq_leer(0));

    TR(vl0)   // a per-sample course of zeros on every band: the rows carry a course, the track must still stay in bypass and bit-equal
    const int r0 = eq_reg(vl0, 1, 0), r1 = eq_reg(vl0, 1, 1), r2 = eq_reg(vl0, 1, 2);
    static float nullen[256] = {};
    vl0.laden(snap(&s1k->a, 1));
    vl0.arr.start(0.0, 0, false, 0, V, 256, vl0.k);
    vl0.vor_block = [&](int64_t) { vl0.arr.verlauf(r0, nullen); vl0.arr.verlauf(r1, nullen); vl0.arr.verlauf(r2, nullen); };
    vl0.lauf(BIS);
    PRUEF(gleich(ref.l, vl0.l) && gleich(ref.r, vl0.r));
    PRUEF(vl0.arr.eq_leer(0));

    TR(nan)   // NaN is 0 dB
    nan.arr.setze_sofort(eq_reg(nan, 1, 1), std::nanf(""));
    spiele(nan, snap(&s1k->a, 1), BIS);
    PRUEF(gleich(ref.l, nan.l));
    PRUEF(nan.arr.eq_leer(0));
  }

  // 2 kill of one band: the band's sine goes down, the other two stay. Measured against the run at 0/0/0.
  const Audio* aus[3] = {s60.get(), s1k.get(), s8k.get()};
  const char* bandname[3] = {"tief", "mitte", "hoch"};
  const double hz[3] = {60.0, 1000.0, 8000.0};
  double daempfung[3] = {0, 0, 0}, neben_max[3] = {0, 0, 0};
  for (int band = 0; band < 3; ++band) {
    for (int sig = 0; sig < 3; ++sig) {
      TR(ref)
      spiele(ref, snap(&aus[sig]->a, 1), BIS);
      TR(t)
      t.arr.setze_sofort(eq_reg(t, 1, band), -200.0f);
      spiele(t, snap(&aus[sig]->a, 1), BIS);
      const double d = db(rms(t.l, VON, BIS), rms(ref.l, VON, BIS));
      std::printf("2: kill %s, %.0f Hz: %.2f dB\n", bandname[band], hz[sig], d);
      if (sig == band) {
        daempfung[band] = d;
        PRUEF(d < -60.0);
      } else {
        neben_max[band] = std::max(neben_max[band], std::fabs(d));
        PRUEF(std::fabs(d) < 1.0);
      }
    }
  }

  // 3 +6 dB on mitte lifts 1 kHz by 6 dB
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 1), BIS);
    TR(t)
    t.arr.setze_sofort(eq_reg(t, 1, 1), 6.0f);
    spiele(t, snap(&s1k->a, 1), BIS);
    const double d = db(rms(t.l, VON, BIS), rms(ref.l, VON, BIS));
    std::printf("3: mitte +6 dB, 1 kHz: %.3f dB\n", d);
    PRUEF(std::fabs(d - 6.0) < 0.5);
  }

  // 4a a 5 ms row course 0 -> -200 on tief and back, as the stellwerk delivers a dB row (through -60 dB, then the end value), on a 1 kHz sine: no step above the sine's own
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 1), BIS);
    TR(t)
    const int r = eq_reg(t, 1, 0);
    t.laden(snap(&s1k->a, 1));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    static float vlf[256];
    const int64_t HIN = 66000 + 64, ZURUECK = 78000 + 64;   // both ramps start mid-block
    t.vor_block = [&](int64_t s) {
      for (int i = 0; i < 256; ++i) {
        const int64_t a = s + i - HIN, b = s + i - ZURUECK;
        float v;
        if (s + i < ZURUECK) v = a < 0 ? 0.0f : a >= 240 ? -200.0f : -60.0f * static_cast<float>(a) / 240.0f;
        else v = b >= 240 ? 0.0f : -60.0f + 60.0f * static_cast<float>(b) / 240.0f;
        vlf[i] = v;
      }
      t.arr.verlauf(r, vlf);
    };
    t.lauf(BIS);
    const double j_ref = max_sprung(ref.l, 50000, BIS), j = max_sprung(t.l, 50000, BIS);
    std::printf("4a: largest step %.4f (unprocessed signal %.4f)\n", j, j_ref);
    PRUEF(j <= j_ref * 1.05 + 1e-4);
    // the 60 Hz of the band is not in this signal: level before and after the move are the same within 1 dB
    PRUEF(std::fabs(db(rms(t.l, 70000, 76000), rms(ref.l, 70000, 76000))) < 1.0);
  }
  // 4b entering and leaving the bypass with a broadband signal (60, 500, 3k, 9k Hz): the crossfade adds no step beyond what a sum of these sines can have by itself
  {
    const std::vector<double> bands = {60.0, 500.0, 3000.0, 9000.0};
    const float amp = 0.1f;
    const auto breit = mehrfach(FRAMES, bands, amp);
    double theorie = 0.0;   // largest possible step of any sum of these sines with gain <= 1 per band (all aligned): amp * 2 pi f / fs, summed
    for (double h : bands) theorie += amp * 2.0 * PI * h / 48000.0;
    theorie *= 0.7071;   // the pan law of a centred track (-3 dB), the master sum carries it
    TR(ref)
    spiele(ref, snap(&breit->a, 1), BIS);
    const double j_ref = max_sprung(ref.l, 50000, BIS);
    // enter at 66000 (mitte -12 dB), leave at 78000 (back to 0 dB on all three bands)
    TR(t)
    const int r = eq_reg(t, 1, 1);
    t.laden(snap(&breit->a, 1));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.vor_block = [&](int64_t s) { if (s >= 66048 && s < 78000) t.arr.setze_sofort(r, -12.0f); else if (s >= 78000) t.arr.setze_sofort(r, 0.0f); };
    t.lauf(BIS);
    const double j = max_sprung(t.l, 50000, BIS);
    std::printf("4b: largest step %.4f (unprocessed %.4f, bound of the sum %.4f)\n", j, j_ref, theorie);
    PRUEF(j <= theorie + 1e-4);
    PRUEF(t.arr.eq_leer(0));   // and it is back in bypass at the end
  }

  // 5 back to 0/0/0: after one block plus ARR_NAHT the bypass is back, bit-equal to dry from then on
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 1), BIS);
    TR(t)
    const int r = eq_reg(t, 1, 0);
    t.arr.setze_sofort(r, -200.0f);
    t.laden(snap(&s1k->a, 1));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(70000);
    PRUEF(!t.arr.eq_leer(0));   // running, holds state
    t.arr.setze_sofort(r, 0.0f);
    const int64_t WEG = t.s;   // the first block at 0 starts here
    t.lauf(WEG + 256 + cdj::ARR_NAHT + 256);
    PRUEF(t.arr.eq_leer(0));
    t.lauf(BIS);
    PRUEF(gleich_ab(ref.l, t.l, WEG + 256 + cdj::ARR_NAHT, BIS) && gleich_ab(ref.r, t.r, WEG + 256 + cdj::ARR_NAHT, BIS));
  }

  // 6 identity: a swap that puts another track id on index 0 clears the isolator, the same id keeps it
  {
    TR(t)
    t.arr.setze_sofort(eq_reg(t, 1, 0), -200.0f);
    t.laden(snap(&s1k->a, 1, 1, 111));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(70000);
    PRUEF(t.arr.eq_leer(0) == false);
    t.laden(snap(&s1k->a, 1, 2, 111));   // same id: the state stays
    PRUEF(t.arr.eq_leer(0) == false);
    t.laden(snap(&s1k->a, 1, 3, 222));   // another id: cleared
    PRUEF(t.arr.eq_leer(0) == true);
  }

  // 7 no allocation, no lock, no sleep over 2000 blocks with moving bands on all 32 tracks (some blocks neutral on a track, to walk the whole state machine)
  {
    const auto lang = Audio::sinus(700000, 1000.0, 0.1f);
    TR(t)
    t.laden(snap(&lang->a, 32, 1, 0, 28.0));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    int rz[32][3];
    for (int n = 1; n <= 32; ++n)
      for (int b = 0; b < 3; ++b) rz[n - 1][b] = eq_reg(t, n, b);
    float vl[256], b[6][cdj::ARR_BLOCK];
    int64_t s = 0;
    long alloc = 0, summe = 0;
    int bloecke = 0, gezaehlt = 0;
    for (; bloecke < 2250; s += 256, ++bloecke) {
      const bool zaehlen = bloecke >= 250;   // warm-up: first use of every code path, thread-local counters, caches
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      if (zaehlen) abfang_an();
      for (int n = 0; n < 32; ++n)
        for (int band = 0; band < 3; ++band) {
          const int phase = (bloecke / 40 + n) % 4;   // every 4th stretch of 40 blocks is neutral on a track
          for (int i = 0; i < 256; ++i) {
            const double w = std::sin(0.0007 * static_cast<double>(s + i) * (1 + (n + band) % 5));
            vl[i] = phase == 3 ? 0.0f : (n + band) % 7 == 0 && w < -0.9 ? -200.0f : static_cast<float>(-20.0 * (w * 0.5 + 0.5) + 3.0 * w);
          }
          t.arr.verlauf(rz[n][band], vl);
        }
      t.arr.block(t.k, s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      if (zaehlen) {
        abfang_aus();
        const AbfangZahlen z = abfang_zahlen();
        alloc += z.alloc;
        summe += z.summe();
        ++gezaehlt;
      }
    }
#if ALLOC_ABFANG_VERFUEGBAR
    std::printf("7: %d counted blocks, allocations %ld, all counters %ld\n", gezaehlt, alloc, summe);
    PRUEF(gezaehlt == 2000 && alloc == 0 && summe == 0);
#else
    std::printf("7: skipped (sanitizer build, no allocation hook)\n");
#endif
    abfang_an();   // positive control: the hook counts a malloc
    void* p = std::malloc(16);
    const long positiv = abfang_aus();
    std::free(p);
#if ALLOC_ABFANG_VERFUEGBAR
    PRUEF(positiv >= 1);
#else
    (void)positiv;
#endif
  }

  // 8 wall time of one running isolator per 1024-sample block, 2000 blocks (printed for the report, not asserted)
  {
    cypherdj::dsp::Isolator iso;
    static float in_l[1024], in_r[1024], out_l[1024], out_r[1024], g[3][1024];
    for (int i = 0; i < 1024; ++i) {
      in_l[i] = in_r[i] = 0.3f * std::sin(0.05f * static_cast<float>(i)) + 0.2f * std::sin(0.9f * static_cast<float>(i));
      for (auto& x : g) x[i] = 0.7f;
    }
    for (int w = 0; w < 200; ++w) iso.verarbeite(in_l, in_r, out_l, out_r, 1024, g[0], g[1], g[2]);   // warm-up
    const auto t0 = std::chrono::steady_clock::now();
    for (int w = 0; w < 2000; ++w) iso.verarbeite(in_l, in_r, out_l, out_r, 1024, g[0], g[1], g[2]);
    const auto t1 = std::chrono::steady_clock::now();
    const double us = std::chrono::duration<double, std::micro>(t1 - t0).count() / 2000.0;
    std::printf("8: one running isolator: %.1f us per 1024-sample block (2000 blocks)\n", us);
    PRUEF(out_l[0] == out_l[0]);   // keep the result alive
  }
  std::printf("2: summary: band attenuation tief %.1f dB, mitte %.1f dB, hoch %.1f dB; largest off-band deviation %.3f / %.3f / %.3f dB\n", daempfung[0], daempfung[1], daempfung[2], neben_max[0], neben_max[1], neben_max[2]);
  PRUEF_ENDE();
}
