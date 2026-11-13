"""Kick share of the time map: bounded 0..1, 1 for a kick on every beat, 0 for a sustained bass without kicks,
and insensitive to a beat grid that is a few ms off (the old ratio of onset means jumped between 0.6 and 20)."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "production"))
import zeitkarte as zk  # noqa: E402

SR = zk.SR
BEAT = 60.0 / 128.0


def kicks(n_beats, versatz=0.0, dauer=None):
    n = int((dauer or n_beats * BEAT + 0.5) * SR)
    x = np.zeros(n)
    for i in range(n_beats):
        a = int((i * BEAT + versatz) * SR)
        t = np.arange(min(int(0.3 * SR), n - a)) / SR
        x[a:a + len(t)] += 0.8 * np.sin(2 * np.pi * (50 + 80 * np.exp(-t * 30)) * t) * np.exp(-t * 12)
    return x


class KickShare(unittest.TestCase):
    def share(self, x, versatz=0.0, n=16):
        pw = zk.low_power(x)
        return zk.kick_share(pw, versatz + BEAT * np.arange(n))

    def test_kick_on_every_beat_is_one(self):
        self.assertEqual(self.share(kicks(16)), 1.0)

    def test_sustained_bass_without_kick_is_zero(self):
        t = np.arange(int(16 * BEAT * SR)) / SR
        self.assertEqual(self.share(0.5 * np.sin(2 * np.pi * 55 * t), versatz=BEAT, n=15), 0.0)   # not at t=0: the filter start-up is no kick

    def test_silence_is_zero(self):
        self.assertEqual(self.share(np.zeros(int(16 * BEAT * SR))), 0.0)

    def test_every_other_beat_is_half(self):
        x = kicks(16)
        for i in range(1, 16, 2):   # remove the odd beats
            x[int(i * BEAT * SR):int((i + 1) * BEAT * SR)] = 0.0
        self.assertAlmostEqual(self.share(x), 0.5, delta=0.07)

    def test_grid_a_few_ms_off_still_finds_the_kicks(self):
        for off in (-0.02, -0.01, 0.01, 0.02):
            self.assertEqual(self.share(kicks(16, versatz=0.05), versatz=0.05 + off), 1.0, off)

    def test_bounded(self):
        rng = np.random.default_rng(1)
        for x in (rng.normal(0, 0.1, 16 * SR), kicks(16) + rng.normal(0, 0.05, int(16 * BEAT * SR + 0.5 * SR))):
            self.assertTrue(0.0 <= self.share(x) <= 1.0)


if __name__ == "__main__":
    unittest.main()
