# ADR 034: Instrument rack members on member slots, and the `glied` macro target

Status: built on the branch `b1-instrumente-rest` (package 1.9, U6 core, U7 page and hand, U8 macros), 2026-11-09; not merged when this text was written. Andreas' listening acceptance is open (Welle 1).
Decided: the form by Cypher as defaults in the spec `docs/superpowers/specs/2026-11-04-1.9-instrumente-spec.md` (E9 to E13, E15) and in the plan `docs/superpowers/plans/2026-11-09-1.9-instruments-rest.md`; Andreas may override.
Evidence: `docs/architecture/stand/produktion-instrumente.md`. Interface text: `docs/architecture/INTERFACES.md` section 20.10.
Predecessors: ADR 024 (kit in the core), ADR 030 (production strips), ADR 033 (routing; the strip rack with macros of slice 4c).

## Context

A track had one device: the RB-338, a Baukasten graph, a kit or a Surge host. Ableton's instrument rack puts several devices on one track, each with a
key, velocity and chain zone, and lets one macro knob move parameters of several of them. 1.9 builds the instrument side of L13. 1.10 slice 4c already had
the effect side: a strip rack with four macros and a mapping table whose targets are stages of the strip's insert chain.

Two questions needed a decision that is expensive to change later: how do several devices play inside one track without new sinks, and how do macros reach
a member without a second macro model.

## Decision

1. **A rack is a device kind, its members are devices on member slots.** `geraet: {art: 'rack', kette, glieder: [{id, geraet, ton?, vel?, kette?, gain_db?}]}`
   (1 to 4 members `g1`..`g4`, zones are inclusive pairs, absent = the whole range). The core dispatcher `ArrRackSenke` sends every note to the members whose
   key, velocity and chain zone contain it, at the same target sample. Each member is played by the sink that already plays that device kind
   (RB-338, bk, kit, Surge host): the per-slot arrays of those sinks grow by `ARR_GLIED_PLAETZE` member slots behind the 32 track slots, so no sink was
   written again. A note off goes to exactly the members that got the note on. The field name `rack` stays the strip's macro rack (ADR 033); the instrument
   rack lives under `geraet`, so the two never clash.
2. **A production slot belongs to one Surge, over tracks and members together.** A Surge member holds a slot (1 or 2) like a Surge track does; the project
   check (`wirtSlots`) refuses a second user of the same slot (`slot_belegt`). A track with a Surge member is a freeze track: freeze, bounce, merge and export
   check the host of each slot it uses (`wirt_fehlt`, `wirt_fehler`), and a frozen rack track is emitted as its audio clip without members. The rack sink
   reports the host lead time of its Surge member and holds the internal members' events until their block, so both onsets of one note meet at the same
   sample at the track bus.
3. **Chain select and member gain are playback values, not control rows.** `rack_kette`, `rack_glied_setzen` and `rack_glied_entfernen` are commands of
   `proj_aendern` and swap the playback like a device change (the spec E11 named `spur_aendern`; the three small commands carry the same effect and give the page
   and the hand a narrow call). A chain switch affects notes that start after it; a sounding note finishes on its member. A gain change ramps instead of
   stepping.
4. **A member parameter is a second macro target kind, not a second macro model.** The strip rack of slice 4c (four macros `rack/<k>/m1..m4`, at most 16
   mappings, the mapped parameter's own value ignored; for a chain stage the project also refuses to set it, `param_gemappt`) takes `{glied, param, von, bis}` next to `{insert, param, von, bis}`. The allowed
   parameters are the smoothed RB-338 ones (`lautstaerke`, `cutoff`, `resonanz`, `env_mod`), bk `k1`..`k8` and `gain_db` of any internal member; a Surge
   member is refused (`makro_ziel_wirt`): its parameters are not core values. The playback target carries `glied` = the member's position in the rack
   device and `param` in the core's member index space (RB-338 0 to 3, bk 8 to 15, `gain_db` 16); a page list pinned against the core header by a test
   keeps both sides equal. The core applies the value in `Arrangement::glied_makros_` at the block end, after the automation and the device lanes of the
   track, so the move lands in the next block and a lane never wins against a macro.
5. **A mapped member starts on its mapped value.** At a transport start the member's smoothers are set to the mapped value before the first block, so
   nothing glides from the member's own value. The first version glided for about 240 ms (the reset snapped the smoothers to the member's own value after the
   lane step); that was fixed in `ArrRbSenke::block_bahn` (the lane values of the first block are applied before the snap). The same rule now holds for a
   device lane on a plain RB-338 track (`test_arr_rb_start_lane`), which is a behaviour change outside the rack: a lane starts on its value. The live render equals the
   offline render bit for bit from frame 0 (acceptance M1-o, measured from frame 0).
6. **Variations are project data.** `rack.variationen` holds up to 8 named snapshots of the four macro values per strip rack; save, load and delete are
   commands with one undo step each. Loading sets the four values like `rack_makro` and needs no core change. The file format stays `cypherdj-projekt/2`: the
   field is absent when empty and refused in `/1` files. Removing the last mapping of a strip removes the strip rack and with it the variations (undo restores
   them); that was chosen over keeping an empty rack alive.

## Consequences

- No new sink and no new OSC address. The playback file grows a rack device and `glied` targets; the core refuses a rack in a `/1` playback.
- At most 8 rack tracks, 4 members each, 32 member slots in total, 2 Surge slots in total, 8 variations per rack, 16 mappings per strip.
- Surge as a member has no macro targets and no `parameter` map in 1.9. A Surge word (direction) on a rack track is refused like on any rack track
  (`richtung_unbekannt`): direction words work on plain RB-338 and Surge tracks.
- Overlapping zones sound all members that match; a gap in the zones sounds nothing for that note (an accepted musical choice, not an error).
- The bit-equality of the render at quantum 128 and 1024 and of the null test live against offline holds for racks (evidence file).
- Open: AK-R8 (lane `arr32rack`) ran on a quiet machine and is not met on p99.9 by up to 4 % (1009 to 1106 us against 1067 us); accepted for Welle 1 (decision in the strand ledger), follow-up t_8cb0a5b9 (a rack with its members as one unit on one lane). Evidence: `docs/architecture/stand/produktion-instrumente.md`.
