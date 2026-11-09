# Report: multiband compressor (package 1.15 "Mix tools", part B)

Status 2026-11-02. Library `cypherdj_dsp` only; nothing outside `djk/core/dsp/` was touched, nothing is wired
into the engine yet.

## What was built

- `include/cypherdj/dsp/multiband.h`, `src/multiband.cpp`: class `MultibandKompressor` (3 bands, stereo) and
  the per-band detector `MbDetektor`, settings in `MbBandEinstellung`, bands addressed with the existing enum
  `Band` (`tief`, `mitte`, `hoch`) from `isolator.h`.
- **Crossovers**: Linkwitz-Riley 8th order (`Lr8`, `lr8_tiefpass` / `lr8_hochpass` from `biquad.h`). Split first
  at the upper crossover, the low/mid part then at the lower one. The high band runs through the allpass of
  the lower crossover, `AP_tief = LP_tief + HP_tief = D(-s)/D(s)` (two second-order allpass sections with the
  Butterworth Qs 1.3066 and 0.5412, prewarped like the filters). With all bands neutral the output is
  `AP_hoch * AP_tief`: magnitude exactly 1, only phase. (The isolator does not need this because its crossovers
  are fixed 246/2484 Hz and it uses a high pass there; for free crossovers the allpass is required, see the
  mutation result below.)
- **Detection**: per band `max(|L|, |R|)` of the band signal (sample peak, stereo-linked: both channels get the
  same gain). Static curve in dB with soft knee (Giannoulis, Massberg, Reiss 2012, eq. 4). Smoothing with their
  smooth decoupled peak detector in the dB domain: release-only peak hold, then a one-pole attack. A first
  version with a branching one-pole (attack when the target falls, release otherwise) made the attack on tonal
  signals almost twice as slow (444 instead of 240 samples on a 6 kHz burst) because between the sine peaks the
  release branch was active; it was replaced before the implementation commit.
- **Per band**: threshold, ratio, attack, release, knee, makeup, solo, bypass. Band gain is
  `trocken + nass * 10^(GR/20)`; bypass `(1, 0)`, active `(0, makeup)`, muted by another band's solo `(0, 0)`.
  Both parts move along a linear ramp of 5 ms (240 samples at 48 kHz) on every change, so solo/bypass/makeup
  do not click. Threshold, ratio and knee changes are smoothed by the detector itself.
- **Metering**: `aktuelle_absenkung_db(b)` (last sample) and `groesste_absenkung_db(b)` (largest since the last
  call, resets), dB <= 0, a bypassed band reads 0.
- **Real time**: `verarbeite()` allocates nothing, locks nothing, throws nothing, no I/O; block length
  1..`kMaxFrames`; `DenormalSchutz` (FTZ/DAZ) around the loop, exponential tails of the detector end in an exact
  0; non-finite input samples count as 0. `setze_band()` and `setze_grenzen()` are real-time safe too
  (`setze_grenzen` replaces coefficients only, states stay).

## Tests (all registered in the block `# --- Paket 1.15: Multiband-Kompressor (multiband.h) ---`)

| Test | What it checks |
|---|---|
| `test_multiband` | 9 groups: flatness, band split, static curve, timing, stereo link, makeup/bypass, solo ramp, block sizes, readout/robustness/clamping. Also compiles `multiband.h` alone. |
| `test_multiband_mutation_allpass` | Mutation build without the allpass in the high band; the flatness check MUST be red (it is: 0.316 dB at 200/2000 Hz, 15.97 dB at 500/800 Hz). |
| `test_multiband_mutation_kopplung` | Mutation build with per-channel detection; the stereo-link check MUST be red (it is: R gets 0 dB instead of -17.97 dB). |
| `test_multiband_echtzeit` | 200 000 `verarbeite()` calls, block lengths 1..1024, `setze_band`/`setze_grenzen`/readouts in between: 0 allocations, 0 frees, 0 locks (positive control: the watcher sees a vector allocation). Not built with ASan. |

TDD order: commit `def33bc` added interface, tests and a stub (test red), commit `c6b2a97` the implementation.

## Measured numbers (48 kHz)

- Neutral sum, max |dB| 20 Hz..20 kHz, 400 log points: **0.000000** (< 1e-6) for crossovers 200/2000, 80/5000,
  500/800 and after `setze_grenzen(300, 3000)`; also with all bands bypassed under T -40 dB, R 10, makeup +12.
  Acceptance was 0.1 dB, the test also demands 0.001 dB.
- Band split (each band soloed) against analytic `|LP| = 1/(1+W^8)`, `|HP| = W^8/(1+W^8)`,
  `W = tan(pi f/fs)/tan(pi fc/fs)` at 30, 100, 200, 632.5, 2000, 6000, 15000 Hz: within 0.01 dB; at each
  crossover -6.0206 dB.
- Static curve with DC 0.5 (-6.0206 dBFS) in the low band, measured vs analytic GR:
  below knee 0.00000 / 0; at threshold (W 12, R 4) -1.12501 / -1.12500; inside knee -2.53127 / -2.53125;
  above knee -7.50002 / -7.50000; T -20 hard knee -10.48456 / -10.48455; R 2 -5.00001 / -5.00000; output levels
  likewise within 0.00002 dB, makeup adds exactly.
- Timing: attack 10 ms reaches 1 - 1/e at sample **480** (analytic 480); release 100 ms with attack 10 ms
  follows the closed form of the two-pole cascade within 3e-14 dB, 1/e at sample **5306** (rule of thumb
  release + attack = 5280). Whole chain, 6 kHz burst, attack 5 ms: 63.2 % at sample 215 (analytic 240; the band
  filter onset overshoots by 1.1 dB at sample 12), final GR -10.2245 dB vs -10.2246 from the measured sample peak.
- Stereo link: L 0.5 / R 0.05, mid band T -30, R 4: both channels -17.969 dB (analytic -17.985; difference from
  release droop between peaks and the sample peak of 632.5 Hz).
- Makeup +6 dB at 632.5 Hz: 5.9991 dB; bypassed: 0.0000 dB.
- Solo ramp: output follows `0.5 (1 - k/240)` within 1.4e-8.
- Blocks of 1, 7, 333, 1024 are bit-identical to blocks of 256.
- Group delay with neutral bands (200/2000 Hz): 30 Hz 4.61 ms, 100 Hz 5.16 ms, 200 Hz 6.30 ms, 632 Hz 0.87 ms,
  2 kHz 0.64 ms, 6 kHz 0.06 ms, 15 kHz 0.01 ms.
- Cost (scratch benchmark, -O2, this cloud container, not under flock): 44.5 us per 256-frame stereo block with
  all three bands compressing, 0.83 % of the 5.33 ms block period.
- Whole suite normal and with `-DCYPHERDJ_DSP_SANITIZE=ON`: all green except `regler_gegen_vertrag`, which
  already failed on the untouched snapshot (`bk/<n>` is in the contract INTERFACES.md but not in the
  library; unrelated to this package).

## What the later wiring needs

- Construction outside the callback, on the heap: `MultibandKompressor(fs, grenze_tief_hz, grenze_hoch_hz)`,
  defaults 48000 / 200 / 2000 Hz.
- Call: `verarbeite(in_l, in_r, out_l, out_r, n)`, 1 <= n <= 1024, in place allowed.
- **Latency: 0 samples** (no lookahead, no delay compensation needed). Phase: allpass-type group delay as above.
- Parameters per band (`setze_band(Band, MbBandEinstellung)`, clamped, NaN keeps the old value):

  | Field | Range | Default |
  |---|---|---|
  | `schwelle_db` | -60 .. 0 dBFS | 0 |
  | `verhaeltnis` | 1 .. 20 | 1 (neutral) |
  | `anstieg_ms` | 0.1 .. 500 | 10 |
  | `abklingen_ms` | 1 .. 5000 | 100 |
  | `knie_db` | 0 .. 24 | 0 |
  | `aufholen_db` | -24 .. +24 | 0 |
  | `aufholen_auto` | bool | true (added by the mb-ausgleich fix: automatic make-up, `aufholen_db` is then a trim) |
  | `solo`, `umgehen` | bool | false |

- Crossovers: `setze_grenzen(tief, hoch)`, each clamped to 20 Hz .. 0.45 fs, `hoch >= tief`.
- Metering: read `aktuelle_absenkung_db` / `groesste_absenkung_db` per band in the audio thread after
  `verarbeite()` and publish them with the engine's usual meter path (the values are plain members, not atomics).
- No OSC addresses, no enum numbers, no kernel registration were added; that belongs to the wiring package.

## Open points

1. Crossover changes switch coefficients instantly; sweeping them while audio runs can produce small artefacts
   (the states stay, no ramp). If a crossover becomes a live control, ramp it or crossfade two filter sets.
2. Detection is sample peak. It can lie up to `-20 log10(cos(pi f/fs))` below the true peak for high band
   content (0.69 dB at 6 kHz). True-peak or RMS detection could be added as an option.
3. No sidechain input, no lookahead, no auto makeup; not requested.
4. The parameter ranges above are my proposal; the product decision (and the OSC contract) is still open.
5. Branch: the session was bound to `claude/multiband-compressor-dsp-265mgk`; the task named
   `cloud/1.15-multiband`. The work was pushed to the session branch.
