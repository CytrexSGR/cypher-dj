# ADR 022: Generierung frischer Songs mit Vorlauf

- **Status:** vorläufig, Messung M14 (Ende zu Ende) steht aus
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A2, A13, A19
- **Hängt zusammen mit:** ADR 011, 013, 015

## Kontext

A2: „wenn wir parallel songs generieren möchte ich die im laufenden betrieb mit dir zerlegen und flüssig in ein
laufendes set einbinden können.“ Alle drei Entwürfe führten die Generierzeit als ungemessen und sorgten sich um den
Grafikspeicher der DJ-Maschine (12 282 MiB, bis 11 218 fremd belegt). Nicht gelesen hatten sie: MiniMax Music 3 läuft auf der
GPU-Maschine (ComfyUI-Instanz `:8288`, GB10 mit gemeinsamem Speicher). Dort kostet ein Lauf heute 4,7 bis 7,2 s Rechenzeit je
Sekunde Musik (Streuung durch 28 parallel laufende Dienste), Modell laden 65 bis 80 s warm und 284 s kalt; eine
gemietete L40S schafft 1,35-fache Echtzeit. Das sind Betriebs-Befunde aus dem Skill `cypher-musik` bzw.
`cypher-musik-mietgpu`, dort ausdrücklich nicht als Hardware-Befund ausgewiesen und heute nicht nachgemessen.

## Entscheidung

1. **Generierung auf der GPU-Maschine** über ComfyUI (MiniMax Music 3), angestoßen von der Werkstatt (`auftrag` Art
   `generieren`); Ergebnis per HTTP nach DJ-Maschine, dann Werkstatt-Kette (ADR 011). Die GPU der DJ-Maschine bleibt für Stems.
   Adresse und Workflow in der Werkstatt-Konfiguration; Prompt-Form nach Skill `cypher-musik` (Dauer 40 bis 50 %
   über der Ziellänge, Text für die volle Länge, Ziel-BPM nahe der Set-Basis). **Ob MiniMax ein Ziel-BPM trifft, ist
   ungemessen** (M14 misst BPM-Treue gegen den Prompt); der Skill rät von exakten BPM ab (Z. 59), und die zehn
   vorhandenen Songs liegen bei 89,9 bis 180,7 BPM (c_drift.log), also Streckfaktoren 0,71 bis 1,42 zur Basis 128.
2. **Die Kiste ist eine Warteschlange mit Vorlauf.** „Während des Sets generieren“ heißt: bestellen, wenn ein Song in
   rund 15 bis 30 Minuten gebraucht wird (Generierung 14 bis 22 min Rechnen plus Laden für 3 Minuten Musik,
   Werkstatt gerechnet 1 bis 5 min). Der Leitstand zeigt je Auftrag die erwartete Fertigzeit in Takten; Cypher
   (Werkzeug `erzeuge`, Autonomie ab Stufe 1 erlaubt, weil nichts hörbar wird) oder Andreas bestellen.
3. **Mehrere Seeds in einem Prozess** (Modell nur einmal laden), wenn mehr als ein Song bestellt ist.
4. **Gemietete GPU** als Option, wenn Andreas im Set schnellere Songs will (1,35-fache Echtzeit: ein 3-Minuten-Song
   rund 4 min); Kosten und Einrichtung sind seine Entscheidung (Skill `cypher-musik-mietgpu`).
5. Die GPU-Maschine ist geteilt; parallele Nutzung durch andere Wellen wird über die Wellen-Koordination abgestimmt, nicht im
   Set.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Generierung auf der DJ-Maschine-GPU | 12 GB Grafikspeicher, bei laufendem Training rund 1 GB frei; nicht der heutige MiniMax-Weg | Recherche §3c; 10 §3a |
| „live“ als Sekunden-Takt planen | Generierung dauert Minuten; das Set würde warten | Skill `cypher-musik` |
| ACE-Step Turbo statt MiniMax | unter 10 s je Song (Herstellerangabe), aber anderes Modell, Klang ungeprüft | Recherche §3c |

## Folgen

- A2 ist mit Vorlauf getragen, nicht mit Sekunden; das steht so in der Kurzfassung.
- M14 misst die ganze Kette mit freier und belegter GPU-Maschine und schreibt die Zahl in die Kiste-Planung.
- Songs, die ein Werkstatt-Tor reißen (schwacher Puls, Raster, Streckfaktor über ±15 %), gehen nur an Andreas (ADR 011);
  von den zehn vorhandenen MiniMax-Songs träfe das nach c_drift acht über die Pulsklarheit und sieben über den
  Streckfaktor (gerechnet). Trifft MiniMax das Ziel-BPM nicht, bleibt A2 für Cypher dünn, bis M14 und M19 es klären.

## Beleg

Skill `cypher-musik` (intern) Abschnitt „Die Zahlen, mit denen du planst“ (sechsfache Echtzeit, 4,7 bis
7,2 s je Sekunde Musik, Modell laden 65 bis 80 s warm, 284 s kalt, 28 Dienste auf einer GPU) und Abschnitt zur
ComfyUI-Instanz `GPU-Maschine:8288`; Skill `cypher-musik-mietgpu` (intern) Zeile 8 (GPU-Maschine 7,0-fache, L40S
1,35-fache Echtzeit); Recherche §3c; 07 `c_drift.log` (Pulsklarheit).

## Kippt, wenn

M14 zeigt deutlich kürzere oder längere Zeiten (dann Vorlauf anpassen) oder Andreas will Generierung im Sekundentakt
(dann anderes Modell, eigene Prüfung).
