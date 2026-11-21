# Tests of the S8 stream tables (container core, lane U9): the bottom rows show the alias streams erz/<n>, never a pad channel,
# and the Maschine group buttons point at valid targets (containers, alias streams of instruments, fx/3).
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import mk2  # noqa: E402
import s8_display as A  # noqa: E402

PULT = json.loads((Path(__file__).resolve().parents[2] / "contract" / "pult.json").read_text())
SEITEN = ((1, 2, 3), (9, 10, 5, 6, 7))   # the streams shown on side A and side B (the tuples in s8_anzeige.run)


def test_stroem_kanal_has_no_pad_entry():
    assert not [v for v in A.STROM_KANAL.values() if v.startswith("pad/")]
    assert A.STROM_KANAL[9] == "erz/9"
    assert A.STROM_KANAL[10] == "erz/10"


def test_stroem_tables_match_pult_json():
    alias = set(PULT["alias_stroeme"])   # pult.json has no key "strom": the stream list is alias_stroeme
    assert set(A.STROM_KANAL) == set(A.STROM_NAME)
    for seite in SEITEN:
        assert set(seite) <= alias
    assert set(A.STROM_KANAL) <= alias
    assert all(A.STROM_KANAL[n] == f"erz/{n}" for n in A.STROM_KANAL)


def test_stroem_name_has_no_loop_labels():
    assert "L1" not in A.STROM_NAME.values()
    assert "L2" not in A.STROM_NAME.values()


def test_every_shown_stream_has_name_and_kanal():
    assert A.SEITEN_STROEME == {1: (1, 2, 3), 2: (9, 10, 5, 6, 7)}
    for seite in SEITEN:
        for s in seite:
            assert A.STROM_NAME[s] and A.STROM_KANAL[s]


def test_studio_title_has_no_loops():
    assert "loops" not in A.STUDIO_TITEL[2]


def test_mk2_plaetze_paths_are_valid_targets():
    pfade = {c["pfad"] for c in PULT["container"]}
    instrumente = {f"erz/{n}" for n in PULT["alias_stroeme"] if n != 1}
    for kanal, kurz, _ in mk2.PLAETZE:
        assert kanal in pfade or kanal in instrumente or kanal == "fx/3", kanal
    assert [k for k, _, _ in mk2.PLAETZE if k.startswith("pad/")] == ["pad/1", "pad/2"]
    assert [kurz for k, kurz, _ in mk2.PLAETZE if k.startswith("pad/")] == ["C", "D"]


def test_stream_names_and_studio_titles_are_pinned():
    # W6: the display names of the streams 9 and 10 and the Studio titles are part of what the hardware shows; a rename is a decision, not a side effect
    assert A.STROM_NAME[9] == "I9"
    assert A.STROM_NAME[10] == "I10"
    assert A.STUDIO_TITEL[2] == "Baukasten"
    assert A.STUDIO_TITEL[1] == "Strudel"
