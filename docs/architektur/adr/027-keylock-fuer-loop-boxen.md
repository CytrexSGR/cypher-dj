# ADR 027: Keylock für Loop-Boxen (Variante vorab gerendert, R3 offline im Netz-Prozess)

Status: **abgelöst durch ADR 029 (Keylock in Echtzeit) für die Entscheidungen 1 bis 3 und 5**; 4 (Direktweg bei 128) und 6
(REC-Umrechnung offline) gelten weiter (2026-10-08, Task 7 des Plans `2026-10-06-keylock-echtzeit.md`: die Loop-Box dehnt
live mit dem Dehner, Varianten-Render ausgebaut). Vorher: umgesetzt im Branch `keylock` (Slices 0 bis 5), nicht gemergt;
Hörprobe stand aus (2026-09-30, Cypher).
Anlass: ADR 026 ließ Loops im Varispeed mitlaufen, dabei wandert die Tonhöhe (Anforderung A10, „Keylock ist Pflicht für
alles“, blieb offen). Andreas: „wir brauchen ein master tempo dem sich alle unterordnen“.

Plan: `~/messungen/2026-09-30-keylock-plan/plan.md`. Berichte je Slice: `~/messungen/2026-09-30-keylock-umsetzung/`
(`slice-01.md` bis `slice-05.md`, Prüfung `slice-3b4-review.md`, Abschluss `slice-3c.md`). Stand und Messwerte:
`docs/architektur/stand/tempo-folgen.md`, Abschnitt „Keylock“.

## Kontext

Bei einem Tempo ≠ 128 BPM liest die Loop-Box ihre Datei mit dem Schritt `bpm`/128 (ADR 026). Die Tonhöhe folgt dem Tempo:
Der Varispeed-Mitschnitt eines Loops bei 135 BPM liegt +92,07 ct neben dem Original (`slice-01.md`, Tabelle „Messwerte“,
GEMESSEN, n = 1). Ein REC bei ≠ 128 tastete den Mitschnitt mit `umtasten` auf das 128er-Raster um und trug dieselbe
Verschiebung in die Datei (−92,17 ct an der Datei bei 135 BPM, `slice-05.md` Messung 5, GEMESSEN).

## Entscheidung

1. **Eine Variante je Box, vorab gerendert, im Ruhetempo.** Steht das Tempo 250 ms fest auf einem Wert ≠ 128 (60 bis 200
   BPM), rechnet der Netz-Prozess den Loop offline mit librubberband R3 auf die Länge `llround(F · 128 / bpm)` bei
   unveränderter Tonhöhe (`loop_stretch.cpp`, `rendere_keylock`; Loop dreifach gelegt, die Mitte genommen, damit die Naht
   schließt; R3 in 1024er-Stücken gefüttert, `slice-03b.md` F1). Quelle der Schwellen: `slice-03.md` Zeile 9.
2. **Render-Faden mit niedrigster Priorität.** Ein Faden im Netz-Prozess (nice 19 und SCHED_IDLE), ein Render zur Zeit,
   je Box nur der neueste Auftrag (`keylock_render.cpp`). Das Ziel einer angekündigten Rampe (`/k/tempo/rampe`) wird ohne 250 ms
   Ruhe vorab gerendert; die Box hält dafür zwei Varianten, von dreien fällt die vom jetzigen Tempo fernste (Glanz 2.6, F12). Das
   Netz führt je Box drei disjunkte Mengen fester Größe (`netz.h` `KlBox`): gehalten (Varianten beim Kern, bis LOOP_ALT; geleert,
   wenn der Kern Ereignisse verliert, `Ereignis::verloren` in /uhr), unterwegs (Render-Aufträge), gescheitert (bis zum nächsten
   festen Tempo oder Loop). Eine Regel an einer Stelle (`kl_soll`): erst das feste jetzige Tempo, dann das Ziel; nichts, solange
   ein gewünschtes unterwegs ist; sonst das erste, das weder gehalten noch gescheitert ist. Jeder Auftrag wird dem Kern angekündigt (`LOOP_ERWARTET`), ein
   Start bei diesem Tempo wartet bis zu `START_HALTE_TAKTE` Takte auf die Variante (Glanz 2.6, F14). REC-Aufträge gehen vor Varianten (Entscheidung Slice 4,
   `slice-04.md`: auf REC wartet jemand, eine Variante ist Zusatz). Der Kern bekommt keinen neuen Faden.
3. **Der Kern spielt die Variante mit dem vorhandenen Catmull-Rom-Weg** (`spiele_frei`, Position wie bisher aus dem Beat,
   Schritt ≈ 1 statt `bpm`/128). Er liest je Block die Fassung mit dem kleinsten Tonhöhenfehler |ln(`bpm`/T_r)|, auch in Rampen (Glanz 2.6, F12, `loopbox.cpp` `waehle_pfad`), und blendet (Pfadwechsel seit Glanz 2.6 über `LOOPBOX_PFAD_BLENDE` = 4800 Frames, 100 ms, gehört 06.10.: „neu4800 ist geschmeidiger aber so richtig merke ich sonst keinen unterschied“; Laden in eine klingende Box weiter `LOOPBOX_LADEN_BLENDE` = 960) vorher in 20 ms
   über (`slice-02.md`, `plan.md` Zeile 37). Eine Variante mit anderem Namen oder anderer Beat-Zahl lehnt er ab.
4. **Der Direktweg bei genau 128 BPM hat Vorrang und bleibt unverändert**: kein Render, keine Variante, bitgleich. Gemessen
   am laufenden Kern: 0 von 815 040 Frames verschieden gegen das Vergleichsbinär ohne Keylock, null `keylock:`-Zeilen im
   Journal (`slice-05.md` Messung 3b, GEMESSEN). Die Box-Ausgabe, der Mitschnitt-Puffer und `rec/loop.f32` sind auch im
   Quelltext-Vergleich deed561 gegen 2ba183e `cmp`-gleich (`slice-3b4-review.md`, „Gehalten“).
5. **Fällt die Variante aus** (Render-Fehler, Faden nicht zu starten, Tempo inzwischen ein anderes, Loop getauscht), spielt die
   Box wie bisher im Varispeed. Die Ausnahme steht in einer stderr-Zeile; nichts verlässt den Faden (`slice-03b.md` F5).
6. **REC bei T ≠ 128 bewahrt die Tonhöhe.** Der Mitschnitt (N Beats beim Tempo der Aufnahme) geht an denselben Faden und
   wird mit R3 (Zeitverhältnis, Tonhöhe 1,0, Bereich 60 bis 200 BPM) auf N · 22 500 Frames gebracht; erst danach schreibt das
   Netz die Datei und sendet `/e/mitschnitt`. Bei 128 bleibt der synchrone Weg ohne R3. `umtasten` ist aus `schreibe_loop`
   heraus und ruft nur noch sein eigener Test (`slice-04.md`, Bedenken 4). Gemessen: Datei −0,00 ct, Wiedergabe bei 135 BPM
   mit Keylock −0,01 ct, Fehlerfall altes Binär −92,17 ct (`slice-05.md` Messung 5).

## Verworfen

| Weg | Warum nicht | Quelle |
|---|---|---|
| Phase-Vocoder oder WSOLA als Eigenbau im Kern | Es gibt keine FFT im Kern (`grep` über `src/`, `include/`, `dsp/`: 0 Treffer). FFT, Phasenführung und Transientenbehandlung wären neu zu bauen und die Tonscan-Messung (M19) für den Eigenbau zu wiederholen. R3 hat sie schon (G1 ±0,2 ct), R2, SoundTouch und Signalsmith sind in der Werkbank durchgefallen. WSOLA verschiebt Inhalt um die Suchtoleranz gegen die Beat-Position (dazu im Plan: GERATEN, ungemessen) | `plan.md` Zeile 16, ADR 006 |
| Rubber Band live in der Box | Später, nicht jetzt. Die Lage bestimmt dann der Stretcher, nicht der Beat (Fremdmessung WASM-Weg 0,18 ms, etwa 9 Frames, die Box-Tests fordern ±3 Frames; Phasenregler nötig). Rampen-Tonhöhe nativ nur als Timing gemessen. Eigene Kosten: R3-fein im 256er-Block Mittel 296 µs, p99,9 457 µs, Maximum 4458 µs bei 5333 µs Budget, zwei Boxen, Startverzögerung 2048 Frames. Roadmap-Größe L (Scheiben 34, 50 bis 52). Vorteil bliebe: der einzige Weg, der in Rampen die Tonhöhe hält | `plan.md` Zeile 17 |
| Loops im Tempo ihrer Aufnahme speichern | siehe ADR 026 | ADR 026 |
| REC bei ≠ 128 weiter mit Resampling (`umtasten`) | ändert die Tonhöhe um 12 · log2(T/128) Halbtöne, hebt sich nur mit dem Varispeed der Box auf und bliebe mit Keylock schief (−92 ct bei 135 BPM) | `slice-04.md`, `slice-05.md` Messung 5 |

## Folgen und Grenzen

Alle Zahlen GEMESSEN, sofern nicht „abgeleitet“ oder „nicht gemessen“ dasteht. Je Zeile die Berichtsdatei als Quelle
(Ordner `~/messungen/2026-09-30-keylock-umsetzung/`).

| Punkt | Wert | Quelle | Seit Task 7 (2026-10-08) |
|---|---|---|---|
| Tonhöhe am laufenden Kern (Instanz f) | 135 BPM: ohne Keylock +92,06 ct, mit Keylock −0,96 ct. Ton 110/130/134 BPM: −0,00 / −0,01 / −0,02 ct (Median über 27 Fenster). Fenster mit der Loop-Naht laufen bis ±13,5 ct (Naht des Testtons, abgeleitet aus Slice 4) | `slice-05.md` Messung 1, 4 | ersetzt: Box mit Dehner, Messung Task 7 Step 7/9 |
| Lage der Beats, Toleranz | Zielbild ±3 Frames wird nicht erreicht. Die Tests fordern ±64 Frames (1,3 ms) über die Matrix 100/130/170 BPM. Am Ziel: Klick-Loop max 7,3 Frames (0,15 ms), Musik-Loop max 22,8 Frames (0,47 ms). Ursache: R3 dehnt Transienten nicht mit und setzt ihren Anfang an das gedehnte Raster | `slice-05.md` Messung 2, `slice-03b.md` | ersetzt: Lage je Klick gegen gleich gespeistes rohes R3 ±2 (test_loopbox_keylock T5, seit 7b.7; vorher ±12) |
| **F-A**: unter etwa 95 BPM liegt die Variante zu früh | 2 bis 8 ms vor dem Raster, konstant je Tempo und unabhängig von der Beatzahl. 8 Beats bei 60 BPM −277…−144 Frames, bei 75 BPM −203…−93; echter 16-Beat-Loop bei 60 BPM Mittel −326 Frames, Maximum 372 (7,75 ms). Beim Wechsel Varispeed → Variante springt die Lage um diesen Betrag. Die Testmatrix (100/130/170) ist dort blind. Keine Regression: die Ein-Block-Fassung war bei 60 BPM schlechter. Bewusst dokumentiert statt behoben; einschränken oder ausgleichen entscheidet Andreas | `slice-3b4-review.md` F-A | ersetzt: Box mit Dehner, Versatz 0 (ADR 029 Entscheidung 8; die Versatz-Tabelle aus Task 7 Step 2 ist verworfen). Langsam liegt der Ring früh wie hier: Hann-Klick 60 BPM Mittel −389, max 474 Samples, 75 BPM −232 (ADR 029 Grenze 2b); seit 7b.2 setzt die Box beim Start aus Stille so früh ein wie alle folgenden Schläge. Q2 offen |
| **F-B**: REC bei 170 bis 200 BPM zu früh | 1,5 bis 4 ms (170 BPM −72 Frames, 200 BPM größter Betrag etwa 200 Frames = 4,2 ms). Die Datei trägt den Versatz in jede Wiedergabe. Ein Lagetest für REC fehlt | `slice-3b4-review.md` F-B | gilt weiter (REC-Umrechnung unverändert) |
| Reichweite nach heutigem Maß | ausliefern für 95 bis 200 BPM (Keylock) und 60 bis 170 BPM (REC); darunter bzw. darüber zuerst F-A/F-B entscheiden | `slice-3b4-review.md` „Urteil“ | ersetzt für Keylock: je Klick 0,00 gegen gleich gespeistes rohes R3 von 60 bis 200 BPM (ADR 029 Grenze 2b, T5 seit 7b.7); gilt weiter für REC |
| Rampen | In einer Rampe gleitet die Tonhöhe (Varispeed gegen die alte Variante), beim Erreichen des Zieltempos schaltet die neue Variante mit 20-ms-Blende um: Sprung um die Gesamtänderung (±1 BPM bei 130 etwa 13 ct, 128 → 140 etwa 1,5 Halbtöne, gerechnet). Rampen-Keylock wäre erst mit R3 live (Scheiben 50 bis 52). Glanz 2.6 (F12, `test_keylock_rampe` R1/R3, Sinus 1000 Hz, 100-ms-Fenster, gedruckte Werte): Rampe 140 → 141 bei Variante 140 gleitet jetzt bis +12,0 ct, größter Schritt je 100 ms 0,7 ct (vorher Sprung auf +167,5 ct, Schritt 140,1 ct); Rampe 140 → 128 nur mit Variante 140 höchstens 72,2 ct (vorher 142,7 ct), Wechsel aufs Original an der geometrischen Mitte. Mit vorab gerenderter Ziel-Variante (R4): Rampe 130 → 140 höchstens 58,3 ct mit 960er Pfadblende, 62,1 ct mit 4800 (das 100-ms-Messfenster sieht in der langen Blende beide Tonhöhen) (Wechsel an der geometrischen Mitte, vorher 72,7 ct mit einer Variante), nach der Rampe sofort −0,29 ct ohne Warten auf den Render. Am Ziel nicht gemessen (Tempo-Riegel), nur durch Kern- und Netz-Tests belegt | `plan.md` Zeilen 21 bis 23, `slice-05.md` Bedenken 4 | ersetzt: Keylock auch in Rampen, ±2 ct (T10) |
| Renderzeit | 32 Beats: 2,11 s CPU im Render-Faden, 2135 bis 2420 ms Wand (ohne und mit 3 nice-19-Lastprozessen 2420 / 2445 ms); unter 16 Busy-Loops (nice 19, alle Kerne) 13 749 ms. 4 Beats 0,31 s, 16 Beats 1,06 s. Die Zahl „etwa 1,9 s“ in der Prüfung von Slice 3 war abgeleitet, nicht gemessen | `slice-05.md` Messungen 6 und 7, `slice-03-review.md` Zeile 57 | ersetzt für die Box (kein Render); gilt weiter für REC |
| Echtzeit des Kerns während des Renders | Zuwachs `frame_luecken` 0 / 0 / 0 (vor, während, nach) in drei Läufen, auch unter 16 Busy-Loops; `cb_max_us` höchstens 916 µs in den mitgeschriebenen Fenstern. **Ungeklärt:** die Endzeile einer 11 Minuten langen Instanz meldet `cb_max_us` 10 152 µs (Budget 5333 µs) außerhalb der mitgeschriebenen Fenster, nicht reproduziert, Ursache offen (Keylock-Bezug weder bewiesen noch ausgeschlossen). Die Aussage gilt für die abgedeckten Fenster (215 von 660 s), nicht für die ganze Laufzeit | `slice-05.md` Messung 6, Bedenken 1 | ersetzt: Gate G1 (Task 7 Step 1) |
| **F-F**: Shutdown unter voller nice-0-Last | Abbruchlatenz des Renders ohne Last höchstens 3,9 ms, unter 3 nice-19-Busy-Loops höchstens 76,6 ms (gemessen). Das letzte `process` samt Ausleeren braucht 8 bis 13 ms CPU ohne Abbruchprüfung. Bei nice-0-Arbeit auf allen 16 CPUs (ein `make -j16`) etwa 4 s Wanduhr gegen `TimeoutStopSec=2s` (`cypherdj-kern.service:33`): **abgeleitet aus den CFS-Gewichten (SCHED_IDLE 3, nice 0 1024), NICHT gemessen**. Hieße SIGKILL statt sauberem Stopp. Bewusst dokumentiert statt behoben | `slice-3b4-review.md` F-F | gilt weiter (Render-Faden der REC-Umrechnung) |
| **F-G**: REC-Knopf der Seite gesperrt | Die Seite zeigt „REC 1“ und sperrt den Knopf, bis `/e/mitschnitt` kommt. Umrechnung ohne Last: 4 Beats 340 ms, 8 Beats 641 ms, 16 Beats 1295 ms, 32 Beats bei 135 BPM 2561 ms, bei 60 BPM 3963 ms (bis 4 s); unter nice-19-Last 32 Beats bei 200 BPM 41 s. Ein laufender Varianten-Render wird nicht unterbrochen. Der MCP `rec` hängt nicht (wartet nur auf die Kern-Quittung, höchstens 400 ms), aber `box laden` direkt nach `rec` kann bei ≠ 128 bis zum Ende der Umrechnung `pruefung` melden | `slice-3b4-review.md` F-G | gilt weiter (REC); der Varianten-Render entfällt |
| **F-C**: Variante aus fremden Daten | Nur konstruierbar: gleicher Loop-Name mit anderem Inhalt, Stopp Cypher gesetzt, Callback steht länger als ein Render (Aufbau: n = 1, 800 ms Stau). Der Kern nimmt dann eine Variante aus fremden Daten an, bis das Netz neu gerendert hat (1 Beat: 65 ms). Bewusst dokumentiert; der Vergleich über den Zeiger des Originals wäre die billige Abhilfe | `slice-3b4-review.md` F-C | entfällt (keine Varianten) |
| Klang | **Hörprobe steht aus.** R3 zieht Transienten vor (Kick-Band-Hüllkurve im Mittel −1,2 ms bei 130, −4,5 ms bei 135 BPM, Plan-Messung, Vorecho und Attackverschmierung vermutet). Die Hüllkurven-Korrelation des Musik-Loops 0,983 sagt „Inhalt gleich“, nicht „klingt gleich“. Linienzerfall bei Basstönen 120 bis 138 Hz ist möglich | `slice-05.md` Bedenken 5, `plan.md` Zeile 57 | gilt weiter: Hörprobe steht aus (R3 live statt offline, Optionen verschieden) |
| Lizenz | librubberband 3.3.0, GPL-2+, als dynamische Abhängigkeit (Debian-Paket `librubberband-dev`). Intern folgenlos; ein weitergegebenes Binär wäre es nicht. Der Ausweg wäre Bungee (MPL-2.0) | `plan.md` Zeile 18 und 60 | gilt weiter |
| Decks | unverändert: starten nur bei ihrer Basis (`kein_stretcher`). Keylock gilt nur für Loop-Boxen; A10 ist damit für Loops erfüllt, für Decks offen (Scheiben 34, 50 bis 52) | ADR 026, `stand/tempo-folgen.md` | ersetzt: Decks im Keylock (Tasks 2 bis 5) |
| Nicht gemessen | Klang (kein Ohr), Tempowechsel im Lauf am Ziel, Musik-REC (nur reiner Ton als Quelle), Loops über 16 Beats aus echter Musik (der 32-Beat-Loop war aus zwei Kopien gebaut), Server-Maschine, Stopp-Zeit unter nice-0-Last | `slice-05.md`, `slice-3b4-review.md` | teilweise ersetzt (Task 7 Messungen) |

## Prüfung der Tests

Slice 3c ergänzt zwei Tests, deren Mutanten die Prüfung überlebten: `/e/mitschnitt` trägt im asynchronen REC-Pfad Name,
Fassung, Status und Beat wie der synchrone (F-D), und REC-Aufträge laufen vor Varianten (F-E). Beide Tests sind unter dem
jeweiligen Mutanten rot (`slice-3c.md`).
