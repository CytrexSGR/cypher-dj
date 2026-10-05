# ADR 024: Kit im Kern (Strudel, Stufe 1)

Status: angenommen 2026-09-27 (Cypher; Andreas: Vorziehen von 54/56 auf seinen Aufruf von /write-plan).

## Kontext

ADR 010 legt fest, dass Erzeuger nur Ereignisse liefern und der Klang aus einem Wirt kommt (SunVox, Scheibe 57),
per JACK-MIDI mit Rückweg, Puls und Latenzvorhalt (Scheibe 54). Das sind drei L-Scheiben, bevor ein Muster klingt.
Andreas' gemeinsames Spiel lebt in Strudel (Live-Act 26./27.09.); Wortbefehle wie „hihats“ brauchen einen kurzen Weg.

## Entscheidung

`/erz/strom` bekommt die Zielform `kit:<name>`. Der Kern spielt `klang[note]` eines Kits (Einzelschüsse,
Stereo float32, 48 kHz) am Sample des Beats in den Eingang eines Erzeuger-Kanals. Das Netz lädt das Kit; der Kern
tauscht den Zeiger im Zyklus und gibt das alte als Ereignis zur Freigabe zurück (Muster `/k/mapping`, Scheibe 35).

## Folgen

- Sample-genau ohne Rückweg; keine Synthese, keine Tonhöhe: Melodisches bleibt bei 57.
- I3c ist in Stufe 1 ausgesetzt (SCHNITTSTELLEN §4.8), weil es für Erzeuger noch keinen Hörschein gibt.
- Kits liegen gemeinsam unter `~/.config/cypherdj/kits/`; `djk/erzeuger/kit_bauen.py` baut sie aus Strudel-Listen.

## Verworfen

| Weg | Warum nicht | Beleg |
|---|---|---|
| Strudel im Browser als dritter Audio-Eingang | Browser-Uhr treibt, `setPattern` ohne Raster, Tod der Seite nimmt den Klang mit | ADR 017 |
| MIDI an SunVox zuerst | drei L-Scheiben vor dem ersten Ton | ROADMAP 54, 57 |
