// Container core K8 (review follow-up I2): no malloc on the callback path of the container core. One run with
//  - a playing deck 1 and deck 3 (player buffers, stage 1 quellen_block),
//  - a stream track in a group on DJ output 3 (stream buffer) and a group on DJ output 1 (module pair),
//  - the four containers switching art (player, module, nothing) every 150 cycles, so blends run in all of them,
//  - a compressor keyed by deck/1 (key read from the player buffer).
// Counted only inside kern->zyklus() (alloc_intercept.h); the snapshot is built outside. Positive control: a malloc is counted.
// Under ASan/TSan the guard is missing: then "skipped", never "passed".
#include <cmath>
#include <cstdlib>
#include <string>

#include "arr_build.h"
#include "arr_run.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives

bool g_waechter = false;

using k35::N;

int main() {
  if (!ALLOC_ABFANG_VERFUEGBAR) {
    std::printf("skipped (sanitizer build): allocation guard not available\n");
    return 0;
  }
  k35::Arbeitsbestand ab("test_kern_container_alloc");
  k35::traeger(ab.pfad, "a2a0000000000e01", "--ohne-klick --freq 20 --traeger 0.5");
  k35::traeger(ab.pfad, "a2a0000000000e03", "--ohne-klick --freq 30 --traeger 0.5");
  arr35::Lauf x(ab.pfad, "test_kern_container_alloc");
  x.erz_quelle[4] = [](int64_t t) { return 0.25f * std::sin(0.05f * static_cast<float>(t)); };
  const int64_t FR = 400000;
  const std::string au = x.ordner.audio('a', FR, 0.25f);
  const std::string spuren =
      "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":1},\"clips\":[" + x.ordner.clip("c1", 0.0, 8.0, au, FR) + "],"
      "\"chain\":[{\"art\":\"komp\",\"slot\":1,\"key\":{\"q\":\"deck\",\"nr\":1,\"punkt\":\"post\"}}]},"
      "{\"nr\":2,\"art\":\"intern\",\"quelle\":{\"art\":\"strom\",\"strom\":5},\"ausgang\":{\"art\":\"gruppe\",\"nr\":2}}";
  x.ordner.roh(1, "{\"format\":\"cypherdj-arr/4\",\"nr\":1,\"spuren\":[" + spuren + "],\"live\":true,\"gruppen\":[{\"nr\":1,\"ausgang\":{\"art\":\"dj\",\"nr\":1}},{\"nr\":2,\"ausgang\":{\"art\":\"dj\",\"nr\":3}}]}");
  cdj::ArrLadeErgebnis le = cdj::lade_wiedergabe(x.ordner.pfad, 1, x.cache);
  if (!le.snap) std::printf("container_alloc: the project did not load: %s %s\n", le.grund.c_str(), le.meldung.c_str());
  PRUEF(le.snap != nullptr);
  if (le.snap) {
    cdj::Befehl b = x.neu(cdj::Befehl::ARR_LADEN, "andreas");
    b.zeiger = le.snap.release();
    b.arr_nr = 1;
    x.sende(b);
  }
  for (int sl = 1; sl <= 1; ++sl) {
    const std::string p = "ins/komp/" + std::to_string(sl) + "/";
    x.teil((p + "an").c_str(), 1.0f, 0.0, 0.0);
    x.teil((p + "schwelle").c_str(), -30.0f, 0.0, 0.0);
    x.teil((p + "ratio").c_str(), 8.0f, 0.0, 0.0);
    x.teil((p + "mix").c_str(), 1.0f, 0.0, 0.0);
  }
  for (const char* f : {"deck/1/fader", "deck/2/fader", "pad/1/fader", "pad/2/fader"}) x.teil(f, 0.0f, 0.0, 0.0, "andreas");
  x.k35::Lauf::laden(1, "a2a0000000000e01");
  x.k35::Lauf::laden(3, "a2a0000000000e03");
  x.lauf(8 * N);   // the loader answers within a few cycles
  x.k35::Lauf::start(1, 0.0);
  x.k35::Lauf::start(3, 0.0);
  x.start(0.0, 0);
  x.lauf(8 * N);

  long im_zyklus = 0;
  int wechsel = 0;
  const int arten[3] = {2, 0, 1};
  for (int i = 0; i < 2400; ++i) {
    if (i % 150 == 0) {   // every container changes its art, staggered, so some blend is running nearly all the time
      for (int c = 1; c <= 4; ++c) {
        cdj::Befehl b = x.neu(cdj::Befehl::CONTAINER_QUELLE, "andreas");
        b.nr = c;
        b.an = arten[(i / 150 + c) % 3];
        x.sende(b);
        ++wechsel;
      }
    }
    if (i % 150 == 40) {   // a second change inside the blend (continues from the weight reached)
      cdj::Befehl b = x.neu(cdj::Befehl::CONTAINER_QUELLE, "andreas");
      b.nr = 1 + (i / 150) % 4;
      b.an = arten[(i / 150) % 3];
      x.sende(b);
      ++wechsel;
    }
    const int64_t n0 = x.kern->sample();
    abfang_an();
    x.kern->zyklus(N, n0 * 20833);
    im_zyklus += abfang_aus();
    cdj::Ereignis e;
    while (x.ere->hole(e))
      if (e.art == cdj::Ereignis::ARR_ALT) cdj::gib_wiedergabe(static_cast<cdj::ArrSnapshot*>(const_cast<void*>(e.zeiger)), x.cache);
  }
  abfang_an();
  void* p = std::malloc(16);
  const long positiv = abfang_aus();
  std::free(p);
  int art_ok = 0;
  for (int c = 0; c < 4; ++c) art_ok += x.kern->container_art(c) >= 0 && x.kern->container_art(c) <= 2;
  std::printf("container_alloc: %ld allocations in 2400 cycles with %d art changes, positive control %ld\n", im_zyklus, wechsel, positiv);
  PRUEF(positiv >= 1);
  PRUEF(wechsel >= 64);
  PRUEF(art_ok == 4);
  PRUEF(im_zyklus == 0);
  PRUEF_ENDE();
}
