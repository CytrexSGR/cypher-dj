"""The old source lists: import them into quellen.toml and generate them back out of it.

  media library  wurzeln.toml         every catalog root (typ, laufwerk, the passed-through keys) and [[fern]]
  shelf          sampler/wurzeln.json every shelf root as {name, pfad}
  library        bibliothek.json      catalog roots of art track / loop / oneshot, sample as auto
  kit sources    umgebung.env         CYPHERDJ_KLANG_<X> lines that sound/rollen.json names
"""
from __future__ import annotations

import json
import os
import re
import socket
import tomllib
from pathlib import Path

from .file import Klang, Quellen, QuellenFehler, Wurzel, pfad_fuer, pruefe, schreibe_text, toml_wert, _schluessel

KOPF = "# generated from quellen.toml by djk/quellen, edit quellen.toml"
_WURZEL_FEST = ("pfad", "laufwerk", "typ")
_KLANG_VAR = re.compile(r"\$\{(CYPHERDJ_KLANG_[A-Z0-9_]+)\}")


def _art_aus_typ(typ: str) -> str:
    return "sample" if typ in ("loop_oder_oneshot", "auto") else typ


def _typ_aus_art(art: str) -> str:
    return "loop_oder_oneshot" if art in ("sample", "loop", "oneshot") else art


def _lies_toml(pfad) -> dict:
    try:
        return tomllib.loads(Path(pfad).read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError, UnicodeDecodeError) as e:
        raise QuellenFehler(f"{pfad}: {e}") from e


def _lies_json(pfad):
    try:
        return json.loads(Path(pfad).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise QuellenFehler(f"{pfad}: {e}") from e


def _da(pfad) -> bool:
    return pfad is not None and Path(pfad).is_file()


def _frei(name: str, vergeben: set[str]) -> str:
    name = (name.replace("/", " ").strip() or "root")[:40]
    if name not in vergeben:
        return name
    n = 2
    while f"{name[:37]} {n}" in vergeben:
        n += 1
    return f"{name[:37]} {n}"


def _gleich(a: str, b: str) -> bool:
    return os.path.realpath(a) == os.path.realpath(b)


def importiere(mediathek_toml=None, regal_json=None, bibliothek_json=None, umgebung_env=None, rollen_json=None) -> Quellen:
    """Builds the list from the old files; a missing or None file contributes nothing."""
    q = Quellen()
    namen: set[str] = set()

    def neu(name: str, **kw) -> Wurzel:
        w = Wurzel(name=_frei(name, namen), **kw)
        namen.add(w.name)
        q.wurzeln.append(w)
        return w

    if _da(mediathek_toml):
        d = _lies_toml(mediathek_toml)
        for e in d.get("wurzel", []):
            neu(os.path.basename(e["pfad"].rstrip("/")), art=_art_aus_typ(e.get("typ", "track")), pfad=e["pfad"],
                laufwerk=e.get("laufwerk"), mediathek={k: v for k, v in e.items() if k not in _WURZEL_FEST})
        q.fern = list(d.get("fern", []))
    if _da(bibliothek_json):
        for e in _lies_json(bibliothek_json).get("wurzeln", []):
            if not any(w.pfad and _gleich(w.pfad, e["pfad"]) for w in q.wurzeln):
                neu(os.path.basename(e["pfad"].rstrip("/")), art=_art_aus_typ(e.get("typ", "auto")), pfad=e["pfad"])
    if _da(regal_json):
        for e in _lies_json(regal_json):
            treffer = next((w for w in q.wurzeln if w.pfad and _gleich(w.pfad, e["pfad"])), None)
            if treffer is None or treffer.name != e["name"]:
                belegt_von = next((w for w in q.wurzeln if w.name == e["name"]), None)
                if belegt_von is not None:                 # a derived name gives way to the name the owner chose
                    namen.discard(belegt_von.name)
                    namen.add(e["name"])
                    belegt_von.name = _frei(belegt_von.name, namen)
                    namen.add(belegt_von.name)
                    namen.discard(e["name"])
            if treffer is not None:
                namen.discard(treffer.name)
                treffer.name, treffer.regal = e["name"], True
                namen.add(treffer.name)
            else:
                neu(e["name"], art="sample", pfad=e["pfad"], katalog=False, regal=True)
    if _da(umgebung_env) and _da(rollen_json):
        genannt = set(_KLANG_VAR.findall(json.dumps(_lies_json(rollen_json).get("quellen", {}))))
        for zeile in Path(umgebung_env).read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\s*(CYPHERDJ_KLANG_[A-Z0-9_]+)=(.*)$", zeile)
            if not m or m.group(1) not in genannt:
                continue
            pfad = m.group(2).strip().strip('"').strip("'").rstrip("/")
            if not pfad.startswith("/"):
                continue
            traeger = [w for w in q.wurzeln if w.pfad and (pfad == w.pfad.rstrip("/") or pfad.startswith(w.pfad.rstrip("/") + "/"))]
            w = max(traeger, key=lambda x: len(x.pfad), default=None) or \
                neu(os.path.basename(pfad), art="sample", pfad=pfad, katalog=False)
            q.klang.append(Klang(name=m.group(1)[len("CYPHERDJ_KLANG_"):].lower(), wurzel=w.name,
                                 rel=os.path.relpath(pfad, w.pfad.rstrip("/")) if pfad != w.pfad.rstrip("/") else ""))
    pruefe(q)
    return q


def _mediathek_wurzeln(q: Quellen, host: str) -> list[dict]:
    out = []
    for w in q.wurzeln:
        p = pfad_fuer(w, host)
        if not w.katalog or p is None:
            continue
        e = {"pfad": p}
        if w.laufwerk is not None:
            e["laufwerk"] = w.laufwerk
        e["typ"] = _typ_aus_art(w.art)
        e.update(w.mediathek)
        out.append(e)
    return out


def mediathek_toml(q: Quellen, host: str) -> str:
    z = [KOPF]
    for e in _mediathek_wurzeln(q, host):
        z += ["", "[[wurzel]]"] + [f"{_schluessel(k)} = {toml_wert(v)}" for k, v in e.items()]
    for f in q.fern:
        z += ["", "[[fern]]"] + [f"{_schluessel(k)} = {toml_wert(v)}" for k, v in f.items()]
    return "\n".join(z) + "\n"


def _regal(q: Quellen, host: str) -> list[dict]:
    return [{"name": w.name, "pfad": pfad_fuer(w, host)} for w in q.wurzeln if w.regal and pfad_fuer(w, host)]


def _bibliothek(q: Quellen, host: str) -> dict:
    typ = {"track": "track", "loop": "loop", "oneshot": "oneshot", "sample": "auto"}
    return {"schema": 1, "wurzeln": [{"pfad": pfad_fuer(w, host), "typ": typ[w.art]} for w in q.wurzeln
                                     if w.katalog and w.art in typ and pfad_fuer(w, host)]}


def schreibe_alt(q: Quellen, host: str, ziel_mediathek=None, ziel_regal=None, ziel_bibliothek=None) -> list[str]:
    """Generates the old lists; returns the paths that were written (an unchanged file is not written)."""
    geschrieben = []
    for ziel, text in ((ziel_mediathek, mediathek_toml(q, host)),
                       (ziel_regal, json.dumps(_regal(q, host), indent=2, ensure_ascii=False) + "\n"),
                       (ziel_bibliothek, json.dumps(_bibliothek(q, host), indent=1, ensure_ascii=False) + "\n")):
        if ziel is None:
            continue
        Path(ziel).parent.mkdir(parents=True, exist_ok=True)
        if schreibe_text(ziel, text):
            geschrieben.append(str(ziel))
    return geschrieben


def vergleiche(q: Quellen, mediathek_toml=None, regal_json=None, host: str | None = None) -> list[str]:
    """Differences between the old files and what the list generates; empty means equal."""
    host = host or socket.gethostname()
    diff: list[str] = []
    if mediathek_toml is not None:
        d = _lies_toml(mediathek_toml)
        soll = {e["pfad"]: e for e in _mediathek_wurzeln(q, host)}
        ist = {e["pfad"]: e for e in d.get("wurzel", [])}
        diff += [f"media library: root only in quellen.toml: {p}" for p in soll.keys() - ist.keys()]
        diff += [f"media library: root only in the old list: {p}" for p in ist.keys() - soll.keys()]
        for p in soll.keys() & ist.keys():
            for k in sorted(set(soll[p]) | set(ist[p])):
                if soll[p].get(k) != ist[p].get(k):
                    diff.append(f"media library: {p}: {k} is {ist[p].get(k)!r} in the old list, {soll[p].get(k)!r} from quellen.toml")
        if list(d.get("fern", [])) != q.fern:
            diff.append("media library: the [[fern]] entries differ")
    if regal_json is not None:
        soll_r = {(e["name"], e["pfad"]) for e in _regal(q, host)}
        ist_r = {(e["name"], e["pfad"]) for e in _lies_json(regal_json)}
        diff += [f"shelf: only in quellen.toml: {n} ({p})" for n, p in sorted(soll_r - ist_r)]
        diff += [f"shelf: only in the old list: {n} ({p})" for n, p in sorted(ist_r - soll_r)]
    return sorted(diff)
