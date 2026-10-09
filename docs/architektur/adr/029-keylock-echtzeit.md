# ADR 029: Keylock in Echtzeit für alle Quellen (ein Knopf, R3 im Arbeits-Thread)

Status: umgesetzt im Zweig `keylock-4` für Decks und Loop auf dem Deck (Tasks 1 bis 5b, Abnahme am Ziel 4.2 und 4.3 an
Prüfinstanz g, 2026-10-08); Loop-Boxen mit Task 7 (eigener Zweig, Abnahme am Ziel an Prüfinstanz h 08.10., Abschnitt
Loop-Boxen). **Hörprobe steht aus** (Task 4 Step 4, Andreas;
Material unter `~/messungen/2026-10-07-keylock-echtzeit/task-04/hoerprobe/`). Nicht gemergt, Betriebs-Kern unverändert.
Löst teilweise ab: ADR 028 Entscheidung 4 (Fassungstausch für die Tonhöhe, ausgebaut) und ADR 027 für alles außer der
Varianten-Renderung der Loop-Boxen (die ersetzt Task 7; bis dahin gilt ADR 027 Entscheidung 1 bis 5 für die Boxen).
Plan: `docs/superpowers/plans/2026-10-06-keylock-echtzeit.md` (Fassung 4 und 4.1, Nachtlauf, Befund Sägezahn).

Anlass: Andreas 06.10. ~21:25 CLI: „an jeder dj software gibts nen knopf der über alles die tonhöhe gleichhält“, „aber
rendern und tauschen ist doch voll umständlich?“; 07.10. ~05:45 CLI: „wtf wir haben doch gestern besprochen dass wir ein
keylock für alle quellen bauen und nicht mehr jedes audio hoch und runter rechnen“.

## Kontext

Bis hier hielten die Decks die Tonhöhe nur über einen Fassungstausch: die Werkstatt renderte eine Fassung im Zieltempo,
die Seite tauschte sie auf eine Takt-Eins (ADR 028 Entscheidung 4); bis zum Tausch und in jeder Rampe lief Varispeed. Die
Loop-Boxen spielen eine vorab gerenderte Variante je Ruhetempo (ADR 027), in Rampen gleitet ihre Tonhöhe. R3 direkt im
Audio-Callback hat ADR 006 verworfen (p99,9 3,8 ms, Maximum 14,7 ms je 256er-Block bei 5,33 ms Budget). M3 hat R3 in
Arbeits-Threads mit Vorlauf-Ring gemessen: 4 Decks, 5 min unter Last, 0 Unterläufe, Callback-Maximum 214 bis 300 µs
(`messungen/M03-deck-echtzeit/laeufe/r3_je1_v{2,4,8}/`). M4 lieferte den Phasenregler (Faktor alle 43 Blöcke, |c| ≤ 100
ppm, Faktor nie 1,0) und die Faktor-Regel (Kartentempo in der Mitte des nächsten Fensters plus Vorhalt).

## Entscheidung

1. **Ein Knopf, global.** Regler `keylock` (Schalter, Vorgabe 1, kein Deck-Argument, SCHNITTSTELLEN §1.5) für Decks,
   Loop auf dem Deck und, ab Task 7, Loop-Boxen. Aus heißt Varispeed (ADR 028 Entscheidung 1). `kern.toml keylock = false`
   baut keinen Dehner (§2.1). Seite und Leitstand zeigen den Knopf, die Anzeige folgt dem Hörweg (Task 3, 3b).
2. **Dehner: R3 in Arbeits-Threads mit Vorlauf-Ring** (`dehner.h/.cpp`). Quellen-agnostisch: Band und Basis kommen über
   `DehnerQuelle`, der Dehner kennt kein Deck. Je Quelle ein Arbeits-Thread (SCHED_FIFO, JACK-Priorität − 5, Fehlerweg auf
   SCHED_OTHER gemeldet), ein Vorbereiter für alle, ein Wächter meldet einen Thread, der 500 ms nicht quittiert (Task 2.5).
   Der Thread füllt auch bei stehendem Deck und bei Keylock aus (sonst warten Laden und Entladen unbegrenzt, gemessen 21,3 s,
   Fassung 4.1 Punkt 2). Bau nach dem ersten Zyklus in eigenem Faden, nur der Dehner-Speicher wird gesperrt (2.5b, 2.5c).
   Faktor und Regler nach M4, gezählt in Samples (`DEHNER_REGEL_TAKT` = 43 · 256); Bandstart-Korrektur `dehner_versatz()`
   für die Decks 0 (Entscheidung 8, seit Keylock 4.6; bis c06b2b8 eine Tabelle über den Faktor 0,75 bis 1,35, am Hann-Klick
   eingemessen).
3. **Lesen über den `StreckLeser`** (`streck_quelle.h`, seit 633362d): Ansatz, Brücke, Epoche, Blenden und Naht an einer
   Stelle; das Deck nutzt ihn, die Loop-Box nutzt ihn in Task 7 (keine Kopie der Deck-Logik).
4. **Jedes Ereignis setzt am Sample an.** Start, Sprung, Rampe, Neustart, Knopf an: Ansatz mit Ziel-Sample
   `s_h = s + ANSATZ_FRIST` (4096 Samples, 85 ms); bis dahin spielt das Deck die Varispeed-Brücke. Der Ring ist ab `s_h` noch
   nicht eingeschwungen, die Blende Brücke → Ring (960 Samples) beginnt bei `s_h + STRECK_EINSCHWING` (1408, am Klick
   gemessen, Fassung 4.1 Punkt 1). Hörbar ab rund 115 ms nach dem Ereignis. Auf der Basis (Faktor 1) spielt der Direktweg,
   bitgleich (R3 ist bei Faktor 1 nicht transparent, ADR 020), **für eine Quelle, die dort einsetzt, ohne dass der Ring
   klang.** Eingeschränkt mit 7b.1 (08.10., Entscheidung der Hauptinstanz): kommt die Karte auf die Basis, während der Ring
   klingt (Rampe X → 128), bleibt der Ring hörbar bis zum nächsten Ereignis (Start, Stopp, Sprung, Laden, Raster, Knopf);
   das friert wie immer ein und setzt neu an, danach Direktweg. Grund: R3 hält die Phase stehender Töne nicht, die lineare
   960er-Blende Ring → Direktweg löschte teilweise aus (Box Sinus 416 Hz kleinste Spitze 0,27 statt 0,5, ≈ −5,3 dB; Deck
   213 Hz −12,6 dB, 1000 Hz −8,4 dB). Damit gilt die ADR-020-Aussage „Rückkehr auf die Basis endet im Direktweg“ für den
   Keylock erst ab dem nächsten Ereignis. Der Schatten rechnet ohnehin mit 1 ± 10⁻⁶, die Last bleibt gleich.
5. **Render-und-Tausch ausgebaut** (Task 3, 65f3587): `deck_keylock.ts`, `keylockTakt`, `rendereFassung`, `keylockRampe`,
   Feld `keylock` in `/lage`. `/k/deck/basis_tausch` und `werkstatt.fassung` bleiben als Werkzeuge (ADR 028 Status).
6. **Loop auf dem Deck im Keylock** (Task 5, 5b): der Ring wickelt im Thread wie das Deck, Naht ohne Rundungsdrift, das
   Raster beendet den Ring-Loop.
7. **Loop-Boxen in Task 7** (Detailschnitt `~/messungen/2026-10-07-keylock-echtzeit/task-07a/task7-final.md`): Box als
   `DehnerQuelle` über den `StreckLeser`, Varianten-Weg (`rendere_keylock`, `KlBox`, `START_HALTE_TAKTE`) aus. Bis dahin
   wirkt der Knopf bei den Boxen nur als „keine neuen Varianten“ (§1.5). REC-Umrechnung beim Schreiben bleibt offline (ADR 027
   Entscheidung 6, Fassung 4 Punkt 4).
8. **Deck-Versatz 0** (Keylock 4.6, Andreas 08.10. ~08:45 CLI auf die Empfehlung „Tabelle für die Decks auf 0“: „ok ja“).
   Gemessen an drei echten Drum-Loops (mfb, msgintro, boul) bei 96, 110, 132, 140, 150, 172 BPM gegen den Varispeed-Bezug
   (`~/messungen/2026-10-07-keylock-echtzeit/task-04/drums2/BERICHT.md`): ohne Korrektur näher am Beat in 18 von 18 Fällen
   (Hüllkurven-Einsatz 17 von 18), Bereich −40 … +3 statt −74 … +96 Samples, mittlerer Betrag 12,2 statt 45,0. Eine an Drums
   eingemessene Tabelle war nicht gedeckt (die zwei Messverfahren widersprechen sich in ihrer Größe). Der Hann-Klick liegt
   seither um die R3-eigene Lage neben dem Soll (−96 bei 96 BPM bis +41 bei 172,8, `task-01-fix/f3_versatz_roh.txt`); die
   Kern-Tests weisen sein Mittel aus und prüfen je Klick ±12 gegen rohes R3 und, wo es trägt, gegen das Soll; den Regler in
   der Rampe prüft `test_dehner` Test 12 mit dem Mittel ±3 gegen das Ideal gleicher Klickform (4.6b), die Entscheidung selbst
   Test 13 (`dehner_versatz` = 0, Hann-Klick 96 BPM bei −96,2; mit der alten Tabelle rot).

## Belege

GEMESSEN, wo nicht anders vermerkt. Abnahme am Ziel: Prüfinstanz g (eigene Ports, eigene Null-Senke, Ton-Wache, Echtzeit-
Schloss), Kern aus `keylock-4`, Messwerkzeug `djk/kern/tests/deck/ziel_lauf.py` (4.1 277ec2e, 51190a4; 4.2 a90a7b4; 4.3
ba4f679). Rohdaten `~/messungen/2026-10-07-keylock-echtzeit/task-04/` (Ergebnis je Lauf unter `laeufe/<lauf>/ergebnis.json`).

| Was | Wert | Grenze | Quelle |
|---|---|---|---|
| Lage je Klick, Rampe 128 → 132 über 32 Beats, Keylock an | in der Rampe max \|·\| 7,26 Samples, danach 8,17; gegen den Varispeed-Lauf max 8,07 | ±12 | `t42kla-…/ergebnis.json`, Bezug `t42-klick-aus-…` |
| Lage auf der Basis vor der Rampe (Direktweg) | 0,00 an 15 Klicks | 0 | dieselbe Datei, `lage_basis` |
| Lage, Mittel (Klick-Fassung, nicht Hann) | Rampe −2,16, nach der Rampe −4,17 | ausgewiesen | dieselbe Datei; mit 4.6 Klick für Klick gleich (Ansatz bei 128, Korrektur dort −0,004), `task-04/v46/laeufe/g46-keylock-klick-*` |
| Tonhöhe, reiner Sinus 1000 Hz, je 100 ms | max \|·\| 0,01 ct in 288 Fenstern (Rampe und danach), 0 Null-Läufe | ±2 ct, 0 | `t42-sinusrein-an-…` |
| Fehlerfall Keylock aus (Regler `keylock` 0 über `teil()`) | nach der Rampe +53,27 ct in allen 140 Fenstern (Soll 1200·log2(132/128) = 53,27); Ring hörbar 0,0 | rot, wie gefordert | `t42-sinusrein-aus-…`, `t42-klick-aus-…` |
| Echtzeit, 4 Decks im Keylock, 300 s, 10 Rampen zwischen 130 und 136 | je Deck `keylock_unterlauf` 0, `keylock_aufgegeben` 0, Ring hörbar 100 % von 14 955 Meldungen; `frame_luecken` 0; `cb_max_us` 1031 (p99,9 848, p50 558) | 0, 0, ≤ 2500 µs | `t43-echtzeit4-…`; Last: loadavg 60 s vor dem Start max 0,05, im Lauf vmstat idle min 75 %, r max 6 |
| Drum-Loop, Lage der Transienten gegen den Varispeed-Bezug, mit Tabelle (bis c06b2b8) | 96 BPM +87,9 (Spannweite 94,7); 110 +44,7 (45,5); 128 0,00 (Direktweg); 132 −7,3 (10,4); 140 −18,9 (19,8); 150 −38,2 (50,2); 172 −58,9 (64,8) Samples | ausgewiesen, keine Grenze im Plan | `t42-drums-tabelle.txt`, Gegenprobe Hüllkurve `t42-drums-gegenprobe-huelle.txt` |
| dasselbe, drei Quellen, mit und ohne Tabelle | ohne: −40 … +3, mittlerer Betrag 12,2; mit: −74 … +96, 45,0; ohne näher in 18 von 18 | Entscheidung 8 | `drums2/tabelle.txt`, `drums2/vergleich.txt` |
| Gegenprobe 4.6 am Ziel (mfb, Kern mit Versatz 0) | 96 −7,5, 132 −2,1, 172 −26,8; reiner Sinus in der Rampe max 0,01 ct | wie die Prüfkopie | `task-04/v46/laeufe/g46-*` (Last 2,4 bis 6,3, Gate < 8) |
| Echte Fäden gegen synchron am Klick | max Abweichung 0,0 Samples über 88 Klicks | – | `saegezahn/rohdaten.json` `kern_thread_vs_sync` |
| Einschwingen | Klickform bis 1280 gestört, ab 1408 Korrelation ≥ 0,985 (mit der alten Tabelle); seit Versatz 0 (4.6) ab 1408 min 0,9804, Grenze im Test ≥ 0,95 | – | Plan Fassung 4.1 Punkt 1, `task-02*/`; `test_deck_keylock` test14, `task-04/v46/test_deck_keylock_b.txt` |

Tests im Kern (Auswahl): `test_dehner` (Task 1), `test_deck_keylock` (Task 2, 5, 5b: Lage gegen rohes R3, Tonhöhe, Brücke,
Basis bitgleich, Sprung, Stopp, Neustart, Loop), `test_kern_keylock_faeden` (2.5, 3: rampe, quittung, waechter, stopp,
prio, startfehler, spaet, neustart, knopf, loop), je mit Mutationen, die rot werden.

## Verworfen

| Weg | Warum nicht | Quelle |
|---|---|---|
| R3 im Audio-Callback | p99,9 3,8 ms, Maximum 14,7 ms je 256er-Block | ADR 006 |
| Render-und-Tausch je Tempo (ADR 028 Entscheidung 4) | Andreas: „voll umständlich“; Tonhöhe wandert bis zum Tausch und in jeder Rampe | Plan „Auftrag“ |
| Knopf je Deck (`deck/<n>/keylock`, Fassung 3.1) | verfehlte „ein knopf der über alles die tonhöhe gleichhält“ | Plan Fassung 4 |
| Varianten-Renderung der Loop-Boxen weiter | „nicht mehr jedes audio hoch und runter rechnen“; ersetzt in Task 7 | Plan Fassung 4 Punkt 3 |
| Fix des Sägezahns im Dehner | Ursache ist R3 selbst (nackte R3-Instanz zeigt dieselbe Periode); Regler, Versatz, Kette, Fäden und Messung je mit einem Lauf ausgeschlossen | Plan „Befund Sägezahn“ |

## Grenzen

1. **Sägezahn von R3.** Die Klick-Lage wandert in einem Sägezahn, Periode rund 7,75 Beats bei 132 BPM, Spannweite wächst
   mit |f − 1| (rohes R3: 1,0125 3,8, 1,03125 11,8, 1,2 42,1 Samples, `saegezahn/rohdaten.json`). Am Ziel nach der Rampe auf
   132: Spannweite 7,96 Samples (0,17 ms). Tragende Lage-Messgröße ist darum je Klick gegen rohes R3 (Kern-Tests) bzw. am
   Ziel gegen Ideal und Varispeed-Bezug, nicht ein absolutes Mittel.
2. **Absolute Lage hängt am Material.** Mit der Tabelle (bis c06b2b8, am Hann-Klick eingemessen) lag der Drum-Loop mfb bei +88
   (96 BPM) bis −59 (172 BPM). Seit 4.6 (Versatz 0, Entscheidung 8) am Ziel gegengeprüft (`task-04/v46/laeufe/g46-drums-mfb-*`):
   96 BPM −7,5, 132 −2,1, 172 −26,8 Samples, gleich den Läufen der Prüfkopie ohne Tabelle (drums2: −7,5, −2,1, −26,8).
   Schnelle Tempi bleiben früh (alle drei Quellen bei 172: −22 bis −40). Der Hann-Klick liegt jetzt neben dem Soll (Punkt 8).
3. **Mittel nach einer Rampe.** Klick-Fassung nach der Rampe 128 → 132: Mittel −4,17; mit Ansatz direkt bei 132 −1,99
   (Befund Sägezahn). Der Versatz gilt fest je Ansatz bei f0, eine Rampe danach setzt nicht neu an (Erklärung abgeleitet, nicht
   gemessen).
4. **Stem-Griffe** wirken im Keylock nach 102,5 ms (Test 18 prüft < 150 ms), Fassung 4.1 Punkt 4.
5. **Loop-Länge bei krummem fpb** (Basis 124, 126, 130, 125,3 …) wird auf ganze Frames gerundet: Ring und Deck wickeln gleich,
   laufen aber zusammen gegen das Beat-Raster (bis ±0,47 Frames je Durchlauf). Offen, Welle-2-Loop-Modell (E9), nicht Keylock
   (`task-05b/p5_looplaenge_rundung.txt`).
6. **Übersprechen im Sinus-Test.** Mit Sinus links und Klick rechts im selben Material stört der Klick den Sinus (R3 rechnet die
   Kanäle zusammen): 1 von 288 Fenstern 17,4 ct, ein 10-ms-Stück 182 ct, Phase davor und danach gleich
   (`t42-sinus-an-…`). Reiner Sinus 0,01 ct. Gehört nicht geprüft. Seit 4.6 trifft die Störung auch in
   `test_kern_keylock_faeden` (knopf, loop) ein Messfenster (17,40 ct); dort zählen Fenster mit Klick daneben getrennt
   (ausgewiesen), die Tonhöhe ohne Klick prüfen die Tests mit reinem Sinus.
7. **Offen:** Rampe mit Fäden gegen synchron am Klick in der Rampe; Task 6 (geplante Ereignisse ohne Knick) nur auf Andreas'
   Ja; Klang (Hörprobe).

## Folgen

- Die Tonhöhe hält in Rampen (0,01 ct am Ziel), nicht erst nach einem Tausch. Ein Ereignis kostet 85 ms Varispeed-Brücke und
  rund 30 ms Einschwingen, bevor der Ring klingt.
- Last: je Deck ein R3 im eigenen Faden; mit 4 Decks im Keylock am Ziel Callback-Maximum 1031 µs über 5 min.
- Die Loop-Boxen bleiben bis Task 7 auf ADR 027; erst danach gilt „ein Knopf für alle Quellen“ ganz. **Stand Task 7 (Zweig
  `worktree-agent-a15c04f71e446464a`, nicht gemergt):** umgesetzt, siehe Abschnitt Loop-Boxen.

## Loop-Boxen (Task 7, 08.10.2026)

Je Box ein eigener Dehner auf festem Platz (`KEYLOCK_QUELLEN = 6`: Plätze 1 bis 4 die Decks, 5 und 6 die Boxen,
`dehner[DECKS + b]`; 8 Fäden, davon 7 SCHED_FIFO), Band über `BoxBand` (Loop gewickelt, `box_anker`), Leihe beim Start und Laden (R-B1), Rückgabe beim Stopp;
der Schwanz eines Loops kommt aus dem Ring. Die Varianten-Renderung (ADR 027 Entscheidungen 1 bis 3 und 5) ist ausgebaut:
keine Variante, kein Warten beim Laden (bis 4 s), kein Halten bis zur Takt-Eins (F14); `KeylockRender` rechnet nur noch die
REC-Umrechnung (ADR 027 Entscheidung 4 und 6 gelten). Versatz 0 wie für die Decks (Entscheidung 8, auf die Box erstreckt von
der Hauptinstanz aus „ein keylock für alle quellen“); die Erweiterung der Tabelle aus Task 7 Step 2 ist verworfen.
Abweichung von Vertrag 4: sind alle 4 Plätze der Leihe einer Box verliehen (`BOX_KEYLOCK_BAENDER`, ohne Quittung des
Arbeits-Threads), wartet die Box nicht: sie spielt diesen Loop im Varispeed (`kein_platz` zählt) und setzt erst beim nächsten
Ereignis (Start, Laden, Raster, Knopf) neu an, nicht schon, wenn ein Platz frei wird (Prüfung Task 7 m3: 2000 Blöcke = 10,7 s
ohne Ereignis Varispeed, erst ein Raster setzt an; Test `leihe_voll`). `FREI_MAX 16` ist der Freigabe-Ring abgelöster Loops
(E-m9), nicht die Leihe; läuft er über, zählt `frei_verloren` (soll 0). Neues Ton-Messgerät `tests/stretch-bench/keylock_ton_fenster.py` (100 ms
je Fenster, Schritt 50 ms; Kalibrierung: Fehler ≤ 0,003 ct, harter Schnitt 115 ms gemessen als 200 ms Fehlklang; das alte
`keylock_ton.py` sah denselben Schnitt nicht, Median 0,00 ct).

Belege (Rohdaten `~/messungen/2026-10-07-keylock-echtzeit/task-07/`):
- Last (Gate G1, `g1_1a_tabelle.txt`, `g1_1b_tabelle.txt`): offline N = 4, 5, 6, 8 Quellen je 60 s: 0 Unterlauf, Render max
  ≤ 1504 µs; am Ziel 9 Läufe à 5 min (100, 170, 128 BPM, Rampe, Boxen an/leer/still) alle Grenzen grün, cb_max 1031 bis
  2346 µs; Instrument-Check mit Störer rot wie gewollt.
  (Stand vor dem Merge von 4.6 und vor 7b; die Läufe von 7b am Ziel: `task-07b/`, Abschnitt unten.)
- Ton (`step9_ergebnis.txt`): fest 135 und 128, Rampen 128 → 132 und 130 → 140: max 0,10 ct, kein Fenster außerhalb ±2 ct.
  Gegen den alten Weg (`step7_vergleich.txt`): alt bis 11 ct für bis 6 s nach dem Einsatz, 128 bitgleich.
- Echtzeit 4 Decks + 2 Boxen, 5 min, 30 Box-Ereignisse: cb_max 1207 µs, 0 Unterläufe, 0 aufgegeben, ring_voll 0.
- 7b am Ziel (`task-07b/p5_ziel_ergebnis.txt`, Prüfinstanz h): 128 BPM bitgleich zum alten Weg (0 von 270 000); REC bei 135
  mit Wiedergabe über den Dehner gefahren, deren Tonhöhe am Ziel **nicht gemessen** (das Klick-Maß ist schwach: an +2,5 ct,
  Fehlerfall Knopf aus +22,8 ct statt +92), getragen von K3 offline (±2 ct); erster Drum-Schlag 80/96/100 BPM Keylock gegen Varispeed
  −0,50 / +0,13 / +0,35 dB.

Grenzen der Boxen:
1. **Brücke.** Laden in eine klingende Box und Start weniger als rund 115 ms vor der Eins klingen 100 bis 150 ms im Varispeed
   (+78 bis +92 ct bei 135 BPM), bevor der Ring übernimmt. Der alte Weg hatte dort die richtige Tonhöhe, aber den neuen Loop
   erst nach bis zu rund 5 s (Q1, Hörprobe).
2. **Lage.** Klick-Loop 135 BPM am Ziel: Mittel +5,4, max 13 Samples (12 Klicks). Echte Drums (`step9_drums.txt`, mfb):
   Keylock − Varispeed −5,3 / −3,6 / −35,6 Samples bei 96 / 132 / 172 BPM, nur 4 bis 7 Treffer je Tempo; in Richtung und Größe wie
   das Deck (−7,5 / −2,1 / −26,8). **Start aus Stille** (7b.2): langsam liegt der Ring früh (Hann-Klick 100 BPM −104, 80 BPM
   −217, 60 BPM −420 Samples); bis 7b.2 öffnete die Box erst beim Einsatz und schnitt den ersten Klick an (100 BPM −11,2 dB,
   80 BPM −25,5 dB). Jetzt liefert das Band vor dem Einsatz Stille und die Box hört den Ring ab E − 768: erster Klick gegen
   den eingeschwungenen −0,12 … +0,29 dB, Korrelation ≥ 0,9992, Lage ≤ 2 Samples gegen rohes R3 (60 bis 130 BPM, T4a). Echte
   Drums (mfb, offline, `task-07b/drums/drums_einsatz.txt`): erster Schlag Keylock gegen Varispeed −0,68 … +0,12 dB (vorher
   −0,03 … +0,55). Preis: der Sinus-Einsatz ist für R3 ein harter Ton-Anfang, das erste 100-ms-Fenster liegt bis −4,5 ct
   (60 BPM), ab 50 ms ≤ 0,57 ct.
2b. **Reichweite der Lage** (7b.7): je Klick liegt die Box bei 0,00 Samples gegen ein gleich gespeistes rohes R3 von 60 bis
   200 BPM (T5, Versatz 0 und 5000, Grenze ±2; `task-07b/p7_t5.txt`); das Deck ist gegen gleich gespeistes R3 nur bei 130 bis
   200 BPM gemessen (`hoch-bpm/deck_echt.txt`), darunter ist es aus „derselbe Code“ geschlossen (ABGELEITET). Die frühere Abweichung
   über 180 BPM (190: 94 Samples) war ein Messartefakt: die Referenz speiste R3 in festen 256er-Blöcken, der Dehner nach
   `getSamplesRequired()`, und R3 ist bei f ≈ 1,48 blockgrößenempfindlich (`hoch-bpm/`). Absolut liegt der Hann-Klick langsam
   früh: 60 BPM Mittel −389, max 474 Samples (9,9 ms), 75 BPM −232, 100 BPM −90; schnell spät: 170 +35, 200 +42. Die Lage
   echter Drums ist unter 96 BPM ungemessen (Lage am Ziel nur 96/132/172; bei 80 bis 100 nur die Energie des ersten Schlags,
   offline und am Ziel, Punkt 2).
3. **Rückkehr auf die Basis** (Rampe X → 128, Decks und Boxen). Bis 7b.1 blendete der Ring dort linear in den Direktweg und
   löschte teilweise aus (Box Sinus 416 Hz, 140 → 128: kleinste Spitze 0,2719 statt 0,5, ein Fenster −13,99 ct; Deck 140 → 128:
   213 Hz −12,6 dB, 1000 Hz −8,4 dB, Rauschen −2,7 dB; `task-07-pruefung/qualitaet/proben/probe_deck.txt`). Seit 7b.1 bleibt
   der Ring hörbar (Entscheidung 4): Box 130/140/150 → 128 kleinste Spitze 0,4990 bis 0,4997, jedes Fenster ±2 ct (T10);
   Deck 130/140/150 → 128 Pegel ≥ −0,04 dB, max 0,019 ct (Test 32; `task-07b/p1_*`). **Seit 7c.4 (Entscheidung der
   Hauptinstanz 08.10.):** (a) Knopf aus auf der Basis bei gehaltenem Ring: der Ring bleibt hörbar (bei Faktor 1 klingt er wie
   der Direktweg), er geht erst beim nächsten Ereignis oder wenn das Tempo die Basis verlässt (dann normal in den
   Varispeed-Weg). Vorher (Nachprüfung 7b C) brach der Knopf dort ein: Sinus 416 −4,92 dB, Rauschen −3,81 dB im tiefsten
   240er-Fenster; jetzt −0,17 / −0,44 dB (Box T19), Deck −0,00 / −0,53 dB (Test 32). (b) Jedes Einfrieren auf der Basis (Ring
   bzw. Blendenplatz → Direktweg) blendet gleich laut (sin/cos) statt linear: Rauschen Box-Raster −2,31 → −0,23 dB, Deck-Sprung
   −2,64 → −0,58 dB. **Grenze bleibt:** ein stehender Sinus in Gegenphase bricht beim Ereignis weiter ein (Box-Raster Sinus 416
   −5,09 → −2,18 dB; Deck-Sprung Sinus 1000 −7,99 → −5,19 dB, 213 Hz −9,69 dB; Test 32 und T19, `task-07c/p4_*`). Die
   Blenden-Tests gegen den idealen linearen Übergang (≤ 0,02) betrifft (b) nicht: sie liegen alle außerhalb der Basis.
4. **Box-Zähler** (Unterlauf, aufgegeben, ring_voll, kein_platz je Box): seit 7b.3 bzw. 7c.3 in `/zustand/box ,iiiiii`
   (SCHNITTSTELLEN §5.5b, additiv, 50 Hz je Box mit Loop; Test K4 in `test_kern_box_keylock` über das Netz, kein_platz mit
   Wert 2, Mutation `BOX_ZAEHLER_VERTAUSCHT` rot; ring_voll nur als Wache, im Test immer 0; `ziel_lauf_boxen.py` wertet sie im
   Gate). `frei_verloren` steht weiter nur als Zugriffsfunktion.
5. **Ungehört:** Klang live gegen den Offline-Render; Material `task-07/hoerprobe/` (1 bis 5).
