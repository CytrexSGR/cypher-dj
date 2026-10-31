# ADR 031: Warp im Arrangement (W(b) auf der Tempo-Karte, RE-PITCH im Callback, Werk mit Vorlauf für die Stretch-Modi)

Status: Teil 1 (Abbildung, Format, RE-PITCH) umgesetzt in Paket 1.13 Slice 1, Zweig `w1`, Abnahme am Ziel nach dem Plan
`docs/superpowers/plans/2026-10-22-warp-slice1.md`. Teil 2 (Werk mit Vorlauf für COMPLEX und TONES) ist umgesetzt in Paket 1.13 Slice 2, Zweig `w2`, nach dem Plan
`docs/superpowers/plans/2026-10-24-warp-slice2.md`; Voraussetzung war die Messprobe Arbeitsfaden-Last (`kern/tests/deck/warp_last_lauf.sh`, Urteil „S2 wie geplant“,
2026-10-24). Zielabnahme und Hörabnahme von Slice 2 stehen in `stand/produktion-warp.md`.
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
   Auto-Warp braucht `dauer_s`: ohne Dauer kein Endmarker und keine Länge in Beats, also `kein_tempo`, auch wenn die Mediathek eine BPM kennt (Gesamtreview 2026-10-24, Minor 3: 1013 von 7713 Loops im Katalog). Die Seite bietet solche Einträge ohnehin nicht zum Ziehen an (`ziehen.js` `nutzlast`); betroffen ist nur `clip_neu` mit `warp: "auto"` per MCP. Die Quelle (4) der Spec ohne Dauer (Marker `[0,0],[60/bpm,1]`, Länge vom Aufrufer) kommt mit Slice 3. Slice 3a stellt die Werkstatt-Karte und das Traktor-Raster davor (Punkt 9).
8. **Null-Test mit Warp:** Tor Rest unter −90 dBFS (D1 A7). Gemessen −145 dB, nicht −200 wie ohne Warp: live und Render beginnen bei verschiedenen Kern-Samples
   und runden die absolute Beat-Rechnung verschieden, ein Float-Ulp kippt gelegentlich. Bitgleich wäre möglich, wenn p aus (t − Einsatz) gerechnet würde.

## Entscheidung (Teil 2, gebaut in Slice 2)

COMPLEX (Modus 2, Bungee Korn 512) und TONES (Modus 3, Korn 256) rechnet ein **Warp-Werk** (`cypherdj/warp_werk.h`, `warp_werk.cpp`, die Maschine in
`warp_werk_bungee.cpp`), nicht der Callback. Bungees Positions-API nimmt die Marker-Abbildung ohne Änderung an: `req.position = W(b(m))` mit b(m) = beat_at(m) +
Versatz aus derselben Karte wie alles. Verworfen bleiben: Dehnung im Callback (32 · 121 bis 248 µs im Schwanz gegen 5,33 ms), R3 (kein beliebiger Marker-Weg),
Vorab-Render je Clip (ADR 029: „nicht mehr jedes audio hoch und runter rechnen“).

1. **Pool und Ringe.** 64 feste Plätze, je zwei Bungee-Instanzen (Korn 512 und 256, im Konstruktor) und ein Ring (StreckRing, 16 384 Frames) mit 8 192 Frames Vorlauf.
   Der Callback liest nur den Ring (Kopie plus Gain). `kern.toml warp_faeden` (Vorgabe 4, 1 bis 8) legt die Arbeitsfäden an; sie laufen mit SCHED_FIFO JACK − 6 unter den
   Keylock-Fäden. Ohne Fäden (0, Render und Tests) füllt `takt()` die Ringe im aufrufenden Faden, deterministisch.
2. **Ansetzen vor dem Einsatz.** Das Arrangement setzt eine Stimme ARR_WARP_FRIST = 2048 Samples (43 ms) vor ihrem Einsatz an (Vorausblick je Block), auch den Durchlauf
   nach der Loop-Naht (dann eine zweite Stimme, die an der Naht die erste ablöst) und beim wartenden Transport. Wo ein gewarpter Clip am Start klingen müsste, wächst die
   Start-Regel um ARR_WARP_FRIST. Es gibt keine Brücke und kein Varispeed: hörbar ist nur fertig gerechnetes Audio. Der Vorausblick sucht je Spur im Beat und bricht beim ersten Clip hinter dem Horizont ab: 4 096 Clips kosten den Block 27 µs statt 64 µs.
3. **Tausch und neue Karte.** Ändert ein Tausch den Warp, spielt die alte Stimme aus ihrem Ring bis `s + ARR_WARP_FRIST` weiter und blendet dort über 96 Samples aus, die
   neue setzt dort ein (Überblendung); fällt der Clip weg oder wird er kein Werk-Clip, blendet die alte sofort aus. Wächst die Karten-Generation (Tempo-Rampe, Hand am
   Tempo), setzt jede klingende Stimme genau eine Nachfolgerin mit der neuen Karte bei `s + ARR_WARP_FRIST` an (nur live; der Render kennt keine Hand). Findet eine keinen Platz
   (an einer Clip-Grenze, an der alle Spuren zugleich wechseln, halten alter Clip, vorab angesetzter Clip und Nachfolgerin je Spur einen), bleibt sie offen, jeder Block
   versucht es erneut, bis der alte Clip endet; gezählt (`warp_kein_platz`) wird sie erst, wenn ihre Stimme ohne Nachfolgerin endet.
4. **Lebensdauer.** Der Faden kopiert die Marker beim Übernehmen eines Auftrags; die Stimme hält ihr Audio (`haelt`) vom Übernehmen bis zu ihrem Ende im Faden, nicht nur im Block.
   `WarpWerk::liest(Schnappschuss)` ist wahr, solange ein Auftrag nicht übernommen ist oder eine Stimme ein Audio hält, das der Schnappschuss als letzter nennt (`ArrAudio::ref` 1);
   der Lade-Faden gibt einen abgelösten Schnappschuss erst frei, wenn es falsch ist (`ArrLader`, Warteliste von 16). Das gilt auch für die alte Stimme eines Tauschs, die bis zur
   Überblendung aus ihrem Ring weiterspielt und weiterrechnet (`test_warp_werk_tausch_quelle`). Nie wartet der Callback. Die geltende Epoche einer Stimme (`soll`) steht vor dem
   Auftrag, den sie deckt: sonst hielte der Faden den neuesten Auftrag für überholt.
5. **Fehlerwege.** Ring leer zum Lesezeitpunkt: Stille mit 2-ms-Blende aus und ein, `warp_unterlauf` zählt den Ausfall (ein Ereignis, kein Dauerzähler), `warp_spaet` zählt
   Stimmen, deren Ring zum Einsatz noch leer war. Pool voll oder kein Werk: der Clip spielt als RE-PITCH (im Takt, falsche Tonhöhe), `warp_kein_platz` zählt, live und im Render gleich.
   Ein Kern ohne Bungee lehnt COMPLEX und TONES beim Laden mit `warp_maschine_fehlt` ab, statt sie still als RE-PITCH zu spielen; `CYPHERDJ_BUNGEE` ist im Bau Vorgabe ON.
6. **Render synchron.** `cypherdj-render` legt für eine Wiedergabe mit Werk-Clips ein synchrones Werk an; Null-Test COMPLEX/TONES gemessen −200 dB (bitgleich), Gegenprobe rot.
7. **Zähler:** neue Adresse `/zustand/warp` (stimmen, unterlauf, kein_platz, spaet, faeden), damit die Typkette von `/zustand/arr` unverändert bleibt.
8. **Abweichungen von der Spec, am Plan begründet (die Lockerung der Lage-Grenze hat Andreas noch nicht entschieden):** Lage-Grenze 24 statt 16 Samples (Bungee Basic an Hann-Klicks mit Dehnung 1,024: ±23 Samples, Sägezahn, keine Drift);
   Transpose und Detune (Slice 5): Bungee `pitch` über die Positions-API; der Server rechnet `pitch = 2^(st/12 + ct/1200)`, der Kern bekommt den Faktor; Bereich −12 bis +24 Halbtöne gesamt (Entscheidung Andreas 2026-10-28; Bungee Basic hielte 2 Oktaven abwärts, aber ab −13 st liegt der Anschlag im Arrangement 26,9 Samples daneben, über dem Lage-Gate 25; die Spec nannte 48; der Kern prüft weiter 0,25 bis 4); eine Änderung tauscht die Werk-Stimme wie jeder geänderte Warp; Standard-Modus neuer Clips bleibt RE-PITCH.

## Entscheidung (Teil 3, gebaut in Slice 3a)

9. **Quellen-Reihenfolge** werkstatt > traktor > takte > mediathek, jede mit Fallthrough: eine Karte, die die Prüfung nicht besteht (zu groß, nicht steigend, hinter der Datei), fällt auf die nächste Quelle zurück, statt den Clip ohne Warp zu lassen (T3). Grund: die Karte der Nachtanalyse ist die genaueste Quelle, aber nicht für jeden Track da.
10. **Ein Marker je Schlag, Länge von der Eins bis zum Dateiende** (D2, T1, `versatz_beats` 0). Grund: die Karte trägt die Drift Schlag für Schlag; der Kern hält das bei 4096 Markern auf 0,46 Samples p90 (Task 4).
11. **Analyse auf Abruf:** ein langer Track ohne Karte wird sofort aus der besten Quelle gewarpt (F2), die Werkstatt analysiert nebenher (`einzeln --nur-analyse`), die Ankunft schreibt über `aendern` (ein Verlaufseintrag „Auto-Warp“, Quelle cypher) und nur, wenn der Warp unangefasst ist und der Clip nicht klingt (T9 bis T11, D1). Grund: kein Sprung unter dem Ohr, und Undo bringt den alten Warp zurück.
12. **Zustand der Analyse ist flüchtig** in `/proj/aktuell` (`analyse`) und nicht im Projekt gespeichert (T8). Grund: er gilt nur, solange der Server läuft; nach dem Neustart fordert ein WARP-Druck neu an.
13. **Hinweise** (`analyse_angefordert`, `analyse_laeuft`, `karte_zu_gross`, `karte_unbrauchbar`, `kein_tempo`) stehen in der Antwort von `aendern`, nicht als Fehler (T7). Grund: der Clip liegt trotzdem.
14. **Keine neue Quelle im Verlauf:** die Ankunft erscheint als Quelle cypher (T10). Grund: der Verlauf kennt nur Andreas und Cypher, die Werkstatt handelt in Cyphers Auftrag.

## Entscheidung (Teil 4, gebaut in Slice 3b)

15. **Befehle der Marker von Hand rechnen in Clip-Beats** (den Beats der Marker, 0 = Eins der Quelle) und nennen einen Marker über seinen Beat vor dem Befehl, nie über einen Index; alle setzen `quelle hand`, ein Warp von Hand wird von einer ankommenden Karte nicht überschrieben. Grund: ein Index ist nach jeder Änderung falsch, und `quelle hand` ist die einzige Lesart der Spec für „von Hand geändert“.
16. **Set 1.1.1 Here lässt den Versatz (`versatz_beats`) stehen, der Clip beginnt danach an der neuen Eins** und behält das Ende der Quelle (Länge minus alter Beat der Stelle). Grund: so verhält sich Live (Vorspann negativ nummeriert, Start-Marker wieder nach links ziehen), und nur so liegt der echte Downbeat nach der Korrektur auf dem Taktstrich (F6, D2 von Slice 3a). Es ändert den Klang am Projekt (entschieden von der Hauptinstanz, 2026-10-30).
17. **Rückweg in die Analyse nur über den Bestand des Decks:** Zeile `art eins`, `von andreas`, `ab_quell_beat` = nächster ganzer Beat der **Bestandskarte**; Lesen und Schreiben übersetzen über die Quellzeit, weil Ablage und Bestand ihre Beats getrennt zählen. Im Betrieb Vorgabe, an Prüfinstanzen nur mit `--korrekturen`. Die Zeile wirkt im Deck erst nach einer neuen Fassung (bekannte Grenze, entschieden). Er erreicht 49 Katalog-Tracks (Suche über `sha` und `shas`, 2026-10-30); Undo nimmt den Clip zurück, nicht die Zeile; für alle anderen sagt der Hinweis `eins_nur_hier`, dass nur der Clip sich änderte.
18. **`tempo_vom_clip` setzt das Fenstertempo** (60 · Länge / Quellsekunden des gespielten Stücks) und läuft als `tempo_setzen`, damit dessen Sperren gelten. Grund: das Segment am Anfang ist bei einer Karte ein Zufallswert.
19. **AK22 wird am Export gemessen** (ganzer gegen geteilter Clip), nicht im Kern-Test: der Fehlerfall liegt im Server (`clip_teilen` rechnet den Versatz des zweiten Teils), nicht im Kern.

## Entscheidung (Teil 5, gebaut in Slice 4)

20. **BEATS: der Server rechnet die Einheiten, der Kern spielt zustandslos.** Der Server schreibt `warp.e` (Beat der Einheit, Quellframe) fertig in die Wiedergabe; die Stimme im Kern rechnet die Samples seit Einheitsbeginn aus dem Projekt-Beat und kennt weder Raster noch Detektor. Grund: Render und Live hören dasselbe, ein Start mitten in einer Einheit klingt wie der Durchlauf, und der Callback braucht keinen Zustand und keinen Faden. Einheiten beginnen auf einem ganzen Sample und spielen die Quelle mit Faktor 1 ohne Einblende (eine Rampe von 32 Samples drückte die Form-Korrelation auf 0,93).
21. **Transienten: eigener Detektor im Server, das Prüfgerät nutzt ein anderes Verfahren.** Der Detektor liest die `.f32` des Dekodier-Caches und legt `<sha>.transienten.json` daneben (Version 2). Gemessen wird mit `w3a_messen` und `w3b_messen`. Grund: Loops haben keine Werkstatt-Analyse, und ein Detektor, der sich selbst prüft, bestätigt seinen eigenen Fehler. Der Hintergrund ist das Maximum der 8 Blöcke davor (ein pulsierender Dauerton ergab mit dem Mittelwert 11 Treffer je Sekunde, mit dem Maximum 0). Im Modus `transienten` beginnt die Einheit 3 ms vor dem Treffer, weil der Treffer an echten Loops bis 4,2 ms (p90) hinter dem Fuß liegt.
22. **Quantize Audio rastet aufs Projektraster**, nicht aufs Raster des Clips: Ziel ist `round((b + off) / r) · r − off` mit `off = start_beat − versatz_beats`, der Standardbereich der Clip, bei einem Loop die erste Kopie. Grund: Ein Clip auf `start_beat` 0,5 würde sonst auf ein Raster rasten, das im Projekt gegen die Beats verschoben liegt; gehört wird das Projekt. Konflikte lehnt der Befehl ab, nichts wird still verworfen.

## Folgen

- `ArrClip.warp` zeigt in den Schnappschuss (`ArrSnapshot::warps`, `warp_beat`, `warp_frame` in eigenen, gesperrten Seiten, auf dem Konto gebucht).
- Der Tausch eines Schnappschusses vergleicht den Warp inhaltlich: ein geänderter Warp blendet den alten aus (96 Samples) und setzt den neuen ein.
- Die Gegenprobe des Null-Tests (`gegenprobe_spur`) verschiebt bei gewarpten Clips alle Marker um einen Frame.
- Neue Gründe der Seite: `warp_marker`, `warp_faktor`, `warp_modus`, `transpose_repitch`, `kein_warp`, `offset_bei_warp`, `kein_tempo`, `marker_unbekannt` (Slice 3b); des Kerns: `warp_maschine_fehlt`.
- Auto-Warp-Quelle (Slice 3a): `werkstatt` und `traktor` kommen zu `takte` und `mediathek`; die Karte kostet bei 865 Markern +35 µs je 256er-Block über 32 Spuren (Task 16).
- Speicher: 128 Bungee-Instanzen, 64 Ringe zu 128 KiB und 64 Markerkopien zu 64 KiB liegen im Kern, angelegt vor `mlockall` (Messung im Plan, Task 3).
- Ein gewarpter Clip kennt kein `offset_s`; sein Inhalt wandert über `versatz_beats` (Teilen, Kürzen am linken Rand und das Eingabefeld rechnen in Beats).
