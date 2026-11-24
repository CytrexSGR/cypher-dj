"""Task V1: djk/contract/pult.json, the generator generate_pult.py and the three generated outputs.
Run: cd djk/contract && python3 -m pytest -q tests/test_pult.py. Mutations work on copies in tmp_path."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parents[1]
WURZEL = HIER.parents[1]
sys.path.insert(0, str(HIER))
import generate_pult as erzeuge_pult  # noqa: E402
import check_name_lists as pruefe_namenslisten  # noqa: E402

PULT_JSON = HIER / "pult.json"
PULT_H = WURZEL / "djk/core/include/cypherdj/pult_table.h"
PULT_TS = HIER / "pult.ts"
PULT_JS = WURZEL / "djk/ui/public/pult.js"
TAG = "archiv/kern-vor-container"


def daten():
    return json.loads(PULT_JSON.read_text(encoding="utf-8"))


def test_pult_json_hat_vier_container_a_bis_d():
    c = daten()["container"]
    assert [x["id"] for x in c] == ["A", "B", "C", "D"]
    assert [x["pfad"] for x in c] == ["deck/1", "deck/2", "pad/1", "pad/2"]
    assert [x["player"] for x in c] == [1, 2, 3, 4]
    assert len({x["pfad"] for x in c}) == 4


def test_regler_listen_haben_die_gepinnte_groesse():
    d = erzeuge_pult.laden()
    r = d["regler"]
    ohne = lambda l: [s for s in l if s != "bk/<k>"]  # noqa: E731
    assert len(ohne(r["zug"])) == 40 and len(ohne(r["bus"])) == 49 and len(ohne(r["player"])) == 5
    for fam in ("zug", "bus", "player"):
        assert len(set(r[fam])) == len(r[fam])
    assert r["zug"][-1] == "bk/<k>" and r["strom"] == ["bk/<k>"]
    assert len(erzeuge_pult.regler_pfade(d, "zug")) == 4 * 40 + 4 * 64 == 416
    assert len(erzeuge_pult.regler_pfade(d, "bus")) == 4 * 49 == 196
    assert len(erzeuge_pult.regler_pfade(d, "player")) == 4 * 5 == 20
    strom = erzeuge_pult.regler_pfade(d, "strom")
    assert len(strom) == 16 * 64 == 1024
    assert "strom/16/bk/64" in strom and "strom/17/bk/1" not in strom


# --- parser of the old strips in the archive tag (evidence for "zug and player cover the old deck strips")
def _tag_holen():
    """A CI checkout is `--depth 1` without tags: fetch the archive tag (one commit) from origin when it is not there yet.
    The CI workflow fetches it itself with its token; this covers every other shallow clone that can reach origin."""
    if subprocess.run(["git", "rev-parse", "-q", "--verify", f"refs/tags/{TAG}^{{commit}}"], cwd=WURZEL,
                      capture_output=True).returncode == 0:
        return
    subprocess.run(["git", "fetch", "-q", "--depth", "1", "origin", f"refs/tags/{TAG}:refs/tags/{TAG}"], cwd=WURZEL,
                   capture_output=True, timeout=120)


def _alt(rel):
    _tag_holen()
    try:
        return pruefe_namenslisten.Quelle(rev=TAG).lies(rel)
    except pruefe_namenslisten.ParserFehler as fehler:
        pytest.fail(f"archive tag {TAG} missing and not fetchable from origin ({fehler})")


def _alte_streifen():
    cpp = _alt("djk/core/signalbox/src/controls.cpp")
    von = cpp.index("const Gruppe gruppen[]")
    bis = cpp.index("const int master = kanal(\"master\")")
    zeilen = cpp[von:bis].split("\n")
    deck, bus = set(), set()
    zustand = None   # None | "nicht_bus" | "deck": inside an `if (...) {` block
    for z in zeilen:
        s = z.strip()
        m_if = re.match(r"if \((!bus|deck)\)( \{)?", s)
        bedingung = None
        if m_if:
            bedingung = "nicht_bus" if m_if.group(1) == "!bus" else "deck"
            if m_if.group(2):
                zustand = bedingung
        elif s.startswith("}") and zustand:
            zustand = None
        namen = re.findall(r'pf\("([a-z_/]+)"\)', s)
        if "send/%d" in s:
            namen += [f"send/{i}" for i in range(1, 5)]
        for n in namen:
            bed = bedingung or zustand
            if bed is None:
                deck.add(n); bus.add(n)
            elif bed == "nicht_bus":
                deck.add(n)
            else:
                deck.add(n)   # deck only (stem/*), never a bus
    # transport is the trailing `if (deck) neu(pf("transport")...` row and is covered by the loop above
    kopf = _alt("djk/core/signalbox/include/cypherdj/signalbox/tool_controls.h")
    v = kopf.index("WERKZEUG_ZEILEN[] = {")
    b = kopf.index("\n};", v)
    for z in kopf[v:b].split("\n")[1:]:
        z = re.sub(r"//.*$", "", z).strip()
        if not z:
            continue
        m = pruefe_namenslisten._WZ_ZEILE.match(z)
        assert m, f"unreadable WERKZEUG_ZEILEN row {z!r}"
        art = m.group(5)
        if art in ("quellen", "quellen_busse"):
            deck.add(m.group(1))
        if art in ("busse", "quellen_busse"):
            bus.add(m.group(1))
    assert len(deck) > 40 and len(bus) > 40, "blind parser: too few old strip suffixes"
    return deck, bus


def test_zug_und_player_decken_die_alten_deck_streifen():
    alt_deck, alt_bus = _alte_streifen()
    d = erzeuge_pult.laden()["regler"]
    ohne = lambda l: {s for s in l if s != "bk/<k>"}  # noqa: E731
    assert ohne(d["zug"]) | ohne(d["player"]) == alt_deck
    assert ohne(d["bus"]) == alt_bus


def _mutiere(tmp_path, aendere):
    d = daten()
    aendere(d)
    p = tmp_path / "pult.json"
    p.write_text(json.dumps(d), encoding="utf-8")
    return p


def _dup(d): d["container"][1]["pfad"] = "deck/1"
def _p5(d): d["container"][3]["player"] = 5
def _idE(d): d["container"][3]["id"] = "E"
def _fuenf(d): d["container"].append({"id": "E", "pfad": "pad/3", "player": 5})
def _leer(d): d["regler"]["zug"] = []
def _blank(d): d["regler"]["zug"][0] = "fa der"
def _bkmitte(d): d["regler"]["zug"].insert(0, "bk/<k>")
def _kplayer(d): d["regler"]["player"].append("bk/<k>")
def _format(d): del d["format"]
def _strom0(d): d["strom_n"] = 0


@pytest.mark.parametrize("aendere", [_dup, _p5, _idE, _fuenf, _leer, _blank, _bkmitte, _kplayer, _format, _strom0])
def test_ungueltige_pult_json_ist_rot(tmp_path, aendere):
    with pytest.raises(erzeuge_pult.PultFehler):
        erzeuge_pult.laden(_mutiere(tmp_path, aendere))


def test_pult_h_traegt_die_festen_namen():
    h = PULT_H.read_text(encoding="utf-8")
    assert "PULT_CONTAINER = 4" in h and "PULT_BUSSE = 4" in h and "PULT_SENDS = 4" in h
    assert re.search(r'PULT_CONTAINER_PFAD\[4\] = \{"deck/1", "deck/2", "pad/1", "pad/2"\}', h)
    assert re.search(r"PULT_CONTAINER_PLAYER\[4\] = \{1, 2, 3, 4\}", h)
    assert "PULT_ZUG_N = 40" in h and "PULT_BUS_N = 49" in h and "PULT_PLAYER_N = 5" in h
    assert "PULT_BK_N = 64" in h and "PULT_STROEME = 16" in h and 'PULT_PLAYER_PRAEFIX = "deck"' in h


NAMEN = ["pultContainer", "pultBusse", "pultSends", "pultContainerPfad", "pultContainerPlayer", "pultBusPfad",
         "pultSendPfad", "pultBkN", "pultStroeme", "pultPlayerPraefix", "pultReglerZug", "pultReglerBus",
         "pultReglerPlayer", "pultReglerStrom", "pultAliasSuffixe", "containerVonPfad",
         "PULT_ALIAS_SUFFIXE", "PULT_ALIAS_STROEME", "pultMixIndex"]


def _exporte(p):
    return set(re.findall(r"^export (?:const|function) (\w+)", p.read_text(encoding="utf-8"), re.M))


def test_pult_ts_und_js_haben_dieselben_exportnamen():
    ts, js = _exporte(PULT_TS), _exporte(PULT_JS)
    assert ts == js
    assert set(NAMEN) <= ts


@pytest.mark.parametrize("modul", [PULT_TS, PULT_JS], ids=["ts", "js"])
def test_container_von_pfad(modul):
    faelle = {"deck/1": 1, "pad/2/fader": 4, "deck/2/komp/sc": 2, "deck/3": None, "deck/10": None, "deck/1x": None,
              "bus/1": None, "master": None, "erz/1": None, "strom/1/bk/1": None, "": None}
    skript = (f"import * as m from {json.dumps(modul.as_uri())};"
              f"const f={json.dumps(list(faelle))};console.log(JSON.stringify(f.map(p=>m.containerVonPfad(p))));")
    r = subprocess.run(["node", "--input-type=module", "-e", skript], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == list(faelle.values())


def test_erzeugte_pult_dateien_sind_aktuell():
    assert erzeuge_pult.pruefen(WURZEL) == []


def test_veraltete_pult_datei_ist_rot(tmp_path):
    for p in (PULT_H, PULT_TS, PULT_JS):
        ziel = tmp_path / p.relative_to(WURZEL)
        ziel.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(p, ziel)
    ts = tmp_path / PULT_TS.relative_to(WURZEL)
    ts.write_text(ts.read_text(encoding="utf-8") + "// stale\n", encoding="utf-8")
    meldungen = erzeuge_pult.pruefen(tmp_path)
    assert len(meldungen) == 1 and "python3 djk/contract/generate_pult.py" in meldungen[0]


def test_liste_ist_sortiert_und_eindeutig():
    r = subprocess.run([sys.executable, str(HIER / "generate_pult.py"), "--liste"], capture_output=True, text=True,
                       timeout=30)
    assert r.returncode == 0, r.stderr
    zeilen = r.stdout.splitlines()
    assert zeilen == sorted(zeilen) and len(set(zeilen)) == len(zeilen) == 416 + 196 + 20 + 1024


def test_alias_strome_und_mix_index_laufzeit():
    skript = (f"import * as p from {str(PULT_TS)!r};"
              "console.log(JSON.stringify([p.PULT_ALIAS_STROEME, p.PULT_ALIAS_SUFFIXE.length === p.pultAliasSuffixe.length,"
              "p.pultMixIndex('deck/1'), p.pultMixIndex('pad/2/fader'), p.pultMixIndex('bus/3/send/1'), p.pultMixIndex('master'),"
              "p.pultMixIndex('deck/3/stem/bass'), p.pultMixIndex('cue'), p.pultMixIndex('bus/5')]))")
    import subprocess
    r = subprocess.run(["node", "--input-type=module", "-e", skript], capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "[[1,2,3,5,6,7,9,10],true,0,3,6,8,null,null,null]"


def test_pult_json_alias_strome_und_mix_index_sind_geprueft(tmp_path):
    import json
    d = json.loads(PULT_JSON.read_text(encoding="utf-8"))
    d["alias_stroeme"] = [1, 2, 2]
    (tmp_path / "pult.json").write_text(json.dumps(d), encoding="utf-8")
    with pytest.raises(erzeuge_pult.PultFehler, match="alias_stroeme"):
        erzeuge_pult.laden(tmp_path / "pult.json")
    d = json.loads(PULT_JSON.read_text(encoding="utf-8"))
    d["mix_index"] = d["mix_index"][::-1]
    (tmp_path / "pult.json").write_text(json.dumps(d), encoding="utf-8")
    with pytest.raises(erzeuge_pult.PultFehler, match="mix_index"):
        erzeuge_pult.laden(tmp_path / "pult.json")
