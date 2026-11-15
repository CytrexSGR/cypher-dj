# seq_view.py: the model of the S8 SEQ screen. It turns one place of GET /seq/stand?zellen=1 (SEQ v2: patterns with note rows
# that carry `zellen`, one character per cell) and the project beat into the rows to draw. No drawing, no device, no network.
import math


def _leer():
    return {"leer": True, "kopf": "", "zeilen": []}


def seq_sicht(platz, projekt_beat, fenster=16, max_zeilen=8):
    """Rows of the first audible editable pattern of a place.

    Each row shows a window of `fenster` cells; the window follows the playhead, which wraps at the pattern length.
    `kopf_index` is the playhead cell inside the window, None when no beat is known."""
    folgen = (platz or {}).get("folgen") or []
    if not isinstance(folgen, list):
        return _leer()
    wahl = next((f for f in folgen if f.get("editierbar") and not f.get("stumm")), None)
    if wahl is None:
        wahl = next((f for f in folgen if f.get("editierbar")), None)
    if wahl is None:
        return _leer()
    laenge = wahl.get("laenge_beats")
    if not isinstance(laenge, (int, float)) or laenge <= 0:
        return _leer()
    nr = folgen.index(wahl) + 1
    zeilen = []
    for z in wahl.get("zeilen") or []:
        if z.get("art") != "noten" or "zellen" not in z:
            continue
        if len(zeilen) >= max_zeilen:
            break
        zellen = z["zellen"] or ""
        von, index = 0, None
        teiler = z.get("teiler") or 0.25
        if projekt_beat is not None and teiler > 0:
            zelle = int(math.floor((projekt_beat % laenge) / teiler + 1e-9))
            von = (zelle // fenster) * fenster
            index = zelle - von
        zeilen.append({"name": z.get("name") or z.get("id") or "",
                       "zellen": zellen[von:von + fenster].ljust(fenster),
                       "kopf_index": index})
    return {"leer": False, "kopf": f"{wahl.get('name') or ''}  {nr}/{len(folgen)}", "zeilen": zeilen}
