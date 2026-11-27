"""One-class VST3 shim: build it, wrap one class of the installed LSP VST3 bundle, and let carla-discovery-native see it."""
import subprocess
from pathlib import Path

import pytest

import plugin_scan
import vst3_klasse

HIER = Path(__file__).resolve().parent
BAUE = HIER.parent / "vst3_klasse" / "build.sh"
DISCOVERY = Path("/usr/lib/carla/carla-discovery-native")
LSP_VST3 = Path("/usr/lib/vst3/lsp-plugins.vst3")
KLASSE = 5

pytestmark = [
    pytest.mark.skipif(not DISCOVERY.exists(), reason="carla-discovery-native missing"),
    pytest.mark.skipif(not LSP_VST3.exists(), reason="LSP VST3 bundle /usr/lib/vst3/lsp-plugins.vst3 not installed"),
]


@pytest.fixture(scope="module")
def shim(tmp_path_factory):
    ziel = tmp_path_factory.mktemp("bau")
    p = subprocess.run(["bash", str(BAUE), str(ziel)], capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    so = ziel / "klasse.so"
    assert so.is_file()
    return so


def test_shim_zeigt_genau_eine_klasse(shim, tmp_path, monkeypatch):
    monkeypatch.setenv("DJK_CARLA_DISCOVERY", str(DISCOVERY))
    echt, ausgang = plugin_scan.entdecke("vst3", str(LSP_VST3))
    assert ausgang == "ok" and len(echt) > KLASSE

    wurzel = tmp_path / "klassen"
    pfad = vst3_klasse.buendel(str(LSP_VST3), KLASSE, "lsp-k5", wurzel=wurzel, shim=shim)
    assert Path(pfad) == wurzel / "lsp-k5.vst3"
    so = Path(pfad) / "Contents" / "x86_64-linux" / "lsp-k5.so"
    assert so.read_bytes() == shim.read_bytes() and not so.is_symlink()
    zeilen = (Path(pfad) / "Contents" / "Resources" / "klasse.txt").read_text().splitlines()
    assert zeilen == [str((LSP_VST3 / "Contents" / "x86_64-linux" / "lsp-plugins.so").resolve()), str(KLASSE)]

    bloecke, ausgang = plugin_scan.entdecke("vst3", pfad)
    assert ausgang == "ok"
    assert len(bloecke) == 1
    assert bloecke[0]["label"] == echt[KLASSE]["label"]
    assert bloecke[0]["name"] == echt[KLASSE]["name"]


def test_buendel_idempotent(shim, tmp_path):
    wurzel = tmp_path / "klassen"
    a = vst3_klasse.buendel(str(LSP_VST3), 2, "x", wurzel=wurzel, shim=shim)
    b = vst3_klasse.buendel(str(LSP_VST3), 3, "x", wurzel=wurzel, shim=shim)
    assert a == b
    assert (Path(b) / "Contents" / "Resources" / "klasse.txt").read_text().splitlines()[1] == "3"
    assert sorted(p.name for p in (Path(b) / "Contents" / "x86_64-linux").iterdir()) == ["x.so"]


def test_ohne_gebautes_shim(tmp_path):
    with pytest.raises(FileNotFoundError):
        vst3_klasse.buendel(str(LSP_VST3), 0, "y", wurzel=tmp_path / "k", shim=tmp_path / "fehlt.so")
