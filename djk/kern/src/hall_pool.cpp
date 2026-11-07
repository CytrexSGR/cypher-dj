#include "cypherdj/hall_pool.h"

#include <climits>
#include <system_error>
#include <cstdio>

#include <linux/futex.h>
#include <pthread.h>
#include <sched.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

namespace cdj {

namespace {
long futex(std::atomic<uint32_t>* addr, int op, uint32_t val) {
  return syscall(SYS_futex, reinterpret_cast<uint32_t*>(addr), op, val, nullptr, nullptr, 0);
}
int64_t mono_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return int64_t(t.tv_sec) * 1000000000LL + t.tv_nsec;
}
}  // namespace

HallPool::HallPool(const HallPoolEinstellung& e) {
  n_ = e.faeden < 0 ? 0 : (e.faeden > MAX_W ? MAX_W : e.faeden);
  spin_ns_ = e.spin_ns < 0 ? 0 : e.spin_ns;
  const int64_t frist_us = e.frist_us > 0 ? e.frist_us : (e.bloecke_us > 0 ? e.bloecke_us / 4 : 1333);
  frist_ns_.store(frist_us * 1000, std::memory_order_relaxed);
  frist_fest_ = e.frist_us > 0;
  for (int i = 0; i < n_; ++i) w_[i].cpu = e.cpus[i];
  const int gewollt = n_;
  n_ = 0;
  for (int i = 0; i < gewollt; ++i) {
    try {
      w_[i].th = std::thread([this, i] { arbeit(i); });
    } catch (const std::system_error& err) {
      std::fprintf(stderr, "Hall pool: worker %d not created (%s), continuing with %d worker(s)\n", i, err.what(), i);
      break;
    }
    n_ = i + 1;
  }
  for (int i = 0; i < n_; ++i)
    while (!w_[i].faden_bereit.load(std::memory_order_acquire)) std::this_thread::yield();
  an_.store(n_ > 0, std::memory_order_release);
}

void HallPool::setze_bloecke_us(int us) {
  if (us <= 0 || frist_fest_) return;
  frist_ns_.store(static_cast<int64_t>(us) / 4 * 1000, std::memory_order_relaxed);
}

HallPool::~HallPool() {
  an_.store(false, std::memory_order_release);
  anhalten_.store(0, std::memory_order_release);
  for (int i = 0; i < n_; ++i) {
    uint32_t erw = BEREIT;
    // a job nobody collected is dropped (never started), a running one is waited for
    if (w_[i].st.compare_exchange_strong(erw, ZURUECK, std::memory_order_acq_rel)) w_[i].st.store(FREI, std::memory_order_release);
    while (w_[i].st.load(std::memory_order_acquire) == LAEUFT) std::this_thread::yield();
  }
  halt_.store(true, std::memory_order_seq_cst);
  for (int i = 0; i < n_; ++i) {
    w_[i].st.store(HALT, std::memory_order_seq_cst);   // changes the futex word, so a worker about to sleep cannot miss the wake
    futex(&w_[i].st, FUTEX_WAKE_PRIVATE, INT_MAX);
  }
  for (int i = 0; i < n_; ++i) w_[i].th.join();
}

void HallPool::arbeit(int i) {
  W& x = w_[i];
  if (x.cpu >= CPU_SETSIZE) {
    std::fprintf(stderr, "Hall pool: worker %d: CPU %d out of range, not pinned\n", i, x.cpu);
  } else if (x.cpu >= 0) {
    cpu_set_t cs;
    CPU_ZERO(&cs);
    CPU_SET(x.cpu, &cs);
    if (pthread_setaffinity_np(pthread_self(), sizeof cs, &cs) != 0) std::fprintf(stderr, "Hall pool: worker %d: pinning to CPU %d failed\n", i, x.cpu);
  }
#if defined(__x86_64__) || defined(__i386__)   // FTZ/DAZ is an x86 MXCSR bit pair
  _mm_setcsr(_mm_getcsr() | 0x8040u);   // FTZ | DAZ as an extra safeguard: the callback thread does not set them globally, Hall::block wraps every call in DenormalSchutz (hall.h)
#endif
  x.faden_bereit.store(true, std::memory_order_release);
  for (;;) {
    uint32_t s = x.st.load(std::memory_order_acquire);
    if (s == BEREIT) {
      if (((anhalten_.load(std::memory_order_acquire) >> i) & 1u) && !halt_.load(std::memory_order_relaxed)) {
        usleep(200);
        continue;
      }
      uint32_t erw = BEREIT;
      if (x.st.compare_exchange_strong(erw, LAEUFT, std::memory_order_acq_rel)) {
        x.f(x.ctx, x.arg);
        x.st.store(FERTIG, std::memory_order_seq_cst);
        // Read only: the flag belongs to the caller (it clears it on return). Clearing it here could erase the flag of the NEXT round
        // when the caller saw fertig by polling and has already started that round.
        if (x.wartet.load(std::memory_order_seq_cst)) futex(&x.st, FUTEX_WAKE_PRIVATE, INT_MAX);
      }
      continue;
    }
    if (s == HALT) return;
    // Dekker with schicke: announce the sleep, look again, then wait on the value just seen (a change makes futex wait return at once)
    x.schlaeft.store(1, std::memory_order_seq_cst);
    s = x.st.load(std::memory_order_seq_cst);
    if (s != BEREIT && s != HALT) futex(&x.st, FUTEX_WAIT_PRIVATE, s);
    x.schlaeft.store(0, std::memory_order_relaxed);
  }
}

bool HallPool::schicke(int w, Job f, void* ctx, int arg) {
  if (w < 0 || w >= n_ || !f || !an_.load(std::memory_order_acquire)) return false;
  W& x = w_[w];
  if (x.st.load(std::memory_order_acquire) != FREI) return false;
  x.f = f;
  x.ctx = ctx;
  x.arg = arg;
  x.t_schicke = mono_ns();
  x.st.store(BEREIT, std::memory_order_seq_cst);
  // The flag is cleared by the worker alone, never here: after a take-back the state can be frei again before the worker has really
  // slept (ABA on the futex value), and a flag cleared by the caller would then leave it asleep through the next job.
  if (x.schlaeft.load(std::memory_order_seq_cst)) futex(&x.st, FUTEX_WAKE_PRIVATE, 1);
  return true;
}

void HallPool::spaet_zaehlen() {
  spaet_.fetch_add(1, std::memory_order_relaxed);
  ++fenster_[fenster_pos_];
  if (++fenster_summe_ > SPAET_MAX) aus_faellig_ = true;
}

bool HallPool::hole_zurueck(int w) {
  if (w < 0 || w >= n_) return false;
  W& x = w_[w];
  uint32_t erw = BEREIT;
  if (!x.st.compare_exchange_strong(erw, ZURUECK, std::memory_order_acq_rel)) return false;
  zurueck_.fetch_add(1, std::memory_order_relaxed);
  spaet_zaehlen();
  x.st.store(FREI, std::memory_order_release);   // the worker saw bereit at most as a stale value; its CAS now fails
  return true;
}

void HallPool::warte(int w) {
  if (w < 0 || w >= n_) return;
  W& x = w_[w];
  uint32_t s = x.st.load(std::memory_order_acquire);
  if (s == FREI) return;   // nothing outstanding
  const bool war_fertig = s == FERTIG;   // a job that was done on entry is never late, whatever the caller did before
  if (!war_fertig) {
    const int64_t bis = mono_ns() + spin_ns_;
    while ((s = x.st.load(std::memory_order_acquire)) != FERTIG) {
      if (mono_ns() > bis) {
        for (;;) {
          x.wartet.store(1, std::memory_order_seq_cst);
          s = x.st.load(std::memory_order_seq_cst);
          if (s == FERTIG) break;
          futex(&x.st, FUTEX_WAIT_PRIVATE, s);
        }
        x.wartet.store(0, std::memory_order_seq_cst);   // only the caller clears it
        break;
      }
      cpu_pause();
    }
  }
  const bool spaet = !war_fertig && mono_ns() - x.t_schicke > frist_ns_.load(std::memory_order_relaxed);
  x.st.store(FREI, std::memory_order_release);
  if (spaet) spaet_zaehlen();
}

bool HallPool::fertig(int w) const {
  return w >= 0 && w < n_ && w_[w].st.load(std::memory_order_acquire) == FERTIG;
}

bool HallPool::bereit(int w) const {
  return w >= 0 && w < n_ && w_[w].st.load(std::memory_order_acquire) == BEREIT;
}

bool HallPool::frist_um(int w) const {
  if (w < 0 || w >= n_) return false;
  return mono_ns() - w_[w].t_schicke > frist_ns_.load(std::memory_order_relaxed);
}

bool HallPool::alle_frei() const {
  for (int i = 0; i < n_; ++i)
    if (w_[i].st.load(std::memory_order_acquire) != FREI) return false;
  return true;
}

void HallPool::block_anfang() {
  if (aus_faellig_ && alle_frei()) {
    an_.store(false, std::memory_order_release);
    aus_faellig_ = false;
  }
  // The lateness window slides here and nowhere else, so it counts the last FENSTER blocks that did pool work (hall_parallel calls this once per
  // block it runs in), not wall-clock blocks. That is harmless: a late event is only produced by schicke/warte/hole_zurueck inside hall_parallel,
  // after this call in the same block, so a block without pool work (e.g. the arrangement at rest) neither adds an event nor needs an old one to
  // expire. After a rest the window still holds the events from before it (at most SPAET_MAX without a switch-off), which only errs on the safe side.
  fenster_pos_ = (fenster_pos_ + 1) % FENSTER;
  fenster_summe_ -= fenster_[fenster_pos_];
  fenster_[fenster_pos_] = 0;
}

void HallPool::prioritaet(int jack_prio) {
  if (jack_prio <= 1) {
    std::fprintf(stderr, "Hall pool: JACK thread without real-time priority (%d), the workers stay SCHED_OTHER; under load the pool then switches itself off quickly (visible in /lage and the end-of-run line)\n", jack_prio);
    return;
  }
  int ok = 0;
  for (int i = 0; i < n_; ++i) {
    sched_param sp{};
    sp.sched_priority = jack_prio - 1;
    const int rc = pthread_setschedparam(w_[i].th.native_handle(), SCHED_FIFO, &sp);
    if (rc != 0) std::fprintf(stderr, "Hall pool: worker %d: SCHED_FIFO %d failed (%d)\n", i, jack_prio - 1, rc);
    else ++ok;
  }
  if (ok > 0) std::fprintf(stderr, "Hall pool: %d workers SCHED_FIFO %d\n", ok, jack_prio - 1);
}

}  // namespace cdj
