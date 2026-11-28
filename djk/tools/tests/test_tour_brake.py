"""Rate limit (strand 9): the tour's hand client waits on `zu_schnell` and repeats the call; no real instance, no real sleep."""
import os
import sys

AUS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AUS, ".."))
from tour import runner as L  # noqa: E402

ZU_SCHNELL = {"_fehler": True, "fehler": "zu_schnell", "text": "too many agent writes; wait"}


class Instanz:
    url, kern_port, env, buchstabe, shm = "http://127.0.0.1:1", 0, {}, "b", "/nonexistent/cypherdj-b"


def _hand(antworten, tour=None):
    h = L.Hand.__new__(L.Hand)
    h.tour = tour
    h.aufrufe = []

    def _rufe(name, argumente, timeout):
        h.aufrufe.append(name)
        return dict(antworten.pop(0)) if len(antworten) > 1 else dict(antworten[0])
    h._rufe = _rufe
    return h


def test_zu_schnell_twice_then_ok_waits_and_records(monkeypatch, tmp_path):
    schlaf = []
    monkeypatch.setattr(L, "_schlaf", schlaf.append)
    t = L.Tour("jx", Instanz(), tmp_path / "aus", kurz=True)
    h = _hand([ZU_SCHNELL, ZU_SCHNELL, {"_fehler": False, "ok": True}], t)
    with t.schritt("b.eins", "export"):
        r = h.rufe("proj_export", {})
    assert r["ok"] is True and h.aufrufe == ["proj_export"] * 3
    assert schlaf == [21.0, 21.0]
    s = t.bericht().schritte[0]
    assert s["urteil"] == "OK" and s["werte"]["gewartet_s"] == 42.0 and s["werte"]["bremse_warten"] == ["proj_export 42s"]


def test_a_write_waits_2s_and_a_hint_wins(monkeypatch):
    schlaf = []
    monkeypatch.setattr(L, "_schlaf", schlaf.append)
    h = _hand([ZU_SCHNELL, {**ZU_SCHNELL, "wieder_in_ms": 500}, {"_fehler": False}])
    h.rufe("proj_aendern", {})
    assert schlaf == [2.0, 0.6]


def test_gives_up_after_120s_and_returns_the_refusal(monkeypatch):
    schlaf = []
    monkeypatch.setattr(L, "_schlaf", schlaf.append)
    h = _hand([ZU_SCHNELL])
    r = h.rufe("proj_export", {})
    assert r["fehler"] == "zu_schnell" and sum(schlaf) <= 120 and len(schlaf) == 5
