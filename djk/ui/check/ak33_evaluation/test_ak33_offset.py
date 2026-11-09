# Calibration of ak33_offset.py (AK33 G3, review F2): the cross-sound onset comparison is checked against signals with KNOWN answers before it judges the jam.
# Two synthetic kicks with different shapes (A: sharp click + fast body, like the track; B: weak click + slow body, like the loop), 32 beats on a 128 BPM grid.
#   1. the SAME trigger instant gives different numbers per band (click about 0, body about +4 ms; on real kicks also per threshold, see the jam figures): the absolute offset between two different sounds is not defined by the instrument (the F2 point)
#   2. what the instrument DOES recover is a known shift of the same sound: B moved by -10, 0, +5, +10 ms reads that much later, in every band and at every threshold
#   3. the range function reports min..max over bands and thresholds, and the same-sound comparison (B against B) reads exactly the shift with no bias
#   4. mutation: a window that starts only 2 ms before the grid line cannot see the -10 ms case and must turn test 2 red
# run: python3 -m unittest check/ak33_evaluation/test_ak33_offset.py   (from djk/ui)
import os, sys, unittest
import numpy as np
from scipy.signal import butter, sosfilt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ak33_offset as v

SR = 48000
FPB = 22500          # frames per beat at 128 BPM
N_BEATS = 32


def kick(click_amp, click_tau_ms, body_attack_ms, body_decay_ms, f0=160.0, f1=50.0, n=int(0.35 * SR)):
    t = np.arange(n) / SR
    rng = np.random.default_rng(3)
    click = click_amp * sosfilt(butter(4, 2500, 'highpass', fs=SR, output='sos'), rng.standard_normal(n)) * np.exp(-t / (click_tau_ms / 1000))   # band-limited: broadband noise would leak into the body band
    f = f1 + (f0 - f1) * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    att = np.clip(t / (body_attack_ms / 1000), 0, 1) ** 2
    body = 0.8 * np.sin(ph) * att * np.exp(-t / (body_decay_ms / 1000))
    return click + body


KICK_A = kick(0.6, 1.0, 2.0, 80.0)      # sharp click, fast body
KICK_B = kick(0.12, 1.5, 9.0, 100.0)    # weak click, slow body


def spur(k, shift_ms=0.0):
    x = np.zeros(N_BEATS * FPB + SR // 2)
    off = int(round(shift_ms * SR / 1000))
    for b in range(N_BEATS):
        a = b * FPB + off
        if a < 0:                                  # an early kick on beat 0 would start before the file
            continue
        x[a:a + len(k)] += k[:len(x) - a]
    return x


GITTER = np.arange(N_BEATS) * FPB / SR


def tab(x):
    return v.einsaetze_tabelle(x, GITTER)


class Versatz(unittest.TestCase):
    def test_same_trigger_different_shapes_read_different_numbers_per_band_and_threshold(self):
        d = v.differenz(tab(spur(KICK_A)), tab(spur(KICK_B)))      # B minus A, both triggered at exactly the same sample
        click = d[('click 2-8k', 0.5)]['median']; body = d[('body 100-600', 0.5)]['median']
        self.assertLess(abs(click), 0.5, f'click band: both triggers coincide, read {click}')
        self.assertGreater(body, 3.0, f'body band: the slower body of B reads later although the trigger is the same: {body}')

    def test_a_known_shift_of_the_same_sound_is_recovered_in_every_band_and_threshold(self):
        ref = tab(spur(KICK_B))
        for ms in (-10.0, 0.0, 5.0, 10.0):
            d = v.differenz(ref, tab(spur(KICK_B, ms)))
            for k, o in d.items():
                self.assertAlmostEqual(o['median'], ms, delta=0.1, msg=f'shift {ms} ms, {k}: read {o["median"]}')

    def test_difference_of_two_shifted_copies_of_a_different_sound_changes_by_the_shift(self):
        a = tab(spur(KICK_A)); d0 = v.differenz(a, tab(spur(KICK_B)))
        for ms in (5.0, 10.0):
            d = v.differenz(a, tab(spur(KICK_B, ms)))
            for k in d0:
                self.assertAlmostEqual(d[k]['median'] - d0[k]['median'], ms, delta=0.15, msg=f'{k}')

    def test_beat_subset_leaves_the_other_beats_out(self):
        x = spur(KICK_B)
        for i in range(1, N_BEATS, 2): x[i * FPB - 2000:i * FPB + 12000] = 0          # odd beats silent
        alle = tab(x)[('body 100-600', 0.5)]; gerade = v.einsaetze_tabelle(x, GITTER, teil=v.TEILMENGEN['beat 1+3'])[('body 100-600', 0.5)]
        ungerade = v.einsaetze_tabelle(x, GITTER, teil=v.TEILMENGEN['beat 2+4'])[('body 100-600', 0.5)]
        self.assertEqual((alle['n'], gerade['n'], ungerade['n']), (15, 15, 0))        # beat 0 has no window; 15 even beats 2..30 sound, no odd beat does

    def test_range_is_min_to_max_over_bands_and_thresholds(self):
        d = v.differenz(tab(spur(KICK_A)), tab(spur(KICK_B)))
        r = v.bereich(d)
        alle = [o['median'] for o in d.values()]
        self.assertEqual((r['min'], r['max']), (min(alle), max(alle)))
        self.assertGreater(r['max'] - r['min'], 3.0)
        self.assertIn('band', r['min_bei'].lower() if isinstance(r['min_bei'], str) else str(r['min_bei']).lower())

    def test_no_hit_in_a_window_is_skipped_not_counted(self):
        x = spur(KICK_B); x[10 * FPB - 3000:10 * FPB + 12000] = 0       # beat 10 silent
        t = tab(x)[('body 100-600', 0.5)]
        self.assertEqual(len(t['ms']), N_BEATS - 2)       # beat 0 has no full window before the file start, beat 10 is silent
        self.assertTrue(np.isnan(t['alle'][10]))

    def test_mutation_window_that_starts_two_ms_before_the_grid_line_loses_the_early_case(self):
        alt = v.FENSTER_VOR_MS
        try:
            v.FENSTER_VOR_MS = 2.0       # mutation: the kick moved 10 ms early now starts before the window
            ref = tab(spur(KICK_B)); d = v.differenz(ref, tab(spur(KICK_B, -10.0)))
            fehlt = [k for k, o in d.items() if not abs(o['median'] - -10.0) <= 0.1]
            self.assertTrue(fehlt, 'the mutated window must lose the -10 ms case in at least one band')
        finally:
            v.FENSTER_VOR_MS = alt


class Bericht(unittest.TestCase):
    """Review of G3 (F2 follow-up): a 'range per band' report must name EVERY measured band; a band that is no kick-onset measure is labelled in the report, not dropped by a filter."""
    def setUp(self):
        self.d = v.differenz(tab(spur(KICK_A)), tab(spur(KICK_B)))
        self.zeilen = v.bereichsbericht({'alle': self.d})

    def test_every_measured_band_has_a_line_with_its_own_range(self):
        for b in v.BANDEN:
            z = [x for x in self.zeilen if x.startswith(b)]
            self.assertEqual(len(z), 1, f'{b}: {self.zeilen}')
            medians = [o['median'] for (bb, _), o in self.d.items() if bb == b]
            self.assertIn(f'{min(medians):+.2f}', z[0]); self.assertIn(f'{max(medians):+.2f}', z[0])

    def test_the_range_of_a_band_spans_all_beat_sets(self):
        d2 = {k: dict(o, median=o['median'] + 50.0) for k, o in self.d.items()}       # a second beat set that reads 50 ms later everywhere
        z = [x for x in v.bereichsbericht({'beat 2+4': self.d, 'beat 1+3': d2}) if x.startswith('click 2-8k')][0]
        m = [o['median'] for (b, _), o in self.d.items() if b == 'click 2-8k']
        self.assertIn(f'{min(m):+.2f}', z); self.assertIn(f'{max(m) + 50.0:+.2f}', z)

    def test_the_slow_band_is_labelled_as_no_kick_onset_measure_and_the_others_are_not(self):
        for x in self.zeilen:
            if x.startswith('low 40-120'): self.assertIn('not a kick onset measure', x)
            else: self.assertNotIn('not a kick onset measure', x)


class Tempo(unittest.TestCase):
    """tempo_schaetzung: true tempo of a hit train from its drift against a grid of another tempo (G3, the 126.9946 line). 200 kicks at exactly 127.000 BPM."""
    N = 200
    @classmethod
    def setUpClass(cls):
        per = 60 / 127.0
        cls.x = np.zeros(int((cls.N + 2) * per * SR))
        for b in range(cls.N + 1):
            a = int(round((b * per + 0.2) * SR)); cls.x[a:a + len(KICK_A)] += KICK_A[:len(cls.x) - a]

    def grid(self, bpm, off=0.2):
        return off + np.arange(self.N) * 60 / bpm

    def test_grid_slower_than_the_hits_reads_the_true_tempo_and_its_interval_contains_it(self):
        r = v.tempo_schaetzung(self.x, self.grid(126.9946))
        self.assertLess(r['slope_ms_per_beat'], -0.012)                     # hits get earlier against a slower grid: 60000/127 - 60000/126.9946 = -0.0201 ms per beat expected
        lo, hi = r['bpm_ci95']
        self.assertTrue(lo <= 127.0 <= hi, str(r))
        self.assertFalse(lo <= 126.9946 <= hi, str(r))

    def test_negative_control_grid_at_the_true_tempo_has_no_slope(self):
        r = v.tempo_schaetzung(self.x, self.grid(127.0))
        lo, hi = r['ci95']
        self.assertTrue(lo <= 0.0 <= hi and abs(r['slope_ms_per_beat']) < 0.002, str(r))

    def test_beats_without_a_kick_are_left_out(self):
        x = self.x.copy(); per = 60 / 127.0
        a = int(0.2 * SR + 50 * per * SR) - 3000; b = int(0.2 * SR + 90 * per * SR) - 3000
        x[a:b] = 0                                                         # 40 beats silent
        r = v.tempo_schaetzung(x, self.grid(126.9946))
        self.assertLessEqual(r['n'], self.N - 40)
        self.assertGreater(r['n'], 100)


class Quelllage(unittest.TestCase):
    """quell_lag: where the engine put a clip against what its marker map says (export against the source warped by the same map). Known answers: a noise source warped by a map and moved by 4.15 ms."""
    @classmethod
    def setUpClass(cls):
        r = np.random.default_rng(11)
        cls.xs = sosfilt(butter(4, 6000, 'lowpass', fs=SR, output='sos'), r.standard_normal(40 * SR))
        cls.abb = lambda self, beat: 0.3 + np.asarray(beat) * 60 / 127.0              # map: clip beat -> source second, straight 127 BPM line through 0.3 s

    def export(self, shift_ms):
        n = 15 * SR; te = np.arange(n) / SR - shift_ms / 1000.0
        return np.interp(self.abb(te / (60 / 128.0)) * SR, np.arange(len(self.xs)), self.xs)

    def test_known_shift_is_read_back_with_its_sign(self):
        for ms in (-4.15, -9.0, 0.0, 7.0):
            lag = v.quell_lag(self.xs, self.export(ms), self.abb)
            for l in lag: self.assertAlmostEqual(l, ms, delta=0.05, msg=f'{ms}: {lag}')

    def test_a_wrong_map_tempo_shows_as_a_changing_lag(self):
        falsch = lambda beat: 0.3 + np.asarray(beat) * 60 / 126.9        # 0.2 ms per beat slower: about 3.5 ms apart between the first and the last window
        lag = v.quell_lag(self.xs, self.export(0.0), falsch)
        self.assertGreater(abs(lag[-1] - lag[0]), 1.0, str(lag))


if __name__ == '__main__':
    unittest.main()
