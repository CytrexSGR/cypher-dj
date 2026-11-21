"""Tests für check_osc.py (osc.json gegen den Vertragstext)."""
import json
import re
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import pytest  # noqa: E402
import check_osc as pruefe_osc  # noqa: E402
import contract_text as vertragstext  # noqa: E402

OSC = HIER / "osc.json"


def test_unveraenderte_datei_ist_gruen():
    assert pruefe_osc.pruefe(vertragstext.VERTRAG, OSC, False) == []


def test_verfaelschte_typen_in_json_ist_rot(tmp_path):
    falsch = tmp_path / "osc.json"
    falsch.write_text(OSC.read_text(encoding="utf-8").replace('",hssisddfiiss"', '",hssisddfiis"'), encoding="utf-8")
    fehler = pruefe_osc.pruefe(vertragstext.VERTRAG, falsch, False)
    assert any(f.startswith("/k/teil: Typ-Zeichenkette Text ,hssisddfiiss") for f in fehler)


def test_verfaelschte_typen_im_text_ist_rot(tmp_path):
    falsch = tmp_path / "INTERFACES.md"
    falsch.write_text(vertragstext.lies().replace("`/k/teil ,hssisddfiiss`", "`/k/teil ,hssisddfiis`"), encoding="utf-8")
    fehler = pruefe_osc.pruefe(falsch, OSC, False)
    assert any(f.startswith("/k/teil: Typ-Zeichenkette Text ,hssisddfiis ") for f in fehler)


def test_text_ohne_z1_ist_rot(tmp_path):
    falsch = tmp_path / "INTERFACES.md"
    falsch.write_text("\n".join(z for z in vertragstext.lies().split("\n") if "`/test/klick ,hssi`" not in z),
                      encoding="utf-8")
    fehler = pruefe_osc.pruefe(falsch, OSC, False)
    n = len(json.loads(OSC.read_text(encoding="utf-8"))["adressen"])
    assert f"Anzahl ungleich: Text {n - 1}, osc.json {n}" in fehler
    assert "/test/klick steht in osc.json, fehlt im Text" in fehler


def test_falscher_feldname_ist_rot(tmp_path):
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    next(e for e in daten["adressen"] if e["adresse"] == "/k/tempo/rampe")["felder"][3]["name"] = "zielbpm"
    falsch = tmp_path / "osc.json"
    falsch.write_text(json.dumps(daten), encoding="utf-8")
    assert any(f.startswith("/k/tempo/rampe: Felder Text") for f in pruefe_osc.pruefe(vertragstext.VERTRAG, falsch, False))


def test_unbekannte_einheit_ist_rot(tmp_path):
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    daten["adressen"][0]["felder"][1]["einheit"] = "hertz"
    falsch = tmp_path / "osc.json"
    falsch.write_text(json.dumps(daten), encoding="utf-8")
    assert "/k/hallo.port: Einheit 'hertz' unbekannt" in pruefe_osc.pruefe(vertragstext.VERTRAG, falsch, False)


def _zeile(adresse):
    daten = json.loads(OSC.read_text(encoding="utf-8"))
    return next(e for e in daten["adressen"] if e["adresse"] == adresse)


def _feld(adresse, name):
    return next(f for f in _zeile(adresse)["felder"] if f["name"] == name)


def test_rec_felder_18():
    """1.8 S0: the recording rows carry the fields slices 2 to 5 need (defaults only until their unit)."""
    spur = _zeile("/k/rec/spur")
    assert spur["typen"] == ",hsiiiii"
    assert [f["name"] for f in spur["felder"]] == ["id", "quelle", "spur", "scharf", "eingang", "modus", "monitor"]
    assert _feld("/k/rec/spur", "eingang")["bereich"] == [0, 30]
    assert _feld("/k/rec/spur", "modus")["bereich"] == [0, 3]
    assert _feld("/k/rec/spur", "monitor")["bereich"] == [0, 2]

    start = _zeile("/k/rec/start")
    assert start["typen"] == ",hsiiii"
    assert [f["name"] for f in start["felder"]][-2:] == ["frist_samples", "vorzaehler_takte"]
    assert _feld("/k/rec/start", "vorzaehler_takte")["bereich"] == [0, 4]

    zustand = _zeile("/zustand/rec")
    assert zustand["typen"] == ",iiihdiii"
    assert [f["name"] for f in zustand["felder"]][-4:] == ["projekt_beat", "ausgang_vorhalt", "quantum", "rec_midi_scharf"]   # 1.8 T7a
    assert "1 zaehlt ein" in _feld("/zustand/rec", "status")["notiz"]

    aufnahme = _zeile("/e/aufnahme")
    assert aufnahme["typen"] == ",iiihhii"
    assert [f["name"] for f in aufnahme["felder"]][-2:] == ["luecken", "art"]
    assert _feld("/e/aufnahme", "spur")["bereich"] == [0, 32]
    assert _feld("/e/aufnahme", "art")["bereich"] == [0, 1]
# T1 (1.15 closure): the English copy of the contract has other anchors in its prose (section 19 list item, policy code
# paragraph, key names). pruefe_osc raised StopIteration on it before.
ENGLISCH = HIER.parents[1] / "docs" / "veroeffentlichung" / "englisch" / "docs" / "architecture" / "INTERFACES.md"
# The public export ships no translation sources: there the contract text itself is the English edition, and the tests above
# already read it.
NUR_ARBEITSREPO = pytest.mark.skipif(not ENGLISCH.exists(), reason="no docs/veroeffentlichung/englisch: the export ships the English edition as the contract text itself")


@NUR_ARBEITSREPO
def test_englische_kopie_ist_gruen():
    assert ENGLISCH.exists()
    assert pruefe_osc.pruefe(ENGLISCH, OSC, False) == []


@NUR_ARBEITSREPO
def test_englische_kopie_mit_fehlendem_eintrag_ist_rot(tmp_path):
    # positive control: the English path must still find a real defect, not just pass everything
    falsch = tmp_path / "INTERFACES.md"
    falsch.write_text("\n".join(z for z in ENGLISCH.read_text(encoding="utf-8").split("\n")
                                if "`/test/klick ,hssi`" not in z), encoding="utf-8")
    fehler = pruefe_osc.pruefe(falsch, OSC, False)
    assert "/test/klick steht in osc.json, fehlt im Text" in fehler


def test_text_ohne_anker_ist_ein_befund_kein_absturz(tmp_path):
    # a text with no section 19 list item 0. must give a finding, not a StopIteration
    leer = tmp_path / "INTERFACES.md"
    leer.write_text("## 4. x\n\n## 5. y\n\n## 19. z\n\nnothing here\n", encoding="utf-8")
    fehler = pruefe_osc.pruefe_sicher(leer, OSC, False)
    assert any("Anker" in f for f in fehler)


# ---- container core V2: container source command and event, /erz/strom without kanal, loop box commands removed
def _json():
    return json.loads(OSC.read_text(encoding="utf-8"))


def _adr(name):
    return next((e for e in _json()["adressen"] if e["adresse"] == name), None)


def test_container_quelle_ist_im_vertrag():
    k = _adr("/k/container/quelle")
    assert k["typen"] == ",hsii" and k["richtung"] == "an_kern" and k["abschnitt"] == "4.10"
    assert [f["name"] for f in k["felder"]] == ["id", "quelle", "container", "art"]
    assert k["felder"][2]["bereich"] == [1, 4] and k["felder"][3]["bereich"] == [0, 2]
    e = _adr("/e/container/quelle")
    assert e["typen"] == ",ii" and e["richtung"] == "vom_kern" and e["abschnitt"] == "5.12"
    assert [f["name"] for f in e["felder"]] == ["container", "art"]
    s = _adr("/erz/strom")
    assert s["typen"] == ",hsis" and "kanal" not in [f["name"] for f in s["felder"]]
    adressen = {x["adresse"] for x in _json()["adressen"]}
    entfernt = {"/k/platz/kanal", "/e/platz/kanal", "/k/loop/laden", "/k/loop/start", "/k/loop/stopp", "/k/loop/raster",
                "/zustand/box", "/e/loop"}
    assert not (entfernt & adressen)
    assert {"/k/loop/rec", "/e/mitschnitt"} <= adressen


def test_werte_listen_der_container():
    w = _json()["werte"]
    c = ["deck/1", "deck/2", "pad/1", "pad/2"]
    assert w["fx_kanal_12"]["liste"] == c + ["master"]
    assert w["fx_kanal_3"]["liste"] == c
    assert w["fx_kanal"]["liste"] == c + ["master"]
    assert w["graph_kanal"]["liste"] == c + ["fx/3", "fx/4", "master"]
    assert w["graph_platz"]["liste"] == c + ["fx/3", "fx/4", "master", "strom/2", "strom/3", "strom/5", "strom/6",
                                              "strom/7", "strom/9", "strom/10"]


def test_rec_codes_nennen_container_eingaenge():
    f = next(x for x in _adr("/k/rec/spur")["felder"] if x["name"] == "eingang")
    assert f["bereich"] == [0, 30] and "23" in f["notiz"] and "24" in f["notiz"]


def test_text_und_json_sind_gleich():
    assert pruefe_osc.pruefe(vertragstext.VERTRAG, OSC, True) == []
    if ENGLISCH.exists():
        assert pruefe_osc.pruefe(ENGLISCH, OSC, False) == []


# ---- container core V3: cypherdj-arr/4 prose and the three loader reasons
NEUE_GRUENDE = ["live_ohne_container", "dj_doppelt", "send_ausser_modul"]
DEUTSCH = HIER.parents[1] / "docs" / "architecture" / "INTERFACES.md"


def _texte():
    return [DEUTSCH] + ([ENGLISCH] if ENGLISCH.exists() else [])


def test_neue_gruende_stehen_im_vertrag():
    liste = _json()["werte"]["gruende"]["liste"]
    ts = (HIER / "osc_addresses.ts").read_text(encoding="utf-8")
    grund_ts = ts[ts.index("export const GRUENDE"):].split("\n")[0]
    for code in NEUE_GRUENDE:
        assert code in liste and f"'{code}'" in grund_ts
        for text in _texte():
            assert f"| `{code}` |" in text.read_text(encoding="utf-8"), (code, text)


def test_gruende_der_attrappe_sind_teilmenge():
    mock = (HIER / "mock_core" / "contract.mjs").read_text(encoding="utf-8")
    block = mock[mock.index("export const GRUENDE"):]
    block = block[:block.index("]);")]
    mock_codes = set(re.findall(r"'([a-z_]+)'", block))
    assert set(NEUE_GRUENDE) <= mock_codes
    assert mock_codes <= set(_json()["werte"]["gruende"]["liste"])


def test_arr4_prosa_nennt_format_und_quelle_strom():
    for text in _texte():
        t = text.read_text(encoding="utf-8")
        assert "cypherdj-arr/4" in t and '"art": "strom"' in t, text
        absatz = next(a for a in t.split("\n") if a.startswith("**DJ-channel output of a group"))
        assert "1 to 4" in absatz and "1 to 6" not in absatz and "`dj_doppelt`" in absatz, text
        rets = next(a for a in t.split("\n") if a.startswith("**Returns in the playback"))
        assert "1 to 8" in rets and "1 to 6" not in rets, text
