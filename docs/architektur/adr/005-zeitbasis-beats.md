# ADR 005: Zeitbasis der Befehle und Verspätung

- **Status:** angenommen
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A1, A14, A20, A21
- **Hängt zusammen mit:** ADR 004, 007, 023

## Kontext

Befehle kommen von Andreas' Hand, vom Leitstand (für Cypher und Andreas' Makros), von Erzeugern. Offen war, in
welcher Zeit sie reden und was mit Verspätetem passiert: 02 und 09 (Leitsatz 5) wollen verwerfen, 03 §3.4 auf den
nächsten Rasterschritt schieben, 02 NP K11 warnt, dass ein verworfener Fader gefährlich ist.

## Entscheidung

1. **Musikzeit ist der Beat** (`f64`, Viertel, Beat 0 = Set-Start, 1 Takt = 4 Beats, 1 Phrase = 8 Takte = 32
   Beats). Alle Prozesse außer der Hand schicken Befehle mit Ziel-Beat auf der Kern-Uhr. Nie Millisekunden, nie
   OSC-Zeitmarken, nie „jetzt“ aus der KI.
2. **Die Hand** kommt als JACK-MIDI mit Sample-Versatz und wirkt eine Periode nach dem Griff am richtigen Sample.
3. **Verspätung je Befehlsart** (Feld `politik` in jedem Befehl, `SCHNITTSTELLEN.md` §16):
   - `musik` (Erzeuger-Ereignisse, KI-Planteile, Deck-Starts aus Plänen): zu spät = **verworfen und gemeldet**;
   - `zustand` (Fader zu, Kill, Stopp, Ausblenden, Stopp-Taste): zu spät = **am nächsten Zyklus mit 10-ms-Rampe
     ausgeführt und gemeldet**;
   - `raster` (Deck-Griffe: Loop, Sprung, Hotcue aus einem Makro): zu spät = **auf den nächsten erreichbaren
     Rasterpunkt** der angegebenen Rastergröße gelegt und gemeldet.
4. **Quittung** für jeden Befehl: `angenommen`, `gestartet`, `fertig`, `verspaetet_verworfen`,
   `verspaetet_ausgefuehrt`, `abgelehnt` (mit Grund), `abgebrochen` (mit Grund), `storniert`.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Millisekunden oder Wanduhr | Tempoänderung nach dem Senden: bis 554 Samples (11,5 ms) daneben; ohne Stempel median 12 ms, bis 29 ms | 02 NP N1; 06 §4.1 Strom 4; 01 §4.3 („jetzt“ −2,42 bis +5,25 ms) |
| OSC-Bundle mit Zeitmarke | Verspätetes wird „immediately“ gespielt (OSC 1.0) | 02 §3.2 |
| immer verwerfen | ein 3 ms zu später Fader-zu würde verworfen | 02 NP K11, N2 |
| immer verspätet ausführen | Musik-Ereignisse kämen als Schwall | 06 §4.1 Lauf 4 (ohne Stempel 48 Ereignisse bis 5,78 s zu spät) |

## Folgen

- Planer müssen Vorlauf einhalten (`SCHNITTSTELLEN.md` §3): Regler-Teile mindestens 2 Zyklen, Deck-Griffe auf dem
  Stretcher-Weg mindestens Arbeitsvorlauf plus Bandvorlauf.
- „Genau oder gemeldet“ ist die Zusage des Kerns; ein Befehl klingt nie still an falscher Stelle.

## Beleg

02 Probe b, NP N1, N2 (Marge ab 4,58 ms 12 von 12 genau, darunter gemeldet, keiner an falscher Stelle), K10, K11;
06 Probe a (295 von 295 frame-genau mit Beat-Stempel); 01 Probe a3; 09 §3.3 Leitsätze.

## Kippt, wenn

Nie grundsätzlich; einzelne Politiken können sich nach Hörerfahrung ändern (Journal zeigt jede Verspätung).
