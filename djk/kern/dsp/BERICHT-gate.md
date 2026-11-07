# Package 1.15 "Mix tools", part A: Gate — report

Status 2026-11-02, cloud session, branch `claude/1-15-gate-utility-9kezow`. Work only inside `djk/kern/dsp/`.

## What was built
`include/cypherdj/dsp/gate.h`, `src/gate.cpp`: class `Gate`, a stereo-linked noise gate for a channel insert.

- **Detector:** peak follower on max(|L|, |R|) of the sidechain (or of the input when no sidechain pointer is
  given). It rises instantly and decays with a fixed time constant `kGateDetektorAbfallMs` = 10 ms. Values below
  1e-30 are set to 0, and `DenormalSchutz` (FTZ/DAZ) covers the rest.
- **State with hysteresis and hold:** the gate opens at detector ≥ threshold. It closes when the detector stays
  below threshold − hysteresis for longer than hold.
- **Target gain:** 1 while open. While closed it is the floor (`bereich_db`) for a hard gate (ratio ≥ 100).
  Below that ratio, the closed target is the downward expander curve (level − threshold)·(ratio − 1) dB, never
  below the floor. A floor of −120 dB means fully closed: the gain is exactly 0.
- **Smooth gain:** the gain moves linearly in amplitude. Attack is the time for floor → 1 and release the time
  for 1 → floor. The largest step per sample is therefore (1 − floor) / (attack or release in samples), so the
  gate cannot click by construction.
- `gain()` / `gain_db()` give the gain for a reduction meter, `gain_verlauf()` gives the gain per sample of the last
  call, `offen()` gives the state.

## Tests
`tests/test_gate.cpp`. The main input is DC 0.5 and the sidechain carries the test signal, so out / 0.5 is the gain
curve exactly.

| # | Check | Expected (analytic) | Measured |
|---|---|---|---|
| 1 | largest gain step (attack 1 ms, floor −80 dB) | ≤ (1 − 1e-4)/48 = 0.020832 | 0.020831 |
| 1m | **mutation `CYPHERDJ_DSP_MUTATION_GATE_HART`** (gain jumps to its target, no ramp): the same check must fail | step > 0.5 | 0.999900 (detected; `test_gate_mutation`) |
| 2 | closed gain | −80.000 dB | −80.000 dB |
| 3 | attack: first sample at 0 dB | step + 47 (48 samples) | step + 47 |
| 4 | release start after a step down | detector ⌈480·ln(0.5/10^(−44/20))⌉ − 1 = 2098 + hold 960 = 3058 samples (±1) | 3058 |
| 4 | release length to the floor | 4800 samples (100 ms) ±1 | 4800 |
| 5 | stereo link | L gain == R gain bitwise | equal |
| 6 | hysteresis: sidechain −42 dB (between close −44 and open −40) | closed stays closed, open stays open; at −45 dB it closes | yes |
| 7 | ratio 2 / 4 / 10 at sidechain −50 dB, threshold −40 | −10 / −30 / −80 (floor) dB | −10.0000 / −30.0000 / −80.0000 dB |
| 8 | floor −120 → output exactly 0; floor −30 → −30 dB | | yes |
| 9 | loud input with a silent sidechain stays closed; without a sidechain it opens; sidechain only on R opens L | | yes |
| 10 | random block sizes 1..1024 and block size 1 give output identical to 256-sample blocks | bitwise | equal |
| 11 | NaN keeps the old value; out of range is clamped | | yes |
| 12 | sample rate from the constructor: 1 ms attack at 96 kHz | 96 samples | 96 |

`tests/test_mix_waechter.cpp` (with the utility): 10^5 calls of `verarbeite()`, `setze()` and `leeren()` with
block sizes 1..1024 and changing parameters gave 0 allocations, 0 frees and 0 mutex locks. The watcher's positive
control (a vector allocation) is seen first.

Whole suite: `ctest` 27 of 28. ASan/UBSan (`-DCYPHERDJ_DSP_SANITIZE=ON`): 24 of 25. The one red test in both is
`regler_gegen_vertrag`, which already failed without this package: `INTERFACES.md` lists `bk/<n>` and the
control table in `regler.cpp` does not have it. It is unrelated to gate and utility and lies outside the scope
(`docs/`, existing control table). ASan found one bug in my own test (sidechain shorter than the main input),
which is fixed.

## Cost (rough, g++ -O2, no flock, this container)
256 frames stereo: hard gate about 1.0–1.1 µs. In ratio mode while closed it is about 8–11 µs, because of one
log10 and one exp per sample.

## Open points
- The ratio mode costs about 8× a hard gate. If that matters, the exp/log can be replaced with a table or computed
  once every 16 samples.
- The detector decay of 10 ms is fixed. Below about 25 Hz a sine can drop below the close threshold between peaks;
  hold (default 20 ms) bridges that. Could become a parameter.
- No look-ahead (latency 0), so the first transient passes through the attack ramp. A look-ahead variant would need
  latency compensation in the engine.
- A sidechain filter (HP/LP on the detector, "key filter") is not built in. The caller can filter the sidechain
  buffer before passing it.

## What the later wiring needs
- Object per channel on the heap (has a buffer of kMaxFrames floats); constructor `Gate(double fs)`.
- `setze(GateParameter)` from the audio thread between blocks (real-time safe). It takes effect at the next sample,
  and the gain ramps from where it is.

| Parameter | Range | Default | Unit |
|---|---|---|---|
| `schwelle_db` | −90 … 0 | −40 | dBFS |
| `hysterese_db` | 0 … 24 | 4 | dB (close = threshold − hysteresis) |
| `ratio` | 1 … 100 (100 = hard gate) | 100 | :1 |
| `bereich_db` | −120 … 0 (−120 = fully closed) | −80 | dB |
| `attack_ms` | 0.1 … 500 | 1 | ms, floor → 0 dB |
| `hold_ms` | 0 … 2000 | 20 | ms |
| `release_ms` | 1 … 5000 | 100 | ms, 0 dB → floor |

- `verarbeite(in_l, in_r, out_l, out_r, n, sc_l = nullptr, sc_r = nullptr)`, 1 ≤ n ≤ kMaxFrames, in place allowed.
  For a mono sidechain pass the same pointer twice.
- **Latency: 0 samples.**
- Meter: `gain_db()` (kStummDb when 0), `offen()`.
- `leeren()` on load or transport reset: closed, gain at the floor.
