# ADR 014: Controller für Andreas

- **Status:** vorläufig, Messung M17 (Andreas' Gerät) steht aus
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A1, A5, A7, A14, A26
- **Hängt zusammen mit:** ADR 007, 013, 023

## Kontext

Andreas' Controller ist unbekannt (A26); `hidapi` fehlt auf DJ-Maschine (09 §3.7). Gemessen ist der Weg mit einem
Software-Sender: USB-MIDI → ALSA → Midi-Bridge → JACK-MIDI, eine Periode später am richtigen Sample (09 Probe c,
NP). Die Nachprüfung fand zwei Fallen: unbekannte Knopfstellung springt (0,3675), ein Rauschschritt bricht Cyphers
Fahrt ab (09 NP K3, K4).

## Entscheidung

1. **Weg:** USB-MIDI-Klassengerät → ALSA → PipeWire-Midi-Bridge → `cypherdj-kern:hand_in` (JACK-MIDI mit
   Sample-Versatz). Kein Umweg über Node. LED-Rückweg über `cypherdj-kern:hand_led`.
2. **Mapping als Datei** (`~/.config/cypherdj/controller/<geraet>.json`, Format `SCHNITTSTELLEN.md` §7), keine
   Mapping-Skripte mit Logik; die Logik sitzt im Hand-Schiedsrichter des Kerns.
3. **Übernahme:** erster Wert je Regler nach Start oder Neuverbindung zählt nur als Stellung; **skaliert** für Potis
   und Fader, **relativ** für Endlos-Encoder; **Totzone 3/128** (Mixxx-Schwelle), bevor ein Griff einen Regler von
   einem Plan übernimmt; Berührungssensor als Auslöser, wo vorhanden.
4. **Rückgabe** eines Reglers an `frei`: Freigabe-Geste (Umschalt plus Berühren) oder 32 Beats (8 Takte) ohne
   Handbewegung, was zuerst kommt (Vorgabe zu 09 Frage 2).
5. **Belegung (Vorschlag bis zum Gerät):** je Deck Play, CDJ-Cue, 4 Pads Hotcue (Umschalt: 5 bis 8, setzen), Pads im
   Roll-Modus (1/4 bis 1/32), Loop-Encoder (Länge, drücken an/aus), Beatjump ±, Nudge-Encoder, Tap, EQ Hoch/Mitte/Tief
   als Encoder mit LED-Kranz, 3 Kill-Tasten, Filter, Send, Trim, Kanalfader, PFL. Global: Crossfader, Cue-Mix,
   Kopfhörerpegel, Split, Tempo-Encoder (Hand-Segment), **Spielart-Encoder, Längen-Encoder (Zeitdruck), Start**,
   **Bass-Tausch-Taste** (zwei gekoppelte Kills als Gruppe auf dem nächsten Takt), „Cypher, Vorschlag“,
   „Cypher hören“, Annehmen, Verwerfen, **Stopp**, Freigabe, Urteil gut/daneben, Autonomie-Schalter 0 bis 3,
   Kiste-Browser (Encoder plus Laden auf Deck n).
6. **LEDs:** eine Farbe für Andreas' Halter, eine für Cypher; Hörschein grün/rot; Vorschlag wartet; Rückfall aktiv;
   Notbahn aktiv; die letzten 4 Takte vor einer Frist blinkt das Deck.
7. **Laden aus der Kiste** geht auch bei totem Leitstand (der Kern liest `/dev/shm/cypherdj/kiste.json`).
8. **Empfehlung Hardware:** Endlos-Encoder mit LED-Kranz für alles, was Cypher auch fährt (dann gibt es keine
   Übernahmefrage); ein echter Fader für die KI-Spur; Motorfader optional. HID erst, wenn Andreas' Gerät es verlangt.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Pickup-Übernahme (Ableton „Pick-Up“, Mixxx Soft Takeover) als Vorgabe | Wert bleibt hängen, wenn Andreas vom Wert weg dreht | 09 §3.6, Probe b |
| Sprung-Übernahme | Sprung 0,21 am Griff-Sample | 09 §3.6 |
| Controller über Node (`@julusian/midi`) | ohne Sample-Stempel; Weck-Streuung | 06 §3.1, Probe a Strom 4 |
| HID sofort | `hidapi` fehlt, Gerät unbekannt | 09 §3.7 |

## Folgen

- USB-Abfrage und Zittern echter Potis sind ungemessen (M17).
- Die Belegung ist ein Vorschlag, bis das Gerät bekannt ist; die Mechanik hängt nicht daran.

## Beleg

09 §3.6, §3.7, Probe b (Übernahme-Modi), Probe c (1024: 21,318 ms, Spanne 0,035 ms; 256: 5,32 ms, Spanne 0,041 ms;
300 von 300), NP c (5,326 ms, Spanne 0,060 ms), K3, K4; Mixxx `softtakeover.h:20` (Schwelle 3/128),
`softtakeover.cpp:70`; entwurf-spiel §3.1 (Belegung).

## Kippt, wenn

Andreas' Gerät ist HID-only (dann `hidapi` installieren, mit seinem Ja, und eine HID-Brücke als eigener Prozess mit
Zeitstempel) oder zittert stärker als 3/128.
