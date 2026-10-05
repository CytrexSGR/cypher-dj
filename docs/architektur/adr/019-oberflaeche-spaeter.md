# ADR 019: Oberfläche später

- **Status:** angenommen
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A24, A25, A1, A4
- **Hängt zusammen mit:** ADR 001, 013, 014, 018

## Kontext

A24: „mir sind aktuell oberfläche egal. das können wir nachziehen, oder integrieren was es gibt jeweils.“ Trotzdem
braucht A1 einen Sichtkanal für Cyphers Vorschläge (09 NP „Was fehlt“: ohne Sichtbarkeit ist „Vorschlagen“ nicht
umsetzbar) und A4 hilft mit Pegelanzeigen („also helfen die pegelanzeigen schon mal bisschen“).

## Entscheidung

1. **Vor jeder Oberfläche** tragen drei Minimalkanäle: **LEDs am Controller** (ADR 014), eine **Ansage-Zeile** im
   Terminal (liest den Leitstand-WebSocket, zeigt je Ereignis einen Satz mit Takt: Cyphers nächster Plan, offene
   Vorschläge, Rückfall, Notbahn, Pegel-Ampel je Deck) und den **Spielzettel** als Text.
2. **Die Oberfläche kommt später** als eigener Prozess, der nur den Leitstand-WebSocket liest und Befehle an den
   Leitstand schickt, nie an den Kern und nie im Audiopfad. Ob Browser-Seite oder eigene App, entscheidet sich dann;
   Inhalt wie im Entwurf „Spielbarkeit“ (Phrasen, Restzeit, Bandpegel, Ampel, Halter, laufender Plan, Tracker-Ansicht).
3. Eine abgestürzte Oberfläche nimmt nichts Hörbares mit.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Oberfläche zuerst | A24 stellt sie zurück; die Architektur-Risiken liegen im Audiopfad | A24 |
| JUCE-GUI im Kernprozess | ein Adressraum: GUI-Absturz nimmt den Ton mit; AGPL | 01 §3.7 |
| gar kein Sichtkanal bis zur Oberfläche | Vorschlagen wäre nicht umsetzbar | 09 NP „Was fehlt“ |

## Folgen

- Alles, was eine spätere Oberfläche braucht, steht schon im Leitstand-Strom (`SCHNITTSTELLEN.md` §9).
- Der Hörschein ersetzt für Cypher die Pegelanzeige; Andreas bekommt die Ampel je Deck über LEDs und Ansage-Zeile.

## Beleg

01 §3.7, §3.9; 09 NP „Was fehlt“; Recherche §5 („Sichtbarer Plan“, ReaLJam).

## Kippt, wenn

Andreas im Set eine Anzeige vermisst: dann zieht die Oberfläche nach vorn, ohne Architekturänderung.
