#!/usr/bin/env python3
"""Python-Referenz für die sechs Analyse-Bänder (Scheibe 14, Abnahme).

Aufruf: referenz_baender.py <baender.json> <eingang.f32> <kern_datensaetze.f32> [--verschiebe BAND:SEITE:FAKTOR]

Rechnet mit scipy.signal.sosfilt und den Koeffizienten aus baender.json dieselben Größen wie
AnalyseBaender (SCHNITTSTELLEN 6.2, Definition in baender.json "rms"): je 48 Samples
band[b] = sqrt(Summe(yL^2 + yR^2) / (48 * 2)), k_leistung = Summe(kL^2 + kR^2) / 48 (K-Filter aus
baender.json, BS.1770), spitze = max |x|; Fenster ab Frame 0, Filterzustand läuft durch.
Vergleicht mit den Datensätzen des C++-Werkzeugs messer_baender_datei (8 float32 je Datensatz).

Abweichung je Wert: relativ |c - p| / p für p >= 1e-6 (über -120 dB), sonst absolut |c - p|.
Grün, wenn relativ <= 1e-5 und absolut <= 1e-11 in allen Bändern, k_leistung und spitze.

--verschiebe tief:bis:1.01 (Fehlerfall): die Referenz baut dieses eine Band mit scipy.signal.butter
neu, die genannte Grenze mal FAKTOR; die übrigen Bänder bleiben aus baender.json. Erwartet: nur dieses
Band weicht deutlich ab (das Instrument sieht Fehler), die anderen bleiben grün.
Ausgabe: je Größe eine Zeile, am Ende GRUEN oder ROT; Rückgabewert 0 bei GRUEN, 1 bei ROT."""
import argparse
import os
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import baender_json  # noqa: E402

REL_GRENZE = 1e-5
ABS_GRENZE = 1e-11
BODEN = 1e-6
FENSTER = 48


def fensterwerte(x, sos_liste, k_sos):
    n = (len(x) // FENSTER) * FENSTER
    aus = []
    for sos in sos_liste:
        y = signal.sosfilt(np.asarray(sos, dtype=np.float64), x, axis=0)[:n]
        p = (y ** 2).sum(axis=1).reshape(-1, FENSTER).sum(axis=1) / (FENSTER * 2)
        aus.append(np.sqrt(p))
    k = signal.sosfilt(np.asarray(k_sos, dtype=np.float64), x, axis=0)[:n]
    aus.append((k ** 2).sum(axis=1).reshape(-1, FENSTER).sum(axis=1) / FENSTER)
    aus.append(np.abs(x[:n]).max(axis=1).reshape(-1, FENSTER).max(axis=1))
    return np.stack(aus, axis=1)   # (N, 8)


def abweichung(c, p):
    gross = p >= BODEN
    rel = np.abs(c[gross] - p[gross]) / p[gross] if gross.any() else np.zeros(1)
    ab = np.abs(c[~gross] - p[~gross]) if (~gross).any() else np.zeros(1)
    return float(rel.max()), float(ab.max()), int(gross.sum()), int((~gross).sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("baender_json")
    ap.add_argument("eingang")
    ap.add_argument("kern")
    ap.add_argument("--verschiebe", default=None)
    a = ap.parse_args()

    baender, k_sos = baender_json.lade(a.baender_json)
    sos_liste = [b[3] for b in baender]
    if a.verschiebe:
        name, seite, faktor = a.verschiebe.split(":")
        i = baender_json.NAMEN.index(name)
        _, von, bis, _ = baender[i]
        von, bis = (von * float(faktor), bis) if seite == "von" else (von, bis * float(faktor))
        hp = signal.butter(4, von, "highpass", fs=48000, output="sos")
        tp = signal.butter(4, bis, "lowpass", fs=48000, output="sos")
        sos_liste[i] = np.vstack([hp, tp]).tolist()
        print(f"FEHLERFALL: Band {name} in der Referenz mit {von:.2f} bis {bis:.2f} Hz neu entworfen")

    x = np.fromfile(a.eingang, dtype="<f4").reshape(-1, 2).astype(np.float64)
    p = fensterwerte(x, sos_liste, k_sos)
    c = np.fromfile(a.kern, dtype="<f4").reshape(-1, 8).astype(np.float64)
    print(f"datensaetze kern {len(c)} referenz {len(p)}")
    if len(c) != len(p):
        print("ROT: Zahl der Datensaetze verschieden")
        return 1
    namen = baender_json.NAMEN + ["k_leistung", "spitze"]
    # Abstand in float32-Stellen (ULP) zwischen Kern-Wert und auf float32 gerundeter Referenz: 0 heisst, der Kern
    # rechnet wie scipy in double und rundet nur beim Schreiben; rel_max um 5,96e-8 (2^-24) ist dann diese Rundung.
    p32 = p.astype(np.float32)
    ulp = np.abs(c.astype(np.float32).view(np.int32).astype(np.int64) - p32.view(np.int32).astype(np.int64))
    gruen = True
    for j, nm in enumerate(namen):
        rel, ab, n_gross, n_klein = abweichung(c[:, j], p[:, j])
        ok = rel <= REL_GRENZE and ab <= ABS_GRENZE
        gruen = gruen and ok
        print(f"{nm:11s} rel_max {rel:.3e} abs_max_unter_boden {ab:.3e} ulp_max {int(ulp[:, j].max())} "
              f"werte {n_gross}+{n_klein} null_kern {int((c[:, j] == 0).sum())} {'ok' if ok else 'ABWEICHUNG'}")
    print("GRUEN" if gruen else "ROT")
    return 0 if gruen else 1


if __name__ == "__main__":
    sys.exit(main())
