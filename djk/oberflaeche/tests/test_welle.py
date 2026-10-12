import struct
import subprocess
import sys
from pathlib import Path

import numpy as np

HIER = Path(__file__).resolve().parent.parent
SR = 48000


def schreibe(pfad, mono):
    st = np.repeat(mono.astype(np.float32)[:, None], 2, axis=1)
    st.tofile(pfad)


def rechne(tmp_path, mono):
    q, z = tmp_path / "a.f32", tmp_path / "a.welle"
    schreibe(q, mono)
    subprocess.run([sys.executable, str(HIER / "welle.py"), str(q), str(z)], check=True)
    b = z.read_bytes()
    magic, version, hop, spalten = struct.unpack("<4sIII", b[:16])
    return magic, version, hop, spalten, np.frombuffer(b[16:], np.uint8).reshape(spalten, 4)


def sinus(hz, sek=2.0, amp=0.5):
    t = np.arange(int(SR * sek)) / SR
    return amp * np.sin(2 * np.pi * hz * t)


def test_kopf_und_spaltenzahl(tmp_path):
    magic, version, hop, spalten, w = rechne(tmp_path, sinus(1000))
    assert (magic, version, hop) == (b"DJKW", 1, 256)
    assert spalten == int(SR * 2.0) // 256


def test_tiefer_ton_faellt_ins_tiefe_band(tmp_path):
    *_, w = rechne(tmp_path, sinus(80))
    mitte = w[len(w) // 4: 3 * len(w) // 4]
    assert mitte[:, 1].mean() > 4 * max(mitte[:, 2].mean(), mitte[:, 3].mean(), 1)


def test_hoher_ton_faellt_ins_hohe_band(tmp_path):
    *_, w = rechne(tmp_path, sinus(6000))
    mitte = w[len(w) // 4: 3 * len(w) // 4]
    assert mitte[:, 3].mean() > 4 * max(mitte[:, 1].mean(), mitte[:, 2].mean(), 1)


def test_stille_bleibt_null_und_spitze_folgt_der_amplitude(tmp_path):
    x = np.concatenate([np.zeros(SR), sinus(1000, 1.0, 1.0)])
    *_, w = rechne(tmp_path, x)
    assert w[: SR // 256 - 4, :].max() == 0          # Negativ-Kontrolle: Stille ist 0 in allen Bytes
    assert w[SR // 256 + 4:, 0].min() >= 250          # lauteste Stelle der Datei → Spitze fast 255


# ---- S5-Review B1: streamend (ffmpeg → stdin, konstanter Speicher, keine Zwischendatei) ----
import io

sys.path.insert(0, str(HIER))
import welle  # noqa: E402

RATE = 12000   # Strom-Modus: mono f32 bei 12 kHz, Hop 64 = 256 bei 48 kHz (gleiche Zeitauflösung)


def strom(mono, chunk):
    return welle.rechne_strom(io.BytesIO(mono.astype(np.float32).tobytes()), RATE, chunk)


def test_strom_spaltenzahl_und_baender():
    t = np.arange(RATE * 2) / RATE
    w = strom(0.5 * np.sin(2 * np.pi * 100 * t), 1 << 16)
    assert len(w) == (RATE * 2) // 64
    assert w[10:-10, 1].mean() > 100 and w[10:-10, 3].mean() < 5, "100 Hz: Bass, keine Höhen"
    w = strom(0.5 * np.sin(2 * np.pi * 4000 * t), 1 << 16)
    assert w[10:-10, 3].mean() > 100 and w[10:-10, 1].mean() < 5, "4 kHz: Höhen, kein Bass"
    assert w[:, 0].max() == 255, "Spitze auf das Maximum der Datei normiert"


def test_strom_unabhaengig_von_der_blockgroesse():
    rng = np.random.default_rng(1)
    x = (rng.standard_normal(RATE * 3) * 0.1).astype(np.float32)
    a, b, c = strom(x, 1 << 20), strom(x, 1001), strom(x, 64)
    assert a.shape == b.shape == c.shape
    assert np.array_equal(a, b) and np.array_equal(a, c), "Blockgrenzen ändern kein Byte"


def test_strom_leer_und_kurz():
    assert len(strom(np.zeros(0), 4096)) == 0
    assert len(strom(np.zeros(63), 4096)) == 0
    assert len(strom(np.ones(64) * 0.1, 4096)) == 1


def test_strom_cli_schreibt_kopf_mit_hop_256(tmp_path):
    z = tmp_path / "s.welle"
    x = (0.3 * np.sin(2 * np.pi * 300 * np.arange(RATE) / RATE)).astype(np.float32)
    subprocess.run([sys.executable, str(HIER / "welle.py"), "--strom", str(RATE), str(z)], input=x.tobytes(), check=True)
    magic, version, hop, spalten = struct.unpack("<4sIII", z.read_bytes()[:16])
    assert (magic, version, hop, spalten) == (b"DJKW", 1, 256, RATE // 64)
