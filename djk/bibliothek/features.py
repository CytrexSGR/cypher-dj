"""File features: sha256, duration, tags; cached per (path, size, mtime)."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from starter.tools import WerkzeugFehlt
from key_energy.camelot import aus_camelot, aus_name, zu_camelot

from .scan import Auslassung, Datei
from .typ_regel import bpm_aus_namen, token

HINWEIS_MUTAGEN = "mutagen not installed: no tags, durations from soundfile/ffprobe"
INSTRUMENTE = {
    "kick": "kick", "snare": "snare", "clap": "clap", "hat": "hihat", "hats": "hihat", "hh": "hihat", "hihat": "hihat",
    "hihats": "hihat", "perc": "perc", "bass": "bass", "synth": "synth", "pad": "pad", "vox": "vocal", "vocal": "vocal",
    "vocals": "vocal", "fx": "fx", "fill": "fill", "chord": "chord", "lead": "lead", "tom": "tom", "ride": "ride",
    "crash": "crash", "cymbal": "cymbal", "piano": "piano", "organ": "organ",
    # abbreviations of the starter sounds and common drum machines (whole tokens only)
    "bd": "kick", "sd": "snare", "cp": "clap", "rim": "rim", "oh": "hihat", "cr": "crash", "rd": "ride",
    "ht": "tom", "mt": "tom", "lt": "tom",
}
KUERZEL = frozenset(("bd", "sd", "cp", "rim", "oh", "cr", "rd", "ht", "mt", "lt"))


@dataclass(frozen=True)
class Merkmale:
    sha: str
    dauer_s: float
    tags: dict[str, str] = field(default_factory=dict)


def _cache_pfad() -> Path:
    v = os.environ.get("CYPHERDJ_BIBLIOTHEK_CACHE")
    if v:
        return Path(v)
    return Path(os.path.expanduser("~")) / ".cache" / "cypherdj" / "bibliothek" / "merkmale.sqlite"


_CREATE = ("CREATE TABLE IF NOT EXISTS merkmale(pfad TEXT NOT NULL, groesse INTEGER NOT NULL, mtime_ns INTEGER NOT NULL, "
           "sha TEXT NOT NULL, dauer_s REAL NOT NULL, tags TEXT NOT NULL, tags_gelesen INTEGER NOT NULL DEFAULT 0, "
           "PRIMARY KEY(pfad, groesse, mtime_ns))")


class MerkmalCache:
    """sqlite cache; `gehasht` counts the files hashed through this object. A cache that cannot be opened is memory only."""

    def __init__(self, pfad: Path | None = None):
        self.gehasht = 0
        self.mutagen_hinweis = False
        p = pfad or _cache_pfad()
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            self._db = sqlite3.connect(str(p))
            self._db.execute("PRAGMA synchronous=OFF")
            self._db.execute(_CREATE)
            if "tags_gelesen" not in [r[1] for r in self._db.execute("PRAGMA table_info(merkmale)")]:
                # a cache of an older version: its entries did not record whether tags were read
                self._db.execute("ALTER TABLE merkmale ADD COLUMN tags_gelesen INTEGER NOT NULL DEFAULT 0")
            self._db.commit()
        except (OSError, sqlite3.Error):
            self._db = sqlite3.connect(":memory:")
            self._db.execute(_CREATE)

    def hole(self, d: Datei) -> tuple[Merkmale, bool] | None:
        """(features, tags_were_read) or None; a row with unreadable tags JSON counts as absent."""
        try:
            r = self._db.execute("SELECT sha, dauer_s, tags, tags_gelesen FROM merkmale WHERE pfad=? AND groesse=? AND mtime_ns=?",
                                 (str(d.pfad), d.groesse, d.mtime_ns)).fetchone()
        except sqlite3.Error:
            return None
        if not r:
            return None
        try:
            tags = json.loads(r[2])
        except ValueError:
            return None
        if not isinstance(tags, dict):
            return None
        return Merkmale(r[0], r[1], tags), bool(r[3])

    def lege(self, d: Datei, m: Merkmale, tags_gelesen: bool) -> None:
        try:
            self._db.execute("DELETE FROM merkmale WHERE pfad=?", (str(d.pfad),))
            self._db.execute("INSERT INTO merkmale VALUES (?,?,?,?,?,?,?)",
                             (str(d.pfad), d.groesse, d.mtime_ns, m.sha, m.dauer_s, json.dumps(m.tags, ensure_ascii=False),
                              1 if tags_gelesen else 0))
            self._db.commit()
        except sqlite3.Error:
            pass

    def schliessen(self) -> None:
        self._db.close()


def _importierbar(name: str) -> bool:
    try:
        __import__(name)
        return True
    except ImportError:
        return False


def lesewerkzeuge() -> list[str]:
    out = [n for n in ("mutagen", "soundfile") if _importierbar(n)]
    if shutil.which("ffprobe"):
        out.append("ffprobe")
    return out


def _sha256(pfad: Path) -> str:
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        while blk := f.read(1 << 20):
            h.update(blk)
    return h.hexdigest()


def _camelot(wert: str) -> str | None:
    wert = wert.strip()
    c = aus_camelot(wert)
    if c:
        return zu_camelot(*c)
    m = re.fullmatch(r"([A-Ga-g])\s*([#b♯♭]?)\s*(m|min|minor|maj|major|dur|moll)?", wert)
    if not m:
        return None
    grund = m.group(1).upper() + {"♯": "#", "♭": "b"}.get(m.group(2), m.group(2))
    moll = (m.group(3) or "").lower() in ("m", "min", "minor", "moll")
    try:
        return zu_camelot(*aus_name(grund, "minor" if moll else "major"))
    except (ValueError, KeyError):
        return None


def _mutagen(pfad: Path) -> tuple[float, dict[str, str]] | None:
    """(duration, tags) via mutagen, None when mutagen is absent or does not know the file."""
    try:
        import mutagen
        from mutagen.easyid3 import EasyID3
    except ImportError:
        return None
    try:
        EasyID3.RegisterTextKey("initialkey", "TKEY")
    except Exception:
        pass
    try:
        f = mutagen.File(str(pfad), easy=True)
    except Exception:
        return None
    if f is None or getattr(f, "info", None) is None:
        return None
    dauer = float(getattr(f.info, "length", 0) or 0)
    roh = f.tags or {}

    def erst(*keys: str) -> str | None:
        for k in keys:
            try:
                v = roh.get(k)
            except Exception:
                v = None
            if v:
                s = str(v[0] if isinstance(v, (list, tuple)) else v).strip()
                if s:
                    return s
        return None

    tags: dict[str, str] = {}
    for ziel, keys in (("title", ("title",)), ("artist", ("artist",)), ("genre", ("genre",)), ("release", ("album",)),
                       ("label", ("organization", "label")), ("isrc", ("isrc",))):
        v = erst(*keys)
        if v:
            tags[ziel] = v
    datum = erst("date", "originaldate")
    if datum and (m := re.match(r"\d{4}", datum)):
        tags["jahr"] = m.group(0)
    bpm = erst("bpm")
    if bpm:
        if _bpm_ok(bpm):
            tags["bpm"] = bpm
    schluessel = erst("initialkey")
    if schluessel and (c := _camelot(schluessel)):
        tags["camelot"] = c
    return dauer, tags


def _bpm_ok(wert: object) -> bool:
    """A usable BPM: finite and above zero (inf, nan, 0, negatives and text are dropped)."""
    try:
        v = float(wert)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return math.isfinite(v) and v > 0


def _soundfile(pfad: Path) -> float | None:
    try:
        import soundfile
        return float(soundfile.info(str(pfad)).duration)
    except Exception:
        return None


def _ffprobe(pfad: Path) -> float | None:
    exe = shutil.which("ffprobe")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(pfad)],
                           capture_output=True, text=True, timeout=20)
        return float(r.stdout.strip().splitlines()[0]) if r.returncode == 0 and r.stdout.strip() else None
    except (OSError, subprocess.TimeoutExpired, ValueError, IndexError):
        return None


def merkmale(d: Datei, cache: MerkmalCache) -> Merkmale | Auslassung:
    treffer = cache.hole(d)
    if treffer:
        m, gelesen = treffer
        if gelesen or not _importierbar("mutagen"):
            return m
        # built without mutagen, which is installed now: read the tags of this file again, no new hash
        mg = _mutagen(d.pfad)
        m = Merkmale(m.sha, m.dauer_s, mg[1] if mg else {})
        cache.lege(d, m, True)
        return m
    if not lesewerkzeuge():
        raise WerkzeugFehlt("mutagen, soundfile or ffprobe",
                            "no tool to read audio files: install mutagen or soundfile (pip install -r djk/requirements.txt) or ffprobe")
    tags: dict[str, str] = {}
    dauer = 0.0
    mg = _mutagen(d.pfad)
    if mg:
        dauer, tags = mg
    elif not _importierbar("mutagen") and not cache.mutagen_hinweis:
        cache.mutagen_hinweis = True
        print(HINWEIS_MUTAGEN, file=sys.stderr)
    for leser in (_soundfile, _ffprobe):
        if dauer > 0:
            break
        dauer = leser(d.pfad) or 0.0
    if not dauer > 0:
        return Auslassung(str(d.pfad), "kaputt")
    try:
        sha = _sha256(d.pfad)
    except OSError:
        return Auslassung(str(d.pfad), "unlesbar")
    cache.gehasht += 1
    m = Merkmale(sha, dauer, tags)
    cache.lege(d, m, mg is not None or _importierbar("mutagen"))
    return m


def _voll(t: str) -> str | None:
    """Instrument of a spelled-out word (singular or plural), else None."""
    if t in INSTRUMENTE and t not in KUERZEL:
        return INSTRUMENTE[t]
    if t.endswith("s") and t[:-1] in INSTRUMENTE and t[:-1] not in KUERZEL:
        return INSTRUMENTE[t[:-1]]
    return None


def _kuerzel_im_namen(toks: list[str]) -> str | None:
    """First abbreviation of a file name that is not a device name: `RD-9`, `CR-78`, `MT-32` (a number above 3 right
    behind it) are drum machines; `bd-0`, `Rim 3`, `BD_01` are sample numbers (the starter kits count from 0)."""
    for i, t in enumerate(toks):
        if t in KUERZEL:
            nxt = toks[i + 1] if i + 1 < len(toks) else ""
            if nxt.isdigit() and int(nxt) > 3:
                continue
            return INSTRUMENTE[t]
    return None


def _instrument(rel: str) -> str | None:
    """Spelled-out word in the file name, then in a folder (innermost first), then an abbreviation in the file name, then
    a folder that consists of nothing but the abbreviation (`bd/`, not `SD Card Export/`)."""
    teile = rel.split("/")
    stamm = token(os.path.splitext(teile[-1])[0])
    ordner = list(reversed(teile[:-1]))
    for toks in [stamm, *(token(o) for o in ordner)]:
        for t in toks:
            if (v := _voll(t)):
                return v
    if (v := _kuerzel_im_namen(stamm)):
        return v
    for o in ordner:
        toks = token(o)
        if len(toks) == 1 and toks[0] in KUERZEL:
            return INSTRUMENTE[toks[0]]
    return None


def felder(d: Datei, typ: str, m: Merkmale) -> dict[str, object]:
    teile = d.rel.split("/")
    ordner_rel = teile[:-1]
    stamm = os.path.splitext(teile[-1])[0]
    tags = m.tags
    bpm: float | None = None
    if "bpm" in tags and _bpm_ok(tags["bpm"]):  # old cache entries may hold values that are no longer accepted
        bpm = float(tags["bpm"])
    else:
        bpm = bpm_aus_namen(stamm) or (bpm_aus_namen(ordner_rel[-1]) if ordner_rel else None)
    nur_sample = typ in ("loop", "oneshot")
    z: dict[str, object] = {
        "typ": typ,
        "werk_id": None,
        "sha": m.sha,
        "shas": m.sha,
        "pack": ordner_rel[0] if nur_sample and ordner_rel else None,
        "kategorie": "/".join(ordner_rel[1:]) or None if nur_sample else None,
        "instrument": _instrument(d.rel) if nur_sample else None,
        "bpm": bpm,
        "takte": round(m.dauer_s * bpm / 240, 2) if typ == "loop" and bpm else None,
        "titel": tags.get("title") or stamm,
        "kuenstler": tags.get("artist"),
        "genre": tags.get("genre"),
        "label": tags.get("label"),
        "jahr": tags.get("jahr"),
        "release": tags.get("release"),
        "isrc": tags.get("isrc"),
        "camelot": tags.get("camelot"),
        "name": stamm,
        "ordner": os.path.dirname(str(d.pfad)),
        "pfad": str(d.pfad),
        "dauer_s": m.dauer_s,
    }
    text = ("titel", "kuenstler", "genre", "label", "jahr", "release", "isrc", "pack", "kategorie", "instrument", "name")
    gesehen: list[str] = []
    for k in text:
        v = z[k]
        if isinstance(v, str) and v and v not in gesehen:
            gesehen.append(v)
    z["alle"] = " ".join(gesehen)
    return z
