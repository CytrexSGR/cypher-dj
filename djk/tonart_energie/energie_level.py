"""energie(pfad) -> {"level": int 1..10, "wert": float}: MIK-ähnliches EnergyLevel für Tracks ohne MIK.

Rechnet dieselben Merkmale wie der Cache-Lauf (merkmale.energie + Essentia-TF-Köpfe), ohne Tag-Werte
(kein TBPM, kein Genre), und wendet das in modell/energie.joblib gespeicherte Modell an.
Nur CPU (CUDA_VISIBLE_DEVICES=""). Kosten je Track ≈ 20 s auf einem Kern, fast alles MusiCNN/EffNet.

Aufruf: cd djk && ~/cypher-dj/cues/venv-mik/bin/python -m tonart_energie.energie_level <mp3> [...]
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
# Ein Thread je Prozess. Muss VOR dem ersten Import von numpy/essentia stehen: gemessen am selben Track
# ohne diese Zeilen 4,9 CPU-Kerne je Prozess (Wand 7,2 s, CPU 35,1 s), mit ihnen 0,98 (20,0 s / 19,7 s).
for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "TF_NUM_INTRAOP_THREADS",
           "TF_NUM_INTEROP_THREADS"):
    os.environ.setdefault(_k, "1")

import numpy as np

MODELL_DATEI = Path(__file__).resolve().parent / "modell" / "energie.joblib"
_zustand: dict = {}
_paket: dict = {}


def paket() -> dict:
    if not _paket:
        import joblib
        _paket.update(joblib.load(MODELL_DATEI))
    return _paket


def _laden() -> dict:
    if not _zustand:
        import essentia
        essentia.log.infoActive = False
        essentia.log.warningActive = False
        import essentia.standard as es
        from . import merkmale
        braucht_tf = any(s.startswith(("tf_", "jam56_", "effnet_", "musicnn_")) for s in paket()["spalten"])
        _zustand.update(es=es, merkmale=merkmale,
                        tf=merkmale.TFModelle(es) if braucht_tf else None)
    return _zustand


def merkmale_aus_audio(x: np.ndarray) -> dict[str, float]:
    z = _laden()
    m, es, tf = z["merkmale"], z["es"], z["tf"]
    werte, vek = m.energie(x, es, None)[0], {}
    werte["dauer_s"] = len(x) / m.SR
    if tf is not None:
        zt, vt = tf(x)
        werte.update(zt)
        vek.update(vt)
        klassen = tf.jamendo_klassen
        for i, c in enumerate(klassen):
            werte[f"jam56_{c}"] = float(vt["jamendo56"][i])
        for i, v in enumerate(vt["effnet_emb"]):
            werte[f"effnet_{i}"] = float(v)
        for i, v in enumerate(vt["musicnn_emb"]):
            werte[f"musicnn_{i}"] = float(v)
    return werte


def aus_merkmalen(werte: dict[str, float]) -> dict:
    pk = paket()
    X = np.array([[float(werte[s]) for s in pk["spalten"]]])
    if not np.all(np.isfinite(X)):
        fehlt = [s for s, v in zip(pk["spalten"], X[0]) if not np.isfinite(v)]
        raise ValueError(f"nicht endliche Merkmale: {fehlt[:5]}")
    wert = float(pk["modell"].predict(X)[0])
    return {"level": int(np.clip(np.rint(wert), 1, 10)), "wert": round(wert, 3)}


def energie(pfad: str | Path) -> dict:
    """EnergyLevel wie Mixed In Key (gelernt an 600 MIK-Tracks). Rückgabe {"level": 1..10, "wert": stetig}."""
    m = _laden()["merkmale"]
    x = m.dekodiere(str(pfad))
    if len(x) < m.SR * 5:
        raise ValueError(f"zu kurz für eine Energieschätzung: {len(x) / m.SR:.1f} s")
    return aus_merkmalen(merkmale_aus_audio(x))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(json.dumps({"pfad": p, **energie(p)}, ensure_ascii=False), flush=True)
