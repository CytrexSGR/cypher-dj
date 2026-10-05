# Cypher-DJ: Schnittstellen (Vertrag zwischen den Bausteinen)

*Stand 2026-09-23, nach der Kritik-Runde (ARCHITEKTUR „Kritik und Korrekturen“), Vertragsversion **1** (`protokoll = 1`; die
Korrekturen dieser Runde bleiben in Version 1, weil noch nichts gebaut ist). Grundlage: `ARCHITEKTUR.md` und `adr/`.
Dieser Vertrag ist verbindlich für alle Sessions: Namen, Adressen, Typen, Felder, Einheiten und Politiken gelten
wörtlich. Wo eine Zahl gesetzt und nicht gemessen ist, steht das dabei; sie ist trotzdem verbindlich, bis eine Messung
sie ändert.*

**Regeln für Änderungen.** OSC-Nachrichten haben feste Typ-Zeichenketten; ein neues Feld heißt neue Adresse oder
neue Vertragsversion. JSON-Nachrichten dürfen neue **optionale** Felder bekommen (Empfänger ignorieren Unbekanntes);
neue Pflichtfelder nur mit Versionssprung. Jede Änderung bekommt eine Zeile im Änderungsprotokoll (§20); betrifft sie
Semantik, auch ein ADR. Die maschinenlesbare Fassung baut **Werkstück V0** vor K1 und L1 (§19.0): genau eine Quelle
`~/cypher-dj/djk/vertrag/osc.json`, daraus erzeugt `osc_adressen.h`/`.ts`, dazu JSON-Schemas und Golden-Folgen. V0 hat
einen Eigentümer; K1 und L1 lesen `djk/vertrag/` nur und ändern ihn nie selbst. Ein Test prüft, dass `osc.json` mit
diesem Text übereinstimmt.

---

## 1. Grundbegriffe und Einheiten

### 1.1 Zeit

| Größe | Typ | Einheit, Bedeutung |
|---|---|---|
| Abtastrate | fest | 48 000 Hz, überall |
| `sample` | int64 | Kern-Samplezähler. 0 = erster Zyklus nach dem ersten Kern-Start ohne Anker oder nach `/k/set/neu`. Läuft über Kern-Neustarts weiter (ADR 004: der neue Kern setzt aus dem Anker fort) |
| `beat` | float64 | Viertel seit Beat 0 der Zeitachse; Funktion von `sample` über die Tempo-Karte (§1.3) |
| Takt-Nr | int | `floor(beat / 4) + 1` (1-basiert; V1 nur 4/4) |
| Schlag im Takt | int | `floor(beat mod 4) + 1` (1 bis 4) |
| Phrase-Nr | int | `floor(beat / 32) + 1` (8 Takte je Phrase) |
| Adresse „Takt.Schlag“ | Text | nur für Menschen, Ansage-Zeile und Spielzettel, z. B. `17.3`; Maschinen benutzen `beat` |
| `quell_beat` | float64 | Beat im Material, 0 = erster erkannter Schlag der Fassung (§13). Die erste Takt-Eins liegt bei `erste_eins_quell_beat` (0 bis 3, §13.2); Takte, Phrasen, Struktur, Hotcue-Vorschläge und Rückfall-Loop im Material zählen ab dort (A13 „Takt-Eins“) |
| Dauer | float64 | in Beats (`dauer_beats`), ≥ 0 |
| `mono_ns` | int64 | `CLOCK_MONOTONIC` in ns; nur für Diagnose und Hochrechnung, nie als Befehlszeit |
| Zyklus | | ein Audioblock; Quantum V1 = 256 Samples = 5,333 ms (ADR 003) |

Umrechnung Beat → Sample: `ziel_sample = llround(sample_at(beat))` (Runden auf die nächste ganze Zahl, bei ,5 vom
Nullpunkt weg; so in `proben/02-uhr-sync-planer/kern/uhrkern.cpp`). Ein Ereignis wirkt ab genau diesem Sample, auch
mitten im Block.

### 1.2 Werte

| Größe | Typ | Einheit, Bereich |
|---|---|---|
| Pegel | float32 | dB; **stumm = −200,0**; jeder Wert ≤ −120,0 gilt als stumm |
| Filter | float32 | −1,0 (Tiefpass ganz zu) bis +1,0 (Hochpass ganz zu), 0 = trocken |
| Crossfader | float32 | −1,0 (nur Seite A) bis +1,0 (nur Seite B) |
| Schalter | float32 | 0,0 oder 1,0 |
| Tempo | float64 | BPM |
| Notenwert | float32 | Beats (0,75 = punktierte Achtel) |
| Rückkopplung | float32 | 0,0 bis 0,95 |

**Rampen in dB von oder nach „stumm“** interpolieren von bzw. bis −60 dB und setzen unterhalb davon auf −200 dB
(gesetzt; eine lineare dB-Rampe ab −200 wäre die halbe Dauer unhörbar).

### 1.3 Tempo-Karte (normativ)

Segmente `{s0: int64 Start-Sample, b0: float64 Start-Beat, bpm0: float64, k: float64 (BPM je Sekunde), dauer_s:
float64 (∞ für das letzte)}`; V1 nur **linear in der Zeit** (konstant ist `k = 0`). Wird `s0` eines neuen Segments
auf ganze Samples gerundet, liegt sein `b0` auf der durchgehenden Kurve an genau diesem Sample (nicht am bestellten
Beat); nur so treffen die Golden-Werte unten und `uhr_golden` die Grenze 10⁻⁶. Formeln (02 §3.1, gemessen):

```
beat(s)   = b0 + (bpm0·dt + k·dt²/2) / 60                          dt = (s − s0) / 48000
sample(b) = s0 + 48000 · 120·(b − b0) / (bpm0 + sqrt(bpm0² + 120·k·(b − b0)))
bpm(s)    = bpm0 + k·dt
```

Eine Rampe `(ab_beat, ziel_bpm, dauer_beats)` ab Tempo `bpm0` hat `T = dauer_beats·60 / ((bpm0 + ziel_bpm)/2)` und
`k = (ziel_bpm − bpm0) / T`. Die Karte hält höchstens **64 Segmente**; Segmente mit Ende vor dem aktuellen Zyklus
werden verworfen. Andreas' Tempo-Regler ist **ein Hand-Segment**, das je Zyklus neu gesetzt wird (belegt kein neues
Segment je Zyklus). **Das Hand-Segment springt nie:** jede Änderung seines Zielwerts (Encoder-Raste, `tempo_basis`)
fährt es als lineare Rampe über 1 Beat vom Ist-Tempo zum neuen Zielwert; eine neue Raste während der Rampe setzt ein
neues Ziel ab dem Ist-Wert. Grund: die einzige native Tonhöhenmessung eines Faktorsprungs zeigt 128 Null-Samples
(ERGEBNIS §2.6); ob kleine Faktorwechsel das auch tun, ist ungemessen (M4). S-förmige Ecken (04 §4.5) sind **nicht** Teil von V1 (Restspitze an linearen Ecken −107,3 dBFS,
unter der 16-bit-Stufe von −96,3 dBFS; spätere Segmentart 2).

**Golden-Werte** (jede Uhr-Implementierung muss sie treffen; berechnet mit den Formeln oben, Abweichung ≤ 10⁻⁶
Samples vor dem Runden):

| Fall | Ergebnis |
|---|---|
| konstant 128 ab Sample 0: `sample(64,0)` | 1 440 000,000 |
| dieselbe Karte: `beat(1 440 000)` | 64,000000 |
| Rampe 128 → 132 ab Beat 128 über 32 Beats: Start | Sample 2 880 000,000; `T` = 14,769231 s; `k` = 0,270833 BPM/s |
| dieselbe Rampe: `sample(144,0)` | 3 237 188,004 (gerundet 3 237 188); `bpm` dort 130,015384 |
| dieselbe Rampe: `sample(160,0)` (Ende) | 3 588 923,077 (gerundet 3 588 923) |
| danach konstant 132: `sample(192,0)` | 4 287 104,895 (gerundet 4 287 105) |
| Takt/Schlag/Phrase für Beat 0 / 3,5 / 64 / 127,99 / 128 | 1.1 P1 / 1.4 P1 / 17.1 P3 / 32.4 P4 / 33.1 P5 |

### 1.4 Kennungen

| Kennung | Form | Wer vergibt |
|---|---|---|
| `id` (Befehl) | int64, je Absender streng steigend | jeder Absender; Zählerstart beim Prozessstart = `mono_ns` (so bleibt er nach Neustarts steigend) |
| `quelle` | `andreas` \| `cypher` \| `leitstand` \| `erzeuger` \| `werkstatt` \| `pruefstand` | Absender; Andreas' Makros über den Leitstand tragen `andreas`, Cyphers Wahlen `cypher` |
| `material_id` | 16 Hex-Zeichen (Kleinbuchstaben) = erste 16 Zeichen des SHA-256 der Quelldatei | Werkstatt |
| `plan` | `[a-z0-9_-]{1,24}`, z. B. `p17` | Leitstand |
| `hs_id` (Hörschein) | `[a-z0-9_-]{1,24}`, z. B. `h12` | Leitstand |
| `auftrag_id` | `[a-z0-9_-]{1,32}` | Leitstand |
| OSC-Zeichenketten | ASCII, höchstens 47 Bytes | alle |

### 1.5 Kanäle und Regler-Pfade

Kanäle: `deck/1` bis `deck/4` (Andreas sagt A = 1, B = 2), `erz/1` bis `erz/8` (Erzeuger und Instrumente),
`pad/1`, `pad/2` (Einzelschüsse; seit MVP 2 die Loop-Boxen L1 und L2, ADR 025), `bus/1` bis `bus/4` (Gruppenbusse, A17), `master`, `cue`. Jeder Kanal außer
`master`/`cue` hat denselben Kanalzug; ein Bus hat keinen `ziel`-Regler (er geht immer auf den Master).

| Pfad (`<k>` = Kanal) | Einheit | Bereich | Vorgabe | Schaltrampe bei `dauer_beats = 0` | Wer darf |
|---|---|---|---|---|---|
| `<k>/fader` | dB | −200 bis 0 | −200 (nach Laden immer) | 10 ms | alle; `bus/<n>/fader` nur Hand |
| `<k>/trim` | dB | −24 bis +24 | beim Laden `ziel_lufs` − `lufs_integriert` der Fassung (§2.1, §13.2), auf den Bereich begrenzt; Busse 0 | 10 ms | alle |
| `<k>/eq/tief`, `/eq/mitte`, `/eq/hoch` | dB | −200 bis +6 | 0 | 10 ms | alle |
| `<k>/kill/tief`, `/kill/mitte`, `/kill/hoch` | Schalter | 0/1 | 0 | 5 ms, zweite Ordnung | alle |
| `<k>/filter` | −1 bis +1 | | 0 | 20 ms Glättung | alle |
| `<k>/send/1` bis `/send/4` | dB | −200 bis 0 | −200 | 10 ms | alle |
| `<k>/ziel` | 0 = `master`, 1 bis 4 = `bus/<n>` | | 0 | 10-ms-Blende | nur Hand |
| `deck/<n>/stem/drums`, `/stem/bass`, `/stem/vocals`, `/stem/other` | dB | −200 bis +6 | 0 | 10 ms | alle; nur bei mit Stems geladenem Deck (§4.4), sonst `abgelehnt`, Grund `keine_stems` |
| `<k>/xseite` | 0 = A, 1 = durch, 2 = B | | 1 | sofort | nur Hand |
| `<k>/pfl` | Schalter | 0/1 | 0 | sofort | nur Hand (und Taste „Cypher hören“) |
| `xfader` | −1 bis +1 | | 0 | 10 ms | nur Hand |
| `master/pegel` | dB | −200 bis 0 | 0 | 10 ms | nur Hand |
| `master/kleber` | 0 bis 1 | | 0 | 10 ms | nur Hand |
| `cue/mix` | −1 (nur Cue) bis +1 (nur Master) | | −1 | 10 ms | nur Hand |
| `cue/pegel` | dB | −200 bis 0 | −12 | 10 ms | nur Hand |
| `cue/split` | Schalter | 0/1 | 0 | sofort | nur Hand |
| `fx/1/notenwert`, `fx/2/notenwert` | Beats | 1/32 bis 4 | 0,75 | sofort mit Überblendung (04 §3.3) | alle |
| `fx/<n>/rueckkopplung` | 0 bis 0,95 | | 0,5 | 10 ms | alle |
| `fx/<n>/rueckweg` | dB | −200 bis 0 | 0 | 10 ms | alle |
| `duck/tiefe` | dB | −24 bis 0 | 0 | 10 ms | alle |
| `duck/release` | ms | 50 bis 600 | 200 | sofort | alle |

`duck/*` (K2): der Kern senkt erz/2 und erz/3 ab jedem gespielten Kit-Klang `bd:*`, am Sample des Ereignisses (Sidechain, ohne Verzug).

`master/kleber` (K2): Schwelle des Summen-Kompressors 2:1 (Attack 30 ms, Release 200 ms): 0 = aus, 1 = −30 dB auf dem Detektor |L|+|R|, linear in dB (Schwelle = +6 − 36·Wert dB; 1/3 = −6 dB); voll nass, keine Parallelmischung. Er wirkt nach dem Abgriff der Master-Summe (Kanal 14), vor `master/pegel`: der Ohr-Abgriff sieht ihn nicht. Beim Zurückdrehen auf 0 klingt er ohne Stufe aus (der Gain erholt sich über den Release).

`<k>/send/2` (nach dem Fader) speist den Hall, `fx/2/rueckweg` führt ihn in die Master-Summe; `fx/<n>/notenwert`, `fx/<n>/rueckkopplung` und die Rückwege fx/1, fx/3, fx/4 sind ohne Wirkung.

`fx/1` ist das beatsynchrone Echo (Mischform), `fx/2` der Hall, `fx/3` und `fx/4` sind Rückwege für Send-Effekte aus
Plugin-Wirten (ab Scheibe 8, bis dahin stumm; für sie gilt nur `fx/<n>/rueckweg`). Ein Befehl mit Quelle ungleich `andreas` an einen Pfad „nur Hand“ wird mit Grund `nur_hand` abgelehnt.

**Routing V1 (A17, Entwurf):** jeder Kanal geht über `<k>/ziel` direkt auf den Master oder auf einen der vier
Gruppenbusse; ein Bus hat den vollen Kanalzug und geht auf den Master; vier Sends je Kanal nach dem Fader auf `fx/1`
bis `fx/4`. Der Mixer im Kern ist eine **Zuweisungstabelle**, keine Kette fester Pfade: K1 darf Busse und
`fx/3`/`fx/4` in Scheibe 1 noch leer lassen, die Tabelle nicht. Frei verschaltbare Inserts kommen mit den Wirten
(Scheibe 8, ADR 009); ob Andreas mehr Routing will (Matrix, Subgruppen in Subgruppen), ist Frage 5 in ARCHITEKTUR §13.

### 1.6 Offen, hörbar und „Tief offen“ (gesetzt, kalibriert in M18)

- **Kanalpegel(k)** = `<k>/trim` + `<k>/fader` (dB; 0 dB heißt: der Kanal klingt mit `ziel_lufs`).
- **offen(k)** ⇔ Kanalpegel(k) > **−26 dB** (linear 0,05; Schwelle aus 09 §6). `offen` hängt **nicht** an Bus,
  Crossfader oder Master: ein Plan, der einen Fader hinter geschlossenem Crossfader oder Bus aufzieht, öffnet den
  Kanal. **I3 prüft `offen`** (§17).
- **Effektiver Kanalpegel** = Kanalpegel(k) + (bei `ziel` = `bus/<n>`: `bus/<n>/fader` + Crossfader-Gewicht der Seite
  des Busses; sonst Crossfader-Gewicht der eigenen Seite) + `master/pegel`.
- **hörbar(k)** ⇔ effektiver Kanalpegel > −26 dB **und**, bei Decks, das Deck läuft (Status 2 bis 5 in §5.5): ein
  angehaltenes, zu Ende gelaufenes oder nie gestartetes Deck ist nie hörbar. `hörbar` zählt für I1, I2 und den
  Frist-Wächter.
- **tief_offen(k)** ⇔ hörbar(k) ∧ `kill/tief` = 0 ∧ `eq/tief` > **−12 dB** (bei Decks mit Stems zusätzlich
  `stem/bass` > −12 dB).

---

## 2. Transporte, Adressen, Pfade

| Weg | Transport | Adresse | Richtung | Formate |
|---|---|---|---|---|
| Befehle an den Kern | OSC 1.0 über UDP, nur Loopback | `127.0.0.1:47100` | Leitstand, Erzeuger, Prüfstand → Kern | §4 |
| Kern-Ausgaben | OSC über UDP | an jeden Abonnenten `127.0.0.1:<port aus /k/hallo>` | Kern → Abonnenten | §5 |
| Vorgabe-Ports der Abonnenten | UDP | Leitstand 47110, Erzeuger 47120, Analyse 47130, Prüfstand 47140 | | §4.1 |
| Notbahn-Meldungen | OSC über UDP | an 47110 und 47140 | Notbahn → Leitstand, Prüfstand | §5.10 |
| Hand | JACK-MIDI | `cypherdj-kern:hand_in` (Eingang), `cypherdj-kern:hand_led` (Ausgang) | Controller ↔ Kern | §7 |
| MIDI an Klangerzeuger und Geräte | JACK-MIDI mit Sample-Versatz | `cypherdj-kern:midi_aus_1` bis `_4`, später `cypherdj-kern:clock` | Kern → Wirte, Geräte | §4.8, §7 |
| Audio Kern → Notbahn | Shared Memory, SPSC-Ring | `/dev/shm/cypherdj/bus` | Kern → Notbahn | §6.1 |
| Audio Notbahn → Interface | JACK-Audio | `cypherdj-notbahn:master_L/R` → Interface 1/2, `cue_L/R` → 3/4 | | §8 |
| Hüllkurven Kern → Analyse | Shared Memory | `/dev/shm/cypherdj/huellen` | Kern → Analyse | §6.2 |
| Neustart-Zustand | Shared Memory, Seqlock | `/dev/shm/cypherdj/zustand` | Kern → Kern (nächste Generation), Prüfstand | §6.3 |
| Arbeitsbestand, Kiste | Dateien in tmpfs | `/dev/shm/cypherdj/material/<material_id>/`, `/dev/shm/cypherdj/kiste.json` | Leitstand → Kern | §6.4, §6.5 |
| Leitstand-Hub | WebSocket, JSON-Text-Frames | `ws://127.0.0.1:47200/` | Leitstand ↔ Spieler-Treiber, MCP, Analyse, Werkstatt, Ansage, Anzeige, Prüfstand | §9 |
| Rechner | Unix-Socket, JSON-Zeilen | `$XDG_RUNTIME_DIR/cypherdj/rechner.sock` | Leitstand → Rechner | §11 |
| Cypher | MCP über stdio | `cypherdj-mcp` als Kind der Spieler-Sitzung | Spieler ↔ MCP (dann WS zum Leitstand) | §10 |
| djk cues: Vorhörer (Befehle + Meldungen) | OSC 1.0 über UDP, nur Loopback | `127.0.0.1:47740` (+1000·k je Instanz, `CYPHERDJ_INSTANZ`) | Cue-Server (djk/cues) ↔ Vorhörer (djk/vorhoerer) | docs/architektur/stand/vorhoerer.md |
| Generierung | HTTP | ComfyUI der GPU-Maschine, Port 8288 (Adresse aus `~/.config/cypherdj/werkstatt.toml`, Schlüssel `comfy_musik_url`) | Werkstatt → GPU-Maschine | §12.3 |
| Bestand | Dateien | `~/cypher-dj/bestand/` | Werkstatt schreibt, alle lesen | §13 |
| Set-Journal, Aufnahme | Dateien | `~/cypher-dj/sets/djk/<JJJJ-MM-TT_hhmm>/` | Leitstand, Aufnahme | §15 |
| Konfiguration | Dateien | `~/.config/cypherdj/` (`kern.toml`, `leitstand.toml`, `werkstatt.toml`, `controller/<geraet>.json`); die Notbahn liest keine Datei, sie bekommt alles als Aufrufparameter aus ihrer Unit (§8) | | §2.1 |

UDP-Pakete sind höchstens 1 400 Bytes groß (bleibt unter der Loopback-MTU; Erzeuger-Bundles teilen sonst in mehrere
Fenster).

### 2.1 Konfigurationsschlüssel (Schema; Vorgaben gesetzt, nicht gemessen, wo nicht anders vermerkt)

Unbekannte Schlüssel sind ein Startfehler (Tippfehler fallen sofort auf). Jede Datei beginnt mit `version = 1`.

| Datei | Schlüssel | Typ | Vorgabe | Bedeutung |
|---|---|---|---|---|
| `kern.toml` | `start_bpm` | float | 128.0 | Tempo einer neuen Zeitachse ohne Anker (§1.1) |
| | `filter_guete` | float | 0.707 | Güte des DJ-Filters, 0,5 bis 4 (A27, 04-Nachtrag; über 4 gesperrt, bis Andreas gehört hat) |
| | `hoerschein_pflicht` | bool | true | schaltet `PrueferI3` an (I3a, §17); Ohr Task 13 |
| | `udp_port` | int | 47100 | Befehle (§2) |
| | `arbeitsbestand` | Pfad | `/dev/shm/cypherdj/material` | §6.4 |
| | `speicher_budget_mib` | int | 3800 | gesperrtes Budget unter der 4-GiB-Grenze (10 Probe d), Entladen nach ADR 015 |
| | `controller_geraet` | str | `""` | Name der Mapping-Datei unter `controller/` |
| | `ziel_lufs` | float | −16.0 | Lautheit je Kanal bei Fader 0 dB (Trim beim Laden, §1.5); Vorgabe zum Nicken, am Ohr ungemessen |
| | `hoerbar_db`, `tief_offen_db` | float | −26.0, −12.0 | §1.6, M18 |
| | `max_stretcher` | int | 4 | §4.4, ADR 020 |
| | `stretcher_threads` | int | 2 | Arbeits-Threads für R3; höchstens 2 R3 je Thread (01 NP K1), M3 [VORLÄUFIG, 2026-09-23 13:3x: die Nachprüfung zu Dossier 01 misst R3 in FIFO-Arbeits-Threads mit Vorlauf mit 8 je Thread ohne Unterlauf (16 auf 2 und 32 auf 4 Threads, Grenze erst bei 16 je Thread; SCHED_OTHER statt FIFO: 23 Unterläufe). Die Grenze entscheidet M3 (Scheibe 30).] |
| | `limiter_dbtp` | float | −1.0 | Master-Limiter |
| | `pruefmodus` | bool | false | erlaubt `/test/*` (§19.0) |
| | `hand_osc` | bool | false | erlaubt `/test/hand` auch ohne `pruefmodus` (Hand-Weg der Oberfläche, Scheibe 35, §19.0); alle anderen `/test/*` bleiben am `pruefmodus` |
| `leitstand.toml` | `ws_port`, `abo_port` | int | 47200, 47110 | §2 |
| | `set_basis_bpm` | float | 128.0 | feste Set-Basis bis Scheibe 5 |
| | `autonomie_start` | int | 1 | §10 |
| | `bestand`, `sets` | Pfad | `~/cypher-dj/bestand`, `~/cypher-dj/sets/djk` | §13, §15 |
| | `rechner_socket` | Pfad | `$XDG_RUNTIME_DIR/cypherdj/rechner.sock` | §11 |
| | `zug_vorlauf_takte`, `antwort_frist_takte` | int | 12, 4 | §3, ADR 013 (Vorlauf seit 2026-09-26 zwölf Takte: Rückfall nach M15) |
| | `nachrender_ruhe_takte` | int | 16 | ADR 020 |
| | `grenzen_tief_verriegeln` | bool | false | §11: nur Warnung; M20 (2026-09-25): die Regel §14.4 reißt die Tief-Grenze sicher 9/12, hart 11/12, darum false |
| `werkstatt.toml` | `comfy_musik_url` | str | (aus Skill `cypher-musik`) | §12.3 |
| | `bestand` | Pfad | `~/cypher-dj/bestand` | §13 |
| | `threads` | int | 4 | je Job; Unit mit `Nice=19`, `CPUSchedulingPolicy=batch` |
| | `stems_gpu` | bool | false | nur nach Andreas' Antwort zu Frage 4 (ARCHITEKTUR §13) |
| | `stems_cpu_im_set` | str | `"nur_256"` | `nie` oder `nur_256` (§12.3) |
| | `luft_db` | float | −12.0 | Headroom vor R3 (08 NP K5) |
| | `tor_raster_ms`, `tor_klarheit`, `tor_streckfaktor`, `tor_headroom_dbtp` | float | 8.0, 0.1, 0.20, −1.0 | §12.3; `tor_streckfaktor` 0,20 aus M19 (2026-09-25, 5-ms-Konvention, bei 30 ms 0,30), vorläufig bis M18 |
| | `stimmung_max_cent` | float | 35.0 | §12.3 |

---

## 3. Zeitbasis und Vorlauf

| Ebene | Wer plant | Mindestvorlauf vor `ab_beat` | Beleg, Stand |
|---|---|---|---|
| Regler-Teil, Schalter | Leitstand | **2 Zyklen** (10,7 ms bei 256) plus Transport | Senden bis Übernahme median 2,9 ms, max 8,1 ms (02 Probe b, NP 6,2 ms) |
| Deck-Befehl im Direktweg | Leitstand | 2 Zyklen | wie oben |
| Deck-Befehl auf dem Stretcher-Weg | Leitstand | `vorlauf_ms` aus `/zustand/deck` plus 2 Zyklen (gerechnet ≈ 113 ms bei 256 mit R3 und 4 Blöcken Arbeitsvorlauf); **Planer halten ≥ 1 Beat** | 03 §4a (Bandvorlauf 80,9 ms), M3 |
| Deck-Start (`/k/deck/start`) | Leitstand | **1 Beat** (Vorfüllen des Stretchers) | 02 Probe c (Polster und Verzögerung 85,3 ms) |
| Tempo-Rampe | Leitstand | **1 Beat**; der Kern setzt den Stretcher-Faktor intern 50 ms voraus | 03 §4b2 |
| Erzeuger-Fenster | Erzeuger | Fenster `[n+1, n+3)` bei Takt n; Wechsel ≥ 0,1 Beat vor der Rastergrenze | 06 Probe a |
| Hörschein | Analyse | 4 Takte Messung am Mess-Abgriff (gesetzt), danach **Erneuerung nach jedem Takt** über das gleitende 4-Takt-Fenster, solange der Kanal synchron läuft (§14.5) | 08 §3.3.6 |
| Laden | Leitstand | ≥ 1 Takt vor Beginn der Hörschein-Messung; Kopie in den Arbeitsbestand vorher | 10 NP N8 (0,05 ms je MiB) |
| Zug-Anfrage an Cypher | Leitstand | ≥ 12 Takte vor dem frühesten Start (seit 2026-09-26, M15: Zug p95 9,9 s bei langsamer API, Antwortfenster damit 8 Takte = 15 s); Antwortfrist `antwort_bis_beat` = frühester Start − 4 Takte (7,5 s bei 128). Gemessen: freier Plan über das Werkzeug 4,5 bis 8,7 s, warme Text-Züge mit Schema bis 14,5 s; die Wahl als Werkzeugaufruf ist ungemessen (M15). Kippt die Frist, rückt die Anfrage bei „sicher“ auf F−28 (ADR 013) | 09 §3.2, NP K6/K7 |
| Vorschlag an Andreas | Leitstand | verfällt 1 Takt vor seinem Start (`verfaellt_beat`) | gesetzt |
| Frischer Song | Werkstatt | 15 bis 30 min (ADR 022) | Betriebswert plus Rechnung, M14 |

Ein Befehl, der nach seinem Ziel-Sample im Kern-Ring ankommt, ist **verspätet** und wird nach seiner Politik
behandelt (§16).

---

## 4. Befehle an den Kern (OSC über UDP `127.0.0.1:47100`)

Alle Befehle sind einzelne OSC-Nachrichten (keine Bundles; Ausnahme Erzeuger-Fenster §4.8). Jeder Befehl beginnt mit
`h id, s quelle`. Der Kern antwortet mit `/q` (§5.1) an alle Abonnenten. Unbekannte Adressen oder falsche
Typ-Zeichenketten erzeugen `/e/protokollfehler` (§5.9) und werden verworfen.

**Politik-Codes** (`i politik`): 0 = `musik` (zu spät → verworfen), 1 = `zustand` (zu spät → am nächsten Zyklus
ausgeführt), 2 = `raster` (zu spät → nächster erreichbarer Rasterpunkt der Größe `raster_beats`). Einzelheiten §16.

### 4.1 Verbindung

| Adresse | Typen | Felder | Wirkung |
|---|---|---|---|
| `/k/hallo` | `,sii` | `name`, `port`, `protokoll` (= 1) | Abonnent anmelden. Antwort an diesen Port: `/k/willkommen`. Wiederholen spätestens alle 2 s (Herzschlag); der Kern streicht Abonnenten nach 5 s Stille; höchstens 8 Abonnenten |
| `/k/tschuess` | `,s` | `name` | abmelden |

`/k/willkommen ,iihdds`: `protokoll`, `generation` (Kern-Neustarts seit Zeitachsen-Beginn), `sample`, `beat`, `bpm`,
`kern_version`. Stimmt `protokoll` nicht, antwortet der Kern stattdessen `/e/protokollfehler`.

**Abonnenten über einen Neustart:** die Liste (Name, Port, Protokoll, letzte Meldung) steht im Neustart-Zustand
(§6.3). Ein neu gestarteter Kern schickt als erste Nachricht `/e/neustart` an alle gespeicherten Abonnenten (die
5-s-Frist beginnt für sie mit dem Neustart neu). Meldet sich ein Abonnent in einer neuen Generation an (`/k/hallo`),
bekommt er `/k/willkommen`, dann `/e/neustart` und je offenem Befehl einen Stand `/q/stand` (§5.1). Der Leitstand
schickt `/k/hallo` sofort, wenn 100 ms lang kein `/uhr` kam, und danach alle 50 ms, bis `/k/willkommen` kommt.

### 4.2 Zeitachse und Tempo

| Adresse | Typen | Felder | Wirkung, Quittung |
|---|---|---|---|
| `/k/set/neu` | `,hsd` | `id`, `quelle`, `start_bpm` | neue Zeitachse: Beat 0 am nächsten Zyklus, Karte konstant `start_bpm`, `generation` = 0. Abgelehnt (`deck_laeuft`), solange ein Deck läuft |
| `/k/tempo/rampe` | `,hsddd` | `id`, `quelle`, `ab_beat`, `ziel_bpm` (60 bis 200), `dauer_beats` (≥ 1,0) | Rampe linear in der Zeit ab `ab_beat` vom dann gültigen Tempo. Zu spät: Start am nächsten Zyklus, Ende-Beat unverändert, gemeldet `verspaetet_ausgefuehrt`. Karte voll: `abgelehnt`, Grund `karte_voll` |
| `/k/storno` | `,hsh` | `id`, `quelle`, `ziel_id` | zieht einen noch nicht gestarteten Befehl derselben Quelle zurück; Quittung für `ziel_id`: `storniert`, für den Storno selbst `angenommen` und `gestartet`, kein `fertig` (Andreas 2026-09-25) |

Andreas' Tempo-Regler wirkt über MIDI als Hand-Segment (§7).

### 4.3 Planteile (Regler)

`/k/teil ,hssisddfiiss`

| Nr | Feld | Typ | Bedeutung |
|---|---|---|---|
| 1 | `id` | h | Befehls-ID |
| 2 | `quelle` | s | Absender (`cypher`, `andreas`, `leitstand`) |
| 3 | `plan` | s | Plan-ID oder `""` |
| 4 | `teil` | i | Nummer im Plan (0 …) |
| 5 | `pfad` | s | Regler-Pfad (§1.5) |
| 6 | `ab_beat` | d | Start |
| 7 | `dauer_beats` | d | 0 = setzen (mit Schaltrampe des Reglers), > 0 = Rampe |
| 8 | `nach` | f | Zielwert in der Einheit des Reglers |
| 9 | `form` | i | 0 = linear in der Einheit, 1 = S-Kurve `u ↦ 3u² − 2u³` |
| 10 | `politik` | i | 0 `musik` oder 1 `zustand` (2 ist hier nicht erlaubt) |
| 11 | `gruppe` | s | Kopplungsgruppe oder `""`; alle Teile eines Plans mit gleicher Gruppe fallen gemeinsam, **auch bei einer Ablehnung am Start**: die übrigen wartenden Teile der Gruppe werden `abgebrochen` mit dem Grund des abgelehnten Teils (Andreas 2026-09-25, Lesart b) |
| 12 | `hoerschein` | s | `hs_id` oder `""`; Pflicht, wenn der Teil einen geschlossenen Kanal öffnet (I3a, §1.6 `offen`) |

Semantik: zum Ziel-Sample liest der Kern den **Ist-Wert** `w0` (bei einem Setzen desselben Reglers am selben Sample:
dessen Zielwert) und fährt `wert(beat) = w0 + (nach − w0)·f((beat − ab_beat)/dauer_beats)` je Sample (Beat-Zeit: eine spätere Tempoänderung dehnt die Rampe in Sekunden mit). Halter
während des Teils: `plan:<plan>` (bei leerem `plan`: `quelle`). Quittungen: `angenommen` (im Ring), `gestartet`,
`fertig`, oder `abgelehnt`/`abgebrochen` mit Grund. Ein Griff bricht wartende und laufende Teile des gegriffenen Reglers **sofort beim Griff** ab (Quittung 7 `hand`, ADR 023
Entscheidung 2; Andreas 2026-09-25, Lesart e); `regler_beim_menschen` (Status 6) trifft nur Teile, die erst starten
wollen, während der Halter schon `mensch` ist. Prüfungen am Start: Halter (`regler_beim_menschen`), Überlappung
(I4), Invarianten I1 bis I3 (§17), `nur_hand`, `ki_gestoppt`. Einen von Andreas angenommenen Vorschlag reicht der
Leitstand mit Quelle `cypher` ein (die Stopp-Taste wirkt weiter auf ihn).

`/k/abbruch ,hsss`: `id`, `quelle`, `plan`, `teile` (`"*"` für alle oder `"0,2,5"`). Laufende Teile halten am
Ist-Wert, wartende entfallen (auch Deck-Teile, §4.4); Quittung je Teil `abgebrochen`, Grund `abbruch`.

### 4.4 Decks

Alle Deck-Befehle: Quelle `cypher` wird abgelehnt (`deck_beruehrt`), wenn Andreas in den letzten 32 Beats eine
Transport-Taste dieses Decks gegriffen hat (Deck-Halter, §7.3).

**Deck-Teile** (`start`, `stopp`, `loop`, `roll`, `sprung`, `hotcue`) tragen nach `quelle` dieselben Planfelder wie
`/k/teil`: `s plan` (`""` ohne Plan), `s gruppe` (`""` ohne Kopplung), `s hoerschein` (`""`, eine `hs_id` oder
`annahme:<vorschlag_id>`). Damit fallen sie mit ihrer Gruppe (Handgriff, Invariante, `/k/abbruch`), und I2 und I3
prüfen sie (§17). `annahme:<vorschlag_id>` setzt nur der Leitstand, und nur nachdem Andreas diesen Vorschlag per Taste
angenommen hat; der Kern schreibt ihn ins Journal und lässt damit I3d passieren.

**Stems:** `/k/deck/laden` mit `mit_stems = 1` blendet die vier Stems der Fassung ein, und **die Stem-Summe klingt**
(die Basis-Datei wird dann nicht geladen); mit `mit_stems = 0` klingt die Basis-Datei, und Teile an `stem/*` werden mit
`keine_stems` abgelehnt. Umgeschaltet wird nur beim Laden, nie im Spiel (Demucs-Stems ergeben summiert nicht bitgleich
den Mix). `mit_stems` muss zur Fassung passen (`fassung.json` `analyse_quelle`, §13.1), sonst `abgelehnt`, Grund
`pruefung`; so stammen Referenz-Hüllkurve und Kreuzenergien immer aus dem, was klingt. Speicher je Deck: Basis-Datei
oder vier Stems, nie beides (3 Minuten: rund 69 MB bzw. 276 MB, gerechnet wie ADR 015).

**Hörweg** (ADR 020): ein Deck spielt **direkt** (ohne Stretcher), solange `|bpm/basis_bpm − 1| < 10⁻⁶`; sonst übernimmt
der warme Schatten-Stretcher mit 20-ms-Kosinusblende vor dem ersten abweichenden Sample. Bis Scheibe 5 gibt es nur
den Direktweg: der Kern lehnt `/k/tempo/rampe` mit Grund `kein_stretcher` ab, solange ein Deck läuft. `vorlauf_ms` in
`/zustand/deck` sagt, wie früh Deck-Befehle kommen müssen.

| Adresse | Typen | Felder | Wirkung |
|---|---|---|---|
| `/k/deck/laden` | `,hsisdii` | `id`, `quelle`, `deck` (1 bis 4), `material_id`, `basis_bpm`, `fassung` (r ≥ 1), `mit_stems` (0/1) | nur wenn das Deck nicht zugleich läuft und offen ist (sonst `deck_hoerbar`; ein stehendes Deck lädt auch bei offenem Fader, 2026-09-27). Lader blendet `/dev/shm/cypherdj/material/<id>/fassungen/<bpm·1000>_r<fassung>/` ein (`basis.f32` oder die vier Stems, siehe oben), prüft gegen `fassung.json` (§13.2), reicht den Zeiger in den Callback; `deck/<n>/fader` → −200, `pfl` → 0, `trim` nach §1.5; Quittung `gestartet` beim Tausch, `fertig`; Ereignis `/e/geladen`. Fehler: `abgelehnt`, Grund `material_fehlt` \| `pruefung` \| `budget_speicher` |
| `/k/deck/entladen` | `,hsi` | `id`, `quelle`, `deck` | nur wenn nicht zugleich laufend und offen (2026-09-27); gibt Speicher nach Rückgabe aus dem Callback frei |
| `/k/deck/start` | `,hssssiddi` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `quell_beat`, `politik` | bei `ab_beat` erklingt `quell_beat` (128-Frame-Blende, wenn das Deck schon läuft); das Deck folgt danach der Tempo-Karte (Faktor = `bpm / basis_bpm`) |
| `/k/deck/stopp` | `,hssssidi` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `politik` | Stopp mit 10-ms-Rampe. Ein Stopp aus einem Plan wartet, solange er den letzten hörbaren Kanal träfe (I2). Nur ein **ausgeführter** Stopp mit Quelle `andreas` (oder die Play-Taste) unterbindet den Frist-Wächter für dieses Material |
| `/k/deck/loop` | `,hssssiddid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `laenge_beats` (1/32 bis 128; 0 = Loop aus), `politik`, `raster_beats` | Loop ab der Quellposition bei `ab_beat` (Band, 128-Frame-Blende an der Naht) |
| `/k/deck/roll` | `,hssssiddiid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `laenge_beats` (0 = aus), `art` (0 Band mit Schatten, 1 Puffer hinter dem Keylock ab Scheibe 5), `politik`, `raster_beats` | beim Aus kehrt das Deck zur Schattenposition zurück |
| `/k/deck/sprung` | `,hssssiddid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `delta_beats`, `politik`, `raster_beats` | Beatjump; im aktiven Loop verschiebt er den Loop um `delta_beats`. Quelle `cypher` auf offenem Deck: I3d |
| `/k/deck/hotcue` | `,hssssidiid` | `id`, `quelle`, `plan`, `gruppe`, `hoerschein`, `deck`, `ab_beat`, `nr` (1 bis 8), `politik`, `raster_beats` | läuft das Deck, phasentreu: `ziel = hc + wrap(phase(p) − phase(hc))` mit `p` = Quellposition bei `ab_beat`; steht es, genau `hc` (2026-09-28); `phase(x) = x − floor(x)`, `wrap` nach [−0,5; 0,5). Beispiel: `p` = 37,30, `hc` = 64,00 → Ziel 64,30. Quelle `cypher` auf offenem Deck: I3d |
| `/k/deck/hotcue_setzen` | `,hsiid` | `id`, `quelle`, `deck`, `nr`, `quell_beat` (NaN = löschen) | Ereignis `/e/hotcue`; der Leitstand schreibt es in `korrekturen.jsonl` |
| `/k/deck/raster` | `,hsisdii` | `id`, `quelle`, `deck`, `material_id`, `basis_bpm`, `fassung`, `versatz_frames` (−192 000 bis 192 000, 4 s seit Grid SET) | Plan Grid: das Raster der geladenen Fassung liegt ab jetzt `versatz_frames` Frames später (Takt-Eins-Linie auf `erster_schlag_frame + versatz_frames`); absolut, sofort am Blockanfang. Der Quell-Beat unter dem Kopf bleibt, der Ton rückt um die Änderung (laufend mit 128-Frame-Blende gegen den Master, stehend als Position); Hotcues, Loop und Cue-Punkt ziehen mit. Laden setzt 0. Andere Fassung geladen: `nicht_geladen`. Ereignis `/e/raster` |
| `/k/deck/slip` | `,hsii` | `id`, `quelle`, `deck`, `an` | Slip: der Schatten läuft während Loop, Roll, Sprung weiter; beim Aus springt das Deck zum Schatten |
| `/k/deck/basis_tausch` | `,hsidid` | `id`, `quelle`, `deck`, `basis_bpm`, `fassung`, `ab_beat` | ab Scheibe 5: Tausch auf eine andere Fassung (neue Basis oder korrigiertes Raster) mit 20-ms-Blende; Quellposition wird umgerechnet (§13.1); braucht die Fassung im Arbeitsbestand; gleiche `mit_stems` wie geladen |

`raster_beats` gilt nur bei Politik 2 und ist 0,25, 1, 4, 16 oder 32.

### 4.5 Hörscheine

| Adresse | Typen | Felder | Wirkung |
|---|---|---|---|
| `/k/hoerschein` | `,hsssssddddfff` | `id`, `quelle`, `hs_id`, `kanal`, `inhalt`, `urteil` (nur `ok` wird gesendet), `bpm_messung`, `gueltig_bis_beat`, `quell_von`, `quell_bis`, `sync_ms`, `pegel_diff_db`, `lufs_kurz` | registriert einen Hörschein für I3; eine bekannte `hs_id` **ersetzt** den alten (Erneuerung je Takt, §14.5); höchstens 32 gleichzeitig, abgelaufene entfallen |
| `/k/hoerschein/weg` | `,hss` | `id`, `quelle`, `hs_id` | zieht ihn zurück (die Analyse schickt es, sobald eine Erneuerung nicht mehr `ok` ist) |

`inhalt` bindet den Hörschein an das, was klingt: Deck `<material_id>/<bpm·1000>_r<fassung>` (etwa
`3fa1c09b2e7d4410/128000_r1`), Pad `<material_id>/<bpm·1000>_r<fassung>/s<schuss_nr>`, Erzeuger `muster/<m>`.
`quell_von`/`quell_bis`: Quell-Beat-Bereich, den die Messung ohne Unterbrechung gesehen hat (bei Pad und Erzeuger
NaN); nach einem Sprung im Deck beginnt er neu.

### 4.6 Einzelschüsse

`/k/schuss ,hsdsiiifi`: `id`, `quelle`, `ab_beat`, `material_id`, `fassung`, `schuss_nr`, `pad` (1 oder 2), `pegel_db`,
`politik`. Spielt `fassungen/<bpm·1000>_r<fassung>/schuesse/<nr>.f32` auf dem Pad-Kanal. Ist das Pad **offen**, braucht
ein Schuss mit Quelle ungleich `andreas` einen gültigen Hörschein des Pads mit genau diesem Schuss als `inhalt`, sonst
`abgelehnt`, Grund `kein_hoerschein` (I3b). Vorhören eines Schusses: einmal bei geschlossenem Pad spielen (Werkzeug
`vorhoeren` mit `pad`, §10); jede gemessene Wiedergabe erneuert den Hörschein.

### 4.7 KI, LEDs, Kiste, Konfiguration

| Adresse | Typen | Felder | Wirkung |
|---|---|---|---|
| `/k/ki/stopp` | `,hs` | `id`, `quelle` | wie die Stopp-Taste: alle Teile mit Quelle `cypher` abgebrochen (Grund `ki_stopp`), Kanäle der KI-Spur über 4 Beats auf −200, weitere `cypher`-Befehle `abgelehnt` (`ki_gestoppt`) bis `/k/ki/frei` |
| `/k/ki/frei` | `,hs` | `id`, `quelle` (nur `andreas`) | hebt den Stopp auf |
| `/k/ki/spur` | `,hss` | `id`, `quelle`, `kanaele` (Komma-Liste, z. B. `deck/3,deck/4,erz/1`) | Kanäle der KI-Spur |
| `/k/ki/stufe` | `,hsi` | `id`, `quelle`, `stufe` (0 bis 3) | nur für LEDs; die Stufe durchsetzen tut der Leitstand |
| `/k/vorschlag_kanal` | `,hss` | `id`, `quelle`, `kanal` (`""` = keiner) | Kanal, den die Taste „Cypher hören“ auf Andreas' PFL legt |
| `/k/led` | `,hssi` | `id`, `quelle`, `name` (§7.4), `zustand` (0 aus, 1 an, 2 blinkt, 3 blinkt schnell) | LED am Controller |
| `/k/kiste` | `,hs` | `id`, `quelle` | Kern liest `/dev/shm/cypherdj/kiste.json` neu |
| `/k/mapping` | `,hss` | `id`, `quelle`, `geraet` | Kern liest das Controller-Mapping neu (Nicht-Echtzeit-Faden) |
| `/k/latenz` | `,hssi` | `id`, `quelle`, `ziel` (`erz/<m>` oder `fx/<n>`), `samples` | gemessene Rückweg-Latenz eines Wirts; der Kern schickt Ereignisse an dieses Ziel um `samples` plus einen Zyklus früher |

### 4.8 Erzeuger

| Adresse | Typen | Felder | Wirkung |
|---|---|---|---|
| `/erz/strom` | `,hsiss` | `id`, `quelle`, `strom` (1 bis 16), `ziel` (`midi:<p>:<c>` mit Port 1 bis 4 und Kanal 1 bis 16, `pad:<n>`, oder `kit:<name>` nach ADR 024), `kanal` (Kern-Kanal, auf dem der Klang zurückkommt: `erz/<m>` oder `pad/<n>`) | Ziel eines Stroms festlegen; `kanal` braucht der Kern für I3c |
| Bundle (Zeitmarke 1 = „sofort“) mit `/erz/fenster` und n × `/erz/ev` | | | ein Fenster atomar ersetzen |
| `/erz/fenster` | `,iiiiddh` | `strom`, `sendung` (monoton), `modus` (66 = `'B'`), `reserve`, `ab_beat`, `bis_beat`, `t_send_us` | Kopf; wie in `proben/06-erzeuger-muster/uhr` gemessen |
| `/erz/ev` | `,iiiiddf` | `strom`, `muster`, `ev_id`, `note` (0 bis 127), `beat`, `dauer_beats`, `velocity` (0 bis 1) | **geändert gegenüber Probe 06:** `t_us` entfällt, `velocity` neu. **Schwanz (Scheibe 3):** danach 0 bis n Paare `if` (`nr`, `wert`), siehe unten |
| `/erz/cc` | `,iiidf` | `strom`, `ev_id`, `cc`, `beat`, `wert` (0 bis 1) | reserviert (später) |

Semantik „Fenster ersetzen“: für `strom` werden alle **noch nicht gespielten** Ereignisse in `[max(ab_beat, jetzt),
bis_beat)` verworfen und die neuen eingesetzt; Ereignisse mit `beat < jetzt` werden gezählt (`zu_spaet`), nicht
gespielt. Ereignisse eines Musters, für das der Kanal des Stroms **offen** ist, aber kein gültiger Hörschein mit
`inhalt` `muster/<m>` besteht, werden nicht gespielt und als `ungehoert` gezählt (I3c): ein neues Muster klingt zuerst
auf einem geschlossenen Erzeuger-Kanal (Mess-Abgriff) und kommt dann per Plan hinein, wie ein neuer Track. Antwort
`/erz/quittung ,iiiiiii`: `strom`, `sendung`, `verworfen`, `verworfen_anderes_muster`, `eingefuegt`, `zu_spaet`,
`ungehoert`. Noten gehen als JACK-MIDI mit Sample-Versatz an das Ziel, vorgezogen um die registrierte Latenz (§4.7).

**Kit (Stufe 1, ADR 024, 2026-09-27):** Mit `ziel` = `kit:<name>` (`[a-z0-9_-]{1,32}`) spielt der Kern jedes
Ereignis des Stroms selbst als Einzelschuss `klang[note]` aus `~/.config/cypherdj/kits/<name>/kit.json` (§13-Form:
`schema` 1, `klaenge` [{`note` 0 bis 127, `name`, `datei` `*.f32` im selben Ordner, `frames`}], Stereo float32
verschränkt, 48 kHz, höchstens 10 s je Klang und 256 MiB je Kit), am Sample `llround(sample_at(beat))`, mit
`velocity` als linearer Verstärkung, in den Eingang des Kanals `kanal` (`erz/<m>` oder `pad/<n>`) vor Trim. Eine
Note ohne Klang im Kit verfällt still. Das Netz lädt und prüft das Kit; Fehler: `/q` Status 6, Grund `pruefung`,
Text mit Grund im Protokoll. `midi:` und `pad:` sind noch nicht gebaut (Status 6, `ausserhalb_bereich`).
**Zwei Kits in einem Strom (MVP 2 Scheibe 3, 2026-09-27):** `ziel` = `kit:<a>+<b>` (genau ein `+`) lädt beide
Ordner in EIN Kit, damit ein Muster Klänge aus beiden spielt (`s("bd rec0")`). Fehlt `<b>/kit.json` ganz, gilt nur
`<a>`; ein kaputtes `<b>` oder dieselbe Note in beiden ist `pruefung`. `<b>` ist das Kit der Mitschnitte (`rec`,
Prüfinstanz `rec-<i>`, im selben Kit-Ordner): `djk-loop kit <loop> [<klang>]` und „→ STRUDEL“ auf der Seite legen
dort einen Loop als Klang `<klang>:0` ab (Name `[a-z][a-z0-9_]{0,15}`, Vorgabe `rec0`, `rec1` …; kein Bankname aus
`<a>`; Note = die niedrigste in beiden Kits freie; höchstens 10 s). Der Erzeuger sieht die geänderte `kit.json` vor
dem nächsten Takt und meldet den Strom mit demselben `ziel` neu an; der Kern lädt beide Kits neu, klingende Stimmen
des alten Kits enden dabei hart (bekannt, Plan-Review Fund 17).
**I3c ist in Stufe 1 ausgesetzt:** `ungehoert` ist immer 0, Muster auf offenem Kanal klingen (Muster kommen auf
Andreas' Zuruf, er öffnet den Kanal selbst). Fenster-Bundles bleiben unter 1 400 Bytes (§2); der Erzeuger teilt ein
Fenster nach der kodierten Größe in lückenlose Teilfenster (ein `/erz/ev` ohne Schwanz: 60 Bytes).

**Parameter-Schwanz an `/erz/ev` (Scheibe 3, 2026-09-27):** Nach den sieben festen Feldern darf `/erz/ev` 0 bis n
Paare `,if` tragen: `nr` aus der Werteliste `erz_parameter` und `wert` (float32). Geschickt werden nur Werte ungleich
der Vorgabe; ein Ereignis ohne Paare ist genau das bisherige `/erz/ev`. Eine unbekannte `nr` überliest der Kern (ein
älterer Kern bleibt mit einem neueren Erzeuger spielfähig). Neue Parameter sind neue Codes, kein neuer Typ. Heute:
`0` `begin`, `1` `end` (Anteil 0 bis 1 der Klanglänge wie Strudel, Vorgabe 0 und 1): der Kern spielt die Frames
`[floor(begin · frames), floor(end · frames))` des Klangs; außerhalb von [0, 1] (auch ±Inf) geklemmt, leerer Bereich =
kein Ton; NaN bei einem bekannten Parameter ist ein Formfehler (`protokoll`). Höchstens 12 Paare je `/erz/ev`
(7 + 2 · 12 = 31 Werte, der Kern liest bis 32). Formfehler im Bundle: `/e/protokollfehler` mit `protokoll`.

### 4.9 Loop-Boxen (MVP 2, ADR 025)

| Adresse | Typen | Felder | Wirkung |
|---|---|---|---|
| `/k/loop/laden` | `,hsis` | `id`, `quelle`, `box` (1 oder 2), `name` (`[a-z0-9_-]{1,32}`) | Loop aus `<loop_ordner>/<name>/` in die Box; eine laufende Box spielt den neuen auf demselben Raster weiter |
| `/k/loop/start` | `,hsi` | `id`, `quelle`, `box` | die Box setzt auf der nächsten Takt-Eins ein |
| `/k/loop/stopp` | `,hsi` | `id`, `quelle`, `box` | die Box endet auf der nächsten Takt-Eins; wartet sie noch auf den Einsatz, steht sie sofort |
| `/k/loop/raster` | `,hsii` | `id`, `quelle`, `box`, `versatz_frames` (größer als −`frames`, kleiner als `frames` des geladenen Loops) | Plan Grid: das Raster im Loop liegt `versatz_frames` Frames später; die Box spielt `(Position + versatz_frames) mod frames`; absolut, sofort. Leere Box: `nicht_geladen`; Betrag ≥ `frames`: `ausserhalb_bereich` |
| `/k/loop/rec` | `,hsis` | `id`, `quelle`, `beats` (1, 2, 4, 8, 16 oder 32), `name` (`[a-z0-9_-]{1,32}`) | Mitschnitt von `erz/1` vor Trim: N = `beats` Beats ab dem nächsten Vielfachen von N Beats, in einen vom Netz angelegten Puffer |

Box 1 spielt in den Eingang von `pad/1`, Box 2 in den von `pad/2` (vor Trim); danach wirkt der Kanalzug des Kanals
(§1.6), gegriffen über `pad/<n>/*` wie jeder Kanal. Position im Loop = ((Beat mod `beats`) · 22 500 + `versatz_frames`) mod `frames`, also
phasenstarr zur Kern-Uhr. Loops liegen bei 128 BPM: weicht die Karte ab (anderes Tempo oder Rampe), liest die Box mit
dem Schritt `bpm`/128 (Varispeed ohne Tonhöhenerhalt, Catmull-Rom über vier Frames, ADR 026); bei genau 128 BPM liest
sie ganzzahlig und bitgenau. Status 5 wird seit 2026-09-30 nicht mehr gemeldet. Loop-Form (§13-Form wie das Kit): `loop.json` mit `schema` 1, `name`,
`beats` (1, 2, 4, 8, 16 oder 32), `bpm` 128, `frames` = `beats` · 22 500, `datei` `loop.f32` (Stereo float32
verschränkt, 48 kHz), optional `versatz_frames` (ganzzahlig, Betrag kleiner als `frames`, fehlt = 0; Plan Grid). Ältere Loops mit `takte` (1, 2, 4, 8, bis MVP 2 Scheibe 2) liest der Kern als `beats` = 4 ·
`takte` (Hörtest-Aufnahmen vom 27.09.); geschrieben wird nur noch `beats`. Loop-Ordner: Vorgabe-Instanz `~/.config/cypherdj/loops/`, Prüfinstanz `<i>` `/dev/shm/cypherdj-<i>/loops/`.
Fehler als `/q` Status 6: `pruefung` (Datei), `ausserhalb_bereich` (Box, Name, Quelle, Beats, Tempo-Rampe beim Mitschnitt),
`nicht_geladen` (Start oder Stopp einer leeren Box), `ueberlappung` (zweiter Mitschnitt, solange einer läuft),
`ki_gestoppt` (Quelle `cypher` bei gedrückter Stopp-Taste). Boxen, Loops und ein laufender Mitschnitt liegen nicht im
Neustart-Zustand (§6.3): nach `/e/neustart` sind beide Boxen leer; ein laufender Mitschnitt ist mit dem Prozess
verloren und meldet sich nicht mehr (Netz und Kern sind ein Prozess), die Seite beendet ihren REC-Zustand selbst.
`/k/set/neu` bricht einen laufenden Mitschnitt ab (`/e/mitschnitt` Status 1).

Mitschnitt (MVP 2, ADR 025 Folgeplan Scheibe 2; Tempo nach ADR 026): `/k/loop/rec` legt einen Puffer von `beats` · 48 000 Frames an (reicht bis 60 BPM)
(Stereo float32) und beginnt ihn ab dem nächsten Vielfachen von `beats` Beats (§4.2-Muster wie die Takt-Eins der
Boxen, nur über die Loop-Länge statt über 4 Beats; damit läuft der Loop in der Box an derselben Stelle weiter wie
das Muster, bei 32 Beats kann der Einsatz bis zu 32 Beats auf sich warten lassen; bei 1 Beat ist es der nächste Beat). Kopiert wird der Eingang von `erz/1` **vor Trim**, nach dem
Erzeuger und den Prüfklicks, vor dem Mixer. Kopiert werden die Frames von `beats` Beats beim Tempo der Aufnahme.
Eine laufende oder wartende Tempo-Rampe zum Zeitpunkt von `/k/loop/rec` lehnt ab (`ausserhalb_bereich`); ändert sich
das Tempo bis zum Ende der Aufnahme, bricht sie ab (`/e/mitschnitt` Status 1). Das Netz tastet beim Schreiben auf
`beats` · 22 500 Frames um (Set-Basis 128 BPM) und vermerkt dann `aufnahme_bpm` in `loop.json`; bei 128 BPM ist die
Datei bitgleich mit dem Puffer. Ist der Puffer voll, schreibt das Netz `<loop_ordner>/<name>/` (atomar über
`.<name>.neu/`) und meldet `/e/mitschnitt`; ist der Name schon vergeben, Status 1 ohne Datei.

---


### 4.10 Beat-FX (AUFTRAG 2026-09-28: zwei Einheiten, Zuweisung je Kanal statt CH-Wahl, drei Parameter je Einheit)

| Adresse | Typen | Felder | Wirkung |
|---|---|---|---|
| `/k/fx` | `,hsiidddddi` | `id`, `quelle`, `einheit` (1 FX1, 2 FX2), `art` (1 Echo, 2 Flanger, 3 Phaser, 4 Filter-LFO), `beats` (0,25, 0,5, 1, 2, 4, 8 oder 16), `wet` (0 bis 1, S8 FX Knob 1 Dry/Wet), `param1` (0 bis 1, S8 FX Knob 2, DSP-wirksam je Art: Echo/Flanger Rückkopplung, Phaser Resonanz, Filter Güte), `param2` (0 bis 1, S8 FX Knob 3, reserviert, ohne DSP-Wirkung), `param3` (0 bis 1, S8 FX Knob 4, reserviert, ohne DSP-Wirkung), `an` (0/1, die Einheit ON, S8 FX Button 1) | setzt die Parameter der Einheit; wirkt auf jede ihr zugewiesene Instanz (`/k/fx/zuweisung`); Wet gleitet über 480 Samples; ein Wechsel von Art oder Beats bei an gleitet erst auf 0 und leert den Zustand; aus schließt bei jeder Art nur den Eingang, der Nachhall klingt aus; LFO-Phase = frac(Beat / `beats`) |
| `/k/fx/zuweisung` | `,hsisi` | `id`, `quelle`, `einheit` (1, 2), `kanal` (`deck/1`, `deck/2`, `erz/1`, `erz/2`, `erz/3`, `pad/1`, `pad/2`, `master`), `an` (0/1, zugewiesen) | hängt `kanal` an die Instanz der Einheit oder löst ihn (nach dem Kanalzug, Hauptweg nach dem Fader, PFL trocken; bei `master` auf die Summe vor `master/pegel`); mehrere Kanäle dürfen an derselben Einheit hängen; ein Kanal mit beiden Zuweisungen läuft FX1 vor FX2 (seriell, wie an der Traktor Kontrol S8, §4.3.1: „first run through FX1, then FX2“); Zuweisung ab lässt die Instanz auslaufen (Eingang zu, Nachhall läuft), Zuweisung an lässt den Eingang wieder auf gleiten |
| `/k/fx/routing` | `,hsi` | `id`, `quelle`, `routing` (0 Post Fader, 1 Insert; sonst Quittung 6 `ausserhalb_bereich`) | schaltet für beide Einheiten und alle Kanalzüge, wo der Beat-FX sitzt: Post Fader (Vorgabe, nach dem Fader, PFL und Cyphers Ohr hören ihn nicht) oder Insert (vor dem Fader, PFL und Hüllkurven-Ring hören ihn, wie Traktor FX Unit Routing); wirkt am nächsten Blockanfang, der Wechsel gleitet Wet über 480 Samples auf 0, tauscht den Weg, leert und gleitet zurück (die Echo-Fahne bricht ab); Quelle `cypher` bekommt Quittung 6 `nur_hand` (die Taste ist Andreas' Hand); Master-FX bleibt unberührt; der Kern behält den Wunsch über einen Neustart nicht (der Seiten-Server sendet ihn erneut); Quittungen 1/2/3 |

`param` wirkt je Art: Echo und Flanger Rückkopplung 0 bis 0,9, Phaser Resonanz 0 bis 0,9, Filter-LFO Güte 0,7 bis 8.
Quittung 1, 2, 3 am Blockanfang; Fehler `/q` Status 6 `ausserhalb_bereich`. Quelle `cypher` lehnt `djk-fx` selbst ab,
solange der AUTO-Schalter der Seite aus ist (wie `djk-muster`).
## 5. Ausgaben des Kerns (OSC an Abonnenten)

### 5.1 Quittung `/q ,hsihds`

`id`, `quelle`, `status`, `ist_sample`, `ist_beat`, `grund` (`""` oder ein Code aus §16.2).

| `status` | Name | wann |
|---|---|---|
| 1 | `angenommen` | Befehl im Ring, Prüfung beim Einsortieren bestanden |
| 2 | `gestartet` | am Ziel-Sample ausgeführt bzw. Rampe begonnen (`ist_sample` = tatsächliches Sample) |
| 3 | `fertig` | Rampe am Ende, Laden abgeschlossen |
| 4 | `verspaetet_verworfen` | Politik 0, zu spät |
| 5 | `verspaetet_ausgefuehrt` | Politik 1 oder 2, zu spät, ersatzweise ausgeführt |
| 6 | `abgelehnt` | Prüfung gescheitert (`grund`) |
| 7 | `abgebrochen` | laufender oder wartender Teil beendet (`hand`, `abbruch`, `ki_stopp`, `invariante_*`) |
| 8 | `storniert` | durch `/k/storno` |

**Stand nach Neustart `/q/stand ,hsihds`:** dieselben Felder wie `/q`, `status` = der Stand des Befehls im
Neustart-Zustand (1 wartet, 2 läuft; fertige und abgebrochene Befehle der alten Generation meldet der Kern nicht
erneut). Nur an einen Abonnenten, der sich in einer neuen Generation anmeldet (§4.1); der Leitstand gleicht damit
seine offenen Pläne ab.

### 5.2 Uhr `/uhr ,hhddd` (je Zyklus)

`sample` (Blockanfang), `mono_ns` (Blockanfang), `beat` (Blockanfang), `bpm`, `bpm_pro_s` (`k` des Segments).
Hochrechnung beim Empfänger: `beat_jetzt ≈ beat + (jetzt_ns − mono_ns)·bpm / 60e9` (gemessener Schätzfehler
höchstens 0,024 ms, 06 Probe a). Nur zum Aufwachen benutzen, nie als Befehlszeit.

### 5.3 Takt `/takt ,iihdd`

`takt`, `phrase`, `sample` (Sample des Taktanfangs), `beat` (= 4·(takt − 1)), `bpm` am Taktanfang. Gesendet im
Zyklus, der den Taktanfang enthält.

### 5.4 Kern-Zustand `/zustand/kern ,iihiiiiiiii` (20 Hz)

`generation`, `quantum`, `sample`, `frame_luecken` (seit Generationsstart), `ausgelassene_perioden`, `cb_max_us`
(letzte Sekunde), `cb_p99_us` (letzte Sekunde), `aufwach_max_us` (letzte Sekunde), `stretcher_aktiv`,
`befehle_wartend`, `ki_gestoppt` (0/1).

### 5.5 Deck-Zustand `/zustand/deck ,iisdidddfiif` (50 Hz je geladenem Deck)

`deck`, `status` (0 leer, 1 geladen, 2 läuft, 3 Loop, 4 Roll, 5 Rückfall), `material_id`, `basis_bpm`, `fassung`,
`quell_beat` (**hörbare** Position), `beats_bis_ende` (Master-Beats bis zum Materialende, ∞ im Loop), `faktor`,
`vorlauf_ms` (Mindestvorlauf für Deck-Befehle, §3), `hoerweg` (0 direkt, 1 Stretcher, 2 Puffer), `stretcher_fuell`
(Arbeitsvorlauf in Blöcken; −1 ohne Stretcher), `versatz_intern_ms` (Phasenregler: Ist gegen `sample_at`).

### 5.6 Pegel `/pegel ,sfffffff` (20 Hz je aktivem Kanal, dazu `master`, `cue`)

`kanal`, `spitze_db`, `echtspitze_dbtp`, `lufs_m`, `lufs_s`, `band_tief_db`, `band_mitte_db`, `band_hoch_db`
(Bandpegel am Mess-Abgriff, vor dem Band-Gain des Isolators).
Stand Scheibe 35 (Vorgriff aus 43): der Kern meldet `spitze_db` (Abtast-Spitze seit der letzten Meldung, dB, −200 unter
−200) für jedes geladene Deck (nach dem Fader), `master` (wie im Ring, nach Limiter) und `cue`, höchstens alle 2 400
Samples (20 Hz); `echtspitze_dbtp`, `lufs_m`, `lufs_s` und die drei Bänder misst erst Scheibe 43 und stehen bis dahin auf
−200. Seit 2026-09-27 (Strudel Stufe 1, ADR 024) meldet der Kern auch `erz/1`, seit 2026-09-29 (Studio S1) `erz/2` und
`erz/3` (nach dem Fader, immer, ohne Strom −200) und seit MVP 2 (ADR 025) `pad/1` und `pad/2` (ohne Loop −200); die übrigen Erz- und Busschienen melden noch
nicht.

### 5.7 Regler `/e/regler ,sfshd`

`pfad`, `wert`, `halter` (`frei` \| `mensch` \| `plan:<id>` \| `<quelle>`), `sample`, `beat`. Bei jeder Änderung,
höchstens 50 Hz je Regler, und immer bei Teilstart, Teilende und Halterwechsel.

### 5.8 Hand `/e/hand ,sfhd` und Tasten `/e/taste ,sihd`

- `/e/hand`: `pfad`, `wert`, `sample`, `beat`; erstes und letztes Ereignis einer Geste plus höchstens 20 Hz.
- `/e/taste`: `name`, `wert`, `sample`, `beat`. Namen: `annehmen`, `verwerfen`, `cypher_vorschlag`, `cypher_hoeren`,
  `stopp`, `freigabe`, `urteil_gut`, `urteil_daneben`, `autonomie` (Wert 0 bis 3), `spielart` (Wert = Index der
  Spielart am Encoder), `laenge` (Wert = Takte am Encoder), `spielart_start` (Wert = Ziel-Deck), `basstausch`,
  `kiste_laden` (Wert = Deck), `kiste_wahl` (Wert = Index in `kiste.json`), `tempo_basis`, `zuruf` (Wert = 0; Text
  kommt über das Terminal, §9.4).

### 5.9 Ereignisse `/e/*`

| Adresse | Typen | Felder |
|---|---|---|
| `/e/geladen` | `,isdiih` | `deck`, `material_id`, `basis_bpm`, `fassung`, `mit_stems`, `sample` |
| `/e/halter` | `,sshd` | `pfad` (oder `deck/<n>/transport`), `halter`, `sample`, `beat` |
| `/e/invariante` | `,ssihd` | `art` (`sub_doppelt` \| `master_leer` \| `hoerschein`), `plan`, `teil`, `sample`, `beat` |
| `/e/rueckfall` | `,iidddh` | `deck`, `an` (1/0), `quell_beat_start`, `laenge_beats`, `beat`, `sample` |
| `/e/frist` | `,iddh` | `deck`, `beats_bis_ende`, `beat`, `sample`; bei 128, 64, 32, 16 Beats vor dem Ende eines hörbaren Decks |
| `/e/luecke` | `,hii` | `sample`, `frames` (Sprung der Treiber-Frame-Zeit, mit Vorzeichen), `zyklen` (ausgelassene Perioden bei einem Sprung bis 16 Perioden; 0 bei größerem oder negativem Sprung = Treiberwechsel, Uhr außen neu verankert, ADR 004; am Ziel kann er eine Periode kosten, Befund 08 B4) |
| `/e/quantum` | `,iih` | `alt`, `neu`, `sample` |
| `/e/raster` | `,isdfh` | `deck`, `material_id`, `quell_beat`, `versatz_ms` (Nudge oder Tap; aus `/k/deck/raster` die Änderung), `sample` |
| `/e/hotcue` | `,isidh` | `deck`, `material_id`, `nr`, `quell_beat`, `sample` |
| `/e/rueckweg` | `,sih` | `kanal`, `lebt` (0/1), `sample` |
| `/e/ki` | `,ish` | `gestoppt` (0/1), `grund`, `sample` |
| `/e/tempo` | `,dddh` | `bpm`, `ab_beat`, `dauer_beats`, `sample` (Hand-Tempo, höchstens 10 Hz) |
| `/e/neustart` | `,ih` | `generation`, `sample` (erste Nachricht einer neuen Generation an alle gespeicherten Abonnenten, und erneut an jeden, der sich in dieser Generation anmeldet, §4.1) |
| `/e/protokollfehler` | `,ss` | `adresse`, `grund` |

### 5.10 Notbahn `/nb ,iiih`

`zustand` (0 durchreichen, 1 Schleife, 2 ausgeblendet, 3 Rückgabe), `takte_in_schleife`, `generation_gesehen`,
`w` (Schreibzähler des Rings). Bei jeder Änderung und 1 Hz.

### 5.11 Loop-Boxen (MVP 2, ADR 025)

| Adresse | Typen | Felder | wann |
|---|---|---|---|
| `/e/loop` | `,iisiidf` | `box`, `status` (0 leer, 1 bereit, 2 wartet, 3 läuft, 4 endet, 5 tempo: seit 2026-09-30 nicht mehr gemeldet, ADR 026), `name`, `beats`, `fx_art`, `fx_beats`, `fx_wet` | bei jeder Änderung einer Box (Laden, Befehl, Einsatz und Ende am Sample, Tempo); `fx_*` bis Scheibe 3 immer 0, 1, 0 |
| `/e/mitschnitt` | `,siid` | `name`, `beats`, `status` (0 fertig, 1 abgelehnt oder Schreibfehler), `ab_beat` | wenn ein Mitschnitt endet: fertig geschrieben, abgelehnt (Tempo, Überlappung, Stop Cypher) oder abgebrochen (`/k/set/neu`) |

### 5.12 Beat-FX (AUFTRAG 2026-09-28: zwei Einheiten, drei Parameter)

| Adresse | Typen | Felder | wann |
|---|---|---|---|
| `/e/fx` | `,iidddddi` | `einheit` (1, 2), `art` (0 aus), `beats`, `wet`, `param1`, `param2`, `param3`, `an` (Einheit ON) | bei jeder Änderung der Einheits-Parameter |
| `/e/fx/zuweisung` | `,isi` | `einheit` (1, 2), `kanal`, `an` (zugewiesen) | bei jeder Änderung der Zuweisung |
| `/e/fx/routing` | `,i` | `routing` (0 Post Fader, 1 Insert) | bei jeder Änderung und einmal nach `/e/neustart` mit der Vorgabe 0 |

---

## 6. Shared Memory

Alle Layouts: Little Endian, gepackt wie angegeben, Kopf 64 Bytes, `_Atomic uint64` mit Release beim Schreiben und
Acquire beim Lesen. Anlegen: der Schreiber mit `O_CREAT`, Rechte 0600.

### 6.1 Audio-Ring `/dev/shm/cypherdj/bus` (Kern → Notbahn), Version 1

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
56      uint8[8]         reserve
64      float32[cap][4]  daten              (Frame f bei Index f % cap)
```

Der Kern schreibt je Zyklus `nframes` Frames ab `w`, setzt `takt_frames` und `takt_anfang_w` (beide vor `w`, Release),
dann `w += nframes`. Beim Start liest der Kern `w` und setzt fort. Die Notbahn liest einen Block hinter `w`; steht `w`
einen Zyklus lang still, beginnt die Schleife (ADR 016): sie spielt ab dem Stillstand weiter aus ihrem **eigenen
Verlauf** um genau `takt_frames` zurück, so bleibt das Master-Raster erhalten, bei jeder festen Set-Basis. Weil der Ring
mit `cap` = 65 536 Frames (1,37 s) kürzer ist als ein Takt (90 000 Frames bei 128), hält die Notbahn einen eigenen
Verlauf je Kanal von mindestens **384 000 Frames** (2 Takte bei 60 BPM; Vorlage `notbahn.c`: 524 288). Die Ausblendung
nach 8 Takten beginnt auf einer Takt-Eins (aus `takt_anfang_w`). In einer Tempo-Rampe weicht die Schleife um die
Längendifferenz zweier Takte ab (bei 128 → 132 über 8 Takte rund 7 ms je Durchlauf, gerechnet, ungemessen). Gegenüber
`proben/10-robustheit-betrieb/src/bus.h` (zwei Kanäle) neu: vier Kanäle, Kopf mit Magic, Version und Taktfeldern; die
Vorlage nahm den Takt aus einem festen `--bpm 128` beim Start, das entfällt.

### 6.2 Hüllkurven-Ring `/dev/shm/cypherdj/huellen` (Kern → Analyse), Version 1

```
Kopf:  char[4] magic = "CDJH"; uint32 version = 1; uint32 rate_hz = 1000; uint32 n_kanaele = 16;
       uint32 cap = 16384; uint32 reserve[3]; _Atomic uint64 w (Datensätze je Kanal); uint8 reserve[24]
Datensatz (64 Bytes): int64 sample; float64 beat; float64 quell_beat (NaN außer Decks);
       float32 band[6]; float32 k_leistung; float32 spitze; float32 reserve[2]
Lage:  Datensatz r von Kanal c bei 64 + ((r % cap)·16 + c)·64
Kanäle: 0 bis 3 deck/1..4, 4 bis 11 erz/1..8, 12 pad/1, 13 pad/2, 14 master, 15 cue
```

Kanal 14 `master` ist die Master-Summe **vor** `master/pegel` und Limiter (gleiche Stufe wie ein Kanal bei Fader 0);
Kanal 15 `cue` ist die Cue-Summe wie ausgegeben.

Ein Datensatz je 48 Samples (1 kHz), `sample` = letztes Sample des Fensters. **`band[0..5]`** = RMS (linear) über
die 48 Samples in den **sechs Analyse-Bändern** Sub 30 bis 90, Tief 90 bis 250, Tiefmitte 250 bis 800, Mitte 800 bis
2000, Präsenz 2000 bis 6000, Hoch 6000 bis 16000 Hz (08 §3.3.1), am Mess-Abgriff (nach EQ und Filter, vor dem Fader,
ADR 008). Die Bandfilter sind im Kern fest: je Band ein Bandpass aus zwei Butterworth-Filtern vierter Ordnung (Hochpass
an der unteren, Tiefpass an der oberen Grenze), kausal, als Biquad-Kaskade; die Koeffizienten stehen als Tabelle in
`djk/vertrag/baender.json` (V0), damit Werkstatt und Kern bitgleich rechnen. `k_leistung` = mittlere K-gewichtete
Leistung (BS.1770); `spitze` = Betragsmaximum. Der Kern schreibt alle 16 Kanäle eines Datensatzes, dann `w = r + 1`.
Leser verwerfen Datensätze älter als `w − cap + 1024`. Der Kern rechnet die Bänder nur für belegte Kanäle (Deck
geladen, Erzeuger oder Pad aktiv); für leere Kanäle schreibt er Nullen. Kosten gerechnet in der Größenordnung des LR8-Isolators (04 §4.8:
5,4 bis 10,9 µs je Kanal und Block), ungemessen: M3 misst sie mit. Die sechs Bänder tragen Takt-Bericht, Hörschein und
Überdeckung (§14.5, §14.8); `/pegel` (§5.6) zeigt weiter die drei Isolator-Bänder für die Anzeige.
Anschläge (Deck gegen Deck, Tief-Band) sucht die Analyse auf `band[0] + band[1]` (Leistung addiert) **nach einer
Glättung**, weil eine kurze RMS-Hüllkurve bei 50-Hz-Kicks mit 100 Hz rippelt (08 §4.0 Fehlerfall 1: 5-ms-RMS 64
Falschtreffer); das Verfahren samt Kontrolle (Klickraster, 50-Hz-Kick) legt der Plan von Scheibe 2 fest, ungemessen.

### 6.3 Neustart-Zustand `/dev/shm/cypherdj/zustand`

Kern-intern (Layout in `djk/kern/include/cypherdj/zustand.h`, Version im Kopf, Seqlock). Inhalt, den jede Fassung
tragen muss: Magic, Version, Seqlock-Zähler, `generation`, Anker (`anker_sample`, `anker_mono_ns`), Tempo-Karte (64
Segmente), je Deck (Material, Basis, läuft, Anker Master-Beat ↔ Quell-Beat, Loop, Roll, Schatten, Hotcues, Hörweg),
alle Regler mit Wert und Halter, Hörscheine, KI-Stopp, KI-Spur, ausstehende Befehle (bis 256) mit Stand,
**Abonnenten** (bis 8: Name, Port, Protokoll, letzte Meldung in `mono_ns`). Andere Bausteine lesen ihn nicht (Ausnahme:
Prüfstand, nur lesend).

### 6.4 Arbeitsbestand `/dev/shm/cypherdj/material/<material_id>/`

Dieselben Dateinamen wie im Bestand (§13.1), nur die für das Set gewählten Fassungen (je Fassung Basis-Datei oder
Stems, je nachdem, wie geladen wird). Geschrieben vom Leitstand
(Kopie, dann `rename` des Ordners), gelesen vom Kern-Lader. Gelöscht wird ein Ordner erst, wenn kein Deck ihn geladen
hat.

### 6.5 Kiste `/dev/shm/cypherdj/kiste.json`

Atomar vom Leitstand geschrieben (temporäre Datei, `rename`), gelesen vom Kern (Controller-Browser) und vom Rechner.

```json
{"version":1,"geaendert_sample":1800000,"eintraege":[
  {"material_id":"3fa1c09b2e7d4410","titel":"Nightshift","quelle_bpm":124.86,
   "fassungen":[{"basis_bpm":128.0,"fassung":1,"stems":true}],
   "dauer_beats":352.0,"lufs":-9.4,"camelot":"8A","tore_ok":true,"nur_fuer_andreas":false}]}
```

Laden aus der Kiste nimmt die höchste Fassung zur Set-Basis, mit Stems, wenn vorhanden.

---

## 7. MIDI und Controller

### 7.1 Ports

`cypherdj-kern:hand_in` (JACK-MIDI-Eingang; verbunden mit der Midi-Bridge-Quelle des Controllers),
`cypherdj-kern:hand_led` (Ausgang zum Controller), `cypherdj-kern:midi_aus_1` bis `_4` (an Wirte, Geräte),
`cypherdj-kern:clock` (später, MIDI-Clock 24 ppq). Verbunden wird mit den JACK-Namen; welche, steht im Mapping.

### 7.2 Mapping-Datei `~/.config/cypherdj/controller/<geraet>.json`

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

- `art`: `absolut` (Poti, Fader; Übernahme **skaliert**), `relativ` (Endlos-Encoder; `kodierung` `zweierkomplement`
  oder `versatz64`), `beruehrung` (Berührungssensor: Halterwechsel ohne Wert), `taste`.
- `ziel`: ein Regler-Pfad (§1.5), eine Deck-Aktion `deck/<n>/<aktion>` (`play`, `cue`, `hotcue/<nr>`,
  `hotcue_setzen/<nr>`, `loop`, `loop_laenge`, `roll/<beats>`, `sprung_plus`, `sprung_minus`, `nudge`, `tap`, `slip`,
  `pfl`, `laden`), `tempo` (Hand-Segment, relativ), oder `taste/<name>` (Namen wie in §5.8).
- `quant` für Deck-Tasten: `sofort` (phasentreu), `beat`, `takt`.
- `kurve.typ`: `linear` (Einheit linear zwischen `min` und `max`), `fader_db` (Fader-Kurve: 0 bis 1 → dB, unterhalb
  −60 dB stumm).
- Standard für Controller-EQ (A27 Weg a): Kurve `linear` von −26 bis +6 dB mit `kill_unter_min` = true (unter dem Minimum Kill), wie im Beispiel oben.

### 7.3 Semantik der Hand

1. Jedes MIDI-Ereignis wirkt am Sample seines Versatzes im Zyklus der Ankunft (eine Periode nach dem Senden, 09 Probe c).
2. **Erster Wert** eines absoluten Reglers nach Start oder Neuverbindung setzt nur die Stellung.
3. Hält ein Plan den Regler, übernimmt die Hand erst, wenn sich die physische Stellung um mehr als **3/128** vom
   Übernahmepunkt entfernt (Totzone) oder der Berührungssensor auslöst; dann Halter `mensch` am selben Sample,
   Abbruch des Teils und seiner Gruppe (`/q` Status 7, Grund `hand`), Übernahme **skaliert** (absolut) bzw.
   **relativ** (Encoder) ohne Sprung.
4. **Rückgabe** an `frei`: Freigabe-Geste (`taste/freigabe` plus Berühren oder Bewegen des Reglers) oder **32 Beats**
   ohne Handbewegung am Regler; Ereignis `/e/halter`.
5. **Deck-Halter:** jede Transport-Taste eines Decks setzt `deck/<n>/transport` für 32 Beats auf `mensch`.
6. Deck-Tasten im Direktweg wirken sofort phasentreu (oder quantisiert nach `quant`); auf dem Stretcher-Weg auf dem
   nächsten erreichbaren Rasterpunkt (`vorlauf_ms`), ohne Quantize nach `vorlauf_ms`.
7. **Tempo-Encoder** verändert den Zielwert des Hand-Segments in Schritten von 0,01 BPM; jede Änderung fährt das
   Hand-Segment als Rampe über 1 Beat (§1.3), nie als Sprung. `taste/tempo_basis` (Umschalt plus Tempo) setzt es
   zurück auf die Set-Basis (ebenfalls Rampe über 1 Beat). Bis Scheibe 5 ohne Wirkung, solange ein Deck läuft (kein
   Stretcher-Weg). Auf dem Stretcher-Weg gilt nach M4 (2026-09-25, Scheibe 33,
   `messungen/M04-tempo-rampen/BERICHT.md`): der Faktor wird **höchstens alle 43 Blöcke** (229 ms bei Quantum 256) neu
   gesetzt, auch vom Phasenregler, weil jede Änderung Phase kostet, unabhängig von ihrer Größe (E3); der Phasenregler
   (ARCHITEKTUR §4 Regel 5) arbeitet am Verzögerungsmodell (D = 50 ms) mit |c| ≤ 100 ppm (E5; „10 ppm je Block“ läuft
   weg); der Stretcher bekommt **nie einen Faktor näher als 10⁻⁶ an 1,0**, auf der Basis spielt der Direktweg (E4:
   Rückkehr auf genau 1,0 springt bis 87 ct). Null-Samples erzeugen kleine Änderungen in der Zeit-Bauart nicht (E7, E9).
8. **Stopp-Taste** wirkt im Kern wie `/k/ki/stopp`, auch ohne Leitstand; **Freigabe** plus Stopp wie `/k/ki/frei`.
9. **Kiste-Browser:** Encoder blättert in `kiste.json` (Anzeige über LEDs oder Ansage-Zeile), `deck/<n>/laden` lädt den
   gewählten Eintrag mit der Set-Basis; geht auch bei totem Leitstand, sofern das Material im Arbeitsbestand liegt.
10. „Cypher hören“ schaltet die PFL des Kanals aus `/k/vorschlag_kanal` um.
11. **Takt-Eins von Hand:** Umschalt plus `tap` auf einem Deck erklärt den nächsten Schlag unter dem Lesekopf zur
    Takt-Eins; Ereignis `/e/raster` mit `versatz_ms` = NaN und `quell_beat` des Schlags, der Leitstand schreibt eine
    Korrektur der Art `eins` (§13.3), die Werkstatt rendert daraus eine neue Fassung (§12.1 `korrigieren`).

### 7.4 LED-Namen

`vorschlag`, `plan_laeuft`, `rueckfall`, `notbahn`, `ki_gestoppt`, `autonomie_0` bis `autonomie_3`,
`deck<n>_halter_andreas`, `deck<n>_halter_cypher`, `deck<n>_hoerschein_ok`, `deck<n>_hoerschein_rot`,
`deck<n>_frist` (blinkt in den letzten 4 Takten), `deck<n>_loop`, `deck<n>_roll`. Zuständig: Halter, Loop, Roll, Frist,
Notbahn, KI-Stopp setzt der Kern selbst; Vorschlag, Plan, Hörschein, Autonomie der Leitstand über `/k/led`.

---

## 8. Audio-Ports und Graph

| Client | Ports | Eigenschaften |
|---|---|---|
| `cypherdj-kern` | Eingänge `rueck_erz_1_L/R` bis `rueck_erz_8_L/R`, `puls_erz_1` bis `_8`, `rueck_fx_1_L/R`, `rueck_fx_2_L/R`, `puls_fx_1`, `puls_fx_2`; Ausgänge `send_1_L/R`, `send_2_L/R` (später) | `node.group = "cypherdj"`, `node.lock-quantum = true`, Quantum aus der Unit (`PIPEWIRE_QUANTUM=256/48000`); keine Ausgänge ans Interface |
| `cypherdj-notbahn` | Ausgänge `master_L`, `master_R`, `cue_L`, `cue_R` | `node.group = "cypherdj"`, `node.lock-quantum = true`; verbindet sich selbst mit den Ports aus ihren Aufrufparametern (`--master <jack-port-präfix> --cue <jack-port-präfix>` im `ExecStart` der Unit; kein TOML in C, auf DJ-Maschine gibt es keinen C/C++-TOML-Parser), nur nach dem Riegel unten |
| `cypherdj-aufnahme` | Eingänge `in_1` bis `in_4` | an die vier Notbahn-Ausgänge |
| `cypherdj-wirt-<gruppe>`, `cypherdj-klang-sunvox` (später) | Ausgänge `out_L/R`, `puls` | `node.async = true` (über `PIPEWIRE_PROPS`), Eingang MIDI von `midi_aus_<p>` |

**Puls:** jeder Wirt schreibt auf `puls` in jedem Zyklus den Wert `(zyklus mod 1024) / 1024` in alle Samples. Ändert er
sich zwei Zyklen lang nicht, blendet der Kern den zugehörigen Rückweg über 5 ms aus und meldet `/e/rueckweg` (lebt = 0).

**Portnamen unter `pw-jack`:** die Null-Senke heißt aus JACK-Sicht nach ihrer Beschreibung, z. B.
`cypher-stumm-probe:playback_FL` (01 §3.2); Tests verbinden mit JACK-Namen, nie automatisch.

**Riegel gegen ungefragten Ton** (00-anforderungen §9 „Kein Ton ohne Frage“; Vorlage `notbahn.c` Z. 90): jeder
Baustein, der selbst Ports verbindet (Notbahn, später Aufnahme, Wirte), prüft das Ziel gegen eine Positivliste: der
Portname enthält `stumm` oder beginnt mit `cypherdj-pruef-` (eigene Null-Senke je Prüflauf). Andere Ziele verbindet er
nur mit dem Aufrufparameter `--ton-frei` (Notbahn) bzw. `ton_frei = true` (TOML-Bausteine), Vorgabe aus; gesetzt wird
er erst mit Andreas' Freigabe für sein Interface. Sonst Abbruch mit Meldung, Rückgabewert 3. Test-Units laufen nur
transient (`systemd-run --user`), nie `systemctl --user enable`.

---

## 9. Leitstand-WebSocket (`ws://127.0.0.1:47200/`)

### 9.1 Umschlag

Jede Nachricht ist ein JSON-Objekt:

```json
{"v":1,"seq":1234,"von":"leitstand","typ":"takt",
 "zeit":{"sample":1800000,"beat":80.0,"takt":21,"phrase":3},"daten":{}}
```

`seq` zählt je Verbindung und Richtung streng steigend; eine Lücke heißt: der Empfänger fordert `lage` neu an.
`zeit` ist der Kern-Zeitpunkt, auf den sich die Nachricht bezieht (bei Anfragen ohne Bezug: letzter bekannter
Blockanfang).

### 9.2 Anmeldung

Client → Leitstand: `{"typ":"hallo","daten":{"rolle":"spieler|mcp|analyse|werkstatt|ansage|anzeige|pruefstand",
"name":"...","protokoll":1}}`. Antwort `{"typ":"willkommen","daten":{"rolle":"...","set_id":"2026-09-24_2100",
"generation":0,"autonomie":1}}`. Rollen `ansage` und `anzeige` sind nur lesend.

### 9.3 Leitstand → Clients

| `typ` | an | Inhalt |
|---|---|---|
| `takt` | alle | Takt-Zustand (§14.7) für den begonnenen Takt, mit Analyse-Bericht des vorigen |
| `ereignis` | alle | `{"art": ..., ...}`, Arten: `plan_angenommen`, `plan_verriegelt`, `plan_vorgeschlagen`, `teil_gestartet`, `teil_fertig`, `teil_abgebrochen`, `invariante`, `rueckfall`, `hand`, `halter`, `hoerschein`, `vorschlag_angenommen`, `vorschlag_verworfen`, `vorschlag_verfallen`, `material_fertig`, `auftrag_status`, `geladen`, `notbahn`, `luecke`, `quantum`, `ki_stopp`, `autonomie`, `urteil`, `zug_antwort`, `tempo`, `set_basis`, `neustart` |
| `zug_anfrage` | spieler | `{"zug_id":"z41","anlass":["frist"],"antwort_bis_beat":432.0,"lage":{Takt-Zustand},"kandidaten":[Kandidat],"hinweis":"..."}` |
| `ansage` | ansage, anzeige | `{"text":"T 113: Nightshift rein, sicher 16 T, Basstausch T 121","art":"vorschlag|plan|rueckfall|warnung|info"}` |
| `rpc_antwort` | Aufrufer | `{"id":17,"ergebnis":{...}}` |
| `rpc_fehler` | Aufrufer | `{"id":17,"code":"...","text":"..."}` |
| `auftrag` | werkstatt | Werkstatt-Auftrag (§12.1) |

### 9.4 Clients → Leitstand

| `typ` | von | Inhalt |
|---|---|---|
| `rpc` | mcp (und später anzeige) | `{"id":17,"methode":"waehle","parameter":{...}}`; Methoden = MCP-Werkzeuge (§10) |
| `takt_bericht` | analyse | Bericht für einen abgeschlossenen Takt (§14.8) |
| `hoerschein` | analyse | Hörschein (§14.5) |
| `auftrag_status`, `material_fertig` | werkstatt | §12.2 |
| `zug_status` | spieler | `{"zug_id":"z41","stand":"gesendet|antwort|zeitueberschreitung","dauer_ms":1480}` |
| `zuruf` | ansage | `{"text":"mehr Druck im Bass"}` (Andreas tippt eine Zeile; wird Zug-Anlass `zuruf`) |

---

## 10. MCP-Werkzeuge für Cypher

Jede Rückgabe enthält `"jetzt":{"takt":..,"schlag":..,"beat":..,"seq":..}`. Fehler als MCP-Fehler mit `code` aus §16.2.
Werkzeuge in Takten sind die **Eingabeform für das LLM**; der Leitstand rechnet deterministisch um: `ab_beat =
(ab_takt − 1)·4 + (ab_schlag − 1)`, `dauer_beats = dauer_takte·4`. Die kanonische Planform ist in Beats (§14.1).

| Werkzeug | Eingabe | Rückgabe | ab Scheibe |
|---|---|---|---|
| `lage` | `{}` | Takt-Zustand, Ereignisse seit dem letzten Aufruf | 1 |
| `warte` | `{"bis_takt"?:int, "auf"?:[ereignis-art], "max_s":≤30}` | wie `lage`, sobald es eintritt | 1 |
| `waehle` | `{"material_id":str, "spielart":str, "start_takt":int, "hoerschein":str, "einstieg_quell_beat"?:f, "deck"?:int, "laenge_takte"?:int, "absicht"?:str≤200}` (ohne `einstieg_quell_beat` gilt der des Kandidaten) | `{"status":"angenommen|vorgeschlagen|verriegelt|abgelehnt","plan_id":str,"gruende":[{"teil":int,"grund":str,...}],"vorhersage":{"ueberdeckung_max":{"sub":f,"tief":f},"lufs_abw_max_lu":f},"ansage":str}` | 2 |
| `plan_einreichen` | Plan in Menschenform: `{"spielart"?:str, "hoerschein"?:str, "grund":str, "teile":[{"regler":pfad,"art":"rampe|setze","ab_takt":int,"ab_schlag"?:1..4,"dauer_takte"?:f,"nach":f}]}` | wie `waehle` | 2 |
| `plan_abbrechen` | `{"plan_id":str, "teile"?:[int]}` | Status je Teil, Werte beim Abbruch | 2 |
| `laden` | `{"deck":int, "material_id":str}` | Auftrag; `geladen` kommt als Ereignis | 2 |
| `vorhoeren` | `{"deck":int, "ab_takt"?:int, "einstieg_quell_beat"?:f}` (Vorgabe: Einstieg des Kandidaten, sonst Hotcue 1, sonst erste Phrase ab der Takt-Eins) oder `{"pad":int, "material_id":str, "schuss_nr":int}` | nur auf einem geschlossenen Deck oder Pad (sonst `deck_hoerbar`); das Deck startet synchron **am Einstieg** und läuft hinter dem Fader mit; Hörschein nach 4 Takten als Ereignis, danach Erneuerung je Takt | 2 |
| `bestand` | `{"filter"?:{"camelot"?,"bpm_von"?,"bpm_bis"?,"frisch_seit_min"?,"nur_tore_ok"?:bool}, "max":≤20}` | Einträge der Kiste mit Kurz-Fingerabdruck | 2 |
| `passung` | `{"a":material_id, "b":material_id}` | Passung plus Vorhersage je Spielart (§11) | 2 |
| `erzeuge` | `{"stil":str, "text":str, "dauer_s":int, "ziel_bpm":f, "tonart"?:str, "anzahl"?:1..4}` | `{"auftrag_id":str,"erwartet_fertig_takt":int}`; `material_fertig` als Ereignis | 4 |
| `spielzettel` | `{"zeilen":str}` | Fehler mit Zeilennummer, betroffene Spuren ab Beat | 7 |
| `markieren` | `{"text":str, "art":"absicht|hypothese|urteil_erbeten"}` | Journal-Zeile | 1 |

Autonomie (vom Leitstand durchgesetzt, **Positivliste** wie ADR 013 Entscheidung 4):

- **Stufe 0:** `waehle`, `plan_einreichen`, `laden`, `vorhoeren`, `erzeuge` werden abgelehnt (`autonomie`); `lage`,
  `warte`, `bestand`, `passung`, `markieren` gehen.
- **Stufe 1:** **jede** Einreichung aus `waehle` oder `plan_einreichen` wird ein Vorschlag (`vorgeschlagen`), gleich
  was ihre Teile tun (EQ auf +6 dB, Stem auf 0, Send, Hotcue, Sprung, Loop auf Andreas' laufendem Deck sind
  Vorschläge, auch wenn sie keinen Kanal öffnen). Allein erlaubt sind nur `laden`, `vorhoeren`, `erzeuge`,
  `plan_abbrechen` eigener Pläne und ein Plan, dessen Teile **ausschließlich** Kanäle der KI-Spur leiser machen
  (Fader oder Send nach unten, Kill an).
- **Stufe 2:** wie 1, zusätzlich direkt: Pläne, deren Teile ausschließlich Kanäle der KI-Spur betreffen (hinter dem
  Fader, den nur Andreas hält); alles andere wird Vorschlag.
- **Stufe 3:** alles direkt.

Invarianten gelten auf jeder Stufe. Ein angenommener Vorschlag geht mit Quelle `cypher` an den Kern; Deck-Teile daraus
tragen `hoerschein` = `annahme:<vorschlag_id>` (§4.4). Golden-Folge `autonomie_1_eq` (§19.3): Stufe 1, Plan mit einem
EQ-Teil an einem hörbaren Deck → `vorgeschlagen`, kein `/k/teil` an den Kern.

---

## 11. Rechner (Unix-Socket, JSON-Zeilen)

Anfrage `{"id":5,"methode":"...","parameter":{...}}\n`, Antwort `{"id":5,"ergebnis":{...}}\n` oder
`{"id":5,"fehler":{"code":"...","text":"..."}}\n`. Eine Anfrage je Zeile, Antworten in beliebiger Reihenfolge.

| Methode | Parameter | Ergebnis | Zeitgrenze |
|---|---|---|---|
| `spielarten` | `{}` | Liste der Spielarten (§14.4) | 1 s |
| `passung` | `{"a":id,"b":id}` | Passung (§14.6) | 5 s |
| `kandidaten` | `{"deck_laufend":int,"material_laufend":id,"quell_beat":f,"frist_takt":int,"anzahl":≤3,"ausschluss":[id]}` | `[Kandidat]` (§14.6), sortiert | 5 s (ungemessen) |
| `expandiere` | `{"wahl":Wahl,"lage":Takt-Zustand}` | `{"plan":Plan,"vorhersage":{...}}`; Teile genau nach der Regel §14.4, mit Deck-Teil `start` am Einstieg (§14.1) | 2 s (Faustregel), Optimierer nur auf Anfrage |
| `vorhersage` | `{"plan":Plan}` | `{"ueberdeckung_je_takt":{"sub":[..],"tief":[..],...},"lufs_je_takt":[..],"grenzen_ok":bool,"warnungen":[str]}` | 2 s |

Die Vorhersage rechnet mit den Kreuzenergien der Fassung (Filter LR8 246/2484 Hz, §13.1; aus dem, was klingt: Stem-Summe
oder Basis-Datei); realistischer Fehler 0,038 Überdeckung und 0,41 LU (08 NP K2); sie gilt nur bei Stem-Reglern auf
0 dB (Pläne mit Stem-Teilen bekommen eine Warnung). **`grenzen_ok` prüft nur `grenze_sub`.** Die Tief-Grenzen sind
ungeeicht: die gemessene Faustregel selbst liegt über ihnen (Tief 0,402 bei Grenze 0,20 für „sicher“, 0,355 bei 0,35
für „hart“, 08 NP K1); bis M20 (Nachrechnung) melden sie nur `warnungen` (`leitstand.toml`
`grenzen_tief_verriegeln = false`).

---

## 12. Werkstatt

### 12.1 Auftrag (Leitstand → Werkstatt, WS-Typ `auftrag`)

```json
{"auftrag_id":"a7","art":"generieren","vorrang":2,"set_basis_bpm":128.0,
 "parameter":{"stil":"deep house, warm pads","text":"...","dauer_s":260,"ziel_bpm":126.0,"tonart":"8A","anzahl":1}}
```

| `art` | `parameter` | Vorrang (1 höchster) |
|---|---|---|
| `generieren` | `stil`, `text`, `dauer_s`, `ziel_bpm`, `tonart`?, `seed`?, `anzahl`? | 2 |
| `einlesen` | `quelle_pfad` (Datei auf DJ-Maschine) | 2 |
| `nachrendern` | `material_id`, `basis_bpm`, `mit_stems`, `mit_schuessen` → **neue Fassung** (§13.1) | 1 |
| `korrigieren` | `material_id` (Raster-, Eins- und Hotcue-Korrekturen aus `korrekturen.jsonl` bis zur letzten Zeile einrechnen) → **neue Fassung** mit `r + 1`, dieselbe Basis; alte Fassungen bleiben unverändert | 1 |

### 12.2 Rückmeldungen (Werkstatt → Leitstand)

- `auftrag_status`: `{"auftrag_id":"a7","stand":"wartet|laeuft|fertig|fehler","schritt":"generieren|dekodieren|raster|warp|stems|fingerabdruck|tore|veroeffentlichen","fortschritt":0.4,"erwartet_fertig_s":820,"grund":""}`,
  bei jedem Schrittwechsel und alle 10 s.
- `material_fertig`: `{"auftrag_id":"a7","material_id":"3fa1c09b2e7d4410","basis_bpm":128.0,"fassung":1,"pfad":"~/cypher-dj/bestand/3fa1c09b2e7d4410","tore":{Tore},"nur_fuer_andreas":false,"warnungen":["Gesang verstimmt (−22 ct)"],"dauer_s":{"generieren":1012,"raster":41,"warp":65,"stems":null,"fingerabdruck":33}}`.

### 12.3 Kette, Tore, Generierung

- Kette und Reihenfolge: ADR 011 Entscheidung 2. Jeder Schritt schreibt in `~/cypher-dj/bestand/.arbeit/<auftrag_id>/`.
  Ein neues Material wird als ganzer Ordner per `rename` nach `~/cypher-dj/bestand/<material_id>/` veröffentlicht;
  jede weitere Fassung (Nachrendern, Korrektur) als eigener Ordner per `rename` nach
  `<material_id>/fassungen/<bpm·1000>_r<n>/` (§13.1). Nichts Vorhandenes wird überschrieben.
- **Tempo-Wahl:** die Kette wählt unter Quell-BPM × {½, 1, 2} das Vielfache, dessen Streckfaktor zur Set-Basis
  (`basis_bpm / (Quell-BPM × v)`) am nächsten bei 1 liegt; Halb- und Doppeltempo ändern nur die Schlagzählung der
  Tempo-Karte. `material.json` vermerkt `tempo_vielfaches`.
- **Stimmung:** stimmen beide Werkzeuge (eigenes Verfahren aus `fa.py`, Essentia) auf höchstens 10 Cent überein und
  liegt die Abweichung von A = 440 Hz unter `stimmung_max_cent` (35), rechnet die Kette sie im selben R3-Lauf wie den
  Warp heraus (`stimmung_korrektur_cent` in `fassung.json`); sonst keine Korrektur und eine Warnung. Live gibt es keinen
  Tonhöhen-Regler, der Direktweg bleibt bitgenau (ADR 012). Tonhöhe der Korrektur ungemessen: M19.
- **Stems im Set:** auf der GPU nur bei `stems_gpu = true` (erst nach Andreas' Antwort, ARCHITEKTUR §13 Frage 4); auf der
  CPU während eines Sets nur bei Quantum 256 (`stems_cpu_im_set = "nur_256"`: 10 NP N6, 15 % der Periode bei 256, 55 %
  bei 128), als Werkstatt-Job mit `Nice=19`, `CPUSchedulingPolicy=batch`, höchstens `threads` Fäden; bei 128 nie.
- **Tore** (`fassung.json` Feld `tore`, Schwellen vorläufig bis M13 und M19; ein Tor misst **nie mit dem Werkzeug, das
  die Karte gesetzt hat**, 08 NP K3):
  - `raster` ok, wenn die **unabhängig** gemessenen Tief-Band-Anschläge am gewarpten Ergebnis (Verfahren
    `proben/08-analyse-passung/fa.py` Anschläge: Hilbert-Hüllkurve 30 bis 250 Hz, 50-%-Punkt; Kontrolle Klickraster 32
    von 32, 0,38 ms, 08 §4.0) gegen das starre Raster einen Rest ≤ 8 ms p90 haben (Flam-Untergrenze), bei mindestens
    64 Anschlägen; weniger Anschläge gelten als unbestimmt und damit als gerissen. beat_this und Essentia prüfen hier
    nicht, sie setzen die Karte.
  - `klarheit` ok, wenn die Pulsklarheit (Verfahren `c_drift.py`) ≥ 0,1. Die frühere Ausnahme „beide Raster-Werkzeuge
    stimmen überein“ entfällt: beide setzen die Karte, und unter 0,1 trennt die Kennzahl Rauschen nicht von Drift
    (c_drift: 8 von 10 MiniMax-Songs liegen unter 0,1).
  - `streckfaktor` ok, wenn |Streckfaktor − 1| ≤ `tor_streckfaktor` (0,20 aus M19, §2.1, 2026-09-25) nach der Tempo-Wahl (gesetzt; gemessen ist Keylock nur bis rund
    ±5 %, ERGEBNIS: 0,95522 und 1,04121; M19 misst 0,7 bis 1,4).
  - `eins` ok, wenn die Takt-Eins aus beat_this (Downbeat-Ausgabe) und das zweite Verfahren (Schlagposition mit der
    stärksten Tief-Band-Energie über das ganze Stück, aus `fa.py` `energie_profil16`; Vermutung, M13) übereinstimmen.
  - `headroom` ok, wenn die Echtspitze nach dem Warp ≤ −1 dBTP vor dem Trim.
  Ein gerissenes Tor setzt `nur_fuer_andreas: true` (für Andreas eine Warnung, für Cypher eine Sperre, ADR 011).
- **Generierung:** HTTP an ComfyUI der GPU-Maschine (MiniMax Music 3); Workflow-Datei `djk/werkstatt/workflows/minimax.json`;
  Ergebnisdatei per `/view` abholen; Prompt-Regeln nach Skill `cypher-musik` (Dauer 40 bis 50 % über der Ziellänge,
  Text für die volle Länge). Mehrere Seeds eines Auftrags in einem Lauf. Ob MiniMax ein Ziel-BPM im Prompt trifft, ist
  ungemessen (M14); der Skill rät von exakten BPM ab („Exakte BPM nur wenn begründet, sonst Bereich oder qualitativ“,
  `cypher-musik/SKILL.md` Z. 59), und die zehn vorhandenen Songs liegen bei 89,9 bis 180,7 BPM (c_drift.log). Der Text
  des Prompts wird als `text` ins Material übernommen (A13 „Text“, §13.2).
- **Zerleger** (ab Scheibe 6, Entwurf): eigene Sonnet-Sitzung mit einem MCP-Server der Werkstatt (Werkzeuge
  `auftraege`, `ergebnis_ansehen`, `loops_setzen`, `hotcues_setzen`, `warnung`, `freigeben`); der Vertrag dafür kommt
  mit dem Plan der Scheibe 6.

---

## 13. Bestand

### 13.1 Ordner `~/cypher-dj/bestand/<material_id>/` (Fassungen unveränderlich)

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

`r` zählt je Basis-Tempo ab 1: Nachrendern auf eine neue Basis beginnt bei `r1`, jede Korrektur (`korrigieren`) legt
`r + 1` daneben. Kein Programm ändert eine veröffentlichte Fassung; `material.json` und `original.*` schreibt nur das
erste Einlesen. Deck und Hörschein binden immer (Material, Basis, Fassung) (§4.4, §4.5).

**Was klingt, daraus wird gerechnet:** hat eine Fassung Stems und lädt der Kern sie mit (`mit_stems = 1`), klingt die
Stem-Summe; dann rechnet die Werkstatt `fingerabdruck.json`, `kreuzenergie.npy` und `huelle_1khz.npy` aus der
Stem-Summe, sonst aus `basis.f32`. `fassung.json` Feld `analyse_quelle` sagt, woraus (`stems` oder `basis`); eine Fassung
ohne Stems hat `analyse_quelle = basis`, eine mit Stems immer `stems` (das Deck lädt sie dann mit Stems).

**`huelle_1khz.npy`:** float32 `[6, N]`, dieselben sechs Bandfilter (Koeffizienten `djk/vertrag/baender.json`) und
dasselbe RMS-Fenster (48 Samples, nicht überlappend) wie der Hüllkurven-Ring (§6.2), angewandt auf die Fassung ohne
Trim; Index `i` = Datensatz über die Frames `[48·i, 48·i + 48)` der Datei, also `i = frame / 48` (ganzzahlig), linear.
Damit vergleicht die Analyse (§14.8) gleich gefilterte Kurven.

**Raster der Fassung:** Frame des Quell-Beats `q`: `frame(q) = erster_schlag_frame + q · 60 / basis_bpm · 48000`
(starr). **Tausch der Fassung:** gleicher `quell_beat`, andere Fassung: `frame' = erster_schlag_frame' + q · 60 /
basis' · 48000`.

### 13.2 `material.json` und `fassung.json` (Schema-Version 1)

`material.json` (einmal geschrieben, Quelle und erste Erkennung):

| Feld | Typ | Bedeutung |
|---|---|---|
| `schema` | int | 1 |
| `material_id`, `titel` | str | |
| `herkunft` | obj | `art` (`minimax` \| `datei` \| `aufnahme`), `prompt`, `stil`, `seed`, `generator`, `erzeugt_am` (ISO 8601), `auftrag_id` |
| `text` | obj | `{"quelle": "prompt" \| "keiner", "zeilen": [str]}`; bei MiniMax aus dem Prompt übernommen, nicht aus dem Audio erkannt; Texterkennung später mit dem Zerleger (Scheibe 6) |
| `quelle` | obj | `datei`, `sr`, `kanaele`, `dauer_s`, `sha256` |
| `tempo_karte_quelle` | arr | `[[quell_sekunde, quell_beat], ...]` je Schlag, aus dem Raster-Werkzeug |
| `raster` | obj | `werkzeug` (`beat_this`), `zweitwerkzeug` (`essentia`), `abweichung_ms_p90` (Form: p90 der Abweichung zum Zweitwerkzeug nach Abzug des konstanten Versatzes), `versatz_zweitwerkzeug_ms` (dieser konstante Versatz, mit Vorzeichen, Werkzeug minus Zweitwerkzeug; beide Felder Andreas 2026-09-25, B11), `pulsklarheit`, `erster_schlag_quelle_s`, `taktart` (4), `tempo_vielfaches` (½, 1, 2), `erste_eins_quell_beat` (0 bis 3, Downbeat aus beat_this), `erste_eins_zweitverfahren` |
| `lautheit_quelle` | obj | `lufs_integriert`, `echtspitze_dbtp`, `crest_db` der Quelldatei |
| `tonart` | obj | `camelot`, `r`, `vorsprung`, `stimmung_cent`, `stimmung_r`, `stimmung_cent_zweitwerkzeug`, `aus_stems` |

`fassung.json` (je Fassung, einmal geschrieben):

| Feld | Typ | Bedeutung |
|---|---|---|
| `schema`, `material_id`, `basis_bpm`, `fassung` | | |
| `korrekturen_bis_zeile` | int | wie viele Zeilen von `korrekturen.jsonl` eingerechnet sind (0 = keine) |
| `datei`, `frames`, `sha256`, `erster_schlag_frame`, `beats` | | Basis-Datei |
| `erste_eins_quell_beat` | int | gültige Takt-Eins dieser Fassung (nach Korrekturen) |
| `analyse_quelle` | str | `stems` oder `basis` (§13.1) |
| `stems` | obj | `{name: {datei, sha256, frames}}` oder `{}` |
| `schuesse` | arr | `[{nr, datei, frames, quell_beat, name}]` |
| `headroom_db` | float | −12 (Luft vor R3) |
| `stimmung_korrektur_cent` | float | im Warp herausgerechnet (§12.3), 0 ohne Korrektur |
| `lautheit` | obj | `lufs_integriert` (dieser Datei, nach Luft und Warp; daraus setzt der Kern den Trim, §1.5), `echtspitze_dbtp`, `crest_db`, `lufs_je_takt` |
| `struktur` | obj | `phrasen`: `[{ab_beat, bis_beat, art: intro\|aufbau\|drop\|break\|outro\|unbekannt}]` (Quell-Beats, Phrasen ab der Takt-Eins) |
| `hotcues` | arr | `[{nr, quell_beat, name, von: werkstatt\|andreas}]` (Vorschläge an Phrasen ab der Takt-Eins) |
| `loops` | arr | `[{name, ab_beat, laenge_beats}]` |
| `tore` | obj | `{raster:{ok, wert_ms, grenze_ms, anschlaege}, headroom:{ok, wert_dbtp, grenze_dbtp}, klarheit:{ok, wert, grenze}, streckfaktor:{ok, wert, grenze}, eins:{ok, beat_this, zweitverfahren}}` |
| `nur_fuer_andreas` | bool | ein Tor gerissen |
| `warnungen` | arr[str] | |

Prüfung beim Laden im Kern: Dateigröße = `frames · 2 · 4` Bytes, `sha256` stimmt (beim Kopieren in den Arbeitsbestand
geprüft; der Kern prüft Größe, Rate und NaN in einer Stichprobe von 4096 Frames gegen `fassung.json`).

### 13.3 `korrekturen.jsonl`

Die einzige Datei im Material-Ordner, an die angehängt wird. Eine Zeile je Korrektur:
`{"zeit":"2026-09-24T21:14:03","von":"andreas|werkstatt","art":"raster|eins|hotcue|urteil","fassung":"128000_r1",
"ab_quell_beat":64.0,"bis_quell_beat":128.0,"versatz_ms":-10.4,"nr":null,"text":""}`. Art `eins`: `ab_quell_beat` ist
der Schlag, den Andreas zur Takt-Eins erklärt hat (§7.3 Punkt 11).

### 13.4 Index `~/cypher-dj/bestand/index.sqlite`

Tabellen `material(material_id PRIMARY KEY, titel, herkunft_art, erzeugt_am, quelle_bpm, dauer_s, lufs, camelot,
stimmung_cent, tore_ok, nur_fuer_andreas, pfad)`, `fassung(material_id, basis_bpm, fassung, frames, stems, schuesse,
lufs, tore_ok)`. Schreibt nur die Werkstatt (WAL-Modus); Leitstand und Rechner lesen. Der Rechner liest mit Pythons
`sqlite3`; der Leitstand mit `node:sqlite` (Node 22.23: läuft, meldet `ExperimentalWarning`, gemessen 2026-09-23).
Bricht `node:sqlite` in einer späteren Node-Fassung, schreibt die Werkstatt zusätzlich `index.json` (Rückweg, noch
nicht gebaut).

---

## 14. Zentrale Datentypen (JSON)

### 14.1 Plan (kanonisch, in Beats)

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

Teil-Arten: `regler` (→ `/k/teil`), `deck` mit `aktion` ∈ `start`, `stopp`, `loop`, `roll`, `sprung`, `hotcue`
(→ `/k/deck/*`, Felder wie dort, **mit** `plan`, `gruppe`, `hoerschein`; `nr` der Hotcue heißt im Teil `hotcue_nr`, `art` der Rolle `roll_art`, weil `nr` und `art` Teil-Nummer und Teil-Art sind), `tempo` (→ `/k/tempo/rampe`). **Kopplung
vergibt der Leitstand**, nicht das LLM: Basstausch-Paare bekommen eine gemeinsame Gruppe, „A raus“ ist an „B rein“
gebunden (A raus startet erst, wenn B rein gestartet ist; wird B verriegelt, entfällt A raus samt Deck-Stopp;
zusätzlich I2 im Kern). Greift Andreas A's Fader oder EQ, fällt die ganze Gruppe `a_raus`, **auch der Stopp** (Teil 10).

Anmerkungen zum Beispiel (Spielart „sicher“ genau nach der Regel §14.4, Start S = Takt 113 = Beat 448, A endet bei
Beat 512, Einstieg von B bei Quell-Beat 64): B wurde ab Quell-Beat 64 vorgehört und startet an S **neu am Einstieg**
(Teil 0), so klingt ab S genau der gemessene Abschnitt (I3a prüft die Quellposition, §17). B's Bass ist vor dem
Einblenden per EQ zu, gesetzt einen Beat vor S, solange B noch nicht läuft (Teil 1 bei Beat 447): I1 prüft über die
Schaltrampe (§17), ein Setzen am selben Sample wie Teil 2 hätte 192 Samples Sub doppelt. Teile, die am selben Sample beginnen, werden in Nummernfolge angewandt, und eine
Rampe beginnt beim Zielwert eines Setzens am selben Sample. Der Basstausch (Teile 4 und 5) ist eine gegenläufige
EQ-Rampe über Takt 8 des Übergangs (Beat 476 bis 480); I1 hält, weil A unter −12 dB fällt (bei 40 % des Takts), bevor B
darüber steigt (bei 60 %). Teil 9 interpoliert nach §1.2 bis −60 dB und setzt dann stumm (die Probe fuhr bis −80 dB;
Unterschied nur unter −40 dB, gerechnet, ungemessen). Teile 11 bis 13 stellen A's EQ nach dem Stopp auf 0 zurück (nicht
in der Probe; A ist dann stumm).

### 14.2 Wahl

`{"id":"w9","von":"cypher","material_id":"3fa1c09b2e7d4410","spielart":"sicher","start_takt":113,"hoerschein":"h12",
"einstieg_quell_beat":64.0,"deck":2,"laenge_takte":16,"absicht":"B mit warmem Bass unter das Outro von A"}`

`einstieg_quell_beat`: wo B beim Einblenden im Material steht (Vorgabe: Kandidat, §14.6). Regel: das Vorhören startet
B **am Einstieg**; der Plan startet B an S erneut am Einstieg (Deck-Teil `start`). Der Hörschein gilt damit für Sync,
Pegel und genau den Abschnitt, der an S hörbar wird. Golden-Folge `einstieg` (§19.3).

### 14.3 Vorschlag

`{"id":"v5","plan_id":"p17","text":"T 113: Nightshift rein, sicher 16 T, Basstausch T 121","start_beat":448.0,
"verfaellt_beat":444.0,"kanal":"deck/2"}`

### 14.4 Spielart (Parametersatz und Regel)

| Feld | Einheit | „sicher“ | „hart“ |
|---|---|---|---|
| `name` | | `sicher` | `hart` |
| `takte` (N) | Takte | 16 | 4 |
| `verlauf` | `linear` \| `kante` | linear | kante |
| `einstieg_db` (E) | dB (B-Fader am Anfang von Takt 1) | −15 | 0 |
| `rampe_takte` (R) | Takte | 8 | 0 |
| `basstausch_takt` (m) | erster Takt, an dessen Anfang B den Bass offen hat (1-basiert) | 9 | 3 |
| `a_raus_ab_takt` (a) | erster Takt, an dessen Anfang A's Fader unter 0 dB steht | 13 | 3 |
| `grenze_sub` | Überdeckung 0 bis 1, **verriegelnd** | 0,10 | 0,25 |
| `grenze_tief` | Überdeckung 0 bis 1, **nur Warnung bis M20** | 0,20 | 0,35 |
| `pump_db` (P) | dB | 0 | 0 |

**Regel (normativ; genau die gemessene Faustregel `saat()` aus `proben/08-analyse-passung/probe_b_uebergang.py`
Z. 219 bis 228 mit den Werten Z. 241 bis 252, dort 0-basiert, hier 1-basiert).** Je Regler ein Stützwert am Anfang
jedes Übergangstakts t = 1 … N und ein Endwert am Anfang von Takt N + 1. `verlauf = linear`: zwischen zwei
Stützwerten linear in dB über den Takt (ein `/k/teil` mit `dauer_beats` = Taktlänge je Abschnitt ungleicher Nachbarn;
gleichmäßige Folgen dürfen zu einer Rampe zusammengefasst werden). `verlauf = kante`: der Stützwert gilt den ganzen
Takt, Wechsel an der Taktgrenze mit der Schaltrampe des Reglers (Probe: 10 ms).

| Regler | Stützwert in Takt t | Endwert (Anfang Takt N + 1) |
|---|---|---|
| B Fader | E · (1 − u) + P · u mit u = min(1, (t − 1)/max(1, R)) | P |
| B EQ tief | −30 dB für t < m (gesetzt einen Beat vor S, I1 über die Schaltrampe, §17), 0 dB ab t = m | 0 |
| B EQ mitte, hoch | 0 | 0 |
| A EQ tief | 0 für t < m, −30 dB ab t = m | bleibt; nach A stumm auf 0 (Vertragszusatz) |
| A EQ mitte, hoch | −30 · min(1, max(0, t − 1 − N/2) / (N/2)) dB | bleibt; nach A stumm auf 0 |
| A Fader | 0 für t < a, −40 · (t − a + 1)/(N − a + 1) dB ab t = a | stumm (Probe −80 dB, Vertrag −200 nach §1.2) |

Für „sicher“ heißt das: B Fader −15 dB linear auf 0 dB bis zum Anfang von Takt 9; B's Bass −30 dB bis Takt 8, über
Takt 8 gegenläufig mit A's Bass getauscht; A's Mitten und Höhen ab Takt 9 linear bis −26,25 dB am Anfang von Takt 16;
A's Fader ab Takt 12 linear auf −40 dB am Anfang von Takt 16, dann stumm. Für „hart“: B voll ab Takt 1 mit Bass zu,
Bass-Tausch an der Grenze zu Takt 3, A's Mitten und Höhen −15 dB in Takt 4, A's Fader −20 dB in Takt 3 und −40 dB in
Takt 4, dann stumm. Beispielplan: §14.1.

**Gemessen** (08 NP K1, am gerenderten Audio des einzigen Paars Message/MFB): „sicher“ Sub 0,082, Tief **0,402**,
Tiefmitte 0,951, Lautheit 1,29 LU; „hart“ Sub 0,015, Tief **0,355**, Tiefmitte 0,860, 1,61 LU. Die Sub-Grenzen hält die
Regel, die Tief-Grenzen nicht: darum verriegelt bis M20 nur `grenze_sub` (§11). Abweichende Kurven (Kill statt EQ,
S-Kurven, A bis −200 in einem Zug) heißen erst nach Nachrechnung mit `probe_b_robust.py` „gemessen“. Genre-Spielarten
(Psytrance, Drum and Bass, Deep House, House, Schranz, Disco) als Startwerte aus 08 §3.3.4, Vermutung, dieselbe Regel.
Golden-Folge `expandiere_sicher` (§19.3): Wahl hinein, genau die Teile aus §14.1 heraus.

**Nachtrag M20 (2026-09-25, `messungen/M20-faustregel/BERICHT.md`):** Mit der Variante `kante_mitten` (Bass-Tausch als Kante, dazu B-Mitten zu) hält „hart“ Sub- und Tief-Grenze in 12 von 12 Läufen (Tief max 0,090, Bass-Loch wie die Regel −3,5 dB); die Regel wie geschrieben reißt bei „hart“ an `message_purist` mit Keylock (Tief 0,355 bei 0,35). Für „sicher“ hält keine Variante in 12 von 12. Übernahme in die Regel oben und `grenzen_tief_verriegeln = true` für „hart“ erst nach dem Hörtermin M18 (Klang der Kante am Ohr ungeprüft).

### 14.5 Hörschein

```json
{"id":"h12","kanal":"deck/2","inhalt":"3fa1c09b2e7d4410/128000_r1","deck":2,"bpm":128.0,
 "gemessen_von_beat":428.0,"gemessen_bis_beat":444.0,"gueltig_bis_beat":508.0,
 "quell_von":64.0,"quell_bis":136.0,"erneuerung":14,
 "sync_ms":0.8,"deck_gegen_deck_ms":3.1,"flam_anteil":0.04,"lufs_kurz":-9.8,"pegel_diff_db":-1.2,
 "baender_db":[-28.3,-29.3,-28.6,-31.5,-28.2,-24.9],"urteil":"ok","gruende":[]}
```

`urteil` ∈ `ok` \| `zu_laut` \| `zu_leise` \| `nicht_sync` \| `unsicher`. `gueltig_bis_beat` = `gemessen_bis_beat` +
64 (gesetzt). Nur `ok` wird an den Kern registriert.

**Erneuerung:** nach den ersten 4 Takten schickt die Analyse nach **jedem weiteren Takt** denselben Hörschein (gleiche
`hs_id`, `erneuerung` + 1) über das gleitende 4-Takt-Fenster, solange der Kanal synchron läuft, auch nachdem er offen
ist; der Kern ersetzt den alten (§4.5). Ist eine Erneuerung nicht `ok`, schickt die Analyse `/k/hoerschein/weg`.
Damit läuft ein Hörschein nicht am Start ab, auch wenn ein Plan auf die nächste Phrase rückt oder Andreas spät annimmt
(im Beispiel: Messung ab Beat 372, letzte Erneuerung vor S = 448 bis Beat 444, gültig bis 508; die alte Fassung lief
genau an S ab). `quell_von` ist der Quell-Beat am Beginn der ununterbrochenen Messung, `quell_bis` der am Ende; ein
Sprung im Deck beginnt den Bereich neu.

**Deck gegen Deck ist Pflicht** für Material mit `herkunft.art = minimax`: `ok` nur, wenn die Tief-Band-Anschläge
gegen das laufende Deck median ≤ 8 ms liegen (mindestens 8 Paare in 4 Takten); läuft kein Partner oder reichen die
Anschläge nicht, lautet das Urteil `unsicher` (dann nur Andreas' Hand). Grund: der Versatz gegen die Referenz sieht ein
falsches Raster nicht (08 NP K4).

### 14.6 Passung und Kandidat

Passung (Felder wie 08 §5): `{"a":..,"b":..,"trim_b_db":-9.68,"verschiebung_beats":0.192,
"ueberdeckung":{"sub":0.639,"tief":..,"tiefmitte":..,"mitte":..,"praesenz":..,"hoch":..},
"kollision_30ms":{"tief":{"rate":0.611,"flam_anteil":0.121,"je_takt":4.12}},
"tonart":{"camelot_abstand":0,"chroma_kosinus":0.986},"stimmung_differenz_cent":18.4,
"stretch_zur_basis_prozent":{"a":0.0,"b":0.0}}`.
Kandidat: `{"material_id":..,"titel":..,"fassung":"128000_r1","einstieg_quell_beat":64.0,"passung":{Passung},"spielarten":[{"name":"sicher","takte":16,
"vorhersage":{"ueberdeckung_max":{"sub":0.08,"tief":0.19},"lufs_abw_max_lu":0.9},"ok":true}],"empfehlung":"sicher",
"nur_fuer_andreas":false}`.

### 14.7 Takt-Zustand (Lage)

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

### 14.8 Takt-Bericht (Analyse → Leitstand, am Ende jedes Takts)

```json
{"takt":9,"phrase":2,"frist_takte":7,
 "decks":[{"deck":1,"baender_db":[-41.8,-42.2,-35.5,-32.0,-24.3,-29.4],"versatz_ms":0.0,"lufs_takt":-18.9},
          {"deck":2,"baender_db":[-28.3,-29.3,-28.6,-31.5,-28.2,-24.9],"versatz_ms":0.0,"lufs_takt":-18.8}],
 "deck_gegen_deck":{"paar":[1,2],"median_ms":1.2,"flam_anteil":0.05,"n":8},
 "ueberdeckung":{"sub":0.136,"tief":0.178,"tiefmitte":0.499,"mitte":0.559,"praesenz":0.362,"hoch":0.525},
 "summe":{"lufs_takt":-18.7,"spitze_dbfs":-7.2},
 "plan_abweichung":{"plan_id":"p17","ueberdeckung_max":0.02,"lufs_lu":0.1}}
```

Bänder in der Reihenfolge Sub 30 bis 90, Tief 90 bis 250, Tiefmitte 250 bis 800, Mitte 800 bis 2000, Präsenz 2000
bis 6000, Hoch 6000 bis 16000 Hz (08 §3.3.1), gerechnet aus `band[0..5]` des Hüllkurven-Rings (§6.2). Versatz gegen
Referenz: Kreuzkorrelation der Deck-Hüllkurve (§6.2) mit `huelle_1khz.npy` (§13.1, dieselben Filter und dasselbe
RMS-Fenster) an der hörbaren Position, Suchfenster ±200 ms, Band mit der höchsten Korrelation (08 §3.3.6).

### 14.9 Urteil

`{"id":"u3","art":"gut|daneben|ab","bezug":{"plan_id":"p17"},"gewinner":null,"sample":7200000,"von":"andreas"}`

---

## 15. Journal und Aufnahme

- **Journal** `~/cypher-dj/sets/djk/<set_id>/journal.jsonl`, eine Zeile je Ereignis:
  `{"sample":..,"beat":..,"takt":..,"mono_ns":..,"von":"kern|leitstand|spieler|analyse|werkstatt|notbahn|andreas",
  "typ":"...","daten":{...}}`. Pflicht: jeder Befehl an den Kern mit allen Feldern, jede Quittung, jede Hand- und
  Taste-Meldung, jeder Plan, jede Wahl mit Antwortzeit des Zugs, jeder Hörschein, jeder Takt-Bericht, jedes Urteil,
  jede Notbahn- und Lücken-Meldung. Die ersten Zeilen: `{"typ":"set_start","daten":{"set_id","generation","vertrag":1,
  "konfiguration":{...}}}`.
- **Aufnahme** `aufnahme.f32` (float32, 4 Kanäle verschränkt: Master L/R, Cue L/R, 48 kHz) und `aufnahme.json`:
  `{"erstes_kern_sample":..,"notbahn_versatz_samples":512,"frames":..,"luecken":[[frame,anzahl],...]}`. Der erste Frame
  entspricht Kern-Sample `erstes_kern_sample` (Notbahn-Versatz eingerechnet).

---

## 16. Fehler und Verspätung

### 16.1 Politik je Befehlsart

| Befehl | Vorgabe-Politik | zu spät heißt |
|---|---|---|
| `/k/teil` aus einem Plan (Einblenden, Rampen) | 0 `musik` | verworfen, Quittung 4; der Leitstand bekommt einen Zug-Anlass |
| `/k/teil` Ausblenden, Kill an, Fader zu, Stopp-Folgen | 1 `zustand` | am nächsten Zyklus mit Schaltrampe bzw. Restrampe bis zum unveränderten Ende-Beat, Quittung 5 |
| `/k/deck/start` aus einem Plan | 0 | verworfen |
| `/k/deck/stopp` | 1 | am nächsten Zyklus (ein Stopp aus einem Plan wartet zusätzlich, solange er den letzten hörbaren Kanal träfe, I2) |
| `/k/deck/loop`, `/roll`, `/sprung`, `/hotcue` aus Andreas' Makro | 2 `raster` | nächster erreichbarer Rasterpunkt der Größe `raster_beats` |
| dieselben aus Cyphers Plan | 0 | verworfen |
| `/k/tempo/rampe` | fest | Start am nächsten Zyklus, Ende-Beat unverändert |
| `/erz/ev` | fest | nicht gespielt, gezählt als `zu_spaet` |
| Hand (MIDI) | | nie zu spät: wirkt eine Periode nach dem Senden |

„Genau oder gemeldet“: kein Befehl klingt still an einer anderen Stelle als seinem Ziel-Sample (02 NP N2).

### 16.2 Gründe (Codes)

| Code | von | Bedeutung |
|---|---|---|
| `zu_spaet` | Kern, Leitstand | Ziel-Sample vorbei (mit `fruehestens_beat` im Leitstand) |
| `regler_beim_menschen` | Kern, Leitstand | Halter `mensch` |
| `regler_verplant`, `ueberlappung` | Kern, Leitstand | ein angenommener Teil hält den Regler im selben Zeitraum (I4) |
| `nur_hand` | Kern | Pfad nur für die Hand |
| `unbekannter_regler`, `unbekanntes_deck` | Kern | Pfad oder Deck gibt es nicht |
| `ausserhalb_bereich` | Kern | Wert außerhalb §1.5 |
| `kein_hoerschein`, `hoerschein_anderer_kanal`, `hoerschein_anderer_inhalt`, `hoerschein_anderes_tempo`, `hoerschein_abgelaufen`, `hoerschein_anderer_abschnitt` | Kern, Leitstand | I3a, I3b (Abschnitt: Quellposition bei `ab_beat` außerhalb `[quell_von, quell_bis + 64]`) |
| `ziel_ungehoert` | Kern, Leitstand | I3d: Cyphers Sprung oder Hotcue auf offenem Deck zu einem Ziel ohne Hörschein-Abdeckung und ohne `annahme:` |
| `keine_stems` | Kern | `stem/*` an einem Deck ohne geladene Stems |
| `hoerschein_nicht_sync`, `hoerschein_pegel` | Leitstand | Hörschein-Urteil nicht `ok` |
| `invariante_sub_doppelt`, `invariante_master_leer` | Kern | I1, I2 |
| `deck_beruehrt` | Kern, Leitstand | Deck-Halter von Andreas |
| `deck_hoerbar`, `deck_laeuft`, `nicht_geladen` | Kern | Zustand des Decks |
| `material_fehlt`, `pruefung`, `budget_speicher` | Kern | Laden |
| `budget_stretcher` | Leitstand | mehr als 4 Echtzeit-Stretcher [VORLÄUFIG, 2026-09-23 13:3x: die Nachprüfung zu Dossier 01 misst R3 in FIFO-Arbeits-Threads mit Vorlauf mit 8 je Thread ohne Unterlauf (16 auf 2 und 32 auf 4 Threads, Grenze erst bei 16 je Thread; SCHED_OTHER statt FIFO: 23 Unterläufe). Die Grenze entscheidet M3 (Scheibe 30).] |
| `karte_voll` | Kern | Tempo-Karte voll |
| `ki_gestoppt` | Kern, Leitstand | Stopp-Taste aktiv |
| `rechner_fehlt` | Leitstand | Rechner nicht erreichbar |
| `kein_stretcher` | Kern | Tempo-Änderung, obwohl der Stretcher-Weg noch nicht gebaut ist (bis Scheibe 5) |
| `autonomie` | Leitstand | Stufe erlaubt es nicht |
| `grenze_sub` | Leitstand | Vorhersage einer Wahl reißt `grenze_sub` (§11, `vorhersage` `grenzen_ok`; Dossier 09 V4) |
| `neustart` | Leitstand | Teil durch Kern-Neustart verloren, Grund von `teil_abgebrochen` (§16.3) |
| `form` | Kern, Leitstand, MCP | Eingabe verletzt das Schema (Kern: seit Ohr T12 `inhalt` in `/k/hoerschein`, §4.5) |
| `hand`, `abbruch`, `ki_stopp` | Kern | Abbruchgrund |
| `unbekannte_adresse`, `falsche_typen`, `protokoll` | Kern | Protokollfehler |

### 16.3 Ausfall eines Partners

- Kern weg (kein `/uhr` für 100 ms): Leitstand hält alle Einreichungen an, schickt `/k/hallo` sofort und dann alle
  50 ms bis `/k/willkommen` (§4.1), meldet `ereignis` `neustart` sobald `/e/neustart` kommt, schickt dann die offenen
  Hörscheine und wartenden Pläne **nicht** automatisch neu (der Kern hat sie aus dem Zustand), sondern gleicht über die
  `/q/stand`-Meldungen und die folgenden `/q`-Quittungen ab. Befehle, für die weder `/q/stand` noch schon vor dem
  Neustart eine Endquittung (`fertig`, `abgebrochen`, `verspaetet_*`, `abgelehnt`, `storniert`) vorliegt, gelten als
  verloren und werden als `ereignis` `teil_abgebrochen` (Grund `neustart`) gemeldet; neu geplant wird im nächsten Zug.
- Leitstand weg: Kern spielt; angenommene Teile laufen zu Ende; Controller wirkt; Kiste bleibt, wie sie ist.
- Analyse weg: keine neuen Hörscheine; laufende bleiben bis `gueltig_bis_beat`.
- Rechner weg: `waehle` antwortet `abgelehnt` mit `rechner_fehlt`; `plan_einreichen` geht weiter (ohne Vorhersage,
  Warnung im Journal).
- Spieler weg: Zug-Anfragen laufen in `zeitueberschreitung`; Frist-Wächter im Kern.

---

## 17. Invarianten und Frist-Wächter (Kern)

Geprüft vor jedem Teilstart und jedem Deck-Teil, in jedem Zyklus, in dem ein Planteil einen der Regler `fader`, `trim`,
`kill/tief`, `eq/tief`, `stem/bass` oder das Crossfader-Gewicht eines Kanals bewegt, bei jedem Schuss und jedem
Erzeuger-Ereignis auf einem offenen Kanal, und nach jedem Handgriff. Die Hand (MIDI) wird nie blockiert.

- **I1 Sub nie doppelt:** geprüft mit dem Wert, den der Regler in diesem Zyklus tatsächlich hat, also über die
  Schaltrampe eines Setzens (192 Samples), nicht erst mit seinem Zielwert (Andreas 2026-09-25, Lesart n: „hart“). Würde
  nach diesem Zyklus `tief_offen` für zwei Kanäle gelten und hat ein Planteil (nicht die
  Hand) mindestens einen davon geöffnet, bricht der Kern diesen Teil und seine Gruppe ab (Wert bleibt am Ist-Wert),
  Quittung 7 mit `invariante_sub_doppelt`, `/e/invariante`.
- **I2 Master nie leer:** würde ein Planteil oder ein Deck-Stopp aus einem Plan den letzten hörbaren Kanal unhörbar
  machen, hält der Teil am Ist-Wert bzw. wartet der Stopp (Status bleibt `gestartet` bzw. `angenommen`), bis ein anderer
  Kanal hörbar ist; dann läuft der Teil mit unverändertem Ende-Beat weiter (ist das Ende vorbei: Schaltrampe), der
  Stopp wird ausgeführt. `/e/invariante` `master_leer` beim Anhalten. Weil `hörbar` bei Decks „läuft“ verlangt (§1.6),
  zählt ein angehaltenes oder verriegelt nie gestartetes Deck B nicht als hörbar: I2 hält dann „A raus“ an, und der
  Frist-Wächter greift für A.
- **I3 Neuer Inhalt nur mit Hörschein** (A4: „der dirigent darf nie etwas ungehört einspielen“). Ein Hörschein ist
  gültig, wenn Kanal und `inhalt` passen (§4.5), `beat ≤ gueltig_bis_beat` und `|bpm_jetzt/bpm_messung − 1| ≤ 0,005`.
  - **I3a Öffnen:** ein Planteil, der einen geschlossenen Kanal **öffnet** (§1.6 `offen`, also Trim plus Fader,
    unabhängig von Bus, Crossfader und Master), braucht in `hoerschein` einen gültigen Hörschein dieses Kanals; bei
    Decks muss zusätzlich die Quellposition bei `ab_beat` in `[quell_von, quell_bis + 64]` liegen. Erzeuger-Kanäle `erz/*` sind ausgenommen (Andreas 2026-09-29):
    ihr Inhalt ist Cyphers eigenes Muster. Der Kern hält dort nur Stop Cypher; AUTO hält der Seiten-Server (409 `auto_aus` für Cyphers `/spur` und `/regler` auf `erz/<n>`, `wirt:<gruppe>`, `strom:<n>`), Stop Cypher dort zusätzlich Wirt und Muster-Fahrten.
  - **I3b Pad:** ein `/k/schuss` (Quelle ungleich `andreas`) auf ein offenes Pad braucht einen gültigen Hörschein mit
    genau diesem Schuss (§4.6).
  - **I3c Erzeuger:** Ereignisse eines Musters auf einem offenen Erzeuger-Kanal spielen nur mit gültigem Hörschein
    `muster/<m>` dieses Kanals, sonst `ungehoert` (§4.8).
  - **I3d Sprung:** ein `sprung` oder `hotcue` mit Quelle `cypher` auf einem offenen Deck braucht ein Ziel in
    `[quell_von, quell_bis + 64]` eines gültigen Hörscheins dieses Decks oder `hoerschein` = `annahme:<vorschlag_id>`
    (Andreas hat angenommen); sonst `ziel_ungehoert`. Loop und Roll bringen keinen neuen Inhalt (sie wiederholen
    Gehörtes bzw. kehren zum Weiterlaufen zurück) und sind frei.
  Sonst am Start `abgelehnt` mit dem passenden Grund (§16.2).
- **Reihenfolge:** Teile, die am selben Sample beginnen, werden in Nummernfolge angewandt; die Invarianten prüfen den
  Zustand **nach** allen Teilen dieses Samples (so ist ein Basstausch als Paar gültig).
- **I4 keine Überlappung:** ein Teil, dessen `[ab_beat, ab_beat + dauer_beats)` einen angenommenen Teil am selben
  Regler schneidet, wird beim Einsortieren abgelehnt (`ueberlappung`), auch innerhalb eines Plans; Setzen (Dauer 0) am
  selben Beat wie eine anschließende Rampe ist erlaubt (Reihenfolge nach Teil-Nummer).
- **Frist-Wächter:** ist ein laufendes Deck der einzige hörbare Kanal (§1.6, andere Decks zählen nur, wenn sie laufen),
  ohne Loop, mit `beats_bis_ende < 32`, und macht kein angenommener Teil einen anderen Kanal vor dem Ende hörbar, setzt
  der Kern einen Loop über `[q0, q0 + 16)` mit `q0 = e + floor((Q_ende − e − 16)/16)·16` und `e` =
  `erste_eins_quell_beat` der Fassung (letzte volle 16 Quell-Beats, auf der Takt-Eins), meldet `/e/rueckfall` (an = 1)
  und setzt die LED `rueckfall`. Jeder Griff oder Befehl an dieses Deck beendet den Rückfall (`/e/rueckfall` an = 0);
  nur ein **ausgeführter** Stopp mit Quelle `andreas` oder die Play-Taste von Andreas unterbindet ihn für dieses
  Material. Ein Stopp aus einem Plan, der wegen I2 wartet, unterbindet nichts.

---

## 18. Zustandsstrom je Takt

1. Im Zyklus mit dem Taktanfang schickt der Kern `/takt`.
2. Die Analyse wertet den abgeschlossenen Takt aus den Hüllkurven aus und schickt `takt_bericht` spätestens 100 ms
   nach dem Taktanfang (gemessen: Taktende-Auswertung in Python max 34,8 ms unter Last 50, 08 §4.f).
3. Der Leitstand schickt `takt` (§14.7) an alle spätestens 150 ms nach dem Taktanfang, mit dem Bericht des vorigen
   Takts; fehlt der Bericht, ohne ihn (`bericht_vorher: null`).
4. Das LLM bekommt den Takt-Zustand nur in Zug-Anfragen und über `lage`/`warte`, nie als Strom.
5. Schnelle Daten (Pegel 20 Hz, Deck 50 Hz, Uhr je Zyklus) gehen nur an Abonnenten des Kerns (Leitstand, Analyse,
   Anzeige über den Leitstand).

---

## 19. Konformität: wie zwei Sessions unabhängig bauen

0. **Werkstück V0 „Vertrag als Code“** (vor K1 und L1, rund ein halber Session-Tag, **ein** Eigentümer; K1, L1, W1
   lesen `djk/vertrag/` nur):
   - `djk/vertrag/osc.json`: jede Adresse aus §4, §5 mit Typ-Zeichenkette, Feldnamen, Einheiten, Bereichen; daraus
     erzeugt `osc_adressen.h` und `osc_adressen.ts` (Erzeuger-Skript im selben Ordner, Test: Text gegen `osc.json`).
   - JSON-Schemas für §9 bis §15 (WS-Umschlag, MCP-Werkzeuge, Rechner, Werkstatt, `material.json`, `fassung.json`,
     Plan, Wahl, Hörschein, Takt-Zustand, Takt-Bericht, Journal) und für die TOML-Schlüssel aus §2.1.
   - `baender.json`: Koeffizienten der sechs Analyse-Bänder (§6.2), gemeinsam für Kern, Werkstatt und Ring-Attrappe.
   - **Format der Golden-Folgen** `folgen/<name>.jsonl`, eine Zeile je Schritt: `{"t":"sende","sample":…,"osc":[adresse,
     typen, …werte]}`, `{"t":"hand","sample":…,"pfad":…,"midi_roh":0..1}`, `{"t":"erwarte","bis_sample":…,"osc":[…]}`
     (Quittung, Ereignis), `{"t":"wert","sample":…,"pfad":…,"wert":…,"toleranz":…}`.
   - **Test-Handeingang** `/test/hand ,sfh` (`pfad`, `midi_roh` 0 bis 1, `sample`): wirkt wie ein MIDI-Ereignis am
     Controller, samt erstem Wert nur als Stellung und Totzone 3/128; der echte Kern nimmt es nur mit
     `pruefmodus = true` oder `hand_osc = true` an (sonst `/e/protokollfehler`), Attrappe und Prüfstand immer. Neben den
     Reglern des Stellwerks sind `deck/<n>/play` und `deck/<n>/cue` gültige `pfad` (Scheibe 35): `midi_roh` ab 0,5 ist
     der Druck der Deck-Taste, darunter das Loslassen; sie wirkt wie die Taste des Controllers (§7.3 Punkt 5 und 6,
     Quantisierung `beat`) am Sample, frühestens am Blockanfang des Zyklus, in dem der Befehl ankommt. Ebenso `taste/<name>` mit den Namen aus §5.8 ohne die
     Encoder-Werte (`autonomie`, `spielart`, `laenge`, `kiste_wahl`): `midi_roh` ab 0,5 ist der Druck, der Kern meldet
     daraus dasselbe `/e/taste` (`name`, `wert` 1, `sample`, `beat`) wie für die Taste des Controllers (die Stopp-Taste
     wirkt wie `/k/ki/stopp`), darunter das Loslassen ohne Meldung; ein anderer Name ist `unbekannter_regler`.
   - **Prüfklick** (Roadmap Z1) `/test/klick ,hssi`: `id`, `quelle`, `kanal` (`master` oder ein Kanal aus §1.5), `an` (0
     oder 1). Nur mit `pruefmodus = true` (in Scheibe 01 der Aufrufparameter `--pruefmodus`), sonst
     `/e/protokollfehler`. Ab dem nächsten Schlag schreibt der Kern je Schlag einen kurzen Klick auf den Eingang von
     `kanal` (vor Trim; bei `master` in die Summe vor dem Limiter), Einsatz genau auf `llround(sample_at(b))` für ganze
     `b`, Schlag 1 des Takts mit anderem Pegel; Klickform wie `proben/01-audio-kern/a-cpp-jack/klick_kern.cpp`, damit
     `analyse_klick.py` ihn misst. Quittung `/q` mit Status 2 beim ersten Klick. Bis Scheibe 25 nur `master`, andere
     Kanäle `abgelehnt` mit Grund `unbekannter_regler`. Zweck: ein bekanntes Signal für jede Abnahme am Ziel, solange
     keine Decks existieren.
   - **Prüfinstanzen** (Roadmap Z2): Umgebungsvariable `CYPHERDJ_INSTANZ`, Vorgabe leer. Ist sie gesetzt (Kleinbuchstabe
     des Strangs, `a` bis `i`), wird in jedem festen Pfad aus §2, §2.1 und §6 der Bestandteil `cypherdj/` zu
     `cypherdj-<instanz>/` (etwa `/dev/shm/cypherdj-a/bus`, `~/.config/cypherdj-a/kern.toml`,
     `$XDG_RUNTIME_DIR/cypherdj-a/rechner.sock`), jeder JACK-Client-Name und jede transiente Unit bekommt `-<instanz>`
     (`cypherdj-kern-a`), und alle Ports aus §2 verschieben sich um 1000·k (k = 1 für `a` bis 9 für `i`; Kern-UDP von
     Strang A also 48100). Prüf-Senken heißen `cypherdj-pruef-<instanz>-<lauf>` und bestehen damit den Riegel (§8). Die
     leere Instanz (k = 0) gehört den Meilenstein-Sitzungen und der Hauptinstanz. Der Bestand `~/cypher-dj/bestand/`
     bleibt geteilt; Prüfläufe, die in den Bestand schreiben würden, setzen `bestand` in ihrer `werkstatt.toml` auf einen
     eigenen Ordner.
   - **Ring-Attrappe** `attrappe_huellen.py`: schreibt `/dev/shm/cypherdj/huellen` (§6.2) aus WAV-Dateien je Kanal, mit
     den Filtern aus `baender.json`, im Echtzeit-Takt; Gegenstelle für Analyse und Hörschein, solange der Kern fehlt.
1. **Kern-Attrappe** (`djk/vertrag/attrappe_kern.mjs`, Werkstück L1): spricht §4 und §5 vollständig mit einer
   simulierten Uhr in Echtzeit (Tempo-Karte nach §1.3), führt Teile und Deck-Teile auf einer simulierten Regler- und
   Deck-Tabelle aus, prüft I1 bis I4 und den Frist-Wächter, nimmt `/test/hand` an, schreibt keinen Ton. Der Leitstand
   wird gegen sie gebaut.
2. **Leitstand-Attrappe** (`djk/vertrag/attrappe_leitstand.py`, Werkstück K1): schickt Befehlsfolgen aus
   `djk/vertrag/folgen/*.jsonl` an den Kern und prüft die Quittungen. Der Kern wird gegen sie gebaut.
3. **Golden-Folgen** (Pflicht, je mit erwarteter Quittungs- und Wertefolge; jede Folge läuft gegen Attrappe und Kern):
   - `uhr_golden`: Werte aus §1.3 (nachgerechnet 2026-09-23: 3 237 188,004 / 3 588 923,077 / 4 287 104,895).
   - `teil_rampe`: `/k/teil` `deck/2/fader` von −15 dB nach 0 dB, `ab_beat` 64, `dauer_beats` 32 bei 128 BPM → Start
     bei Sample 1 440 000, Ende bei Sample 2 160 000, Wert bei Beat 80 (Sample 1 800 000) = −7,5 dB.
   - `hand_gewinnt`: dieselbe Rampe; `/test/hand` an `deck/2/fader` mit `midi_roh` 0,5 bei Sample 1 500 000 (nur
     Stellung, keine Wirkung), dann 0,5 + 4/128 bei Sample 1 620 000 (über der Totzone) → Quittung 7 `hand` mit
     `ist_sample` 1 620 000, Halter `mensch`, ein zweiter Teil der Gruppe `b_rein` ebenfalls abgebrochen, ein Teil
     anderer Gruppe läuft weiter (09 Probe b als Vorbild).
   - `zu_spaet`: Teil mit `ab_beat` in der Vergangenheit, Politik 0 → Quittung 4; Politik 1 → Quittung 5 mit
     `ist_sample` = nächster Blockanfang.
   - `sub_doppelt` und `master_leer`: die Fälle a1 und a2 aus `proben/09-ki-steuerung/nachpruefung/angriff.mjs`.
   - `hotcue_phase`: Deck bei Quell-Beat 37,30, Hotcue 64,00 → Ziel 64,30.
   - `rueckfall`: Deck als einziger hörbarer Kanal, 96 Beats Material, `erste_eins_quell_beat` 0, kein Plan → Loop
     `[80, 96)` gesetzt, sobald `beats_bis_ende < 32`.
   - `laden`, `start_quell_beat` (bei `ab_beat` erklingt genau `quell_beat`), `loop`, `roll` (Rückkehr zur
     Schattenposition), `sprung` (auch im Loop), `politik_raster` (zu spät → nächster Rasterpunkt der Größe
     `raster_beats`), `storno`, `ki_stopp` (alle `cypher`-Teile ab, KI-Spur über 4 Beats stumm, danach `ki_gestoppt`),
     `i4_ueberlappung`, `protokollfehler` (unbekannte Adresse, falsche Typen).
   - `i3_gruende`: je ein Fall für `kein_hoerschein`, `hoerschein_anderer_kanal`, `hoerschein_anderer_inhalt`,
     `hoerschein_anderes_tempo`, `hoerschein_abgelaufen`, `hoerschein_anderer_abschnitt`, `ziel_ungehoert`;
     `hoerschein_rand`: Start genau bei `gueltig_bis_beat` → angenommen, einen Beat danach → abgelaufen;
     `crossfader_luecke`: Plan zieht einen Fader hinter geschlossenem Crossfader ohne Hörschein auf → abgelehnt;
     `pad_ungehoert`, `muster_ungehoert` (Zähler `ungehoert` in `/erz/quittung`).
   - `b_verriegelt_a_laeuft_aus`: B am Start verriegelt (kein Hörschein), A läuft aus → I2 hält „A raus“, der
     Frist-Wächter setzt die Rückfall-Schleife auf A, keine Stille.
   - `hand_stoppt_a_raus`: Handgriff an A's Fader während „A raus“ → Gruppe `a_raus` samt Deck-Stopp fällt, A läuft.
   - `neustart`: `kill -9` zwischen Teilstart und Teilende der `teil_rampe` → `/e/neustart` an den gespeicherten
     Abonnenten, `/q/stand` für den laufenden Teil nach `/k/hallo`, Rampe endet am unveränderten Ende-Beat.
   - `einstieg`: Vorhören ab Einstieg, Plan mit Deck-Teil `start` an S → I3a prüft die Quellposition, Hörschein deckt sie.
   - `autonomie_1_eq` (Leitstand gegen Attrappe): Stufe 1, Plan mit einem EQ-Teil an einem hörbaren Deck →
     `vorgeschlagen`, kein `/k/teil` an den Kern.
   - `expandiere_sicher` (Rechner): Wahl hinein, genau die Teile aus §14.1 heraus.
   - `notbahn_124`, `notbahn_rampe` (Prüfstand, stumm): Kern-Absturz bei fester Basis 124 und in einer Rampe → die
     Schleife ist einen Master-Takt lang, die Rückgabe an den Kern liegt auf dem Raster (Grenze wie ARCHITEKTUR §7).
4. **Bau-Abhängigkeiten auf DJ-Maschine** (2026-09-23 geprüft, `pkg-config`): rubberband 3.3.0, jack 1.9.21, sndfile 1.2.2,
   samplerate 0.2.2, fftw3/fftw3f 3.3.10, lilv-0 0.24.22, alsa 1.2.11, aubio 0.4.9; g++ 13.3, CMake 3.28.3, Ninja
   1.11.1, Faust 2.70.3, Node 22.23.2, Python 3.12.3. **Fehlt** (gemessen 2026-09-23: `pkg-config` findet liblo,
   libsystemd, nlohmann_json, tomlplusplus, gtest, catch2 nicht; `/usr/include/{nlohmann,toml++,gtest,catch2,lo,systemd}`
   fehlen; Gegenprobe rubberband, jack, sndfile gefunden). Festlegung für V0 und K1:
   - **libebur128** (MIT, `ebur128.c` plus `queue/`, Commit 67b33ab): Quelle nach `djk/third_party/libebur128/`
     kopieren und einkompilieren (heute nur unter `proben/04-mixer-effekte/vendor/`, dort per `.gitignore` aus git
     ausgeschlossen).
   - **JSON** (`kiste.json`, Mapping, `fassung.json`): nlohmann/json als gepinnter Einzel-Header (MIT) unter
     `djk/third_party/`; **TOML** (`kern.toml`): toml++ als gepinnter Einzel-Header (MIT) ebenda. Die Notbahn (C) liest
     keine Datei (§8).
   - **sd_notify** (`Type=notify`, Watchdog): selbst, rund 20 Zeilen wie `proben/10-robustheit-betrieb/src/minikern.c`
     Z. 56 bis 60 (`NOTIFY_SOCKET`); kein libsystemd.
   - **OSC** kodieren und lesen: selbst wie `proben/02-uhr-sync-planer/kern/uhrkern.cpp` Z. 322 ff. und `absender.mjs`;
     kein liblo.
   - **C++-Tests**: CTest mit eigenem Assert-Header, dazu ASan/UBSan-Bau im Testbetrieb.
   - **Bungee** erst in Scheibe 5: gepinnter Klon (Commit 8cb6977) mit Bau-Skript unter `djk/third_party/bungee/`
     (braucht CMake ≥ 3.30, lokal 3.28: Bau von Hand wie `proben/03-deck-engine/build.sh`).
   - **Werkstatt-Python**: das Proben-venv `proben/07-werkstatt-zerleger/venv` taugt nicht für die Werkstatt (torch
     2.5.1+cpu, `torch.version.cuda` None; kein `websockets`, kein `pytest`; gemessen 2026-09-23). Neues venv mit
     `--system-site-packages` (das System hat torch 2.10.0+cu128, websockets 16.0, pytest 8.4.2), darin
     `demucs beat_this essentia` nachinstallieren; ob pip dabei den System-torch unangetastet lässt, ist ungeprüft.
   - **Node**: `ws` 8.21.3, `@modelcontextprotocol/sdk` 1.30.0; `node:sqlite` experimentell (§13.4).
5. **Messort für Abnahmen:** eigene Null-Senke je Lauf (nicht die geteilte `cypher_stumm`, 06 Risiko 1), JACK-Aufnehmer
   am Ziel, nie `pw-record` (01 §4.4); Riegel gegen ungefragten Ton (§8).

---

## 20. Offene Punkte und Änderungsprotokoll

**Vorläufig bis zur genannten Messung:** Quantum 256 (M1); Hörbar-Schwelle −26 dB, „Tief offen“ −12 dB, Hörschein-
Schwellen, Tor-Schwellen (M18, M13); Tor `streckfaktor` ±20 % (M19 gemessen, vorläufig bis M18) und Stimmungskorrektur (M19); Tief-Grenzen der
Spielarten (M20, bis dahin nur Warnung); `ziel_lufs` −16 LUFS (M18, am Ohr); Arbeitsvorlauf 4 Blöcke, `vorlauf_ms` und
höchstens 2 R3 je Arbeits-Thread (M3); Blende der Notbahn (M2); Puls-Verfahren der Wirte (M7); Zeitgrenzen des
Rechners (ungemessen); Frist-Wächter-Längen 32/16 Beats (gesetzt); Antwortfrist 4 Takte (M15); Hörschein-Gültigkeit
64 Beats (gesetzt).

**Bewusst nicht in Version 1:** S-Ecken in der Tempo-Karte, Taktarten außer 4/4, Link und MIDI-Clock (nur Ports
reserviert), Plugin-Inserts, Zerleger-MCP, Oberfläche.

| Datum | Version | Änderung |
|---|---|---|
| 2026-09-23 | 1 | erste Fassung aus der Synthese der Architektur-Nacht |
| 2026-09-23 | 1 | Kritik-Runde (ARCHITEKTUR „Kritik und Korrekturen“), Version bleibt 1, weil noch nichts gebaut ist: Autonomie-Positivliste (§10); I3 als „neuer Inhalt nur mit Hörschein“ mit `offen`, Inhalt und Abschnitt (§1.6, §4.5, §17); `hörbar` verlangt laufendes Deck, Deck-Teile mit `plan`/`gruppe`/`hoerschein` (§4.4); Hörschein-Erneuerung je Takt (§14.5); Einstieg (§10, §14.2); Stems oder Basis (§4.4); Fassungen statt überschriebener Dateien (§13); Takt-Eins und Text (§13.2); sechs Bänder im Hüllkurven-Ring und `huelle_1khz` definiert (§6.2, §13.1); Notbahn-Taktfelder im Ring, Ports aus der Unit, Riegel (§6.1, §8); Abonnenten im Zustand, `/q/stand` (§4.1, §5.1); Spielart als volle Regel (§14.4), Tief-Grenzen nur Warnung (§11); Ziel-LUFS und Trim bis +24 dB (§1.5, §2.1); Routing mit Bussen (§1.5); Tore mit unabhängigem Instrument, Streckfaktor, Takt-Eins, Stimmung (§12.3); Hand-Tempo als Rampe (§1.3); Konfigurationsschema (§2.1); V0, Golden-Folgen, Bau-Abhängigkeiten (§19) |
| 2026-09-24 | 1 | Scheibe 02: Roadmap-Zusätze Z1 (Prüfklick `/test/klick`, nur mit `pruefmodus`) und Z2 (Prüfinstanzen über `CYPHERDJ_INSTANZ`) nach §19.0 übertragen; nur Prüfbetrieb, keine Semantik des Sets, Version bleibt 1 |
| 2026-09-24 | 1 | §1.3 präzisiert: gerundetes `s0` verlangt `b0` auf der durchgehenden Kurve an diesem Sample. Befund Scheibe 02 (gerundetes `s0` mit bestelltem Beat verfehlt `sample(192,0)` und den `/uhr`-Schritt bei 4 286 976 in `uhr_golden` um 3,53·10⁻⁶ Beats); so rechnet schon der Kern aus Scheibe 01 (`djk/kern/src/uhr.cpp`, `rampe`), `karte.py` führt `s0` ungerundet, beide treffen die Tabelle. Keine Zahl geändert, Version bleibt 1. |
| 2026-09-25 | 1 | §12.3 und §20 an §2.1 angeglichen: Tor `streckfaktor` 0,20 (M19) statt 0,15; der Wert stand seit ff24935 nur in §2.1. Befund Prüfung Scheibe 09 (`~/messungen/2026-09-25-djk09-vertragsdrift/`); keine neue Entscheidung, Version bleibt 1 |
| 2026-09-25 | 1 | §16.2 um `grenze_sub` (Dossier 09 V4) und `neustart` (§16.3 nannte ihn schon) ergänzt; Befund Scheibe 09, Plan-Befund 3 und 5. Version bleibt 1 |
| 2026-09-25 | 1 | §14.1: Deck-Teile tragen die Hotcue-Nummer als `hotcue_nr` und die Roll-Art als `roll_art` (Namenskollision mit `nr`/`art` des Teils; Befund Scheibe 09, Plan 21 nutzt die Namen schon). Neue optionale Felder, Version bleibt 1 |
| 2026-09-25 | 1 | §7.3 Punkt 7 nach M4 (Scheibe 33, E3 bis E7): Faktor-Takt 43 Blöcke, Phasenregler \|c\| ≤ 100 ppm am Verzögerungsmodell, nie Faktor näher als 10⁻⁶ an 1,0; ersetzt „10 ppm je Block“ (gesetzt, widerlegt). Version bleibt 1 |
| 2026-09-25 | 1 | Lesarten aus Scheibe 09 entschieden (Andreas): b Ablehnung am Start reißt die Gruppe mit (§4.3 Feld 11); e Griff bricht sofort (§4.3, ADR 023); n I1 prüft über die Schaltrampe, §14.1-Beispiel Teil 1 auf Beat 447, Regel §14.4 ebenso. Übrige elf nach `docs/architektur/entwuerfe/2026-09-25-lesarten-09.md`. Version bleibt 1 |
| 2026-09-26 | 1 | Scheibe 35, Befund B-O (Entscheidung der Hauptinstanz, Weg 1): §2.1 `hand_osc` (bool, false) erlaubt `/test/hand` auch ohne `pruefmodus`; §19.0: `deck/<n>/play`, `deck/<n>/cue` und `taste/<name>` (§5.8 ohne Encoder-Werte) sind gültige `pfad` von `/test/hand`. Neuer optionaler Schlüssel, Version bleibt 1 |
| 2026-09-27 | 1 | §4.4 `/k/deck/laden` und `entladen`: gesperrt nur, wenn das Deck läuft UND offen ist (vorher: offen). Befund am Digital-Out (Andreas: „neuen track laden geht nicht über load a“). Version bleibt 1 |
| 2026-09-27 | 1 | Strudel im Kern, Stufe 1 (ADR 024): §4.8 `ziel` `kit:<name>`, Kit-Form, I3c ausgesetzt, 20 `/erz/ev` je Bundle; §5.6 `/pegel` auch `erz/1`. Neue Zielform, Version bleibt 1 |
| 2026-09-27 | 1 | MVP 2, Scheibe 1 (ADR 025): §4.9 `/k/loop/laden`, `/k/loop/start`, `/k/loop/stopp`; §5.11 `/e/loop`; §5.6 `/pegel` auch `pad/1`, `pad/2`; §1.5 `pad/*` sind die Loop-Boxen. Neue Adressen, Version bleibt 1 |
| 2026-09-27 | 1 | MVP 2, Scheibe 2 (ADR 025 Folgeplan): §4.9 `/k/loop/rec` (Mitschnitt von `erz/1` vor Trim); §5.11 `/e/mitschnitt`; §6.3 Mitschnitt nicht im Neustart-Zustand. Neue Adressen, Version bleibt 1 |
| 2026-09-28 | 1 | Plan E9 (Deck-Bedienung): §4.4 `raster_beats` auch 16 (vier Takte, Einrastraster der Seite, Spec E9). Additiv, Version bleibt 1 |
| 2026-09-28 | 1 | Plan 3 (Beat-FX, Spec E8): §4.10 `/k/fx`, §5.12 `/e/fx`. Neue Adressen, Version bleibt 1 |
| 2026-09-28 | 1 | AUFTRAG (zwei Beat-FX-Einheiten, Zuweisung je Kanal statt CH-Wahl, drei Parameter je Einheit nach S8-Vorbild): §4.10 `/k/fx` trägt `einheit`, `param1..param3` statt `kanal`/`param`, neu `/k/fx/zuweisung`; §5.12 `/e/fx` ebenso, neu `/e/fx/zuweisung`. Neue Adressen, Version bleibt 1 |
| 2026-09-28 | 1 | Review E9: §4.4 `/k/deck/hotcue` auf stehendem Deck genau auf den Hotcue (vorher auch dort phasentreu); Play/Pause der Hand behalten einen Loop, `/k/deck/start`, `/k/deck/stopp` und CUE beenden ihn; eine Transport-Taste verwirft wartende loop/sprung/hotcue des Decks (Quittung 7 `abbruch`). Version bleibt 1 |
| 2026-09-28 | 1 | Plan Grid: §4.4 `/k/deck/raster` (Raster-Versatz je Deck, absolut, sofort); §5.9 `/e/raster` auch aus `/k/deck/raster`. Neue Adresse, Version bleibt 1 |
| 2026-09-28 | 1 | Plan Grid: §4.9 `/k/loop/raster`, `loop.json` optional `versatz_frames`. Neue Adresse, Version bleibt 1 |
| 2026-09-28 | 1 | Plan Ohr, Task 1: §6.2 `cap` 65536 → 16384 (16,4 s statt 65,5 s Verlauf, 16 statt 64 MiB gesperrter Speicher; der Leser liest fortlaufend nach, der Ring muss nur 4 Takte fassen); Kanal 14 `master` und Kanal 15 `cue` als Satz ergänzt. Version bleibt 1 |
| 2026-09-28 | 1 | Plan Ohr, Task 15 (FX-Routing wie Traktor, Andreas: Ja): §4.10 `/k/fx/routing`, §5.12 `/e/fx/routing`. Neue Adressen, Version bleibt 1 |
