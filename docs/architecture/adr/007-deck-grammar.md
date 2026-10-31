# ADR 007: Deck grammar

- **Status:** accepted (hand latency on the stretcher path provisional, M3; roll buffer after M6)
- **Date:** 2026-09-23
- **Requirements carried:** A14, A9, A1
- **Related to:** ADR 020, 005, 014, 023

## Context

A14: "we will loop a lot, sometimes also jump, possibly live"; beat loop, loop roll (track keeps running), beat jump,
hot cues, quantized. Mixxx has the grammar, but it cannot be detached; its pattern is read in 03 §3.2.
Two Mixxx gaps: the shadow head counts with the rate from switch-on, jumps happen "immediately" instead of "at beat X".
02 NP K9/K10: a hand jump with keylock needs lead-in or a pre-filled second stretcher; DJs expect
"immediately phase-true".

## Decision

1. **Own build after the Mixxx pattern:** a "band" in front of the stretcher carries out loop, band roll with shadow, beat jump,
   hot cue and stem mix exactly to the sample; jumps cross-fade in the band (128 frames), the stretcher is not
   reset. The shadow runs along on the band (one band frame per frame read), independent of tempo.
2. **Every command carries a target beat.** Beat loop 1/32 beat up to 32 bars (start: at `ab_beat`), halve,
   double; beat jump ±1/32 up to 128 beats, in an active loop it shifts the loop (Mixxx default, Andreas can
   overturn it); 8 hot cues per deck, phase-true (target = hot cue position plus phase within the beat); CDJ cue; slip switch.
3. **Hand quantize per listening path:**
   - **Direct path:** hand grabs act "immediately phase-true" one period after the MIDI event, or
     with quantize on the next grid point of the chosen size.
   - **Stretcher path:** the grab lands on the **next reachable grid point**, which is at least
     work lead plus band lead away (calculated about 102 ms at 256 with R3); without quantize about 125 ms
     after the grab. A pre-filled "jump machine" comes only if M2b and the listening session demand it.
4. **Roll:** on the direct path band roll with shadow (measured). On the stretcher path from slice 5 a **roll buffer
   behind the keylock** in the channel strip (repetition from the already computed output, deck keeps running inaudibly),
   the same code as beat repeat for generator and pad channels; only after M6.
5. **For Cypher** deck grabs are discrete plan parts in the Stellwerk (interlocking) (with `plan`, `gruppe`, `hoerschein`,
   `INTERFACES.md` §4.4); a deck that Andreas touched in the last 8 bars (holder "discrete") is not jumped
   or looped by Cypher, it only proposes (reason `deck_beruehrt`). A jump or hot cue by Cypher on an
   **open** deck brings new content to the master and needs a target within the measured range of a valid
   listening check or Andreas' acceptance (I3d, ADR 023); otherwise it becomes a proposal. Loop and roll are free.
6. **Raster by hand:** nudge via encoder as anchor shift in steps of 0.5 ms with 128-frame fade, tap
   in pre-listen, **shift plus tap sets bar one** (A13); everything produces a correction per section
   (`/e/raster`), which the control desk writes into `korrekturen.jsonl` and from which the workshop renders a **new version** (ADR 015);
   the loaded version never changes.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Mixxx as deck engine | clock belongs to Mixxx; script timer ≥ 20 ms | A14, 09 §3.3 |
| Mixxx shadow with rate from switch-on | tempo change in the middle of a roll: −1 322.62 frames = −27.6 ms | 03 §3.3, §4d |
| Jump "immediately" without target beat for Cypher | AI loses plannability | 03 §3.3 |
| Jump machine from the start | largest state machine in the real-time path, unmeasured; quantized grabs land exactly without it | judge 3 on "playability"; 02 NP K9 |
| Reset the stretcher on every jump | cushion plus delay 85.3 ms with R3 | 02 check c, NP K9 |

## Consequences

- Hand jumps without quantize during a tempo deviation are about 125 ms late (calculated); in the normal case
  (direct path, 128) one period.
- The return position after a roll is exact on the band (0.0 frames) and acoustically identical with R3
  (kick onset −0.00 samples); Bungee and Signalsmith scatter 1.5 ms.

## Evidence

03 §3.2 (Mixxx passages), §3.3, §4d (band 0.0 frames; naive roll −150 447.76 frames = −7 beats; beat jump +4 exact),
§4a (band lead R3 3 884.9 frames = 80.9 ms, Bungee 2 659.3 = 55.4 ms); 02 NP K9, K10; 08 NP K4 (grid scatters across
the track 100 ms, correction per section needed); 07 `c_drift.log` (pulse clarity MiniMax 0.03 to 0.24); 09 NP "What
is missing" (discrete plan parts).

## Overturned if

M3 shows that 4 blocks of lead do not suffice (hand latency rises); Andreas finds the hand jumps during tempo runs
too sluggish in the listening session (then jump machine after M2b); M6 shows that the roll buffer is not grid-true in ramps.
