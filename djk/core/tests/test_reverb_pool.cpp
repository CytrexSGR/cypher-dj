// Task 3 (mehrkern): HallPool without the arrangement.
// Cases: 1 pool_rechnet (3 workers, 10000 rounds of 3 jobs, every result there, no late event), 2 pool_zurueck (a running job is never taken back and is
// waited for; a job that is still bereit is taken back and computed by the caller, the worker never starts it), 3 pool_abschalten (5 late events within 64 blocks
// switch off at the next block start, 4 do not, events slide out of the window; afterwards nothing runs on a worker), 4 pool_keine_allokation, 5 pool_null.
// 2b pool_spaet_ist_ein_spaeter_worker (a job already fertig on entry to warte is never late, however long the caller worked first),
// 6 pool_stress (spin_ns 0, mixed immediate take-back and join, job durations 0..50 us, watchdog).
// Task 4 (mehrkern slice 3): 8 pool_konten_getrennt, 9 pool_spur_zurueck_nicht_spaet, 10 pool_spur_frist, 11 pool_mxcsr, 12 pool_fifo, 13 pool_haengt,
// 14 pool_stress_spur, 15 pool_spaet_melden (two accounts HALL/SPUR, MXCSR hand-over, FIFO state, hard wait limit).
// Late events are made deterministic with the test seam anhalten(): a held worker leaves the job bereit and the caller takes it back.
#include <time.h>
#include <unistd.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <random>
#include <thread>

#include "cypherdj/reverb_pool.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using cdj::HallPool;
using cdj::HallPoolEinstellung;

namespace {

struct Slot {
  uint32_t out[16] = {};
  std::atomic<int> gestartet{0};
  int schlaf_us = 0;
};

void schreibe(void* ctx, int arg) {
  Slot* s = static_cast<Slot*>(ctx);
  s->gestartet.store(1, std::memory_order_release);
  if (s->schlaf_us > 0) usleep(static_cast<useconds_t>(s->schlaf_us));
  for (int i = 0; i < 16; ++i) s->out[i] = static_cast<uint32_t>(arg) * 2654435761u + static_cast<uint32_t>(i);
}
bool stimmt(const Slot& s, int arg) {
  for (int i = 0; i < 16; ++i)
    if (s.out[i] != static_cast<uint32_t>(arg) * 2654435761u + static_cast<uint32_t>(i)) return false;
  return true;
}
void zaehle(void* ctx, int) { static_cast<std::atomic<int>*>(ctx)->fetch_add(1, std::memory_order_relaxed); }

int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return int64_t(t.tv_sec) * 1000000000LL + t.tv_nsec;
}
void beschaeftigt(int64_t ns) {
  const int64_t bis = jetzt_ns() + ns;
  while (jetzt_ns() < bis) cdj::cpu_pause();
}
struct Dauer {
  Slot slot;
  int dauer_ns = 0;
};
void job_dauer(void* ctx, int arg) {
  Dauer* d = static_cast<Dauer*>(ctx);
  beschaeftigt(d->dauer_ns);
  schreibe(&d->slot, arg);
}

HallPoolEinstellung ein(int faeden, int frist_us) {
  HallPoolEinstellung e;
  e.faeden = faeden;
  e.frist_us = frist_us;
  return e;
}

}  // namespace

int main() {
  {  // 1 pool_rechnet
    HallPool p(ein(3, 5'000'000));
    PRUEF(p.faeden() == 3 && p.an());
    Slot s[3];
    int falsch = 0;
    for (int r = 1; r <= 10000; ++r) {
      p.block_anfang();
      for (int w = 0; w < 3; ++w) {
        for (auto& v : s[w].out) v = 0;
        if (!p.schicke(w, schreibe, &s[w], r + w)) ++falsch;
      }
      for (int w = 0; w < 3; ++w) {
        p.warte(w);
        if (!stimmt(s[w], r + w)) ++falsch;
      }
    }
    std::printf("1: wrong results %d, spaet %llu, zurueck %llu\n", falsch, (unsigned long long)p.spaet(), (unsigned long long)p.zurueck());
    PRUEF(falsch == 0);
    PRUEF(p.spaet() == 0);
    PRUEF(p.zurueck() == 0);
    PRUEF(p.an());
  }

  {  // 2 pool_zurueck
    HallPool p(ein(2, 5'000'000));
    Slot lang;
    lang.schlaf_us = 30000;
    PRUEF(p.schicke(0, schreibe, &lang, 11));
    while (!lang.gestartet.load(std::memory_order_acquire)) usleep(100);   // the job is running (and sleeping)
    PRUEF(!p.hole_zurueck(0));                                            // a running job is never taken back
    PRUEF(!p.schicke(0, schreibe, &lang, 12));                            // the worker is not frei
    p.warte(0);
    PRUEF(stimmt(lang, 11));
    PRUEF(p.zurueck() == 0);

    std::atomic<int> gerechnet{0};
    p.anhalten(true);
    PRUEF(p.schicke(0, zaehle, &gerechnet, 0));
    PRUEF(p.hole_zurueck(0));   // still bereit: the caller takes it
    zaehle(&gerechnet, 0);      // ... and computes it itself
    PRUEF(p.zurueck() == 1);
    PRUEF(p.spaet() == 1);
    PRUEF(!p.hole_zurueck(0));  // nothing left to take
    p.anhalten(false);
    usleep(20000);
    PRUEF(gerechnet.load() == 1);   // the worker did not start the taken-back job
    p.warte(0);                     // frei: returns at once
    Slot z;
    PRUEF(p.schicke(1, schreibe, &z, 5));   // the pool still works
    p.warte(1);
    PRUEF(stimmt(z, 5));
    PRUEF(p.zurueck() == 1 && p.an());
  }

  {  // 3 pool_abschalten
    auto spaetes_ereignis = [](HallPool& p, std::atomic<int>& n) {
      p.block_anfang();
      p.anhalten(true);
      PRUEF(p.schicke(0, zaehle, &n, 0));
      PRUEF(p.hole_zurueck(0));
      p.anhalten(false);
    };
    auto ruhiger_block = [](HallPool& p) {
      Slot s;
      p.block_anfang();
      PRUEF(p.schicke(0, schreibe, &s, 3));
      p.warte(0);
      PRUEF(stimmt(s, 3));
    };
    {  // 4 late events (any number of blocks later, sliding out) do not switch off; 4 more after the window still do not
      HallPool p(ein(1, 5'000'000));
      std::atomic<int> n{0};
      for (int i = 0; i < 4; ++i) spaetes_ereignis(p, n);
      for (int i = 0; i < 70; ++i) ruhiger_block(p);
      for (int i = 0; i < 4; ++i) spaetes_ereignis(p, n);
      p.block_anfang();
      PRUEF(p.an());
      PRUEF(p.spaet() == 8);
    }
    {  // 5 late events within 64 blocks
      HallPool p(ein(1, 5'000'000));
      std::atomic<int> n{0};
      for (int i = 0; i < 3; ++i) spaetes_ereignis(p, n);
      for (int i = 0; i < 20; ++i) ruhiger_block(p);
      for (int i = 0; i < 2; ++i) spaetes_ereignis(p, n);
      PRUEF(p.spaet() == 5);
      PRUEF(p.an());                  // the switch waits for the next block start
      p.block_anfang();
      PRUEF(!p.an());
      Slot s;
      PRUEF(!p.schicke(0, schreibe, &s, 1));
      std::atomic<int> w{0};
      PRUEF(!p.schicke(0, zaehle, &w, 0));
      usleep(20000);
      PRUEF(w.load() == 0);           // nothing runs on a worker afterwards
      p.block_anfang();
      PRUEF(!p.an());                 // off for good
    }
    {  // a late wait counts too: the job sleeps longer than frist_us
      HallPool p(ein(1, 2000));
      Slot s;
      s.schlaf_us = 20000;
      PRUEF(p.schicke(0, schreibe, &s, 9));
      p.warte(0);
      PRUEF(stimmt(s, 9));
      PRUEF(p.spaet() == 1 && p.zurueck() == 0);
    }
  }

  {  // 2b pool_spaet_ist_ein_spaeter_worker: the job is long done, only the caller worked long: never late
    HallPool p(ein(1, 100));
    for (int i = 0; i < 100; ++i) {
      Slot s;
      p.block_anfang();
      PRUEF(p.schicke(0, schreibe, &s, i));
      while (!p.fertig(0)) cdj::cpu_pause();   // the job is done (no time limit: independent of the wake latency)
      beschaeftigt(300000);   // 300 us of own work, frist 100 us
      p.warte(0);
      PRUEF(stimmt(s, i));
    }
    std::printf("2b: spaet %llu\n", (unsigned long long)p.spaet());
    PRUEF(p.spaet() == 0);
    PRUEF(p.an());
  }

  {  // 6 pool_stress: spin_ns 0 forces futex on both sides, mixed take-back and join, job durations 0..50 us; a watchdog fails the test instead of hanging
    HallPoolEinstellung e = ein(3, 1'000'000'000);
    e.spin_ns = 0;
    HallPool p(e);
    std::atomic<long> fortschritt{0};
    std::atomic<bool> ende{false};
    std::thread wache([&] {
      long letzt = -1;
      int still = 0;
      while (!ende.load()) {
        for (int i = 0; i < 10 && !ende.load(); ++i) usleep(100000);
        const long f = fortschritt.load();
        if (f == letzt) {
          if (++still >= 5) {
            std::fprintf(stderr, "pool_stress: HANG after %ld rounds\n", f);
            std::fflush(stderr);
            _exit(3);
          }
        } else {
          still = 0;
          letzt = f;
        }
      }
    });
    std::mt19937 rng(4711);
    Dauer d[3];
    long falsch = 0, runden = 0, zur = 0;
    const int64_t start = jetzt_ns();
    for (long r = 1; r <= 200000 && jetzt_ns() - start < 3'000'000'000LL; ++r, ++runden) {
      p.block_anfang();
      bool ok[3];
      for (int w = 0; w < 3; ++w) {
        d[w].dauer_ns = static_cast<int>(rng() % 50001);
        for (auto& v : d[w].slot.out) v = 0;
        ok[w] = p.schicke(w, job_dauer, &d[w], static_cast<int>(r) + w);
        if (!ok[w]) ++falsch;
      }
      // a take-back is a late event and more than 4 per 64 blocks switch the pool off: at most 2 + 2 per 64 rounds, tried right after
      // schicke while the worker (spin_ns 0) still sleeps in futex wait, so the caller usually wins
      for (int w = 0; w < 2; ++w)
        if (r % 32 == 16 * w && p.hole_zurueck(w)) {
          ++zur;
          job_dauer(&d[w], static_cast<int>(r) + w);
        }
      beschaeftigt(rng() % 30000);
      for (int w = 0; w < 3; ++w) {
        if (rng() % 3 == 0) beschaeftigt(rng() % 20000);
        p.warte(w);
        if (!stimmt(d[w].slot, static_cast<int>(r) + w)) ++falsch;
      }
      fortschritt.store(r);
    }
    ende.store(true);
    wache.join();
    std::printf("6: rounds %ld, wrong %ld, taken back %ld (zurueck() %llu)\n", runden, falsch, zur, (unsigned long long)p.zurueck());
    PRUEF(falsch == 0);
    PRUEF(runden >= 2000);
    PRUEF(zur >= 10);   // the take-back path is really exercised
    PRUEF(p.zurueck() == static_cast<uint64_t>(zur));
    PRUEF(p.an());
  }

  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("4 skipped (sanitizer build): allocation watcher not available\n");
  } else {  // 4 pool_keine_allokation
    HallPool p(ein(3, 5'000'000));
    Slot s[3];
    long geschickt = 0;
    abfang_an();
    for (int r = 0; r < 2000; ++r) {
      p.block_anfang();
      for (int w = 0; w < 3; ++w)
        if (p.schicke(w, schreibe, &s[w], r)) ++geschickt;
      // take-backs are late events: at most 2 per 64 rounds here, so the pool stays on for the whole window
      if (r % 32 == 0 && p.hole_zurueck(0)) schreibe(&s[0], r);
      for (int w = 0; w < 3; ++w) p.warte(w);
    }
    const long im_fenster = abfang_aus();
    std::printf("4: allocations in 2000 rounds = %ld\n", im_fenster);
    std::printf("4: jobs sent %ld of 6000\n", geschickt);
    PRUEF(im_fenster == 0L);
    PRUEF(geschickt == 6000);   // the pool really ran all 2000 rounds
    PRUEF(p.an());
    abfang_an();
    { HallPool zweiter(ein(1, 1000)); }
    const long bau_zaehlt = abfang_aus();
    std::printf("4: allocations while constructing a pool = %ld\n", bau_zaehlt);
    PRUEF(bau_zaehlt > 0);   // positive control
  }

  {  // 5 pool_null
    HallPool p(ein(0, 0));
    PRUEF(p.faeden() == 0);
    PRUEF(!p.an());
    Slot s;
    PRUEF(!p.schicke(0, schreibe, &s, 1));
    p.block_anfang();
    p.warte(0);
    PRUEF(!p.hole_zurueck(0));
    PRUEF(p.spaet() == 0 && p.zurueck() == 0);
  }

  {  // 7 pool_frist_folgt_blocklaenge (mehrkern task 5): the deadline is 25 % of the block period and follows setze_bloecke_us; an explicit frist_us wins
    HallPoolEinstellung e;
    e.faeden = 1;
    e.bloecke_us = 5333;   // 256 samples at 48 kHz
    HallPool p(e);
    PRUEF(p.frist_us() == 1333);
    p.setze_bloecke_us(2666);   // 128 samples
    PRUEF(p.frist_us() == 666);
    p.setze_bloecke_us(0);      // nonsense is ignored
    p.setze_bloecke_us(-5);
    PRUEF(p.frist_us() == 666);
    p.setze_bloecke_us(21333);  // 1024 samples
    PRUEF(p.frist_us() == 5333);
    HallPoolEinstellung f = e;
    f.frist_us = 500;
    HallPool q(f);
    PRUEF(q.frist_us() == 500);
    q.setze_bloecke_us(2666);
    PRUEF(q.frist_us() == 500);
    // the changed deadline is the one warte() and frist_um() use: a held worker is not late right after schicke under a 20 ms deadline (plenty of
    // reserve for a loaded host: the first check must not depend on the thread being scheduled within 1.3 ms), and is late once the deadline is
    // changed to 1333 us and 2 ms have passed (a delay only makes that check safer). The first check can still flip if the thread is descheduled for more
    // than the 20 ms reserve between schicke and frist_um; that is the accepted margin (15x the old one)
    p.setze_bloecke_us(80000);   // 20 ms deadline
    p.anhalten(true);
    Slot s;
    PRUEF(p.schicke(0, schreibe, &s, 1));
    PRUEF(p.frist_us() == 20000);
    PRUEF(!p.frist_um(0));
    p.setze_bloecke_us(5333);    // 1333 us deadline
    PRUEF(p.frist_us() == 1333);
    usleep(2000);
    PRUEF(p.frist_um(0));
    PRUEF(p.hole_zurueck(0));
    p.setze_bloecke_us(80000);   // 20 ms deadline
    PRUEF(p.schicke(0, schreibe, &s, 2));
    usleep(2000);
    PRUEF(!p.frist_um(0));       // 2 ms after schicke is not late any more
    PRUEF(p.hole_zurueck(0));
    p.anhalten(false);
  }

  {  // 8 pool_konten_getrennt: every account has its own window and its own switch-off
    auto ereignis = [](HallPool& p, std::atomic<int>& n, HallPool::Konto k) {
      p.block_anfang();
      p.anhalten(true);
      PRUEF(p.schicke(0, zaehle, &n, 0, k));
      PRUEF(p.hole_zurueck(0, true));
      p.anhalten(false);
    };
    auto ruhig = [](HallPool& p, int n) { for (int i = 0; i < n; ++i) p.block_anfang(); };
    const HallPool::Konto konten[2] = {HallPool::SPUR, HallPool::HALL};
    for (const HallPool::Konto k : konten) {
      const HallPool::Konto anderes = k == HallPool::SPUR ? HallPool::HALL : HallPool::SPUR;
      {  // 4 events do not switch off, neither the account nor the other one
        HallPool p(ein(1, 5'000'000));
        std::atomic<int> n{0};
        for (int i = 0; i < 4; ++i) ereignis(p, n, k);
        p.block_anfang();
        PRUEF(p.an(k) && p.an(anderes));
        PRUEF(p.spaet(k) == 4 && p.spaet(anderes) == 0);
        // the FIFTH switches off at the next block start; the other account stays on
        ereignis(p, n, k);
        PRUEF(p.an(k));
        p.block_anfang();
        PRUEF(!p.an(k));
        PRUEF(p.an(anderes));
        PRUEF(p.spaet(k) == 5 && p.spaet(anderes) == 0);
        Slot s;
        PRUEF(!p.schicke(0, schreibe, &s, 1, k));
        PRUEF(p.schicke(0, schreibe, &s, 2, anderes));   // the other account still computes on the worker
        p.warte(0);
        PRUEF(stimmt(s, 2));
      }
      {  // 4, then 70 quiet blocks, then 4 more: the old ones slid out, still on
        HallPool p(ein(1, 5'000'000));
        std::atomic<int> n{0};
        for (int i = 0; i < 4; ++i) ereignis(p, n, k);
        ruhig(p, 70);
        for (int i = 0; i < 4; ++i) ereignis(p, n, k);
        p.block_anfang();
        PRUEF(p.an(k) && p.an(anderes));
        PRUEF(p.spaet(k) == 8);
      }
    }
  }

  {  // 9 pool_spur_zurueck_nicht_spaet: an unstarted track job taken back by the caller is not a late event
    HallPool p(ein(1, 5'000'000));
    std::atomic<int> n{0};
    p.anhalten(true);   // the worker cannot start the job
    p.block_anfang();
    PRUEF(p.schicke(0, zaehle, &n, 0, HallPool::SPUR));
    PRUEF(p.hole_zurueck(0, false));
    zaehle(&n, 0);
    PRUEF(p.spaet(HallPool::SPUR) == 0);
    PRUEF(p.zurueck(HallPool::SPUR) == 1);
    for (int i = 0; i < 100; ++i) p.block_anfang();
    PRUEF(p.an(HallPool::SPUR) && p.an(HallPool::HALL));
    // the same with als_spaet = true counts, in the SPUR account only
    PRUEF(p.schicke(0, zaehle, &n, 0, HallPool::SPUR));
    PRUEF(p.hole_zurueck(0, true));
    PRUEF(p.spaet(HallPool::SPUR) == 1 && p.zurueck(HallPool::SPUR) == 2);
    PRUEF(p.spaet() == 0 && p.zurueck() == 0);
    // a Hall job counts late whatever the flag says (today's behaviour)
    PRUEF(p.schicke(0, zaehle, &n, 0, HallPool::HALL));
    PRUEF(p.hole_zurueck(0, false));
    PRUEF(p.spaet() == 1 && p.zurueck() == 1 && p.spaet(HallPool::SPUR) == 1);
    p.anhalten(false);
    usleep(20000);
    PRUEF(n.load() == 1);   // the worker never started a taken-back job
  }

  {  // 10 pool_spur_frist: the worker misses frist_um, the take-back counts late for SPUR only
    HallPool p(ein(1, 2000));
    std::atomic<int> n{0};
    p.anhalten(true);
    PRUEF(p.schicke(0, zaehle, &n, 0, HallPool::SPUR));
    while (!p.frist_um(0)) usleep(200);
    PRUEF(p.hole_zurueck(0, p.frist_um(0)));
    PRUEF(p.spaet(HallPool::SPUR) == 1 && p.zurueck(HallPool::SPUR) == 1);
    PRUEF(p.spaet() == 0 && p.zurueck() == 0);
    p.anhalten(false);
  }

#if defined(__x86_64__) || defined(__i386__)
  {  // 11 pool_mxcsr: the job runs under the caller's MXCSR, the worker's own FTZ|DAZ is back afterwards
    struct Csr {
      std::atomic<uint32_t> wert{0};
    } c;
    auto lies = [](void* ctx, int) { static_cast<Csr*>(ctx)->wert.store(_mm_getcsr(), std::memory_order_release); };
    HallPool p(ein(2, 5'000'000));
    const uint32_t alt = _mm_getcsr();
    _mm_setcsr(0x1f80u);   // x86 default: no FTZ/DAZ, like the callback
    const uint32_t meins = _mm_getcsr();
    PRUEF(p.schicke(0, lies, &c, 0, HallPool::SPUR, meins));
    p.warte(0);
    const uint32_t mit = c.wert.load(std::memory_order_acquire);
    _mm_setcsr(alt);
    std::printf("11: worker csr with hand-over 0x%x\n", mit);
    PRUEF((mit & ~0x3fu) == 0x1f80u);
    c.wert.store(0);
    PRUEF(p.schicke(0, lies, &c, 0));   // no hand-over, as the Hall case 1
    p.warte(0);
    const uint32_t ohne = c.wert.load(std::memory_order_acquire);
    std::printf("11: worker csr without hand-over 0x%x\n", ohne);
    PRUEF((ohne & ~0x3fu) == 0x9fc0u);
  }
#endif

  {  // 12 pool_fifo
    auto verweigert = [](std::thread::native_handle_type, int) { return 1; };   // EPERM-like
    auto erlaubt = [](std::thread::native_handle_type, int) { return 0; };
    {
      HallPool p(ein(3, 5'000'000));
      PRUEF(!p.fifo());
      p.prioritaet(1);   // no RT priority: refusal, nothing changes
      PRUEF(!p.fifo());
      p.setze_prio_test(verweigert);
      p.prioritaet(50);
      PRUEF(!p.fifo());
      p.setze_prio_test(erlaubt);
      p.prioritaet(50);
      PRUEF(p.fifo());
      p.setze_prio_test(nullptr);
    }
    {  // one refusing worker is enough to keep fifo() false
      HallPool p(ein(2, 5'000'000));
      static std::atomic<int> aufrufe;
      aufrufe.store(0);
      p.setze_prio_test([](std::thread::native_handle_type, int) { return aufrufe.fetch_add(1) == 0 ? 0 : 1; });
      p.prioritaet(50);
      PRUEF(!p.fifo());
      p.setze_prio_test(nullptr);
    }
    {  // no workers
      HallPool p(ein(0, 0));
      p.setze_prio_test(erlaubt);
      p.prioritaet(50);
      PRUEF(!p.fifo());
    }
    {  // the test switch
      HallPool p(ein(2, 5'000'000));
      PRUEF(!p.fifo());
      p.setze_fifo_test(true);
      PRUEF(p.fifo());
      p.setze_fifo_test(false);
      PRUEF(!p.fifo());
    }
    {  // reader on another thread while prioritaet runs (TSan): never true before the last worker reported, true afterwards
      HallPool p(ein(3, 5'000'000));
      p.setze_prio_test([](std::thread::native_handle_type, int) { usleep(2000); return 0; });
      std::atomic<bool> los{false}, fertig_{false};
      std::atomic<long> gelesen_wahr{0}, gelesen_falsch{0};
      std::thread leser([&] {
        while (!los.load()) cdj::cpu_pause();
        while (!fertig_.load(std::memory_order_acquire)) (p.fifo() ? gelesen_wahr : gelesen_falsch).fetch_add(1);
      });
      los.store(true);
      p.prioritaet(50);
      fertig_.store(true, std::memory_order_release);
      leser.join();
      PRUEF(p.fifo());
      std::printf("12: reader saw false %ld times, true %ld times\n", gelesen_falsch.load(), gelesen_wahr.load());
      p.setze_prio_test(nullptr);
    }
  }

  {  // 13 pool_haengt: a started job beyond the hard limit is reported, never abandoned
    struct Halt {
      Slot slot;
      std::atomic<int> gestartet{0}, frei{0};
    } h;
    auto halte = [](void* ctx, int arg) {
      Halt* x = static_cast<Halt*>(ctx);
      x->gestartet.store(1, std::memory_order_release);
      while (!x->frei.load(std::memory_order_acquire)) cdj::cpu_pause();
      schreibe(&x->slot, arg);
    };
    HallPool p(ein(2, 5'000'000));
    p.block_anfang();
    {  // control: a quick job within the limit
      Slot s;
      PRUEF(p.schicke(1, schreibe, &s, 4, HallPool::SPUR));
      PRUEF(p.warte(1, jetzt_ns() + 2'000'000'000LL));
      PRUEF(stimmt(s, 4));
      PRUEF(p.haengt(HallPool::SPUR) == 0);
    }
    PRUEF(p.schicke(0, halte, &h, 7, HallPool::SPUR));
    while (!h.gestartet.load(std::memory_order_acquire)) cdj::cpu_pause();
    std::thread frei([&] {   // releases the job only after the pool has reported the missed limit
      const int64_t bis = jetzt_ns() + 3'000'000'000LL;   // safety net: a broken pool must end red, not hang
      while (p.haengt(HallPool::SPUR) == 0 && jetzt_ns() < bis) usleep(100);
      h.frei.store(1, std::memory_order_release);
    });
    const bool ok = p.warte(0, jetzt_ns() + 2'000'000);
    frei.join();
    PRUEF(!ok);
    PRUEF(p.haengt(HallPool::SPUR) == 1);
    PRUEF(p.haengt() == 0);
    PRUEF(stimmt(h.slot, 7));   // the join completed and the output is intact
    PRUEF(p.an(HallPool::SPUR));   // taken at the next block start
    p.block_anfang();
    PRUEF(!p.an(HallPool::SPUR));
    PRUEF(p.an(HallPool::HALL));
    Slot s;
    PRUEF(p.schicke(0, schreibe, &s, 8));   // the Halls keep running
    p.warte(0);
    PRUEF(stimmt(s, 8));
    {  // a HALL job held past the limit is counted for the HALL account only, and only the SPUR account switches off on a hang
      Halt h2;
      PRUEF(p.schicke(1, halte, &h2, 9, HallPool::HALL));
      while (!h2.gestartet.load(std::memory_order_acquire)) cdj::cpu_pause();
      std::thread frei2([&] {
        const int64_t bis = jetzt_ns() + 3'000'000'000LL;
        while (p.haengt(HallPool::HALL) == 0 && jetzt_ns() < bis) usleep(100);
        h2.frei.store(1, std::memory_order_release);
      });
      const bool ok2 = p.warte(1, jetzt_ns() + 2'000'000);
      frei2.join();
      PRUEF(!ok2);
      PRUEF(p.haengt(HallPool::HALL) == 1);
      PRUEF(p.haengt(HallPool::SPUR) == 1);   // unchanged by the HALL hang
      PRUEF(stimmt(h2.slot, 9));
      PRUEF(p.an(HallPool::HALL));
      p.block_anfang();
      PRUEF(p.an(HallPool::HALL));   // the HALL account stays on at the next block
      PRUEF(!p.an(HallPool::SPUR));
    }
  }

  {  // 14 pool_stress_spur: case 6 with mixed accounts and mixed take-back flag
    HallPoolEinstellung e = ein(3, 1'000'000'000);
    e.spin_ns = 0;
    HallPool p(e);
    std::atomic<long> fortschritt{0};
    std::atomic<bool> ende{false};
    std::thread wache([&] {
      long letzt = -1;
      int still = 0;
      while (!ende.load()) {
        for (int i = 0; i < 10 && !ende.load(); ++i) usleep(100000);
        const long f = fortschritt.load();
        if (f == letzt) {
          if (++still >= 5) {
            std::fprintf(stderr, "pool_stress_spur: HANG after %ld rounds\n", f);
            std::fflush(stderr);
            _exit(3);
          }
        } else {
          still = 0;
          letzt = f;
        }
      }
    });
    std::mt19937 rng(815);
    Dauer d[3];
    long falsch = 0, runden = 0, zur = 0;
    const int64_t start = jetzt_ns();
    for (long r = 1; r <= 20000 && jetzt_ns() - start < 20'000'000'000LL; ++r, ++runden) {
      p.block_anfang();
      bool konto_spur[3];
      for (int w = 0; w < 3; ++w) {
        d[w].dauer_ns = static_cast<int>(rng() % 50001);
        for (auto& v : d[w].slot.out) v = 0;
        konto_spur[w] = (rng() & 1u) != 0;
        if (!p.schicke(w, job_dauer, &d[w], static_cast<int>(r) + w, konto_spur[w] ? HallPool::SPUR : HallPool::HALL)) ++falsch;
      }
      for (int w = 0; w < 2; ++w)
        if (r % 32 == 16 * w && p.hole_zurueck(w, (rng() & 1u) != 0)) {
          ++zur;
          job_dauer(&d[w], static_cast<int>(r) + w);
        }
      beschaeftigt(rng() % 30000);
      for (int w = 0; w < 3; ++w) {
        if (rng() % 3 == 0) beschaeftigt(rng() % 20000);
        p.warte(w, (rng() & 1u) != 0 ? jetzt_ns() + 1'000'000'000LL : 0);
        if (!stimmt(d[w].slot, static_cast<int>(r) + w)) ++falsch;
      }
      fortschritt.store(r);
    }
    ende.store(true);
    wache.join();
    std::printf("14: rounds %ld, wrong %ld, taken back %ld (zurueck HALL %llu SPUR %llu)\n", runden, falsch, zur,
                (unsigned long long)p.zurueck(), (unsigned long long)p.zurueck(HallPool::SPUR));
    PRUEF(falsch == 0);
    PRUEF(runden >= 2000);
    PRUEF(zur >= 10);
    PRUEF(p.zurueck() + p.zurueck(HallPool::SPUR) == static_cast<uint64_t>(zur));
    PRUEF(p.haengt(HallPool::SPUR) == 0);
  }

  {  // 15 pool_spaet_melden
    HallPool p(ein(1, 5'000'000));
    for (int i = 0; i < 4; ++i) {
      p.block_anfang();
      p.spaet_melden(HallPool::SPUR);
    }
    p.block_anfang();
    PRUEF(p.an(HallPool::SPUR) && p.an(HallPool::HALL));
    PRUEF(p.spaet(HallPool::SPUR) == 4 && p.spaet() == 0);
    p.spaet_melden(HallPool::SPUR);
    PRUEF(p.an(HallPool::SPUR));   // the switch waits for the next block start
    p.block_anfang();
    PRUEF(!p.an(HallPool::SPUR));
    PRUEF(p.an(HallPool::HALL) && p.an());
    PRUEF(p.spaet(HallPool::SPUR) == 5 && p.spaet() == 0 && p.zurueck(HallPool::SPUR) == 0);
  }

  PRUEF_ENDE();
}
