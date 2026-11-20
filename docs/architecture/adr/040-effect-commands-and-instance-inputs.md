# ADR 040: effect commands stored in the clip, unrolled with the notes; `bend` and `pegel` as instance inputs

Status: the pure unrolling is built on branch `tracker-t13` (plan 2026-11-18 `tracker`, task 13). Storage (task 12), playback and export (task 14) and the Baukasten inputs (task 15) are separate tasks. Not yet heard; Andreas' listening acceptance is open.
Decided: by Cypher as defaults in the spec `docs/superpowers/specs/2026-11-18-tracker-design.md` section 6 and the plan decisions D14, D15, D16, D21, D22; Andreas may override.
Supersedes: nothing. It sits next to the note fields of the workbench (`chance`, `wdh`, `versatz`) and uses the same place for unrolling.
Spec: `docs/superpowers/specs/2026-11-18-tracker-design.md` section 6.

## Context

The tracker has effect commands (ARP, SLU, SLD, GLD, VIB, TRM, VSL, LVL, RTG, PAN, OFS, REV) that act on the row they stand on. Playback, offline render and MIDI export must agree on what a command does, to the sample, and none of them may reimplement the rules.

## Decision

1. **Commands live in the clip.** `MidiClip.fx` is a list of `{beat, spalte, code, wert}` (task 12). A command is part of the clip, so it moves, splits, loops and is copied with the notes. It is never written as an envelope into the project.
2. **Unrolled where the note fields are.** `djk/ui/project/fx_ausrollen.ts` holds one pure function, `rolleFxAus(c, rahmen, f)`. It calls `f` for every sounding note exactly like `fuerAusgerollteNoten` (after GLD and RTG), and returns the events: `bend` `[beat, semitones, glide beats]`, `pegel` `[beat, factor 0..1, glide beats]`, `regler` (role knob to jump points) and `pan`. A clip without `fx` takes `fuerAusgerollteNoten` unchanged and returns empty lists. Same input, same output: no clock, no random draw.
3. **`bend` and `pegel` are instance inputs.** They are events of the instance, not knobs of a graph: `bend` multiplies the frequency of all voices by `2^(st/12)`, `pegel` is a factor on the output of the instance. They need no change of any graph and are not smoothed by the knob smoothing. Both stay neutral (0 and 1) until an event says otherwise and are reset by a transport stop. Pan, start, reverse and slot reach the device as lane values at the sounding start of the note (D16, D22), so the note reads them.
4. **Time.** A row is `1/lpb` beat, a tick `1/(lpb * ticks)`. Tick `k` of the row at beat R lies at `R + k/(lpb * ticks)`. A command acts from tick 0; slides do nothing on tick 0. Tick `ticks` is the first tick of the next row: it carries the value that holds after the row (the pitch and level reached) and ends every per-tick modulation (ARP, VIB, TRM). A new note without GLD resets both inputs with an event at its sounding start, only when they were not neutral. A retriggered start is not a new note and does not reset.
5. **Stepped versus smooth.** A device with `fx_stufig` gets one jump per tick that changes the value (the old sound). Every other device gets a slide over a row as one event at the row start with the glide of the row length (shortened to the time the target is reached, e.g. GLD), and per-tick effects (VIB, TRM) as one event per tick with a glide of one tick. ARP is a jump per tick on every device (D14); a row with ARP is stepped for the whole pitch of that row.
6. **Event limit.** Events exist only where commands stand: at most `ticks + 2` events per lane and row, plus one reset per note. Smooth slides cost one event per row. The unrolling itself enforces no limit; the playback gets its own limit for `bend` and `pegel` events beside `ARR_NOTEN_MAX`, counted in `pruefeGrenzen`, and refuses a project above it with a text that names the count (task 14, spec section 6 "Limits").
7. **MIDI export** (D21, task 14) reads the same events: `bend` as pitch bend with a range of 12 semitones, `pegel` as controller 11.

## Consequences

- One implementation of the rules, tested in Node against hand-computed values (`djk/ui/tests/fx_ausrollen.test.mjs`).
- A device that is not a Baukasten graph (RB-338, kit, hosted plugin) ignores `bend` and `pegel` in this version.
- PAN has no end event: the consumer knows the end of the clip copy and returns the track's own pan there (D22).
