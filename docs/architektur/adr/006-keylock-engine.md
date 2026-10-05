# ADR 006: Keylock-Engine je Einsatz

- **Status:** vorläufig; Messungen M3 (Echtzeit in Arbeits-Threads, Pull-Modus), M4 (Rampen, kleine Faktorwechsel,
  Bungee-Tonscan), M19 (große Streckfaktoren beim Einlesen) und der Hörtermin M18 (R3 gegen Bungee) stehen aus;
  nach der Nachprüfung von Dossier 01 (K1 bis K4) am 2026-09-23 korrigiert
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A9, A10, A12
- **Hängt zusammen mit:** ADR 020 (Hörwege), 011 (Werkstatt)

## Kontext

A10: Tonhöhenerhaltung „ist pflicht für alles“. A12: jeder Loop wird einmal offline auf die Set-Basis gestreckt,
live macht der Keylock nur die Abweichung. Die Werkbank (`tests/stretch-bench/ERGEBNIS.md`) prüfte 59
Konfigurationen im Browser, Dossier 03 sieben Maschinen nativ (offline, ungeprüft).

## Entscheidung

| Einsatz | Engine | Einstellung |
|---|---|---|
| Einlesen (Basis-Datei, Stems) | **Rubber Band R3 offline** (Bibliothek oder `rubberband -3 --timemap`) | Float rein und raus, **−12 dB Luft vor dem Strecken**, Trim beim Laden aus `ziel_lufs`; Timemap aus der Tempo-Karte auf das starre Raster der Set-Basis; Stimmungskorrektur im selben Lauf (`SCHNITTSTELLEN.md` §12.3). Tonhöhe gemessen nur für Faktoren bis rund 5 % neben 1 (0,95522 und 1,04121); MiniMax-Songs brauchen 0,71 bis 1,42 (c_drift: 89,9 bis 180,7 BPM): darum Halb-/Doppeltempo-Wahl und Tor `streckfaktor` ±15 % bis M19 |
| Einzelschüsse, Pads | **R3 offline** auf die Set-Basis vorgerendert, ohne Stretcher gespielt | bei neuer Set-Basis neu rendern |
| Live bei Tempoabweichung | **Rubber Band R3 nativ** (3.3.0), `OptionProcessRealTime \| OptionEngineFiner \| OptionChannelsTogether`, in Arbeits-Threads mit Vorlauf (Vorgabe 4 Blöcke, M3); **höchstens 2 R3 je Arbeits-Thread** (01 NP K1), 4 Stretcher also mindestens 2 Threads | **Start:** im Lade-Faden anlegen, `getPreferredStartPad()` füttern, `getStartDelay()` verwerfen **und einen Pull-Zyklus samt `retrieve` durchziehen**, erst dann über die Warteschlange an den Arbeits-Thread (01 NP K3: sonst kostet der erste Block 4,6 bis 6,4 ms); gilt auch für den Neustartpfad und das Anwärmen des Schatten-Stretchers. Faktorwechsel 50 ms vor dem Ratenwechsel (Timing, 03 §4b2); Phasenregler; höchstens 4 Echtzeit-Stretcher gleichzeitig |
| Zweite Wahl live | **Bungee 2.4.30** hinter derselben Maschinen-Schnittstelle | M4 (2026-09-25, E8): trägt technisch (Basstöne 0,04 ct gegen R3 0,75 ct, Echtzeit 0 Null-Samples); offen nur der Hörtermin |
| nie | R2, SoundTouch, Signalsmith | siehe unten |

Bei Faktor 1 liegt **kein** Stretcher im Hörweg (ADR 020).

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Rubber Band R2 | tiefe reine Töne behalten die Umspiel-Tonhöhe (110 Hz → 105,074 Hz, auch im offiziellen Programm) | 03 §4c |
| SoundTouch | driftet bei Tempowechseln (−3,867 ms in 30 min), Latenz streut mit Musik 5 bis 7,5 ms je Schlag; zerlegt 30,87 Hz (−79,7 ct) | 03 §4a; ERGEBNIS §2.2, §2.1 |
| Signalsmith | Tonhöhe in keiner Konfiguration (+13,4 bis +34,1 ct am Sinus, Obertöne tiefer Basstöne bis 67,2 ct verschoben) | ERGEBNIS §2.1 |
| R3 im Callback direkt | stoßweise Rechenlast: p99,9 3,8 ms, Maximum 14,7 ms je 256er-Block; Stem-Deck 16 Blöcke über Budget | 03 §4e |
| Doppelknoten aus der Werkbank | **zurückgestellt, nicht widerlegt.** Gebaut ist er nur für WASM (Hülle um `reset()` bei jedem Faktorwechsel). Die 50 ms Vorhalt (+0,01/−0,11 ms, 03 §4b2) belegen nur das Timing eines nativen Einzelknotens. Die einzige native **Tonhöhen**messung eines Faktorwechsels (ein Knoten, ohne `reset`, ohne Vorhalt) lag 95 ms über 10 ct und hatte 128 Null-Samples, schlechter als der Doppelknoten mit 27,5 ms. Mit Vorhalt ist der Einzelknoten auf Tonhöhe ungemessen: M4 entscheidet; bis dahin gibt es live keine Faktorsprünge (ADR 004) | ERGEBNIS §2.3, §2.6 (Z. 180, 185 bis 187), 03 §4b2 |
| R3 immer im Hörweg (auch bei Faktor 1) | bei 1,0 nicht transparent (Artefakte −63,7 dB statt −102,8), weichere Transienten | 03 §4c; ERGEBNIS §2.5; ADR 020 |

## Folgen

- Klang ungehört: R3 macht Snare und Hats messbar weicher (Vorecho +4,5 / +7,5 dB, Kick-Anstieg 9,07 statt 3,09 ms;
  gemessen offline im OfflineAudioContext am WASM-Weg, nativ ungemessen). Hörprobe R3 gegen Bungee im Hörtermin.
- Tempo-Rampen sind nativ nur als Timing gemessen (02 NP N5), die Tonhöhe in Rampen nicht (ERGEBNIS §8: nur
  Sprünge): M4.
- Kapazität für den schlimmsten Fall: weicht das Set von der Basis ab, rechnen **alle** hörbaren und vorgehörten Decks
  gleichzeitig (01 NP K4); Faktor 1 senkt nur den Mittelwert. Günstigere Option `OptionWindowShort` (R3 kurz): 2,5 %
  statt 7,4 % eines Threads je Stretcher, aber Artefakte −29,2 statt −42,3 dB (01 NP K2, 03 §4c); Klangpreis
  entscheidet Andreas an der Werkbank, nicht dieses ADR.
- Die Kommandozeile klemmt bei ±1,0 auch mit `--ignore-clipping` (08 NP K5): darum die −12 dB Luft.
- Lizenz GPL (intern folgenlos); Bungee MPL wäre frei weitergebbar.

## Beleg

ERGEBNIS §1 (R3 einzige von 59 Konfigurationen über alle vier Tore: G1 ±0,2 ct, G2 0,18 ms, G3 2,05 dB, G4 rtf_4
2,73), §2.1 (Tonscan 30,87 bis 261,63 Hz, Grundtöne 0,00 ct), §2.6; 03 §4a (30 min, 100 Tempowechsel: R3 −0,105 ms,
Bungee −0,026 ms), §4b, §4b2, §4c (R3 110,000 Hz), §4d (nach Roll zeitgleich, −0,00 Samples), §4e (Bungee p99,9
161,6 µs), §4f (Schüsse 0,13 bis 0,31 s, Länge ±0,4 Frames); **01 NP K1** (Pull-Modus, wie ein Deck rechnet: 8 R3 mit zwei
Phasen im echten Callback 377 Überläufe in 60 s, 0 von 111 Schlagabständen exakt; ein Thread trägt 2 R3 sicher, 4
knapp; die frühere Angabe „8 versetzt mit 120 µs Reserve“ aus 01 §4.5 galt nur im Druck-Modus ohne Deck-Semantik),
**01 NP K3** (erster Block eines frischen R3 4,6 bis 6,4 ms; nach einem Pull-Zyklus mit `retrieve` 0,25 bis 0,32 ms,
nur offline gemessen); 02 Probe c (Polster und Verzögerung je 2 048 Samples); 07 `b_timemap.log` (Timemap R3: Rest
0,19 ms RMS, max 0,58 ms; R2 1,94 ms; ohne 45,26 ms; **eingestuft: belegt die Timemap-Mechanik an einem synthetischen
Klick mit bekannter Wahrheit, die Timemap stammt aus den wahren Schlagzeiten; über die Tempo-Karte aus beat_this an
MiniMax-Songs sagt es nichts, das misst M13**), `b_strecken.log` (R3 110,000 Hz, Bass −0,11 ct, nur Faktor 134/128).

## Kippt, wenn

M3 zeigt Unterläufe mit R3 in Arbeits-Threads bei 4 Decks und 2 R3 je Thread (dann mehr Threads, R3 kurz, Bungee
oder weniger Keylock-Decks); M4 zeigt Tonhöhenfehler oder Null-Samples in Rampen oder bei kleinen Faktorwechseln
(dann Doppelknoten nativ); M19 zeigt, dass R3 bei Faktoren um 0,7 oder 1,4 hörbar leidet (dann engeres Tor
`streckfaktor`, Generierung näher an der Set-Basis); Andreas bevorzugt im Hörtermin Bungee (dann Bungee live, R3
offline).


## Nachtrag 2026-09-23 13:3x
VORLÄUFIG, 2026-09-23 13:3x: die Nachprüfung zu Dossier 01 misst R3 in FIFO-Arbeits-Threads mit Vorlauf mit 8 je Thread ohne Unterlauf (16 auf 2 und 32 auf 4 Threads, Grenze erst bei 16 je Thread; SCHED_OTHER statt FIFO: 23 Unterläufe). Die Grenze entscheidet M3 (Scheibe 30). Die Obergrenzen „2 R3 je Arbeits-Thread“ und „4 Echtzeit-Stretcher“ in diesem ADR und in ADR 020 gelten bis dahin als vorläufig; Stems mit Keylock sind nach dieser Messung machbar.

## Nachtrag 2026-09-25: M19 gemessen

`tor_streckfaktor` 0,20 (vorher 0,15; mit der groben 30-ms-Kontrolle wären 0,30 gegangen, es gilt der strengere Wert), `stimmung_max_cent` 35 hält auf 167 Tönen. Befund Linienzerfall: R3 verfehlt einzelne stationäre Töne zwischen 120 und 138 Hz um bis zu 28 ct, schon bei 128/134, offline wie im Echtzeit-Modus, nicht aus der Timemap; `--window-short` ist in 24 von 24 sauber. Zu prüfen in M4/M18: R3 kurz für tonale Decks. Beleg `messungen/M19-keylock-gross/BERICHT.md`.
