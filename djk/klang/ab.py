"""A/B zweier Schleusen-Aufnahmen (djk-schleuse --ziel A, --ziel B): pegelgleich nach LUFS (probe.normiere_gruppe),
damit ein Hörvergleich nicht „lauter = besser“ misst (Katz). Schreibt <ziel>/a.wav, b.wav, ab.json.
Aufruf (aus djk/): werkstatt/.venv/bin/python -m klang.ab A B ZIEL"""
import argparse, json, sys
from pathlib import Path
from klang import lautheit, probe, wav

def vergleiche(a: Path, b: Path, ziel: Path) -> dict:
    xa, sra = wav.lies(Path(a) / "master.wav")
    xb, srb = wav.lies(Path(b) / "master.wav")
    if sra != srb:
        raise ValueError(f"Abtastraten verschieden: {sra} gegen {srb}")
    vorher = {"a": lautheit.integriert(xa, sra), "b": lautheit.integriert(xb, sra)}
    (ya, yb), ziel_lufs = probe.normiere_gruppe([xa, xb], sra)   # wirft ValueError bei Stille
    ziel = Path(ziel)
    wav.schreibe(ziel / "a.wav", ya, sra)                        # legt den Ordner selbst an
    wav.schreibe(ziel / "b.wav", yb, sra)
    ergebnis = {"a": str(a), "b": str(b), "vorher_lufs": vorher, "ziel_lufs": ziel_lufs,
                "true_peak_dbtp": {"a": lautheit.true_peak_db(ya, sra), "b": lautheit.true_peak_db(yb, sra)}}
    (ziel / "ab.json").write_text(json.dumps(ergebnis, indent=1))
    return ergebnis

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("a"); ap.add_argument("b"); ap.add_argument("ziel")
    o = ap.parse_args(argv)
    try:
        e = vergleiche(Path(o.a), Path(o.b), Path(o.ziel))
    except (OSError, ValueError) as x:
        print(f"ab: {x}", file=sys.stderr); return 2
    print(json.dumps(e, indent=1)); return 0

if __name__ == "__main__":
    sys.exit(main())
