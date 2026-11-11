"""Plan 1.11 task 16: InstrumentSteuerung (host mode --instrument) against a fake Carla host, no real engine."""
import time

import pytest

from test_effektsteuerung import FakeEffekt
from host_control import InstrumentSteuerung


class FakeInstrument(FakeEffekt):
    def __init__(self, midi_ein=1, ins=0, **kw):
        super().__init__(ins=ins, name=kw.pop("name", "Fake Synth"), **kw)
        self.midi_ein = midi_ein
        self.noten = []

    def get_midi_port_count_info(self, pid):
        return {"ins": self.midi_ein, "outs": 0}

    def send_midi_note(self, pid, kanal, note, velocity):
        self.noten.append((note, velocity))


def steuerung(fmt="vst3", latenz_fn=lambda: 0, **kw):
    host = FakeInstrument(**kw)
    return host, InstrumentSteuerung(host, fmt, "/x/Fake.vst3" if fmt == "vst3" else "urn:fake", "uid1" if fmt == "vst3" else "", latenz_fn)


def geladen(**kw):
    host, st = steuerung(**kw)
    assert st.bearbeite({"befehl": "lade"}, 0.0)["ok"]
    return host, st


def test_lade_ohne_audioeingang_und_ohne_latenzwarten():
    host, st = steuerung()
    t0 = time.monotonic()
    assert st.bearbeite({"befehl": "lade"}, 0.0) == {"ok": True}
    assert time.monotonic() - t0 < 0.25, "an instrument needs no latency wait (the effect path waits up to 0.3 s)"
    assert st.status == "geladen" and host.active is True


def test_ein_effekt_ohne_midi_eingang_ist_kein_instrument():
    host, st = steuerung(midi_ein=0, ins=2)
    r = st.bearbeite({"befehl": "lade"}, 0.0)
    assert r["ok"] is False and r["fehler"] == "kein_instrument", r
    assert st.ende == 2 and st.grund == "kein_instrument" and host.removed == 1 and st.status == "leer"


def test_nicht_ladbar_beendet_mit_grund():
    host, st = steuerung(load_ok=False)
    r = st.bearbeite({"befehl": "lade"}, 0.0)
    assert r["fehler"] == "nicht_ladbar" and st.ende == 2


def test_info_listet_parameter():
    host, st = geladen()
    r = st.bearbeite({"befehl": "info"}, 0.0)
    assert r["ok"] and r["name"] == "Fake Synth" and [p["name"] for p in r["parameter"]] == ["p0", "p1", "p2", "p3"]
    assert r["audio_ein"] == 0 and r["audio_aus"] == 2


def test_params_und_params_setzen():
    host, st = geladen()
    assert st.bearbeite({"befehl": "params_setzen", "werte": {"1": 0.75}}, 0.0)["ok"]
    assert st.bearbeite({"befehl": "params"}, 0.0)["werte"]["1"] == 0.75


def test_befehle_vor_lade_sind_leer():
    host, st = steuerung()
    for b in ({"befehl": "note", "note": 60}, {"befehl": "halte"}, {"befehl": "panik"}, {"befehl": "info"}):
        assert st.bearbeite(b, 0.0) == {"ok": False, "fehler": "leer"}, b


def test_note_schickt_an_und_nach_der_dauer_aus():
    host, st = geladen()
    assert st.bearbeite({"befehl": "note", "note": 60, "velocity": 90, "dauer": 0.5}, 10.0) == {"ok": True}
    assert host.noten == [(60, 90)]
    st.takt(10.2)
    assert host.noten == [(60, 90)]
    st.takt(10.6)
    assert host.noten == [(60, 90), (60, 0)]


@pytest.mark.parametrize("b", [{"note": 128}, {"note": -1}, {"note": 60, "velocity": 0}, {"note": 60, "velocity": 128},
                               {"note": 60, "dauer": 0}, {"note": 60, "dauer": 31}, {}])
def test_note_ausserhalb_wird_abgelehnt(b):
    host, st = geladen()
    assert st.bearbeite({"befehl": "note", **b}, 0.0)["ok"] is False and host.noten == []


def test_halte_meldet_null_und_beendet_keine_note():
    host, st = geladen()
    st.bearbeite({"befehl": "note", "note": 60, "dauer": 1}, 0.0)
    assert st.bearbeite({"befehl": "halte"}, 0.0) == {"ok": True, "gehalten": 0}
    assert len(st.offen) == 1


def test_panik_note_aus_fuer_alle():
    host, st = geladen()
    st.bearbeite({"befehl": "note", "note": 60, "dauer": 5}, 0.0)
    host.noten.clear()
    assert st.bearbeite({"befehl": "panik"}, 0.0) == {"ok": True, "gehalten": 128}
    assert host.noten == [(n, 0) for n in range(128)] and st.offen == []


def test_fenster_wie_beim_effekt(monkeypatch):
    monkeypatch.setenv("DISPLAY", ":9")
    host, st = geladen()
    assert st.bearbeite({"befehl": "fenster", "an": True}, 0.0) == {"ok": True, "fenster": True}
    host.hints = 0
    assert st.bearbeite({"befehl": "fenster", "an": True}, 0.0)["grund"] == "kein_fenster"


def test_zustand_rundweg(tmp_path):
    host, st = geladen()
    p = str(tmp_path / "z.carxs")
    assert st.bearbeite({"befehl": "zustand_holen", "pfad": p}, 0.0)["ok"]
    assert st.bearbeite({"befehl": "params_setzen", "werte": {"0": 0.1}}, 0.0)["ok"]
    assert st.bearbeite({"befehl": "zustand_setzen", "pfad": p}, 0.0) == {"ok": True}
    assert "Fake Synth" in host.geladen


def test_puls_schlaegt_auch_mit_offenen_noten(tmp_path):
    host = FakeInstrument()
    st = InstrumentSteuerung(host, "vst3", "/x/F.vst3", "uid1", lambda: 0, str(tmp_path / "p"))
    st.bearbeite({"befehl": "lade"}, 0.0)
    st.bearbeite({"befehl": "note", "note": 60, "dauer": 5}, 0.0)
    st.takt(1.0)
    st.takt(1.05)
    assert int((tmp_path / "p").read_text()) == 2


def test_unbekannter_befehl():
    host, st = geladen()
    assert st.bearbeite({"befehl": "fahre"}, 0.0)["ok"] is False
