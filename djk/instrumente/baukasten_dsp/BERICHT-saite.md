# Baukasten: physical string model (type 37)

STATUS: built and verified on branch `claude/string-model-type-34-xt5dqm` (2026-11-02), not merged, nothing installed,
not heard. All numbers are measurements on synthetic signals in a cloud container.

## Why

The Baukasten could build a plucked string only from blocks (`beispiele/saite.json`: noise burst, `leitung`, a
low-pass and a gain in a feedback edge). Such a loop is out of tune by the phase delay of its filter, its decay depends
on the pitch, and it has no hammer, no pick position and no body. The new block `saite` is a complete digital waveguide
string per voice: plucked string, harp, guitar-like and piano-like hammered string, with exact tuning and an exact decay
time.

## What was built

| file | change |
|---|---|
| `src/saite.rs` (new) | loop design (`entwurf`, `nachfuehren`), voice `Stimme`, exciters, body filter, unit tests |
| `src/uebersetzen.rs` | `ARTEN` entry `saite` (appended after `wavetable`), value checks, build arm |
| `src/programm.rs` | step `Schritt::Saite` (voices boxed), run arm, reset arm |
| `src/lib.rs` | `pub mod saite` |
| `beispiele/saite-gitarre.json`, `saite-harfe.json`, `saite-klavier.json`, `saite-karplus.json` (new) | examples |
| `tests/saite.rs` (new) | 17 tests: io, value checks, measurement tools, pitch, pitch after moves, decay, damping, pick position, brightness, hammer velocity, DC (3), stability, robustness, determinism, body |
| `tests/arten.rs` | minimal graph for `saite` (reset == fresh), type pinned |
| `tests/keine_allokation.rs` | `SAITE_1` (every input on a knob, noise on `x`) and the four examples |
| `tests/kosten_messung.rs` | new `kosten_saite` |
| `mutation_saite.py` (new) | the mutation runs of this report |

No existing module was changed in behaviour. The plugin crate `baukasten` needed no change (it loads any graph; the
block uses no file). `INTERFACES.md` needed no change (no new address, no file).

**Type number.** The task gave type 34. Type 33 is being added by a parallel session and was not on any branch when
this slice was built, so on this branch `saite` is entry 33 of `ARTEN` (directly after `wavetable`, 32). Graphs name the
art, not the number, so nothing stored depends on it. The pin tests (`tests/arten.rs arten_nur_angehaengt_saite`,
`tests/saite.rs saite_ist_art_34_mit_ein_und_ausgaengen`) accept index 33 only while `ARTEN` has 34 entries and require
34 once type 33 exists. **At merge, type 33's entry must come before `saite`**; the `ARTEN` length line
(`[ArtDef; 34]`) will conflict and becomes `[ArtDef; 35]`.

## Design

### The loop

`v[n] = A(L(v[n - N])) + c[n]`, one loop per voice:

- an integer delay line of `N` samples (f32, sized at translation for `MIN_HZ` = 20 Hz: 4096 samples at 48 kHz);
- the loss filter `L(z) = b0 / (1 + a z^-1)`, a one-pole low-pass (state in f64);
- the first-order allpass `A(z) = (eta + z^-1) / (1 + eta z^-1)` for the fractional delay (state in f64);
- `c`, the excitation after the pick-position comb and a DC blocker.

The output is `v`, optionally through the body filter. The pitch range is 20 Hz to `sr / 8` (6 kHz at 48 kHz, at least 8
samples per period); `hz` outside is clamped.

**Fractional delay: allpass, not Lagrange.** The allpass has gain 1 at every frequency, so the fractional delay does not
change the decay; a Lagrange interpolator has a frequency-dependent gain below 1 that would shorten the decay of the
upper partials differently for every pitch. The allpass's drawback, transients when its coefficient jumps, is small for
a first-order section (the coefficient only moves when the pitch moves).

### Damping

The pole `a` (0 ..= -1) comes from `daempfung` after Valimaki et al.: from the loop gains per period that give `ausklang`
at DC (`g0`) and `ausklang * 10^(-3 daempfung)` at Nyquist (`g_pi`), `a = (g_pi - g0) / (g_pi + g0)`. Damping 0 is a flat
loop (every partial decays like the fundamental), damping 1 asks the Nyquist partials for a T60 1000 times shorter.

### Pitch and decay are exact: pole placement

A loop mode is a pole of `1 / (1 - G(z) z^-N)`. The fundamental's pole is placed exactly at
`z* = r e^{j w0}`, `w0 = 2 pi f0 / sr`, `r = 10^(-3 / (sr T60))` (the radius per sample that loses 60 dB in T60):

1. `N` = integer part of `sr / f0 + arg(1 / (1 + a / z*)) / w0 - 0.5`, so the allpass gets about 0.5 ..< 1.5 samples;
2. `eta` makes `arg(G(z*) z*^-N) = 0`. With `u = 1 / z*`, `arg A(z*) = arg((eta + u)(1 + eta conj(u)))`, so the phase
   condition is `Im(e^{-j theta} (conj(u) eta^2 + (1 + |u|^2) eta + u)) = 0`, a quadratic in `eta`; of its roots, the one
   with `|eta| < 1` next to the unit-circle solution `sin(w0 (1 - D) / 2) / sin(w0 (1 + D) / 2)` is taken;
3. `b0` makes `|G(z*) z*^-N| = 1`.

The fundamental then rings at `f0` and loses 60 dB in `T60` to rounding, whatever the loss filter does to the phase. The
simpler designs, measured as mutations against this one: (a) tuning on the unit circle (the loss filter's phase delay
and the allpass coefficient at `w0`, the usual Jaffe-Smith tuning with the exact coefficient) is off by up to
**0.17 cent** at low notes with strong damping (27.5 Hz at 96 kHz, damping 1, mutation P2), because a strong low-pass
bends the phase between the unit circle and the pole; (b) the textbook coefficient `(1 - D) / (1 + D)` is off by
**6.0 cent** at 4186 Hz (P1); (c) the decay set from the loop gain per period on the unit circle (`|L(w0)| = g0`) is off
by up to **0.23 %** (880 Hz, T60 0.1 s, damping 0.5; T1), because a mode shrinks once per group delay, not per period.
Only step 1 at the pole matters at the 0.01 cent bound: the allpass coefficient from the unit-circle formula with `N`
from step 1 stays inside it (P2b, green). The quadratic is kept because it is exact and costs one square root.

### Limits that keep the loop stable and the DC away

The loss filter's DC gain `b0 / (1 + a)` is the largest gain of the loop (the low-pass falls with frequency, the allpass
is 1). It must stay at or below `G_MAX` = 1 - 1e-6 (stable) and at or below `g0^0.5`: the loop's DC mode then loses at
least half as many dB per period as the fundamental, so no DC residue outlives a note. When the damping asks for more,
`a` is reduced by bisection (40 steps) to the strongest feasible pole, plus a 1 % margin on `1 + a`. **The damping is
limited, the decay and the pitch are not.** The limit bites at strong damping with short decays at low notes and at
every damping above about 0.3 at high notes. T60 (s) of the partial nearest 2 kHz from the design, `*` = limited:

```
  f0 Hz  T60 | damping 0.25     0.5      0.75     1
     55  0.5 |   0.389     0.038*   0.038*   0.038*      partial 36
     55  2   |   1.812     0.362    0.054*   0.054*
     55  8   |   7.387     4.331    0.147    0.081*
    220  0.5 |   0.453     0.091    0.032*   0.032*      partial 9
    220  2   |   1.848     1.088    0.075*   0.075*
    220  8   |   7.423     5.097    1.117    0.229*
    880  2   |   1.911     1.490    0.836*   0.836*      partial 2
   3520  2   |   2.000     2.000*   2.000*   2.000*      partial 1 (the only partial below 7 kHz)
```

In the limited region the upper part of the knob travel does nothing (open point 3).

**Why not a DC blocker in the loop.** Two versions with a first-order DC blocker inside the loop were built and measured.
With a fixed corner `f0 / 16`, its gain below 1 at `f0` capped the reachable decay at about 3500 periods (3520 Hz could
not ring longer than 1.06 s; 880 Hz not longer than 4.1 s). With a corner adapted to the decay, its phase lead, which
falls with frequency, detuned partial 2 of a 220 Hz string by -11.5 cent (437.10 Hz instead of 440). Both were dropped.

**DC.** Everything that enters the loop passes the pick-position comb, which has a zero at DC. A step on `x` still leaves
a pulse of `M` samples after the comb, and its area would charge the loop's DC mode (measured: mean +1.2e-2 over the
last 10 s of a 20 s constant 0.5 on `x` at 20 Hz, T60 60 s). A DC blocker on the excitation (outside the loop,
`(1 + r) / 2 (1 - z^-1) / (1 - r z^-1)`, corner `f0 / 8`) makes the area 0: -6.3e-5 afterwards.

### Exciters (`anreger`)

All internal exciters start on a rising `trig` (> 0.5), scaled by `vel` and `PEGEL` = 0.5, and add to the external
input `x`. Retriggering a ringing string adds the new excitation to the running vibration.

| `anreger` | name | excitation | `hell` (brightness) |
|---|---|---|---|
| 0 | rauschen | one period of white noise (xorshift32 per voice, seeded by `saat` and the voice): classic Karplus-Strong | one-pole low-pass on the noise, corner from `f0` (0) to no filter (1) |
| 1 | zupfen | raised-cosine pulse | width from half a period (0, a soft finger) to 1/128 period (1, a hard plectrum) |
| 2 | hammer | `sin^3` force pulse | contact time 4 ms (0) to 0.5 ms (1), divided by `0.5 + vel`: a harder strike is shorter and brighter, as with felt hammers; a pulse longer than a period is scaled down so the level per period stays |
| 3 | keiner | none, only `x` | |

**Pick position.** Internal exciter and `x` pass the comb `1 - z^-M`, `M = lage * sr / f0` (fractional, linear between two
taps): partials with a node at the pick point are missing (`lage` 0.5 removes the even partials).

### Body (`koerper`)

Five band-pass resonators (RBJ, 0 dB peak, zero gain at DC, f64 state) plus a direct share, mixed in by
`koerper_mix` (0 = the bare string, bit for bit). The mode sets are plausible, not measurements of an instrument:

| `koerper` | modes (Hz / Q / gain) | direct |
|---|---|---|
| 1 gitarre | 100/14/1.4 (air), 205/18/1.0, 400/12/0.6 (top plate), 1050/6/0.35, 2600/3/0.25 | 0.35 |
| 2 harfe | 140/8/0.9, 290/10/0.8, 560/8/0.6, 1200/5/0.4, 2400/3/0.25 | 0.5 |
| 3 klavier | 95/6/0.6, 190/7/0.6, 420/6/0.6, 900/5/0.5, 2100/4/0.35 | 0.6 |

A body band is flushed as a whole (both states together, when their sum is below 1e-20). Flushing each state alone was
the first version: near a zero crossing that feeds a high-Q band, and the 100 Hz guitar band held about 5e-18 for
seconds without input (found by the subnormal test, mutation S2).

### Real time

Delay line and comb buffer are allocated in `Stimme::neu` at translation (24 KB per voice at 48 kHz, 48 KB at 96 kHz;
384 KB for a 16-voice node at 48 kHz). `prozess` does not allocate, lock or panic: indices are masked, every input is
checked for being finite (NaN and inf read as the default) and clamped, every value written into the loop is clamped to
+-4 (`GRENZE`), and values below 1e-20 are flushed to 0, so a dying note ends in exact zeros, not subnormals.

The full loop design runs only when pitch, decay or damping change (a note-on with a new pitch, a knob move). While
only the pitch moves (vibrato, glide, within 2 % of the last full design), `nachfuehren` keeps the loss pole and only
`N`, `eta` and `b0` follow, every 8th sample; once the pitch holds, the next design is exact again. Without this, vibrato
on 16 voices cost more than 1280 us per 64-sample block (the design with bisection ran every sample).

### Ports and values

| | name | range | default | meaning |
|---|---|---|---|---|
| in | `x` | +-4 | 0 | external excitation (added before the comb) |
| in | `hz` | 20 .. sr/8 | 0 (reads 20) | pitch |
| in | `trig` | > 0.5 = strike | 0 | starts the internal exciter |
| in | `vel` | 0..1 | 1 | exciter level; hammer contact time |
| in | `ausklang` | 0.01..60 s | 2 | T60 of the fundamental |
| in | `daempfung` | 0..1 | 0.5 | extra loss of the upper partials |
| in | `hell` | 0..1 | 0.5 | brightness of the exciter |
| in | `lage` | 0.02..0.5 | 0.13 | pick or hammer position from the bridge |
| in | `koerper_mix` | 0..1 | 0.5 | body share |
| value | `anreger` | integer 0..3 | 1 | 0 rauschen, 1 zupfen, 2 hammer, 3 keiner |
| value | `koerper` | integer 0..3 | 0 | 0 keiner, 1 gitarre, 2 harfe, 3 klavier |
| value | `saat` | integer 0..65535 | 0 | seed of the noise exciter |
| out | `aus` | | | mono |

Every input also takes a fixed value of the same name. Fixed values outside their range (also `hz`) are a `Fehler::Wert`;
edge values on edges are clamped at run time.

### Examples (knob convention: every knob named, fed and audible; midpoint 0.5 is the default sound)

A damper falls on the string at note-off in every example: `ausklang = gate * Decay + (1 - gate) * Release`, built from
`mul` and `add` blocks.

| graph | voices | block settings | knobs |
|---|---|---|---|
| `saite-gitarre` | 6 | pluck, guitar body | 1 Decay (0.5..8 s log), 2 Damping, 3 Brightness, 4 Pick position (0.04..0.5), 5 Body, 6 Release (0.05..2 s log) |
| `saite-harfe` | 12 | pluck, harp body | 1 Decay (1..12 s log), 2 Damping (0..0.8), 3 Brightness (0..0.7), 4 Pick position (0.2..0.5), 5 Body, 6 Release (0.3..12 s log) |
| `saite-klavier` | 16 | hammer, velocity from the note, soundboard | 1 Decay (2..20 s log), 2 Damping, 3 Hardness, 4 Hammer position (0.06..0.25), 5 Soundboard, 6 Damper (0.05..1 s log) |
| `saite-karplus` | 8 | noise burst, no body | 1 Decay (0.2..6 s log), 2 Damping, 3 Brightness, 4 Pick position (0.02..0.5), 5 Release (0.05..2 s log) |

Lint probe (`beispiele_konvention.rs`, default knobs): gitarre `peak 0.502 (-6.0 dB), rms -34.8 dB, dc -99.1 dBFS`; harfe
`peak 0.600 (-4.4 dB), rms -28.6 dB, dc -123.2 dBFS`; klavier `peak 0.791 (-2.0 dB), rms -23.6 dB, dc -82.2 dBFS`;
karplus `peak 0.297 (-10.6 dB), rms -34.8 dB, dc -125.4 dBFS`. Sweep: all 23 new knobs change the sound on the probe;
the smallest are the release knobs (they act only after the probe's note-offs): karplus knob 5 `max |0 - 1| 0.0026`,
gitarre knob 6 `0.0146`.

## How it was proven

All tests go through the public JSON API (`uebersetze`, `Programm`), except the design checks (`saite::entwurf`) and the
unit tests in `src/saite.rs`.

**Measurement tools.** Frequency: Hann-windowed demodulation of the output at a trial frequency; the phase advance
between two windows (16 periods, at least 20 ms long) at distances of 4 periods, 40 periods (at most 0.2 s) and 0.6 s
refines the estimate. An exponential decay has the same shape in both windows and does not bias the phase difference.
T60: level of the same demodulation in frames of 8 periods (of the partial spacing), a straight line through the
frames from 5 to 35 dB below the peak. Positive control (`messwerkzeuge_treffen_einen_bekannten_ton`): decaying sines at
27.5, 4186 and 1234.6 Hz are measured to better than 0.001 cent and 0.05 % in T60.

### Pitch (`tonhoehe_auf_hundertstel_cent_ueber_den_ganzen_bereich`)

Pluck, T60 4 s, damping 0 / 0.5 / 1, at 44.1, 48 and 96 kHz, ten pitches from 27.5 Hz to 4186 Hz. Error of the fundamental
in cent (the same at all three sample rates to the 4th digit):

```
      Hz   damping 0   0.5      1
   27.500   -0.0014  -0.0014  -0.0010
   41.203   +0.0009  +0.0009  +0.0008
   55.000   -0.0000  -0.0000  -0.0002
  110.000   -0.0000  -0.0000  +0.0001
  261.626   +0.0001  +0.0001  +0.0001
  440.000   -0.0000  +0.0000  +0.0000
 1046.502   -0.0001  -0.0001  -0.0001
 2093.005   -0.0001  -0.0001  -0.0001
 3322.438   -0.0000  -0.0000  -0.0000
 4186.009   -0.0001  -0.0001  -0.0001
```

**Worst 0.0014 cent; limit 0.01 cent.** The rest is at the level of the f32 pitch input (41.2034 Hz is not exact in f32,
2e-8 relative = 0.0009 cent) and of the estimator at the lowest notes. After a pitch move on a knob within 2 % (the cheap
path): 220 -> 222 Hz +0.00003 cent, 240 -> 236.5 Hz +0.00000, 220 -> 220.01 Hz +0.00000. Vibrato at 6 Hz +-30 cent on two
voices: finite, no rescue.

### Decay (`ausklang_trifft_den_knopf_auf_zwei_promille`)

Pluck at 55, 220, 880 and 3520 Hz, T60 0.1, 0.5, 2 and 8 s (where `f0 * T60 >= 40` periods), damping 0 / 0.5 / 1, at 48 kHz,
plus three cases at 96 and 44.1 kHz: 45 cases. **Every measured T60 is within 0.01 % of the knob (largest 8.0001 s for
8 s); limit 0.2 %.** This includes the cases where the damping is limited (3520 Hz).

### Damping (`daempfung_kuerzt_die_oberen_teiltoene_wie_entworfen`)

220 Hz, T60 2 s, bright pluck at `lage` 0.31. Partials 2, 4, 8, measured against the design's T60 at the measured partial
frequency (`Schleife::t60_bei`, loop gain and group delay, first order):

| damping | partial 2 | partial 4 | partial 8 |
|---|---|---|---|
| 0 | 2.0000 s (design 2.0000) | 2.0000 (2.0000) | 1.9999 (1.9999) |
| 0.3 | 1.9904 (1.9904) | 1.9529 (1.9529) | 1.8169 (1.8169) |
| 0.6 | 1.7873 (1.7873) | 1.2577 (1.2577) | 0.5878 (0.5878) |

All within 0.01 % of the design (limit 5 %). A strong low-pass makes the upper partials slightly sharp (damping 0.6:
partial 8 at 1760.31 Hz, +0.3 cent); real strings are stretched too, by stiffness, much more.

### Pick position (`anschlag_in_der_mitte_loescht_die_geraden_teiltoene`)

Partial 2 against partial 1, 50 ms after the strike (limit -35 dB at `lage` 0.5; positive control > -20 dB at 0.13):

| | noise | pluck | hammer |
|---|---|---|---|
| 220 Hz, `lage` 0.5 | -66.3 dB | -51.8 dB | -51.9 dB |
| 220 Hz, `lage` 0.13 | -9.1 dB | +5.3 dB | +5.3 dB |
| 1234.5 Hz, `lage` 0.5 | -44.5 dB | -44.6 dB | -46.8 dB |
| 1234.5 Hz, `lage` 0.13 | +5.3 dB | +5.2 dB | +3.0 dB |

With an integer comb delay the 1234.5 Hz notch is only -22.9 dB (mutation K2).

### Exciters

- Brightness (`hell_macht_jeden_anreger_heller`), spectral centroid of the first 100 ms at 110 Hz, `hell` 0 -> 1: noise
  1346 -> 4088 Hz, pluck 215 -> 3403 Hz, hammer 340 -> 1783 Hz (required: at least x 1.5).
- Hammer velocity (`harter_hammeranschlag_ist_lauter_und_heller`), vel 0.3 -> 1: level -27.0 -> -19.4 dB, centroid 436 ->
  766 Hz (required: +6 dB and x 1.2).

### DC

- Every exciter x every body (mix 1) at 55 and 880 Hz, T60 8 s, damping 0, 4 s: the mean is at least **117 dB below the
  peak** (worst pluck, guitar body, 55 Hz); limit 60 dB.
- A constant 0.5 on `x` for 20 s into a 20 Hz loop with T60 60 s and damping 0: peak first second 0.500, last second
  0.051 (decaying), mean of the last 10 s -6.3e-5 (limit 1e-3).
- A 1 Hz sine on `x` into a strongly damped loop (110 Hz, T60 0.1 s, damping 1): output rms 6.9e-4, 0.26 x what the comb
  alone passes (limit 3 x).
- Subnormals: every exciter with the guitar body, T60 0.1 s, 10 s after the strike: every state is exactly 0 (unit test
  `verklungene_saite_ist_genau_null_ohne_subnormale`).

### Stability (`stabil_bei_jedem_knopf_und_klingt_aus`) and robustness

Every input on a knob over its full range (pitch 20..6000 Hz log, decay 0.01..60 s log, damping, brightness, pick position,
velocity, body mix, noise on `x` 0..1), knob ends drawn with extra weight; 10 random settings for each of the 4 exciters x
4 bodies, each jumping to two more random settings while it rings, then the shortest decay: 160 settings, all finite,
never rescued, largest output 4.000 (the clamp `GRENZE`, reached when noise at full level drives a long decay), and
every string has died below 1e-6 within 0.6 s at T60 10 ms. The design itself is checked on a grid of 4 sample rates x 10
pitches (10 Hz to 30 kHz, clamped) x 7 decays (1 ms to 1e9 s, clamped) x 5 dampings: DC gain <= `G_MAX`, `|eta| < 1`,
`N >= 1`, the pole at `z*` to 1e-9. `+-inf`, huge values and NaN on all nine inputs at once: finite output, `rettungen` 0.

### Determinism and body

Two loads of the same graph are bit-identical; another `saat` gives another noise burst. `koerper_mix` 0 is the bare
string bit for bit for every body; mix 1 changes the output by up to 0.30 (guitar), 0.24 (harp), 0.16 (piano).

### Mutations

Each mutation is applied to a copy of the workspace, the named test is run in release and the change is reverted
(`python3 mutation_saite.py <copy of djk/instrumente> [ID ...]`).

**24 of 25 are red.** The one green mutation (P2b) is explained above: it is an equivalent simplification at the
stated bound, not a missing test. K2 was green at first against a centre pluck at 220 Hz only (half a period is 109.09
samples there, the integer delay misses by 0.09 samples: -48.6 dB, inside the -35 dB limit); the test now also plucks at
1234.5 Hz, where it misses by 0.44 samples. P4 was green at first against the damping test (pitch and decay stay exact,
the allpass just takes a long delay near eta = -1); the design check now requires eta in the allpass's good range. T1
was green at first against a 1 % T60 limit; the limit is now 0.2 % (measured 0.01 %).

| id | mutation | test | red output |
|---|---|---|---|
| P1 | textbook allpass coefficient `(1 - D) / (1 + D)` | `tonhoehe_*` | `pitch error 6.03321 cent at sr 48000 4186.009 Hz damping 0, limit 0.01` |
| P2 | tuning on the unit circle (phase delay of L and allpass at `w0`) | `tonhoehe_*` | `pitch error 0.16562 cent at sr 96000 27.5 Hz damping 1` |
| P2b | only the allpass coefficient on the unit circle | `tonhoehe_*` | **green** (see above) |
| P3 | no fractional delay (allpass off) | `tonhoehe_*` | `pitch after a small move off by 3.17144 cent` |
| P4 | integer delay ignores the loss filter's phase | unit `schleife_trifft_*` | `44100 10 1 0.25: eta 0.96115 outside the allpass's good range` |
| N1 | cheap path keeps the old delay and allpass | `tonhoehe_folgt_*` | `pitch after a small move off by 25.43307 cent` |
| T1 | decay from the unit-circle gain per period | `ausklang_*` | `T60 off by 0.23 % at sr 48000 880 Hz T60 0.1 damping 0.5, limit 0.2 %` |
| T2 | decay radius with ln instead of log10 | `ausklang_*` | `T60 off by 130.26 % at sr 48000 220 Hz T60 8 damping 0` |
| D1 | damping pole with the wrong sign | `daempfung_*` | `too few frames for the decay fit at 440.52 Hz` (partial 2 dies at once) |
| D2 | damping limit off (infeasible designs pass) | `stabil_*` | `rauschen body keiner: still 4 after 0.6 s at T60 10 ms` (unstable, held at the clamp) |
| L1 | DC limit off (only `G_MAX`) | unit `verklungene_*` | `rauschen: state not flushed to 0 after 10 s at T60 0.1 s` |
| C1 | no DC blocker on the excitation | `konstante_*` | `DC on the output: 0.012243` |
| K1 | pick-position comb off | `anschlag_in_der_mitte_*` | `220 Hz rauschen: centre pluck leaves partial 2 at -14.4 dB` |
| K2 | integer comb delay | `anschlag_in_der_mitte_*` | `1234.5 Hz rauschen: centre pluck leaves partial 2 at -22.9 dB` |
| S1 | no subnormal flush in the loop | unit `verklungene_*` | `rauschen: state not flushed to 0` |
| S2 | body states flushed one by one | unit `verklungene_*` | `rauschen: state not flushed to 0` |
| G1 | value written into the loop not clamped | `stabil_*` | `rauschen body gitarre: still 1.1e-6 after 0.6 s at T60 10 ms` |
| R1 | non-finite `x` and loop value not caught | `unsinnige_*` | `the guard had to rescue the graph` |
| H1 | hammer contact independent of velocity | `harter_*` | `a hard strike must be brighter (766 -> 766 Hz)` |
| B1 | noise burst ignores brightness | `hell_macht_*` | `rauschen: hell 1 only moves the centroid from 4088 to 4088 Hz` |
| Z1 | `zuruecksetzen` leaves the delay line | `arten.rs zuruecksetzen_gleich_frisch` | `Art saite: 23999 Samples weichen nach zuruecksetzen ab` |
| Z2 | `zuruecksetzen` leaves the noise generator | same | `Art saite: 23983 Samples weichen nach zuruecksetzen ab` |
| Z3 | no reset arm in `programm.rs` | same | `Art saite: 24000 Samples weichen nach zuruecksetzen ab` |
| V1 | seed ignored | `gleicher_graph_*` | `another seed must give another noise burst` |
| A1 | one allocation in `Stimme::prozess` | `keine_allokation.rs` | `Echtzeitpfad hat Speicher angefordert: saite-1` |

G1 is caught indirectly: without the clamp the loop driven by full-level noise on `x` reaches a much higher level, and
it takes longer than 0.6 s to fall below 1e-6. D1, D2, L1, S1 and S2 were found red against the final code; the
first versions of the design had real versions of L1 and S2 (see Design).

## Cost

`cargo test --release -p baukasten_dsp --test kosten_messung -- --ignored --nocapture --test-threads=1 kosten_saite`.
All voices sound (one note per voice). The block period is 1333 / 2667 / 5333 us for blocks of 64 / 128 / 256. **The
host was not at rest**: a 4-core cloud VM with loadavg 1.8 to 2.6, and isolated spikes up to 53 ms (scheduler
artefacts, not the graph). The histogram tops out at 1280 us, so a p99.9 of 1280 means "1280 or more". Two runs on the
final code (the second after the cheap path's rate limit; the graphs without vibrato did not change):

| graph | voices | block | p50 run 1 / run 2 | p99 run 2 | p50 share of the period |
|---|---|---|---|---|---|
| `saite-klavier` (hammer, soundboard) | 16 | 64 | 80 / 80 us | 130 | 6.0 % |
| `saite-klavier` | 16 | 256 | 330 / 325 us | 670 | 6.1 % |
| `saite-gitarre` at 16 voices (pluck, guitar body) | 16 | 64 | 110 / 80 us | 140 | 6 to 8 % |
| `saite-gitarre` at 16 voices | 16 | 256 | 490 / 325 us | 645 | 6 to 9 % |
| `saite-harfe` at 16 voices | 16 | 256 | 330 / 330 us | 725 | 6.2 % |
| `saite-karplus` at 16 voices (noise, no body) | 16 | 64 | 45 / 45 us | 110 | 3.4 % |
| `saite-karplus` at 16 voices | 16 | 256 | 175 / 180 us | 400 | 3.4 % |
| **`saite-klavier` with vibrato** (pitch moves every sample) | 16 | 64 | 140 / 210 us | 405 | 10 to 16 % |
| `saite-klavier` with vibrato | 16 | 256 | 630 / 565 us | 985 | 11 % |
| old `saite.json` (`leitung` loop from blocks) | 4 | 256 | 320 / 320 us | 555 | 6.0 % |

Reading: **16 voices of the string cost about 325 us per 256-sample block with a body (6 % of the period) and about
180 us without (3.4 %)**, roughly 40 ns per voice and sample for the string and 40 ns more for the five body bands. The
old block-built string costs the same per block with 4 voices that the new one costs with 16. A moving pitch costs
extra: vibrato on all 16 voices about 10 to 16 % at p50 (the LFO and `transponiere` nodes included); before the cheap
path it was beyond the histogram (more than 1280 us per 64-sample block, the full design with bisection every sample).
A note-on with a new pitch runs a full design per voice (with the bisection when the damping is limited, about 40
designs). Not gated, read as an order of magnitude.

## Workspace

`cargo test --workspace --release` in `djk/instrumente` on the final code: **100 test groups, 603 passed, 0 failed, 10
ignored** (the ignored ones are the cost runs and other runs on request). The convention lint (`beispiele_konvention.rs`) covers the four new graphs.

## Open

1. **Not heard.** Exciter shapes, the body mode sets, the damper times and the example levels are numbers, not ear
   judgements. The body modes are plausible values, not measurements of instruments.
2. **No stiffness.** Piano strings are inharmonic (stretched partials); a dispersion allpass in the loop would add it, and
   its phase at `z*` would join the pole placement. Not in this slice.
3. **Damping knob saturates.** Where the limits bite (table above), the upper knob travel does nothing. A mapping of
   0..1 onto the feasible range would make the whole travel useful but changes the meaning of the knob (no longer a
   T60 ratio at Nyquist) and needs a bisection per note-on.
4. **Decay over pitch.** A real piano's treble decays much faster than its bass; here `ausklang` is the same for every
   key. The examples would need a key-tracked decay (no power block exists to build `T60 ~ f^-k`).
5. **One polarisation, one string per note.** No double decay, no beating of two or three unison strings, no coupling
   between strings or through the body (sympathetic resonance), no hammer-string interaction (the hammer is a fixed force
   pulse). Retriggering adds to the running vibration instead of damping it first.
6. **Clamp inside the loop.** Noise at full level on `x` into a long decay drives the loop into the +-4 clamp, which then
   clips inside the loop. Musical use with `x` should keep `x` small.
7. **Cost**: the run measured a loaded cloud host; a rest measurement under the real-time lock
   (`djk/konfig/echtzeit_schloss.sh`) is still to do. A full design (note-on with a new pitch, knob move) costs a
   bisection when the damping is limited, which can make a burst when 16 voices start in the same sample.
8. The C++ side, the page and the kern were not built or run.

**Type number at merge (2026-11-02).** Types are numbered in merge order and never move afterwards: wavetable 32,
metall 33, resonator 34, fm 35, granular 36, saite 37. The number 34 planned on the branch was taken; the type tests pin 37.

## Review on the receiving side (2026-11-02)

Merged after granular as type 37. Whole workspace on x86_64, release build: 104 test binaries ok, 0 failures. Own
mutations of `src/saite.rs`: one extra sample of loop delay (four tests red, pitch among them), the DC loop gain `g0`
with -2 instead of -3 decades (red, but only in `stabil_bei_jedem_knopf_und_klingt_aus`, not in
`ausklang_trifft_den_knopf_auf_zwei_promille`: worth a look whether that test measures `g0` at all), damping without
effect (`daempfung_kuerzt_die_oberen_teiltoene_wie_entworfen` red). Open: the listening test by the product owner.
