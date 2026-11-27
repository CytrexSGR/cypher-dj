"""Plugin scanner: real carla-discovery-native against stub bundles and the installed LSP plugins."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
DATEN = HIER / "data" / "plugins"
SCAN = HIER.parent / "plugin_scan.py"
DISCOVERY = "/usr/lib/carla/carla-discovery-native"
LSP_VST3 = Path("/usr/lib/vst3/lsp-plugins.vst3")
LSP_LV2 = Path("/usr/lib/lv2/lsp-plugins.lv2")
DFL_LV2 = Path("/usr/lib/lv2/DragonflyHallReverb.lv2")
BAUE = HIER.parent / "vst3_klasse" / "build.sh"

pytestmark = pytest.mark.skipif(not Path(DISCOVERY).exists(), reason="carla-discovery-native missing")


def lauf(pfade, index, zaehler=None, extra=(), programm=DISCOVERY, name="discovery-zaehler.sh"):
    env = dict(os.environ)
    if zaehler is not None:
        # wrapper that logs every spawn, then runs the real discovery
        wrapper = zaehler.parent / name
        wrapper.write_text(f'#!/bin/sh\necho "$2" >> "{zaehler}"\nexec {programm} "$@"\n')
        wrapper.chmod(0o755)
        env["DJK_CARLA_DISCOVERY"] = str(wrapper)
    p = subprocess.run([sys.executable, str(SCAN), "--pfade", *map(str, pfade), "--index", str(index), *extra],
                       capture_output=True, text=True, env=env, timeout=300)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout.strip().splitlines()[-1])


def eintraege(index):
    d = json.loads(Path(index).read_text())
    assert d["version"] == 3
    return d["eintraege"]


def spawns(zaehler):
    return len(zaehler.read_text().split()) if zaehler.exists() else 0


@pytest.fixture(scope="session")
def stubs(tmp_path_factory):
    """Build the two C stubs next to a copy of the committed bundle skeletons."""
    ziel = tmp_path_factory.mktemp("stubs")
    for name in ("abbruch_stub", "schlaf_stub", "kaputt"):
        shutil.copytree(DATEN / f"{name}.vst3", ziel / f"{name}.vst3")
    for name in ("abbruch_stub", "schlaf_stub"):
        so = ziel / f"{name}.vst3/Contents/x86_64-linux"
        subprocess.run(["gcc", "-shared", "-fPIC", "-o", str(so / f"{name}.so"), str(so / "stub.c")], check=True)
    return ziel


@pytest.fixture
def arbeit(tmp_path):
    return tmp_path


def einzeln(stubs, arbeit, name):
    wurzel = arbeit / "wurzel"
    wurzel.mkdir()
    shutil.copytree(stubs / f"{name}.vst3", wurzel / f"{name}.vst3")
    return wurzel


def test_id_ist_sha1_von_format_pfad_uid(arbeit):
    if not DFL_LV2.exists():
        pytest.skip("Dragonfly not installed")
    wurzel = arbeit / "w"
    wurzel.mkdir()
    shutil.copytree(DFL_LV2, wurzel / "dfl.lv2")
    idx = arbeit / "index.json"
    lauf([wurzel], idx)
    (e,) = eintraege(idx)
    assert e["format"] == "lv2" and e["uid"] == ""
    assert e["pfad"] == "https://github.com/michaelwillis/dragonfly-reverb"
    assert e["id"] == hashlib.sha1(f"lv2:{e['pfad']}#".encode()).hexdigest()[:12]
    assert e["status"] == "ok" and e["name"] == "Dragonfly Hall Reverb"
    assert e["hersteller"] and e["audio_ein"] == 2 and e["audio_aus"] == 2 and e["parameter"] == 18
    assert e["art"] == "effekt"
    for feld in ("mtime", "groesse", "gescannt"):
        assert feld in e


def test_gutes_buendel_ok_und_zwanzig_scans_bleiben_ok(arbeit):
    if not DFL_LV2.exists():
        pytest.skip("Dragonfly not installed")
    wurzel = arbeit / "w"
    wurzel.mkdir()
    shutil.copytree(DFL_LV2, wurzel / "dfl.lv2")
    idx = arbeit / "index.json"
    for _ in range(20):
        # force a real rescan each time: drop the cached bundle state
        if idx.exists():
            idx.unlink()
        lauf([wurzel], idx)
        (e,) = eintraege(idx)
        assert e["status"] == "ok" and "grund" not in e


def test_abbruch_stub_abgestuerzt(stubs, arbeit):
    idx = arbeit / "index.json"
    lauf([einzeln(stubs, arbeit, "abbruch_stub")], idx)
    (e,) = eintraege(idx)
    assert (e["status"], e["grund"], e["uid"], e["format"]) == ("blockiert", "abgestuerzt", "", "vst3")


def test_kaputt_ungueltig(stubs, arbeit):
    idx = arbeit / "index.json"
    lauf([einzeln(stubs, arbeit, "kaputt")], idx)
    (e,) = eintraege(idx)
    assert (e["status"], e["grund"]) == ("blockiert", "ungueltig")


def test_schlaf_stub_zeit_nach_zehn_sekunden(stubs, arbeit):
    idx = arbeit / "index.json"
    t0 = time.monotonic()
    lauf([einzeln(stubs, arbeit, "schlaf_stub")], idx)
    dauer = time.monotonic() - t0
    (e,) = eintraege(idx)
    assert (e["status"], e["grund"]) == ("blockiert", "zeit")
    assert 9.5 <= dauer <= 10.5 + 1.0  # + interpreter start; the child itself is cut at 10 s
    # no orphan: the stub is gone
    assert subprocess.run(["pgrep", "-f", "discovery-native vst3 .*schlaf_stub"], capture_output=True).returncode == 1


def test_blockiert_wird_nicht_erneut_gestartet_und_beruehren_scannt_einmal(stubs, arbeit):
    wurzel = einzeln(stubs, arbeit, "abbruch_stub")
    idx, z = arbeit / "index.json", arbeit / "spawns.log"
    lauf([wurzel], idx, z)
    assert spawns(z) == 1
    r = lauf([wurzel], idx, z)
    assert spawns(z) == 1 and r["neu"] == 0 and r["blockiert"] == 1
    datei = wurzel / "abbruch_stub.vst3/Contents/x86_64-linux/abbruch_stub.so"
    t = time.time() + 5
    os.utime(datei, (t, t))
    r = lauf([wurzel], idx, z)
    assert spawns(z) == 2 and r["geaendert"] == 1
    lauf([wurzel], idx, z)
    assert spawns(z) == 2


def test_entferntes_buendel_verschwindet(stubs, arbeit):
    wurzel = einzeln(stubs, arbeit, "kaputt")
    idx = arbeit / "index.json"
    lauf([wurzel], idx)
    shutil.rmtree(wurzel / "kaputt.vst3")
    r = lauf([wurzel], idx)
    assert eintraege(idx) == [] and r["entfernt"] == 1


def test_scan_ueberlebt_alles_exit_0_und_index_atomar(stubs, arbeit):
    wurzel = arbeit / "w"
    wurzel.mkdir()
    for n in ("abbruch_stub", "kaputt"):
        shutil.copytree(stubs / f"{n}.vst3", wurzel / f"{n}.vst3")
    idx = arbeit / "sub" / "index.json"
    r = lauf([wurzel], idx)
    assert r == {"neu": 2, "entfernt": 0, "geaendert": 0, "blockiert": 2}
    assert {e["grund"] for e in eintraege(idx)} == {"abgestuerzt", "ungueltig"}
    assert [p.name for p in idx.parent.iterdir()] == ["index.json"]  # no leftover temp file


def test_ungueltiger_pfad_ist_kein_fehler(arbeit):
    r = lauf([arbeit / "gibt-es-nicht"], arbeit / "i.json")
    assert r == {"neu": 0, "entfernt": 0, "geaendert": 0, "blockiert": 0}


def test_lsp_lv2_ein_ok_eintrag_je_uri(arbeit):
    if not LSP_LV2.exists():
        pytest.skip("LSP LV2 not installed")
    wurzel = arbeit / "w"
    wurzel.mkdir()
    (wurzel / "lsp-plugins.lv2").symlink_to(LSP_LV2)
    idx = arbeit / "index.json"
    lauf([wurzel], idx)
    es = eintraege(idx)
    assert len(es) == 178
    assert all(e["status"] == "ok" and e["uid"] == "" and e["pfad"].startswith("http://lsp-plug.in/plugins/lv2/") for e in es)
    assert len({e["id"] for e in es}) == 178 == len({e["pfad"] for e in es})


@pytest.fixture(scope="module")
def shim(tmp_path_factory):
    """klasse.so built into a tmp dir (never the installed one)."""
    ziel = tmp_path_factory.mktemp("shim")
    p = subprocess.run(["bash", str(BAUE), str(ziel)], capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return ziel / "klasse.so"


def test_lsp_vst3_mehrklassen(arbeit, shim):
    if not LSP_VST3.exists():
        pytest.skip("LSP VST3 not installed")
    wurzel = arbeit / "w"
    wurzel.mkdir()
    (wurzel / "lsp-plugins.vst3").symlink_to(LSP_VST3)
    idx, z = arbeit / "index.json", arbeit / "spawns.log"
    t0 = time.monotonic()
    r = lauf([wurzel], idx, z, extra=["--shim", str(arbeit / "fehlt" / "klasse.so")])
    assert time.monotonic() - t0 > 10  # the whole bundle takes longer than the per-silence timeout; that must not kill it
    es = eintraege(idx)
    assert len(es) == 178
    assert len({e["uid"] for e in es}) == 178 and len({e["id"] for e in es}) == 178
    assert [e["klasse"] for e in es] == list(range(178))  # the position in the discovery output
    assert es[0]["status"] == "ok"
    rest = es[1:]
    assert len(rest) == 177 and all(e["status"] == "blockiert" and e["grund"] == "mehrklassen" for e in rest)
    assert "build.sh" in rest[0]["text"]
    assert r["blockiert"] == 177
    # the shim gets built: every class is ok, without a second discovery run of the unchanged bundle
    r = lauf([wurzel], idx, z, extra=["--shim", str(shim)])
    assert spawns(z) == 1
    es = eintraege(idx)
    assert [e["klasse"] for e in es] == list(range(178))
    assert all(e["status"] == "ok" and "grund" not in e and "text" not in e for e in es)
    assert r == {"neu": 0, "entfernt": 0, "geaendert": 0, "blockiert": 0}
    # and removed again: blocked again
    r = lauf([wurzel], idx, z, extra=["--shim", str(arbeit / "fehlt" / "klasse.so")])
    assert spawns(z) == 1 and r["blockiert"] == 177


def test_mehrklassen_fake_bundle_klasse_und_shim(arbeit, shim):
    wurzel = arbeit / "w"
    (wurzel / "x.vst3").mkdir(parents=True)
    d = fake(arbeit, "d.sh", block("Eins", label="eins") + block("Zwei", label="zwei") + block("Drei", label="drei"))
    idx = arbeit / "index.json"
    p = lauf_roh([wurzel], idx, d, extra=["--shim", str(shim)])
    assert p.returncode == 0, p.stderr
    es = eintraege(idx)
    assert [(e["uid"], e["klasse"], e["status"]) for e in es] == [("eins", 0, "ok"), ("zwei", 1, "ok"), ("drei", 2, "ok")]
    # identity unchanged: the id still hashes format, path and uid only
    assert es[1]["id"] == hashlib.sha1(f"vst3:{wurzel / 'x.vst3'}#zwei".encode()).hexdigest()[:12]


def test_index_version_2_wird_verworfen_und_neu_gescannt(arbeit):
    wurzel = arbeit / "w"
    (wurzel / "x.vst3").mkdir(parents=True)
    idx = arbeit / "index.json"
    d = fake(arbeit, "d.sh", block())
    assert lauf_roh([wurzel], idx, d).returncode == 0
    alt = json.loads(idx.read_text())
    alt["version"] = 2
    for e in alt["eintraege"]:
        del e["klasse"]
    idx.write_text(json.dumps(alt))
    zaehler = arbeit / "z.log"
    d2 = fake(arbeit, "d2.sh", f'echo "$2" >> "{zaehler}"\n' + block())
    assert lauf_roh([wurzel], idx, d2).returncode == 0
    assert spawns(zaehler) == 1
    (e,) = eintraege(idx)
    assert e["klasse"] == 0 and e["status"] == "ok"


# ---- fix round 1 ----

def lauf_roh(pfade, index, programm, extra=()):
    env = dict(os.environ, DJK_CARLA_DISCOVERY=str(programm))
    return subprocess.run([sys.executable, str(SCAN), "--pfade", *map(str, pfade), "--index", str(index), *extra],
                          capture_output=True, text=True, env=env, timeout=120)


def fake(arbeit, name, koerper):
    f = arbeit / name
    f.write_text("#!/bin/sh\n" + koerper)
    f.chmod(0o755)
    return f


def block(name="Fake", maker="Acme", label="fake"):
    return (f'echo "carla-discovery::init::---"\necho "carla-discovery::category::delay"\n'
            f'echo "carla-discovery::name::{name}"\necho "carla-discovery::maker::{maker}"\n'
            f'echo "carla-discovery::label::{label}"\necho "carla-discovery::audio.ins::2"\n'
            f'echo "carla-discovery::audio.outs::2"\necho "carla-discovery::end::---"\n')


@pytest.mark.parametrize("modus", ["fehlt", "nicht_ausfuehrbar"])
def test_discovery_fehlt_exit_3_index_unveraendert(stubs, arbeit, modus):
    wurzel = einzeln(stubs, arbeit, "kaputt")
    idx = arbeit / "index.json"
    lauf([wurzel], idx)
    vorher = idx.read_text()
    prog = arbeit / "nix"
    if modus == "nicht_ausfuehrbar":
        prog.write_text("#!/bin/sh\n")
        prog.chmod(0o644)
    p = lauf_roh([wurzel], idx, prog)
    assert p.returncode == 3 and "discovery_fehlt" in p.stderr
    assert idx.read_text() == vorher
    # a later run with a working program changes nothing it should not, and nothing was wrongly blocked
    assert {e["grund"] for e in eintraege(idx)} == {"ungueltig"}


def test_discovery_fehlt_blockiert_nichts_dauerhaft(arbeit):
    wurzel = arbeit / "w"
    (wurzel / "x.vst3").mkdir(parents=True)
    idx = arbeit / "index.json"
    p = lauf_roh([wurzel], idx, arbeit / "nix")
    assert p.returncode == 3 and not idx.exists()
    r = lauf_roh([wurzel], idx, fake(arbeit, "ok.sh", block()))
    assert r.returncode == 0 and eintraege(idx)[0]["status"] == "ok"


def test_discovery_wechsel_scannt_blockierte_einmal_neu(stubs, arbeit):
    wurzel = einzeln(stubs, arbeit, "abbruch_stub")
    idx, z = arbeit / "index.json", arbeit / "spawns.log"
    lauf([wurzel], idx, z)
    lauf([wurzel], idx, z)
    assert spawns(z) == 1
    lauf([wurzel], idx, z, programm=DISCOVERY + " ", name="anderes.sh")  # a different program path
    assert spawns(z) == 2
    lauf([wurzel], idx, z, programm=DISCOVERY + " ", name="anderes.sh")
    assert spawns(z) == 2


def test_vollstaendiger_block_dann_absturz_ist_ok(arbeit):
    wurzel = arbeit / "w"
    (wurzel / "x.vst3").mkdir(parents=True)
    idx = arbeit / "index.json"
    lauf_roh([wurzel], idx, fake(arbeit, "d.sh", block() + "kill -ABRT $$\n"))
    (e,) = eintraege(idx)
    assert e["status"] == "ok" and e["name"] == "Fake"
    idx2 = arbeit / "index2.json"
    lauf_roh([wurzel], idx2, fake(arbeit, "d2.sh", "echo 'carla-discovery::init::---'\necho 'carla-discovery::name::Halb'\nkill -ABRT $$\n"))
    assert eintraege(idx2)[0]["status"] == "blockiert"


def test_symlink_und_realpfad_sind_ein_buendel(stubs, arbeit):
    wurzel = einzeln(stubs, arbeit, "kaputt")
    zweit = arbeit / "zweit"
    zweit.mkdir()
    (zweit / "alias.vst3").symlink_to(wurzel / "kaputt.vst3")
    idx, z = arbeit / "index.json", arbeit / "spawns.log"
    lauf([wurzel, zweit], idx, z)
    assert spawns(z) == 1 and len(eintraege(idx)) == 1


def test_eigen_nur_nach_maker_oder_ordner(arbeit):
    wurzel = arbeit / "w"
    for n in ("a", "b"):
        (wurzel / f"{n}.vst3").mkdir(parents=True)
    # third party named Cypher...: kept; maker cypher-dj: own, hidden
    d = fake(arbeit, "d.sh", 'case "$2" in *a.vst3) ' + block("Cypher Delay", "Acme") + ';; *) ' + block("Anders", "cypher-dj") + ';; esac\n')
    idx = arbeit / "index.json"
    lauf_roh([wurzel], idx, d)
    assert [e["name"] for e in eintraege(idx)] == ["Cypher Delay"]
    lauf_roh([wurzel], idx, d, extra=["--mit-eigenen"])
    hier = [e for e in eintraege(idx) if e["buendel"].startswith(str(wurzel))]  # --mit-eigenen also adds the real own folder
    assert {e["name"] for e in hier} == {"Cypher Delay", "Anders"}
    assert [e.get("eigen") for e in hier if e["name"] == "Anders"] == [True]
    assert not any(e.get("eigen") for e in hier if e["name"] == "Cypher Delay")
