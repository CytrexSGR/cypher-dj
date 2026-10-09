# djk-hand: Cyphers Hand an djk (MCP, stdio)

Plan `docs/superpowers/plans/2026-09-28-djk-hand-mcp.md` (Rev. 2 nach Review), Stand `docs/architektur/stand/hand-mcp.md`.

    claude mcp add --scope user djk-hand -- node /path/to/cypher-dj/djk/hand/hand.ts --seite http://127.0.0.1:47300

Prüfinstanz i: `--seite http://127.0.0.1:56300`. Jeder Aufruf geht als HTTP an den Seiten-Server mit dem Kopf
`x-djk-quelle: cypher`; der Server setzt die Quelle `cypher` in jeden Kern-Befehl, Cyphers Befehle tragen `plan: cypher`.

## Werkzeuge (37)

DJ: `lage` · `bestand` · `laden` · `deck_start` · `deck_stopp` · `sprung` · `loop` · `pad` · `loop_nach_box` · `box` ·
`regler` (Rampe über Takte) · `fx` · `fx_zuweisung` · `abbrechen` · `tempo` (Decks folgen seit 2026-10-06: Varispeed, dann Tausch auf eine Fassung im neuen Tempo, ADR 028) · `warte` · `hoeren`. Dazu die Studio-Werkzeuge
unten und die Mediathek (`bibliothek` · `vorbereiten` · `sets` · `set_zeige` · `set_lege` · `set_vorbereiten`) sowie `instrumente`. `instrumente {melodie: "fluegel"}` legt einen gesampelten Flügel (Ableton Core Library,
4 Anschlagstufen, Carla-SFZ) auf MELODY statt Surge, `"surge"` zurück (2026-10-06).

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
| `pegel` | `GET /pegel?sek=1..10` (ungedrosselter Puffer vor der SSE-Drossel) | lesend |
| `klang` | `POST /klang` (spawnt `djk/wirte/carla/djk-klang`; `fahre` direkt an den Wirt mit Spur `klang-<gruppe>`) | AUTO Strom 2 (bass) / 3 (melodie), Stop Cypher, `fremdePost`; `zeige`/`liste` frei; Werte mit `-` vorne 400 |
| `loops` | `GET /loops` | lesend |
| `rec` | `POST /loop {aktion:rec}`, wartet auf die Kern-Quittung | Kern: laufende Tempo-Rampe (`ausserhalb_bereich`), Stop Cypher, Überlappung; jedes feste Tempo geht (Plan Tempo-Folge) |
| `loop_klang` | `POST /loop {aktion:kit}` | AUTO Strom 1, Stop Cypher |
| `spur` · `spur_stopp` · `spuren` | `POST /spur {spur:{name,fahrten},ab}` · `POST /spur/stopp` · `GET /spur` | wie Automationsspuren unten |

`/lage` trägt zusätzlich `studio: {stroeme:[{strom, autonom, von, text_kurz}], klang:{bass, melodie}}`
(`klang` = Name aus `wirt-<g>.json`; nach `setze` „edited"). `abbrechen` und Stop Cypher halten auch `klang fahre`.

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
- **FX-Beats:** nur 0.25, 0.5, 1, 2, 4, 8, 16 (0.75 → 400 `beats`). Arten: 1 Echo, 2 Flanger, 3 Phaser, 4 Filter.
