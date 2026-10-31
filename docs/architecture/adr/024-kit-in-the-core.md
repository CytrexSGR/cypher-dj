# ADR 024: Kit in the core (Strudel, stage 1)

Status: accepted 2026-09-27 (Cypher; Andreas: pulling 54/56 forward on his call of /write-plan).

## Context

ADR 010 fixes that generators deliver only events and that the sound comes from a host (SunVox, slice 57),
via JACK MIDI with return path, pulse and latency lead time (slice 54). That makes three L-slices before a pattern sounds.
Andreas' shared play lives in Strudel (live act 26./27.09.); word commands like "hihats" need a short path.

## Decision

`/erz/strom` gets the target form `kit:<name>`. The core plays `klang[note]` of a kit (single shots,
stereo float32, 48 kHz) at the sample of the beat into the input of a generator channel. The network loads the kit; the
core swaps the pointer in the cycle and returns the old one as an event for release (same pattern as `/k/mapping`, slice 35).

## Consequences

- Sample-exact without return path; no synthesis, no pitch: melodic material stays with slice 57.
- I3c is suspended in stage 1 (INTERFACES §4.8), because there is no listening pass for generators yet.
- Kits are kept together under `~/.config/cypherdj/kits/`; `djk/erzeuger/kit_bauen.py` builds them from Strudel lists.

## Discarded

| Route | Why not | Evidence |
|---|---|---|
| Strudel in the browser as a third audio input | browser clock drives, `setPattern` without grid, the death of the page takes the sound with it | ADR 017 |
| MIDI to SunVox first | three L-slices before the first sound | ROADMAP 54, 57 |
