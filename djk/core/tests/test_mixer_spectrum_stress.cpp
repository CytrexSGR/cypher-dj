// 1.15 A7b: two-thread stress of the spectrum source change (D12). The audio thread runs Mixer::verarbeite and switches spektrum/kanal 100 000
// times (random among 0 .. 19, every 1 .. 4 blocks); the network thread ticks a SpektrumSender as fast as it can (a fresh 40 ms of simulated time per
// call). Every channel carries its own sine (channel k: 300 Hz x 1.25^k, one band each), so a frame tagged X must peak in the band of X's sine.
// Checks: no frame with a wrong peak band for its tag (a mixed or mis-tagged frame; the silent erz/8 must show only silence), valid frames did arrive (positive control), the number of
// generation count is plausible. It is a race and gross-mixing check; it does NOT detect a missing cut or a missing second generation read (measured, the
// mutants of the deterministic test pass here): those faults are pinned by test_mixer_spektrum. Meant to run under CYPHERDJ_TSAN (reports are failures); in a plain build it checks the invariants only.
#include <cstdlib>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <thread>
#include <vector>

#include "cypherdj/net.h"
#include "mixer_wz_run.h"

using namespace wzt;

int main() {
  const int SWITCHES = std::getenv("SPEKTRUM_STRESS_N") ? std::atoi(std::getenv("SPEKTRUM_STRESS_N")) : 100000;   // env: a shorter run under TSan
  Lauf l;
  cdj::SpektrumSender snd(*l.m);
  // sine frequencies per channel, each in a different band of the upper half (bands 11 .. 28: 315 Hz .. 16 kHz; low bands of a partly filled window are not
  // a clean test of the peak); selector 19 (master) is the sum of all of them and is not checked for a peak, erz/8 (selector 12) is silent
  auto band_von = [](int sel) { return sel >= 1 && sel <= 18 ? sel + 10 : -1; };   // band index of channel sel-1
  double f[cdj::MIX_KANAELE];
  for (int k = 0; k < cdj::MIX_KANAELE; ++k) f[k] = 1000.0 * std::pow(2.0, (band_von(k + 1) - 16) / 3.0);
  std::atomic<bool> fertig{false};
  std::atomic<long> wechsel{0};

  std::thread audio([&] {
    uint32_t x = 2463534242u;
    auto rnd = [&] { x ^= x << 13; x ^= x >> 17; x ^= x << 5; return x; };
    int bis_wechsel = 1;
    for (long t = 0; wechsel.load(std::memory_order_relaxed) < SWITCHES; ) {
      const int n = 128;
      for (int k = 0; k < cdj::MIX_KANAELE; ++k)
        if (k != 11) l.sinus(k, f[k], 0.3, 0.3, n);   // erz/8 (11) is cue-only
      if (--bis_wechsel == 0) {
        const int sel = static_cast<int>(rnd() % 20);
        l.setze("spektrum/kanal", static_cast<float>(sel));
        bis_wechsel = 1 + static_cast<int>(rnd() % 4);
        wechsel.fetch_add(1, std::memory_order_relaxed);
      }
      l.m->verarbeite(n, l.ml, l.mr, l.cl, l.cr);
      l.t += n;
      (void)t;
    }
    fertig.store(true, std::memory_order_release);
  });

  long gueltig = 0, falsch = 0, ticks = 0, leer = 0;
  long falsch_je[20] = {};
  int64_t jetzt = 0;
  uint32_t zuletzt = 0, gesehen = 0;
  std::thread netz([&] {
    while (!fertig.load(std::memory_order_acquire)) {
      const auto fr = snd.tick(jetzt);
      jetzt += cdj::SPEKTRUM_ABSTAND_NS;
      ++ticks;
      if (fr.empty()) ++leer;
      for (const auto& r : fr) {
        // parse the peak band
        int n = 0, best = 0;
        long bestv = -100000;

        const char* s = r.pegel.c_str();
        while (*s) {
          char* e = nullptr;
          const long v = std::strtol(s, &e, 10);
          if (e == s) break;
          if (v > bestv) { bestv = v; best = n; }
          ++n;
          s = e;
          if (*s == ',') ++s;
        }
        int sel = -1;
        for (int q = 1; q <= 18; ++q)
          if (r.kanal == cdj::Mixer::kanal_name(q - 1)) sel = q;
        if (n != 29) { ++falsch; continue; }
        if (sel < 0) {   // the master: all channels at once, only the shape of the string is checked
          if (r.kanal == "master") ++gueltig; else ++falsch;
          continue;
        }
        if (sel == 12) {   // erz/8: silent
          if (bestv < -1500) ++gueltig; else { ++falsch; ++falsch_je[sel]; }
          continue;
        }
        if (best == band_von(sel)) ++gueltig; else { ++falsch; ++falsch_je[sel]; }
      }
      const uint32_t g = l.m->spek_generation();
      if (g != zuletzt) { ++gesehen; zuletzt = g; }
    }
  });
  audio.join();
  netz.join();
  std::printf("stress: %ld switches, %ld ticks (%ld without a frame), %ld valid frames, %ld wrong frames, generation %u, changes seen by the net thread %u\n",
              wechsel.load(), ticks, leer, gueltig, falsch, l.m->spek_generation(), gesehen);
  for (int q = 0; q < 20; ++q) if (falsch_je[q]) std::printf("  wrong frames tagged selector %d: %ld\n", q, falsch_je[q]);
  PRUEF(falsch == 0);
  PRUEF(gueltig > 0);                                          // positive control: the check saw frames
  // seqlock: two generation steps per change (odd while written, even after); a write of the same value is no change (1 in 20)
  PRUEF(l.m->spek_generation() >= static_cast<uint32_t>(SWITCHES) / 10u * 9u * 2u);
  PRUEF(l.m->spek_generation() <= static_cast<uint32_t>(SWITCHES) * 2u);
  PRUEF((l.m->spek_generation() & 1u) == 0);
  PRUEF_ENDE();
}
