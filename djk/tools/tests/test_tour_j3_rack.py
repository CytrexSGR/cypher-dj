"""Tour step j3.rack against a fake hand: a model of the rack project and a small synthesis of the export (no real instance)."""
import os
import sys
import wave
from pathlib import Path

import pytest

AUS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AUS, ".."))
from tour import j3_rack  # noqa: E402
from tour import runner as L  # noqa: E402

SR = 48000


class Instanz:
    def __init__(self):
        self.url, self.kern_port, self.env, self.buchstabe = "http://127.0.0.1:1", 0, {}, "e"


def wav(pfad, x):
    import numpy as np
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def cutoff_hz(c):
    return 100.0 * 80.0 ** c


def render(spur, werte, flags):
    """Notes of the clip -> member by key zone; saw wave through a one-pole low-pass whose cutoff is the member's cutoff parameter.
    The macro moves the cutoff of g1 (and, when broken that way, of g2 too)."""
    import numpy as np
    n = int(j3_rack.RACK_BEATS * 0.5 * SR)
    aus = np.zeros(n)
    glieder = {m["id"]: m for m in spur["geraet"]["glieder"]}
    ziel = [z for m in (spur.get("rack") or {}).get("makros", []) for z in m["ziel"]]
    for clip in spur["clips"]:
        for no in clip["noten"]:
            m = next((g for g in glieder.values() if g["ton"][0] <= no["ton"] <= g["ton"][1]), None)
            if m is None or (m["id"] == "g2" and "glied2_stumm" in flags):
                continue
            c = m["geraet"]["parameter"].get("cutoff", 0.5)
            for zz in ziel:
                if "makro_ignoriert" in flags:
                    break
                if zz["glied"] == m["id"] or "makro_trifft_hoch" in flags:
                    c = zz["von"] + werte[0] * (zz["bis"] - zz["von"])
            a = int(no["beat"] * 0.5 * SR)
            k = int(no["laenge"] * 0.5 * SR)
            tt = np.arange(k) / SR
            f0 = 440.0 * 2 ** ((no["ton"] - 69) / 12)
            saw = 2 * ((tt * f0) % 1.0) - 1
            spec = np.fft.rfft(saw)
            fr = np.fft.rfftfreq(k, 1 / SR)
            saw = np.fft.irfft(spec / (1 + 1j * fr / cutoff_hz(c)), k)
            aus[a:a + k] += 0.3 * saw
    return np.stack([aus, aus], axis=1)


class RackHand:
    def __init__(self, tmp, flags=()):
        self.tmp = Path(tmp)
        self.flags = set(flags)
        self.aufrufe = []
        self.spur = None
        self.werte = [0.0, 0.0, 0.0, 0.0]
        self.verlauf = []
        self.n = 0

    def namen(self):
        return [n for n, _ in self.aufrufe]

    def rufe(self, name, argumente=None, timeout=120, erwartet=None):
        a = argumente or {}
        self.aufrufe.append((name, a))
        if name == "proj_neu":
            self.spur = None
            return {"slug": "rack", "_fehler": False}
        if name == "proj_aendern":
            for b in a["befehle"]:
                k = b["befehl"]
                if k == "spur_neu":
                    self.spur = {"id": "s1", "art": "instrument", "name": b["name"], "geraet": b["geraet"], "clips": []}
                elif k == "clip_neu":
                    self.spur["clips"].append({"id": "c1", "noten": b["noten"], "art": "midi"})
                elif k == "rack_setzen":
                    self.spur["rack"] = {"makros": [{"ziel": m["ziel"]} for m in b["makros"]], "werte": self.werte}
                elif k == "rack_makro":
                    self.werte[b["nr"] - 1] = b["wert"]
                elif k == "makro_variation_speichern":
                    self.spur["rack"].setdefault("variationen", {})[b["name"]] = list(self.werte)
                elif k == "makro_variation_laden":
                    if "variation_ohne_wirkung" not in self.flags:
                        self.verlauf.append(list(self.werte))
                        self.werte[:] = self.spur["rack"]["variationen"][b["name"]]
            return {"rev": 3, "_fehler": False}
        if name == "proj_undo":
            if self.verlauf:
                self.werte[:] = self.verlauf.pop()
            return {"rev": 4, "_fehler": False}
        if name == "proj_lage":
            sp = dict(self.spur) if self.spur else None
            if sp and "rack" in sp:
                sp["rack"] = {**sp["rack"], "werte": list(self.werte)}
            return {"projekt": {"tempo_bpm": 120, "spuren": [sp] if sp else []}, "_fehler": False}
        if name == "proj_export":
            self.n += 1
            pfad = self.tmp / f"rack-{self.n}.wav"
            wav(pfad, render(self.spur, self.werte, self.flags))
            return {"datei": str(pfad), "_fehler": False}
        return {"fehler": "unbekannt", "_fehler": True}


def lauf(tmp_path, flags=()):
    hand = RackHand(tmp_path, flags)
    t = L.Tour("j3", Instanz(), tmp_path / "aus", kurz=True)
    rc = t.fuehre(lambda tt: j3_rack.rack(tt, hand, {"name": "tour-j3-000000"}))
    s = next(iter({x["kennung"]: x for x in t.bericht().schritte}.values()))
    return s, hand, rc


def test_gruen(tmp_path):
    s, hand, rc = lauf(tmp_path)
    assert s["kennung"] == "j3.rack"
    assert s["urteil"] == "OK", (s["urteil"], s.get("grund"), s["werte"])
    w = s["werte"]
    assert w["oeffnung_db"] >= j3_rack.MIN_OEFFNUNG_DB and abs(w["hoch_diff_db"]) <= j3_rack.MAX_HOCH_ABWEICHUNG_DB
    assert w["variation_geladen"] == 1.0 and w["nach_undo"] == 0.0
    # the rack is built from two zoned RB-338 members with a macro on g1
    spur_neu = next(a for n, a in hand.aufrufe if n == "proj_aendern" and a["befehle"][0]["befehl"] == "spur_neu")
    g = spur_neu["befehle"][0]["geraet"]["glieder"]
    assert [m["ton"] for m in g] == [[0, 59], [60, 127]] and [m["id"] for m in g] == ["g1", "g2"]
    setzen = next(b for n, a in hand.aufrufe if n == "proj_aendern" for b in a["befehle"] if b["befehl"] == "rack_setzen")
    assert setzen["makros"][0]["ziel"][0]["glied"] == "g1"


@pytest.mark.parametrize("flag,grund", [
    ("makro_ignoriert", "makro_nicht_im_audio"),
    ("makro_trifft_hoch", "makro_trifft_anderes_glied"),
    ("glied2_stumm", "glied_stumm"),
    ("variation_ohne_wirkung", "variation_nicht_geladen"),
])
def test_fehlerfaelle(tmp_path, flag, grund):
    s, hand, rc = lauf(tmp_path, {flag})
    assert s["urteil"] == "FEHL"
    assert s["grund"] == grund, s
