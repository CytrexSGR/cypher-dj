# Test of ak33_quelle.py with synthetic taps: a noise "export", a ring tap and two captures, with a dropped or a duplicated 256 frame quantum put in on purpose.
# Cases: all clean (negative control: no slip, CLEAN), one capture drops a quantum (-> ONE pw-record PROCESS), both captures drop one at the same place (-> SHARED PATH),
# the ring drops one (-> CORE), a single capture only (-> BEHIND THE KERN), a duplicated quantum (+256). The mutation test switches the local search off (SUCH = 1)
# and must turn the drop case red, i.e. the detector depends on the search.
# run: python3 -m unittest pruef/ak33_auswertung/test_ak33_quelle.py   (from djk/oberflaeche)
import os, sys, tempfile, unittest
import numpy as np
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ak33_quelle as q

N = 12 * 48000


def sig():
    r = np.random.default_rng(7)
    x = r.standard_normal((N, 2)).astype(np.float32) * 0.1
    env = (np.sin(np.arange(N) / 4800.0) > -0.2).astype(np.float32)[:, None]   # some silent stretches like a real mix
    return x * env


def mit_luecke(x, at, n=256, dup=False):
    """tap with a quantum dropped at frame `at` (or duplicated)"""
    return np.concatenate([x[:at], x[at:at + n], x[at:]]) if dup else np.concatenate([x[:at], x[at + n:]])


class Quelle(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.e = sig()
        wavfile.write(f'{self.d}/e.wav', 48000, self.e)

    def tap(self, name, x, lead=40813, ring=False):
        y = np.concatenate([np.zeros((lead, 2), np.float32), x, np.zeros((5000, 2), np.float32)])
        p = f'{self.d}/{name}'
        if ring: y.tofile(p + '.f32'); return p + '.f32'
        wavfile.write(p + '.wav', 48000, y); return p + '.wav'

    def lauf(self, ring, caps, orte=None):
        e = q.lies_wav(f'{self.d}/e.wav')
        r = q.vergleich(e, q.lies_f32(ring), 'ring') if ring else None
        cs = [q.vergleich(e, q.lies_wav(c), f'capture{i + 1}') for i, c in enumerate(caps)]
        return r, cs, q.urteil(r, cs, orte)

    def test_clean_negative_control(self):
        r, cs, v = self.lauf(self.tap('r', self.e, 9000, True), [self.tap('c1', self.e), self.tap('c2', self.e, 41069)])
        self.assertFalse(r['slipped']); self.assertTrue(r['bit_identical'])
        self.assertTrue(all(not c['slipped'] and c['bit_identical'] for c in cs))
        self.assertTrue(v.startswith('CLEAN'), v)

    def test_one_capture_drops_a_quantum(self):
        r, cs, v = self.lauf(self.tap('r', self.e, 9000, True), [self.tap('c1', mit_luecke(self.e, 300000)), self.tap('c2', self.e)])
        self.assertFalse(r['slipped']); self.assertTrue(cs[0]['slipped']); self.assertFalse(cs[1]['slipped'])
        self.assertEqual([e['nach'] for e in cs[0]['slips']], [-256])
        self.assertTrue(300000 / 48000 <= cs[0]['first_mismatch_s'] < 300000 / 48000 + 0.05)   # equal silence may hide the first frames of the drop
        self.assertTrue(v.startswith('ONE pw-record PROCESS'), v)

    def test_both_captures_drop_at_the_same_place(self):
        r, cs, v = self.lauf(self.tap('r', self.e, 9000, True), [self.tap('c1', mit_luecke(self.e, 300000)), self.tap('c2', mit_luecke(self.e, 300256))])
        self.assertTrue(v.startswith('SHARED PATH') and 'at the same place' in v, v)

    def test_ring_drops_is_the_core(self):
        r, cs, v = self.lauf(self.tap('r', mit_luecke(self.e, 200000), 9000, True), [self.tap('c1', self.e), self.tap('c2', self.e)])
        self.assertTrue(r['slipped']); self.assertTrue(v.startswith('CORE'), v)

    def test_only_the_disk_captures_slip_is_the_file_write(self):
        c = lambda n, x: self.tap(n, x)
        r, cs, v = self.lauf(self.tap('r', self.e, 9000, True), [c('c1', mit_luecke(self.e, 300000)), c('c2', mit_luecke(self.e, 300000)), c('c3', self.e), c('c4', self.e)],
                             ['ordner', 'ordner', 'shm', 'shm'])
        self.assertTrue(v.startswith('CAPTURE FILE WRITE (ordner)'), v)

    def test_one_disk_capture_slips_but_the_other_disk_capture_is_clean_stays_process(self):
        c = lambda n, x: self.tap(n, x)
        r, cs, v = self.lauf(self.tap('r', self.e, 9000, True), [c('c1', mit_luecke(self.e, 300000)), c('c2', self.e), c('c3', self.e)], ['ordner', 'ordner', 'shm'])
        self.assertTrue(v.startswith('ONE pw-record PROCESS'), v)

    def test_slip_inside_the_first_seconds_still_aligns_and_is_found(self):
        # s4_1 of the G2 series: a drop of one quantum 2.6 s into the span, periodic loop material; the old global alignment (correlation over the first 5 s, top 8 peaks) locked on a
        # wrong, later repeat and the run read as 0 equal frames with phantom slips
        r = np.random.default_rng(3)
        bar = r.standard_normal((96000, 2)).astype(np.float32) * 0.3
        e = np.concatenate([bar[:48000] * 0.2, np.tile(bar, (6, 1))]); wavfile.write(f'{self.d}/e.wav', 48000, e)
        c = mit_luecke(e, 125000)
        r_, cs, v = self.lauf(self.tap('r', e, 9000, True), [self.tap('c1', c), self.tap('c2', e)])
        self.assertEqual([x['nach'] for x in cs[0]['slips']], [-256], cs[0]['slips'])
        self.assertTrue(cs[0]['bit_equal_at_local_lag'] > 0.9 * len(e), cs[0]['bit_equal_at_local_lag'])   # after the drop the content is still bit-equal, only shifted
        self.assertTrue(v.startswith('ONE pw-record PROCESS') or v.startswith('BEHIND'), v)

    def test_single_capture(self):
        r, cs, v = self.lauf(self.tap('r', self.e, 9000, True), [self.tap('c1', mit_luecke(self.e, 300000))])
        self.assertTrue(v.startswith('BEHIND THE KERN'), v)

    def test_duplicated_quantum(self):
        r, cs, v = self.lauf(None, [self.tap('c1', mit_luecke(self.e, 300000, dup=True))])
        self.assertEqual([e['nach'] for e in cs[0]['slips']], [256]); self.assertTrue(v.startswith('NO RING TAP'), v)

    def test_mutation_without_local_search_turns_the_drop_case_red(self):
        old = q.SUCH
        try:
            q.SUCH = 1   # mutation: the local lag search can no longer see +-256
            r, cs, v = self.lauf(self.tap('r', self.e, 9000, True), [self.tap('c1', mit_luecke(self.e, 300000)), self.tap('c2', self.e)])
            self.assertFalse(cs[0]['slipped'] and [e['nach'] for e in cs[0]['slips']] == [-256], 'the mutation must lose the -256 slip')
        finally:
            q.SUCH = old


if __name__ == '__main__':
    unittest.main()
