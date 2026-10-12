#!/usr/bin/env python3
"""Erzeugt aus presets.json VST3-Presets (.vstpreset) für Cypher Komp.
Format: Steinberg VST3 SDK, Preset-Datei: 'VST3', Version 1, Klassen-ID als 32 Hex-Zeichen, Offset der Chunk-Liste;
Chunk 'Comp' = Zustand der Komponente, bei nih-plug das JSON aus wrapper/state.rs (PluginState, ohne zstd).
Aufruf: erzeuge.py <zielordner>  (Vorgabe ~/.vst3/presets/Cypher/Cypher Komp)"""
import json, os, struct, sys

KLASSE = b"CypherKompFFLog1"   # komp/src/lib.rs VST3_CLASS_ID (nih-plug nimmt sie unter Linux unverändert)
VERSION = "0.1.0"
hier = os.path.dirname(os.path.abspath(__file__))
ziel = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.vst3/presets/Cypher/Cypher Komp")
os.makedirs(ziel, exist_ok=True)
for name, werte in json.load(open(os.path.join(hier, "presets.json"))).items():
    if name.startswith("_"):
        continue
    zustand = json.dumps({"version": VERSION, "params": {k: ({"bool": v} if isinstance(v, bool) else {"f32": float(v)}) for k, v in werte.items()}, "fields": {}},
                         separators=(",", ":")).encode()
    kopf_laenge = 4 + 4 + 32 + 8
    liste_ab = kopf_laenge + len(zustand)
    d = b"VST3" + struct.pack("<i", 1) + KLASSE.hex().upper().encode() + struct.pack("<q", liste_ab)
    d += zustand
    d += b"List" + struct.pack("<i", 1) + b"Comp" + struct.pack("<qq", kopf_laenge, len(zustand))
    with open(os.path.join(ziel, f"{name}.vstpreset"), "wb") as f:
        f.write(d)
    print(f"{name}.vstpreset {len(d)} B")
