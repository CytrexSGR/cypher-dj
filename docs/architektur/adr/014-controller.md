# ADR 014: Controller for Andreas

- **Status:** provisional, measurement M17 (Andreas' device) is outstanding
- **Date:** 2026-09-23
- **Requirements carried:** A1, A5, A7, A14, A26
- **Related to:** ADR 007, 013, 023

## Context

Andreas' controller is unknown (A26); `hidapi` is missing on the DJ machine (09 §3.7). Measured is the path with a
software sender: USB MIDI → ALSA → MIDI bridge → JACK MIDI, one period later at the correct sample (09 probe c,
NP). The re-check found two traps: an unknown knob position jumps (0.3675), and a noise step breaks off Cyphers
run (09 NP K3, K4).

## Decision

1. **Path:** USB-MIDI class device → ALSA → PipeWire MIDI bridge → `cypherdj-kern:hand_in` (JACK MIDI with
   sample offset). No detour via Node. LED return path via `cypherdj-kern:hand_led`.
2. **Mapping as a file** (`~/.config/cypherdj/controller/<geraet>.json`, format `SCHNITTSTELLEN.md` §7), no
   mapping scripts with logic; the logic sits in the core's hand arbiter.
3. **Takeover:** the first value per control after start or reconnection counts only as position; **scaled** for pots
   and faders, **relative** for endless encoders; **dead zone 3/128** (Mixxx threshold), before a grab takes a control
   over from a plan; touch sensor as trigger where present.
4. **Return** of a control to `frei` (free): release gesture (shift plus touch) or 32 beats (8 bars) without
   hand movement, whichever comes first (default per 09 question 2).
5. **Assignment (proposal until the device is known):** per deck play, CDJ cue, 4 pads hotcue (shift: 5 to 8, set), pads in
   roll mode (1/4 to 1/32), loop encoder (length, press on/off), beat jump ±, nudge encoder, tap, EQ high/mid/low
   as encoders with LED ring, 3 kill buttons, filter, send, trim, channel fader, PFL. Global: crossfader, cue mix,
   headphone level, split, tempo encoder (hand segment), **playing style encoder, length encoder (time pressure), start**,
   **bass swap button** (two coupled kills as a group on the next bar), "Cypher, proposal",
   "Cypher listen", accept, discard, **stop**, release, verdict good/off, autonomy switch 0 to 3,
   crate browser (encoder plus load to deck n).
6. **LEDs:** one colour for Andreas' holder, one for Cypher; listening pass green/red; proposal waiting; fallback active;
   Notbahn (fallback path) active; the last 4 bars before a deadline the deck blinks.
7. **Loading from the crate** also works with a dead control room (the core reads `/dev/shm/cypherdj/kiste.json`).
8. **Hardware recommendation:** endless encoders with LED ring for everything Cypher also drives (then there is no
   takeover question); one real fader for the AI track; motorized fader optional. HID only when Andreas' device requires it.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| pickup takeover (Ableton "Pick-Up", Mixxx soft takeover) as default | value stays stuck if Andreas turns away from the value | 09 §3.6, probe b |
| jump takeover | jump of 0.21 at the grab sample | 09 §3.6 |
| controller via Node (`@julusian/midi`) | without sample stamp; wakeup scatter | 06 §3.1, probe a current 4 |
| HID immediately | `hidapi` missing, device unknown | 09 §3.7 |

## Consequences

- USB polling and jitter of real pots are unmeasured (M17).
- The assignment is a proposal until the device is known; the mechanics do not depend on it.

## Evidence

09 §3.6, §3.7, probe b (takeover modes), probe c (1024: 21.318 ms, spread 0.035 ms; 256: 5.32 ms, spread 0.041 ms;
300 of 300), NP c (5.326 ms, spread 0.060 ms), K3, K4; Mixxx `softtakeover.h:20` (threshold 3/128),
`softtakeover.cpp:70`; entwurf-spiel §3.1 (assignment).

## Reverses if

Andreas' device is HID-only (then install `hidapi`, with his yes, and a HID bridge as its own process with a
timestamp) or jitters more than 3/128.
