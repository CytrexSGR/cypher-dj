// Loop deck K7b: the DJ filter of an arrangement track (row spur/<n>/filter, field ARR_F_FILTER, one DjFilter per track in Arrangement::mischen, behind the insert chain and the
// delay compensation, in front of the monitor join and the fader loop).
// Cases: 1 neutral (k = 0 is bit-equal to a run that never touches the filter, also after the filter ran at k = -1 and came back, and with a per-sample course of zeros that
// forces the filter code through its state update), 2 -1 (low-pass: 10 kHz drops by more than 20 dB, 30 Hz stays within 1 dB; the cutoff at -1 is 60 Hz) and +1 (high-pass at
// 8 kHz: 100 Hz drops by more than 20 dB, 16 kHz stays within 1 dB), 3 a move from 0 to -1 inside a block, delivered as the Stellwerk does (a 10 ms ramp): no sample-to-sample
// jump above the bound, 4 no allocation, no blocking lock, no sleep in the block, with the filter moving on every track, 5 the filter of one track does not touch another track,
// 6 a track that gets another identity in a snapshot swap starts with an empty filter, 7 the Q of the track filters follows setze_filter_guete (kern.toml filter_guete):
// a 60 Hz sine at the 60 Hz cutoff of -1 comes out much louder at Q 4 than at the default.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "arr_build.h"
#include "cypherdj/arrangement.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

using namespace arrtest;
using cdj::ArrArt;

static constexpr int64_t V = 537;
static constexpr int64_t FRAMES = 200000;
#define TR(n) auto n##_p = std::make_unique<Treiber>(); Treiber& n = *n##_p;

static int reg(Treiber& t, const std::string& pfad) {
  const int r = t.tab.suche(pfad.c_str());
  if (r < 0) std::fprintf(stderr, "no row %s\n", pfad.c_str());
  PRUEF(r >= 0);
  return r;
}
// tracks 1..n, one sine clip each (8 beats), the same signal on every track
static cdj::ArrSnapshot* snap(const cdj::ArrAudio* a, int n_spuren, int64_t nr = 1, uint64_t kennung0 = 0) {
  Bau b(nr);
  for (int sp = 1; sp <= n_spuren; ++sp) {
    const std::string id = "c" + std::to_string(sp);
    b.spur(sp, ArrArt::audio).clip(sp, id.c_str(), 0.0, 8.0, a);
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
static double db(double v, double ref) { return 20.0 * std::log10(std::max(v, 1e-12) / ref); }
static double max_sprung(const std::vector<float>& x, int64_t von, int64_t bis) {
  double m = 0.0;
  for (int64_t i = von + 1; i < bis; ++i) m = std::max(m, static_cast<double>(std::fabs(x[i] - x[i - 1])));
  return m;
}

int main() {
  const auto s100 = Audio::sinus(FRAMES, 100.0, 0.5f);
  const auto s30 = Audio::sinus(FRAMES, 30.0, 0.5f);
  const auto s1k = Audio::sinus(FRAMES, 1000.0, 0.5f);
  const auto s10k = Audio::sinus(FRAMES, 10000.0, 0.5f);
  const auto s16k = Audio::sinus(FRAMES, 16000.0, 0.5f);
  const int64_t BIS = 90000, VON = 60000;   // measuring window; the 2 beat count-in (about 45000 samples at 128 bpm) is over long before

  // 1 neutral
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 1), BIS);
    PRUEF(rms(ref.l, VON, BIS) > 0.1);   // the reference really plays

    TR(nullzeile)   // row set to 0 explicitly: the same as never touched
    nullzeile.arr.setze_sofort(reg(nullzeile, "spur/1/filter"), 0.0f);
    spiele(nullzeile, snap(&s1k->a, 1), BIS);
    PRUEF(gleich(ref.l, nullzeile.l) && gleich(ref.r, nullzeile.r));

    TR(vl0)   // a per-sample course of zeros: the track runs through the filter code (the skip needs a leer() filter) and must still be bit-equal
    const int r = reg(vl0, "spur/1/filter");
    static float nullen[256] = {};
    vl0.laden(snap(&s1k->a, 1));
    vl0.arr.start(0.0, 0, false, 0, V, 256, vl0.k);
    vl0.vor_block = [&](int64_t) { vl0.arr.verlauf(r, nullen); };
    vl0.lauf(BIS);
    PRUEF(gleich(ref.l, vl0.l) && gleich(ref.r, vl0.r));

    TR(zurueck)   // -1 for a while, then exactly 0 again: dry is exact at nass = 0, whatever the filter states hold
    const int rz = reg(zurueck, "spur/1/filter");
    zurueck.laden(snap(&s1k->a, 1));
    zurueck.arr.start(0.0, 0, false, 0, V, 256, zurueck.k);
    static float minus[256], null_[256] = {};
    std::fill(minus, minus + 256, -1.0f);
    zurueck.vor_block = [&](int64_t s) { zurueck.arr.verlauf(rz, s < 66000 ? minus : null_); };
    zurueck.lauf(BIS);
    PRUEF(!gleich(ref.l, zurueck.l));   // the filter did act while it was at -1
    const int64_t NACH = 66100;   // the first block at 0 starts at 66048
    const std::vector<float> a(ref.l.begin() + NACH, ref.l.begin() + BIS), b(zurueck.l.begin() + NACH, zurueck.l.begin() + BIS);
    PRUEF(gleich(a, b));
  }

  // 2 frequency response at -1 and +1, relative to the run at 0
  struct Fall { const Audio* au; float k; bool sperre; const char* text; };
  const Fall faelle[] = {
      {s10k.get(), -1.0f, true, "-1, 10 kHz"}, {s30.get(), -1.0f, false, "-1, 30 Hz"},
      {s100.get(), 1.0f, true, "+1, 100 Hz"}, {s16k.get(), 1.0f, false, "+1, 16 kHz"}};
  for (const Fall& f : faelle) {
    TR(ref)
    spiele(ref, snap(&f.au->a, 1), BIS);
    TR(t)
    t.arr.setze_sofort(reg(t, "spur/1/filter"), f.k);
    spiele(t, snap(&f.au->a, 1), BIS);
    const double d = db(rms(t.l, VON, BIS), rms(ref.l, VON, BIS));
    std::printf("2: %s: %.2f dB\n", f.text, d);
    if (f.sperre) PRUEF(d < -20.0);
    else PRUEF(d > -1.0 && d < 0.5);
  }

  // 3 a 0 -> -1 move inside a block as a 10 ms ramp (480 samples), the way the Stellwerk delivers a ramped row
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 1), BIS);
    TR(t)
    const int r = reg(t, "spur/1/filter");
    t.laden(snap(&s1k->a, 1));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    static float verlauf_[256];
    const int64_t BLOCK0 = 70000 + 64;   // the ramp starts mid-block and runs over three blocks
    int64_t pos = 0;
    t.vor_block = [&](int64_t s) {
      for (int i = 0; i < 256; ++i) {
        const int64_t q = s + i - BLOCK0;
        verlauf_[i] = q < 0 ? 0.0f : q >= 480 ? -1.0f : -static_cast<float>(q) / 480.0f;
      }
      t.arr.verlauf(r, verlauf_);
      pos = s;
    };
    t.lauf(BIS);
    (void)pos;
    const double j_ref = max_sprung(ref.l, 50000, BIS), j = max_sprung(t.l, 50000, BIS);
    std::printf("3: largest step %.4f (unfiltered signal %.4f)\n", j, j_ref);
    PRUEF(j <= j_ref * 1.05 + 1e-4);   // the filter only removes energy: the ramp adds no step above what the 1 kHz sine has itself
    PRUEF(rms(t.l, BIS - 8000, BIS) < 0.01 * rms(ref.l, BIS - 8000, BIS) + 1e-9 || db(rms(t.l, BIS - 8000, BIS), rms(ref.l, BIS - 8000, BIS)) < -20.0);   // and it arrived at -1
  }

  // 4 no allocation, no lock, no sleep with the filter moving on all 32 tracks
  {
    TR(t)
    t.laden(snap(&s1k->a, 32));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    int rz[32];
    for (int n = 1; n <= 32; ++n) rz[n - 1] = reg(t, "spur/" + std::to_string(n) + "/filter");
    float vl[256], b[6][cdj::ARR_BLOCK];
    int64_t s = 0;
    long alloc = 0, summe = 0;
    int bloecke = 0;
    for (; s < 90000; s += 256, ++bloecke) {
      const bool zaehlen = bloecke >= 250;   // the first 250 blocks (64000 samples, past the count-in and the first clip block) are warm-up: first use of every code path, thread-local counters, caches
      for (auto& x : b) std::fill(x, x + 256, 0.0f);
      if (zaehlen) abfang_an();
      for (int n = 0; n < 32; ++n) {
        for (int i = 0; i < 256; ++i) vl[i] = std::sin(0.0004 * static_cast<double>(s + i) * (1 + n % 5)) * (n % 2 ? 1.0f : -1.0f);
        t.arr.verlauf(rz[n], vl);
      }
      t.arr.block(t.k, s, 256, b[0], b[1], b[2], b[3], b[4], b[5]);
      if (zaehlen) {
        abfang_aus();
        const AbfangZahlen z = abfang_zahlen();
        alloc += z.alloc;
        summe += z.summe();
      }
    }
#if ALLOC_ABFANG_VERFUEGBAR
    std::printf("4: allocations %ld, all counters %ld\n", alloc, summe);
    PRUEF(alloc == 0 && summe == 0);
#else
    std::printf("4: skipped (sanitizer build, no allocation hook)\n");
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

  // 5 a move on track 2 leaves track 1 and track 3 as they are (the three tracks carry the same signal; panned apart so that the master sum tells nothing: use the bus peaks)
  {
    TR(ref)
    spiele(ref, snap(&s1k->a, 3), BIS);
    TR(t)
    t.arr.setze_sofort(reg(t, "spur/2/filter"), -1.0f);
    spiele(t, snap(&s1k->a, 3), BIS);
    // track 2 is filtered away (1 kHz at a 60 Hz cutoff): the sum is the two other tracks, i.e. 2/3 of the reference amplitude
    const double v = rms(t.l, VON, BIS) / rms(ref.l, VON, BIS);
    std::printf("5: sum ratio %.4f\n", v);
    PRUEF(v > 0.64 && v < 0.69);
  }

  // 6 identity: a swap that puts another track id on index 0 clears the filter (a filter state of the old track must not leak)
  {
    TR(t)
    t.arr.setze_sofort(reg(t, "spur/1/filter"), -1.0f);
    t.laden(snap(&s1k->a, 1, 1, 111));
    t.arr.start(0.0, 0, false, 0, V, 256, t.k);
    t.lauf(70000);
    PRUEF(t.arr.filter_leer(0) == false);   // the filter ran and holds state
    t.arr.setze_sofort(reg(t, "spur/1/filter"), 0.0f);
    t.laden(snap(&s1k->a, 1, 2, 111));   // same id: the state stays
    PRUEF(t.arr.filter_leer(0) == false);
    t.laden(snap(&s1k->a, 1, 3, 222));   // another id: cleared
    PRUEF(t.arr.filter_leer(0) == true);
  }

  // 7 the config Q reaches the track filters: at -1 the low-pass cutoff is 60 Hz, a sine there is boosted by about Q (4 against 0.707: 15 dB)
  {
    const auto s60 = Audio::sinus(FRAMES, 60.0, 0.25f);
    TR(a)
    a.arr.setze_sofort(reg(a, "spur/1/filter"), -1.0f);
    spiele(a, snap(&s60->a, 1), BIS);
    TR(b)
    b.arr.setze_filter_guete(4.0);
    b.arr.setze_sofort(reg(b, "spur/1/filter"), -1.0f);
    spiele(b, snap(&s60->a, 1), BIS);
    const double v = db(rms(b.l, VON, BIS), rms(a.l, VON, BIS));
    std::printf("7: Q 4 against the default at the cutoff: %.1f dB\n", v);
    PRUEF(v > 9.0);
  }
  PRUEF_ENDE();
}
