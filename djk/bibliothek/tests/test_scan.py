import os
import unicodedata
from pathlib import Path

from bibliothek.config import Wurzel
from bibliothek.scan import Auslassung, Datei, scanne


def _mach(p: Path, daten: bytes = b"x" * 10) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(daten)
    return p


def _scan(root: Path):
    w = Wurzel(root, "auto")
    erg = list(scanne(w))
    return ([e for e in erg if isinstance(e, Datei)], [e for e in erg if isinstance(e, Auslassung)])


def test_finds_audio_only_case_insensitive(tmp_path):
    for n in ["a.wav", "b.AIF", "c.aiff", "d.aifc", "e.flac", "f.MP3", "g.ogg", "h.opus", "i.m4a", "j.txt", "k.wav.bak"]:
        _mach(tmp_path / n)
    d, a = _scan(tmp_path)
    assert sorted(x.rel for x in d) == ["a.wav", "b.AIF", "c.aiff", "d.aifc", "e.flac", "f.MP3", "g.ogg", "h.opus", "i.m4a"]
    assert a == []


def test_datei_fields(tmp_path):
    p = _mach(tmp_path / "Pack" / "Kick.wav", b"y" * 33)
    d, _ = _scan(tmp_path)
    assert d[0].pfad == p and d[0].rel == "Pack/Kick.wav" and d[0].groesse == 33
    assert d[0].mtime_ns == p.stat().st_mtime_ns and d[0].wurzel.pfad == tmp_path


def test_zero_byte_is_leer(tmp_path):
    p = _mach(tmp_path / "z.wav", b"")
    d, a = _scan(tmp_path)
    assert d == [] and [(x.pfad, x.grund) for x in a] == [(str(p), "leer")]


def test_chmod_000_is_unlesbar(tmp_path):
    p = _mach(tmp_path / "x.wav")
    p.chmod(0)
    try:
        d, a = _scan(tmp_path)
    finally:
        p.chmod(0o644)
    assert d == [] and [(x.pfad, x.grund) for x in a] == [(str(p), "unlesbar")]


def test_broken_symlink_is_unlesbar(tmp_path):
    l = tmp_path / "gone.wav"
    l.symlink_to(tmp_path / "nowhere.wav")
    d, a = _scan(tmp_path)
    assert d == [] and [(x.pfad, x.grund) for x in a] == [(str(l), "unlesbar")]


def test_symlink_loop_ends(tmp_path):
    _mach(tmp_path / "sub" / "ok.wav")
    (tmp_path / "sub" / "loop").symlink_to(tmp_path)
    (tmp_path / "self.wav").symlink_to(tmp_path / "self.wav")
    d, a = _scan(tmp_path)
    assert [x.rel for x in d] == ["sub/ok.wav"]
    assert [x.grund for x in a] == ["unlesbar"]


def test_symlink_to_file_is_followed(tmp_path):
    t = _mach(tmp_path / "real.dat")
    (tmp_path / "link.wav").symlink_to(t)
    d, _ = _scan(tmp_path)
    assert [x.rel for x in d] == ["link.wav"]


def test_odd_names_exact(tmp_path):
    nfd = unicodedata.normalize("NFD", "é") + ".wav"
    namen = ['Ä Ü "q" 50% a_b ?#.wav', nfd]
    for n in namen:
        _mach(tmp_path / n)
    d, a = _scan(tmp_path)
    assert a == []
    assert sorted(x.rel for x in d) == sorted(namen)
    assert sorted(os.fsdecode(os.fsencode(x.pfad)) for x in d) == sorted(str(tmp_path / n) for n in namen)
    assert any(x.rel == nfd for x in d)  # not normalised


def test_non_utf8_name_is_pfad_kodierung(tmp_path):
    raw = os.fsencode(tmp_path) + b"/bad\xff.wav"
    with open(raw, "wb") as f:
        f.write(b"x")
    d, a = _scan(tmp_path)
    assert d == []
    assert len(a) == 1 and a[0].grund == "pfad_kodierung" and a[0].pfad == repr(os.fsdecode(raw))


def test_hidden_not_visited(tmp_path):
    _mach(tmp_path / ".hidden" / "x.wav")
    _mach(tmp_path / ".h.wav")
    _mach(tmp_path / "v.wav")
    d, a = _scan(tmp_path)
    assert [x.rel for x in d] == ["v.wav"] and a == []


def test_missing_root_raises(tmp_path):
    import pytest
    with pytest.raises(FileNotFoundError):
        list(scanne(Wurzel(tmp_path / "nope", "auto")))


def test_unreadable_subdirectory_is_counted_unlesbar(tmp_path):
    import os
    import pytest
    if os.geteuid() == 0:
        pytest.skip("root reads everything")
    _mach(tmp_path / "ok.wav")
    _mach(tmp_path / "zu" / "versteckt.wav")
    (tmp_path / "zu").chmod(0)
    try:
        dateien, aus = _scan(tmp_path)
    finally:
        (tmp_path / "zu").chmod(0o755)
    assert [d.rel for d in dateien] == ["ok.wav"]
    assert [(a.pfad, a.grund) for a in aus] == [(str(tmp_path / "zu"), "unlesbar")]


def test_unreadable_root_is_counted_unlesbar(tmp_path):
    import os
    import pytest
    if os.geteuid() == 0:
        pytest.skip("root reads everything")
    r = tmp_path / "wurzel"
    _mach(r / "a.wav")
    r.chmod(0)
    try:
        dateien, aus = _scan(r)
    finally:
        r.chmod(0o755)
    assert dateien == [] and [(a.pfad, a.grund) for a in aus] == [(str(r), "unlesbar")]
