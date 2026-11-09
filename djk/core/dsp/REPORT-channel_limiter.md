# Report: channel limiter (package 1.15 "Mix tools", part C)

Status 2026-11-02. Library `cypherdj_dsp`, nothing outside `djk/core/dsp/` touched, not wired into the kernel.

## What was built

`KanalLimiter` (`include/cypherdj/dsp/channel_limiter.h`, `src/channel_limiter.cpp`): stereo-linked brickwall peak
limiter as a channel insert.

- Lookahead = attack ramp (`vorhalt_ms`), fixed hold of 2 samples on both sides of a peak, one-pole release
  (`abklingen_ms`), ceiling (`decke_db`), optional true-peak detection with 4x oversampling (`echtspitze`).
- Gain computer is the one of `MasterLimiter` (messer/master_limiter.*): needed gain per sample, sliding minimum
  (monotonic queue), release that never rises above the minimum, moving average over `anstieg + 1` values, signal
  delayed so that each output sample gets a gain at or below the needed gain of every input sample within +-2.
- `verarbeite(in_l, in_r, out_l, out_r, n)`, 1 <= n <= kMaxFrames, in place allowed. No allocation, lock,
  throw or I/O; `DenormalSchutz` for the call; NaN/Inf count as 0. Sample rate from the constructor.

### Reuse of the master limiter, and why it is not shared code

`MasterLimiter` was read first and its behaviour and tests are unchanged. Its gain computer is reused as a design
(same five steps, same exact-1 bookkeeping of the moving average), not as code, because:

- it lives in `cypherdj_dsp_messer`, which links libebur128 and builds standalone; `cypherdj_dsp` must not depend
  on it (and the reverse would change the messer build);
- it is fixed to 48 kHz and stereo inside one private function, with no hook to reuse the gain path alone.

Extracting a shared gain-computer header used by both would need a change in `master_limiter.cpp` with a
bit-identity proof against its tests. Left as an open point (below).

The true-peak interpolator is not taken from the master limiter on purpose: its interpolator (a) is the 49-tap
libebur128 one, which droops 0.033 dB at 12 kHz and 1.78 dB at 20 kHz. With it the limiter overshot the ceiling:
measured **-0.9678 dBTP for a -1 dBTP ceiling** (fs/4 sine, first implementation, see the commit history). The master
limiter compensates with a second 8x interpolator; for a channel insert that is too expensive. Used instead: one 4x
Kaiser sinc, 97 taps, beta 6, cut-off fs/2, centre tap on a sample (phase 0 reproduces the input exactly).
Response at 48 kHz: -0.0071 ... +0.0140 dB up to 20 kHz over all four phases (numpy). Delay 12 samples.

## Tests (`tests/test_channel_limiter.cpp`, block "Paket 1.15" at the end of CMakeLists.txt)

| test | checks |
|---|---|
| `test_kanal_limiter` | latency, onset, timing, true peak, block sizes, NaN/Inf, denormals, run-time changes |
| `test_kanal_limiter_mutation_vorhalt` | mutation build without signal delay: the onset check **must fail** (it does) |
| `test_kanal_limiter_mutation_echtspitze` | mutation build with sample peaks only: the true-peak check **must fail** (it does) |
| `test_mixwerkzeuge_echtzeit` | 10^5 calls, block lengths 1 ... 1024, ceiling/release changed in between: 0 allocations, 0 frees, 0 locks (with positive control; not in the ASan build) |

Measured numbers (all checked against analytic values in the test):

- Latency, bit-exact pure delay below the ceiling: 74 samples (48 kHz, 1.5 ms), 86 with true peak, 68 at 44.1 kHz,
  494 at 96 kHz / 5 ms / true peak. Formula `round(vorhalt_ms * fs / 1000) + 2 (+ 12)`.
- 1 kHz sine at +6 dBFS starting after silence, ceiling -1 dB: largest output sample -1.001000 dBFS (ceiling minus
  the 0.001 dB rounding reserve), steady state -1.001000 dBFS, largest reduction -7.0216 dB (analytic -7.0216).
- DC burst, anstieg 48: first reduced input sample = start - 48 - 2, full reduction from start - 2, gain rises again
  at end + 2 (all exact to the sample). Release: (1 - g) falls to 0.367879 after tau = 480 samples (exp(-1)).
- True peak, fs/4 sine with 45 degrees phase (sample peaks -1.5 dBFS, true peak +1.51 dBTP), ceiling -1 dBTP,
  measured as sqrt(2) * RMS: sample-peak mode +1.5103 dBTP (untouched, as expected), true-peak mode -1.0084 dBTP.
  Sweep 1 / 5 / 12.345 / 15 / 17 / 19.5 kHz at +3 dBFS: -1.0109 ... -1.0112 dBTP.
- Bit-identical output for block lengths 1, 3, 17, 64, 256, 999, 1024 and in-place vs. separate buffers.
- 0 subnormal output samples after subnormal input and silence.
- Cost (Xeon 2.8 GHz, -O3, 256-sample stereo block): 3.4 us sample-peak mode (0.06 % of 5.33 ms),
  57 us true-peak mode (1.07 %).

The whole suite was also run with `-DCYPHERDJ_DSP_SANITIZE=ON`: all new tests pass under ASan/UBSan.
`regler_gegen_vertrag` fails before and after this work (contract lists `bk/<n>`, library does not); not touched.

## Open points

- The 4x grid can miss a peak between grid points: up to 20*log10(1 / cos(pi * f / (4 * fs))) = 0.47 dB at 20 kHz,
  0.11 dB at 10 kHz. Steady sines do not show it (the grid phases cover the period), short transients near 20 kHz
  can. The master limiter adds a grid reserve for its 8x grid; here no grid reserve is applied. Decide whether a
  channel insert needs it (would cost up to 0.47 dB of level).
- The interpolator is designed for 48 kHz (the engine rate, INTERFACES 1.1); at 44.1 kHz it droops to -1.33 dB at
  20 kHz.
- Shared gain-computer header for `KanalLimiter` and `MasterLimiter` (see above): needs its own decision.
- Hold is fixed at 2 samples; the master limiter uses 8. Not exposed as a parameter.
- Code comments are English (CLAUDE.md rule), identifiers German; the task text asked for German comments.

## What the later wiring needs

| parameter | type, range | default | real-time changeable |
|---|---|---|---|
| `decke_db` | float, -60 ... 0 dBFS (dBTP with true peak), clamped | -0.3 | yes, `setze_decke_db` |
| `abklingen_ms` | float, 1 ... 2000 ms, clamped | 80 | yes, `setze_abklingen_ms` |
| `vorhalt_ms` | float, 0.1 ... 20 ms, clamped (max 2048 samples) | 1.5 | no: changes the latency, rebuild the object |
| `echtspitze` | bool | false | no: changes the latency (+12), rebuild the object |

- Latency: `latenz_samples()` = `round(vorhalt_ms * fs / 1000) + 2`, plus 12 with true peak; constant for the
  object's lifetime. The kernel has to compensate it on the channel (and the cue) like the master limiter's
  `vorhalt_samples()` (ADR 008 point 3). Upper bound `KanalLimiter::kMaxLatenz` = 2062 samples.
- Metering: `groesste_absenkung_db()` (since the last call, resets; for a gain-reduction meter in the 25 Hz
  /pegel cycle) and `aktuelle_verstaerkung()`.
- Object size about 50 KB; construct outside the audio thread (`std::make_unique`).
- No OSC addresses, enum numbers or kernel registration were added.
