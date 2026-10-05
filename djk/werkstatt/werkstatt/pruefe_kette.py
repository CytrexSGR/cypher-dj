"""Scheibe 15, Kontrollen durch die ganze Kette (offline, stumm), in eigenen Pruef-Bestaenden unter pruef/ (nie im
echten Bestand, ROADMAP §3 Z2):

  A  konst134 und drift_synth mit wahrer Karte durch `einlesen`: Raster am Ausgang von basis.f32 (Klick-Instrument),
     Stimmungsentscheid, Klemmen, Index. Erwartung wie die reine Warp-Mechanik (berichte/15-warp.md).
  B  Wirkung einer Raster-Korrektur am selben Fall (FEHLERFALL vorher/nachher): konst134 mit einer Karte, die im
     Abschnitt [32, 64) um 8 ms zu frueh liegt. r1 zeigt dort spaete Anschlaege; eine Korrektur mit dem gemessenen
     Versatz legt r2 an, dort liegen sie auf dem Raster; ausserhalb aendert sich nichts (NEGATIV-KONTROLLE);
     r1 bleibt bytegleich.
Schreibt berichte/15-kette.json und berichte/15-kette.md.

Aufruf (aus djk/werkstatt): nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.pruefe_kette"""
import hashlib
import json
from pathlib import Path

import numpy as np

from . import kontrollen as K
from .bestand import aufraeumen, korrektur_anhaengen, lies_json
from .index import zaehle
from .karte import Karte
from .kette import einlesen, korrigieren
from .messwerk import anschlaege
from .rastermessung import lade_f32_mono_hp, miss_starr

HIER = Path(__file__).resolve().parent.parent
PRUEF = HIER / "pruef"


def sha(ordner):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ordner.iterdir())}


def teil_a():
    b = PRUEF / "kontroll_bestand"
    aufraeumen(b)
    b.mkdir(parents=True)
    erg = {}
    for name, wahr in (("konst134", K.wahrheit_konst134()), ("drift_synth", K.wahrheit_drift())):
        e = einlesen(K.pruefe(*K.KONTROLLEN[name]), b, titel=name,
                     karte=Karte(sekunden=np.asarray(wahr, float), beats=np.arange(len(wahr), dtype=float)))
        f = lies_json(b / e["material_id"] / "fassungen" / "128000_r1" / "fassung.json")
        soll = (f["erster_schlag_frame"] + np.arange(len(wahr)) * 22500) / 48000
        m = miss_starr(b / e["material_id"] / "fassungen" / "128000_r1" / "basis.f32", 128.0, soll)
        erg[name] = {"material_id": e["material_id"], "raster": m, "stimmung": e["stimmung"]["grund"],
                     "korrektur_cent": e["stimmung"]["korrektur_cent"], "geklemmt": e["messwerte"]["geklemmt"],
                     "lufs": e["lufs"], "zeiten": e["zeiten"]}
    erg["index"] = list(zaehle(b))
    return erg


def lage(mo, fassung, q):
    """Abstand jedes Klicks zu seinem Soll auf dem starren Raster der Fassung: Median innen [34, 62), aussen."""
    f = lies_json(mo / "fassungen" / fassung / "fassung.json")
    t = anschlaege(lade_f32_mono_hp(mo / "fassungen" / fassung / "basis.f32"), 48000, fenster_ms=2.0, schwelle=0.3,
                   ruhe_ms=60.0)
    soll = (f["erster_schlag_frame"] + q * 22500) / 48000
    d = np.array([(t[np.argmin(np.abs(t - x))] - x) * 1000 for x in soll])
    innen, aussen = (q >= 34) & (q < 62), (q < 30) | (q >= 66)
    return {"innen_median_ms": round(float(np.median(d[innen])), 3), "innen_max_ms": round(float(np.abs(d[innen]).max()), 3),
            "aussen_median_ms": round(float(np.median(d[aussen])), 3),
            "aussen_max_ms": round(float(np.abs(d[aussen]).max()), 3), "anschlaege": int(len(t))}


def teil_b():
    b = PRUEF / "korrektur_bestand"
    aufraeumen(b)
    b.mkdir(parents=True)
    s = np.asarray(K.wahrheit_konst134(), float).copy()
    q = np.arange(len(s), dtype=float)
    s[(q >= 32) & (q < 64)] -= 0.008
    e = einlesen(K.pruefe(*K.KONTROLLEN["konst134"]), b, titel="konst134_falsch", karte=Karte(sekunden=s, beats=q))
    mo = b / e["material_id"]
    r1 = mo / "fassungen" / "128000_r1"
    vorher = sha(r1)
    l1 = lage(mo, "128000_r1", q)
    versatz = round(l1["innen_median_ms"] - l1["aussen_median_ms"], 3)
    n = korrektur_anhaengen(mo, {"zeit": "2026-09-23T09:00:00", "von": "werkstatt", "art": "raster",
                                 "fassung": "128000_r1", "ab_quell_beat": 32.0, "bis_quell_beat": 64.0,
                                 "versatz_ms": versatz, "nr": None,
                                 "text": "Pruefung 15: Abschnitt 32 bis 64 um den gemessenen Versatz"})
    k = korrigieren(e["material_id"], b)
    l2 = lage(mo, "128000_r2", q)
    return {"r1": l1, "versatz_ms": versatz, "zeilen": n, "neue_fassung": k["fassung"],
            "korrekturen_bis_zeile": k["korrekturen_bis_zeile"], "r2": l2, "r1_bytegleich": sha(r1) == vorher,
            "r1_dateien": len(vorher), "index": list(zaehle(b))}


def main():
    a, b = teil_a(), teil_b()
    ds, ks = a["drift_synth"]["raster"], a["konst134"]["raster"]
    rel1 = b["r1"]["innen_median_ms"] - b["r1"]["aussen_median_ms"]
    rel2 = b["r2"]["innen_median_ms"] - b["r2"]["aussen_median_ms"]
    urteil = {"drift_synth_starr": ds["rest_rms_ms"] <= 0.19 and ds["rest_max_ms"] <= 0.58,
              "konst134_starr": ks["rest_rms_ms"] <= 0.19 and abs(ks["drift_linear_ms_pro_min"]) <= 0.5,
              "nichts_geklemmt": a["konst134"]["geklemmt"] == 0 and a["drift_synth"]["geklemmt"] == 0,
              "fehler_in_r1_sichtbar": 7.0 <= rel1 <= 9.5,
              "r2_auf_dem_raster": abs(rel2) <= 0.5,
              "aussen_unveraendert": abs(b["r2"]["aussen_median_ms"] - b["r1"]["aussen_median_ms"]) <= 0.2,
              "r1_bytegleich": b["r1_bytegleich"], "r2_bis_zeile_1": b["korrekturen_bis_zeile"] == 1}
    erg = {"a": a, "b": b, "urteil": urteil}
    (HIER / "berichte").mkdir(exist_ok=True)
    (HIER / "berichte" / "15-kette.json").write_text(json.dumps(erg, indent=1, ensure_ascii=False, default=float) + "\n")
    z = ["# Scheibe 15: Kontrollen durch die Kette (offline, stumm)", "",
         "| Kontrolle | Rest RMS ms | Rest max ms | Drift ms/min | Stimmung | Korrektur ct | geklemmt |", "|---|---|---|---|---|---|---|"]
    for n in ("konst134", "drift_synth"):
        e = a[n]
        z.append(f"| {n} | {e['raster']['rest_rms_ms']} | {e['raster']['rest_max_ms']} | "
                 f"{e['raster']['drift_linear_ms_pro_min']} | {e['stimmung']} | {e['korrektur_cent']} | {e['geklemmt']} |")
    z += ["", "| Korrektur-Wirkung (konst134, Karte in [32, 64) 8 ms zu früh) | innen Median ms | aussen Median ms | innen − aussen ms |",
          "|---|---|---|---|",
          f"| r1 | {b['r1']['innen_median_ms']} | {b['r1']['aussen_median_ms']} | {rel1:.3f} |",
          f"| r2 (Korrektur {b['versatz_ms']} ms, bis Zeile {b['korrekturen_bis_zeile']}) | {b['r2']['innen_median_ms']} | "
          f"{b['r2']['aussen_median_ms']} | {rel2:.3f} |", "",
          f"r1 bytegleich nach dem Korrigieren: {b['r1_bytegleich']} ({b['r1_dateien']} Dateien); Index {b['index']}", "",
          "## Urteil", ""] + [f"- {n}: {'ja' if v else 'NEIN'}" for n, v in urteil.items()]
    (HIER / "berichte" / "15-kette.md").write_text("\n".join(z) + "\n")
    print("\n".join(z))
    return 0 if all(urteil.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
