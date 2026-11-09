# ADR 032: Project automation in the core (lanes as project data, evaluated in the arrangement module)

- **Status:** Slice 1 built (fader lane, package 1.12), the rest is a draft. Number 032 (031 is taken by the warp spec 1.13).
- **Date:** 2026-10-22, condensed 2026-10-31, updated after the build 2026-10-31.
- **Features carried:** M14 (record and edit automation); M15 (clip envelopes) and M13 (track band loop) only as a boundary.
- **Changes:** guardrail L2, the sentence "automation builds on the automation tracks of Studio S6" (new wording below).
- **Related to:** ADR 023 (interlocking, hand first), ADR 030 (production in the core), ADR 031 (warp, the same tempo map), ADR 033 (routing, the same
  format `/2`), spec `docs/superpowers/specs/2026-10-22-1.12-automation.md`.
- **Occasion:** spec 1.12 (section 4) contradicts L2 in the way it gets there; the guardrail header demands an ADR before building against a guardrail.
  Decisions by Andreas (2026-10-22): F1 tempo automation after 1.13 (warp) · F2 the hand wins until it is switched on again explicitly ·
  F3 lanes unfold under the track · F4 PRODUCTION acts at once, Studio from the next pass · F5 formats stay separate, to be merged later.

## Context

Today the core knows no automation in the project: the project format holds only fixed values per track (`fader_db`, `pan`, `mute`, `solo`). For Studio the
page server plans to put segments into the interlocking (`/k/teil`). Five reasons why that way does not carry PRODUCTION:

1. **Two time bases.** The arrangement runs in project beats and moves the origin at the loop end (`arrangement.h`: "project beat p = core beat -
   origin + start_beat"); interlocking segments are in core beats. The server would have to cut every line anew at every start, jump and pass.
2. **Ceiling.** `MAX_TEILE` is 256 in the core and 200 at the server; every ramp between two points is one segment. A line with 200 points fills the
   server ceiling on its own.
3. **Failure.** If the page server dies the automation is gone, the core plays on (L9).
4. **Export.** L2 demands the offline render of the same core ("rendered = heard"). Segments planned by the server would have to be rebuilt there.
5. **Cypher.** Track controllers are locked for the S6 way (`ueber_projekt`); Cypher changes tracks only through the project.

## Decision

1. **Lanes are project data.** Every track optionally carries `automation: Lane[]`, each lane `ziel`, `punkte[{beat, wert, form}]`; beats are project beats,
   values are dB. The fixed value stays the **base value**: it holds at stop, without a lane and after the lane is deleted.
2. **The core evaluates.** The playback `cypherdj-arr/2` carries the lanes. In the arrangement module an `auto_block` computes the value per sample into a
   buffer that occupies the same `Wert.vl` pointer the interlocking course uses today. No new mixer. The same code runs in the offline render: "rendered =
   heard" is a property of the construction. The project beat of each sample comes exactly from the tempo map, not linearly between segment borders.
3. **The interlocking is not touched.** Lanes do not travel over `/k/teil` and occupy no controller, no segment, no course slot.
4. **Source blend.** If the fader changes between lane and base value (stop, lane deleted, snapshot swap) the arrangement blends 480 samples linearly in the
   gain. Not at start and loop seam: there the hard lane value holds. So that the base value stays true, `Wert` keeps the interlocking side apart from the
   played value.
5. **Order of values** (makes modulation possible later without a rebuild): base value, absolute lane, modulations (sum), clamp.
6. **PRODUCTION acts at once (F4):** point changes hold from the next snapshot swap. The loop is the loop bracket of the transport.
7. **One reference, three evaluators.** C++ (core), TS (server) and JS (page) evaluate the same formula and are measured against one reference file made
   independently (Python).
8. **Precedence of the hand (F2)** is decided in the core (detection at the grip, state `aktiv`/`uebersteuert` in the session state, back only by an explicit
   switch-on). That is slice 3; slice 1 has no intervention, the track head fader changes only the base value.
9. **Not in this ADR:** tempo automation (F1), Surge parameters, clip envelopes, merging the format with the Studio bands (F5).

## Slice 1 (built)

- One fader lane per track; forms `linear`, `s`, `sprung`; limits 8192 points per lane, 65536 per project, 12 lanes per track.
- Format `/2` is already taken on main: `automation` is an optional field in `/2` and absent for an empty list (projects without a lane stay byte for byte
  the same), no `/3`. A build before slice 1 rejects a project with a lane loudly; a core before slice 1 plays a playback with `auto` without the lane
  (version skew, a known limit).
- The lane counter `naechste_id.lane` appears only with the first lane.
- Slice 1 uses no controller (0 controllers, 0 segments, 0 course slots); measured relative to the table of the base.
- The render knows no loop bracket: "export = playback" is provable up to the seam, the seam only live.
- **Gain step (measured, built after the cost gate):** the lane value is recomputed for the gain only every 16 samples (a drift above 0.03 dB, every jump
  and every start takes the exact value at once), in live and render with the same function (`auto_block`, constant `AUTO_HALT_DB`, member `auto_schritt_`).
  Reason: the unstepped version cost +130 µs (p99.9, lane against fixed) in the 32-track layout, above the 150 µs frame in 3 of 10 rounds; with the step
  +55 µs (9 of 10 rounds within 150 µs). The mixer recomputes the linear gain only when the dB value changes.

## Alternatives and why not

| Alternative | Reason for rejection |
|---|---|
| Lane as interlocking segments (the S6 way) | two time bases, ceiling 200/256 segments, dies with the server, export would have to rebuild, Cypher locked out |
| Lane as a new interlocking segment type in the core | occupies `MAX_BEWEGT` (256) per automated controller, changes the interlocking and its tests |
| Server renders lanes to audio in advance | the line would no longer be editable; hand intervention and reading by Cypher would be lost |
| Mirror the lane value into the interlocking with `setze_direkt` all the time | occupies a course slot per lane and cycle and keeps the interlocking out of the quiet path |
| Switch the hand back on automatically at the next play | deselected by Andreas with F2; can be added later as a switch |

## Consequences

- One new core part (`AutoLane`, `auto_block`) in the arrangement module; interlocking, controller table and `MAX_BEWEGT` stay untouched.
- Two more implementations of the same formula (server, page) are the price of the display and of `proj_auto bei_beat`; the reference file keeps them
  together.
- The page computes the lane value for the display itself; if the tempo ramp deviates, display and sound deviate (measured in slice 1).
- Release and reverb tails of a sink before the fader see the level step at the loop seam; whether that disturbs is for the ear to decide, a seam blend
  only after that. Decided by ear on 2026-11-01 (project "A1 Hörprobe Fader-Lane", drum loop, fader lane 0 to -30 dB over four bars, loop over the
  ramp, send to a reverb return): no audible click and no audible level step on the reverb tail at the seam; no seam blend is needed.
- Guardrail L2 anew: "builds on the principles of the Studio automation tracks (S6), not on their mechanics; project automation is evaluated by the core
  (ADR 032)".

## Tips over when

The detection of the hand grip (slice 3) has a gap at the grip input that only a counter in the interlocking closes (then additive at the interlocking
header); the measured layout with a lane contradicts the cost frame (the gain step above is the first answer, in live and render the same); the source
blend at a seam with a simultaneous source change shows an error (then the order of the triggers anew); or Andreas demands controller access to device
parameters (then raise the controller ceiling, recompute the budget).

## Addendum, slice 2 (2026-11-01)

Built on branch `a2-z2` (not merged yet): lanes for `pan`, `mute`, `solo` (per sample, core fields 1 to 3) and `geraet.lautstaerke|cutoff|resonanz|env_mod` (per block through `ArrSenke::auto_parameter`, internal RB-338 tracks only), the lane lock (`gesperrt`, `auto_aendern`, reason `lane_gesperrt`), lane isolation in `proj_lautheit`. Decisions E1 to E11 are in the plan `docs/superpowers/plans/2026-11-01-automation-slice2.md` and condensed in `docs/architecture/stand/produktion-automation.md`. Corrections to the text above: D4 "`mischen` is unchanged" no longer holds for pan (E8: the pan gain is recomputed only where the value changes); D14 stays (playback `/2`, a slice 1 core rejects a new target with `format`, E6).

Measured: the cost layout `arr32auto` (72 lanes: 32 fader, 32 pan, 8 cutoff) against `arr32fest` (E11) first missed the frame of 150 µs (5 of 10 rounds, median 157.5 µs). The profile put 90.7 % of the difference into `Arrangement::auto_block` (every lane sample was evaluated although 15 of 16 only confirmed the held value). The evaluation inside a hold window now looks ahead to the end of the hold and skips the samples in between when the lane value is monotone there and still within the hold tolerance; the output, the lane buffers and the hold and blend state are bit-identical (17 scenes, a fuzz over 4600 scenes, the test `test_arr_auto_vorausschau` against the evaluation without look-ahead, three mutations red). The look-ahead is tried at most once per hold window, so its worst case is 17/16 of the per-sample cost. Result: the gate is met for slow lanes, 10 of 10 rounds, median difference 26 to 28 µs. It is NOT met for steep lanes (`arr32steil`, 64 lanes with a zigzag of 20 dB per 0.05 beat): median cycle +137.6 µs, 4 of 10 rounds within 150 µs; the cost of those sits in the mixer, where the gain is recomputed every 2 samples, and cannot be removed without changing the bits. Measured with 72 lanes, the spec allows 256. The positive proof of the cost layouts (values reported through `auto_parameter`) found that the internal-sink dispatcher dropped all `geraet` lane values after the rebase onto the Baukasten work; fixed and pinned by a test. ThreadSanitizer (fader, pan, mute, solo and `geraet` lanes, 40 swaps) found nothing; the allocation watchers are green. Numbers: state document `docs/architecture/stand/produktion-automation.md`.

Known limits: RB glide lag (the value arrives between 543 and 799 samples after a jump and can act up to one block early), version skew E6, merge drops the mute and solo lanes of its sources, bit identity without lanes is measured (12 of 12 scenes, `origin/main` against HEAD, 2400 blocks each at block size 256; not measured: real reverb, the freeze path, other block sizes), device lanes are quantised to the block (E9; the export differs by -49.7 dB at quantum 128 and -34.5 dB at 1024 against 256, relative to the signal RMS), the gate of AK22 holds for slow lanes only (see above; the `arr32steil` run overlapped with a live probe of another session, so its p99.9 values are loaded, the comparison with against without look-ahead stays valid).

## Addendum, slice 3, wave A (2026-11-02)

Built on branch `a3` and merged to main as `15f0dbee` on 2026-11-02: the hand takes a lane over. A grip on `spur/<n>/{fader,pan,mute,solo}` (a hand step that is applied, or a touch) overrides that field of that track: the lane stays in the project, the core plays the hand course from the grip sample, a source change is blended over 480 samples, and one pickup mechanism starts hand and page from the value the lane played last. The page asks the core with `/k/arr/auto` (command 50, `an 0`); the core reports every change with `/e/auto` (event 40) and re-reports the full state after an event ring overflow. Cypher may only give lanes back: `an 0` from Cypher is refused with `nur_andreas` (D9), `an 1` from Cypher is refused with `ki_gestoppt` while Stop Cypher is set (Andreas can still re-enable; the check is `riegel()` in `ProjSitzung.autoReEnable`, `areas/proj/session.ts`); the MCP tool `proj_auto_zustand` calls only the re-enable route. Cost: 8 overridden lanes against `arr32auto` (5 interleaved rounds, median cycle) 635.2 against 631.9 µs, difference -3.3 µs (gate +10 µs met). Known limits and what stays out of scope (controller key for re-enable, `spur/*` mapping, recording device lanes, steep lanes) are in `docs/architecture/stand/produktion-automation.md`, "Slice 3, wave A".

## Addendum, slice 3, wave B (2026-11-02)

Built on branch `a3` (not merged yet): recording a take into a lane. Andreas arms a track for automation (`/k/arr/arm`, command 51, only the source `andreas`; a separate arm from the audio arm `/k/rec/spur`) and chooses touch, latch or write once for the transport. While the transport plays the core reports every grip of an armed track with `/e/auto_punkt` (event 41: regulator path, project beat, value; beat and value from the same sample; at most 50 Hz per regulator with a trailing point). A mouse or key value goes to the page server (`POST /proj/auto/geste`), which takes the project beat from the last `/zustand/arr` state plus the wall-clock time since then. The server collects the points, cuts the take into passes at every loop seam, simplifies it (Ramer-Douglas-Peucker, 0.3 dB for a fader, 0.4 % for pan, mute and solo exact), writes it and then, in this order, waits for the new playback, re-enables the fields of the take and sends the base value. Cypher cannot arm and cannot override (D9, AK15): there is no MCP tool for either, `proj_auto_zustand` only re-enables, and the three routes answer the source `cypher` with `nur_andreas` before any state changes. A locked lane refuses a take with `lane_gesperrt` (AK17).

Deviation from D16, decided in the build: a batch of fields that end together is written with ONE `aendern`, label `Record <ziel> <track name>` for one field, `Record fader, pan <track name>` for several fields of one track, `Record N fields` for fields of several tracks, not one `aendern` per field, because every `aendern` loads a new playback into the core and 128 armed fields would mean 128 loads. Consequence: Undo of a stop with several armed tracks takes all of them back together. What was measured (AK12 and AK14 on the stand-in; the real core is the acceptance run `acceptance_a3.mjs` on instance e), the parked points and the cost statement are in `docs/architecture/stand/produktion-automation.md`, "Slice 3, wave B".
