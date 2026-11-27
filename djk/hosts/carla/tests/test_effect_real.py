"""Plan 1.11 task 2: the real host (Carla 2.5.8 under pw-jack) in --effekt mode. Starts JACK clients in the live graph
(unconnected, own names): only with EFFEKT_ECHT=1. Every process started here is terminated at the end of its test."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from host_control import sende

WIRT = Path(__file__).resolve().parent.parent / "instrument_host.py"
VST3 = Path.home() / ".local/lib/cypherdj/vst3"
EQ = f"vst3:{VST3 / 'Cypher EQ.vst3'}#"
LSP = "lv2:http://lsp-plug.in/plugins/lv2/limiter_stereo#"
A_EQ = "lv2:urn:ardour:a-eq#"
LSP_SC = "lv2:http://lsp-plug.in/plugins/lv2/sc_compressor_stereo#"
LSP_KOMP = "lv2:http://lsp-plug.in/plugins/lv2/compressor_stereo#"
pytestmark = pytest.mark.skipif(os.environ.get("EFFEKT_ECHT") != "1", reason="real run starts JACK clients: only with EFFEKT_ECHT=1")


class Wirt:
    def __init__(self, tmp_path, spec, name, *extra):
        self.status, self.sock = tmp_path / "w.json", str(tmp_path / "w.sock")
        self.p = subprocess.Popen(["pw-jack", sys.executable, str(WIRT), "--name", name, "--effekt", spec, "--sock", self.sock,
                                   "--status", str(self.status), *extra], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def warte_bereit(self):
        for _ in range(80):
            if self.status.exists() and json.loads(self.status.read_text()).get("bereit"):
                return json.loads(self.status.read_text())
            assert self.p.poll() is None, self.p.stdout.read().decode()
            time.sleep(0.25)
        raise AssertionError("host not ready")

    def lade(self):
        return sende(self.sock, {"befehl": "lade"}, timeout=60)

    def ende(self):
        if self.p.poll() is None:
            self.p.terminate()
        try:
            self.p.wait(10)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait()


@pytest.fixture
def wirt(tmp_path):
    gestartet = []

    def start(spec, name, *extra):
        w = Wirt(tmp_path, spec, name, *extra)
        gestartet.append(w)
        return w

    yield start
    for w in gestartet:
        w.ende()


def lade_und_info(w):
    assert w.warte_bereit()["effekt"] == "leer"
    assert w.lade()["ok"]
    return sende(w.sock, {"befehl": "info"})


def test_cypher_eq_laedt(wirt):
    info = lade_und_info(wirt(EQ, "t2-eq"))
    assert info["ok"] and info["latenz"] == 69, info
    assert info["audio_ein"] >= 1 and len(info["parameter"]) > 0


def test_lsp_limiter_lv2(wirt):
    info = lade_und_info(wirt(LSP, "t2-lsp"))
    assert info["ok"] and info["latenz"] == 240, info


def test_a_eq_lv2_laedt(wirt):
    w = wirt(A_EQ, "t2-aeq")
    info = lade_und_info(w)
    assert info["ok"] and info["audio_ein"] == 2, info
    # LV2 values are mapped from 0..1 onto [min, max]: a parameter with a real range must read back what was set
    p = next(x for x in info["parameter"] if x["max"] - x["min"] > 2)
    assert sende(w.sock, {"befehl": "params_setzen", "werte": {str(p["index"]): 0.5}})["ok"]
    assert sende(w.sock, {"befehl": "params"})["werte"][str(p["index"])] == pytest.approx(0.5, abs=0.01)
    # the plugin's own value must sit in the middle of [min, max]: unscaled it would be 0.5
    assert p["min"] + 0.5 * (p["max"] - p["min"]) != 0.5
    assert w.p.poll() is None


def test_vital_vst3_als_effekt_abgelehnt(wirt, tmp_path):
    w = wirt(f"vst3:{Path.home() / '.vst3/Vital.vst3'}#", "t2-vital")
    w.warte_bereit()
    assert not w.lade()["ok"]
    assert w.p.wait(30) == 2
    s = json.loads(w.status.read_text())
    assert s["fehler"] == ["kein_effekt"], s


def test_uid_unbekannt(wirt):
    w = wirt(f"vst3:{VST3 / 'Cypher EQ.vst3'}#gibt-es-nicht", "t2-uid")
    w.warte_bereit()
    assert w.lade()["fehler"] == "nicht_ladbar"
    assert w.p.wait(30) == 2
    assert json.loads(w.status.read_text())["fehler"] == ["nicht_ladbar"]


def test_instrument_abgelehnt(wirt):
    w = wirt(f"vst3:{VST3 / 'rb338.vst3'}#", "t2-rb338")
    w.warte_bereit()
    assert w.lade()["fehler"] == "kein_effekt"
    assert w.p.wait(30) == 2, "must exit, not loop"
    assert json.loads(w.status.read_text())["fehler"] == ["kein_effekt"]


def test_puls_lebt(wirt):
    w = wirt(EQ, "t2-puls")
    w.warte_bereit()
    puls = Path(str(w.status) + ".puls")
    a = int(puls.read_text())
    time.sleep(0.5)
    assert int(puls.read_text()) - a >= 10


def test_stiller_client_haelt_den_puls_nicht_an(wirt):
    import socket
    w = wirt(EQ, "t2-stumm")
    w.warte_bereit()
    puls = Path(str(w.status) + ".puls")
    stumm = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    stumm.connect(w.sock)
    try:
        vorher = int(puls.read_text())
        time.sleep(1.0)
        assert int(puls.read_text()) - vorher >= 40
    finally:
        stumm.close()


def test_lade_markiert_laedt_im_status(wirt):
    import threading
    w = wirt(EQ, "t2-laedt")
    w.warte_bereit()
    r = []
    t = threading.Thread(target=lambda: r.append(w.lade()))
    t.start()
    gesehen = set()
    while t.is_alive():
        try:
            s = json.loads(w.status.read_text())
            gesehen.add(s["effekt"])
            if s["effekt"] == "laedt":
                assert s["laedt_seit"] > 0
        except (ValueError, OSError):
            pass
        time.sleep(0.005)
    t.join()
    assert r[0]["ok"] and json.loads(w.status.read_text())["effekt"] == "geladen" and "laedt_seit" not in json.loads(w.status.read_text())


def test_zustand_rundweg_echt_und_fremdes_label(wirt, tmp_path):
    w = wirt(EQ, "t2-zustand")
    w.warte_bereit()
    assert w.lade()["ok"]
    z = str(tmp_path / "z.carxs")
    assert sende(w.sock, {"befehl": "zustand_holen", "pfad": z})["ok"]
    assert sende(w.sock, {"befehl": "aktiv", "an": False})["ok"]
    assert sende(w.sock, {"befehl": "zustand_setzen", "pfad": z}, timeout=30)["ok"]
    Path(z).write_text(Path(z).read_text().replace("<Label>Cypher EQ</Label>", "<Label>Other</Label>"))
    assert sende(w.sock, {"befehl": "zustand_setzen", "pfad": z})["fehler"] == "zustand_passt_nicht"


def test_schluessel_sidechain_kompressor_hat_vier_eingaenge(wirt):
    # plan strang 2 task 3.1: single-client mode exposes the key inputs 3 and 4 at JACK; the status names the ports
    w = wirt(LSP_SC, "t31-sc", "--schluessel")
    info = lade_und_info(w)
    assert info["ok"] and info["audio_ein"] == 4 and info["audio_aus"] == 2, info
    s = json.loads(w.status.read_text())
    assert s["effekt"] == "geladen", s
    ein, aus = s["ports"]["ein"], s["ports"]["aus"]
    assert len(ein) == 4 and len(aus) == 2, s["ports"]
    assert all(n.startswith("t31-sc:") for n in ein + aus), s["ports"]
    assert "Sidechain" in ein[2] and "Sidechain" in ein[3], ein  # plugin order: main pair first, key pair second


def test_schluessel_ohne_schluesseleingang_abgelehnt(wirt):
    w = wirt(LSP_KOMP, "t31-komp", "--schluessel")
    w.warte_bereit()
    assert w.lade()["fehler"] == "kein_schluessel"
    assert w.p.wait(30) == 2
    assert json.loads(w.status.read_text())["fehler"] == ["kein_schluessel"]


LSP_VST3 = Path("/usr/lib/vst3/lsp-plugins.vst3")
DISCOVERY = Path("/usr/lib/carla/carla-discovery-native")
KLASSE = 5


@pytest.mark.skipif(not LSP_VST3.exists() or not DISCOVERY.exists(), reason="LSP VST3 bundle or carla-discovery-native missing")
def test_klasse_nicht_erste_ueber_shim(tmp_path, monkeypatch):
    """Plan 4.2: class 5 of the LSP VST3 bundle (Carla alone would load class 0) reaches `geladen` through the shim."""
    import plugin_scan
    monkeypatch.setenv("DJK_CARLA_DISCOVERY", str(DISCOVERY))
    echt, ausgang = plugin_scan.entdecke("vst3", str(LSP_VST3))
    assert ausgang == "ok" and echt[KLASSE]["label"] != echt[0]["label"]
    ziel = tmp_path / "bau"
    baue = Path(__file__).resolve().parent.parent / "vst3_klasse" / "build.sh"
    assert subprocess.run(["bash", str(baue), str(ziel)], capture_output=True, timeout=120).returncode == 0
    spec = f"vst3:{LSP_VST3}#{echt[KLASSE]['label']}@{KLASSE}"
    w = Wirt(tmp_path, spec, "t42-klasse", "--shim", str(ziel / "klasse.so"), "--klassen-wurzel", str(tmp_path / "kl"))
    try:
        assert w.warte_bereit()["effekt"] == "leer"
        assert w.lade()["ok"]
        info = sende(w.sock, {"befehl": "info"})
        assert info["ok"] and info["name"] == echt[KLASSE]["name"].replace("/", "."), info  # Carla shows "A/B" as "A.B"
    finally:
        w.ende()
