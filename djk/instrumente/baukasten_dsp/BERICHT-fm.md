# Baukasten: multi-operator FM synthesis (type 35)

STATUS: built and verified on branch `claude/fm-synthesis-module-type-33-18g8ki` (2026-11-02), merged into main the same day after review; nothing
installed, not heard. All numbers are measurements on synthetic signals in a cloud container (48 kHz unless stated).

## Why

FM bass, FM lead, bells and the electric piano need several sine operators per voice that modulate each other's phase,
each with its own envelope. With the existing `sinus` node (linear FM through its `fm` input) this costs six nodes,
six envelopes and a dozen helper nodes per voice, has no feedback operator and no protection against aliasing at high
index. The new block `fm` does all of it in one node.

## What was built

| file | change |
|---|---|
| `src/fm.rs` (new) | operators, algorithms, feedback, envelopes, alias guard, value check, unit tests |
| `src/uebersetzen.rs` | `ARTEN` entry 33 `fm` (appended), one value-check arm, build arm |
| `src/programm.rs` | step `Schritt::Fm` (voices boxed), run arm, reset arm |
| `src/lib.rs` | `pub mod fm` |
| `beispiele/fm-bass.json`, `fm-epiano.json`, `fm-glocke.json`, `fm-lead.json` (new) | examples |
| `tests/fm.rs` (new) | 16 tests: io, value checks, pitch, Bessel sidebands, index scaling, feedback, aliasing, trees, envelopes, routing, determinism, robustness, output bound |
| `tests/arten.rs` | minimal graph for `fm` (reset == fresh), type 35 pinned (merge order) |
| `tests/keine_allokation.rs` | `FM_1` (six-op stack, index/feedback/decay on knobs, pitch on an LFO) and the four examples |
| `tests/kosten_messung.rs` | the examples in the cost run, new `kosten_fm` |
| `mutation_fm.py` (new) | the mutation runs of this report |

No existing module was changed in behaviour. The plugin crate `baukasten` needed no change (it loads any graph; the
block uses no file).

## Design

**Operators.** Six per voice. Operator `o` runs at `hz * verh_o * 2^(fein_o / 1200)` on a u32 phase accumulator.
Its unit output is `u_o = env_o * sin(phi_o + m_o)` with `m_o` the phase modulation in radians (the usual phase
modulation form of "FM"). As a modulator, operator `j` adds `I_j * u_j` to its target with the peak index
`I_j = pegel_j * 4 pi * index * velocity factor`. As a carrier it adds `pegel_o * u_o` to the output; the carrier sum is
divided by the number of carriers of the algorithm, so `|aus| <= 1` for every setting. The sine is an odd Taylor
polynomial to x^11 on a quarter wave (error < 3e-7, unit test).

**Algorithms (`algo`).** A modulator always has a higher number than its target, so a voice is computed in one pass
from operator 6 down to 1 without delay. 0..7 use operators 1..4, 8..15 use all six. `a>b` means a modulates b.

| algo | routing | carriers | typical use |
|---|---|---|---|
| 0 | 4>3>2>1 | 1 | lead, bass, brass |
| 1 | (4+3)>2>1 | 1 | bright lead |
| 2 | 4>3>1, 2>1 | 1 | bass (two modulators on one carrier) |
| 3 | 2>1, 4>3 | 1, 3 | electric piano (body pair + tine pair) |
| 4 | (4+3+2)>1 | 1 | complex single carrier |
| 5 | 4>(3,2,1) | 1, 2, 3 | one modulator on three carriers (organ-like) |
| 6 | 4>3>2, 1 | 1, 2 | stack plus a pure sine |
| 7 | 1, 2, 3, 4 | all | additive |
| 8 | 6>5>4>3>2>1 | 1 | deep stack |
| 9 | 3>2>1, 6>5>4 | 1, 4 | two stacks (brass, strings) |
| 10 | 2>1, 4>3, 6>5 | 1, 3, 5 | three pairs (bells, piano) |
| 11 | 2>1, 6>5>4>3 | 1, 3 | pair plus a stack of four (electric piano) |
| 12 | 2>1, (6+5+4)>3 | 1, 3 | pair plus three into one |
| 13 | 2>1, 6>(5,4,3) | 1, 3, 4, 5 | pair plus one modulator on three |
| 14 | 6>5>4, 3, 2, 1 | 1, 2, 3, 4 | stack plus three sines (organ with a lead voice) |
| 15 | 1, 2, 3, 4, 5, 6 | all | additive |

**Feedback.** The top operator of every algorithm (4 or 6; it has no modulators) modulates itself with
`beta * (u[n-1] + u[n-2]) / 2`, `beta = rueck * 1.5`. Averaging the last two samples is what makes high feedback
stable: in the prototype, the plain one-sample loop broke into noise at beta 1.3 (energy between the harmonics -7.5 dB),
the averaged loop stayed periodic up to beta 1.5 (-89 dB at 74 Hz) and fell apart above 2 (-53 dB at 2.0, -7 dB at
2.5). Hence `FB_MAX = 1.5`. At full feedback the operator is saw-like (measured values below).

**Envelopes.** One ADSR per operator with the semantics of `adsr.rs` (attack linear from the current value, decay and
release exponential, time to -60 dB), but its own copy: it snaps to the target when the remaining distance is below
1e-6 or f32 rounding stops the step, so a decay to sustain 0 never runs into subnormals (`adsr.rs` decays toward 0
without a snap; it was not touched). The coefficients are computed per voice only when the `zeit` input changes.

**Phase sync.** With `sync` 1 (default) a trig restarts all operator phases and clears the feedback memory, so every
strike of a note starts alike (the classic key sync). With `sync` 0 the operators run free.

### Alias bound and how it is kept

**Bound:** alias energy below 20 kHz at most **-70 dB** of the total, for every algorithm with every operator at level
1, `index` 2 (twice the nominal index, 25 rad per link) and full feedback, pitches 20 Hz .. 4 kHz, at 48 kHz.
**Measured worst: -82.6 dB** (algorithm 8, all ratios 1, at 3.2 kHz). Without the guard the same sweep measures up to
-10 dB (mutation A1).

**How.** Nothing is oversampled. A guard keeps every operator's spectrum below `G = max(sr - 20 kHz, sr / 2)` (28 kHz
at 48 kHz), so whatever folds at Nyquist lands above 20 kHz:

1. An operator whose own frequency reaches `sr / 2` is muted.
2. The feedback is limited per pitch (`FB_GRENZE`, a table over half octaves measured on the feedback operator alone so
   that its alias stays under -90 dB; e.g. 1.5 up to 128 Hz, 1.08 at 1 kHz, 0.34 at 4 kHz, 0 at 16 kHz). When the
   feedback operator modulates, its -80 dB tail (`FB_SCHWANZ`, measured, in multiples of its pitch) must also stay below
   `G / 2`.
3. For each operator the guard estimates, from the top down, `tempo` = the highest instantaneous frequency of its
   output (`f + sum I_j * tempo_j`, an exact bound; for the feedback operator `f / (1 - beta)` up to beta 0.9 plus
   `4 kHz * (beta - 0.9)` above, which covers the measured maxima) and its spectral reach
   `f + sum reichweite(I_j) * tempo_j`, plus the modulator's tail once an index above 1 lifts it (ramped in from I = 1 to
   3). `reichweite(I) = min(1 + 40 I, 2 + 8 I, 5.5 + 1.3 I)` (0 below 1e-4) bounds the highest sideband order of a sine
   modulator with index I beyond which the sideband power is under -80 dB; the unit test checks it against Bessel
   functions for I = 1e-4 .. 26.
4. If a reach passes `G`, the guard scales down the indices of that **modulation tree** (operators linked directly or
   through others; `baeume`) together: it finds by bisection (14 steps) the largest index product
   `q = index * velocity factor` that passes and clamps `q` to it. Inside a tree this acts like turning the `index` knob
   down; independent trees (e.g. the pairs of algorithm 10) are limited separately.
5. The guard uses the peak indices (envelopes at 1), so it does not move with the envelopes. It is computed for the
   top of a pitch band of +-2 % and runs again only when the pitch leaves the band or the feedback input crosses a 1/64
   step (rounded up), so vibrato and glides do not run the search every sample.

Two earlier designs were measured and dropped: a per-link limit that treated the feedback operator as a sine (-10 dB
worst, mutation A3) and one without modulator tails (-57 dB in deep stacks at low pitch; mutation A2). A first strict
model then cut whole links (a moderate 4-stack at A2 lost its last link); a reference run at 4x the sample rate showed
that this stack really reaches 46 kHz at -60 dB, so the limit was right but its distribution was wrong, which led to
the uniform scale per tree.

**What the guard does to sounds** (effective index product, 1 = as set; 4-stack: all modulators 0.3, feedback 0.5):

| pitch | 4-stack (algo 0) | e-piano body pair / tine pair (ratio 14) | bell pairs 2>1 / 4>3 / 6>5 |
|---|---|---|---|
| 110 Hz | 0.59 | 1 / 1 | 1 / 1 / 1 |
| 220 Hz | 0.44 | 1 / 1 | |
| 440 Hz | 0.33 | 1 / 0.67 | 1 / 1 / 1 |
| 880 Hz | 0.27 | 1 / 0.07 | 0.59 / 0.22 / 1 |
| 1.76 kHz | 0.17 | 1 / tine above Nyquist, muted | 0.07 / 0.04 / 1 |

High notes lose brightness: the guard trades aliasing for timbre. A real DX-style instrument keeps the bright aliasing
tine; here a ratio-14 tine is nearly gone at A5 (880 Hz).

### Ports and values

| | name | range | default | meaning |
|---|---|---|---|---|
| in | `hz` | 0 .. sr/2 | 0 | pitch |
| in | `gate` | > 0.5 = on | 1 | envelopes: rising edge starts, falling edge releases |
| in | `trig` | > 0.5 = strike | 0 | restart envelopes (and phases with `sync`) |
| in | `vel` | 0..1 | 1 | velocity |
| in | `index` | 0..2 | 1 | factor on every modulator index ("brightness") |
| in | `rueck` | 0..1 | 0 | feedback of the top operator (x 1.5 rad) |
| in | `zeit` | 0.05..20 | 1 | factor on every decay and release time |
| value | `algo` | integer 0..15 | 0 | algorithm (table above) |
| value | `anschlag` | 0..1 | 0 | velocity sensitivity of the indices: factor `1 - anschlag (1 - vel)` |
| value | `sync` | 0 or 1 | 1 | trig restarts the operator phases |
| value | `o1_verh` .. `o6_verh` | 1/32 .. 32 | 1 | ratio (any real number, e.g. 3.5 or 1.41) |
| value | `o1_fein` .. `o6_fein` | -100 .. 100 cent | 0 | fine detune |
| value | `o1_pegel` .. `o6_pegel` | 0..1 | 1 for o1, 0 else | carrier: output level; modulator: index / 4 pi |
| value | `oN_a`, `oN_d`, `oN_s`, `oN_r` | 0..20 s, 0.001..60 s, 0..1, 0.001..60 s | 0.001, 1, 1, 0.1 | operator envelope |
| out | `aus` | -1..1 | | carrier sum / number of carriers |

Values outside their range are a `Fehler::Wert`; inputs are checked for being finite (NaN and inf read as the
default) and clamped at run time. Operators 5 and 6 are ignored by algorithms 0..7.

### Examples (every knob named, fed and audible; midpoint 0.5 is the default sound)

| graph | voices | algorithm | knobs |
|---|---|---|---|
| `fm-bass` | 2 | 2: 4>3>1, 2>1, feedback on 4, plucked modulator envelopes, velocity 0.6 | 1 Brightness (index 0..2), 2 Feedback, 3 Decay (zeit 0.2..5 log), 4 Drive (saett 0..12 dB) |
| `fm-epiano` | 8 | 3: body pair 1:1 plus tine pair 1:14 (fast tine decay), carriers decay to 0, chorus | 1 Brightness, 2 Decay (0.25..4 log), 3 Tremolo (LFO 4.5 Hz depth), 4 Chorus (mix) |
| `fm-glocke` | 8 | 10: pairs 1:3.5, 2:5.19, 0.5:1.41 (inharmonic), long decays, hall | 1 Brightness, 2 Decay, 3 Feedback, 4 Hall (mix 0..0.6) |
| `fm-lead` | 1 | 0: 4-stack with feedback, glide, vibrato, ping-pong echo | 1 Brightness, 2 Feedback, 3 Vibrato (0..0.6 st), 4 Decay, 5 Echo (mix) |

Lint probe (`beispiele_konvention.rs`, default knobs): bass `peak 0.773 (-2.2 dB), rms -11.1 dB, dc -180 dBFS`;
e-piano `peak 0.769 (-2.3 dB), rms -24.1 dB, dc -70.7 dBFS`; bell `peak 0.679 (-3.4 dB), rms -21.5 dB, dc -71.8 dBFS`;
lead `peak 0.484 (-6.3 dB), rms -15.2 dB, dc -72.0 dBFS`. Bass (0.45) and e-piano (0.5) first peaked at 0.97 and 1.48
and got lower output trims (0.36, 0.26). The knob sweep of the lint (`jeder_regler_aendert_den_klang_auf_der_probe`)
passes for all 17 new knobs.

## How it was proven

All tests go through the public JSON API (`uebersetze`, `Programm`), except the unit tests in `src/fm.rs` and the tree
test, which reads the guard's limit from `fm::Stimme`.

**Line measurement.** `f0 = sr * m / 65536` with odd `m` and integer ratios: every phase step is an exact multiple of
2^16, the output repeats after exactly 65536 samples, and a rectangular-window FFT sees pure lines on the bins `k * m`.
Anything on other bins is alias, hunting or non-periodicity.

### Pitch

`tonhoehe_mit_verhaeltnis_und_feinverstimmung_auf_hundertstel_cent`: operator 1 alone at ratios 1, 0.5, 3.5 (+7 c),
2 (-33 c), 7 (+100 c), pitches 27.5 .. 1760 Hz, at 44.1, 48 and 96 kHz (72 cases, rising zero crossings over 1 s).
**Worst error 0.0017 cent**, bound 0.01 cent.

### Sidebands and Bessel amplitudes

`seitenbaender_liegen_bei_c_plus_k_m_mit_bessel_amplituden`: one modulator on one carrier (algorithm 4), f0 = 24.2 Hz.
Expected line at harmonic h: the sum of `J_k(I)` over the sidebands `c + k m = h`, minus those with `c + k m = -h`
(reflected lower sidebands, sign flipped). Bessel values by the trapezoid rule on the integral form. **Tolerance 1e-4
(re the unmodulated carrier = -80 dB), measured:**

| c : m | I | largest line error | largest bin off the lines | example lines (measured / J) |
|---|---|---|---|---|
| 8 : 1 | 2 | 4.3e-8 | 4.4e-9 | c 0.22389 / 0.22389, c+m 0.57672 / 0.57672 |
| 8 : 1 | 5 | 8.2e-8 | 1.1e-8 | c 0.17760 / 0.17760, c+2m 0.04657 / 0.04657 |
| 1 : 3 | 1.5 | 2.1e-8 | 3.0e-9 | with reflected lower sidebands |
| 2 : 5 | 2.4048 | 7.1e-8 | 5.6e-9 | carrier at the zero of J0: 1.3e-5 (J0(2.4048) = 1.3e-5) |
| 3 : 2 | 0.3 | 1.9e-8 | 1.4e-9 | c+3m 0.00056 / 0.00056 |
| 5 : 7 | 8 | 1.2e-7 | 1.9e-5 | |

`index_eingang_und_anschlag_skalieren_den_index`: index input 0.5, or velocity 0.5 with `anschlag` 1, give J1(I/2)
exactly (0.55794 measured and expected for I = 3).

### Feedback stability

`rueckkopplung_bleibt_periodisch_und_wird_heller`: the feedback operator alone at 47 Hz (its own alias there is
below -110 dB, so any energy between the harmonics is hunting or chaos). **Bound -80 dB, measured:**

| rueck | beta | between harmonics | energy above the fundamental | h2 / h5 / h10 (re 1/4) |
|---|---|---|---|---|
| 0 | 0 | -148.4 dB | 0.000 | 0 |
| 0.2 | 0.30 | -144.6 dB | 0.022 | 0.036 / 0.0006 / 0 |
| 0.4 | 0.60 | -143.6 dB | 0.087 | 0.066 / 0.007 / 0.0006 |
| 0.6 | 0.90 | -142.4 dB | 0.184 | 0.085 / 0.021 / 0.007 |
| 0.8 | 1.20 | -140.3 dB | 0.268 | 0.089 / 0.030 / 0.013 |
| 0.9 | 1.35 | -120.3 dB | 0.291 | 0.087 / 0.030 / 0.014 |
| 1.0 | 1.50 | **-94.9 dB** | 0.307 | 0.085 / 0.030 / 0.014 |

Brightness rises with every step; the peak stays at 0.25 (one of four carriers). The amplitude cannot blow up (a sine
is bounded); "unstable" here means hunting or chaos, which the averaging keeps away up to `FB_MAX`.

`rueckkopplung_allein_unter_minus_80_db_alias`: the same operator at full feedback, 20 Hz .. 10 kHz in third octaves:
worst **-88.9 dB at 1281 Hz** (bound -80 dB), e.g. -115.8 dB at 25.6 Hz, -91.0 dB at 320 Hz, -90.2 dB at 1016 Hz,
-91.9 dB at 4064 Hz, -92.8 dB at 8128 Hz.

### Aliasing at high index

`alle_algorithmen_bei_hoechstem_index_unter_der_aliasgrenze`: all 16 algorithms, every operator at level 1, index 2,
feedback 1, ratio sets (1,1,1,1,1,1), (1,2,3,4,5,6) and (1,14,1,1,3,1), pitches 20 Hz .. 4 kHz in 2/3-octave steps
(48 runs x 11 pitches). Worst per algorithm (dB): 0: -92.2, 1: -93.8, 2: -99.7, 3: -87.2, 4: -108.2, 5: -90.8,
6: -86.6, 7: -95.5, **8: -82.6**, 9: -93.1, 10: -87.4, 11: -89.3, 12: -87.5, 13: -91.1, 14: -98.5, 15: -96.2.
Bound -70 dB.

`baeume_werden_getrennt_begrenzt`: algorithm 3 at 880 Hz with the e-piano levels: the body pair's limit is 2 (none),
the tine pair's 0.066; the body pair's output is bit-identical with and without the tine.

### Envelopes, routing, determinism, robustness

- Carrier decay 0.5 s to -60 dB: -40 dB reached after 0.340 s (expected 0.333; the measure uses 10 ms windows); with
  `zeit` 2: 0.670 s. Release 0.3 s: 0.310 s, then exactly 0.
- Modulator envelope (algorithm 4, modulator 1 s decay to 0, carrier sustained): sideband share of the energy 0.234 in
  the first 1.4 s, 4e-16 after 3.4 s (the carrier is a pure sine once the modulator's envelope has snapped to 0).
- `nur_traeger_sind_zu_hoeren`: in every algorithm each operator alone is heard exactly when it is a carrier, at
  1 / number of carriers (error < 1e-3). `modulatoren_wirken_auf_ihre_ziele`: every link of every algorithm into a
  carrier changes the sound; a modulator without a carrier path does not.
- Two loads of the same graph are bit-identical; with `sync` the first and third strike of a note start identically
  (difference 0), without `sync` they differ (up to 2.0).
- +-inf, huge values and NaN on all seven inputs at once: finite output, `|aus| <= 1`, `rettungen` 0. All algorithms at
  maximum with coherent carriers: `|aus| <= 1` per voice.
- `zuruecksetzen` gives the same samples as a fresh load (`arten.rs`); no allocation in the audio path for `FM_1` and
  the four examples (`keine_allokation.rs`).

### Mutations

Each mutation is applied to a copy of the workspace, the named test is run in release and the change is reverted
(`python3 mutation_fm.py <copy of djk/instrumente> [ID ...]`).

**27 mutations, 25 red, 2 green (both explained below).** Run on the final code; S2, F2 and D2 after the test fixes
described below.

| id | mutation | test | red output |
|---|---|---|---|
| P1 | fine detune in 1/1000 octave instead of cent | `tonhoehe_mit_verhaeltnis_und_feinverstimmung...` | `pitch error 19.99994 cent, limit 0.01` |
| P2 | 16-bit phase step | same | `pitch error 72.82551 cent` |
| S1 | modulation read as turns instead of radians | `seitenbaender_liegen_bei_c_plus_k_m_mit_bessel_amplituden` | `c 8 m 1 I 2: line error 4.62e-1` |
| S2 | `INDEX_MAX` 12 instead of 4 pi (-4.5 %) | same | `c 8 m 1 I 2: line error 5.22e-2` |
| S3 | sine polynomial cut after x^7 | same | `c 5 m 7 I 8: line error 1.17e-4` |
| S4 | velocity ignored | `index_eingang_und_anschlag_skalieren_den_index` | the `anschlag 1, vel 0.5` case |
| F1 | feedback from the last sample only (no averaging) | `rueckkopplung_bleibt_periodisch_und_wird_heller` | `rueck 0.7: -78.2 dB between the harmonics (limit -80)` |
| F2 | feedback up to 2.5 rad without the limit | same | `rueck 0.7: -70.8 dB between the harmonics` |
| F3 | no feedback limit per pitch | `rueckkopplung_allein_unter_minus_80_db_alias` | `feedback alone aliases -20.0 dB at 8127.7 Hz` |
| A1 | guard off | `alle_algorithmen_bei_hoechstem_index_unter_der_aliasgrenze` | `alias -0.5 dB (algo 3 ratios [1, 2, 3, 4, 5, 6] at 3226.3 Hz), limit -70 dB` |
| A2 | modulator tails not counted | same | **GREEN** (worst -74.1 dB instead of -82.6 dB) |
| A3 | feedback operator taken as a sine | same | `alias -18.6 dB (algo 2 ... at 19.8 Hz)` |
| A4 | no tail limit on a modulating feedback operator | same | **GREEN** (see below) |
| A5 | operators above Nyquist not muted | same | `alias -0.7 dB (algo 1 ratios [1, 14, 1, 1, 3, 1] at 2032.5 Hz)` |
| A6 | reach bound too low (`1 + 20 I`) | unit `reichweite_liegt_ueber_dem_besselschwanz` | `index 0.0283: reach 1, tail power 1.003e-8` |
| A7 | one limit for the whole voice instead of per tree | `baeume_werden_getrennt_begrenzt` | `the tine pair's limit changed the body pair` |
| E1 | decay time to -40 dB instead of -60 dB | `jeder_operator_hat_seine_eigene_huelle` | `decay -40 dB after 0.51 s` |
| E2 | `zeit` does not scale the decay | same | `zeit 2: 0.34 s` |
| E3 | every operator follows operator 1's envelope | same | `after the modulator's decay the carrier must be a pure sine (0.838)` |
| E4 | envelope does not snap | unit `huelle_rastet_ein_ohne_subnormale` | `decay must snap to sustain 0` |
| E5 | release never ends at 0 | `gate_aus_gibt_den_release` | `after the release the voice is exactly silent` |
| R1 | modulation reads the target instead of the modulator | `modulatoren_wirken_auf_ihre_ziele` | `algo 0 (4>3>2>1): link 2>1 has no effect (0)` |
| R2 | carrier sum not divided by the number of carriers | `nur_traeger_sind_zu_hoeren` | `algo 3 (2>1, 4>3), op 1: peak 1, expected 0.5` |
| R3 | algorithm 3 without carrier 3 | unit `algorithmen_sind_wohlgeformt` | `3: op 3 is dead` |
| D1 | no phase restart on trig | `gleicher_graph_gleicher_klang_und_sync_beim_anschlag` | `with sync the onsets must match (1.995)` |
| D2 | `zuruecksetzen` leaves the voices | `arten.rs zuruecksetzen_gleich_frisch` | `Art fm: 23999 Samples weichen nach zuruecksetzen ab` |
| K1 | one allocation in `Stimme::prozess` | `keine_allokation.rs echtzeitpfad_allokiert_nicht` | `Echtzeitpfad hat Speicher angefordert: fm-1` |

What the first run found, and what changed:

- **S2 was green**: the Bessel test computed the levels from the library's own `INDEX_MAX`, so a wrong constant
  cancelled out. The test now writes the documented scale (4 pi) itself; S2 is red.
- **F2** first changed `FB_MAX`; the per-pitch limit `FB_GRENZE` (1.5 at low pitches) still capped the feedback, so the
  test went red only through "not brighter". The mutation now removes the limit as well and goes red through the
  hunting it is meant to catch.
- **D2 was green**: the minimal graph in `arten.rs` used `sync`, and after its release every voice state is
  functionally fresh again (phases restart, envelopes at 0). The graph now runs with `sync` 0; D2 is red.
- **A2 and A4 stay green.** Without the modulator tails in the guard the worst case on the test grid is -74.1 dB, still
  inside the -70 dB bound; with them it is -82.6 dB. They are kept as margin (the grid has integer ratios and 11
  pitches only); the report states that the test does not prove them necessary.
- A mutation that removed the finite checks on the inputs (NaN on `index`, then on `zeit`) stayed green both times:
  the following `f32::min` / `f32::max` (limit, envelope coefficients) drop a NaN anyway, so the checks are a second
  line. That mutation was removed from the script; `unsinnige_eingaenge_bleiben_endlich_und_begrenzt` still proves the
  outcome (finite, bounded, no rescue).

## Cost (16 voices)

`cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture --test-threads=1 kosten_fm`.
All 16 voices sound (one note each), every operator at work (levels 0.3, feedback 0.5). The block period is
1333 / 2667 / 5333 us for blocks of 64 / 128 / 256. Host: 4-core cloud VM, loadavg 1.1 to 1.9 (not at rest). The
histogram tops out at 1280 us, so a p99.9 of 1280 means "1280 or more". Two runs on the final code:

| graph (16 voices) | block | p50 run 1 / run 2 | p99 run 1 / run 2 | p50 share of the period |
|---|---|---|---|---|
| fm, 4 operators (algo 0) | 256 | 490 / 650 us | 760 / 830 | 9 to 12 % |
| **fm, 6 operators (algo 8)** | 64 | 165 / 165 us | 280 / 330 | 12 % |
| **fm, 6 operators (algo 8)** | 256 | **695 / 760 us** | 1075 / 1160 | **13 to 14 %** |
| fm, 6 operators (algo 10, pairs) | 256 | 495 / 475 us | 880 / 820 | 9 % |
| 6 `sinus` + 6 `adsr` + 12 `mul` + 6 `transponiere` per voice (the old way, no feedback, no guard) | 256 | 975 / 665 us | 1140 / 1280 | 12 to 18 % |

Reading: **16 voices x 6 operators cost about 0.7 ms per 256-sample block, 13 to 14 % of the period at p50 and about
21 % at p99** (roughly 28 ns per operator and sample). That is in the range of the same patch built from `sinus`
nodes, which has no feedback operator and no alias guard. Examples at 256: `fm-bass` (2 voices) p50 100 us,
`fm-lead` (1 voice, echo) 80 us, `fm-epiano` (8 voices, chorus) 270 us, `fm-glocke` (8 x 6 operators, hall) 545 us.
The guard's search (up to 3 trees x 15 checks) runs on a note-on, when the pitch leaves its +-2 % band or the
feedback crosses a 1/64 step; it is not in the per-sample cost. Not gated, read as an order of magnitude.

## Workspace

`cargo test --workspace --release` in `djk/instrumente` on the final code: **100 test groups, 605 passed, 0 failed,
10 ignored** (the ignored ones are the cost runs and other runs on request). The convention lint
(`beispiele_konvention.rs`) covers the four new graphs.

## Open

1. **Not heard.** The example patches, the algorithm set and the feedback scale are numbers, not ear judgements.
2. **The guard dulls high notes.** It holds -80 dB per link, which is stricter than many hardware FM synths (they alias
   audibly). A ratio-14 e-piano tine is almost gone at A5 (880 Hz) and muted above 1.7 kHz; a bright 4-stack keeps
   27 % of its index at A5. A softer bound (e.g. -60 dB per link) or 2x oversampling would keep more brightness; both
   are a decision, not a bug.
3. **The guard is a model.** Its reach estimates are upper bounds for a sine modulator (checked against Bessel
   functions) and measured tables for the feedback operator (`FB_GRENZE` and `FB_SCHWANZ` at 48 kHz, read as a
   fraction of the sample rate at 44.1 and 96 kHz). The -70 dB bound is measured on the test grid (integer ratios,
   20 Hz .. 4 kHz, 48 kHz), not proven for every setting; inharmonic ratios cannot be measured with the exact-line
   method.
4. **Retrigger click:** with `sync` a strike on a sounding voice restarts the phases while the envelopes are not at 0.
5. **No per-operator keyboard scaling or velocity curves** (DX-style level and rate scaling), no fixed-frequency
   operators, no LFO/pitch envelope inside the block (they can be built around it in the graph), no stereo output.
6. **Linear levels.** `pegel` is linear in amplitude and index; a dB scale (as on hardware) would give finer control
   near 0.
7. **Cost**: measured on a loaded host; a rest measurement under the real-time lock (`djk/konfig/echtzeit_schloss.sh`)
   is still to do. SIMD over voices is possible.
8. The C++ side, the page and the kern were not built or run; no code there names arts.

## Review on the receiving side (2026-11-02)

Merged after the metallic bank and the resonator bank; types are numbered in merge order, so `fm` is type 35 (not 33
as planned on the branch); the type tests pin 35. Whole workspace on x86_64, release build: 102 test binaries ok,
0 failures. Own mutations of `src/fm.rs`: fine detune scaled by 1/100 instead of 1/1200 turned
`tonhoehe_mit_verhaeltnis_und_feinverstimmung_auf_hundertstel_cent` red; an alias guard that passes everything turned
`alle_algorithmen_bei_hoechstem_index_unter_der_aliasgrenze` and `baeume_werden_getrennt_begrenzt` red. Open: the
listening test by the product owner.
