#!/usr/bin/env python3
"""djk-umzug: moves one storage kind of cypher-dj from its old place to the new home and leaves a link behind.

  djk-umzug                           dry-run table of every kind
  djk-umzug <art> [--ausfuehren]      move one kind (old place -> home), the old place becomes a link
  djk-umzug zurueck <art> [--ausfuehren]   undo a move
  djk-umzug einrichten [--still]      create missing folders and links (never touches a real old folder)
  djk-umzug heim-anlegen              create the home folder and its marker file .cypherdj-heim (run with the removable disk mounted)
  djk-umzug aufraeumen <art> [--ausfuehren]  delete the kept old copy of a verified cross-device move
  djk-umzug pruefen                   dry run: which projects look like test projects (a suggestion, it decides nothing)
  djk-umzug pruefen --liste DATEI [--ausfuehren]   move exactly the projects of {"slugs": [...]} to {HEIM}/pruefen
  djk-umzug pruefen zurueck (SLUG | --alle) [--ausfuehren]   bring them back into the project list
  djk-umzug modulnamen [--ausfuehren]  rename the module folders <16 hex> to <name>-<4 hex> (dry run without the flag)

Without --ausfuehren nothing on disk changes. Every executed run appends its report to {HEIM}/.umzug/bericht.jsonl.
A running move keeps a journal {HEIM}/.umzug/<art>.json; a journal that is not at "fertig" marks an interrupted move, and
the next run applies exactly one continuation rule (U1..U7, Z1..Z5) or refuses and changes nothing (U7).

A home counts as ready only when it carries the marker file .cypherdj-heim; without it every command refuses (exit 6, "is the disk
mounted?") and writes nothing. The default home ~/cypherdj gets the marker automatically on the first executed run.

Exit codes: 0 ok or nothing to do, 1 I/O error, 2 usage, 3 in use, 4 conflict, 5 verification failed, 6 home not ready.
"""
from __future__ import annotations

import fcntl
import glob
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Callable

try:
    import storage as ablage
except ModuleNotFoundError:  # started without the launcher: the package sits one level up
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import storage as ablage

LINK = ".umzug-link"                # temporary link next to the old place, renamed onto it in the last step
TEIL = ".umzug-teil"                # part copy next to the new place (cross-device move)
ALTKOPIE = ".umzug-alt-"            # kept old copy after a cross-device move, removed by `aufraeumen`
ZURUECK = ".umzug-zurueck"          # the folder on its way back, next to the old place
ZURUECK_TEIL = ".umzug-zurueck-teil"


# ---- small helpers ----------------------------------------------------------------------------------------------------

def _home(env) -> str:
    return (os.environ if env is None else env).get("HOME") or os.path.expanduser("~")


def _echt(p: str) -> bool:
    return os.path.isdir(p) and not os.path.islink(p)


def _nicht_leer(p: str) -> bool:
    try:
        return len(os.listdir(p)) > 0
    except OSError:
        return False


def _link_auf(alt: str, neu: str) -> bool:
    return os.path.islink(alt) and os.path.realpath(alt) == os.path.realpath(neu)


def _vorfahr(p: str) -> str:
    """The nearest existing ancestor of p (p itself when it exists)."""
    while not os.path.exists(p) and os.path.dirname(p) != p:
        p = os.path.dirname(p)
    return p


def _geraet(p) -> int:
    return os.stat(p).st_dev


def _zaehle(wurzel: str) -> tuple[int, int]:
    dateien = groesse = 0
    for d, _dirs, files in os.walk(wurzel):
        for n in files:
            try:
                st = os.lstat(os.path.join(d, n))
            except OSError:
                continue
            dateien += 1
            groesse += st.st_size
    return dateien, groesse


def _stempel() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def _sha(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _eintraege(wurzel: str) -> dict[str, tuple]:
    out: dict[str, tuple] = {}
    for d, dirs, files in os.walk(wurzel):
        for n in dirs + files:
            p = os.path.join(d, n)
            rel = os.path.relpath(p, wurzel)
            st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode):
                out[rel] = ("link", os.readlink(p))
            elif stat.S_ISDIR(st.st_mode):
                out[rel] = ("ordner",)
            elif stat.S_ISREG(st.st_mode):
                out[rel] = ("datei", st.st_size)
            else:
                out[rel] = ("sonst",)
    return out


def manifest(wurzel: str) -> dict[str, list]:
    """Every entry below wurzel: kind, size or link target, and for regular files the sha256."""
    return {rel: [*e, _sha(os.path.join(wurzel, rel))] if e[0] == "datei" else list(e)
            for rel, e in _eintraege(wurzel).items()}


def _unterschiede(a: dict, b: dict) -> list[str]:
    diff = [f"only in the source: {r}" for r in sorted(a.keys() - b.keys())]
    diff += [f"only in the copy: {r}" for r in sorted(b.keys() - a.keys())]
    for r in sorted(a.keys() & b.keys()):
        if list(a[r][:2]) != list(b[r][:2]):
            diff.append(f"differs: {r}")
        elif list(a[r][:3]) != list(b[r][:3]):                          # a stored manifest carries the mtime as a 4th value
            diff.append(f"content differs: {r}")
    return diff


def vergleiche(quelle: str, kopie: str) -> list[str]:
    """Differences between two trees: entry list incl. links, sizes, sha256 of every regular file. Empty means equal."""
    return _unterschiede(manifest(quelle), manifest(kopie))


def _links_nach_aussen(wurzel: str) -> list[str]:
    """Relative links that leave the tree: they break when the tree moves (absolute links keep working)."""
    wurzel = os.path.abspath(wurzel)
    out = []
    for rel, e in _eintraege(wurzel).items():
        if e[0] == "link" and not os.path.isabs(e[1]):
            ziel = os.path.normpath(os.path.join(os.path.dirname(os.path.join(wurzel, rel)), e[1]))
            if ziel != wurzel and not ziel.startswith(wurzel + os.sep):
                out.append(rel)
    return sorted(out)


# ---- home guard, journal, report -----------------------------------------------------------------------------------------

MARKER = ".cypherdj-heim"           # a home counts as ready only when it carries this file (written by djk-umzug)


def _standard_heim(env) -> bool:
    return str(ablage.heim(env)) == os.path.join(_home(env).rstrip("/"), "cypherdj")


def heim_bereit(env=None, schreiben: bool = False) -> str | None:
    """None when the home may be used, else the refusal text. Only a home with the marker file counts as ready, so an
    unmounted mount point (empty or not) is never mistaken for it. The default home {HOME}/cypherdj lives on the internal
    disk and is adopted without the marker (one-time migration): with schreiben=True the marker is written then."""
    h = ablage.heim(env)
    if h.is_symlink() and not h.exists():
        return f"CYPHERDJ_HEIM ({h}) is a link that leads nowhere: is the disk mounted?"
    if (h / MARKER).is_file():
        return None
    if _standard_heim(env) and (h.is_dir() or not h.exists()):
        if schreiben:
            _schreibe_marker(h)
        return None
    return (f"CYPHERDJ_HEIM ({h}) has no marker file {MARKER}: is the disk mounted? "
            "With the disk mounted, `djk-umzug heim-anlegen` creates the home and the marker. Nothing was written.")


def _schreibe_marker(h: Path) -> None:
    h.mkdir(parents=True, exist_ok=True)
    m = h / MARKER
    if not m.exists():
        m.write_text("cypherdj home, written by djk-umzug\n", encoding="utf-8")


def heim_anlegen(env=None) -> dict:
    """Creates the home folder and its marker. The one deliberate step for a home on a removable disk: run it with the disk mounted."""
    b = _bericht(None, "heim-anlegen", None, ausgefuehrt=True)
    h = ablage.heim(env)
    if h.is_symlink() and not h.exists():
        _ablehnen(b, f"CYPHERDJ_HEIM ({h}) is a link that leads nowhere: is the disk mounted?", 6)
        return b
    if h.exists() and not h.is_dir():
        _ablehnen(b, f"CYPHERDJ_HEIM ({h}) exists and is not a folder", 4)
        return b
    _schreibe_marker(h)
    b["ergebnis"] = "ok"
    b["neu"] = str(h)
    return b


def _journal_pfad(art: str, env) -> Path:
    return ablage.heim(env) / ".umzug" / f"{art}.json"


def _lies_journal(art: str, env) -> dict | None:
    try:
        return json.loads(_journal_pfad(art, env).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _setze_journal(art: str, env, inhalt: dict | None) -> None:
    p = _journal_pfad(art, env)
    if inhalt is None:
        try:
            p.unlink()
        except FileNotFoundError:
            pass
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(inhalt, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, p)
    fd = os.open(p.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _manifest_pfad(art: str, env, stempel: str | None = None) -> Path:
    """The manifest of the latest move, or (with a stamp) the one kept for the old copy `<alt>.umzug-alt-<stamp>`."""
    return ablage.heim(env) / ".umzug" / (f"{art}.manifest.json" if stempel is None else f"{art}.manifest-{stempel}.json")


def _schreibe_manifest(art: str, env, m: dict, quelle: str) -> None:
    """Stores what was copied, with the mtime of every file: cleanup uses it to tell an untouched file from a changed one."""
    m = {r: [*e, os.lstat(os.path.join(quelle, r)).st_mtime_ns] if e[0] == "datei" else e for r, e in m.items()}
    p = _manifest_pfad(art, env)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, p)


def _manifest_zur_kopie(art: str, env, stempel: str) -> None:
    """Keeps the manifest of the move that made the old copy `stempel`: a later move overwrites the plain manifest, and two old copies
    (there, back, there across disks) must each be checked against what was copied into them."""
    try:
        shutil.copyfile(_manifest_pfad(art, env), _manifest_pfad(art, env, stempel))
    except OSError:
        pass                                                             # cleanup then falls back to the plain manifest (newest copy only)


def _lies_manifest(art: str, env, stempel: str | None = None) -> dict | None:
    try:
        return json.loads(_manifest_pfad(art, env, stempel).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _journal(art: str, env, **felder) -> None:
    j = _lies_journal(art, env) or {"art": art}
    j.update(felder, zeit=time.strftime("%Y-%m-%dT%H:%M:%S"))
    _setze_journal(art, env, j)


def _bericht(art, aktion: str, o: dict | None, **kw) -> dict:
    b = {"art": art, "aktion": aktion, "modus": None, "alt": o["alt"] if o else None, "neu": o["neu"] if o else None,
         "dateien": 0, "bytes": 0, "dauer_s": 0.0, "ergebnis": "nichts", "grund": None, "regel": None,
         "ausgefuehrt": False, "code": 0}
    b.update(kw)
    return b


def _haenge_an(b: dict, env) -> None:
    p = ablage.heim(env) / ".umzug" / "bericht.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps({"zeit": time.strftime("%Y-%m-%dT%H:%M:%S"), **b}, ensure_ascii=False) + "\n")


# ---- state and in-use check -----------------------------------------------------------------------------------------------

def zustand(art: str, env=None) -> str:
    return _zustand_von(ablage.orte(art, env), art, env)


def _zustand_von(o: dict, art: str, env) -> str:
    """art is the journal name: a storage kind, or pruefen-<slug> for one project."""
    alt, neu = o["alt"], o["neu"]
    j = _lies_journal(art, env)
    if j is not None and j.get("schritt") != "fertig":
        return "unterbrochen"
    if os.path.islink(alt):
        return "umgezogen" if _link_auf(alt, neu) and os.path.isdir(neu) else "fremder_link"
    if os.path.isdir(alt):
        return "beide" if _nicht_leer(neu) else "alt"
    if os.path.lexists(alt):
        return "fremder_link"
    return "nur_neu" if os.path.isdir(neu) else "neu_installiert"


def aktive_einheiten() -> list[str]:
    """Running cypherdj units. When systemd cannot be asked the answer is one "unknown" entry: the caller must treat
    that as in use, never as free. A machine without systemctl has no units."""
    try:
        r = subprocess.run(["systemctl", "--user", "list-units", "cypherdj*", "--state=active,activating,reloading",
                            "--no-legend", "--plain"], capture_output=True, text=True, timeout=10, check=False)
    except FileNotFoundError:
        return []
    except (OSError, subprocess.SubprocessError) as e:
        return [f"unknown (systemctl: {type(e).__name__})"]
    if r.returncode != 0:
        return [f"unknown (systemctl exit {r.returncode}: {r.stderr.strip()[:80]})"]
    return [z.split()[0] for z in r.stdout.splitlines() if z.split()]


def belegt(ordner: Path, proc: Path = Path("/proc"), einheiten: Callable[[], list[str]] = aktive_einheiten) -> list[str]:
    """Reasons why the folder must not be moved now: active cypherdj units, processes with their cwd or an open file in it."""
    gruende = [f"einheit {n}" for n in einheiten()]
    wurzel = os.path.realpath(ordner)
    if not os.path.isdir(wurzel):
        return gruende
    praefix = wurzel + os.sep
    ich = os.getpid()
    for e in sorted((x for x in proc.iterdir() if x.name.isdigit()), key=lambda x: int(x.name)):
        if int(e.name) == ich:
            continue
        ziele: list[str] = []
        try:
            ziele.append(os.readlink(e / "cwd"))
        except OSError:
            pass
        try:
            for fd in os.listdir(e / "fd"):
                try:
                    ziele.append(os.readlink(e / "fd" / fd))
                except OSError:
                    pass
        except OSError:
            pass
        if any(z == wurzel or z.startswith(praefix) for z in ziele):
            try:
                comm = (e / "comm").read_text(encoding="utf-8", errors="replace").strip()
            except OSError:
                comm = "?"
            gruende.append(f"prozess {e.name} {comm}")
    return gruende


# ---- the move (old place -> home) ----------------------------------------------------------------------------------------

def _ablehnen(b: dict, grund: str, code: int, **kw) -> None:
    b.update(ergebnis="abgelehnt", grund=grund, code=code, **kw)


def _starte_hin(b: dict, o: dict, art: str, ausfuehren: bool, g, env) -> None:
    alt, neu = o["alt"], o["neu"]
    b["dateien"], b["bytes"] = _zaehle(alt)
    eltern = os.path.dirname(neu)
    gleich = g.geraet(alt) == g.geraet(_vorfahr(eltern))
    b["modus"] = "rename" if gleich else "kopie"
    aussen = _links_nach_aussen(alt)
    if aussen:
        b["links_nach_aussen"] = aussen[:20]                             # a warning: these relative links will break
    gruende = g.belegt(Path(alt))
    if gruende:
        return _ablehnen(b, "; ".join(gruende), 3)
    if not gleich:
        sonder = sorted(r for r, e in _eintraege(alt).items() if e[0] == "sonst")
        if sonder:
            return _ablehnen(b, "special files (fifo, socket, device) cannot be copied to another disk: " + ", ".join(sonder[:5]), 4)
    if not ausfuehren:
        b["ergebnis"] = "ok"
        return
    os.makedirs(eltern, exist_ok=True)                                   # s1: parents first, before anything at alt
    if os.path.isdir(neu) and not os.listdir(neu):
        os.rmdir(neu)
    _journal(art, env, richtung="hin", schritt="begonnen", modus=b["modus"], alt=alt, neu=neu)
    if gleich:
        tmp = alt + LINK
        if os.path.lexists(tmp):
            os.unlink(tmp)
        g.verlinke(neu, tmp)                                             # s2
        g.umbenennen(alt, neu)                                           # s3
        _journal(art, env, schritt="verschoben")
        _s4(b, o, art, env)
        return
    teil = neu + TEIL
    try:
        g.kopiere(alt, teil, symlinks=True)                              # s2c
    except OSError as e:
        shutil.rmtree(teil, ignore_errors=True)
        _setze_journal(art, env, None)                                   # nothing happened at alt: no interrupted move
        b.update(ergebnis="fehler", grund=f"the copy failed: {type(e).__name__}: {e}"[:400], code=1)
        return
    os.sync()                                                            # the copy is on the disk before it is trusted
    m = manifest(alt)
    diff = _unterschiede(m, manifest(teil))
    if diff:
        shutil.rmtree(teil)
        _setze_journal(art, env, None)
        b.update(ergebnis="fehler", grund="the copy differs from the source: " + "; ".join(diff[:5]), code=5)
        return
    _schreibe_manifest(art, env, m, alt)                                 # what the old copy must still look like at cleanup
    g.umbenennen(teil, neu)                                              # s3c
    _journal(art, env, schritt="kopiert")
    _s4c(b, o, art, g, env)


def _s4(b: dict, o: dict, art: str, env) -> None:
    os.replace(o["alt"] + LINK, o["alt"])
    _journal(art, env, schritt="fertig")
    b["ergebnis"] = "ok"


def _s4c(b: dict, o: dict, art: str, g, env) -> None:
    gruende = g.belegt(Path(o["alt"]))                                   # again: the copy and its check took time
    if gruende:                                                          # the journal stays at "kopiert": rule U5 verifies again
        return _ablehnen(b, "; ".join(gruende), 3)
    st = _stempel()
    g.umbenennen(o["alt"], o["alt"] + ALTKOPIE + st)
    _manifest_zur_kopie(art, env, st)
    _journal(art, env, schritt="verschoben")
    _s5c(b, o, art, g, env)


def _s5c(b: dict, o: dict, art: str, g, env) -> None:
    tmp = o["alt"] + LINK
    if os.path.lexists(tmp):
        os.unlink(tmp)
    g.verlinke(o["neu"], tmp)
    _s4(b, o, art, env)


def _hin(b: dict, o: dict, art: str, z: str, ausfuehren: bool, g, env) -> None:
    if z == "umgezogen":
        b["grund"] = "already moved"
    elif z in ("neu_installiert", "nur_neu"):
        b["grund"] = "no old folder to move"
    elif z == "fremder_link":
        _ablehnen(b, f"fremder_link: {o['alt']} is a link or a file that does not lead to {o['neu']}", 4)
    elif z == "beide":
        _ablehnen(b, f"beide: {o['alt']} is a real folder and {o['neu']} is not empty", 4)
    else:
        _starte_hin(b, o, art, ausfuehren, g, env)


# ---- the way back ---------------------------------------------------------------------------------------------------------

def _starte_zurueck(b: dict, o: dict, art: str, ausfuehren: bool, g, env) -> None:
    alt, neu = o["alt"], o["neu"]
    b["dateien"], b["bytes"] = _zaehle(neu)
    gleich = g.geraet(neu) == g.geraet(os.path.dirname(alt))
    b["modus"] = "rename" if gleich else "kopie"
    gruende = g.belegt(Path(alt))
    if gruende:
        return _ablehnen(b, "; ".join(gruende), 3)
    if not ausfuehren:
        b["ergebnis"] = "ok"
        return
    vorher = _lies_journal(art, env)
    _journal(art, env, richtung="zurueck", schritt="begonnen", modus=b["modus"], alt=alt, neu=neu)
    r = alt + ZURUECK
    if gleich:
        g.umbenennen(neu, r)                                             # r1
    else:
        rt = alt + ZURUECK_TEIL
        g.kopiere(neu, rt, symlinks=True)
        diff = vergleiche(neu, rt)
        if diff:
            shutil.rmtree(rt)
            _setze_journal(art, env, vorher)
            b.update(ergebnis="fehler", grund="the copy differs from the source: " + "; ".join(diff[:5]), code=5)
            return
        g.umbenennen(rt, r)
        _neu_beiseite(b, o, g)
    _journal(art, env, schritt="verschoben")
    _r2_r3(b, o, art, g, env)


def _neu_beiseite(b: dict, o: dict, g) -> None:
    rest = o["neu"] + ALTKOPIE + _stempel()                              # the copy at the home stays, set aside
    g.umbenennen(o["neu"], rest)
    b["rest"] = rest


def _r2_r3(b: dict, o: dict, art: str, g, env) -> None:
    if os.path.islink(o["alt"]):
        os.unlink(o["alt"])                                              # r2
    g.umbenennen(o["alt"] + ZURUECK, o["alt"])                           # r3
    _journal(art, env, schritt="fertig")
    b["ergebnis"] = "ok"


def _zurueck(b: dict, o: dict, art: str, z: str, ausfuehren: bool, g, env) -> None:
    if z == "umgezogen":
        _starte_zurueck(b, o, art, ausfuehren, g, env)
    elif z in ("alt", "neu_installiert", "nur_neu"):
        b["grund"] = "not moved, nothing to undo"
    elif z == "fremder_link":
        _ablehnen(b, f"fremder_link: {o['alt']} is a link or a file that does not lead to {o['neu']}", 4)
    else:
        _ablehnen(b, f"beide: {o['alt']} is a real folder and {o['neu']} is not empty", 4)


# ---- continuation after an abort -----------------------------------------------------------------------------------------

def _setze_fort(b: dict, o: dict, art: str, ausfuehren: bool, g, env) -> None:
    alt, neu = o["alt"], o["neu"]
    j = _lies_journal(art, env) or {}
    richtung, schritt = j.get("richtung"), j.get("schritt")
    b.update(aktion="fortsetzung", modus=j.get("modus"))
    a = "link" if _link_auf(alt, neu) else "echt" if _echt(alt) else "fehlt" if not os.path.lexists(alt) else "fremd"
    n = "echt" if _echt(neu) else "fehlt" if not os.path.lexists(neu) else "fremd"
    link, teil = os.path.lexists(alt + LINK), os.path.lexists(neu + TEIL)
    kopien = sorted(glob.glob(glob.escape(alt + ALTKOPIE) + "*"))
    rueck, rueck_teil = _echt(alt + ZURUECK), os.path.lexists(alt + ZURUECK_TEIL)
    eintraege = {"journal": f"{richtung}/{schritt}", "alt": a, "neu": n, "umzug_link": link, "umzug_teil": teil,
                 "umzug_alt": len(kopien), "umzug_zurueck": rueck, "umzug_zurueck_teil": rueck_teil}
    regel = "U7"
    if a == "link" and n == "echt" and not (link or teil or rueck or rueck_teil):
        regel = "U3"
    elif richtung == "hin" and not (rueck or rueck_teil):
        if schritt == "begonnen" and a == "echt" and n == "fehlt" and not teil:
            regel = "U1"
        elif schritt == "begonnen" and a == "echt" and n == "fehlt" and teil and not link:
            regel = "U4"
        elif schritt in ("begonnen", "kopiert", "verschoben") and a == "fehlt" and n == "echt" and link and not teil:
            regel = "U2"                                                 # "kopiert": a second crash, inside rule U6
        elif schritt in ("begonnen", "kopiert") and j.get("modus") == "kopie" and a == "echt" and n == "echt" \
                and not (link or teil):
            regel = "U5"                                                 # "begonnen": the crash came right after s3c
        elif schritt in ("kopiert", "verschoben") and a == "fehlt" and n == "echt" and kopien and not (link or teil):
            regel = "U6"                                                 # "kopiert": the crash came right after s4c
    elif richtung == "zurueck" and not (link or teil):
        if schritt in ("begonnen", "verschoben") and a == "link" and n == "fehlt" and rueck and not rueck_teil:
            regel = "Z1"
        elif schritt == "verschoben" and a == "fehlt" and n == "fehlt" and rueck and not rueck_teil:
            regel = "Z2"
        elif schritt == "begonnen" and a == "link" and n == "echt" and rueck_teil and not rueck:
            regel = "Z3"
        elif schritt == "verschoben" and a == "echt" and n == "fehlt" and not (rueck or rueck_teil):
            regel = "Z4"                                                 # the crash came right after r3: all is back
        elif schritt == "begonnen" and a == "link" and n == "echt" and rueck and not rueck_teil:
            regel = "Z5"                                                 # cross device: copied back, the home not yet set aside
    b["regel"] = regel
    if regel == "U7":
        hinweis = (f"Nothing was changed. The entries show what exists at {alt} and {neu}. By hand: make sure the data is "
                   f"complete in one of them (a real folder at the old place, or the new place with the old one as a link to "
                   f"it), remove leftover *.umzug-* entries you have checked, then delete {_journal_pfad(art, env)}.")
        return _ablehnen(b, "unterbrochen_unklar", 4, eintraege=eintraege, hinweis=hinweis)
    gruende = g.belegt(Path(alt))
    if gruende:
        return _ablehnen(b, "; ".join(gruende), 3)
    if not ausfuehren:
        b["ergebnis"] = "ok"
        return
    if regel == "U1":
        if link:
            os.unlink(alt + LINK)
        _starte_hin(b, o, art, True, g, env)
    elif regel == "U4":
        shutil.rmtree(neu + TEIL)
        _starte_hin(b, o, art, True, g, env)
    elif regel == "U2":
        _s4(b, o, art, env)
    elif regel == "U3":
        _journal(art, env, schritt="fertig")
        b["ergebnis"] = "ok"
    elif regel == "U5":
        m = manifest(alt)
        diff = _unterschiede(m, manifest(neu))
        if diff:                                                         # the old place went on after the copy: the copy is stale
            shutil.rmtree(neu)                                           # neu is only the copy here (alt is real, no link yet)
            b["verworfen"] = diff[:5]
            _starte_hin(b, o, art, True, g, env)
        else:
            _schreibe_manifest(art, env, m, alt)
            _journal(art, env, schritt="kopiert")
            _s4c(b, o, art, g, env)
    elif regel == "U6":
        _s5c(b, o, art, g, env)
    elif regel in ("Z1", "Z2"):
        _journal(art, env, schritt="verschoben")                         # before r2, so a second crash finds rule Z2 or Z4
        _r2_r3(b, o, art, g, env)
    elif regel == "Z4":
        _journal(art, env, schritt="fertig")
        b["ergebnis"] = "ok"
    elif regel == "Z5":
        diff = vergleiche(neu, alt + ZURUECK)
        if diff:                                                         # the new place went on after the copy back: copy again
            shutil.rmtree(alt + ZURUECK)                                 # only the copy; the data is at neu, alt links to it
            b["verworfen"] = diff[:5]
            _setze_journal(art, env, {**j, "schritt": "fertig"})
            _starte_zurueck(b, o, art, True, g, env)
        else:
            _neu_beiseite(b, o, g)
            _journal(art, env, schritt="verschoben")
            _r2_r3(b, o, art, g, env)
    elif regel == "Z3":
        shutil.rmtree(alt + ZURUECK_TEIL)
        _setze_journal(art, env, {**j, "schritt": "fertig"})             # back to "moved", then start the way back again
        _starte_zurueck(b, o, art, True, g, env)


# ---- public functions ------------------------------------------------------------------------------------------------------

def _lauf(art: str, richtung: str, ausfuehren: bool, g, env, o: dict | None = None) -> dict:
    t0 = time.monotonic()
    o = o or ablage.orte(art, env)
    b = _bericht(art, "umzug" if richtung == "hin" else "zurueck", o, ausgefuehrt=bool(ausfuehren))
    grund = heim_bereit(env, bool(ausfuehren))
    if grund:
        _ablehnen(b, grund, 6)
        return b
    sperre = None
    if ausfuehren:                                                       # one executed run at a time
        ordner = ablage.heim(env) / ".umzug"
        ordner.mkdir(parents=True, exist_ok=True)
        sperre = open(ordner / "sperre", "w", encoding="utf-8")
        try:
            fcntl.flock(sperre, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            sperre.close()
            _ablehnen(b, "another djk-umzug run is working", 3)
            return b
    try:
        z = _zustand_von(o, art, env)
        if z == "unterbrochen":
            _setze_fort(b, o, art, ausfuehren, g, env)
        elif richtung == "hin":
            _hin(b, o, art, z, ausfuehren, g, env)
        else:
            _zurueck(b, o, art, z, ausfuehren, g, env)
    except OSError as e:                                                 # the journal stays: the next run continues
        b.update(ergebnis="fehler", grund=f"{type(e).__name__}: {e}", code=1)
    finally:
        if sperre is not None:
            sperre.close()
    b["dauer_s"] = round(time.monotonic() - t0, 3)
    if ausfuehren:
        _haenge_an(b, env)
    return b


def ziehe_um(art: str, ausfuehren: bool, umbenennen=os.rename, verlinke=os.symlink, kopiere=shutil.copytree,
             geraet=_geraet, belegt=belegt, env=None) -> dict:
    g = SimpleNamespace(umbenennen=umbenennen, verlinke=verlinke, kopiere=kopiere, geraet=geraet, belegt=belegt)
    return _lauf(art, "hin", ausfuehren, g, env)


def zurueck(art: str, ausfuehren: bool, umbenennen=os.rename, verlinke=os.symlink, kopiere=shutil.copytree,
            geraet=_geraet, belegt=belegt, env=None) -> dict:
    g = SimpleNamespace(umbenennen=umbenennen, verlinke=verlinke, kopiere=kopiere, geraet=geraet, belegt=belegt)
    return _lauf(art, "zurueck", ausfuehren, g, env)


# ---- test projects: out of the project list, into {HEIM}/pruefen -------------------------------------------------------

_R1 = re.compile(r"^(hoer[a-z]*|[a-z]*probe|abnahme|vergleich)$")
_R2 = re.compile(r"^[0-9]+-[0-9]+-")
_R3 = re.compile(r"^(?!v[0-9])[a-z]{1,2}[0-9]{1,2}$")
_SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def pruefen_vorschlag(slug: str) -> str | None:
    """Which rule makes a slug look like a test project. A suggestion for the dry run only: it also matches real
    projects (a slug with a device name or a date), so nothing is ever moved because of it."""
    teile = slug.split("-")
    if any(_R1.match(t) for t in teile):
        return "R1"
    if _R2.match(slug):
        return "R2"
    if any(_R3.match(t) for t in teile):
        return "R3"
    return None


def _projekt_orte(slug: str, env) -> dict:
    projekte = os.path.realpath(ablage.ordner("projekte", env))
    return {"alt": os.path.join(projekte, slug), "neu": str(ablage.fest("pruefen", env) / slug), "env": None, "kern": False}


def _projekt_lauf(slug: str, richtung: str, ausfuehren: bool, g, env) -> dict:
    name = f"pruefen-{slug}"
    if not _SLUG.match(slug) or ".umzug-" in slug:
        b = _bericht(name, "umzug" if richtung == "hin" else "zurueck", None, ausgefuehrt=bool(ausfuehren), slug=slug)
        _ablehnen(b, f"not a project name: {slug}", 4)
        return b
    o = _projekt_orte(slug, env)
    z = _zustand_von(o, name, env) if heim_bereit(env) is None else None
    if z in ("neu_installiert", "nur_neu") and richtung == "hin":
        b = _bericht(name, "umzug", o, ausgefuehrt=bool(ausfuehren))
        _ablehnen(b, f"unknown project: {slug}", 4)
    else:
        b = _lauf(name, richtung, ausfuehren, g, env, o)
    b.update(slug=slug, vorschlag=pruefen_vorschlag(slug))
    return b


def pruefen(slugs: list[str], ausfuehren: bool, umbenennen=os.rename, verlinke=os.symlink, kopiere=shutil.copytree,
            geraet=_geraet, belegt=belegt, env=None) -> list[dict]:
    """Moves exactly the listed projects to {HEIM}/pruefen and leaves a link in the project folder."""
    g = SimpleNamespace(umbenennen=umbenennen, verlinke=verlinke, kopiere=kopiere, geraet=geraet, belegt=belegt)
    return [_projekt_lauf(s, "hin", ausfuehren, g, env) for s in slugs]


def pruefen_zurueck(slugs: list[str] | None, ausfuehren: bool, umbenennen=os.rename, verlinke=os.symlink,
                    kopiere=shutil.copytree, geraet=_geraet, belegt=belegt, env=None) -> list[dict]:
    """Brings projects back into the project list; slugs None means every project in {HEIM}/pruefen."""
    g = SimpleNamespace(umbenennen=umbenennen, verlinke=verlinke, kopiere=kopiere, geraet=geraet, belegt=belegt)
    if slugs is None:
        ordner = ablage.fest("pruefen", env)
        slugs = sorted(e.name for e in ordner.iterdir() if e.is_dir() and _SLUG.match(e.name) and ".umzug-" not in e.name) \
            if ordner.is_dir() else []
    return [_projekt_lauf(s, "zurueck", ausfuehren, g, env) for s in slugs]


def _lege_link(alt: str, neu: str) -> None:
    os.makedirs(os.path.dirname(alt), exist_ok=True)
    os.symlink(neu, alt)


def einrichten(env=None) -> list[dict]:
    """Creates missing folders and links. Allowed while units run; a real old folder is never touched."""
    grund = heim_bereit(env, True)
    if grund:
        return [_bericht(None, "einrichten", None, ergebnis="abgelehnt", grund=grund, code=6, ausgefuehrt=True)]
    out = []
    for art in ablage.arten():
        o = ablage.orte(art, env)
        alt, neu = o["alt"], o["neu"]
        z = zustand(art, env)
        b = _bericht(art, "einrichten", o, ausgefuehrt=True)
        if z == "neu_installiert":
            os.makedirs(neu, exist_ok=True)
            if o["kern"]:
                _lege_link(alt, neu)
            b["ergebnis"] = "ok"
        elif z == "nur_neu":
            # A mirrored werke/ folder: the link keeps a later run from creating a real old folder next to it. An empty
            # new folder of a non-core kind is the state this command itself leaves on a fresh install: nothing to do.
            if o["kern"] or _nicht_leer(neu):
                _lege_link(alt, neu)
                b["ergebnis"] = "ok"
        elif z == "beide":
            print(f"{art}: both {alt} and {neu} exist; staying at the old place", file=sys.stderr)
            b.update(ergebnis="abgelehnt", grund="beide")
        elif z in ("fremder_link", "unterbrochen"):
            print(f"{art}: {z} at {alt}; nothing changed", file=sys.stderr)
            b["grund"] = z
        out.append(b)
        if b["ergebnis"] != "nichts":
            _haenge_an(b, env)
    return out


def _unberuehrt_aber_anders(m: dict, neu: str) -> list[str]:
    """Files at the new place that still carry the mtime of the copy (within 2 s, coarse file systems) but not its content.
    A file the owner changed after the move has a newer mtime and is fine."""
    out = []
    for rel, e in sorted(m.items()):
        if e[0] != "datei" or len(e) < 4:
            continue
        p = os.path.join(neu, rel)
        try:
            st = os.lstat(p)
        except OSError:
            continue
        if abs(st.st_mtime_ns - e[3]) <= 2_000_000_000 and (st.st_size != e[1] or not stat.S_ISREG(st.st_mode) or _sha(p) != e[2]):
            out.append(rel)
    return out


def aufraeumen(art: str, ausfuehren: bool, env=None) -> dict:
    """Deletes the kept old copy of a cross-device move, only when the old place is the finished link to the new one."""
    o = ablage.orte(art, env)
    b = _bericht(art, "aufraeumen", o, ausgefuehrt=bool(ausfuehren))
    grund = heim_bereit(env, bool(ausfuehren))
    if grund:
        _ablehnen(b, grund, 6)
        return b
    kopien = sorted(glob.glob(glob.escape(o["alt"] + ALTKOPIE) + "*"))
    if not kopien:
        b["grund"] = "no old copy"
        return b
    j = _lies_journal(art, env)
    # every old copy is checked against the manifest of its own move; the plain manifest is the latest move's and fits the newest copy only
    mk = {k: _lies_manifest(art, env, k.rsplit(ALTKOPIE, 1)[1]) or (_lies_manifest(art, env) if k == kopien[-1] else None) for k in kopien}
    ohne = [k for k in kopien if mk[k] is None]
    geaendert = [k for k in kopien if mk[k] is None or not os.path.isdir(k) or os.path.islink(k) or _unterschiede(mk[k], manifest(k))]
    fehlend = sorted({r for k in kopien for r, e in (mk[k] or {}).items() if e[0] == "datei" and not os.path.lexists(os.path.join(o["neu"], r))})
    beschaedigt = [] if fehlend or geaendert else sorted({r for k in kopien for r in _unberuehrt_aber_anders(mk[k] or {}, o["neu"])})
    if not (_link_auf(o["alt"], o["neu"]) and os.path.isdir(o["neu"]) and j and j.get("schritt") == "fertig"):
        _ablehnen(b, f"the old copy stays: {o['alt']} is not the finished link to {o['neu']}", 4)
    elif ohne:
        _ablehnen(b, "the old copy stays: there is no record of what was copied (check and delete it by hand)", 4)
    elif geaendert:
        _ablehnen(b, "the old copy stays: it is not what was copied and may hold newer data: " + ", ".join(geaendert[:3]), 5)
    elif fehlend:
        _ablehnen(b, "the old copy stays: files of it are missing at the new place: " + ", ".join(fehlend[:5]), 5)
    elif beschaedigt:
        _ablehnen(b, "the old copy stays: files at the new place were not changed since the move but differ from what was "
                     "copied: " + ", ".join(beschaedigt[:5]), 5)
    else:
        for k in kopien:
            d, n = _zaehle(k)
            b["dateien"] += d
            b["bytes"] += n
            if ausfuehren:
                shutil.rmtree(k)
        b.update(ergebnis="ok", kopien=kopien)
    if ausfuehren:
        _haenge_an(b, env)
    return b


# ---- readable module folder names --------------------------------------------------------------------------------------------

_MODUL_ID = re.compile(r"^[0-9a-f]{16}$")


def modul_ordnername(titel: str, slot: str | None, id_: str, lang: bool = False) -> str:
    """The folder name of a module (same rule as modulOrdnerName in djk/ui/project/module_storage.ts, vectors in
    docs/interfaces/modul_ordner_namen.json); lang takes 8 id characters, used when the short name belongs to another module."""
    name = ablage.lesbarer_name(titel or "") or "modul"
    if slot in ("A", "B"):
        name += f"-{slot.lower()}"
    return f"{name}-{id_[:8 if lang else 4]}"


def _modul_json(ordner: str) -> dict | None:
    try:
        with open(os.path.join(ordner, "modul.json"), encoding="utf-8") as f:
            j = json.load(f)
    except (OSError, ValueError):
        return None
    return j if isinstance(j, dict) else None


def _modul_titel(j: dict) -> str:
    h = j.get("herkunft")
    t = h.get("titel") if isinstance(h, dict) else None
    if isinstance(t, str):
        return t
    g = j.get("gruppen")
    n = g[0].get("name") if isinstance(g, list) and g and isinstance(g[0], dict) else None
    return n if isinstance(n, str) else ""


def modulnamen(ausfuehren: bool, belegt=belegt, env=None) -> dict:
    """Renames every module folder that still carries its bare 16-hex id. Folders under any other name are left alone;
    the module id inside modul.json stays the reference, so nothing that points at a module changes."""
    o = ablage.orte("module", env)
    b = _bericht("module", "modulnamen", o, ausgefuehrt=bool(ausfuehren), umbenennungen=[])
    b["modus"] = "rename"
    grund = heim_bereit(env, bool(ausfuehren))
    if grund:
        _ablehnen(b, grund, 6)
        return b
    basis = os.path.realpath(ablage.ordner("module", env))
    b["alt"] = basis
    namen = sorted(e for e in os.listdir(basis)) if os.path.isdir(basis) else []
    belegte = set(namen)
    plan = []
    for n in namen:
        pfad = os.path.join(basis, n)
        if not _MODUL_ID.match(n) or os.path.islink(pfad) or not os.path.isdir(pfad):
            continue
        j = _modul_json(pfad)
        if not j or j.get("id") != n:
            continue
        slot = j.get("slot")
        ziel = modul_ordnername(_modul_titel(j), slot if isinstance(slot, str) else None, n)
        if ziel in belegte:
            ziel = modul_ordnername(_modul_titel(j), slot if isinstance(slot, str) else None, n, lang=True)
        if ziel in belegte:
            _ablehnen(b, f"no free name for module {n}: {ziel} exists", 4)
            return b
        belegte.add(ziel)
        plan.append((n, ziel))
    b["umbenennungen"] = [{"von": v, "nach": z} for v, z in plan]
    b["dateien"] = len(plan)
    if not plan:
        return b
    if ausfuehren:
        gruende = belegt(Path(basis))
        if gruende:
            _ablehnen(b, "; ".join(gruende), 3)
            return b
        for v, z in plan:                                                # one atomic rename per folder; a rerun finds the rest
            os.rename(os.path.join(basis, v), os.path.join(basis, z))
        _haenge_an(b | {"ergebnis": "ok"}, env)
    b["ergebnis"] = "ok"
    return b


# ---- command line ----------------------------------------------------------------------------------------------------------

SCHALTER = {"--ausfuehren", "--still"}


def _zeige(b: dict) -> int:
    print(json.dumps(b, ensure_ascii=False))
    return int(b.get("code", 0))


def _tabelle(inj: dict) -> int:
    grund = heim_bereit()
    if grund:
        print(f"djk-umzug: {grund}", file=sys.stderr)
        return 6
    frei = {**inj, "belegt": lambda _o: []}
    for art in ablage.arten():
        z = zustand(art)
        b = ziehe_um(art, False, **frei)
        plan = "nothing to do"
        if b["regel"]:
            plan = f"interrupted, rule {b['regel']}" + (" (refused, see the entries)" if b["regel"] == "U7" else "")
        elif b["ergebnis"] == "ok":
            plan = f"would move by {b['modus']}: {b['dateien']} files, {b['bytes'] / 1e6:.1f} MB"
        elif b["ergebnis"] == "abgelehnt":
            plan = f"refused: {b['grund']}"
        print(f"{art:13} {z:16} {b['alt']} -> {b['neu']}   {plan}")
    einheiten = (inj.get("belegt") or belegt)(Path("/nonexistent-djk-umzug"))
    if einheiten:
        print(f"in use now ({'; '.join(einheiten)}): a move with --ausfuehren is refused while these run")
    return 0


def _pruefen_cli(argv: list[str], inj: dict) -> int:
    ausfuehren = "--ausfuehren" in argv
    alle = "--alle" in argv
    liste, rest, i = None, [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--liste":
            if i + 1 >= len(argv):
                return _hilfe(2)
            liste = argv[i + 1]
            i += 1
        elif a.startswith("-") and a not in ("--ausfuehren", "--alle"):
            return _hilfe(2)
        elif not a.startswith("-"):
            rest.append(a)
        i += 1
    if rest[:1] == ["zurueck"]:
        if liste or alle == (len(rest) == 2) or len(rest) > 2:
            return _hilfe(2)
        berichte = pruefen_zurueck(None if alle else rest[1:], ausfuehren, **inj)
    elif rest or alle:
        return _hilfe(2)
    elif liste is None:
        if ausfuehren:
            print("djk-umzug: --ausfuehren needs --liste", file=sys.stderr)
            return 2
        projekte = Path(os.path.realpath(ablage.ordner("projekte")))
        namen = sorted(e.name for e in projekte.iterdir() if e.is_dir() and not e.is_symlink() and _SLUG.match(e.name)) \
            if projekte.is_dir() else []
        for n in namen:
            regel = pruefen_vorschlag(n)
            print(f"{n:48} {regel or '-':4} {'suggested' if regel else ''}".rstrip())
        print(f"{sum(1 for n in namen if pruefen_vorschlag(n))} of {len(namen)} projects suggested; nothing is moved "
              "without --liste")
        return 0
    else:
        try:
            slugs = json.loads(Path(liste).read_text(encoding="utf-8"))["slugs"]
            if not isinstance(slugs, list) or not all(isinstance(x, str) for x in slugs):
                raise TypeError("slugs must be a list of names")
        except (OSError, ValueError, KeyError, TypeError) as e:
            print(f"djk-umzug: cannot read the list {liste}: {e}", file=sys.stderr)
            return 2
        berichte = pruefen(slugs, ausfuehren, **inj)
    for b in berichte:
        print(json.dumps(b, ensure_ascii=False))
    return max((int(b.get("code", 0)) for b in berichte), default=0)


def _hilfe(code: int) -> int:
    print((__doc__ or "").strip(), file=sys.stderr if code else sys.stdout)
    return code


def _main(argv: list[str], inj: dict) -> int:
    if "-h" in argv or "--help" in argv:
        return _hilfe(0)
    if argv == ["heim-anlegen"]:
        return _zeige(heim_anlegen())
    if argv[:1] == ["pruefen"]:
        return _pruefen_cli(argv[1:], inj)
    if argv[:1] == ["modulnamen"]:
        if any(a not in ("--ausfuehren",) for a in argv[1:]):
            return _hilfe(2)
        return _zeige(modulnamen("--ausfuehren" in argv, **{k: v for k, v in inj.items() if k == "belegt"}))
    if any(a.startswith("-") and a not in SCHALTER for a in argv):
        return _hilfe(2)
    ausfuehren = "--ausfuehren" in argv
    rest = [a for a in argv if not a.startswith("-")]
    if not rest:
        return _tabelle(inj)
    befehl = rest[0]
    if befehl == "einrichten" and len(rest) == 1:
        berichte = einrichten()
        if "--still" not in argv:
            for b in berichte:
                if b["ergebnis"] != "nichts" or b["grund"]:
                    print(json.dumps(b, ensure_ascii=False))
        elif berichte and berichte[0].get("code") == 6:
            print(f"djk-umzug: {berichte[0]['grund']}", file=sys.stderr)
        return max((int(b.get("code", 0)) for b in berichte), default=0)
    if befehl in ("zurueck", "aufraeumen") and len(rest) == 2 and rest[1] in ablage.arten():
        if befehl == "zurueck":
            return _zeige(zurueck(rest[1], ausfuehren, **inj))
        return _zeige(aufraeumen(rest[1], ausfuehren))
    if befehl in ablage.arten() and len(rest) == 1:
        return _zeige(ziehe_um(befehl, ausfuehren, **inj))
    return _hilfe(2)


def main(argv, **inj) -> int:
    """inj: the injectable functions of ziehe_um (umbenennen, verlinke, kopiere, geraet, belegt), for tests."""
    try:
        return _main(list(argv), inj)
    except ValueError as e:                                              # CYPHERDJ_HEIM is not an absolute path
        print(f"djk-umzug: {e}", file=sys.stderr)
        return 2
    except OSError as e:
        print(f"djk-umzug: {type(e).__name__}: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
