"""Soak collector (R3): pure parts only, no real instance."""
import os
import subprocess
import sys

import pytest

AUS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AUS, ".."))
sys.path.insert(0, os.path.join(AUS, "..", "..", "core", "tests", "restart"))
import dauerlauf as D  # noqa: E402
import osc  # noqa: E402

SCHLUESSEL = {"rss_kib", "fds", "luecken_frames_delta", "luecke_ereignisse", "luecke_frames", "cb_max_us",
              "cb_p99_us_max", "neustarts", "generation", "treiber_fehler", "treiber_aufrufe", "zustand_n",
              "treiber_endpunkte", "treiber_lebt", "pegel_master_db"}


def zustand(gen=1, luecken=0, cb_max=100, cb_p99=50):
    # order of Netz::zustand_senden: generation, quantum, sample, frame_luecken, ausgelassene_perioden, cb_max_us,
    # cb_p99_us, aufwach_max_us, stretcher_aktiv, befehle_wartend, ki_gestoppt, ereignisse_verloren
    return [gen, 256, 1000, luecken, 0, cb_max, cb_p99, 80, 0, 0, 0, 0]


def test_start_zeile_has_instance_slim_journal_and_no_master():
    z = D.start_zeile("h")
    assert z[0].endswith("djk-start")
    assert z[z.index("--instanz") + 1] == "h"
    assert z[z.index("--journal") + 1] == "schlank"
    for f in ("--strudel", "--instrumente", "--bk-stroeme"):
        assert f in z
    assert "--master" not in z and "--ton-frei" not in z


@pytest.mark.parametrize("buchstabe", ["", " ", "j", "hh", "H", "1", "-h"])
def test_refuses_empty_instance(buchstabe):
    with pytest.raises(ValueError):
        D.start_zeile(buchstabe)


def test_main_refuses_empty_instance_with_exit_code(tmp_path):
    r = subprocess.run([sys.executable, os.path.join(AUS, "..", "dauerlauf.py"), "lauf", "--instanz", "",
                        "--ausgabe", str(tmp_path / "x")], capture_output=True, text=True)
    assert r.returncode != 0
    assert not (tmp_path / "x" / "minuten.jsonl").exists()


def test_minute_sums_events_and_deltas():
    m = D.Minute()
    m.fuettere("/zustand/kern", zustand(luecken=5, cb_max=900, cb_p99=300))
    m.fuettere("/e/luecke", [48000, 64, 2])
    m.fuettere("/zustand/kern", zustand(luecken=7, cb_max=400, cb_p99=700))
    m.fuettere("/e/luecke", [96000, 16, 1])
    m.fuettere("/zustand/kern", zustand(luecken=9, cb_max=100, cb_p99=200))
    z = m.abschluss({"kern": 1}, {"kern": 2}, {"kern": 0})
    assert z["luecken_frames_delta"] == 4            # 9 - 5
    assert z["luecke_ereignisse"] == 2 and z["luecke_frames"] == 80
    assert z["cb_max_us"] == 900 and z["cb_p99_us_max"] == 700
    assert z["generation"] == 1 and z["zustand_n"] == 3
    assert SCHLUESSEL <= set(z) and "phase" not in z and "t_min" not in z


def test_next_minute_continues_from_the_last_value_so_no_gap_is_lost():
    m = D.Minute()
    m.fuettere("/zustand/kern", zustand(luecken=5))
    m.fuettere("/zustand/kern", zustand(luecken=9))
    m.abschluss({}, {}, {})
    n = m.fortsetzung()
    n.fuettere("/zustand/kern", zustand(luecken=12))
    assert n.abschluss({}, {}, {})["luecken_frames_delta"] == 3


def test_generation_reset_is_not_a_negative_delta():
    m = D.Minute()
    m.fuettere("/zustand/kern", zustand(gen=1, luecken=10))
    m.fuettere("/zustand/kern", zustand(gen=2, luecken=0))    # core restarted: counter starts at 0
    m.fuettere("/zustand/kern", zustand(gen=2, luecken=3))
    z = m.abschluss({}, {}, {})
    assert z["luecken_frames_delta"] == 3 and z["generation"] == 2


def test_counter_dropping_inside_one_generation_is_not_negative():
    m = D.Minute()
    m.fuettere("/zustand/kern", zustand(luecken=10))
    m.fuettere("/zustand/kern", zustand(luecken=2))
    assert m.abschluss({}, {}, {})["luecken_frames_delta"] >= 0


def test_minute_without_core_state_reports_zero_messages():
    z = D.Minute().abschluss({}, {}, {})
    assert z["zustand_n"] == 0 and z["luecke_ereignisse"] == 0


def test_driver_counts():
    m = D.Minute()
    m.treiber_zaehlen(True)
    m.treiber_zaehlen(True)
    m.treiber_zaehlen(False)
    z = m.abschluss({}, {}, {})
    assert z["treiber_aufrufe"] == 3 and z["treiber_fehler"] == 1


def test_driver_counts_per_endpoint_and_reports_thread_and_level():
    m = D.Minute()
    for _ in range(60):
        m.treiber_zaehlen(True, "regler")
    m.treiber_zaehlen(False, "deck_start")
    m.treiber_zaehlen(True, "deck_start")
    m.treiber_zaehlen(True)
    m.pegel_sehen(-30.0)
    m.pegel_sehen(-12.5)
    m.pegel_sehen(-40.0)
    z = m.abschluss({}, {}, {}, lebt=False)
    assert z["treiber_endpunkte"] == {"regler": [60, 0], "deck_start": [2, 1], "sonst": [1, 0]}
    assert z["treiber_lebt"] is False and z["pegel_master_db"] == -12.5


def test_minute_without_level_reading_reports_silence_not_a_number_that_passes():
    assert D.Minute().abschluss({}, {}, {})["pegel_master_db"] == D.PEGEL_NICHTS_DB < -100


def test_master_db_reads_the_loudest_master_channel():
    j = {"kanaele": {"master": {"max_db": -18.2}, "spur/1": {"max_db": -3.0}, "master/links": {"max_db": -20}}}
    assert D.master_db(j) == -18.2
    assert D.master_db({"kanaele": {"spur/1": {"max_db": -3}}}) is None
    assert D.master_db(None) is None and D.master_db({"kanaele": {"master": {"max_db": "x"}}}) is None


class _Faden:
    def __init__(self, lebt):
        self._l = lebt

    def is_alive(self):
        return self._l


def test_driver_worker_dying_from_an_exception_is_recorded_and_not_alive():
    import threading
    zaehlt = []
    t = D.Treiber("http://127.0.0.1:1", lambda ok, name="sonst": zaehlt.append((ok, name)), threading.Event())

    def kaputt():
        raise RuntimeError("boom")
    t._faden("knopf", kaputt).join(2)
    assert t.lebt() is False and "knopf" in t.tot and zaehlt == [(False, "knopf")]
    assert "boom" in t.letzter_fehler["knopf"]["ausnahme"]


def test_driver_with_all_threads_running_is_alive_and_a_finished_thread_is_not():
    import threading
    t = D.Treiber("http://127.0.0.1:1", lambda ok, name="sonst": None, threading.Event())
    assert t.lebt() is True
    t.faeden = [_Faden(True), _Faden(True)]
    assert t.lebt() is True
    t.faeden.append(_Faden(False))
    assert t.lebt() is False


def test_driver_is_alive_after_its_setup_thread_finished_normally(monkeypatch):
    """The setup thread ends by design once the workers run: that must not read as a dead driver."""
    import threading
    stop = threading.Event()
    monkeypatch.setattr(D, "http", lambda *a, **k: (200, {"ok": True}))
    t = D.Treiber("http://x", lambda ok, name="sonst": None, stop)
    monkeypatch.setattr(t, "aufbau", lambda: None)
    t.start()
    for _ in range(100):
        if t.aufbau_fertig and len(t.faeden) >= 3:
            break
        D.time.sleep(0.05)
    assert t.aufbau_fertig and t.lebt() is True
    assert {f.name for f in t.faeden} == {"treiber-knopf", "treiber-deck", "treiber-muster"}
    t.faeden[0].join(0.01)
    stop.set()
    t.warte_auf()
    assert t.tot == set()


def test_knob_runs_on_an_absolute_one_second_schedule(monkeypatch):
    import threading
    stop = threading.Event()
    zeiten = []
    t = D.Treiber("http://x", lambda ok, name="sonst": None, stop)
    t.t0 = D.time.monotonic()

    def falsch(url, methode, pfad, koerper=None, timeout=10):
        zeiten.append(D.time.monotonic() - t.t0)
        D.time.sleep(0.15)                        # a slow call must not stretch the rate
        if len(zeiten) >= 4:
            stop.set()
        return 200, {"ok": True}
    monkeypatch.setattr(D, "http", falsch)
    t._knopf()
    assert [round(x) for x in zeiten] == [0, 1, 2, 3]
    assert all(abs(x - round(x)) < 0.1 for x in zeiten)


def test_knob_posts_ab_jetzt_so_the_grid_does_not_slow_it(monkeypatch):
    import threading
    stop = threading.Event()
    gesehen = []
    t = D.Treiber("http://x", lambda ok, name="sonst": None, stop)
    t.t0 = D.time.monotonic()

    def falsch(url, methode, pfad, koerper=None, timeout=10):
        gesehen.append((pfad, koerper))
        stop.set()
        return 200, {"ok": True}
    monkeypatch.setattr(D, "http", falsch)
    t._knopf()
    assert gesehen[0][0] == "/regler" and gesehen[0][1]["ab"] == "jetzt" and gesehen[0][1]["pfad"] == "erz/1/eq/hoch"


def test_instrument_track_without_the_vst3_gives_a_reason_not_a_crash(tmp_path):
    import threading
    t = D.Treiber("http://x", lambda ok, name="sonst": None, threading.Event(), vst3=str(tmp_path / "gibtsnicht.vst3"))
    t.instrument_aufbauen()
    assert t.instrument["ok"] is False and "VST3 not found" in t.instrument["grund"]


def test_projects_of_the_instance_are_set_aside_not_deleted(tmp_path):
    wurzel = tmp_path / "shm"
    (wurzel / "cypherdj-h" / "projekte" / "live").mkdir(parents=True)
    (wurzel / "cypherdj-h" / "projekte" / "live" / "projekt.json").write_text("{}")
    ziel = tmp_path / "aus"
    ziel.mkdir()
    weg = D.projekte_beiseite("h", str(ziel), str(wurzel))
    assert weg and not (wurzel / "cypherdj-h" / "projekte").exists()
    assert (ziel / "projekte-vor-lauf" / "live" / "projekt.json").read_text() == "{}"
    assert D.projekte_beiseite("h", str(ziel), str(wurzel)) is None      # nothing left to set aside
    with pytest.raises(ValueError):
        D.projekte_beiseite("", str(ziel), str(wurzel))


def _zeile_mit(units):
    return {"phase": "last", "rss_kib": {u: 1 for u in units}}


def test_missing_instrument_host_is_reported_as_not_covered():
    import threading
    t = D.Treiber("http://x", lambda ok, name="sonst": None, threading.Event())
    t.instrument = {"versucht": True, "ok": False, "grund": "spur_neu refused"}
    fehlt = D.nicht_abgedeckt([_zeile_mit(["cypherdj-kern-h"])], t)
    assert len(fehlt) == 1 and "wirt-arr" in fehlt[0] and "spur_neu refused" in fehlt[0]
    assert D.nicht_abgedeckt([_zeile_mit(["cypherdj-kern-h", "cypherdj-wirt-arr1-h"])], t) == []


def test_stichprobe_drops_a_unit_without_a_usable_sample_and_logs_it(monkeypatch):
    monkeypatch.setattr(D, "pids_von", lambda p: [int(p["MainPID"])] if p.get("MainPID") else [])
    monkeypatch.setattr(D, "lies_rss_fds", lambda pids: (500, 7) if pids == [5] else None)
    zeigen = {"cypherdj-kern-h.service": {"MainPID": "5", "ActiveState": "active"},
              "cypherdj-server-h.service": {"MainPID": "6", "ActiveState": "active"}}
    rss, fds, neu, warn = {}, {}, {}, []
    D.stichprobe(list(zeigen), zeigen, D.NeustartZaehler(), rss, fds, neu, warn, 3)
    assert rss == {"cypherdj-kern-h": 500} and fds == {"cypherdj-kern-h": 7}     # server: no 0 in the row
    assert any("no usable memory sample of cypherdj-server-h" in w for w in warn)


def test_stichprobe_logs_an_empty_systemctl_show_and_counts_the_unit_as_gone(monkeypatch):
    monkeypatch.setattr(D, "pids_von", lambda p: [])
    rss, fds, neu, warn = {}, {}, {}, []
    z = D.NeustartZaehler()
    D.stichprobe(["cypherdj-kern-h.service"], {}, z, rss, fds, neu, warn, 4)
    assert rss == {} and any("systemctl show returned nothing" in w for w in warn)
    assert neu["cypherdj-kern-h"] == 1            # not active: counted as a transition (the safe direction)


def test_unknown_osc_address_is_ignored():
    m = D.Minute()
    m.fuettere("/uhr", [1, 2, 3])
    m.fuettere("/q", [1, 2, 3])
    m.fuettere("/zustand/kern", [1])          # too short to be a state message
    m.fuettere("/e/luecke", [])
    m.fuettere("/e/luecke", ["x", "y", "z"])
    z = m.abschluss({}, {}, {})
    assert z["zustand_n"] == 0 and z["luecke_ereignisse"] == 0 and z["luecken_frames_delta"] == 0


def test_osc_roundtrip_feeds_a_minute():
    # the collector reads real datagrams: build one the way the core does (h for sample, i for the rest)
    roh = osc.kodiere("/e/luecke", ",hii", 48000, 64, 2)
    adr, _, werte = osc.lies(roh)
    m = D.Minute()
    m.fuettere(adr, werte)
    assert m.abschluss({}, {}, {})["luecke_frames"] == 64


def _proc(tmp_path, pid, rss_kib, n_fds):
    d = tmp_path / str(pid)
    (d / "fd").mkdir(parents=True)
    for i in range(n_fds):
        (d / "fd" / str(i)).write_text("")
    (d / "status").write_text(f"Name:\tx\nVmPeak:\t999999 kB\nVmRSS:\t{rss_kib} kB\nThreads:\t3\n")


def test_lies_rss_fds_sums_pids_from_a_fake_proc(tmp_path):
    _proc(tmp_path, 10, 1000, 4)
    _proc(tmp_path, 11, 250, 3)
    assert D.lies_rss_fds([10, 11], str(tmp_path)) == (1250, 7)
    # a pid that vanished, no pid at all, or a status without VmRSS is no reading (None), never a 0 that looks like one
    assert D.lies_rss_fds([10, 99], str(tmp_path)) is None
    assert D.lies_rss_fds([], str(tmp_path)) is None
    (tmp_path / "12").mkdir()
    (tmp_path / "12" / "status").write_text("Name:\tkthread\n")
    assert D.lies_rss_fds([12], str(tmp_path)) is None


def test_parse_show():
    t = "Id=cypherdj-kern-h.service\nMainPID=5\nNRestarts=2\nActiveState=active\nControlGroup=/a/b\n\nId=x\nMainPID=0\n"
    p = D.parse_show(t)
    assert p["cypherdj-kern-h.service"]["NRestarts"] == "2" and p["x"]["MainPID"] == "0"


def test_restart_tracker_counts_new_activation_and_inactive():
    t = D.NeustartZaehler()
    a = {"NRestarts": "0", "ActiveState": "active", "ActiveEnterTimestampMonotonic": "100", "MainPID": "5"}
    assert t.sehe("u", a) == 0
    assert t.sehe("u", a) == 0
    assert t.sehe("u", dict(a, ActiveEnterTimestampMonotonic="900", MainPID="6")) == 1   # restarted without NRestarts
    assert t.sehe("u", dict(a, NRestarts="1", ActiveEnterTimestampMonotonic="900", MainPID="6")) == 2
    assert t.sehe("u", dict(a, NRestarts="1", ActiveState="failed", MainPID="0")) == 3                  # gone
    assert t.sehe("u", dict(a, NRestarts="1", ActiveState="failed", MainPID="0")) == 3                  # one transition, counted once


@pytest.mark.parametrize("code,j,ok", [
    (200, {"ok": True}, True),
    (200, {"ok": True, "quittung": {"status": 2, "grund": ""}}, True),
    (200, {"ok": True, "quittung": {"status": 5}}, True),
    (200, {"ok": True, "quittung": {"status": 6, "grund": "x"}}, False),
    (200, {"ok": False}, False),
    (409, {"fehler": "projekt_offen"}, False),
    (500, None, False),
    (0, None, False),
])
def test_antwort_ok(code, j, ok):
    assert D.antwort_ok(code, j) is ok


def test_ports_follow_the_instance_letter():
    assert D.seiten_port("h") == 55300 and D.kern_port("h") == 55100
    assert D.seiten_port("a") == 48300 and D.kern_port("a") == 48100
