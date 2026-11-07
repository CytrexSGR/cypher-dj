# cypher-dj: sound devices and their settings

Generated 2026-11-02 from the source tree at `c7627f4a`, "1.12 S3 acceptance: B2e checks core beat consistency". Read-only survey; nothing in the repository was changed. Paths in this document are relative to `djk/` unless they start with another directory.

## 0. How to read this, and what it covers

- **Sections.** 1 = the six nih-plug plugins (`djk/instrumente`); 2 = the 36 Baukasten building blocks (`ARTEN` table, type numbers 0..35; one further block, `granular`, exists only in an unmerged state of the working tree and is described in 2.A); 3 = the built-in devices of the C++ core (`djk/kern`), split into 3A (reachable by a user/agent through the mixer controls, OSC messages or config) and 3B (present only as library code).
- **Every parameter row names its evidence** (file:line) in the "notes" column or in the device header. Line numbers refer to `HEAD` (`c7627f4a`). The working tree currently contains an uncommitted/unmerged state of a parallel wave (`git status`: `UU` on `baukasten_dsp/src/{lib,programm,uebersetzen}.rs`, new `granular.rs`); in that tree `uebersetzen.rs` lines after the `ARTEN` table are shifted by +6/+7. Core and plug-in files were not affected.
- **Units.** Physical wherever the code reveals them (Hz, ms, s, dB, ratio, cent, %, beats). "dimensionless" = a plain factor or normalised 0..1 value. "unknown" is written where the code does not say; nothing is guessed.
- **"skew -2.0"** in the plug-in tables means `FloatRange::Skewed` with `FloatRange::skew_factor(-2.0)`: the factor is 2^(-2.0); a negative skew value spends more of the slider travel on the low end (roughly logarithmic feel). `FloatRange::gain_skew_factor(-48, 0)` is the nih-plug helper that makes a dB range slider-linear in dB.
- **Defaults** are the values in the `Default` impl or `ArtDef.frei` entry, not what a preset sets.
- **Method / confidence.** All content comes from reading source; no plug-in was loaded, no audio rendered, no OSC message sent. Ranges marked "(clamp)" are what the DSP does at run time according to the code read, not something I executed. Counts were made by script where stated (Baukasten: parsed from `ARTEN`), by arithmetic cross-checked against source comments (Regler table) or by counting the rows I wrote (plug-ins).
- **Counts.** Section 1: 6 devices, 102 parameters (eq 58 = 8 bands x 7 + out + propq; komp 9; hall 16; saett 3; rb338 7; baukasten 9). Section 2: 36 blocks, 193 settable names (non-audio inputs, required values, optional values, `datei`; the `fm` block counts 10 + 6 operators x 7); +1 block / 13 inputs in 2.A. Section 3: 3A 17 devices, 1254 Regler paths (909 + the 345 mix-tool rows of Plan A, A8) + 20 OSC/config fields; 3B 1 device (spectrum analyser, its row `spektrum/kanal` is counted in the 345 but not wired until A7b).

## 1. Plugins (nih-plug, Rust) in `djk/instrumente`

Paths are relative to `djk/instrumente/`. A value shown as "skew -2.0" is `FloatRange::Skewed` with `FloatRange::skew_factor(-2.0)`, i.e. the factor 2^-2.0 (negative = finer resolution toward the minimum, roughly logarithmic feel). Units in the "unit" column come from `.with_unit(...)` or the doc comments of the `*_dsp` crate. All six are stereo VST3; "step" = `.with_step_size`.

Parameter counts: eq 58, komp 9, hall 16, saett 3, rb338 7, baukasten (Cypher Modular) 9 = 102 parameters in 6 plugins.

### 1.1 Cypher EQ (`eq`), effect

Eight-band parametric EQ, 2x oversampled below 88.2 kHz base rate, bands in series; per-band bell/shelf/cut/notch/band-pass, mid/side placement. Source: `eq/src/lib.rs` (struct `BandParams` :45-61, constructor :63-88, `EqParams` :121-129, defaults and band start layout :131-152), DSP `eq_dsp/src/lib.rs`, `eq_dsp/src/band.rs:96-135`. Latency is reported to the host (`eq/src/lib.rs:215`).

The band parameters are a nested array of 8 (`#[nested(array, group = "Band")]`, `eq/src/lib.rs:123`). nih-plug appends `_<n>` (n = 1..8) to the id (`nih_plug_derive/src/params.rs:359-363` in the pinned checkout), so the ids are `on_1 .. on_8`, `type_1`, `freq_1` and so on. Display names are "Band n On" etc.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `on_<n>` (n=1..8) | band active | bool | off / on | off for all bands | `lib.rs:67` |
| `type_<n>` | filter type of the band | enum | Bell, Low Shelf, High Shelf, Low Cut, High Cut, Notch, Band Pass (`ArtP`, :8-24) | band 1 Low Cut, 2 Low Shelf, 3-6 Bell, 7 High Shelf, 8 High Cut | start layout :134-143 |
| `freq_<n>` | corner / centre frequency | Hz | 10 .. 22000, skew -2.2 | 1: 30, 2: 100, 3: 250, 4: 800, 5: 2500, 6: 6000, 7: 10000, 8: 18000 | `lib.rs:69-76`; formatter Hz/kHz |
| `gain_<n>` | boost / cut | dB | -24 .. +24, linear, step 0.01 | 0 | `lib.rs:77-79`; used by Bell and the two shelves only (`band.rs:104-128`) |
| `q_<n>` | quality factor | Q (dimensionless) | 0.1 .. 18, skew -2.0 | 0.707 | `lib.rs:80-85`; shelves/notch/band-pass/cuts use Q too (`band.rs:117-135`) |
| `slope_<n>` | steepness of Low Cut / High Cut | enum | 12 dB/oct, 24 dB/oct, 36 dB/oct, 48 dB/oct (`SteilP`, :26-36) | 12 dB/oct | only effective for the two cut types (`band.rs:131-`) |
| `place_<n>` | channel placement | enum | Stereo, Mid, Side (`KanalP`, :38-43) | Stereo | `lib.rs:87` |
| `out` | output gain | dB | -24 .. +24, linear, step 0.01 | 0 | `lib.rs:125-126,146-148` |
| `propq` | proportional Q for bell bands | bool | off / on | off | `lib.rs:127-128,149`; effect: Q multiplied by (0.5 + abs(gain)/24), clamped to the Q range (`band.rs:96-100`) |

### 1.2 Cypher Komp (`komp`), effect

Feed-forward compressor after Giannoulis, Massberg, Reiss 2012 with optional external sidechain (aux stereo input "Sidechain") and parallel mix. Source: `komp/src/lib.rs` (struct :9-28, defaults :30-60, sidechain layout :97-105), defaults from `komp_dsp/src/lib.rs:34-37`, field semantics `komp_dsp/src/lib.rs:21-32`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `thresh` | threshold | dB (dBFS) | -60 .. 0, linear, step 0.1 | -18 | `lib.rs:34` |
| `ratio` | compression ratio | x:1 | 1 .. 20, skew -1.5, step 0.01 | 4 | `lib.rs:37` |
| `knee` | knee width | dB | 0 .. 24, linear, step 0.1 | 6 | `lib.rs:40` |
| `attack` | attack time | ms | 0.1 .. 100, skew -2.0, step 0.01 | 10 | `lib.rs:41` |
| `release` | release time | ms | 10 .. 1000, skew -1.5, step 0.1 | 120 | `lib.rs:44` |
| `makeup` | make-up gain | dB | 0 .. 24, linear, step 0.1 | 0 | `lib.rs:47` |
| `mix` | dry/wet (parallel compression) | % (stored 0..1) | 0 .. 1 | 1 (100 %) | 0 = bit-identical dry (`komp_dsp/src/lib.rs:28`); `lib.rs:48-51` |
| `extsc` | detector listens to the sidechain bus | bool | off / on | off | `lib.rs:52`; only effective when a sidechain is connected |
| `schp` | high-pass in the detector path | Hz | 0 .. 300, linear, step 1 | 0 (shown "Off" below 1 Hz) | `lib.rs:53-57`; 2nd order, `komp_dsp/src/lib.rs:30` |

### 1.3 Cypher Hall (`hall`), effect

Spectral reverb (FFT-based, `hall_dsp`, derivation in `hall_dsp/MATHE.md`) with freeze and kill. Source: `hall/src/lib.rs` (struct :22-55, helper constructors :57-69, defaults :71-103), defaults `hall_dsp/src/lib.rs:49-69`, field semantics `hall_dsp/src/lib.rs:20-47`, kill `hall/src/lib.rs:183-188` + `hall_dsp/src/lib.rs:234-240`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `mix` | wet share | % (0..1) | 0 .. 1 | 0.30 | `hall_dsp:22` |
| `early` | early-reflection level relative to the tail | % (0..1) | 0 .. 1 | 0.50 | |
| `tail` | level of the reverb tail | dB | -24 .. +12, linear, step 0.1 | 0 | `lib.rs:77` (default hard-coded 0, equals `fahne_db` 0) |
| `pre` | pre-delay | ms | 0 .. 250, skew -1.0, step 0.1 | 10 | `lib.rs:78` |
| `size` | length of the early-reflection region | ms | 5 .. 200, skew -1.0, step 0.1 | 60 | `lib.rs:81` |
| `decay` | reverberation time T60 at 1 kHz | s | 0.1 .. 30, skew -2.0, step 0.01 | 2.0 | `lib.rs:84`; `hall_dsp:30-31` |
| `lowx` | factor on the decay time at 150 Hz ("Low Decay") | x (factor) | 0.25 .. 4, skew -1.0, step 0.01 | 1.2 | `lib.rs:87`; `hall_dsp:32-33` |
| `highx` | factor on the decay time at 8 kHz ("High Decay") | x (factor) | 0.1 .. 2, skew -1.0, step 0.01 | 0.6 | `lib.rs:90`; `hall_dsp:34-35` |
| `lowcut` | low-cut of the wet signal | Hz | 10 .. 1000, skew -2.0 | 80 | `lib.rs:93` via helper `hz()` :64-69 |
| `highcut` | high-cut of the wet signal | Hz | 1000 .. 22000, skew -2.0 | 12000 | `lib.rs:94` |
| `diff` | diffusion; 0 = tonal / frozen, 1 = full diffusion | % (0..1) | 0 .. 1 | 1.0 | `hall_dsp:38` |
| `width` | stereo width | % (0..1) | 0 .. 1 | 1.0 | |
| `duck` | spectral ducking (per frequency) | % (0..1) | 0 .. 1 | 0 | `hall_dsp:42` |
| `freeze` | freeze the tail | bool | off / on | off | `lib.rs:98` |
| `kill` | empties the reverb tail (acts on the rising edge) | bool | off / on | off | `lib.rs:99,183-188` |
| `fft` | FFT frame size | enum, not automatable | 512 (grainy), 1024, 2048, 4096, 8192 (smooth) (`RahmenP`, :8-20) | 2048 | `lib.rs:100` |

### 1.4 Cypher Saett (`saett`), effect

Saturation: tanh with first-order antiderivative antialiasing (ADAA1, Bilbao et al. 2017) at double sample rate; reports latency to the host. Source: `saett/src/lib.rs` (struct :8-15, defaults :17-30), defaults `saett_dsp/src/lib.rs:67-71`, semantics `saett_dsp/src/lib.rs:57-65`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `drive` | gain before the curve | dB | 0 .. 36, linear, step 0.1 | 12 | `lib.rs:21` |
| `out` | level after the curve | dB | -24 .. +12, linear, step 0.1 | -6 | `lib.rs:22` |
| `mix` | dry/wet | % (stored 0..1) | 0 .. 1 | 1 (100 %) | 0 = dry delayed by the latency, else bit-identical (`saett_dsp:63`); `lib.rs:23-26` |

### 1.5 RB-338 (`rb338`), instrument

Monophonic 303-style voice: oscillator (saw or square) -> 4-pole ladder (TPT, tanh) -> VCA; MIDI in, stereo out, accent via velocity. Source: `rb338/src/lib.rs` (struct :21-36, defaults :38-60); mirrored parameter layer for the core FFI in `rb_dsp/src/parameter.rs:9-95` (ids, ranges, defaults, smoothing; a test in `hall_ffi/tests/rb_wie_plugin.rs` pins both against each other, header of `parameter.rs`); DSP `rb_dsp/src/stimme.rs:1,6,69-76`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `lautstaerke` | output volume ("Volume") | dB (stored as linear gain) | -48 .. 0 dB, gain-skewed, log smoothing 20 ms | -12 dB | `lib.rs:41-47` |
| `wellenform` | waveform ("Square") | bool | off = sawtooth, on = square | off | `lib.rs:48` |
| `cutoff` | filter cutoff base | Hz | 40 .. 5000, skew -2.0, log smoothing 20 ms | 800 | `lib.rs:49-50` |
| `resonanz` | filter resonance | 0..1 (1 = self-oscillation, `filter.rs:10`) | 0 .. 1, linear smoothing 20 ms | 0.3 | `lib.rs:51-52` |
| `env_mod` | filter envelope depth: cutoff * 2^(hub*4*env) | 0..1 (up to 4 octaves) | 0 .. 1, linear smoothing 20 ms | 0.4 | `lib.rs:53-54`; `stimme.rs:72-73` |
| `decay` | decay time of the envelope ("Decay") | s | 0.2 .. 2, skew -1.0 | 0.6 | `lib.rs:55-56`; not smoothed |
| `accent` | strength of the accent: for notes with velocity >= 120/127 the envelope depth is multiplied by (1 + accent), the level is 1 + 0.6*accent (else 0.75) and the decay is fixed at 0.2 s | 0..1 | 0 .. 1 | 0.6 | `lib.rs:57`; `stimme.rs:6,70-76` |

### 1.6 Cypher Modular (`baukasten`), instrument

Hosts a Baukasten graph (JSON `baukasten/2`, section 2) as a stereo synth with MIDI in. The graph is read from the file named in `$CYPHERDJ_BAUKASTEN_GRAPH`, else the built-in `baukasten_dsp/beispiele/saege-ladder.json`. Source: `baukasten/src/lib.rs` (struct :50-69, `knob()` :71-77, defaults :84-104; header comment :1-13).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `lautstaerke` | output volume ("Volume") | dB (stored as linear gain) | -48 .. 0 dB, gain-skewed, log smoothing 20 ms | -12 dB | `lib.rs:87-93` |
| `knob1` .. `knob8` | free knobs ("Knob 1".."Knob 8"); each feeds the `regler` node with the same `nr` | normalised 0..1 (meaning set by the graph's `regler` nodes: min/max/log) | 0 .. 1, linear, 20 ms linear smoothing, displayed with 3 decimals | 0.5 | `lib.rs:71-77`; test `acht_knobs_mit_namen_und_vorgabe` :230-238 asserts ids and default |


## 2. Baukasten building blocks (`djk/instrumente/baukasten_dsp`)

The Baukasten is a graph language: a JSON graph (`format` `baukasten/2`, also reads `/1`; `format.rs:1-7`) of nodes `{id, art, <values>}` and edges `{von:"node.port", nach:"node.port", verzoegerung:0|1}`. Everything below is read from `baukasten_dsp/src/uebersetzen.rs`: the table `ARTEN` (`:87-153`, 36 entries; **type number = index in `ARTEN`**, new blocks are only ever appended, comment at :118), the validation match (`:216-309`, error `Fehler::Wert{knoten,wert,grund}`), and the module comments in `src/<module>.rs`.

How to read the tables:

- **Three kinds of names per node.** `werte` = required fixed values (missing -> `FehlenderWert`), `frei` = optional fixed values with a default, `ein` = input ports. Every input port may additionally carry a fixed value with its own name; it applies when no edge is connected (`uebersetzen.rs:82-84` doc of `ArtDef.frei`; checks :197-205). An input with neither edge nor value nor `frei` default reads 0. Values not named in any of the three lists are rejected (`UnbekannterWert`, :197-199). Non-finite values are rejected (:201-203).
- **range column.** "(reject)" = the translator refuses the graph outside the range (cited line in the block header). "(clamp)" = no validation; the DSP clamps at run time. "-" = nothing enforced or nothing known. A range for an input port refers to the signal value, not to a validation.
- **Limits.** 16 voices (`MAX_STIMMEN`, `programm.rs:26`), 8 knobs for `regler` nodes (`REGLER`, `programm.rs:29`); `note`, `eingang` at most once per graph; `ausgang` at least once (`uebersetzen.rs:314-322`). Sample rate is the host's; `faltung` needs 48 kHz (`:277`), `vocoder` >= 13 kHz (:272), `phaser` needs `hoch < sr/2` (:267).
- **"Sum point"** = the block adds all voices before processing and outputs in voice 0 only (hall, delay, limiter, gate, komp, chorus, phaser, vocoder, faltung).
- **"settings"** in the summary counts fixed values plus control inputs (without the audio-signal inputs `x`, `l`, `r`, `kl`, `kr` and the signal inputs of `mul`/`add`); the 193 are settable names, counting `fm` per operator (6 x 7 = 42).
- The same parameter names are used by effect blocks that exist as plug-ins (`hall`, `komp`) or in the core. Ranges differ between the places (examples in the block tables): baukasten `komp` accepts attack 0.1..200 ms, release 5..2000 ms, make-up -12..24 dB, whereas the VST3 Cypher Komp exposes 0.1..100, 10..1000, 0..24; baukasten `hall` accepts `tief`/`hoch` 0.05..4, the plug-in 0.25..4 and 0.1..2.

Summary (type number, art, number of settable names, ports):

| type | art | settings | inputs (`ein`) | outputs (`aus`) |
|---|---|---|---|---|
| 0 | `note` | 0 | - | hz, gate, vel, trig, erste |
| 1 | `konst` | 1 | - | aus |
| 2 | `regler` | 4 | - | aus |
| 3 | `saege` | 2 | hz, sync | aus, zyklus |
| 4 | `puls` | 3 | hz, pwm, sync | aus, zyklus |
| 5 | `dreieck` | 2 | hz, sync | aus, zyklus |
| 6 | `sinus` | 3 | hz, fm, sync | aus, zyklus |
| 7 | `rauschen` | 0 | - | aus |
| 8 | `lfo` | 7 | rate, trig | aus |
| 9 | `transponiere` | 3 | hz, st, cent | aus |
| 10 | `ladder` | 2 | x, cutoff, reso | aus |
| 11 | `svf` | 3 | x, cutoff, reso | tp, bp, hp |
| 12 | `saett` | 1 | x, antrieb | aus |
| 13 | `glatt` | 2 | x, setzen | aus |
| 14 | `adsr` | 5 | gate, trig, a, d, s, r | aus |
| 15 | `mul` | 0 | a, b | aus |
| 16 | `add` | 0 | a, b, c, d | aus |
| 17 | `leitung` | 3 | x, zeit, hz | aus |
| 18 | `chorus` | 2 | x, mix | l, r |
| 19 | `hall` | 9 | x, l, r, mix | l, r |
| 20 | `delay` | 8 | x, l, r, zeit, fb, mix | l, r |
| 21 | `limiter` | 3 | x, l, r | l, r |
| 22 | `gate` | 5 | x, l, r, kl, kr | l, r |
| 23 | `komp` | 8 | x, l, r, kl, kr | l, r |
| 24 | `eingang` | 0 | - | l, r |
| 25 | `ausgang` | 0 | x, l, r | - |
| 26 | `krume` | 2 | x, bits, rate | aus |
| 27 | `phaser` | 8 | x, l, r, rate, tiefe, fb, mix | l, r |
| 28 | `roehre` | 3 | x, antrieb, bias | aus |
| 29 | `vocoder` | 5 | x, l, r, zisch, mix | l, r |
| 30 | `sampler` | 9 | hz, trig, gate, scheibe, rueck | l, r |
| 31 | `faltung` | 4 | x, l, r, mix | l, r |
| 32 | `wavetable` | 10 | hz, trig, pos, verstimmung, breite | l, r, aus |
| 33 | `metall` | 11 | trig, vel, decay, tune, farbe, rauschen, hp, choke | aus, huelle |
| 34 | `resonator` | 13 | hz, trig, staerke, x, material, helligkeit, groesse, position, inharmonie | aus |
| 35 | `fm` | 52 | hz, gate, trig, vel, index, rueck, zeit | aus |

Block tables (generated from the `ARTEN` entries so that names and defaults are transcribed from the code, meaning/unit/range annotated by hand from the cited lines):

#### 0 `note` (building block, type 0)

Voice allocator output of the host MIDI note (up to 16 voices); source of pitch, gate and velocity. At most one `note` node per graph.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:88` (ARTEN entry); validation: none; meaning/DSP: programm.rs:267-290 (note_an), uebersetzen.rs:314-316 (MehrereNoten).

Inputs (`ein`): none. Outputs (`aus`): hz, gate, vel, trig, erste.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `hz (output)` | out: pitch of the voice | Hz | MIDI note n -> 440*2^((n-69)/12) (programm.rs:191, fn hz) | - | output port |
| `gate (output)` | out: 1 while key held | 0/1 | - | - | output port |
| `vel (output)` | out: note velocity as delivered by the host (nih-plug NoteOn velocity) | 0..1 | - | - | output port |
| `trig (output)` | out: 1 for one sample at note-on | 0/1 | - | - | output port |
| `erste (output)` | out: 1 at the first use of a voice since reset | 0/1 | - | - | output port |

#### 1 `konst` (building block, type 1)

Constant value.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:89` (ARTEN entry); validation: finite (UnendlicherWert, uebersetzen.rs:201-203); meaning/DSP: baukasten_dsp/src/programm.rs:412.

Inputs (`ein`): none. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `wert` | the constant | unit of the receiving input | any finite f32 | required | required |

#### 2 `regler` (building block, type 2)

Maps one of the 8 knobs (plugin Knob 1..8, or `<channel>/bk/<nr>` in the core) from 0..1 to a range.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:90` (ARTEN entry); validation: uebersetzen.rs:219-221; meaning/DSP: baukasten_dsp/src/programm.rs:413-417.

Inputs (`ein`): none. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `nr` | knob number | index | integer 1..8 (reject) | required | required |
| `min` | value at knob 0 | unit of target | any finite; with log=1 must be > 0 (reject) | required | required |
| `max` | value at knob 1 | unit of target | any finite; with log=1 must be > 0 (reject) | required | required |
| `log` | 1 = exponential mapping min*(max/min)^k, 0 = linear | 0/1 | 0 or 1 (reject) | 0 | - |

#### 3 `saege` (building block, type 3)

Sawtooth oscillator, PolyBLEP, per voice.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:91` (ARTEN entry); validation: (hz clamped 0..sr/2); meaning/DSP: baukasten_dsp/src/osz.rs; programm.rs:418.

Inputs (`ein`): hz, sync. Outputs (`aus`): aus, zyklus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `hz` | frequency | Hz | 0..sr/2 (clamp) | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `sync` | hard sync: input >= 1 resets the phase; value above 1 = fraction of the sample since reset (output `zyklus` of a leading oscillator) | dimensionless | - | 0 (no default; unconnected input reads 0) | runtime-only; input port (edge or fixed value) |
| `aus (output)` | out: audio | - | -1..1 | - | output port |
| `zyklus (output)` | out: sync pulse (1 + fraction at phase wrap, else 0) | - | - | - | output port |

#### 4 `puls` (building block, type 4)

Pulse oscillator, PolyBLEP, with pulse width modulation.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:92` (ARTEN entry); validation: (hz clamped 0..sr/2; pwm clamped -1..1); meaning/DSP: baukasten_dsp/src/osz.rs; programm.rs:427.

Inputs (`ein`): hz, pwm, sync. Outputs (`aus`): aus, zyklus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `hz` | frequency | Hz | 0..sr/2 (clamp) | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `pwm` | pulse width offset: width = 0.5 + 0.45*pwm | -1..1 -> duty 5%..95% | -1..1 (clamp) | 0 (no default; unconnected input reads 0) | programm.rs:429; input port (edge or fixed value) |
| `sync` | hard sync: input >= 1 resets the phase; value above 1 = fraction of the sample since reset (output `zyklus` of a leading oscillator) | dimensionless | - | 0 (no default; unconnected input reads 0) | runtime-only; input port (edge or fixed value) |
| `aus (output)` | out: audio | - | - | - | output port |
| `zyklus (output)` | out: sync pulse | - | - | - | output port |

#### 5 `dreieck` (building block, type 5)

Triangle oscillator, PolyBLAMP.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:93` (ARTEN entry); validation: (hz clamped 0..sr/2); meaning/DSP: baukasten_dsp/src/osz.rs; programm.rs:436.

Inputs (`ein`): hz, sync. Outputs (`aus`): aus, zyklus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `hz` | frequency | Hz | 0..sr/2 (clamp) | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `sync` | hard sync: input >= 1 resets the phase; value above 1 = fraction of the sample since reset (output `zyklus` of a leading oscillator) | dimensionless | - | 0 (no default; unconnected input reads 0) | runtime-only; input port (edge or fixed value) |
| `aus (output)` | out: audio | - | - | - | output port |
| `zyklus (output)` | out: sync pulse | - | - | - | output port |

#### 6 `sinus` (building block, type 6)

Sine oscillator with linear FM through zero.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:94` (ARTEN entry); validation: (hz+fm clamped -sr/2..sr/2); meaning/DSP: baukasten_dsp/src/osz.rs; programm.rs:445.

Inputs (`ein`): hz, fm, sync. Outputs (`aus`): aus, zyklus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `hz` | frequency | Hz | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `fm` | frequency offset added to hz (linear FM in Hz, not phase modulation) | Hz | sum clamped to +-sr/2 | 0 (no default; unconnected input reads 0) | programm.rs:447; input port (edge or fixed value) |
| `sync` | hard sync: input >= 1 resets the phase; value above 1 = fraction of the sample since reset (output `zyklus` of a leading oscillator) | dimensionless | - | 0 (no default; unconnected input reads 0) | runtime-only; input port (edge or fixed value) |
| `aus (output)` | out: audio | - | - | - | output port |
| `zyklus (output)` | out: sync pulse | - | - | - | output port |

#### 7 `rauschen` (building block, type 7)

White noise, one generator per voice.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:95` (ARTEN entry); validation: none; meaning/DSP: baukasten_dsp/src/osz.rs (Rauschen); programm.rs:454.

Inputs (`ein`): none. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `aus (output)` | out: noise | - | - | - | output port |

#### 8 `lfo` (building block, type 8)

Low-frequency oscillator per voice (not band-limited); free-running or locked to the host beat.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:96` (ARTEN entry); validation: uebersetzen.rs:222-228; meaning/DSP: baukasten_dsp/src/lfo.rs; programm.rs:461-480.

Inputs (`ein`): rate, trig. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `form` | waveform | code | 0 sine, 1 triangle, 2 saw rising, 3 square, 4 random (new value per period) (reject otherwise) | 0 | - |
| `neustart` | restart the period at every note-on of the voice | 0/1 | 0 or 1 (reject) | 0 | - |
| `takt` | beat-locked: beats per period; 0 = free-running with rate | beats | 0..256 (reject) | 0 | phase from host beat, voices equal |
| `versatz` | phase origin at this beat | beats | 0..4096 (reject); needs takt>0 | 0 | - |
| `einmal` | 1 = run phase 0..1 once, then hold end value | 0/1 | 0 or 1 (reject); needs takt>0 | 0 | - |
| `rate` | frequency (ignored when takt > 0) | Hz | phase increment clamped 0..0.5 per sample = 0..sr/2 (lfo.rs:39) | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `trig` | restarts the period when neustart=1 | dimensionless | >0.5 = edge | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `aus (output)` | out: -1..1 | - | - | - | output port |

#### 9 `transponiere` (building block, type 9)

Frequency shifter in musical units: out = hz * 2^((st + cent/100)/12).

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:97` (ARTEN entry); validation: none; meaning/DSP: baukasten_dsp/src/programm.rs:481-488.

Inputs (`ein`): hz, st, cent. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `hz` | input frequency | Hz | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `st` | shift | semitones | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `cent` | fine shift | cent | - | 0 (no default; unconnected input reads 0) | 1 st = 100 cent; input port (edge or fixed value) |
| `aus (output)` | out: frequency | Hz | - | - | output port |

#### 10 `ladder` (building block, type 10)

4-pole low-pass ladder (TPT, tanh at the input), 303-like; resonance 1 self-oscillates.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:98` (ARTEN entry); validation: none (cutoff clamped 20..0.45*sr, reso clamped 0..1 at run time); meaning/DSP: rb_dsp/src/filter.rs:1-30; programm.rs:526-534.

Inputs (`ein`): x, cutoff, reso. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `x` | audio in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `cutoff` | cutoff | Hz | 20..0.45*sr (clamp) | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `reso` | resonance (feedback k = 4*reso) | 0..1 | 0..1 (clamp); smoothed per voice (programm.rs:530) | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `aus (output)` | out | - | - | - | output port |

#### 11 `svf` (building block, type 11)

State-variable filter (TPT, f64), outputs low-, band- and high-pass; 2 or 4 poles.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:99` (ARTEN entry); validation: uebersetzen.rs:280; meaning/DSP: baukasten_dsp/src/svf.rs; programm.rs:489-498.

Inputs (`ein`): x, cutoff, reso. Outputs (`aus`): tp, bp, hp.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `pole` | slope: 2 poles = 12 dB/oct, 4 poles = 24 dB/oct | poles | 2 or 4 (reject) | 2 | - |
| `x` | audio in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `cutoff` | cutoff | Hz | 20..0.45*sr (clamp) | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `reso` | resonance: 0 = Butterworth (Q 0.707), 1 = Q 25 | 0..1 | 0..1 (clamp) | 0 (no default; unconnected input reads 0) | svf.rs:1-5; input port (edge or fixed value) |
| `tp (output)` | out: low-pass | - | - | - | output port |
| `bp (output)` | out: band-pass | - | - | - | output port |
| `hp (output)` | out: high-pass | - | - | - | output port |

#### 12 `saett` (building block, type 12)

Saturation: tanh with first-order antiderivative antialiasing (ADAA1), per voice, no oversampling in the block.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:100` (ARTEN entry); validation: none (antrieb clamped -40..40 dB at run time); meaning/DSP: baukasten_dsp/src/programm.rs:499-507.

Inputs (`ein`): x, antrieb. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `x` | audio in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `antrieb` | drive before the curve | dB | -40..40 (clamp) | 0 (no default; unconnected input reads 0) | 0 dB when unconnected; input port (edge or fixed value) |
| `aus (output)` | out | - | - | - | output port |

#### 13 `glatt` (building block, type 13)

One-pole smoother with optional jump.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:101` (ARTEN entry); validation: uebersetzen.rs:309; meaning/DSP: baukasten_dsp/src/programm.rs:508-515.

Inputs (`ein`): x, setzen. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `zeit` | time constant (k = 1 - exp(-1/(zeit*sr))) | s | >= 0 (reject); 0 = no smoothing | 0.01 | - |
| `x` | input | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `setzen` | >= 0.5 sets the output to x at once | dimensionless | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `aus (output)` | out | - | - | - | output port |

#### 14 `adsr` (building block, type 14)

ADSR envelope per voice: attack linear, decay and release exponential (time to -60 dB).

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:102` (ARTEN entry); validation: none (a,d,s,r must be present as value or edge); meaning/DSP: baukasten_dsp/src/adsr.rs:1-4,22-60; programm.rs:535-544.

Inputs (`ein`): gate, trig, a, d, s, r. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `a` | attack time 0 -> 1 | s | used with min 0.0005 s | required | required |
| `d` | decay time to -60 dB toward sustain | s | used with min 0.001 s | required | required |
| `s` | sustain level | 0..1 | 0..1 (clamp) | required | required |
| `r` | release time to -60 dB | s | used with min 0.001 s | required | required; audio/signal input |
| `gate` | held | dimensionless | >0.5 | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `trig` | retrigger from the current value | dimensionless | >0.5 | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `aus (output)` | out | - | 0..1 | - | output port |

#### 15 `mul` (building block, type 15)

Multiply two signals.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:103` (ARTEN entry); validation: none; meaning/DSP: baukasten_dsp/src/programm.rs:545.

Inputs (`ein`): a, b. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `a` | factor | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `b` | factor | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `aus (output)` | out a*b | - | - | - | output port |

#### 16 `add` (building block, type 16)

Sum of four signals.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:104` (ARTEN entry); validation: none; meaning/DSP: baukasten_dsp/src/programm.rs:553.

Inputs (`ein`): a, b, c, d. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `a` | summand | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `b` | summand | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `c` | summand | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `d` | summand | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `aus (output)` | out | - | - | - | output port |

#### 17 `leitung` (building block, type 17)

Per-voice delay line with fractional delay (linear below 1 sample, Lagrange 3rd order above); an edge into `x` counts as delayed so cycles may run through it.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:105` (ARTEN entry); validation: uebersetzen.rs:249; meaning/DSP: baukasten_dsp/src/leitung.rs:1-4; programm.rs:516-525.

Inputs (`ein`): x, zeit, hz. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `zeit` | delay time (used when hz = 0) | ms | clamped 0..max | 10 | - |
| `hz` | delay as one period of this frequency: sr/hz samples; overrides zeit when > 0 | Hz | >0 active | 0 | - |
| `max` | buffer length | ms | 1..2000 (reject) | 1000 | - |
| `x` | signal in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `aus (output)` | out | - | - | - | output port |

#### 18 `chorus` (building block, type 18)

Juno-60-style BBD chorus (one line, two taps, shared triangle LFO), sum point over all voices, stereo out.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:106` (ARTEN entry); validation: uebersetzen.rs:265; meaning/DSP: baukasten_dsp/src/chorus.rs:1-8,12; programm.rs:561-570.

Inputs (`ein`): x, mix. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `modus` | mode: LFO rate / delay range | code | 0 off, 1 = I (0.513 Hz, 1.66-5.35 ms), 2 = II (0.863 Hz, 1.66-5.35 ms), 3 = I+II (9.75 Hz, 3.3-3.7 ms) (reject outside 0..3) | 1 | chorus.rs:12; wet low-pass 9 kHz, 2nd order |
| `mix` | wet level added to dry (out = x + mix*wet) | factor | not validated; no clamp | 1 | - |
| `x` | signal in (sum of voices) | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l (output)` | out left = dry + wet(A) | - | - | - | output port |
| `r (output)` | out right = dry + wet(B) | - | - | - | output port |

#### 19 `hall` (building block, type 19)

Cypher Hall (hall_dsp, spectral) as a sum point; structure values fixed at translation; the rest is hall_vorgabe() = hall_dsp defaults: low-cut 80 Hz, high-cut 12 kHz, diffusion 1, spectral duck 0, tail level 0 dB, freeze off (hall_dsp/src/lib.rs:49-67).

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:107` (ARTEN entry); validation: uebersetzen.rs:230-237; meaning/DSP: uebersetzen.rs:159-163 (hall_vorgabe), 464-479 (build arm); programm.rs:571-588.

Inputs (`ein`): x, l, r, mix. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `mix` | wet share; can be modulated by an edge | factor | not validated | 0.3 | - |
| `decay` | reverberation time T60 at 1 kHz | s | > 0 and <= 30 (reject) | 2 | - |
| `groesse` | length of the early-reflection region ("size") | ms | 5..200 (reject) | 60 | - |
| `pre` | pre-delay | ms | 0..250 (reject) | 10 | - |
| `frueh` | early reflection level relative to tail | factor | 0..1 (reject) | 0.5 | - |
| `breite` | stereo width | factor | 0..1 (reject) | 1 | - |
| `tief` | factor on decay time at 150 Hz | factor | 0.05..4 (reject) | 1.2 | - |
| `hoch` | factor on decay time at 8 kHz | factor | 0.05..4 (reject) | 0.6 | - |
| `rahmen` | FFT frame size | index | 0..4 = 512, 1024, 2048, 4096, 8192 (reject) | 2 | - |
| `x` | mono audio in (added to both sides) | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | left audio in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | right audio in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l (output)` | out: left | - | - | - | output port |
| `r (output)` | out: right | - | - | - | output port |

#### 20 `delay` (building block, type 20)

Stereo echo with feedback, damping low-pass, optional ping-pong; fixed time reads Thiran, modulated time Lagrange. Sum point.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:109` (ARTEN entry); validation: uebersetzen.rs:229,238-245; meaning/DSP: baukasten_dsp/src/echo.rs:1-4; programm.rs:589-608.

Inputs (`ein`): x, l, r, zeit, fb, mix. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `zeit` | delay time | ms | 1 .. max (reject if given as value); runtime clamp 1..max | 375 | - |
| `fb` | feedback | factor | 0..0.98 (reject) | 0.35 | - |
| `mix` | wet share (out = dry + mix*wet) | factor | 0..1 (reject) | 0.3 | - |
| `max` | maximum delay / buffer | ms | 10..4000 (reject) | 1000 | - |
| `daempf` | damping low-pass in the feedback path | Hz | 0 = off, or 200..20000 (reject) | 4000 | - |
| `glatt` | smoothing of time changes | ms | 0..2000 (reject); 0 = none | 100 | - |
| `pingpong` | ping-pong mode | 0/1 | 0 or 1 (reject) | 0 | - |
| `takt` | note value locked to host tempo: delay = takt beats; overrides zeit | beats | 0..16 (reject); 0 = off | 0 | programm.rs:591 |
| `x` | mono in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | left in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | right in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l (output)` | out: left | - | - | - | output port |
| `r (output)` | out: right | - | - | - | output port |

#### 21 `limiter` (building block, type 21)

Look-ahead brick-wall limiter (min-hold + release smoother + moving average), stereo-linked, sum point; adds latency along the graph.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:111` (ARTEN entry); validation: uebersetzen.rs:246-248; meaning/DSP: baukasten_dsp/src/limiter.rs:1-5; programm.rs:609.

Inputs (`ein`): x, l, r. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `decke` | ceiling | dBFS | -24..0 (reject) | -1 | - |
| `vorlauf` | look-ahead | ms | 0.5..5 (reject) | 2 | latency = round(vorlauf*sr/1000)-1 samples (uebersetzen.rs:416; limiter.rs:8) |
| `release` | release time | ms | 1..1000 (reject) | 60 | - |
| `x` | mono in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | left in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | right in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l (output)` | out: left | - | - | - | output port |
| `r (output)` | out: right | - | - | - | output port |

#### 22 `gate` (building block, type 22)

Stereo noise gate with hysteresis and optional key input, sum point.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:112` (ARTEN entry); validation: uebersetzen.rs:251-256; meaning/DSP: baukasten_dsp/src/gate.rs:1-4; programm.rs:613-622.

Inputs (`ein`): x, l, r, kl, kr. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `schwelle` | open threshold | dBFS | -90..0 (reject) | -50 | - |
| `hyst` | hysteresis: closes at schwelle - hyst | dB | 0..24 (reject) | 6 | - |
| `tiefe` | attenuation when closed | dB | 0..120 (reject) | 80 | - |
| `attack` | opening time | ms | 0.1..100 (reject) | 1 | - |
| `release` | closing time | ms | 1..5000 (reject) | 100 | - |
| `x` | mono in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | left in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | right in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `kl` | key input left (edges only) | - | - | 0 (no default; unconnected input reads 0) | value rejected; audio/signal input |
| `kr` | key input right (edges only) | - | - | 0 (no default; unconnected input reads 0) | one connected side feeds both; audio/signal input |
| `l (output)` | out: left | - | - | - | output port |
| `r (output)` | out: right | - | - | - | output port |

#### 23 `komp` (building block, type 23)

Compressor (komp_dsp, Giannoulis/Massberg/Reiss 2012) as sum point with optional key (sidechain) input.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:114` (ARTEN entry); validation: uebersetzen.rs:251,257-264; meaning/DSP: uebersetzen.rs:497-514 (build arm); komp_dsp/src/lib.rs:21-37.

Inputs (`ein`): x, l, r, kl, kr. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `schwelle` | threshold | dBFS | -60..0 (reject) | -18 | - |
| `ratio` | ratio | x:1 | 1..20 (reject) | 4 | - |
| `knie` | knee width | dB | 0..24 (reject) | 6 | - |
| `attack` | attack | ms | 0.1..200 (reject) | 10 | plugin range is 0.1..100 |
| `release` | release | ms | 5..2000 (reject) | 120 | plugin range is 10..1000 |
| `makeup` | make-up gain | dB | -12..24 (reject) | 0 | plugin range is 0..24 |
| `mix` | dry/wet (parallel compression) | factor | 0..1 (reject) | 1 | - |
| `schp` | high-pass in the detector (sidechain filter), 2nd order | Hz | 0 = off, or 20..500 (reject) | 0 | - |
| `x` | mono in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | left in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | right in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `kl` | key left (edges only) | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `kr` | key right (edges only) | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l (output)` | out: left | - | - | - | output port |
| `r (output)` | out: right | - | - | - | output port |

#### 24 `eingang` (building block, type 24)

Host audio input (effect graph), voice 0 only; at most one per graph.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:116` (ARTEN entry); validation: uebersetzen.rs:317-319 (MehrereEingaenge); meaning/DSP: baukasten_dsp/src/programm.rs:731.

Inputs (`ein`): none. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `l (output)` | out: host left | - | - | - | output port |
| `r (output)` | out: host right | - | - | - | output port |

#### 25 `ausgang` (building block, type 25)

Graph output: x to both channels, l left, r right; all voices summed. Required exactly (at least) once.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:117` (ARTEN entry); validation: uebersetzen.rs:320-322 (KeinAusgang if absent); meaning/DSP: baukasten_dsp/src/programm.rs:732-739.

Inputs (`ein`): x, l, r. Outputs (`aus`): none.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `x` | mono in (both sides) | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | left in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | right in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |

#### 26 `krume` (building block, type 26)

Bit-depth and sample-rate reduction (zero-order hold), per voice; no anti-imaging filter.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:119` (ARTEN entry); validation: none (bits clamped 1..24, rate clamped 1..sr at run time); meaning/DSP: baukasten_dsp/src/krume.rs:1-4,23-45; programm.rs:634-643.

Inputs (`ein`): x, bits, rate. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `bits` | word length; real-valued, q = 2^(bits-1) | bit | 1..24 (clamp) | 12 | - |
| `rate` | hold rate | Hz | 1..sr (clamp) | 26040 | non-finite input falls back to the node value |
| `x` | audio in | - | -1..1 (clamp inside quantizer) | 0 (no default; unconnected input reads 0) | audio/signal input |
| `aus (output)` | out | - | - | - | output port |

#### 27 `phaser` (building block, type 27)

Chain of first-order all-passes swept by a triangle LFO with feedback; port of beatfx.cpp PHASER. Sum point.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:120` (ARTEN entry); validation: uebersetzen.rs:266-267; meaning/DSP: baukasten_dsp/src/phaser.rs:1-4,74-80; programm.rs:644-652.

Inputs (`ein`): x, l, r, rate, tiefe, fb, mix. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `rate` | LFO rate | Hz | clamped 0..sr/2; 0 freezes the sweep at the middle | 0.3 | - |
| `tiefe` | sweep depth | factor | 0..1 (clamp) | 1 | - |
| `fb` | feedback from last stage | factor | -0.95..0.95 (clamp) | 0.5 | - |
| `mix` | dry/wet | factor | 0..1 (clamp) | 0.5 | - |
| `stufen` | number of all-pass stages | count | even integer 2..12 (reject) | 6 | - |
| `tief` | lower sweep limit | Hz | 0 < tief < hoch < sr/2 (reject) | 300 | - |
| `hoch` | upper sweep limit | Hz | see tief (reject) | 4800 | - |
| `breite` | phase offset of the right LFO relative to the left | degrees (breite/360 = fraction of a period, phaser.rs:38,47) | not validated | 90 | - |
| `x` | mono in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | left in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | right in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l (output)` | out: left | - | - | - | output port |
| `r (output)` | out: right | - | - | - | output port |

#### 28 `roehre` (building block, type 28)

One 12AX7 common-cathode triode stage (Koren), table + ADAA1 + 10 Hz coupling high-pass; optionally two stages in series.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:123` (ARTEN entry); validation: uebersetzen.rs:278-279; meaning/DSP: baukasten_dsp/src/roehre.rs:1-7,194-204; programm.rs:684-697.

Inputs (`ein`): x, antrieb, bias. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `antrieb` | drive | dB | -40..40 (clamp) | 0 | - |
| `bias` | grid bias | V | -3..-0.5 (reject) | -1.5 | an edge on bias selects among 11 pre-built tables |
| `stufen` | stages in series | count | 1 or 2 (reject) | 1 | stage 2 has drive 0 dB |
| `x` | audio in (x*10^(antrieb/20)*0.25 V at the grid) | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `aus (output)` | out | - | - | - | output port |

#### 29 `vocoder` (building block, type 29)

11-band channel vocoder: modulator (mean of l/r) envelope on carrier x; sibilance high-pass at 6 kHz. Sum point.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:125` (ARTEN entry); validation: uebersetzen.rs:268-272; meaning/DSP: baukasten_dsp/src/vocoder.rs:1-9,183-206; programm.rs:663-678.

Inputs (`ein`): x, l, r, zisch, mix. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `attack` | envelope follower attack | ms | 0.5..100 (reject) | 5 | - |
| `release` | envelope follower release | ms | 5..1000 (reject) | 30 | - |
| `pole` | band-pass slope | poles | 2 or 4 (reject) | 4 | band centres 200*25^(i/10) Hz, 200 Hz..5 kHz; needs sr >= 13 kHz |
| `zisch` | level of high-passed modulator (sibilance) | factor | 0..1 (clamp) | 0.3 | - |
| `mix` | 1 = vocoded, 0 = dry modulator | factor | 0..1 (clamp) | 1 | - |
| `x` | carrier in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | modulator left | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | modulator right | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l (output)` | out: left | - | - | - | output port |
| `r (output)` | out: right | - | - | - | output port |

#### 30 `sampler` (building block, type 30)

Plays a 48 kHz stereo f32 sample file (raw), one-shot or loop, slices, forward/reverse; Catmull-Rom.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:129` (ARTEN entry); validation: uebersetzen.rs:216-218; meaning/DSP: baukasten_dsp/src/sampler.rs:1-6,32-40,128-133; programm.rs:653-662.

Inputs (`ein`): hz, trig, gate, scheibe, rueck. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `datei` | file name in the sample root (named field of the node, not a value) | dimensionless | 5..64 chars, [A-Za-z0-9_.-], ends .f32, no `..` (reject) | 0 (no default; unconnected input reads 0) | required; sampler.rs name_pruefen |
| `grund` | root frequency of the sample | Hz | 20..2000 (reject) | 261.6256 | - |
| `scheiben` | number of equal slices | count | integer 1..64 (reject); >= 4 frames per slice | 1 | - |
| `schleife` | loop | 0/1 | 0 or 1 (reject) | 0 | - |
| `gate` | gate < 0.5 with schleife=1: the pass ends instead of wrapping (loop stops) | dimensionless | threshold 0.5 (sampler.rs:147) | 1 | defaults to 1 so a loop without gate edge keeps looping |
| `hz` | playback pitch: rate = hz/grund (x 48000/sr) | Hz | rate clamped 1/16..8 | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `trig` | start edge (rising through 0.5); starts the slice chosen by scheibe/rueck | dimensionless | >= 0.5 rising (sampler.rs:145-146) | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `scheibe` | slice index, rounded, wraps modulo scheiben | index | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `rueck` | reverse | dimensionless | >= 0.5 | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `l (output)` | out left | - | - | - | output port |
| `r (output)` | out right | - | - | - | output port |

#### 31 `faltung` (building block, type 31)

Convolution with an impulse-response file, zero added latency, uniform partitioned FFT; sum point; 48 kHz only.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:132` (ARTEN entry); validation: uebersetzen.rs:273-277; meaning/DSP: baukasten_dsp/src/faltung.rs:1-21; programm.rs:679-683.

Inputs (`ein`): x, l, r, mix. Outputs (`aus`): l, r.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `datei` | IR file name in the sample root (48 kHz stereo f32) | dimensionless | same rule as sampler | 0 (no default; unconnected input reads 0) | required |
| `mix` | dry/wet | factor | 0..1 (reject) | 1 | - |
| `pre` | pre-delay | ms | 0..250 (reject) | 0 | - |
| `laenge_max` | longest accepted IR | ms | 1..2000 (reject; file too long is an error) | 1000 | requires sr = 48000 (reject) |
| `x` | mono in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l` | left in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `r` | right in | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `l (output)` | out: left | - | - | - | output port |
| `r (output)` | out: right | - | - | - | output port |

#### 32 `wavetable` (building block, type 32)

Wavetable oscillator with 1..7 unison copies, band-limited mip maps; `aus` is the pan-free sum.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:134` (ARTEN entry); validation: uebersetzen.rs:281-288; meaning/DSP: baukasten_dsp/src/wavetable.rs:1-25,236-260; programm.rs:698-708.

Inputs (`ein`): hz, trig, pos, verstimmung, breite. Outputs (`aus`): l, r, aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `tabelle` | wavetable | index | 0 saege, 1 rechteck, 2 dreieck, 3 sinus, 4 analog, 5 vokale, 6 orgel (reject) | 0 | wavetable.rs:44 |
| `kopien` | unison copies; sum scaled 1/sqrt(n) | count | integer 1..7 (reject) | 1 | - |
| `pos` | morph position over the frames of the table | factor | 0..1 (reject for value) | 0 | smoothed by glatt |
| `verstimmung` | detune of the outermost copy; copies spread linearly +- | cent | 0..50 (reject) | 0 | - |
| `breite` | stereo spread of the copies (equal-power pan) | factor | 0..1 (reject) | 0 | - |
| `zufall` | how far apart the random start phases are | factor | 0..1 (reject) | 1 | 0 = all at phase 0 |
| `saat` | seed of the start phases | integer | integer 0..65535 (reject) | 0 | - |
| `glatt` | smoothing time of pos | ms | 0..1000 (reject) | 10 | 0 = none |
| `hz` | frequency | Hz | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `trig` | restarts copies at random phases | dimensionless | rising >0.5 | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `l (output)` | out left | - | - | - | output port |
| `r (output)` | out right | - | - | - | output port |
| `aus (output)` | out sum without pan | - | - | - | output port |

#### 33 `metall` (building block, type 33)

Metallic oscillator bank for hi-hats/cymbals: six TR-808 square oscillators + noise, 3 parallel band-passes, high-pass, envelope, choke.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:137` (ARTEN entry); validation: uebersetzen.rs:300-308; meaning/DSP: baukasten_dsp/src/metall.rs:1-33,56-62; programm.rs:718-721.

Inputs (`ein`): trig, vel, decay, tune, farbe, rauschen, hp, choke. Outputs (`aus`): aus, huelle.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `vel` | hit level | factor | 0..1 (reject) | 1 | - |
| `decay` | envelope time to -60 dB | s | 0.01..10 (reject) | 0.3 | - |
| `tune` | factor on all six oscillator frequencies (205.3, 304.4, 369.6, 522.7, 540.0, 800.0 Hz) | factor | 0.5..2 (reject) | 1 | - |
| `farbe` | weight over band-passes 3.5/7/10.5 kHz: 0 low, 0.5 mid, 1 high | factor | 0..1 (reject) | 0.5 | - |
| `rauschen` | noise share (equal power) | factor | 0..1 (reject) | 0.2 | - |
| `hp` | Butterworth high-pass 2nd order | Hz | 500..16000 (reject) | 6000 | - |
| `schnitt` | choke time to -60 dB | ms | 1..100 (reject) | 8 | - |
| `gruppe` | 1 = a trig on any other voice of the node chokes (open/closed hat) | 0/1 | 0 or 1 (reject) | 1 | - |
| `saat` | seed | integer | integer 0..65535 (reject) | 0 | - |
| `trig` | hit; sets envelope to vel | dimensionless | >0.5 | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `choke` | rising edge chokes the voice | dimensionless | >0.5 | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `aus (output)` | out: audio | - | - | - | output port |
| `huelle (output)` | out: envelope | - | - | - | output port |

#### 34 `resonator` (building block, type 34)

Modal resonator bank: up to 32 two-pole resonators per voice, 7 mode sets (physical models).

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:140` (ARTEN entry); validation: uebersetzen.rs:289-299; meaning/DSP: baukasten_dsp/src/resonator.rs:1-39,317-336; programm.rs:709-717.

Inputs (`ein`): hz, trig, staerke, x, material, helligkeit, groesse, position, inharmonie. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `satz` | mode set | index | 0 stab, 1 marimba, 2 glocke, 3 glas, 4 holzblock, 5 membran, 6 platte (reject) | 0 | resonator.rs:46 |
| `moden` | number of modes | count | integer 1..32 (reject) | 32 | - |
| `anregung` | excitation | code | 0 impulse, 1 noise burst (reject) | 0 | - |
| `burst` | noise burst length | ms | 0.5..50 (reject) | 5 | - |
| `saat` | seed | integer | integer 0..65535 (reject) | 0 | - |
| `staerke` | strike strength | factor | 0..10 (reject) | 1 | - |
| `material` | loss factor eta = 0.1*10^(-4*material); T60 = 2.198/(eta*f), clamped 1 ms..30 s | factor | 0..1 (reject) | 0.5 | 0 = felt-damped, 1 = bell bronze |
| `helligkeit` | mallet roll-off corner 50 Hz..25.6 kHz | factor | 0..1 (reject) | 0.5 | - |
| `groesse` | frequencies divided by it | factor | 0.25..4 (reject) | 1 | - |
| `position` | strike position, edge..centre | factor | 0..1 (reject) | 0.3 | - |
| `inharmonie` | 0 harmonic, 1 physical, up to 2 exaggerated | factor | 0..2 (reject) | 1 | - |
| `hz` | pitch of the ratio-1 mode (before groesse) | Hz | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `trig` | strike | dimensionless | rising >0.5 | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `x` | audio input drives the bank | - | - | 0 (no default; unconnected input reads 0) | audio/signal input |
| `aus (output)` | out | - | - | - | output port |

#### 35 `fm` (building block, type 35)

Six-operator phase-modulation FM, sixteen algorithms, ADSR per operator, feedback on the top operator, alias guard.

Definition: `djk/instrumente/baukasten_dsp/src/uebersetzen.rs:144` (ARTEN entry); validation: fm.rs:215-253 (via uebersetzen.rs:310); meaning/DSP: baukasten_dsp/src/fm.rs:1-37,186-262; programm.rs:722-730.

Inputs (`ein`): hz, gate, trig, vel, index, rueck, zeit. Outputs (`aus`): aus.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `algo` | algorithm (routing), 0..7 use operators 1..4, 8..15 use 1..6 | index | integer 0..15 (reject) | 0 | names: 0 "4>3>2>1", 1 "(4+3)>2>1", 2 "4>3>1, 2>1", 3 "2>1, 4>3", 4 "(4+3+2)>1", 5 "4>(3,2,1)", 6 "4>3>2, 1", 7 "1, 2, 3, 4", 8 "6>5>4>3>2>1", 9 "3>2>1, 6>5>4", 10 "2>1, 4>3, 6>5", 11 "2>1, 6>5>4>3", 12 "2>1, (6+5+4)>3", 13 "2>1, 6>(5,4,3)", 14 "6>5>4, 3, 2, 1", 15 "1, 2, 3, 4, 5, 6" (fm.rs:78-107; a>b = a modulates b) |
| `gate` | held | dimensionless | >0.5 | 1 | default 1 |
| `vel` | velocity | factor | 0..1 (reject) | 1 | - |
| `index` | factor on every modulator index (peak index = pegel*4*pi*index) | factor | 0..2 (reject) | 1 | - |
| `rueck` | feedback of the top operator, beta = rueck*1.5 rad | factor | 0..1 (reject) | 0 | - |
| `zeit` | factor on all decay and release times | factor | 0.05..20 (reject) | 1 | - |
| `anschlag` | how much a low velocity lowers modulator indices: q = index*(1 - anschlag*(1-vel)) | factor | 0..1 (reject) | 0 | fm.rs:561 |
| `sync` | a trig restarts operator phases and clears feedback | 0/1 | 0 or 1 (reject) | 1 | - |
| `hz` | base frequency | Hz | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `trig` | restarts operator phases when sync=1 | dimensionless | - | 0 (no default; unconnected input reads 0) | input port (edge or fixed value) |
| `o<n>_verh (n=1..6)` | frequency ratio of operator n (1..6) | ratio | 1/32..32 (reject) | 1 | default 1 |
| `o<n>_fein (n=1..6)` | fine detune of operator n; factor = verh*2^(fein/1200) | cent | -100..100 (reject) | 0 | default 0 |
| `o<n>_pegel (n=1..6)` | level: carrier = output level, modulator = index/INDEX_MAX | factor | 0..1 (reject) | 1 (o1) / 0 (o2..o6) | default 1 for o1, 0 for o2..o6 |
| `o<n>_a (n=1..6)` | attack of operator n | s | 0..20 (reject) | 0.001 | default 0.001 |
| `o<n>_d (n=1..6)` | decay of operator n (to -60 dB) | s | 0.001..60 (reject) | 1 | default 1 |
| `o<n>_s (n=1..6)` | sustain of operator n | factor | 0..1 (reject) | 1 | default 1 |
| `o<n>_r (n=1..6)` | release of operator n (to -60 dB) | s | 0.001..60 (reject) | 0.1 | default 0.1 |
| `aus (output)` | out | - | /aus/ <= 1 | - | output port |


### 2.A `granular` (type 36), building block (merged after this reference was written; line numbers refer to c7627f4a)

Status: merged into main as type 36 (b28f18ae).

Short grains of a generated source (no sample files), windowed with a Tukey window, per voice; `MAX_KOERNER` = 16 grains per voice (`granular.rs`); a start with a full pool is dropped, never cutting a sounding grain. Gain per grain 1/sqrt(max(1, dichte*groesse)). Randomness is a per-voice xorshift32 seeded by `saat` and the voice number (reproducible).

Inputs (`ein`): hz, trig, gate, x, groesse, dichte, pos, pos_zufall, tonhoehe, ton_zufall, breite, fenster, frieren. Outputs: l, r. No required values.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `quelle` | grain source | enum code | 0 wavetable, 1 puffer (ring buffer recording input `x`), 2 rauschen (internal white noise through the same buffer) (reject) | 0 | fixed value |
| `tabelle` | wavetable used by source 0 | enum code | 0 saege, 1 rechteck, 2 dreieck, 3 sinus, 4 analog, 5 vokale, 6 orgel (reject) | 0 | same table set as `wavetable` |
| `puffer` | ring buffer length (sources 1, 2) | s | 0.05..10 (reject) | 2 | |
| `grund` | root pitch of the recorded material (read rate = hz/grund * pitch) | Hz | 20..2000 (reject) | 261.6256 (C4) | |
| `streuung` | scatter of the interval between grain starts (+-100 % at 1) | 0..1 | 0..1 (reject) | 0 | mean interval stays 1/dichte |
| `saat` | random seed | integer | 0..65535 (reject) | 0 | |
| `hz` | pitch of the voice (input, normally from `note.hz`); 0 = no grains | Hz | 0..20000 (reject as value) | 261.6256 | input and value |
| `gate` | grains are started while gate >= 0.5 | 0/1 signal | - | 1 | input |
| `trig` | a rising edge starts one grain at once | edge | - | 0 | input |
| `x` | audio recorded by source 1 | - | - | 0 | audio input (summed over voices) |
| `groesse` | grain length | ms | 1..2000 (reject) | 80 | |
| `dichte` | grain starts per second | 1/s | 0..1000 (reject) | 20 | |
| `pos` | read position in the source (puffer: 0 newest, 1 oldest; wavetable: morph position over the frames) | 0..1 | 0..1 (reject) | 0 | |
| `pos_zufall` | random offset of position per grain | 0..1 | 0..1 (reject) | 0 | |
| `tonhoehe` | pitch shift of every grain | semitones | -48..48 (reject) | 0 | |
| `ton_zufall` | random pitch spread per grain | cent | 0..1200 (reject) | 0 | |
| `breite` | random pan spread per grain (equal power) | 0..1 | 0..1 (reject) | 0 | |
| `fenster` | window shape: 0 = Hann, 1 = nearly rectangular with 5 % edges | 0..1 | 0..1 (reject) | 0 | edge length (0.5 - 0.45*fenster) of the grain |
| `frieren` | freeze: stops writing the buffer when > 0.5; wavetable voices hold their position | 0/1 | - | 0 | input; not validated |


## 3. Built-in effects and mix tools of the core (C++, `djk/kern`)

Two groups, strictly separated because only the first one can be set by a user or an agent today.

- **3A. Reachable** from the UI / OSC contract. The mixer controls are the "Regler" of `djk/kern/stellwerk/src/regler.cpp` (table `ReglerTabelle`, built in the constructor `:70-236`). Count verified two ways: by arithmetic from the loops (14 source channels x 24 paths + 4 buses x 15 + 4 decks x 5 extra [4 stems + transport] = 416; + 20 globals + 161 arrangement + 96 channel graph knobs + 204 returns + 16 send-graph knobs = 913) and against the source comments ("204 controls" for the `ret` block `:190`, "indices 897..912" for the last 16 `fx/3|4/bk` entries `:226`) - both agree with **913 entries = 909 sound-relevant paths + 4 `deck/n/transport` holders** (the transport holders are not sound devices and are not listed). Set through `/k/teil` with the path field and the pattern in `djk/vertrag/schemas/defs.schema.json:16`; plus the dedicated OSC messages of `djk/vertrag/osc.json` (`/k/fx`, `/k/fx/zuweisung`, `/k/fx/routing`, `/k/arr/metronom`, `/k/schuss`, `/k/kanal/graph`) and the config file `kern.toml` (`djk/vertrag/konfig.schema.json`). Loop bounds: `SPUR_REGLER_SPUREN` 32, `GRP_REGLER_GRUPPEN` 8, `RET_REGLER_RETURNS` 4 (`stellwerk/include/cypherdj/stellwerk/regler.h:34,35,41`). I did not run the table; the count is from reading the code (flank).
- **3A.14-3A.17 (A8)**: Gate, Utility, Multiband and Channel limiter were library only at the time of the survey (`c7627f4a`); on branch `mix-werkzeuge` they are wired into the mixer through 344 per-channel rows (gate 9 x 13 source channels, utility 7 x 17 channels, multiband 24 x 4 buses, limiter 3 x 4 buses; the table is `djk/kern/stellwerk/include/cypherdj/stellwerk/werkzeug_regler.h`). Their sections below keep the library tables; the controller paths are the suffixes of that header (`gate/schwelle`, `util/breite`, `mb/tief/schwelle`, `lim/decke`). Multiband acts since A4, the channel limiter since A5b (only when built via `kern.toml`); the spectrum analyser (3B.5) is wired since A7b (`spektrum/kanal`, `/zustand/spektrum`).

Common conventions: paths are `<channel>/<field>` with channels `deck/1..4`, `erz/1..8`, `pad/1..2`, `bus/1..4` (`regler.cpp:78`; `mixer.cpp:19-21`). "Silent" is -200 dB, any value <= -120 dB counts as silent (`dsp/werte.h:16-17`). A value set with `dauer_beats = 0` is reached with the "ramp" given in the notes (ms). "dB" faders use the curve `fader_db`: UI position x -> -0 dB + 20*log10(x), below 0.001 silent (`regler.cpp:278`). Sample rate 48 kHz fixed (`werte.h:12`).

Counts 3A: 17 devices (3A.1-3A.13 as surveyed + 3A.14-3A.17 from A8), 1254 Regler paths (909 surveyed + 345 mix-tool rows, A8; the surveyed breakdown follows) (3A.1 175, 3A.2 108, 3A.3 18, 3A.4 2, 3A.5 112, 3A.6 4 inert, 3A.7 20, 3A.8 96, 3A.9 7, 3A.10 2, 3A.12 161, 3A.13 204; sum 909, checked) plus 20 non-Regler fields (OSC/config: 3A.3 1, 3A.6 12, 3A.8 2, 3A.9 1, 3A.11 4). Counts 3B (as surveyed; four of the five moved to 3A in A8): 5 library-only devices, 37 parameters (gate 7, utility 8, multiband 8 per band x 3 bands + 2 crossovers, channel limiter 4, spectrum 8; the multiband table lists one band's 8 plus the 2 crossovers = 10).

### 3A.1 Channel strip / Kanalzug, mix tool

Per channel: Trim -> LR8 isolator with kill -> DJ filter or Color FX -> [tap for PFL and metering] -> optional compressor, Baukasten graph and Beat-FX insert -> fader -> master (or bus) and sends 1..4 (post fader). Source: `dsp/include/cypherdj/dsp/kanalzug.h:1-4`, `kern/include/cypherdj/mixer.h:1-26`, controls `stellwerk/src/regler.cpp:88-110`, parallel table `dsp/include/cypherdj/dsp/regler.h:55-68`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `<ch>/fader` | channel fader (14 sources + 4 buses; buses: human only) | dB | -200 .. 0 (silent <= -120) | -200 (silent) | ramp 10 ms; `regler.cpp:88` |
| `<ch>/trim` | input gain | dB | -24 .. +24 | 0 (decks set it on load: `ziel_lufs - lufs_integriert`, clamped, `werte.h:50-52`; `ziel_lufs` config default -16) | ramp 10 ms; `regler.cpp:89` |
| `<ch>/send/1..4` | send level to bus fx/1..4, post fader | dB | -200 .. 0 | -200 | ramp 10 ms; `regler.cpp:97-101`; only fx/2 (hall) and fx/3, fx/4 (graph) have an effect, fx/1 none (`mixer.h:6-14`) |
| `<ch>/ziel` | routing target (sources only, not buses; human only) | code | integer 0..4 | 0 | 0 = master with crossfader weight, 1..4 = input of bus/n; 10 ms (480 samples) S-curve cross-blend (`mixer.h:11-12`); `regler.cpp:102` |
| `<ch>/xseite` | crossfader side (human only) | code | integer 0..2 | 1 | 0 = side A (attenuated for xfader > 0), 1 = through, 2 = side B (attenuated for xfader < 0); `mixer.h:297-301`; `regler.cpp:109` |
| `<ch>/pfl` | pre-fader listen to the cue bus (human only) | switch | 0/1 | 0 | `regler.cpp:110` |
| `deck/<n>/stem/drums`, `.../bass`, `.../vocals`, `.../other` | stem gain per deck (n=1..4, 16 paths) | dB | -200 .. +6 (UI curve linear -26..+6, below -26 = silent) | 0 | ramp 10 ms; `regler.cpp:103-108`; effect of stems is marked "later slice" in the mixer (`mixer.h` `MixRolle::spaeter`) - not verified in the audio path |
| `keylock` | pitch lock for all decks, loop boxes and loops (one global switch) | switch | 0/1 | 1 | `regler.cpp:147-150`; config `keylock`, `keylock_maschine` (r3 / bungee / bungee_fein) in `konfig.schema.json` |

Counts: 14 source channels x 9 (fader, trim, send 1-4, ziel, xseite, pfl) + 4 buses x 8 (no ziel) = 158 paths, + 16 stem paths + 1 keylock = 175. Full per-channel total including EQ, kill, filter, compressor: source channel 24, bus 15, plus 5 per deck (4 stems + transport).

### 3A.2 Isolator EQ with kill (Kanalzug band split), mix tool

Three-band isolator, Linkwitz-Riley 8th order at **246 Hz and 2484 Hz** (constructor defaults, `dsp/include/cypherdj/dsp/isolator.h:65`; construction `dsp/src/isolator.cpp:5-12`); output = low*g_low + mid*g_mid + high*g_high; band gain = EQ x (1 - kill). Crossover frequencies are fixed (not exposed). Controls `stellwerk/src/regler.cpp:90-95`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `<ch>/eq/tief` | low-band gain (below 246 Hz) | dB | -200 .. +6 (UI curve: linear -26 .. +6, position 0 = silent via `kill_unter_min`) | 0 | ramp 10 ms; `regler.cpp:44,90` |
| `<ch>/eq/mitte` | mid-band gain (246..2484 Hz) | dB | -200 .. +6 | 0 | `regler.cpp:91` |
| `<ch>/eq/hoch` | high-band gain (above 2484 Hz) | dB | -200 .. +6 | 0 | `regler.cpp:92` |
| `<ch>/kill/tief` `.../mitte` `.../hoch` | mutes the band | switch | 0/1 | 0 | ramp 5 ms, 2nd-order S ramp (`dsp/regler.h:62-64`); `regler.cpp:93-95` |

Counts: 18 channels x 6 = 108 paths.

### 3A.3 DJ filter (`<ch>/filter`), effect

One knob k: k < 0 low-pass 20 kHz -> 60 Hz, k > 0 high-pass 20 Hz -> 8 kHz, both exponential: fc_lp = 20000*(60/20000)^(-k), fc_hp = 20*(8000/20)^(k) (`dsp/src/djfilter.cpp:43-54`). Dead zone: wet share = min(1, |k|/0.05), dry bit-exact at k = 0 (`djfilter.cpp:56`, `djfilter.h:1-6`). TPT state-variable filters, resonance selectable. This is also the COLOR knob of Color FX (3A.4). Source: `djfilter.h`, `regler.cpp:96`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `<ch>/filter` | filter position | -1..1 (dimensionless) | -1 .. +1 | 0 | ramp 20 ms one-pole smoothing (`dsp/regler.h:65`); `regler.cpp:96`; 18 paths |
| `filter_guete` (config `kern.toml`) | Q of both sides; at the corner |H| = Q | Q (dimensionless) | 0.5 .. 4 (clamped) | 0.707 | `djfilter.h:13-20`, `konfig.schema.json` (min 0.5, max 4.0). NB the comment in `mixer.h:~135` says "0,5 bis 8" - stale; the code clamps at 4 (`kGueteMax`), set to 4 on 2026-09-26 because Q 8 lifted sub-bass by up to +18 dB (`djfilter.h:16-17`) |

### 3A.4 Color FX (`color/art`, `color/param`), effect

Pioneer-DJM-style "SOUND COLOR FX" on the COLOR knob `<ch>/filter` (k in [-1,1]); art and parameter are global, applied per channel strip. Common behaviour: dead zone |k| < 0.05 is dry (bit-identical unless a tail is still running); amount a = (|k| - 0.05)/0.95 (`colorfx.cpp:17-21`); changing the art clears the states. The numbers are set, not measured on a console; listening comparison with Andreas open (`colorfx.h:119-120`). Source: `dsp/include/cypherdj/dsp/colorfx.h:1-14,133-135`, `dsp/src/colorfx.cpp`, controls `regler.cpp:153-156`, wiring `kanalzug.h:69-73`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `color/art` | effect type | code | integer 0..5 | 0 | 0 FILTER (the DJ filter itself), 1 SPACE, 2 DUB ECHO, 3 SWEEP, 4 NOISE, 5 CRUSH; `regler.cpp:155` |
| `color/param` | PARAMETER of the selected type | 0..1 | 0 .. 1 | 0.5 | ramp 10 ms; `regler.cpp:156`; NaN -> 0.5 (`colorfx.cpp:99`) |

Behaviour per art (all constants from `colorfx.cpp`):

| art | k < 0 (left) | k > 0 (right) | `color/param` p |
|---|---|---|---|
| 1 SPACE (:127-188) | reverb (4-line FDN + 2 all-pass diffusers/channel) fed by low-pass 2.5 kHz | fed by high-pass 350 Hz | T60 = 0.8 + 3.2*p s (0.8..4 s); wet 0.7; tail runs on after the knob returns to centre; gain glide 50 ms |
| 2 DUB ECHO (:190-233) | echo of 3/4 beat (clamped 480 samples .. 2 s), repeats band-passed 1 kHz (Q 0.9) | repeats high-passed 2.5 kHz | feedback = 0.35 + 0.55*p (0.35..0.9); time glide 80 ms; tail continues |
| 3 SWEEP (:235-271) | gate (envelope threshold = peak*a*(0.1 + 0.7*p)) | band-pass, Q = 0.7 + 9.3*a^2, centre fc = 150 * (10000/150)^p Hz | 0 .. 1: gate threshold / centre frequency 150 Hz .. 10 kHz |
| 4 NOISE (:273-295) | white noise through low-pass 18 kHz -> 250 Hz (exp. with a) | through high-pass 250 Hz -> 14 kHz | noise level = -36 + 30*p dBFS (-36..-6 dBFS), mixed in scaled with a |
| 5 CRUSH (:297-334) | bit crush + sample-and-hold + tanh drive | same, then high-pass 20 Hz -> 8 kHz | effect strength s = 0.3 + 0.7*p: bits = 15 - 12*a*s (levels 2^(15-12*depth)), hold up to 1 + 23*depth^2 samples, drive 1 + 5*depth |

### 3A.5 Channel compressor (`<ch>/komp/*`), effect

Cypher Komp (Rust `komp_dsp` via `hall_ffi`, see 1.2) per source channel (not buses), placed on the tap after EQ and filter, before the fader; knee fixed at 6 dB and detector high-pass 0 Hz (`mixer.cpp:235`: `CypherKompEinstellung e{w[1].w, w[2].w, 6.0, w[3].w, w[4].w, w[5].w, w[6].w, 0.0}`). Source: `regler.cpp:111-121`, `mixer.cpp:231-245`, `kern/include/cypherdj/komp.h:1-6`. Gain reduction is reported by `/zustand/komp` (`osc.json`, field `gr_db` in dB).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `<ch>/komp/an` | compressor on | switch | 0/1 | 0 | no ramp; `regler.cpp:112` |
| `<ch>/komp/schwelle` | threshold | dB | -60 .. 0 | -18 | ramp 10 ms; `regler.cpp:113` |
| `<ch>/komp/ratio` | ratio | x:1 | 1 .. 20 | 4 | `regler.cpp:114` |
| `<ch>/komp/attack` | attack | ms | 0.1 .. 100 | 10 | `regler.cpp:115` |
| `<ch>/komp/release` | release | ms | 10 .. 1000 | 120 | `regler.cpp:116` |
| `<ch>/komp/makeup` | make-up gain | dB | 0 .. 24 | 0 | `regler.cpp:117` |
| `<ch>/komp/mix` | dry/wet | factor 0..1 | 0 .. 1 | 1 | `regler.cpp:118` |
| `<ch>/komp/sc` | sidechain key | code | integer 0..14 | 0 | 0 = own signal, n = source channel n-1 in the order deck/1..4, erz/1..8, pad/1..2 (1 = deck/1, 5 = erz/1, 14 = pad/2); key is the channel input before trim and EQ (`mixer.cpp:236-241`); `regler.cpp:119-120` |

Counts: 14 source channels x 8 = 112 paths (no bus has `komp/*`, `regler.cpp:111`).

### 3A.6 Beat FX (two units), effect

Two serial units FX1, FX2 per assignable channel (`deck/1`, `deck/2`, `erz/1..3`, `pad/1`, `pad/2`, and `master`); beat-synchronous; LFO phase comes from the absolute beat, so two starts in the same bar sound the same. Wet glides over 480 samples (10 ms); OFF only closes the input, the tail rings out. Source: `kern/include/cypherdj/beatfx.h:1-50`, `kern/src/beatfx.cpp:100-212`, `kern/src/mixer.cpp:562-587`, `mixer.h:149-166`, CLI summary `erzeuger/djk-fx:1-16`.

OSC messages (`vertrag/osc.json`, section 4.10):

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `/k/fx` `einheit` | unit | number | 1 .. 2 | - | |
| `/k/fx` `art` | effect type | code | 1 .. 12 | - | 1 ECHO, 2 FLANGER, 3 PHASER, 4 FILTER, 5 REVERB, 6 DELAY, 7 PINGPONG, 8 TRANS, 9 ROLL, 10 SLIPROLL, 11 VINYL, 12 SPIRAL (`beatfx.h:25`); 0 = AUS appears only in `/e/fx` reports |
| `/k/fx` `beats` | period / delay length / decay length | beats | one of 0.25, 0.5, 1, 2, 4, 8, 16 | - | `osc.json` `werte.fx_beats` |
| `/k/fx` `wet` | wet amount ("depth") | factor | 0 .. 1 | - | |
| `/k/fx` `param1` | main parameter, meaning per art (table below) | factor | 0 .. 1 | 0.5 in the DSP object | `beatfx.h:61` |
| `/k/fx` `param2`, `param3` | reserved | factor | 0 .. 1 | 0.5 | stored and reported, no DSP effect (`mixer.cpp:568-569`, `mixer.h:154-156`) |
| `/k/fx` `an` | unit on | code | 0 .. 1 | - | |
| `/k/fx/zuweisung` `einheit`, `kanal`, `an` | assign a unit to a channel | number, path, code | 1..2; `deck/1, deck/2, erz/1, erz/2, erz/3, pad/1, pad/2, master`; 0/1 | - | assignments independent per channel and unit |
| `/k/fx/routing` `routing` | place of the FX in the strip | code | 0 .. 1 | 0 | 0 post fader, 1 insert before the fader (`mixer.h:183`) |

Behaviour per art (period `T = beats * samples-per-beat`; `p` = param1):

| art | what happens | param1 |
|---|---|---|
| 1 ECHO | delay T, feedback | feedback = 0.9*p |
| 2 FLANGER | delay 1..5 ms (48 + 192*triangle samples), LFO period T | feedback = 0.9*p |
| 3 PHASER | 6 first-order all-passes, fc = 300 * 2^(4*triangle) Hz (300..4800 Hz), LFO period T | resonance (feedback) = 0.9*p |
| 4 FILTER | state-variable low-pass, fc = 200 * 2^(5*(0.5 - 0.5*cos 2*pi*phase)) Hz (200..6400 Hz), period T | Q = 0.7 + 7.3*p |
| 5 REVERB | Cypher Hall, T60 at 1 kHz = T; wet path delayed by 256 samples (5.33 ms), taken off the pre-delay | SIZE: early region 10 + 110*p ms, pre-delay 2 + 28*p ms (minus the block delay) |
| 6 DELAY | one repeat after T, no feedback | TONE: low-pass of the repeat 1 kHz * 2^(4.3*p) |
| 7 PINGPONG | repeats alternate L/R, spacing T | feedback = 0.9*p |
| 8 TRANS | gate in time, period T, 96-sample (2 ms) edges | duty = 0.1 + 0.8*p |
| 9 ROLL | records from ON and repeats a loop of length T (64-sample seams) | none |
| 10 SLIPROLL | like ROLL, records anew when the beat length changes | none |
| 11 VINYL | read speed falls linearly to 0 over T (brake), last eighth fades | none |
| 12 SPIRAL | echo with all-pass in the feedback, delay time glides (tau 80 ms) so pitch moves | feedback = 0.95*p |

Also defined in the Regler table but **not wired** (mapped to `MixRolle::spaeter`, `mixer.cpp:103`): `fx/1/notenwert`, `fx/2/notenwert` (1/32 .. 4 beats, default 0.75, `regler.cpp:133-136`) and `fx/1/rueckkopplung`, `fx/2/rueckkopplung` (0 .. 0.95, default 0.5, `regler.cpp:137-140`).

### 3A.7 Send returns (fx/1..4) and the send-2 hall, effect

Sends 1..4 collect into the sums fx/1..4. fx/2 is **Cypher Hall** (Rust `hall_dsp` through `hall_ffi`) with a fixed setting - there is no user control for its parameters, only the return level; fx/3 and fx/4 host a Baukasten effect graph (loaded with `/k/kanal/graph`, section 2); fx/1 has no effect. Source: `mixer.h:6-14`, `mixer.cpp:48,625-657,688`, `hall_ffi/src/lib.rs:61-80` (`cypher_hall_vorgabe`: pre-delay 20 ms, size 60 ms, T60 2.0 s, low-decay factor 1.5, high-decay factor 0.6, low-cut 80 Hz, high-cut 12 kHz, diffusion 1, width 1, duck 0, freeze off, frame size index 2 = 2048, early 0.5, tail 0 dB; wet only because `mix` = 1). The hall sleeps until a send feeds it and rings out until quiet (`mixer.cpp:629-635`).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `fx/1/rueckweg` .. `fx/4/rueckweg` | return level into the master sum | dB | -200 .. 0 | 0 | ramp 10 ms; `regler.cpp:141-144`; fx/1 has no effect |
| `fx/3/bk/1..8`, `fx/4/bk/1..8` | Baukasten graph knobs of the send graph | normalised | 0 .. 1 | 0.5 | ramp 0 (FFI smooths 20 ms); `regler.cpp:231-236` |

### 3A.8 Baukasten graph on a channel (`<ch>/bk/1..8`), instrument / effect host

A Baukasten graph (section 2) can run as an insert on `deck/1..4` (effect, after the compressor, before the Beat-FX insert; `mixer.h:57-60`) or as an instrument on the channels a `/erz/strom` stream targets with `bk:<name>` (erz/1..3, erz/5..7, pad/1..2; erz/4 is reserved for production, erz/8 is the cue-only preview). The eight knobs feed the graph's `regler` nodes. Source: `regler.cpp:183-193`, `osc.json` (`/k/kanal/graph`, `/erz/strom`).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `<ch>/bk/1..8` for ch in deck/1..4, erz/1,2,3,5,6,7, pad/1,2 | graph knob n | normalised | 0 .. 1 | 0.5 | ramp 0 (FFI smooths 20 ms); 12 channels x 8 = 96 paths; `regler.cpp:187-192` |
| `/k/kanal/graph` `kanal`, `name` | load graph `name` on channel (`deck/1..4`, `fx/3`, `fx/4`) | path, text | channel from `werte.graph_kanal` | - | `osc.json` section 4.10 |

### 3A.9 Master section, mix tool

Chain: sum of all channels (+ metronome, FX returns) -> master Beat-FX (unit assigned to `master`) -> "Kleber" bus compressor -> `master/pegel` -> master limiter. Cue: PFL sum and optionally master, mixed by `cue/mix`. Source: `mixer.h:1-26,140-147`, `mixer.cpp:701-712`, `regler.cpp:125-132`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `xfader` | crossfader position (human only) | -1..1 | -1 .. +1 | 0 | additive law with exponent 1: side A weight = 1 - max(0, x), side B = 1 - max(0, -x) (`mixer.h:297-301`); `regler.cpp:127` |
| `master/pegel` | master level, after the Kleber, before the limiter (human only) | dB | -200 .. 0 | 0 | ramp 10 ms; `regler.cpp:128` |
| `master/kleber` | threshold of the 2:1 bus compressor; 0 = off | 0..1 | 0 .. 1 | 0 | threshold = 6 - 36*a dB on the detector |L|+|R| (a = 0: +60 dB = off); fixed ratio 2, attack 0.03 s, release 0.2 s (Faust `co.compressor_stereo(2, schwelle, 0.03, 0.2)`, `kern/gen/kleber.dsp:2-5`); human only; `regler.cpp:129`, `mixer.cpp:701-704` |
| `master/pfl` | master onto the PFL side of the cue | switch | 0/1 | 0 | human only; `regler.cpp:152` |
| `cue/mix` | cue blend PFL <-> master | -1..1 | -1 .. +1 | -1 | -1 = only PFL; `mixer.h:19-20`; human only; `regler.cpp:130` |
| `cue/pegel` | headphone level | dB | -200 .. 0 | -12 | human only; `regler.cpp:131` |
| `cue/split` | split cue (left = PFL mono, right = master mono) | switch | 0/1 | 0 | human only; `regler.cpp:132` |
| `limiter_dbtp` (config `kern.toml`) | master limiter ceiling (true peak) | dBTP | no range in the schema | -1.0 | `konfig.schema.json`; limiter timing fixed: attack ramp 64 samples, hold 8 samples each side, release time constant 50 ms (`kern/dsp/messer/include/cypherdj/dsp/master_limiter.h:22-27`, 8x Kaiser + 4x libebur128 true-peak detection, :1-20) |

### 3A.10 Sidechain duck (`duck/*`), mix tool

A kick event ducks `erz/2` and `erz/3` (the bass and pad channels of the generator): linear attack over 240 samples (5 ms), exponential recovery with 5 tau = release (`duck.h:1-12,79-88`; wiring `mixer.h` `MixRolle::duck_*`, `duck_ausloesen`).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `duck/tiefe` | depth of the duck | dB | -24 .. 0 | 0 (off) | ramp 10 ms; applies per trigger; `regler.cpp:145` |
| `duck/release` | recovery time (5 tau = 99 %) | ms | 50 .. 600 | 200 | no ramp; `regler.cpp:146` |

### 3A.11 Metronome and one-shot level, tool

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `/k/arr/metronom` `an` | metronome on | switch | 0/1 | - | `osc.json` 4.11; `arr_metronom.cpp:20-23` |
| `/k/arr/metronom` `pegel_db` | level of the accented click (other beats at half level) | dB | -60 .. 0 | - | `arr_metronom.cpp:1-2,22` |
| `/k/arr/metronom` `ziel` | where it sounds | code | 0 .. 1 | - | 0 master (before the limiter), 1 cue |
| `/k/schuss` `pegel_db` | level of a one-shot ("Schuss") on pad 1..2 | dB | no range in the contract | - | `osc.json` 4.6 |

### 3A.11b Sound-relevant config keys (`kern.toml`, schema `djk/vertrag/konfig.schema.json`, parser `kern/src/konfig.cpp:17,85-88`)

| key | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `ziel_lufs` | loudness target; a deck's trim is set at load to `ziel_lufs - lufs_integriert` | LUFS | no range in schema | -16 | covers `<ch>/trim` of decks |
| `limiter_dbtp` | master limiter ceiling | dBTP | no range in schema | -1.0 | see 3A.9 |
| `filter_guete` | DJ filter Q | Q | 0.5 .. 4.0 | 0.707 | see 3A.3 |
| `keylock`, `keylock_maschine` | keylock on/off at start; time-stretch engine | bool; enum | `r3`, `bungee`, `bungee_fein` | true; `r3` | `bungee*` only in a kernel built with `CYPHERDJ_BUNGEE`; audible quality only (grain 512 / 256) |
| `hoerbar_db` | audibility threshold for the "deck is open / audible" logic (trim + fader > threshold) | dB | no range in schema | -26 | not a sound device: only drives `deck_offen`/`deck_hoerbar` (`kern_deck.cpp:697,705`) |
| `tief_offen_db` | parsed and stored, **no consumer found outside the parser** (`konfig.h:21`; grep over `djk/**/*.{h,cpp}` excluding tests) | dB | no range in schema | -12 | purpose unknown from code; the spec reference is `§1.6, M18` (`kern.toml:15`) |

### 3A.12 Arrangement mixer: track, group and production-master strips, mix tool

32 tracks `spur/1..32`, 8 groups `grp/1..8` and the production master `pm`; global paths (no channel). The arrangement module feeds erz/4 (`mixer.h:51-52`). Controls `regler.cpp:157-182`, curve `K_SPUR_FADER` (`regler.cpp:43`).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `spur/<n>/fader` (n=1..32), `grp/<n>/fader` (n=1..8) | fader | dB | -200 .. +6 | 0 | ramp 10 ms; `regler.cpp:162,174` |
| `spur/<n>/pan`, `grp/<n>/pan` | balance | -1..1 | -1 .. +1 | 0 | ramp 10 ms; `regler.cpp:164,176` ("balance like grp pan", `regler.cpp:196`) |
| `spur/<n>/mute`, `grp/<n>/mute` | mute | switch | 0/1 | 0 | no ramp (10 ms blend in the arrangement module); `regler.cpp:166,178` |
| `spur/<n>/solo`, `grp/<n>/solo` | solo | switch | 0/1 | 0 | `regler.cpp:168,180` |
| `pm/fader` | production-master fader | dB | -200 .. +6 | 0 | `regler.cpp:182` |

Counts: 32 x 4 + 8 x 4 + 1 = 161 paths.

### 3A.13 Arrangement returns `ret/1..4` with Cypher Hall and track/group sends, effect

Four returns; each track and group can send to each return (post fader). Each return has a Cypher Hall whose values are normalised 0..1 and mapped in `kern/src/arr_returns.cpp:17-33`; fixed there: early 0.5, high-decay factor 0.6, low-cut 80 Hz, duck 0, freeze off, frame size 1024. Controls `regler.cpp:194-226`; the name `ret/<r>/hall/pre` is the pre-delay, not a pre/post switch (`regler.cpp:198`).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `spur/<n>/send/<r>` (n=1..32), `grp/<n>/send/<r>` (n=1..8), r=1..4 | send level to return r | dB | -200 .. +6 | -200 | ramp 10 ms; 160 paths; `regler.cpp:200-207` |
| `ret/<r>/fader` | return level | dB | -200 .. +6 | 0 | `regler.cpp:208-209` |
| `ret/<r>/pan` | return balance | -1..1 | -1 .. +1 | 0 | |
| `ret/<r>/mute`, `ret/<r>/solo` | mute / solo | switch | 0/1 | 0 | |
| `ret/<r>/hall/an` | hall on | switch | 0/1 | 1 | no ramp; `regler.cpp:216-217` |
| `ret/<r>/hall/pre` | pre-delay | normalised -> ms | 0 .. 1 -> 0 .. 250 ms linear | 0.04 (10 ms) | `arr_returns.cpp:20` |
| `ret/<r>/hall/decay` | T60 at 1 kHz | normalised -> s | 0 .. 1 -> 0.1 * 300^k = 0.1 .. 30 s | 0.5252 (2.0 s) | `arr_returns.cpp:21` |
| `ret/<r>/hall/groesse` | size of the early region | normalised -> ms | 0 .. 1 -> 5 .. 200 ms linear | 0.282 (60 ms) | `arr_returns.cpp:22` |
| `ret/<r>/hall/tief` | low-decay factor | normalised -> factor | 0 .. 1 -> 0.25 * 16^k = 0.25 .. 4 | 0.5658 (1.2) | `arr_returns.cpp:23` |
| `ret/<r>/hall/highcut` | high-cut of the wet signal | normalised -> Hz | 0 .. 1 -> 1000 * 22^k = 1 kHz .. 22 kHz | 0.8039 (12 kHz) | `arr_returns.cpp:24` |
| `ret/<r>/hall/fahne` | tail level | normalised -> dB | 0 .. 1 -> -24 + 36*k = -24 .. +12 dB | 0.66667 (0 dB) | `arr_returns.cpp:25` |

Defaults checked by recomputing the mapping: 0.5252 -> 2.00 s, 0.5658 -> 1.20, 0.8039 -> 12.0 kHz (hand calculation). Counts: 160 sends + 4 x (4 + 1 + 6) = 204 paths.

### 3A.14 Gate (`dsp/gate.h`), effect - wired in A8 (`<ch>/gate/*`, 13 source channels)

Stereo-linked noise gate with hysteresis, hold, downward-expander curve and optional sidechain; 0 latency; gain moves linearly in amplitude. Source: `dsp/include/cypherdj/dsp/gate.h:1-35` (struct `GateParameter` :27-35), clamps `dsp/src/gate.cpp:24-30`. Wired into the mixer in A8 (see the controller rows in 3A.14).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `schwelle_db` | open threshold | dBFS | -90 .. 0 | -40 | |
| `hysterese_db` | closes at threshold minus this | dB | 0 .. 24 | 4 | |
| `ratio` | expansion ratio; >= 100 = hard gate | x:1 | 1 .. 100 | 100 | 1 = no gating |
| `bereich_db` | floor (range) when closed | dB | -120 .. 0 | -80 | <= -120 = fully closed |
| `attack_ms` | floor -> 0 dB | ms | 0.1 .. 500 | 1 | |
| `hold_ms` | hold before closing | ms | 0 .. 2000 | 20 | |
| `release_ms` | 0 dB -> floor | ms | 1 .. 5000 | 100 | detector decay fixed at 10 ms (`kGateDetektorAbfallMs`) |

### 3A.15 Utility (`dsp/utility.h`), mix tool - wired in A8 (`<ch>/util/*`, 13 source channels and 4 buses)

Channel tool: optional DC blocker (-3 dB at 5 Hz) -> optional bass mono (LR8 split) -> 2x2 matrix of gain, balance, width (M/S), swap and phase invert; all changes ramp 10 ms; neutral = bit-identical. Source: `dsp/include/cypherdj/dsp/utility.h:1-39,104-114`, clamps `dsp/src/utility.cpp:48-60`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `gain_db` | gain | dB | -120 .. +24 | 0 | <= -120 = silent (exactly 0) |
| `balance` | balance, linear law | -1..1 | -1 .. +1 | 0 | +0.5 = left at 0.5 (-6.02 dB), right 1 |
| `breite_prozent` | stereo width (M/S) | % | 0 .. 200 | 100 | 0 mono, 200 side doubled |
| `bass_mono_hz` | bass-mono crossover; lows summed to mono | Hz | 0 = off, else 20 .. 500 | 0 | |
| `phase_umkehren_l`, `phase_umkehren_r` | invert polarity of input L / R | bool | false/true | false | |
| `seiten_tauschen` | swap L/R (after the polarity invert) | bool | false/true | false | |
| `dc_sperre` | DC blocker | bool | false/true | false | |

### 3A.16 Multiband compressor (`dsp/multiband.h`), effect - wired in A8 (`bus/n/mb/*`), processing since A4

Three bands, LR8 crossovers (default 200 Hz and 2000 Hz), stereo-linked detection on max(|L|,|R|) of the band, soft knee, smooth decoupled peak detector (Giannoulis et al. 2012), automatic make-up plus trim, solo, bypass; 0 latency. Source: `dsp/include/cypherdj/dsp/multiband.h:1-17,28-46,71-81`; clamps `dsp/src/multiband.cpp:94-95,131-136`. Per band (`Band::tief`, `mitte`, `hoch`; struct `MbBandEinstellung`) via `setze_band`, crossovers via `setze_grenzen` (clamped to [20 Hz, 0.45 fs], high raised to at least low).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `schwelle_db` | threshold (band level, sample peak) | dBFS | -60 .. 0 | 0 | |
| `verhaeltnis` | ratio | x:1 | 1 .. 20 | 1 | 1 = no compression |
| `anstieg_ms` | attack time constant | ms | 0.1 .. 500 | 10 | |
| `abklingen_ms` | release time constant | ms | 1 .. 5000 | 100 | |
| `knie_db` | knee width | dB | 0 .. 24 | 0 | 0 = hard |
| `aufholen_db` | make-up trim, added to the automatic make-up | dB | -24 .. +24 | 0 | the automatic part (`aufholen_auto`, on in the Mixer) adds back the band's average gain reduction, mean time 500 ms rising / 100 ms falling, capped at +24 dB |
| `solo` | solo band | bool | false/true | false | switching ramps 5 ms |
| `umgehen` | bypass band | bool | false/true | false | |
| `grenze_tief_hz` (`setze_grenzen`) | lower crossover | Hz | 20 .. 0.45*fs | 200 | constructor default `multiband.h:71` |
| `grenze_hoch_hz` (`setze_grenzen`) | upper crossover | Hz | low .. 0.45*fs | 2000 | |

### 3A.17 Channel limiter (`dsp/kanal_limiter.h`), effect - wired in A8 (`bus/n/lim/*`), processing since A5b

Brick-wall peak limiter with look-ahead, stereo-linked, optional true-peak detection (4x Kaiser interpolation, 97 taps); latency = attack + hold (+12 in true-peak mode). Source: `dsp/include/cypherdj/dsp/kanal_limiter.h:1-22,149-154`, clamps `dsp/src/kanal_limiter.cpp:41,51,56`. Not the master limiter (that is `messer/master_limiter.h`, 3A.9).

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `decke_db` | ceiling | dBFS (dBTP in true-peak mode) | -60 .. 0 | -0.3 | `setze_decke_db` at run time |
| `vorhalt_ms` | look-ahead = attack ramp | ms | 0.1 .. 20 | 1.5 | fixed after construction |
| `abklingen_ms` | release time constant | ms | 1 .. 2000 | 80 | `setze_abklingen_ms` at run time |
| `echtspitze` | true-peak detection | bool | false/true | false | fixed after construction |

### 3B.5 Spectrum analyser (`dsp/spektrum.h`), analysis tool - no sound output, wired since A7b (`spektrum/kanal`, `/zustand/spektrum`)

Mono-sum ring buffer -> Hann FFT -> log-spaced bands with smoothing and peak hold, for a UI; analysis only. Source: `dsp/include/cypherdj/dsp/spektrum.h:1-22,46-55`, clamps `dsp/src/spektrum.cpp:76-84,146-152`.

| parameter id | meaning | unit | range | default | notes |
|---|---|---|---|---|---|
| `groesse` | FFT size | samples | 1024, 2048 or 4096 | 2048 | invalid -> 2048 |
| `ueberlappung` | frames per FFT length (hop = groesse/ueberlappung) | count | 1, 2, 4 or 8 | 4 | invalid -> 4 |
| `baender_pro_oktave` | band resolution | bands/octave | 1 .. 24 | 6 | |
| `f_min_hz` | lowest band centre | Hz | >= 1 | 20 | |
| `f_max_hz` | highest band centre | Hz | <= fs/2 | 20000 | |
| `glaettung_ms` | smoothing time constant (power domain) | ms | 0 .. 10000 | 100 | 0 = off |
| `halten_ms` | peak hold | ms | 0 .. 10000 | 1000 | |
| `fallen_db_pro_s` | peak fall after the hold | dB/s | 0 .. 1000 | 20 | |


## 4. Unresolved, not covered, and flanks

Not resolved or deliberately outside this reference (with the reason):

1. **`djk/klang`, `djk/wirte/carla`, `djk/erzeuger`, `djk/loops`** (Python/Node tooling that selects, hosts or renders sounds, including the Carla plug-in host for the VST3s): not examined as devices. They configure or call the devices above rather than being new devices; I did not read them, so a device defined only there (for example a Python-side sound generator) would be missing here.
2. **UI side** (`djk/leitstand`, `oberflaeche`): only the existence of `leitstand/src/regler_info.ts` was noted; which Regler the UI actually shows was not read. This reference lists what the core accepts.
3. **Library-only devices (3B)** (A8: gate, utility, multiband and channel limiter now have controller rows, see 3A.14-3A.17; the spectrum analyser stays) as surveyed: gate, utility, multiband, channel limiter, spectrum analyser: no consumer outside `kern/dsp` and its tests (grep method and positive control in item 13). Their parameters are C++ API parameters, not user controls in this snapshot. Note that the Baukasten has its own `gate`, `limiter`, `komp` blocks (section 2), which are separate implementations.
4. **Inert Regler**: `fx/1|2/notenwert` and `fx/1|2/rueckkopplung` exist in the table but are mapped to `MixRolle::spaeter` (no effect, `mixer.cpp:103`); Beat-FX `param2`/`param3` carry no DSP; `tief_offen_db` has no consumer; `deck/n/stem/*` is marked "later slice" in the mixer headers and I did not verify that stems act on the audio path (flank).
5. **Core send-2 hall** (`fx/2`, Cypher Hall) has no user parameters beyond the return level; the FX1 send bus has no effect at all.
6. **Faust `gen/zita_hall.dsp`** is legacy (replaced 2026-10-11, `mixer.cpp:629` comment); not described as a device. `gen/kleber.dsp` is live (Kleber, 3A.9).
7. **Baukasten `phaser.breite`**: unit degrees from the code (`breite_grad`, `/360`, `phaser.rs:38,47`); the struct field comment at `phaser.rs:16` calls the stored value a fraction of a period, which is consistent with /360. No open problem, listed because the name does not show the unit.
8. **`mixer.h` comment** says the DJ filter Q clamps "0.5 to 8"; the code and `konfig.schema.json` say 0.5..4.0 (stale comment, 3A.3).
9. **Values that differ between places for the same effect**: Baukasten `hall` accepts `tief`/`hoch` 0.05..4, the plug-in `lowx` 0.25..4 and `highx` 0.1..2, the arrangement return maps `ret/<r>/hall/tief` to 0.25..4; Baukasten `komp` accepts attack 0.1..200 ms, release 5..2000 ms, make-up -12..24 dB, the plug-in and channel compressor 0.1..100, 10..1000, 0..24. Use the range of the place where the setting is made.
10. **Sample-rate dependent limits**: the Baukasten validation uses the host sample rate for a few checks (phaser `hoch` < sr/2, vocoder sr >= 13 kHz, faltung sr == 48 kHz, delay/limiter sample counts); cut-off limits written as "sr/2" in the block tables mean Nyquist at the current rate. The core runs at 48 kHz fixed (`dsp/werte.h:12`), the plug-ins at the host rate.
11. **Typical values**: this file lists ranges and defaults from the code. It does not say which values are typical in mixing practice (that is the book lookup the reader intends). Where the code names its literature it is quoted in the device text: Giannoulis, Massberg, Reiss 2012 (Komp, multiband), Bilbao et al. 2017 (Saett ADAA1), TR-303 / TR-808 / Juno-60 as stated in the module comments of RB-338, `ladder`, `metall`, `chorus`.
12. **Core table not executed**: `kern/stellwerk/werkzeug/regler_liste.cpp` is a tool that presumably prints the Regler table; building and running it would confirm the 913-entry count and every range/default directly (next step; I did not build anything).
13. **Library-only grep method (item 3)**: `grep -rIl` over `djk/` for the class names `MultibandKompressor`, `KanalLimiter`, `SpektrumAnalysator`, `GateParameter`, `UtilityParameter` and the five header paths, excluding `target`, `.git`, `node_modules`, then dropping hits under `kern/dsp/`: zero hits remained. Positive control with the same exclusions: `Kanalzug` does hit outside `kern/dsp` (`kern/src/mixer.cpp`, `kern/stellwerk/src/regler.cpp`). Not searched: other repositories, and dynamic loading by name (not used in C++ here as far as I saw).
