// Paket 1.13 Warp, Slice 1: Kosten des Moduls Arrangement mit 32 Audio-Spuren im Callback, einmal ohne Warp, einmal als RE-PITCH
// (125-BPM-Quellen im 128er Projekt, Catmull-Rom je Sample), einmal RE-PITCH mit Tempo-Rampe in der Karte. Gemessen wird der Aufruf
// Arrangement::block für 256 Samples (der Teil des Kern-Zyklus, den Slice 1 verändert); kein Test, die Zahlen gehören in den
// Bericht. Spec 1.13 7.2 rechnet 32 Spuren RE-PITCH mit rund 80 µs. Stopp-Regel des Plans: liegt der Median von rp mehr als 1000 µs
// über dem von ohne, hält die Hauptinstanz an, bevor Slice 2 geplant wird.
// Aufruf: kern_kosten_arr_warp [Zyklen, Vorgabe 20000]
#include <time.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <vector>

#include "arr_bau.h"   // tests/arr_bau.h (der Aufbau legt tests/ in den Include-Pfad)

using namespace arrtest;
using cdj::ArrArt;

namespace {

int64_t jetzt_ns() {
  timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return static_cast<int64_t>(t.tv_sec) * 1000000000LL + t.tv_nsec;
}

constexpr int64_t FPB = 23040;   // Frames je Beat einer 125-BPM-Quelle

void bericht(const char* lage, std::vector<double>& us) {
  std::sort(us.begin(), us.end());
  const auto q = [&](double p) { return us[std::min(us.size() - 1, static_cast<size_t>(p * static_cast<double>(us.size())))]; };
  std::printf("%-8s Zyklen %zu: Median %.1f µs, p99 %.1f µs, p99,9 %.1f µs, Maximum %.1f µs\n", lage, us.size(), q(0.5), q(0.99), q(0.999),
              us.back());
  std::printf("{\"lage\":\"%s\",\"zyklen\":%zu,\"median_us\":%.1f,\"p99_us\":%.1f,\"p999_us\":%.1f,\"max_us\":%.1f}\n", lage, us.size(),
              q(0.5), q(0.99), q(0.999), us.back());
}

// Median der Lage; -1 bei Fehler
double lage(const char* name, bool warp, bool rampe, int zyklen, bool beats = false) {
  Treiber t;
  if (rampe) t.k.rampe(8.0, 140.0, 16.0);
  std::vector<std::unique_ptr<Audio>> quellen;
  Bau b;
  for (int sp = 1; sp <= 32; ++sp) {
    quellen.push_back(Audio::sinus(40 * FPB, 110.0 + 13.0 * sp, 0.03f));   // 32 verschiedene Töne, je eine eigene Datei im Speicher
    b.spur(sp, ArrArt::audio).clip(sp, ("k" + std::to_string(sp)).c_str(), 0.0, 1000.0, &quellen.back()->a);
    if (warp) b.warp({0.0, 40.0}, {0.0, 40.0 * static_cast<double>(FPB)}, beats ? 1 : 0);
    if (beats) {   // Slice 4: Einheiten 1/16 (640 auf 40 Beats), Lücke vor, Hülle 100
      std::vector<double> eb, ef;
      for (int u = 0; u < 640; ++u) {
        eb.push_back(u * 0.25);
        ef.push_back(static_cast<double>(u * (FPB / 4)));
      }
      b.beats(eb, ef, 1, 100);
    }
  }
  t.laden(b.fertig());
  t.arr.loop(true, 0.0, 32.0, t.s, t.k);   // 32 Beats = 15 s; die Quellen sind 40 Beats lang, die Stimmen starten an jeder Naht neu
  t.arr.start(0.0, 0, false, 0, 537, 256, t.k);
  float x[6][cdj::ARR_BLOCK] = {};
  int64_t s = 0;
  auto block = [&] {
    for (auto& v : x) std::fill(v, v + 256, 0.0f);
    t.arr.block(t.k, s, 256, x[0], x[1], x[2], x[3], x[4], x[5]);
    s += 256;
  };
  for (int i = 0; i < 2000; ++i) block();   // warm laufen, Einsatz und Stimmen starten
  if (t.arr.stimmen() != 32 || (warp && t.arr.warp_stimmen() != 32)) {
    std::fprintf(stderr, "kosten_arr_warp: Lage %s hat %d Stimmen (%d gewarpt), erwartet 32: sie misst nicht, was sie soll\n", name, t.arr.stimmen(),
                 t.arr.warp_stimmen());
    return -1.0;
  }
  std::vector<double> us;
  us.reserve(static_cast<size_t>(zyklen));
  for (int i = 0; i < zyklen; ++i) {
    const int64_t t0 = jetzt_ns();
    block();
    us.push_back(static_cast<double>(jetzt_ns() - t0) / 1000.0);
  }
  if (t.arr.stimmen() != 32) {
    std::fprintf(stderr, "kosten_arr_warp: Lage %s: nach der Messung klingen %d Stimmen statt 32 (die Clips reichen nicht)\n", name, t.arr.stimmen());
    return -1.0;
  }
  bericht(name, us);
  return us[us.size() / 2];
}

}  // namespace

int main(int argc, char** argv) {
  const int n = argc > 1 ? std::atoi(argv[1]) : 20000;
  const double ohne = lage("ohne", false, false, n);
  const double rp = lage("rp", true, false, n);
  const double rampe = lage("rp_rampe", true, true, n);
  const double be = lage("beats", true, false, n, true);          // Slice 4
  const double be_r = lage("beats_rampe", true, true, n, true);
  if (ohne < 0 || rp < 0 || rampe < 0 || be < 0 || be_r < 0) return 2;
  std::printf("Zuwachs gegen ohne: rp %.1f µs, rp_rampe %.1f µs, beats %.1f µs, beats_rampe %.1f µs (Median)\n", rp - ohne, rampe - ohne, be - ohne, be_r - ohne);
  return 0;
}
