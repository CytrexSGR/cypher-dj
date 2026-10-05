# ADR 007: Deck-Grammatik

- **Status:** angenommen (Handlatenz auf dem Stretcher-Weg vorläufig, M3; Roll-Puffer nach M6)
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A14, A9, A1
- **Hängt zusammen mit:** ADR 020, 005, 014, 023

## Kontext

A14: „wir werden viel loopen, auch mal springen ggf live“; Beatloop, Loop-Roll (Track läuft weiter), Beatjump,
Hotcues, quantisiert. Mixxx hat die Grammatik, aber nicht herauslösbar; sein Muster ist in 03 §3.2 gelesen.
Zwei Mixxx-Lücken: der Schattenkopf zählt mit der Rate vom Einschalten, Sprünge gehen „sofort“ statt „auf Schlag X“.
02 NP K9/K10: ein Handsprung mit Keylock braucht Vorlauf oder einen vorgefüllten zweiten Stretcher; DJs erwarten
„sofort phasentreu“.

## Entscheidung

1. **Eigenbau nach Mixxx-Muster:** ein „Band“ vor dem Stretcher führt Loop, Band-Roll mit Schatten, Beatjump,
   Hotcue und Stem-Mix auf das Sample genau aus; Sprünge überblenden im Band (128 Frames), der Stretcher wird nicht
   zurückgesetzt. Der Schatten läuft auf dem Band mit (ein Bandframe je gelesenem Frame), unabhängig vom Tempo.
2. **Jeder Befehl trägt einen Ziel-Beat.** Beatloop 1/32 Schlag bis 32 Takte (Start: an `ab_beat`), halbieren,
   verdoppeln; Beatjump ±1/32 bis 128 Beats, im aktiven Loop verschiebt er den Loop (Mixxx-Vorgabe, Andreas kann
   kippen); 8 Hotcues je Deck, phasentreu (Ziel = Hotcue-Position plus Phase im Schlag); CDJ-Cue; Slip-Schalter.
3. **Hand-Quantize je Hörweg:**
   - **Direktweg:** Hand-Griffe wirken „sofort phasentreu“ eine Periode nach dem MIDI-Ereignis, oder mit
     Quantize auf dem nächsten Rasterpunkt der gewählten Größe.
   - **Stretcher-Weg:** der Griff landet auf dem **nächsten erreichbaren Rasterpunkt**, der mindestens
     Arbeitsvorlauf plus Bandvorlauf entfernt ist (gerechnet rund 102 ms bei 256 mit R3); ohne Quantize rund 125 ms
     nach dem Griff. Eine vorgefüllte „Sprungmaschine“ kommt nur, wenn M2b und der Hörtermin sie verlangen.
4. **Roll:** im Direktweg Band-Roll mit Schatten (gemessen). Auf dem Stretcher-Weg ab Scheibe 5 **Roll-Puffer
   hinter dem Keylock** im Kanalzug (Wiederholung aus dem schon gerechneten Ausgang, Deck läuft unhörbar weiter),
   derselbe Code als Beat-Repeat für Erzeuger- und Pad-Kanäle; erst nach M6.
5. **Für Cypher** sind Deck-Griffe diskrete Planteile im Stellwerk (mit `plan`, `gruppe`, `hoerschein`,
   `SCHNITTSTELLEN.md` §4.4); ein Deck, das Andreas in den letzten 8 Takten berührt hat (Halter „diskret“), springt
   oder loopt Cypher nicht, er schlägt nur vor (Grund `deck_beruehrt`). Ein Sprung oder Hotcue von Cypher auf einem
   **offenen** Deck bringt neuen Inhalt auf den Master und braucht ein Ziel im gemessenen Bereich eines gültigen
   Hörscheins oder Andreas' Annahme (I3d, ADR 023); sonst wird er Vorschlag. Loop und Roll sind frei.
6. **Raster von Hand:** Nudge per Encoder als Ankerverschiebung in Schritten von 0,5 ms mit 128-Frame-Blende, Tap
   im Vorhören, **Umschalt plus Tap setzt die Takt-Eins** (A13); alles erzeugt eine Korrektur je Abschnitt
   (`/e/raster`), die der Leitstand in `korrekturen.jsonl` schreibt und aus der die Werkstatt eine **neue Fassung**
   rendert (ADR 015); die geladene Fassung ändert sich nie.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Mixxx als Deck-Motor | Uhr gehört Mixxx; Skript-Timer ≥ 20 ms | A14, 09 §3.3 |
| Mixxx-Schatten mit Rate vom Einschalten | Tempowechsel mitten im Roll: −1 322,62 Frames = −27,6 ms | 03 §3.3, §4d |
| Sprung „sofort“ ohne Ziel-Beat für Cypher | KI verliert Planbarkeit | 03 §3.3 |
| Sprungmaschine von Anfang an | größte Zustandsmaschine im Echtzeit-Pfad, ungemessen; quantisierte Griffe landen ohne sie exakt | Richter 3 zu „Spielbarkeit“; 02 NP K9 |
| Stretcher bei jedem Sprung zurücksetzen | Polster plus Verzögerung 85,3 ms bei R3 | 02 Probe c, NP K9 |

## Folgen

- Handsprünge ohne Quantize während einer Tempoabweichung sind rund 125 ms spät (gerechnet); im Normalfall
  (Direktweg, 128) eine Periode.
- Die Rückkehr-Position nach einem Roll ist auf dem Band exakt (0,0 Frames) und klanglich bei R3 deckungsgleich
  (Kick-Einsatz −0,00 Samples); Bungee und Signalsmith streuen 1,5 ms.

## Beleg

03 §3.2 (Mixxx-Stellen), §3.3, §4d (Band 0,0 Frames; naiver Roll −150 447,76 Frames = −7 Schläge; Beatjump +4 exakt),
§4a (Bandvorlauf R3 3 884,9 Frames = 80,9 ms, Bungee 2 659,3 = 55,4 ms); 02 NP K9, K10; 08 NP K4 (Raster streut über
den Track 100 ms, Korrektur je Abschnitt nötig); 07 `c_drift.log` (Pulsklarheit MiniMax 0,03 bis 0,24); 09 NP „Was
fehlt“ (diskrete Planteile).

## Kippt, wenn

M3 zeigt, dass 4 Blöcke Vorlauf nicht reichen (Handlatenz steigt); Andreas empfindet im Hörtermin die Handsprünge
während Tempofahrten als zu träge (dann Sprungmaschine nach M2b); M6 zeigt, dass der Roll-Puffer in Rampen nicht
rastertreu ist.
