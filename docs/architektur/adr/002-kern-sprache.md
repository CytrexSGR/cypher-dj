# ADR 002: Sprache des Kerns

- **Status:** angenommen; Begründung nach der Nachprüfung von Dossier 01 (K5, K9) am 2026-09-23 neu gewogen
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A23
- **Hängt zusammen mit:** ADR 001, 006, 016

## Kontext

Der Kern rechnet Uhr, Decks, Keylock, Mixer, Stellwerk-RT und Messer im Echtzeit-Callback. Die Bausteine, die er
braucht, sind C oder C++: Rubber Band, Bungee, libjack, libebur128, Faust-Ausgabe, später Ableton Link und lilv.
A23 erlaubt Eigenbau in C++ oder Rust.

## Entscheidung

- **Kern in C++20**, gebaut mit CMake und Ninja (g++ 13.3 auf DJ-Maschine). **Notbahn und Aufnahme in C.**
- Echtzeit-Disziplin ist **Mechanik, nicht Vorsatz**: keine Allokation, keine Sperre, kein I/O, kein `dlopen`
  im Callback und in den Stretcher-Arbeitsfäden; ein Allokations- und Sperr-Wächter im Testbetrieb (etwa ein
  `operator new`, der im Echtzeit-Faden zählt und abbricht), Last-Dauerläufe im Chaos-Prüfstand als Abnahme.
- Satelliten: Leitstand, MCP, Spieler-Treiber in Node/TypeScript; Rechner, Analyse, Werkstatt in Python.
- Rust bleibt offen für Teile ohne C/C++-Abhängigkeiten.
- **Warum C++ trotzdem:** die gemessenen Vorlagen dieser Nacht sind C/C++ (`uhrkern.cpp`, `klick_kern.cpp`,
  `deckprobe.cpp`, `minikern.c`, `notbahn.c`), und Rubber Band hat nur eine dünne Rust-Brücke (Crate 0.1.5, 120
  Downloads). Dagegen gewogen: Speicherfehler sind genau die Absturzklasse, die Rust ausschließt, und ein
  Kern-Absturz kostet eine Notbahn-Schleife (01 NP K5). Ausgleich als Mechanik: ASan/UBSan-Bau in jedem Testlauf
  des Prüfstands, dazu der Allokations- und Sperr-Wächter.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Rust für den Kern | im Callback gleichwertig; **nicht** abgelehnt wegen fehlender Brücken (die Begründung „Link, lilv, Faust brauchen je eine eigene Brücke“ ist falsch: `faust -lang rust` erzeugt Rust, `rusty_link` 0.4.9, LV2-Hosts `livi` 0.7.5 und `lilv` 0.2.4 existieren; nur Rubber Band hat eine dünne Brücke), sondern weil alle gemessenen Vorlagen C/C++ sind und morgen gebaut wird; Speichersicherheit spricht für Rust | 01 §3.3 (Callback Rust 1,09 µs, C++ 0,77 µs im Mittel; NP 1,17 / 0,77), 01 NP K5 |
| JavaScript im Echtzeit-Teil (Stellwerk-Prototyp weiter nutzen) | schlechtester Block 7 053 µs = 132 % des Budgets bei 256, Nullpunkt ohne Plan 14 507 µs | 09 NP b3 |
| Python im Echtzeit-Teil | Block-Analyse p99 15,2 ms bei 21,3 ms Budget (1024), NP p99 17,3 ms | 08 §4.f |

## Folgen

- Kein Compiler-Schutz gegen Echtzeit-Fehler (01 §6.2 Risiko 3): der Wächter und die Dauerläufe sind Teil
  jeder Abnahme, nicht optional.
- Mit Rubber Band ist der Kern GPL-2.0-or-later; intern folgenlos, bei Weitergabe zu klären (01 §6.2, ERGEBNIS §4).

## Beleg

01 §3.2 (Callback Mittel 0,77 µs, Maximum 6,9 µs bei 2 667 µs Budget, 0 Aussetzer in 5 min bei 128 und 256,
Last 19 bis 28; **eingestuft nach 01 NP Punkt 2 und K9: die Plattform bedient einen fast leeren FIFO-Callback
zuverlässig, über die Last eines Kerns sagt das nichts**), §3.3, §6.2; 01 NP K5; 09 NP b3; 08 §4.f.

## Kippt, wenn

Der Wächter im Testbetrieb dauerhaft Verstöße findet, die sich in C++ nicht beherrschen lassen, oder der Prüfstand
Speicherfehler im Kern zeigt (ASan, Abstürze); dann Teile nach Rust mit `assert_no_alloc` (01 §3.3, 01 NP K5).
