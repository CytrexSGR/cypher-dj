"""Scheibe 15, Messung der Stimmungsregel (offline, stumm): synthetische Akkorde mit bekannter Verstimmung durch beide
Werkzeuge und die Regel; FEHLERFALL vorher/nachher: der -20-ct-Akkord durch den Warp ohne und mit Korrektur, danach mit
dem eigenen Werkzeug gemessen; NEGATIV-KONTROLLE: unverstimmter Akkord (Korrektur hoechstens 1 ct) und Stille (keine
Korrektur, obwohl Essentia bei Stille 0 ct meldet). Schreibt berichte/15-stimmung.json und .md.

Aufruf (aus djk/werkstatt): nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.pruefe_stimmung"""
import json
from pathlib import Path

import numpy as np

from .eingang import luft, schreibe_float_wav
from .karte import Karte
from .stimmung import eigen, entscheide, essentia_cent
from .warp import lies_float_wav, timemap, warp

HIER = Path(__file__).resolve().parent.parent
ARBEIT = HIER / "pruef" / "stimmung"


def akkord(cent, sr, dauer=30.0):
    """C3, C4, E4, G4 mit je vier Obertoenen, um `cent` gegen A = 440 Hz verstimmt."""
    t = np.arange(int(dauer * sr)) / sr
    return 0.1 * sum(sum(0.3 / h * np.sin(2 * np.pi * 440 * 2 ** ((n - 69) / 12) * 2 ** (cent / 1200) * h * t)
                         for h in (1, 2, 3, 4)) for n in (48, 60, 64, 67))


def fall(x48, x44):
    c1, r = eigen(x48)
    c2 = essentia_cent(x44)
    d = entscheide(c1, r, c2)
    return {"eigen": None if c1 is None else round(c1, 2), "r": None if r is None else round(r, 3),
            "essentia": None if c2 is None else round(c2, 2), **d}


def main():
    ARBEIT.mkdir(parents=True, exist_ok=True)
    erg = {f"akkord_{c:+.0f}": fall(akkord(c, 48000), akkord(c, 44100)) for c in (0.0, -20.0, 20.0, -40.0)}
    erg["stille"] = fall(np.zeros(30 * 48000), np.zeros(30 * 44100))
    x = akkord(-20.0, 48000)
    st = np.stack([x, x], 1).astype(np.float32)
    schreibe_float_wav(luft(st), ARBEIT / "akk_m20.wav")
    tm = timemap(Karte(sekunden=0.25 + np.arange(60) * 60 / 128.0, beats=np.arange(60.0)), 128.0, len(st))
    for name, k in (("warp_ohne_korrektur", 0.0), ("warp_mit_korrektur", erg["akkord_-20"]["korrektur_cent"])):
        warp(ARBEIT / "akk_m20.wav", ARBEIT / f"{name}.wav", tm, korrektur_cent=k)
        c, r = eigen(lies_float_wav(ARBEIT / f"{name}.wav").mean(1))
        erg[name] = {"korrektur_cent": k, "eigen_danach": round(c, 2), "r_danach": round(r, 3)}
    erg["urteil"] = {
        "minus20_korrigiert": erg["akkord_-20"]["grund"] == "korrigiert",
        "nachher_unter_1ct": abs(erg["warp_mit_korrektur"]["eigen_danach"]) <= 1.0,
        "ohne_korrektur_bleibt_minus20": abs(erg["warp_ohne_korrektur"]["eigen_danach"] + 20.0) <= 1.0,
        "unverstimmt_hoechstens_1ct": abs(erg["akkord_+0"]["korrektur_cent"]) <= 1.0,
        "minus40_warnung": erg["akkord_-40"]["grund"] == "zu_weit" and erg["akkord_-40"]["korrektur_cent"] == 0.0,
        "stille_keine_korrektur": erg["stille"]["korrektur_cent"] == 0.0 and erg["stille"]["warnung"] is not None}
    (HIER / "berichte").mkdir(exist_ok=True)
    (HIER / "berichte" / "15-stimmung.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False) + "\n")
    z = ["# Scheibe 15: Stimmungsregel an synthetischen Akkorden (offline, stumm)", "",
         "| Fall | eigen ct | R | Essentia ct | Entscheid | Korrektur ct |", "|---|---|---|---|---|---|"]
    for n in ("akkord_+0", "akkord_-20", "akkord_+20", "akkord_-40", "stille"):
        e = erg[n]
        z.append(f"| {n} | {e['eigen']} | {e['r']} | {e['essentia']} | {e['grund']} | {e['korrektur_cent']} |")
    z += ["", "| Warp des −20-ct-Akkords | Korrektur ct | eigen danach ct |", "|---|---|---|"]
    for n in ("warp_ohne_korrektur", "warp_mit_korrektur"):
        z.append(f"| {n} | {erg[n]['korrektur_cent']} | {erg[n]['eigen_danach']} |")
    z += ["", "## Urteil", ""] + [f"- {n}: {'ja' if v else 'NEIN'}" for n, v in erg["urteil"].items()]
    (HIER / "berichte" / "15-stimmung.md").write_text("\n".join(z) + "\n")
    print("\n".join(z))
    return 0 if all(erg["urteil"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
