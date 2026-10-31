"""Baukasten S1: der echte Wirt lädt Cypher Modular (Carla, VST3) und meldet bereit; mit einem Graphen aus
CYPHERDJ_BAUKASTEN_GRAPH steht dessen Name im Log. Übersprungen ohne Bundle (djk/instrumente/installiere.sh baukasten).
Eigener JACK-Client, keine Verbindung zu anderen Ports. Nur mit BAUKASTEN_ECHT=1."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

BUNDLE = Path(os.environ.get("BAUKASTEN_BUNDLE") or Path.home() / ".local/lib/cypherdj/vst3/baukasten.vst3")
WIRT = Path(__file__).resolve().parent.parent / "wirt.py"
BEISPIEL = Path(__file__).resolve().parents[3] / "instrumente/baukasten_dsp/beispiele/saege-ladder.json"
PAD = BEISPIEL.with_name("juno-pad.json")

ECHT = os.environ.get("BAUKASTEN_ECHT") == "1"
pytestmark = [pytest.mark.skipif(not ECHT, reason="Echtlauf startet JACK-Clients im lebenden Graphen: nur mit BAUKASTEN_ECHT=1"),
              pytest.mark.skipif(not BUNDLE.is_dir(), reason="baukasten.vst3 nicht installiert")]


def _starte(tmp_path, name, graph=None, sock=None):
    status = tmp_path / "wirt.json"
    env = dict(os.environ)
    env.pop("CYPHERDJ_BAUKASTEN_GRAPH", None)
    if graph:
        env["CYPHERDJ_BAUKASTEN_GRAPH"] = str(graph)
    p = subprocess.Popen(["pw-jack", sys.executable, str(WIRT), "--name", name, "--vst3", str(BUNDLE), "--status", str(status),
                          *(["--sock", sock] if sock else [])],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, text=True)
    for _ in range(60):
        if status.exists() and json.loads(status.read_text()).get("bereit"):
            break
        if p.poll() is not None:
            break
        time.sleep(0.25)
    return p, json.loads(status.read_text())


def _ende(p):
    p.terminate()
    out, _ = p.communicate(timeout=10)
    return out


def test_wirt_laedt_cypher_modular_mit_eingebautem_graphen(tmp_path):
    p, s = _starte(tmp_path, "baukasten-test")
    out = _ende(p)
    assert s["bereit"] is True and s["plugin"] == "Cypher Modular" and s["art"] == "vst3:baukasten" and s["fehler"] == [], s
    assert "graph 'saege-ladder' with 8 voices" in out, out


def test_wirt_spielt_den_graphen_aus_der_variable(tmp_path):
    g = tmp_path / "eigen.json"
    g.write_text(BEISPIEL.read_text().replace('"name": "saege-ladder"', '"name": "eigen"').replace('"stimmen": 8', '"stimmen": 4'))
    p, s = _starte(tmp_path, "baukasten-eigen", g)
    out = _ende(p)
    assert s["bereit"] is True, s
    assert "graph 'eigen' with 4 voices" in out, out


def test_fehlerhafter_graph_spielt_eingebaut_und_meldet(tmp_path):
    g = tmp_path / "kaputt.json"
    g.write_text(BEISPIEL.read_text().replace('"ladder"', '"zauber"'))
    p, s = _starte(tmp_path, "baukasten-kaputt", g)
    out = _ende(p)
    assert s["bereit"] is True, s
    assert "graph rejected, playing built-in" in out and "zauber" in out, out
    assert "graph 'saege-ladder'" in out, out


def test_fehlende_graphdatei_ist_kein_fehler(tmp_path):
    p, s = _starte(tmp_path, "baukasten-fehlt", tmp_path / "kommt-spaeter.json")
    out = _ende(p)
    assert s["bereit"] is True and s["fehler"] == [], s
    assert "no graph file at" in out and "graph rejected" not in out, out


def test_knobs_sind_parameter_folgen_param_und_tragen_namen(tmp_path):
    """Baukasten S2: Knob 1..8 stehen in params (Vorgabe 0,5), param setzt einen Knob, die Namen aus regler_namen stehen im Log.
    Gegenprobe: ein Name, den das Plugin nicht hat, wird abgewiesen."""
    sys.path.insert(0, str(WIRT.parent))
    from wirtsteuerung import sende
    g = tmp_path / "pad.json"
    g.write_text(PAD.read_text())
    sock = f"/dev/shm/baukasten-knobs-{os.getpid()}.sock"
    p, s = _starte(tmp_path, "baukasten-knobs", g, sock=sock)
    try:
        assert s["bereit"] is True, s
        vorher = sende(sock, {"befehl": "params"})["params"]
        assert [n for n in vorher if n.startswith("Knob")] == [f"Knob {n}" for n in range(1, 9)], vorher
        assert all(abs(vorher[f"Knob {n}"] - 0.5) < 1e-6 for n in range(1, 9)), vorher
        assert sende(sock, {"befehl": "param", "name": "Knob 3", "wert": 0.2})["ok"] is True
        nachher = sende(sock, {"befehl": "params"})["params"]
        assert abs(nachher["Knob 3"] - 0.2) < 1e-6 and abs(nachher["Knob 4"] - 0.5) < 1e-6, nachher
        falsch = sende(sock, {"befehl": "param", "name": "Knob 9", "wert": 0.5})
        assert falsch["ok"] is False and "Knob 9" in falsch["fehler"], falsch
    finally:
        out = _ende(p)
    assert "graph 'juno-pad' with 8 voices" in out, out
    assert "Knob 1 = Cutoff" in out and "Knob 8 = Chorus" in out, out


def test_noten_ueber_den_socket_lassen_den_wirt_leben(tmp_path):
    """Noten erreichen process (Akkord, Klau, Off im selben Takt). Mit einem Bundle aus --features pruef_alloc
    (BAUKASTEN_BUNDLE) bricht nih-plug bei einer Allokation im Callback ab; dann wäre der Prozess tot."""
    sys.path.insert(0, str(WIRT.parent))
    from wirtsteuerung import sende
    sock = f"/dev/shm/baukasten-test-{os.getpid()}.sock"
    p, s = _starte(tmp_path, "baukasten-noten", sock=sock)
    try:
        assert s["bereit"] is True, s
        for n in range(40, 52):  # 12 Noten auf 8 Stimmen
            assert sende(sock, {"befehl": "note", "note": n, "velocity": 100, "dauer": 0.3})["ok"] is True
        time.sleep(1.5)  # Release läuft, Note-Offs aus dem takt() des Wirts
        assert p.poll() is None, "Wirt nach den Noten noch am Leben"
        assert sende(sock, {"befehl": "note", "note": 45, "velocity": 1, "dauer": 0.01})["ok"] is True
        time.sleep(0.5)
        assert p.poll() is None
    finally:
        out = _ende(p)
    assert "panicked" not in out and "allocation" not in out.lower(), out
