#!/usr/bin/env python3
"""Auswertung der Latenzprobe Softcontroller -> JACK-MIDI -> Hand-Bibliothek (Scheibe 19, Vorlage 09 Probe c).

Aufruf: python3 auswertung.py <senden.jsonl> <empfang.jsonl> [--erwarte gruen|blockgrenze] > ergebnis.json
  stdout: das Ergebnis als JSON (Feld "urteil"), stderr: GRUEN oder ROT; Rückgabe 0 bei GRUEN
  senden.jsonl  von `softcontroller --mess N --log ...`: je Ereignis i, t_send_us (CLOCK_MONOTONIC), wert
  empfang.jsonl von `hand_pruef --log ...`: je Ereignis cf, cu, nu, n, versatz, sample (aus der Bibliothek), bytes

Zwei Latenzen je Ereignis, beide gegen die Sendezeit:
  latenz_versatz  = cu + versatz/sr - t_send      Instrument, unabhängig von der Bibliothek (wie 09 Probe c)
  latenz_bib      = cu + (sample - cf)/sr - t_send über die Bibliothek (das Sample, an dem der Kern es anwenden wird)
  abweichung      = (sample - cf) - versatz        Samples; 0, wenn die Bibliothek am Versatz ansetzt
Urteil GRUEN (--erwarte gruen, Vorgabe): alle gesendeten angekommen, keine Fremden, Quantum 256 in jedem Block,
alle Abweichungen 0,
latenz_bib p50 in [5,30; 5,36] ms, Spanne <= 0,10 ms. Mit --erwarte blockgrenze (Mutation M01) ist GRUEN: alle
Abweichungen in [1; n] Samples und größte Abweichung >= 4,67 ms (09 Probe b naiv_block) - der Fehler ist gemessen."""
import json
import math
import sys

SR = 48000


def rang(w, q):
    s = sorted(w)
    return s[max(1, math.ceil(q / 100 * len(s))) - 1]


def lies(p):
    return [json.loads(z) for z in open(p) if z.strip()]


def main():
    senden, empfang = lies(sys.argv[1]), lies(sys.argv[2])
    erwarte = sys.argv[sys.argv.index("--erwarte") + 1] if "--erwarte" in sys.argv else "gruen"
    kopf = {z["typ"]: z for z in empfang if z["typ"] != "ereignis"}
    gesendet = [z for z in senden if z["typ"] == "gesendet"]
    ev = [z for z in empfang if z["typ"] == "ereignis"]
    mess = [z for z in ev if z["bytes"][0] == 0xB0 and z["bytes"][1] == 7]   # CC 1/7 = deck/1/fader
    fremd = len(ev) - len(mess)
    paare, j = [], 0
    for g in gesendet:
        while j < len(mess) and mess[j]["bytes"][2] != g["wert"]:
            j += 1
        if j < len(mess):
            paare.append((g, mess[j]))
            j += 1
    verloren = len(gesendet) - len(paare)
    lv, lb, ab, res = [], [], [], []
    for g, e in paare:
        t = g["t_send_us"]
        lv.append((e["cu"] + e["versatz"] / SR * 1e6 - t) / 1000)
        lb.append((e["cu"] + (e["sample"] - e["cf"]) / SR * 1e6 - t) / 1000)
        ab.append((e["sample"] - e["cf"]) - e["versatz"])
        res.append(abs(e["versatz"] - ((e["nu"] - e["cu"]) - (e["cu"] - t)) / 1e6 * SR))
    verbunden_vor_senden = bool(gesendet) and kopf.get("verbunden", {}).get("t_us", 1 << 62) < gesendet[0]["t_send_us"]

    def stat(w):
        return {"p50": round(rang(w, 50), 3), "min": round(min(w), 3), "max": round(max(w), 3),
                "spanne": round(max(w) - min(w), 3)} if w else None

    puffer = kopf.get("uhrvergleich", {}).get("puffer")
    bloecke = sorted({e["n"] for _, e in paare})   # Blocklänge je Ereignis: wechselt das Quantum im Lauf, steht es hier
    erg = {
        "gesendet": len(gesendet), "angekommen": len(paare), "verloren": verloren, "fremd": fremd,
        "puffer": puffer, "bloecke": bloecke, "verbunden_vor_senden": verbunden_vor_senden,
        "latenz_versatz_ms": stat(lv), "latenz_bib_ms": stat(lb),
        "abweichung_samples": stat(ab), "abweichung_ungleich_0": sum(1 for a in ab if a != 0),
        "abweichung_max_ms": round(max(ab) / SR * 1000, 3) if ab else None,
        "residuum_samples": stat(res), "verschiedene_versaetze": len({e["versatz"] for _, e in paare}),
        "ende_pruefclient": kopf.get("ende"),
    }
    gruende = []
    if not gesendet or verloren or not verbunden_vor_senden:
        gruende.append("nicht alle angekommen oder zu spät verbunden")
    if fremd:
        gruende.append(f"{fremd} fremde Ereignisse")
    if puffer != 256 or bloecke != [256]:
        gruende.append(f"Quantum {puffer} (Blöcke {bloecke}) statt 256")
    if erwarte == "gruen":
        if erg["abweichung_ungleich_0"]:
            gruende.append("Bibliothek setzt nicht am Versatz an")
        if lb and not (5.30 <= erg["latenz_bib_ms"]["p50"] <= 5.36):
            gruende.append("p50 nicht eine Periode")
        if lb and erg["latenz_bib_ms"]["spanne"] > 0.10:
            gruende.append("Spanne über 0,10 ms")
    else:
        if not ab or min(ab) < 1 or max(ab) > max(e["n"] for _, e in paare):
            gruende.append("Abweichungen nicht alle in [1; n]")
        if ab and erg["abweichung_max_ms"] < 4.67:
            gruende.append("größte Abweichung unter 4,67 ms")
    erg["urteil"] = "GRUEN" if not gruende else "ROT"
    erg["gruende"] = gruende
    print(json.dumps(erg, indent=1, ensure_ascii=False))   # stdout: nur JSON (ergebnis.json)
    print(erg["urteil"], file=sys.stderr)                   # Urteil für Menschen und lauf.log
    return 0 if not gruende else 1


if __name__ == "__main__":
    sys.exit(main())
