# ADR 004: Die eine Uhr, Sync nach außen und Link

- **Status:** angenommen; Link-Brücke vorläufig, Messung M12 steht aus; Gang gegen Interface-Quarz M1
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A9, A11, A12, A20
- **Hängt zusammen mit:** ADR 005, 020, 016

## Kontext

A20 verlangt „alles taktgleich“. Kandidaten für die Uhr waren: eigener Sample-Zähler, Frame-Zeit des Treibers,
JACK-Transport, Ableton Link, Strudels `cps`. Dossier 01 §4.2 schlug vor, die Position nach einem Aussetzer aus der
Frame-Zeit des Graphen abzuleiten; der Entwurf „Spielbarkeit“ wollte Lücken nachrücken; der Entwurf „Robustheit“
will die Uhr innen stetig halten und außen neu verankern.

## Entscheidung

1. **Die eine Uhr** ist ein eigener `int64`-Sample-Zähler im Echtzeit-Callback des Kerns (Summe der `nframes`) plus
   eine **Tempo-Karte** aus Segmenten (konstant oder linear in der Zeit; S-förmige Ecken erst nach V1). Beat, Takt, Phrase und
   Frist sind Funktionen davon (Formeln: `SCHNITTSTELLEN.md` §1.3).
2. **Innen stetig, außen neu verankert.** Ein ausgefallener Zyklus wird nicht nachgerückt: die Musik verschiebt sich
   gegen die Wanduhr um einen Block, innen merkt es niemand. Nach außen (Link, MIDI-Clock) wird bei jeder erkannten
   Lücke und jedem Treiberwechsel neu verankert, der HostTimeFilter zurückgesetzt, und `/e/luecke` gemeldet.
3. **Anker im Zustand** `{anker_sample, anker_mono_ns, Tempo-Karte}` in `/dev/shm`; ein neu gestarteter Kern setzt
   dort fort, wo er ohne Absturz stünde.
4. **Tempo-Karte begrenzt** (64 Segmente), vergangene Segmente werden verworfen, eine abgelehnte Änderung wird als
   `abgelehnt` mit Grund `karte_voll` quittiert. Andreas' Tempo-Regler ist **ein** Hand-Segment, das je Zyklus
   überschrieben wird.
5. **Keine Tempo-Sprünge**, nur Rampen mit Mindestdauer 1 Beat, **auch für Andreas' Hand:** jede Encoder-Raste
   (0,01 BPM) fährt das Hand-Segment als Rampe über 1 Beat (`SCHNITTSTELLEN.md` §1.3, §7.3 Punkt 7). Grund: der
   einzige native Faktorsprung, der auf Tonhöhe gemessen ist, lag 95 ms über 10 ct und hatte 128 Null-Samples
   (ERGEBNIS §2.6). M4 (2026-09-25): kleine Wechsel erzeugen in der Zeit-Bauart keine Null-Samples (E7, E9), kosten
   aber Phase, jeder für sich; darum Faktor-Takt 43 Blöcke (Regel 6). Rampe über 1 Beat mit Vorhalt 50 ms bestätigt (E1, E2, E6).
   S-förmige Ecken (04 §4.5) kommen als spätere Segmentart; an linearen Ecken blieb im Delay eine Restspitze von
   −107,3 dBFS, unter der 16-bit-Stufe.
6. **Phasenregler je Deck** auf dem Stretcher-Weg (ADR 020): Quellposition gegen `sample_at`, Faktor höchstens alle
   43 Blöcke nachstellen, |c| ≤ 100 ppm, am Verzögerungsmodell D = 50 ms (M4 E3, E5, 2026-09-25; „wenige ppm je Block“
   läuft weg); bei geplanten Rampen Faktor eine Engine-Verzögerung (50 ms) voraus (M4 E1 bestätigt).
7. **Nach außen:** MIDI-Clock (24 ppq, Start auf einer Takt-Eins) aus dem Kern über JACK-MIDI; **Ableton Link in
   einer eigenen Brücken-Unit** `cypherdj-link`, die `/uhr` liest; der Kern führt immer, fremde Tempowechsel werden
   nur gemeldet (Vorgabe zu 02 Frage 1). **JACK-Transport nie.** Beides erst ab Scheibe 9.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Frame-Zeit des Treibers als Uhr | sprang beim Treiberwechsel um −2 978 880 305 Frames; in 06 Lauf 1 viermal | 02 Probe b; 06 §4.1 |
| Lücken aus der Frame-Zeit nachrücken | jede Lücke wäre ein Sprung in allen Decks und Stretchern (Knack); außen hilft Neuverankern genauso | 02 NP „Was fehlt“ 3, N6 |
| JACK-Transport | Zustand gehört dem Treiber, kippt bei Treiberwechsel, kennt keine Rampe | 02 Probe b, k_trans1, k_midi1 |
| Link als innere Uhr | Tempo in ganzen µs je Beat (132 wird 132,000132), 50-ms-Sendebremse, Übernahme 0,15 bis 50,25 ms, eigene Systemuhr `CLOCK_MONOTONIC_RAW` | 02 Probe a, e, NP N3 |
| Link im Kern | Netz-Fäden und LAN-Pakete gehören nicht in den Audio-Prozess (Vermutung); im Prozess gemessen 14 µs Fehler eingeschwungen | 02 NP N6; M12 vergleicht |
| Strudels `cps` | fällt mit dem Browser weg | 02 §3.1 E |

## Folgen

- Alle anderen Prozesse reden in Beats (ADR 005).
- Nach einem Treiberwechsel entsteht nach außen ein Versatz von Millisekunden (gemessen 1,046 und 2,787 ms); darum
  fester Treiber im Set.
- Der Gang Samples gegen Systemuhr am echten Quarz ist ungemessen (M1): Anker in monotoner Zeit hält das Raster über
  Neustarts nur, solange dieser Gang klein ist.

## Beleg

02 §3.1 (Formeln), Probe b (Befehle in Beats 0 Samples, K2: konstruktionsbedingt), Probe d (5,7·10⁻¹⁴ Beats), NP N1
(Tempo nach dem Senden geändert: Beats 0 Samples, ms bis 554 Samples), N4 (Karte voll nach 15), N5 (R3-Deck in der
Rampe bis 1,92 ms, danach 1,4 ms, 8,1 ppm bei 132), N6 (HostTimeFilter nach Treiberwechsel 2,67 s bis 2,8 ms
daneben), k_midi1 (2 287 MIDI-Clock-Ticks 0 Frames daneben, innerhalb PipeWire); 04 §4.5 (S-Ecken: −107,3 →
−144,5 dBFS); ERGEBNIS §2.6 (Faktorsprung nativ 95 ms über 10 ct, 128 Null-Samples); 10 Probe c (Raster nach Neustart ≤ 0,2 Samples,
NP ≤ 0,95).

## Kippt, wenn

M1 zeigt einen großen Gang zwischen Interface-Quarz und Systemuhr (dann Anker in Frames des Treibers plus Gang-Schätzung)
oder M12 zeigt, dass die Link-Brücke deutlich schlechter trifft als Link im Prozess.
