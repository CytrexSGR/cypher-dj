# assignment.py: the controls the bridge handles in code (S8 pads, loop buttons, encoders, touch strips, APC20 rows 3 to 5,
# the whole Maschine MK2). They appear in no mapping file, so the bridge publishes them as bruecke.json in the controller
# folder and the register can list them. No device, no network.
import json
import os
import sys
import tempfile
from pathlib import Path

# folder of the kern's controller files (same rule as controllerOrdner in djk/ui/paths.ts, default instance)
ORDNER = Path(os.path.expanduser("~/.config/cypherdj/controller"))
DATEI = ORDNER / "bruecke.json"


LOOPS_NOTEN = (16, 31, 32, 33, 34, 35, 36, 37, 38, 44, 45, 49)  # freeze, fx_1..4, on_1..4, screen_right_1/2, capture: bridge-owned only in the loops view


def faengt_ab(kanal, note, ansicht=None):
    """True for the S8 notes the bridge handles itself (pads 20..27, loop button 15, DECK button 19, top-left screen
    button 40) on the left and right deck sections (channels 13, 14); while that side shows the loops view also the fx buttons
    (31..34, knob layers), the buttons under the knobs (35..38), the two right display buttons (44, 45) and CAPTURE (49). Everything else is forwarded as MIDI."""
    if kanal not in (13, 14):
        return False
    return 20 <= note <= 27 or note in (15, 19, 40) or (ansicht == "loops" and note in LOOPS_NOTEN)


def _e(geraet, quelle, ziel, art):
    return {"geraet": geraet, "quelle": quelle, "ziel": ziel, "art": art, "weg": "seite"}


def belegung():
    """One entry per physical control handled in code: 56 S8, 12 APC20, 24 MK2. The deck button and the loops-view
    buttons (freeze, fx 1..4, on 1..4, display buttons, capture) are handled in code only for the loops view (see faengt_ab)."""
    import mk2  # lazily: needs numpy and Pillow
    out = []
    for d, seite in ((1, "left"), (2, "right")):
        for p in range(1, 9):
            out.append(_e("s8", f"{seite} pad {p}", f"deck/{d}/hotcue/{p}", "taste"))
    for d, seite in ((1, "left"), (2, "right")):
        out.append(_e("s8", f"{seite} loop button", f"deck/{d}/loop", "taste"))
        out.append(_e("s8", f"{seite} screen button 1", f"ansicht/{d}", "taste"))
        out.append(_e("s8", f"{seite} loop encoder", f"deck/{d}/loop_laenge", "relativ"))
        out.append(_e("s8", f"{seite} browse encoder", f"deck/{d}/sprung", "relativ"))
        out.append(_e("s8", f"{seite} touch strip", f"deck/{d}/scrub", "beruehrung"))
        out.append(_e("s8", f"{seite} deck button", f"ansicht/{d}", "taste"))
        for n in range(1, 5):
            out.append(_e("s8", f"{seite} on button {n}", f"loopdeck/{d}/mute/{n}", "taste"))
        for n in range(1, 5):
            out.append(_e("s8", f"{seite} fx button {n}", f"loopdeck/{d}/schicht/{n}", "taste"))
        out.append(_e("s8", f"{seite} screen button right 1", f"loopdeck/{d}/szene/upper", "taste"))
        out.append(_e("s8", f"{seite} screen button right 2", f"loopdeck/{d}/szene/lower", "taste"))
        out.append(_e("s8", f"{seite} freeze button", f"loopdeck/{d}/slice", "taste"))
        out.append(_e("s8", f"{seite} capture button", f"loopdeck/{d}/laden", "taste"))
        out.append(_e("s8", f"{seite} screen encoder 1", f"deck/{d}/loop_laenge", "relativ"))
        out.append(_e("s8", f"{seite} screen encoder 2", f"deck/{d}/nudge", "relativ"))
    for d in range(1, 5):
        for zeile, ziel in ((3, f"deck/{d}/hotcue/1"), (4, f"deck/{d}/hotcue/2"), (5, f"deck/{d}/loop")):
            out.append(_e("apc20", f"clip row {zeile} column {d}", ziel, "taste"))
    for i, (kanal, _, _) in enumerate(mk2.PLAETZE):
        out.append(_e("mk2", f"group_{'abcdefgh'[i]}", kanal, "taste"))
    for n in range(1, 9):
        out.append(_e("mk2", f"top_{n}", f"seite/{n}", "taste"))
    for n in range(1, 9):
        out.append(_e("mk2", f"encoder_{n}", f"<kanal>/bk/<seite*8+{n}>", "relativ"))
    return out


def schreibe(pfad):
    """Write the table atomically as {version, geraet, eintraege}. False (and a log line) when the folder is unwritable."""
    pfad = Path(pfad)
    tmp = None
    try:
        daten = {"version": 1, "geraet": "bruecke", "eintraege": belegung()}
        pfad.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=pfad.parent, prefix=pfad.name + ".", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(daten, f, indent=1)
            f.write("\n")
        os.replace(tmp, pfad)
        return True
    except Exception as e:  # never raises: the bridge must start without the register file
        print("belegung: cannot write", pfad, e, file=sys.stderr, flush=True)
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass
        return False
