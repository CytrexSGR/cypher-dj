#!/usr/bin/env python3
"""Abnahme der Scheibe 16 aus den Laufordnern: je Profil der Reihe die jüngsten Läufe, ihr Ergebnis, Fremdlast und
Bericht, dazu der P1-Vergleich der zwei jüngsten p1-kern-Läufe. Reihenfolge wie die Abnahme: erst die Instrumente
(Fehlerfall und Negativ-Kontrolle), dann die Zusagen.

  abnahme.py [laeufe-ordner]   schreibt die Tabelle auf stdout; Rückgabewert 0 erfüllt, 1 nicht erfüllt

„Vorläufig“ (ARCHITEKTUR §9.2, ROADMAP §8.5): ein Lauf mit Fremdlast über 4 zählt, wird aber markiert und kommt in M10
wieder. Ein P1-Vergleich außerhalb der Spanne gilt als „vorläufig“, wenn einer der beiden Läufe vorläufig war (unter
Fremdlast ist Reproduzierbarkeit nicht zu zeigen), sonst als nicht erfüllt.
"""
import json
import sys
from pathlib import Path

from last.p1 import vergleiche

HIER = Path(__file__).resolve().parent
REIHE = [("luecke-ziel", 1, "Instrument: künstliche Lücke am Ziel wird gezählt, Stille = Spins ±1 (Fehlerfall)"),
         ("luecke-ziel-null", 1, "Instrument: keine Stille ohne Lücke, obwohl die Quelle verbrennt (Negativ-Kontrolle)"),
         ("naht-kill", 1, "Instrument: Notbahn daneben, kill -9 auf die Prüfquelle: Sprung gemeldet, ≤ 1 Block Stille, "
                          "Schleife treu (Fehlerfall)"),
         ("naht-ruhe", 1, "Negativ-Kontrolle voller Auflösung: 60 s, 0 Sprünge, 0 Stille, 0 Übernahmen"),
         ("luecke-kern", 1, "Instrument: Lückenzähler des Kerns = Lücken am Ziel ±1 (Fehlerfall)"),
         ("kill-notbahn", 1, "Notbahn stirbt, Kern spielt: 0 Lücken am Ziel"),
         ("kill-kern", 5, "kill -9 auf den Kern aus 08: Notbahn schleift, kein Klick fehlt, Raster in der Schleife ±1"),
         ("sigstop-kern", 1, "SIGSTOP auf den Kern aus 08: Notbahn schleift, Rückgabe 1 → 3 → 0 nach SIGCONT"),
         ("p1-kern", 2, "Lastprofil P1 hat gelastet, CPU- und Speicherlast im Bericht (nur mit Freigabe)"),
         ("ruhe-kern", 1, "Negativ-Kontrolle der Abnahme: 10 min, 0 Lücken, kein Klick fehlt")]
P1_SPANNE = 0.15


def laeufe_von(ordner, name):
    """Laufordner <JJJJMMTT-hhmmss>-<name> mit auswertung.json, älteste zuerst."""
    out = []
    for d in sorted(Path(ordner).glob(f"*-{name}")):
        a = d / "auswertung.json"
        if a.exists() and d.name[:15].replace("-", "").isdigit() and d.name[16:] == name:
            out.append((d, json.loads(a.read_text())))
    return out


def zusammenfassen(ordner):
    zeilen = ["| Profil | Zweck | Läufe (verlangt) | Ergebnis | vorläufig | Berichte |", "|---|---|---|---|---|---|"]
    alles, vorlaeufig = True, False
    p1, p1_vorl = None, False
    for name, n, zweck in REIHE:
        l = laeufe_von(ordner, name)[-n:]
        erg = [a["ergebnis"] for _, a in l]
        ok = len(l) == n and all(e == "erfuellt" for e in erg)
        alles &= ok
        vorl = sum(1 for _, a in l if a.get("vorlaeufig"))
        vorlaeufig |= vorl > 0
        zeilen.append(f"| {name} | {zweck} | {len(l)} ({n}) | {', '.join(erg) or 'fehlt'} | {vorl} | "
                      f"{', '.join(str(d.relative_to(ordner)) + '/bericht.md' for d, _ in l)} |")
        if name == "p1-kern" and len(l) == 2:
            p1 = vergleiche(l[0][1]["last"] or {}, l[1][1]["last"] or {})
            p1_vorl = any(a.get("vorlaeufig") for _, a in l)
    p1_ok = p1 is not None and all(v is not None and v <= P1_SPANNE for v in p1.values())
    if p1_ok:
        p1_text = "reproduzierbar"
    elif p1 is not None and p1_vorl:
        p1_text, vorlaeufig = "VORLÄUFIG (außerhalb der Spanne unter Fremdlast über 4, wiederholen in M10)", True
    else:
        p1_text, alles = "NICHT belegt", False
    zeilen += ["", f"P1-Vergleich der zwei jüngsten p1-kern-Läufe (relative Abweichung, Spanne {P1_SPANNE}): "
               f"{json.dumps(p1, ensure_ascii=False) if p1 else 'fehlt'} → {p1_text}",
               "", "Gesamt: " + ("NICHT ERFÜLLT" if not alles else "ERFÜLLT, VORLÄUFIG" if vorlaeufig else "ERFÜLLT")]
    return "\n".join(zeilen), alles


if __name__ == "__main__":
    ordner = Path(sys.argv[1]) if len(sys.argv) > 1 else HIER / "laeufe"
    text, ok = zusammenfassen(ordner)
    print(text)
    sys.exit(0 if ok else 1)
