// Mehrkern slice 3.1, task 1: the per-lane work struct of the track sinks (arr_arbeit.h, ArrSenke::block_bahn).
//   1 bahn_bitgleich:         8 RB tracks, 2000 blocks, one unit at a time through ArrInternSenke::block_bahn on lanes 0..3 in rotation:
//                             bit-equal to block() for every track (also over a parameter swap in the middle)
//   2 bahn_zwei_faeden:       two real threads run two different tracks at once on lanes 1 and 2 (a barrier per block), 5 runs, bit-equal
//                             to the serial run of each track. The real proof against shared scratch.
//   3 bahn_zaehler_atomar:    verloren_ and abgelehnt_ after two threads with injected errors equal the serial sum
//   4 bahn_protokoll_parallel: two threads start the parameters of different tracks at the same time: every entry exactly once, the order
//                             inside one track is kept, the count and the multiset equal the serial run
//   5 bahn_parallel_faehig:   loaded rb338 true, empty / bk / Wirt false, a real device transition false (bk->rb338 discriminates;
//                             rb338->bk is covered by bk being not parallel-capable), a swap that only changes a parameter stays
//                             true (fails with a "zuletzt_ non-empty" predicate)
// Mutation: SPUR_SCRATCH_GEMEINSAM (the RB scratch ignores the lane) must turn case 2 red.
#include <algorithm>
#include <atomic>
#include <barrier>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "arr_build.h"
#include "bk_help.h"
#include "cypherdj/arr_arbeit.h"
#include "cypherdj/arr_bk_sink.h"
#include "cypherdj/arr_intern_sink.h"
#include "cypherdj/arr_rb_sink.h"
#include "cypherdj/arr_host_sink.h"
#include "check.h"

using namespace arrtest;
using cdj::ArrArt;

namespace cdj {
struct ArrRbPruefZugang {   // friend of ArrRbSenke: reads the set log
  static uint64_t n(const ArrRbSenke& s) { return s.protokoll_n_.load(); }
  static const ArrRbSenke::Protokoll& e(const ArrRbSenke& s, uint64_t i) {   // entry i of the merged order (by sequence number); an overwritten entry reads as an empty one
    static const ArrRbSenke::Protokoll leer{-1, "", 0.0f, ~0ull};
    const ArrRbSenke::Protokoll* x = s.protokoll_lies(i);
    return x ? *x : leer;
  }
};
}  // namespace cdj

namespace {

constexpr int M = 256;

cdj::ArrSnapshot* snap(int64_t nr, int n, int variante, bool bogus = false) {
  Bau b(nr);
  for (int i = 0; i < n; ++i) b.spur(i + 1, ArrArt::intern);
  cdj::ArrSnapshot* s = b.fertig();
  for (int i = 0; i < n; ++i) {
    cdj::ArrSpur& sp = s->spur[i];
    std::snprintf(sp.geraet, sizeof sp.geraet, "rb338");
    auto p = [&](const char* name, float w) {
      std::snprintf(sp.param[sp.n_param].name, sizeof sp.param[0].name, "%s", name);
      sp.param[sp.n_param++].wert = w;
    };
    p("cutoff", 0.15f + 0.07f * static_cast<float>(i) + 0.03f * static_cast<float>(variante));
    p("resonanz", 0.2f + 0.05f * static_cast<float>(i % 4));
    p("decay", 0.3f + 0.04f * static_cast<float>(i));
    if (bogus) p("bogus", 0.5f);
  }
  return s;
}

struct Welt {
  Treiber t;
  cdj::ArrRbSenke rb{t.arr};
  cdj::ArrBkSenke bk{t.arr};
  cdj::ArrInternSenke intern{t.arr, &rb, &bk, nullptr};
  Welt() { t.arr.setze_senke_intern(&intern); }
  void laden(cdj::ArrSnapshot* s, int64_t s0) {
    t.s = s0;
    t.laden(s);
  }
};

// the notes of track `spur` in block `b` (deterministic, different per track), through the dispatcher
void speise(cdj::ArrSenke& s, int spur, int b, int64_t s0) {
  if (b == 0) s.transport_start(spur, s0);
  const int ph = b % 11;
  const uint8_t ton = static_cast<uint8_t>(33 + spur * 3 + (b / 11) % 5);
  if (ph == 0) s.note(spur, s0 + (b * 7 + spur * 13) % M, ton, static_cast<uint8_t>(90 + spur), true);
  if (ph == 6) s.note(spur, s0 + (b * 5 + spur * 3) % M, ton, 0, false);
}

bool gleich(const std::vector<float>& a, const std::vector<float>& b) {
  return a.size() == b.size() && std::memcmp(a.data(), b.data(), a.size() * sizeof(float)) == 0;
}
double energie(const std::vector<float>& l) {
  double e = 0.0;
  for (float x : l) e += static_cast<double>(x) * x;
  return e;
}

// 1: serial (block) against block_bahn on rotating lanes
void fall1() {
  constexpr int N = 8, BL = 2000;
  Welt a, b;
  a.laden(snap(1, N, 0), 0);
  b.laden(snap(1, N, 0), 0);
  auto lanes = std::make_unique<cdj::ArrArbeit[]>(4);
  for (int i = 0; i < 4; ++i) lanes[i].bahn = i;
  std::vector<float> oa[N], ob[N];
  bool alle_gleich = true;
  for (int blk = 0; blk < BL; ++blk) {
    const int64_t s0 = static_cast<int64_t>(blk) * M;
    if (blk == 1000) {   // a parameter swap in the middle, the same in both
      a.laden(snap(2, N, 1), s0);
      b.laden(snap(2, N, 1), s0);
    }
    for (int i = 0; i < N; ++i) {
      speise(a.intern, i, blk, s0);
      speise(b.intern, i, blk, s0);
      float la[M] = {}, ra[M] = {}, lb[M] = {}, rb[M] = {};
      a.intern.block(i, s0, M, la, ra);
      b.intern.block_bahn(i, s0, M, lb, rb, lanes[(blk + i) % 4]);
      alle_gleich = alle_gleich && std::memcmp(la, lb, sizeof la) == 0 && std::memcmp(ra, rb, sizeof ra) == 0;
      oa[i].insert(oa[i].end(), la, la + M);
      ob[i].insert(ob[i].end(), lb, lb + M);
    }
  }
  PRUEF(alle_gleich);
  for (int i = 0; i < N; ++i) {
    PRUEF(gleich(oa[i], ob[i]));
    PRUEF(energie(oa[i]) > 1e-3);   // not vacuous
    if (i > 0) PRUEF(!gleich(oa[i], oa[i - 1]));   // the tracks differ
  }
  uint32_t summe = 0;
  for (int i = 0; i < 4; ++i) {
    PRUEF(lanes[i].einheiten > 0);   // every lane rendered units
    summe += lanes[i].einheiten;
  }
  PRUEF(summe == static_cast<uint32_t>(N * BL));
  std::printf("case 1 bahn_bitgleich: %d tracks x %d blocks, lanes 0..3 units %u/%u/%u/%u\n", N, BL, lanes[0].einheiten, lanes[1].einheiten,
              lanes[2].einheiten, lanes[3].einheiten);
}

// 2: two threads, two tracks, lanes 1 and 2
void fall2() {
  constexpr int BL = 2000, WIEDER = 5;
  const int spur[2] = {1, 4};
  // serial reference: each track alone through block()
  std::vector<float> ref[2];
  {
    Welt w;
    w.laden(snap(1, 8, 0), 0);
    for (int blk = 0; blk < BL; ++blk)
      for (int k = 0; k < 2; ++k) {
        const int64_t s0 = static_cast<int64_t>(blk) * M;
        speise(w.intern, spur[k], blk, s0);
        float l[M] = {}, r[M] = {};
        w.intern.block(spur[k], s0, M, l, r);
        ref[k].insert(ref[k].end(), l, l + M);
      }
  }
  PRUEF(energie(ref[0]) > 1e-3 && energie(ref[1]) > 1e-3 && !gleich(ref[0], ref[1]));
  int rot = 0;
  for (int w_nr = 0; w_nr < WIEDER; ++w_nr) {
    Welt w;
    w.laden(snap(1, 8, 0), 0);
    auto lanes = std::make_unique<cdj::ArrArbeit[]>(4);
    for (int i = 0; i < 4; ++i) lanes[i].bahn = i;
    std::vector<float> aus[2];
    std::barrier bar(2);
    auto lauf = [&](int k) {
      for (int blk = 0; blk < BL; ++blk) {
        const int64_t s0 = static_cast<int64_t>(blk) * M;
        speise(w.intern, spur[k], blk, s0);
        float l[M] = {}, r[M] = {};
        bar.arrive_and_wait();   // both start the unit together
        w.intern.block_bahn(spur[k], s0, M, l, r, lanes[1 + k]);
        aus[k].insert(aus[k].end(), l, l + M);
      }
    };
    std::thread t0(lauf, 0), t1(lauf, 1);
    t0.join();
    t1.join();
    for (int k = 0; k < 2; ++k) PRUEF(gleich(aus[k], ref[k]));
    PRUEF(lanes[1].einheiten == BL && lanes[2].einheiten == BL && lanes[0].einheiten == 0);
    rot += lanes[1].einheiten + lanes[2].einheiten;
  }
  std::printf("case 2 bahn_zwei_faeden: %d runs x %d blocks, %d units on lanes 1 and 2\n", WIEDER, BL, rot);
}

// 3: counters
struct Zaehl {
  uint64_t verloren, abgelehnt;
};
void speise_fehler(cdj::ArrSenke& s, int spur, int64_t s0) {
  s.transport_start(spur, s0);   // every block starts: vorgaben + every parameter, "bogus" is refused
  for (int i = 0; i < 280; ++i) s.note(spur, s0, static_cast<uint8_t>(40 + i % 20), 100, true);   // over ARR_RB_WARTE (256)
}
void fall3() {
  constexpr int BL = 300;
  const int spur[2] = {0, 5};
  Zaehl ser{}, par{};
  {
    Welt w;
    w.laden(snap(1, 8, 0, true), 0);
    for (int blk = 0; blk < BL; ++blk)
      for (int k = 0; k < 2; ++k) {
        const int64_t s0 = static_cast<int64_t>(blk) * M;
        speise_fehler(w.intern, spur[k], s0);
        float l[M] = {}, r[M] = {};
        w.intern.block(spur[k], s0, M, l, r);
      }
    ser = {w.rb.verloren(), w.rb.parameter_abgelehnt()};
  }
  {
    Welt w;
    w.laden(snap(1, 8, 0, true), 0);
    auto lanes = std::make_unique<cdj::ArrArbeit[]>(4);
    for (int i = 0; i < 4; ++i) lanes[i].bahn = i;   // the sink files its log by lane
    std::barrier bar(2);
    auto lauf = [&](int k) {
      for (int blk = 0; blk < BL; ++blk) {
        const int64_t s0 = static_cast<int64_t>(blk) * M;
        speise_fehler(w.intern, spur[k], s0);
        float l[M] = {}, r[M] = {};
        bar.arrive_and_wait();
        w.intern.block_bahn(spur[k], s0, M, l, r, lanes[1 + k]);
      }
    };
    std::thread t0(lauf, 0), t1(lauf, 1);
    t0.join();
    t1.join();
    par = {w.rb.verloren(), w.rb.parameter_abgelehnt()};
  }
  std::printf("case 3 bahn_zaehler_atomar: serial verloren %llu abgelehnt %llu, parallel verloren %llu abgelehnt %llu\n",
              static_cast<unsigned long long>(ser.verloren), static_cast<unsigned long long>(ser.abgelehnt),
              static_cast<unsigned long long>(par.verloren), static_cast<unsigned long long>(par.abgelehnt));
  PRUEF(ser.verloren >= static_cast<uint64_t>(2 * BL * 24));
  PRUEF(ser.abgelehnt >= static_cast<uint64_t>(2 * BL));
  PRUEF(par.verloren == ser.verloren);
  PRUEF(par.abgelehnt == ser.abgelehnt);
}

// 4: protocol ring
struct Eintrag {
  int spur;
  std::string name;
  float wert;
  bool operator<(const Eintrag& o) const {
    if (spur != o.spur) return spur < o.spur;
    if (name != o.name) return name < o.name;
    return wert < o.wert;
  }
  bool operator==(const Eintrag& o) const { return spur == o.spur && name == o.name && wert == o.wert; }
};
std::vector<Eintrag> lies(const cdj::ArrRbSenke& s, uint64_t von, uint64_t bis) {
  std::vector<Eintrag> v;
  for (uint64_t i = von; i < bis; ++i) {
    const auto& e = cdj::ArrRbPruefZugang::e(s, i);
    v.push_back({e.spur, e.name, e.wert});
  }
  return v;
}
void fall4() {
  constexpr int RUNDEN = 150;
  const int spur[2] = {2, 6};
  Welt ser, par;
  ser.laden(snap(1, 8, 0), 0);
  par.laden(snap(1, 8, 0), 0);
  auto lanes = std::make_unique<cdj::ArrArbeit[]>(4);
  for (int b = 0; b < 4; ++b) lanes[b].bahn = b;   // the sink files its log by lane: two threads must not share lane 0
  std::barrier start(3), ende(3);
  std::atomic<int> runde{0};
  auto lauf = [&](int k) {
    for (int r = 0; r < RUNDEN; ++r) {
      start.arrive_and_wait();
      const int64_t s0 = static_cast<int64_t>(r) * M;
      par.intern.transport_start(spur[k], s0);
      float l[M] = {}, rr[M] = {};
      par.intern.block_bahn(spur[k], s0, M, l, rr, lanes[1 + k]);
      ende.arrive_and_wait();
    }
  };
  std::thread t0(lauf, 0), t1(lauf, 1);
  bool alle_gut = true, ordnung = true, anzahl = true;
  for (int r = 0; r < RUNDEN; ++r) {
    const int64_t s0 = static_cast<int64_t>(r) * M;
    const uint64_t n0 = cdj::ArrRbPruefZugang::n(par.rb), s_n0 = cdj::ArrRbPruefZugang::n(ser.rb);
    for (int k = 0; k < 2; ++k) {
      ser.intern.transport_start(spur[k], s0);
      float l[M] = {}, rr[M] = {};
      ser.intern.block(spur[k], s0, M, l, rr);
    }
    start.arrive_and_wait();
    ende.arrive_and_wait();
    const uint64_t n1 = cdj::ArrRbPruefZugang::n(par.rb), s_n1 = cdj::ArrRbPruefZugang::n(ser.rb);
    anzahl = anzahl && n1 - n0 == s_n1 - s_n0 && n1 - n0 > 0 && n1 - n0 < 64;   // PROTOKOLL_N: the ring must not wrap between two reads
    std::vector<Eintrag> p = lies(par.rb, n0, n1), s = lies(ser.rb, s_n0, s_n1);
    // order inside one track: <vorgaben>, cutoff, resonanz, decay
    for (int k = 0; k < 2; ++k) {
      std::vector<std::string> namen;
      for (const Eintrag& e : p)
        if (e.spur == spur[k]) namen.push_back(e.name);
      ordnung = ordnung && namen == std::vector<std::string>{"<vorgaben>", "cutoff", "resonanz", "decay"};
    }
    std::sort(p.begin(), p.end());
    std::sort(s.begin(), s.end());
    alle_gut = alle_gut && p == s;
  }
  t0.join();
  t1.join();
  PRUEF(anzahl);
  PRUEF(ordnung);
  PRUEF(alle_gut);
  std::printf("case 4 bahn_protokoll_parallel: %d rounds, count/order/multiset equal to serial: %d/%d/%d\n", RUNDEN, anzahl, ordnung, alle_gut);
}

// 5: parallel_faehig
void fall5() {
  CypherBk* h = bkt::neu(bkt::G_T);
  CypherBk* h2 = bkt::neu(bkt::G_T);
  {
    Welt w;
    cdj::ArrSnapshot* s = snap(1, 3, 0);   // tracks 0..2 rb338
    bkt::spur(s, 2, h, 1, {{"k1", 0.7f}});   // track index 1 becomes bk
    std::memset(&s->spur[2], 0, sizeof s->spur[2]);   // track index 2: empty (no art)
    w.laden(s, 0);
    PRUEF(w.rb.parallel_faehig(0));
    PRUEF(w.intern.parallel_faehig(0));       // loaded rb338
    PRUEF(!w.intern.parallel_faehig(1));      // bk
    PRUEF(!w.bk.parallel_faehig(1));
    PRUEF(!w.intern.parallel_faehig(2));      // empty
    PRUEF(!w.rb.parallel_faehig(2));
    PRUEF(!w.intern.parallel_faehig(7));      // never set up
    PRUEF(!w.intern.parallel_faehig(-1) && !w.intern.parallel_faehig(cdj::ARR_SPUREN));
    int zn = M;
    int64_t z0 = 0;
    cdj::ArrWirtSenke wirt(0, &zn, &z0);
    PRUEF(!wirt.parallel_faehig(0));          // host return path
    // the track has played blocks (zuletzt_ is set to the RB sink in every block) and a swap only changes a parameter: stays true
    for (int blk = 0; blk < 20; ++blk) {
      float l[M] = {}, r[M] = {};
      speise(w.intern, 0, blk, blk * M);
      w.intern.block(0, blk * M, M, l, r);
    }
    PRUEF(w.intern.parallel_faehig(0));
    w.laden(snap(2, 3, 1), 20 * M);
    PRUEF(w.intern.parallel_faehig(0));       // same device, other parameter: no transition
    // transition rb338 -> bk: zuletzt_ = RB sink, innen = bk sink
    cdj::ArrSnapshot* t = snap(3, 3, 1);
    bkt::spur(t, 1, h, 1, {{"k1", 0.7f}});
    bkt::spur(t, 2, h2, 1, {{"k1", 0.6f}});   // track index 1 plays bk as well (its own instance)
    w.laden(t, 20 * M);
    PRUEF(!w.intern.parallel_faehig(0));      // (bk is false anyway for the inner sink; the transition is covered by the reverse below)
    // transition bk -> rb338 on track index 1: play it on bk first, then swap it to rb338
    for (int blk = 20; blk < 24; ++blk) {
      float l[M] = {}, r[M] = {};
      w.intern.block(1, blk * M, M, l, r);
    }
    PRUEF(!w.intern.parallel_faehig(1));      // bk, no transition
    w.laden(snap(4, 3, 1), 24 * M);
    PRUEF(!w.intern.parallel_faehig(1));      // transition bk -> rb338: zuletzt_ = bk sink, innen = RB sink; the inner sink alone would say true
    PRUEF(w.rb.parallel_faehig(1));
    {
      float l[M] = {}, r[M] = {};
      w.intern.block(1, 24 * M, M, l, r);     // the transition block runs, zuletzt_ moves to the RB sink
    }
    PRUEF(w.intern.parallel_faehig(1));       // transition over
  }
  cypher_bk_frei(h);
  cypher_bk_frei(h2);
  std::printf("case 5 bahn_parallel_faehig done\n");
}

}  // namespace

int main() {
  fall1();
  fall2();
  fall3();
  fall4();
  fall5();
  PRUEF_ENDE();
}
