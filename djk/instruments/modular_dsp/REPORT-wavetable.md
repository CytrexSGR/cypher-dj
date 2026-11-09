# Baukasten: wavetable oscillator with unison (type 32)

STATUS: built and verified on branch `claude/baukasten-wavetable-unison-1an536` (2026-11-02), merged into main the same day after review
Nothing installed, not heard. All numbers are measurements on synthetic signals in a cloud container.

## Why

The Baukasten has 16 voices. Supersaw (3 to 7 detuned saws per note), reese (2 detuned saws), choir and texture pads
used to need several oscillator nodes per voice, or several voices per note. The new block `wavetable` plays up to seven
detuned copies inside one voice, from band-limited tables that are generated when the graph is translated.

## What was built

| file | change |
|---|---|
| `src/wavetable.rs` (new) | tables, mip levels, B-spline read, unison voice `Stimme`, unit tests |
| `src/uebersetzen.rs` | `ARTEN` entry 32 `wavetable` (appended, existing type numbers unchanged), value checks, build arm |
| `src/programm.rs` | step `Schritt::Wavetable` (voices boxed so the step enum does not grow), run arm, reset arm |
| `src/lib.rs` | `pub mod wavetable` |
| `demos/wavetable-supersaw.json`, `wavetable-reese.json`, `wavetable-chor.json` (new) | examples |
| `tests/wavetable.rs` (new) | 13 tests: io, value checks, aliasing, pitch, morph, loudness, determinism, robustness |
| `tests/arten.rs` | minimal graph for `wavetable` (reset == fresh), type 32 pinned |
| `tests/keine_allokation.rs` | `WAVETABLE_1` (7 copies, pos/detune/width on knobs) and the three examples |
| `tests/kosten_messung.rs` | the examples in the cost run, new `kosten_wavetable` |
| `mutation_wavetable.py` (new) | the mutation runs of this report |

No existing module was changed in behaviour. The plugin crate `baukasten` needed no change: it loads any graph, and the
block uses no file. `INTERFACES.md` needed no change (no new address, no file).

## Design

**Tables (requirement 2).** Every table is computed from its harmonic spectrum at translation: no files, no samples.

| `tabelle` | name | frames | spectrum |
|---|---|---|---|
| 0 | saege | 1 | `2/(pi h)`, sine phase (falling ramp; spectrally the `saege` oscillator) |
| 1 | rechteck | 8 | pulse, width 50 % -> 5 % over the frames, centred on phase 1/4 so harmonic phases do not move with the width |
| 2 | dreieck | 1 | `8/(pi^2 h^2)`, odd harmonics, alternating sign |
| 3 | sinus | 1 | harmonic 1 |
| 4 | analog | 4 | sine, triangle, saw, square (all with a +sin fundamental, so neighbours do not cancel) |
| 5 | vokale | 5 | sung a, e, i, o, u: source -6 dB/oct under five formant resonances of a bass choir, drawn at C3 (130.81 Hz), Schroeder phases for a low crest factor |
| 6 | orgel | 8 | drawbars 16', 8', 5 1/3', 4', 2 2/3', 2', 1 3/5', 1 1/3', 1' added one per frame |

The classic waves keep their textbook amplitude (the saw peaks near 1.1, like the `saege` oscillator). The additive
tables (vowels, organ) are scaled to the RMS of the saw, so a vowel morph does not jump in level.

**Band limit (requirement 1).** Each frame is a mip map with **one level per third of an octave**: level `k` keeps
harmonics `1..=H_k`, `H_k = floor(1024 * 2^(-k/3))`, 29 levels down to a single harmonic. A copy at frequency `f` plays
the richest level with `H_k * f <= sr - 20 kHz` (at least `sr / 2`). Every partial above Nyquist therefore folds back
above 20 kHz. With a third-octave grid, the partials that a level switch drops all lie above `28 kHz / 2^(1/3)` =
22.2 kHz at 48 kHz, so a switch during a glide is inaudible and needs no crossfade. 1024 harmonics reach 20 kHz down to
19.5 Hz. The level is chosen again only when a copy's phase step changes.

**Interpolation.** A level with `H` harmonics is stored with `L = clamp(next_pow2(16 H), 128, 8192)` samples: 16 times
oversampled below 512 harmonics, at least 8 times for the richest levels. It is read with a **cubic B-spline** (four
taps). The spline's passband droop `sinc^4(h / L)` is divided out of every harmonic when the table is built, so the
passband is exact (unit test `saege_tabelle_trifft_die_formel`, error < 1e-4). The spline's images fall off as
`sinc^4`, about 100 dB down at 16x. Linear interpolation was measured as well and is not good enough (M2: -59.6 dB).

**Phase.** A u32 accumulator per copy (`2^32` = one period). The step comes from `hz / sr` in f32 (24 bits), so pitch
is exact to about 1e-4 cent, and the wrap is exact.

**Morph (requirement 3).** `pos` 0..1 maps to frame position `pos * (frames - 1)`. The two neighbouring frames are read
at the same phase and level and blended linearly. The position goes through a one-pole smoother (`glatt`, default 10 ms)
in each voice. A `trig` puts the smoother straight on the target, so a new note starts at the knob position instead of
morphing from where the last note stopped. The smoother snaps to its target when the rest is below 1e-6 or when f32
rounding swallows the step. That snap prevents subnormals near 0 and a stall about 6e-5 frames short of targets far
from 0 (found by the NaN test, fixed in this slice).

**Unison (requirement 4).** `kopien` 1..7. Copy `c` of `n` sits at `p_c = 2c/(n-1) - 1` in -1..1:
- detune `p_c * verstimmung` cent; `verstimmung` is the outermost copy's offset, 0..50 cent (total spread up to 100 cent);
- pan `p_c * breite`, equal power with the centre at gain 1 on both sides: `gl = sqrt2 cos(pi/4 (1 + pan))`,
  `gr = sqrt2 sin(...)`;
- gain `1 / sqrt(n)` on the sum. Copies with different frequencies and independent phases add in power, so the
  loudness stays that of one copy. Copies that are coherent (detune 0 and `zufall` 0) are `sqrt(n)` louder, as expected.
- start phase: a rising `trig` (> 0.5) draws a new phase for every copy from a xorshift32 per voice, scaled by `zufall`
  (0..1; 0 = all copies at phase 0, a hard reset). The generator is seeded from `saat`, the voice number and fixed
  constants, so the same graph always plays the same. A fresh voice starts at random phases too, so a graph without a
  `trig` edge is free running with spread phases.

**Real time (requirement 5).** Tables are built at translation (`Tabelle::neu` allocates; realfft c2r in f64). The run
path `Stimme::prozess` does not allocate or lock. Every table index is masked with `L - 1`, and every input is checked
for being finite (NaN and inf read as 0) and clamped. The only state that decays is the position smoother, which snaps
(above). Detune ratios and pan gains are recomputed only when their input changes.

### Ports and values

| | name | range | default | meaning |
|---|---|---|---|---|
| in | `hz` | 0 .. sr/2 | 0 | pitch |
| in | `trig` | > 0.5 = strike | 0 | new random start phases, smoother on target |
| in | `pos` | 0..1 | 0 | morph position over the frames |
| in | `verstimmung` | 0..50 cent | 0 | detune of the outermost copy |
| in | `breite` | 0..1 | 0 | stereo spread of the copies |
| value | `tabelle` | integer 0..6 | 0 | table (above) |
| value | `kopien` | integer 1..7 | 1 | unison copies |
| value | `zufall` | 0..1 | 1 | spread of the random start phases |
| value | `saat` | integer 0..65535 | 0 | seed |
| value | `glatt` | 0..1000 ms | 10 | smoothing of `pos` |
| out | `l`, `r` | | | stereo, panned copies |
| out | `aus` | | | sum without pan (for one per-voice mono chain); equals `l` and `r` at width 0 |

The inputs also take a fixed value of the same name, as for every block. Fixed values outside their range are a
`Fehler::Wert`. Edge values are clamped at run time.

### Examples (knob convention: every knob named, fed and audible; midpoint 0.5 is the default sound)

| graph | voices | block settings | knobs |
|---|---|---|---|
| `wavetable-supersaw` | 16 | saw, **7 copies** | 1 Cutoff (400..16000 Hz log), 2 Resonance, 3 Detune (0..50 c, 0.5 = 25 c), 4 Width, 5 Attack, 6 Release |
| `wavetable-reese` | 2 | saw, **2 copies**, 4-pole lowpass, drive, 25 Hz DC block per side | 1 Cutoff (120..6000 log), 2 Resonance, 3 Detune (0..30 c, 0.5 = 15 c), 4 Width, 5 Drive (0..18 dB), 6 Release |
| `wavetable-chor` | 8 | vowels, 5 copies, `glatt` 30 ms, LFO 0.15 Hz on `pos` | 1 Vowel, 2 Vowel motion (LFO depth), 3 Detune (0..30 c), 4 Width, 5 Attack, 6 Release |

Lint probe (`beispiele_konvention.rs`, default knobs): supersaw `peak 0.670 (-3.5 dB), rms -19.0 dB, dc -93.0 dBFS`;
reese `peak 0.448 (-7.0 dB), rms -16.7 dB, dc -88.5 dBFS`; chor `peak 0.721 (-2.8 dB), rms -17.9 dB, dc -98.3 dBFS`.
The reese first failed the lint with DC -42.6 dBFS (saturation of the filtered saws). It got a 25 Hz high-pass per side,
as `lead.json` has, and its output trim went from 0.3 to 0.2. Sweep: all 18 new knobs change the sound on the probe;
the smallest is supersaw knob 2 Resonance, `max |0 - 1| 0.304`.

## How it was proven

All tests go through the public JSON API (`uebersetze`, `Programm`), except the unit tests in `src/wavetable.rs`.

### Aliasing (requirement 1)

Method (`tests/wavetable.rs`, `alias_db`): `f = sr * m / 65536` with odd `m`. The phase step is then exactly
`m * 2^16`, so the output repeats after exactly 65536 samples. A rectangular-window FFT of 65536 samples therefore sees
pure lines with no leakage, and every bin below 20 kHz that is not a multiple of `m` is alias or interpolation image
energy. The measure is alias energy below 20 kHz over total energy. One copy, saw table, 54 frequencies in sixth-octave
steps from 19.8 Hz to 9.1 kHz (the last step below 10 kHz), 48 kHz.

Measured, saw (Hz | dB):

```
19.8 -108.2   22.7 -111.4   25.6 -108.2   28.6 -118.9   31.5 -115.8   35.9 -124.0   40.3 -124.2   44.7 -130.4
50.5 -130.4   56.4 -137.2   63.7 -138.0   71.0 -143.2   79.8 -142.5   90.1 -127.5  101.8 -127.4  113.5 -134.4
126.7 -134.6 142.8 -140.8  160.4 -140.5  179.4 -124.4  201.4 -124.4  226.3 -131.6  254.2 -132.1  284.9 -138.7
320.1 -138.1 359.6 -121.3  403.6 -121.2  453.4 -128.8  509.0 -129.5  570.6 -135.8  640.9 -135.3  718.5 -118.0
806.4 -117.9 906.0 -125.5 1015.9 -125.8 1140.4 -132.5 1281.0 -132.0 1437.7 -114.4 1613.5 -114.4 1811.3 -123.0
2032.5 -123.4 2281.5 -123.1 2559.8 -128.3 2873.3 -110.4 3226.3 -110.4 3620.4 -118.7 4064.2 -118.9 4562.3 -118.8
5120.4 -123.9 5747.3 -130.0 6450.4 -130.0 7241.5 -137.2 8127.7 -137.2 9123.8 -137.2
```

**Worst -108.2 dB (19.8 and 25.6 Hz, the richest level, 8x oversampled); limit -80 dB.** Other spectra on every third
frequency: narrowest pulse (`rechteck`, pos 1) worst -102.8 dB, square (`analog`, pos 1) -110.0 dB, vowels (pos 0.5)
-133.7 dB, 7 saw copies (no detune, so all copies stay on the lines) -110.0 dB.

A first version with 8x oversampling and a minimum length of 64 measured a worst case of -84.9 dB at 3226 Hz. That is
inside the limit, but with little margin, so the lengths were doubled. Table memory went up by 50 % (numbers below).

### Mutations

Each mutation is applied to a copy of the workspace, the named test is run in release and the change is reverted
(`python3 mutation_wavetable.py <copy of djk/instruments> [ID ...]`). **All 17 are red.** Four of them (G1, G3, R1, R2)
were run again after the last code change, as were the others whose code had moved (M1, M2, P2, G2, A1); all stayed red.

| id | mutation | test | red output |
|---|---|---|---|
| M1 | mip selection off (always level 0) | `saege_aliasing_unter_minus_80_db_von_20_hz_bis_10_khz` | `alias energy -8.0 dB at 7241.5 Hz, limit -80 dB` |
| M2 | linear instead of cubic B-spline read | same | `alias energy -59.6 dB at 3226.3 Hz` |
| M3 | no B-spline droop compensation | unit `saege_tabelle_trifft_die_formel` | `phase 0.015625: 0.58539 vs 0.58755` |
| P1 | detune in 1/1000 octave instead of cent | `unison_kopien_liegen_auf_ihrer_verstimmung` | `detune 5: left -6.00008, right 5.99991` |
| P2 | phase step truncated to 16 bits | `tonhoehe_auf_hundertstel_cent` | `pitch error 72.82551 cent, limit 0.01` |
| G1 | position not smoothed | `morph_ohne_sprung` | `step 2.038891 above 0.02` |
| G2 | nearest frame instead of interpolation | `morph_ohne_sprung` | `step 1.1496046 above 0.02` |
| G3 | trig does not put the smoother on the target | `neue_note_beginnt_an_der_position_ohne_nachlauf` | `the note started away from the knob position (-3.23 dB)` |
| L1 | no gain compensation | `unison_lautheit_bleibt_gleich` | `loudness moves 8.49 dB across copies and widths, limit 1` |
| L2 | gain `1/n` (amplitude instead of power) | same | `loudness moves 8.42 dB` |
| L3 | linear pan instead of equal power | same | `loudness moves 3.02 dB` |
| D1 | same start phases on every note | `jede_note_hat_eigene_startphasen` | `strike 1 starts like strike 0 (difference 0)` |
| D2 | seed from the clock | `gleicher_graph_gleicher_klang_andere_saat_anderer_klang` | `24000 samples differ between two loads of the same graph` |
| D3 | `zuruecksetzen` leaves the voices | `arten.rs zuruecksetzen_gleich_frisch` | `Art wavetable: 24000 Samples weichen nach zuruecksetzen ab` |
| R1 | non-finite `pos` not caught | unit `nan_position_haengt_den_glaetter_nicht_auf` | `the position must reach the last frame after the NaN` |
| R2 | smoother does not snap | unit `positionsglaettung_rastet_ein_ohne_subnormale` | `the smoother must snap to its target` (left at a subnormal) |
| A1 | one allocation in `Stimme::prozess` | `keine_allokation.rs echtzeitpfad_allokiert_nicht` | `Echtzeitpfad hat Speicher angefordert: wavetable-1` |

R1 was **green** at first against the graph-level test `unsinnige_eingaenge_bleiben_endlich`. A NaN position reads
frame 0 and stays finite, so that test could not see that the smoother then hangs at NaN for the rest of the note. The
new unit test checks recovery after the NaN. It is red under R1, and it also found the stall described under Morph.

### Other measured results

- **Pitch** (`tonhoehe_auf_hundertstel_cent`): sine table, rising zero crossings over 1 s, at 44.1, 48 and 96 kHz,
  27.5 Hz to 7040 Hz. Largest error **0.00038 cent** (limit 0.01). Unison, 2 copies at full width (left = copy 0,
  right = copy 1): detune 5 / 17 / 50 cent measured -5.0001/+4.9998, -17.0001/+16.9998, -50.0001/+49.9999 cent.
- **Morph** (`morph_ohne_sprung`): `analog` table, 3 copies, phase frozen (hz 0) so every step comes from the morph,
  knob jump 0 -> 1. The bound 0.02 is derived in the test: k = 0.0021 per sample x 3 frames x at most 1.2 per frame x
  sqrt(3). Largest step **0.00478**, total change 4.08. Control: the same jump with `glatt` 0 is one step of 2.04.
  Starting a note after a knob move gives +0.00 dB against a fresh note at that position.
- **Unison loudness** (`unison_lautheit_bleibt_gleich`): A4 held 2 s, detune 20 cent, mean of 4 seeds, against one
  copy: 2..7 copies **+0.00 to +0.03 dB**; 2 and 7 copies at width 1: +0.01 / +0.03 dB; 7 copies at width 0: +0.04 dB
  (limit +-1 dB).
- **Determinism**: two loads of the same graph are bit-identical. Seed 1 gives other phases. Three strikes of one note
  differ by up to 1.34 (zufall 1) and are identical with zufall 0 (difference < 1e-6).
- **Robustness**: +-inf, huge values and NaN on all five inputs at once: finite output, `rettungen` 0.
- **Table memory** per node (allocated at translation): saege, dreieck, sinus 296 KB; analog 1.18 MB; vokale 1.48 MB;
  rechteck and orgel 2.37 MB. Shared by the voices of a node, not by nodes or graphs.

## Cost (requirement 6)

`cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture --test-threads=1 kosten_wavetable`.
All voices sound (one note per voice). The block period is 1333 / 2667 / 5333 us for blocks of 64 / 128 / 256. **The
host was not at rest**: a 4-core cloud VM with loadavg 2.2 to 3.4 from earlier builds, and isolated spikes up to 26 ms
(a scheduler artefact, not the graph). The histogram tops out at 1280 us, so a p99.9 of 1280 means "1280 or more".
Two runs after the last code change:

| graph (16 voices) | block | p50 run 1 / run 2 | p99 | p50 share of the period |
|---|---|---|---|---|
| supersaw, 1 copy | 64 | 75 / 70 us | 155 / 210 | 5.6 % |
| supersaw, 1 copy | 256 | 290 / 300 us | 575 / 755 | 5.5 % |
| supersaw, 2 copies | 64 | 110 / 100 us | 210 / 200 | 8.1 % |
| supersaw, 2 copies | 256 | 335 / 330 us | 605 / 670 | 6.3 % |
| **supersaw, 7 copies (16 x 7 = 112 copies)** | 64 | **135 / 245 us** | 225 / 330 | 10 to 18 % |
| **supersaw, 7 copies** | 128 | **305 us** | 575 | 11.4 % |
| **supersaw, 7 copies** | 256 | **555 / 555 us** | 1280 / 1175 | **10.4 %** |
| 7 `saege` + 7 `transponiere` per voice, mono, one filter (the old way) | 64 | 90 / 100 us | 120 / 225 | 7.1 % |
| same | 256 | 460 / 480 us | 670 / 690 | 8.8 % |

Reading: **16 voices x 7 unison copies cost about 555 us per 256-sample block, about 10 % of the period at p50 and
about 22 % at p99.** That is roughly 2.3 us per sample; without the rest of the graph (supersaw at 1 copy is about
300 us), the oscillator part is about 40 ns per copy and sample. The old way with seven polyBLEP saws is in the same
range, but it is mono with one filter instead of two. Before the mip level was cached per copy, the 7-copy graph
measured 1080 us at 256 (a `log2` per copy and sample). Other examples at 256: `wavetable-reese` (2 voices) p50 160 us,
`wavetable-chor` (8 voices x 5 copies) p50 435 us. Not gated, read as an order of magnitude.

## Workspace

`cargo test --workspace` in `djk/instruments`: debug (before the last two fixes) and **release after the final code:
99 test groups, 580 passed, 0 failed, 9 ignored** (the ignored ones are the cost runs and other runs on request). The
convention lint (`beispiele_konvention.rs`) now covers the three new graphs; in debug it alone takes several minutes.

## Open

1. **Not heard.** Detune spread, pan law, the vowel spectra (formants drawn at C3; like every wavetable they move with
   the pitch, so high notes sound small) and the example levels are numbers, not ear judgements.
2. **Retrigger click:** a `trig` on a voice that still sounds (same note again, voice stealing) jumps all copies to new
   phases while the envelope is not at 0. A short crossfade (2 ms, as the sampler has) would cost double reads during
   the fade. Not done.
3. **Linear detune spacing.** Classic supersaws use uneven spacing to avoid periodic beating patterns; that would be a
   new value.
4. **Cost**: the run measured a loaded host. A rest measurement under the real-time lock
   (`djk/config/realtime_lock.sh`) is still to do. SIMD over the copies, or sharing the frame blend between copies
   at the same level, is possible.
5. **Memory**: the tables are built per node (up to 2.4 MB). A shared cache across nodes and graphs (the tables do not
   depend on the sample rate) would save memory and load time.
6. `aus` (mono) exists so one mono filter per voice can follow; the examples use the stereo outputs with two filters.
7. More tables (user spectra in the JSON, more vowels or registers) and a `pos` per copy (spread over frames) are not
   in this slice.
8. The C++ side, the page and the kern were not built or run; no code there names arts.

## Review on the receiving side (2026-11-02)

Re-run on x86_64, release build, against main: aliasing of the saw sweep -108.2 dB at 19.8 Hz and -111.4 dB at
22.7 Hz; pitch within 0.0004 cent; 16 voices x 7 copies 20.6 % of the block budget at p99.9 (block 64). Three independent
mutations of `src/wavetable.rs` turned their checks red: reading mip level 0 always (both aliasing tests), unison gain 1
instead of 1/sqrt(n) (`unison_lautheit_bleibt_gleich`), position without smoothing (`morph_ohne_sprung`). Open: the
listening test of the three examples by the product owner.
