#!/usr/bin/env python3
"""Messprobe Arbeitsfaden-Last (Paket 1.13 Warp, vor Slice 2): wertet die Läufe von warp_last_lauf.sh aus und sagt, ob Slice 2 (Warp-Werk) so
gebaut werden kann, wie die Spec es plant (32 Spuren, 4 Fäden, Vorlauf 8192), oder ob der Plan sinken muss.

Eingabe: je Lauf ein Ordner <ausgabe>/<name>/ mit ergebnis.json (der Kern-Lauf von ziel_lauf_boxen.py) und, bei Lauf mit Werk, werk.json (die JSON-Zeile
von kern_kosten_warp_werk --json). Aufruf:
  warp_last_auswertung.py --ohne O1 [O2 ...] --mit M1 [M2 ...] [--fein F1 ...] [--zwei Z1 ...] [--halb H1 ...] [--instrument I.json] [--ausgabe bericht.json]
Tore für die Gruppe `mit` (Spec 1.13 AK31, R1; gemessen gegen die Gruppe `ohne` derselben Sitzung):
  T1  Callback p99,9 (Schlusszeile des Kerns, Median der Läufe) höchstens Median(ohne) + 150 µs
  T2  frame_luecken im Messfenster 0 und Keylock-Unterlauf/aufgegeben 0 in jedem Lauf (die Grenzen von ziel_lauf_boxen.py sind gehalten)
  T3  Werk: Unterläufe 0 in jedem Lauf
  T4  Werk: nach jedem Neuansatz aller Stimmen halten die Ringe binnen 43 ms (ARR_WARP_FRIST = 2048 Frames) wieder 2048 Frames
  T5  Instrument: der Lauf mit Last-Fäden auf einem Kern (--instrument) zeigt Unterläufe > 0 (sonst war die Messung blind)
  T6  Spreizung: der größte Abstand zweier `ohne`-Läufe im p99,9 ist kleiner als 100 µs (sonst sind 150 µs nicht aufzulösen)
  T7  Grundlinie: die `ohne`-Läufe halten selbst die Kern-Grenzen von T2 (sonst ist der Bezug kaputt)
  T8  Priorität: jedes Werk (mit, fein/zwei/halb, Instrument) hat SCHED_FIFO angefordert und für jeden Faden bekommen (`prio_fehler` 0 in werk.json)
Die Varianten fein/zwei/halb werden an denselben Toren T1 bis T4 gemessen wie `mit`; eine Variante hält, wenn alle vier halten.
Urteil: T5, T6, T7 oder T8 reißt -> "Messung ungültig, wiederholen (Grund)"; alle Tore -> "S2 wie geplant"; T3 oder T4 reißt -> "S2 nur mit mehr Vorlauf
oder Fäden (Matrix prüfen)"; sonst (T3, T4 halten, der Kern leidet) nennt das Urteil, was riss: "Callback-Schwanz zu hoch" (T1), "Kern-Grenzen gerissen" (T2)
oder beides, jeweils mit ": halten <Varianten, die T1 bis T4 halten>" oder "nur keine der Varianten fein/zwei/halb". Im Ergebnis steht `gerissen` (alle
gerissenen Tore) und `varianten` (je Variante die Tore).
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

FRIST_MS = 43.0
P999_ZUWACHS_US = 150.0
SPREIZUNG_US = 100.0


def lade(o):
    o = Path(o)
    erg = json.loads((o / "ergebnis.json").read_text())
    werk = None
    if (o / "werk.json").exists() and (o / "werk.json").read_text().strip():
        werk = json.loads((o / "werk.json").read_text())
    return {"ordner": str(o), "erg": erg, "werk": werk}


def p999(l):
    return l["erg"]["schluss"]["cb_p999_us"]


def kern_ok(l):
    g = l["erg"].get("grenzen", {})
    return l["erg"].get("frame_luecken_fenster") == 0 and bool(g) and all(g.values()) and all(l["erg"].get("kontrollen", {"x": True}).values())


def gruppe(name, ordner):
    return [lade(o) for o in (ordner or [])]


def prio_ok(w):
    """Das Werk hat SCHED_FIFO angefordert (prio > 0) und für jeden Faden bekommen (prio_fehler == 0). Fehlt die Meldung (älterer Programmstand), gilt es nicht."""
    return w.get("prio", 0) > 0 and w.get("prio_fehler", 1) == 0


def tore_gruppe(ohne_p, laeufe):
    """T1 bis T4 für eine Gruppe von Läufen mit Werk (`mit` oder eine Variante), gemessen an den p99,9 der Grundlinie."""
    t = {}
    med_ohne = statistics.median(ohne_p) if ohne_p else None
    mit_p = [p999(x) for x in laeufe]
    zuwachs = None if med_ohne is None or not mit_p else statistics.median(mit_p) - med_ohne
    t["T1_p999_zuwachs"] = {"ok": zuwachs is not None and zuwachs <= P999_ZUWACHS_US, "ohne_us": ohne_p, "mit_us": mit_p, "zuwachs_median_us": zuwachs,
                            "grenze_us": P999_ZUWACHS_US}
    t["T2_kern_grenzen"] = {"ok": bool(laeufe) and all(kern_ok(x) for x in laeufe), "laeufe": [kern_ok(x) for x in laeufe]}
    werke = [x["werk"] for x in laeufe if x["werk"]]
    t["T3_werk_unterlauf"] = {"ok": bool(werke) and len(werke) == len(laeufe) and all(w["unterlauf"] == 0 for w in werke), "unterlauf": [w["unterlauf"] for w in werke],
                              "reserve_min_frames": [w["reserve_min_frames"] for w in werke]}
    sturm = [s for w in werke for s in w.get("sturm_ms", [])]
    t["T4_sturm"] = {"ok": bool(sturm) and all(0 < s <= FRIST_MS for s in sturm), "ms": sturm, "grenze_ms": FRIST_MS}
    return t, werke


GRUND_UNGUELTIG = {
    "T5_instrument": "Instrument-Check ohne Unterläufe",
    "T6_spreizung": "Grundlinie streut zu weit",
    "T7_grundlinie_kern": "Grundlinie reißt selbst eine Kern-Grenze",
    "T8_prio": "SCHED_FIFO nicht für jeden Faden gesetzt",
}


def auswerten(ohne, mit, andere, instrument):
    ohne_p = [p999(x) for x in ohne]
    t, werke = tore_gruppe(ohne_p, mit)
    t["T5_instrument"] = {"ok": instrument is not None and instrument["unterlauf"] > 0, "unterlauf": None if instrument is None else instrument["unterlauf"]}
    t["T6_spreizung"] = {"ok": len(ohne_p) >= 2 and max(ohne_p) - min(ohne_p) < SPREIZUNG_US, "spreizung_us": (max(ohne_p) - min(ohne_p)) if len(ohne_p) >= 2 else None,
                         "grenze_us": SPREIZUNG_US}
    t["T7_grundlinie_kern"] = {"ok": bool(ohne) and all(kern_ok(x) for x in ohne), "laeufe": [kern_ok(x) for x in ohne]}
    # Varianten: jede an denselben Toren T1 bis T4 gemessen, nicht nur am p99,9; sie hält nur, wenn alle halten
    varianten = {}
    for n, g in andere.items():
        if g:
            tv, wv = tore_gruppe(ohne_p, g)
            varianten[n] = {"haelt": all(v["ok"] for v in tv.values()), "tore": {k: v["ok"] for k, v in tv.items()}, "werke": wv}
    # SCHED_FIFO: jeder Lauf mit Werk (mit, Varianten) und der Instrument-Check müssen die Priorität bekommen haben
    prio_werke = werke + [w for v in varianten.values() for w in v["werke"]] + ([instrument] if instrument is not None else [])
    t["T8_prio"] = {"ok": bool(prio_werke) and all(prio_ok(w) for w in prio_werke), "prio_fehler": [w.get("prio_fehler") for w in prio_werke]}
    cpu = [w["cpu_kerne"] for w in werke]
    mib = [w["mib_je_stimme"] for w in werke]
    korn = [(w["korn_p50_us"], w["korn_p99_us"], w["korn_p999_us"], w["korn_max_us"]) for w in werke]
    t["bericht_werk"] = {"cpu_kerne": cpu, "mib_je_stimme": mib, "korn_p50_p99_p999_max_us": korn}
    alle = {k: v["ok"] for k, v in t.items() if k.startswith("T")}
    gerissen = [k for k, ok in alle.items() if not ok]
    ungueltig = [k for k in GRUND_UNGUELTIG if not alle[k]]
    kern_tore = ("T1_p999_zuwachs", "T2_kern_grenzen")
    if ungueltig:
        urteil = "Messung ungültig, wiederholen (" + "; ".join(GRUND_UNGUELTIG[k] for k in ungueltig) + ")"
    elif all(alle.values()):
        urteil = "S2 wie geplant (32 Spuren COMPLEX, 4 Fäden, Vorlauf 8192)"
    elif not (alle["T3_werk_unterlauf"] and alle["T4_sturm"]):
        urteil = "S2 nur mit mehr Vorlauf oder Fäden (die Matrix fein/zwei/halb und einen größeren --vorlauf prüfen)"
    else:
        # T3 und T4 halten; der Kern leidet: der Schwanz (T1), die Grenzen (T2) oder beides. Das Urteil nennt, was riss, damit Task 17 nicht auf einen
        # Schwanz schließt, der hielt.
        was = {kern_tore[0]: "Callback-Schwanz zu hoch", kern_tore[1]: "Kern-Grenzen gerissen"}
        genannt = " und ".join(was[k] for k in kern_tore if not alle[k])
        gut = [n for n, v in varianten.items() if v["haelt"]]
        urteil = genannt + ": halten " + (", ".join(gut) or "nur keine der Varianten fein/zwei/halb")
    return {"urteil": urteil, "gerissen": gerissen, "tore": t, "varianten": {n: {"haelt": v["haelt"], "tore": v["tore"]} for n, v in varianten.items()}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ohne", nargs="+", required=True)
    ap.add_argument("--mit", nargs="+", required=True)
    for n in ("fein", "zwei", "halb"):
        ap.add_argument(f"--{n}", nargs="*", default=[])
    ap.add_argument("--instrument", help="werk.json eines Laufs mit --last auf einem Kern (taskset)")
    ap.add_argument("--ausgabe")
    a = ap.parse_args()
    ohne, mit = gruppe("ohne", a.ohne), gruppe("mit", a.mit)
    andere = {n: gruppe(n, getattr(a, n)) for n in ("fein", "zwei", "halb")}
    instrument = json.loads(Path(a.instrument).read_text().strip().splitlines()[-1]) if a.instrument else None
    r = auswerten(ohne, mit, andere, instrument)
    text = json.dumps(r, indent=1, ensure_ascii=False)
    if a.ausgabe:
        Path(a.ausgabe).write_text(text + "\n")
    print(text)
    return 0 if r["urteil"].startswith("S2 wie geplant") else 1


if __name__ == "__main__":
    sys.exit(main())
