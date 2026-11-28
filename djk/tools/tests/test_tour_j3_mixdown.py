"""J3 steps j3.zusammen and j3.resample (tour/j3_mixdown.py) against a small fake hand: tracks, inserts, history, merge, resample, export WAVs."""
import copy
import math
import os
import sys
import wave
from pathlib import Path

import pytest

AUS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AUS, ".."))
from tour import j3 as J3  # noqa: E402
from tour import j3_mixdown as M  # noqa: E402
from tour import runner as L  # noqa: E402

SR = 48000


class Instanz:
    url, kern_port, env, buchstabe = "http://127.0.0.1:1", 0, {}, "e"


def schreibe_wav(pfad, x):
    import numpy as np
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


class MixHand:
    """Models what the two steps read: tracks with pan, mute, MIDI notes, utility inserts; one history entry per change; merge and resample
    that render the current mix into an audio track. `flags` break single behaviours."""

    def __init__(self, tmp, flags=()):
        self.tmp, self.flags = Path(tmp), set(flags)
        self.aufrufe, self.spuren, self.verlauf, self.n, self.nid = [], [], [], 0, 0

    def namen(self):
        return [a[0] for a in self.aufrufe]

    def _neue_id(self):
        self.nid += 1
        return f"s{self.nid}"

    def _sichern(self):
        self.verlauf.append(copy.deepcopy((self.spuren, self.nid)))

    def _render_spur(self, s, n):
        import numpy as np
        x = np.zeros(n)
        if s["art"] == "audio":
            m = s["wav"]
            return None, m[:n] if len(m) >= n else np.pad(m, ((0, n - len(m)), (0, 0)))
        for c in s["clips"]:
            for no in c["noten"]:
                a = int(no["beat"] * 0.5 * SR)
                b = min(n, a + int(no["laenge"] * 0.5 * SR))
                f = 440.0 * 2 ** ((no["ton"] - 69) / 12)
                x[a:b] += 0.2 * np.sin(2 * np.pi * f * np.arange(b - a) / SR)
        for i in s["inserts"]:
            if i["art"] == "utility":
                x = x * 10 ** (i["werte"]["gain"] / 20)
        w = (s["pan"] + 1) * math.pi / 4
        return x, np.stack([x * math.cos(w), x * math.sin(w)], axis=1)

    def _mix(self, von, bis, nur=None):
        import numpy as np
        n = int((bis - von) * 0.5 * SR)
        aus = np.zeros((n, 2))
        for s in self.spuren:
            if s["mute"] or (nur is not None and s["id"] not in nur):
                continue
            aus += self._render_spur(s, n)[1]
        return aus

    def _neue_audio(self, name, wav, von):
        return {"id": self._neue_id(), "name": name, "art": "audio", "mute": False, "pan": 0.0, "clips": [], "inserts": [], "wav": wav}

    def _befehl(self, b):
        k = b["befehl"]
        if k == "spur_neu":
            self.spuren.append({"id": self._neue_id(), "name": b["name"], "art": "instrument", "mute": False, "pan": 0.0, "clips": [], "inserts": []})
        elif k == "spur_aendern":
            s = next(s for s in self.spuren if s["id"] == b["spur_id"])
            for f in ("pan", "mute"):
                if f in b:
                    s[f] = b[f]
        elif k == "clip_neu":
            next(s for s in self.spuren if s["id"] == b["spur_id"])["clips"].append({"noten": b["noten"]})
        elif k == "insert_setzen":
            s = next(s for s in self.spuren if s["id"] == b["strang_id"])
            self.nid += 1
            s["inserts"].append({"id": f"i{self.nid}", "art": b["art"], "an": True, "werte": b["werte"], "pos": b["pos"]})

    def rufe(self, name, a=None, timeout=120):
        a = a or {}
        self.aufrufe.append((name, a))
        if name == "proj_neu":
            self.spuren, self.verlauf = [], []
            return {"slug": "x", "_fehler": False}
        if name == "proj_aendern":
            self._sichern()
            for b in a["befehle"]:
                self._befehl(b)
            return {"rev": 1, "_fehler": False}
        if name == "proj_lage":
            return {"slug": "x", "_fehler": False, "projekt": {"tempo_bpm": 120, "spuren": [
                {"id": s["id"], "name": s["name"], "art": s["art"], "mute": s["mute"], "pan": s["pan"], "clips": [{"art": "midi"}] * len(s["clips"]),
                 "inserts": [{k: i[k] for k in ("id", "art", "an", "werte")} for i in s["inserts"]]} for s in self.spuren]}}
        if name == "proj_export":
            self.n += 1
            pfad = self.tmp / f"mix-{self.n}.wav"
            schreibe_wav(pfad, self._mix(a["von_beat"], a["bis_beat"]))
            return {"datei": str(pfad), "_fehler": False}
        if name == "proj_zusammenfuehren":
            self._sichern()
            quellen = [s for s in self.spuren if s["id"] in a["spur_ids"]]
            wav = self._mix(a["von_beat"], a["bis_beat"], nur=a["spur_ids"])
            wav = self._verbogen(wav)
            if "kein_track" not in self.flags:
                self.spuren.append(self._neue_audio("Merge", wav, a["von_beat"]))
            if "nicht_stumm" not in self.flags:
                for s in quellen:
                    s["mute"] = True
            return {"rev": 2, "spur_id": self.spuren[-1]["id"], "_fehler": False}
        if name == "proj_resample":
            self._sichern()
            s = next(s for s in self.spuren if s["id"] == a["strang_id"])
            wav = self._verbogen(self._mix(a["von_beat"], a["bis_beat"], nur=[s["id"]]))
            if "kein_track" not in self.flags:
                self.spuren.append(self._neue_audio("Strip (resampled)", wav, a["von_beat"]))
            return {"rev": 2, "spur_id": self.spuren[-1]["id"], "_fehler": False}
        if name == "proj_undo":
            if "undo_nichts" not in self.flags and self.verlauf:
                self.spuren, self.nid = self.verlauf.pop()
            return {"ok": True, "_fehler": False}
        if name == "proj_transport":
            return {"ok": True, "_fehler": False}
        return {"fehler": "unbekannt", "_fehler": True}

    def _verbogen(self, wav):
        import numpy as np
        if "pegel" in self.flags:
            wav = wav * 10 ** (2.0 / 20)
        if "versatz" in self.flags:
            wav = np.concatenate([np.zeros((40, 2)), wav[:-40]])
        return wav


def lauf(tmp_path, schritt, flags=(), hand_klasse=MixHand):
    hand = hand_klasse(tmp_path, flags)
    t = L.Tour("j3", Instanz(), tmp_path / "aus", kurz=True)
    z = {"name": "tour-j3-000000", "slug": "tour-j3", "tempo": 120.0}
    t.fuehre(lambda tt: schritt(tt, hand, z))
    return next(iter({s["kennung"]: s for s in t.bericht().schritte}.values())), hand


class TestZusammen:
    def test_green_values_and_undo(self, tmp_path):
        s, hand = lauf(tmp_path, M.zusammen)
        assert s["urteil"] == "OK", (s["urteil"], s.get("grund"), s["werte"])
        assert s["kennung"] == "j3.zusammen"
        assert abs(s["werte"]["rms_diff_db"]) <= 0.5 and abs(s["werte"]["versatz_samples"]) <= 1 and s["werte"]["undo_ok"] is True
        assert hand.namen().count("proj_zusammenfuehren") == 1 and hand.namen()[-1] == "proj_transport"

    def test_no_new_track_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.zusammen, ("kein_track",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "kein_neuer_track")

    def test_sources_left_unmuted_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.zusammen, ("nicht_stumm",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "kein_neuer_track")

    def test_level_off_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.zusammen, ("pegel",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "pegel_weicht_ab")

    def test_offset_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.zusammen, ("versatz",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "versatz")

    def test_undo_without_effect_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.zusammen, ("undo_nichts",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "undo_stellt_nicht_her")

    def test_refused_merge_is_red_with_the_tools_reason(self, tmp_path):
        class Verweigert(MixHand):
            def rufe(self, name, a=None, timeout=120):
                if name == "proj_zusammenfuehren":
                    self.aufrufe.append((name, a))
                    return {"fehler": "merge_leer", "text": "nothing sounds", "_fehler": True}
                return super().rufe(name, a, timeout)
        s, hand = lauf(tmp_path, M.zusammen, hand_klasse=Verweigert)
        assert (s["urteil"], s["grund"]) == ("FEHL", "merge_leer")
        assert hand.namen()[-1] == "proj_transport"


class TestResample:
    def test_green_values_and_undo(self, tmp_path):
        s, hand = lauf(tmp_path, M.resample)
        assert s["urteil"] == "OK", (s["urteil"], s.get("grund"), s["werte"])
        assert s["kennung"] == "j3.resample"
        assert abs(s["werte"]["rms_diff_db"]) <= 0.5 and s["werte"]["undo_ok"] is True
        assert hand.namen().count("proj_resample") == 1 and hand.namen()[-1] == "proj_transport"

    def test_no_new_track_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.resample, ("kein_track",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "kein_neuer_track")

    def test_level_off_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.resample, ("pegel",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "pegel_weicht_ab")

    def test_offset_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.resample, ("versatz",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "versatz")

    def test_undo_without_effect_is_red(self, tmp_path):
        s, _ = lauf(tmp_path, M.resample, ("undo_nichts",))
        assert (s["urteil"], s["grund"]) == ("FEHL", "undo_stellt_nicht_her")


class TestMessungen:
    def test_versatz_zwischen_finds_the_shift(self):
        import numpy as np
        rng = np.random.default_rng(1)
        a = rng.normal(size=(20000, 2)) * np.exp(-np.arange(20000) / 3000)[:, None]
        b = np.concatenate([np.zeros((7, 2)), a[:-7]])
        assert M.versatz_zwischen(a, a) == 0 and M.versatz_zwischen(a, b) == 7
