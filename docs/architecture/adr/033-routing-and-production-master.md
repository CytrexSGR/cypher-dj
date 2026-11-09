# ADR 033: Routing and production master in the arrangement module (group tracks, PM, export tap)

Status: built on branch `r1-routing` (package 1.10, slices 1 and 2), 2026-10-24; slice 3 (returns and sends) built on branch `r3-routing`, 2026-10-31; acceptance by Andreas open, not merged.
Decided: E2 (own production master with export tap before the set limiter) by Andreas on 2026-10-20; F1 to F3 (groups
and returns on their own slots next to the 32 tracks, mute zeroes the track including sends, solo lets group and returns
sound, new project without returns) by Andreas on 2026-10-22; the form (decisions 1 to 7) by Cypher in the plan
`docs/superpowers/plans/2026-10-23-1.10-routing-slice1-2.md` (P1 to P14) and by the main instance on 2026-10-24 (N7, N8).
Spec: `docs/superpowers/specs/2026-10-22-1.10-routing-busse.md`. Status and measurement figures: `docs/architecture/stand/routing-1-10.md`.
Predecessor: ADR 030 ("Production channel strips (inserts, sends, groups) grow in the module, not in the DJ mixer.")

## Context

After D1, E1 and E3, the arrangement module sums up to 32 tracks flat and feeds the sum into the input of `erz/4`
(`djk/core/src/arr_output.cpp`, `Arrangement::mischen`). There are no groups, no separate production master, and no
export that reads anything other than the ring master behind the set limiter (`djk/core/src/render.cpp`, `ring.h`: four
channels). An export that carries the hall limiter, Kleber (glue compressor), `master/pegel` and the crossfader weight
is useless for mastering outside. Package 1.10 is to bring groups, returns, sidechain, matrix and resampling; this ADR
records the decisions of slices 1 and 2 (one group together with its PM fader from the page to the output, then the
export tap with display).

## Decision

1. **Groups and PM are strips in the arrangement module, not in the DJ mixer.** The mixer computes in fixed order tracks,
   groups, production master (PM); depth 1 (groups do not nest), no sidechain in these slices. There are eight groups
   (`ARR_GRUPPEN`, `djk/core/include/cypherdj/arr_playback.h:27`), the PM has the strip index `ARR_PM`
   (`arrangement.h:28`). The sum of the PM goes into the input of `erz/4` as before. Mute of a group zeroes all members;
   solo on a track lets its group sound (not the other members), solo on a group lets all its members sound (F2, P7). A
   change of target of a track (master, group) fades linearly over 480 samples (`ARR_ZIEL_BLENDE`,
   `arrangement.h:27`, P8). A project without groups computes bit-identically as before (reference file
   `arr_mixer_solo_ref.bin` unchanged).
2. **The topology lives in the playback, the levels are interlocking controls.** Playback `cypherdj-arr/2` carries per track
   `ausgang` (`{"art":"master"}` or `{"art":"gruppe","nr":n}`) and the list `gruppen` (`nr`, `ausgang`); no `reihenfolge`
   (comes in slice 5). Levels are the controls `grp/<n>/{fader,pan,mute,solo}` (n = 1 to 8) and `pm/fader`, appended after
   `spur/32/solo` (index 564 to 596); no existing index moves. The levels `grp/<n>` and `pm` are reported by the core via `/pegel`.
3. **The pan of a group is a balance, not the track law** (P14, deviation from spec AK5). Centre 0 dB; towards the side the
   far side gets quieter down to silent (`arr_output.cpp:39`, used at `:230`). The track law (−3 dB in the centre) applied
   to an already stereo-mixed group sum lowered every group by 3 dB; putting bass and pad in one group made the mix quieter.
   The test `gruppieren_aendert_pegel_nicht` pins this down. This is audible and belongs to Andreas; one line
   (`pan_gain` instead of `balance_gain`) switches it.
4. **The PM output is the export tap.** The core copies the PM output every block into pre-allocated buffers
   (`Kern::pm_abgriff_l()`, `pm_abgriff_r()`, `core.h:277`; copy directly behind `arr_->block` in `core_signalbox.cpp:410`),
   and `cypherdj-render` reads them with `--abgriff produktion` instead of the ring (`render.cpp:120`, `:161`). The program
   delivers `ueber_decke` (sample peak of the tap above `limiter_dbtp`) and `limiter_db_max` (largest reduction of the set
   limiter during the render, positive dB, 0 = never intervened; P10). `--abgriff set` remains the program's default
   (current behaviour, P11); the server always sends explicitly `produktion` or `set` and checks that the response names the
   same value. `POST /proj/export` takes `abgriff`, default `produktion`; the loudness of the response is measured on the PM.
   Not in the tap: metronome, `erz/4` channel strip, Kleber, `master/pegel`, set limiter.
   **Finding N7 (measured, changes the spec cross-check):** `erz/4` is neutral only in magnitude at neutral position. The
   LR8 isolator (gains 1.0) acts as an allpass and shifts the phase (1 kHz 0.8448 rad, 1.5 kHz 2.4847 rad, magnitude
   0.0000 dB). The PM tap is the PM without the DJ channel strip; the ring master is the same PM through the isolator. A
   sample comparison "export against ring recording" is therefore never zero, even for quiet material (core test: −11.4 dBFS
   residue; live on the real core: −28.660 dBFS). The spec (section 4, cross-check) said: "If this does not measure, the
   recommendation does not hold." The form of the cross-check (sample-wise equality) is thereby refuted; the main instance
   decided that the recommendation stays: the hall hears the PM through an allpass, equal in magnitude, and production
   deliberately gets no DJ channel strip (`docs/masterplan/D1-SPEC.md` 2.3). AK17 therefore compares against
   `cypherdj::dsp::Isolator` (gains 1,0, fresh from the start of the run or render) over the tap (core test −240 dBFS, live
   −758.990 dBFS); if the isolator state is not fresh, only a magnitude comparison remains (peak and integrated loudness to
   0.05 dB).
5. **Formats: project `/2` with migration, playback `/2` only with routing (since package 1.13 also for a warped clip, ADR 031).**
   `cypherdj-projekt/2` requires `gruppen` and `master {fader_db}`; `Spur.ausgang` is optional (missing = master), so old
   patches stay valid. A `/1` project still opens and is lifted to `/2` in memory on load (`djk/ui/project/model.ts:349`),
   `/2` is what gets saved; the I08 field `aufnahme` stays unchanged. The history (`undo.jsonl`) carries no format line. The
   translator writes playback `/2` only if the project has groups or a track does not point to master (`playback.ts:157`;
   since package 1.13 also when an audio clip carries an active warp, see ADR 031 point 5: then `gruppen` is always present,
   even if empty), otherwise `/1` byte-for-byte as before (AK3 at file level); the core reads both. New server reasons:
   `routing_zyklus`, `routing_grenze`, `ziel_unbekannt`, `gruppe_unbekannt` (`djk/ui/http/reasons.ts:73`); the core
   rejects a cyclic or nested playback with the existing reason `format`.
6. **Lamp SET LIMITER via `/zustand/arr` field `limiter_db`.** The core reads the reduction of the set limiter after each mixer
   block and holds the largest value for 0.5 s (24 000 samples, `core.h:464`) after the last intervention above 0.1 dB
   (`core_arr.cpp:313`); the field (float, ≤ 0, `,iiidhdif`) goes out immediately at every change of the lamp, because the
   server throttles `/zustand/arr` to 50 ms and a short intervention would otherwise be lost. The page shows "SET LIMITER" when
   the value is below −0.1 (`djk/ui/public/production/transport.js:27`); the export line warns on `ueber_decke`.
7. **Control budget: 597 of 1024, reserve 427; the total need of slices 1 to 8 is 897, reserve 127.** Measured on a copy of
   the table (spec 5.3: groups, PM, 32 times 4 sends, 4 returns at 11, 12 inserts at 8). The reserve was above 100, therefore
   raising to 2048 together with state version 3 was dropped at the time. Superseded: package 1.15 (plan A v2, task A1a, 2026-11-03)
   did it after all, `MAX_REGLER` and `CDJ_Z_REGLER` to 2048 and `CDJ_ZUSTAND_VERSION` to 3, because the mix tools need 345 rows. Failure case of the measurement: the same counter with
   `MAX_REGLER 800` aborts (`ReglerTabelle: mehr als 800 Regler`). 1.11 and 1.12 decide with their own measurement.

## Consequences

- **Rollout:** core and `cypherdj-render` must be rebuilt and restarted together. An older render program rejects control files
  with `grp/` and `--abgriff`; the server detects this (P11) and answers `render_fehler`. A new server with an old core does
  not load the playback (`/zustand/arr` has one field fewer, cause unchecked).
- **Restart state:** still valid unchanged. It stores only controls away from the default by path
  (`djk/core/src/core_state.cpp:125`); new controls at the end of the table need no state version.
- **Open flank N8:** the export reads the core's state slot. An export right after a control change can carry an intermediate
  value (measured: wait 0, 2 of 7 exports wrong; 1500 ms, 0 of 7). The acceptance scripts wait 1000 ms before each export.
  Not fixed; Cypher, which changes a control and immediately sends `proj_export`, gets a wrong result until then.
- **Honesty over smoothing:** "rendered = heard" applies to the production export only in magnitude (N7) and only as long as the
  set limiter does not engage; if it engages, the lamp lights and the WAV is the unrestrained one.
- **AK18 in full form is missing:** the production export of hot material against a real-time reference on the JACK-driven
  core is measurable only with `/k/arr/abgriff` (slice 7); in slice 2 the core test (same `Kern::audio` path, without JACK)
  and the null test of the set export carry it.
- **Audible and Andreas' matter:** P14 (balance), P7 (solo semantics with groups), P8 (linear fade instead of S-curve).
- **Not in these slices:** returns and sends, pre/post and comp insert, sidechain, matrix, resampling (slices 3 to 8); groups
  in the timeline layout (indent, fold, slice 6): the heads of groups and PM sit in their own mixer block below the
  arrangement (P1).

## Addendum Slice 3: returns and sends (2026-10-31, branch `r3-routing`)

Plan `docs/superpowers/plans/2026-10-31-routing-slice3.md` (version 2). Decisions of the plan, numbered after the seven above:

8. **Returns are slots beside the 32 tracks**, up to 4 (`ret/1..4`), each plays into the master only; they do not feed returns or groups (P1).
9. **Sends are controls, not project data in the playback:** the playback `cypherdj-arr/2` carries only `returns: [{nr, ausgang}]`; the 4 sends per track or group are controls `spur|grp/<n>/send/<r>` (spec 5.1). A send is taken post fader, post pan and post mute/solo fade of its strand (P2).
10. **The group fader and balance do not act on the sends of the members** (P14); a track in a muted group has a silent send.
11. **Return solo (P7):** a return without solo is not silenced by a track or group solo; a solo on a return silences the others as for tracks.
12. **Cypher Hall** is a return option with seven controls mapped from 0..1 (`djk/core/tests/data/hall_abbildung_ref.json`); frame 1024 because frame 2048 fails the real-time gate G1 (median 1609 us above 1500 us). No bit equality is claimed for the Hall (I12): export and ring agree within a tolerance, calibrated in regime B (not yet measured).
13. **Control table 897 of 1024, reserve 127 (31 after Slice 4)** (P13): the reserve check `kapazitaet_hat_luft_fuer_k2` is lowered to `>= 44` as a deliberate change. `MAX_TEILE` stays 256: a project is opened in packets of at most 100 controls, each waiting for the end status; a packet with a rejection stops the open and the next open heals.
14. **Merge:** tracks with identical sends merge and the new track carries the send; unequal sends are refused with `merge_sends` (task 10b).

Open: Hall regime B, the acceptance listening (P7, P14, P15 are audible), Hall latency (P10). Numbers: `docs/architecture/stand/routing-1-10.md`.

## Addendum 2026-11-04: Slice 4a, compressor inserts and pre/post sends (branch `s4-rack-4a`)

15. **Insert chains are strips of the same mixer.** Up to 4 stages per track, group, return (after the Hall, before the return fader) and the PM (before the PM fader, so the export tap carries it). The chain index is the strip index (`ARR_KETTEN` = 45, pinned against `ARR_PM`, `ARR_RET0`, `ARR_STREIFEN`). Tracks and groups get a block-wise pass in place over the strip input before the per-sample fader loop; no per-sample FFI call.
16. **The pool is 12 native compressors (`ins/komp/1..12`), shared by the whole project.** Built in the constructor of `Arrangement` (allocation outside the callback), state kept by slot identity across a snapshot swap; an entering stage starts cleared and fades in, a leaving stage keeps a tail, a stage switched off fades out over 10 ms and is cleared at weight 0. `eq` and `saett` follow in 4b with their own pool sizes after a measurement; `rack/` paths answer 400 in 4a.
17. **The chain flag is structural, the bypass is only in the row.** The playback carries `chain: [{art, slot, an}]`; the page always writes `an: true` and the bypass is the row `ins/komp/<n>/an`, so a knob or a bypass never swaps the snapshot (seam fix `5fe42e31`). A stage runs when flag and row are on.
18. **Sidechain key as a row:** `ins/komp/<n>/sc = k` (1..32) detects on the input of track k, copied before any chain of the block runs; 0 is the own signal.
19. **Pre/post is playback structure, not a row:** `returns[].pre` in the snapshot; a pre send is taken after the chain of its source and before fader and pan, mute and solo still silence it. The name `ret/<r>/hall/pre` is the Hall pre-delay and unrelated.

Changes to points 7 and 13 above:

* **Point 7 (control budget).** The table is 1378 of 2048 rows (913 before package 1.15, 345 of the mix tools of package 1.15, 120 `ins/komp`), reserve 670. The 96 rows of the Slice 4 reservation (`RESERVIERT_SLICE4`) are gone from `test_controls.cpp`; the real rows replace them. The 8 rows per insert of the first estimate became 10 parameters per stage (`an`, `schwelle`, `ratio`, `knie`, `attack`, `release`, `makeup`, `mix`, `schp`, `sc`). The first 1258 rows are pinned by hash (FNV-1a 64 `0xc01227d2bfc9b294`), so no index moved.
* **Point 13 (reserve 127, 31 after Slice 4).** Superseded: with 2048 rows the reserve after the `komp` rows is 670; the pin `MAX_REGLER - anzahl() >= 44` of `kapazitaet_hat_luft_fuer_k2` holds. `MAX_TEILE` stays 256; opening a project sets the ten rows of every stage in use inside the existing packets of at most 100 controls (a project without inserts sets the same 365 / 389 controls as before).

Open: the real-time gate of the lane `arr32ins` (median <= 1500 us, p99.9 <= 2667 us) and the acceptance by ear and hand; both in `docs/architecture/stand/routing-1-10.md`, section "Slice 4a".

## Addendum 2026-11-09: Slices 6 to 8 and the rest of slice 5 (branches `b1-routing-rest`, `b1-routing-rest-kern`)

Decisions D1 to D13 of `docs/superpowers/plans/2026-11-09-1.10-routing-rest.md`; the evidence is in `docs/architecture/stand/routing-1-10.md`, section "Slices 5 rest to 8: closure".

20. **D1 The matrix is server data.** `GET /proj/routing` answers one pure function `routingMatrix(p)`; the page refetches it (debounce 150 ms) while the view is open and holds no copy of the rules. The key options of one stage come on demand (`?optionen=<insert_id>`), not in every answer.
21. **D2 Cells are answered by the commands' own rules.** Target cells by the three rules of `ziel_setzen`, key cells by `schluesselErlaubt`; a test proves every cell equals what the command does. Cloning the project per cell was rejected (seconds).
22. **D3 Groups are one header row in the arrangement,** the display order of members is derived (`gruppenLayout`); array order and `spur_verschieben` are unchanged. The spec's "display order = array order" is amended for tracks in a group.
23. **D4 Fold is the stored field `Gruppe.gefaltet`** (`gruppenspur_aendern`), one undo step; a folded member has no row.
24. **D5 Track selection for Ctrl+G** is Ctrl or Shift click on a track name (`st.spurWahl`); Ctrl+G sends one `gruppenspur_neu` (one undo step), already grouped tracks move into the new group.
25. **D6 Resample range and strip ids.** `von_beat`/`bis_beat` or the loop bracket or the whole song, at most 256 beats (`zu_gross`); point `post` unless `punkt: 'pre'`; the strip is the project's `strang_id` (track `s<n>`, group `g<n>`, return `r<n>`, the master `master`), not the spec's `quelle`.
26. **D7 The tap window is shifted by the arrival latency of the tapped point** (`arr_schluessel_quelle_ankunft`, not re-derived), so the file starts on `von_beat` like the export; frames = range length, no tail.
27. **D8 and D9 The result of a resample** is a new track "<source> (resampled)" with `gain_db` = the pan-law compensation of the merge, one undo step, the WAV stays after undo; the server converts the core's `.f32` with the path of the 1.8 take (the decoder is not bypassed). A silent result is `resample_leer`.
28. **D10 A Surge track that sounds in the range plays along in real time** (not frozen first); the host is checked before the run (`wirt_fehlt`, `wirt_fehler`).
29. **D11 The real-time gate is a paired A/B difference of p99.9** (at most 10 us, no tap armed and a running tap) on lane `arr32voll`, not an absolute number; the absolutes are reported. Result: cell (b) OK, cell (a) +28.7 us by the pre-fixed rule, **accepted with reasons** (stand section "AK26 real-time gate"), not passed.
30. **D12 `proj_lage` carries `kern.limiter_db`** (absent without core state), the one deliberate growth of that answer.
31. **D13 An own track as `pre` key is refused** by the command as well (`sidechain_zyklus`), in line with `schluesselErlaubt`; stored projects that hold such a key are not migrated.
32. **Loudness per strip keeps its keys (slice 8).** The render has two render-only masks on the arrangement that no live path sets: `--nur-schluessel` (a key source computes but writes zero) and `--trocken-aus` (the wet part of a return). A group entry is the members plus the group; a return entry is the wet part through the master chain alone,
    which is not the exact share of the mix when the master chain is non-linear (documented in the tool text).

Not decided here and left open: the insert and rack automation lanes (`lane_ziel_spaeter`), Kanban `t_dea1bae4`.

## Rejected

- **Extend the ring to more channels** (`djk/core/include/cypherdj/ring.h:13`, `:55`): `cdj_ring_gueltig` requires every
  reader to have channel count 4, an extension would break every reader (who reads everything is unchecked); a tap in the
  module needs no intervention in the ring contract.
- **A limiter switch in the master path** (bypass the limiter for the render only): the export would still contain Kleber,
  `master/pegel`, the `erz/4` fader and the crossfader weight, and a switch in the master path is an intervention in the
  live path.
- **The PM to its own JACK output** instead of into `erz/4` (spec section 4): later option (booth, individual outs); it does
  not change the answer to the export question and makes listening without the set limiter possible, which the hall
  protection does not want.
- **`/k/arr/abgriff` as an OSC command in slice 2** (P6): a command without a caller in the server would be dead contract
  weight; it comes with slice 7 (resampling), where the server becomes its first customer.
- **Playback `/2` always** (spec 5.2): neutral projects keep writing `/1`, so AK3 holds trivially at file level and all
  existing playback tests stay unchanged (P2).
- **The track law (−3 dB in the centre) for groups** (spec AK5): see decision 3.
