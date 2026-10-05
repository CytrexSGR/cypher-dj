# ADR 001: Prozessform und App-Form

- **Status:** angenommen
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A1, A3, A17, A23, A24, A25
- **Hängt zusammen mit:** ADR 002, 016, 018, 019

## Kontext

Heute läuft der DJ-Teil im Browser (Dirigent-Seite, superdough) und als lose Python- und Node-Dienste mit
`nohup` und PID-Dateien (`dirigent.pid`, `battery_server.pid`, `pegel.pid`, `vox_server.pid`, 10 §3a). Die
Dirigent-Seite starb am 2026-09-22 dreimal, ein Worklet-Modul lud einmal nicht (01 §3.8). A25 erlaubt eine
eigene App, A24 stellt die Oberfläche zurück, A17 verlangt einen modularen Kern mit Routing.

## Entscheidung

Ein **Echtzeit-Kern** (`cypherdj-kern`, C++) ist der einzige Prozess, der im Takt rechnet. Dahinter sitzt eine
winzige **Notbahn** (`cypherdj-notbahn`, C). Alles andere ist ein **Satellit** in einem eigenen Prozess:
Leitstand, Spieler (Cypher), MCP-Adapter, Rechner, Analyse, Werkstatt, Aufnahme, später Zerleger, Erzeuger,
Klang- und Plugin-Wirte, Link-Brücke, Oberfläche. Jeder Prozess ist eine **systemd-User-Unit** unter
`cypherdj.target`. „Die App“ im Sinn von A25 ist dieser Verbund, gestartet mit
`systemctl --user start cypherdj.target`, ohne Fenster.

Satelliten sprechen mit dem Kern nur über Befehle mit Ziel-Beat (OSC/UDP), fertige Dateien und entkoppelte
Audio-Rückwege (`SCHNITTSTELLEN.md` §2). Stirbt ein Satellit, fehlt höchstens sein Anteil.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Ein großes Programm (JUCE-App mit GUI, Plugin-Host, Engine) | ein Adressraum: ein Plugin- oder GUI-Absturz nimmt die Musik mit; JUCE bringt AGPL und GUI-Kette ohne Nutzen für einen Dienst ohne Fenster | 01 §3.7, §6.1; 05 §4.5 |
| Mixxx als Deck-Motor, KI daneben | Uhr gehört dann Mixxx, alles andere läuft hinterher; Mixxx-Skript-Timer frühestens alle 20 ms; Quantize wartet nicht auf den Takt | A14 (Andreas zu Mixxx), 09 §3.3, Recherche Loopen-Springen |
| Ardour als Herz | Andreas: „fühlt sich das nicht wirklich gut an“ | A14 |
| Browser bleibt Audiopfad | Tode der Seite, Worklet-Ladefehler, Chromium als Pulse-Client mit eigenem Puffer | 01 §3.8; ADR 018 |
| Eigener Supervisor statt systemd | noch ein Baustein, der sterben kann | 10 §3c |

## Folgen

- Jede Grenze zwischen Prozessen ist ein Vertrag: `SCHNITTSTELLEN.md` ist Pflicht für alle Sessions.
- Satelliten können parallel gebaut werden, der Leitstand zunächst gegen eine Kern-Attrappe (ADR 021).
- Der Betrieb braucht Units, Limits (`LimitRTPRIO`, `LimitMEMLOCK`), Watchdog-Regeln (ADR 016).
- Die heutigen `nohup`-Dienste werden abgelöst, nicht fortgeführt.

## Beleg

- 01 Probe e2: Sender per SIGKILL, der Kern spielte 51 von 51 Schlagabständen exakt weiter.
- 01 Probe e1: zweiter Kern per SIGKILL, der erste lief 63 von 63 Schläge exakt weiter.
- 01 Probe b3: node-web-audio-api mit leerem Worklet 669 Aussetzer in 60 s, ohne Worklet 0 (Nachprüfung: 1 539, die
  Zahl hängt an der Fremdlast, der Befund steht; 01 NP).
- 10 §5: Unit-Schnitt; 10 Probe c: systemd startet einen Kern mit `RestartSec=0` in 38,7 ms bis zum ersten Block.

## Kippt, wenn

Die Prozessgrenzen selbst Aussetzer erzeugen (etwa ein hängender Satellit den Treiber anhält): M7 prüft das
für Rückwege, M11 für den Watchdog.
