"""zell_karte_referenz.json is well formed: every case has a consistent table (rising slots, g[n] = frames, source slots in range) and every point
carries a position, two reads (a frame in [0, frames) or -1) and a weight in [0, 1]. Both twins (core test, page server test) read this file."""
import json
import math
import pathlib

DATEI = pathlib.Path(__file__).resolve().parents[1] / "zell_karte_referenz.json"
REF = json.loads(DATEI.read_text())


def test_naht_und_zahl_der_faelle():
    assert REF["naht"] == 96
    assert len(REF["faelle"]) >= 20
    assert len({c["name"] for c in REF["faelle"]}) == len(REF["faelle"])


def test_tabellen_sind_wohlgeformt():
    for c in REF["faelle"]:
        g, s, frames = c["g"], c["s"], c["frames"]
        assert frames > 0, c["name"]
        assert len(g) == (len(s) + 1 if s else 0), c["name"]
        assert len(s) <= 64, c["name"]
        if s:
            assert g[0] == 0 and g[-1] == frames, c["name"]
            assert all(g[i] < g[i + 1] for i in range(len(g) - 1)), c["name"]
            assert all(0 <= x < len(s) for x in s), c["name"]
        for k in ("kreis", "rueck", "blende"):
            assert isinstance(c[k], bool), (c["name"], k)


def test_punkte_liegen_im_bereich():
    n = 0
    for c in REF["faelle"]:
        assert c["punkte"], c["name"]
        for pos, a, b, wb in c["punkte"]:
            n += 1
            assert pos == "nan" or isinstance(pos, (int, float)), (c["name"], pos)
            for r in (a, b):
                assert r == -1.0 or 0.0 <= r < c["frames"], (c["name"], pos, r)
            assert 0.0 <= wb <= 1.0 and not math.isnan(wb), (c["name"], pos, wb)
    assert n == 240
