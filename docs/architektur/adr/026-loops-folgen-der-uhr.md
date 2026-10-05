# ADR 026: Loops und REC folgen der Kern-Uhr (Varispeed), Tempo an der Seite

Status: angenommen 2026-09-30 (Cypher; Andreas: „wir brauchen ein master tempo dem sich alle unterordnen“, danach
„bauen wir das bevor wir spielen“).

## Kontext

Der Betrieb lief am 2026-09-30 auf 130 BPM (Startkonfiguration vom Vortag). Andreas lud einen Loop in L1 und drückte
PLAY: nichts. Nach ADR 025 schwiegen Loop-Boxen bei Tempo ≠ 128, REC lehnte ab, und das Tempo gab es nur beim Start.
Ein zweiter Loop ließ sich gar nicht laden (falsche Frame-Zahl), ohne dass die Seite etwas sagte. Die Uhr des Kerns
war schon das Master-Tempo (die Strudel-Ströme folgten ihr), nur folgten ihr nicht alle.

## Entscheidung

1. Loops bleiben auf der Set-Basis 128 BPM gespeichert (Anforderung A9). Die Box liest sie bei abweichender Karte mit
   dem Schritt `bpm`/128 (Varispeed, Catmull-Rom), Position je Block aus dem Beat, also weiter phasenstarr. Bei genau
   128 BPM bleibt der ganzzahlige Direktweg, bitgenau.
2. REC nimmt in jedem festen Tempo auf: kopiert werden die Frames von N Beats beim Tempo der Aufnahme, das Netz tastet
   beim Schreiben auf N · 22 500 Frames um. In der Box beim selben Tempo abgespielt hebt sich das auf.
3. Das Tempo stellt Andreas auf der Seite (`POST /tempo` → `/k/tempo/rampe`, ein Takt ab der nächsten Eins). Die Quelle
   `cypher` bekommt 403: Tempo ist Richtung.
4. Ein Loop, den der Kern ablehnen würde, steht in der Liste als defekt mit Grund; eine Ablehnung des Kerns steht in
   der Antwort von `/loop` und auf der Seite.

## Folgen

- Kein Keylock: bei Tempo ≠ 128 wandert die Tonhöhe der Loops um 12·log2(bpm/128) Halbtöne (130 BPM: +0,27).
  Anforderung A10 („Keylock ist Pflicht für alles“) bleibt offen und gehört zu den Scheiben 34 und 50 bis 52.
- Decks starten weiter nur bei ihrer Basis (`kein_stretcher`), und der Kern lehnt einen Tempowechsel ab, solange ein
  Deck läuft. Die Seite sagt das am Deck und am BPM-Feld.
- `→ STRUDEL` (`loopKit`) spielt einen Loop als Klang in gespeicherter Rate: kein Tempo-Folgen.
- Wirt-Fahrten (`klang fahre`) rechnen ihre Dauer beim Start in Sekunden um und dehnen bei einem Tempowechsel nicht mit.
- Die Folge aus ADR 025 „Loops schweigen bei Tempo ≠ 128“ ist aufgehoben; `/e/loop` Status 5 wird nicht mehr gemeldet.
- Ein Mitschnitt, der bei ≠ 128 BPM aufgenommen wurde, ist zweimal interpoliert (Umtastung, dann Varispeed). Gemessen
  an einem Sinus: Abweichung 2·10⁻⁵ nach der Umtastung.
- Die Klangtreue des Varispeed-Wegs (Catmull-Rom) ist gerechnet, nicht gehört: Störabstand bei 130 BPM rund 47 dB
  bei 5 kHz, 27 dB bei 10 kHz, 15 dB bei 15 kHz (Code-Review F2, `~/messungen/2026-09-30-tempo-folgen/code-review.md`);
  bei 128 BPM bitgenau. Gemessen sind Phase und Tempo der Box, nicht ihr Höhenbild. Reicht es Andreas' Ohr nicht:
  längerer Interpolator (Fenster-Sinc) in `spiele_frei`.
- Der Riegel „Tempo nur Andreas“ sitzt im Seiten-Server (`POST /tempo`), nicht im Kern: `/k/tempo/rampe` prüft weder
  Quelle noch Stop Cypher (Code-Review F16). Der MCP djk-hand hat kein Tempo-Werkzeug.

## Verworfen

| Weg | Warum nicht | Beleg |
|---|---|---|
| Loops im Tempo ihrer Aufnahme speichern | Frames je Beat nicht ganzzahlig (130 BPM: 22 153,85), zweiter Lesepfad auch bei gleichem Tempo, alle Werkzeuge rechnen mit 22 500 | `loop.h` `LOOP_SPB`, `loops.ts`, `loop_bauen.py` |
| Betrieb auf 128 festnageln | widerspricht Andreas' Satz; die Strudel-Ströme liefen schon bei 130 | Spec 2026-09-27 Zeilen 162 bis 168 |
| Auf den Stretcher warten | groß (Scheiben 34, 50 bis 52), bis dahin kein Loop außerhalb von 128 | ROADMAP |

Messwerte: `docs/architektur/stand/tempo-folgen.md`, Rohdaten `~/messungen/2026-09-30-tempo-folgen/`.
