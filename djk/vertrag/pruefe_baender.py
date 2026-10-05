#!/usr/bin/env python3
"""Prüft djk/vertrag/baender.json gegen den Vertragstext §6.2, unabhängig vom Erzeuger:

1. Bandgrenzen: aus SCHNITTSTELLEN.md §6.2 gelesen ("Sub 30 bis 90, Tief 90 bis 250, ..."), nicht aus baender.json
   und nicht aus erzeuge_baender.py.
2. Form: sechs Bänder in dieser Reihenfolge (sub, tief, tiefmitte, mitte, praesenz, hoch), je vier Biquads, a0 = 1.
3. Frequenzgang je Band mit scipy.signal.sosfreqz nachgerechnet: die zwei -3-dB-Punkte (bezogen auf 0 dB) liegen je
   höchstens 2 % neben der Bandgrenze aus dem Text.
4. Stabilität: alle Pole im Einheitskreis.
5. K-Filter: Verstärkung bei 997 Hz = +0,691 dB ±0,01 (BS.1770-Bezug, daher die -0,691 in der LUFS-Formel).

Aufruf: python3 djk/vertrag/pruefe_baender.py [pfad/zu/baender.json] [--vertrag PFAD]   Rückgabe 0 = grün, 1 = rot.
"""
import json
import pathlib
import re
import sys

import numpy as np
from scipy import optimize, signal

HIER = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import vertragstext  # noqa: E402  (Scheibe 02)

SR = 48000
NAMEN = [("Sub", "sub"), ("Tief", "tief"), ("Tiefmitte", "tiefmitte"), ("Mitte", "mitte"), ("Präsenz", "praesenz"),
         ("Hoch", "hoch")]
TOLERANZ = 0.02
MINUS3 = -10 * np.log10(2.0)   # -3,0103 dB


def baender_aus_vertrag(text):
    """[(name, unten_hz, oben_hz)] aus dem Satz in §6.2 über die sechs Analyse-Bänder."""
    teil = text[text.index("### 6.2"):text.index("### 6.3")]
    muster = r",\s+".join(rf"{t}\s+(\d+)\s+bis\s+(\d+)" for t, _ in NAMEN) + r"\s+Hz"
    m = re.search(muster, teil)
    if not m:
        raise ValueError("§6.2: Satz mit den sechs Bandgrenzen nicht gefunden (Vertragstext geändert?)")
    zahlen = [float(z) for z in m.groups()]
    return [(n, zahlen[2 * i], zahlen[2 * i + 1]) for i, (_, n) in enumerate(NAMEN)]


def gang_db(sos, f):
    _, h = signal.sosfreqz(np.asarray(sos), worN=np.atleast_1d(f), fs=SR)
    return 20 * np.log10(np.abs(h))


def minus3_punkte(sos, lo, hi):
    """Sucht die -3-dB-Durchgänge unterhalb und oberhalb der geometrischen Bandmitte."""
    mitte = np.sqrt(lo * hi)
    g = lambda f: float(gang_db(sos, f)[0]) - MINUS3
    f_u = optimize.brentq(g, lo / 4, mitte)
    f_o = optimize.brentq(g, mitte, min(hi * 4, SR / 2 - 1))
    return f_u, f_o


def pruefe(daten, vertrag):
    """Liste der Befunde (leer = grün) und die Protokollzeilen."""
    fehler, zeilen = [], []
    b = daten.get("baender", [])
    if [x.get("name") for x in b] != [n for n, _, _ in vertrag]:
        fehler.append(f"Reihenfolge/Namen: {[x.get('name') for x in b]}")
    for x, (name, lo, hi) in zip(b, vertrag):
        sos = np.asarray(x["sos"], dtype=float)
        if sos.shape != (4, 6) or not np.allclose(sos[:, 3], 1.0):
            fehler.append(f"{name}: Form {sos.shape}, a0 {sos[:, 3] if sos.ndim == 2 else '?'}")
            continue
        pole = np.concatenate([np.roots(z[3:]) for z in sos])
        if np.max(np.abs(pole)) >= 1.0:
            fehler.append(f"{name}: instabil, |Pol| max {np.max(np.abs(pole)):.6f}")
        try:
            f_u, f_o = minus3_punkte(sos, lo, hi)
        except ValueError:
            fehler.append(f"{name}: kein -3-dB-Durchgang um {lo:g} bis {hi:g} Hz (falsches Band an dieser Stelle?)")
            continue
        du, do = (f_u - lo) / lo, (f_o - hi) / hi
        mitte_db = float(gang_db(sos, np.sqrt(lo * hi))[0])
        zeilen.append(f"{name:9s} -3 dB bei {f_u:9.3f} Hz ({du:+.3%}) und {f_o:9.3f} Hz ({do:+.3%}), "
                      f"Mitte {mitte_db:+.4f} dB")
        if abs(du) > TOLERANZ or abs(do) > TOLERANZ:
            fehler.append(f"{name}: -3-dB-Punkte {f_u:.2f}/{f_o:.2f} Hz statt {lo:g}/{hi:g} Hz ±2 %")
    k = daten.get("k_filter", {}).get("sos")
    if k is None:
        fehler.append("k_filter fehlt")
    else:
        g997 = float(gang_db(k, 997.0)[0])
        zeilen.append(f"k_filter  Verstärkung bei 997 Hz {g997:+.4f} dB")
        if abs(g997 - 0.691) > 0.01:
            fehler.append(f"k_filter: {g997:+.4f} dB bei 997 Hz statt +0,691 ±0,01")
    return fehler, zeilen


def main(argv):
    vertrag_pfad = pathlib.Path(argv[argv.index("--vertrag") + 1]) if "--vertrag" in argv else vertragstext.VERTRAG
    rest = [a for i, a in enumerate(argv) if a != "--vertrag" and (i == 0 or argv[i - 1] != "--vertrag")]
    pfad = pathlib.Path(rest[0]) if rest else HIER / "baender.json"
    if not pfad.is_file():
        print(f"ROT: {pfad} fehlt")
        return 1
    vertrag = baender_aus_vertrag(vertragstext.lies(vertrag_pfad))
    print("§6.2 laut Text: " + ", ".join(f"{n} {lo:g} bis {hi:g}" for n, lo, hi in vertrag) + " Hz")
    fehler, zeilen = pruefe(json.loads(pfad.read_text(encoding="utf-8")), vertrag)
    for z in zeilen:
        print(z)
    for f in fehler:
        print("FEHLER", f)
    print("GRÜN" if not fehler else f"ROT: {len(fehler)} Fehler")
    return 0 if not fehler else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
