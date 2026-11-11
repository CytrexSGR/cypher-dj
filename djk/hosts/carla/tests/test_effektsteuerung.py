"""Plan 1.11 task 2: EffektSteuerung (host mode --effekt) against a fake Carla host, no real engine."""
import json
import re
import socket
import time
from pathlib import Path

import pytest

from host_control import EffektSteuerung, Zeilenserver


class FakeEffekt:
    """Minimal Carla stand-in: one plugin slot, parameters with (min, max, def)."""

    def __init__(self, label="uid1", ranges=((0.0, 1.0, 0.5), (0.0, 1.0, 0.0), (-20.0, 20.0, 0.0), (0.0, 1.0, 1.0)), ins=2, load_ok=True,
                 name="Fake EQ"):
        self.label, self.ranges, self.ins, self.load_ok, self.name = label, list(ranges), ins, load_ok, name
        self.added, self.removed, self.active = [], 0, None
        self.werte = {}
        self.plugin = False
        self.uniqueId = 4711
        self.beim_laden = None
        self.hints = 0x008  # PLUGIN_HAS_CUSTOM_UI
        self.fenster = set()
        self.ui_aufrufe = []

    def show_custom_ui(self, pid, an):
        self.ui_aufrufe.append(an)
        (self.fenster.add if an else self.fenster.discard)(pid)

    def add_plugin(self, btype, ptype, filename, pname, label, uid, extra, options):
        self.added.append((ptype, filename, label))
        if self.beim_laden:
            self.beim_laden()
        if not self.load_ok:
            return False
        self.plugin = True
        self.werte = {i: r[2] for i, r in enumerate(self.ranges)}
        return True

    def engine_idle(self):
        time.sleep(0.02)

    def remove_plugin(self, pid):
        self.removed += 1
        self.plugin = False
        return True

    def get_last_error(self):
        return "fake error"

    def set_active(self, pid, an):
        self.active = an

    def get_plugin_info(self, pid):
        return {"name": self.name, "maker": "Fake Maker", "label": self.label, "uniqueId": self.uniqueId, "hints": self.hints}

    def get_audio_port_count_info(self, pid):
        return {"ins": self.ins, "outs": 2}

    def get_parameter_count(self, pid):
        return len(self.ranges)

    def get_parameter_info(self, pid, i):
        return {"name": f"p{i}", "unit": "dB" if i == 2 else ""}

    def get_parameter_ranges(self, pid, i):
        lo, hi, d = self.ranges[i]
        return {"min": lo, "max": hi, "def": d}

    def set_parameter_value(self, pid, i, v):
        self.werte[i] = v

    def get_current_parameter_value(self, pid, i):
        return self.werte[i]

    def save_plugin_state(self, pid, pfad):
        Path(pfad).write_text(f"<CARLA-PRESET><Info><Type>VST3</Type><Name>{self.name}</Name><Label>{self.label}</Label>"
                              f"<UniqueID>{self.uniqueId}</UniqueID></Info><Data><Active>Yes</Active>{sorted(self.werte.items())}</Data></CARLA-PRESET>")
        return True

    def load_plugin_state(self, pid, pfad):
        self.geladen = Path(pfad).read_text()
        self.active = "<Active>Yes</Active>" in self.geladen  # Carla applies <Active> from the file
        return True


def steuerung(host=None, fmt="vst3", puls=None, latenz=69, melde=None, **kw):
    host = host or FakeEffekt(**kw)
    st = EffektSteuerung(host, fmt, "/x/Fake.vst3" if fmt == "vst3" else "urn:fake", "uid1" if fmt == "vst3" else "",
                         lambda: latenz, puls, melde)
    return host, st


def geladen(fmt="vst3", **kw):
    host, st = steuerung(fmt=fmt, **kw)
    assert st.bearbeite({"befehl": "lade"}, 0.0)["ok"]
    return host, st


def test_start_ist_leer_und_lade_laedt():
    host, st = steuerung()
    assert st.status == "leer" and host.added == []
    assert st.bearbeite({"befehl": "info"}, 0.0) == {"ok": False, "fehler": "leer"}
    r = st.bearbeite({"befehl": "lade"}, 0.0)
    assert r["ok"] and st.status == "geladen"
    assert host.added[0][1:] == ("/x/Fake.vst3", "uid1") and host.active is True


def test_info_liste():
    host, st = geladen()
    r = st.bearbeite({"befehl": "info"}, 0.0)
    assert r["ok"] and r["name"] == "Fake EQ" and r["hersteller"] == "Fake Maker"
    assert (r["audio_ein"], r["audio_aus"], r["latenz"]) == (2, 2, 69)
    assert len(r["parameter"]) == 4
    assert r["parameter"][2] == {"index": 2, "name": "p2", "min": -20.0, "max": 20.0, "vorgabe": 0.0, "einheit": "dB"}


def test_params_setzen_stapel():
    host, st = geladen()
    r = st.bearbeite({"befehl": "params_setzen", "werte": {"0": 0.1, "1": 0.2, "3": 0.9}}, 0.0)
    assert r["ok"]
    assert (host.werte[0], host.werte[1], host.werte[3]) == (0.1, 0.2, 0.9)
    w = st.bearbeite({"befehl": "params"}, 0.0)["werte"]
    assert w["0"] == pytest.approx(0.1) and w["3"] == pytest.approx(0.9)


def test_params_setzen_unbekannter_index():
    host, st = geladen()
    r = st.bearbeite({"befehl": "params_setzen", "werte": {"0": 0.9, "99": 0.5}}, 0.0)
    assert r["ok"] is False and r["fehler"] == "param_unbekannt"
    assert host.werte[0] == 0.5, "a rejected batch must change nothing"
    assert st.bearbeite({"befehl": "info"}, 0.0)["ok"], "host stays alive"
    assert st.ende is None


def test_params_setzen_leer_aendert_nichts():  # negative control
    host, st = geladen()
    vorher = dict(host.werte)
    assert st.bearbeite({"befehl": "params_setzen", "werte": {}}, 0.0) == {"ok": True}
    assert host.werte == vorher


def test_wert_ausserhalb():
    host, st = geladen()
    st.bearbeite({"befehl": "params_setzen", "werte": {"0": 1.5, "1": -0.5}}, 0.0)
    assert host.werte[0] == 1.0 and host.werte[1] == 0.0


def test_lv2_wert_wird_auf_bereich_abgebildet():
    host, st = geladen(fmt="lv2")
    st.bearbeite({"befehl": "params_setzen", "werte": {"2": 0.75}}, 0.0)
    assert host.werte[2] == pytest.approx(10.0)  # -20 + 0.75 * 40
    assert st.bearbeite({"befehl": "params"}, 0.0)["werte"]["2"] == pytest.approx(0.75)
    st.bearbeite({"befehl": "params_setzen", "werte": {"2": 1.5}}, 0.0)
    assert host.werte[2] == pytest.approx(20.0)


def test_vst3_wert_unveraendert():
    host, st = geladen(fmt="vst3")
    st.bearbeite({"befehl": "params_setzen", "werte": {"2": 0.75}}, 0.0)
    assert host.werte[2] == 0.75


def test_aktiv():
    host, st = geladen()
    assert st.bearbeite({"befehl": "aktiv", "an": False}, 0.0)["ok"]
    assert host.active is False
    st.bearbeite({"befehl": "aktiv", "an": True}, 0.0)
    assert host.active is True


def test_latenz():
    host, st = geladen()
    assert st.bearbeite({"befehl": "latenz"}, 0.0) == {"ok": True, "latenz": 69}


def test_zustand_rundweg(tmp_path):
    host, st = geladen()
    p = str(tmp_path / "z.carxs")
    assert st.bearbeite({"befehl": "zustand_holen", "pfad": p}, 0.0)["ok"]
    assert re.search("<Name>Fake EQ</Name>", Path(p).read_text())
    assert st.bearbeite({"befehl": "zustand_setzen", "pfad": p}, 0.0)["ok"]
    assert "Fake EQ" in host.geladen


def test_zustand_passt_nicht(tmp_path):
    host, st = geladen()
    p = tmp_path / "fremd.carxs"
    p.write_text("<CARLA-PRESET><Info><Name>Other Plugin</Name></Info></CARLA-PRESET>")
    r = st.bearbeite({"befehl": "zustand_setzen", "pfad": str(p)}, 0.0)
    assert r["ok"] is False and r["fehler"] == "zustand_passt_nicht"
    assert not hasattr(host, "geladen"), "nothing may be loaded"


def test_lade_nicht_ladbar_beendet_mit_grund():
    host, st = steuerung(load_ok=False)
    r = st.bearbeite({"befehl": "lade"}, 0.0)
    assert r["ok"] is False and r["fehler"] == "nicht_ladbar"
    assert st.ende == 2 and st.grund == "nicht_ladbar"


def test_lade_uid_passt_nicht_zur_geladenen_klasse():
    # Carla ignores an unknown VST3 label and loads the bundle's first class: the host must notice and refuse
    host, st = steuerung(label="other")
    r = st.bearbeite({"befehl": "lade"}, 0.0)
    assert r["ok"] is False and r["fehler"] == "nicht_ladbar"
    assert st.ende == 2 and host.removed == 1


def test_lade_kein_effekt_beendet_und_entfernt():
    host, st = steuerung(ins=0)
    r = st.bearbeite({"befehl": "lade"}, 0.0)
    assert r["ok"] is False and r["fehler"] == "kein_effekt"
    assert st.ende == 2 and host.removed == 1


def test_puls(tmp_path):
    puls = tmp_path / "s.puls"
    host, st = steuerung(puls=str(puls))
    st.takt(100.0)
    erster = int(puls.read_text())
    for ms in range(5, 105, 5):
        st.takt(100.0 + ms / 1000)
    assert int(puls.read_text()) - erster >= 3


def test_params_setzen_nan_abgewiesen():
    host, st = geladen()
    for schlecht in (float("nan"), float("inf")):
        r = st.bearbeite({"befehl": "params_setzen", "werte": {"0": 0.9, "1": schlecht}}, 0.0)
        assert r["ok"] is False and r["fehler"] == "wert_ungueltig"
    assert host.werte[0] == 0.5, "a rejected batch must change nothing"
    json.loads(json.dumps(st.bearbeite({"befehl": "params"}, 0.0), allow_nan=False))


def _zustand(tmp_path, **ersetze):
    host, st = geladen()
    p = tmp_path / "z.carxs"
    st.bearbeite({"befehl": "zustand_holen", "pfad": str(p)}, 0.0)
    text = p.read_text()
    for alt, neu in ersetze.items():
        assert alt in text
        text = text.replace(alt, neu)
    p.write_text(text)
    return host, st, p


@pytest.mark.parametrize("alt,neu", [("<Label>uid1</Label>", "<Label>andere</Label>"),
                                      ("<UniqueID>4711</UniqueID>", "<UniqueID>4712</UniqueID>")])
def test_zustand_passt_nicht_label_und_uniqueid(tmp_path, alt, neu):
    host, st, p = _zustand(tmp_path, **{alt: neu})
    r = st.bearbeite({"befehl": "zustand_setzen", "pfad": str(p)}, 0.0)
    assert r["ok"] is False and r["fehler"] == "zustand_passt_nicht"
    assert not hasattr(host, "geladen")


def test_zustand_lv2_uri_muss_passen(tmp_path):
    host, st = geladen(fmt="lv2")
    p = tmp_path / "z.carxs"
    p.write_text("<CARLA-PRESET><Info><Type>LV2</Type><Name>Fake EQ</Name><URI>urn:other</URI></Info></CARLA-PRESET>")
    assert st.bearbeite({"befehl": "zustand_setzen", "pfad": str(p)}, 0.0)["fehler"] == "zustand_passt_nicht"
    p.write_text("<CARLA-PRESET><Info><Type>LV2</Type><Name>Fake EQ</Name><URI>urn:fake</URI></Info></CARLA-PRESET>")
    assert st.bearbeite({"befehl": "zustand_setzen", "pfad": str(p)}, 0.0)["ok"]


def test_zustand_setzen_laesst_aktiv_unveraendert(tmp_path):
    host, st, p = _zustand(tmp_path)  # file says <Active>Yes</Active>
    st.bearbeite({"befehl": "aktiv", "an": False}, 0.0)
    assert st.bearbeite({"befehl": "zustand_setzen", "pfad": str(p)}, 0.0)["ok"]
    assert host.active is False, "the file's Active must not re-activate a bypassed plugin"
    st.bearbeite({"befehl": "aktiv", "an": True}, 0.0)
    assert st.bearbeite({"befehl": "zustand_setzen", "pfad": str(p)}, 0.0)["ok"] and host.active is True


def test_lade_meldet_laedt_vor_und_nach_dem_ladeaufruf():
    ereignisse = []
    host, st = steuerung(melde=lambda zustand, **kw: ereignisse.append((zustand, kw)))
    host.beim_laden = lambda: ereignisse.append(("im_ladeaufruf", st.status))
    st.bearbeite({"befehl": "lade"}, 0.0)
    assert [e[0] for e in ereignisse] == ["laedt", "im_ladeaufruf", "geladen"]
    assert ereignisse[0][1]["laedt_seit"] > 0 and ereignisse[1][1] == "laedt"


def test_lade_haelt_den_puls_im_latenzwarten(tmp_path):
    puls = tmp_path / "s.puls"
    host, st = steuerung(puls=str(puls), latenz=0)  # latency stays 0: the whole 0.3 s wait runs
    st.takt(time.monotonic())
    vorher = int(puls.read_text())
    st.bearbeite({"befehl": "lade"}, time.monotonic())
    assert int(puls.read_text()) - vorher >= 6  # fake engine_idle sleeps 20 ms too: one pulse per 40 ms loop


def _server(tmp_path, st):
    pfad = str(tmp_path / "s.sock")
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(pfad)
    srv.listen(4)
    srv.setblocking(False)
    return pfad, Zeilenserver(srv)


def _schleife(st, zs, dauer, fn=lambda z: {"ok": True}):
    ende = time.monotonic() + dauer
    while time.monotonic() < ende:
        st.takt(time.monotonic())
        zs.bediene(0.02, fn)


def test_stiller_client_haelt_den_puls_nicht_an(tmp_path):
    puls = tmp_path / "s.puls"
    host, st = geladen(puls=str(puls))
    pfad, zs = _server(tmp_path, st)
    st.takt(time.monotonic())
    vorher = int(puls.read_text())
    stumm = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    stumm.connect(pfad)
    halb = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    halb.connect(pfad)
    halb.sendall(b'{"befehl": "inf')  # aborts mid-line
    _schleife(st, zs, 1.0)
    assert int(puls.read_text()) - vorher >= 40
    stumm.close()
    halb.close()


def test_zeilenserver_antwortet_waehrend_ein_anderer_schweigt(tmp_path):
    host, st = geladen()
    pfad, zs = _server(tmp_path, st)
    stumm = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    stumm.connect(pfad)
    c = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    c.settimeout(2)
    c.connect(pfad)
    c.sendall(b'{"befehl": "latenz"}\n')
    _schleife(st, zs, 0.2, lambda z: st.bearbeite(json.loads(z), 0.0))
    assert json.loads(c.recv(4096)) == {"ok": True, "latenz": 69}
    stumm.close()
    c.close()


# ---------------------------------------------------------------- plan 1.11 task 15 (host side): command `fenster`

def test_fenster_ruft_show_custom_ui_einmal(monkeypatch):
    monkeypatch.setenv("DISPLAY", ":9")
    host, st = geladen()
    assert st.bearbeite({"befehl": "fenster", "an": True}, 0.0) == {"ok": True, "fenster": True}
    assert host.ui_aufrufe == [True] and host.fenster == {0}


def test_fenster_zweimal_an_bleibt_ein_fenster(monkeypatch):
    monkeypatch.setenv("DISPLAY", ":9")
    host, st = geladen()
    assert st.bearbeite({"befehl": "fenster", "an": True}, 0.0)["fenster"] is True
    assert st.bearbeite({"befehl": "fenster", "an": True}, 0.0)["fenster"] is True
    assert host.fenster == {0}
    assert st.bearbeite({"befehl": "fenster", "an": False}, 0.0) == {"ok": True, "fenster": False}
    assert host.fenster == set()


def test_fenster_ohne_oberflaeche_des_plugins(monkeypatch):
    monkeypatch.setenv("DISPLAY", ":9")
    host, st = geladen()
    host.hints = 0
    assert st.bearbeite({"befehl": "fenster", "an": True}, 0.0) == {"ok": True, "fenster": False, "grund": "kein_fenster"}
    assert host.ui_aufrufe == []


def test_fenster_ohne_display_laesst_den_wirt_leben(monkeypatch):
    monkeypatch.delenv("DISPLAY", raising=False)
    host, st = geladen()
    assert st.bearbeite({"befehl": "fenster", "an": True}, 0.0) == {"ok": True, "fenster": False, "grund": "keine_anzeige"}
    assert host.ui_aufrufe == [] and st.ende is None
    assert st.bearbeite({"befehl": "latenz"}, 0.0)["ok"]


def test_fenster_vor_lade_ist_leer(monkeypatch):
    monkeypatch.setenv("DISPLAY", ":9")
    host, st = steuerung()
    assert st.bearbeite({"befehl": "fenster", "an": True}, 0.0) == {"ok": False, "fehler": "leer"}


def test_fenster_an_muss_bool_sein(monkeypatch):
    monkeypatch.setenv("DISPLAY", ":9")
    host, st = geladen()
    assert not st.bearbeite({"befehl": "fenster", "an": "ja"}, 0.0)["ok"] and host.ui_aufrufe == []
