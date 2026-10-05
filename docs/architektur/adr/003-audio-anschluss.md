# ADR 003: Audio-Anschluss und Blockgröße

- **Status:** vorläufig, Messung M1 (Interface) steht aus
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A4, A20, A26
- **Hängt zusammen mit:** ADR 004, 008, 016

## Kontext

PipeWire 1.6.8 läuft auf DJ-Maschine mit Standard-Quantum 1024 (10 §3a). Andreas' Interface ist unbekannt (A26); alle
Echtzeit-Zahlen stammen von einer Null-Senke, die selbst nach `CLOCK_MONOTONIC` taktet (02 NP K6, 10 NP K8), unter
Fremdlast 19 bis 70. Die Entwürfe widersprechen sich: „Spielbarkeit“ will 128 als Spielziel, „Robustheit“ und
„KI“ 256 als Standard.

## Entscheidung

- **JACK-API unter `pw-jack`**, 48 kHz. Der Kern verbindet seine Ports selbst mit JACK-Namen, nie automatisch.
- **Quantum 256 (5,33 ms) ist der Set-Standard.** 128 wird Standard erst, wenn M1 am echten Interface bei 128
  60 min mit laufender Werkstatt ohne Frame-Lücke zeigt.
- **Ein Interface ist der einzige Treiber der DJ-Knoten** (eine Quarzuhr); Master (1/2) und Cue (3/4) auf
  demselben Gerät. Desktop-Ton bleibt am Onboard-Ausgang. Kern und Notbahn setzen `node.lock-quantum = true`,
  nur die Kern-Unit setzt das Quantum, die Telemetrie meldet jeden Pufferwechsel (`/e/quantum`).
- Hat das Interface nur zwei Ausgänge: **Split-Kopfhörer** (links Cue mono, rechts Master mono, Mixxx-Muster) als
  Notweg, bis ein Gerät mit vier Ausgängen da ist.
- **Stem-Trennung während eines Sets** (eine Regel für alle Dokumente, ADR 011, `SCHNITTSTELLEN.md` §12.3): auf der
  CPU nur bei Quantum 256, als Werkstatt-Job mit `Nice=19`, `CPUSchedulingPolicy=batch` und begrenzten Fäden (10 NP
  N6: 15 % der 256er-Periode, 0 Lücken; bei 128: 55 %), bei 128 nie; auf der GPU erst, wenn Andreas die Frage „GPU im
  Set frei?“ beantwortet hat (ARCHITEKTUR §13 Frage 4) und M9 Job-Start und -Ende gemessen hat.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| 128 als Standard | echte Stem-Trennung auf der CPU trieb das Aufwachen bei 128 auf 55 % der Periode (bei 256: 15 %); unter Speicher-Sättigung bei 128 bis 85 % und 1 bis 2 Ausfälle in 337 605 Zyklen; die „0 Ausfälle bei 256“ sind statistisch leer, getragen wird 256 vom Abstand zur Periode | 10 NP N6, K2, Probe b L1/L7 |
| native PipeWire-API (`pw_filter`) | spätere Option, wenn Knoten-Eigenschaften direkt gesetzt werden sollen; ungeprüft | 01 §3.2 |
| Cue auf einem zweiten Gerät | zweite Uhr, adaptives Resampling | 02 NP K8 |
| JACK2-Server statt PipeWire | würde Andreas' Desktop-Audio umbauen; nicht geprüft | Vermutung |

## Folgen

- Ohr-Latenz bei 256 mit weicher Notbahn gerechnet mindestens 22,3 ms vom Griff bis zum Wandler, bei 128
  mindestens 11,7 ms (ARCHITEKTUR §6). Ob das stört, entscheidet Andreas im Hörtermin (M18).
- Ein fremder Client mit `node.force-quantum` am selben Treiber kann das Quantum umwerfen („The last node to be
  activated with this property wins“, `man pipewire-props`); darum eigenes Interface für die DJ-Knoten.
- Kernel und Boot bleiben, wie sie sind; Reserve ist Ubuntus `lowlatency-kernel` plus `threadirqs`, nur nach M1
  und mit Andreas' Ja (10 §3c, Frage 2).

## Beleg

10 Probe b (R1: 128 unter GPU-Training 600 s, 0 Lücken, Aufwachen max 304 µs; L3: 256 unter Speicher-Sättigung
max 1 609 µs = 30 %), NP N6, K2, Risiko 2; 01 §3.2 (Falle Portname `cypher-stumm-probe`); 04 §3.1 (Split).

## Kippt, wenn

M1 zeigt Lücken bei 256 am Interface (dann Kernel-Reserve mit Andreas' Ja, weniger Keylock-Decks, Werkstatt im Set
drosseln) oder hält 128 stabil (dann 128 als Standard, Latenz halbiert).
