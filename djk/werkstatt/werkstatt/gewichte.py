"""Gewichte von beat_this vorab laden, mit Groessenpruefung vor dem Download.
Grenze G3: ueber 1 GB wird nichts geladen (Exit 3, Andreas fragen).

Aufruf: python -m werkstatt.gewichte [--grenze BYTES] [--nur-pruefen]"""
import argparse, hashlib, sys, time, urllib.request
from pathlib import Path

# beat_this/inference.py: CHECKPOINT_URL + "/final0.ckpt" (Standard-Checkpoint "final0")
URL = "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt"
GROESSE = 81058141      # Content-Length, gemessen 2026-09-23
SHA256 = "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"   # gemessen 2026-09-23
GRENZE = 1_000_000_000
ZIEL = Path(__file__).resolve().parent.parent / "gewichte" / "beat_this-final0.ckpt"


def groesse_im_netz(url, versuche=4):
    """Content-Length per HEAD; der Server antwortete am 2026-09-23 einmal mit 504, darum Wiederholung."""
    letzter = None
    for i in range(versuche):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
                n = r.headers.get("Content-Length")
                if r.status == 200 and n is not None:
                    return int(n)
                letzter = f"HTTP {r.status}, Content-Length {n}"
        except Exception as e:          # HTTPError 504, Zeitueberschreitung
            letzter = repr(e)
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"Groesse nicht ermittelbar nach {versuche} Versuchen: {letzter}")


def sha256(pfad):
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--grenze", type=int, default=GRENZE)
    ap.add_argument("--nur-pruefen", action="store_true")
    ap.add_argument("--ziel", type=Path, default=ZIEL)
    a = ap.parse_args(argv)
    n = groesse_im_netz(URL)
    print(f"GROESSE {n} Bytes ({n / 2**20:.1f} MiB), Grenze {a.grenze} Bytes")
    if n > a.grenze:
        print("HALT: Download ueber der Grenze, nichts geladen. Andreas fragen (G3).")
        return 3
    if n != GROESSE:
        print(f"WARNUNG: Groesse weicht vom Stand 2026-09-23 ab ({GROESSE}); sha256 entscheidet")
    if a.nur_pruefen:
        return 0
    if a.ziel.is_file() and sha256(a.ziel) == SHA256:
        print(f"VORHANDEN {a.ziel} sha256 ok")
        return 0
    a.ziel.parent.mkdir(parents=True, exist_ok=True)
    teil = a.ziel.with_suffix(".teil")
    with urllib.request.urlopen(URL, timeout=600) as r, open(teil, "wb") as f:
        while True:
            block = r.read(1 << 20)
            if not block:
                break
            f.write(block)
    ist = sha256(teil)
    if ist != SHA256:
        print(f"FEHLER sha256 {ist} statt {SHA256}; {teil} bleibt zur Ansicht liegen")
        return 2
    teil.rename(a.ziel)
    print(f"GELADEN {a.ziel} {a.ziel.stat().st_size} Bytes sha256 ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
