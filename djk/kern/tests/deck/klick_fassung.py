#!/usr/bin/env python3
"""Klick-Fassung für die Decks (Scheibe 31): schreibt ein Material mit einer Fassung in einen Arbeitsbestand nach
SCHNITTSTELLEN.md §6.4, §13.1 und §13.2, mit Klicks genau auf dem Raster der Fassung:

    Klick des Quell-Beats q beginnt bei Frame llround(erster_schlag_frame + q · 60 / basis_bpm · 48000)   (§13.1)

Klickform wie der Prüfklick des Kerns (djk/kern/src/klick.cpp: exp(−i/12) · cos(2π · 2000 · i / 48000), 96 Samples),
Pegel 0,5 auf der Takt-Eins (q − erste_eins durch 4 teilbar), sonst 0,25, damit derselbe Einsatz-Messer beide misst.

Mit --stems vier Stems (§13.1, Summenreihenfolge drums, bass, vocals, other wie das Deck): drums = die Klicks,
bass = Sinus 55 Hz (0,1), vocals = 1-kHz-Tupfer auf den Off-Beats (0,2), other = Rauschen (0,01, Saat 31); die Fassung
hat dann analyse_quelle "stems" und keine Basis-Datei. --summe-als <material_id> schreibt zusätzlich ein zweites
Material ohne Stems, dessen basis.f32 die float32-Summe der vier Stems in genau dieser Reihenfolge ist (Offline-Summe
für die Abnahme „vier Stems summieren am Ziel zur Offline-Summe“).

Mit --sinus-links F trägt der linke Kanal statt der Klicks einen Dauer-Sinus F Hz (Spitze 0,5, Phase 0 bei Frame 0), der
rechte die Klicks (Keylock Task 2.5: Tonhöhe links und Lage rechts aus EINEM Deck, test_kern_keylock_faeden).

Fehlerfälle für den Lader: --nan-bei F schreibt NaN in Frame F (links und rechts); --falsche-pruefsumme trägt eine
andere sha256 in fassung.json ein. Größe: --mib N macht die Basis N MiB groß (Klicks nur in den ersten --beats Beats,
danach Nullen); --duenn legt sie als dünne Datei an (ftruncate, keine Daten, sha256 nur Form), für die Budget-Probe.

Schreibt atomar: erst <ziel>/.<material_id>.tmp, dann rename (§6.4 „Kopie, dann rename des Ordners“).
Aufruf:  klick_fassung.py --ziel /dev/shm/cypherdj-a/material --material-id c1c0000000000001 --beats 64
Ausgabe: eine JSON-Zeile mit material_id, ordner, frames, sha256, dauer_s.
"""
import argparse
import hashlib
import json
import math
import os
import pathlib
import shutil
import sys

import numpy as np

RATE = 48000
KLICK_LAENGE = 96
BLOCK = 1 << 20   # Frames je Schreibblock


def klickform():
    i = np.arange(KLICK_LAENGE, dtype=np.float64)
    return (np.exp(-i / 12.0) * np.cos(2.0 * math.pi * 2000.0 * i / RATE)).astype(np.float32)


def klick_frame(q, erster, bpm):
    """§13.1, gerundet wie der Kern (llround: ,5 vom Nullpunkt weg)."""
    x = erster + q * 60.0 / bpm * RATE
    return int(math.floor(x + 0.5)) if x >= 0 else -int(math.floor(-x + 0.5))


class Spur:
    """Erzeugt einen Kanal-Abschnitt [a, e) (Stereo, float32) für eine Stimme."""

    def __init__(self, art, frames, erster, bpm, beats, eins, sinus_links=None):
        self.art, self.frames, self.erster, self.bpm, self.beats, self.eins = art, frames, erster, bpm, beats, eins
        self.sinus_links = sinus_links
        self.form = klickform()
        self.ereignisse = []   # (frame, pegel, form)
        if art == "klick":
            for q in range(beats):
                pegel = 0.5 if (q - eins) % 4 == 0 else 0.25
                self.ereignisse.append((klick_frame(q, erster, bpm), pegel, self.form))
        elif art == "vocals":
            i = np.arange(KLICK_LAENGE, dtype=np.float64)
            tupfer = (np.exp(-i / 24.0) * np.sin(2.0 * math.pi * 1000.0 * i / RATE)).astype(np.float32)
            for q in range(beats):
                self.ereignisse.append((klick_frame(q + 0.5, erster, bpm), 0.2, tupfer))

    def abschnitt(self, a, e):
        n = e - a
        x = np.zeros((n, 2), dtype=np.float32)
        if self.art == "bass":
            t = np.arange(a, e, dtype=np.float64)
            x[:, 0] = x[:, 1] = (0.1 * np.sin(2.0 * math.pi * 55.0 * t / RATE)).astype(np.float32)
        elif self.art == "other":
            # Rauschen deterministisch je Block: Saat aus der Blocknummer, damit Abschnitte unabhängig bleiben
            for b0 in range(a - a % BLOCK, e, BLOCK):
                rng = np.random.default_rng(31 + b0 // BLOCK)
                r = (rng.standard_normal((BLOCK, 2)) * 0.01).astype(np.float32)
                lo, hi = max(a, b0), min(e, b0 + BLOCK)
                x[lo - a:hi - a] = r[lo - b0:hi - b0]
        for f, pegel, form in self.ereignisse:
            lo, hi = max(a, f), min(e, f + len(form))
            if lo < hi:
                x[lo - a:hi - a, 0] += pegel * form[lo - f:hi - f]
                x[lo - a:hi - a, 1] += pegel * form[lo - f:hi - f]
        if self.sinus_links:
            t = np.arange(a, e, dtype=np.float64)
            x[:, 0] = (0.5 * np.sin(2.0 * math.pi * self.sinus_links * t / RATE)).astype(np.float32)
        return x


def schreibe(pfad, frames, erzeuge, nan_bei=None, duenn=False):
    """Schreibt frames Stereo-Frames (float32 LE, verschränkt) aus erzeuge(a, e); gibt sha256 zurück."""
    if duenn:
        with open(pfad, "wb") as f:
            f.truncate(frames * 8)
        return "0" * 64
    h = hashlib.sha256()
    with open(pfad, "wb") as f:
        for a in range(0, frames, BLOCK):
            e = min(frames, a + BLOCK)
            x = erzeuge(a, e)
            if nan_bei is not None and a <= nan_bei < e:
                x[nan_bei - a, :] = np.nan
            b = np.ascontiguousarray(x, dtype="<f4").tobytes()
            h.update(b)
            f.write(b)
    return h.hexdigest()


def material_json(mid, titel, dauer_s, beats, lufs, erster, bpm, eins, sha):
    return {"schema": 1, "material_id": mid, "titel": titel,
            "herkunft": {"art": "datei", "prompt": None, "stil": None, "seed": None,
                         "generator": "djk/kern/tests/deck/klick_fassung.py", "erzeugt_am": None, "auftrag_id": None},
            "text": {"quelle": "keiner", "zeilen": []},
            "quelle": {"datei": "original.wav", "sr": RATE, "kanaele": 2, "dauer_s": dauer_s, "sha256": sha},
            "tempo_karte_quelle": [[erster / RATE, 0.0], [erster / RATE + beats * 60.0 / bpm, float(beats)]],
            "raster": {"werkzeug": "fixture", "zweitwerkzeug": "fixture", "abweichung_ms_p90": 0.0, "pulsklarheit": 1.0,
                       "erster_schlag_quelle_s": erster / RATE, "taktart": 4, "tempo_vielfaches": 1,
                       "erste_eins_quell_beat": eins, "erste_eins_zweitverfahren": eins},
            "lautheit_quelle": {"lufs_integriert": lufs, "echtspitze_dbtp": -5.1, "crest_db": 10.0},
            "tonart": {"camelot": None, "r": None, "vorsprung": None, "stimmung_cent": None, "stimmung_r": None,
                       "stimmung_cent_zweitwerkzeug": None, "aus_stems": False}}


def fassung_json(mid, bpm, fassung, frames, sha, erster, beats_gesamt, eins, lufs, stems, analyse):
    return {"schema": 1, "material_id": mid, "basis_bpm": bpm, "fassung": fassung, "korrekturen_bis_zeile": 0,
            "datei": "basis.f32", "frames": frames, "sha256": sha, "erster_schlag_frame": erster,
            "beats": round(beats_gesamt, 6), "erste_eins_quell_beat": eins, "analyse_quelle": analyse,
            "stems": stems, "schuesse": [], "headroom_db": -12.0, "stimmung_korrektur_cent": 0.0,
            "lautheit": {"lufs_integriert": lufs, "echtspitze_dbtp": -5.1, "crest_db": 10.0, "lufs_je_takt": []},
            "struktur": {"phrasen": [{"ab_beat": 0.0, "bis_beat": round(beats_gesamt, 6), "art": "unbekannt"}]},
            "hotcues": [], "loops": [],
            "tore": {"raster": {"ok": True, "wert_ms": 0.0, "grenze_ms": 8.0, "anschlaege": int(beats_gesamt)},
                     "headroom": {"ok": True, "wert_dbtp": -5.1, "grenze_dbtp": -1.0},
                     "klarheit": {"ok": True, "wert": 1.0, "grenze": 0.1},
                     "streckfaktor": {"ok": True, "wert": 1.0, "grenze": 0.15},
                     "eins": {"ok": True, "beat_this": eins, "zweitverfahren": eins}},
            "nur_fuer_andreas": False, "warnungen": ["Klick-Fassung der Scheibe 31, kein Musikmaterial"]}


def ein_material(ziel, mid, a, quellen, analyse):
    """Schreibt ein Material; quellen: {"basis": erzeuge} oder {stem: erzeuge}. Rückgabe (ordner, frames, sha)."""
    fpb = 60.0 / a.bpm * RATE
    frames = a.frames
    endgueltig = pathlib.Path(ziel) / mid
    tmp = pathlib.Path(ziel) / f".{mid}.tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    ordner = tmp / "fassungen" / f"{round(a.bpm * 1000)}_r{a.fassung}"
    ordner.mkdir(parents=True)
    stems = {}
    sha_basis = None
    for name, erzeuge in quellen.items():
        if name == "basis":
            sha_basis = schreibe(ordner / "basis.f32", frames, erzeuge, a.nan_bei, a.duenn)
        else:
            (ordner / "stems").mkdir(exist_ok=True)
            s = schreibe(ordner / "stems" / f"{name}.f32", frames, erzeuge, a.nan_bei if name == "vocals" else None)
            stems[name] = {"datei": f"stems/{name}.f32", "sha256": s, "frames": frames}
    sha_fassung = sha_basis if sha_basis else hashlib.sha256(b"").hexdigest()
    if a.falsche_pruefsumme and sha_basis:
        sha_fassung = ("f" if sha_basis[0] != "f" else "e") + sha_basis[1:]
    beats_gesamt = (frames - a.erster) / fpb
    fj = fassung_json(mid, a.bpm, a.fassung, frames, sha_fassung, a.erster, beats_gesamt, a.eins, a.lufs, stems,
                      analyse)
    (ordner / "fassung.json").write_text(json.dumps(fj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    mj = material_json(mid, f"Klick {mid}", frames / RATE, a.beats, a.lufs, a.erster, a.bpm, a.eins,
                       sha_basis or stems["drums"]["sha256"])
    (tmp / "material.json").write_text(json.dumps(mj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if endgueltig.exists():
        shutil.rmtree(endgueltig)
    os.rename(tmp, endgueltig)
    return str(endgueltig / "fassungen" / ordner.name), frames, sha_fassung


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ziel", required=True, help="Arbeitsbestand, z. B. /dev/shm/cypherdj-a/material")
    ap.add_argument("--material-id", default="c1c0000000000001")
    ap.add_argument("--beats", type=int, default=64, help="Zahl der Klicks (Quell-Beats 0 … beats−1)")
    ap.add_argument("--bpm", type=float, default=128.0)
    ap.add_argument("--fassung", type=int, default=1)
    ap.add_argument("--erster-schlag-frame", dest="erster", type=int, default=0)
    ap.add_argument("--erste-eins", dest="eins", type=int, default=0)
    ap.add_argument("--nachlauf-beats", type=float, default=1.0, help="Stille nach dem letzten Klick")
    ap.add_argument("--lufs", type=float, default=-16.0, help="lautheit.lufs_integriert (Trim = ziel_lufs − lufs)")
    ap.add_argument("--stems", action="store_true")
    ap.add_argument("--summe-als", help="zweites Material: Basis = float32-Summe der vier Stems")
    ap.add_argument("--nan-bei", type=int)
    ap.add_argument("--falsche-pruefsumme", action="store_true")
    ap.add_argument("--mib", type=int, help="Basis genau so viele MiB groß")
    ap.add_argument("--duenn", action="store_true", help="mit --mib: dünne Datei ohne Daten")
    ap.add_argument("--sinus-links", type=float, help="linker Kanal: Dauer-Sinus mit dieser Frequenz (Hz) statt Klicks")
    a = ap.parse_args(argv)
    fpb = 60.0 / a.bpm * RATE
    a.frames = int(math.ceil(a.erster + (a.beats + a.nachlauf_beats) * fpb))
    if a.mib:
        a.frames = a.mib * (1 << 20) // 8
    if a.stems and (a.duenn or a.mib):
        ap.error("--stems nicht zusammen mit --mib oder --duenn")
    if a.sinus_links and a.stems:
        ap.error("--sinus-links nicht zusammen mit --stems")
    pathlib.Path(a.ziel).mkdir(parents=True, exist_ok=True)
    args = (a.frames, a.erster, a.bpm, a.beats, a.eins)
    aus = []
    if a.stems:
        spuren = {"drums": Spur("klick", *args), "bass": Spur("bass", *args), "vocals": Spur("vocals", *args),
                  "other": Spur("other", *args)}
        quellen = {n: s.abschnitt for n, s in spuren.items()}
        aus.append(ein_material(a.ziel, a.material_id, a, quellen, "stems"))
        if a.summe_als:
            def summe(lo, hi):
                x = spuren["drums"].abschnitt(lo, hi)   # (((d + b) + v) + o) in float32, wie das Deck
                x = x + spuren["bass"].abschnitt(lo, hi)
                x = x + spuren["vocals"].abschnitt(lo, hi)
                return x + spuren["other"].abschnitt(lo, hi)
            b = argparse.Namespace(**vars(a))
            b.nan_bei = None
            aus.append(ein_material(a.ziel, a.summe_als, b, {"basis": summe}, "basis"))
    else:
        aus.append(ein_material(a.ziel, a.material_id, a,
                                {"basis": Spur("klick", *args, sinus_links=a.sinus_links).abschnitt}, "basis"))
    for ordner, frames, sha in aus:
        print(json.dumps({"material_id": pathlib.Path(ordner).parents[1].name, "ordner": ordner, "frames": frames,
                          "sha256": sha, "dauer_s": round(frames / RATE, 3)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
