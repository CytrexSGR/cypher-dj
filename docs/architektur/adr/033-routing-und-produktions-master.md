# ADR 033: Routing and production master in the arrangement module (group tracks, PM, export tap)

Status: built on branch `r1-routing` (package 1.10, slices 1 and 2), 2026-10-24; acceptance by Andreas open, not merged.
Decided: E2 (own production master with export tap before the set limiter) by Andreas on 2026-10-20; F1 to F3 (groups
and returns on their own slots next to the 32 tracks, mute zeroes the track including sends, solo lets group and returns
sound, new project without returns) by Andreas on 2026-10-22; the form (decisions 1 to 7) by Cypher in the plan
`docs/superpowers/plans/2026-10-23-1.10-routing-slice1-2.md` (P1 to P14) and by the main instance on 2026-10-24 (N7, N8).
Spec: `docs/superpowers/specs/2026-10-22-1.10-routing-busse.md`. Status and measurement figures: `docs/architektur/stand/routing-1-10.md`.
Predecessor: ADR 030 ("Production channel strips (inserts, sends, groups) grow in the module, not in the DJ mixer.")

## Context

After D1, E1 and E3, the arrangement module sums up to 32 tracks flat and feeds the sum into the input of `erz/4`
(`djk/kern/src/arr_ausgang.cpp`, `Arrangement::mischen`). There are no groups, no separate production master, and no
export that reads anything other than the ring master behind the set limiter (`djk/kern/src/render.cpp`, `ring.h`: four
channels). An export that carries the hall limiter, Kleber (glue compressor), `master/pegel` and the crossfader weight
is useless for mastering outside. Package 1.10 is to bring groups, returns, sidechain, matrix and resampling; this ADR
records the decisions of slices 1 and 2 (one group together with its PM fader from the page to the output, then the
export tap with display).

## Decision

1. **Groups and PM are strips in the arrangement module, not in the DJ mixer.** The mixer computes in fixed order tracks,
   groups, production master (PM); depth 1 (groups do not nest), no sidechain in these slices. There are eight groups
   (`ARR_GRUPPEN`, `djk/kern/include/cypherdj/arr_wiedergabe.h:27`), the PM has the strip index `ARR_PM`
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
   far side gets quieter down to silent (`arr_ausgang.cpp:39`, used at `:230`). The track law (−3 dB in the centre) applied
   to an already stereo-mixed group sum lowered every group by 3 dB; putting bass and pad in one group made the mix quieter.
   The test `gruppieren_aendert_pegel_nicht` pins this down. This is audible and belongs to Andreas; one line
   (`pan_gain` instead of `balance_gain`) switches it.
4. **The PM output is the export tap.** The core copies the PM output every block into pre-allocated buffers
   (`Kern::pm_abgriff_l()`, `pm_abgriff_r()`, `kern.h:277`; copy directly behind `arr_->block` in `kern_stellwerk.cpp:410`),
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
   patches stay valid. A `/1` project still opens and is lifted to `/2` in memory on load (`djk/oberflaeche/projekt/modell.ts:349`),
   `/2` is what gets saved; the I08 field `aufnahme` stays unchanged. The history (`undo.jsonl`) carries no format line. The
   translator writes playback `/2` only if the project has groups or a track does not point to master (`wiedergabe.ts:157`;
   since package 1.13 also when an audio clip carries an active warp, see ADR 031 point 5: then `gruppen` is always present,
   even if empty), otherwise `/1` byte-for-byte as before (AK3 at file level); the core reads both. New server reasons:
   `routing_zyklus`, `routing_grenze`, `ziel_unbekannt`, `gruppe_unbekannt` (`djk/oberflaeche/http/gruende.ts:73`); the core
   rejects a cyclic or nested playback with the existing reason `format`.
6. **Lamp SET LIMITER via `/zustand/arr` field `limiter_db`.** The core reads the reduction of the set limiter after each mixer
   block and holds the largest value for 0.5 s (24 000 samples, `kern.h:464`) after the last intervention above 0.1 dB
   (`kern_arr.cpp:313`); the field (float, ≤ 0, `,iiidhdif`) goes out immediately at every change of the lamp, because the
   server throttles `/zustand/arr` to 50 ms and a short intervention would otherwise be lost. The page shows "SET LIMITER" when
   the value is below −0.1 (`djk/oberflaeche/oeffentlich/produktion/transport.js:27`); the export line warns on `ueber_decke`.
7. **Control budget: 597 of 1024, reserve 427; the total need of slices 1 to 8 is 897, reserve 127.** Measured on a copy of
   the table (spec 5.3: groups, PM, 32 times 4 sends, 4 returns at 11, 12 inserts at 8). The reserve is above 100, therefore
   raising to 2048 together with state version 3 was dropped. Failure case of the measurement: the same counter with
   `MAX_REGLER 800` aborts (`ReglerTabelle: mehr als 800 Regler`). 1.11 and 1.12 decide with their own measurement.

## Consequences

- **Rollout:** core and `cypherdj-render` must be rebuilt and restarted together. An older render program rejects control files
  with `grp/` and `--abgriff`; the server detects this (P11) and answers `render_fehler`. A new server with an old core does
  not load the playback (`/zustand/arr` has one field fewer, cause unchecked).
- **Restart state:** still valid unchanged. It stores only controls away from the default by path
  (`djk/kern/src/kern_zustand.cpp:125`); new controls at the end of the table need no state version.
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

## Rejected

- **Extend the ring to more channels** (`djk/kern/include/cypherdj/ring.h:13`, `:55`): `cdj_ring_gueltig` requires every
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
