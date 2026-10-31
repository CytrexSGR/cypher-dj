"""Prüfung von stems_last_lauf.sh OHNE Kern und ohne demucs: das Skript läuft in einem Attrappen-Baum (Stub für Kern-Lauf, PY und Schloss-Datei im
tmp_path), nie am echten Schloss der Maschine."""
import fcntl
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

import pytest

HIER = Path(__file__).resolve().parent
SKRIPT = HIER / "stems_last_lauf.sh"
MIN_BYTES = 120 * 48000 * 8

PY_STUB = """#!/usr/bin/env bash
echo x >> "$STUB_ZAEHLER"
[ "$1" = "-c" ] && exit "${STUB_IMPORT_RC:-0}"
echo "omp=${OMP_NUM_THREADS-UNSET} cuda=[${CUDA_VISIBLE_DEVICES-UNSET}]" >> "${STUB_ENV:-/dev/null}"
sleep "${STUB_PY_SLEEP:-0.2}"
if [ "${STUB_PY_RC:-0}" != 0 ]; then echo '{"status": "fehler", "grund": "stub"}'; exit "$STUB_PY_RC"; fi
echo '{"status": "ok", "frames": 5760000, "von": "'"$STUB_MARKE"'"}'
"""
BOXEN_STUB = """import argparse, json, os, time
from pathlib import Path
ap = argparse.ArgumentParser()
for n in ("--fall", "--boxen", "--lauf", "--minuten", "--kern"):
    ap.add_argument(n)
a = ap.parse_args()
time.sleep(float(os.environ.get("STUB_KERN_SLEEP", "0.5")))
if os.environ.get("STUB_NODIR"):
    raise SystemExit(2)   # Kern-Lauf stirbt vor dem Anlegen seines Ordners
d = Path(__file__).parent / "laeufe" / (a.lauf + "-20261030-000000")
d.mkdir(parents=True)
(d / "ergebnis.json").write_text(json.dumps({"lauf": a.lauf}))
(d / "pwtop.txt").write_text("R 1 256 48000 4.3us 474.0us 0 0 0 + cypherdj-kern-c\\n")
raise SystemExit(int(os.environ.get("STUB_RC", "0")))
"""


@pytest.fixture
def baum(tmp_path):
    deck = tmp_path / "djk" / "kern" / "tests" / "deck"
    deck.mkdir(parents=True)
    (tmp_path / "djk" / "konfig").mkdir()
    (tmp_path / "djk" / "konfig" / "echtzeit_schloss.sh").write_text("export CYPHERDJ_ECHTZEIT_SCHLOSS\n")
    (tmp_path / "djk" / "werkstatt").mkdir()
    shutil.copy(SKRIPT, deck / "stems_last_lauf.sh")
    (deck / "ziel_lauf.py").write_text('subprocess.Popen(["pw-jack", "-p", "256", *args])\n')
    (deck / "ziel_lauf_boxen.py").write_text(BOXEN_STUB)
    py = tmp_path / "py"
    py.write_text(PY_STUB)
    py.chmod(0o755)
    kern = tmp_path / "kern"
    kern.write_text("#!/bin/sh\n")
    kern.chmod(0o755)
    quelle = tmp_path / "quelle.f32"
    with open(quelle, "wb") as f:
        f.truncate(MIN_BYTES)
    return {"deck": deck, "tmp": tmp_path, "py": py, "kern": kern, "quelle": quelle, "lock": tmp_path / "schloss.lock", "aus": tmp_path / "aus",
            "zaehler": tmp_path / "zaehler"}


def umgebung(b, **extra):
    e = {k: v for k, v in os.environ.items() if not k.startswith("STUB_")}
    e.update(CYPHERDJ_INSTANZ="c", CYPHERDJ_ECHTZEIT_SCHLOSS=str(b["lock"]), PY=str(b["py"]), KERN=str(b["kern"]), QUELLE=str(b["quelle"]),
             STUB_ZAEHLER=str(b["zaehler"]), STUB_MARKE="lauf", SCHLOSS_WARTE_S="1")
    e.update({k: str(v) for k, v in extra.items()})
    return e


def starte(b, name="n", modus="mit", **extra):
    return subprocess.run(["bash", str(b["deck"] / "stems_last_lauf.sh"), name, modus, "0", str(b["aus"])], env=umgebung(b, **extra),
                          capture_output=True, text=True, timeout=60)


def zaehle(b):
    return len(b["zaehler"].read_text().splitlines()) if b["zaehler"].exists() else 0


def halte_schloss(b):
    f = open(b["lock"], "w")
    fcntl.flock(f, fcntl.LOCK_EX)
    return f


def test_falsches_py_endet_mit_4_vor_dem_schloss(baum):
    f = halte_schloss(baum)   # wer vor dem Schloss prüft, endet mit 4; wer erst wartet, endet nach 1 s mit 3
    r = starte(baum, PY="/nichts/python")
    assert r.returncode == 4 and "PY nicht ausführbar" in r.stderr, (r.returncode, r.stderr)
    r = starte(baum, STUB_IMPORT_RC=1)
    assert r.returncode == 4 and "import werkstatt.stems" in r.stderr, (r.returncode, r.stderr)
    f.close()


def test_kurze_quelle_endet_mit_4(baum):
    f = halte_schloss(baum)
    with open(baum["quelle"], "wb") as q:
        q.truncate(MIN_BYTES - 1)
    r = starte(baum)
    assert r.returncode == 4 and "kürzer als 120 s" in r.stderr, (r.returncode, r.stderr)
    f.close()


def test_schloss_gehalten_ergibt_3_positivkontrolle_4_vs_3(baum):
    f = halte_schloss(baum)
    assert starte(baum).returncode == 3
    f.close()
    assert starte(baum).returncode == 0   # gleiche Eingaben bei freiem Schloss laufen durch


def test_zwei_laeufe_gleichen_namens_mischen_sich_nicht(baum):
    r1 = starte(baum, STUB_MARKE="eins", STUB_KERN_SLEEP=1)
    assert r1.returncode == 0, r1.stderr
    n1 = zaehle(baum)
    r2 = starte(baum, STUB_PY_RC=1, STUB_KERN_SLEEP=6, STUB_RC=2)   # Last scheitert, der Kern-Lauf endet mit 2
    assert r2.returncode == 2, r2.stderr
    ordner = sorted(baum["aus"].iterdir())
    assert len(ordner) == 2
    alt, neu = sorted(ordner, key=lambda p: (p / "meta.txt").read_text().split("start=")[1])
    assert '"von": "eins"' in (alt / "stems.jsonl").read_text()
    s2 = (neu / "stems.jsonl").read_text()
    assert '"ok"' not in s2 and "schleife_abbruch_3_fehler_in_folge" in s2, s2
    m2 = (neu / "meta.txt").read_text()
    assert f"stemslast-{neu.name}-" in m2 and "stemslast-" + alt.name not in m2
    assert '"lauf": "stemslast-' + neu.name + '"' in (neu / "ergebnis.json").read_text()
    assert "rueckgabe_kern=2" in m2
    # Bremse: genau 3 Fehlversuche (plus 1 Import-Vorprüfung je Lauf), kein Sturm
    assert zaehle(baum) - n1 == 1 + 3


def test_schleife_endet_wenn_das_skript_mit_sigkill_stirbt(baum):
    p = subprocess.Popen(["bash", str(baum["deck"] / "stems_last_lauf.sh"), "n", "mit", "5", str(baum["aus"])],
                         env=umgebung(baum, STUB_KERN_SLEEP=30, STUB_PY_SLEEP=0.3, SCHLOSS_WARTE_S=5), start_new_session=True)
    try:
        t0 = time.time()
        while zaehle(baum) < 3 and time.time() - t0 < 20:
            time.sleep(0.2)
        assert zaehle(baum) >= 3, "Schleife lief nicht an"
        os.kill(p.pid, signal.SIGKILL)
        p.wait()   # abholen: ein Zombie besteht `kill -0` weiter (im echten Aufruf holt ihn die Shell ab)
        time.sleep(2)
        n = zaehle(baum)
        time.sleep(2)
        assert zaehle(baum) == n, "Schleife läuft nach SIGKILL des Skripts weiter"
    finally:
        try:
            os.killpg(p.pid, signal.SIGKILL)   # Attrappen-Kern und Reste
        except ProcessLookupError:
            pass
        p.wait()


def test_ohne_modus_braucht_kein_py(baum):
    f = halte_schloss(baum)
    r = starte(baum, modus="ohne", PY="/nichts/python", QUELLE="/nichts")
    assert r.returncode == 3, r.stderr   # kommt bis zum Schloss
    f.close()


def test_stirbt_der_kern_lauf_ohne_ordner_wird_kein_alter_ordner_gebunden(baum):
    assert starte(baum, STUB_KERN_SLEEP=0.5).returncode == 0
    r = starte(baum, STUB_NODIR=1)
    assert r.returncode == 2
    neu = max(baum["aus"].iterdir(), key=lambda p: p.stat().st_mtime)
    assert not (neu / "ergebnis.json").exists() and "kern_lauf=" not in (neu / "meta.txt").read_text()


def test_kind_bekommt_wie_beim_server_omp_4_und_keine_gpu(baum):
    """Nachzug F7: stems_lauf.ts setzt OMP_NUM_THREADS=4 und CUDA_VISIBLE_DEVICES leer; die Last muss das Kind genauso starten (auch gegen eine
    fremde Umgebung: OMP_NUM_THREADS=16 und CUDA_VISIBLE_DEVICES=0 im Aufrufer)."""
    env = baum["tmp"] / "env.txt"
    r = starte(baum, STUB_ENV=env, OMP_NUM_THREADS=16, CUDA_VISIBLE_DEVICES=0)
    assert r.returncode == 0, r.stderr
    zeilen = set(env.read_text().splitlines())
    assert zeilen == {"omp=4 cuda=[]"}, zeilen
