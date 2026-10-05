# ADR 011: Werkstatt und Live-Nachladen

- **Status:** vorläufig; Messungen M13 (Raster und Takt-Eins der MiniMax-Songs nach Warp), M14 (Ende zu Ende, BPM-Treue),
  M19 (große Streckfaktoren, Stimmungskorrektur) und M9 (GPU im Set) stehen aus; Dossier 07 fehlt; nach der
  Kritik-Runde vom 2026-09-23 korrigiert (ARCHITEKTUR „Kritik und Korrekturen“)
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A2, A10, A12, A13, A16, A19
- **Hängt zusammen mit:** ADR 015 (Bestand), 022 (Generierung), 020 (Nachrendern), 006

## Kontext

A13: das Zerlegen (Stems, Loops, Einzelschüsse, Tempo, Takt-Eins, Tonart, Text) läuft während des Sets als eigene
Rolle (Sonnet), meldet „fertig“ und legt Material in den Bestand, den das System ohne Neustart nachlädt.
Zwischenbefund der Nacht: MiniMax-Songs haben schwache Pulsklarheit (0,03 bis 0,24) und eine Drift-Kennzahl von
9,6 bis 183,1 (korrigiert 2026-09-23 05:2x nach Dossier 07: Minimum ist zeig-mir-wo-du-klein-warst.mp3 mit 9,6) ms/min, `sofa-abend.mp3` 906,3 ms/min (07 `c_drift.log`, Stand 02:59). Die Kennzahl ist der Median
der Beträge von 60-s-Steigungen aus 8-s-Phasenfenstern (`c_drift.py`); bei Klarheit unter 0,1 lässt sie sich nicht
von Messrauschen trennen, eine Kontrolle mit starrem Raster und schwachem Puls fehlt (aus dem Code gelesen,
Vermutung zur Größe). Unabhängig davon liegt die beste feste BPM aller MiniMax-Songs nicht auf ganzen Zahlen
(89,905 bis 180,709; gegen die gerundete BPM 47 bis 153 ms/min, Spalte `gg`).

## Entscheidung

1. **Werkstatt als eigene Units:** ein Warteschlangen-Dienst `cypherdj-werkstatt` und Aufträge als
   `cypherdj-werkstatt-job@` mit `Nice=19`, `CPUSchedulingPolicy=batch`, `IOSchedulingClass=idle`, begrenzten
   Threads.
2. **Kette je Song** (jeder Schritt schreibt ins Auftragsverzeichnis, erst der letzte veröffentlicht):
   1. dekodieren (ffmpeg, Float32, 48 kHz), −12 dB Luft;
   2. Beat-Raster und **Tempo-Karte der Quelle** (beat_this; zweites Werkzeug Essentia; Abweichung beider ist eine
      Warnung), **Takt-Eins** (Downbeat aus beat_this, zweites Verfahren Tief-Band-Energie je Schlagposition),
      Halb- oder Doppeltempo-Wahl (Streckfaktor zur Set-Basis am nächsten bei 1);
   3. **Warp per Timemap** mit R3 auf das starre Raster der Set-Basis (Vorgabe 128), Float, im selben Lauf die
      Stimmungskorrektur auf A = 440 Hz (nur unter 35 Cent und bei Einigkeit zweier Werkzeuge, ADR 012); der Trim
      kommt beim Laden aus `ziel_lufs` und der LUFS der Fassung;
   4. Stems mit derselben Karte: im Set auf der CPU nur bei Quantum 256 (Nice 19, batch, 10 NP N6: 15 % der
      Periode), bei 128 nie; auf der DJ-Maschine-GPU erst nach Andreas' Antwort zu Frage 4 (ARCHITEKTUR §13) und M9. **W1
      beginnt ohne Stems** (Streichliste);
   5. Fingerabdruck v1 in Beat-Zeit, Kreuzenergien mit den Mixer-Filtern, Referenz-Hüllkurven (sechs Bänder wie der
      Ring), alles aus dem, was klingt (Stem-Summe oder Basis-Datei); Struktur, Hotcue-Vorschläge an Phrasen ab der
      Takt-Eins, Loops, Einzelschüsse auf der Set-Basis;
   6. **Tore** (`SCHNITTSTELLEN.md` §12.3): Raster-Rest der **unabhängig** gemessenen Tief-Band-Anschläge am gewarpten
      Ergebnis (`fa.py`, nicht beat_this oder Essentia, die die Karte setzen), Pulsklarheit ≥ 0,1 ohne Ausnahme,
      Streckfaktor ±15 %, Takt-Eins-Übereinstimmung, Headroom. Material, das ein Tor reißt, wird **nur Andreas**
      angeboten (`nur_fuer_andreas`), nie Cypher, mit Warnung;
   7. atomar in den Bestand: ein neues Material als ganzer Ordner, jede weitere **Fassung** als eigener Ordner
      `fassungen/<bpm·1000>_r<n>/` (temporärer Ordner, `rename`, nie überschrieben, ADR 015), `material_fertig` an den
      Leitstand.
3. **Warteschlange mit Vorrang:** 1 Nachrendern geladener Decks auf eine neue Set-Basis (ADR 020), 2 Einlesen
   frischer Songs, 3 Vorrat. GPU-Jobs seriell.
4. **Nachladen ohne Neustart:** der Leitstand kopiert Material in den Arbeitsbestand `/dev/shm/cypherdj/material/`;
   der Kern-Lader blendet per `mmap` ein, sperrt per `mlock`, prüft, reicht einen Zeiger in den Callback.
5. **Zerleger** (A13) ist ab Scheibe 6 eine eigene Sonnet-Sitzung mit Werkstatt-Werkzeugen: er urteilt (Loop-Grenzen,
   Namen, Warnungen wie „Gesang verstimmt“), die Kette rechnet. Bis dahin läuft die Kette ohne Sonnet.
6. **Raster von Hand** (Nudge, Tap, Takt-Eins) erzeugt Korrekturen je Abschnitt; `korrigieren` rendert daraus eine
   neue Fassung `r + 1` (ADR 007, 015). Das ist der Rückfall, falls M13 scheitert.
7. **Werkstatt-Umgebung** (gemessen 2026-09-23): das Proben-venv hat torch 2.5.1+cpu und kann keine GPU; beat_this und
   Demucs liefen nie mit echten Gewichten (10 NP N6 nutzte zufällige, `~/.cache/torch` fehlt), der erste Lauf lädt
   die Gewichte aus dem Netz (`beat_this/inference.py`: `CHECKPOINT_URL`). Der Plan von W1 legt ein neues venv mit
   `--system-site-packages` an (System-torch 2.10.0+cu128) und lädt die Gewichte einmal vorab mit Größenprüfung
   (über 1 GB nur mit Andreas' Ja).

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| konstante BPM je Song (Raster aus der besten festen BPM) | Rest ohne Timemap 45,26 ms RMS am driftenden Klick | 07 `b_timemap.log` |
| R2 für den Warp | 1,94 ms RMS Rest, −1,15 ct; hält tiefe Töne nicht | 07 `b_timemap.log`, 03 §4c |
| Kommandozeile ohne Luft | klemmt bei ±1,0 auch mit `--ignore-clipping` (MFB bis +5,09 dBFS) | 08 NP K5 |
| Stems im Set auf der CPU bei 128 | HTDemucs trieb das Aufwachen bei 128 auf 55 % der Periode (bei 256: 15 %, darum dort erlaubt) | 10 NP N6 |
| Kern dekodiert selbst | Dekodieren im Kern-Prozess, Neustart müsste neu dekodieren | 10 §5 |
| Live-Analyse erkennt falsches Raster | der Versatz gegen die Referenz sieht ein falsches Raster nicht | 08 NP K4 |
| Tor mit dem Werkzeug prüfen, das die Karte setzte | misst den eigenen Fehler nicht (Muster aus 08 NP K3: dasselbe Messgerät vorher und nachher) | 08 NP K3 |
| Nachrendern überschreibt oder ergänzt `material.json` | geladene Zeiger und Hörscheine zeigten auf veränderte Daten; die Korrektur hätte keinen Platz | ADR 015 |

## Folgen

- **GPU nicht gesichert:** PyTorch-Demucs braucht laut Recherche rund 7 GB Grafikspeicher (undatierte README-Angabe,
  ungemessen); mit fremdem Training bleibt rund 1 GB (Recherche §3c), in dieser Nacht belegten fremde Dienste 7 786
  bis 10 832 von 12 282 MiB (`nvidia-smi`, eigene Messung gegen 04:20, Kritik-Befund 04:10). Die „rund 5 s je 3-Minuten-Song“ gelten für eine TensorRT-Engine
  (nicht kommerziell, für sm89 erst zu bauen), **nicht** für diese Kette. M9 misst den Bedarf der echten Kette.
- Frische Songs sind Minuten entfernt: Fingerabdruck plus Kreuzenergien eines 8-Minuten-Songs 75 s auf einem Kern
  (08 NP), R3 offline 5- bis 23-fach Echtzeit je Kern unter Last (07 `b_strecken.log`), Stems auf der GPU
  ungemessen; gerechnet 1 bis 5 min für 3 Minuten Audio (M14 misst).
- Die Tore sind ungeeicht, bis M13 und M19 laufen; bis dahin sperrt ein gerissenes Tor nur Cyphers Zugriff, nicht
  Andreas' (für ihn ist es eine Warnung). Von den zehn vorhandenen MiniMax-Songs reißen nach c_drift acht das Tor
  `klarheit` und sieben das Tor `streckfaktor` (gerechnet aus den BPM, mit Halb-/Doppeltempo-Wahl).
- Dossier 07 fließt über die Pläne ein; widerspricht es dieser Entscheidung, gilt das Dossier samt Nachprüfung.

## Beleg

07 `c_drift.log`, `c_drift.py`, `b_timemap.log`/`.json` (R3 mit Timemap: Rest 0,19 ms RMS, max 0,58 ms; 255 von 255
Einsätzen; **eingestuft: Timemap-Mechanik an einem synthetischen Klick mit bekannter Wahrheit, die Timemap stammt aus
den wahren Schlagzeiten; die Erkennung an MiniMax-Songs misst M13**), `b_strecken.log` (R3 110,000 Hz; 0,64 bis 3,21 s je 15-s-Loop), `pip_torch.log` (torch, demucs 4.0.1,
beat_this 1.1.0, Essentia 2.1b6 installiert); 08 NP K5, „Was fehlt“ 6; 10 §5, NP N6, N8 (0,05 ms je MiB); Recherche
§3c (GPU als Werkstatt; TensorRT-Stems rund 5 s je 3-Minuten-Song auf einer RTX 3090, Einzelbenchmark, nicht
kommerziell; PyTorch-Demucs rund 7 GB Grafikspeicher, undatiert), Frage 2 dort; 10 NP K6 (GPU-Job Start und Ende
ungemessen); A13.

## Kippt, wenn

M13 zeigt, dass die Tempo-Karte an MiniMax-Songs auch mit zwei Werkzeugen nicht trägt (Rest am Ausgang über der
Flam-Grenze von 8 ms): dann „Raster von Hand“ als Pflichtschritt (Tap im Vorhören) oder Generierung mit strengerem
Prompt (festes Tempo) vor dem Einlesen.
