"""Step j3.plugin (Carla host stage plus plugin lane) against a fake hand: no instance, no Carla."""
import os
import sys
import wave
from types import SimpleNamespace

import pytest

AUS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AUS, ".."))
from tour import j3_plugin as P  # noqa: E402
from tour import runner as L  # noqa: E402

LSP = {"id": "p1", "format": "lv2", "pfad": "/usr/lib/lv2/lsp-plugins.lv2", "uid": "http://lsp-plug.in/plugins/lv2/limiter_stereo",
       "name": "Limiter", "art": "effekt", "status": "ok"}
PARAMETER = [{"index": 0, "name": "Input", "min": -72, "max": 12, "einheit": "dB", "wert": 0.5},
             {"index": 3, "name": "Threshold", "min": -60, "max": 0, "einheit": "dB", "wert": 1.0}]


def wav(pfad, amp):
    import numpy as np
    x = (np.sin(np.arange(24000) * 0.05) * amp * 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(np.repeat(x, 2).tobytes())


class PluginHand:
    """Tracks, inserts, lanes and exports of one project. Peak: 0.5 dry; 0.05 while a lane exists unless `lane_ignoriert`;
    the host answers `startet` for `startet_n` polls (always with 'haengt')."""

    def __init__(self, tmp, katalog=(LSP,), flags=(), startet_n=0):
        self.tmp, self.katalog, self.flags, self.startet_n = tmp, list(katalog), set(flags), startet_n
        self.aufrufe, self.spur, self.insert, self.lane, self.n, self.lage_n = [], None, None, None, 0, 0

    def rufe(self, name, a=None, timeout=120):
        a = a or {}
        self.aufrufe.append((name, a))
        if name == "plugins":
            if a["aktion"] == "liste":
                return {"plugins": self.katalog, "gesamt": len(self.katalog), "_fehler": False}
            return {"parameter": PARAMETER, "_fehler": False}
        if name == "proj_neu":
            return {"slug": "x", "_fehler": False}
        if name == "proj_aendern":
            for b in a["befehle"]:
                k = b["befehl"]
                if k == "spur_neu":
                    self.spur = "s1"
                elif k == "insert_setzen":
                    self.insert = "i1"
                elif k == "auto_neu":
                    self.lane = {"id": "a1", "ziel": b["ziel"], "punkte": b["punkte"]}
                elif k == "auto_loeschen":
                    self.lane = None if "lane_bleibt" not in self.flags else self.lane
            return {"rev": 1, "_fehler": False}
        if name == "proj_lage":
            sp = {"id": self.spur, "inserts": [{"id": self.insert, "art": "host", "an": True}] if self.insert else [],
                  "lanes": [{"id": self.lane["id"], "ziel": self.lane["ziel"], "punkte_zahl": 2}] if self.lane else []}
            hosts = []
            if self.insert:
                self.lage_n += 1
                bereit = self.lage_n > self.startet_n
                hosts = [{"insert_id": self.insert, "h": 1, "status": "bereit" if bereit else "startet", "latenz": 512,
                          **({} if bereit else {"grund": "haengt"})}]
            return {"projekt": {"tempo_bpm": 120, "spuren": [sp] if self.spur else []}, "hosts": hosts, "_fehler": False}
        if name == "proj_export":
            self.n += 1
            amp = 0.5
            if self.insert and self.lane and "lane_ignoriert" not in self.flags:
                amp = 0.05
            if "stumm" in self.flags:
                amp = 0.0
            pfad = self.tmp / f"e{self.n}.wav"
            wav(pfad, amp)
            return {"datei": str(pfad), "_fehler": False}
        raise AssertionError(name)


def lauf(tmp_path, monkeypatch, carla=True, **kw):
    monkeypatch.setattr(P, "_carla_da", lambda: carla)
    monkeypatch.setattr(P, "HOST_POLL_S", 0.01)
    hand = PluginHand(tmp_path, **kw)
    t = L.Tour("j3", SimpleNamespace(url="", kern_port=0, env={}, buchstabe="e"), tmp_path / "aus", kurz=True)
    t.fuehre(lambda tt: P.plugin(tt, hand, {"name": "tour-j3-000000", "slug": "tour-j3", "midi_spur": "s1", "audio_spur": "s2", "tempo": 120.0}))
    return t.bericht().schritte[0], hand


def test_gruen(tmp_path, monkeypatch):
    s, hand = lauf(tmp_path, monkeypatch, startet_n=2)
    assert s["urteil"] == "OK", (s["urteil"], s.get("grund"))
    assert s["werte"]["latenz"] == 512
    assert s["werte"]["senkung_db"] > 6 and s["werte"]["wieder_laut_db"] > 3
    ziel = next(a for n, a in hand.aufrufe if n == "proj_aendern" and a["befehle"][0]["befehl"] == "auto_neu")["befehle"][0]["ziel"]
    assert ziel == "plugin.i1.3"                      # the Threshold parameter, not index 0
    assert next(b for n, a in hand.aufrufe if n == "proj_aendern" for b in a["befehle"] if b["befehl"] == "insert_setzen")["plugin_id"] == "p1"


def test_ohne_lsp_skip(tmp_path, monkeypatch):
    s, hand = lauf(tmp_path, monkeypatch, katalog=())
    assert s["urteil"] == "SKIP" and s["werte"]["ursache"] == "abhaengigkeit"
    assert not any(n == "proj_neu" for n, _ in hand.aufrufe)


def test_ohne_carla_skip(tmp_path, monkeypatch):
    s, hand = lauf(tmp_path, monkeypatch, carla=False)
    assert s["urteil"] == "SKIP" and s["werte"]["ursache"] == "abhaengigkeit"
    assert hand.aufrufe == []


def test_host_bleibt_startet(tmp_path, monkeypatch):
    monkeypatch.setattr(P, "HOST_FRIST_S", 0.1)
    s, _ = lauf(tmp_path, monkeypatch, startet_n=10 ** 6)
    assert s["urteil"] == "FEHL" and s["grund"] == "host_nicht_bereit" and "haengt" in s["werte"]["text"], s


def test_lane_ignoriert(tmp_path, monkeypatch):
    s, _ = lauf(tmp_path, monkeypatch, flags=("lane_ignoriert",))
    assert s["urteil"] == "FEHL" and "lane_nicht_im_export" in s["grund"], s


def test_wert_haengt(tmp_path, monkeypatch):
    s, _ = lauf(tmp_path, monkeypatch, flags=("lane_bleibt",))
    assert s["urteil"] == "FEHL" and "wert_haengt" in s["grund"], s


def test_export_stumm(tmp_path, monkeypatch):
    s, _ = lauf(tmp_path, monkeypatch, flags=("stumm",))
    assert s["urteil"] == "FEHL" and "export_stumm" in s["grund"], s
