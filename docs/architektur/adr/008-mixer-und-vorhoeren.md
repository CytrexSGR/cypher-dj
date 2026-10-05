# ADR 008: Mixer, Vorhören, Mess-Abgriff und Aufnahme

- **Status:** angenommen; Cue am echten Interface vorläufig (M1); Hörschein-Schwellen vorläufig (M18)
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A4, A5, A6, A11, A15, A17, A21
- **Hängt zusammen mit:** ADR 003, 012, 016, 023

## Kontext

A4: „für die KI gemessen, für Andreas Vorhören auf einem zweiten Ausgang“. A5: EQ zum Tauschen, nicht nur Filter.
Latenzausgleich zwischen parallelen Wegen gibt es nur innerhalb eines Programms (Carla gleicht nicht aus, 04 §3.1).
Der Entwurf „Robustheit“ ließ KI-Messung und Andreas' Cue denselben Abgriff teilen; „KI“ trennt sie. „Robustheit“
nimmt an den Notbahn-Ausgängen auf, „KI“ und „Spiel“ im Kern.

## Entscheidung

1. **Mixer im Kern, eigener Code** (Faust für feste DSP-Blöcke, C++ für alles, was die Uhr kennt):
   Kanalzug je Deck, Erzeuger-Kanal, Pad und Gruppenbus: Trim (beim Laden `ziel_lufs` − LUFS der Fassung, −24 bis
   +24 dB) → **LR8-Isolator 246/2484 Hz** mit Kill (Rampen zweiter Ordnung 5 ms) → TPT-Filter an einem Regler (20 ms
   geglättet) → **PFL-Abgriff und Mess-Abgriff** → Kanalfader → Crossfader-Zuweisung (Mixxx-Kurven) → vier Sends nach
   dem Fader → **Ziel** Master oder einer von vier Gruppenbussen (A17; Zuweisungstabelle statt fester Pfade,
   `SCHNITTSTELLEN.md` §1.5).
2. **Master:** Summe → FX-Rückwege (beatsynchrones Echo als Mischform mit zwei Leseköpfen aus der Uhr, Hall als
   Faust-Block) → Limiter mit Vorhalt (Faust `co.limiter_lad_stereo`, ungemessen) → Riegel (NaN, DC, Clip).
3. **Cue** auf Ausgang 3/4 desselben Interfaces: PFL nach EQ und Filter, vor dem Fader; um den Limiter-Vorhalt
   verzögert (laufzeitgleich zum Master); Kopfhörer-Mix Cue gegen Master und Split wie Mixxx. Durch dieselbe
   Notbahn wie der Master.
4. **Mess-Abgriff getrennt vom Cue:** an derselben Stelle (nach EQ, vor Fader) läuft für **jeden** Kanal immer ein
   Messer (Spitze, Echtspitze, LUFS M/S über libebur128, Bandpegel, Hüllkurven der **sechs Analyse-Bänder** Sub bis
   Hoch mit 1 kHz in den Ring für die Analyse, `SCHNITTSTELLEN.md` §6.2; dieselben Filter rechnet die Werkstatt für die
   Referenz). Cyphers Hörscheine entstehen nur dort; Andreas' Kopfhörer bleibt seiner. Die Taste **„Cypher hören“**
   legt Cyphers vorgeschlagenen Kanal bewusst auf Andreas' PFL.
5. **Neue Quellen starten stumm:** jeder Kanal (Deck, Erzeuger, Pad, Wirt-Rückweg) steht nach Laden oder Anlegen
   auf −200 dB; ein Plan darf ihn nur mit gültigem Hörschein hörbar machen (Invariante I3, ADR 023).
6. **Aufnahme** in eigener Unit an den **Notbahn-Ausgängen** (was wirklich klingt, auch Notbahn-Schleifen), mit dem
   Kern-Sample des ersten Frames.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Faust-Standard LR4 als Isolator | Mitten-Kill nur 34,4 dB, verfehlt „Kill > 40 dB“ | 04 §4.1 |
| Butterworth-Weiche | Summe +2,94 dB an den Grenzen | 04 §4.1 |
| EQ als Plugin (a-EQ) | kehrt nach „0“ nicht bitgenau zurück (−0,04 dB, Glättung stoppt 0,05 dB vor dem Ziel) | 05 §4.1 |
| hart umgeschaltetes Delay | knackt in 160 von 160 Blöcken der Rampe (−39,9 dBFS) | 04 §4.3 |
| KI misst am Cue-Abgriff | Cypher würde Andreas' Kopfhörer belegen oder warten müssen; A4 trennt „gemessen“ und „Vorhören“ | A4 wörtlich; Richter 3 |
| Aufnahme im Kern-Ring | nimmt vor der Notbahn auf: Notbahn-Schleifen und Nahtfehler fehlen in der Aufnahme | Richter 3 zu „KI“ |
| `pw-record` als Aufnahme | verlor unter Last ganze Blöcke | 01 §4.4, 02 Risiko 5 |

## Folgen

- Isolator-Grenzen 246/2484 Hz sind Mixxx-Vorgabe, ein Parameter; ob sie zu Andreas' Gewohnheit passen, stellt er
  live ein.
- Kreuzenergien der Vorhersage müssen mit genau diesen Filtern gerechnet werden (ADR 012).
- Split halbiert das Vorhören auf Mono je Ohr; nur Notweg.
- Mess-Abgriff kostet Rechenzeit je Kanal; gerechnet unter 2 % des 256er-Budgets für vier Decks plus vier Effekte.

## Beleg

04 §3.1 (Graph, Mixxx `enginemixer.cpp` 394 bis 405, 830 bis 840), §4.1 (LR8 Mitten-Kill 74,6 dB, −12 dB eingestellt
= −11,995 dB, neutral 0,0000 dB), §4.2 (Kill-Rampe zweiter Ordnung 5 ms: −97,68 statt −60,38 dBFS), §4.3 bis 4.5
(Mischform mit S-Ecken −144,51 dBFS), §4.6 (TPT-Filter geglättet −102,26 dBFS), §4.7 (libebur128 −22,993 LUFS bei Soll
−23,0), §4.8 (LR8 5,4 bis 10,9 µs je Kanal und Block); 01 §4.4. Alle 04-Zahlen offline, Dossier 04 ungeprüft.

## Kippt, wenn

Andreas im Hörtermin andere EQ-Kennlinien oder Grenzen will (Parameter, keine Architektur); M1 zeigt, dass das
Interface nur zwei Ausgänge hat (dann Split bis zum neuen Gerät).
