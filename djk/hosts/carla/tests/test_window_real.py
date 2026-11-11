"""Plan 1.11 task 15 (host side): the real host (Carla 2.5.8 under pw-jack, --effekt) opens a foreign plugin's own window on
the user's X display. Needs DISPLAY (skipped without) and starts one JACK client (own name, unconnected). The window is
closed and the process terminated at the end of every test."""
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from host_control import sende

WIRT = Path(__file__).resolve().parent.parent / "instrument_host.py"
HALL = "lv2:https://github.com/michaelwillis/dragonfly-reverb#"
pytestmark = [pytest.mark.skipif(not os.environ.get("DISPLAY"), reason="needs an X display"),
              pytest.mark.skipif(shutil.which("xdotool") is None, reason="needs xdotool"),
              pytest.mark.skipif(not Path("/usr/lib/lv2/DragonflyHallReverb.lv2").is_dir(), reason="Dragonfly Hall not installed")]


def fenster_ids(name):
    r = subprocess.run(["xdotool", "search", "--name", name], capture_output=True, text=True)
    return r.stdout.split()


def warte_fenster(name, da=True, sek=10):
    for _ in range(int(sek / 0.1)):
        if bool(fenster_ids(name)) == da:
            return True
        time.sleep(0.1)
    return False


@pytest.fixture
def wirt(tmp_path):
    status, sock = tmp_path / "w.json", str(tmp_path / "w.sock")
    p = subprocess.Popen(["pw-jack", sys.executable, str(WIRT), "--name", "t15-fenster", "--effekt", HALL, "--sock", sock,
                          "--status", str(status)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for _ in range(80):
        if status.exists() and json.loads(status.read_text()).get("bereit"):
            break
        assert p.poll() is None, p.stdout.read().decode()
        time.sleep(0.25)
    assert sende(sock, {"befehl": "lade"}, timeout=60)["ok"]
    yield p, sock, Path(str(status) + ".puls")
    try:
        sende(sock, {"befehl": "fenster", "an": False})
    except Exception:
        pass
    if p.poll() is None:
        p.terminate()
    try:
        p.wait(10)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait()


def test_fenster_oeffnet_parameter_sichtbar_puls_haelt(wirt):
    p, sock, puls = wirt
    assert not fenster_ids("Dragonfly")
    assert sende(sock, {"befehl": "fenster", "an": True}) == {"ok": True, "fenster": True}
    assert warte_fenster("Dragonfly"), "no X window named like the plugin"
    # a parameter changed through the host is visible through params while the window is open
    info = sende(sock, {"befehl": "info"})
    par = next(x for x in info["parameter"] if x["max"] - x["min"] > 2)
    assert sende(sock, {"befehl": "params_setzen", "werte": {str(par["index"]): 0.25}})["ok"]
    assert sende(sock, {"befehl": "params"})["werte"][str(par["index"])] == pytest.approx(0.25, abs=0.01)
    # heartbeat pace while the window is open: counter sampled every 5 ms, max time between two increments < 100 ms
    letzte, t_letzte, luecke, ende = None, None, 0.0, time.monotonic() + 3.0
    while time.monotonic() < ende:
        z = int(puls.read_text() or 0) if puls.exists() else None
        t = time.monotonic()
        if z is not None and z != letzte:
            if t_letzte is not None:
                luecke = max(luecke, t - t_letzte)
            letzte, t_letzte = z, t
        time.sleep(0.005)
    assert luecke < 0.1, f"heartbeat gap {luecke:.3f} s while the window is open"
    # two requests stay one window
    vorher = len(fenster_ids("Dragonfly"))
    assert sende(sock, {"befehl": "fenster", "an": True})["fenster"] is True
    time.sleep(0.5)
    assert len(fenster_ids("Dragonfly")) == vorher
    assert sende(sock, {"befehl": "fenster", "an": False}) == {"ok": True, "fenster": False}
    assert warte_fenster("Dragonfly", da=False), "window did not close"
    assert p.poll() is None
    assert sende(sock, {"befehl": "latenz"})["ok"]


def test_fenster_schliessen_ueber_den_schliessknopf_laesst_den_wirt_laufen(wirt):
    p, sock, puls = wirt
    assert sende(sock, {"befehl": "fenster", "an": True})["fenster"]
    assert warte_fenster("Dragonfly")
    subprocess.run(["wmctrl", "-c", "Dragonfly"], check=False)   # the window manager's close request, like the close button
    time.sleep(2.0)
    assert p.poll() is None, "host died with the window"
    a = int(puls.read_text())
    time.sleep(0.3)
    assert int(puls.read_text()) > a
    assert sende(sock, {"befehl": "params"})["ok"]


def test_klick_im_fenster_kommt_als_parameter_im_wirt_an(wirt):
    """The window is serviced by engine_idle() of the main loop: a click on a preset name in the plugin's own window changes
    parameters in the host (UI -> host messages are only read from engine_idle; without it the window still maps but is dead)."""
    p, sock, puls = wirt
    assert sende(sock, {"befehl": "fenster", "an": True})["fenster"]
    assert warte_fenster("Dragonfly")
    time.sleep(1.5)  # the UI needs a moment before it takes input
    wid = fenster_ids("Dragonfly")[0]
    vorher = sende(sock, {"befehl": "params"})["werte"]
    loc = dict(kv.split("=") for kv in subprocess.run(["xdotool", "getmouselocation", "--shell"], capture_output=True, text=True).stdout.split())
    try:  # "Large Halls" in the 920x345 window; the pointer goes back afterwards
        subprocess.run(["xdotool", "mousemove", "--window", wid, "365", "99", "click", "1"], check=True)
        time.sleep(1.0)
    finally:
        subprocess.run(["xdotool", "mousemove", loc["X"], loc["Y"]])
    nachher = sende(sock, {"befehl": "params"})["werte"]
    geaendert = [k for k in vorher if abs(vorher[k] - nachher[k]) > 1e-6]
    assert len(geaendert) >= 5, f"the click in the plugin window changed {geaendert}: engine_idle not serviced?"
