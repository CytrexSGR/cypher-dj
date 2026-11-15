#!/usr/bin/env python3
"""Render check for the Drift knob and the wave envelope.

    python3 measure_drift_hull.py OLD_DIR OUT_DIR

OLD_DIR holds the graphs from before the change as synth-poly.old.json, synth-mono.old.json, wavetable-{chor,reese,supersaw}.old.json.
For every factory preset (and for the all-0.5 default) it renders the old graph and the new graph with the new knob off, byte-compares
the two WAVs (null test), and renders the new graph with the knob on. Reports peak, RMS and silence per render into OUT_DIR/messung.json.
Needs the release `render` example (cargo build --release --example render).
"""
import json
import pathlib
import subprocess
import sys
import wave

import numpy as np

HIER = pathlib.Path(__file__).resolve().parent
RENDER = HIER.parent / "target" / "release" / "examples" / "render"
PRESETS = HIER.parents[1] / "ui" / "presets" / "factory" / "modular"
alt, aus = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
aus.mkdir(parents=True, exist_ok=True)


def render(graph, wav, knobs):
    subprocess.run([str(RENDER), str(graph), str(wav)] + [f"{n}={v}" for n, v in sorted(knobs.items())], check=True, capture_output=True)


def messen(wav):
    w = wave.open(str(wav))
    y = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    peak = float(abs(y).max())
    rms = float(np.sqrt(np.mean(y ** 2)))
    db = lambda v: round(20 * np.log10(max(v, 1e-9)), 2)
    return {"peak_dbfs": db(peak), "rms_dbfs": db(rms), "clipped": bool(peak >= 32767 / 32768), "silent": bool(rms < 1e-4), "nan": bool(np.isnan(y).any())}


def preset_knobs(datei):
    return {int(k[4:]): v for k, v in json.loads(datei.read_text())["werte"].items()}


ergebnis = {}
ok = True


def fall(name, graph_alt, graph_neu, knobs, knopf, an):
    """null: the new graph with the new knob at `aus_wert` must equal the old graph byte for byte."""
    global ok
    d = aus / name
    render(graph_alt, d.with_suffix(".alt.wav"), knobs)
    row = {}
    for etikett, wert in (("aus", knopf[1]), ("an", an)):
        render(graph_neu, d.with_suffix(f".{etikett}.wav"), {**knobs, knopf[0]: wert})
        row[etikett] = messen(d.with_suffix(f".{etikett}.wav"))
    row["alt"] = messen(d.with_suffix(".alt.wav"))
    row["null_identisch"] = d.with_suffix(".alt.wav").read_bytes() == d.with_suffix(".aus.wav").read_bytes()
    row["an_ungleich_aus"] = d.with_suffix(".an.wav").read_bytes() != d.with_suffix(".aus.wav").read_bytes()
    row["pegel_ok"] = all(not row[k]["clipped"] and not row[k]["silent"] and not row[k]["nan"] for k in ("alt", "aus", "an"))
    ok &= row["null_identisch"] and row["an_ungleich_aus"] and row["pegel_ok"]
    ergebnis[name] = row
    if not row["null_identisch"]:
        print("NULL TEST FAILED", name)
    # disk budget: the old render equals the "aus" render when the null test passes; keep "aus" only for the default cases
    d.with_suffix(".alt.wav").unlink()
    if "standard.drift" not in name or name.endswith("drift1"):
        d.with_suffix(".aus.wav").unlink()


# drift: knob off = 0.0 (normalised), on = the panel default 0.25 and full 1.0
for graph, knopf in (("synth-poly", 28), ("synth-mono", 32)):
    neu = HIER / "demos" / f"{graph}.json"
    alt_graph = alt / f"{graph}.old.json"
    faelle = [("standard", {})] + [(p.stem.replace(".preset", ""), preset_knobs(p)) for p in sorted(PRESETS.glob(f"{graph}-*.preset.json"))]
    for nm, k in faelle:
        k = {n: v for n, v in k.items() if n != knopf}
        fall(f"{nm}.drift", alt_graph, neu, k, (knopf, 0.0), 0.25)
    # full drift once on the default
    fall(f"{graph}-standard.drift1", alt_graph, neu, {}, (knopf, 0.0), 1.0)

# wave envelope: knob 7 at 0.5 = amount 0 is the null; on = the preset's own value (or +1 for the default)
for graph in ("wavetable-chor", "wavetable-reese", "wavetable-supersaw"):
    neu = HIER / "demos" / f"{graph}.json"
    alt_graph = alt / f"{graph}.old.json"
    fall(f"{graph}-standard.huelle", alt_graph, neu, {}, (7, 0.5), 0.6)
    for p in sorted(PRESETS.glob(f"{graph}-*.preset.json")):
        k = preset_knobs(p)
        an = k.pop(7)
        # the old graph has knobs 1..6 only
        fall(f"{p.stem.replace('.preset', '')}.huelle", alt_graph, neu, {n: v for n, v in k.items() if n <= 6}, (7, 0.5), an)

(aus / "messung.json").write_text(json.dumps(ergebnis, indent=1))
for n, r in ergebnis.items():
    print(f"{n:48s} null={r['null_identisch']!s:5} an!=aus={r['an_ungleich_aus']!s:5} peak(an)={r['an']['peak_dbfs']:7} rms(an)={r['an']['rms_dbfs']:7}")
print("ALL OK" if ok else "FAILURES")
sys.exit(0 if ok else 1)
