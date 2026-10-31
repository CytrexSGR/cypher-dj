"""Phase des Rasters je Material nachziehen: auf der neuesten Fassung der Basis messen (phase.py), bei ok und
|versatz| >= MIN_BETRAG_MS eine Korrektur `raster` (von werkstatt, ganzer Song) anhaengen, `korrigieren` rechnet r+1,
danach dieselbe Messung auf der neuen Fassung (am Ziel). Ohne --schreiben wird nur gemessen.

Aufruf (aus djk/werkstatt):
  nice -n 19 ionice -c3 .venv/bin/python -m werkstatt.lauf_phase [--nur ID,ID] [--schreiben] [--bestand DIR]
Vorgabe fuer --bestand: $CYPHERDJ_BESTAND, sonst ~/cypher-dj/bestand."""
import argparse
import datetime as dt
import json
from pathlib import Path

import numpy as np

from .bestand import fassungen_von, korrektur_anhaengen, lies_json, standard_bestand
from .eingang import lade_stereo48
from .kette import karte_aus_liste, korrigieren, wende_raster_an
from .warp import karte_mit_vorlauf, timemap, vorlauf_frames
from .phase import MIN_BETRAG_MS, SR, abschnitte_messen, phase_messen, sollzeiten
from .warp import lies_f32


def neueste_fassung(mo, basis_bpm):
    auf_basis = [(r, p) for b, r, p in fassungen_von(mo) if abs(b - basis_bpm) < 1e-9]
    return max(auf_basis) if auf_basis else (None, None)


MIN_TAKT_MS = 0.3   # Takte mit kleinerem Versatz bekommen keine Zeile


def miss_fassung(pfad, abschnitte=False):
    f = lies_json(pfad / "fassung.json")
    x = lies_f32(pfad / f["datei"]).mean(axis=1).astype(float)
    return f, (abschnitte_messen if abschnitte else phase_messen)(x, sollzeiten(f, SR), SR)


def probe_vor_dem_schreiben(mo, basis_bpm, neue_zeilen):
    """Rechnet die Karte mit allen Zeilen plus den neuen und die Timemap durch, BEVOR etwas angehaengt wird. Sonst
    steht eine Zeile in korrekturen.jsonl, deren Fassung nie entsteht (2026-10-09, a7865c9b: Schlag 0 laege nach -9,52 ms
    vor dem Dateianfang; zwei wirkungslose Zeilen, ein spaeteres korrigieren haette -19 ms gerechnet). None = ok."""
    from .bestand import korrekturen_lesen
    material = lies_json(mo / "material.json")
    karte = karte_aus_liste(material["tempo_karte_quelle"], material["raster"]["tempo_vielfaches"])
    try:
        k = wende_raster_an(karte, korrekturen_lesen(mo) + neue_zeilen, basis_bpm)
        # echte Laenge wie beim Rendern (kette.korrigieren: lade_stereo48 der Originaldatei); material.json fuehrt kein
        # `frames`, der frueher eingesetzte Ersatz 10**12 schaltete den Dateiende-Waechter ab
        # mit Vorlauf wie kette.rendere: quell_beat 0 vor dem Dateianfang ist kein Grund (580de, 2026-10-30)
        v = vorlauf_frames(k)
        timemap(karte_mit_vorlauf(k, v), basis_bpm, v + len(lade_stereo48(mo / material["quelle"]["datei"])))
    except ValueError as e:
        return str(e)
    return None


def nachziehen_abschnitte(mo, basis_bpm=128.0, schreiben=False):
    """Wie nachziehen, aber je Takt ein eigener Versatz (abschnitte_messen): fuer Stuecke, die schwanken. Fassungs-Schlag k
    ist quell_beat k (warp.timemap: ziel = erster + q * Periode), die Zeilen nennen also direkt quell_beats."""
    mo = Path(mo)
    r, p = neueste_fassung(mo, basis_bpm)
    if p is None:
        return {"material_id": mo.name, "status": "keine Fassung"}
    f, m = miss_fassung(p, abschnitte=True)
    kurz = lambda m: {k: m[k] for k in ("anteil", "rest_ms", "spanne_ms", "ok", "grund")}
    aus = {"material_id": mo.name, "fassung": p.name, "vorher": kurz(m)}
    if not m["ok"]:
        aus["status"] = "tor: " + m["grund"]
        return aus
    zeilen = [t for t in m["takte"] if abs(t["versatz_ms"]) >= MIN_TAKT_MS]
    if not zeilen:
        aus["status"] = "passt"
        return aus
    if not schreiben:
        aus["status"] = f"wuerde {len(zeilen)} Takte korrigieren"
        return aus
    jetzt = dt.datetime.now().isoformat(timespec="seconds")
    neu = [{"zeit": jetzt, "von": "werkstatt", "art": "raster", "fassung": p.name, "ab_quell_beat": float(t["ab_beat"]),
            "bis_quell_beat": float(t["bis_beat"]), "versatz_ms": t["versatz_ms"], "nr": None,
            "text": "Phase je Takt gegen Anschlaege 2-8 kHz (abschnitte_messen)"} for t in zeilen]
    grund = probe_vor_dem_schreiben(mo, basis_bpm, neu)
    if grund:
        aus["status"] = "probe: " + grund
        return aus
    for t in zeilen:
        korrektur_anhaengen(mo, {"zeit": jetzt, "von": "werkstatt", "art": "raster", "fassung": p.name,
                                 "ab_quell_beat": float(t["ab_beat"]), "bis_quell_beat": float(t["bis_beat"]),
                                 "versatz_ms": t["versatz_ms"], "nr": None,
                                 "text": "Phase je Takt gegen Anschlaege 2-8 kHz (abschnitte_messen)"})
    k = korrigieren(mo.name, mo.parent, basis_bpm)
    _, m2 = miss_fassung(mo / "fassungen" / k["fassung"], abschnitte=True)
    aus.update({"status": f"korrigiert ({len(zeilen)} Takte)", "neu": k["fassung"], "nachher": kurz(m2)})
    return aus


def nachziehen(mo, basis_bpm=128.0, schreiben=False):
    mo = Path(mo)
    r, p = neueste_fassung(mo, basis_bpm)
    if p is None:
        return {"material_id": mo.name, "status": "keine Fassung"}
    f, m = miss_fassung(p)
    aus = {"material_id": mo.name, "fassung": p.name, "vorher": m}
    if not m["ok"]:
        aus["status"] = "tor: " + m["grund"]
        return aus
    if abs(m["versatz_ms"]) < MIN_BETRAG_MS:
        aus["status"] = "passt"
        return aus
    if not schreiben:
        aus["status"] = "wuerde korrigieren"
        return aus
    material = lies_json(mo / "material.json")
    beats = [z[1] for z in material["tempo_karte_quelle"]]
    zeile = {"zeit": dt.datetime.now().isoformat(timespec="seconds"), "von": "werkstatt", "art": "raster",
             "fassung": p.name, "ab_quell_beat": float(min(beats)) - 1e6, "bis_quell_beat": float(max(beats)) + 1e6,
             "versatz_ms": m["versatz_ms"], "nr": None,
             "text": f"Phase gegen Anschlaege 2-8 kHz, {m['klar']}/{m['schlaege']} klar, Streuung {m['streuung_ms']} ms"}
    grund = probe_vor_dem_schreiben(mo, basis_bpm, [zeile])
    if grund:
        aus["status"] = "probe: " + grund
        return aus
    korrektur_anhaengen(mo, zeile)
    k = korrigieren(mo.name, mo.parent, basis_bpm)
    _, m2 = miss_fassung(mo / "fassungen" / k["fassung"])
    aus.update({"status": "korrigiert", "neu": k["fassung"], "nachher": m2})
    return aus


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bestand")
    ap.add_argument("--nur")
    ap.add_argument("--schreiben", action="store_true")
    ap.add_argument("--basis", type=float, default=128.0)
    ap.add_argument("--abschnitte", action="store_true", help="je Takt statt eines Werts fuer den ganzen Song")
    a = ap.parse_args()
    bestand = Path(a.bestand) if a.bestand else standard_bestand()
    ids = a.nur.split(",") if a.nur else sorted(p.name for p in bestand.iterdir()
                                                 if p.is_dir() and (p / "material.json").is_file())
    for mid in ids:
        if a.abschnitte:
            e = nachziehen_abschnitte(bestand / mid, a.basis, a.schreiben)
            v, n = e.get("vorher", {}), e.get("nachher", {})
            print(f"{mid} {e.get('fassung', '-'):12s} vorher Kurve {v.get('spanne_ms')} ms, Rest {v.get('rest_ms')} "
                  f"-> {e['status']}" + (f" {e['neu']} nachher Kurve {n.get('spanne_ms')}, Rest {n.get('rest_ms')}"
                                         if n else ""), flush=True)
        else:
            e = nachziehen(bestand / mid, a.basis, a.schreiben)
            v, n = e.get("vorher", {}), e.get("nachher", {})
            print(f"{mid} {e.get('fassung', '-'):12s} vorher {v.get('versatz_ms')!s:>7} ms "
                  f"(klar {v.get('anteil')}, streu {v.get('streuung_ms')}) -> {e['status']}"
                  + (f" {e['neu']} nachher {n.get('versatz_ms')} ms (streu {n.get('streuung_ms')})" if n else ""),
                  flush=True)
        print(json.dumps(e, ensure_ascii=False), file=open(bestand / ".phase.jsonl", "a"))


if __name__ == "__main__":
    main()
