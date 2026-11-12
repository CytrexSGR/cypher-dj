# Cypher-DJ: Interfaces (contract between the building blocks)


### 20.12 Page API plugins: effects as host stages, instruments as plugin devices (package 1.11, ADR 035)

Playback side: §4.11 (`chain` stage `art: "host"`, field `latenz`), §4.11 `/k/arr/ins_host`, `/k/arr/ins_mess`, `/k/arr/export_lauf`, §5.13 `/e/ins_host`, `/e/ins_mess`, `/e/export_lauf`, `/zustand/ins_host`, §8 ports `arr_ins_<h>_L/R` and `arr_insret_<h>_L/R`. Sources: `djk/ui/plugins/{index,hostverwaltung,zustand,instrumentwirte}.ts`, `areas/plugins/area.ts`, `projekt/{modell,befehle,wiedergabe,bounce}.ts`, `areas/proj/output.ts`, `http/reasons.ts`; MCP tool `plugins`. A project without a host stage or a plugin device writes the same bytes as before.

- **Project fields.** `Insert.art` may be `host` with `plugin: {format: 'vst3' | 'lv2', pfad, uid, name}`, `zustand: 'plugins/<insert-id>.carxs'` (set at creation) and optional `latenz_extra` (samples, 0 to 4096). Plugin identity is `{format, pfad, uid}`; for LV2 `pfad` is the URI and `uid` is empty; on a command line `<format>:<pfad>#<uid>`. A track device may be `{art: 'wirt', name: 'plugin', plugin, zustand}` (`WirtGeraet.name` is `surge` or `plugin`); it takes one of the two host slots, shared with Surge (`slot_belegt` when both are taken).
- **Commands in `proj_aendern`.** `insert_setzen {strang_id, art: 'host', plugin_id | plugin: {format, pfad, uid}, pos? (alias `stufe`)}` (the existing command with a new kind; `plugin_id` resolves the index: `plugin_unbekannt` 404, `plugin_blockiert`, `kein_effekt`), `insert_an` and `insert_entfernen` (unchanged), `insert_latenz_extra {insert_id, samples}` (one undo step; the same value again is no history entry and no reload). `spur_neu {art: 'instrument', geraet: {art: 'wirt', name: 'plugin', plugin_id}}` makes a plugin instrument track (`kein_instrument` for anything but an index entry with `art` `instrument`). The fifth active host stage is `host_grenze`, nothing half applied.
- **Routes (not commands: no undo step, no project write).** `GET /plugins?text=&art=&format=` answers `{plugins, scan}` (the index entries `{id, format, pfad, uid, name, hersteller, art, audio_ein, audio_aus, parameter, status, grund?}`; `scan` is the scan state). `GET /plugins/scan` answers the scan state `{laeuft, seit, ende, ergebnis, fehler}`, also pushed as the SSE event `{a: 'plugins', f: {scan}}`. `POST /plugins/rescan` and `POST /plugins/entsperren {id}` are `nur_andreas`; a second rescan while one runs is `scan_laeuft` (409). `GET /proj/insert/<insert_id>/parameter` answers the host's parameter list joined with the current values (`index`, `name`, `min`, `max`, `vorgabe`, `einheit`, `wert` 0..1). `POST /proj/insert/<insert_id>/param {werte: {<index>: 0..1}}` sets parameters on the host socket (`param_unbekannt` rejects the whole batch, `wert_ungueltig` for NaN, `host_fehlt` while the host is not ready; blocked for the source `cypher` under Stop Cypher as `ki_gestoppt`). `POST /proj/insert/<insert_id>/fenster {an}` opens or closes the plugin's own window (`nur_andreas`; `kein_fenster`, `keine_anzeige` from the host). The instrument track has the same three routes under `/proj/spur/<id>/geraet/parameter`, `/param` and `/fenster`.
- **State of the hosts.** `GET /proj/aktuell` carries `hosts: [{insert_id, h, status, latenz, gemessen, grund?, fenster, anzeige}]` while the project has a host stage (`status` is `startet`, `bereit`, `fehlt` or `ausfall`; `latenz` in samples; `gemessen` false while the stage runs on the estimate of 2 x quantum) and `instrumente` for plugin tracks. `proj_lage` shows the same. A stage with a status other than `bereit` is written to the playback with `an: false` and the last known `latenz`, so the strip plays dry and aligned.
- **Host lifecycle.** The server numbers the project's host stages 1 to 4, starts the host (`djk-insert`), then per host: `/k/arr/ins_host h 1`, `/k/arr/ins_mess h` on the still empty rack (up to 6 attempts at 250 ms while the core's edge check has not yet seen the host), `lade`, `zustand_setzen`, `/k/arr/ins_host h 1`; the playback is reloaded when `latenz` changed. It polls the host every 200 ms and sends `ins_host h 0` when the heartbeat is older than 200 ms or the unit is gone. The flags and the measurement are sent with the source `leitstand`. Three failed starts within 60 s are `ausfall` / `absturz_schleife` (host stopped); a failed state restore is `ausfall` / `zustand_fehler` (the file stays, a `.bak` copy is kept at every write); a latency of 8192 samples or more is `ausfall` / `latenz_zu_gross` (the stage is left out of the playback). The way out of all three is the user switching the stage off and on, or reopening the project. A strip change of a host stage is a removal in one load and an entry in a later load (§4.11 rule for the server).
- **Export.** `POST /proj/export` with an active host stage takes the real-time path: `zustandSichern('export')`, every host must be `bereit` (else `host_fehlt` naming the strip), the export view of the project is played through `/k/arr/export_lauf`, then the live view is restored; `ungesund > 0` deletes the file (`export_host_ausfall`), `luecken > 0` deletes it (`export_luecke`). The answer gains `echtzeit: true` and `dauer_s`; while it runs `GET /proj/aktuell` shows `ausgabe_lauf` with `echtzeit: true`. A project whose host stages are all bypassed exports offline as before. `POST /proj/bounce` of a track with an active host stage is `host_insert_echtzeit` (use resample).
- **New reasons** (page API only, `http/reasons.ts`): `host_grenze`, `host_fehlt`, `plugin_nicht_ladbar`, `zustand_passt_nicht`, `param_unbekannt`, `plugin_unbekannt`, `plugin_blockiert`, `kein_effekt`, `kein_instrument`, `absturz_schleife`, `zustand_fehler`, `latenz_zu_gross`, `scan_laeuft`, `kein_fenster`, `keine_anzeige`, `host_insert_echtzeit`, `export_host_ausfall`, `export_luecke`. `host_fehlt` also exists on the core side (§4.11 and §16.2); `host_insert_echtzeit` is also the render error of §4.11 (the offline render's refusal); the page API uses the same word for the refused bounce.
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
| `id` (command) | int64, strictly increasing per sender | every sender; counter starts at process start = `mono_ns` (so it keeps rising across restarts) |
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
| `pm/fader` | dB | −200 to +6 | 0 | 10 ms | all |
| `spur/<n>/send/<r>` (r = 1 to 4) | dB | −200 to +6 | −200 | 10 ms | all |
| `grp/<n>/send/<r>` (r = 1 to 4) | dB | −200 to +6 | −200 | 10 ms | all |
| `ret/<r>/fader` (r = 1 to 4) | dB | −200 to +6 | 0 | 10 ms | all |
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

`grp/<n>/*` (1.10, ADR 033, n = 1 to 8) and `pm/fader`: group controls and fader of the production master in the Arrangement module, global (channel −1). A group track
takes up the tracks whose target it is in playback (§4.11, `ausgang`), sums them after their fader and pan, and feeds the sum with its own fader, pan, mute and solo
into the production master; the PM fader acts on the sum of all targets `master` before it goes into the input of `erz/4`. Mute of a group zeroes all members; solo on a
track keeps its group sounding, solo on a group keeps all its members sounding (all other tracks and groups are then silent). Value ranges as for `spur/<n>/*`, but the pan of a group is a balance (center 0 dB, toward the side the other side gets quieter until silent), so that grouping does not change the level.
The check I3 (listening check) exempts them. The controls sit at the end of the table (index 564 to 596); the restart state saves by path and stays valid.

`spur|grp/<n>/send/<r>` and `ret/<r>/*` (1.10 Slice 3, n as above, r = 1 to 4, 204 controls): sends and return strips of the Arrangement module, global (channel −1).
A send is taken post fader, post pan and post mute/solo fade of its track or group; a track inside a group also follows the fade of that group (a muted group
silences the sends of its members), the group fader and balance do not act on the sends of the members. A send of −200 dB is off. The return strip sums the sends,
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
| | `spur_pool` | str | `"an"` | Track phases on the Hall pool: whether the track sources of the arrangement (phase Q, the lane-capable tracks) compute on the pool workers inside the audio block, with the serial summation in the fixed order, so the output is bit-equal in every mode. `"an"` (default, live and production alike): on, as soon as every pool worker runs SCHED_FIFO; `"aus"`: the callback computes every track itself; `"auto"`: as `"an"`, but when the track phases switch themselves off the kern switches them on once more after 4096 blocks, provided every worker is free again; a second switch-off is for good. A stalled track job or repeated late events switch the track phases off for good, the Halls keep running. Needs `hall_faeden` > 0: without a pool the mode is `aus` and the kern says so at start. Any other text is a start error that names the three values. The state is in `/zustand/spur_pool` |
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
| | `bestand`, `sets` | path | `~/cypher-dj/bestand`, `~/cypher-dj/sets/djk` | §13, §15 |
| | `rechner_socket` | path | `$XDG_RUNTIME_DIR/cypherdj/rechner.sock` | §11 |
| | `zug_vorlauf_takte`, `antwort_frist_takte` | int | 12, 4 | §3, ADR 013 (lead time since 2026-09-26 twelve bars: fallback after M15) |
| | `nachrender_ruhe_takte` | int | 16 | ADR 020 |
| | `grenzen_tief_verriegeln` | bool | false | §11: warning only; M20 (2026-09-25): rule §14.4 breaches the deep limit, safe 9/12, hard 11/12, therefore false |
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
| `/k/mapping` | `,hss` | `id`, `quelle`, `geraet` | core rereads the controller mapping (non-real-time thread); `geraet` `lernen` loads the learn table (slot 1, applies only to `midi_ein_1`, §7.2) |
| `/k/lernen` | `,hsi` | `id`, `quelle`, `an` (1 arm, 0 disarm) | MIDI learn: the next CC on midi_ein_1 is reported as /e/gelernt and not applied; 20 s, then disarmed silently; only Andreas' hand (cypher: nur_hand) |
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

**Baukasten graphs and sample files (S10).** A `bk:<name>` stream loads `<bk_ordner>/<name>.json` in the net thread. A graph may contain `sampler` nodes (`"datei": "<name>.f32"`); their files are read from the **sample root `<bk_ordner>/samples/`** at the same moment (`cypher_bk_neu_wurzel`), never in the audio callback. File format: raw 48 kHz stereo float32, interleaved; name `[A-Za-z0-9_.-]`, 5 to 64 characters, ends in `.f32`, no `..`; at most 1 440 000 frames per file and 64 MiB of sample data per graph; a missing or invalid sample refuses the stream with acknowledgement 6 `pruefung` (reason on stderr). A sampler graph has no `eingang`, so as `/k/kanal/graph` insert it is refused with `kein_eingang`: it plays as an instrument stream on an erz channel. Worst case sample memory: 16 streams x 2 handles (graph switch) x 64 MiB. Since S21 `faltung` nodes read their impulse response (`"datei"`) from the same root with the same rules; an IR longer than the node's `laenge_max` (1 to 2000 ms) refuses the stream or insert with `pruefung`. `faltung` adds no latency, so it is allowed as `/k/kanal/graph` insert.

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
| `/k/fx/zuweisung` | `,hsisi` | `id`, `quelle`, `einheit` (1, 2), `kanal` (`deck/1`, `deck/2`, `erz/1`, `erz/2`, `erz/3`, `pad/1`, `pad/2`, `master`), `an` (0/1, assigned) | attaches `kanal` to the instance of the unit or detaches it (after the channel strip; main path after the fader; PFL dry; for `master` before `master/pegel` on the sum); several channels may hang on the same unit; a channel with both assignments runs FX1 before FX2 (serial, as on the Traktor Kontrol S8, §4.3.1: "first run through FX1, then FX2"); assigning off lets the instance run out (input closed, reverb tail rings out); assigning on lets the input glide back in |
| `/k/fx/routing` | `,hsi` | `id`, `quelle`, `routing` (0 post fader, 1 insert; otherwise receipt 6 `ausserhalb_bereich`) | switches both units and all channel strips where the beat FX sits: post fader (default, after the fader; PFL and Cypher's ear do not hear it) or insert (before the fader; PFL and the envelope ring hear it, as with Traktor FX unit routing); takes effect at the start of the next block; the switch glides wet to 0 over 480 samples, swaps the path, clears and glides back (the echo tail breaks off); source `cypher` gets receipt 6 `nur_hand` (the key belongs to Andreas' hand); master FX stays untouched; the core does not keep the request across a restart (the page server sends it again); receipts 1/2/3 |
| `/k/kanal/graph` | `,hsss` | `id`, `quelle`, `kanal` (`deck/1`..`deck/4`, or `fx/3`, `fx/4` for the send returns, S6), `name` (graph `<name>.json` in the graph folder, empty = remove) | sets a building-block effect graph (node `eingang`, latency 0) as an insert into the channel strip: before the fader, after the compressor, before the beat FX insert; PFL, envelope ring and sends hear it, pre-listening (`nur_cue`) does not. Each change fades linearly over 10 ms (480 samples) from the old path to the new one. The graph computes at the tempo of the core clock (`lfo`/`delay` with `takt`). Rejection: receipt 6 `ausserhalb_bereich` (channel, name), `pruefung` (file missing, format, latency > 0), `kein_eingang` (graph without `eingang`). Any valid source; in the AI stop `cypher` gets receipt 6 `ki_gestoppt`; takes effect at the start of the next block; the core does not keep the graph across a restart; receipts 1/2/3. On `fx/3` / `fx/4` the graph is not an insert but the effect of the send bus (§1.5); other `fx/<n>` are rejected `ausserhalb_bereich` |
| `/k/graph/frage` | `,hs` | `id`, `quelle` | asks which graph sits on each graph-capable slot (`graph_platz`, §5.12). Answered in the network thread, not through the ring: one `/e/graph` per slot in list order (empty slots with `""`), then quittung 1 and 3 for this id; all to all subscribers. Any valid source; an unknown source gets quittung 6 `ausserhalb_bereich` and no `/e/graph` |

`param` acts per type: echo and flanger feedback 0 to 0,9, phaser resonance 0 to 0,9, filter LFO quality 0.7 to 8.
Receipt 1, 2, 3 at the start of the block; error `/q` status 6 `ausserhalb_bereich`. Source `cypher` itself rejects
`djk-fx` while the AUTO switch of the page is off (as with `djk-muster`).

### 4.11 Arrangement (D1, ADR 030)

| Address | Types | Fields | Effect |
|---|---|---|---|
| `/k/arr/laden` | `,hsi` | `id`, `quelle`, `nr` (≥ 0, playback number of the instance, D1 6.1) | the arrangement loader thread reads `<arr_ordner>/wiedergabe-<nr>.json` (§2.1; no path in the OSC message; the key `nr` in the file must match, otherwise `format`; every clip `datei` is an absolute path below `arr_ordner`, both compared normalized, otherwise `format`: `audio/<sha256>.f32` and the freeze files `freeze-<spur>-<kennung>.f32` in the working folder itself, D1 6.14; clip values per D1 6.27: `gain_db` −96 to +24, `ein_beats` and `aus_beats` ≥ 0 and together at most `laenge_beats` + 1e-9, otherwise `format`; NaN or Inf anywhere in the audio: `format`, the whole file is checked), loads the audio (locked, shared by sha256) and swaps the snapshot at the start of a block; receipts 1 and 3. Status 6: `datei_fehlt`, `format`, `audio_fehlt`, `zu_gross`, `spur_bereich`, `warp_maschine_fehlt`, `ki_gestoppt` (source `cypher` at the stop key); status 4 `zu_spaet` if the job ring or the result ring of the loader thread is full (every id ends exactly once) |
| `/k/arr/start` | `,hsdi` | `id`, `quelle`, `start_beat` (≥ 0), `quant` (0 immediately, 1 beat, 2 bar) | entry at the earliest at the first quant point from now + lead time (2n, the host round trip) + one cycle; the bar holds (core beat − `start_beat`) ≡ 0 mod 4; a running transport ends at once with a short fade; receipt 1, receipt 2 at the entry sample. If a waiting start ends without an entry, it gets 7: `abbruch` (new start, `/k/arr/stopp`), `hand` (`arr/start_stopp`), `ki_stopp` (AI stop, a waiting start by `cypher`; a running transport has not been ended since E-a); every id ends exactly once. Status 6: `nicht_geladen`, `ki_gestoppt`, `ausserhalb_bereich` |
| `/k/arr/stopp` | `,hsi` | `id`, `quelle`, `quant` (0 immediately, 1 next project beat, 2 next project bar) | short fade (96 samples), open notes off, host slots All-Notes-Off; if the seam lies before the quant point, at the seam; receipt 1, receipt 3 at the stop sample; a second `/k/arr/stopp` before the stop sample replaces the first, which then ends with 7 `abbruch` (every id ends exactly once); also allowed by `cypher` during the AI stop (D1 6.27) |
| `/k/arr/loop` | `,hsidd` | `id`, `quelle`, `an` (0/1), `von_beat` (≥ 0), `bis_beat` (at least `von_beat` + 1) | loop bracket: when the project beat reaches `bis_beat`, `von_beat` applies again sample-exactly (the last 96 samples before it fade out); takes effect from the next note window not yet sent; if the head is at or beyond `bis_beat` when it is set, the transport runs linearly (the bracket only takes effect once `bis_beat` is reached from below, D1 2.2); receipt 1 and 3. Status 6: `ki_gestoppt` (source `cypher` at the stop key, D1 6.27), `ausserhalb_bereich` |
| `/k/arr/metronom` | `,hsifi` | `id`, `quelle`, `an` (0/1), `pegel_db` (−60 to 0), `ziel` (0 master before the limiter, 1 cue) | click on whole project beats, accented at p mod 4 = 0 (full level, otherwise half); locked in test mode, always off in the render; receipt 1 and 3. Status 6: `ki_gestoppt` (source `cypher` at the stop key, D1 6.27), `ausserhalb_bereich` |
| `/k/arr/freeze` | `,hsiddi` | `id`, `quelle`, `spur` (1 to 32), `von_beat`, `bis_beat`, `kennung` | real-time run following the start rule from `von_beat` (the core chooses quant as for the hand target type: 2 if a deck, a loop box or a generator stream is running, otherwise 0); loop bracket suspended; the track signal before the fader goes into the file `<arr_ordner>/freeze-<spur>-<kennung>.f32` (raw f32 stereo, 48 kHz) from the entry for `bis_beat` − `von_beat` + 2 beats, then stops. Buffer and file belong to the arrangement loader thread, not to the network thread (D1 spec 6.29). The server assigns the kennung uniquely per instance (playback counter, D1 spec 6.25); an existing file is never replaced (`/e/freeze` 2). `/q` 1, 2 at the entry, 3 at the end of the tail run, 7 with `abbruch` (stop, start, load, hand key, `/k/tempo/rampe` from whatever source, D1 spec 6.33, `/k/set/neu` at sample 0 of the new time axis) or `ki_stopp` (Cypher's freeze); 6 with `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `ausserhalb_bereich` (track 1 to 32, `bis_beat` − `von_beat` 1 to 256, `kennung` ≥ 0), `datei_fehlt` (no working folder), `nicht_geladen`, `ueberlappung` (transport or freeze is running), `spur_bereich` (track empty), `tempo_rampe` (a ramp is open in the tempo plan, D1 spec 6.33), `zu_gross` (buffer cannot be allocated). A core restart ends every freeze without `/e/freeze`. Package K3 |
| `/k/arr/abgriff` | `,hsiiiddi` | `id`, `quelle`, `art` (0 track, 1 group, 2 return, 3 production master), `nr` (track 1 to 32, group 1 to 8, return 1 to 4, master 1), `punkt` (0 pre, 1 post), `von_beat`, `bis_beat`, `kennung` | Real-time tap of any strip, the sibling of `/k/arr/freeze` (the freeze is untouched): the same run (start rule of `/k/arr/start`, `quelle` and `id` mean what they mean there, loop bracket suspended, quant chosen by the kern), but the file holds the signal at ONE point of ONE strip: `pre` is the strip input in front of its chain (track: the instrument/clip signal, group: the sum of its members, return: the Hall blend, master: the sum in front of the master chain), `post` is what the strip sends on to its target (after chain, fader, pan/balance, mute/solo fade and for a track the monitor of an armed input; the master: the signal after the master fader, the export tap). The window is shifted by the path latency of the tapped point (`arr_schluessel_quelle_ankunft`, the master post `pdc.gesamt`, the master pre `pdc.p_in`) so the file starts on `von_beat` exactly like the export. Length `bis_beat` - `von_beat` exactly, no tail (the run ends `ankunft` samples after the range end). File `<arr_ordner>/abgriff-<art>-<nr>-<kennung>.f32` (raw float32 stereo, L/R interleaved, 48 kHz), written by the Arrangement load thread, never replacing an existing file (`/e/abgriff` 2). `/q` 1, 2 at the onset, 3 at the end of the run, 7 with `abbruch` (stop, start, load, hand key, `/k/tempo/rampe`, `/k/set/neu`) or `ki_stopp` (cypher's tap while waiting); 6 with `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `ausserhalb_bereich` (art 0 to 3, `nr` out of the kind's range, `punkt` 0 or 1, `bis_beat` - `von_beat` 1 to 256 else `zu_gross` above 256, `kennung` >= 0), `datei_fehlt` (no work folder), `nicht_geladen`, `ueberlappung` (transport, freeze or tap runs), `spur_bereich` (no such strip in the playback: empty track, group without member, return not present), `tempo_rampe`, `zu_gross` (range over 256 beats, buffer not allocatable). A kern restart ends every tap without `/e/abgriff`. Slice 7 (1.10) |
| `/k/arr/ins_host` | `,hsii` | `id`, `quelle`, `h` (1 to 4), `gesund` (0 or 1) | the server's health flag of effect host `h` (plan 1.11 T5, D7), the second of the two sources of the stage's health; the server sets it from the host's heartbeat file (a hung main loop clears it). The stage plays the return only while this flag AND the core's own edge check (every 500 ms: the host's JACK client and ports are there and its four edges hold) say 1; the default after core start is 0, so a host nobody has declared healthy plays the delayed dry path. Whatever happens to the health, the strip never goes silent and never jumps in time: the stage crosses to the delayed dry signal in 480 samples (D6), and the return fades back in only after 48000 samples (1 s) of continuous health. There is no stall rule in the stage: a plugin that returns exact zeros (a closed gate) stays on the return path, only the flag switches. The command is applied at once and answered by `/e/ins_host`. The server sends it with its own source `leitstand`, never `cypher`: like every `/k/arr/*` command it is refused for `cypher` in the AI stop (§4.7). `/q` 6: `ki_gestoppt` (`cypher` in the AI stop, before any range check), `ausserhalb_bereich` (`quelle` unknown, `h` outside 1 to 4, `gesund` outside 0 or 1). Plan 1.11 T5 |
| `/k/arr/ins_mess` | `,hsi` | `id`, `quelle`, `h` (1 to 4) | measures the round trip of effect host `h` (plan 1.11 T5, D17 variant B: the server orders it while the host's rack is still EMPTY, before the plugin is loaded; the empty rack's round trip is exactly 2 x quantum, 512 samples at quantum 256). Only while the transport is stopped and the host is healthy. The core sends ONE impulse of 0.5 on `arr_ins_<h>_L`, counts the samples until the return (`arr_insret_<h>_L` or `_R`) exceeds 0.05 in magnitude and gives up after 16384 samples; the measurement is a small state machine in the callback, the host's stage plays the delayed dry path meanwhile. The answer is `/e/ins_mess` (the number, or a named reason); one measurement per host at a time (a second start is `laeuft`). `/q` 6: `ki_gestoppt` and `ausserhalb_bereich` (as `/k/arr/ins_host`). Plan 1.11 T5 |
| `/k/arr/export_lauf` | `,hssdd` | `id`, `quelle`, `pfad` (absolute, ends in `.f32`), `von_beat`, `bis_beat` (at least 1 and at most 3600 beats, `zu_gross` above; the core checks the 3600 s at the project tempo exactly) | real-time export of the production master (plan 1.11 T12, D10: a project with an active effect-host stage cannot be rendered offline). One transport run from `von_beat` by the start rule with the loop bracket suspended (the run pattern of `/k/arr/freeze`, the freeze and the tap are untouched); the core copies the PM post point (after chain and PM fader, without metronome) shifted by the path latency exactly as `/k/arr/abgriff` art 3 punkt 1 does, so the file starts on `von_beat`, and streams it through a ring to a writer thread of its own that writes `pfad` (float32 L/R interleaved, never replaced). Receipts as the freeze: 1 accepted, 2 at the onset, 3 at the end, 7 on abort, 6 on refusal (`belegt` while a recording, a freeze, a tap or another export runs; `ki_gestoppt`, `tempo_rampe`, `nicht_geladen`, `zu_gross`). One run answers `/e/export_lauf` |
| `/k/arr/auto` | `,hsisi` | `id`, `quelle`, `spur` (0 to 32), `ziel` (`fader`, `pan`, `mute`, `solo`), `an` (0 or 1) | the lane override of one track field (1.12 slice 3, ADR 032 point 8). `an 0`: the hand plays instead of the lane from now on (the core first sets the Stellwerk value to the last lane value, so a click without movement keeps the lane value and the next `/k/teil` ramps from there); `an 1`: the lane plays again (re-enable, blended back); `spur 0` with `an 1` re-enables every overridden field of every track (`ziel` is checked, then ignored). The state lives in the core only and survives stop, start and a swap that keeps the lane; deleting the lane clears it. Without a lane for the field, or when the state does not change, the command is acknowledged and nothing happens. While the transport does not play, `an 0` is acknowledged and nothing changes (no override starts); `an 1` still clears the state. `/q` 1 and 3; 6, checked in this order: `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `format` (`spur` outside 0 to 32 or `an` outside 0 or 1), `auto_ziel_unbekannt` (`ziel` is none of the four), `format` (`spur 0` with `an 0`), `nur_andreas` (`an 0` from `cypher`: overriding is Andreas' hand work, cypher may only re-enable). Reports: `/e/auto` (§5.13). Automation slice 3 |
| `/k/arr/arm` | `,hsiii` | `id`, `quelle`, `spur` (0 to 32), `an` (0 or 1), `modus` (0 touch, 1 latch, 2 write) | arms one track for automation recording (1.12 slice 3, D11), one arm per track, separate from the audio arm `/k/rec/spur`. `spur 0` is allowed only with `an 0` and disarms every track. The mode is kept with the arm; the core reports grips the same way in every mode, the server writes the take. The arm lives in the server session and in the core (D11): the core uses it for the points, the server for the take. A new core generation starts unarmed and the server clears its copy when it sees the new generation; a swap of the playback keeps it. Only the source `andreas` may arm or disarm. `/q` 1 and 3; 6, checked in this order: `ki_gestoppt` (cypher in the AI stop, before any range check, §4.7), `format` (`spur` outside 0 to 32, `an` outside 0 or 1, `modus` outside 0 to 2, `spur 0` with `an 1`), `nur_andreas` (any source but `andreas`). Reports: `/e/auto_punkt` (§5.13). Automation slice 3 |

The arrangement module plays one playback (format `cypherdj-arr/1` or `/2`, D1 spec 3.2, ADR 033, ADR 031) on the one
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

**Playback `cypherdj-arr/2` (1.10, ADR 033; warp: package 1.13, ADR 031).** The loader accepts format `cypherdj-arr/1` or
`cypherdj-arr/2`. Only in `/2` are there `spuren[].ausgang`, the list `gruppen` and `clips[].warp` (above); the core
rejects each of these fields in a `/1` file with `format`. An entry of `gruppen` has `nr` (1 to 8, each number at most
once; a duplicate number is `format`) and `ausgang`; the `ausgang` of a group has the `art` `master` and no other (groups
do not nest, depth 1; a group inside a group is `format`).
The `ausgang` of a track has the `art` `master` (also the default when the field is missing) or the `art` `gruppe` with
`nr`; this `nr` must appear in `gruppen`; any other `art` is `format`.
**Baukasten instrument tracks in the playback (S20).** An `intern` track may carry `"geraet": "bk"` (instead of `"rb338"`) with `"graph": "<name>"` (1 to 32 characters of `[a-z0-9_-]`) and `"parameter": {"k1": v, …, "k8": v}` (0 to 1; absent knob = 0.5; any other key is `format`). The graph is the Baukasten file `<name>.json` in the graph folder, `$HOME/.config/cypherdj/baukasten` for the live kern (the kern has no override) and `--bk-ordner <dir>` of `cypherdj-render` (default: `$CYPHERDJ_BK_ORDNER`, else the same home folder). The loader builds the graph in the loader thread, never in the callback; a missing or invalid graph refuses the whole playback with `format`, more than 8 bk tracks with `zu_gross`, `graph` on a `rb338` track is `format`. Tracks with the same graph name share nothing: one instance per track slot; an unchanged track (same slot, graph, file content hash) keeps its running instance across a playback swap. Playing: the notes of the track go to the instance as note-on/off with sample offsets; the knobs k1 to k8 are set every block (no 20 ms ramp at take-over and at the transport start, so live and render begin on the same values); the instance is reset at every transport start (same rule as the RB-338) and runs on the kern clock (`takt` with beat and beats per sample, so `lfo`/`delay` follow the tempo map). A device change on a slot (rb338, bk, another graph, empty) fades the old instance out over one block and resets it. The track rests after 1 s of exact silence while the transport stands. The offline render (`proj_export`, `proj_lautheit`, `proj_zusammenfuehren`) plays bk tracks through the same sink; live against render is `bestanden` in `cypherdj-nulltest` (stand `stand/baukasten-s20.md`). A bk track is not a Surge track: `/k/arr/freeze` on it is refused by the page (`keine_wirtspur`). No new OSC address and no new reason.

**Returns in the playback (1.10 Slice 3).** An optional `returns` list in `cypherdj-arr/2`: entries `{nr, ausgang}`, `nr` 1 to 4 at most once, `ausgang` has the `art` `master` and no other (returns do not feed returns or groups); a list in a `/1` file, a duplicate `nr` or another `art` is `format`. The core needs only which returns exist; the sends and the return strips are controls (§1.5), not data. The page server writes `/2` also when the project has a return and then always writes `returns`. A project without a return gives the same file as before.

**Insert chains in the playback (1.10 slice 4a).** In `cypherdj-arr/2` a track, a group or a return may carry `chain`, a list of at most 4 stages in signal order, each with the fields `art`, `slot` and `an`: `art` is `komp`, `eq`, `saett`, `lim`, `utility`, `bk` or `host` (slice 4b adds `eq` and `saett`, the master limiter plan of 2026-11-06 adds `lim`, plan 1.11 adds `host`, arr-fx adds `utility`, arr-bk adds `bk`; any other is `format`), `slot` is the project's pool slot of that kind (the control rows `ins/<art>/<slot>/*`, §1.5: 1 to 12 for `komp`, 1 to the pool size of the kind for `eq` and `saett`; a slot may stand on one strip only, a second use or a slot outside the pool of its kind is `format`; the three kinds number their slots independently, so `komp` slot 1, `eq` slot 1 and `saett` slot 1 are three different stages), `an` is the structural flag. The chain of the production master is the top-level key `pm`, an object that holds `chain` (not `master`; the loader ignores unknown top-level keys without a message, so a misspelt key is a stage that never sounds). A return may carry `"pre": true`: its sends then tap the sending strip's chain output times the mute/solo fade, before fader and pan (default: after). `chain`, `pre` and `pm` in a `/1` file, a chain longer than 4 or a non-object `pm` are `format`. A stage of `art` `bk` (arr-bk slice 3) carries the field `graph`, the name of an effect graph in the graph folder (`[a-z0-9_-]`, 1 to 32 characters; `graph` on another kind, a missing `graph`, an unknown graph, a graph without an input node, an instrument graph or a graph whose latency is above 128 samples is `format`, the message names the stage and the graph); a `latenz` field on it is `format` (the loader measures it); the loader and the offline render (`bk_ordner`) build the instance, the same file with the same content is shared between playbacks. A stage of `art` `host` (plan 1.11 T4) carries one more field, `latenz`, the latency of the stage in samples (integer, 0 to 65535, default 0; `latenz` on another kind is `format`): the loader puts it into the stage (`ArrStufe::latenz`) and the delay compensation counts it like the latency of a native stage, so the latency of a host stage is structure and a changed value is a new playback load. A host stage needs the effect-host ports of the core; a core without them (JACK refused the registration) refuses the playback with the named reason `host_fehlt` (reason `format`; the token `host_fehlt` is somewhere inside the message, not at its start, so a consumer searches for it as a substring, as for `ungueltig` and `pdc_zu_lang`). The offline render (`cypherdj-render`) loads a host stage (it has no host to play it) and refuses a stage with `an` true with the render error `host_insert_echtzeit` (exit 5, the strip is named in the message: a project with an active host stage is exported in real time, `/k/arr/export_lauf`, §4.11); a stage with `an` false renders on the dry path, aligned. `slot` is 1 to 4 and is the host number h (pool instance `ins/host/<h>`; the loader's own index is h - 1, the file stays 1-based like the other kinds); a slot outside it or used twice is `format` (the message says `ungueltig` for the first). A `latenz` of 8192 samples or more is `zu_gross` with `pdc_zu_lang`. One host process serves one strip at a time, so a host slot never changes strip inside one load. Rule for the server (plan 1.11 T7, the consumer): express a strip change of a host slot as a removal in one load (the old strip's stage leaves with its exit tail of `latenz` plus 480 samples) and an entry in a later load, at least `latenz + 480` samples after the first. A load that gives a slot that is still active or in its tail to another strip is treated by the core as a removal only: the new strip's stage stays out (the strip plays its undelayed input) until a later load claims the slot again after the tail has ended. A stage that enters holds the undelayed input of its strip for `latenz` samples and then crosses over to its output in 480 samples; a stage that leaves crosses back in 480 samples; live material is never cut. A stage runs when its flag `an` AND its row `ins/<art>/<slot>/an` are on. An `eq` or `saett` stage delays its strip by its latency (69 samples at 48 kHz), a `lim` stage by 74 samples; the delay compensation (slice 4b T13) lines the other strips up. It is computed once per snapshot in the loader (`arr_pdc_rechnen`) for the worst case, with no knowledge of the sends: all tracks are aligned to the track with the longest chain, a group chain adds on top, the groups are aligned to the longest group, the track part of every return waits for the groups, and the master sum waits for the longest of tracks, groups and returns. A stage counts with its latency whether it is bypassed or not (the bypass blend, a stage that is off and a stage in its tail all pass the same delay), so no switch moves the timing. A project without a latency stage has no delay and sounds bit for bit as before. The whole project is late by the longest path (`Arrangement::pdc_latenz()`): the metronome is shifted by it, the render skips it, a recorded take is NOT corrected (it sits that many samples early against what the performer heard). A table that would need a delay of 8192 samples or more on one place (1024 before plan 1.11), or a path of 32768 samples or more, is refused as `zu_gross`. The page writes the flag always true (structure only): the bypass of a stage is the row (`ins/<art>/<slot>/an`), because `insert_an` sends only the row and starts no new playback; a flag written false could not be switched on again until the next structure change. The page server writes `/2` also when a strip has a chain or a return has `pre`. **Structural sidechain key (slice 5 U1, U2a).** A `komp` stage in `chain` may carry `key`, an object `{"q": "spur" | "grp" | "ret" | "pm", "nr": ..., "punkt": "pre" | "post"}` (`nr`: track 1 to 32, group 1 to 8, return 1 to 4; for `pm` it means nothing): the detector then takes its key from that source instead of the row `ins/komp/<n>/sc`, which stays the track-input key of slice 4a (project field `sc`; the pair track and `pre` has exactly one writer, the row, so `{"q": "spur", "punkt": "pre"}` is `format`). `post` of a track is its output after fader, pan and mute/solo fade (the signal it sends on with a post send); `pre` of a group is the sum of its members before any group chain (copied before the first group chain runs), `post` of a group is after its fader, balance and mute/solo fade; `pre` of a return is its input after the Hall blend and in front of its chain, `post` after its fader, mute/solo fade and presence fade. A stage with `key` ignores its `sc` row. **Which stage may take its key from which source is data:** `docs/interfaces/schluessel_regeln.json` (generated into `schluessel_regeln.inc` and `project/key_table.ts` by `djk/contract/generate_key.py`, ctest `schluessel_regeln_aktuell`); the loader refuses every cell that is not `ja` with `format` and names the reason in the message: `sidechain_spaet` (the source is computed after the consumer: tracks first, then group chains, group faders, returns, PM; a track cannot be keyed by a group or a return, a group not by a group `post` or a return, a return not by a return), `sidechain_zyklus` (a strip keyed by its own output, a member track keyed by its own group, a cycle of tracks keying each other, and the PM as a source: every strip feeds the PM) and `sidechain_quelle` (a source that is not there in the block). The DJ inputs are keys too (slice 5 U2b): `{"q": "deck", "nr": 1 to 4}` and `{"q": "erz", "nr": 1}` are the signal the DJ side hands to the arrangement in that block (the mixer inputs `eingang(0..3)` for the decks, `eingang(4)` for erz/1: the Strudel stream of erz/1 without the host return that is added after the arrangement block); `punkt` may be left out, `pre` and `post` mean the same. `erz/4` is the arrangement's own output (`sidechain_zyklus`); `erz/2`, `erz/3`, `erz/5` to `erz/8` and `pad/1`, `pad/2` are not in the block (`sidechain_quelle`); the table is the same data file. A DJ key is live only: an export or loudness render has no deck and no Strudel stream, the inputs are silent, so a stage with a DJ key does not reduce in the export (it is bit for bit the project without the key). **Key alignment (slice 5 U2b).** The loader computes, from the delay compensation table, when each key arrives against the input of the stage it keys: the row key and the DJ keys arrive at 0, a track post at the track alignment, a group pre at the track alignment, a group post at the group alignment, a return pre at the return input, a return post after its chain; the input of a stage arrives after the strip's base delay plus the latencies of the stages in front of it in its chain (bypassed ones count, like in the delay compensation). A key that is EARLIER than the stage input is delayed by the difference in a ring of the stage (`ArrStufe.schl_verz`, `schl_verz_zeile` for the row key; at most 8191 samples, the same bound as the compensation ring (1023 before plan 1.11); a structural key that needs more is refused `format` with the reason `key_verzoegerung_zu_lang`), so the reduction starts when the audio it belongs to reaches the stage. A key that is LATER (a post key of a track while another track is aligned to a longer path) is used as it is and the lag is reported (`schl_spaet`, samples, in the snapshot and as a reading of the stage; the page shows it from U3 on); it is never advanced. Other values of `q` are `format`; a `key` on an `eq`, `saett` or `lim` stage, a `nr` outside its range and a `punkt` other than `pre`/`post` are `format`. A key naming a group without members, a return that is not in the playback or a track that is not there is not an error: it is a silent key. The loader computes the order the tracks run in (`spur_ordnung`, `arr_schluessel_rechnen` in `arr_key.h`): a stable topological order over the track-post edges, the identity when there is none, so the key of track B is there in the same block when a track with a higher or lower number is keyed by it and a project without such keys sums in the same order as before. A group, return or PM stage keyed by a track post needs no edge (every track has run before them). A key source whose capture does not run in a block (a group without members, a return that does not compute) gives a silent key: `schluessel_planen` zeroes the key buffer of every keyed stage at the start of the block, a capture point overwrites it. A project without inserts gives the same file as before.
The page server writes `/2` only if the project has groups, a track does not point to master, or an audio clip carries a
warp that is on (package 1.13; then `gruppen` is always present, even if empty); otherwise `/1` byte-for-byte as before
1.10. The mixer computes tracks, then groups, then the production master (PM: sum of all targets `master`, fader
`pm/fader`, §1.5), and passes its output into the input of `erz/4`; a target change of a sounding track fades linearly
over 480 samples; a project without groups computes bit-identically to before 1.10. The PM output is copied in every
block into a buffer of the core (export tap, `cypherdj-render --abgriff produktion`, before `erz/4`, glue compressor,
`master/pegel` and set limiter); it is not an OSC command; the real-time tap of a strip is the command `/k/arr/abgriff` (§4.11, slice 7).
With neutral setting, `erz/4` is neutral only in magnitude (the isolator acts as an allpass): the PM tap and the ring
master differ in phase, so a null test computes the reference through the same isolator (ADR 033, decision 4).

**Automation lanes in the playback (Automation Slice 1, ADR 032).** In `cypherdj-arr/2` a track may carry `auto`, a list of lanes `{ziel, punkte}`. `ziel` is one of eight project strings (automation slice 2): `fader` (dB, -200 to +6), `pan` (-1 to 1), `mute` and `solo` (only 0 or 1, and every point has `form` 2), `geraet.lautstaerke`, `geraet.cutoff`, `geraet.resonanz`, `geraet.env_mod` (0 to 1, only on a track of `art` `intern` with `geraet` `rb338`, a `bk` track refuses them; `geraet.wellenform`, `geraet.decay` and `geraet.accent` are not targets). One lane per `ziel` and track, a second one is `format`, so at most 8 per track. The core keeps the target as `ArrAutoLane::ziel` (`ARR_AUTO_FADER` 0, `_PAN` 1, `_MUTE` 2, `_SOLO` 3, `_GERAET` 4) and, for a device lane, the parameter index as `param` (`lautstaerke`, `cutoff`, `resonanz`, `env_mod` = 0..3); the reader derives both and the range from one table. The server writes formcode 2 for every mute and solo point. `punkte` is a non-empty list of triples `[beat, wert, form]`: `beat` is a project beat (finite, not negative, not falling along the list; at most two points at one beat, they make a jump), `wert` the value in the unit of the target, `form` the code of the segment INTO the point: 0 `linear`, 1 `s` (3u^2 - 2u^3), 2 `sprung` (the left value holds up to the beat of the point). Limits: 8192 points per lane and 65536 per playback, over that `zu_gross`. `auto` in a `/1` file, a wrong type, an unknown `ziel`, a value outside the range of its target, a mute or solo point that is not a jump of 0 or 1, a device lane on a track that is not an RB-338 track (audio, host or bk) or a broken triple is `format`, and a failed load keeps the previous snapshot. The server writes `auto` only for a track that has a lane and then writes `/2` (a project without a lane gives the same file byte for byte as before). The core evaluates the lane per sample in the arrangement module (`auto_block`): the project beat of every sample comes exactly from the tempo map; before the first point its value holds, after the last point the last one; the form of the right point decides; a ramp from or to a value of -120 dB or lower runs towards -60 dB (like the interlocking). While a lane exists and the transport runs the lane value is the fader of the track; at stop, without a lane and after the lane is deleted the base value of the track (`fader_db`) holds, and a change between the two blends 480 samples linearly in the gain (not at a start and not at the loop seam). To keep the cost inside the frame the gain is recomputed from the lane value every 16 samples (a drift above 0.03 dB, a jump or a start takes the exact value at once); live and render use the same function. A lane uses no controller of §1.5. The playback format stays `cypherdj-arr/2`. Version skew: a slice 1 core refuses a file with a target other than `fader` as `format` and keeps the previous snapshot. The core plays the `fader`, `pan`, `mute` and `solo` lanes (found by target, not by position), each into its own per-sample buffer. A `geraet` lane drives the internal RB-338 per block: the core hands the sink ONE value per lane and block, the lane at the project beat of the last RUNNING sample of the block (`ArrSenke::auto_parameter`, before the `block()` of that block; no call in a block without a running transport, and none for a track without that lane; the host sink ignores it). `ArrRbSenke` sets it with `cypher_rb_setze` under the parameter name (index 0..3 = `lautstaerke`, `cutoff`, `resonanz`, `env_mod`) after the defaults, the playback's base values and the reset of a start, and only when it differs from the value applied before. When the lane falls away (deleted, a swap without it, stop) the sink sets the base value once: the playback's value of that parameter, else the RB default (0.71034, 0.62565, 0.3, 0.4). The FFI glides 20 ms behind the lane, so on a ramp the sound lags it; measured on the audio, not corrected: a cutoff step 0.2 -> 0.8 is within 5 % of its final sound between 543 and 799 samples after the jump (block resolution), and the value can take effect up to one block (255 samples) before the jump sample, because it is taken at the block's last running sample. A `pan` lane is held like the fader (16 samples, a drift above 0.002 pan, a jump or a start takes the exact value at once) and blends back 480 samples linearly in the pan value; a `mute` or `solo` edge goes through the 480-sample mixer fade.

**Clip envelopes and relative lanes in the playback (Automation Slice 5, package 1.12; `cypherdj-arr/2` only).** Two optional fields, both absent in a project without clip envelopes (the playback file is then byte for byte the one of slice 3). (1) `gain_hk` on an audio clip entry (one entry per loop copy): a non-empty list of triples `[beat, wert, form]` with the checks of a lane (`beat` is the beat inside this copy, finite, not negative, not falling, at most two points at one beat; `form` 0 to 2; `wert` in dB from -200 to 0, else `format`). The core multiplies the gain of every voice of the clip (plain, RE-PITCH, BEATS, and the COMPLEX and TONES voices of the warp werk) by the linear factor of the envelope at the clip beat of each sample, on top of `gain_db` and the fades; a ramp from or to -200 dB runs towards -60 dB like the fader lane. The factor is held for 16 samples like a fader lane (drift above 0.03 dB or a jump takes the exact value at once). A swap of the snapshot that changes only the table glides from the factor in force over the 96-sample seam blend (2 ms). `gain_hk` in a `/1` file is `format`. (2) `relativ: true` on a lane entry of `auto`: a SUMMAND lane. Allowed for `fader` (-60 to +6 dB), `pan` (-2 to 2) and the four `geraet.*` targets (-1 to 1, RB-338 tracks only); not for `mute` and `solo` (`format`). One absolute and one relative lane per target and track at most (a second relative one is `format`, "relative twice on one track"). The field then plays the VALUE STACK: base value (the value of the track) or the absolute lane, plus the relative lane, clamped to the range of the target (fader -200 to +6 dB, pan -1 to 1, device 0 to 1); the step hold, the look-ahead and the 480-sample blend work on that sum. While the hand overrides the field, the whole stack yields to the hand; a field that has a relative lane only has no override (nothing absolute to take over): the hand moves the base value and the stack follows it. A device parameter with a relative lane only has no base value in the core: the sink adds the summand to its own playback value (`ArrSenke::auto_parameter_summand`). The server writes `gain_hk` from the `gain` envelopes of a clip (per loop copy; linked envelopes repeat with the clip loop, unlinked ones modulo their own `loop_beats`, with a jump pair at every seam) and merges the `spur_fader`, `spur_pan` and `geraet.*` envelopes of a track's clips into ONE relative lane per target (0 outside the clip spans, a jump pair at every clip edge). A `transpose` envelope is not a playback field: the server resolves it into the note list (`ton + round(envelope at the note start)`, clamped 0 to 127), so the core sees plain notes and the note-off hits the pitch the note-on had. The core stays on `cypherdj-arr/2`; a core from before this slice skips an unknown clip key (the gain envelope is silent) and plays a lone relative lane as an absolute one, so a project with clip envelopes needs a core of this version.

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

1.10 slice 4a (2026-11-04, additive): `kanal` (`ins/komp/<n>`, n = 1 to 12, the pool slot of the stage) and `gr_db` (gain reduction of the stage at the end of the last block, >= 0). Sent with the
levels (`/pegel`) at 20 Hz for every stage that computed in the last block (flag and row `an` on, a chain loaded); a stage that is bypassed, removed or not reached stops sending, the page shows "-" 500 ms
after the last message. The page server passes it on throttled to 100 ms per `kanal`, keeps the last reading per stage for `/lage` (`ins_gr {"ins/komp/<n>": dB}`, only readings younger than 500 ms) and the
page shows it on the stage in the INSERTS block. Not recorded in the leitstand journal (up to 12 x 20 = 240 lines per second). The simulated core (`attrappe_kern`) does not send it.

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
- `/e/gelernt ,hiiiii`: `id` (the `/k/lernen` that armed the capture), `quelle` (0 `hand_in`, 1 `midi_ein_1`), `kanal` (1..16),
  `nr` (0..127), `wert` (0..127), `belegt` (1 when the base mapping, slot 0, already uses this CC). MIDI learn (S19): sent once
  per arming, for the first 3-byte CC after `/k/lernen` with `an` 1. A CC from `midi_ein_1` is consumed (it does not move
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
| `/e/fx/zuweisung` | `,isi` | `einheit` (1, 2), `kanal`, `an` (assigned) | on every change of the assignment |
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
| `/zustand/spur_pool` | `,iiiiiiiii` | `an` (1 the track phases can fork onto the Hall pool, 0 off: `spur_pool` `aus`, no pool, workers that do not run SCHED_FIFO because the process has no real-time rights, or the track account switched itself off for good), `modus` (0 `aus`, 1 `an`, 2 `auto`; 0 without a pool), `blocks_parallel` (phases in which at least one worker job was started, i.e. not taken back), `einheiten_worker` (track units computed on pool workers), `einheiten_caller` (track units the callback computed in phases that went to the pool), `seriell_summe` (phases that stayed on the callback, any reason including a cycle already late at the start of the phase, counted per block that has tracks, also without a pool), `haengt` (track jobs still running at the hard wait limit), `spaet` (late events of the track account), `zurueck` (track jobs taken back because no worker had started them; normal, not late); all counters since kern start. The four counters `blocks_parallel`, `einheiten_worker`, `einheiten_caller`, `seriell_summe` go out as the low 31 bits (they wrap to 0 after 2147483647; a consumer takes differences); `haengt`, `spaet`, `zurueck` saturate at 2147483647 like the Hall pool | on every change of `an`, `modus`, `haengt`, `spaet` and otherwise every 24 000 samples (2 Hz; `zurueck` and the four running counters change every block and ride along with the beat only); without a pool `an`, `modus` and the pool-side counters are 0, `seriell_summe` still counts the serial phases of the tracks; the page shows it in `/lage.spur_pool {an: bool, modus: 'aus'|'an'|'auto', blocks_parallel, einheiten_worker, einheiten_caller, seriell, haengt, spaet, zurueck}` (`seriell` is `seriell_summe`; absent until the first message came; the latest message wins, nothing is derived from the config); new address (track phases) |

### 5.14 Inputs and recording (I08, 1.8)

| Address | Types | Fields | when |
|---|---|---|---|
| `/zustand/ein` | `,ihhhh` | `verbunden` (bit mask: bit k-1 = ein_k_L and ein_k_R connected, k 1..4; bit 8 = midi_ein_1), `midi_gesehen` (count), `midi_verloren` (count), `midi_sample` (core sample of the last MIDI event, −1 for none), `flanke_sample` (core sample of the last pulse edge on ein_1, measuring MIDI against audio, −1 for none) | in step with the levels, at most every 2 400 samples (20 Hz), without its own change trigger; the page server throttles to 250 ms |
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

S19: `cypherdj-kern:midi_ein_1` (raw generic MIDI input, wired by the device management) is translated by the learn table
`lernen.json` when one exists (§7.2); without one it stays raw (§5.14 counters only).

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
- `quant` for deck keys: `sofort` (phase-true), `beat`, `takt` (bar).
- `kurve.typ`: `linear` (unit linear between `min` and `max`), `fader_db` (fader curve: 0 to 1 → dB, below
  −60 dB silent).
- Default for controller EQ (A27 path a): curve `linear` from −26 to +6 dB with `kill_unter_min` = true (kill below
  the minimum), as in the example above.

**Learn table (S19).** `controller/lernen.json` is a normal Mapping-v1 file with the reserved device name `lernen` (slot 1). It
translates only `midi_ein_1` (`hand_in` keeps the base mapping alone); its `quelle_port` is ignored. The page server writes
entries without `kurve` (the default curve of the control, `art` `absolut`), one entry per line, and reloads the table with
`/k/mapping` (`geraet` `lernen`). The kern loads the file at start if it exists; a broken file is logged with its line and the
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
  every fallback-path and gap message. The first lines: `{"typ":"set_start","daten":{"set_id","generation","vertrag":1,
  "konfiguration":{...}}}`.
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
| `datei_fehlt`, `format`, `audio_fehlt`, `zu_gross`, `spur_bereich` | core | `/k/arr/laden` (§4.11): playback file missing, violates the format, an audio is missing, budget or limit (32 tracks, 4096 clips, 65 536 notes) exceeded, track number or slot out of range |
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
    Likewise pad channels `pad/*` (Andreas 2026-10-05: "you should be able to control all these faders yourself"): the core opens them without a listening pass; whether the box content is Cypher's own recording is checked by the page (409 `kein_hoerschein`, `server.ts` `eigenePad`). Deck channels stay locked.
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
- `fertig` carries `spuren` (the ids of the placed stem tracks, four to six), `rev` and `rest_db`; `hinweis: "stems_ohne_gruppe"` when no group was free.
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
- Refusals (409 unless noted): `merge_leer` (nothing sounds in the range or the render is silent), `merge_gruppen` (the tracks feed different groups or targets), `merge_teil_solo`
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

- **Project field.** A clip may carry `huellkurven`, a list with at most one entry per target: `{ziel, verknuepft?: false, loop_beats?, punkte: [{beat, wert, form?}]}`. `ziel`: `gain` (audio clips, dB -200 to 0), `transpose` (MIDI clips, semitones -48 to 48), `spur_fader` (dB -60 to 6), `spur_pan` (-2 to 2), `geraet.lautstaerke | cutoff | resonanz | env_mod` (-1 to 1, MIDI clips on RB-338 tracks only). `beat` is a CLIP beat from the clip start (`offset_s` and `versatz_beats` do not move it). Linked (`verknuepft` absent): the points of `[0, clip loop)` repeat with every loop copy; unlinked (`verknuepft: false`): they repeat modulo `loop_beats` (1/16 to the clip length; absent = no repetition) from the clip start over the whole clip. `verknuepft: true` and an empty list are never stored. The key is absent without envelopes (an old project file reads and writes unchanged). The points count with the lane points against the 65536 of a playback.
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
- **Member macro targets.** `rack_setzen` (slice 4c: a strip rack = 4 macros, at most 16 targets) takes a second target kind next to the stage kind `insert, param, von, bis`: target fields `glied, param, von, bis`, `glied` = a member id of the instrument rack of the SAME track (a strip that is not a rack track answers `glied_ohne_rack`). Allowed parameters: RB-338 `lautstaerke`, `cutoff`, `resonanz`, `env_mod` (von/bis 0 to 1), bk `k1` to `k8` (0 to 1), `gain_db` of any internal member (-60 to +12 dB). A Surge member takes none (`makro_ziel_wirt`). One parameter has at most one macro (`ziel_doppelt`); while mapped its own value is ignored by the core (for a stage of the chain the project also refuses to set it, `param_gemappt`; for a member it does not, the member's value stays stored and is used again when the mapping goes). The translator writes the target as `makro, glied, param, von, bis` with `glied` = the member's position 0 to 3 in the rack device and `param` in the core's member index space (RB-338 0 to 3 in the order of the `geraet.*` rows, bk 8 to 15, `gain_db` 16; pinned by `tests/project_rb_mapping.test.mjs` and the core test `test_arr_naht_seite`). A frozen rack track goes out without member targets. Removing or replacing a member, or converting the track away from a rack, removes the targets that no longer fit (undo restores them). Removing the last mapping of the strip removes the strip rack together with its variations (undo restores).
- **Start value.** At a transport start a mapped member sounds on its mapped value from the first sample (macro 0 gives `von`, 1 gives `bis`); there is no glide from the member's own value. A plain RB-338 track with a device lane starts on the lane value the same way.
- **Variations.** `rack.variationen`: at most 8 (`MAX_VARIATIONEN`) named snapshots (`name`, `werte` = four values 0 to 1) of the macro values of a strip rack, name 1 to 32 characters; the key is absent when empty. Commands (one undo step each, project data only, no playback structure): `makro_variation_speichern {strang_id, name}` stores the current four values (an existing name is replaced in place; a ninth distinct name is `variation_voll`), `makro_variation_laden {strang_id, name}` sets the four values (a control change like `rack_makro`; `variation_unbekannt`, 404, for an unknown name), `makro_variation_loeschen {strang_id, name}` removes one. A strip without a rack answers `rack_unbekannt`.
- **New reasons.** `keine_rackspur`, `rack_voll_glieder`, `rack_letztes_glied`, `glied_ohne_rack`, `makro_ziel_wirt`, `variation_voll` (409), `glied_unbekannt`, `variation_unbekannt` (404). A freeze, bounce, merge or export of a track with a Surge member needs the host of its slot like a plain Surge track: `wirt_fehlt` (409, the text names `djk-instrumente --arr<n>`), `wirt_fehler`, `wirt_spiegel_fehler`. Texts: `http/reasons.ts`, page `public/production/output.js`.
- **Page.** `+ RACK` adds a rack track, the track head menu entry `MAKE RACK` turns the device of a track into member `g1`; the rack panel edits the members (zones on the key, velocity and chain axes, gain, chain value, add and remove), the macro panel offers member targets and a variation row. The Surge and kit buttons count members. Details: `docs/architecture/stand/produktion-instrumente.md`.
- **MCP.** The three rack commands, the three variation commands and `rack_makro` go through `proj_aendern`; no tool was added, the tool count is unchanged (`djk/hand/AUFRUF.md`).

### 20.11 Page API routing slices 6 and 7: the matrix and resampling (package 1.10)

No new playback field and no new OSC address beyond §4.11 `/k/arr/abgriff` and §5.13 `/e/abgriff`. Sources: `djk/ui/project/routing_matrix.ts` (pure), `areas/proj/area.ts`, `areas/proj/output.ts` (`resample`), `project/resample.ts`, `http/reasons.ts`; MCP tools `proj_routing` and `proj_resample`.

- **`GET /proj/routing`, optional query `optionen=<insert_id>`,** answers the fields `slug`, `rev`, `ziele` (list of `wert` and `name`), `returns` (list of `id`, `nr`, `name`, `pre`) and `straenge`; without an open project only `slug: null`. One strip per track, group, return and the production master, each with `art` (`spur`, `gruppe`, `return`, `pm`), `id`, `nr`, `name`, `ausgang`,
  `ziel_zellen` (per cell `ziel`, `aktiv`, `erlaubt`, and `grund` and `text` when refused), `sends` (list of `return_id` and `db`) and `stufen` (per insert stage `insert_id`, `art`, `slot`, `an`, `schluessel`: null or `quelle`, `nr`, `punkt`; `optionen` only for the asked stage). A cell is `erlaubt: false` with the reason the command would answer
  (`routing_grenze`, `routing_zyklus`, `ziel_unbekannt`; for a key `sidechain_spaet`, `sidechain_zyklus`, `sidechain_quelle`). `optionen` lists every key source of one compressor stage with its own `erlaubt` and reason. An empty `optionen=`, an unknown stage ID or the ID of a stage that is not a compressor is 400 `argument_ungueltig`.
- **`POST /proj/resample` with `strang_id`, optional `punkt`, `von_beat`, `bis_beat`,** plays one strip once in real time through the core tap and makes a new audio track from the file in ONE project change (one undo step "Resample <name>"). `strang_id` is the project's strip id (`s<n>`, `g<n>`, `r<n>`, `master`);
  `punkt` is `post` (default) or `pre`; the range is `von_beat` to `bis_beat` or, absent, the loop bracket if on, else the song, at most 256 beats. The answer carries `rev`, `spur_id`, `clip_id`, `datei`, `frames`, `quelle`, `punkt`, `von_beat`, `bis_beat`; the WAV is `<project folder>/resample/resample-<id>.wav` and stays after undo.
  The new track is "<source> (resampled)" (at most 80 characters) with output master and one clip at `von_beat` with `gain_db` +3.0103 dB (pan-law compensation of the new track), below the source track or at the end for a group, return and master; the source is untouched.
- **Refusals.** New reasons: `resample_leer` (409, the result is silent: muted or empty strip or a Surge host that is not playing; no track, both files removed) and `resample_fehler` (the core failed; nothing saved). Already existing: `argument_ungueltig`, `spur_unbekannt`, `zu_gross`, `export_bereich`, `merge_keine_spur_frei`, `ki_gestoppt`,
  `kein_projekt`, `beschaeftigt` (also while a recording runs), `transport_laeuft`, `kein_kernstand`, `wirt_fehlt`, `wirt_fehler`, `wirt_spiegel_fehler`, `veraltet` (tempo or strip changed during the run). While it runs `GET /proj/aktuell` shows `ausgabe_lauf` with `art: "resample"` and the `strang_id`.
- **`GET /proj/lage`** carries `kern.limiter_db` (gain reduction of the set limiter in dB, 0 idle, negative while it reduces; absent until the core has reported) and `kern.status` 3 while a freeze or resample tap runs; every other field is unchanged.
- **Commands.** `ziel_setzen`, `insert_setzen` and `insert_param_setzen` (`param` `sc` or `key`) refuse an own track as `pre` key with `sidechain_zyklus` (400). `proj_lautheit` carries the lists `gruppen` and `returns` (same shape as the track entries, with `gruppe_id` or `return_id` instead of `spur_id`); its per-track entries keep the keys of the measured path alive.

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
| 2026-11-10 | 1 | MIDI import: §20.14 page API `POST /proj/midi_import` (Standard MIDI files, formats 0 and 1, into one instrument track with one clip per MIDI track and channel, one history step), MCP tool `proj_midi_import`; new page reasons `smf_kein_smf`, `smf_format2`, `smf_smpte`, `smf_beschaedigt`, `smf_leer`, `midi_keine_noten`, `midi_schluessel_unbekannt`, `midi_zu_viele_spuren`, `midi_zu_lang`, `midi_datei_zu_gross`, `midi_datei_fehlt`. No OSC change, version stays 1. |
| 2026-11-11 | 1 | Strudel clip: §20.15 page API command `clip_aus_muster` (one Strudel pattern becomes one MIDI clip with clip envelopes, the pattern stored on the clip as `muster`, hand work protected by `abdruck` and `ueberschreiben`), the `muster` reports in the answer of `/proj/aendern`, MCP tool `proj_muster`; new page reasons `muster_fehler`, `klang_unbekannt`, `muster_ziel_passt_nicht`, `muster_zeitlimit`, `muster_zu_gross`, `muster_nicht_verfuegbar`, `muster_fehlt`, `handarbeit_vorhanden`. No OSC change, version stays 1. |
| 2026-11-11 | 1 | 32-knob widening: §1.5 `<k>/bk/<n>` and `fx/<n>/bk/<m>` run to 32 (336 new rows at the table end, 2228 to 2563), `ins/bk/<n>/k9` to `k32` (192 new rows, the stage rows of stage 2 to 8 move up: stage s starts at 1964 + 33 (s - 1)); the table has 2564 of 4096 rows. Additive paths, no new OSC address, version stays 1. Saved projects: a channel snapshot with 8 numbers and a track device or insert stage with only k1..k8 load unchanged (missing knobs 0.5) |
| 2026-11-11 | 1 | 64-knob widening: §1.5 `<k>/bk/<n>` and `fx/<n>/bk/<m>` run to 64, `ins/bk/<n>/k33` to `k64` (256 new rows, stage s starts at 1964 + 65 (s - 1)); the table has 3268 of 4096 rows (`<k>/bk/9` to `<k>/bk/64` and `fx/<n>/bk/<m>` at 2484 to 3267). New FFI function `cypher_bk_regler_vorgabe` (start position of a knob, paragraph "Baukasten FFI" in §4). Additive paths, no new OSC address, version stays 1. Saved projects with 8 or 32 knobs load unchanged (missing knobs: the graph's `vorgabe`, else 0.5) |
