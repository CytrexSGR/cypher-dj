# Package 1.15 "Mix tools", part A: Utility — report

Status 2026-11-02, cloud session, branch `claude/1-15-gate-utility-9kezow`. Work only inside `djk/kern/dsp/`.

## What was built
`include/cypherdj/dsp/utility.h`, `src/utility.cpp`: class `Utility`, a channel-insert tool. The signal path is:

1. **DC blocker** (optional): a one-pole high-pass y = x − x₁ + R·y₁ with R = exp(−2π·5 Hz/fs). It always runs,
   so switching it on starts without a transient. On/off crossfades dry/filtered.
2. **Bass mono** (optional, 20 … 500 Hz): an LR8 split (the existing `lr8_tiefpass`/`lr8_hochpass`) per channel.
   The lows of both channels are summed to mono and the highs stay per channel. On/off crossfades. A frequency
   change while on recomputes the coefficients and keeps the filter state.
3. **2×2 matrix** = gain · balance · width · swap · phase invert:
   - phase invert works on the input channels, and the swap comes after it
   - width in M/S: l = M + w·S, r = M − w·S with w = width / 100
   - linear balance law: left = min(1, 1 − b), right = min(1, 1 + b)
   - gain ≤ −120 dB means silent (exactly 0)

Every change ramps linearly over `kUtilityRampeMs` = 10 ms (480 samples at 48 kHz): the matrix, the DC crossfade and
the bass-mono crossfade. Phase invert and swap are therefore click-free too. Neutral parameters give the input
bitwise, also after a round trip through other settings. `leeren()` empties the filters and puts every ramp at its
target, which also serves as "apply now".

## Tests
`tests/test_utility.cpp`

| # | Check | Expected (analytic) | Measured |
|---|---|---|---|
| 1 | phase invert L on DC 0.5: largest step | ≤ 1/480 = 0.002083 | 0.002083 |
| 1 | ramp timing | 0 at sample 239, exactly −0.5 at sample 479, not before | yes |
| 1m | **mutation `CYPHERDJ_DSP_MUTATION_UTILITY_HART`** (matrix without a ramp): the same check must fail | step > 0.5 | 1.000000 (detected; `test_utility_mutation`) |
| 2 | neutral, and neutral again after other settings | bitwise identical (noise, random blocks) | yes |
| 3 | DC L 0.3 / R 0.1: width 0 / 50 / 200 % | (0.2, 0.2) / (0.25, 0.15) / (0.4, 0) | exact to 1e-6 |
| 3 | balance +0.5 / −1, gain +6 / silent, phase R, swap, phase L + swap | (0.15, 0.1) / (0.3, 0) / ×1.99526 / (0, 0) / (0.3, −0.1) / (0.1, 0.3) / (0.1, −0.3) | exact to 1e-6; silent bitwise 0 |
| 4 | 1 kHz sine: gain −12 dB; balance +0.5 left; width 200 % with L only | −12.000; −6.0206; L +3.5218 / R −6.0206 dB | −12.0000; −6.0206; 3.5218 / −6.0206 dB |
| 5 | bass mono 120 Hz, side signal (L = −R): level = \|HP_LR8\| = r⁸/(1+r⁸) (prewarped r) | 30 Hz −96.3311, 60 Hz −48.1997, 120 Hz −6.0206, 1 kHz −0.0000 dB | the same to 4 decimals |
| 5 | bass mono, mid signal (L = R): LP + HP = all-pass | 0 dB | 0.00000 dB at all four frequencies |
| 6 | DC blocker: DC residual after 2 s | < 1e-6 | 0 |
| 6 | DC blocker \|H\| = \|1 − e^{−jω}\| / \|1 − R e^{−jω}\| at 5 / 20 / 1000 Hz | −3.0075 / −0.2604 / +0.0027 dB | −3.0075 / −0.2604 / +0.0027 dB |
| 7 | switching on the DC blocker (DC 0.5): largest step | ≤ 0.5/480 + 1e-4 | 0.001041 |
| 7 | switching on bass mono 200 Hz (50 Hz sine, L only): largest step | ≤ 1.5 × the dry sine's largest step 0.003272 | 0.003272 |
| 8 | random block sizes vs 256 blocks; latency: impulse at gain +6 dB, width 0 | bitwise; output at sample 0, then 0 | yes |
| 9 | 1 s noise then 30 s silence with DC blocker and bass mono: subnormal outputs | 0 | 0 |
| 10 | NaN keeps the old value, clamping (width 500 → 200, balance −3 → −1, bass mono 5 Hz → 20 Hz) | | yes |

The real-time check in `test_mix_waechter` (together with the gate): 0 allocations, 0 frees and 0 locks in 10^5
calls. Whole suite and ASan/UBSan results: see `BERICHT-gate.md` (the only red test there, `regler_gegen_vertrag`,
already failed before and is unrelated).

## Cost (rough, g++ -O2, no flock, this container)
256 frames stereo: about 1.3–1.9 µs with neutral settings (the DC blocker always runs). About 11 µs with
everything on, which is mostly the 16 biquads of bass mono.

## Open points
- The DC blocker has a slight gain above 1 at high frequencies (+0.0027 dB at 1 kHz, +0.006 dB at Nyquist), as any
  one-pole blocker does. It is only active when switched on.
- Bass mono is an LR8 split, so it adds all-pass phase shift around the cutoff while on (magnitude flat). A
  linear-phase version would need latency.
- A cutoff change while on switches coefficients at once. Small and medium jumps are inaudible in the tests above.
  For automation sweeps the engine should send the frequency in small steps (for example once per block).
- Balance uses the linear law (center 0 dB, each side down to −∞). If a constant-power pan for mono sources is
  wanted, that is a separate mode (decision for the wiring).

## What the later wiring needs
- Object per channel; constructor `Utility(double fs)`. `setze(UtilityParameter)` is real-time safe and every
  change ramps over 10 ms.

| Parameter | Range | Default | Unit |
|---|---|---|---|
| `gain_db` | −120 (= silent, stored as −200) … +24 | 0 | dB |
| `balance` | −1 … +1 | 0 | linear law |
| `breite_prozent` | 0 … 200 | 100 | % (0 = mono) |
| `bass_mono_hz` | 0 = off, 20 … 500 | 0 | Hz |
| `phase_umkehren_l`, `phase_umkehren_r` | bool | false | |
| `seiten_tauschen` | bool | false | after phase invert |
| `dc_sperre` | bool | false | 5 Hz one-pole |

- `verarbeite(in_l, in_r, out_l, out_r, n)`, 1 ≤ n ≤ kMaxFrames, in place allowed.
- **Latency: 0 samples.**
- `leeren()` on load: empty filters, parameters applied at once. `faehrt()` says whether a ramp is running.
