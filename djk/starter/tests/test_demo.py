import json
import os
import subprocess
from pathlib import Path

import pytest

from starter import __main__ as starter_main
from starter import demo

DJK = Path(__file__).resolve().parents[2]
PROJEKT = DJK / "starter" / "demo" / "project.json"
MODELL = DJK / "ui" / "project" / "model.ts"


def _lies() -> dict:
    return json.loads(PROJEKT.read_text())


def test_pruefe_projekt_accepts_the_file():
    js = (f"import {{ pruefeProjekt }} from {json.dumps(str(MODELL))};"
          f"import fs from 'node:fs';"
          f"const g = pruefeProjekt(JSON.parse(fs.readFileSync({json.dumps(str(PROJEKT))}, 'utf8')));"
          f"if ('fehler' in g) {{ console.error(g.fehler); process.exit(1); }}")
    r = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_shape_follows_the_plan():
    p = _lies()
    assert p["format"] == "cypherdj-projekt/2" and p["name"] == "Demo"
    assert p["tempo_bpm"] == 128 and p["taktart"] == [4, 4]
    assert p["loop"] == {"an": True, "von_beat": 0, "bis_beat": 64}
    assert p["master"] == {"fader_db": 0}
    assert [(s["name"], s["fader_db"]) for s in p["spuren"]] == [("Drums", -4.5), ("Bass", 1.5), ("Acid", -1.5), ("Chords", -6)]
    geraete = [s["geraet"] for s in p["spuren"]]
    assert geraete[0] == {"art": "intern", "name": "kit", "kit": "starter"}
    assert [(g["name"], g.get("graph")) for g in geraete[1:]] == [("bk", "synth-mono"), ("rb338", None), ("bk", "synth-poly")]
    for s in p["spuren"]:
        assert s["art"] == "instrument"
        assert [c["art"] for c in s["clips"]] == ["midi"], "one MIDI clip, no audio clip"
        c = s["clips"][0]
        assert (c["start_beat"], c["laenge_beats"], c["loop_beats"]) == (0, 64, 16)
        assert c["noten"] and all(0 <= n["beat"] and n["beat"] + n["laenge"] <= 16 for n in c["noten"]), "notes inside the 16-beat loop"
    assert not [k for k in json.dumps(p).split('"') if k == "audio"]


def test_acid_is_loud_enough_to_matter():
    acid = _lies()["spuren"][2]
    assert acid["geraet"]["parameter"]["lautstaerke"] == 1.0
    assert acid["fader_db"] > -12


def test_every_graph_is_a_shipped_example_and_the_kit_is_in_kits_json():
    p = _lies()
    for s in p["spuren"]:
        g = s["geraet"]
        if g["name"] == "bk":
            assert (DJK / "instruments" / "modular_dsp" / "demos" / f"{g['graph']}.json").is_file()
        if g["name"] == "kit":
            kits = json.loads((DJK / "starter" / "kits.json").read_text())
            assert g["kit"] in {k["name"] for k in kits}


def test_kopiere_demo_twice_keeps_the_first_copy(tmp_path):
    wurzel = tmp_path / "projekte"
    assert demo.kopiere_demo(wurzel) == "neu"
    d = wurzel / "demo"
    assert json.loads((d / "project.json").read_text()) == _lies()
    assert (d / "undo.jsonl").read_text() == ""
    (d / "project.json").write_text('{"meins": 1}\n')
    assert demo.kopiere_demo(wurzel) == "behalten"
    assert (d / "project.json").read_text() == '{"meins": 1}\n'


def test_an_existing_demo_folder_is_never_touched(tmp_path):
    d = tmp_path / "projekte" / "demo"
    d.mkdir(parents=True)
    (d / "notiz.txt").write_text("x")
    assert demo.kopiere_demo(tmp_path / "projekte") == "behalten"
    assert sorted(p.name for p in d.iterdir()) == ["notiz.txt"]
    assert sorted(p.name for p in (tmp_path / "projekte").iterdir()) == ["demo"], "no temporary folder left"


def test_wurzel_follows_the_instance_rule(tmp_path):
    assert demo.projekt_wurzel("") == Path.home() / "cypherdj-projekte"
    assert demo.projekt_wurzel("f") == Path("/dev/shm/cypherdj-f/projekte")
    with pytest.raises(ValueError):
        demo.projekt_wurzel("ff")


def test_step_demo_writes_into_the_throwaway_home_only(tmp_path, capsys):
    assert starter_main.main(["--nur", "demo"]) == 0
    assert (Path.home() / "cypherdj-projekte" / "demo" / "project.json").is_file()
    assert "installed project demo" in capsys.readouterr().out
    assert str(Path.home()).startswith(str(tmp_path))
    assert starter_main.main(["--nur", "demo"]) == 0
    assert "kept project demo" in capsys.readouterr().out
