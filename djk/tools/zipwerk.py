#!/usr/bin/env python3
"""Safe zip handling for imported files (browser plan 1, task 2). Standard library only.

    zipwerk.py entpacke <zip> <ziel_ordner> [--max-bytes N] [--max-eintraege N] [--nur-medien]
    zipwerk.py pruefe <zip> [--max-bytes N] [--max-eintraege N]
    zipwerk.py packen <ordner> <zip> [--ohne MUSTER]... [--nur PFAD]... [--dazu PREFIX=ORDNER]... [--ersetze NAME=DATEI]... [--max-bytes N] [--max-eintraege N]
    zipwerk.py groesse <zip>

Both print one JSON object on stdout. entpacke: {"ordner", "eintraege", "uebersprungen": [{"name", "grund"}], "hat_kit_json",
"hat_projekt_json"}; pruefe has the same fields without writing anything. Exit 0 ok, exit 2 refused (stdout {"abgelehnt": grund},
nothing written, no partial folder). Rules: every entry name is checked first (absolute paths and any ".." refuse the whole zip), entry
count and declared size are capped, symlinks are skipped and listed, a zip inside the zip is a plain file (never recursed), and
every entry is streamed with a byte counter instead of trusting its declared size. The target appears only at the very end (rename).
Plan 5 adds `packe` and `groesse` (appended block below `entpacke`); `entpacke` is unchanged.
"""
import argparse
import errno
import fnmatch
import os
import json
import re
import shutil
import stat
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MEDIEN = {"wav", "aif", "aiff", "flac", "ogg", "mp3", "m4a", "opus", "mid", "midi"}
MAX_BYTES = 4 * 2 ** 30
MAX_EINTRAEGE = 20000
_LAUFWERK = re.compile(r"^[A-Za-z]:")


class Abgelehnt(Exception):
    def __init__(self, grund: str):
        super().__init__(grund)
        self.grund = grund


def _normal(name: str) -> PurePosixPath:
    """The entry name as a safe relative path; raises Abgelehnt for absolute names and any '..' part."""
    n = name.replace("\\", "/")
    if "\0" in n:
        raise Abgelehnt("name_unlesbar")
    if n.startswith("/") or _LAUFWERK.match(n):
        raise Abgelehnt("pfad_absolut")
    teile = [t for t in n.split("/") if t not in ("", ".")]
    if ".." in teile:
        raise Abgelehnt("pfad_verlaesst_ordner")
    return PurePosixPath(*teile) if teile else PurePosixPath(".")


def _pruefe_liste(z: zipfile.ZipFile, max_bytes: int, max_eintraege: int):
    infos = z.infolist()
    if len(infos) > max_eintraege:
        raise Abgelehnt("zu_viele_eintraege")
    namen = [_normal(i.filename) for i in infos]
    if any(i.flag_bits & 0x1 for i in infos):
        raise Abgelehnt("verschluesselt")
    if sum(i.file_size for i in infos) > max_bytes:
        raise Abgelehnt("zu_gross_entpackt")
    return infos, namen


def _top_hat(namen, datei: str) -> bool:
    """True when `datei` is at the top level, or inside the one folder that holds everything."""
    teile = [n.parts for n in namen if n.parts]
    if any(t == (datei,) for t in teile):
        return True
    tops = {t[0] for t in teile}
    return len(tops) == 1 and any(len(t) == 2 and t[1] == datei for t in teile)


def _kennzeichen(namen) -> dict:
    return {"hat_kit_json": _top_hat(namen, "kit.json"), "hat_projekt_json": _top_hat(namen, "project.json")}


def _eintragszahl(zip: Path) -> int | None:
    """The entry count from the end-of-central-directory record, read without parsing the directory (None: no record found).
    A zip64 marker (0xFFFF) counts as 65535, which is above any cap this tool accepts."""
    try:
        with open(zip, "rb") as f:
            f.seek(0, 2)
            groesse = f.tell()
            f.seek(max(0, groesse - 65557))
            ende = f.read()
    except OSError:
        return None
    i = ende.rfind(b"PK\x05\x06")
    if i < 0 or len(ende) < i + 12:
        return None
    return int.from_bytes(ende[i + 10:i + 12], "little")


def _oeffne(zip: Path, max_eintraege: int = MAX_EINTRAEGE) -> zipfile.ZipFile:
    n = _eintragszahl(zip)
    if n is not None and n > max_eintraege:
        raise Abgelehnt("zu_viele_eintraege")
    try:
        return zipfile.ZipFile(zip)
    except UnicodeDecodeError:   # the UTF-8 flag is set but a name is not UTF-8
        raise Abgelehnt("name_unlesbar")
    except (zipfile.BadZipFile, OSError):
        raise Abgelehnt("zip_kaputt")


def pruefe(zip: Path, max_bytes: int = MAX_BYTES, max_eintraege: int = MAX_EINTRAEGE) -> dict:
    """Validates a zip and reports kit.json / project.json at its top without writing anything."""
    with _oeffne(Path(zip), max_eintraege) as z:
        infos, namen = _pruefe_liste(z, max_bytes, max_eintraege)
        return {"ordner": None, "eintraege": sum(1 for i in infos if not i.is_dir()), "uebersprungen": [], **_kennzeichen(namen)}


def entpacke(zip: Path, ziel: Path, max_bytes: int = MAX_BYTES, max_eintraege: int = MAX_EINTRAEGE, nur_medien: bool = False) -> dict:
    zip, ziel = Path(zip), Path(ziel)
    if ziel.exists():
        raise Abgelehnt("ziel_existiert")
    ziel.parent.mkdir(parents=True, exist_ok=True)
    with _oeffne(zip, max_eintraege) as z:
        infos, namen = _pruefe_liste(z, max_bytes, max_eintraege)
        kennz = _kennzeichen(namen)
        tmp = Path(tempfile.mkdtemp(prefix=f".{ziel.name}.", suffix=".teil", dir=ziel.parent))
        try:
            n_ok, uebersprungen, gesamt = 0, [], 0
            for info, rel in zip_paare(infos, namen):
                if info.is_dir():
                    continue
                modus = info.external_attr >> 16
                if modus and stat.S_ISLNK(modus):
                    uebersprungen.append({"name": info.filename, "grund": "symlink"})
                    continue
                if nur_medien and rel.suffix.lstrip(".").lower() not in MEDIEN:
                    uebersprungen.append({"name": info.filename, "grund": "typ_unbekannt"})
                    continue
                ziel_datei = tmp.joinpath(*rel.parts)
                if tmp.resolve() not in ziel_datei.resolve().parents:
                    raise Abgelehnt("pfad_verlaesst_ordner")
                ziel_datei.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as quelle, open(ziel_datei, "wb") as aus:
                    while True:
                        block = quelle.read(1 << 20)
                        if not block:
                            break
                        gesamt += len(block)
                        if gesamt > max_bytes:
                            raise Abgelehnt("zu_gross_entpackt")
                        aus.write(block)
                n_ok += 1
            tmp.rename(ziel)
        except zipfile.BadZipFile:
            shutil.rmtree(tmp, ignore_errors=True)
            raise Abgelehnt("zip_kaputt")
        except (FileExistsError, NotADirectoryError, IsADirectoryError):   # a file and a folder with the same path
            shutil.rmtree(tmp, ignore_errors=True)
            raise Abgelehnt("namenskonflikt")
        except OSError as e:
            shutil.rmtree(tmp, ignore_errors=True)
            raise Abgelehnt("platte_voll" if e.errno == errno.ENOSPC else "schreiben_fehlgeschlagen")
        except (RuntimeError, NotImplementedError):   # encrypted or unsupported compression
            shutil.rmtree(tmp, ignore_errors=True)
            raise Abgelehnt("zip_nicht_unterstuetzt")
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
    return {"ordner": str(ziel), "eintraege": n_ok, "uebersprungen": uebersprungen, **kennz}


def zip_paare(infos, namen):
    return zip(infos, namen)


# ---- browser plan 5: packe and groesse (appended; entpacke above is untouched) ----

def _ausgelassen(rel: str, ist_ordner: bool, ohne) -> bool:
    for m in ohne:
        if m.endswith("/"):
            teil = m[:-1]
            parts = rel.split("/")
            # a folder pattern drops the folder (and so its subtree) at any depth
            if any(fnmatch.fnmatch(p, teil) for p in (parts if ist_ordner else parts[:-1])):
                return True
        elif fnmatch.fnmatch(rel, m):
            return True
    return False


def _sammle(ordner: Path, praefix: str, ohne, nur, dateien, uebersprungen, aus, max_eintraege: int, schon=()) -> None:
    for wurzel, ordnernamen, namen in os.walk(ordner, followlinks=False):
        rel_w = Path(wurzel).relative_to(ordner).as_posix()
        rel_w = "" if rel_w == "." else rel_w
        for d in sorted(ordnernamen[:]):
            rel = f"{rel_w}/{d}" if rel_w else d
            rel = praefix + rel
            if _ausgelassen(rel[len(praefix):], True, ohne):
                ordnernamen.remove(d)
                aus.append(rel + "/")
            elif os.path.islink(os.path.join(wurzel, d)):
                ordnernamen.remove(d)
                uebersprungen.append({"name": rel, "grund": "symlink_ordner"})
        ordnernamen.sort()
        for n in sorted(namen):
            rel = f"{rel_w}/{n}" if rel_w else n
            rel = praefix + rel
            if _ausgelassen(rel[len(praefix):], False, ohne) or (nur is not None and rel not in nur):
                aus.append(rel)
                continue
            if rel in schon:
                continue
            voll = os.path.join(wurzel, n)
            try:
                st = os.stat(voll)   # follows a file symlink
            except OSError:
                uebersprungen.append({"name": rel, "grund": "nicht_lesbar"})
                continue
            if not stat.S_ISREG(st.st_mode):
                uebersprungen.append({"name": rel, "grund": "keine_datei"})
                continue
            dateien.append((voll, rel, st.st_size))
            if len(dateien) > max_eintraege:
                raise Abgelehnt("zu_viele_eintraege")


def packe(ordner: Path, zip_pfad: Path, ohne=(), max_bytes: int = MAX_BYTES, max_eintraege: int = MAX_EINTRAEGE, nur=None, dazu=(), ersetze=None) -> dict:
    """Zips the tree under `ordner` (the root itself may be a symlink). Symlinked files are stored as content, symlinked folders
    are skipped and listed. Caps count entries and source bytes before anything is written; the zip appears by rename at the end.
    Folders and files are visited in sorted order (the same tree always gives the same entry order). `nur`, when given, is a list of
    relative paths: only those files are packed, everything else is left out. `dazu` is a list of (prefix, folder): the folder's files
    are added under `prefix/` unless the tree already holds that entry. `ersetze` maps a relative path to a file whose bytes are stored
    under that name instead (only for entries that exist)."""
    ordner, zip_pfad = Path(ordner), Path(zip_pfad)
    if not ordner.is_dir():
        raise Abgelehnt("ordner_fehlt")
    if zip_pfad.exists():
        raise Abgelehnt("ziel_belegt")
    dateien, uebersprungen, aus = [], [], []
    _sammle(ordner, "", ohne, nur, dateien, uebersprungen, aus, max_eintraege)
    for praefix, extra in dazu:
        extra = Path(extra)
        if not extra.is_dir():
            raise Abgelehnt("ordner_fehlt")
        _sammle(extra, praefix.strip("/") + "/", (".*", ".*/"), None, dateien, uebersprungen, aus, max_eintraege, {r for _, r, _ in dateien})
    if ersetze:
        ersetzt = []
        for voll, rel, g in dateien:
            if rel in ersetze:
                voll = str(ersetze[rel])
                g = os.stat(voll).st_size
            ersetzt.append((voll, rel, g))
        dateien = ersetzt
    if sum(g for _, _, g in dateien) > max_bytes:
        raise Abgelehnt("zu_gross_entpackt")
    teil = Path(str(zip_pfad) + ".teil")
    zip_pfad.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(teil, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
            for voll, rel, _g in dateien:
                z.write(voll, rel)
        n_bytes = teil.stat().st_size
        os.rename(teil, zip_pfad)
    except OSError as e:
        teil.unlink(missing_ok=True)
        raise Abgelehnt("platte_voll" if e.errno == errno.ENOSPC else "schreiben_fehlgeschlagen")
    except BaseException:
        teil.unlink(missing_ok=True)
        raise
    return {"zip": str(zip_pfad), "eintraege": len(dateien), "bytes": n_bytes, "uebersprungen": uebersprungen, "ausgelassen": aus}


def groesse(zip_pfad: Path) -> dict:
    """Entries and the sum of the declared sizes of the central directory; nothing is unpacked."""
    with _oeffne(Path(zip_pfad)) as z:
        infos = [i for i in z.infolist() if not i.is_dir()]
        return {"eintraege": len(infos), "bytes": sum(i.file_size for i in infos)}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="zipwerk")
    sub = p.add_subparsers(dest="befehl", required=True)
    for name in ("entpacke", "pruefe"):
        s = sub.add_parser(name)
        s.add_argument("zip")
        if name == "entpacke":
            s.add_argument("ziel")
            s.add_argument("--nur-medien", action="store_true")
        s.add_argument("--max-bytes", type=int, default=MAX_BYTES)
        s.add_argument("--max-eintraege", type=int, default=MAX_EINTRAEGE)
    s = sub.add_parser("packen")
    s.add_argument("ordner")
    s.add_argument("zip")
    s.add_argument("--ohne", action="append", default=[])
    s.add_argument("--nur", action="append", default=[])
    s.add_argument("--dazu", action="append", default=[], help="PREFIX=ORDNER")
    s.add_argument("--ersetze", action="append", default=[], help="NAME=DATEI")
    s.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    s.add_argument("--max-eintraege", type=int, default=MAX_EINTRAEGE)
    s = sub.add_parser("groesse")
    s.add_argument("zip")
    a = p.parse_args(argv)
    try:
        if a.befehl == "packen":
            r = packe(Path(a.ordner), Path(a.zip), a.ohne, a.max_bytes, a.max_eintraege, set(a.nur) if a.nur else None,
                      [tuple(x.split('=', 1)) for x in a.dazu], dict(x.split('=', 1) for x in a.ersetze))
        elif a.befehl == "groesse":
            r = groesse(Path(a.zip))
        elif a.befehl == "entpacke":
            r = entpacke(Path(a.zip), Path(a.ziel), a.max_bytes, a.max_eintraege, a.nur_medien)
        else:
            r = pruefe(Path(a.zip), a.max_bytes, a.max_eintraege)
    except Abgelehnt as e:
        print(json.dumps({"abgelehnt": e.grund}))
        return 2
    except OSError as e:   # e.g. the temp folder cannot be created: a reason code, no traceback
        print(json.dumps({"abgelehnt": "platte_voll" if e.errno == errno.ENOSPC else "schreiben_fehlgeschlagen"}))
        return 2
    print(json.dumps(r, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
