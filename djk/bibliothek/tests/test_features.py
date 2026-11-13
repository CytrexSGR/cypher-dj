import builtins
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from bibliothek.config import Wurzel
from bibliothek.features import MerkmalCache, felder, lesewerkzeuge, merkmale
from bibliothek.scan import Auslassung, Datei
from starter.tools import WerkzeugFehlt


def _datei(p: Path, root: Path) -> Datei:
    st = p.stat()
    return Datei(p, p.relative_to(root).as_posix(), Wurzel(root, "auto"), st.st_size, st.st_mtime_ns)


def _flac(p: Path, sek: float = 0.5) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    sf.write(p, (np.sin(np.arange(int(44100 * sek)) / 20) * 0.3).astype("float32"), 44100, format="FLAC")
    return p


def _verberge(monkeypatch, *namen):
    for n in namen:
        monkeypatch.setitem(sys.modules, n, None)  # import raises ImportError


def test_garbage_mp3_is_kaputt(tmp_path):
    p = tmp_path / "x.mp3"
    p.write_bytes(np.random.default_rng(1).bytes(100))
    r = merkmale(_datei(p, tmp_path), MerkmalCache())
    assert isinstance(r, Auslassung) and r.grund == "kaputt" and r.pfad == str(p)


def test_cache_hit_does_not_hash(tmp_path):
    p = _flac(tmp_path / "a.flac")
    c = MerkmalCache()
    a = merkmale(_datei(p, tmp_path), c)
    assert c.gehasht == 1
    b = merkmale(_datei(p, tmp_path), c)
    assert c.gehasht == 1 and a == b
    c2 = MerkmalCache()  # persisted
    assert merkmale(_datei(p, tmp_path), c2) == a and c2.gehasht == 0
    p.write_bytes(p.read_bytes() + b"\0")  # changed -> rehash (still readable)
    merkmale(_datei(p, tmp_path), c2)
    assert c2.gehasht == 1


def test_tags_and_camelot(tmp_path):
    FLAC = pytest.importorskip("mutagen.flac").FLAC  # mutagen is optional: without it the tag tests are skipped
    p = _flac(tmp_path / "Music" / "s.flac")
    f = FLAC(p)
    f["title"], f["artist"], f["bpm"], f["initialkey"] = "Song", "Art", "128", "Am"
    f["date"], f["album"], f["organization"], f["genre"], f["isrc"] = "2019-05-01", "Alb", "Lab", "Techno", "DE123"
    f.save()
    m = merkmale(_datei(p, tmp_path), MerkmalCache())
    assert abs(m.dauer_s - 0.5) < 0.01 and len(m.sha) == 64
    assert m.tags["title"] == "Song" and m.tags["bpm"] == "128" and m.tags["camelot"] == "8A"
    d = felder(_datei(p, tmp_path), "track", m)
    assert (d["titel"], d["kuenstler"], d["jahr"], d["release"], d["label"], d["isrc"], d["camelot"], d["bpm"]) == \
        ("Song", "Art", "2019", "Alb", "Lab", "DE123", "8A", 128.0)
    assert d["sha"] == d["shas"] == m.sha and d["werk_id"] is None and d["ordner"] == str(p.parent)


def test_without_mutagen_soundfile_gives_duration(tmp_path, monkeypatch, capsys):
    p = _flac(tmp_path / "a.flac", 1.0)
    _verberge(monkeypatch, "mutagen", "mutagen.easy", "mutagen.mp3")
    m = merkmale(_datei(p, tmp_path), MerkmalCache())
    assert abs(m.dauer_s - 1.0) < 0.01 and m.tags == {}
    assert "mutagen not installed" in capsys.readouterr().err
    assert "soundfile" in lesewerkzeuge() and "mutagen" not in lesewerkzeuge()


def test_ffprobe_fallback(tmp_path, monkeypatch):
    p = _flac(tmp_path / "a.flac", 1.0)
    _verberge(monkeypatch, "mutagen", "mutagen.easy", "soundfile")
    m = merkmale(_datei(p, tmp_path), MerkmalCache())
    assert abs(m.dauer_s - 1.0) < 0.05


def test_no_tool_at_all(tmp_path, monkeypatch):
    p = _flac(tmp_path / "a.flac")
    _verberge(monkeypatch, "mutagen", "mutagen.easy", "soundfile")
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))
    assert lesewerkzeuge() == []
    with pytest.raises(WerkzeugFehlt):
        merkmale(_datei(p, tmp_path), MerkmalCache())


def test_felder_loop(tmp_path):
    from bibliothek.features import Merkmale
    root = tmp_path
    p = root / "Pack" / "Drums" / "Kick_Loop 126bpm.wav"
    p.parent.mkdir(parents=True)
    p.write_bytes(b"x")
    m = Merkmale("a" * 64, 3.81, {})
    d = felder(_datei(p, root), "loop", m)
    assert d["pack"] == "Pack" and d["kategorie"] == "Drums" and d["instrument"] == "kick"
    assert d["bpm"] == 126.0 and d["takte"] == round(3.81 * 126 / 240, 2) and d["name"] == "Kick_Loop 126bpm"
    assert d["titel"] == "Kick_Loop 126bpm" and "Pack" in d["alle"].split(" ")


def test_felder_track_takes_a_bare_bpm_at_the_end_of_the_name(tmp_path):
    """Kanban t_747a905b: 'Abnahme Eins 128.wav' is a track with BPM 128; a one-shot named 'Kick 90' stays without."""
    from bibliothek.features import Merkmale
    p = tmp_path / "Musik" / "Abnahme Eins 128.wav"
    p.parent.mkdir(parents=True)
    p.write_bytes(b"x")
    assert felder(_datei(p, tmp_path), "track", Merkmale("a" * 64, 75.0, {}))["bpm"] == 128.0
    assert felder(_datei(p, tmp_path), "oneshot", Merkmale("a" * 64, 0.4, {}))["bpm"] is None
    assert felder(_datei(p, tmp_path), "track", Merkmale("a" * 64, 75.0, {"bpm": "126"}))["bpm"] == 126.0, "tag wins"


# ---- review fixes (round 1) -----------------------------------------------------------------------------------------

def test_i2_tags_are_read_later_when_mutagen_appears_without_rehashing(tmp_path, monkeypatch):
    FLAC = pytest.importorskip("mutagen.flac").FLAC  # mutagen is optional: without it the tag tests are skipped
    p = _flac(tmp_path / "s.flac")
    f = FLAC(p)
    f["title"], f["bpm"] = "Later", "127"
    f.save()
    c = MerkmalCache()
    with monkeypatch.context() as m:
        _verberge(m, "mutagen", "mutagen.easy", "mutagen.mp3")
        ohne = merkmale(_datei(p, tmp_path), c)
    assert ohne.tags == {} and c.gehasht == 1
    mit = merkmale(_datei(p, tmp_path), c)  # mutagen is back: same cache entry, tags read now
    assert mit.tags["title"] == "Later" and mit.tags["bpm"] == "127"
    assert mit.sha == ohne.sha and c.gehasht == 1
    c2 = MerkmalCache()  # persisted, and not read a third time
    assert merkmale(_datei(p, tmp_path), c2).tags["title"] == "Later" and c2.gehasht == 0


def test_i2_old_cache_with_an_entry_is_upgraded_and_still_hits(tmp_path):
    import sqlite3
    FLAC = pytest.importorskip("mutagen.flac").FLAC  # mutagen is optional: without it the tag tests are skipped
    p = _flac(tmp_path / "s.flac")
    f = FLAC(p)
    f["title"] = "T"
    f.save()
    d = _datei(p, tmp_path)
    erst = MerkmalCache(tmp_path / "neu.sqlite")
    sha = merkmale(d, erst).sha
    erst.schliessen()
    pfad = tmp_path / "alt.sqlite"  # the old layout (no marker column) holding a real entry for this file
    db = sqlite3.connect(pfad)
    db.execute("CREATE TABLE merkmale(pfad TEXT NOT NULL, groesse INTEGER NOT NULL, mtime_ns INTEGER NOT NULL, sha TEXT NOT NULL, "
               "dauer_s REAL NOT NULL, tags TEXT NOT NULL, PRIMARY KEY(pfad, groesse, mtime_ns))")
    db.execute("INSERT INTO merkmale VALUES (?, ?, ?, ?, 1.0, '{}')", (str(d.pfad), d.groesse, d.mtime_ns, sha))
    db.commit()
    db.close()
    c = MerkmalCache(pfad)
    assert "tags_gelesen" in [r[1] for r in c._db.execute("PRAGMA table_info(merkmale)")]
    m = merkmale(d, c)
    assert c.gehasht == 0 and m.sha == sha  # the old entry still hits: nothing hashed again
    assert m.tags["title"] == "T"  # tags were not marked as read in the old entry: read now


def test_i5_default_cache_path_is_under_the_test_home(tmp_path):
    import os
    home = Path(os.environ["HOME"])
    p = _flac(tmp_path / "a.flac")
    c = MerkmalCache()
    merkmale(_datei(p, tmp_path), c)
    c.schliessen()
    datei = home / ".cache" / "cypherdj" / "bibliothek" / "merkmale.sqlite"
    assert datei.is_file()
    c2 = MerkmalCache()  # a second object on the default cache hits the entry of the first
    assert merkmale(_datei(p, tmp_path), c2) is not None and c2.gehasht == 0


def test_i5_cache_env_override(tmp_path, monkeypatch):
    ziel = tmp_path / "x" / "c.sqlite"
    monkeypatch.setenv("CYPHERDJ_BIBLIOTHEK_CACHE", str(ziel))
    MerkmalCache().schliessen()
    assert ziel.is_file()


def test_broken_tags_json_in_the_cache_is_a_miss_not_an_exception(tmp_path):
    p = _flac(tmp_path / "a.flac")
    c = MerkmalCache(tmp_path / "c.sqlite")
    a = merkmale(_datei(p, tmp_path), c)
    c._db.execute("UPDATE merkmale SET tags = '{kaputt'")
    c._db.commit()
    b = merkmale(_datei(p, tmp_path), c)
    assert b.sha == a.sha and c.gehasht == 2  # read again
    c._db.execute("UPDATE merkmale SET tags = '[1, 2]'")  # valid JSON but not a dict
    c._db.commit()
    assert merkmale(_datei(p, tmp_path), c).sha == a.sha


@pytest.mark.parametrize("wert", ["inf", "-inf", "nan", "0", "-5", "abc"])
def test_bad_bpm_tag_is_dropped(tmp_path, wert):
    FLAC = pytest.importorskip("mutagen.flac").FLAC  # mutagen is optional: without it the tag tests are skipped
    p = _flac(tmp_path / "s.flac")
    f = FLAC(p)
    f["bpm"] = wert
    f.save()
    m = merkmale(_datei(p, tmp_path), MerkmalCache())
    assert "bpm" not in m.tags


@pytest.mark.parametrize("wert", ["inf", "nan", "0", "-5", "abc"])
def test_bad_bpm_tag_in_old_cache_data_falls_back_to_the_name(tmp_path, wert):
    from bibliothek.features import Merkmale
    p = tmp_path / "Pack" / "Bass_124bpm.wav"
    p.parent.mkdir()
    p.write_bytes(b"x")
    d = felder(_datei(p, tmp_path), "loop", Merkmale("a" * 64, 7.74, {"bpm": wert}))
    assert d["bpm"] == 124.0 and d["takte"] == round(7.74 * 124 / 240, 2)


@pytest.mark.parametrize("name,erwartet", [
    ("BD_01.wav", "kick"), ("sd 02.wav", "snare"), ("CP.wav", "clap"), ("Rim 3.wav", "rim"), ("HH_closed.wav", "hihat"),
    ("OH_open.wav", "hihat"), ("CR 1.wav", "crash"), ("RD.wav", "ride"), ("HT.wav", "tom"), ("MT.wav", "tom"), ("LT-2.wav", "tom"),
    ("Kits/BD/01.wav", "kick"),
])
def test_starter_abbreviations_are_instruments(tmp_path, name, erwartet):
    from bibliothek.features import Merkmale
    p = tmp_path / "Pack" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"x")
    d = felder(_datei(p, tmp_path), "oneshot", Merkmale("a" * 64, 0.3, {}))
    assert d["instrument"] == erwartet


@pytest.mark.parametrize("name", ["Abdomen.wav", "Scrap 1.wav", "Crowd.wav", "Hotel.wav", "Ordinary.wav", "Brim.wav"])
def test_abbreviations_are_whole_tokens_only(tmp_path, name):
    from bibliothek.features import Merkmale
    p = tmp_path / "Pack" / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"x")
    assert felder(_datei(p, tmp_path), "oneshot", Merkmale("a" * 64, 0.3, {}))["instrument"] is None


@pytest.mark.parametrize("rel,erwartet", [
    ("Pack/RD-9 Kick.wav", "kick"), ("Pack/CR-78 Kick.wav", "kick"), ("Pack/MT-32 Pad.wav", "pad"),
    ("Vocals/Oh Yeah.wav", "vocal"), ("SD Card Export/Take 1.wav", None), ("SD Card Export/Kick 1.wav", "kick"),
    ("Pack/RD-9.wav", None), ("Pack/CR-78.wav", None), ("Pack/cr78.wav", None), ("Pack/MT-32.wav", None),
    ("Pack/Snare/BD 01.wav", "snare"),  # a spelled-out folder beats an abbreviation in the file name
    ("Pack/Kick/SD 01.wav", "kick"),
    ("Pack/bd/01.wav", "kick"), ("oh/x.wav", "hihat"), ("Pack/sd/Take.wav", "snare"),
    ("Pack/Kits/SD Card/BD.wav", "kick"),
])
def test_device_names_and_card_folders_are_not_instruments(tmp_path, rel, erwartet):
    from bibliothek.features import Merkmale
    p = tmp_path / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"x")
    assert felder(_datei(p, tmp_path), "oneshot", Merkmale("a" * 64, 0.3, {}))["instrument"] == erwartet


def test_starter_kit_files_keep_their_instrument(tmp_path):
    """Every file the starter kits write (oneshots/<909|808>/<name with : as ->.wav) keeps the instrument its name says."""
    import json
    from bibliothek.features import Merkmale
    erwartet = {"bd": "kick", "sd": "snare", "hh": "hihat", "oh": "hihat", "cp": "clap", "rim": "rim", "cr": "crash",
                "rd": "ride", "ht": "tom", "mt": "tom", "lt": "tom", "perc": "perc"}
    kits = json.loads((Path(__file__).resolve().parents[2] / "starter" / "kits.json").read_text())
    for kit in kits:
        fam = kit["graph"].split("-")[-1]
        for k in kit["klaenge"]:
            name = k["name"].replace(":", "-") + ".wav"
            p = tmp_path / "klaenge" / "oneshots" / fam / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b"x")
            d = felder(_datei(p, tmp_path / "klaenge"), "oneshot", Merkmale("a" * 64, 0.3, {}))
            assert d["instrument"] == erwartet[k["name"].split(":")[0]], name
