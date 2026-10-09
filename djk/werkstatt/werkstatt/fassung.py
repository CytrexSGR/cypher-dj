"""Welle 3 Task 4 (Plan 2026-10-06-welle3-beatmatch.md, ADR 028): eine Fassung im Zieltempo für vorhandenes Material.

Gerendert aus dem ORIGINAL mit derselben Kette wie `kette.korrigieren` (Karte aus material.json, alle Korrekturen,
Stimmung und Takt-Eins der jüngsten 128er Fassung), nur auf der neuen Basis: Name `<bpm·1000>_r1`. Die Seite tauscht ein
laufendes Deck darauf (`/k/deck/basis_tausch`), damit es nach einem Tempowechsel wieder in seiner Tonhöhe spielt.

Höchstens ZUSATZ_DECKEL Fassungen außer der Set-Basis je Material: eine weitere wird gemeldet (`voll`), nicht angelegt,
und nichts wird gelöscht. Löschen ist Andreas' Entscheidung (offene Frage im Plan).

Aufruf: python -m werkstatt.fassung --bestand B --material-id M --bpm 132 → eine JSON-Zeile {status, fassung, sekunden}."""
import argparse
import json
import os
import sys
import time
from pathlib import Path

from .bestand import (aufraeumen, fassung_name, fassungen_von, fsync_baum, korrekturen_lesen, lies_json,
                      rename_ohne_ueberschreiben, versiegeln)
from .eingang import lade_stereo48
from .index import eintragen, oeffne
from .kette import eins_und_hotcues, karte_aus_liste, rendere, wende_raster_an

SET_BASIS = 128.0
ZUSATZ_DECKEL = 2
BEREICH = (60.0, 200.0)   # wie /tempo und ADR 027


def neue_fassung(bestand, material_id, basis_bpm):
    basis_bpm = round(float(basis_bpm), 2)
    if not BEREICH[0] <= basis_bpm <= BEREICH[1]:
        raise ValueError(f"basis_bpm {basis_bpm} außerhalb {BEREICH[0]:.0f} bis {BEREICH[1]:.0f}")
    bestand = Path(bestand)
    mo = bestand / material_id
    vorhanden = fassungen_von(mo)
    if not vorhanden:
        raise FileNotFoundError(f"{material_id}: keine Fassung im Bestand")
    name = fassung_name(basis_bpm, 1)
    if any(abs(b - basis_bpm) < 1e-9 for b, _, _ in vorhanden):
        return {"material_id": material_id, "status": "vorhanden",
                "fassung": max((p.name for b, _, p in vorhanden if abs(b - basis_bpm) < 1e-9))}
    zusatz = sorted({p.name for b, _, p in vorhanden if abs(b - SET_BASIS) >= 1e-9})
    if len(zusatz) >= ZUSATZ_DECKEL:
        return {"material_id": material_id, "status": "voll", "fassungen": zusatz}
    vorlage = [(r, p) for b, r, p in vorhanden if abs(b - SET_BASIS) < 1e-9] or [(r, p) for _, r, p in vorhanden]
    _, p_alt = max(vorlage)
    alt = lies_json(p_alt / "fassung.json")
    zeilen = korrekturen_lesen(mo)[: alt["korrekturen_bis_zeile"]]   # genau der Stand der Vorlage
    material = lies_json(mo / "material.json")
    karte = karte_aus_liste(material["tempo_karte_quelle"], material["raster"]["tempo_vielfaches"])
    karte = wende_raster_an(karte, zeilen, basis_bpm)
    eins, hotcues = eins_und_hotcues(material, zeilen)
    t0 = time.perf_counter()
    arbeit = bestand / ".arbeit" / f"f-{material_id}-{name}"
    aufraeumen(arbeit)
    arbeit.mkdir(parents=True)
    try:
        x = lade_stereo48(mo / material["quelle"]["datei"])
        warn = [w for w in alt["warnungen"] if w.startswith(("Stimmung", "Takt-Eins", "Erster Schlag"))]
        f, mw = rendere(x, karte, material, basis_bpm, 1, arbeit / name, arbeit, len(zeilen), eins, hotcues,
                        alt["stimmung_korrektur_cent"], warn, alt["tore"]["eins"]["beat_this"])
        versiegeln(arbeit / name, ordner_selbst=False)
        fsync_baum(arbeit / name)
        rename_ohne_ueberschreiben(arbeit / name, mo / "fassungen" / name)
        os.chmod(mo / "fassungen" / name, 0o555)
        con = oeffne(bestand)
        eintragen(con, mo, basis_bpm)
        con.close()
    finally:
        aufraeumen(arbeit)
    return {"material_id": material_id, "status": "neu", "fassung": name, "frames": f["frames"],
            "sekunden": round(time.perf_counter() - t0, 2), "messwerte": mw}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bestand", required=True)
    ap.add_argument("--material-id", required=True)
    ap.add_argument("--bpm", type=float, required=True)
    a = ap.parse_args(argv)
    try:
        r = neue_fassung(a.bestand, a.material_id, a.bpm)
    except (ValueError, FileNotFoundError, OSError) as e:
        print(json.dumps({"status": "fehler", "grund": f"{type(e).__name__}: {e}"}, ensure_ascii=False))
        return 1
    r.pop("messwerte", None)
    print(json.dumps(r, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
