#!/usr/bin/env python3
"""AK26 (Paket 1.13 Warp, Slice 6 Stems): wertet die Läufe von stems_last_lauf.sh aus und sagt, ob ein echter werkstatt.stems-Lauf (demucs auf der CPU,
nice 19) den Echtzeit-Kern bei Quantum 256 stört.

Eingabe: je Lauf ein Ordner <ausgabe>/<name>/ mit ergebnis.json (Kern-Lauf von ziel_lauf_boxen.py), pwtop.txt (pw-top -b des Laufs), meta.txt und, bei
Lauf `mit`, stems.jsonl (eine JSON-Zeile je Stems-Lauf). Aufruf:
  stems_last_auswertung.py --ohne O1 [O2 ...] --mit M1 [M2 ...] [--ausgabe bericht.json]
Tore (D20; Konstanten unten):
  T1  Median p99,9 (ergebnis.json schluss.cb_p999_us) der `mit`-Läufe höchstens Median(ohne) + 200 µs
  T2  frame_luecken_fenster 0 und alle grenzen/kontrollen wahr in jedem `mit`-Lauf
  T6  Spreizung der `ohne`-Läufe im p99,9 kleiner als 100 µs
  T7  die `ohne`-Läufe halten T2
  T9  Last belegt: je `mit`-Lauf mindestens zwei Zeilen status ok in stems.jsonl, keine Zeile status fehler
  T10 Quantum 256: pwtop.txt jedes Laufs hat mindestens eine Zeile des EIGENEN Kerns (instanz= aus meta.txt), alle mit QUANT 256;
      meta.txt nennt die pw-jack-Zeile von ziel_lauf.py
Urteil: T6, T7, T9 oder T10 reißt -> "Messung ungültig, wiederholen (Grund)"; sonst "AK26 gehalten" oder "AK26 gerissen: ...".
Rückgabe: 0 gehalten, 1 gerissen, 2 ungültig.
"""
import argparse
import json
import re
import statistics
import sys
from pathlib import Path

P999_ZUWACHS_US = 200.0
SPREIZUNG_US = 100.0
STUFEN_MIN_LAEUFE = 2
QUANTUM = "256"

GRUND_UNGUELTIG = {
    "T6_spreizung": "Grundlinie streut zu weit",
    "T7_grundlinie_kern": "Grundlinie reißt selbst eine Kern-Grenze",
    "T9_last": "Last nicht belegt (zu wenige ok-Läufe oder ein Fehler im Stems-Lauf)",
    "T10_quantum": "Quantum nicht durchgehend 256 oder pw-jack-Zeile fehlt",
}
GRUND_GERISSEN = {"T1_p999_zuwachs": "Callback-Schwanz zu hoch", "T2_kern_grenzen": "Kern-Grenzen gerissen"}


def lies(o, name):
    p = Path(o) / name
    return p.read_text(errors="replace") if p.exists() else ""


def lade(o):
    o = Path(o)
    return {"ordner": str(o), "erg": json.loads((o / "ergebnis.json").read_text()), "pwtop": lies(o, "pwtop.txt"),
            "meta": lies(o, "meta.txt"), "stems": lies(o, "stems.jsonl")}


def p999(l):
    return l["erg"]["schluss"]["cb_p999_us"]


def kern_ok(l):
    g = l["erg"].get("grenzen", {})
    return l["erg"].get("frame_luecken_fenster") == 0 and bool(g) and all(g.values()) and all(l["erg"].get("kontrollen", {"x": True}).values())


def stems_zeilen(l):
    """(ok, fehler) aus stems.jsonl; nicht lesbare Zeilen zählen weder als ok noch als Fehler."""
    ok = fehler = 0
    for z in l["stems"].splitlines():
        try:
            s = json.loads(z).get("status")
        except (ValueError, AttributeError):
            continue
        ok += s == "ok"
        fehler += s == "fehler"
    return ok, fehler


def knoten(l):
    """Knotenname des eigenen Kerns aus `instanz=` in meta.txt (None, wenn nicht lesbar)."""
    m = re.search(r"\binstanz=(\S+)", l["meta"])
    return f"cypherdj-kern-{m.group(1)}" if m else None


def quanten(l):
    """QUANT-Felder der Kern-Zeilen des EIGENEN Knotens im Ausgang von pw-top -b (S ID QUANT RATE WAIT BUSY ...; Auswahl wie ziel_lauf_boxen.py:194:
    letztes Feld == Knotenname, 5. Feld auf us/ms). Fremde Instanzen zählen nicht; fehlt der eigene Kern, ist die Liste leer (T10 reißt)."""
    q = []
    eigen = knoten(l)
    for z in l["pwtop"].splitlines():
        t = z.split()
        # QUANT 0: der Knoten ist angelegt, aber noch nicht getrieben (Anlauf, S6 Task 14); nur getriebene Zeilen zählen
        if eigen and len(t) >= 5 and t[-1] == eigen and t[4].endswith(("us", "ms")) and t[2] != "0":
            q.append(t[2])
    return q


def pwjack_ok(l):
    return any("pw-jack" in z and QUANTUM in z for z in l["meta"].splitlines())


def quantum_ok(l):
    q = quanten(l)
    return bool(q) and all(x == QUANTUM for x in q) and pwjack_ok(l)


def auswerten(ohne, mit):
    ohne_p = [p999(x) for x in ohne]
    mit_p = [p999(x) for x in mit]
    zuwachs = statistics.median(mit_p) - statistics.median(ohne_p) if ohne_p and mit_p else None
    t = {}
    t["T1_p999_zuwachs"] = {"ok": zuwachs is not None and zuwachs <= P999_ZUWACHS_US, "ohne_us": ohne_p, "mit_us": mit_p,
                            "zuwachs_median_us": zuwachs, "grenze_us": P999_ZUWACHS_US}
    t["T2_kern_grenzen"] = {"ok": bool(mit) and all(kern_ok(x) for x in mit), "laeufe": [kern_ok(x) for x in mit]}
    t["T6_spreizung"] = {"ok": len(ohne_p) >= 2 and max(ohne_p) - min(ohne_p) < SPREIZUNG_US,
                         "spreizung_us": (max(ohne_p) - min(ohne_p)) if len(ohne_p) >= 2 else None, "grenze_us": SPREIZUNG_US}
    t["T7_grundlinie_kern"] = {"ok": bool(ohne) and all(kern_ok(x) for x in ohne), "laeufe": [kern_ok(x) for x in ohne]}
    zeilen = [stems_zeilen(x) for x in mit]
    t["T9_last"] = {"ok": bool(mit) and all(o >= STUFEN_MIN_LAEUFE and f == 0 for o, f in zeilen), "ok_fehler_je_lauf": zeilen}
    alle = ohne + mit
    t["T10_quantum"] = {"ok": bool(alle) and all(quantum_ok(x) for x in alle), "quanten": [sorted(set(quanten(x))) for x in alle],
                        "pwjack": [pwjack_ok(x) for x in alle]}
    ok = {k: v["ok"] for k, v in t.items()}
    ungueltig = [k for k in GRUND_UNGUELTIG if not ok[k]]
    gerissen = [k for k in GRUND_GERISSEN if not ok[k]]
    if ungueltig:
        urteil = "Messung ungültig, wiederholen (" + "; ".join(GRUND_UNGUELTIG[k] for k in ungueltig) + ")"
    elif gerissen:
        urteil = "AK26 gerissen: " + " und ".join(GRUND_GERISSEN[k] for k in gerissen)
    else:
        urteil = "AK26 gehalten"
    return {"urteil": urteil, "gerissen": [k for k, v in ok.items() if not v], "tore": t}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ohne", nargs="+", required=True)
    ap.add_argument("--mit", nargs="+", required=True)
    ap.add_argument("--ausgabe")
    a = ap.parse_args()
    try:
        r = auswerten([lade(o) for o in a.ohne], [lade(o) for o in a.mit])
    except (FileNotFoundError, ValueError, KeyError) as ex:
        r = {"urteil": f"Messung ungültig, wiederholen (Eingabe unlesbar: {type(ex).__name__}: {ex})", "gerissen": [], "tore": {}}
    text = json.dumps(r, indent=1, ensure_ascii=False)
    if a.ausgabe:
        Path(a.ausgabe).write_text(text + "\n")
    print(text)
    if r["urteil"].startswith("Messung ungültig"):
        return 2
    return 0 if r["urteil"] == "AK26 gehalten" else 1


if __name__ == "__main__":
    sys.exit(main())
