#!/usr/bin/env python3
"""Fixture-Material für die Golden-Folgen (folgen/material/<material_id>/).

Die JSON-Dateien (material.json, fassungen/128000_r1/fassung.json) liegen im Repo; die Audiodaten (.f32) sind
deterministisch und werden erzeugt, nicht eingecheckt: je Schlag ein 24-Sample-Rechteck (±0,5, auf der Takt-Eins
±0,9), sonst Stille; exakt darstellbar in float32, also auf jeder Maschine dieselbe sha256.

  --spec          schreibt die JSON-Dateien neu (sha256 aus den erzeugten Daten)       (einmal, beim Anlegen)
  --ziel ORDNER   schreibt <ORDNER>/<material_id>/... samt .f32 und prüft sha256 gegen fassung.json
                  (ORDNER ist der Arbeitsbestand, z. B. /dev/shm/cypherdj-b/material; Läufer der Folgen rufen das)
"""
import hashlib
import json
import pathlib
import sys

import numpy as np

HIER = pathlib.Path(__file__).resolve().parent
FIXTURES = HIER / "folgen" / "material"
SPB = 22500   # Frames je Beat bei 128 BPM
# material_id: (beats, lufs_integriert, schuesse)
SPEC = {"f0000000000000a1": (256, -16.0, 0), "f0000000000000b2": (256, -16.0, 0), "f0000000000000c3": (64, -9.4, 0),
        "f0000000000000d4": (64, -45.0, 0), "f0000000000000e5": (32, -16.0, 2), "f000000000000096": (96, -16.0, 0),
        "f000000000000128": (128, -16.0, 0)}


def basis(beats):
    x = np.zeros((beats * SPB, 2), dtype=np.float32)
    muster = np.tile(np.array([0.5, -0.5], dtype=np.float32), 12)
    for b in range(beats):
        x[b * SPB:b * SPB + 24, :] = (muster * (1.8 if b % 4 == 0 else 1.0))[:, None]
    return x


def schuss(nr):
    x = np.zeros((4800, 2), dtype=np.float32)
    x[:24, :] = np.tile(np.array([0.25, -0.25], dtype=np.float32), 12)[:, None] / nr
    return x


def sha(x):
    return hashlib.sha256(np.ascontiguousarray(x, dtype="<f4").tobytes()).hexdigest()


def dateien(mid):
    beats, _, n_schuss = SPEC[mid]
    d = {"basis.f32": basis(beats)}
    for nr in range(1, n_schuss + 1):
        d[f"schuesse/{nr}.f32"] = schuss(nr)
    return d


def fassung_json(mid):
    beats, lufs, n_schuss = SPEC[mid]
    d = dateien(mid)
    b = d["basis.f32"]
    tore = {"raster": {"ok": True, "wert_ms": 0.0, "grenze_ms": 8.0, "anschlaege": beats},
            "headroom": {"ok": True, "wert_dbtp": -5.1, "grenze_dbtp": -1.0}, "klarheit": {"ok": True, "wert": 1.0, "grenze": 0.1},
            "streckfaktor": {"ok": True, "wert": 1.0, "grenze": 0.20}, "eins": {"ok": True, "beat_this": 0, "zweitverfahren": 0}}
    return {"schema": 1, "material_id": mid, "basis_bpm": 128.0, "fassung": 1, "korrekturen_bis_zeile": 0,
            "datei": "basis.f32", "frames": int(b.shape[0]), "sha256": sha(b), "erster_schlag_frame": 0, "beats": float(beats),
            "erste_eins_quell_beat": 0, "analyse_quelle": "basis", "stems": {},
            "schuesse": [{"nr": nr, "datei": f"schuesse/{nr}.f32", "frames": int(d[f'schuesse/{nr}.f32'].shape[0]),
                          "quell_beat": 0.0, "name": f"klick {nr}"}
                         for nr in range(1, n_schuss + 1)],
            "headroom_db": -12.0, "stimmung_korrektur_cent": 0.0,
            "lautheit": {"lufs_integriert": lufs, "echtspitze_dbtp": -5.1, "crest_db": 10.0, "lufs_je_takt": []},
            "struktur": {"phrasen": [{"ab_beat": 0.0, "bis_beat": float(beats), "art": "unbekannt"}]},
            "hotcues": [], "loops": [], "tore": tore, "nur_fuer_andreas": False, "warnungen": ["Fixture der Golden-Folgen, kein Musikmaterial"]}


def material_json(mid):
    beats, lufs, _ = SPEC[mid]
    dauer = beats * SPB / 48000.0
    return {"schema": 1, "material_id": mid, "titel": f"Fixture {mid}",
            "herkunft": {"art": "datei", "prompt": None, "stil": None, "seed": None, "generator": "djk/vertrag/erzeuge_material.py",
                         "erzeugt_am": None, "auftrag_id": None},
            "text": {"quelle": "keiner", "zeilen": []},
            "quelle": {"datei": "original.wav", "sr": 48000, "kanaele": 2, "dauer_s": dauer, "sha256": sha(basis(beats))},
            "tempo_karte_quelle": [[0.0, 0.0], [dauer, float(beats)]],
            "raster": {"werkzeug": "fixture", "zweitwerkzeug": "fixture", "abweichung_ms_p90": 0.0, "pulsklarheit": 1.0,
                       "erster_schlag_quelle_s": 0.0, "taktart": 4, "tempo_vielfaches": 1, "erste_eins_quell_beat": 0,
                       "erste_eins_zweitverfahren": 0},
            "lautheit_quelle": {"lufs_integriert": lufs, "echtspitze_dbtp": -5.1, "crest_db": 10.0},
            "tonart": {"camelot": None, "r": None, "vorsprung": None, "stimmung_cent": None, "stimmung_r": None,
                       "stimmung_cent_zweitwerkzeug": None, "aus_stems": False}}


def schreibe_spec():
    for mid in SPEC:
        o = FIXTURES / mid
        (o / "fassungen" / "128000_r1").mkdir(parents=True, exist_ok=True)
        (o / "material.json").write_text(json.dumps(material_json(mid), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        (o / "fassungen" / "128000_r1" / "fassung.json").write_text(
            json.dumps(fassung_json(mid), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(SPEC)} Fixtures nach {FIXTURES}")


def schreibe_ziel(ziel, nur=None):
    fehler = 0
    for mid in sorted(nur or SPEC):
        quelle = FIXTURES / mid
        fj = json.loads((quelle / "fassungen" / "128000_r1" / "fassung.json").read_text(encoding="utf-8"))
        o = pathlib.Path(ziel) / mid / "fassungen" / "128000_r1"
        (o / "schuesse").mkdir(parents=True, exist_ok=True)
        (pathlib.Path(ziel) / mid / "material.json").write_text((quelle / "material.json").read_text(encoding="utf-8"), encoding="utf-8")
        (o / "fassung.json").write_text(json.dumps(fj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        for name, x in dateien(mid).items():
            (o / name).write_bytes(np.ascontiguousarray(x, dtype="<f4").tobytes())
        if sha(dateien(mid)["basis.f32"]) != fj["sha256"]:
            print(f"FEHLER {mid}/basis.f32: sha256 weicht von fassung.json ab")
            fehler += 1
        if (o / "basis.f32").stat().st_size != fj["frames"] * 2 * 4:
            print(f"FEHLER {mid}: Größe {(o / 'basis.f32').stat().st_size} statt frames·2·4 (§13.2)")
            fehler += 1
    print(f"{len(nur or SPEC)} Materialien nach {ziel}, {fehler} Fehler")
    return 0 if fehler == 0 else 1


if __name__ == "__main__":
    if "--spec" in sys.argv:
        schreibe_spec()
        sys.exit(0)
    if "--ziel" in sys.argv:
        sys.exit(schreibe_ziel(sys.argv[sys.argv.index("--ziel") + 1]))
    print(__doc__)
    sys.exit(2)
