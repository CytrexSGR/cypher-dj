# ADR 020: Hörwege im Deck (kein Stretcher bei Faktor 1)

- **Status:** vorläufig; Messungen M5 (Wechsel direkt ↔ Stretcher, Datei-Tausch), M3 (Stretcher in Echtzeit), M16
  (Stretcher auf der Stem-Summe) stehen aus; Direktweg allein trägt ab Scheibe 1
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A9, A10, A12, A14, A20
- **Hängt zusammen mit:** ADR 006, 007, 011, 004

## Kontext

A12 (entschieden, Andreas „kk“): „Beim Einlesen wird jeder Loop einmal offline auf die Set-Basis gestreckt
(zusätzliche Datei), live macht der Keylock nur die Abweichung. Keine Tempo-Stufen; steht das Set länger woanders,
rendert der Zerleger im Hintergrund auf die neue Basis.“ Der Entwurf „Robustheit“ lässt R3 trotzdem immer im
Hörweg (gleiche Latenz für alle Decks); „Spielbarkeit“ legt bei Faktor 1 keinen Stretcher in den Hörweg; „KI“ sagt
dasselbe ohne Umschaltmechanik. Die Richter 1 und 3 empfehlen den Direktweg, Richter 3 mit genau einem
Stretcher-Weg und ohne Sprungmaschine, bis M2b sie verlangt.

## Entscheidung

1. **Direktweg:** Ist das Set-Tempo gleich der Basis der geladenen Datei (|bpm/basis − 1| < 10⁻⁶), liest das Deck die
   Datei am Soll-Lesekopf ohne Stretcher, im Callback. Stems werden dort ohne Stretcher gemischt (Stem-Stumm wirkt eine
   Periode nach dem Griff). **Was klingt:** hat die geladene Fassung Stems, klingt die Stem-Summe und die Basis-Datei
   wird nicht geladen; ohne Stems klingt die Basis-Datei und `stem/*` wird abgelehnt (`keine_stems`). Umgeschaltet wird
   nur beim Laden, weil Demucs-Stems summiert nicht bitgleich den Mix ergeben; Referenz-Hüllkurve und Kreuzenergien
   stammen aus genau dem, was klingt (`SCHNITTSTELLEN.md` §4.4, §13.1).
2. **Schatten-Stretcher:** je **hörbarem oder vorgehörtem** Deck läuft ein R3-Stretcher warm mit (Faktor 1, Eingang
   aus demselben Band, in einem Arbeits-Thread mit Vorlauf). Weicht das Tempo ab (Rampe, Hand-Segment), übernimmt er
   vor dem ersten abweichenden Sample mit **20-ms-Kosinusblende**; kehrt das Tempo auf die Basis zurück, blendet das
   Deck zurück auf den Direktweg (auf einer Schlaggrenze). Der hörbare Stretcher bekommt nie einen Faktor näher als
   10⁻⁶ an 1,0 (M4 E4, 2026-09-25: Rückkehr auf genau 1,0 springt die Tonhöhe bis 87 ct für 45 ms); ein Tempo, das auf
   die Basis zurückkehrt, endet deshalb im Direktweg. Auf dem Stretcher-Weg läuft die **Stem-Summe** durch einen
   Stretcher. Budget: höchstens 4 Echtzeit-Stretcher gleichzeitig, höchstens 2 je Arbeits-Thread (01 NP K1); der
   Leitstand verriegelt mehr (`budget_stretcher`). [VORLÄUFIG, 2026-09-23 13:3x: die Nachprüfung zu Dossier 01 misst R3 in FIFO-Arbeits-Threads mit Vorlauf mit 8 je Thread ohne Unterlauf (16 auf 2 und 32 auf 4 Threads, Grenze erst bei 16 je Thread; SCHED_OTHER statt FIFO: 23 Unterläufe). Die Grenze entscheidet M3 (Scheibe 30).] Ein Schatten-Stretcher wird im Lade-Faden angelegt und einmal mit
   `retrieve` durchgezogen, bevor er warm mitläuft (01 NP K3).
3. **Nachrendern:** steht das Set-Tempo **16 Takte** ruhig auf einem Wert ungleich der Basis (Vorgabe, gesetzt),
   erklärt der Leitstand eine neue **Set-Basis** und gibt der Werkstatt Nachrender-Aufträge mit Vorrang 1 für alle
   geladenen Decks, Vorrang 2 für die nächsten Kandidaten. Liegt die neue Datei im Arbeitsbestand, tauscht das Deck auf
   einer Phrasengrenze per `/k/deck/basis_tausch` mit Blende auf den Direktweg der neuen Basis.
4. **Keine Sprungmaschine** (zweite, vorgefüllte Stretcher-Instanz für Handsprünge) in V1; sie kommt nur, wenn M2b und
   der Hörtermin sie verlangen. Handsprünge auf dem Stretcher-Weg landen auf dem nächsten erreichbaren Rasterpunkt
   (ADR 007).
5. **Roll-Puffer hinter dem Keylock** für den Stretcher-Weg ab Scheibe 5, nach M6 (ADR 007).
6. **Rückfall, falls M5 scheitert:** R3 immer im Hörweg (Entwurf „Robustheit“), dann ohne Blende zwischen Wegen.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| R3 immer im Hörweg | bei Faktor 1,0 nicht transparent (Artefakte −63,7 dB, andere −102,8), macht Transienten weicher (Vorecho +4,5/+7,5 dB, Kick-Anstieg 9,07 statt 3,09 ms, offline am WASM-Weg gemessen); 0,1 % Strecken kostet Drums 2,24 dB Crest; Handsprünge immer durch 80,9 ms Bandvorlauf | 03 §4c; ERGEBNIS §2.5; 08 §4.e; 03 §4a |
| Stretcher nur auf Abruf (kalt) | Vorfüllen kostet 4 096 Samples Eingang (rund 16 R3-Schritte, gerechnet rund 6 ms Rechnen, Spitzen bis 14,7 ms je Block); Hand-Tempo wirkte erst danach | 02 Probe c, 01 §4.5, 03 §4e |
| ein Stretcher je Stem | 16 Stretcher passen rechnerisch nicht in einen Echtzeit-Thread; Stem-Deck im Callback 16 Blöcke über Budget | 01 §4.5, 03 §4e |
| Sprungmaschine sofort | größte Zustandsmaschine im Echtzeit-Pfad, ungemessen; quantisierte Griffe brauchen sie nicht | Richter 3 |
| Tempo-Stufen (mehrere feste Basis-Dateien) | A12 schließt Stufen aus | A12 |

## Folgen

- Im Normalfall (Set bei 128) ist jedes Deck bitgenau, ohne Keylock-Latenz und ohne Stretcher-Artefakte; Keylock ist
  trotzdem erfüllt, weil die Basis-Datei offline mit R3 gestreckt wurde (A10).
- Die warmen Stretcher kosten dauerhaft Rechenzeit (rund 360 bis 400 µs je R3-Schritt und Instanz, 01 §4.5), auch
  wenn der Direktweg spielt.
- Kammfilter während der 20-ms-Blende zweier verschieden verarbeiteter Wege ist möglich (03 §4a „Verworfene
  Messverfahren“: Phasenvocoder ändern die Feinphase), ungemessen: M5.
- Nachrendern eines 5-Minuten-Tracks mit vier Stems kostet gerechnet 1 bis 5 min auf mehreren Kernen (R3 offline 5- bis
  23-fach Echtzeit je Kern, 07 `b_strecken.log`); so lange spielt der Stretcher.
- Mehrere Basis-Tempi je Material im Arbeitsbestand belasten das 4-GiB-Budget (ADR 015).

## Beleg

A12 wörtlich; 01 §4.5 Ausweg 1; 03 §4a (Null-Maschine 0,000 ms Drift in 30 min, Band-Vorlauf 0,6 Frames; R3
Bandvorlauf 3 884,9 Frames), §4b (Start mit Ausgleich 0,00 ms), §4c; ERGEBNIS §2.3 (Kosinusblende an der Blende
1,34 dB / −93,8 dBFS zwischen zwei R3-Knoten), §2.5; 08 §4.e; 10 Probe b L2 (16 × R3 offline neben dem Messclient: 0
Lücken bei 128, Aufwachen max 196 µs).

## Kippt, wenn

M5 zeigt hörbare Kammfilter oder Lagefehler beim Wechsel (dann R3 immer im Hörweg für Decks, die im Set je vom Tempo
abweichen) oder M3 zeigt, dass 4 warme Stretcher nicht in das Budget passen (dann warm nur für hörbare Decks, Vorhören
im Direktweg).
