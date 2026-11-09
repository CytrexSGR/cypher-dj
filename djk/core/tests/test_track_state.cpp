// mehrkern slice 3.2, task 7: the kern reports the track phases on the Hall pool (event SPUR_ZUSTAND, /zustand/spur_pool ,iiiiiiiii: an, modus, blocks_parallel,
// einheiten_worker, einheiten_caller, seriell_summe, haengt, spaet, zurueck), the way it reports the Hall pool (test_hall_zustand): at once on a change of an, modus,
// haengt, spaet and otherwise every 24 000 samples (2 Hz). The running counters and zurueck change every block (a take-back of an unstarted job is normal, not late):
// they ride along with the beat only and never cause a message of their own.
//   1  no pool, tracks  an 0, modus 0, worker 0, parallel 0; seriell GROWS (every block with tracks is a serial phase, also without a pool); 2 or 3 messages in 200 blocks
//   2  pool, 24 tracks  FIFO test seam, 3 workers, mode an, with the SpurHaken: after 200 blocks an 1, modus 1, einheiten_worker > 0, blocks_parallel > 0
//   3  mode aus, auto   modus 0 reports an 0 and the phase stays serial; auto reports modus 2 and forks
//   4  SPUR account off 5 late events switch it off: an 0 at once with spaet 5 and zurueck 5, while the Hall pool still says an 1
//   5  messages         WITHOUT the SpurHaken (workers mostly never start: take-backs every block): 2000 blocks give at most the beat count plus 4 changes, not one per block
//   5b                  with the hook: 2 or 3 messages in 200 blocks
//   6  packing          the helper gives the low 31 bits; and the MESSAGE itself carries them: with a test offset that crosses 2^31 the counters in the event wrap, never negative
//   8  auto retry       mode auto: after a switch-off (5 late events) and 4096 blocks the account is switched on once, the report says an 0 then 1 again; the second switch-off stays: an 0
//   7  no FIFO          a pool whose workers do not run SCHED_FIFO (no seam): an 0, modus 1, seriell grows, einheiten_worker stays 0
#include <cstdint>
#include <cstdio>
#include <memory>

#include "cypherdj/reverb_pool.h"
#include "arr_build.h"
#include "arr_run.h"
#include "check.h"

bool g_waechter = false;

using k35::N;

namespace {

// a wirt sink that is lane-capable (like the sinks of test_arr_spur_pool): the 24 tracks sit in the lane lists, nothing is audible
struct LeerSenke : cdj::ArrSenke {
  int64_t vorhalt() const noexcept override { return 0; }
  void note(int, int64_t, uint8_t, uint8_t, bool) noexcept override {}
  void alle_aus(int, int64_t) noexcept override {}
  void transport_start(int, int64_t) noexcept override {}
  void block(int, int64_t, int, float*, float*) noexcept override {}
  bool parallel_faehig(int) const noexcept override { return true; }
};

void nichts(void*, int) {}

int zaehle(const arr35::Lauf& x) {
  int n = 0;
  for (const cdj::Ereignis& e : x.ev) n += e.art == cdj::Ereignis::SPUR_ZUSTAND;
  return n;
}

const cdj::Ereignis* letzter(const arr35::Lauf& x) {
  for (int i = static_cast<int>(x.ev.size()) - 1; i >= 0; --i)
    if (x.ev[static_cast<size_t>(i)].art == cdj::Ereignis::SPUR_ZUSTAND) return &x.ev[static_cast<size_t>(i)];
  return nullptr;
}

// 24 wirt tracks, no clips: every track is one unit of phase Q (a live unit: its gain is on)
void lade24(arr35::Lauf& x) {
  arrtest::Bau b(1);
  for (int i = 0; i < 24; ++i) b.spur(i + 1, cdj::ArrArt::wirt, 1);
  cdj::Befehl c = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
  c.zeiger = b.fertig();
  c.arr_nr = 1;
  x.sende(c);
  x.start(0.0, 0);
}

// the time gates of the scheduler (late start, hard limit, join wait) use the real clock: on a loaded machine they would switch the account off in the middle of a case that is about
// the report. Every case with a forking pool turns them off (10 s); the account then only goes off where the case switches it off itself.
cdj::SpurTest kein_tor() {
  cdj::SpurTest t;
  t.grenze_ns = 10'000'000'000LL;
  t.warte_spaet_ns = 10'000'000'000LL;
  return t;
}

cdj::HallPoolEinstellung einst(int faeden) {
  cdj::HallPoolEinstellung e;
  e.faeden = faeden;
  e.frist_us = 1000000;   // no late event from SCHED_OTHER wake jitter
  e.bloecke_us = 5333;
  return e;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_spur_zustand");
  {  // 1
    arr35::Lauf x(ab.pfad, "test_spur_zustand_1");
    LeerSenke senke;
    x.kern->setze_spur_pool(1);   // asked for, but there is no pool: reported as aus
    x.kern->setze_arr_senke_wirt(1, &senke);
    lade24(x);
    x.lauf(x.kern->sample() + 200 * N);
    const cdj::Ereignis* l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 1 (no pool): an %d, modus %d, parallel %d, worker %d, caller %d, seriell %d, haengt %d, spaet %d, zurueck %d (%d messages after 200 blocks)\n", l->spur_an, l->spur_modus,
                  l->spur_blocks_parallel, l->spur_einheiten_worker, l->spur_einheiten_caller, l->spur_seriell, l->spur_haengt, l->spur_spaet, l->spur_zurueck, zaehle(x));
      PRUEF(l->spur_an == 0 && l->spur_modus == 0 && l->spur_blocks_parallel == 0 && l->spur_einheiten_worker == 0 && l->spur_haengt == 0 && l->spur_spaet == 0 && l->spur_zurueck == 0);
      PRUEF(l->spur_seriell > 0);   // the serial phases are counted without a pool as well (the docs say so)
    }
    // without a pool the state never changes: first cycle and the beat only
    PRUEF(zaehle(x) >= 2 && zaehle(x) <= 3);
  }
  {  // 2 .. 6
    arr35::Lauf x(ab.pfad, "test_spur_zustand_2");
    LeerSenke senke;
    cdj::SpurHaken hk;   // the first unit of lane 0 waits until every worker computed a unit: no assertion depends on a race (declared before the run: outlives the kern)
    hk.warte_worker = 3;
    cdj::HallPool pool(einst(3));
    pool.setze_fifo_test(true);
    x.kern->setze_hall_pool(&pool);
    x.kern->setze_spur_pool(1);
    x.kern->setze_spur_test(kein_tor());
    x.kern->setze_arr_senke_wirt(1, &senke);
    x.kern->setze_spur_haken(&hk);
    lade24(x);
    const int n_vor = zaehle(x);
    x.lauf(x.kern->sample() + 200 * N);
    const cdj::Ereignis* l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 2: an %d, modus %d, parallel %d, worker %d, caller %d, seriell %d, haengt %d, spaet %d, zurueck %d\n", l->spur_an, l->spur_modus, l->spur_blocks_parallel, l->spur_einheiten_worker,
                  l->spur_einheiten_caller, l->spur_seriell, l->spur_haengt, l->spur_spaet, l->spur_zurueck);
      PRUEF(l->spur_an == 1 && l->spur_modus == 1);
      PRUEF(l->spur_einheiten_worker > 0 && l->spur_blocks_parallel > 0);
    }
    PRUEF(x.kern->arrangement().spur_lauf().einheiten_worker() > 0);   // the same fact straight from the scheduler: the report is not a made-up number
    const int n5 = zaehle(x) - n_vor;
    std::printf("Case 5b: %d messages in 200 blocks (with the hook)\n", n5);
    PRUEF(n5 >= 2 && n5 <= 3);
    // the report must have followed the scheduler: the 2 Hz beat after the run carries the counters of the last beat, so compare against the scheduler at the end of one more beat
    x.lauf(x.kern->sample() + 100 * N);
    l = letzter(x);
    PRUEF(l && static_cast<uint64_t>(l->spur_einheiten_worker) <= x.kern->arrangement().spur_lauf().einheiten_worker());
    // 3: mode aus is reported at once (a change) and the phase goes serial
    x.kern->setze_spur_pool(0);
    x.lauf(x.kern->sample() + 2 * N);
    l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 3 (aus): an %d, modus %d\n", l->spur_an, l->spur_modus);
      PRUEF(l->spur_an == 0 && l->spur_modus == 0);
    }
    const uint64_t w_aus = x.kern->arrangement().spur_lauf().einheiten_worker();
    x.lauf(x.kern->sample() + 50 * N);
    PRUEF(x.kern->arrangement().spur_lauf().einheiten_worker() == w_aus);   // serial: no unit on a worker
    // auto: reported as modus 2, an 1; forks again
    x.kern->setze_spur_pool(2);
    x.lauf(x.kern->sample() + 200 * N);
    l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 3 (auto): an %d, modus %d, worker %d\n", l->spur_an, l->spur_modus, l->spur_einheiten_worker);
      PRUEF(l->spur_an == 1 && l->spur_modus == 2);
    }
    PRUEF(x.kern->arrangement().spur_lauf().einheiten_worker() > w_aus);
    x.kern->setze_spur_pool(1);
    x.lauf(x.kern->sample() + 2 * N);
    // 4: five late events of the SPUR account (a job taken back as late) switch that account off at the next block start; the Hall account stays on
    pool.anhalten(true);
    for (int i = 0; i < 5; ++i) {
      PRUEF(pool.schicke(0, nichts, nullptr, i, cdj::HallPool::SPUR));
      PRUEF(pool.hole_zurueck(0));
    }
    pool.block_anfang();
    PRUEF(!pool.an(cdj::HallPool::SPUR));
    PRUEF(pool.an(cdj::HallPool::HALL));
    x.lauf(x.kern->sample() + 2 * N);
    l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 4: spur an %d, modus %d, spaet %d, zurueck %d; hall an %d\n", l->spur_an, l->spur_modus, l->spur_spaet, l->spur_zurueck, pool.an() ? 1 : 0);
      PRUEF(l->spur_an == 0 && l->spur_modus == 1 && l->spur_spaet == 5 && l->spur_zurueck == 5);
    }
    PRUEF(pool.an());   // the Hall pool still says an 1
    pool.anhalten(false);
    x.kern->setze_hall_pool(nullptr);
    x.lauf(x.kern->sample() + 2 * N);
    l = letzter(x);
    PRUEF(l && l->spur_an == 0 && l->spur_modus == 0 && l->spur_spaet == 0);   // detaching the pool: back to the no-pool report
  }
  {  // 5: no SpurHaken, pool with the FIFO seam: workers wake late, the caller takes most jobs back every block (zurueck grows per block, normal). The count of messages is bounded by the beat.
    arr35::Lauf x(ab.pfad, "test_spur_zustand_5");
    LeerSenke senke;
    cdj::HallPool pool(einst(3));
    pool.setze_fifo_test(true);
    x.kern->setze_hall_pool(&pool);
    x.kern->setze_spur_pool(1);
    x.kern->setze_spur_test(kein_tor());
    x.kern->setze_arr_senke_wirt(1, &senke);
    lade24(x);
    constexpr int BLOECKE = 2000;
    const int64_t s0 = x.kern->sample();
    x.lauf(s0 + BLOECKE * N);
    const int n = zaehle(x);
    const int64_t laenge = static_cast<int64_t>(BLOECKE) * N;
    const int beats = static_cast<int>(laenge / 24000) + 1;   // the beat messages (one per 24 000 samples, at most one more for the partial one)
    const int grenze = beats + 1 + 4;                        // plus the first cycle and at most 4 changes of an/modus/haengt/spaet
    const cdj::Ereignis* l = letzter(x);
    std::printf("Case 5: %d messages in %d blocks (bound %d = %d beats + first cycle + 4 changes), zurueck(SPUR) %llu, einheiten_worker %llu\n", n, BLOECKE, grenze, beats,
                (unsigned long long)pool.zurueck(cdj::HallPool::SPUR), (unsigned long long)x.kern->arrangement().spur_lauf().einheiten_worker());
    PRUEF(n >= 2 && n <= grenze);
    PRUEF(l != nullptr && l->spur_an == 1);
    x.kern->setze_hall_pool(nullptr);
  }
  {  // 7: no FIFO seam: the workers are SCHED_OTHER, fifo() is false, the track phases stay serial and an says 0 although the mode is on
    arr35::Lauf x(ab.pfad, "test_spur_zustand_7");
    LeerSenke senke;
    cdj::HallPool pool(einst(3));
    x.kern->setze_hall_pool(&pool);
    x.kern->setze_spur_pool(1);
    x.kern->setze_spur_test(kein_tor());
    x.kern->setze_arr_senke_wirt(1, &senke);
    lade24(x);
    x.lauf(x.kern->sample() + 200 * N);
    const cdj::Ereignis* l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 7 (no FIFO): an %d, modus %d, worker %d, seriell %d\n", l->spur_an, l->spur_modus, l->spur_einheiten_worker, l->spur_seriell);
      PRUEF(l->spur_an == 0 && l->spur_modus == 1 && l->spur_einheiten_worker == 0 && l->spur_blocks_parallel == 0 && l->spur_seriell > 100);
    }
    PRUEF(x.kern->arrangement().spur_lauf().einheiten_worker() == 0);
    x.kern->setze_hall_pool(nullptr);
  }
  {  // 8: mode auto (Task 6): the report follows the pool's account through switch-off, the one retry, and the second switch-off for good
    arr35::Lauf x(ab.pfad, "test_spur_zustand_8");
    LeerSenke senke;
    cdj::SpurHaken hk;
    hk.warte_worker = 3;
    cdj::HallPool pool(einst(3));
    pool.setze_fifo_test(true);
    x.kern->setze_hall_pool(&pool);
    x.kern->setze_spur_pool(2);
    x.kern->setze_spur_test(kein_tor());
    x.kern->setze_arr_senke_wirt(1, &senke);
    x.kern->setze_spur_haken(&hk);
    lade24(x);
    x.lauf(x.kern->sample() + 20 * N);
    const cdj::Ereignis* l = letzter(x);
    PRUEF(l && l->spur_an == 1 && l->spur_modus == 2);
    auto aus_schalten = [&]() {   // five late events of the SPUR account, then the next block start switches it off
      pool.anhalten(true);
      for (int i = 0; i < 5; ++i) {
        PRUEF(pool.schicke(0, nichts, nullptr, i, cdj::HallPool::SPUR));
        PRUEF(pool.hole_zurueck(0));
      }
      pool.block_anfang();
      pool.anhalten(false);
    };
    aus_schalten();
    PRUEF(!pool.an(cdj::HallPool::SPUR));
    x.lauf(x.kern->sample() + 2 * N);
    l = letzter(x);
    PRUEF(l && l->spur_an == 0 && l->spur_modus == 2 && l->spur_spaet == 5);
    x.lauf(x.kern->sample() + (cdj::ArrSpurLauf::AUTO_WARTE_BLOECKE + 10) * N);   // the pause, then the one retry
    l = letzter(x);
    std::printf("Case 8 (auto, after retry): an %d, modus %d, spaet %d, worker %d\n", l ? l->spur_an : -1, l ? l->spur_modus : -1, l ? l->spur_spaet : -1, l ? l->spur_einheiten_worker : -1);
    PRUEF(l && l->spur_an == 1 && l->spur_modus == 2 && l->spur_spaet == 5);   // the account is on again, the late count is kept
    x.lauf(x.kern->sample() + 20 * N);
    aus_schalten();   // the second switch-off is for good
    x.lauf(x.kern->sample() + (cdj::ArrSpurLauf::AUTO_WARTE_BLOECKE + 10) * N);
    l = letzter(x);
    std::printf("Case 8 (auto, second switch-off): an %d, modus %d, spaet %d\n", l ? l->spur_an : -1, l ? l->spur_modus : -1, l ? l->spur_spaet : -1);
    PRUEF(l && l->spur_an == 0 && l->spur_modus == 2 && l->spur_spaet == 10);
    PRUEF(pool.an(cdj::HallPool::HALL));
    x.kern->setze_hall_pool(nullptr);
  }
  {  // 6b: the message itself: an offset below 2^31 makes the real counters cross it; the event must carry the wrapped low 31 bits, never a negative number
    arr35::Lauf x(ab.pfad, "test_spur_zustand_6");
    LeerSenke senke;
    cdj::SpurHaken hk;
    hk.warte_worker = 3;
    cdj::HallPool pool(einst(3));
    pool.setze_fifo_test(true);
    x.kern->setze_hall_pool(&pool);
    x.kern->setze_spur_pool(1);
    x.kern->setze_spur_test(kein_tor());
    x.kern->setze_arr_senke_wirt(1, &senke);
    x.kern->setze_spur_haken(&hk);
    const uint64_t aufschlag = 0x7fffffffull - 100;
    x.kern->setze_spur_test_aufschlag(aufschlag);
    lade24(x);
    x.lauf(x.kern->sample() + 100 * N);
    x.kern->setze_spur_pool(2);   // a change: the message goes out in the next cycle, with the counters of that moment
    x.lauf(x.kern->sample() + N);
    const cdj::Ereignis* l = letzter(x);
    const auto& sl = x.kern->arrangement().spur_lauf();
    PRUEF(l != nullptr && l->spur_modus == 2);
    if (l) {
      const uint64_t w = sl.einheiten_worker(), c = sl.z.einheiten_caller, p = sl.z.blocks_parallel;
      std::printf("Case 6: real worker %llu caller %llu parallel %llu, in the message %d %d %d\n", (unsigned long long)w, (unsigned long long)c, (unsigned long long)p, l->spur_einheiten_worker,
                  l->spur_einheiten_caller, l->spur_blocks_parallel);
      PRUEF(w > 100 && l->spur_einheiten_worker >= 0 && l->spur_einheiten_caller >= 0 && l->spur_blocks_parallel >= 0 && l->spur_seriell >= 0);
      // the message is a few blocks older than the scheduler read here: recover the real counter it was made from (value minus the offset, modulo 2^31) and check it is a value the
      // scheduler had (<= now) that really crossed 2^31 (> 100), and that the wrapped value is the small one
      const auto echt = [&](int32_t v) { return (static_cast<uint64_t>(v) + 0x80000000ull - aufschlag) & 0x7fffffffull; };
      const uint64_t rw = echt(l->spur_einheiten_worker), rp = echt(l->spur_blocks_parallel);
      PRUEF(rw > 100 && rw <= w);
      PRUEF(rp <= p && rp > 0);
      PRUEF(static_cast<uint64_t>(l->spur_einheiten_worker) == rw - 101);   // wrapped past 2^31 - 1: 100 left, 101 more
      PRUEF(rp >= 101 ? static_cast<uint64_t>(l->spur_blocks_parallel) == rp - 101 : true);
    }
    x.kern->setze_hall_pool(nullptr);
  }
  {  // 6: the int32 packing of a counter is its low 31 bits: never negative, wraps instead of saturating (a saturated counter would stop moving for a consumer that takes deltas)
    PRUEF(cdj::Kern::spur_zaehler31(0) == 0);
    PRUEF(cdj::Kern::spur_zaehler31(0x7fffffffull) == 0x7fffffff);
    PRUEF(cdj::Kern::spur_zaehler31(0x80000000ull) == 0);
    PRUEF(cdj::Kern::spur_zaehler31(0x80000005ull) == 5);
    PRUEF(cdj::Kern::spur_zaehler31((1ull << 40) + 7) == 7);
    PRUEF(cdj::Kern::spur_zaehler31(~0ull) == 0x7fffffff);
  }
  PRUEF_ENDE();
}
