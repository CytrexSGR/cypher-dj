# ADR 013: KI-Schicht (Rollen, Wahl statt Plan, Zug-Takt, Autonomie)

- **Status:** vorläufig, Messung M15 steht aus; Spieler geändert auf Sonnet-Welle (Nachtrag 2026-09-25)
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A1, A3, A4, A7, A13, A15, A16, A24
- **Hängt zusammen mit:** ADR 012, 014, 023

*Befangenheit, offen gelegt: diese Entscheidung regelt meinen eigenen Spielraum. Darum liegt jede Stufe meiner
Freiheit auf einem Schalter in Andreas' Hand, und die Vorgabe ist klein.*

## Kontext

Ein LLM-Zug dauert Sekunden (09 Probe a, a2); das LLM schrieb in 0 von 105 Plänen eine Kopplung, woraus zur
Laufzeit 15 Takte doppelter Sub entstanden (09 NP K1); eine Wahl statt eines Plans kostete als Text-Antwort
1,307 bis 1,437 s (NP K7). A16 sagt wörtlich: „Was Kunst bleibt: welcher Track, welche Spielart, welcher Moment.“
09 Frage 1 fragt, wie viel Cypher allein darf; ohne Sichtkanal ist „Vorschlagen“ nicht umsetzbar (09 NP „Was fehlt“).

## Entscheidung

1. **Rollen:**
   - **Spieler:** Claude Sonnet in einer warmen Sitzung je Set (`claude -p --input-format stream-json
     --output-format stream-json`), schlanker Rollenprompt nur mit Musik- und Set-Kontext, `MAX_THINKING_TOKENS=0`,
     ohne Hooks und fremde MCP-Server, ein Aufwärmzug vor dem Set. Getrieben von `cypherdj-spieler` (Node), Werkzeuge
     über `cypherdj-mcp`.
   - **Zerleger** (ab Scheibe 6): zweite, getrennte Sonnet-Sitzung in der Werkstatt (A13).
   - **Hauptinstanz** (Opus mit Gedächtnis) nur vor und nach dem Set: Rollenprompt, Lernmodell, Zusammenfassung,
     A/B-Paare in Auftrag geben. Opus nicht für Züge; Haiku nicht für freie Pläne.
2. **Wahl statt Plan:** Cypher antwortet mit `waehle{material_id, spielart, start_takt, hoerschein, absicht}` aus
   Kandidaten, die der Rechner vorbereitet hat. Der Leitstand lässt die Spielart vom Rechner zu Planteilen expandieren,
   vergibt Kopplungen, prüft die Vorhersage gegen die Sub-Grenze (Tief-Grenzen bis M20 nur Warnung, ADR 012) und reicht
   erst dann ein. `plan_einreichen` (freier
   Plan in der einen Planform) bleibt die Ausnahme für Ungewöhnliches.
3. **Zug-Takt:** der Leitstand ruft, nicht Cypher. Anlässe: spätestens 8 Takte vor dem frühesten Start eines Einsatzes;
   `material_fertig`; Hörschein; Handgriff in einem Cypher-Plan; Verriegelung; abgelehnter oder verfallener Vorschlag;
   Frist unter 32 Takten; Andreas' Taste „Cypher, Vorschlag“; sein Zuruf (eine getippte Zeile). Nur ein Zug
   gleichzeitig; jede Anfrage trägt eine Antwortfrist in Beats; zu spät heißt verworfen. In ruhigen Phrasen fragt
   niemand. Lage je Takt verdichtet, kein Strom unterhalb des Takts an das LLM.
4. **Autonomie-Stufen** auf einem Schalter am Controller, **Vorgabe Stufe 1**:
   0 Zuhören (Cypher analysiert und protokolliert nur) · 1 Vorschlagen (**Positivliste:** jede Wahl und jeder Plan wird
   ein Vorschlag, gleich ob er einen Kanal öffnet oder nur EQ, Stem, Send, Hotcue, Sprung oder Loop an einem schon
   hörbaren Deck ändert; allein nur Laden, Vorhören, Erzeugen, eigene Pläne abbrechen und ein Plan, der ausschließlich
   Kanäle der eigenen Spur leiser macht) · 2 Eigene Spur (Cypher spielt freigegebene Kanäle hinter einem Fader, den nur
   Andreas hält; alles andere weiter als Vorschlag) · 3 Übergänge allein. Durchgesetzt im Leitstand; Wortlaut und
   Golden-Folge `autonomie_1_eq`: `SCHNITTSTELLEN.md` §10. Grund der Positivliste: A4 „Nichts erreicht den Master
   ungeprüft“; ein EQ auf +6 dB an Andreas' laufendem Deck öffnet keinen Kanal und ist trotzdem Einspielen ohne ihn.
5. **Cypher-Stopp** (Taste am Controller, wirkt im Kern auch ohne Leitstand): alle Teile mit Quelle `cypher` ab, Kanäle
   der KI-Spur in einem Takt auf −200 dB, übrige Regler bleiben stehen, weitere Cypher-Befehle abgelehnt bis „Freigabe“.
6. **Sichtbarkeit vor jeder Oberfläche:** LEDs am Controller (Vorschlag offen, Plan läuft, Rückfall aktiv), eine
   **Ansage-Zeile** im Terminal (ein Satz mit Takt: was Cypher als Nächstes vorhat), die Taste „Cypher hören“, der
   Spielzettel als Text. Kein Sprachausgang (Kein Ton ohne Frage).
7. **MCP-Werkzeuge:** `lage`, `warte`, `waehle`, `plan_einreichen`, `plan_abbrechen`, `laden`, `vorhoeren`, `bestand`,
   `passung`, `erzeuge`, `spielzettel` (ab Scheibe 7), `markieren` (Formen: `SCHNITTSTELLEN.md` §10). Werkzeuge statt
   Ressourcen-Abos.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| LLM schreibt Planteile (09) | 0 von 105 Plänen koppeln; Spielart-Regeln aus dem Prompt verletzt, Prüfer blind; Werkzeugweg 4,5 bis 8,7 s bis zum Plan | 09 NP K1, K6, K9 |
| kalter `claude -p` je Zug | p50 22,9 s, p95 33,7 s (12 bis 18 Takte) | 09 Probe a |
| `--effort low` statt `MAX_THINKING_TOKENS=0` | schaltet Denken nicht sicher ab (52 bis 693 Denk-Token in Folgezügen) | 09 NP K6 |
| Haiku als Spieler | ohne Denken schnell (2,2 bis 2,5 s), bricht aber Bass-Regeln | 09 NP K8 |
| Opus 5.5 für Züge | Denken nicht abschaltbar („except on Opus 5.5 and the Fable models“) | 09 NP K6 |
| Ressourcen-Abos statt `warte` | in MCP optional, Weg ins Modell ungeprüft | 09 §3.5 |
| volle Autonomie ab Start | Vertrauen muss eingelöst werden; Andreas behält die Hand | 09 §6 Frage 1, R10 im Entwurf „KI“ |

## Folgen

- Formfehler kosten einen Zug, nie einen Klang: der Leitstand prüft jede Antwort.
- Die Wahl als Werkzeugaufruf ist ungemessen; gerechnet 2,5 bis 3,5 s (Text 1,3 bis 1,4 s plus 1 bis 2 s für den
  zweiten Modellaufruf nach dem Werkzeugergebnis, 09 NP K6). **Maßgeblich ist die Antwortfrist des Vertrags: 4 Takte
  (7,5 s bei 128)** vom Zug bis `antwort_bis_beat`; die übrigen 4 Takte der 8 Takte Vorlauf gehören Andreas' Annahme
  und dem Vorlauf der Teile (`SCHNITTSTELLEN.md` §3). Gemessen sind: freier Plan über das Werkzeug 4,5 bis 8,7 s,
  warme Text-Züge mit Schema bis 14,5 s, die Wahl nur als Text 1,3 bis 1,4 s (n = 5, Kontext höchstens 7 410 Token,
  `llm_x_wahl_sonnet_low_ergebnis.json` Feld `cache_gelesen`). Zug plus Reparaturzug passen nur, wenn die Werkzeug-Wahl
  die gerechneten 2,5 bis 3,5 s hält; das ist offen.
- Ist die Frist knapp, rückt die Zug-Anfrage bei „sicher“ auf F−28 (12 Takte vor S), die Antwortfrist bleibt S − 4 Takte.
- Kosten über ein Set sind ungemessen: bei 260 000 Token Kontext liest jeder Zug diese Menge aus dem Cache (09 NP
  „Was fehlt“). M15 misst zuerst 30 Minuten.
- Formsicherheit bei großem Kontext ist nur für Text gemessen (0 von 5 gültig bei 259 266 Token); die 10 gültigen
  Werkzeugaufrufe liefen bei 7 bis 23 Tausend Token (`llm_x_mcp_*_ergebnis.json`, `cache_gelesen`).

## Beleg

09 §3.2, §3.4, §3.5, Probe a, a2, b, c; NP K1, K6 (Werkzeugweg; `MAX_THINKING_TOKENS=0`: warme Text-Folgezüge 3,564
bis 4,455 s), K7 (Wahl 1,307 bis 1,437 s, 33 bis 42 Token, 5 von 5 gültig), K8, K9, K11, „Was fehlt“; Rohdaten
`proben/09-ki-steuerung/nachpruefung/llm_x_wahl_sonnet_low_ergebnis.json` (`init_tools` leer),
`llm_x_mcp_sonnet_low_ergebnis.json`; 08 NP K1; Recherche §5 (Übernahme durch Spielen, Vorschlag und Annahme,
sichtbarer Plan, eigene KI-Spur).

## Kippt, wenn

M15 (Wahl als Werkzeugaufruf, Kontext ≥ 100 000 Token wie spät im Set) zeigt, dass **p95(Zug) + p95(Reparaturzug)
über der Vertragsfrist von 4 Takten** liegt, oder Formfehler bei der Wahl über das Werkzeug (dann Wahl als Text mit
`--json-schema`, Zug-Anfrage früher, oder ohne Reparaturzug); die Kosten eines Sets sind nicht tragbar (Entscheidung
Andreas).

## Nachtrag 2026-09-25: der Spieler ist eine Sonnet-Welle

`(A, 2026-09-25: „ich gehe davon aus das wir mit sonet welle auflegen. das klapt ohnehin besser als mit opus. du denkst viel länger rum")`

Entscheidung 1 wird geändert: Der Spieler ist nicht mehr eine schlanke, gedächtnislose Sonnet-Sitzung, sondern eine
**Cypher-Welle auf Sonnet** mit Boot, Gedächtnis und Andreas' Geschmack. **Opus bleibt als Spieler möglich** `(A, 2026-09-25: „schließ opus nicht ganz aus gleich. vielleicht
auch mal mit opus. dann entscheide ich sowieso über das budget")`: Vorgabe ist Sonnet, Opus eine Wahl je Set, über
die Andreas samt Budget entscheidet. Bekannter Preis dafür: Denken ist auf Opus 5.5 nicht abschaltbar (09 NP K6), ein
Zug dauert also länger; ob er in die Frist passt, ist ungemessen.
Erfahrungsgrundlage: das Set hall140 am 2026-09-21 wurde auf Sonnet gespielt.

Was dadurch neu offen ist und M15 messen muss, statt der bisherigen schlanken Sitzung:

- **Kontext:** Boot und Boden bringen den Kontext schon vor dem ersten Zug nach oben. Die Zeit bis zur Wahl muss an
  genau dieser Größe gemessen werden.
- **Hooks:** Eine Welle trägt die PreToolUse- und PostToolUse-Hooks (DJ-Maschine: 50). Jeder `waehle`-Aufruf läuft durch sie
  hindurch. Ihre Laufzeit zählt in die Frist von 4 Takten. Zu klären: für die Dauer des Sets ein Hook-Profil ohne die
  Hooks, die nichts mit dem Set zu tun haben.
- **Denken:** `MAX_THINKING_TOKENS=0` gilt auch für die Welle (Sonnet erlaubt es, Opus 5.5 nicht, 09 NP K6).

M15 wird dafür verkleinert: ein Kurzlauf mit rund 20 Zügen in der Wellen-Konfiguration (etwa 3 USD statt 20). Ein
zweiter Kurzlauf mit Opus in derselben Konfiguration misst, ob Opus die Frist hält; Kosten vorher gerechnet, Lauf auf
Andreas' Wort. Die
30-Minuten-Messung folgt, wenn der Spieler gebaut ist (Scheibe 61).

## Nachtrag 2026-09-26: Rückfall F−28 scharf (M15 gemessen)

Kurzlauf M15 (`messungen/M15-wahl-werkzeug/laeufe/kurz-welle-20260926-1005`, Stand 03): Wahl als Werkzeugaufruf 20 von 20
gültig, 0 Formfehler, Reparatur mit handlungsfähiger Ansage 0 verfehlt, 0,09 USD je Zug. Die Zeit hängt an der API: am
25.09. abends Zug p95 3,4 s, am 26.09. vormittags 9,9 s (erste Antwort der API 3,0 bis 8,7 s statt 1,1 bis 1,9 s). Die
4-Takte-Frist (7,5 s) hält damit nicht verlässlich. Der oben vorgesehene Rückfall gilt ab jetzt immer: `zug_vorlauf_takte`
= 12, Antwortfrist bleibt S − 4 Takte, das Antwortfenster ist 8 Takte (15 s bei 128). Ein Zug passt im p95 mit Luft; eine
Reparatur im selben Zug passt im Median (5,5 + 4,4 s), im schlechtesten gemessenen Fall (9,9 + 9,0 s) nicht, dann greift
der Frist-Wächter wie für jede fehlende Antwort.

## Nachtrag 2026-09-26 abends: Planung der Echtzeit voraus (A29)

`(A, 2026-09-26)` „wir müssen planerisch immer der echtzeit voraussein … wenn wir 2 minuten brauchen die präzise folge
aufzusetzen müssen wir mindestens 3 minuten vorher reden, fallback ist loop des aktuellen sounds sowieso immer … wir
entwickeln musikalische reisen eigentlich“.

Richtung geändert: Die KI-Schicht arbeitet in zwei Horizonten.
1. **Reise** (strategisch, Minuten voraus): Dramaturgie, nächste Tracks, Art der Übergänge, Ansagen (A28). Horizont
   mindestens 1,5 × Aufbauzeit der nächsten Folge. Die Werkstatt rendert, was die Reise braucht, bevor es gebraucht wird.
2. **Zug** (taktisch, wie bisher, `zug_vorlauf_takte` = 12): setzt eine längst geplante Folge ins Raster, repariert
   Verriegelungen.
Rückfall ist Normalbetrieb, kein Fehler: aktuellen Takt oder Phrase loopen (Frist-Wächter, Scheibe 13/20) oder eine
Sequenz wiederholen, bis die nächste Folge steht. Die API-Antwortzeit (M15: p95 9,9 s) trifft damit nur noch den Zug,
nie die Reise. Unmittelbares Live-Reagieren ist ausdrücklich nachrangig.
