#!/usr/bin/env python3
"""Erzeugt djk/kern/tests/ziel/karte_voll.jsonl: eine Kern-Folge im Format von djk/vertrag/folgen/FORMAT.md
(Scheibe 02), die „Karte voll“ am laufenden Kern prüft (SCHNITTSTELLEN.md §1.3: höchstens 64 Segmente; §4.2: Karte
voll -> abgelehnt, Grund karte_voll; 02 NP N4: die Probe meldete Erfolg, obwohl die Karte voll war).

Herleitung der Erwartung aus §1.3, nicht aus dem Kern: eine Rampe belegt ein Segment für sich und eines für das
konstante Tempo danach; beginnt die nächste Rampe genau am Ende der vorigen, ersetzt sie dieses konstante Segment.
62 Rampen zu 1 Beat Stoß an Stoß ab Beat 64 belegen also 1 (vor Beat 64) + 62 + 1 (danach) = 64 Segmente; die 63.
bräuchte das 65. und wird abgelehnt. Gegenprobe: nach dem Storno der letzten wartenden Rampe passt genau eine Rampe
an dieselbe Stelle wieder hinein (Platz ist Platz, kein Klemmzustand); eine Rampe, die nicht anschließt, braucht
zwei Segmente und wird wieder abgelehnt. /takt bei Beat 64 bleibt auf dem Golden-Sample 1 440 000 (§1.3).
Diese Folge gehört dem Kern (Scheibe 08), nicht dem Vertrag: sie liegt unter djk/kern/tests/ziel/, nicht unter
djk/vertrag/folgen/ (Territorium der Scheiben 02 und 09).
Aufruf: python3 djk/kern/tests/ziel/erzeuge_karte_voll.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER.parents[2] / "vertrag"))
from karte import Karte, takt_schlag_phrase, ziel_sample  # noqa: E402  (Scheibe 02)

Q = "pruefstand"
FRIST = 48000
MAX_SEGMENTE = 64  # §1.3


def q(kennung: int, status: int, bis: int, grund: str = "", notiz: str | None = None) -> dict:
    z = {"t": "erwarte", "bis_sample": bis, "osc": ["/q", ",hsihds", kennung, Q, status, None, None, grund]}
    if notiz:
        z["notiz"] = notiz
    return z


def rampe(kennung: int, sample: int, ab_beat: float, ziel_bpm: float, notiz: str | None = None) -> dict:
    z = {"t": "sende", "sample": sample, "osc": ["/k/tempo/rampe", ",hsddd", kennung, Q, ab_beat, ziel_bpm, 1.0]}
    if notiz:
        z["notiz"] = notiz
    return z


def main() -> None:
    passen = MAX_SEGMENTE - 2  # 1 Segment vor der Kette, 1 konstantes danach
    zeilen = [
        {"t": "sende", "sample": 0, "osc": ["/k/set/neu", ",hsd", 1, Q, 128.0],
         "notiz": "neue Zeitachse; sample 0 = sofort (FORMAT.md Punkt 2)"},
        q(1, 1, FRIST, notiz="angenommen"),
        {"t": "erwarte", "bis_sample": FRIST, "osc": ["/q", ",hsihds", 1, Q, 2, 0, 0.0, ""], "toleranz": 1e-6,
         "notiz": "gestartet"},
    ]
    s = 48128  # Vielfaches von 256 (FORMAT.md Punkt 11), Beat 2,139: 61 Beats Vorlauf vor Beat 64
    for i in range(passen + 1):
        zeilen.append(rampe(2 + i, s, 64.0 + i, 129.0 if i % 2 == 0 else 128.0,
                            f"Rampe {i + 1} von {passen + 1}, Stoß an Stoß ab Beat 64" if i in (0, passen) else None))
    for i in range(passen):
        zeilen.append(q(2 + i, 1, s + FRIST))
    letzte, abgelehnt = 1 + passen, 2 + passen
    zeilen.append(q(abgelehnt, 6, s + FRIST, "karte_voll",
                    f"§1.3: die {passen + 1}. Rampe bräuchte das {MAX_SEGMENTE + 1}. Segment"))
    s2 = s + 2 * FRIST
    zeilen.append({"t": "sende", "sample": s2, "osc": ["/k/storno", ",hsh", abgelehnt + 1, Q, letzte],
                   "notiz": "Gegenprobe: die letzte wartende Rampe zurückziehen"})
    zeilen.append(q(letzte, 8, s2 + FRIST, notiz="storniert"))
    zeilen.append(q(abgelehnt + 1, 1, s2 + FRIST))
    zeilen.append(q(abgelehnt + 1, 2, s2 + FRIST))
    s3 = s2 + 2 * FRIST
    zeilen.append(rampe(abgelehnt + 2, s3, 64.0 + passen - 1, 132.0, "an dieselbe Stelle: passt wieder (64 Segmente)"))
    zeilen.append(q(abgelehnt + 2, 1, s3 + FRIST))
    zeilen.append(rampe(abgelehnt + 3, s3 + FRIST, 64.0 + passen + 4, 130.0,
                        "schließt nicht an: braucht 2 Segmente, abgelehnt"))
    zeilen.append(q(abgelehnt + 3, 6, s3 + 2 * FRIST, "karte_voll"))
    k = Karte(128.0)  # vor Beat 64 wirkt keine Rampe: Golden-Wert §1.3 sample(64,0) = 1 440 000
    t, _, p = takt_schlag_phrase(64.0)
    s64 = ziel_sample(k, 64.0)
    zeilen.append({"t": "erwarte", "bis_sample": s64 + FRIST, "osc": ["/takt", ",iihdd", t, p, s64, 64.0, 128.0],
                   "toleranz": 1e-6, "notiz": "Karte nach allen Ablehnungen unverletzt: Beat 64 auf 1 440 000"})
    ziel = HIER / "karte_voll.jsonl"
    ziel.write_text("".join(json.dumps(z, ensure_ascii=False) + "\n" for z in zeilen), encoding="utf-8")
    print(f"{ziel}: {len(zeilen)} Zeilen, {passen} Rampen passen, die {passen + 1}. nicht")


if __name__ == "__main__":
    main()
