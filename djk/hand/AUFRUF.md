# djk-hand: Cyphers Hand an djk (MCP, stdio)

Plan `docs/superpowers/plans/2026-09-28-djk-hand-mcp.md` (Rev. 2 nach Review), Stand `docs/architektur/stand/hand-mcp.md`.

    claude mcp add --scope user djk-hand -- node /path/to/cypher-dj/djk/hand/hand.ts --seite http://127.0.0.1:47300

Prüfinstanz i: `--seite http://127.0.0.1:56300`. Die 56 sind gezählt am Code (`grep -c "^  { name: '" djk/hand/hand.ts` = 56; 51 vor I08 Task 10, dazu `geraete_lage`, mit 1.8 Task 28 `proj_aufnahme` mit Paket 1.13 `proj_warp` und mit Slice 6 `proj_stems`, `proj_stems_abbrechen`) und gegen die MCP-Antwort `tools/list` von `node hand.ts` (ebenfalls 56); davon 16 `proj_*`. Jeder Aufruf geht als HTTP an den Seiten-Server mit dem Kopf
`x-djk-quelle: cypher`; der Server setzt die Quelle `cypher` in jeden Kern-Befehl, Cyphers Befehle tragen `plan: cypher`.

## Werkzeuge (56)

DJ: `lage` · `bestand` · `laden` · `deck_start` · `deck_stopp` · `sprung` · `loop` · `pad` · `loop_nach_box` · `box` ·
`regler` (Rampe über Takte; Projekt-Mixerpfade `spur/1..32/*`, `grp/1..8/*`, `pm/fader` lehnt der Server mit `ueber_projekt` ab) · `fx` · `fx_zuweisung` · `abbrechen` · `tempo` (Decks folgen seit 2026-10-06: Varispeed, dann Tausch auf eine Fassung im neuen Tempo, ADR 028) · `warte` · `hoeren`. Dazu die Studio-Werkzeuge
unten und die Mediathek (`bibliothek` · `vorbereiten` · `sets` · `set_zeige` · `set_lege` · `set_vorbereiten`) sowie `instrumente`. `instrumente {melodie: "fluegel"}` legt einen gesampelten Flügel (Ableton Core Library,
4 Anschlagstufen, Carla-SFZ) auf MELODY statt Surge, `"surge"` zurück (2026-10-06).

Bibliothek durchsuchen: `stoebern` blättert die ganze Mediathek nach Typ (`track`, `loop`, `oneshot`, `strudel`) mit
Textsuche, Feldfiltern, Camelot-Nachbarn, BPM- und Energiefilter, Sortierung und Seiten (nur lesend). `anschluss` nennt
zum laufenden Deck (oder zu einer `material_id`) die passenden Bibliothekstracks, gereiht nach Tempo, Genre,
Camelot-Zug und Energieklasse, mit `punkte`, `zug` und `gruende` je Treffer (nur lesend).

Klänge (Plan `docs/superpowers/plans/2026-10-06-klaenge.md`): `klaenge` sucht alle Klänge außer Tracks (One-Shots, Loops,
Impulsantworten, Mitschnitte, Erzeugtes, Stimmen) in Mediathek und eigener Loop-Bibliothek; jeder Treffer trägt `einsatz`:
`sofort` (spielt jetzt, eigene Loops über `box`), `werkstatt` (offene Datei, braucht Kit-Bau oder Laden) oder `nur_live`
(verschlüsseltes Ableton-Pack-Sample, nie laden). `bestand_karte` zählt den Bestand je Typ und Einsatzstufe, die größten
Packs und die Loop-Bibliothek. Klang gesucht: erst `klaenge`, dann bauen.

Studio (Plan `docs/superpowers/plans/2026-09-29-djk-hand-mcp-studio.md`, 2026-09-30):

| Werkzeug | Route | Riegel für cypher |
|---|---|---|
| `strudel` | `POST /strudel` | AUTO des Stroms, Stop Cypher |
| `studio` | `GET /strudel?strom=1..3` | lesend; `status.taub` = Strudel-Felder, die hier nicht klingen (siehe „Taube Felder“) |
| `stille` | 3× `POST /strudel` `silence` | wie `strudel`, meldet Teilfehler je Strom |
| `pegel` | `GET /pegel?sek=1..10` (ungedrosselter Puffer vor der SSE-Drossel; Kanäle auch `spur/1..32`: Spitze und Median nach dem Spur-Fader, keine Lautheit; `grp/1..8` je Gruppe mit Mitgliedern, `pm` = Produktions-Master nach seinem Fader, vor dem Set-Limiter) | lesend |
| `klang` | `POST /klang` (spawnt `djk/wirte/carla/djk-klang`; `fahre` direkt an den Wirt mit Spur `klang-<gruppe>`) | AUTO Strom 2 (bass) / 3 (melodie), Stop Cypher, `fremdePost`; `zeige`/`liste` frei; Werte mit `-` vorne 400 |
| `loops` | `GET /loops` | lesend |
| `rec` | `POST /loop {aktion:rec}`, wartet auf die Kern-Quittung | Kern: laufende Tempo-Rampe (`ausserhalb_bereich`), Stop Cypher, Überlappung; jedes feste Tempo geht (Plan Tempo-Folge) |
| `loop_klang` | `POST /loop {aktion:kit}` | AUTO Strom 1, Stop Cypher |
| `spur` · `spur_stopp` · `spuren` | `POST /spur {spur:{name,fahrten},ab}` · `POST /spur/stopp` · `GET /spur` | wie Automationsspuren unten; Ziele `spur/1..32/*`, `grp/1..8/*` und `pm/fader` lehnt der Server mit 409 `ueber_projekt` ab (nur über `proj_aendern`) |

`/lage` trägt zusätzlich `studio: {stroeme:[{strom, autonom, von, text_kurz}], klang:{bass, melodie}}`
(`klang` = Name aus `wirt-<g>.json`; nach `setze` „edited"). `abbrechen` und Stop Cypher halten auch `klang fahre`.

## Produktion (D1, Spec 3.4 und 3.5)

Das Projekt besitzt der Seiten-Server (`~/cypherdj-projekte/<slug>/`, Undo-Verlauf `undo.jsonl`), der Kern spielt eine Wiedergabe
daraus. Ich ändere es nur mit Befehlslisten, nie mit Dateien.

| Werkzeug | Route | Riegel für cypher |
|---|---|---|
| `proj_liste` · `proj_lage` · `proj_verlauf` | `GET /proj/liste` · `GET /proj/aktuell?noten=zahl` (Noten nur als `noten_zahl` je Clip, Spec 6.30) · `GET /proj/verlauf` | lesend |
| `geraete_lage` | `GET /geraete` | lesend; Zuordnen und Freigeben nur Andreas (F3) |
| `proj_neu` · `proj_oeffnen` | `POST /proj/neu {name}` · `POST /proj/oeffnen {slug}` | Stop Cypher (409 `ki_gestoppt`); läuft ein Transport, den Andreas gestartet oder nach Stop Cypher übernommen hat (Seite, Hand-Taste oder unbekannt), 409 `transport_laeuft`, nichts gestoppt (Spec 6.37); ein von mir gestarteter, nicht übernommener Transport des alten Projekts stoppt |
| `proj_aendern` | `POST /proj/aendern {rev, label, befehle}`; ohne `rev` holt das Werkzeug sie aus `GET /proj/aktuell?nur=rev` (auch undo/redo) | Stop Cypher; `rev_veraltet` (neu lesen); `regler_abgelehnt` (Andreas hält den Regler, nichts geändert); `deck_laeuft` bei `tempo_setzen`, solange ein Deck spielt; Audio nur mit `sha256` aus der Bibliothek (`sha_unbekannt`, `nur_live`, `quelle_fehlt`); Routing seit 1.10: `gruppenspur_neu` · `gruppenspur_aendern` · `gruppenspur_loeschen` · `ziel_setzen` · `master_aendern` (Gründe `routing_zyklus`, `routing_grenze`, `ziel_unbekannt`, `gruppe_unbekannt`; Art der Gruppe im Ziel heißt `"gruppe"`); Solo auf einer Spur lässt ihre Gruppe klingen, Solo auf einer Gruppe alle Mitglieder, Mute auf einer Gruppe stummt ihre Mitglieder |
| `proj_undo` · `proj_redo` | `POST /proj/undo` · `POST /proj/redo {rev}` | Stop Cypher; `nichts_zu_tun` |
| `proj_transport` | `POST /proj/transport {aktion, beat?}` | Stop Cypher (409 `ki_gestoppt`); Stop Cypher stoppt keinen laufenden Transport, auch meinen nicht: er läuft weiter und gehört ab dann Andreas (E-a); ein noch wartender Start von mir fällt (Kern: Quittung 7 `ki_stopp`); `start` und `stopp` über einen Transport, den Andreas gestartet hat oder der ihm durch Stop Cypher übergeben wurde (Seite, Hand-Taste, Stop Cypher oder unbekannt), 409 `transport_laeuft`, nichts gesendet: ich stoppe nur, was ich gestartet habe und er nicht übernommen hat, und ein Start beendete seinen Lauf (Spec 6.37) |
| `proj_freeze` | `POST /proj/freeze?antwort=kurz {spur_id, an}` (Seiten-Server `djk/oberflaeche/bereiche/proj/ausgabe.ts`) | Stop Cypher; nur Surge-Spuren; wartet bis zu 6 min (Werkzeug-Frist, danach 504 `hand_frist`, der Lauf kann auf dem Server weiterlaufen) |
| `proj_export` | `POST /proj/export {von_beat?, bis_beat?, abgriff?}` (`ausgabe.ts`) | Stop Cypher; Transport muss stehen; wartet bis zu 80 min (Werkzeug-Frist) |
| `proj_lautheit` | `POST /proj/lautheit {von_beat?, bis_beat?}` (`ausgabe.ts`) | Stop Cypher; Transport muss stehen; friert Surge-Spuren vorher ein (braucht den Wirt arr1, sonst 409 `wirt_fehlt`); wartet bis zu 80 min (Werkzeug-Frist) |
| `proj_aufnahme` | `POST /proj/aufnahme {aktion: start oder stopp, von_beat?}` (Quelle cypher; `djk/oberflaeche/bereiche/proj/aufnahme.ts`) | schreibend; nimmt nur interne Eingänge (`erz/1..3`) auf armierten Audio-Spuren auf; Stop Cypher (409 `ki_gestoppt`); `nichts_scharf`, `ueberlappung`, `transport_laeuft`, `aufnahme_laeuft`, `keine_aufnahme`, `aufnahme_abgebrochen` (mit `grund`), `beschaeftigt`; externe Eingänge nur mit Andreas' Freigabe je Eingang (`geraete_lage`) |
| `proj_warp` | `GET /proj/warp?clip_id=…&von_beat=…&bis_beat=…&bei_beat=…` (`bereich.ts`, `sitzung.ts warpLage`) | liest nur; `kein_projekt`, `clip_unbekannt`, `feld_nur_audio` |
| `proj_stems` · `proj_stems_abbrechen` | `POST /proj/stems {clip_id oder spur_id, von_beat?, bis_beat?}` dann `GET /proj/aktuell?noten=zahl` (Feld `stems`) · `POST /proj/stems/abbrechen {auftrag_id}` (`bereiche/proj/stems.ts`) | Frist 20 min (`DJK_HAND_FRIST_PROJ_STEMS_MS`), danach `laeuft` mit `auftrag_id`, der Lauf geht weiter; Ablehnungen `stems_quantum`, `nur_andreas_spur`, `ki_gestoppt`, `stems_loop`, `mehrere_clips`, `zu_viele_spuren`, `stems_laeuft`, `stems_gpu_aus`, `kein_kernstand`, `stems_zu_gross`; Ende `veraltet` auch mit `ki_gestoppt`, Zustand `unbekannt` (Projekt gewechselt); Abbruch: `kein_auftrag` (auch nach dem Ende), `zu_spaet` (nur während des Speicherns) |

**`proj_freeze {spur_id, an}`** spielt die Noten einer Surge-Spur (Wirt) einmal in Echtzeit im Kern durch (vom ersten bis zum letzten
MIDI-Clip mit klingenden Noten plus 2 Beats, höchstens 256 Beats; bei 124 BPM dauern 8 Takte rund 16 s, der Aufruf wartet), danach spielt die Spur als
Audio, live und im Export. `an: false` verwirft den Freeze (kein Lauf). Notenänderung, Geräte- oder Tempowechsel verwerfen ihn ebenfalls, Undo
bringt ihn zurück. Während des Laufs sind Noten-, Clip-, Tempo- und Transportänderungen 409 `beschaeftigt`, Mixer-Änderungen gehen durch.
Ist die Spur schon so (eingefroren bei `an: true`, frei bei `an: false`), antwortet der Server 200 ohne Änderung.
Antwort (`?antwort=kurz`): `{rev, spur_id, freeze: {datei, frames, kennung, sha256, von_beat}}`, `freeze: null` nach dem Verwerfen; ein Undo-Schritt
("Freeze <Spur>"). Ablehnung als `{fehler, text}` (englischer `text`):

| Code | Grund | Wann |
|---|---|---|
| 400 | `argument_ungueltig` | fehlendes oder fremdes Feld, `an` kein Boolean |
| 400 | `spur_unbekannt`, `keine_wirtspur`, `spur_leer`, `zu_gross` | Spur nicht im Projekt; keine Surge-Spur; keine klingenden Noten; mehr als 256 Beats |
| 409 | `ki_gestoppt`, `kein_projekt`, `transport_laeuft`, `beschaeftigt` | Stop Cypher; kein Projekt offen; Transport läuft (erst stoppen); ein Freeze oder Export läuft, ein Projekt wird geöffnet oder das Tempo rampt noch |
| 409 | `deck_laeuft`, `nicht_geladen`, `kein_kernstand`, `veraltet` | Master-Tempo weicht ab und ein Deck spielt; Wiedergabe noch nicht im Kern; der Kern hat noch nichts gemeldet; die Spur wurde währenddessen geändert |
| 409 | `wirt_fehlt` | der Produktions-Wirt arr1 läuft nicht (`djk-start --arr1` oder `djk/start/djk-instrumente --arr1`); nichts gesendet, nichts gespeichert |
| 503 | `kein_kern` | beim Angleichen des Master-Tempos meldet sich kein Kern |
| 502 | `freeze_fehler` | der Kern brach ab oder startete neu, nichts gespeichert |
| 504 | `hand_frist` | kommt vom Werkzeug, nicht vom Server: nach 6 min keine Antwort, der Lauf kann weiterlaufen |

**`proj_export {von_beat?, bis_beat?, abgriff?}`** rendert das offene Projekt offline im Kern (niedrige Priorität, für 8 Takte wenige Sekunden) als WAV, 48 kHz,
32 bit float, in den Ordner `export/` des Projekts, überschreibt nie. Ohne Angabe gilt die Loop-Klammer, sonst `von_beat` bis `bis_beat` (1 bis 1024 Beats,
Start ab Beat 0). Surge-Spuren mit Noten, die noch nicht eingefroren sind, werden vorher in Echtzeit eingefroren (je Spur ein Undo-Schritt), der Aufruf wartet auf beides.
`abgriff` wählt, wo der Export abgegriffen wird: `produktion` (Vorgabe) ist der Produktions-Master, hinter seinem Fader (`pm/fader`), aber vor dem DJ-Kleber, dem DJ-Master-Fader und dem Set-Limiter, eine Mastering-Kette außerhalb bekommt also das unbegrenzte Signal; `set` ist das Signal, wie der Saal es hört (hinter dem Set-Limiter). Ohne Angabe wählt der Server `produktion`.
Antwort: `{datei, frames, spitze_db, regler_quelle, abgriff, ueber_decke, limiter_db_max, lufs_i, lra, true_peak_dbtp}`. `regler_quelle` ist `kern` (Mixer so, wie der laufende Kern ihn hat) oder `projekt`
(aus der Projektdatei, weil seit dem Start kein Kern lief). `ueber_decke: true` heißt: die Sample-Spitze der Datei liegt über der Decke des Limiters (`kern.toml` `limiter_dbtp`); mit `abgriff: produktion` hätte der Set-Limiter sie abgesenkt, `limiter_db_max` ist seine größte Absenkung in dB während des Renders (0 = griff nie ein). Die Seite zeigt SET LIMITER, wenn der Limiter beim Hören eingreift. Die Lautheit wird an der geschriebenen Datei gemessen; scheitert ffmpeg, sind die drei Lautheitsfelder
`null` und `loudness_fehler` nennt den Grund (die WAV ist trotzdem geschrieben). Ablehnung:

| Code | Grund | Wann |
|---|---|---|
| 400 | `argument_ungueltig`, `export_bereich` | unbekanntes Feld, keine Zahl oder `abgriff` weder `produktion` noch `set`; Bereich kürzer als 1 Beat, länger als 1024 Beats oder vor Beat 0 |
| 409 | `ki_gestoppt`, `kein_projekt`, `transport_laeuft`, `beschaeftigt` | wie oben; `transport_laeuft` heißt: der Transport muss stehen (auch Andreas' Lauf bleibt unberührt) |
| 400 | `zu_gross` | aus dem vorgeschalteten Freeze: eine Surge-Spur reicht über mehr als 256 Beats (erst einzeln einfrieren oder kürzen) |
| 409 | `audio_fehlt`, `kein_kernstand`, `veraltet` | ein Audio-Clip wird noch dekodiert (gleich nochmal); eine Spur braucht einen Freeze, aber der Kern hat nichts gemeldet; während des Exports kamen neue Noten, nichts geschrieben |
| 409 | `deck_laeuft`, `nicht_geladen` | aus dem vorgeschalteten Freeze: Master-Tempo weicht ab und ein Deck spielt; Wiedergabe noch nicht im Kern |
| 409 | `wirt_fehlt` | der Produktions-Wirt arr1 läuft nicht (`djk-start --arr1` oder `djk/start/djk-instrumente --arr1`); nichts gesendet, nichts gespeichert |
| 503 | `kein_kern` | aus dem vorgeschalteten Freeze: beim Angleichen des Master-Tempos meldet sich kein Kern |
| 502 | `freeze_fehler`, `render_fehler` | Freeze oder Render scheiterte; die Antwort nennt, welche Schritte (Freeze als eigener Undo-Schritt) schon gespeichert sind und ob eine Datei entstand |
| 504 | `hand_frist` | kommt vom Werkzeug: nach 80 min keine Antwort, der Lauf kann weiterlaufen |

Stop Cypher hält nur meine Hand an (Entscheidung E-a, Paket 1.18): kein Fader wird gesenkt, nichts fährt bei der Freigabe zurück, was klingt, klingt weiter.
Laufende Rampen und Pläne von mir enden am Ist-Wert (wie `abbrechen`). Auch einen laufenden Transport, den ich gestartet habe, hält Stop Cypher nicht an: er läuft weiter und gehört ab dann Andreas (E-a, 20.10.; Spec 6.37 ist insoweit überholt). Ein Start von mir, der noch auf den Takt oder auf die Tempo-Rampe davor wartet, fällt dagegen (`ok: false`, Quittung 7 `ki_stopp`, nichts wird gestartet); nach der Freigabe starte ich neu. Andreas' Bewegungen an
`spur/<n>/*` landen mit Quelle `andreas` im Projekt und im Verlauf. Projekt löschen gibt es über MCP nicht.

**`proj_warp {clip_id, von_beat?, bis_beat?, bei_beat?, marker_max?, transienten_max?}`** (Paket 1.13) liest den Warp eines Audio-Clips: `warp` ist `null` ohne Warp, sonst `{an, modus, quelle, eins_unsicher, transpose_st, detune_ct, versatz_beats, marker_zahl, marker_gezeigt, weiter_ab_projekt_beat?, tempo {mittel_bpm, min_bpm, max_bpm}, erster_marker {quell_s, beat}, marker: [{quell_s, beat, projekt_beat, segment_bpm}]}`. Die Liste hat höchstens `marker_max` Einträge (1 bis 4096, Vorgabe 200; eine Werkstatt-Karte hat 350 bis 2300, einen je Schlag, Beat 0 ist die erste Eins): `marker_zahl` ist die Zahl im Clip, `marker_gezeigt` die der Antwort, `weiter_ab_projekt_beat` der erste nicht gezeigte Marker (als `von_beat` der nächsten Seite); `tempo` und `erster_marker` fassen den Warp ohne Liste zusammen. `quell_s` ist die Quellsekunde, `beat` der Clip-Beat (0 = 1.1.1 der Quelle), `projekt_beat` die Lage im ersten Durchlauf, `segment_bpm` das Quelltempo des Segments, das am Marker beginnt (am letzten Marker `null`). `bei_beat` (Projekt-Beat) liefert zusätzlich `bei {projekt_beat, quell_s}`: die Quellsekunde, die dort spielt, als Gegenprobe. Ändern geht über `proj_aendern`: `clip_neu` mit `warp: "auto"`, `warp_auto {clip_id}`, `warp_setzen {clip_id, an?, modus?, beats?, transpose_st?, detune_ct?, warp?}` (modus `repitch | beats | complex | tones`; Modus `beats` (Slice 4): Drum-Einheiten, jede startet auf ihrem Beat und behält ihre Form; Parameter `beats {raster: transienten | 1/4 | 1/8 | 1/16 | 1/32, loop: aus | vor | vor_zurueck, huelle: 0..100}`, Vorgabe `transienten`/`vor`/`100`, das ganze Objekt wird gesendet; `beats` folgt dem Tempo wie `repitch` und lehnt `transpose_st`/`detune_ct` ≠ 0 mit `transpose_repitch` ab; `proj_lage` meldet `modus: 'beats'`, `proj_warp` das Objekt `beats`), `clip_aendern {versatz_beats}`; die Quelle des Auto-Warps in dieser Reihenfolge: Werkstatt-Karte der Datei (gleiche sha256, ein Marker je Schlag, Beat 0 = erste Eins, der Clip beginnt dort und reicht bis zum Dateiende), Traktor-Raster, Takte, Bibliotheks-BPM; One-Shots warpen nie. Gibt es kein Tempo, meldet `proj_aendern` `hinweise: [{index, hinweis: "kein_tempo"}]` (`warp_auto` lehnt mit `kein_tempo` ab); ein langer Track (ab 60 s) ohne Karte und ohne Traktor-Raster wird im Hintergrund von der Werkstatt analysiert: `hinweise` nennt dann `analyse_angefordert` (läuft sie schon: `analyse_laeuft`), der Clip wird bei Ankunft umgeschaltet (ein Verlaufseintrag `Auto-Warp`), `proj_lage` listet die laufenden Analysen unter `analyse [{clip_id, status: wartet|laeuft}]`. Eine unbrauchbare Karte meldet `karte_zu_gross` oder `karte_unbrauchbar`, die nächste Quelle greift. `modus` ist `repitch` (die Tonhöhe folgt dem Tempo), `complex` (ganze Tracks, die Tonhöhe bleibt) oder `tones` (Tonales, feineres Korn); `warp_setzen modus` stellt ihn um. `transpose_st` (ganze Halbtöne, −12 bis 24) und `detune_ct` (Cent, −50 bis 50) verstimmen den Clip in `complex` und `tones`, das Tempo bleibt; zusammen −1200 bis 2400 Cent (unter −12 Halbtönen läge der Anschlag im Arrangement zu spät). In `repitch` gibt es sie nicht (`transpose_repitch`): wer von `complex` auf `repitch` wechselt, setzt beide im selben `warp_setzen` auf 0. Eine Änderung wirkt nach einem kurzen Augenblick (die Stimme wird im Warp-Werk neu angesetzt, rund 43 ms plus ein Zyklus) und braucht einen Kern aus demselben Stand wie der Seiten-Server (ein älterer Kern spielt die Verstimmung nicht). Ein Kern ohne Bungee lehnt COMPLEX und TONES beim Laden ab (`warp_maschine_fehlt`). Slice 4: `transienten_zahl` (Treffer des Servers in der Quelle innerhalb des Clips; `null`: Audio noch nicht dekodiert), `transienten` (Quellsekunden der Treffer im Fenster `von_beat`..`bis_beat`, höchstens `transienten_max`, Vorgabe 4096, bis 32768) und `transienten_gezeigt`.

**`proj_stems {clip_id | spur_id, von_beat?, bis_beat?}`** (Paket 1.13 Slice 6) zerlegt einen Audio-Clip (ganz oder `von_beat..bis_beat`, höchstens 600 s Quelle) auf der CPU in Drums, Bass, Other und Vocals. Das Ende ist EINE Projektänderung mit einem Undo-Schritt: das Original im Bereich ist stumm (`stumm` am Clip, `clip_aendern`), vier Spuren in der Gruppe „Stems: <Name>“. Das Werkzeug startet (`POST /proj/stems` → `{auftrag_id, frames}`) und fragt `GET /proj/aktuell?noten=zahl` ab, bis `stems.zustand` nicht mehr `laeuft` ist (`fertig | abgebrochen | veraltet | fehler`, mit `grund` und `text`) oder die Frist (20 min) um ist; dann antwortet es `laeuft` mit `auftrag_id`, ohne Abbruch. Wurde das Projekt gewechselt oder geschlossen (der Lauf bricht dann ab) oder fehlt der Stand, antwortet es `unbekannt` mit `detail`: `proj_lage` prüfen. `proj_lage` trägt dasselbe Feld `stems` (letzter Stand, bleibt nach dem Ende stehen). `proj_stems_abbrechen {auftrag_id}` bricht ab (`kein_auftrag` bei unbekannter Id; `zu_spaet` nur, während der Lauf das Ergebnis übernimmt, danach `kein_auftrag`; Undo nimmt die Stems zurück).

**Marker von Hand** (Paket 1.13 Slice 3b) über `proj_aendern`; Beats sind Clip-Beats (die Beats der Marker, 0 = 1.1.1 der Quelle), jeder Befehl ein Undo-Schritt, `quelle` des Warps wird `hand`: `warp_tempo {clip_id, faktor: 2 | 0.5}` (Beats aller Marker, Versatz, Clip-Länge und Loop mal Faktor; `warp_faktor` außerhalb 15..800 BPM), `warp_marker {clip_id, setze?: [{quell_s, beat?}], loesche?: [beat], verschiebe?: [{beat, neu_quell_s | neu_beat}]}` (löschen, verschieben, setzen; ohne `beat` bekommt ein neuer Marker den Beat des Rasters dort; Gründe `marker_unbekannt`, `warp_marker`, `warp_faktor`), `warp_ab_hier {clip_id, beat, art: gerade | start}` (Warp From Here; `start` setzt den Auto-Warp ab dort neu, `kein_tempo` ohne Quelle), `eins_hier {clip_id, quell_s}` (Set 1.1.1 Here; der Clip beginnt an der neuen Eins, der Versatz bleibt, also rückt der Track am Projekt um die Beats, die die Stelle hinter der alten Eins lag (wie Live), seine Länge folgt; liegt der Track im Bestand des Decks und schreibt dieser Server Korrekturen, geht sie als Zeile `eins` `von andreas` (auch wenn Cypher sendet, Stelle auf den nächsten ganzen Kartenbeat gerundet) in `korrekturen.jsonl`: der nächste Auto-Warp des Tracks beginnt dort, das Deck nach seiner nächsten Fassung; Undo nimmt den Clip zurück, nicht die Zeile; `hinweise`: `eins_gemeldet`, `eins_nur_hier`, `eins_rueckweg_fehler`), `tempo_vom_clip {clip_id}` (Projekttempo = Tempo, bei dem der Clip so lang klingt wie das Stück der Quelle, das er spielt; wie `tempo_setzen`: `deck_laeuft`, `tempo_bereich`). Quantize Audio: `audio_quantisieren {clip_id, raster: 1/4 | 1/8 | 1/16 | 1/32, staerke? 0..1 = 1, von_beat?, bis_beat?}` (`von_beat`/`bis_beat` sind Clip-Beats, die Beats der Marker, 0 = 1.1.1 der Quelle, nicht Projekt-Beats wie bei `proj_warp`; Vorgabe: der Bereich des Clips, bei Loop die erste Kopie; das Raster gilt im Projekt) setzt an jedem Transienten der Quelle (im Bereich) einen Hand-Marker auf das Raster (Stärke 1 genau darauf, 0,5 halber Weg; Marker außerhalb bleiben, innerhalb werden ersetzt; die Länge bleibt; ein Undo-Schritt). Ablehnungen: `transienten_fehlen` (Quelle noch nicht dekodiert), `keine_transienten`, `quantisieren_konflikt` (die neuen Marker lägen nicht streng steigend), `warp_faktor` / `warp_marker` (Grenzen 15..800 BPM, 4096 Marker; nie still gekürzt). Zurücklesen mit `proj_warp`.

**`proj_lautheit {von_beat?, bis_beat?}`** misst die Lautheit je Spur und als Summe, offline und nur auf Anfrage (im Kern läuft keine Messung mit). Der Server rendert jede Spur, die im Bereich etwas spielt,
einzeln (Fader und Pan der Spur aus dem Projekt, dann durch ihre Gruppe und den Produktions-Master, alle anderen Spuren stumm, ohne den Mixer-Zustand des Kerns; Abgriff ist der Produktions-Master, vor dem Set-Limiter) und einmal alle zusammen, dann misst ffmpeg jede WAV. Bereich wie bei `proj_export`
(Vorgabe Loop-Klammer, 1 bis 1024 Beats). Surge-Spuren mit Noten werden vorher eingefroren (Wirt arr1 nötig). Es wird nichts ins Projekt oder in den Export-Ordner geschrieben.
Antwort: `{von_beat, bis_beat, spuren: [{spur_id, nr, name, lufs_i, lra, true_peak_dbtp, spitze_db, stumm, unter_messgrenze}], summe: {lufs_i, lra, true_peak_dbtp, spitze_db, unter_messgrenze, regler_quelle}}`. `lufs_i` ist die integrierte Lautheit,
mit ihr gleicht man eine 808-Kick an einen Bass an (die Spitze täuscht dort). Eine gemutete Spur, eine mit Fader aus oder eine still im Bereich meldet `stumm: true` und `lufs_i: null` (nicht −70); steht irgendeine Spur des Projekts auf Solo, gilt eine Spur ohne Solo wie im Mix als stumm. Eine leise, aber nicht stille Spur unter der Messgrenze
von −70 LUFS (Spitze zwischen −90 und etwa −68 dBFS) meldet `unter_messgrenze: true`, `stumm: false`, `lufs_i: null` (nicht −70,0) und `lra: null`, der True Peak bleibt gemessen. Spuren ohne Inhalt im
Bereich fehlen. Die Summe gleicht `proj_export` desselben Bereichs (Vorgabe `abgriff: produktion`) auf 0,1 LU (`regler_quelle: projekt` bei der Summe, `kern` beim Export). `spitze_db` ist die Sample-Spitze am Produktions-Master, vor dem Set-Limiter.
Ablehnung wie bei `proj_export`, dazu `wirt_fehlt`. Die Frist von 80 min deckt normale Bereiche; im Grenzfall (bis zu 33 Renders (32 Spuren und Summe) zu 1024 Beats bei 60 BPM, jeder am Zeitlimit) erlaubt der Server rund 39,3 h, dann kommt `hand_frist`.

## Track bauen

Befehlsfolge mit den Werkzeugen; die Befehle laufen im Projekt, die Antworten von `proj_aendern` tragen nur `rev`, `kern` und `noten_zahl`, die
Spur-IDs (`s1`, `s2` …) vergibt der Server, deshalb liest `proj_lage` sie vor den Clips. Ein Befehl in der Liste, der scheitert, macht die ganze Liste
unwirksam (alles oder nichts, ein Undo-Schritt). Voraussetzungen: kein Deck spielt (`tempo_setzen` sonst 409 `deck_laeuft`), Stop Cypher steht nicht
(`ki_gestoppt`), und es läuft kein Transport, den Andreas gestartet oder nach Stop Cypher übernommen hat (`proj_neu` sonst 409 `transport_laeuft`).

1. `proj_neu {"name": "Mini"}` legt das Projekt an und öffnet es (Slug `mini`).
2. `proj_aendern` mit `label: "Tracks"` und den Befehlen `tempo_setzen`, drei mal `spur_neu`:

```json
[{"befehl":"tempo_setzen","bpm":128},
 {"befehl":"spur_neu","art":"audio","name":"Kick"},
 {"befehl":"spur_neu","art":"instrument","name":"Bass","geraet":{"art":"intern","name":"rb338"}},
 {"befehl":"spur_neu","art":"instrument","name":"Lead","geraet":{"art":"wirt","name":"surge","slot":1}}]
```

3. `proj_lage` liefert `spuren[].id` und `nr` (hier `s1` Kick, `s2` Bass, `s3` Lead; nicht raten, lesen).
4. `proj_aendern` mit `label: "Clips"`: `clip_neu` mit Noten, `spur_aendern`, `loop_setzen`. Audio nur mit `sha256` aus der Bibliothek (`klaenge`
   sucht One-Shots, `einsatz` muss `sofort` sein; der Kick unten ist der 808-One-Shot des Abnahmetracks vom 20.10.):

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

   `beat` einer Note zählt im Clip, `loop_beats: 1` lässt den Kick jeden Beat neu anschlagen (Clip-Loop bis `laenge_beats`), `ton` ist die MIDI-Nummer (33 = A1).
5. `proj_transport {"aktion":"start","beat":0}` spielt den Loop (Quant 2, wenn ein Deck, eine Loop-Box oder ein Strudel-Strom läuft, sonst sofort); hören mit
   `pegel` oder durch Andreas. Zum Weitermachen `proj_transport {"aktion":"stopp"}`: Freeze und Export brauchen einen stehenden Transport.
6. `proj_freeze {"spur_id":"s3","an":true}` friert die Surge-Spur ein (Echtzeit-Lauf). Der Schritt ist vor dem Export freiwillig: `proj_export` friert
   ungefrorene Surge-Spuren mit Noten selbst ein.
7. `proj_export {}` schreibt den Loop-Bereich (hier Beat 0 bis 8) als WAV nach `~/cypherdj-projekte/mini/export/` und meldet `datei`, `frames`, `spitze_db`,
   `lufs_i`, `lra`, `true_peak_dbtp`.

**Aufnahme in vier Zeilen** (1.8 Slice 1, interner Strom auf eine Audio-Spur):

1. `proj_aendern` mit `spur_aendern {spur_id, arm: true, eingang: {art: "intern", name: "erz/1"}}` (erz/1 ist der Strudel-Kanal).
2. `proj_aufnahme {"aktion":"start","von_beat":0}` armiert den Kern, startet den Transport und nimmt ab dessen Start auf.
3. `warte` oder Musik über `strudel`; der Take ist der interne Strom, bitgleich.
4. `proj_aufnahme {"aktion":"stopp"}` hält den Transport an, schreibt `aufnahmen/take-<kennung>-<spur>.wav` und legt je Spur einen Clip (ein Undo-Schritt); `proj_lage` zeigt den Clip.
   Endet der Transport anders (`proj_transport`, Handtaste, Ende des Arrangements), speichert der Server den Take selbst; `stopp` liefert das Ergebnis dann einmal, danach steht es unter `letzte` in `proj_aufnahme`.

Gemessen 2026-10-20: die Befehlslisten aus 2. und 4. laufen durch `fuehreListeAus` (`djk/oberflaeche/projekt/befehle.ts`) auf einem neuen Projekt ohne Fehler und
ergeben `s1` Kick, `s2` Bass, `s3` Lead, Loop 0..8, Tempo 128; dieselbe Liste mit `spur_id: "s9"` wird mit `spur_unbekannt` abgelehnt (Negativ-Kontrolle).
Die Existenz des `sha256` in der Bibliothek prüft erst der Seiten-Server (`sha_unbekannt`, `nur_live`, `quelle_fehlt`). Nicht in dieser Messung: der HTTP-Weg
und der Export des Mini-Beispiels. Am laufenden Betrieb gebaut ist der Abnahmetrack vom 20.10. über dieselben Routen (3 Spuren, 80 Noten, Export 720000 Frames,
`docs/masterplan/MASTERPLAN.md`, Abschnitt "Abnahme D1"); sein Skript liegt nicht im Repo.

## Vorhören

`hoeren` misst einen Kanal hinter seinem Fader (Ohr, Slice 1): sechs Bänder, Lautheit, Spitze, Überdeckung mit dem
laufenden Master je Band, Pegel-Differenz, EQ-Vorschlag (tief/mitte/hoch in dB) und Basstausch-Hinweis. Nur an einem
**geschlossenen** Deck sinnvoll (der Mess-Abgriff liegt vor dem Fader, ADR 008): `laden` → `deck_start` (Fader bleibt
zu) → `warte 4` (Sätze brauchen ein volles 4-Takt-Fenster) → `hoeren` → `regler` (EQ/Trim, geschlossen erlaubt) →
`warte 4` → `hoeren` erneut (die Messung sitzt nach dem EQ).

`vergleich.trim_vorschlag_db` ist der **absolute** Sollwert für `deck/N/trim` in dB (alter Trim minus Pegel-Differenz, auf ±24
geklemmt; der Mess-Abgriff liegt nach dem Trim, ADR 008), nur am geschlossenen Deck gültig. `trim_unbekannt: true` statt
des Vorschlags: die Seite kennt den alten Trim nicht (nach ihrem Neustart); keiner auch, wenn eine Seite stumm ist.

Seit Slice 3 stellt der Seiten-Server aus dieser Messung je Takt einen Hörschein aus (`urteil` in der `hoeren`-Antwort
und in `lage.decks[].hoerschein`) und schickt ihn bei `urteil: 'ok'` an den Kern. `regler` auf `deck/1`/`deck/2`, das
den Kanal öffnet (trim + fader über −26 dB), hängt dann automatisch `hoerschein: hs_id` an — kein eigener Aufruf
nötig, nur warten, bis `hoeren` `urteil: 'ok'` zeigt (`sync_ms`/`deck_gegen_deck_ms` stehen nur als Grund
`sync_unvalidiert:<ms>` dabei, ohne Urteilswirkung, Rev. 4). Ohne gültigen Schein bleibt es bei 409 `kein_hoerschein`,
jetzt mit `urteil` und `gruende` des letzten Scheins im Körper.

## Grenzen (wer sie hält)

| Grenze | gehalten von |
|---|---|
| Stop Cypher blockt Regler-, Deck-, Loop-Befehle | Kern (`ki_gestoppt`); FX und Strudel prüft der Seiten-Server (Kern nimmt `/k/fx` auch gestoppt an) |
| Release hebt Stop Cypher auf | Seiten-Server schickt bei der Taste `freigabe` `/k/ki/frei` (Review B2) |
| Crossfader, Master, PFL, Cue, Bus-Fader, Kanal-Ziel sind Andreas' Hand | Kern (`nur_hand`) |
| Andreas' Griff an einem Regler bricht meine Rampe ab / sperrt ihn für mich | Kern (Quittung 7 `hand`, `regler_beim_menschen`) |
| Geschlossenen Kanal öffnen (trim + fader > −26 dB, §1.6; Decks; Strudel-Kanäle `erz/*` sind seit 2026-09-29 frei, Andreas: „ja sperre kann für strudel kanäle fallen“, Kern e9baf64; **Box-Kanäle `pad/*` sind frei, solange die Box meinen eigenen Mitschnitt trägt**, ein fremder Loop bleibt `kein_hoerschein`) | **Kern** (I3a, `PrueferI3::vor_teilstart`, Quittung 6 `kein_hoerschein`; Ohr T14, kern.cpp: `Stellwerk(uhr_, &pruefer_)`) UND Seiten-Server (409 `kein_hoerschein` mit `urteil`/`gruende` des letzten Scheins, sonst mit gültigem Hörschein aus `hoeren`, `/k/teil` mit `hoerschein: hs_id`); Andreas (Quelle `andreas`) nimmt der Kern aus (§17 „die Hand wird nie blockiert") |
| Sprung / Hotcue spielen / Start auf offenem Deck, Box laden/start auf offener Box (Ausnahme seit 2026-10-05: eigener Master-Mitschnitt, `quelle: mitschnitt`) | Seiten-Server (409 `ziel_ungehoert`, I3d) |
| Fremdes Material (alles außer meinem Mitschnitt) in eine Box laden/starten, solange meine Fader-/Trim-Rampe auf `pad/<n>/` läuft; `loop_nach_box` zusätzlich auch auf eine offene Box (die Prüfung gilt sonst nur im Moment der Anfrage) | Seiten-Server (409 `box_offen_oder_faehrt`) |
| FX, Strudel nur bei AUTO an | Seiten-Server / djk-muster (409 `auto_aus`) |
| AUTO-Schalter, Grid (Deck und Loop), `/griff`, `/taste` | Seiten-Server (403) |
| FX-Routing (Insert oder Post Fader): Andreas' Taste, ich kann es nicht schalten; ich höre den Effekt im Vorhören (`hoeren`) nur, wenn er auf Insert steht | Seiten-Server (403 `nur_andreas`) UND Kern (`nur_hand`) |

Die Quelle ist ein Etikett auf 127.0.0.1, keine Sicherheitsgrenze (Review M6): wer ohne Kopf schickt, gilt als Andreas.
Bis die Scheibe „Ohr“ Hörscheine ausstellt und den Prüfer in den Kern bringt, bereite ich vor (laden, hinter dem
geschlossenen Fader synchron starten, springen, Loops, Pads, L1/L2, EQ/Filter auf offenen Kanälen, leiser machen) und
mische nicht selbst ein.

## Automationsspuren (Studio S6, 2026-09-29)

Eine Spur ist eine JSON-Datei mit Fahrten auf dem Takt-Raster, gezählt ab der nächsten Takt- (`--ab takt`, Vorgabe)
oder Phrasen-Eins (`--ab phrase`). Beispiele in `docs/beispiele/spuren/`.
Eine Fahrt ohne `form`: am Kern `s`, am Wirt `linear` (die Seite schreibt bei Rampen `form` immer aus).

    djk/werkzeuge/djk-spur [--instanz f] start docs/beispiele/spuren/ende-bass.json [--ab phrase]
    djk/werkzeuge/djk-spur [--instanz f] show      # laufende Spuren, mit abgelehnten Teilen
    djk/werkzeuge/djk-spur [--instanz f] stop ende-bass

| Ziel | Wirkung | Weg |
|---|---|---|
| Regler-Pfad aus SCHNITTSTELLEN §1.5 (`erz/2/filter`, `erz/3/fader`, `deck/1/eq/tief` …): `nach` in seiner Einheit, `takte` (0 = setzen), `form` `s` (Vorgabe) oder `linear` | beatgenau im Kern, Tempowechsel dehnt mit; Griff am Regler bricht ab | `/k/teil`, Plan `spur:<name>` |
| `wirt:bass/<parameter>`, `wirt:melodie/<parameter>` (stufenlose Surge-Parameter, `surge_bereiche.json`), optional `von` | Start auf die Takt-Eins (gemessen 4 ms), Dauer beim Start in Sekunden umgerechnet: ein Tempowechsel danach dehnt NICHT mit | Wirt `fahre` mit `ab`, `spur` |
| `strom:1..3` mit `muster` | greift ab der Takt-Eins der Fahrt (Server schreibt 2 Beats vorher; bei `ab_takt 1` und nahem Anker kann es einen Takt zu spät greifen) | wie das Strudel-Feld, AUTO-Riegel gilt |

Ausblenden: der Kern fährt Fader linear in dB. Eine Rampe bis −200 ist nach einem Viertel der Zeit schon unhörbar;
hörbar ausblenden heißt: bis −60 `linear`, danach −200 setzen (so `aus-bass-4.json`, gemessen: 198 ms hart gegen
4194 ms mit der Spur, Probe A). Cyphers `abbrechen` trifft auch Cyphers Spuren; Andreas' Spuren (ohne Kopf) nicht.
Stand nach der Abschluss-Review: Stop Cypher bricht Cyphers Spuren sofort ab (Kern, Wirt, Muster); AUTO aus auf einem
Strom weist Cyphers Spuren und `/regler` auf `erz/<n>`, `wirt:<gruppe>`, `strom:<n>` mit 409 `auto_aus` ab; Spuren
überstehen einen Neustart des Seiten-Servers (`spuren.json` neben den Wirt-Sockets); Muster-Fahrten folgen dem Kern-Beat,
auch nach einem Tempowechsel; `djk-spur start` endet mit Rückgabe 1, wenn ein Teil abgelehnt wurde, und nennt ihn
(`part <teil> <pfad> rejected: <grund>`); ich kann Andreas' Spuren nicht stoppen (403 `nur_andreas`).

## Stand 2026-10-05 ()

- **Tempo:** Werkzeug `tempo {bpm 60..200}` (`POST /tempo`): 4-Beat-Rampe ab dem nächsten Takt; Stop Cypher hält es (409 `ki_gestoppt`). Loop-Boxen, REC und Strudel folgen; Decks spielen nur bei 128, der Kern lehnt den Wechsel bei laufendem Deck ab (`kein_stretcher`), und ein Deck startet nicht, solange eine Tempo-Rampe aussteht.
- **Box-Fader/Trim (`pad/*`):** frei für eigene Mitschnitte (Seite stellt für die Box keinen Hörschein aus, Glanz 1.3); eine Box mit fremdem Loop bleibt 409 `kein_hoerschein`. Fremdes Material: `box laden`/`start` auf eine OFFENE Box → 409 `ziel_ungehoert`; bei laufender eigener Fader-/Trim-Rampe auf der Box → 409 `box_offen_oder_faehrt`; `loop_nach_box` (Deck-Schnitt) auf eine offene Box oder bei laufender Rampe → 409 `box_offen_oder_faehrt`. Automationsspuren (`spur`) öffnen Boxen weiterhin nicht.
- **Quittung lesen, nicht nur HTTP 200:** `/regler` antwortet 200 auch bei Kern-Ablehnung; maßgeblich ist `quittung.status` (6 = abgelehnt, `grund`).
- **Überlappung:** überlappt ein neuer Cypher-Teil mit einem eigenen offenen Teil desselben Pfads, schiebt die Seite ihn hinter das Fahrtende; die Antwort trägt `verschoben_auf` (Beat). Ablehnungen genau am Startbeat erscheinen dann nicht in der Antwort, nur in `lage` (`quittungen`). Andreas' Teile werden nie verschoben.
- **Taube Felder:** `studio` zeigt `status.taub` (Strudel-Felder des Musters, die hier nicht klingen: `cutoff` = lpf, `hcutoff` = hpf, `room`, `delay`, `fmi` …). Untergrenze, gültig ab `status.taub_muster == status.nr`; später gehörte Felder kommen dazu. Nicht darauf bauen, Klangfarbe über `klang`.
- **loop_klang:** Seite bekommt `--kit <drums-kit>` von djk-start; vorher rechnete sie gegen battery und meldete „keine freie Note“. Kit-Grenze 10 s je Loop (bei 128 höchstens 16 Beats).
- **FX-Beats:** nur 0.25, 0.5, 1, 2, 4, 8, 16 (0.75 → 400 `beats`). Arten: 1 Echo, 2 Flanger, 3 Phaser, 4 Filter, 5 Reverb (beats = Ausklingzeit, param1 = SIZE), 6 Delay (eine Wiederholung, param1 = TONE), 7 Ping Pong (param1 = Rückkopplung), 8 Trans (param1 = DUTY), 9 Roll, 10 Slip Roll (nimmt beim BEAT-Wechsel neu auf), 11 Vinyl Brake (beats = Bremsdauer), 12 Spiral (param1 = Rückkopplung, Tonhöhe gleitet beim BEAT-Wechsel).
