#!/usr/bin/env python3
"""Fasst einen Abnahme-Ordner der Scheibe 01 zusammen (von abnahme.sh erzeugt) und urteilt nach dem Steckbrief:
ctest grün (normal und ASan/UBSan), Instrument geprüft, Riegel bestanden, Mutation rot mit Streuung 1 bis 255,
5 von 5 Klick-Läufen grün mit 101 Klicks, Streuung 0 und demselben Versatz, ohne /test/klick 0 Klicks,
ohne --pruefmodus /e/protokollfehler und 0 Klicks, Fremdlast vor und nach jedem Lauf.
Aufruf: bericht.py <abnahme-ordner>   schreibt <ordner>/bericht.json und bericht.md, Rückgabe 0 bestanden.
"""
import glob
import json
import os
import re
import sys


def letzte_json(pfad):
    """Letzte JSON-Zeile einer .err-Datei (Kern: zyklen, frame_luecken, w; Notbahn: Zähler), sonst {}."""
    if not os.path.exists(pfad):
        return {}
    zeilen = [z for z in open(pfad, errors="replace") if z.startswith("{")]
    try:
        return json.loads(zeilen[-1]) if zeilen else {}
    except json.JSONDecodeError:
        return {}


def last(meta, wann):
    # 1-Minuten-Mittel; uptime schreibt es je nach Sprache als "20,08, 35,42, 33,19" oder "20.08, 35.42, 33.19"
    m = re.search(rf"uptime_{wann}=.*load average: (\d+[.,]\d+)", meta)
    return float(m.group(1).replace(",", ".")) if m else None


def main():
    d = sys.argv[1]
    lies = lambda n: open(os.path.join(d, n)).read() if os.path.exists(os.path.join(d, n)) else ""
    b = {"ordner": d, "laeufe": []}
    b["ctest_kern"] = "100% tests passed" in lies("ctest_kern.txt")
    b["ctest_kern_asan"] = "100% tests passed" in lies("ctest_kern_asan.txt")
    b["ctest_notbahn"] = "100% tests passed" in lies("ctest_notbahn.txt")
    b["instrument"] = "Instrument geprüft" in lies("instrument.txt")
    b["riegel"] = "Riegel bestanden" in lies("riegel.txt")
    for o in sorted(glob.glob(os.path.join(d, "*-*"))):
        if not os.path.isdir(o) or not os.path.exists(os.path.join(o, "ergebnis.json")):
            continue
        e = json.load(open(os.path.join(o, "ergebnis.json")))
        meta = open(os.path.join(o, "meta.txt")).read()
        pr = {}
        if os.path.exists(os.path.join(o, "pruefer.out")):
            zeilen = [z for z in open(os.path.join(o, "pruefer.out")) if z.startswith("{")]
            pr = json.loads(zeilen[-1]) if zeilen else {}
        kern, nb = letzte_json(os.path.join(o, "kern.err")), letzte_json(os.path.join(o, "notbahn.err"))
        b["laeufe"].append({
            "lauf": os.path.basename(o), "ergebnis": e.get("ergebnis"), "klicks": e.get("klicks"),
            "kern_frame_luecken": kern.get("frame_luecken"), "notbahn": nb,
            "ausgewertet": e.get("ausgewertet"), "versatz": e.get("versatz_samples"),
            "quantum": (e.get("aufnahme") or {}).get("quantum"),
            "streuung": e.get("streuung_samples"), "max_abweichung": e.get("max_abweichung_samples"),
            "instrument": e.get("instrument"), "pruefer_erfuellt": pr.get("erfuellt"), "pruefer_antwort": pr.get("antwort"),
            "senke_treibt": ((e.get("instrument") or {}).get("graph") or {}).get("senke_treibt"), "grund": e.get("grund"),
            "last_vorher": last(meta, "vorher"), "last_nachher": last(meta, "nachher"),
            "gpu_vorher": (re.search(r"gpu_vorher=(.*)", meta) or [None, None])[1],
            "gpu_nachher": (re.search(r"gpu_nachher=(.*)", meta) or [None, None])[1]})
    art = lambda a: [x for x in b["laeufe"] if x["lauf"].startswith(a + "-")]
    brauchbar = lambda xs: [x for x in xs if x["ergebnis"] != "unbrauchbar"]
    klick = brauchbar(art("klick"))
    mut = brauchbar(art("mutation"))
    ohne = brauchbar(art("ohne-klick"))
    ohnep = brauchbar(art("ohne-pruefmodus"))
    b["pruefung"] = {
        "klick_5_von_5": len(klick) >= 5 and all(x["ergebnis"] == "gruen" and x["ausgewertet"] == 101 and
                                                 x["streuung"] == 0 and x["pruefer_erfuellt"] and x["quantum"] == 256
                                                 for x in klick[:5]),
        "klick_versatz_gleich": len({x["versatz"] for x in klick[:5]}) == 1 if klick else False,
        "mutation_rot": bool(mut) and mut[0]["ergebnis"] == "rot" and 0 < (mut[0]["streuung"] or 0) <= 255,
        "ohne_klick_0": bool(ohne) and ohne[0]["ergebnis"] == "gruen" and ohne[0]["klicks"] == 0,
        "ohne_pruefmodus": bool(ohnep) and ohnep[0]["ergebnis"] == "gruen" and ohnep[0]["klicks"] == 0
                           and ohnep[0]["pruefer_erfuellt"] is True,
        "unbrauchbare_laeufe": sum(1 for x in b["laeufe"] if x["ergebnis"] == "unbrauchbar"),
    }
    lasten = [v for x in b["laeufe"] for v in (x["last_vorher"], x["last_nachher"]) if v is not None]
    b["fremdlast_max"] = max(lasten) if lasten else None
    b["vorlaeufig"] = b["fremdlast_max"] is None or b["fremdlast_max"] > 4.0
    p = b["pruefung"]
    b["bestanden"] = all([b["ctest_kern"], b["ctest_kern_asan"], b["ctest_notbahn"], b["instrument"], b["riegel"],
                          p["klick_5_von_5"], p["klick_versatz_gleich"], p["mutation_rot"], p["ohne_klick_0"],
                          p["ohne_pruefmodus"]])
    json.dump(b, open(os.path.join(d, "bericht.json"), "w"), indent=1, ensure_ascii=False)
    z = [f"# Abnahme Scheibe 01, {os.path.basename(d)}", "",
         f"Ergebnis: {'bestanden' if b['bestanden'] else 'NICHT bestanden'}"
         f"{', vorläufig (Fremdlast über 4, Wiederholung in Scheibe 61)' if b['vorlaeufig'] else ''}", "",
         f"ctest Kern {b['ctest_kern']}, ASan/UBSan {b['ctest_kern_asan']}, Notbahn {b['ctest_notbahn']}; "
         f"Instrument {b['instrument']}; Riegel {b['riegel']}; unbrauchbare Läufe {p['unbrauchbare_laeufe']}", "",
         f"Versatz der Klick-Läufe: {[x['versatz'] for x in klick[:5]]}, gleich: {p['klick_versatz_gleich']}", "",
         "| Lauf | Ergebnis | Klicks | Versatz | Streuung | max. Abw. | Senke treibt | Kern-Lücken "
         "| Notbahn 1/2 Blöcke, Unterlauf, Sprung | Last vorher | Last nachher | GPU vorher | GPU nachher |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for x in b["laeufe"]:
        nb = x["notbahn"]
        z.append(f"| {x['lauf']} | {x['ergebnis']} | {x['klicks']} | {x['versatz']} | {x['streuung']} | "
                 f"{x['max_abweichung']} | {x['senke_treibt']} | {x['kern_frame_luecken']} | {nb.get('abstand_1_block')}/"
                 f"{nb.get('abstand_2_bloecke')}, {nb.get('unterlauf')}, {nb.get('sprung')} | "
                 f"{x['last_vorher']} | {x['last_nachher']} | {x['gpu_vorher']} | {x['gpu_nachher']} |")
    z += ["", "Verworfene Läufe (unbrauchbar) mit Grund:"] + [f"- {x['lauf']}: {x['grund']}" for x in b["laeufe"]
                                                               if x["ergebnis"] == "unbrauchbar"]
    open(os.path.join(d, "bericht.md"), "w").write("\n".join(z) + "\n")
    print("\n".join(z))
    return 0 if b["bestanden"] else 1


if __name__ == "__main__":
    sys.exit(main())
