# Cypher-DJ: Architektur

*Stand 2026-09-23, 03:30, Synthese der Architektur-Nacht. Grundlage: `00-anforderungen.md` (A1 bis A26),
die Dossiers 01 bis 06 und 08 bis 10 unter `dossiers/`, die Zwischenmessungen der Werkstatt unter
`proben/07-werkstatt-zerleger/` (Dossier 07 fehlt noch), `tests/stretch-bench/ERGEBNIS.md`, die drei
Recherchen vom 2026-09-22, die drei Entwürfe unter `entwuerfe/` und die drei Richter-Bewertungen. Der Vertrag
zwischen den Bausteinen steht in `SCHNITTSTELLEN.md`, jede Schlüsselentscheidung als ADR unter `adr/`.*

*Einstufung je Aussage: **gemessen** (Zahl aus einer Probe dieser Nacht, Stelle genannt), **belegt**
(Quelle gelesen), **gerechnet** (aus gemessenen Zahlen abgeleitet), **Vermutung**, **ungemessen**
(Zielwert oder Annahme, die erst eine Messung trägt). Nachprüfungen liegen für **01**, 02, 08, 09 und 10 vor und
gehen dort vor („NP“ mit Nummer; die Nachprüfung von 01 hängt seit 03:29 an und ist seit der Kritik-Runde
eingearbeitet). **03, 04, 05 und 06 sind ungeprüft** und so behandelt. Alle Echtzeit-Zahlen dieser Nacht
entstanden unter Fremdlast 19 bis 70 auf 16 Kernen an einer Null-Senke, die selbst nach der Systemuhr taktet (02 NP
K6, 10 NP K8): sie gelten als **vorläufig**. Die Kritik-Runde vom 2026-09-23 (30 Befunde) ist eingearbeitet; was
sie geändert hat und was abgelehnt ist, steht im letzten Abschnitt „Kritik und Korrekturen (2026-09-23)“.*

---

## Kurzfassung für Andreas

1. Das Herz ist ein eigenes Programm ohne Browser und ohne Fenster: ein kleiner Kern in C++, der als Einziger den Takt hält. Alles andere läuft als eigener Dienst daneben; stirbt einer, spielt die Musik weiter.
2. Es gibt genau eine Uhr, den Sample-Zähler im Kern. Alle anderen, auch ich, reden in Beats, nie in Millisekunden.
3. Deine Hände gehen per MIDI direkt in den Kern und gewinnen immer: am selben Sample, nur an dem Regler, den du greifst.
4. Ich wähle (welcher Track, welche Spielart, welcher Moment); der Code rechnet den Übergang, prüft ihn vorher und fährt ihn sample-genau. Wie viel ich allein darf, stellst du am Controller ein; Start ist „nur vorschlagen“, und eine Stopp-Taste nimmt mir sofort alles.
5. Nie ungehört: ich messe jedes neue Stück, jedes neue Muster und jeden neuen Einzelschuss an einem stillen Abgriff, bevor mein Plan ihn aufmacht, auch hinter einem geschlossenen Crossfader; springe ich auf einem Deck, das schon klingt, an eine Stelle, die ich nicht gemessen habe, ist das immer ein Vorschlag an dich. Du hörst auf dem Kopfhörer vor; die Taste „Cypher hören“ legt meinen Vorschlag auf deinen Cue.
6. Bei 128 BPM spielt jedes Deck eine vorab auf 128 gerenderte Datei ohne Stretcher. Rubber Band R3 springt nur ein, wenn das Tempo abweicht; bleibt das Set länger woanders, rendert die Werkstatt nach (dein A12).
7. Frische KI-Songs laufen durch eine Werkstatt (Tempo-Karte, Warp aufs Raster, Stems, Fingerabdruck) und landen ohne Neustart in der Kiste. Ehrliche Zahl: ein 3-Minuten-Song braucht auf der GPU-Maschine heute 14 bis 22 Minuten, wir bestellen also einige Tracks im Voraus.
8. Stürzt der Kern ab, spielt eine Notbahn den letzten Takt weich weiter, bis er nach rund 40 ms plus Ladezeit wieder auf dem Raster ist.
9. Der erste gemeinsame Ton kommt bei festen 128 BPM, mit einem Song, der während des Sets fertig wird; Tempofahrten mit Keylock kommen danach.
10. Nichts davon ist am echten Interface oder mit deinem Ohr geprüft. Zuerst kommen Messungen und ein Hörtermin mit dir, dann die teuren Teile.

---

## 1. Woraus diese Fassung entstand

**Grundlage ist der Entwurf „KI-Mitspiel zuerst“** (`entwuerfe/entwurf-ki.md`). Er hat bei allen drei
Richtern die höchste gewichtete Summe (70,75 / 69 / 68,25 gegen Robust 67,5 / 68,25 / 66,75 und Spiel 62 /
64,75 / 64,25). Er trägt das Kernziel A1/A2/A13 am frühesten, erfüllt A4 am wörtlichsten (Mess-Abgriff
getrennt vom Cue) und kennzeichnet die LLM-Zahlen am ehrlichsten. Aus den beiden anderen Entwürfen kommt,
was alle drei Richter übereinstimmend empfehlen:

- **aus „Robustheit zuerst“ der Kern- und Betriebsteil:** kein Fremdcode im Kernprozess, Notbahn mit
  Blende, Watchdog nur bei Echtzeit-Fortschritt, Uhr „innen stetig, außen neu verankert“, Chaos-Prüfstand mit
  eigener Null-Senke je Lauf als Abnahme jeder Scheibe, Zusagen als Zahlen, Messliste mit Kippspalte,
  unveränderlicher Bestand, Laden aus der Kiste auch ohne Leitstand;
- **aus „Spielbarkeit zuerst“ der Deck- und Handteil:** kein Stretcher im Hörweg bei Faktor 1, Latenzbudget
  vom Griff bis zum Ton als Abnahmegröße, Roll hinter dem Keylock (nach Messung M6), Controller-Belegung mit
  Bass-Tausch-Taste und Spielart-Makro, Raster von Hand (Nudge, Tap), Halter auch für diskrete Deck-Griffe,
  die Taste „Cypher hören“.

Wo die Richter sich widersprechen (welcher Entwurf Grundlage ist, Reihenfolge der Scheiben), entscheidet
ADR 021 mit Beleg. Alle anderen Widersprüche stehen in Abschnitt 12.

**Neu gegenüber allen drei Entwürfen** (teils von den Richtern angemerkt, teils heute nachgelesen):
- Die Generierung läuft laut Skill `cypher-musik` nicht auf DJ-Maschine, sondern auf der GPU-Maschine (ComfyUI-Instanz `GPU-Maschine:8288`, GB10 mit
  gemeinsamem Speicher) und kostet dort heute 4,7 bis 7,2 s Rechenzeit je Sekunde Musik, bei Fremdlast
  gemessen; Modell laden 65 bis 80 s warm, 284 s kalt (belegt: Skill `cypher-musik`, Abschnitt „Die Zahlen,
  mit denen du planst“, dort als Betriebs-Befund ausgewiesen, heute nicht nachgemessen). Eine gemietete L40S
  schafft 1,35-fache Echtzeit (Skill `cypher-musik-mietgpu`, Zeile 8). Damit ist die Grafikspeicher-Frage auf
  DJ-Maschine (12 282 MiB, bis 11 218 fremd belegt, 10 §3a) nur noch eine Frage der Stem-Trennung, und „live
  generieren“ heißt: mit Minuten Vorlauf bestellen (ADR 022).
- `c_drift.log` hat inzwischen einen achten MiniMax-Song: `sofa-abend.mp3` mit Median 906,3 ms/min,
  60-s-Maximum 1236,6 ms/min, Pulsklarheit 0,06 (gemessen, Log-Stand 02:59). Die Kennzahl ist der Median der
  Beträge von 60-s-Steigungen aus 8-s-Phasenfenstern (`c_drift.py`, Funktion `miss`); bei Pulsklarheit unter
  0,1 kann sie Messrauschen nicht von echter Drift trennen, und eine Kontrolle mit starrem Raster und
  schwachem Puls fehlt (gerechnet und aus dem Code gelesen, Vermutung zur Größe). Folge für die Architektur:
  die Tempo-Karte generierter Songs kann grob falsch sein, darum Tore in der Werkstatt, Messung am Ausgang
  nach dem Warp, Tap und Nudge von Hand (ADR 011, M13).
- Die 10 gültigen Werkzeugaufrufe aus 09 NP K11 liefen bei 7 bis 23 Tausend Token Kontext
  (`llm_x_mcp_sonnet_low*_ergebnis.json`, Feld `cache_gelesen`); bei 259 266 Token ist nur die Text-Antwort
  gemessen (0 von 5 gültig). Die Wahl mit 1,307 bis 1,437 s ist ebenfalls nur als Text gemessen
  (`llm_x_wahl_sonnet_low_ergebnis.json`: `init_tools` leer). Beides ist ungemessen als Werkzeugaufruf (M15).

---

## 2. Prozessbild

```
 ZEIT-      PROZESS (systemd-User-Unit unter cypherdj.target)              RT    STIRBT ODER HÄNGT ER, DANN ...
 HORIZONT
 ─────────  ────────────────────────────────────────────────────────────  ────  ──────────────────────────────────
 vor/nach   Hauptinstanz Cypher (Opus, CLI, Gedächtnis): Rollenprompt,     nein  nichts im Set
 dem Set      Lernmodell, Nachbereitung, A/B-Paare rendern lassen
 Phrasen    cypherdj-spieler: Treiber + warme Sonnet-Sitzung               nein  Frist-Wächter im Kern, Andreas spielt
 (8-32 T)     ▲ Zug-Anfrage (WS)    │ MCP-Werkzeuge (stdio)                         allein weiter
              │                     ▼
            cypherdj-mcp (Node, Kind der Sitzung) ─ WS ─┐                   nein  Cypher blind, Musik läuft
 Takte      cypherdj-leitstand (Node/TS) ◄──────────────┘                   nein  keine neuen Pläne; angenommene Teile
 (1-16 T)     Annahme, Verriegelung, Hörschein-Register, Kopplung,                laufen im Kern zu Ende
              Autonomie, Zug-Takt, Lage, Kiste, Journal, WS-Hub
            ├ cypherdj-rechner (Python): Passung, Kandidaten,              nein  keine Kandidaten: Cypher darf nur
            │   Spielart-Regel, Vorhersage, Lernmodell                            ausblenden, nicht einblenden
            ├ cypherdj-analyse (Python): Takt-Bericht, Hörschein           nein  keine Hörscheine: nichts Neues wird
            │   (liest Hüllkurven aus /dev/shm)                                   durch Pläne hörbar, Hand frei
            ├ cypherdj-werkstatt (Python) + Jobs (Nice 19, batch)          nein  kein neues Material, Set läuft
            │   Tempo-Karte, Warp, Stems (CPU bei 256; GPU nach Frage 4), Fingerabdruck,
            │   Tore, Nachrendern; Generierung per HTTP an `GPU-Maschine:8288`
            │   später: cypherdj-zerleger (zweite Sonnet-Sitzung, A13)
            ├ cypherdj-erzeuger@strudel (Node, später)                     nein  Muster bis zum Horizont, dann Stille
            └ Ansage-Zeile (Terminal, liest WS), später Oberfläche          nein  nichts Hörbares
                   │ OSC/UDP 127.0.0.1:47100, Befehle mit Ziel-Beat
                   ▼   ▲ /q, /uhr, /zustand, /takt, /e/* (OSC an Abonnenten)
 Zyklus     cypherdj-kern (C++20, JACK-Client unter pw-jack, FIFO 83)      JA    Notbahn spielt weiter, systemd
 (256 =       ═══ DIE EINE UHR: int64-Sample-Zähler + Tempo-Karte ═══           startet neu, Kern setzt aus
 5,33 ms)     Stellwerk-RT (Regler, Halter, Rampen, Invarianten,                 /dev/shm auf dem Raster fort
              Frist-Wächter), Decks (Band, Direktweg, Schatten-Stretcher
              in Arbeits-Threads), Kanalzüge, Mixer, Cue, Mess-Abgriff,
              Messer, Lader (mmap+mlock), MIDI ein und aus
               │ /dev/shm/cypherdj/bus (Master+Cue)   ▲ node.async-Rückwege (später)
               ▼                                      │
            cypherdj-notbahn (C, klein)                JA    Stille bis Neustart: darum winzig
              1 Block versetzt, Blende, Schleife ≤ 8 Takte, Riegel
               ▼
            Interface: 1/2 Saal, 3/4 Kopfhörer ──► cypherdj-aufnahme (C)   JA    Aufnahme fehlt, Ton nicht
            später: cypherdj-klang@sunvox, cypherdj-wirt@<gruppe>         JA    nur ihr Anteil fehlt (M7)
                    (eigene JACK-Clients, Rückweg node.async + Puls)
                    cypherdj-link (Brücke, liest /uhr)                    nein  Außenwelt verliert Sync
 Sample     ANDREAS' HAND: USB-MIDI → ALSA → PipeWire-Midi-Bridge → JACK-MIDI mit Sample-Versatz → Kern
```

Zeichen und Wege im Einzelnen: `SCHNITTSTELLEN.md` §2 (Transporte, Ports, Pfade). Die „eigene App“ im Sinn
von A25 ist dieser Verbund, gestartet mit `systemctl --user start cypherdj.target`; eine Oberfläche kommt
später als weiterer, nur lesender Prozess dazu (ADR 001, 019).

### 2.1 Prozesse

| Unit | Technik | RT | Aufgabe | Beleg für den Schnitt |
|---|---|---|---|---|
| `cypherdj-kern` | C++20, libjack (pipewire-jack 1.6.8), librubberband 3.3.0, Bungee 2.4.30 (zweite Maschine), libebur128 (Quelle, MIT), nlohmann/json und toml++ als Einzel-Header, Faust-C++ zur Bauzeit; kein `dlopen` | ja | Uhr, Stellwerk-RT, Decks, Mixer, Cue, Mess-Abgriff, Messer, Lader, MIDI | 01 §3.2 (Callback 0,77 µs Mittel, 6,9 µs max, 0 Aussetzer in 5 min bei 128 und 256; **eingestuft nach 01 NP Punkt 2 und K9: die Plattform bedient einen fast leeren Callback zuverlässig, Kern-Last zeigen erst die R3-Läufe**), 01 Probe e1/e2, 10 §5 |
| `cypherdj-notbahn` | C, unter 200 Zeilen (Vorlage `proben/10-robustheit-betrieb/src/notbahn.c`), Ports und Freigabe als Aufrufparameter der Unit, keine Konfigurationsdatei | ja | letzte Meile, Blende, Schleife aus eigenem Verlauf mit Taktlänge aus dem Ring, Riegel gegen ungefragten Ton | 10 Probe c, NP N1/N2 |
| `cypherdj-leitstand` | Node 22.23 / TypeScript, `ws` 8.21.3 | nein | Annahme, Verriegelung, Hörschein-Register, Kopplung, Autonomie, Zug-Takt, Kiste, Journal | 09 §3.3, NP K1/K2 |
| `cypherdj-spieler` | Node-Treiber + `claude -p --input-format stream-json`, Sonnet, `MAX_THINKING_TOKENS=0` | nein | Cypher im Set | 09 §3.2, NP K6/K7 |
| `cypherdj-mcp` | Node, `@modelcontextprotocol/sdk` 1.30.0, Kind der Spieler-Sitzung | nein | Werkzeuge für Cypher | 09 §3.5 |
| `cypherdj-rechner` | Python 3.12 (NumPy, SciPy, torch, scikit-learn; `fa.py`) | nein | Passung, Kandidaten, Spielart-Regel, Vorhersage | 08 §3.3, NP K1/K2 |
| `cypherdj-analyse` | Python 3.12 (Vorlage `probe_c_live.py`), später C++ | nein | Takt-Bericht, Hörschein | 08 §3.3.6, 4.f (Python-Block p99 15,2 ms: nicht in den Callback) |
| `cypherdj-werkstatt` + `cypherdj-werkstatt-job@` | Python (neues venv mit `--system-site-packages` auf dem CUDA-torch 2.10.0 des Systems, dazu demucs 4.0.1, beat_this 1.1.0, Essentia 2.1b6; das Proben-venv hat nur torch 2.5.1+cpu, gemessen), rubberband-Bibliothek und CLI, ffmpeg | nein | Einlesen bis Bestand, Nachrendern, Korrektur-Fassungen, Generierung anstoßen | 07 Logs, 08 NP K5, 10 §5 |
| `cypherdj-aufnahme` | C (Vorlage `proben/01-audio-kern/a-cpp-jack/aufnehmer.cpp`) | ja | Master und Cue an den Notbahn-Ausgängen | 01 §4.4 (pw-record verliert Blöcke, JACK-Aufnehmer 0) |
| `cypherdj-zerleger` (Scheibe 6) | zweite Sonnet-Sitzung mit Werkstatt-Werkzeugen | nein | A13: Zerlegen als Rolle, urteilt über Loops, Namen, Warnungen | A13 wörtlich |
| `cypherdj-erzeuger@strudel` (Scheibe 7) | Node, `@strudel/core`/`mini` 1.2.6 nur `queryArc`, Worker ohne Rechte | nein | Muster zu Fenstern mit Beat-Stempel | 06 Probe a |
| `cypherdj-klang@sunvox` (Scheibe 7) | C++ um `sunvox.so` 2.1.4d, `node.async` | ja | Synth-Klang aus Kern-Ereignissen | 06 Probe b, ADR 010 |
| `cypherdj-wirt@<gruppe>` (Scheibe 8) | Carla 2.5.8 als Bibliothek, eigenes `HOME`, Xvfb, `node.async` | ja | Instrumente, Send-Effekte | 05 §4.5, 10 NP N9, ADR 009 |
| `cypherdj-link` (später) | C++, Ableton Link SDK 4.0 | nein | Tempo und Phase nach außen | 02 §3.3, ADR 004 |

---

## 3. Bausteine mit Technik und Beleg

### 3.1 Kern

**Technik:** C++20, JACK-API unter `pw-jack`, ein Echtzeit-Callback (SCHED_FIFO 83, von PipeWire vergeben,
01 §3.2) plus Arbeits-Threads für die Stretcher (niedrigere Echtzeit-Priorität, `ulimit -r` 95, 10 §3a) plus
Nicht-Echtzeit-Fäden (UDP-Empfang, Sende-Faden, Lader, LUFS-Faden, Zustandsschreiber, Watchdog-Ping). Keine
Allokation, keine Sperre, kein I/O, kein `dlopen` im Callback; geprüft durch einen Allokations- und
Sperr-Wächter im Testbetrieb und Last-Dauerläufe im Chaos-Prüfstand (ADR 002, 016). Kern verbindet seine
Ports selbst mit JACK-Namen (unter `pw-jack` heißt die Null-Senke `cypher-stumm-probe`, 01 §3.2 Falle).

**Enthält:**
- **Uhr** (§4): eigener Sample-Zähler plus begrenzte Tempo-Karte, Anker in `/dev/shm`.
- **Stellwerk-RT:** Regler-Tabelle mit Halter (`frei`, `mensch`, `plan:<id>`), Rampen und Setzen in Beats,
  diskrete Deck-Teile, Hand-Schiedsrichter (skaliert, relativ, erster Wert nur Stellung, Totzone 3/128),
  Laufzeit-Invarianten I1 bis I4 und Frist-Wächter (ADR 023). Vorlage `proben/09-ki-steuerung/stellwerk.mjs`
  mit 12 Tests plus den Angriffsfällen aus 09 NP (`angriff.mjs`) als Regression. Der JS-Prototyp kostete im
  Mittel rund 2 µs Algorithmus je Block, im schlechtesten Block aber 7 053 µs (JS-Laufzeit, 09 NP b3): darum
  C++.
- **Decks 1 bis 4** (ADR 007, 020): Band vor dem Stretcher nach Mixxx-Muster (Loop, Band-Roll mit Schatten,
  Beatjump, Hotcues, jeder Befehl mit Ziel-Beat; 03 §3.2, Probe 4d: Band 0,0 Frames Abweichung, R3-Kicks nach
  Roll −0,00 Samples). Drei Hörwege: **direkt** (Set-Tempo gleich Basis der Datei, bitgenau, kein Stretcher),
  **Schatten-Stretcher** (R3, warm, übernimmt bei Abweichung mit 20-ms-Kosinusblende), **Roll-Puffer** hinter
  dem Keylock (Scheibe 5, nach M6). Stems werden vor dem Stretcher gemischt (höchstens ein Stretcher je
  Deck); hat die Fassung Stems, klingt die Stem-Summe, sonst die Basis-Datei (umgeschaltet nur beim Laden).
  Phasenregler je Deck gegen `sample_at` auf dem Stretcher-Weg (02 NP K3/N5). Stretcher (vorläufig, siehe ADR 006 Nachtrag 2026-09-23): höchstens 2 R3 je
  Arbeits-Thread (01 NP K1: 8 R3 mit zwei Phasen im Pull-Modus 377 Überläufe in 60 s), angelegt und einmal
  durchgezogen im Lade-Faden (01 NP K3).
- **Kanalzüge** für Decks, Erzeuger-Kanäle, Pads und vier Gruppenbusse: Trim (aus `ziel_lufs`), LR8-Isolator
  246/2484 Hz mit Kill (Rampen zweiter Ordnung), TPT-Filter an einem Regler, PFL-Abgriff und Mess-Abgriff nach Filter
  vor dem Fader, Fader, Crossfader-Zuweisung, vier Sends nach dem Fader, Ziel Master oder Bus (Zuweisungstabelle,
  A17; ADR 008, `SCHNITTSTELLEN.md` §1.5).
- **Master und Cue:** Summe, FX-Busse (beatsynchrones Echo als Mischform aus der Uhr, Hall als Faust-Block),
  Master-Limiter mit Vorhalt, Cue um denselben Vorhalt verzögert, Kopfhörer-Mix und Split wie Mixxx.
- **Messer:** je Kanal Spitze, Echtspitze, LUFS M/S (libebur128, trifft EBU-Soll auf 0,007 LU, 04 §4.7),
  drei Bandpegel aus dem Isolator für die Anzeige; Hüllkurven der **sechs Analyse-Bänder** (Sub bis Hoch, 08 §3.3.1)
  mit 1 kHz in einen Ring in `/dev/shm` für die Analyse (`SCHNITTSTELLEN.md` §6.2; die frühere Fassung lieferte nur
  die drei Isolator-Bänder, aus denen sich die sechs Bänder von Takt-Bericht und Hörschein nicht rechnen lassen).
- **Lader** (Nicht-Echtzeit): Material aus dem Arbeitsbestand `/dev/shm/cypherdj/material/` per `mmap` und
  `mlock` einblenden, prüfen (Rate, Kanäle, Länge, NaN, Prüfsumme), Zeiger in den Callback reichen,
  Freigeben erst nach Rückgabe. Kosten 0,050 bis 0,056 ms je MiB, 3 GiB 156 bis 161 ms (10 NP N8). Budget
  gesperrt unter 4 GiB mit Entladen (10 Probe d: 4200 MiB scheitert; NP K7 `MCL_FUTURE`-Falle).
- **MIDI:** Hand-Eingang (JACK-MIDI mit Sample-Versatz), LED-Rückweg, später Ausgänge an Klang-Wirt,
  Plugin-Wirt und Geräte (MIDI-Clock).

**Beleg Gesamtform:** 01 §3.9 und §6.1 (ein Echtzeit-Kern mit Satelliten; Steuerung stirbt: 51 von 51
Schlägen exakt weiter, e2); 10 §5 (Unit-Schnitt). **A:** A1, A4, A5, A6, A9 bis A12, A14, A15, A17, A20,
A21, A23, A25. **Stand:** Einzelteile als Proben gemessen, der Kern als Ganzes ist zu bauen.

### 3.2 Notbahn

Eigener C-Prozess, liest den Master- und Cue-Ring des Kerns aus `/dev/shm/cypherdj/bus` einen Block
versetzt und gibt ihn an das Interface. Steht der Schreibzähler des Kerns (Absturz oder Hänger), schleift sie
den letzten Takt, **mit Blende an der Naht** (Vorgabe: ein weiterer Block, zusammen zwei Blöcke Latenz),
höchstens 8 Takte, danach Ausblenden über 2 Takte und Meldung. NaN/DC/Clip-Riegel als letzte Stufe. Die
Taktlänge liest sie aus dem Ring-Kopf (`takt_frames`, `takt_anfang_w`, vom Kern je Zyklus geschrieben), die
Schleife spielt sie aus einem eigenen Verlauf von mindestens 384 000 Frames; die Vorlage nahm ein festes
`--bpm 128` und hätte bei jeder anderen Set-Basis das Raster verloren. Ports als Aufrufparameter der Unit, nur nach
dem Riegel gegen ungefragten Ton (`SCHNITTSTELLEN.md` §6.1, §8).
**Beleg:** Shared-Memory-Notbahn 0 ms Stille in 5 von 5 Abstürzen und 4 von 4 Hängern, NP 5 von 5 und 2 von
2; Kanten-Notbahn beim Hänger 181 bis 216 ms Stille (10 Probe c, NP); harte Naht 13 von 14 Übernahmen mit
Sprung, mit echter Musik 47 % hörbar hell, mit 128 Samples Blende 11 % (10 NP N1/N2, offline); Latenz des
Rings genau ein Block (255,88 gegen 127,83 Samples). **Ungemessen:** Blende online (M2). **A:** A1, A3,
A20. ADR 016.

### 3.3 Leitstand

Node/TypeScript. Nimmt Pläne und Wahlen an, verriegelt sie (Form, zu spät, Regler beim Menschen,
Überlappung, Hörschein, Autonomie), vergibt Kopplungen (Basstausch-Paar, „A raus“ an „B rein“), führt das
Hörschein-Register, schickt Zug-Anfragen an Cypher, hält die Kiste und das Set-Journal, verteilt den
Takt-Zustand per WebSocket. **Beleg:** 09 §3.3 (sechs Leitsätze, 12 Tests, Mutationen färben rot), NP K1
(0 von 105 LLM-Plänen koppeln), K2, K5, K16 (eine Planform). **A:** A1, A4, A6, A7, A15, A16. ADR 013, 023.

### 3.4 Cypher im Set: Spieler, MCP, Rechner

- **Spieler:** Claude Sonnet in einer warmen Sitzung je Set, schlanker Rollenprompt, `MAX_THINKING_TOKENS=0`,
  Aufwärmzug vor dem Set. Vom Takt gerufen (Zug-Anfrage 8 Takte vor dem frühesten Start und bei Ereignissen),
  nie umgekehrt. **Wahl statt Plan:** Cypher antwortet mit `waehle{material, spielart, start_takt,
  hoerschein, absicht}` aus Kandidaten, die der Rechner vorbereitet hat; freie Pläne (`plan_einreichen`) sind
  die Ausnahme.
- **Rechner:** macht aus der Spielart (Parametersatz) nach genau der gemessenen Faustregel die Planteile
  (`SCHNITTSTELLEN.md` §14.4), lässt sie über Kreuzenergien der echten Mixer-Filter vorhersagen, prüft gegen die
  Sub-Grenze; der Optimierer bleibt Option, bis Andreas' A/B-Urteil ihn gewinnen lässt.
- **Beleg:** Wahl als Text 1,307 bis 1,437 s, 5 von 5 gültig (09 NP K7); freier Plan über das Werkzeug erst
  nach 4,5 bis 8,7 s beim Leitstand (NP K6), Antwortfrist des Vertrags 4 Takte (7,5 s bei 128); Faustregel doppelt
  den Sub weniger als der Optimierer (0,082 gegen 0,135 bei Grenze 0,10), liegt aber in den anderen Bändern über den
  Grenzen (Tief 0,402 bei Grenze 0,20, Tiefmitte 0,951; „hart“ Tief 0,355 bei 0,35; 08 NP K1): darum verriegelt nur die
  Sub-Grenze, die Tief-Grenzen warnen bis M20; realistischer Vorhersagefehler mit Keylock 0,038 Überdeckung,
  0,41 LU (08 NP K2). **Ungemessen:** Wahl als Werkzeugaufruf, Zugzeit und Kosten über zwei Stunden (M15).
- **A:** A1, A7, A8, A15, A16. ADR 013, 012.

### 3.5 Analyse

Blocktakt-DSP (Bänder, Hüllkurven, LUFS) sitzt im Kern; die Taktende-Auswertung läuft in `cypherdj-analyse`
(Python), die die Hüllkurven aus `/dev/shm/cypherdj/huellen` liest. Je Takt: Bänder je Kanal, Überdeckung je
Band, **Versatz je Deck gegen seine Referenz** (prüft die Ausführung) **und Anschläge Deck gegen Deck** (prüft
das Raster, weil der Referenz-Versatz ein falsches Raster nicht sieht), Lautheit, Takt, Phrase, Frist.
Daraus der **Hörschein** eines vorgehörten Kanals nach 4 Takten Messung, danach **nach jedem Takt erneuert**, solange
der Kanal synchron läuft (sonst lief er im Normalablauf genau am Start ab, §5.1). Der Hörschein bindet Kanal und
**Inhalt** (Material und Fassung, Schuss oder Muster) und bei Decks den gemessenen Quell-Beat-Bereich; I3 prüft damit
auch neuen Inhalt auf schon offenen Kanälen (`SCHNITTSTELLEN.md` §17). Deck gegen Deck ist für generiertes Material
Pflicht. Die sechs Bänder kommen aus dem Hüllkurven-Ring, die Referenz `huelle_1khz.npy` ist mit denselben Filtern
gerechnet. **Beleg:** 08 §3.3.6, Probe 4c
(eingebauter Versatz 20 ms kam als 20,0 bis 21,9 ms an), 4.f (Takt-Auswertung max 34,8 ms, NP 20,6 ms: über
dem Blockbudget, also eigener Prozess), NP K4 (nach Raster-Korrektur MFB median 10,4 ms zu früh, 66 % der
Schläge im Flam-Bereich; der Referenz-Versatz sieht das nicht). **Ungemessen:** Hörschein-Schwellen (M18).
**A:** A4, A15, A20. ADR 012.

### 3.6 Werkstatt, Generierung, Bestand

- **Werkstatt** (Python, `Nice=19`, `CPUSchedulingPolicy=batch`, `IOSchedulingClass=idle`, wenige Threads):
  Kette je Song: dekodieren, −12 dB Luft, Beat-Raster, Tempo-Karte und **Takt-Eins** der Quelle (beat_this, zweites
  Werkzeug Essentia bzw. Tief-Band-Energie), Halb- oder Doppeltempo-Wahl, R3-Warp per Timemap auf das starre Raster
  der Set-Basis (Bibliothek oder `rubberband -3 --timemap`, Float) mit Stimmungskorrektur auf 440 Hz im selben Lauf,
  Stems (im Set auf der CPU nur bei Quantum 256 mit Nice 19; auf der DJ-Maschine-GPU erst nach Andreas' Antwort zu Frage 4
  und M9; bei 128 nie auf der CPU), Fingerabdruck in Beat-Zeit, Kreuzenergien, Referenz-Hüllkurven (sechs Bänder)
  aus dem, was klingt, Struktur, Hotcue-Vorschläge an Phrasen ab der Takt-Eins, Einzelschüsse, **Tore** (Raster-Rest
  **unabhängig gemessener** Anschläge nach Warp, Pulsklarheit ≥ 0,1 ohne Ausnahme, Streckfaktor ±15 %, Takt-Eins,
  Headroom), atomar als **Fassung** in den Bestand, `material_fertig`. Warteschlange mit Vorrang: 1 Nachrendern
  geladener Decks auf eine neue Set-Basis und Korrektur-Fassungen, 2 Einlesen frischer Songs, 3 Vorrat.
- **Generierung:** Auftrag `erzeuge` an die ComfyUI-Instanz der GPU-Maschine (MiniMax Music 3), Ergebnis per HTTP
  nach DJ-Maschine, dann Werkstatt. Mit Minuten Vorlauf (ADR 022).
- **Bestand:** je Material ein Ordner nach Inhalts-Hash mit `original.*` und `material.json` (einmal geschrieben),
  `korrekturen.jsonl` (die einzige anhängbare Datei) und je Render einer unveränderlichen **Fassung**
  `fassungen/<bpm·1000>_r<n>/` (rohes Float32, 48 kHz, Stereo, verschränkt; Stems, Schüsse, `fassung.json`,
  Fingerabdruck, Kreuzenergien, Referenz-Hüllkurven). Der Kern dekodiert nie. **Arbeitsbestand** und **Kiste** in
  `/dev/shm/cypherdj/` (ADR 015). Die Lautheit setzt der Kern beim Laden als Trim = `ziel_lufs` − LUFS der Fassung
  (Vorgabe −16 LUFS, Trim bis +24 dB): die zehn MiniMax-Songs liegen bei −13,6 bis −15,5 LUFS, der Club-Track MFB bei
  −7,5 LUFS (gemessen 2026-09-23, offline und stumm mit `ffmpeg -af ebur128=peak=true` auf `samples/bestand/*.mp3` und
  `stems/mfbass/orig.mp3`, alle elf Werte; Spitzen der MiniMax-Songs bis +0,6 dBFS); mit −12 dB Luft und +12 dB Trim wäre kein Ziel über
  rund −15,5 LUFS für alle erreichbar gewesen.
- **Beleg:** 07 `b_timemap.log` (driftender Klick: Rest 0,19 ms RMS mit Timemap, 45,26 ms ohne; R2 1,94 ms;
  **eingestuft: Timemap-Mechanik mit bekannter Wahrheit**, die Timemap stammt aus den wahren Schlagzeiten eines
  synthetischen Klicks; über die Tempo-Karte aus beat_this an MiniMax-Songs sagt es nichts, das misst M13),
  `b_strecken.log` (R3 hält 110,000 Hz, nur Faktor 134/128; 15-s-Loop 0,64 bis 3,21 s unter Last), `c_drift.log`
  (MiniMax Pulsklarheit 0,03 bis 0,24, 8 von 10 unter 0,1; Quell-BPM 89,905 bis 180,709; Drift-Kennzahl 9,6 bis
  183,1 ms/min (Minimum korrigiert 2026-09-23 nach Dossier 07) und 906,3 ms/min bei `sofa-abend`), `pip_torch.log` (torch, demucs, beat_this, Essentia im venv
  installiert; torch dort nur 2.5.1+cpu, beat_this und Demucs nie mit echten Gewichten gelaufen, gemessen 2026-09-23); 08 NP K5 (Kommandozeile klemmt bei
  ±1,0 auch mit `--ignore-clipping`, MFB bis +5,09 dBFS: −12 dB Luft), 08 NP „Was fehlt“ 6 (Fingerabdruck
  eines 8-Minuten-Songs 54,14 s plus Kreuzenergien 21,14 s auf einem Kern), 10 NP N6 (HTDemucs auf der CPU:
  55 % der 128er-Periode, 15 % bei 256; zufällige Gewichte, 8 Fäden), 10 Probe b L2 (16 × R3 offline neben dem
  Messclient: 0 Lücken bei 128). **Ungemessen:** Raster und Takt-Eins an echten MiniMax-Songs nach Warp (M13), Ende zu
  Ende und BPM-Treue von MiniMax (M14), Keylock bei Streckfaktoren über ±5 % und Stimmungskorrektur (M19), Stems auf
  der DJ-Maschine-GPU neben dem Kern samt Grafikspeicher der echten Kette (PyTorch-Demucs laut Recherche rund 7 GB,
  undatiert; fremd belegt diese Nacht 7 786 bis 10 832 von 12 282 MiB) und Job-Start und -Ende (M9).
  **A:** A2, A10, A12, A13, A16, A19. ADR 011, 015, 022.

### 3.7 Aufnahme und Journal

`cypherdj-aufnahme` nimmt Master und Cue **an den Notbahn-Ausgängen** auf (also das, was wirklich klingt,
auch Notbahn-Schleifen) und schreibt dazu, welches Kern-Sample der erste Frame ist. Der Leitstand schreibt
das Set-Journal (JSONL auf der Sample-Uhr: jeder Befehl mit Quittung, jeder Handgriff, jeder Plan mit
Gründen, jeder Hörschein, jede Zug-Anfrage mit Antwortzeit, jedes Urteil). **Beleg:** 01 §4.4 (JACK-Aufnehmer
0 Verluste, `pw-record` 4 Blöcke), 09 §3.8, NP K12 (0,59 MB je Stunde für Taktzeilen mit 4 Reglern).
**A:** A1, A16. ADR 008, 015.

### 3.8 Controller

USB-MIDI-Klassengerät → ALSA → PipeWire-Midi-Bridge → JACK-MIDI-Eingang des Kerns, kein Umweg über Node.
Mapping als Datei; erster Wert je Regler nur als Stellung; Totzone 3/128; skaliert für Potis und Fader,
relativ für Endlos-Encoder; Tasten für Annehmen, Verwerfen, „Cypher, Vorschlag“, „Cypher hören“, Stopp,
Freigabe, Urteil, Autonomie-Stufe, Bass-Tausch, Spielart-Makro, Umschalt plus Tap für die Takt-Eins; LEDs für
Halter, Hörschein, Vorschlag,
Frist-Countdown, Notbahn. Laden aus der Kiste auch bei totem Leitstand. **Beleg:** 09 Probe c und NP (5,326 ms
bei 256, Spanne 0,060 ms, 300 von 300, Software-Sender), NP K3 (Sprung 0,3675 bei unbekannter Stellung), K4
(ein Rauschschritt bricht die KI-Fahrt ab); `hidapi` fehlt auf DJ-Maschine (09 §3.7). **Ungemessen:** Andreas'
Gerät (M17). **A:** A1, A5, A7, A14, A26. ADR 014.

### 3.9 Später: Erzeuger, Wirte, Link

- **Erzeuger** (A21, A22): Strudel-Kern als `queryArc` in eigener Unit, Fenster „ersetzen“ mit Beat-Stempel
  zwei Takte voraus direkt an den Kern (06 Probe a: 295 von 295 frame-genau; Node 6 s lahm: bis zum Horizont
  exakt, danach Stille statt Schwall); Spielzettel als gemeinsamer Text (06 Probe c); SunVox im eigenen
  Klang-Wirt (ADR 010). Jeder Erzeuger ist ein voller Kanal im Kern, dessen Fader bei −200 dB startet und nur
  mit Hörschein aufgeht (09 NP K10); ein neues Muster auf einem offenen Kanal spielt nur mit Hörschein für dieses
  Muster (I3c), neue Muster werden auf einem geschlossenen Kanal vorgehört.
- **Plugin-Wirt** (A18): Carla als Bibliothek in eigener Unit, Rückweg `node.async` mit Puls-Port, Noten und
  CC als JACK-MIDI mit Sample-Versatz aus dem Kern (05 §4.4: 0 bis 3 Samples; OSC 1,67 bis 37,58 ms); jeder
  Slot beim Laden per Klick durchgemessen (05 §4.2). Erst nach M7 im Mix (ADR 009).
- **Link und MIDI-Clock** (A20 nach außen): Kern führt, Link in einer Brücken-Unit, MIDI-Clock aus dem Kern;
  JACK-Transport nie (ADR 004).

---

## 4. Die eine Uhr und die Zeitbasis

**Wo:** im Echtzeit-Callback des Kerns. Die Uhr ist ein eigener `int64`-Sample-Zähler (Summe der `nframes`)
plus eine Tempo-Karte aus Segmenten (konstant oder linear in der Zeit; S-förmige Ecken erst nach V1). Beat, Takt, Phrase
und Frist sind Funktionen davon:

```
beat(s)   = b0 + (bpm0·dt + k·dt²/2) / 60              dt = (s − s0)/48000,  k = (bpm1 − bpm0)/T
sample(b) = s0 + 48000 · 120·(b − b0) / (bpm0 + sqrt(bpm0² + 120·k·(b − b0)))
```

(02 §3.1, `kern/uhrkern.cpp` Z. 72 bis 88; Hin- und Rückrechnung auf 5,7·10⁻¹⁴ Beats, 02 Probe d; eine
unabhängige Python-Umsetzung traf die Takt-Klicks des C++-Kerns in fünf Läufen je 101 von 101 auf das Sample,
02 NP). Den Sample-Takt gibt der Quarz des Interfaces als Treiber des Graphen; die musikalische Zeit gibt
allein der Zähler des Kerns.

**Was keine Uhr ist:** die Frame-Zeit des Treibers (sprang beim Treiberwechsel um −2 978 880 305 Frames,
02 Probe b), der JACK-Transport (kippt beim Treiberwechsel, 02 Probe b, k_trans1), Link als Quelle (Tempo in
ganzen µs je Beat, 50-ms-Sendebremse, Übernahme 0,15 bis 50,25 ms, 02 Probe a und NP N3), Strudels `cps`
(fällt mit dem Browser, 02 §3.1 E), Wanduhr und OSC-Zeitmarken (spielen Verspätetes „immediately“, OSC 1.0).

**Regeln an der Uhr** (ADR 004):
1. **Innen stetig, außen neu verankert.** Ein ausgefallener Zyklus verschiebt die Musik gegen die Wanduhr um
   einen Block; innen merkt es niemand, weil alles Phasenstarre in einem Prozess liegt. Nach außen (Link,
   MIDI-Clock) wird bei jedem erkannten Ausfall und Treiberwechsel neu verankert und der HostTimeFilter
   zurückgesetzt, sonst liegt er bis 2,8 ms daneben und braucht 2,67 s (02 NP N6).
2. **Neustart setzt auf dem Anker fort.** Anker `{anker_sample, anker_mono_ns, Tempo-Karte}` liegt im Zustand
   in `/dev/shm`; der neue Kern rechnet, wo er ohne Absturz stünde (Mini-Kern: Raster nach Neustart höchstens
   0,2 Samples, NP bis 0,95, 10 Probe c).
3. **Karte begrenzt und ehrlich.** Vergangene Segmente fallen weg, eine abgelehnte Änderung wird gemeldet (02
   NP N4: die Probe-Karte lief nach 15 Reglerwechseln voll und meldete trotzdem Erfolg). Andreas'
   Tempo-Regler ist **ein** Hand-Segment, das je Zyklus überschrieben wird; jede Encoder-Raste fährt es als Rampe
   über 1 Beat (Regel 4).
4. **Keine Tempo-Sprünge auf hörbaren Keylock-Decks**, nur Rampen (Mindestdauer 1 Beat), **auch nicht von Hand**:
   Andreas' Tempo-Encoder setzt 0,01-BPM-Rasten, jede wird als Rampe über 1 Beat gefahren, und der Phasenregler
   ändert den Faktor je Block höchstens um 10 ppm (`SCHNITTSTELLEN.md` §1.3, §7.3 Punkt 7). Grund: ein nativer
   R3-Knoten brauchte nach einem Faktorsprung 95 ms, bis die Tonhöhe wieder innerhalb 10 ct lag, **und lieferte 128
   Null-Samples** (ERGEBNIS §2.6); ob kleine Faktorwechsel auch Null-Samples erzeugen, ist ungemessen (M4). Rampenecken
   hinterlassen im Delay einen Rest von −107,3 dBFS, mit S-Ecken −144,5 dBFS (04 §4.5); S-Ecken kommen als spätere
   Segmentart, V1 bleibt linear (Rest unter der 16-bit-Stufe).
5. **Phasenregler je Deck** auf dem Stretcher-Weg: gelieferte Quellposition gegen `sample_at` vergleichen,
   Faktor um wenige ppm nachstellen; geplante Rampen setzen den Faktor eine Engine-Verzögerung voraus (02 NP
   N5: ohne Regler in der Rampe bis 1,92 ms hinten, danach 1,4 ms bleibend, bei 132 BPM 8,1 ppm Drift; mit
   Vorhalt danach 3,5 bis 12,3 Samples). Auf dem Direktweg gibt es nichts zu regeln (03 Probe 4a:
   Null-Maschine 0,000 ms Drift in 30 min).

**Zeitbasis der Befehle** (ADR 005): Musikzeit ist der Beat (`f64`, Viertel, Beat 0 = Set-Start, 1 Takt = 4
Beats, 1 Phrase = 8 Takte). Alle Prozesse außer der Hand schicken Beats; die Hand kommt als MIDI mit
Sample-Versatz und wirkt eine Periode nach dem Griff am richtigen Sample. Beats lohnen sich, weil der Kern
Tempoänderungen **nach dem Senden** auflöst: 0 Samples gegen bis 554 Samples (11,5 ms) für Befehle, die beim
Umplanen unterwegs waren (02 NP N1). Die Zusage „genau oder gemeldet“ hielt auch an der Kante (24 von 24,
02 NP N2). Verspätung wird **je Befehlsart** behandelt: Musik-Ereignisse und KI-Planteile verworfen und
gemeldet; Zustandsbefehle (Fader zu, Kill, Stopp) am nächsten Zyklus mit 10-ms-Rampe ausgeführt und gemeldet;
Deck-Griffe auf den nächsten erreichbaren Rasterpunkt (02 NP K11). Vorlauf je Ebene und alle Formate:
`SCHNITTSTELLEN.md` §1, §3.

---

## 5. Datenflüsse

| Fluss | Weg | Takt | Beleg |
|---|---|---|---|
| Hand → Kern | Controller → Midi-Bridge → JACK-MIDI `cypherdj-kern:hand_in`, Sample-Versatz | je Ereignis, eine Periode | 09 Probe c, NP |
| Leitstand, Erzeuger → Kern | OSC/UDP `127.0.0.1:47100`, Befehle mit Ziel-Beat, lock-freier Ring in den Callback | Senden bis Übernahme median 2,9 ms, max 8,1 ms | 02 Probe b, NP |
| Kern → alle | OSC/UDP an Abonnenten: `/q` Quittung, `/uhr` je Zyklus, `/zustand/*` 50 Hz, `/takt` je Takt, `/e/*` Ereignisse | wie genannt | 01 §5, 06 `/uhr` (Schätzfehler höchstens 0,024 ms) |
| Kern → Analyse | Hüllkurven-Ring `/dev/shm/cypherdj/huellen`, 1 kHz je Kanal | laufend | 08 §3.3.6 |
| Analyse → Leitstand → Kern | Takt-Bericht, Hörschein (WS), dann `/k/hoerschein` | je Takt, Hörschein nach 4 Takten, danach Erneuerung je Takt | 08 Probe 4c, 09 Test 8 |
| Leitstand ↔ Cypher | WS ↔ `cypherdj-mcp` ↔ stdio ↔ Sonnet-Sitzung | je Zug | 09 §3.5 |
| Leitstand ↔ Rechner | Unix-Socket, JSON-Zeilen | je Anfrage | Entwurf |
| Werkstatt ↔ GPU-Maschine | HTTP an ComfyUI `:8288` (MiniMax), Ergebnis per HTTP-Abruf | je Auftrag, Minuten | Skill `cypher-musik` |
| Werkstatt → Bestand → Kern | Dateien atomar (temporär, `rename`), `material_fertig` über den Leitstand, Kopie in den Arbeitsbestand, Kern-Lader `mmap`+`mlock` | Sekunden | 10 NP N8 |
| Kern → Notbahn → Interface | Ring `/dev/shm/cypherdj/bus` (Master, Cue), Notbahn an Interface 1/2 und 3/4 | je Zyklus, +1 Block (+1 für die Blende) | 10 Probe c |
| Notbahn → Aufnahme | JACK-Kanten an die Notbahn-Ausgänge | je Zyklus | 01 §4.4 |
| Kern ↔ Wirte (später) | Sends als JACK-Audio, Noten/CC als JACK-MIDI mit Versatz; Rückweg `node.async` + Puls-Port | je Zyklus, +1 Block | 05 §5, 10 NP N9 |

### 5.1 Ein Übergang, Takt für Takt (128 BPM, 1 Takt = 1,875 s)

F ist die Frist: der Takt, an dem Deck A leer ist oder etwas passieren muss (A7). Beispiel Spielart
„sicher“ (16 Takte, 08 §3.3.4), frühester Start S = F−16.

| Takt | Wer | Was | Stand |
|---|---|---|---|
| F−40 | Leitstand, Rechner | Frist aus der Struktur von A erkannt; Rechner liefert bis zu drei Kandidaten aus der Kiste mit Passung und Vorhersage je Spielart | Passung gemessen (08 §3.3.2); Kandidaten-Rechenzeit ungemessen (Planer „sicher“ 0,891 s, 08 NP 4.f) |
| F−36 | Leitstand → Kern | Kandidat 1 in ein freies Deck laden (Fader −200 dB) | Einblenden 0,05 ms je MiB (10 NP N8) |
| F−35 | Leitstand → Kern | Vorhören: B startet synchron **an seinem Einstieg** (`einstieg_quell_beat` des Kandidaten), nur Mess-Abgriff; Laden damit 1 Takt vor Messbeginn wie `SCHNITTSTELLEN.md` §3 | Einstieg aus Struktur und Takt-Eins, gesetzt |
| F−31 | Analyse → Leitstand → Kern | Hörschein nach 4 Takten: Versatz gegen Referenz, Deck gegen Deck, LUFS, Pegel gegen das laufende Deck, Bänder; danach **Erneuerung nach jedem Takt**, gültig bis 16 Takte nach dem jeweils letzten gemessenen Takt | Messdauer gesetzt, ungemessen |
| F−24 | Leitstand → Spieler | Zug-Anfrage mit Lage, Kandidaten, Hörschein, Vorhersage, Antwortfrist in Beats | 8 Takte vor S (09 §3.2) |
| F−24 + ≈1 T | Spieler → Leitstand | `waehle` | als Text 1,307 bis 1,437 s gemessen, als Werkzeug ungemessen (M15) |
| F−23 | Leitstand + Rechner | Wahl zu Planteilen expandieren, koppeln, Vorhersage gegen Grenzwerte; bei Stufe 1 als Vorschlag: LED blinkt, Ansage-Zeile „T 113: Nightshift rein, sicher 16 T, Basstausch T 121“ | 09 NP K1, K7 |
| bis S−1 | Andreas | Annehmen oder Verwerfen; „Cypher hören“ legt B auf seinen Cue | Reaktionszeit ungemessen |
| S | Kern | B startet neu am Einstieg (Deck-Teil `start`), B-Fader-Rampe startet am Ist-Wert; Zweitprüfung des Hörscheins (I3a: Inhalt, Tempo, `beat ≤ gueltig_bis_beat`, Quellposition im gemessenen Bereich) | 09 Leitsätze 4, 6 |
| S+7 bis S+8 | Kern | Basstausch als gegenläufige EQ-Rampe über einen Takt (Regel §14.4 im Vertrag); Invariante I1 „Sub nie doppelt“ | 09 NP K1, 08 NP K1 |
| S+11 bis F | Kern | A raus samt Deck-Stopp in einer Gruppe; Invariante I2 „Master nie leer“: Ausblende und Stopp warten, falls B verriegelt wurde oder nicht läuft | 09 NP K2 |
| jederzeit | Andreas' Hand | Griff: nur dieser Regler und seine Gruppe gehen an ihn, am selben Sample | 09 Probe b |
| F−8 ohne übernehmenden Plan | Kern | Frist-Wächter (nur wenn A der einzige hörbare Kanal ist): Loop über die letzten vollen 4 Takte von A, Meldung `rueckfall` | Mechanik 03 §4d, Rückfall ungemessen |

Zeitdruck ist damit eine Größe: mit „hart“ (4 Takte) rückt die Zug-Anfrage auf F−12; unter F−8 bleiben nur
Rückfall-Loop oder Andreas' Hand (A7).

### 5.2 Ein frischer Song, vom Auftrag bis zum Deck

1. Cypher (Werkzeug `erzeuge`) oder Andreas bestellt; der Leitstand gibt der Werkstatt einen Auftrag mit
   Stil, Ziel-BPM nahe der Set-Basis, Dauer, Text (Prompt-Form nach Skill `cypher-musik`). Ob MiniMax das Ziel-BPM
   trifft, ist ungemessen (M14); die zehn vorhandenen Songs liegen bei 89,9 bis 180,7 BPM, und das Tor
   `streckfaktor` (±15 %) ließe davon nur drei durch (gerechnet).
2. Die Werkstatt schickt den Auftrag an ComfyUI auf der GPU-Maschine; Dauer dort heute 4,7 bis 7,2 s je Sekunde
   Musik plus 65 bis 80 s Modell laden (Betriebs-Befund, Skill `cypher-musik`), also für einen 3-Minuten-Song
   14 bis 22 min Rechnen plus Laden, zusammen rund 15 bis 23 min (gerechnet).
3. Datei nach DJ-Maschine, Werkstatt-Kette bis zu den Toren; Dauer ungemessen, gerechnet 1 bis 5 min für 3 Minuten
   Audio (R3 offline 5- bis 23-fach Echtzeit je Kern nach 07 `b_strecken.log`, Fingerabdruck plus
   Kreuzenergien rund 30 s nach 08 NP „Was fehlt“ 6, Stems auf der GPU ungemessen).
4. `material_fertig` an den Leitstand; Tore bestanden → Kiste und Kandidat für Cypher; Tor gerissen → nur
   Andreas angeboten, mit Warnung.
5. Weiter wie 5.1.

Messung Ende zu Ende: M14.

---

## 6. Latenz vom Griff bis zum Ton

| Glied | Quantum 128 | Quantum 256 | Einstufung |
|---|---|---|---|
| USB-Abfrage des Controllers | ≈ 1 ms | ≈ 1 ms | Vermutung (09 §4.6 Deutung) |
| Midi-Bridge bis Ereignis-Sample im Kern | 2,67 ms | 5,33 ms | 256 gemessen (5,32 / 5,326 ms, 09 Probe c, NP), 128 gerechnet |
| Kern-Ring bis Notbahn | + 2,67 ms | + 5,33 ms | gemessen bei 128 (10 Probe c: 127,83 → 255,88 Samples) |
| Blende der Notbahn gegen den Knack | + 2,67 ms | + 5,33 ms | gerechnet (10 NP K1) |
| Ausgabepuffer des Interfaces bis zum Wandler | ≥ 2,67 ms | ≥ 5,33 ms | ungemessen (A26) |
| **Summe Fader, EQ, Kill, Filter, Band-Griffe im Direktweg** | **≥ 11,7 ms** (ohne Blende ≥ 9,0) | **≥ 22,3 ms** (ohne Blende ≥ 17,0) | gerechnet, Untergrenze |
| zusätzlich Band-Griffe auf dem Stretcher-Weg (Hotcue, Beatjump, Loop von Hand) | + Arbeitsvorlauf + Bandvorlauf R3 | + 21,3 ms (4 Blöcke) + 80,9 ms | gerechnet aus 03 Probe 4a (3884,9 Frames), Vorlauf ungemessen (M3); zusammen rund 125 ms bei 256 |
| zusätzlich Tempo von Hand auf dem Stretcher-Weg | + Arbeitsvorlauf + Engine-Verzögerung | + 21,3 ms + 42,7 ms | gerechnet aus 02 Probe c (Verzögerung 2048 Samples) |

Folgen: Im Normalfall (Direktweg) wirkt jeder Griff eine Periode nach dem MIDI-Ereignis im Kern; bis zum
Ohr sind es bei 256 mit weicher Notbahn gerechnet mindestens 22,3 ms. Quantisierte Band-Griffe auf dem
Stretcher-Weg landen exakt, wenn ihr Ziel-Beat mindestens den Vorlauf entfernt liegt (bei 128 BPM ist ein
Beat 469 ms); nur „sofort“ trifft dort rund 125 ms später. Ob eine zweite, vorgefüllte Stretcher-Instanz
(„Sprungmaschine“) nötig ist, entscheidet M2b nach dem Hörtermin (ADR 020). Hebel, falls Andreas es träge
findet: Quantum 128, wenn M1 es trägt, oder Notbahn ohne Blende (dann knackt es nur im Absturzfall). Das
ist Frage 3 in §13.

---

## 7. Ausfallverhalten und Zusagen als Zahlen

| Es stirbt oder hängt | Folge | Stand |
|---|---|---|
| Kern stirbt (`kill -9`) | Notbahn schleift den letzten Takt (mit Blende), systemd startet neu (`RestartSec=0`), Kern liest Anker, Karte, Decks, Regler und ausstehende Befehle aus `/dev/shm`, blendet Material ein und setzt auf dem Raster fort; die Notbahn gibt mit Blende zurück | Mini-Kern gemessen: erster Block nach 38,7 ms (NP 39,9), 0 ms Stille, Raster ≤ 0,95 Samples (10 Probe c, NP); Material-Einblenden +0,05 ms je MiB (NP N8); Stretcher-Wiederanlauf ungemessen, aber ein frischer R3 kostet im ersten Block 4,6 bis 6,4 ms, wenn er nicht vorher im Lade-Faden einmal durchgezogen wird (01 NP K3): Pflicht im Neustartpfad; Abonnenten stehen im Zustand, `/e/neustart` geht sofort an sie (`SCHNITTSTELLEN.md` §4.1) |
| Kern hängt | Watchdog (200 ms, `WATCHDOG=1` nur bei Echtzeit-Fortschritt, SIGKILL), dann wie oben | Watchdog schlug nach 190,7 bis 214,5 ms zu, 0 ms Stille über die Shared-Memory-Notbahn (10 Probe c) |
| Notbahn stirbt | Stille bis zu ihrem Neustart (gleiche Unit-Regeln); deshalb so klein wie möglich | ungemessen |
| Leitstand stirbt | Kern spielt, angenommene Teile laufen im Kern zu Ende, Hand wirkt, Controller lädt aus der Kiste; keine neuen Pläne | Muster gemessen (01 Probe e2: 51 von 51 Schlägen), Kiste ohne Leitstand Vermutung |
| Spieler oder MCP stirbt | wie oben; Frist-Wächter verhindert Stille | Frist-Wächter ungemessen |
| Rechner, Analyse stirbt | keine Kandidaten, keine Hörscheine: Pläne dürfen nichts hörbar machen (I3); Hand frei | Entwurf |
| Werkstatt, Generierung stirbt | kein neues Material; Auftrag wird wiederholt | Entwurf |
| Klang- oder Plugin-Wirt stirbt oder hängt | nur sein Rückweg fällt aus, der Kern blendet ihn nach dem stehenden Puls aus | 10 NP N9 für den Kern gemessen, für einen echten Wirt ungemessen (M7); Widerspruch 05 §4.5 gegen 10 NP N3 offen |
| PipeWire stirbt | alles still; Kern stirbt mit und wird von systemd neu gestartet, Anker in monotoner Zeit | ungemessen (braucht Andreas' Ja, unterbricht seinen Desktop-Ton) |

**Zusagen als Zahlen** (Abnahmegrenzen, gemessen am Ziel über den Chaos-Prüfstand: JACK-Aufnehmer an den
Monitor-Ports einer **eigenen** Null-Senke je Lauf, weil die geteilte Senke von mehreren Proben beschrieben
wird, 06 Risiko 1: 16 790 fremde Klicks in 66 s; Werte ohne Messbasis sind Zielwerte):

| Zusage | Grenze | Basis |
|---|---|---|
| Kern stirbt | höchstens 1 Block Stille (Knack) je Absturz in 20 von 20, Notbahn daneben (ADR 016 Nachtrag 2026-09-25); vorher, Notbahn in Reihe: 0 ms Stille, Naht mit Blende ohne Hochton-Sprung über 6 dB in mindestens 18 von 20 | M2b daneben 9 von 9 je genau ein Block (Scheibe 06); in Reihe 10 Probe c (5 von 5), NP N2 offline 11 %; Hörprobe beim Hörtermin (46) entscheidet, ob es zurück in Reihe geht |
| Kern hängt | höchstens ~100 ms Stille in 10 von 10 über den Selbst-Wächter im Kern (eigener Prozess, `--waechter-ms 100`), systemd-Watchdog als zweite Linie | 18 (2026-09-26): Selbst-Wächter 96,0 ms in 10 von 10, Raster 0; systemd allein 170,7 bis 384,0 ms (6 von 10 über 250 ms); daneben mit Kante ohne Wächter 2997 ms (16). Fehlauslösung bei stehendem Graphen offen (M11, 48) |
| Kern wieder hörbar | höchstens 250 ms samt Material, Raster höchstens 1 Sample | 40 ms + 0,05 ms je MiB (10 Probe c, NP N8) |
| Leitstand, Spieler, MCP, Rechner, Analyse, Werkstatt sterben | 0 Frame-Lücken, Hand wirkt, laufende Teile fahren zu Ende | Muster 01 Probe e2 |
| Wirt hängt oder stirbt | 0 Frame-Lücken im Kern, Rückweg nach höchstens 2 Blöcken ausgeblendet | ungemessen (M7) |
| Werkstatt rechnet im Set | Aufwachen des Kerns unter 30 % der Periode, 0 Lücken, bei 256 (CPU-Stems nur bei 256, Nice 19; bei 128 nie) | HTDemucs auf der CPU bei 256: 15 % (10 NP N6, zufällige Gewichte, 8 Fäden) |
| Callback des Kerns | p99,9 unter 20 % der Periode (1,07 ms bei 256), Maximum unter 50 % | ungemessen |
| Deck-Vorlauf (Stretcher-Weg) | Füllstand nie unter 1 Block, jeder Unterlauf gezählt | ungemessen (M3) |
| Dauerlauf | 2 h bei 256 am Interface: 0 Frame-Lücken, 0 Deck-Unterläufe | ungemessen; bisher 10 min (10 Probe b) |

Der JACK-Xrun-Rückruf ist unter pipewire-jack für Überläufe des eigenen Clients blind (01 §4.2, 10 Probe b:
0 Rückrufe bei 22 bzw. 44 Lücken; Quelle `pipewire-jack.c` Z. 2070 bis 2073); der Kern zählt Frame-Lücken und
ausgelassene Perioden selbst, und das Aufwach-Maß allein taugt nicht als Frühwarnung (10 NP K4).

---

## 8. Was gebaut und was integriert wird

### 8.1 Eigenbau (Aufwand in Session-Tagen: eine Session, ein Arbeitstag; Schätzung, nicht an bisherigem Durchsatz geeicht)

| Baustein | Vorlage aus dieser Nacht | Aufwand | Scheibe |
|---|---|---|---|
| **V0 Vertrag als Code** (vor K1 und L1, ein Eigentümer): Proben-Vorlagen und Ergebnisdateien ins Repo (ohne WAV, venv, vendor, Rohaufnahmen; Ausnahme für Beleg-Logs, weil die Wurzel-`.gitignore` `*.log` ausschließt), `djk/third_party/` (libebur128 Commit 67b33ab, nlohmann/json, toml++), `djk/vertrag/osc.json` mit erzeugten `osc_adressen.h`/`.ts`, JSON-Schemas, `baender.json`, Golden-Folgen, `/test/hand`, Ring-Attrappe | `proben/02-uhr-sync-planer/kern/uhrkern.cpp` (OSC), `absender.mjs`, `proben/09-ki-steuerung/nachpruefung/angriff.mjs` | 0,5 | 1 |
| Kern-Gerüst: JACK-Client, Uhr mit begrenzter Tempo-Karte, OSC ein und aus, Ringe, Quittungen, Zustand in `/dev/shm`, Telemetrie mit Lückenzähler, `sd_notify` | `proben/02-uhr-sync-planer/kern/uhrkern.cpp` (497 Zeilen), `proben/01-audio-kern/a-cpp-jack/klick_kern.cpp`, `proben/10-robustheit-betrieb/src/minikern.c` | 2 | 1 |
| Notbahn mit Blende, Obergrenze, Riegel; Units und `cypherdj.target` | `proben/10-robustheit-betrieb/src/notbahn.c`, `bus.h`, `absturz/` | 1 | 1 |
| Deck Direktweg: Band (Loop, Band-Roll, Sprung, Hotcue), Stem-Mix, Schuss-Spieler | `proben/03-deck-engine/deckprobe.cpp` | 2 | 1 |
| Lader, Arbeitsbestand, Kiste | `proben/10-robustheit-betrieb/nachpruefung/src/mlock_datei.c` | 1 | 3 |
| Kanalzug, Mixer, Cue, Mess-Abgriff, Messer, Hüllkurven-Ring, Limiter, Sends, Mischform-Echo | `proben/04-mixer-effekte/dsp/`, `harness.cpp`, `hybrid_delay.cpp`, `meter_probe.c` | 3 | 1 bis 2 |
| Stellwerk-RT in C++ mit Invarianten und Frist-Wächter | `proben/09-ki-steuerung/stellwerk.mjs`, `stellwerk.test.mjs`, `nachpruefung/angriff.mjs` | 2,5 | 2 |
| Controller: Mapping, Übernahme, LEDs, Tasten, Kiste-Browser | `proben/09-ki-steuerung/hand_latenz.c` | 1,5 | 3 |
| Deck Stretcher-Weg: Schatten-Stretcher (R3, Bungee hinter einer Schnittstelle) in Arbeits-Threads, Phasenregler, Blende, Datei-Tausch, Roll-Puffer | `deckprobe.cpp`, `proben/02-uhr-sync-planer/nachpruefung/src/rb_rampe.cpp` | 3 | 5 |
| Leitstand: WS, Annahme, Verriegelung, Hörschein-Register, Kopplung, Autonomie, Vorschlag, Zug-Takt, Kiste, Journal, **Kern-Attrappe** für paralleles Bauen | `stellwerk.mjs` (Nicht-Echtzeit-Teil), `proben/09-ki-steuerung/llm_warm.py` | 3 | 1 bis 2 |
| Spieler-Treiber, `cypherdj-mcp`, Ansage-Zeile | `proben/09-ki-steuerung/nachpruefung/stellwerk_mcp.py`, `llm_warm_x.py` | 1,5 | 1 bis 2 |
| Rechner: Passung, Kandidaten, Spielart-Regel „sicher“/„hart“, Vorhersage | `proben/08-analyse-passung/fa.py`, `probe_b_uebergang.py` | 2 | 2 |
| Analyse: Takt-Bericht, Versatz gegen Referenz, Deck gegen Deck, Hörschein | `proben/08-analyse-passung/probe_c_live.py`, `nachpruefung/kick_je_schlag.py` | 1,5 | 2 |
| Werkstatt-Kette bis `material_fertig`, Tore, Anschluss GPU-Maschine | `proben/07-werkstatt-zerleger/c_drift.py`, `b_timemap.py`, `b_strecken.py`, `fa.py` | 3,5 | 1, 4 |
| Zerleger-Rolle, Nachrender-Warteschlange | keine | 1,5 | 5, 6 |
| Aufnahme-Unit | `proben/01-audio-kern/a-cpp-jack/aufnehmer.cpp` | 0,5 | 4 |
| Chaos-Prüfstand: eigene Senke je Lauf, Aufnehmer am Ziel, Naht-Messer, Last (Speicher, HTDemucs, Werkstatt), Abschuss und Hänger, Dauerlauf, Bericht | `proben/10-robustheit-betrieb/src/`, `nachpruefung/src/sprung.c`, `demucs_last.py`, `proben/01-audio-kern/a-cpp-jack/analyse_klick.py` | 1,5 | 1 |
| Erzeuger-Unit Strudel, Spielzettel, Worker | `proben/06-erzeuger-muster/uhr/sender.mjs`, `spielzettel/zettel.mjs` | 1,5 | 7 |
| Klang-Wirt SunVox | `proben/06-erzeuger-muster/sv/sv_probe.c` | 1 | 7 |
| Plugin-Wirt Carla | `proben/05-plugins-instrumente/carla_host.py`, `sonde.c` | 1,5 | 8 |
| Link-Brücke, MIDI-Clock | `proben/02-uhr-sync-planer/link-probe/linkpeer.cpp`, `nachpruefung/src/linkfilter.cpp`, `kern/uhrkern.cpp` | 1,5 | 9 |
| **Summe** | | **rund 37** | |

Kritischer Weg bis zum ersten gemeinsamen Ton (Scheiben 0 bis 4, drei Sessions parallel): rund 16,5
Session-Tage (V0 liegt davor), gerechnet aus der Tabelle; Schätzung.

### 8.2 Fertig integriert

| Baustein | Rolle | Lizenz | Stand auf DJ-Maschine (heute geprüft) |
|---|---|---|---|
| PipeWire 1.6.8, pipewire-jack, Midi-Bridge | Graph, Treiber, Echtzeit-Threads, MIDI | MIT | läuft (10 §3a) |
| libjack (jackd2 1.9.21) | Client-API | LGPL-2.1+ | `pkg-config jack` 1.9.21 |
| Rubber Band 3.3.0 (Bibliothek und CLI) | Keylock live und offline, `--timemap` | GPL-2.0-or-later (Kern wird intern GPL, folgenlos) | `pkg-config rubberband` 3.3.0, `/usr/bin/rubberband` |
| Bungee 2.4.30 | zweite Live-Maschine | MPL-2.0 | von Hand gebaut unter `proben/03-deck-engine/vendor/bungee` (Commit 8cb6977; braucht CMake ≥ 3.30, lokal 3.28, 03 §3.1; per `.gitignore` nicht in git); in Scheibe 5 als gepinnter Klon mit Bau-Skript unter `djk/third_party/bungee/` |
| libebur128 | LUFS, Echtspitze | MIT | kein Entwicklungspaket; Quelle unter `proben/04-mixer-effekte/vendor/libebur128` (Commit 67b33ab, dort per `.gitignore` nicht in git), V0 kopiert sie nach `djk/third_party/`, einkompilieren |
| nlohmann/json, toml++ | JSON (`kiste.json`, Mapping, `fassung.json`) und TOML (`kern.toml`) im Kern | MIT, MIT | **fehlen** (`pkg-config` und `/usr/include` ohne Treffer, gemessen 2026-09-23); als gepinnte Einzel-Header nach `djk/third_party/` (V0). sd_notify und OSC schreibt der Kern selbst wie `minikern.c` und `uhrkern.cpp` (liblo, libsystemd-dev fehlen ebenfalls); Tests mit CTest und eigenem Assert-Header (gtest, catch2 fehlen) |
| Faust 2.70.3 | erzeugt C++ für Isolator, Filter, Hall, Limiter | Bibliotheken je Funktion (04 §3.2) | `faust --version` 2.70.3 |
| libsndfile 1.2.2, libsamplerate 0.2.2, FFTW 3.3.10, ALSA 1.2.11 | Werkzeuge, Prüfstand | LGPL, BSD, GPL, LGPL | `pkg-config` vorhanden |
| lilv 0.24.22 | LV2 im Wirt (später) | ISC | vorhanden |
| g++ 13.3, CMake 3.28.3, Ninja 1.11.1, Node 22.23.2, Python 3.12.3 | Bau | frei | vorhanden |
| systemd 255 (User-Manager) | Aufsicht, Watchdog, Limits | LGPL-2.1+ | vorhanden, `DefaultLimitRTPRIO=95`, `DefaultLimitMEMLOCK=4294967296` (10 §3a) |
| `ws` 8.21.3, `@modelcontextprotocol/sdk` 1.30.0 | Leitstand, MCP | MIT | npm (09 §3.9) |
| Claude Code CLI 2.1.280 | Spieler, Zerleger | proprietär | vorhanden |
| torch, demucs 4.0.1, beat_this 1.1.0, Essentia 2.1b6, NumPy, SciPy, scikit-learn | Werkstatt, Rechner, Analyse | BSD, MIT, MIT, AGPL-3.0 (nur Prüfmittel), BSD | venv `proben/07-werkstatt-zerleger/venv` hat nur torch 2.5.1+cpu (`torch.version.cuda` None), kein `websockets`, kein `pytest`; das System hat torch 2.10.0+cu128, websockets 16.0, pytest 8.4.2, aber weder demucs noch beat_this (gemessen 2026-09-23). W1 legt ein neues venv mit `--system-site-packages` an; Gewichte von beat_this und Demucs liegen noch nirgends (`~/.cache/torch` fehlt), der erste Lauf lädt sie aus dem Netz |
| ComfyUI mit MiniMax Music 3 auf der GPU-Maschine (`:8288`) | Generierung | Dienst | läuft laut Skill `cypher-musik`; hier nicht angefasst |
| später: Ableton Link SDK 4.0, `@strudel/core`/`mini` 1.2.6, SunVox-Bibliothek 2.1.4d, Carla 2.5.8, LSP, x42, Surge XT, Airwindows | Sync, Erzeuger, Klang, Plugins | GPL-2.0+, AGPL-3.0+, MIT, GPL, LGPL/GPL/MIT | geklont oder gebaut in den Probenordnern |

### 8.3 Ablage im Repo (Vorschlag für die Pläne)

Neuer Code liegt unter `~/cypher-dj/djk/` (das Repo-Hauptverzeichnis ist mit dem Browser-Stand belegt):
`djk/kern/` (C++, CMake), `djk/notbahn/`, `djk/aufnahme/`, `djk/leitstand/` (TS), `djk/mcp/`, `djk/spieler/`,
`djk/rechner/`, `djk/analyse/`, `djk/werkstatt/`, `djk/pruefstand/`, `djk/units/` (systemd-Units),
`djk/konfig/` (Standard-Konfiguration nach `SCHNITTSTELLEN.md` §2.1, Controller-Mappings), `djk/vertrag/`
(maschinenlesbare Teile von `SCHNITTSTELLEN.md`, nur V0 schreibt dort: `osc.json`, erzeugte `osc_adressen.h`/`.ts`,
JSON-Schemas, `baender.json`, Golden-Folgen, Attrappen), `djk/third_party/` (gepinnte Fremdquellen mit Herkunft).
Bestand unter `~/cypher-dj/bestand/` und Set-Journale unter `~/cypher-dj/sets/djk/` (beide nicht versioniert).

---

## 9. Messliste, Scheiben, Streichliste

### 9.1 Messliste (IDs sind verbindlich; ADRs und Pläne verweisen darauf)

| Nr | Messung | Aufbau, Kontrolle | Kippt | Braucht |
|---|---|---|---|---|
| M1 | **Interface** als Treiber: Lücken bei 128 und 256 (je 60 min, mit und ohne Werkstatt), Gang Samples gegen Systemuhr, HostTimeFilter unter USB-Jitter, Griff bis Ton (Loopback-Kabel), Master gegen Cue | Xrun-Messer (`proben/10`), JACK-Aufnehmer; Fehlerfall künstliche Callback-Last (10 K1b), Negativ-Kontrolle Ruhe | Quantum, Blende, Kernel-Reserve | Gerät, Andreas' Ja |
| M2 | **Notbahn-Naht online** mit echter Musik: ohne Blende, 1 Block Blende; M2b: Notbahn parallel am Treiber (liefert ein hängender Kern Stille oder alte Blöcke?) | Naht-Messer `nachpruefung/src/sprung.c` plus Hochton-Maß aus 10 NP N2; Fehlerfall harte Naht, Negativ-Kontrolle Ruhelauf 0 Sprünge | Blende ja/nein, 1 oder 2 Blöcke | stumm |
| M3 | **Deck-Echtzeit:** R3 in Arbeits-Threads als JACK-Client **im Pull-Modus mit fester Ausgabemenge je Block** (Deck-Semantik; der Druck-Modus aus 01 §4.5 zählt nicht, 01 NP K1), 1, 2 und 4 R3 je Thread im Vergleich, R3 kurz als Option, 30 min, Vorlauf 2/4/8 Blöcke, 4 Decks, unter Speicher- und HTDemucs-Last, eigene Null-Senke; dazu der Start nach 01 NP K3 (Anlegen und ein Pull-Zyklus mit `retrieve` im Lade-Faden) **im Callback** nachgemessen und die Kosten der sechs Analyse-Bänder je Kanal | Unterlaufzähler, Frame-Lücken, Füllstand, erster Block nach Start; Fehlerfall R3 direkt im Callback (03 §4e: 16 Blöcke über Budget) und 8 R3 in einem Thread (01 NP N4: 377 Überläufe in 60 s), Negativ-Kontrolle 0 R3 | Vorlauf-Größe, Stretcher je Thread, Stretcher-Budget, R3 kurz, Wechsel zu Bungee | stumm |
| M4 | **Tempo-Rampen und kleine Faktorwechsel nativ** mit Phasenregler: Tonhöhe (Tonscan) und Phase während und nach 128 → 132; **Encoder-Folge in 0,01-BPM-Rasten** (als Rampen über 1 Beat und, als Fehlerfall, als Sprünge), **ppm-Nachstellung des Phasenreglers**, jeweils **Null-Samples am Ziel gezählt**; nativer Einzelknoten mit 50 ms Vorhalt gegen Doppelknoten auf Tonhöhe; Bungee-Tonscan der harmonischen Basstöne und Ohr-Werkzeug | `02 nachpruefung/src/rb_rampe.cpp`, Werkzeuge aus `tests/stretch-bench`; Positiv-Kontrolle ohne Engine −79,31 ct; Fehlerfall Faktorsprung ohne Vorhalt (ERGEBNIS §2.6: 128 Null-Samples); Negativ-Kontrolle konstanter Faktor | Regler-Auslegung, Rampen-Mindestdauer, Hand-Rampe, Einzel- oder Doppelknoten, R3 gegen Bungee | stumm |
| M5 | **Hörweg-Wechsel:** Blende direkt ↔ Schatten-Stretcher und Datei-Tausch nach dem Nachrendern (Knack, Lage, Kammfilter) | Knack-Metrik aus 04, Lage per Kick-Einsatz (03 §4a Verfahren); Negativ-Kontrolle ohne Wechsel | Direktweg-Konzept (Rückfall: R3 immer im Hörweg) | stumm |
| M6 | **Roll hinter dem Keylock** gegen Band-Roll: Raster-Treue in der Rampe, Rückkehr deckungsgleich | Vergleich mit 03 §4d | Roll-Art | stumm |
| M7 | **Wirt-Entkopplung** per `node.async`: Absturz, Brücken-Hänger, Hänger im Prozess; was ein toter Rückweg liefert; erkennt der Puls es; klärt 05 §4.5 gegen 10 NP N3 | Aufbau 05 Probe 4.5 mit `PIPEWIRE_PROPS='{ node.async = true }'` | ob Plugins und SunVox in den Mix dürfen | stumm |
| M8 | **Laden im Spiel:** 3 GiB einblenden und sperren, Seitenfehler im Callback, 4-GiB-Grenze mit Entladen | Lader im Kern, Lückenzählung | Arbeitsbestand-Größe | stumm |
| M9 | **GPU im Set:** Grafikspeicher der **echten** Kette (PyTorch-Demucs 4.0.1 mit echten Gewichten; Recherche nennt rund 7 GB, undatiert) und Demucs-Job auf der DJ-Maschine-GPU neben dem Kern bei 256, **Start und Ende** (Speichertakt-Wechsel, 10 NP K6); die bisherige Zahl „Training störte nicht“ entstand bei ruhendem Training (10 NP: 7 % statt 96 %) | Xrun-Messer, `nvidia-smi` je Sekunde; Fehlerfall Job-Start unter Last, Negativ-Kontrolle GPU ruhig | ob Stem-Jobs im Set auf der GPU erlaubt sind | freie GPU, Andreas' Antwort Frage 4 |
| M10 | **Ruhige Maschine:** alle Echtzeit-Zahlen dieser Nacht ohne Fremdlast wiederholen | Stapel-Skripte der Probenordner | Größe aller Reserven | Ruhe |
| M11 | **Watchdog-Politik:** Absturz-Schleife mit `RestartSteps`; falscher Watchdog-Tod, wenn ein Rückweg hängt | absichtlich defekter Kern | Watchdog-Zeit, Meldung „Kern hängt“ gegen „Kern wartet“ (10 NP K5) | stumm |
| M12 | **Link-Brücke** gegen Link im Kern | Vorlage `linkfilter.cpp` | wo Link sitzt | später |
| M13 | **Raster und Takt-Eins der MiniMax-Songs:** beat_this und Essentia auf allen Songs aus `c_drift.log` (auch `sofa-abend`), Rest nach Timemap am Ausgang **mit einem unabhängigen Instrument** (Tief-Band-Anschläge aus `fa.py`; zusätzlich ein Klick nach dem Warp gegen das starre Raster), **Downbeat-Treffer** (beat_this gegen zweites Verfahren und gegen eine Takt-Eins von Hand) | Fehlerfall ohne Timemap, Negativ-Kontrolle mfbass (3,3 ms/min), Positiv-Kontrolle synthetische Drift (`b_timemap`: 0,19 ms RMS, nur Mechanik), **neue** Kontrolle starres Raster mit schwachem Puls | Warp-auf-Raster-Idee, Tor-Schwellen `raster`, `klarheit`, `eins` | offline |
| M14 | **Generierung Ende zu Ende:** `erzeuge` bis `material_fertig`, GPU-Maschine frei und belegt, Kern-Telemetrie bei 256 dabei; **BPM-Treue** von MiniMax gegen das Ziel-BPM im Prompt (exakt und als Bereich) | Zeitstempel je Schritt; BPM aus beat_this gegen Prompt | Vorlauf der Kiste, Prompt-Form, Tor `streckfaktor` | GPU-Maschine (geteilt) |
| M15 | **Wahl als Werkzeugaufruf** und Set-Simulation ohne Ton: zuerst 30 min (120 Züge), dann hochrechnen; Kontext **≥ 100 000 Token** (wie spät im Set), dazu Zug plus Reparaturzug nach `verriegelt` | p50, p95, max bis Werkzeugaufruf, Formfehler, Kontextgröße, Kosten; Kipp-Kriterium: p95(Zug) + p95(Reparaturzug) ≤ 4 Takte (Antwortfrist des Vertrags); Fehlerfall Netz trennen, Rückfall muss greifen | Zug-Takt, Antwortfrist, Kosten | Kontingent |
| M16 | **Stretcher auf der Stem-Summe** gegen je Stem: Klang und Wirkzeit von Stem-Stumm | Ohr-Werkzeug, Tonscan | Stem-Deck-Form | stumm, dann Ohr |
| M17 | **Controller am Gerät:** Zittern, Anfangsstellung, USB-Latenz, LED-Rückweg, MIDI oder HID | Software-Sender als Vergleich (09 Probe c) | Mapping, Totzone | Gerät |
| M18 | **Hörtermin** (Ton, mit Andreas' Ja): R3 gegen Bungee, Faustregel gegen Optimierer (`proben/08-analyse-passung/out/uebergang/sicher_saat.wav` gegen `sicher_optimiert.wav`), Notbahn-Schleife und Naht, Hörschein-Schwellen, Latenzgefühl | A/B, paarweise | Klangentscheidungen | Andreas |
| M19 | **Keylock bei großen Streckfaktoren und Stimmungskorrektur:** Tonscan und Ohr-Werkzeug der Werkbank bei Faktoren 0,7, 0,8, 1,2, 1,4 an echten MiniMax-Songs (offline, R3 mit Timemap), dazu die Stimmungskorrektur ±10/±35 Cent am Tonscan | Werkzeuge aus `tests/stretch-bench`; Positiv-Kontrolle Resample ohne Keylock; Negativ-Kontrolle Faktor 1,0 | Tor `streckfaktor`, Stimmungsangleich automatisch oder nur Vorschlag | offline, stumm |
| M20 | **Faustregel gegen die Vertragsgrenzen nachrechnen:** Regel §14.4 (Vertrag) mit `probe_b_robust.py` am Paar Message/MFB und an zwei MiniMax-Paaren, Varianten „A-Tief früher senken“ und „Kill statt EQ“ | alle sechs Bänder, mit und ohne Keylock; Negativ-Kontrolle die gemessene Faustregel (Tief 0,402 muss wiederkommen) | ob `grenze_tief` verriegeln darf, Tief-Grenzen neu setzen | offline |

### 9.2 Scheiben (die ROADMAP macht daraus Pläne; Begründung ADR 021)

| Scheibe | Inhalt | Abnahme (je mit Fehlerfall und Negativ-Kontrolle, am Ziel) |
|---|---|---|
| **0 Vorbedingungen** (parallel, stumm) | M3, M13, M15 (30 min), M19, M20, M2 offline und online, M10 wenn ruhig, M14 wenn die GPU-Maschine frei ist; M1 sobald Gerät und Ja da sind | Messberichte mit Zahl und Kippentscheidung |
| **1 V0, dann drei Werkstücke parallel** | **V0** (ein Eigentümer, rund ein halber Tag): Vorlagen ins Repo, `djk/third_party/`, `djk/vertrag/` (`osc.json`, erzeugte Header, Schemas, `baender.json`, Golden-Folgen, `/test/hand`, Ring-Attrappe; `SCHNITTSTELLEN.md` §19.0) · **K1** Kern-Gerüst, Uhr, Befehle, Zustand, Notbahn mit Blende und Taktfeldern, zwei Decks im Direktweg, Kanalzug mit Fader/Trim/LR8/Kill als Zuweisungstabelle, Units, Chaos-Prüfstand v1 · **L1** Leitstand, `cypherdj-mcp`, Spieler-Treiber, Ansage-Zeile gegen eine **Kern-Attrappe**, die den Vertrag spricht · **W1** Werkstatt-Kette v1 auf vorhandenen Songs **ohne Stems** (Tempo-Karte, Takt-Eins, Timemap, Headroom, Fingerabdruck, Kreuzenergien, Tore, Fassungen, `material_fertig`) | **V0:** `osc.json` gegen den Vertragstext grün, jede Golden-Folge liegt als Datei vor. **K1:** 20 × `kill -9`, 10 Hänger, 0 ms Stille, Raster ≤ 1 Sample, Naht gemessen; Golden-Folgen grün; **Lastprofil P1** als Skript im Prüfstand (Speicher-Streaming `lastgen` 16 × 64 MiB plus `demucs_last.py` mit 8 Fäden, Nice 19), 60 min bei Quantum 256: höchstens 1 Frame-Lücke, bei genau 1 Lücke ein zweiter Lauf mit 0; Fremdlast (`uptime`, `nvidia-smi`) vor und nach jedem Lauf im Bericht, Lauf über die Wellen-Koordination angemeldet; liegt die Fremdlast (1-Minuten-Mittel) über 4, gilt der Lauf als vorläufig und kommt in M10 wieder (eine Null in 675 000 Zyklen ist allein keine Aussage, 10 NP K2) · **L1:** alle Golden-Folgen gegen die Attrappe grün; `kill -9` auf den Leitstand mitten in `teil_rampe`: die Attrappe fährt zu Ende, der neue Leitstand übernimmt über `/q/stand` den Stand; Spieler: Aufwärmzug unter 30 s, `lage` als Werkzeugaufruf 5 von 5 formgültig; `cypherdj-mcp`: jedes Werkzeug aus §10 einmal formgültig und einmal mit Formfehler (`form`) · **W1:** Kette auf den Kontrollen aus `c_drift.log` (NULL `konst134` Rest nahe 0, POSITIV `drift_synth`, REFERENZ `mfbass`) und allen MiniMax-Songs; Tore mit dem unabhängigen Anschlag-Instrument, Ergebnis je Tor im Bericht; `material.json` und `fassung.json` schema-gültig; eine Korrektur erzeugt `r2` neben `r1`, `r1` bleibt bytegleich |
| **2 Cypher wählt, der Code rechnet, stumm** | Stellwerk-RT mit Invarianten (I3 mit Inhalt und Abschnitt) und Frist-Wächter, Rechner („sicher“, „hart“ nach der Regel §14.4 im Vertrag), Analyse mit Hörschein und Erneuerung je Takt, `waehle` mit Einstieg, Kopplung, Zug-Takt; Messer, Mess-Abgriff, Hüllkurven-Ring mit sechs Bändern | Fälle 09 NP K1 (0 Takte Sub doppelt), K2 (Master nie leer), K3 (kein Sprung), K4 (Totzone), K5 (Überlappung abgelehnt); Spieler schweigt: Rückfall statt Stille; Vorhersage gegen Kern-Ausgang ≤ 0,04 Überdeckung, ≤ 0,41 LU (08 NP K2) |
| **3 Hand und Ohr** | Controller mit Mapping, Übernahme, LEDs, Tasten, Kiste-Browser; Lader im Spiel; Interface mit Cue 3/4 (M1); Andreas spielt zwei Decks allein; **Hörtermin M18** | M1, M8, M17; Griff bis Ton gemessen; Laden von 3 GiB ohne Lücke |
| **4 Erster gemeinsamer Ton** (128 fest, Direktweg) | Autonomie Stufe 1 mit Vorschlag, „Cypher hören“, Annehmen, Verwerfen, Stopp, Urteil; Journal, Aufnahme; ein bei Set-Beginn bestellter MiniMax-Song kommt während des Sets durch die Werkstatt in die Kiste und wird eingebunden | Andreas spielt A, Cypher schlägt B vor, Andreas nimmt an und greift ein; `kill -9` auf Leitstand, Spieler und Kern mitten im Übergang; 30 min Dauerlauf am Interface mit laufender Werkstatt |
| **5 Tempo und Keylock live** | Schatten-Stretcher (R3, Bungee), Rampen, Phasenregler, Hand-Tempo, Nachrendern mit Datei-Tausch, Roll-Puffer | M4, M5, M6, M16 |
| **6 Werkstatt im Set** | Zerleger-Sitzung (A13), Warteschlange mit Vorrang, Stems auf GPU im Set, Tap-Raster und Nudge als Korrektur je Abschnitt | M9, M14 unter Set-Last |
| **7 Eigene Spur** | Erzeuger Strudel, Spielzettel, Klang-Wirt SunVox, Autonomie Stufe 2 | M7 für den Klang-Wirt |
| **8 Plugins** | Plugin-Wirt Carla, ausfallsicherer Insert | M7 |
| **9 Außenwelt, Oberfläche, Lernen** | Link-Brücke, MIDI-Clock, Oberfläche, Lernmodell zwischen den Sets | M12 |

### 9.3 Streichliste (was fällt zuerst, wenn eine Scheibe überläuft)

- Scheibe 1: Chaos-Prüfstand zuerst nur `kill -9` und SIGSTOP, Hänger im Callback später; W1 ohne Stems (Vorgabe,
  nicht erst beim Überlauf); Busse und `fx/3`/`fx/4` leer (die Zuweisungstabelle nicht).
- Scheibe 2: Rechner liefert einen statt drei Kandidaten; nur Spielart „sicher“. **Nicht streichbar:**
  Deck-gegen-Deck im Hörschein (für generiertes Material Pflicht), weil der Versatz gegen die Referenz ein falsches
  Raster nicht sieht (08 NP K4); ohne ihn wäre die Hörschein-Pflicht für MiniMax-Songs eine Hülle.
- Scheibe 3: Split-Kopfhörer statt Cue 3/4, wenn das Interface nur zwei Ausgänge hat; LEDs nur für Halter und
  Vorschlag.
- Scheibe 4: der Song wird vor dem Set bestellt statt im Set (dann ist A2 nur „vorab“ getragen, im Journal
  vermerkt); Urteils-Tasten später.
- Nie gestrichen: Invarianten I1 bis I3 (mit Inhalt, Abschnitt und Deck-gegen-Deck), Frist-Wächter, Hörschein-Pflicht,
  Stopp-Taste, Notbahn, Riegel gegen ungefragten Ton.

---

## 10. Abbildung A1 bis A26

| A | Anforderung (kurz) | Getragen von | Stand |
|---|---|---|---|
| A1 | gemeinsam live spielen | Stellwerk-RT (Hand zuerst, Halter), Leitstand, Spieler (Wahl, Vorschlag), Autonomie-Stufen, Stopp, Controller, Journal; ADR 013, 014, 023 | Muster gemessen (09 Probe b, c), Kern-Fassung zu bauen (Scheibe 2 bis 4) |
| A2 | Songs parallel generieren, im Set zerlegen und einbinden | Generierung auf der GPU-Maschine, Werkstatt, Bestand, Kiste, Lader ohne Neustart; ADR 011, 022 | **teilweise:** „während des Sets“ heißt mit rund 15 bis 30 min Vorlauf (Generierung 14 bis 22 min Rechnen plus 1 bis 1,5 min Laden auf der GPU-Maschine, Betriebswert; Werkstatt 1 bis 5 min, gerechnet); Ende zu Ende ungemessen (M14); Scheibe 4 |
| A3 | erst die Technik sauber | Scheibe 0, Messliste, Chaos-Prüfstand als Abnahme; ADR 016, 021 | Werkzeuge gemessen (01, 10) |
| A4 | nichts ungeprüft auf den Master | Mess-Abgriff und Hörschein (Sync, Deck gegen Deck, Pegel gegen das laufende Deck) mit Inhalt, Abschnitt und Erneuerung je Takt, Cue 3/4, Invariante I3 für **neuen Inhalt** (Öffnen hinter Crossfader und Bus, Schuss, Muster, Cyphers Sprung), Autonomie-Positivliste, Kanäle neuer Quellen starten bei −200 dB; ADR 008, 013, 023 | Messer gemessen (04 §4.7, 08 Probe 4c); Schwellen ungemessen (M18); Cue am Gerät ungemessen (M1); I3 in der neuen Form Entwurf (Golden-Folgen `i3_gruende`, `crossfader_luecke`) |
| A5 | EQ je Deck zum Tauschen | LR8-Isolator mit Kill und Rampen zweiter Ordnung, Bass-Tausch-Taste; ADR 008 | gemessen offline (04 §4.1: Mitten-Kill 74,6 dB; §4.2) |
| A6 | Einfahren mit gleichzeitigem Rausdrehen | Rampen in Beats, Spielart-Regel, Kopplung durch den Leitstand; ADR 012, 023 | gemessen (08 Probe 4b, 09 Probe b) |
| A7 | Spielarten nach Zeitdruck | Spielart als Parametersatz, Frist aus der Uhr, Längen-Encoder, Zug-Anfrage relativ zur Frist, Frist-Wächter; ADR 012, 013 | „sicher“, „hart“ gemessen; Rückfall ungemessen |
| A8 | Genre-Einordnung | Spielart-Tabelle je Genre als Startwerte; ADR 012 | **offen:** Genre-Werte sind Vermutung (08 §3.3.4), „pumpen“ ist technisch nicht entschieden (Vorgabe 0 dB bis Andreas es erklärt) |
| A9 | Basis 128, live aufs Set-Tempo | Tempo-Karte, Schatten-Stretcher, Phasenregler; ADR 004, 006, 020 | Uhr gemessen (02); Deck in Echtzeit ungemessen (M3, M4); **Scheibe 5**, bis dahin feste 128 |
| A10 | Keylock für alles | Basis-Dateien, Stems und Einzelschüsse offline mit R3; live R3 bei Abweichung; Halb-/Doppeltempo-Wahl und Tor `streckfaktor`; ADR 006 | **gemessen offline nur für Faktoren bis rund 5 % neben 1** (03 §4c: 0,95522 und 1,04121; 07 `b_strecken`: 134/128; ERGEBNIS §1: 128/134; 08 §4.e bis +28 % nur Band und Crest, keine Tonhöhe); **darüber ungemessen** (M19), MiniMax-Songs brauchen 0,71 bis 1,42 |
| A11 | Effekte beatsync | Mischform-Echo aus der Uhr, Echo-Aus, Beat-Repeat (Roll-Puffer), Hall; ADR 008 | Echo gemessen (04 §4.3 bis 4.5), Beat-Repeat und LFO ungemessen |
| A12 | einmal offline auf die Basis, live nur die Abweichung, Nachrendern | Direktweg, Schatten-Stretcher, Nachrendern mit Vorrang 1, Datei-Tausch; ADR 020 | Direktweg ist Konstruktion; Wechsel ungemessen (M5); Nachrenderzeit gerechnet |
| A13 | Zerlegen im Set als Sonnet-Rolle (Stems, Loops, Einzelschüsse, Tempo, **Takt-Eins**, Tonart, **Text**), Nachladen ohne Neustart | Werkstatt-Kette mit Takt-Eins (`erste_eins_quell_beat`, Tor `eins`, Handkorrektur Umschalt plus Tap), Text aus dem Prompt, Zerleger-Sitzung, `material_fertig`, Fassungen, Lader per `mmap`; ADR 011, 015 | Lader gemessen (10 NP N8); Takt-Eins ungemessen (M13); Text nur aus dem Prompt, nicht erkannt; Rolle ungemessen (Scheibe 6; bis dahin rechnet die Kette ohne Sonnet) |
| A14 | Loop, Roll, Beatjump, Hotcues quantisiert | Deck-Band nach Mixxx-Muster, Befehle mit Ziel-Beat, Hand-Quantize, Roll-Puffer, Halter für diskrete Griffe; ADR 007 | offline gemessen (03 §4d); Handlatenz auf dem Stretcher-Weg rund 125 ms gerechnet |
| A15 | Live-Analyse je Takt | Messer im Kern, Analyse-Unit, Takt-Zustand; ADR 012 | gemessen offline (08 Probe 4c) |
| A16 | Fingerabdruck, Passung, Plan, Lernen am Urteil | `fa.py`, Rechner, Spielart-Regel, Journal, Urteil-Tasten, A/B nach dem Set, Lernen durch Zusehen; ADR 012, 013 | gemessen offline (08); Lernen simuliert (08 NP K6: optimistische Schranke) |
| A17 | modularer Kern mit viel Routing (Busse, Sends) | Mixer als Zuweisungstabelle: jeder Kanal auf Master oder einen von vier Gruppenbussen mit vollem Kanalzug, vier Sends auf `fx/1` bis `fx/4`, Rückwege der Wirte `node.async`; frei verschaltbare Inserts ab Scheibe 8; ADR 008, 009, `SCHNITTSTELLEN.md` §1.5 | Entwurf; ob Andreas mehr will (Matrix, Subgruppen), ist Frage 5 in §13 |
| A18 | Plugins | Plugin-Wirt (Carla) mit Rückweg `node.async`; ADR 009 | teils gemessen (05); Entkopplung M7; Scheibe 8 |
| A19 | GPU, wo sie hilft | Stems in der Werkstatt (DJ-Maschine, erst nach Frage 4 und M9), Generierung (GPU-Maschine), nie im Block-Takt; ADR 011, 022 | **nur unter Dauerlast gemessen:** Training störte die CPU-Kette nicht (10 Probe b R1, 96 %; in der Nachprüfung ruhte das Training, 7 %); Start und Ende eines GPU-Jobs, also genau ein Stem-Job, und der Grafikspeicher der echten Kette ungemessen (M9, 10 NP K6) |
| A20 | alles taktgleich | eine Uhr, Beats, Phasenregler, Latenzvorhalt je Pfad; ADR 004, 005 | gemessen (02) bis auf Deck-Regler (M4) und Interface (M1) |
| A21 | Instrumente und Erzeuger gleichrangig | Erzeuger-Kanäle mit vollem Kanalzug im Kern, Beat-Stempel, Klang-Wirt; ADR 010 | gemessen (06); Scheibe 7 |
| A22 | Strudel für Muster zu Ereignissen | Erzeuger-Unit mit `queryArc`; ADR 017 | gemessen (06 Probe a) |
| A23 | Eigenbau erlaubt, Freies vorziehen | C++-Kern aus freien Bibliotheken, §8.2; ADR 002 | Entscheidung, Callback gemessen (01) |
| A24 | Oberfläche nachrangig | LEDs, Ansage-Zeile, Spielzettel als Text; Oberfläche später als eigener Prozess; ADR 019 | Entscheidung |
| A25 | weg vom Browser | Dienstbündel ohne Browser im Audiopfad; ADR 001, 018 | gemessen (01 Probe b3: 669 Aussetzer in 60 s mit leerem Worklet, 0 ohne; in der Nachprüfung 1 539, lastabhängig, qualitativ bestätigt, 01 NP) |
| A26 | Hardware fürs Vorhören, NI-Interface, Renoise | Frage 1 in §13; Renoise nein (06 §3.1); ADR 003 | **offen:** Gerät unbekannt, M1 steht aus |

---

## 11. ADR-Verzeichnis

| Nr | Datei | Entscheidung in einem Satz | Status |
|---|---|---|---|
| 001 | `adr/001-prozessform-app.md` | Echtzeit-Kern plus Satelliten als systemd-User-Units; „die App“ ist dieser Verbund | angenommen |
| 002 | `adr/002-kern-sprache.md` | C++20, Notbahn in C, Echtzeit-Disziplin durch Mechanik | angenommen |
| 003 | `adr/003-audio-anschluss.md` | JACK-API unter pw-jack, Quantum 256 als Standard, ein Interface nur für die DJ-Knoten | vorläufig, M1 steht aus |
| 004 | `adr/004-uhr-und-link.md` | Sample-Zähler plus Tempo-Karte im Kern, innen stetig, außen neu verankert, Link als Brücke später | angenommen (Link: vorläufig, M12) |
| 005 | `adr/005-zeitbasis-beats.md` | Beats als f64 auf der Kern-Uhr, Verspätung je Befehlsart | angenommen |
| 006 | `adr/006-keylock-engine.md` | Rubber Band R3 offline und live (höchstens 2 je Arbeits-Thread, Start mit Durchziehen), Bungee zweite Wahl, Doppelknoten zurückgestellt, nie R2/SoundTouch/Signalsmith | vorläufig, M3/M4/M18/M19 stehen aus |
| 007 | `adr/007-deck-grammatik.md` | Eigenbau nach Mixxx-Muster mit Ziel-Beat je Befehl, Hand-Quantize je Hörweg | angenommen |
| 008 | `adr/008-mixer-und-vorhoeren.md` | Mixer im Kern, LR8, Cue 3/4, Mess-Abgriff getrennt vom Cue, Aufnahme an der Notbahn | angenommen (Cue am Gerät: vorläufig, M1) |
| 009 | `adr/009-plugins-ausserhalb.md` | kein `dlopen` im Kern; Plugins im Wirt mit Rückweg `node.async` | vorläufig, M7 steht aus |
| 010 | `adr/010-erzeuger.md` | Strudel als eigene Unit, SunVox im Klang-Wirt, Erzeuger-Kanäle gleichrangig im Kern | vorläufig, M7 steht aus |
| 011 | `adr/011-werkstatt-und-nachladen.md` | Werkstatt-Kette mit Toren und Vorrang-Warteschlange, Nachladen per `mmap` ohne Neustart | vorläufig, M13/M14 stehen aus |
| 012 | `adr/012-fingerabdruck-und-passung.md` | Fingerabdruck in Beat-Zeit, Passung als Rechnung, Spielart als Regel, Optimierer erst nach A/B | angenommen |
| 013 | `adr/013-ki-schicht.md` | Wahl statt Plan, warme Sonnet-Sitzung, Zug-Takt, Autonomie-Stufen, Stopp | vorläufig, M15 steht aus |
| 014 | `adr/014-controller.md` | USB-MIDI direkt in den Kern, Mapping als Datei, Übernahme skaliert/relativ | vorläufig, M17 steht aus |
| 015 | `adr/015-bestandsformat.md` | Ordner nach Inhalts-Hash mit unveränderlichen Fassungen je Render, `korrekturen.jsonl` als einzige anhängbare Datei, rohes Float32, Arbeitsbestand und Kiste in `/dev/shm` | angenommen (Fassungen vor W1 verbindlich) |
| 016 | `adr/016-robustheit-notbahn.md` | Units mit Watchdog, Notbahn über Shared Memory mit Blende, Chaos-Prüfstand als Abnahme | vorläufig, M2/M11 stehen aus |
| 017 | `adr/017-strudel-rolle.md` | Strudel nur als Funktion Muster zu Ereignissen | angenommen |
| 018 | `adr/018-browser-abschied.md` | Browser verlässt den Audiopfad; Dirigent-Seite ist Übergang | angenommen |
| 019 | `adr/019-oberflaeche-spaeter.md` | Oberfläche später als nur lesender Prozess; bis dahin LEDs und Ansage-Zeile | angenommen |
| 020 | `adr/020-hoerwege-im-deck.md` | kein Stretcher im Hörweg bei Faktor 1, ein warmer Schatten-Stretcher, Nachrendern | vorläufig, M5 steht aus |
| 021 | `adr/021-grundlage-und-scheiben.md` | KI-Entwurf als Grundlage; Messungen und Hörtermin vor den teuren Scheiben; gemeinsamer Ton bei festen 128 zuerst | angenommen |
| 022 | `adr/022-generierung-mit-vorlauf.md` | Generierung auf der GPU-Maschine mit Minuten Vorlauf, Kiste als Warteschlange | vorläufig, M14 steht aus |
| 023 | `adr/023-stellwerk-und-invarianten.md` | Annahme im Leitstand, Ausführung, Invarianten I1 bis I4 (I3: neuer Inhalt nur mit Hörschein; hörbar nur, wenn das Deck läuft) und Frist-Wächter im Kern | angenommen |
| 024 | `adr/024-kit-im-kern.md` | `/erz/strom` bekommt die Zielform `kit:<name>`: der Kern spielt `klang[note]` eines Kits (Einzelschüsse) sample-genau in den Eingang eines Erzeuger-Kanals, ohne Rückweg | angenommen |
| 025 | `adr/025-loop-boxen.md` | Zwei Loop-Boxen im Kern auf `pad/1` und `pad/2`: ein Loop ist N Takte bei 128 BPM, phasenstarr zur Kern-Uhr, Start und Stopp auf der nächsten Takt-Eins, Beat-FX in der Box | angenommen |
| 026 | `adr/026-loops-folgen-der-uhr.md` | Loops bleiben bei 128 BPM gespeichert und folgen der Kern-Uhr per Varispeed (Catmull-Rom), REC nimmt in jedem festen Tempo auf, das Tempo stellt Andreas an der Seite | angenommen |
| 027 | `adr/027-keylock-fuer-loop-boxen.md` | Keylock für Loop-Boxen: eine Variante je Box im Ruhetempo vorab mit R3 offline im Netz-Prozess gerendert, Direktweg bei 128 vorrangig, REC bei ≠ 128 mit R3 statt Resampling | umgesetzt im Branch `keylock`, Hörprobe steht aus |
| 028 | `adr/028-decks-folgen-dem-tempo.md` | Decks folgen dem Live-Tempo: Varispeed sofort (Lesekopf aus dem Master-Beat), die Tonhöhe über Fassungstausch | Varispeed angenommen; Fassungstausch (Entscheidung 4) abgelöst durch ADR 029 |
| 029 | `adr/029-keylock-echtzeit.md` | Ein Keylock-Knopf für alle Quellen: R3 in Arbeits-Threads mit Vorlauf-Ring (Dehner), Render-und-Tausch ausgebaut | umgesetzt für Decks und Loop auf dem Deck (Code auf main, Stand 2026-10-08), Loop-Boxen kommen mit Task 7, Hörprobe steht aus, Betriebs-Kern laut ADR unverändert |

---

## 12. Widersprüche und wie sie entschieden sind

| Punkt | Seite 1 | Seite 2 | Entscheidung | Beleg, ADR |
|---|---|---|---|---|
| Grundlage der Synthese | Richter 1: KI; Richter 2: Spiel; Richter 3: Robust | | KI als Grundlage; die Übernahmelisten aller drei Richter sind deckungsgleich (Kern und Betrieb aus Robust, Deck und Hand aus Spiel) | gewichtete Summen aller drei Richter; ADR 021 |
| Reihenfolge der Scheiben | KI: ganze KI-Schleife stumm zuerst | Spiel: Andreas' Hände zuerst; Robust: Robustheit zuerst | Scheibe 0 Messungen, dann drei Werkstücke parallel, Hand und Hörtermin vor dem gemeinsamen Ton, gemeinsamer Ton bei festen 128 vor Keylock live | Richter-Schwächenlisten; ADR 021 |
| Stretcher bei Faktor 1 | Robust: R3 immer im Hörweg | Spiel: Direktweg ohne Stretcher | Direktweg, ein warmer Schatten-Stretcher | 03 §4c (R3 bei 1,0: Artefakte −63,7 dB), ERGEBNIS §2.5 (Vorecho +4,5/+7,5 dB, Kick-Anstieg 9,07 statt 3,09 ms, offline am WASM-Weg), A12 wörtlich; ADR 020 |
| Quantum | Spiel: 128 als Spielziel | Robust, KI: 256 | 256 als Standard, 128 nach M1 | 10 NP N6 (55 % gegen 15 %), NP K2; ADR 003 |
| Notbahn | Robust, KI: Blende, zwei Blöcke | Spiel: `node.async`, parallel als Hypothese | Shared-Memory-Ring mit Blende; ohne Blende und parallel werden in M2/M2b gemessen | 10 NP N1/N2, Probe c; ADR 016 |
| Uhr nach Aussetzer | Spiel, 01 §4.2: Lücken aus der Frame-Zeit nachrücken | Robust, 02 NP: innen stetig, außen neu verankern | innen stetig, außen neu verankert | 02 Probe b (Frame-Zeit springt), NP N6; ADR 004 |
| SunVox, Link, CLAP/LV2 im Kern | 06 §1, 05 §1, KI, Spiel: im Kern | Robust, 01 §6.1: kein Fremdcode im Kern | kein `dlopen` im Kern; SunVox im Klang-Wirt, Link als Brücke, Plugins im Wirt; statisch einkompilierter, geprüfter Quelltext (Faust, Airwindows unter MIT) gilt als eigener Code | 05 §4.5 (Hänger im Prozess > 6 s ohne Zyklus), 10 NP N9; ADR 009, 010, 004 |
| Fremdcode nur parallel auf Sends | 10 §5 | 10 NP K5, A18/A21 | Rückwege in den Mixer, entkoppelt per `node.async` mit Puls | 10 NP N9, K5; ADR 009 |
| Wer schreibt Übergangspläne | 09: das LLM schreibt Planteile | 06: Übergang als Befehl; 09 NP K7 | Cypher wählt, der Rechner plant | 09 NP K1, K7, K9; ADR 013 |
| Planer | 08: Optimierer | 08 NP K1: Faustregel | Spielart als Regel, Vorhersage prüft; Optimierer nach A/B | 08 NP K1, K2; ADR 012 |
| Zu spät | 02, 09 Leitsatz 5: verwerfen; 03 §3.4: nächster Rasterschritt | 02 NP K11 | je Befehlsart | 02 NP N2, K11; ADR 005 |
| Hand-Quantize | 02 §5.2: `/quant` nächster Rasterpunkt | 02 NP K10: sofort phasentreu wie Mixxx | beides: Hand sofort phasentreu (Direktweg) bzw. nächster erreichbarer Rasterpunkt (Stretcher-Weg), KI immer mit Ziel-Beat | 02 NP K9, K10; ADR 007 |
| Stems | 03 §1: ein Stretcher je Stem | alle Entwürfe: Stretcher auf der Stem-Summe | Direktweg mischt Stems ohne Stretcher (frei, sofort); auf dem Stretcher-Weg ein Stretcher auf der Summe; M16 prüft Klang und Wirkzeit | 01 §4.5 (16 Stretcher passen nicht in einen Thread); ADR 020 |
| Vorhören und KI-Messung | Robust: derselbe Abgriff | KI: getrennter Mess-Abgriff | getrennt, an derselben Stelle; „Cypher hören“ legt Cyphers Vorschlag bewusst auf Andreas' Cue | A4 wörtlich; ADR 008 |
| Aufnahme | KI, Spiel: Ring im Kern | Robust: Unit an den Notbahn-Ausgängen | Unit an den Notbahn-Ausgängen | 01 §4.4; ADR 008 |
| Live-Analyse | KI, Spiel: Taktende-Faden im Kern | Robust: außerhalb des Kerns | Block-DSP im Kern, Taktende in `cypherdj-analyse` | 08 §4.f; ADR 012 |
| Plugin-Hänger | 05 §4.5: Hänger im Prozess friert den Treiberkreis | 10 NP N3: paralleler Hänger hält ihn nicht | ungeklärt, M7 entscheidet; bis dahin keine Plugins im Mix | ADR 009 |
| Stems im Set auf der CPU | ADR 003: nie; ADR 011 und §3.6: nie bei 128 | §7 Zusage und 10 NP N6: bei 256 mit 15 % der Periode | eine Regel: bei 256 als Job mit Nice 19 erlaubt, bei 128 nie; GPU erst nach Frage 4 und M9 | 10 NP N6, K3; ADR 003, 011 |
| Stimmungsangleich | ADR 012: automatisch über die Keylock-Tonhöhe | Direktweg ohne Stretcher, kein Tonhöhen-Regler im Vertrag | offline beim Einlesen je Stück auf 440 Hz im Warp-Lauf, live keiner | ADR 012, 020 |
| Umfang von I3 | Vertrag: nur „unhörbar wird hörbar“ | Kurzfassung und A4: „nie ungehört“ | I3 für neuen Inhalt: Öffnen über Trim und Fader, Schuss, Muster, Cyphers Sprung | A4 wörtlich; ADR 023 |
| Autonomie Stufe 1 | Vertrag: nur Hörbarmachendes wird Vorschlag | ADR 013: Positivliste | Positivliste gilt, Vertrag angeglichen | A4; ADR 013 |

---

## 13. Offene Fragen an Andreas (mit Vorgabe zum Nicken)

1. **Welches Interface wird der Taktgeber?** Vorgabe: ein Interface mit mindestens vier Ausgängen (Master 1/2,
   Kopfhörer 3/4), nur für die DJ-Dienste; dein Desktop-Ton bleibt am Onboard-Ausgang. Hat dein NI-Gerät nur
   zwei Ausgänge, startest du mit Split-Kopfhörer (links Cue, rechts Master), bis ein neues da ist. Für die
   Messreihe M1 stecke ich ein Kabel von Ausgang auf Eingang, Lautsprecher aus.
2. **Wie viel darf ich am Anfang allein?** Vorgabe: Stufe 1. Ich schlage vor, du nimmst per Taste an, und zwar
   alles, auch nur einen EQ-Griff an deinem Deck; allein darf ich nur laden, vorhören, Songs bestellen und meine
   eigene Spur ausblenden. Einen Regler, den du angefasst hast, bekomme
   ich zurück per Freigabe-Geste oder nach 8 Takten Ruhe. Die Stopp-Taste nimmt mir sofort alles.
3. **Hörtermin vor den teuren Teilen?** Vorgabe: rund 30 Minuten nach Scheibe 3, du mit Kopfhörer: R3 gegen
   Bungee, einfache Übergangsregel gegen Optimierer, Notbahn-Schleife, und wie sich die Latenz anfühlt
   (weiche Notbahn bei 256 gerechnet 22 ms vom Griff bis zum Wandler, ohne Blende 17 ms mit Knack nur im
   Absturzfall). Bis dahin gelten R3, die Regel und die weiche Notbahn.
   **Notbahn beantwortet 2026-09-25** (A: „ok daneben“, auf die M2-Zahlen): Notbahn daneben, keine Zusatzlatenz,
   Knack nur im Absturzfall (ADR 016 Nachtrag). Hörtermin für R3, Regel und Latenzgefühl bleibt.
4. **Darf die GPU der DJ-Maschine im Set frei sein?** Stems frischer Songs brauchen sie (PyTorch-Demucs laut Recherche rund
   7 GB Grafikspeicher, ungemessen); in dieser Nacht belegten fremde Dienste 7,6 bis 10,6 GiB von 12. Vorgabe: im Set keine
   GPU-Stems; frische Songs bekommen Stems auf der CPU (nur bei Quantum 256, gedrosselt) oder kommen ohne Stems in die
   Kiste. Wenn du willst, dass das Training während eines Sets pausiert, sag es; dann messe ich vorher Start und Ende
   eines Stem-Jobs neben dem Kern (M9).
5. **Wie viel Routing willst du?** Vorgabe für V1: jeder Kanal auf den Master oder einen von vier Gruppenbussen, vier
   Sends je Kanal (Echo, Hall, zwei für Plugin-Effekte ab Scheibe 8). Willst du mehr (freie Matrix, Busse in Busse,
   Inserts an beliebiger Stelle), sag es vor Scheibe 1; der Mixer wird ohnehin als Tabelle gebaut.

Weitere Entscheidungen mit Vorgabe, die du jederzeit kippen kannst, stehen in den ADRs: fremde Link-Geräte
dürfen unser Tempo nicht ändern (ADR 004), „pumpen“ ist 0 dB bis du es erklärst (ADR 012), jedes einkommende Stück
wird beim Einlesen auf 440 Hz gestimmt, nur unter 35 Cent und bei Einigkeit zweier Werkzeuge, live gibt es keinen
Tonhöhen-Regler (ADR 012), jeder Kanal klingt bei Fader 0 dB mit −16 LUFS (`ziel_lufs`, ungehört gesetzt), dein
Tempo-Encoder fährt jede Raste als Rampe über einen Schlag (ADR 004), Beatjump im Loop schiebt den Loop mit (ADR 007),
die Notbahn blendet nach 8 Takten aus (ADR 016).

---

### Antworten Andreas (2026-09-23 ~08:15, CLI, wörtlich: „1 ok 2 ok 3 hörtermin später abends erst 4 fühlt sich als einschränkung an deren grund ich nicht kenne 5 ok")

1. **Interface:** angenommen (mindestens vier Ausgänge; bis dahin Split-Kopfhörer).
2. **Freiheitsstufe am Anfang:** angenommen (Stufe 1, nur vorschlagen, Annahme per Taste, Stopp-Taste).
3. **Hörtermin:** abends, nicht tagsüber. Pläne legen Hörtermine (M18 und jede Abnahme mit Ton) auf einen
   Abendtermin, den Andreas nennt; bis dahin gelten die Vorgaben (R3, Regel, weiche Notbahn).
4. **GPU im Set:** Vorgabe NICHT angenommen, Grund war ihm unbekannt. Gegenvorschlag Cypher (Antwort
   ausstehend): GPU-Stems im Set erlaubt, sobald M9 zeigt, dass ein Stem-Job neben dem Kern keine
   Aussetzer erzeugt; während eines Sets gehört die GPU dem Set, andere Jobs pausieren. Bis zur Antwort
   planen die Pläne M9 als Tor, nicht als Verbot.
5. **Routing:** angenommen (vier Gruppenbusse, vier Sends je Kanal).

## 14. Quellen

- `docs/architektur/00-anforderungen.md` (A1 bis A26, §9)
- Dossiers: `01-audio-kern.md` §3.2 bis 3.9, 4.2 bis 4.9, 5, 6, Nachprüfung (Punkte 1 bis 6, N1 bis N6, K1 bis K9) · `02-uhr-sync-planer.md` §3, Proben a bis e, 5,
  Nachprüfung N1 bis N6, K1 bis K13 · `03-deck-engine.md` §3, 4a bis 4f, 5, 6 · `04-mixer-effekte.md` §3, 4.1
  bis 4.8, 5 · `05-plugins-instrumente.md` §3, 4.1 bis 4.5, 5, 6 · `06-erzeuger-muster.md` §3, 4.1 bis 4.3, 5,
  6 · `08-analyse-passung.md` §3.3, 4.a bis 4.f, 5, Nachprüfung K1 bis K8, „Was fehlt“ · `09-ki-steuerung.md`
  §3, 4.1 bis 4.6, 5, Nachprüfung K1 bis K16, „Was fehlt“ · `10-robustheit-betrieb.md` §3a, 3c, 4a bis 4d, 5,
  6, Nachprüfung K1 bis K10, N1 bis N9
- Werkstatt-Zwischenstand: `proben/07-werkstatt-zerleger/c_drift.log` (Stand 02:59, 11 Zeilen; bei der Kritik-Runde
  03:46, 16 Zeilen mit drei YuE2-Songs), `c_drift.py`, `b_timemap.log`/`.json`/`.py` (Docstring: synthetische Quelle,
  Wahrheit bekannt), `b_strecken.log`/`.py` (Faktor 134/128), `pip_torch.log`
- `proben/08-analyse-passung/probe_b_uebergang.py` Z. 149 bis 163 (Korridore), 219 bis 228 (`saat`, die Faustregel),
  241 bis 252 (Spielarten), 263 bis 271 (Kurvenform); `proben/10-robustheit-betrieb/src/notbahn.c` Z. 24, 77, 90, 96;
  `minikern.c` Z. 56 (`sd_notify`)
- Eigene Prüfungen der Kritik-Runde (2026-09-23, 04:15 bis 05:00, offline, stumm): `git ls-files proben` → 0 und
  `git check-ignore` (vendor, `*.log`); `pkg-config` für liblo, libsystemd, nlohmann_json, tomlplusplus, gtest, catch2
  (fehlen; Gegenprobe rubberband, jack, sndfile gefunden); Werkstatt-venv (`torch 2.5.1+cpu None`, kein `websockets`,
  kein `pytest`), System (`torch 2.10.0+cu128`, websockets 16.0, pytest 8.4.2, kein demucs), `~/.cache/torch` fehlt,
  `beat_this` `CHECKPOINT_URL`; `node -e "require('node:sqlite')"` (läuft, ExperimentalWarning); `nvidia-smi` 7 786
  von 12 282 MiB; `ffmpeg -af ebur128=peak=true` auf zehn MiniMax-Songs und MFB; Golden-Werte §1.3 nachgerechnet;
  Bungee Commit 8cb6977, libebur128 Commit 67b33ab (MIT)
- `tests/stretch-bench/ERGEBNIS.md` §1, 2.1 bis 2.6, 4, 8
- `docs/recherche/2026-09-22-modulares-live-system.md` §3c, 3d, §5; `2026-09-22-loopen-springen.md`;
  `2026-09-22-tracker.md`
- Entwürfe: `entwuerfe/entwurf-ki.md`, `entwurf-robust.md`, `entwurf-spiel.md`; Richter-Bewertungen (im
  Auftrag der Synthese)
- LLM-Rohdaten: `proben/09-ki-steuerung/nachpruefung/llm_x_wahl_sonnet_low_ergebnis.json`,
  `llm_x_mcp_sonnet_low_ergebnis.json`, `llm_x_mcp_sonnet_low_denken0_ergebnis.json`,
  `llm_x_text_sonnet_low_pad450000_ergebnis.json` (heute nachgelesen)
- Skills (Betriebs-Befunde, nicht heute gemessen): Skill `cypher-musik` (intern) Abschnitt „Die
  Zahlen, mit denen du planst“; Skill `cypher-musik-mietgpu` (intern) Zeile 8
- Werkzeugstand DJ-Maschine, heute abgefragt: `pkg-config --modversion` für rubberband, jack, sndfile, samplerate,
  fftw3, lilv-0, alsa, aubio; `libebur128` ohne Entwicklungspaket; `g++`, `cmake`, `ninja`, `faust`, `node`,
  `python3`, `systemctl --user --version`

---

## Kritik und Korrekturen (2026-09-23)

*Lücken-Kritik an dieser Fassung, 30 Befunde (3 blockierend, 27 wichtig), eingearbeitet am 2026-09-23 zwischen 04:15
und 05:00. Jeder Befund wurde vor dem Einarbeiten an seiner Quelle nachgeprüft (Spalte „Nachgeprüft“); keiner war
falsch. Abgelehnt ist kein Befund ganz, drei Vorschläge nur in Teilen (Spalte „Entscheidung“, mit Grund). Nicht
ausgeführt, weil der Auftrag dieser Runde es verbietet (nicht committen, nichts installieren, keine Dienste): Commit der
Proben, neues venv, Header-Kopien; sie stehen als Aufgaben in V0 und W1. Neue Mess-IDs: M19, M20.*

| Nr | Befund (Gewicht) | Nachgeprüft | Entscheidung | Wo |
|---|---|---|---|---|
| 1 | Autonomie-Stufe 1 in Vertrag und ADR 013 verschieden: Vertrag lässt EQ, Stem, Send, Sprung, Loop an Andreas' hörbarem Deck ohne Annahme durch (blockierend) | SCHNITTSTELLEN §10 alt gegen ADR 013 Z. 38 f. gelesen | **eingearbeitet:** Positivliste im Vertrag (jede Einreichung wird Vorschlag, allein nur laden, vorhören, erzeugen, eigene Pläne abbrechen, eigene Spur leiser), Golden-Folge `autonomie_1_eq` | SCHNITTSTELLEN §10, §19.3; ADR 013 Entscheidung 4; §12, §13 Frage 2 |
| 2 | „Nie ungehört“ nur für „unhörbar wird hörbar“: Schuss auf offenem Pad, Muster auf offenem Erzeuger, Cyphers Sprung, Fader hinter geschlossenem Crossfader (blockierend) | §1.6, §4.5, §4.6, §17 alt; 09 Z. 487 | **eingearbeitet:** I3 = „neuer Inhalt nur mit Hörschein“ (I3a Öffnen über Trim und Fader, unabhängig von Crossfader, Bus, Master; I3b Pad; I3c Muster; I3d Cyphers Sprung nur zu gemessenem Ziel oder nach Annahme); Hörschein bindet `inhalt` und Quell-Bereich; neue OSC-Typen jetzt festgelegt; Kurzfassung Punkt 5 ehrlich | SCHNITTSTELLEN §1.6, §4.4 bis §4.8, §16.2, §17, §19.3; ADR 007, 010, 023; Kurzfassung 5, §3.5, §10 A4, §12 |
| 3 | Kopf nennt 01 ungeprüft, obwohl die Nachprüfung vorgeht: ADR 006 mit „8 versetzt, 120 µs“, ADR 002 mit widerlegtem Rust-Argument, Kern-Beleg nur Plattform, Startregel unzureichend, 235-fach und 669 überholt | 01 Z. 600 ff., K1, K3, K5, K7, K9 gelesen | **eingearbeitet:** Kopf korrigiert; ADR 006 höchstens 2 R3 je Arbeits-Thread, Start mit Durchziehen (K3), K2 und K4 als Folgen; ADR 002 neu begründet (Vorlagen C/C++, Speichersicherheit gewogen, ASan/UBSan als Mechanik); Kern-Beleg eingestuft; ADR 018 und 001 mit 2,5-fach und 1 539 | Kopf, §2.1, §3.1, §7; ADR 001, 002, 006, 016, 018, 020 |
| 4 | Doppelknoten mit reinem Timing-Beleg verworfen; Null-Samples verschwiegen; Regel „keine Sprünge“ bricht der eigene Encoder (0,01 BPM) und der Phasenregler | ERGEBNIS Z. 180, 185 bis 187; SCHNITTSTELLEN Z. 502 alt | **eingearbeitet:** Doppelknoten „zurückgestellt, nicht widerlegt“; 128 Null-Samples genannt; Hand-Segment fährt jede Raste als Rampe über 1 Beat, Phasenregler höchstens 10 ppm je Block (gesetzt); M4 misst kleine Faktorwechsel mit Null-Samples am Ziel und Negativ-Kontrolle | §4 Regeln 3 und 4, M4; SCHNITTSTELLEN §1.3, §7.3 Punkt 7; ADR 004, 006 |
| 5 | „A10 gemessen offline“ gilt nur um ±5 %; MiniMax braucht 0,71 bis 1,42; BPM-Treue von MiniMax ungemessen | c_drift.log (89,905 bis 180,709 BPM), ERGEBNIS Z. 11, 03 §4c, `b_strecken.py`, Skill Z. 59 | **eingearbeitet:** A10 „gemessen bis rund 5 %, darüber ungemessen“; Halb-/Doppeltempo-Wahl; Tor `streckfaktor` ±15 % (gesetzt, lässt von zehn Songs drei durch, gerechnet); neue Messung M19 in Scheibe 0 (vor W1); M14 mit BPM-Treue | §3.6, §5.2, §10 A10, M14, M19; SCHNITTSTELLEN §12.3; ADR 006, 011, 022 |
| 6 | „Sync vorher bekannt“ für generierte Songs ausgehöhlt: Streichliste erlaubt Hörschein ohne Deck gegen Deck, Timemap-Beleg nur synthetisch, Tore prüfen mit dem Werkzeug, das die Karte setzte, Klarheit-Ausnahme | `b_timemap.py` Docstring, 08 Z. 612, c_drift (8 von 10 unter 0,1) | **eingearbeitet:** Deck gegen Deck nicht streichbar und für MiniMax Pflicht; Beleg als „Timemap-Mechanik mit bekannter Wahrheit“ eingestuft; Raster-Tor mit unabhängigem Anschlag-Instrument (`fa.py`) und Mindestzahl; Ausnahme im Tor `klarheit` gestrichen | §3.6, §9.3, M13; SCHNITTSTELLEN §12.3, §14.5; ADR 006, 011 |
| 7 | Faustregel nur mit der Sub-Zeile zitiert; Tief 0,402 und 0,355 reißen die Vertragsgrenzen, der Rechner hätte beide Spielarten verriegelt | 08 Z. 644 gelesen | **eingearbeitet:** alle Bänder zitiert; nur `grenze_sub` verriegelt, Tief-Grenzen warnen bis M20 (`grenzen_tief_verriegeln = false`); M20 rechnet die Regel gegen die Grenzen nach | §3.4, M20; SCHNITTSTELLEN §2.1, §11, §14.4; ADR 012, 013 |
| 8 | Antwortfrist 4 Takte im Vertrag, ADR 013 rechnet mit 8 und kippt erst über 8; Zugzeiten 7,5 bis 15 s verfallen unbemerkt | SCHNITTSTELLEN Z. 171; ADR 013 Z. 67, 83; 09 NP K6; `llm_x_wahl…json` `cache_gelesen` bis 7 410 | **eingearbeitet:** Kipp-Kriterium an die Vertragsfrist gebunden (p95 Zug + Reparaturzug ≤ 4 Takte); M15 mit Werkzeug-Wahl und Kontext ≥ 100 000 Token; Rückzug der Anfrage auf F−28 als Ausweg | §3.4, M15; SCHNITTSTELLEN §3; ADR 013 |
| 9 | Stems im Set hängen an einer ungesicherten GPU; drei verschiedene CPU-Regeln; A19 „gemessen“ bei ruhendem Training; Frage an Andreas fehlt | Recherche Z. 320, 321, 338 f., 581; 10 Z. 452, 540; `nvidia-smi` 7 786 von 12 282 MiB | **eingearbeitet:** eine Regel (CPU-Stems nur bei 256 mit Nice 19, bei 128 nie; GPU erst nach Frage 4 und M9); TensorRT-Zahl als nicht zutreffend markiert; A19 „nur unter Dauerlast“; M9 mit VRAM der echten Kette und Job-Start/-Ende; Frage 4 | §3.6, §7, §10 A19, §12, §13 Frage 4, M9; SCHNITTSTELLEN §2.1, §12.3; ADR 003, 011 |
| 10 | Takt-Eins und Text aus A13 still gestrichen; Hotcues, Phrasen, Basstausch und Rückfall zählen ab dem ersten Schlag | Suche „Takt-Eins, downbeat“: nur ADR 004 und 011 (Positivprobe) | **eingearbeitet:** `erste_eins_quell_beat` (beat_this-Downbeat plus zweites Verfahren), Takte und Phrasen ab dort, Rückfall-Loop auf der Eins, Tor `eins`, Handkorrektur Umschalt plus Tap (Art `eins`), M13 mit Downbeat-Treffern; Text aus dem Prompt, als solcher vermerkt | §3.6, §10 A13, M13; SCHNITTSTELLEN §1.1, §7.3 Punkt 11, §12.3, §13.2, §13.3, §17; ADR 007, 011 |
| 11 | Unveränderliche Ordner vertragen sich nicht mit `korrigieren`, `nachrendern` und `korrekturen.jsonl` | ADR 015 Z. 17; SCHNITTSTELLEN Z. 643, 655 alt; ADR 021 Z. 72 | **eingearbeitet**, in anderer Form als vorgeschlagen: je Render ein eigener Fassungs-**Ordner** `fassungen/<bpm·1000>_r<n>/` mit `fassung.json` (statt Datei-Suffix), weil auch Stems, Schüsse, Fingerabdruck, Kreuzenergien und Referenz je Fassung sind; `material.json` nur Quelle; `korrekturen.jsonl` einzige anhängbare Datei; Laden und Hörschein binden die Fassung | §3.6, §11; SCHNITTSTELLEN §4.4, §4.5, §5.5, §5.9, §6.4, §6.5, §12, §13; ADR 007, 011, 015 |
| 12 | Notbahn kennt weder Tempo noch Taktlänge; Ring (65 536 Frames) kürzer als ein Takt | `notbahn.c` Z. 24, 77, 96; SCHNITTSTELLEN Z. 406 | **eingearbeitet:** `takt_frames` und `takt_anfang_w` im Ring-Kopf, eigener Verlauf ≥ 384 000 Frames, Golden-Folgen `notbahn_124` und `notbahn_rampe`; Abweichung in Rampen gerechnet (rund 7 ms je Durchlauf) | §3.2; SCHNITTSTELLEN §6.1, §19.3; ADR 016 |
| 13 | A17 „viel Routing“ still zu festem DJ-Mixer umgedeutet | 00-anforderungen Z. 116; SCHNITTSTELLEN §1.5 alt | **eingearbeitet:** Mixer als Zuweisungstabelle, vier Gruppenbusse mit vollem Kanalzug, vier Sends (`fx/3`, `fx/4` für Wirte), Inserts ab Scheibe 8; Richtung als Frage 5 an Andreas mit Vorgabe | §3.1, §10 A17, §13 Frage 5, §9.3; SCHNITTSTELLEN §1.5, §1.6; ADR 008, 009 |
| 14 | Stimmungsangleich über die Keylock-Tonhöhe hat keinen Weg (Direktweg ohne Stretcher, kein Tonhöhen-Regler) | ADR 012 Z. 23; SCHNITTSTELLEN §4.4 alt | **eingearbeitet**, mit geänderter Vorgabe: offline beim Einlesen im Warp-Lauf je Stück auf 440 Hz (entspricht 08 Frage 1 „einkommende Stücke“), nicht paarweise live; live kein Tonhöhenweg; M19 misst die Tonhöhe der Korrektur | §12, §13; SCHNITTSTELLEN §12.3, §13.2; ADR 012, 006 |
| 15 | Hüllkurven-Ring liefert drei Isolator-Bänder, Takt-Bericht und Hörschein brauchen sechs; `huelle_1khz.npy` undefiniert (blockierend) | SCHNITTSTELLEN §6.2, §14.5, §14.8 alt; 08 §3.3.1, §3.3.6, §4.0 | **eingearbeitet** (Variante sechs Bänder): Datensatz 64 Bytes mit `band[6]`, Filter als `baender.json` gemeinsam für Kern und Werkstatt; `huelle_1khz.npy` [6, N] mit denselben Filtern und demselben 48-Sample-RMS, Index = Frame/48; Anschlag-Glättung wegen 08 §4.0 Fehlerfall 1 im Plan von Scheibe 2 | §3.1, §3.5; SCHNITTSTELLEN §6.2, §13.1, §14.8; ADR 008, 012 |
| 16 | Alle Vorlagen und zwei Bau-Abhängigkeiten liegen unversioniert unter `proben/` | `git ls-files proben` → 0; `git check-ignore` vendor und `*.log` | **eingearbeitet als Aufgabe V0** (nicht ausgeführt: diese Runde committet nicht): Proben ohne WAV, venv, vendor committen, Ausnahme für Beleg-Logs; libebur128 (67b33ab) nach `djk/third_party/`, Bungee (8cb6977) in Scheibe 5 | §8.1, §8.2, §8.3, §9.2; SCHNITTSTELLEN §19.0, §19.4; ADR 021 |
| 17 | `djk/vertrag/` ohne Eigentümer und Quelle; Golden-Liste lückenhaft; `hand_gewinnt` gegen die Attrappe nicht ausführbar; keine Ring-Gegenstelle | SCHNITTSTELLEN §19 alt; Golden-Werte nachgerechnet (alle richtig) | **eingearbeitet:** Werkstück V0 mit einem Eigentümer, `osc.json` als einzige Quelle, Format der Golden-Folgen, `/test/hand`, Ring-Attrappe; Golden-Liste um 20 Folgen erweitert | §8.1, §9.2; SCHNITTSTELLEN Kopf, §19.0 bis §19.3; ADR 021 |
| 18 | Notbahn ohne Tempo und Takt-Eins; TOML in C ohne Parser | `notbahn.c`; `pkg-config tomlplusplus` fehlt | **eingearbeitet** (Tempo wie Nr. 12; Ausblendung auf der Takt-Eins); Ports als Aufrufparameter aus `ExecStart`, die Notbahn liest keine Datei | §3.2, §2.1; SCHNITTSTELLEN §2, §6.1, §8; ADR 016 |
| 19 | Bau-Abhängigkeiten reichen nicht (JSON, TOML, sd_notify, OSC, Tests; venv ohne websockets und pytest; `node:sqlite` experimentell; kein Konfigurationsschema) | `pkg-config`, `/usr/include`, venv- und System-Imports, `node -e` selbst geprüft | **eingearbeitet:** Einzel-Header für JSON und TOML, sd_notify und OSC selbst nach Vorlage, CTest mit eigenem Assert-Header; neues Werkstatt-venv mit `--system-site-packages`; `node:sqlite` bleibt (läuft), Rückweg `index.json`; Schema aller Schlüssel. Nicht übernommen: apt-Pakete (Einzel-Header brauchen keine Systemänderung) | §2.1, §8.2; SCHNITTSTELLEN §2.1, §13.4, §19.4 |
| 20 | „hörbar“ ohne „Deck läuft“; Deck-Teile ohne Plan und Gruppe: angehaltenes B zählt als hörbar, Stopp von A läuft trotz Handgriff, Ende in Stille | SCHNITTSTELLEN §1.6, §4.4, §14.1, §17 alt | **eingearbeitet:** hörbar verlangt laufendes Deck; Deck-Teile mit `plan`, `gruppe`, `hoerschein` (neue Typen); I2 auch für Plan-Stopps; nur ein ausgeführter Stopp von Andreas unterbindet den Frist-Wächter; Golden-Folgen `b_verriegelt_a_laeuft_aus`, `hand_stoppt_a_raus` | §5.1; SCHNITTSTELLEN §1.6, §4.4, §14.1, §16.1, §17, §19.3; ADR 023 |
| 21 | Abonnenten fehlen im Neustart-Zustand, `/e/neustart` geht an niemanden; Wiederanmeldung ungeregelt | SCHNITTSTELLEN §4.1, §6.3, §16.3 alt | **eingearbeitet:** Abonnenten im Zustand, `/e/neustart` sofort und nach jeder Anmeldung, `/q/stand` je offenem Befehl, `/k/hallo` nach 100 ms ohne `/uhr` und dann alle 50 ms; Golden-Folge `neustart` | §7; SCHNITTSTELLEN §4.1, §5.1, §5.9, §6.3, §16.3; ADR 016 |
| 22 | Hörschein läuft im Normalablauf genau am Start ab (F−32 + 64 Beats = S, I3 verlangt `<`); §3 und §5.1 widersprechen sich | nachgerechnet | **eingearbeitet:** Erneuerung nach jedem Takt (gleiche `hs_id` ersetzt), I3 mit `≤`, §5.1 an §3 angeglichen; Golden-Folge `hoerschein_rand` | §3.5, §5.1; SCHNITTSTELLEN §3, §4.5, §14.5, §17 |
| 23 | Wo B beim Einblenden im Material steht, ist nirgends festgelegt | SCHNITTSTELLEN §10, §11, §14 alt | **eingearbeitet:** `einstieg_quell_beat` in Kandidat, Wahl und Plan; Vorhören startet am Einstieg, der Plan startet B an S neu am Einstieg (Deck-Teil `start`), I3a prüft die Quellposition; Golden-Folge `einstieg` | §5.1; SCHNITTSTELLEN §10, §11, §14.1, §14.2, §14.6, §19.3 |
| 24 | Offen, ob die Stem-Summe oder die Basis-Datei klingt | Suche in SCHNITTSTELLEN, ARCHITEKTUR, ADR 007/020 | **eingearbeitet:** mit Stems klingt die Stem-Summe, ohne die Basis-Datei, umgeschaltet nur beim Laden (`mit_stems`); `stem/*` ohne Stems → `keine_stems`; Referenz und Kreuzenergien aus dem, was klingt; Speicher je Deck | §3.1; SCHNITTSTELLEN §1.5, §4.4, §13.1, §16.2; ADR 020 |
| 25 | Kein Ziel-LUFS, Trim bis +12 dB: generierte Songs erreichen kein Ziel über rund −15,5 LUFS | alle elf Werte selbst mit `ffmpeg ebur128` nachgemessen (−13,6 bis −15,5; MFB −7,5) | **eingearbeitet**, mit einer Abweichung: `ziel_lufs` −16 als Vorgabe zum Nicken, Trim bis +24 dB, Limiter −1 dBTP; den Trim rechnet **der Kern beim Laden** aus `ziel_lufs` und der LUFS der Fassung (nicht die Werkstatt), damit eine geänderte Vorgabe kein Neu-Rendern braucht | §3.6, §13; SCHNITTSTELLEN §1.5, §2.1, §13.2; ADR 006, 008 |
| 26 | §14.4 beschreibt nicht die gemessene Faustregel; Beispielplan weicht ab (Kill statt EQ, A bis −200) | `probe_b_uebergang.py` Z. 219 bis 228, 241 bis 252 und Kurvenform Z. 263 bis 271 gelesen | **eingearbeitet:** §14.4 als vollständige Regel mit Stützwerten je Takt (1-basiert), Beispielplan §14.1 genau danach; `a_eq_hoch_ab_takt` für „hart“ war falsch (2 statt 4) und entfällt; Abweichungen erst nach Nachrechnung „gemessen“; Golden-Folge `expandiere_sicher` | §3.4, §5.1; SCHNITTSTELLEN §11, §14.1, §14.4; ADR 012 |
| 27 | Werkstatt-Kette auf DJ-Maschine nicht lauffertig (venv nur CPU-torch, keine Gewichte, GPU belegt, CPU-Regel widersprüchlich, Raster-Tor vor M13 nicht baubar) | venv- und System-Imports, `~/.cache/torch`, `CHECKPOINT_URL`, `nvidia-smi` selbst geprüft | **eingearbeitet:** W1 ohne Stems, neues venv, Gewichte vorab mit Größenprüfung (über 1 GB nur mit Andreas' Ja), CPU-Regel wie Nr. 9, Raster-Tor mit benanntem Instrument. **Teilweise abgelehnt:** als Detektor nicht beat_this am gewarpten Ergebnis (es setzte die Karte, Nr. 6), sondern `fa.py`-Anschläge; das Tor bleibt für Cypher eine Sperre (A4), für Andreas eine Warnung | §2.1, §3.6, §8.2, §9.2 W1; SCHNITTSTELLEN §12.3, §19.4; ADR 011 |
| 28 | Abnahmen von Scheibe 1 nicht messbar (kein Lastprofil, keine Fremdlast-Regel, L1 ohne Testliste, Spieler und MCP ohne Abnahme, W1 hängt an M13) | 10 NP K2 (2 in 405 136 Zyklen), Laufzettel 01:25 | **eingearbeitet:** Lastprofil P1 als Skript, Grenze „höchstens 1 Lücke, dann Wiederholung mit 0“, Fremdlast im Bericht, über 4 vorläufig (M10); L1-Pflichtfälle; Spieler und MCP mit Abnahme; W1 an den Kontrollen aus c_drift statt am M13-Urteil | §9.2; ADR 021 |
| 29 | Notbahn und spätere Bausteine verbinden Ports selbst ohne Riegel gegen ungefragten Ton | `notbahn.c` Z. 90; 00-anforderungen §9 | **eingearbeitet:** Positivliste (`stumm`, `cypherdj-pruef-*`), echtes Interface nur mit `--ton-frei` bzw. `ton_frei` nach Andreas' Freigabe, Test-Units nur transient; nie gestrichen | §3.2, §9.3; SCHNITTSTELLEN §8, §19.5; ADR 016 |
| 30 | Nachprüfung 01 als fehlend geführt; M3 misst im falschen Modus, Startrezept unvollständig, Rust-Begründung widerlegt | wie Nr. 3 | **eingearbeitet** (zusammen mit Nr. 3): M3 im Pull-Modus mit 1, 2 und 4 R3 je Thread und Startregel im Callback; ADR 006 Startregel; ADR 002 neu begründet | M3, §3.1; ADR 002, 006, 020 |
