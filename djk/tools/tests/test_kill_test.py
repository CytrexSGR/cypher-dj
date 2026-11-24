"""Tests for djk/tools/kill_test.py: comparison logic, readiness waits and driver order, all with fake sources (no instance)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import kill_test as kt  # noqa: E402


# ---------------------------------------------------------------- unit names

def test_einheit_builds_suffixed_name_and_refuses_empty_instance():
    assert kt.einheit("g", "kern") == "cypherdj-kern-g"
    assert kt.einheit("g", "wirt-arr1") == "cypherdj-wirt-arr1-g"
    for leer in ("", None, "  "):
        with pytest.raises(ValueError):
            kt.einheit(leer, "kern")
    for schlecht in ("gg", "j", "G", "../a", "g-x"):   # only one letter a..i, never anything the live units could match
        with pytest.raises(ValueError):
            kt.einheit(schlecht, "kern")


# ---------------------------------------------------------------- comparison

def test_vergleiche_equal_documents_give_no_paths():
    d = {"a": 1, "b": [1, {"c": "x"}], "z": None}
    assert kt.vergleiche(d, {"z": None, "b": [1, {"c": "x"}], "a": 1}) == []


def test_vergleiche_reports_changed_added_and_removed_paths():
    ack = {"spuren": [{"id": "s1", "fader_db": -6.5, "clips": [{"id": "c1", "start_beat": 4}]}], "tempo_bpm": 120, "weg": 1}
    platte = {"spuren": [{"id": "s1", "fader_db": 0, "clips": [{"id": "c1", "start_beat": 4}, {"id": "c2"}]}], "tempo_bpm": 120, "neu": 2}
    assert kt.vergleiche(ack, platte) == ["neu", "spuren.0.clips.1", "spuren.0.fader_db", "weg"]


def test_vergleiche_does_not_confuse_bool_with_number_or_none_with_zero():
    assert kt.vergleiche({"m": False}, {"m": 0}) == ["m"]
    assert kt.vergleiche({"m": None}, {"m": 0}) == ["m"]
    assert kt.vergleiche({"m": 1}, {"m": 1.0}) == []


def test_vergleiche_list_shortened_names_the_lost_element():
    assert kt.vergleiche({"noten": [1, 2, 3]}, {"noten": [1, 2]}) == ["noten.2"]


def test_vergleiche_ignores_only_named_fields_at_any_depth():
    assert kt.vergleiche({"wiedergabe_rev": 3, "x": 1}, {"wiedergabe_rev": 9, "x": 1}, ignoriere=("wiedergabe_rev",)) == []
    assert kt.vergleiche({"wiedergabe_rev": 3, "x": 1}, {"wiedergabe_rev": 9, "x": 2}, ignoriere=("wiedergabe_rev",)) == ["x"]
    assert kt.vergleiche({"wiedergabe_rev": 3}, {"wiedergabe_rev": 9}) == ["wiedergabe_rev"]


# ---------------------------------------------------------------- generation wait

class Uhr:
    """Fake clock: sleeping advances it, nothing ever really sleeps."""
    def __init__(self):
        self.t = 0.0
        self.schlaefe = []

    def schlaf(self, s):
        self.t += s
        self.schlaefe.append(s)

    def jetzt(self):
        return self.t


def test_warte_neue_generation_returns_when_generation_grows():
    uhr = Uhr()
    werte = iter([7, 7, 8])
    assert kt.warte_neue_generation(lambda: next(werte), 7, 5.0, uhr.schlaf) == 8


def test_warte_neue_generation_does_not_return_on_same_generation_or_none():
    uhr = Uhr()
    werte = iter([None, None, 7, 7, None, 8])   # core still restarting: nothing, then the old value, then old + 1
    assert kt.warte_neue_generation(lambda: next(werte), 7, 60.0, uhr.schlaf) == 8
    assert len(uhr.schlaefe) == 5


def test_warte_neue_generation_times_out_with_none_and_never_hangs():
    uhr = Uhr()
    assert kt.warte_neue_generation(lambda: 7, 7, 3.0, uhr.schlaf) is None
    assert 3.0 <= uhr.t < 4.0 and len(uhr.schlaefe) < 100


def test_warte_neue_generation_survives_a_source_that_raises():
    uhr = Uhr()
    def quelle():
        raise OSError("down")
    assert kt.warte_neue_generation(quelle, 7, 1.0, uhr.schlaf) is None


# ---------------------------------------------------------------- plan

def test_kill_plan_order_and_units():
    namen = [k.einheit for k in kt.KILL_PLAN]
    assert namen == ["oberflaeche", "leitstand", "kern", "wirt-arr1"]
    assert [k.nach for k in kt.KILL_PLAN] == ["noten", "clip_verschoben", "knopf", "knopf_antwort"]
    assert len(set(namen)) == 4


# ---------------------------------------------------------------- driver with fakes

class Fake(kt.Umgebung):
    """Fake instance: records every call in order; units come back as the script says."""
    def __init__(self, uhr, verlust=None, kern_langsam=0.0, ack_fehlt=False, knopf_nach=None, aktuell_verlust=None):
        self.uhr = uhr
        self.log = []
        self.doc = {"rev": 0, "spuren": [], "noten": []}
        self.neustarts = {e: 0 for e in ("oberflaeche", "leitstand", "kern", "wirt-arr1", "notbahn")}
        self.generation = 10
        self.kern_tot_bis = None
        self.kern_langsam = kern_langsam
        self.verlust = verlust            # (nach_kill_der_einheit, pfad) removes a field from the stored document after that kill
        self.ack_fehlt = ack_fehlt
        self.platte_doc = None
        self.knoepfe = {}                 # core knob path -> acknowledged value
        self.aktuell_verlust = aktuell_verlust   # (nach_kill_der_einheit, pfad) removes a field from GET /proj/aktuell only (project.json stays whole)
        self.knopf_nach = knopf_nach      # None: refilled at once, "nie": never, float: seconds after the kill
        self.kill_zeit = None
        self.gerade_gekillt = None

    # time
    def schlaf(self, s):
        self.uhr.schlaf(s)

    def jetzt(self):
        return self.uhr.jetzt()

    # session
    def schritt(self, name):
        self.log.append(("schritt", name))
        if self.ack_fehlt:
            return kt.Ergebnis(projekt=None, knoepfe=None)
        self.doc = {**self.doc, "rev": self.doc["rev"] + 1, "letzter": name}
        if name in ("knopf", "knopf_antwort"):
            neu = {"spur/1/fader": -6.5} if name == "knopf" else {"spur/1/pan": -0.25}
            self.knoepfe.update(neu)
            return kt.Ergebnis(projekt=dict(self.doc), knoepfe=neu)
        return kt.Ergebnis(projekt=dict(self.doc), knoepfe=None)

    # units
    def restarts(self, einheit):
        return self.neustarts[einheit]

    def kill(self, einheit):
        self.log.append(("kill", einheit))
        self.neustarts[einheit] += 1
        self.kill_zeit = self.uhr.jetzt()
        self.gerade_gekillt = einheit
        if einheit == "kern":
            self.kern_tot_bis = self.uhr.jetzt() + 4.0 + self.kern_langsam
        return 4242

    def aktiv(self, einheit):
        return True

    def kern_generation(self):
        if self.kern_tot_bis is not None:
            if self.uhr.jetzt() < self.kern_tot_bis:
                return None if self.uhr.jetzt() < self.kern_tot_bis - 1 else self.generation   # restarting, then the old value
            self.generation += 1
            self.kern_tot_bis = None
            self.log.append(("generation_gesehen", self.generation))
        return self.generation

    def zustand_generation(self):
        return self.generation

    def seite_antwortet(self):
        return True

    def oeffnen(self):
        self.log.append(("oeffnen",))

    def platte(self):
        d = dict(self.doc)
        if self.verlust and self.gerade_gekillt == self.verlust[0]:
            d.pop(self.verlust[1], None)
        return d

    def aktuell(self):
        d = dict(self.doc)
        if self.aktuell_verlust and self.gerade_gekillt == self.aktuell_verlust[0]:
            d.pop(self.aktuell_verlust[1], None)
        return d

    def kern_knopf(self, pfad):
        if self.knopf_nach == "nie":
            return None
        if self.knopf_nach is not None and self.uhr.jetzt() - self.kill_zeit < self.knopf_nach:
            return None
        return self.knoepfe.get(pfad)


def test_next_kill_waits_for_core_ready_after_core_kill():
    uhr = Uhr()
    f = Fake(uhr, kern_langsam=6.0)
    code, bericht = kt.lauf(f)
    assert code == 0, bericht
    folge = [e for e in f.log if e[0] in ("kill", "generation_gesehen")]
    assert folge == [("kill", "oberflaeche"), ("kill", "leitstand"), ("kill", "kern"), ("generation_gesehen", 11), ("kill", "wirt-arr1")]
    kern = next(k for k in bericht["kills"] if k["einheit"] == "kern")
    assert kern["bereit_nach_s"] >= 10.0 and kern["restarts_vor"] == 0 and kern["restarts_nach"] == 1


def test_session_steps_run_in_order_and_each_kill_follows_its_ack():
    f = Fake(Uhr())
    kt.lauf(f)
    ereignisse = [e for e in f.log if e[0] in ("schritt", "kill")]
    i = ereignisse.index(("kill", "oberflaeche"))
    assert ereignisse[i - 1] == ("schritt", "noten")
    assert ereignisse[ereignisse.index(("kill", "leitstand")) - 1] == ("schritt", "clip_verschoben")
    assert ereignisse[ereignisse.index(("kill", "kern")) - 1] == ("schritt", "knopf")
    assert ereignisse[ereignisse.index(("kill", "wirt-arr1")) - 1] == ("schritt", "knopf_antwort")


def test_clean_run_passes_with_zero_lost_changes():
    code, bericht = kt.lauf(Fake(Uhr()))
    assert code == 0 and bericht["verloren"] is False
    assert [k["verloren"] for k in bericht["kills"]] == [False] * 4
    assert all(k["pfade_platte"] == [] and k["pfade_aktuell"] == [] for k in bericht["kills"])


def test_lost_change_on_disk_after_a_kill_fails_the_run_and_names_the_path():
    code, bericht = kt.lauf(Fake(Uhr(), verlust=("leitstand", "letzter")))
    assert code == 1 and bericht["verloren"] is True
    k = next(k for k in bericht["kills"] if k["einheit"] == "leitstand")
    assert k["verloren"] is True and k["pfade_platte"] == ["letzter"]


def test_unit_that_does_not_come_back_fails_the_run():
    class Tot(Fake):
        def seite_antwortet(self):
            return self.gerade_gekillt != "oberflaeche"
    code, bericht = kt.lauf(Tot(Uhr()))
    assert code == 1
    assert bericht["kills"][0]["bereit"] is False and "30" in bericht["kills"][0]["befund"][0]


def test_missing_acknowledgement_state_is_setup_error():
    f = Fake(Uhr(), ack_fehlt=True)
    code, bericht = kt.lauf(f)
    assert code == 2
    assert not [e for e in f.log if e[0] == "kill"]   # nothing is killed without a state to compare against


def test_knob_not_refilled_fails_the_run_and_the_result_line_says_what_was_lost():
    code, bericht = kt.lauf(Fake(Uhr(), knopf_nach="nie"))
    assert code == 1 and bericht["verloren"] is True
    kern = next(k for k in bericht["kills"] if k["einheit"] == "kern")
    assert kern["verloren"] is True
    f = kern["knopf"]["felder"][0]
    assert f["pfad"] == "spur/1/fader" and f["kern_sagt"] is None and f["erwartet"] == -6.5 and kern["knopf"]["gewartet_s"] >= 20
    assert any("knob" in b.lower() for b in kern["befund"])
    assert bericht["ausgang"].startswith("changes lost") and "spur/1/fader" in bericht["ausgang"] and "-6.5" in bericht["ausgang"]
    md = kt.bericht_md(bericht)
    assert "Result: **changes lost" in md and any(z.startswith("FINDING") and "knob" in z.lower() for z in md.splitlines())


def test_aktuell_difference_alone_fails_the_run():
    # project.json is whole, only the page's answer lost a field: the verdict must still see it
    code, bericht = kt.lauf(Fake(Uhr(), aktuell_verlust=("leitstand", "letzter")))
    assert code == 1
    k = next(k for k in bericht["kills"] if k["einheit"] == "leitstand")
    assert k["pfade_platte"] == [] and k["pfade_aktuell"] == ["letzter"] and k["verloren"] is True


def test_knob_refilled_late_is_recorded_with_the_seconds():
    # refilled 7 s after the kill; the core is ready after 4 s, so the poll waits about 3 s
    code, bericht = kt.lauf(Fake(Uhr(), knopf_nach=7.0))
    kern = next(k for k in bericht["kills"] if k["einheit"] == "kern")
    assert kern["knopf"]["ok"] and kern["knopf"]["felder"][0]["kern_sagt"] == -6.5 and 2.5 <= kern["knopf"]["gewartet_s"] < 4.0
    assert not [b for b in kern["befund"] if "knob" in b.lower()]


def test_report_files_are_written(tmp_path):
    code, bericht = kt.lauf(Fake(Uhr()))
    kt.schreibe_bericht(bericht, str(tmp_path))
    assert (tmp_path / "kill_bericht.json").exists()
    assert "oberflaeche" in (tmp_path / "kill_bericht.md").read_text()


# ---------------------------------------------------------------- zustand parser

def test_lies_zustand_parses_the_djk_start_state_lines():
    text = ("cypherdj-g:\n"
            "  cypherdj-kern-g            active    pid 2604385  restarts 0\n"
            "  cypherdj-wirt-arr1-g       active    pid 12  restarts 2\n"
            "  cypherdj-notbahn-g         inactive  pid 0  restarts 0\n"
            "  ports    kern udp 54100, leitstand ws 54200, page 54300\n")
    z = kt.lies_zustand(text)
    assert z["cypherdj-kern-g"] == (True, 2604385, 0)
    assert z["cypherdj-wirt-arr1-g"] == (True, 12, 2)
    assert z["cypherdj-notbahn-g"][0] is False
    assert kt.lies_ports(text) == {"kern": 54100, "leitstand": 54200, "seite": 54300}


def test_core_reporting_its_default_instead_of_the_acknowledged_value_fails():
    class Standard(Fake):
        def kern_knopf(self, pfad):
            return 0.0 if self.knoepfe else None   # the new core reports its default: the project knobs did not come back
    code, bericht = kt.lauf(Standard(Uhr()))
    kern = next(k for k in bericht["kills"] if k["einheit"] == "kern")
    assert code == 1 and kern["knopf"]["ok"] is False and kern["knopf"]["felder"][0]["kern_sagt"] == 0.0
    assert any("core says 0.0" in b for b in kern["befund"])


# ---------------------------------------------------------------- recording part (--aufnahme)

class FakeRec(Fake):
    """Fake instance with a recording: the page server kill falls into REC, the core keeps writing until the test stops it at the end."""
    def __init__(self, uhr, laufdatei_gefunden=True, laufdatei_entfernt=True, take_dauer_s=60.0, gelistet=True, endet_bei_kern=False, **kw):
        super().__init__(uhr, **kw)
        self.o = dict(laufdatei_gefunden=laufdatei_gefunden, laufdatei_entfernt=laufdatei_entfernt, take_dauer_s=take_dauer_s, gelistet=gelistet)
        self.endet_bei_kern = endet_bei_kern
        self.beendet = False

    def laufdatei_da(self):
        self.log.append(("laufdatei_da",))
        return self.o["laufdatei_gefunden"]

    def waise_messen(self, label):
        self.log.append(("waise_messen", label))
        waechst = not self.beendet and not (self.endet_bei_kern and self.neustarts["kern"] > 0)
        return {"label": label, "f32_bytes": 1000, "waechst": waechst, "status": "laeuft", "laufdatei_da": True, "gerettet_saetze": 0}

    def aufnahme_beenden(self):
        self.log.append(("aufnahme_beenden",))
        self.beendet = True

    def aufnahme_nach_oeffnen(self):
        self.log.append(("aufnahme_nach_oeffnen",))
        return {"laufdatei_entfernt": self.o["laufdatei_entfernt"], "take_dauer_s": self.o["take_dauer_s"],
                "als_wiederhergestellt_gelistet": self.o["gelistet"]}


def test_aufnahme_step_kills_page_server_during_rec():
    f = FakeRec(Uhr())
    code, bericht = kt.lauf(f, aufnahme=True)
    assert code == 0, bericht
    folge = [e for e in f.log if e[0] in ("schritt", "kill", "aufnahme_beenden", "oeffnen", "laufdatei_da", "aufnahme_nach_oeffnen")]
    i_rec = folge.index(("schritt", "aufnahme"))
    i_kill = folge.index(("kill", "oberflaeche"))
    assert folge.index(("schritt", "noten")) < i_rec < i_kill          # REC starts after the notes ack, the kill falls into it
    assert ("schritt", "clip_verschoben") not in folge[:i_kill]
    # the restarted page server meets a core that still writes: nothing stops the take before the reopen, nor during the other kills
    assert folge.index(("laufdatei_da",)) < folge.index(("oeffnen",), i_kill)
    assert folge.index(("aufnahme_beenden",)) > folge.index(("kill", "wirt-arr1"))   # only at the very end of the run
    assert folge.index(("oeffnen",), folge.index(("aufnahme_beenden",))) < folge.index(("aufnahme_nach_oeffnen",))
    a = bericht["aufnahme"]
    assert a["laufdatei_gefunden"] and a["laufdatei_entfernt"] and a["als_wiederhergestellt_gelistet"]
    assert a["take_dauer_s"] >= a["verstrichen_s"] > 0
    assert all(w["waechst"] for w in a["waise"]) and a["waise_beendet_durch"].startswith("nothing")   # reported, not papered over
    assert [k["einheit"] for k in bericht["kills"]] == ["oberflaeche", "leitstand", "kern", "wirt-arr1"]   # the four plain kills, same order


def test_report_names_what_ended_the_orphan_take():
    f = FakeRec(Uhr(), endet_bei_kern=True)
    code, bericht = kt.lauf(f, aufnahme=True)
    assert code == 0
    assert "core kill" in bericht["aufnahme"]["waise_beendet_durch"]
    assert "what ended the orphan take: after the core kill" in kt.bericht_md(bericht)


def test_aborted_run_does_not_leave_the_take_running():
    class Tot(FakeRec):
        def seite_antwortet(self):
            return self.gerade_gekillt != "leitstand"
    f = Tot(Uhr())
    code, bericht = kt.lauf(f, aufnahme=True)
    assert code == 1 and f.beendet


def test_report_fails_when_run_file_missing_after_rec_kill():
    f = FakeRec(Uhr(), laufdatei_gefunden=False)
    code, bericht = kt.lauf(f, aufnahme=True)
    assert code == 1
    assert bericht["aufnahme"]["laufdatei_gefunden"] is False
    assert any("run file" in b for b in bericht["befunde"])
    assert "recording" in bericht["ausgang"]


def test_report_fails_when_take_shorter_than_elapsed():
    f = FakeRec(Uhr(), take_dauer_s=1.0)
    code, bericht = kt.lauf(f, aufnahme=True)
    assert code == 1
    assert bericht["aufnahme"]["take_dauer_s"] < bericht["aufnahme"]["verstrichen_s"]
    assert any("shorter" in b for b in bericht["befunde"])
    # a take that is not listed as recovered and a run file that stays are failures as well
    for kw in ({"gelistet": False}, {"laufdatei_entfernt": False}):
        code, _ = kt.lauf(FakeRec(Uhr(), **kw), aufnahme=True)
        assert code == 1, kw


def test_plain_run_without_flag_has_no_recording_fields():
    f = FakeRec(Uhr())
    code, bericht = kt.lauf(f)
    assert code == 0
    assert "aufnahme" not in bericht
    assert ("schritt", "aufnahme") not in f.log
    assert not any(e[0] in ("aufnahme_beenden", "laufdatei_da", "aufnahme_nach_oeffnen", "waise_messen") for e in f.log)
    assert "Recording part" not in kt.bericht_md(bericht)
