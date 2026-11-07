# Baukasten: metallic oscillator bank for hats and cymbals (type 33)

STATUS: built and verified on branch `claude/metallic-oscillator-drums-j9rf28` (2026-11-02), merged into main the same day after review; nothing
installed, not heard. All numbers are measurements on synthetic signals in a cloud container.

## Why

The Baukasten had no source for hi-hats and cymbals. Noise through a filter gives a hiss but not the metallic ring of
the analog drum machines, and six detuned `puls` nodes per voice plus three filters cost many nodes and have no choke.
The new block `metall` is the whole metallic voice in one node: one voice per hit, with open/closed choke.

## What was built

| file | change |
|---|---|
| `src/metall.rs` (new) | oscillator bank with table BLEP, filter chain, envelope, choke, voice `Stimme`, unit tests |
| `src/uebersetzen.rs` | `ARTEN` entry `metall` (appended at the end), value checks, build arm |
| `src/programm.rs` | step `Schritt::Metall` (voices boxed), run arm, reset arm |
| `src/lib.rs` | `pub mod metall` |
| `beispiele/metall-hihat.json`, `metall-ride.json`, `metall-crash.json` (new) | examples |
| `tests/metall.rs` (new) | 16 tests: io, value checks, aliasing (2), balance, tuning, velocity, decay, example targets, choke (3), determinism, silence, robustness, steps |
| `tests/arten.rs` | minimal graph for `metall` (reset == fresh), type number pinned |
| `tests/keine_allokation.rs` | `METALL_1` (every input on a knob, choke from the gate) and the three examples |
| `tests/kosten_messung.rs` | new `kosten_metall` |
| `mutation_metall.py` (new) | the mutation runs of this report |

No existing module changed in behaviour. The plugin crate `baukasten` needed no change (it loads any graph; the block
reads no file).

**Type number.** The block is type 36. Types 33 to 35 belong to slices built in parallel, which are merged before this
one. On this branch they do not exist yet, so `metall` is entry 33 of `ARTEN` here; the tests
(`metall_ist_art_36_mit_ein_und_ausgaengen`, `arten_nur_angehaengt_metall`) accept index 36, or the last entry while
`ARTEN` has fewer than 37 entries. **Merge note:** keep the entries in the order 33, 34, 35, 36; the array length line
and the appended match arms will conflict textually and only need concatenation.

## Design

**Oscillators.** Six squares at 205.3, 304.4, 369.6, 522.7, 540.0 and 800.0 Hz at `tune` 1. These are the TR-808
cymbal/hi-hat oscillator frequencies as given (measured on the circuit) by K. J. Werner, J. S. Abel and J. O. Smith,
"The TR-808 cymbal: a physically-informed, circuit-bendable, digital model", ICMC/SMC 2014 (cited from memory; see
open point 1). Ratios to the lowest: 1, 1.483, 1.800, 2.546, 2.630, 3.897. No pair is a small-integer ratio, so the
odd harmonics of the six squares interleave densely above about 2 kHz instead of forming one harmonic series; this is
the metallic, pitch-less cluster. 522.7 and 540 Hz beat at 17.3 Hz, which gives the shimmer. `tune` (0.5..2) scales all
six. Phases are u32 accumulators (exact period, exact steps); every voice starts at random phases from its seed and the
oscillators run only while the voice sounds.

**Band limit.** Naive squares plus a table BLEP. Each edge (two per period and oscillator) adds to the 32 samples
around it `h * (C(t - t_edge) - step)`, where `C` is the integral of a windowed sinc (cut-off 0.48 sr, 32 samples,
Kaiser beta 8). The result equals the ideal square filtered by that kernel: flat to about 18 kHz, more than about 80 dB
down above 28 kHz at 48 kHz, so every partial that folds back below 20 kHz is that far down. `C` is tabulated once per
process (256 points per sample, 8193 floats, 32 KB, linear interpolation; shared by all nodes; built at translation).
Cost: on average 2 * sum(f_i) * tune / sr = 0.11 * tune edges per sample and voice, 32 multiply-adds each. Price: the
tone part is delayed by 16 samples (0.33 ms at 48 kHz). This is not reported as graph latency; the noise part is not
delayed, so the first 0.33 ms of a hit from silence are noise only.

Two cheaper designs were measured first and rejected (same alias measure as below, chain at `farbe` 1): a 4-point
cubic B-spline BLEP reached only -44 dB, because at 10.5 kHz the squares' own partials are weak and the folded ones are
attenuated only by `sinc^4`; a 2-point polyBLEP is worse still (`sinc^2`). The result does not depend on `tune`: for a
`1/k` spectrum the in-band alias ratio depends only on the output frequency.

**Noise.** White noise per voice (xorshift32, seeded from `saat` and the voice number). `rauschen` blends tone and noise
with equal power (`cos`/`sin`). Because the squares' spectrum falls and the noise is flat, the noise is scaled per band
(`RAUSCH_BAND` = 0.394, 0.219, 0.153, measured) so both have the same level behind the band-passes; the blend then moves
the level by at most 0.4 dB.

**Filters.** Three band-passes at 3.5, 7 and 10.5 kHz (Q 1.6, unity peak gain) in parallel. `farbe` 0..1 moves a
triangular weight over them: 0 = only the low band, 0.5 = only the middle, 1 = only the high band, linear in between.
Then a 2-pole Butterworth high-pass at `hp`. All are the f64 TPT stages of `svf.rs`; the band coefficients are computed
at translation, the high-pass coefficient only when `hp` changes. The band centres are a design choice (closed hats
near 9 kHz centroid, rides near 5 kHz), not circuit values.

**Envelope.** A `trig` (> 0.5) sets the envelope to `vel` (0..1); it then falls exponentially, `decay` being the time to
-60 dB. The envelope multiplies the filtered signal last, so any change of it is a pure gain change. Below -100 dB it
snaps to 0; the voice is then idle, filters and BLEP buffer are cleared and nothing is computed (no subnormals, and idle
voices are almost free).

**Choke.** A choked voice falls on its own exponential to -60 dB in `schnitt` ms (default 8, range 1..100). The gain
falls by at most 1.8 % per sample at 8 ms (48 kHz), so there is no step. Two ways to choke, both usable from a graph:
- `gruppe` 1 (default): a `trig` on any voice of the node chokes every other sounding voice of that node. With one
  hat node played by several notes (each note gets its own voice), a closed hat cuts the ringing open hat, a new open
  hat cuts the previous one, as on machines where open and closed hat share one circuit. Voices struck in the same
  sample do not choke each other. `gruppe` 0 lets hits overlap (rides, crashes).
- input `choke`: a rising edge above 0.5 chokes that voice. `metall-crash` uses it as "grab": `choke = (1 - gate) *
  knob`, so with the knob above the middle a crash is cut when its key is released.
A new `trig` always wins over a choke in the same sample and clears an earlier one.

**Real time.** `prozess_stimmen` and `Stimme::prozess` do not allocate, lock or panic (BLEP table indices are bounded
by construction; the table length is checked). Every input is checked for being finite (NaN and inf read the node's
default) and clamped. A last guard returns 0 and idles the voice if the output were ever not finite.

### Ports and values

| | name | range | default | meaning |
|---|---|---|---|---|
| in | `trig` | > 0.5 = hit | 0 | strike: envelope to `vel`, clears a choke |
| in | `vel` | 0..1 | 1 | level of the hit (linear) |
| in | `decay` | 0.01..10 s | 0.3 | time to -60 dB |
| in | `tune` | 0.5..2 | 1 | factor on the six frequencies |
| in | `farbe` | 0..1 | 0.5 | band weight: 3.5 / 7 / 10.5 kHz |
| in | `rauschen` | 0..1 | 0.2 | tone/noise blend, equal power |
| in | `hp` | 500..16000 Hz | 6000 | high-pass cut-off |
| in | `choke` | rising edge > 0.5 | 0 | chokes this voice |
| value | `schnitt` | 1..100 ms | 8 | choke time to -60 dB |
| value | `gruppe` | 0 or 1 | 1 | a hit chokes the other voices of the node |
| value | `saat` | integer 0..65535 | 0 | seed of phases and noise |
| out | `aus` | | | audio (mono) |
| out | `huelle` | 0..1 | | envelope (vel included) |

Inputs take a fixed value of the same name like every block. Fixed values outside their range are a `Fehler::Wert`;
signals are clamped at run time.

### Examples (every knob named, fed and audible; 0.5 is the default sound)

| graph | voices | setup | knobs |
|---|---|---|---|
| `metall-hihat` | 4 | closed hat on note 42 (F#1), open hat on 46 (A#1), pedal-like in between, as in the GM drum map; `gruppe` 1 | 1 Closed decay (20..200 ms), 2 Open decay (0.2..2 s), 3 Tune (0.7..1.4), 4 Color (0.5..1), 5 Noise (0..0.6), 6 Low cut (3..10 kHz) |
| `metall-ride` | 4 | low/middle bands, little noise, `gruppe` 0 | 1 Decay (1..6 s), 2 Tune (0.6..1.2), 3 Color (0..0.6), 4 Noise (0..0.3), 5 Low cut (0.8..5 kHz) |
| `metall-crash` | 4 | more noise, `gruppe` 0, `schnitt` 30 ms | 1 Decay (1.5..8 s), 2 Tune (0.8..1.6), 3 Color, 4 Noise (0.3..0.9), 5 Low cut (1.5..6 kHz), 6 Grab (choke on release above the middle) |

In `metall-hihat` the note decides the articulation with plain arithmetic nodes: `offen = (hz - 92.5) / 24.04` is 0 at
note 42 and 1 at note 46; `decay = closed + offen * (open - closed)` and `farbe = color - 0.25 * offen` (open hats a
little darker). Notes far above 46 give a long decay (clamped at 10 s).

Lint probe (`beispiele_konvention.rs`, default knobs): crash `peak 0.659 (-3.6 dB), rms -23.9 dB, dc -128.6 dBFS`;
hihat `peak 0.596 (-4.5 dB), rms -27.0 dB, dc -125.1 dBFS`; ride `peak 0.533 (-5.5 dB), rms -25.4 dB, dc -117.4 dBFS`.
Sweep: all 17 knobs change the sound on the probe; the smallest is ride knob 4 Noise, `max |0 - 1| 0.349`.

## How it was proven

Everything goes through the public JSON API (`uebersetze`, `Programm`) except the alias measurement (below) and the
unit tests in `src/metall.rs`. Numbers at 48 kHz unless stated.

### Aliasing

Method (`alias_db`): the oscillator frequencies are rounded to `f_i = sr * m_i / 65536` with odd `m_i`; each phase step
is then exactly `m_i * 2^16`, the sum repeats after exactly 65536 samples, and a rectangular-window FFT of 65536
samples sees pure lines. Every bin below 20 kHz that is no multiple of any `m_i` is alias energy; the measure is alias
energy below 20 kHz over total energy. It runs the voice's own `Bank` and `Kette` (the envelope would smear the lines),
after 9600 samples of settling. Raw bank and the full chain at three settings: `farbe` 0 / `hp` 2 kHz,
`farbe` 0.5 / `hp` 6 kHz, `farbe` 1 / `hp` 8 kHz; `tune` 0.5, 0.71, 1, 1.41, 2.

| sr | raw bank | chain farbe 0 | chain farbe 0.5 | chain farbe 1 |
|---|---|---|---|---|
| 48 kHz | -113.4 .. -119.7 dB | -114.8 .. -116.0 | -106.7 .. -107.5 | **-102.1** .. -102.5 |
| 96 kHz | -124.3 .. -130.1 | -121.5 .. -122.2 | -114.6 .. -115.5 | -111.5 .. -112.5 |
| 44.1 kHz (tune 0.5, 1, 2) | | -110.1 .. -111.2 | -98.9 .. -100.9 | **-92.7** .. -95.1 |

**Stated bounds: below -90 dB at 48 and 96 kHz (worst measured -102.1 dB), below -80 dB at 44.1 kHz (worst -92.7 dB;
there the kernel's stop band begins at 24.6 kHz, so partials between 22.05 and 24.6 kHz fold to 19.5..22 kHz).**
For comparison, naive squares measure -8.0 dB (mutation A1).

### Spectral centroid and decay of the four targets

`beispiele_treffen_decay_und_schwerpunkt`: one hit at velocity 1 on the example at default knobs, until 80 dB down.
Centroid: energy-weighted mean frequency of the whole hit (zero-padded FFT). -60 dB time: least-squares line through
the levels of 1 ms windows from 5 ms after the hit down to -50 dB, extrapolated to -60 dB (the fit averages out the
17 Hz beating and the noise).

| target | -60 dB time | stated range | centroid | stated range |
|---|---|---|---|---|
| closed hat (hihat, note 42) | 0.063 s | 0.04..0.1 s | **8995 Hz** | 8000..10500 Hz |
| open hat (hihat, note 46) | 0.642 s | 0.4..1.0 s | **7661 Hz** | 6500..8700 Hz |
| ride (note 51) | 2.45 s | 1.5..3.5 s | 5057 Hz | 4000..6000 Hz |
| crash (note 49) | 3.46 s | 2..5 s | 7659 Hz | 6000..8700 Hz |

The closed hat must also be at least 500 Hz brighter than the open hat (measured 1334 Hz).

**Decay parameter** (`decay_ist_die_zeit_bis_minus_60_db`, noise 0.5, one voice): set 0.03 / 0.1 / 0.3 / 1 / 3 s,
measured 0.0301 / 0.0982 / 0.3055 / 1.0020 / 2.9974 s, largest error 1.8 % (limit 15 %).

### Choke

Open hat (decay 2 s) on note 46; after 0.1 s a silent hit (velocity 0) on note 42 chokes it through the group, so the
open hat is the only sound. Default `schnitt` 8 ms.
- **Time**: the envelope is -60.2 dB down after 8 ms + 1 sample, the audio (1 ms window after that point against the
  1 ms window before the choke) -60.3 dB. Stated bound: -60 dB within `schnitt` ms.
- **No click, envelope**: largest relative fall per sample 0.0178 (bound 0.02; a hard cut is 1).
- **No click, audio** (`choke_ohne_klick_im_audio`): the gain the choke applies to the audio, choked output over the
  unchoked reference sample by sample (same seed, so the same signal before the envelope; samples near zero crossings
  of the reference skipped): largest change between valid samples 0.052 (bound 0.08 = four per-sample falls, since
  valid samples can be a few apart), never above 1. This catches steps that do not show in the envelope (mutation C5).
- A first click measure, energy below 1 kHz around the choke, was dropped: it measured -50 dB both for the smooth choke
  and for a hard cut, because the hat's own low-frequency content (-47 dB) masks the splatter.
- **Group off**: with `gruppe` 0 the second hit leaves the first bit-identical. Two hits in one sample do not choke
  each other (envelope sum 1.87 after 20 ms). A voice struck again 2 ms into its choke rings again.
- **Choke input**: `metall-crash` with Grab at 1 is -61.3 dB down 31 ms after the key release (`schnitt` 30 ms); at the
  default 0.5 it rings on (+1.3 dB, noise of the measure).

### Other measured results

- **Tone/noise balance** (`ton_und_rauschen_gleich_laut`, steady signal, `hp` 2 kHz): against tone only, `rauschen`
  0.25..1 moves the level by -0.39 .. +0.37 dB over `farbe` 0, 0.25, 0.5, 0.75, 1 (limit 1.5 dB).
- **Tuning**: the step of each oscillator is exact to 1e-6 relative (unit test); in the graph, each of the six
  fundamentals at `tune` 0.5, 1, 1.5 is a line at least 12 dB above its neighbourhood.
- **Velocity**: 0.5 against 1 gives -6.021 dB.
- **Determinism**: two loads of the same graph are bit-identical; seed 1 differs. A node without a hit is exactly silent.
- **Robustness**: +-inf, huge values and NaN on all eight inputs at once: finite output, `rettungen` 0.
- **Reset**: `arten.rs` `zuruecksetzen_gleich_frisch` covers `metall` (phases, noise, filters, envelope, choke state).

### Mutations

Each mutation is applied to a copy of the workspace, the named test is run in release and the change is reverted
(`python3 mutation_metall.py <copy of djk/instrumente> [ID ...]`). **All 21 are red** on the final code (full run after
the last change).

| id | mutation | test | red output |
|---|---|---|---|
| A1 | naive squares (no BLEP) | `aliasing_unter_minus_90_db_bei_48_und_96_khz` | `alias energy -8.0 dB at sr 48000 tune 1.41 farbe 1, limit -90 dB` |
| A2 | BLEP kernel cut-off 0.55 sr instead of 0.48 | `aliasing_unter_minus_80_db_bei_44_1_khz` | `alias energy -39.5 dB at 44.1 kHz, limit -80 dB` |
| A3 | BLEP table with 4 instead of 256 points per sample | `aliasing_unter_minus_90...` | `alias energy -45.7 dB` |
| B1 | noise not balanced per band | `ton_und_rauschen_gleich_laut` | `the blend moves the level by 16.01 dB, limit 1.5` |
| B2 | linear instead of equal-power blend | same | `3.20 dB, limit 1.5` |
| T1 | `tune` ignored | `tune_verschiebt_alle_sechs_linien` | `tune 0.5: no line at 102.7 Hz (0.3 dB over its neighbours)` |
| V1 | velocity ignored | `anschlagstaerke_skaliert_den_pegel` | `velocity 0.5 gives +0.000 dB, expected -6.02` |
| D1 | decay as time constant instead of -60 dB time | `decay_ist_die_zeit_bis_minus_60_db` | `decay off by 637.8 %, limit 15 %` |
| D2 | envelope never snaps to idle (subnormals) | unit `stimme_geht_still_ohne_subnormale` | `the envelope must snap to 0` |
| S1 | high band at 7 kHz instead of 10.5 kHz | `beispiele_treffen_decay_und_schwerpunkt` | `closed hat: centroid 7496 Hz outside 8000..10500` |
| S2 | high-pass bypassed | same | `closed hat: centroid 6448 Hz outside 8000..10500` |
| C1 | hard cut instead of the exponential choke | `choke_*` | `the envelope falls by 1.000 in one sample (limit 0.02): a click` |
| C2 | group choke off | `choke_schneidet_in_8_ms_ohne_sprung` | `the envelope is only -0.2 dB down after 8 ms` |
| C3 | `choke` input ignored | `gruppe_0_wuergt_nicht_und_choke_eingang_wuergt` | `Grab 1: only 1.3 dB down 31 ms after release` |
| C4 | choke time as time constant instead of -60 dB time | `choke_schneidet...` | `the envelope is only -8.7 dB down after 8 ms` |
| C5 | filters reset at the choke (envelope smooth, audio steps) | `choke_ohne_klick_im_audio` | `positive control: the gain starts at 1 (Some(4.11))` (the audio gain jumps at the first sample) |
| C6 | a new trig does not clear the choke | `gruppe_0_wuergt_nicht...` | `the open hat struck again after its choke does not ring (envelope 0.000)` |
| G1 | seed from the clock | `gleicher_graph_gleicher_klang_andere_saat_anderer_klang` | `24000 samples differ between two loads of the same graph` |
| G2 | `zuruecksetzen` leaves the voices | `arten.rs zuruecksetzen_gleich_frisch` | `Art metall: 24000 Samples weichen nach zuruecksetzen ab` |
| R1 | non-finite `hp` not caught and no output guard | `unsinnige_eingaenge_bleiben_endlich` | `the guard had to rescue the graph` |
| R2 | one allocation in `prozess_stimmen` | `keine_allokation.rs echtzeitpfad_allokiert_nicht` | `Echtzeitpfad hat Speicher angefordert: metall-1` |

Found by mutation and fixed in this slice: C1 was first **green**, because the envelope step test skipped the last
step to 0 (meant for the snap at -100 dB), which also hid a hard cut; it now skips only steps below -80 dB. A first C6
("the group choke also cuts voices struck in the same sample") was green because it is equivalent: the trig branch in
`Stimme::prozess` already wins. The redundant condition was removed from the code, the behaviour got a test (two hits
in one sample), and C6 now mutates the clearing of the choke by a new trig.

## Cost

`cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture --test-threads=1 kosten_metall`.
One `metall` node, `gruppe` 0, decay 2 s, noise 0.3, all voices struck again every 0.25 s so every voice computes all
the time (an idle voice computes nothing). Block period 1333 / 2667 / 5333 us for 64 / 128 / 256. **Host not at rest**:
4-core cloud VM, loadavg about 3 (earlier builds), isolated spikes of several ms (scheduler, not the graph); the
histogram tops out at 1280 us, so a p99.9 of 1280 means "1280 or more". Two runs:

| graph | block | p50 run 1 / run 2 | p99 run 1 / run 2 | p50 share of the period |
|---|---|---|---|---|
| 1 voice | 256 | 35 / 35 us | 65 / 85 | 0.7 % |
| 4 voices | 256 | 75 / 75 us | 110 / 190 | 1.4 % |
| **16 voices** | 64 | **60 / 60 us** | 115 / 125 | 4.5 % |
| **16 voices** | 128 | **125 / 120 us** | 240 / 190 | 4.6 % |
| **16 voices** | 256 | **255 / 245 us** | 510 / 430 | **4.7 %** |
| `metall-hihat` (4 voices) | 256 | 90 / 120 us | 180 / 205 | |
| `metall-ride` (4 voices) | 256 | 85 / 80 us | 200 / 160 | |
| `metall-crash` (4 voices) | 256 | 100 / 100 us | 135 / 230 | |

Reading: **16 sounding voices cost about 250 us per 256-sample block, under 5 % of the period at p50 and under 10 % at
p99**, about 60 ns per voice and sample including the graph overhead (one voice alone is about 35 us per block).

## Workspace

`cargo test --workspace --release` in `djk/instrumente` after the final code: **100 test groups, 602 passed, 0 failed,
10 ignored** (the ignored ones are the cost runs and other runs on request, `kosten_metall` among them). The convention
lint (`beispiele_konvention.rs`) covers the three new graphs.

## Open

1. **Frequencies cited from memory.** The six frequencies are the widely quoted TR-808 values attributed to Werner,
   Abel and Smith (2014); the paper was not at hand in this session. If a check finds other values, only `FREQUENZEN`
   changes (and the measured `RAUSCH_BAND` should be measured again).
2. **Not heard.** Band centres, Q, the default levels and the example mappings are numbers, not ear judgements. The
   examples' centroids sit where hats and cymbals usually sit, which says nothing about whether they sound good.
3. **Choke across nodes.** The group works inside one node. Two separate nodes (say a hat node and a cymbal node) cannot
   choke each other: every node sees every note, and the Baukasten has no per-note routing. The `choke` input can be
   wired from another node's signal, but there is no ready "other node was struck" output.
4. **One envelope.** A real cymbal decays slower in its low band than in its high band (the 808 cymbal has separate
   envelopes per band). One envelope for all bands is a simplification; per-band decay would be a new value.
5. **0.33 ms tone delay** of the BLEP (above), not reported as latency.
6. **Retrigger step**: a new hit on a still ringing voice sets the envelope to `vel` at once (a step in gain, as on the
   analog machines). With `gruppe` 1 different notes take different voices, so this concerns only repeated hits of the
   same note.
7. **Cost** measured on a loaded host; a rest measurement under the real-time lock is still to do.
8. The C++ side, the page and the kern were not built or run; no code there names arts.

## Review on the receiving side (2026-11-02)

Re-run on x86_64, release build, against main with the wavetable oscillator: whole workspace 0 failures; aliasing
-92.7 to -110.7 dB at 44.1 kHz, choke to -60.2 dB in 8 ms, decay times within 1.8 %. Three independent mutations of
`src/metall.rs` turned their checks red: BLEP residual dropped (both aliasing tests), choke ignored
(`choke_schneidet_in_8_ms_ohne_sprung`, `gruppe_0_wuergt_nicht_und_choke_eingang_wuergt`), choke as a hard cut
(`choke_ohne_klick_im_audio`, `choke_schneidet_in_8_ms_ohne_sprung`). Open: the listening test by the product owner.

**Type number at merge (2026-11-02).** Types are numbered in merge order and never move afterwards: wavetable 32,
metall 33, resonator 34. The numbers 35 and 36 planned for the parallel slices were dropped; the type tests pin 33 and 34.
