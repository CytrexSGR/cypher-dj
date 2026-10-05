"""Tests des Folgen-Läufers der Scheibe 31 (lauf31.py), ohne Kern und ohne Ton. Gezeigt:
1. deck_wert mit Start genau zwischen zwei /zustand/deck (Werte der Golden-Folge start_quell_beat Zeile 9, Meldungen an
   den Blockanfängen, die ein Vielfaches von 960 enthalten, wie der Kern bei Quantum 256): lauf31 grün; Fehlerfall zum
   Vergleich: der Läufer aus 25 (Lesart FORMAT.md:67, linear über den Statuswechsel) liest einen falschen Wert.
2. Ohne Statuswechsel dieselbe Lesart wie 08 (linear zwischen gleichem Status, status die letzte Meldung davor); eine
   falsche Erwartung ist rot (Negativ-Kontrolle); ein Stopp zwischen zwei Meldungen liest den stehenden Wert danach.
3. material_schreiben legt das Fixture-Material in den Arbeitsbestand, f0000000000000ff fehlt.
4. main reicht Läufer-Klasse und Bereiche an lauf25.main (deck gilt als gebaut).
Aufruf: python3 -m pytest -q djk/kern/tests/ziel/test_lauf31.py"""
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import lauf25  # noqa: E402
import lauf31  # noqa: E402

al = lauf31.al
SPB = 22500


class KernOhneNetz:
    """Das, was Lauf.deck_bei vom Kern braucht: Deck-Reihen (wie al.Kern.pumpe sie füllt) und den Eingang mit /uhr."""

    def __init__(self, meldungen, bpm=128.0):
        self.deck = {}
        self.eingang = [al.Nachricht("/uhr", ",hhddd", [0, 0, 0.0, bpm, 0.0], 0.0)]
        for s, status, q, rest, faktor in meldungen:
            for f, w in (("status", status), ("quell_beat", q), ("beats_bis_ende", rest), ("faktor", faktor)):
                self.deck.setdefault((1, f), []).append((float(s), w))


def laeufe(meldungen):
    k = KernOhneNetz(meldungen)
    return lauf31.Lauf31(k, {}, ""), lauf25.Lauf25(k, {}, "")


START = [(719_872, 1, 0.0, 256.0, 1.0), (720_896, 2, 16.5 + 896 / SPB, 256.0 - 16.5 - 896 / SPB, 1.0),
         (899_328, 2, 16.5 + (899_328 - 720_000) / SPB, 0.0, 1.0), (900_352, 2, 16.5 + (900_352 - 720_000) / SPB, 0.0, 1.0)]


def test_start_zwischen_zwei_meldungen():
    l31, l25 = laeufe(START)
    assert abs(l31.deck_bei(1, "quell_beat", 720_000) - 16.5) < 1e-9
    assert abs(l31.deck_bei(1, "beats_bis_ende", 720_000) - (256.0 - 16.5)) < 1e-9
    assert l31.deck_bei(1, "status", 720_000) == 1        # status: die letzte Meldung davor (08)
    alt = l25.deck_bei(1, "quell_beat", 720_000)          # Fehlerfall: Gerade vom stehenden zum laufenden Deck
    assert abs(alt - 16.5) > 0.01, alt


def test_ohne_statuswechsel_wie_08():
    l31, l25 = laeufe(START)
    for s in (899_500, 900_000, 900_352):
        assert l31.deck_bei(1, "quell_beat", s) == l25.deck_bei(1, "quell_beat", s)
    assert abs(l31.deck_bei(1, "quell_beat", 900_000) - 24.5) < 0.01
    assert l31.deck_bei(1, "status", 900_000) == 2
    assert not abs(l31.deck_bei(1, "quell_beat", 720_000) - 16.6) <= 0.01   # Negativ-Kontrolle


def test_stopp_zwischen_zwei_meldungen():
    m = [(100_096, 2, 40.0, 10.0, 1.0), (101_120, 1, 40.0 + 500 / SPB, 10.0 - 500 / SPB, 1.0)]
    l31, _ = laeufe(m)
    assert l31.deck_bei(1, "quell_beat", 100_500) == 40.0 + 500 / SPB  # steht danach: Wert danach unverändert


def test_material_schreiben(tmp_path):
    ok, meldung = lauf31.material_schreiben(str(tmp_path))
    assert ok, meldung
    for mid in ("f0000000000000a1", "f0000000000000c3", "f0000000000000d4"):
        assert (tmp_path / mid / "fassungen" / "128000_r1" / "fassung.json").is_file(), mid
        assert (tmp_path / mid / "fassungen" / "128000_r1" / "basis.f32").stat().st_size > 0, mid
    assert not (tmp_path / "f0000000000000ff").exists()


def test_main_reicht_klasse_und_bereiche(monkeypatch, tmp_path):
    gesehen = {}
    monkeypatch.setattr(lauf31.lauf25, "main", lambda rest, lauf_klasse, gebaut: gesehen.update(
        rest=rest, klasse=lauf_klasse, gebaut=gebaut) or 0)
    assert lauf31.main(["--arbeitsbestand", str(tmp_path), "x.jsonl"]) == 0
    assert gesehen == {"rest": ["x.jsonl"], "klasse": lauf31.Lauf31, "gebaut": lauf25.GEBAUT + ("deck",)}
