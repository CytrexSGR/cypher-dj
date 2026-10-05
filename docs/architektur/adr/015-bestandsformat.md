# ADR 015: Bestand, Arbeitsbestand, Kiste und Journal

- **Status:** angenommen (SQLite-Index: Vermutung, im ersten Werkstatt-Plan zu prüfen); Fassungen nach der
  Kritik-Runde vom 2026-09-23 (ARCHITEKTUR „Kritik und Korrekturen“), vor W1 verbindlich, weil W1 den Bestand zuerst schreibt
- **Datum:** 2026-09-23
- **Getragene Anforderungen:** A12, A13, A16, A1
- **Hängt zusammen mit:** ADR 011, 020, 016

## Kontext

Der Kern soll nie selbst dekodieren (10 §5), Material ohne Neustart nachladen (A13) und nach einem Absturz schnell
wieder einblenden (10 NP K7: +0,05 ms je MiB). Die gesperrte Speichergrenze liegt bei 4 GiB (10 Probe d). A12 braucht
mehrere Basis-Tempi je Material. Andreas' Nudge- und Tap-Korrekturen müssen den nächsten Render erreichen.

## Entscheidung

1. **Bestand** unter `~/cypher-dj/bestand/<material_id>/`, `material_id` = die ersten 16 Hex-Zeichen des SHA-256 der
   Quelldatei. `original.*` und `material.json` (Quell-Metadaten) werden beim ersten Einlesen einmal atomar geschrieben.
   Jeder Render ist eine **Fassung** in einem eigenen, unveränderlichen Ordner `fassungen/<bpm·1000>_r<n>/` mit eigener
   `fassung.json` (Frames, Prüfsummen, Raster, Takt-Eins, Lautheit, Tore) samt Stems, Schüssen, Fingerabdruck,
   Kreuzenergien und Referenz-Hüllkurven; atomar per `rename`. Nachrendern auf eine neue Basis beginnt bei `r1`, eine
   Korrektur (Raster, Takt-Eins) legt `r + 1` daneben. Deck, Arbeitsbestand und Hörschein binden (Material, Basis,
   Fassung). Grund: die frühere Form (eine `basis_<bpm>.f32` je Tempo, Metadaten im einmal geschriebenen
   `material.json`) hatte für `korrigieren` keinen Platz (gleiche Basis, „nie überschreiben“) und für `nachrendern`
   keinen Ort für Frames und Prüfsumme der neuen Datei.
2. **Audio als rohes Float32**, verschränkt, Little Endian, 48 kHz, Stereo, ohne Kopf; Länge, Prüfsumme und Raster in
   `material.json`. Original zusätzlich verlustfrei (FLAC) bzw. als gelieferte Datei.
3. **`korrekturen.jsonl`** je Material, **die einzige anhängbare Datei**: Raster-Korrekturen je Abschnitt, Takt-Eins,
   Hotcues von Hand, Urteile zum Material. Die Werkstatt liest sie beim nächsten Rendern; `fassung.json` vermerkt, bis
   zu welcher Zeile eingerechnet ist.
4. **Index:** `~/cypher-dj/bestand/index.sqlite`, geschrieben nur von der Werkstatt (WAL), gelesen von Leitstand und
   Rechner für `bestand`-Anfragen.
5. **Arbeitsbestand** `/dev/shm/cypherdj/material/<material_id>/`: Kopie der für das Set gewählten Dateien, überlebt
   Kern-Neustarts; der Kern blendet nur von dort ein. **Kiste** `/dev/shm/cypherdj/kiste.json`: Liste der spielbaren
   Materialien für Controller und Cypher, atomar vom Leitstand geschrieben. Gesperrtes Budget des Kerns unter 4 GiB,
   Entladen nach Regel (älteste nicht geladene zuerst).
6. **Set-Journal** unter `~/cypher-dj/sets/djk/<JJJJ-MM-TT_hhmm>/journal.jsonl` (Leitstand) und Aufnahme
   `aufnahme.f32` plus `aufnahme.json` (erstes Kern-Sample) daneben.
7. Formate im Einzelnen: `SCHNITTSTELLEN.md` §13, §15.

## Alternativen und warum nicht

| Alternative | Grund der Ablehnung | Beleg |
|---|---|---|
| Kern dekodiert MP3/FLAC | Dekodieren im Echtzeit-Prozess, Neustart müsste neu dekodieren | 10 §5 |
| WAV mit Kopf | Kopf parsen im Lader; roh mit Metadaten daneben ist einfacher zu prüfen | Vermutung, Robust-Entwurf |
| veränderliche Ordner (Nachrendern überschreibt) | ein geladener Zeiger zeigte auf eine veränderte Datei; kein Rückweg | Vermutung |
| neue Basis-Dateien neben die alten, Metadaten in `material.json` | `material.json` ist einmal geschrieben: kein Platz für die Metadaten der neuen Datei; eine Korrektur auf derselben Basis hätte denselben Dateinamen | Kritik-Runde 2026-09-23 |
| alles in `/dev/shm` | tmpfs belegt RAM; nur das Set-Material gehört dorthin | 10 §3a (63 GiB RAM) |

## Folgen

- Speicher: 3-Minuten-Track Stereo float32 rund 69 MB, mit vier Stems rund 345 MB je Basis-Tempo; 4 GiB fassen rund
  46 min Material mit Stems (10 Probe d). Mehrere Basis-Tempi je Track machen es knapp: Entladen ist Pflicht.
- `MCL_FUTURE` im Kern kann späteres Einblenden scheitern lassen (10 NP K7): der Kern sperrt gezielt je Material mit
  `mlock`, nicht pauschal mit `mlockall(MCL_FUTURE)`.

## Beleg

10 §5, Probe d (256 MiB 50,3 ms, 3 072 MiB 601,3 ms, 4 200 MiB scheitert), NP N8 (0,050 bis 0,056 ms je MiB, 3 GiB 156
bis 161 ms), K7; 08 §5 (Fingerabdruck v1); 03 §5 (`Material`); 09 §3.8, NP K12 (Journal 0,59 MB je Stunde).

## Kippt, wenn

M8 zeigt Seitenfehler im Callback trotz `mlock` (dann Seiten beim Laden berühren) oder das Budget reicht für ein
Set nicht (dann kleinere Kiste oder Stems nur auf Abruf).
