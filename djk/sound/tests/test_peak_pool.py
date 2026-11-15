"""spitze_pool: lists the single-hit files of a pool folder whose peak lies within the rule, measured from the onset."""
import json

import numpy as np

from sound import peak_pool as spitze_pool, wav

SR = 48000


def krach(spitze_ms, sek=0.6):
    """A noise burst that rises to its peak `spitze_ms` after its start and decays: one hit."""
    n = int(SR * sek)
    t = np.arange(n) / SR * 1000
    huelle = np.where(t < spitze_ms, 0.05 + 0.95 * t / max(spitze_ms, 0.1), np.exp(-(t - spitze_ms) / 120.0))
    rng = np.random.default_rng(1)
    x = (rng.uniform(-1, 1, n) * huelle).astype(np.float32)
    x[int(SR * spitze_ms / 1000)] = 1.0
    return x[:, None]


def test_listet_nur_dateien_innerhalb_der_regel(tmp_path):
    for ms in (5, 25, 60):
        wav.schreibe(tmp_path / "Drums" / "Cymbal" / f"Crash X {ms}.wav", krach(ms), SR)
    wav.schreibe(tmp_path / "Drums" / "Cymbal" / "Ride X 5.wav", krach(5), SR)
    aus = tmp_path / "pool.json"
    assert spitze_pool.main(["--wurzel", str(tmp_path / "Drums"), "--ordner", "Cymbal", "--enthaelt", "crash", "--max-ms", "20", "--aus", str(aus)]) == 0
    liste = json.loads(aus.read_text())
    assert [d["dateiname"] for d in liste] == ["Crash X 5.wav"]
    assert liste[0]["spitze_ms"] < 20 and liste[0]["klingt_s"] > 0


def test_sortiert_nach_spitze_und_unlesbarer_ordner_ist_exit_2(tmp_path):
    for ms in (12, 3):
        wav.schreibe(tmp_path / "D" / "C" / f"Crash {ms}.wav", krach(ms), SR)
    aus = tmp_path / "p.json"
    assert spitze_pool.main(["--wurzel", str(tmp_path / "D"), "--ordner", "C", "--enthaelt", "crash", "--max-ms", "20", "--aus", str(aus)]) == 0
    assert [d["dateiname"] for d in json.loads(aus.read_text())] == ["Crash 3.wav", "Crash 12.wav"]
    assert spitze_pool.main(["--wurzel", str(tmp_path / "nix"), "--ordner", "C", "--enthaelt", "crash", "--max-ms", "20", "--aus", str(aus)]) == 2
