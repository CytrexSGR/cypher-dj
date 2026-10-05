import struct
from pathlib import Path

import pytest

import klang

INIT = (Path(__file__).parent / "daten" / "surge-init.carxs").read_text()


def test_juce64_rundreise_am_echten_zustand():
    wert = klang.STATE.search(INIT).group(2)
    assert wert.startswith("50208.")
    assert klang.juce64_enkodiere(klang.juce64_dekodiere(wert)) == wert


def test_carxs_rundreise_byteidentisch():
    assert klang.carxs_mit_patch(INIT, klang.carxs_patch(INIT)) == INIT


def test_init_xml_lesbar():
    xml = klang.xml_aus_patch(klang.carxs_patch(INIT))
    assert xml.startswith("<?xml")
    assert '<a_osc1_type type="0" value="0" />' in xml
    assert '<a_filter1_type type="0" value="0" deactivated="1" />' in xml


def test_setze_aendert_genau_die_genannten_elemente():
    xml = klang.xml_aus_patch(klang.carxs_patch(INIT))
    neu = klang.setze(xml, {"a_filter1_type": "2", "a_filter1_type.deactivated": "0", "a_filter1_cutoff": "-30.0"})
    alt_t, neu_t = xml.split(">"), neu.split(">")
    assert len(alt_t) == len(neu_t)
    assert [b for a, b in zip(alt_t, neu_t) if a != b] == [
        '<a_filter1_type type="0" value="2" deactivated="0" /',
        '<a_filter1_cutoff type="2" value="-30.0" extend_range="0" /',
    ]


def test_setze_unbekannt_oder_ohne_attribut_wirft_und_aendert_nichts():
    xml = klang.xml_aus_patch(klang.carxs_patch(INIT))
    with pytest.raises(ValueError):
        klang.setze(xml, {"a_filter1_cutoff": "-5", "gibtsnicht": "1"})
    with pytest.raises(ValueError):
        klang.setze(xml, {"a_filter1_cutoff.gibtsnicht": "1"})
    assert '<a_filter1_cutoff type="2" value="3.00000000000000" extend_range="0" />' in xml


def test_werte_filtert_nach_regex():
    xml = klang.xml_aus_patch(klang.carxs_patch(INIT))
    w = dict(klang.werte(xml, r"^a_filter1_(type|cutoff)$"))
    assert w == {"a_filter1_type": 'type="0" value="0" deactivated="1"',
                 "a_filter1_cutoff": 'type="2" value="3.00000000000000" extend_range="0"'}


def test_patch_mit_xml_behaelt_wavetables():
    alt = struct.pack("<4sI6I", b"sub3", 5, 3, 0, 0, 0, 0, 2) + b"<x/>!" + b"abcde"
    neu = klang.patch_mit_xml(alt, "<patch/>")
    assert neu == struct.pack("<4sI6I", b"sub3", 8, 3, 0, 0, 0, 0, 2) + b"<patch/>" + b"abcde"


def test_fxp_rundreise_und_kopf():
    patch = klang.carxs_patch(INIT)
    f = klang.fxp_bauen(patch, "Bass Eins")
    assert f[:4] == b"CcnK" and f[8:12] == b"FPCh" and f[16:20] == b"cjs3"
    assert struct.unpack(">i", f[4:8])[0] == len(f) - 8
    assert klang.fxp_lesen(f) == patch
    assert klang.fxp_name(f) == "Bass Eins"


def test_fremdes_abgewiesen():
    with pytest.raises(ValueError):
        klang.fxp_lesen(b"CcnK" + b"\0" * 80)
    with pytest.raises(ValueError):
        klang.xml_aus_patch(b"xxxx" + b"\0" * 40)
    with pytest.raises(ValueError):
        klang.carxs_patch("<CARLA-PRESET/>")


def test_xml_aus_patch_toleriert_latin1_byte():
    xml = b'<?xml version="1.0" encoding="UTF-8"?><patch><meta name="\xb5computer" /></patch>'
    patch = struct.pack("<4sI6I", b"sub3", len(xml), 0, 0, 0, 0, 0, 0) + xml
    assert '<meta name="�computer" />' in klang.xml_aus_patch(patch)


MIT_KIND = ('<?xml version="1.0" encoding="UTF-8"?><patch>'
            '<a_filter1_cutoff type="2" value="-14.3" extend_range="0"><modrouting source="6" depth="34.4" /></a_filter1_cutoff>'
            '<a_filter1_type type="0" value="1" /></patch>')


def test_setze_element_mit_modulations_kind():
    neu = klang.setze(MIT_KIND, {"a_filter1_cutoff": "-20.0"})
    assert '<a_filter1_cutoff type="2" value="-20.0" extend_range="0"><modrouting source="6" depth="34.4" /></a_filter1_cutoff>' in neu


def test_werte_findet_element_mit_kind():
    assert dict(klang.werte(MIT_KIND, "^a_filter1")) == {
        "a_filter1_cutoff": 'type="2" value="-14.3" extend_range="0"', "a_filter1_type": 'type="0" value="1"'}


def test_setze_weist_xml_sonderzeichen_ab():
    xml = klang.xml_aus_patch(klang.carxs_patch(INIT))
    for schlecht in ('1"', "<1", "1&x"):
        with pytest.raises(ValueError):
            klang.setze(xml, {"a_filter1_cutoff": schlecht})


def test_normiert_linear_und_stueckweise():
    lin = [-60.0, -27.5, 5.0, 37.5, 70.0]
    assert klang.normiert(lin, -60.0) == 0.0
    assert klang.normiert(lin, 70.0) == 1.0
    assert abs(klang.normiert(lin, 5.0) - 0.5) < 1e-9
    assert abs(klang.normiert(lin, -43.75) - 0.125) < 1e-9
    krumm = [0.0, 1.0, 4.0, 9.0, 16.0]  # nicht linear, steigend
    assert abs(klang.normiert(krumm, 2.5) - 0.375) < 1e-9
    fallend = [1.0, 0.75, 0.5, 0.25, 0.0]
    assert abs(klang.normiert(fallend, 0.6) - 0.4) < 1e-9


def test_normiert_klemmt_und_prueft():
    lin = [-60.0, -27.5, 5.0, 37.5, 70.0]
    assert klang.normiert(lin, -100.0) == 0.0
    assert klang.normiert(lin, 100.0) == 1.0
    with pytest.raises(ValueError):
        klang.normiert([0.0, 2.0, 1.0, 3.0, 4.0], 1.5)  # nicht monoton


def test_bereiche_tabelle_im_repo():
    import json
    d = json.loads((Path(__file__).parent.parent / "surge_bereiche.json").read_text())
    p = d["parameter"]["a_filter1_cutoff"]
    assert p["index"] == 25 and [round(x, 3) for x in p["punkte"]] == [-60.0, -27.5, 5.0, 37.5, 70.0]
    assert len(d["parameter"]) == 359  # gemessen 2026-09-29, alle monoton
