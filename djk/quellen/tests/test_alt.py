"""Import of the old lists and the way back. The fixture files use invented paths shaped like a real setup."""
import json
from pathlib import Path

import quellen
from quellen import alt

DATEN = Path(__file__).resolve().parent / "data"


def importiert():
    return quellen.importiere(DATEN / "wurzeln.toml", DATEN / "regal.json", None, DATEN / "umgebung.env", DATEN / "rollen.json")


def test_import_und_rueckweg_gleich(tmp_path):
    q = importiert()
    nach_name = {w.name: w for w in q.wurzeln}
    assert len(q.wurzeln) == 9 + 3                                 # nine catalog roots, three shelf-only roots below one
    assert nach_name["audio"].art == "sample" and nach_name["audio"].katalog and not nach_name["audio"].regal
    kern = nach_name["Live Core Library"]                          # the shelf entry equals a catalog root: one root, both flags
    assert (kern.katalog, kern.regal, kern.pfad) == (True, True, "/opt/daw/Core Library/Samples")
    assert kern.mediathek == {"pack_ordner": True, "ohne_ordner": ["Folder Info", "Lessons"], "ohne_endung": [".ogg"]}
    for n in ("Battery 4", "VCSL", "NI"):
        assert (nach_name[n].katalog, nach_name[n].regal, nach_name[n].art) == (False, True, "sample")
    assert nach_name["01 MP3"].mediathek["ohne"] == ["Audio Production", "Midi", "30 Radio Stream", "99 Mix"]
    assert len(q.fern) == 1 and q.fern[0]["host"] == "laptop-b"
    # the way back: the generated files say the same as the old ones
    geschrieben = alt.schreibe_alt(q, "desktop-x", tmp_path / "wurzeln.toml", tmp_path / "wurzeln.json", tmp_path / "bibliothek.json")
    assert len(geschrieben) == 3
    assert (tmp_path / "wurzeln.toml").read_text().startswith("# generated from quellen.toml by djk/quellen, edit quellen.toml\n")
    assert quellen.vergleiche(q, DATEN / "wurzeln.toml", DATEN / "regal.json", host="desktop-x") == []
    assert quellen.vergleiche(q, tmp_path / "wurzeln.toml", tmp_path / "wurzeln.json", host="desktop-x") == []
    bib = json.loads((tmp_path / "bibliothek.json").read_text())
    assert bib["schema"] == 1 and {"pfad": "/data/audio", "typ": "auto"} in bib["wurzeln"]
    assert all(e["typ"] in ("auto", "track", "loop", "oneshot") for e in bib["wurzeln"])
    # and through the file: the list survives its own format
    (tmp_path / "heim").mkdir()
    quellen.schreibe(tmp_path / "heim" / "quellen.toml", q)
    assert quellen.lies(tmp_path / "heim" / "quellen.toml") == q


def test_vergleiche_meldet_abweichung(tmp_path):
    q = importiert()
    q.wurzeln[0].mediathek["ohne"] = ["Midi"]
    q.wurzeln = [w for w in q.wurzeln if w.name != "VCSL"]
    diff = quellen.vergleiche(q, DATEN / "wurzeln.toml", DATEN / "regal.json", host="desktop-x")
    assert any("01 MP3: ohne is" in d for d in diff) and any("shelf: only in the old list: VCSL" in d for d in diff)
    assert len(diff) == 2


def test_schreibe_alt_unveraendert_schreibt_nicht(tmp_path):
    q = importiert()
    ziele = (tmp_path / "wurzeln.toml", tmp_path / "wurzeln.json", tmp_path / "bibliothek.json")
    assert len(alt.schreibe_alt(q, "desktop-x", *ziele)) == 3
    zeiten = [z.stat().st_mtime_ns for z in ziele]
    assert alt.schreibe_alt(q, "desktop-x", *ziele) == []
    assert [z.stat().st_mtime_ns for z in ziele] == zeiten
    q.wurzeln[-1].regal = not q.wurzeln[-1].regal
    assert alt.schreibe_alt(q, "desktop-x", *ziele) == [str(ziele[1])]
    assert alt.schreibe_alt(q, "desktop-x", None, None, None) == []


def test_klang_aus_umgebung():
    q = importiert()
    klang = {k.name: (k.wurzel, k.rel) for k in q.klang}
    assert klang == {"battery": ("Battery 4", "Drums"), "maschine": ("NI", "Maschine Library/Samples/Drums")}


def test_klang_ohne_rolle_bleibt_draussen(tmp_path):
    q = importiert()
    assert "battery_samples" not in {k.name for k in q.klang}
    # a kit source outside every root brings its own root, which is neither in the catalog nor in the shelf
    env = tmp_path / "umgebung.env"
    env.write_text('CYPHERDJ_KLANG_BATTERY="/elsewhere/kits/Drums"\n')
    q2 = quellen.importiere(DATEN / "wurzeln.toml", None, None, env, DATEN / "rollen.json")
    w = next(w for w in q2.wurzeln if w.pfad == "/elsewhere/kits/Drums")
    assert (w.katalog, w.regal, w.name) == (False, False, "Drums") and [(k.name, k.wurzel, k.rel) for k in q2.klang] == [("battery", "Drums", "")]


def test_import_namen_eindeutig(tmp_path):
    t = tmp_path / "w.toml"
    t.write_text('[[wurzel]]\npfad = "/a/Samples"\ntyp = "track"\n[[wurzel]]\npfad = "/b/Samples"\ntyp = "track"\n')
    r = tmp_path / "r.json"
    r.write_text(json.dumps([{"name": "Samples", "pfad": "/c/shelf"}]))
    q = quellen.importiere(t, r, None, None, None)
    assert sorted(w.name for w in q.wurzeln) == ["Samples", "Samples 2", "Samples 3"]
    assert next(w for w in q.wurzeln if w.name == "Samples").pfad == "/c/shelf"   # the owner's shelf name wins


def test_import_bibliothek(tmp_path):
    b = tmp_path / "bibliothek.json"
    b.write_text(json.dumps({"schema": 1, "wurzeln": [{"pfad": "/data/audio", "typ": "auto"}, {"pfad": "/music/sets", "typ": "track"}]}))
    q = quellen.importiere(DATEN / "wurzeln.toml", None, b, None, None)
    assert [w.pfad for w in q.wurzeln if w.pfad in ("/data/audio", "/music/sets")] == ["/data/audio", "/music/sets"]
    assert next(w for w in q.wurzeln if w.pfad == "/music/sets").art == "track"
