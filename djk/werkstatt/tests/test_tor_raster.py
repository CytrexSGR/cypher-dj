"""Paket 1.13 Warp, Slice 3a (AK18): das Tor raster. Eichung an bekannter Wahrheit, bevor es einen echten Track misst (Messen vor Behaupten):
starres Raster → Rest klein; Jitter ±25 ms → reißt; schwächere Zwischenschläge stören nicht; zu wenige Anschläge → nicht ok (kein stiller Erfolg)."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

from werkstatt import tor_raster

HIER = Path(__file__).resolve().parent.parent
SR = 48000
BPM = 128.0
P = 60.0 / BPM


def kick(amp):
    t = np.arange(int(0.25 * SR)) / SR
    return amp * np.sin(2 * np.pi * np.cumsum(50 + 100 * np.exp(-t / 0.03)) / SR) * np.exp(-t / 0.12)


def spur(zeiten, dauer_s, amp=0.9):
    x = np.zeros(int(dauer_s * SR))
    k = kick(amp)
    for s in zeiten:
        a = int(round(s * SR))
        e = min(len(x), a + len(k))
        if 0 <= a < len(x):
            x[a:e] += k[:e - a]
    return x


def test_starres_raster_ist_ok_und_klein():
    x = spur(0.3 + np.arange(100) * P, 100 * P + 1)
    r = tor_raster.messe(x, BPM)
    assert r["anschlaege"] >= 64 and r["ok"] is True and r["wert_ms"] < 2.0, r
    assert r["grenze_ms"] == 8.0


def test_jitter_reisst_das_tor():
    z = 0.3 + np.arange(100) * P + np.random.default_rng(7).uniform(-0.025, 0.025, 100)
    r = tor_raster.messe(spur(z, 100 * P + 1), BPM)
    assert r["anschlaege"] >= 64 and r["wert_ms"] > 8.0 and r["ok"] is False, r


def test_driftende_quelle_gegen_starres_raster_reisst():
    """Gegenprobe zur ersten: ein Track, dessen Tempo um 3 % schwankt, liegt gegen ein starres Raster weit daneben."""
    z = 0.3 + np.cumsum(np.full(100, P) * (1 + 0.03 * np.sin(np.arange(100) / 9.0)))
    r = tor_raster.messe(spur(z, float(z[-1]) + 1), BPM)
    assert r["ok"] is False and r["wert_ms"] > 8.0, r


def test_schwaechere_zwischenschlaege_stoeren_nicht():
    kicks = 0.3 + np.arange(100) * P
    x = spur(kicks, 100 * P + 1, 0.9) + spur(kicks + P / 2, 100 * P + 1, 0.3)    # Bassnoten halb so laut auf dem halben Schlag
    r = tor_raster.messe(x, BPM)
    assert r["ok"] is True and r["wert_ms"] < 2.0 and r["anschlaege"] >= 64, r
    assert r["kandidaten"] > r["anschlaege"], "die Zwischenschläge wurden gesehen und ausgeschlossen"


def test_zu_wenige_anschlaege_sind_nicht_ok_auch_bei_kleinem_rest():
    r = tor_raster.messe(spur(0.3 + np.arange(30) * P, 30 * P + 1), BPM)
    assert r["anschlaege"] < 64 and r["ok"] is False and r["wert_ms"] < 2.0, r


def test_stille_ist_kein_erfolg():
    r = tor_raster.messe(np.zeros(SR * 10), BPM)
    assert r["ok"] is False and r["anschlaege"] == 0 and r["wert_ms"] is None, r


def test_kommandozeile_eine_json_zeile(tmp_path):
    f = tmp_path / "r.wav"
    sf.write(str(f), np.stack([spur(0.3 + np.arange(100) * P, 100 * P + 1)] * 2, 1).astype(np.float32), SR, subtype="FLOAT")
    p = subprocess.run([sys.executable, "-m", "werkstatt.tor_raster", "--wav", str(f), "--bpm", "128"], cwd=HIER, capture_output=True, text=True)
    z = p.stdout.strip().splitlines()
    assert p.returncode == 0 and len(z) == 1, (p.returncode, p.stdout, p.stderr)
    assert json.loads(z[0])["ok"] is True
    q = subprocess.run([sys.executable, "-m", "werkstatt.tor_raster", "--wav", str(f), "--bpm", "128", "--von-s", "0", "--bis-s", "10"], cwd=HIER, capture_output=True, text=True)
    assert json.loads(q.stdout)["anschlaege"] < 64, "ein Ausschnitt von 10 s hat weniger als 64 Kicks"
