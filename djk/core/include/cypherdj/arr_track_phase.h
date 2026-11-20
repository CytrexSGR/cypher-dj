// Mehrkern slice 3.1: the sticky plan of the track phase (phase Q). Which track runs on which lane, and which tracks stay in the serial remainder.
// Built on the callback thread (Arrangement::tausche, or at the start of a block when the plan is stale), outside any fork. Fixed-size arrays,
// building allocates nothing. Since 3.2 the lanes run on the Hall pool workers (or serially on the callback when the pool is off or the load is
// below SPUR_MIN_LAST); the serial summation keeps the fixed order, so the output is bit-equal either way.
#pragma once

#include <atomic>
#include <cstdint>

#include "cypherdj/arr_arbeit.h"
#include "cypherdj/arr_playback.h"
#include "cypherdj/reverb_pool.h"

namespace cdj {

class ArrSenke;

class ArrSpurPlan {
 public:
  static constexpr int BAHNEN = ARR_ARBEIT_BAHNEN;

  // senken[i] is the sink of track i (nullptr: nothing to run). A track whose sink says parallel_faehig(i) goes to a lane list; every other
  // track with a sink goes to the serial remainder, in track order. Sticky: a track that was in a lane list of the previous plan keeps
  // its lane as long as the lane count stays the same; the others go to the lane with the fewest tracks so far (ties: the lowest lane).
  // For a fresh plan that is round robin over the lane-capable tracks in track order; it equals "track index modulo lanes" only when
  // the capable tracks are consecutive from track 0.
  void baue(const ArrSenke* const* senken, int bahnen) noexcept;

  int bahnen() const noexcept { return bahnen_; }
  int n(int bahn) const noexcept { return bahn >= 0 && bahn < BAHNEN ? n_[bahn] : 0; }
  int spur(int bahn, int k) const noexcept { return liste_[bahn][k]; }
  int n_rest() const noexcept { return n_rest_; }
  int rest(int k) const noexcept { return rest_[k]; }
  bool in_liste(int spur) const noexcept { return spur >= 0 && spur < ARR_SPUREN && bahn_von_[spur] >= 0; }

 private:
  int liste_[BAHNEN][ARR_SPUREN] = {};
  int n_[BAHNEN] = {};
  int rest_[ARR_SPUREN] = {};
  int n_rest_ = 0;
  int bahnen_ = 1;
  int8_t bahn_von_[ARR_SPUREN] = {};   // the lane of a track in a lane list, -1 otherwise (the memory of the stickiness)
  bool gebaut_ = false;
};

// Mehrkern slice 3.2: test seams of the scheduler. Product-neutral: one branch per unit or per phase, all of it behind a null pointer in the product.
// Set before the block, never inside it. The spins are bounded by a wall-clock cap inside the seam code (a failing test ends red, it does not hang).
struct SpurHaken {
  std::atomic<int> halte_bahn{-1};         // the first unit that starts on this lane counts `drin` and spins until `frei`
  std::atomic<int> drin{0};                // units held right now (reset at the start of every phase)
  std::atomic<bool> frei{true};            // false while a test wants to hold; the test releases with true
  std::atomic<int> warte_drin{0};          // the first unit of lane 0 does not start until drin >= warte_drin ...
  std::atomic<int> warte_worker{0};        // ... and worker_fertig >= warte_worker (every worker computed a unit first)
  std::atomic<int> worker_fertig{0};       // workers that finished their first unit of this phase (reset at the start of every phase)
  std::atomic<int> halte_vor_claim_bahn{-1};   // a worker on this lane stops after it started its job and before it claims its first unit, until `frei`
  void (*vor)(int bahn) = nullptr;         // run around every unit on the lane's own thread (the allocation counter of a test is switched on and off here)
  void (*nach)(int bahn) = nullptr;
  std::atomic<int> am_join{0};             // counts the joins in which the caller found a job still running and starts to wait for it (never reset: a test keeps a baseline)
  std::atomic<int64_t> uhr_ns{0};          // fake clock of the scheduler (gate and join wait); 0 = SpurTest::jetzt_ns, then the real one. A test may advance it from another thread
  std::atomic<int64_t> einheit_uhr_ns{0};  // fake unit clock (the duration of a unit, the cost estimate); 0 = none: with uhr_ns set it is that clock, else the thread CPU time. Lets a test move the wall clock inside a unit without moving the unit clock
};

// Fixed fake clock (the late-start gate and the join wait read it; SpurHaken::uhr_ns overrides it and can move), hard-limit override (nanoseconds after the
// start of the cycle, instead of 75 percent of the period), load threshold override, join-wait threshold override. 0 / -1 = the product value.
struct SpurTest {
  int64_t jetzt_ns = 0;
  int64_t grenze_ns = 0;
  int min_last = -1;
  int64_t warte_spaet_ns = 0;
};

// The scheduler of phase Q: sticky lane lists, one atomic state per unit (0 free, 1 claimed, 2 done), claimed with one CAS. A lane runs its own list from
// the front, then steals from the END of the other lists. The caller (lane 0) runs its list, steals until nothing is free, runs the serial remainder, then
// joins: a job that never started is taken back (nothing waits for an unstarted job), a job that started is waited for. Lane 0 is the callback, lane w + 1
// is pool worker w; every lane works on its own ArrArbeit. Nothing here allocates, locks or does I/O.
class ArrSpurLauf {
 public:
  static constexpr int BAHNEN = ARR_ARBEIT_BAHNEN;
  using Einheit = void (*)(void* ctx, int spur, ArrArbeit& a);
  using Rest = void (*)(void* ctx);

  struct Zaehler {
    uint64_t blocks_parallel = 0;     // phases in which at least one worker started its job (not taken back)
    uint64_t einheiten_caller = 0;    // units the caller computed in phases that went to the pool
    uint64_t seriell_weg = 0;         // serial fallbacks, by reason
    uint64_t seriell_wenig = 0;
    uint64_t seriell_fifo = 0;
    uint64_t seriell_plan = 0;
    uint64_t seriell_aus = 0;
    uint64_t seriell_spaet = 0;       // the phase did not fork because the cycle was already past 50 percent of the period
    uint64_t warte_spaet = 0;         // joins whose wait after the caller ran dry exceeded the threshold (one late event of the track account each)
    int64_t warte_max_ns = 0;         // the longest such wait
    uint64_t auto_neu = 0;            // mode auto: the account was switched on again
    uint64_t unfertig = 0;            // a unit still claimed (not done) at the start of a phase: must stay 0
  };
  Zaehler z;

  // Time gates. Period of a block of m samples at 48 kHz; the cycle start is on CLOCK_MONOTONIC (0 = unknown: no refusal, the hard limit starts at laufen).
  static constexpr int64_t SPAET_START_PROZENT = 50;     // no fork when the sub-block starts later than this share of the period
  static constexpr int64_t GRENZE_PROZENT = 75;          // hard wait limit of the join, share of the period after the cycle start
  // Base threshold of the join wait (the probe's break-even is about 250 us; calibrated for units of about 14 us). The wait after the caller ran dry (wall clock) is a late
  // event of the track account only above WARTE_SPAET_NS + 1.25 * the usual duration of the longest unit a worker still holds (kosten_ns_): a worker in the middle of a 1 ms
  // Baukasten unit is work stealing at its normal pace, not a stall. The usual duration is the THREAD CPU time of the unit (CLOCK_THREAD_CPUTIME_ID, about 110 ns per call):
  // a worker that is preempted inside a unit does not raise its own allowance, so a recurring stall stays late. No estimate (a track never computed yet, or its sink changed): the
  // base threshold alone.
  static constexpr int64_t WARTE_SPAET_NS = 100000;
  static constexpr int64_t KOSTEN_ABKLING = 64;          // the cost estimate of a track falls by 1/64 per block it is computed (peak hold)
  // The track account is never off for good (both modes an and auto): after a switch-off the phase stays serial for neu_wartezeit(n) blocks, then the account is switched on
  // again. The wait doubles with every switch-off of this mode (4096, 8192, ... capped at 4096 << AUTO_WARTE_MAX_SHIFT = 65536 blocks, about 5.8 minutes at quantum 256).
  static constexpr int AUTO_WARTE_BLOECKE = 4096;        // the first wait, in blocks
  static constexpr int AUTO_WARTE_MAX_SHIFT = 4;
  // A long healthy run forgets the switch-offs: after this many blocks with the account on (as many as the longest wait, 65536 blocks, about 5.8 minutes at quantum 256) the
  // count starts at zero, so a stall hours later waits 4096 blocks again instead of the capped 65536. A retry that fails at once never gets this far (case f of test 31).
  static constexpr int AUTO_GESUND_BLOECKE = AUTO_WARTE_BLOECKE << AUTO_WARTE_MAX_SHIFT;
  // The wait after the aus_n-th switch-off, in blocks. Any int is safe (the shift is clamped before it is used).
  static constexpr int neu_wartezeit(int aus_n) {
    return AUTO_WARTE_BLOECKE << (aus_n <= 1 ? 0 : (aus_n - 1 > AUTO_WARTE_MAX_SHIFT ? AUTO_WARTE_MAX_SHIFT : aus_n - 1));
  }
  static int64_t periode_ns(int m) { return static_cast<int64_t>(m) * 1000000000LL / 48000; }
  // The scheduler's clock: the seam clock when a test set one, the real CLOCK_MONOTONIC otherwise.
  int64_t jetzt() const;
  // True (and counted as seriell_spaet) when the sub-block that starts at start_ns is already past SPAET_START_PROZENT of the period of m samples.
  // A start of 0 or more than a second away (a clock from another domain) is unknown and never refuses; a start ahead of now (the callback is ahead of its schedule: sub-block 1 of a split cycle) is on time.
  bool spaet_dran(int64_t start_ns, int m);
  // The hard wait limit on the real clock for a sub-block whose nominal start is start_ns (this scheduler's clock domain) when the real clock reads echt0 now: the
  // nominal start plus GRENZE_PROZENT of the period of m samples, or SpurTest::grenze_ns after it. The start may lie ahead (a split cycle: sub-block 1 of 2048 samples
  // starts 21 ms into the cycle although the callback is ahead of its schedule) or behind; unknown (0, or more than a second away: another clock) = from echt0.
  int64_t grenze_echt(int64_t start_ns, int m, int64_t echt0) const;
  // The state of the track account at the start of a phase: true when it is on. Modes an and auto (a synonym): with the account off, counts blocks and switches it on again
  // after neu_wartezeit(switch-offs so far) (true in that call), however often it fails. Mode aus never asks. Callback thread, every worker frei.
  bool konto_pruefen(HallPool& pool, int modus);
  void auto_neu_beginnen() { auto_aus_n_ = 0; auto_aus_gesehen_ = false; auto_blocks_ = 0; auto_gesund_ = 0; }   // a mode change starts the retry story afresh
  void setze_test(const SpurTest& t) { test_ = t; }
  int64_t warte_max_us() const { return z.warte_max_ns / 1000; }
  // The cost estimate of a track (or of every track) is forgotten: its sink or instrument changed. Callback thread, between phases (every worker idle).
  void kosten_vergessen(int spur) { if (spur >= 0 && spur < ARR_SPUREN) kosten_ns_[spur].store(0, std::memory_order_relaxed); }
  void kosten_alle_vergessen() { for (auto& k : kosten_ns_) k.store(0, std::memory_order_relaxed); }

  // One phase on the pool. `arbeit` points at BAHNEN lane structs. `rest` runs on the caller after its units, before the join. mxcsr: the caller's.
  // start_ns: the nominal start of the sub-block (CLOCK_MONOTONIC, 0 = unknown), m its length: the hard wait limit is start + GRENZE_PROZENT of the period.
  void laufen(const ArrSpurPlan& plan, HallPool& pool, ArrArbeit* arbeit, Einheit f, void* ctx, Rest rest, void* rest_ctx, uint32_t mxcsr, int64_t start_ns = 0, int m = 256);

  uint64_t einheiten_bahn(int b) const { return b >= 0 && b < BAHNEN ? lane_n_[b].n : 0; }   // scheduler units per lane (caller thread, between phases)
  uint64_t einheiten_worker() const { return lane_n_[1].n + lane_n_[2].n + lane_n_[3].n; }
  void setze_haken(SpurHaken* h);   // also re-arms the seam waits (a test that ran into the wall-clock cap must not make the next one skip its waits)

 private:
  struct alignas(64) LaneN {
    uint64_t n = 0;
  };
  static void job(void* ctx, int lane);
  void bahn_laufen(int lane);
  void einheit(int lane, int spur);
  bool nimm(int spur) {
    uint8_t frei = 0;
    return zustand_[spur].load(std::memory_order_relaxed) == 0 && zustand_[spur].compare_exchange_strong(frei, 1, std::memory_order_acq_rel);
  }

  std::atomic<uint8_t> zustand_[ARR_SPUREN] = {};
  // per track: peak hold with slow decay of the duration of one unit in THREAD CPU time (written by the thread that computed it, read at the join; zeroed when the sink changes)
  std::atomic<int64_t> kosten_ns_[ARR_SPUREN] = {};
  int64_t einheit_zeit() const;   // the unit clock on the computing thread: the seam's unit clock, else the seam wall clock, else CLOCK_THREAD_CPUTIME_ID
  LaneN lane_n_[BAHNEN];
  const ArrSpurPlan* plan_ = nullptr;
  ArrArbeit* arbeit_ = nullptr;
  Einheit f_ = nullptr;
  void* ctx_ = nullptr;
  SpurHaken* haken_ = nullptr;
  SpurTest test_;
  int auto_aus_n_ = 0;                     // switch-offs seen so far (callback thread only), counted up to 1000
  bool auto_aus_gesehen_ = false;
  int auto_blocks_ = 0;
  int auto_gesund_ = 0;                    // blocks in a row with the account on since the last switch-off (callback thread only); AUTO_GESUND_BLOECKE forgets auto_aus_n_
  std::atomic<bool> erste_[BAHNEN] = {};   // seam: the lane has started a unit in this phase
  std::atomic<bool> gehalten_{false};      // seam: the hold of halte_bahn has been taken
  std::atomic<bool> fertig0_[BAHNEN] = {}; // seam: the worker has counted its first finished unit
};

}  // namespace cdj
