"""Camelot-Notation und Umrechnungen zwischen Tonart-Darstellungen.

Einheitliche interne Form: (grundton, moll) mit grundton 0..11 (C=0) und moll bool.
Camelot: Moll = "A", Dur = "B"; 8B = C-Dur, 8A = A-Moll.
"""
from __future__ import annotations

import re

NAMEN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_ALIAS = {"DB": 1, "EB": 3, "GB": 6, "AB": 8, "BB": 10, "CB": 11, "FB": 4, "E#": 5, "B#": 0}

# Camelot-Nummer je Grundton
_CAM_DUR = {0: 8, 7: 9, 2: 10, 9: 11, 4: 12, 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7}
_CAM_MOLL = {9: 8, 4: 9, 11: 10, 6: 11, 1: 12, 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7}
_DUR_AUS_CAM = {v: k for k, v in _CAM_DUR.items()}
_MOLL_AUS_CAM = {v: k for k, v in _CAM_MOLL.items()}

# libKeyFinder key_t: A_MAJOR=0, A_MINOR, B_FLAT_MAJOR, ... A_FLAT_MINOR=23, SILENCE=24
_KF_GRUND = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8]  # A, Bb, B, C, Db, D, Eb, E, F, Gb, G, Ab


def zu_camelot(grundton: int, moll: bool) -> str:
    return f"{(_CAM_MOLL if moll else _CAM_DUR)[grundton % 12]}{'A' if moll else 'B'}"


def aus_camelot(code: str) -> tuple[int, bool] | None:
    m = re.fullmatch(r"\s*(\d{1,2})\s*([ABab])\s*", code or "")
    if not m:
        return None
    n, buchst = int(m.group(1)), m.group(2).upper()
    if not 1 <= n <= 12:
        return None
    return (_MOLL_AUS_CAM[n], True) if buchst == "A" else (_DUR_AUS_CAM[n], False)


def aus_name(grundname: str, tongeschlecht: str) -> tuple[int, bool]:
    """Essentia-Ausgabe, z. B. ('Eb', 'minor') oder ('F#', 'major')."""
    g = grundname.strip().upper()
    idx = _ALIAS[g] if g in _ALIAS else NAMEN.index(g)
    return idx, tongeschlecht.strip().lower().startswith("min")


def aus_keyfinder(k: int) -> tuple[int, bool] | None:
    if not 0 <= k < 24:
        return None
    return _KF_GRUND[k // 2], bool(k % 2)


def camelot_teile(code: str) -> tuple[int, str]:
    m = re.fullmatch(r"(\d{1,2})([AB])", code)
    return int(m.group(1)), m.group(2)


def beziehung(geschaetzt: str, wahr: str) -> str:
    """Einstufung wie in der MIREX-Key-Auswertung, in Camelot ausgedrückt.

    gleich · quinte (±1 auf dem Rad, gleiches Geschlecht) · parallel (relatives Dur/Moll,
    gleiche Nummer) · gleichnamig (gleicher Grundton, anderes Geschlecht) · falsch.
    """
    if geschaetzt == wahr:
        return "gleich"
    ng, bg = camelot_teile(geschaetzt)
    nw, bw = camelot_teile(wahr)
    if bg == bw and (ng - nw) % 12 in (1, 11):
        return "quinte"
    if ng == nw and bg != bw:
        return "parallel"
    tg, mg = aus_camelot(geschaetzt)
    tw, mw = aus_camelot(wahr)
    if tg == tw and mg != mw:
        return "gleichnamig"
    return "falsch"


MIREX_GEWICHT = {"gleich": 1.0, "quinte": 0.5, "parallel": 0.3, "gleichnamig": 0.2, "falsch": 0.0}
