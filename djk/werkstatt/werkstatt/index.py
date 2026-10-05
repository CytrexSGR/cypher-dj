"""Index `<bestand>/index.sqlite` (SCHNITTSTELLEN §13.4): Tabellen `material` und `fassung`, WAL-Modus,
geschrieben nur von der Werkstatt. Die Ordner sind die Wahrheit; der Index wird nach jedem Veroeffentlichen
nachgetragen und laesst sich jederzeit aus den Ordnern neu aufbauen (`neu_aufbauen`).
Material-Zeile: `tore_ok` und `nur_fuer_andreas` der Fassung mit dem hoechsten r auf der Set-Basis."""
import sqlite3
from pathlib import Path

import numpy as np

from .bestand import fassungen_von, lies_json, materialien
from .fremdtags import repariere_text

SCHEMA = """
CREATE TABLE IF NOT EXISTS material(material_id TEXT PRIMARY KEY, titel TEXT, herkunft_art TEXT, erzeugt_am TEXT,
  quelle_bpm REAL, dauer_s REAL, lufs REAL, camelot TEXT, stimmung_cent REAL, tore_ok INTEGER,
  nur_fuer_andreas INTEGER, pfad TEXT);
CREATE TABLE IF NOT EXISTS fassung(material_id TEXT, basis_bpm REAL, fassung INTEGER, frames INTEGER,
  stems INTEGER, schuesse INTEGER, lufs REAL, tore_ok INTEGER, PRIMARY KEY(material_id, basis_bpm, fassung));
"""


def oeffne(bestand):
    con = sqlite3.connect(Path(bestand) / "index.sqlite")
    modus = con.execute("PRAGMA journal_mode=WAL").fetchone()[0]
    if modus != "wal":
        raise RuntimeError(f"index.sqlite nicht im WAL-Modus: {modus}")
    con.executescript(SCHEMA)
    return con


def tore_ok(f):
    return all(t["ok"] for t in f["tore"].values())


def quelle_bpm(material):
    k = np.asarray(material["tempo_karte_quelle"], dtype=float)
    return round(float(60.0 * np.polyfit(k[:, 0], k[:, 1], 1)[0]), 3)


def eintragen(con, material_ordner, set_basis=128.0):
    m = lies_json(Path(material_ordner) / "material.json")
    fs = fassungen_von(material_ordner)
    with con:
        for b, r, p in fs:
            f = lies_json(p / "fassung.json")
            con.execute("INSERT OR REPLACE INTO fassung VALUES (?,?,?,?,?,?,?,?)",
                        (m["material_id"], b, r, f["frames"], 1 if f["stems"] else 0, len(f["schuesse"]),
                         f["lautheit"]["lufs_integriert"], int(tore_ok(f))))
        auf_basis = [(r, p) for b, r, p in fs if abs(b - set_basis) < 1e-9]
        neueste = lies_json(max(auf_basis)[1] / "fassung.json") if auf_basis else None
        con.execute("INSERT OR REPLACE INTO material VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (m["material_id"], repariere_text(m["titel"]), m["herkunft"]["art"], m["herkunft"]["erzeugt_am"],
                     quelle_bpm(m), m["quelle"]["dauer_s"], m["lautheit_quelle"]["lufs_integriert"],
                     m["tonart"]["camelot"], m["tonart"]["stimmung_cent"],
                     None if neueste is None else int(tore_ok(neueste)),
                     None if neueste is None else int(neueste["nur_fuer_andreas"]), str(Path(material_ordner))))


def neu_aufbauen(bestand, set_basis=128.0):
    con = oeffne(bestand)
    with con:
        con.execute("DELETE FROM fassung")
        con.execute("DELETE FROM material")
    for mo in materialien(bestand):
        eintragen(con, mo, set_basis)
    return con


def zaehle(bestand):
    con = oeffne(bestand)
    n_m = con.execute("SELECT count(*) FROM material").fetchone()[0]
    n_f = con.execute("SELECT count(*) FROM fassung").fetchone()[0]
    con.close()
    return n_m, n_f
