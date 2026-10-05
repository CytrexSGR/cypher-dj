"""OSC-Kodierung gegen feste Bytes (Vertrag §4, §5.10) und Hörer gegen einen eigenen Sender auf Loopback."""
import json
import socket
import struct
import time

import pytest

import osc


def test_nb_bytes_wie_notbahn():
    # /nb ,iiih: zustand 1, takte 3, generation 0, w 2^32 + 5 (SCHNITTSTELLEN §5.10)
    p = osc.kodiere("/nb", "iiih", 1, 3, 0, (1 << 32) + 5)
    assert p[:12] == b"/nb\0,iiih\0\0\0"
    assert p[12:] == struct.pack(">iiiq", 1, 3, 0, (1 << 32) + 5)
    assert osc.lies(p) == ("/nb", "iiih", [1, 3, 0, (1 << 32) + 5])


def test_hallo_rundreise_und_textpolster():
    p = osc.kodiere("/k/hallo", "sii", "pruefstand", 53140, 1)
    assert len(p) % 4 == 0
    assert osc.lies(p) == ("/k/hallo", "sii", ["pruefstand", 53140, 1])


def test_falsche_typzahl_ist_fehler():
    with pytest.raises(ValueError):
        osc.kodiere("/k/set/neu", "hsd", 1, "pruefstand")


def test_instanz_k():
    assert osc.instanz_k("") == 0 and osc.instanz_k("a") == 1 and osc.instanz_k("i") == 9
    with pytest.raises(ValueError):
        osc.instanz_k("x")


def test_hoerer_protokolliert(tmp_path):
    log = tmp_path / "h.jsonl"
    h = osc.Hoerer(log, inst="i")                     # Port 47140 + 9000; Strang I baut noch nicht
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.sendto(osc.kodiere("/nb", "iiih", 1, 1, 0, 42), ("127.0.0.1", 56140))
    s.sendto(b"kaputt", ("127.0.0.1", 56140))
    assert h.warte_auf("/nb", 2.0) == [1, 1, 0, 42]
    time.sleep(0.1)
    h.ende()
    zeilen = [json.loads(z) for z in log.read_text().splitlines()]
    assert any(z.get("adresse") == "/nb" for z in zeilen)
    assert any("fehler" in z for z in zeilen)            # unlesbares Paket ist ein Befund, kein Absturz
