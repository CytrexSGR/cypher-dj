import base64
from pathlib import Path

import klang
from wirtsteuerung import Steuerung

INIT = (Path(__file__).parent / "daten" / "surge-init.carxs").read_text()


class FakeHost:
    def __init__(self):
        self.geladen, self.noten, self.laden_ok = [], [], True

    def save_plugin_state(self, pid, pfad):
        Path(pfad).write_text(INIT)
        return True

    def load_plugin_state(self, pid, pfad):
        self.geladen.append(Path(pfad).read_text())
        return self.laden_ok

    def send_midi_note(self, pid, kanal, note, vel):
        self.noten.append((kanal, note, vel))

    def get_last_error(self):
        return "fake"


def fxp_mit_cutoff(tmp_path, wert):
    patch = klang.carxs_patch(INIT)
    xml = klang.setze(klang.xml_aus_patch(patch), {"a_filter1_cutoff": wert})
    p = tmp_path / f"k{wert}.fxp"
    p.write_bytes(klang.fxp_bauen(klang.patch_mit_xml(patch, xml), "Probe"))
    return p


def test_lade_gibt_carla_den_patch_und_schreibt_aktiv(tmp_path):
    h, aktiv = FakeHost(), tmp_path / "klang-bass.fxp"
    s = Steuerung(h, str(tmp_path), str(aktiv))
    p = fxp_mit_cutoff(tmp_path, "-30.0")
    assert s.bearbeite({"befehl": "lade", "pfad": str(p)}, 0.0) == {"ok": True, "name": "Probe"}
    assert 'a_filter1_cutoff type="2" value="-30.0"' in klang.xml_aus_patch(klang.carxs_patch(h.geladen[-1]))
    assert aktiv.read_bytes() == p.read_bytes()


def test_lade_fehler_laesst_aktiv_unberuehrt(tmp_path):
    h, aktiv = FakeHost(), tmp_path / "klang-bass.fxp"
    h.laden_ok = False
    aktiv.write_bytes(b"alt")
    s = Steuerung(h, str(tmp_path), str(aktiv))
    r = s.bearbeite({"befehl": "lade", "pfad": str(fxp_mit_cutoff(tmp_path, "-30.0"))}, 0.0)
    assert r["ok"] is False and "load_plugin_state" in r["fehler"]
    assert aktiv.read_bytes() == b"alt"
    assert s.bearbeite({"befehl": "lade", "pfad": str(tmp_path / "gibtsnicht.fxp")}, 0.0)["ok"] is False


def test_zustand_liefert_xml_und_patch(tmp_path):
    r = Steuerung(FakeHost(), str(tmp_path), None).bearbeite({"befehl": "zustand"}, 0.0)
    assert r["ok"] and r["xml"].startswith("<?xml")
    assert base64.b64decode(r["patch_b64"]) == klang.carxs_patch(INIT)


def test_note_an_und_zur_zeit_aus(tmp_path):
    h = FakeHost()
    s = Steuerung(h, str(tmp_path), None)
    assert s.bearbeite({"befehl": "note", "note": 36, "velocity": 100, "dauer": 0.5}, 10.0) == {"ok": True}
    s.takt(10.4)
    assert h.noten == [(0, 36, 100)]
    s.takt(10.5)
    assert h.noten == [(0, 36, 100), (0, 36, 0)]
    assert s.bearbeite({"befehl": "note", "note": 200}, 0.0)["ok"] is False


def test_unbekannter_befehl(tmp_path):
    r = Steuerung(FakeHost(), str(tmp_path), None).bearbeite({"befehl": "x"}, 0.0)
    assert r == {"ok": False, "fehler": "unbekannter Befehl 'x'"}


BEREICHE = {"a_filter1_cutoff": {"index": 25, "carla": "A Filter 1 Cutoff", "punkte": [-60.0, -27.5, 5.0, 37.5, 70.0]}}


class FahrHost(FakeHost):
    def __init__(self):
        super().__init__()
        self.parameter = []

    def set_parameter_value(self, pid, index, wert):
        self.parameter.append((index, round(wert, 6)))


def test_fahre_rampe_von_bis(tmp_path):
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": -60.0, "bis": 70.0, "dauer": 2.0}, 100.0) == {"ok": True}
    s.takt(100.0)
    s.takt(101.0)
    s.takt(102.0)
    assert h.parameter == [(25, 0.0), (25, 0.5), (25, 1.0)]
    s.takt(103.0)
    assert len(h.parameter) == 3  # Rampe ist fertig und weg


def test_fahre_startwert_aus_zustand_und_dauer_null(tmp_path):
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    # Init-Patch: a_filter1_cutoff = 3.0 → norm. (3 - -27.5) / 32.5 / 4 + 0.25
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 5.0, "dauer": 0}, 0.0) == {"ok": True}
    assert h.parameter == [(25, 0.5)]  # Dauer 0: sofort, ohne takt
    assert h.geladen == []  # kein load_plugin_state → kein Abriss


def test_fahre_unbekannt_und_ungueltig(tmp_path):
    s = Steuerung(FahrHost(), str(tmp_path), None, BEREICHE)
    r = s.bearbeite({"befehl": "fahre", "name": "a_filter1_type", "bis": 2, "dauer": 1}, 0.0)
    assert r["ok"] is False and "nicht fahrbar" in r["fehler"]
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 1, "dauer": -1}, 0.0)["ok"] is False


def test_fahre_am_ende_aktiv_klang_gesichert(tmp_path):
    h, aktiv = FahrHost(), tmp_path / "klang-bass.fxp"
    s = Steuerung(h, str(tmp_path), str(aktiv), BEREICHE)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": 0.0, "bis": 5.0, "dauer": 1.0}, 0.0)
    s.takt(0.5)
    assert not aktiv.exists()
    s.takt(1.0)
    assert not aktiv.exists()  # Surge übernimmt den Wert erst nach einigen Zyklen: nicht sofort sichern
    s.takt(1.31)
    assert klang.fxp_lesen(aktiv.read_bytes()) == klang.carxs_patch(INIT)  # FakeHost-Zustand = INIT


def test_fahre_mit_ab_wartet_und_liest_von_beim_start(tmp_path, capsys):
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 5.0, "dauer": 2.0, "ab": 110.0}, 100.0) == {"ok": True}
    s.takt(105.0)
    assert h.parameter == []  # vor ab: nichts
    s.takt(110.0)  # Start: von = Ist-Wert aus dem Zustand (Init-Patch 3.0)
    s.takt(112.0)
    assert h.parameter[0] == (25, round(klang.normiert(BEREICHE["a_filter1_cutoff"]["punkte"], 3.0), 6))
    assert h.parameter[-1] == (25, 0.5)
    assert "fahre start a_filter1_cutoff soll 110.000 ist 110.000" in capsys.readouterr().err


def test_fahre_folge_zweite_startet_am_istwert_der_ersten(tmp_path):
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": -60.0, "bis": 70.0, "dauer": 2.0, "ab": 100.0}, 99.0)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": -60.0, "dauer": 2.0, "ab": 104.0}, 99.0)
    for t in (100.0, 102.0, 103.0, 104.0, 106.0):
        s.takt(t)
    assert h.parameter == [(25, 0.0), (25, 1.0), (25, 1.0), (25, 0.0)]  # 103: keine Fahrt aktiv, nichts gesetzt


def test_fahre_frueheres_ab_verwirft_spaetere(tmp_path):
    s = Steuerung(FahrHost(), str(tmp_path), None, BEREICHE)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": 0.0, "bis": 5.0, "dauer": 1.0, "ab": 120.0}, 100.0)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": 0.0, "bis": 5.0, "dauer": 1.0, "ab": 110.0}, 100.0)
    assert [r["t0"] for r in s.rampen["a_filter1_cutoff"]] == [110.0]


def test_fahre_ab_ausserhalb_abgewiesen(tmp_path):
    s = Steuerung(FahrHost(), str(tmp_path), None, BEREICHE)
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 1, "dauer": 1, "ab": 98.0}, 100.0)["ok"] is False
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 1, "dauer": 1, "ab": 3800.0}, 100.0)["ok"] is False
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 1, "dauer": 1, "ab": "bald"}, 100.0)["ok"] is False
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 1, "dauer": 1, "ab": 99.5}, 100.0) == {"ok": True}


def test_lade_vergisst_istwert(tmp_path):
    # Plan-Review 29.09.: nach lade startet eine Fahrt ohne von am Wert des NEUEN Klangs, nicht am alten Ist-Wert
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": -60.0, "bis": -15.0, "dauer": 0}, 100.0)
    assert s.ist["a_filter1_cutoff"] == -15.0
    s.bearbeite({"befehl": "lade", "pfad": str(fxp_mit_cutoff(tmp_path, "-30.0"))}, 101.0)
    assert s.ist == {}


def test_takt_ueberlebt_kaputten_zustand(tmp_path, capsys):
    # istwert läuft in takt, außerhalb des try von bearbeite; wirt.py ruft takt ungeschützt (Plan-Review 29.09.)
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 5.0, "dauer": 1.0, "ab": 101.0}, 100.0)
    h.save_plugin_state = lambda pid, pfad: False
    s.takt(101.0)
    assert "a_filter1_cutoff" not in s.rampen and h.parameter == []
    assert "fahre verworfen a_filter1_cutoff" in capsys.readouterr().err


def test_halte_nur_die_eigene_spur(tmp_path):
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": 0.0, "bis": 5.0, "dauer": 10.0, "ab": 100.0, "spur": "a"}, 99.0)
    assert s.bearbeite({"befehl": "halte", "spur": "b"}, 99.0) == {"ok": True, "gehalten": 0}
    assert s.bearbeite({"befehl": "halte", "spur": "a"}, 99.0) == {"ok": True, "gehalten": 1}
    s.takt(101.0)
    assert h.parameter == []
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": 0.0, "bis": 5.0, "dauer": 10.0, "ab": 100.0}, 99.0)
    assert s.bearbeite({"befehl": "halte"}, 99.0) == {"ok": True, "gehalten": 1}  # ohne spur: alle


def test_final_review_f7_istwert_wird_auf_den_bereich_geklemmt(tmp_path):
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": -80.0, "dauer": 0}, 100.0)
    assert s.ist["a_filter1_cutoff"] == -60.0  # Bereich -60..70, nicht -80
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": -15.0, "dauer": 10}, 101.0)
    s.takt(101.0)
    s.takt(102.0)
    assert h.parameter[-1][1] > h.parameter[-2][1] >= 0.0 and h.parameter[-1][1] > 0.0  # Folgefahrt bewegt sich sofort
    # Negativ-Kontrolle: innerhalb des Bereichs bleibt der Wert, wie er ist; nach oben wird auch geklemmt
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 20.0, "dauer": 0}, 103.0)
    assert s.ist["a_filter1_cutoff"] == 20.0
    s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 99.0, "dauer": 0}, 104.0)
    assert s.ist["a_filter1_cutoff"] == 70.0


def test_final_review_f8_fahre_meldet_verworfene_wartende_fahrten(tmp_path):
    s = Steuerung(FahrHost(), str(tmp_path), None, BEREICHE)
    P = "a_filter1_cutoff"
    assert s.bearbeite({"befehl": "fahre", "name": P, "von": 0.0, "bis": 5.0, "dauer": 1.0, "ab": 110.0, "spur": "A"}, 100.0) == {"ok": True}
    assert s.bearbeite({"befehl": "fahre", "name": P, "von": 0.0, "bis": 5.0, "dauer": 1.0, "ab": 120.0, "spur": "A"}, 100.0) == {"ok": True}
    r = s.bearbeite({"befehl": "fahre", "name": P, "von": 0.0, "bis": 5.0, "dauer": 1.0, "ab": 105.0, "spur": "B"}, 100.0)
    assert r == {"ok": True, "ersetzt": 2}
    # Negativ-Kontrolle: eine spätere Fahrt verwirft nichts, Antwort unverändert
    assert s.bearbeite({"befehl": "fahre", "name": P, "von": 0.0, "bis": 5.0, "dauer": 1.0, "ab": 130.0}, 100.0) == {"ok": True}


def test_s7_fahre_form_s_wie_kern(tmp_path):
    h = FahrHost()
    s = Steuerung(h, str(tmp_path), None, BEREICHE)
    assert s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "von": -60.0, "bis": 70.0, "dauer": 4.0, "form": "s"}, 100.0) == {"ok": True}
    for t in (100.0, 101.0, 102.0, 104.0):
        s.takt(t)
    # 3u^2 - 2u^3: u=0.25 -> 0.15625, u=0.5 -> 0.5; der Bereich -60..70 bildet linear auf 0..1 (BEREICHE)
    assert [round(v, 5) for _, v in h.parameter] == [0.0, 0.15625, 0.5, 1.0]


def test_s7_fahre_form_unbekannt_abgewiesen(tmp_path):
    s = Steuerung(FahrHost(), str(tmp_path), None, BEREICHE)
    r = s.bearbeite({"befehl": "fahre", "name": "a_filter1_cutoff", "bis": 0.0, "dauer": 1.0, "form": "kurvig"}, 100.0)
    assert r["ok"] is False and "form" in r["fehler"]


def test_notensteuerung_spielt_noten_ohne_surge_zustand(tmp_path):
    from wirtsteuerung import NotenSteuerung

    class OhneZustand(FakeHost):
        def save_plugin_state(self, pid, pfad):
            raise AssertionError("SFZ-Wirt liest keinen Surge-Zustand")

    h = OhneZustand()
    s = NotenSteuerung(h)
    assert s.bearbeite({"befehl": "note", "note": 60, "velocity": 30, "dauer": 0.5}, 10.0) == {"ok": True}
    s.takt(10.5)
    assert h.noten == [(0, 60, 30), (0, 60, 0)]
    assert s.bearbeite({"befehl": "note", "note": 60, "velocity": 0}, 0.0)["ok"] is False
    assert s.bearbeite({"befehl": "halte"}, 0.0) == {"ok": True, "gehalten": 0}
    for art in ("lade", "zustand", "fahre"):
        r = s.bearbeite({"befehl": art, "pfad": "/x.fxp", "name": "a_filter1_cutoff", "bis": 1}, 0.0)
        assert r["ok"] is False and "sfz" in r["fehler"], r
