# ADR 031: Warp im Arrangement (W(b) auf der Tempo-Karte, RE-PITCH im Callback, Werk mit Vorlauf für die Stretch-Modi)

Status: Teil 1 (Abbildung, Format, RE-PITCH) umgesetzt in Paket 1.13 Slice 1, Zweig `w1`, Abnahme am Ziel nach dem Plan
`docs/superpowers/plans/2026-10-22-warp-slice1.md`. Teil 2 (Werk mit Vorlauf für COMPLEX und TONES, Slice 2) ist **vorgeschlagen und nicht
angenommen**: er hängt an der Messprobe Arbeitsfaden-Last (`kern/tests/deck/warp_last_lauf.sh`, Tore T1 bis T6 in `warp_last_auswertung.py`).
Andreas, 2026-10-22 CLI, zu den Fragen F1 bis F6 der Spec: „alles nach empfehlung“. Spec: `~/messungen/2026-10-22-breite1-specs/1.13-warp-stems.md`.
Hängt zusammen mit: ADR 005 (Beats als Zeitbasis), ADR 029 (Keylock in Echtzeit, Bungee), ADR 030 (Produktion im Kern), ADR 033 (Routing, dasselbe Format `/2`),
Leitplanken L1, L2, L5.

## Kontext

Das Arrangement spielte Audio in Originalgeschwindigkeit (`arr_stimmen.cpp`: Quellframe = `offset_frames + (t − Einsatz)`). Ein Clip, der nicht im
Projekttempo aufgenommen ist, sitzt am Anfang auf dem Beat und läuft danach weg. Der Betrieb dehnt Decks und Loop-Boxen mit Bungee im Callback
(ADR 029), aber das Arrangement hat weder Dehnung noch Marker.

## Entscheidung (Teil 1, gebaut)

1. **Warp ist eine Eigenschaft des Clips** (`AudioClip.warp`): Marker `[quell_s, beat]`, beide streng steigend, Versatz `versatz_beats`, Quelle der Marker
   (`takte`, `mediathek`, später `werkstatt`, `traktor`, `hand`), Modus. Die Quelldatei bleibt unangetastet, gerechnet wird beim Spielen.
2. **Die Abbildung W(b)** (Clip-Beat → Quellposition) ist zwischen zwei Markern linear, davor und danach gilt das Randsegment. Server und Seite rechnen in
   Sekunden (`projekt/warp.ts`, `oeffentlich/produktion/warp.js`), der Kern in Frames (`cypherdj/warp_abbildung.h`). Eine Referenzdatei
   (`vertrag/warp_referenz.json`, 1000 Fälle, exakt gerechnet) bindet alle drei auf 1e-12.
3. **Die Quellposition folgt dem Projekt-Beat der Tempo-Karte, nicht der verstrichenen Zeit seit dem Einsatz.** Ein gewarpter Clip liest bei Sample t die Quelle
   an W(p(t) − start_beat). Weil p(t) aus derselben Karte kommt wie alles andere (L2), folgt der Clip jeder Rampe und später der Tempo-Automation (1.12 F1) ohne
   eigene Logik, und der Export ist Sample für Sample derselbe Rechenweg wie das Hören (L2 „gerendert = gehört“).
4. **RE-PITCH** (Modus 0) liest mit Catmull-Rom im Callback: die Tonhöhe folgt dem Tempo wie bei einer Platte. Kein Faden, keine FFT. Gemessen (32 Spuren,
   Scratch, ruhige Maschine): +82 µs Median je 256er-Block gegen 32 ungewarpte Spuren (Rechnung der Spec: 80 µs); am Repo-Bau mit `-O3` (Task 5, im Prozess, nicht im JACK-Callback) +65 µs.
5. **Formate: das `/2` von 1.10, keine eigene Nummer.** Projekt `cypherdj-projekt/2` (ADR 033) bekommt am Audio-Clip das optionale Feld `warp`, nur in `/2`; `/1`
   bleibt lesbar, die Hebung beim Öffnen setzt `gruppen` und `master` wie bisher und keinen Warp. Wiedergabe `cypherdj-arr/2` (dasselbe `/2` wie das Routing) trägt
   `clips[].warp`; der Server schreibt `/2`, wenn Routing **oder** ein gewarpter Clip (an) vorkommt, sonst `/1` Zeichen für Zeichen. Der Kern liest beide; ein Warp in
   `/1` ist ein Formatfehler. Grund: mit je einer eigenen Nummer für Routing und Warp gäbe es für ein Projekt mit Gruppe und gewarptem Clip keine Datei, die beide trägt
   (Nachzug auf `main` 2ad087f4, Entscheidung der Hauptinstanz 2026-10-24).
6. **Grenzen:** 2 bis 4096 Marker je Clip, 262 144 in der ganzen Wiedergabe (alle Loop-Kopien zählen; 4 MiB gesperrter Speicher), Segment-Tempo 15 bis 800 BPM.
   Die Spec nennt „Faktor 0,25 bis 4“ relativ zum Projekttempo; das Projekttempo ändert sich aber (60 bis 200), und eine gespeicherte Eigenschaft des Clips
   darf dadurch nicht ungültig werden. 15 = 0,25 · 60 und 800 = 4 · 200 sind die Grenzen, die für jedes Tempo den Faktor 0,25 bis 4 enthalten.
7. **Auto-Warp beim Ablegen** entscheidet der Server aus den Daten der Library (`loeseQuellenAuf`): Loop mit Takten liegt auf takte · 4 Beats, sonst gilt die BPM der
   Mediathek ab Sekunde 0 (bei einem Track mit „Takt-Eins unsicher“), One-Shots nie, ohne Tempo ein Hinweis `kein_tempo`. Das Projekttempo ändert die Ablage nie (F2).
   Auto-Warp braucht `dauer_s`: ohne Dauer kein Endmarker und keine Länge in Beats, also `kein_tempo`, auch wenn die Mediathek eine BPM kennt (Gesamtreview 2026-10-24, Minor 3: 1013 von 7713 Loops im Katalog). Die Seite bietet solche Einträge ohnehin nicht zum Ziehen an (`ziehen.js` `nutzlast`); betroffen ist nur `clip_neu` mit `warp: "auto"` per MCP. Die Quelle (4) der Spec ohne Dauer (Marker `[0,0],[60/bpm,1]`, Länge vom Aufrufer) kommt mit Slice 3.
8. **Null-Test mit Warp:** Tor Rest unter −90 dBFS (D1 A7). Gemessen −145 dB, nicht −200 wie ohne Warp: live und Render beginnen bei verschiedenen Kern-Samples
   und runden die absolute Beat-Rechnung verschieden, ein Float-Ulp kippt gelegentlich. Bitgleich wäre möglich, wenn p aus (t − Einsatz) gerechnet würde.

## Vorschlag (Teil 2, Slice 2, nicht angenommen)

COMPLEX (Korn 512) und TONES (Korn 256) mit Bungee, dessen Positions-API die Marker-Abbildung ohne Änderung annimmt (`req.position = W(b)`). 32 Spuren im
Callback reißen das Budget (Rechnung der Spec 7.2: 32 · 121 bis 248 µs im Schwanz gegen 5,33 ms). Vorschlag: ein **Warp-Werk** mit eigenen Fäden (Vorgabe 4,
SCHED_FIFO unter den Keylock-Fäden), festem Pool (64 Stimmen), Ringen mit 8192 Frames Vorlauf und Ansatz 2048 Samples vor dem Einsatz; der Callback liest nur
Ringe. Verworfen: Dehnung im Callback (reißt), R3 (kein beliebiger Marker-Weg), Vorab-Render je Clip (ADR 029: „nicht mehr jedes audio hoch und runter rechnen“).
**Bedingung:** die Messprobe hält ihre Tore (Callback p99,9 höchstens Grundlinie + 150 µs neben vier Decks und zwei Boxen, Unterläufe 0, Ansatz binnen 43 ms).
Reißt ein Tor, sinkt der Pool oder TONES wird Vorgabe; der Plan für Slice 2 wird nach dem Ergebnis geschrieben, nicht davor.

## Folgen

- `ArrClip.warp` zeigt in den Schnappschuss (`ArrSnapshot::warps`, `warp_beat`, `warp_frame` in eigenen, gesperrten Seiten, auf dem Konto gebucht).
- Der Tausch eines Schnappschusses vergleicht den Warp inhaltlich: ein geänderter Warp blendet den alten aus (96 Samples) und setzt den neuen ein.
- Die Gegenprobe des Null-Tests (`gegenprobe_spur`) verschiebt bei gewarpten Clips alle Marker um einen Frame.
- Neue Gründe der Seite: `warp_marker`, `warp_faktor`, `warp_modus`, `transpose_repitch`, `kein_warp`, `offset_bei_warp`, `kein_tempo`.
- Ein gewarpter Clip kennt kein `offset_s`; sein Inhalt wandert über `versatz_beats` (Teilen, Kürzen am linken Rand und das Eingabefeld rechnen in Beats).
