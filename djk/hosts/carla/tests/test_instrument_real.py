"""Plan 1.11 task 16: the real host (Carla 2.5.8 under pw-jack) in --instrument mode with foreign plugin instruments. Starts
JACK clients in the live graph (own names ending in -e, unconnected except to the test's own pw-record node): only with
EFFEKT_ECHT=1. Every process started here is terminated at the end of its test."""
import json
import os
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np
import pytest

from host_control import sende

WIRT = Path(__file__).resolve().parent.parent / "instrument_host.py"
VST3 = Path.home() / ".local/lib/cypherdj/vst3"
VITAL = f"vst3:{Path.home() / '.vst3/Vital.vst3'}#"
RB338 = f"vst3:{VST3 / 'rb338.vst3'}#"
REASONABLE = "lv2:https://community.ardour.org/node/7596#"
EQ = f"vst3:{VST3 / 'Cypher EQ.vst3'}#"
pytestmark = pytest.mark.skipif(os.environ.get("EFFEKT_ECHT") != "1", reason="real run starts JACK clients: only with EFFEKT_ECHT=1")


class Wirt:
    def __init__(self, tmp_path, spec, name):
        self.name, self.status, self.sock = name, tmp_path / "w.json", str(tmp_path / "w.sock")
        self.p = subprocess.Popen(["pw-jack", sys.executable, str(WIRT), "--name", name, "--instrument", spec, "--sock", self.sock,
                                   "--status", str(self.status)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def warte_bereit(self):
        for _ in range(120):
            if self.status.exists() and json.loads(self.status.read_text()).get("bereit"):
                return json.loads(self.status.read_text())
            assert self.p.poll() is None, self.p.stdout.read().decode()
            time.sleep(0.25)
        raise AssertionError("host not ready")

    def spitze_db(self, befehl=None, sek=2.5):
        """Peak of audio-out1/2 over sek seconds, a command sent 0.8 s into it (recorded through the test's own pw-record node)."""
        knoten = f"t16-aufnahme-{os.getpid()}"
        wav = tempfile.mktemp(suffix=".wav")
        rec = subprocess.Popen(["pw-record", "-P", f"{{ node.name={knoten} node.autoconnect=false }}", "--rate", "48000", "--channels", "2", wav],
                               stderr=subprocess.DEVNULL)
        try:
            time.sleep(0.6)
            for k, p in (("out1", "FL"), ("out2", "FR")):
                subprocess.run(["pw-link", f"{self.name}:audio-{k}", f"{knoten}:input_{p}"], check=True)
            time.sleep(0.4)
            if befehl:
                assert sende(self.sock, befehl)["ok"]
            time.sleep(sek)
        finally:
            rec.terminate()
            rec.wait()
        with wave.open(wav) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
        os.unlink(wav)
        return float(20 * np.log10(max(abs(x).max(), 1e-9)))

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

    def start(spec, name):
        w = Wirt(tmp_path, spec, name)
        gestartet.append(w)
        return w

    yield start
    for w in gestartet:
        w.ende()


@pytest.mark.parametrize("spec,name,note", [(REASONABLE, "t16-reasonable-e", 60), (RB338, "t16-rb338-e", 36), (VITAL, "t16-vital-e", 60)])
def test_instrument_laedt_info_und_klingt(wirt, spec, name, note):
    w = wirt(spec, name)
    s = w.warte_bereit()
    assert s["art"] == "plugin" and s["kennung"] == spec and s["effekt"] == "geladen" and s["fehler"] == [], s
    info = sende(w.sock, {"befehl": "info"})
    assert info["ok"] and info["audio_aus"] >= 2, info
    assert len(info["parameter"]) > 0 or spec == REASONABLE, info  # the reasonable synth has no parameters
    assert w.spitze_db() < -80, "silent before the note"
    spitze = w.spitze_db({"befehl": "note", "note": note, "velocity": 110, "dauer": 1.5})
    print(f"PEAK {name} {spitze:.1f} dBFS")
    assert spitze > -40, f"peak {spitze:.1f} dBFS"
    assert sende(w.sock, {"befehl": "panik"})["gehalten"] == 128
    assert w.p.poll() is None


@pytest.mark.parametrize("spec,name", [(RB338, "t16-zst-rb-e"), (VITAL, "t16-zst-vi-e")])
def test_zustand_rundweg(wirt, tmp_path, spec, name):
    w = wirt(spec, name)
    w.warte_bereit()
    start = sende(w.sock, {"befehl": "params"})["werte"]
    z = str(tmp_path / "z.carxs")
    assert sende(w.sock, {"befehl": "zustand_holen", "pfad": z})["ok"]
    info = sende(w.sock, {"befehl": "info"})["parameter"]
    p = next(x for x in info if x["max"] - x["min"] > 0 and abs(start[str(x["index"])] - 0.5) > 0.2)  # one that can move
    ziel = 1.0 - round(start[str(p["index"])])
    assert sende(w.sock, {"befehl": "params_setzen", "werte": {str(p["index"]): ziel}})["ok"]
    assert sende(w.sock, {"befehl": "params"})["werte"][str(p["index"])] == pytest.approx(ziel, abs=0.02)
    assert sende(w.sock, {"befehl": "zustand_setzen", "pfad": z}, timeout=30)["ok"]
    assert sende(w.sock, {"befehl": "params"})["werte"][str(p["index"])] == pytest.approx(start[str(p["index"])], abs=0.02)


def test_effekt_wird_als_instrument_abgelehnt(wirt):
    w = wirt(EQ, "t16-eq-e")
    assert w.p.wait(60) == 2, "must exit 2, not loop"
    s = json.loads(w.status.read_text())
    assert s["fehler"] == ["kein_instrument"] and s["bereit"] is False, s


def test_unbekannte_uid_ist_nicht_ladbar(wirt):
    w = wirt(f"vst3:{VST3 / 'rb338.vst3'}#gibt-es-nicht", "t16-uid-e")
    assert w.p.wait(60) == 2
    assert json.loads(w.status.read_text())["fehler"] == ["nicht_ladbar"]
