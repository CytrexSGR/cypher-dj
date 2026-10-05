"""Tempo-Karte nach SCHNITTSTELLEN.md §1.3 (normativ), als Python-Referenz für Golden-Folgen und Prüfungen.

Segmente {s0, b0, bpm0, k, dauer_s}, linear in der Zeit. s0 wird ungerundet geführt: nur so trifft die Karte
den Golden-Wert sample(192) = 4 287 104,895 aus §1.3 (mit gerundetem s0 wären es 4 287 104,818).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

import vertragstext

RATE = 48000


@dataclass(frozen=True)
class Segment:
    s0: float
    b0: float
    bpm0: float
    k: float
    dauer_s: float = math.inf


class Karte:
    def __init__(self, start_bpm: float) -> None:
        self.segmente: list[Segment] = [Segment(0.0, 0.0, float(start_bpm), 0.0)]

    def _nach_sample(self, s: float) -> Segment:
        return [g for g in self.segmente if g.s0 <= s][-1]

    def _nach_beat(self, b: float) -> Segment:
        return [g for g in self.segmente if g.b0 <= b][-1]

    def beat(self, s: float) -> float:
        g = self._nach_sample(s)
        dt = (s - g.s0) / RATE
        return g.b0 + (g.bpm0 * dt + g.k * dt * dt / 2) / 60

    def sample(self, b: float) -> float:
        g = self._nach_beat(b)
        db = b - g.b0
        return g.s0 + RATE * 120 * db / (g.bpm0 + math.sqrt(g.bpm0 ** 2 + 120 * g.k * db))

    def bpm(self, s: float) -> float:
        g = self._nach_sample(s)
        return g.bpm0 + g.k * (s - g.s0) / RATE

    def k(self, s: float) -> float:
        return self._nach_sample(s).k

    def rampe(self, ab_beat: float, ziel_bpm: float, dauer_beats: float) -> tuple[float, float]:
        """Rampe linear in der Zeit ab ab_beat vom dann gültigen Tempo (§1.3, §4.2). Gibt (T, k) zurück."""
        s_ab = self.sample(ab_beat)
        bpm0 = self.bpm(s_ab)
        t = dauer_beats * 60 / ((bpm0 + ziel_bpm) / 2)
        k = (ziel_bpm - bpm0) / t
        vorher = [g for g in self.segmente if g.b0 < ab_beat]
        vorher[-1] = replace(vorher[-1], dauer_s=(s_ab - vorher[-1].s0) / RATE)
        self.segmente = vorher + [Segment(s_ab, ab_beat, bpm0, k, t),
                                  Segment(s_ab + t * RATE, ab_beat + dauer_beats, ziel_bpm, 0.0)]
        return t, k


def ziel_sample(karte: Karte, beat: float) -> int:
    """§1.1: ziel_sample = llround(sample_at(beat)), bei ,5 vom Nullpunkt weg."""
    s = karte.sample(beat)
    return int(math.floor(s + 0.5)) if s >= 0 else -int(math.floor(-s + 0.5))


def takt_schlag_phrase(beat: float) -> tuple[int, int, int]:
    """§1.1: Takt-Nr, Schlag im Takt, Phrase-Nr (1-basiert, 4/4)."""
    return math.floor(beat / 4) + 1, math.floor(math.fmod(beat, 4)) + 1, math.floor(beat / 32) + 1


def golden_abweichungen(text: str, karte_klasse: type[Karte] = Karte) -> list[str]:
    """Rechnet die Fälle der Golden-Tabelle §1.3 mit der Karte nach; leere Liste heißt: trifft den Text."""
    soll = vertragstext.golden_1_3(text)
    k = karte_klasse(128.0)
    ist = {"sample(64)": k.sample(64.0), "beat(1440000)": k.beat(1_440_000)}
    t, kk = k.rampe(128.0, 132.0, 32.0)
    ist.update({"rampe_start": k.sample(128.0), "rampe_T": t, "rampe_k": kk})
    for b in (144, 160, 192):
        s = k.sample(float(b))
        ist[f"sample({b})"] = s
        ist[f"sample({b})_gerundet"] = float(math.floor(s + 0.5))
    ist["bpm(144)"] = k.bpm(k.sample(144.0))
    fehler = []
    for name, (wert, stellen) in soll.items():
        grenze = 0.5 * 10 ** (-stellen) + 1e-12
        if abs(ist[name] - wert) > grenze:
            fehler.append(f"§1.3 {name}: Text {wert}, karte.py {ist[name]!r} (Grenze {grenze:g})")
    faelle = vertragstext.takt_schlag_phrase_1_3(text)
    for beat, takt, schlag, phrase in faelle:
        if takt_schlag_phrase(beat) != (takt, schlag, phrase):
            fehler.append(f"§1.3 Beat {beat}: Text {takt}.{schlag} P{phrase}, karte.py {takt_schlag_phrase(beat)}")
    return fehler
