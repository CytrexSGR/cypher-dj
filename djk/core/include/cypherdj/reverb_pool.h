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
// Accounts (mehrkern slice 3): every job belongs to one account, HALL (the return Halls, the default) or SPUR (the track phases). Each account
// has its own late counter, its own 64-block window, its own take-back counter and its own on/off flag; an event of one account never touches
// the other. Lateness: schicke stamps CLOCK_MONOTONIC. A late event of the HALL account is (a) every successful hole_zurueck, or (b) a warte that
// did NOT find the job fertig on entry and returned later than frist_us after schicke (spaet()). A job that was already fertig on entry is never
// late, however long the caller worked before (late means a late worker, not a busy caller). The SPUR account counts a take-back late only when the
// caller says so (hole_zurueck als_spaet: an unstarted track job is simply not needed any more once the caller drained the units, it is late only
// when the worker missed frist_um), and never counts in warte: the scheduler reports the join wait itself with spaet_melden. More than 4 late
// events of an account within the last 64 blocks switch THAT account off for good (an(k) false); the switch is taken at the next block_anfang()
// where every worker is frei. An off account lets schicke return false: the caller computes everything itself. The pool never switches an account on by itself; the scheduler of the track phases may (wieder_an, mode auto, once after a long pause).
// Hard limit: warte(w, grenze_ns) reports a job that is still running when the absolute CLOCK_MONOTONIC time grenze_ns passes (false, haengt(k)
// counts it once); the job is never abandoned, warte keeps waiting. A hang of the SPUR account switches it off at the next block start.
// MXCSR: schicke can carry the caller's MXCSR; the worker runs that job under it and returns to its own (FTZ|DAZ) afterwards.
// FIFO: fifo() is true when every worker has reported SCHED_FIFO (written by prioritaet on its thread, read by the callback).
//
// Callback rule: schicke, hole_zurueck, warte, spaet_melden, wieder_an, fertig, bereit, frist_um, block_anfang, spaet, zurueck, haengt, fifo, an do not allocate, lock or do I/O. The only
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

  enum Konto : int { HALL = 0, SPUR = 1 };
  static constexpr int N_KONTEN = 2;

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
  bool an() const { return an(HALL); }
  bool an(Konto k) const { return an_[k].load(std::memory_order_acquire); }

  // Hands f(ctx, arg) to worker w on account k. False (and nothing started) when the account is off, w is out of range or the worker is not frei.
  // mxcsr != 0: the worker runs the job under that MXCSR (the caller's, read once per phase) and restores its own afterwards; 0 = no hand-over.
  bool schicke(int w, Job f, void* ctx, int arg, Konto k = HALL, uint32_t mxcsr = 0);
  // True: the job was still bereit and now belongs to the caller (it computes it itself); counts zurueck(k).
  // The late event: always for a HALL job; for a SPUR job only when als_spaet. The one-argument form is als_spaet = true.
  // False: the worker has started it (laeuft/fertig); the caller must warte().
  bool hole_zurueck(int w, bool als_spaet);
  bool hole_zurueck(int w) { return hole_zurueck(w, true); }
  // Waits for the end of the job of worker w (fertig) and frees the worker. Returns only at fertig.
  // grenze_ns: absolute CLOCK_MONOTONIC time, 0 = none. Returns false when the job was still running at that time (it keeps waiting).
  bool warte(int w, int64_t grenze_ns = 0);
  // One late event in account k (same window and switch-off as a take-back). For the scheduler's join wait.
  void spaet_melden(Konto k) { spaet_zaehlen(k); }
  // True while worker w has finished its job and warte has not collected it yet (state fertig). No waiting, no time.
  bool fertig(int w) const;
  // True while the job of worker w has been handed over and no side has taken it yet (state bereit). No waiting, no time.
  bool bereit(int w) const;
  // True when more than frist_us have passed since schicke(w) (the caller decides whether to take the job back).
  bool frist_um(int w) const;
  // Switches an account that went off back on (mode auto of the track phases, callback thread, only when every worker is frei). Clears the window and the pending
  // switch-off of that account. False (and nothing done) when a worker still holds a job or there are no workers.
  bool wieder_an(Konto k);
  // Start of a block (callback thread): slides the lateness window and takes a due switch-off when every worker is frei.
  void block_anfang();

  uint64_t spaet() const { return spaet(HALL); }
  uint64_t zurueck() const { return zurueck(HALL); }
  uint64_t spaet(Konto k) const { return spaet_[k].load(std::memory_order_relaxed); }
  uint64_t zurueck(Konto k) const { return zurueck_[k].load(std::memory_order_relaxed); }
  uint64_t haengt(Konto k = HALL) const { return haengt_[k].load(std::memory_order_relaxed); }

  // True only when every worker thread has reported SCHED_FIFO (false without workers). Safe to read from the callback while prioritaet runs.
  bool fifo() const;
  // TESTS ONLY: while set, fifo() is true (for a pool with workers) whatever the workers run at. Lets a ctest under SCHED_OTHER fork the track phases.
  void setze_fifo_test(bool an) { fifo_test_.store(an, std::memory_order_release); }
  // TESTS ONLY: replaces pthread_setschedparam in prioritaet (returns 0 on success). nullptr restores the real call.
  using PrioSetzer = int (*)(std::thread::native_handle_type, int prio);
  void setze_prio_test(PrioSetzer f) { prio_test_.store(f, std::memory_order_release); }

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
    uint32_t mxcsr = 0;                     // 0 = no hand-over; written with the other job fields
    Konto konto = HALL;                     // account of the current job, caller only
    int64_t t_schicke = 0;                  // caller only
    std::atomic<bool> fifo{false};          // written by prioritaet (hall_prio thread), read by fifo()
    int cpu = -1;
    std::atomic<bool> faden_bereit{false};
    std::thread th;
  };

  void arbeit(int i);
  void spaet_zaehlen(Konto k);
  bool alle_frei() const;

  // written only by the constructor (and rarely by the switch-off / destructor): shared read-only cache line
  int n_ = 0;
  int spin_ns_ = 0;
  std::atomic<int64_t> frist_ns_{0};   // see setze_bloecke_us
  bool frist_fest_ = false;            // the setting carried an explicit frist_us: setze_bloecke_us leaves it alone
  std::atomic<bool> an_[N_KONTEN] = {{false}, {false}};
  std::atomic<bool> halt_{false};
  // test seam, read by the workers in their loop: own cache line, away from the fields the caller writes every block
  alignas(64) std::atomic<uint32_t> anhalten_{0};   // bit i: worker i does not start jobs
  // written by the caller every block
  alignas(64) std::atomic<uint64_t> spaet_[N_KONTEN] = {{0}, {0}}, zurueck_[N_KONTEN] = {{0}, {0}}, haengt_[N_KONTEN] = {{0}, {0}};
  bool aus_faellig_[N_KONTEN] = {false, false};   // caller only
  int fenster_pos_ = 0;
  int fenster_[N_KONTEN][FENSTER] = {};     // late events per block and account, caller only
  int fenster_summe_[N_KONTEN] = {0, 0};
  std::atomic<bool> fifo_test_{false};
  std::atomic<PrioSetzer> prio_test_{nullptr};
  W w_[MAX_W];
};

}  // namespace cdj
