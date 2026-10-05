# ADR 017: Rolle von Strudel

- **Status:** angenommen
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A22, A21, A25
- **Hängt zusammen mit:** ADR 010, 018

## Kontext

Bisher war Strudel im Browser das Herz: Muster, Zeitplanung (Cyclist, `cps` als Uhr) und Klang (superdough).
Andreas fragte: „eigentlich ist doch der kern die schnelle musik, bzw midi noten generierung, oder?“ (A22). Gemessen
2026-09-22: der Strudel-Kern läuft in Node ohne Browser, 1 000 Takte, 7 000 Ereignisse, 44 ms.

## Entscheidung

Strudel bleibt **die Funktion „Muster zu Ereignissen“**: `@strudel/core` und `@strudel/mini` 1.2.6, nur
`pattern.queryArc(a, b)`, in der Erzeuger-Unit (ADR 010). Nicht mehr: Strudels Scheduler (Cyclist), Strudels Uhr
(`cps`), superdough als Klang, der Browser als Laufzeit. Ein Zyklus ist ein Takt; Beat = 4 · Zyklus. Die Mini-Notation
ist die Inhaltssprache im Spielzettel. Strudel wird unverändert als eigener Prozess benutzt (AGPL, kein Fork
weitergeben).

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Strudel als Scheduler (Cyclist) | 0,1 s Latenz, Vorschau rund 0,2 s, `setPattern` ersetzt sofort ohne Raster | 06 §3.1 (`cyclist.mjs:17`, `:123-124`) |
| `cps` als Uhr | fällt mit dem Browser; kennt keine Rampe im Kern | 02 §3.1 E |
| Strudels `stretch` als Keylock | 110-Hz-Sonde bleibt bei 105,5 Hz | 00-anforderungen §10 |
| pattrns (Renoise) als zweite Mustersprache | zweite Sprache ohne Gewinn, „experimental“ | 06 §3.1 |

## Folgen

- Muster, die Andreas oder Cypher im Spielzettel schreiben, klingen über Kern-Kanäle (SunVox-Wirt, Pads, später
  Plugins), mit Kanalzug und Hörschein.
- Strudels OSC-Weg (WebSocket an einen Hilfsserver mit Wanduhr-Zeitmarke) wird nicht benutzt.

## Beleg

06 §3.1, Probe a (Abfrage je Zwei-Takt-Fenster median 146 µs), §4.3; 02 §3.1; A22 mit Messung vom 2026-09-22
(00-anforderungen §7).

## Kippt, wenn

Nie grundsätzlich; nur die Mini-Notation als Inhaltssprache könnte wechseln, wenn Cypher sie im Spielzettel schlecht
schreibt (Messung im Plan von Scheibe 7).
