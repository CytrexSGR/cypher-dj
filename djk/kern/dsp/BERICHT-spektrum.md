# Report: spectrum analyser (package 1.15 "Mix tools", part C)

Status 2026-11-02. Library `cypherdj_dsp`, nothing outside `djk/kern/dsp/` touched, not wired into the kernel.

## What was built

`include/cypherdj/dsp/spektrum.h`, `src/spektrum.cpp`:

- `Fft`: own complex in-place radix-2 FFT (decimation in time), sizes 2 ... 4096, one twiddle table for 4096,
  bit-reversal table per size. No external dependency.
- `SpektrumAnalysator`, split over two threads:
  - audio thread: `schreibe(l, r, n)` copies `(l + r) / 2` (or `l` alone with `r == nullptr`) into a lock-free
    single-producer/single-consumer ring of 16384 samples (two `std::atomic<size_t>` indices, acquire/release,
    `is_always_lock_free` asserted). A full ring drops the new samples and counts them (`verlorene_samples()`);
    it never waits. NaN/Inf become 0.
  - analysis thread: `analysiere()` drains the ring and computes one frame per hop: periodic Hann window, FFT,
    power per bin, power per band, smoothing, peak hold. Returns the number of new frames.
- Sizes 1024 / 2048 / 4096, overlap 1 / 2 / 4 / 8 (hop = size / overlap), bands at `1000 Hz * 2^(i/b)` with edges
  at `2^((2i +- 1) / 2b)` between `f_min` and `f_max` (default 1/6 octave, 20 Hz ... 20 kHz = 59 bands, 22.1 Hz ...
  17.96 kHz), up to 256 bands (1/24 octave).
- Level scale: a full-scale sine (amplitude 1) reads 0 dB in its band, independent of size and bin position (power
  of the main lobe summed, divided by the Hann ENBW 1.5). White noise reads its band power relative to a
  full-scale sine. A band narrower than one bin takes the interpolated power density at its centre times its width.
- Smoothing: exponential in power per frame, time constant `glaettung_ms`. Peak hold: `halten_ms`, then
  `fallen_db_pro_s`, never below the level. Floor `kStummDb` (-200 dB).
- All buffers are fixed members (about 250 KB); nothing allocates after construction, on either side.

## Tests (`tests/test_spektrum.cpp`, block "Paket 1.15" at the end of CMakeLists.txt)

| test | checks |
|---|---|
| `test_spektrum` | FFT vs. DFT, band layout, sine levels, leakage, white noise, frames per hop, smoothing, peak hold, ring overflow, two threads |
| `test_spektrum_mutation_ohne_fenster` | mutation build with a rectangular window: the leakage check **must fail** (it does: -35.0 dB instead of < -90 dB) |
| `test_mixwerkzeuge_echtzeit` | 10^5 `schreibe()` calls plus `analysiere()`, size and smoothing switched in between: 0 allocations, 0 frees, 0 locks (with positive control; not in the ASan build) |

Measured numbers (checked against analytic values in the test):

- FFT against a direct DFT, all sizes 2 ... 4096, random complex input: largest error 6.2e-11.
- Bands: 59 bands for 1/6 octave, centres `1000 * 2^((b - 33) / 6)` within 1e-3, edges contiguous (bit-equal);
  1/3 octave at 44.1 kHz: 29 bands, 24.8 Hz ... 16 kHz.
- Sine 1 kHz / 3.21 kHz / 10 kHz, amplitude 1 and 0.5, all three sizes, whenever the band holds the whole main lobe
  (+-2.5 bins): level = 20*log10(A) within 0.0003 dB, and that band is the loudest. Where the band is narrower than
  the main lobe: 1 kHz at size 1024 (2 bins) reads -0.24 dB, at 2048 (5 bins) -0.00 dB. 100 Hz full scale (band
  narrower than a bin): -1.87 dB at 1024, -3.38 dB at 4096 (reported, not checked).
- Leakage: off-bin 1 kHz sine, size 4096, level in the 4 kHz band: -139.7 dB (Hann), -35.0 dB (rectangular mutation).
- White noise (uniform, variance 1/3), expected `10*log10(4/3 * bins / N)`: size 1024 band 1 kHz -26.04 dB
  (expected -25.84), 8 kHz -16.10 (-16.07); size 4096 band 1 kHz -25.03 (-24.87), 8 kHz -15.94 (-15.90).
  Tolerance 0.3 dB (statistics of 30 s noise with 5 s smoothing).
- Frames: 48000 samples give exactly 48000 / hop frames for overlap 1, 2, 4, 8.
- Smoothing 100 ms, hop 512: decay -0.46325 dB per frame (analytic 10*log10(exp(-512 / 4800)) = -0.46325).
- Peak hold 500 ms, hop 512: held 47 frames (round(46.875)), then falls 0.21333 dB per frame (20 dB/s * 512 / 48000).
- Ring: 20000 samples without analysis: 3616 lost (= 20000 - 16384), 32 frames from the ring afterwards.
- Two threads (producer about 40x real time, 128-sample blocks, 10 s): 937 frames, 0 samples lost, level -6.0226 dB
  for a 0.5 sine.
- Cost (Xeon 2.8 GHz, -O3): `schreibe()` about 0.3 ... 0.45 us per 256-sample block (including timer overhead);
  `analysiere()` 18 us per frame at 1024, 30 us at 2048, 87 us at 4096 (59 bands).

The whole suite was also run with `-DCYPHERDJ_DSP_SANITIZE=ON`: all new tests pass under ASan/UBSan (that run found
two buffer overruns in the test code itself, fixed). `regler_gegen_vertrag` fails before and after this work
(contract vs. library, not touched).

## Open points

- Bands narrower than the Hann main lobe (low bands, small sizes) read tones lower (see numbers above); a UI that
  wants bass detail should use 4096. A per-band "max of bin sum and peak bin" variant would read tones better there
  but bend the noise scale; not done.
- The FFT is a plain complex FFT on real input (half of the work is wasted). A real-input FFT (N/2 complex plus
  split) would roughly halve the analysis cost if it ever matters.
- `analysiere()` processes every hop that is in the ring; after a long stall it computes all of them (at most
  16384 / hop frames). It could skip to the newest frames instead.
- Only a mono sum is analysed; an L/R or M/S pair would need two instances (or a channel parameter).
- Thread contract (one producer, one consumer) is documented, not enforced.
- Code comments are English (CLAUDE.md rule), identifiers German; the task text asked for German comments.

## What the later wiring needs

| parameter | type, range | default | where |
|---|---|---|---|
| `groesse` | 1024 / 2048 / 4096 | 2048 | constructor or `setze_groesse` (analysis thread; clears levels) |
| `ueberlappung` | 1 / 2 / 4 / 8 | 4 | constructor or `setze_ueberlappung` (analysis thread; clears) |
| `baender_pro_oktave` | 1 ... 24 | 6 | constructor only |
| `f_min_hz`, `f_max_hz` | Hz, f_max clamped to fs/2 | 20, 20000 | constructor only |
| `glaettung_ms` | 0 ... 10000 (0 = off) | 100 | `setze_glaettung_ms` |
| `halten_ms`, `fallen_db_pro_s` | 0 ... 10000 ms, 0 ... 1000 dB/s | 1000, 20 | `setze_spitze` |

- Audio thread: call `schreibe()` once per block at the tap point (no latency is added to the signal; the analyser
  is a side-chain). Analysis: call `analysiere()` from a non-real-time thread (UI or a 25-60 Hz timer), then read
  `pegel_db()` / `spitze_db()` (`anzahl_baender()` floats each) and `band_mitte_hz(b)` for the axis.
- Display latency: one FFT length (21 ms at 1024, 85 ms at 4096 at 48 kHz) plus the polling interval.
- Construct outside the audio thread (`std::make_unique`, about 250 KB). No OSC addresses, enum numbers or kernel
  registration were added.
