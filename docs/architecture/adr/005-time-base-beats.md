# ADR 005: Time base of commands and lateness

- **Status:** accepted
- **Date:** 2026-09-23
- **Requirements carried:** A1, A14, A20, A21
- **Related to:** ADR 004, 007, 023

## Context

Commands come from Andreas' hand, from the control station (for Cypher and Andreas' macros), from generators. Open
was in which time they talk and what happens to late ones: 02 and 09 (principle 5) want to discard, 03 §3.4 wants to
push them to the next grid step, 02 NP K11 warns that a discarded fader-close is dangerous.

## Decision

1. **Musical time is the beat** (`f64`, quarter note, beat 0 = set start, 1 bar = 4 beats, 1 phrase = 8 bars = 32
   beats). All processes except the hand send commands with target beat on the core clock. Never milliseconds, never
   OSC timestamps, never "now" from the AI.
2. **The hand** comes as JACK-MIDI with sample offset and takes effect one period after the grab, at the right sample.
3. **Lateness per command type** (field `politik` in every command, `INTERFACES.md` §16):
   - `musik` (generator events, AI plan parts, deck starts from plans): too late = **discarded and reported**;
   - `zustand` (fader close, kill, stop, fade out, stop button): too late = **executed in the next cycle with a
     10-ms ramp and reported**;
   - `raster` (deck grabs: loop, jump, hotcue from a macro): too late = **placed on the next reachable grid point** of
     the given grid size and reported.
4. **Receipt** for every command: `angenommen`, `gestartet`, `fertig`, `verspaetet_verworfen`,
   `verspaetet_ausgefuehrt`, `abgelehnt` (with reason), `abgebrochen` (with reason), `storniert`.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| milliseconds or wall clock | tempo change after sending: up to 554 samples (11.5 ms) off; without stamp median 12 ms, up to 29 ms | 02 NP N1; 06 §4.1 run 4; 01 §4.3 ("now" −2.42 to +5.25 ms) |
| OSC bundle with timestamp | late ones are played "immediately" (OSC 1.0) | 02 §3.2 |
| always discard | a fader-close 3 ms too late would be discarded | 02 NP K11, N2 |
| always execute late | music events would come as a burst | 06 §4.1 run 4 (without stamp 48 events up to 5.78 s late) |

## Consequences

- Planners must keep lead time (`INTERFACES.md` §3): control parts at least 2 cycles, deck grabs on the stretcher
  path at least work lead-in plus buffer lead.
- "Exact or reported" is the core's promise; a command never sounds silently at the wrong place.

## Evidence

02 check b, NP N1, N2 (margin from 4.58 ms: 12 of 12 exact, below that reported, none at the wrong place), K10, K11;
06 check a (295 of 295 frame-exact with beat stamp); 01 check a3; 09 §3.3 principles.

## Revisit if

Never fundamentally; individual policies may change after listening experience (the journal shows every lateness).
