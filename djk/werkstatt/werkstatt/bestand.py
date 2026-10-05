"""Bestand (SCHNITTSTELLEN §13.1, §13.3; ADR 015): Pfade, material_id, atomares Veroeffentlichen ohne
Ueberschreiben, Versiegeln veroeffentlichter Fassungen, korrekturen.jsonl als einzige anhaengbare Datei.

Atomar: alles entsteht unter <bestand>/.arbeit/<auftrag_id>/ (gleiches Dateisystem) und kommt per
renameat2(RENAME_NOREPLACE) an seinen Platz. Ein vorhandenes Ziel, auch ein leerer Ordner, laesst den
Aufruf mit FileExistsError scheitern (os.rename wuerde einen leeren Zielordner still ersetzen).
Versiegeln: Dateien einer veroeffentlichten Fassung, original.* und material.json werden 0444, der
Fassungsordner 0555; so scheitert jeder Schreibversuch eines Programms mit PermissionError."""
import ctypes
import errno
import hashlib
import json
import os
import re
import shutil
from pathlib import Path

from .vertrag import pruefe, sauber

AT_FDCWD = -100
RENAME_NOREPLACE = 1
_libc = ctypes.CDLL(None, use_errno=True)
_libc.renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
FASSUNG_MUSTER = re.compile(r"^([1-9][0-9]*)_r([1-9][0-9]*)$")


def standard_bestand():
    return Path(os.environ.get("CYPHERDJ_BESTAND", Path.home() / "cypher-dj" / "bestand"))


def sha256_datei(pfad):
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def material_id_von(pfad):
    """§1.4: erste 16 Hex-Zeichen des SHA-256 der Quelldatei."""
    return sha256_datei(pfad)[:16]


def fassung_name(basis_bpm, r):
    return f"{int(round(basis_bpm * 1000))}_r{int(r)}"


def fassung_teile(name):
    m = FASSUNG_MUSTER.match(name)
    if not m:
        raise ValueError(f"kein Fassungsname: {name}")
    return int(m.group(1)) / 1000.0, int(m.group(2))


def fsync_pfad(pfad):
    fd = os.open(pfad, os.O_RDONLY | (os.O_DIRECTORY if Path(pfad).is_dir() else 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def fsync_baum(wurzel):
    for ordner, _, dateien in os.walk(wurzel, topdown=False):
        for d in dateien:
            fsync_pfad(os.path.join(ordner, d))
        fsync_pfad(ordner)


def rename_ohne_ueberschreiben(quelle, ziel):
    r = _libc.renameat2(AT_FDCWD, os.fsencode(str(quelle)), AT_FDCWD, os.fsencode(str(ziel)), RENAME_NOREPLACE)
    if r != 0:
        e = ctypes.get_errno()
        if e == errno.EEXIST:
            raise FileExistsError(e, "Ziel existiert, nichts ueberschrieben", str(ziel))
        raise OSError(e, os.strerror(e), str(ziel))
    fsync_pfad(Path(ziel).parent)


def versiegeln(pfad, ordner_selbst=True):
    """Datei: 0444. Ordner: Inhalt 0444/0555, der Ordner selbst 0555 (ordner_selbst=False laesst ihn
    beschreibbar: Linux verlangt Schreibrecht am Ordner, um ihn in einen anderen Ordner umzubenennen)."""
    pfad = Path(pfad)
    if pfad.is_file():
        os.chmod(pfad, 0o444)
        return
    for ordner, unter, dateien in os.walk(pfad, topdown=False):
        for d in dateien:
            os.chmod(os.path.join(ordner, d), 0o444)
        for u in unter:
            os.chmod(os.path.join(ordner, u), 0o555)
    if ordner_selbst:
        os.chmod(pfad, 0o555)


def aufraeumen(pfad):
    """Arbeitsordner der Werkstatt loeschen, auch wenn ein abgebrochener Lauf darin schon versiegelt hat."""
    pfad = Path(pfad)
    if not pfad.exists():
        return
    for ordner, unter, _ in os.walk(pfad):
        os.chmod(ordner, 0o755)
    shutil.rmtree(pfad)



def schreibe_json(pfad, obj):
    with open(pfad, "w", encoding="utf-8") as f:
        json.dump(sauber(obj), f, ensure_ascii=False, indent=1)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())


def lies_json(pfad):
    return json.loads(Path(pfad).read_text(encoding="utf-8"))


def korrektur_anhaengen(material_ordner, zeile):
    """Eine Zeile (gueltig gegen korrektur.schema.json, sonst ValueError und nichts geschrieben) in einem write()
    mit O_APPEND, dann fsync. Rueckgabe: Zeilenzahl danach."""
    pruefe("korrektur.schema.json", zeile)
    pfad = Path(material_ordner) / "korrekturen.jsonl"
    text = json.dumps(sauber(zeile), ensure_ascii=False, separators=(",", ":")) + "\n"
    fd = os.open(pfad, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, text.encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    return len(korrekturen_lesen(material_ordner))


def korrekturen_lesen(material_ordner):
    pfad = Path(material_ordner) / "korrekturen.jsonl"
    if not pfad.exists():
        return []
    return [json.loads(z) for z in pfad.read_text(encoding="utf-8").splitlines() if z.strip()]


def fassungen_von(material_ordner):
    """[(basis_bpm, r, pfad)] sortiert nach Basis, dann r."""
    f = Path(material_ordner) / "fassungen"
    if not f.is_dir():
        return []
    aus = []
    for p in f.iterdir():
        if FASSUNG_MUSTER.match(p.name) and (p / "fassung.json").is_file():
            b, r = fassung_teile(p.name)
            aus.append((b, r, p))
    return sorted(aus)


def materialien(bestand):
    """Alle veroeffentlichten Material-Ordner (16 Hex-Zeichen, mit material.json)."""
    return sorted(p for p in Path(bestand).iterdir()
                  if re.fullmatch(r"[0-9a-f]{16}", p.name) and (p / "material.json").is_file())
