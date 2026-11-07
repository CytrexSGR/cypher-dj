// Task 3 (mehrkern): HallPool without the arrangement.
// Cases: 1 pool_rechnet (3 workers, 10000 rounds of 3 jobs, every result there, no late event), 2 pool_zurueck (a running job is never taken back and is
// waited for; a job that is still bereit is taken back and computed by the caller, the worker never starts it), 3 pool_abschalten (5 late events within 64 blocks
// switch off at the next block start, 4 do not, events slide out of the window; afterwards nothing runs on a worker), 4 pool_keine_allokation, 5 pool_null.
// 2b pool_spaet_ist_ein_spaeter_worker (a job already fertig on entry to warte is never late, however long the caller worked first),
// 6 pool_stress (spin_ns 0, mixed immediate take-back and join, job durations 0..50 us, watchdog).
// Late events are made deterministic with the test seam anhalten(): a held worker leaves the job bereit and the caller takes it back.
#include <time.h>
#include <unistd.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <random>
#include <thread>

#include "cypherdj/hall_pool.h"
#include "pruef.h"
#include "alloc_abfang.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

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

  PRUEF_ENDE();
}
