// HallPool: a fixed pool of up to 3 worker threads that run one job each per block next to the calling (JACK callback) thread.
// Fork-join with a deadline: the caller hands a job to a worker (schicke), computes its own share, then either joins (warte) or,
// when the worker has not started yet, takes the job back and computes it itself (hole_zurueck). Wake and join use futex, with a
// bounded spin before the caller sleeps (futex wake tails are only bounded under SCHED_FIFO, see prioritaet()).
//
// State word per worker (one cache line, std::atomic<uint32_t>, also the futex word of both sides):
//
//   state    written by          transition                      meaning
//   -------  ------------------  ------------------------------  ------------------------------------------------------
//   frei     caller (warte,      fertig  -> frei  (warte)        no job; the job fields belong to the caller
//            hole_zurueck)       zurueck -> frei  (hole_zurueck)
//   bereit   caller (schicke)    frei    -> bereit (seq_cst)     job fields written, worker may start it
//   laeuft   worker              bereit  -> laeuft (CAS acq_rel) the worker owns the job, the caller must not touch ctx
//   fertig   worker              laeuft  -> fertig (seq_cst)     job done, its writes are visible after warte (acquire)
//   zurueck  caller              bereit  -> zurueck (CAS)        the caller took the job back and computes it itself; the
//                                                                worker's CAS bereit->laeuft fails, so it never starts the job.
//                                                                hole_zurueck leaves this state at once for frei.
//   halt     destructor         any idle -> halt                workers exit; set after every job is dropped or finished
//
// Exactly one side wins the race for a ready job: either the worker CAS bereit->laeuft or the caller CAS bereit->zurueck.
// A running job is never abandoned: warte returns only at fertig, so after the join no worker touches the caller's data.
//
// Wake protocol: the worker announces its sleep in `schlaeft` (seq_cst), re-reads the state and futex-waits on the value it saw; schicke
// stores bereit (seq_cst) and wakes when `schlaeft` is set. Only the worker clears `schlaeft` (a caller-side clear loses the wake after a
// take-back, because frei can recur before the worker really sleeps).
//
// Join protocol: the caller announces its sleep in `wartet` (seq_cst), re-reads the state and futex-waits only when it is not fertig;
// the worker stores fertig (seq_cst), then READS `wartet` and wakes. Only the caller clears `wartet` (on return from warte): a worker
// that cleared it could erase the flag of the next round.
//
// Lateness: schicke stamps CLOCK_MONOTONIC. A late event is (a) every successful hole_zurueck, or (b) a warte that did NOT find the job
// fertig on entry and returned later than frist_us after schicke (spaet()). A job that was already fertig on entry is never late,
// however long the caller worked before (late means a late worker, not a busy caller). More than 4 late events within the last 64 blocks switch the pool off for good (an() false); the
// switch is taken at the next block_anfang() where every worker is frei. An off pool lets schicke return false: the caller computes
// all Halls itself. There is no automatic switch-on.
//
// Callback rule: schicke, hole_zurueck, warte, fertig, bereit, frist_um, block_anfang, spaet, zurueck, an do not allocate, lock or do I/O. The only
// syscalls are futex wake and futex wait. Constructor, destructor, setze_bloecke_us and prioritaet() are not for the callback.
// Threading contract: all calls except the const readers are made by ONE thread (the callback thread).
#pragma once

#include <atomic>
#include <cstdint>
#include <thread>

#if defined(__x86_64__) || defined(__i386__)
#include <immintrin.h>
#endif

namespace cdj {

// PAUSE hint for spin loops. Only x86 has the instruction; elsewhere the spin is a plain loop (a bounded spin, so nothing else is needed).
inline void cpu_pause() noexcept {
#if defined(__x86_64__) || defined(__i386__)
  _mm_pause();
#endif
}


struct HallPoolEinstellung {
  int faeden = 3;                // 0..3 workers; 0 creates no thread and the pool is off
  int cpus[3] = {-1, -1, -1};    // pin worker i to cpus[i] when >= 0
  int prio = 0;                  // reserved, unused; the real priority is set by prioritaet()
  int spin_ns = 20000;           // warte spins this long before it sleeps in futex wait
  int frist_us = 0;              // deadline after schicke; 0 means 25 % of bloecke_us (and follows setze_bloecke_us)
  int bloecke_us = 5333;         // block period of one mischen() sub-block: min(JACK buffer, MIX_BLOCK) samples at the sample rate (main.cpp sets it)
};

class HallPool {
 public:
  using Job = void (*)(void*, int);
  static constexpr int MAX_W = 3;
  static constexpr int FENSTER = 64;       // blocks in the lateness window
  static constexpr int SPAET_MAX = 4;      // more late events than this in the window switch the pool off

  explicit HallPool(const HallPoolEinstellung& e);
  ~HallPool();
  HallPool(const HallPool&) = delete;
  HallPool& operator=(const HallPool&) = delete;

  // Deadline after schicke in microseconds. Follows the real block length: the caller sets 25 % of it with setze_bloecke_us (unless the setting
  // carried an explicit frist_us). setze_bloecke_us is for the control thread (start, JACK buffer-size callback), never for the audio callback; the
  // deadline is an atomic that warte and frist_um read. us <= 0 is ignored.
  void setze_bloecke_us(int us);
  int64_t frist_us() const { return frist_ns_.load(std::memory_order_relaxed) / 1000; }

  int faeden() const { return n_; }   // workers actually running (fewer than asked if a thread could not be created)
  bool an() const { return an_.load(std::memory_order_acquire); }

  // Hands f(ctx, arg) to worker w. False (and nothing started) when the pool is off, w is out of range or the worker is not frei.
  bool schicke(int w, Job f, void* ctx, int arg);
  // True: the job was still bereit and now belongs to the caller (it computes it itself); counts zurueck() and spaet().
  // False: the worker has started it (laeuft/fertig); the caller must warte().
  bool hole_zurueck(int w);
  // Waits for the end of the job of worker w (fertig) and frees the worker. Returns only at fertig.
  void warte(int w);
  // True while worker w has finished its job and warte has not collected it yet (state fertig). No waiting, no time.
  bool fertig(int w) const;
  // True while the job of worker w has been handed over and no side has taken it yet (state bereit). No waiting, no time.
  bool bereit(int w) const;
  // True when more than frist_us have passed since schicke(w) (the caller decides whether to take the job back).
  bool frist_um(int w) const;
  // Start of a block (callback thread): slides the lateness window and takes a due switch-off when every worker is frei.
  void block_anfang();

  uint64_t spaet() const { return spaet_.load(std::memory_order_relaxed); }
  uint64_t zurueck() const { return zurueck_.load(std::memory_order_relaxed); }

  // Sets SCHED_FIFO jack_prio - 1 on the workers. Reports on stderr: one line "Hall pool: n workers SCHED_FIFO p" for the workers that got it, one line per
  // failure; jack_prio <= 1 is reported once and the workers stay SCHED_OTHER.
  void prioritaet(int jack_prio);

  // TESTS ONLY. While set, workers do not start new jobs (a bereit job stays bereit); with anhalten(true) a warte() without a
  // preceding hole_zurueck never returns. Not used in production.
  void anhalten(bool an) { anhalten_.store(an ? 7u : 0u, std::memory_order_release); }   // all workers
  void anhalten(int w, bool an) {   // only worker w (0..2); an invalid w is ignored
    if (w < 0 || w >= MAX_W) return;
    const uint32_t b = 1u << w;
    if (an) anhalten_.fetch_or(b, std::memory_order_acq_rel);
    else anhalten_.fetch_and(~b, std::memory_order_acq_rel);
  }

 private:
  enum : uint32_t { FREI = 0, BEREIT = 1, LAEUFT = 2, FERTIG = 3, ZURUECK = 4, HALT = 5 };   // HALT: destructor only

  struct alignas(64) W {
    std::atomic<uint32_t> st{FREI};         // state and futex word
    std::atomic<uint32_t> schlaeft{0};      // the worker is (about to be) in futex wait on st
    std::atomic<uint32_t> wartet{0};        // the caller is (about to be) in futex wait on st
    Job f = nullptr;                        // job fields: written by the caller in frei, read by the worker after the CAS to laeuft
    void* ctx = nullptr;
    int arg = 0;
    int64_t t_schicke = 0;                  // caller only
    int cpu = -1;
    std::atomic<bool> faden_bereit{false};
    std::thread th;
  };

  void arbeit(int i);
  void spaet_zaehlen();
  bool alle_frei() const;

  // written only by the constructor (and rarely by the switch-off / destructor): shared read-only cache line
  int n_ = 0;
  int spin_ns_ = 0;
  std::atomic<int64_t> frist_ns_{0};   // see setze_bloecke_us
  bool frist_fest_ = false;            // the setting carried an explicit frist_us: setze_bloecke_us leaves it alone
  std::atomic<bool> an_{false};
  std::atomic<bool> halt_{false};
  // test seam, read by the workers in their loop: own cache line, away from the fields the caller writes every block
  alignas(64) std::atomic<uint32_t> anhalten_{0};   // bit i: worker i does not start jobs
  // written by the caller every block
  alignas(64) std::atomic<uint64_t> spaet_{0}, zurueck_{0};
  bool aus_faellig_ = false;                // caller only
  int fenster_pos_ = 0;
  int fenster_[FENSTER] = {};               // late events per block, caller only
  int fenster_summe_ = 0;
  W w_[MAX_W];
};

}  // namespace cdj
