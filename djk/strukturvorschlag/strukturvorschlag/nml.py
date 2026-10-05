"""Traktor collection.nml nur LESEN. Liefert je Eintrag Pfad, Grid, BPM und Markierungen."""
import os
import xml.etree.ElementTree as ET

TYP_NAME = {0: "cue", 4: "grid", 5: "loop"}


def lokaler_pfad(dir_attr, datei, ordner_name, musik_wurzel):
    """Traktor-DIR '/:MP3 Itunes CDS/:0101 Beatport/:' -> <musik_wurzel>/0101 Beatport/<datei>.
    Alles vor dem Segment `ordner_name` wird durch `musik_wurzel` ersetzt."""
    teile = [t for t in dir_attr.split("/:") if t]
    if ordner_name not in teile:
        return None
    rest = teile[teile.index(ordner_name):]
    return os.path.join(musik_wurzel, *rest, datei)


def lies_sammlung(nml_pfad, ordner_name="0101 Beatport", musik_wurzel=None):
    if musik_wurzel is None:
        musik_wurzel = os.path.dirname(os.path.abspath(nml_pfad))
    wurzel = ET.parse(nml_pfad).getroot()
    aus = []
    for e in wurzel.iter("ENTRY"):
        loc = e.find("LOCATION")
        if loc is None:
            continue
        pfad = lokaler_pfad(loc.get("DIR", ""), loc.get("FILE", ""), ordner_name, musik_wurzel)
        if pfad is None:
            continue
        tempo = e.find("TEMPO")
        bpm = float(tempo.get("BPM")) if tempo is not None and tempo.get("BPM") else None
        grids, marken = [], []
        for c in e.findall("CUE_V2"):
            typ = int(c.get("TYPE", "-1"))
            ms = float(c.get("START", "0"))
            if typ == 4:
                grids.append(ms)
            elif typ in (0, 5):
                marken.append({"ms": ms, "typ": TYP_NAME[typ], "len_ms": float(c.get("LEN", "0")),
                               "name": c.get("NAME", ""), "hotcue": int(c.get("HOTCUE", "-1"))})
        marken.sort(key=lambda m: m["ms"])
        aus.append({"pfad": pfad, "titel": e.get("TITLE", ""), "kuenstler": e.get("ARTIST", ""),
                    "bpm_traktor": bpm, "grid_ms": min(grids) if grids else None,
                    "n_grids": len(grids), "marken": marken})
    aus.sort(key=lambda x: x["pfad"])
    return aus


def eintrag_zu(pfad, sammlung):
    for e in sammlung:
        if os.path.abspath(e["pfad"]) == os.path.abspath(pfad):
            return e
    return None
