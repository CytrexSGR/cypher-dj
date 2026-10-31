# ADR 008: Mixer, pre-listen, measuring tap and recording

- **Status:** accepted; cue on the real interface provisional (M1); listening-certificate thresholds provisional (M18)
- **Date:** 2026-09-23
- **Requirements carried:** A4, A5, A6, A11, A15, A17, A21
- **Related to:** ADR 003, 012, 016, 023

## Context

A4: "measured for the AI, pre-listen on a second output for Andreas". A5: EQ to swap, not only filter.
Latency compensation between parallel paths exists only within one program (Carla does not compensate, 04 §3.1).
The draft "robustness" let the AI measurement and Andreas' cue share the same tap; "AI" separates them. "Robustness"
records at the Notbahn outputs, "AI" and "Spiel (play)" in the core.

## Decision

1. **Mixer in the core, own code** (Faust for fixed DSP blocks, C++ for everything the clock knows): channel strip
   per deck, generator channel, pad and group bus: trim (on load `ziel_lufs` minus LUFS of the version, −24 to +24 dB)
   → **LR8 isolator 246/2484 Hz** with kill (second-order ramps 5 ms) → TPT filter on one control (20 ms smoothed)
   → **PFL tap (pre-fader listen) and measuring tap** → channel fader → crossfader assignment (Mixxx curves) → four
   sends after the fader → **destination** master or one of four group buses (A17; assignment table instead of
   fixed paths, `SCHNITTSTELLEN.md` §1.5).
2. **Master:** sum → FX returns (beat-synchronous echo as a hybrid with two read heads from the clock, reverb as a
   Faust block) → limiter with look-ahead (Faust `co.limiter_lad_stereo`, unmeasured) → guards (NaN, DC, clip).
3. **Cue** on outputs 3/4 of the same interface: PFL after EQ and filter, before the fader; delayed by the limiter
   look-ahead (latency-equal to master); headphone mix of cue against master and split, as in Mixxx. Through the
   same Notbahn as the master.
4. **Measuring tap separate from the cue:** at the same point (after EQ, before the fader) **every** channel always
   runs a meter (peak, true peak, LUFS M/S via libebur128, band level, envelopes of the **six analysis bands** Sub
   to Hoch with 1 kHz into the ring for analysis, `SCHNITTSTELLEN.md` §6.2; the workshop computes the same filters
   for the reference). Cypher's listening passs arise only there; Andreas' headphones stay his. The key
   **"Listen to Cypher"** deliberately puts Cypher's suggested channel on Andreas' PFL.
5. **New sources start silent:** every channel (deck, generator, pad, host return) is at −200 dB after loading or
   creating; a plan may make it audible only with a valid listening pass (invariant I3, ADR 023).
6. **Recording** in its own unit at the **Notbahn outputs** (what really sounds, including Notbahn loops), with the
   core sample of the first frame.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Faust standard LR4 as isolator | middle kill only 34.4 dB, misses "kill > 40 dB" | 04 §4.1 |
| Butterworth crossover | sum +2.94 dB at the crossover points | 04 §4.1 |
| EQ as plugin (a-EQ) | does not return bit-exactly to "0" (−0.04 dB, smoothing stops 0.05 dB short of the target) | 05 §4.1 |
| hard-switched delay | clicks in 160 of 160 blocks of the ramp (−39.9 dBFS) | 04 §4.3 |
| AI measures at the cue tap | Cypher would occupy Andreas' headphones or have to wait; A4 separates "measured" and "pre-listen" | A4 verbatim; judge 3 |
| recording in the core ring | records before the Notbahn: Notbahn loops and seam errors missing from the recording | judge 3 on "AI" |
| `pw-record` as recorder | lost whole blocks under load | 01 §4.4, 02 risk 5 |

## Consequences

- The isolator boundaries 246/2484 Hz are the Mixxx default, one parameter; whether they suit Andreas' habits, he
  sets live.
- Cross energies of the prediction must be calculated with exactly these filters (ADR 012).
- Split halves the pre-listen to mono per ear; emergency route only.
- The measuring tap costs compute per channel; calculated below 2 % of the 256 budget for four decks plus four effects.

## Evidence

04 §3.1 (graph, Mixxx `enginemixer.cpp` 394 to 405, 830 to 840), §4.1 (LR8 middle kill 74.6 dB, set to −12 dB =
−11.995 dB, neutral 0.0000 dB), §4.2 (second-order kill ramp 5 ms: −97.68 instead of −60.38 dBFS), §4.3 to 4.5
(hybrid with S-corners −144.51 dBFS), §4.6 (TPT filter smoothed −102.26 dBFS), §4.7 (libebur128 −22.993 LUFS at
target −23.0), §4.8 (LR8 5.4 to 10.9 µs per channel and block); 01 §4.4. All 04 figures offline, dossier 04 unchecked.

## Reversed if

Andreas wants other EQ curves or boundaries in the listening session (parameters, not architecture); M1 shows that
the interface has only two outputs (then split until the new device).
