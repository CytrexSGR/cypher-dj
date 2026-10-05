"""Tests der Leitstand-Attrappe djk/vertrag/attrappe_leitstand.py (Scheibe 08) gegen einen Schein-Kern in Echtzeit.
Jeder Fehlerfall des Läufers ist gezeigt: fehlende Quittung, unerwartete Ablehnung, stumme neue Zeitachse, Toleranz,
/uhr zu einem Sample, das kein Blockanfang ist, ab_sample, Herzschlag bei schweigender Uhr; Negativ-Kontrolle: der
richtige Schein-Kern ist grün. Aufruf: python3 -m pytest djk/kern/tests/leitstand -q"""
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
sys.path.insert(0, str(HIER.parents[2] / "vertrag"))
import attrappe_leitstand as al  # noqa: E402
from fake_kern import FakeKern  # noqa: E402

Q = "pruefstand"


def folge(tmp_path: Path, zeilen: list[dict], name: str = "f") -> str:
    p = tmp_path / f"{name}.jsonl"
    p.write_text("".join(json.dumps(z) + "\n" for z in zeilen), encoding="utf-8")
    return str(p)


def rampen_folge(bpm_tol: float = 1e-6) -> list[dict]:
    """Neue Zeitachse bei 128, Rampe ab Beat 8 über 4 Beats (Start Sample 180 000), rund 5 s."""
    return [
        {"t": "sende", "sample": 0, "osc": ["/k/set/neu", ",hsd", 1, Q, 128.0]},
        {"t": "erwarte", "bis_sample": 48000, "osc": ["/q", ",hsihds", 1, Q, 1, None, None, ""]},
        {"t": "erwarte", "bis_sample": 48000, "osc": ["/q", ",hsihds", 1, Q, 2, 0, 0.0, ""], "toleranz": 1e-6},
        {"t": "erwarte", "bis_sample": 48000, "osc": ["/takt", ",iihdd", 1, 1, 0, 0.0, 128.0], "toleranz": bpm_tol},
        {"t": "sende", "sample": 90000, "osc": ["/k/tempo/rampe", ",hsddd", 2, Q, 8.0, 132.0, 4.0]},
        {"t": "erwarte", "bis_sample": 138000, "osc": ["/q", ",hsihds", 2, Q, 1, None, None, ""]},
        {"t": "erwarte", "bis_sample": 228000, "osc": ["/q", ",hsihds", 2, Q, 2, 180000, 8.0, ""], "toleranz": 1e-6},
        {"t": "erwarte", "bis_sample": 228000, "osc": ["/takt", ",iihdd", 3, 1, 180000, 8.0, 128.0],
         "toleranz": bpm_tol},
        {"t": "erwarte", "bis_sample": 280000, "osc": ["/q", ",hsihds", 2, Q, 3, None, None, ""]},
    ]


def fahre(kern: FakeKern, pfad: str, tmp_path: Path) -> tuple[int, list]:
    bericht = tmp_path / "bericht.json"
    rc = al.main([pfad, "--kern-port", str(kern.port), "--port", "0", "--bericht", str(bericht)])
    return rc, json.loads(bericht.read_text(encoding="utf-8")) if bericht.exists() else []


@pytest.fixture
def port_frei(monkeypatch):
    monkeypatch.delenv("CYPHERDJ_INSTANZ", raising=False)


def test_richtig_ist_gruen(tmp_path, port_frei):
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge()), tmp_path)
    assert rc == 0, b
    assert b[0]["quittungen"] == {"1": [1, 2], "2": [1, 2, 3]}
    # Punkt 4: der Kern sah Kennungen mit Basis (mono_ns), nicht die kleinen Zahlen der Datei
    assert all(i > 10**9 for i in k.ids) and k.ids[1] - k.ids[0] == 1


def test_fehlende_quittung_ist_rot(tmp_path, port_frei):
    with FakeKern("ohne_fertig") as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge()), tmp_path)
    assert rc == 1
    assert "nicht gekommen" in b[0]["schritte"][-1]["info"]


def test_unerwartete_ablehnung_ist_rot(tmp_path, port_frei):
    with FakeKern("extra_ablehnung") as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge()), tmp_path)
    assert rc == 1
    assert b[0]["schritte"][-1]["t"] == "ende" and "unverbraucht" in b[0]["schritte"][-1]["info"]


def test_neue_zeitachse_ohne_gestartet_ist_rot(tmp_path, port_frei):
    with FakeKern("set_neu_stumm") as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge()), tmp_path)
    assert rc == 1
    assert "keine Quittung gestartet" in b[0]["schritte"][0]["info"]


def test_toleranz(tmp_path, port_frei):
    with FakeKern("bpm_daneben") as k:  # /takt-BPM 2e-6 daneben
        rc_eng, _ = fahre(k, folge(tmp_path, rampen_folge(1e-6), "eng"), tmp_path)
        rc_weit, _ = fahre(k, folge(tmp_path, rampen_folge(1e-5), "weit"), tmp_path)
    assert (rc_eng, rc_weit) == (1, 0)


def test_protokollfehler_mit_absicht(tmp_path, port_frei):
    zeilen = rampen_folge()[:3] + [
        {"t": "sende", "sample": 9600, "osc": ["/k/gibt_es_nicht", ",hs", 2, Q], "absicht": "unbekannte_adresse"},
        {"t": "erwarte", "bis_sample": 57600, "osc": ["/e/protokollfehler", ",ss", "/k/gibt_es_nicht",
                                                     "unbekannte_adresse"]}]
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, zeilen), tmp_path)
    assert rc == 0, b
    # Gegenprobe: ohne die erwarte-Zeile bleibt der Protokollfehler unverbraucht -> rot (FORMAT.md Punkt 8)
    with FakeKern() as k:
        rc2, _ = fahre(k, folge(tmp_path, zeilen[:-1], "ohne"), tmp_path)
    assert rc2 == 1


def test_kennungen_nach_osc_json():
    felder = al.lade_feldnamen(Path(al.__file__).resolve().parent / "osc.json")
    assert al.mit_basis(["/k/storno", ",hsh", 3, Q, 2], felder, 100) == ["/k/storno", ",hsh", 103, Q, 102]
    # absichtlich falscher Typ: ziel_id als i bleibt unverschoben (FORMAT.md Punkt 4: nur Typ h)
    assert al.mit_basis(["/k/storno", ",hsi", 4, Q, 2], felder, 100) == ["/k/storno", ",hsi", 104, Q, 2]
    assert al.mit_basis(["/q", ",hsihds", 1, Q, 2, None, None, ""], felder, 100)[2] == 101


def uhr_folge(uhr_sample: int) -> list[dict]:
    """FORMAT.md Punkt 6 und 11: ein /uhr zu einem Blockanfang (Vielfaches von 256) wird erwartet wie jede Nachricht."""
    return rampen_folge()[:3] + [
        {"t": "erwarte", "bis_sample": 144000, "osc": ["/uhr", ",hhddd", uhr_sample, None, uhr_sample / 22500.0,
                                                      128.0, 0.0], "toleranz": 1e-6}]


def test_uhr_wird_erwartet(tmp_path, port_frei):
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, uhr_folge(96000)), tmp_path)
    assert rc == 0, b
    # Fehlerfall: ein /uhr zu einem Sample, das kein Blockanfang ist, kommt nie
    with FakeKern() as k:
        rc2, b2 = fahre(k, folge(tmp_path, uhr_folge(96001), "daneben"), tmp_path)
    assert rc2 == 1 and "nicht gekommen" in b2[0]["schritte"][-1]["info"]


def test_ab_sample(tmp_path, port_frei):
    """FORMAT.md Punkt 14 (Zusatz 09): /takt 1 trifft bei Sample 0 ein; ab_sample 24 000 lässt es nicht gelten."""
    takt1 = ["/takt", ",iihdd", 1, 1, 0, 0.0, 128.0]
    mit = rampen_folge()[:3] + [{"t": "erwarte", "ab_sample": 24000, "bis_sample": 48000, "osc": takt1,
                                 "toleranz": 1e-6}]
    ohne = rampen_folge()[:3] + [{"t": "erwarte", "ab_sample": 0, "bis_sample": 48000, "osc": takt1,
                                  "toleranz": 1e-6}]
    with FakeKern() as k:
        rc_mit, _ = fahre(k, folge(tmp_path, mit, "mit"), tmp_path)
        rc_ohne, _ = fahre(k, folge(tmp_path, ohne, "ohne"), tmp_path)
    assert (rc_mit, rc_ohne) == (1, 0)


def test_herzschlag_wenn_uhr_schweigt(tmp_path, port_frei):
    """§16.3: kommt 100 ms kein /uhr, schickt der Läufer /k/hallo sofort und dann alle 50 ms (0,5 s Pause: rund 8)."""
    zeilen = rampen_folge()[:3] + [{"t": "erwarte", "bis_sample": 96000, "osc": ["/uhr", ",hhddd", 72192, None, None,
                                                                                128.0, 0.0]}]
    with FakeKern("uhr_pause") as k:
        rc, b = fahre(k, folge(tmp_path, zeilen), tmp_path)
    assert rc == 0, b
    assert 5 <= k.hallos_in_pause <= 10, k.hallos_in_pause
    # Negativ-Kontrolle: ohne Pause nur Anmeldung und Herzschlag je Sekunde (Folge rund 2 s: höchstens 4)
    with FakeKern() as k2:
        t0 = time.monotonic()
        rc2, _ = fahre(k2, folge(tmp_path, zeilen, "ruhig"), tmp_path)
        dauer = time.monotonic() - t0
    assert rc2 == 0 and k2.hallos <= int(dauer) + 2, (k2.hallos, dauer)


def test_erwarte_nicht(tmp_path, port_frei):
    """FORMAT.md Punkt 13 (Scheibe 09): im Fenster trifft keine passende Nachricht ein, verbraucht oder nicht.
    Fehlerfall: der Schein-Kern meldet fertig (3) für Rampe 2, die Folge verbietet es -> rot. Negativ-Kontrolle:
    verboten ist nur eine Ablehnung (6), die nie kommt -> grün."""
    verbot = {"t": "erwarte_nicht", "ab_sample": 228000, "bis_sample": 290000,
              "osc": ["/q", ",hsihds", 2, Q, 3, None, None, ""]}
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge() + [verbot], "rot"), tmp_path)
    assert rc == 1, b
    assert b[0]["schritte"][-1]["t"] == "erwarte_nicht" and not b[0]["schritte"][-1]["ok"]
    harmlos = dict(verbot, osc=["/q", ",hsihds", 2, Q, 6, None, None, ""])
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge() + [harmlos], "gruen"), tmp_path)
    assert rc == 0, b


# ---- Nachrüstung für die Folgen von 09 (Plan 13, Nachtrag B8; Befunde B6, B7) ----

def kopf() -> list[dict]:
    """Neue Zeitachse bei 128 BPM mit ihren Quittungen (FORMAT.md Punkt 2)."""
    return rampen_folge()[:3]


def test_reihenfolge_handlung_nicht_hinter_spaeterer_erwartung(tmp_path, port_frei):
    """B7: eine erwarte-Zeile für Sample 144 128 vor einer sende-Zeile bei 90 000 (FORMAT.md Punkt 6 und 15 ordnen nur
    die Handlungen). Wartet der Läufer an der Erwartung, geht die Rampe erst bei 144 128 hinaus (der Schein-Kern zählt
    das Eintreffen auf seiner Uhr) und ihre Quittung 1 verfehlt [90 000, 92 400]. Fehlerfall: ein Fenster, das vor dem
    Senden endet ([0, 89 000]), ist rot (FORMAT.md Punkt 6: eintreffen, bevor die Kern-Uhr S überschreitet)."""
    uhr = {"t": "erwarte", "bis_sample": 150000, "osc": ["/uhr", ",hhddd", 144128, None, 144128 / 22500.0, 128.0, 0.0],
           "toleranz": 1e-6}
    rampe = {"t": "sende", "sample": 90000, "osc": ["/k/tempo/rampe", ",hsddd", 2, Q, 8.0, 132.0, 4.0]}
    q1 = {"t": "erwarte", "ab_sample": 90000, "bis_sample": 92400, "osc": ["/q", ",hsihds", 2, Q, 1, None, None, ""]}
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, kopf() + [uhr, rampe, q1], "b7"), tmp_path)
        an = [s for a, s in k.empfangen if a == "/k/tempo/rampe"]
    assert len(an) == 1 and 90000 <= an[0] < 92400, an
    assert rc == 0, b
    zu_frueh = dict(q1, ab_sample=0, bis_sample=89000)
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, kopf() + [uhr, rampe, zu_frueh], "b7_rot"), tmp_path)
    assert rc == 1, b


def test_wert_lesung(tmp_path, port_frei):
    """B6: /e/regler meldet nur bei Änderung. Ein Setzen (Sprung bei 96 000) wird nicht überbrückt, ein nie gemeldeter
    Regler hat die Vorgabe aus §1.5, zwischen Meldungen im 960er-Takt einer Rampe gilt linear. Fehlerfall: der Wert des
    Sprungs schon vor dem Sprung erwartet ist rot."""
    w = lambda s, p, v, tol: {"t": "wert", "sample": s, "pfad": p, "wert": v, "toleranz": tol}
    zeilen = kopf() + [w(95000, "deck/2/fader", -200.0, 0.0), w(50000, "deck/2/eq/mitte", 0.0, 0.0),
                       w(120480, "deck/2/fader", -7.35, 1e-3)]
    with FakeKern("regler") as k:
        rc, b = fahre(k, folge(tmp_path, zeilen, "b6"), tmp_path)
    assert rc == 0, b
    with FakeKern("regler") as k:
        rc, b = fahre(k, folge(tmp_path, kopf() + [w(95000, "deck/2/fader", -15.0, 0.01)], "b6_rot"), tmp_path)
    assert rc == 1, b
    assert [s for s in b[0]["schritte"] if not s["ok"]][0]["zeile"] == 4


def test_erlaube(tmp_path, port_frei):
    """FORMAT.md Punkt 16 erlaube: eine /e/invariante beim Rampenstart ist erlaubt und zählt nicht nach Punkt 8.
    Fehlerfall: ohne erlaube-Zeile oder mit einem Fenster, das sie nicht deckt, bleibt sie unverbraucht -> rot."""
    erlaube = {"t": "erlaube", "ab_sample": 178000, "bis_sample": 230000, "herleitung": "Test",
               "osc": ["/e/invariante", ",ssihd", "hoerschein", None, None, None, None]}
    with FakeKern("extra_invariante") as k:
        rc, b = fahre(k, folge(tmp_path, rampen_folge() + [erlaube], "mit"), tmp_path)
    assert rc == 0, b
    with FakeKern("extra_invariante") as k:
        rc_ohne, _ = fahre(k, folge(tmp_path, rampen_folge(), "ohne"), tmp_path)
        rc_daneben, _ = fahre(k, folge(tmp_path, rampen_folge() + [dict(erlaube, ab_sample=0, bis_sample=1000)],
                                       "daneben"), tmp_path)
    assert (rc_ohne, rc_daneben) == (1, 1)


def test_buendel(tmp_path, port_frei):
    """FORMAT.md Punkt 16 buendel: OSC-Bündel mit Zeitmarke 1 (§4.8), t_send_us 0. Fehlerfall: falsche Zahl eingefügt."""
    ev = lambda n, b: ["/erz/ev", ",iiiiddf", 1, 7, n, 36, b, 0.25, 1.0]
    buendel = {"t": "buendel", "sample": 48000, "nachrichten": [["/erz/fenster", ",iiiiddh", 1, 1, 66, 0, 4.0, 8.0, 0],
                                                                ev(100, 4.0), ev(101, 5.0), ev(102, 6.0), ev(103, 7.0)]}
    quittung = {"t": "erwarte", "ab_sample": 48000, "bis_sample": 50400,
                "osc": ["/erz/quittung", ",iiiiiii", 1, 1, 0, 0, 4, 0, 0]}
    with FakeKern() as k:
        rc, b = fahre(k, folge(tmp_path, kopf() + [buendel, quittung], "b"), tmp_path)
        gesehen = list(k.buendel)
    assert rc == 0, b
    assert len(gesehen) == 1 and gesehen[0][0] == 1 and len(gesehen[0][1]) == 5 and gesehen[0][1][0][2][6] == 0
    falsch = dict(quittung, osc=["/erz/quittung", ",iiiiiii", 1, 1, 0, 0, 5, 0, 0])
    with FakeKern() as k:
        rc, _ = fahre(k, folge(tmp_path, kopf() + [buendel, falsch], "b_rot"), tmp_path)
    assert rc == 1


def test_deck_wert(tmp_path, port_frei):
    """FORMAT.md Punkt 16 deck_wert: aus /zustand/deck (50 Hz), bezogen auf den Blockanfang des /uhr davor (B4),
    zwischen zwei Meldungen linear, status die letzte davor. Fehlerfall: falscher quell_beat."""
    d = lambda s, f, v, tol: {"t": "deck_wert", "sample": s, "deck": 1, "feld": f, "wert": v, "toleranz": tol}
    zeilen = kopf() + [d(100000, "quell_beat", 100000 / 22500, 1e-3), d(100000, "status", 2, 0),
                       d(100000, "beats_bis_ende", 100 - 100000 / 22500, 1e-3), d(100000, "faktor", 1.0, 0)]
    with FakeKern("deck") as k:
        rc, b = fahre(k, folge(tmp_path, zeilen, "d"), tmp_path)
    assert rc == 0, b
    with FakeKern("deck") as k:
        rc, _ = fahre(k, folge(tmp_path, kopf() + [d(100000, "quell_beat", 5.0, 1e-3)], "d_rot"), tmp_path)
    assert rc == 1


def frei(port: int) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def kern_prozess(tmp_path: Path, fehler: str = "") -> tuple[subprocess.Popen, int]:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    argv = [sys.executable, str(HIER / "fake_kern.py"), "--port", str(port), "--zustand", str(tmp_path / "z.json"),
            "--frisch"] + (["--fehler", fehler] if fehler else [])
    p = subprocess.Popen(argv, stdout=subprocess.PIPE, text=True)
    assert p.stdout.readline().startswith("port="), "Schein-Kern nicht gestartet"
    return p, port


def neustart_folge() -> list[dict]:
    return kopf() + [
        {"t": "aktion", "sample": 72000, "was": "kern_kill9"},
        {"t": "erwarte", "ab_sample": 72000, "bis_sample": 84000, "osc": ["/e/neustart", ",ih", 1, None]},
        {"t": "erwarte", "ab_sample": 72000, "bis_sample": 120000,
         "osc": ["/k/willkommen", ",iihdds", 1, 1, None, None, None, None]},
        {"t": "erwarte", "ab_sample": 120000, "bis_sample": 130000, "osc": ["/uhr", ",hhddd", None, None, None, 128.0, 0.0]}]


def test_aktion_kern_kill9(tmp_path, port_frei):
    """FORMAT.md Punkt 16 aktion kern_kill9: der Läufer (Prüfstand) tötet den Kern mit SIGKILL und startet ihn ohne
    --frisch neu; der Kern setzt auf dem Anker fort (Generation 1, /e/neustart, willkommen auf den Herzschlag).
    Nach dem Lauf hält kein Kern mehr den Port (keine Waise). Fehlerfall: Neustart ohne neue Generation -> rot."""
    p, port = kern_prozess(tmp_path)
    try:
        rc, b = fahre_port(port, folge(tmp_path, neustart_folge(), "neu"), tmp_path)
    finally:
        p.kill()
        p.wait()
    assert p.returncode == -9, "der Läufer hat den Kern nicht mit SIGKILL beendet"
    assert rc == 0, b
    assert frei(port), "neu gestarteter Kern läuft nach dem Lauf weiter"
    p, port = kern_prozess(tmp_path / "..", "ohne_neustart")
    try:
        rc, b = fahre_port(port, folge(tmp_path, neustart_folge(), "neu_rot"), tmp_path)
    finally:
        p.kill()
        p.wait()
    assert rc == 1, b
    assert frei(port)


def fahre_port(port: int, pfad: str, tmp_path: Path) -> tuple[int, list]:
    bericht = tmp_path / "bericht.json"
    bericht.unlink(missing_ok=True)
    rc = al.main([pfad, "--kern-port", str(port), "--port", "0", "--bericht", str(bericht)])
    return rc, json.loads(bericht.read_text(encoding="utf-8")) if bericht.exists() else []
