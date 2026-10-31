# ADR 019: Surface later

- **Status:** accepted
- **Date:** 2026-09-23
- **Requirements carried:** A24, A25, A1, A4
- **Related to:** ADR 001, 013, 014, 018

## Context

A24: "Right now I don't care about the surface. We can catch up later, or integrate whatever exists at the time." Still,
A1 needs a view channel for Cypher's proposals (09 NP "What is missing": without visibility "proposing" cannot be
implemented), and A4 is helped by level displays ("so the level meters do help a little").

## Decision

1. **Before any surface** three minimal channels carry: **LEDs on the controller** (ADR 014), an **announcement line** in the
   terminal (reads the control desk WebSocket, shows one sentence per event with bar: Cypher's next plan, open
   proposals, fallback, fallback path (Notbahn), level traffic light per deck) and the **play sheet** as text.
2. **The surface comes later** as its own process that only reads the control desk WebSocket and sends commands to the
   control desk, never to the core and never in the audio path. Whether it is a browser page or its own app is decided then;
   content as in the draft "Playability" (phrases, remaining time, band level, traffic light, holder, running plan, tracker view).
3. A crashed surface takes nothing audible with it.

## Alternatives and why not

| Alternative | Reason for rejection | Evidence |
|---|---|---|
| Surface first | A24 defers it; the architecture risks lie in the audio path | A24 |
| JUCE GUI in the core process | one address space: GUI crash takes the sound with it; AGPL | 01 §3.7 |
| no view channel at all until the surface | proposing would not be implementable | 09 NP "What is missing" |

## Consequences

- Everything a later surface needs already exists in the control desk stream (`INTERFACES.md` §9).
- For Cypher the listening check replaces the level display; Andreas gets the traffic light per deck via LEDs and the announcement line.

## Evidence

01 §3.7, §3.9; 09 NP "What is missing"; research §5 ("Visible plan", ReaLJam).

## Overturned if

Andreas misses a display during a set: then the surface moves forward, without an architecture change.
