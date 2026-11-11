// Plan 1.11 T5: the round-trip measurement of an effect host (ArrHostMessung), a state machine in the callback.
// The fake host returns the send of the left channel delayed by D samples (D >= block, so the return of a block exists before the block runs, as in JACK where it is the send of two cycles ago).
// Cases:
//  1 messung_600      D = 600 -> rundweg 600, grund ok; also D = 512 with 256-sample blocks (2 x quantum) and with 64-sample sub-blocks; the impulse is 0.5 on L at the first sample, all else 0
//  2 messung_laeuft   transport running -> refused `laeuft`, nothing armed, the send is untouched; the transport starting during a measurement ends it with `laeuft`
//  3 messung_stumm    silent return -> -1 `kein_rueckweg` after exactly 16384 samples (not before); a hum below 0.05 does not count as a return
//  4 messung_host_fehlt  unhealthy host -> refused `host_fehlt`; a host that falls during the measurement ends it with `host_fehlt`
//  5 messung_belegt   a second start while a measurement runs is refused (`laeuft`), hosts measure independently
//  6 keine_allokation 3000 blocks of measurements: 0 allocations (positive control: a vector counts)
// Mutations (CMakeLists.txt): HOST_MESS_SCHWELLE (3: threshold 0, the hum counts as the return).
#include <cmath>
#include <cstdio>
#include <vector>

#include "cypherdj/arr_host_measurement.h"
#include "check.h"
#include "alloc_intercept.h"   // last: replaces malloc and relatives. Exactly one translation unit per program includes it.

using cdj::ArrHostMessung;
using G = cdj::ArrHostMessung::Grund;

struct Fake {
  int D = 600;
  float hum = 0.0f;
  std::vector<float> send_hist = std::vector<float>(100000, 0.0f);
  int64_t t = 0;
};

// runs one measurement with blocks of m samples; returns the number of blocks it took, fills the result
static int messe(ArrHostMessung& mm, Fake& f, int h, int m, int max_bloecke, bool laeuft = false, bool gesund = true) {
  std::vector<float> al(static_cast<size_t>(m)), ar(static_cast<size_t>(m)), rl(static_cast<size_t>(m)), rr(static_cast<size_t>(m));
  for (int b = 1; b <= max_bloecke; ++b) {
    for (int i = 0; i < m; ++i) {
      al[static_cast<size_t>(i)] = 0.3f;   // the stage's copy of the input: the measurement owns the send
      ar[static_cast<size_t>(i)] = 0.3f;
      const int64_t q = f.t + i - f.D;
      rl[static_cast<size_t>(i)] = (q >= 0 ? f.send_hist[static_cast<size_t>(q)] : 0.0f) + f.hum;
      rr[static_cast<size_t>(i)] = 0.0f;
    }
    const bool fertig = mm.block(h, al.data(), ar.data(), rl.data(), rr.data(), m, laeuft, gesund);
    for (int i = 0; i < m; ++i) f.send_hist[static_cast<size_t>(f.t + i)] = al[static_cast<size_t>(i)];
    if (b == 1) {   // the first block of the measurement: the impulse and nothing else
      PRUEF(al[0] == 0.5f);
      for (int i = 1; i < m; ++i) PRUEF(al[static_cast<size_t>(i)] == 0.0f);
      for (int i = 0; i < m; ++i) PRUEF(ar[static_cast<size_t>(i)] == 0.0f);
    }
    f.t += m;
    if (fertig) return b;
  }
  return -1;
}

int main() {
  // ---------------------------------------------------------------- 1 messung_600
  for (const int m : {256, 64}) {
    auto mm = std::make_unique<ArrHostMessung>();
    for (const int d : {600, 512, 1024}) {
      Fake f;
      f.D = d;
      PRUEF(mm->starte(1, false, true) == G::ok);
      PRUEF(mm->aktiv(1));
      const int bl = messe(*mm, f, 1, m, 200);
      std::printf("1: messung_600: D = %d, blocks of %d: rundweg %d after %d blocks, grund %d\n", d, m, mm->rundweg(1), bl, static_cast<int>(mm->grund(1)));
      PRUEF(bl > 0);
      PRUEF(mm->rundweg(1) == d);
      PRUEF(mm->grund(1) == G::ok);
      PRUEF(!mm->aktiv(1));
    }
  }
  // ---------------------------------------------------------------- 2 messung_laeuft
  {
    auto mm = std::make_unique<ArrHostMessung>();
    PRUEF(mm->starte(1, true, true) == G::laeuft);
    PRUEF(!mm->aktiv(1));
    float al[64], ar[64], rl[64] = {}, rr[64] = {};
    for (float& x : al) x = 0.3f;
    for (float& x : ar) x = 0.3f;
    const bool fertig = mm->block(1, al, ar, rl, rr, 64, false, true);
    PRUEF(!fertig);
    PRUEF(al[0] == 0.3f && al[10] == 0.3f);   // nothing armed: the send is not touched
    PRUEF(mm->rundweg(1) == -1);
    // the transport starts during a measurement
    PRUEF(mm->starte(1, false, true) == G::ok);
    PRUEF(!mm->block(1, al, ar, rl, rr, 64, false, true));
    PRUEF(mm->block(1, al, ar, rl, rr, 64, true, true));
    PRUEF(mm->rundweg(1) == -1 && mm->grund(1) == G::laeuft && !mm->aktiv(1));
    std::printf("2: messung_laeuft: refused on a running transport, ended by a starting one: rundweg %d grund %d\n", mm->rundweg(1), static_cast<int>(mm->grund(1)));
  }
  // ---------------------------------------------------------------- 3 messung_stumm
  {
    auto mm = std::make_unique<ArrHostMessung>();
    Fake f;
    f.D = 1000000;   // the return never comes
    PRUEF(mm->starte(2, false, true) == G::ok);
    const int bl = messe(*mm, f, 2, 256, 200);
    std::printf("3: messung_stumm: finished after %d blocks of 256 = %d samples, rundweg %d, grund %d\n", bl, bl * 256, mm->rundweg(2), static_cast<int>(mm->grund(2)));
    PRUEF(bl == 16384 / 256);   // exactly at 16384 samples, not at 16383
    PRUEF(mm->rundweg(2) == -1 && mm->grund(2) == G::kein_rueckweg);
    // one sample at a time: gives up at sample 16384, not before
    Fake f1;
    f1.D = 1000000;
    PRUEF(mm->starte(2, false, true) == G::ok);
    const int bl1 = messe(*mm, f1, 2, 1, 30000);
    PRUEF(bl1 == 16384);
    // a hum below the threshold is not a return; with a return of 0.06 the very first sample counts
    Fake fh;
    fh.D = 1000000;
    fh.hum = 0.04f;
    PRUEF(mm->starte(2, false, true) == G::ok);
    const int blh = messe(*mm, fh, 2, 256, 200);
    std::printf("3: hum 0.04 on the return: %d blocks, rundweg %d\n", blh, mm->rundweg(2));
    PRUEF(blh == 64 && mm->rundweg(2) == -1 && mm->grund(2) == G::kein_rueckweg);
    Fake fl;
    fl.D = 1000000;
    fl.hum = 0.06f;
    PRUEF(mm->starte(2, false, true) == G::ok);
    messe(*mm, fl, 2, 256, 200);
    PRUEF(mm->rundweg(2) == 0 && mm->grund(2) == G::ok);
  }
  // ---------------------------------------------------------------- 4 messung_host_fehlt
  {
    auto mm = std::make_unique<ArrHostMessung>();
    PRUEF(mm->starte(1, false, false) == G::host_fehlt);
    PRUEF(!mm->aktiv(1));
    PRUEF(mm->starte(0, false, true) == G::host_fehlt);   // no such host
    PRUEF(mm->starte(5, false, true) == G::host_fehlt);
    PRUEF(mm->starte(1, false, true) == G::ok);
    float al[64] = {}, ar[64] = {}, rl[64] = {}, rr[64] = {};
    PRUEF(!mm->block(1, al, ar, rl, rr, 64, false, true));
    PRUEF(mm->block(1, al, ar, rl, rr, 64, false, false));   // the host fell
    PRUEF(mm->rundweg(1) == -1 && mm->grund(1) == G::host_fehlt && !mm->aktiv(1));
    PRUEF(mm->starte(1, true, false) == G::laeuft);   // both reasons: the transport is named first
  }
  // ---------------------------------------------------------------- 5 messung_belegt
  {
    auto mm = std::make_unique<ArrHostMessung>();
    PRUEF(mm->starte(1, false, true) == G::ok);
    PRUEF(mm->starte(1, false, true) == G::laeuft);   // already running
    PRUEF(mm->starte(3, false, true) == G::ok);       // another host is independent
    PRUEF(mm->aktiv(1) && mm->aktiv(3) && !mm->aktiv(2));
    Fake f1, f3;
    f1.D = 600;
    f3.D = 900;
    // interleave the two hosts block by block
    std::vector<float> a1(256), b1(256), r1(256), s1(256), a3(256), b3(256), r3(256), s3(256);
    bool fertig1 = false, fertig3 = false;
    for (int b = 0; b < 200 && !(fertig1 && fertig3); ++b) {
      for (int i = 0; i < 256; ++i) {
        const int64_t q1 = f1.t + i - f1.D, q3 = f3.t + i - f3.D;
        r1[static_cast<size_t>(i)] = q1 >= 0 ? f1.send_hist[static_cast<size_t>(q1)] : 0.0f;
        r3[static_cast<size_t>(i)] = q3 >= 0 ? f3.send_hist[static_cast<size_t>(q3)] : 0.0f;
      }
      if (!fertig1) fertig1 = mm->block(1, a1.data(), b1.data(), r1.data(), s1.data(), 256, false, true);
      if (!fertig3) fertig3 = mm->block(3, a3.data(), b3.data(), r3.data(), s3.data(), 256, false, true);
      for (int i = 0; i < 256; ++i) {
        f1.send_hist[static_cast<size_t>(f1.t + i)] = a1[static_cast<size_t>(i)];
        f3.send_hist[static_cast<size_t>(f3.t + i)] = a3[static_cast<size_t>(i)];
      }
      f1.t += 256;
      f3.t += 256;
    }
    std::printf("5: messung_belegt: host 1 -> %d, host 3 -> %d\n", mm->rundweg(1), mm->rundweg(3));
    PRUEF(mm->rundweg(1) == 600 && mm->rundweg(3) == 900);
  }
  // ---------------------------------------------------------------- 6 keine_allokation
  {
    if (!ALLOC_ABFANG_VERFUEGBAR) {
      std::printf("6: allocation guard unavailable under this runtime: skipped, not passed\n");
    } else {
      auto mm = std::make_unique<ArrHostMessung>();
      Fake f;
      f.send_hist.assign(2000000, 0.0f);
      f.D = 600;
      float al[256], ar[256], rl[256], rr[256];
      abfang_an();
      int fertig_n = 0;
      for (int b = 0; b < 3000; ++b) {
        if (!mm->aktiv(1)) mm->starte(1, false, true);
        for (int i = 0; i < 256; ++i) {
          const int64_t q = f.t + i - f.D;
          rl[i] = q >= 0 ? f.send_hist[static_cast<size_t>(q)] : 0.0f;
          rr[i] = 0.0f;
        }
        if (mm->block(1, al, ar, rl, rr, 256, false, true)) ++fertig_n;
        for (int i = 0; i < 256; ++i) f.send_hist[static_cast<size_t>(f.t + i)] = al[i];
        f.t += 256;
      }
      const long n = abfang_aus();
      std::printf("6: keine_allokation: allocations in 3000 blocks with %d measurements = %ld\n", fertig_n, n);
      PRUEF(n == 0);
      PRUEF(fertig_n > 100);
      abfang_an();
      std::vector<int> v;
      v.push_back(1);
      PRUEF(abfang_aus() > 0);   // positive control
    }
  }
  PRUEF_ENDE();
}
