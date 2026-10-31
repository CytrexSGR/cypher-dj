# ADR 006: Keylock engine per use

- **Status:** provisional; measurements M3 (real time in work threads, pull mode), M4 (ramps, small factor changes,
  Bungee pitch scan), M19 (large stretch factors when reading in) and the listening session M18 (R3 against Bungee) are outstanding;
  corrected after the re-check of dossier 01 (K1 to K4) on 2026-09-23
- **Date:** 2026-09-23
- **Requirements carried:** A9, A10, A12
- **Related to:** ADR 020 (listening paths), 011 (workshop)

## Context

A10: pitch preservation "is mandatory for everything". A12: every loop is stretched once offline to the set base,
live the keylock only does the deviation. The bench (`tests/stretch-bench/ERGEBNIS.md`, workbench (Werkbank)) tested 59
configurations in the browser, dossier 03 seven machines natively (offline, unchecked).

## Decision

| Use | Engine | Setting |
|---|---|---|
| Reading in (base file, stems) | **Rubber Band R3 offline** (library or `rubberband -3 --timemap`) | float in and out, **−12 dB headroom before stretching**, trim on loading from `ziel_lufs`; timemap from the tempo map onto the rigid grid of the set base; tuning correction in the same run (`SCHNITTSTELLEN.md` §12.3). Pitch measured only for factors up to about 5 % away from 1 (0.95522 and 1.04121); MiniMax songs need 0.71 to 1.42 (c_drift: 89.9 to 180.7 BPM): therefore half/double tempo choice and gate `streckfaktor` ±15 % until M19 |
| Single hits, pads | **R3 offline** pre-rendered to the set base, played without stretcher | re-render when the set base changes |
| Live on tempo deviation | **Rubber Band R3 native** (3.3.0), `OptionProcessRealTime \| OptionEngineFiner \| OptionChannelsTogether`, in work threads with lead-in (default 4 blocks, M3); **at most 2 R3 per work thread** (01 NP K1), so 4 stretchers means at least 2 threads | **Start:** create in the loading thread, feed `getPreferredStartPad()`, discard `getStartDelay()` **and run one pull cycle including `retrieve`**, only then hand over via the queue to the work thread (01 NP K3: otherwise the first block costs 4.6 to 6.4 ms); also applies to the restart path and the warm-up of the shadow stretcher. Factor change 50 ms before the rate change (timing, 03 §4b2); phase control; at most 4 real-time stretchers at the same time |
| Second choice live | **Bungee 2.4.30** behind the same machine interface | M4 (2026-09-25, E8): technically viable (bass tones 0.04 ct against R3 0.75 ct, real time 0 zero samples); only the listening session is open |
| never | R2, SoundTouch, Signalsmith | see below |

At factor 1 there is **no** stretcher in the listening path (ADR 020).

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Rubber Band R2 | deep pure tones keep the shifted pitch (110 Hz → 105.074 Hz, also in the official program) | 03 §4c |
| SoundTouch | drifts on tempo changes (−3.867 ms in 30 min), latency varies with music 5 to 7.5 ms per beat; breaks up 30.87 Hz (−79.7 ct) | 03 §4a; ERGEBNIS §2.2, §2.1 |
| Signalsmith | pitch in no configuration (+13.4 to +34.1 ct on the sine, overtones of deep bass tones shifted up to 67.2 ct) | ERGEBNIS §2.1 |
| R3 directly in the callback | bursty computing load: p99.9 3.8 ms, maximum 14.7 ms per 256 block; stem deck 16 blocks over budget | 03 §4e |
| Double node from the bench | **deferred, not refuted.** It was built only for WASM (wrapper around `reset()` on every factor change). The 50 ms lead (+0.01/−0.11 ms, 03 §4b2) proves only the timing of a native single node. The only native **pitch** measurement of a factor change (one node, without `reset`, without lead) was 95 ms over 10 ct and had 128 zero samples, worse than the double node with 27.5 ms. With lead the single node is unmeasured for pitch: M4 decides; until then there are no factor jumps live (ADR 004) | ERGEBNIS §2.3, §2.6 (lines 180, 185 to 187), 03 §4b2 |
| R3 always in the listening path (also at factor 1) | at 1.0 not transparent (artifacts −63.7 dB instead of −102.8), softer transients | 03 §4c; ERGEBNIS §2.5; ADR 020 |

## Consequences

- Sound not heard yet: R3 makes snare and hats measurably softer (pre-echo +4.5 / +7.5 dB, kick rise 9.07 instead of 3.09 ms;
  measured offline in the OfflineAudioContext on the WASM path, native unmeasured). Listening sample R3 against Bungee at the listening session.
- Tempo ramps are measured natively only for timing (02 NP N5), pitch in ramps not (ERGEBNIS §8: jumps only):
  M4.
- Capacity for the worst case: if the set deviates from the base, **all** audible and pre-listened decks compute
  at the same time (01 NP K4); factor 1 lowers only the average. Cheaper option `OptionWindowShort` (R3 short): 2.5 %
  instead of 7.4 % of a thread per stretcher, but artifacts −29.2 instead of −42.3 dB (01 NP K2, 03 §4c); the sound
  price is decided by Andreas at the bench, not by this ADR.
- The command line clamps at ±1.0 even with `--ignore-clipping` (08 NP K5): hence the −12 dB headroom.
- License GPL (internally without consequence); Bungee MPL would be freely redistributable.

## Evidence

ERGEBNIS §1 (R3 the only one of 59 configurations across all four gates: G1 ±0.2 ct, G2 0.18 ms, G3 2.05 dB, G4 rtf_4
2.73), §2.1 (pitch scan 30.87 to 261.63 Hz, fundamentals 0.00 ct), §2.6; 03 §4a (30 min, 100 tempo changes: R3 −0.105 ms,
Bungee −0.026 ms), §4b, §4b2, §4c (R3 110.000 Hz), §4d (after roll simultaneously, −0.00 samples), §4e (Bungee p99.9
161.6 µs), §4f (shots 0.13 to 0.31 s, length ±0.4 frames); **01 NP K1** (pull mode, how a deck computes: 8 R3 with two
phases in the real callback 377 overruns in 60 s, 0 of 111 beat intervals exact; one thread carries 2 R3 safely, 4
barely; the earlier statement "8 staggered with 120 µs reserve" from 01 §4.5 applied only in print mode without deck semantics),
**01 NP K3** (first block of a fresh R3 4.6 to 6.4 ms; after a pull cycle with `retrieve` 0.25 to 0.32 ms,
measured offline only); 02 check c (cushion and delay 2 048 samples each); 07 `b_timemap.log` (timemap R3: residual
0.19 ms RMS, max 0.58 ms; R2 1.94 ms; without 45.26 ms; **rated: proves the timemap mechanism on a synthetic
click with known truth, the timemap comes from the true beat times; via the tempo map from beat_this on
MiniMax songs it says nothing, M13 measures that**), `b_strecken.log` (R3 110.000 Hz, bass −0.11 ct, only factor 134/128).

## Overturned if

M3 shows underruns with R3 in work threads at 4 decks and 2 R3 per thread (then more threads, R3 short, Bungee
or fewer keylock decks); M4 shows pitch errors or zero samples in ramps or at small factor changes
(then double node native); M19 shows that R3 suffers audibly at factors around 0.7 or 1.4 (then tighter gate
`streckfaktor`, generation closer to the set base); Andreas prefers Bungee at the listening session (then Bungee live, R3
offline).


## Addendum 2026-09-23 13:3x
PRELIMINARY, 2026-09-23 13:3x: the re-check of dossier 01 measures R3 in FIFO work threads with lead-in, with 8 per thread without underrun (16 on 2 and 32 on 4 threads, limit only at 16 per thread; SCHED_OTHER instead of FIFO: 23 underruns). M3 (slice 30) decides the limit. The upper limits "2 R3 per work thread" and "4 real-time stretchers" in this ADR and in ADR 020 count as provisional until then; stems with keylock are feasible after this measurement.

## Addendum 2026-09-25: M19 measured

`tor_streckfaktor` 0.20 (previously 0.15; with the coarse 30 ms control 0.30 would have passed, the stricter value applies), `stimmung_max_cent` 35 holds on 167 tones. Finding on line decay: R3 misses individual stationary tones between 120 and 138 Hz by up to 28 ct, already at 128/134, offline as well as in real-time mode, not from the timemap; `--window-short` is clean in 24 of 24. To check in M4/M18: R3 short for tonal decks. Evidence `messungen/M19-keylock-gross/BERICHT.md`.
