# ADR 026: Loops and REC follow the core clock (varispeed), tempo at the side

Status: accepted 2026-09-30 (Cypher; Andreas: "we need a master tempo that everything subordinates itself to", then
"let's build that before we play").

## Context

Operation ran on 2026-09-30 at 130 BPM (start configuration from the day before). Andreas loaded a loop into L1 and
pressed PLAY: nothing. Per ADR 025, loop boxes were silent at tempo ≠ 128, REC refused, and the tempo existed only at
start. A second loop could not be loaded at all (wrong frame count), without the page saying anything. The core's
clock was already the master tempo (the Strudel streams followed it), only not everything followed it.

## Decision

1. Loops stay stored at the set base 128 BPM (requirement A9). When the map differs, the box reads them with the step
   `bpm`/128 (varispeed, Catmull-Rom), position per block from the beat, so still phase-locked. At exactly 128 BPM the
   integer direct path remains, bit-exact.
2. REC records at any fixed tempo: the frames of N beats are copied at the tempo of the recording, the net resamples
   to N · 22 500 frames while writing. Played back in the box at the same tempo, this cancels out.
3. Andreas sets the tempo on the page (`POST /tempo` → `/k/tempo/rampe`, one bar from the next one). The source
   `cypher` gets 403: tempo is direction.
4. A loop that the core would reject stands in the list as defective with reason; a rejection by the core stands in
   the response of `/loop` and on the page.

## Consequences

- No keylock: at tempo ≠ 128 the pitch of the loops drifts by 12·log2(bpm/128) semitones (130 BPM: +0.27).
  Requirement A10 ("keylock is mandatory for everything") remains open and belongs to slices 34 and 50 to 52.
- Decks still start only at their base (`kein_stretcher`), and the core rejects a tempo change as long as a deck runs.
  The page says so at the deck and at the BPM field.
- `→ STRUDEL` (`loopKit`) plays a loop as sound at its stored rate: no tempo following.
- Host runs (`klang fahre`) convert their duration to seconds at the start and do not stretch on a tempo change.
- The consequence from ADR 025 "loops silent at tempo ≠ 128" is lifted; `/e/loop` status 5 is no longer reported.
- A recording made at ≠ 128 BPM is interpolated twice (resampling, then varispeed). Measured on a sine: deviation
  2·10⁻⁵ after the resampling.
- The sound fidelity of the varispeed path (Catmull-Rom) is calculated, not heard: signal-to-noise ratio at 130 BPM
  about 47 dB at 5 kHz, 27 dB at 10 kHz, 15 dB at 15 kHz (code review F2, `~/messungen/2026-09-30-tempo-folgen/code-review.md`);
  at 128 BPM bit-exact. Measured are phase and tempo of the box, not its high-frequency picture. If it does not suffice
  for Andreas' ear: longer interpolator (windowed sinc) in `spiele_frei`.
- The "tempo only Andreas" guard sits in the page server (`POST /tempo`), not in the core: `/k/tempo/rampe` checks
  neither source nor stop Cypher (code review F16). The MCP djk-hand has no tempo tool.

## Rejected

| Path | Why not | Evidence |
|---|---|---|
| store loops at the tempo of their recording | frames per beat not integer (130 BPM: 22 153.85), second read path even at the same tempo, all tools compute with 22 500 | `loop.h` `LOOP_SPB`, `loops.ts`, `loop_bauen.py` |
| pin operation to 128 | contradicts Andreas' sentence; the Strudel streams already ran at 130 | spec 2026-09-27 lines 162 to 168 |
| wait for the stretcher | large (slices 34, 50 to 52), until then no loop outside 128 | ROADMAP |

Measured values: `docs/architektur/stand/tempo-folgen.md`, raw data `~/messungen/2026-09-30-tempo-folgen/`.
