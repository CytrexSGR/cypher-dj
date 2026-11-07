# Baukasten: the 46 recipe cards as playable patches

STATUS: built and verified in a cloud container on branch `claude/baukasten-recipe-patches-vz08l6` (2026-11-02), not
merged into main the same day after review, nothing installed, **not heard**. Every number below is a measurement on the rendered output of the patch
(`tests/rezepte.rs`), not a listening judgment.

## What was built

| file | content |
|---|---|
| `beispiele/rezepte/<group>-<subtype>.json` (46, new) | one graph per card of `rezepte/RECIPES.md`, format `baukasten/2`, only node types 0..32 |
| `beispiele/rezepte/MANIFEST.json` (new) | per patch: card id, citation line, the card's own feasibility line, status, description, knobs, approximation notes, the module that would make it exact, the modules that would improve it, the probe |
| `rezepte/baue_rezepte.py` (new) | the generator: every recipe is a Python function with its build notes; it reads the cards for id, citation and target words and writes the graphs and the manifest |
| `tests/rezepte.rs` (new) | 7 tests: load and level, knob ends, one check per card, mutations, bright/dark pairs, manifest completeness, check coverage |
| `tests/beispiele_konvention.rs` | the convention lint now also covers `beispiele/rezepte/` (named `rezepte/<file>`), and its probe and knob sweep run on all cores |

No module was changed. `src/` is untouched. The plugin loads a recipe like any other graph; `fx-texture` needs
`feder-ir.f32` in its graph folder, as `fx-federhall` does.

## How the cards were read

**Conventions of the examples.** Every knob is named in `regler_namen`, feeds something and changes the sound on the
lint probe; the knob midpoint 0.5 is the card's value (a log knob is centred on the value, `sqrt(min * max)`); every
`delay` and `hall` has its `mix` on a knob; the last node before `ausgang` is a fixed trim (`pegel`, or `pegel_l` and
`pegel_r`) behind a 15 Hz DC block. The lint (`beispiele_konvention.rs`) checks all of this on the recipes too.

**Welsh's percent values.** The cards quote cutoffs as Hz and percent pairs (10 % = 40 Hz, 50 % = 630 Hz, 76 % =
3.8 kHz, 89 % = 9.04 kHz, 100 % = 20 kHz). All pairs fit `f = 20 * 2^(p / 10)` Hz, so 10 % of the scale is one octave.
The filter envelope amount is read on the same scale: E % moves the cutoff by `1.2 * E` semitones at full envelope,
built as `transponiere(cutoff, st = env * amount)`. Resonance r % is the ladder's `reso` r / 100 (1 = self-oscillation);
"24 dB" is the ladder, "12 dB" the 2-pole SVF.

**Envelopes.** The kit's ADSR decay and release times are times to -60 dB. The cards' seconds are used as those times;
"D max" with S 100 % is 10 s, a held note then never decays.

**Pitches.** Bass patches put their lowest layer on the played note and keep the card's octave offsets as intervals
between the layers (Welsh writes "-2 oct" against a keyboard two octaves up; played literally, A1 would put the square
at 13.75 Hz). Leads, keys, pads and plucks keep the card's offsets against the played note. Drums and percussion have a
fixed pitch on a Tune knob (the played note does not move a kick).

**Voices.** Mono patches have 1 voice, poly patches 8. Every detuned layer on the cards (reese, supersaw, unison,
choir section, texture width) is a `wavetable` node with unison copies, so **one note always costs one voice**: the
supersaw's 7 saws, the hi-hat's 6 squares and the bell's 5 operators are nodes inside one voice. The card's voice
arithmetic ("3 saws per note, a 5-note chord uses 15 of 16 voices") no longer applies.

**Where the kit already has what a card calls missing.** Three cards were written against an older picture of the kit:

- *"no free-running sine"* (bass.sub, drums.kick): the `sinus` block is a free-running sine with an `hz` input.
- *"fehlt: Hard-Sync"* (lead.sync; sync is also on keys.piano, keys.electric_piano, pluck.string): every oscillator
  has had a `sync` input since slice 1, fed from a master's `zyklus` output (`beispiele/lead.json` uses it). That sync
  smooths only the half of the step after the reset (osz.rs), so a fast sync sweep aliases; a band-limited sync
  oscillator would remove the alias, it is not needed for the sound.
- *"one sine-FM pair only"* (bass.fm, lead.fm, keys.bell): `sinus` has a linear `fm` input in Hz, so any number of
  operators can be stacked (modulator output * modulator frequency * index * envelope into the carrier's `fm`). What the
  kit lacks is a calibrated operator level: Cann's "mod level 60" or "amount 100" has no defined index, so the index
  scale is my choice on bass.fm and keys.bell (status approximated).

**What no card gets.** No bell EQ block exists, so EQ boosts and cuts (for example "cut 200-400 Hz boxiness") are left
out on every card that has one; high- and low-passes are built. A patch has no kick, so "sidechain to the kick" is a
plain compressor (bass.wobble, bass.rolling, keys.chord, pluck.stab: status approximated). The wet automation of
riser and downlifter and the arpeggiator of lead.arp come from the host, as the cards say.

## Result

**35 exact, 10 approximated, 1 blocked** (status rules in `MANIFEST.json`, `status_werte`).

- approximated: bass.fm (operator level scale), bass.wobble, bass.rolling, keys.chord, pluck.stab (no kick for the
  sidechain; stab also has a key scaling linear in Hz, there is no log block), pad.choir (one fixed vowel from three
  band-passes, no vowel morph), keys.piano (no hammer transient, no string beating), keys.bell (index scale),
  drums.cymbal (noise plus a six-square layer; the card itself says a believable cymbal needs more), fx.impact (no
  reversed crash, it needs a sample).
- blocked: pad.granular. The patch is a stand-in: a wavetable cloud (`analog` table, 5 copies) whose position is
  moved by a slow LFO plus a smoothed random LFO. Grain size and density have no equivalent.

### All 46 patches

Columns: voices; peak of the probe render at the default knobs (dBFS); peak with all knobs at 0 / at 1 (dBFS); the
card's check, its measured value and window; the mutation and its value (red in every row); the module that would
make the patch exact; modules that would improve it. Probe: 2 s at 48 kHz, velocity 0.8, 120 BPM; chord A3 C#4 E4 A4
(drone and texture A2 C#3 E3 A3), single note E2 for bass, A3 for mono leads, C4 for drums and fx.

| patch | status | voices | peak | knobs 0 / 1 | check | measured (window) | mutation → value | exact with | better with |
|---|---|---|---|---|---|---|---|---|---|
| `bass-sub` | exact | 1 | -6.00 | -13.82 / 0.40 | energy above 200 Hz vs the fundamental (dB), card: >= 30 dB below | **-42.1** (≤ -30) | saw instead of triangle, filter wide open → -14.8 | — | — |
| `bass-reese` | exact | 1 | -6.00 | -8.71 / -3.65 | beating depth of the fundamental from the +-38 cent detune | **0.95** (0.5 .. 1) | detune 0 (and no detune drift) → 0.07 | — | — |
| `bass-acid` | exact | 1 | -6.00 | -12.02 / -2.45 | resonance peak: band at the 450 Hz cutoff re the band an octave below (dB) | **-2.13** (≥ -6) | resonance 0 → -10.2 | — | — |
| `bass-fm` | approximated | 1 | -6.00 | -10.00 / -4.28 | brightness falls with the 2 s decay (the index is the envelope): brightness 0-150 ms / 1.2-1.6 s | **1.43** (≥ 1.3) | FM depth 0 → 1.09 | FM operators | — |
| `bass-wobble` | approximated | 1 | -6.00 | -10.03 / -3.99 | cutoff wobble at 1/8 note (4 Hz at 120 BPM): brightness rate in Hz | **4** (3.8 .. 4.2) | wobble depth 0 → 2.35 | — | — |
| `bass-analog` | exact | 1 | -6.00 | -11.89 / -3.95 | AR envelope: holds while the key is down (drive off), stops on release: level 30 ms after note-off re peak (dB) | **-48.4** (≤ -40) | a decaying ADSR (D 1 s, S 0) instead of the AR shape → 0 | — | — |
| `bass-rolling` | approximated | 1 | -6.00 | -47.74 / -4.74 | release ends before the next 1/16 (125 ms at 120 BPM): level 125 ms after note-off re peak (dB) | **-151** (≤ -40) | release 1 s → -33.6 | — | — |
| `bass-pluck` | exact | 1 | -6.00 | -9.80 / -6.90 | pluck decay (A 0, D 0.29 s, S 0): time to -40 dB in s | **0.18** (0.1 .. 0.6) | sustain 100 % → never | — | — |
| `lead-mono` | exact | 1 | -6.00 | -12.37 / -3.17 | 20 ms glide: mean pitch of the first 12 ms after a legato jump A3 -> A4 (Hz) | **272** (200 .. 380) | no glide → 440 | — | — |
| `lead-poly` | exact | 8 | -6.00 | -19.85 / -7.61 | PWM 5.5 Hz: depth of the 3rd-harmonic line of osc 1 over time | **0.964** (0.75 .. 1) | PWM depth 0 → 0.453 | — | — |
| `lead-supersaw` | exact | 8 | -6.00 | -6.65 / -5.47 | beating depth of the fundamental from the 7-copy detune | **0.897** (0.3 .. 1) | detune 0 → 0 | — | — |
| `lead-acid` | exact | 1 | -6.00 | -25.21 / 3.62 | the acid bass lifted an octave: pitch ratio lead/bass on the same note | **1.99** (1.97 .. 2.03) | no octave lift → 1 | — | — |
| `lead-sync` | exact | 1 | -6.00 | -13.50 / -3.47 | hard sync: pitch stays at the master (220 Hz) while osc 2 is tuned +7 st | **221** (213 .. 227) | sync edges removed → 330 | — | hard sync |
| `lead-fm` | exact | 8 | -6.00 | -8.17 / -5.37 | the mod-index envelope bites: centroid 0-60 ms / 0.8-1.2 s | **2.01** (≥ 1.3) | bite 0 (static index) → 0.99 | — | FM operators |
| `lead-arp` | exact | 8 | -6.00 | -13.61 / -7.02 | high-pass 300 Hz keeps the arp off the bass: energy below 150 Hz re total on A2 (dB) | **-29.1** (≤ -20) | high-pass at 20 Hz → -1.79 | — | — |
| `pad-strings` | exact | 8 | -6.00 | -5.97 / -9.33 | the filter opens after the bow (filter A 0.8 s): seconds until the brightness reaches 90 % of its 1.2-1.6 s value | **0.36** (0.3 .. 1.2) | filter attack 1 ms → 0.2 | — | — |
| `pad-choir` | approximated | 8 | -6.00 | -7.39 / 0.48 | slow swell (A 0.32 s): level 0-50 ms re 0.6-0.8 s (dB) | **-23.4** (≤ -10) | attack 1 ms → -2.35 | — | — |
| `pad-atmosphere` | exact | 8 | -6.00 | -7.18 / -12.59 | the self-resonant filter pitches the noise: spectral peak re median 200-4000 Hz (dB) | **20.2** (≥ 15) | resonance 0 → 5.88 | — | — |
| `pad-analog` | exact | 8 | -6.00 | -7.35 / -8.21 | long release (R 2.25 s): seconds from note-off to -40 dB | **1.34** (1 .. 2.2) | release 0.2 s → 0.114 | — | — |
| `pad-granular` | blocked | 8 | -6.00 | 0.91 / 0.18 | the cloud evolves (position LFO): brightness 3.0-3.5 s re 0.5-1.0 s | **1.6** (≥ 1.15) | no position motion → 0.965 | granular engine | — |
| `pad-drone` | exact | 8 | -6.00 | -0.92 / -16.89 | slow swell (A 1.5 s): level 0-100 ms re 1.8-2.0 s (dB) | **-32.2** (≤ -15) | attack 1 ms → -5.73 | — | — |
| `keys-piano` | approximated | 8 | -6.00 | -25.17 / -4.67 | brightness decays with the note (filter D 5.22 s): centroid 0-60 ms / 1.0-1.4 s | **2.16** (≥ 1.2) | filter env amount 0 → 0.165 | physical string | — |
| `keys-electric-piano` | exact | 8 | -6.00 | -10.59 / -6.15 | long decay to silence (D 5.14 s, S 0): level 1.8-2.0 s re peak (dB) | **-19.6** (-30 .. -8) | sustain 100 % → -2.84 | — | FM operators, modal resonator |
| `keys-organ` | exact | 8 | -6.00 | -8.14 / -5.47 | click-free attack (A 0.6 s): level 0-50 ms re 1.0-1.5 s (dB) | **-27.3** (≤ -15) | attack 1 ms → -1.17 | — | — |
| `keys-mallet` | exact | 8 | -6.00 | -7.78 / -5.91 | glockenspiel decay (D 1.2 s, S 0): time to -40 dB in s | **0.77** (0.5 .. 1.2) | sustain 100 % → never | — | modal resonator |
| `keys-chord` | approximated | 8 | -6.00 | -5.22 / -9.17 | stacked fifth: the +7 st line re the root line (dB) | **-1.71** (≥ -6) | fifth tuned to the root → -62.1 | — | — |
| `keys-bell` | approximated | 8 | -6.00 | -4.46 / -8.69 | the 1:7 modulator dies in 1 s while the carriers ring: centroid 0-50 ms / 1.5-1.9 s | **3.01** (≥ 1.3) | modulation index 0 → 1 | FM operators | modal resonator |
| `pluck-synth` | exact | 8 | -6.00 | -8.24 / -6.49 | pluck decay (amp D 0.2-0.5 s, S 0): time to -40 dB in s | **0.202** (0.1 .. 0.5) | sustain 100 % → never | — | — |
| `pluck-mallet` | exact | 8 | -6.00 | -15.35 / -6.69 | xylophone decay (D 1.88 s, S 0): time to -40 dB in s | **0.906** (0.8 .. 1.9) | sustain 100 % → never | — | modal resonator |
| `pluck-string` | exact | 8 | -6.00 | -5.14 / -6.02 | brightness falls after the pick (filter D 0.35 s): centroid 0-50 ms / 0.6-1.0 s | **1.78** (≥ 1.3) | filter env amount 0 → 0.967 | — | physical string |
| `pluck-stab` | approximated | 8 | -6.00 | -13.40 / -6.86 | velocity -> cutoff: centroid at velocity 1.0 / at 0.3 (first 150 ms) | **1.2** (≥ 1.15) | velocity amount 0 → 1 | — | — |
| `drums-kick` | exact | 1 | -6.00 | -15.38 / -3.46 | exponential pitch drop: cycle frequency at 2 ms / at 100 ms | **1.83** (≥ 1.5) | pitch drop 0 → 1.07 | — | — |
| `drums-snare` | exact | 1 | -6.00 | -10.68 / -2.67 | noise dominates: spectral flatness 1-8 kHz (0 tonal .. 1 noise) | **0.552** (0.3 .. 1) | no noise → 0 | — | — |
| `drums-clap` | exact | 1 | -6.00 | -18.41 / -5.99 | retriggered 32 Hz square on the amplitude, depth 45 %: chopping of the envelope averaged over 16 hits (first 120 ms) | **0.396** (≥ 0.1) | clap LFO depth 0 → 0.022 | — | — |
| `drums-hihat` | exact | 1 | -7.01 | -14.09 / -3.28 | closed hat (D 0.03-0.06 s): time to -40 dB in s | **0.046** (0.01 .. 0.1) | decay 0.5 s → 0.324 | — | metallic bank |
| `drums-cymbal` | approximated | 1 | -6.00 | -14.73 / 0.44 | cymbal decay (D 1.1 s, S 0): time to -40 dB in s | **0.762** (0.4 .. 1.4) | sustain 100 % → never | metallic bank | — |
| `percussion-tom` | exact | 1 | -6.00 | -6.44 / -6.35 | pitch drop 3-7 st over 20-40 ms: cycle at 2 ms re 150 ms (semitones) | **2.42** (2 .. 8) | pitch drop 0 → 0.004 | — | modal resonator |
| `percussion-shaker` | exact | 1 | -6.00 | -11.49 / -2.15 | a 40 ms grain: time to -40 dB in s | **0.032** (0.01 .. 0.08) | decay 0.3 s → 0.204 | — | — |
| `percussion-conga` | exact | 1 | -6.00 | -6.51 / -6.40 | conga decay (D 0.15 s): time to -40 dB in s | **0.096** (0.05 .. 0.25) | sustain 100 % → never | — | modal resonator |
| `percussion-rim` | exact | 1 | -6.00 | -6.44 / -5.93 | the click of stick on rim (amp D 0.09 s, R 0): time to -40 dB in s | **0.062** (0.02 .. 0.12) | decay 0.5 s → never | — | — |
| `percussion-metallic` | exact | 1 | -6.00 | -10.30 / -3.32 | cowbell lines at 587 and 845 Hz: the weaker line re the stronger (dB) | **-11.5** (-15 .. 0) | second pulse at 587 Hz → -72.6 | — | metallic bank |
| `fx-riser` | exact | 1 | -6.00 | -8.59 / -4.66 | the filter envelope rises: centroid 1.6-2.0 s / 0.1-0.5 s | **2.68** (≥ 1.5) | env amount 0 → 1.02 | — | — |
| `fx-downlifter` | exact | 1 | -6.00 | -6.94 / -2.29 | the inverted envelope falls: centroid 0.1-0.5 s / 1.6-2.0 s | **2.02** (≥ 1.5) | env amount 0 → 1.01 | — | — |
| `fx-impact` | approximated | 1 | -6.00 | -10.21 / -4.63 | pitch falls 12-24 st over 100-300 ms: cycle frequency at 3 ms re 500 ms (semitones) | **12.9** (12 .. 24) | pitch drop 0 → 0.094 | — | — |
| `fx-noise` | exact | 8 | -6.00 | -5.97 / -2.73 | 0.2 Hz swell, depth 75 %: level range over 1-6 s in 250 ms windows (dB) | **10.7** (≥ 6) | swell depth 0 → 0.28 | — | — |
| `fx-texture` | exact | 8 | -6.00 | -6.40 / -2.69 | random filter movement: brightness spread (std / mean over 20 ms windows, 0.5-3.5 s) | **0.153** (≥ 0.1) | random depth 0 → 0.049 | — | — |

Level: every patch peaks at -6.00 dBFS on its probe (window -7.5 .. -4.5 dBFS); the hi-hat sits at -7.0 dBFS, because
at -6 dBFS it peaked at 0.898 on the lint probe, too close to the lint's 0.9. RMS differs by design (a sub bass at
-12 dB, a shaker at -40 dB): the patches are matched by peak, so drums and sustained sounds start from the same
headroom. All knobs at their ends stay finite without rescue; the loudest end is lead-acid with all knobs at 1
(+3.6 dBFS, resonance and drive at maximum), the test limit there is +12 dBFS.

Lint probe (`beispiele_konvention.rs`, default knobs, all 46): peak 0.19 (keys-chord, whose probe notes sit below its test chord) .. 0.80 (hi-hat, after the 1 dB trim; 0.898 before), DC
at most -102.8 dBFS (pad-granular), no knob dead (smallest sweep difference on the recipes printed as `MESS sweep`).

Bright against dark (spectral centroid of the probe, first second; the brighter must be 1.5 times the darker):
bass-analog 389 Hz > bass-sub 86 Hz; lead-acid 437 > bass-reese 117; drums-hihat 2375 > drums-kick 251;
drums-cymbal 4387 > percussion-tom 169; lead-supersaw 854 > pad-drone 246; keys-mallet 877 > pluck-mallet 339.
Mutation: the supersaw with its cutoff pinned to 60 Hz measures 260 Hz against the drone's 246 Hz, the pair turns red.

### Findings while measuring

- **percussion.rim does not ring at 2.7 kHz.** With the transcribed env amount 85 % and filter decay 1.19 s, the
  cutoff stays near the top of its range for the whole 90 ms click; the strongest peak sits at 11.1 kHz, 6 dB over its
  octave. The card's "band-pass around 2-3 kHz" would need a much shorter filter decay (0.19 s?). The OCR'd table
  cannot settle it, so the patch keeps the transcribed numbers and the check is the click length (62 ms to -40 dB).
- **drums.cymbal "904 Hz (89 %)"** is 9.04 kHz: 89 % on Welsh's scale, and 904 Hz would be 49 %.
- **pluck.mallet** at 300 Hz cutoff closes over notes above A4 once the filter envelope has decayed, so a high note
  dies faster than the amp envelope's 1.88 s. The check plays A3 (0.91 s to -40 dB).
- **percussion.tom**: the measure reads the first full cycle after the hit (about 7 ms), which averages the fast part
  of the 5 st drop, so it reads 2.4 st. The window is 2 .. 8 st; the mutation without a drop reads 0.004 st.
- **bass.analog**: the compressor and the drive flatten the envelope, so the AR check holds the drive knob at 0 and
  measures the stop after release (-48 dB 30 ms after note-off) plus the hold (-0.15 dB drift).

## Which future module upgrades which patches

| module (parallel work) | makes exact | improves |
|---|---|---|
| FM operators (calibrated levels, per-operator envelopes) | bass.fm, keys.bell | lead.fm, keys.electric_piano (tine) |
| physical string | keys.piano | pluck.string (the string itself instead of a synced pulse pair) |
| modal resonator | — | keys.electric_piano, keys.mallet, keys.bell, pluck.mallet, percussion.tom, percussion.conga |
| metallic oscillator bank | drums.cymbal | drums.hihat, percussion.metallic |
| band-limited hard sync | — | lead.sync (alias-free sweeps; the sync itself already works) |
| granular engine | pad.granular | — |

Not covered by the parallel work: a bell EQ block (every card's EQ moves), a key input for the sidechain cards, a
formant filter with vowel morph (pad.choir), sample playback of a reversed crash (fx.impact).

## How it was proven

`tests/rezepte.rs` goes through the public JSON API only (`uebersetze_mit_wurzel`, `Programm`):

1. `jeder_patch_laedt_spielt_endlich_und_pegelgleich`: every manifest entry loads, plays its probe without NaN, infinity
   or rescue, no sample above 0 dBFS, peak inside the window, voices within 16, mono = 1, every chord note on its own
   voice. It prints `MESS_PEGEL name trim`; `baue_rezepte.py --pegel` reads those lines, writes the graphs with them and
   stores them in the script's `PEGEL` table.
2. `alle_regler_an_den_enden_endlich`: all knobs at 0 and at 1.
3. `pruefungen_der_karten`: one check per card (table above). The checks hold an effect dry with its knob when the tail
   would blur the property (room mix 0 for a decay time), never by editing the patch, except percussion.tom, which takes
   its -10 st square out of the mix to read the pitch of the upper one.
4. `mutationen_machen_die_pruefungen_rot`: one mutation per card through the JSON (a value set, a knob pinned, a block
   type swapped, an edge removed). All 46 turn their check red; the test fails if one stays green. Several checks were
   rebuilt after a mutation stayed green in a first run: tom (pitch reader confused by the second square), clap
   (envelope noise; now averaged over 16 hits in the log domain), analog (compressor hid the envelope), atmosphere
   (low-passed noise has a high peak-to-median ratio as well; now the smoothed peak over its octave), granular and
   strings (beating and the cutoff LFO swamped the measure).
5. `hell_gegen_dunkel`: six pairs and one mutation.
6. `manifest_ist_vollstaendig`, `jede_karte_hat_eine_pruefung_und_eine_mutation`: every card has a patch, a check and
   a mutation; descriptions have 1..6 target words, energy 1..5, a sentence of at most 160 characters.

Run time: `tests/rezepte.rs` 16 s, the extended convention lint 131 s (it was 114 s for the 27 old graphs alone; the
sweep now runs on all cores), release build, 4 cores.

## Limits

- Not heard. The patches meet their numbers; whether they sound like their names is for a listening session.
- `tests/keine_allokation.rs` and the reset tests (`hall_ffi/tests/bk_zuruecksetzen_alle.rs`, `bk_ffi.rs`) still read
  only the top-level `beispiele/`; the recipes use no new block, so their real-time behaviour is that of the blocks they
  are made of, but they were not run through those tests.
- Poly glide (pad.drone, 1.5 s) is per voice: a voice glides from the last note it played, not from the last note of the
  keyboard.
- The task named the branch `cloud/baukasten-rezepte`; the session is bound to `claude/baukasten-recipe-patches-vz08l6`,
  so the work is pushed there.

## Reproduce

```
cd djk/instrumente/baukasten_dsp/rezepte && python3 baue_rezepte.py
cd .. && cargo test --release --test rezepte -- --nocapture
cargo test --release --test beispiele_konvention
# re-level after changing a recipe:
cargo test --release --test rezepte jeder_patch -- --nocapture > /tmp/p.txt; python3 rezepte/baue_rezepte.py --pegel /tmp/p.txt
```

## Review on the receiving side (2026-11-02)

Merged after hard sync, together with the cleaned card file `rezepte/RECIPES.md` the manifest test reads (46 cards;
quotes from sources are omitted there). Whole workspace on x86_64, release build: 107 test binaries ok, 0 failures. Own
counter-check: `bass-acid.json` replaced by the reese patch turns three tests red (`manifest_ist_vollstaendig`,
`pruefungen_der_karten`, `mutationen_machen_die_pruefungen_rot`). Open: the listening test by the product owner.
