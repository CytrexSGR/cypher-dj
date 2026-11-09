// Mehrkern slice 3.1, task 2: ArrInserts and ArrPdc per lane (kette_bahn, schweige_bahn, nach_join, the per-strip slot mirror, the
// verzoegere overload with caller scratch). No Arrangement: the chains are driven directly.
//   1 ketten_bahn_bitgleich:         six chains once through kette() and once through kette_bahn() on lanes 1..3 in rotation: output, maske_
//                                    after nach_join and the NaN count equal. Every stage toggles `an` in every block.
//   2 ketten_zwei_faeden:            two real threads run two chains (with PDC through the new overload) at once on lanes 1 and 2, a barrier
//                                    per block, 2000 blocks, 5 runs, bit-equal to the serial run; the NaN counters of the lanes after nach_join
//                                    equal the serial sum. Followed by a PDC-only hammer of two threads (the shift scratch window is short).
//   3 ketten_maske:                  a tail that ends clears its strip bit only in nach_join
//   4 ketten_schwanz_und_spiegel:    besitzer_ is untouched during a fork, set to -1 by nach_join; the mirror equals besitzer_ after tausche,
//                                    nach_join, schweige_bahn and ruhe; the poison probe is case 4b
//   4b                               serial poison probe: every besitzer_ entry reads 999 while both lane forms run, output equals the unpoisoned run
//   6 scratch deterministic:         one thread: the lane's pdc_tmp / dry_ buffers are pre-filled and must be overwritten by a lane form
//   5 pdc_bahn_bitgleich:            nine keys with different delays through the lane overload on rotating lanes = the old overload
// Mutations: SPUR_DRY_GEMEINSAM (the dry scratch ignores the lane) and SPUR_PDC_GEMEINSAM (the PDC scratch ignores the lane) must turn case 2 red,
// SPUR_BESITZER_GEMEINSAM (kette_bahn writes besitzer_ when a tail ends) must turn case 4 red, SPUR_BESITZER_GELESEN (kette_bahn reads besitzer_) case 4b.
// SPUR_DRY_GEMEINSAM and SPUR_PDC_GEMEINSAM also turn case 6 red without any timing luck.
#include <atomic>
#include <barrier>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <thread>
#include <vector>

#include "cypherdj/arr_arbeit.h"
#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_pdc.h"
#include "check.h"

namespace cdj {
struct ArrInsertsPruefZugang {
  static void gift(ArrInserts& i, int slot, int w) { i.besitzer_[slot] = w; }
  static int wert(const ArrInserts& i, int slot) { return i.besitzer_[slot]; }
};
}  // namespace cdj

using namespace cdj;

namespace {

constexpr int M = 256;
constexpr int STR = 6;                              // strips under test
constexpr int GLOBAL_EQ0 = ARR_INS_KOMP;            // global index of eq 0
constexpr int GLOBAL_SAETT0 = ARR_INS_KOMP + ARR_INS_EQ;
constexpr int PDC_D[STR] = {0, 37, 100, 255, 511, 1023};   // below and above the block size, none, near the ring end

struct Rig {
  ArrInserts ins;
  ArrPdc pdc;
  ArrKette ketten[ARR_KETTEN];
  Rig() {
    auto k = [&](int st, std::initializer_list<ArrStufe> l) {
      ketten[st].n = 0;
      for (const ArrStufe& x : l) ketten[st].st[ketten[st].n++] = x;
    };
    k(0, {ArrStufe{ArrInsArt::komp, 0, true}, ArrStufe{ArrInsArt::saett, 0, true}});
    k(1, {ArrStufe{ArrInsArt::komp, 1, true}, ArrStufe{ArrInsArt::komp, 2, true}});
    k(2, {ArrStufe{ArrInsArt::komp, 3, true}, ArrStufe{ArrInsArt::eq, 0, true}});
    k(3, {ArrStufe{ArrInsArt::komp, 4, true}});
    k(4, {ArrStufe{ArrInsArt::komp, 5, true}, ArrStufe{ArrInsArt::komp, 6, true}});
    k(5, {ArrStufe{ArrInsArt::komp, 7, true}});
    for (int s = 0; s < ARR_INS_KOMP; ++s) {   // every stage switched on, a compressor that works on the test signal
      ins.setze_sofort(s, 0, 1.0f);
      ins.setze_sofort(s, 1, -30.0f);
      ins.setze_sofort(s, 2, 8.0f);
      ins.setze_sofort(s, 3, 6.0f);
      ins.setze_sofort(s, 4, 10.0f);
      ins.setze_sofort(s, 5, 120.0f);
      ins.setze_sofort(s, 6, 0.0f);
      ins.setze_sofort(s, 7, 1.0f);
      ins.setze_sofort(s, 8, 0.0f);
      ins.setze_sofort(s, 9, 0.0f);
    }
    ins.setze_sofort(GLOBAL_EQ0, 0, 1.0f);
    ins.setze_sofort(GLOBAL_SAETT0, 0, 1.0f);
    ins.setze_sofort(GLOBAL_SAETT0, 1, 12.0f);
    ins.setze_sofort(GLOBAL_SAETT0, 2, -6.0f);
    ins.setze_sofort(GLOBAL_SAETT0, 3, 1.0f);
    ins.tausche(ketten);
  }
  // every stage toggles in every block: a blend takes 480 samples, so no stage is ever steady and stufe() writes the dry scratch in every block
  ArrKette toggled(int st, int blk) const {
    ArrKette k = ketten[st];
    for (int j = 0; j < k.n; ++j) k.st[j].an = ((blk + st + j) & 1) == 0;
    return k;
  }
};

void signal(int st, int blk, float* l, float* r, bool nan = true) {
  uint32_t x = 0x9E3779B9u * static_cast<uint32_t>(st + 1) + 0x85EBCA6Bu * static_cast<uint32_t>(blk + 1);
  for (int t = 0; t < M; ++t) {
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    const float a = static_cast<float>(static_cast<int32_t>(x)) * (0.9f / 2147483648.0f);
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    l[t] = a;
    r[t] = static_cast<float>(static_cast<int32_t>(x)) * (0.9f / 2147483648.0f);
  }
  if (nan && st == 1 && blk == 700) l[10] = std::numeric_limits<float>::quiet_NaN();
}

struct Spur {
  std::vector<float> o[STR];
  std::vector<uint64_t> maske;
  uint64_t nan = 0;
  void init(int bl) {
    for (auto& v : o) v.assign(static_cast<size_t>(bl) * M * 2, 0.0f);
    maske.assign(static_cast<size_t>(bl), 0);
  }
  void ablegen(int st, int blk, const float* l, const float* r) {
    std::memcpy(&o[st][static_cast<size_t>(blk) * M * 2], l, sizeof(float) * M);
    std::memcpy(&o[st][static_cast<size_t>(blk) * M * 2 + M], r, sizeof(float) * M);
  }
};

bool gleich(const Spur& a, const Spur& b, int bl, const char* was) {
  bool ok = true;
  for (int st = 0; st < STR; ++st)
    if (std::memcmp(a.o[st].data(), b.o[st].data(), sizeof(float) * a.o[st].size()) != 0) {
      for (size_t i = 0; i < a.o[st].size(); ++i)
        if (std::memcmp(&a.o[st][i], &b.o[st][i], sizeof(float)) != 0) {
          std::fprintf(stderr, "%s: strip %d first differs at block %zu sample %zu\n", was, st, i / (M * 2), i % (M * 2));
          break;
        }
      ok = false;
    }
  if (a.maske != b.maske) ok = false;
  if (a.nan != b.nan) ok = false;
  (void)bl;
  return ok;
}

void seriell(Spur& sp, int bl) {
  auto rig = std::make_unique<Rig>();
  sp.init(bl);
  float l[M], r[M];
  for (int blk = 0; blk < bl; ++blk) {
    rig->pdc.neuer_block();
    for (int st = 0; st < STR; ++st) {
      signal(st, blk, l, r);
      const ArrKette k = rig->toggled(st, blk);
      rig->ins.kette(st, &k, l, r, M);
      rig->pdc.verzoegere(st, PDC_D[st], l, r, M);
      sp.ablegen(st, blk, l, r);
    }
    sp.maske[static_cast<size_t>(blk)] = rig->ins.maske();
  }
  sp.nan = rig->ins.nan_zaehler();
}

// 1
void fall1() {
  constexpr int BL = 1500;
  Spur ser, bahn;
  seriell(ser, BL);
  auto rig = std::make_unique<Rig>();
  auto lanes = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
  bahn.init(BL);
  float l[M], r[M];
  for (int blk = 0; blk < BL; ++blk) {
    rig->pdc.neuer_block();
    for (int st = 0; st < STR; ++st) {
      ArrArbeit& a = lanes[1 + (st + blk) % 3];
      signal(st, blk, l, r);
      const ArrKette k = rig->toggled(st, blk);
      rig->ins.kette_bahn(st, &k, l, r, M, a);
      rig->pdc.verzoegere(st, PDC_D[st], l, r, M, a.pdc_tmp);
      bahn.ablegen(st, blk, l, r);
    }
    rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN);
    bahn.maske[static_cast<size_t>(blk)] = rig->ins.maske();
  }
  bahn.nan = rig->ins.nan_zaehler();
  PRUEF(ser.nan >= 1);   // the injected NaN was seen
  PRUEF(gleich(ser, bahn, BL, "case 1"));
  std::printf("case 1 ketten_bahn_bitgleich: %d blocks, nan=%llu\n", BL, static_cast<unsigned long long>(ser.nan));
}

// 2
void fall2() {
  constexpr int BL = 2000, WIEDER = 5;
  Spur ser;
  seriell(ser, BL);
  const int streifen[2][3] = {{0, 2, 4}, {1, 3, 5}};
  for (int w = 0; w < WIEDER; ++w) {
    auto rig = std::make_unique<Rig>();
    auto lanes = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
    Spur par;
    par.init(BL);
    std::barrier bar(3);
    uint32_t nan_lane_vor_join = 0;
    auto lauf = [&](int k) {
      float l[M], r[M];
      for (int blk = 0; blk < BL; ++blk) {
        bar.arrive_and_wait();
        for (int st : streifen[k]) {
          signal(st, blk, l, r);
          const ArrKette kt = rig->toggled(st, blk);
          rig->ins.kette_bahn(st, &kt, l, r, M, lanes[1 + k]);
          rig->pdc.verzoegere(st, PDC_D[st], l, r, M, lanes[1 + k].pdc_tmp);
          par.ablegen(st, blk, l, r);
        }
        bar.arrive_and_wait();
      }
    };
    std::thread t0(lauf, 0), t1(lauf, 1);
    for (int blk = 0; blk < BL; ++blk) {
      rig->pdc.neuer_block();
      bar.arrive_and_wait();
      bar.arrive_and_wait();
      if (blk == 700) nan_lane_vor_join = lanes[2].nan_zaehler;   // strip 1 runs on lane 2
      rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN);
      par.maske[static_cast<size_t>(blk)] = rig->ins.maske();
    }
    t0.join();
    t1.join();
    par.nan = rig->ins.nan_zaehler();
    PRUEF(nan_lane_vor_join >= 1);
    PRUEF(lanes[1].nan_zaehler == 0 && lanes[2].nan_zaehler == 0);   // reset by nach_join
    PRUEF(gleich(ser, par, BL, "case 2"));
  }
  // PDC only: two threads shift different keys of ONE ArrPdc with their own scratch, started together by a barrier every round (the shift window of
  // the scratch is a few hundred nanoseconds), blocks of 1024 samples with a delay of 1000 for the longest window. The history of a key carries from
  // round to round, so a corrupted scratch shows in the next round's output.
  {
    constexpr int N = 4000, MM = 1024, D = 1000;
    auto ref = std::make_unique<ArrPdc>();
    auto par = std::make_unique<ArrPdc>();
    std::vector<float> ro[2], po[2];
    for (int k = 0; k < 2; ++k) { ro[k].assign(static_cast<size_t>(N) * MM, 0.0f); po[k].assign(static_cast<size_t>(N) * MM, 0.0f); }
    auto gen = [&](int k, int n, float* x) {
      uint32_t v = 0x2545F491u * static_cast<uint32_t>(k + 1) + 0x9E3779B1u * static_cast<uint32_t>(n + 1);
      for (int t = 0; t < MM; ++t) { v ^= v << 13; v ^= v >> 17; v ^= v << 5; x[t] = static_cast<float>(static_cast<int32_t>(v)) * (1.0f / 2147483648.0f); }
    };
    std::vector<float> in(MM), in2(MM);
    for (int n = 0; n < N; ++n) {
      ref->neuer_block();
      for (int k = 0; k < 2; ++k) {
        gen(k, n, in.data());
        gen(k + 5, n, in2.data());
        ref->verzoegere(k, D + k, in.data(), in2.data(), MM);
        std::memcpy(&ro[k][static_cast<size_t>(n) * MM], in.data(), sizeof(float) * MM);
      }
    }
    auto lanes = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
    std::barrier bar(3);
    auto lauf = [&](int k) {
      std::vector<float> a(MM), b(MM);
      for (int n = 0; n < N; ++n) {
        gen(k, n, a.data());
        gen(k + 5, n, b.data());
        bar.arrive_and_wait();
        par->verzoegere(k, D + k, a.data(), b.data(), MM, lanes[1 + k].pdc_tmp);
        std::memcpy(&po[k][static_cast<size_t>(n) * MM], a.data(), sizeof(float) * MM);
        bar.arrive_and_wait();
      }
    };
    std::thread t0(lauf, 0), t1(lauf, 1);
    for (int n = 0; n < N; ++n) {
      par->neuer_block();
      bar.arrive_and_wait();
      bar.arrive_and_wait();
    }
    t0.join();
    t1.join();
    for (int k = 0; k < 2; ++k) PRUEF(std::memcmp(ro[k].data(), po[k].data(), sizeof(float) * ro[k].size()) == 0);
  }
  std::printf("case 2 ketten_zwei_faeden: %d runs x %d blocks plus the PDC hammer\n", WIEDER, BL);
}

// helper: the mirror equals besitzer_ for every slot
bool spiegel_ok(const ArrInserts& ins) {
  for (int s = 0; s < ARR_INS_ALLE; ++s) {
    const int b = ArrInsertsPruefZugang::wert(ins, s);
    for (int st = 0; st < ARR_KETTEN; ++st) {
      const bool bit = (ins.slot_eigen(st) >> s) & 1u;
      if (bit != (b == st)) return false;
    }
  }
  return true;
}

// a rig with two strips (0: komp 0 + saett 0, 1: komp 1), all stages on for a few blocks, then strip 0 leaves its chain (both stages become tails)
struct Zwei {
  std::unique_ptr<Rig> rig = std::make_unique<Rig>();
  ArrKette k_ein[ARR_KETTEN], k_aus[ARR_KETTEN];
  int blk = 0;
  Zwei() {
    for (int i = 0; i < ARR_KETTEN; ++i) { k_ein[i] = ArrKette{}; k_aus[i] = ArrKette{}; }
    k_ein[0] = rig->ketten[0];
    k_ein[1].n = 1;
    k_ein[1].st[0] = ArrStufe{ArrInsArt::komp, 1, true};
    k_aus[1] = k_ein[1];   // strip 0: no chain
    rig->ins.tausche(k_ein);
  }
  void signale(int st, float* l, float* r) { signal(st, blk, l, r, false); }
};

// 3: the strip bit of a finished tail stays until nach_join, equal to the serial order afterwards
void fall3() {
  Zwei s, p;
  auto lanes = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
  float l[M], r[M], l2[M], r2[M];
  auto serie = [&](Zwei& z) {
    for (int st = 0; st < 2; ++st) {
      z.signale(st, l, r);
      z.rig->ins.kette(st, &z.k_ein[st], l, r, M);
    }
    ++z.blk;
  };
  for (int i = 0; i < 6; ++i) serie(s);
  for (int i = 0; i < 6; ++i) {
    for (int st = 0; st < 2; ++st) {
      p.signale(st, l, r);
      p.rig->ins.kette_bahn(st, &p.k_ein[st], l, r, M, lanes[1 + st]);
    }
    p.rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN);
    ++p.blk;
  }
  PRUEF(s.rig->ins.maske() == p.rig->ins.maske());
  s.rig->ins.tausche(s.k_aus);
  p.rig->ins.tausche(p.k_aus);
  PRUEF(s.rig->ins.hat(0) && p.rig->ins.hat(0));   // a tail runs
  bool ende = false;
  for (int i = 0; i < 8; ++i) {
    s.signale(0, l, r);
    s.rig->ins.kette(0, nullptr, l, r, M);
    p.signale(0, l2, r2);
    p.rig->ins.kette_bahn(0, nullptr, l2, r2, M, lanes[1]);
    PRUEF(std::memcmp(l, l2, sizeof l) == 0 && std::memcmp(r, r2, sizeof r) == 0);
    if (!s.rig->ins.hat(0) && !ende) {
      ende = true;
      PRUEF(p.rig->ins.hat(0));                       // the bit is still set before the join
      PRUEF(lanes[1].maske_loeschen == 1u);           // reported, not applied
    }
    p.rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN);
    PRUEF(s.rig->ins.maske() == p.rig->ins.maske());   // equal to the serial order after the join
    ++s.blk;
    ++p.blk;
  }
  PRUEF(ende);
  PRUEF(!p.rig->ins.hat(0));
  std::printf("case 3 ketten_maske done\n");
}

// 4: owner table untouched during a fork, freed only by nach_join, mirror in step at every writer
void fall4() {
  Zwei s, p;
  auto lanes = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
  float ls[2][M], rs[2][M], lp[2][M], rp[2][M];
  auto ser_block = [&]() {
    for (int st = 0; st < 2; ++st) {
      s.signale(st, ls[st], rs[st]);
      s.rig->ins.kette(st, (st == 0 && s.blk >= 8) ? nullptr : &s.k_ein[st], ls[st], rs[st], M);
    }
    ++s.blk;
  };
  // fork block: strip 0 on lane 1, strip 1 on lane 2, two real threads
  auto fork_block = [&](bool) {
    std::barrier bar(2);
    auto lauf = [&](int st) {
      p.signale(st, lp[st], rp[st]);
      bar.arrive_and_wait();
      p.rig->ins.kette_bahn(st, (st == 0 && p.blk >= 8) ? nullptr : &p.k_ein[st], lp[st], rp[st], M, lanes[1 + st]);
    };
    std::thread t0(lauf, 0), t1(lauf, 1);
    t0.join();
    t1.join();
    ++p.blk;
  };
  for (int i = 0; i < 6; ++i) { ser_block(); fork_block(i % 2 == 1); p.rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN); }
  // from block 6 on both rigs read their strip 0 chain as removed: the stages are tails (the swap happens between blocks, serial)
  s.blk = p.blk = 8;
  s.rig->ins.tausche(s.k_aus);
  p.rig->ins.tausche(p.k_aus);
  PRUEF(spiegel_ok(s.rig->ins) && spiegel_ok(p.rig->ins));
  int ende_gesehen = 0;
  for (int i = 0; i < 10; ++i) {
    ser_block();
    int vor[ARR_INS_ALLE];
    for (int g = 0; g < ARR_INS_ALLE; ++g) vor[g] = ArrInsertsPruefZugang::wert(p.rig->ins, g);
    fork_block(i % 2 == 0);
    for (int g = 0; g < ARR_INS_ALLE; ++g) PRUEF(ArrInsertsPruefZugang::wert(p.rig->ins, g) == vor[g]);   // untouched during the fork
    if (lanes[1].slot_frei != 0) {
      ++ende_gesehen;
      PRUEF(p.rig->ins.slot_eigen(0) == 0 || (p.rig->ins.slot_eigen(0) & lanes[1].slot_frei) == 0);   // the own mirror bit is gone
      for (int g = 0; g < ARR_INS_ALLE; ++g)
        if ((lanes[1].slot_frei >> g) & 1u) PRUEF(ArrInsertsPruefZugang::wert(p.rig->ins, g) == 0);   // still owned by strip 0 until the join
    }
    p.rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN);
    PRUEF(spiegel_ok(p.rig->ins));
    PRUEF(spiegel_ok(s.rig->ins));
    for (int st = 0; st < 2; ++st) PRUEF(std::memcmp(ls[st], lp[st], sizeof ls[st]) == 0 && std::memcmp(rs[st], rp[st], sizeof rs[st]) == 0);
    PRUEF(s.rig->ins.maske() == p.rig->ins.maske());
  }
  PRUEF(ende_gesehen >= 1);
  PRUEF(ArrInsertsPruefZugang::wert(p.rig->ins, 0) == -1 && ArrInsertsPruefZugang::wert(p.rig->ins, GLOBAL_SAETT0) == -1);
  PRUEF(p.rig->ins.slot_eigen(0) == 0);
  ArrKette kneu2;
  // tausche with a changed owner: komp 1 moves from strip 1 to strip 2
  {
    ArrKette k[ARR_KETTEN] = {};
    k[2].n = 1;
    k[2].st[0] = ArrStufe{ArrInsArt::komp, 1, true};
    kneu2 = k[2];
    p.rig->ins.tausche(k);
    PRUEF(spiegel_ok(p.rig->ins));
    PRUEF(ArrInsertsPruefZugang::wert(p.rig->ins, 1) == 2 && ((p.rig->ins.slot_eigen(2) >> 1) & 1u));
  }
  // schweige_bahn on a tail (strip 2 left its chain: komp 1 stays a tail while it has weight), then the serial wrapper's join
  {
    ArrKette k[ARR_KETTEN] = {};
    float l[M], r[M];
    for (int i = 0; i < 3; ++i) { signal(2, i, l, r, false); p.rig->ins.kette(2, &kneu2, l, r, M); }
    p.rig->ins.tausche(k);
    PRUEF(p.rig->ins.hat(2));   // a tail
    PRUEF(spiegel_ok(p.rig->ins));
    p.rig->ins.schweige_bahn(2, lanes[3]);
    PRUEF(ArrInsertsPruefZugang::wert(p.rig->ins, 1) == 2);   // not yet: the join frees it
    PRUEF(((p.rig->ins.slot_eigen(2) >> 1) & 1u) == 0);
    PRUEF(p.rig->ins.hat(2));
    p.rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN);
    PRUEF(ArrInsertsPruefZugang::wert(p.rig->ins, 1) == -1 && !p.rig->ins.hat(2) && spiegel_ok(p.rig->ins));
  }
  // ruhe
  p.rig->ins.tausche(p.k_ein);
  PRUEF(spiegel_ok(p.rig->ins));
  p.rig->ins.ruhe();
  PRUEF(spiegel_ok(p.rig->ins));
  for (int st = 0; st < ARR_KETTEN; ++st) PRUEF(p.rig->ins.slot_eigen(st) == 0);
  std::printf("case 4 ketten_schwanz_und_spiegel: tail ends seen in the fork %d\n", ende_gesehen);
}

// 5: nine keys with different delays through the lane overload on rotating lanes = the old overload
void fall5() {
  constexpr int BL = 600, K = 9;
  const int d[K] = {1, 37, 100, 255, 256, 257, 511, 900, 1023};
  ArrPdc alt, neu;
  auto lanes = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
  bool ok = true;
  float a[M], b[M], c[M], e[M];
  for (int blk = 0; blk < BL; ++blk) {
    alt.neuer_block();
    neu.neuer_block();
    for (int k = 0; k < K; ++k) {
      signal(k, blk, a, b, false);
      std::memcpy(c, a, sizeof a);
      std::memcpy(e, b, sizeof b);
      const bool sig = !(blk % 50 >= 45);   // a tail flush now and then
      if (!sig) { std::memset(a, 0, sizeof a); std::memset(b, 0, sizeof b); std::memset(c, 0, sizeof c); std::memset(e, 0, sizeof e); }
      alt.verzoegere(k, d[k], a, b, M, sig);
      neu.verzoegere(k, d[k], c, e, M, lanes[(k + blk) % 4].pdc_tmp, sig);
      ok = ok && std::memcmp(a, c, sizeof a) == 0 && std::memcmp(b, e, sizeof b) == 0 && alt.historie(k) == neu.historie(k) && alt.schwanz(k, d[k]) == neu.schwanz(k, d[k]);
    }
  }
  PRUEF(ok);
  std::printf("case 5 pdc_bahn_bitgleich done\n");
}

// 4b: serial poison probe. Every owner entry reads 999 (a strip no one has) while both lane forms run; the output must equal the unpoisoned
// serial run, in the steady state and over a tail that ends. A lane form that reads besitzer_ finds no stage and passes the signal through.
void fall4b() {
  Zwei s, p;
  auto lanes = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
  float ls[2][M], rs[2][M], lp[2][M], rp[2][M];
  bool ok = true;
  for (int i = 0; i < 18; ++i) {
    if (i == 6) {
      s.rig->ins.tausche(s.k_aus);
      p.rig->ins.tausche(p.k_aus);
    }
    int owner[ARR_INS_ALLE];
    for (int g = 0; g < ARR_INS_ALLE; ++g) owner[g] = ArrInsertsPruefZugang::wert(p.rig->ins, g);
    for (int st = 0; st < 2; ++st) {
      s.signale(st, ls[st], rs[st]);
      p.signale(st, lp[st], rp[st]);
      s.rig->ins.kette(st, (st == 0 && i >= 6) ? nullptr : &s.k_ein[st], ls[st], rs[st], M);
    }
    for (int g = 0; g < ARR_INS_ALLE; ++g) ArrInsertsPruefZugang::gift(p.rig->ins, g, 999);
    for (int st = 0; st < 2; ++st) p.rig->ins.kette_bahn(st, (st == 0 && i >= 6) ? nullptr : &p.k_ein[st], lp[st], rp[st], M, lanes[1 + st]);
    for (int g = 0; g < ARR_INS_ALLE; ++g) ArrInsertsPruefZugang::gift(p.rig->ins, g, owner[g]);
    p.rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN);
    for (int st = 0; st < 2; ++st) ok = ok && std::memcmp(ls[st], lp[st], sizeof ls[st]) == 0 && std::memcmp(rs[st], rp[st], sizeof rs[st]) == 0;
    ok = ok && spiegel_ok(p.rig->ins) && s.rig->ins.maske() == p.rig->ins.maske();
    ++s.blk;
    ++p.blk;
  }
  PRUEF(ok);
  std::printf("case 4b poisoned owner table done\n");
}

// 6: deterministic scratch proof, one thread. A lane form must write the scratch OF ITS LANE: the lane buffers are pre-filled with a pattern
// (NaN for the dry copy), the call must overwrite them. A scratch that ignores the lane leaves the pattern standing.
void fall6() {
  auto lanes = std::make_unique<ArrArbeit[]>(ARR_ARBEIT_BAHNEN);
  // PDC: the tail of the input (the last min(d, m) samples of the right channel, the channel shifted last) ends in the scratch
  for (const int d : {100, 255, 256, 300}) {
    ArrArbeit& a = lanes[2];
    for (int i = 0; i < ARR_PDC_RING; ++i) a.pdc_tmp[i] = 12345.0f + static_cast<float>(i);
    ArrPdc pdc;
    pdc.neuer_block();
    float l[M], r[M], r0[M];
    signal(3, d, l, r, false);
    std::memcpy(r0, r, sizeof r);
    pdc.verzoegere(0, d, l, r, M, a.pdc_tmp);
    const int n = d < M ? d : M;
    const int von = d < M ? M - d : 0;   // m >= d: the last d input samples; m < d: the whole block
    bool ok = true;
    for (int i = 0; i < n; ++i) ok = ok && std::memcmp(&a.pdc_tmp[i], &r0[von + i], sizeof(float)) == 0;
    for (int i = n; i < ARR_PDC_RING; ++i) ok = ok && a.pdc_tmp[i] == 12345.0f + static_cast<float>(i);   // nothing beyond what was shifted
    PRUEF(ok);
  }
  // dry: a stage that blends (an switched on in the first block, weight rising) writes the dry copy into the lane buffer. Strip 3 has no latency
  // (memcpy path), strip 0 has the saturator (latency 69, dry ring path).
  for (const int st : {3, 0}) {
    ArrArbeit& a = lanes[3];
    const float nan = std::numeric_limits<float>::quiet_NaN();
    for (int i = 0; i < INS_BLOCK; ++i) a.dry_l[i] = a.dry_r[i] = nan;
    auto rig = std::make_unique<Rig>();
    ArrKette k = rig->ketten[st];
    for (int j = 0; j < k.n; ++j) k.st[j].an = true;
    float l[M], r[M];
    signal(st, 1, l, r, false);
    rig->ins.kette_bahn(st, &k, l, r, M, a);
    bool ok = true;
    for (int i = 0; i < M; ++i) ok = ok && !std::isnan(a.dry_l[i]) && !std::isnan(a.dry_r[i]);
    PRUEF(ok);
    rig->ins.nach_join(lanes.get(), ARR_ARBEIT_BAHNEN);
  }
  std::printf("case 6 deterministic scratch proof done\n");
}

}  // namespace

int main() {
  fall1();
  fall2();
  fall3();
  fall4();
  fall4b();
  fall5();
  fall6();
  PRUEF_ENDE();
}
