# ADR 023: Stellwerk, Laufzeit-Invarianten und Frist-Wächter

- **Status:** angenommen (Rückfall-Loop und Hörbar-Schwelle vorläufig bis Scheibe 2 und M18); I2, I3 und „hörbar“
  nach der Kritik-Runde vom 2026-09-23 korrigiert (ARCHITEKTUR „Kritik und Korrekturen“)
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A1, A4, A6, A7, A14, A20
- **Hängt zusammen mit:** ADR 005, 008, 012, 013

## Kontext

Der Stellwerk-Prototyp (09) führt Pläne in Beats sample-genau aus, die Hand gewinnt je Regler, Verriegelung prüft
Hörscheine. Die Nachprüfung fand fünf Fehler, die heute falsch klingen würden: Sub doppelt nach einem Griff, weil
Pläne nie koppeln und die Sub-Regel nur beim Einreichen prüft (K1); leerer Master, wenn B am Start verriegelt wird
und A trotzdem ausblendet (K2); Sprung beim ersten Griff (K3); ein Rauschschritt bricht Cyphers Fahrt ab (K4);
überlappende Teile am selben Regler springen (K5). Außerdem trägt die Hörschein-Prüfung den Pegel nicht (K10), und
bei verpasster Frist fehlt ein Rückfall („Was fehlt“).

## Entscheidung

1. **Stellwerk zweigeteilt:** der **Leitstand** nimmt an und verriegelt (Form, Autonomie, zu spät, Regler beim
   Menschen, Überlappung, Hörschein, Budget), vergibt Kopplungen (Basstausch-Paare, „A raus“ an „B rein“) und reicht
   Teile mit Ziel-Beat ein. Das **Stellwerk-RT im Kern** führt aus: Regler-Tabelle mit Halter, Rampen und Setzen in
   Beats (umgerechnet je Block mit der gerade gültigen Tempo-Karte), diskrete Deck-Teile **mit Plan, Gruppe und
   Hörschein wie Regler-Teile** (sie fallen mit ihrer Gruppe), Hand-Schiedsrichter, Ist-Wert-Start ohne Sprung.
2. **Hand zuerst:** ein Griff setzt den Halter am selben Sample auf `mensch` und bricht nur diesen Regler und seine
   Gruppe ab (laufende und wartende Teile, aus jedem Plan). Übernahme skaliert oder relativ, erster Wert nur Stellung,
   Totzone 3/128 (ADR 014). Die Invarianten binden nie die Hand.
3. **Laufzeit-Invarianten im Kern**, geprüft vor jedem Teilstart, in jedem Zyklus, in dem ein Planteil einen
   betroffenen Regler bewegt, und nach jedem Handgriff (Definitionen: `SCHNITTSTELLEN.md` §17):
   - **I1 Sub nie doppelt:** ein Planteil, der einen zweiten Kanal „Tief offen“ machen würde, wird mit seiner Gruppe
     abgebrochen (`invariante sub_doppelt`).
   - **I2 Master nie leer:** ein Planteil oder ein Deck-Stopp aus einem Plan, der den letzten hörbaren Kanal
     unhörbar machen würde, hält am Ist-Wert bzw. wartet, bis ein anderer Kanal hörbar ist (`invariante
     master_leer`). Ein Deck ist nur hörbar, wenn es läuft: ein angehaltenes oder nie gestartetes B hält „A raus“
     an, statt als hörbar zu gelten (sonst endete genau der Fall 09 NP K2 wieder in Stille).
   - **I3 Neuer Inhalt nur mit Hörschein** (A4 wörtlich: „der dirigent darf nie etwas ungehört einspielen“; nicht
     nur „nie ungehört einblenden“): (a) ein Planteil, der einen geschlossenen Kanal öffnet, braucht einen gültigen
     Hörschein für Kanal und Inhalt (Material und Fassung), `beat ≤ gueltig_bis`, Tempo innerhalb ±0,5 % der Messung
     und, bei Decks, eine Quellposition im gemessenen Bereich; „offen“ zählt über Trim und Fader, nicht über
     Crossfader, Bus oder Master; (b) ein Schuss auf ein offenes Pad braucht einen Hörschein für diesen Schuss;
     (c) ein neues Muster auf einem offenen Erzeuger-Kanal spielt nur mit Hörschein für dieses Muster; (d) Cyphers
     Sprung oder Hotcue auf einem offenen Deck braucht ein gemessenes Ziel oder Andreas' Annahme. Sonst verriegelt
     (Formen: `SCHNITTSTELLEN.md` §17).
   - **I4 keine Überlappung** am selben Regler (auch innerhalb eines Plans).
4. **Frist-Wächter im Kern:** ist ein laufendes Deck der **einzige hörbare Kanal**, bleiben ihm weniger als 32 Beats
   (8 Takte) bis zum Ende seines Materials, und macht kein angenommener Teil einen anderen Kanal rechtzeitig hörbar,
   legt der Kern einen Loop über die letzten vollen 16 Beats (4 Takte) des Materials ab der Takt-Eins und meldet
   `rueckfall`. Jeder Griff oder Befehl an dieses Deck löst ihn; nur ein **ausgeführter** Deck-Stopp von Andreas
   unterbindet ihn (ein Plan-Stopp, der wegen I2 wartet, nicht). Weder ein
   toter Spieler noch ein toter Leitstand erzeugen Stille, und Andreas' normales Mischen (ein zweiter Kanal ist
   hörbar) löst ihn nie aus.
5. **Cypher-Stopp** im Kern (ADR 013), auch ohne Leitstand.
6. „Offen“ heißt: Trim plus Fader über −26 dB (für I3). „Hörbar“ heißt: effektiver Kanalpegel (Trim, Fader, Bus,
   Crossfader-Gewicht, Master) über −26 dB **und** bei Decks: das Deck läuft (für I1, I2, Frist-Wächter; linear 0,05,
   Schwelle aus 09 §6, gesetzt); „Tief offen“ heißt hörbar und Kill tief aus und EQ tief über −12 dB (gesetzt). Alles
   kalibriert M18.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Stellwerk ganz im Leitstand (JS) | schlechtester Block 7 053 µs | 09 NP b3 |
| Invarianten nur beim Einreichen | Griff an A-Bass vor dem Tausch: 15 Takte Sub doppelt | 09 NP K1 |
| Kopplung vom LLM erwarten | 0 von 105 Plänen setzen `gruppe` | 09 NP K1 |
| Hand bricht den ganzen Plan ab | Bass A geht nie aus | 09 Probe b `naiv_ganzer_plan` |
| Hand wirkt erst am Blockanfang | 224 Samples = 4,67 ms zu spät | 09 Probe b `naiv_block` |
| Rückfall im Leitstand | stirbt der Leitstand, gibt es keinen Rückfall | 09 NP K2, „Was fehlt“ |
| I3 nur für „unhörbar wird hörbar“ | neuer Inhalt auf einem schon hörbaren Kanal (Schuss, Muster, Sprung) und ein Fader hinter geschlossenem Crossfader erreichten den Master ohne Hörschein | Kritik-Runde 2026-09-23, 09 „Was fehlt“ (Hörschein bei einem Sprung auf einem hörbaren Deck) |
| „hörbar“ ohne „läuft“ | ein angehaltenes B galt als hörbar, I2 ließ „A raus“ laufen: Stille | Kritik-Runde 2026-09-23, 09 NP K2 |

## Folgen

- Invarianten können einen Übergang anhalten; das meldet der Kern, und der Leitstand fragt Cypher neu (Zug-Anlass).
- Die Schwellen sind gesetzt; falsche Schwellen machen Cypher zu vorsichtig oder lassen Flams durch.
- Regressionstests: die 12 Tests aus `stellwerk.test.mjs` und die Fälle a1 bis a5 aus `nachpruefung/angriff.mjs`
  müssen gegen den C++-Kern rot werden, wenn die jeweilige Regel fehlt, und grün mit ihr.

## Beleg

09 §3.3 (sechs Leitsätze), Probe b (Abbruch bei Sample 1 620 000, nur `A.gain`; Tempo 132 nach Annahme: Schaltpunkt auf
dem Takt, in Samples umgerechnet wäre er 170 ms zu spät), Probe b2 (Mutationen färben rot), NP K1 bis K5, K10, b3;
03 §4d (Loop auf dem Band, 0,0 Frames).

## Kippt, wenn

Scheibe 2 zeigt, dass I2 in echten Übergängen zu oft anhält (dann I2 nur für Pläne mit Quelle `cypher`); der
Rückfall-Loop klingt im Hörtermin falsch (andere Länge oder Ausblende statt Loop).
