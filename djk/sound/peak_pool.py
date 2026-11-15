"""Single-hit files of a pool folder whose peak sits close to the onset (the kit peak rule of rollen.json `spitze_regel`).
Exit: 0 ok, 2 unreadable folder or file. Run from djk/:
    python -m sound.peak_pool --wurzel <Drums folder> --ordner Cymbal --enthaelt crash --max-ms 20 --aus pool.json
Output: [{dateiname, pfad, spitze_ms, klingt_s}] sorted by spitze_ms. The peak position is measured from the onset, the first sample
within ONSET_DB of the peak (max over the channels), the same threshold as the kit build (`kit_bauen.spitze_ms`)."""
import argparse
import json
import os
import sys
import warnings
from pathlib import Path

import numpy as np

from sound import candidates as kandidaten, wav

ONSET_DB = 30.0


def spitze_ab_onset_ms(x: np.ndarray, rate: int) -> float:
    """Milliseconds from the first sample within ONSET_DB of the peak to the peak sample; 0.0 for silence."""
    a = np.abs(np.asarray(x, dtype=np.float32)).reshape(len(x), -1).max(axis=1) if np.ndim(x) > 1 else np.abs(np.asarray(x, dtype=np.float32))
    if a.size == 0 or float(a.max()) <= 0.0:
        return 0.0
    spitze = int(a.argmax())
    onset = int(np.argmax(a >= a[spitze] * 10 ** (-ONSET_DB / 20)))
    return (spitze - onset) / rate * 1000.0


def sammle(wurzel: Path, ordner: str, enthaelt: str, max_ms: float) -> list:
    pfad = wurzel / ordner
    if not pfad.is_dir():
        raise OSError(f"folder not readable: {pfad}")
    ergebnis = []
    for f in sorted(pfad.glob("*.wav")):
        if enthaelt.lower() not in f.name.lower():
            continue
        try:
            x, sr = wav.lies(f)
            if not np.isfinite(x).all():
                raise ValueError("not finite")
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", message=".*nperseg.*", category=UserWarning)
                if kandidaten.anschlaege(x, sr) != 1:
                    continue                                   # a fill, swell or loop, no single hit
                s = spitze_ab_onset_ms(x, sr)
                if s <= max_ms:
                    ergebnis.append({"dateiname": f.name, "pfad": str(f), "spitze_ms": round(s, 1), "klingt_s": round(kandidaten.klingt_s(x, sr), 4)})
        except kandidaten.LESEFEHLER as e:
            print(f"WARNING: skipped ({e}): {f}", file=sys.stderr)
    return sorted(ergebnis, key=lambda d: (d["spitze_ms"], d["dateiname"]))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wurzel", required=True)
    ap.add_argument("--ordner", required=True)
    ap.add_argument("--enthaelt", default="")
    ap.add_argument("--max-ms", type=float, default=20.0)
    ap.add_argument("--aus", required=True)
    a = ap.parse_args(argv)
    try:
        liste = sammle(Path(a.wurzel).expanduser(), a.ordner, a.enthaelt, a.max_ms)
    except OSError as e:
        print(f"ERROR: {e}; {a.aus} not written", file=sys.stderr)
        return 2
    ziel = Path(a.aus)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    tmp = ziel.with_name(ziel.name + ".tmp")
    tmp.write_text(json.dumps(liste, indent=1, ensure_ascii=False))
    os.replace(tmp, ziel)
    print(f"{len(liste)} files within {a.max_ms:g} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
