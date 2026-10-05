# ADR 021: Grundlage der Synthese und Reihenfolge der Scheiben

- **Status:** angenommen
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A1, A2, A3, A13, A26
- **Hängt zusammen mit:** alle; ARCHITEKTUR §1, §9

## Kontext

Drei Entwürfe (Robustheit, Spielbarkeit, KI-Mitspiel) wurden von drei Richtern bewertet. Sie widersprechen sich:
Richter 1 wählt „KI“ als Sieger, Richter 2 „Spiel“ als Grundlage (aus DJ-Sicht, bei eigener Summe knapp hinter KI),
Richter 3 „Robust“ als Unterbau (Live-Sicherheit und Machbarkeit doppelt gewichtet). Die gewichteten Summen aller drei
Richter stellen „KI“ vorn: 70,75 / 69 / 68,25 gegen „Robust“ 67,5 / 68,25 / 66,75 und „Spiel“ 62 / 64,75 / 64,25. Die
drei Entwürfe schlagen verschiedene erste Scheiben vor: „KI“ die ganze KI-Schleife stumm, „Spiel“ Andreas' zwei Decks,
„Robust“ ein Deck, das nicht verstummt. Die Richter nennen gemeinsame Schwächen: der Kern ruht auf ungeprüften Dossiers
(01, 03), R3 in Arbeits-Threads ist nirgends in Echtzeit gemessen, die Werkstatt-Daten sind veraltet (achter
MiniMax-Song), Ende-zu-Ende-Generierung ungemessen, die Wahl nur als Text gemessen, kein Hörtermin terminiert, keine
Streichliste, Aufwände ungeeicht.

## Entscheidung

1. **Grundlage ist „KI-Mitspiel zuerst“**, weil sie bei allen drei Richtern die höchste gewichtete Summe hat und das
   Kernziel A1/A2/A13 sowie das doppelt gewichtete A4 am genauesten trägt. Die Übernahmelisten der drei Richter sind
   deckungsgleich: **Kern und Betrieb aus „Robust“, Deck und Hand aus „Spiel“, KI-Schicht aus „KI“**. Damit hängt das
   Ergebnis nicht an der Wahl der Grundlage, nur die Reihenfolge der Scheiben.
2. **Reihenfolge der Scheiben** (ARCHITEKTUR §9.2):
   - **Scheibe 0, Vorbedingungen (stumm, parallel):** M3 (R3 in Arbeits-Threads als JACK-Client), M13 (Raster der
     MiniMax-Songs, auch `sofa-abend`), M15 (Wahl als Werkzeugaufruf, 30 min Simulation), M2 (Naht), M10 wenn ruhig,
     M14 wenn die GPU-Maschine frei ist, M1 sobald Gerät und Ja da sind. Grund: Richter 3 („keiner macht die Deck-Echtzeitprobe
     zur Vorbedingung“), Richter 1 und 2 (Raster, Wahl, Generierung ungemessen).
   - **Scheibe 1, drei Werkstücke parallel nach einem kurzen gemeinsamen Vorlauf:** zuerst **V0** (ein Eigentümer,
     rund ein halber Session-Tag): Proben-Vorlagen ins Repo, `djk/third_party/`, maschinenlesbarer Vertrag
     `djk/vertrag/` mit Golden-Folgen, Test-Handeingang und Ring-Attrappe (`SCHNITTSTELLEN.md` §19.0). Dann Kern (mit
     Notbahn, Direktweg-Decks, Chaos-Prüfstand v1), Leitstand mit MCP und Spieler gegen eine **Kern-Attrappe**,
     Werkstatt-Kette v1. Grund: Parallelität ist Andreas' Motor; der Vertrag macht sie möglich, aber nur, wenn es
     genau eine maschinenlesbare Wahrheit gibt (zwei Sessions, die `djk/vertrag/` je selbst erzeugen, liefern zwei).
   - **Scheibe 2:** Cypher wählt, der Code rechnet, stumm, mit den Angriffsfällen aus 09 NP als Regression.
   - **Scheibe 3, Hand und Ohr:** Controller, Interface (M1), Andreas spielt allein, **Hörtermin M18**, bevor die
     teuren Keylock-Teile gebaut werden. Grund: Richter 2 („die größte ungemessene Größe ist Andreas' Ohr und Hand“)
     und die gemeinsame Schwäche „kein Hörtermin“.
   - **Scheibe 4, erster gemeinsamer Ton bei festen 128 im Direktweg**, mit einem bei Set-Beginn bestellten Song, der
     während des Sets durch die Werkstatt kommt. Grund: der Direktweg braucht keinen Stretcher (ADR 020), damit wird
     der gemeinsame Ton unabhängig vom riskantesten Baustein; A2 wird vor Keylock-live getragen (Richter 1 und 2: A2
     kam in allen Entwürfen zu spät).
   - **Scheibe 5:** Tempo und Keylock live. Danach Werkstatt im Set (6), eigene Spur (7), Plugins (8), Außenwelt und
     Oberfläche (9).
3. **Streichliste** je Scheibe (ARCHITEKTUR §9.3); nie gestrichen: Invarianten I1 bis I3, Frist-Wächter,
   Hörschein-Pflicht, Stopp-Taste, Notbahn.
4. **Aufwand** in Session-Tagen (eine Session, ein Arbeitstag), Schätzung, ungeeicht; kritischer Weg bis Scheibe 4
   rund 16,5 Session-Tage bei drei parallelen Sessions, V0 eingerechnet (gerechnet aus ARCHITEKTUR §8.1).

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| „Spiel“ als Grundlage, Andreas' Decks zuerst | teuerster Weg zum gemeinsamen Ton (rund 30 Session-Tage), viele ungemessene Neuerungen im Echtzeit-Pfad; sein Vorteil (frühes Ohr) ist hier durch Scheibe 3 übernommen | Richter 1, 3 |
| „Robust“ als Grundlage, Robustheit zuerst | A2/A13 erst nach dem gemeinsamen Ton, zweite Hälfte von A12 fehlt, KI-Mitspiel dünn; seine Stärken (Prüfstand, kein Fremdcode) sind übernommen | Richter 1, 2 |
| „KI“-Scheiben unverändert | Scheibe 3 dort bündelt Interface, R3 in Threads, Rampen, Notbahn, Units, Aufnahme, Hardware in 6 Tage (optimistisch); Andreas hört erst spät | Richter 1, 3 |
| Keylock-live vor dem gemeinsamen Ton | macht den gemeinsamen Ton vom ungemessenen R3-Echtzeitweg abhängig | ADR 020, M3 |

## Folgen

- Bis Scheibe 5 läuft das Set bei festem Tempo (Basis 128 oder eine andere feste Basis); A9 ist bis dahin nur als
  „ein festes Set-Tempo“ getragen und so im Journal vermerkt.
- Die Kern-Attrappe ist ein eigenes Werkstück: sie spricht den Vertrag, simuliert Uhr und Quittungen, ohne Ton.
- Der Hörtermin braucht Andreas' Zeit und Ja (Frage 3 in ARCHITEKTUR §13).
- **Vorlagen sichern vor dem Start:** keine Datei unter `proben/` ist in git (gemessen 2026-09-23: `git ls-files proben`
  → 0, `du -sh proben` 18 GB); `vendor/` in 03 und 04 ist per `.gitignore` ausgeschlossen, `*.log` per Wurzel-`.gitignore`
  (die Beleg-Logs wie `c_drift.log` brauchen eine Ausnahme). Eine Session im Worktree oder ein frischer Klon sähe weder
  Vorlagen noch Belege. V0 committet Code und Ergebnisdateien der Proben (ohne WAV, venv, vendor, Rohaufnahmen);
  die Pläne nennen Vorlagen nur mit Repo-Pfad.
- **Abnahmen messbar:** jede Abnahme nennt Lastprofil, Dauer, Quantum, Fremdlast-Protokoll und Wiederholungsregel
  (ARCHITEKTUR §9.2); Läufe unter Fremdlast gelten als vorläufig und kommen in M10 noch einmal.

## Beleg

Richter-Bewertungen (Summen, Sieger-Begründungen, Übernahmelisten, gemeinsame Schwächen), im Synthese-Auftrag
mitgegeben; Entwürfe `entwuerfe/entwurf-ki.md` §5, `entwurf-robust.md` §5, `entwurf-spiel.md` §5; ADR 020.

## Kippt, wenn

M3 scheitert (dann Keylock live später, der Direktweg trägt trotzdem Scheibe 4), M13 scheitert (dann Raster von Hand
als Pflicht in Scheibe 4), oder Andreas will eine andere Reihenfolge (seine Richtung).
