"""Fortschrittsmeldungen der Werkstatt: JSON-Zeilen mit Praefix auf stderr (die Seite zeigt Stufe, Prozent, Zeit).
Die Quelle ist echt: kette.einlesen meldet jede Stufe beim Eintritt, warp meldet rubberbands eigene Prozentzeilen."""
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import pytest

from klickhilfe import klick
from werkstatt import fortschritt, kette
from werkstatt.karte import Karte
from werkstatt.warp import timemap, warp

HIER = Path(__file__).resolve().parent.parent


def test_melder_schreibt_eine_zeile_mit_praefix():
    ziel = io.StringIO()
    m = fortschritt.melder(ziel)
    m("beats", prozent=40.0, teil="tracking")
    zeile = ziel.getvalue()
    assert zeile.startswith(fortschritt.PRAEFIX) and zeile.endswith("\n") and zeile.count("\n") == 1
    assert json.loads(zeile[len(fortschritt.PRAEFIX):]) == {"stufe": 2, "von": 5, "name": "beats", "prozent": 40.0, "teil": "tracking"}


def test_melder_kennt_nur_die_festen_stufen():
    with pytest.raises(ValueError):
        fortschritt.melder(io.StringIO())("erfunden")


def test_lies_zeile_nimmt_nur_eigene_zeilen():
    z = fortschritt.PRAEFIX + json.dumps({"stufe": 3, "von": 5, "name": "key", "prozent": None, "teil": None})
    assert fortschritt.lies_zeile(z)["name"] == "key"
    assert fortschritt.lies_zeile("einzeln: Irgendwas") is None
    assert fortschritt.lies_zeile(fortschritt.PRAEFIX + "{kaputt") is None


def _wav(p, s=6.0):
    sf.write(str(p), (np.random.default_rng(1).standard_normal((int(48000 * s), 2)) * 0.1).astype(np.float32), 48000, subtype="FLOAT")


def test_warp_meldet_echte_prozente_steigend_bis_100(tmp_path):
    ein, aus = tmp_path / "e.wav", tmp_path / "a.wav"
    _wav(ein)
    s = 0.25 + np.arange(12) * 60.0 / 134.0
    tm = timemap(Karte(sekunden=s, beats=np.arange(12.0)), 128.0, 48000 * 6)
    p = []
    warp(ein, aus, tm, melde=p.append)
    assert len(p) > 20 and p == sorted(p) and 0 <= p[0] <= 5 and p[-1] == 100.0
    assert aus.exists()


def test_warp_ohne_melde_bleibt_wie_vorher(tmp_path):
    ein, aus = tmp_path / "e.wav", tmp_path / "a.wav"
    _wav(ein, 2.0)
    tm = timemap(Karte(sekunden=0.25 + np.arange(4) * 60.0 / 134.0, beats=np.arange(4.0)), 128.0, 96000)
    assert "-q" in warp(ein, aus, tm)


def test_warp_fehler_bleibt_ein_fehler_mit_melde(tmp_path):
    """NEGATIV: eine kaputte Eingabe wirft weiter CalledProcessError, auch wenn gemeldet wird."""
    ein = tmp_path / "e.wav"
    ein.write_bytes(b"kein wav")
    tm = timemap(Karte(sekunden=0.25 + np.arange(4) * 60.0 / 134.0, beats=np.arange(4.0)), 128.0, 96000)
    with pytest.raises(subprocess.CalledProcessError):
        warp(ein, tmp_path / "a.wav", tm, melde=lambda p: None)


def test_einlesen_meldet_alle_fuenf_stufen_in_reihenfolge(tmp_path):
    p = tmp_path / "klick134.wav"
    s = klick(p)
    gemeldet = []
    kette.einlesen(p, tmp_path / "b", karte=Karte(sekunden=s, beats=np.arange(len(s), dtype=float)),
                   melde=lambda name, prozent=None, teil=None: gemeldet.append((name, prozent)))
    namen = [n for n, _ in gemeldet]
    assert [n for i, n in enumerate(namen) if i == 0 or n != namen[i - 1]] == ["decode", "beats", "key", "render", "save"]
    render = [pr for n, pr in gemeldet if n == "render" and pr is not None]
    assert render and render[-1] == 100.0 and render == sorted(render)


def test_einlesen_ohne_melde_geht_weiter(tmp_path):
    p = tmp_path / "klick134.wav"
    s = klick(p)
    e = kette.einlesen(p, tmp_path / "b", karte=Karte(sekunden=s, beats=np.arange(len(s), dtype=float)))
    assert e["status"] == "neu"


def _lauf(*args):
    p = subprocess.run(["nice", "-n", "19", sys.executable, "-m", "werkstatt.einzeln", *map(str, args)],
                       cwd=HIER, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def test_einzeln_echter_prozess_meldet_stufen_auf_stderr_und_stdout_bleibt_eine_zeile(tmp_path):
    q = tmp_path / "k.wav"
    klick(q)
    rc, out, err = _lauf("--quelle", q, "--bestand", tmp_path / "b")
    assert rc == 0 and len(out.splitlines()) == 1 and json.loads(out)["status"] == "neu"
    z = [fortschritt.lies_zeile(l) for l in err.splitlines()]
    z = [x for x in z if x]
    assert [x["name"] for i, x in enumerate(z) if i == 0 or x["name"] != z[i - 1]["name"]] == ["decode", "beats", "key", "render", "save"]
    assert all(x["von"] == 5 for x in z)


def test_einzeln_kaputte_datei_meldet_vorher_stufe_und_dann_fehler_mit_grund(tmp_path):
    """NEGATIV-KONTROLLE: eine Nicht-Audiodatei mit .wav-Endung: die Stufe decode wird gemeldet, dann Fehler mit Grund."""
    q = tmp_path / "kaputt.wav"
    q.write_bytes(b"das ist kein wav" * 50)
    rc, out, err = _lauf("--quelle", q, "--bestand", tmp_path / "b")
    j = json.loads(out.splitlines()[-1])
    assert rc == 1 and j["status"] == "fehler" and j["grund"]
    z = [x for x in map(fortschritt.lies_zeile, err.splitlines()) if x]
    assert z and z[0]["name"] == "decode" and z[-1]["name"] == "decode"
    assert not (tmp_path / "b" / ".arbeit").exists() or not any((tmp_path / "b" / ".arbeit").iterdir())


def test_eigene_stufen_und_vorgabe_unveraendert():
    import io
    from werkstatt.fortschritt import melder, lies_zeile
    puf = io.StringIO()
    m = melder(puf, stufen=("laden", "trennen", "schreiben"))
    m("trennen", 42.0)
    z = lies_zeile(puf.getvalue().strip())
    assert (z["stufe"], z["von"], z["name"], z["prozent"]) == (2, 3, "trennen", 42.0)
    import pytest
    with pytest.raises(ValueError):
        m("beats")                                            # nicht in diesen Stufen
    puf2 = io.StringIO(); melder(puf2)("render", 10)
    assert lies_zeile(puf2.getvalue().strip())["von"] == 5     # Vorgabe wie bisher
