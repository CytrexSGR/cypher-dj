# Cypher-DJ: Interfaces (contract between the building blocks)


### 20.12 Page API plugins: effects as host stages, instruments as plugin devices (package 1.11, ADR 035)

Playback side: §4.11 (`chain` stage `art: "host"`, field `latenz`), §4.11 `/k/arr/ins_host`, `/k/arr/ins_mess`, `/k/arr/export_lauf`, §5.13 `/e/ins_host`, `/e/ins_mess`, `/e/export_lauf`, `/zustand/ins_host`, §8 ports `arr_ins_<h>_L/R` and `arr_insret_<h>_L/R`. Sources: `djk/ui/plugins/{index,hostverwaltung,zustand,instrumentwirte}.ts`, `areas/plugins/area.ts`, `projekt/{modell,befehle,wiedergabe,bounce}.ts`, `areas/proj/output.ts`, `http/reasons.ts`; MCP tool `plugins`. A project without a host stage or a plugin device writes the same bytes as before.

- **Project fields.** `Insert.art` may be `host` with `plugin: {format: 'vst3' | 'lv2', pfad, uid, name}`, `zustand: 'plugins/<insert-id>.carxs'` (set at creation) and optional `latenz_extra` (samples, 0 to 4096). Plugin identity is `{format, pfad, uid}`; for LV2 `pfad` is the URI and `uid` is empty; on a command line `<format>:<pfad>#<uid>`. A track device may be `{art: 'wirt', name: 'plugin', plugin, zustand}` (`WirtGeraet.name` is `surge` or `plugin`); it takes one of the two host slots, shared with Surge (`slot_belegt` when both are taken).
- **Commands in `proj_aendern`.** `insert_setzen {strang_id, art: 'host', plugin_id | plugin: {format, pfad, uid}, pos? (alias `stufe`)}` (the existing command with a new kind; `plugin_id` resolves the index: `plugin_unbekannt` 404, `plugin_blockiert`, `kein_effekt`), `insert_an` and `insert_entfernen` (unchanged), `insert_latenz_extra {insert_id, samples}` (one undo step; the same value again is no history entry and no reload). `spur_neu {art: 'instrument', geraet: {art: 'wirt', name: 'plugin', plugin_id}}` makes a plugin instrument track (`kein_instrument` for anything but an index entry with `art` `instrument`). The fifth active host stage is `host_grenze`, nothing half applied.
- **Routes (not commands: no undo step, no project write).** `GET /plugins?text=&art=&format=` answers `{plugins, scan}` (the index entries `{id, format, pfad, uid, name, hersteller, art, audio_ein, audio_aus, parameter, status, grund?}`; `scan` is the scan state). `GET /plugins/scan` answers the scan state `{laeuft, seit, ende, ergebnis, fehler}`, also pushed as the SSE event `{a: 'plugins', f: {scan}}`. `POST /plugins/rescan` and `POST /plugins/entsperren {id}` are `nur_andreas`; a second rescan while one runs is `scan_laeuft` (409). `GET /proj/insert/<insert_id>/parameter` answers the host's parameter list joined with the current values (`index`, `name`, `min`, `max`, `vorgabe`, `einheit`, `wert` 0..1). `POST /proj/insert/<insert_id>/param {werte: {<index>: 0..1}}` sets parameters on the host socket (`param_unbekannt` rejects the whole batch, `wert_ungueltig` for NaN, `host_fehlt` while the host is not ready; blocked for the source `cypher` under Stop Cypher as `ki_gestoppt`). `POST /proj/insert/<insert_id>/fenster {an}` opens or closes the plugin's own window (`nur_andreas`; `kein_fenster`, `keine_anzeige` from the host). The instrument track has the same three routes under `/proj/spur/<id>/geraet/parameter`, `/param` and `/fenster`.
- **State of the hosts.** `GET /proj/aktuell` carries `hosts: [{insert_id, h, status, latenz, gemessen, grund?, fenster, anzeige}]` while the project has a host stage (`status` is `startet`, `bereit`, `fehlt` or `ausfall`; `latenz` in samples; `gemessen` false while the stage runs on the estimate of 2 x quantum) and `instrumente` for plugin tracks. `proj_lage` shows the same. A stage with a status other than `bereit` is written to the playback with `an: false` and the last known `latenz`, so the strip plays dry and aligned.
- **Host lifecycle.** The server numbers the project's host stages 1 to 4, starts the host (`djk-insert`), then per host: `/k/arr/ins_host h 1`, `/k/arr/ins_mess h` on the still empty rack (up to 6 attempts at 250 ms while the core's edge check has not yet seen the host), `lade`, `zustand_setzen`, `/k/arr/ins_host h 1`; the playback is reloaded when `latenz` changed. It polls the host every 200 ms and sends `ins_host h 0` when the heartbeat is older than 200 ms or the unit is gone. The flags and the measurement are sent with the source `leitstand`. Three failed starts within 60 s are `ausfall` / `absturz_schleife` (host stopped); a failed state restore is `ausfall` / `zustand_fehler` (the file stays, a `.bak` copy is kept at every write); a latency of 8192 samples or more is `ausfall` / `latenz_zu_gross` (the stage is left out of the playback). The way out of all three is the user switching the stage off and on, or reopening the project. A strip change of a host stage is a removal in one load and an entry in a later load (§4.11 rule for the server).
- **Export.** `POST /proj/export` with an active host stage takes the real-time path: `zustandSichern('export')`, every host must be `bereit` (else `host_fehlt` naming the strip), the audition ends and the master goes to the project tempo (`deck_laeuft` refuses, nothing is loaded), the export view of the project is played through `/k/arr/export_lauf`, then the live view is restored; `ungesund > 0` deletes the file (`export_host_ausfall`), `luecken > 0` deletes it (`export_luecke`). The answer gains `echtzeit: true` and `dauer_s`; while it runs `GET /proj/aktuell` shows `ausgabe_lauf` with `echtzeit: true`. A project whose host stages are all bypassed exports offline as before. `POST /proj/bounce` of a track with an active host stage is `host_insert_echtzeit` (use resample).
- **New reasons** (page API only, `http/reasons.ts`): `host_grenze`, `host_fehlt`, `plugin_nicht_ladbar`, `zustand_passt_nicht`, `param_unbekannt`, `plugin_unbekannt`, `plugin_blockiert`, `kein_effekt`, `kein_instrument`, `absturz_schleife`, `zustand_fehler`, `latenz_zu_gross`, `scan_laeuft`, `kein_fenster`, `keine_anzeige`, `host_insert_echtzeit`, `export_host_ausfall`, `export_luecke`. `host_fehlt` also exists on the core side (§4.11 and §16.2); `host_insert_echtzeit` is also the render error of §4.11 (the offline render's refusal); the page API uses the same word for the refused bounce and for `POST /proj/lautheit` (409, up front, before any freeze) on a project with an active host stage.
- **MCP.** Tool `plugins` with `aktion` `liste {text?, art?}`, `zeige {id}`, `parameter {insert_id | spur_id}`, `param {insert_id | spur_id, werte}`; no rescan, unblock or window action. The tool count is 77 (`djk/hand/AUFRUF.md`).

`ins/utility/<n>/*` (n = 1 to 8; arr-fx slice 1, the stereo tool of package 1.15 (`cypherdj::dsp::Utility`) as an insert stage: width in mid/side, bass mono below a frequency (Linkwitz-Riley 8), gain and balance; 5 controls per instance, the last kind of the table). The pool of eight counts over the whole project; the stage has no latency (IIR only; `latenz` 0 in `insert_module.json`, pinned in `test_arr_pdc`), live playback and offline export run the same code. `breite` 1 is the neutral setting, a width above 2 raises the side part by up to 12 dB and the peak can rise (no clipping guard in the stage), `mono_unter` 0 switches the bass mono off and 1 to 19 act as 20 Hz (the module clamps); a value between 0 and 1 is refused by the server (`argument_ungueltig`). A jump of `mono_unter` can be briefly audible (the step rings out in about 2 ms), so lanes on `mono_unter` are not recommended. With neutral values the stage passes the signal bit for bit.

`ins/bk/<n>/*` (n = 1 to 8; arr-bk slice 3, widened to 32 knobs and then to 64 knobs on 2026-11-11: a Baukasten effect graph as an insert stage: the graph is a file of the graph folder with an input node (`eingang`), the stage runs it on the strip's stereo signal; 65 controls per instance, `an` and `k1` to `k64` (`k9` to `k32` since the 32-knob widening, `k33` to `k64` since the 64-knob widening; a graph defines the ones it uses, the others stay at 0.5 or, where the graph has a `vorgabe` for the knob, start there, see `cypher_bk_regler_vorgabe`), indices 1964 to 2483, the last kind of the generated insert block; the rows `<k>/bk/9` to `<k>/bk/64` of the channels and fx/3, fx/4, 784 rows, follow at 2484 to 3267 so that no older index moves). The pool of eight counts over the whole project; a stage is built outside the callback (the loader builds the graph instance and the playback carries it, `chain[j].graph`, §4.11) and swapped in by pointer with a blend of one block, so switching `an`, adding, removing and replacing a stage never clicks (the jump measure of the test is below the step of the stationary signal). The latency of the graph (`cypher_bk_latenz`, at most 128 samples, a graph above that is refused at load) is a property of the stage like that of a host stage: the loader writes it into the stage and the delay compensation counts it; `latenz` of the kind in `insert_module.json` is 0. The knobs are the `regler` nodes of the graph, up to 64 (`k1` is the node with `nr` 1); a changed value is smoothed over 20 ms inside the instance, so the table carries no ramp. The beat and the tempo of the arrangement reach the graph once per block (`cypher_bk_takt`; a `delay` node with `takt` therefore follows the project tempo, a loop seam inside one block is seen from the next block on), live playback and offline export run the same code. The output is held to plus or minus 8 (a non-finite sample silences the block, as for every kind). Project-only like `ins/komp/<n>/*`; the rows can be driven by a chain lane (`insert.<stage id>.k1`).

*Status 2026-09-23, after the review round ("Kritik und Korrekturen" in ARCHITECTURE), contract version **1** (`protokoll = 1`; the
corrections of this round stay in version 1, because nothing has been built yet). Basis: `ARCHITECTURE.md` and `adr/`.
This contract is binding for all sessions: names, addresses, types, fields, units and policies apply literally.
Where a number is set and not measured, that is stated here; it is binding nonetheless until a measurement
changes it.*

**Rules for changes.** OSC messages have fixed type strings; a new field means a new address or a
new contract version. JSON messages may get new **optional** fields (receivers ignore what they do not know);
new required fields only with a version jump. Every change gets a line in the change log (§20); if it affects
semantics, also an ADR. The machine-readable version is built by **workpiece V0** before K1 and L1 (§19.0): exactly one source,
`~/cypher-dj/djk/contract/osc.json`, from which `osc_addresses.h`/`.ts` are generated, plus JSON schemas and golden sequences. V0 has
one owner; K1 and L1 only read `djk/contract/` and never change it themselves. A test checks that `osc.json` matches
this text.

---

## 1. Basic concepts and units

### 1.1 Time

| Quantity | Type | Unit, meaning |
|---|---|---|
| Sample rate | fixed | 48 000 Hz, everywhere |
| `sample` | int64 | Core sample counter. 0 = first cycle after the first core start without anchor, or after `/k/set/neu`. Keeps running across core restarts (ADR 004: the new core continues from the anchor) |
| `beat` | float64 | Quarter notes since beat 0 of the timeline; function of `sample` via the tempo map (§1.3) |
| Bar no. | int | `floor(beat / 4) + 1` (1-based; V1 only 4/4) |
| Beat in bar | int | `floor(beat mod 4) + 1` (1 to 4) |
| Phrase no. | int | `floor(beat / 32) + 1` (8 bars per phrase) |
| Address "bar.beat" | text | only for humans, announcement line and play sheet, e.g. `17.3`; machines use `beat` |
| `quell_beat` | float64 | Beat in the material, 0 = first detected beat of the version (§13). The first bar one lies at `erste_eins_quell_beat` (0 to 3, §13.2); bars, phrases, structure, hot cue suggestions and fallback loop in the material count from there (A13 "bar one") |
| Duration | float64 | in beats (`dauer_beats`), ≥ 0 |
| `mono_ns` | int64 | `CLOCK_MONOTONIC` in ns; only for diagnosis and extrapolation, never as command time |
| Cycle | | one audio block; quantum V1 = 256 samples = 5.333 ms (ADR 003) |

Conversion beat → sample: `ziel_sample = llround(sample_at(beat))` (rounding to the nearest whole number, halves at ,5 away from zero; as in `proben/02-uhr-sync-planer/kern/uhrkern.cpp`). An event takes effect from exactly this sample, also in the middle of a block.

### 1.2 Values

| Quantity | Type | Unit, range |
|---|---|---|
| Level | float32 | dB; **muted = −200.0**; any value ≤ −120.0 counts as muted |
| Filter | float32 | −1.0 (low-pass fully closed) to +1.0 (high-pass fully closed), 0 = dry |
| Crossfader | float32 | −1.0 (side A only) to +1.0 (side B only) |
| Switch | float32 | 0.0 or 1.0 |
| Tempo | float64 | BPM |
| Note value | float32 | beats (0.75 = dotted eighth) |
| Feedback | float32 | 0.0 to 0.95 |

**Ramps in dB from or to "muted"** interpolate from or to −60 dB and set −200 dB below that (a deliberate choice; a linear dB ramp starting at −200 would have half its duration inaudible).

### 1.3 Tempo map (normative)

Segments `{s0: int64 Start-Sample, b0: float64 Start-Beat, bpm0: float64, k: float64 (BPM je Sekunde), dauer_s: float64 (∞ für das letzte)}`; V1 only **linear in time** (constant is `k = 0`). If `s0` of a new segment is rounded to whole samples, its `b0` lies on the continuous curve at exactly this sample (not at the ordered beat); only then do the golden values below and `uhr_golden` meet the limit 10⁻⁶. Formulas (02 §3.1, measured):

```
beat(s)   = b0 + (bpm0·dt + k·dt²/2) / 60                          dt = (s − s0) / 48000
sample(b) = s0 + 48000 · 120·(b − b0) / (bpm0 + sqrt(bpm0² + 120·k·(b − b0)))
bpm(s)    = bpm0 + k·dt
```

A ramp `(ab_beat, ziel_bpm, dauer_beats)` from tempo `bpm0` has `T = dauer_beats·60 / ((bpm0 + ziel_bpm)/2)` and
`k = (ziel_bpm − bpm0) / T`. The map holds at most **64 segments**; segments that end before the current cycle
are discarded. Andreas' tempo control is **one hand segment** that is reset every cycle (it does not occupy a new
segment per cycle). **The hand segment never jumps:** every change of its target value (encoder detent, `tempo_basis`)
moves it as a linear ramp over 1 beat from the current tempo to the new target value; a new detent during the ramp sets
a new target from the current value. Reason: the only native pitch measurement of a factor jump shows 128 zero samples
(ERGEBNIS §2.6); whether small factor changes do the same is unmeasured (M4). S-shaped corners (04 §4.5) are **not** part of V1
(residual peak at linear corners −107.3 dBFS, below the 16-bit step of −96.3 dBFS; later segment type 2).

**Golden values** (every clock implementation must hit them; computed with the formulas above, deviation ≤ 10⁻⁶
samples before rounding):

| Case | Result |
|---|---|
| constant 128 from sample 0: `sample(64,0)` | 1 440 000.000 |
| same map: `beat(1 440 000)` | 64.000000 |
| ramp 128 → 132 from beat 128 over 32 beats: start | sample 2 880 000.000; `T` = 14.769231 s; `k` = 0.270833 BPM/s |
| same ramp: `sample(144,0)` | 3 237 188.004 (rounded 3 237 188); `bpm` there 130.015384 |
| same ramp: `sample(160,0)` (end) | 3 588 923.077 (rounded 3 588 923) |
| then constant 132: `sample(192,0)` | 4 287 104.895 (rounded 4 287 105) |
| Bar/beat/phrase for beat 0 / 3.5 / 64 / 127.99 / 128 | 1.1 P1 / 1.4 P1 / 17.1 P3 / 32.4 P4 / 33.1 P5 |

### 1.4 Identifiers

| Identifier | Form | Who assigns |
|---|---|---|
| `id` (command) | int64, strictly increasing per sender | every sender; the counter starts at process start so that it keeps rising across restarts: the page server starts at the epoch time in microseconds (`Date.now()·1000`, about 1.8e15), so the id stays below 2^53 as a JS number for good and therefore exact; `mono_ns` (`CLOCK_MONOTONIC`) would pass 2^53 there after 104 days of uptime |
| `quelle` | `andreas` \| `cypher` \| `leitstand` \| `erzeuger` \| `werkstatt` \| `pruefstand` | Sender; Andreas' macros via the control desk carry `andreas`, Cypher's choices carry `cypher` |
| `material_id` | 16 hex characters (lowercase) = first 16 characters of the SHA-256 of the source file | Workshop |
| `plan` | `[a-z0-9_-]{1,24}`, e.g. `p17` | Control desk |
| `hs_id` (listening check) | `[a-z0-9_-]{1,24}`, e.g. `h12` | Control desk |
| `auftrag_id` | `[a-z0-9_-]{1,32}` | Control desk |
| OSC strings | ASCII, at most 47 bytes | all |

### 1.5 Channels and control paths

Channels: `deck/1` to `deck/4` (Andreas says A = 1, B = 2), `erz/1` to `erz/8` (generators and instruments),
`pad/1`, `pad/2` (single hits; since MVP 2 the loop boxes L1 and L2, ADR 025), `bus/1` to `bus/4` (group buses, A17), `master`, `cue`. Every channel except
`master`/`cue` has the same channel strip; a bus has no `ziel` control (it always goes to master).

`erz/8` is the pre-listen input of the browser (cue only): it is audible only via PFL in the cue, never in master/bus/send; `erz/8/fader`, `/ziel`, `/send/*`, `/pfl`, `/trim`, `/eq/*`, `/filter` have no effect (trim, EQ and filter stay neutral: hearing protection, the cue has no limiter). `/erz/strom` with target `erz/8` is rejected with status 6. A NaN from erz/8 stays in its channel strip and reaches neither the PFL sum nor the master guard.

| Path (`<k>` = channel) | Unit | Range | Default | Switching ramp at `dauer_beats = 0` | Who may |
|---|---|---|---|---|---|
| `<k>/fader` | dB | −200 to 0 | −200 (always after loading) | 10 ms | all; `bus/<n>/fader` hand only |
| `<k>/trim` | dB | −24 to +24 | on loading `ziel_lufs` − `lufs_integriert` of the version (§2.1, §13.2), clamped to the range; buses 0 | 10 ms | all |
| `<k>/eq/tief`, `/eq/mitte`, `/eq/hoch` | dB | −200 to +6 | 0 | 10 ms | all |
| `<k>/kill/tief`, `/kill/mitte`, `/kill/hoch` | switch | 0/1 | 0 | 5 ms, second order | all |
| `<k>/filter` | −1 to +1 | | 0 | 20 ms smoothing | all |
| `<k>/send/1` to `/send/4` | dB | −200 to 0 | −200 | 10 ms | all |
| `<k>/ziel` | 0 = `master`, 1 to 4 = `bus/<n>` | | 0 | 10 ms fade | hand only |
| `deck/<n>/stem/drums`, `/stem/bass`, `/stem/vocals`, `/stem/other` | dB | −200 to +6 | 0 | 10 ms | all; only for a deck loaded with stems (§4.4), otherwise `abgelehnt`, reason `keine_stems` |
| `<k>/xseite` | 0 = A, 1 = through, 2 = B | | 1 | immediate | hand only |
| `<k>/pfl` | switch | 0/1 | 0 | immediate | hand only (and the "Hear Cypher" button) |
| `<k>/komp/an` | switch | 0/1 | 0 | immediate | all; source channels only (deck, erz, pad) |
| `<k>/komp/schwelle` | dB | −60 to 0 | −18 | 10 ms | all; source channels only |
| `<k>/komp/ratio` | 1 to 20 | | 4 | 10 ms | all; source channels only |
| `<k>/komp/attack` | ms | 0.1 to 100 | 10 | 10 ms | all; source channels only |
| `<k>/komp/release` | ms | 10 to 1000 | 120 | 10 ms | all; source channels only |
| `<k>/komp/makeup` | dB | 0 to 24 | 0 | 10 ms | all; source channels only |
| `<k>/komp/mix` | 0 to 1 | | 1 | 10 ms | all; source channels only |
| `<k>/komp/sc` | Levels (key: 0 own signal, otherwise source channel + 1: deck/1..4 = 1..4, erz/1..8 = 5..12, pad/1..2 = 13..14) | 0 to 14 | 0 | immediate | all; source channels only |
| `xfader` | −1 to +1 | | 0 | 10 ms | hand only |
| `master/pegel` | dB | −200 to 0 | 0 | 10 ms | hand only |
| `master/kleber` | 0 to 1 | | 0 | 10 ms | hand only |
| `cue/mix` | −1 (cue only) to +1 (master only) | | −1 | 10 ms | hand only |
| `cue/pegel` | dB | −200 to 0 | −12 | 10 ms | hand only |
| `cue/split` | switch | 0/1 | 0 | immediate | hand only |
| `master/pfl` | switch (MASTER CUE: master into the PFL side of the cue) | 0/1 | 0 | immediate | hand only |
| `fx/1/notenwert`, `fx/2/notenwert` | beats | 1/32 to 4 | 0.75 | immediate with crossfade (04 §3.3) | all |
| `fx/<n>/rueckkopplung` | 0 to 0.95 | | 0.5 | 10 ms | all |
| `fx/<n>/rueckweg` | dB | −200 to 0 | 0 | 10 ms | all |
| `duck/tiefe` | dB | −24 to 0 | 0 | 10 ms | all |
| `duck/release` | ms | 50 to 600 | 200 | immediate | all |
| `keylock` | switch | 0/1 | 1 | immediate | all |
| `color/art` | Levels (SOUND COLOR FX: 0 FILTER, 1 SPACE, 2 DUB ECHO, 3 SWEEP, 4 NOISE, 5 CRUSH) | 0 to 5 | 0 | immediate | all |
| `color/param` | 0 to 1 (PARAMETER of the SOUND COLOR FX) | | 0.5 | 10 ms | all |
| `spur/<n>/fader` | dB | −200 to +6 | 0 | 10 ms | all |
| `spur/<n>/pan` | −1 (left) to +1 (right), law −3 dB at center | | 0 | 10 ms | all |
| `spur/<n>/mute` | switch | 0/1 | 0 | immediate (10 ms fade in the Arrangement module) | all |
| `spur/<n>/solo` | switch | 0/1 | 0 | immediate (10 ms fade in the Arrangement module) | all |
| `grp/<n>/fader` | dB | −200 to +6 | 0 | 10 ms | all |
| `grp/<n>/pan` | −1 (left) to +1 (right), balance (0 dB at center) | | 0 | 10 ms | all |
| `grp/<n>/mute` | switch | 0/1 | 0 | immediate (10 ms fade in the Arrangement module) | all |
| `grp/<n>/solo` | switch | 0/1 | 0 | immediate (10 ms fade in the Arrangement module) | all |
| `grp/<n>/cue` | switch (headphone cue of a group of the arrangement: the group signal behind its chain and delay alignment, in front of its fader, balance and mute/solo fade, goes to the PFL side; a parent holds its children; the group's own mute and solo do not close it. Track mute, or a solo elsewhere, silences the member tracks before the group sum, so the cue is empty then. Child and parent both cued: the child is heard twice (the taps add). The tap is taken before the PM chain: with a latency in the PM chain the cue runs ahead of the master by that latency) | 0/1 | 0 | immediate | hand only |
| `pm/fader` | dB | −200 to +6 | 0 | 10 ms | all |
| `spur/<n>/send/<r>` (r = 1 to 4) | dB | −200 to +6 | −200 | 10 ms | all |
| `grp/<n>/send/<r>` (r = 1 to 4) | dB | −200 to +6 | −200 | 10 ms | all |
| `ret/<r>/fader` (r = 1 to 4) | dB | −200 to +6 | 0 | 10 ms | all |
| `spur/<s>/bk/<k>` (s = 1 to 8, k = 1 to 64) | 0 to 1 (transient override of knob `k` of the Baukasten instance of slot `s`, the running number among the tracks with the device `bk` in ascending track number; `s` counts the first 8 bk tracks only, the 9th to 16th have no row (a project holds 16 bk tracks since 2026-11-18); the Arrangement reports a written value to the instance in every block until the next playback build clears it, a lane on the knob wins while it plays; not saved in the restart state and not restored; 512 rows) | | 0.5 | immediately; the instance smooths over 20 ms | all; global (no channel) |
| `ret/<r>/pan` | −1 (left) to +1 (right), balance (0 dB at center) | | 0 | 10 ms | all |
| `ret/<r>/mute` | switch | 0/1 | 0 | immediate (10 ms fade in the Arrangement module) | all |
| `ret/<r>/solo` | switch | 0/1 | 0 | immediate (10 ms fade in the Arrangement module) | all |
| `ret/<r>/hall/an` | switch (Cypher Hall on; off passes the input through dry) | 0/1 | 1 | immediate (480-sample crossfade) | all |
| `ret/<r>/hall/pre` | normalised, pre-delay 0 to 250 ms | 0 to 1 | 0,04 | 10 ms | all |
| `ret/<r>/hall/decay` | normalised, decay time 0,1 to 30 s (logarithmic) | 0 to 1 | 0,5252 | 10 ms | all |
| `ret/<r>/hall/groesse` | normalised, size 5 to 200 ms | 0 to 1 | 0,282 | 10 ms | all |
| `ret/<r>/hall/tief` | normalised, low decay factor 0,25 to 4 (logarithmic) | 0 to 1 | 0,5658 | 10 ms | all |
| `ret/<r>/hall/highcut` | normalised, high cut 1000 to 22000 Hz (logarithmic) | 0 to 1 | 0,8039 | 10 ms | all |
| `ret/<r>/hall/fahne` | normalised, tail level −24 to +12 dB | 0 to 1 | 0,66667 | 10 ms | all |
| `<k>/bk/<n>` (n = 1 to 64) | 0 to 1 (graph knob `regler nr n` of the Baukasten (modular) graph on the channel) | | 0.5 | immediately; the Baukasten library smooths over 20 ms | all; only `<k>` = deck/1..4 (effect graph, §4.10), erz/1, 2, 3, 5, 6, 7 and pad/1, 2 (instrument `bk:<name>`, §4.8); not erz/4 (production) and erz/8 (pre-listen) |
| `fx/<n>/bk/<m>` (n = 3 and 4, m = 1 to 64) | 0 to 1 (graph knob `regler nr m` of the effect graph on send return fx/n, §4.10) | | 0.5 | immediately; the Baukasten library smooths over 20 ms | all; global (no channel) |
| `master/bk/<m>` (m = 1 to 64) | 0 to 1 (graph knob `regler nr m` of the effect graph on the DJ master sum, §4.10) | | 0.5 | immediately; the Baukasten library smooths over 20 ms | all; global (no channel) |
| `<k>/gate/an` | Switch | 0/1 | 0 | immediate | all; only source channels except erz/8 |
| `<k>/gate/schwelle` | dBFS | −90 to 0 | −40 | 10 ms | all; only source channels except erz/8 |
| `<k>/gate/hysterese` | dB | 0 to 24 | 4 | 10 ms | all; only source channels except erz/8 |
| `<k>/gate/ratio` | ratio (100 = hard gate) | 1 to 100 | 100 | 10 ms | all; only source channels except erz/8 |
| `<k>/gate/bereich` | dB (floor) | −120 to 0 | −80 | 10 ms | all; only source channels except erz/8 |
| `<k>/gate/attack` | ms | 0.1 to 500 | 1 | 10 ms | all; only source channels except erz/8 |
| `<k>/gate/hold` | ms | 0 to 2000 | 20 | 10 ms | all; only source channels except erz/8 |
| `<k>/gate/release` | ms | 1 to 5000 | 100 | 10 ms | all; only source channels except erz/8 |
| `<k>/gate/sc` | Levels (key as `komp/sc`: 0 own signal, otherwise source channel + 1) | 0 to 14 | 0 | immediate | all; only source channels except erz/8 |
| `<k>/util/balance` | balance (−1 left, +1 right) | −1 to +1 | 0 | 10 ms | all; source channels except erz/8 and buses |
| `<k>/util/breite` | percent | 0 to 200 | 100 | 10 ms | all; source channels except erz/8 and buses |
| `<k>/util/bassmono` | Hz (0 off; 1 to 19 act as 20 Hz) | 0 to 500 | 0 | 10 ms | all; source channels except erz/8 and buses |
| `<k>/util/phase_l` | Switch | 0/1 | 0 | immediate | all; source channels except erz/8 and buses |
| `<k>/util/phase_r` | Switch | 0/1 | 0 | immediate | all; source channels except erz/8 and buses |
| `<k>/util/tausch` | Switch (swap left and right) | 0/1 | 0 | immediate | all; source channels except erz/8 and buses |
| `<k>/util/dc` | Switch (DC filter) | 0/1 | 0 | immediate | all; source channels except erz/8 and buses |
| `bus/<n>/mb/an` | Switch | 0/1 | 0 | immediate | all; only buses |
| `bus/<n>/mb/grenze_tief` | Hz (crossover low/mid) | 20 to 20000 | 200 | 10 ms | all; only buses |
| `bus/<n>/mb/grenze_hoch` | Hz (crossover mid/high) | 20 to 20000 | 2000 | 10 ms | all; only buses |
| `bus/<n>/mb/<b>/schwelle` (b = tief, mitte, hoch) | dBFS | −60 to 0 | 0 | 10 ms | all; only buses |
| `bus/<n>/mb/<b>/ratio` (b = tief, mitte, hoch) | ratio (1 neutral) | 1 to 20 | 1 | 10 ms | all; only buses |
| `bus/<n>/mb/<b>/attack` (b = tief, mitte, hoch) | ms | 0.1 to 500 | 10 | 10 ms | all; only buses |
| `bus/<n>/mb/<b>/release` (b = tief, mitte, hoch) | ms | 1 to 5000 | 100 | 10 ms | all; only buses |
| `bus/<n>/mb/<b>/knie` (b = tief, mitte, hoch) | dB | 0 to 24 | 0 | 10 ms | all; only buses |
| `bus/<n>/mb/<b>/makeup` (b = tief, mitte, hoch) | dB, trim on top of the automatic make-up (the band adds back its own average gain reduction, up to 24 dB; 0 = automatic only) | −24 to 24 | 0 | 10 ms | all; only buses |
| `bus/<n>/mb/<b>/umgehen` (b = tief, mitte, hoch) | Switch (bypass the band) | 0/1 | 0 | immediate | all; only buses |
| `bus/<n>/lim/an` | Switch | 0/1 | 0 | immediate | all; only buses |
| `bus/<n>/lim/decke` | dBFS (with `kanal_limiter_echtspitze`: dBTP, approximated, see below) | −60 to 0 | −0.3 | 10 ms | all; only buses |
| `bus/<n>/lim/abklingen` | ms | 1 to 2000 | 80 | 10 ms | all; only buses |
| `spektrum/kanal` | Levels (source of the one spectrum analyser) | 0 to 19 | 0 | immediate | all |
| `ins/komp/<n>/an` | switch (compressor insert on) | 0/1 | 0 | immediate | all |
| `ins/komp/<n>/schwelle` | dB | −60 to 0 | −18 | 10 ms | all |
| `ins/komp/<n>/ratio` | ratio : 1 | 1 to 20 | 4 | 10 ms | all |
| `ins/komp/<n>/knie` | dB | 0 to 24 | 6 | 10 ms | all |
| `ins/komp/<n>/attack` | ms | 0.1 to 100 | 10 | 10 ms | all |
| `ins/komp/<n>/release` | ms | 10 to 1000 | 120 | 10 ms | all |
| `ins/komp/<n>/makeup` | dB | 0 to 24 | 0 | 10 ms | all |
| `ins/komp/<n>/mix` | 0 (dry) to 1 (wet) | 0 to 1 | 1 | 10 ms | all |
| `ins/komp/<n>/schp` | Hz (sidechain high-pass, 0 = off) | 0 to 300 | 0 | 10 ms | all |
| `ins/komp/<n>/sc` | steps (key source: 0 own signal, 1 to 32 a key source) | 0 to 32 | 0 | immediate | all |
| `ins/eq/<n>/an` | switch (EQ insert on) | 0/1 | 0 | immediate | all |
| `ins/eq/<n>/out` | dB (output gain) | −24 to 24 | 0 | 10 ms | all |
| `ins/eq/<n>/propq` | switch (proportional Q) | 0/1 | 0 | immediate | all |
| `ins/eq/<n>/b<m>/an` | switch (band on) | 0/1 | 0 | immediate | all |
| `ins/eq/<n>/b<m>/gain` | dB | −24 to 24 | 0 | 10 ms | all |
| `ins/eq/<n>/b<m>/q` | Q | 0.1 to 18 | 0.707 | 10 ms | all |
| `ins/eq/<n>/b<m>/steil` | steps (slope of a cut: 12, 24, 36, 48 dB per octave) | 0 to 3 | 0 | immediate | all |
| `ins/eq/<n>/b<m>/platz` | steps (placement: 0 stereo, 1 mid, 2 side) | 0 to 2 | 0 | immediate | all |
| `ins/eq/<n>/b1/typ` | steps (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass) | 0 to 6 | 3 | immediate | all |
| `ins/eq/<n>/b2/typ` | steps (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass) | 0 to 6 | 1 | immediate | all |
| `ins/eq/<n>/b3/typ` | steps (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass) | 0 to 6 | 0 | immediate | all |
| `ins/eq/<n>/b4/typ` | steps (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass) | 0 to 6 | 0 | immediate | all |
| `ins/eq/<n>/b5/typ` | steps (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass) | 0 to 6 | 0 | immediate | all |
| `ins/eq/<n>/b6/typ` | steps (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass) | 0 to 6 | 0 | immediate | all |
| `ins/eq/<n>/b7/typ` | steps (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass) | 0 to 6 | 2 | immediate | all |
| `ins/eq/<n>/b8/typ` | steps (0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass) | 0 to 6 | 4 | immediate | all |
| `ins/eq/<n>/b1/freq` | Hz | 10 to 22000 | 30 | 10 ms | all |
| `ins/eq/<n>/b2/freq` | Hz | 10 to 22000 | 100 | 10 ms | all |
| `ins/eq/<n>/b3/freq` | Hz | 10 to 22000 | 250 | 10 ms | all |
| `ins/eq/<n>/b4/freq` | Hz | 10 to 22000 | 800 | 10 ms | all |
| `ins/eq/<n>/b5/freq` | Hz | 10 to 22000 | 2500 | 10 ms | all |
| `ins/eq/<n>/b6/freq` | Hz | 10 to 22000 | 6000 | 10 ms | all |
| `ins/eq/<n>/b7/freq` | Hz | 10 to 22000 | 10000 | 10 ms | all |
| `ins/eq/<n>/b8/freq` | Hz | 10 to 22000 | 18000 | 10 ms | all |
| `ins/saett/<n>/an` | switch (saturator insert on) | 0/1 | 0 | immediate | all |
| `ins/saett/<n>/drive` | dB | 0 to 36 | 12 | 10 ms | all |
| `ins/saett/<n>/out` | dB (output gain) | −24 to 12 | −6 | 10 ms | all |
| `ins/saett/<n>/mix` | 0 (dry) to 1 (wet) | 0 to 1 | 1 | 10 ms | all |
| `rack/<k>/m<n>` | macro knob of a rack, 0 to 1 (n = 1 to 4) | 0 to 1 | 0 | 10 ms | all |
| `ins/lim/<n>/an` | switch (limiter insert on) | 0/1 | 0 | immediate | all |
| `ins/lim/<n>/decke` | dB (ceiling) | −60 to 0 | −1 | 10 ms | all |
| `ins/lim/<n>/abklingen` | ms (release time constant) | 1 to 2000 | 80 | immediate | all |
| `ins/host/<n>/an` | switch (effect-host insert on) | 0/1 | 0 | immediate | all |
| `ins/utility/<n>/an` | switch (utility insert on) | 0/1 | 0 | immediate | all |
| `ins/utility/<n>/breite` | factor (stereo width: 0 mono, 1 unchanged, 2 side doubled, 4 side x4 = +12 dB; mid/side, the mono sum keeps its level) | 0 to 4 | 1 | 10 ms | all |
| `ins/utility/<n>/mono_unter` | Hz (bass mono: the signal below this frequency is summed to mono, 0 = off; 1 to 19 act as 20) | 0 to 500 | 0 | immediate | all |
| `ins/utility/<n>/gain` | dB | −60 to 24 | 0 | 10 ms | all |
| `ins/utility/<n>/balance` | balance (−1 left, 0 centre, +1 right, linear law) | −1 to 1 | 0 | 10 ms | all |
| `ins/bk/<n>/an` | switch (Baukasten effect insert on) | 0/1 | 0 | immediate | all |
| `ins/bk/<n>/k1` | knob 1 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k2` | knob 2 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k3` | knob 3 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k4` | knob 4 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k5` | knob 5 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k6` | knob 6 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k7` | knob 7 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k8` | knob 8 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k9` | knob 9 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k10` | knob 10 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k11` | knob 11 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k12` | knob 12 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k13` | knob 13 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k14` | knob 14 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k15` | knob 15 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k16` | knob 16 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k17` | knob 17 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k18` | knob 18 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k19` | knob 19 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k20` | knob 20 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k21` | knob 21 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k22` | knob 22 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k23` | knob 23 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k24` | knob 24 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k25` | knob 25 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k26` | knob 26 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k27` | knob 27 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k28` | knob 28 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k29` | knob 29 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k30` | knob 30 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k31` | knob 31 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k32` | knob 32 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k33` | knob 33 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k34` | knob 34 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k35` | knob 35 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k36` | knob 36 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k37` | knob 37 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k38` | knob 38 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k39` | knob 39 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k40` | knob 40 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k41` | knob 41 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k42` | knob 42 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k43` | knob 43 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k44` | knob 44 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k45` | knob 45 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k46` | knob 46 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k47` | knob 47 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k48` | knob 48 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k49` | knob 49 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k50` | knob 50 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k51` | knob 51 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k52` | knob 52 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k53` | knob 53 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k54` | knob 54 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k55` | knob 55 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k56` | knob 56 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k57` | knob 57 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k58` | knob 58 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k59` | knob 59 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k60` | knob 60 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k61` | knob 61 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k62` | knob 62 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k63` | knob 63 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |
| `ins/bk/<n>/k64` | knob 64 of the effect graph (the graph maps 0 to 1 to its own range; the name is the graph's `regler_namen`) | 0 to 1 | 0.5 | immediate (the instance smooths over 20 ms) | all |

`ins/komp/<n>/*` (n = 1 to 12; package 1.10 slice 4a, 120 controls, indices 1258 to 1377): the compressor inserts of the channel strips of the arrangement (native
compressor, ranges as the plugin and as the DJ-side `<k>/komp/*`; `knie` and `schp` exist only here, `sc` has 32 key sources instead of 14). Global rows without a channel,
appended behind the mix tools so that no index moves. Which strip an insert sits on is project state, not a control. The vocabulary is generated from
`docs/interfaces/insert_module.json` (kinds `komp`, `eq`, `saett`, `rack`, `lim`, `host`, `utility`, `bk`; `komp` has table rows since slice 4a, `eq` and `saett` since slice 4b, `rack` since slice 4c, `host` since plan 1.11 T4, `utility` since arr-fx, `bk` since arr-bk).
The paths `ins/*` are project-only: the server refuses `POST /regler` (and an automation track target) on them with 409 `ueber_projekt` (slice 4a T6); the `rack/*` paths are project-only the same way (slice 4c). An insert stage changes through the project commands (`insert_setzen`, `insert_param_setzen`, `insert_an`, `insert_entfernen`, `insert_ordnung`); opening a project sets the rows of all slots of all kinds (ten per compressor slot, 59 per EQ slot, 4 per saturator slot) before the transport starts (a stage in use with its values, a free slot at the pool defaults with the switch off, so a stage added later never inherits the parameters of the previously opened project), and the export render sets them from the project like the other mixer rows (the render refuses an `ins/*` path outside the table with `regler`).

`rack/<k>/m<n>` (k = 1 to 12; package 1.10 slice 4c, 48 controls, indices 1500 to 1547 since the eq pool of 2026-11-06, before 1441 to 1488): the four macro knobs of the 12 pooled racks, 0 to 1, default 0. A rack belongs to one strip with a chain (project state, `rack` field of the strip); its mapping table (at most 16 mappings per strip: macro, stage, parameter, `von`, `bis`) is part of the playback (`rack` in the playback file, §4.11). Per block the core turns a macro value m into `von + m * (bis - von)` in the real unit of the parameter and drives that parameter with it; the parameter's own row `ins/<art>/<n>/<name>` is ignored while the mapping exists, and the project refuses to set it (`param_gemappt`). The rows are project-only like `ins/*` (409 `ueber_projekt`); a macro value changes through `rack_makro`, the mapping through `rack_setzen`. The stage switch `an` and the compressor key `sc` cannot be mapped, nor can step parameters (`param_nicht_stetig`).

`ins/lim/<n>/*` (n = 1 to 2; limiter insert, 3 controls per instance, indices 1914 to 1919 with two instances (arr-fx slice 2; 1548 to 1550 with one)): a brickwall peak limiter with look-ahead (`KanalLimiter`, sample peak, look-ahead 1.5 ms fixed, 74 samples of latency at 48 kHz, `latenz` in `insert_module.json`), allowed on every strip. `decke` is the ceiling in dBFS, `abklingen` the release time constant. Project-only like `ins/komp/<n>/*`. The stage reports its gain reduction like `komp` (`gr_db`).

`ins/host/<n>/*` (n = 1 to 4; plan 1.11 T4, one control per instance, `an`, indices 1920 to 1923; the utility rows 1924 to 1963 and the bk rows 1964 to 2035 follow; table 2036 of 4096 since arr-bk (1964 of 2048 since arr-fx, 1555 before)): the effect-host inserts, a foreign plugin (VST3 or LV2) that runs in its own host process and is wired to the core on the ports `arr_ins_<n>_L/R` (send) and `arr_insret_<n>_L/R` (return), host n = pool instance `ins/host/<n>` = playback `slot` n (the loader's index is n - 1). The stage has no mapped parameter rows (the plugin's parameters are set through the host, not through the controller table). `an` switches the stage like the other kinds (the project flag AND the row, a blend of 480 samples); a stage that is off, a host that is missing or not healthy passes the input delayed by the stage latency, so the strip never moves in time (bypass keeps the latency). The return is guarded in the callback: a non-finite sample reads as 0 and a sample beyond plus or minus 8 is clamped. The latency of a host stage is not a constant of the kind: it is the round trip through the host process (2 x quantum plus the latency the plugin reports, measured) and is carried by the stage in the playback file (`latenz`, §4.11); `latenz` of the kind in `insert_module.json` is 0. Project-only like `ins/komp/<n>/*`.

`ins/eq/<n>/*` (n = 1 to 8; package 1.10 slice 4b, 59 controls per instance, indices 1378 to 1849 since the pool of eight (arr-fx slice 2, 1378 to 1495 with two); the second instance came on 2026-11-06 on Andreas' decision, see `docs/architecture/stand/routing-1-10.md`, section "EQ pool 2"): the EQ inserts (native `eq_dsp`, eight bands, ranges as the plugin; the band rows are
`ins/eq/<n>/b<m>/<parameter>` with m = 1 to 8; the band types are 0 bell, 1 low shelf, 2 high shelf, 3 low cut, 4 high cut, 5 notch, 6 band pass). The default type and frequency differ per band (the plugin's):
the rows `b<m>/typ` and `b<m>/freq` are listed one by one. Every band starts off, so a new EQ is flat. The EQ always runs its oversampler and delays the strip by 69 samples at 48 kHz, whatever the bands
do (spec D10). `ins/saett/<n>/*` (n = 1 to 4; package 1.10 slice 4b, saturator, 4 controls per instance, indices 1850 to 1865 with four instances; 1496 to 1499 with one): the saturator inserts (native `saett_dsp`, tanh with antiderivative antialiasing, oversampled, 69 samples
of latency). The pool sizes of both kinds were decided by the cost measurement of slice 4b (`docs/architecture/stand/routing-1-10.md`, section "Slice 4b cost table"), they are `instanzen` in `insert_module.json`. Both kinds are
project-only like `ins/komp/<n>/*`. Their latency is `latenz` in `insert_module.json` (69 samples at 48 kHz for `eq` and `saett`, 74 for `lim`; `komp` and `rack` 0), pinned to the modules by `test_arr_pdc`. The arrangement compensates it (slice 4b T13, §4.11 and
`docs/architecture/stand/routing-1-10.md`, section "Slice 4b T13/T14"); the temporary refusal `pdc_fehlt` of T12 is gone.

`<k>/gate/*`, `<k>/util/*`, `bus/<n>/mb/*`, `bus/<n>/lim/*` and `spektrum/kanal` (package 1.15 mix tools, A1b, 345 controls, indices 913 to 1257): the control rows of the
mix tools, appended at the end of the table so that no existing index moves. Gate (9 controls) on the 13 source channels deck/1..4, erz/1..7 and pad/1..2; utility (7) on those
13 and on bus/1..4 (17 channels); multiband (24: `mb/an`, two crossover frequencies, 3 bands of 7) and channel limiter (3) on bus/1..4; spectrum is one global source
(0 to 19, steps). `erz/8` has no tool row: it is cue only and returns before every insert. The defaults are the library defaults, the ranges its clamps. Switches and
steps set without a ramp, all other rows with 10 ms. Gate and utility act in the channel strip since A3, the multiband rows on the buses since A4 (A1b only added the rows). The limiter rows `bus/<n>/lim/*` act since A5b, only while `kanal_limiter_vorhalt_ms` is above 0. Switching `lim/an` on (and the reset of the F01 guard) crossfades from the UNLIMITED dry signal over 480 samples after an unheard start of L samples, so the bus sits above the ceiling
for a while: measured up to +9 dB for 7 to 12 ms after a switch-on and up to 15.9 ms after the F01 guard (a 100 Hz sine of amplitude 2.0 under a -3 dB ceiling, without true peak, n = 256); the sound is click-free and the master limiter is behind it. Pinned by a test: from L + 480 samples plus one block after the (last) switch-on, or after the guard block, the peak is within the ceiling + 0.01 dB again, also for 1 -> 0 -> 1 within 64 samples. While the limiter is not yet audible (the unheard start) its reduction meter reads 0. Not offered as controls: utility `gain_db` (trim and fader exist), per-band multiband `solo` (a monitoring tool), limiter `vorhalt_ms` and `echtspitze` (fixed
after construction, `kern.toml` keys `kanal_limiter_vorhalt_ms` and `kanal_limiter_echtspitze`, §2.1). The restart state stores them by path like all others. The row table:
`djk/core/signalbox/include/cypherdj/signalbox/tool_controls.h`. "source channels except erz/8 and buses" in the utility rows means the source channels except erz/8, plus the buses.

`keylock` (Keylock Task 3; ADR 029 comes with Task 4): ONE switch for all sources, no deck argument. On (default): decks and loop boxes play via the time stretcher (Dehner; Rubber Band R3 in the work thread, one per source) at their pitch, each event with a varispeed bridge up to `s_h`; a waiting box starts with a lead-in and fades out to the one from the ring (ADR 029 section loop boxes, since Task 7; pre-rendered variants per ADR 027 no longer exist). Off: decks and loop boxes play varispeed (pitch follows tempo). The REC conversion of a recording stays offline (ADR 027 decision 6) and does not depend on the knob. A new subscriber receives the state at the first `/k/hallo` as `/e/regler keylock` (§5.7). Takes effect at the sample, also while a deck is running. Without the stretcher (kern.toml `keylock = false`, §2.1) the knob has no effect on the decks.

`<k>/komp/*` (effect section, 2026-10-11): Cypher Komp (compressor; Rust `komp_dsp` via `hall_ffi`, Giannoulis, Massberg, Reiss 2012) per
source channel after EQ and filter, before the fader (PFL hears it), knee fixed at 6 dB; with `komp/sc` the detector listens to the input
of another source channel (before its trim and EQ), e.g. the kick on erz/1 (value 5); off = bit-identical to the
channel strip without compressor. Status: `docs/architecture/stand/kompressor.md`.

`color/*` (SOUND COLOR FX modeled on the XDJ-XZ, 2026-10-11): `<k>/filter` is the COLOR control of each channel, `color/art` and `color/param` apply to all channels as on the desk. Type 0 is the DJ filter as before (bit-identical); every other type replaces it at the same point in the channel strip (before the tap, i.e. before PFL and fader). In the dead zone |k| < 0.05 the output is dry; SPACE and DUB ECHO (3/4 beat from the master tempo) fade out after turning back, and a type change empties them. Curves: `djk/core/dsp/include/cypherdj/dsp/colorfx.h`, status: `docs/architecture/stand/color-fx.md`.

`spur/<n>/*` (D1, ADR 030, n = 1 to 32): track controls of the arrangement, global (no channel; channel −1 of the control table). In the Arrangement module they act on the track before the sum into the input of `erz/4` (§4.11): fader,
pan (left cos, right sin via (pan + 1)·π/4, at center −3 dB per side), mute and solo fade over 10 ms (if any track is solo, all others are silent).
The track fader reaches +6 dB (D1 spec 6.16); its hand curve is the fader curve with an upper limit of +6 (top +6 dB, 0 dB at position ≈ 0.501). The check I3 (listening check) exempts them, as it does `erz/*` and `pad/*`.
The AI track (§4.7) takes only `spur/0` for tracks (no track), see §4.7. Since decision E-a (package 1.18, 2026-10-20), an AI stop no longer lowers any fader; S2 sends only `spur/0` (D1 6.39).

`grp/<n>/*` (1.10, ADR 033, n = 1 to 16) and `pm/fader`: group controls and fader of the production master in the Arrangement module, global (channel −1). A group track
takes up the tracks whose target it is in playback (§4.11, `ausgang`), sums them after their fader and pan, and feeds the sum with its own fader, pan, mute and solo
into its target (the production master or a parent group); the PM fader acts on the sum of all targets `master` before it goes into the input of `erz/4`. Since ADR 036 a group can also feed another group (a tree, up to 16 groups, no cycle). Mute of a group zeroes everything below it (subgroups and sends included); solo on a
track keeps all groups above it sounding, solo on a group keeps everything below it and all groups above it sounding (siblings and everything else are then silent); mute wins over solo. Value ranges as for `spur/<n>/*`, but the pan of a group is a balance (center 0 dB, toward the side the other side gets quieter until silent), so that grouping does not change the level.
The check I3 (listening check) exempts them. The controls sit at the end of the table (index 564 to 596); the restart state saves by path and stays valid.

`spur|grp/<n>/send/<r>` and `ret/<r>/*` (1.10 Slice 3, n as above, r = 1 to 4, 204 controls): sends and return strips of the Arrangement module, global (channel −1).
A send is taken post fader, post pan and post mute/solo fade of its track or group; a track inside a group also follows the mute/solo fade of that group and of every group above it (a muted group
silences the sends of everything below it), the fader and balance of a group do not act on the sends of its members or of its child groups. A send of −200 dB is off. The return strip sums the sends,
passes them through its own Cypher Hall (`ret/<r>/hall/*`, one instance per return, wet only; `hall/an` 0 passes the input through dry), applies fader, balance and
the mute/solo fade, and adds the result to the production master before `pm/fader`. Return solo counts like a track solo (every track and group without solo falls silent
together with its sends); a return without solo is not silenced by a track or group solo. The hall values are normalised 0..1; the kernel maps them to units (arr_returns.cpp).
The name trap: `ret/<r>/hall/pre` is the pre-delay of the hall, not a pre/post switch (that comes with slice 4). The Hörschein check (I3) exempts these controls.
The controls stand at the end of the table (after the `bk` block, 204 controls); the restart state stores by path and stays valid.

`duck/*` (K2): the core lowers erz/2 and erz/3 on every played kit sound `bd:*`, at the sample of the event (sidechain, without delay).

`master/kleber` (K2): threshold of the sum compressor 2:1 (attack 30 ms, release 200 ms): 0 = off, 1 = −30 dB on the detector |L|+|R|, linear in dB (threshold = +6 − 36·value dB; 1/3 = −6 dB); fully wet, no parallel mix. It acts after the tap of the master sum (channel 14), before `master/pegel`: the ear tap does not see it. Turning back to 0, it fades out without a step (the gain recovers over the release).

`<k>/send/2` (after the fader) feeds the reverb, `fx/2/rueckweg` routes it into the master sum. `<k>/send/3` and `<k>/send/4` feed the send buses `fx/3` and `fx/4`; an effect graph set with `/k/kanal/graph` on `fx/3` / `fx/4` (S6) processes the summed bus and its output is added to the master sum scaled by `fx/3/rueckweg` / `fx/4/rueckweg` (after the hall return, before the master beat FX). Without a graph the return is silent. `fx/<n>/notenwert`, `fx/<n>/rueckkopplung` and the returns fx/1 have no effect.

`fx/1` is the beat-synced echo (mixed form), `fx/2` the reverb. `fx/3` and `fx/4` are the returns of the send effect graphs
(Baukasten S6): the graph outputs wet only, runs every block while set (an echo tail is not cut when the send goes silent), has
no latency and eight knobs per return, `fx/3/bk/1..8` and `fx/4/bk/1..8` (§1.5, S14; the values belong to the slot and survive a graph switch). Switching blends the old output
into the new one over 480 samples, removing blends to silence; the output is clamped to ±8. Not persisted over a restart. Plugin-host
returns (slice 8) would need another slot. A command with a source other than `andreas` to a path "hand only" is rejected with reason `nur_hand`.

**Routing V1 (A17, draft):** every channel goes via `<k>/ziel` directly to master or to one of the four
group buses; a bus has the full channel strip and goes to master; four sends per channel after the fader to `fx/1`
to `fx/4`. The mixer in the core is an **assignment table**, not a chain of fixed paths: K1 may still leave buses and
`fx/3`/`fx/4` empty in slice 1, but not the table. Freely wirable inserts come with the hosts
(slice 8, ADR 009); whether Andreas wants more routing (matrix, subgroups within subgroups) is question 5 in ARCHITECTURE §13.

### 1.6 Open, audible and "deep open" (set, calibrated in M18)

- **Channel level(k)** = `<k>/trim` + `<k>/fader` (dB; 0 dB means: the channel sounds at `ziel_lufs`).
- **offen(k)** ⇔ channel level(k) > **−26 dB** (linear 0.05; threshold from 09 §6). `offen` does **not** depend on
  bus, crossfader or master: a plan that raises a fader behind a closed crossfader or bus opens the channel.
  **I3 checks `offen`** (§17).
- **Effective channel level** = channel level(k) + (for `ziel` = `bus/<n>`: `bus/<n>/fader` + the crossfader weight of
  the bus's side; otherwise the crossfader weight of its own side) + `master/pegel`.
- **hörbar(k)** ⇔ effective channel level > −26 dB **and**, for decks, the deck is running (status 2 to 5 in §5.5): a
  stopped, run-out or never-started deck is never audible. `hörbar` counts for I1, I2 and the deadline guard.
- **tief_offen(k)** ⇔ hörbar(k) ∧ `kill/tief` = 0 ∧ `eq/tief` > **−12 dB** (for decks with stems additionally
  `stem/bass` > −12 dB).

---

## 2. Transports, addresses, paths

| Path | Transport | Address | Direction | Formats |
|---|---|---|---|---|
| Commands to the core | OSC 1.0 over UDP, loopback only | `127.0.0.1:47100` | Control station, generator, test bench → core | §4 |
| Core outputs | OSC over UDP | to each subscriber `127.0.0.1:<port from /k/hallo>` | Core → subscribers | §5 |
| Default ports of subscribers | UDP | control station 47110, generator 47120, analysis 47130, test bench 47140 | | §4.1 |
| Notbahn (the fallback path) reports | OSC over UDP | to 47110 and 47140 | Notbahn → control station, test bench | §5.10 |
| Hand | JACK-MIDI | `cypherdj-kern:hand_in` (input), `cypherdj-kern:hand_led` (output) | Controller ↔ core | §7 |
| MIDI to sound generators and devices | JACK-MIDI with sample offset | `cypherdj-kern:midi_aus_1` to `_4`, later `cypherdj-kern:clock` | Core → hosts, devices | §4.8, §7 |
| Audio core → Notbahn | shared memory, SPSC ring | `/dev/shm/cypherdj/bus` | Core → Notbahn | §6.1 |
| Audio Notbahn → interface | JACK audio | `cypherdj-notbahn:master_L/R` → interface 1/2, `cue_L/R` → 3/4 | | §8 |
| Envelopes core → analysis | shared memory | `/dev/shm/cypherdj/huellen` | Core → analysis | §6.2 |
| Restart state | shared memory, seqlock | `/dev/shm/cypherdj/zustand` | Core → core (next generation), test bench | §6.3 |
| Working inventory, crate | files in tmpfs | `/dev/shm/cypherdj/material/<material_id>/`, `/dev/shm/cypherdj/kiste.json` | Control station → core | §6.4, §6.5 |
| Control station hub | WebSocket, JSON text frames | `ws://127.0.0.1:47200/` | Control station ↔ player driver, MCP, analysis, workshop, announcement, display, test bench | §9 |
| Rechner (planner) | Unix socket, JSON lines | `$XDG_RUNTIME_DIR/cypherdj/rechner.sock` | Control station → Rechner | §11 |
| Cypher | MCP over stdio | `cypherdj-mcp` as child of the player session | Player ↔ MCP (then WS to the control station) | §10 |
| djk cues: preview (commands + reports) | OSC 1.0 over UDP, loopback only | `127.0.0.1:47740` (+1000·k per instance, `CYPHERDJ_INSTANZ`) | Cue server (djk/cues) ↔ preview (djk/previewer) | docs/architecture/stand/vorhoerer.md |
| Generation | HTTP | ComfyUI of the GPU machine, port 8288 (address from `~/.config/cypherdj/werkstatt.toml`, key `comfy_musik_url`) | Workshop → GPU machine | §12.3 |
| Inventory | files | `~/cypher-dj/bestand/` | Workshop writes, all read | §13 |
| Set journal, recording | files | `~/cypher-dj/sets/djk/<JJJJ-MM-TT_hhmm>/` | Control station, recording | §15 |
| Configuration | files | `~/.config/cypherdj/` (`kern.toml`, `leitstand.toml`, `werkstatt.toml`, `controller/<geraet>.json`); the Notbahn reads no file, it gets everything as call parameters from its unit (§8) | | §2.1 |

UDP packets are at most 1 400 bytes (stays below the loopback MTU; generator bundles otherwise split into several
windows).

### 2.1 Configuration keys (schema; defaults set, not measured unless noted otherwise)

Unknown keys are a startup error (typos show up at once). Every file begins with `version = 1`.

| File | Key | Type | Default | Meaning |
|---|---|---|---|---|
| `kern.toml` | `start_bpm` | float | 128.0 | tempo of a new timeline without anchor (§1.1) |
| | `filter_guete` | float | 0.707 | quality of the DJ filter, 0.5 to 4 (A27, 04 addendum; above 4 locked until Andreas has listened) |
| | `hoerschein_pflicht` | bool | true | switches `PrueferI3` on (I3a, §17); ear test Task 13 |
| | `keylock` | bool | true | stretcher and keylock threads in the core (Keylock Task 3; ADR 029 follows with Task 4); false: without stretcher, decks in varispeed, the control `keylock` (§1.5) only affects the loop boxes |
| | `keylock_maschine` | str | `r3` | keylock engine (Bungee rework S2): `r3` Rubber Band in threads (fallback), `bungee` Bungee synchronous in the callback without threads (grain 512), `bungee_fein` (grain 256); Bungee only in the core with `CYPHERDJ_BUNGEE`, otherwise keylock off |
| | `warp_faeden` | int | 4 | worker threads of the warp works (package 1.13 slice 2, ADR 031 part 2): COMPLEX and TONES compute in these threads with lead time (8 192 frames), SCHED_FIFO JACK priority − 6 (below the keylock threads); 1 to 8; the 64 slots of the works are fixed in the code |
| | `graph_faeden` | int | 2 | worker threads of the graph works (build kit S3b): the graphs of the `bk:` streams compute one block ahead in these threads, SCHED_FIFO JACK priority − 7 (below the warp works); 0 to 8, 0 computes synchronously in the callback; without real-time permission the works fall back to synchronous. The 32 slots are fixed in the code |
| | `hall_faeden` | int | 3 | Worker threads of the Hall pool: the Halls of the arrangement's return strips compute in parallel, return 1 in the callback, returns 2 to n+1 on the workers; SCHED_FIFO JACK priority − 1; 0 to 3, 0 computes every Hall in the callback, the output is bit-equal. A job is late when its worker has not finished it 25 % of the block length (`min(JACK buffer, 1024)` samples) after the hand-over; more than 4 late events in 64 blocks switch the pool off for good (the callback then computes everything itself). The state is in `/lage.hall_pool` and `/zustand/hall_pool`. Fewer free physical cores than asked for gives fewer workers and a start line. Without a real-time right the workers stay SCHED_OTHER and the pool switches itself off quickly under load (measured: SCHED_OTHER, default deadline: late 8, taken back 7, off, hash equal), visible in `/lage.hall_pool` and the end-of-run line |
| | `hall_cpus` | str | `""` | CPU ids of the Hall workers, comma separated, no ranges (`"1,2,3"`); each must exist and be online, none twice; fewer ids than `hall_faeden` start as many workers as ids, with a start line. Empty: the kern picks one physical core per worker from `/sys/devices/system/cpu/cpu*/topology` (equal `physical_package_id` and `core_id` are siblings), only among the CPUs the process may use (`sched_getaffinity`; in operation the unit's `CPUAffinity`, which `djk-start` computes from `CYPHERDJ_KERN_KERNE` = 4, on the dev box 0-3 and 8-11). The lowest allowed core (CPU 0 and its sibling) stays with the JACK thread, which the kern pins there (thread-init callback; the start report names the effect) and with the rest; every further core gets a worker on its lowest CPU. Only blanks count as empty (automatic). Invalid text or a duplicate is always a start error; a CPU that does not exist or is offline is a start error only when `hall_faeden` > 0 (with `hall_faeden` 0 the key is unused: a warning line, the syntax is still checked); a CPU outside the allowed mask or two SMT siblings in the list are a warning line. `djk-start`: `CYPHERDJ_KERN_CPUS` set explicitly still wins for the kern process, but the stems now get all OTHER online CPUs (until 2026-11-06 they were fixed at 2-7,10-15), a CPU that is not online is a start error, and the list is written back as normalised ranges (`0 1 8 9` becomes `0-1 8-9`); `CYPHERDJ_KERN_KERNE` above 1 to cores−1 is clamped with a note |
| | `stimme_eingang` | int | 0 | Voice channel for spoken commentary: the input pair `ein_<k>` (1 to 4) is summed into the master in front of the master limiter, so the limiter ceiling holds for music plus voice; the voice is delayed by 100 ms look-ahead and a detector on the undelayed voice ducks the music by `stimme_duck_db` before the first syllable (hold 300 ms, release about 400 ms). The voice follows `master/pegel`. 0 = off, the master is bit-identical to a kern without it (`test_kern_stimme`, mutation `CYPHERDJ_MUTATION_STIMME_IMMER_AN`). Use a pair that no device assignment uses |
| | `stimme_duck_db` | float | -12.0 | Voice channel: music gain while the voice speaks, -40 to 0 dB |
| | `stimme_pegel_db` | float | 0.0 | Voice channel: gain of the voice in front of the master limiter, -40 to +12 dB |
| | `spur_pool` | str | `"an"` | Track phases on the Hall pool: whether the track sources of the arrangement (phase Q, the lane-capable tracks) compute on the pool workers inside the audio block, with the serial summation in the fixed order, so the output is bit-equal in every mode. `"an"` (default, live and production alike): on, as soon as every pool worker runs SCHED_FIFO; `"aus"`: the callback computes every track itself; `"auto"`: a synonym of `"an"`, kept for old configs. In both modes the track phases that switched themselves off (a stalled track job or repeated late events) are switched on again by the kern after a back-off of 4096 blocks, doubling with every further switch-off up to 65536 blocks (about 5.8 minutes at quantum 256), provided every worker is free again; the Halls keep running. Needs `hall_faeden` > 0: without a pool the mode is `aus` and the kern says so at start. Any other text is a start error that names the three values. The state is in `/zustand/spur_pool` |
| | `kanal_limiter_vorhalt_ms` | float | 0 | lookahead of the channel limiters on bus/1..4 (package 1.15 mix tools, A1b, D8): 0 (default) = the four limiters are not built, latency 0, the `bus/<n>/lim/*` rows exist but do nothing; 0.1 to 20 builds them with this lookahead (built once, fixed afterwards, it sets the latency); 0.05 and 25 are a start error. Since A5b the core builds them at start and sets the latency account to their look-ahead, L = round(`vorhalt_ms` * 48) + 2 samples (26 at 0.5 ms, 74 at 1.5 ms): every master-bound path, the PFL, the metronome and the export alignment included, is then L samples later; `bus/<n>/lim/*` act only in that case |
| | `kanal_limiter_echtspitze` | bool | false | true-peak detection (4x oversampling) of the channel limiter on bus/1..4 (A1b): built once; true adds 12 samples of latency (38 at 0.5 ms); the ceiling is then a dBTP held for sine material (within 0.0125 dB); for broadband noise it is measured up to +1.4 dB above (16x reference with 256 taps on the limiter output, uniform and triangular noise, 4 seeds, windows of 10000 samples: +0.35 to +1.37 dB); the cause is open (not the 4x grid: 4x and 16x agree at the output), follow-up package, no library fix in A5b; without `kanal_limiter_vorhalt_ms` above 0 nothing is built and the key does nothing |
| | `udp_port` | int | 47100 | commands (§2) |
| | `arbeitsbestand` | path | `/dev/shm/cypherdj/material` | §6.4 |
| | `speicher_budget_mib` | int | 3800 | locked budget below the 4 GiB limit (10 check d), unloading per ADR 015 |
| | `controller_geraet` | str | `""` | name of the mapping file under `controller/` |
| | `ziel_lufs` | float | −16.0 | loudness per channel at fader 0 dB (trim on load, §1.5); default for nodding, unmeasured by ear |
| | `hoerbar_db`, `tief_offen_db` | float | −26.0, −12.0 | §1.6, M18 |
| | `max_stretcher` | int | 4 | §4.4, ADR 020 |
| | `stretcher_threads` | int | 2 | worker threads for R3; at most 2 R3 per thread (01 NP K1), M3 [PRELIMINARY, 2026-09-23 13:3x: the recheck of dossier 01 measures R3 in FIFO worker threads with lead-in of 8 per thread without underrun (16 on 2 and 32 on 4 threads, limit only at 16 per thread; SCHED_OTHER instead of FIFO: 23 underruns). The limit is decided by M3 (slice 30).] |
| | `limiter_dbtp` | float | −1.0 | master limiter |
| | `pruefmodus` | bool | false | allows `/test/*` (§19.0) |
| | `hand_osc` | bool | false | allows `/test/hand` even without `pruefmodus` (hand path of the surface, slice 35, §19.0); all other `/test/*` stay bound to `pruefmodus` |
| | `arr_ordner` | path | `""` | working folder of the playbacks (§4.11, D1): empty = `~/.cache/cypherdj/arr`, check instance `~/.cache/cypherdj-<i>/arr`; the page server reads the same value. The core normalizes it (`//`, `./`, `..`, trailing slash; D1 6.14) |
| | `arr_budget_mib` | int | 1024 | share of the locked memory for arrangement audio (§4.11), at most `speicher_budget_mib`; it counts against `speicher_budget_mib` as well (one account with the deck loader) |
| `leitstand.toml` | `ws_port`, `abo_port` | int | 47200, 47110 | §2 |
| | `set_basis_bpm` | float | 128.0 | fixed set base until slice 5 |
| | `autonomie_start` | int | 1 | §10 |
| | `bestand`, `sets` | path | `~/cypher-dj/bestand`, `~/cypher-dj/sets/djk` | §13, §15; a test instance (`CYPHERDJ_INSTANZ` a to i) whose `sets` is the default writes its sets to `/dev/shm/cypherdj-<i>/sets`, an explicit other `sets` is used as written, the production instance keeps the default |
| | `rechner_socket` | path | `$XDG_RUNTIME_DIR/cypherdj/rechner.sock` | §11 |
| | `zug_vorlauf_takte`, `antwort_frist_takte` | int | 12, 4 | §3, ADR 013 (lead time since 2026-09-26 twelve bars: fallback after M15) |
| | `nachrender_ruhe_takte` | int | 16 | ADR 020 |
| | `grenzen_tief_verriegeln` | bool | false | §11: warning only; M20 (2026-09-25): rule §14.4 breaches the deep limit, safe 9/12, hard 11/12, therefore false |
| | `journal` | str | `"voll"` | Journal mode of the leitstand (§15): `voll` or `schlank`, anything else is a start error naming file and key. The option `--journal voll\|schlank` of the leitstand and of `djk-start` wins over the key. `djk-start` passes `schlank` to the production instance (no `--instanz`) and nothing to a test instance (`voll`) |
| `werkstatt.toml` | `comfy_musik_url` | str | (from skill `cypher-musik`) | §12.3 |
| | `bestand` | path | `~/cypher-dj/bestand` | §13 |
| | `threads` | int | 4 | per job; unit with `Nice=19`, `CPUSchedulingPolicy=batch` |
| | `luft_db` | float | −12.0 | headroom before R3 (08 NP K5) |
| | `tor_raster_ms`, `tor_klarheit`, `tor_streckfaktor`, `tor_headroom_dbtp` | float | 8.0, 0.1, 0.20, −1.0 | §12.3; `tor_streckfaktor` 0.20 from M19 (2026-09-25, 5-ms convention, at 30 ms 0.30), provisional until M18 |
| | `stimmung_max_cent` | float | 35.0 | §12.3 |

---

## 3. Timebase and lead time

| Level | Who plans | Minimum lead before `ab_beat` | Evidence, status |
|---|---|---|---|
| Control part, switch | Control station | **2 cycles** (10.7 ms at 256) plus transport | send to takeover median 2.9 ms, max 8.1 ms (02 check b, NP 6.2 ms) |
| Deck command on the direct path | Control station | 2 cycles | as above |
| Deck command on the stretcher path | Control station | `vorlauf_ms` from `/zustand/deck` plus 2 cycles (computed ≈ 113 ms at 256 with R3 and 4 blocks of work lead-in); **planners hold ≥ 1 beat** | 03 §4a (buffer lead 80.9 ms), M3 |
| Deck start (`/k/deck/start`) | Control station | **1 beat** (pre-filling the stretcher) | 02 check c (cushion and delay 85.3 ms) |
| Tempo ramp | Control station | **1 beat**; the core sets the stretcher factor internally 50 ms ahead | 03 §4b2 |
| Generator window | Generator | window `[n+1, n+3)` at bar n; switch ≥ 0.1 beat before the grid boundary | 06 check a |
| Listening certificate | Analysis | 4 bars of measurement at the measurement tap (set), then **renewed after every bar** over the sliding 4-bar window, as long as the channel runs in sync (§14.5) | 08 §3.3.6 |
| Loading | Control station | ≥ 1 bar before the start of the listening-certificate measurement; copy into the working inventory before that | 10 NP N8 (0.05 ms per MiB) |
| Turn request to Cypher | Control station | ≥ 12 bars before the earliest start (since 2026-09-26, M15: turn p95 9.9 s with slow API, so the reply window is 8 bars = 15 s); reply deadline `antwort_bis_beat` = earliest start − 4 bars (7.5 s at 128). Measured: free plan via the tool 4.5 to 8.7 s, warm text turns with schema up to 14.5 s; choosing as a tool call is unmeasured (M15). If the deadline tips, the request moves to F−28 for "safe" (ADR 013) | 09 §3.2, NP K6/K7 |
| Suggestion to Andreas | Control station | expires 1 bar before its start (`verfaellt_beat`) | set |
| Fresh song | Workshop | 15 to 30 min (ADR 022) | operating value plus calculation, M14 |

A command that arrives in the core ring after its target sample is **late** and is handled according to its policy
(§16).

---

## 4. Commands to the core (OSC over UDP `127.0.0.1:47100`)

All commands are single OSC messages (no bundles; exception: generator window §4.8). Every command begins with
`h id, s quelle`. The core answers every subscriber with `/q` (§5.1). Unknown addresses or wrong type strings
produce `/e/protokollfehler` (§5.9) and are discarded.

**Policy codes** (`i politik`): 0 = `musik` (too late → discarded), 1 = `zustand` (too late → executed in the next
cycle), 2 = `raster` (too late → next reachable grid point of size `raster_beats`). Details in §16.

### 4.1 Connection

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/hallo` | `,sii` | `name`, `port`, `protokoll` (= 1) | register subscriber. Reply to this port: `/k/willkommen`. Repeat at least every 2 s (heartbeat); the core strikes subscribers after 5 s of silence; at most 8 subscribers |
| `/k/tschuess` | `,s` | `name` | unregister |

`/k/willkommen ,iihdds`: `protokoll`, `generation` (core restarts since the start of the timeline), `sample`, `beat`,
`bpm`, `kern_version`. If `protokoll` does not match, the core answers `/e/protokollfehler` instead.

**Subscribers across a restart:** the list (name, port, protocol, last report) is in the restart state (§6.3). A
newly started core sends `/e/neustart` as its first message to all stored subscribers (the 5-s deadline starts anew
for them with the restart). If a subscriber registers in a new generation (`/k/hallo`), it gets `/k/willkommen`,
then `/e/neustart`, and for each open command a state `/q/stand` (§5.1). The control station sends `/k/hallo`
immediately if no `/uhr` came for 100 ms, and then every 50 ms until `/k/willkommen` arrives.

**The page server across its own restart:** the core knows neither the FX type, nor the FX assignments, nor the owners, and the plan that brings boxes, FX
and graphs back after a core restart lives in the page server's memory. For it to survive a restart of the page server, that memory is kept in
`neustart_stand.json` in the hotcue folder (`/dev/shm/cypherdj-<i>/hotcues`, next to `aktive_loops.json`; written through a temp file and a rename, at most
every 300 ms): FX type of units 1 and 2, FX assignments 1 to 3, loop boxes with owner and live offset, graphs with owner, the `generation`, the `sample`
position of the last greeting, and a still waiting plan (`plan`, see below). At the core's first word after the start the comparison decides: the same
generation with the same or a larger `sample` position is the same core, the stand is taken over and nothing is sent; the same generation with a SMALLER
`sample` position is another core life (generation 0 starts again after every PC reboot and after the brake), the file is dropped; a higher generation
means the core restarted during the absence, the file is the snapshot for the usual plan, but only if the core restarted a short time ago: `/e/neustart`
carries the first sample of the generation (`neustart_sample_`), `/k/willkommen` the present one (`stand_sample_`), and `/e/neustart` follows
`/k/willkommen`; the plan waits for both words (in either order) and is planned only if the difference is under 30 s (1,440,000 frames), otherwise only
the owners stay adopted and nothing is sent (`kern_laenger_neu`); a lower one is a brake start without continuation, the file is
dropped. A missing or corrupt file is an empty stand. A core restart within 30 s of a restore waits for the end of that period; meanwhile the file keeps the
current stand and the still waiting plan without the parts Andreas touched in the meantime, with its due time, so a restart of the page server during the
wait triggers the same delayed, filtered restore; if its due time lies more than 5 s in the past when the page comes back, the moment is gone, the plan is
dropped (`ueberfaellig`) and only the owners stay adopted. Only the 500 ms before an accepted restore are not written; after it the file is written at once,
without the 300 ms coalescing, and `stoppe()` writes once more directly before the core client stops. `/k/set/neu` sets `sample_` and `generation_` to 0 within
the same core run (`core.cpp:136-137`): the page server then takes that for another core life or a lower generation and drops the file; the consequence is only loss. The file carries its write time (`geschrieben`, epoch in ms) and is dropped on reading if it was written before the system boot (`vor_systemstart`) or has no time (`ohne_zeit`), because the core state in `/dev/shm` survives neither a PC reboot nor `djk-stop`, and `djk-stop` deletes the file together with it.

**The page server reopens the last project after its own restart:** `offenes_projekt.json` in the same hotcue folder (next to `neustart_stand.json`; same temp
file and rename) holds `{"v": 1, "slug": "<slug>"}` of the open project. It is written at every successful open (`/proj/oeffnen`, `/proj/neu`, `/live/oeffnen`)
and removed by a close on purpose (`POST /proj/schliessen`, `{slug}` or `{slug: null}` when nothing was open); stopping the server does not touch it, and
`djk-stop` removes only `neustart_stand.json`, so the project also comes back after a full studio restart. On start, as soon as the kern client is
`verbunden` (at most 15 s, `wiederOeffnenFristMs`), and only if no project was opened meanwhile, the server calls the code of `POST /proj/oeffnen` once with the source
`andreas`. It never sends a transport start: a kern that kept playing stays as it is (restart case of §6.21), a stopped one stays stopped. Anything that is not exactly
this file (invalid JSON, other version, a slug that is not a valid project slug) is nothing remembered. If the remembered project cannot be opened (missing, damaged,
locked, no kern in time) the server starts empty, writes one log line `{typ: 'projekt_wieder_oeffnen_fehlgeschlagen', slug, grund}` and shows the notice
`Could not reopen project <slug>` on the demo overlay line (SSE event `ansage`, also `GET /ansage`).

### 4.2 Timeline and tempo

| Address | Types | Fields | Effect, receipt |
|---|---|---|---|
| `/k/set/neu` | `,hsd` | `id`, `quelle`, `start_bpm` | new timeline: beat 0 at the next cycle, map constant `start_bpm`, `generation` = 0. Rejected (`deck_laeuft`) while a deck runs; sounding loop boxes fade out over 144 frames (audit F15) |
| `/k/tempo/rampe` | `,hsddd` | `id`, `quelle`, `ab_beat`, `ziel_bpm` (60 to 200), `dauer_beats` (≥ 1.0) | ramp linear in time from `ab_beat`, starting from the tempo valid at that point. Too late: starts at the next cycle, end beat unchanged, reported `verspaetet_ausgefuehrt`. Map full: `abgelehnt`, reason `karte_voll` |
| `/k/storno` | `,hsh` | `id`, `quelle`, `ziel_id` | withdraws a not yet started command from the same source; receipt for `ziel_id`: `storniert`, for the storno itself `angenommen` and `gestartet`, no `fertig` (Andreas 2026-09-25) |

Andreas' tempo control acts via MIDI as the hand segment (§7).

### 4.3 Plan parts (controls)

`/k/teil ,hssisddfiiss`

| No. | Field | Type | Meaning |
|---|---|---|---|
| 1 | `id` | h | command ID |
| 2 | `quelle` | s | sender (`cypher`, `andreas`, `leitstand`) |
| 3 | `plan` | s | plan ID or `""` |
| 4 | `teil` | i | number in the plan (0 …) |
| 5 | `pfad` | s | control path (§1.5) |
| 6 | `ab_beat` | d | start |
| 7 | `dauer_beats` | d | 0 = set (with the control's switching ramp), > 0 = ramp |
| 8 | `nach` | f | target value in the control's unit |
| 9 | `form` | i | 0 = linear in the unit, 1 = S-curve `u ↦ 3u² − 2u³` |
| 10 | `politik` | i | 0 `musik` or 1 `zustand` (2 is not allowed here) |
| 11 | `gruppe` | s | coupling group or `""`; all parts of a plan with the same group fall together, **also on a rejection at the start**: the remaining waiting parts of the group are `abgebrochen` with the reason of the rejected part (Andreas 2026-09-25, reading b) |
| 12 | `hoerschein` | s | `hs_id` or `""`; required if the part opens a closed channel (I3a, §1.6 `offen`) |

Semantics: at the target sample the core reads the **actual value** `w0` (when the same control is set at the same
sample: its target value) and runs `wert(beat) = w0 + (nach − w0)·f((beat − ab_beat)/dauer_beats)` per sample
(beat time: a later tempo change stretches the ramp in seconds as well). Holder during the part: `plan:<plan>` (for
empty `plan`: `quelle`). Receipts: `angenommen` (in the ring), `gestartet`, `fertig`, or `abgelehnt`/`abgebrochen`
with reason. A grab cancels waiting and running parts of the grabbed control **immediately at the grab** (receipt 7
`hand`, ADR 023 decision 2; Andreas 2026-09-25, reading e); `regler_beim_menschen` (status 6) only affects parts
that want to start while the holder is already `mensch`. Checks at the start: holder (`regler_beim_menschen`),
overlap (I4), invariants I1 to I3 (§17), `nur_hand`, `ki_gestoppt`. The control station submits a suggestion that
Andreas has accepted with source `cypher` (the stop button still acts on it).

`/k/abbruch ,hsss`: `id`, `quelle`, `plan`, `teile` (`"*"` for all or `"0,2,5"`). Running parts hold at the actual
value, waiting ones drop (including deck parts, §4.4); receipt per part `abgebrochen`, reason `abbruch`.

`/k/hand/frei ,hss`: `id`, `quelle`, `pfade` (comma list of regulator paths; an entry ending in `/` is a prefix, `spur/` meaning every regulator below it; `*` means every regulator). Releases the human hand holder (§7.3 point 4) on the named regulators at once: every regulator whose holder is `mensch` becomes `frei` (`/e/halter`, `/e/regler`), so the next `/k/teil` is not refused with `regler_beim_menschen`. Other holders (plan, source) and regulators without a holder stay as they are; open parts are not touched. A project switch (open, new) by Andreas himself sends it first, because a switch is a fresh start (Andreas, 2026-11-02); the server never sends it for Cypher or after a core restart (D9). The list also drops the named regulators from the holders a restarted core is about to restore. `/q` 1 and 3; 6 with `nur_andreas` (any `quelle` but `andreas`) or `ausserhalb_bereich` (unknown `quelle`).

### 4.4 Decks

All deck commands: source `cypher` is rejected (`deck_beruehrt`) if Andreas has grabbed a transport button of this
deck within the last 32 beats (deck holder, §7.3).

**Deck parts** (`start`, `stopp`, `loop`, `roll`, `sprung`, `hotcue`) carry the same plan fields as `/k/teil` after
`quelle`: `s plan` (`""` without plan), `s gruppe` (`""` without coupling), `s hoerschein` (`""`, a `hs_id` or
`annahme:<vorschlag_id>`). This way they fall together with their group (hand grab, invariant, `/k/abbruch`), and I2
and I3 check them (§17). `annahme:<vorschlag_id>` is set only by the control station, and only after Andreas has
accepted this suggestion by key; the core writes it into the journal and thereby lets I3d pass.

**Stems:** `/k/deck/laden` with `mit_stems = 1` fades in the four stems of the version, and **the stem sum sounds**
(the base file is then not loaded); with `mit_stems = 0` the base file sounds, and parts on `stem/*` are rejected with
`keine_stems`. Switching happens only on load, never during play (Demucs stems do not sum to the bit-identical mix).
`mit_stems` must match the version (`fassung.json` `analyse_quelle`, §13.1), otherwise `abgelehnt`, reason
`pruefung`; this way the reference envelope and cross energies always come from what sounds. Memory per deck: base
file or four stems, never both (3 minutes: about 69 MB or 276 MB, computed as in ADR 015).

**Listening path** (ADR 020): a deck plays **directly** (without stretcher) as long as `|bpm/basis_bpm − 1| < 10⁻⁶`;
otherwise the warm shadow stretcher takes over with a 20-ms cosine fade before the first deviating sample. **Since
wave 3 (ADR 028)** the **varispeed** replaces the stretcher: if the tempo deviates, the deck reads at the beat of the
core map (source beat = master beat, Catmull-Rom, pitch drifts by 12·log2(bpm/basis_bpm) semitones); start and
`/k/tempo/rampe` are accepted at any tempo. Pitch-true it becomes via `/k/deck/basis_tausch` onto a version in the
new tempo. `vorlauf_ms` in `/zustand/deck` says how early deck commands must arrive.

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/deck/laden` | `,hsisdii` | `id`, `quelle`, `deck` (1 to 4), `material_id`, `basis_bpm`, `fassung` (r ≥ 1), `mit_stems` (0/1) | only if the deck is not running at the same time and is open (otherwise `deck_hoerbar`; a standing deck loads even with the fader open, 2026-09-27). Loader fades in `/dev/shm/cypherdj/material/<id>/fassungen/<bpm·1000>_r<fassung>/` (`basis.f32` or the four stems, see above), checks against `fassung.json` (§13.2), hands the pointer into the callback; `deck/<n>/fader` → −200, `pfl` → 0, `trim` per §1.5; receipt `gestartet` at the swap, `fertig`; event `/e/geladen`. Errors: `abgelehnt`, reason `material_fehlt` \| `pruefung` \| `budget_speicher` |
| `/k/deck/entladen` | `,hsi` | `id`, `quelle`, `deck` | only if not running at the same time and open (2026-09-27); releases memory after return from the callback |
| `/k/deck/start` | `,hssssiddi` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `quell_beat`, `politik` | at `ab_beat` `quell_beat` sounds (128-frame fade if the deck already runs; from standstill 48 frames fade-in, audit F10); the deck then follows the tempo map (factor = `bpm / basis_bpm`) |
| `/k/deck/stopp` | `,hssssidi` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `politik` | stop with a 10-ms ramp. A stop from a plan waits as long as it would hit the last audible channel (I2). Only an **executed** stop with source `andreas` (or the play button) disables the deadline guard for this material |
| `/k/deck/loop` | `,hssssiddid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `laenge_beats` (1/32 to 128; 0 = loop off), `politik`, `raster_beats` | loop from the source position at `ab_beat` (tape, 128-frame fade at the seam) |
| `/k/deck/loop_laenge` | `,hssssidddid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `start_beat` (source beat of the loop start, which stays), `laenge_beats` (1/32 to 128, no 0), `politik`, `raster_beats` | loop with **fixed start** and new length (Traktor: change loop length while the loop runs, 2026-10-21). Unlike `/k/deck/loop`, the core does not place the loop at the head position but at `start_beat`; the head stays where it is. If it then lies beyond the new end (shortening), the loop's seam rule wraps it back (`start + (pos − start) mod länge`, 128-frame fade, same path as every pass); before the start it runs to the end and then wraps. Outside the material (`start_beat` + longest pass) or `start_beat` not finite: receipt 6 `ausserhalb_bereich`, the old loop stays. New address, version remains 1 |
| `/k/deck/roll` | `,hssssiddiid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `laenge_beats` (0 = off), `art` (0 tape with shadow, 1 buffer behind the keylock from slice 5), `politik`, `raster_beats` | on release the deck returns to the shadow position |
| `/k/deck/sprung` | `,hssssiddid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `delta_beats`, `politik`, `raster_beats` | beat jump; in an active loop it shifts the loop by `delta_beats`. Source `cypher` on an open deck: I3d |
| `/k/deck/hotcue` | `,hssssidiid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `nr` (1 to 8), `politik`, `raster_beats` | if the deck runs, phase-true: `ziel = hc + wrap(phase(p) − phase(hc))` with `p` = source position at `ab_beat`; if standing, exactly `hc` (2026-09-28); `phase(x) = x − floor(x)`, `wrap` to [−0.5; 0.5). Example: `p` = 37,30, `hc` = 64.00 → target 64.30. Source `cypher` on an open deck: I3d |
| `/k/deck/hotcue_setzen` | `,hsiid` | `id`, `quelle`, `deck`, `nr`, `quell_beat` (NaN = delete) | event `/e/hotcue`; the control station writes it into `korrekturen.jsonl` |
| `/k/deck/scrub` | `,hsiid` | `id`, `quelle`, `deck`, `phase` (0 release, 1 grab, 2 drag), `delta_beats` (distance of the hand since the grab, in source beats) | audible scrubbing (2026-10-17): immediately at the start of the block, **without receipt** (stream up to about 60 Hz, the page throttles). The deck reads the material at the hand position (rate and direction follow the hand, standstill is silence, raw without keylock). Standing deck: the hand sets the position, after `phase` 0 the head stays there and the deck stands. Running deck: the target keeps moving with the tempo, the hand pushes it nudge-style; after `phase` 0 the deck continues running offset by `delta_beats` (same place as `/k/deck/sprung` with policy 1 and the same distance). 128-frame fades between deck path and scrubbing, rate at most 8-fold. With an active loop no effect. `/k/deck/start`, `/sprung`, `/hotcue`, `/loop`, grid, load end the scrubbing. State: `/zustand/deck` shows the scrub position for a standing deck. Source `cypher` on an open deck: I3d as for jump |
| `/k/deck/raster` | `,hsisdii` | `id`, `quelle`, `deck`, `material_id`, `basis_bpm`, `fassung`, `versatz_frames` (−192 000 to 192 000, 4 s since grid SET) | grid adjust: the grid of the loaded version now lies `versatz_frames` frames later (bar-one line at `erster_schlag_frame + versatz_frames`); absolute, at once at the start of the block. The source beat under the head stays, the tone shifts by the change (running, with a 128-frame fade against the master; standing, as position); hotcues, loop and cue point move along. Loading sets 0. Other version loaded: `nicht_geladen`. Event `/e/raster` |
| `/k/deck/slip` | `,hsii` | `id`, `quelle`, `deck`, `an` | slip: the shadow keeps running during loop, roll, jump; when off, the deck jumps to the shadow |
| `/k/deck/basis_tausch` | `,hsidid` | `id`, `quelle`, `deck`, `basis_bpm`, `fassung`, `ab_beat` | from slice 5: swap to another version (new base or corrected grid) with a 20-ms fade; source position is recomputed (§13.1); needs the version in the working inventory; same `mit_stems` as loaded |

`raster_beats` applies only to policy 2 and is 0,25, 1, 4, 16 or 32.

### 4.5 Listening certificates (Hörscheine)

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/hoerschein` | `,hsssssddddfff` | `id`, `quelle`, `hs_id`, `kanal`, `inhalt`, `urteil` (only `ok` is sent), `bpm_messung`, `gueltig_bis_beat`, `quell_von`, `quell_bis`, `sync_ms`, `pegel_diff_db`, `lufs_kurz` | registers a listening pass (Hörschein) for I3; a known `hs_id` **replaces** the old one (renewed per bar, §14.5); at most 32 at the same time, expired ones drop out |
| `/k/hoerschein/weg` | `,hss` | `id`, `quelle`, `hs_id` | withdraws it (the analysis sends this as soon as a renewal is no longer `ok`) |

`inhalt` binds the listening pass to what sounds: deck `<material_id>/<bpm·1000>_r<fassung>` (for example
`3fa1c09b2e7d4410/128000_r1`), pad `<material_id>/<bpm·1000>_r<fassung>/s<schuss_nr>`, generator `muster/<m>`.
`quell_von`/`quell_bis`: source beat range that the measurement saw without interruption (NaN for pad and generator);
after a jump in the deck it starts again.

### 4.6 Single shots (Einzelschüsse)

`/k/schuss ,hsdsiiifi`: `id`, `quelle`, `ab_beat`, `material_id`, `fassung`, `schuss_nr`, `pad` (1 or 2), `pegel_db`,
`politik`. Plays `fassungen/<bpm·1000>_r<fassung>/schuesse/<nr>.f32` on the pad channel. If the pad is **open**, a shot
with a source other than `andreas` needs a valid listening pass of the pad with exactly this shot as `inhalt`,
otherwise `abgelehnt`, reason `kein_hoerschein` (I3b). Pre-listening a shot: play it once with the pad closed (tool
`vorhoeren` with `pad`, §10); every measured playback renews the listening pass.

### 4.7 AI, LEDs, box (Kiste), configuration

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/ki/stopp` | `,hs` | `id`, `quelle` | like the stop key: all parts with source `cypher` are aborted (reason `ki_stopp`; a running part holds at its actual value), no fader is lowered (decision E-a, 2026-10-20; before: the channels of the AI track were ramped to −200 over 4 beats) and no running arrangement transport is ended (one started by `cypher` also keeps running, §4.11; before, it ended); still ended are an arrangement start by `cypher` that is waiting (receipt 7 `ki_stopp`), its freeze (§4.11), and waiting deck commands from `cypher` (§4.4, receipt 7 `ki_stopp`); further `cypher` commands are rejected with `abgelehnt` (`ki_gestoppt`) until `/k/ki/frei`; exception `/k/arr/stopp` and `/k/rec/stopp` (stopping is the safe direction, D1 6.27, §4.11, §4.12). Order of checks for `/k/arr/*`: first the source, then the AI stop, then the range of the values; a `cypher` arrangement command with invalid values therefore ends at the AI stop with `ki_gestoppt`, not with `ausserhalb_bereich` (core and mock the same, case `djk/contract/cases/arr_ki_stopp.json`). Outside `/k/arr/*` (e.g. `/k/fx/routing`, `/k/fx`, `/k/loop/*`) the core still checks source and range together: an invalid `cypher` command ends there in the core with `ausserhalb_bereich`, in the mock with `ki_gestoppt` (measured in the K1 re-review 2, known limit). The core's network knows the stop from the last `/e/ki`; until that event has arrived in the network, it still rejects range errors with `ausserhalb_bereich`, and valid commands are then rejected by the core with `ki_gestoppt` |
| `/k/ki/frei` | `,hs` | `id`, `quelle` (only `andreas`) | lifts the stop |
| `/k/ki/spur` | `,hss` | `id`, `quelle`, `kanaele` (comma-separated list, e.g. `deck/3,deck/4,erz/1`) | channels of the AI track. Tracks of the arrangement (§1.5) have been in no mask since E3: of the track entries only `spur/0` applies (no track, S2 only sends that); `spur/1`, `spur/135`, `spur/10` and any other value are rejected like an unknown channel (receipt 6 `unbekannter_regler`, the list stays unchanged). `spur/0` alone leaves the channel list as it is, an empty list clears it. No effect on the AI stop since E-a. The restart state only carries the channel list |
| `/k/ki/stufe` | `,hsi` | `id`, `quelle`, `stufe` (0 to 3) | only for the LEDs; the level itself is enforced by the control room (Leitstand) |
| `/k/vorschlag_kanal` | `,hss` | `id`, `quelle`, `kanal` (`""` = none) | channel that the button "Listen to Cypher" puts on Andreas' PFL |
| `/k/led` | `,hssi` | `id`, `quelle`, `name` (§7.4), `zustand` (0 off, 1 on, 2 blinks, 3 blinks fast) | LED on the controller |
| `/k/kiste` | `,hs` | `id`, `quelle` | core rereads `/dev/shm/cypherdj/kiste.json` |
| `/k/mapping` | `,hss` | `id`, `quelle`, `geraet` | core rereads the controller mapping (non-real-time thread); `geraet` `lernen` loads the learn table of `midi_ein_1` (slot 1), `lernen-2` to `lernen-8` those of `midi_ein_2` to `_8` (slots 2 to 8), each applies only to its input (§7.2) |
| `/k/lernen` | `,hsi` | `id`, `quelle`, `an` (1 arm, 0 disarm) | MIDI learn: the next CC on any `midi_ein_1` to `_8` is reported as /e/gelernt and not applied; 20 s, then disarmed silently; only Andreas' hand (cypher: nur_hand) |
| `/k/live/tasten` | `,hsi` | `id`, `quelle`, `strom` (0 none, 2, 3, 5, 6, 7, 9 or 10) | Sets the instrument stream that plays the keys of all `midi_ein_1` to `_8` places: a `bk:` stream plays the key through its graph instance, a host stream (`midi:<port>:<ch>`) as note on/off on `midi_aus_*`, with the velocity of the key. 0 (the state after start) means no live channel, the keys go only to the armed tracks as before; armed project tracks get the keys unchanged either way. Held keys close at a target change, at a change of the target or graph of the stream and when a `midi_ein` port is lost (a MIDI stream gets per-note offs on the port and channel the keys were played on, no CC 123; if the MIDI buffer is full the rest follows in the next cycle). A regular core stop sends no offs of its own: the all-off table (F06) of the host ports runs only after a port was reconnected, not at shutdown. Known limits: two keyboards holding the same pitch share one held bit (the first release ends the note); a lost `midi_ein` port closes the keys of all keyboards; with a graph the key starts at the beginning of the next block (up to one block, 256 samples, late); a note that the learn table of its place maps is a button and does not play the stream (armed project tracks still get it). A key and a pattern note of the same pitch on one stream do not cut each other. Streams 1, 4 and 8 and anything outside 0..10 are refused with `ausserhalb_bereich`; only Andreas' hand (cypher: nur_hand) |
| `/k/latenz` | `,hssi` | `id`, `quelle`, `ziel` (`erz/<m>` or `fx/<n>`), `samples` | measured return-path latency of a host; the core sends events to this target `samples` plus one cycle earlier |

### 4.8 Generators (Erzeuger)

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/erz/strom` | `,hsiss` | `id`, `quelle`, `strom` (1 to 16), `ziel` (`midi:<p>:<c>` with port 1 to 4 and channel 1 to 16, `pad:<n>`, or `kit:<name>` per ADR 024), `kanal` (core channel the sound returns on: `erz/<m>` or `pad/<n>`) | sets the target of a stream; the core needs `kanal` for I3c. `ziel` `bk:<name>` loads an instrument graph (S3a); `bk:` with an empty name takes it off again: the net thread replays the last accepted `kit:`/`midi:` target of that stream, on the stored `kanal` (not the incoming one), with the incoming `id`/`quelle`. Graph targets are never stored. With nothing stored it is refused as before (`ausserhalb_bereich`, no new reason). The memory is per kern run (gone after a kern restart) |
| Bundle (timestamp 1 = "immediately") with `/erz/fenster` and n × `/erz/ev` | | | replaces a window atomically |
| `/erz/fenster` | `,iiiiddh` | `strom`, `sendung` (send number, monotonic), `modus` (66 = `'B'`), `kappe` (0 or 1, formerly `reserve`), `ab_beat`, `bis_beat`, `t_send_us` | header; as measured in `proben/06-erzeuger-muster/uhr` |
| `/erz/ev` | `,iiiiddf` | `strom`, `muster`, `ev_id`, `note` (0 to 255; from 128 on the additional kit `<b>` with `kit:<a>+<b>`; MIDI streams 0 to 127), `beat`, `dauer_beats`, `velocity` (0 to 1) | **changed compared with test 06:** `t_us` is dropped, `velocity` is new. **Tail (slice 3):** afterwards 0 to n pairs `if` (`nr`, `wert`), see below |
| `/erz/cc` | `,iiidf` | `strom`, `ev_id`, `cc`, `beat`, `wert` (0 to 1) | reserved (later) |

Semantics of "replace window": for `strom`, all **not yet played** events in `[max(ab_beat, jetzt),
bis_beat)` are discarded and the new ones are inserted; events with `beat < jetzt` are counted (`zu_spaet`), not
played. Events of a pattern for which the channel of the stream is **open**, but no valid listening pass with
`inhalt` `muster/<m>` exists, are not played and are counted as `ungehoert` (I3c): a new pattern first sounds on a
closed generator channel (measurement tap) and then comes in by plan, like a new track. Reply
`/erz/quittung ,iiiiiii`: `strom`, `sendung`, `verworfen`, `verworfen_anderes_muster`, `eingefuegt`, `zu_spaet`,
`ungehoert`. Notes go out as JACK MIDI with sample offset to the target, advanced by the registered latency (§4.7).

**`kappe` (2026-11-07, silence):** `kappe` = 1 in the head of a window means: the notes of this stream that still sound at
`max(ab_beat, jetzt)` (MIDI streams and graph streams `bk:`; a kit stream has no held notes) end there, their Off comes at this
beat instead of at the end of their `dauer_beats`. The generator sets it only in the first window of a pattern change whose
new pattern is silent (`silence`, no onset in the next 16 bars); every other pattern lets held notes ring to their end. Events of
the window from `ab_beat` on are new notes and stay untouched. A later window with `kappe` 0 whose `ab_beat` lies at or before the pending cut (silence, then a pattern with notes in the same bar) cancels the cut; the regular bar windows start behind it and leave it standing. A core without this rule reads the field like the former `reserve`
and ignores it.

**Kit (stage 1, ADR 024, 2026-09-27):** With `ziel` = `kit:<name>` (`[a-z0-9_-]{1,32}`) the core plays each event of the
stream itself as a single shot `klang[note]` from `~/.config/cypherdj/kits/<name>/kit.json` (§13 form: `schema` 1,
`klaenge` [{`note` 0 to 127, `name`, `datei` `*.f32` in the same folder, `frames`}], stereo float32 interleaved, 48 kHz,
at most 10 s per sound and 256 MiB per kit), at sample `llround(sample_at(beat))`, with `velocity` as a linear gain, into
the input of the channel `kanal` (`erz/<m>` or `pad/<n>`) before trim. A note without a sound in the kit is dropped
silently. The network loads and checks the kit; error: `/q` status 6, reason `pruefung`, text with the reason in the
protocol. `midi:` and `pad:` are not built yet (status 6, `ausserhalb_bereich`).
**Two kits in one stream (MVP 2 slice 3, 2026-09-27):** `ziel` = `kit:<a>+<b>` (exactly one `+`) loads both folders into
ONE kit, so that a pattern plays sounds from both (`s("bd rec0")`). If `<b>/kit.json` is missing entirely, only `<a>`
applies; a broken `<b>` is `pruefung`; the sounds of `<b>` sit at `128 + note` (Glanz 2.4.2, F08: battery 112
and rec 38 sounds do not fit into 128; Glanz is the name of a milestone series), and the generator maps `s` to note in the same way. `<b>` is the
kit of recordings (`rec`, check instance `rec-<i>`, in the same kit folder): `djk-loop kit <loop> [<klang>]` and
"→ STRUDEL" on the page put a loop there as sound `<klang>:0` (name `[a-z][a-z0-9_]{0,15}`, default `rec0`, `rec1` …;
no bank name from `<a>`; note = the lowest one free in the extra kit; at most 10 s). The generator sees the changed
`kit.json` before the next bar and reports the stream anew with the same `ziel`; the core reloads both kits, and
sounding voices of the old kit ring out for 240 frames (5 ms) from a copy (Glanz 2.4.1, F11); if all 32 voices are
occupied, the oldest rings out likewise (F16), before that a free one is sought.
**I3c is suspended in stage 1:** `ungehoert` is always 0, and patterns on an open channel sound (patterns come on
Andreas' call, he opens the channel himself). Window bundles stay under 1 400 bytes (§2); the generator splits a window
by encoded size into gapless sub-windows (an `/erz/ev` without tail: 60 bytes).

**Parameter tail on `/erz/ev` (slice 3, 2026-09-27):** After the seven fixed fields, `/erz/ev` may carry 0 to n pairs
`,if`: `nr` from the value list `erz_parameter` and `wert` (float32). Only values that differ from the default are sent;
an event without pairs is exactly the previous `/erz/ev`. An unknown `nr` is skipped by the core (an older core stays
playable with a newer generator). New parameters are new codes, not a new type. Today: `0` `begin`, `1` `end` (fraction
0 to 1 of the sound length, as in Strudel, default 0 and 1): the core plays the frames
`[floor(begin · frames), floor(end · frames))` of the sound; outside [0, 1] (also ±Inf) it is clamped, and an empty range
means no tone. If a value above −60 dBFS occurs at the first frame of an excerpt with begin > 0, or at the last played
frame (cut or end of file), the core fades in linearly (32 frames) or out (96 frames), at most 1/4 of the excerpt (Glanz
2.5.1, F46/F50; lengths not heard). Quiet edges and the start of the sound at begin 0 remain bit-identical. NaN for a
known parameter is a format error (`protokoll`). At most 12 pairs per `/erz/ev` (7 + 2 · 12 = 31 values, the core reads
up to 32). Format error in the bundle: `/e/protokollfehler` with `protokoll`.

**Baukasten graphs and sample files (S10).** A `bk:<name>` stream loads `<bk_ordner>/<name>.json` in the net thread. A graph may contain `sampler` nodes (`"datei": "<name>.f32"`); their files are read from the **sample root `<bk_ordner>/samples/`** at the same moment (`cypher_bk_neu_wurzel`), never in the audio callback. File format: raw 48 kHz stereo float32, interleaved; name `[A-Za-z0-9_.-]`, 5 to 64 characters, ends in `.f32`, no `..`; at most 2 880 000 frames per file (60 s; 1 440 000 until sampler A1) and 64 MiB of sample data per graph; a missing or invalid sample refuses the stream with acknowledgement 6 `pruefung` (reason on stderr). A sampler graph has no `eingang`, so as `/k/kanal/graph` insert it is refused with `kein_eingang`: it plays as an instrument stream on an erz channel. Worst case sample memory: 16 streams x 2 handles (graph switch) x 64 MiB. Since S21 `faltung` nodes read their impulse response (`"datei"`) from the same root with the same rules; an IR longer than the node's `laenge_max` (1 to 2000 ms) refuses the stream or insert with `pruefung`. `faltung` adds no latency, so it is allowed as `/k/kanal/graph` insert.

**Sampler block, slice mode (sampler A1; `djk/instruments/modular_dsp/src/sampler.rs`).** Everything in this paragraph is optional on a `sampler` node, and a graph without these keys renders bit for bit as before (the Fairlight device and its tests). `grenzen` is a named node field like `datei` and `spektren` (node values are f32 only): 2 to 65 integer frame positions, strictly rising, the first at least 0, the last at most the frames of the file, every slice at least 4 frames; slice i is `[grenzen[i], grenzen[i+1])`, so 1 to 64 slices of any length. It replaces `scheiben`, which must then be absent, it is allowed on `sampler` only, and a `makro` graph refuses it (`grenzen not supported in makros`). `noten_wahl` (0 or 1, default 0; 1 needs `schleife` 0) switches the note mode: the `hz` of the voice becomes the MIDI note `n = round(69 + 12 log2(hz / 440))` (clamped to 0 to 127), the voice plays slice `n mod 64` and reads it backwards when `n >= 64`; a note whose slice does not exist (`n mod 64` at or above the slice count) plays nothing. So note 0 to 63 plays slice 0 to 63 forward and note 64 to 127 plays the same slice reversed, exact to the sample, with nothing new in the event path. The read rate no longer follows `hz`: it is `tempo * 2^(halb / 12)`, clamped to 1/16 to 8. Three new inputs sit at the end of the input list (after `rueck`), each with a free node value of the same name: `tempo` (rate factor, default 1), `halb` (semitones, default 0) and `ausklang` (ms, default 5, clamped to 1 to 2000). In the note mode `tempo` and `halb` are latched at the trigger, `ausklang` at the fall of the gate; a hit ends at the end of its slice or, when the gate falls first, with an exponential release to -60 dB over `ausklang` ms. A voice that starts from silence has no fade-in, so the transient of a hit is not softened; the same note returns to its own voice, so a slice that is repeated while it still sounds gets the 2 ms retrigger fade. The branch rule of the graph sees `tempo`, `halb` and `ausklang` as inputs (`zweige.rs`). Spec corrections of plan A1 (named field, no ADSR, velocity, category) are listed in the spec section "Corrections from plan A1".

**Sampler block, zone mode (sample player stage 2a; `djk/instruments/modular_dsp/src/sampler.rs`).** A `sampler` node with the named field `zonen` plays a multisample instrument. `zonen` is a flat JSON number array, 12 numbers per zone, 1 to 1024 zones (so a length that is a multiple of 12, at most 12288). The numbers are doubles (frame numbers of a pack exceed what `f32` holds). Per zone, in this order: `a`, `b` (frames of the zone in the node's file, whole numbers, `a + 4 <= b <= frames`), `grund` (root as a MIDI note, fractional allowed, 0 to 127; 60.0 is 261.63 Hz), `lo`, `hi` (key range, whole 0 to 127, `lo <= hi`), `vlo`, `vhi` (velocity range, whole 1 to 127, `vlo <= vhi`), `gain` (linear, 0 to 8), `pan` (-1 to 1), `loop_a`, `loop_b`, `art`. `loop_a`, `loop_b` and `art` are described in the stage 2b paragraph below. The node field `grund` is ignored in zone mode. `zonen` is allowed on `sampler` only, it replaces `grenzen` and `scheiben` (both must be absent), and it excludes `noten_wahl` 1 and `schleife` 1; a `makro` graph refuses it (`zonen not supported in makros`). A refused table answers `Fehler::Zonen { knoten, wert, grund }` where `wert` names the zone counted from 0 and the field (`zonen[3].lo`), or just `zonen` for the table as a whole (empty, not a multiple of 12, more than 1024 zones).

A new input `vel` sits at the end of the `sampler` input list (after `ausklang`; default 1.0, also a free node value): the velocity 0 to 1 as the `note` node delivers it, read at the trigger sample. Wire it with the edge `{"von": "<note>.vel", "nach": "<sampler>.vel"}`. A node without `zonen` ignores it, and the branch rule (`zweige.rs`) sees it as an input. At a trigger the note is `round(69 + 12 log2(hz / 440))` clamped to 0 to 127 and the velocity is `round(vel * 127)` clamped to 1 to 127. The zones whose key range and velocity range both contain them are the candidates, in table order; one plays, with several the round robin counter of the node chooses candidate `counter % candidates` and counts on. The counter belongs to the node (not to a voice), advances at every trigger that has candidates only, and is reset by `zuruecksetzen` (the core resets at every transport start). No candidate: the voice plays nothing for that trigger, and a pass still running on that voice fades out over 2 ms as on any retrigger. The chosen zone plays once from `a` to `b` (one-shot, 2 ms fades, Catmull-Rom) at the read rate `hz / hz(grund of the zone)` with the clamp 1/16 to 8; its gain and pan are applied in the voice: left `gain * sqrt(2) * cos(theta)`, right `gain * sqrt(2) * sin(theta)` with `theta = (pan + 1) * pi / 4`, so pan 0 is as recorded (both sides at `gain`) and the power over the pan range is constant. The gate does not stop the sample (the envelope behind the node does). A sample value that is not finite reads as 0.

**Zone mode, stage 2b: sustain loops and release samples.** `loop_a`, `loop_b` (zone numbers 9, 10; frames of the pack, whole numbers): both 0 is no loop; otherwise `a <= loop_a`, `loop_a + 64 <= loop_b <= b`; one of them 0 and the other not is refused, and so is a loop on a zone of `art` 1. While the gate of the voice is high the read head wraps from `loop_b` to `loop_a`. The wrap is cross-faded: over the last X source frames before `loop_b` the material of the X frames before `loop_a` fades in (linear, equal gain), so the join is continuous; X = `min(loop_blende, loop_a - a, loop_b - loop_a)` frames, where `loop_blende` is a new free value of the `sampler` node in milliseconds at 48 kHz (default 20, range 0 to 500, 0 is a hard wrap; allowed in zone mode only, a refusal names the field `loop_blende`). The head is in f64 and the cross-fade is defined in source frames, so a zone read faster or slower loops the same frames. After the gate fell the head keeps looping for 10 s at most; then the loop is left (outside the cross-fade zone at once, otherwise at the wrap) and the zone plays on to `b` with the usual 2 ms end fade. While looping no end fade applies at `loop_b`. The envelope behind the node shapes the tone, as for a one-shot.

**Zone mode, stage 2c: key and velocity cross-fades, release level by hold time.** Three new free values of the `sampler` node, zone mode only (a refusal names the field; outside zone mode they are refused like `loop_blende`), all 0 = off, and with all three 0 every graph renders bit for bit as before. `taste_blende` (0 to 24 keys) and `vel_blende` (0 to 127 steps) fade the edges of the key and velocity ranges: the weight of a zone is 1 inside its range and ramps linearly over the given width, centred on each edge, so two zones that meet at an edge have weights `w` and `1 - w`; the edges of the scale (key 0 and 127, velocity 1 and 127) do not fade. The weight of a zone is the product of its key and velocity weights, its gain is `sqrt(weight)` (equal power). Zones with the same key and velocity range form a cell (the takes of round robin); the cells with a weight above 0 are the candidates, the two strongest sound (ties go to the earlier cell), and inside a cell the take is `counter % takes`; the counter advances once per trigger. The second cell plays in a second voice layer (`s2`, allocated at translation only when a cross-fade is set), summed into `l`/`r`; release samples are chosen by the plain ranges as before. `frei_halte` (0 to 60 s): the level of a release sample is multiplied by `2^(-hold / frei_halte)`, where hold is the time the gate was high after the trigger, so a short note gets the full release sample and a long one a quieter one. Not done in stage 2c: SFZ import and export.

`art` (zone number 11): 0 is played by the key, 1 is a release sample (any other value is refused). Zones of art 1 are never candidates of a trigger. A voice remembers the note and the velocity of its last trigger in zone mode (also when no zone played). At the first high-to-low gate edge after a trigger (a trigger whose gate is low from the trigger sample on starts nothing until a gate edge follows; once per trigger) the release candidates are the zones of art 1 whose key range holds that note and whose velocity range holds that velocity, in table order; with several a second round-robin counter of the node chooses (`counter % candidates`, advances only with candidates, reset by `zuruecksetzen` together with the first). The chosen zone plays once from `a` to `b` at `hz / hz(grund)` (`hz` latched at the gate fall), with its gain and pan, on two new outputs `rl`, `rr` of the `sampler` node, appended after `l`, `r` (the output list is now `l`, `r`, `rl`, `rr`; both new outputs are 0 on a node without zones or without a release). The release pass is independent of the pass on `l`/`r`; a new trigger of the voice fades a running release pass out over 2 ms. Without a release candidate nothing plays. Wire them like any output, e.g. `{"von": "smp.rl", "nach": "mix_l.b"}`. The slots of later nodes shift by two when a graph is translated, which changes no sound: the render hashes of all example graphs are unchanged.

The file `datei` of a zone node is a pack: all samples one after the other, raw 48 kHz stereo float32, interleaved, little endian (the format of every sample file). It is memory-mapped read-only (`mmap` `PROT_READ`, `MAP_PRIVATE`, `madvise(MADV_WILLNEED)`) instead of read into memory: no copy per instance, no read and no scan at load. The name rules of the other sample files apply; the file must be a regular file whose size is a multiple of 8 bytes, 8 frames at least and `MAX_PACK_FRAMEN` = 268435456 frames (2 GiB) at most, else `Fehler::Datei`. Mapped bytes do not count into the 64 MiB sample budget of a graph (`MAX_GRAPH_BYTES`), and the 60 s limit (`MAX_FRAMEN`) does not apply to a pack; both limits stay as they were for every other `sampler` and `faltung` file. A pack that is truncated while mapped can raise SIGBUS in the audio thread, so a pack is never rewritten in place (a new pack gets a new name). Known limit of stage 2a: after a reboot the first notes may read from disk inside the audio callback (streaming with a preload buffer is a later stage). The C++ core and the FFI need no change.

**Latched knobs, `rastet` (sampler A2; `uebersetzen.rs`, `reverb_ffi/src/baukasten.rs`, `cypher_bk_ffi.h`).** A `regler` node may carry `rastet` (0 or 1, default 0); all `regler` nodes of one `nr` must agree (`knobs with the same nr must agree on rastet`). The host applies a latched knob without the 20 ms glide and may set it at a sample. FFI: `cypher_bk_rastende(h)` answers the mask of the graph, bit nr-1 set for a latched knob (0 for a graph without one and for `h` null; no allocation); `cypher_bk_regler(h, nr, wert)` on a latched knob sets target and applied value at once; `cypher_bk_regler_bei(h, versatz, nr, wert)` sets the latched knob `nr` (1 to 64) to `wert` (0 to 1, clamped, NaN ignored) at sample `versatz` of the next `cypher_bk_block`, with no glide, through the event queue of the notes (same offset rule, 256 events together; at the same sample after all-off and note-off and before note-on, whatever the order of reporting). It answers 0, -1 (`h` null, `nr` outside 1 to 64, or the queue is full, counted in `verloren`) or -2 (the knob is not latched; the glide of such a knob stays as it is). A graph without `rastet` has an unchanged fingerprint. The generated slice device (§20.17) latches SPEED (k2) and PITCH (k3). The core side is in §4.11 "Per-note knob values".

**Baukasten FFI: start position of a knob.** `float cypher_bk_regler_vorgabe(const CypherBk* h, uint32_t nr)` returns the `vorgabe` (start position, 0 to 1) that the graph declares for knob `nr` (1 to 64, `REGLER`): the `vorgabe` of the first `regler` node with that `nr`, 0.5 for a knob the graph does not define or defines without `vorgabe`, and -1.0 outside 1 to 64 or for a null handle. A fresh instance starts every knob at this value (no 20 ms glide from 0.5); the playback sink reads it to fill a knob a track does not name, so a missing playback parameter means the graph's `vorgabe`, not a fixed 0.5. Read-only, no allocation, allowed in any thread.

### 4.9 Loop boxes (MVP 2, ADR 025)

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/loop/laden` | `,hsis` | `id`, `quelle`, `box` (1 or 2), `name` (`[a-z0-9_-]{1,32}`) | loads a loop from `<loop_ordner>/<name>/` into the box; a running box fades into the new loop over 960 frames at the next bar at equal loudness (same grid); with keylock at T ≠ 128 (task 7, Dehner (keylock stretcher instance) in the box) the new loop then sounds for about 115 to 135 ms in varispeed (bridge), then in keylock; a waiting loop from source `cypher` is dropped with every stop (§4.7, command or key) (audit F13) |
| `/k/loop/start` | `,hsi` | `id`, `quelle`, `box` | the box starts on the next bar one; if the first value is above −60 dBFS, it fades in over 32 frames (audit F15) |
| `/k/loop/stopp` | `,hsi` | `id`, `quelle`, `box` | the box ends on the next bar one; if it is still waiting for its entry, it stops at once; it fades the last 144 frames before the one to 0 (shorter if the stop comes later, at least 32 frames: then it ends up to 32 samples after the one); if the stop is withdrawn, it fades back in from the actual value (audit F15) |
| `/k/loop/raster` | `,hsii` | `id`, `quelle`, `box`, `versatz_frames` (greater than −`frames`, less than the `frames` of the loaded loop) | plan grid: the grid in the loop lies `versatz_frames` frames later; the box plays `(Position + versatz_frames) mod frames`; absolute, immediate. Empty box: `nicht_geladen`; absolute value ≥ `frames`: `ausserhalb_bereich` |
| `/k/loop/rec` | `,hsis` | `id`, `quelle`, `beats` (1, 2, 4, 8, 16 or 32), `name` (`[a-z0-9_-]{1,32}`) | recording of `erz/1` before trim: N = `beats` beats, starting at the next multiple of N beats, into a buffer allocated by the network |

Box 1 plays into the input of `pad/1`, box 2 into that of `pad/2` (before trim); after that the channel strip of the
channel acts (§1.6), addressed via `pad/<n>/*` like any channel. Position in the loop = ((beat mod `beats`) · 22 500 +
`versatz_frames`) mod `frames`, so it is phase-locked to the core clock. Loops are at 128 BPM: if the map deviates
(another tempo or a ramp), the box reads with the step `bpm`/128 (varispeed without pitch preservation, Catmull-Rom over
four frames, ADR 026); at exactly 128 BPM it reads integer-wise and bit-exact. Status 5 has not been reported since
2026-09-30. Loop form (§13 form, like the kit): `loop.json` with `schema` 1, `name`, `beats` (1, 2, 4, 8, 16 or 32),
`bpm` 128, `frames` = `beats` · 22 500, `datei` `loop.f32` (stereo float32 interleaved, 48 kHz), optional
`versatz_frames` (integer, absolute value less than `frames`, missing = 0; plan grid). Older loops with `takte` (1, 2, 4,
8, up to MVP 2 slice 2) are read by the core as `beats` = 4 · `takte` (listening-test recordings of 27.09.); only `beats`
is written from now on. Loop folder: default instance `~/.config/cypherdj/loops/`, check instance `<i>`
`/dev/shm/cypherdj-<i>/loops/`.
Errors as `/q` status 6: `pruefung` (file), `ausserhalb_bereich` (box, name, source, beats, tempo ramp during the recording),
`nicht_geladen` (start or stop of an empty box), `ueberlappung` (a second recording while one is running),
`ki_gestoppt` (source `cypher` while the stop key is held). Boxes, loops and a running recording are not part of the
restart state (§6.3): after `/e/neustart` both boxes are empty; a running recording is lost with the process
(network and core are one process) and no longer reports; the page ends its REC state itself.
`/k/set/neu` aborts a running recording (`/e/mitschnitt` status 1).

Recording (MVP 2, ADR 025 follow-up plan slice 2; tempo per ADR 026): `/k/loop/rec` allocates a buffer of `beats` ·
48 000 frames (reaches down to 60 BPM) (stereo float32) and starts it at the next multiple of `beats` beats (§4.2 pattern
like bar one of the boxes, only over the loop length instead of over 4 beats; so the loop in the box continues at the
same point as the pattern; at 32 beats the entry can wait up to 32 beats; at 1 beat it is the next beat). What is copied
is the input of `erz/1` **before trim**, after the generator and the test clicks, before the mixer. The frames of `beats`
beats at the tempo of the recording are copied.
A running or waiting tempo ramp at the time of `/k/loop/rec` rejects it (`ausserhalb_bereich`); if the tempo changes
before the recording ends, it aborts (`/e/mitschnitt` status 1). While writing, the network resamples to `beats` ·
22 500 frames (set base 128 BPM) and then records `aufnahme_bpm` in `loop.json`; at 128 BPM the file is bit-identical
to the buffer. Once the buffer is full, the network writes `<loop_ordner>/<name>/` (atomically via `.<name>.neu/`) and
reports `/e/mitschnitt`; if the name is already taken, status 1 without a file.

---


### 4.10 Beat FX (ORDER 2026-09-28: two units, assignment per channel instead of channel selection, three parameters per unit)

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/fx` | `,hsiidddddi` | `id`, `quelle`, `einheit` (1 FX1, 2 FX2), `art` (1 echo, 2 flanger, 3 phaser, 4 filter LFO, 5 reverb (Cypher Hall, `beats` = decay time T60), 6 delay (one repeat), 7 ping pong (L/R), 8 trans (gate), 9 roll, 10 slip roll (re-records on a `beats` change), 11 vinyl brake (`beats` = braking time), 12 spiral (time glides, pitch wanders); 5 to 12 since 2026-10-11, range from `osc.json`), `beats` (0,25, 0,5, 1, 2, 4, 8 or 16), `wet` (0 to 1, S8 FX knob 1 dry/wet), `param1` (0 to 1, S8 FX knob 2, DSP-active per type: echo/flanger feedback, phaser resonance, filter quality, reverb SIZE, delay TONE, ping pong and spiral feedback, trans DUTY; roll, slip roll, vinyl have no effect), `param2` (0 to 1, S8 FX knob 3, reserved, no DSP effect), `param3` (0 to 1, S8 FX knob 4, reserved, no DSP effect), `an` (0/1, the unit ON, S8 FX button 1) | sets the parameters of the unit; acts on every instance assigned to it (`/k/fx/zuweisung`); wet glides over 480 samples; a change of type or beats while `an` glides to 0 first and clears the state (exception: beats with roll, slip roll, vinyl, spiral: no clearing); off closes only the input for every type, and the reverb tail rings out; LFO phase = frac(beat / `beats`) |
| `/k/fx/zuweisung` | `,hsisi` | `id`, `quelle`, `einheit` (1, 2, 3), `kanal` (units 1 and 2: `deck/1` to `deck/4`, `erz/1`, `erz/2`, `erz/3`, `pad/1`, `pad/2`, `master`; unit 3: every source channel `deck/1` to `deck/4`, `erz/1` to `erz/8`, `pad/1`, `pad/2`, never `master`), `an` (0/1, assigned) | **Unit 3 (FX3) is no Beat FX:** it is an insert on the group of assigned channels. What an assigned channel adds to the master sum (after its fader and its crossfader weight, while its `ziel` is the master) enters the input of the `fx/3` bus instead of the master sum; the effect graph on `fx/3` processes it and its return joins the master sum scaled by `fx/3/rueckweg`. An idle graph equals not assigned (within float rounding); without a graph on `fx/3` the channel stays on the master path (never silent). Assigning or releasing blends over 480 samples (S-curve, like a `ziel` change); a released channel lets the graph tail ring out. Units 1 and 2: attaches `kanal` to the instance of the unit or detaches it (after the channel strip; main path after the fader; PFL dry; for `master` before `master/pegel` on the sum); several channels may hang on the same unit; a channel with both assignments runs FX1 before FX2 (serial, as on the Traktor Kontrol S8, §4.3.1: "first run through FX1, then FX2"); assigning off lets the instance run out (input closed, reverb tail rings out); assigning on lets the input glide back in |
| `/k/fx/routing` | `,hsi` | `id`, `quelle`, `routing` (0 post fader, 1 insert; otherwise receipt 6 `ausserhalb_bereich`) | switches both units and all channel strips where the beat FX sits: post fader (default, after the fader; PFL and Cypher's ear do not hear it) or insert (before the fader; PFL and the envelope ring hear it, as with Traktor FX unit routing); takes effect at the start of the next block; the switch glides wet to 0 over 480 samples, swaps the path, clears and glides back (the echo tail breaks off); source `cypher` gets receipt 6 `nur_hand` (the key belongs to Andreas' hand); master FX stays untouched; the core does not keep the request across a restart (the page server sends it again); receipts 1/2/3 |
| `/k/kanal/graph` | `,hsss` | `id`, `quelle`, `kanal` (`deck/1`..`deck/4`, or `fx/3`, `fx/4` for the send returns, S6, `master` for the DJ master sum, and since the remix targets the source channels `erz/1`..`erz/3`, `pad/1`, `pad/2` as an insert in their channel strip; list `graph_kanal`; on `erz/2`, `erz/3`, `pad/1`, `pad/2` the page server keeps one graph per channel, instrument or effect), `name` (graph `<name>.json` in the graph folder, empty = remove) | sets a building-block effect graph (node `eingang`, latency 0) as an insert into the channel strip: before the fader, after the compressor, before the beat FX insert; PFL, envelope ring and sends hear it, pre-listening (`nur_cue`) does not. Each change fades linearly over 10 ms (480 samples) from the old path to the new one. The graph computes at the tempo of the core clock (`lfo`/`delay` with `takt`). Rejection: receipt 6 `ausserhalb_bereich` (channel, name), `pruefung` (file missing, format, latency > 0), `kein_eingang` (graph without `eingang`). Any valid source; in the AI stop `cypher` gets receipt 6 `ki_gestoppt`; takes effect at the start of the next block; the core does not keep the graph across a restart; receipts 1/2/3. On `fx/3` / `fx/4` the graph is not an insert but the effect of the send bus (§1.5); other `fx/<n>` are rejected `ausserhalb_bereich` |
| `/k/graph/frage` | `,hs` | `id`, `quelle` | asks which graph sits on each graph-capable slot (`graph_platz`, §5.12). Answered in the network thread, not through the ring: one `/e/graph` per slot in list order (empty slots with `""`), then quittung 1 and 3 for this id; all to all subscribers. Any valid source; an unknown source gets quittung 6 `ausserhalb_bereich` and no `/e/graph` |

`param` acts per type: echo and flanger feedback 0 to 0,9, phaser resonance 0 to 0,9, filter LFO quality 0.7 to 8.
Receipt 1, 2, 3 at the start of the block; error `/q` status 6 `ausserhalb_bereich`. Source `cypher` itself rejects
`djk-fx` while the AUTO switch of the page is off (as with `djk-muster`).

### 4.11 Arrangement (D1, ADR 030)

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/arr/laden` | `,hsi` | `id`, `quelle`, `nr` (≥ 0, playback number of the instance, D1 6.1) | the arrangement loader thread reads `<arr_ordner>/wiedergabe-<nr>.json` (§2.1; no path in the OSC message; the key `nr` in the file must match, otherwise `format`; every clip `datei` is an absolute path below `arr_ordner`, both compared normalized, otherwise `format`: `audio/<sha256>.f32` and the freeze files `freeze-<spur>-<kennung>.f32` in the working folder itself, D1 6.14; clip values per D1 6.27: `gain_db` −96 to +24, `ein_beats` and `aus_beats` ≥ 0 and together at most `laenge_beats` + 1e-9, otherwise `format`; NaN or Inf anywhere in the audio: `format`, the whole file is checked), loads the audio (locked, shared by sha256) and swaps the snapshot at the start of a block; receipts 1 and 3. Status 6: `datei_fehlt`, `format`, `audio_fehlt`, `zu_gross`, `spur_bereich`, `warp_maschine_fehlt`, `ki_gestoppt` (source `cypher` at the stop key); status 4 `zu_spaet` if the job ring or the result ring of the loader thread is full (every id ends exactly once) |
| `/k/arr/start` | `,hsdi` | `id`, `quelle`, `start_beat` (≥ 0), `quant` (0 immediately, 1 beat, 2 bar) | entry at the earliest at the first quant point from now + lead time (2n, the host round trip) + one cycle; the bar holds (core beat − `start_beat`) ≡ 0 mod 4; a running transport ends at once with a short fade; receipt 1, receipt 2 at the entry sample. If a waiting start ends without an entry, it gets 7: `abbruch` (new start, `/k/arr/stopp`), `hand` (`arr/start_stopp`), `ki_stopp` (AI stop, a waiting start by `cypher`; a running transport has not been ended since E-a); every id ends exactly once. Status 6: `nicht_geladen`, `ki_gestoppt`, `ausserhalb_bereich` |
| `/k/arr/stopp` | `,hsi` | `id`, `quelle`, `quant` (0 immediately, 1 next project beat, 2 next project bar) | short fade (96 samples), open notes off, host slots All-Notes-Off; if the seam lies before the quant point, at the seam; if the end of a freeze, tap or export run lies before the quant point, there (the run completes with status 0, the transport ends with it); receipt 1, receipt 3 at the stop sample; a second `/k/arr/stopp` before the stop sample replaces the first, which then ends with 7 `abbruch` (every id ends exactly once); also allowed by `cypher` during the AI stop (D1 6.27) |
| `/k/arr/loop` | `,hsidd` | `id`, `quelle`, `an` (0/1), `von_beat` (≥ 0), `bis_beat` (at least `von_beat` + 1) | loop bracket: when the project beat reaches `bis_beat`, `von_beat` applies again sample-exactly (the last 96 samples before it fade out); takes effect from the next note window not yet sent; if the head is at or beyond `bis_beat` when it is set, the transport runs linearly (the bracket only takes effect once `bis_beat` is reached from below, D1 2.2); receipt 1 and 3. Status 6: `ki_gestoppt` (source `cypher` at the stop key, D1 6.27), `ausserhalb_bereich` |
| `/k/arr/metronom` | `,hsifi` | `id`, `quelle`, `an` (0/1), `pegel_db` (−60 to 0), `ziel` (0 master before the limiter, 1 cue) | click on whole project beats, accented at p mod 4 = 0 (full level, otherwise half); locked in test mode, always off in the render; receipt 1 and 3. Status 6: `ki_gestoppt` (source `cypher` at the stop key, D1 6.27), `ausserhalb_bereich` |
| `/k/arr/freeze` | `,hsiddi` | `id`, `quelle`, `spur` (1 to 32), `von_beat`, `bis_beat`, `kennung` | real-time run following the start rule from `von_beat` (the core chooses quant as for the hand target type: 2 if a deck, a loop box or a generator stream is running, otherwise 0); loop bracket suspended; the track signal before the fader goes into the file `<arr_ordner>/freeze-<spur>-<kennung>.f32` (raw f32 stereo, 48 kHz) from the entry for `bis_beat` − `von_beat` + 2 beats, then stops. Buffer and file belong to the arrangement loader thread, not to the network thread (D1 spec 6.29). The server assigns the kennung uniquely per instance (playback counter, D1 spec 6.25); an existing file is never replaced (`/e/freeze` 2). `/q` 1, 2 at the entry, 3 at the end of the tail run, 7 with `abbruch` (stop, start, load, hand key, `/k/tempo/rampe` from whatever source, D1 spec 6.33, `/k/set/neu` at sample 0 of the new time axis) or `ki_stopp` (Cypher's freeze); 6 with `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `ausserhalb_bereich` (track 1 to 32, `bis_beat` − `von_beat` 1 to 256, `kennung` ≥ 0), `datei_fehlt` (no working folder), `nicht_geladen`, `ueberlappung` (transport or freeze is running), `spur_bereich` (track empty), `tempo_rampe` (a ramp is open in the tempo plan, D1 spec 6.33), `zu_gross` (buffer cannot be allocated). A core restart ends every freeze without `/e/freeze`. Package K3 |
| `/k/arr/abgriff` | `,hsiiiddi` | `id`, `quelle`, `art` (0 track, 1 group, 2 return, 3 production master), `nr` (track 1 to 32, group 1 to 16, return 1 to 4, master 1), `punkt` (0 pre, 1 post), `von_beat`, `bis_beat`, `kennung` | Real-time tap of any strip, the sibling of `/k/arr/freeze` (the freeze is untouched): the same run (start rule of `/k/arr/start`, `quelle` and `id` mean what they mean there, loop bracket suspended, quant chosen by the kern), but the file holds the signal at ONE point of ONE strip: `pre` is the strip input in front of its chain (track: the instrument/clip signal, group: the sum of its members, return: the Hall blend, master: the sum in front of the master chain), `post` is what the strip sends on to its target (after chain, fader, pan/balance, mute/solo fade and for a track the monitor of an armed input; the master: the signal after the master fader, the export tap). The window is shifted by the path latency of the tapped point (`arr_schluessel_quelle_ankunft`, the master post `pdc.gesamt`, the master pre `pdc.p_in`) so the file starts on `von_beat` exactly like the export. Length `bis_beat` - `von_beat` exactly, no tail (the run ends `ankunft` samples after the range end). File `<arr_ordner>/abgriff-<art>-<nr>-<kennung>.f32` (raw float32 stereo, L/R interleaved, 48 kHz), written by the Arrangement load thread, never replacing an existing file (`/e/abgriff` 2). `/q` 1, 2 at the onset, 3 at the end of the run, 7 with `abbruch` (stop, start, load, hand key, `/k/tempo/rampe`, `/k/set/neu`) or `ki_stopp` (cypher's tap while waiting); 6 with `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `ausserhalb_bereich` (art 0 to 3, `nr` out of the kind's range, `punkt` 0 or 1, `bis_beat` - `von_beat` 1 to 256 else `zu_gross` above 256, `kennung` >= 0), `datei_fehlt` (no work folder), `nicht_geladen`, `ueberlappung` (transport, freeze or tap runs), `spur_bereich` (no such strip in the playback: empty track, group without member, return not present), `tempo_rampe`, `zu_gross` (range over 256 beats, buffer not allocatable). A kern restart ends every tap without `/e/abgriff`. Slice 7 (1.10) |
| `/k/arr/ins_host` | `,hsii` | `id`, `quelle`, `h` (1 to 4), `gesund` (0 or 1) | the server's health flag of effect host `h` (plan 1.11 T5, D7), the second of the two sources of the stage's health; the server sets it from the host's heartbeat file (a hung main loop clears it). The stage plays the return only while this flag AND the core's own edge check (every 500 ms: the host's JACK client and ports are there and its four edges hold) say 1; the default after core start is 0, so a host nobody has declared healthy plays the delayed dry path. Whatever happens to the health, the strip never goes silent and never jumps in time: the stage crosses to the delayed dry signal in 480 samples (D6), and the return fades back in only after 48000 samples (1 s) of continuous health. There is no stall rule in the stage: a plugin that returns exact zeros (a closed gate) stays on the return path, only the flag switches. The command is applied at once and answered by `/e/ins_host`. The server sends it with its own source `leitstand`, never `cypher`: like every `/k/arr/*` command it is refused for `cypher` in the AI stop (§4.7). `/q` 6: `ki_gestoppt` (`cypher` in the AI stop, before any range check), `ausserhalb_bereich` (`quelle` unknown, `h` outside 1 to 4, `gesund` outside 0 or 1). Plan 1.11 T5 |
| `/k/arr/ins_mess` | `,hsi` | `id`, `quelle`, `h` (1 to 4) | measures the round trip of effect host `h` (plan 1.11 T5, D17 variant B: the server orders it while the host's rack is still EMPTY, before the plugin is loaded; the empty rack's round trip is exactly 2 x quantum, 512 samples at quantum 256). Only while the transport is stopped and the host is healthy. The core sends ONE impulse of 0.5 on `arr_ins_<h>_L`, counts the samples until the return (`arr_insret_<h>_L` or `_R`) exceeds 0.05 in magnitude and gives up after 16384 samples; the measurement is a small state machine in the callback, the host's stage plays the delayed dry path meanwhile. The answer is `/e/ins_mess` (the number, or a named reason); one measurement per host at a time (a second start is `laeuft`). `/q` 6: `ki_gestoppt` and `ausserhalb_bereich` (as `/k/arr/ins_host`). Plan 1.11 T5 |
| `/k/arr/export_lauf` | `,hssdd` | `id`, `quelle`, `pfad` (absolute, ends in `.f32`), `von_beat`, `bis_beat` (at least 1 and at most 3600 beats, `zu_gross` above; the core checks the 3600 s at the project tempo exactly) | real-time export of the production master (plan 1.11 T12, D10: a project with an active effect-host stage cannot be rendered offline). One transport run from `von_beat` by the start rule with the loop bracket suspended (the run pattern of `/k/arr/freeze`, the freeze and the tap are untouched); the core copies the PM post point (after chain and PM fader, without metronome) shifted by the path latency exactly as `/k/arr/abgriff` art 3 punkt 1 does, so the file starts on `von_beat` (the run follows the master clock: the caller brings the master to the project tempo first), and streams it through a ring to a writer thread of its own that writes `pfad` (float32 L/R interleaved, never replaced). Receipts as the freeze: 1 accepted, 2 at the onset, 3 at the end, 7 on abort, 6 on refusal (`belegt` while a recording, a freeze, a tap or another export runs; `ki_gestoppt`, `tempo_rampe`, `nicht_geladen`, `zu_gross`). One run answers `/e/export_lauf` |
| `/k/arr/auto` | `,hsisi` | `id`, `quelle`, `spur` (0 to 32), `ziel` (`fader`, `pan`, `mute`, `solo`), `an` (0 or 1) | the lane override of one track field (1.12 slice 3, ADR 032 point 8). `an 0`: the hand plays instead of the lane from now on (the core first sets the Stellwerk value to the last lane value, so a click without movement keeps the lane value and the next `/k/teil` ramps from there); `an 1`: the lane plays again (re-enable, blended back); `spur 0` with `an 1` re-enables every overridden field of every track (`ziel` is checked, then ignored). The state lives in the core only and survives stop, start and a swap that keeps the lane; deleting the lane clears it. Without a lane for the field, or when the state does not change, the command is acknowledged and nothing happens. While the transport does not play, `an 0` is acknowledged and nothing changes (no override starts); `an 1` still clears the state. `/q` 1 and 3; 6, checked in this order: `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `format` (`spur` outside 0 to 32 or `an` outside 0 or 1), `auto_ziel_unbekannt` (`ziel` is none of the four), `format` (`spur 0` with `an 0`), `nur_andreas` (`an 0` from `cypher`: overriding is Andreas' hand work, cypher may only re-enable). Reports: `/e/auto` (§5.13). Automation slice 3 |
| `/k/arr/arm` | `,hsiii` | `id`, `quelle`, `spur` (0 to 32), `an` (0 or 1), `modus` (0 touch, 1 latch, 2 write) | arms one track for automation recording (1.12 slice 3, D11), one arm per track, separate from the audio arm `/k/rec/spur`. `spur 0` is allowed only with `an 0` and disarms every track. The mode is kept with the arm; the core reports grips the same way in every mode, the server writes the take. The arm lives in the server session and in the core (D11): the core uses it for the points, the server for the take. A new core generation starts unarmed and the server clears its copy when it sees the new generation; a swap of the playback keeps it. Only the source `andreas` may arm or disarm. `/q` 1 and 3; 6, checked in this order: `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `format` (`spur` outside 0 to 32, `an` outside 0 or 1, `modus` outside 0 to 2, `spur 0` with `an 1`), `nur_andreas` (any source but `andreas`). Reports: `/e/auto_punkt` (§5.13). Automation slice 3 |
| `/k/arr/note` | `,hsiii` | `id`, `quelle`, `spur` (1 to 32), `ton` (0 to 127), `vel` (0 to 127; 0 = off) | plays one note on a project track (sampler plan A1 task 7: click to hear a slice). The core calls `Arrangement::live_note` for track `spur` at the first sample of the cycle, as for a note of an armed MIDI key, but needs no arm and no running transport: the track sounds while the transport stands, as long as a playback with a sink for that track is loaded. `vel > 0` is the on, `vel 0` the off of that `ton`; a second on of a held `ton` ends the first at the new onset. The caller sends the off itself: a note without an off sounds until the off, a transport stop, a swap of the playback or a disarm of that track. No sound and no refusal when the track is empty or no playback is loaded (like a live key). `/q` 1 and 3; 6, checked in this order: `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7; the page server sends its own offs as `andreas`), `spur_bereich` (`spur` outside 1 to 32), `ausserhalb_bereich` (`ton` or `vel` outside 0 to 127). Sampler plan A1 task 7 |
| `/k/arr/stift` | `,hsiiiif` | `id`, `quelle`, `spur` (1 to 32), `satz` (0 = A, 1 = B), `zeile` (0 to 15, the source), `spalte` (0 to 15, the destination), `wert` (-1 to 1; 0 removes the pin) | sets one pin of the `matrix` block (Kraken patch field) on the instance of project track `spur`, while it sounds: a live pin that changes the weight at once, smoothed, without a rebuild. The pin is not stored by the core: the project keeps the pins (`geraet.stifte`) and every new playback snapshot carries the full pin set, which wins over an earlier live pin. No sound and no refusal when the track has no sink or its graph has no `matrix` block, or when no playback is loaded (like a live key). `/q` 1 and 3; 6, checked in this order: `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `spur_bereich` (`spur` outside 1 to 32), `ausserhalb_bereich` (`satz`, `zeile`, `spalte` or `wert` outside its range, also `wert` NaN or infinite). Kraken patch field task 1 |

**Patch field pins (Kraken patch field task 4).** A Baukasten track whose graph has a `matrix` node keeps its pins in the project device: `geraet.stifte`, a list of `[satz 0|1, zeile 0..15, spalte 0..15, wert -1..1]`, sorted by (satz, zeile, spalte), no duplicate position, no zero value, at most 512 entries (format `cypherdj-projekt/2` only, not on a rack member). An absent list means the pins of the graph file; an empty list means all zero. The playback track (`cypherdj-wiedergabe`, bk track) carries the same list as `stifte` when the project does. Commands: `geraet_stift_setzen {spur_id, satz, zeile, spalte, wert}` (one cell, live: no new playback, one replace patch of `/spuren/<id>/geraet/stifte`, one undo step per cell; sent to the core as `/k/arr/stift`; the first pin on a track without a list goes the general path and writes the graph's pins first) and `geraet_stifte_setzen {spur_id, satz?, stifte}` (a whole list, or one set with `satz`; `stifte: null` drops the own list, only without `satz`). Refusals: `spur_unbekannt`, `geraet_falsch`, `kein_steckfeld` (the graph has no `matrix` node), `argument_ungueltig`; a pin the core refuses answers 409 `stift_abgelehnt` and the project stays unchanged. Lists go to the core in packets of at most the knob packet size. After a core restart the pins reach the new core in a freshly translated playback. `GET /proj/steckfeld?spur_id=<id>`, protection `offen`, answers `{spur_id, graph, zeilen, spalten, stifte, eigene, rev}` (`eigene`: the track holds its own list); errors 409 `kein_projekt`, 404 `spur_unbekannt`, 409 `geraet_falsch`, 409 `kein_steckfeld`, 400 `argument_ungueltig` (no `spur_id`).

The arrangement module plays one playback (format `cypherdj-arr/1`, `/2` or `/3`, D1 spec 3.2, ADR 033, ADR 031) on the one
clock: project beat p = core beat − origin + `start_beat`; an event at p lies on llround(sample_at(p + origin − `start_beat`)).
Audio clips play from a fixed pool of 256 voices (8 per track slot, `ARR_STIMMEN = 8 * ARR_SPUREN`) from their entry
sample; a start in the middle of a clip begins with a 32-sample fade-in. An audio clip may carry a warp (package 1.13, only
in `cypherdj-arr/2`): `"warp": {"modus": 0, "w": [[beat, frame], …]}` (`warp` may carry `pitch`, package 1.13 slice 5,
number > 0, frequency factor of the clip, missing = 1: 0.25 to 4 (`ARR_WARP_PITCH_MIN/MAX`); with mode 0 only 1 or
missing; violation: reason `format`; the page server writes `pitch` only when it is not 1; a core without this field
ignores it, and the detuning then does not sound: core and page server must be restarted together), markers from the
clip beat of the copy and source frame (48 kHz), both columns strictly increasing, finite, frame 0 to 1.1e12, beat at
most ±1e6, 2 to 4096 markers per clip and at most 262 144 in the whole playback (violation: reason `format`; the overall
limit gives `zu_gross`; in a `/1` file `warp` is a format error). Mode 0 is RE-PITCH: the source position is not
`offset_frames + (t − entry)`, but W(b) for the project beat b = p(t) − `start_beat` of the clip (linear between two
markers, and the edge segment before and after), read with Catmull-Rom; the pitch follows the tempo, and because p comes
from the tempo map, the clip follows every ramp and later the tempo automation without its own logic. Mode 2 (COMPLEX,
Bungee with grain 512) and 3 (TONES, grain 256) compute ahead in the warp engine of the core (fixed 64 slots, worker
threads per `warp_faeden`, ring with 8 192 frames of lead; ADR 031 part 2): the core starts the voice 2 048 samples before
the entry, and the callback reads only the ring. A core without Bungee rejects 2 and 3 with `warp_maschine_fehlt`. Mode 1
(BEATS, package 1.13 slice 4) additionally carries `"e": [[beat, frame], …]` (the units: clip beat of the copy and source
frame of the unit start, both strictly increasing, frame 0 to 1.1e12, beat at most ±1e6, 1 to 32 768 per clip; they
count with the markers toward the overall limit of 262 144), `"loop": 0|1|2` (gap mode: off, `vor`, `vor_zurueck`) and
`"huelle": 0..100` (whole numbers; if any of `e`, `loop`, `huelle` is missing, it is `format`); `e`, `loop` and `huelle`
with another mode are `format`, and likewise `pitch` ≠ 1 with BEATS. The server computes the units from warp and
transients; the core computes no grid: unit i starts on the project sample of its beat (at most 1 sample later) and plays
the source at factor 1 (sample for sample, without interpolation) from its frame; if its slot is shorter than the source,
it fades out over the last 96 samples, without fade-in; afterwards (`loop` 0) silence, (1) the second half repeats with a
96-sample triangular crossfade at the turn, (2) backwards to the middle and forwards again; `huelle` < 100 lets the gain
fall linearly to 0 over `max(96, slot · huelle / 100)` samples. The last unit has no slot edge (it plays to the end of the
clip), and `huelle` and the shortening do not act on it; this is a decision of the core (plan code `platz` infinite),
not part of D5. The core computes the start and slot of each unit from the tempo map in whole samples: unit i starts at
the first sample s with beat_at(s) ≥ the clip beat of the unit (inverse of `sample_at`, rounded up with 1e-6 samples
tolerance), its slot reaches to the start of the next one, and the source position is `e_frame + (s − start)`. This holds
at every tempo, also in a ramp or with a step in the middle of the unit (the source keeps running sample for sample, no
jump back), at every sub-block length and at large sample positions; live and render hear the same thing. Any mode other
than 0 to 3 is `format`. If the engine lacks a slot, the clip plays as RE-PITCH and `/zustand/warp` counts `kein_platz`.
When the server writes `/2` is described below under "Playback `cypherdj-arr/2`". The null test
(D1 A7) holds with warp at a residual below −90 dBFS; measured −145 dB, not −200: the beat calculation of the warp depends
on the absolute core sample (state `stand/produktion-warp.md`). Notes go to sinks, each earlier by the lead time of the
sink and across the loop bracket (D1 K2b): internal tracks to the RB-338 in the core (lead time 0, one instance per track
slot; at transport start in the block of the entry: defaults, the parameters of the playback, reset and All-Off at the
entry, then the notes; if the entry lies in the next block, the sink fades the output of the track linearly to 0 in this
block (short fade, no jump at the cut on restart; limit: "the next block" has the same size as this one, as in the live
core with equally sized `MIX_BLOCK` sub-blocks and a fixed quantum (`node.lock-quantum`), and in the render with a fixed
quantum; if the quantum rises between command and entry, the fade drops out and the cut is hard); a swap with other
parameters resets it smoothly; if a sounding track leaves the RB-338 through a swap (empty, host track), it fades out over
one block and is reset; with the transport stopped, a track rests after 1 s of exact silence), host tracks to
`arr_midi_<slot>` (§7.1; channel 1, lead 2n (the round trip core -> host -> core) like the MIDI streams, stop and restart with CC 123, likewise a
swap after which no track plays the slot any more; its return path then fades out over one block); its return path
`arr_rueck_<slot>_L/R` (§8) goes into the input of the first track that plays the slot. Open notes are held in a list of
fixed size (1024, 32 per track slot, `ARR_OFFEN = 32 * ARR_SPUREN`); when a snapshot is swapped, the note-off of a note
that is missing or has another end goes out at once; a changed clip fades out and enters again at the new point. The sum
of the tracks (track control `spur/<n>/*`, §1.5) goes into the input of `erz/4`. `erz/4` is reserved for production:
`/erz/strom` with target `erz/4` and edges on `rueck_erz_4` is rejected by the core with reason `reserviert`, and the
return path `rueck_erz_4` does not sound. Memory: the audio counts against `speicher_budget_mib` (one account shared with
the deck loader) and against `arr_budget_mib` (§2.1); shared audio is locked only once. The snapshot itself (head, clips,
notes, note index) also lies in its own pages, locked and booked to the account (the core locks only `MCL_CURRENT` at
start); likewise the head of each audio (pointer and length, which the callback reads per sample; one page per audio, on
the account, not in `arr_budget_mib`). The arrangement is not part of the restart state (§6.3), the track controls are;
after `/e/neustart` the page server reloads the last playback. If the return of a replaced snapshot finds no room in the
event ring, it waits in a place of its own; meanwhile the `/k/arr/*` commands wait in their order (at most 16); one more
ends with 4 `zu_spaet`, nothing overtakes. Lost items are counted in `ereignisse_verloren` (§5.4). Known limit (K1 re-review 4):
if the core rejects a `/k/arr/laden` while the waiting buffer is full, and the own place is already taken, the return of
that snapshot is lost (counted in `ereignisse_verloren`). It then stays locked with its audio until the core restarts and
stays booked to the account: a lasting load on `speicher_budget_mib` and `arr_budget_mib`, which only a core restart gives back.

Known limit (K1-Review 11): the core maps audio with `MAP_SHARED` (shared by sha256, without a copy). If a mapped file
were shortened or overwritten in place, reading in the callback would trigger `SIGBUS` or play foreign data. Therefore
every writer in the working folder follows this rule: audio is created in a partial file and only gets its name via
`rename` (`audio/<sha256>.f32`, one name means one content; a `rename` over an existing file leaves the mapped old inode
untouched), never by shortening or overwriting; freeze files are created with `RENAME_NOREPLACE` (D1 6.25). A file is
deleted only via `unlink`, which the mapping also survives.

**Playback `cypherdj-arr/2` (1.10, ADR 033; warp: package 1.13, ADR 031).** The loader accepts format `cypherdj-arr/1`,
`cypherdj-arr/2` or `cypherdj-arr/3` (`/3` = `/2` plus `returns[].auto`, see below). Only in `/2` are there `spuren[].ausgang`, the list `gruppen` and `clips[].warp` (above); the core
rejects each of these fields in a `/1` file with `format`. An entry of `gruppen` has `nr` (1 to 16, each number at most
once; a duplicate number is `format`) and `ausgang`; the `ausgang` of a group has the `art` `master` or the `art` `gruppe` with `nr` (ADR 036: groups nest; the parent `nr` must be in `gruppen`, 1 to 16, not the group itself; a cycle, a self reference or a missing parent is `format`).
The `ausgang` of a track has the `art` `master` (also the default when the field is missing) or the `art` `gruppe` with
`nr`; this `nr` must appear in `gruppen`; any other `art` is `format`.
**DJ-channel output of a group (ADR 037; `cypherdj-arr/2` only).** The head of the playback may carry `"live": true` (boolean, absent = false; anything else is `format`); the page server writes it only for a live project. The `ausgang` of a group may then have the `art` `dj` with `nr` 1 to 6 (1 to 2 since ADR 037, 3 to 6 since ADR 038): the group leads into a DJ channel instead of the production master. `nr` 1 and 2 are `pad/1` and `pad/2` (slot A, slot B), `nr` 3 to 6 are `deck/1` to `deck/4` (a SEQ deck in place N has `nr` N + 2). Refused with `format`: `dj` without `live: true` in the head, `nr` outside 1 to 6, and two groups with the same `nr`. A nested group has the output `gruppe`, so `dj` is possible on a top group only; a track keeps `master` or `gruppe`. In the live kernel the arrangement exit hands a stereo pair per DJ channel (six), and the kernel adds it into the channel input of its channel (`pad/1`, `pad/2`, `deck/1` to `deck/4`) after the loop boxes, the streams and the decks (a deck playing on `deck/N` and a group on `nr` N + 2 sum) and in front of the strip (trim, EQ, kill, filter, fader); the production master tap carries only what still goes to the master. The DJ output runs through neither the PM chain nor the PM delay place (a module carries no sends and no inserts). A DJ channel without a pair (a caller that hands none) sends the group to the master. A group that loses its DJ output in a playback swap keeps the channel for 960 samples, so that the fade of its tracks does not reach the master. `cypherdj-render` treats a DJ output as `master` (offline switch set before block 0): export, loudness, merge, bounce and the level offset see the module like a master group. A playback without `live` and without a DJ output is byte for byte the same file as before; an older core refuses `dj` with `format`, so core and render program are started together. No OSC address and no new reason; version stays 1.
**Baukasten instrument tracks in the playback (S20).** An `intern` track may carry `"geraet": "bk"` (instead of `"rb338"`) with `"graph": "<name>"` (1 to 32 characters of `[a-z0-9_-]`) and `"parameter": {"k1": v, …, "k64": v}` (0 to 1; any other key is `format`; a knob the playback does not name starts at the start position the graph gives it (`vorgabe`), 0.5 for a graph without one). The graph is the Baukasten file `<name>.json` in the graph folder, `$HOME/.config/cypherdj/baukasten` for the live kern (the kern has no override) and `--bk-ordner <dir>` of `cypherdj-render` (default: `$CYPHERDJ_BK_ORDNER`, else the same home folder). The loader builds the graph in the loader thread, never in the callback; a missing or invalid graph refuses the whole playback with `format`, more than 16 bk tracks with `zu_gross` (ARR_BK_MAX, 8 until 2026-11-18), `graph` on a `rb338` track is `format`. Tracks with the same graph name share nothing: one instance per track slot; an unchanged track (same slot, graph, file content hash) keeps its running instance across a playback swap. Playing: the notes of the track go to the instance as note-on/off with sample offsets; the knobs k1 to k64 are set every block (no 20 ms ramp at take-over and at the transport start, so live and render begin on the same values); the instance is reset at every transport start (same rule as the RB-338) and runs on the kern clock (`takt` with beat and beats per sample, so `lfo`/`delay` follow the tempo map). A device change on a slot (rb338, bk, another graph, empty) fades the old instance out over one block and resets it. The track rests after 1 s of exact silence while the transport stands. The latency of the graph (`cypher_bk_latenz`, e.g. 69 samples for a `falter` with `ueber` 1, 95 for a `limiter`) joins the latency of its strip in the delay compensation as if it were a stage at the head of the insert chain (`ArrSpur::bk_latenz`, `arr_pdc_rechnen`): every other strip is delayed to match, the export skips the common delay, and a graph without latency leaves the project bit for bit as before; a graph above 4096 samples is refused with `format` and a message that names the limit (`test_arr_bk_latenz`). The offline render (`proj_export`, `proj_lautheit`, `proj_zusammenfuehren`) plays bk tracks through the same sink; live against render is `bestanden` in `cypherdj-nulltest` (stand `stand/baukasten-s20.md`). A bk track is not a Surge track: `/k/arr/freeze` on it is refused by the page (`keine_wirtspur`). No new OSC address and no new reason.

**Per-note knob values (sampler A2, E8; `cypherdj-arr/2`, bk tracks).** When the graph of a bk track has latched knobs (`rastet`, §4.8; the loader reads the mask with `cypher_bk_rastende` beside the instance into `ArrSpur::bk_rastet`), a device lane on such a knob (`auto` target `geraet.k1` to `geraet.k64`, or a clip envelope on it) is not read once per block but at every note-on: the core evaluates the lane at the project beat of that note (`arr_geraet_lane_wert` in `arr_notes.cpp`) and gives the value to the sink (`Arrangement::note_regler`) right before `note()` of the same note; the sink reports it to the instance with `cypher_bk_regler_bei` at the sample of the note-on. So a hit takes the value of its own step and not the value at the end of its block (a hit cut has several hits in one block). An absolute lane gives the final value; a relative lane is a summand to the track's knob, and a live override `spur/<s>/bk/<k>` wins over that knob while the summand drops (the rule of the block path); an absolute lane beats the override. The per-note values enter the instance queue after all note events of the block, so a surplus costs knob values and never notes (counted in `verloren`). A live note (`/k/arr/note`, an armed key) takes no per-note value; a track without a latched knob or without lanes pays nothing, and a graph without `rastet` plays bit for bit as before. No new OSC address and no new reason (`test_arr_bk_rastet`).

**Returns in the playback (1.10 Slice 3).** An optional `returns` list in `cypherdj-arr/2`: entries `{nr, ausgang}`, `nr` 1 to 4 at most once, `ausgang` has the `art` `master` and no other (returns do not feed returns or groups); a list in a `/1` file, a duplicate `nr` or another `art` is `format`. The core needs only which returns exist; the sends and the return strips are controls (§1.5), not data. The page server writes `/2` also when the project has a return and then always writes `returns`. A project without a return gives the same file as before.

**Insert chains in the playback (1.10 slice 4a).** In `cypherdj-arr/2` a track, a group or a return may carry `chain`, a list of at most 4 stages in signal order, each with the fields `art`, `slot` and `an`: `art` is `komp`, `eq`, `saett`, `lim`, `utility`, `bk` or `host` (slice 4b adds `eq` and `saett`, the master limiter plan of 2026-11-06 adds `lim`, plan 1.11 adds `host`, arr-fx adds `utility`, arr-bk adds `bk`; any other is `format`), `slot` is the project's pool slot of that kind (the control rows `ins/<art>/<slot>/*`, §1.5: 1 to 12 for `komp`, 1 to the pool size of the kind for `eq` and `saett`; a slot may stand on one strip only, a second use or a slot outside the pool of its kind is `format`; the three kinds number their slots independently, so `komp` slot 1, `eq` slot 1 and `saett` slot 1 are three different stages), `an` is the structural flag. The chain of the production master is the top-level key `pm`, an object that holds `chain` (not `master`; the loader ignores unknown top-level keys without a message, so a misspelt key is a stage that never sounds). A return may carry `"pre": true`: its sends then tap the sending strip's chain output times the mute/solo fade, before fader and pan (default: after). `chain`, `pre` and `pm` in a `/1` file, a chain longer than 4 or a non-object `pm` are `format`. A stage of `art` `bk` (arr-bk slice 3) carries the field `graph`, the name of an effect graph in the graph folder (`[a-z0-9_-]`, 1 to 32 characters; `graph` on another kind, a missing `graph`, an unknown graph, a graph without an input node, an instrument graph or a graph whose latency is above 128 samples is `format`, the message names the stage and the graph); a `latenz` field on it is `format` (the loader measures it); the loader and the offline render (`bk_ordner`) build the instance, the same file with the same content is shared between playbacks. A stage of `art` `host` (plan 1.11 T4) carries one more field, `latenz`, the latency of the stage in samples (integer, 0 to 65535, default 0; `latenz` on another kind is `format`): the loader puts it into the stage (`ArrStufe::latenz`) and the delay compensation counts it like the latency of a native stage, so the latency of a host stage is structure and a changed value is a new playback load. A host stage needs the effect-host ports of the core; a core without them (JACK refused the registration) refuses the playback with the named reason `host_fehlt` (reason `format`; the token `host_fehlt` is somewhere inside the message, not at its start, so a consumer searches for it as a substring, as for `ungueltig` and `pdc_zu_lang`). The offline render (`cypherdj-render`) loads a host stage (it has no host to play it) and refuses a stage with `an` true with the render error `host_insert_echtzeit` (exit 5, the strip is named in the message: a project with an active host stage is exported in real time, `/k/arr/export_lauf`, §4.11); a stage with `an` false renders on the dry path, aligned. `slot` is 1 to 4 and is the host number h (pool instance `ins/host/<h>`; the loader's own index is h - 1, the file stays 1-based like the other kinds); a slot outside it or used twice is `format` (the message says `ungueltig` for the first). A `latenz` of 8192 samples or more is `zu_gross` with `pdc_zu_lang`. One host process serves one strip at a time, so a host slot never changes strip inside one load. Rule for the server (plan 1.11 T7, the consumer): express a strip change of a host slot as a removal in one load (the old strip's stage leaves with its exit tail of `latenz` plus 480 samples) and an entry in a later load, at least `latenz + 480` samples after the first. A load that gives a slot that is still active or in its tail to another strip is treated by the core as a removal only: the new strip's stage stays out (the strip plays its undelayed input) until a later load claims the slot again after the tail has ended. A stage that enters holds the undelayed input of its strip for `latenz` samples and then crosses over to its output in 480 samples; a stage that leaves crosses back in 480 samples; live material is never cut. A stage runs when its flag `an` AND its row `ins/<art>/<slot>/an` are on. An `eq` or `saett` stage delays its strip by its latency (69 samples at 48 kHz), a `lim` stage by 74 samples; the delay compensation (slice 4b T13) lines the other strips up. It is computed once per snapshot in the loader (`arr_pdc_rechnen`) for the worst case, with no knowledge of the sends: all tracks are aligned to the track with the longest chain, a group chain adds on top, the groups are aligned to the longest group, the track part of every return waits for the groups, and the master sum waits for the longest of tracks, groups and returns. A stage counts with its latency whether it is bypassed or not (the bypass blend, a stage that is off and a stage in its tail all pass the same delay), so no switch moves the timing. A project without a latency stage has no delay and sounds bit for bit as before. The whole project is late by the longest path (`Arrangement::pdc_latenz()`): the metronome is shifted by it, the render skips it, a recorded take is NOT corrected (it sits that many samples early against what the performer heard). A table that would need a delay of 8192 samples or more on one place (1024 before plan 1.11), or a path of 32768 samples or more, is refused as `zu_gross`. The page writes the flag always true (structure only): the bypass of a stage is the row (`ins/<art>/<slot>/an`), because `insert_an` sends only the row and starts no new playback; a flag written false could not be switched on again until the next structure change. The page server writes `/2` also when a strip has a chain or a return has `pre`. **Structural sidechain key (slice 5 U1, U2a).** A `komp` stage in `chain` may carry `key`, an object `{"q": "spur" | "grp" | "ret" | "pm", "nr": ..., "punkt": "pre" | "post"}` (`nr`: track 1 to 32, group 1 to 16, return 1 to 4; for `pm` it means nothing): the detector then takes its key from that source instead of the row `ins/komp/<n>/sc`, which stays the track-input key of slice 4a (project field `sc`; the pair track and `pre` has exactly one writer, the row, so `{"q": "spur", "punkt": "pre"}` is `format`). `post` of a track is its output after fader, pan and mute/solo fade (the signal it sends on with a post send); `pre` of a group is the sum of its members before any group chain (copied before the first group chain runs), `post` of a group is after its fader, balance and mute/solo fade; `pre` of a return is its input after the Hall blend and in front of its chain, `post` after its fader, mute/solo fade and presence fade. A stage with `key` ignores its `sc` row. **Which stage may take its key from which source is data:** `docs/interfaces/schluessel_regeln.json` (generated into `schluessel_regeln.inc` and `project/key_table.ts` by `djk/contract/generate_key.py`, ctest `schluessel_regeln_aktuell`); the loader refuses every cell that is not `ja` with `format` and names the reason in the message: `sidechain_spaet` (the source is computed after the consumer: tracks first, then group chains, group faders, returns, PM; a track cannot be keyed by a group or a return, a group not by a group `post` or a return, a return not by a return), `sidechain_zyklus` (a strip keyed by its own output, a member track keyed by its own group, a cycle of tracks keying each other, and the PM as a source: every strip feeds the PM) and `sidechain_quelle` (a source that is not there in the block). The DJ inputs are keys too (slice 5 U2b): `{"q": "deck", "nr": 1 to 4}` and `{"q": "erz", "nr": 1}` are the signal the DJ side hands to the arrangement in that block (the mixer inputs `eingang(0..3)` for the decks, `eingang(4)` for erz/1: the Strudel stream of erz/1 without the host return that is added after the arrangement block); `punkt` may be left out, `pre` and `post` mean the same. `erz/4` is the arrangement's own output (`sidechain_zyklus`); `erz/2`, `erz/3`, `erz/5` to `erz/8` and `pad/1`, `pad/2` are not in the block (`sidechain_quelle`); the table is the same data file. A DJ key is live only: an export or loudness render has no deck and no Strudel stream, the inputs are silent, so a stage with a DJ key does not reduce in the export (it is bit for bit the project without the key). **Key alignment (slice 5 U2b).** The loader computes, from the delay compensation table, when each key arrives against the input of the stage it keys: the row key and the DJ keys arrive at 0, a track post at the track alignment, a group pre at the track alignment, a group post at the group alignment, a return pre at the return input, a return post after its chain; the input of a stage arrives after the strip's base delay plus the latencies of the stages in front of it in its chain (bypassed ones count, like in the delay compensation). A key that is EARLIER than the stage input is delayed by the difference in a ring of the stage (`ArrStufe.schl_verz`, `schl_verz_zeile` for the row key; at most 8191 samples, the same bound as the compensation ring (1023 before plan 1.11); a structural key that needs more is refused `format` with the reason `key_verzoegerung_zu_lang`), so the reduction starts when the audio it belongs to reaches the stage. A key that is LATER (a post key of a track while another track is aligned to a longer path) is used as it is and the lag is reported (`schl_spaet`, samples, in the snapshot and as a reading of the stage; the page shows it from U3 on); it is never advanced. Other values of `q` are `format`; a `key` on an `eq`, `saett` or `lim` stage, a `nr` outside its range and a `punkt` other than `pre`/`post` are `format`. A key naming a group without members, a return that is not in the playback or a track that is not there is not an error: it is a silent key. The loader computes the order the tracks run in (`spur_ordnung`, `arr_schluessel_rechnen` in `arr_key.h`): a stable topological order over the track-post edges, the identity when there is none, so the key of track B is there in the same block when a track with a higher or lower number is keyed by it and a project without such keys sums in the same order as before. A group, return or PM stage keyed by a track post needs no edge (every track has run before them). A key source whose capture does not run in a block (a group without members, a return that does not compute) gives a silent key: `schluessel_planen` zeroes the key buffer of every keyed stage at the start of the block, a capture point overwrites it. A project without inserts gives the same file as before.
The page server writes `/2` only if the project has groups, a track does not point to master, or an audio clip carries a
warp that is on (package 1.13; then `gruppen` is always present, even if empty); otherwise `/1` byte-for-byte as before
1.10. The mixer computes tracks, then groups, then the production master (PM: sum of all targets `master`, fader
`pm/fader`, §1.5), and passes its output into the input of `erz/4`; a target change of a sounding track fades linearly
over 480 samples; a project without groups computes bit-identically to before 1.10. The PM output is copied in every
block into a buffer of the core (export tap, `cypherdj-render --abgriff produktion`, before `erz/4`, glue compressor,
`master/pegel` and set limiter); it is not an OSC command; the real-time tap of a strip is the command `/k/arr/abgriff` (§4.11, slice 7).
With neutral setting, `erz/4` is neutral only in magnitude (the isolator acts as an allpass): the PM tap and the ring
master differ in phase, so a null test computes the reference through the same isolator (ADR 033, decision 4).

**Automation lanes in the playback (Automation Slice 1, ADR 032).** In `cypherdj-arr/2` a track may carry `auto`, a list of lanes `{ziel, punkte}`. `ziel` is one of eight project strings (automation slice 2): `fader` (dB, -200 to +6), `pan` (-1 to 1), `mute` and `solo` (only 0 or 1, and every point has `form` 2), `geraet.lautstaerke`, `geraet.cutoff`, `geraet.resonanz`, `geraet.env_mod` (0 to 1, only on a track of `art` `intern` with `geraet` `rb338`, a `bk` track refuses them; `geraet.wellenform`, `geraet.decay` and `geraet.accent` are not targets) and, since 1.12 slice 7, `geraet.k1` to `geraet.k64` (0 to 1, only on a track with `geraet` `bk`, the Baukasten knobs; the RB-338 names are refused there and the knob names on every other track). One lane per `ziel` and track, a second one is `format`, so at most 8 per track (an RB-338 track: four mixer targets and four device parameters); a bk track has 68 possible targets and is held to 12 lanes by the limit of the project model (`MAX_LANES_PRO_SPUR`). For the knobs `ARR_AUTO_GERAET` carries `param` 0 to 63 (`k1` to `k64`); the arrangement hands the value once per block to the track's sink (`auto_parameter`), the bk sink takes it as the knob value of that block and the graph smooths it (20 ms) as it smooths a knob set by hand, so the steps are not audible; before a lane starts to run, and after it ended, the knob of the snapshot holds. A relative lane (a clip envelope, below) is delivered by `auto_parameter_summand` and added to the knob value (clamped to 0 to 1). The core keeps the target as `ArrAutoLane::ziel` (`ARR_AUTO_FADER` 0, `_PAN` 1, `_MUTE` 2, `_SOLO` 3, `_GERAET` 4) and, for a device lane, the parameter index as `param` (`lautstaerke`, `cutoff`, `resonanz`, `env_mod` = 0..3); the reader derives both and the range from one table. The server writes formcode 2 for every mute and solo point. `punkte` is a non-empty list of triples `[beat, wert, form]`: `beat` is a project beat (finite, not negative, not falling along the list; at most two points at one beat, they make a jump), `wert` the value in the unit of the target, `form` the code of the segment INTO the point: 0 `linear`, 1 `s` (3u^2 - 2u^3), 2 `sprung` (the left value holds up to the beat of the point). Limits: 8192 points per lane and 65536 per playback, over that `zu_gross`. `auto` in a `/1` file, a wrong type, an unknown `ziel`, a value outside the range of its target, a mute or solo point that is not a jump of 0 or 1, a device lane on a track that is not an RB-338 track (audio, host or bk; `geraet.k1` to `geraet.k64` on a track that is not a bk track) or a broken triple is `format`, and a failed load keeps the previous snapshot. The server writes `auto` only for a track that has a lane and then writes `/2` (a project without a lane gives the same file byte for byte as before). The core evaluates the lane per sample in the arrangement module (`auto_block`): the project beat of every sample comes exactly from the tempo map; before the first point its value holds, after the last point the last one; the form of the right point decides; a ramp from or to a value of -120 dB or lower runs towards -60 dB (like the interlocking). While a lane exists and the transport runs the lane value is the fader of the track; at stop, without a lane and after the lane is deleted the base value of the track (`fader_db`) holds, and a change between the two blends 480 samples linearly in the gain (not at a start and not at the loop seam). To keep the cost inside the frame the gain is recomputed from the lane value every 16 samples (a drift above 0.03 dB, a jump or a start takes the exact value at once); live and render use the same function. A lane uses no controller of §1.5. The playback format stays `cypherdj-arr/2`. Version skew: a slice 1 core refuses a file with a target other than `fader` as `format` and keeps the previous snapshot. The core plays the `fader`, `pan`, `mute` and `solo` lanes (found by target, not by position), each into its own per-sample buffer. A `geraet` lane drives the internal RB-338 per block: the core hands the sink ONE value per lane and block, the lane at the project beat of the last RUNNING sample of the block (`ArrSenke::auto_parameter`, before the `block()` of that block; no call in a block without a running transport, and none for a track without that lane; the host sink ignores it). `ArrRbSenke` sets it with `cypher_rb_setze` under the parameter name (index 0..3 = `lautstaerke`, `cutoff`, `resonanz`, `env_mod`) after the defaults, the playback's base values and the reset of a start, and only when it differs from the value applied before. When the lane falls away (deleted, a swap without it, stop) the sink sets the base value once: the playback's value of that parameter, else the RB default (0.71034, 0.62565, 0.3, 0.4). The FFI glides 20 ms behind the lane, so on a ramp the sound lags it; measured on the audio, not corrected: a cutoff step 0.2 -> 0.8 is within 5 % of its final sound between 543 and 799 samples after the jump (block resolution), and the value can take effect up to one block (255 samples) before the jump sample, because it is taken at the block's last running sample. A `pan` lane is held like the fader (16 samples, a drift above 0.002 pan, a jump or a start takes the exact value at once) and blends back 480 samples linearly in the pan value; a `mute` or `solo` edge goes through the 480-sample mixer fade.

**Initial mute of a track in the playback (live modules, card t_7e463bcc).** In `cypherdj-arr/2` a track of any `art` may carry `stumm_start`, a boolean (`true`; `false` is the same as absent; in a `/1` file or with another type it is `format`). A track that carries it starts this playback muted: the swap that brings the playback in (`/k/arr/laden`, receipt 3) sets the mute fade of the track to 0 in the block of the swap, with no fade from the old state (a track that sounded in the old playback is silent from the first sample of the new one, a hard cut that goes with the hard start of the new tracks), writes the mixer row `spur/<n>/mute` to 1 beside it (the row, the controller state and `/e/regler` show the muted value, so the page and the row agree) and the track stays muted until the row is set to 0 as for any other mute. A file without the field behaves as before (the mute rows are not touched by a swap). The page server writes it only for the load that brings the stems of a live module (the mute of the Loop track, before: a separate `spur/<n>/mute` row sent after the receipt of the load, 57.5 ms later, so that loop and stems sounded together at +6 dB for about 65 ms); every other row that waits for the receipt (`teileReglerLive`) still does. Measured by `test_kern_arr_stumm_start` and `live_controls_order.test.mjs`.

**Clip envelopes and relative lanes in the playback (Automation Slice 5, package 1.12; `cypherdj-arr/2` only).** Two optional fields, both absent in a project without clip envelopes (the playback file is then byte for byte the one of slice 3). (1) `gain_hk` on an audio clip entry (one entry per loop copy): a non-empty list of triples `[beat, wert, form]` with the checks of a lane (`beat` is the beat inside this copy, finite, not negative, not falling, at most two points at one beat; `form` 0 to 2; `wert` in dB from -200 to 0, else `format`). The core multiplies the gain of every voice of the clip (plain, RE-PITCH, BEATS, and the COMPLEX and TONES voices of the warp werk) by the linear factor of the envelope at the clip beat of each sample, on top of `gain_db` and the fades; a ramp from or to -200 dB runs towards -60 dB like the fader lane. The factor is held for 16 samples like a fader lane (drift above 0.03 dB or a jump takes the exact value at once). A swap of the snapshot that changes only the table glides from the factor in force over the 96-sample seam blend (2 ms). `gain_hk` in a `/1` file is `format`. (2) `relativ: true` on a lane entry of `auto`: a SUMMAND lane. Allowed for `fader` (-60 to +6 dB), `pan` (-2 to 2) and the four `geraet.*` targets (-1 to 1, RB-338 tracks only); not for `mute` and `solo` (`format`). One absolute and one relative lane per target and track at most (a second relative one is `format`, "relative twice on one track"). The field then plays the VALUE STACK: base value (the value of the track) or the absolute lane, plus the relative lane, clamped to the range of the target (fader -200 to +6 dB, pan -1 to 1, device 0 to 1); the step hold, the look-ahead and the 480-sample blend work on that sum. While the hand overrides the field, the whole stack yields to the hand; a field that has a relative lane only has no override (nothing absolute to take over): the hand moves the base value and the stack follows it. A device parameter with a relative lane only has no base value in the core: the sink adds the summand to its own playback value (`ArrSenke::auto_parameter_summand`). The server writes `gain_hk` from the `gain` envelopes of a clip (per loop copy; linked envelopes repeat with the clip loop, unlinked ones modulo their own `loop_beats`, with a jump pair at every seam) and merges the `spur_fader`, `spur_pan` and `geraet.*` envelopes of a track's clips into ONE relative lane per target (0 outside the clip spans, a jump pair at every clip edge). A `transpose` envelope is not a playback field: the server resolves it into the note list (`ton + round(envelope at the note start)`, clamped 0 to 127), so the core sees plain notes and the note-off hits the pitch the note-on had. The core stays on `cypherdj-arr/2`; a core from before this slice skips an unknown clip key (the gain envelope is silent) and plays a lone relative lane as an absolute one, so a project with clip envelopes needs a core of this version.

**Insert and rack lanes in the playback (package 1.12 slice 6; `cypherdj-arr/2` only).** One more optional field, `chain_auto`, on a track entry, a group entry, a return entry and on `pm` (the strip that carries the stage or the rack): a list of lanes `{stufe, param, punkte}` (a stage parameter) or `{makro, punkte}` (a rack macro). `stufe` is the index of the stage in the strip's `chain` (0 based, in list order), `param` the parameter index of that stage (the order of the control rows `ins/<art>/<slot>/*`, §1.5; 0 is `an` and refused, the `komp` key `sc` (9) is refused), `makro` is 0 to 3 for `rack.m1` to `rack.m4` and needs a `rack` on that strip. `punkte` is the list of triples of an `auto` lane (`[beat, wert, form]`, the same checks), with `wert` in the unit of the stage parameter (the core clamps it to the range of the control row) or, for a macro lane, 0 to 1 (outside is `format`). A host stage takes no lane (`format`), nor does a parameter that a rack macro maps (one writer per parameter, `format`), nor a second lane on the same `(stufe, param)` or the same `makro` of one strip. At most 64 lanes of this kind in all strips (`ARR_KLANES_MAX`, over that `zu_gross`). `chain_auto` in a `/1` file, a wrong type or a broken triple is `format`; a failed load keeps the previous snapshot. The core evaluates these lanes once per block (block rate, not per sample like the `fader` lane): the value at the last sample of the block while the transport runs, the value at the start beat while the playback waits for its bar line. The precedence is macro, then lane, then the control row: a stage parameter with a lane follows the lane over the row, and while no lane runs (stopped transport, no lane) the row holds. The project refuses a lane on a macro-mapped parameter and a mapping onto a laned parameter (`param_gemappt`, `param_hat_lane`, §20.13), so in a saved project the two writers never meet; the loader checks the same rule. Live play and the offline export run the same code and differ only where the block sizes differ (one block of step size on a fast ramp), which is why the null test compares them at the same quantum. A core from before this slice skips the unknown key: the lane is silent and the stage stays on its row value.

**Return fader lane in the playback (return automation slice 2; `cypherdj-arr/3`).** The format `cypherdj-arr/3` is `/2` plus one optional field, `returns[].auto`: a list of at most one lane `{ziel: "fader", punkte}` on a return entry. It is the volume curve of the return strip, played sample-accurately like the `fader` lane of a track (same triples `[beat, wert, form]`, same range -200 to +6 dB, same limits: it counts in the 65536 points per playback and the 8192 per lane, over that `zu_gross`; the same rule that a ramp from or to -120 dB or lower runs towards -60 dB; the same 480-sample blend between the lane and the base value `ret/<n>/fader` at stop, at a swap of the playback and when the lane is removed). The core evaluates the lane per sample in the arrangement module and in `cypherdj-render` alike, so an offline export equals the live sound. While a lane exists and the transport runs the lane value replaces the fader of the return (dB; a post-fader send follows it, a `pre` send does not); the control `ret/<n>/fader` holds the base value. A return takes only the target `fader`, absolute: another `ziel`, a `relativ` lane, a second lane or a broken triple is `format`. The master and the groups have no `auto` list at all, so a master fader lane cannot be written (the page API refuses it too: §20.13, `ziel_unbekannt`). `returns[].auto` in a `/1` or `/2` file is `format`: the format number is the version gate, an older core does not know `/3` and refuses the whole file with `format` instead of dropping the lane silently, and a failed load keeps the previous snapshot. The server writes `/3` only when a return carries a fader lane; every other project gives `/1` or `/2` byte for byte as before. `chain_auto` of a return (above) is independent of this field. Sources: `djk/core/src/arr_playback.cpp` (`lese_ret_auto`), `djk/core/src/arr_auto.cpp` (`slot_lane`), `djk/ui/project/playback.ts`.

### 4.12 Recording (1.8 Slice 1)

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/rec/spur` | `,hsiiiii` | `id`, `quelle`, `spur` (1 to 32), `scharf` (0/1), `eingang` (0 none; 1 to 4 = external pair `ein_k` (slice 2); internal taps before the fader: `10+N` = `erz/N` for N 1..3 and 5..7, i.e. 11 to 13 and 15 to 17; `20+N` = `pad/N`, i.e. 21 and 22 (S18); 14 (`erz/4`, production) and 18 (`erz/8`, cue) are refused `ausserhalb_bereich`; 20 = master before the fader, no tap yet; 30 = `midi_ein_1` on instrument tracks (MIDI arm: one input per track, so arming 30 clears an audio arm of that track and an audio arm or disarm clears the MIDI arm; it does not count against `zu_viele_scharf`; `modus` other than 0 with 30 is refused `ausserhalb_bereich`; re-arming a track that already has the MIDI arm is accepted also during a take, any other change is `aufnahme_laeuft`)), `modus` (0 stereo, 1 left, 2 right, 3 sum; only for 1 to 4), `monitor` (0 off, 1 auto, 2 on; only external inputs sound, accepted and ignored for the others) | arms a track or disarms it again; the core creates a ring per armed track (control thread, not in the callback). Receipt 1 and 3; status 6: `kein_eingang` (armed without input), `eingang_fehlt` (input 20 only), `ausserhalb_bereich`, `zu_viele_scharf` (more than 8), `aufnahme_laeuft` (during a take) |
| `/k/rec/start` | `,hsiiii` | `id`, `quelle`, `kennung` (≥ 0), `nachlauf_samples` (0 to 480 000; the take runs on that long past the end of the run, the server sends the largest offset of the run), `frist_samples` (0 = default 96 000, otherwise 48 000 to 1 440 000), `vorzaehler_takte` (count-in in bars: 0, 1, 2 or 4; 3 and everything outside 0 to 4 is refused `ausserhalb_bereich`) | the core waits for the entry of the arrangement (the recording does not own the transport); receipt 1 immediately, receipt 2 at the entry sample, receipt 3 at the end of the take. Receipt 7: `zu_spaet` (no transport start within the deadline; the deadline ends as soon as the arrangement waits, after that its quantization applies), `abbruch` (the arrangement ended before the entry), `ki_stopp`. Status 6: `kein_eingang` (neither an audio track nor a MIDI track armed; a run with only MIDI tracks is a run), `ueberlappung` (transport already running), `aufnahme_laeuft` (take running or the thread is still closing), `ausserhalb_bereich` |
| `/k/rec/stopp` | `,hs` | `id`, `quelle` | cancels a waiting start (receipt 7 `abbruch` for the start) or ends a running take (receipt 3); receipt 1 and 3 |

Sequence: (1) the server sends `/k/rec/spur` per track; (2) `/k/rec/start`, then the usual `/k/arr/start`; (3) from the entry sample
(`Arrangement::start_s_`) the callback pushes chunks of 256 frames per block into the ring, the recording thread writes
`<arr_ordner>/aufnahme-<spur>-<kennung>.f32` (stereo, float32, little endian) and a `.json` companion file; (4) when the arrangement ends (stop, also quantized),
the core ends the take at the end sample, the thread closes, the core reports `/e/aufnahme` (§5.14); (5) the server converts the raw file to WAV,
computes the sha256, sets the clip (one undo step) and has it decoded.

**MIDI take (1.8 slice 5) and refusals while recording.** With `eingang 30` armed the core stamps every note and controller event of `midi_ein_1` with the core sample of its cycle offset (`sample = cycle start + offset`) and keeps those inside `[start, end)` of the take; the recording thread writes one file per run, `<arr_ordner>/midi-<kennung>.bin` (little endian records of 12 bytes: `i64 sample, u8 status, u8 d1, u8 d2, u8 pad`, no header) and a `.json` companion file (`start_sample`, `ende_sample`, `ereignisse`, `abgelehnt`, `eingang 30`). Notes pair by pitch alone: a note-on on an open pitch (also on another channel) closes the old note with a note-off at the new onset, a note-off without an open note is dropped, and notes still open at the end get a note-off at `ende_s`. `/e/aufnahme` reports it with `spur 0`, `art 1`, `frames` = event count, `luecken` = events refused because the ring was full (status 1 then). A run with only MIDI tracks armed runs through the same states 2, 3, 0 without any audio ring. The notes also sound live on the armed instrument tracks (the same sink as the scheduled notes, the Off goes to the sink that got the On); every key still held is released when the track is disarmed, the take ends, the transport stops or an all-off runs, the sink of the track changes, or `midi_ein_1` disconnects. While `/zustand/rec` `status` is not 0 the core refuses `/k/tempo/rampe` with receipt 6 `tempo_rampe` (§16.2).

## 5. Outputs of the core (OSC to subscribers)

### 5.1 Receipt `/q ,hsihds`

`id`, `quelle`, `status`, `ist_sample`, `ist_beat`, `grund` (`""` or a code from §16.2).

| `status` | Name | when |
|---|---|---|
| 1 | `angenommen` | command in the ring, check passed on insertion |
| 2 | `gestartet` | executed at the target sample or ramp begun (`ist_sample` = actual sample) |
| 3 | `fertig` | ramp at the end, loading completed |
| 4 | `verspaetet_verworfen` | policy 0, too late |
| 5 | `verspaetet_ausgefuehrt` | policy 1 or 2, too late, executed as a fallback |
| 6 | `abgelehnt` | check failed (`grund`) |
| 7 | `abgebrochen` | running or waiting part ended (`hand`, `abbruch`, `ki_stopp`, `invariante_*`) |
| 8 | `storniert` | by `/k/storno` |

**State after restart `/q/stand ,hsihds`:** the same fields as `/q`, `status` = the state of the command in the
restart state (1 waiting, 2 running; finished and cancelled commands of the old generation are not
reported again by the core). Sent only to a subscriber that registers in a new generation (§4.1); the control room thereby reconciles
its open plans.

### 5.2 Clock `/uhr ,hhddd` (per cycle)

`sample` (block start), `mono_ns` (block start), `beat` (block start), `bpm`, `bpm_pro_s` (`k` of the segment).
Extrapolation at the receiver: `beat_jetzt ≈ beat + (jetzt_ns − mono_ns)·bpm / 60e9` (measured estimation error
at most 0.024 ms, 06 probe a). Use only for waking up, never as command time.

### 5.3 Bar `/takt ,iihdd`

`takt`, `phrase`, `sample` (sample of the bar start), `beat` (= 4·(takt − 1)), `bpm` at the bar start. Sent in the
cycle that contains the bar start.

### 5.4 Core state `/zustand/kern ,iihiiiiiiiih` (20 Hz)

`generation`, `quantum`, `sample`, `frame_luecken` (since generation start), `ausgelassene_perioden`, `cb_max_us`
(last second), `cb_p99_us` (last second), `aufwach_max_us` (last second), `stretcher_aktiv`,
`befehle_wartend`, `ki_gestoppt` (0/1), `ereignisse_verloren` (events of the core that found no room in the event ring,
since core start: receipts, returns such as `ARR_ALT`; D1 K1).

### 5.5 Deck state `/zustand/deck ,iisdidddfiifii` (50 Hz per loaded deck)

`deck`, `status` (0 empty, 1 loaded, 2 running, 3 loop, 4 roll, 5 fallback), `material_id`, `basis_bpm`, `fassung`,
`quell_beat` (**audible** position), `beats_bis_ende` (master beats up to the end of material, ∞ in loop), `faktor`,
`vorlauf_ms` (minimum lead for deck commands, §3), `hoerweg` (0 direct, 1 stretcher, 2 buffer), `stretcher_fuell`
(working lead in blocks; −1 without stretcher), `versatz_intern_ms` (phase control: actual against `sample_at`),
`keylock_unterlauf` (keylock: ring was missing or did not match the sample, the deck played the varispeed bridge; since
core start), `keylock_aufgegeben` (keylock: attempt given up after 8 missed deadlines, varispeed until the next
event; since core start). Both 0 without stretcher.

### 5.5b Box state `/zustand/box ,iiiiii` (50 Hz per loop box with loop)

Keylock task 7b.3 (additive, like the deck counters in §5.5): `box` (1, 2), `status` (as `/e/loop`: 0 empty, 1 ready,
2 waiting, 3 running, 4 ending), `keylock_unterlauf` (ring was missing or did not match the sample, the box played the
varispeed bridge; since core start), `keylock_aufgegeben` (attempt given up after 8 missed deadlines, varispeed until the
next event; since core start), `keylock_ring_voll` (sections of the box stretcher that did not fit into the ring; should be 0;
since core start), `keylock_kein_platz` (keylock 7c.3: attempts for which no slot of the shared pool was free; the loop then plays
in varispeed until the next event; since core start). All four 0 without stretcher. Sent in the same cycle as `/zustand/deck` (multiple of 960 samples),
for each box with a loaded loop. The dummy (`attrappe_kern`) plays no boxes and does not send it.

### 5.5c Compressor state `/zustand/komp ,sf` (10 Hz per source channel with running compressor)

Effect section (2026-10-11, additive): `kanal` (`deck/<n>`, `erz/<n>`, `pad/<n>`), `gr_db` (gain reduction of the compressor
`<k>/komp/*` at the end of the last block, ≥ 0). Sent on every multiple of 4800 samples, only for channels with
`<k>/komp/an` 1; if the compressor switches off, the stream ends (the page then shows 0). The dummy does not send it.

### 5.5d Mix tool state `/zustand/mix ,sfffff` (10 Hz per channel with a running tool)

1.15 mix tools (2026-11-03, additive): `kanal` (`deck/<n>`, `erz/<n>`, `pad/<n>` with a running gate, `bus/<n>` with a running multiband or channel limiter), `gate_db` (gain
reduction of the gate `<k>/gate/*`, at the end of the last block), `mb_tief_db`, `mb_mitte_db`, `mb_hoch_db` (reduction of the three multiband bands
`bus/<n>/mb/*`) and `lim_db` (reduction of the channel limiter `bus/<n>/lim/*`; 0 while `kanal_limiter_vorhalt_ms` is 0, no limiter built). All reductions are positive
numbers (>= 0), a field of a tool that does not run on the channel is 0. Sent on every multiple of 4800 samples, only for channels where at least one tool
runs (`gate/an` 1 on a source channel, `mb/an` 1 on a bus, or a built channel limiter that ran in the last block on a bus, A5c: `lim/an` 1 plus its 480-sample fade-out); when the last tool of a channel switches off, its stream ends (the page shows "–", no reading, 500 ms after the last event). The
simulated core (`attrappe_kern`) does not send it.

### 5.5e Spectrum `/zustand/spektrum ,sis` (25 Hz while a source is selected)

1.15 mix tools (2026-11-03, additive; sender: task A7b): `kanal` (the selected source: a mixer channel as in `/pegel`, e.g. `erz/1`, or `master`), `rahmen`
(running number of the frame since the last source change; restarts at every change of `spektrum/kanal`) and `pegel` (**29** integers in 0.1 dB, comma
separated, no spaces, three bands per octave, centres 1000 Hz x 2^(i/3) for i = -16 ... 12, i.e. 24.8 Hz to 16 kHz; -2000 = silence). The 29 is the count of
that arithmetic and of `SpektrumAnalysator::anzahl_baender()` (asserted in `test_mixer_spektrum`). The core sends one message per 40 ms while
`spektrum/kanal` is 1 to 19 (0 = off: nothing is sent), 25 Hz at most. The analysis runs on the network thread (the 2 ms loop); on a change of the source the
frames of the old source are dropped and the first frame of the new one comes after the cleared window holds new data (at the latest the 2nd tick, 80 ms, even
after a stall of the consumer). The page server passes it on throttled to 40 ms per `kanal` and keeps the last frame for `GET /spektrum` (`{leer:true}` while the
selector is 0 or no frame of the selected source has arrived). Not recorded in the leitstand journal (25 Hz). The simulated core (`attrappe_kern`) does not send it.

### 5.5f Insert gain reduction `/e/ins_gr ,sf` (20 Hz per running insert stage)

1.10 slice 4a (2026-11-04, additive; device faces T8, 2026-11-15: the limiter stages report too, as `ins/lim/<n>`, n = 1 to 2): `kanal` (`ins/komp/<n>`, n = 1 to 12, the pool slot of the stage) and `gr_db` (gain reduction of the stage at the end of the last block, >= 0). Sent with the
levels (`/pegel`) at 20 Hz for every stage that computed in the last block (flag and row `an` on, a chain loaded); a stage that is bypassed, removed or not reached stops sending, the page shows "-" 500 ms
after the last message. The page server passes it on throttled to 100 ms per `kanal`, keeps the last reading per stage for `/lage` (`ins_gr {"ins/komp/<n>": dB}`, only readings younger than 500 ms) and the
page shows it on the stage in the INSERTS block. Not recorded in the leitstand journal (up to 12 x 20 = 240 lines per second). The simulated core (`attrappe_kern`) does not send it.

### 5.5g Stage levels `/e/stufe_pegel ,sff` (20 Hz per running compressor or limiter stage)

Device faces T9 (2026-11-15, additive): `kanal` is `ins/komp/<n>` (n = 1 to 12), `ins/lim/<n>` (n = 1 to 2) or `komp/<channel>` (the channel compressor of `deck/<n>`, `erz/<n>`, `pad/<n>`), `ein_db` and
`aus_db` are the peak of max(|l|, |r|) at the input and at the output of the stage (after its bypass blend) since the previous report, in dBFS, -200 for silence (the convention of `/pegel`). The core reads and resets
the peaks when it reports, so two reports never share a peak. Sent at 20 Hz with the levels and `/e/ins_gr`, only for stages that ran in the last block; a bypassed or removed stage sends nothing. The page server passes
it on throttled to 100 ms per `kanal` (the last report of the interval wins, so a peak between two forwarded reports is not shown) and does not keep it. Not recorded in the leitstand journal. The simulated core (`attrappe_kern`) does not send it.

### 5.6 Levels `/pegel ,sfffffff` (20 Hz per active channel, plus `master`, `cue`)

`kanal`, `spitze_db`, `echtspitze_dbtp`, `lufs_m`, `lufs_s`, `band_tief_db`, `band_mitte_db`, `band_hoch_db`
(band level at the meter tap, before the band gain of the isolator).
State at slice 35 (preview from 43): the core reports `spitze_db` (sample peak since the last report, dB, −200 below
−200) for every loaded deck (after the fader), `master` (as in the ring, after the limiter) and `cue`, at most every 2 400
samples (20 Hz); `echtspitze_dbtp`, `lufs_m`, `lufs_s` and the three bands are measured only by slice 43 and are at
−200 until then. Since 2026-09-27 (Strudel stage 1, ADR 024) the core also reports `erz/1`, since 2026-09-29 (Studio S1) `erz/2` and
`erz/3` (after the fader, always, without signal −200) and since MVP 2 (ADR 025) `pad/1` and `pad/2` (without loop −200); since S18 also `erz/5`, `erz/6`, `erz/7` (Baukasten instruments, always, −200 without a stream); the remaining erz and bus rails (`erz/4`, `erz/8`, `bus/*`) still do not report.
Since D1 (§4.11) the core reports `spur/<n>` (peak after the track fader) for every track with content in the
loaded playback. Since 1.10 it also reports `grp/<n>` (peak after the group fader, only for groups that a track of the loaded playback feeds) and `pm` (peak after the PM fader, as soon as a playback is loaded).

### 5.7 Control `/e/regler ,sfshd`

`pfad`, `wert`, `halter` (`frei` \| `mensch` \| `plan:<id>` \| `<quelle>`), `sample`, `beat`. On every change,
at most 50 Hz per control, and always at partial start, partial end and holder change.

### 5.8 Hand `/e/hand ,sfhd` and buttons `/e/taste ,sihd`

- `/e/hand`: `pfad`, `wert`, `sample`, `beat`; first and last event of a gesture plus at most 20 Hz.
- `/e/taste`: `name`, `wert`, `sample`, `beat`. Names: `annehmen`, `verwerfen`, `cypher_vorschlag`, `cypher_hoeren`,
  `stopp`, `freigabe`, `urteil_gut`, `urteil_daneben`, `autonomie` (value 0 to 3), `spielart` (value = index of the
  playing style at the encoder), `laenge` (value = bars at the encoder), `spielart_start` (value = target deck), `basstausch`,
  `kiste_laden` (value = deck), `kiste_wahl` (value = index in `kiste.json`), `tempo_basis`, `zuruf` (value = 0; text
  comes via the terminal, §9.4).
- `/e/gelernt ,hiiiii`: `id` (the `/k/lernen` that armed the capture), `quelle` (0 `hand_in`, 1 to 8 `midi_ein_1` to `_8`), `kanal` (1..16),
  `nr` (0..127), `wert` (0..127), `belegt` (1 when the base mapping, slot 0, already uses this CC). MIDI learn (S19): sent once
  per arming, for the first 3-byte CC after `/k/lernen` with `an` 1. A CC from a `midi_ein` port is consumed (it does not move
  anything); a CC from `hand_in` is only reported and keeps working through the base mapping. Armed is cleared by the
  event, by `an` 0 or after 20 s of audio time (no event then).

### 5.9 Events `/e/*`

| Address | Types | Fields |
|---|---|---|
| `/e/geladen` | `,isdiih` | `deck`, `material_id`, `basis_bpm`, `fassung`, `mit_stems`, `sample` |
| `/e/halter` | `,sshd` | `pfad` (or `deck/<n>/transport`), `halter`, `sample`, `beat` |
| `/e/invariante` | `,ssihd` | `art` (`sub_doppelt` \| `master_leer` \| `hoerschein`), `plan`, `teil`, `sample`, `beat` |
| `/e/rueckfall` | `,iidddh` | `deck`, `an` (1/0), `quell_beat_start`, `laenge_beats`, `beat`, `sample` |
| `/e/frist` | `,iddh` | `deck`, `beats_bis_ende`, `beat`, `sample`; at 128, 64, 32, 16 beats before the end of an audible deck |
| `/e/luecke` | `,hii` | `sample`, `frames` (jump of the driver frame time, signed), `zyklen` (skipped periods on a jump up to 16 periods; 0 on a larger or negative jump = driver change, clock externally re-anchored, ADR 004; at the target it can cost one period, finding 08 B4) |
| `/e/quantum` | `,iih` | `alt`, `neu`, `sample` |
| `/e/raster` | `,isdfh` | `deck`, `material_id`, `quell_beat`, `versatz_ms` (nudge or tap; the change from `/k/deck/raster`), `sample` |
| `/e/hotcue` | `,isidh` | `deck`, `material_id`, `nr`, `quell_beat`, `sample` |
| `/e/rueckweg` | `,sih` | `kanal`, `lebt` (0/1), `sample` |
| `/e/ki` | `,ish` | `gestoppt` (0/1), `grund`, `sample` |
| `/e/tempo` | `,dddh` | `bpm`, `ab_beat`, `dauer_beats`, `sample` (hand tempo, at most 10 Hz) |
| `/e/neustart` | `,ih` | `generation`, `sample` (first message of a new generation to all stored subscribers, and again to each one that registers in this generation, §4.1) |
| `/e/protokollfehler` | `,ss` | `adresse`, `grund` |

### 5.10 Notbahn `/nb ,iiih`

`zustand` (0 pass through, 1 loop, 2 faded out, 3 return), `takte_in_schleife`, `generation_gesehen`,
`w` (write counter of the ring). On every change and at 1 Hz.

### 5.11 Loop boxes (MVP 2, ADR 025)

| Address | Types | Fields | when |
|---|---|---|---|
| `/e/loop` | `,iisiidf` | `box`, `status` (0 empty, 1 ready, 2 waiting, 3 running, 4 ending, 5 tempo: no longer reported since 2026-09-30, ADR 026), `name`, `beats`, `fx_art`, `fx_beats`, `fx_wet` | on every change of a box (loading, command, entry and end at the sample, tempo); `fx_*` up to slice 3 always 0, 1, 0. Loading into a sounding box: the message on loading still carries the old name, the new one comes with the takeover (next block, audit F13) |
| `/e/mitschnitt` | `,siid` | `name`, `beats`, `status` (0 done, 1 rejected or write error), `ab_beat` | when a recording ends: written complete, rejected (tempo, overlap, Cypher stop) or aborted (`/k/set/neu`) |

### 5.12 Beat FX (ORDER 2026-09-28: two units, three parameters)

| Address | Types | Fields | when |
|---|---|---|---|
| `/e/fx` | `,iidddddi` | `einheit` (1, 2), `art` (0 off), `beats`, `wet`, `param1`, `param2`, `param3`, `an` (unit ON) | on every change of the unit parameters |
| `/e/fx/zuweisung` | `,isi` | `einheit` (1, 2, 3), `kanal`, `an` (assigned) | bei jeder Änderung der Zuweisung |
| `/e/kanal_limiter` | `,ii` | `gebaut` (0 not built, 1 built), `latenz_samples` (the latency account L of the kern, 0 when not built) | once on the first `/k/hallo` of a subscriber in a generation (after `/k/willkommen` and `/e/neustart`, also when nothing is built: then `0, 0`), never on a heartbeat of the same generation. The values are fixed at start (`kern.toml` `kanal_limiter_vorhalt_ms`), so the message is the kern's real runtime state; the server passes it into `/lage` as `kanal_limiter` |
| `/e/fx/routing` | `,i` | `routing` (0 post fader, 1 insert) | on every change and once after `/e/neustart` with the default 0 |
| `/e/graph` | `,ss` | `kanal` (one of `graph_platz`: deck/1..4, fx/3, fx/4, erz/1, 2, 3, 5, 6, 7, pad/1, 2), `name` (graph name, `""` = no graph) | whenever the graph on a slot changes, sent when the kern's quittung (1, 2, 3 or 5) for the `/k/kanal/graph` or `/erz/strom` command arrives in the network thread (any sender, including an erzeuger re-announce that replaces a graph with kit:/midi:); and as the answer to `/k/graph/frage`. The kern keeps no graph over a restart: after `/e/neustart` every slot is `""`. Reports the last accepted command, not audio |

### 5.13 Arrangement (D1, ADR 030)

| Address | Types | Fields | when |
|---|---|---|---|
| `/zustand/arr` | `,iiidhdif` | `nr` (playback number, −1 without playback), `status` (0 stopped, 1 waiting, 2 playing, 3 freeze), `loop_an`, `projekt_beat` (at block start), `ursprung_sample` (core sample of the transport start, where p = `start_beat` applies; −1 for none), `start_beat`, `metronom_an`, `limiter_db` (reduction of the set limiter in dB, ≤ 0; the core keeps reporting it for 0.5 s after the last change while it is above 0.1 dB; the page shows SET LIMITER when it is below −0.1) | 50 Hz while waiting or playing, otherwise 2 Hz, plus on every change; the page server throttles to 50 ms |
| `/e/freeze` | `,iiih` | `spur`, `kennung`, `status` (0 done, 1 aborted, 2 file not written or already present), `frames` (length of the file, 0 at status 1 and 2) | once per accepted freeze (after `/q` 1), only once the file is written (package K3) |
| `/e/abgriff` | `,iiiih` | `art`, `nr`, `kennung`, `status` (0 done, 1 aborted, 2 file not written or already there), `frames` (length of the file, 0 at status 1 and 2) | once per accepted tap (after `/q` 1), when the file is written (slice 7, 1.10) |
| `/e/ins_host` | `,ii` | `h` (1 to 4), `gesund` (0 or 1: the stage's health after the command, edge check AND the server's flag) | answer to `/k/arr/ins_host`, sent at once (plan 1.11 T5) |
| `/e/ins_mess` | `,iis` | `h` (1 to 4), `rundweg` (samples from the impulse to the first return sample above 0.05, 0 to 16383; -1 without a number), `grund` (empty with a number, else `laeuft`, `host_fehlt` or `kein_rueckweg`) | answer to `/k/arr/ins_mess`: a refusal answers at once (`laeuft`: the transport is not stopped, also when the transport starts during the measurement or a measurement of this host already runs; `host_fehlt`: the host is not healthy, also when it falls during the measurement or `h` has no ports), a measurement answers when the return arrived or after 16384 samples (`kein_rueckweg`, `rundweg` -1). Plan 1.11 T5 |
| `/e/export_lauf` | `,hfiis` | `frames` (in the file, 0 without one), `spitze` (largest magnitude in the file), `luecken` (growth of `frame_luecken` during the run), `ungesund` (blocks of the window in which an active host stage was on the dry path), `grund` (empty with a complete file; else the reason, then no file is left: a refusal of the core, `abbruch`, `ki_stopp`, `schreiber_ueberlauf` when the writer fell behind and the ring was full, `datei_fehlt`, `kein_platz`) | once per run the core accepted for processing (after `/q` 1, or after `/q` 6 of the core), when the file is written and closed (plan 1.11 T12). A complete file with `luecken > 0` or `ungesund > 0` stays on disk: the numbers decide, the consumer deletes |
| `/e/auto` | `,isi` | `spur` (1 to 32), `ziel` (`fader`, `pan`, `mute`, `solo`), `zustand` (1 overridden, 0 the lane plays) | on every change of the lane override of one field (a grip of the hand on `spur/<n>/<ziel>`, `/k/arr/auto`, a deleted lane reports 0), sent at once and never repeated by a timer; there is no follow-up in `/k/hallo`: the server keeps the state for the page. The core queues the changes in a ring of 1024; when it had to drop one (or the event ring to the net was full) it re-reports every field that has a lane and every field it last reported as 1, so a mirror ends in the true state. Note the polarity: `zustand 1` is overridden, `an 1` of `/k/arr/auto` is the lane playing (automation slice 3) |
| `/e/auto_punkt` | `,sdf` | `pfad` (`spur/<n>/<fader\|pan\|mute\|solo>`), `projekt_beat`, `wert` (fader dB, pan −1 to 1, mute and solo 0 or 1) | a point of a hand gesture on an ARMED track while the transport PLAYS (1.12 slice 3, D12). Only grips count (the signal of D1: a hand step the Stellwerk applied, value or touch), never the lane, a `/k/teil` or a resend of the known position. `projekt_beat` is the project beat at the sample of the LAST grip of the block; it is computed there and stored with the value, so it holds across a tempo ramp and across the loop seam (a grip behind the seam inside the block that wraps gets the beat after the wrap). `wert` is the hand value at that same sample (a continuous field takes its course there, a switch its target), so beat and value belong together. Rate: at most 50 Hz per regulator, throttled with a trailing value: a point inside the window is held and sent when the window ends, so the last value of a gesture always arrives; a newer point replaces a held one. Nothing for an unarmed track, nothing while the transport does not play; a point still held when the transport stops is sent in the block after the one that acknowledged the stop, so it arrives AFTER the stopped `/zustand/arr` and the server must accept a point after the stop (measured: stopped state first, point second); a disarm drops the held point but keeps the 50 Hz window of the regulator. No follow-up in `/k/hallo`. Automation slice 3 |
| `/zustand/warp` | `,iiiii` | `stimmen` (voices in the warp engine (Warp-Werk), COMPLEX and TONES, one ending one counted), `unterlauf` (dropouts of the ring during a voice: silence with a 2 ms fade; since core start, should stay 0), `kein_platz` (voices without room in the engine, pool of 64 full or engine missing: the clip plays as RE-PITCH; since core start), `spaet` (voices whose ring was still empty at their entry; since core start), `faeden` (worker threads of the engine, kern.toml `warp_faeden`, 0 synchronous) | only while a warp engine is attached: on every change of the four counters and otherwise every 24 000 samples (2 Hz); new address so that the type chain of `/zustand/arr` stays unchanged (package 1.13 slice 2) |
| `/zustand/ins_host` | `,iiiiiiiiiiii` | `h_1`, `gesund_1`, `rundweg_1`, `h_2`, `gesund_2`, `rundweg_2`, `h_3`, `gesund_3`, `rundweg_3`, `h_4`, `gesund_4`, `rundweg_4`: per host n (1 to 4, in this order) the number n, then 0 or 1 for edge check AND the server's flag, then the last measured round trip in samples, -1 without one | the four effect hosts (plan 1.11 T5; this is the core's side of the `ins_host: [{h, gesund, rundweg}]` list that the page server adds to its own `/zustand/arr` JSON: a new address, because the type chain of `/zustand/arr` must not change); on every change and at 2 Hz, only while the core has the host ports (`host_ports_da`) |
| `/zustand/hall_pool` | `,iiii` | `an` (1 the pool accepts work, 0 off: `hall_faeden` 0, no free cores, or switched off for good by the kern after more than 4 late blocks in 64, then the callback computes every Hall itself), `faeden` (workers running, may be below `hall_faeden`), `spaet` (late events since kern start: a job taken back, or a join after the deadline), `zurueck` (jobs taken back since kern start) | always: on every change of the four values and otherwise every 24 000 samples (2 Hz); without a pool `0 0 0 0`, so `/lage.hall_pool` can be told from an old kern without the address; the page shows it in `/lage.hall_pool {an: bool, faeden, spaet, zurueck}` (absent until the first message came); new address (Hall pool) |
| `/zustand/spur_pool` | `,iiiiiiiii` | `an` (1 the track phases can fork onto the Hall pool, 0 off: `spur_pool` `aus`, no pool, workers that do not run SCHED_FIFO because the process has no real-time rights, or the track account switched itself off after repeated late events or a stall and waits for its retry after a back-off of 4096 blocks, doubling to 65536), `modus` (0 `aus`, 1 `an`, 2 `auto`; 0 without a pool), `blocks_parallel` (phases in which at least one worker job was started, i.e. not taken back), `einheiten_worker` (track units computed on pool workers), `einheiten_caller` (track units the callback computed in phases that went to the pool), `seriell_summe` (phases that stayed on the callback, any reason including a cycle already late at the start of the phase, counted per block that has tracks, also without a pool), `haengt` (track jobs still running at the hard wait limit), `spaet` (late events of the track account), `zurueck` (track jobs taken back because no worker had started them; normal, not late); all counters since kern start. The four counters `blocks_parallel`, `einheiten_worker`, `einheiten_caller`, `seriell_summe` go out as the low 31 bits (they wrap to 0 after 2147483647; a consumer takes differences); `haengt`, `spaet`, `zurueck` saturate at 2147483647 like the Hall pool | on every change of `an`, `modus`, `haengt`, `spaet` and otherwise every 24 000 samples (2 Hz; `zurueck` and the four running counters change every block and ride along with the beat only); without a pool `an`, `modus` and the pool-side counters are 0, `seriell_summe` still counts the serial phases of the tracks; the page shows it in `/lage.spur_pool {an: bool, modus: 'aus'|'an'|'auto', blocks_parallel, einheiten_worker, einheiten_caller, seriell, haengt, spaet, zurueck}` (`seriell` is `seriell_summe`; absent until the first message came; the latest message wins, nothing is derived from the config); new address (track phases) |

### 5.14 Inputs and recording (I08, 1.8)

| Address | Types | Fields | when |
|---|---|---|---|
| `/zustand/ein` | `,ihhhh` | `verbunden` (bit mask: bit k-1 = ein_k_L and ein_k_R connected, k 1..4; bit 8 = midi_ein_1, bits 9 to 15 = midi_ein_2 to _8), `midi_gesehen` (count), `midi_verloren` (count), `midi_sample` (core sample of the last MIDI event, −1 for none), `flanke_sample` (core sample of the last pulse edge on ein_1, measuring MIDI against audio, −1 for none) | in step with the levels, at most every 2 400 samples (20 Hz), without its own change trigger; the page server throttles to 250 ms |
| `/zustand/rec` | `,iiihdiii` | `status` (0 stopped, 1 counting in (slice 4), 2 waiting for the arrangement's start, 3 recording, 4 tail), `kennung`, `scharf` (number of armed tracks), `luecken` (chunks of this take rejected in the callback, ring full), `projekt_beat`, `ausgang_vorhalt` (samples the core delays its master against its timeline: limiter look-ahead plus channel latency plus the delay compensation (PDC) of the loaded arrangement, so it changes when a playback with inserts is loaded; the server reads it after the load and places a take with it), `quantum` (cycle size of the audio callback, 0 before the first cycle), `rec_midi_scharf` (tracks armed on midi_ein_1, eingang 30; `scharf` counts the audio arms only) | every 24 000 samples when idle (status 0), every 4 800 during a take; the page server throttles to 100 ms |
| `/e/aufnahme` | `,iiihhii` | `spur` (1 to 32; 0 for a MIDI take: `frames` is the event count, `luecken` the refused events, status 1 when some were refused), `kennung`, `status` (0 ok, 1 with gaps, 2 aborted (reserved: the core never sends it in slice 1; an abort at core shutdown only writes the companion file), 3 kein_platz: disk full, what has been written so far remains), `frames`, `start_sample`, `luecken` (jump points in the file, filled with silence), `art` (0 audio, 1 midi) | once per track at the end of the take, only once the file is written |

Input levels: `/pegel` with `kanal` = `ein/1` to `ein/4`, without connection −200 dB.

---

## 6. Shared Memory

All layouts: little endian, packed as stated, header 64 bytes, `_Atomic uint64` with release on write and
acquire on read. Creation: the writer with `O_CREAT`, permissions 0600.

### 6.1 Audio ring `/dev/shm/cypherdj/bus` (core → Notbahn), version 1

```
Offset  Typ              Feld
0       char[4]          magic = "CDJB"
4       uint32           version = 1
8       uint32           rate = 48000
12      uint32           kanaele = 4        (0 master_L, 1 master_R, 2 cue_L, 3 cue_R)
16      uint32           cap = 65536        (Frames)
20      uint32[3]        reserve
32      _Atomic uint64   w                  (geschriebene Frames, monoton über Kern-Neustarts)
40      _Atomic uint64   takt_frames        (Länge des zuletzt vollendeten Master-Takts in Frames)
48      _Atomic uint64   takt_anfang_w      (Wert von w am Anfang des laufenden Master-Takts, Takt-Eins der Kern-Uhr)
56      _Atomic uint64   sample_minus_w     (D1: Kern-Sample minus w, Zweierkomplement; Frame f klingt am Kern-Sample f + Wert)
64      float32[cap][4]  daten              (Frame f bei Index f % cap)
```

The core writes `nframes` frames from `w` each cycle, sets `sample_minus_w`, `takt_frames` and `takt_anfang_w`
(all before `w`, release), then `w += nframes`. `sample_minus_w` applies to all frames since the last jump of
the core sample (`/k/set/neu`, restart); a recording thus aligns sample-exactly with the core (D1, null test A7;
reader `cypherdj-mitschnitt`, read-only, package K3). At start the core reads `w` and continues. The Notbahn
reads a block behind `w`; if `w` stands still for one cycle, the loop starts (ADR 016): from the standstill it
keeps playing from its **own history**, stepping back by exactly `takt_frames`, so the master grid is preserved,
for any fixed set base. Because the ring with `cap` = 65 536 frames (1.37 s) is shorter than one bar (90 000
frames at 128), the Notbahn keeps its own history per channel of at least **384 000 frames** (2 bars at 60 BPM;
reference `fallback.c`: 524 288). The fade-out after 8 bars begins on a bar one (from `takt_anfang_w`). In a
tempo ramp the loop deviates by the length difference of two bars (at 128 → 132 over 8 bars about 7 ms per pass,
calculated, unmeasured). Compared with `proben/10-robustheit-betrieb/src/bus.h` (two channels), new: four
channels, header with magic, version and bar fields; the reference took the bar from a fixed `--bpm 128` at
start, which is dropped.

### 6.2 Envelope ring `/dev/shm/cypherdj/huellen` (core → analysis), version 1

```
Kopf:  char[4] magic = "CDJH"; uint32 version = 1; uint32 rate_hz = 1000; uint32 n_kanaele = 16;
       uint32 cap = 16384; uint32 reserve[3]; _Atomic uint64 w (Datensätze je Kanal); uint8 reserve[24]
Datensatz (64 Bytes): int64 sample; float64 beat; float64 quell_beat (NaN außer Decks);
       float32 band[6]; float32 k_leistung; float32 spitze; float32 reserve[2]
Lage:  Datensatz r von Kanal c bei 64 + ((r % cap)·16 + c)·64
Kanäle: 0 bis 3 deck/1..4, 4 bis 11 erz/1..8, 12 pad/1, 13 pad/2, 14 master, 15 cue
```

Channel 14 `master` is the master sum **before** `master/pegel` and the limiter (same stage as a channel at
fader 0); channel 15 `cue` is the cue sum as output.

One record per 48 samples (1 kHz), `sample` = last sample of the window. **`band[0..5]`** = RMS (linear) over
the 48 samples in the **six analysis bands** Sub 30 to 90, Tief (low) 90 to 250, Tiefmitte (low-mid) 250 to 800,
Mitte (mid) 800 to 2000, Präsenz (presence) 2000 to 6000, Hoch (high) 6000 to 16000 Hz (08 §3.3.1), at the
measuring tap (after EQ and filter, before the fader, ADR 008). The band filters are fixed in the core: per band
one bandpass made of two fourth-order Butterworth filters (high-pass at the lower, low-pass at the upper limit),
causal, as a biquad cascade; the coefficients are in a table in `djk/contract/baender.json` (V0), so that
workshop and core compute bit-identically. `k_leistung` = mean K-weighted power (BS.1770); `spitze` = peak
magnitude. The core writes all 16 channels of a record, then `w = r + 1`. Readers discard records older than
`w − cap + 1024`. The core computes the bands only for occupied channels (deck loaded, generator or pad active);
for empty channels it writes zeros. Cost calculated at the order of magnitude of the LR8 isolator (04 §4.8:
5.4 to 10.9 µs per channel and block), unmeasured: M3 measures it along. The six bands carry the bar report, the
listening pass and overlap (§14.5, §14.8); `/pegel` (§5.6) still shows the three isolator bands for display.
Onsets (deck against deck, low band) the analysis searches on `band[0] + band[1]` (power added) **after
smoothing**, because a short RMS envelope ripples at 100 Hz on 50 Hz kicks (08 §4.0 failure case 1: 5 ms RMS,
64 false hits); the method together with its control (click grid, 50 Hz kick) is fixed by the plan of slice 2,
unmeasured.

### 6.3 Restart state `/dev/shm/cypherdj/zustand`

Core-internal (layout in `djk/core/include/cypherdj/state.h`, version in the header, seqlock). Content that every
version must carry: magic, version, seqlock counter, `generation`, anchor (`anker_sample`, `anker_mono_ns`), tempo map
(64 segments), per deck (material, base, running, anchor master beat ↔ source beat, loop, roll, shadow, hotcues,
listening path), all controls with value and holder, listening passs, KI stop, KI track, pending commands (up to
256) with status, **subscribers** (up to 8: name, port, protocol, last report in `mono_ns`). Other building blocks do
not read it (exception: test bench, read only).

### 6.4 Working inventory `/dev/shm/cypherdj/material/<material_id>/`

The same file names as in the inventory (§13.1), only the versions chosen for the set (per version base file or stems,
depending on how it is loaded). Written by the control station (copy, then `rename` of the folder), read by the core
loader. A folder is deleted only when no deck has loaded it.

### 6.5 Crate `/dev/shm/cypherdj/kiste.json`

Written atomically by the control station (temporary file, `rename`), read by the core (controller browser) and by
the Rechner (planner).

```json
{"version":1,"geaendert_sample":1800000,"eintraege":[
  {"material_id":"3fa1c09b2e7d4410","titel":"Nightshift","quelle_bpm":124.86,
   "fassungen":[{"basis_bpm":128.0,"fassung":1,"stems":true}],
   "dauer_beats":352.0,"lufs":-9.4,"camelot":"8A","tore_ok":true,"nur_fuer_andreas":false}]}
```

Loading from the crate takes the highest version as set base, with stems if present.

---

## 7. MIDI and controllers

### 7.1 Ports

`cypherdj-kern:hand_in` (JACK-MIDI input; connected to the midi bridge source of the controller),
`cypherdj-kern:hand_led` (output to the controller), `cypherdj-kern:midi_aus_1` to `_4` (to hosts, devices),
`cypherdj-kern:arr_midi_1` and `_2` (D1 K2b: host slots of the arrangement, notes on channel 1, all-off after
reconnection), `cypherdj-kern:clock` (later, MIDI clock 24 ppq). Connections are made with the JACK names; which ones
is in the mapping.

S19: `cypherdj-kern:midi_ein_1` to `midi_ein_8` (raw generic MIDI inputs, wired by the device management) are each translated by
their own learn table when one exists (`lernen.json` for 1, `lernen-<k>.json` for k 2 to 8, §7.2); without one an input stays raw
(§5.14 counters only). The events of all eight inputs are one merged stream for live notes and the MIDI take, ordered by cycle offset.

### 7.2 Mapping file `~/.config/cypherdj/controller/<geraet>.json`

```json
{"version":1,"geraet":"beispiel","quelle_port":"Midi-Bridge:<Gerät> (capture)","ziel_port":"Midi-Bridge:<Gerät> (playback)",
 "eintraege":[
  {"nachricht":{"typ":"cc","kanal":1,"nr":20},"ziel":"deck/1/eq/tief","art":"relativ","kodierung":"zweierkomplement",
   "kurve":{"typ":"linear","min":-26.0,"max":6.0},"kill_unter_min":true},
  {"nachricht":{"typ":"cc","kanal":1,"nr":7},"ziel":"deck/1/fader","art":"absolut","kurve":{"typ":"fader_db","min":-200.0,"max":0.0}},
  {"nachricht":{"typ":"note","kanal":1,"nr":36},"ziel":"deck/1/hotcue/1","art":"taste","quant":"sofort"},
  {"nachricht":{"typ":"note","kanal":16,"nr":0},"ziel":"taste/stopp","art":"taste"}],
 "leds":[{"name":"vorschlag","nachricht":{"typ":"note","kanal":16,"nr":10},"werte":{"aus":0,"an":127,"blinkt":64}}]}
```

- `art`: `absolut` (pot, fader; takeover **scaled**), `relativ` (endless encoder; `kodierung` `zweierkomplement`
  or `versatz64`), `beruehrung` (touch sensor: holder change without value), `taste` (key).
- `ziel`: a control path (§1.5), a deck action `deck/<n>/<aktion>` (`play`, `cue`, `hotcue/<nr>`,
  `hotcue_setzen/<nr>`, `loop`, `loop_laenge`, `roll/<beats>`, `sprung_plus`, `sprung_minus`, `nudge`, `tap`, `slip`,
  `pfl`, `laden`), `tempo` (hand segment, relative), `arr/start_stopp` (D1: transport of the arrangement, `art`
  `taste`, triggered at once and executed by the core itself: if the arrangement runs, stop with a short fade,
  otherwise start at the last start position with `quant` 2 if a deck, a loop box or a generator stream runs, else 0;
  §4.11), or `taste/<name>` (names as in §5.8).
- `stufen` (optional integer 2..16): only with `art` `taste` at a continuous control whose range is 0..1 with a linear
  curve (the Baukasten rows `<kanal>/bk/<n>`, `spur/<slot>/bk/<k>`); refused with a reason at any other target, at a
  switch control (`kill/*`, `pfl`, `cue/split`: there the button toggles), without `taste`, or outside 2..16. Each press (CC
  value >= 64, or note-on with velocity > 0; a release does nothing) moves the control to the next of N equidistant
  positions and wraps around: `i = round(clamp01(target value) * (N - 1))` (the value the control is heading for, as
  for the toggle), `j = (i + 1) % N`, new value `j / (N - 1)`; this is `diskretWert`/`diskretIndex` of the page. The step
  is applied as a relative grip of `j/(N-1)` minus the target value. An entry without `stufen` behaves as before. Works on
  `hand_in` and on the learn tables alike.
- `nachricht.kanal`: 1..16, or `0` = every channel (a device's channel depends on its state, e.g. LPD8 program 1..4 sends
  on channel 1..4). Lookup of an incoming message: the entry with the exact channel wins; if there is none, the entry with
  channel 0 and the same `typ` and `nr` matches. An entry with channel 0 and one with a concrete channel for the same `typ`/`nr`
  may coexist; two entries with channel 0 and the same `typ`/`nr` are a duplicate (`doppelt`). Applies to `cc` and `note`, to
  every `art`, and to `hand_in` and the learn tables; takeover state is per control, not per channel. An LED with channel 0 is
  sent on channel 1.
- `quant` for deck keys: `sofort` (phase-true), `beat`, `takt` (bar).
- `kurve.typ`: `linear` (unit linear between `min` and `max`), `fader_db` (fader curve: 0 to 1 → dB, below
  −60 dB silent).
- Default for controller EQ (A27 path a): curve `linear` from −26 to +6 dB with `kill_unter_min` = true (kill below
  the minimum), as in the example above.

**Learn table (S19).** `controller/lernen.json` is a normal Mapping-v1 file with the reserved device name `lernen` (slot 1). It
translates only `midi_ein_1` (`hand_in` keeps the base mapping alone); its `quelle_port` is ignored. Each further input has its
own table: `controller/lernen-<k>.json` (k 2 to 8) is slot k and translates only `midi_ein_<k>`; an event is translated only with
the table of its own input. The `geraet` field of these files may hold any text (at most 47 bytes), the loader does not compare it
with the file name. The page server writes
entries without `kurve` (the default curve of the control, `art` `absolut`), one entry per line, and reloads the table with
`/k/mapping` (`geraet` `lernen` or `lernen-<k>`). The kern loads the files at start if they exist; a broken file is logged with its line and the
kern runs without a learn table. `lernen` is refused as `controller_geraet` in kern.toml.

### 7.3 Semantics of the hand

1. Each MIDI event takes effect at the sample of its offset in the cycle of arrival (one period after sending, 09 check c).
2. **First value** of an absolute control after start or reconnection only sets the position.
3. If a plan holds the control, the hand takes over only when the physical position moves more than **3/128** away
   from the takeover point (dead zone) or the touch sensor triggers; then holder `mensch` at the same sample, abort of
   the part and its group (`/q` status 7, reason `hand`), takeover **scaled** (absolute) or **relative** (encoder)
   without a jump.
4. **Return** to `frei`: release gesture (`taste/freigabe` plus touching or moving the control) or **32 beats** without
   hand movement on the control; event `/e/halter`.
5. **Deck holder:** every transport button of a deck sets `deck/<n>/transport` to `mensch` for 32 beats.
6. Deck keys on the direct path act at once, phase-true (or quantized per `quant`); on the stretcher path at the next
   reachable grid point (`vorlauf_ms`), without quantize after `vorlauf_ms`.
7. **Tempo encoder** changes the target value of the hand segment in steps of 0.01 BPM; each change runs the hand
   segment as a ramp over 1 beat (§1.3), never as a jump. `taste/tempo_basis` (shift plus tempo) resets it to the set
   base (also a ramp over 1 beat). Without effect until slice 5 while a deck runs (no stretcher path). On the
   stretcher path, after M4 (2026-09-25, slice 33, `messungen/M04-tempo-rampen/BERICHT.md`) the following applies: the
   factor is set **at most every 43 blocks** (229 ms at quantum 256), also by the phase control, because every change
   costs phase, regardless of its size (E3); the phase control (ARCHITECTURE §4 rule 5) works on the delay model
   (D = 50 ms) with |c| ≤ 100 ppm (E5; "10 ppm per block" runs away); the stretcher **never gets a factor closer than
   10⁻⁶ to 1.0**, on the base the direct path plays (E4: return to exactly 1.0 jumps up to 87 ct). Null samples do not
   produce small changes in the time-stretch design (E7, E9).
8. **Stop button** acts in the core like `/k/ki/stopp`, even without the control station; **release** plus stop like
   `/k/ki/frei`.
9. **Crate browser:** the encoder scrolls through `kiste.json` (display via LEDs or announcement line), `deck/<n>/laden`
   loads the chosen entry with the set base; works even with a dead control station, as long as the material lies in
   the working inventory.
10. "Listen to Cypher" switches the PFL of the channel from `/k/vorschlag_kanal`.
11. **Bar one by hand:** shift plus `tap` on a deck declares the next beat under the read head to be bar one; event
    `/e/raster` with `versatz_ms` = NaN and `quell_beat` of the beat; the control station writes a correction of the
    kind `eins` (§13.3), the workshop renders a new version from it (§12.1 `korrigieren`).

### 7.4 LED names

`vorschlag`, `plan_laeuft`, `rueckfall`, `notbahn`, `ki_gestoppt`, `autonomie_0` to `autonomie_3`,
`deck<n>_halter_andreas`, `deck<n>_halter_cypher`, `deck<n>_hoerschein_ok`, `deck<n>_hoerschein_rot`,
`deck<n>_frist` (blinks in the last 4 bars), `deck<n>_loop`, `deck<n>_roll`. Responsible: holder, loop, roll, deadline,
Notbahn, KI stop is set by the core itself; suggestion, plan, listening pass, autonomy by the control station
via `/k/led`.
Implemented 2026-11-14 (slice 35 B3): the kern derives `deck<n>_loop` (loop active) and `ki_gestoppt` itself and refuses them on
`/k/led` (receipt 6 `ausserhalb_bereich`), like unknown names and states outside 0 to 3; every other §7.4 name is stored by name
and sent when it changes. `hand_led` sends only changes (at most 16 per cycle) and resends all LEDs after a new connection or a
mapping swap; the connector links it to the mapping's `ziel_port` read at start. Not derived yet: `halter_*`, `roll`, `frist`;
`notbahn` stays with the Leitstand.

---

## 8. Audio ports and graph

| Client | Ports | Properties |
|---|---|---|
| `cypherdj-kern` | inputs (measured 2026-10-11, `pw-link -i`, instance f) `hand_in`, `rueck_erz_1_L/R` to `rueck_erz_8_L/R`; outputs `master_L/R`, `cue_L/R`, `midi_aus_1` to `midi_aus_4`; since D1 K2b additionally inputs `arr_rueck_1_L/R`, `arr_rueck_2_L/R` and outputs `arr_midi_1`, `arr_midi_2` (host slots of the arrangement; the edge file may connect them with hosts, never with the core itself); since plan 1.11 T3 the effect-host ports: outputs `arr_ins_1_L/R` to `arr_ins_4_L/R` (send) and inputs `arr_insret_1_L/R` to `arr_insret_4_L/R` (return); host h is pool instance `ins/host/<h>` and playback `slot` h (`ARR_INS_HOST = 4`). The edge file may connect them to foreign clients only: `arr_ins_5_*` and any edge whose far end is a port of a core instance (this one or another, `cypherdj-kern`, `cypherdj-kern-<i>`) are dropped, and the master outputs stay locked. The core registers all 16 ports or none: if JACK refuses one, the registered ones are taken back, the core logs which port failed, starts without effect hosts and reports `host_ports_da() == false` (a playback with a host stage is then refused with `host_fehlt`). **Not present, plan only:** `puls_erz_1` to `_8`, `rueck_fx_1/2_L/R`, `puls_fx_1/2`, `send_1/2_L/R` | `node.group = "cypherdj"`, `node.lock-quantum = true`, quantum from the unit (`PIPEWIRE_QUANTUM=256/48000`); no outputs to the interface |
| (file) | `/dev/shm/cypherdj[-i]/arr-a4.jsonl` | measuring point A4 (D1 K2b): if the file is there, `cypherdj-kern` appends a JSON line with the fields slot, ziel, einsatz, versatz and vorhalt per note-on of a host slot (core samples; `einsatz` −1: no entry above −40 dBFS after 10 ms of silence within 200 ms); the core never creates it |
| (file) | `/dev/shm/cypherdj[-i]/kern-faehigkeiten.json` | `cypherdj-kern` writes `{pid, nur_cue}` atomically before `jack_activate`; `nur_cue` = `"erz/8"` only if the mixer runs the channel as cue-only |
| `cypherdj-notbahn` | outputs `master_L`, `master_R`, `cue_L`, `cue_R` | `node.group = "cypherdj"`, `node.lock-quantum = true`; connects itself to the ports from its call parameters (`--master <jack-port-präfix> --cue <jack-port-präfix>` in the `ExecStart` of the unit; no TOML in C, on the DJ machine there is no C/C++ TOML parser), only after the interlock below |
| `cypherdj-aufnahme` | inputs `in_1` to `in_4` | to the four Notbahn outputs |
| `cypherdj-wirt-<gruppe>[-<i>]`, `cypherdj-klang-sunvox` (later) | Carla names, measured: outputs `audio-out1/2` (and `events-out`), inputs `audio-in1/2`, `events-in`; **no** `out_L/R`, **no** `puls` | `node.async = true` (via `PIPEWIRE_PROPS`), `-p 256`; input MIDI from `midi_aus_<p>` (edge `midi_aus_<p>` → `events-in`), return path `audio-out1/2` → `rueck_erz_<n>_L/R`. Transient unit `cypherdj-wirt-<gruppe>[-<i>]` (`systemd-run`, no template `@`), no Xvfb (Carla runs without DISPLAY) |

**Pulse (plan, not implemented: neither host nor core knows it, ADR 009 M7 pending):** every host writes to `puls` in
every cycle the value `(zyklus mod 1024) / 1024` into all samples. If it does not change for two cycles, the core
fades out the associated return path over 5 ms and reports `/e/rueckweg` (alive = 0).

**Host types (`instrument_host.py`, status RB-338 W1):** `lv2` (Surge XT, `--lv2`), `sfz:<name>` (Carla's sampler, `--sfz`), `vst3:<bundle>`
(own instruments from `djk/instruments`, `--vst3 <Bundle>`; bundle `~/.local/lib/cypherdj/vst3/rb338.vst3`, a symlink to
`.rb338-versionen/<stempel>/`, installed by `djk/instruments/install.sh`). The type is in the status
`/dev/shm/cypherdj[-i]/wirt-<gruppe>.json` (`art`); `djk-instrumente` without `--bass`/`--melodie` keeps the type per
the status. Socket commands of type `vst3` (`ParamSteuerung`): `note`, `halte` (as with Surge and SFZ: holds the ramps of
the track, there are none here; `gehalten` 0, **ends no note**, Stop Cypher sends it), `panik` (note-off for all 128
notes, `gehalten` 128; only by hand and from the watchdog), `param` `{"name","wert"}` (plugin parameter by name,
**normalized 0..1**, outside rejected), `params` (all names with actual value, right after start the plugin's defaults);
`lade`, `fahre`, `zustand` belong to Surge and are rejected with reason. CLAP is not loaded by Carla 2.5.8; VST3 it
loads under Linux (contrary to the comment `carla_backend.py:465`). Raw MIDI CC and pitch bend do **not** reach a
nih-plug VST3 via JACK-MIDI (`IMidiMapping`); notes, velocity and overlap do; therefore the **watchdog** of the host
(`host_watch.py`, every 20 ms, its own portless JACK client) triggers `panik` on each newly added connection at
`events-in`, as a replacement for the core's all-off CC120/CC123 after a reconnection (limit: disconnecting and
connecting between two polls goes unnoticed); controls therefore run via `param`, not via CC (ADR 009 no. 3 is not
viable for nih-plug in this form, `set_parameter_mapped_control_index` works but is not used).

**Port names under `pw-jack`:** from the JACK view the null sink is named after its description, e.g.
`cypher-stumm-probe:playback_FL` (01 §3.2); tests connect with JACK names, never automatically.

**Interlock against unrequested sound** (00 requirements §9 "No sound without a request"; template `fallback.c` line 90): every
building block that connects ports itself (Notbahn, later recording, hosts) checks the target against an allow list:
the port name contains `stumm` or begins with `cypherdj-pruef-` (own null sink per test run). Other targets it
connects only with the call parameter `--ton-frei` (Notbahn) or `ton_frei = true` (TOML building blocks), default off;
it is set only with Andreas' release for his interface. Otherwise abort with a message, return value 3. Test units run
only transiently (`systemd-run --user`), never `systemctl --user enable`.

---

## 9. Control room WebSocket (Leitstand, `ws://127.0.0.1:47200/`)

### 9.1 Envelope (Umschlag)

Every message is a JSON object:

```json
{"v":1,"seq":1234,"von":"leitstand","typ":"takt",
 "zeit":{"sample":1800000,"beat":80.0,"takt":21,"phrase":3},"daten":{}}
```

`seq` counts strictly upward per connection and direction; a gap means: the receiver requests `lage` anew.
`zeit` is the core time point the message refers to (for requests without a reference: the last known block start).

### 9.2 Sign-in (Anmeldung)

Client to control room (Leitstand): `{"typ":"hallo","daten":{"rolle":"spieler|mcp|analyse|werkstatt|ansage|anzeige|pruefstand",
"name":"...","protokoll":1}}`. Reply `{"typ":"willkommen","daten":{"rolle":"...","set_id":"2026-09-24_2100",
"generation":0,"autonomie":1}}`. The roles `ansage` and `anzeige` are read-only.

### 9.3 Control room to clients

| `typ` | to | Content |
|---|---|---|
| `takt` | all | bar state (§14.7) for the bar that has begun, with the analysis report of the previous one |
| `ereignis` | all | `{"art": ..., ...}`, kinds: `plan_angenommen`, `plan_verriegelt`, `plan_vorgeschlagen`, `teil_gestartet`, `teil_fertig`, `teil_abgebrochen`, `invariante`, `rueckfall`, `hand`, `halter`, `hoerschein`, `vorschlag_angenommen`, `vorschlag_verworfen`, `vorschlag_verfallen`, `material_fertig`, `auftrag_status`, `geladen`, `notbahn`, `luecke`, `quantum`, `ki_stopp`, `autonomie`, `urteil`, `zug_antwort`, `tempo`, `set_basis`, `neustart` |
| `zug_anfrage` | spieler | `{"zug_id":"z41","anlass":["frist"],"antwort_bis_beat":432.0,"lage":{Takt-Zustand},"kandidaten":[Kandidat],"hinweis":"..."}` |
| `ansage` | ansage, anzeige | `{"text":"T 113: Nightshift rein, sicher 16 T, Basstausch T 121","art":"vorschlag|plan|rueckfall|warnung|info"}` |
| `rpc_antwort` | caller | `{"id":17,"ergebnis":{...}}` |
| `rpc_fehler` | caller | `{"id":17,"code":"...","text":"..."}` |
| `auftrag` | werkstatt | workshop job (Werkstatt-Auftrag, §12.1) |

### 9.4 Clients to control room

| `typ` | from | Content |
|---|---|---|
| `rpc` | mcp (and later anzeige) | `{"id":17,"methode":"waehle","parameter":{...}}`; methods = MCP tools (§10) |
| `takt_bericht` | analyse | report for a completed bar (§14.8) |
| `hoerschein` | analyse | listening pass (Hörschein, §14.5) |
| `auftrag_status`, `material_fertig` | werkstatt | §12.2 |
| `zug_status` | spieler | `{"zug_id":"z41","stand":"gesendet|antwort|zeitueberschreitung","dauer_ms":1480}` |
| `zuruf` | ansage | `{"text":"mehr Druck im Bass"}` (Andreas types one line; it becomes the move trigger `zuruf`) |

---

## 10. MCP tools for Cypher

Every return value contains `"jetzt":{"takt":..,"schlag":..,"beat":..,"seq":..}`. Errors as MCP errors with `code` from §16.2.
Tools in bars are the **input form for the LLM**; the control room converts them deterministically: `ab_beat =
(ab_takt − 1)·4 + (ab_schlag − 1)`, `dauer_beats = dauer_takte·4`. The canonical plan form is in beats (§14.1).

| Tool | Input | Return | from slice |
|---|---|---|---|
| `lage` | `{}` | bar state, events since the last call | 1 |
| `warte` | `{"bis_takt"?:int, "auf"?:[ereignis-art], "max_s":≤30}` | like `lage`, as soon as it occurs | 1 |
| `waehle` | `{"material_id":str, "spielart":str, "start_takt":int, "hoerschein":str, "einstieg_quell_beat"?:f, "deck"?:int, "laenge_takte"?:int, "absicht"?:str≤200}` (without `einstieg_quell_beat` the candidate's value applies) | `{"status":"angenommen|vorgeschlagen|verriegelt|abgelehnt","plan_id":str,"gruende":[{"teil":int,"grund":str,...}],"vorhersage":{"ueberdeckung_max":{"sub":f,"tief":f},"lufs_abw_max_lu":f},"ansage":str}` | 2 |
| `plan_einreichen` | plan in human form: `{"spielart"?:str, "hoerschein"?:str, "grund":str, "teile":[{"regler":pfad,"art":"rampe|setze","ab_takt":int,"ab_schlag"?:1..4,"dauer_takte"?:f,"nach":f}]}` | like `waehle` | 2 |
| `plan_abbrechen` | `{"plan_id":str, "teile"?:[int]}` | status per part, values at the abort | 2 |
| `laden` | `{"deck":int, "material_id":str}` | job; `geladen` comes as an event | 2 |
| `vorhoeren` | `{"deck":int, "ab_takt"?:int, "einstieg_quell_beat"?:f}` (default: the candidate's entry point, otherwise hot cue 1, otherwise the first phrase from bar one) or `{"pad":int, "material_id":str, "schuss_nr":int}` | only on a closed deck or pad (otherwise `deck_hoerbar`); the deck starts in sync **at the entry point** and runs behind the fader; listening pass after 4 bars as an event, then renewal per bar | 2 |
| `bestand` | `{"filter"?:{"camelot"?,"bpm_von"?,"bpm_bis"?,"frisch_seit_min"?,"nur_tore_ok"?:bool}, "max":≤20}` | entries of the box (Kiste) with short fingerprint | 2 |
| `passung` | `{"a":material_id, "b":material_id}` | fit plus prediction per play style (§11) | 2 |
| `erzeuge` | `{"stil":str, "text":str, "dauer_s":int, "ziel_bpm":f, "tonart"?:str, "anzahl"?:1..4}` | `{"auftrag_id":str,"erwartet_fertig_takt":int}`; `material_fertig` as an event | 4 |
| `spielzettel` | `{"zeilen":str}` | error with line number, affected tracks from beat | 7 |
| `markieren` | `{"text":str, "art":"absicht|hypothese|urteil_erbeten"}` | journal line | 1 |

Autonomy (enforced by the control room, **allowlist** as in ADR 013 decision 4):

- **Level 0:** `waehle`, `plan_einreichen`, `laden`, `vorhoeren`, `erzeuge` are rejected (`autonomie`); `lage`,
  `warte`, `bestand`, `passung`, `markieren` go through.
- **Level 1:** **every** submission from `waehle` or `plan_einreichen` becomes a proposal (`vorgeschlagen`), no matter
  what its parts do (EQ to +6 dB, stem to 0, send, hot cue, jump, loop on Andreas' running deck are proposals, even if
  they open no channel). Allowed on their own are only `laden`, `vorhoeren`, `erzeuge`, `plan_abbrechen` of one's own
  plans, and a plan whose parts **exclusively** make channels of the AI track quieter (fader or send down, kill on).
- **Level 2:** as 1, additionally direct: plans whose parts concern **only** channels of the AI track (after the fader,
  which only Andreas holds); everything else becomes a proposal.
- **Level 3:** everything direct.

Invariants hold at every level. An accepted proposal goes to the core with source `cypher`; deck parts from it carry
`hoerschein` = `annahme:<vorschlag_id>` (§4.4). Golden sequence `autonomie_1_eq` (§19.3): level 1, plan with an
EQ part on an audible deck → `vorgeschlagen`, no `/k/teil` to the core.

---

## 11. Planner service (Rechner, Unix socket, JSON lines)

Request `{"id":5,"methode":"...","parameter":{...}}\n`, reply `{"id":5,"ergebnis":{...}}\n` or
`{"id":5,"fehler":{"code":"...","text":"..."}}\n`. One request per line, replies in any order.

| Method | Parameters | Result | Time limit |
|---|---|---|---|
| `spielarten` | `{}` | list of play styles (§14.4) | 1 s |
| `passung` | `{"a":id,"b":id}` | fit (§14.6) | 5 s |
| `kandidaten` | `{"deck_laufend":int,"material_laufend":id,"quell_beat":f,"frist_takt":int,"anzahl":≤3,"ausschluss":[id]}` | `[Kandidat]` (§14.6), sorted | 5 s (unmeasured) |
| `expandiere` | `{"wahl":Wahl,"lage":Takt-Zustand}` | `{"plan":Plan,"vorhersage":{...}}`; parts exactly per the rule §14.4, with deck part `start` at the entry point (§14.1) | 2 s (rule of thumb), optimizer only on request |
| `vorhersage` | `{"plan":Plan}` | `{"ueberdeckung_je_takt":{"sub":[..],"tief":[..],...},"lufs_je_takt":[..],"grenzen_ok":bool,"warnungen":[str]}` | 2 s |

The prediction computes with the cross-energies of the version (filter LR8 246/2484 Hz, §13.1; taken from what sounds:
stem sum or base file). Realistic error 0.038 overlap and 0.41 LU (08 NP K2); it holds only with stem controls at
0 dB (plans with stem parts get a warning). **`grenzen_ok` checks only `grenze_sub`.** The low-end limits are
uncalibrated: the measured rule of thumb itself lies above them (low 0.402 with limit 0.20 for "safe", 0.355 with 0.35
for "hard", 08 NP K1); until M20 (recalculation) they only report `warnungen` (`leitstand.toml`
`grenzen_tief_verriegeln = false`).

---

## 12. Workshop (Werkstatt)

### 12.1 Job (Auftrag, control room to workshop, WS type `auftrag`)

```json
{"auftrag_id":"a7","art":"generieren","vorrang":2,"set_basis_bpm":128.0,
 "parameter":{"stil":"deep house, warm pads","text":"...","dauer_s":260,"ziel_bpm":126.0,"tonart":"8A","anzahl":1}}
```

| `art` | `parameter` | Priority (1 highest) |
|---|---|---|
| `generieren` | `stil`, `text`, `dauer_s`, `ziel_bpm`, `tonart`?, `seed`?, `anzahl`? | 2 |
| `einlesen` | `quelle_pfad` (file on the DJ machine) | 2 |
| `nachrendern` | `material_id`, `basis_bpm`, `mit_stems`, `mit_schuessen` → **new version** (§13.1) | 1 |
| `korrigieren` | `material_id` (apply grid, downbeat (Eins) and hot cue corrections from `korrekturen.jsonl` up to the last line) → **new version** with `r + 1`, same base; old versions remain unchanged | 1 |

### 12.2 Reports (Rückmeldungen, workshop to control room)

- `auftrag_status`: `{"auftrag_id":"a7","stand":"wartet|laeuft|fertig|fehler","schritt":"generieren|dekodieren|raster|warp|stems|fingerabdruck|tore|veroeffentlichen","fortschritt":0.4,"erwartet_fertig_s":820,"grund":""}`,
  at each step change and every 10 s.
- `material_fertig`: `{"auftrag_id":"a7","material_id":"3fa1c09b2e7d4410","basis_bpm":128.0,"fassung":1,"pfad":"~/cypher-dj/bestand/3fa1c09b2e7d4410","tore":{Tore},"nur_fuer_andreas":false,"warnungen":["Gesang verstimmt (−22 ct)"],"dauer_s":{"generieren":1012,"raster":41,"warp":65,"stems":null,"fingerabdruck":33}}`.

### 12.3 Chain, gates, generation

- Chain and order: ADR 011 decision 2. Each step writes into `~/cypher-dj/bestand/.arbeit/<auftrag_id>/`.
  A new material is published as a whole folder via `rename` to `~/cypher-dj/bestand/<material_id>/`; each further version (re-rendering, correction) as its own folder via `rename` to `<material_id>/fassungen/<bpm·1000>_r<n>/` (§13.1). Nothing existing is overwritten.
- **Tempo choice:** the chain chooses, among source BPM × {½, 1, 2}, the multiple whose stretch factor to the set base (`basis_bpm / (Quell-BPM × v)`) lies closest to 1. Half and double tempo change only the beat count of the tempo map. `material.json` records `tempo_vielfaches`.
- **Tuning:** if both tools (own method from `fa.py`, Essentia) agree to within at most 10 cents, and the deviation from A = 440 Hz lies below `stimmung_max_cent` (35), the chain removes it in the same R3 run as the warp (`stimmung_korrektur_cent` in `fassung.json`); otherwise there is no correction and a warning. Live there is no pitch control, the direct path stays bit-exact (ADR 012). Pitch of the correction unmeasured: M19.
- **Stems in the set:** on the GPU only with `stems_gpu = true` (only after Andreas' answer, ARCHITECTURE §13 question 4); on the CPU during a set only at quantum 256 (`stems_cpu_im_set = "nur_256"`: 10 NP N6, 15 % of the period at 256, 55 % at 128), as a workshop job with `Nice=19`, `CPUSchedulingPolicy=batch`, at most `threads` threads; never at 128.
- **Gates** (`fassung.json` field `tore`, thresholds provisional until M13 and M19; a gate **never measures with the tool that set the map**, 08 NP K3):
  - `raster` ok if the **independently** measured low-band onsets on the warped result (method `proben/08-analyse-passung/fa.py` onsets: Hilbert envelope 30 to 250 Hz, 50% point; control click grid 32 of 32, 0.38 ms, 08 §4.0) against the rigid grid have a residual of ≤ 8 ms p90 (flam lower bound), with at least 64 onsets; fewer onsets count as undetermined and thus as broken. beat_this and Essentia do not check here, they set the map. Built as `werkstatt/gate_grid.py` (slice 3a), not yet hooked into `chain.py`; on real tracks the assumption "kick on every beat" does not hold throughout (target acceptance S3a 2026-10-29, new version in S3b).
  - `klarheit` ok if the pulse clarity (method `c_drift.py`) ≥ 0.1. The earlier exception "both raster tools agree" is dropped: both set the map, and below 0.1 the metric does not separate noise from drift (c_drift: 8 of 10 MiniMax songs lie below 0.1).
  - `streckfaktor` ok if |stretch factor − 1| ≤ `tor_streckfaktor` (0.20 from M19, §2.1, 2026-09-25) after the tempo choice (set value; measured: keylock holds only up to about ±5 %, RESULT: 0.95522 and 1.04121; M19 measures 0.7 to 1.4).
  - `eins` ok if bar one from beat_this (downbeat output) and the second method (beat position with the strongest low-band energy over the whole track, from `fa.py` `energie_profil16`; hypothesis, M13) agree.
  - `headroom` ok if the true peak after the warp is ≤ −1 dBTP before the trim.
  A broken gate sets `nur_fuer_andreas: true` (a warning for Andreas, a lock for Cypher, ADR 011).
- **Generation:** HTTP to ComfyUI on the GPU machine (MiniMax Music 3); workflow file `djk/workshop/workflows/minimax.json`; fetch the result file via `/view`; prompt rules per skill `cypher-musik` (duration 40 to 50% above the target length, text for the full length). Several seeds of one job in one run. Whether MiniMax hits a target BPM in the prompt is unmeasured (M14); the skill advises against exact BPM ("Exakte BPM nur wenn begründet, sonst Bereich oder qualitativ", i.e. "exact BPM only if justified, otherwise a range or qualitative"), `cypher-musik/SKILL.md` line 59, and the ten existing songs lie at 89.9 to 180.7 BPM (c_drift.log). The text of the prompt is taken over as `text` into the material (A13 "Text", §13.2).
- **Splitter** (from slice 6, draft): its own Sonnet session with an MCP server of the workshop (tools `auftraege`, `ergebnis_ansehen`, `loops_setzen`, `hotcues_setzen`, `warnung`, `freigeben`); the contract for it comes with the plan of slice 6.

---

## 13. Inventory

### 13.1 Folder `~/cypher-dj/bestand/<material_id>/` (versions immutable)

```
original.<endung>                      Quelldatei wie geliefert (MP3, FLAC, WAV)              einmal geschrieben
original.flac                          verlustfrei, falls die Quelle verlustbehaftet ist         einmal geschrieben
material.json                          Quell-Metadaten (§13.2)                                   einmal geschrieben
korrekturen.jsonl                      die EINZIGE anhängbare Datei (§13.3)                     nur anhängen
fassungen/<bpm·1000>_r<n>/             eine Fassung je Render, z. B. fassungen/128000_r1/        einmal geschrieben (rename)
    fassung.json                       Metadaten dieser Fassung (§13.2)
    basis.f32                          float32, verschränkt Stereo, 48 kHz, LE, ohne Kopf
    stems/{drums,bass,vocals,other}.f32
    schuesse/<nr>.f32                  Einzelschüsse, vorgerendert
    fingerabdruck.json                 Fingerabdruck v1 (Felder wie 08 §5)
    kreuzenergie.npy                   C[6,3,3,S] float32 (6 Bänder, 3 EQ-Komponenten LR8 246/2484 Hz, S Sechzehntel)
    huelle_1khz.npy                    Referenz-Hüllkurven [6, N] float32 (Definition unten)
```

`r` counts per base tempo from 1: re-rendering onto a new base starts at `r1`, each correction (`korrigieren`) places `r + 1` next to it. No program changes a published version; only the first import writes `material.json` and `original.*`. Deck and listening pass always bind (material, base, version) (§4.4, §4.5).

**What is heard is what gets computed from:** if a version has stems and the core loads them along (`mit_stems = 1`), the stem sum sounds; then the workshop computes `fingerabdruck.json`, `kreuzenergie.npy` and `huelle_1khz.npy` from the stem sum, otherwise from `basis.f32`. The `fassung.json` field `analyse_quelle` says from what (`stems` or `basis`); a version without stems has `analyse_quelle = basis`, one with stems always has `stems` (the deck then loads them with stems).

**`huelle_1khz.npy`:** float32 `[6, N]`, the same six band filters (coefficients `djk/contract/baender.json`) and the same RMS window (48 samples, non-overlapping) as the envelope ring (§6.2), applied to the version without trim. Index `i` = record over the frames `[48·i, 48·i + 48)` of the file, i.e. `i = frame / 48` (integer), linear. This way the analysis (§14.8) compares curves filtered the same way.

**Grid of the version:** frame of the source beat `q`: `frame(q) = erster_schlag_frame + q · 60 / basis_bpm · 48000` (rigid). **Swap of the version:** same `quell_beat`, other version: `frame' = erster_schlag_frame' + q · 60 /
basis' · 48000`.

### 13.2 `material.json` and `fassung.json` (schema version 1)

`material.json` (written once, source and first recognition):

| Field | Type | Meaning |
|---|---|---|
| `schema` | int | 1 |
| `material_id`, `titel` | str | |
| `herkunft` | obj | `art` (`minimax` \| `datei` \| `aufnahme`), `prompt`, `stil`, `seed`, `generator`, `erzeugt_am` (ISO 8601), `auftrag_id` |
| `text` | obj | `{"quelle": "prompt" \| "keiner", "zeilen": [str]}`; with MiniMax taken from the prompt, not recognized from the audio; text recognition later with the splitter (slice 6) |
| `quelle` | obj | `datei`, `sr`, `kanaele`, `dauer_s`, `sha256` |
| `tempo_karte_quelle` | arr | `[[quell_sekunde, quell_beat], ...]` per beat, from the raster tool |
| `raster` | obj | `werkzeug` (`beat_this`), `zweitwerkzeug` (`essentia`), `abweichung_ms_p90` (form: p90 of the deviation from the second tool after subtracting the constant offset), `versatz_zweitwerkzeug_ms` (this constant offset, with sign, tool minus second tool; both fields from Andreas 2026-09-25, B11), `pulsklarheit`, `erster_schlag_quelle_s`, `taktart` (4), `tempo_vielfaches` (½, 1, 2), `erste_eins_quell_beat` (0 to 3; since 2026-10-11 the majority of the beat_this downbeats, if the share is < 0.85 and the half-bar deviation of the first kick, its position, `eins.entscheide_eins`), `erste_eins_zweitverfahren` (low band, measured value only), `erste_eins_anteil`, `erste_eins_kick` (position of the first kick or null), `erste_eins_unsicher`, `erste_eins_quelle` (`mehrheit`, `kick`, `keine`) |
| `lautheit_quelle` | obj | `lufs_integriert`, `echtspitze_dbtp`, `crest_db` of the source file |
| `tonart` | obj | `camelot`, `r`, `vorsprung`, `stimmung_cent`, `stimmung_r`, `stimmung_cent_zweitwerkzeug`, `aus_stems` |

`fassung.json` (per version, written once):

| Field | Type | Meaning |
|---|---|---|
| `schema`, `material_id`, `basis_bpm`, `fassung` | | |
| `korrekturen_bis_zeile` | int | how many lines of `korrekturen.jsonl` are included (0 = none) |
| `datei`, `frames`, `sha256`, `erster_schlag_frame`, `beats` | | base file |
| `erste_eins_quell_beat` | int | valid bar one of this version (after corrections) |
| `analyse_quelle` | str | `stems` or `basis` (§13.1) |
| `stems` | obj | `{name: {datei, sha256, frames}}` or `{}` |
| `schuesse` | arr | `[{nr, datei, frames, quell_beat, name}]` |
| `headroom_db` | float | −12 (headroom before R3) |
| `stimmung_korrektur_cent` | float | removed in the warp (§12.3), 0 without correction |
| `lautheit` | obj | `lufs_integriert` (of this file, after headroom and warp; from this the core sets the trim, §1.5), `echtspitze_dbtp`, `crest_db`, `lufs_je_takt` |
| `struktur` | obj | `phrasen`: `[{ab_beat, bis_beat, art: intro\|aufbau\|drop\|break\|outro\|unbekannt}]` (source beats, phrases from bar one) |
| `hotcues` | arr | `[{nr, quell_beat, name, von: werkstatt\|andreas}]` (suggestions at phrases from bar one) |
| `loops` | arr | `[{name, ab_beat, laenge_beats}]` |
| `tore` | obj | `{raster:{ok, wert_ms, grenze_ms, anschlaege}, headroom:{ok, wert_dbtp, grenze_dbtp}, klarheit:{ok, wert, grenze}, streckfaktor:{ok, wert, grenze}, eins:{ok, beat_this, zweitverfahren, bewertet, unsicher, anteil, kick, quelle}}`; gate `eins` ok = assessed and not uncertain (since 2026-10-11, no longer beat_this == low band); the page shows `unsicher` as "downbeat?"; a bar one set by hand (`korrekturen.jsonl` art=eins) counts as certain |
| `nur_fuer_andreas` | bool | a gate broken |
| `warnungen` | arr[str] | |

Check on loading in the core: file size = `frames · 2 · 4` bytes, `sha256` matches (checked when copying into the working set; the core checks size, rate and NaN in a sample of 4096 frames against `fassung.json`).

### 13.3 `korrekturen.jsonl`

The only file in the material folder that gets appended to. One line per correction:
`{"zeit":"2026-09-24T21:14:03","von":"andreas|werkstatt","art":"raster|eins|hotcue|urteil","fassung":"128000_r1",
"ab_quell_beat":64.0,"bis_quell_beat":128.0,"versatz_ms":-10.4,"nr":null,"text":""}`. Type `eins`:
`ab_quell_beat` is the beat that Andreas declared as bar one (§7.3 point 11).

### 13.4 Index `~/cypher-dj/bestand/index.sqlite`

Tables `material(material_id PRIMARY KEY, titel, herkunft_art, erzeugt_am, quelle_bpm, dauer_s, lufs, camelot,
stimmung_cent, tore_ok, nur_fuer_andreas, pfad)`, `fassung(material_id, basis_bpm, fassung, frames, stems, schuesse,
lufs, tore_ok)`. Only the workshop writes (WAL mode); the control station (Leitstand) and the planner read. The planner reads with Python's
`sqlite3`; the control station with `node:sqlite` (Node 22.23: works, reports an `ExperimentalWarning`, measured 2026-09-23).
If `node:sqlite` breaks in a later Node version, the workshop additionally writes `index.json` (return path, not yet built).

---

## 14. Central data types (JSON)

### 14.1 Plan (canonical, in beats)

```json
{"id":"p17","quelle":"cypher","spielart":"sicher","wahl_id":"w9","einstieg_quell_beat":64.0,"hoerscheine":["h12"],
 "grund":"A läuft aus",
 "teile":[
  {"nr":0,"art":"deck","deck":2,"aktion":"start","ab_beat":448.0,"quell_beat":64.0,"politik":0,"gruppe":"b_rein","hoerschein":""},
  {"nr":1,"art":"regler","pfad":"deck/2/eq/tief","ab_beat":447.0,"dauer_beats":0,"nach":-30.0,"form":0,"politik":0,"gruppe":"b_rein","hoerschein":""},
  {"nr":2,"art":"regler","pfad":"deck/2/fader","ab_beat":448.0,"dauer_beats":0,"nach":-15.0,"form":0,"politik":0,"gruppe":"b_rein","hoerschein":"h12"},
  {"nr":3,"art":"regler","pfad":"deck/2/fader","ab_beat":448.0,"dauer_beats":32.0,"nach":0.0,"form":0,"politik":0,"gruppe":"b_rein","hoerschein":"h12"},
  {"nr":4,"art":"regler","pfad":"deck/2/eq/tief","ab_beat":476.0,"dauer_beats":4.0,"nach":0.0,"form":0,"politik":0,"gruppe":"basstausch","hoerschein":""},
  {"nr":5,"art":"regler","pfad":"deck/1/eq/tief","ab_beat":476.0,"dauer_beats":4.0,"nach":-30.0,"form":0,"politik":0,"gruppe":"basstausch","hoerschein":""},
  {"nr":6,"art":"regler","pfad":"deck/1/eq/mitte","ab_beat":480.0,"dauer_beats":28.0,"nach":-26.25,"form":0,"politik":1,"gruppe":"a_raus","hoerschein":""},
  {"nr":7,"art":"regler","pfad":"deck/1/eq/hoch","ab_beat":480.0,"dauer_beats":28.0,"nach":-26.25,"form":0,"politik":1,"gruppe":"a_raus","hoerschein":""},
  {"nr":8,"art":"regler","pfad":"deck/1/fader","ab_beat":492.0,"dauer_beats":16.0,"nach":-40.0,"form":0,"politik":1,"gruppe":"a_raus","hoerschein":""},
  {"nr":9,"art":"regler","pfad":"deck/1/fader","ab_beat":508.0,"dauer_beats":4.0,"nach":-200.0,"form":0,"politik":1,"gruppe":"a_raus","hoerschein":""},
  {"nr":10,"art":"deck","deck":1,"aktion":"stopp","ab_beat":512.0,"politik":1,"gruppe":"a_raus","hoerschein":""},
  {"nr":11,"art":"regler","pfad":"deck/1/eq/tief","ab_beat":512.0,"dauer_beats":0,"nach":0.0,"form":0,"politik":1,"gruppe":"a_raus","hoerschein":""},
  {"nr":12,"art":"regler","pfad":"deck/1/eq/mitte","ab_beat":512.0,"dauer_beats":0,"nach":0.0,"form":0,"politik":1,"gruppe":"a_raus","hoerschein":""},
  {"nr":13,"art":"regler","pfad":"deck/1/eq/hoch","ab_beat":512.0,"dauer_beats":0,"nach":0.0,"form":0,"politik":1,"gruppe":"a_raus","hoerschein":""}]}
```

Part types: `regler` (→ `/k/teil`), `deck` with `aktion` ∈ `start`, `stopp`, `loop`, `roll`, `sprung`, `hotcue`
(→ `/k/deck/*`, fields as there, **with** `plan`, `gruppe`, `hoerschein`; `nr` of the hotcue is called `hotcue_nr` in the part, `art` of the roll `roll_art`, because `nr` and `art` are the part number and part type), `tempo` (→ `/k/tempo/rampe`). **Coupling is assigned by the control station**, not by the LLM: bass-swap pairs get a shared group, "A raus" (A out) is bound to "B rein" (B in)
(A out starts only once B in has started; if B is locked, A out is dropped along with the deck stop;
additionally I2 in the core). If Andreas touches A's fader or EQ, the whole group `a_raus` falls, **including the stop** (part 10).

Notes on the example (style "sicher" exactly per the rule §14.4, start S = bar 113 = beat 448, A ends at
beat 512, entry of B at source beat 64): B was pre-listened from source beat 64 and starts at S **anew at the entry**
(part 0), so from S on exactly the measured section sounds (I3a checks the source position, §17). B's bass is EQ-cut before
fading in, set one beat before S while B is not yet running (part 1 at beat 447): I1 checks via the switch ramp (§17); a set at the same sample as part 2 would have doubled 192 samples of sub. Parts that begin at the same sample are applied in part-number order, and a
ramp begins at the target value of a set at the same sample. The bass swap (parts 4 and 5) is an opposing EQ ramp over bar 8 of the transition (beat 476 to 480); I1 holds because A falls below −12 dB (at 40 % of the bar) before B rises above it (at 60 %). Part 9 interpolates per §1.2 down to −60 dB and then mutes (the check ran to −80 dB; difference only below −40 dB, calculated, not measured). Parts 11 to 13 reset A's EQ to 0 after the stop (not in the check; A is then muted).

### 14.2 Choice

`{"id":"w9","von":"cypher","material_id":"3fa1c09b2e7d4410","spielart":"sicher","start_takt":113,"hoerschein":"h12",
"einstieg_quell_beat":64.0,"deck":2,"laenge_takte":16,"absicht":"B mit warmem Bass unter das Outro von A"}`

`einstieg_quell_beat`: where B sits in the material when faded in (default: candidate, §14.6). Rule: the pre-listening starts B **at the entry**; the plan starts B again at the entry at S (deck part `start`). The listening pass thus covers sync, level and exactly the section that is heard at S. Golden sequence `einstieg` (§19.3).

### 14.3 Suggestion

`{"id":"v5","plan_id":"p17","text":"T 113: Nightshift rein, sicher 16 T, Basstausch T 121","start_beat":448.0,
"verfaellt_beat":444.0,"kanal":"deck/2"}`

### 14.4 Style (parameter set and rule)

| Field | Unit | "safe" | "hard" |
|---|---|---|---|
| `name` | | `sicher` | `hart` |
| `takte` (N) | bars | 16 | 4 |
| `verlauf` | `linear` \| `kante` | linear | kante |
| `einstieg_db` (E) | dB (B fader at the start of bar 1) | −15 | 0 |
| `rampe_takte` (R) | bars | 8 | 0 |
| `basstausch_takt` (m) | first bar, at whose start B has the bass open (1-based) | 9 | 3 |
| `a_raus_ab_takt` (a) | first bar, at whose start A's fader is below 0 dB | 13 | 3 |
| `grenze_sub` | overlap 0 to 1, **locking** | 0.10 | 0.25 |
| `grenze_tief` | overlap 0 to 1, **warning only until M20** | 0.20 | 0.35 |
| `pump_db` (P) | dB | 0 | 0 |

**Rule (normative; exactly the measured rule of thumb `saat()` from `proben/08-analyse-passung/probe_b_uebergang.py` lines 219 to 228 with the values at lines 241 to 252, 0-based there, 1-based here).** Per control, one anchor value at the start of each transition bar t = 1 … N and an end value at the start of bar N + 1. `verlauf = linear`: between two anchor values linear in dB across the bar (one `/k/teil` with `dauer_beats` = bar length per segment of unequal neighbors; uniform sequences may be merged into one ramp). `verlauf = kante`: the anchor value holds for the whole bar, change at the bar boundary with the control's switch ramp (check: 10 ms).

| Control | Anchor value in bar t | End value (start of bar N + 1) |
|---|---|---|
| B fader | E · (1 − u) + P · u with u = min(1, (t − 1)/max(1, R)) | P |
| B EQ low | −30 dB for t < m (set one beat before S, I1 via the switch ramp, §17), 0 dB from t = m | 0 |
| B EQ mid, high | 0 | 0 |
| A EQ low | 0 for t < m, −30 dB from t = m | stays; after A is muted, to 0 (contract addendum) |
| A EQ mid, high | −30 · min(1, max(0, t − 1 − N/2) / (N/2)) dB | stays; after A is muted, to 0 |
| A fader | 0 for t < a, −40 · (t − a + 1)/(N − a + 1) dB from t = a | muted (check −80 dB, contract −200 per §1.2) |

For "safe" this means: B fader −15 dB linear to 0 dB up to the start of bar 9; B's bass −30 dB until bar 8, swapped with A's bass oppositely across bar 8; A's mids and highs linear from bar 9 to −26.25 dB at the start of bar 16; A's fader linear from bar 12 to −40 dB at the start of bar 16, then muted. For "hard" this means: B full from bar 1 with bass off, bass swap at the boundary to bar 3, A's mids and highs −15 dB in bar 4, A's fader −20 dB in bar 3 and −40 dB in bar 4, then muted. Example plan: §14.1.

**Measured** (08 NP K1, on the rendered audio of the only pair Message/MFB): "safe" sub 0,082, low **0.402**, low-mid 0,951, loudness 1.29 LU; "hard" sub 0,015, low **0.355**, low-mid 0,860, 1.61 LU. The rule holds the sub limits, not the low limits: that is why until M20 only `grenze_sub` (§11) locks. Deviating curves (kill instead of EQ, S-curves, A to −200 in one move) count as "measured" only after recalculation with `probe_b_robust.py`. Genre styles (psytrance, drum and bass, deep house, house, schranz, disco) as starting values from 08 §3.3.4, guess, same rule. Golden sequence `expandiere_sicher` (§19.3): choice in, exactly the parts from §14.1 out.

**Addendum M20 (2026-09-25, `messungen/M20-faustregel/BERICHT.md`):** With the variant `kante_mitten` (bass swap as an edge, plus B mids off), "hard" holds the sub and low limit in 12 of 12 runs (low max 0,090, bass hole as the rule −3.5 dB); the rule as written breaks for "hard" at `message_purist` with keylock (low 0.355 at 0.35). For "safe" no variant holds in 12 of 12. Adopting it into the rule above and `grenzen_tief_verriegeln = true` for "hard" only after the listening session M18 (sound of the edge by ear unchecked).

### 14.5 Listening check (Hörschein)

```json
{"id":"h12","kanal":"deck/2","inhalt":"3fa1c09b2e7d4410/128000_r1","deck":2,"bpm":128.0,
 "gemessen_von_beat":428.0,"gemessen_bis_beat":444.0,"gueltig_bis_beat":508.0,
 "quell_von":64.0,"quell_bis":136.0,"erneuerung":14,
 "sync_ms":0.8,"deck_gegen_deck_ms":3.1,"flam_anteil":0.04,"lufs_kurz":-9.8,"pegel_diff_db":-1.2,
 "baender_db":[-28.3,-29.3,-28.6,-31.5,-28.2,-24.9],"urteil":"ok","gruende":[]}
```

`urteil` ∈ `ok` \| `zu_laut` \| `zu_leise` \| `nicht_sync` \| `unsicher`. `gueltig_bis_beat` = `gemessen_bis_beat` +
64 (set). Only `ok` is registered with the core.

**Renewal:** after the first 4 bars, the analysis sends the same listening check after **every further bar** (same
`hs_id`, `erneuerung` + 1) over the sliding 4-bar window, as long as the channel runs in sync, also after it
is open; the core replaces the old one (§4.5). If a renewal is not `ok`, the analysis sends `/k/hoerschein/weg`.
This way a listening check does not expire at the start, even if a plan moves to the next phrase or Andreas accepts late
(example: measurement from beat 372, last renewal before S = 448 up to beat 444, valid until 508; the old version expired
exactly at S). `quell_von` is the source beat at the start of the uninterrupted measurement, `quell_bis` the one at the end; a
jump in the deck starts the range anew.

**Deck against deck is mandatory** for material with `herkunft.art = minimax`: `ok` only if the low-band hits
against the running deck have a median ≤ 8 ms (at least 8 pairs in 4 bars); if no partner runs or the
hits are not enough, the verdict is `unsicher` (then only Andreas' hand). Reason: the offset against the reference does not see a
wrong grid (08 NP K4).

### 14.6 Fit and candidate

Fit (fields as in 08 §5): `{"a":..,"b":..,"trim_b_db":-9.68,"verschiebung_beats":0.192,
"ueberdeckung":{"sub":0.639,"tief":..,"tiefmitte":..,"mitte":..,"praesenz":..,"hoch":..},
"kollision_30ms":{"tief":{"rate":0.611,"flam_anteil":0.121,"je_takt":4.12}},
"tonart":{"camelot_abstand":0,"chroma_kosinus":0.986},"stimmung_differenz_cent":18.4,
"stretch_zur_basis_prozent":{"a":0.0,"b":0.0}}`.
Candidate: `{"material_id":..,"titel":..,"fassung":"128000_r1","einstieg_quell_beat":64.0,"passung":{Passung},"spielarten":[{"name":"sicher","takte":16,
"vorhersage":{"ueberdeckung_max":{"sub":0.08,"tief":0.19},"lufs_abw_max_lu":0.9},"ok":true}],"empfehlung":"sicher",
"nur_fuer_andreas":false}`.

### 14.7 Bar state (situation)

```json
{"takt":57,"phrase":8,"beat":224.0,"bpm":128.0,"set_basis_bpm":128.0,"autonomie":1,"ki_gestoppt":false,
 "decks":[{"deck":1,"material_id":"...","titel":"Message","status":"laeuft","hoerbar":true,"quell_beat":210.0,
           "beats_bis_ende":288.0,"ende_takt":129,"struktur_jetzt":"drop","loop":null,"hoerweg":"direkt",
           "fader_db":0.0,"lufs_m":-9.1,"baender_db":[..6],"versatz_ms":0.3,"halter":{"deck/1/fader":"frei"}}],
 "erzeuger":[],
 "plaene":[{"id":"p17","quelle":"cypher","status":"wartet|laeuft|teilweise|fertig|verriegelt","teile":["wartet","laeuft"]}],
 "vorschlaege":[{"id":"v5","verfaellt_takt":112}],
 "hoerscheine":[{"id":"h12","kanal":"deck/2","gueltig_bis_takt":117,"urteil":"ok"}],
 "fristen":[{"deck":1,"ende_takt":129,"rest_takte":72}],
 "bericht_vorher":{Takt-Bericht},
 "auftraege":[{"auftrag_id":"a7","art":"generieren","stand":"laeuft","erwartet_fertig_takt":190}],
 "neu_in_kiste":["3fa1c09b2e7d4410"],
 "ereignisse_seit":[{"art":"hand","pfad":"deck/1/eq/tief","wert":-8.0,"takt":56}]}
```

### 14.8 Bar report (analysis → control desk, at the end of each bar)

```json
{"takt":9,"phrase":2,"frist_takte":7,
 "decks":[{"deck":1,"baender_db":[-41.8,-42.2,-35.5,-32.0,-24.3,-29.4],"versatz_ms":0.0,"lufs_takt":-18.9},
          {"deck":2,"baender_db":[-28.3,-29.3,-28.6,-31.5,-28.2,-24.9],"versatz_ms":0.0,"lufs_takt":-18.8}],
 "deck_gegen_deck":{"paar":[1,2],"median_ms":1.2,"flam_anteil":0.05,"n":8},
 "ueberdeckung":{"sub":0.136,"tief":0.178,"tiefmitte":0.499,"mitte":0.559,"praesenz":0.362,"hoch":0.525},
 "summe":{"lufs_takt":-18.7,"spitze_dbfs":-7.2},
 "plan_abweichung":{"plan_id":"p17","ueberdeckung_max":0.02,"lufs_lu":0.1}}
```

Bands in the order Sub 30 to 90, Low 90 to 250, Low-mid 250 to 800, Mid 800 to 2000, Presence 2000
to 6000, High 6000 to 16000 Hz (08 §3.3.1), computed from `band[0..5]` of the envelope ring (§6.2). Offset against
reference: cross-correlation of the deck envelope (§6.2) with `huelle_1khz.npy` (§13.1, same filters and the same RMS window) at the audible position, search window ±200 ms, band with the highest correlation (08 §3.3.6).

### 14.9 Verdict

`{"id":"u3","art":"gut|daneben|ab","bezug":{"plan_id":"p17"},"gewinner":null,"sample":7200000,"von":"andreas"}`

---

## 15. Journal and recording

- **Journal** `~/cypher-dj/sets/djk/<set_id>/journal.jsonl`, one line per event:
  `{"sample":..,"beat":..,"takt":..,"mono_ns":..,"von":"kern|leitstand|spieler|analyse|werkstatt|notbahn|andreas",
  "typ":"...","daten":{...}}`. Mandatory: every command to the core with all fields, every receipt, every hand and key message,
  every plan, every choice with the response time of the move, every listening check, every bar report, every verdict,
  every fallback-path and gap message (mandatory list of mode `voll`, see Journal mode). The first lines: `{"typ":"set_start","daten":{"set_id","generation","vertrag":1,
  "konfiguration":{...}}}`.
- **Journal mode.** The key `journal` of `leitstand.toml` (§2.1) or the option `--journal voll|schlank` of the leitstand and of `djk-start` (the option
  wins) chooses what the leitstand writes. The mode is written into the `set_start` and `fortsetzung` lines as `daten.journal` (absent: `voll`).
  - `voll` (default; every test and check tool): the lines the list above names, all of them.
  - `schlank` (lean; the production start of `djk-start` without `--instanz`): the same journal without the lines that say nothing new. Only the
    journal differs; the leitstand's logic, the web socket and the displayed state see every message as in `voll`.

  | Line | `schlank` writes it |
  |---|---|
  | `/k/led`, `/k/vorschlag_kanal` sent by the leitstand | never (the commands are state the core already has; a new core generation or a reconnect still sends them once, they are just not journaled) |
  | `/k/hallo`, `/k/willkommen` | when the generation differs from the last journaled line of that type, or that line is older than 60 s (this keeps the file's modification time alive for resuming a set) |
  | `/q` from the core | when the status is not 1, 2 or 3, or `grund` is not empty, or the receipt belongs to a plan part or an awaited command of the leitstand itself; so every refusal (4, 6, 7, 8), every late execution (5) and every receipt the leitstand waits for stays |
  | `/erz/quittung` | when one of `verworfen`, `verworfen_anderes_muster`, `zu_spaet`, `ungehoert` is not 0 |
  | `/zustand/arr`, `/zustand/warp`, `/zustand/rec`, `/zustand/spur_pool`, `/zustand/hall_pool`, `/zustand/ins_host`, `/nb` | when the data differ from the last journaled line of the same type, compared without `projekt_beat` (arr, rec), without `blocks_parallel`, `einheiten_worker`, `einheiten_caller`, `seriell_summe`, `zurueck` (spur_pool; `spaet` is compared) and without `w` (nb). The first line of each type after a leitstand start is always written |
  | every other line (commands to the core, `/takt`, hand, plans, choices, verdicts, `/e/*`, ...) | always |

  The evaluation `djk/conductor/check/evaluation.ts` counts receipts and bar messages, so it refuses a journal with `journal: "schlank"` in its
  `set_start` or a `fortsetzung` line (message, exit code 2). A set journaled lean resumes like a full one.
- **Recording** `aufnahme.f32` (float32, 4 channels interleaved: master L/R, cue L/R, 48 kHz) and `aufnahme.json`:
  `{"erstes_kern_sample":..,"notbahn_versatz_samples":512,"frames":..,"luecken":[[frame,anzahl],...]}`. The first frame
  corresponds to core sample `erstes_kern_sample` (fallback-path offset included).

---

## 16. Errors and lateness

### 16.1 Policy per command type

| Command | Default policy | late means |
|---|---|---|
| `/k/teil` from a plan (fade-ins, ramps) | 0 `musik` | discarded, receipt 4; the control desk gets a move trigger |
| `/k/teil` fade-out, kill on, fader down, stop follow-ups | 1 `zustand` | at the next cycle with switching ramp, or remaining ramp to the unchanged end beat, receipt 5 |
| `/k/deck/start` from a plan | 0 | discarded |
| `/k/deck/stopp` | 1 | at the next cycle (a stop from a plan additionally waits as long as it would hit the last audible channel, I2) |
| `/k/deck/loop`, `/roll`, `/sprung`, `/hotcue` from Andreas' macro | 2 `raster` | next reachable grid point of size `raster_beats` |
| the same from Cypher's plan | 0 | discarded |
| `/k/tempo/rampe` | fixed | start at the next cycle, end beat unchanged |
| `/erz/ev` | fixed | not played, counted as `zu_spaet` |
| Hand (MIDI) | | never late: takes effect one period after sending |

"Exact or reported": no command sounds silently at a place other than its target sample (02 NP N2).

### 16.2 Reasons (codes)

| Code | from | Meaning |
|---|---|---|
| `zu_spaet` | core, control desk | target sample passed (with `fruehestens_beat` in the control desk) |
| `regler_beim_menschen` | core, control desk | holder `mensch` |
| `regler_verplant`, `ueberlappung` | core, control desk | an accepted part holds the control in the same period (I4) |
| `nur_hand` | core | path only for the hand |
| `nur_andreas` | core, control desk | the action is Andreas' own: overriding a lane (`/k/arr/auto` with `an 0` from `cypher`, §4.11), changing devices (page API), arming a track (`/k/arr/arm` from any source but `andreas`, §4.11) |
| `auto_ziel_unbekannt` | Kern | `/k/arr/auto` (§4.11): `ziel` is none of `fader`, `pan`, `mute`, `solo` (automation slice 3) |
| `laeuft` | Kern | `/e/ins_mess` (§5.13): the transport is not stopped (plan 1.11 T5) |
| `host_fehlt` | Kern | `/e/ins_mess` (§5.13): the effect host is not healthy or has no ports (plan 1.11 T5). The playback loader uses the same word as a token inside the reason `format` (a core without the host ports, §4.11), not as a reason of its own |
| `kein_rueckweg` | Kern | `/e/ins_mess` (§5.13): no return within 16384 samples after the impulse (plan 1.11 T5) |
| `belegt` | Kern | `/k/arr/export_lauf` (§4.11): a recording, a freeze, a tap or another export runs (plan 1.11 T12) |
| `schreiber_ueberlauf` | Kern | `/e/export_lauf` (§5.13): the writer thread of the export fell behind and the ring (about 5 s) was full; the run ended and the file was removed (plan 1.11 T12) |
| `unbekannter_regler`, `unbekanntes_deck` | core | path or deck does not exist |
| `ausserhalb_bereich` | core | value outside §1.5 |
| `kein_hoerschein`, `hoerschein_anderer_kanal`, `hoerschein_anderer_inhalt`, `hoerschein_anderes_tempo`, `hoerschein_abgelaufen`, `hoerschein_anderer_abschnitt` | core, control desk | I3a, I3b (section: source position at `ab_beat` outside `[quell_von, quell_bis + 64]`) |
| `ziel_ungehoert` | core, control desk | I3d: Cypher's jump or hot cue on an open deck to a target without listening-check coverage and without `annahme:` |
| `keine_stems` | core | `stem/*` on a deck without loaded stems |
| `hoerschein_nicht_sync`, `hoerschein_pegel` | control desk | listening-check verdict not `ok` |
| `invariante_sub_doppelt`, `invariante_master_leer` | core | I1, I2 |
| `deck_beruehrt` | core, control desk | Andreas' deck holder |
| `deck_hoerbar`, `deck_laeuft`, `nicht_geladen` | core | state of the deck |
| `material_fehlt`, `pruefung`, `budget_speicher` | core | loading |
| `budget_stretcher` | control desk | more than 4 real-time stretchers [PRELIMINARY, 2026-09-23 13:3x: the re-check of dossier 01 measures R3 in FIFO work threads with lead-in, with 8 per thread without underrun (16 on 2 and 32 on 4 threads, limit only at 16 per thread; SCHED_OTHER instead of FIFO: 23 underruns). The limit is decided by M3 (slice 30).] |
| `karte_voll` | core | tempo map full |
| `tempo_rampe` | core | `/k/arr/freeze` and `/k/arr/abgriff` (§4.11, D1 spec 6.33): a ramp is open in the tempo plan (accepted, entry at the next bar one still off, or running); also `/k/tempo/rampe` while a recording waits, counts in or runs (`/zustand/rec` status not 0, §4.12) |
| `ki_gestoppt` | core, control desk | stop button active |
| `rechner_fehlt` | control desk | planner not reachable |
| `kein_stretcher` | core | roll type 1 (behind the keylock); tempo change and start at foreign tempo only up to wave 2 (ADR 028) |
| `autonomie` | control desk | level does not allow it |
| `grenze_sub` | control desk | prediction of a choice exceeds `grenze_sub` (§11, `vorhersage` `grenzen_ok`; dossier 09 V4) |
| `neustart` | control desk | part lost through core restart, reason from `teil_abgebrochen` (§16.3) |
| `form` | core, control desk, MCP | input violates the schema (core: since ear (Ohr) T12 `inhalt` in `/k/hoerschein`, §4.5) |
| `datei_fehlt`, `format`, `audio_fehlt`, `zu_gross`, `spur_bereich` | core | `/k/arr/laden` (§4.11): playback file missing, violates the format, an audio is missing, budget or limit (32 tracks, 4096 clips, 65 536 notes) exceeded, track number or slot out of range; `spur_bereich` also `/k/arr/note` (`spur` outside 1 to 32) |
| `warp_maschine_fehlt` | core | `/k/arr/laden` (§4.11): the playback contains a warp clip with `modus` 2 (COMPLEX) or 3 (TONES), the core is built without Bungee (`CYPHERDJ_BUNGEE` off); the previous playback keeps playing (package 1.13 slice 2) |
| `reserviert` | core | `erz/4` belongs to production (§4.11): `/erz/strom` with target `erz/4`, edges to `rueck_erz_4` |
| `hand`, `abbruch`, `ki_stopp` | core | abort reason |
| `kein_eingang` | core | `/k/rec/spur` armed without input, `/k/rec/start` without an armed audio track and without an armed MIDI track (§4.12); `/k/kanal/graph` (graph without node `eingang`, §4.10) |
| `aufnahme_laeuft` | core | `/k/rec/spur` or `/k/rec/start` during a take (§4.12) |
| `zu_viele_scharf` | core | more than 8 tracks armed (§4.12) |
| `eingang_fehlt` | core | input 20 (master before the fader) is not yet a tap; 1 to 4 are since slice 2, 30 (`midi_ein_1`) since slice 5 (§4.12) |
| `kein_platz` | core | take writing: the disk was full, what had been written so far remains (`/e/aufnahme` status 3 and companion file) |
| `unbekannte_adresse`, `falsche_typen`, `protokoll` | core | protocol error |

### 16.3 Failure of a partner

- Core gone (no `/uhr` for 100 ms): the control station (Leitstand) holds all submissions, sends `/k/hallo` immediately and then every 50 ms until `/k/willkommen` (§4.1), reports `ereignis` `neustart` as soon as `/e/neustart` arrives, then does **not** automatically resend the open listening passs and waiting plans (the core has them from its state), but reconciles via the `/q/stand` reports and the following `/q` receipts. Commands for which there is neither `/q/stand` nor an end receipt already before the restart (`fertig`, `abgebrochen`, `verspaetet_*`, `abgelehnt`, `storniert`) count as lost and are reported as `ereignis` `teil_abgebrochen` (reason `neustart`); they are re-planned in the next turn.
- Control station gone: core keeps playing; accepted parts run to the end; the controller keeps acting; the crate stays as it is.
- Analysis gone: no new listening passs; running ones remain valid until `gueltig_bis_beat`.
- Planner gone: `waehle` answers `abgelehnt` with `rechner_fehlt`; `plan_einreichen` continues (without prediction, warning in the journal).
- Player gone: turn requests run into `zeitueberschreitung`; deadline watchdog in the core.

---

## 17. Invariants and deadline watchdogs (core)

Checked before every part start and every deck part, in every cycle in which a plan part moves one of the controls `fader`, `trim`, `kill/tief`, `eq/tief`, `stem/bass` or the crossfader weight of a channel, at every shot and every generator event on an open channel, and after every hand grab. The hand (MIDI) is never blocked.

- **I1 sub never doubled:** checked with the value the control actually has in this cycle, i.e. via the switch ramp of a set (192 samples), not only with its target value (Andreas 2026-09-25, reading n: "hard"). If after this cycle `tief_offen` would hold for two channels and a plan part (not the hand) has opened at least one of them, the core aborts that part and its group (value stays at the actual value), receipt 7 with `invariante_sub_doppelt`, `/e/invariante`.
- **I2 master never empty:** if a plan part or a deck stop from a plan would make the last audible channel inaudible, the part holds at the actual value, or the stop waits (status stays `gestartet` or `angenommen`), until another channel is audible; then the part continues with its unchanged end beat (if the end has passed: switch ramp), and the stop is executed. `/e/invariante` `master_leer` on halting. Because `hörbar` for decks requires "running" (§1.6), a halted or locked never-started deck B does not count as audible: I2 then holds "A raus" back, and the deadline watchdog takes effect for A.
- **I3 new content only with a listening pass** (A4: "the conductor must never play anything unheard"). A listening pass is valid if channel and `inhalt` match (§4.5), `beat ≤ gueltig_bis_beat`, and `|bpm_jetzt/bpm_messung − 1| ≤ 0,005`.
  - **I3a Opening:** a plan part that **opens** a closed channel (§1.6 `offen`, i.e. trim plus fader, independent of bus, crossfader and master) needs a valid listening pass for this channel in `hoerschein`; for decks the source position at `ab_beat` must additionally lie in `[quell_von, quell_bis + 64]`. Generator channels `erz/*` are exempt (Andreas 2026-09-29): their content is Cypher's own pattern. The core only holds Stop Cypher there; AUTO is held by the page server (409 `auto_aus` for Cypher's `/spur` and `/regler` on `erz/<n>`, `wirt:<gruppe>`, `strom:<n>`), Stop Cypher there additionally host and pattern runs.
    Likewise pad channels `pad/*` (Andreas 2026-10-05: "you should be able to control all these faders yourself"): the core opens them without a listening pass; whether the box content is Cypher's own recording is checked by the page (409 `kein_hoerschein`, `server.ts` `eigenePad`). Deck channels stay locked, with one exception.
    Exception: a deck channel with nothing loaded (Andreas 2026-11-18, SEQ deck: the track deck is empty and the channel carries the SEQ deck, so there is nothing to listen to): the core opens `deck/<n>/fader` and `deck/<n>/trim` for Cypher without a listening pass while the deck holds no track (`DeckModell::inhalt` empty). The core cannot tell a SEQ deck from an empty one; the page narrows the exemption to a place that carries a SEQ deck and no loaded track (409 `kein_hoerschein`, `server.ts` `seqDeckFrei`). The rule is checked when a part starts, so a part queued on an empty deck whose track arrives before its start is refused (`kein_hoerschein`), and a track load sets the deck fader to -200 and ends the RUNNING parts on that fader of every source but `andreas` (grund `abbruch`; the I3a exemption covers all of them, and the part ends with its coupling group (a group falls together, field 11 of `/k/teil`)), so a ramp that began on the empty deck cannot reopen the loaded track. A deck with a loaded track stays locked.
  - **I3b Pad:** a `/k/schuss` (source not equal to `andreas`) on an open pad needs a valid listening pass with exactly this shot (§4.6).
  - **I3c Generator:** events of a pattern on an open generator channel play only with a valid listening pass `muster/<m>` for this channel, otherwise `ungehoert` (§4.8).
  - **I3d Jump:** a `sprung` or `hotcue` with source `cypher` on an open deck needs a target in `[quell_von, quell_bis + 64]` of a valid listening pass for this deck, or `hoerschein` = `annahme:<vorschlag_id>` (Andreas accepted); otherwise `ziel_ungehoert`. Loop and roll bring no new content (they repeat what was heard, or return to moving on) and are free.
  Otherwise at start `abgelehnt` with the matching reason (§16.2).
- **Order:** parts that begin at the same sample are applied in part-number order; the invariants check the state **after** all parts of this sample (so a bass swap is valid as a pair).
- **I4 no overlap:** a part whose `[ab_beat, ab_beat + dauer_beats)` cuts an accepted part on the same control is rejected when slotted in (`ueberlappung`), also within one plan; a set (duration 0) at the same beat as a following ramp is allowed (order by part number).
- **Deadline watchdog:** if a running deck is the only audible channel (§1.6, other decks count only if they run), without a loop, with `beats_bis_ende < 32`, and no accepted part makes another channel audible before the end, the core sets a loop over `[q0, q0 + 16)` with `q0 = e + floor((Q_ende − e − 16)/16)·16` and `e` = `erste_eins_quell_beat` of the version (last full 16 source beats, on bar one), reports `/e/rueckfall` (an = 1) and sets the LED `rueckfall`. Every grab or command on this deck ends the fallback (`/e/rueckfall` an = 0); only an **executed** stop with source `andreas` or Andreas' play button suppresses it for this material. A stop from a plan that waits because of I2 suppresses nothing.

---

## 18. State stream per bar

1. In the cycle with the start of the bar, the core sends `/takt`.
2. The analysis evaluates the completed bar from the envelopes and sends `takt_bericht` at the latest 100 ms after the start of the bar (measured: end-of-bar evaluation in Python max 34.8 ms under load 50, 08 §4.f).
3. The control station sends `takt` (§14.7) to everyone at the latest 150 ms after the start of the bar, with the report of the previous bar; if the report is missing, without it (`bericht_vorher: null`).
4. The LLM receives the bar state only in turn requests and via `lage`/`warte`, never as a stream.
5. Fast data (level 20 Hz, deck 50 Hz, clock per cycle) go only to subscribers of the core (control station, analysis, display via the control station).

---

## 19. Conformance: how two sessions build independently

0. **Work item V0 "contract as code"** (before K1 and L1, roughly half a session day, **one** owner; K1, L1, W1 only read `djk/contract/`):
   - `djk/contract/osc.json`: every address from §4, §5 with type string, field names, units, ranges; from this `osc_addresses.h` and `osc_addresses.ts` are generated (generator script in the same folder, test: text against `osc.json`).
   - JSON schemas for §9 to §15 (WS envelope, MCP tools, planner, workshop, `material.json`, `fassung.json`, plan, choice, listening pass, bar state, bar report, journal) and for the TOML keys from §2.1.
   - `baender.json`: coefficients of the six analysis bands (§6.2), shared by core, workshop and ring mock.
   - **Format of the golden sequences** `folgen/<name>.jsonl`, one line per step: `{"t":"sende","sample":…,"osc":[adresse,
     typen, …werte]}`, `{"t":"hand","sample":…,"pfad":…,"midi_roh":0..1}`, `{"t":"erwarte","bis_sample":…,"osc":[…]}`
     (receipt, event), `{"t":"wert","sample":…,"pfad":…,"wert":…,"toleranz":…}`.
   - **Test hand input** `/test/hand ,sfh` (`pfad`, `midi_roh` 0 to 1, `sample`): acts like a MIDI event on the controller, including the first value only as position and dead zone 3/128; the real core accepts it only with `pruefmodus = true` or `hand_osc = true` (otherwise `/e/protokollfehler`), mock and test bench always. Besides the controls of the Stellwerk (interlocking), `deck/<n>/play` and `deck/<n>/cue` are valid `pfad` (slice 35): `midi_roh` from 0.5 is the press of the deck key, below it the release; it acts like the controller's key (§7.3 points 5 and 6, quantisation `beat`) at the sample, at the earliest at the block start of the cycle in which the command arrives. Likewise `taste/<name>` with the names from §5.8 without the encoder values (`autonomie`, `spielart`, `laenge`, `kiste_wahl`): `midi_roh` from 0.5 is the press; the core reports from it the same `/e/taste` (`name`, `wert` 1, `sample`, `beat`) as for the controller's key (the stop key acts like `/k/ki/stopp`), below it the release without report; another name is `unbekannter_regler`. Since D1 also `arr/start_stopp` (§7.2): `midi_roh` from 0.5 is the press; the core reports `/e/hand` and switches the transport of the arrangement.
   - **Test click** (roadmap Z1) `/test/klick ,hssi`: `id`, `quelle`, `kanal` (`master` or a channel from §1.5), `an` (0 or 1). Only with `pruefmodus = true` (in slice 01 the call parameter `--pruefmodus`), otherwise `/e/protokollfehler`. From the next beat on, the core writes per beat a short click to the input of `kanal` (before trim; for `master` into the sum before the limiter), onset exactly at `llround(sample_at(b))` for whole `b`, beat 1 of the bar with a different level; click shape like `proben/01-audio-kern/a-cpp-jack/klick_kern.cpp`, so that `analyse_klick.py` measures it. Receipt `/q` with status 2 at the first click. Until slice 25 only `master`; other channels `abgelehnt` with reason `unbekannter_regler`. Purpose: a known signal for every acceptance check at the target, as long as no decks exist.
   - **Check instances** (roadmap Z2): environment variable `CYPHERDJ_INSTANZ`, default empty. If it is set (lowercase letter of the strand, `a` to `i`), in every fixed path from §2, §2.1 and §6 the component `cypherdj/` becomes `cypherdj-<instanz>/` (e.g. `/dev/shm/cypherdj-a/bus`, `~/.config/cypherdj-a/kern.toml`, `$XDG_RUNTIME_DIR/cypherdj-a/rechner.sock`), every JACK client name and every transient unit gets `-<instanz>` (`cypherdj-kern-a`), and all ports from §2 shift by 1000·k (k = 1 for `a` to 9 for `i`; core UDP of strand A thus 48100). Check sinks are called `cypherdj-pruef-<instanz>-<lauf>` and thereby satisfy the safety lock (§8). The empty instance (k = 0) belongs to the milestone sessions and the main instance. The inventory `~/cypher-dj/bestand/` stays shared; check runs that would write into the inventory set `bestand` in their `werkstatt.toml` to a folder of their own.
   - **Ring mock** `mock_hulls.py`: writes `/dev/shm/cypherdj/huellen` (§6.2) from WAV files per channel, with the filters from `baender.json`, at real-time pace; counterpart for analysis and listening pass as long as the core is missing.
1. **Core mock** (`djk/contract/mock_core.mjs`, work item L1): speaks §4 and §5 completely with a simulated clock in real time (tempo card per §1.3), runs parts and deck parts on a simulated control and deck table, checks I1 to I4 and the deadline watchdog, accepts `/test/hand`, writes no sound. The control station is built against it.
2. **Control station mock** (`djk/contract/mock_conductor.py`, work item K1): sends command sequences from `djk/contract/sequences/*.jsonl` to the core and checks the receipts. The core is built against it.
3. **Golden sequences** (mandatory, each with an expected receipt and value sequence; each sequence runs against mock and core):
   - `uhr_golden`: values from §1.3 (recalculated 2026-09-23: 3 237 188.004 / 3 588 923.077 / 4 287 104.895).
   - `teil_rampe`: `/k/teil` `deck/2/fader` from −15 dB to 0 dB, `ab_beat` 64, `dauer_beats` 32 at 128 BPM → start at sample 1 440 000, end at sample 2 160 000, value at beat 80 (sample 1 800 000) = −7.5 dB.
   - `hand_gewinnt`: the same ramp; `/test/hand` on `deck/2/fader` with `midi_roh` 0.5 at sample 1 500 000 (position only, no effect), then 0.5 + 4/128 at sample 1 620 000 (above the dead zone) → receipt 7 `hand` with `ist_sample` 1 620 000, holder `mensch`, a second part of group `b_rein` likewise aborted, a part of another group keeps running (09 check b as model).
   - `zu_spaet`: part with `ab_beat` in the past, policy 0 → receipt 4; policy 1 → receipt 5 with `ist_sample` = next block start.
   - `sub_doppelt` and `master_leer`: the cases a1 and a2 from `proben/09-ki-steuerung/nachpruefung/angriff.mjs`.
   - `hotcue_phase`: deck at source beat 37,30, hotcue 64.00 → target 64.30.
   - `rueckfall`: deck as the only audible channel, 96 beats of material, `erste_eins_quell_beat` 0, no plan → loop `[80, 96)` set as soon as `beats_bis_ende < 32`.
   - `laden`, `start_quell_beat` (at `ab_beat` exactly `quell_beat` sounds), `loop`, `roll` (return to the shadow position), `sprung` (also in the loop), `politik_raster` (too late → next grid point of size `raster_beats`), `storno`, `ki_stopp` (all `cypher` parts off, no fader lowered (E-a), then `ki_gestoppt`), `i4_ueberlappung`, `protokollfehler` (unknown address, wrong types).
   - `i3_gruende`: one case each for `kein_hoerschein`, `hoerschein_anderer_kanal`, `hoerschein_anderer_inhalt`, `hoerschein_anderes_tempo`, `hoerschein_abgelaufen`, `hoerschein_anderer_abschnitt`, `ziel_ungehoert`; `hoerschein_rand`: start exactly at `gueltig_bis_beat` → accepted, one beat later → expired; `crossfader_luecke`: plan raises a fader behind a closed crossfader without a listening pass → rejected; `pad_ungehoert`, `muster_ungehoert` (counter `ungehoert` in `/erz/quittung`).
   - `b_verriegelt_a_laeuft_aus`: B locked at the start (no listening pass), A runs out → I2 holds "A raus" (A out), the deadline watchdog sets the fallback loop on A, no silence.
   - `hand_stoppt_a_raus`: hand grab on A's fader during "A raus" → group `a_raus` including the deck stop falls, A keeps running.
   - `neustart`: `kill -9` between part start and part end of `teil_rampe` → `/e/neustart` to the stored subscriber, `/q/stand` for the running part after `/k/hallo`, ramp ends at the unchanged end beat.
   - `einstieg`: pre-listening from the entry, plan with deck part `start` at S → I3a checks the source position, the listening pass covers it.
   - `autonomie_1_eq` (control station against mock): level 1, plan with one EQ part on an audible deck → `vorgeschlagen` (suggested), no `/k/teil` to the core.
   - `expandiere_sicher` (planner): choice in, exactly the parts from §14.1 out.
   - `notbahn_124`, `notbahn_rampe` (test bench, silent): core crash at fixed base 124 and during a ramp → the loop is one master bar long, the return to the core lies on the grid (limit as ARCHITECTURE §7).
4. **Build dependencies on the DJ machine** (checked 2026-09-23, `pkg-config`): rubberband 3.3.0, jack 1.9.21, sndfile 1.2.2, samplerate 0.2.2, fftw3/fftw3f 3.3.10, lilv-0 0.24.22, alsa 1.2.11, aubio 0.4.9; g++ 13.3, CMake 3.28.3, Ninja 1.11.1, Faust 2.70.3, Node 22.23.2, Python 3.12.3. **Missing** (measured 2026-09-23: `pkg-config` does not find liblo, libsystemd, nlohmann_json, tomlplusplus, gtest, catch2; `/usr/include/{nlohmann,toml++,gtest,catch2,lo,systemd}` missing; counter-check rubberband, jack, sndfile found). Decision for V0 and K1:
   - **libebur128** (MIT, `ebur128.c` plus `queue/`, commit 67b33ab): copy the source to `djk/third_party/libebur128/` and compile it in (today only under `proben/04-mixer-effekte/vendor/`, there excluded from git via `.gitignore`).
   - **JSON** (`kiste.json`, mapping, `fassung.json`): nlohmann/json as a pinned single header (MIT) under `djk/third_party/`; **TOML** (`kern.toml`): toml++ as a pinned single header (MIT) likewise. The Notbahn (fallback path, C) reads no file (§8).
   - **sd_notify** (`Type=notify`, watchdog): our own, about 20 lines like `proben/10-robustheit-betrieb/src/minikern.c` lines 56 to 60 (`NOTIFY_SOCKET`); no libsystemd.
   - **OSC** encode and decode: our own, like `proben/02-uhr-sync-planer/kern/uhrkern.cpp` lines 322 ff. and `absender.mjs`; no liblo.
   - **C++ tests**: CTest with our own assert header, plus an ASan/UBSan build in test operation.
   - **Bungee** only in slice 5: pinned clone (commit 8cb6977) with build script under `djk/third_party/bungee/` (needs CMake ≥ 3.30, locally 3.28: built by hand like `proben/03-deck-engine/build.sh`).
   - **Workshop Python**: the proben venv `proben/07-werkstatt-zerleger/venv` is not fit for the workshop (torch 2.5.1+cpu, `torch.version.cuda` None; no `websockets`, no `pytest`; measured 2026-09-23). New venv with `--system-site-packages` (the system has torch 2.10.0+cu128, websockets 16.0, pytest 8.4.2), into it install `demucs beat_this essentia`; whether pip leaves the system torch untouched is unchecked.
   - **Node**: `ws` 8.21.3, `@modelcontextprotocol/sdk` 1.30.0; `node:sqlite` experimental (§13.4).
5. **Measurement location for acceptance:** own null sink per run (not the shared `cypher_stumm`, 06 risk 1), JACK recorder at the target, never `pw-record` (01 §4.4); safety lock against unrequested sound (§8).

---

## 20. Open points and change log

**Provisional until the stated measurement:** quantum 256 (M1); audibility threshold −26 dB, "Tief offen" (low open) −12 dB, listening pass
thresholds, gate thresholds (M18, M13); gate `streckfaktor` ±20 % (M19 measured, provisional until M18) and tuning correction (M19); low limits of the
playing styles (M20, until then warning only); `ziel_lufs` −16 LUFS (M18, by ear); working lead 4 blocks, `vorlauf_ms` and
at most 2 R3 per working thread (M3); crossfade of the Notbahn (fallback path) (M2); pulse method of the hosts (M7); time limits of the
planner (unmeasured); deadline guard lengths 32/16 beats (set); response deadline 4 bars (M15); listening pass validity
64 beats (set).

**Deliberately not in version 1:** S-corners in the tempo map, time signatures other than 4/4, Link and MIDI clock (only ports
reserved), plugin inserts (built since plan 1.11: insert kind `host`, §1.5, §4.11, §20.12), splitter MCP, UI.

**Page API and JSON schemas (decision 2026-11-03, Andreas):** the page API of the sections below gets no schema of its own. `check_schemas.py` checks documentation examples against schemas, not the server against the contract; for a server and its own page in the same repository that would be double upkeep without a gain (it caused the 15 red findings fixed in 37d9fee6). Its field lists therefore stay under `ausserhalb` in `djk/contract/demos/zuordnung.json`. Schemas belong where a separate program checks at run time (the leitstand loads them, `djk/conductor/src/contract.ts`, `intake.ts`). If drift between the server and the hand's `proj_*` tools ever hurts, a schema comes only for the answers the hand reads, and the server tests check real answers against it (which fields the hand reads is unchecked).

### 20.1 Page API slice 6: Stems (package 1.13; model and GPU rule since 2026-11-06)

No OSC field and no playback field is new. Source: `djk/ui/areas/proj/stems.ts`, `http/reasons.ts`, `project/stems.ts`,
`djk/workshop/werkstatt/stems.py`. Model: BS-RoFormer-SW on the GPU only (plan `docs/superpowers/plans/2026-11-06-stems-roformer-gpu.md`).

**`POST /proj/stems {clip_id | spur_id, von_beat?, bis_beat?, geraet?}`** starts at most one run per server.
- Answers at once `200 {auftrag_id, frames}`; `frames` is the length of the stems in frames at 48 kHz (D5).
- Exactly one of `clip_id` and `spur_id`, otherwise 400 `argument_ungueltig`; an unknown field gives 400 `argument_unbekannt`.
- `geraet`: only `gpu` (the default). `cpu` answers 400 `stems_nur_gpu`, anything else 400 `argument_ungueltig`.
- Refusals (409 unless noted): `stems_laeuft` (with `auftrag_id`), `ki_gestoppt`, `kein_kernstand`, `kein_projekt`,
  `nur_andreas_spur`, `audio_fehlt`, `mehrere_clips`, `stems_loop`, `stems_zu_gross` (range over 600 s of source), `zu_viele_spuren` (the plan counts
  six tracks); 404 `clip_unbekannt` and `spur_unbekannt`.
- Without the header `x-djk-quelle` the source counts as Andreas (`http/transport.ts:36-38`, as for every lock).

**`POST /proj/stems/abbrechen {auftrag_id}`** answers `200 {auftrag_id, zustand: "abbrechen"}`. 404 `kein_auftrag` for an unknown id, 409 `zu_spaet`
only while the result is being taken over (undo takes it back); after the run has ended the job is gone and the answer is 404 `kein_auftrag`.

**State `stems`** in `GET /proj/aktuell` (not in the view `nur=rev`) and as SSE `{a: "proj", f: {stems}}`:
`{slug, auftrag_id, clip_id, zustand, stufe, prozent, cpu_s, grund?, text?, detail?, hinweis?, spuren?, rev?, rest_db?}`.
- `zustand`: `laeuft | fertig | abgebrochen | veraltet | fehler`; `stufe`: `laden | trennen | schreiben`; the server renews `cpu_s` once per second in
  the state (without SSE).
- The state belongs to project `slug`: another open project does not see it. The last state stays after the end.
- `fertig` carries `spuren` (the ids of the placed stem tracks, four to six), `rev` and `rest_db`; `hinweis: "stems_ohne_gruppe"` when no group was free. The group "Stems: <name>" plays into the group of the source track (ADR 036; into the master when the source is on the master).
  Placed are always Drums, Bass, Other and Vocals; Guitar and Piano only when they are no more than 45 dB below the source range, otherwise their
  signal is in Other (D4).
- `abgebrochen` with `grund`: `abbruch` or `stems_zeitlimit`. (`stems_quantum` retired 2026-11-07: M9 showed GPU stem jobs next to the kern at 256 and 128 without gaps.)
- `veraltet` with `grund`: `veraltet`, `zu_viele_spuren` (counts the stems actually placed) or `ki_gestoppt` (Stop Cypher at the end of the run);
  `fehler` with `grund: gpu_belegt` (less than 4.5 GB free on the GPU, or out of memory during the run), `keine_gpu` (no CUDA device), or
  `stems_fehler` with `detail`. On every refusal and failure the project is unchanged.

**`stumm?: boolean` on the audio clip** (`clip_aendern {stumm}`): `true` makes the translator leave the clip out, in the arrangement and in the export; `false` makes it audible again and
deletes the field; `null` rejects `clip_aendern` (`argument_ungueltig`).

### 20.2 Page API slice 7: Merge (Paket 1.13)

No OSC field and no playback field is new. Source: `djk/ui/areas/proj/output.ts` (`zusammenfuehre`), `project/merge.ts`, `http/reasons.ts`.

**`POST /proj/zusammenfuehren {spur_ids, von_beat, bis_beat}`** renders the chosen tracks in isolation and replaces them by one new audio track in ONE project change (one undo step).
- All three fields are mandatory: `spur_ids` is 2 to 32 distinct strings, `von_beat` and `bis_beat` are numbers (the range checker of the export applies: 1 to 1024 beats). An unknown or wrong field gives 400 `argument_ungueltig`.
- Render: `--ohne-zustand`, tap `produktion`. The chosen tracks keep their own fader and pan; group fader, pan, mute and `pm/fader` stand neutral; everything else is silent.
- Answer `200 {rev, projekt, spur_id, quellen, datei, frames, hinweis?}`; with `?antwort=kurz` without `projekt`. `quellen` are the ids of the merged tracks, `datei` the WAV
  `<project folder>/merge/merge-<id>.wav` (never replaced, written as `.teil` and linked), `hinweis: "quellen_laenger"` when content of a source lies outside `von_beat..bis_beat`.
- The new track is named `Merge: <names>` (at most 80 characters), lies below the lowest source, has the same target as the sources and one clip with `gain_db` +3.0103 dB
  (compensation of the pan law of the mixer, -3 dB in the middle). Its source has no catalog entry: the sha256 over the stream and the file hint identify it.
- The sources get `mute: true` for the whole track. If all chosen tracks were on solo the new track is on solo too.
- Refusals (409 unless noted): `merge_leer` (nothing sounds in the range or the render is silent), `merge_gruppen` (the tracks feed different groups or targets; for a bounce below a group the tracks may sit in that group or in groups below it), `merge_inserts` and `merge_sends` (also a child group between the sources and the bounced group that carries inserts or sends, ADR 036), `merge_teil_solo`
  (only some of the chosen tracks are on solo), `merge_freeze_noetig` (a Surge track with unfrozen notes), `merge_andreas_spur` (a track of Andreas, source Cypher), `merge_keine_spur_frei`
  (no free track slot), `ki_gestoppt`, `transport_laeuft`, `beschaeftigt`, `veraltet` (the project changed during the render; nothing saved, WAV removed), `audio_fehlt`, `export_bereich`,
  the render errors of the export; 404 `spur_unbekannt`.
- While the merge runs, `GET /proj/aktuell` shows `ausgabe_lauf: {art: "merge"}`; there is no abort route.

### 20.3 Page API Baukasten S15: stream bounce provenance and the kit-mode refusal

No OSC field and no playback field is new. Source: `djk/ui/project/model.ts` (`entstehungPruefung`), `project/commands.ts` (`clip_aendern`), `server.ts` (`graphLaden`), `djk/generator/generator.mjs` (`status`).

**`entstehung?` on an audio clip** (project format `cypherdj-projekt/2` only, like `warp`; in a `/1` file it is an unknown field): where a take of a Baukasten stream came from.
- Shape `{art: "strom", strom: 2|3, graph, regler: [8 numbers 0..1], code, bpm}`, all keys mandatory, no others. `graph` matches `^[a-z0-9_-]{1,32}$`, `code` has 1 to 20000 characters, `bpm` is 60..200.
- Set with `POST /proj/aendern` `clip_aendern {clip_id, entstehung}` (audio clips only, else `feld_nur_audio`); `entstehung: null` deletes the field (absent in the file, never `null`). A wrong shape gives `argument_ungueltig`, an extra key `argument_unbekannt`. One undo step.
- Absent in every project written before S15, so those files stay byte-identical. The playback translation never reads it. `clip_teilen` and `clip_duplizieren` copy the clip object and so keep it on every resulting clip.

**`noten` in the erzeuger `status.json`:** `"kit"` (a `note(...)` value is dropped, an `s(...)` value is a kit index) or `"midi"` (a `--ziel midi:...` or `bk:...` process). Written at process start and with every later write; fixed for the life of the process.
- `POST /graph` with an instrument name on erz/2 or erz/3 whose `status.noten` is `"kit"` answers 400 `kein_midi_strom` with `strom` and a `text` that names the cure (load the instruments first: tool `instrumente`, or `djk-instrumente --instanz <i>`). This applies to the source `cypher` and comes before the Cypher pre-checks. Andreas's own page is not locked: the graph loads as before and the 200 answer carries `warnung` with the same text (the page shows it as a message).
- A missing field (an erzeuger started before S15, no `status.json` yet) is unknown and passes as before. Removing a graph (`name ""`) is never refused. No new reason code.

### 20.4 Page API automation slice 3 wave B: arm and record a take

No OSC field and no playback field is new beyond §4.11 `/k/arr/arm` and §5.13 `/e/auto_punkt`. Source: `djk/ui/areas/proj/session.ts` (`autoArm`, `autoGeste`), `recording_auto.ts`.

- `POST /proj/auto/arm`: `{spur_id, an, modus?}` arms or disarms one track (`modus`: `touch`, `latch`, `write` or 0 to 2), `{alle: true}` disarms every track, `{modus}` alone switches the mode and sends the arm again for every armed track. It sends `/k/arr/arm` and changes the session only after the core acknowledged. Answer `{ok, quittung, auto_arm: {modus, spuren: [spur_id, ...]}}`. Refused: `nur_andreas` (403, the source `cypher`, before any state changes, for every body), `ki_gestoppt` (409), `spur_unbekannt` (404), `argument_ungueltig` (400), `kein_kern` (503), `projekt_gewechselt` (409).
- `POST /proj/auto/geste`: `{spur_id, ziel, wert, quelle?: maus | tasten}` is a mouse or key value of one field of an armed track while the transport plays; `{spur_id, ziel, ende: true}` ends the gesture. Answer `{ok, aufgenommen, beat}`. `nur_andreas` (403) for the source `cypher`; `auto_ziel_unbekannt` (400). The hand path does not use it: the core reports hand grips with `/e/auto_punkt` (§5.13).
- `POST /proj/auto/uebersteuern` is the page's own override request (§4.11 `/k/arr/auto` with `an 0`). For the source `cypher` it answers `nur_andreas` (403) only AFTER the Stop Cypher check (`ki_gestoppt`), the track check (`kein_projekt`, `spur_unbekannt`) and the target check (`auto_ziel_unbekannt`): the request is passed to the core, which refuses the source (status 6), so the answer also carries `kern: {status: 6, grund: nur_andreas}`. `/proj/auto/arm` and `/proj/auto/geste` answer `nur_andreas` before the core is asked.
- `GET /proj/aktuell` carries `auto_arm: {modus, spuren}` (absent when nothing is armed). The SSE message `{a: 'proj', f: {auto_arm: {modus, spuren}}}` repeats it on every change; `{a: 'proj', f: {auto_aufnahme: {spur_id, ziel, slug, modus, punkte}}}` reports a written take, `{a: 'proj', f: {auto_aufnahme: {spur_id, ziel, slug, fehler, text}}}` (for example `lane_gesperrt`) a refused one.
- A take ends at the end of the gesture (touch) or at the stop (latch, write). A batch of fields that end together is written with ONE `POST /proj/aendern` step (one undo step): label `Record <ziel> <track name>` for one field, `Record fader, pan <track name>` for several fields of one track, `Record N fields` (N = the number of fields) for fields of several tracks. The command `auto_neu` takes an optional `punkte` (the lane and its points in one command; checked like `auto_punkte`).
- The MCP tools cannot arm, send a gesture or override: there is no tool for it (`proj_auto_zustand` only re-enables, §4.11 `/k/arr/auto` with `an 1`).

### 20.5 Page API comping slice 1: take lanes, comp range, audition (package 1.14)

No OSC address, no playback field and no core change: the main lane stays `Spur.clips`. The export, the loudness run, the merge and the stems read only that (they translate without the audition map, through `schreibeWiedergabeFuer`); only the live playback reads the take clips of a track while it is auditioned (`project/playback.ts`, `spurClips`). Sources: `djk/ui/project/model.ts` (`Take`, `takes`), `project/commands.ts` (the four commands), `project/takes.ts` (copy rule), `project/recording.ts` (`nehmeTakeAuf`), `http/reasons.ts`, `areas/proj/mapping.ts`. The page and the hand follow this text; the page mirrors the copy rule in `public/production/takes.js`.

- **Project field.** An audio track may carry `takes`: a list of `{id, name, art?, clips}`. `id` is `t<n>` (own counter `take` in `naechste_id`), `name` has 1 to 64 characters and is not only blanks, `art` is absent or `original` (the lane that keeps what a recording overwrote; marked by the field, not by its name), `clips` are audio clips with the usual checks. At most 32 take lanes per track; take clips count toward the 4096 clips of a project and their ids are unique project-wide. The key is written only when the list is not empty, so every older file stays byte for byte; it is accepted only in `cypherdj-projekt/2` files and refused in `/1` files. No format version change.
- **Take lanes are read-only for the clip commands.** `clip_teilen`, `clip_aendern`, `clip_loeschen` and the warp commands find main-lane clips only; with a take clip id they answer `clip_unbekannt` (404) and change nothing. Take content changes only through a recording and `take_loeschen`.
- **Commands in `POST /proj/aendern`** (each undoable, in one step with the others of the same request):
  - `take_neu {spur_id, name?}` adds an empty take lane; the default name is `Take <n>`, where n counts the lanes without `art` plus one.
  - `take_umbenennen {spur_id, take_id, name}` renames; `art` stays.
  - `take_loeschen {spur_id, take_id}` removes the lane; the main lane is untouched (comp ranges are independent copies). The last lane removed takes the `takes` key with it.
  - `comp_waehlen {spur_id, take_id, von_beat, bis_beat}` replaces the main lane over `[von_beat, bis_beat)` with what the take lane holds there; a gap in the take stays silent. The take clips overlapping the range are copied into the main lane with fresh ids (same sha, own `offset_s`), both sides are cut at the two edges by the `clip_teilen` rules (only where an edge lies strictly inside a clip), the main parts inside and the copy parts outside the range go. Where main material meets the copy at an edge, both neighbours get a seam fade of at least 0.004 s stored in beats (`0.004 * tempo_bpm / 60`; a longer fade that is already there stays), capped at half the shorter neighbour; the seam fade has priority over the fade on the other side of the same clip, which is cut back to the length that is left. An edge next to silence gets no fade. A loop clip crossing an edge refuses with `ersetzen_loop`.
  - **No-op rule:** if the main clips over the range already are copies of the take clips there (same pieces of the range) and sound the same in every field except id, name, `entstehung`, timeline and fades (`stumm`, `gain_db`, warp parameters and every later field are compared), the command returns the project unchanged: no new ids, no fades, `betrifft_wiedergabe` false.
  - `take_neu`, `take_umbenennen` and `take_loeschen` do not change the main lane and report `betrifft_wiedergabe: false`; `comp_waehlen` reports true unless it is a no-op.
- **Reasons.** `take_unbekannt` (404), `take_nur_audio` (409), `takes_voll` (409), `take_name_ungueltig` (400), `comp_leer` (400: `bis_beat` not above `von_beat`, or outside 0 to the beat limit), plus `ersetzen_loop`, `spur_unbekannt`, `argument_ungueltig`. English texts are in `http/reasons.ts` and in the page's `FEHLER_TEXT`.
- **Recording.** A recorded pass writes its clip into a take lane and into the main lane in the same history entry. Lane choice: only the newest lane without `art` is looked at; if it holds no clip in the range the pass goes into it, otherwise a new `Take <n>` is made (an earlier free lane is not searched). Main clips that the range overwrites are cut at its edges; a part inside that is a copy of a take clip and sounds the same (the copy rule plus every other field equal, and inside that take clip's range) is dropped; every other part moves into the lane named `Original` (created once per track, `art: original`, never chosen for a new pass). The recording refuses before anything changes, keeping the raw file, with `takes_voll` (also when the needed `Original` lane would be the 33rd), `zu_gross` (clip limit) or `ersetzen_loop`.
- **Short answers.** The short answers (`proj_oeffnen` and `proj_neu` with `antwort=kurz`, `GET /proj/aktuell` with `noten=zahl`) carry `takes_zahl` (the count of take lanes) on an audio track that has takes, never the lanes themselves; the key is absent without takes. The full view of `GET /proj/aktuell` carries `takes`.
- **Audition (R8).** `POST /proj/take_vorhoeren {spur_id, take_id | null}` makes the live playback of that track play the take's clips instead of the main lane (`null` ends it); one take per track, several tracks at once. A request that changes nothing answers without a load and without an event. The answer is `{vorhoeren: {<spur_id>: <take_id>}, kern: {wiedergabe: {nr, quittung}}}` (`vorhoeren` lists every auditioned track); while a freeze holds the load lock the map is set, the load waits and `kern.wiedergabe` is `{nr: null, aufgeschoben: true}`. An export holds no lock: it renders without the audition map, and a toggle during an export loads at once. `GET /proj/take_vorhoeren` answers `{vorhoeren: ...}` and `GET /proj/aktuell` carries the same map as `vorhoeren` (absent when empty). Every change of the map sends ONE SSE message `{a: 'take_vorhoeren', f: {vorhoeren: {<spur_id>: <take_id>}}}` with the full map, an empty map when it was cleared; an unchanged map and a refused request send nothing. The audition is session state: not saved, not undoable, not in the history, and the export, loudness run, merge and freeze translate the main lane. It ends on project open, new and re-open, at a recording start, at a freeze start and on a core restart (the new core plays the main playback); entries whose track or take is gone (a deleted take or track, also by undo or redo) are dropped and the playback is reloaded once. The audition playback is its own file `wiedergabe-<K>.json` with a number of the same counter as the main playback; it never becomes `wiedergabe_rev` (the core loads only numerically named files), so a page-server restart during an audition finds the core playing a number other than `wiedergabe_rev` and loads the main lane. Refused (nothing changes, no event): `kein_projekt` (409), `ki_gestoppt` (409, source `cypher`), `argument_ungueltig` (400), `aufnahme_laeuft` (409), `spur_unbekannt` (404), `take_unbekannt` (404), and a refusal of the core or of the translator as 409 with its reason (the receipt's reason, fallback `nicht_geladen`).
- **MCP.** The tool `take_vorhoeren {spur_id, take_id | null}` posts exactly that body; the four commands go through `proj_aendern`; `proj_lage` shows `takes_zahl` per track and the `vorhoeren` map; `proj_oeffnen` shows `takes_zahl` only.
- **Known limit.** The decoded audio files (`.f32`) of take clips are never removed by the server, as for main clips: 8 takes of 3 minutes measured 553 MB (69 MB each).

### 20.6 Page API Studio track band loop (1.12 S7, M13)

The automation tracks of Studio S6 (`POST /spur`, `POST /spur/stopp`, `GET /spur`, guide `djk/hand/AUFRUF.md` "Automation tracks") can loop.
Source: the S8 plan `docs/superpowers/plans/2026-09-29-djk-studio-s8-schleife.md` and the spec `docs/superpowers/specs/2026-10-22-1.12-automation.md`
(build plan PLAN-1.12-slices4-5-7, U12/U13, outside the repo).

- **Loop.** `spur.schleife_takte` n (integer 1 to 64) in `POST /spur` makes the track a loop: pass k starts at `anker_beat + 4n·k` and carries the
  same moves; it runs until `POST /spur/stopp` (one `/k/abbruch` with plan `spur:<name>` ends every pass). Every move lies inside one pass:
  `ab_takt <= n`, a ramp ends at bar n+1 at the latest, a set on bar n+1 is refused (it would fall on the start set of the next pass), and `strom:`
  targets are refused; all as 400 `spur` with a text. Without `schleife_takte` a track behaves as before. The answer of `POST /spur` names pass 0
  (`ende_beat` = start of pass 1).
- **Planning.** The page server sends a pass to core and wirt 2 beats before its start (`/k/teil` part numbers continue over the passes, the wirt
  gets `fahre` with `ab` in the future). It is serial: a pass is planned once, a STOP during a wirt call lets no part of that pass follow. A pass
  whose start is not in the future any more (the core clock was away, the page server was down) is skipped, never sent late (log
  `spur_schleife_uebersprungen`). A loop is never cleaned up as expired. A wirt error ends the loop (log `spur_schleife_ende`, `grund: wirt`).
- **Cypher's loops.** Stop Cypher, AUTO and D8 are checked for every pass, D8 at the start over two passes (the seam); a failed check ends the loop
  (log `spur_schleife_ende` with `grund` `ki_gestoppt`, `auto_aus` or `kein_hoerschein`). A hand on a target (the core reports `/e/halter` with
  holder `mensch` on that path) ends Cypher's loop (`grund: hand`); Andreas' loops keep running.
- **`GET /spur`** carries for a loop also `schleife_takte`, `durchlauf` (k), `anker_beat`/`ende_beat` of the RUNNING pass and `naechste` (true while
  a change waits).
- **`POST /spur/aendern {name, spur}`** changes a running loop from its next pass, never inside the current one. `spur` is checked like in
  `POST /spur`, `schleife_takte` is required (it may change) and `spur.name` must be `name`. The change waits as `naechste`; a later change replaces
  a waiting one. The answer carries `ok`, `name`, `ab_beat` and `ab_takt` (the start of the pass it applies from) and `uebernaechster`: true when the next
  pass was already being sent, so it applies from the one after. Refused: 400 `name`, 400 `spur`, 404 `keine_spur`, 409 `keine_schleife` (a
  one-shot track), 403 `nur_andreas` / `nur_cypher` (only the owner changes a loop), 409 `ueber_projekt`, and for Cypher 409 `ki_gestoppt`,
  `auto_aus`, `kein_hoerschein` as at the start.
- **Persistence.** `spuren.json` keeps per loop `schleife {n, anker_naechster, durchlauf, teilNr, naechste, durchlaeufe}` (the last two sent
  passes; `ids`/`teile` are kept for those two only). It is written once per pass at most. After a restart of the page server the loop resumes
  from the next unsent pass, a waiting change included.
- **Page.** PLAY of a Studio track band sends the line as a loop over its length; the head runs modulo the pass; a finished edit of the own running
  loop goes to `POST /spur/aendern` 300 ms after the last edit (one request at a time, the last state follows a running one); the band head shows
  `next loop` while a change waits.
- **MCP.** The tool `spur` takes `schleife_takte` and `aendern: true` (posts `/spur/aendern`); no new tool.

### 20.7 Page API comping slice 4: bounce (package 1.14)

Spec: `docs/superpowers/specs/2026-11-03-1.14-comping.md` section 10 (R1 to R13, D1 to D16). Server: `areas/proj/output.ts` `bounce()`, pure
calculation `project/bounce.ts`. No OSC address, no playback field, no regler row.

- **Route.** `POST /proj/bounce` in the area `proj-ausgabe`, protection `fremdePost`. `?antwort=kurz` drops `projekt` from the answer.
- **Body by `art`.**
  - `{art: 'an_ort', spur_id}`: bounce track in place (audio tracks only). Range: the hull of the track's main clips, `floor(first start + 1e-9)` to
    `ceil(last end - 1e-9)` beats. The render is **pre-mixer**: fader 0 dB, pan 0, mute off, without the track's lanes, dry, groups and production
    master neutral. The main clips move with their ids into a new take lane `Before bounce` (appended); the main lane becomes one audio clip
    `Bounce: <track name>` with `gain_db` +3.0103 dB (undoes the pan law the track applies again). Fader, pan, mute, solo, target, sends and lanes
    stay live and unchanged. Restore: `comp_waehlen` of that lane over its clip hull (§20.5).
  - `{art: 'neue_spur', spur_ids | gruppe_id, von_beat?, bis_beat?}`: bounce to new track, the merge of §20.2 with one source allowed. Exactly one of
    `spur_ids` (1 to 32 distinct ids) and `gruppe_id` (all tracks whose target is that group, in track order). A missing range is the hull of the
    sources' clips. The new track is named `Bounce: <names>`; the sources are muted.
  - `{art: 'einfuegen', spur_ids, von_beat, bis_beat, ziel_spur_id, ziel_beat}`: paste bounced audio. The sources are rendered post-fader over
    `von_beat..bis_beat` (as the merge) and stay unchanged; one clip `Bounce: <names>` with `gain_db` +3.0103 dB goes onto the audio track
    `ziel_spur_id` at `ziel_beat` and overwrites its main lane over `[ziel_beat, ziel_beat + length)`: clips crossing an edge are cut by the
    `clip_teilen` rules, clips inside are removed. Take lanes of the target stay unchanged.
  - The range follows the export rule: start at 0 or later, 1 to 1024 beats (`export_bereich`). `ziel_beat` is at least 0 and its end at most the
    beat limit. Unknown fields or a missing or unknown `art`: 400 `argument_ungueltig`.
- **Answer.** `200 {art, rev, projekt, spur_id, clip_id, datei, frames, quellen, take_id?, lanes_verworfen?, hinweis?}`. `spur_id` is the track that
  received the clip; `take_id` the lane `Before bounce` (`an_ort` only); `lanes_verworfen` and `hinweis: 'quellen_laenger'` as in the merge
  (`neue_spur` only). One undo step per bounce.
- **Guards, in this order.** `ki_gestoppt` (source cypher with Stop Cypher), `kein_projekt`, `beschaeftigt`, `transport_laeuft`, plan refusals
  (`argument_ungueltig`, `export_bereich`, `spur_unbekannt` 400, `gruppe_unbekannt` 400, `bounce_nur_audio` 409, `bounce_ziel_art` 409,
  `takes_voll` 409, `ersetzen_loop` 409, `merge_andreas_spur`, `merge_freeze_noetig`, `merge_gruppen`, `merge_teil_solo`, `merge_sends`,
  `merge_inserts` (a source, the in-place track or the paste target has an insert chain; the bounce is dry and does not bake it), `merge_keine_spur_frei`, `merge_leer`), then `audio_fehlt` (only the sources' clips in the range) and `merge_leer` (nothing of the sources plays).
  A render peak at or below -90 dBFS gives `merge_leer`. After the render: `veraltet` when the sources, the in-place track's take lanes or the
  paste target changed (also `takes_voll`, `ersetzen_loop`, `merge_keine_spur_frei` on the fresh state), `ki_gestoppt` when Stop Cypher was set
  meanwhile (source cypher). Nothing is saved then and the WAV is removed. Rights: Cypher may not bounce a track of Andreas in place, may not use
  one as a to-new-track source, and may not paste onto one; reading a track of Andreas as a paste source is allowed.
- **Run state and files.** While it runs, `GET /proj/aktuell` shows `ausgabe_lauf: {art: 'bounce'}`; freeze, export, loudness, merge and bounce
  exclude each other (`beschaeftigt`, text `a bounce is running`). No abort route. `an_ort` ends a running audition before the render and again
  after the result is saved. The WAV is `<project folder>/bounce/bounce-<id>.wav` (written as `.teil` and linked, never replaced); it stays after
  an undo. The WAV is fixed in seconds: a later tempo change does not stretch it.
- **MCP.** The tool `proj_bounce {art, spur_id?, spur_ids?, gruppe_id?, von_beat?, bis_beat?, ziel_spur_id?, ziel_beat?}` posts exactly the given
  fields to `/proj/bounce?antwort=kurz` with its own long-call limit (`DJK_HAND_FRIST_PROJ_BOUNCE_MS`, default 80 min).

### 20.8 Page API automation slice 4: the lane editor tools (package 1.12)

No OSC address, no playback field and no core change: the four commands change the points of a lane, which the server already writes as `auto` (§4.11). Sources: `djk/ui/project/lane_tools.ts` (pure tools), `project/commands.ts` (commands), page mirror `public/production/lanes_tools.js`.

- **Commands in `POST /proj/aendern`.** Each is one undo step, goes through the lane lock (`lane_gesperrt`, 409) and ends with the lane check (`punkte_ungueltig`, `zu_gross`). `von_beat < bis_beat` inside 0..100000, else `bereich_leer` (400).
  - `auto_vereinfachen {lane_id, von_beat, bis_beat, toleranz?}`: thins the points in `[von_beat, bis_beat]` with the recording simplifier; default tolerance per target: fader 0.3 dB, pan 0.008, `geraet.*` 0.004. Only maximal runs of linear segments are thinned; every `s` or `sprung` point, its two neighbours, both points of a jump pair and the first and last point of the range stay unchanged (mute and solo lanes come back unchanged).
  - `auto_dehnen {lane_id, von_beat, bis_beat, neu_bis_beat}`: the points in `(von_beat, bis_beat]` map linearly onto `(von_beat, neu_bis_beat]`; points that lay in the new span and not in the source go; after `max(bis_beat, neu_bis_beat)` the lane keeps its values (a jump pair there holds the old value where the stretched end differs); `neu_bis_beat <= von_beat` is `bereich_leer`. A range edge that falls inside a segment gets an anchor point first, so the lane before `von_beat` keeps its values.
  - `auto_neigen {lane_id, von_beat, bis_beat, faktor}` (`faktor` -1..1, else `argument_ungueltig`): a point at `u = (beat - von_beat) / (bis_beat - von_beat)` inside the range moves to `u^(4^faktor)`; values, forms and order stay; `faktor 0` changes nothing.
  - `auto_form {lane_id, von_beat, bis_beat, form, perioden?, unten?, oben?}`: replaces the points in `[von_beat, bis_beat]` by a shape, `form` one of `rampe_auf`, `rampe_ab`, `sinus` (s segments between the extremes, starting at its lowest value), `dreieck`, `rechteck` (jumps); `perioden` 1..64 (default 1); `unten`/`oben` in the range of the target (default fader -60..0 dB, pan -1..1, device 0..1; `unten > oben` is `argument_ungueltig`). At both edges a jump pair keeps the old value outside the range. Mute and solo take `rechteck` only; any other or unknown `form` is `form_ungueltig` (400).
- **Page.** A drag in the empty of a lane row selects a range (Esc clears it). Right click on a point: Linear / S-curve / Jump (one `auto_punkte` that sets the point with the new form and keeps its jump partner; disabled on mute and solo). Right click in the range: Insert shape (the five forms), Simplify, Delete points (`auto_punkte {loesche_von, loesche_bis}`; when that would remove every point, one point at `von_beat` with the lane value there is kept). The right edge handle sends `auto_dehnen`, the top corner handles send `auto_neigen` (half the row height = faktor 1), one command on release, the draft drawn through the page mirror. Draw mode (key B or the DRAW button of a lane head): a stroke sends one change, with the grid on `[auto_punkte]` with one `sprung` point per grid step, with the grid off `[auto_punkte, auto_vereinfachen]` with one linear point per 2 px (D1 of the plan); more samples than the lane can hold are refused on the page.
- **MCP.** The four commands go through `proj_aendern`; the tool count is unchanged.

### 20.9 Page API automation slice 5: clip envelopes (package 1.12)

No OSC address. The envelopes are a project field that the server translates into `gain_hk`, relative lanes and notes (§4.11). Sources: `djk/ui/project/envelope.ts` (pure), `project/commands.ts`, `project/playback.ts`, `areas/proj/session.ts` (`autoLage`), page `oeffentlich/produktion/huellkurven*.js`.

- **Project field.** A clip may carry `huellkurven`, a list with at most one entry per target: `{ziel, verknuepft?: false, loop_beats?, punkte: [{beat, wert, form?}]}`. `ziel`: `gain` (audio clips, dB -200 to 0), `transpose` (MIDI clips, semitones -48 to 48), `spur_fader` (dB -60 to 6), `spur_pan` (-2 to 2), `geraet.lautstaerke | cutoff | resonanz | env_mod` (-1 to 1, MIDI clips on RB-338 tracks only), `geraet.k1 | ... | geraet.k64` (-1 to 1, a summand on the knob, MIDI clips on bk tracks only; 1.12 slice 7). `beat` is a CLIP beat from the clip start (`offset_s` and `versatz_beats` do not move it). Linked (`verknuepft` absent): the points of `[0, clip loop)` repeat with every loop copy; unlinked (`verknuepft: false`): they repeat modulo `loop_beats` (1/16 to the clip length; absent = no repetition) from the clip start over the whole clip. `verknuepft: true` and an empty list are never stored. The key is absent without envelopes (an old project file reads and writes unchanged). The points count with the lane points against the 65536 of a playback.
- **Commands in `POST /proj/aendern`.** `huellkurve_setzen {clip_id, ziel, punkte, verknuepft?, loop_beats?}` replaces the envelope of that target on that clip; `huellkurve_loeschen {clip_id, ziel}` removes it. Reasons: `huellkurve_ziel` (400, target does not fit the clip), `huellkurve_unbekannt` (404, delete without an envelope), `geraet_huellkurven` (400, `spur_aendern` to a host or bk device while a clip carries `geraet.*` envelopes), `punkte_ungueltig`, `zu_gross`, `argument_ungueltig`, `argument_unbekannt`, `clip_unbekannt`. `clip_teilen` cuts linked envelopes at the split and rotates unlinked ones on the right part; `clip_duplizieren` copies them; `clip_aendern` clamps an envelope loop to the new length and checks a track move. There is no lock for envelopes; with Stop Cypher set the commands from the source `cypher` are refused with `ki_gestoppt` (409) like any project change.
- **Reading.** `GET /proj/aktuell?noten=zahl` and the short answers show `huellkurven: [{ziel, punkte_zahl, verknuepft?, loop_beats?}]` on a clip, without the points (the full view carries them). `GET /proj/auto?clip_id=<id>&ziel=<ziel>[&von_beat&bis_beat&bei_beat&punkte_max]` answers `{clip_id, spur_id, ziel, verknuepft, loop_beats?, punkte_zahl, punkte_gezeigt, punkte: [{beat, wert, form}], weiter_ab_beat?, bei?: {beat, wert}}`; without `ziel` `{clip_id, spur_id, huellkurven: [...]}`. All beats are CLIP beats; `bei.wert` is the value the core plays at that clip beat (repetition included). `clip_id` with `lane_id` or `spur_id`, or `ziel` without `clip_id`, is `argument_ungueltig` (400); an unknown clip `clip_unbekannt` (404); a valid target the clip does not carry `huellkurve_unbekannt` (404); a string that is no envelope target `huellkurve_ziel` (400).
- **MCP.** `huellkurve_setzen` and `huellkurve_loeschen` go through `proj_aendern`, `proj_auto` takes `clip_id` and `ziel`, `proj_lage` and `proj_oeffnen` show the envelope summary; the tool count is unchanged (65).
- **Measured at the core.** `djk/ui/check/acceptance_a5.mjs` (see `docs/architecture/stand/produktion-automation.md`, "Slice 5: real-core acceptance").

### 20.10 Page API 1.9 instrument rack, member macro targets and variations (package 1.9, U7 and U8)

One contract change below the page API: the playback file (§4.11) gets a rack device and `glied` mapping targets; the commands are page API. Sources: `djk/ui/project/model.ts` (model, limits), `project/commands.ts` (commands), `project/playback.ts` (translator), `http/reasons.ts` (reason texts), `areas/proj/mapping.ts` (HTTP codes), page `public/production/rack_device.js`, `rack_device_operation.js`; core `djk/core/src/arr_rack*.cpp`, `arr_playback.cpp`. Decision record: `docs/architecture/adr/034-rack-members-and-member-macro-targets.md`; evidence: `docs/architecture/stand/produktion-instrumente.md`.

- **Rack device.** `geraet: {art: 'rack', kette, glieder: [{id, geraet, ton?, vel?, kette?, gain_db?}]}` on an instrument track (`spur_neu`, `spur_aendern`). 1 to 4 members (`MAX_GLIEDER`), ids `g1` to `g4`, unique in the rack; at most 8 rack tracks per project (`MAX_RACK_GERAETE`). A member device is `intern` (`rb338`, `bk`, `kit`) or `wirt` (`surge`, own slot 1 or 2; one Surge per slot over tracks and members together, else `slot_belegt`); a rack does not nest and a Surge member carries no `parameter` in 1.9. Zones are inclusive pairs: `ton` 0 to 127, `vel` 1 to 127, `kette` 0 to 127 (absent = the whole range); `gain_db` -60 to +12 (absent = 0). The `kette` of the rack is the live chain value, an integer 0 to 127. Zones may overlap (both members sound, the sum equals the two single renders bit for bit) and may leave gaps (a note in no zone sounds nothing). The file format stays `cypherdj-projekt/2`; a `/1` file never carries a rack device. A rack track with a Surge member that is frozen is emitted as its audio clip, without members.
- **Playback file.** A rack track goes out as `WSpur nr, art: 'intern', geraet: 'rack', kette, glieder: [...], noten` (a member `id, ..., ton, vel, kette, gain_db`); zones and `gain_db` are always written explicitly. The core refuses `geraet: rack` in a `/1` playback.
- **Commands in `POST /proj/aendern`.** Each is one undo step and a playback swap (like a device change); a freeze on the track goes with it.
  - `rack_glied_setzen {spur_id, glied}`: `glied` without `id` adds a member with the lowest free id (`rack_voll_glieder` when four exist); with `id` it replaces that member (`glied_unbekannt`, 404, for an id the rack does not have). Zone, slot and kit checks run at the end of the command (`argument_ungueltig`, `slot_belegt`, `kit_unbekannt`). A replaced member keeps only the macro targets its new device allows.
  - `rack_glied_entfernen {spur_id, glied_id}`: removes a member and every macro target on it; the last member cannot go (`rack_letztes_glied`: convert the track to a plain device with `spur_aendern`).
  - `rack_kette {spur_id, kette}`: the chain value. A change while playing lands at the next block boundary; a note that started before the change finishes on the member it started on (no cut).
  - A track that has no rack device answers `keine_rackspur` (409).
- **Member macro targets.** `rack_setzen` (slice 4c: a strip rack = 4 macros, at most 16 targets) takes a second target kind next to the stage kind `insert, param, von, bis`: target fields `glied, param, von, bis`, `glied` = a member id of the instrument rack of the SAME track (a strip that is not a rack track answers `glied_ohne_rack`). Allowed parameters: RB-338 `lautstaerke`, `cutoff`, `resonanz`, `env_mod` (von/bis 0 to 1), bk `k1` to `k64` (0 to 1), `gain_db` of any internal member (-60 to +12 dB). A Surge member takes none (`makro_ziel_wirt`). One parameter has at most one macro (`ziel_doppelt`); while mapped its own value is ignored by the core (for a stage of the chain the project also refuses to set it, `param_gemappt`; for a member it does not, the member's value stays stored and is used again when the mapping goes). The translator writes the target as `makro, glied, param, von, bis` with `glied` = the member's position 0 to 3 in the rack device and `param` in the core's member index space (RB-338 0 to 3 in the order of the `geraet.*` rows, bk 8 to 15, `gain_db` 16; pinned by `tests/project_rb_mapping.test.mjs` and the core test `test_arr_naht_seite`). A frozen rack track goes out without member targets. Removing or replacing a member, or converting the track away from a rack, removes the targets that no longer fit (undo restores them). Removing the last mapping of the strip removes the strip rack together with its variations (undo restores).
- **Start value.** At a transport start a mapped member sounds on its mapped value from the first sample (macro 0 gives `von`, 1 gives `bis`); there is no glide from the member's own value. A plain RB-338 track with a device lane starts on the lane value the same way.
- **Variations.** `rack.variationen`: at most 8 (`MAX_VARIATIONEN`) named snapshots (`name`, `werte` = four values 0 to 1) of the macro values of a strip rack, name 1 to 32 characters; the key is absent when empty. Commands (one undo step each, project data only, no playback structure): `makro_variation_speichern {strang_id, name}` stores the current four values (an existing name is replaced in place; a ninth distinct name is `variation_voll`), `makro_variation_laden {strang_id, name}` sets the four values (a control change like `rack_makro`; `variation_unbekannt`, 404, for an unknown name), `makro_variation_loeschen {strang_id, name}` removes one. A strip without a rack answers `rack_unbekannt`.
- **New reasons.** `keine_rackspur`, `rack_voll_glieder`, `rack_letztes_glied`, `glied_ohne_rack`, `makro_ziel_wirt`, `variation_voll` (409), `glied_unbekannt`, `variation_unbekannt` (404). A freeze, bounce, merge or export of a track with a Surge member needs the host of its slot like a plain Surge track: `wirt_fehlt` (409, the text names `djk-instrumente --arr<n>`), `wirt_fehler`, `wirt_spiegel_fehler`. Texts: `http/reasons.ts`, page `public/production/output.js`.
- **Page.** `+ RACK` adds a rack track, the track head menu entry `MAKE RACK` turns the device of a track into member `g1`; the rack panel edits the members (zones on the key, velocity and chain axes, gain, chain value, add and remove), the macro panel offers member targets and a variation row. The Surge and kit buttons count members. Details: `docs/architecture/stand/produktion-instrumente.md`.
- **MCP.** The three rack commands, the three variation commands and `rack_makro` go through `proj_aendern`; no tool was added, the tool count is unchanged (`djk/hand/AUFRUF.md`).

### 20.11 Page API routing slices 6 and 7: the matrix and resampling (package 1.10)

No new playback field and no new OSC address beyond §4.11 `/k/arr/abgriff` and §5.13 `/e/abgriff`. Sources: `djk/ui/project/routing_matrix.ts` (pure), `areas/proj/area.ts`, `areas/proj/output.ts` (`resample`), `project/resample.ts`, `http/reasons.ts`; MCP tools `proj_routing` and `proj_resample`.

- **`GET /proj/routing`, optional query `optionen=<insert_id>`,** answers the fields `slug`, `rev`, `ziele` (list of `wert` and `name`), `returns` (list of `id`, `nr`, `name`, `pre`) and `straenge`; without an open project only `slug: null`. One strip per track, group, return and the production master, each with `art` (`spur`, `gruppe`, `return`, `pm`), `id`, `nr`, `name`, `ausgang`,
  `ziel_zellen` (per cell `ziel`, `aktiv`, `erlaubt`, and `grund` and `text` when refused), `sends` (list of `return_id` and `db`) and `stufen` (per insert stage `insert_id`, `art`, `slot`, `an`, `schluessel`: null or `quelle`, `nr`, `punkt`; `optionen` only for the asked stage). A cell is `erlaubt: false` with the reason the command would answer
  (`routing_grenze` (all 16 groups used), `routing_zyklus` (a group onto itself or onto a group below it), `ziel_unbekannt`; a target move that would break a sidechain key is refused with the key reason; for a key `sidechain_spaet`, `sidechain_zyklus`, `sidechain_quelle`). `optionen` lists every key source of one compressor stage with its own `erlaubt` and reason. An empty `optionen=`, an unknown stage ID or the ID of a stage that is not a compressor is 400 `argument_ungueltig`.
- **`POST /proj/resample` with `strang_id`, optional `punkt`, `von_beat`, `bis_beat`,** plays one strip once in real time through the core tap and makes a new audio track from the file in ONE project change (one undo step "Resample <name>"). `strang_id` is the project's strip id (`s<n>`, `g<n>`, `r<n>`, `master`);
  `punkt` is `post` (default) or `pre`; the range is `von_beat` to `bis_beat` or, absent, the loop bracket if on, else the song, at most 256 beats. The answer carries `rev`, `spur_id`, `clip_id`, `datei`, `frames`, `quelle`, `punkt`, `von_beat`, `bis_beat`; the WAV is `<project folder>/resample/resample-<id>.wav` and stays after undo.
  The new track is "<source> (resampled)" (at most 80 characters) with output master and one clip at `von_beat` with `gain_db` +3.0103 dB (pan-law compensation of the new track), below the source track or at the end for a group, return and master; the source is untouched.
- **Refusals.** New reasons: `resample_leer` (409, the result is silent: muted or empty strip or a Surge host that is not playing; no track, both files removed) and `resample_fehler` (the core failed; nothing saved). Already existing: `argument_ungueltig`, `spur_unbekannt`, `zu_gross`, `export_bereich`, `merge_keine_spur_frei`, `ki_gestoppt`,
  `kein_projekt`, `beschaeftigt` (also while a recording runs), `transport_laeuft`, `kein_kernstand`, `wirt_fehlt`, `wirt_fehler`, `wirt_spiegel_fehler`, `veraltet` (tempo or strip changed during the run). While it runs `GET /proj/aktuell` shows `ausgabe_lauf` with `art: "resample"` and the `strang_id`.
- **`GET /proj/lage`** carries `kern.limiter_db` (gain reduction of the set limiter in dB, 0 idle, negative while it reduces; absent until the core has reported) and `kern.status` 3 while a freeze or resample tap runs; every other field is unchanged.
- **Commands.** `ziel_setzen`, `insert_setzen` and `insert_param_setzen` (`param` `sc` or `key`) refuse an own track as `pre` key with `sidechain_zyklus` (400). `proj_lautheit` carries the lists `gruppen` and `returns` (same shape as the track entries, with `gruppe_id` or `return_id` instead of `spur_id`); its per-track entries keep the keys of the measured path alive.

### 20.13 Page API insert and rack lanes (package 1.12 slice 6)

Playback side: §4.11 `chain_auto`. Sources: `djk/ui/project/model.ts` (`kettenZielBereich`, `zielBereichVon`, `pruefeLanen`), `project/commands.ts` (`auto_neu` and the lane commands), `project/playback.ts` (`kettenAuto`), page `public/production/{lanes.js,lanes_tools.js,inserts.js}`.

- **Return fader lane (return automation slice 2).** `auto_neu {strang_id: "r<n>", ziel: "fader", punkte?}` creates the volume curve of a return strip (dB, -200 to +6, the points as on a track; without `punkte` two points at the loop brackets on the current `fader_db` of the return). A return takes no other device lane. The master and a group take no volume curve: `auto_neu` with `ziel` `fader` on `master` or `g<n>` is `ziel_unbekannt` (400), and a project file that carries one is refused by the model check. The command is one undo step like every lane command; the playback is written as `cypherdj-arr/3` (§4.11) when a return carries the lane. The hand reads it with `proj_auto` (`lane_id`, or `spur_id` = the return id) and writes it with `proj_aendern`; the page does not draw it yet.

- **Targets.** `auto_neu {spur_id | strang_id, ziel, punkte?}` takes two more kinds of `ziel` next to the existing eight: `insert.<stage id>.<param>` (the stage id of `insert_setzen`, e.g. `insert.i3.schwelle` or `insert.i1.b1/gain`; any continuous parameter of the stage except `an` and the `komp` key) and `rack.m1` to `rack.m4` (the macro of the rack on that strip). The old refusal `lane_ziel_spaeter` is gone. `strang_id` (a track id, `g<n>`, `r<n>` or `master`) names the strip; `spur_id` stays the spelling for a track; both together are `argument_ungueltig`. A lane is stored on the strip that carries the stage or the rack, in the new field `automation` of a group, a return and the master (a track already had it). The device lanes (`fader`, `pan`, ...) stay tracks only: on a group, a return or the master they are `ziel_unbekannt`. The default lane has two points at the loop bounds on the value the row holds; the range check is the one of the target (the row range of the Stellwerk; 0 to 1 for a macro).
- **Reasons.** `insert_unbekannt` (the stage is not on that strip), `rack_unbekannt` (a rack target on a strip without a rack), `argument_unbekannt` (no such parameter on that kind of stage), `param_nicht_stetig` (a switch or a step list, as for macros), `ziel_unbekannt` (an unknown target, a host stage, a row path such as `ins/komp/1/schwelle`), `param_gemappt` (the parameter is driven by a rack macro: remove the mapping or automate the macro), `param_hat_lane` (`rack_setzen` onto a parameter that has a lane), `lane_doppelt`, `zu_gross` (12 lanes per strip, 64 chain lanes per project, the point limits). The lane commands (`auto_punkte`, `auto_aendern`, `auto_loeschen`, `auto_vereinfachen`, `auto_dehnen`, `auto_neigen`, `auto_form`) work on these lanes with the range of the target; `auto_vereinfachen` thins with a default tolerance of 0.4 % of the range.
- **Lifecycle.** A lane goes with its target: a stage that leaves the chain (`insert_entfernen`, a replaced stage) takes its parameter lanes, a rack that is gone (a `rack_setzen` that leaves no mapping) takes its macro lanes, and a parameter that a macro maps loses its lane. The change is part of the undo step of the command that caused it. A lane whose stage is a host stage that this playback leaves out stays in the project and is left out of the playback.
- **Page.** The lane menu of a track lists the track's own stage parameters and its four macros next to fader, pan and mute; the lane row draws and edits like the others (the same tools); the value axis shows the row range, linear. Lanes of groups, returns and the master exist in the project, in the playback, in `proj_lage` and `proj_auto`, but have no page row yet.
- **Baukasten knobs (slice 7).** `auto_neu {spur_id, ziel: 'geraet.k1'..'geraet.k64'}` on a track with device `bk`: 0 to 1 (`argument_ungueltig` outside), a new lane starts at the knob of the track (`parameter.kN`; untouched, the start position the graph gives that knob, 0.5 where the graph has none, as the core plays it); the RB-338 names are `ziel_unbekannt` on a bk track and the knob names on any other track. Clip envelopes on the same targets (`huellkurve_setzen`, MIDI clips of a bk track, summand -1 to 1) merge into one relative lane per knob like the RB-338 ones. A `spur_aendern` that would leave a knob lane or knob envelope on a device without those knobs is `geraet_lanes` or `geraet_huellkurven`; another graph on a bk track keeps them (the 64 knobs are the same). At most 12 lanes per track (`MAX_LANES_PRO_SPUR`). Page: the lane menu of a bk track lists the 64 knobs as "Knob 1" to "Knob 64" (the names the graph gives its knobs are not shown yet); the value axis is 0 to 1.
- **MCP.** `proj_auto` takes the new targets (insert, rack, knobs) and `strang_id`; no new tool, the tool count is unchanged.
- **Writes to a lane-driven parameter.** `insert_param_setzen`, `insert_setzen`, `rack_makro`, `makro_variation_laden` and a bk knob written through `spur_aendern` stay allowed. The value is stored as the rest value of the parameter; the answer of `/proj/aendern` (also the short form) carries `hinweise: [{index, hinweis: "lane_treibt", lane_id, ziel, strang_id, text}]`, one per changed lane-driven parameter (`index` = the command in the list). Behaviour behind it: while the arrangement plays, the lane drives the parameter in every block and holds its first and last value beyond its points, so the stored value applies only while the transport is stopped and after the lane is removed. No hint where the value did not change, where there is no chain or knob lane, or for a lane the same list creates later. The page shows the text as a notice.
- **Not covered.** A hand override (touch, latch) on a chain lane: these lanes always play. Lanes on the parameters of a host stage (a plugin keeps its parameters; the core refuses the lane).

### 20.14 Page API MIDI import: Standard MIDI files into the production (spec 2026-11-10-midi-import)

No playback field and no OSC address: the import plans an ordinary command list (`tempo_setzen`, `spur_neu`, `spur_aendern`, `clip_neu`) and runs it through the same path as `POST /proj/aendern`. Sources: `djk/ui/project/smf.ts` (reader), `project/midi_import.ts` (planner, pure), `areas/proj/midi_import.ts` (route logic), `areas/proj/gm_kit.ts` (GM drum kit), `public/production/midi_import.js` (page), `djk/hand/hand.ts` (tool `proj_midi_import`).

- **`POST /proj/midi_import`,** protection `fremdePost`, own body limit (an 8 MiB file as base64). The file comes as `daten_b64` (the page; optional `name`) or as `pfad` (the hand: an absolute path ending in `.mid`, `.midi` or `.rmi`, at most 8 MiB; a file that exists but cannot be read is `midi_datei_fehlt` with the cause in `text`), exactly one of the two. Options: `vorschau` (true: answer the report, write nothing), `auswahl` (list of part keys `<MIDI track>.<channel 1..16>`; default all parts with notes), `zuordnung` (part key to `rb338`, `kit:<name>`, `bk:<graph>`, `surge[:1|2]`, `keins`, null, or a device object as in `spur_neu`), `tempo` (`auto` default: the first tempo of the file when the project has no track yet; `uebernehmen`; `behalten`), `profil` (`einfach` default: the RB-338 for every melodic part; `poly`: parts with chords on Baukasten graphs by GM family, at most 8), `label` (history label, default `MIDI import: <file name>`), `rev` (default: the current revision). `?antwort=kurz` is accepted like on the other routes.
- **Reader.** Formats 0 and 1, running status, note-on with velocity 0 as note-off, the meta events tempo, time signature, track name and the program change; a truncated or damaged track keeps what was read and is reported as a hint. Format 2 (`smf_format2`) and an SMPTE time base (`smf_smpte`) are refused with a reason, not-MIDI input is `smf_kein_smf`, a damaged header `smf_beschaedigt`, a file without tracks `smf_leer`. A RIFF RMID wrapper is unwrapped.
- **Plan.** One project track per (MIDI track, channel) that has notes, in file order, with one MIDI clip each. A clip starts on the whole beat before its first note; note positions are `tick / ticks per quarter` beats, exact for the usual resolutions. The track name is the MIDI track name, else the GM program name (`Drums` for channel 10, `Track n` as the last resort); several channels in one MIDI track get a `ch<k>` suffix. Channel 10 goes to the kit `gm` (note N plays the GM sound N; the import builds it from the kit `techno` when the kit folder has none, an existing `gm` wins); without a usable kit the drum track is created muted. Tempo changes inside the file and a time signature other than 4/4 are never mapped: they are counted and reported (`midi_tempowechsel`, `midi_taktart`), the beat positions are kept. A tempo outside 60 to 200 BPM is not set (`midi_tempo_ausserhalb`).
- **Answer.** `vorschau`: `{vorschau: true, offen, bericht}`. Import: `{rev, kern, angelegt: [{schluessel, name, spur_id, clip_id}], bericht, hinweise?}`. `bericht` = `{datei, tempo, taktart, spuren, nicht_angelegt, summe, ignoriert, hinweise, anlegbar}` plus `datei_name` and, when the kit was built, `gm_kit_gebaut`. Hints carry a `code` (`midi_taktart`, `midi_tempowechsel`, `midi_tempo_ausserhalb`, `midi_tempo_nicht_uebernommen`, `midi_tempo_spaet`, `midi_kein_tempo`, `midi_ignoriert`, `midi_leere_spuren`, `midi_nicht_ausgewaehlt`, `midi_spuren_ohne_klang`, `midi_mono`, `midi_schlagzeug_ohne_klang`, `midi_kein_gm_kit`, `midi_kit_unbekannt`, `midi_graph_unbekannt`) and a `text`.
- **One step.** The whole command list is one `aendern` call: all or nothing, one history entry labelled `MIDI import: <name>`, so one undo takes back every track, clip and the tempo. The kit folder `gm` is built only when the import is about to run (after the plan, the `rev` check and the project checks) and is taken back when the change is refused, so a refusal leaves no trace; a `gm` that existed before is never removed. The usual checks apply (`rev_veraltet`, `ki_gestoppt`, `transport_laeuft`, `deck_laeuft` for a tempo change, the project limits).
- **Refusals** (nothing is changed): `smf_kein_smf`, `smf_format2`, `smf_smpte`, `smf_beschaedigt`, `smf_leer` (the file), `midi_datei_fehlt`, `midi_datei_zu_gross` (413), `midi_keine_noten`, `midi_schluessel_unbekannt`, `midi_zu_viele_spuren` (more parts than free tracks of 32; the `detail` names the numbers), `midi_zu_lang`, `zu_gross` (65536 notes per project), `argument_ungueltig`, `kein_projekt`. These are page API reasons only (not in the OSC reason list).
- **Page.** IMPORT MIDI in the transport bar opens a file picker, sends the file with `vorschau: true`, and shows the preview (tracks with notes, notes, duration, tempo, hints, one tick box and the instrument per part); IMPORT sends the same request without `vorschau` and with the ticked parts. **MCP.** Tool `proj_midi_import` (78 tools now): preview with `vorschau: true`, otherwise it adds the current `rev` and posts to `/proj/midi_import?antwort=kurz`.

### 20.15 Page API Strudel pattern to MIDI clip: `clip_aus_muster` (spec 2026-11-10-strudel-clip)

No playback field and no OSC address: the command writes an ordinary MIDI clip (notes and clip envelopes of §4.11) through the same path as every other command of `POST /proj/aendern`; nothing of Strudel runs at playback time. Sources: `djk/ui/project/commands.ts` (handler), `project/pattern_clip.ts` and `project/muster_zuordnung.json` (mapping), `areas/proj/pattern_run.ts` (child layer), `djk/generator/src/pattern_ereignisse.mjs` and `djk/generator/pattern-clip.mjs` (the Strudel side), page `public/production/pattern_field.js`.

- **Command.** `clip_aus_muster` takes `spur_id`, `start_beat`, `code`, `takte?`, `name?` for a new clip on an instrument track (RB-338, Baukasten, Surge, plugin instrument or kit track), or `clip_id` with an optional `code` and `takte` to generate an existing clip again in place (same id and place; the length stays unless `takte` changes it). `ueberschreiben?` is a boolean. `code` is one Strudel expression of at most 8192 characters; `takte` is 1024 bars at most, and absent on a new clip it means as long as the pattern takes to repeat (at most 64 bars searched, else 16). One cycle is one bar, four beats; the events are the onsets of the pattern, so the randomness of Strudel is frozen into the notes. A pattern that repeats sooner than the clip sets the clip loop to its period.
- **Mapping.** A kit track plays the kit sound named by `s(...)` (`bd:2` is the third one), an instrument track plays `note`, `n` with a scale or `freq`; `velocity` and `gain` give the velocity, `clip` scales the length. Controls with a target become clip envelopes relative to the track value (`cutoff` and `resonance` on an RB-338 track, `pan`, a `gain` driven by a signal as the fader); a signal is sampled at the note onsets, a patterned value steps. Every control without a target (`room`, `delay`, `cpm`, ...) is not applied and is listed.
- **Stored.** The clip carries `muster` with the code, the controls that had no target (`ohne_ziel`) and a fingerprint of the notes and envelopes as the pattern made them (`abdruck`). It exists in `cypherdj-projekt/2` only (the project loader refuses the field in a `/1` file); `clip_teilen` drops it from both halves.
- **Answer.** The answer of `/proj/aendern` (also the short form) carries `muster` with one report per generated clip: `clip_id`, `spur_id`, `noten_zahl`, `takte`, `loop_beats` (null = no loop), `huellkurven` (the targets drawn), `ohne_ziel` and `hinweise`.
- **Hand work.** Generating a clip again whose notes or envelopes differ from `abdruck` is refused `handarbeit_vorhanden` (also with a new `code`) unless `ueberschreiben` is true; moving or resizing is no hand work.
- **Child process.** Strudel runs in a child (`node --permission`, empty environment, 5 s, heap 384 MB, killed above 640 MB RSS, at most 2 children). The command itself is synchronous and only reads a cache keyed by code and bars; `POST /proj/aendern` evaluates the patterns of the list asynchronously before the command run (a dry run finds the ones that depend on earlier commands of the same list), so the server thread never waits for a pattern. At most 8 `clip_aus_muster` per call (`argument_ungueltig`). Known limit: `node --permission` has no network switch and a pattern can still reach `node:http`; the child holds no token and cannot write a file or start a process.
- **Refusals** (nothing is changed): `muster_fehler` (the pattern does not run; the text carries line and column), `klang_unbekannt` (a kit sound that does not exist; the text lists the sounds of the kit), `muster_ziel_passt_nicht` (`s` without `note` on an instrument track, `note` on a kit track), `muster_zeitlimit`, `muster_zu_gross` (more than 20000 events, or the memory kill), `muster_nicht_verfuegbar` (503: the child cannot run), `muster_fehlt` (a clip without a stored pattern and no `code`), `handarbeit_vorhanden` (hand work, see above), `kit_unbekannt`, `art_passt_nicht` (an audio track), `clip_nicht_midi`, `spur_unbekannt`, `clip_unbekannt`, `argument_ungueltig`.
- **Page.** The PATTERN field under the piano roll of a selected MIDI clip: code, BARS and GENERATE, an OVERWRITE box that sets `ueberschreiben`, and a line with what was not applied. **MCP.** Tool `proj_muster` (79 tools now) sends exactly this one command through `POST /proj/aendern` and answers with the `muster` reports; `proj_aendern` takes the same verb.

### 20.16 Page API SEQ deck (spec 2026-11-14-seq-deck-design, ADR 038)

A SEQ deck is a top group of the live container (`Gruppe.seq`, `cypherdj-projekt/2`) holding patterns; a pattern is an instrument track with one MIDI clip, so the core plays it as part of the live playback and no OSC address is new. The only new playback fact is the group output of §4.11 (ADR 038). Sources: `djk/ui/project/seq.ts` (document, check), `seq_uebersetzer.ts` (translator), `seq_text.ts` (notation), `commands.ts` (commands), `areas/live/seq.ts` (routes), `djk/hand/hand.ts` (tool `seq`), page `public/seq_field.js`, `seq_view.js`.

- **Commands** (`POST /proj/aendern`, one undo step each). `seq_anlegen {platz}` builds an empty deck: the top group of place 1 to 4 with the marker `Gruppe.seq = {schema: 2, platz}`. `seq_folge_neu {gruppe_id, name, geraet, loop_beats?, stumm?, noten?, seq?, huellkurven?}` adds a pattern: an instrument track playing into the group with one MIDI clip (beat 0, 64 beats, `loop_beats` = pattern length); `noten`, `seq` (the view descriptor `{schema: 1, zeilen}` of `MidiClip.seq`) and `huellkurven` (`huellkurve_setzen` arguments without `clip_id`) fill the clip in the same command, all or nothing; the name is unique in the deck ignoring case. `clip_neu` and `clip_aendern` take `seq`. `seq_leeren {gruppe_id}` removes the group and its tracks and leaves foreign tracks alone. There is no step document and no translator: the lanes are a view on the notes and the clip envelopes. Refusals: `seq_belegt` (the place holds a deck), `seq_fehlt` (the group holds none), `kanal_offen` (`seq_anlegen` while `deck/<platz>` is open, trim plus fader above -26 dB; `seq_leeren` on an open channel for Cypher only), `kein_liveprojekt`, `argument_ungueltig` and `argument_unbekannt` with the reason in `text`/`detail`, plus the model's own capacity texts (sixteen groups).
- **Routes**, protection `fremdePost` (GET `offen`). The five POST routes answer `{rev, projekt, kern, hinweise?, gruppe_id}` (`projekt` is the project that was written, so the page needs no second read; `gruppe_id` names the removed group after `leeren`), or `{rev, projekt, gruppe_id, ohne_aenderung: true}` when nothing had to be written (no event, no undo step). Request bodies (any other field is `argument_unbekannt`, `platz` is an integer 1 to 4): `POST /seq/anlegen {platz}`; `POST /seq/leeren {platz}`; `POST /seq/folge {platz, name, geraet, loop_beats?}` (`geraet` is `bk:<graph>`, `kit:<kit>`, `rb338` or a device object; one pattern, muted when the writer is Cypher); `POST /seq/text {platz, text}` (the notation of `seq_text.ts`, one text is one write: all patterns or none; a new pattern of Cypher starts muted); `POST /seq/befehle {platz, label?, befehle: [1..2000 commands]}` (the page's click edits; one undo step with `label`). A command of `/seq/befehle` is checked against the project as it is when the write runs: only these commands and fields are accepted: `spur_aendern {spur_id, name, mute, solo, fader_db, pan, geraet}`, `spur_loeschen {spur_id}`, `clip_neu {spur_id, art, name, start_beat, laenge_beats, loop_beats, noten, seq}` (only on a pattern track, MIDI, `start_beat` 0, `laenge_beats` 64), `clip_aendern {clip_id, loop_beats, name, seq}`, `noten_neu`, `noten_aendern {clip_id, noten}`, `noten_loeschen {clip_id, ids}`, `huellkurve_setzen {clip_id, ziel, punkte, verknuepft, loop_beats}`, `huellkurve_loeschen {clip_id, ziel}`; the track named by `spur_id` must be a track of the deck group and the clip named by `clip_id` a clip of such a track (else `argument_ungueltig`); a `noten_neu` note that is already there (same clip, beat to 1e-6, pitch) is dropped, a list of only doubles writes nothing. `GET /seq/stand` takes the optional query `?zellen=1`, which adds `zellen` (one character per cell: `.` empty, trigger lane `o`/`x`/`X` by velocity band, pitched lane `x` where a note starts) to the rows with `art` `noten`; the answer without the query is unchanged. `GET /seq/stand` answers `{"1": null | {gruppe_id, folgen: [{spur_id, clip_id, name, geraet, stumm, editierbar, laenge_beats, zeilen, text}]}, ... "4": ...}`; `zeilen` are the lanes `{id, art, name, teiler, ziel?, ton?, von?, abgeleitet}`, `text` the pattern in the notation; a pattern that is not editable (laid out in PRODUCTION: several clips or a clip not at beat 0) has `editierbar: false, clip_id: null, laenge_beats: null, zeilen: [], text: null`. `GET /seq/geraet?spur_id=` answers the description of the instrument of a track, `{art: 'bk' | 'kit' | 'rb338' | 'anderes', regler: [{nr, name, vorgabe}], klaenge: [{ton, name}]}` (`nr` is the knob number of a Baukasten graph, a string target name for the RB-338; `klaenge` come from `kit.json` of the kit and are empty when it cannot be read). Every write goes through one promise chain, plans synchronously on the project it finds when it runs and reads `rev_veraltet` once more (a second miss is passed on), so two writers never overwrite each other's edits. Extra refusals of the routes: `deck_laeuft` (409, `/seq/anlegen` while deck N plays), `ki_gestoppt`, `seq_fehlt`, `kein_liveprojekt`, `spur_unbekannt` (404 of `/seq/geraet`), `huellkurve_ziel`, `rev_veraltet`, `zu_gross` (400: a write would store more than 32 lanes in the view descriptor; derived lanes are never cut and are not stored).
- **Module to SEQ deck** (spec: `docs/architecture/stand/modul-nach-seq.md`). `POST /seq/modul {slug, platz}` (`fremdePost`; any other field is `argument_unbekannt`) turns a Workbench module (a stored project with `werkbank.schema` 1, read from its file) into patterns of the deck of the place: one pattern per instrument track with an internal device (Baukasten graph with its knob values, kit, RB-338), the notes with `chance`, `wdh`, `versatz`, the `seq` view, the knob envelopes, the row settings (`zeile_setzen`), fader, pan, mute, solo; a pattern name that is taken (ignoring case) becomes `<name> 2`, `<name> 3`. A place without a deck gets one (the rules of `seq_anlegen` hold: `deck_laeuft`, `kanal_offen`) and takes mute from the module (solo never comes along: in the live container it would silence the other decks and loop modules); a deck that is there keeps everything and gets the patterns added, muted and not solo (the gates of `seq_anlegen` do not apply). A clip longer than 64 beats comes along up to beat 64 (pattern length `min(loop, 64)`). The answer is `{ok, bericht, rev, projekt, gruppe_id}`; `bericht` is `{platz, deck_neu, patterns: [{name, spur_id, quelle_spur}], weggelassen: {sends, inserts, master_inserts, returns, gruppen, kettenautomation, tonart, spuren_uebersprungen: [{name, grund}], gekuerzt: [{name, noten, punkte}]}}`. All or nothing and ONE undo step (label `load module <name> into SEQ <platz>`); the event `{a: 'seq'}` follows. Refusals: `kein_liveprojekt`, `kein_werkbank` (the slug is no module), `unbekannt` (no such project), `slug_ungueltig`, the new reason `modul_ohne_instrument` (no track that can come along; the body lists `spuren_uebersprungen`), the limits of the live container as `projekt_ungueltig` with the limit in `detail` (for example `spuren: at most 16 Baukasten tracks (bk)`), `ki_gestoppt`. The project access of the sessions gains the read-only `liesProjekt(slug)`. Hand tool `seq`, action `modul {platz, slug}`. Page: TO SEQ DECK in the workbench top bar (open LIVE with the usual confirmation, load, switch to the DJ view) and LOAD MODULE in the SEQ place.
- **Event.** `{a: 'seq', f: {platz, rev}}` after every successful write; the page re-reads the live project like on `{a: 'modul'}`.
- **Scenes** (card t_bdb34621). Project field `szenen?: ({an: string[], aus: string[]} | null)[]` (exactly 8 slots, ids are track ids; absent = empty), commands `szene_speichern {slot, an, aus}`, `szene_loeschen {slot}`, `szene_anwenden {slot}` (all slots 0 to 7; `szene_anwenden` sets the mutes of the saved picture in ONE undo step, skips tracks that are gone, yields regler rows only). Routes (`fremdePost` / `offen`): `POST /seq/szene {slot, aktion: 'speichern' | 'starten' | 'loeschen'}` (`speichern` takes the current mute picture of all SEQ decks, the body carries no ids; `starten` answers `{ok, wartet: {slot, ziel_beat}}` and switches all mutes together on the next project bar by one `/k/teil` per mute row with one shared `ab_beat`, plan `szene`, `gruppe` empty, `politik` 1, no new OSC address and no core change; the project is written when the first receipt 2, 3 or 5 arrives; a second launch first sends `/k/abbruch` with plan `szene` (last press wins); an M click between press and bar does not cancel the scene; with the transport stopped it applies at once); `GET /seq/szenen` answers `{szenen: ({an: number, aus: number} | null)[8], aktiv: slot | null, wartet: {slot, ziel_beat} | null}` (counts, not ids; `aktiv` is the slot whose picture equals the current mutes). `GET /seq/stand` is unchanged (decks only). Event `{a: 'seq', f: {szene: true}}` when the scene state changes. New reasons: `szene_leer_slot` (launch of an empty slot, 409), `szene_leer` (save without a SEQ deck, 409); also `argument_ungueltig` (slot outside 0 to 7), `ki_gestoppt` (source cypher only), `kein_liveprojekt`. Hand tool `seq`: `szene_speichern`, `szene_starten`, `szene_loeschen` (slot 1 to 8), `szenen`. Page: the row `#seq-szenen`. State: `docs/architecture/stand/seq-deck.md` section Scenes.
- **Channel.** A SEQ deck in place N is heard on the strip of `deck/N` (trim, EQ, kill, filter, fader, crossfader side, PFL, FX1 to FX3): the group output `{art: 'dj', nr: N + 2}`, derived and never stored (ADR 038). Known gap of slice 1: the hand tool can start deck N while a SEQ deck sits on its strip; both are then heard on one fader. The raw `seq_anlegen` is not gated by deck state (only the route knows it).
- **Write cost.** Every write loads the whole playback (the answer is sent after the core's load receipt, status 3, sent in the audio cycle that swaps the playback). Measured with a full deck: `docs/architecture/stand/seq-deck.md`.
- **Page.** The place type SEQ in the DJ view and the Studio view: a deck shows its patterns, each with a head (name, instrument, length, mute) and its lanes (notes, values, curves; a click toggles a cell, a drag sets velocity, the wheel moves a pitched step), plus + PATTERN, LOAD MODULE, CREATE and CLEAR in the place (`djk/ui/public/seq_view.js`, state `docs/architecture/stand/seq-deck.md`). **MCP.** Tool `seq`: `stand`, `anlegen`, `leeren`, `folge {platz, text}` (write) or `folge {platz, name}` (read one pattern as text from `/seq/stand`).

### 20.17 Page API sampler: cuts, kits and tones (spec 2026-11-16-sampler-slicer-design, plans A1, A2, B, C)

Playback side: §4.8 (the `sampler` block: `grenzen`, `noten_wahl`, the inputs `tempo`, `halb`, `ausklang`, the knob attribute `rastet`), §4.11 `/k/arr/note` and the per-note knob values. Everything else is page server: a cut is data of its own, and the devices, kits and tones made from it are ordinary Baukasten graphs and kits, so no playback field and no OSC address is new beyond `/k/arr/note`. Sources: `djk/ui/sampler/{schnitt,geraet,marken,text,kit,ton,ton_hoehe,wav}.ts`, `areas/sampler/{bereich,kit_routen,ton_routen}.ts`, `project/transients.ts` (`findeAnschlaege`), `wave_cache.ts`, `graphs.ts`, page `public/werkbank/{schnitt_streifen,schnitt_kit,schnitt_ton}.js`, MCP tool `sampler` in `djk/hand/hand.ts`.

- **Files.** A cut `<id>` (`/^[a-z0-9][a-z0-9-]{0,27}$/`: 28 characters at most, because the graph name `smp-<id>` must fit the 32 of a graph name) lives in `<store>/<id>/schnitt.json`, the store being `$CYPHERDJ_SAMPLER` or `~/.config/cypherdj/sampler`. Its audio is `smp-<id>.f32` in `<graph folder>/samples/` (stereo float32 48 kHz, frame 0 is beat 1, never changed afterwards, at most 2 880 000 frames), the generated device `<graph folder>/smp-<id>.json` and its panel `<graph folder>/panels/smp-<id>.json`, the graph folder being `~/.config/cypherdj/baukasten`. A write goes audio, graph, panel, `schnitt.json` last, each by temp file and rename; the cut folder is made first with `mkdir`, which reserves the id; a write that fails midway removes what it wrote, and a cut exists only with its `schnitt.json`. Every limit is refused and none is clamped.
- **`schnitt.json`** (`schema` 1): `id`, `name` (1 to 60 characters), `quelle` `{art: 'loop' | 'modul' | 'datei', ref, stem?}` (`datei` is reserved and refused `quelle_unbekannt`), `bpm`, `beats` (module sources: a multiple of 0.125, at most 64), `tonart?` (Camelot, module sources only), `frames`, `methode` (`raster`, `anschlag` or `hand`), `grenzen` (frame bounds: 2 to 65 integers, first 0, last `frames`, every slice at least 4 frames, so 1 to 64 slices), `guete` (one `{staerke, raster_abstand_beats}` per bound except the last: `staerke` 0 to 1 is the strength of the hit within 10 ms of the marker, 0 for none, `null` on a cut that was never cut again; `raster_abstand_beats` is the signed distance to the nearest 1/16 beat, 0 within 0.01 beat), `erstellt`, and the optional fields of plan A2 `ursprung` (the bounds as the method made them, kept by marker edits: the reference of the amber marks and of WRITE ORIGINAL ORDER), `treffer` (the hit frames used for `guete` and for snapping), `empfindlichkeit` (of an `anschlag` cut) and `geaendert`. Sources: a library loop (128 BPM by definition; the audio is the loop rotated by `versatz_frames` so that frame 0 is beat 1) or the WAV of a module's `Loop` track or of one stem track `<Stem> original` (the tempo follows from `laenge_beats` and the frame count, not from `herkunft.bpm`). Only 48 kHz stereo float32 sources are read (`format_falsch` otherwise); more than 60 s is `zu_lang` (413), a module without a usable length or a tempo outside 40 to 300 BPM is `kein_raster` (422).
- **Methods.** `raster` with `scheiben` 4, 8, 16, 32 or 64 (default: the finest of 1/16, 1/8, 1/4, 1/2 and 1 note that divides the loop into at most 64 whole slices): equal steps of the beat grid. `anschlag` with `empfindlichkeit` 0 to 1 (default 0.5; the jump threshold is 9 - 8 e dB, so 0.5 is the 5 dB of the production detector): one slice per hit found, the 63 strongest when there are more, a hit within 4 frames of an end merges into it, none at all is `keine_anschlaege` (422). `hand` takes `grenzen` and exists only on `POST /sampler/schnitt`; it is also the state of a cut after a marker edit. `scheiben` with `anschlag` and `empfindlichkeit` with `raster` are `argument_ungueltig`.
- **Generated device `smp-<id>`** (`device.ts`): format `baukasten/2`, 4 voices, `note` to `sampler` (`noten_wahl` 1, `grenzen`, file `smp-<id>.f32`), the gate plus HOLD into `gate`, `tempo` from SPEED, `halb` from PITCH, `ausklang` from RELEASE, then Crush (`krume`), a 2-pole `svf` low-pass and the gain `vel * 1.27 * Level` (so the grid's default velocity 100 is unity). No ADSR (its attack has a 0.5 ms floor and would soften every hit). Knobs of the first group: k1 LEVEL, k2 SPEED (0.25 to 4, log, centre 1, latched), k3 PITCH (-12 to +12 semitones, latched), k4 HOLD, k5 RELEASE (1 to 2000 ms), k6 CUTOFF, k7 RESO, k8 CRUSH; the panel has one section SLICES. The device has the category `sampler` (`listeGraphen` assigns it; it cannot live in the graph or in `panels/kategorien.json`). A changed cut is a changed graph text, so the production cache key (track, graph name, hash of the graph text) changes with it. A rewritten graph reaches a playing track only when the playback is loaded again (nothing watches the graph folder); the routes below do that themselves (`ladeLiveNeuFrei`, which honours the load lock of an export, a freeze or a recording and only remembers the wish until the release).
- **Tone device `ton-<k>-<n>`** (`tone.ts`): `k` is the cut id, or when it is longer than 25 characters its first 20 characters (no trailing `-`), `-` and its last 4; `n` 1 to 99 per cut. 8 voices; `note` through `transponiere` (TUNE, one semitone either way) into a `sampler` in pitch mode (`noten_wahl` 0, `grund` the root as a frequency, `grenzen` the one region `[a, b)`), an `adsr` (the ms knobs go through `mul 0.001`), the low-pass and the gain. Knobs: k1 TUNE, k2 ATTACK, k3 DECAY, k4 SUSTAIN, k5 RELEASE, k6 CUTOFF, k7 RESO, k8 LEVEL. The root `grund` is a MIDI note 16 to 95 (60 is C3; the block takes 20 to 2000 Hz). It is proposed from a YIN pitch detection of the region (median of up to 8 frames after the attack) from a confidence of 0.6 on, else from the key of the cut (the major root of the Camelot key, plus 9 for a minor key), else C3. The tone file `<store>/<id>/ton-<n>.json` (`schema` 1, `graph`, `schnitt_id`, `nr`, `name`, `scheiben` `[von, bis]` 0-based, `a`, `b` frames, `grund`, `grund_quelle` (`erkannt`, `tonart`, `vorgabe` or `hand`), `erkannt` (the detection `{note, hz, konfidenz}`), `erstellt`) is written last; the tone has the category `sampler` too.
- **Kit** (`kit.ts`): the selected slices become `<kit folder>/<name>/<note>.f32` (the slice bit for bit with a 5 ms end fade, at most 10 s) and `kit.json` last (`{schema: 1, name, klaenge: [{note, name, datei, frames, quelle: 'schnitt:<id>/<slice from 1>'}]}`), the kit folder being `$CYPHERDJ_KIT_ORDNER` or the configured one. Notes from 36 upward in ascending slice order, at most 92 sounds, at most 256 MiB. The writer is its own (it takes the lock folder `.sperre` and the order of the two others, `loops/kit_write.mjs` and `break_kit.py`, which use other note rules); a new kit is made with `mkdir` without `recursive`, so an existing name is `kit_vorhanden`. The name of a sound is `<bank>:<k>`, numbered per bank in slice order from 0 without gaps (the live generator reaches a sound only so), so only the bank is given (`/^[a-z][a-z0-9_]{0,15}$/`, proposed `bd`, `sd`, `hh` or `perc` from the low, mid and high balance of the first 100 ms). The kit name is `[a-z0-9_-]{1,32}`, by default made from the cut name. The kit is then an ordinary kit: instrument of a DRUM track (`geraet {art: 'intern', name: 'kit', kit}`) and sound set of `proj_muster` on that track. The live DRUMS stream has its kit fixed when the generator starts and does not see a new one.
- **Routes** (`areas/sampler/`; GET is `offen`, POST is `fremdePost`; a POST of source `cypher` is `ki_gestoppt` under Stop Cypher; a bad body field is `argument_unbekannt`; a refusal of the cut layer answers `{fehler, text}` with the code named below). `GET /sampler/quellen` answers `{loops: [{name, beats, stumm?}], module: [{id, titel, beats, bpm, audio: [{stem, name}]}]}` (`stem` null is the module's `Loop` track; `stumm: true` marks a library loop whose audio never passes -60 dBFS, the page disables its SLICE TO TRACK). `GET /sampler/liste` answers `{schnitte: [{id, name, quelle, bpm, beats, scheiben, geraet}]}`. `GET /sampler/schnitt?id=` answers `{schnitt}`, with `&format=text` `{id, text}` (a header line and one line per slice: number from 1, start and length in beats, strength, grid distance). `POST /sampler/schnitt {quelle, name?, methode?, scheiben?, empfindlichkeit?, grenzen?}` makes a cut and answers `{schnitt}`. `POST /sampler/spur {id}` or `{quelle, name?, scheiben?, methode?, empfindlichkeit?}` is SLICE TO TRACK: with `quelle` the cut is made first and removed again when the track is refused; one history step `werkbank_spur_neu` makes an instrument track with the device and one note per slice in the original order (velocity 100, a grid cut on the exact grid `k * beats / n`, a hit or hand cut at the beat of its bound, not quantised), SPEED set by FIT, the track fader at 0 dB (`werkbank_spur_neu` takes an optional `fader_db`; without it a new track starts at -6 dB); a cut longer than the module length (the loop `0..bars*4` with 1, 2, 4, 8 or 16 bars) raises it in the same step to the first length that holds the cut; answers `{rev, projekt, spur_id, schnitt_id, fit, modul_takte?}` (`fit` is the knob value, `null` when the project tempo is outside 0.25x to 4x of the cut and SPEED stays at 1; `modul_takte` is the new module length in bars when it was raised). It needs an open workbench module (`kein_werkbank`) with a free instrument slot (`werkbank_voll`, at most 8; `kein_projekt` otherwise). `POST /sampler/fit {spur_id}` sets SPEED to project tempo over cut tempo (`{rev, projekt, wert}`; `fit_ausserhalb` 409, `kein_schnitt_geraet` 409 for a track that plays no cut). `POST /sampler/hoeren {spur_id, scheibe}` (`scheibe` 0-based) sends `/k/arr/note` on for that slice (velocity 100) and the off after `min(10 s, slice frames / 48 / SPEED)` ms; one note sounds per track, a new request first ends the previous one; the off always goes as `andreas`; answers `{ok, dauer_ms}` (`hoeren_abgelehnt` with the core's reason, `kein_kern`). With the fields `spur_id` and `ton` instead (`ton` 0 to 127, exactly one of `scheibe` and `ton`) the same route plays one note on any instrument track for 400 ms (`kein_instrument` 409 otherwise): the workbench grid sends it for a click on a piano key or a drum row, and `scheibe` for a slice row. `POST /sampler/neu_schneiden {id, methode: 'raster' | 'anschlag', scheiben?, empfindlichkeit?}` cuts the same audio again under the same id (the old bounds are not kept; device and tracks follow; `ursprung` is rewritten) and answers `{schnitt, spuren, text}`; the patterns keep their slice numbers. `POST /sampler/marke {id, art: 'schieben' | 'neu' | 'weg', marke?, frame?, beat?, einrasten?}`: `marke` is the index of a bound, 1 to slices minus 1 (bound k is where the 0-based slice k starts), for `schieben` and `weg`; `schieben` and `neu` take exactly one of `frame` and `beat`; `einrasten` (default true) snaps to the nearest hit or 1/16 position within 1/16 beat, a hit winning a tie. The cut then has `methode` `hand`, `ursprung` stays (or becomes the bounds before the first edit) and `guete` is measured again. Moving a marker leaves every pattern alone; `neu` and `weg` renumber the notes of every track of the open project that plays the cut, in one history step (note `t` and `64 + t` follow their slice; a split slice keeps its hits on its first part; a merged pair plays as the first), while tracks of modules that are not open keep their numbers; an undo reverts the renumbering only, not the marker. Refusals `marke_unbekannt` (404), `marke_zu_nah` (409, a slice under 4 frames), `zu_viele_scheiben` (409, 64 slices at most). `POST /sampler/ursprung {spur_id}` replaces the notes of the track's first MIDI clip with the original order in one history step (`{rev, projekt, text}`; `kein_clip` 409). `POST /sampler/loeschen {id}` deletes a cut with its tones (graph, panel, audio, store folder); it is refused with `schnitt_in_gebrauch` or `ton_in_gebrauch` (409) when the open project (track device, rack member, insert stage `bk`, stream channel), any stored project or any module of the store still plays a device of it, and the answer lists `spuren` and `fundstellen`. `GET /sampler/kit/vorschlag?id=&scheiben=0,3,5` answers the proposal `{kit, klaenge: [{scheibe, note, bank, name, frames, sekunden, baender: {tief, mitte, hoch}, zu_lang}]}`; `POST /sampler/kit {id, scheiben, banken?, kit?}` writes the kit and answers `{kit, klaenge: [{scheibe, note, name, datei, frames}]}` (`klang_zu_lang` 400, `kit_vorhanden` 409, `kit_gesperrt` 409). `POST /sampler/ton {id, von, bis?, grund?, name?, spur?}` makes a tone (slices 0-based, `bis` defaults to `von`) and answers `{ton, text, tonart?}`; with `spur: true` it also makes one NOTE track with one note at the root in one history step (`+ rev, projekt, spur_id`; the checks of SLICE TO TRACK; `toene_voll` 409 at 99 tones). `GET /sampler/ton?graph=` answers the same; `POST /sampler/ton/grund {graph, grund}` rewrites the graph and the tone file and reloads the playback when a track plays the tone (`neu_geladen`, or `neu_laden_aufgeschoben` while a load lock holds); `POST /sampler/ton/loeschen {graph}` deletes one tone (`ton_in_gebrauch`, `ton_unbekannt` 404).
- **Waveform.** `GET /welle?schnitt=<id>` answers the waveform of the cut audio in the format of `?loop=` (`unbekannter_schnitt` 400 for an id that does not match, `schnitt_fehlt` 404; the cache key carries mtime and size).
- **Page.** In STUDIO: the LOOPS tab of the shelf (SLICE TO TRACK on a library loop or a module audio), the grid kind SLICE (one row per slice, a hit with a mark when reversed, REVERSE as a step value that toggles the note bank, a PITCH lane that is a step lock: the value holds for its own step only, a hit belongs to its nearest step and the lock covers half a cell either side), the strip above the panel (waveform, numbered slices, a bar per marker for the two quality numbers, click to hear, shift-click to select, GRID and HITS with a sensitivity, CUT AGAIN, WRITE ORIGINAL ORDER, markers dragged with snap, Alt for no snap, double-click on a handle removes it, double-click on a slice adds one, a moved marker in amber, FIT), TO KIT and KIT TO TRACK on the selection (the dialog closes when its cut changes), TO TONE on the selection with a ROOT selector on tone tracks. The SEQ deck and PRODUCTION use the devices like any Baukasten instrument.
- **MCP.** Tool `sampler` (the 92nd tool of the hand), one `aktion` of `quellen`, `liste`, `neu`, `lies`, `spur`, `kit`, `ton`, `schneiden`, `marke`, `ursprung`, `loeschen`. The hand numbers slices from 1 in every text and argument and the routes count from 0, so it converts: `kit {id, nummern, namen?, kit?}` sends `scheiben = nummern - 1`; `ton {id, von, bis?, grund?, name?, spur?}` (`spur` default true here) sends `von - 1`, `bis - 1`; `marke {id, art, scheibe?, beat?, einrasten?}` sends `marke = scheibe - 1`, so `scheibe` is 2 or more (slice 1 starts at 0 and has no marker); `schneiden` is `neu_schneiden`; `loeschen {id}` or `loeschen {ton_graph}` (sent as `graph`) deletes a cut or one tone; `neu` and `spur` take `methode` `raster` or `anschlag` (never `hand`), and `spur` takes exactly one of `id` and `quelle`. The answers of `lies`, `schneiden`, `marke`, `ursprung`, `kit` and `ton` carry a text (the cut as text, the route's sentence, or the kit and tone line). A wrong shape is refused in the hand without a request (`argument_ungueltig`). Cypher's writes obey AUTO and Stop Cypher (`ki_gestoppt`). Slice patterns are written with `proj_aendern` (`noten_neu`, `noten_aendern`) on the track, `ton` = slice number - 1, reversed + 64.
- **Known limits.** The generated track plays about 9 dB below the source loop (track fader default -6 dB and the pan law -3 dB). A cut can be deleted only through the hand tool, the page has no button for it. A kit made from hits reaches the live DRUMS stream only after a restart of the studio with `--strudel-kit`; the way to play a new kit at once is `proj_muster` on its kit track. A source of 32 or 64 beats in a 16-beat module plays only its first half. The slice device's low-pass stays in the chain (at CUTOFF 20 kHz it is 3 dB down at 20 kHz). The SEQ deck derives one pitched lane for a Baukasten graph and shows no slice rows (`seq_logic.js` rounds a note to its step down, the SLICE grid rounds to the nearest). A tone stores frames and its text names the slices as they were, which can age after CUT AGAIN.
### 20.18 Page API workbench: file export, row settings, loop range (specs 2026-11-15-werkbank-design, 2026-11-16-werkbank-dock-sequencer-design)

- **Export routes** (`areas/proj/output.ts`, POST, `fremdePost`): `/proj/export_midi` writes `<slug>.mid` (sum) and `<NN>-<name>.mid` per instrument track (format 1, 480 PPQ); `/proj/export_spuren` renders `mix.wav`, `<NN>-<name>.wav` per track and `fx<nr>-<name>.wav` per return (a return part ignores solo); `/proj/export_zeige` opens the folder. Target `<project>/export/<slug>-<YYYYMMDD-hhmmss>/`; the answers carry `ordner` and the files relative to it. A workbench module exports its module length, not a loop range. Reasons: `export_leer`, `keine_arbeitsflaeche`, `projekt_offen`.
- **Note fields** (optional, never written with their default; `noten_neu`, `noten_aendern`, `null` in `noten_aendern` removes): `chance` 1..99 (percent), `wdh` 2..8 (hits inside the step), `versatz` -95..95 without 0 (percent of a sixteenth).
- **Row settings.** `MidiClip.zeilen["<ton>"] = {schritte?: 1..128, swing?: 1..100, richtung?: "pendel"}`; command `zeile_setzen {clip_id, ton, schritte?, swing?, richtung?}` (`null` removes a field, an empty row disappears).
- **Unrolling** (`project/playback.ts` `fuerAusgerollteNoten`, shared by playback, render and MIDI export): a row with `schritte` repeats with its own period over the clip length, `pendel` runs every second pass backwards, `swing` delays every second sixteenth of the row, `versatz` moves a note, `wdh` splits it, `chance` draws every copy with a generator seeded from clip id, note id and copy index (the same in playback and export, no new draw per loop pass). Copy ids: `<clip>~<k>/<note>`, further hits of a repeat `<id>.1` .. `<id>.7`. The core still receives only `id, beat, laenge, ton, vel`.
- **Loop range.** `WerkbankMarke = {schema: 1, laenge_beats?}`; `werkbank_bereich {von_beat, bis_beat}` (whole beats, inside the module) sets the project loop to the range and remembers the module length, `werkbank_bereich {aus: true}` restores it. New reason `modul_bereich`.
- **Module length.** The page sets it with one step: `loop_setzen` 0..bars*4 plus `clip_aendern {laenge_beats, loop_beats}` on every MIDI clip of the module, bars 1 to 128; growing copies the pattern into the new bars as notes. A clip longer than 64 beats cannot be edited in the SEQ deck of the production view (it requires exactly 64).
- **Project key.** `Projekt.tonart = {grundton: 0..11, skala}` (optional, only in format /2, never written when absent; `skala` is a name of `SKALEN` in `ui/public/harmonie.js`: minor, major, dorian, phrygian, harmonic_minor, melodic_minor, mixolydian, lydian, locrian, minor_pentatonic, major_pentatonic, blues). Command `tonart_setzen {grundton, skala}` sets it, `tonart_setzen {aus: true}` removes it; a wrong value is `argument_ungueltig`. The key is a view and editing help of the note editors (marked rows, fold, snap, chords); playback, render and export never read it, so the command never changes `wiedergabe_rev`.
- **Panels.** Optional field `front: ["k<n>", ...]` (at most 6) in a panel file names the knobs of the compact card in the workbench dock; `pruefePanel` ignores it.



| Date | Version | Change |
|---|---|---|
| 2026-09-23 | 1 | first version from the synthesis of the architecture night |
| 2026-09-23 | 1 | critique round (ARCHITECTURE "Kritik und Korrekturen"), version stays 1 because nothing is built yet: autonomy allowlist (§10); I3 as "new content only with listening pass" with `offen`, content and section (§1.6, §4.5, §17); `hörbar` requires a running deck, deck parts with `plan`/`gruppe`/`hoerschein` (§4.4); listening pass renewal per bar (§14.5); entry (§10, §14.2); stems or base (§4.4); versions instead of overwritten files (§13); bar one and text (§13.2); six bands in the envelope ring and `huelle_1khz` defined (§6.2, §13.1); Notbahn bar fields in the ring, ports from the unit, interlock (§6.1, §8); subscribers in the state, `/q/stand` (§4.1, §5.1); playing style as full rule (§14.4), low limits only warning (§11); target LUFS and trim up to +24 dB (§1.5, §2.1); routing with buses (§1.5); gates with independent instrument, stretch factor, bar one, tuning (§12.3); hand tempo as ramp (§1.3); configuration schema (§2.1); V0, golden sequences, build dependencies (§19) |
| 2026-09-24 | 1 | slice 02: roadmap additions Z1 (test click `/test/klick`, only with `pruefmodus`) and Z2 (test instances via `CYPHERDJ_INSTANZ`) carried over per §19.0; test operation only, no set semantics, version stays 1 |
| 2026-09-24 | 1 | §1.3 made precise: rounded `s0` requires `b0` on the continuous curve at this sample. Finding slice 02 (rounded `s0` with ordered beat misses `sample(192,0)` and the `/uhr` step at 4 286 976 in `uhr_golden` by 3.53·10⁻⁶ beats); the core already computes this from slice 01 (`djk/core/src/clock.cpp`, `rampe`), `map.py` keeps `s0` unrounded, both hit the table. No number changed, version stays 1. |
| 2026-09-25 | 1 | §12.3 and §20 aligned with §2.1: gate `streckfaktor` 0.20 (M19) instead of 0.15; the value had stood only in §2.1 since ff24935. Finding of test slice 09; no new decision, version stays 1 |
| 2026-09-25 | 1 | §16.2 extended by `grenze_sub` (dossier 09 V4) and `neustart` (§16.3 already named it); finding slice 09, plan finding 3 and 5. Version stays 1 |
| 2026-09-25 | 1 | §14.1: deck parts carry the hotcue number as `hotcue_nr` and the roll type as `roll_art` (name clash with `nr`/`art` of the part; finding slice 09, plan 21 already uses the names). New optional fields, version stays 1 |
| 2026-09-25 | 1 | §7.3 point 7 after M4 (slice 33, E3 to E7): factor bar 43 blocks, phase control \|c\| ≤ 100 ppm on the delay model, never factor closer than 10⁻⁶ to 1.0; replaces "10 ppm per block" (set, refuted). Version stays 1 |
| 2026-09-25 | 1 | readings from slice 09 decided (Andreas): b rejection at the start takes the group with it (§4.3 field 11); e grab breaks off immediately (§4.3, ADR 023); n I1 checks via the switching ramp, §14.1 example part 1 on beat 447, rule §14.4 likewise. Remaining eleven to `docs/architecture/entwuerfe/2026-09-25-lesarten-09.md`. Version stays 1 |
| 2026-09-26 | 1 | slice 35, finding B-O (decision of the main instance, path 1): §2.1 `hand_osc` (bool, false) allows `/test/hand` even without `pruefmodus`; §19.0: `deck/<n>/play`, `deck/<n>/cue` and `taste/<name>` (§5.8 without encoder values) are valid `pfad` of `/test/hand`. New optional key, version stays 1 |
| 2026-09-27 | 1 | §4.4 `/k/deck/laden` and `entladen`: blocked only if the deck runs AND is open (before: open). Finding at the Digital-Out (Andreas: "loading a new track does not work via load a"). Version stays 1 |
| 2026-09-27 | 1 | Strudel in the core, stage 1 (ADR 024): §4.8 `ziel` `kit:<name>`, kit form, I3c suspended, 20 `/erz/ev` per bundle; §5.6 `/pegel` also `erz/1`. New target form, version stays 1 |
| 2026-09-27 | 1 | MVP 2, slice 1 (ADR 025): §4.9 `/k/loop/laden`, `/k/loop/start`, `/k/loop/stopp`; §5.11 `/e/loop`; §5.6 `/pegel` also `pad/1`, `pad/2`; §1.5 `pad/*` are the loop boxes. New addresses, version stays 1 |
| 2026-09-27 | 1 | MVP 2, slice 2 (ADR 025 follow-up plan): §4.9 `/k/loop/rec` (recording of `erz/1` before trim); §5.11 `/e/mitschnitt`; §6.3 recording not in the restart state. New addresses, version stays 1 |
| 2026-09-28 | 1 | Plan E9 (deck operation): §4.4 `raster_beats` also 16 (four bars, snap grid of the page, spec E9). Additive, version stays 1 |
| 2026-09-28 | 1 | Plan 3 (beat FX, spec E8): §4.10 `/k/fx`, §5.12 `/e/fx`. New addresses, version stays 1 |
| 2026-09-28 | 1 | ORDER (two beat FX units, assignment per channel instead of CH choice, three parameters per unit after the S8 model): §4.10 `/k/fx` carries `einheit`, `param1..param3` instead of `kanal`/`param`, new `/k/fx/zuweisung`; §5.12 `/e/fx` likewise, new `/e/fx/zuweisung`. New addresses, version stays 1 |
| 2026-09-28 | 1 | Review E9: §4.4 `/k/deck/hotcue` on a stopped deck exactly to the hotcue (before also phase-accurate there); hand play/pause keeps a loop, `/k/deck/start`, `/k/deck/stopp` and CUE end it; a transport button discards waiting loop/jump/hotcue of the deck (receipt 7 `abbruch`). Version stays 1 |
| 2026-09-28 | 1 | Plan Grid: §4.4 `/k/deck/raster` (grid offset per deck, absolute, immediately); §5.9 `/e/raster` also from `/k/deck/raster`. New address, version stays 1 |
| 2026-09-28 | 1 | Plan Grid: §4.9 `/k/loop/raster`, `loop.json` optional `versatz_frames`. New address, version stays 1 |
| 2026-09-28 | 1 | Plan Ohr, task 1: §6.2 `cap` 65536 → 16384 (16.4 s instead of 65.5 s history, 16 instead of 64 MiB locked memory; the reader reads continuously, the ring only has to hold 4 bars); channel 14 `master` and channel 15 `cue` added as a sentence. Version stays 1 |
| 2026-09-28 | 1 | Plan Ohr, task 15 (FX routing like Traktor, Andreas: yes): §4.10 `/k/fx/routing`, §5.12 `/e/fx/routing`. New addresses, version stays 1 |
| 2026-10-06 | 1 | Wave 2 Klickfrei (audit F10, F13, F15): §4.2 /k/set/neu, §4.4 /k/deck/start, §4.9 /k/loop/laden, /k/loop/start, /k/loop/stopp with crossfades, §5.11 /e/loop when loading into a sounding box; kill of the hand runs out the 5 ms switching ramp of §1.5, /e/regler reports only 0/1 in the process (F18). Lengths belong to 06.10. (Andreas: "everything fits"). No new addresses, version stays 1 |
| 2026-10-11 | 1 | Bar one (§13.2, §12.3): majority share and first kick decide, gate `eins` judges on it, low-band fallback removed; SET/FIX writes art=eins into the material, raster files are inherited by new versions. Version stays 1 (new fields optional) |
| 2026-10-15 | 1 | D1 K1 (spec D1 2.2, 3.1, ADR 030): §4.11 `/k/arr/laden`, `/k/arr/start`, `/k/arr/stopp`, `/k/arr/loop`, `/k/arr/metronom`, `/k/arr/freeze` (the core executes freeze only with package K3, until then `unbekannte_adresse`), §5.13 `/zustand/arr` and `/e/freeze`, §16.2 six reasons (`datei_fehlt`, `format`, `audio_fehlt`, `zu_gross`, `spur_bereich`, `reserviert`). New addresses, version stays 1 |
| 2026-10-15 | 1 | D1 K1: §1.5 track control `spur/<n>/fader`, `pan`, `mute`, `solo` (n = 1..8, global, everyone may, default 0 dB), §4.7 `/k/ki/spur` takes `spur/<n>`; after the review (D1 6.15, 6.16): track fader up to +6 dB, `/k/ki/spur` with its own track list and short form `spur/<ziffern>`, §4.11/§5.13 field `nr` instead of `rev`. New controls, version stays 1 |
| 2026-10-15 | 1 | D1 K1: §2.1 `arr_ordner` and `arr_budget_mib` (sub-budget of `speicher_budget_mib`). New keys with default, version stays 1 |
| 2026-10-15 | 1 | D1 K1: §5.6 `/pegel` reports `spur/<n>`; §6.1 ring header byte 56 `sample_minus_w` (before reserved, size unchanged). Version stays 1 |
| 2026-10-15 | 1 | D1 K1: §7.2 hand target type `arr/start_stopp`, §19.0 `/test/hand` takes it. Version stays 1 |
| 2026-10-16 | 1 | package K3 (spec D1 2.5, 3.1, 6.14, 6.25, 6.27, 6.29, 6.33): §4.11 `/k/arr/freeze` executed (receipts 1, 2, 3, 7, reasons, buffer and file in the load thread, never replacing), §5.13 `/e/freeze` status 0 finished, 1 cancelled, 2 file not written; §16.2 `tempo_rampe`; §6.1 reader `cypherdj-mitschnitt`. Version stays 1 |
| 2026-10-16 | 1 | package K3, fix round 2: §4.11 `/k/arr/freeze` names `/k/set/neu` among the cancel reasons (receipt 7 `abbruch` at sample 0 of the new timeline, `/e/freeze` 1; this is how the core has run it since the first fix round). No new address, version stays 1 |
| 2026-10-17 | 1 | audible drag (scrub): §4.4 `/k/deck/scrub` (grab, move, release, without receipt; the deck reads the material at the hand position). New address, version stays 1 |
| 2026-10-21 | 1 | §4.4 `/k/deck/loop_laenge` (change loop length with fixed start). New address, version stays 1 |
| 2026-10-20 | 1 | package 1.18, decision E-a: §4.7 `/k/ki/stopp` no longer lowers any fader (channels and tracks of the AI track lists stay as they are, parts of `cypher` end as with `/k/abbruch`); `/k/ki/spur` continues the lists, with no effect on the stop. No new address, no new fields, version stays 1 |
| 2026-10-20 | 1 | package 1.18, decision E-a (transport): §4.7 `/k/ki/stopp` no longer ends a running arrangement transport started by `cypher`; a start by `cypher` still waiting continues to end with 7 `ki_stopp` (§4.11 `/k/arr/start`), likewise its freeze (`/k/arr/freeze`) and waiting deck commands (§4.4). No new address, no new fields, version stays 1 |
| 2026-10-21 | 1 | E3 S1 (P1): §4.7 `/k/ki/spur` takes only `spur/0` for tracks; the track mask (`spur/<ziffern>`, `spur/<n>`) is dropped and rejected like an unknown channel (6 `unbekannter_regler`). No new address, no new fields, version stays 1 |
| 2026-10-21 | 1 | E3 S2 (task 6): §1.5 track control `spur/<n>/*` applies for n = 1..32 (before 1..8), §4.11 `/k/arr/freeze` field `spur` and §5.13 `/e/freeze` field `spur` 1..32, `/k/arr/laden` limit 32 tracks. New controls (564 instead of 468), no new address, version stays 1 |
| 2026-10-22 | 1 | E3 S2/S3 (task 7, 8, 12): history cap `MAX_BEWEGT` 128 → 256 (opening a project sets 4 · 32 + 16 = 144 controls with history in one cycle); pools `ARR_STIMMEN` 64 → 256 and `ARR_OFFEN` 256 → 1024 (§4.11, per track as with 8 tracks); page and server: `MAX_SPUREN` = 32. Internal, no new address, no new fields, version stays 1 |
| 2026-10-24 | 1 | 1.10 slice 1: §1.5 `grp/<n>/*`, `pm/fader` (597 controls), §4.11 playback `cypherdj-arr/2` (`ausgang`, `gruppen`, loader rules; the core reads `/1` and `/2`), §5.6 `/pegel` reports `grp/<n>` and `pm` (ADR 033). New controls and new playback format, no new OSC address, version stays 1 |
| 2026-10-24 | 1 | 1.10 slice 2: §5.13 `/zustand/arr` field `limiter_db` (gain reduction of the set limiter, type chain `,iiidhdif`), §4.11 export tap in the core (no OSC command). The type chain of an existing address changes: core and page server must be restarted together. Version stays 1 as per the plan; the rule at the head of this file would require a new address or version for it, the deviation is confirmed by the main instance |
| 2026-10-24 | 1 | package 1.13 slice 1 (warp, ADR 031): §4.11 `clips[].warp` (`modus` 0 RE-PITCH, `w` marker [clip beat, source frame]) in playback `cypherdj-arr/2`; the page server writes `/2` also for a warped clip. New field in the existing format, no new OSC address |
| 2026-10-24 | 1 | package 1.13 slice 2 (warp, ADR 031 part 2): §4.11 `clips[].warp.modus` 2 (COMPLEX) and 3 (TONES); §5.13 new address `/zustand/warp` (counter of the warp engine; `/zustand/arr` stays unchanged); §16.2 reason `warp_maschine_fehlt`; §2.1 key `warp_faeden`. New address, version stays 1 |
| 2026-10-28 | 1 | package 1.13 slice 5 (warp, transpose/detune): §4.11 optional field `clips[].warp.pitch` in `cypherdj-arr/2`; no new reason, no new address. Additive, version stays 1 |
| 2026-10-29 | 1 | package 1.13 slice 3a (warp, auto-warp long): no new OSC and no new playback field. Page API: GET /proj/aktuell (both views) carries transiently analyse [{clip_id, status wartet\|laeuft}] (missing if none runs); SSE {a:'proj', f:{clip_id, analyse}}; GET /proj/warp: marker_max (default 200), marker_gezeigt, weiter_ab_projekt_beat, tempo, erster_marker; hints analyse_angefordert, analyse_laeuft, karte_zu_gross, karte_unbrauchbar. Workshop: individually --nur-analyse (status analysiert); gate raster as program (gate_grid.py). Date = day of the target acceptance, merge after the listening acceptance |
| 2026-10-29 | 1 | Baukasten S3b (graph engine): §2.1 new key `graph_faeden` (default 2). Additive, version stays 1 |
| 2026-10-29 | 1 | Baukasten S3c: §4.10 `/k/kanal/graph` (effect graph as insert in deck/1..4); §16.2 `kein_eingang` here too. New address, version stays 1 |
| 2026-10-30 | 1 | package 1.13 slice 3b (warp, markers by hand): no new OSC and no new playback field. Page API: new commands in `POST /proj/aendern`: `warp_tempo {clip_id, faktor 2|0.5}`, `warp_marker {clip_id, setze?, loesche?, verschiebe? (neu_beat | neu_quell_s)}`, `warp_ab_hier {clip_id, beat, art gerade|start}`, `eins_hier {clip_id, quell_s}`, `tempo_vom_clip {clip_id}` (the server converts it into `tempo_setzen`); new reason `marker_unbekannt`; new `hinweise` in the answer of `aendern`: `eins_gemeldet`, `eins_nur_hier`, `eins_rueckweg_fehler`; server option `--korrekturen` (environment `CYPHERDJ_KORREKTUREN`). The server writes `bestand/<sha[:16]>/korrekturen.jsonl` (line `art eins`, `von andreas`, §13.3). Additive, version stays 1 |
| 2026-10-30 | 1 | package 1.13 slice 6 (stems): page API §20.1, `stumm` on the clip, no OSC change. Additive, version stays 1 |
| 2026-10-31 | 1 | Baukasten S5r: §1.5 `<k>/bk/<1..8>` (graph knobs, 96 new controls, 693 instead of 597) on deck/1..4, erz/1, 2, 3, 5, 6, 7, pad/1, 2. New control paths, no new address, version stays 1 |
| 2026-10-31 | 1 | package 1.13 slice 7 (merge): page API §20.2, `ausgabe_lauf` knows `merge`, no OSC and no playback field. Additive, version stays 1 |
| 2026-10-31 | 1 | Baukasten S6: §4.10 `/k/kanal/graph` takes `fx/3`, `fx/4` (effect graph on the send returns, `graph_kanal` gains two entries); §1.5 returns scale with `fx/3/rueckweg`, `fx/4/rueckweg`. No new address, version stays 1 |
| 2026-10-31 | 1 | Baukasten S10: §4.8 note on `bk:<name>` graphs: `sampler` nodes read their files from `<bk_ordner>/samples/` at load time. No new address, version stays 1 |
| 2026-10-31 | 1 | Baukasten S12: §4.8 `/erz/strom` target `bk:` with an empty name restores the stream's last kit/midi target (kern remembers it per stream). No new address or reason, version stays 1 |
| 2026-10-31 | 1 | Automation Slice 1 (ADR 032): §4.11 optional `spuren[].auto` (lanes with `[beat, wert, form]` triples) in `cypherdj-arr/2`; the server writes `/2` also when only `auto` is the reason. No OSC address and no new reason (`format` and `zu_gross` apply). Additive, version stays 1 |
| 2026-10-31 | 1 | 1.10 Slice 3: §1.5 `spur|grp/<n>/send/<r>`, `ret/<r>/*` (+204 controls, 897 of 1024), §4.11 playback `returns` (optional, only `/2`); no new OSC address; version stays 1 |
| 2026-11-01 | 1 | Baukasten S21: §4.8 note on faltung IR files. No new address, version stays 1 |
| 2026-11-01 | 1 | Baukasten S14: §1.5 `fx/<n>/bk/<m>` (graph knobs of the send returns fx/3, fx/4, 16 new global controls, 913 of 1024); §4.10 send graphs follow them. New control paths, no new address, version stays 1 |
| 2026-11-01 | 1 | Baukasten S16: §4.10 `/k/graph/frage`, §5.12 `/e/graph` and value list `graph_platz` (the kern reports which graph sits on each channel). New addresses, no new reason, version stays 1 |
| 2026-11-01 | 1 | Baukasten S19: §4.7 /k/lernen, §5.8 /e/gelernt, §7.2 learn table lernen.json (slot 1 on midi_ein_1). Additive, version stays 1 |
| 2026-11-01 | 1 | Baukasten S18: §4.12 `/k/rec/spur` `eingang` range [0, 22]: `10+N` = `erz/N` (N 1..3, 5..7), `20+N` = `pad/N`; 14 and 18 refused; §5.6 `/pegel` also `erz/5..7`. No new address or reason, version stays 1 |
| 2026-11-01 | 1 | Baukasten S15: optional `entstehung` on audio clips (page API §20.3), erzeuger `status.json` `noten`, `POST /graph` refuses an instrument on a kit-mode stream from the source `cypher` with `kein_midi_strom` (Andreas's page gets `warnung` on the 200 answer instead). No OSC change, version stays 1 |
| 2026-11-01 | 1 | Baukasten S20: §4.11 playback `intern` tracks may carry `geraet: "bk"` with `graph` and `parameter` k1 to k8 (loader reasons `format`, `zu_gross`); `cypherdj-render` gains `--bk-ordner`. No new OSC address, version stays 1 |
| 2026-11-02 | 1 | Automation Slice 3 task 3: §4.11 `/k/arr/auto` (override and re-enable of a lane, `spur 0` = all), §5.13 `/e/auto` (state of the override per track field), value list `auto_ziel`, §16.2 reasons `nur_andreas` (now general: Andreas' own action) and `auto_ziel_unbekannt`. New addresses and reasons, version stays 1 |
| 2026-11-02 | 1 | Automation Slice 3 task 7: §4.11 `/k/arr/arm` (arm one track for automation recording, `spur 0` with `an 0` disarms all), §5.13 `/e/auto_punkt` (points of a hand gesture on an armed track while playing). New addresses, version stays 1 |
| 2026-11-02 | 1 | Automation Slice 3 task 10: §20.4 page API `POST /proj/auto/arm`, `/proj/auto/geste`, `auto_arm` in `/proj/aktuell`, SSE `auto_arm` and `auto_aufnahme`, `auto_neu` with optional `punkte`; Cypher is refused with `nur_andreas`, there is no MCP tool to arm. No OSC change, version stays 1 |
| 2026-11-03 | 1 | Package 1.15 A1b (mix tools): §1.5 `<k>/gate/*`, `<k>/util/*`, `bus/<n>/mb/*`, `bus/<n>/lim/*`, `spektrum/kanal` (345 new controls, 1258 of 2048); §2.1 new keys `kanal_limiter_vorhalt_ms`, `kanal_limiter_echtspitze`. New control paths and keys, no new address, version stays 1 |
| 2026-11-03 | 1 | Package 1.15 A5b (mix tools): the channel limiter on bus/1..4 is built from `kern.toml` `kanal_limiter_vorhalt_ms` / `kanal_limiter_echtspitze` (§2.1) and sets the latency account (D8); `bus/<n>/lim/*` act; the export alignment `vorhalt` of `cypherdj-render` carries L. No new control, address or key, version stays 1 |
| 2026-11-03 | 1 | Package 1.15 A5c (mix tools): new kern address `/e/kanal_limiter` `,ii` (§5.12), the channel limiter state (built, latency L) on the first `/k/hallo` of a generation; the page server passes it into `/lage` as `kanal_limiter {gebaut, latenz_samples}` (absent until the message came). New address, version stays 1 |
| 2026-11-04 | 1 | Package 1.10 slice 4a T1 (inserts): §1.5 `ins/komp/<n>/*` (n = 1 to 12, 120 new controls, 1378 of 2048), global rows behind the mix tools; vocabulary generated from `docs/interfaces/insert_module.json`. New control paths only, no new address, version stays 1 |
| 2026-11-04 | 1 | Package 1.10 slice 4a T6 (inserts): `ins/komp/<n>/*` are project-only (409 `ueber_projekt` on `POST /regler`), set from the project on opening and by the export render. No new control path, no new address, version stays 1 |
| 2026-11-04 | 1 | Package 1.10 slice 4a integration (inserts): §4.11 Wiedergabe `cypherdj-arr/2` documents `chain` (track, group, return), `pre` (return) and `pm` (the master's chain, key `pm`, not `master`); the flag `an` of a stage is structural and always true, the bypass is the row `ins/komp/<n>/an`; new kern address `/e/ins_gr` `,sf` (§5.5f, gain reduction per running insert stage, 20 Hz). New address, no new reason, version stays 1 |
| 2026-11-04 | 1 | Package 1.10 slice 4b T11/T12 (inserts): §1.5 `ins/eq/<n>/*` (n = 1 to 1, 59 new controls, indices 1378 to 1436) and `ins/saett/<n>/*` (n = 1 to 1, 4 new controls, 1437 to 1440), 1441 of 2048; the pool sizes are the cost table of T11 (`docs/architecture/stand/routing-1-10.md`), not the spec's 4 and 8; §4.11 `chain` stages may be `eq` and `saett` (slots numbered per kind); page API: `insert_setzen` takes `art` `eq` and `saett` with `werte` per kind, `insert_param_setzen` the EQ band names `b<m>/<parameter>`, new reason `pdc_fehlt` (temporary until slice 4b T13), `ins_voll` and `art_unbekannt` texts updated. |
| 2026-11-04 | 1 | Package 1.10 slice 4b T13/T14 (inserts, delay compensation): `insert_module.json` gains `latenz` per kind (komp 0, eq 69, saett 69); §4.11 documents the delay compensation of the arrangement; the reason `pdc_fehlt` is removed (page API, hand text); the load of a playback can fail with `zu_gross` when the compensation does not fit the delay rings. No OSC address, no table row. |
| 2026-11-04 | 1 | Package 1.14 comping slice 1: page API §20.5 (project field `takes`, commands `take_neu`, `take_umbenennen`, `take_loeschen`, `comp_waehlen`, reasons `take_unbekannt`, `takes_voll`, `take_nur_audio`, `take_name_ungueltig`, `comp_leer`, `POST` and `GET /proj/take_vorhoeren`, `vorhoeren` in `/proj/aktuell`, SSE `take_vorhoeren`, `takes_zahl` in the short answers). No OSC address, no playback field. Additive, version stays 1 |
| 2026-11-04 | 1 | 1.8 recording S0 (contract prelude): §4.12 `/k/rec/spur` `,hsiiiii` (`eingang` [0, 30], `modus`, `monitor`), `/k/rec/start` `,hsiiii` (`vorzaehler_takte`), §5.14 `/zustand/rec` `,iiihdii` (`ausgang_vorhalt`, `quantum`; status 1 `zaehlt ein`), `/e/aufnahme` `,iiihhii` (`art`; `spur` 0 for a MIDI take). The core accepts the fields and refuses every non-default value until its slice. Field counts of four existing addresses change; version stays 1 |
| 2026-11-04 | 1 | 1.12 S7 (M13) track band loop: page API §20.6 (`schleife_takte` in `POST /spur`, `POST /spur/aendern`, loop fields in `GET /spur`, reasons `keine_schleife` and `nur_cypher`); MCP `spur` takes `schleife_takte` and `aendern`. No OSC change, version stays 1 |
| 2026-11-04 | 1 | Package 1.14 comping slice 4 (bounce): page API §20.7 (POST /proj/bounce, arts an_ort, neue_spur, einfuegen, run art bounce, reasons bounce_nur_audio, bounce_ziel_art). No OSC change, version stays 1 |
| 2026-11-04 | 1 | Automation slice 4 (package 1.12): page API §20.8, commands `auto_vereinfachen`, `auto_dehnen`, `auto_neigen`, `auto_form`, reasons `bereich_leer` and `form_ungueltig` (400). No OSC change, no playback field, version stays 1 |
| 2026-11-05 | 1 | Automation slice 5 (package 1.12): §4.11 `gain_hk` on audio clip entries and `relativ` on lane entries (value stack), page API §20.9 (`huellkurven`, `huellkurve_setzen`, `huellkurve_loeschen`, `GET /proj/auto?clip_id`), reasons `huellkurve_ziel`, `huellkurve_unbekannt`, `geraet_huellkurven`. No OSC change, version stays 1 |
| 2026-11-05 | 1 | Package 1.10 slice 5 U1 (core): §4.11 playback `chain[].key` `{q: "spur", nr, punkt: "post"}`, the structural sidechain key of a track post (other sources follow in later units), and the loader-computed track order `spur_ordnung`; new `format` refusals for a key on eq/saett, a bad `nr`/`punkt`/`q`, a track keyed by its own post and a post cycle. No new address, no new reason, version stays 1 |
| 2026-11-05 | 1 | Package 1.10 slice 5 U2a (core): §4.11 playback `chain[].key` takes `q` `grp`, `ret` and `pm` (the last is always refused) with `punkt` `pre` or `post`; new contract file `docs/interfaces/schluessel_regeln.json` (which source a stage may take its key from; generated into the loader table and the server table); the loader refuses a disallowed cell with `format` and the reason `sidechain_spaet`, `sidechain_zyklus` or `sidechain_quelle` in the message. No new address, no server reason yet (U3), version stays 1 |
| 2026-11-05 | 1 | Package 1.10 slice 5 U2b (core): §4.11 playback `chain[].key` takes `q` `deck` (1 to 4) and `erz` (1), `punkt` optional; the loader computes the key alignment (delay ring per stage up to 1024 samples, refusal `format` / `key_verzoegerung_zu_lang`, lag of a late key reported); a DJ key is silent in an export. No new address, no server reason yet (U3), version stays 1 |
| 2026-11-05 | 1 | Package 1.10 slice 5 U3 (server and hand): page API `Insert.key {quelle, nr, punkt}` next to the unchanged `sc`; `insert_setzen {key}`, `insert_param_setzen {param: 'key'}`, new command `duck_durch_kick {spur_id, kick_id, pos?}`; new reasons `sidechain_spaet`, `sidechain_zyklus`, `sidechain_quelle` (400); `POST /proj/export` answer `dj_schluessel: true` when a stage has a DJ key; playback `chain[j].key` is written by the server. No OSC address, no core change, no new hand tool, version stays 1 |
| 2026-11-05 | 1 | Fix mb-ausgleich (package 1.15): the rows `bus/<n>/mb/<b>/makeup` keep path, range and default, but their meaning changes: the multiband now adds back each band's own average gain reduction by itself (automatic make-up), and `makeup` is a trim on top of it (0 = automatic only). Behaviour change only, no new row, no index moves, version stays 1 |
| 2026-11-06 | 1 | EQ insert pool 1 -> 2 (Andreas, 2026-11-05): §1.5 `ins/eq/<n>/*` n = 1 to 2, 59 new controls (1378 to 1495), `ins/saett/1/*` moves to 1496 to 1499, `rack/*` to 1500 to 1547; 1548 of 2048. Paths are additive, indices are internal. |
| 2026-11-06 | 1 | Master limiter insert kind `lim`: §1.5 `ins/lim/<n>/*` (n = 1 to 1, 3 new controls, 1548 to 1550); 1551 of 2048; §4.11 `chain` stages may be `lim` (slot 1); `art_unbekannt` text names `lim`. Paths are additive, indices are internal. |
| 2026-11-10 | 1 | Plan 1.11 T4 (effect-host insert, core): §1.5 `ins/host/<n>/an` (n = 1 to 4, 4 new controls, 1551 to 1554); 1555 of 2048; §4.11 `chain` stages may be `host` with the field `latenz` (samples), the named refusal `host_fehlt` (a core without the host ports, the offline render) and `pdc_zu_lang` from 8192 samples, the delay ring of one place 1024 -> 8192 samples (limits 1024/4096 -> 8192/32768). Additive paths, new optional playback field, no new OSC address and no new reason code. |
| 2026-11-10 | 1 | Plan 1.11 T5 (effect-host health and round-trip measurement, core): §4.11 `/k/arr/ins_host` and `/k/arr/ins_mess`, §5.13 `/e/ins_host`, `/e/ins_mess` and `/zustand/ins_host`, §16.2 reasons `laeuft`, `host_fehlt` and `kein_rueckweg` (real reasons, carried as the `grund` field of `/e/ins_mess`; the loader's `host_fehlt` token inside `format` stays). New addresses and reasons, version stays 1; the type chain of `/zustand/arr` is not changed. |
| 2026-11-10 | 1 | Plan 1.11 T12 (real-time export, core): §4.11 `/k/arr/export_lauf`, §5.13 `/e/export_lauf`, §16.2 reasons `belegt` and `schreiber_ueberlauf`. The offline render (`cypherdj-render`, exit 5) refuses a playback with a host stage `an` true with the render error `host_insert_echtzeit` (not an OSC reason; the strip is named in the message). New address and reasons, version stays 1. |
| 2026-11-10 | 1 | Plan 1.11 T7 to T17 (server, page, hand, instruments; closure of 1.11): §20.12 page API for plugins (`insert_setzen` with `art: 'host'` and `plugin_id`, `insert_latenz_extra`, `spur_neu` with a plugin device, routes `/plugins*`, `/proj/insert/<id>/{parameter,param,fenster}`, `/proj/spur/<id>/geraet/*`, `hosts` and `instrumente` in `GET /proj/aktuell`, real-time export path, bounce refusal, MCP tool `plugins`); new page reasons (the list is in §20.12); §4.11 corrections: the playback `slot` of a host stage is the host number h (1 to 4), and the token `host_fehlt` sits inside the message of the reason `format`. New page API paths and reasons, no new OSC address, version stays 1. |
| 2026-11-11 | 1 | arr-bk (Baukasten effect insert, effect return): §1.5 `ins/bk/<n>/*` (n = 1 to 8, `an` and `k1` to `k8`, 72 new controls, 1964 to 2035); the controller table ceiling 2048 -> 4096 (`MAX_REGLER`, `CDJ_Z_REGLER`) and the state file version 3 -> 4 (an old file is recreated, the restart state of that one start is lost, see `test_zustand`); §4.11 chain stage kind `bk` with the field `graph`, global slot order komp, eq, saett, lim, utility, bk, host; page API `insert_setzen` with `art: 'bk'` and `graph`, `return_neu` with `effekt` (a return whose chain carries a bk stage and whose Hall is off); stock graph `fx-delay-sync`. Additive paths and fields, no new OSC address and no new reason code (`ins_voll`, `kette_voll`, `format` and `argument_ungueltig` carry the new refusals). |
| 2026-11-11 | 1 | arr-fx (utility insert, larger pools): §1.5 `ins/utility/<n>/*` (n = 1 to 8, 5 controls per instance, 40 new controls, 1924 to 1963; `breite` 0 to 4, `mono_unter` 0 to 500, `gain` -60 to 24, `balance` -1 to 1); pools eq 2 -> 8 (indices 1378 to 1849), saett 1 -> 4 (1850 to 1865), lim 1 -> 2 (1914 to 1919), host 1920 to 1923; table 1964 of 2048; §4.11 chain stage kind `utility` without latency, global slot order komp, eq, saett, lim, utility, host. Additive paths, no new OSC address, no new reason code (`ins_voll` and `kette_voll` unchanged). |
| 2026-11-06 | 1 | Stems with BS-RoFormer-SW on the GPU only (§20.1): `geraet` only `gpu` (`cpu` → 400 `stems_nur_gpu`), new failure reasons `gpu_belegt` and `keine_gpu` in the state, `stems_gpu_aus` gone; `fertig.spuren` has four to six ids (Guitar and Piano only when not empty). No OSC change, version stays 1 |
| 2026-11-06 | 1 | Hall pool: §2.1 new keys `hall_faeden` (default 3) and `hall_cpus` (default empty); §5.13 new address `/zustand/hall_pool` (an, faeden, spaet, zurueck); page API `GET /lage` carries `hall_pool {an, faeden, spaet, zurueck}`, absent until the first message came. New address, version stays 1 |
| 2026-11-07 | 1 | Voice channel: §2.1 new keys `stimme_eingang` (default 0 = off), `stimme_duck_db` (-12), `stimme_pegel_db` (0). New keys with a neutral default, version stays 1 |
| 2026-11-07 | 1 | Track phases on the Hall pool: §2.1 new key `spur_pool` (`aus` \| `an` \| `auto`, default `an`); §5.13 new address `/zustand/spur_pool` (an, modus, blocks_parallel, einheiten_worker, einheiten_caller, seriell_summe, haengt, spaet, zurueck); page API `GET /lage` carries `spur_pool {an, modus, blocks_parallel, einheiten_worker, einheiten_caller, seriell, haengt, spaet, zurueck}`, absent until the first message came. New address, version stays 1 |
| 2026-11-08 | 1 | 1.8 recording, rest of the package (T0 to T12): §4.12 `/k/rec/spur` `eingang` 30 documented as built (MIDI arm per track, not counted against the 8 audio tracks, `eingang_fehlt` for 20 only), `/k/rec/start` `vorzaehler_takte` 0, 1, 2 or 4 and `kein_eingang` only when neither an audio nor a MIDI track is armed (instrument-only runs), new paragraph on the MIDI take file `midi-<kennung>.bin` (12-byte records, pairing by pitch alone, `ende_s` close); §5.14 `/zustand/rec` `ausgang_vorhalt` now includes the delay compensation (PDC) of the loaded arrangement, `rec_midi_scharf` (the last field, added with T7a; `scharf` counts audio arms only), `/e/aufnahme` MIDI take (`spur 0`, `art 1`, `frames` = events, `luecken` = refused events); §16.2 `tempo_rampe` also for `/k/tempo/rampe` while a recording is not idle (core refusal since T9), `kein_eingang` and `eingang_fehlt` texts. No new address, the type chain of `/zustand/rec` (`,iiihdiii`) was extended by `rec_midi_scharf` in T7a, version stays 1 |
| 2026-11-09 | 1 | 1.10 slice 7 (T5): §4.11 `/k/arr/abgriff` and §5.13 `/e/abgriff` (real-time tap of any strip, file `abgriff-<art>-<nr>-<kennung>.f32`). New addresses, no new reason, version stays 1 |
| 2026-11-09 | 1 | 1.10 slices 6 and 7 closure: §20.11 page API `GET /proj/routing`, `POST /proj/resample`, `kern.limiter_db` and `kern.status` 3 in `GET /proj/lage`, `proj_lautheit` entries `gruppen` and `returns`; new reasons `resample_leer`, `resample_fehler` (page API only, not in the OSC reason list); `/k/arr/abgriff` also refuses `tempo_rampe` like the freeze. No new OSC address, version stays 1 |
| 2026-11-09 | 1 | 1.9 instruments, U7 to U9: §20.10 (page API): instrument rack device `geraet: {art: 'rack', kette, glieder}`, commands `rack_glied_setzen`, `rack_glied_entfernen`, `rack_kette`, member macro targets (`glied, param, von, bis`) next to the stage targets in `rack_setzen`, variations (`rack.variationen`, `makro_variation_speichern`, `makro_variation_laden`, `makro_variation_loeschen`), new reasons `keine_rackspur`, `rack_voll_glieder`, `glied_unbekannt`, `rack_letztes_glied`, `glied_ohne_rack`, `makro_ziel_wirt`, `variation_voll`, `variation_unbekannt`; §4.11 playback file: `geraet: 'rack'` with `glieder` and `glied` mapping targets (core index space), a mapped member starts on its mapped value. No OSC address, no change of a type chain, version stays 1 |
| 2026-11-10 | 1 | 1.12 slice 6, insert and rack lanes: §4.11 optional `chain_auto` on a track, group and return entry and on `pm` (`cypherdj-arr/2` only; loader reasons `format`, `zu_gross`), §20.13 page API `auto_neu` targets `insert.<stage id>.<param>` and `rack.m1..m4` with `strang_id`, new reasons `param_gemappt`, `param_hat_lane`; `lane_ziel_spaeter` is no longer raised. No OSC address, version stays 1 |
| 2026-11-10 | 1 | 1.12 slice 7, lanes and clip envelopes on the Baukasten knobs: §4.11 lane `ziel` `geraet.k1` to `geraet.k8` (param 0 to 7, bk tracks only; a relative lane through `auto_parameter_summand`), §20.13 `auto_neu` and `huellkurve_setzen` targets, at most 12 lanes per track. No OSC address, no new reason, version stays 1 |
| 2026-11-11 | 1 | 1.12 slices 6 and 7, fix round: `/proj/aendern` answers a write to a lane-driven parameter with the hint `lane_treibt` in `hinweise` (§20.13); loader texts of `chain_auto` in English. No OSC address, no new reason, version stays 1 |
| 2026-11-10 | 1 | MIDI import: §20.14 page API `POST /proj/midi_import` (Standard MIDI files, formats 0 and 1, into one instrument track with one clip per MIDI track and channel, one history step), MCP tool `proj_midi_import`; new page reasons `smf_kein_smf`, `smf_format2`, `smf_smpte`, `smf_beschaedigt`, `smf_leer`, `midi_keine_noten`, `midi_schluessel_unbekannt`, `midi_zu_viele_spuren`, `midi_zu_lang`, `midi_datei_zu_gross`, `midi_datei_fehlt`. No OSC change, version stays 1. |
| 2026-11-11 | 1 | Strudel clip: §20.15 page API command `clip_aus_muster` (one Strudel pattern becomes one MIDI clip with clip envelopes, the pattern stored on the clip as `muster`, hand work protected by `abdruck` and `ueberschreiben`), the `muster` reports in the answer of `/proj/aendern`, MCP tool `proj_muster`; new page reasons `muster_fehler`, `klang_unbekannt`, `muster_ziel_passt_nicht`, `muster_zeitlimit`, `muster_zu_gross`, `muster_nicht_verfuegbar`, `muster_fehlt`, `handarbeit_vorhanden`. No OSC change, version stays 1. |
| 2026-11-11 | 1 | 32-knob widening: §1.5 `<k>/bk/<n>` and `fx/<n>/bk/<m>` run to 32 (336 new rows at the table end, 2228 to 2563), `ins/bk/<n>/k9` to `k32` (192 new rows, the stage rows of stage 2 to 8 move up: stage s starts at 1964 + 33 (s - 1)); the table has 2564 of 4096 rows. Additive paths, no new OSC address, version stays 1. Saved projects: a channel snapshot with 8 numbers and a track device or insert stage with only k1..k8 load unchanged (missing knobs 0.5) |
| 2026-11-11 | 1 | 64-knob widening: §1.5 `<k>/bk/<n>` and `fx/<n>/bk/<m>` run to 64, `ins/bk/<n>/k33` to `k64` (256 new rows, stage s starts at 1964 + 65 (s - 1)); the table has 3268 of 4096 rows (`<k>/bk/9` to `<k>/bk/64` and `fx/<n>/bk/<m>` at 2484 to 3267). New FFI function `cypher_bk_regler_vorgabe` (start position of a knob, paragraph "Baukasten FFI" in §4). Additive paths, no new OSC address, version stays 1. Saved projects with 8 or 32 knobs load unchanged (missing knobs: the graph's `vorgabe`, else 0.5) |
| 2026-11-12 | 1 | Nested groups (ADR 036): §1.5 `grp/<n>/*` and the group sends run to n = 16 (rows 9 to 16 appended at the table end); §4.11 playback: the `ausgang` of a group may be `gruppe` with `nr` (cycle, self or missing parent is `format`); project file: optional `Gruppe.ausgang` (absent = master, never written for the master); §20 `routing_zyklus` also for a group onto its own descendants, key-breaking moves and deletes refused with `sidechain_zyklus` or `sidechain_spaet`; stems nest under the group of their source. No OSC address; version stays 1 |
| 2026-11-12 | 1 | Live modules task 6: §1.5 `grp/<n>/cue`, n = 1 to 16 (16 rows appended at the very end of the table, hand only). No new OSC address; version stays 1 |
| 2026-11-13 | 1 | DJ view places, slice 2 (ADR 037): §4.11 playback `cypherdj-arr/2`: optional head field `live` (bool) and the group `ausgang` kind `dj` with `nr` 1 or 2 (top group of a live project only; `dj` without `live`, `nr` outside 1 to 2 or a doubled `nr` is `format`); the kernel adds the group into the input of `pad/1` or `pad/2` in front of the strip, the render treats it as master. No OSC address and no new reason; version stays 1 |
| 2026-11-14 | 1 | FX3: §4.10 `/k/fx/zuweisung` and §5.12 `/e/fx/zuweisung` take `einheit` 3 (insert on `fx/3`, every source channel, no master); `deck/3` and `deck/4` join the Beat FX targets of units 1 and 2. `osc.json`: `fx_kanal` is the union, new lists `fx_kanal_12` and `fx_kanal_3`. Version stays 1 |
| 2026-11-14 | 1 | SEQ deck, slice 1 task 4 (ADR 038): §4.11 playback `cypherdj-arr/2`: the group `ausgang` kind `dj` takes `nr` 1 to 6 (3 to 6 = `deck/1` to `deck/4`; `nr` outside 1 to 6 is `format`); the kernel adds the group into the input of that channel after the decks and in front of the strip, the render treats it as master. No OSC address and no new reason; version stays 1 |
| 2026-11-14 | 1 | SEQ deck, slice 1 task 8: new §20.16 with the commands `seq_anlegen`, `seq_setzen`, `seq_leeren`, the routes `/seq/anlegen`, `/seq/schritt`, `/seq/text`, `/seq/leeren`, `/seq/stand`, the event `{a: 'seq'}` and the hand tool `seq`. Page API only: no OSC address and no new reason in §16.2; version stays 1 |
| 2026-11-14 | 1 | SEQ deck v2 task 3: §20.16 rewritten for patterns: command `seq_folge_neu` (with `noten`, `seq`, `huellkurven`), `seq` on `clip_neu`/`clip_aendern`, routes `/seq/folge`, `/seq/befehle`, `/seq/text` (grammar of the pattern text), `/seq/geraet`, `/seq/stand` with `folgen`; `/seq/schritt` and `seq_setzen` are gone; hand tool `seq` actions `stand`, `anlegen`, `leeren`, `folge`. Page API only: no OSC address; version stays 1 |
| 2026-11-15 | 1 | Production plan task 8: §1.5 `spur/<s>/bk/<k>`, s = 1 to 8, k = 1 to 32 (256 rows appended at the very end of the table, role `spur_bk`: a transient override of a Baukasten knob, cleared by every playback build, not stored in the restart state). No new OSC address; version stays 1. The table has 3668 of 4096 rows |
| 2026-11-15 | 1 | Device faces T9: new kern address `/e/stufe_pegel` `,sff` (§5.5g, input and output peak in dBFS of a compressor or limiter stage, paths `ins/komp/<n>`, `ins/lim/<n>`, `komp/<channel>`, 20 Hz). `/e/ins_gr` now also carries `ins/lim/<n>` (device faces T8, §5.5f). New address, no new reason, version stays 1 |
| 2026-11-15 | 1 | Initial mute in the playback: §4.11 `cypherdj-arr/2` tracks may carry `stumm_start` (boolean): the swap starts the track muted in its own block (mute fade 0, row `spur/<n>/mute` 1). Optional field, a file without it behaves as before; in a `/1` file or with a non-boolean value it is `format`. No new OSC address, no new reason, version stays 1 |
| 2026-11-15 | 1 | Instrument graphs with latency on a project track: §4.11 (Baukasten instrument tracks): the latency of the graph joins the delay compensation of its strip; a graph above 4096 samples is `format`, the message names the limit (before: every latency above 0 was refused). No new OSC address, no new reason, version stays 1 |
| 2026-11-16 | 1 | 64-knob live override: §1.5 `spur/<s>/bk/<k>` runs to k = 64 (was 32; 512 rows instead of 256, the row `spur/<s>/bk/33` to `spur/<s>/bk/64` of every slot are new; indices of the rows before them do not move; `spur/<s>/bk/<k>` stays at the very end of the table). The table has 3924 of 4096 rows (reserve 172). Additive paths, no new OSC address, version stays 1. `geraet_param_setzen` accepts `k1` to `k64` live (`k65` is refused with `param_nicht_live`) |
| 2026-11-16 | 1 | Sampler A1 task 7: §4.11 `/k/arr/note` `,hsiii` (one note on a project track, `vel 0` = off; no arm, no running transport). New address, no new reason (`spur_bereich` is listed in §16.2), version stays 1 |
| 2026-11-16 | 1 | Sample player stage 2a: §4.8 the `sampler` block gains the named field `zonen` (zone table, 12 numbers per zone), the input `vel` (last) and the pack mapping (up to 2 GiB, read-only `mmap`, outside the 64 MiB budget); no new OSC address, FFI unchanged |
| 2026-11-16 | 1 | Sample player stage 2b: §4.8 the `sampler` block gains the value `loop_blende` (ms, zone mode), sustain loops (`loop_a`, `loop_b`) and release samples (`art` 1) in the zone table, and the outputs `rl`, `rr` (appended after `l`, `r`); no new OSC address, FFI unchanged |
| 2026-11-16 | 1 | Sampler A1, A2, B, C: §4.8 the `sampler` block gains the named field `grenzen`, the value `noten_wahl` and the inputs `tempo`, `halb`, `ausklang` (60 s files), the `regler` node gains `rastet`, FFI `cypher_bk_rastende` and `cypher_bk_regler_bei`; §4.11 per-note values of latched knobs (the core evaluates a device lane at each note's own beat); §20.17 page API `/sampler/*`, `GET /welle?schnitt=`, `schnitt.json`, the generated devices, kit and tone, MCP tool `sampler`. No new OSC address beyond `/k/arr/note`, no new OSC reason, version stays 1 |
| 2026-11-16 | 1 | Workbench: §20.18 page API `/proj/export_midi`, `/proj/export_spuren`, `/proj/export_zeige`; note fields `chance`, `wdh`, `versatz`; `MidiClip.zeilen` with `zeile_setzen`; `werkbank_bereich` and `werkbank.laenge_beats`; module length 1 to 128 bars; panel field `front`. No new OSC address, the core receives the unrolled notes as before, version stays 1 |
| 2026-11-17 | 1 | Project key: §20.18 optional project field `tonart {grundton, skala}` and the command `tonart_setzen`; the note editors mark, fold and snap by it. No new OSC address and no new reason, playback does not read the field, version stays 1 |
| 2026-11-17 | 1 | ANALYZE slice 2: §20.21 gains references as `vergleich` of `POST /proj/analyse` (`RefQuelle`, `RefMessung`, `abgleich`), the routes `/analyse/referenz/messen`, `/analyse/referenzen`, `/analyse/referenz/merken`, `/analyse/referenz/loeschen`, the read-only route `GET /analyse/live` on the audio ring of §6.1, and the long window for the bands below 400 Hz. Page server only: no OSC address, no core code, no project field. |
| 2026-11-18 | 1 | Find sound rework: §20.24 `staerke` is the audibility D, `schritt` names three levels of audibility with a widening step ladder, unique words, `hoeren {vergleich}` (COMPARE), state fields `vergleich` and `ausgleich_db`, refusal `vergleich_steht`, `waehlen`/`zurueck` awaited. Page server only, no core change. |
| 2026-11-17 | 1 | Find sound, part 1: §20.24, the routes `/proj/klang/runde`, `/proj/klang/hoeren`, `/proj/klang/waehlen`, `/proj/klang/zurueck`, `/proj/klang/ende`, the optional track field `stammbaum` and the command `stammbaum_setzen`. Page server only: no OSC address, no core code, no playback field. |
| 2026-11-17 | 1 | Module to SEQ deck: §20.16 route `POST /seq/modul {slug, platz}`, the new reason `modul_ohne_instrument`, the read-only `liesProjekt(slug)` of the project access, the hand tool `seq` action `modul`. Page API only: no OSC address, no new command, no model field; version stays 1 |
| 2026-11-17 | 1 | Media browser B4: §20.22 route `GET /suche` (one search over the shelf sources, hits grouped by kind, FITS by tempo and Camelot key), the new reason `suche_quelle` for a group that could not be read. Page server only: no OSC address, no new hand tool, no core code, no model field; version stays 1 |
| 2026-11-18 | 1 | Documentation correction: the knob range in the §4.11 paragraph on Baukasten instrument tracks in the playback (S20), the automation targets of §4.11 and §20.13 and the slice 7 bullet now state k1 to k64 and the graph's own start position for a knob the playback leaves out (was k1 to k8 and 0.5); no interface change |
| 2026-11-18 | 1 | SEQ scenes: §20.16 routes `POST /seq/szene` and `GET /seq/szenen`, the event `{a: 'seq', f: {szene: true}}`, the project field `szenen`, the commands `szene_speichern`, `szene_loeschen`, `szene_anwenden`, the reasons `szene_leer_slot` and `szene_leer`, plan `szene` of `/k/teil` and `/k/abbruch`, the hand tool `seq` scene actions. No OSC address, no core change; version stays 1 |
| 2026-11-18 | 1 | The live studio follows the project time signature n/4, phase 1: §20.25, `taktart: [n, 4]` in `GET /lage` only when n is not 4, the SSE event `taktart`, the meter file `taktart` in the generator stream folders (missing = 4, unreadable = last good value), bar quantisation of the page routes in n. No OSC address, no core change; version stays 1 |
| 2026-11-18 | 1 | Instrument picker by synthesis type: §20.26, optional `prinzip` on the `GET /graphen` entries of instruments (one of eight ids; `sampler` for the generated `smp-`, `ton-`, `ins-` graphs). Page server and data only; no OSC address; version stays 1 |
| 2026-11-18 | 1 | 16 Baukasten tracks: §4.11 `zu_gross` above 16 bk tracks per project (`ARR_BK_MAX`, was 8); §1.5 `spur/<s>/bk/<k>` keeps s = 1 to 8 and 512 rows, the 9th to 16th bk track has no row (`bk_slot_` stays -1); page API: `geraet_param_setzen` on such a track takes the general path (the knob is written and the playback is rebuilt, nothing moves live), `hoereBk` (FIND SOUND listening) refuses it with `param_nicht_live` 409, a knob drag on it takes the release path; no new OSC address, version stays 1 |
| 2026-11-18 | 1 | Preset apply loads the instrument: §20.27 `POST /presets/anwenden` takes the optional boolean `graph_laden`; the plan of a regler target may carry `graph: {kanal, name}`, the hint `graph_gewechselt`, the new reasons `graph_latenz` (409) and `graph_fehlt` on apply (404), the refusals `graph_anders` and `kein_graph` name the preset's `graph`; hand tool `presets_anwenden` gains `graph_laden`. No OSC address, no core change; version stays 1 |
| 2026-11-18 | 1 | Hidden duplicate instruments: §20.26, optional `verborgen: true` on the `GET /graphen` entries of instruments (from `kategorien.json`) and on the instrument rows of `GET /presets/katalog`. Page server and data only; the graph files and loading by name stay as they are; no OSC address; version stays 1 |
| 2026-11-18 | 1 | I3a: a deck channel with nothing loaded opens for source `cypher` without a listening pass (§17 I3a, SEQ deck); a track load ends running parts of `cypher` on the deck fader. No new address, no field, no version change; core change in `PrueferI3::vor_teilstart` and `Stellwerk::cypher_fahrt_beenden` |
| 2026-11-19 | 1 | I3a, SEQ deck review: a track load ends the running parts on the deck fader of every source but `andreas` (not only `cypher`), together with their coupling group as before (a mate left running alone could fade the other side of a crossfade to silence). No new address, no field, no version change; core change in `Stellwerk::cypher_fahrt_beenden` |
| 2026-11-18 | 1 | Return fader lane, return automation slice 2: §4.11 new playback format `cypherdj-arr/3` (`/2` plus optional `returns[].auto`, one absolute `fader` lane per return; `/1` and `/2` files with `returns[].auto` and any other `ziel` on a return are `format`; the master and the groups have no `auto` list), the format number is the version gate for an older core; §20.13 `auto_neu` takes `ziel` `fader` with `strang_id` of a return (the master and a group are refused with `ziel_unbekannt`). No OSC address, version stays 1 |
| 2026-11-18 | 1 | Track pool never off for good: `spur_pool` `an` and `auto` (now a synonym) retry after a switch-off with a back-off of 4096 blocks, doubling with every further switch-off up to 65536 blocks (was: `an` never, `auto` once); §2.1 `spur_pool` and `/zustand/spur_pool` `an` text only. No OSC address, no field, version stays 1 |
| 2026-11-18 | 1 | Lean operating journal (configuration side): §2.1 new key `journal` of `leitstand.toml` (`voll` default or `schlank`), a test instance with the default `sets` uses `/dev/shm/cypherdj-<i>/sets`; §15 journal mode `voll` / `schlank` and what `schlank` leaves out; `djk-start --journal voll|schlank` (production start passes `schlank`). No OSC change. |
| 2026-11-18 | 1 | Live keys to an instrument stream: §4.7 new `/k/live/tasten ,hsi` (`id`, `quelle`, `strom`; 0 none, 2, 3, 5, 6, 7, 9, 10; streams 1, 4, 8 and out-of-range values are refused with `ausserhalb_bereich`, cypher with `nur_hand`). The keys of all `midi_ein` places go to the stream: through its graph for a `bk:` stream, as note on/off on `midi_aus_*` for a host stream; held keys close at a target change, a change of the stream and a lost `midi_ein` port (a regular core stop sends no offs of its own). Additive, version stays 1 |
| 2026-11-19 | 1 | Kraken patch field task 1: §4.11 `/k/arr/stift` `,hsiiiif` (one pin of the `matrix` block of a project track: `spur`, `satz`, `zeile`, `spalte`, `wert`). New address, no new reason, version stays 1 |
| 2026-11-19 | 1 | Sample player stage 2c: §4.8 the `sampler` block gains the zone-mode values `taste_blende`, `vel_blende`, `frei_halte`; no new output, OSC address or FFI call |

### 20.19 Page API sample player, stage 1: a file of the sample roots as a source (spec 2026-11-16-sample-player-design)

Page server only; no OSC address, no DSP change. Sources: `djk/ui/sampler/file.ts`, `areas/sampler/file_routes.ts`; the track part is shared with TO TONE (`tonAufSpur` in `areas/sampler/tone_routes.ts`).

**Roots.** `wurzeln.json` in the sampler folder (`$CYPHERDJ_SAMPLER`, default `~/.config/cypherdj/sampler`): `[{"name", "pfad"}]`, at most 16 entries, `name` 1 to 40 characters without `/` and unique, `pfad` absolute; an invalid entry is skipped, a missing or empty file means no roots. Every path of a request is `<root name>` plus a relative path, resolved with `realpath` and kept inside the real path of the root (`..`, absolute paths and symlinks that leave the root: 404 `quelle_unbekannt`). Audio files end in `.wav .aif .aiff .flac .ogg` (case-insensitive).

**Routes.**
- `GET /sampler/dateien`: `{wurzeln: [{name, fehlt?: true}]}`. With `wurzel` (and `ordner`, relative, default the root): `{wurzel, ordner, ordner_liste: [name], ordner_zahl: {name: n}, dateien: [{name, rel, bytes}], mehr?: true}`, both in natural order, files capped at 2000. A folder without any audio file below it is left out, a chain of folders that hold only one folder is one entry (`Samples/Combined`), `ordner_zahl` is the number of audio files below an entry (one walk per root, kept ten minutes); hidden entries and the folders `Ableton Folder Info` and `Ableton Project Info` are skipped everywhere. A sample of an Ableton factory pack (AIFF-C with a chunk `able`, compression `able`, "Ableton Content") is protected and only Live reads it: it is not listed, counted or found, and `hoer`/`spur` refuse it with 422 `format_falsch` and a text that says so. With `suche`: a recursive search below `ordner` for files whose path from the root contains every word (case-insensitive), at most 300 hits and 3 s of walking (`mehr: true` beyond); the answer is `{wurzel, ordner, suche, ordner_liste: [], dateien, mehr?}`, `rel` counted from the root. Refusals 404 `quelle_unbekannt` (unknown root, root missing on disk, path outside, not a folder).
- `GET /sampler/datei/hoer?wurzel=&rel=`: `audio/wav`, 16 bit stereo 48 kHz, the first 30 s, decoded with ffmpeg; `Cache-Control: no-store`. Refusals as above plus `format_falsch` (422).
- `POST /sampler/datei/spur {wurzel, rel, grund?, name?}`: makes the cut, the tone over its one slice and a NOTE track with one note at the root, as one history step (label `Tone <name>`). Answer as `POST /sampler/ton` with `spur: true` (`ton`, `text`, `tonart?`, `rev`, `projekt`, `spur_id`) plus `schnitt_id` and `grund_herkunft` (`erkannt`, `dateiname`, `vorgabe`, or `angabe` when the request gave `grund`). Refusals: `kein_projekt`, `kein_werkbank`, `werkbank_voll` (409), `quelle_unbekannt` (404), `zu_lang`, `format_falsch` (422), `argument_ungueltig`, `argument_unbekannt` (400), `ki_gestoppt` (409). A refusal at any step removes the cut and the tone again.

**Source kind `datei`, method `ganz`.** A cut may have `quelle: {art: 'datei', ref: '<root name>/<path>'}` (also through `POST /sampler/schnitt`, whose `methode` then is `raster` or `anschlag` as before). The audio is decoded to 48 kHz stereo float32 (a mono file plays on both sides at its own level), leading digital silence (below -80 dBFS) is trimmed, a file that is silent throughout is refused (`format_falsch`), a file over 60 s is refused (`zu_lang`, never cut off; a file longer than 62 s is refused before its end is decoded). `bpm` is the tempo of the open project (default 120), `beats` the length at that tempo rounded to 1/8 beat (at least 1/8; not limited to 64). The method `ganz` (`methode: 'ganz'` in `schnitt.json`) is one slice `[0, frames]`; it is made by `POST /sampler/datei/spur` only, not by `POST /sampler/schnitt`. The cut is listed by `GET /sampler/liste` and deleted by `POST /sampler/loeschen` like any other (with its tones).

**Root note** (`grundVonDatei`): the pitch detection of the tone part (`erkenneGrundton`, from confidence 0.6); a note name in the file name (`C3`, `F#2`, `Gs4`, `Bb1`, `As_1`, delimited by space, `_`, `-`, `.` or the ends; `_` or `-` before the digit makes the octave negative) gives the pitch class, which wins over a detection of another class at the octave nearest to the detection; without a detection the name decides alone, counted scientific (C4 = 60); neither: 60. The result is moved by octaves into 16 to 95.

### 20.20 Page API sample player, stage 2: instruments from folders (spec 2026-11-16-sample-player-zonen-design, strand S)

Page server only. The engine part (zone mode of the `sampler` node, strand R) is separate; this section is what the page server writes and answers. Sources: `djk/ui/sampler/instrument_names.ts` (file name reader, zone table), `sampler/instrument.ts` (store, pack, graph, panel), `areas/sampler/instrument_routes.ts`; the track part is shared with TO TONE (`geraetAufSpur` in `areas/sampler/tone_routes.ts`).

**Store.** `<sampler folder>/instrumente/<id>/instrument.json` (`$CYPHERDJ_SAMPLER`), written last: an instrument exists only with this file. `{schema: 1, id, name, quelle: {wurzel, ordner}, erstellt, frames, zonen: [{datei, a, b, grund, lo, hi, vlo, vhi, gain_db, pan, lage?, rr?}], konvention: 'C4=60' | 'C3=60', varianten?: [label]}`; fields the code does not know are kept when the entry is rewritten (`speichereInstrument`). `id` is `<slug of the name, at most 22 characters>-<4 hex>`; the device is named `ins-<id>` (at most 32 characters). Files: pack `<graph folder>/samples/ins-<id>.f32` (the samples behind each other, stereo float32 48 kHz; a pack is never rewritten in place, a new build writes a new id), graph `<graph folder>/ins-<id>.json`, panel `<graph folder>/panels/ins-<id>.json`. The device list files `ins-*` under the category `sampler` with the text `Instrument · <name>`.

**Reading a folder** (the audio files directly in it; hidden entries and protected Ableton samples are skipped). From each name: the note (`C3`, `F#2`, `Gs4`, `Bb1`, `A#-1`, and a sharp or flat followed by its octave as the next token, `A# 1`), the velocity layer (`vl<n>`, `v<n>`, or `ppp pp p mp mf f ff fff`, ordered soft to loud), the take (`rr<n>`). A file without a note name is left out. The other tokens split the files into variants (the tokens every file has do not count); the variant with the most files is taken, the others are named in `varianten`. The octave convention is decided once per folder by the pitch detection of sampler C on up to five files of different notes (first 1.5 s): the convention (C4 = 60, or C3 = 60) whose notes lie nearer to the detected pitches (confidence from 0.6) wins; nothing usable or a tie: C4 = 60. Key ranges: every note covers the keys up to the midpoint to its neighbours (the lower note takes the middle key), the lowest reaches 12 keys down, the highest 12 up, inside 0 to 127; velocity 1 to 127 is split evenly over the layers the note has; takes of one note and layer share the ranges. `grund` is the named note (a whole number; no tuning from the detection). At least 3 different notes, else `kein_instrument` (422, the text names the count). At most 1024 zones (`zu_viele_zonen`, 422).

**Building.** Every file is decoded like stage 1 (48 kHz stereo float32, leading digital silence cut off; a file that is silent throughout or shorter than 4 frames is refused with `format_falsch`, the text names it) with asynchronous ffmpeg, at most 4 ffmpeg or ffprobe processes at a time (`dekodiereDateiAsync`, `probeDateiAsync` in `sampler/file.ts`). Before anything is written the size is estimated from the durations (ffprobe, leading silence not counted off, so an upper bound): over 2 GiB (`PACK_MAX_BYTES`, `packMaxBytes` of the `Ordner` for tests) is `pack_zu_gross` (422, the text gives the size); the exact size is checked again while writing. The pack is written under a temporary name and renamed; graph, panel and entry follow, the entry last. A failure at any point removes everything made (the temporary pack, the reserved id folder, graph, panel).

**Routes.**
- `GET /sampler/dateien?wurzel=&ordner=` (20.19) additionally answers `instrument: {noten, lagen, takes, dateien, varianten?: [label]}` when the folder reads as an instrument (at least 3 different notes in the names; `takes` is the most takes of one note and layer; read from the names of the listed files, no audio is read; not in a search answer).
- `POST /sampler/instrument {wurzel, ordner?, name?, spur?: true}`: builds the instrument (`name` 1 to 60 characters, default the folder name). The request stays open while it builds. Answer `{instrument: {id, name, noten, zonen, bytes, erstellt, graph, varianten?}, text}`; with `spur` also `rev`, `projekt`, `spur_id` (a new NOTE track, one note of 2 beats at the middle of the key range, velocity 100, one history step, label `Instrument <name>`); a refusal of the project removes the instrument again. Refusals: `laeuft_schon` (409, a build is running), `kein_projekt`, `kein_werkbank`, `werkbank_voll`, `ki_gestoppt` (409, the first three before anything is made), `quelle_unbekannt` (404), `kein_instrument`, `zu_viele_zonen`, `pack_zu_gross`, `format_falsch` (422), `argument_ungueltig`, `argument_unbekannt` (400).
- `GET /sampler/instrument/lauf`: `{laeuft, name, fertig, von}` (files written of files to write; `{laeuft: false, name: '', fertig: 0, von: 0}` when idle).
- `GET /sampler/instrumente`: `{instrumente: [{id, name, noten, zonen, bytes, erstellt}]}`, newest first; `noten` the number of different key ranges, `bytes` the size of the pack.
- `POST /sampler/instrument/spur {id}`: a stored instrument on a new track; answer as above with `rev`, `projekt`, `spur_id`; `instrument_unbekannt` (404), the project refusals as above.
- `POST /sampler/instrument/loeschen {id}`: `{ok: true}`; refused with 409 `instrument_in_gebrauch` (`text`, `spuren`, `fundstellen`, as `ton_in_gebrauch`) while the open project, a stored project or a module of the store plays `ins-<id>`; else pack, graph, panel and entry go.

**Device graph** (`instrumentGraph`, `format: 'baukasten/2'`, `stimmen: 16`). `note.hz` -> `tr` (transponiere, Tune +-1 st) -> `smp.hz`; `note.trig` -> `smp.trig`, `note.gate` -> `smp.gate`, `note.vel` -> `smp.vel`; the `sampler` node `smp` has `datei: 'ins-<id>.f32'` and `zonen`, the flat array of 12 numbers per zone `[a, b, grund, lo, hi, vlo, vhi, gain, pan, 0, 0, 0, ...]` (`gain` linear = 10^(gain_db/20), rounded to 6 digits); `grund`, `scheiben`, `grenzen`, `noten_wahl` and `schleife` are not set on it. `env` (adsr, Attack/Decay/Release in ms through x 0.001) and the velocity curve `vkurve = vm1 (add: vel + -1) x Velocity (mul) + 1 (add)` = 1 - Velocity + Velocity * vel; `gain = Level x vkurve x env`; `smp.l/r` -> `lp_l/lp_r` (svf low-pass, Cutoff, Reso) -> `amp_l/amp_r` (x gain) -> `aus`. Knobs (`regler`, nr): 1 Tune, 2 Attack, 3 Decay, 4 Sustain, 5 Release, 6 Cutoff, 7 Reso, 8 Level, 9 Velocity (default 0.5). Panel `cypherdj-panel/2`, one section `INSTRUMENT` with the nine knobs, `front: ["k2", "k5", "k6", "k7", "k9", "k8"]` (Attack, Release, Cutoff, Reso, Velocity, Level). Tests: `sampler_instrument_names.test.mjs`, `sampler_instrument.test.mjs`, `sampler_instrument_route.test.mjs`.

**Stage 2b: sustain loops and release samples** (page server part; the engine part, zone numbers 9 to 11 and the outputs `rl`/`rr` of the `sampler` node, is separate). Sources: `sampler/schleifen.ts` (loop reader), `sampler/instrument.ts`.
- *Loop points of a source file* (`liesSchleife`, headers only, no decoding): WAV chunk `smpl`, the first loop (`dwStart`, `dwEnd`; the end is inclusive, so the exclusive end is `dwEnd + 1`); AIFF and AIFF-C (compression NONE, sowt, twos, fl32, in24, in32) chunk `INST`, the sustain loop with play mode other than 0, its begin and end marker ids looked up in `MARK` (positions used as written, end exclusive). Missing, broken or backwards data, another type or another AIFF-C compression: no loop. `{rate, start, ende}` in source frames.
- *Zone loops* (`schleifeImPack`): `round(frame * 48000 / source rate)`, minus the leading frames trimmed from the decoded file (`ersterTon`), plus the zone start in the pack. Kept as `loop: [a, b]` (pack frames) only when `a <= loop_a`, `loop_a + 64 <= loop_b <= b`; else the zone has no `loop` and its numbers 9 and 10 are 0.
- *Release samples*: when the folder that is built has a sibling folder (same parent) named `Rel`, `Release` or `Releases` in any case, its audio files are read by the same name reader (note, layers, takes, largest variant) and become zones `art: 'release'` (number 11 = 1, never a loop) behind the played zones in the same pack; key ranges by midpoints with the 12-key reach inside the release set, velocity 1 to 127 split over the layers of the note, the octave convention of the played zones. Zone limit (1024, `zonenMax` of the `Ordner` for tests) and 2 GiB limit count both kinds together. `POST /sampler/instrument {release: false}` leaves them out.
- *Store*: a zone may carry `loop: [a, b]` and `art: 'release'`. List row and build answer: `noten` and `zonen` count the zones played by the key; `schleifen` (zones with a loop) and `release` (release zones) are added when above zero; `bytes` is the whole pack. The build text adds `N looped zones` and `N release zones`; the velocity ranges in it are those of the played zones.
- *`GET /sampler/dateien`*: `instrument` additionally carries `release: <files>` (the sibling folder reads as release samples) and `schleifen: <files of the folder with loop points>` (headers only; the field is left out for a folder of more than 400 audio files and when there are none).
- *Device graph*: without release zones exactly the stage 2a graph (zone numbers 9 and 10 carry the loops). With release zones: knob 10 `rls` "Rel smp" (0 to 2, middle 1, default position 0.5), `rg = rls x vkurve`, per side `rm_<s> = smp.r<s> x rg`, `sum_<s> = amp_<s> + rm_<s>` (`add` a, b) -> `aus.<s>`: the release samples are added behind the envelope gain and are not multiplied by the envelope. `loop_blende` is not set (default 20 ms). Panel: control `k10` and `front` gets `k10` appended (seven knobs).
- Tests: `sampler_schleifen.test.mjs`, `sampler_instrument_loop.test.mjs`, `sampler_instrument_release_route.test.mjs`, `werkbank_regal_instruments.test.mjs`.
- Page: the bar says `, looped` and `, <n> release samples`; the INSTRUMENTS rows show ` · looped` and ` · <n> release` after the zone count.

### 20.21 Page API analysis of a strip (spec 2026-11-17-analyze-window-design)

Page server only: no playback field, no OSC address and no core code is new. One call renders a strip of the open project offline, as the loudness run renders it, and measures it. The answer serves the ANALYZE window of the workbench and the MCP tool `proj_analyse`. Sources: `djk/ui/project/sound_contract.ts` (types, band grid, thresholds, shape check, hand reduction), `project/sound_measurement.ts` (FFT, streaming analyser, masking, hints; pure), `areas/proj/sound_analysis.ts` (request handling, cache, join), `areas/proj/sound_factory.ts` (worker thread), `areas/proj/output.ts` (`analyseVorpruefung`, `rendereStreifen`), page `public/werkbank/{analyse,analyse_zeichnen}.js`, MCP tool `proj_analyse` in `djk/hand/hand.ts`.

**Route.** `POST /proj/analyse`, protection `fremdePost` (as the other `/proj` writes). Body: `quelle` (required), `vergleich?`, `von_beat?`, `bis_beat?`, `ohne_freeze?` (boolean). A source is `art` (`spur`, `gruppe`, `return` or `master`) and `id` (the `spur_id`, `gruppe_id` or `return_id` that `proj_lage` gives; required except for `master`, which takes none). Any other field, in the body or in a source, is `argument_ungueltig`. `vergleich` null counts as no comparison; `vergleich` equal to `quelle` is `argument_ungueltig` (a strip against itself has nothing to compare). Range: missing `von_beat` and `bis_beat` mean `songBereich(false)` (the loop bracket when on, else 0 to the end of the last clip); the checks are those of the export (`pruefeBereich`): 1 to 1024 beats (`ANALYSE_MAX_BEATS`), else `export_bereich`. Nothing is written into the project or the export folder; the temporary renders live in a folder under the system temp directory that is removed whatever happens.

**References (slice 2).** `vergleich` may also be a `RefQuelle`: `{art: 'datei', sha | pfad, von_s?, bis_s?}` (a catalogue sha or an absolute path; `von_s` and `bis_s` together or not at all) or `{art: 'referenz', id}` (a stored curve); never as `quelle`. Only the strip is rendered; the answer carries `vergleich: RefMessung` (no `zeitbild`, `bereich: {von_s, bis_s, datei_s, wahl: 'ganz' | 'laut' | 'fest'}`) and `abgleich`, no `ueberdeckung`; a silent side gives no `abgleich`. Routes (`fremdePost` for POST, `GET /analyse/referenzen` open): `POST /analyse/referenz/messen {quelle, dauer_s?}` answers `{messung}`; `GET /analyse/referenzen` answers `{referenzen: [ReferenzZeile], rollen}`; `POST /analyse/referenz/merken {name, rolle, quelle, dauer_s?}` or `{name, rolle, projekt: {quelle, von_beat?, bis_beat?}}` answers `{referenz}`; `POST /analyse/referenz/loeschen {id}` answers `{ok: true}`. Refusals: `referenz_unbekannt` 404, `quelle_unbekannt` 404, `format_falsch` 422, `messung_fehler` 502, `argument_ungueltig` 400.

**Level matching against a reference (slice 2).** `Abgleich = {versatz_db, baender: [{hz, diff_db | null}] (30), abweichungen: [{hz_von, hz_bis, diff_db}] (at most 3)}` (`public/sound_match.js`, shared by the page and the server). Both mean spectra are reduced to 1/3 octave; `versatz_db` is the median of source minus reference over the bands between 40 Hz and 16 kHz that both carry above -60 dB, so the comparison reads tonal balance and not loudness; `diff_db` = source minus reference minus `versatz_db` (positive: the source has more there), null where one side carries nothing. An `abweichung` is a run of neighbouring bands that differ by at least 3 dB in the same direction, with their mean difference; the three with the largest mean times the root of their band count are named.

**Live picture of the master output (slice 2).** `GET /analyse/live`, open like `/oszi`, always 200. The page server reads the audio ring of section 6.1 (channels 0 and 1, master L and R as they go out; the production master reaches it through `erz/4`) read-only with plain file reads, never a mapping: the last 24 000 frames behind `w`, read again when the writer may have passed the region. Answer `{leer: true, grund: 'kein_ring'}` without a ring or with fewer frames, else `LiveMessung = {leer: false, w, steht, stumm, spektrum: {hz, db} (120 bands), stereo: Stereo, spitze_db, rms_db, true_peak_dbtp, lufs_m}`: spectrum, stereo, peak and RMS over the last 16 384 frames (0.34 s) with the analysis of the strips (short window), `true_peak_dbtp` by 4x oversampling (polyphase windowed sinc, 12 taps per phase), `lufs_m` the momentary loudness of BS.1770 over the last 19 200 frames (K-weighting settled over 4800 frames before them; null below -70 LUFS). `steht` is true when `w` has been the same for at least 150 ms (the engine writes nothing: stopped or hanging); `stumm` when the peak is at or below -90 dB. One call costs about 4 ms on the page server thread. The ANALYZE window polls it every 100 ms for its source `LIVE OUTPUT`; the tool `analyse_live` reads it once.

**Answer.** `AnalyseAntwort = {rev, von_beat, bis_beat, dauer_s, tempo_bpm, quelle: Messung, vergleich?: Messung | RefMessung, ueberdeckung?: Ueberdeckung, abgleich?: Abgleich, hinweise: [Hinweis]}`; `rev` is the revision of the project that was rendered, `dauer_s = (bis_beat - von_beat) * 60 / tempo_bpm`. The route checks the answer with `pruefeAntwort` (a malformed one is `render_fehler`). Minus infinity in dB is written as -200 (`DB_BODEN`, as in `loudness.ts`).
- `Messung = {quelle: {art, id?}, name, stumm: boolean, lautheit: Lautheitswerte, stereo: Stereo, spektrum: Spektrum, zeitbild: Zeitbild}`; `name` is the name of the track, group or return, `Master` for the master.
- `Lautheitswerte = {lufs_i, lufs_s_max, lufs_m_max, lra, true_peak_dbtp, spitze_db, rms_db, crest_db}`, every value a number or null. The first five come from the ffmpeg ebur128 path of `proj_lautheit` (`messeLautheit`, one extra log level for the maxima of the short-term (3 s) and momentary (400 ms) loudness); the answer agrees with `proj_lautheit` for the same strip and range. `spitze_db` is the sample peak of both channels, `rms_db` the RMS of both channels together, `crest_db = spitze_db - rms_db`. A source below the measuring floor of ffmpeg (about -70 LUFS) has `lufs_i`, `lra`, `lufs_s_max` and `lufs_m_max` null with `stumm` false; the true peak and the peaks stay.
- `Stereo = {korrelation, korrelation_min, breite_db, baender: [StereoBand] (four)}`; `StereoBand = {hz_von, hz_bis, korrelation, breite_db, pegel_db}` for the bands below 120 Hz, 120 to 500 Hz, 500 to 4000 Hz and above 4000 Hz (the bins below 20 Hz count in no band). `korrelation` is the phase-meter form sum(L R) / sqrt(sum L^2 sum R^2) without mean removal, 0 when the denominator is 0; `korrelation_min` is the lowest value over non-overlapping 400 ms windows (19 200 frames) that are not silent, the whole-range value when no full window exists. `breite_db = 10 log10(E_side / E_mid)` with side (L - R) / 2 and mid (L + R) / 2, clamped to -200..200 (-200 = pure mono). Band values use the same FFT frames as the spectrum: bins whose centre lies in the band, correlation sum Re(L R*) / sqrt(sum |L|^2 sum |R|^2), width from |S|^2 / |M|^2. `pegel_db` is the power of L plus R (mid plus side) in the band, in the dB scale of the spectrum, the mean over the non-silent frames, -200 when there is none. The correlation of a band means something only where `pegel_db` is above -60 dB; a band without energy has `korrelation` 0 and `breite_db` -200.
- `Spektrum = {hz, mittel_db, max_db}`, three arrays of 120 numbers on the 1/12 octave grid (below). `mittel_db` is the mean band power over the non-silent frames, `max_db` the highest band power of any frame.
- `Zeitbild = {spalten, zeilen, sek_je_spalte, db_min, db_max, daten}`: `zeilen` is 120, `db_min` -90, `db_max` 0, `daten` the base64 of `spalten * zeilen` bytes, column after column, the lowest band first, each band level mapped from -90..0 dB to 0..255 (clamped).
- `Ueberdeckung = {baender: [{hz, quelle_db, vergleich_db, anteil}] (30), schwerpunkte: [{hz_von, hz_bis, anteil}] (at most 3)}`, present only with `vergleich` and when neither side is `stumm`. `hz` is the centre of the 1/3 octave band, `quelle_db` and `vergleich_db` the band of `mittel_db` summed to 1/3 octave. `anteil` is the share of all time columns in which both levels of the band (power sum of four 1/12 values of that column) are above -60 dB and differ by at most 9 dB. A `schwerpunkt` is a run of neighbouring bands with `anteil >= 0.5`: `hz_von` the lower edge of its first band, `hz_bis` the upper edge of its last, `anteil` the mean; the three highest, ties to the lower frequency.
- `Hinweis = {art, text, hz?}`, see Hints.

**Band grid.** 1/12 octave is the semitone, centres on the A440 grid: `hz[n] = 440 * 2^(k/12)` with k = -53..66, 120 bands from 20.60 Hz to 19 912 Hz, edges at k +- 0.5, so a peak names a note. 1/3 octave is four neighbouring 1/12 bands: 30 bands, band m covers k = -53 + 4m .. -50 + 4m, centre `440 * 2^((-51.5 + 4m) / 12)`. 120 levels reduce to 30 by power sum of four (a level at -200 adds nothing; `terzVon`).

**Measuring.** Hann window of 8192 frames at 48 kHz on the mono sum m = (L + R) / 2, hop 2048. Each FFT bin splits its power over the 1/12 bands by the overlap of its interval [f - df/2, f + df/2] (df = 48000 / 8192 = 5.86 Hz) with the band edges, so every band is defined below 140 Hz where a band is narrower than a bin and the total power is exact. Band power `P = 2 sum |X|^2 / (N sum w^2)` over the one-sided bins; level `10 log10(P / 0.5)`: a full-scale sine reads 0 dB, a sine of amplitude 0.5 reads -6.02 dB. The bands are band integrals, not line levels: below about 250 Hz a band is narrower than the main lobe of the window (about 4 bins, 23 Hz), so a full-scale sine reads under 0 dB in its own 1/12 band (30 Hz -7.0 dB, 55 Hz -5.5 dB, 100 Hz -2.9 dB, 200 Hz -1.5 dB; 440 Hz and above 0.0 dB); the sum of the bands stays 0 dB, and the 1/3 octave value reads 55 Hz at -0.5 dB. Levels of low notes are judged in the 1/3 octave spectrum. Since slice 2 the mean and the maximum of the bands below 400 Hz (`TIEF_HZ`) come from a second, long window (Hann over 32 768 frames, `FFT_TIEF`, every fourth column) whenever the range holds at least that many frames: a full-scale sine on the A440 grid then reads -0.2 dB at 55 Hz, -1.1 dB at 41.2 Hz and -2.3 dB at 27.5 Hz in its own 1/12 band (short window: -5.5 dB at 55 Hz); the maximum is the higher of the two windows. The time picture, the masking, the stereo bands and the live picture keep the short window.
- *Raster.* A range of fewer than 8192 frames gives one zero-padded column. Otherwise F = floor((n - 8192) / 2048) + 1 frames; up to 2048 of them (`MAX_SPALTEN`) hop 2048 and give F columns; beyond that hop = ceil((n - 8192) / 2047) and floor((n - 8192) / hop) + 1 columns. One column is one frame, `sek_je_spalte = hop / 48000`. A frame is silent when the power of m is below -90 dB on the dB scale; a silent frame gives a zero column and the floor in the 1/3 octave values and counts in no mean.
- *Sampling.* With a hop above 8192 frames (a range of more than about 6 minutes, 1024 beats at 60 BPM is 17 minutes) every column looks at one window and the frames between the columns are not seen by the spectrum, the time picture and the band stereo values; peak, RMS and the broadband correlation still cover every frame.
- *Silent source.* `stumm: true` when the render peak is at or below -90 dB (`STILLE_DB`), or when the mix silences the strip (mute, fader off, a solo elsewhere, a muted group or return, a master pulled shut) and nothing is rendered; the strip then has no loudness (every value null), `korrelation` 0, `korrelation_min` 0, `breite_db` -200, the spectrum and the time picture at the floor, no hints and no masking; the other strip is still measured. A track with nothing in the range is silent in the same way.

**Hints** (`hinweiseQuelle`, `hinweiseUeberdeckung`; none for a silent source). Order: those of `quelle`, then those of `vergleich`, then the masking ones; an empty list is a good result.
- `bass_nicht_mono`: the band below 120 Hz has `korrelation < 0.5` while its `pegel_db` is above -60 dB. Text `<name>: the bass below 120 Hz is not mono (correlation <x.xx>)`.
- `true_peak`: `true_peak_dbtp > -1`. Text `<name>: true peak <x.x> dBTP is above -1 dBTP`.
- `resonanz`: a band n whose `mittel_db` is at least 9 dB over the median of the bands n-6..n+6 without n (at the edges the ones that exist), above -60 dB and not lower than either neighbour; at most the three largest per source; `hz` is the band centre. Text `<name>: narrow peak at <62 Hz or 3.0 kHz> (<note>), <x.x> dB above its octave`, the note in the house convention (60 = C3).
- `ueberdeckung_tief`: a `schwerpunkt` with `hz_von < 250`; `hz` is the geometric mean of its edges. Text `<name> and <name> mask each other from <hz> to <hz> (<n> % of the time)`.

**Refusals** `{fehler, text}` (a failing ffmpeg or worker is `render_fehler`, 502, with its reason): 400 `argument_ungueltig`, `export_bereich`, `spur_unbekannt`, `gruppe_unbekannt`, `return_unbekannt` (a vanished id is refused before anything is rendered); 409 `kein_projekt`, `ki_gestoppt`, `beschaeftigt`, `host_insert_echtzeit` (a plugin stage is active; the render is offline and cannot capture it), `transport_laeuft`, `freeze_noetig`, `audio_fehlt`, `wirt_fehlt`, `wirt_fehler`.

**Freeze and transport.** The tool does as `proj_lautheit` does: an unfrozen Surge track with notes that takes part is frozen first, which needs a stopped transport (`transport_laeuft` otherwise, only when such a track exists and the transport runs). The window sends `ohne_freeze: true` and never freezes: a participating track with unfrozen notes is `freeze_noetig` (409, the text names the track); a track that does not take part (silent in the mix) does not count. Without a freeze to do, the analysis also runs while the transport plays: the offline render does not touch the playing core.

**Lock, run kind and sharing.** The run takes the output lock of `Ausgabe` (`belege`) with the run kind `ausgabe_lauf {art: 'analyse'}`: a freeze, export, merge, bounce, resample or loudness run answers `beschaeftigt` meanwhile and the other way round. `analyseVorpruefung` (argument fields, Stop Cypher, open project, range, vanished sources) looks at neither the lock nor the transport, so a cached answer or a join works while another run holds the lock. A request with the same key as the running one waits for that run and gets its answer, but only when the answer is for the revision the request itself saw (the revision the run started with, or the one the answer carries when the run froze a track and so raised it); a project that changed meanwhile is measured again, so an answer to an older revision is never delivered. A different request meanwhile answers `beschaeftigt`.

**Cache.** An in-memory LRU of 8 answers keyed `slug|rev|quelle|vergleich|von|bis` (`rev` of the project that was rendered); a repeated request for an unchanged project is answered at once. The log line `proj_analyse` carries slug, range, both sources and the milliseconds.

**Worker.** The FFT work runs in a `node:worker_threads` worker (`sound_factory.ts`, started per run, ended after its answer) that reads the WAVs in blocks of 65 536 frames (`leseWavF32Bloecke` in `sampler/wav.ts`), so the page server keeps answering during a long analysis and memory stays bounded. A silent source is fed zeros instead of a file. The loudness run and the worker run at the same time.

**Window.** The ANALYZE button of the workbench top bar opens a floating window of kind `analyse`: selectors for the source and the optional comparison (a vanished choice falls back to the selected track, or the master; the comparison never equals the source), the spectrum with the column under the playhead, the time picture with bar lines by the time signature, stereo per band (`mono` for a pure mono signal, `no signal` for a band without level), the loudness numbers, the masking and the hints. At most one request is in flight; a trigger during a request marks it stale, its answer is dropped and one fresh request follows; a project change measures again 800 ms after the last change. While an analysis runs the PRODUCTION view shows it and disables EXPORT and FREEZE.

**Hand.** `proj_analyse {quelle, vergleich?, von_beat?, bis_beat?, fein?}` posts the same body without `ohne_freeze` (so it freezes like `proj_lautheit`), time limit 30 minutes (`DJK_HAND_FRIST_PROJ_ANALYSE_MS`). The answer is reduced by `fuerHand`: no `zeitbild`, and the spectrum summed to the 30 bands of 1/3 octave by power sum of the four 1/12 bands unless `fein` is true (not sent to the server). Refusals are the route's.

- Tests: `sound_contract.test.mjs`, `sound_measurement.test.mjs`, `sound_hints.test.mjs`, `loudness_maxima.test.mjs`, `wav_bloecke.test.mjs`, `proj_analysis_flow.test.mjs`, `proj_analysis_route.test.mjs`, `proj_analysis_end.test.mjs` (with the real worker), `werkbank_analysis_zeichnen.test.mjs`, `werkbank_analysis.test.mjs`, `production_output.test.mjs`; in `djk/hand` `hand_presets.test.mjs` and `hand_mcp.test.mjs`; the fixture `tests/fixtures/analyse_antwort.json`.

### 20.22 Page API media browser: catalog shelf, fixed collections, drag from the shelf (plan 2026-11-17-media-browser-shelf)

Page server only: no OSC address, no core code and no new hand tool (the hand tools `stoebern`, `kollektionen` and `kollektion_aendern` keep their schemas). The SAMPLES tab of the STUDIO shelf reads the one-shot catalog, favourites and recently used are two fixed collections, and a shelf row can be dragged onto the track list or onto a row of a drum kit. Sources: `djk/ui/catalog.ts`, `erreichbar.ts`, `server.ts` (the `/stoebern` routes), `collections/{feste,speicher,modell}.ts`, `sampler/{datei,schnitt,kit}.ts`, `areas/sampler/file_routes.ts`, page `public/werkbank/{regal_samples_modus,regal_katalog,katalog_ablage}.js`, `public/usage.js`, `public/{stoebern,stoebern_tabelle,bibliothek_ansicht,kollektionen}.js`, `public/production/storage.js`.

**Catalog route, new parameters.** `GET /stoebern` (the catalog browser of the DJ library) takes two more parameters; an empty value counts as absent, any other value than the one named is 400 `schutz_ungueltig` or `vorrang_ungueltig`.
- `schutz=aus` hides protected rows (`katalog.schutz IS NOT NULL`, today the value `ableton`): the page of rows, its `gesamt`, and with the same parameter `GET /stoebern/baum` (folders and facets) and `GET /stoebern/quellen`. Without it nothing changes; the DJ library still shows protected rows (marked `nur_live`).
- `vorrang=1` switches on the priority order, the answer then carries `vorrang: true`. Order, in four groups: rows whose folder is reachable and that have a rank (by rank), reachable rows without rank (by the chosen column, `sort` and `richtung` as before), unreachable rows with a rank, unreachable rows without rank. The rank is 0 for a favourite, `1 + i` for a recently used sample at distance `i` from the newest, and a favourite wins over its recent rank. A folder is reachable when it exists (`Erreichbarkeit.ordnerDa`, kept per folder for 10 s, `ERREICHBAR_TTL_MS`); a row without a folder counts as unreachable. The unreachable folders and the ranks go into the query as two small sets (no function runs per row); when both are empty the query is the one without `vorrang`. `gesamt` does not depend on `vorrang`. Paging stays stable because the rank and the column end in the row id.
- Every row of `/stoebern` carries `favorit` (boolean): the sha is in the fixed collection `favourites`.
- Per catalog state (file identity, size, mtime of `katalog.sqlite`) the folder sums (`Katalog.ordnerSummen`), the tree (`baum`) and the count of a filter are kept; the first call after a start or after a catalog rebuild pays for them once. Usage data is never written into the catalog file (it is rebuilt hourly and opened read only per query).

**Sources.** `GET /stoebern/quellen?typ=&schutz=` answers `{typ, quellen: [{name, pfad, n, da, grund?}], gebaut_am}`, most files first, then by name. A folder belongs to a source by `quelleVon`: the longest sampler root (§20.19) that holds it (`name` of the root), else its disk (`/media/<user>/<x>`, `/run/media/<user>/<x>` or `/mnt/<x>`, `name` the last part), else the system disk (`name` `System disk`, `pfad` `/`). `n` is the sum of the folder counts. `da` is false when the source is not there now. **Empty mount rule:** a source counts as present only when its path is a directory with at least one entry, because an unmounted disk often leaves its empty mount folder behind (the failure of 2026-11-17); the system disk is always present. `grund` is given only with `da: false`: `platte` when the disk is not mounted, `ordner` when the disk is there and the sampler folder on it is not (or is empty). The answer is kept 10 s per type and filter and per catalog state. Refusals as the other `/stoebern` routes: 400 `typ_ungueltig`, 503 `katalog_fehlt`, `katalog_kaputt`, `katalog_schema`.

**Sampler file routes by catalog sha.** `GET /sampler/datei/hoer` and `POST /sampler/datei/spur` take `sha` (64 hex) instead of the pair `wurzel`/`rel`; exactly one way to name a file, else 400 `argument_ungueltig`. The row decides: unknown sha, a row without a file path or a file that is gone is 404 `quelle_unbekannt` (nothing is left behind: no cut, no tone, no track); a library track or a protected row is 422 `format_falsch`; no catalog 503 `katalog_fehlt`; a refusal of the catalog keeps its code (400 `sha_ungueltig`, 503 `katalog_kaputt`). So preview and TO TRACK work for catalog files outside the sample roots. The cut made by `spur` has the source kind `katalog` (`Quelle = {art: 'katalog', ref: <sha>}` in `sampler/schnitt.ts`, provenance only: the cut audio is the stored float file); the kind is accepted only from these two routes (`Ordner.katalogPfad`), anywhere else 400 `argument_ungueltig`. The cut name is `name` of the request, else the name of the catalog row (at most 60 characters), else the file name. Everything else (root note, one history step, `werkbank_voll`, `ki_gestoppt`) is as in §20.19.

**Pad drop.** `POST /sampler/datei/pad {spur_id, ton, sha}`, protection `fremdePost`: the catalog sample becomes the sound of one note (`ton`, 0 to 127) of the kit that an instrument track plays. Any other field is 400 `argument_unbekannt`. The old kit is never written (other tracks and stored projects play it): `kitMitKlang` writes a copy of the kit under the next free name (`<kit>-2`, `-3`, ...) with that sound replaced (same row name, new file `<ton>.f32`) or added (name `<bank>:<n>`, the bank proposed from the sound, `n` the smallest free number), `kit.json` last; the sound gets the 5 ms end fade, at most 10 s. The track is switched to the copy by `spur_aendern` in one history step labelled `Sound on <name>`. A failure removes the copy again. The answer is `{rev, projekt, kit, ton, name, text}`, `kit` the name of the copy. The route adds no track, so it never answers `werkbank_voll`, also in a module that holds 8 instrument tracks.
- Refusals `{fehler, text}` (all before anything is written): 400 `argument_ungueltig` (bad `spur_id`, `ton` or `sha`), `klang_zu_lang`, argument error for a kit that would pass 256 MiB; 404 `spur_unbekannt`, `quelle_unbekannt`; 409 `kein_projekt`, `kein_werkbank`, `ki_gestoppt`, `kein_kit` (the track does not play a sample kit, text `Track <name> plays no sample kit`), `kit_voll` (92 sounds, a new note is refused, a replacement is not), `kit_fremd` (the file `<ton>.f32` of the kit belongs to another note), `kit_vorhanden`; 422 `format_falsch`; and the refusals of the sha as above and of the project change (`rev`).

**Fixed collections.** Two ordinary collection files under `/kollektionen` with the slugs `favourites` (name `Favourites`) and `recently-used` (name `Recently used`; constants in `collections/feste.ts`). They are created inside the lock of the first write that names them (`POST /kollektionen/<slug>/posten`); until then `GET /kollektionen/<slug>` answers 404 `unbekannt` and the server list does not show them (the page lists both anyway, empty, and reads the 404 as an empty collection). They hold items `{art: 'sample', sha}`. `recently-used` keeps at most `ZULETZT_MAX` = 50 items, the newest last; a write that passes 50 drops the oldest. Both refuse a rename and a delete with 409 `feste_kollektion` (also a rename onto one of the two slugs). The page writes with one request `{weg: [x], hinzu: [x]}`, so a used sample moves to the end; this is not awaited and its failure is silent. The count against the 200 collections applies as to any collection.

**Shelf (page).** The SAMPLES tab has two modes, LIBRARY and FOLDERS (the choice and the instrument class are remembered in the browser under `djk-wb-regal-katalog`). FOLDERS is the folder browser of §20.19 and §20.20, unchanged. LIBRARY asks `GET /stoebern?typ=oneshot&schutz=aus&vorrang=1&limit=100` (plus `text`, `feld=instrument&wert=`, `seite`), the instrument buttons come from the facet `instrument` of `/stoebern/baum?typ=oneshot&schutz=aus` (ALL, one button per class with its count, the empty value reads OTHER), and every source with `da: false` is named in a line (`<name>: disk not mounted · <n> samples not reachable`). A row shows the star, the name, its folder (`<source>/.../<folder>`), instrument, pack and length, and, when the file is reachable, TO TRACK. A click plays the preview (a second click stops it), the arrow keys move and play, Enter or TO TRACK calls `POST /sampler/datei/spur {sha}`. Rows that are not reachable are listed last, are dimmed and neither play nor drag. A refusal of the catalog (503 `katalog_fehlt`) or of the search (400 `suche_ungueltig`, `zu_viele_suchwoerter`) is shown in place of the list and FOLDERS stays usable; a sample that vanished between listing and click shows `This sample is not reachable any more: its file or disk is gone`. The star calls the two writes above and flips back with the refusal text when the server refuses. TO TRACK and a drop write `recently-used`; a preview does not.
- *Drag.* A reachable row is `draggable` and carries the payload of the PRODUCTION library (`application/x-djk-clip`, with the `sha`). Targets: the whole column TRACKS takes a sample (a new instrument track, as TO TRACK); a drum row in the raster takes it only on a track that plays a sample kit (`geraet.name === 'kit'`, `POST /sampler/datei/pad` with the note of the row). On a track with a drum synth a drop shows a text and sends nothing.
- *DJ library and PRODUCTION library.* `GET /stoebern` carries `vorrang=1` while no column is chosen (a chosen column is the order, no priority any more); a row has the star; loading a deck with a 200 answer and a drop into PRODUCTION write `recently-used`. The collection list shows the two fixed collections first, without RENAME and DELETE.

**Known limits.** The DJ library still shows protected rows. The FOLDERS rows are not draggable. A pad drop makes a kit copy per drop (the folder `kits` grows by one kit each time, the old ones stay). The reachability of a folder is read with a 10 s delay, and the priority order tests the folder, not the file. Not heard: the sound of a replaced kit sound, and the native drag with the mouse was not tried (the page tests send the drop events).

- Tests: `erreichbar.test.mjs`, `catalog_vorrang.test.mjs`, `browse_regal_route.test.mjs`, `sampler_file_catalog_route.test.mjs`, `sampler_source_catalog.test.mjs`, `sampler_kit_sound.test.mjs`, `sampler_file_pad_route.test.mjs`, `collections_feste.test.mjs`, `usage_page.test.mjs`, `werkbank_regal_catalog.test.mjs`, `werkbank_regal_samples.test.mjs`, `werkbank_regal_drag.test.mjs`, `browse_stern.test.mjs`, `browse_page.test.mjs`, `collections_page.test.mjs`.

**Search over everything (slice B4).** `GET /suche?q=<words>&arten=<comma list>&je=<n>&passt=0|1`, protection `offen`, one route of the area `suche` (`areas/suche/area.ts`, engine `suche.ts`). It asks the sources the shelf already has, each with its own search; there is no new index and no new database. `q` is required (an empty or blank `q`, more than 200 characters, an unknown kind in `arten`, `je` that is not a whole number of 1 or more, `passt` other than 0 or 1: 400 `argument_ungueltig`). `arten` is a subset of `samples`, `loops`, `instrumente`, `geraete`, `presets`, `module`, `schnitte` (default: all; the answer keeps this order). `je` is the number of hits per kind, default 5, a value above 50 counts as 50.
- *Answer.* `{q, gruppen: [{art, name, zahl, treffer, fehler?}], passt}`. `zahl` is the total of the kind, `treffer` has at most `je` rows. A hit is the row the shelf draws for that kind: the catalog kinds carry the row of `GET /stoebern` (with `favorit`, `pfad_da`, `nur_live`), cuts the row of `GET /sampler/liste`, stored instruments the row of `GET /sampler/instrumente` (a hit with an `id`), modules the entry of `GET /proj/liste`; Baukasten instrument and effect graphs carry `{name, art, kategorie?, text?}` and presets the row of `GET /presets`. `passt` is `{bpm, camelot}` when FITS was applied, else null.
- *Sources and matching.* `samples` and `loops` are the catalog types `oneshot` and `loop` through `Katalog.seite` with the filter text `q` (its own parser: FTS5 prefix terms, every term quoted, `feld:wert` columns), protected rows never, the priority order of `vorrang=1` (reachable first, rank by favourites and recent, then by name). A `q` that holds no letter or digit finds nothing (never everything). The other kinds are filtered in memory: every word of `q` must occur, ignoring case (Unicode NFC lower case), as plain text, so `%`, `_`, `(`, `[` and `.` have no meaning of their own. `instrumente` are the sampler instruments (name) and the Baukasten graphs of art `instrument` (name, category, text); `geraete` the graphs of art `effekt`; graphs the sampler generates (`ins-`, `smp-`, `ton-`) are left out, as the instruments and cuts are listed themselves. `presets` use the search of the preset store (`speicher.liste({q})`), `module` the workbench modules (and broken entries, as the shelf lists them) by name, `schnitte` the cuts by name.
- *A source that fails* gives an empty group `{zahl: 0, treffer: [], fehler}` with the reason: the code of a catalog refusal (`katalog_fehlt`, `katalog_kaputt`, `katalog_schema`, `suche_ungueltig`, `zu_viele_suchwoerter`) or `suche_quelle` (the message stays in the server log). The other groups are complete; the search itself does not fail.
- *FITS* (`passt=1`) applies to the catalog kinds only and only while a project is open: tempo within 6 percent of the project tempo, of half or of double it (three disjoint ranges, each asked of the catalog), and, when the project key `tonart` is major or minor, a Camelot key equal or adjacent to it (the neighbours of `camelotNachbarn`: one step either way and the parallel key). A row without a tempo is not a hit; a row without a key passes the key rule (only a far key drops it), because the catalog has almost no keys (measured 2026-11-17: 1 of 8 116 loops, 8 of 74 831 one-shots; tempo on 7 129 loops and 1 408 one-shots). Without an open project nothing is applied and `passt` is null.
- *Page.* A field above the shelf tabs (`public/werkbank/regal_suche.js`, 250 ms debounce, answers of older queries are dropped). While it has text the shelf shows the groups instead of the tab: a heading with the count, up to five rows drawn by the row code of the tabs, and "show all <n>" where more exist. For SAMPLES without FITS it moves to the SAMPLES tab in LIBRARY mode with the query in that tab's own search field (the instrument button back to ALL, so the same hits are on top); with FITS on, and for the other tabs (they have no search field), the group opens in place with up to 50 hits (`arten=<kind>&je=50`) and stays open while the text is unchanged. Clearing the field, or Escape while the focus is in the shelf, returns to the tab that was open; Escape also stops a preview. After a network error Enter asks again. `/` focuses the field when no input has the focus. FITS is a toggle next to the field (remembered under `djk-wb-regal-passt`), off while no module is open. Baukasten instruments, effect devices and presets have no row in the shelf and no action there: they show name and facts only.
- Tests: `suche.test.mjs`, `suche_route.test.mjs`, `werkbank_regal_suche.test.mjs`, `routes_golden.test.mjs`.

### 20.23 Page API storage layout: storage table, source list, collecting, exports, cache caps (plan 2026-11-17-storage-layout)

Page server, start scripts and two Python packages; no OSC address, no core code and no new hand tool (the descriptions of the tools `graphen` and `proj_kits` name the new folders). Sources: `djk/config/ablage.json`, `djk/ui/paths.ts` (TypeScript reader), `djk/ablage/` (Python reader, `python3 -m ablage pfad <name>` and `shell`), `djk/start/umzug.py` (command `djk-umzug`), `djk/quellen/` (command `python3 -m quellen`), `djk/ui/sources.ts`, `areas/quellen/area.ts`, `project/{einsammeln,quelle_pfad,exporte,exporte_cli,cache_deckel,modul_ablage}.ts`, `areas/proj/einsammeln.ts`, page `public/werkbank/sources_dialog.js` and `public/production/{freeze_export,ausgabe}.js`. The state described is the one after the defaults switched to the new layout (`"vorgabe": "neu"`); until then `"vorgabe": "alt"` keeps every default at the old place.

**Storage table.** `djk/config/ablage.json` names every storage kind: `alt` (old place), `neu` (new place), `env` (environment override or null) and `kern` (read by the audio core at a fixed path). Templates (written in curly braces in the file): `<HOME>`, `<KONFIG>` (`<HOME>/.config/cypherdj`), `<HEIM>` (`CYPHERDJ_HEIM`: an absolute path, a trailing `/` is stripped, unset or empty means `<HOME>/cypherdj`, any other value is the error `CYPHERDJ_HEIM must be an absolute path`).

| Kind | Old place `<KONFIG>/...` | New place `<HEIM>/...` | Variable | Core |
|---|---|---|---|---|
| `projekte` | `<HOME>/cypherdj-projekte` | `werke/projekte` | none | no |
| `module` | `module` | `werke/module` | `CYPHERDJ_MODULE` | no |
| `sampler` | `sampler` | `werke/sampler` | `CYPHERDJ_SAMPLER` | no |
| `presets` | `presets` | `werke/presets` | none | no |
| `klaenge` | `klaenge` | `werke/klaenge` | `CYPHERDJ_KLAENGE` | no |
| `kollektionen` | `kollektionen` | `werke/sammlungen/kollektionen` | none | no |
| `raster` | `raster` | `werke/korrekturen/raster` | none | no |
| `hotcues` | `hotcues` | `werke/korrekturen/hotcues` | none | no |
| `kits` | `kits` | `werke/kits` | `CYPHERDJ_KIT_ORDNER` | yes |
| `loops` | `loops` | `werke/loops` | none | yes |
| `geraete` | `baukasten` | `werke/geraete` | `CYPHERDJ_BK_ORDNER` | yes |

Fixed names (one place, optional variable): `mediathek`, `analyse`, `bibliothek_konfig` (`CYPHERDJ_BIBLIOTHEK_KONFIG`), `surge_werk`, `plugin_index`, `umgebung` (`CYPHERDJ_UMGEBUNG`), `pruefen` (`<HEIM>/pruefen`), `quellen` (`<HEIM>/quellen.toml`) and `referenzen` (`<HEIM>/werke/referenzen`, `CYPHERDJ_REFERENZEN`; test instances use `/dev/shm/cypherdj-<i>/referenzen`).

**Resolution** (`ablageOrdner`, the same in `ablage.ordner`): (1) the variable of the kind when it is not empty; (2) a kind with `kern` true, or a table with `vorgabe` `alt`: the old place; (3) `vorgabe` `neu`: the old place when it is a real folder (not a link), else the new place. A real old folder next to a non-empty new folder (state `beide`, for example a mirrored `werke/` folder) stays at the old place and logs `ablage_beide` once per kind and process. Test instances (`CYPHERDJ_INSTANZ` a to i) keep their paths under `/dev/shm/cypherdj-<i>/` and `~/.config/cypherdj-<i>/`; `CYPHERDJ_HEIM` applies to the production instance only. Nothing creates `<HEIM>` while its parent is missing or an empty mount folder (refusal `heim_nicht_bereit`, text `the parent of CYPHERDJ_HEIM (<path>) is missing or empty: is the disk mounted?`; the parent may also be the home folder itself).

**Command `djk-umzug`** (Python, `djk/start/umzug.py`; the head of the file is the help text). Without `--ausfuehren` nothing on disk changes; every executed run appends its report as one line to `<HEIM>/.umzug/bericht.jsonl`.
- `djk-umzug`: table of every kind with its state (`alt`, `umgezogen`, `neu_installiert`, `nur_neu`, `beide`, `fremder_link`, `unterbrochen`) and what a move would do.
- `djk-umzug <kind> [--ausfuehren]`: moves one kind to its new place and leaves a link at the old place. Same disk: a link is made next to the old place, the old place is renamed to the new one, the link replaces the old place. Another disk: a copy next to the new place (`.umzug-teil`), compared by a manifest (entries, sizes, sha256), renamed into place, the old folder kept as `<old>.umzug-alt-<stamp>`. Parents of a nested new place are created before anything happens at the old place. Refused with code 3 while a unit `cypherdj*` is active (or systemd cannot be asked), or a process has the folder as its working directory or an open file in it.
- `djk-umzug zurueck <kind> [--ausfuehren]`: the way back. `djk-umzug aufraeumen <kind> [--ausfuehren]`: deletes the kept old copy of a cross-disk move, only when the old place is the finished link, the manifest of the copy is there, the old copy still equals it, every file of it is at the new place and no file at the new place carries the mtime of the copy with other content.
- `djk-umzug einrichten [--still]`: creates missing folders and links, allowed while units run, never touches a real old folder. A fresh install (`neu_installiert`) gets the new folder and, for a core kind, the link at the old place; `nur_neu` gets its link; `beide` and `fremder_link` are reported and left.
- `djk-umzug pruefen`: lists which project slugs look like test projects by three name rules (a suggestion, it moves nothing); `pruefen --liste <file> [--ausfuehren]` moves exactly the slugs of the file (a JSON object with the key `slugs`) to `<HEIM>/pruefen/<slug>` and leaves a link in the project folder; `pruefen zurueck (<slug> | --alle) [--ausfuehren]` brings them back.
- `djk-umzug modulnamen [--ausfuehren]`: renames module folders named by a bare 16-hex id to `<name>-<4 hex>` (rule of `module_storage.ts`, below).
- Exit codes: 0 ok or nothing to do, 1 I/O error, 2 usage, 3 in use, 4 conflict, 5 verification failed, 6 home not ready.
- **Journal.** A running move keeps `<HEIM>/.umzug/<kind>.json` (direction `hin` or `zurueck`, step `begonnen`, `verschoben`, `kopiert`, `fertig`). A journal that is not at `fertig` marks an interrupted move. The next run reads the journal and what exists at the old place, the new place and the temporary entries, and applies exactly one continuation rule or refuses with code 4 and changes nothing: U1 to U6 finish or restart the way there (for example U1: the old place is still whole and the new one is not started, so it starts again; U5: a cross-disk copy is complete and is verified again against the old place, a stale copy is discarded and made again; U6: the old copy was set aside and only the link is missing), Z1 to Z5 do the same for the way back, U3 and Z4 only close the journal because the state is complete, U7 is the refusal `unterbrochen_unklar` with a text naming what exists and what to do by hand.

**Source list `<HEIM>/quellen.toml`.** One file owned by the package `djk/quellen`; nothing else writes it (the page server runs the command line, every write is atomic under a lock and refused when `<HEIM>` does not exist). A missing file is an empty list. Keys: `schema` (1); `[[wurzel]]` with `name` (1 to 40 characters, no `/`, unique), `art` (`track`, `loop`, `oneshot`, `sample`, `mix`, `mitschnitt`, `midi`, `spiegel`, `erzeugt` or `stimme`), `pfad` (absolute; for every machine without an entry in `pfade`) and optional `wechselplatte` (boolean; unset means a path under `/media/` or `/run/media/`), `katalog` (default true: a catalog root), `regal` (default false: a shelf root), `laufwerk`, `[wurzel.pfade]` (host name to absolute path) and `[wurzel.mediathek]` (a table of the media library list, passed through unchanged); `[[klang]]` with `name`, `wurzel` (names a root) and `rel` (relative, no `..`) for the kit sources; `[[fern]]` (entries of the media library list, passed through). An unknown key or a bad value is the error `quellen: <file>: <entry>: <text>` (exit 3). A root with no path for this machine (neither `pfade` for the host nor `pfad`) is `kein_pfad_fuer_rechner`, listed and never an error. The older lists (`bibliothek.json`, the shelf list `sampler/wurzeln.json`, the media library list, the `CYPHERDJ_KLANG_*` lines of `umgebung.env`) are generated from the file by `python3 -m quellen schreibe-alt`; `importiere [--ausfuehren]` builds the file from them once (exit 4 when it already has roots) and `vergleiche` lists differences. Command line: `zeige --json [--host H]`, `dazu --name N --pfad P --art A [--wechselplatte ja|nein] [--regal] [--kein-katalog]`, `weg --name N`; exit 0 ok, 1 differences (`vergleiche`), 2 usage or a bad `CYPHERDJ_HEIM`, 3 invalid file, 4 name taken, unknown or still used by a kit source, 6 home folder missing.

**Routes `/quellen`** (`areas/quellen/area.ts`, class `Quellen` in `sources.ts`). Reachability is decided by the one function of §20.22 (`Erreichbarkeit.quelleDa`, empty mount rule). The tablet port refuses the whole prefix (403, also the read: the answer shows local folder paths).
- `GET /quellen` answers `{datei, wurzeln: [{name, art, pfad, wechselplatte, katalog, regal, erreichbar, grund?}]}`; `grund` only with `erreichbar: false`: `platte`, `ordner` (as in §20.22) or `kein_pfad_fuer_rechner` (then `pfad` is null). The answer of the command line is kept per mtime and size of the file; reachability is asked at every call.
- `POST /quellen/dazu {name, pfad, art, wechselplatte?, regal?}` (protection `fremdePost`; `art` one of `sample`, `oneshot`, `loop`, `track`; `name` at most 40 characters without `/`; `pfad` absolute) and `POST /quellen/weg {name}` answer the new list like `GET`. After each write the old lists are regenerated (`schreibe-alt`), so the shelf sees the change at once.
- Refusals `{fehler, text, detail?}`: 400 `argument_ungueltig`; 404 `unbekannt` (weg: no such name); 409 `name_vergeben`, `quelle_benutzt` (a kit source still uses the root), `quellen_kaputt` (the file cannot be read), `heim_nicht_bereit`; 500 `quellen_fehler`; 503 `python_fehlt`. A command takes at most 15 s.
- Dialog: SOURCES in the shelf header opens SOURCE FOLDERS (a row per root with a dot, name, path, state text and REMOVE after a confirm; the form has path, name, kind, removable drive and ADD). FOLDERS is the mode switch next to LIBRARY and is unrelated.

**Collecting: `POST /proj/einsammeln`** (`areas/proj/einsammeln.ts`, `project/einsammeln.ts`). Copies every audio source of the open project that lies outside the project folder into `<project>/audio/<name>-<sha8>.<ext>` (`<name>` the readable name of the file without extension, `<sha8>` the first 8 characters of the clip's sha256, the extension in lower case, `.wav` when there is none). A copy is found again by the sha8 ending of its name. It copies and never moves or deletes a source. The body must be empty (`{}`, any field is 400 `argument_ungueltig`). Answer `{kopiert, schon_da, fehlt: [sha], abweichend: [sha], bytes, aufgeschoben, fehlt_grund: {<sha>: <reason>}}`; reasons `source_missing`, `timeout`, `cancelled`, `copy_failed`. Refusals: 400 `argument_ungueltig`, 409 `kein_projekt`, 409 `transport_laeuft` (the transport runs, a deck plays, or a loop box or studio stream is live; nothing starts), 500 `intern`; protection `fremdePost`. Each file is copied by a child process under `nice -n 19` and `ionice -c 3` (`ionice` is left out when it is not installed) and then read once more for its sha256; a copy whose sha256 differs from the clip's is removed and listed in `abweichend`. The copy goes to a temporary file `.q-<name>.tmp-<hex>` that is synced and renamed; leftovers of an earlier run are removed at the next run in the same folder. Time limit per file: 120 s, or one second per MB when that is longer; over it the child is killed and the sha is in `fehlt` with `timeout`. No file is ever read whole into the page server. A folder `audio` that this run created and left empty is removed again.
- *Background collecting.* The session reports the open project to the same code once after opening it and once after a change that adds or replaces an audio clip; a finished export reports it with all sources. Only sources on a removable disk are copied (`wechselplatte` of the root, else a path under `/media/` or `/run/media/`); the button and the report after an export copy every outside source. The background job re-checks before each file whether the transport and the decks are free and otherwise waits (5 s) and tries again without a limit; it never answers 409. A source on a disk that is not mounted is `fehlt` with `source_missing` and is tried again at the next opening. One job per project folder at a time.
- *Page.* COLLECT in the PRODUCTION output row (disabled while a freeze or export runs) posts the empty body and shows `Collected <n> file(s) (<MB> MB) · <n> already in the project · <n> missing (disk not mounted?) · <n> copied wrongly and removed`.

**Exports** (`project/exporte.ts`, `djk-exporte`). After every export a project keeps its three newest exports; older ones move (rename, never delete) to `<projects folder>/.papierkorb/exporte/<slug>/` (a name taken in the bin gets `.2`, `.3`, ...). An export is a WAV file or a folder of per-track files (it holds `mix.wav`) named `<slug>-YYYYMMDD-HHMMSS[-<n>]`; MIDI export folders and other names do not count and never move. The export just written always stays. A name that appears in a `.md` file under one of the folders of `CYPHERDJ_EXPORT_GENANNT` (`:` separated, read at each call) stays and does not count; when one of those folders does not exist nothing is tidied (log `export_genannt_ordner_fehlt` once). A failing move leaves the entry and logs `export_aufraeumen_fehler`. `djk-exporte [--ausfuehren] [--genannt-in DIR]... [--wurzel DIR]` does the same for every project (exit 2 for a missing named folder); without `--ausfuehren` it moves nothing.

**Cache caps** (`project/cache_deckel.ts`). Only derived files are removed, only regular files whose name matches the cache's pattern directly inside the cache folder, oldest first (mtime). The decode cache (`<work folder>/audio/<sha>.f32`) is capped at 5 GiB (`DEKODIERT_DECKEL`), the waveform cache (`*.welle`, not the `.teil` files of a running computation) at 1 GiB (`WELLE_DECKEL`). A decode is never removed when a project (real or linked, open or saved) names its sha in its clips or in its history `undo.jsonl`, nor when it is the open project's, the one just decoded, or named in a `wiedergabe-*.json`. The cache can therefore stay over its cap; the run then logs `cache_deckel_voll` once per start and folder, and a run that could delete nothing is not repeated for 10 minutes. When a project cannot be read, nothing is deleted (`cache_deckel_projekt_unlesbar`). A cache at or under its cap reads no project.

**Module folders** (`project/module_storage.ts`, `modulOrdnerName`). `<readable title>-<4 hex of the id>`, with `-a` or `-b` for a live slot before the id part (`<name>-<a|b>-<4 hex>`), 8 hex characters when the short name belongs to another module, `modul` when the title has no usable characters. The module id inside `modul.json` stays the reference; a folder renamed by hand or still named by the bare id is found by it.

**Known limits.** The move of the eleven kinds, the move of test projects and the import of the source list were run on one machine, by rename on one disk; the cross-disk copy path is covered by tests only, no second machine was set up, and the behaviour of the native core with a sleeping removable disk is not measured. The background collector and the cache caps run in the event loop of the page server between files; a cap run with many projects was not timed.

- Tests: `djk/ablage/tests/test_storage.py`, `djk/start/tests/test_umzug.py`, `test_storage.sh`, `djk/quellen/tests/test_{datei,alt,cli}.py`, in `djk/ui` `paths.test.mjs`, `proj_sources.test.mjs`, `sources_area.test.mjs`, `sources_dialog.test.mjs`, `project_einsammeln.test.mjs`, `proj_einsammeln_route.test.mjs`, `project_exporte.test.mjs`, `cache_deckel.test.mjs`, `module_storage.test.mjs`.

### 20.24 Page API find sound: variant round for knob values (spec 2026-11-17-find-sound-design, part 1)

Page server only: no OSC address and no core code is new; the round uses the transient knob row `spur/<slot>/bk/<k>` the light command `geraet_param_setzen` already produces. Only the first 8 Baukasten tracks have such rows: `hoereBk` refuses the 9th to 16th with `param_nicht_live` (409). Sources: `djk/ui/project/sound_runde_contract.ts` (constants, types, tree check), `project/sound_runde.ts` (features, effect, candidate order, acceptance, texts, tree operations; pure), `areas/proj/sound_runde.ts` (the round, its memory, the routes), `areas/proj/output.ts` (`rendereKlangVarianten`), `areas/proj/session.ts` (`hoereBk`), page `public/werkbank/sound_runde.js`, MCP tool `klang_runde` in `djk/hand/hand.ts`.

**What a round is.** For the Baukasten instrument of one track the server renders the track alone over the loop range (at most 16 beats; without a loop from beat 0) as the project has it (place A) and with exactly one knob moved, reduces every render to features and puts up to three audible neighbours on the places B to D. The step of a knob is not fixed: it is widened up the ladder `RUNGEN` = 0.18, 0.35, 0.6, 1 of the knob travel (1 = the range end) until the audibility D reaches the target of the level; at most 3 tries per knob and direction, the last allowed try is always the range end, and a knob whose range end stays under the target of the level is offered at its range end as a place marked `anschlag: true` (text ending ` · max`, the strongest the knob can do) when it reaches the subtle target there, and dropped only when it is inaudible even there; fill-up order: audible places on a new knob, range-end places on a new knob, then second places of a knob already offered, so different knobs come before a second place of one knob. A finished round without any audible knob carries `hinweis` (`no knob of this sound makes an audible difference on this pattern`). The first try starts at the rung predicted from the sensitivity (D per unit of travel) remembered from earlier rounds, else at 0.35. The request field `schritt` (`fein`, `normal`, `grob`) now names the level of audibility: subtle (target D 1), clear (default, D 2), strong (D 3.5). One round exists per server. Not candidates: a knob with an automation lane or an envelope target on the track, a move with less than half a step of room, the reverse of the move picked last, and what was already offered on the same sound and step size (until nothing else is left).

**Features and effect.** `hell` (power-weighted mean of log2 Hz of the mean spectrum, octaves), `sub` (share of the power below 100 Hz, dB), `hoehen` (share above 4 kHz, dB), `bewegung` (change of the timbre: mean change between neighbouring time columns of the third-octave picture, every column taken relative to its own level, dB; a sound that only fades does not move), `fuelle` (effective length, dB: 0 = sounds throughout at one level, -3 = half of the time), `breite` (side against mid, dB, -40..12), `punch` (crest factor, dB), `pegel` (RMS, dB). The effect of a candidate is its feature difference to A divided by the scale `{hell 0.15, sub 2, hoehen 3, bewegung 2, fuelle 1, breite 3, punch 2, pegel 1.5}`; that vector only gives the direction (cosine) and the word. The `staerke` of a place is the audibility D = `k` x sqrt of the sum of squares of: the loudness-weighted spectral difference of the 30 third-octave bands after level matching to A (each band counts with its specific loudness `10^(alpha x (L - Lmax(A)) / 10)`, `alpha` 0.3, bands more than 60 dB under the loudest band of A do not count; as percent of the loudness of A, unit 6), the changes of effective length (unit 1.5 dB), crest, movement and width (unit twice the scale each) and a weak level term (unit 6 dB). A change in a band where the sound has little energy therefore counts little. Constants `HOER`, `ZIELE` in `sound_runde_contract.ts`. A candidate is a place from D at the target of the level; a candidate that is silent or 20 dB quieter than A is no variant. Accepted are the first three audible candidates on three different knobs whose effect vectors have a cosine below 0.85; the strongest remaining audible ones fill up. Order of measuring: knobs with a known strong effect first, then unknown knobs (different knobs before the other direction of the same knob), known weak ones last; batches of four, widening tries first; at most 24 renders (every try is one), up to 48 while nothing audible was found. The word of a place is its strongest feature (`brighter/darker`, `more sub/less sub`, `more highs/fewer highs`, `more movement/steadier`, `longer/shorter`, `wider/narrower`, `punchier/smoother`); no two places of one round carry the same word: a place takes the strongest feature whose word is free and whose effect is at least 0.5 (scale units) and at least half of the strongest one; when there is none the candidate is not offered and the next takes the place (so a round may show fewer than three places).

**Routes** (POST with the protection of `/proj/analyse`, the GET open; refusals `{fehler, text}`):
- `POST /proj/klang/runde {spur_id, schritt?}` starts a round and answers its state at once (`zustand: 'misst'`, no places yet); measuring continues in the background. Refusals: `kein_projekt`, 404 `spur_unbekannt`, 409 `geraet_falsch` (no Baukasten instrument), 400 `argument_ungueltig`.
- `GET /proj/klang/runde` answers the state `RundeLage = {runde, spur_id, spur_name, graph, rev, zustand: misst|fertig|veraltet|fehler, schritt, von_beat, bis_beat, fortschritt: {gemessen, hoechstens}, aktiv, vergleich: {an, platz, klingt, ab_beat}, plaetze: Platz[], stammbaum, weg: [{id, text, zweige}], zurueck_moeglich, grund?, text?}` with `Platz = {platz: A..D, param, label, wert, von_text, nach_text, wort, staerke, pegel_db, ausgleich_db, merkmale, text}`, or 404 `keine_runde`. `veraltet`: the open project is another one, the track is gone, or its graph or a resolved knob value differs from the round. `fehler` carries the refusal of the render, or `spur_still` when the track is silent in the range. A batch rendered on another revision than A restarts the measuring (twice at most).
- `POST /proj/klang/hoeren {platz, runde?, vergleich?}` switches the playing instrument to a place through the transient knob row and answers the state. The project is not written. Place A writes the value the project has now. Level match: when the track has a numeric fader above -200 dB and no fader, mute or solo lane, the same write also sets the row `spur/<nr>/fader` to the project fader plus `ausgleich_db` (the negated level difference, at most 12 dB either way, under 0.2 dB not matched) so a place plays at the level of A; `pegel_db` stays the true difference, a refused fader row is ignored. A PICK writes only the knob, never a gain; the fader (which the core does not clear at a playback build) goes back to the project value when the round ends or another round starts, so after a PICK the new sound plays for the short time of the project write at the audition level and then the fader returns to the project value. COMPARE: `vergleich: true` with a place B to D alternates, while the transport plays, one bar of A and one bar of that place, switched by the core scheduler on the bar line of the open project (`/k/teil` with `ab_beat`, plan `klang`, one bar scheduled at a time; bar length = the project time signature); the state field `vergleich = {an, platz, klingt, ab_beat}` says which side sounds (`aktiv` = `klingt`). `hoeren` of another place with `vergleich: true` continues with the new place; `hoeren` of A, or without `vergleich`, ends COMPARE. COMPARE also ends with the round, a new round, PICK, BACK, a closed project, transport stop, Stop Cypher (when started by Cypher), the idle end, and 30 s without any request of the round (`GET /proj/klang/runde` renews that dead-man; the window polls every 400 ms while COMPARE is on); ending sends `/k/abbruch` for the plan first and then writes the project values back. PICK and BACK end COMPARE by the abort only and answer after it was sent (`waehlen` and `zurueck` are awaited); no knob or fader row is written between the abort and the project write. Refusals: 404 `keine_runde`, 409 `platz_leer`, `runde_veraltet`, `kein_kernstand`, `regler_abgelehnt`, `vergleich_steht` (COMPARE needs a running transport and a known core clock).
- `POST /proj/klang/waehlen {platz: B..D, runde?}` answers `RundePlan = {weg: 'proj', rev, label, befehle}`: `geraet_param_setzen` for the knob and `stammbaum_setzen` with the new tree. The caller sends `befehle` to `POST /proj/aendern` with that `rev`; it is one undo step and loads the playback once.
- `POST /proj/klang/zurueck {knoten?, runde?}` answers such a plan for the way back: to the node `knoten`, else to the parent of the active node, or to the active node itself when knobs were turned by hand since (that change is recorded as `manual`). 409 `kein_stammbaum` when there is nowhere to go.
- `POST /proj/klang/ende {}` removes the override and drops the round; always `{ok: true}`. A round without a request for 15 minutes ends itself; closing or switching the project drops it without writing.

**Project.** Optional track field `stammbaum: {graph, aktiv, knoten: [{id: 'n<k>', eltern, werte, text}]}` on instrument tracks, at most 200 nodes: the root holds all knob values of the starting point, a child the knobs that differ from its parent. It is not part of the playback view. Command `stammbaum_setzen {spur_id, stammbaum | null}` (general path; refusals `spur_unbekannt`, `geraet_falsch`, `argument_ungueltig`). A tree whose `graph` is not the graph of the track is ignored and replaced by the next pick. Saving and inserting a module keeps the tree.

**Window and tool.** The button FIND SOUND of the workbench top bar opens a floating window of kind `runde`: the level of audibility (subtle, clear, strong), the four places (click or keys 1 to 4 listen, tooltip "played -x dB"), the COMPARE switch (key `c`, shows `A sounding` / `B sounding`; a click on another place keeps COMPARE on, PICK takes the selected place), PICK, NEW NEIGHBOURS, BACK and the path of the tree (a click on a node goes there). It follows the selected track, shows a round started through the hand, sends the active place again after a project event (a playback build clears the override) and ends the round when it closes. The MCP tool `klang_runde {aktion: start|lage|hoeren|waehlen|zurueck|ende, spur_id?, schritt?, platz?, vergleich?, knoten?}` drives the same routes; `start` waits for the end of measuring.

**Measured on the target (2026-11-17).** One Baukasten track over one bar: 0.25 s per candidate; a round on `fm-bass` (4 knobs) 1.9 to 2.2 s, on `drums-909` (39 knobs, the pattern plays the kick) 3.0 to 4.3 s. Listening changed the live master by the measured amount (highs +7 dB live against +6 dB offline) with the project revision unchanged; pick, a second pick, back, a branch, back to the root, undo and redo restored knob and tree together on a test instance. That round was heard on 2026-11-18 (see the rework below).

**Rework after the listening verdict of 2026-11-18** (module `base`, track `fm-bass`, one bar with a 909 kick, studio monitors). Heard: the old normal step (Brightness 1 -> 1.36, Decay 1 -> 0.56, Drive 6 -> 3.84) "can hardly be heard", the old coarse step (Brightness 1 -> 0.3, Decay 1 -> 3.09, Drive 6 -> 10.2) "yes, a little", "fewer highs" twice in one round, one bar per setting wanted. Built: audibility D instead of a raw per-band change, a step that widens until D reaches the target, unique words, COMPARE, level match. Calibration (fixture `tests/fixtures/klang_runde_hoerurteil.json`, recorded on the real module with the real offline render, pattern and knob values of its project.json of 2026-11-18 hard-coded in the script, positive controls pass: highs +5.99 dB, levels -0.99, +1.35, +1.33 dB; `k` 0.34 pinned by the median of the coarse D = 1.0): D of normal Brightness 1.01, Decay 0.61, Drive 0.22; of coarse Brightness 1.97, Decay 1.00, Drive 0.50; subtle 1.2 (above the strongest old normal step 1.01), clear 2.9 (1.47 x the strongest old coarse step 1.97), strong 4.6, a place has D from the target to 1.5 x the target (a step over that is narrowed, aim 1.2 x, so a sensitive knob does not give the same place at every level). Known limit: across knobs the order is not the verdict's (old normal Brightness 1.01 above old coarse Drive 0.50 and equal to old coarse Decay 1.00; no weight of the spectral term fixes it, the owner heard the bass with the kick which masks part of it); per knob it is right, so old coarse Drive is not offered at subtle. Not verified against a real core: scheduled knob rows with `ab_beat`, the fader row, whether `/k/abbruch` from source andreas ends parts of source cypher. Exclusion of the owner: a PICK in the middle of a bar was heard without dropout and is unchanged.

- Tests in `djk/ui`: `sound_runde.test.mjs`, `sound_runde_hoerbar.test.mjs`, `sound_runde_hoerurteil.test.mjs`, `proj_sound_comparison.test.mjs`, `proj_sound_variants.test.mjs`, `project_commands_stammbaum.test.mjs`, `proj_sound_runde.test.mjs`, `proj_sound_runde_route.test.mjs`, `werkbank_sound_runde.test.mjs`; in `djk/hand`: `hand_sound_runde.test.mjs`.

### 20.25 Page API the live studio follows the project time signature (plan studio-taktart, phase 1; state `docs/architecture/stand/studio-taktart.md`)

Page server, generator and page only: no OSC address, no change under `djk/core` and `djk/contract`. With a project of the time signature n/4 open (`taktart: [n, 4]`, n = 2 to 12), the live studio counts bars of n beats; with 4/4 or no project nothing changes. Sources: `djk/ui/project/taktart_live.ts`, `areas/proj/taktart_output.ts`, `server.ts` (`meldeTaktart`, `abVon`, `lage`), `djk/generator/src/taktart_file.mjs`, `public/bar_live.js`.

- **`GET /lage`** carries `taktart: [n, 4]` only when n is not 4 (the key is absent with 4/4 and with no project open, so the 4/4 bytes are unchanged); `uhr.takt` and `uhr.schlag` count bars and beats of n.
- **SSE event `{a: 'taktart', f: {proTakt: n}}`** is sent when the meter of the open project changes, also when it leaves n for 4 (undo, close, open of another project); a 4/4 session sends none. The page also reads `/lage` on every `stand` event, for a page that loads after a change.
- **Meter file `taktart`** in each generator stream folder (streams 1, 2, 3, 5, 6, 7, 9, 10, the folder of `strom1.js`): the beats per bar as an integer text, written with a temporary file and a rename. It exists only while n is not 4: a missing file means 4, and 4/4, no project or a close remove it and never create a folder. A file that cannot be read, holds no integer or a number outside 2 to 12 means the last good value. One folder that cannot be written does not stop the others (log `{typ: 'taktart_datei_fehler', ordner, text}`). A restart of the page server with a remembered project keeps the files until the project is reopened; a stale file with no project is removed at the start.
- **Bar quantisation of the routes** follows n: `ab: 'takt'` of `POST /regler`, `/spur` and the deck routes (the next bar line, `phrase` = 8 bars, `takte` = bars of n, `schlag` unchanged), `anker_takt`, `ab_takt`, `schleife_takte` of `GET /spur`, the tempo ramp of `POST /tempo` and before a transport start (it starts on the bar line; its length stays 4 beats), the scene launch of 20.16. A meter change applies at the next bar line and is never refused.
- **Stays 4:** everything the core counts (metronome accent and count-in, bar quantisation of loop boxes, of the hand deck start and of the arrangement start, the `/takt` event, loop REC lengths, the beat FX values of `contract/osc.json`), the Remix pad pattern and the material-bound places (track bars, loops, warp, Workbench lengths); the page ignores `/takt` while n is not 4. The list and the reasons are in the state document.
- Tests in `djk/ui`: `taktart_server`, `taktart_kernweg`, `taktart_seq`, `taktart_seite`, `taktart_schlaege`, `taktart_live`, `taktart_live_dauer`, `szenen_takt_taktart` and the 4/4 anchors `taktart_4_server`, `taktart_4_seq`, `taktart_4_seite`, `taktart_4_szenen`; in `djk/generator`: `taktart_fenster`, `taktart_fenster_4`, `taktart_datei`, `planer`.

### 20.26 Page API instrument picker by synthesis type: `prinzip` on `GET /graphen` (plan 2026-11-18-instrument-picker-by-type, task 1)

Page server and data only: no OSC address, no change to any graph file, preset value or engine code.

- **`GET /graphen`** instrument entries carry an optional `prinzip`, the synthesis type, next to `kategorie` (the role) and `text`. The ids are `analog`, `wavetable`, `fm`, `physik`, `granular`, `sampler`, `drums`, `feedback` (`PRINZIP_IDS` in `djk/ui/graphs.ts`). Effect graphs never carry it. An entry with no `prinzip` is valid and simply has no such key: a user graph, a generated graph other than the sampler ones, or an older installed `panels/kategorien.json`. The page files such an instrument under Other; it is never dropped.
- **`verborgen`.** An instrument entry of `GET /graphen` carries `verborgen: true` when its entry in `kategorien.json` says so (the five duplicates `synth-greif2`, `juno-pad-dyn`, `juno-pad-echo`, `juno-pad-hall`, `lead`); the instrument rows of `GET /presets/katalog` carry it too. The key is absent when the instrument is not hidden: `false` and an older installed `panels/kategorien.json` without the field both give no key, and a value that is not a boolean is left out of the entry while the entry stays (`pruefeKategorien` reports `<name>: verborgen must be true or false`). Hidden means only that the instrument pickers do not offer it as a new choice (`ohneVerborgene` in `public/instrument_groups.js`); the instrument that is loaded or selected at a place stays listed there. The graph file stays, and `POST /graph`, project load, the MIDI import and the hand tools load it by name without any check. Its sounds stay in the sound list and a sound applies it with `graph_laden`.
- **Source.** `prinzip` is read from `<graph folder>/panels/kategorien.json` (`djk/instruments/modular_dsp/kategorien.json`, one new field per entry, placed after `kategorie`). A value that is not one of the ids is left out of the entry while the entry itself stays; `pruefeKategorien` reports it as `<name>: prinzip must be one of <ids>`. The generated graphs `smp-<id>`, `ton-<cut>-<n>` and `ins-<id>` get `prinzip: "sampler"` from `listeGraphen`, as they get `kategorie: "sampler"`.
- **Check.** `device.ts pruefen` reports `<name>: instrument graph without a prinzip in kategorien.json` for a demo or recipe instrument that has none; `device.ts neu` copies the `prinzip` of its source graph.
- **Assignment.** The 57 instrument demos carry decided values (see the table in `djk/ui/tests/kategorien.test.mjs`). The 46 recipe graphs follow the node types, first match wins: category `drums` is `drums`; an `fm`, `granular` or `sampler` node gives that type; a `saite`, `resonator` or `kamm` source is `physik`; a `wavetable` node is `wavetable`; the rest is `analog` (`recipes/build_rezept_kategorien.py` writes them).
- Tests in `djk/ui`: `kategorien`, `geraete_vollstaendig`.

### 20.27 Page API a sound loads its instrument (plan 2026-11-18-instrument-picker-by-type, task 3; decision D28 in `djk/ui/presets/DECISIONS.md`)

Page server, page and hand only: no OSC address, no change under `djk/core` and `djk/contract`.

- **`POST /presets/anwenden {id, ziel, graph_laden?}`.** `graph_laden` is a boolean; anything but `true` (absent, `false`, a string, a number) behaves as before. The route still only computes the plan and changes nothing.
- **Without the flag** a Baukasten instrument preset on a target that plays another graph is refused 409 `graph_anders` (track or channel) or `kein_graph` (channel without a graph), as before; the refusal answer now also carries `graph`, the name of the preset's graph, so a caller can ask before it repeats the request with the flag. An insert stage never carries `graph` in its refusal: a stage never swaps its graph.
- **With the flag, track target** `{art: 'spur', spur_id}` with a `bk` device of another graph: `{weg: 'proj', befehle: [{befehl: 'spur_aendern', spur_id, geraet: {art: 'intern', name: 'bk', graph: <preset graph>, parameter: <only the preset's knobs>, preset}}], label, uebersprungen, hinweise: ['graph_gewechselt', ...]}`. The old knob values of the track are not carried over. The exchange is one `POST /proj/aendern`, so one undo step restores the old instrument. A track with another internal device (kit, rb338) stays 409 `geraet_passt_nicht`. A graph with latency (`latenz` of `GET /graphen` above 0) is refused 409 `graph_latenz` on a SEQ pattern track (a track whose output is the group of a SEQ deck); `spur_aendern` itself does not check this, the plan repeats the rule of the SEQ instrument picker. Whatever `spur_aendern` refuses stays refused by the model (automation lanes that do not fit, the frozen-track rules).
- **With the flag, channel target** `{art: 'kanal', kanal}` where another graph or none is loaded: `{weg: 'regler', graph: {kanal, name: <preset graph>}, anfragen, uebersprungen}`. `anfragen` are the 64 knobs `<kanal>/bk/<n>` with the start positions of the PRESET's graph for knobs the preset does not carry. The caller sends `POST /graph {kanal, name}` first and the knob requests only after the core accepted the graph (quittung status 2, 3 or 5); a refused graph, a graph without an answer and a failed request send no knob. When the graph is already loaded the plan has no `graph` and equals the plan without the flag.
- **`graph_fehlt` on apply** (404, text `the instrument of this preset is not installed`) when the preset's graph is unknown or is an effect graph; nothing is planned. On `POST /presets` (save) the same code stays 400 and means that a Baukasten preset names no graph.
- **Hand tool `presets_anwenden`** gains the optional boolean `graph_laden`; for a channel it sends the graph before the knobs and answers `graph` with the loaded name; a refused graph answers an error whose `detail` is `{angenommen: [], abgelehnt: 'graph', offen: [...]}`.
- **Page.** The preset panel (DJ view) and the PRODUCTION drop on a track ask once, `"<preset>" is a sound of <graph>. Load <graph> on <target> and apply it?`, and on yes repeat the plan request with `graph_laden: true`.
- Tests in `djk/ui`: `presets_anwenden_graph` (plan and route), `presets_seite`, `produktion_browser`; in `djk/hand`: `hand_presets`.

### 20.28 Page API controller presets and follow (plan 2026-11-18-controller-presets-follow, task S)

Page server only: no OSC address, nothing under `djk/core`. Every route that changes an assignment or a preset, and the focus message, is refused for `x-djk-quelle: cypher` with 403 `nur_andreas`.

- **`POST /geraete/controller {platz, folgen}`.** `folgen` is a boolean, `platz` 1..8, not together with `port`. Place 1 is stored as `midi.folgen`, places 2..8 as `controller[].folgen` in `geraete.json`; `false` removes the key. A place without a device is refused 409 `eingang_leer`. Setting the same device again or renaming it keeps the flag; another device or freeing the place drops it.
- **`GET /controller/fokus`** answers `{fokus, plaetze: [{platz, modell, folgen, preset}]}`. **`POST /controller/fokus {kanal}` or `{spur_id}`** sets the focus. `kanal` is `<channel>/<n>` with a loaded Baukasten graph (else 409 `kein_bk` or `kein_graph`); `spur_id` is a Baukasten track of the open project (else 409 `kein_bk` or `kein_graph`; a slot above 8 is 409 `slot_ohne_zeile`). The base is `<kanal>/bk/` or `spur/<slot>/bk/`.
- **Follow.** On a focus change, and again after a project change, a graph change (core `/e/graph`) or a change of `geraete.json`, each following place with a known model gets its knob entries replaced in ONE write: the instrument preset of that model and graph (user file before factory file) or, without one, a bank (knobs in layout order onto knob 1, 2, 3 of the base). The core table of a place is reloaded once. Places follow in ascending order and a target is taken once (lower places win). Entries the learn flow did not write, and everything that is no `bk` row, stay. Skipped entries carry the reasons `regler_unbekannt`, `ziel_ungueltig`, `doppelt`, `ziel_vergeben`, `quelle_belegt`. Only when the state changed the pages get `{a: 'controller_fokus', f: <GET /controller/fokus answer>}`; the learn event after a replace is `{a: 'lernen', f: {stand: 'ersetzt', platz, plaetze}}`.
- **Presets.** `GET /controller/presets?modell=` lists factory (`werk:<model>/<slug>`) and user (`nutzer:<model>/<slug>`) presets. `POST /controller/presets/speichern {platz, name, art: 'instrument' | 'fest'}` saves the entries of the place that point into the focus base (instrument; refused 400 when empty) or the whole place (fest, needs a name). `POST /controller/presets/laden {id, platz}` answers `{ok, gesetzt, uebersprungen, ...}` where `gesetzt` is the number of entries written; an instrument preset needs a focus (409 `kein_fokus`) and a graph that equals its own (409 `graph_anders`) and replaces only the `bk` entries; a fest preset replaces all learned entries. A model mismatch is 400 `argument_ungueltig`. `POST /controller/presets/loeschen {id}` moves a user file to `.papierkorb`; a factory preset is 409 `werk_preset`, an unknown id 404 `preset_unbekannt`.
- **Files.** User presets: `<controller folder>/presets/<model>/<slug>.json`, slug `[a-z0-9-]{1,48}`. Factory presets: plain files in `djk/ui/areas/controller/werk/<model>/`; the folder may be absent. A damaged learn file is never overwritten (409 `lernen_datei_kaputt`).
- **Limits.** A place 2..8 whose core input is not yet proven keeps its file and is reloaded at the next start of the core. A graph change the core did not report (an optimistic `POST /graph`, a core restart) is picked up with the next focus message.
- **Write-back for project tracks.** A value a controller puts on `spur/<slot>/bk/<k>` (slot 1..8, knob 1..64) reaches the open project as ONE `geraet_param_setzen {spur_id, param: 'k<k>', wert}` per knob after the value has rested 400 ms, with label `Controller`, as Andreas' own change (undoable, source `andreas`). Origin: only a core event `/e/regler` with `halter: 'mensch'` counts (§5.7; only the hand path of the stellwerk sets it). A page write goes out as `/k/teil` with the holder `andreas` or `cypher`, a playback rebuild, a lane and a clip envelope emit no row event, so none of them is ever written back. A repeated value (a touch without a move) and a value equal to the project's value write nothing. A knob driven by a lane or a clip envelope of its track (`geraet.k<k>`) is never written back. The hand holds the row for 32 beats and the core refuses a `/k/teil` on it, so the hold of that row is released first with `/k/hand/frei` (source `andreas`). A refused change is logged as `controller_zurueck_fehler`. Channel rows `<channel>/bk/<k>` are not written back (they belong to no project). Tests: `controller_zurueck`.
- **Keys follow the focus (plan addendum N1).** `GET /controller/fokus` also carries `tasten: {an, ziel, grund?}`: `an` is the session switch (default `true`, on again after every start of the page server), `ziel` is `{spur_id}` (a project track), `{kanal}` (a live channel) or `null`, `grund` says why there is none: `kein_fokus`, `kein_instrument` (audio track or unknown id), `keine_senke` (instrument track the core has no note sink for: a host track without a slot), `kein_ziel` (a live channel without a stream), `kern_alt` (the core cannot play keys on live channels yet). **`POST /controller/fokus/tasten {an}`** (boolean, else 400 `argument_ungueltig`; 403 `nur_andreas` for Cypher) switches it and answers `{ok, fokus, plaetze, tasten}`; the pages get `controller_fokus` when `tasten` changed. A project track with a sink (internal device `bk`, `kit`, `rb338`, a rack, a host track with slot 1..2; mirrors `senke_fuer` in `core/src/arr_notes.cpp`) is the target: the arm reconciler of the recording area (`areas/proj/recording.ts`) treats it as MIDI-armed for the core in addition to the arms of the project (`/k/rec/spur`, `eingang` 30, monitor auto), so the keys of all `midi_ein` places play it. This is session state of the page server: no project revision, no undo step, nothing in the project file. A track the owner armed himself stays armed and gets nothing extra; when the focus moves, the old focus arm is taken back (the core closes held keys itself). A recording start takes the focus arm back first and the take lists the owner's arms only; during a run the focus moves nothing, and the arm of the track in front goes out after the run. A focus on a live channel takes the focus arm back; the live-key target of a later core command is sent through one function (`areas/controller/tasten_live.ts`) that is a no-op reporting `kern_alt` until that command is confirmed.
- Tests in `djk/ui`: `controller_presets`, `controller_folgen`, `controller_zurueck`, `lernen_ersetzen`, `geraete_folgen`, `proj_aufnahme_tasten`, `register_folgen`.
