import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ablage  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
NO_ENV = {"HOME": "/tmp/h0"}


def neu_tabelle():
    t = json.loads((REPO / "djk" / "config" / "ablage.json").read_text(encoding="utf-8"))
    t["vorgabe"] = "neu"
    return t


def test_gleiche_tabelle_wie_ts(tmp_path):
    env = {k: v for k, v in os.environ.items() if not k.startswith("CYPHERDJ_")}
    env["HOME"] = str(tmp_path)
    js = ("import * as P from './paths.ts'; const o={}; for (const a of P.ablageArten()) o[a]=P.ablageOrte(a);"
          " console.log(JSON.stringify(o));")
    r = subprocess.run(["node", "--input-type=module", "-e", js], cwd=REPO / "djk" / "ui", env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == {a: ablage.orte(a, env) for a in ablage.arten()}
    assert len(ablage.arten()) == 18


def test_env_leer_ist_ungesetzt():
    assert ablage.ordner("kits", {**NO_ENV, "CYPHERDJ_KIT_ORDNER": "/tmp/k"}) == Path("/tmp/k")
    assert ablage.ordner("kits", {**NO_ENV, "CYPHERDJ_KIT_ORDNER": ""}) == Path("/tmp/h0/.config/cypherdj/kits")
    assert ablage.fest("mediathek", {**NO_ENV, "CYPHERDJ_MEDIATHEK": ""}) == Path("/tmp/h0/.local/share/cypherdj/mediathek/mediathek.sqlite")
    assert ablage.fest("analyse", {**NO_ENV, "CYPHERDJ_ANALYSE": "/tmp/a"}) == Path("/tmp/a")


def test_heim_relativ_abgelehnt():
    with pytest.raises(ValueError, match="CYPHERDJ_HEIM must be an absolute path"):
        ablage.heim({**NO_ENV, "CYPHERDJ_HEIM": "rel"})
    with pytest.raises(ValueError, match="CYPHERDJ_HEIM must be an absolute path"):
        ablage.heim({**NO_ENV, "CYPHERDJ_HEIM": "  "})
    assert ablage.heim({**NO_ENV, "CYPHERDJ_HEIM": "/tmp/h/"}) == Path("/tmp/h")
    assert ablage.heim(NO_ENV) == Path("/tmp/h0/cypherdj")
    assert ablage.orte("kits", {**NO_ENV, "CYPHERDJ_HEIM": "/tmp/h/"})["neu"] == "/tmp/h/werke/kits"


def test_beide_bleibt_alt(tmp_path, capsys):
    ablage._gewarnt.clear()
    alt = tmp_path / ".config/cypherdj/presets"
    neu = tmp_path / "cypherdj/werke/presets"
    alt.mkdir(parents=True)
    neu.mkdir(parents=True)
    (neu / "x.json").write_text("{}")
    env = {"HOME": str(tmp_path)}
    t = neu_tabelle()
    assert ablage.ordner("presets", env, t) == alt
    assert ablage.ordner("presets", env, t) == alt
    assert capsys.readouterr().err.count("ablage_beide") == 1
    # migrated (alt is a link) and fresh give neu
    h2 = tmp_path / "h2"
    (h2 / "cypherdj/werke/presets").mkdir(parents=True)
    (h2 / ".config/cypherdj").mkdir(parents=True)
    (h2 / ".config/cypherdj/presets").symlink_to(h2 / "cypherdj/werke/presets")
    assert ablage.ordner("presets", {"HOME": str(h2)}, t) == h2 / "cypherdj/werke/presets"
    assert ablage.ordner("presets", {"HOME": str(tmp_path / "h3")}, t) == tmp_path / "h3/cypherdj/werke/presets"
    assert ablage.ordner("kits", {"HOME": str(tmp_path / "h3")}, t) == tmp_path / "h3/.config/cypherdj/kits"


def test_regel3_toter_link_bricht_ab(tmp_path):
    """Point (b): moved home, disk missing: alt is a link to a missing target; no silent fallback to neu."""
    h = tmp_path / "h"
    (h / ".config/cypherdj").mkdir(parents=True)
    (h / ".config/cypherdj/presets").symlink_to(tmp_path / "platte/heim/werke/presets")
    with pytest.raises(ValueError, match="is the disk mounted"):
        ablage.ordner("presets", {"HOME": str(h)}, neu_tabelle())


def test_lesbarer_name_wie_vektoren():
    v = json.loads((REPO / "docs" / "interfaces" / "lesbare_namen.json").read_text(encoding="utf-8"))["vektoren"]
    assert len(v) >= 5
    for x in v:
        got = ablage.lesbarer_name(x["text"], x["max"]) if "max" in x else ablage.lesbarer_name(x["text"])
        assert got == x["erwartet"], x


def test_shell_ausgabe_quotiert(tmp_path):
    heim = tmp_path / "mein heim"
    env = {k: v for k, v in os.environ.items() if not k.startswith("CYPHERDJ_")}
    env.update(HOME=str(tmp_path), CYPHERDJ_HEIM=str(heim), PYTHONPATH=str(REPO / "djk"))
    r = subprocess.run(["bash", "-c", 'eval "$(python3 -m ablage shell)"; printf %s "$ABLAGE_PRUEFEN"'], env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    assert r.stdout == f"{heim}/pruefen"
    out = subprocess.run(["python3", "-m", "ablage", "shell"], env=env, capture_output=True, text=True, timeout=60).stdout
    assert "ABLAGE_KITS=" in out and "ABLAGE_PLUGIN_INDEX=" in out
    p = subprocess.run(["python3", "-m", "ablage", "pfad", "quellen"], env=env, capture_output=True, text=True, timeout=60)
    assert p.stdout.strip() == f"{heim}/quellen.toml"
    r2 = subprocess.run(["python3", "-m", "ablage", "pfad", "referenzen"], env=env, capture_output=True, text=True, timeout=60)
    assert r2.stdout.strip() == f"{heim}/werke/referenzen"


def _ohne_cypherdj():
    return {k: v for k, v in os.environ.items() if not k.startswith("CYPHERDJ_")}


def test_pruefinstanz_gleiche_antworten_wie_ts(tmp_path):
    """Instance e, no env override: every kind and fixed name resolves to the same path in Python and in paths.ts (own /dev/shm folder, core kinds and
    the shm-null names stay at the real place)."""
    env = _ohne_cypherdj()
    env.update(HOME=str(tmp_path), CYPHERDJ_INSTANZ="e")
    js = ("import * as P from './paths.ts'; const o={}; for (const a of P.ablageArten()) o[a]=P.ablageOrdner(a);"
          " for (const n of ['mediathek','analyse','bibliothek_konfig','surge_werk','plugin_index','umgebung','pruefen','quellen','referenzen']) o[n]=P.festerPfad(n);"
          " console.log(JSON.stringify(o));")
    r = subprocess.run(["node", "--input-type=module", "-e", js], cwd=REPO / "djk" / "ui", env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    py = {a: str(ablage.ordner(a, env)) for a in ablage.arten()}
    py.update({n: str(ablage.fest(n, env)) for n in ablage.fest_namen()})
    assert json.loads(r.stdout) == py
    stay = {"kits", "loops", "surge_werk", "umgebung"}
    for k, v in py.items():
        if k not in stay:
            assert v.startswith("/dev/shm/cypherdj-e/"), (k, v)


def test_pruefinstanz_env_gewinnt_und_betrieb_bleibt():
    e = {"HOME": "/tmp/h0", "CYPHERDJ_INSTANZ": "e", "CYPHERDJ_SAMPLER": "/tmp/s", "CYPHERDJ_MEDIATHEK": "/tmp/m.sqlite"}
    assert ablage.ordner("sampler", e) == Path("/tmp/s")
    assert ablage.fest("mediathek", e) == Path("/tmp/m.sqlite")
    assert ablage.ordner("klaenge", {**e, "CYPHERDJ_KLAENGE": ""}) == Path("/dev/shm/cypherdj-e/klaenge")
    live = {"HOME": "/tmp/h0", "CYPHERDJ_INSTANZ": ""}
    assert ablage.ordner("sampler", live) == Path("/tmp/h0/cypherdj/werke/sampler")
    assert ablage.fest("mediathek", live) == Path("/tmp/h0/.local/share/cypherdj/mediathek/mediathek.sqlite")
    assert ablage.fest("surge_werk", e) == Path("/tmp/h0/.local/share/cypherdj/surge-daten/usr/share/surge-xt/patches_factory")


def test_art_ohne_alt_liegt_immer_bei_neu():
    """mitschnitte has no old place (alt is empty): neu under vorgabe neu and alt, and the env still wins."""
    env = {"HOME": "/tmp/h0"}
    assert ablage.ordner("mitschnitte", env, neu_tabelle()) == Path("/tmp/h0/cypherdj/werke/mitschnitte")
    assert ablage.ordner("mitschnitte", env, {**neu_tabelle(), "vorgabe": "alt"}) == Path("/tmp/h0/cypherdj/werke/mitschnitte")
    assert ablage.ordner("mitschnitte", {**env, "CYPHERDJ_MITSCHNITTE": "/tmp/m"}) == Path("/tmp/m")
