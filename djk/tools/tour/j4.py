"""Journey J4, sound design: load a factory Cypher Modular instrument, turn two knobs, measure that it sounds different, save the
result as a user preset, find it again, and hear it in a fresh project.

The tour talks to the page server only (HTTP, the routes the hand tools use). Audibility is measured on offline exports of an instrument
track, not on the live master: a stream channel only sounds with a Strudel module and AUTO, which a tour cannot take from the owner.
The live knob route (regler) is still driven and checked on the stream channel erz/2; its two knobs are the ones the project track uses.
"""
import time
from pathlib import Path

STUFEN = ["graphen"]            # the factory graphs only: no kits, loops or demo material are needed
GRAPH = "bass-banddrive"        # a factory instrument graph (djk/ui graph folder, installed by the stage graphen)
KANAL = "erz/2"                 # bass stream channel: takes an instrument graph, runs without a kit
KNOEPFE = (("k10", 0.15), ("k11", 0.8))   # CUTOFF and RESONANCE, two of the six knobs on the track's device panel: knob and new value (0..1)
PRESET_BASIS = "J4 tour"       # the preset is named "<basis> <run time>": no run can find the file of an earlier one
TAKTE = 4
SCHWERPUNKT_MIN = 0.15          # audible: spectral centroid moves by at least 15 percent ...
PEGEL_MIN_DB = 1.5              # ... or the RMS level by at least 1.5 dB
GLEICH_SCHWERPUNKT = 0.05       # "sounds the same": centroid within 5 percent and RMS within 1 dB
GLEICH_PEGEL_DB = 1.0
QUITTUNG_GUT = (2, 3, 5)        # core receipts that count as accepted (the runner's ok already refuses 4, 6, 7, 8)


def _messe(t, pfad):
    """(RMS dBFS, spectral centroid Hz) of a WAV, mono mix, decoded with ffmpeg."""
    import subprocess
    import numpy as np
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(pfad), "-f", "f32le", "-ac", "1", "-"], capture_output=True)
    a = np.frombuffer(r.stdout, dtype="<f4").astype(np.float64)
    if len(a) == 0:
        raise RuntimeError(f"{pfad} decodes to no samples")
    rms = 20 * np.log10(np.sqrt(np.mean(a ** 2)) + 1e-12)
    sp = np.abs(np.fft.rfft(a))
    fr = np.fft.rfftfreq(len(a), 1 / 48000)
    return float(rms), float(np.sum(sp * fr) / max(np.sum(sp), 1e-12))


def _unterschied(a, b):
    """How far two measurements are apart: (relative centroid change, RMS change in dB)."""
    return abs(a[1] - b[1]) / max(a[1], b[1], 1.0), abs(a[0] - b[0])


def _slug(name):
    """The file name the preset store derives from a name (lower case, runs of other characters become one dash)."""
    import re
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48].strip("-")


def _nutzer_ids(t):
    """(answer, ids of the user presets of the Modular device)."""
    a = t.ruf("POST", "/presets/suche", {"herkunft": ["nutzer"], "geraet": ["baukasten"]})
    return a, ([x.get("id") for x in ((a.j or {}).get("treffer") or [])] if isinstance(a.j, dict) else [])


def _hoerbar(a, b):
    sw, db = _unterschied(a, b)
    return sw >= SCHWERPUNKT_MIN or db >= PEGEL_MIN_DB


def _gleich(a, b):
    sw, db = _unterschied(a, b)
    return sw <= GLEICH_SCHWERPUNKT and db <= GLEICH_PEGEL_DB


def _spur_bauen(t, name, parameter):
    """A fresh project with one bk instrument track and a four-bar MIDI clip. Returns (spur_id, tempo) or raises."""
    a = t.ruf("POST", "/proj/neu?antwort=kurz", {"name": name})
    if not a.ok:
        raise RuntimeError(f"proj/neu: {a.code} {a.grund}")
    geraet = {"art": "intern", "name": "bk", "graph": GRAPH, "parameter": parameter}
    a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": "J4 instrument track",
                                                     "befehle": [{"befehl": "spur_neu", "art": "instrument", "name": "Bass", "geraet": geraet}]})
    if not a.ok:
        raise RuntimeError(f"spur_neu: {a.code} {a.grund}")
    p = t.ruf("GET", "/proj/aktuell").j["projekt"]
    spur_id = p["spuren"][-1]["id"]
    tempo = float(p.get("tempo_bpm") or 120)
    beats = TAKTE * 4
    noten = [{"beat": float(b), "laenge": 0.9, "ton": ton, "vel": 100} for b, ton in zip(range(beats), [36, 36, 43, 36] * TAKTE)]
    a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": "J4 four bars",
                                                     "befehle": [{"befehl": "clip_neu", "spur_id": spur_id, "art": "midi", "start_beat": 0,
                                                                  "laenge_beats": beats, "noten": noten}]})
    if not a.ok:
        raise RuntimeError(f"clip_neu: {a.code} {a.grund}")
    return spur_id, tempo


def _rev(t):
    a = t.ruf("GET", "/proj/aktuell?nur=rev")
    if not a.ok or not isinstance(a.j, dict) or not isinstance(a.j.get("rev"), int):
        raise RuntimeError(f"no project revision: {a.code} {a.grund}")
    return a.j["rev"]


def _exportiere(t, tempo, ordner, marke):
    """Exports four bars, checks the file with pruefe_datei, returns (path, measurement). Raises when the export or the file is bad."""
    beats = TAKTE * 4
    a = t.ruf("POST", "/proj/export", {"von_beat": 0, "bis_beat": beats}, timeout=300)
    if not a.ok or not isinstance(a.j, dict) or not a.j.get("datei"):
        raise RuntimeError(f"proj/export ({marke}): {a.code} {a.grund}")
    pfad = a.j["datei"]
    sek = beats * 60.0 / tempo
    d = t.pruefe_datei(pfad, min_sek=sek * 0.95)
    if not d.ok:
        raise RuntimeError(f"export {marke} is not a good file: {','.join(d.gruende)}")
    if d.stumm:
        raise RuntimeError(f"export {marke} is silent")
    ordner.mkdir(parents=True, exist_ok=True)
    return pfad, _messe(t, pfad), a.j


def schritte(t):
    z = {}                                      # what later steps need from earlier ones
    marke = str(int(time.time()))
    aus = Path(t.ausgabe)
    name = f"{PRESET_BASIS} {marke}"
    erwartet = f"nutzer:baukasten/{_slug(name)}"

    with t.schritt("j4.oeffnen", f"load the factory instrument {GRAPH} on {KANAL}") as w:
        a = t.ruf("POST", "/live/oeffnen", {})
        if not a.ok:
            t.rot(f"live container did not open: {a.code} {a.grund}")
        else:
            a = t.ruf("POST", "/graph", {"kanal": KANAL, "name": GRAPH, "vorgaben": True})
            q = (a.j or {}).get("quittung") if isinstance(a.j, dict) else None
            if not a.ok:
                t.rot(f"graph load refused: {a.code} {a.grund}")
            elif not isinstance(q, dict) or q.get("status") not in QUITTUNG_GUT:
                t.rot(f"the core did not accept the graph: {q}")
            else:
                g = t.ruf("GET", "/graphen")
                liste = (g.j or {}).get("graphen", []) if isinstance(g.j, dict) else []
                eintrag = next((x for x in liste if x.get("name") == GRAPH), None)
                geladen = ((g.j or {}).get("geladen") or {}) if isinstance(g.j, dict) else {}
                namen = (eintrag or {}).get("regler_namen") or {}
                w.update(quittung=q.get("status"), geladen=geladen.get(KANAL), knoepfe={k: namen.get(k[1:]) for k, _ in KNOEPFE})
                if eintrag is None:
                    t.rot(f"{GRAPH} is not in the graph list")
                elif geladen.get(KANAL) != GRAPH:
                    t.rot(f"{KANAL} does not report {GRAPH} as loaded: {geladen.get(KANAL)!r}")
                else:
                    z["oeffnen"] = True

    with t.schritt("j4.aendern", "turn two knobs with regler") as w:
        if not z.get("oeffnen"):
            t.skip("the instrument did not load", ursache="abhaengigkeit")
        quittungen = {}
        for k, wert in KNOEPFE:
            nr = k[1:]
            a = t.ruf("POST", "/regler", {"pfad": f"{KANAL}/bk/{nr}", "nach": wert, "ab": "jetzt"})
            q = (a.j or {}).get("quittung") if isinstance(a.j, dict) else None
            quittungen[f"bk/{nr}"] = (q or {}).get("status") if isinstance(q, dict) else None
            if not a.ok:
                t.rot(f"regler {KANAL}/bk/{nr}: {a.code} {a.grund}")
                break
            if isinstance(q, dict) and q.get("status") not in QUITTUNG_GUT:
                t.rot(f"regler {KANAL}/bk/{nr}: the core answered {q}")
                break
        w.update(quittungen=quittungen, knoepfe={k: v for k, v in KNOEPFE})
        if t._aktuell is not None and t._aktuell.get("_rot") is None:
            z["aendern"] = True

    with t.schritt("j4.hoeren", "the knob change is audible in an exported instrument track") as w:
        try:
            spur_id, tempo = _spur_bauen(t, f"j4-tour-a-{marke}", {})
            _, vorher, _ = _exportiere(t, tempo, aus, "default")
            a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": "J4 knobs", "befehle": [
                {"befehl": "spur_aendern", "spur_id": spur_id,
                 "geraet": {"art": "intern", "name": "bk", "graph": GRAPH, "parameter": {k: v for k, v in KNOEPFE}}}]})
            if not a.ok:
                raise RuntimeError(f"spur_aendern: {a.code} {a.grund}")
            _, nachher, _ = _exportiere(t, tempo, aus, "changed")
        except RuntimeError as e:
            t.rot(str(e))
        else:
            sw, db = _unterschied(vorher, nachher)
            w.update(vorher_rms_db=round(vorher[0], 2), vorher_schwerpunkt_hz=round(vorher[1], 1),
                     nachher_rms_db=round(nachher[0], 2), nachher_schwerpunkt_hz=round(nachher[1], 1),
                     schwerpunkt_aenderung=round(sw, 3), pegel_aenderung_db=round(db, 2),
                     grenze=f"centroid {SCHWERPUNKT_MIN:.0%} or {PEGEL_MIN_DB} dB")
            if not _hoerbar(vorher, nachher):
                t.rot("the knob change is not audible: the export sounds the same")
            else:
                z.update(spur_id=spur_id, geaendert=nachher, vorher=vorher)

    with t.schritt("j4.speichern", f"save the sound as the user preset {name!r}") as w:
        if "spur_id" not in z:
            t.skip("no changed instrument track to save", ursache="abhaengigkeit")
        vor, ids = _nutzer_ids(t)
        w.update(erwartet=erwartet, vorher_nutzer_presets=len(ids))
        if not vor.ok:
            t.rot(f"preset list refused before the save: {vor.code} {vor.grund}")
        elif erwartet in ids:
            t.rot(f"{erwartet} exists before the save: a leftover would make the read-back meaningless")
        else:
            a = t.ruf("POST", "/presets/von_ziel", {
                "ziel": {"art": "spur", "spur_id": z["spur_id"]}, "name": name, "ueberschreiben": False,
                "beschreibung": {"art": "bass", "unterart": "acid", "charakter": ["tight"], "genre": ["techno"], "einsatz": ["drop"],
                                 "energie": 3, "text": "Tour test preset: dark filtered bass."}})
            if not a.ok:
                t.rot(f"save refused: {a.code} {a.grund}")
            else:
                j = a.j if isinstance(a.j, dict) else {}
                herkunft, geraet, slug = j.get("herkunft"), j.get("geraet"), j.get("slug")
                w.update(herkunft=herkunft, geraet=geraet, slug=slug)
                if herkunft != "nutzer" or not geraet or not slug:
                    t.rot("the save answered without an id (herkunft nutzer, geraet and slug)")
                else:
                    z["id"] = f"nutzer:{geraet}/{slug}"
                    w["id"] = z["id"]

    with t.schritt("j4.wieder", "read the preset back from the preset list") as w:
        if "id" not in z:
            t.skip("no preset id to look for", ursache="abhaengigkeit")
        a, ids = _nutzer_ids(t)
        w.update(id=z["id"], in_liste=z["id"] in ids, nutzer_presets=len(ids))
        if not a.ok:
            t.rot(f"preset list refused: {a.code} {a.grund}")
        elif z["id"] not in ids:
            t.rot(f"{z['id']} is not in the preset list")
        else:
            _, _, rest = z["id"].partition(":")
            geraet, _, slug = rest.partition("/")
            b = t.ruf("GET", f"/presets/nutzer/{geraet}/{slug}")
            if not b.ok or not isinstance(b.j, dict):
                t.rot(f"preset read refused: {b.code} {b.grund}")
            else:
                werte = b.j.get("werte") or {}
                gesetzt = {k: werte.get("knob" + k[1:]) for k, _ in KNOEPFE}
                w.update(graph=b.j.get("graph"), werte=gesetzt)
                falsch = [k for k, v in KNOEPFE if not isinstance(gesetzt[k], (int, float)) or abs(gesetzt[k] - v) > 1e-3]
                if b.j.get("graph") != GRAPH:
                    t.rot(f"the preset names the graph {b.j.get('graph')!r}, not {GRAPH}")
                elif falsch:
                    t.rot(f"the preset does not hold the turned knob values: {falsch}")
                else:
                    z["gelesen"] = True

    with t.schritt("j4.in_j3", "apply the user preset to an instrument track of a fresh project and export four bars") as w:
        if not z.get("gelesen"):
            t.skip("the preset was not read back", ursache="abhaengigkeit")
        try:
            spur_id, tempo = _spur_bauen(t, f"j4-tour-b-{marke}", {})
            _, leer, _ = _exportiere(t, tempo, aus, "fresh track")
            plan = t.ruf("POST", "/presets/anwenden", {"id": z["id"], "ziel": {"art": "spur", "spur_id": spur_id}})
            pj = plan.j if isinstance(plan.j, dict) else {}
            if not plan.ok or pj.get("weg") != "proj" or not pj.get("befehle"):
                raise RuntimeError(f"apply plan: {plan.code} {plan.grund or 'no project commands'}")
            a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": pj.get("label") or "Preset", "befehle": pj["befehle"]})
            if not a.ok:
                raise RuntimeError(f"preset apply: {a.code} {a.grund}")
            datei, mit, ex = _exportiere(t, tempo, aus, "with preset")
        except RuntimeError as e:
            t.rot(str(e))
        else:
            sw, db = _unterschied(leer, mit)
            sw2, db2 = _unterschied(z["geaendert"], mit)
            w.update(datei=datei, frisch_rms_db=round(leer[0], 2), frisch_schwerpunkt_hz=round(leer[1], 1),
                     preset_rms_db=round(mit[0], 2), preset_schwerpunkt_hz=round(mit[1], 1),
                     gegen_frisch=round(sw, 3), gegen_geaendert=round(sw2, 3), spitze_db=ex.get("spitze_db"))
            if not _hoerbar(leer, mit):
                t.rot("the user preset does not sound in the export: it is the same as the fresh track")
            elif not _gleich(z["geaendert"], mit):
                t.rot("the export with the preset differs from the sound that was saved")

    with t.schritt("j4.aufraeumen", "delete the tour's preset again") as w:
        if "id" not in z:
            t.skip("nothing was saved, nothing to delete")
        _, _, rest = z["id"].partition(":")
        geraet, _, slug = rest.partition("/")
        a = t.ruf("POST", f"/presets/nutzer/{geraet}/{slug}/loeschen", {})
        _, ids = _nutzer_ids(t)
        w.update(id=z["id"], noch_da=z["id"] in ids)
        if not a.ok:
            t.rot(f"preset delete refused: {a.code} {a.grund}")
        elif z["id"] in ids:
            t.rot(f"{z['id']} is still in the preset list after the delete")

    with t.schritt("j4.knoten", "add and wire a node in the graph editor") as w:
        t.skip("graph editor gesture: owner session J4", "J4")
