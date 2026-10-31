"""Paket 1.13 Slice 2: der Arrangement-Teil von ziel_lauf_boxen.py (--arr ohne|warp). Geprüft wird, was ohne Prüfinstanz prüfbar ist: die Wiedergabe-Datei, die der
Kern laden soll (Form wie D1 3.2/ INTERFACES §4.11), die Argumente und die Kontrollen der Auswertung. Der Lauf selbst (JACK, Kern, Abonnent) ist Sache der Zielabnahme."""
import json
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import ziel_lauf_boxen as zb  # noqa: E402


@pytest.mark.parametrize("modus", ["ohne", "warp"])
def test_wiedergabe_form(tmp_path, modus):
    wg = zb.arr_wiedergabe(tmp_path / "arr", modus, nr=7)
    assert wg == json.loads((tmp_path / "arr" / "wiedergabe-7.json").read_text())
    assert wg["format"] == "cypherdj-arr/2" and wg["nr"] == 7 and len(wg["spuren"]) == 32
    assert [s["nr"] for s in wg["spuren"]] == list(range(1, 33))
    assert len({c["sha256"] for s in wg["spuren"] for c in s["clips"]}) == 8, "acht Töne, vier Spuren je Ton"
    for s in wg["spuren"]:
        (c,) = s["clips"]
        assert c["datei"].startswith(str(tmp_path / "arr" / "audio") + "/") and c["datei"].endswith(c["sha256"] + ".f32")
        assert Path(c["datei"]).stat().st_size == c["frames"] * 2 * 4, "rohes f32 Stereo"
        assert c["laenge_beats"] == zb.ARR_BEATS and c["frames"] == 17 * zb.ARR_FPB125
        if modus == "warp":
            assert c["warp"] == {"modus": 2, "w": [[0, 0], [zb.ARR_BEATS, zb.ARR_BEATS * zb.ARR_FPB125]]}
        else:
            assert "warp" not in c, "die Grundlinie ist ungewarpt"


def test_argumente():
    import argparse  # die Vorgabe und die Auswahl stehen im Parser von main(); hier genügt der Aufruf mit falschem Wert
    with pytest.raises(SystemExit):
        zb.main(["--fall", "T128", "--lauf", "x", "--arr", "turbo"])
