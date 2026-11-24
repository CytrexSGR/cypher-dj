"""zipwerk.entpacke: a safe unpack for imported zips (browser plan 1, task 2). Zips are built with zipfile in tmp_path."""
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import zipwerk  # noqa: E402


def mach_zip(pfad: Path, eintraege: dict, symlinks: dict | None = None) -> Path:
    with zipfile.ZipFile(pfad, "w") as z:
        for name, inhalt in eintraege.items():
            z.writestr(name, inhalt)
        for name, ziel in (symlinks or {}).items():
            zi = zipfile.ZipInfo(name)
            zi.external_attr = (0o120777 << 16)
            z.writestr(zi, ziel)
    return pfad


def test_entry_count_from_the_end_record_is_refused_before_parsing(tmp_path, monkeypatch):
    z = mach_zip(tmp_path / "viele.zip", {f"{i}.wav": b"" for i in range(30)})
    monkeypatch.setattr(zipfile, "ZipFile", lambda *a, **k: pytest.fail("the directory was parsed"))
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.pruefe(z, max_eintraege=20)
    assert e.value.grund == "zu_viele_eintraege"


def test_encrypted_entry_is_refused(tmp_path):
    z = mach_zip(tmp_path / "e.zip", {"a.wav": b"x"})
    roh = bytearray(z.read_bytes())
    for sig, off in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        i = roh.find(sig)
        roh[i + off] |= 1
    z.write_bytes(bytes(roh))
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.entpacke(z, tmp_path / "out")
    assert e.value.grund == "verschluesselt" and not (tmp_path / "out").exists()


def test_file_and_folder_with_the_same_path_exit_2_without_leftovers(tmp_path):
    z = tmp_path / "k.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("a", b"x")
        zf.writestr("a/b.wav", b"y")
    r = subprocess.run([sys.executable, str(TOOLS / "zipwerk.py"), "entpacke", str(z), str(tmp_path / "out")], capture_output=True, text=True)
    assert r.returncode == 2 and json.loads(r.stdout) == {"abgelehnt": "namenskonflikt"} and "Traceback" not in r.stderr
    assert not (tmp_path / "out").exists() and [p.name for p in tmp_path.iterdir() if p.name.endswith(".teil")] == []


def test_entpacke_unpacks_into_the_target_folder_and_counts_entries(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {"kick.wav": b"k", "sub/snare.wav": b"s", "readme.txt": b"t"})
    r = zipwerk.entpacke(z, tmp_path / "out")
    assert r["eintraege"] == 3 and r["uebersprungen"] == []
    assert (tmp_path / "out" / "sub" / "snare.wav").read_bytes() == b"s"
    assert r["hat_kit_json"] is False and r["hat_projekt_json"] is False
    assert r["ordner"] == str(tmp_path / "out")


def test_nur_medien_skips_other_files_and_lists_them(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {"kick.wav": b"k", "notes.txt": b"t", "m/song.MID": b"m"})
    r = zipwerk.entpacke(z, tmp_path / "out", nur_medien=True)
    assert r["eintraege"] == 2
    assert r["uebersprungen"] == [{"name": "notes.txt", "grund": "typ_unbekannt"}]
    assert not (tmp_path / "out" / "notes.txt").exists()


def test_entry_with_dotdot_refuses_the_whole_zip_and_the_target_does_not_exist(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {"ok.wav": b"k", "../evil.wav": b"e"})
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.entpacke(z, tmp_path / "out")
    assert e.value.grund == "pfad_verlaesst_ordner"
    assert not (tmp_path / "out").exists() and not (tmp_path / "evil.wav").exists()
    assert [p.name for p in tmp_path.iterdir()] == ["a.zip"], "no temp folder is left behind"


def test_absolute_path_entry_refuses(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {"/etc/x.wav": b"e"})
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.entpacke(z, tmp_path / "out")
    assert e.value.grund == "pfad_absolut"
    assert not (tmp_path / "out").exists()


def test_symlink_entry_is_skipped_and_listed_regular_entries_still_unpacked(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {"kick.wav": b"k"}, symlinks={"link.wav": "/etc/passwd"})
    r = zipwerk.entpacke(z, tmp_path / "out")
    assert r["eintraege"] == 1
    assert r["uebersprungen"] == [{"name": "link.wav", "grund": "symlink"}]
    assert not (tmp_path / "out" / "link.wav").exists() and (tmp_path / "out" / "kick.wav").exists()


def test_nested_zip_is_unpacked_as_a_plain_file_not_recursed(tmp_path):
    innen = mach_zip(tmp_path / "innen.zip", {"deep.wav": b"d"})
    z = mach_zip(tmp_path / "a.zip", {"pack/innen.zip": innen.read_bytes(), "kick.wav": b"k"})
    r = zipwerk.entpacke(z, tmp_path / "out")
    assert (tmp_path / "out" / "pack" / "innen.zip").is_file()
    assert not (tmp_path / "out" / "pack" / "deep.wav").exists()
    assert r["eintraege"] == 2


def test_too_many_entries_refuses(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {f"{i}.wav": b"x" for i in range(4)})
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.entpacke(z, tmp_path / "out", max_eintraege=3)
    assert e.value.grund == "zu_viele_eintraege"
    assert not (tmp_path / "out").exists()


def test_declared_size_above_the_cap_refuses(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {"a.wav": b"x" * 100})
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.entpacke(z, tmp_path / "out", max_bytes=50)
    assert e.value.grund == "zu_gross_entpackt"
    assert not (tmp_path / "out").exists()


def test_an_entry_that_lies_about_its_size_stops_at_the_counter_and_the_folder_is_removed(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {"a.wav": b"x" * 100})
    # rewrite the declared uncompressed size in the central directory (and local header) to 10 bytes
    roh = bytearray(z.read_bytes())
    gross = (100).to_bytes(4, "little"); klein = (10).to_bytes(4, "little")
    i = 0
    while True:
        i = roh.find(gross, i)
        if i < 0:
            break
        roh[i:i + 4] = klein
        i += 4
    z.write_bytes(bytes(roh))
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.entpacke(z, tmp_path / "out", max_bytes=50)
    assert e.value.grund in ("zu_gross_entpackt", "zip_kaputt")
    assert [p.name for p in tmp_path.iterdir()] == ["a.zip"]


def test_kit_json_and_project_json_at_the_top(tmp_path):
    k = mach_zip(tmp_path / "k.zip", {"kit.json": b"{}", "a.wav": b"x"})
    assert zipwerk.pruefe(k)["hat_kit_json"] is True
    ordner = mach_zip(tmp_path / "k2.zip", {"mykit/kit.json": b"{}", "mykit/a.wav": b"x"})
    assert zipwerk.pruefe(ordner)["hat_kit_json"] is True
    p = mach_zip(tmp_path / "p.zip", {"project.json": b"{}"})
    r = zipwerk.pruefe(p)
    assert r["hat_projekt_json"] is True and r["hat_kit_json"] is False
    tief = mach_zip(tmp_path / "t.zip", {"a/b/kit.json": b"{}", "x.wav": b"x"})
    assert zipwerk.pruefe(tief)["hat_kit_json"] is False


def test_non_utf8_entry_names_do_not_crash(tmp_path):
    class Roh(zipfile.ZipInfo):
        def _encodeFilenameFlags(self):   # a raw cp437 name without the UTF-8 flag, as old zip tools write it
            return b"K\x81che.wav", self.flag_bits
    z = tmp_path / "a.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr(Roh("x.wav"), b"x")
    r = zipwerk.entpacke(z, tmp_path / "out")
    assert r["eintraege"] == 1


def test_command_line_prints_json_and_exits_2_when_refused(tmp_path):
    z = mach_zip(tmp_path / "a.zip", {"kick.wav": b"k"})
    ok = subprocess.run([sys.executable, str(TOOLS / "zipwerk.py"), "entpacke", str(z), str(tmp_path / "out"), "--nur-medien"], capture_output=True, text=True)
    assert ok.returncode == 0 and json.loads(ok.stdout)["eintraege"] == 1
    schlecht = mach_zip(tmp_path / "b.zip", {"../x.wav": b"k"})
    nein = subprocess.run([sys.executable, str(TOOLS / "zipwerk.py"), "entpacke", str(schlecht), str(tmp_path / "out2")], capture_output=True, text=True)
    assert nein.returncode == 2 and json.loads(nein.stdout) == {"abgelehnt": "pfad_verlaesst_ordner"}
    assert not (tmp_path / "out2").exists()
    assert os.path.exists(tmp_path / "out")


# ---- browser plan 5, task 1: packe and groesse ----

def baum(wurzel: Path, dateien: dict) -> Path:
    for name, inhalt in dateien.items():
        p = wurzel / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(inhalt)
    return wurzel


def lies(wurzel: Path) -> dict:
    return {p.relative_to(wurzel).as_posix(): p.read_bytes() for p in sorted(wurzel.rglob("*")) if p.is_file()}


def test_pack_roundtrip_through_entpacke_keeps_tree_and_bytes(tmp_path):
    inhalt = {"project.json": b"{}", "audio/a.wav": os.urandom(5000), "kits/k/kit.json": b"{}", "ümlaut dir/x y.f32": b"\0\1\2"}
    q = baum(tmp_path / "q", inhalt)
    r = zipwerk.packe(q, tmp_path / "o.zip")
    assert r["eintraege"] == 4 and r["ausgelassen"] == [] and r["uebersprungen"] == []
    zipwerk.entpacke(tmp_path / "o.zip", tmp_path / "aus")
    assert lies(tmp_path / "aus") == inhalt
    assert not list(tmp_path.glob("*.teil"))


def test_pack_excludes(tmp_path):
    q = baum(tmp_path / "q", {"a.json": b"1", ".versionen/a/b": b"2", "x.tmp": b"3", "sub/.versionen/c": b"4", "sub/y.tmp": b"5"})
    r = zipwerk.packe(q, tmp_path / "o.zip", ohne=[".versionen/", "*.tmp"])
    with zipfile.ZipFile(tmp_path / "o.zip") as z:
        assert z.namelist() == ["a.json"]
    assert ".versionen/" in r["ausgelassen"] and "x.tmp" in r["ausgelassen"] and "sub/.versionen/" in r["ausgelassen"]


def test_pack_follows_symlinked_file_skips_symlinked_dir(tmp_path):
    q = baum(tmp_path / "q", {"a.txt": b"A"})
    fremd = baum(tmp_path / "fremd", {"b.txt": b"B"})
    os.symlink(fremd / "b.txt", q / "link.txt")
    os.symlink(fremd, q / "linkdir")
    r = zipwerk.packe(q, tmp_path / "o.zip")
    with zipfile.ZipFile(tmp_path / "o.zip") as z:
        assert sorted(z.namelist()) == ["a.txt", "link.txt"]
        assert z.read("link.txt") == b"B"
    assert r["uebersprungen"] == [{"name": "linkdir", "grund": "symlink_ordner"}]


def test_pack_root_may_be_symlink(tmp_path):
    echt = baum(tmp_path / "echt", {"p.json": b"{}"})
    os.symlink(echt, tmp_path / "proj")
    zipwerk.packe(tmp_path / "proj", tmp_path / "o.zip")
    with zipfile.ZipFile(tmp_path / "o.zip") as z:
        assert z.namelist() == ["p.json"]


def test_pack_entry_cap(tmp_path):
    q = baum(tmp_path / "q", {f"{i}": b"x" for i in range(4)})
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.packe(q, tmp_path / "o.zip", max_eintraege=3)
    assert e.value.grund == "zu_viele_eintraege"
    assert not (tmp_path / "o.zip").exists() and not (tmp_path / "o.zip.teil").exists()


def test_pack_byte_cap_and_missing_folder(tmp_path):
    q = baum(tmp_path / "q", {"a": b"x" * 100})
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.packe(q, tmp_path / "o.zip", max_bytes=50)
    assert e.value.grund == "zu_gross_entpackt"
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.packe(tmp_path / "nix", tmp_path / "o.zip")
    assert e.value.grund == "ordner_fehlt"


def test_pack_target_exists_refused(tmp_path):
    q = baum(tmp_path / "q", {"a": b"x"})
    (tmp_path / "o.zip").write_bytes(b"alt")
    with pytest.raises(zipwerk.Abgelehnt) as e:
        zipwerk.packe(q, tmp_path / "o.zip")
    assert e.value.grund == "ziel_belegt"
    assert (tmp_path / "o.zip").read_bytes() == b"alt"


def test_pack_cli_json_line_and_exit_codes(tmp_path):
    q = baum(tmp_path / "q", {"a": b"x", "b.tmp": b"y"})
    ok = subprocess.run([sys.executable, str(TOOLS / "zipwerk.py"), "packen", str(q), str(tmp_path / "o.zip"), "--ohne", "*.tmp"], capture_output=True, text=True)
    assert ok.returncode == 0 and json.loads(ok.stdout)["eintraege"] == 1 and len(ok.stdout.strip().splitlines()) == 1
    nein = subprocess.run([sys.executable, str(TOOLS / "zipwerk.py"), "packen", str(q), str(tmp_path / "o.zip")], capture_output=True, text=True)
    assert nein.returncode == 2 and json.loads(nein.stdout) == {"abgelehnt": "ziel_belegt"}


def test_groesse_sums_declared_sizes_and_writes_nothing(tmp_path):
    z = mach_zip(tmp_path / "g.zip", {"a": b"x" * 10, "d/b": b"y" * 5})
    vorher = sorted(os.listdir(tmp_path))
    assert zipwerk.groesse(z) == {"eintraege": 2, "bytes": 15}
    out = subprocess.run([sys.executable, str(TOOLS / "zipwerk.py"), "groesse", str(z)], capture_output=True, text=True)
    assert json.loads(out.stdout) == {"eintraege": 2, "bytes": 15}
    assert sorted(os.listdir(tmp_path)) == vorher


def test_pack_order_is_sorted_folders_and_files(tmp_path):
    q = baum(tmp_path / "q", {"z/b": b"1", "a/y": b"2", "a/x": b"3", "m.txt": b"4", "b/c/d": b"5"})
    zipwerk.packe(q, tmp_path / "o.zip")
    with zipfile.ZipFile(tmp_path / "o.zip") as z:
        assert z.namelist() == ["m.txt", "a/x", "a/y", "b/c/d", "z/b"]


def test_pack_nur_packs_only_the_named_files(tmp_path):
    q = baum(tmp_path / "q", {"kit.json": b"{}", "a.f32": b"1", "stray.f32": b"2", "sub/a.f32": b"3"})
    r = zipwerk.packe(q, tmp_path / "o.zip", nur={"kit.json", "a.f32"})
    with zipfile.ZipFile(tmp_path / "o.zip") as z:
        assert z.namelist() == ["a.f32", "kit.json"]
    assert r["eintraege"] == 2 and "stray.f32" in r["ausgelassen"]


def test_pack_dazu_adds_a_folder_under_a_prefix_without_dot_files_or_duplicates(tmp_path):
    q = baum(tmp_path / "q", {"project.json": b"{}", "kits/mine/kit.json": b"own"})
    extra = baum(tmp_path / "e", {"kit.json": b"global", "a.f32": b"1", ".hidden": b"x"})
    other = baum(tmp_path / "o", {"kit.json": b"theirs"})
    zipwerk.packe(q, tmp_path / "o.zip", dazu=[("kits/new", extra), ("kits/mine", other)])
    with zipfile.ZipFile(tmp_path / "o.zip") as z:
        assert z.namelist() == ["project.json", "kits/mine/kit.json", "kits/new/a.f32", "kits/new/kit.json"]
        assert z.read("kits/mine/kit.json") == b"own", "an entry the tree already holds is not replaced"


def test_pack_ersetze_stores_other_bytes_under_the_name(tmp_path):
    q = baum(tmp_path / "q", {"project.json": b"old", "a.txt": b"A"})
    neu = tmp_path / "neu.json"
    neu.write_bytes(b"newer content")
    r = zipwerk.packe(q, tmp_path / "o.zip", ersetze={"project.json": str(neu), "fehlt.json": str(neu)})
    with zipfile.ZipFile(tmp_path / "o.zip") as z:
        assert z.read("project.json") == b"newer content" and z.namelist() == ["a.txt", "project.json"]
    assert r["eintraege"] == 2
