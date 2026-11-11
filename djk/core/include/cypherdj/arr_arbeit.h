// Mehrkern slice 3.1: the per-lane work struct of the track path. Everything two units (tracks) would write at the same time while
// they run in one phase lives here and is handed down as a parameter: lane 0 is the callback, lanes 1..3 are the pool workers. One
// struct per lane, constructed once (before jack_activate / mlockall), zero-initialised. No thread-local storage anywhere in the product.
// Real-time: nothing here allocates, locks or does I/O.
#pragma once

#include <atomic>
#include <cstdint>

#include "cypherdj/arr_inserts.h"
#include "cypherdj/arr_pdc.h"
#include "cypherdj/arr_playback.h"

namespace cdj {

constexpr int ARR_ARBEIT_BAHNEN = 4;   // lane 0 (callback) + three pool workers

// A counter that units on different lanes bump at the same time (the Kit and rack sinks: a rack unit starts voices and loses events inside a lane unit, whatever
// track it belongs to). Relaxed: nobody orders anything by it, the callback and the tests read it between phases.
class ArrZaehler {
 public:
  void erhoehe() noexcept {
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_ZAEHLER_PLAIN
    ++w_;   // error case: a plain integer, two lanes bumping it at once is a data race (only a TSan build sees it)
#else
    w_.fetch_add(1, std::memory_order_relaxed);
#endif
  }
  uint64_t wert() const noexcept {
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_ZAEHLER_PLAIN
    return w_;
#else
    return w_.load(std::memory_order_relaxed);
#endif
  }

 private:
#ifdef CYPHERDJ_MUTATION_SPUR_RACK_ZAEHLER_PLAIN
  uint64_t w_ = 0;
#else
  std::atomic<uint64_t> w_{0};
#endif
};

struct alignas(64) ArrArbeit {
  int bahn = 0;                                   // 0 = callback, 1..3 = pool workers
  float rb_l[INS_BLOCK] = {}, rb_r[INS_BLOCK] = {};     // ArrRbSenke render scratch (= ARR_BLOCK, checked in arrangement.h)
  float bk_l[INS_BLOCK] = {}, bk_r[INS_BLOCK] = {};     // ArrBkSenke render scratch
  float rack_l[INS_BLOCK] = {}, rack_r[INS_BLOCK] = {};  // ArrRackSenke member scratch (the rack nests the RB / Kit scratch, so it cannot share rb_l)
  float kit_l[INS_BLOCK] = {}, kit_r[INS_BLOCK] = {};    // ArrKitSenke voice mix scratch
  float dry_l[INS_BLOCK] = {}, dry_r[INS_BLOCK] = {};   // ArrInserts dry copy while a stage blends (task 2)
  float bke_l[2][INS_BLOCK] = {}, bke_r[2][INS_BLOCK] = {};   // ArrInserts Baukasten stage output (arr-bk slice 3): [0] the instance, [1] the one that fades out
  float pdc_tmp[ARR_PDC_RING] = {};               // ArrPdc shift scratch (task 2)
  uint32_t nan_zaehler = 0;                       // ArrInserts NaN count of this lane, summed after the join (task 2)
  uint64_t maske_loeschen = 0;                    // strip bits (ArrInserts::maske_ is uint64_t over 45 strips) whose tail ended (task 2)
  uint64_t slot_frei = 0;                         // slot bits (ARR_INS_ALLE <= 64, 64-bit since arr-fx slice 2) whose tail ended (task 2)
  uint32_t einheiten = 0;                         // units computed on this lane (counters, tests)
  uint32_t rack_einheiten = 0;                    // rack tracks (with all their members) computed on this lane (counters, tests, the cost lane)
};

static_assert(ARR_INS_ALLE <= 64, "slot_frei is a 64-bit mask");

}  // namespace cdj
