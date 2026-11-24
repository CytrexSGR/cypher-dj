"""Journey J4, sound design: load a factory Cypher Modular instrument, turn two knobs, measure that it sounds different, save the
result as a user preset, find it again, and hear it in a fresh project.

The tour talks to the page server only (HTTP, the routes the hand tools use). Audibility is measured on offline exports of an instrument
track, not on the live master: a stream channel only sounds with a Strudel module and AUTO, which a tour cannot take from the owner.
The live knob route (regler) is still driven and checked on the stream channel erz/2; its two knobs are the ones the project track uses.

After those eight steps (grundschritte) come the sound steps of the device families (klangschritte): one device of every family of the
device register plays through a track and is measured on the export (j4.familie_*), Kraken with a patch-field pin (j4.kraken,
j4.kraken_stift), Drum Synth with a kit and the knob of one pad (j4.drumsynth, j4.drumsynth_knopf), and notes drawn into a clip through the
commands of the piano roll (j4.klavierrolle). The signal measurements are in surge_sound.py.
"""
import time
from pathlib import Path

from . import surge_sound as klang

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
    """The eight steps of the sound design journey, then the sound steps of the device families (klangschritte)."""
    grundschritte(t)
    klangschritte(t)


def grundschritte(t):
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


# ---------------------------------------------------------------- the sound steps of the device families
#
# What the first eight steps leave out: that every kind of device the studio registers sounds when a track plays it. One device per
# family goes through a project track, the track is exported offline and the file is measured (level, clipping, pitch, how the note
# ends). Then the three features built on devices: a patch-field pin of Kraken, the per-pad knobs of Drum Synth, and notes drawn into
# a clip the way the piano roll draws them.

FAMILIEN = (                                  # one device per family of djk/instruments/modular_dsp/geraete.json
    {"familie": "drums", "graph": "drums-909", "art": "schlag"},
    {"familie": "mono", "graph": "synth-mono", "art": "ton"},
    {"familie": "poly", "graph": "juno-pad", "art": "ton"},
    {"familie": "neuro", "graph": "synth-greif2", "art": "ton"},
    {"familie": "fx", "graph": "fx-crunch", "art": "fx"},
)
FX_BASIS = "synth-mono"                       # the instrument the effect device is put behind
KRAKEN = "synth-kraken"
KRAKEN_STIFT = ("Noise", "Out", 0.8)          # patch-field pin: source row label, destination column label, weight -1..1
DRUMSYNTH = "drum-synth"
DRUMSYNTH_KIT = (("Kick", 36), ("Snare", 38), ("Closed Hat", 42))     # pad label (the prefix of its knob names), GM note: one pad per beat
DRUMSYNTH_KNOPF = ("Kick Tune", 0.9)          # one knob of one pad, by the name in regler_namen
ROLL_GRAPH = "synth-mono"
ROLL_NOTEN = ((0.0, 48), (4.0, 55), (8.0, 60))      # drawn notes (beat, MIDI note), one per bar
ROLL_BEARBEITET = {"loeschen": 2, "verschieben": (3, 5)}    # then: note 2 deleted (right button), note 3 moved up five semitones (drag); note 1 stays as the pitch reference

TON_FOLGE = ((0.0, 48), (4.0, 55), (8.0, 60))       # C3, G3, C4: beat and note, one per bar
HALBTON_ERWARTET = (0.0, 7.0, 12.0)         # pitch of the second and third note against the first, in semitones
HALBTON_TOL = 0.5
NOTE_BEATS = 1.5                            # length of a note
KLANG_BEATS = 12                            # three bars are exported
SLOT_STUMM_DB = -50.0                       # a bar that carries a note is louder than this while the note sounds
ABFALL_TON_DB = 10.0                        # a note ends: the end of its bar is at least this far below its loudest 20 ms
ABFALL_SCHLAG_DB = 20.0                     # a drum hit falls by at least this much ...
ANSTIEG_SCHLAG_S = 0.06                     # ... after reaching its loudest 10 ms frame within this time
TIEF_BIS_HZ = 400.0                         # "low" means: below this frequency
KICK_TIEF_ANTEIL = 0.7                      # a kick keeps at least this share of its energy low (first 150 ms of a hit; a 909 kick is at 0.99)
SNARE_TIEF_MAX = 0.3                        # a snare keeps at most this share low
HAT_SCHWERPUNKT_MIN_HZ = 3000.0             # a closed hat is high: centroid of its pad
PAD_UNTERSCHIED = 0.2                       # two pads of different recipes differ by at least this much in centroid (relative)
PAD_STUMM_DB = -60.0                        # a pad window (a short hit and then silence) is louder than this
KICK_BAND = (20.0, 500.0)                   # the tune of a kick is the centroid of this band (its click does not count)
STIFT_SCHWERPUNKT = 0.10                    # a pin / a knob is audible: new constants for the new steps, the thresholds of the first steps stay
STIFT_PEGEL_DB = 1.0
FREMD_GLEICH_SCHWERPUNKT = 0.10             # a pad nobody touched sounds the same: centroid within 10 percent and RMS within 1.5 dB
FREMD_GLEICH_DB = 1.5
ROLL_STILLE_DB = -45.0                      # the bar of a deleted note is this quiet or quieter


def _graph_eintrag(t, graph):
    """The /graphen entry of a graph, or None."""
    g = t.ruf("GET", "/graphen")
    liste = (g.j or {}).get("graphen", []) if isinstance(g.j, dict) else []
    return next((x for x in liste if x.get("name") == graph), None)


def _klang_projekt(t, name, graph, noten=None, laenge_beats=KLANG_BEATS, parameter=None):
    """A fresh project with one instrument track on the Cypher Modular graph and a MIDI clip of `noten` (beat, note, length) at beat 0.
    Without notes the clip is empty (the piano roll draws into it). Returns (spur_id, clip_id, tempo) or raises."""
    a = t.ruf("POST", "/proj/neu?antwort=kurz", {"name": name})
    if not a.ok:
        raise RuntimeError(f"proj/neu: {a.code} {a.grund}")
    geraet = {"art": "intern", "name": "bk", "graph": graph, "parameter": dict(parameter or {})}
    a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": f"J4 {graph} track",
                                                     "befehle": [{"befehl": "spur_neu", "art": "instrument", "name": "Test", "geraet": geraet}]})
    if not a.ok:
        raise RuntimeError(f"spur_neu {graph}: {a.code} {a.grund}")
    clip = {"befehl": "clip_neu", "art": "midi", "start_beat": 0, "laenge_beats": laenge_beats}
    p = t.ruf("GET", "/proj/aktuell").j["projekt"]
    spur_id = p["spuren"][-1]["id"]
    if noten:
        clip["noten"] = [{"beat": float(b), "laenge": float(l), "ton": int(n), "vel": 100} for b, n, l in noten]
    a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": "J4 notes", "befehle": [dict(clip, spur_id=spur_id)]})
    if not a.ok:
        raise RuntimeError(f"clip_neu {graph}: {a.code} {a.grund}")
    p = t.ruf("GET", "/proj/aktuell").j["projekt"]
    spur = next(s for s in p["spuren"] if s["id"] == spur_id)
    return spur_id, spur["clips"][-1]["id"], float(p.get("tempo_bpm") or 120)


def _export_klang(t, bis_beat, tempo, marke):
    """Exports from beat 0 to `bis_beat`, checks the file (silence, clipping, NaN, DC) and returns (path, mono samples, export answer)."""
    a = t.ruf("POST", "/proj/export", {"von_beat": 0, "bis_beat": bis_beat}, timeout=300)
    if not a.ok or not isinstance(a.j, dict) or not a.j.get("datei"):
        raise RuntimeError(f"proj/export ({marke}): {a.code} {a.grund}")
    pfad = a.j["datei"]
    d = t.pruefe_datei(pfad, min_sek=bis_beat * 60.0 / tempo * 0.95)
    if "still" in d.gruende:
        raise RuntimeError(f"export {marke} is silent: the device does not sound")
    if not d.ok:
        raise RuntimeError(f"export {marke} is not a good file: {','.join(d.gruende)}")
    return pfad, klang.lade(pfad), a.j


def _bar_s(tempo):
    return 4 * 60.0 / tempo


def _rund(x, n=2):
    return None if x is None or x != x else round(float(x), n)


def _ton_fenster(x, tempo, k):
    """The sustained part of the note in bar k (skips the attack, stops before the release)."""
    bar, note = _bar_s(tempo), NOTE_BEATS * 60.0 / tempo
    return klang.fenster(x, k * bar + 0.08, k * bar + note * 0.95)


def _befund_ton(x, tempo):
    """Three one-bar slots of a pitched device. Returns (values for the report, list of faults)."""
    bar, note = _bar_s(tempo), NOTE_BEATS * 60.0 / tempo
    slots = [klang.fenster(x, k * bar, (k + 1) * bar) for k in range(len(TON_FOLGE))]
    pegel = [klang.rms_db(s[:int(note * klang.SR)]) for s in slots]
    halb = [klang.verschiebung_halbtoene(_ton_fenster(x, tempo, 0), _ton_fenster(x, tempo, k)) for k in range(len(TON_FOLGE))]
    abfall = [klang.abfall_db(s, note)[0] for s in slots]
    fehler = []
    if min(pegel) < SLOT_STUMM_DB:
        fehler.append(f"a note does not sound: level per bar {[_rund(p, 1) for p in pegel]} dBFS, limit {SLOT_STUMM_DB}")
    falsch = [k + 1 for k, (h, e) in enumerate(zip(halb, HALBTON_ERWARTET)) if not (abs(h - e) <= HALBTON_TOL)]
    if falsch:
        fehler.append(f"pitch off in note {falsch}: {[_rund(h) for h in halb]} semitones against the first, expected {list(HALBTON_ERWARTET)} +-{HALBTON_TOL}")
    if min(abfall) < ABFALL_TON_DB:
        fehler.append(f"the notes do not end: fall per bar {[_rund(a, 1) for a in abfall]} dB, expected at least {ABFALL_TON_DB}")
    return {"pegel_db": [_rund(p, 1) for p in pegel], "halbtoene": [_rund(h) for h in halb], "abfall_db": [_rund(a, 1) for a in abfall]}, fehler


def _befund_schlag(x, tempo):
    """Three one-bar slots with a kick on the first beat each. Returns (values for the report, list of faults)."""
    bar, schlag = _bar_s(tempo), 60.0 / tempo
    slots = [klang.fenster(x, k * bar, (k + 1) * bar) for k in range(KLANG_BEATS // 4)]
    pegel = [klang.rms_db(s[:int(schlag * klang.SR)]) for s in slots]
    tief = [klang.anteil(s[:int(0.15 * klang.SR)], 0.0, TIEF_BIS_HZ) for s in slots]
    anstieg = [float(klang.rahmen_db(s[:int(0.3 * klang.SR)], 0.01).argmax()) * 0.01 for s in slots]
    abfall = [klang.abfall_db(s, 0.3, 0.1)[0] for s in slots]
    fehler = []
    if min(pegel) < SLOT_STUMM_DB:
        fehler.append(f"a hit does not sound: level per bar {[_rund(p, 1) for p in pegel]} dBFS, limit {SLOT_STUMM_DB}")
    if min(tief) < KICK_TIEF_ANTEIL:
        fehler.append(f"the kick is not low: share of the energy below {TIEF_BIS_HZ:.0f} Hz {[_rund(s) for s in tief]}, expected at least {KICK_TIEF_ANTEIL}")
    if max(anstieg) > ANSTIEG_SCHLAG_S:
        fehler.append(f"the hit has no attack: loudest frame at {[_rund(a, 3) for a in anstieg]} s, limit {ANSTIEG_SCHLAG_S}")
    if min(abfall) < ABFALL_SCHLAG_DB:
        fehler.append(f"the hit does not decay: fall per bar {[_rund(a, 1) for a in abfall]} dB, expected at least {ABFALL_SCHLAG_DB}")
    return {"pegel_db": [_rund(p, 1) for p in pegel], "tiefer_anteil": [_rund(s) for s in tief], "anstieg_s": [_rund(a, 3) for a in anstieg],
            "abfall_db": [_rund(a, 1) for a in abfall]}, fehler


def _familien_schritt(t, w, spec, marke, aus):
    graph = spec["graph"]
    eintrag = _graph_eintrag(t, graph)
    if eintrag is None:
        raise RuntimeError(f"{graph} is registered for the family {spec['familie']} but the graph list does not have it")
    w.update(familie=spec["familie"], geraet=graph)
    if spec["art"] == "fx":
        return _fx_schritt(t, w, graph, marke, aus)
    noten = [(b, 36, 0.25) for b in (0.0, 4.0, 8.0)] if spec["art"] == "schlag" else [(b, n, NOTE_BEATS) for b, n in TON_FOLGE]
    _, _, tempo = _klang_projekt(t, f"j4-tour-{spec['familie']}-{marke}", graph, noten)
    pfad, x, ex = _export_klang(t, KLANG_BEATS, tempo, graph)
    werte, fehler = (_befund_schlag if spec["art"] == "schlag" else _befund_ton)(x, tempo)
    w.update(datei=pfad, spitze_db=ex.get("spitze_db"), **werte)
    if fehler:
        t.rot("; ".join(fehler))


def _fx_schritt(t, w, graph, marke, aus):
    """A registered effect device behind a synth track: the same notes with and without it; the effect changes the sound and the sound stays whole."""
    spur_id, _, tempo = _klang_projekt(t, f"j4-tour-fx-{marke}", FX_BASIS, [(b, n, NOTE_BEATS) for b, n in TON_FOLGE])
    _, trocken, _ = _export_klang(t, KLANG_BEATS, tempo, "dry")
    a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": f"J4 insert {graph}", "befehle": [
        {"befehl": "insert_setzen", "strang_id": spur_id, "pos": 0, "art": "bk", "graph": graph}]})
    if not a.ok:
        raise RuntimeError(f"insert_setzen {graph}: {a.code} {a.grund}")
    p = t.ruf("GET", "/proj/aktuell").j["projekt"]
    stufen = next(s for s in p["spuren"] if s["id"] == spur_id).get("inserts") or []
    w.update(instrument=FX_BASIS, stufen=[s.get("graph") for s in stufen])
    if [s.get("graph") for s in stufen] != [graph]:
        raise RuntimeError(f"the track does not hold the stage {graph}: {stufen}")
    pfad, nass, ex = _export_klang(t, KLANG_BEATS, tempo, "with effect")
    vorher = (klang.rms_db(trocken), klang.schwerpunkt(trocken))
    nachher = (klang.rms_db(nass), klang.schwerpunkt(nass))
    sw, db = _unterschied(vorher, nachher)
    w.update(datei=pfad, trocken_rms_db=_rund(vorher[0]), trocken_schwerpunkt_hz=_rund(vorher[1], 1), effekt_rms_db=_rund(nachher[0]),
             effekt_schwerpunkt_hz=_rund(nachher[1], 1), schwerpunkt_aenderung=_rund(sw, 3), pegel_aenderung_db=_rund(db),
             spitze_db=ex.get("spitze_db"), grenze=f"centroid {SCHWERPUNKT_MIN:.0%} or {PEGEL_MIN_DB} dB")
    if not _hoerbar(vorher, nachher):
        t.rot(f"the effect {graph} does not change the sound: the export sounds the same with and without it")


def _knopf_nr(g, name):
    """Knob number (as text) of the knob a graph calls `name`, or None."""
    namen = (g or {}).get("regler_namen") or {}
    return next((k for k, v in namen.items() if v == name), None)


def _noten_zaehler(projekt):
    """The next note id number, as the piano roll counts it (notenZaehler in public/production/pianoroll.js)."""
    import re
    if isinstance(projekt.get("naechste_noten_id"), int):
        return projekt["naechste_noten_id"]
    m = 1
    for s in projekt.get("spuren") or []:
        for c in s.get("clips") or []:
            if c.get("art") != "midi":
                continue
            if isinstance(c.get("naechste_noten_id"), int):
                m = max(m, c["naechste_noten_id"])
            for n in c.get("noten") or []:
                if re.fullmatch(r"n\d+", str(n.get("id"))):
                    m = max(m, int(n["id"][1:]) + 1)
    return m


def klangschritte(t):
    marke = str(int(time.time()))
    aus = Path(t.ausgabe)
    for spec in FAMILIEN:
        with t.schritt(f"j4.familie_{spec['familie']}", f"play {spec['graph']} (family {spec['familie']}) through a track and measure it") as w:
            _familien_schritt(t, w, spec, marke, aus)

    with t.schritt("j4.kraken", f"play {KRAKEN} (semi-modular, patch field) through a track and measure it") as w:
        if _graph_eintrag(t, KRAKEN) is None:
            raise RuntimeError(f"{KRAKEN} is not in the graph list")
        _, _, tempo = _klang_projekt(t, f"j4-tour-kraken-{marke}", KRAKEN, [(b, n, NOTE_BEATS) for b, n in TON_FOLGE])
        pfad, x, ex = _export_klang(t, KLANG_BEATS, tempo, KRAKEN)
        werte, fehler = _befund_ton(x, tempo)
        w.update(geraet=KRAKEN, datei=pfad, spitze_db=ex.get("spitze_db"), **werte)
        if fehler:
            t.rot("; ".join(fehler))

    with t.schritt("j4.kraken_stift", "set one patch-field pin of Kraken: the pin is stored and the sound changes") as w:
        zeile_name, spalte_name, wert = KRAKEN_STIFT
        spur_id, _, tempo = _klang_projekt(t, f"j4-tour-pin-{marke}", KRAKEN, [(b, n, NOTE_BEATS) for b, n in TON_FOLGE])
        _, vorher, _ = _export_klang(t, KLANG_BEATS, tempo, "default pins")
        sf = t.ruf("GET", f"/proj/steckfeld?spur_id={spur_id}")
        j = sf.j if isinstance(sf.j, dict) else {}
        zeilen, spalten = j.get("zeilen") or [], j.get("spalten") or []
        low = lambda l: [str(s).lower() for s in l]  # noqa: E731
        if zeile_name.lower() not in low(zeilen) or spalte_name.lower() not in low(spalten):
            raise RuntimeError(f"the patch field has no row {zeile_name!r} or no column {spalte_name!r}: rows {zeilen}, columns {spalten}")
        zeile, spalte = low(zeilen).index(zeile_name.lower()), low(spalten).index(spalte_name.lower())
        vorher_stifte = [s for s in j.get("stifte") or []]
        a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": "J4 pin", "befehle": [
            {"befehl": "geraet_stift_setzen", "spur_id": spur_id, "satz": 0, "zeile": zeile, "spalte": spalte, "wert": wert}]})
        if not a.ok:
            raise RuntimeError(f"geraet_stift_setzen: {a.code} {a.grund}")
        danach = t.ruf("GET", f"/proj/steckfeld?spur_id={spur_id}").j or {}
        stifte = danach.get("stifte") or []
        gespeichert = next((s for s in stifte if s[0] == 0 and s[1] == zeile and s[2] == spalte), None)
        w.update(stift=f"{zeile_name} > {spalte_name}", wert=wert, stifte_vorher=len(vorher_stifte), stifte_nachher=len(stifte), gespeichert=gespeichert,
                 eigene_liste=danach.get("eigene"))
        if gespeichert is None or abs(gespeichert[3] - wert) > 1e-6:
            raise RuntimeError(f"the pin {zeile_name} > {spalte_name} is not in the stored list after the write: {gespeichert}")
        if len(stifte) != len(vorher_stifte) + 1:
            raise RuntimeError(f"the write changed {len(stifte) - len(vorher_stifte):+d} pins, expected +1 (the defaults must stay)")
        pfad, nachher_x, ex = _export_klang(t, KLANG_BEATS, tempo, "with pin")
        v = (klang.rms_db(vorher), klang.schwerpunkt(vorher))
        n = (klang.rms_db(nachher_x), klang.schwerpunkt(nachher_x))
        sw, db = _unterschied(v, n)
        w.update(datei=pfad, vorher_rms_db=_rund(v[0]), vorher_schwerpunkt_hz=_rund(v[1], 1), nachher_rms_db=_rund(n[0]),
                 nachher_schwerpunkt_hz=_rund(n[1], 1), schwerpunkt_aenderung=_rund(sw, 3), pegel_aenderung_db=_rund(db),
                 grenze=f"centroid {STIFT_SCHWERPUNKT:.0%} or {STIFT_PEGEL_DB} dB")
        if sw < STIFT_SCHWERPUNKT and db < STIFT_PEGEL_DB:
            t.rot("the pin is stored but the sound did not change")

    _drumsynth(t, marke)
    _klavierrolle(t, marke)


def _drumsynth(t, marke):
    def pad_fenster(x, tempo):
        schlag = 60.0 / tempo
        return [klang.fenster(x, k * schlag, k * schlag + min(schlag, 0.3)) for k in range(len(DRUMSYNTH_KIT))]

    def kit_spur(w):
        noten = [(float(k), n, 0.25) for k, (_, n) in enumerate(DRUMSYNTH_KIT)]
        return _klang_projekt(t, f"j4-tour-drumsynth-{marke}", DRUMSYNTH, noten, laenge_beats=4)

    with t.schritt("j4.drumsynth", "a Drum Synth kit: kick, snare and closed hat are three different recipes") as w:
        eintrag = _graph_eintrag(t, DRUMSYNTH)
        if eintrag is None:
            raise RuntimeError(f"{DRUMSYNTH} is not in the graph list")
        _, _, tempo = kit_spur(w)
        pfad, x, ex = _export_klang(t, 4, tempo, "kit")
        pads = pad_fenster(x, tempo)
        schw = [klang.schwerpunkt(p) for p in pads]
        tief = [klang.anteil(p, 0.0, TIEF_BIS_HZ) for p in pads]
        pegel = [klang.rms_db(p) for p in pads]
        w.update(geraet=DRUMSYNTH, datei=pfad, pads=[n for n, _ in DRUMSYNTH_KIT], pegel_db=[_rund(p, 1) for p in pegel],
                 schwerpunkt_hz=[_rund(s, 0) for s in schw], tiefer_anteil=[_rund(s) for s in tief], spitze_db=ex.get("spitze_db"))
        fehler = []
        if min(pegel) < PAD_STUMM_DB:
            fehler.append(f"a pad does not sound: level per pad {[_rund(p, 1) for p in pegel]} dBFS, limit {PAD_STUMM_DB}")
        if tief[0] < KICK_TIEF_ANTEIL:
            fehler.append(f"the kick pad is not low: share of the energy below {TIEF_BIS_HZ:.0f} Hz {_rund(tief[0])}, expected at least {KICK_TIEF_ANTEIL}")
        if tief[1] > SNARE_TIEF_MAX:
            fehler.append(f"the snare pad is low: share of the energy below {TIEF_BIS_HZ:.0f} Hz {_rund(tief[1])}, expected at most {SNARE_TIEF_MAX}")
        if schw[2] < HAT_SCHWERPUNKT_MIN_HZ:
            fehler.append(f"the closed hat pad is not high: centroid {_rund(schw[2], 0)} Hz, limit {HAT_SCHWERPUNKT_MIN_HZ}")
        gleich = [f"{DRUMSYNTH_KIT[i][0]}/{DRUMSYNTH_KIT[j][0]}" for i in range(3) for j in range(i + 1, 3)
                  if abs(schw[i] - schw[j]) / max(schw[i], schw[j], 1.0) < PAD_UNTERSCHIED]
        if gleich:
            fehler.append(f"pads of different recipes sound alike: centroid {[_rund(s, 0) for s in schw]} Hz, {gleich} differ by less than {PAD_UNTERSCHIED:.0%}")
        if fehler:
            t.rot("; ".join(fehler))

    with t.schritt("j4.drumsynth_knopf", f"turn one knob of one pad ({DRUMSYNTH_KNOPF[0]}): that pad changes, the others stay") as w:
        name, wert = DRUMSYNTH_KNOPF
        eintrag = _graph_eintrag(t, DRUMSYNTH)
        nr = _knopf_nr(eintrag, name)
        if nr is None:
            raise RuntimeError(f"{DRUMSYNTH} has no knob called {name!r}: {sorted((eintrag or {}).get('regler_namen', {}).values())[:8]} ...")
        spur_id, _, tempo = kit_spur(w)
        _, vorher, _ = _export_klang(t, 4, tempo, "default knobs")
        a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": f"J4 {name}", "befehle": [
            {"befehl": "spur_aendern", "spur_id": spur_id,
             "geraet": {"art": "intern", "name": "bk", "graph": DRUMSYNTH, "parameter": {f"k{nr}": wert}}}]})
        if not a.ok:
            raise RuntimeError(f"spur_aendern: {a.code} {a.grund}")
        pfad, nachher, _ = _export_klang(t, 4, tempo, "changed knob")
        v, n = pad_fenster(vorher, tempo), pad_fenster(nachher, tempo)
        mess = lambda p: (klang.rms_db(p), klang.schwerpunkt(p))  # noqa: E731
        aend = [_unterschied(mess(a_), mess(b_)) for a_, b_ in zip(v, n)]
        eigen = [k for k, (p, _) in enumerate(DRUMSYNTH_KIT) if name.startswith(p + " ")]
        # the pad's own sound: a kick's tune is the centroid of its low band; the other pads are judged on the whole spectrum
        for k in eigen:
            if DRUMSYNTH_KIT[k][0] == "Kick":
                b0, b1 = (klang.schwerpunkt(q[k], *KICK_BAND) for q in (v, n))
                aend[k] = (abs(b1 - b0) / max(b0, 1.0), aend[k][1])
                w["kick_band_hz"] = [_rund(b0, 0), _rund(b1, 0)]
        w.update(knopf=f"k{nr} {name}", wert=wert, datei=pfad, pads=[p for p, _ in DRUMSYNTH_KIT],
                 schwerpunkt_aenderung=[_rund(s, 3) for s, _ in aend], pegel_aenderung_db=[_rund(d) for _, d in aend],
                 grenze=f"changed pad: centroid {STIFT_SCHWERPUNKT:.0%} or {STIFT_PEGEL_DB} dB, other pads: centroid {FREMD_GLEICH_SCHWERPUNKT:.0%} and {FREMD_GLEICH_DB} dB")
        fremd_laut = [DRUMSYNTH_KIT[k][0] for k in range(len(aend)) if k not in eigen
                      and not (aend[k][0] <= FREMD_GLEICH_SCHWERPUNKT and aend[k][1] <= FREMD_GLEICH_DB)]
        stumm = [DRUMSYNTH_KIT[k][0] for k in eigen if aend[k][0] < STIFT_SCHWERPUNKT and aend[k][1] < STIFT_PEGEL_DB]
        if stumm:
            t.rot(f"the knob {name} did not change the sound of its pad {stumm}")
        elif fremd_laut:
            t.rot(f"the knob {name} also changed the other pads {fremd_laut}: a pad has its own knobs")


def _klavierrolle(t, marke):
    with t.schritt("j4.klavierrolle", "draw notes into an empty clip the way the piano roll does: they play, an edit changes what plays") as w:
        spur_id, clip_id, tempo = _klang_projekt(t, f"j4-tour-roll-{marke}", ROLL_GRAPH, None, laenge_beats=KLANG_BEATS)
        bar, note_s = _bar_s(tempo), NOTE_BEATS * 60.0 / tempo
        p = t.ruf("GET", "/proj/aktuell").j["projekt"]
        n0 = _noten_zaehler(p)
        noten = [{"id": f"n{n0 + k}", "beat": float(b), "laenge": NOTE_BEATS, "ton": int(n), "vel": 100} for k, (b, n) in enumerate(ROLL_NOTEN)]
        a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": "Add 3 notes", "befehle": [
            {"befehl": "noten_neu", "clip_id": clip_id, "noten": noten}]})
        if not a.ok:
            raise RuntimeError(f"noten_neu: {a.code} {a.grund}")
        p = t.ruf("GET", "/proj/aktuell").j["projekt"]
        clip = next(c for s in p["spuren"] if s["id"] == spur_id for c in s["clips"] if c["id"] == clip_id)
        w.update(clip=clip_id, noten_im_clip=len(clip.get("noten") or []), noten_gezeichnet=len(ROLL_NOTEN))
        if len(clip.get("noten") or []) != len(ROLL_NOTEN):
            raise RuntimeError(f"the clip holds {len(clip.get('noten') or [])} notes after drawing {len(ROLL_NOTEN)}")
        pfad, x, ex = _export_klang(t, KLANG_BEATS, tempo, "drawn notes")
        werte, fehler = _befund_ton(x, tempo)
        w.update(datei=pfad, gezeichnet=werte)
        if fehler:
            t.rot("drawn notes: " + "; ".join(fehler))
        # the edit: right button deletes a note, a drag moves one (one noten_loeschen, one noten_aendern)
        weg = clip["noten"][ROLL_BEARBEITET["loeschen"] - 1]["id"]
        ver_nr, ver_halb = ROLL_BEARBEITET["verschieben"]
        ver = clip["noten"][ver_nr - 1]
        a = t.ruf("POST", "/proj/aendern?antwort=kurz", {"rev": _rev(t), "label": "Edit notes", "befehle": [
            {"befehl": "noten_loeschen", "clip_id": clip_id, "ids": [weg]},
            {"befehl": "noten_aendern", "clip_id": clip_id, "noten": [{"id": ver["id"], "ton": ver["ton"] + ver_halb}]}]})
        if not a.ok:
            raise RuntimeError(f"noten_loeschen / noten_aendern: {a.code} {a.grund}")
        pfad2, y, _ = _export_klang(t, KLANG_BEATS, tempo, "edited notes")
        slots = [klang.fenster(y, k * bar, (k + 1) * bar) for k in range(3)]
        pegel = [klang.rms_db(s[:int(note_s * klang.SR)]) for s in slots]
        halb = klang.verschiebung_halbtoene(_ton_fenster(y, tempo, 0), _ton_fenster(y, tempo, ver_nr - 1))
        w.update(datei_bearbeitet=pfad2, pegel_bearbeitet_db=[_rund(p, 1) for p in pegel], verschoben_halbtoene=_rund(halb))
        if ROLL_BEARBEITET["loeschen"] - 1 < len(pegel) and pegel[ROLL_BEARBEITET["loeschen"] - 1] > ROLL_STILLE_DB:
            t.rot(f"the deleted note still sounds: {_rund(pegel[ROLL_BEARBEITET['loeschen'] - 1], 1)} dBFS in its bar, limit {ROLL_STILLE_DB}")
        erwartet = HALBTON_ERWARTET[ver_nr - 1] + ver_halb
        if not abs(halb - erwartet) <= HALBTON_TOL:
            t.rot(f"the moved note is at {_rund(halb)} semitones against the first, expected {erwartet} +-{HALBTON_TOL}")
