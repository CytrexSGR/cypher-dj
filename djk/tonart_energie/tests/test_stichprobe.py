from tonart_energie.stichprobe import gueltig, waehle


def _z(p, k="8A", e="6"):
    return {"pfad": p, "tkey": k, "energy": e}


def test_waehle_fest_und_gleichmaessig():
    zeilen = [_z(f"/x/{i:04d}.mp3") for i in range(1000)][::-1]
    a, b = waehle(zeilen, 100), waehle(list(reversed(zeilen)), 100)
    assert a == b and len(a) == 100
    assert [z["pfad"] for z in a][:3] == ["/x/0000.mp3", "/x/0010.mp3", "/x/0020.mp3"]


def test_ungueltige_fallen_raus():
    assert not gueltig(_z("a", k="Amin")) and not gueltig(_z("a", e="")) and not gueltig(_z("a", e="11"))
    assert gueltig(_z("a"))
