// 1.15 A4 (M5): a crossover change while audio runs: no sample step above 0.05 of the peak (REPORT-multiband.md open point 1).
// The library switches the filter coefficients at once and keeps the states, so moving mb/grenze_* under a running signal stepped and
// overshot (peak 1.47 from a 0.5 sine; measured 2026-11-03). The Mixer therefore crossfades two objects (480 samples, S-curve), see
// docs/architecture/stand/mix-werkzeuge.md, A4 fix. Besides the step limit this test pins: no peak above the twin's (the same run without the
// change), the dynamics are carried over (no level jump from a reduction settling in again), and the newest target of a ramp is reached.
// Two ways per case: "ramp" = as the Stellwerk delivers a jump of the row (a 10 ms course, so the Mixer sees the middle and then the target),
// "jump" = the slot set at once. Both on bus/1 and bus/4.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "mixer_wz_run.h"

using namespace wzt;

namespace {
constexpr double DYN_GRENZE = 0.3;        // dB outside the corridor of the two twins; measured 0.213 / 0.205 (DYN2 / DYN), limit = 1.4x
constexpr double DYN_NACH_GRENZE = 0.1;   // dB after the crossfade; measured 0.042 / 0.003, limit = 2.4x (a partly kept reduction of 0.35 dB would be 3.5x over)
constexpr double LAG_GRENZE_MS = 50.0;   // measured 37 ms (7 blocks), see Z7
// Lower crossover down to 20 Hz, Z7. CONTROLLER RELEASE (2026-11-03): 130 -> 150 ms. It follows from the rule that a big step is only kept pending (fix round 2); measured
// 117 ms with the rule of fix round 1, 144 ms (27 blocks, update in every block) now. All block sizes: test_mixer_multiband_einlauf (limits 168.9 / 181 ms).
constexpr double LAG_TIEF_MS = 150.0;
}  // namespace

int main() {
  for (const int K : {BUS1, 17}) {
    std::printf("-- bus %s\n", kname(K));
    for (const bool rampe : {true, false}) {
      // field, {target, sine Hz}, start value (0 = the default: tief 200, hoch 2000). The deep cases (target 20..45 Hz) need the longer warm-up.
      struct Fall {
        const char* feld;
        std::pair<float, double> ziel;
        float start;
      };
      for (const Fall& wechsel : std::vector<Fall>{{"mb/grenze_tief", {400.0f, 300.0}, 0.0f}, {"mb/grenze_tief", {100.0f, 150.0}, 0.0f},
                                                    {"mb/grenze_hoch", {400.0f, 250.0}, 0.0f}, {"mb/grenze_hoch", {300.0f, 250.0}, 0.0f},
                                                    {"mb/grenze_tief", {20.0f, 60.0}, 0.0f}, {"mb/grenze_tief", {30.0f, 60.0}, 0.0f},
                                                    {"mb/grenze_tief", {45.0f, 60.0}, 0.0f}, {"mb/grenze_tief", {25.0f, 60.0}, 60.0f}}) {
        Lauf l, zwilling;   // the twin: the same run without the change
        l.setze(K, "mb/an", 1.0f);
        zwilling.setze(K, "mb/an", 1.0f);
        std::vector<float> v, vz;
        const int WB = 80;
        const int zeile = l.r((std::string(kname(K)) + "/" + wechsel.feld).c_str());
        const bool tief = wechsel.feld[strlen("mb/grenze_")] == 't';
        const float alt = wechsel.start > 0.0f ? wechsel.start : (tief ? 200.0f : 2000.0f), neu = wechsel.ziel.first;
        if (wechsel.start > 0.0f)
          for (Lauf* x : {&l, &zwilling}) x->setze(K, wechsel.feld, alt);
        std::vector<float> kurve(N);
        unsigned blenden0 = 0;
        for (int blk = 0; blk < WB + 40; ++blk) {
          if (blk == WB) blenden0 = l.m->mb_blenden(K);
          if (blk >= WB && blk < WB + 2 && rampe) {
            for (int i = 0; i < N; ++i) {
              const int t = (blk - WB) * N + i + 1;
              kurve[static_cast<size_t>(i)] = t >= 480 ? neu : alt + (neu - alt) * static_cast<float>(t) / 480.0f;
            }
            l.m->verlauf(zeile, kurve.data());
          }
          if (blk == WB && !rampe) l.setze(K, wechsel.feld, neu);
          if (blk == WB + 2 && rampe) l.setze(K, wechsel.feld, neu);   // the slot holds the target from here on
          for (Lauf* x : {&l, &zwilling}) {
            x->sinus(K, wechsel.ziel.second, 0.5, 0.5);
            x->verarbeite();
          }
          v.insert(v.end(), l.m->master_summe_l(), l.m->master_summe_l() + N);
          vz.insert(vz.end(), zwilling.m->master_summe_l(), zwilling.m->master_summe_l() + N);
        }
        double groesster = 0.0, spitze = 0.0, spitze_zw = 0.0;
        for (size_t i = static_cast<size_t>(WB) * N; i < v.size(); ++i) groesster = std::fmax(groesster, std::fabs(v[i] - v[i - 1]));
        for (size_t i = static_cast<size_t>(WB - 20) * N; i < static_cast<size_t>(WB) * N; ++i) spitze = std::fmax(spitze, std::fabs(v[i]));   // before
        for (size_t i = static_cast<size_t>(WB) * N; i < v.size(); ++i) {
          spitze_zw = std::fmax(spitze_zw, std::fabs(vz[i]));
          spitze = std::fmax(spitze, std::fabs(v[i]));
        }
        const unsigned blenden = l.m->mb_blenden(K) - blenden0;
        const double ist = tief ? l.m->mb_grenze_tief_hz(K) : l.m->mb_grenze_hoch_hz(K);
        std::printf("M5 %s %s -> %.0f Hz with a %.0f Hz sine: largest step %.4f of the peak %.3f = %.4f (limit 0.05); twin peak %.3f; %u crossfade(s); active crossover %.0f Hz\n",
                    rampe ? "ramp" : "jump", wechsel.feld, wechsel.ziel.first, wechsel.ziel.second, groesster, spitze, groesster / spitze, spitze_zw,
                    blenden, ist);
        PRUEF(spitze > 0.3);
        PRUEF(groesster / spitze < 0.05);
        PRUEF(spitze <= spitze_zw * 1.02);              // no overshoot beyond the twin's peak
        PRUEF_NAH(ist, neu, 1e-3);                        // the newest target is reached (not lost while a crossfade ran)
        PRUEF(!l.m->mb_grenzblende(K));
        PRUEF(blenden >= 1 && blenden <= (rampe ? 3u : 1u));
      }
    }
    // A newer target that arrives while the crossfade is audible is kept and started after it: tief 200 -> 300, and 5 blocks later (warm-up
    // 960 samples = 4 blocks, so the crossfade is running) -> 400. No crossfade is cut off, the last target is reached, in two crossfades.
    {
      Lauf l, zwilling;
      l.setze(K, "mb/an", 1.0f);
      zwilling.setze(K, "mb/an", 1.0f);
      std::vector<float> v, vz;
      const int WB = 80;
      bool lief_mitten = false;
      for (int blk = 0; blk < WB + 60; ++blk) {
        if (blk == WB) l.setze(K, "mb/grenze_tief", 300.0f);
        if (blk == WB + 5) l.setze(K, "mb/grenze_tief", 400.0f);
        if (blk == WB + 5) lief_mitten = l.m->mb_grenzblende(K);
        for (Lauf* x : {&l, &zwilling}) {
          x->sinus(K, 300.0, 0.5, 0.5);
          x->verarbeite();
        }
        v.insert(v.end(), l.m->master_summe_l(), l.m->master_summe_l() + N);
        vz.insert(vz.end(), zwilling.m->master_summe_l(), zwilling.m->master_summe_l() + N);
      }
      double groesster = 0.0, spitze = 0.0, spitze_zw = 0.0;
      for (size_t i = static_cast<size_t>(WB) * N; i < v.size(); ++i) {
        groesster = std::fmax(groesster, std::fabs(v[i] - v[i - 1]));
        spitze = std::fmax(spitze, std::fabs(v[i]));
        spitze_zw = std::fmax(spitze_zw, std::fabs(vz[i]));
      }
      std::printf("VORM: tief 200 -> 300, 5 blocks later -> 400: crossfades %u, active crossover %.0f Hz, largest step %.4f of the peak, peak %.3f (twin %.3f)\n",
                  l.m->mb_blenden(K), l.m->mb_grenze_tief_hz(K), groesster / spitze, spitze, spitze_zw);
      PRUEF(lief_mitten);                                   // the second target really arrived during a crossfade
      PRUEF(l.m->mb_blenden(K) == 2);
      PRUEF_NAH(l.m->mb_grenze_tief_hz(K), 400.0, 1e-3);   // the last target is reached
      PRUEF(groesster / spitze < 0.05);
      PRUEF(spitze <= spitze_zw * 1.02);
    }
    // The dynamics are carried over. Two scenarios, each run twice: with the crossover change and as the twin without it (the same signal, the
    // same settings). The bound is on the per-block level difference between the two runs, so the natural drift of the release (0.9 dB in
    // DYN2 within the 30 blocks) is not part of it and a partly copied state cannot hide in it.
    //  DYN : a deep reduction (ratio 20, release 5 s), a sine that stays in the mid band, a change of the upper crossover.
    //  DYN2: the same with a loud burst and then a signal far under the threshold, so the slow release alone holds the reduction (25 dB):
    //        a new object without the dynamics would have none and the level would jump up.
    for (const bool gehalten : {false, true}) {
      // wechsel: 0 = the crossover stays at 2000 Hz; 1 = it changes to 1500 Hz at block 100; 2 = it is at 1500 Hz from the start
      auto lauf = [&](int wechsel, std::vector<double>& pegel) {
        Lauf l;
        l.setze(K, "mb/an", 1.0f);
        l.setze(K, "mb/mitte/schwelle", -40.0f);
        l.setze(K, "mb/mitte/ratio", 20.0f);
        l.setze(K, "mb/mitte/attack", 10.0f);
        l.setze(K, "mb/mitte/release", 5000.0f);
        if (wechsel == 2) l.setze(K, "mb/grenze_hoch", 1500.0f);
        for (int blk = 0; blk < 130; ++blk) {
          if (wechsel == 1 && blk == 100) l.setze(K, "mb/grenze_hoch", 1500.0f);
          const double amp = (gehalten && blk >= 60) ? 0.005 : 0.5;
          l.sinus(K, 632.5, amp, amp);
          l.verarbeite();
          pegel.push_back(rms_db(l.m->master_summe_l(), N));
        }
        return l.m->mb_blenden(K);
      };
      std::vector<double> pw, pz, pf;
      const unsigned bw = lauf(1, pw);
      lauf(0, pz);
      lauf(2, pf);
      // The level of the changed run must stay inside the corridor that the two twins span (the one that keeps the old crossover and the one
      // that has the new one from the start): the crossover's own effect on the sine (0.46 dB) is then not part of the measure, and the natural
      // drift of the release (0.9 dB in DYN2) is inside it. What counts is how far the run leaves the corridor: the cost of the handover.
      double aussen = 0.0, drift = 0.0, statisch = 0.0, nach = 0.0;
      for (int blk = 100; blk < 130; ++blk) {
        const size_t i = static_cast<size_t>(blk);
        const double lo = std::fmin(pz[i], pf[i]), hi = std::fmax(pz[i], pf[i]);
        aussen = std::fmax(aussen, std::fmax(pw[i] - hi, lo - pw[i]));
        drift = std::fmax(drift, std::fabs(pz[i] - pz[99]));
        statisch = std::fmax(statisch, std::fabs(pf[i] - pz[i]));
        if (blk >= 112) nach = std::fmax(nach, std::fabs(pw[i] - pf[i]));   // after the crossfade: equal to the twin with the new crossover
      }
      std::printf("%s: level before %.2f dB; the changed run leaves the corridor of the two twins by %.3f dB (limit %.2f), after the crossfade it differs from the "
                  "twin with the new crossover by %.3f dB (limit %.2f); the twin's own drift %.2f dB, the crossover's own effect %.3f dB\n",
                  gehalten ? "DYN2" : "DYN", pz[99], aussen, DYN_GRENZE, nach, DYN_NACH_GRENZE, drift, statisch);
      PRUEF(pz[99] < (gehalten ? -60.0 : -25.0));   // the reduction is deep
      PRUEF(aussen < DYN_GRENZE);
      PRUEF(nach < DYN_NACH_GRENZE);
      PRUEF(bw == 1);
    }
    // (Z7) continuous turning: a crossover moves by 1 % every 1, 2 and 4 blocks (upper one from 480 Hz up to the 20 kHz limit; lower one from 100
    // Hz down to its 20 Hz limit) for 2 s. A new target during the warm-up must not restart it (the crossover would stay at its start value as
    // long as the turning goes on: measured 480 Hz after 2 s with a target of 20 kHz); a small step goes into the second object in place.
    // The active crossover follows with a lag: for every block the target is looked up that the active crossover equals, and the largest age
    // of it is the lag. Limits from the measurement 2026-11-03: upper crossover 7 blocks = 37 ms (warm-up 20 ms + crossfade 10 ms + block
    // granularity), set to 50 ms; lower one down to 20 Hz needs the longer warm-up (cap 100 ms) and measured LAG_TIEF_MS, see below.
    struct Drehen {
      const char* feld;
      double start, faktor, ende, sinus_hz, grenze_ms, spitze_max;
    };
    for (const Drehen& d : {Drehen{"mb/grenze_hoch", 480.0, 1.01, 20000.0, 300.0, LAG_GRENZE_MS, 0.5025},
                           Drehen{"mb/grenze_tief", 100.0, 0.99, 20.0, 60.0, LAG_TIEF_MS, 0.5174}})
    for (const int alle : {1, 2, 4}) {
      const bool hoch = d.feld[strlen("mb/grenze_")] == 'h';
      Lauf l;
      l.setze(K, "mb/an", 1.0f);
      l.setze(K, d.feld, static_cast<float>(d.start));
      for (int blk = 0; blk < 120; ++blk) {
        l.sinus(K, d.sinus_hz, 0.5, 0.5);
        l.verarbeite();
      }
      std::vector<double> ziel = {d.start}, aktiv;   // ziel[j]: the target after j updates (j = 0: the start value)
      std::vector<float> v;
      double g = d.start;
      const unsigned b0 = l.m->mb_blenden(K);
      for (int blk = 0; blk < 375; ++blk) {
        if (blk % alle == 0) {
          g = d.faktor > 1.0 ? std::fmin(g * d.faktor, d.ende) : std::fmax(g * d.faktor, d.ende);
          l.setze(K, d.feld, static_cast<float>(g));
        }
        l.sinus(K, d.sinus_hz, 0.5, 0.5);
        l.verarbeite();
        ziel.push_back(g);
        aktiv.push_back(hoch ? l.m->mb_grenze_hoch_hz(K) : l.m->mb_grenze_tief_hz(K));
        v.insert(v.end(), l.m->master_summe_l(), l.m->master_summe_l() + N);
      }
      // lag of block blk: how many blocks ago the target was that the active crossover equals now (the newest such one)
      int lag = 0;
      for (size_t blk = 0; blk < aktiv.size(); ++blk) {
        int alter = -1;
        for (size_t j = blk + 1; j-- > 0;)
          if (std::fabs(ziel[j] - aktiv[blk]) < 1e-3 * aktiv[blk]) {
            alter = static_cast<int>(blk + 1 - j);
            break;
          }
        lag = std::max(lag, alter < 0 ? 100000 : alter);   // no target in the past equals it: older than the whole history
      }
      double groesster = 0.0, spitze = 0.0;
      for (size_t i = 1; i < v.size(); ++i) {
        groesster = std::fmax(groesster, std::fabs(v[i] - v[i - 1]));
        spitze = std::fmax(spitze, std::fabs(v[i]));
      }
      const unsigned blenden = l.m->mb_blenden(K) - b0;
      for (int blk = 0; blk < 60; ++blk) {   // the turning stops: the last target is reached
        l.sinus(K, d.sinus_hz, 0.5, 0.5);
        l.verarbeite();
      }
      const double ende = hoch ? l.m->mb_grenze_hoch_hz(K) : l.m->mb_grenze_tief_hz(K);
      std::printf("Z7 %s %s every %d block(s): largest lag of the active crossover %d blocks (%.0f ms; limit %.0f ms), target %.0f Hz reached at rest: %.0f Hz, %u crossfades, "
                  "largest step %.4f of the peak %.5f\n", kname(K), d.feld, alle, lag, lag * N / 48.0, d.grenze_ms, g, ende, blenden, groesster / spitze, spitze);
      PRUEF(lag * N / 48.0 <= d.grenze_ms);
      PRUEF_NAH(ende, g, 1e-3);
      PRUEF(groesster / spitze < 0.05);
      PRUEF(spitze <= d.spitze_max);   // measured maximum + 0.5 %: upper crossover 0.50001 (limit 0.5025), lower one down to 20 Hz 0.51473 (update in every block; 0.51286, 0.51191 for 2 and 4; limit 0.5174)
    }
  }
  PRUEF_ENDE();
}
