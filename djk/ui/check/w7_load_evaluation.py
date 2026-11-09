#!/usr/bin/env python3
"""Evaluation of the slice 7 load measurement (w7_load.sh): median and maximum per case over the repeats.
Usage: w7_load_evaluation.py <outdir>
Per run: schluss.cb_p999_us (callback p99.9, microseconds), frame_luecken_fenster, grenzen (all must hold), pw-top ERR maximum (xruns), frame gaps, underruns,
from the driver: render time of every merge and the time until the new clip reads dekodiert fertig.
No gate: it only reports (the main instance decides about the transport lock)."""
import json
import statistics
import sys
from pathlib import Path

o = Path(sys.argv[1])


def lade(d):
    e = json.loads((d / "ergebnis.json").read_text()) if (d / "ergebnis.json").exists() else None
    t = [json.loads(z) for z in (d / "treiber.jsonl").read_text().splitlines() if z.strip()] if (d / "treiber.jsonl").exists() else []
    return e, t


fall = {}
for d in sorted(o.iterdir()):
    if not d.is_dir():
        continue
    name = d.name.rsplit("-", 1)[0]
    e, t = lade(d)
    if e is None:
        fall.setdefault(name, []).append({"lauf": d.name, "fehlt": True})
        continue
    merges = [x for x in t if x.get("art") == "merge"]
    ok = [x for x in merges if x.get("ok")]
    fall.setdefault(name, []).append({
        "lauf": d.name,
        "p999_us": e["schluss"]["cb_p999_us"],
        "cb_max_us": e["schluss"].get("cb_max_us"),
        "frame_luecken_fenster": e.get("frame_luecken_fenster"),
        "grenzen_alle": all(e.get("grenzen", {}).values()),
        "rueckgabe": e.get("rueckgabe"),
        "pwtop_err_max": e.get("pwtop", {}).get("err_max"),
        "frame_luecken_gesamt": e.get("frame_luecken_gesamt"),
        "unterlauf_summe": e.get("unterlauf_summe"),
        "merges": len(merges), "merges_ok": len(ok),
        "render_s": [x["render_s"] for x in ok],
        "dekod_s": [x["dekod_s"] for x in ok if x.get("dekod_s") is not None],
        "stems": next((x for x in t if x.get("art") == "stems"), None),
        "fehler": [x.get("grund") for x in merges if not x.get("ok")],
    })

bericht = {}
for name, laeufe in fall.items():
    gut = [x for x in laeufe if not x.get("fehlt")]
    p = [x["p999_us"] for x in gut]
    r = [v for x in gut for v in x["render_s"]]
    dk = [v for x in gut for v in x["dekod_s"]]
    bericht[name] = {
        "laeufe": len(gut),
        "p999_us": p, "p999_median": statistics.median(p) if p else None, "p999_max": max(p) if p else None,
        "frame_luecken_summe": sum(x["frame_luecken_fenster"] or 0 for x in gut),
        "grenzen_alle_gehalten": all(x["grenzen_alle"] for x in gut),
        "pwtop_err_max": [x["pwtop_err_max"] for x in gut],
        "frame_luecken_gesamt": [x["frame_luecken_gesamt"] for x in gut],
        "unterlauf_summe": [x["unterlauf_summe"] for x in gut],
        "merges_gesamt": sum(x["merges"] for x in gut), "merges_ok": sum(x["merges_ok"] for x in gut),
        "render_s_median": statistics.median(r) if r else None, "render_s_max": max(r) if r else None,
        "dekod_s_median": statistics.median(dk) if dk else None, "dekod_s_max": max(dk) if dk else None,
        "stems": [x["stems"] for x in gut if x["stems"]],
        "fehler": [f for x in gut for f in x["fehler"]],
    }
(o / "bericht.json").write_text(json.dumps(bericht, indent=1) + "\n")
print(json.dumps(bericht, indent=1))
