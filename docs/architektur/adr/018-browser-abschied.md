# ADR 018: Abschied vom Browser im Audiopfad

- **Status:** angenommen
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A25, A24, A3, A10
- **Hängt zusammen mit:** ADR 001, 017, 019

## Kontext

Der heutige Stand spielt über die Dirigent-Seite in Chromium mit superdough und Worklets; der laufende Plan
„Tonhöhe halten“ (`docs/superpowers/plans/2026-09-23-tonhoehe-halten.md`) baut Rubber Band als WASM-Worklet je Orbit
ein. A25 erlaubt ausdrücklich den Weg vom Browser in eine eigene App.

## Entscheidung

Der **Browser verlässt den Audiopfad.** Kein Klang, keine Uhr, keine Zeitplanung mehr im Browser. Eine Browser-Seite
darf später **reine Anzeige** sein, die nur den Leitstand-WebSocket liest (ADR 019). Der Plan „Tonhöhe halten“ ist ein
Übergang zum Hören und Vergleichen, kein Ziel; seine Befunde (Keylock-Klang, Doppelknoten) fließen als Messwerte ein.
Die heutigen Dienste mit `nohup` und PID-Dateien werden durch Units ersetzt, sobald der neue Kern ihre Rolle trägt;
bis dahin bleiben sie unberührt.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Browser mit eigener Web-Audio-Engine | Tode der Dirigent-Seite (dreimal am 2026-09-22), Renderer-Absturz lässt die Seite als offen gelten, Worklet lud einmal nicht, Faktor wechselte vor dem Ratenwechsel, Latenz hängt am Faktor, Chromium ist ein Pulse-Client mit eigenem Puffer | 01 §3.8 |
| node-web-audio-api als Kern ohne Browser | jeder Worklet hängt an einem JS-Thread: 669 Aussetzer in 60 s mit leerem Worklet, in der Nachprüfung 1 539 (die Zahl hängt an der Fremdlast, qualitativ bestätigt; der Render-Faden lief ohne Echtzeit-Priorität), 0 ohne Worklet | 01 §3.4, Probe b3, 01 NP (b Echtzeit, Punkt 5) |
| Rubber Band als WASM im Worklet dauerhaft | braucht vier Zusätze (M/S, HeapArray-Flicken gegen Ausfall nach rund 271 Faktorwechseln, ruhender Knoten, Kosinus-Blende); nativ entfallen sie | ERGEBNIS §1, §8 |

## Folgen

- Der Umstieg ist ein Neubau des Audiopfads, kein Umbau; die Scheiben in ARCHITEKTUR §9.2 bauen ihn.
- Alles Web-Audio-spezifische Wissen (Worklet-Flicken) wird nicht weiter gepflegt.
- node-web-audio-api bleibt nützlich für Offline-Rendern in der Werkbank, aber nur auf ruhiger Maschine: die
  „235-fache Echtzeit“ (01 §3.4) lief bei Last rund 3; bei Last 27 kam sie als 2,5-fach, WASM 1,8- bis 2,2-fach wieder
  (01 NP K7).

## Beleg

01 §3.4, §3.8, Probe b; ERGEBNIS §1, §4, §8; `docs/zwei-decks.md` (Dirigent überlebt den Tod seiner Seite).

## Kippt, wenn

Nie für den Audiopfad; für die Anzeige entscheidet ADR 019.
