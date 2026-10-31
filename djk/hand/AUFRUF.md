# djk-hand: Cypher's hand for djk (MCP, stdio)

Plan `docs/superpowers/plans/2026-09-28-djk-hand-mcp.md` (Rev. 2 after review), status `docs/architektur/stand/hand-mcp.md`.

    claude mcp add --scope user djk-hand -- node /path/to/cypher-dj/djk/hand/hand.ts --seite http://127.0.0.1:47300

Test instance i: `--seite http://127.0.0.1:56300`. The 56 are counted in the code (`grep -c "^  { name: '" djk/hand/hand.ts` = 56; 51 before I08 Task 10, plus `geraete_lage`, with 1.8 Task 28 `proj_aufnahme`, with package 1.13 `proj_warp` and with slice 6 `proj_stems`, `proj_stems_abbrechen`) and against the MCP response `tools/list` from `node hand.ts` (also 56); of these, 16 are `proj_*`. Every call goes as HTTP to the page server with the header
`x-djk-quelle: cypher`; the server sets the source `cypher` in every core command, and Cypher's commands carry `plan: cypher`.

## Tools (56)

DJ: `lage` · `bestand` · `laden` · `deck_start` · `deck_stopp` · `sprung` · `loop` · `pad` · `loop_nach_box` · `box` ·
`regler` (ramp over bars; project mixer paths `spur/1..32/*`, `grp/1..8/*`, `pm/fader` are rejected by the server with `ueber_projekt`) · `fx` · `fx_zuweisung` · `abbrechen` · `tempo` (decks follow since 2026-10-06: varispeed, then a swap to a version at the new tempo, ADR 028) · `warte` · `hoeren`. In addition, the studio tools
below and the media library (`bibliothek` · `vorbereiten` · `sets` · `set_zeige` · `set_lege` · `set_vorbereiten`) as well as `instrumente`. `instrumente {melodie: "fluegel"}` puts a sampled grand piano (Ableton Core Library,
4 velocity layers, Carla SFZ) on MELODY instead of Surge, `"surge"` switches back (2026-10-06).

Searching the library: `stoebern` pages through the whole media library by type (`track`, `loop`, `oneshot`, `strudel`) with
text search, field filters, Camelot neighbours, BPM and energy filters, sorting and pages (read only). `anschluss` names,
for the running deck (or for a `material_id`), the matching library tracks, ranked by tempo, genre,
Camelot move and energy class, with `punkte`, `zug` and `gruende` per hit (read only).

Sounds (plan `docs/superpowers/plans/2026-10-06-klaenge.md`): `klaenge` searches all sounds except tracks (one-shots, loops,
impulse responses, recordings, generated material, voices) in the media library and the own loop library; each hit carries `einsatz`:
`sofort` (plays now, own loops via `box`), `werkstatt` (open file, needs kit build or loading) or `nur_live`
(encrypted Ableton pack sample, never load). `bestand_karte` counts the inventory per type and deployment level, the largest
packs and the loop library. Sound wanted: first `klaenge`, then build.

Studio (plan `docs/superpowers/plans/2026-09-29-djk-hand-mcp-studio.md`, 2026-09-30):

| Tool | Route | Lock for cypher |
|---|---|---|
| `strudel` | `POST /strudel` | AUTO of the stream, Stop Cypher |
| `studio` | `GET /strudel?strom=1..3` | read only; `status.taub` = Strudel fields that do not sound here (see "Taube Felder") |
| `stille` | 3× `POST /strudel` `silence` | like `strudel`, reports partial errors per stream |
| `pegel` | `GET /pegel?sek=1..10` (undamped buffer before the SSE throttle; channels also `spur/1..32`: peak and median after the track fader, no loudness; `grp/1..8` per group with members, `pm` = production master after its fader, before the set limiter) | read only |
| `klang` | `POST /klang` (spawns `djk/wirte/carla/djk-klang`; `fahre` goes directly to the host `Wirt` with track `klang-<gruppe>`) | AUTO stream 2 (bass) / 3 (melodie), Stop Cypher, `fremdePost`; `zeige`/`liste` free; values with a leading `-` return 400 |
| `loops` | `GET /loops` | read only |
| `rec` | `POST /loop {aktion:rec}`, waits for the core receipt | core: running tempo ramp (`ausserhalb_bereich`), Stop Cypher, overlap; every fixed tempo is allowed (plan Tempo-Folge) |
| `loop_klang` | `POST /loop {aktion:kit}` | AUTO stream 1, Stop Cypher |
| `spur` · `spur_stopp` · `spuren` | `POST /spur {spur:{name,fahrten},ab}` · `POST /spur/stopp` · `GET /spur` | as automation tracks below; targets `spur/1..32/*`, `grp/1..8/*` and `pm/fader` are rejected by the server with 409 `ueber_projekt` (only via `proj_aendern`) |

`/lage` additionally carries `studio: {stroeme:[{strom, autonom, von, text_kurz}], klang:{bass, melodie}}`
(`klang` = name from `wirt-<g>.json`; after `setze` "edited"). `abbrechen` and Stop Cypher also hold `klang fahre`.

## Production (D1, spec 3.4 and 3.5)

The project belongs to the page server (`~/cypherdj-projekte/<slug>/`, undo history `undo.jsonl`); the core plays a playback
from it. I change it only with command lists, never with files.

| Tool | Route | Lock for cypher |
|---|---|---|
| `proj_liste` · `proj_lage` · `proj_verlauf` | `GET /proj/liste` · `GET /proj/aktuell?noten=zahl` (notes only as `noten_zahl` per clip, spec 6.30) · `GET /proj/verlauf` | read only |
| `geraete_lage` | `GET /geraete` | read only; assigning and releasing only Andreas (F3) |
| `proj_neu` · `proj_oeffnen` | `POST /proj/neu {name}` · `POST /proj/oeffnen {slug}` | Stop Cypher (409 `ki_gestoppt`); if a transport is running that Andreas started or took over after Stop Cypher (page, hand button or unknown), 409 `transport_laeuft`, nothing stopped (spec 6.37); a transport of the old project that I started and that was not taken over is stopped |
| `proj_aendern` | `POST /proj/aendern {rev, label, befehle}`; without `rev` the tool fetches it from `GET /proj/aktuell?nur=rev` (also undo/redo) | Stop Cypher; `rev_veraltet` (read again); `regler_abgelehnt` (Andreas holds the control, nothing changed); `deck_laeuft` on `tempo_setzen` while a deck plays; audio only with a `sha256` from the library (`sha_unbekannt`, `nur_live`, `quelle_fehlt`); routing since 1.10: `gruppenspur_neu` · `gruppenspur_aendern` · `gruppenspur_loeschen` · `ziel_setzen` · `master_aendern` (reasons `routing_zyklus`, `routing_grenze`, `ziel_unbekannt`, `gruppe_unbekannt`; the kind of group in the target is called `"gruppe"`); solo on a track lets its group sound, solo on a group lets all members sound, mute on a group mutes its members |
| `proj_undo` · `proj_redo` | `POST /proj/undo` · `POST /proj/redo {rev}` | Stop Cypher; `nichts_zu_tun` |
| `proj_transport` | `POST /proj/transport {aktion, beat?}` | Stop Cypher (409 `ki_gestoppt`); Stop Cypher does not stop a running transport, not even mine: it keeps running and from then on belongs to Andreas (E-a); a start of mine that is still waiting drops (core: receipt 7 `ki_stopp`); `start` and `stopp` over a transport that Andreas started or that was handed to him by Stop Cypher (page, hand button, Stop Cypher or unknown), 409 `transport_laeuft`, nothing sent: I stop only what I started and what he has not taken over, and a start ended his run (spec 6.37) |
| `proj_freeze` | `POST /proj/freeze?antwort=kurz {spur_id, an}` (page server `djk/oberflaeche/bereiche/proj/ausgabe.ts`) | Stop Cypher; only Surge tracks; waits up to 6 min (tool deadline, after that 504 `hand_frist`, the run may continue on the server) |
| `proj_export` | `POST /proj/export {von_beat?, bis_beat?, abgriff?}` (`ausgabe.ts`) | Stop Cypher; transport must be stopped; waits up to 80 min (tool deadline) |
| `proj_lautheit` | `POST /proj/lautheit {von_beat?, bis_beat?}` (`ausgabe.ts`) | Stop Cypher; transport must be stopped; freezes Surge tracks beforehand (needs the host arr1, otherwise 409 `wirt_fehlt`); waits up to 80 min (tool deadline) |
| `proj_aufnahme` | `POST /proj/aufnahme {aktion: start oder stopp, von_beat?}` (source cypher; `djk/oberflaeche/bereiche/proj/aufnahme.ts`) | writes; records only internal inputs (`erz/1..3`) on armed audio tracks; Stop Cypher (409 `ki_gestoppt`); `nichts_scharf`, `ueberlappung`, `transport_laeuft`, `aufnahme_laeuft`, `keine_aufnahme`, `aufnahme_abgebrochen` (with `grund`), `beschaeftigt`; external inputs only with Andreas' release per input (`geraete_lage`) |
| `proj_warp` | `GET /proj/warp?clip_id=…&von_beat=…&bis_beat=…&bei_beat=…` (`bereich.ts`, `sitzung.ts warpLage`) | reads only; `kein_projekt`, `clip_unbekannt`, `feld_nur_audio` |
| `proj_stems` · `proj_stems_abbrechen` | `POST /proj/stems {clip_id oder spur_id, von_beat?, bis_beat?}` then `GET /proj/aktuell?noten=zahl` (field `stems`) · `POST /proj/stems/abbrechen {auftrag_id}` (`bereiche/proj/stems.ts`) | deadline 20 min (`DJK_HAND_FRIST_PROJ_STEMS_MS`), after that `laeuft` with `auftrag_id`, the run continues; rejections `stems_quantum`, `nur_andreas_spur`, `ki_gestoppt`, `stems_loop`, `mehrere_clips`, `zu_viele_spuren`, `stems_laeuft`, `kein_kernstand`, `stems_zu_gross`; end `veraltet` also with `ki_gestoppt`, state `unbekannt` (project switched); abort: `kein_auftrag` (also after the end), `zu_spaet` (only while saving) |

**`proj_freeze {spur_id, an}`** plays the notes of a Surge track (host) once in real time in the core (from the first to the last
MIDI clip with sounding notes plus 2 beats, at most 256 beats; at 124 BPM 8 bars take about 16 s, the call waits), after that the track plays
as audio, live and in the export. `an: false` discards the freeze (no run). A change of notes, device or tempo also discards it; undo
brings it back. During the run, changes to notes, clips, tempo and transport are 409 `beschaeftigt`; mixer changes go through.
If the track is already in that state (frozen with `an: true`, free with `an: false`), the server answers 200 without change.
Answer (`?antwort=kurz`): `{rev, spur_id, freeze: {datei, frames, kennung, sha256, von_beat}}`, `freeze: null` after discarding; one undo step
("Freeze <Spur>"). Rejection as `{fehler, text}` (English `text`):

| Code | Reason | When |
|---|---|---|
| 400 | `argument_ungueltig` | missing or foreign field, `an` not a boolean |
| 400 | `spur_unbekannt`, `keine_wirtspur`, `spur_leer`, `zu_gross` | track not in the project; not a Surge track; no sounding notes; more than 256 beats |
| 409 | `ki_gestoppt`, `kein_projekt`, `transport_laeuft`, `beschaeftigt` | Stop Cypher; no project open; transport running (stop it first); a freeze or export is running, a project is being opened or the tempo is still ramping |
| 409 | `deck_laeuft`, `nicht_geladen`, `kein_kernstand`, `veraltet` | master tempo differs and a deck plays; playback not yet in the core; the core has not reported anything yet; the track was changed in the meantime |
| 409 | `wirt_fehlt` | the production host arr1 is not running (`djk-start --arr1` or `djk/start/djk-instrumente --arr1`); nothing sent, nothing saved |
| 503 | `kein_kern` | when aligning the master tempo no core reports |
| 502 | `freeze_fehler` | the core aborted or restarted, nothing saved |
| 504 | `hand_frist` | comes from the tool, not from the server: no answer after 6 min, the run may continue |

**`proj_export {von_beat?, bis_beat?, abgriff?}`** renders the open project offline in the core (low priority, for 8 bars a few seconds) as WAV, 48 kHz,
32 bit float, into the folder `export/` of the project; it never overwrites. Without a value the loop bracket applies, otherwise `von_beat` to `bis_beat` (1 to 1024 beats,
start from beat 0). Surge tracks with notes that are not yet frozen are frozen beforehand in real time (one undo step each), the call waits for both.
`abgriff` selects where the export taps the signal: `produktion` (default) is the production master, after its fader (`pm/fader`), but before the DJ clamp, the DJ master fader and the set limiter, so an external mastering chain gets the unlimited signal; `set` is the signal as the room hears it (after the set limiter). Without a value the server chooses `produktion`.
Answer: `{datei, frames, spitze_db, regler_quelle, abgriff, ueber_decke, limiter_db_max, lufs_i, lra, true_peak_dbtp}`. `regler_quelle` is `kern` (mixer as the running core has it) or `projekt`
(from the project file, because no core ran since the start). `ueber_decke: true` means: the sample peak of the file lies above the ceiling of the limiter (`kern.toml` `limiter_dbtp`); with `abgriff: produktion` the set limiter would have lowered it, `limiter_db_max` is its largest reduction in dB during the render (0 = never kicked in). The page shows SET LIMITER when the limiter intervenes while listening. Loudness is measured on the written file; if ffmpeg fails, the three loudness fields are
`null` and `loudness_fehler` gives the reason (the WAV is written anyway). Rejection:

| Code | Reason | When |
|---|---|---|
| 400 | `argument_ungueltig`, `export_bereich` | unknown field, not a number, or `abgriff` neither `produktion` nor `set`; range shorter than 1 beat, longer than 1024 beats or before beat 0 |
| 409 | `ki_gestoppt`, `kein_projekt`, `transport_laeuft`, `beschaeftigt` | as above; `transport_laeuft` means: the transport must be stopped (Andreas' run also stays untouched) |
| 400 | `zu_gross` | from the freeze run ahead: a Surge track reaches over more than 256 beats (freeze individually first or shorten) |
| 409 | `audio_fehlt`, `kein_kernstand`, `veraltet` | an audio clip is still being decoded (try again shortly); a track needs a freeze, but the core has reported nothing; new notes came during the export, nothing written |
| 409 | `deck_laeuft`, `nicht_geladen` | from the freeze run ahead: master tempo differs and a deck plays; playback not yet in the core |
| 409 | `wirt_fehlt` | the production host arr1 is not running (`djk-start --arr1` or `djk/start/djk-instrumente --arr1`); nothing sent, nothing saved |
| 503 | `kein_kern` | from the freeze run ahead: when aligning the master tempo no core reports |
| 502 | `freeze_fehler`, `render_fehler` | freeze or render failed; the answer names which steps (freeze as its own undo step) were already saved and whether a file was produced |
| 504 | `hand_frist` | comes from the tool: no answer after 80 min, the run may continue |

Stop Cypher holds only my hand (decision E-a, package 1.18): no fader is lowered, nothing ramps back on release, what sounds keeps sounding.
Running ramps and plans of mine end at the actual value (like `abbrechen`). Also a running transport that I started is not stopped by Stop Cypher: it keeps running and from then on belongs to Andreas (E-a, 20.10.; spec 6.37 is superseded in this respect). A start of mine that still waits for the bar or for the tempo ramp before it drops (`ok: false`, receipt 7 `ki_stopp`, nothing is started); after the release I start again. Andreas' movements on
`spur/<n>/*` land in the project and in the history with source `andreas`. Deleting a project does not exist via MCP.

**`proj_warp {clip_id, von_beat?, bis_beat?, bei_beat?, marker_max?, transienten_max?}`** (package 1.13) reads the warp of an audio clip: `warp` is `null` without warp, otherwise `{an, modus, quelle, eins_unsicher, transpose_st, detune_ct, versatz_beats, marker_zahl, marker_gezeigt, weiter_ab_projekt_beat?, tempo {mittel_bpm, min_bpm, max_bpm}, erster_marker {quell_s, beat}, marker: [{quell_s, beat, projekt_beat, segment_bpm}]}`. The list has at most `marker_max` entries (1 to 4096, default 200; a workshop map has 350 to 2300, one per beat, beat 0 is the first one): `marker_zahl` is the number in the clip, `marker_gezeigt` that of the answer, `weiter_ab_projekt_beat` the first marker not shown (as `von_beat` of the next page); `tempo` and `erster_marker` summarise the warp without the list. `quell_s` is the source second, `beat` the clip beat (0 = bar 1.1.1 of the source), `projekt_beat` the position in the first pass, `segment_bpm` the source tempo of the segment that begins at the marker (`null` at the last marker). `bei_beat` (project beat) additionally returns `bei {projekt_beat, quell_s}`: the source second that plays there, as a cross-check. Changes go through `proj_aendern`: `clip_neu` with `warp: "auto"`, `warp_auto {clip_id}`, `warp_setzen {clip_id, an?, modus?, beats?, transpose_st?, detune_ct?, warp?}` (modus `repitch | beats | complex | tones`; mode `beats` (slice 4): drum units, each starts on its beat and keeps its shape; parameter `beats {raster: transienten | 1/4 | 1/8 | 1/16 | 1/32, loop: aus | vor | vor_zurueck, huelle: 0..100}`, default `transienten`/`vor`/`100`, the whole object is sent; `beats` follows the tempo like `repitch` and rejects `transpose_st`/`detune_ct` ≠ 0 with `transpose_repitch`; `proj_lage` reports `modus: 'beats'`, `proj_warp` the object `beats`), `clip_aendern {versatz_beats}`; the source of the auto warp in this order: workshop map of the file (same sha256, one marker per beat, beat 0 = first one, the clip starts there and reaches to the end of the file), Traktor grid, bars, library BPM; one-shots never warp. If there is no tempo, `proj_aendern` reports `hinweise: [{index, hinweis: "kein_tempo"}]` (`warp_auto` rejects with `kein_tempo`); a long track (from 60 s) without map and without Traktor grid is analysed in the background by the workshop: `hinweise` then names `analyse_angefordert` (if it is already running: `analyse_laeuft`), the clip is switched over on arrival (a history entry `Auto-Warp`), `proj_lage` lists the running analyses under `analyse [{clip_id, status: wartet|laeuft}]`. An unusable map reports `karte_zu_gross` or `karte_unbrauchbar`, the next source applies. `modus` is `repitch` (the pitch follows the tempo), `complex` (whole tracks, the pitch stays) or `tones` (tonal, finer grain); `warp_setzen modus` switches it. `transpose_st` (whole semitones, −12 to 24) and `detune_ct` (cents, −50 to 50) detune the clip in `complex` and `tones`, the tempo stays; together −1200 to 2400 cents (below −12 semitones the attack in the arrangement would come too late). In `repitch` they do not exist (`transpose_repitch`): whoever switches from `complex` to `repitch` sets both to 0 in the same `warp_setzen`. A change takes effect after a short moment (the voice is re-set in the warp engine, about 43 ms plus one cycle) and needs a core from the same state as the page server (an older core does not play the detune). A core without Bungee rejects COMPLEX and TONES on loading (`warp_maschine_fehlt`). Slice 4: `transienten_zahl` (hits of the server in the source within the clip; `null`: audio not yet decoded), `transienten` (source seconds of the hits in the window `von_beat`..`bis_beat`, at most `transienten_max`, default 4096, up to 32768) and `transienten_gezeigt`.

**`proj_stems {clip_id | spur_id, von_beat?, bis_beat?}`** (package 1.13 slice 6) splits an audio clip (whole or `von_beat..bis_beat`, at most 600 s source) on the CPU into drums, bass, other and vocals. The result is ONE project change with one undo step: the original in the range is muted (`stumm` on the clip, `clip_aendern`), four tracks in the group "Stems: <Name>". The tool starts (`POST /proj/stems` → `{auftrag_id, frames}`) and polls `GET /proj/aktuell?noten=zahl` until `stems.zustand` is no longer `laeuft` (`fertig | abgebrochen | veraltet | fehler`, with `grund` and `text`) or the deadline (20 min) is over; then it answers `laeuft` with `auftrag_id`, without abort. If the project was switched or closed (the run then aborts) or the state is missing, it answers `unbekannt` with `detail`: check `proj_lage`. `proj_lage` carries the same field `stems` (last state, stays after the end). `proj_stems_abbrechen {auftrag_id}` aborts (`kein_auftrag` for an unknown id; `zu_spaet` only while the run takes over the result, after that `kein_auftrag`; undo takes the stems back).

**Markers by hand** (package 1.13 slice 3b) via `proj_aendern`; beats are clip beats (the beats of the markers, 0 = bar 1.1.1 of the source), each command one undo step, `quelle` of the warp becomes `hand`: `warp_tempo {clip_id, faktor: 2 | 0.5}` (beats of all markers, offset, clip length and loop times factor; `warp_faktor` outside 15..800 BPM), `warp_marker {clip_id, setze?: [{quell_s, beat?}], loesche?: [beat], verschiebe?: [{beat, neu_quell_s | neu_beat}]}` (delete, move, set; without `beat` a new marker gets the beat of the grid there; reasons `marker_unbekannt`, `warp_marker`, `warp_faktor`), `warp_ab_hier {clip_id, beat, art: gerade | start}` (Warp From Here; `start` sets the auto warp anew from there, `kein_tempo` without source), `eins_hier {clip_id, quell_s}` (Set 1.1.1 Here; the clip begins at the new one, the offset stays, so the track moves in the project by the beats that the spot lay behind the old one (as in Live), its length follows; if the track is in the deck's inventory and this server writes corrections, it goes as a line `eins` `von andreas` (also when Cypher sends, spot rounded to the next whole map beat) into `korrekturen.jsonl`: the next auto warp of the track begins there, the deck after its next version; undo takes the clip back, not the line; `hinweise`: `eins_gemeldet`, `eins_nur_hier`, `eins_rueckweg_fehler`), `tempo_vom_clip {clip_id}` (project tempo = the tempo at which the clip sounds as long as the piece of the source that it plays; like `tempo_setzen`: `deck_laeuft`, `tempo_bereich`). Quantize audio: `audio_quantisieren {clip_id, raster: 1/4 | 1/8 | 1/16 | 1/32, staerke? 0..1 = 1, von_beat?, bis_beat?}` (`von_beat`/`bis_beat` are clip beats, the beats of the markers, 0 = bar 1.1.1 of the source, not project beats as with `proj_warp`; default: the range of the clip, with a loop the first copy; the grid applies in the project) sets a hand marker on the grid at each transient of the source (in the range) (strength 1 exactly on it, 0.5 halfway); markers outside stay, inside they are replaced; the length stays; one undo step. Rejections: `transienten_fehlen` (source not yet decoded), `keine_transienten`, `quantisieren_konflikt` (the new markers would not be strictly increasing), `warp_faktor` / `warp_marker` (limits 15..800 BPM, 4096 markers; never silently truncated). Read back with `proj_warp`.

**`proj_lautheit {von_beat?, bis_beat?}`** measures the loudness per track and as a sum, offline and only on request (no measurement runs in the core). The server renders each track that plays something in the range
individually (fader and pan of the track from the project, then through its group and the production master, all other tracks muted, without the mixer state of the core; the tap is the production master, before the set limiter) and once all together, then ffmpeg measures each WAV. Range as with `proj_export`
(default loop bracket, 1 to 1024 beats). Surge tracks with notes are frozen beforehand (host arr1 needed). Nothing is written to the project or to the export folder.
Answer: `{von_beat, bis_beat, spuren: [{spur_id, nr, name, lufs_i, lra, true_peak_dbtp, spitze_db, stumm, unter_messgrenze}], summe: {lufs_i, lra, true_peak_dbtp, spitze_db, unter_messgrenze, regler_quelle}}`. `lufs_i` is the integrated loudness,
with it one matches an 808 kick to a bass (the peak is misleading there). A muted track, one with its fader off, or one silent in the range reports `stumm: true` and `lufs_i: null` (not −70); if any track of the project is on solo, a track without solo counts as silent, as in the mix. A quiet but not silent track below the measurement floor
of −70 LUFS (peak between −90 and about −68 dBFS) reports `unter_messgrenze: true`, `stumm: false`, `lufs_i: null` (not −70.0) and `lra: null`, the true peak remains measured. Tracks without content in the
range are missing. The sum matches `proj_export` of the same range (default `abgriff: produktion`) to 0.1 LU (`regler_quelle: projekt` for the sum, `kern` for the export). `spitze_db` is the sample peak at the production master, before the set limiter.
Rejection as with `proj_export`, plus `wirt_fehlt`. The deadline of 80 min covers normal ranges; in the edge case (up to 33 renders (32 tracks and sum) of 1024 beats at 60 BPM, each at the time limit) the server allows about 39.3 h, then `hand_frist` comes.

## Building a track

Command sequence with the tools; the commands run in the project, the answers of `proj_aendern` carry only `rev`, `kern` and `noten_zahl`, the
track IDs (`s1`, `s2` …) are assigned by the server, which is why `proj_lage` reads them before the clips. A command in the list that fails makes the whole list
ineffective (all or nothing, one undo step). Prerequisites: no deck plays (otherwise `tempo_setzen` gives 409 `deck_laeuft`), Stop Cypher is not set
(`ki_gestoppt`), and no transport runs that Andreas started or took over after Stop Cypher (otherwise `proj_neu` gives 409 `transport_laeuft`).

1. `proj_neu {"name": "Mini"}` creates the project and opens it (slug `mini`).
2. `proj_aendern` with `label: "Tracks"` and the commands `tempo_setzen`, three times `spur_neu`:

```json
[{"befehl":"tempo_setzen","bpm":128},
 {"befehl":"spur_neu","art":"audio","name":"Kick"},
 {"befehl":"spur_neu","art":"instrument","name":"Bass","geraet":{"art":"intern","name":"rb338"}},
 {"befehl":"spur_neu","art":"instrument","name":"Lead","geraet":{"art":"wirt","name":"surge","slot":1}}]
```

3. `proj_lage` returns `spuren[].id` and `nr` (here `s1` Kick, `s2` Bass, `s3` Lead; do not guess, read).
4. `proj_aendern` with `label: "Clips"`: `clip_neu` with notes, `spur_aendern`, `loop_setzen`. Audio only with a `sha256` from the library (`klaenge`
   searches one-shots, `einsatz` must be `sofort`; the kick below is the 808 one-shot of the acceptance track from 20.10.):

```json
[{"befehl":"clip_neu","spur_id":"s1","art":"audio","start_beat":0,"laenge_beats":8,"loop_beats":1,
  "sha256":"67526f9fd62b0f340fd5bb9d63e34db2832b37d2bbc5067e05e9ab29022886c9"},
 {"befehl":"clip_neu","spur_id":"s2","art":"midi","start_beat":0,"laenge_beats":8,"noten":[
   {"beat":0,"laenge":0.5,"ton":33,"vel":100},{"beat":1,"laenge":0.5,"ton":45,"vel":100},
   {"beat":2,"laenge":0.5,"ton":33,"vel":100},{"beat":3,"laenge":0.5,"ton":45,"vel":100}]},
 {"befehl":"clip_neu","spur_id":"s3","art":"midi","start_beat":0,"laenge_beats":8,"noten":[
   {"beat":0,"laenge":7.5,"ton":69,"vel":80}]},
 {"befehl":"spur_aendern","spur_id":"s2","fader_db":-4},
 {"befehl":"spur_aendern","spur_id":"s3","fader_db":-10,"pan":0.25},
 {"befehl":"loop_setzen","an":true,"von_beat":0,"bis_beat":8}]
```

   `beat` of a note counts within the clip, `loop_beats: 1` makes the kick strike anew on every beat (clip loop up to `laenge_beats`), `ton` is the MIDI number (33 = A1).
5. `proj_transport {"aktion":"start","beat":0}` plays the loop (quantised to 2 if a deck, a loop box or a Strudel stream runs, otherwise immediately); listen with
   `pegel` or through Andreas. To carry on: `proj_transport {"aktion":"stopp"}`: freeze and export need a standing transport.
6. `proj_freeze {"spur_id":"s3","an":true}` freezes the Surge track (real-time run). The step is optional before the export: `proj_export` freezes
   unfrozen Surge tracks with notes by itself.
7. `proj_export {}` writes the loop range (here beat 0 to 8) as WAV to `~/cypherdj-projekte/mini/export/` and reports `datei`, `frames`, `spitze_db`,
   `lufs_i`, `lra`, `true_peak_dbtp`.

**Recording in four lines** (1.8 slice 1, internal stream onto an audio track):

1. `proj_aendern` with `spur_aendern {spur_id, arm: true, eingang: {art: "intern", name: "erz/1"}}` (erz/1 is the Strudel channel).
2. `proj_aufnahme {"aktion":"start","von_beat":0}` arms the core, starts the transport and records from its start.
3. `warte` or music via `strudel`; the take is the internal stream, bit-identical.
4. `proj_aufnahme {"aktion":"stopp"}` stops the transport, writes `aufnahmen/take-<kennung>-<spur>.wav` and places one clip per track (one undo step); `proj_lage` shows the clip.
   If the transport ends otherwise (`proj_transport`, hand button, end of the arrangement), the server saves the take itself; `stopp` then delivers the result once, after that it is under `letzte` in `proj_aufnahme`.

Measured 2026-10-20: the command lists from 2. and 4. run through `fuehreListeAus` (`djk/oberflaeche/projekt/befehle.ts`) on a new project without errors and
yield `s1` Kick, `s2` Bass, `s3` Lead, loop 0..8, tempo 128; the same list with `spur_id: "s9"` is rejected with `spur_unbekannt` (negative control).
Only the page server checks whether the `sha256` exists in the library (`sha_unbekannt`, `nur_live`, `quelle_fehlt`). Not part of this measurement: the HTTP path
and the export of the mini example. Built on the running system is the acceptance track from 20.10. via the same routes (3 tracks, 80 notes, export 720000 frames,
`docs/masterplan/MASTERPLAN.md`, section "Abnahme D1"); its script is not in the repo.

## Pre-listening

`hoeren` measures a channel behind its fader (Ohr (ear), slice 1): six bands, loudness, peak, overlap with the
running master per band, level difference, EQ suggestion (low/mid/high in dB) and a bass swap hint. Only meaningful on a **closed** deck
(the measurement tap lies before the fader, ADR 008): `laden` → `deck_start` (fader stays
closed) → `warte 4` (phrases need a full 4-bar window) → `hoeren` → `regler` (EQ/trim, closed allowed) →
`warte 4` → `hoeren` again (the measurement sits after the EQ).

`vergleich.trim_vorschlag_db` is the **absolute** target value for `deck/N/trim` in dB (old trim minus level difference, clamped to ±24;
the measurement tap lies after the trim, ADR 008), valid only on a closed deck. `trim_unbekannt: true` instead of
the suggestion: the page does not know the old trim (after its restart); also none if a page is silent.

Since slice 3, the page server issues from this measurement a listening pass per bar (`urteil` in the `hoeren` answer
and in `lage.decks[].hoerschein`) and sends it to the core when `urteil: 'ok'`. `regler` on `deck/1`/`deck/2`, which
opens the channel (trim + fader above −26 dB), then automatically appends `hoerschein: hs_id`. No separate call
needed, only wait until `hoeren` shows `urteil: 'ok'` (`sync_ms`/`deck_gegen_deck_ms` are included only as the reason
`sync_unvalidiert:<ms>`, without effect on the verdict, Rev. 4). Without a valid certificate it stays at 409 `kein_hoerschein`,
now with `urteil` and `gruende` of the last certificate in the body.

## Limits (who holds them)

| Limit | held by |
|---|---|
| Stop Cypher blocks control and deck commands | core (`ki_gestoppt`); FX and Strudel are checked by the page server (core accepts `/k/fx` even when stopped) |
| Release lifts Stop Cypher | page server sends `/k/ki/frei` on the button `freigabe` (Review B2) |
| Crossfader, master, PFL, cue, bus faders, channel target are Andreas' hand | core (`nur_hand`) |
| Andreas' grip on a control breaks my ramp / locks it for me | core (receipt 7 `hand`, `regler_beim_menschen`) |
| Opening a closed channel (trim + fader > −26 dB, §1.6; decks; Strudel channels `erz/*` are free since 2026-09-29, Andreas: "ja sperre kann für strudel kanäle fallen", core e9baf64; **box channels `pad/*` are free as long as the box carries my own recording**, a foreign loop remains `kein_hoerschein`) | **core** (I3a, `PrueferI3::vor_teilstart`, receipt 6 `kein_hoerschein`; Ohr T14, kern.cpp: `Stellwerk(uhr_, &pruefer_)`) AND page server (409 `kein_hoerschein` with `urteil`/`gruende` of the last certificate, otherwise with a valid listening pass from `hoeren`, `/k/teil` with `hoerschein: hs_id`); Andreas (source `andreas`) is exempt from the core (§17 "the hand is never blocked") |
| Jump / hot cue playback / start on an open deck, load/start of a box on an open box (exception since 2026-10-05: own master recording, `quelle: mitschnitt`) | page server (409 `ziel_ungehoert`, I3d) |
| Loading/starting foreign material (everything except my recording) into a box, as long as my fader/trim ramp on `pad/<n>/` runs; `loop_nach_box` additionally also onto an open box (otherwise the check applies only at the moment of the request) | page server (409 `box_offen_oder_faehrt`) |
| FX, Strudel only with AUTO on | page server / djk-muster (409 `auto_aus`) |
| AUTO switch, grid (deck and loop), `/griff`, `/taste` | page server (403) |
| FX routing (insert or post fader): Andreas' key, I cannot switch it; I hear the effect in pre-listening (`hoeren`) only if it is on insert | page server (403 `nur_andreas`) AND core (`nur_hand`) |

The source is a label on 127.0.0.1, not a security boundary (Review M6): whoever sends without a head counts as Andreas.
Until the slice "Ohr" issues listening passs and brings the checker into the core, I prepare (load, start in sync behind the closed fader, jump, loops, pads, L1/L2, EQ/filter on open channels, make quieter) and
do not mix myself.

## Automation tracks (Studio S6, 2026-09-29)

A track is a JSON file with rides on the bar grid, counted from the next bar (`--ab takt`, default)
or phrase one (`--ab phrase`). Examples in `docs/beispiele/spuren/`.
A ride without `form`: at the core `s`, at the host `linear` (the page always writes `form` for ramps).

    djk/werkzeuge/djk-spur [--instanz f] start docs/beispiele/spuren/ende-bass.json [--ab phrase]
    djk/werkzeuge/djk-spur [--instanz f] show      # running tracks, with rejected parts
    djk/werkzeuge/djk-spur [--instanz f] stop ende-bass

| Target | Effect | Route |
|---|---|---|
| Control path from SCHNITTSTELLEN §1.5 (`erz/2/filter`, `erz/3/fader`, `deck/1/eq/tief` …): `nach` in its unit, `takte` (0 = set), `form` `s` (default) or `linear` | beat-exact in the core, a tempo change stretches along; a grip on the control breaks off | `/k/teil`, plan `spur:<name>` |
| `wirt:bass/<parameter>`, `wirt:melodie/<parameter>` (continuous Surge parameters, `surge_bereiche.json`), optionally `von` | start on bar one (measured 4 ms), duration converted to seconds at the start: a tempo change afterwards does NOT stretch it | host `fahre` with `ab`, `spur` |
| `strom:1..3` with `muster` | takes effect from bar one of the ride (the server writes 2 beats earlier; with `ab_takt 1` and a close anchor it can take effect one bar late) | like the Strudel field, the AUTO lock applies |

Fading out: the core moves the fader linearly in dB. A ramp to −200 is inaudible after a quarter of the time already;
to fade out audibly: to −60 `linear`, then set −200 afterwards (so `aus-bass-4.json`, measured: 198 ms hard against
4194 ms with the track, test A). Cypher's `abbrechen` also hits Cypher's tracks; Andreas' tracks (without a head) not.
Status after the final review: Stop Cypher aborts Cypher's tracks immediately (core, host, pattern); AUTO off on a
stream rejects Cypher's tracks and `/regler` on `erz/<n>`, `wirt:<gruppe>`, `strom:<n>` with 409 `auto_aus`; tracks
survive a restart of the page server (`spuren.json` next to the host sockets); pattern rides follow the core beat,
also after a tempo change; `djk-spur start` ends with return code 1 if a part was rejected, and names it
(`part <teil> <pfad> rejected: <grund>`); I cannot stop Andreas' tracks (403 `nur_andreas`).

## Status 2026-10-05 ()

- **Tempo:** Tool `tempo {bpm 60..200}` (`POST /tempo`): 4-beat ramp starting at the next bar; Stop, Cypher holds it (409 `ki_gestoppt`). Loop boxes, REC and Strudel follow; decks only play at 128, the core rejects the change while a deck is running (`kein_stretcher`), and a deck does not start as long as a tempo ramp is still pending.
- **Box fader/trim (`pad/*`):** free for your own recordings (the page issues no listening pass for the box, Glanz 1.3); a box with foreign loop material stays 409 `kein_hoerschein`. Foreign material: `box laden`/`start` on an OPEN box returns 409 `ziel_ungehoert`; with your own fader/trim ramp running on the box, 409 `box_offen_oder_faehrt`; `loop_nach_box` (deck cut) on an open box or while a ramp is running returns 409 `box_offen_oder_faehrt`. Automation tracks (`spur`) still do not open boxes.
- **Read the receipt, not only HTTP 200:** `/regler` answers 200 even when the core rejects; the authoritative field is `quittung.status` (6 = rejected, `grund`).
- **Overlap:** if a new Cypher part overlaps one of your own open parts on the same path, the page pushes it behind the end of the run; the response carries `verschoben_auf` (beat). Rejections exactly at the start beat then do not appear in the response, only in `lage` (`quittungen`). Your parts are never moved.
- **Silent fields:** `studio` shows `status.taub` (Strudel fields of the pattern that do not sound here: `cutoff` = lpf, `hcutoff` = hpf, `room`, `delay`, `fmi` ...). Lower bound, valid when `status.taub_muster == status.nr`; fields added later will join it. Do not build on it, timbre goes through `klang`.
- **loop_klang:** the page receives `--kit <drums-kit>` from djk-start; before that it computed against battery and reported "no free note". Kit limit 10 s per loop (at 128 at most 16 beats).
- **FX beats:** only 0.25, 0.5, 1, 2, 4, 8, 16 (0.75 gives 400 `beats`). Types: 1 echo, 2 flanger, 3 phaser, 4 filter, 5 reverb (beats = decay time, param1 = SIZE), 6 delay (one repeat, param1 = TONE), 7 ping pong (param1 = feedback), 8 trans (param1 = DUTY), 9 roll, 10 slip roll (re-records on a BEAT change), 11 vinyl brake (beats = brake duration), 12 spiral (param1 = feedback, pitch glides on a BEAT change).
