#!/usr/bin/env python3
"""Folgen-Läufer der Scheibe 31 (Kern-Schiene): der Läufer aus Scheibe 25 (lauf25.py, dünne Ableitung des Läufers aus
08, djk/vertrag/attrappe_leitstand.py) mit Decks. Er ändert beide nicht in ihrer Bedeutung und ergänzt nur, was
djk/vertrag/folgen/FORMAT.md für den Bereich `deck` gegen den echten Kern verlangt:

  * Punkt 21: vor den Folgen schreibt der Läufer das Fixture-Material mit `djk/vertrag/erzeuge_material.py --ziel
    <arbeitsbestand>` in den Arbeitsbestand der Prüfinstanz (§6.4, Vorgabe /dev/shm/cypherdj-<i>/material nach Z2);
    `f0000000000000ff` fehlt mit Absicht (`material_fehlt`).
  * Punkt 14: der Bereich `deck` gilt als gebaut (dazu zeitachse, regler, ki, pruefstand aus 25).
  * Punkt 16, `deck_wert`: der Läufer aus 08 stempelt /zustand/deck schon mit dem Sample des /uhr davor (der Kern
    schickt sie im selben Zyklus direkt danach, mit dem Zustand am Blockanfang) und liest nach FORMAT.md:67 „zwischen
    zwei Meldungen linear, status die letzte davor“. Das trägt nicht, wenn der Status genau zwischen den beiden
    Meldungen wechselt (Start oder Stopp dort): die Gerade liefe dann vom Wert des stehenden Decks zum Wert des
    laufenden. Genau diesen Fall prüft die Golden-Folge start_quell_beat Zeile 9 (quell_beat 16,5 bei Sample 720 000,
    Start genau dort; die Meldungen liegen bei 719 872 mit Status 1 und 720 896 mit Status 2). Dieser Läufer nimmt dann
    die Meldung danach, bei laufendem Deck mit `faktor` auf das Sample zurückgerechnet, bei stehendem unverändert
    (Lesart B2 aus Plan 31; Befund an 09: FORMAT.md:67 um diesen Fall ergänzen). Sonst gilt die Lesart aus 08.

Aufruf: lauf31.py [--arbeitsbestand ORDNER] [alle Parameter von lauf25.py] folge.jsonl [...]
Rückgabe wie lauf25.py: 0 grün, 1 rot, 2 keine Verbindung oder kein Material.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import lauf25  # noqa: E402

al = lauf25.al
GEBAUT = lauf25.GEBAUT + ("deck",)
JE_BEAT = {"quell_beat": 1.0, "beats_bis_ende": -1.0, "faktor": 0.0}  # Änderung je Master-Beat bei Faktor 1


def arbeitsbestand_vorgabe() -> str:
    i = os.environ.get("CYPHERDJ_INSTANZ", "")
    return f"/dev/shm/cypherdj-{i}/material" if i else "/dev/shm/cypherdj/material"


class Lauf31(lauf25.Lauf25):
    def bpm_bei(self, sample: float) -> float:
        """Tempo aus dem letzten /uhr am oder vor dem Sample (§5.2 ,hhddd: sample, t_ns, beat, bpm, ...)."""
        bpm = 128.0
        for m in self.k.eingang:
            if m.adresse == "/uhr" and m.sample <= sample and len(m.werte) > 3:
                bpm = float(m.werte[3])
        return bpm

    def deck_bei(self, deck: int, feld: str, sample: float):
        if feld == "status" or feld not in JE_BEAT:
            return super().deck_bei(deck, feld, sample)
        st = sorted(self.k.deck.get((deck, "status"), []), key=lambda x: x[0])
        vor = [x for x in st if x[0] <= sample]
        nach = [x for x in st if x[0] > sample]
        if not (vor and nach and vor[-1][0] != sample and vor[-1][1] != nach[0][1]):
            return super().deck_bei(deck, feld, sample)
        # Statuswechsel zwischen den beiden Meldungen: die Meldung danach, zurückgerechnet (Lesart B2)
        s1, status1 = nach[0]
        w1 = dict(self.k.deck.get((deck, feld), [])).get(s1)
        faktor = dict(self.k.deck.get((deck, "faktor"), [])).get(s1, 1.0)
        if w1 is None:
            return super().deck_bei(deck, feld, sample)
        if status1 < 2:
            return w1
        spb = 60.0 * al.RATE / self.bpm_bei(s1)
        return w1 - JE_BEAT[feld] * faktor * (s1 - sample) / spb


def material_schreiben(ziel: str) -> tuple[bool, str]:
    r = subprocess.run([sys.executable, str(lauf25.DJK / "vertrag" / "erzeuge_material.py"), "--ziel", ziel],
                       capture_output=True, text=True)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--arbeitsbestand", default=arbeitsbestand_vorgabe())
    a, rest = ap.parse_known_args(argv)
    ok, meldung = material_schreiben(a.arbeitsbestand)
    print(f"Material: {meldung}", flush=True)
    if not ok:
        return 2
    return lauf25.main(rest, lauf_klasse=Lauf31, gebaut=GEBAUT)


if __name__ == "__main__":
    sys.exit(main())
