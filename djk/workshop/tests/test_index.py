import json
import sqlite3

from werkstatt.index import neu_aufbauen, oeffne, zaehle


def lege_material_an(bestand, mid, fassungen, tore_ok=True):
    mo = bestand / mid
    (mo / "fassungen").mkdir(parents=True)
    m = {"material_id": mid, "titel": mid, "herkunft": {"art": "datei", "erzeugt_am": None},
         "quelle": {"dauer_s": 10.0}, "lautheit_quelle": {"lufs_integriert": -14.0},
         "tonart": {"camelot": "8A", "stimmung_cent": 1.0},
         "tempo_karte_quelle": [[0.25 + i * 60 / 134, float(i)] for i in range(20)]}
    (mo / "material.json").write_text(json.dumps(m))
    for name in fassungen:
        f = mo / "fassungen" / name
        f.mkdir()
        (f / "fassung.json").write_text(json.dumps({"frames": 100, "stems": {}, "schuesse": [],
                                                    "lautheit": {"lufs_integriert": -26.0}, "nur_fuer_andreas": True,
                                                    "tore": {"raster": {"ok": tore_ok}}}))
    return mo


def test_wal_modus(tmp_path):
    con = oeffne(tmp_path)
    assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    con.close()


def test_index_zaehlt_wie_die_ordner(tmp_path):
    lege_material_an(tmp_path, "0123456789abcdef", ["128000_r1", "128000_r2"])
    lege_material_an(tmp_path, "fedcba9876543210", ["128000_r1"])
    con = neu_aufbauen(tmp_path)
    con.close()
    assert zaehle(tmp_path) == (2, 3)
    con = sqlite3.connect(tmp_path / "index.sqlite")
    assert round(con.execute("SELECT quelle_bpm FROM material WHERE material_id='0123456789abcdef'").fetchone()[0], 3) == 134.0
    con.close()


def test_verlorener_index_kommt_aus_den_ordnern_zurueck(tmp_path):
    """FEHLERFALL: index.sqlite geloescht -> neu_aufbauen liefert dieselben Zahlen (die Ordner sind die Wahrheit)."""
    lege_material_an(tmp_path, "0123456789abcdef", ["128000_r1", "128000_r2"])
    neu_aufbauen(tmp_path).close()
    for p in tmp_path.glob("index.sqlite*"):
        p.unlink()
    assert zaehle(tmp_path) == (0, 0)
    neu_aufbauen(tmp_path).close()
    assert zaehle(tmp_path) == (1, 2)
