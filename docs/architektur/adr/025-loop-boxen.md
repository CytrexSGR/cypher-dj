# ADR 025: Loop boxes in the core (MVP 2)

Status: accepted 2026-09-27 (Cypher; Andreas: "my next mvp is with it … 2 loop decks … wav extract from a running strudel loop … each loop box needs beat-synchronous filters", FX proposal "yes").

## Context

The shared play lives in Strudel (ADR 024). Andreas wants to tap loops from it, put them in two boxes, fade them in, pre-listen and process them with beat FX. Slice 38 (deck grammar with loop) needs stretchers and a loader and is large.

## Decision

Two loop boxes in the core on `pad/1` and `pad/2`. A loop is exactly N bars at 128 BPM (N = 1, 2, 4, 8); the box plays it phase-locked to the core clock (position = beat mod 4·N), start and stop on the next bar one. The network process loads loops and sets up capture buffers; the core swaps pointers and returns them as an event for release (pattern `/k/mapping`, ADR 024). Beat FX sit in the box before the channel strip and have their own commands.

## Consequences

- No stretcher, no keylock: loops fall silent at tempo ≠ 128.
- The capture taps `erz/1` before trim and starts on a multiple of its length.
- The DSP channel strip (seam, slice 04) remains untouched; `pad/*` are no longer single-shot channels, as long as the generator does not choose them as target.

## Discarded

| Route | Why not | Evidence |
|---|---|---|
| Loops on deck 3 and 4 (deck engine, slice 38) | stretcher, loader, grammar: large; unnecessary for loops at set tempo | ROADMAP 38 |
| Beat FX as §1.5 control in the channel strip | seam of the channel strip is fixed; controls would have to pass through the table, the core mock, the Leitstand, page curves | `kanalzug.h` header, spec decision 8 |
