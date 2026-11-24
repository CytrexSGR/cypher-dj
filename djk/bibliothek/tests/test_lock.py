"""Browser plan 1 review: one build at a time per catalogue across processes (flock next to the target). Temp trees only."""
from __future__ import annotations

import fcntl
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from bibliothek.catalog_build import baum_marke
from bibliothek.config import Konfig, Wurzel
from bibliothek.tests.test_catalog_build import wav_bytes

DJK = Path(__file__).resolve().parents[2]


@pytest.fixture
def umgebung(tmp_path):
    musik = tmp_path / "musik"
    musik.mkdir()
    for i in range(40):
        (musik / f"s{i:02d}.wav").write_bytes(wav_bytes(i))
    ziel = tmp_path / "kat" / "katalog.sqlite"
    env = {**os.environ, "CYPHERDJ_KATALOG": str(ziel), "CYPHERDJ_BIBLIOTHEK_CACHE": str(tmp_path / "cache.sqlite"),
           "CYPHERDJ_BIBLIOTHEK_KONFIG": str(tmp_path / "bib.json"), "HOME": str(tmp_path), "PYTHONPATH": str(DJK)}
    r = subprocess.run([sys.executable, "-m", "bibliothek", "dazu", str(musik)], capture_output=True, text=True, env=env, cwd=DJK)
    assert r.returncode == 0, r.stderr
    return ziel, env, musik


def starte(env, *args):
    return subprocess.Popen([sys.executable, "-m", "bibliothek", "bauen", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, cwd=DJK)


def test_a_build_waits_for_the_lock_and_then_runs(umgebung):
    ziel, env, _ = umgebung
    ziel.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(ziel.parent / f".{ziel.name}.lock", os.O_CREAT | os.O_RDWR)
    fcntl.flock(fd, fcntl.LOCK_EX)
    p = starte(env)
    try:
        time.sleep(1.5)
        assert p.poll() is None, "the build must wait while another process holds the lock"
        assert not ziel.exists()
    finally:
        os.close(fd)
    out, err = p.communicate(timeout=60)
    assert p.returncode == 0, err
    assert ziel.exists()


def test_two_concurrent_builds_both_end_with_rc_0_never_rc_3(umgebung):
    ziel, env, _ = umgebung
    a, b = starte(env), starte(env)
    ea, eb = a.communicate(timeout=120)[1], b.communicate(timeout=120)[1]
    assert (a.returncode, b.returncode) == (0, 0), (ea, eb)


def test_baum_marke_ignores_hidden_folders(tmp_path):
    w = tmp_path / "m"
    (w / "sichtbar").mkdir(parents=True)
    (w / ".versteckt").mkdir()
    k = Konfig(1, [Wurzel(w, "auto")])
    vorher = baum_marke(k)
    (w / ".versteckt" / "x.wav").write_bytes(wav_bytes(1))
    os.utime(w / ".versteckt", ns=(1, 3_000_000_000))
    (w / ".versteckt" / "tief").mkdir()
    assert baum_marke(k) == vorher
    os.utime(w / "sichtbar", ns=(1, 4_000_000_000))
    assert baum_marke(k) != vorher
