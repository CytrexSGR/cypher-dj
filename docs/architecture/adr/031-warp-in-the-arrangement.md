# ADR 031: Warp in the arrangement (W(b) on the tempo map, RE-PITCH in the callback, engine with lead time for the stretch modes)

Status: part 1 (mapping, format, RE-PITCH) implemented in package 1.13 slice 1, branch `w1`, acceptance at the target
according to the plan `docs/superpowers/plans/2026-10-22-warp-slice1.md`. Part 2 (engine with lead time for COMPLEX
and TONES) is implemented in package 1.13 slice 2, branch `w2`, according to the plan
`docs/superpowers/plans/2026-10-24-warp-slice2.md`; the prerequisite was the work-thread load measurement
(`kern/tests/deck/warp_last_lauf.sh`, verdict "S2 as planned", 2026-10-24). Target acceptance and listening
acceptance of slice 2 are in `stand/produktion-warp.md`.
Andreas, 2026-10-22 CLI, on questions F1 to F6 of the spec: "all according to recommendation". Spec:
`~/messungen/2026-10-22-breite1-specs/1.13-warp-stems.md`.
Related to: ADR 005 (beats as time base), ADR 029 (keylock in real time, Bungee), ADR 030 (production in the core),
ADR 033 (routing, same format `/2`), guardrails L1, L2, L5.

## Context

The arrangement played audio at original speed (`arr_stimmen.cpp`: source frame = `offset_frames + (t − Einsatz)`,
where Einsatz is the entry point). A clip that was not recorded at project tempo sits on the beat at the start and
then drifts away. Operation stretches decks and loop boxes with Bungee in the callback (ADR 029), but the
arrangement has neither stretching nor markers.

## Decision (part 1, built)

1. **Warp is a property of the clip** (`AudioClip.warp`): markers `[quell_s, beat]`, both strictly increasing, offset
   `versatz_beats`, source of the markers (`takte`, `mediathek`, later `werkstatt`, `traktor`, `hand`), mode. The
   source file remains untouched; computation happens at playback.
2. **The mapping W(b)** (clip beat → source position) is linear between two markers; before and after, the edge
   segment applies. Server and page compute in seconds (`projekt/warp.ts`, `oeffentlich/produktion/warp.js`), the core
   in frames (`cypherdj/warp_abbildung.h`). A reference file (`vertrag/warp_referenz.json`, 1000 cases, computed
   exactly) binds all three to 1e-12.
3. **The source position follows the project beat of the tempo map, not the elapsed time since the entry.** A warped
   clip reads the source at sample t at W(p(t) − start_beat). Because p(t) comes from the same map as everything else
   (L2), the clip follows every ramp and later the tempo automation (1.12 F1) without its own logic, and the export is
   sample for sample the same computation as listening (L2 "rendered = heard").
4. **RE-PITCH** (mode 0) reads with Catmull-Rom in the callback: the pitch follows the tempo as with a turntable
   record. No thread, no FFT. Measured (32 tracks, scratch, quiet machine): +82 µs median per 256 block against 32
   unwarped tracks (spec calculation: 80 µs); on the repo build with `-O3` (task 5, in the process, not in the JACK
   callback) +65 µs.
5. **Formats: the `/2` of 1.10, no own number.** Project `cypherdj-projekt/2` (ADR 033) gets the optional field `warp`
   on the audio clip, only in `/2`; `/1` stays readable, the upgrade on opening sets `gruppen` and `master` as before
   and no warp. Playback `cypherdj-arr/2` (the same `/2` as routing) carries `clips[].warp`; the server writes `/2`
   when routing **or** a warped clip (on) occurs, otherwise `/1`, byte-for-byte. The core reads both; a warp in `/1`
   is a format error. Reason: with one own number each for routing and warp there would be no file for a project
   with a group and a warped clip that carries both (follow-up on `main` 2ad087f4, decision of the main instance
   2026-10-24).
6. **Limits:** 2 to 4096 markers per clip, 262 144 in the whole playback (all loop copies count; 4 MiB locked
   memory), segment tempo 15 to 800 BPM. The spec names "factor 0.25 to 4" relative to the project tempo; but the
   project tempo changes (60 to 200), and a stored property of the clip must not become invalid because of that.
   15 = 0.25 · 60 and 800 = 4 · 200 are the limits that include the factor 0.25 to 4 for every tempo.
7. **Auto-warp on placement** is decided by the server from the library data (`loeseQuellenAuf`): a loop with bars
   lies on bars · 4 beats; otherwise the BPM of the media library applies from second 0 (for a track with "bar one
   unsure"); one-shots never; without tempo a hint `kein_tempo`. The project tempo never changes the placement (F2).
   Auto-warp needs `dauer_s`: without duration there is no end marker and no length in beats, so `kein_tempo`, even
   if the media library knows a BPM (overall review 2026-10-24, minor 3: 1013 of 7713 loops in the catalogue). The
   page does not offer such entries for dragging anyway (`ziehen.js` `nutzlast`); only `clip_neu` with `warp: "auto"`
   via MCP is affected. The source (4) of the spec without duration (marker `[0,0],[60/bpm,1]`, length from the
   caller) comes with slice 3. Slice 3a puts the workshop tempo map and the Traktor grid in front of it (point 9).
8. **Null test with warp:** gate: residual below −90 dBFS (D1 A7). Measured −145 dB, not −200 as without warp: live
   and render start at different core samples and round the absolute beat calculation differently; a float ULP
   occasionally tips it. Bit-identical would be possible if p were calculated from (t − Einsatz).

## Decision (part 2, built in slice 2)

COMPLEX (mode 2, Bungee grain 512) and TONES (mode 3, grain 256) are computed by a **warp engine (Warp-Werk)**
(`cypherdj/warp_werk.h`, `warp_werk.cpp`, the machine in `warp_werk_bungee.cpp`), not by the callback. Bungee's
position API accepts the marker mapping unchanged: `req.position = W(b(m))` with b(m) = beat_at(m) + offset from the
same map as everything else. Discarded remain: stretching in the callback (32 · 121 to 248 µs in the tail against
5.33 ms), R3 (no arbitrary marker path), pre-render per clip (ADR 029: "no longer computing every audio up and down").

1. **Pool and rings.** 64 fixed slots, two Bungee instances each (grain 512 and 256, in the constructor) and one ring
   (StreckRing, 16 384 frames) with 8 192 frames of lead. The callback reads only the ring (copy plus gain).
   `kern.toml warp_faeden` (default 4, 1 to 8) creates the work threads; they run with SCHED_FIFO JACK − 6 under the
   keylock threads. Without threads (0, render and tests) `takt()` fills the rings in the calling thread,
   deterministically.
2. **Set up before the entry.** The arrangement sets up a voice ARR_WARP_FRIST = 2048 samples (43 ms) before its
   entry (lookahead per block), also the pass after the loop seam (then a second voice that takes over from the first
   at the seam) and during the waiting transport. Where a warped clip would have to sound at the start, the start rule
   grows by ARR_WARP_FRIST. There is no bridge and no varispeed: only fully computed audio is audible. The lookahead
   searches per track in the beat and stops at the first clip beyond the horizon: 4 096 clips cost the block 27 µs
   instead of 64 µs.
3. **Swap and new map.** If a swap changes the warp, the old voice keeps playing out of its ring until
   `s + ARR_WARP_FRIST` and fades out there over 96 samples; the new one starts there (crossfade). If the clip drops
   out or stops being an engine clip, the old one fades out immediately. If the map generation grows (tempo ramp, hand
   on the tempo), every sounding voice sets exactly one successor with the new map at `s + ARR_WARP_FRIST` (live only;
   the render knows no hand). If one finds no room (at a clip boundary where all tracks change at the same time, the
   old clip, the pre-scheduled clip and the successor each hold one per track), it remains open; every block tries
   again until the old clip ends. It is counted (`warp_kein_platz`) only when its voice ends without a successor.
4. **Lifetime.** The thread copies the markers when it takes over a job; the voice holds its audio (`haelt`) from
   taking over until its end in the thread, not only in the block. `WarpWerk::liest(Schnappschuss)` is true as long
   as a job is not taken over or a voice holds audio that the snapshot names last (`ArrAudio::ref` 1); the loading
   thread releases a detached snapshot only when it is wrong (`ArrLader`, wait list of 16). This also applies to the
   old voice of a swap, which keeps playing and computing out of its ring until the crossfade
   (`test_warp_werk_tausch_quelle`). The callback never waits. The current epoch of a voice (`soll`) stands before the
   job it covers; otherwise the thread would consider the newest job superseded.
5. **Failure paths.** Ring empty at read time: silence with a 2 ms fade in and out; `warp_unterlauf` counts the
   dropout (one event, not a continuous counter); `warp_spaet` counts voices whose ring was still empty at their
   entry. Pool full or no engine: the clip plays as RE-PITCH (on the beat, wrong pitch); `warp_kein_platz` counts;
   live and in render the same. A core without Bungee rejects COMPLEX and TONES on load with `warp_maschine_fehlt`,
   instead of silently playing them as RE-PITCH; `CYPHERDJ_BUNGEE` is default ON in the build.
6. **Render synchronous.** `cypherdj-render` sets up a synchronous engine for a playback with engine clips; null test
   COMPLEX/TONES measured −200 dB (bit-identical), control check red.
7. **Counters:** new address `/zustand/warp` (stimmen, unterlauf, kein_platz, spaet, faeden), so that the type chain
   of `/zustand/arr` stays unchanged.
8. **Deviations from the spec, justified in the plan (the loosening of the position limit has not yet been decided
   by Andreas):** position limit 24 instead of 16 samples (Bungee Basic at Hann clicks with stretch 1.024: ±23
   samples, sawtooth, no drift); transpose and detune (slice 5): Bungee `pitch` via the position API; the server
   calculates `pitch = 2^(st/12 + ct/1200)`, the core receives the factor; range −12 to +24 semitones in total
   (decision Andreas 2026-10-28; Bungee Basic would hold 2 octaves downward, but from −13 st the attack in the
   arrangement lies 26.9 samples off, above the position gate 25; the spec named 48; the core still checks 0.25 to 4);
   a change swaps the engine voice like any changed warp; the default mode of new clips stays RE-PITCH.

## Decision (part 3, built in slice 3a)

9. **Source order** werkstatt > traktor > takte > mediathek, each with fallthrough: a map that fails the check (too
   large, not rising, beyond the file) falls back to the next source instead of leaving the clip unwarped (T3).
   Reason: the map from the night analysis is the most accurate source, but not there for every track.
10. **One marker per beat, length from bar one to the end of the file** (D2, T1, `versatz_beats` 0). Reason: the map
    carries the drift beat by beat; the core keeps this at 0.46 samples p90 with 4096 markers (task 4).
11. **Analysis on demand:** a long track without a map is warped at once from the best source (F2), the workshop
    analyzes alongside (`einzeln --nur-analyse`), the arrival writes via `aendern` (a history entry "Auto-Warp", source
    cypher), and only if the warp is untouched and the clip is not sounding (T9 to T11, D1). Reason: no jump under the
    ear, and undo brings back the old warp.
12. **State of the analysis is volatile** in `/proj/aktuell` (`analyse`) and not stored in the project (T8). Reason: it
    holds only as long as the server runs; after a restart a WARP press requests again.
13. **Notices** (`analyse_angefordert`, `analyse_laeuft`, `karte_zu_gross`, `karte_unbrauchbar`, `kein_tempo`) appear in
    the response of `aendern`, not as errors (T7). Reason: the clip is there regardless.
14. **No new source in the history:** the arrival appears as source cypher (T10). Reason: the history knows only Andreas
    and Cypher; the workshop acts on Cypher's order.

## Decision (part 4, built in slice 3b)

15. **Commands for markers by hand compute in clip beats** (the beats of the markers, 0 = bar one of the source) and name
    a marker by its beat before the command, never by an index; all set `quelle hand`, and a warp set by hand is not
    overwritten by an arriving map. Reason: an index is wrong after every change, and `quelle hand` is the only reading
    of the spec for "changed by hand".
16. **Set 1.1.1 Here leaves the offset (`versatz_beats`) in place, the clip starts afterwards at the new bar one and keeps
    the end of the source (length minus old beat of the position).** Reason: this is how Live behaves (pre-roll numbered
    negatively, drag the start marker back to the left), and only then does the real downbeat lie on the bar line after
    the correction (F6, D2 of slice 3a). It changes the sound of the project (decided by the main instance, 2026-10-30).
17. **Return path into the analysis only via the deck's inventory:** line `art eins`, `von andreas`, `ab_quell_beat` = next
    whole beat of the **inventory map**; reading and writing translate via source time, because the filing and the inventory
    count their beats separately. In operation the default; on check instances only with `--korrekturen`. The line takes
    effect in the deck only after a new version (known limit, decided). It reaches 49 catalog tracks (search via `sha` and
    `shas`, 2026-10-30); undo takes back the clip, not the line; for all others the notice `eins_nur_hier` says that only
    the clip changed.
18. **`tempo_vom_clip` sets the window tempo** (60 · length / source seconds of the piece played) and runs as
    `tempo_setzen`, so that its locks apply. Reason: the segment at the start is a random value on a map.
19. **AK22 is measured at export** (whole against split clip), not in the core test: the failure case lies in the server
    (`clip_teilen` computes the offset of the second part), not in the core.

## Decision (part 5, built in slice 4)

20. **BEATS: the server computes the units, the core plays stateless.** The server writes `warp.e` (beat of the unit,
    source frame) finished into the playback; the voice in the core computes the samples since the unit start from the
    project beat and knows neither grid nor detector. Reason: render and live hear the same thing, a start in the middle
    of a unit sounds like the pass-through, and the callback needs no state and no thread. Units begin on a whole sample
    and play the source at factor 1 without a fade (a 32-sample ramp pushed the form correlation to 0.93).
21. **Transients: own detector in the server, the test instrument uses another method.** The detector reads the `.f32` of
    the decode cache and places `<sha>.transienten.json` beside it (version 2). Measured with `w3a_messen` and
    `w3b_messen`. Reason: loops have no workshop analysis, and a detector that checks itself confirms its own error. The
    background is the maximum of the 8 blocks before (a pulsing sustained tone gave 11 hits per second with the mean, 0
    with the maximum). In mode `transienten` the unit starts 3 ms before the hit, because the hit on real loops lies up to
    4.2 ms (p90) behind the foot.
22. **Quantize Audio snaps to the project grid**, not to the grid of the clip: the target is `round((b + off) / r) · r − off`
    with `off = start_beat − versatz_beats`; the default range of the clip, for a loop the first copy. Reason: a clip on
    `start_beat` 0.5 would otherwise snap to a grid that lies shifted against the beats in the project; the project is
    what is heard. Conflicts are rejected by the command, nothing is silently discarded.

## Consequences

- `ArrClip.warp` shows in the snapshot (`ArrSnapshot::warps`, `warp_beat`, `warp_frame` in their own locked pages, booked
  on the account).
- Swapping a snapshot compares the warp by content: a changed warp fades the old one out (96 samples) and fades the new
  one in.
- The counter-test of the null test (`gegenprobe_spur`) shifts all markers of warped clips by one frame.
- New page reasons: `warp_marker`, `warp_faktor`, `warp_modus`, `transpose_repitch`, `kein_warp`, `offset_bei_warp`,
  `kein_tempo`, `marker_unbekannt` (slice 3b); of the core: `warp_maschine_fehlt`.
- Auto-warp source (slice 3a): `werkstatt` and `traktor` come in addition to `takte` and `mediathek`; the map costs at 865
  markers +35 µs per 256 block over 32 tracks (task 16).
- Memory: 128 Bungee instances, 64 rings of 128 KiB and 64 marker copies of 64 KiB live in the core, allocated before
  `mlockall` (measurement in the plan, task 3).
- A warped clip has no `offset_s`; its content moves via `versatz_beats` (splitting, trimming at the left edge and the
  input field compute in beats).
