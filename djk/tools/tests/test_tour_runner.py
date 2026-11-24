"""Tour runner (journey tours, task 1): against a fake page server, a fake core and a fake MCP process; no real instance."""
import json
import math
import os
import socket
import struct
import subprocess
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

AUS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AUS, ".."))
sys.path.insert(0, os.path.join(AUS, "..", "..", "core", "tests", "restart"))
import osc  # noqa: E402
from tour import runner as L  # noqa: E402


class Seite:
    """Fake page server: /lage 200, /pegel with a settable master level, /nein answers 409 {fehler, text}."""

    def __init__(self):
        self.pegel_db = -200.0
        self.hinweise = []
        seite = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _senden(self, code, obj):
                roh = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(roh)))
                self.end_headers()
                self.wfile.write(roh)

            def do_GET(self):
                if self.path.startswith("/lage"):
                    return self._senden(200, {"ok": True})
                if self.path.startswith("/pegel"):
                    return self._senden(200, {"sek": 1, "kanaele": {"master": {"n": 20, "max_db": seite.pegel_db, "median_db": seite.pegel_db}}})
                if self.path.startswith("/nein"):
                    return self._senden(409, {"fehler": "x", "text": "y"})
                self._senden(404, {"fehler": "keine_route"})

            def do_POST(self):
                n = int(self.headers.get("content-length") or 0)
                roh = self.rfile.read(n)
                seite.hinweise.append((self.path, dict(self.headers), roh))
                if self.path.startswith("/nein"):
                    return self._senden(409, {"ok": False, "grund": "g", "fehler": "x", "text": "y"})
                if self.path.startswith("/boom"):
                    return self._senden(500, {"fehler": "kaputt"})
                self._senden(200, {"ok": True, "n": len(roh)})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def ende(self):
        self.server.shutdown()
        self.server.server_close()


class FakeKern:
    """Fake core: a subscriber that sends /k/hallo gets /zustand/kern every 40 ms; frame_luecken is `luecken`."""

    def __init__(self, stumm=False):
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.s.bind(("127.0.0.1", 0))
        self.s.settimeout(0.05)
        self.port = self.s.getsockname()[1]
        self.luecken = 0
        self.gen = 1
        self.stumm = stumm
        self.abo = set()
        self.stop = threading.Event()
        self.t = threading.Thread(target=self._lauf, daemon=True)
        self.t.start()

    def _lauf(self):
        letzt = 0.0
        while not self.stop.is_set():
            try:
                b, _ = self.s.recvfrom(4096)
                m = osc.lies(b)
                if m and m[0] == "/k/hallo" and len(m[2]) >= 2:
                    self.abo.add(m[2][1])
            except socket.timeout:
                pass
            except OSError:
                return
            if not self.stumm and time.monotonic() - letzt >= 0.04:
                letzt = time.monotonic()
                for p in list(self.abo):
                    msg = osc.kodiere("/zustand/kern", ",iiiiiiiiiiii", self.gen, 256, 1000, self.luecken, 0, 100, 50, 80, 0, 0, 0, 0)
                    self.s.sendto(msg, ("127.0.0.1", p))

    def ende(self):
        self.stop.set()
        self.t.join(2)
        self.s.close()


class AttrapInstanz:
    """What Tour needs of an Instanz: url, kern_port, env."""

    def __init__(self, url, kern_port=0):
        self.url, self.kern_port, self.env, self.buchstabe = url, kern_port, {}, "b"


@pytest.fixture
def seite():
    s = Seite()
    yield s
    s.ende()


@pytest.fixture
def tour(seite, tmp_path):
    return L.Tour("jx", AttrapInstanz(seite.url), tmp_path / "aus", kurz=True)


def test_ruf_returns_code_and_reason_without_raising(tour):
    a = tour.ruf("GET", "/nein")
    assert a.code == 409 and a.grund == "x" and a.j["text"] == "y"
    assert tour.ruf("GET", "/lage").code == 200


def test_ruf_on_a_dead_page_is_code_0_not_an_exception(tmp_path):
    t = L.Tour("jx", AttrapInstanz("http://127.0.0.1:1"), tmp_path / "aus", kurz=True)
    a = t.ruf("GET", "/lage")
    assert a.code == 0 and a.grund


def test_ruf_sends_the_source_header(tour, seite):
    tour.ruf("POST", "/x", {"a": 1})
    tour.ruf("POST", "/y", {"a": 1}, quelle="andreas")
    kopf = [{k.lower(): v for k, v in h[1].items()} for h in seite.hinweise]
    assert kopf[0]["x-djk-quelle"] == "cypher"
    assert kopf[1]["x-djk-quelle"] == "andreas"


def test_hochladen_is_a_raw_owner_post(tour, seite, tmp_path):
    f = tmp_path / "a.wav"
    f.write_bytes(b"RIFFxxxx")
    a = tour.hochladen("/import/datei", f, {"name": "a.wav"})
    assert a.code == 200
    pfad, kopf, roh = seite.hinweise[0]
    assert pfad.startswith("/import/datei?") and "name=a.wav" in pfad
    k = {x.lower(): v for x, v in kopf.items()}
    assert k["x-djk-roh"] == "1" and k["content-type"] == "application/octet-stream" and k["x-djk-quelle"] == "andreas"
    assert roh == b"RIFFxxxx"


def test_a_red_step_records_route_code_and_reason_and_the_tour_goes_on(tour):
    with tour.schritt("a.eins", "first"):
        a = tour.ruf("POST", "/nein", {})
        assert a.code == 200, "refused"
    with tour.schritt("a.zwei", "second"):
        pass
    b = tour.bericht()
    assert [s["urteil"] for s in b.schritte] == ["FEHL", "OK"]
    r = b.schritte[0]
    assert r["ruf"] == "POST /nein" and r["code"] == 409 and r["grund"] == "g"
    assert b.zusammen == {"ok": 1, "fehl": 1, "skip": 0}


def test_pflicht_ends_the_tour_and_the_report_is_still_written(tour, tmp_path):
    def schritte(t):
        with t.schritt("p.eins", "must", pflicht=True):
            raise RuntimeError("boom")
        with t.schritt("p.zwei", "never"):
            pass
    tour.fuehre(schritte)
    j = json.loads((tmp_path / "aus" / "bericht.json").read_text())
    assert [s["kennung"] for s in j["schritte"]] == ["p.eins"]
    assert j["schritte"][0]["urteil"] == "FEHL" and "boom" in j["schritte"][0]["grund"]
    assert (tmp_path / "aus" / "bericht.md").read_text().count("\n") >= 1
    assert tour.bericht().exitcode() == 1


def test_a_stack_trace_in_the_steps_function_still_gives_a_report(tour, tmp_path):
    def schritte(t):
        raise KeyError("x")
    tour.fuehre(schritte)
    assert (tmp_path / "aus" / "bericht.json").exists()
    assert tour.bericht().exitcode() == 1


def test_skip_inside_a_step(tour):
    with tour.schritt("s.eins", "hw"):
        tour.skip("no APC20", sitzung="controller session")
    s = tour.bericht().schritte[0]
    assert s["urteil"] == "SKIP" and "no APC20" in s["grund"] and s["werte"]["sitzung"] == "controller session"


def test_pegel_phase_silent_and_clipping(tour, seite):
    seite.pegel_db = -200.0
    p = tour.pegel_phase(2, takt=0.05)
    assert p.still is True and p.uebersteuert is False and p.max_db <= -200
    seite.pegel_db = 0.0
    p = tour.pegel_phase(2, takt=0.05)
    assert p.uebersteuert is True and p.still is False
    seite.pegel_db = -20.0
    p = tour.pegel_phase(2, takt=0.05)
    assert not p.still and not p.uebersteuert and p.median_db == -20.0


def test_warte_bis(tour):
    t0 = time.monotonic()
    assert tour.warte_bis(lambda: time.monotonic() - t0 > 0.2, 3, "soon") is True
    assert tour.warte_bis(lambda: False, 0.3, "never") is False


def test_xrun_basis_without_messages_raises():
    k = FakeKern(stumm=True)
    try:
        x = L.XrunZaehler(k.port, erste_frist_s=0.4)
        with pytest.raises(RuntimeError):
            x.basis(0.2)
        x.ende()
    finally:
        k.ende()


def test_xrun_phase_delta_against_the_baseline():
    k = FakeKern()
    try:
        x = L.XrunZaehler(k.port, erste_frist_s=3)
        x.basis(0.4)
        assert x.ok(0) and not x.ok(3)
        with x.phase() as m:
            time.sleep(0.2)
            k.luecken += 3
            time.sleep(0.3)
        assert m.delta == 3 and x.ok(m) is False
        with x.phase() as m:
            time.sleep(0.3)
        assert m.delta == 0 and x.ok(m) is True
        x.ende()
    finally:
        k.ende()


def test_xrun_baseline_above_zero_allows_scaled_delta():
    k = FakeKern()
    try:
        x = L.XrunZaehler(k.port, erste_frist_s=3)
        x._basis_delta, x._basis_sek = 4, 10.0   # a machine with background xruns
        assert x.ok(4) and x.ok(8, 20.0) and not x.ok(5)
        x.ende()
    finally:
        k.ende()


def _wav(pfad, werte, sr=8000):
    with wave.open(str(pfad), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(struct.pack("<h", int(max(-32768, min(32767, v * 32767)))) for v in werte))


def _f32(pfad, werte, sr=8000):
    # 32 bit float WAV by hand: wave cannot write it
    daten = struct.pack("<%df" % len(werte), *werte)
    kopf = b"RIFF" + struct.pack("<I", 36 + len(daten)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 1, sr, sr * 4, 4, 32) + b"data" + struct.pack("<I", len(daten))
    Path(pfad).write_bytes(kopf + daten)


def test_pruefe_datei_sine_nan_missing(tour, tmp_path):
    sinus = [0.5 * math.sin(2 * math.pi * 440 * i / 8000) for i in range(16000)]
    ok = tmp_path / "sinus.wav"
    _wav(ok, sinus)
    e = tour.pruefe_datei(ok, 1.5)
    assert e.ok and e.gruende == [] and abs(e.dauer_s - 2.0) < 0.05
    nan = tmp_path / "nan.wav"
    _f32(nan, sinus[:8000] + [float("nan")] + sinus[8001:])
    e = tour.pruefe_datei(nan, 1.5)
    assert not e.ok and "nan" in e.gruende
    e = tour.pruefe_datei(tmp_path / "gibtsnicht.wav", 1.0)
    assert not e.ok and e.gruende == ["fehlt"]


def test_pruefe_datei_too_short_clipping_and_dc(tour, tmp_path):
    kurz = tmp_path / "kurz.wav"
    _wav(kurz, [0.3] * 800)
    assert "zu_kurz" in tour.pruefe_datei(kurz, 1.0).gruende
    clip = tmp_path / "clip.wav"
    _f32(clip, [1.0 if i % 2 else -0.2 for i in range(16000)])
    assert "clipping" in tour.pruefe_datei(clip, 1.0).gruende
    dc = tmp_path / "dc.wav"
    _wav(dc, [0.1] * 16000)
    assert "dc" in tour.pruefe_datei(dc, 1.0).gruende


def test_instanz_refuses_letters_outside_b_to_f():
    for x in ("a", "g", "h", "i", "bb", ""):
        with pytest.raises(ValueError):
            L.Instanz(x)
    L.Instanz("b")
    L.Instanz("f")


def test_instanz_start_refuses_a_foreign_running_instance(monkeypatch):
    monkeypatch.setattr(L.dauerlauf, "einheiten_aktiv", lambda i: ["cypherdj-kern-b.service"])
    started = []
    monkeypatch.setattr(L.subprocess, "run", lambda *a, **k: started.append(a) or subprocess.CompletedProcess(a, 0, "", ""))
    with pytest.raises(RuntimeError, match="already"):
        L.Instanz("b").start()
    assert started == []


def test_instanz_env_names_the_per_instance_folders():
    i = L.Instanz("c")
    e = i.env
    for k in ("CYPHERDJ_KATALOG", "CYPHERDJ_BIBLIOTHEK_KONFIG", "CYPHERDJ_BIBLIOTHEK_CACHE", "CYPHERDJ_HEIM", "CYPHERDJ_KIT_ORDNER", "CYPHERDJ_BK_ORDNER"):
        assert e[k].startswith("/dev/shm/cypherdj-c/"), k
    assert i.url == "http://127.0.0.1:50300" and i.kern_port == 50100


def _instanz_in(tmp_path):
    i = L.Instanz("c")
    i.shm = str(tmp_path / "cypherdj-c")
    os.makedirs(i.shm)
    return i


def test_projects_live_in_a_folder_of_the_run_and_the_instance_folder_stays_untouched(tmp_path):
    i = _instanz_in(tmp_path)
    i._projekte_anlegen()
    link = Path(i.shm) / "projekte"
    assert link.is_symlink() and link.resolve() == (Path(i.shm) / "tour" / "projekte").resolve()
    (link / "tour-j0").mkdir()                       # what the page server does when a project is created
    assert (Path(i.shm) / "tour" / "projekte" / "tour-j0").is_dir()
    (Path(i.shm) / "hotcues").mkdir()                # a folder of the instance itself
    i._projekte_raeumen()
    assert not link.exists() and not link.is_symlink()
    assert not (Path(i.shm) / "tour").exists()
    assert (Path(i.shm) / "hotcues").is_dir()


def test_an_empty_leftover_projects_folder_is_replaced(tmp_path):
    i = _instanz_in(tmp_path)
    (Path(i.shm) / "projekte").mkdir()
    i._projekte_anlegen()
    assert (Path(i.shm) / "projekte").is_symlink() and not i.hinweise
    i._projekte_raeumen()
    assert not (Path(i.shm) / "projekte").exists()


def _baum(w):
    return {str(p.relative_to(w)): (p.read_bytes() if p.is_file() else None) for p in sorted(Path(w).rglob("*"))}


def test_a_full_projects_folder_is_moved_aside_and_comes_back_byte_identical(tmp_path):
    i = _instanz_in(tmp_path)
    p = Path(i.shm) / "projekte"
    (p / "fremd" / "tief").mkdir(parents=True)
    (p / "fremd" / "projekt.json").write_bytes(b'{"a": 1}\x00\xff')
    (p / "fremd" / "tief" / "x.bin").write_bytes(bytes(range(256)))
    (p / "zwei").mkdir()
    vorher = _baum(p)
    i._projekte_anlegen()
    assert p.is_symlink() and not (p / "fremd").exists(), "the run sees an empty root"
    beiseite = [d for d in Path(i.shm).iterdir() if d.name.startswith("projekte.vor-tour-")]
    assert len(beiseite) == 1 and _baum(beiseite[0]) == vorher
    (p / "tour-j0").mkdir()
    assert any("moved aside" in h for h in i.hinweise)
    i._projekte_raeumen()
    assert p.is_dir() and not p.is_symlink() and _baum(p) == vorher
    assert not [d for d in Path(i.shm).iterdir() if d.name.startswith("projekte.vor-tour-")]
    assert not (Path(i.shm) / "tour").exists()
    assert any("moved back" in h for h in i.hinweise)


def test_the_report_names_the_moved_folder(tmp_path):
    i = _instanz_in(tmp_path)
    (Path(i.shm) / "projekte" / "fremd").mkdir(parents=True)
    i._projekte_anlegen()
    b = L.Bericht("t", "c", "a", "b", False, [], tmp_path / "out", i.hinweise)
    assert "Note: " in b.markdown() and b.als_dict()["hinweise"]
    i._projekte_raeumen()


def test_live_laut_reads_the_master_of_the_live_studio_only_once_and_read_only(seite):
    seite.pegel_db = -12.0
    assert L.live_laut(seite.url) is True
    seite.pegel_db = -200.0
    assert L.live_laut(seite.url) is False
    assert L.live_laut("http://127.0.0.1:1") is False
    assert [h for h in seite.hinweise] == [], "only GET"


ISOLIERT = ("CYPHERDJ_MEDIATHEK", "CYPHERDJ_ANALYSE", "CYPHERDJ_SAMPLER", "CYPHERDJ_KLAENGE", "CYPHERDJ_LOOPSETS", "CYPHERDJ_REFERENZEN", "CYPHERDJ_MODULE")


def test_instanz_env_isolates_what_could_point_at_the_owners_data(monkeypatch):
    for k in ISOLIERT:                                # an owner's variable in the shell must not leak in either
        monkeypatch.setenv(k, "/home/owner/echt")
    i = L.Instanz("c")
    for k in ISOLIERT:
        assert i.env[k].startswith("/dev/shm/cypherdj-c/tour/iso/"), k
    assert i.env["CYPHERDJ_MEDIATHEK"].endswith("/mediathek/mediathek.sqlite")


def test_instanz_env_argument_wins_over_its_own(monkeypatch):
    i = L.Instanz("c", env={"CYPHERDJ_MEDIATHEK": "/x/m.sqlite", "EXTRA": 7})
    assert i.env["CYPHERDJ_MEDIATHEK"] == "/x/m.sqlite" and i.env["EXTRA"] == "7"
    assert i.env["CYPHERDJ_SAMPLER"].startswith("/dev/shm/cypherdj-c/tour/iso/")


def test_instanz_creates_the_isolated_folders_and_the_runs_folder_removes_them(tmp_path):
    i = _instanz_in(tmp_path)
    i.iso_ordner = [str(tmp_path / "cypherdj-c" / "tour" / "iso" / n) for n in ("sampler", "mediathek")]
    i.env["CYPHERDJ_BK_ORDNER"] = str(tmp_path / "cypherdj-c" / "tour" / "bk")
    i.env["CYPHERDJ_IMPORTE"] = str(tmp_path / "cypherdj-c" / "importe")
    i.kit_ordner = str(tmp_path / "cypherdj-c" / "tour" / "kits")
    i._ordner_anlegen()
    assert all(Path(d).is_dir() for d in i.iso_ordner)
    assert i._angelegt, "the run removes what it created"


def test_the_last_call_is_kept_per_thread(tour):
    gelesen, schritt1, schritt2 = {}, threading.Event(), threading.Event()

    def a():
        tour.ruf("GET", "/lage")
        schritt1.set()
        schritt2.wait(5)
        gelesen["a"] = tour._letzter[0]

    def b():
        schritt1.wait(5)
        tour.ruf("GET", "/nein")
        gelesen["b"] = tour._letzter[0]
        schritt2.set()

    ta, tb = threading.Thread(target=a), threading.Thread(target=b)
    ta.start(); tb.start(); ta.join(5); tb.join(5)
    assert gelesen == {"a": "GET /lage", "b": "GET /nein"}


def test_pruefe_datei_measures_the_longest_silent_gap_and_can_turn_it_into_a_reason(tour, tmp_path):
    sr = 8000
    ton = [0.5 * math.sin(2 * math.pi * 440 * i / sr) for i in range(sr)]
    f = tmp_path / "luecke.wav"
    _wav(f, ton + [0.0] * int(sr * 0.6) + ton + [0.0] * int(sr * 0.2) + ton, sr)
    r = tour.pruefe_datei(f, 1.0)
    assert 0.55 <= r.max_stille_s <= 0.65 and r.ok, (r.max_stille_s, r.gruende)
    assert "stille" not in r.gruende
    r2 = tour.pruefe_datei(f, 1.0, max_stille=0.3)
    assert "stille" in r2.gruende and not r2.ok
    assert tour.pruefe_datei(f, 1.0, max_stille=1.0).ok
    ganz = tmp_path / "ton.wav"
    _wav(ganz, ton * 2, sr)
    assert tour.pruefe_datei(ganz, 1.0).max_stille_s == 0.0


FAKE_MCP = r'''
import json, sys
for z in sys.stdin:
    m = json.loads(z)
    if "id" not in m:
        continue
    if m["method"] == "initialize":
        r = {"protocolVersion": "2024-11-05", "capabilities": {}, "serverInfo": {"name": "fake", "version": "0"}}
    elif m["method"] == "tools/list":
        r = {"tools": [{"name": "lage"}, {"name": "pad"}]}
    elif m["method"] == "tools/call":
        if m["params"]["name"] == "pad":
            r = {"content": [{"type": "text", "text": json.dumps({"ok": False, "grund": "g"})}], "isError": True}
        elif m["params"]["name"] == "nur_fehler":
            r = {"content": [{"type": "text", "text": json.dumps({"fehler": "ki_gestoppt"})}], "isError": True}
        else:
            r = {"content": [{"type": "text", "text": json.dumps({"ok": True, "args": m["params"]["arguments"]})}]}
    else:
        print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32601, "message": "no"}}), flush=True); continue
    print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
'''


def test_hand_lists_tools_and_returns_a_tool_error_as_data(tmp_path):
    skript = tmp_path / "fake_mcp.py"
    skript.write_text(FAKE_MCP)
    h = L.Hand(AttrapInstanz("http://127.0.0.1:1"), befehl=[sys.executable, str(skript)])
    try:
        assert h.werkzeuge() == ["lage", "pad"]
        a = h.rufe("lage", {"x": 1})
        assert a["ok"] is True and a["args"] == {"x": 1}
        f = h.rufe("pad", {})
        assert f["ok"] is False and f["grund"] == "g" and f["_fehler"] is True
    finally:
        h.ende()


def test_hand_command_is_the_registration_command():
    h = L.Hand.__new__(L.Hand)
    z = L.Hand.standardbefehl("http://127.0.0.1:50300")
    assert z[0] == "node" and z[1].endswith(os.path.join("hand", "hand.ts")) and z[2:] == ["--seite", "http://127.0.0.1:50300"]


def test_exitcode(tmp_path):
    def neu():
        return L.Tour("jx", AttrapInstanz("http://127.0.0.1:1"), tmp_path / "x", kurz=True)
    t = neu()
    with t.schritt("a", "ok"):
        pass
    assert t.bericht().exitcode() == 0
    with t.schritt("b", "red"):
        raise AssertionError("no")
    assert t.bericht().exitcode() == 1
    t = neu()
    with t.schritt("a", "live"):
        t.skip("live studio is playing", ursache="live")
    assert t.bericht().exitcode() == 77
    t = neu()
    with t.schritt("a", "hw"):
        t.skip("no APC20", sitzung="controller")
    assert t.bericht().exitcode() == 0
    t = neu()
    with t.schritt("a", "live"):
        t.skip("live studio is playing", ursache="live")
    with t.schritt("b", "red"):
        raise AssertionError("no")
    assert t.bericht().exitcode() == 1


def test_bericht_json_schema(tour, tmp_path):
    with tour.schritt("a.eins", "one"):
        tour.ruf("GET", "/lage")
    tour.fuehre(lambda t: None)
    j = json.loads((tmp_path / "aus" / "bericht.json").read_text())
    assert {"tour", "instanz", "start", "ende", "kurz", "schritte", "zusammen"} <= set(j)
    assert {"kennung", "text", "urteil", "sek", "ruf", "code", "grund", "werte"} <= set(j["schritte"][0])
    assert j["tour"] == "jx" and j["kurz"] is True


def test_a_silent_file_is_red_but_keeps_the_stumm_field(tour, tmp_path):
    f = tmp_path / "still.wav"
    _wav(f, [0.0] * 16000, 8000)
    r = tour.pruefe_datei(f, 1.0)
    assert r.stumm is True and "still" in r.gruende and r.ok is False


def test_xrun_phase_without_core_messages_is_not_ok_with_a_reason():
    k = FakeKern()
    try:
        x = L.XrunZaehler(k.port, erste_frist_s=3)
        x.basis(0.4)
        k.ende()                                     # the core dies
        time.sleep(0.3)
        with x.phase() as m:
            time.sleep(0.3)
        assert m.delta is None and m.grund == "keine_meldungen" and m.meldungen == 0
        assert x.ok(m) is False
        x.ende()
    finally:
        k.ende()


def test_xrun_phase_with_messages_has_no_reason():
    k = FakeKern()
    try:
        x = L.XrunZaehler(k.port, erste_frist_s=3)
        x.basis(0.3)
        with x.phase() as m:
            time.sleep(0.3)
        assert m.grund is None and m.meldungen > 0 and x.ok(m)
        x.ende()
    finally:
        k.ende()


def test_notiere_records_a_call_made_in_a_worker_thread(tour):
    got = {}
    t = threading.Thread(target=lambda: got.setdefault("a", tour.ruf("GET", "/lage")))
    with tour.schritt("n.1", "worker call") as w:
        t.start(); t.join(5)
        tour.notiere(got["a"], "GET /lage")
    s = tour._schritte[-1]
    assert s["ruf"] == "GET /lage" and s["code"] == 200


def test_a_failed_call_inside_a_step_turns_it_red_although_the_body_ignores_it(tour):
    with tour.schritt("e.eins", "a 500 in the middle"):
        tour.ruf("POST", "/boom", {})
        tour.ruf("GET", "/lage")                       # a later good call does not wash it out
    with tour.schritt("e.zwei", "all good"):
        tour.ruf("GET", "/lage")
    r = tour.bericht().schritte
    assert [x["urteil"] for x in r] == ["FEHL", "OK"]
    assert r[0]["ruf"] == "POST /boom" and r[0]["code"] == 500 and r[0]["grund"] == "kaputt"
    assert r[0]["werte"]["fehlerhafte_aufrufe"] == ["POST /boom 500 kaputt"]


def test_a_declared_409_keeps_the_step_green_and_an_undeclared_code_does_not(tour):
    with tour.schritt("e.erwartet", "declared"):
        a = tour.ruf("POST", "/nein", {}, erwartet={409})
        assert a.code == 409
    with tour.schritt("e.andere", "declared another code"):
        tour.ruf("POST", "/boom", {}, erwartet={409})
    assert [x["urteil"] for x in tour.bericht().schritte] == ["OK", "FEHL"]


def test_an_upload_that_fails_inside_a_step_is_red(tour, tmp_path):
    f = tmp_path / "a.wav"
    f.write_bytes(b"x")
    with tour.schritt("e.hoch", "upload"):
        tour.hochladen("/boom", f)
    assert tour.bericht().schritte[0]["urteil"] == "FEHL"


def test_a_poll_and_calls_outside_a_step_never_mark(tour):
    tour.ruf("POST", "/boom", {})                       # outside a step: nothing to mark
    with tour.schritt("e.poll", "poll sees errors on the way"):
        n = []
        assert tour.warte_bis(lambda: n.append(tour.ruf("GET", "/nein")) or len(n) > 1, 3)
    assert tour.bericht().schritte[0]["urteil"] == "OK"


def test_an_explicit_rot_and_a_failed_call_both_stay_visible(tour):
    with tour.schritt("e.beide", "both"):
        tour.ruf("POST", "/boom", {})
        tour.rot("the file is wrong")
    s = tour.bericht().schritte[0]
    assert s["urteil"] == "FEHL" and s["werte"]["fehlerhafte_aufrufe"] == ["POST /boom 500 kaputt"]
    assert "the file is wrong" in (s["grund"] or "") + s["werte"].get("rot_text", "")


def test_a_tool_error_through_the_hand_turns_the_step_red_unless_declared(tour, tmp_path):
    skript = tmp_path / "fake_mcp.py"
    skript.write_text(FAKE_MCP)
    h = L.Hand(AttrapInstanz("http://127.0.0.1:1"), befehl=[sys.executable, str(skript)], tour=tour)
    try:
        with tour.schritt("h.rot", "tool error"):
            h.rufe("pad", {})
        with tour.schritt("h.gruen", "declared tool error"):
            f = h.rufe("pad", {}, erwartet={"g"})
            assert f["_fehler"] is True
        with tour.schritt("h.ok", "good call"):
            h.rufe("lage", {})
    finally:
        h.ende()
    r = tour.bericht().schritte
    assert [x["urteil"] for x in r] == ["FEHL", "OK", "OK"] and r[0]["grund"] == "g"


def test_a_core_restart_inside_a_phase_is_its_own_verdict():
    k = FakeKern()
    try:
        x = L.XrunZaehler(k.port, erste_frist_s=3)
        x.basis(0.4)
        with x.phase() as m:
            time.sleep(0.3)
            k.gen = 2                                # the watchdog killed and restarted the core: a new generation, frame_luecken stays 0
            time.sleep(0.3)
        assert m.neustarts == 1 and m.grund == "neustart" and m.meldungen > 0
        assert m.delta == 0 and x.ok(m) is False, "delta 0 alone would have looked green"
        with x.phase() as m2:                        # the next phase on the new generation is clean again
            time.sleep(0.3)
        assert m2.neustarts == 0 and m2.grund is None and x.ok(m2) is True
        x.ende()
    finally:
        k.ende()


def test_a_restart_during_the_baseline_raises():
    k = FakeKern()
    try:
        x = L.XrunZaehler(k.port, erste_frist_s=3)
        threading.Timer(0.3, lambda: setattr(k, "gen", 2)).start()
        with pytest.raises(RuntimeError, match="restarted"):
            x.basis(0.8)
        x.ende()
    finally:
        k.ende()


def test_hand_erwartet_also_matches_the_fehler_field(tour, tmp_path):
    skript = tmp_path / "fake_mcp.py"
    skript.write_text(FAKE_MCP)
    h = L.Hand(AttrapInstanz("http://127.0.0.1:1"), befehl=[sys.executable, str(skript)], tour=tour)
    try:
        with tour.schritt("f.gruen", "refusal declared by its fehler"):
            r = h.rufe("nur_fehler", {}, erwartet={"ki_gestoppt"})
            assert r["_fehler"] is True and r["fehler"] == "ki_gestoppt" and "grund" not in r
        with tour.schritt("f.rot", "refusal not declared"):
            h.rufe("nur_fehler", {})
    finally:
        h.ende()
    r = tour.bericht().schritte
    assert [x["urteil"] for x in r] == ["OK", "FEHL"] and r[1]["grund"] == "ki_gestoppt"


def test_the_markdown_report_shows_the_values_of_each_step_compactly(tour):
    with tour.schritt("m.eins", "numbers"):
        tour.werte(aufrufe_als_andreas=3, max_db=-13.8, lang="x" * 300, liste=[1, 2], text="a\nb")
    with tour.schritt("m.zwei", "none"):
        pass
    md = tour.bericht().markdown()
    assert "  - aufrufe_als_andreas: 3" in md and "  - max_db: -13.8" in md and "  - liste: [1, 2]" in md and "  - text: a b" in md
    zeile = next(z for z in md.splitlines() if z.startswith("  - lang:"))
    assert len(zeile) <= len("  - lang: ") + 120 and zeile.endswith("...")
    assert md.splitlines().index("- OK `m.zwei` none (0.0 s)") > md.splitlines().index(zeile)
