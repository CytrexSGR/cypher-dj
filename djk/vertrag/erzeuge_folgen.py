#!/usr/bin/env python3
"""Erzeugt die ersten Golden-Folgen aus SCHNITTSTELLEN.md §19.3: uhr_golden, storno, protokollfehler.

Kein Erwartungswert ist abgeschrieben: jede Sample-, Beat- und BPM-Zahl rechnet karte.py mit den Formeln aus §1.3.
Format und Läufer-Regeln: folgen/FORMAT.md. `storno` ist mit /k/tempo/rampe gebaut, damit Scheibe 08 sie ohne
Planteile fahren kann.
Aufruf: python3 djk/vertrag/erzeuge_folgen.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
from karte import Karte, takt_schlag_phrase, ziel_sample  # noqa: E402

Q = "pruefstand"
FRIST = 48000   # eine Erwartung darf bis 1 s nach ihrem Soll-Sample eintreffen
TOL = 1e-6      # Toleranz für f- und d-Werte in Beats, BPM und BPM/s


def sende(sample: int, osc: list, notiz: str | None = None, absicht: str | None = None) -> dict:
    z = {"t": "sende", "sample": sample, "osc": osc}
    if absicht:
        z["absicht"] = absicht
    if notiz:
        z["notiz"] = notiz
    return z


def erwarte(bis: int, osc: list, toleranz: float | None = None, notiz: str | None = None) -> dict:
    z = {"t": "erwarte", "bis_sample": bis, "osc": osc}
    if toleranz is not None:
        z["toleranz"] = toleranz
    if notiz:
        z["notiz"] = notiz
    return z


def quittung(kennung: int, status: int, bis: int, ist_sample=None, ist_beat=None, notiz=None) -> dict:
    return erwarte(bis, ["/q", ",hsihds", kennung, Q, status, ist_sample, ist_beat, ""],
                   TOL if ist_beat is not None else None, notiz)


def neue_zeitachse(bpm: float) -> list[dict]:
    return [sende(0, ["/k/set/neu", ",hsd", 1, Q, bpm], "neue Zeitachse; sample 0 = sofort (FORMAT.md Punkt 2)"),
            quittung(1, 1, FRIST, notiz="angenommen"),
            quittung(1, 2, FRIST, 0, 0.0, "gestartet am ersten Zyklus der neuen Zeitachse")]


def takt(karte: Karte, beat: float, notiz: str | None = None) -> dict:
    t, _, p = takt_schlag_phrase(beat)
    s = ziel_sample(karte, beat)
    return erwarte(s + FRIST, ["/takt", ",iihdd", t, p, s, float(beat), karte.bpm(karte.sample(beat))], TOL, notiz)


def uhr(karte: Karte, block: int, notiz: str | None = None) -> dict:
    if block % 256:
        raise ValueError("Blockanfang muss bei Quantum 128 und 256 gelten (Vielfaches von 256)")
    return erwarte(block + FRIST, ["/uhr", ",hhddd", block, None, karte.beat(block), karte.bpm(block),
                                   karte.k(block)], TOL, notiz)


def block_vor(sample: float) -> int:
    return int(math.floor(sample / 256)) * 256


def uhr_golden() -> list[dict]:
    k = Karte(128.0)
    z = neue_zeitachse(128.0)
    z.append(takt(k, 0.0, "§1.3: Beat 0 = Takt 1, Phrase 1"))
    z.append(uhr(k, ziel_sample(k, 64.0), "§1.3: beat(1 440 000) = 64,000000"))
    z.append(takt(k, 64.0, "§1.3: sample(64,0) = 1 440 000; Beat 64 = Takt 17, Phrase 3"))
    s_senden = ziel_sample(k, 96.0)
    z.append(sende(s_senden, ["/k/tempo/rampe", ",hsddd", 2, Q, 128.0, 132.0, 32.0],
                   "Rampe 128 -> 132 ab Beat 128 über 32 Beats, 32 Beats Vorlauf (§3: mindestens 1 Beat)"))
    z.append(quittung(2, 1, s_senden + FRIST, notiz="angenommen"))
    t, kk = k.rampe(128.0, 132.0, 32.0)
    s_start = ziel_sample(k, 128.0)
    z.append(quittung(2, 2, s_start + FRIST, s_start, 128.0,
                      f"gestartet; §1.3: Start Sample 2 880 000, T = {t:.6f} s, k = {kk:.6f} BPM/s"))
    z.append(takt(k, 128.0, "Beat 128 = Takt 33, Phrase 5"))
    z.append(uhr(k, block_vor(k.sample(144.0)), "Blockanfang vor Beat 144, mitten in der Rampe"))
    z.append(takt(k, 144.0, "§1.3: sample(144,0) = 3 237 188,004, gerundet 3 237 188; bpm dort 130,015384"))
    z.append(takt(k, 160.0, "§1.3: sample(160,0) = 3 588 923,077, gerundet 3 588 923 (Ende der Rampe)"))
    z.append(quittung(2, 3, ziel_sample(k, 160.0) + FRIST, notiz="fertig (Rampe am Ende)"))
    z.append(uhr(k, block_vor(k.sample(192.0)), "Blockanfang vor Beat 192, konstant 132"))
    z.append(takt(k, 192.0, "§1.3: sample(192,0) = 4 287 104,895, gerundet 4 287 105"))
    return z


def storno() -> list[dict]:
    k = Karte(128.0)
    ohne = Karte(128.0)
    ohne.rampe(64.0, 132.0, 32.0)
    z = neue_zeitachse(128.0)
    s_a = ziel_sample(k, 16.0)
    z.append(sende(s_a, ["/k/tempo/rampe", ",hsddd", 2, Q, 64.0, 132.0, 32.0],
                   "Rampe A ab Beat 64; wird vor ihrem Start storniert"))
    z.append(quittung(2, 1, s_a + FRIST, notiz="Rampe A angenommen"))
    s_st = ziel_sample(k, 32.0)
    z.append(sende(s_st, ["/k/storno", ",hsh", 3, Q, 2], "zieht Rampe A (id 2) zurück, 32 Beats vor ihrem Start"))
    z.append(quittung(2, 8, s_st + FRIST, notiz="Rampe A storniert"))
    z.append(quittung(3, 1, s_st + FRIST, notiz="Storno selbst angenommen (§3, Andreas 2026-09-25)"))
    z.append(quittung(3, 2, s_st + FRIST, notiz="Storno selbst gestartet, kein fertig (§3, Andreas 2026-09-25)"))
    z.append({"t": "erwarte_nicht", "ab_sample": s_st, "bis_sample": ziel_sample(k, 64.0),
              "osc": ["/q", ",hsihds", 3, Q, 3, None, None, ""],
              "notiz": "kein fertig für den Storno selbst (§3, Andreas 2026-09-25; FORMAT.md Punkt 13)"})
    z.append(takt(k, 64.0, "Beat 64 bei 128 BPM"))
    z.append(takt(k, 96.0, f"ohne Storno läge Beat 96 bei Sample {ziel_sample(ohne, 96.0)} und 132 BPM "
                           "(Fehlerfall)"))
    s_b = ziel_sample(k, 96.0)
    z.append(sende(s_b, ["/k/tempo/rampe", ",hsddd", 4, Q, 128.0, 132.0, 32.0],
                   "Rampe B ab Beat 128, nicht storniert (Positiv-Kontrolle: eine Rampe wirkt)"))
    z.append(quittung(4, 1, s_b + FRIST, notiz="Rampe B angenommen"))
    k.rampe(128.0, 132.0, 32.0)
    s_start = ziel_sample(k, 128.0)
    z.append(quittung(4, 2, s_start + FRIST, s_start, 128.0, "Rampe B gestartet"))
    z.append(takt(k, 160.0, "Ende von Rampe B: wie uhr_golden, Sample 3 588 923, 132 BPM"))
    return z


def protokollfehler() -> list[dict]:
    k = Karte(128.0)
    z = neue_zeitachse(128.0)
    s1 = ziel_sample(k, 4.0)
    z.append(sende(s1, ["/k/gibt_es_nicht", ",hs", 2, Q], "unbekannte Adresse", "unbekannte_adresse"))
    z.append(erwarte(s1 + FRIST, ["/e/protokollfehler", ",ss", "/k/gibt_es_nicht", "unbekannte_adresse"]))
    s2 = ziel_sample(k, 8.0)
    z.append(sende(s2, ["/k/tempo/rampe", ",hsdd", 3, Q, 64.0, 132.0], "dauer_beats fehlt", "falsche_typen"))
    z.append(erwarte(s2 + FRIST, ["/e/protokollfehler", ",ss", "/k/tempo/rampe", "falsche_typen"]))
    s3 = ziel_sample(k, 12.0)
    z.append(sende(s3, ["/k/storno", ",hsi", 4, Q, 2], "ziel_id als i statt h", "falsche_typen"))
    z.append(erwarte(s3 + FRIST, ["/e/protokollfehler", ",ss", "/k/storno", "falsche_typen"]))
    s4 = ziel_sample(k, 16.0)
    z.append(sende(s4, ["/k/tempo/rampe", ",hsddd", 5, Q, 64.0, 132.0, 32.0],
                   "Negativ-Kontrolle: richtige Nachricht, kein Protokollfehler (FORMAT.md Punkt 8)"))
    z.append(quittung(5, 1, s4 + FRIST, notiz="angenommen"))
    k.rampe(64.0, 132.0, 32.0)
    s_start = ziel_sample(k, 64.0)
    z.append(quittung(5, 2, s_start + FRIST, s_start, 64.0, "gestartet"))
    return z


FOLGEN = {"uhr_golden": uhr_golden, "storno": storno, "protokollfehler": protokollfehler}


def als_text(zeilen: list[dict]) -> str:
    return "".join(json.dumps(z, ensure_ascii=False) + "\n" for z in zeilen)


def main() -> int:
    ziel = HIER / "folgen"
    ziel.mkdir(exist_ok=True)
    for name, bau in FOLGEN.items():
        text = als_text(bau())
        (ziel / f"{name}.jsonl").write_text(text, encoding="utf-8")
        print(f"geschrieben: djk/vertrag/folgen/{name}.jsonl ({text.count(chr(10))} Schritte)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
