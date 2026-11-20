# ADR 039: patterns as linked clips (copies of one pattern, kept equal by fan-out in the command layer)

Status: built on branch `tracker-t7` (plan 2026-11-18 `tracker`, task 7). The song view and the drawing of linked clips in PRODUCTION are tasks 10 and 11, the section commands task 8. Not yet merged, not yet heard; Andreas' listening acceptance is open.
Decided: by Cypher as defaults in the spec `docs/superpowers/specs/2026-11-18-tracker-design.md` and the plan decisions D13 and D20; Andreas may override.
Supersedes: nothing. It sits next to the clip commands of the project API (`commands_clip.ts`) and uses the existing note ids and the patch history unchanged.
Spec: `docs/superpowers/specs/2026-11-18-tracker-design.md`.

## Context

A tracker song plays the same pattern in many places and wants to edit it once. In this project a MIDI clip is its own data: notes, envelopes, rows, view settings. Playback translation, the offline render, the MIDI export, the arrangement view and every client read clips as they are. A pattern that several clips share must not make any of those readers learn a new kind of object.

## Decision

1. **A pattern is a set of MIDI clips with the same `verbund`, on one track.** `MidiClip.verbund?: string` (`/^v[0-9]{1,9}$/`, `/2` only, absent when the clip is unlinked). Ids come from the project counter `naechste_id.verbund` (`v<n>`), which arises with the first link, like the lane and take counters. A project without a linked clip has neither the field nor the counter and stays byte for byte the same.
2. **Copy plus fan-out, not references.** Every member holds the full content (name, `laenge_beats`, `loop_beats`, `noten`, `huellkurven`, `zeilen`, `seq`, later `fx`). `fuehreListeAus` repeats a content command on every member at its turn inside the command list, so one list is one undo step and the patch pair covers all members. The content commands are `noten_neu`, `noten_aendern`, `noten_loeschen`, `zeile_setzen`, `huellkurve_setzen`, `huellkurve_loeschen`, `clip_aus_muster`, and `clip_aendern` when it names only `name`, `laenge_beats`, `loop_beats`, `seq`. Fan-out holds for every caller of `fuehreListeAus`, PRODUCTION and the tracker alike.
3. **New notes get the same id in every member.** `noten_neu` on a member draws the ids of the notes without an id once from the project note counter and gives them to every member. The public note insert refuses an id below the counter, so members take their copy through the internal insert `fuegeNotenEinMitIds`, which refuses only an id already in the clip (and, for an id the caller wrote by hand, one below the counter as it stood before the draw). `clip_aus_muster` is generated once and the other members take the result by copy, so they get the same ids too.
4. **A member is equal to the others, and the model says so.** `pruefeProjekt` refuses a project in which members of one pattern differ (`verbund_ungleich`, the text names the clip ids and the first difference). A hand-edited file cannot play two versions of one pattern.
5. **Restructuring a clip leaves the pattern (D13); moving it in time does not.** `clip_teilen`, `clips_verbinden` and `clip_aendern` with `spur_id`, or with `start_beat` together with any other field, remove `verbund` from that clip before they act. A `clip_aendern` that names `start_beat` alone is a pure move in time on the same track: the clip keeps its pattern, because the position is not part of a pattern's content (and a selection of members can be moved without losing the links). The `start_beat` plus other fields case is what makes PRODUCTION's left trim safe: it sends `clip_aendern {start_beat, laenge_beats}` plus `noten_*` for the same clip in one list, and the clip is unlinked by the first command, so the notes it drops never reach the other members. The right trim sends only `laenge_beats` and resizes every member. `clip_duplizieren` copies `verbund` with the clip (a new member); on another track the copy is alone and the rule below removes the link.
6. **A pattern left with one member loses its `verbund`.** After every command outside the content commands the command layer removes a `verbund` that only one clip of its track still carries (a deleted member, a moved clip, a section delete in task 8). Commands: `clip_verknuepfen {clip_id, mit}` (same track, both MIDI; the content of `clip_id` is replaced by that of `mit`; `mit` gets a new `verbund` when it has none) and `clip_entknuepfen {clip_id}`.
7. **The note fast path includes the members.** The shallow copy of `notenEntwurf` adds the member clips of every clip a note command names, so the fast path and the full path give the same result and the source project is not written.

## Rejected: references

A pattern as one stored object that clips point to would save the copies, but every reader of a clip (playback translation, render, export, arrangement, page modules, the text form) would have to resolve the reference, and a reader that forgets to do so plays silence. Copies cost memory proportional to the number of members, which the limits `MAX_CLIPS` and `MAX_NOTEN` already count after unrolling anyway. With copies, an old reader, an older core and every test stay valid.

## Consequences

- **Formats.** No change to the playback file or the core. `spurSicht` does not list `verbund`, so a linked clip plays exactly as the same clip unlinked.
- **Cost.** A content command on a pattern of k members does k times the work of one clip. Patterns are short; the note limits hold per project.
- **Commands.** Two new commands in the family CLIP, both in the `proj_aendern` description of the hand.
- **Open.** The drawing of linked clips in PRODUCTION (task 11) and the song view (task 10) read `verbund` from the project; this task changes no page code.
