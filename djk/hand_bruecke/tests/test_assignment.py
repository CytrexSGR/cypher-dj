# Tests of belegung: the controls the bridge handles in code, published as bruecke.json for the register.
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import assignment as belegung  # noqa: E402


def alt_faengt_ab(kanal, note):
    """Copy of the condition that stood in pult_bruecke.s8_tasten before belegung.faengt_ab."""
    shift = {13: True, 14: True}
    return kanal in shift and (20 <= note <= 27 or note in (15, 40))  # note 19 (DECK) joined with the loops view (C1)


def test_belegung_has_92_entries_with_the_contract_fields():
    b = belegung.belegung()
    assert len(b) == 92
    assert {e["geraet"] for e in b} == {"s8", "apc20", "mk2"}
    assert [sum(1 for e in b if e["geraet"] == g) for g in ("s8", "apc20", "mk2")] == [56, 12, 24]
    for e in b:
        assert set(e) == {"geraet", "quelle", "ziel", "art", "weg"}
        assert e["art"] in ("taste", "absolut", "relativ", "beruehrung")
        assert e["weg"] == "seite"


def test_belegung_targets():
    ziele = {e["ziel"] for e in belegung.belegung()}
    for z in ("deck/1/hotcue/1", "deck/2/hotcue/8", "deck/2/scrub", "deck/1/loop_laenge", "ansicht/1", "fx/3",
              "<kanal>/bk/<seite*8+1>", "<kanal>/bk/<seite*8+8>"):
        assert z in ziele, z
    assert sum(1 for z in ziele if z.startswith("<kanal>/bk/")) == 8


def test_mk2_group_buttons_follow_mk2_plaetze():
    import mk2
    gruppen = [e for e in belegung.belegung() if e["geraet"] == "mk2" and e["quelle"].startswith("group_")]
    assert [e["quelle"] for e in gruppen] == [f"group_{c}" for c in "abcdefgh"]
    assert [e["ziel"] for e in gruppen] == [p[0] for p in mk2.PLAETZE]


def test_faengt_ab_equals_the_old_expression_except_deck_button_and_loops_notes():
    for kanal in range(1, 17):
        for note in range(128):
            erwartet = alt_faengt_ab(kanal, note) or (kanal in (13, 14) and note == 19)
            for ansicht in (None, "deck", "studio", "seq"):  # 35-38, 44, 45, 49 stay MIDI outside the loops view
                assert belegung.faengt_ab(kanal, note, ansicht) == erwartet, (kanal, note, ansicht)


def test_belegung_lists_the_loops_view_controls():
    ziele = {e["ziel"] for e in belegung.belegung()}
    for z in ("ansicht/1", "loopdeck/1/mute/1", "loopdeck/2/mute/4", "loopdeck/1/szene/upper", "loopdeck/2/szene/lower",
              "loopdeck/2/laden", "loopdeck/1/slice", "loopdeck/2/slice"):
        assert z in ziele, z


def test_fx_buttons_are_intercepted_only_in_the_loops_view():
    for kanal in (13, 14):
        for note in (31, 32, 33, 34):
            assert belegung.faengt_ab(kanal, note, "loops") is True
            for ansicht in (None, "deck", "studio", "seq"):
                assert belegung.faengt_ab(kanal, note, ansicht) is False, (kanal, note, ansicht)
        assert belegung.faengt_ab(kanal, 30, "loops") is False       # fx_select stays unused
    assert belegung.faengt_ab(9, 31, "loops") is False               # the mixer channels' own buttons are other notes/channels


def test_belegung_lists_the_layer_buttons():
    b = belegung.belegung()
    ziele = {e["ziel"] for e in b}
    for d in (1, 2):
        for n in range(1, 5):
            assert f"loopdeck/{d}/schicht/{n}" in ziele
    e = [e for e in b if e["ziel"] == "loopdeck/2/schicht/3"][0]
    assert e == {"geraet": "s8", "quelle": "right fx button 3", "ziel": "loopdeck/2/schicht/3", "art": "taste", "weg": "seite"}
    assert len({(e["geraet"], e["quelle"]) for e in b}) == len(b)


def test_schreibe_roundtrip(tmp_path):
    p = tmp_path / "bruecke.json"
    assert belegung.schreibe(p) is True
    d = json.loads(p.read_text())
    assert d["version"] == 1 and d["geraet"] == "bruecke"
    assert len(d["eintraege"]) == 92
    assert not list(tmp_path.glob("*.tmp"))


def test_schreibe_unwritable_folder_returns_false():
    assert belegung.schreibe(Path("/proc/nope/bruecke.json")) is False
