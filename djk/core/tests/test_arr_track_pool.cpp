// Mehrkern slice 3.2, task 5: phase Q (the track sources) on the Hall pool, through Arrangement::block.
// Every test that expects a fork builds its pool with setze_fifo_test(true) and asserts the positive counters, so a run that stayed serial fails
// instead of passing empty. The first unit of lane 0 waits (SpurHaken) until every worker computed a unit, so no assertion depends on a race.
//   1 q_bitgleich:           24 rb + 2 bk + 1 host track, 3 workers, 5000 blocks: every bus and the master equal the serial arrangement; every lane 1..3 computed
//                            units (a worker that always used lane 1 fails: the probe bug as a test)
//   2 q_nie_gestartet:       all workers held before they wake: the caller takes every job back and computes every unit; equal; zurueck(SPUR) counts, spaet(SPUR) 0
//   3 q_subnormal:           the units run under the caller's MXCSR (scalar part after the FFI block of the real sink): a subnormal result survives on a worker
//   4 q_n_weg:               a block with a fading sink runs serial (seriell_weg), equal; the next block forks again
//   5 q_wenig:               3 live units run serial, 4 fork; with the threshold above the load nothing forks
//   6 q_fifo_fehlt:          a pool that is not FIFO never forks (seriell_fifo), equal
//   7 q_tausch:              swaps under a running pool (track added, removed, parameter only, device change): equal, no unit twice, nothing claimed at a block start,
//                            the parameter-only swap keeps forking (also run under ASan: no use of a freed sink)
//   8 q_aus_zur_laufzeit:    mode aus at runtime is serial, an again forks; another pool with fewer workers rebuilds the plan with the new lane count
//   9 q_keine_allokation:    no allocation on the caller and on every worker in 1000 blocks; positive control: a sink that allocates is counted on a worker
//  10 q_haken:               a worker held inside a unit: the caller waits at the join (never abandons the job), the output stays equal
//  11 q_haken_haengt_in_einheit:   a worker held inside a unit: the caller finishes everything else, waits at the join (the block is not complete), the hard limit counts spur_haengt,
//                                   after the release the output is equal, the next block has the track account off and the Hall account on
//  12 q_gestartet_ohne_einheit:     a worker held right after it took its job: the join waits (the fake clock moves 200 us), a late event; five such blocks switch SPUR off, the Halls go on
//  13 q_warte_langsam:              a unit that takes long on a worker: one late event per block, four do not switch off, the fifth does; phase H still computes on workers
//  14 q_arbeiter_langsam:           a worker that misses its deadline before it starts: the take-back counts late for SPUR only; four do not switch off, the fifth does
//  15 q_spaet_start:                the fake clock puts the sub-block start 60 percent into the period: serial; unknown start and 40 percent fork; the period comes from m
//  16 q_zyklus_zeit:                in test_core_track_time.cpp (needs the Kern)
//  17 q_grenze:                     the hard limit: counts with the override, switches SPUR off for the next block; the product limit counts nothing in the same run
//  18 q_ausfall_schaltet_spur_nicht_halls_ab:  24 rb tracks, four Halls: SPUR switched off by five late events, the output equals the serial one, the Halls keep their workers
//  19 q_auto:                       mode auto retries once after 4096 blocks, the second switch-off is for good; mode an never retries
//  21 q_grenze_ab_zyklusstart:      the product hard limit counts from the cycle stamp (40 percent in), not from the entry into the phase: a job held past it is a hang
//  22 q_warte_nach_eigener_arbeit:  the caller's own work (the lane-0 hook moves the clock 300 us per unit) is no join wait: no late event, the phase stays on
//  23 q_zyklusteilung:              the limit and the gate for a sub-block that starts ahead of the cycle stamp (sub-block 1 of a split cycle): on time, the limit counts from its nominal start
//  20 q_live:                       the load threshold counts units the sink computes: muted tracks and solo of one track still count live and fork, an empty unit does not
// Mutations: SPUR_GRENZE_AB_LAUF (limit from the entry) must turn case 21 red; SPUR_WARTE_AB_LAUF (join wait from the entry) must turn case 22 red.
// Mutations: SPUR_LIVE_NACH_GAIN (the old mute criterion) must turn case 20 red.
// Mutations: SPUR_OHNE_JOIN (the caller does not wait for started jobs) must turn case 11 red; SPUR_AUTO_IMMER_NEU (the retry after every switch-off) must turn case 19 red.
// Mutations: SPUR_ALLE_BAHN_1 (every worker uses lane 1) must turn case 1 red; SPUR_OHNE_MXCSR (no MXCSR hand-over) must turn case 3 red;
//            SPUR_PROTOKOLL_GEMEINSAM (every lane writes log ring 0) must turn case 1 red (the first block's 96 log entries do not fit one ring; under TSan the shared slot is a data race).
#include <time.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "arr_build.h"
#include "bk_help.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "cypherdj/reverb_pool.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives (one translation unit per program)

namespace cdj {
struct ArrRbPruefZugang {   // friend of ArrRbSenke: the set log (read here only between blocks, on the driving thread, after the pool join)
  static uint64_t n(const ArrRbSenke& s) { return s.protokoll_n_.load(); }
  static bool eintrag(const ArrRbSenke& s, uint64_t i, int& spur, std::string& name, float& wert) {
    const ArrRbSenke::Protokoll* e = s.protokoll_lies(i);
    if (!e) return false;
    spur = e->spur;
    name = e->name;
    wert = e->wert;
    return true;
  }
};
}  // namespace cdj

using namespace arrtest;
using cdj::ArrArt;

namespace {

constexpr int M = 256;

// ---- test sinks (wirt slot 1): lane-capable, so they sit in the lane lists next to the rb tracks
struct LeerSenke : cdj::ArrSenke {
  int64_t vorhalt() const noexcept override { return 0; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override {}
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int, float*, float*) noexcept override {}
  bool parallel_faehig(int) const noexcept override { return true; }
};

// the scalar part that the real sinks run without DenormalSchutz: y = x * 0.5 with x just above the smallest normal (read from a volatile: no folding, no fast-math)
struct SubnormalSenke : LeerSenke {
  volatile float x = 1e-38f;
  std::atomic<int> bahn_von[cdj::ARR_SPUREN];
  SubnormalSenke() {
    for (auto& b : bahn_von) b.store(-1);
  }
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override {
    cdj::ArrArbeit a;
    block_bahn(spur, s0, m, l, r, a);
  }
  void block_bahn(int spur, int64_t, int m, float* l, float* r, cdj::ArrArbeit& a) noexcept override {
    const float y = x * 0.5f;
    for (int i = 0; i < m; ++i) {
      l[i] += y;
      r[i] += y;
    }
    bahn_von[spur].store(a.bahn);
  }
};

// counts every call per track (one call per track and block is the claim of the scheduler)
struct ZaehlSenke : LeerSenke {
  int n[cdj::ARR_SPUREN] = {};
  void block(int spur, int64_t, int m, float* l, float*) noexcept override {
    ++n[spur];
    for (int i = 0; i < m; ++i) l[i] += 1e-3f;
  }
};

void* (*volatile g_malloc)(size_t) = std::malloc;
void (*volatile g_free)(void*) = std::free;
struct AllocSenke : LeerSenke {
  void block(int, int64_t, int, float*, float*) noexcept override { g_free(g_malloc(64)); }
};

cdj::ArrSnapshot* snap(int64_t nr, int n_rb, int n_bk, CypherBk* const* hs, int variante, int n_wirt) {
  Bau b(nr);
  for (int i = 0; i < n_rb; ++i) b.spur(i + 1, ArrArt::intern);
  for (int i = 0; i < n_bk; ++i) b.spur(n_rb + i + 1, ArrArt::intern);
  for (int i = 0; i < n_wirt; ++i) b.spur(n_rb + n_bk + i + 1, ArrArt::wirt, 1);
  cdj::ArrSnapshot* s = b.fertig();
  for (int i = 0; i < n_rb; ++i) {
    cdj::ArrSpur& sp = s->spur[i];
    std::snprintf(sp.geraet, sizeof sp.geraet, "rb338");
    auto p = [&](const char* name, float w) {
      std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", name);
      sp.param[sp.n_param++].wert = w;
    };
    p("cutoff", 0.15f + 0.03f * static_cast<float>(i % 20) + 0.03f * static_cast<float>(variante));
    p("resonanz", 0.2f + 0.05f * static_cast<float>(i % 4));
    p("decay", 0.3f + 0.02f * static_cast<float>(i % 20));
  }
  for (int i = 0; i < n_bk; ++i) bkt::spur(s, n_rb + i + 1, hs[i], 1, {{"k1", 0.7f - 0.1f * static_cast<float>(i)}});
  return s;
}

struct Welt {
  Treiber t;
  cdj::ArrRbSenke rb{t.arr};
  cdj::ArrBkSenke bk{t.arr};
  cdj::ArrInternSenke intern{t.arr, &rb, &bk, nullptr};
  PruefSenke host;
  float out[6][cdj::ARR_BLOCK] = {};
  explicit Welt(cdj::ArrSenke* wirt = nullptr) {
    t.arr.setze_senke_intern(&intern);
    t.arr.setze_senke_wirt(1, wirt ? wirt : &host);
  }
  void laden(cdj::ArrSnapshot* s, int64_t s0) {
    t.s = s0;
    t.laden(s);
  }
  void block(int64_t s0, int m = M) {
    for (auto& x : out) std::fill(x, x + cdj::ARR_BLOCK, 0.0f);
    t.arr.block(t.k, s0, m, out[0], out[1], out[2], out[3], out[4], out[5]);
  }
};

struct Pool {
  cdj::HallPool p;
  static cdj::HallPoolEinstellung einst(int faeden) {
    cdj::HallPoolEinstellung e;
    e.faeden = faeden;
    e.frist_us = 1000000;   // no late event from SCHED_OTHER wake jitter
    e.bloecke_us = 5333;
    return e;
  }
  explicit Pool(int faeden, bool fifo = true) : p(einst(faeden)) { p.setze_fifo_test(fifo); }
};

void speise(cdj::ArrSenke& s, int spur, int b, int64_t s0) {
  if (b == 0) s.transport_start(spur, s0);
  const int ph = b % 11;
  const uint8_t ton = static_cast<uint8_t>(33 + spur * 3 + (b / 11) % 5);
  if (ph == 0) s.note(spur, s0 + (b * 7 + spur * 13) % M, ton, static_cast<uint8_t>(90 + spur), true);
  if (ph == 6) s.note(spur, s0 + (b * 5 + spur * 3) % M, ton, 0, false);
}

// The time gates of task 6 run on the real clock: a SCHED_OTHER worker that loses the CPU for a millisecond would trip the hard limit or the join-wait signal and
// switch the track phase off in the middle of a test that is about something else. Those cases turn both off (10 s); the failure cases set their own.
cdj::SpurTest kein_tor(int min_last = 0) {
  cdj::SpurTest t;
  t.min_last = min_last;
  t.grenze_ns = 10'000'000'000LL;
  t.warte_spaet_ns = 10'000'000'000LL;
  return t;
}

bool bit_gleich(const float* a, const float* b, int n) { return std::memcmp(a, b, sizeof(float) * static_cast<size_t>(n)) == 0; }

// every bus and the master out of the two worlds, bit for bit; returns the number of differing buffers
int vergleiche(const Welt& a, const Welt& ref) {
  int ungleich = 0;
  for (int i = 0; i < cdj::ARR_SPUREN; ++i)
    if (!bit_gleich(a.t.arr.spur_bus_l(i), ref.t.arr.spur_bus_l(i), M) || !bit_gleich(a.t.arr.spur_bus_r(i), ref.t.arr.spur_bus_r(i), M)) ++ungleich;
  for (int o = 0; o < 6; ++o)
    if (!bit_gleich(a.out[o], ref.out[o], M)) ++ungleich;
  return ungleich;
}

double energie(const float* x, int n) {
  double e = 0.0;
  for (int i = 0; i < n; ++i) e += static_cast<double>(x[i]) * x[i];
  return e;
}

// 1: bit-equal, every lane computes
void fall1() {
  CypherBk* h[2] = {bkt::neu(bkt::G_T), bkt::neu(bkt::G_T)};
  CypherBk* h2[2] = {bkt::neu(bkt::G_T), bkt::neu(bkt::G_T)};
  {
    Pool pool(3);
    Welt a, ref;
    a.t.arr.setze_hall_pool(&pool.p);
    a.t.arr.setze_spur_pool(1);
    a.t.arr.setze_spur_test(kein_tor());
    cdj::SpurHaken hk;
    hk.warte_worker = 3;
    a.t.arr.setze_spur_haken(&hk);
    a.laden(snap(1, 24, 2, h, 0, 1), 0);
    ref.laden(snap(1, 24, 2, h2, 0, 1), 0);
    int ungleich = 0;
    double e_rb = 0.0, e_bk = 0.0, e_host = 0.0;
    for (int b = 0; b < 5000; ++b) {
      const int64_t s0 = static_cast<int64_t>(b) * M;
      for (int i = 0; i < 26; ++i) {
        speise(a.intern, i, b, s0);
        speise(ref.intern, i, b, s0);
      }
      a.host.note(26, s0 + (b * 3) % M, 60, 100, b % 5 == 0);
      ref.host.note(26, s0 + (b * 3) % M, 60, 100, b % 5 == 0);
      a.host.block_s0 = ref.host.block_s0 = s0;
      a.block(s0);
      ref.block(s0);
      ungleich += vergleiche(a, ref);
      for (int i = 0; i < 24; ++i) e_rb += energie(a.t.arr.spur_bus_l(i), M);
      e_bk += energie(a.t.arr.spur_bus_l(24), M) + energie(a.t.arr.spur_bus_l(25), M);
      e_host += energie(a.t.arr.spur_bus_l(26), M);
      if (b == 0) {   // the set log of the first block (24 tracks x 4 entries on four lanes, more than one ring holds): every entry is in its lane's ring
        const uint64_t n_a = cdj::ArrRbPruefZugang::n(a.rb);
        std::vector<std::string> namen[24];
        bool alle_da = true;
        for (uint64_t i = 0; i < n_a; ++i) {
          int sp = 0;
          std::string nm;
          float w = 0.0f;
          if (!cdj::ArrRbPruefZugang::eintrag(a.rb, i, sp, nm, w)) alle_da = false;
          else if (sp >= 0 && sp < 24) namen[sp].push_back(nm);
        }
        PRUEF(n_a == 24 * 4);
        PRUEF(alle_da);   // with one shared ring only 64 of the 96 entries would be left
        bool je_spur = true;
        for (auto& v : namen) {
          std::sort(v.begin(), v.end());
          je_spur = je_spur && v == std::vector<std::string>{"<vorgaben>", "cutoff", "decay", "resonanz"};
        }
        PRUEF(je_spur);   // every track logged its four entries exactly once
      }
      if (b == 1) {   // every worker must have computed by now (the seam forces it); if not, stop at once: the rest of the run would wait out the seam cap in every block
        bool alle = true;
        for (int l = 1; l < 4; ++l) alle = alle && a.t.arr.spur_lauf().einheiten_bahn(l) >= 1;
        if (!alle) {
          PRUEF(alle);
          break;
        }
      }
    }
    const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
    PRUEF(ungleich == 0);
    PRUEF(e_rb > 0.0 && e_bk > 0.0 && e_host > 0.0);   // not silence: equality means something
    PRUEF(sl.z.blocks_parallel == 5000);
    PRUEF(sl.einheiten_worker() > 0);
    for (int b = 1; b < 4; ++b) {
      PRUEF(sl.einheiten_bahn(b) >= 1);                      // the scheduler count of lane b
      PRUEF(a.t.arr.spur_arbeit(b).einheiten >= 1);          // the sink count on the lane struct of lane b (units of the real sink on that lane)
    }
    PRUEF(sl.z.unfertig == 0);
    PRUEF(pool.p.an(cdj::HallPool::SPUR));
    std::printf("case 1 q_bitgleich: ungleich=%d parallel=%llu worker=%llu caller=%llu lanes=%llu,%llu,%llu,%llu\n", ungleich, (unsigned long long)sl.z.blocks_parallel,
                (unsigned long long)sl.einheiten_worker(), (unsigned long long)sl.z.einheiten_caller, (unsigned long long)sl.einheiten_bahn(0),
                (unsigned long long)sl.einheiten_bahn(1), (unsigned long long)sl.einheiten_bahn(2), (unsigned long long)sl.einheiten_bahn(3));
  }
  for (CypherBk* x : h) cypher_bk_frei(x);
  for (CypherBk* x : h2) cypher_bk_frei(x);
}

// 2: no worker ever starts: the caller takes everything back
void fall2() {
  Pool pool(3);
  pool.p.anhalten(true);
  Welt a, ref;
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  a.laden(snap(1, 12, 0, nullptr, 0, 0), 0);
  ref.laden(snap(1, 12, 0, nullptr, 0, 0), 0);
  int ungleich = 0;
  uint64_t zurueck_nach_1 = 0;
  for (int b = 0; b < 200; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    for (int i = 0; i < 12; ++i) {
      speise(a.intern, i, b, s0);
      speise(ref.intern, i, b, s0);
    }
    a.block(s0);
    ref.block(s0);
    ungleich += vergleiche(a, ref);
    if (b == 0) zurueck_nach_1 = pool.p.zurueck(cdj::HallPool::SPUR);
  }
  PRUEF(ungleich == 0);
  PRUEF(zurueck_nach_1 == 3);
  PRUEF(pool.p.zurueck(cdj::HallPool::SPUR) == 600);
  PRUEF(pool.p.spaet(cdj::HallPool::SPUR) == 0);   // the take-back of an unstarted job is not late
  PRUEF(pool.p.an(cdj::HallPool::SPUR));
  PRUEF(a.t.arr.spur_lauf().einheiten_worker() == 0);
  PRUEF(a.t.arr.spur_lauf().z.blocks_parallel == 0);
  PRUEF(a.t.arr.spur_lauf().z.einheiten_caller == 200 * 12);   // every unit was computed by the caller
  pool.p.anhalten(false);
  std::printf("case 2 q_nie_gestartet: ungleich=%d zurueck=%llu spaet=%llu\n", ungleich, (unsigned long long)pool.p.zurueck(cdj::HallPool::SPUR),
              (unsigned long long)pool.p.spaet(cdj::HallPool::SPUR));
}

// 3: the caller's MXCSR reaches the workers
void fall3() {
#if defined(__x86_64__) || defined(__i386__)
  _mm_setcsr(0x1f80);   // the callback's own state: no FTZ, no DAZ
#endif
  Pool pool(3);
  SubnormalSenke sub, sub_ref;
  Welt a(&sub), ref(&sub_ref);
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 0, 0, nullptr, 0, 8), 0);
  ref.laden(snap(1, 0, 0, nullptr, 0, 8), 0);
  int ungleich = 0, nullen = 0;
  for (int b = 0; b < 50; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    a.block(s0);
    ref.block(s0);
    ungleich += vergleiche(a, ref);
    for (int i = 0; i < 8; ++i)
      if (ref.t.arr.spur_bus_l(i)[0] == 0.0f) ++nullen;   // the serial result must be the subnormal, not zero
  }
  int auf_worker = 0;
  for (int i = 0; i < 8; ++i) auf_worker += sub.bahn_von[i].load() >= 1 ? 1 : 0;
  PRUEF(nullen == 0);
  PRUEF(ungleich == 0);
  PRUEF(auf_worker >= 1);                          // without this the mutation could stay green: the caller computed everything
  PRUEF(a.t.arr.spur_lauf().einheiten_worker() > 0);
  PRUEF(a.t.arr.spur_bus_l(0)[0] != 0.0f);
  std::printf("case 3 q_subnormal: ungleich=%d nullen_seriell=%d auf_worker=%d (serial value %g)\n", ungleich, nullen, auf_worker, static_cast<double>(ref.t.arr.spur_bus_l(0)[0]));
}

// 4: n_weg_
void fall4() {
  Pool pool(3);
  Welt a, ref;
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 8, 0, nullptr, 0, 0), 0);
  ref.laden(snap(1, 8, 0, nullptr, 0, 0), 0);
  int b = 0, ungleich = 0;
  auto lauf = [&](int n) {
    for (int k = 0; k < n; ++k, ++b) {
      const int64_t s0 = static_cast<int64_t>(b) * M;
      for (int i = 0; i < 8; ++i) {
        speise(a.intern, i, b, s0);
        speise(ref.intern, i, b, s0);
      }
      a.block(s0);
      ref.block(s0);
      ungleich += vergleiche(a, ref);
    }
  };
  lauf(10);
  const uint64_t par0 = a.t.arr.spur_lauf().z.blocks_parallel;
  PRUEF(par0 == 10);
  // a sounding track (3) leaves the playback
  const int64_t s_b = static_cast<int64_t>(b) * M;
  a.intern.note(3, s_b + 1, 50, 110, true);
  ref.intern.note(3, s_b + 1, 50, 110, true);
  a.block(s_b);
  ref.block(s_b);
  ++b;
  ungleich += vergleiche(a, ref);
  auto ohne3 = [&](int64_t nr) {
    Bau bb(nr);
    for (int i = 0; i < 8; ++i)
      if (i != 3) bb.spur(i + 1, ArrArt::intern);
    cdj::ArrSnapshot* s = bb.fertig();
    for (int i = 0; i < 8; ++i)
      if (i != 3) std::snprintf(s->spur[i].geraet, sizeof s->spur[i].geraet, "rb338");
    return s;
  };
  const int64_t s1 = static_cast<int64_t>(b) * M;
  a.laden(ohne3(2), s1);
  ref.laden(ohne3(2), s1);
  const uint64_t weg0 = a.t.arr.spur_lauf().z.seriell_weg;
  a.block(s1);
  ref.block(s1);
  ++b;
  ungleich += vergleiche(a, ref);
  PRUEF(a.t.arr.spur_lauf().z.seriell_weg == weg0 + 1);
  PRUEF(a.t.arr.spur_lauf().z.blocks_parallel == par0 + 1);   // the 11th (before the swap) forked, the fading block did not
  const uint64_t par1 = a.t.arr.spur_lauf().z.blocks_parallel;
  lauf(5);
  PRUEF(a.t.arr.spur_lauf().z.blocks_parallel == par1 + 5);   // parallel again
  PRUEF(ungleich == 0);
  std::printf("case 4 q_n_weg: ungleich=%d seriell_weg=%llu parallel=%llu\n", ungleich, (unsigned long long)a.t.arr.spur_lauf().z.seriell_weg,
              (unsigned long long)a.t.arr.spur_lauf().z.blocks_parallel);
}

// 5: the load threshold
void fall5() {
  Pool pool(3);
  for (int n : {3, 4}) {
    Welt a, ref;
    a.t.arr.setze_hall_pool(&pool.p);
    a.t.arr.setze_spur_pool(1);
    a.t.arr.setze_spur_test(kein_tor(4 * M));
    cdj::SpurHaken hk;
    hk.warte_worker = 3;
    a.t.arr.setze_spur_haken(&hk);
    a.laden(snap(1, n, 0, nullptr, 0, 0), 0);
    ref.laden(snap(1, n, 0, nullptr, 0, 0), 0);
    int ungleich = 0;
    for (int b = 0; b < 20; ++b) {
      const int64_t s0 = static_cast<int64_t>(b) * M;
      for (int i = 0; i < n; ++i) {
        speise(a.intern, i, b, s0);
        speise(ref.intern, i, b, s0);
      }
      a.block(s0);
      ref.block(s0);
      ungleich += vergleiche(a, ref);
    }
    const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
    PRUEF(ungleich == 0);
    if (n == 3) {
      PRUEF(sl.z.seriell_wenig == 20);
      PRUEF(sl.z.blocks_parallel == 0 && sl.einheiten_worker() == 0);
    } else {
      PRUEF(sl.z.seriell_wenig == 0);
      PRUEF(sl.z.blocks_parallel == 20 && sl.einheiten_worker() > 0);
      a.t.arr.setze_spur_test(kein_tor(5 * M));   // above the load: nothing forks (the lane's `unbenutzt` control)
      const uint64_t par = sl.z.blocks_parallel;
      for (int b = 20; b < 30; ++b) {
        const int64_t s0 = static_cast<int64_t>(b) * M;
        for (int i = 0; i < n; ++i) {
          speise(a.intern, i, b, s0);
          speise(ref.intern, i, b, s0);
        }
        a.block(s0);
        ref.block(s0);
        ungleich += vergleiche(a, ref);
      }
      PRUEF(ungleich == 0);
      PRUEF(sl.z.blocks_parallel == par && sl.z.seriell_wenig == 10);
    }
    std::printf("case 5 q_wenig n=%d: wenig=%llu parallel=%llu\n", n, (unsigned long long)sl.z.seriell_wenig, (unsigned long long)sl.z.blocks_parallel);
  }
}

// 6: no FIFO, no fork
void fall6() {
  Pool pool(3, false);
  PRUEF(!pool.p.fifo());
  Welt a, ref;
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  a.laden(snap(1, 8, 0, nullptr, 0, 0), 0);
  ref.laden(snap(1, 8, 0, nullptr, 0, 0), 0);
  int ungleich = 0;
  for (int b = 0; b < 100; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    for (int i = 0; i < 8; ++i) {
      speise(a.intern, i, b, s0);
      speise(ref.intern, i, b, s0);
    }
    a.block(s0);
    ref.block(s0);
    ungleich += vergleiche(a, ref);
  }
  const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
  PRUEF(ungleich == 0);
  PRUEF(sl.z.seriell_fifo == 100);
  PRUEF(sl.einheiten_worker() == 0 && sl.z.blocks_parallel == 0);
  std::printf("case 6 q_fifo_fehlt: ungleich=%d seriell_fifo=%llu\n", ungleich, (unsigned long long)sl.z.seriell_fifo);
}

// 7: swaps under a running pool
void fall7() {
  CypherBk* h = bkt::neu(bkt::G_T);
  CypherBk* h2 = bkt::neu(bkt::G_T);
  {
    Pool pool(3);
    ZaehlSenke zs, zs_ref;
    Welt a(&zs), ref(&zs_ref);
    a.t.arr.setze_hall_pool(&pool.p);
    a.t.arr.setze_spur_pool(1);
    a.t.arr.setze_spur_test(kein_tor());
    cdj::SpurHaken hk;
    hk.warte_worker = 3;
    a.t.arr.setze_spur_haken(&hk);
    // tracks 0..7 rb338, track 8 and 9 counting wirt tracks
    a.laden(snap(1, 8, 0, nullptr, 0, 2), 0);
    ref.laden(snap(1, 8, 0, nullptr, 0, 2), 0);
    int b = 0, ungleich = 0, doppelt = 0;
    bool skip2 = false;   // track 2 is gone after (c)
    auto lauf = [&](int n, int n_rb, int n_wirt_von) {
      for (int k = 0; k < n; ++k, ++b) {
        const int64_t s0 = static_cast<int64_t>(b) * M;
        for (int i = 0; i < n_rb; ++i) {
          if (skip2 && i == 2) continue;
          speise(a.intern, i, b, s0);
          speise(ref.intern, i, b, s0);
        }
        std::memset(zs.n, 0, sizeof zs.n);
        std::memset(zs_ref.n, 0, sizeof zs_ref.n);
        a.block(s0);
        ref.block(s0);
        ungleich += vergleiche(a, ref);
        for (int i = 0; i < cdj::ARR_SPUREN; ++i)
          if (zs.n[i] > 1 || (i >= n_wirt_von && i < n_wirt_von + 2 && zs.n[i] != zs_ref.n[i])) ++doppelt;   // a unit computed twice, or a different count than the serial one
      }
    };
    lauf(20, 8, 8);
    // (a) a track is added under the running pool
    a.laden(snap(2, 9, 0, nullptr, 1, 2), static_cast<int64_t>(b) * M);
    ref.laden(snap(2, 9, 0, nullptr, 1, 2), static_cast<int64_t>(b) * M);
    lauf(10, 9, 9);
    // (b) a parameter-only swap after running blocks: the forks continue
    a.laden(snap(3, 9, 0, nullptr, 2, 2), static_cast<int64_t>(b) * M);
    ref.laden(snap(3, 9, 0, nullptr, 2, 2), static_cast<int64_t>(b) * M);
    const uint64_t par = a.t.arr.spur_lauf().z.blocks_parallel;
    lauf(10, 9, 9);
    PRUEF(a.t.arr.spur_lauf().z.blocks_parallel == par + 10);
    // (c) a sounding track is removed (a fade block runs serial), then forks again
    {
      const int64_t s0 = static_cast<int64_t>(b) * M;
      a.intern.note(2, s0 + 1, 50, 110, true);
      ref.intern.note(2, s0 + 1, 50, 110, true);
      lauf(1, 9, 9);
      Bau bb(4);
      for (int i = 0; i < 9; ++i)
        if (i != 2) bb.spur(i + 1, ArrArt::intern);
      bb.spur(10, ArrArt::wirt, 1);
      bb.spur(11, ArrArt::wirt, 1);
      cdj::ArrSnapshot* s_a = bb.fertig();
      Bau bb2(4);
      for (int i = 0; i < 9; ++i)
        if (i != 2) bb2.spur(i + 1, ArrArt::intern);
      bb2.spur(10, ArrArt::wirt, 1);
      bb2.spur(11, ArrArt::wirt, 1);
      cdj::ArrSnapshot* s_r = bb2.fertig();
      for (int i = 0; i < 9; ++i)
        if (i != 2) {
          std::snprintf(s_a->spur[i].geraet, sizeof s_a->spur[i].geraet, "rb338");
          std::snprintf(s_r->spur[i].geraet, sizeof s_r->spur[i].geraet, "rb338");
        }
      a.laden(s_a, static_cast<int64_t>(b) * M);
      ref.laden(s_r, static_cast<int64_t>(b) * M);
      skip2 = true;
      lauf(8, 9, 9);
      PRUEF(a.t.arr.spur_lauf().z.seriell_weg >= 1);
    }
    // (d) a device change rb338 -> bk on track 0 (the transition block runs on the serial remainder)
    {
      Bau bb(5);
      for (int i = 0; i < 9; ++i)
        if (i != 2) bb.spur(i + 1, ArrArt::intern);
      bb.spur(10, ArrArt::wirt, 1);
      bb.spur(11, ArrArt::wirt, 1);
      cdj::ArrSnapshot* s_a = bb.fertig();
      Bau bb2(5);
      for (int i = 0; i < 9; ++i)
        if (i != 2) bb2.spur(i + 1, ArrArt::intern);
      bb2.spur(10, ArrArt::wirt, 1);
      bb2.spur(11, ArrArt::wirt, 1);
      cdj::ArrSnapshot* s_r = bb2.fertig();
      for (int i = 1; i < 9; ++i)
        if (i != 2) {
          std::snprintf(s_a->spur[i].geraet, sizeof s_a->spur[i].geraet, "rb338");
          std::snprintf(s_r->spur[i].geraet, sizeof s_r->spur[i].geraet, "rb338");
        }
      bkt::spur(s_a, 1, h, 1, {{"k1", 0.7f}});
      bkt::spur(s_r, 1, h2, 1, {{"k1", 0.7f}});
      a.laden(s_a, static_cast<int64_t>(b) * M);
      ref.laden(s_r, static_cast<int64_t>(b) * M);
      lauf(10, 9, 9);
      PRUEF(a.t.arr.spur_plan_gueltig());
    }
    PRUEF(ungleich == 0);
    PRUEF(doppelt == 0);
    PRUEF(a.t.arr.spur_lauf().z.unfertig == 0);   // no unit was still claimed when a block started: the join of every block is complete
    PRUEF(a.t.arr.spur_lauf().einheiten_worker() > 0);
    std::printf("case 7 q_tausch: ungleich=%d doppelt=%d unfertig=%llu parallel=%llu weg=%llu\n", ungleich, doppelt, (unsigned long long)a.t.arr.spur_lauf().z.unfertig,
                (unsigned long long)a.t.arr.spur_lauf().z.blocks_parallel, (unsigned long long)a.t.arr.spur_lauf().z.seriell_weg);
  }
  cypher_bk_frei(h);
  cypher_bk_frei(h2);
}

// 8: mode and pool change at runtime
void fall8() {
  Pool pool(3), pool2(2);
  Welt a, ref;
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 10, 0, nullptr, 0, 0), 0);
  ref.laden(snap(1, 10, 0, nullptr, 0, 0), 0);
  int b = 0, ungleich = 0;
  auto lauf = [&](int n) {
    for (int k = 0; k < n; ++k, ++b) {
      const int64_t s0 = static_cast<int64_t>(b) * M;
      for (int i = 0; i < 10; ++i) {
        speise(a.intern, i, b, s0);
        speise(ref.intern, i, b, s0);
      }
      a.block(s0);
      ref.block(s0);
      ungleich += vergleiche(a, ref);
    }
  };
  auto jede_spur_einmal = [&]() {
    const cdj::ArrSpurPlan& p = a.t.arr.spur_plan();
    int v[cdj::ARR_SPUREN] = {};
    for (int l = 0; l < p.bahnen(); ++l)
      for (int k = 0; k < p.n(l); ++k) ++v[p.spur(l, k)];
    for (int k = 0; k < p.n_rest(); ++k) ++v[p.rest(k)];
    bool ok = true;
    for (int i = 0; i < cdj::ARR_SPUREN; ++i) ok = ok && v[i] == (i < 10 ? 1 : 0);
    return ok;
  };
  lauf(10);
  const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
  PRUEF(sl.z.blocks_parallel == 10 && a.t.arr.spur_plan().bahnen() == 4);
  a.t.arr.setze_spur_pool(0);
  lauf(10);
  PRUEF(sl.z.blocks_parallel == 10 && sl.z.seriell_aus == 10);   // serial while off
  a.t.arr.setze_spur_pool(1);
  lauf(10);
  PRUEF(sl.z.blocks_parallel == 20);
  PRUEF(jede_spur_einmal());
  hk.warte_worker = 2;
  const uint64_t l3_vorher = sl.einheiten_bahn(3), l2_vorher = sl.einheiten_bahn(2);
  a.t.arr.setze_hall_pool(&pool2.p);   // 2 workers: 3 lanes from the next block on
  PRUEF(!a.t.arr.spur_plan_gueltig());
  lauf(10);
  PRUEF(a.t.arr.spur_plan().bahnen() == 3);
  PRUEF(jede_spur_einmal());
  PRUEF(sl.z.blocks_parallel == 30);
  PRUEF(sl.einheiten_bahn(3) == l3_vorher && sl.einheiten_bahn(2) > l2_vorher);   // no lane 3 any more, lane 2 still works
  PRUEF(ungleich == 0);
  std::printf("case 8 q_aus_zur_laufzeit: ungleich=%d parallel=%llu aus=%llu bahnen=%d\n", ungleich, (unsigned long long)sl.z.blocks_parallel, (unsigned long long)sl.z.seriell_aus,
              a.t.arr.spur_plan().bahnen());
}

// 9: no allocation
std::atomic<long> g_lane_alloc[cdj::ARR_ARBEIT_BAHNEN];
void alloc_vor(int bahn) {
  if (bahn > 0) abfang_an();   // the caller's window (lane 0) is the one around the whole block, set by the test
}
void alloc_nach(int bahn) {
  if (bahn <= 0) return;
  abfang_aus();
  const AbfangZahlen z = abfang_zahlen();
  g_lane_alloc[bahn].fetch_add(z.alloc + z.frei);
}

void fall9() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("case 9 q_keine_allokation: skipped (sanitizer build): allocation watcher not available\n");
    return;
  }
  for (auto& x : g_lane_alloc) x.store(0);
  Pool pool(3);
  Welt a;
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  hk.vor = &alloc_vor;
  hk.nach = &alloc_nach;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 24, 0, nullptr, 0, 1), 0);
  for (int b = 0; b < 50; ++b) {   // warm-up: first notes, plan, FFI state
    for (int i = 0; i < 24; ++i) speise(a.intern, i, b, static_cast<int64_t>(b) * M);
    a.block(static_cast<int64_t>(b) * M);
  }
  for (auto& x : g_lane_alloc) x.store(0);
  long caller = 0;
  for (int b = 50; b < 1050; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    for (int i = 0; i < 24; ++i) speise(a.intern, i, b, s0);   // note insertion is outside the callback window
    abfang_an();
    a.block(s0);
    abfang_aus();
    const AbfangZahlen z = abfang_zahlen();
    caller += z.alloc + z.frei;   // futex waits of the join count as `sperren` in the watcher and are not allocations
  }
  long worker = 0;
  for (int l = 1; l < cdj::ARR_ARBEIT_BAHNEN; ++l) worker += g_lane_alloc[l].load();
  PRUEF(caller == 0);
  PRUEF(worker == 0);
  PRUEF(a.t.arr.spur_lauf().einheiten_worker() > 0);
  // positive control: a sink that allocates is counted on a worker
  for (auto& x : g_lane_alloc) x.store(0);
  AllocSenke as;
  Welt c(&as);
  c.t.arr.setze_hall_pool(&pool.p);
  c.t.arr.setze_spur_pool(1);
  c.t.arr.setze_spur_test(kein_tor());
  c.t.arr.setze_spur_haken(&hk);
  c.laden(snap(1, 0, 0, nullptr, 0, 8), 0);
  for (int b = 0; b < 20; ++b) c.block(static_cast<int64_t>(b) * M);
  long kontrolle = 0;
  for (int l = 1; l < cdj::ARR_ARBEIT_BAHNEN; ++l) kontrolle += g_lane_alloc[l].load();
  PRUEF(kontrolle > 0);
  std::printf("case 9 q_keine_allokation: caller=%ld worker=%ld positive_control_worker=%ld\n", caller, worker, kontrolle);
}

// 10: a worker held inside a unit
void fall10() {
  Pool pool(3);
  Welt a, ref;
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.halte_bahn = 2;
  hk.warte_drin = 1;
  hk.warte_worker = 2;   // the other two workers computed first (lane 2 holds in its first unit)
  hk.frei = false;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 12, 0, nullptr, 0, 0), 0);
  ref.laden(snap(1, 12, 0, nullptr, 0, 0), 0);
  std::atomic<bool> ende{false};
  std::thread freigeber([&]() {   // releases the held unit a moment after it started to hold, in every block
    while (!ende.load()) {
      if (hk.drin.load() >= 1 && !hk.frei.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
        hk.frei.store(true);
      }
      std::this_thread::yield();
    }
  });
  int ungleich = 0;
  for (int b = 0; b < 20; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    for (int i = 0; i < 12; ++i) {
      speise(a.intern, i, b, s0);
      speise(ref.intern, i, b, s0);
    }
    hk.drin.store(0);
    hk.frei.store(false);
    a.block(s0);
    ref.block(s0);
    ungleich += vergleiche(a, ref);
  }
  ende.store(true);
  freigeber.join();
  PRUEF(ungleich == 0);
  PRUEF(a.t.arr.spur_lauf().z.blocks_parallel == 20);
  PRUEF(a.t.arr.spur_lauf().einheiten_bahn(2) >= 20);   // the held unit was finished by its worker, not abandoned or redone
  PRUEF(a.t.arr.spur_lauf().z.unfertig == 0);
  std::printf("case 10 q_haken: ungleich=%d lane2=%llu\n", ungleich, (unsigned long long)a.t.arr.spur_lauf().einheiten_bahn(2));
}

// ================= task 6: failure behaviour =================
// deterministic, lane independent signal; atomic counters so a test may read them while the block runs on another thread
struct AtomSenke : LeerSenke {
  std::atomic<int> gesamt{0};
  std::atomic<int> n[cdj::ARR_SPUREN];
  AtomSenke() {
    for (auto& x : n) x.store(0);
  }
  void block(int spur, int64_t s0, int m, float* l, float* r) noexcept override {
    for (int i = 0; i < m; ++i) {
      const float y = 1e-3f * static_cast<float>(spur + 1) + 1e-5f * static_cast<float>((s0 + i) % 97);
      l[i] += y;
      r[i] += 0.5f * y;
    }
    n[spur].fetch_add(1);
    gesamt.fetch_add(1);
  }
};

// The held job is one hang. Exactly 1 is NOT deterministic, not even without TSan: with the limit 1 ns after the cycle start every job that is still inside a
// unit when the caller reaches its join counts too (measured: 'haengt == 1' failed once in 368 tests on a loaded machine). So: at least one, at most all three.
#define PRUEF_EIN_HAENGER(n) PRUEF((n) >= 1 && (n) <= 3)

bool warte_auf(const std::function<bool()>& f, int ms = 3000) {
  const auto bis = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
  while (!f()) {
    if (std::chrono::steady_clock::now() > bis) return false;
    std::this_thread::yield();
  }
  return true;
}

int reg(Welt& w, const char* pfad) {
  const int r = w.t.tab.suche(pfad);
  PRUEF(r >= 0);
  return r;
}

// every track sends 0 dB into all four returns, and the four returns exist: the Halls run (phase H)
void halls_an(Welt& w, int n_spuren) {
  for (int t = 1; t <= n_spuren; ++t)
    for (int r = 1; r <= 4; ++r) w.t.arr.setze_sofort(reg(w, (std::string("spur/") + std::to_string(t) + "/send/" + std::to_string(r)).c_str()), 0.0f);
}
cdj::ArrSnapshot* mit_returns(cdj::ArrSnapshot* s) {
  for (int r = 0; r < cdj::ARR_RETURNS; ++r) s->ret_da[r] = true;
  return s;
}
uint64_t hall_worker(const Welt& w) {
  uint64_t n = 0;
  for (int r = 1; r < 4; ++r) n += w.t.arr.returns().pool_berechnet(r);
  return n;
}

// the pm tap and the outputs of two worlds, bit for bit
int vergleiche_pm(const Welt& a, const Welt& ref) {
  return (bit_gleich(a.t.arr.pm_l(), ref.t.arr.pm_l(), M) ? 0 : 1) + (bit_gleich(a.t.arr.pm_r(), ref.t.arr.pm_r(), M) ? 0 : 1);
}

// 11: a worker held inside a unit
void fall11() {
  Pool pool(3);
  AtomSenke sa, sr;
  Welt a(&sa), ref(&sr);
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  cdj::SpurTest st;
  st.min_last = 0;
  st.grenze_ns = 1;   // the hard limit sits 1 ns after the start: any job still running at the join is a hang
  a.t.arr.setze_spur_test(st);
  cdj::SpurHaken hk;
  hk.halte_bahn = 2;
  hk.warte_drin = 1;     // the caller does not start its first unit before the worker on lane 2 holds one (it cannot take that unit first)
  hk.warte_worker = 2;   // the other two workers computed before anybody steals
  hk.frei = false;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 0, 0, nullptr, 0, 12), 0);
  ref.laden(snap(1, 0, 0, nullptr, 0, 12), 0);
  std::atomic<bool> fertig{false};
  std::thread blk([&] {
    a.block(0);
    fertig.store(true);
  });
  const bool im_join = warte_auf([&] { return hk.am_join.load() >= 1; });
  const bool haengt = warte_auf([&] { return pool.p.haengt(cdj::HallPool::SPUR) >= 1; });
  std::this_thread::sleep_for(std::chrono::milliseconds(3));
  PRUEF(im_join);
  PRUEF(haengt);
  PRUEF(!fertig.load());                                          // the caller did not abandon the held job: the block is not complete
  PRUEF(sa.gesamt.load() == 11);                                  // every other unit is done: nobody waited behind the held one
  PRUEF_EIN_HAENGER(pool.p.haengt(cdj::HallPool::SPUR));
  PRUEF(pool.p.an(cdj::HallPool::SPUR));                          // the switch-off is taken at the next block start, with every worker frei
  hk.frei.store(true);
  blk.join();
  PRUEF(fertig.load());
  ref.block(0);
  PRUEF(vergleiche(a, ref) == 0);
  PRUEF(sa.gesamt.load() == 12);
  a.block(M);
  ref.block(M);
  PRUEF(vergleiche(a, ref) == 0);
  PRUEF(!pool.p.an(cdj::HallPool::SPUR));
  PRUEF(pool.p.an(cdj::HallPool::HALL));
  std::this_thread::sleep_for(std::chrono::milliseconds(20));   // a broken join (mutation) leaves a job running on this world: let it end before the world goes
  std::printf("case 11 q_haken_haengt_in_einheit: haengt=%llu spur_an=%d hall_an=%d\n", (unsigned long long)pool.p.haengt(cdj::HallPool::SPUR), (int)pool.p.an(cdj::HallPool::SPUR),
              (int)pool.p.an(cdj::HallPool::HALL));
}

// a stalled block: the worker on lane 2 is held (vor_claim: right after it took its job, else inside its first unit), the caller reaches the join, the
// fake clock moves 200 us and the worker is released. Returns after the block thread ended.
// hooks (plain function pointers: the seam has no context)
std::atomic<cdj::SpurHaken*> g_hk{nullptr};
std::atomic<int> g_base{0};
std::atomic<bool> g_getan{false};
// a unit that really takes long on lane 2: it counts as held (drin), waits until the caller stands at the join, and then 200 us pass on the scheduler's clock
void vor_langsam(int bahn) {
  if (bahn != 2 || g_getan.exchange(true)) return;
  cdj::SpurHaken* h = g_hk.load();
  h->drin.fetch_add(1);
  warte_auf([&] { return h->am_join.load() > g_base.load(); });
  h->uhr_ns.fetch_add(200000);
}
// the caller's own units take 300 us each on the scheduler's clock (the clock moves nowhere else in that test)
void vor_eigene(int bahn) {
  if (bahn == 0) g_hk.load()->uhr_ns.fetch_add(300000);
}

struct Stall {
  Welt& a;
  Welt& ref;
  cdj::SpurHaken& hk;
  bool vor_claim;
  int64_t s0 = 0;
  int ungleich = 0;
  int ok = 0;
  void sauber() {   // a block without a hold
    hk.vor = nullptr;
    hk.halte_bahn = -1;
    hk.halte_vor_claim_bahn = -1;
    hk.warte_drin = 0;
    hk.frei = true;
    a.block(s0);
    ref.block(s0);
    ungleich += vergleiche(a, ref);
    s0 += M;
  }
  void halte() {
    hk.halte_bahn = -1;
    hk.halte_vor_claim_bahn = vor_claim ? 2 : -1;
    hk.warte_drin = 1;
    hk.warte_worker = vor_claim ? 0 : 2;
    hk.frei = !vor_claim;   // case 13 holds nothing: the `vor` hook is the slow unit
    const int base = hk.am_join.load();
    if (!vor_claim) {
      hk.vor = &vor_langsam;
      g_hk.store(&hk);
      g_base.store(base);
      g_getan.store(false);
    }
    std::atomic<bool> fertig{false};
    std::thread blk([&] {
      a.block(s0);
      fertig.store(true);
    });
    const bool im_join = warte_auf([&] { return hk.am_join.load() > base; });
    ok += im_join && (!vor_claim || !fertig.load()) ? 1 : 0;
    if (vor_claim) {
      hk.uhr_ns.fetch_add(200000);   // the join wait is 200 us on the scheduler's clock (case 13: the hook does it inside the unit)
      hk.frei.store(true);
    }
    blk.join();
    hk.vor = nullptr;
    ref.block(s0);
    ungleich += vergleiche(a, ref);
    s0 += M;
  }
};

// 12 and 13 share the story: four stalled blocks do not switch the track phases off, the fifth does, the Halls keep their workers
void stall_fall(bool vor_claim) {
  Pool pool(3);
  AtomSenke sa, sr;
  Welt a(&sa), ref(&sr);
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  cdj::SpurTest st;
  st.min_last = 0;
  st.grenze_ns = 10'000'000'000LL;   // the hard limit is not what this case looks at
  a.t.arr.setze_spur_test(st);
  cdj::SpurHaken hk;
  hk.uhr_ns = 1'000'000'000;
  a.t.arr.setze_spur_haken(&hk);
  halls_an(a, 12);
  halls_an(ref, 12);
  a.laden(mit_returns(snap(1, 0, 0, nullptr, 0, 12)), 0);
  ref.laden(mit_returns(snap(1, 0, 0, nullptr, 0, 12)), 0);
  Stall s{a, ref, hk, vor_claim};
  const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
  using K = cdj::HallPool;
  for (int i = 0; i < 4; ++i) s.halte();
  PRUEF(s.ok == 4);
  PRUEF(pool.p.spaet(K::SPUR) == 4);
  PRUEF(sl.z.warte_spaet == 4);
  PRUEF(sl.warte_max_us() >= 200);   // the longest join wait, in microseconds, above the threshold of 100
  s.sauber();                         // a block start would take a switch-off: four events do not
  PRUEF(pool.p.an(K::SPUR));
  s.halte();                          // the fifth within 64 blocks
  PRUEF(pool.p.spaet(K::SPUR) == 5);
  s.sauber();
  PRUEF(!pool.p.an(K::SPUR));
  PRUEF(pool.p.an(K::HALL));
  PRUEF(pool.p.spaet(K::HALL) == 0);
  const uint64_t halls_vorher = hall_worker(a), worker_vorher = sl.einheiten_worker();
  for (int i = 0; i < 20; ++i) s.sauber();
  PRUEF(hall_worker(a) > halls_vorher);                   // phase H still computes on the workers
  PRUEF(sl.einheiten_worker() == worker_vorher);          // the track phase is off
  PRUEF(s.ungleich == 0);
  PRUEF(sl.z.unfertig == 0);
  std::printf("case %d %s: late=%llu warte_max_us=%lld spur_an=%d hall_an=%d halls_on_workers=%llu ungleich=%d\n", vor_claim ? 12 : 13, vor_claim ? "q_gestartet_ohne_einheit" : "q_warte_langsam",
              (unsigned long long)pool.p.spaet(K::SPUR), (long long)sl.warte_max_us(), (int)pool.p.an(K::SPUR), (int)pool.p.an(K::HALL), (unsigned long long)(hall_worker(a) - halls_vorher), s.ungleich);
}
void fall12() { stall_fall(true); }
void fall13() { stall_fall(false); }

// 14: a worker that misses its deadline before it starts
void fall14() {
  cdj::HallPoolEinstellung e;
  e.faeden = 3;
  e.frist_us = 1;   // a job not started 1 us after schicke is late
  e.bloecke_us = 5333;
  cdj::HallPool pool(e);
  pool.setze_fifo_test(true);
  AtomSenke sa, sr;
  Welt a(&sa), ref(&sr);
  a.t.arr.setze_hall_pool(&pool);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 2;   // workers 1 and 3 started and computed before the caller works: only worker 2 can be late
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 0, 0, nullptr, 0, 12), 0);
  ref.laden(snap(1, 0, 0, nullptr, 0, 12), 0);
  using K = cdj::HallPool;
  int ungleich = 0;
  int64_t s0 = 0;
  auto block = [&](bool gehalten) {
    pool.anhalten(1, gehalten);   // worker 2 (index 1) never starts its job
    a.block(s0);
    ref.block(s0);
    ungleich += vergleiche(a, ref);
    s0 += M;
  };
  for (int i = 0; i < 4; ++i) block(true);
  PRUEF(pool.spaet(K::SPUR) == 4 && pool.zurueck(K::SPUR) == 4);
  block(false);   // the next block start would take a switch-off
  PRUEF(pool.an(K::SPUR));
  block(true);
  PRUEF(pool.spaet(K::SPUR) == 5);
  block(false);
  PRUEF(!pool.an(K::SPUR));
  PRUEF(pool.spaet(K::HALL) == 0 && pool.zurueck(K::HALL) == 0 && pool.an(K::HALL));
  PRUEF(ungleich == 0);
  pool.anhalten(false);
  std::printf("case 14 q_arbeiter_langsam: late=%llu zurueck=%llu spur_an=%d hall_late=%llu ungleich=%d\n", (unsigned long long)pool.spaet(K::SPUR), (unsigned long long)pool.zurueck(K::SPUR),
              (int)pool.an(K::SPUR), (unsigned long long)pool.spaet(K::HALL), ungleich);
}

// 15: the late-start refusal, measured from the cycle stamp on the fake clock, against the period of the real block length
void fall15() {
  Pool pool(3);
  AtomSenke sa;
  Welt a(&sa);
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  constexpr int64_t JETZT = 1'000'000'000;
  cdj::SpurTest st = kein_tor();
  st.jetzt_ns = JETZT;
  a.t.arr.setze_spur_test(st);
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 0, 0, nullptr, 0, 8), 0);
  const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
  int64_t s0 = 0;
  auto lauf = [&](int64_t zurueck_ns, int m, bool& forkte) {   // zurueck_ns < 0: the start is unknown
    const uint64_t p0 = sl.z.blocks_parallel, s_0 = sl.z.seriell_spaet;
    a.t.arr.setze_zyklus_start(zurueck_ns < 0 ? 0 : JETZT - zurueck_ns);
    a.block(s0, m);
    s0 += m;
    forkte = sl.z.blocks_parallel == p0 + 1;
    return sl.z.seriell_spaet - s_0;
  };
  const int64_t P256 = cdj::ArrSpurLauf::periode_ns(256);
  bool f = false;
  PRUEF(lauf(P256 * 60 / 100, 256, f) == 1 && !f);          // 60 percent in: serial
  PRUEF(lauf(-1, 256, f) == 0 && f);                        // unknown: forks
  PRUEF(lauf(P256 * 40 / 100, 256, f) == 0 && f);           // 40 percent in: forks
  PRUEF(lauf(P256 * 49 / 100, 256, f) == 0 && f);
  PRUEF(lauf(P256 * 51 / 100, 256, f) == 1 && !f);
  const int64_t spaet = 1'500'000;                          // the same absolute lateness: 56 percent of 128 samples, 7 percent of 1024
  PRUEF(lauf(spaet, 128, f) == 1 && !f);
  PRUEF(lauf(spaet, 1024, f) == 0 && f);
  PRUEF(lauf(5'000'000'000LL, 256, f) == 0 && f);           // a stamp from another clock (more than a second back) is no information
  std::printf("case 15 q_spaet_start: seriell_spaet=%llu parallel=%llu\n", (unsigned long long)sl.z.seriell_spaet, (unsigned long long)sl.z.blocks_parallel);
}

// 20: what counts as live load
struct MarkSenke : AtomSenke {
  std::atomic<bool> leer_[cdj::ARR_SPUREN];
  MarkSenke() {
    for (auto& x : leer_) x.store(false);
  }
  bool leer(int spur) const noexcept override { return leer_[spur].load(); }
};

void fall20() {
  Pool pool(3);
  MarkSenke sa;
  Welt a(&sa);
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor(4 * M));   // four live units at 256 samples are enough
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 0, 0, nullptr, 0, 8), 0);
  const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
  int64_t s0 = 0;
  auto lauf = [&](int n) {
    for (int i = 0; i < n; ++i, s0 += M) a.block(s0);
  };
  auto setze = [&](int spur, const char* feld, float w) { a.t.arr.setze_sofort(reg(a, (std::string("spur/") + std::to_string(spur) + "/" + feld).c_str()), w); };
  auto forkt = [&](int n) {   // n blocks: every one of them forks and none counts "wenig"
    const uint64_t p0 = sl.z.blocks_parallel, w0 = sl.z.seriell_wenig;
    lauf(n);
    return sl.z.blocks_parallel == p0 + static_cast<uint64_t>(n) && sl.z.seriell_wenig == w0;
  };
  lauf(5);
  PRUEF(forkt(5));
  for (int i = 1; i <= 8; ++i) setze(i, "mute", 1.0f);   // every track muted: the sinks still compute them
  lauf(4);                                               // the mute state is read from the last block: the old criterion needs a block to see it
  PRUEF(forkt(10));
  for (int i = 1; i <= 8; ++i) setze(i, "mute", 0.0f);
  lauf(4);
  setze(1, "solo", 1.0f);   // solo of one track: the other seven are not soloed, and still computed
  lauf(4);
  PRUEF(forkt(10));
  setze(1, "solo", 0.0f);
  lauf(4);
  for (int i = 0; i < 5; ++i) sa.leer_[i].store(true);   // five of eight units have nothing to compute: three live, below the threshold
  const uint64_t w0 = sl.z.seriell_wenig, p0 = sl.z.blocks_parallel;
  lauf(10);
  PRUEF(sl.z.seriell_wenig == w0 + 10 && sl.z.blocks_parallel == p0);
  for (int i = 0; i < 3; ++i) sa.leer_[i].store(false);  // five live again: forks
  PRUEF(forkt(10));
  std::printf("case 20 q_live: parallel=%llu wenig=%llu\n", (unsigned long long)sl.z.blocks_parallel, (unsigned long long)sl.z.seriell_wenig);
}

// 21: the product hard limit counts from the cycle stamp. The stamp lies 30 percent of the period in the past (the phase still forks, the gate is at 50), the limit
// at 75 percent is then 45 percent of the period after the entry into the phase; a limit measured from the entry would sit at 75 percent. A job is held and released
// in between (58 percent after the entry): the right limit has counted it, the wrong one has not. Real clock, m = 1024 (21 ms) so scheduling noise is a small share.
int64_t echt_jetzt() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

// 21: the hard limit counts from the cycle start, not from the entry into laufen(). The gate and the stamp live on the fake clock (49 percent of the period behind
// the stamp: it forks, whatever the load), the limit is applied to the real clock from the entry: correct code expires 26 percent of the period after the entry, the
// mutation (limit from the entry) 75 percent after it. The case polls for the moment the held unit is counted as hanging and takes the time from before the
// block thread starts; load can only make that moment later, so the mutation stays above the threshold in every attempt (50 percent), and a correct run that lost
// the CPU for more than ~5 ms gets another attempt.
bool fall21_versuch(int64_t* prozent, bool* gegabelt) {
  Pool pool(3);
  AtomSenke sa;
  Welt a(&sa);
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  const int m = 1024;
  const int64_t P = cdj::ArrSpurLauf::periode_ns(m);
  constexpr int64_t JETZT = 1'000'000'000;
  cdj::SpurTest st;
  st.min_last = 0;
  st.jetzt_ns = JETZT;                    // the gate (and the origin of the limit) on the fake clock
  st.warte_spaet_ns = 10'000'000'000LL;   // the join-wait signal is not what this case looks at; the hard limit is the product one (no override)
  a.t.arr.setze_spur_test(st);
  cdj::SpurHaken hk;
  hk.halte_bahn = 2;
  hk.warte_drin = 1;
  hk.warte_worker = 2;
  hk.frei = false;
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 0, 0, nullptr, 0, 12), 0);
  a.t.arr.setze_zyklus_start(JETZT - P * 49 / 100);
  const int64_t t0 = echt_jetzt();
  std::thread blk([&] { a.block(0, m); });
  bool da = false;
  const int64_t frist = t0 + 2'000'000'000LL;
  while (echt_jetzt() < frist) {
    if (pool.p.haengt(cdj::HallPool::SPUR) >= 1) {
      da = true;
      break;
    }
    std::this_thread::yield();
  }
  const int64_t t1 = echt_jetzt();
  hk.frei.store(true);
  blk.join();
  *prozent = (t1 - t0) * 100 / P;
  *gegabelt = a.t.arr.spur_lauf().z.seriell_spaet == 0 && a.t.arr.spur_lauf().z.blocks_parallel == 1;
  return da;
}

void fall21() {
  int64_t prozent = 0;
  bool gegabelt = false, ok = false;
  for (int versuch = 0; versuch < 4 && !ok; ++versuch) {
    const bool da = fall21_versuch(&prozent, &gegabelt);
    PRUEF(gegabelt);   // it forked (fake gate: no load dependence)
    ok = da && prozent < 50;
  }
  PRUEF(ok);   // counted as hanging well before 75 percent after the entry
  std::printf("case 21 q_grenze_ab_zyklusstart: hanging seen %lld percent of the period after the start\n", (long long)prozent);
}

// 22: the join wait is measured at the join. The caller's own units move the scheduler's clock by 300 us each (more than the 100 us threshold); a held worker keeps
// the caller at the join for a moment, in which the clock does not move: no late event, the phase stays on. A wait measured from the entry would count the caller's work.
void fall22() {
  Pool pool(3);
  AtomSenke sa;
  Welt a(&sa);
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  cdj::SpurTest st;
  st.min_last = 0;
  st.grenze_ns = 10'000'000'000LL;   // the product join-wait threshold stays (100 us)
  a.t.arr.setze_spur_test(st);
  cdj::SpurHaken hk;
  hk.uhr_ns = 1'000'000'000;
  hk.halte_bahn = 2;
  hk.warte_drin = 1;
  hk.warte_worker = 2;
  hk.vor = &vor_eigene;
  g_hk.store(&hk);
  a.t.arr.setze_spur_haken(&hk);
  a.laden(snap(1, 0, 0, nullptr, 0, 12), 0);
  for (int b = 0; b < 8; ++b) {
    hk.frei.store(false);
    const int base = hk.am_join.load();
    std::thread blk([&] { a.block(static_cast<int64_t>(b) * M); });
    const bool im_join = warte_auf([&] { return hk.am_join.load() > base; });
    PRUEF(im_join);
    hk.frei.store(true);   // the clock does not move while the caller waits
    blk.join();
  }
  hk.vor = nullptr;
  const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
  PRUEF(hk.uhr_ns.load() - 1'000'000'000 >= 8 * 300000);   // the caller's own work really was more than the threshold in every block
  PRUEF(sl.z.warte_spaet == 0 && pool.p.spaet(cdj::HallPool::SPUR) == 0);
  PRUEF(sl.warte_max_us() == 0);
  PRUEF(pool.p.an(cdj::HallPool::SPUR) && sl.z.blocks_parallel == 8);
  std::printf("case 22 q_warte_nach_eigener_arbeit: late=%llu warte_max_us=%lld parallel=%llu\n", (unsigned long long)pool.p.spaet(cdj::HallPool::SPUR), (long long)sl.warte_max_us(),
              (unsigned long long)sl.z.blocks_parallel);
}

// 23: a sub-block that starts ahead of the cycle stamp (sub-block 1 of a 2048-sample cycle, nominal start 21.3 ms into the cycle, the callback is ahead of its
// schedule). The numbers of the limit and of the gate, on the fake clock (pure arithmetic: no timing in it).
void fall23() {
  cdj::ArrSpurLauf l;
  constexpr int64_t JETZT = 1'000'000'000, ECHT = 5'000'000'000'000LL;
  cdj::SpurTest st;
  st.jetzt_ns = JETZT;
  l.setze_test(st);
  const int64_t P = cdj::ArrSpurLauf::periode_ns(1024), G = P * 75 / 100;
  PRUEF(l.grenze_echt(0, 1024, ECHT) == ECHT + G);                            // unknown start: from now
  PRUEF(l.grenze_echt(JETZT + 6'000'000, 1024, ECHT) == ECHT + 6'000'000 + G);   // the nominal start is 6 ms ahead: the limit counts from there
  PRUEF(l.grenze_echt(JETZT - 5'000'000, 1024, ECHT) == ECHT - 5'000'000 + G);   // 5 ms behind
  PRUEF(l.grenze_echt(JETZT - 5'000'000'000LL, 1024, ECHT) == ECHT + G);      // another clock: unknown
  st.grenze_ns = 7'000'000;
  l.setze_test(st);
  PRUEF(l.grenze_echt(JETZT + 6'000'000, 1024, ECHT) == ECHT + 6'000'000 + 7'000'000);
  // the gate: ahead of the nominal start is on time, 50 percent of the period behind it refuses
  PRUEF(!l.spaet_dran(JETZT + 6'000'000, 1024) && l.z.seriell_spaet == 0);
  PRUEF(!l.spaet_dran(JETZT - P * 49 / 100, 1024) && l.z.seriell_spaet == 0);
  PRUEF(l.spaet_dran(JETZT - P * 51 / 100, 1024) && l.z.seriell_spaet == 1);
  PRUEF(!l.spaet_dran(JETZT + P, 1024) && l.z.seriell_spaet == 1);               // a full period of lead (a split cycle's last sub-block): still forks, a lead is never late
  PRUEF(!l.spaet_dran(JETZT + P * 3 / 2, 1024) && l.z.seriell_spaet == 1);
  PRUEF(l.grenze_echt(JETZT + P, 1024, ECHT) == ECHT + P + 7'000'000);           // and the limit counts from that nominal start
  std::printf("case 23 q_zyklusteilung: limit ahead %lld ns after echt0, seriell_spaet=%llu\n", (long long)(l.grenze_echt(JETZT + 6'000'000, 1024, ECHT) - ECHT), (unsigned long long)l.z.seriell_spaet);
}

// 16 lives in test_core_track_time.cpp (it needs the Kern)
void fall16() { std::printf("case 16 q_zyklus_zeit: see test_kern_spur_zeit\n"); }

// 17: the hard limit
void fall17() {
  struct Lauf {
    uint64_t haengt = 0;
    bool spur_an_danach = true, hall_an_danach = false;
  };
  auto lauf = [](int64_t grenze_ns, int m) {
    Pool pool(3);
    AtomSenke sa;
    Welt a(&sa);
    a.t.arr.setze_hall_pool(&pool.p);
    a.t.arr.setze_spur_pool(1);
    cdj::SpurTest st;
    st.min_last = 0;
    st.grenze_ns = grenze_ns;
    a.t.arr.setze_spur_test(st);
    cdj::SpurHaken hk;
    const bool halten = grenze_ns > 0;   // the control run with the product limit holds nothing: a handshake with a starved test thread would be what fails it on a loaded machine
    hk.halte_bahn = halten ? 2 : -1;
    hk.warte_drin = halten ? 1 : 0;
    hk.warte_worker = halten ? 2 : 3;
    hk.frei = !halten;
    a.t.arr.setze_spur_haken(&hk);
    a.laden(snap(1, 0, 0, nullptr, 0, 12), 0);
    std::thread blk([&] { a.block(0, m); });
    if (halten) {
      PRUEF(warte_auf([&] { return hk.am_join.load() >= 1; }));
      PRUEF(warte_auf([&] { return pool.p.haengt(cdj::HallPool::SPUR) >= 1; }));   // the limit is the thing waited for here
      hk.frei.store(true);
    }
    blk.join();
    a.block(static_cast<int64_t>(m), m);
    Lauf l;
    l.haengt = pool.p.haengt(cdj::HallPool::SPUR);
    l.spur_an_danach = pool.p.an(cdj::HallPool::SPUR);
    l.hall_an_danach = pool.p.an(cdj::HallPool::HALL);
    return l;
  };
  const Lauf mit = lauf(1, 256);
  PRUEF_EIN_HAENGER(mit.haengt);
  PRUEF(!mit.spur_an_danach && mit.hall_an_danach);
  Lauf ohne = lauf(0, 1024);   // product limit: 75 percent of 21 ms
  for (int v = 0; v < 3 && ohne.haengt != 0; ++v) ohne = lauf(0, 1024);   // the main thread that releases may itself be starved for 16 ms on a loaded machine: three tries; the run with the 1 ns limit above proves the counter works
  PRUEF(ohne.haengt == 0 && ohne.spur_an_danach && ohne.hall_an_danach);
  std::printf("case 17 q_grenze: with limit haengt=%llu spur_an=%d hall_an=%d; product limit haengt=%llu spur_an=%d\n", (unsigned long long)mit.haengt, (int)mit.spur_an_danach,
              (int)mit.hall_an_danach, (unsigned long long)ohne.haengt, (int)ohne.spur_an_danach);
}

// 18: a failure of the track phases leaves the Halls and the output alone
void fall18() {
  CypherBk* h[1] = {nullptr};
  Pool pool(3);
  Welt a, ref;
  a.t.arr.setze_hall_pool(&pool.p);
  a.t.arr.setze_spur_pool(1);
  a.t.arr.setze_spur_test(kein_tor());
  cdj::SpurHaken hk;
  hk.warte_worker = 3;
  a.t.arr.setze_spur_haken(&hk);
  halls_an(a, 24);
  halls_an(ref, 24);
  a.laden(mit_returns(snap(1, 24, 0, h, 0, 0)), 0);
  ref.laden(mit_returns(snap(1, 24, 0, h, 0, 0)), 0);
  using K = cdj::HallPool;
  uint64_t ha = 1469598103934665603ULL, hr = 1469598103934665603ULL;
  auto mische = [](uint64_t& x, const float* v, int n) {
    for (int i = 0; i < n; ++i) {
      uint32_t w;
      std::memcpy(&w, v + i, 4);
      x = (x ^ w) * 1099511628211ULL;
    }
  };
  int ungleich = 0;
  uint64_t halls_vor = 0, worker_vor = 0, parallel_vor = 0;
  for (int b = 0; b < 2000; ++b) {
    const int64_t s0 = static_cast<int64_t>(b) * M;
    for (int i = 0; i < 24; ++i) {
      speise(a.intern, i, b, s0);
      speise(ref.intern, i, b, s0);
    }
    if (b == 300) {   // five late events of the track account between two blocks
      for (int i = 0; i < 5; ++i) pool.p.spaet_melden(K::SPUR);
      halls_vor = hall_worker(a);
      worker_vor = a.t.arr.spur_lauf().einheiten_worker();
      parallel_vor = a.t.arr.spur_lauf().z.blocks_parallel;
    }
    a.block(s0);
    ref.block(s0);
    ungleich += vergleiche(a, ref) + vergleiche_pm(a, ref);
    mische(ha, a.out[0], M);
    mische(ha, a.t.arr.pm_l(), M);
    mische(hr, ref.out[0], M);
    mische(hr, ref.t.arr.pm_l(), M);
  }
  const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
  PRUEF(parallel_vor == 300);                        // it forked before the switch-off
  PRUEF(!pool.p.an(K::SPUR) && pool.p.an(K::HALL));
  PRUEF(sl.z.blocks_parallel <= parallel_vor + 1);   // and not after it (the block that took the switch-off ran serial)
  PRUEF(sl.einheiten_worker() <= worker_vor + 24);
  PRUEF(hall_worker(a) > halls_vor + 100);           // the Halls kept computing on the workers
  PRUEF(ha == hr && ungleich == 0);
  PRUEF(pool.p.zurueck(K::HALL) == 0 && pool.p.spaet(K::HALL) == 0);
  std::printf("case 18 q_ausfall_schaltet_spur_nicht_halls_ab: hash %016llx %s serial, ungleich=%d, halls on workers after the switch-off=%llu\n", (unsigned long long)ha, ha == hr ? "equals" : "DIFFERS FROM",
              ungleich, (unsigned long long)(hall_worker(a) - halls_vor));
}

// 19: mode auto
void fall19() {
  using K = cdj::HallPool;
  auto fuenf = [](K& p) {
    for (int i = 0; i < 5; ++i) p.spaet_melden(K::SPUR);
  };
  {
    Pool pool(3);
    AtomSenke sa;
    Welt a(&sa);
    a.t.arr.setze_hall_pool(&pool.p);
    a.t.arr.setze_spur_pool(2);
    a.t.arr.setze_spur_test(kein_tor());
    cdj::SpurHaken hk;
    hk.warte_worker = 3;
    a.t.arr.setze_spur_haken(&hk);
    a.laden(snap(1, 0, 0, nullptr, 0, 8), 0);
    const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
    int64_t s0 = 0;
    auto lauf = [&](int n) {
      for (int i = 0; i < n; ++i, s0 += M) a.block(s0);
    };
    lauf(10);
    PRUEF(sl.z.blocks_parallel == 10 && pool.p.an(K::SPUR));
    fuenf(pool.p);
    lauf(4095);   // the switch-off is taken at the start of the first of these: serial for 4095 blocks
    PRUEF(!pool.p.an(K::SPUR));
    PRUEF(sl.z.blocks_parallel == 10 && sl.z.seriell_aus == 4095);
    lauf(1);      // block 4096 after the switch-off: the account is on again and the phase forks
    PRUEF(pool.p.an(K::SPUR) && sl.z.blocks_parallel == 11 && sl.z.auto_neu == 1);
    lauf(20);
    PRUEF(sl.z.blocks_parallel == 31);
    fuenf(pool.p);   // the second switch-off is for good
    lauf(20000);
    if (pool.p.an(K::SPUR) || sl.z.blocks_parallel != 31 || sl.z.auto_neu != 1 || sl.z.seriell_aus != 4095 + 20000)
      std::fprintf(stderr, "case 19 diagnostics: an=%d parallel=%llu auto_neu=%llu seriell_aus=%llu spaet=%llu haengt=%llu zurueck=%llu\n", (int)pool.p.an(K::SPUR), (unsigned long long)sl.z.blocks_parallel,
                   (unsigned long long)sl.z.auto_neu, (unsigned long long)sl.z.seriell_aus, (unsigned long long)pool.p.spaet(K::SPUR), (unsigned long long)pool.p.haengt(K::SPUR), (unsigned long long)pool.p.zurueck(K::SPUR));
    PRUEF(!pool.p.an(K::SPUR));
    PRUEF(sl.z.blocks_parallel == 31 && sl.z.auto_neu == 1 && sl.z.seriell_aus == 4095 + 20000);
    std::printf("case 19 q_auto: parallel=%llu seriell_aus=%llu auto_neu=%llu spur_an=%d\n", (unsigned long long)sl.z.blocks_parallel, (unsigned long long)sl.z.seriell_aus,
                (unsigned long long)sl.z.auto_neu, (int)pool.p.an(K::SPUR));
  }
  {   // mode an never retries
    Pool pool(3);
    AtomSenke sa;
    Welt a(&sa);
    a.t.arr.setze_hall_pool(&pool.p);
    a.t.arr.setze_spur_pool(1);
    a.t.arr.setze_spur_test(kein_tor());
    cdj::SpurHaken hk;
    hk.warte_worker = 3;
    a.t.arr.setze_spur_haken(&hk);
    a.laden(snap(1, 0, 0, nullptr, 0, 8), 0);
    const cdj::ArrSpurLauf& sl = a.t.arr.spur_lauf();
    int64_t s0 = 0;
    for (int i = 0; i < 10; ++i, s0 += M) a.block(s0);
    fuenf(pool.p);
    for (int i = 0; i < 6000; ++i, s0 += M) a.block(s0);
    PRUEF(!pool.p.an(K::SPUR) && sl.z.blocks_parallel == 10 && sl.z.auto_neu == 0 && sl.z.seriell_aus == 6000);
  }
}

}  // namespace

int main(int argc, char** argv) {
  void (*falle[])() = {fall1, fall2, fall3, fall4, fall5, fall6, fall7, fall8, fall9, fall10, fall11, fall12, fall13, fall14, fall15, fall16, fall17, fall18, fall19, fall20, fall21, fall22, fall23};
  if (argc > 1) {   // a single case for debugging: test_arr_spur_pool <1..23>
    const int n = std::atoi(argv[1]);
    if (n >= 1 && n <= 23) falle[n - 1]();
  } else {
    for (auto f : falle) {
      f();
      if (pruef_fehler) break;   // stop at the first red case: a broken join (mutation) leaves jobs running on worlds that the next cases would destroy under them
    }
  }
  PRUEF_ENDE();
}
