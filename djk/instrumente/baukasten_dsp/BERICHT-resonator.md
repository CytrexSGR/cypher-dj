# Baukasten: modal resonator bank (type 34)

STATUS: built and verified on branch `claude/modal-resonator-bank-type-35-08fwj1` (2026-11-02), merged into main the same day after review; nothing
installed, not heard. All numbers are measurements on synthetic signals in a cloud container.

## Why

Bells, mallets, congas, wood and metal percussion need many inharmonic partials with their own decay each. With the
existing blocks that meant a dozen `sinus` nodes and envelopes per voice. The new block `resonator` plays up to 32 tuned
two-pole resonators per voice, tuned and damped from published physics, struck by an impulse, a noise burst or driven by
any audio signal.

## What was built

| file | change |
|---|---|
| `src/resonator.rs` (new) | mode sets, coefficient build, voice `Stimme`, 6 unit tests |
| `src/uebersetzen.rs` | `ARTEN` entry `resonator` (appended at the end), value checks, build arm |
| `src/programm.rs` | step `Schritt::Resonator` (voices boxed), run arm, reset arm |
| `src/lib.rs` | `pub mod resonator` |
| `beispiele/resonator-glocke.json`, `resonator-marimba.json`, `resonator-conga.json`, `resonator-metall.json`, `fx-resonator.json` (new) | examples |
| `tests/resonator.rs` (new) | 19 tests: io, value checks, ratios, coefficients, frequencies and decays in the sound, stability, position, brightness, excitation, determinism, robustness |
| `tests/arten.rs` | minimal graph for `resonator` (reset == fresh), type pinned |
| `tests/keine_allokation.rs` | `RESONATOR_1` (all knobs moving, noise burst plus audio input) and the five examples |
| `tests/kosten_messung.rs` | new `kosten_resonator` (16 voices x 8 / 16 / 32 modes, the examples) |
| `mutation_resonator.py` (new) | the mutation runs of this report |

No existing module changed in behaviour. The plugin crate `baukasten` needed no change (it loads any graph; the block uses
no file).

**Type number.** The task assigns type 35. Types 33 and 34 are added by parallel slices that are not on this branch, so
here `resonator` is entry 33 of `ARTEN` (the last one). The test `arten_nur_angehaengt_resonator` accepts index 35, or the
last entry while `ARTEN` has fewer than 36 entries; after the merge it must be index 35. Stored graphs name the type by
its string `art`, so the index does not reach the project files.

## Design

### Resonator

Each mode is a complex one-pole `z = r e^(iw)`, i.e. the coupled form of a two-pole resonator: per sample the state
`(re, im)` is rotated by `(r cos w, r sin w)` and the excitation is added to `re`; the output is the sum of `im`. A strike
therefore starts every mode in sine phase (no click, no DC step), and the impulse response of a mode with strike gain `g`
is exactly `g r^n sin(w n)`.

Why not a direct-form biquad: its pole angle comes from `2 r cos w`, whose f32 rounding is a frequency error of several
cent at 40 Hz. In the coupled form `r sin w` keeps its full relative precision; the measured worst frequency error of all
coefficients is 1.5e-4 cent (see below).

`|z| < 1` holds by construction: T60 is clamped to at most 30 s, so `1 - r >= 1.2e-6` up to 192 kHz, far above the f32
rounding of `r cos w` (3e-8); a guard scales the rounded pair down if `|z|` ever reached 1.

The modes are stored as a structure of arrays and summed in eight lanes with one accumulator each, so the loop vectorises
(a single f32 accumulator kept the compiler from it: cost went from 385 to 100 us per block, see Cost).

### Mode sets (`satz`) and their sources

All tables are computed at translation (no files, no samples). Ratios are relative to the mode that carries the played
pitch (ratio 1).

| `satz` | name | modes | ratios | source |
|---|---|---|---|---|
| 0 | stab | 32 | `(beta_n / beta_1)^2`, `beta_n` the roots of `cos(x) cosh(x) = 1` (4.7300, 7.8532, 10.9956, ...): 1, 2.7565, 5.4039, 8.9330, 13.3443, ... | uniform free-free bar, Euler-Bernoulli theory; Fletcher & Rossing, *The Physics of Musical Instruments*, 2nd ed. (1998), section 2.15; glockenspiel bars, section 19.2 |
| 1 | marimba | 32 | 1, 4, 10, then `10 (beta_n / beta_3)^2` | marimba bars are undercut to tune the first overtones two octaves and three octaves plus a major third above the fundamental: Fletcher & Rossing (1998) section 19.3; Rossing, *Science of Percussion Instruments* (2000), ch. 6. The modes above the third are an assumption (see Open) |
| 2 | glocke | 12 | 0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166, 5.433, 6.796, 8.215 (hum, prime, tierce, quint, nominal, deciem, undeciem, duodeciem, upper octave, ...) | tuned church bell, Rossing & Perrin, "Vibrations of bells", *Applied Acoustics* 20 (1987), as reproduced in Fletcher & Rossing (1998) Table 21.1 |
| 3 | glas | 32 | `n (n^2 - 1) / sqrt(n^2 + 1)` for n = 2..33, relative to n = 2: 1, 2.828, 5.423, 8.771, ... | inextensional bending modes of a thin ring (Rayleigh; Fletcher & Rossing 1998 section 2.20), the usual first model of a wine glass or glass bowl (French, "In vino veritas", *Am. J. Phys.* 51, 1983) |
| 4 | holzblock | 32 | `beta^2 / sqrt(1 + beta^2 rho^2 (1 + E / kappa G))`, rho = (h/L)/sqrt(12), h/L = 0.25, E/G = 9, kappa = 5/6: 1, 1.94, 2.71, ... | thick free-free beam with shear deformation and rotary inertia, Rayleigh-Timoshenko approximation (Timoshenko 1921; Han, Benaroya & Wei, *J. Sound Vib.* 225, 1999); E_L/G_LR of hard maple about 9 (USDA Wood Handbook FPL-GTR-190, table 5-1) |
| 5 | membran | 32 | `j_mn / j_01`, the Bessel zeros of the 32 lowest (m, n): 1, 1.594, 2.136, 2.296, 2.653, 2.918, ... | ideal circular membrane (Fletcher & Rossing 1998 section 3.5; zeros as in Abramowitz & Stegun table 9.5). J_m is computed by the trapezoid rule on its periodic integral, the zeros by scan and bisection |
| 6 | platte | 32 | `m^2 + (a n)^2` with a = Lx/Ly = 1.3, the 32 lowest (m, n), relative to (1, 1) | simply supported thin rectangular plate, Navier solution (Leissa, *Vibration of Plates*, NASA SP-160, 1969; Fletcher & Rossing 1998 section 3.12) |

**Gain table (strike position).** For a point impulse the velocity amplitude of a mass-normalised mode is
`phi_m(strike) phi_m(listener)`; averaged over listening points `phi_m(listener)` has unit rms, so the gain table is the
mode shape at the strike position, normalised to unit mean square over the body. `position` runs from the edge (0) to the
centre (1):

| set | shape | position p maps to |
|---|---|---|
| stab, marimba, holzblock | free-free bar `cosh u + cos u - sigma (sinh u + sin u)`, written in a form that stays exact for large beta | x = p/2 of the length (end .. centre) |
| glocke, glas | relative factor `tan^(m - 2)(theta / 2)` per circumferential order m (Rayleigh's inextensional shell modes fall toward the pole like `tan^m(theta / 2)`) | theta = (pi/2)(1 - 0.6 p), rim .. toward the crown |
| membran | `J_m(j_mn r) / rms` | r = 0.9 (1 - p) |
| platte | `2 sin(m pi x) sin(n pi y)` | (x, y) = (0.08 + 0.42 p, 0.13 + 0.37 p) toward the centre |

The tables have 257 points over p and are read with linear interpolation. The bell partials' circumferential orders are
2, 2, 3, 3, 4, 4, 2, 5, 6, 7, 8, 9 (from their usual (m, n) labels; see Open).

**Decay table.** A constant loss factor `eta` (hysteretic damping; the loss factor of wood, metal and glass is nearly
independent of frequency, e.g. Ono & Norimoto, *Jpn. J. Appl. Phys.* 22, 1983, for wood) gives each mode
`T60 = 3 ln(10) / (pi eta f) = 2.198 / (eta f)` (Cremer, Heckl & Petersson, *Structure-Borne Sound*): every mode's decay
follows from its frequency, higher modes die faster. T60 is clamped to 1 ms .. 30 s and to at least 10 samples (so
`r >= 0.5`).

### Excitation

* `anregung` 0: a rising `trig` (above 0.5, after a sample at or below 0.5) adds an impulse of height `staerke`.
* `anregung` 1: a rising `trig` starts a noise burst (xorshift per voice, seeded by `saat` and the voice) that decays to
  -60 dB in `burst` ms and carries unit energy times `staerke^2`, so on average it strikes as loud as the impulse.
* The audio input `x` drives the bank at all times with the per-mode gain `2 g (1 - r)`: a sine on a mode frequency comes
  out with the mode's strike amplitude whatever the decay (unity peak gain). Inputs below 1e-10 count as silence.

Per-mode strike gain: mode shape times the mallet roll-off `1 / (1 + (f / fc)^2)` (the second-order spectral envelope of
a short contact force, `fc = 50 Hz * 2^(9 helligkeit)`), normalised so the gains have unit energy over the active modes.
The knobs change the timbre, not the level.

### Knobs and ranges

| port / value | range | default | meaning |
|---|---|---|---|
| `hz` (input) | Hz | 0 | pitch of the ratio-1 mode; modes outside 10 Hz .. 0.45 sr are off |
| `trig` (input) | | 0 | rising edge strikes |
| `staerke` (input) | 0..10 | 1 | strike strength (wire `note.vel`) |
| `x` (input) | audio, clamped to +-100 | 0 | audio excitation |
| `material` (input) | 0..1 | 0.5 | loss factor `eta = 0.1 * 10^(-4 material)`: 0 felt-damped (0.1), 0.25 wood (0.01), 0.5 glass (1e-3), 0.75 steel (1e-4), 1 bell bronze (1e-5) |
| `helligkeit` (input) | 0..1 | 0.5 | mallet roll-off fc 50 Hz .. 25.6 kHz (1.13 kHz at 0.5) |
| `groesse` (input) | 0.25..4 | 1 | size: all frequencies divided by it |
| `position` (input) | 0..1 | 0.3 | strike position, edge .. centre |
| `inharmonie` (input) | 0..2 | 1 | ratio = anchor * (ratio / anchor)^i, anchor = nearest harmonic (or 1/k below 1): 0 harmonic, 1 physical, 2 twice the deviation in cent |
| `satz` | 0..6 | 0 | mode set |
| `moden` | 1..32 | 32 | modes used (cost scales with it, in steps of 8) |
| `anregung` | 0, 1 | 0 | impulse, noise burst |
| `burst` | 0.5..50 ms | 5 | burst length to -60 dB |
| `saat` | 0..65535 | 0 | burst seed |

Output: `aus` (mono).

**Control rate.** Pitch, material, brightness, position and inharmonicity are read every sample; the coefficients are
rebuilt when one of them changed, at the next 32-sample control step and at once on a strike. Rebuilding changes the
rotation of ringing modes smoothly (the state is continuous), and changes the gains of the next excitation.

**Real time.** `Stimme::prozess` allocates nothing, takes no lock and has no panicking path (indices are clamped, all
inputs pass a finite check with a default). Every 32 samples modes below 1e-20 are set to zero; since `r >= 0.5`, a state
above that threshold cannot reach the subnormal range before the next check, and excitations are kept above it (strikes
below 1e-6 are dropped, inputs below 1e-10 are silence, gains below 1e-6 are zero). A voice whose modes are all zero, with
no burst and no input, skips the bank.

### Examples (knob convention: every knob named, fed and audible on the probe)

| graph | sound | knobs |
|---|---|---|
| `resonator-glocke` | tuned church bell, 8 voices, impulse | Material, Brightness, Strike position, Inharmonicity, Size, Level |
| `resonator-marimba` | marimba bar, 12 modes, wood loss, impulse | Material, Mallet hardness, Strike position, Inharmonicity, Size, Level |
| `resonator-conga` | membrane, 2 ms noise burst (hand) | Damping, Brightness, Strike position (rim .. centre), Tuning, Level |
| `resonator-metall` | metal plate, 8 ms noise burst (scraped), one octave below the note | Material, Brightness, Strike position, Inharmonicity, Size, Level |
| `fx-resonator` | effect: the host input through a 32-mode glass bowl, added to the dry signal | Tune (55..440 Hz), Material, Brightness, Inharmonicity, Wet |

On the convention probe (`beispiele_konvention`): peaks 0.40 .. 0.80, DC -64 .. -88 dBFS, every knob changes the output.
`fx-resonator` needs a Wet range up to 60: with unity peak gain a broadband input comes out of the narrow modes about 35 dB
down (see Open).

## How it was proven

Unit tests in `src/resonator.rs` (6) and `tests/resonator.rs` (19). Sound checks go through the JSON API; coefficient
checks drive `resonator::Stimme` directly.

### Mode frequencies

* **Ratios against the published values** (`verhaeltnisse_wie_veroeffentlicht`): each set's ratios against an independent
  list in the test (published beta roots, the bell table, Abramowitz & Stegun Bessel zeros, the ring, Timoshenko and plate
  formulas). Worst deviation: 3.9e-5 cent (bound 0.01 cent). The unit tests also check beta_1..5 to 1e-6 and ten Bessel
  zeros to 1e-6 against the tables.
* **Coefficients** (`koeffizienten_treffen_frequenz_und_abklingzeit`): 23 346 active modes over all sets, sample rates
  44.1/48/96 kHz, pitches 27.5 Hz .. 7 kHz, size 0.25..4, inharmonicity 0..2, material 0..1. Worst frequency error of the
  rounded coefficients **1.5e-4 cent (bound 0.001 cent)**; modes outside 10 Hz .. 0.45 sr are verified off.
* **In the sound** (`modenfrequenzen_im_klang_auf_cent`): one strike per set, each mode's frequency from the phase advance
  of a Blackman-Harris DFT (16384 points, two windows 8192 apart) at every mode with no neighbour within 40 Hz: 115 modes,
  **worst 0.0001 cent (bound 0.05 cent)**.

### Decay per mode

* Coefficients: worst T60 deviation from `2.198 / (eta f)` (clamped) **1.35 % (bound 2 %)**; this is the f32 rounding of
  `|z|` at the longest decays (30 s at 96 kHz).
* In the sound (`abklingzeit_je_mode_wie_vorgegeben`): level drop of each mode between two Blackman-Harris windows, for
  bell, bar, wooden block, membrane and glass at materials 0.2 .. 0.6 (57 modes): **worst 0.80 % (bound 3 %)**.

### Stability

* `stabil_bei_allen_einstellungen`: 11 340 settings (all sets, 22.05 .. 192 kHz, hz 0 .. 1 MHz, every knob at its ends):
  **largest |z| = 0.999998831 < 1**, longest T60 30.77 s (bound 30 s + 5 % f32 rounding at 192 kHz).
* `laute_dauerlast_bleibt_begrenzt`: 16 voices, full-scale noise on the input, a strike every 3000 samples, all five
  knobs flipped between their ends every 64 samples for 4 s: peak 5.15, finite, no rescue by the guard.
* `unsinnige_eingaenge_bleiben_endlich`: +-inf and NaN on every input: finite, no rescue.
* `keine_subnormalen_und_ruhe_nach_dem_abklingen` (unit): sample by sample, every state is 0 or a normal float until the
  voice goes idle, for all sets at short and long decays.

### Knobs and excitation

* Strike position: bar struck at the centre, modes 2 and 4 (antisymmetric) at -125.8 and -120.1 dB against the
  fundamental, at p = 0.6 +7.7 and -1.8 dB; membrane struck at the centre, (1,1) at -127.3 dB, at p = 0.6 +1.5 dB.
* Brightness: mode 4 against mode 1 of the bar, measured against the predicted roll-off: -37.62 (-37.52), -30.63
  (-30.54), -10.69 (-10.60), -0.99 (-0.90), -0.14 (-0.04) dB for brightness 0 .. 1 (bound 0.5 dB).
* Noise burst against impulse (8 seeds): -1.85 dB (bound 2 dB). The burst loses a little because the fast high modes decay
  during the 3 ms burst.
* Audio input: a sine on the bell's prime comes out at -19.5 dB (material 0.2) and -19.8 dB (material 0.5), 100 times
  different decay; 40 Hz beside the mode -58.0 dB.
* Unit-energy gains for every set and position; inharmonicity 0 lands on the anchors, 2 doubles the cent deviation;
  `moden` 1 leaves a single mode (mode 2 more than 80 dB down); a held trig strikes once; a new strike between control
  steps plays exactly like a fresh voice; same graph same sound, another seed another burst; silent without a strike.

### Mutations

`python3 mutation_resonator.py <copy of djk/instrumente>`: each mutation is applied to a copy, the named test runs, the
file is restored. RED = the test caught it.

| result | mutation | test | first failure |
|---|---|---|---|
| RED | F1 mode frequency 1e-5 high (0.017 cent) | `--test resonator koeffizienten` | stab sr 44100 mode 0: 27.500274093552065 Hz vs 27.5 Hz (0.017255190007360997 cent) |
| RED | F2 mode frequency 1e-4 high (0.17 cent) | `--test resonator modenfrequenzen` | stab mode 0: +0.1731 cent at 110.0 Hz |
| RED | F3 bell tierce 1.193 instead of 1.183 | `--test resonator verhaeltnisse` | glocke mode 2: ratio 1.193 vs published 1.183 |
| RED | F4 Bessel integral with 12 points | `--test resonator verhaeltnisse` | membran mode 1: ratio 1.5933168380027243 vs published 1.5933404900546633 |
| RED | F5 bar ratios beta^2.02 | `--test resonator verhaeltnisse` | stab mode 1: ratio 2.784631324990744 vs published 2.7565385424738085 |
| RED | I1 inharmonicity without anchor | `--test resonator inharmonie` | stab mode 1: inharmonie 0 gives 1, not 3 |
| RED | D1 decay independent of the mode frequency | `--test resonator abklingzeit` | stab sr 44100 mode 1 75.80480894524895 Hz: T60 0.7994973326552126 vs 0.29006165007636936 |
| RED | D2 T60 5 % long | `--test resonator abklingzeit` | stab sr 44100 mode 0 27.5 Hz: T60 0.8394582105147705 vs 0.7995661078684667 |
| RED | D3 material over 3 decades instead of 4 | `--test resonator koeffizienten` | stab sr 44100 mode 0 27.5 Hz: T60 25.21440635559916 vs 30 |
| RED | S1 no 30 s clamp of T60 | `--test resonator stabil` | T60 4538687.843854141 s above the 30 s limit |
| RED | S2 no T60 clamp and no \|z\| guard | `--test resonator stabil` | pole on or outside the unit circle: \|z\| = 1.0000000262731774 |
| RED | S3 no flush of decayed modes | `--lib resonator::tests::keine_subnormalen` | stab 2000 Hz material 0: subnormal state -5.59936e-40 at sample 716 |
| GREEN | S4 non-finite material not caught | `--lib resonator::tests::nan_eingaenge` |  |
| RED | S5 non-finite position not caught | `--lib resonator::tests::nan_eingaenge` | sample 1: NaN |
| RED | P1 strike position ignored | `--test resonator anschlagposition` | stab mode 2: +15.4 dB at the centre, a node expects < -60 dB |
| RED | B1 brightness ignored | `--test resonator helligkeit` | brightness 0: -0.10 dB, predicted -37.52 dB |
| RED | G1 strike gains not normalised | `--lib resonator::tests::verstaerkungen` | stab pos 0: sum of gs^2 = 7.377103 |
| RED | N1 noise burst not normalised to unit energy | `--test resonator rauschanregung` | burst energy -6.69 dB against the impulse |
| RED | X1 input gain sqrt(1 - r) instead of 1 - r | `--test resonator audioeingang` | peak gain depends on the decay: 13.7 vs 25.6 dB |
| RED | T1 trig level instead of rising edge | `--test resonator nur_steigende_flanke` | peak 26.490908 |
| RED | T2 strike waits for the control step | `--test resonator neuer_anschlag` | the new note starts on the old coefficients (difference 0.9664044) |
| RED | R1 zuruecksetzen leaves the voices | `--test arten zuruecksetzen_gleich_frisch` | assertion `left == right` failed: Art resonator: 24000 Samples weichen nach zuruecksetzen ab |
| RED | A1 allocation in the audio path | `--test keine_allokation` | assertion `left == right` failed: Echtzeitpfad hat Speicher angefordert: resonator-1 |

**22 of 23 RED.** The one GREEN, S4, removes the finite check on `material`; it is not a gap in the tests but a redundant
guard: a NaN loss factor gives a NaN T60, and the later `max(10 samples)` (f64 `max` returns the other operand for NaN)
turns it into the shortest decay, so the output stays finite. The guard stays for clarity (NaN material means 0.5, not
"shortest decay"). S5 was added after the first run: the NaN test then only fed NaN to an idle voice, which skips the
bank; the unit test now strikes and drives the input while every knob is NaN, and S5 turns it red. D1 is caught by both
`abklingzeit_je_mode_wie_vorgegeben` and the coefficient test (the cargo filter `abklingzeit` matches both).

## Cost

`cargo test --release -p baukasten_dsp --test kosten_messung kosten_resonator -- --ignored --nocapture --test-threads=1`,
48 kHz, every voice struck again every 4800 samples (no voice goes idle), 4000 blocks, 4-core cloud container, other
builds running at the same time (the max and p99.9 columns carry that load).

| graph | voices x modes | block | p50 us | p99 us | p99.9 us | p50 share of the period |
|---|---|---|---|---|---|---|
| resonator-16x8 | 16 x 8 | 256 | 60 | 145 | 240 | 1.1 % |
| resonator-16x16 | 16 x 16 | 256 | 75 | 170 | 705 | 1.4 % |
| **resonator-16x32** | **16 x 32** | 64 | 35 | 75 | 115 | 2.6 % |
| **resonator-16x32** | **16 x 32** | 128 | 50 | 110 | 290 | 1.9 % |
| **resonator-16x32** | **16 x 32** | 256 | **100** | 200 | 495 | **1.9 %** |
| resonator-glocke | 8 x 12 | 256 | 55 | 100 | 175 | 1.0 % |
| resonator-marimba | 8 x 12 | 256 | 55 | 95 | 155 | 1.0 % |
| resonator-conga | 8 x 32 | 256 | 65 | 155 | 1060 | 1.2 % |
| resonator-metall | 8 x 32 | 256 | 70 | 145 | 190 | 1.3 % |
| fx-resonator | 1 x 32 | 256 | 40 | 90 | 610 | 0.8 % |

Reading: **16 voices x 32 modes cost about 100 us per 256-sample block, 1.9 % of the 5.3 ms period at p50.** The
histogram has 5 us bins, so the small values are coarse. Before the lane-wise sum the same graph measured p50 385 us
(7.2 %). Idle voices cost nothing beyond the parameter checks. Coefficient rebuilds (32 exp, sin, cos per voice) happen at
most every 32 samples and only when a parameter moved; the 16x32 run includes the rebuild on every strike.

## Workspace

`cargo test --workspace --release` in `djk/instrumente`: **100 test groups, 606 passed, 0 failed, 10 ignored** (the ignored
ones are the cost runs and other runs on request), on the final state of the branch.

## Open

1. **Type index.** On this branch `resonator` is `ARTEN[33]`; it becomes 35 only when the types 33 and 34 of the parallel
   slices are merged before it. The merge must keep that order; `arten_nur_angehaengt_resonator` then pins index 35.
2. **Bell table.** The twelve partial ratios and the (m, n) orders used for the strike position were written from the
   published table (Rossing & Perrin 1987 / Fletcher & Rossing Table 21.1) without the book at hand in this session; they
   should be compared against the printed table once. The orders of the 6th and 7th partial are the least certain.
3. **Model assumptions.** Marimba modes above the third follow the uniform-bar spacing (the undercut bar's upper modes are
   not in the cited sources); the wooden block is a solid thick beam (no slit cavity) with Euler-Bernoulli shapes for the
   strike position; the conga is an ideal membrane (no air loading, which lowers the real (0,1) mode); the plate is simply
   supported (a free plate, as in a thunder sheet, has no closed form). Radiation damping (for example the fast (0,1) mode
   of a drum) is not modelled: all decays follow one loss factor.
4. **Audio input level.** Unity peak gain per mode keeps a sustained input safe at any decay, but a broadband or transient
   input comes out quiet (about 35 dB down in `fx-resonator`). An alternative "constant noise power" scaling (`sqrt(1 - r^2)`)
   would be louder for transients and up to +50 dB on a sine at a long mode; a choice for a later slice.
5. **Pitch modulation** is stepped every 32 samples (0.67 ms); fast vibrato or FM through `hz` will show the steps. A mode
   that crosses 0.45 sr during a glide is switched off at once.
6. **Not heard.** The examples were checked by numbers only (level, DC, every knob changes the sound).
7. **Cost** was measured on a loaded shared host; a quiet run under the real-time lock is still to do.

**Type number at merge (2026-11-02).** Types are numbered in merge order and never move afterwards: wavetable 32,
metall 33, resonator 34. The numbers 35 and 36 planned for the parallel slices were dropped; the type tests pin 33 and 34.

## Review on the receiving side (2026-11-02)

Merged together with the metallic oscillator bank (both appended to the same lists; resolved by hand, types fixed in
merge order). Whole workspace on x86_64, release build: 101 test binaries ok, 0 failures. Three independent mutations
of `src/resonator.rs` turned their checks red: a shifted root equation of the free-free bar
(`verhaeltnisse_wie_veroeffentlicht`, `modenfrequenzen_im_klang_auf_cent`), twice the decay time
(`koeffizienten_treffen_frequenz_und_abklingzeit`, `abklingzeit_je_mode_wie_vorgegeben`, `stabil_bei_allen_einstellungen`),
mode frequencies 1 % high (six tests, among them `modenfrequenzen_im_klang_auf_cent`). Open: the listening test by the
product owner.
