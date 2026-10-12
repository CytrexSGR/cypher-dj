"""RB-338 W1: der echte Wirt lädt das gebaute Bundle (Carla 2.5.8, VST3) und meldet bereit. Übersprungen, wenn das Bundle
fehlt (djk/instrumente/installiere.sh). Eigener JACK-Client, keine Verbindung zu anderen Ports."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

BUNDLE = Path.home() / ".local/lib/cypherdj/vst3/rb338.vst3"
WIRT = Path(__file__).resolve().parent.parent / "wirt.py"


ECHT = os.environ.get("RB338_ECHT") == "1"
pytestmark = pytest.mark.skipif(not ECHT, reason="Echtlauf startet JACK-Clients im lebenden Graphen: nur mit RB338_ECHT=1")


@pytest.mark.skipif(not BUNDLE.is_dir(), reason="rb338.vst3 nicht installiert")
def test_wirt_laedt_rb338(tmp_path):
    status = tmp_path / "wirt.json"
    p = subprocess.Popen(["pw-jack", sys.executable, str(WIRT), "--name", "rb338-test", "--vst3", str(BUNDLE),
                          "--status", str(status)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            if status.exists() and json.loads(status.read_text()).get("bereit"):
                break
            if p.poll() is not None:
                break
            time.sleep(0.25)
        s = json.loads(status.read_text())
        assert s["bereit"] is True, s
        assert s["plugin"] == "RB-338", s
        assert s["art"] == "vst3:rb338", s
        assert s["fehler"] == [], s
    finally:
        p.terminate()
        p.wait(10)


def test_wirt_fehlendes_bundle_ist_startfehler(tmp_path):
    status = tmp_path / "wirt.json"
    r = subprocess.run(["pw-jack", sys.executable, str(WIRT), "--name", "rb338-fehlt", "--vst3", str(tmp_path / "gibtsnicht.vst3"),
                        "--status", str(status)], timeout=30)
    assert r.returncode == 2
    assert "fehlt" in json.loads(status.read_text())["fehler"][0]


@pytest.mark.skipif(not BUNDLE.is_dir(), reason="rb338.vst3 nicht installiert")
def test_rb338_parameter_namen(tmp_path):
    sys.path.insert(0, "/usr/share/carla")
    from carla_backend import (BINARY_NATIVE, PLUGIN_VST3, CarlaHostDLL, ENGINE_OPTION_PROCESS_MODE,
                               ENGINE_PROCESS_MODE_CONTINUOUS_RACK, ENGINE_OPTION_OSC_ENABLED)
    host = CarlaHostDLL("/usr/lib/carla/libcarla_standalone2.so", False)
    host.set_engine_option(ENGINE_OPTION_PROCESS_MODE, ENGINE_PROCESS_MODE_CONTINUOUS_RACK, "")
    host.set_engine_option(ENGINE_OPTION_OSC_ENABLED, 0, "")
    assert host.engine_init("Dummy", "rb338-namen") or host.engine_init("JACK", "rb338-namen")
    try:
        assert host.add_plugin(BINARY_NATIVE, PLUGIN_VST3, str(BUNDLE), "", "", 0, None, 0)
        namen = {host.get_parameter_info(0, i)["name"] for i in range(host.get_parameter_count(0))}
        assert {"Volume", "Square", "Cutoff", "Resonance", "Env Mod", "Decay", "Accent"} <= namen, namen
    finally:
        host.engine_close()


@pytest.mark.skipif(not BUNDLE.is_dir(), reason="rb338.vst3 nicht installiert")
def test_wirt_param_und_params_am_socket(tmp_path):
    """RB-338 W1 4.1: params zeigt direkt nach dem Start die Vorgaben des Plugins (nicht 0,0), param ändert, Unbekanntes
    wird abgelehnt und ändert nichts."""
    sys.path.insert(0, str(WIRT.parent))
    from wirtsteuerung import sende
    status, sock = tmp_path / "wirt.json", f"/dev/shm/rb338-test-{os.getpid()}.sock"
    p = subprocess.Popen(["pw-jack", sys.executable, str(WIRT), "--name", "rb338-param", "--vst3", str(BUNDLE),
                          "--status", str(status), "--sock", sock], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            if status.exists() and json.loads(status.read_text()).get("bereit"):
                break
            time.sleep(0.25)
        start = sende(sock, {"befehl": "params"})["params"]
        assert start["Cutoff"] > 0.05 and start["Volume"] > 0.05, start  # Vorgaben, nicht 0,0
        assert abs(start["Resonance"] - 0.3) < 1e-3 and abs(start["Env Mod"] - 0.4) < 1e-3 and abs(start["Accent"] - 0.6) < 1e-3, start
        assert sende(sock, {"befehl": "param", "name": "Cutoff", "wert": 0.0}) == {"ok": True}
        tief = sende(sock, {"befehl": "params"})["params"]["Cutoff"]
        assert sende(sock, {"befehl": "param", "name": "Cutoff", "wert": 1.0}) == {"ok": True}
        hoch = sende(sock, {"befehl": "params"})["params"]["Cutoff"]
        assert tief < 0.01 and hoch > 0.99, (tief, hoch)
        vor = sende(sock, {"befehl": "params"})["params"]
        r = sende(sock, {"befehl": "param", "name": "Gibtsnicht", "wert": 0.5})
        assert r["ok"] is False and "Gibtsnicht" in r["fehler"], r
        assert sende(sock, {"befehl": "params"})["params"] == vor
    finally:
        p.terminate()
        p.wait(10)
