"""Gewichte von htdemucs (Paket 1.13 Slice 6, D3) vorab holen: aus einer lokalen Datei (--von, z. B. dem Cache der Probe) oder aus dem Netz.
sha256 festgenagelt (gemessen 2026-10-30 an ~/werkstatt/cypher-dj/s6-demucs-probe/torch/hub/checkpoints/955717e8-8726e21a.th, 84 141 911 Bytes).
Grenze G3: ueber 1 GB wird nichts geladen (Exit 3). Aufruf: python -m werkstatt.gewichte_stems [--von PFAD] [--ziel PFAD] [--nur-pruefen]"""
import argparse
import shutil
import sys
import urllib.request
from pathlib import Path

from werkstatt.gewichte import GRENZE, groesse_im_netz, sha256

URL = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th"   # demucs remote/files.txt, Wurzel hybrid_transformer/
GROESSE = 84141911
SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"
ZIEL = Path(__file__).resolve().parent.parent / "gewichte" / "htdemucs-955717e8.th"


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
    if a.ziel.is_file() and sha256(a.ziel) == SHA256:          # idempotent, vor jedem Netzzugriff (Muster gewichte.py:57-60)
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
