"""Ohren-Schleuse: prüft eine Aufnahme, bevor sie an Andreas' Ohren darf. Exit 0 bestanden, 1 durchgefallen, 2 Fehler.
Aufruf: python -m klang.schleuse <aufnahme.wav> [--referenz <ref.wav>] [--json <urteil.json>]"""
import argparse, json, os, sys
import numpy as np
from klang import lautheit, wav

PAKET_WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRENZEN = {"true_peak_max_dbtp": -1.0, "clips_max": 0, "korrelation_min": 0.0, "lufs_min": -30.0, "lufs_max": -6.0}

def _relativ(b: dict) -> dict:
    ges = 10 * np.log10(sum(10 ** (v / 10) for v in b.values()))
    return {k: v - ges for k, v in b.items()}

def endlich(o):
    """JSON kennt kein inf/nan: nicht-endliche Zahlen werden rekursiv zu None."""
    if isinstance(o, dict):
        return {k: endlich(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [endlich(v) for v in o]
    if isinstance(o, (float, np.floating)) and not np.isfinite(o):
        return None
    return o

_endlich = endlich   # alter Name, Alias


def urteil(x: np.ndarray, sr: int, referenz: np.ndarray | None = None) -> dict:
    nicht_endlich = int(np.count_nonzero(~np.isfinite(x)))
    dauer = len(x) / sr
    if nicht_endlich:
        x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)   # übrige Messungen auf dem bereinigten Signal
    m = {"lufs": lautheit.integriert(x, sr), "true_peak_dbtp": lautheit.true_peak_db(x, sr),
         "sample_spitze_db": lautheit.sample_spitze_db(x), "clips": lautheit.clips(x),
         "korrelation": lautheit.korrelation(x), "baender_db": lautheit.baender_db(x, sr),
         "dauer_s": dauer}
    v = []
    if nicht_endlich:
        v.append({"kriterium": "nicht_endlich", "wert": nicht_endlich, "grenze": 0})
    if m["true_peak_dbtp"] > GRENZEN["true_peak_max_dbtp"]:
        v.append({"kriterium": "true_peak", "wert": m["true_peak_dbtp"], "grenze": GRENZEN["true_peak_max_dbtp"]})
    if m["clips"] > GRENZEN["clips_max"]:
        v.append({"kriterium": "clips", "wert": m["clips"], "grenze": GRENZEN["clips_max"]})
    if m["korrelation"] <= GRENZEN["korrelation_min"]:
        v.append({"kriterium": "korrelation", "wert": m["korrelation"], "grenze": GRENZEN["korrelation_min"]})
    if not (GRENZEN["lufs_min"] <= m["lufs"] <= GRENZEN["lufs_max"]):
        v.append({"kriterium": "lautheit", "wert": m["lufs"], "grenze": [GRENZEN["lufs_min"], GRENZEN["lufs_max"]]})
    u = {"bestanden": not v, "verstoesse": v, "messung": m, "grenzen": GRENZEN}
    if referenz is not None:
        r_l = lautheit.integriert(referenz, sr)
        a, b = _relativ(m["baender_db"]), _relativ(lautheit.baender_db(referenz, sr))
        u["referenz"] = {"lufs": r_l, "lautheit_diff_db": m["lufs"] - r_l,
                         "baender_diff_db": {k: a[k] - b[k] for k in a}}
    return u

def _lauf(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("aufnahme"); ap.add_argument("--referenz"); ap.add_argument("--json")
    a = ap.parse_args(argv)
    x, sr = wav.lies(a.aufnahme)
    ref = None
    if a.referenz:
        ref, sr2 = wav.lies(a.referenz)
        if sr2 != sr:
            raise ValueError(f"Referenz {sr2} Hz, Aufnahme {sr} Hz")
    u = urteil(x, sr, ref)
    if a.json:                       # erst schreiben (atomar), dann urteilen: kein Urteil ohne Beleg
        tmp = f"{a.json}.tmp.{os.getpid()}"
        try:
            with open(tmp, "w") as f:
                json.dump(endlich(u), f, indent=1, allow_nan=False)
            os.replace(tmp, a.json)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise
    m = u["messung"]
    print(("BESTANDEN" if u["bestanden"] else "DURCHGEFALLEN") +
          f"  {m['lufs']:.1f} LUFS  TP {m['true_peak_dbtp']:.2f} dBTP  clips {m['clips']}  korr {m['korrelation']:.2f}")
    for v in u["verstoesse"]:
        print(f"  VERSTOSS {v['kriterium']}: {v['wert']} (Grenze {v['grenze']})")
    if "referenz" in u:
        r = u["referenz"]
        print(f"  gegen Referenz: {r['lautheit_diff_db']:+.1f} dB; Bänder " +
              " ".join(f"{k} {d:+.1f}" for k, d in r["baender_diff_db"].items()))
    return 0 if u["bestanden"] else 1

def main(argv=None) -> int:
    try:
        return _lauf(argv)
    except SystemExit:
        raise
    except Exception as e:
        print(f"FEHLER: {type(e).__name__}: {e}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    sys.exit(main())
