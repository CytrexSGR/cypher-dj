"""Catalog build and the foreign-catalog guard (plan task 8, D4: never replace a catalog the builder did not build).

Every test works on catalogs it builds itself inside tmp_path (HOME is redirected by the autouse fixture of conftest.py).
"""
from __future__ import annotations

import hashlib
import os
import sqlite3
import struct
from pathlib import Path

import pytest

from bibliothek import catalog_build as katalog_bau
from bibliothek.catalog_build import DDL, FremderKatalog, WurzelFehlt, baue, eigener_katalog
from bibliothek.config import Konfig, Wurzel
from bibliothek.features import MerkmalCache


def wav_bytes(n: int, frames: int = 400) -> bytes:
    """A tiny valid 16 bit mono 8 kHz WAV whose content (and so sha256) depends on n."""
    daten = struct.pack("<h", n) + b"".join(struct.pack("<h", (n * 37 + i * 11) % 2000 - 1000) for i in range(1, frames))
    kopf = b"RIFF" + struct.pack("<I", 36 + len(daten)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16)
    return kopf + b"data" + struct.pack("<I", len(daten)) + daten


@pytest.fixture
def wurzel(tmp_path: Path) -> Wurzel:
    w = tmp_path / "musik"
    (w / "Loops").mkdir(parents=True)
    (w / "Drums").mkdir()
    (w / "Loops" / "DT_126_Groove.wav").write_bytes(wav_bytes(1, 8000))
    (w / "Drums" / "Kick 01.wav").write_bytes(wav_bytes(2))
    (w / "Drums" / "Snare 01.wav").write_bytes(wav_bytes(3))
    return Wurzel(w, "auto")


@pytest.fixture
def cache(tmp_path: Path) -> MerkmalCache:
    return MerkmalCache(tmp_path / "cache.sqlite")


def mache_katalog(pfad: Path, erbauer: str | None = "djk-bibliothek", wal: bool = False) -> Path:
    """A catalog with the schema of the page (DDL) and a `stand` table naming its builder."""
    pfad.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(pfad))
    if wal:
        db.execute("PRAGMA journal_mode=WAL")
    db.executescript(DDL)
    db.execute("INSERT INTO stand VALUES ('schema', '1')")
    if erbauer is not None:
        db.execute("INSERT INTO stand VALUES ('erbauer', ?)", (erbauer,))
    db.execute("INSERT INTO katalog(typ, sha, shas, name) VALUES ('track', 'alt', 'alt', 'old row')")
    db.commit()
    db.close()
    return pfad


def sha(pfad: Path) -> str:
    return hashlib.sha256(pfad.read_bytes()).hexdigest()


def bau(ziel: Path, wurzel: Wurzel, cache: MerkmalCache, zwischen=None, ohne_fehlende: bool = False):
    args = dict(ohne_fehlende=ohne_fehlende, fortschritt=lambda n: None)
    if zwischen is not None:
        args["_zwischen_pruefungen"] = zwischen
    return baue(ziel, Konfig(1, [wurzel]), cache, **args)


def keine_teile(ordner: Path) -> list[str]:
    return sorted(p.name for p in ordner.iterdir() if p.name.endswith(".teil") or p.name.endswith(".teil-journal"))


def zeilen(ziel: Path) -> int:
    db = sqlite3.connect(ziel.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        return db.execute("SELECT count(*) FROM katalog").fetchone()[0]
    finally:
        db.close()


# ---- guard: refusals (b), (c) -------------------------------------------------------------------------------------

def test_b_catalog_without_builder_row_is_foreign(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite", erbauer=None)
    vorher = sha(ziel)
    with pytest.raises(FremderKatalog) as e:
        bau(ziel, wurzel, cache)
    assert e.value.ziel == ziel
    assert sha(ziel) == vorher
    assert keine_teile(ziel.parent) == []


def test_c_other_builder_is_foreign(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite", erbauer="cypher-mediathek")
    vorher = sha(ziel)
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert sha(ziel) == vorher
    assert keine_teile(ziel.parent) == []


def test_c_zero_byte_file_is_foreign(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    ziel.parent.mkdir()
    ziel.write_bytes(b"")
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert ziel.read_bytes() == b""
    assert keine_teile(ziel.parent) == []


def test_c_text_file_is_foreign(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    ziel.parent.mkdir()
    ziel.write_text("this is somebody's notes file\n")
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert ziel.read_text() == "this is somebody's notes file\n"
    assert keine_teile(ziel.parent) == []


def test_c_directory_is_foreign(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    ziel.mkdir(parents=True)
    (ziel / "inhalt.txt").write_text("x")
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert sorted(p.name for p in ziel.iterdir()) == ["inhalt.txt"]
    assert keine_teile(ziel.parent) == []


def test_c_symlink_to_a_foreign_catalog_is_foreign(tmp_path, wurzel, cache):
    echt = mache_katalog(tmp_path / "privat" / "katalog.sqlite", erbauer="cypher-mediathek")
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    ziel.parent.mkdir()
    ziel.symlink_to(echt)
    vorher = sha(echt)
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert ziel.is_symlink() and os.readlink(ziel) == str(echt)
    assert sha(echt) == vorher
    assert keine_teile(ziel.parent) == []


def test_c_dangling_symlink_is_foreign(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    ziel.parent.mkdir()
    ziel.symlink_to(tmp_path / "gibt-es-nicht.sqlite")
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert ziel.is_symlink()
    assert not (tmp_path / "gibt-es-nicht.sqlite").exists()
    assert keine_teile(ziel.parent) == []


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads everything")
def test_c_unreadable_catalog_is_foreign(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    vorher = sha(ziel)
    ziel.chmod(0)
    try:
        with pytest.raises(FremderKatalog):
            bau(ziel, wurzel, cache)
    finally:
        ziel.chmod(0o644)
    assert sha(ziel) == vorher
    assert keine_teile(ziel.parent) == []


@pytest.mark.parametrize("name", ["a?b", "a#b", "a%b", "a?#%b c"])
def test_c_catalog_path_with_uri_characters_foreign_is_refused(tmp_path, wurzel, cache, name):
    ziel = mache_katalog(tmp_path / name / "katalog.sqlite", erbauer="cypher-mediathek")
    vorher = sha(ziel)
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert sha(ziel) == vorher
    assert keine_teile(ziel.parent) == []


@pytest.mark.parametrize("name", ["a?b", "a#b", "a%b", "a?#%b c"])
def test_catalog_path_with_uri_characters_own_is_replaced(tmp_path, wurzel, cache, name):
    ziel = mache_katalog(tmp_path / name / "katalog.sqlite")
    bau(ziel, wurzel, cache)
    assert zeilen(ziel) == 3  # the old row is gone, the three files are in


def test_foreign_wal_catalog_is_not_even_touched_by_the_check(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite", erbauer="cypher-mediathek", wal=True)
    vorher_dir = sorted(p.name for p in ziel.parent.iterdir())
    vorher = sha(ziel)
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert sorted(p.name for p in ziel.parent.iterdir()) == vorher_dir  # no -wal, -shm or .teil appeared
    assert sha(ziel) == vorher


def test_guard_function_results(tmp_path):
    assert eigener_katalog(tmp_path / "nein.sqlite") == (None, None)
    eigen, st = eigener_katalog(mache_katalog(tmp_path / "e.sqlite"))
    assert eigen is True and st is not None
    assert eigener_katalog(mache_katalog(tmp_path / "f.sqlite", erbauer="x"))[0] is False
    assert eigener_katalog(tmp_path)[0] is False


# ---- guard: replaced between the checks (d) -----------------------------------------------------------------------

def test_d_foreign_file_swapped_in_over_an_own_target(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    fremd = tmp_path / "fremd.sqlite"
    mache_katalog(fremd, erbauer="cypher-mediathek")
    fremd_sha = sha(fremd)

    def tausche():
        os.replace(fremd, ziel)  # new inode: someone else's catalog now sits at the target

    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache, zwischen=tausche)
    assert sha(ziel) == fremd_sha
    assert keine_teile(ziel.parent) == []


def test_d_foreign_content_written_in_place_into_an_own_target(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    st0 = os.lstat(ziel)

    def schreibe():
        db = sqlite3.connect(str(ziel))
        db.execute("UPDATE stand SET wert = 'cypher-mediathek' WHERE schluessel = 'erbauer'")
        db.commit()
        db.close()
        os.utime(ziel, ns=(st0.st_atime_ns, st0.st_mtime_ns + 5_000_000_000))

    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache, zwischen=schreibe)
    db = sqlite3.connect(str(ziel))
    assert db.execute("SELECT wert FROM stand WHERE schluessel='erbauer'").fetchone()[0] == "cypher-mediathek"
    db.close()
    assert keine_teile(ziel.parent) == []


def test_d_foreign_file_appears_at_an_absent_target(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    ziel.parent.mkdir()
    fremd = tmp_path / "fremd.sqlite"
    mache_katalog(fremd, erbauer="cypher-mediathek")
    fremd_sha = sha(fremd)

    def lege_hin():
        os.link(fremd, ziel)

    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache, zwischen=lege_hin)
    assert sha(ziel) == fremd_sha
    assert keine_teile(ziel.parent) == []


def test_d_directory_appears_at_an_absent_target(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    ziel.parent.mkdir()

    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache, zwischen=lambda: ziel.mkdir())
    assert ziel.is_dir() and list(ziel.iterdir()) == []
    assert keine_teile(ziel.parent) == []


def test_other_error_between_the_checks_removes_the_part_file(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"

    def kaputt():
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        bau(ziel, wurzel, cache, zwischen=kaputt)
    assert not ziel.exists()
    assert keine_teile(ziel.parent) == []


# ---- build: happy paths (a), missing roots (e), stale part files (f), cache (g) -------------------------------------

def test_a_own_catalog_is_replaced_and_the_target_is_new_when_absent(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"  # absent, folder absent too
    r = bau(ziel, wurzel, cache)
    assert r.ziel == ziel
    assert r.zeilen == {"track": 0, "loop": 1, "oneshot": 2}
    assert r.ausgelassen == {}
    assert keine_teile(ziel.parent) == []
    # second build over the own catalog replaces it again
    r2 = bau(ziel, wurzel, cache)
    assert r2.zeilen == r.zeilen
    db = sqlite3.connect(str(ziel))
    stand = dict(db.execute("SELECT schluessel, wert FROM stand"))
    assert stand["schema"] == "1" and stand["erbauer"] == "djk-bibliothek" and stand["quelle_mtime"] == "0"
    assert stand["gebaut_am"].endswith("+00:00") and stand["host"]
    assert str(wurzel.pfad) in stand["wurzeln"] and '"loop": 1' in stand["zaehlung"]
    assert db.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    assert db.execute("SELECT count(*) FROM katalog_fts WHERE katalog_fts MATCH 'kick'").fetchone()[0] == 1
    indizes = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert {"k_sha", "k_titel", "k_name", "k_instrument", "k_bpm", "k_ordner"} <= indizes
    db.close()


def test_a_existing_own_catalog_with_other_content_is_replaced(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    assert zeilen(ziel) == 1
    bau(ziel, wurzel, cache)
    assert zeilen(ziel) == 3
    assert keine_teile(ziel.parent) == []


def test_one_row_per_sha_first_path_in_sorted_order(tmp_path, wurzel, cache):
    (wurzel.pfad / "Drums" / "Kick 01 copy.wav").write_bytes((wurzel.pfad / "Drums" / "Kick 01.wav").read_bytes())
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    r = bau(ziel, wurzel, cache)
    assert sum(r.zeilen.values()) == 3
    db = sqlite3.connect(str(ziel))
    pfade = [x[0] for x in db.execute("SELECT pfad FROM katalog WHERE name LIKE 'Kick%'")]
    db.close()
    assert pfade == [str(wurzel.pfad / "Drums" / "Kick 01 copy.wav")]  # "Kick 01 copy.wav" < "Kick 01.wav"


def test_skipped_files_are_counted_by_reason(tmp_path, wurzel, cache):
    (wurzel.pfad / "leer.wav").write_bytes(b"")
    (wurzel.pfad / "kaputt.mp3").write_bytes(os.urandom(100))
    r = bau(tmp_path / "ziel" / "katalog.sqlite", wurzel, cache)
    assert r.ausgelassen == {"leer": 1, "kaputt": 1}
    assert sum(r.zeilen.values()) == 3


def test_e_missing_root_aborts_and_keeps_the_old_catalog(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    vorher = sha(ziel)
    weg = Wurzel(tmp_path / "abgesteckt", "auto")
    with pytest.raises(WurzelFehlt) as e:
        baue(ziel, Konfig(1, [wurzel, weg]), cache, ohne_fehlende=False, fortschritt=lambda n: None)
    assert e.value.pfad == str(weg.pfad)
    assert sha(ziel) == vorher
    assert keine_teile(ziel.parent) == []


def test_e_missing_root_with_ohne_fehlende_builds_and_names_it(tmp_path, wurzel, cache):
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    weg = Wurzel(tmp_path / "abgesteckt", "auto")
    r = baue(ziel, Konfig(1, [wurzel, weg]), cache, ohne_fehlende=True, fortschritt=lambda n: None)
    assert r.fehlende_wurzeln == [str(weg.pfad)]
    assert sum(r.zeilen.values()) == 3


def test_f_stale_part_file_is_removed_other_files_are_not(tmp_path, wurzel, cache):
    ordner = tmp_path / "target"
    ordner.mkdir()
    alt = ordner / ".katalog.sqlite.99999999.teil"
    alt.write_bytes(b"left behind")
    notiz = ordner / ".katalog.sqlite.notes"
    notiz.write_bytes(b"mine")
    lebt = ordner / f".katalog.sqlite.{os.getppid()}.teil"  # a part file of a process that is alive
    lebt.write_bytes(b"in use")
    bau(ordner / "katalog.sqlite", wurzel, cache)
    assert not alt.exists()
    assert notiz.read_bytes() == b"mine"
    assert lebt.read_bytes() == b"in use"


def test_g_second_build_of_5000_files_hashes_nothing(tmp_path, cache):
    w = tmp_path / "gross"
    for i in range(5000):
        ordner = w / f"p{i % 50}"
        ordner.mkdir(parents=True, exist_ok=True)
        (ordner / f"s{i}.wav").write_bytes(wav_bytes(i, 40))
    wz = Wurzel(w, "auto")
    gemeldet: list[int] = []
    ziel = tmp_path / "ziel" / "katalog.sqlite"
    r1 = baue(ziel, Konfig(1, [wz]), cache, ohne_fehlende=False, fortschritt=gemeldet.append)
    assert r1.gehasht == 5000 and sum(r1.zeilen.values()) == 5000
    assert gemeldet == [1000, 2000, 3000, 4000, 5000]
    r2 = baue(ziel, Konfig(1, [wz]), cache, ohne_fehlende=False, fortschritt=lambda n: None)
    assert r2.gehasht == 0 and sum(r2.zeilen.values()) == 5000


def test_the_guard_is_called_by_name_for_both_checks(tmp_path, wurzel, cache, monkeypatch):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    aufrufe: list[Path] = []
    echt = katalog_bau.eigener_katalog

    def zaehle(p):
        aufrufe.append(p)
        return echt(p)

    monkeypatch.setattr(katalog_bau, "eigener_katalog", zaehle)
    bau(ziel, wurzel, cache)
    assert len(aufrufe) == 2


# ---- review fixes (round 1) -----------------------------------------------------------------------------------------

def _dotdot_lage(tmp_path: Path, eigen_oben: bool):
    """<d>/link -> <d>/real/sub; one catalog at <d>/katalog.sqlite, one at <d>/real/katalog.sqlite."""
    d = tmp_path / "d"
    (d / "real" / "sub").mkdir(parents=True)
    (d / "link").symlink_to(d / "real" / "sub")
    oben = mache_katalog(d / "katalog.sqlite", erbauer="djk-bibliothek" if eigen_oben else "cypher-mediathek")
    unten = mache_katalog(d / "real" / "katalog.sqlite", erbauer="cypher-mediathek" if eigen_oben else "djk-bibliothek")
    ziel = Path(str(d / "link") + "/../katalog.sqlite")  # the kernel resolves this to <d>/real/katalog.sqlite
    return d, oben, unten, ziel


def keine_teile_baum(d: Path) -> list[str]:
    return sorted(str(p.relative_to(d)) for p in d.rglob("*") if p.name.endswith((".teil", ".teil-journal")))


def test_c1_dotdot_after_a_symlink_is_resolved_like_the_kernel_foreign_stays(tmp_path, wurzel, cache):
    d, eigen, fremd, ziel = _dotdot_lage(tmp_path, eigen_oben=True)
    vor_fremd, vor_eigen = sha(fremd), sha(eigen)
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache)
    assert sha(fremd) == vor_fremd and sha(eigen) == vor_eigen
    assert keine_teile_baum(d) == []


def test_c1_mirror_own_behind_the_symlink_is_replaced_the_other_is_untouched(tmp_path, wurzel, cache):
    d, fremd, eigen, ziel = _dotdot_lage(tmp_path, eigen_oben=False)
    vor_fremd = sha(fremd)
    bau(ziel, wurzel, cache)
    assert zeilen(eigen) == 3
    assert sha(fremd) == vor_fremd
    assert keine_teile_baum(d) == []


def test_c1_absent_target_behind_a_dotdot_is_built_where_the_kernel_points(tmp_path, wurzel, cache):
    d = tmp_path / "d"
    (d / "real" / "sub").mkdir(parents=True)
    (d / "link").symlink_to(d / "real" / "sub")
    fremd = mache_katalog(d / "katalog.sqlite", erbauer="cypher-mediathek")
    vor = sha(fremd)
    bau(Path(str(d / "link") + "/../katalog.sqlite"), wurzel, cache)
    assert zeilen(d / "real" / "katalog.sqlite") == 3 and sha(fremd) == vor


def test_c1_the_target_itself_is_not_followed(tmp_path, wurzel, cache):
    from bibliothek.catalog_build import kanonisch
    echt = tmp_path / "echt"
    echt.mkdir()
    (echt / "k.sqlite").write_bytes(b"x")
    (tmp_path / "ln").symlink_to(echt)
    (echt / "ziel-link").symlink_to(echt / "k.sqlite")
    assert kanonisch(tmp_path / "ln" / "ziel-link") == echt / "ziel-link"


# I1: an existing but empty root must not empty a filled own catalog

def test_i1_empty_root_over_a_filled_own_catalog_aborts_untouched(tmp_path, cache):
    from bibliothek.catalog_build import LeererBau
    leer = tmp_path / "empty"
    leer.mkdir()
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    vor = sha(ziel)
    with pytest.raises(LeererBau) as e:
        bau(ziel, Wurzel(leer, "auto"), cache)
    assert e.value.ziel == ziel and e.value.zeilen == 1
    assert sha(ziel) == vor and keine_teile(ziel.parent) == []


def test_i1_leer_erlaubt_empties_it(tmp_path, cache):
    leer = tmp_path / "empty"
    leer.mkdir()
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    r = baue(ziel, Konfig(1, [Wurzel(leer, "auto")]), cache, ohne_fehlende=False, fortschritt=lambda n: None, leer_erlaubt=True)
    assert sum(r.zeilen.values()) == 0 and zeilen(ziel) == 0


def test_i1_empty_build_is_fine_when_there_is_nothing_to_lose(tmp_path, cache):
    leer = tmp_path / "empty"
    leer.mkdir()
    absent = tmp_path / "a" / "katalog.sqlite"
    assert sum(bau(absent, Wurzel(leer, "auto"), cache).zeilen.values()) == 0
    assert zeilen(absent) == 0
    assert sum(bau(absent, Wurzel(leer, "auto"), cache).zeilen.values()) == 0  # own catalog with 0 rows: fine


def test_i1_all_roots_missing_with_ohne_fehlende_does_not_empty_either(tmp_path, cache):
    from bibliothek.catalog_build import LeererBau
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    vor = sha(ziel)
    with pytest.raises(LeererBau):
        bau(ziel, Wurzel(tmp_path / "abgesteckt", "auto"), cache, ohne_fehlende=True)
    assert sha(ziel) == vor


# I3: the second check has two parts; each is pinned on its own

def test_i3_content_part_alone_in_place_same_size_and_mtime(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    st0 = os.lstat(ziel)
    anderer = "other-builder!"
    assert len(anderer) == len("djk-bibliothek")

    def schreibe():
        db = sqlite3.connect(str(ziel))
        db.execute("UPDATE stand SET wert = ? WHERE schluessel = 'erbauer'", (anderer,))
        db.commit()
        db.close()
        os.utime(ziel, ns=(st0.st_atime_ns, st0.st_mtime_ns))
        st = os.lstat(ziel)
        assert (st.st_ino, st.st_size, st.st_mtime_ns) == (st0.st_ino, st0.st_size, st0.st_mtime_ns)  # the stat part sees nothing

    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache, zwischen=schreibe)
    db = sqlite3.connect(str(ziel))
    assert db.execute("SELECT wert FROM stand WHERE schluessel='erbauer'").fetchone()[0] == anderer
    db.close()
    assert keine_teile(ziel.parent) == []


def test_i3_stat_part_alone_inode_swap_with_an_own_looking_file(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    st0 = os.lstat(ziel)
    fremder_eigener = mache_katalog(tmp_path / "anderer.sqlite")  # looks like ours: the content part says "own"
    os.utime(fremder_eigener, ns=(st0.st_atime_ns, st0.st_mtime_ns))  # same mtime: only the inode differs
    vor = sha(fremder_eigener)

    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache, zwischen=lambda: os.replace(fremder_eigener, ziel))
    assert sha(ziel) == vor and keine_teile(ziel.parent) == []


def test_i3_stat_part_alone_mtime_changed_own_content(tmp_path, wurzel, cache):
    ziel = mache_katalog(tmp_path / "ziel" / "katalog.sqlite")
    st0 = os.lstat(ziel)
    vor = sha(ziel)
    with pytest.raises(FremderKatalog):
        bau(ziel, wurzel, cache, zwischen=lambda: os.utime(ziel, ns=(st0.st_atime_ns, st0.st_mtime_ns + 7_000_000_000)))
    assert sha(ziel) == vor


# I4: part file names

def test_i4_non_numeric_pid_name_is_kept(tmp_path, wurzel, cache):
    ordner = tmp_path / "target"
    ordner.mkdir()
    namen = [".katalog.sqlite.abc.teil", ".katalog.sqlite..teil", ".katalog.sqlite.1a.teil", ".katalog.sqlite.١٢.teil"]
    for n in namen:
        (ordner / n).write_bytes(b"not ours")
    bau(ordner / "katalog.sqlite", wurzel, cache)
    for n in namen:
        assert (ordner / n).read_bytes() == b"not ours"


def test_i4_huge_pid_in_the_name_raises_nothing_and_is_kept(tmp_path, wurzel, cache):
    ordner = tmp_path / "target"
    ordner.mkdir()
    gross = ordner / ".katalog.sqlite.99999999999999999999.teil"
    gross.write_bytes(b"x")
    bau(ordner / "katalog.sqlite", wurzel, cache)
    assert gross.read_bytes() == b"x"
