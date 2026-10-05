import json
import urllib.request
import urllib.error
import pytest
from klang.hoerprobe import Hoerprobe


class FakeProc:
    def __init__(self, argv):
        self.argv = argv
        self.beendet = False

    def terminate(self):
        self.beendet = True

    kill = terminate

    def poll(self):
        return 0 if self.beendet else None

    def wait(self, timeout=None):
        return 0


class FakePlayer:
    def __init__(self):
        self.procs = []

    def __call__(self, argv):
        p = FakeProc(argv)
        self.procs.append(p)
        return p


def _index(ordner):
    for r in ("bd", "sd"):
        (ordner / r).mkdir()
    eintraege = {"bd": [], "sd": []}
    for r, n, ktx in [("bd", 1, False), ("bd", 1, True), ("bd", 2, False), ("sd", 1, False)]:
        name = f"{n}_kontext.wav" if ktx else f"{n}.wav"
        p = ordner / r / name
        p.write_bytes(b"RIFF")
        e = {"nr": n, "pfad": str(p), "quelle": f"/q/{r}{n}.wav", "kuenstler": "X",
             "lufs": -18.0, "tp": -4.0, "unbekannt": 1}
        if ktx:
            e["kontext"] = True
        eintraege[r].append(e)
    (ordner / "index.json").write_text(json.dumps(eintraege))
    return eintraege


@pytest.fixture
def srv(tmp_path):
    idx = _index(tmp_path)
    pl = FakePlayer()
    h = Hoerprobe(tmp_path, senke="test-senke", player=pl, port=0)
    h.start()
    yield h, pl, idx, tmp_path
    h.stop()


def post(h, pfad, daten):
    if pfad in ("/play", "/waehle") and "version" not in daten:
        daten = dict(daten, version=h.version)
    req = urllib.request.Request(f"http://127.0.0.1:{h.port}{pfad}", json.dumps(daten).encode(),
                                 {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}


def get(h, pfad):
    with urllib.request.urlopen(f"http://127.0.0.1:{h.port}{pfad}") as r:
        return r.status, r.read()


def test_play_ruft_player_mit_pfad_aus_index_und_target(srv):
    h, pl, idx, _ = srv
    st, _ = post(h, "/play", {"rolle": "bd", "nr": 2})
    assert st == 200
    assert pl.procs[0].argv == ["pw-play", "--target", "test-senke", idx["bd"][2]["pfad"]]


def test_play_kontext_spielt_kontextvariante(srv):
    h, pl, idx, _ = srv
    post(h, "/play", {"rolle": "bd", "nr": 1, "kontext": True})
    assert pl.procs[0].argv[-1] == idx["bd"][1]["pfad"]
    post(h, "/play", {"rolle": "bd", "nr": 1})
    assert pl.procs[1].argv[-1] == idx["bd"][0]["pfad"]


def test_zweites_play_stoppt_das_erste(srv):
    h, pl, _, _ = srv
    post(h, "/play", {"rolle": "bd", "nr": 1})
    post(h, "/play", {"rolle": "sd", "nr": 1})
    assert len(pl.procs) == 2
    assert pl.procs[0].beendet and not pl.procs[1].beendet


def test_stop_beendet_wiedergabe(srv):
    h, pl, _, _ = srv
    post(h, "/play", {"rolle": "bd", "nr": 1})
    st, _ = post(h, "/stop", {})
    assert st == 200 and pl.procs[0].beendet


def test_waehle_schreibt_auswahl_und_index_liefert_sie(srv):
    h, _, _, ordner = srv
    assert post(h, "/waehle", {"rolle": "bd", "nr": 2, "an": True})[0] == 200
    assert post(h, "/waehle", {"rolle": "bd", "nr": 1, "an": True})[0] == 200
    assert json.loads((ordner / "auswahl.json").read_text()) == {"bd": ["/q/bd2.wav", "/q/bd1.wav"]}
    _, body = get(h, "/index")
    d = json.loads(body)
    assert d["auswahl"] == {"bd": ["/q/bd2.wav", "/q/bd1.wav"]}
    assert set(d["index"]) == {"bd", "sd"}
    post(h, "/waehle", {"rolle": "bd", "nr": 2, "an": False})
    assert json.loads((ordner / "auswahl.json").read_text())["bd"] == ["/q/bd1.wav"]


def test_auswahl_hoechstens_acht(tmp_path):
    (tmp_path / "bd").mkdir()
    e = []
    for n in range(1, 11):
        p = tmp_path / "bd" / f"{n}.wav"
        p.write_bytes(b"x")
        e.append({"nr": n, "pfad": str(p), "quelle": f"/q/{n}.wav"})
    (tmp_path / "index.json").write_text(json.dumps({"bd": e}))
    h = Hoerprobe(tmp_path, senke="s", player=FakePlayer(), port=0)
    h.start()
    try:
        codes = [post(h, "/waehle", {"rolle": "bd", "nr": n, "an": True})[0] for n in range(1, 11)]
        assert codes[:8] == [200] * 8 and codes[8:] == [409, 409]
        assert len(json.loads((tmp_path / "auswahl.json").read_text())["bd"]) == 8
    finally:
        h.stop()


def test_auswahl_ueberlebt_neustart(srv):
    h, pl, _, ordner = srv
    post(h, "/waehle", {"rolle": "sd", "nr": 1, "an": True})
    h2 = Hoerprobe(ordner, senke="s", player=pl, port=0)
    assert h2.auswahl == {"sd": ["/q/sd1.wav"]}


def test_negativkontrolle_unbekannte_nr_und_pfadtrick(srv):
    h, pl, _, _ = srv
    assert post(h, "/play", {"rolle": "bd", "nr": 999})[0] == 404
    assert post(h, "/play", {"rolle": "../../etc", "nr": 0})[0] == 404
    assert post(h, "/play", {"rolle": "bd", "pfad": "/etc/passwd"})[0] in (400, 404)
    assert post(h, "/play", {"pfad": "/etc/passwd", "rolle": "bd", "nr": "1/../../x"})[0] in (400, 404)
    assert post(h, "/waehle", {"rolle": "bd", "nr": 999, "an": True})[0] == 404
    assert pl.procs == []


def test_seite_wird_ausgeliefert_und_nur_localhost(srv):
    h, _, _, _ = srv
    st, body = get(h, "/")
    assert st == 200 and b"keep" in body
    assert h.httpd.server_address[0] == "127.0.0.1"


# ---- Nachbesserung T6 -------------------------------------------------------
import http.client
import os
import signal
import subprocess
import sys
import textwrap
import time
from klang import hoerprobe as hp


class LangsamProc:
    """Fake, der `dauer` s zum Beenden nach terminate braucht; stur=True stirbt nur an kill."""
    def __init__(self, argv, dauer=0.3, stur=False):
        self.argv, self.dauer, self.stur = argv, dauer, stur
        self.ende = None
        self.gekillt = False

    def _lebt(self):
        return self.ende is None or time.monotonic() < self.ende

    def terminate(self):
        if not self.stur and self.ende is None:
            self.ende = time.monotonic() + self.dauer

    def kill(self):
        self.gekillt = True
        self.ende = time.monotonic()

    def poll(self):
        return None if self._lebt() else 0

    def wait(self, timeout=None):
        if self.ende is None:
            time.sleep(timeout or 0)
            raise subprocess.TimeoutExpired(self.argv, timeout)
        rest = self.ende - time.monotonic()
        if timeout is not None and rest > timeout:
            time.sleep(timeout)
            raise subprocess.TimeoutExpired(self.argv, timeout)
        time.sleep(max(rest, 0))
        return 0


def test_nie_zwei_player_gleichzeitig_auch_bei_langsamem_ende(tmp_path):
    _index(tmp_path)
    procs, lebten = [], []

    def pl(argv):
        lebten.append([p.poll() is None for p in procs])
        procs.append(LangsamProc(argv))
        return procs[-1]

    h = Hoerprobe(tmp_path, senke="s", player=pl, port=0)
    h.start()
    try:
        post(h, "/play", {"rolle": "bd", "nr": 1})
        post(h, "/play", {"rolle": "sd", "nr": 1})
        assert lebten == [[], [False]]  # beim Start des zweiten war der erste tot
        assert not procs[0].gekillt
    finally:
        h.stop()


def test_stop_killt_wenn_terminate_nicht_reicht(tmp_path):
    _index(tmp_path)
    procs = []

    def pl(argv):
        procs.append(LangsamProc(argv, stur=True))
        return procs[-1]

    h = Hoerprobe(tmp_path, senke="s", player=pl, port=0)
    h.start()
    try:
        post(h, "/play", {"rolle": "bd", "nr": 1})
        t = time.monotonic()
        post(h, "/stop", {})
        assert procs[0].gekillt and time.monotonic() - t < 3
    finally:
        h.stop()


SERVER_SKRIPT = textwrap.dedent('''
    import sys
    sys.path.insert(0, {wurzel!r})
    from klang import hoerprobe as hp
    def spieler(argv):                 # echter Kindprozess ueber den echten _popen (PDEATHSIG)
        p = hp._popen(["sleep", "60"])
        print("KIND", p.pid, flush=True)
        return p
    sys.exit(hp.main(["--proben", {proben!r}, "--port", "0", "--senke", "x"],
                     player=spieler, senke_pruefer=lambda s: True))
''')


def _tot(pid, warte=3.0):
    """Wartet bis der Prozess tot ist (hoechstens `warte` s, Pruefung alle 50 ms). Zombie zaehlt als tot.

    Lesen von /proc/<pid>/stat eines gerade sterbenden Prozesses kann ProcessLookupError (ESRCH)
    statt FileNotFoundError werfen - das ist selbst der Beleg fuer "tot", kein Testfehler."""
    ende = time.monotonic() + warte
    while True:
        try:
            with open(f"/proc/{pid}/stat") as f:
                if f.read().rsplit(")", 1)[1].split()[0] == "Z":
                    return True
        except (FileNotFoundError, ProcessLookupError):
            return True
        if time.monotonic() >= ende:
            return False
        time.sleep(0.05)


@pytest.mark.parametrize("sig", [signal.SIGTERM, signal.SIGHUP, signal.SIGKILL])
def test_server_ende_hinterlaesst_keinen_player(tmp_path, sig):
    _index(tmp_path)
    wurzel = str(__import__("pathlib").Path(__file__).resolve().parents[2])
    srv = subprocess.Popen([sys.executable, "-c", SERVER_SKRIPT.format(wurzel=wurzel, proben=str(tmp_path))],
                           stdout=subprocess.PIPE, text=True)
    try:
        port = int(srv.stdout.readline().split(":")[2].split("/")[0])
        ver = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/index").read())["version"]
        req = urllib.request.Request(f"http://127.0.0.1:{port}/play",
                                     json.dumps({"rolle": "bd", "nr": 1, "version": ver}).encode(),
                                     {"Content-Type": "application/json"})
        assert urllib.request.urlopen(req).status == 200
        kind = int(srv.stdout.readline().split()[1])
        assert not _tot(kind, 0.3)  # Kontrolle: der Kindprozess lebt vorher wirklich
        srv.send_signal(sig)
        srv.wait(5)
        assert _tot(kind), f"Player {kind} ueberlebt {sig.name}"
        if sig != signal.SIGKILL:
            assert srv.returncode == 0
    finally:
        srv.kill()
        srv.wait()


def test_play_ignoriert_pfad_feld_im_request(srv):
    h, pl, idx, _ = srv
    assert post(h, "/play", {"rolle": "bd", "nr": 2, "pfad": "/etc/passwd"})[0] == 200
    assert pl.procs[0].argv[-1] == idx["bd"][2]["pfad"]


def test_senke_pruefung_pactl_parsing():
    class R:
        returncode = 0
        stdout = "50\talsa_output.a\tPipeWire\ts32le\tRUNNING\n51\tstumm\tPipeWire\ts32le\tIDLE\n"
    assert hp.pruefe_senke("stumm", run=lambda *a, **k: R())
    assert not hp.pruefe_senke("alsa", run=lambda *a, **k: R())  # kein Teilstring-Treffer

    def kaputt(*a, **k):
        raise FileNotFoundError
    assert not hp.pruefe_senke("stumm", run=kaputt)


def test_main_exit_2_bei_unbekannter_senke(tmp_path, capsys):
    _index(tmp_path)
    pl = FakePlayer()
    rc = hp.main(["--proben", str(tmp_path), "--port", "0", "--senke", "gibtsnicht"],
                 player=pl, senke_pruefer=lambda s: False)
    assert rc == 2 and "gibtsnicht" in capsys.readouterr().err and pl.procs == []


@pytest.mark.parametrize("inhalt", ["{kaputt", "[1,2]", '{"bd": "x"}', '{"bd": [1]}'])
def test_kaputte_auswahl_wird_gesichert_nicht_ueberschrieben(tmp_path, capsys, inhalt):
    _index(tmp_path)
    (tmp_path / "auswahl.json").write_text(inhalt)
    h = Hoerprobe(tmp_path, senke="s", player=FakePlayer(), port=0)
    assert h.auswahl == {}
    sich = list(tmp_path.glob("auswahl.json.kaputt-*"))
    assert len(sich) == 1 and sich[0].read_text() == inhalt
    assert not (tmp_path / "auswahl.json").exists()
    assert "kaputt" in capsys.readouterr().err


def test_waehle_antwortet_auch_wenn_schreiben_scheitert(srv):
    h, _, _, ordner = srv
    (ordner / "auswahl.tmp").mkdir()  # write_text auf ein Verzeichnis -> OSError
    st, _ = post(h, "/waehle", {"rolle": "bd", "nr": 1, "an": True})
    assert st == 500
    assert h.auswahl.get("bd", []) == []  # Speicherstand nicht vor dem Schreiben verstellt


def test_index_wird_bei_aenderung_neu_gelesen(srv):
    h, pl, idx, ordner = srv
    neu = json.loads((ordner / "index.json").read_text())
    neu["bd"][2]["pfad"] = str(ordner / "neu.wav")
    neu["bd"][2]["quelle"] = "/q/neu.wav"
    (ordner / "index.json").write_text(json.dumps(neu))
    st = (ordner / "index.json").stat()
    os.utime(ordner / "index.json", ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    d = json.loads(get(h, "/index")[1])
    assert d["index"]["bd"][2]["quelle"] == "/q/neu.wav"
    neu["bd"][2]["pfad"] = str(ordner / "neu2.wav")
    (ordner / "index.json").write_text(json.dumps(neu))
    os.utime(ordner / "index.json", ns=(st.st_atime_ns, st.st_mtime_ns + 9_000_000_000))
    ver = json.loads(get(h, "/index")[1])["version"]
    post(h, "/play", {"rolle": "bd", "nr": 2, "version": ver})
    assert pl.procs[0].argv[-1] == str(ordner / "neu2.wav")
    post(h, "/waehle", {"rolle": "bd", "nr": 2, "an": True, "version": ver})
    assert json.loads((ordner / "auswahl.json").read_text())["bd"] == ["/q/neu.wav"]


def test_kaputter_neuer_index_behaelt_alten_stand(srv):
    h, pl, idx, ordner = srv
    (ordner / "index.json").write_text("{kaputt")
    st = (ordner / "index.json").stat()
    os.utime(ordner / "index.json", ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert post(h, "/play", {"rolle": "bd", "nr": 1})[0] == 200


@pytest.mark.parametrize("kopf", ["-5", None, "abc", "999999999"])
def test_content_length_negativ_fehlend_oder_unsinnig_400(srv, kopf):
    h, pl, _, _ = srv
    c = http.client.HTTPConnection("127.0.0.1", h.port, timeout=5)
    c.putrequest("POST", "/play")
    if kopf is not None:
        c.putheader("Content-Length", kopf)
    c.endheaders()
    assert c.getresponse().status == 400
    assert pl.procs == []


# ---- Final-Review: Index-Version, verwaiste Auswahl ---------------------------
def _index_aendern(ordner, sek):
    neu = json.loads((ordner / "index.json").read_text())
    neu["bd"][2]["quelle"] = "/q/anders.wav"
    (ordner / "index.json").write_text(json.dumps(neu))
    st = (ordner / "index.json").stat()
    os.utime(ordner / "index.json", ns=(st.st_atime_ns, st.st_mtime_ns + sek * 10**9))


def test_index_liefert_version_zwoelf_zeichen_und_sie_aendert_sich(srv):
    h, _, _, ordner = srv
    v1 = json.loads(get(h, "/index")[1])["version"]
    assert len(v1) == 12 and v1 == json.loads(get(h, "/index")[1])["version"]
    _index_aendern(ordner, 5)
    assert json.loads(get(h, "/index")[1])["version"] != v1


def test_stale_version_409_bei_waehle_und_play_auswahl_unveraendert(srv):
    h, pl, _, ordner = srv
    v_alt = json.loads(get(h, "/index")[1])["version"]
    post(h, "/waehle", {"rolle": "bd", "nr": 1, "an": True, "version": v_alt})
    vorher = (ordner / "auswahl.json").read_bytes()
    _index_aendern(ordner, 5)  # Neu-Rendern zwischen /index und /waehle
    for pfad, body in (("/waehle", {"rolle": "bd", "nr": 2, "an": True}), ("/play", {"rolle": "bd", "nr": 2})):
        st, _ = post(h, pfad, dict(body, version=v_alt))
        assert st == 409
    assert (ordner / "auswahl.json").read_bytes() == vorher and pl.procs == []
    req = urllib.request.Request(f"http://127.0.0.1:{h.port}/waehle",
                                 json.dumps({"rolle": "bd", "nr": 1, "an": True, "version": v_alt}).encode())
    with pytest.raises(urllib.error.HTTPError) as ei:
        urllib.request.urlopen(req)
    assert json.loads(ei.value.read()) == {"fehler": "index_geaendert"}


def test_fehlende_version_409_negativkontrolle_passende_geht(srv):
    h, pl, _, _ = srv
    assert post(h, "/play", {"rolle": "bd", "nr": 1, "version": None})[0] == 409
    assert post(h, "/play", {"rolle": "bd", "nr": 1, "version": h.version})[0] == 200


def test_entferne_streicht_nur_quellen_aus_der_auswahl(srv):
    h, _, _, ordner = srv
    post(h, "/waehle", {"rolle": "bd", "nr": 1, "an": True})
    post(h, "/waehle", {"rolle": "bd", "nr": 2, "an": True})
    (ordner / "auswahl.json").write_text(json.dumps({"bd": ["/q/bd1.wav", "/q/bd2.wav", "/q/weg.wav"]}))
    h.auswahl = json.loads((ordner / "auswahl.json").read_text())
    assert post(h, "/entferne", {"rolle": "bd", "quelle": "/q/weg.wav"})[0] == 200
    assert json.loads((ordner / "auswahl.json").read_text()) == {"bd": ["/q/bd1.wav", "/q/bd2.wav"]}
    # Negativ: nicht in der Auswahl / falsche Rolle / falscher Typ -> 404, Datei unveraendert
    vorher = (ordner / "auswahl.json").read_bytes()
    for body in ({"rolle": "bd", "quelle": "/etc/passwd"}, {"rolle": "sd", "quelle": "/q/bd1.wav"},
                 {"rolle": "bd", "quelle": 5}, {"rolle": "bd"}):
        assert post(h, "/entferne", body)[0] == 404
    assert (ordner / "auswahl.json").read_bytes() == vorher
