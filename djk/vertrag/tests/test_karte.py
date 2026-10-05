"""Tests für karte.py gegen die Golden-Tabelle in SCHNITTSTELLEN.md §1.3."""
import math
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIER))
import vertragstext  # noqa: E402
from karte import Karte, Segment, golden_abweichungen, takt_schlag_phrase, ziel_sample  # noqa: E402


class KarteMitGerundetemS0(Karte):
    """Liest §1.3 'Segmente {s0: int64 ...}' wörtlich: das Segment nach der Rampe beginnt auf gerundetem Sample."""
    def rampe(self, ab_beat, ziel_bpm, dauer_beats):
        t, k = super().rampe(ab_beat, ziel_bpm, dauer_beats)
        g = self.segmente[-1]
        self.segmente[-1] = Segment(float(round(g.s0)), g.b0, g.bpm0, g.k, g.dauer_s)
        return t, k


class KarteMitFalschemT(Karte):
    """Fehlerfall: T mit dem Anfangstempo statt dem Mittel aus Anfang und Ziel."""
    def rampe(self, ab_beat, ziel_bpm, dauer_beats):
        s_ab = self.sample(ab_beat)
        bpm0 = self.bpm(s_ab)
        t = dauer_beats * 60 / bpm0
        k = (ziel_bpm - bpm0) / t
        self.segmente = [g for g in self.segmente if g.b0 < ab_beat]
        self.segmente += [Segment(s_ab, ab_beat, bpm0, k, t),
                          Segment(s_ab + t * 48000, ab_beat + dauer_beats, ziel_bpm, 0.0)]
        return t, k


def test_karte_trifft_die_golden_tabelle():
    assert golden_abweichungen(vertragstext.lies()) == []


def test_gerundetes_s0_verfehlt_nur_den_ungerundeten_wert():
    fehler = golden_abweichungen(vertragstext.lies(), KarteMitGerundetemS0)
    assert [f for f in fehler if f.startswith("§1.3 sample(192):")], fehler
    assert not [f for f in fehler if f.startswith("§1.3 sample(192)_gerundet")]


def test_falsches_t_ist_rot():
    assert any(f.startswith("§1.3 rampe_T:") for f in golden_abweichungen(vertragstext.lies(), KarteMitFalschemT))


def test_runden_und_takt():
    k = Karte(128.0)
    k.rampe(128.0, 132.0, 32.0)
    assert ziel_sample(k, 144.0) == 3_237_188 and ziel_sample(k, 192.0) == 4_287_105
    assert takt_schlag_phrase(127.99) == (32, 4, 4) and takt_schlag_phrase(128.0) == (33, 1, 5)
    assert math.isclose(k.bpm(k.sample(144.0)), 130.015384, abs_tol=5e-7)
