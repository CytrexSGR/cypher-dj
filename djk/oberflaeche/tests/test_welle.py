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
