"""The generator of the starter demo and the shape of the project it writes: structure and relative levels only.
Measured levels live in ui/tests/starter_demo.test.mjs (real render)."""
import json
import subprocess
from pathlib import Path

import pytest

from starter import demo_build as demo_bauen

DJK = Path(__file__).resolve().parents[2]
PROJEKT = DJK / "starter" / "demo" / "project.json"
DEMOS = DJK / "instruments" / "modular_dsp" / "demos"
BEAT_PRO_TAKT = 4


def _lies() -> dict:
    return json.loads(PROJEKT.read_text())


def _noten(name: str) -> list[dict]:
    s = next(s for s in _lies()["spuren"] if s["name"] == name)
    assert len(s["clips"]) == 1
    return sorted(s["clips"][0]["noten"], key=lambda n: n["beat"])


def _node(js: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True)


def test_file_equals_bauen_and_pruefe_exits_zero():
    assert PROJEKT.read_text() == demo_bauen.text()
    assert demo_bauen.main(["--pruefe"]) == 0
    assert demo_bauen.bauen() == demo_bauen.bauen(), "deterministic"
    assert PROJEKT.stat().st_size < 200_000


def test_file_is_what_modell_ts_writes():
    """normalisiere (storage.ts) leaves the file unchanged: sorted keys, one space of indent, final newline."""
    js = (f"import {{ normalisiere }} from {json.dumps(str(DJK / 'ui' / 'project' / 'storage.ts'))};"
          f"import fs from 'node:fs';"
          f"const t = fs.readFileSync({json.dumps(str(PROJEKT))}, 'utf8');"
          f"const n = JSON.stringify(normalisiere(JSON.parse(t)), null, 1) + '\\n';"
          f"if (n !== t) {{ console.error('not canonical'); process.exit(1); }}")
    r = _node(js)
    assert r.returncode == 0, r.stderr


def test_shape():
    p = _lies()
    assert p["format"] == "cypherdj-projekt/2" and p["name"] == "Demo"
    assert p["tempo_bpm"] == 128 and p["taktart"] == [4, 4]
    assert p["loop"] == {"an": True, "von_beat": 0, "bis_beat": 128}
    assert [s["name"] for s in p["spuren"]] == ["Drums", "Bass", "Acid", "Pad"]
    assert [r["name"] for r in p.get("returns", [])] == ["Hall", "Echo"]
    echo = p["returns"][1]
    assert echo["hall"]["an"] is False and [i["graph"] for i in echo["inserts"]] == ["fx-delay-sync"]
    assert [x["id"] for x in next(s for s in p["spuren"] if s["name"] == "Drums")["sends"]] == ["r1", "r2"], "the drums feed the echo"
    assert [g["name"] for g in p["gruppen"]] == ["Music"]
    gid = p["gruppen"][0]["id"]
    assert sorted(s["name"] for s in p["spuren"] if s.get("ausgang", {}).get("id") == gid) == ["Acid", "Bass", "Pad"]
    sends = {s["name"] for s in p["spuren"] if any(x["id"] == p["returns"][0]["id"] for x in s.get("sends", []))}
    assert sends == {"Drums", "Pad"}
    geraete = {s["name"]: s["geraet"] for s in p["spuren"]}
    assert geraete["Drums"] == {"art": "intern", "name": "kit", "kit": "starter"}
    assert geraete["Bass"]["graph"] == "bassmusik"
    assert geraete["Pad"]["graph"] == "synth-poly"
    assert geraete["Acid"]["name"] == "rb338" and geraete["Acid"]["parameter"]["lautstaerke"] == 1.0
    for s in p["spuren"]:
        assert s["art"] == "instrument"
        assert [c["art"] for c in s["clips"]] == ["midi"], "one MIDI clip, no audio clip"
        c = s["clips"][0]
        assert c["start_beat"] == 0 and c["laenge_beats"] == 128
        assert c["noten"] and all(0 <= n["beat"] and n["beat"] + n["laenge"] <= 128 for n in c["noten"])
    assert '"audio"' not in json.dumps(p)
    lanes = {s["name"]: {a["ziel"] for a in s.get("automation", [])} for s in p["spuren"]}
    assert "geraet.cutoff" in lanes["Acid"], "the acid cutoff opens over the build"
    assert {"geraet.k1", "geraet.k3", "geraet.k5"} <= lanes["Bass"], "cutoff, wobble rate and growl of bassmusik move"
    assert {"fader", "geraet.k1"} <= lanes["Pad"], "the pad is pulled up in the break: level and cutoff"
    acid = next(s for s in p["spuren"] if s["name"] == "Acid")
    assert [i["art"] for i in acid["inserts"]] == ["saett"]


def test_every_graph_ships_with_the_starter_and_has_no_latency():
    """The starter copies demos/*.json and demos/recipes/*.json; the core refuses a graph with latency on a project track."""
    p = _lies()
    kits = {k["name"] for k in json.loads((DJK / "starter" / "kits.json").read_text())}
    namen = []
    for s in p["spuren"]:
        g = s["geraet"]
        if g["name"] == "kit":
            assert g["kit"] in kits
        if g["name"] == "bk":
            namen.append(g["graph"])
            assert (DEMOS / f"{g['graph']}.json").is_file() or (DEMOS / "recipes" / f"{g['graph']}.json").is_file()
    assert namen
    from starter import graphs as graphen
    ausgeliefert = {q.stem for q in graphen.quellen_der_beispiele(DJK)}
    assert set(namen) <= ausgeliefert
    js = (f"import {{ graphLatenz }} from {json.dumps(str(DJK / 'ui' / 'graphs.ts'))};"
          f"import fs from 'node:fs';"
          f"const out = {{}};"
          f"for (const n of {json.dumps(namen)}) {{"
          f"const f = [{json.dumps(str(DEMOS))} + '/' + n + '.json', {json.dumps(str(DEMOS / 'recipes'))} + '/' + n + '.json'].find((x) => fs.existsSync(x));"
          f"out[n] = graphLatenz(JSON.parse(fs.readFileSync(f, 'utf8'))); }}"
          f"console.log(JSON.stringify(out));")
    r = _node(js)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout.strip().splitlines()[-1]) == {n: 0 for n in namen}


def test_synth_neuro_has_latency_and_is_therefore_not_the_bass():
    """synth-neuro reports 69 samples. A project track accepts such a graph since the delay compensation counts it (arr_pdc.h); the demo still plays the latency-free bassmusik."""
    js = (f"import {{ graphLatenz }} from {json.dumps(str(DJK / 'ui' / 'graphs.ts'))};"
          f"import fs from 'node:fs';"
          f"console.log(graphLatenz(JSON.parse(fs.readFileSync({json.dumps(str(DEMOS / 'synth-neuro.json'))}, 'utf8'))));")
    r = _node(js)
    assert r.returncode == 0, r.stderr
    assert int(r.stdout.strip().splitlines()[-1]) > 0


def test_only_drums_play_in_the_first_four_bars():
    for name in ("Bass", "Acid", "Pad"):
        assert all(n["beat"] >= 4 * BEAT_PRO_TAKT for n in _noten(name)), name
    assert any(n["beat"] < 4 * BEAT_PRO_TAKT for n in _noten("Drums"))


def test_entries_follow_the_arrangement():
    assert min(n["beat"] for n in _noten("Bass")) >= 32
    assert min(n["beat"] for n in _noten("Acid")) >= 48
    assert min(n["beat"] for n in _noten("Pad")) == 16, "the pad enters quietly in bar 5, before the bass"
    fader = next(a for a in next(s for s in _lies()["spuren"] if s["name"] == "Pad")["automation"] if a["ziel"] == "fader")
    werte = {q["beat"]: q["wert"] for q in fader["punkte"]}
    assert werte[16] <= -15 and max(w for b, w in werte.items() if 64 <= b < 80) >= werte[16] + 12, "quiet first, up in the break"
    # never more than one new track per 4 bars before the drop: first notes are about 16 beats (4 bars) apart
    ersten = sorted(min(n["beat"] for n in _noten(x)) for x in ("Bass", "Acid", "Pad"))
    assert all(b - a >= 15.5 for a, b in zip(ersten, ersten[1:]))


def test_the_break_has_no_kick_and_the_drop_has_one():
    kicks = [n["beat"] for n in _noten("Drums") if n["ton"] == 36]
    assert not [b for b in kicks if 64 <= b < 80]
    assert 80 in kicks
    assert 76 not in kicks and all(b in kicks for b in range(0, 16))
    assert not [n for n in _noten("Bass") if 64 <= n["beat"] < 80], "the bass drops out as well"


def test_snare_appears_first_in_the_build_fill():
    snare = [n["beat"] for n in _noten("Drums") if n["ton"] == 38]
    assert min(snare) == 56
    assert not [b for b in snare if 56 > b]


def test_acid_has_accents_and_slides():
    """The RB-338 accents from velocity 120 and glides into a note that starts while the previous one still sounds."""
    ton = _noten("Acid")
    for takt in list(range(12, 16)) + list(range(18, 32)):
        im_takt = [n for n in ton if takt * 4 <= n["beat"] < takt * 4 + 4]
        assert 8 <= len(im_takt) <= 13, f"bar {takt + 1}"
        assert 2 <= len([n for n in im_takt if n["vel"] >= 120]) <= 5, f"accents in bar {takt + 1}"
        assert all(n["vel"] < 120 or n["vel"] == 127 for n in im_takt)
    slides = [a for a, b in zip(ton, ton[1:]) if a["beat"] + a["laenge"] > b["beat"]]
    assert len(slides) >= 40
    assert all(n["ton"] >= 43 for n in ton), "above the bass"


def test_the_bass_moves_in_the_drop():
    bass = _noten("Bass")
    for takt in range(20, 32):
        im_takt = [n for n in bass if takt * 4 <= n["beat"] < takt * 4 + 4]
        assert len(im_takt) >= 7 and len({n["ton"] for n in im_takt}) >= 3, f"bar {takt + 1}"
        assert all(n["beat"] % 1 != 0 for n in im_takt), "never on the kick"
    s = next(s for s in _lies()["spuren"] if s["name"] == "Bass")
    for ziel in ("geraet.k1", "geraet.k5"):
        lane = next(a for a in s["automation"] if a["ziel"] == ziel)
        spruenge = [q for q in lane["punkte"] if q.get("form") == "sprung" and q["beat"] >= 80]
        assert len(spruenge) == 24, f"{ziel}: one jump per half bar of the drop"


def test_the_pad_holds_chords_one_to_two_bars():
    gruppen: dict[float, list[dict]] = {}
    for n in _noten("Pad"):
        gruppen.setdefault(n["beat"], []).append(n)
    assert all(len(v) >= 3 for v in gruppen.values()), "chords, not single notes"
    assert all(4 <= n["laenge"] <= 8 for n in _noten("Pad"))


def test_ids_and_counters_are_consistent():
    p = _lies()
    ids = [n["id"] for s in p["spuren"] for n in s["clips"][0]["noten"]]
    assert len(set(ids)) == len(ids)
    assert p["naechste_noten_id"] == max(int(i[1:]) for i in ids) + 1
    lanes = [a["id"] for s in p["spuren"] for a in s.get("automation", [])]
    assert p["naechste_id"]["lane"] == max(int(i[1:]) for i in lanes) + 1
    assert p["naechste_id"]["spur"] == 5 and p["naechste_id"]["gruppe"] == 2 and p["naechste_id"]["return"] == 3
    assert p["naechste_id"]["insert"] == 3


def test_pruefe_fails_on_a_stale_file(tmp_path, monkeypatch):
    stale = tmp_path / "project.json"
    stale.write_text(demo_bauen.text().replace('"Demo"', '"Other"'))
    monkeypatch.setattr(demo_bauen, "DATEI", stale)
    assert demo_bauen.main(["--pruefe"]) == 1
    monkeypatch.setattr(demo_bauen, "DATEI", tmp_path / "missing.json")
    assert demo_bauen.main(["--pruefe"]) == 1
