# ADR 016: Robustheit, Notbahn, Watchdog, Chaos-Prüfstand

- **Status:** vorläufig; M2 gemessen, Notbahn daneben (Nachtrag 2026-09-25); M11 (Watchdog-Politik), M10 (ruhige Maschine) stehen aus
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A1, A3, A20
- **Hängt zusammen mit:** ADR 001, 003, 015

## Kontext

„Live darf nie verstummen.“ Gemessen: ein Mini-Kern als systemd-Unit mit `RestartSec=0` spielt nach `kill -9` nach
38,7 ms wieder (10 Probe c). Eine Notbahn über Shared Memory verhindert Stille bei Absturz und Hänger, eine
Notbahn per Graph-Kante nur bei Absturz. Die Nachprüfung zeigt: die Notbahn verhindert Stille, nicht den Knack (13
von 14 Übernahmen mit Sprung; mit Musik 47 % hörbar hell, mit Blende 11 %). Der JACK-Xrun-Rückruf ist blind. Die
Entwürfe streiten über Blende (zwei Blöcke) gegen Latenz (ein Block oder parallel).

## Entscheidung

1. **systemd-User-Units** unter `cypherdj.target`. Kern und Notbahn: `Type=notify`, `Restart=always`, `RestartSec=0`,
   `StartLimitIntervalSec=0`, `WatchdogSec=200ms`, `WatchdogSignal=SIGKILL`, `RestartSteps=5` mit
   `RestartMaxDelaySec=2s` gegen Absturz-Schleifen (Werte gesetzt; systemd 255 kann es, Wirkung ungeprüft, M11). Satelliten:
   `Restart=always`, Werkstatt `Restart=on-failure`.
2. **`WATCHDOG=1` nur bei Echtzeit-Fortschritt** (der Kern-Zähler steigt). Die Telemetrie unterscheidet „Kern hängt“
   von „Kern wartet auf einen Vorgänger“ (10 NP K5), sobald Wirt-Rückwege existieren (M11).
3. **Notbahn über den Shared-Memory-Ring** `/dev/shm/cypherdj/bus` (Master und Cue), liest einen Block versetzt;
   Lebenszeichen ist der Fortschritt des Schreibzählers. Bei Stillstand: letzten Takt schleifen **mit Blende an der
   Naht** (Vorgabe: ein weiterer Block, zusammen zwei Blöcke Latenz), höchstens 8 Takte, dann über 2 Takte ausblenden
   und `/nb` melden (LED, Leitstand); Rückgabe an den Kern mit Blende. NaN/DC/Clip-Riegel. **Die Taktlänge kommt
   aus dem Ring:** der Kern schreibt je Zyklus `takt_frames` (Länge des letzten vollendeten Master-Takts) und
   `takt_anfang_w` in den Ring-Kopf (`SCHNITTSTELLEN.md` §6.1); die Notbahn schleift um genau `takt_frames` zurück, aus
   einem **eigenen Verlauf** von mindestens 384 000 Frames je Kanal (2 Takte bei 60 BPM; der Ring selbst hält nur
   65 536 Frames, weniger als ein Takt bei 128). Die Vorlage nahm den Takt aus einem festen `--bpm 128` beim Start
   (`notbahn.c` Z. 77, 96); das war bei jeder anderen Set-Basis und in Rampen falsch. **Ports** bekommt die Notbahn als
   Aufrufparameter aus ihrer Unit (`ExecStart`), nicht aus `kern.toml` (kein TOML-Parser in C auf DJ-Maschine), und sie
   verbindet nur nach dem **Riegel** gegen ungefragten Ton (Positivliste `stumm`, `cypherdj-pruef-*`; das echte
   Interface nur mit `--ton-frei` nach Andreas' Freigabe; `notbahn.c` Z. 90 als Vorlage, `SCHNITTSTELLEN.md` §8).
4. **Zustand für den Neustart** im Seqlock `/dev/shm/cypherdj/zustand`: Anker, Tempo-Karte, Decks (Material, Fassung,
   Anker, Loop, Hotcues, Hörweg), Regler mit Halter, ausstehende Befehle mit Stand und die **Abonnenten**. Der neue
   Kern setzt auf dem Raster fort, meldet `/e/neustart` sofort an alle gespeicherten Abonnenten und schickt jedem, der
   sich neu anmeldet, `/e/neustart` und `/q/stand` je offenem Befehl (`SCHNITTSTELLEN.md` §4.1, §5.1); ohne die Liste
   ginge `/e/neustart` bis zum nächsten Herzschlag (bis 2 s) an niemanden. Stretcher legt der neue Kern im Lade-Faden an
   und zieht sie einmal durch, bevor der Callback sie bekommt (01 NP K3, ADR 006).
5. **Eigene Zählung:** Frame-Lücken und ausgelassene Perioden zählt der Kern selbst; Callback-Histogramm; das
   Aufwach-Maß ist keine Frühwarnung.
6. **Chaos-Prüfstand** (`djk/pruefstand/`) ist Abnahme **jeder** Scheibe: eigene Null-Senke je Lauf, JACK-Aufnehmer
   am Ziel, Naht-Messer, Lastgeber (Speicher-Streaming, HTDemucs auf der CPU, Werkstatt), `kill -9` und Hänger
   (SIGSTOP, Endlosschleife im Callback) auf jede Unit, Dauerlauf, Bericht mit den Zusagen aus ARCHITEKTUR §7.
   Fertig heißt: Fehlerfall vorher, Messung nachher, Negativ-Kontrolle.
7. **Kernel bleibt**, wie er ist; Reserve `lowlatency-kernel` plus `threadirqs` nur nach M1 und mit Andreas' Ja.
8. **Kein zweiter Kern als heißer Ersatz** vorerst.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| keine Notbahn | Stille bei jedem Absturz (29,4 bis 48 ms) und jedem Hänger bis zum Watchdog | 10 Probe c |
| Notbahn per Graph-Kante | hängt der Kern, hält er die Notbahn hinter sich an: 181 bis 216 ms Stille | 10 Probe c, NP |
| Notbahn ohne Blende (ein Block) | 47 % der Übernahmen mit echter Musik hörbar hell | 10 NP N2 |
| Notbahn per `node.async` statt Ring | gleich gut gemessen (0 ms in 4 von 4 Hängern, ein Block); der Ring ist eigener Code mit explizitem Lebenszeichen und schon in drei Probenläufen belegt | 10 NP N9, Probe c |
| Notbahn parallel am Treiber (ohne Zusatzblock) | ungemessen: liefert ein hängender Kern Stille oder alte Blöcke? | M2b |
| zweiter Kern als heißer Ersatz | doppelte Rechenlast, zustandsbehaftete Stretcher laufen auseinander | 10 §3c (Vermutung dort) |
| JACK-Xrun-Rückruf als Wächter | blind für Überläufe des eigenen Clients | 01 §4.2, 10 Probe b, `pipewire-jack.c` Z. 2070 bis 2073 |
| `RestartSec` Standard 100 ms | Lücke 149,4 statt 42,7 ms | 10 Probe c |

## Folgen

- Latenz: die weiche Notbahn kostet zwei Blöcke (bei 256: 10,7 ms); ohne Blende einer, dann knackt es nur im
  Absturzfall. Entscheidung im Hörtermin (Frage 3 in ARCHITEKTUR §13).
- Die Takt-Schleife ist hörbar; die Obergrenze 8 Takte ist gesetzt, nicht gehört.
- PipeWire-Neustart ist ungeprüft (unterbricht Andreas' Desktop-Ton, braucht sein Ja).

## Beleg

10 Probe c (`RestartSec=0`: erster Block 38,7 ms, NP 39,9; Shared-Memory-Notbahn 0 ms Stille in 5 von 5 und 4 von 4,
NP 5 von 5 und 2 von 2; Latenz 255,88 gegen 127,83 Samples; Watchdog 190,7 bis 214,5 ms; Raster ≤ 0,2 Samples, NP ≤
0,95), Probe b (K1b: 44 Lücken, 0 Xrun-Rückrufe), NP K1, N1 (13 von 14 mit Sprung), N2 (47 % → 11 %), N3, N8, N9, K4,
K5, K7; 01 §4.2, Probe e3; `proben/10-robustheit-betrieb/src/notbahn.c` (Umschalten ohne Blende, nur Rückweg blendet).

## Kippt, wenn

M2 zeigt, dass die Blende online nicht knackfrei ist (dann längere Blende oder andere Schleifenlänge); die
Golden-Folgen `notbahn_124` und `notbahn_rampe` zeigen eine Rückgabe neben dem Raster (dann Schleife aus
`takt_anfang_w` statt aus der Stillstandsstelle); M2b zeigt,
dass eine parallele Notbahn am Treiber Stille statt alter Blöcke bekommt (dann ein Block weniger Latenz); M11 zeigt
falsche Watchdog-Tode.

## Nachtrag 2026-09-25: Notbahn daneben (M2 gemessen, Frage 3 beantwortet)

`(A, 2026-09-25: „ok daneben")` auf die Zahlen aus M2 (`messungen/M02-notbahn-naht/BERICHT.md`, Scheibe 06): in Reihe
mit 1 Block Blende kostet jeder Griff 512 Samples (10,7 ms) mehr als der direkte Weg; daneben kostet ein Absturz einen
Block Stille mit Knack und jede Rückgabe 512 bis 768 Samples doppelten Ton, ohne Zusatzlatenz (Klick 255,92 gegen
255,63 Samples direkt). Ein hängender Kern liefert am Treiber Stille, keine alten Blöcke; daneben trägt (9 von 9, je
genau ein Block).

Entscheidung geändert: **die Notbahn sitzt daneben am Treiber**, nicht in Reihe. Scheibe 10 baut daneben; die Vorgabe
„weiche Notbahn“ bis zum Hörtermin entfällt. Die Übernahme-Blende aus M2 (E2, 1 Block) gilt nur für den Weg in Reihe
und ist damit nicht mehr Bauvorgabe. Hörprobe beim Hörtermin (Scheibe 46) bleibt: kippt der Knack für Andreas' Ohr,
geht es zurück in Reihe mit 1 Block Blende (gemessen, trägt).
