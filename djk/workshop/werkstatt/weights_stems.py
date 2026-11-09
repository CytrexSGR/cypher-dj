"""Fetch the BS-RoFormer-SW weights for werkstatt.stems ahead of time (plan 2026-11-06-stems-roformer-gpu, Task 1): from a local file
(--von, e.g. ~/werkstatt/stems-vergleich/dl/BS-Rofo-SW-Fixed.ckpt) or from the network. sha256 and size pinned (measured 2026-11-06).
Limit G3: nothing over 1 GB is downloaded (exit 3). Call: python -m werkstatt.weights_stems [--von PATH] [--ziel PATH] [--nur-pruefen]"""
import argparse
import shutil
import sys
import urllib.request
from pathlib import Path

from werkstatt.weights import GRENZE, groesse_im_netz, sha256

URL = "https://huggingface.co/enerjazzer/BS-ROFO-SW-Fixed/resolve/main/BS-Rofo-SW-Fixed.ckpt"   # bs-roformer-infer 0.1.5 overrides.json
GROESSE = 699412152
SHA256 = "24e7d35ee9c64415673d3fd33e06a67cac2c103c5df6267ba1576459c775916e"
ZIEL = Path(__file__).resolve().parent.parent / "gewichte" / "BS-Rofo-SW-Fixed.ckpt"


def uebernimm(von, ziel, soll=SHA256):
    """Datei `von` nach `ziel` ueber `<ziel>.teil`; 0 ok oder schon vorhanden, 2 sha256 falsch (die .teil bleibt zur Ansicht)."""
    ziel = Path(ziel)
    if ziel.is_file() and sha256(ziel) == soll:
        print(f"VORHANDEN {ziel} sha256 ok")
        return 0
    ziel.parent.mkdir(parents=True, exist_ok=True)
    teil = ziel.with_suffix(".teil")
    shutil.copyfile(von, teil)
    ist = sha256(teil)
    if ist != soll:
        print(f"FEHLER sha256 {ist} statt {soll}; {teil} bleibt zur Ansicht liegen")
        return 2
    teil.rename(ziel)
    print(f"GELADEN {ziel} sha256 ok")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--von", type=Path, default=None)
    ap.add_argument("--ziel", type=Path, default=ZIEL)
    ap.add_argument("--nur-pruefen", action="store_true")
    a = ap.parse_args(argv)
    if a.ziel.is_file() and sha256(a.ziel) == SHA256:          # idempotent, vor jedem Netzzugriff (Muster weights.py:57-60)
        print(f"VORHANDEN {a.ziel} sha256 ok")
        return 0
    if a.von is not None:
        return uebernimm(a.von, a.ziel)
    n = groesse_im_netz(URL)
    print(f"GROESSE {n} Bytes ({n / 2**20:.1f} MiB), Grenze {GRENZE} Bytes")
    if n > GRENZE:
        print("HALT: Download ueber der Grenze, nichts geladen. Andreas fragen (G3).")
        return 3
    if a.nur_pruefen:
        return 0
    a.ziel.parent.mkdir(parents=True, exist_ok=True)
    roh = a.ziel.with_suffix(".netz")
    with urllib.request.urlopen(URL, timeout=600) as r, open(roh, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    rc = uebernimm(roh, a.ziel)
    roh.unlink(missing_ok=True)
    return rc


if __name__ == "__main__":
    sys.exit(main())
