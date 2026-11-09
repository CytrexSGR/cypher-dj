// mehrkern Task 5: the kern reports the state of the Hall pool (event HALL_ZUSTAND, /zustand/hall_pool ,iiii: an, faeden, spaet, zurueck), the way it reports the
// Warp engine (/zustand/warp): on every change and otherwise every 24 000 samples (2 Hz). Without a pool it is reported as well, as 0 0 0 0 (case 1).
//   1  no pool          the kern still says an 0, faeden 0, spaet 0, zurueck 0 (first cycle, then 2 Hz), so /lage can tell it from an old kern; a pool replaces it
//   2  running pool     first message in the first cycle: an 1, faeden 2, spaet 0, zurueck 0; then the rate stays at 2 Hz (no message per block)
//   3  switch-off       5 late events within 64 blocks switch the pool off for good; the kern says it at once (an 0, spaet 5, zurueck 5) and keeps the counters
//   4  no pool again    detaching the pool (setze_hall_pool(nullptr)) goes back to an 0, faeden 0, spaet 0, zurueck 0
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

void nichts(void*, int) {}

int zaehle(const arr35::Lauf& x) {
  int n = 0;
  for (const cdj::Ereignis& e : x.ev) n += e.art == cdj::Ereignis::HALL_ZUSTAND;
  return n;
}

const cdj::Ereignis* letzter(const arr35::Lauf& x) {
  for (int i = static_cast<int>(x.ev.size()) - 1; i >= 0; --i)
    if (x.ev[static_cast<size_t>(i)].art == cdj::Ereignis::HALL_ZUSTAND) return &x.ev[static_cast<size_t>(i)];
  return nullptr;
}

}  // namespace

int main() {
  k35::Arbeitsbestand ab("test_hall_zustand");
  {  // 1
    arr35::Lauf x(ab.pfad, "test_hall_zustand_1");
    x.lauf(x.kern->sample() + 200 * N);
    const cdj::Ereignis* l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 1 (no pool): an %d, faeden %d, spaet %d, zurueck %d (%d messages after 200 blocks)\n", l->hall_an, l->hall_faeden, l->hall_spaet, l->hall_zurueck, zaehle(x));
      PRUEF(l->hall_an == 0 && l->hall_faeden == 0 && l->hall_spaet == 0 && l->hall_zurueck == 0);
    }
    PRUEF(zaehle(x) >= 2 && zaehle(x) <= 3);   // first cycle plus the 2 Hz beat (51 200 samples), not one per block
  }
  {  // 2, 3, 4
    arr35::Lauf x(ab.pfad, "test_hall_zustand_2");
    cdj::HallPoolEinstellung e;
    e.faeden = 2;
    cdj::HallPool pool(e);
    x.kern->setze_hall_pool(&pool);
    x.lauf(x.kern->sample() + 10 * N);
    const cdj::Ereignis* l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 2: an %d, faeden %d, spaet %d, zurueck %d (%d messages)\n", l->hall_an, l->hall_faeden, l->hall_spaet, l->hall_zurueck, zaehle(x));
      PRUEF(l->hall_an == 1 && l->hall_faeden == 2 && l->hall_spaet == 0 && l->hall_zurueck == 0);
    }
    x.lauf(x.kern->sample() + 300 * N);   // 76 800 samples = 3.2 s: the 2 Hz beat gives 4 messages at most, one per block would give 300
    const int n2 = zaehle(x);
    std::printf("Case 2: %d messages after 310 blocks\n", n2);
    PRUEF(n2 >= 3 && n2 <= 5);
    // 3: five late events (hole_zurueck of a held worker) in one window, then the next block start switches off
    pool.anhalten(true);
    cdj::HallPool* p = &pool;
    for (int i = 0; i < 5; ++i) {
      PRUEF(p->schicke(0, nichts, nullptr, i));
      PRUEF(p->hole_zurueck(0));
    }
    p->block_anfang();
    PRUEF(!p->an());
    x.lauf(x.kern->sample() + 2 * N);
    l = letzter(x);
    PRUEF(l != nullptr);
    if (l) {
      std::printf("Case 3: an %d, faeden %d, spaet %d, zurueck %d\n", l->hall_an, l->hall_faeden, l->hall_spaet, l->hall_zurueck);
      PRUEF(l->hall_an == 0 && l->hall_faeden == 2 && l->hall_spaet == 5 && l->hall_zurueck == 5);
    }
    pool.anhalten(false);
    // 4
    x.kern->setze_hall_pool(nullptr);
    x.lauf(x.kern->sample() + 2 * N);
    l = letzter(x);
    PRUEF(l != nullptr);
    if (l) PRUEF(l->hall_an == 0 && l->hall_faeden == 0 && l->hall_spaet == 0 && l->hall_zurueck == 0);
  }
  PRUEF_ENDE();
}
