# Baukasten: granular engine (type 36)

STATUS: built and verified on branch `claude/granular-engine-type-38-53snql` (2026-11-02). Not merged, nothing
installed, not heard. All numbers are measurements on synthetic signals in a cloud container.

## Why

Pads, textures and drones built from clouds of short grains. The Baukasten had no way to make them: the delay lines
cannot window, and the sampler plays files. The new block `granular` works on generated sources only (no sample
files): the tables of the wavetable oscillator, a ring buffer recorded from an audio input of the graph, or noise.

## What was built

| file | change |
|---|---|
| `src/granular.rs` (new) | sources (`Material`), grain pool per voice (`Stimme`), window, unit tests |
| `src/uebersetzen.rs` | `ARTEN` entry `granular` (appended), value checks, build arm |
| `src/programm.rs` | step `Schritt::Granular` (source and voices boxed), run arm, reset arm |
| `src/lib.rs` | `pub mod granular` |
| `demos/granular-pad.json`, `granular-textur.json`, `granular-drone.json` (new) | examples |
| `tests/granular.rs` (new) | 16 tests: io, value checks, grain count, pitch, clicks, position, freeze, determinism, reset, robustness |
| `tests/arten.rs` | minimal graph for `granular` (reset == fresh), type 36 pinned (merge order) |
| `tests/keine_allokation.rs` | `GRANULAR_1` (full pool, every parameter and the freeze on knobs) and the three examples |
| `tests/kosten_messung.rs` | the examples in the cost run, new `kosten_granular` |
| `mutation_granular.py` (new) | the mutation runs of this report |

No existing module was changed in behaviour. `wavetable.rs` is used read-only through its public API (`Tabelle::neu`,
`stufe`, `lese`, `frames`). The plugin crate `baukasten` needed no change: it loads any graph, and the block uses no
file.

**Type number.** The task assigns type 38. The types 33 to 37 come from parallel slices that are not on this branch, so
here `granular` is entry 33, the last one. `ARTEN` is only ever appended to, so after the merge of those slices (in
order) it is entry 38. The tests accept exactly these two states: "last entry while `ARTEN` has fewer than 39 entries",
or "entry 38". Anything else is red (`granular_ist_art_38_mit_ein_und_ausgaengen`, `arten_nur_angehaengt_granular`).
**Merge note:** this slice must be merged after the slices for 33 to 37, and the length in `pub const ARTEN: [ArtDef; N]`
must be set to the sum. The added lines in the shared files sit directly after the wavetable entries, so a textual
conflict with the other slices is likely, but it is trivial: keep all blocks, in type order.

## Design

**Sources (`quelle`).**

| `quelle` | name | what a grain reads | pitch of a grain |
|---|---|---|---|
| 0 | wavetable | one frame position of table `tabelle` (0..6, the seven tables of type 32), from a random start phase, at the mip level its own frequency needs (as alias free as the oscillator) | `hz * 2^(tonhoehe/12 + jitter)` |
| 1 | puffer | a ring buffer of `puffer` seconds that records input `x`, summed over the voices like a sum point (so `eingang` in voice 0 and per-voice chains both work) | read rate `hz / grund * 2^(...)` |
| 2 | rauschen | the same ring buffer, written by an internal white noise generator (xorshift32 seeded by `saat`, prefilled at load and reset) | read rate as source 1: below 1 darker, above 1 brighter |

The wavetable table or the ring buffer is allocated at translation, only the one the source needs. The ring has a power
of two length (index masking), of which the requested `puffer` seconds are used.

**Grains.** Each voice owns a fixed pool of **`MAX_KOERNER` = 16** grains, an array in the voice; nothing is allocated
while playing. A start clock grows by `dichte / sr` per sample and starts a grain when it reaches its target; the
remainder is carried over, so the count over any time span is exact (`floor((n - 1) * dichte / sr) + 1` starts in n
samples). `streuung` (0..1) sets each next target to `1 + streuung * u` with `u` uniform in -1..1: the mean interval
stays `1 / dichte`. A grain starts only while `gate > 0.5` and `hz > 0`: voices that never played (hz 0) are silent
instead of playing DC bumps from a standing phase. A rising `trig` starts a grain at once, so a note speaks without
waiting for the clock. A start that finds no free slot is **dropped** (`verworfen`). A sounding grain is never cut, so a
full pool cannot click (mutation W3 shows what stealing would do).

At its start a grain fixes:
- length `groesse` ms (1..2000);
- position `pos + pos_zufall * u`, clamped to 0..1. For the wavetable it is the frame morph position. For the buffers,
  0 is the newest sample and 1 the oldest of the `puffer` seconds. A recording buffer that is not full yet spans only
  what was recorded so far, so a long buffer sounds at once and does not play seconds of initial silence;
- pitch `tonhoehe` semitones (-48..48) plus `ton_zufall * u` cent (0..1200);
- pan `breite * u` (0..1), equal power with the centre at gain 1 on both sides (as type 32);
- gain `1 / sqrt(max(1, dichte * groesse))`. Grains with random phases or positions add in power, so a dense cloud
  keeps the level of a single gapless grain stream. This is fixed per grain, so a moving density does not zipper.

Each `u` is drawn from a xorshift32 per voice, seeded by `saat`, the voice number and fixed constants. The four numbers
of a start are drawn before the pool is checked, so the sequence does not depend on the pool state. The same graph
always plays the same.

**Window (`fenster`, 0..1).** A Tukey window. Each edge is a raised cosine of `rand = (0.5 - 0.45 * fenster) * length`
samples, at least 1 ms (or half the grain), and the window is flat between the edges. `fenster` 0 is a Hann window, 1 a
nearly rectangular grain with 5 % edges. The raised cosine comes from a 1025-point table, read with linear
interpolation; it matches the formula within 3e-6 (unit test). The first sample of a grain is exactly 0, the window is
symmetric, and neither value nor slope jumps at the edges.

**Freeze (`frieren` > 0.5).** For the buffer sources the ring buffer stops being written. `frieren` is read from voice 0,
like the parameters of a sum point, because the buffer belongs to the node. The grains go on reading the frozen content,
with all jitters. For the wavetable source each voice holds the position it had when the freeze began, so moving `pos`
does nothing until the freeze is released.

**Buffer seams.** In a live buffer a grain at rate `r` drifts relative to the write head by `(1 - r)` samples per
sample. In a frozen buffer the head stands and the grain moves by `r`. The start offset is clamped so that the grain
stays at least 4 samples (the Hermite taps) inside the buffer for its whole length: it never overtakes the write head
(r > 1) and never falls behind the oldest sample (r < 1, or frozen). Reads use a 4-point Catmull-Rom Hermite (error
2.9e-4 on a 2 kHz sine between samples; linear would be 8.5e-3).

**Real time.** `Stimme::prozess` and `Material::schreibe` do not allocate or lock (`keine_allokation.rs`), and they do
not panic: ring indices are masked, the pool is a fixed array and is searched with `find`. Every input is checked for
being finite (NaN and inf read as a safe value) and clamped. Recorded input is clamped to +-8, and values below 1e-30 are
written as 0. No state decays toward zero, so no subnormals arise.

### Ports and values

| | name | range | default | meaning |
|---|---|---|---|---|
| in | `hz` | > 0 plays | 261.6256 | pitch (wavetable) or rate `hz / grund` (buffers); 0 = no new grains |
| in | `trig` | > 0.5 | 0 | start a grain now |
| in | `gate` | > 0.5 | 1 | new grains while high |
| in | `x` | | 0 | audio recorded by source 1 (summed over the voices) |
| in | `groesse` | 1..2000 ms | 80 | grain length |
| in | `dichte` | 0..1000 /s | 20 | grains per second (0 = none) |
| in | `pos` | 0..1 | 0 | position (frame, or newest .. oldest) |
| in | `pos_zufall` | 0..1 | 0 | position jitter, +- |
| in | `tonhoehe` | -48..48 st | 0 | pitch of the grains |
| in | `ton_zufall` | 0..1200 cent | 0 | pitch jitter, +- |
| in | `breite` | 0..1 | 0 | stereo spread of the grains |
| in | `fenster` | 0..1 | 0 | window shape, Hann .. 5 % edges |
| in | `frieren` | > 0.5 | 0 | freeze |
| value | `quelle` | integer 0..2 | 0 | source |
| value | `tabelle` | integer 0..6 | 0 | table of source 0 |
| value | `puffer` | 0.05..10 s | 2 | ring buffer length of sources 1 and 2 |
| value | `grund` | 20..2000 Hz | 261.6256 | `hz` that reads the buffer at rate 1 |
| value | `streuung` | 0..1 | 0 | spread of the start interval |
| value | `saat` | integer 0..65535 | 0 | seed |
| out | `l`, `r` | | | stereo |

The inputs also take a fixed value of the same name, as for every block. Fixed values outside their range are a
`Fehler::Wert`; at run time the inputs are clamped. An edge into `x` with source 0 or 2 is accepted and ignored (open
point 6).

### Examples (knob convention: every knob named, fed and audible; midpoint 0.5 is the default sound)

| graph | voices | source | knobs |
|---|---|---|---|
| `granular-pad` | 8 | wavetable `vokale`, Hann-ish (`fenster` 0.2), slow LFO on the vowel position | 1 Position, 2 Grain size (20..400 ms log), 3 Density (5..160 /s log), 4 Pitch jitter (0..40 c), 5 Width, 6 Attack, 7 Release |
| `granular-textur` | 8 | noise, read at the note's rate, full position jitter, 200 c pitch jitter, spread starts, then a band-pass per side at the note | 1 Grain size (2..80 ms log), 2 Density (20..800 /s log), 3 Pitch (-24..+24 st), 4 Resonance, 5 Width, 6 Attack, 7 Release |
| `granular-drone` | 2 | recording buffer (4 s) of root + fifth saws, played at rate 1, wide, spread starts, then a low-pass | 1 Position, 2 Density (4..60 /s log), 3 Pitch (-12..+12 st), 4 Freeze (above 0.5), 5 Tone (300..8000 Hz log), 6 Grain size (60..800 ms log) |

Lint probe (`beispiele_konvention.rs`, default knobs): pad `peak 0.751 (-2.5 dB), rms -19.1 dB, dc -130.1 dBFS`;
textur `peak 0.424 (-7.5 dB), rms -23.3 dB, dc -108.8 dBFS`; drone `peak 0.772 (-2.2 dB), rms -18.0 dB, dc
-94.6 dBFS`. The drone first failed the lint at peak 1.50, and its trim went from 0.35 to 0.18; the texture trim went
from 0.5 to 1.0 (it was at -29 dB rms). Sweep: all 20 knobs change the sound on the probe; the smallest is textur knob 7
Release, `max |0 - 1| 0.278`.

The drone first sounded only after 1.8 s: its position knob pointed 1.8 s back into a 4 s buffer that was still
empty. `reverb_ffi/tests/bk_zuruecksetzen_alle.rs` caught it (its positive control "the graph sounds" over 0.53 s). The
engine now scales the position to the recorded part until the buffer is full (test `position_vor_dem_fuellen`,
mutation F4). The drone's Freeze knob at 1 freezes from the load on, so the probe plays an empty
buffer: that is what the knob means, and it is audible as silence.

## How it was proven

All tests go through the public JSON API (`uebersetze`, `Programm`), except the unit tests in `src/granular.rs`.

### Grain count matches density

- Unit (`kornzahl_folgt_der_dichte`), one voice for 3 s: 20/s at 80 ms (48 kHz) 60 of 60; 1000/s at 5 ms (44.1 kHz)
  3000 of 3000; 7.3/s at 1000 ms (overlap 7.3) 22 of 22; 333/s at 30 ms (96 kHz) 999 of 999; 0.5/s 2 of 2. Nothing is
  dropped while the overlap stays below the pool; the peak of sounding grains is at most `ceil(overlap) + 1`.
- Full pool (`voller_pool_verwirft_und_bleibt_begrenzt`): 400/s at 100 ms (overlap 40) for 2 s: 800 starts =
  320 grains + 480 dropped, never more than 16 sounding.
- Spread (`kornzahl_mit_streuung_im_mittel`, streuung 0.8, 50/s, 20 s): 978 of 1000 (bound +-5 %).
- Graph level (`kornzahl_folgt_der_dichte`): grains are counted in the output as runs of non-zero samples. At 3, 17,
  41.5 (2 voices) and 75 per second over 3 s the counts are 9, 51, 125 and 225, exactly as expected, and every grain is
  380 to 384 samples (8 ms). With streuung 1 at 30/s over 10 s: 271 (bound 300 +- 30). A second note on the same voice
  starts a grain at once.

### Pitch of a grain in cent

Each grain is cut out of the output, which is exactly 0 between grains, and its frequency is taken from the rising zero
crossings in its middle 80 %.
- **Wavetable** (`tonhoehe_je_korn_auf_hundertstel_cent_wavetable`): sine table at 44.1, 48 and 96 kHz, 55 Hz to
  4186 Hz times -12, 0, +7 and +19 semitones (60 cases, grains of 1 s). Worst grain **0.0034 cent** (12.5 kHz at
  44.1 kHz, 3.5 samples per period, where the zero-crossing estimate itself is coarse); below 1 kHz all are under
  0.0004 cent. Limit 0.01 cent.
- **Buffer** (`tonhoehe_je_korn_auf_hundertstel_cent_puffer`): a 440 Hz sine computed in f64 on the host input, read at
  0, +-12, +7, -24 semitones and at other `hz` (330 Hz, 523.25 Hz +5 st). Worst grain **0.00014 cent**.
- **Jitter** (`tonhoehen_zufall_bleibt_im_bereich_und_streut`), 50 cent around +3 semitones, 159 grains: largest offset
  49.986 cent (bound 50), mean +2.8 cent, standard deviation 28.2 cent (uniform: 28.9).

### No clicks at grain edges

Measure: energy above a cutoff over the total energy, from a Hann-windowed FFT of 2^17 samples, on 110 Hz sine sources.
A jump in value at a grain edge spreads energy over the whole spectrum, falling by 6 dB per octave. A raised cosine edge
of `e` seconds keeps its energy within about 1/e and falls by 18 dB per octave beyond. So the cutoff is 3 kHz, or 12/e
for short edges (at 8/e the edge's own tail is still at -80 dB). Limit **-80 dB**.

| case | cutoff | measured |
|---|---|---|
| Hann, 50 ms, 30/s | 3 kHz | -126.5 dB |
| `fenster` 1 (2.5 ms edges), 50 ms | 4.8 kHz | -98.8 dB |
| short grains, 4 ms, `fenster` 1 (1 ms minimum edges), 150/s | 12 kHz | -91.1 dB |
| full pool, 400/s x 100 ms, width 1, position jitter 1 | 3 kHz | -133.6 dB |
| spread starts, 30 ms, `fenster` 0.5 | 3 kHz | -105.4 dB |
| buffer +12 st at pos 0 and at pos 0.2 (would overtake the write head) | 3 kHz | -133.3 dB |
| buffer -12 st at pos 1 (would fall behind the oldest sample) | 3 kHz | -133.8 dB |
| frozen buffer +12 st, position jitter | 3 kHz | -132.7 dB |

### Position, freeze, determinism, robustness

- **Position** (`position_waehlt_die_stelle_im_puffer`): input +0.5 for 1 s, then -0.5 for 1 s, 2 s buffer. Grains at
  pos 0.75 +- 0.1 are all positive (sum +1697), at 0.25 +- 0.1 all negative. Before the buffer is full
  (`position_vor_dem_fuellen`, 4 s buffer, 0.1 to 0.3 s after the input started) pos 1 plays the recorded sine (power
  1.7e-2), not silence.
- **Freeze, buffer** (`frieren_haelt_den_puffer`): 1 s of sine, then silence on the input. Frozen, the cloud still
  has power 4.7e-2 one to two seconds later; unfrozen it is exactly 0.
- **Freeze, wavetable** (`frieren_haelt_die_wavetable_position`): `analog` table frozen at the sine frame, knob to the
  square. Brightness (difference energy over energy) 8.34e-4, which is that of a pure 220 Hz sine; unfrozen 2.69e-2.
- **Determinism** (`gleiche_saat_gleicher_klang_andere_saat_anderer_klang`): two loads with seed 7 are bit-identical for
  the wavetable and the noise source; seed 8 differs in 23999 of 24000 samples.
- **Reset**: `arten.rs` (recording source) and `zuruecksetzen_gleich_frisch_alle_quellen` (all three sources):
  run, `zuruecksetzen`, play again = a fresh load, bit for bit.
- **Robustness** (`unsinnige_eingaenge_bleiben_endlich`): +-inf, huge values and NaN on all 13 inputs at once, for all
  sources, once with `hz` on the wild edge and once fixed (so grains really read the NaN that was fed to `x`): output
  finite, `rettungen` 0. `ohne_note_still`: a voice that never played is exactly silent.
- **Allocation**: `keine_allokation.rs` with `GRANULAR_1` (4 voices, full pool, seam clamps, freeze, every parameter
  moving on knobs) and the three examples.

### Mutations

Each mutation is applied to a copy of the workspace, the named test is run in release and the change is reverted
(`python3 mutation_granular.py <copy of djk/instruments> [ID ...]`).

**All 28 are red.** Five were green in the first run and showed weak tests, each fixed and run again (below the table).

| id | mutation | test | red output |
|---|---|---|---|
| C1 | start clock drops its remainder (`takt = 0` instead of `-= ziel`) | unit `kornzahl_folgt_der_dichte` | `sr 44100 density 1000` (980 instead of 3000 per 3 s) |
| C2 | density step in ms instead of samples | `kornzahl_folgt_der_dichte` | `density 3` count wrong |
| C3 | start spread 0..1 instead of -1..1 (not mean-preserving) | `kornzahl_mit_streuung_und_trig` | `199 grains, expected 300 +- 30` |
| C4 | `trig` does not start a grain | same | `a new note must start a grain at once: [(1, 240)]` |
| P1 | wavetable phase step truncated to 16 bits | `tonhoehe_je_korn_auf_hundertstel_cent_wavetable` | `pitch error 72.82551 cent, limit 0.01` |
| P2 | buffer rate ignores `grund` | `tonhoehe_je_korn_auf_hundertstel_cent_puffer` | `pitch error 899.99979 cent` |
| P3 | buffer read linear instead of Hermite | unit `hermite_zwischen_den_stuetzstellen` | `interpolation error 0.00848` |
| P4 | pitch jitter 10 times too wide | `tonhoehen_zufall_bleibt_im_bereich_und_streut` | `a grain lies 499.86 cent off, jitter is 50` |
| P5 | `tonhoehe` in tenths of an octave | `tonhoehe_je_korn_auf_hundertstel_cent_wavetable` | `pitch error 380.01027 cent` |
| W1 | rectangular window | `keine_klicks_an_den_kornraendern` | `short grains: -29.9 dB in the high band, limit -80 dB` |
| W2 | window on a 0.08 pedestal (Hamming-like) | same | `short grains: -50.8 dB` |
| W3 | full pool steals the oldest grain instead of dropping | same | `full pool: -28.7 dB` |
| W4 | no seam clamp (grains overtake the write head) | same | `buffer +12 st at pos 0.2: -43.1 dB` |
| W5 | no 1 ms minimum edge | same | `short grains: -64.7 dB` |
| W6 | frozen buffer clamped like a live one | same | `frozen buffer +12 st: -38.7 dB` |
| F1 | position counted from the oldest sample | `position_waehlt_die_stelle_im_puffer` | `pos 0.75: sum -1697.0104, wrong sign 4800` |
| F2 | freeze does not stop recording | `frieren_haelt_den_puffer` | `frozen buffer is silent (0)` |
| F3 | wavetable freeze does not hold the position | `frieren_haelt_die_wavetable_position` | `frozen at the sine, but brightness 0.026867414` |
| D1 | seed from the clock | `gleiche_saat_gleicher_klang_andere_saat_anderer_klang` | `source 0: 23999 samples differ between two loads of the same graph` |
| D2 | seed ignored | same | `another seed must give another cloud` |
| D3 | `zuruecksetzen` leaves the recorded buffer | `arten.rs zuruecksetzen_gleich_frisch` | `Art granular: 9347 Samples weichen nach zuruecksetzen ab` |
| D4 | `zuruecksetzen` leaves the voices | same | `Art granular: 15657 Samples weichen nach zuruecksetzen ab` |
| D5 | `zuruecksetzen` does not reseed the noise | `zuruecksetzen_gleich_frisch_alle_quellen` | `source 2: 23999 samples differ after zuruecksetzen` |
| D6 | `zuruecksetzen` leaves the write head | same | `source 1: 26 samples differ after zuruecksetzen` |
| R1 | non-finite `x` recorded | `unsinnige_eingaenge_bleiben_endlich` | `source 1: the guard had to rescue the graph` |
| R2 | subnormals recorded | unit `rauschen_und_puffer_ohne_subnormale` | `a subnormal was recorded` |
| R3 | grains without a note (hz 0) | `ohne_note_still` | `assertion failed: ... all(... == 0.0)` |
| A1 | one allocation in `Stimme::prozess` | `keine_allokation.rs echtzeitpfad_allokiert_nicht` | `Echtzeitpfad hat Speicher angefordert: granular-1` |

Green in the first run, and what changed:
- **P3** was first run against the pitch test. Interpolation does not move the pitch, so it stayed green, as it should.
  The new unit test checks the read between samples (Hermite 2.9e-4, linear 8.5e-3 on a 2 kHz sine).
- **W4**: at pos 0 the unclamped grain crosses the write head at its 4th sample, where the window is about 1e-5, so the
  test heard nothing. A case at pos 0.2 puts the crossing at the grain's centre.
- **D3** (first written as "skip the whole reset") and **D5**: with the reset skipped, the noise generator's state was
  still 0 from the constructor. Every buffer then held a constant -1, so fresh and reset agreed. The constructor now
  starts the generator from the seed. D3 was split into realistic mutations (buffer not cleared, noise not reseeded,
  head not reset), and a reset test for all three sources was added.
- **R1**: in the robustness graph `hz` and `dichte` also got the NaN, so no grain ever started and nothing read the
  NaN in the buffer. A second variant feeds the wild values to `x` alone, with a positive control that grains sound.
- **R2**: the unit test wrote 1e-35, which is a normal f32 (subnormals start below 1.18e-38). It now writes 1e-39.

## Cost

`cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture --test-threads=1 kosten_granular`.
16 voices, one note per voice, all voices make grains. "Full pool": density 400/s at 100 ms wants 40 grains per voice,
so 16 sound in every voice, 256 grains in all. "Overlap 4": density 40/s at 100 ms. Two runs. Host: 4-core cloud VM,
loadavg 1.0 to 1.5, not at rest and not under the real-time lock. The histogram tops out at 1280 us, so a value of 1280
means "1280 or more"; that is why the 256 rows of the full pool give no p50.

| source, 16 voices | block 64 p50 | block 128 p50 | block 256 p50 | p50 share of the period |
|---|---|---|---|---|
| wavetable (`vokale`), **full pool** | 540 / 525 us | 1050 / 1125 us | >= 1280 | **40 %** |
| puffer, **full pool** | 315 / 305 us | 610 / 635 us | 1240 / 1235 us | **23 %** |
| rauschen, **full pool** | 310 / 300 us | 855 / 615 us | >= 1280 | **23 %** |
| wavetable, overlap 4 | 140 / 165 us | 290 / 300 us | 595 / 590 us | 11 % |
| puffer, overlap 4 | 170 / 95 us | 195 / 180 us | 385 / 365 us | 7 % |
| rauschen, overlap 4 | 90 / 175 us | 190 / 340 us | 420 / 540 us | 7 to 13 % |

Reading: **the full pool at 16 voices costs about 8.3 us per sample with the wavetable source (33 ns per grain and
sample), 4.8 us with the buffer sources (19 ns per grain and sample).** That is 40 % and 23 % of the period at p50; p99
is at or above the histogram top. This is the worst case of the block: 256 grains at once. Typical clouds (overlap 2
to 6) cost 7 to 13 %. The wavetable grain is dearer because every grain reads two frames with a four-tap B-spline.
Examples at 256 (p50): `granular-pad` (8 voices) 290 us, `granular-textur` (8) 295 us, `granular-drone` (2) 185 us,
5.4 %, 5.5 % and 3.5 % of the period.

Memory per node: the voices hold 16 grains of 72 bytes each (about 18 KB for 16 voices). Wavetable source: the table of
type 32 (296 KB to 2.37 MB, see `REPORT-wavetable.md`). Buffer sources: the next power of two above
`puffer * sr` floats (2 s at 48 kHz: 512 KB; 10 s: 2 MB; 10 s at 96 kHz: 4 MB).

## Workspace

WORKSPACE_LINE

## Open

1. **Not heard.** Window shapes, grain gain law, the example sounds and levels are numbers, not ear judgements.
2. **Cost of the full pool** (40 % of the period with the wavetable at 16 voices x 16 grains). Possible cuts: a grain
   reader that caches the frame offsets (needs a new method on `wavetable::Tabelle`, so not done in this slice), a
   recursive raised cosine instead of the table lookup, SIMD over the pool, or a smaller pool per voice when many
   voices sound. A rest measurement under the real-time lock (`djk/config/realtime_lock.sh`) is still to do.
3. **Voices keep making grains after note-off** while `gate` is not connected (the examples shape the sound with an
   ADSR after the block, which needs grains during the release). Connecting `note.gate` stops new grains at note-off and
   lets the last ones ring out (at most one grain length), but then the release is the grain length.
4. **Buffer read above rate 1 is not band-limited**: a grain at +12 semitones on recorded material aliases what lies
   above sr/4. The noise source does not care. A mip-mapped or oversampled read would cost more per grain.
5. **One freeze per node** for the buffers (voice 0). Per-voice buffers would allow per-note freezing, at 16 times the
   memory.
6. An edge into `x` is accepted for sources 0 and 2 and does nothing; a translation error for it would be friendlier.
7. Window shapes other than Tukey (Gaussian, skewed attack/decay "expodec"), reverse grains, and a scan speed that moves
   the position by itself are not in this slice.
8. The type number: see "Type number" above; the merge order of the parallel slices decides it.
9. The C++ side, the page and the kern were not built or run; no code there names arts.

**Type number at merge (2026-11-02).** Types are numbered in merge order and never move afterwards: wavetable 32,
metall 33, resonator 34, fm 35, granular 36. The number 38 planned on the branch was dropped; the type tests pin 36.

## Review on the receiving side (2026-11-02)

Merged after fm as type 36. Whole workspace on x86_64, release build: 103 test binaries ok, 0 failures. Own mutations of
`src/granular.rs`: grain pitch with 1100 instead of 1200 cent per octave (three pitch tests red), twice the start clock
(`kornzahl_folgt_der_dichte` and two more red), a 1-sample window edge (`keine_klicks_an_den_kornraendern`,
`frieren_haelt_die_wavetable_position` red). Open: the listening test by the product owner.
