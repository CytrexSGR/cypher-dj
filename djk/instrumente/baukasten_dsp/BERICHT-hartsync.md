# Baukasten: band-limited hard sync on the oscillators (`hart`)

STATUS: built and verified on branch `claude/hard-sync-oscillator-852uat` (2026-11-02), merged into main the same day after review, nothing installed,
not heard. All numbers are measurements on synthetic signals in a cloud container.

## Why

The target sound is the sync lead: a slave oscillator whose phase is reset by a master, with the slave pitch swept. The
oscillators in `src/osz.rs` already had a hard sync (`sync` input, fed by the master's `zyklus`, used by `lead.json`).
It learns of the master's wrap only in the sample after it, so it can smooth only the half of the jump that lies after
the reset; its own module doc says "this reduces the aliasing, it does not remove it". Measured below: in a sync sweep
its aliases below 5 kHz sit at -20 to -44 dB.

## What was built

| file | change |
|---|---|
| `src/osz.rs` | `Osz`: new fields `hart`, `nach`, `nach_gilt`; `weiter` also records the announcement; new `hart()`, `saege_hart`, `puls_hart`, `dreieck_hart`, `hart_schritt`; private `Form`, `Ereignisse`. `Sinus`: field `hart`, `hart()`. Unit tests. The existing functions `saege`, `puls`, `dreieck`, `blep`, `blep_nach`, `blamp` are unchanged. |
| `src/uebersetzen.rs` | `hart` appended to the inputs of `saege`, `puls`, `dreieck` and to the outputs of all four oscillators; value check (no fixed `hart`); helper `hart_ein` (edge only, excludes `sync`); build arms fill the new fields |
| `src/programm.rs` | the four oscillator steps get `hart: Option<Quelle>` (not for the sine) and `hart_aus`; the run arms choose the old or the hard sync call by `hart` |
| `beispiele/hartsync-lead.json`, `hartsync-pad.json`, `hartsync-bass.json` (new) | examples |
| `tests/hartsync_bitgleich.rs` (new) | fingerprints of 75 renders taken before the change (own commit `be71b12`) |
| `tests/hartsync.rs` (new) | 12 tests: ports and rules, announcement, quiet edge, reset position, reference, two sweeps, narrow pulse, robustness, range, examples |
| `tests/arten.rs` | appended `zuruecksetzen_gleich_frisch_hartsync` |
| `tests/keine_allokation.rs` | appended `HARTSYNC_1` and the three examples |
| `tests/kosten_messung.rs` | appended `kosten_hartsync` |
| `mutation_hartsync.py` (new) | the mutation runs of this report |

No new type number: hard sync is part of the existing oscillator types 3 to 6, and the design did not need a new type
(ports are appended to the existing entries, `ARTEN` did not grow; the test `hart_ist_angehaengt_und_die_alten_ports_bleiben`
pins this). `lib.rs` needed no change. The plugin crate `baukasten` needed no change: it loads any graph. No other module
was touched.

## Design

**The problem.** A two-point PolyBLEP corrects a jump at time τ (0..1 samples after sample n) on both neighbouring
samples: sample n gets `h/2·(1−τ)²`, sample n+1 gets `−h/2·τ²` (h = jump height). For a natural wrap the oscillator
sees it coming (its own phase is near 1). For a sync reset the slave cannot: the master's wrap is reported on `zyklus` in
sample n+1, after sample n has left. So the old path applies only the second half.

**Announcement (master side).** Every oscillator computes its next phase in `weiter` anyway. It now also writes, in the
sample whose step crosses phase 1, the output **`hart` = 1 + τ**, τ in (0, 1] = `(1 − phase) / inc`, the time of the
wrap after the current sample. Otherwise `hart` = 0. This is the same wrap that `zyklus` reports one sample later
(`zyklus(n+1) = 1 + (1 − τ)`, test below). The phase step is computed exactly as before; `hart` is an extra value next
to it. Saw, pulse, triangle and sine share the phase arithmetic and announce identically. The sine announces forward
wraps only (a phase running backwards under FM announces nothing, as it reports no `zyklus` either).

**Slave side.** `saege`, `puls` and `dreieck` take an input **`hart`**. A value >= 1 means "reset at τ = hart − 1 after
this sample" (values above 2 count as τ = 1). In that sample the slave walks its phase through the interval:

1. from the current phase p to the phase at the reset, `p + τ·inc`: every natural edge on the way (saw wrap; pulse
   falling edge at the duty cycle b and rising edge at 1; triangle corners at 0.5 and 1) is an event;
2. the reset itself: jump `h = wert(0) − wert(p_r)` and, for the triangle, slope change `d = (−4 − slope(p_r))·inc`;
3. from phase 0 to `(1 − τ)·inc`: a narrow pulse can cross its falling edge already in this rest of the interval.

Every event at τ_e with height h and slope change d adds `h/2·(1−τ_e)² + d/6·(1−τ_e)³` to this sample and
`−h/2·τ_e² + d/6·τ_e³` to the next (`nach`). These are the polynomials of the existing `blep` and `blamp`, written as
residuals of one event; they add, so the order of the events does not matter. The next sample takes `nach` instead of
reading its post-halves off the phase (`nach_gilt`), because after a reset the phase no longer tells where the last
edge was. There is no latency: master and slave run in the same sample (topological order), so the slave reads the
announcement of the same sample.

**Fallback = bit identity.** When no reset is announced and the last interval held none, `saege_hart` and friends call
the unchanged `saege`, `puls`, `dreieck` (with `sync` 0). A node without a `hart` edge never calls them at all
(`hart: None` in the step). So every existing graph runs the old arithmetic; the only change on that path is that
`weiter` also writes `hart`, which reads `phase` and `inc` but does not change them.

**Rules.** `hart` takes edges only (a fixed `"hart"` value would reset in every sample: `Fehler::Wert`), and `hart` and
`sync` on the same node exclude each other (`Fehler::Wert`). The sine has no `hart` input (`UnbekannterPort`); it is a
master only. Any signal may feed `hart` (it is clamped); the intended source is a master's `hart` output. A master's
`zyklus` fed into `hart` would reset one sample late (it reports the wrap after the fact); an edge with
`"verzoegerung": 1` delays the announcement by one sample likewise.

**Real time.** No allocation, no lock, no table. Every input is clamped; a NaN `hart` counts as no reset, a NaN or
non-positive phase step on the hard sync path counts as a standing phase. Phase steps below 1e-20 (5e-16 Hz) count as
standing on the hard sync path, so a subnormal step cannot leave a subnormal phase there. The per-event state `nach`
lives for one sample and cannot become subnormal (argument in the code; unit test `kein_subnormaler_zustand_bei_langsamer_phase`).
The run arms branch on `hart` once per node and sample, not per voice.

### Ports and ranges

| | node | name | range | meaning |
|---|---|---|---|---|
| in | `saege`, `puls`, `dreieck` | `hart` | edge only; >= 1 = reset at τ = value − 1 (clamped to 0..1) after this sample, < 1 = none | band-limited hard sync |
| out | `saege`, `puls`, `dreieck`, `sinus` | `hart` | 0, or 1 + τ with τ in (0, 1] | announcement of the wrap in the coming interval |

No knob and no fixed value was added. The existing ports (`hz`, `pwm`, `fm`, `sync`, `aus`, `zyklus`) and their
meaning are unchanged.

### Examples (knob convention: every knob named, fed and audible; midpoint 0.5 is the default sound)

| graph | voices | sound | knobs |
|---|---|---|---|
| `hartsync-lead` | 1, glide 40 ms | the classic sync lead: saw master, saw slave swept down by its own envelope after every note, a little master in the mix, 4-pole low-pass, drive | 1 Cutoff (300..12000 log), 2 Resonance, 3 Sync pitch (0..24 st), 4 Sweep (0..36 st), 5 Sweep decay (0.05..2 s log), 6 Vibrato, 7 Drive (0..18 dB), 8 Release |
| `hartsync-pad` | 8 | slow sync pad: pulse slave with PWM, slave pitch moved by a 0.23 Hz triangle LFO, Juno chorus I+II | 1 Cutoff, 2 Resonance, 3 Sync pitch (0..19 st), 4 Sweep depth (0..12 st), 5 PWM depth, 6 Attack, 7 Release, 8 Chorus |
| `hartsync-bass` | 1 | sync bass with a "zap": **sine** master (heard as sub), triangle slave with a fast pitch envelope | 1 Cutoff (100..8000 log), 2 Resonance, 3 Sync pitch, 4 Zap (0..48 st), 5 Zap decay (0.01..0.5 s log), 6 Sub, 7 Drive, 8 Release |

Lint probe (`beispiele_konvention.rs`, default knobs): lead `peak 0.506 (-5.9 dB), rms -10.8 dB, dc -85.0 dBFS`; pad
`peak 0.563 (-5.0 dB), rms -17.9 dB, dc -124.6 dBFS`; bass `peak 0.564 (-5.0 dB), rms -10.7 dB, dc -89.7 dBFS`. All 24
new knobs change the sound on the probe; the smallest is bass knob 8 Release, `max |0 - 1| 0.325`. The pad first failed
the lint with DC -30.7 dBFS (the pulse with PWM has a mean of 2b − 1); it got a 25 Hz high-pass before the chorus. At
the knob ends (all 0, all 1, alternating) all three stay finite with peaks 0.01..1 (`beispiele_nutzen_hart_und_bleiben_an_den_reglerenden_endlich`).

## How it was proven

All tests go through the public JSON API (`uebersetze`, `Programm`), except the unit tests in `src/osz.rs`.

### 1. Existing outputs bit-identical when hard sync is off

Two proofs.

**(a) Fingerprints taken before the change.** `tests/hartsync_bitgleich.rs` was written and its table filled on the
unchanged code, then committed on its own (`be71b12`, before the implementation commit). It renders 75 programs and
hashes every output bit (FNV-1a over `f32::to_bits` of both sides):
- all 27 example graphs that existed then, each at default knobs and with all knobs at 1 (54 renders; four notes from
  A1 to A7, a four-note chord, a tail; effect graphs get a deterministic noise-plus-saw input; the sampler and spring
  examples get their generated probes);
- `saege`, `puls` (pwm on an LFO), `dreieck`, `sinus` free on note pitches, with `aus` on the left and `zyklus` on the
  right, and the sine with FM through zero;
- the old `sync` input from every master type to every slave type (16 graphs), master audible as well.

After the change all 75 fingerprints are equal (`bestehende_graphen_bitgleich_wie_vor_dem_hard_sync`). Mutation B2
shows how sharp this is: rewriting the phase step as `(phase + inc/2) + inc/2`, the same value in exact arithmetic,
breaks 34 of the 75.

**(b) A quiet `hart` edge is the old path too.** A slave with a `hart` edge from a master that never wraps (hz 0) plays
bit for bit like the same slave without the edge, with note pitches up to C8 and moving pwm, on `aus`, `zyklus` and
`hart` (`ohne_umlauf_des_leiters_bitgleich_wie_ohne_kante`).

### 2. The reset happens at the exact sub-sample position

**Announcement.** For each of the four oscillators at 1234.567 Hz over 1 s: `hart(n) >= 1` exactly when
`zyklus(n+1) >= 1`, and `τ_hart = 1 − d_zyklus` within **1.4e-6 samples** (limit 1e-5); all four announce identically.

**Read back from the outputs** (`ruecksetzen_an_der_genauen_unterabtast_stelle`). A saw sample further than one sample
from any jump carries no correction, so its phase is `(y + 1) / 2`. The test finds each master wrap from the master's
output (the drop of more than 1 marks the interval of the jump; the sample before it is clean), computes its time from
the clean sample and the phase step, and computes the slave's reset time from the slave's clean sample two samples
later (`t = n + 1 − (phase − inc(n+1)) / inc(n)`). Slave pitch swept, three masters:

| master | slave | resets checked | largest |t_slave − t_master| |
|---|---|---|---|
| 441.3 Hz | 450 .. 2000 Hz | 869 | **4.5e-6 samples** |
| 97.1 Hz | 120 .. 430 Hz | 194 | 8.4e-6 samples |
| 1501.7 Hz | 1600 .. 4300 Hz | 2810 | 9.9e-7 samples |

Limit 1e-4 samples (f32 phases near 1 resolve 6e-8 of a period; divided by a phase step of 0.009 that is 7e-6 samples).
Unit test: after a reset at τ the phase is `(1 − τ)·inc` within 1e-7.

**Against an independent reference** (`folger_trifft_die_unabhaengige_referenz`). The test re-implements the slave from
the definition in f64: per interval it walks the phase to the reset the master announced and on, takes every
discontinuity's height and slope change from the naive waveform left and right of it, and applies the two-point
PolyBLEP / PolyBLAMP to both neighbouring samples. Slave swept 1x..9x over 1 s, 441 resets: largest difference saw
**5.6e-5**, pulse 30 % 7.0e-5, pulse 5 % 6.8e-5, triangle 5.2e-6 (limit 2e-4; sample 0 is left out, see open point 7).
This test catches wrong heights, missing halves, missing edges and a missing PolyBLAMP in one go (H5, H6, H8, B3).

### 3. Aliasing of a sync sweep

Method (`alias_db`): master saw at `f0 = sr / (n + 0.382)`, so the first three folds of every harmonic land 0.382, 0.236
and 0.146 of f0 away from the nearest harmonic, never on one. Frames of 32768 samples (0.68 s), hop half a frame,
4-term Blackman-Harris window (-92 dB sidelobes). Bins within +-17.6 Hz of a multiple of f0 count as harmonic; the rest
below the band edge is alias energy, given relative to the frame's total energy; the worst frame counts. The bound is
stated **below 5 kHz**: there the inharmonic aliases of a sync sweep are heard as "birdies". The full band is printed as
well (below).

**Stepped sweep** (`sync_fahrt_in_stufen_aliasing_unter_der_grenze`): slave 1x..8x the master in 1/24-octave steps (73
ratios), each settled 2000 samples, one frame each; worst ratio:

| slave | master | hart, below 5 kHz | old `sync` | limit | hart, full band | old, full band |
|---|---|---|---|---|---|---|
| saw | 110 Hz | **-70.7 dB** | -34.4 | -58 | -32.4 | -25.9 |
| pulse 23 % | 110 Hz | **-72.1** | -39.7 | -58 | -34.4 | -30.5 |
| triangle | 110 Hz | **-80.9** | -39.4 | -70 | -41.7 | -30.5 |
| saw | 438.8 Hz | **-61.4** | -30.8 | -58 | -24.4 | -21.2 |
| pulse 23 % | 438.8 Hz | **-61.5** | -36.0 | -58 | -26.0 | -24.4 |
| triangle | 438.8 Hz | **-74.3** | -32.5 | -70 | -35.2 | -23.9 |
| saw | 1753 Hz | **-53.2** | -19.7 | -50 | -12.8 | -10.1 |
| pulse 23 % | 1753 Hz | **-57.0** | -24.2 | -50 | -13.8 | -12.2 |
| triangle | 1753 Hz | **-65.0** | -22.5 | -62 | -23.8 | -14.5 |

Also required: at least 10 dB below the old sync in every row (measured 26 to 42 dB).

**Continuous sweep** (`sync_fahrt_aliasing_unter_der_grenze`): the slave pitch glides exponentially 1x..8x in 16 s, a
new pitch every sample. While the slave pitch moves, the jumps inside the master period move in time, which smears the
high harmonics a little beyond the +-17.6 Hz; that is a floor of the measurement (the stepped sweep shows the same
oscillator 18 dB lower at 110 Hz), so the bound is looser. Below 5 kHz, worst frame:

| master | saw hart / old / naive | pulse hart / old | triangle hart / old |
|---|---|---|---|
| 110 Hz | **-52.0** / -39.7 / -27.4 dB | **-56.3** / -44.0 | **-80.2** / -39.4 |
| 438.8 Hz | **-55.9** / -31.1 / -18.5 | **-61.0** / -36.2 | **-74.5** / -33.1 |
| 1753 Hz | **-53.9** / -21.3 / -12.2 | **-58.4** / -26.0 | **-67.7** / -24.8 |

Limits: saw and pulse -48 dB, triangle -60 dB, and 10 dB below the old sync (measured 12.3 to 42.9 dB; the smallest
margin is the saw at 110 Hz). "naive" is the same sweep without any band limiting (f64 phases, exact reset), for scale.

**Narrow pulse** (`schmaler_puls_kreuzt_die_flanke_nach_dem_ruecksetzen`): 5 % duty, master 1753 Hz, continuous sweep:
**-59.2 dB** below 5 kHz against -28.2 for the old sync (limit -48 and 10 dB below the old). Without step 3 of the
design (mutation H7) it is -29.2 dB.

**The full band.** Above 5 kHz the two-point PolyBLEP of the oscillator itself sets the floor: its residual images near
Nyquist fold back near Nyquist. The full-band numbers (-13 to -42 dB) are therefore close to the old sync and are not
bounded here; they are a property of the oscillators' existing PolyBLEP (open point 2).

### 4. Robustness

- +-inf, 1e30 and NaN on both pitches, the pwm and directly on `hart` (from two knobs over +-1e30 and a multiply by 0):
  finite output, `rettungen` 0 (`unsinnige_eingaenge_bleiben_endlich`). Unit test: NaN, +-inf, -1, 1, 1.5, 2, 7, 1e30 on
  `hart` with steps 0..0.5 and inf, finite.
- Subnormals: steps 1e-12, 3e-16, 1e-19, 1e-30 and the subnormal 1e-40, resets 1.2e-7 / 1e-5 / 0.5 after the sample,
  all three waveforms: no subnormal in output, phase, `nach` or `hart` (red without the standing-phase rule, D1).
- Range: in a sync sweep at a 1753 Hz master the peaks are saw 0.966, pulse 1.000, triangle 0.964 (limit 1.5).
- `zuruecksetzen` == fresh for saw, pulse and triangle slaves (`arten.rs`), no allocation on the run path for
  `HARTSYNC_1` (four voices, three slaves, slave pitch and pwm on knobs) and the three examples (`keine_allokation.rs`).

### Mutations

Each mutation is applied to a copy of the workspace, the named test is run in release and the change is reverted
(`python3 mutation_hartsync.py <copy of djk/instrumente> [ID ...]`). **All 17 are red**, in a full run on the final
code.

| id | mutation | test | red output |
|---|---|---|---|
| H1 | post-half of the corrections dropped | `sync_fahrt_in_stufen_aliasing_unter_der_grenze` | `saege at 110.0 Hz: -39.1 dB at ratio 2.00 above -58` |
| H2 | pre-half of the corrections dropped | same | `saege at 110.0 Hz: -38.9 dB at ratio 4.00 above -58` |
| H3 | reset at the start of the interval (τ ignored) | `ruecksetzen_an_der_genauen_unterabtast_stelle` | `reset 0.989 samples away from the master's wrap, limit 0.0001` |
| H4 | master announces 1 − τ instead of τ | same | `reset 0.981 samples away from the master's wrap` |
| H5 | jump height from the phase at the sample, not at the reset | `folger_trifft_die_unabhaengige_referenz` | `saege pwm 0: 0.632 at sample 24147, limit 0.0002` |
| H6 | triangle: no PolyBLAMP for the slope change at the reset | same | `dreieck pwm 0: 0.106 at sample 47641` |
| H7 | narrow pulse: edge right after the reset not corrected | `schmaler_puls_kreuzt_die_flanke_nach_dem_ruecksetzen` | `narrow pulse: hart -29.2 dB, old -28.2 dB` |
| H8 | natural edges before the reset not corrected | `folger_trifft_die_unabhaengige_referenz` | `saege pwm 0: 0.727 at sample 35241` |
| H9 | after a reset the post-halves read off the phase | `sync_fahrt_in_stufen_aliasing_unter_der_grenze` | `saege at 110.0 Hz: -39.6 dB at ratio 5.04 above -58` |
| B1 | hard sync path also without a reset (no fallback) | `ohne_umlauf_des_leiters_bitgleich_wie_ohne_kante` | `saege: 1867 samples differ with a quiet hart edge` |
| B2 | old phase step rewritten, same value in exact arithmetic | `hartsync_bitgleich` | `34 of 75 graphs are no longer bit-identical: ["bassmusik@0.5", ..., "lead@0.5", ...]` |
| B3 | the slave feeds `hart` into the old half-sided `sync` path | `folger_trifft_die_unabhaengige_referenz` | `saege pwm 0: 1.93 at sample 10942` |
| D1 | very slow phase steps not treated as standing | unit `kein_subnormaler_zustand_bei_langsamer_phase` | `form 0 inc 1e-40 ... sample 0: subnormal or non-finite state 1e-40` |
| R1 | `hart` and `sync` allowed together | `hart_nimmt_nur_kanten_und_schliesst_sync_aus` | `assertion failed: matches!(uebersetze(&beide, SR), Err(Fehler::Wert { .. }) ...)` |
| R2 | a fixed `hart` value accepted | same | `None` (no error returned) |
| Z1 | `zuruecksetzen` leaves the oscillators | `arten.rs zuruecksetzen_gleich_frisch_hartsync` | `hard sync: 24000 samples differ after zuruecksetzen` |
| A1 | one allocation in the hard sync path | `keine_allokation.rs echtzeitpfad_allokiert_nicht` | `Echtzeitpfad hat Speicher angefordert: hartsync-1` |

A first subnormal test (triangle only, flush of `nach` as a guard) stayed **green** under two mutations: the triangle's
reset height is never tiny, and the flush could not fire at all. On f32 a jump height is 0 or at least an ulp of the
waveform and a triangle corner lies at least 3e-8 of phase after the sample, so with steps >= 1e-20 `nach` cannot be
subnormal. The flush was removed as dead code, the test now covers all three waveforms and a subnormal step, and the
remaining guard (D1) is red.

## Cost

`cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture --test-threads=1 kosten_hartsync`.
All 16 voices sound (one note per voice, notes 40..55). The block period is 1333 / 2667 / 5333 us for blocks of
64 / 128 / 256. The host was a 4-core cloud VM, not at rest (load average 0.9 to 4, the mutation copy building in
between); the histogram has 5 us bins and tops out at 1280 us.

**The bare pair** (note, master saw, `transponiere` +7.31 st, slave saw, output; 16 voices): best of 7 runs of 1 s,
whole graph, ns per voice and sample, in five runs:

| graph | normal pitch (82..200 Hz master) | master +60 st (2.6..6.4 kHz, a reset every 2 to 5 samples) |
|---|---|---|
| slave on `hart` | 10.0 / 12.9 / 10.9 / 12.1 / 10.6 | 26.1 / 23.7 / 28.9 |
| slave on the old `sync` | 10.0 / 12.6 / 9.8 / 12.1 / 10.2 | 23.9 / 24.8 / 26.7 |
| slave free (no sync) | 10.5 / 12.9 / 9.8 / 12.0 / 9.9 | 24.3 / 24.5 / 19.1 |

At normal pitches hard sync costs nothing measurable (within +-1 ns of the old sync and of the free slave). With a reset
every few samples it costs about 0 to 2 ns per voice and sample more than the old sync, inside the run-to-run spread of
this host. Histogram at 256: all three pairs p50 40..55 us (1 % of the period), p99 75..135 us.

**`hartsync-lead` at 16 voices** (the example is mono; 16 voices is the stress case), p50 / p99 in us:

| graph | 64 | 128 | 256 |
|---|---|---|---|
| `hartsync-lead` x16 | 130 / 180..345 | 260 / 470..510 | **525..530 / 900..1105** |
| same with the old `sync` edge | 130 / 240..285 | 255 / 440..445 | 510..525 / 940..990 |
| same without sync | 130 / 245 | 260..265 / 470..495 | 530 / 1060..1200 |
| old `lead.json` x16 (old sync) | 130..135 / 220..335 | 265..270 / 475..525 | 530 / 1125..1230 |

Reading: **16 voices of the sync lead cost about 530 us per 256-sample block, 10 % of the period at p50 and about 20 %
at p99**, the same as the old lead; the hard sync share is not measurable at this resolution. Not gated.

A finding on the way: the first lead measured 900 us at 256. Its sweep envelope had sustain 0, and `adsr` decays towards
sustain 0 without a snap, so a held note runs the envelope (and everything downstream) on subnormals. The examples now
use sustain 0.001 (-60 dB of the sweep, 0.036 st); `adsr.rs` was not changed (open point 5).

## Workspace

`cargo test --workspace --release` in `djk/instrumente`, run after the implementation and again on the final code:
**101 test groups, 597 passed, 0 failed, 10 ignored** both times (the ignored ones are the cost runs and other runs on
request). The convention lint (`beispiele_konvention.rs`) covers the three new graphs.

## Open

1. **Not heard.** The sweep shapes, the example levels and the claim "birdies below 5 kHz are what one hears" are
   numbers and textbook reasoning, not ear judgements.
2. **Full-band floor of the two-point PolyBLEP.** Above about 10 kHz the oscillators alias as much as before (full band
   -13 dB at a 1.75 kHz master and an 8x slave). A wider kernel (four-point PolyBLEP or a minBLEP table) would need the
   announcement two samples ahead (not exact under pitch modulation) or a causal minBLEP with a few samples of state per
   voice, and it would have to cover the natural edges as well to help; with natural edges on the old two-point code,
   the old graphs would no longer be bit-identical. Not in this slice.
3. **Sine as slave.** The sine has `hart` as output only. A synced sine needs a BLEP for the value jump and a BLAMP for
   the slope jump, and its phase can run backwards under FM. Not done.
4. **`lead.json` still uses the old `sync`.** Moving it to `hart` changes an existing graph and its sound (cleaner), so
   it is a decision for Andreas, not part of this slice. The old input stays as it is.
5. **`adsr` decay towards sustain 0 ends in subnormals** while the note holds (Release snaps below 1e-6, Decay does not).
   Found by the cost run; other module, so not changed here. Examples with sustain 0 elsewhere may pay for it.
6. **A reset is not a cycle of the slave.** The slave's `zyklus` and `hart` report its own natural wraps only, also on
   the hard sync path (as the old sync does). Chains of syncs therefore follow the slave's own wraps.
7. **Start at phase 0.** All oscillators start at phase 0, which the old code reads as a wrap exactly on sample 0 (it
   outputs 0 instead of -1 for the saw). Unchanged for bit identity; the reference test leaves sample 0 out.
8. The wavetable and the LFO have no `hart` output; a wavetable slave would need its own band-limited reset.
9. **Cost** on a loaded host; a rest measurement under the real-time lock (`djk/konfig/echtzeit_schloss.sh`) is still to
   do. The C++ side, the page and the kern were not built or run; no code there names oscillator ports.
10. `docs/architecture/stand/baukasten-s2.md` lists the oscillator ports as of slice 2 and was not edited (a stand
    document of that slice); the `hart` ports are documented here.

## Review on the receiving side (2026-11-02)

Merged after saite. No new type number: hard sync extends the existing oscillators. Whole workspace on x86_64,
release build: 106 test binaries ok, 0 failures, `hartsync_bitgleich` among them (every existing graph unchanged).
The cost file needed a manual merge: main's version plus `kosten_hartsync` verbatim from the branch. Own mutations of
`src/osz.rs`: reset time ignored (unit test red), the jump without its BLEP residual (five tests red, the reference and
both aliasing sweeps among them), the slope change without its BLAMP residual (three red). Open: the listening test by
the product owner.
