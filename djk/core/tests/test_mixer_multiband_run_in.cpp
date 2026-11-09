// 1.15 A4 fix round 2: the warm-up rule of the second multiband object for crossover targets that keep moving, at block sizes 256, 128, 64 and 32.
// The re-review (r1) measured four cracks in the rule of fix round 1 (all level peaks, no click, no lost target):
//  (E1) small/big was decided by the LOWER crossover alone, so every jump of grenze_hoch ran in place (random targets: peak 0.585..0.774)
//  (E2) small steps were compared with the LAST target and so could add up (tief 400 -> 20 in steps of x0.90: peak 0.586 at n = 128)
//  (E3) a big step shortly before the cap got no full warm-up (peak 0.526..0.546)
//  (E4) the pins held for n = 256 only; below that the least rest of 240 samples kept the warm-up open up to the cap (lag 119..120 ms, not 37 ms)
// The rule now (mixer.cpp, mb_block): the ANCHOR is the pair of crossovers at the last leeren() of the second object. A new target during the
// warm-up is small when BOTH crossovers are within 10 percent of the anchor: it goes in place, and the warm-up is extended only while it has run
// no longer than its base length + 240 samples. Otherwise it is only kept pending (the object is not touched); after the crossfade a new cycle
// starts with leeren() and the full warm-up.
// Every run: a 0.5 sine on the bus, one crossover moves, the other stays; the peak must stay within the limit of its case (constants below;
// a run without the change peaks at 0.500). All sizes, bus/1 and bus/4.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <functional>
#include <random>
#include <string>
#include <vector>

#include "mixer_wz_run.h"

using namespace wzt;

namespace {
// The peak limits and the limits 52.94 / 168.9 / 181 ms are "measured maximum + 0.5 percent" (the runs are deterministic), with the measured value
// beside them. Measured 2026-11-03 over the block sizes 256, 128, 64, 32 and both buses. The 50 ms of LAG_OBEN_MS (and the 150 ms of the Z7 test in
// test_mixer_multiband_grenzen) are controller decisions, not measured + 0.5 percent. Two peak limits were loosened by that rule: SPITZE_TIEF_DREHEN
// 0.52 -> 0.5219 here, and the Z7 deep-crossover peak 0.515 -> 0.5174 (controller decision, A4 fix round 3).
// Upper crossover (and every case where the sine is far from the lower crossover): the twin's peak is 0.500.
constexpr double SPITZE_GRENZE = 0.5026;            // measured 0.50007 (E4, n = 64)
// Lower crossover down to 20 Hz: an empty Linkwitz-Riley 8 does not settle within the warm-up (960 * 100 Hz / f samples, 100 ms at most) when the
// sine sits close to it, so a remainder stays. It is a level error, no click. Upper bound about 1.07x the twin's peak below about 60 Hz.
constexpr double SPITZE_TIEF = 0.5084;              // deterministic cases E1, E2, E3: measured 0.50578 (E2 chain, n = 32)
constexpr double SPITZE_TIEF_ZUFALL = 0.5280;       // E3b random targets, one new target after 1..3 units of 256 samples: measured 0.52528 (n = 64)
constexpr double SPITZE_TIEF_ZUFALL_BLOCK = 0.5364; // E3c random targets after 1..3 blocks of n samples (1.5 kHz at n = 32): measured 0.53370 (n = 32, seed 2)
constexpr double SPITZE_TIEF_DREHEN = 0.5219;       // E4 continuous turning 100 -> 20 Hz: measured 0.51922 (n = 128, update every 256 samples)
// Lag of the active crossover (definition of Z7). The 50 ms hold for updates at least 128 samples (2.7 ms, 375 Hz) apart.
constexpr double LAG_OBEN_MS = 50.0;                // measured 45.33 (n = 128, update every 128 samples)
// Updates in every block of 32 or 64 samples (1.5 kHz / 750 Hz control rate, far above any real knob): measured 52.67 ms (n = 32), 47 ms (n = 64).
constexpr double LAG_OBEN_SCHNELL_MS = 52.94;       // measured 52.67
// Lower crossover (100 -> 20 Hz): one cycle is the base warm-up (up to 100 ms at 20 Hz) + the extension (1200 samples = 25 ms at 20 Hz, 5 ms at 100 Hz and
// above) + the 10 ms crossfade + the wait for the next cycle + blocks.
constexpr double LAG_TIEF_MS = 168.9;               // measured 168.0 (updates at least 128 samples apart)
constexpr double LAG_TIEF_SCHNELL_MS = 181.0;       // measured 180.0 (update in every block of 64 samples)

struct Erg {
  double spitze = 0.0, schritt = 0.0, natuerlich = 0.0, ende_hz = 0.0, soll = 0.0, lag_ms = 0.0;   // natuerlich: step/peak of the sine itself
  unsigned blenden = 0;
};

// Runs `bloecke` blocks of n samples (starting at sample 0 of the measured part); `plan(sample)` returns the new target for the block that starts at
// `sample` (<= 0: none). Settles 320 ms before, runs 400 ms after to let the last target arrive.
Erg lauf(int K, const char* feld, double start, double sinus_hz, int n, long samples, const std::function<double(long)>& plan, long einschwingen = 15360) {
  Lauf l;
  l.setze(K, "mb/an", 1.0f);
  l.setze(K, feld, static_cast<float>(start));
  for (int b = 0; b < einschwingen / n; ++b) {
    l.sinus(K, sinus_hz, 0.5, 0.5, n);
    l.verarbeite(n);
  }
  const bool hoch = feld[strlen("mb/grenze_")] == 'h';
  std::vector<float> v;
  Erg e;
  e.soll = start;
  const unsigned b0 = l.m->mb_blenden(K);
  std::vector<double> ziel = {start}, aktiv;   // ziel[j]: target after j updates; aktiv[b]: the active crossover after block b
  std::vector<size_t> ziel_bis_block;
  for (long s = 0; s < samples; s += n) {
    const double t = plan(s);
    if (t > 0.0) {
      e.soll = t;
      l.setze(K, feld, static_cast<float>(t));
      ziel.push_back(t);
    }
    ziel_bis_block.push_back(ziel.size() - 1);
    l.sinus(K, sinus_hz, 0.5, 0.5, n);
    l.verarbeite(n);
    v.insert(v.end(), l.m->master_summe_l(), l.m->master_summe_l() + n);
    aktiv.push_back(hoch ? l.m->mb_grenze_hoch_hz(K) : l.m->mb_grenze_tief_hz(K));
  }
  // lag: for every block, how many blocks ago the target IN FORCE was the one that the active crossover equals now (the newest such block; the
  // start value counts as in force at block -1). Same definition as Z7 in test_mixer_multiband_grenzen.
  int lag = 0;
  for (size_t b = 0; b < aktiv.size(); ++b) {
    long alter = -1;
    for (long c = static_cast<long>(b); c >= -1; --c) {
      const double t = c < 0 ? start : ziel[ziel_bis_block[static_cast<size_t>(c)]];
      if (std::fabs(t - aktiv[b]) < 1e-3 * aktiv[b]) {
        alter = static_cast<long>(b) - c;
        break;
      }
    }
    lag = std::max(lag, alter < 0 ? 1000000 : static_cast<int>(alter));
  }
  e.lag_ms = lag * static_cast<double>(n) / 48.0;
  for (int b = 0; b < 19200 / n; ++b) {
    l.sinus(K, sinus_hz, 0.5, 0.5, n);
    l.verarbeite(n);
    v.insert(v.end(), l.m->master_summe_l(), l.m->master_summe_l() + n);
  }
  double g = 0.0;
  for (size_t i = 1; i < v.size(); ++i) {
    g = std::fmax(g, std::fabs(v[i] - v[i - 1]));
    e.spitze = std::fmax(e.spitze, std::fabs(v[i]));
  }
  e.schritt = g / e.spitze;
  e.natuerlich = 2.0 * 3.14159265358979 * sinus_hz / 48000.0;
  e.ende_hz = hoch ? l.m->mb_grenze_hoch_hz(K) : l.m->mb_grenze_tief_hz(K);
  e.blenden = l.m->mb_blenden(K) - b0;
  return e;
}

int fehler_vorher = 0;
void pruefe(const char* tag, int n, int K, const Erg& e, double grenze) {
  std::printf("%-62s n=%3d %s: peak %.5f (limit %.5f)  step/peak %.4f  end %.1f of %.1f  %u crossfades\n", tag, n, kname(K), e.spitze, grenze, e.schritt, e.ende_hz,
              e.soll, e.blenden);
  PRUEF(e.spitze <= grenze);
  PRUEF(e.schritt <= 1.4 * e.natuerlich);   // no click: the largest step stays within 1.4x the sine's own (measured at most 1.25x)
  PRUEF_NAH(e.ende_hz, e.soll, 1e-3 * e.soll);   // no target is lost
}
}  // namespace

int main() {
  for (const int n : {256, 128, 64, 32}) {
    for (const int K : {BUS1, 17}) {
      // (E1) classification looks at BOTH crossovers: hoch jumps with tief constant are big steps. A small step first (2000 -> 2100), then the jump.
      for (const double sh : {800.0, 1500.0}) {
        char t[100];
        std::snprintf(t, sizeof t, "E1 hoch 2000->2100->20000 (sine %.0f)", sh);
        pruefe(t, n, K, lauf(K, "mb/grenze_hoch", 2000, sh, n, 14 * 256, [](long s) { return s == 10 * 256 ? 2100.0 : s == 12 * 256 ? 20000.0 : -1.0; }), SPITZE_GRENZE);
        std::snprintf(t, sizeof t, "E1 hoch 20000->19000->300 (sine %.0f)", sh);
        pruefe(t, n, K, lauf(K, "mb/grenze_hoch", 20000, sh, n, 14 * 256, [](long s) { return s == 10 * 256 ? 19000.0 : s == 12 * 256 ? 300.0 : -1.0; }), SPITZE_GRENZE);
      }
      for (const double sh : {60.0, 150.0}) {
        char t[100];
        std::snprintf(t, sizeof t, "E1 tief 200->210->20 (sine %.0f)", sh);
        pruefe(t, n, K, lauf(K, "mb/grenze_tief", 200, sh, n, 14 * 256, [](long s) { return s == 10 * 256 ? 210.0 : s == 12 * 256 ? 20.0 : -1.0; }), SPITZE_TIEF);
      }
      // (E2) a chain of small steps (x0.90 per update, each within 10 percent of the LAST target) must not add up to a big one
      for (const int alle : {256, 512}) {
        for (const double sh : {60.0, 150.0}) {
          char t[100];
          double g = 400.0;
          std::snprintf(t, sizeof t, "E2 tief 400 x0.90 every %d samples to 20 (sine %.0f)", alle, sh);
          pruefe(t, n, K, lauf(K, "mb/grenze_tief", 400, sh, n, 80 * 256, [&](long s) { if (s < 5 * 256 || s % alle) return -1.0; g = std::fmax(20.0, g * 0.90); return g; }), SPITZE_TIEF);
        }
      }
      {
        double g = 480.0;
        pruefe("E2 hoch 480 x1.099 every 256 samples to 20000 (sine 300)", n, K,
               lauf(K, "mb/grenze_hoch", 480, 300, n, 60 * 256, [&](long s) { if (s < 5 * 256 || s % 256) return -1.0; g = std::fmin(20000.0, g * 1.099); return g; }), SPITZE_GRENZE);
      }
      // (E3) slow turning, then a big jump at a sample position around the cap of the warm-up (4800 samples)
      for (const long j : {512L, 7680L, 8704L, 9216L, 9728L, 10752L}) {
        for (const double sh : {60.0, 150.0}) {
          char t[100];
          double g = 400.0;
          std::snprintf(t, sizeof t, "E3 tief x0.99 then x0.2 at sample %ld (sine %.0f)", j, sh);
          pruefe(t, n, K, lauf(K, "mb/grenze_tief", 400, sh, n, j + 40 * 256, [&](long s) {
                   if (s % 256) return -1.0;
                   if (s < j) { g *= 0.99; return g; }
                   if (s - j < n) { g *= 0.2; return g; }
                   return -1.0;
                 }), SPITZE_TIEF);
        }
      }
      // (E3b) random targets (log-uniform, every 1..3 units of 256 samples, 2 s), both crossovers, 6 seeds
      for (const char* feld : {"mb/grenze_tief", "mb/grenze_hoch"}) {
        for (unsigned seed = 1; seed <= 6; ++seed) {
          std::mt19937 rng(seed);
          const bool hoch = feld[strlen("mb/grenze_")] == 'h';
          long naechst = 0;
          char t[100];
          std::snprintf(t, sizeof t, "E3b random %s seed %u", feld, seed);
          pruefe(t, n, K, lauf(K, feld, hoch ? 2000 : 200, hoch ? 700 : 80, n, 96000, [&](long s) {
                   if (s < naechst) return -1.0;
                   naechst = s + (1 + static_cast<long>(rng() % 3)) * 256;
                   const double u = static_cast<double>(rng() % 100000) / 100000.0;
                   return hoch ? 300.0 * std::pow(20000.0 / 300.0, u) : 20.0 * std::pow(300.0 / 20.0, u);
                 }), hoch ? SPITZE_GRENZE : SPITZE_TIEF_ZUFALL);
        }
      }
      // (E3c) the harder random plan of the second review (r2): a new target after 1..3 BLOCKS of n samples (so the update rate rises as n falls: 1.5 kHz
      // at n = 32), 560 blocks, settling 640 ms. Both crossovers, 6 seeds.
      for (const char* feld : {"mb/grenze_tief", "mb/grenze_hoch"}) {
        for (unsigned seed = 1; seed <= 6; ++seed) {
          std::mt19937 rng(seed);
          const bool hoch = feld[strlen("mb/grenze_")] == 'h';
          long naechst = 0;
          char t[100];
          std::snprintf(t, sizeof t, "E3c random per block %s seed %u", feld, seed);
          pruefe(t, n, K, lauf(K, feld, hoch ? 2000 : 200, hoch ? 700 : 80, n, 560L * n, [&](long s) {
                   const long blk = s / n;
                   if (blk < naechst) return -1.0;
                   naechst = blk + 1 + static_cast<long>(rng() % 3);
                   const double u = static_cast<double>(rng() % 100000) / 100000.0;
                   return hoch ? 300.0 * std::pow(20000.0 / 300.0, u) : 20.0 * std::pow(300.0 / 20.0, u);
                 }, 30720), hoch ? SPITZE_GRENZE : SPITZE_TIEF_ZUFALL_BLOCK);
        }
      }
      // (E4) continuous turning: the lag of the active crossover for every block size; an update every 32 .. 1024 samples (never below the block size)
      for (const int alle : {32, 64, 128, 256, 512, 1024}) {
        if (alle < n) continue;
        double g = 480.0;
        const Erg o = lauf(K, "mb/grenze_hoch", 480, 300, n, 96000, [&](long s) { if (s % alle) return -1.0; g = std::fmin(20000.0, g * 1.01); return g; });
        double h = 100.0;
        const Erg u = lauf(K, "mb/grenze_tief", 100, 60, n, 96000, [&](long s) { if (s % alle) return -1.0; h = std::fmax(20.0, h * 0.99); return h; });
        const double lag_oben_grenze = alle >= 128 ? LAG_OBEN_MS : LAG_OBEN_SCHNELL_MS, lag_tief_grenze = alle >= 128 ? LAG_TIEF_MS : LAG_TIEF_SCHNELL_MS;
        std::printf("E4 %s n=%3d update every %4d samples: lag hoch %.2f ms (limit %.2f), lag tief %.2f ms (limit %.2f); peak hoch %.5f tief %.5f\n", kname(K), n, alle,
                    o.lag_ms, lag_oben_grenze, u.lag_ms, lag_tief_grenze, o.spitze, u.spitze);
        PRUEF(o.lag_ms <= lag_oben_grenze);
        PRUEF(u.lag_ms <= lag_tief_grenze);
        PRUEF(o.spitze <= SPITZE_GRENZE);
        PRUEF(u.spitze <= SPITZE_TIEF_DREHEN);
        PRUEF_NAH(o.ende_hz, o.soll, 1e-3 * o.soll);
        PRUEF_NAH(u.ende_hz, u.soll, 1e-3 * u.soll);
      }
    }
  }
  (void)fehler_vorher;
  PRUEF_ENDE();
}
