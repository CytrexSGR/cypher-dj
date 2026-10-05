# ADR 012: Fingerabdruck, Passung, Spielart, Live-Analyse, Lernen

- **Status:** angenommen; Hörschein-Schwellen und Faustregel gegen Optimierer vorläufig bis M18, Tief-Grenzen bis M20;
  nach der Kritik-Runde vom 2026-09-23 korrigiert (ARCHITEKTUR „Kritik und Korrekturen“)
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A4, A6, A7, A8, A15, A16, A20
- **Hängt zusammen mit:** ADR 008, 011, 013, 023

## Kontext

A16: Fingerabdruck je Material, Passung als Rechnung, Übergang als Plan über Zeit, Spielart als Parametersatz; was
Kunst bleibt, ist welcher Track, welche Spielart, welcher Moment; was einen guten Übergang vorhersagt, wird an
Andreas' Urteil gelernt. 08 baute Fingerabdruck, Passung und einen Optimierer; die Nachprüfung zeigt, dass die
einfache Faustregel den Sub weniger doppelt (08 NP K1) und dass die Live-Analyse ein falsches Raster nicht sieht
(K4).

## Entscheidung

1. **Fingerabdruck v1** beim Einlesen in der Werkstatt, in Beat-Zeit (Sechzehntel), Felder nach 08 §5 (`fa.py`):
   Lautheit (LUFS, Echtspitze, Crest, LUFS je Takt), sechs Bänder, Energieprofil, Anschläge je Band mit Stärke,
   Kick-Phase, Stimmung mit Richtungsschärfe R, Tonart (Camelot, Chroma, Vorsprung), Bass-Charakter, Gesangsanteil,
   Referenz-Hüllkurven, Kreuzenergien `C[b, j, j', s]` **mit den Mixer-Filtern** (LR8 246/2484 Hz).
2. **Stimmung und Tonart** nur aus tonalen Stems (Fläche, Bass) mit R ≥ 0,1 und zweitem Werkzeug (Essentia); Drum-Loops
   ohne Tonart. **Automatischer Stimmungsangleich beim Einlesen:** die Werkstatt zieht jedes einkommende Stück offline
   im selben R3-Lauf wie den Warp auf A = 440 Hz, nur unter 35 Cent Abweichung und bei Einigkeit beider Werkzeuge (auf
   10 Cent); sonst keine Korrektur, nur Warnung und Vorschlag (Vorgabe zu 08 Frage 1 „einkommende Stücke automatisch
   nachstimmen“, Andreas kann kippen). **Live gibt es keinen Tonhöhenweg:** im Direktweg liegt kein Stretcher, und der
   Vertrag hat keinen Tonhöhen-Regler je Deck; paarweises Angleichen live bräuchte je Paar eine eigene Fassung oder
   einen Stretcher im Hörweg. Tonhöhe der Korrektur ungemessen: M19.
3. **Passung** ist eine Rechnung im Rechner: Trim je Track, Phasen-Verschiebung, Überdeckung je Band, Anschläge unter
   30 ms, Tonart, Stimmung, Stretch-Kosten, Gesang doppelt.
4. **Spielart = Parametersatz, ausgeführt als Regel** (Faustregel mit Parametern: Länge, Verlauf, Einstieg,
   Rampe, Bass-Tausch-Takt, A-raus-Takt, Grenzen Sub/Tief, Pumpen), und zwar **genau die gemessene Regel** `saat()`
   aus `probe_b_uebergang.py` mit allen Reglern, Stützwerten und Formen (`SCHNITTSTELLEN.md` §14.4). Die
   **Vorhersage** über Kreuzenergien prüft jede Regel vor dem Einsatz: **verriegelnd nur gegen die Sub-Grenze**; die
   Tief-Grenzen melden bis M20 nur Warnungen, weil die gemessene Faustregel selbst darüber liegt (alle Bänder, 08 NP
   K1: „sicher“ Sub 0,082 bei Grenze 0,10, **Tief 0,402 bei 0,20**, Tiefmitte 0,951; „hart“ Sub 0,015 bei 0,25,
   **Tief 0,355 bei 0,35**, Tiefmitte 0,860). Mit den Vertragsgrenzen hätte der Rechner beide Standard-Spielarten am
   einzigen gemessenen Paar verriegelt. Der **Optimierer** bleibt Option, bis Andreas' A/B-Urteil
   ihn gegen die Regel gewinnen lässt (erste Frage im Hörtermin: `sicher_saat.wav` gegen `sicher_optimiert.wav`).
   Startwerte „sicher“ und „hart“ aus 08 §3.3.4 (gemessen), Genre-Spielarten als Startwerte (Vermutung).
5. **„Pumpen“** ist bis zu Andreas' Antwort 0 dB (A8 offen); die drei Lesarten (Gain, Bass betont, Sidechain aus der
   Uhr) sind als Parameter vorgesehen.
6. **Live-Analyse:** Blocktakt-DSP im Kern (sechs Analyse-Bänder als Hüllkurven mit 1 kHz, LUFS; `SCHNITTSTELLEN.md`
   §6.2, dieselben Filter wie die Referenz `huelle_1khz.npy`); Taktende-Auswertung in `cypherdj-analyse`:
   Bänder und Überdeckung je Band, **Versatz je Deck gegen seine Referenz** (prüft die Ausführung, Suchfenster ±200 ms,
   Band mit höchster Korrelation) **und Anschläge Deck gegen Deck im Tief-Band** (prüft das Raster). Kollisionen werden
   vorhergesagt und live nachgemessen (die Entscheidung „nur vorhersagen“ aus 08 §3.3.6 ist durch NP K4 wieder offen).
7. **Hörschein** eines vorgehörten Kanals nach 4 Takten Messung am Mess-Abgriff: Versatz gegen Referenz, Deck gegen
   Deck, LUFS kurz, Pegel gegen das laufende Deck, Bänder. Schwellen als Daten (vorläufig: Versatz ≤ 2,0 ms
   und Tempo ±0,5 % aus 09 §6, dort gesetzt; Deck gegen Deck ≤ 8 ms als Untergrenze des Flam-Bereichs aus 08 §3.3.2;
   Pegel ±3 dB nach Trim ohne Quelle gesetzt). Alle vier werden im Hörtermin M18 kalibriert.
8. **Lernen:** jedes Set ist Lernmenge (Passung, Planparameter, Messwerte je Takt, Urteile, Annahmen und Ablehnungen,
   Handgriffe in Cypher-Plänen); **Lernen durch Zusehen**: Andreas' eigene Übergänge liegen als Reglerkurven mit
   Sample-Stempel im Journal und werden zu Spielart-Parametern; **A/B-Paare nach dem Set**, nicht im Set; Modell
   L1-logistisch auf Merkmalsdifferenzen (Bradley-Terry), trainiert zwischen den Sets.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Optimierer als Standard | reißt seine eigene Sub-Grenze (0,135 bei Grenze 0,10); Faustregel 0,082. In den anderen Bändern ist der Optimierer besser (Tief 0,238 gegen 0,402, Tiefmitte 0,530 gegen 0,951, Lautheit 0,83 gegen 1,29 LU); welches Band zählt, entscheidet Andreas' Ohr (M18). Kostenvergleich misst mit der eigenen Zielfunktion | 08 NP K1 |
| nur Camelot (Mixed-In-Key-Logik) | gleiche Tonart, trotzdem 25 bis 34 Cent verstimmt (zwei Werkzeuge) | 08 §4.a, NP K3 |
| großes gelerntes Übergangsmodell (GAN) | Hörtest: kein signifikanter Unterschied zu Linear und Regel | 08 §3.1 (Chen 2022) |
| Kollisionen nur live zählen | kausaler Detektor trennt deckungsgleiche Kicks nicht von Flams | 08 §4.c |
| Kollisionen nur vorhersagen | falsches Raster bleibt unsichtbar; nach Korrektur 66 % der MFB-Schläge im Flam-Bereich | 08 NP K4 |
| absolute Urteile „gut/matschig“ | paarweise schlägt absolut in jeder Zeile der Simulation | 08 §4.d, NP K6 |

## Folgen

- Die Vorhersage hat mit Keylock einen realistischen Fehler von 0,038 Überdeckung und 0,41 LU (08 NP K2); das ist die
  Abnahmegrenze von Scheibe 2.
- „Rund 40 Urteile“ ist eine optimistische Schranke; bei halb so scharfem Geschmack reichen 160 nicht für „welche Zahlen
  zählen“ (08 NP K6).
- Rückwärts-Analyse nach Kim 2021 wird durch Lernen durch Zusehen überflüssig, weil Andreas' Reglerkurven im Klartext
  vorliegen (Vermutung zur Güte).

## Beleg

08 §3.1, §3.3.1 bis 3.3.6, §4.a (168 von 168 Fingerabdrücke), §4.b, §4.b2 (mit Kreuztermen LR4 und LR8 gleich gut,
0,0119), §4.c (eingebaute 20 ms kamen als 20,0 bis 21,9 ms an), §4.d, §4.f (Python-Block p99 15,2 ms; Planer „sicher“
3,9 s, NP 0,891 s); NP K1 bis K6, „Was fehlt“ 1 bis 6; 09 §6 (Schwellen Sync 2,0 ms, Tempo ±0,5 %, gesetzt).

## Kippt, wenn

Andreas im Hörtermin den Optimierer hörbar besser findet (dann Optimierer für diese Spielart); die Hörschein-Schwellen
sich am Ohr als zu streng oder zu lax zeigen (Daten, keine Architektur); M20 zeigt, dass eine Faustregel mit früher
gesenktem A-Tief die Tief-Grenzen hält (dann verriegeln sie) oder nicht (dann Grenzen neu setzen); M19 zeigt hörbare
Fehler der Stimmungskorrektur (dann nur Vorschlag).
