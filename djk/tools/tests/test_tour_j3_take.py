"""Journey step j3.take against a fake hand and a fake page: takes by recording, audition, comp, export, undo. No real instance."""
import json
import os
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

AUS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AUS, ".."))
sys.path.insert(0, os.path.join(AUS, "..", "..", "core", "tests", "restart"))
from tour import j3_take as TAKE  # noqa: E402
from tour import runner as L  # noqa: E402

TEMPO = 120.0
BAR_S = 2.0


def bar_audio(art):
    """One bar (2 s, stereo) of 'kick' (60 Hz decaying bursts) or 'hats' (differenced white noise bursts)."""
    import numpy as np
    n = int(48000 * BAR_S)
    x = np.zeros(n)
    rng = np.random.default_rng(3)
    t = np.arange(int(48000 * 0.12)) / 48000
    if art == "kick":
        burst = np.sin(2 * np.pi * 60 * t) * np.exp(-t * 25)
        for k in range(4):
            a = int(k * n / 4)
            x[a:a + len(burst)] += 0.8 * burst
    else:
        burst = np.diff(rng.standard_normal(len(t) + 1)) * np.exp(-t * 60)
        burst = burst / np.abs(burst).max()
        for k in range(8):
            a = int(k * n / 8)
            x[a:a + len(burst)] += 0.3 * burst
    return x


def schreibe_wav(pfad, bars):
    import numpy as np
    x = np.concatenate([bar_audio(b) if b else np.zeros(int(48000 * BAR_S)) for b in bars])
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(np.repeat(pcm, 2).tobytes())


class TakeHand:
    """Models one audio track: main lane (what each of the two bars plays), take lanes, audition, comp, history. Flags break single features."""

    def __init__(self, tmp, flags=()):
        self.tmp, self.flags = Path(tmp), set(flags)
        self.aufrufe = []
        self.pattern = "silence"
        self.projekt = False
        self.bars = [None, None]            # source of each bar of the main lane: "kick", "hats" or None
        self.takes = []                     # [{id, name, art?, inhalt}]
        self.lauf = False
        self.vorhoeren = {}
        self.undo, self.redo = [], []
        self.zaehler = 0
        self.armiert = False
        self.exporte = 0

    def clips(self):
        if self.bars[0] is None:
            return []
        if self.bars[0] == self.bars[1] and not getattr(self, "geteilt", False):
            return [{"id": "c1", "art": "audio", "start_beat": 0, "laenge_beats": 8}]
        return [{"id": "c2", "art": "audio", "start_beat": 0, "laenge_beats": 4}, {"id": "c3", "art": "audio", "start_beat": 4, "laenge_beats": 4}]

    def aktuell(self):
        sp = {"id": "s1", "name": "Takes", "art": "audio", "clips": self.clips()}
        if self.takes:
            sp["takes"] = [dict(id=x["id"], name=x["name"], clips=[], **({"art": x["art"]} if x.get("art") else {})) for x in self.takes]
        return {"projekt": {"spuren": [sp], "tempo_bpm": TEMPO}}

    def merke(self):
        self.undo.append((list(self.bars), getattr(self, "geteilt", False)))
        self.redo = []

    def rufe(self, name, a=None, timeout=120, erwartet=None):
        a = a or {}
        self.aufrufe.append((name, a))
        if name == "proj_neu":
            self.projekt = True
            return {"slug": "x", "_fehler": False}
        if name == "proj_lage":
            sp = {"id": "s1", "name": "Takes", "art": "audio", "clips": self.clips()}
            if self.takes:
                sp["takes_zahl"] = len(self.takes)
            return {"projekt": {"tempo_bpm": TEMPO, "spuren": [sp]}, "vorhoeren": dict(self.vorhoeren), "_fehler": False}
        if name == "proj_aendern":
            for b in a.get("befehle", []):
                k = b["befehl"]
                if k == "spur_aendern" and "arm" in b:
                    self.armiert = b["arm"]
                elif k == "comp_waehlen" and "comp_ignoriert" not in self.flags:
                    take = next(x for x in self.takes if x["id"] == b["take_id"])
                    self.merke()
                    self.bars[0] = take["inhalt"]
                    self.geteilt = True
            return {"rev": 1, "_fehler": False}
        if name == "proj_aufnahme":
            if a["aktion"] == "start":
                if "abgebrochen" in self.flags:
                    return {"fehler": "aufnahme_abgebrochen", "grund": "zu_spaet", "_fehler": True}
                self.lauf = True
                return {"ok": True, "_fehler": False}
            self.lauf = False
            inhalt = "kick" if self.pattern == "kick" else "hats"
            if "ein_take" not in self.flags or not self.takes:
                self.zaehler += 1
                self.takes.append({"id": f"t{self.zaehler}", "name": f"Take {self.zaehler}", "inhalt": inhalt})
            self.bars, self.geteilt = [inhalt, inhalt], False
            return {"takes": [{"spur_id": "s1", "frames": 1, "datei": "x.wav"}], "_fehler": False}
        if name == "take_vorhoeren":
            if a["take_id"] is None:
                self.vorhoeren.pop(a["spur_id"], None)
            elif "vorhoeren_stumm" not in self.flags:
                self.vorhoeren[a["spur_id"]] = a["take_id"]
            return {"vorhoeren": dict(self.vorhoeren), "_fehler": False}
        if name == "proj_export":
            self.exporte += 1
            pfad = self.tmp / f"exp-{self.exporte}.wav"
            schreibe_wav(pfad, self.bars if "export_stumm" not in self.flags else [None, None])
            return {"datei": str(pfad), "_fehler": False}
        if name == "proj_undo":
            if self.undo and "undo_wirkt_nicht" not in self.flags:
                self.redo.append((list(self.bars), getattr(self, "geteilt", False)))
                self.bars, self.geteilt = self.undo.pop()
                self.bars = list(self.bars)
            return {"rev": 2, "_fehler": False}
        if name == "proj_redo":
            if self.redo:
                self.undo.append((list(self.bars), getattr(self, "geteilt", False)))
                self.bars, self.geteilt = self.redo.pop()
            return {"rev": 3, "_fehler": False}
        if name == "proj_transport":
            self.transport_stopp = a.get("aktion") == "stopp" or getattr(self, "transport_stopp", False)
            return {"ok": True, "_fehler": False}
        return {"fehler": "unbekannt", "_fehler": True}


class Seite:
    def __init__(self, hand):
        seite = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def antwort(self, code, obj):
                roh = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

            def do_GET(self):
                if self.path == "/proj/aktuell":
                    return self.antwort(200, hand.aktuell())
                self.antwort(404, {})

            def do_POST(self):
                d = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
                self.antwort(404, {})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def ende(self):
        self.server.shutdown()
        self.server.server_close()


class Instanz:
    def __init__(self, url):
        self.url, self.kern_port, self.env, self.buchstabe = url, 0, {}, "e"


class FakeQuelle(TAKE.Quelle):
    eingang = {"art": "intern", "name": "pad/1"}

    def __init__(self, hand):
        self.hand = hand

    def spiele(self, art):
        self.hand.pattern = art

    def still(self):
        self.hand.pattern = "silence"


def lauf(tmp_path, flags=(), quelle=True):
    hand = TakeHand(tmp_path, flags)
    seite = Seite(hand)
    TAKE.quelle_suchen = lambda t, h: FakeQuelle(hand) if quelle else None
    try:
        t = L.Tour("j3", Instanz(seite.url), tmp_path / "aus", kurz=True)
        t.fuehre(lambda tt: TAKE.take(tt, hand, {"name": "tour-j3-000000"}))
        return t.bericht().schritte[0], hand
    finally:
        seite.ende()


@pytest.fixture(autouse=True)
def schnell(monkeypatch):
    monkeypatch.setattr(TAKE, "quelle_suchen", TAKE.quelle_suchen)   # restored after each test (lauf() replaces it)
    monkeypatch.setattr(TAKE, "SCHLAF", lambda s: None)


def namen(hand):
    return [n for n, _ in hand.aufrufe]


def test_gruener_pfad(tmp_path):
    s, hand = lauf(tmp_path)
    assert s["urteil"] == "OK", (s["urteil"], s.get("grund"), s["werte"])
    w = s["werte"]
    assert w["takes_zahl"] == 2 and w["vorhoeren_ok"] is True and w["undo_ok"] is True
    assert all(v < 0 for v in w["rel_vor_db"])
    assert w["rel_nach_db"][0] - w["rel_nach_db"][1] >= 12
    assert namen(hand).count("proj_aufnahme") == 4
    assert hand.transport_stopp is True
    assert hand.pattern == "silence"


def test_ohne_quelle_skip_ohne_projekt(tmp_path):
    s, hand = lauf(tmp_path, quelle=False)
    assert s["urteil"] == "SKIP" and s["werte"]["ursache"] == "abhaengigkeit" and s["werte"]["sitzung"] == "J3"
    assert "proj_neu" not in namen(hand)


def test_comp_nicht_im_audio(tmp_path):
    s, _ = lauf(tmp_path, ["comp_ignoriert"])
    assert s["urteil"] == "FEHL" and s["grund"] == "comp_nicht_im_audio"


def test_undo_stellt_nicht_her(tmp_path):
    s, _ = lauf(tmp_path, ["undo_wirkt_nicht"])
    assert s["urteil"] == "FEHL" and s["grund"] == "undo_stellt_nicht_her"


def test_aufnahme_abgebrochen(tmp_path):
    s, hand = lauf(tmp_path, ["abgebrochen"])
    assert s["urteil"] == "FEHL" and s["grund"] == "aufnahme_abgebrochen" and s["werte"].get("abbruch_grund") == "zu_spaet"
    assert ("proj_transport", {"aktion": "stopp"}) in hand.aufrufe


def test_zu_wenig_takes(tmp_path):
    s, _ = lauf(tmp_path, ["ein_take"])
    assert s["urteil"] == "FEHL" and s["grund"] == "zu_wenig_takes"


def test_vorhoeren_nicht_gesetzt(tmp_path):
    s, _ = lauf(tmp_path, ["vorhoeren_stumm"])
    assert s["urteil"] == "FEHL" and s["grund"] == "vorhoeren_nicht_gesetzt"


def test_export_stumm(tmp_path):
    s, _ = lauf(tmp_path, ["export_stumm"])
    assert s["urteil"] == "FEHL" and s["grund"] == "export_stumm"
