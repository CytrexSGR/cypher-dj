"""The type rule: track, loop or oneshot from path, duration, BPM and the root's type."""
from __future__ import annotations

import re

_BPM = re.compile(
    r"(?i)(?<![0-9])(6[0-9]|[7-9][0-9]|1[0-9][0-9])[ _-]?bpm"
    r"|(?<=[_ -])(7[0-9]|8[0-9]|9[0-9]|1[0-7][0-9])(?=[_ -])"
)
_LOOP = {"loop", "loops"}
_ONESHOT = {"oneshot", "oneshots", "shot", "shots", "hit", "hits"}


def bpm_aus_namen(name: str) -> float | None:
    m = _BPM.search(name)
    if not m:
        return None
    return float(m.group(1) or m.group(2))


def token(rel: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", rel.lower()) if t]


def bestimme(rel: str, dauer_s: float, bpm: float | None, wurzel_typ: str) -> str:
    if wurzel_typ != "auto":
        return wurzel_typ
    toks = set(token(rel))
    if toks & _LOOP and dauer_s < 120:
        return "loop"
    if toks & _ONESHOT and dauer_s < 30:
        return "oneshot"
    if dauer_s >= 60:
        return "track"
    if bpm and dauer_s >= 4 * 60 / bpm * 0.95:
        return "loop"
    return "oneshot"
