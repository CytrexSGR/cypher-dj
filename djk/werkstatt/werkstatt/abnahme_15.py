"""Scheibe 15, Abnahme am Ziel: zaehlt im Bestand nach, was die Scheibe zusagt.

  1 Schema: jede material.json, jede fassung.json und jede Zeile jeder korrekturen.jsonl gegen djk/vertrag/schemas/
  2 Index: (material_id, basis_bpm, fassung) aus index.sqlite gleich der Menge der Fassungs-Ordner
  3 Stimmung: je Material genau eins von „korrigiert“ (R >= 0,1, Abstand <= 10 ct, Mittel unter 35 ct) oder Warnung
  4 Luft: headroom_db = -12 und 0 Samples an |x| >= 0,99999 in jeder basis.f32
  5 Versiegelt: Fassungs-Ordner 0555, Dateien darin 0444, material.json und original.* 0444
  6 Korrektur-Probe (nur mit --korrektur MATERIAL_ID, einmal je Material): Nullkorrektur anhaengen, korrigieren,
    r1 vorher und nachher per sha256 je Datei gleich, r2 traegt korrekturen_bis_zeile = Zeilenzahl
  7 Warp: berichte/15-warp.json, alle vier Urteile ja

Aufruf (aus djk/werkstatt): .venv/bin/python -m werkstatt.abnahme_15 [--bestand PFAD] [--korrektur ID] [--ohne-warp]
Rueckgabewert 0 nur, wenn jeder Punkt besteht. Schreibt berichte/15-abnahme.json und .md (nicht bei --kein-bericht)."""
import argparse
import hashlib
import json
import re
import stat
import time
from pathlib import Path

import numpy as np

from . import vertrag
from .bestand import (FASSUNG_MUSTER, fassung_teile, fassungen_von, korrektur_anhaengen, korrekturen_lesen, lies_json,
                      materialien, standard_bestand)
from .index import oeffne
from .kette import korrigieren
from .vertrag import sauber
from .stimmung import EINIG_CENT, MAX_CENT, R_MIN, kreis_abstand, kreis_mittel
from .warp import lies_f32

HIER = Path(__file__).resolve().parent.parent
KLEMM = 0.99999


def sha_je_datei(ordner):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path(ordner).iterdir()) if p.is_file()}


def schema(bestand):
    ordner = [p for p in Path(bestand).iterdir() if re.fullmatch(r"[0-9a-f]{16}", p.name)]
    n, fehl = 0, []
    for mo in ordner:
        pruefe = [(mo / "material.json", "material.schema.json")]
        pruefe += [(p / "fassung.json", "fassung.schema.json") for p in sorted((mo / "fassungen").iterdir())
                   if FASSUNG_MUSTER.match(p.name)] if (mo / "fassungen").is_dir() else []
        for datei, s in pruefe:
            n += 1
            f = [f"fehlt: {datei}"] if not datei.is_file() else vertrag.fehler(s, lies_json(datei))
            if f:
                fehl.append({"datei": str(datei), "fehler": f[:3]})
        for i, z in enumerate(korrekturen_lesen(mo), 1):
            n += 1
            f = vertrag.fehler("korrektur.schema.json", z)
            if f:
                fehl.append({"datei": f"{mo}/korrekturen.jsonl:{i}", "fehler": f[:3]})
    return {"material_ordner": len(ordner), "geprueft": n, "gueltig": n - len(fehl), "fehler": fehl,
            "ok": len(ordner) > 0 and not fehl}


def index(bestand):
    ordner = set()
    for mo in materialien(bestand):
        for p in (mo / "fassungen").iterdir():
            if FASSUNG_MUSTER.match(p.name):
                b, r = fassung_teile(p.name)
                ordner.add((mo.name, b, r))
    con = oeffne(bestand)
    zeilen = {(m, float(b), int(r)) for m, b, r in con.execute("SELECT material_id, basis_bpm, fassung FROM fassung")}
    mats = {m for (m,) in con.execute("SELECT material_id FROM material")}
    con.close()
    return {"fassungen_ordner": len(ordner), "fassungen_index": len(zeilen),
            "nur_ordner": sorted(map(list, ordner - zeilen)), "nur_index": sorted(map(list, zeilen - ordner)),
            "materialien_ordner": len({o[0] for o in ordner}), "materialien_index": len(mats),
            "ok": len(ordner) > 0 and ordner == zeilen and mats == {o[0] for o in ordner}}


def stimmung(bestand):
    je, verstoss = {}, []
    for mo in materialien(bestand):
        m = lies_json(mo / "material.json")
        t = m["tonart"]
        c1, r, c2 = t["stimmung_cent"], t["stimmung_r"], t["stimmung_cent_zweitwerkzeug"]
        darf = (None not in (c1, r, c2)) and r >= R_MIN and abs(kreis_abstand(c1, c2)) <= EINIG_CENT \
            and abs(kreis_mittel(c1, c2)) < MAX_CENT
        for b, rr, p in fassungen_von(mo):
            f = lies_json(p / "fassung.json")
            korr = f["stimmung_korrektur_cent"]
            warn = [w for w in f["warnungen"] if w.startswith("Stimmung")]
            art = "warnung" if warn else "korrigiert"
            if (art == "korrigiert") != darf or (warn and korr != 0.0) or \
                    (darf and abs(korr + kreis_mittel(c1, c2)) > 0.1):
                verstoss.append({"material": m["titel"], "fassung": p.name, "art": art, "darf": darf, "korr": korr})
            if rr == 1:
                je[m["titel"]] = art
    zaehl = {a: sum(1 for v in je.values() if v == a) for a in ("korrigiert", "warnung")}
    return {"je_song": je, "zaehlung": zaehl, "verstoesse": verstoss, "ok": len(je) > 0 and not verstoss}


def luft(bestand):
    je, fehl = {}, []
    for mo in materialien(bestand):
        for b, r, p in fassungen_von(mo):
            f = lies_json(p / "fassung.json")
            y = lies_f32(p / f["datei"])
            n = int(np.count_nonzero(np.abs(y) >= KLEMM))
            spitze = round(float(20 * np.log10(np.abs(y).max() + 1e-12)), 2)
            je[f"{mo.name}/{p.name}"] = {"geklemmt": n, "spitze_dbfs": spitze, "headroom_db": f["headroom_db"]}
            if n or f["headroom_db"] != -12.0:
                fehl.append(f"{mo.name}/{p.name}")
    return {"fassungen": len(je), "fehler": fehl, "spitze_max_dbfs": max((v["spitze_dbfs"] for v in je.values()), default=None),
            "je": je, "ok": len(je) > 0 and not fehl}


def versiegelt(bestand):
    fehl, n = [], 0
    for mo in materialien(bestand):
        for p in [mo / "material.json"] + list(mo.glob("original.*")):
            n += 1
            if stat.S_IMODE(p.stat().st_mode) != 0o444:
                fehl.append(str(p))
        for b, r, p in fassungen_von(mo):
            n += 1
            if stat.S_IMODE(p.stat().st_mode) != 0o555:
                fehl.append(str(p))
            for d in p.iterdir():
                n += 1
                if stat.S_IMODE(d.stat().st_mode) != 0o444:
                    fehl.append(str(d))
    return {"geprueft": n, "fehler": fehl, "ok": n > 0 and not fehl}


def korrektur_probe(bestand, mid):
    mo = Path(bestand) / mid
    fs = [(b, r, p) for b, r, p in fassungen_von(mo) if abs(b - 128.0) < 1e-9]
    if [r for _, r, _ in fs] != [1]:
        return {"ok": False, "grund": f"Probe nur an einem Material mit genau r1 (hat {[p.name for _, _, p in fs]})"}
    r1 = fs[0][2]
    vorher = sha_je_datei(r1)
    n = korrektur_anhaengen(mo, {"zeit": time.strftime("%Y-%m-%dT%H:%M:%S"), "von": "werkstatt", "art": "raster",
                                 "fassung": "128000_r1", "ab_quell_beat": 0.0, "bis_quell_beat": 32.0,
                                 "versatz_ms": 0.0, "nr": None,
                                 "text": "Abnahme Scheibe 15: Nullkorrektur, prueft nur r2 neben r1"})
    k = korrigieren(mid, bestand)
    nachher = sha_je_datei(r1)
    f2 = lies_json(mo / "fassungen" / k["fassung"] / "fassung.json")
    return {"material_id": mid, "zeilen": n, "neue_fassung": k["fassung"], "korrekturen_bis_zeile": f2["korrekturen_bis_zeile"],
            "r1_dateien": len(vorher), "r1_bytegleich": vorher == nachher,
            "r2_basis_gleich_r1_basis": f2["sha256"] == lies_json(r1 / "fassung.json")["sha256"],
            "ok": vorher == nachher and k["fassung"] == "128000_r2" and f2["korrekturen_bis_zeile"] == n}


def warp_bericht():
    p = HIER / "berichte" / "15-warp.json"
    if not p.is_file():
        return {"ok": False, "grund": "berichte/15-warp.json fehlt (erst: python -m werkstatt.pruefe_warp)"}
    u = json.loads(p.read_text())["urteil"]
    return {"urteil": u, "ok": all(u.values())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bestand", default=str(standard_bestand()))
    ap.add_argument("--korrektur", default="")
    ap.add_argument("--ohne-warp", action="store_true")
    ap.add_argument("--kein-bericht", action="store_true")
    a = ap.parse_args()
    b = Path(a.bestand).expanduser()
    erg = {"bestand": str(b), "schema": schema(b)}
    if a.korrektur:
        erg["korrektur"] = korrektur_probe(b, a.korrektur)
        erg["schema"] = schema(b)                      # nach der Probe noch einmal, jetzt mit r2 und der Zeile
    erg.update({"index": index(b), "stimmung": stimmung(b), "luft": luft(b), "versiegelt": versiegelt(b)})
    if not a.ohne_warp:
        erg["warp"] = warp_bericht()
    urteil = {k: v["ok"] for k, v in erg.items() if isinstance(v, dict) and "ok" in v}
    erg["urteil"] = urteil
    s, i, st, l = erg["schema"], erg["index"], erg["stimmung"], erg["luft"]
    z = ["# Scheibe 15: Abnahme am Ziel", "", f"Bestand `{b}`", "",
         f"- Schema: {s['gueltig']} von {s['geprueft']} Dateien und Zeilen gültig ({s['material_ordner']} Material-Ordner)",
         f"- Index: {i['fassungen_index']} Fassungen im Index, {i['fassungen_ordner']} Fassungs-Ordner, "
         f"Materialien {i['materialien_index']} / {i['materialien_ordner']}, nur Ordner {i['nur_ordner']}, nur Index {i['nur_index']}",
         f"- Stimmung: korrigiert {st['zaehlung']['korrigiert']}, Warnung {st['zaehlung']['warnung']}, Verstöße {len(st['verstoesse'])}",
         f"- Luft: {l['fassungen']} Fassungen, geklemmt in {len(l['fehler'])}, höchste Spitze {l['spitze_max_dbfs']} dBFS",
         f"- Versiegelt: {erg['versiegelt']['geprueft']} geprüft, falsch {len(erg['versiegelt']['fehler'])}"]
    if "korrektur" in erg:
        k = erg["korrektur"]
        z.append(f"- Korrektur-Probe: {k}")
    if "warp" in erg:
        z.append(f"- Warp: {erg['warp']}")
    z += ["", "Stimmung je Song: " + ", ".join(f"{t} {v}" for t, v in sorted(st["je_song"].items())), "",
          "Urteil: " + ", ".join(f"{k} {'ja' if v else 'NEIN'}" for k, v in urteil.items())]
    if not a.kein_bericht:
        (HIER / "berichte").mkdir(exist_ok=True)
        (HIER / "berichte" / "15-abnahme.json").write_text(json.dumps(sauber(erg), indent=1, ensure_ascii=False) + "\n")
        (HIER / "berichte" / "15-abnahme.md").write_text("\n".join(z) + "\n")
    print("\n".join(z))
    return 0 if all(urteil.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
