import itertools
import unittest

import measure_cost as m


def ergebnis(p50):
    return {"graph": "g", "stimmen": 8, "block": 256, "p50_us": p50, "p99_us": p50 * 2, "p999_us": p50 * 3}


class Faelschung:
    """Fakes loadavg, the process check, the clock and the measurement."""

    def __init__(self, last, bau=False):
        self.last, self.bau, self.t = last, bau, 0.0
        self.aufrufe = []

    def einsetzen(self):
        self.alt = (m.lade_last, m.bau_laeuft, m.schlafe, m.jetzt, m.fuehre_aus)
        m.lade_last = lambda: self.last
        m.bau_laeuft = lambda: self.bau
        m.schlafe = self._schlafe
        m.jetzt = lambda: self.t
        m.fuehre_aus = self._aus

    def zurueck(self):
        m.lade_last, m.bau_laeuft, m.schlafe, m.jetzt, m.fuehre_aus = self.alt

    def _schlafe(self, s):
        self.t += s

    def _aus(self, binary, graph, stimmen):
        self.aufrufe.append(graph)
        return ergebnis(200.0 if graph == "alt" else 300.0)


class MesseKosten(unittest.TestCase):
    def lauf(self, f, **kw):
        f.einsetzen()
        self.addCleanup(f.zurueck)
        return m.messe("bin", "neu", 8, 5, 1800, **kw)

    def test_hohe_last_ganze_wartezeit_gibt_relativ_mit_verhaeltnissen(self):
        f = Faelschung(last=5.0)
        r = self.lauf(f, vergleich="alt")
        self.assertEqual(r["modus"], "relativ")
        self.assertTrue(r["vorlaeufig"])
        self.assertAlmostEqual(r["verhaeltnis_p50"], 1.5)
        self.assertAlmostEqual(r["verhaeltnis_p99"], 1.5)
        self.assertEqual(f.aufrufe, ["alt", "neu"] * 5)  # ABABABABAB
        self.assertGreaterEqual(f.t, 1800)

    def test_niedrige_last_gibt_ruhig(self):
        f = Faelschung(last=0.5)
        r = self.lauf(f)
        self.assertEqual(r["modus"], "ruhig")
        self.assertEqual(r["neu"]["angenommen"], 5)
        self.assertEqual(r["neu"]["p50_us"], 300.0)
        self.assertTrue(all(not x["verworfen"] and x["load1_vor"] == 0.5 for x in r["laeufe"]))

    def test_last_nach_dem_lauf_darf_bis_2_5_steigen(self):
        # before 1.9 (<= 2.0), after 2.4 (<= 2.5): accepted; after 2.6: discarded
        for nach, verworfen in ((2.4, False), (2.6, True)):
            f = Faelschung(last=1.9)
            f.einsetzen()
            self.addCleanup(f.zurueck)
            aus = m.fuehre_aus

            def lauf(binary, graph, stimmen, f=f, nach=nach, aus=aus):
                f.last = nach
                return aus(binary, graph, stimmen)
            m.fuehre_aus = lauf
            r = m.messe_einmal("bin", "neu", 8, "ruhig")
            self.assertEqual(r["verworfen"], verworfen, nach)
            self.assertEqual(r["load1_vor"], 1.9)
            self.assertEqual(r["load1_nach"], nach)

    def test_uebersetzer_laeuft_verwirft_den_lauf(self):
        f = Faelschung(last=0.5, bau=True)
        r = self.lauf(f)
        self.assertEqual(f.aufrufe.count("neu"), 5)  # relativ mode ran
        self.assertEqual(r["modus"], "relativ")
        # a compiler that appears during a run discards it, then the run is repeated
        g = Faelschung(last=0.5)
        zustand = itertools.chain([False, False, True], itertools.repeat(False))  # wait check, before check: quiet; after check: compiler
        g.einsetzen()
        self.addCleanup(g.zurueck)
        m.bau_laeuft = lambda: next(zustand)
        r = m.messe("bin", "neu", 8, 2, 1800)
        self.assertEqual(r["modus"], "ruhig")
        self.assertEqual(sum(x["verworfen"] for x in r["laeufe"]), 1)
        self.assertEqual(r["neu"]["angenommen"], 2)


if __name__ == "__main__":
    unittest.main()
