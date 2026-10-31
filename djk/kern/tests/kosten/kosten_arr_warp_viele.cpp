// Paket 1.13 Warp, Slice 3a, Task 16: Kosten des Moduls Arrangement mit 32 RE-PITCH-Spuren bei n Markern je Clip (E-K B1.3): (1) der Aufruf Arrangement::block für
// 256 Samples (die Segmentsuche je Sample), (2) der Tausch gegen einen inhaltsgleichen Schnappschuss (warp_gleich vergleicht alle Marker je aktiver Stimme im
// Callback-Zyklus). Kein Test, die Zahlen gehören in den Bericht. Stopp-Regeln des Plans: (1) Median-Zuwachs n = 4096 gegen n = 2 über 250 µs: melden;
// (2) Median der Tauschzeit bei n = 4096 über 300 µs: warp_gleich auf memcmp umstellen (Task 16 Step 4).
// Aufruf: kern_kosten_arr_warp_viele [Zyklen, Vorgabe 4000] [Tausche, Vorgabe 200]
#include <time.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>

#include "arr_bau.h"

using namespace arrtest;
using cdj::ArrArt;

namespace {

int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}
constexpr int64_t FPB = 23040;   // Frames je Beat einer 125-BPM-Quelle

double quantil(std::vector<double>& us, double p) {
  std::sort(us.begin(), us.end());
  return us[std::min(us.size() - 1, static_cast<size_t>(p * static_cast<double>(us.size())))];
}

// Marker gleichmäßig auf der Geraden 0..40 Beats; bei n = 2 genau die zwei von kosten_arr_warp
void marker(int n, std::vector<double>& mb, std::vector<double>& mf) {
  for (int i = 0; i < n; ++i) {
    const double b = 40.0 * i / (n - 1);
    mb.push_back(b);
    mf.push_back(b * static_cast<double>(FPB));
  }
}

struct Lage {
  std::vector<std::unique_ptr<Audio>> quellen;   // vor dem Treiber: die Quellen überleben die Schnappschüsse
  Treiber t;
  int n;
  explicit Lage(int marker_zahl) : n(marker_zahl) {
    for (int sp = 1; sp <= 32; ++sp) quellen.push_back(Audio::sinus(40 * FPB, 110.0 + 13.0 * sp, 0.03f));
    t.laden(bauen());
    t.arr.loop(true, 0.0, 32.0, t.s, t.k);
    t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
    for (int i = 0; i < 2000; ++i) block();   // warm laufen, Einsatz und Stimmen starten
  }
  cdj::ArrSnapshot* bauen() {   // ein neuer, inhaltsgleicher Schnappschuss (dieselben Audio-Zeiger: warp_gleich entscheidet über die Marker)
    Bau b;
    for (int sp = 1; sp <= 32; ++sp) {
      std::vector<double> mb, mf;
      marker(n, mb, mf);
      b.spur(sp, ArrArt::audio).clip(sp, ("k" + std::to_string(sp)).c_str(), 0.0, 1000.0, &quellen[static_cast<size_t>(sp - 1)]->a).warp(mb, mf);
    }
    return b.fertig();
  }
  void block() {
    float x[6][cdj::ARR_BLOCK] = {};
    t.arr.block(t.k, t.s, 256, x[0], x[1], x[2], x[3], x[4], x[5]);
    t.s += 256;
  }
};

}  // namespace

int main(int argc, char** argv) {
  const int zyklen = argc > 1 ? std::atoi(argv[1]) : 4000, tausche = argc > 2 ? std::atoi(argv[2]) : 200;
  double median_n2 = 0.0;
  for (int n : {2, 100, 865, 4096}) {
    Lage l(n);
    if (l.t.arr.stimmen() != 32) { std::fprintf(stderr, "kosten_arr_warp_viele: n=%d: %d Stimmen statt 32\n", n, l.t.arr.stimmen()); return 2; }
    std::vector<double> us;
    for (int i = 0; i < zyklen; ++i) {
      const int64_t t0 = jetzt_ns();
      l.block();
      us.push_back(static_cast<double>(jetzt_ns() - t0) / 1000.0);
    }
    const double med = quantil(us, 0.5), p99 = quantil(us, 0.99), p999 = quantil(us, 0.999);
    if (n == 2) median_n2 = med;
    std::printf("n=%4d Block: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Zuwachs gegen n=2 %+.1f µs\n", n, med, p99, p999, med - median_n2);
    std::vector<double> tu;   // Tausch gegen einen inhaltsgleichen Schnappschuss (die Stimmen bleiben gebunden)
    for (int i = 0; i < tausche; ++i) {
      cdj::ArrSnapshot* neu = l.bauen();
      const int64_t t0 = jetzt_ns();
      const cdj::ArrSnapshot* alt = l.t.arr.tausche(neu, l.t.s, l.t.k);
      tu.push_back(static_cast<double>(jetzt_ns() - t0) / 1000.0);
      if (alt) l.t.alt.push_back(alt);
      for (int k = 0; k < 8; ++k) l.block();
    }
    if (l.t.arr.stimmen() != 32) { std::fprintf(stderr, "kosten_arr_warp_viele: n=%d: nach den Tauschen %d Stimmen\n", n, l.t.arr.stimmen()); return 2; }
    // quantil sortiert tu an Ort und Stelle: erst die Quantile, dann das Maximum (die Auswertungsreihenfolge von Funktionsargumenten ist nicht festgelegt)
    const double t_med = quantil(tu, 0.5), t_p99 = quantil(tu, 0.99), t_max = tu.back();
    std::printf("n=%4d Tausch: Median %.1f µs, p99 %.1f µs, Maximum %.1f µs\n", n, t_med, t_p99, t_max);
    std::printf("{\"n\":%d,\"block_median_us\":%.1f,\"block_p999_us\":%.1f,\"tausch_median_us\":%.1f}\n", n, med, p999, t_med);
  }
  return 0;
}
