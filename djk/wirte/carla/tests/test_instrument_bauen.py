import re

import pytest

import instrument_bauen as ib


def quelle(tmp_path, toene=("C3", "A# 1", "C#0", "G#6"), stufen=("p", "mf", "f", "ff")):
    q = tmp_path / "Grand Piano"
    q.mkdir()
    for t in toene:
        for s in stufen:
            (q / f"GrandPiano {t} {s}.aif").write_bytes(b"FORM")
            (q / f"GrandPiano {t} {s}.aif.asd").write_bytes(b"x")  # Live-Analysedatei, gehört nicht ins Instrument
    return q


def regionen(sfz):
    return [dict(re.findall(r"(\w+)=(\S+)", z)) for z in sfz.read_text().splitlines() if z.startswith("<region>")]


def test_tonnamen_nach_ableton_c3_ist_60():
    assert ib.midi("C3") == 60 and ib.midi("A#1") == 46 and ib.midi("C#0") == 25 and ib.midi("G#6") == 104
    assert ib.midi("C-2") == 0


def test_baut_links_mit_aiff_endung_und_sfz(tmp_path):
    q = quelle(tmp_path)
    ziel = tmp_path / "grand"
    sfz = ib.baue(q, ziel, "grand")
    links = sorted(p.name for p in (ziel / "proben").iterdir())
    assert len(links) == 16 and all(n.endswith(".aiff") and " " not in n and "#" not in n for n in links)
    for p in (ziel / "proben").iterdir():  # Symlink auf das Original, nichts kopiert
        assert p.is_symlink() and p.resolve().parent == q.resolve()
    r = regionen(sfz)
    assert len(r) == 16
    assert {(x["lovel"], x["hivel"]) for x in r} == {("1", "40"), ("41", "80"), ("81", "110"), ("111", "127")}
    kerne = sorted({int(x["pitch_keycenter"]) for x in r})
    assert kerne == [25, 46, 60, 104]
    # Tonbereiche lückenlos von 21 bis 108, jeder Bereich enthält seinen Kern
    bereiche = sorted({(int(x["lokey"]), int(x["hikey"]), int(x["pitch_keycenter"])) for x in r})
    assert bereiche[0][0] == 21 and bereiche[-1][1] == 108
    for (lo, hi, k), nach in zip(bereiche, bereiche[1:]):
        assert lo <= k <= hi and nach[0] == hi + 1
    assert f"default_path={ziel / 'proben'}/" in sfz.read_text()


def test_fehlende_stufe_bricht_ab(tmp_path):
    q = quelle(tmp_path, stufen=("p", "mf", "f"))
    with pytest.raises(ib.Abbruch, match="ff"):
        ib.baue(q, tmp_path / "grand", "grand")


def test_leere_quelle_bricht_ab(tmp_path):
    (tmp_path / "leer").mkdir()
    with pytest.raises(ib.Abbruch, match="keine"):
        ib.baue(tmp_path / "leer", tmp_path / "grand", "grand")


def test_zweiter_lauf_ersetzt_alte_links(tmp_path):
    q = quelle(tmp_path)
    ziel = tmp_path / "grand"
    ib.baue(q, ziel, "grand")
    (ziel / "proben" / "alt.aiff").symlink_to(q / "GrandPiano C3 p.aif")
    ib.baue(q, ziel, "grand")
    assert not (ziel / "proben" / "alt.aiff").exists()


def test_pruefe_findet_fehlende_proben_und_falsche_endung(tmp_path):
    q = quelle(tmp_path)
    sfz = ib.baue(q, tmp_path / "grand", "grand")
    assert ib.pruefe(sfz) == []
    next((tmp_path / "grand" / "proben").iterdir()).unlink()
    assert len(ib.pruefe(sfz)) == 1 and "fehlt" in ib.pruefe(sfz)[0]
    roh = tmp_path / "roh.sfz"
    (tmp_path / "x.aif").write_bytes(b"FORM")
    roh.write_text(f"<control> default_path={tmp_path}/\n<region> sample=x.aif lokey=0 hikey=127\n")
    assert "Endung" in ib.pruefe(roh)[0]
    assert ib.pruefe(tmp_path / "nichtda.sfz") == [f"{tmp_path / 'nichtda.sfz'}: fehlt"]
