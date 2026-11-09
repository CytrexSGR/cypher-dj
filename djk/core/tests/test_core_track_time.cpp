// mehrkern slice 3.2, task 6, q_zyklus_zeit: the late-start gate of the track phase is measured from the stamp the JACK cycle gave Kern::zyklus (plus the offset of the
// sub-block), not from the start of Arrangement::block. Through a real Kern with rb338 tracks and a pool whose workers count as FIFO:
//   1 a stamp that lies 60 percent of the period in the past: the arrangement refuses the fork (seriell_spaet), although Arrangement::block itself started just now
//   2 a stamp equal to now: it forks
//   3 the stamp of the unit-test harness (a sample count, not CLOCK_MONOTONIC) is no information: it forks
// The stamp is the same clock as HallPool's: step 0 of the plan (task6/step0-uhr.txt) printed jack_get_cycle_times against clock_gettime(CLOCK_MONOTONIC) on this machine.
#include <time.h>

#include <cstdio>
#include <string>

#include "arr_run.h"
#include "cypherdj/arr_track_phase.h"
#include "cypherdj/reverb_pool.h"

bool g_waechter = false;

using k35::N;

namespace {

int64_t mono_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_kern_spur_zeit");
  arr35::Lauf x(ab.pfad, "test_kern_spur_zeit");
  cdj::HallPoolEinstellung e;
  e.faeden = 3;
  e.frist_us = 1000000;
  cdj::HallPool pool(e);
  pool.setze_fifo_test(true);
  x.kern->setze_hall_pool(&pool);
  cdj::Arrangement& arr = const_cast<cdj::Arrangement&>(x.kern->arrangement());   // test only: the kern hands out a const view; Task 7 adds the product switch
  arr.setze_spur_pool(1);
  cdj::SpurTest st;
  st.min_last = 0;
  st.grenze_ns = 10'000'000'000LL;        // the hard limit and the join-wait signal run on the real clock; a SCHED_OTHER worker losing the CPU must not switch the phase off here
  st.warte_spaet_ns = 10'000'000'000LL;
  arr.setze_spur_test(st);
  cdj::SpurHaken hk;
  hk.warte_worker = 3;   // every worker computes before the caller does: a fork is a fork
  arr.setze_spur_haken(&hk);
  std::string spuren;
  for (int i = 0; i < 8; ++i) {
    if (i) spuren += ",";
    spuren += "{\"nr\":" + std::to_string(i + 1) + ",\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.4,\"resonanz\":0.3},"
              "\"noten\":[{\"id\":\"c" + std::to_string(i + 1) + "/n1\",\"beat\":0.5,\"laenge\":4.0,\"ton\":" + std::to_string(36 + i) + ",\"vel\":100}]}";
  }
  x.laden(1, spuren);
  x.lauf(4 * N);
  x.start(0.0, 0);
  x.lauf(40 * N);
  const cdj::ArrSpurLauf& sl = arr.spur_lauf();
  PRUEF(sl.z.blocks_parallel > 0);   // the unit-test stamp (n0 * 20833, no clock) forks: it is no information
  const int64_t periode = cdj::ArrSpurLauf::periode_ns(N);
  // one cycle by hand with a real stamp (the harness cycle without its ring bookkeeping: inputs registered empty as in Lauf::zyklen)
  auto zyklus = [&](int64_t stempel) {
    for (int p = 1; p <= cdj::EIN_PAARE; ++p) x.kern->ein(p, nullptr, nullptr);
    x.kern->zyklus(N, stempel);
  };
  uint64_t p0 = sl.z.blocks_parallel, s0 = sl.z.seriell_spaet;
  zyklus(mono_ns() - periode * 60 / 100);
  PRUEF(sl.z.seriell_spaet == s0 + 1 && sl.z.blocks_parallel == p0);   // 60 percent in the past: refused, although block() started just now
  p0 = sl.z.blocks_parallel;
  s0 = sl.z.seriell_spaet;
  zyklus(mono_ns());
  PRUEF(sl.z.seriell_spaet == s0 && sl.z.blocks_parallel == p0 + 1);   // a stamp of now forks
  // a split cycle (2048 samples = two sub-blocks of 1024): the kern hands the arrangement the nominal start of the LAST sub-block, stamp + 1024 samples
  const int64_t stempel = mono_ns();
  for (int p = 1; p <= cdj::EIN_PAARE; ++p) x.kern->ein(p, nullptr, nullptr);
  x.kern->zyklus(2048, stempel);
  PRUEF(arr.zyklus_start() == stempel + 1024LL * 1000000000LL / 48000);
  std::printf("q_zyklus_zeit: seriell_spaet=%llu parallel=%llu\n", (unsigned long long)sl.z.seriell_spaet, (unsigned long long)sl.z.blocks_parallel);
  PRUEF_ENDE();
}
