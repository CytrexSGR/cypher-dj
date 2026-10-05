#!/usr/bin/env python3
"""Selbsttest von klick_fassung.py (Scheibe 31): Klicks auf dem Raster §13.1, Prüfsumme und Größe nach §13.2,
Schemas des Vertrags, Stems gegen die Offline-Summe, Fehlerfälle NaN und falsche Prüfsumme.
Aufruf: test_klick_fassung.py   (Rückgabe 0: alles grün)"""
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile

import numpy as np

HIER = pathlib.Path(__file__).resolve().parent
DJK = HIER.parents[2]
sys.path.insert(0, str(DJK / "vertrag"))
from schema_lader import validator  # noqa: E402

fehler = 0


def pruef(bed, text):
    global fehler
    if not bed:
        print(f"GESCHEITERT: {text}")
        fehler += 1


def erzeuge(ziel, *args):
    r = subprocess.run([sys.executable, str(HIER / "klick_fassung.py"), "--ziel", str(ziel), *args],
                       capture_output=True, text=True)
    pruef(r.returncode == 0, f"klick_fassung.py {' '.join(args)}: {r.stderr}")
    return [json.loads(z) for z in r.stdout.splitlines() if z.strip()]


def lies(ordner, datei="basis.f32"):
    return np.fromfile(pathlib.Path(ordner) / datei, dtype="<f4").reshape(-1, 2)


def einsaetze(x, schwelle=0.1, ruhe=1000):
    ueber = np.flatnonzero(np.abs(x) > schwelle)
    if ueber.size == 0:
        return np.array([], dtype=np.int64)
    neu = np.diff(ueber) > ruhe
    return np.concatenate(([ueber[0]], ueber[1:][neu]))


with tempfile.TemporaryDirectory() as t:
    ziel = pathlib.Path(t)
    # 1) Raster: 16 Klicks ab erstem Schlag 1234 bei 128 BPM, Takt-Eins lauter
    [m] = erzeuge(ziel, "--material-id", "c1c0000000000010", "--beats", "16", "--erster-schlag-frame", "1234")
    x = lies(m["ordner"])
    e = einsaetze(x[:, 0])
    soll = 1234 + 22500 * np.arange(16)
    pruef(e.size == 16 and np.array_equal(e, soll), f"Einsätze {e[:4]} … gegen {soll[:4]} …")
    spitzen = [float(np.max(np.abs(x[s:s + 96, 0]))) for s in soll]
    pruef(all(abs(p - (0.5 if q % 4 == 0 else 0.25)) < 1e-6 for q, p in enumerate(spitzen)), f"Pegel {spitzen[:5]}")
    # 2) §13.2: Größe = frames · 2 · 4, sha256 stimmt; Schemas des Vertrags
    fj = json.loads((pathlib.Path(m["ordner"]) / "fassung.json").read_text())
    mj = json.loads((pathlib.Path(m["ordner"]).parents[1] / "material.json").read_text())
    datei = pathlib.Path(m["ordner"]) / "basis.f32"
    pruef(datei.stat().st_size == fj["frames"] * 8, "Größe frames·8")
    pruef(hashlib.sha256(datei.read_bytes()).hexdigest() == fj["sha256"], "sha256")
    pruef(abs(fj["erster_schlag_frame"] + fj["beats"] * 22500 - fj["frames"]) <= 1, "beats deckt frames (§13.1)")
    for name, obj in (("fassung.schema.json", fj), ("material.schema.json", mj)):
        fehlerliste = list(validator(name).iter_errors(obj))
        pruef(not fehlerliste, f"{name}: {[f.message for f in fehlerliste[:3]]}")
    # 3) Stems und Offline-Summe: die Basis des zweiten Materials ist die float32-Summe in der Reihenfolge des Decks
    ms = erzeuge(ziel, "--material-id", "c1c0000000000020", "--beats", "8", "--stems", "--summe-als",
                 "c1c0000000000021")
    pruef(len(ms) == 2, "zwei Materialien")
    o = pathlib.Path(ms[0]["ordner"])
    st = {n: lies(o, f"stems/{n}.f32") for n in ("drums", "bass", "vocals", "other")}
    summe = ((st["drums"] + st["bass"]) + st["vocals"]) + st["other"]
    basis = lies(ms[1]["ordner"])
    pruef(np.array_equal(summe, basis), "Offline-Summe bitgleich")
    andersrum = ((st["other"] + st["vocals"]) + st["bass"]) + st["drums"]
    pruef(not np.array_equal(andersrum, basis), "andere Summenreihenfolge ist nicht bitgleich (Reihenfolge zählt)")
    fs = json.loads((o / "fassung.json").read_text())
    pruef(fs["analyse_quelle"] == "stems" and sorted(fs["stems"]) == ["bass", "drums", "other", "vocals"], "Stems")
    pruef(not (o / "basis.f32").exists(), "mit Stems keine Basis-Datei (§4.4)")
    pruef(not list(validator("fassung.schema.json").iter_errors(fs)), "Stem-Fassung schema-gültig")
    # 4) Fehlerfälle: NaN an Frame 5000, falsche Prüfsumme; Negativ-Kontrolle: ohne Schalter kein NaN
    [n] = erzeuge(ziel, "--material-id", "c1c0000000000030", "--beats", "4", "--nan-bei", "5000")
    xn = lies(n["ordner"])
    pruef(np.isnan(xn[5000]).all() and int(np.isnan(xn).sum()) == 2, "NaN genau in Frame 5000")
    pruef(not np.isnan(x).any(), "Negativ-Kontrolle: kein NaN ohne Schalter")
    [f] = erzeuge(ziel, "--material-id", "c1c0000000000040", "--beats", "4", "--falsche-pruefsumme")
    ff = json.loads((pathlib.Path(f["ordner"]) / "fassung.json").read_text())
    pruef(ff["sha256"] != hashlib.sha256((pathlib.Path(f["ordner"]) / "basis.f32").read_bytes()).hexdigest(),
          "falsche Prüfsumme eingetragen")
    # 5) Größe in MiB, dünn
    [g] = erzeuge(ziel, "--material-id", "c1c0000000000050", "--mib", "8", "--duenn")
    pruef((pathlib.Path(g["ordner"]) / "basis.f32").stat().st_size == 8 << 20 and g["frames"] == (8 << 20) // 8,
          "dünne Datei 8 MiB")
    pruef(not any(p.name.startswith(".") for p in ziel.iterdir()), "keine Reste der atomaren Kopie")

print("alle Pruefungen gruen" if fehler == 0 else f"{fehler} Pruefung(en) gescheitert")
sys.exit(1 if fehler else 0)
