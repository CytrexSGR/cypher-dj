# ADR 028: Decks folgen dem Live-Tempo (Varispeed sofort, Fassungstausch für die Tonhöhe)

Status: **teilweise abgelöst (2026-10-08):** der Fassungstausch (Slice 2, `deck_keylock.ts`, Render und `/k/deck/basis_tausch` aus der Seite) ist mit Keylock Task 3 ausgebaut; die Tonhöhe hält jetzt der Dehner im Kern (Plan `docs/superpowers/plans/2026-10-06-keylock-echtzeit.md`, Fassung 4; ADR 029 kommt mit Task 4). Varispeed (Slice 1) gilt weiter, bei Keylock aus. `/k/deck/basis_tausch` und `werkstatt.fassung` bleiben als Werkzeuge.
Früherer Status: Slice 1 (Varispeed) und Slice 2 (Fassungstausch) umgesetzt 2026-10-06; am Ziel abgenommen; Hörtermin 06.10.: Andreas „ja das passt“ (Varispeed hoch, beim Tausch zurück auf die Ausgangstonhöhe) (Cypher).
Anlass: Andreas 05.10.: „wir haben auch live tempo änderungen gemacht“ (Park-Item `e65c5c17`), 06.10.: „Flügel fertig, dann
Welle 3 mit writing-plans bitte“. Plan: `docs/superpowers/plans/2026-10-06-welle3-beatmatch.md`.

## Kontext

Bis Welle 2 lehnte der Kern einen Tempowechsel ab, solange ein Deck lief (`kern.cpp`, Quittung 6 `kein_stretcher`), und ein
Deck startete nur bei seiner Basis (`kern_deck.cpp`). Gemessen 06.10. an Prüfinstanz i: `POST /tempo 132` bei laufendem Deck →
`{"status":6,"grund":"kein_stretcher"}` (`~/messungen/2026-10-06-welle3-beatmatch/`). Loop-Boxen, REC und Strudel folgten dem
Tempo seit ADR 026/027, die Decks nicht. Die ROADMAP sah dafür Rubber Band R3 im Echtzeitweg je Deck vor (Scheiben 34, 50
bis 52); davor liegen vier offene Scheiben, und die Echtzeit-Messreihe M3 (Scheibe 30) wurde am 25.09. auf Andreas' Einspruch
angehalten („du blockiert meinen rechner“).

## Entscheidung

1. **Varispeed im Deck.** Das Deck kennt die Karte der Kern-Uhr und hält den Master-Beat seines Ankers. Lesekopf
   `kopf(s) = anker_f + (beat_at(s) − anker_b) · fpb`: ein Quell-Beat bleibt ein Master-Beat (phasenstarr, auch in Rampen),
   gelesen mit Catmull-Rom wie die Loop-Box (ADR 026). Steht das Tempo über den ganzen Block auf der Basis, liest das Deck
   ganzzahlig wie bisher (bitgleich). Wechsel direkt → Varispeed an derselben Stelle ohne Blende; Varispeed → direkt auf das
   nächste ganze Frame mit der 128er Blende (Rücken höchstens 0,5 Frame). `deck.cpp`, `deck.h`.
2. **Start und Rampe bei jedem Tempo.** Beide `kein_stretcher`-Ablehnungen entfallen (Kern und Attrappe). `/k/set/neu` bleibt
   bei laufendem Deck abgelehnt (`deck_laeuft`): eine neue Zeitachse bräche den Beat-Anker.
3. **Frist und Neustart über Beats.** `/e/frist` rechnet im Varispeed über den Beat-Anker; der Neustart-Zustand trug den Anker
   schon in Beats (`anker_master_beat`) und setzt ihn jetzt direkt (`setze_lauf_beat`).
4. **Tonhöhe über Fassungstausch:** die Werkstatt rendert aus dem Original eine Fassung im Zieltempo (`werkstatt.fassung`,
   höchstens zwei Zusatztempi je Track, nichts wird gelöscht), die Seite kopiert sie in den Arbeitsbestand und schickt
   `/k/deck/basis_tausch` (Quelle `werkstatt`) auf eine Takt-Eins frühestens einen Beat voraus und nie vor dem Ende einer
   laufenden Rampe (`deck_keylock.ts`). Der Kern lädt die Fassung über den Lader, tauscht am Ziel-Beat mit 960-Frame-Blende
   (der alte Kopf läuft darin mit seinem Varispeed-Schritt weiter) am selben Quell-Beat; ein Loop wird umgerechnet, das
   Raster der alten Fassung gilt nicht weiter. Danach liest das Deck direkt.

## Verworfen

| Weg | Warum nicht | Quelle |
|---|---|---|
| R3 live im Deck jetzt (Scheiben 50 bis 52) | vier offene Vorstufen; M3 pausiert auf Andreas' Einspruch; R3-fein im 256er Block bis 4458 µs bei 5333 µs Budget mit zwei Instanzen | Stand 30, ADR 027 „Verworfen“ |
| Decks weiter nur bei ihrer Basis | beantwortet die erste DJ-Frage nicht | Glanz-Programm Welle 3 |

## Folgen

- Bis zum Tausch wandert die Tonhöhe eines Decks: 128 → 132 +0,53 Halbtöne, 128 → 140 +1,55. Die Seite zeigt am Deck
  `VARI +0,5 st`.
- Klangtreue des Catmull-Rom-Wegs wie ADR 026 gerechnet, nicht gehört. Die alte Blende (128 Frames) liest im Varispeed weiter
  ganzzahlig: bei Faktor 1,03 weicht sie über ihre Länge um rund 4 Frames ab (gerechnet, in der Blende).
- Kosten: im Varispeed je Sample zwei `beat_at` und vier Frame-Lesungen je Deck; Echtzeit-Messung in Task 3 des Plans.

Messwerte: Plan-Abschnitt „Ergebnisse“, Rohdaten `~/messungen/2026-10-06-welle3-beatmatch/`.
