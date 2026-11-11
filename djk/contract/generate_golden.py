#!/usr/bin/env python3
"""Erzeugt die Golden-Folgen der Scheibe 09 (INTERFACES.md §19.3 ohne uhr_golden, storno, protokollfehler, die
Scheibe 02 mit generate_sequences.py liefert) nach folgen/<name>.jsonl und das Verzeichnis sequences/INDEX.json über alle
Folgen (auch die drei von 02).

Jeder Erwartungswert kommt aus map.py (§1.3) und derivation.py (§1.2, §1.5, §1.6, §4, §7.3, §14.4, §16, §17); die
Szenarien stehen in den Modulen aus MODULE, je Bedarf eines (11, 20, 17, Deck-Grammatik, Betrieb). Die Szenarien sind so
gebaut, dass jede Invariante, die eine Folge NICHT prüft, eindeutig hält: eine Folge gilt für das Stellwerk ohne Prüfer
(Scheibe 11) wie für Kern und Attrappe.

Aufruf: python3 djk/contract/generate_golden.py [--ordner ZIEL]   (Vorgabe: folgen/ neben diesem Skript)
"""
import json
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import generate_sequences as erzeuge_folgen  # noqa: E402  (Scheibe 02)
# Plain import statements, not importlib.import_module("folgen_11"): the public export renames modules and rewrites import
# statements, it cannot see a module name inside a string (probe build 2026-11-10: ModuleNotFoundError).
import sequences_11 as folgen_11  # noqa: E402
import sequences_17 as folgen_17  # noqa: E402
import sequences_20 as folgen_20  # noqa: E402
import sequences_operation as folgen_betrieb  # noqa: E402
import sequences_deck as folgen_deck  # noqa: E402

MODULE = [folgen_11, folgen_20, folgen_17, folgen_deck, folgen_betrieb]
VON_02 = {"uhr_golden": ["08", "13"], "storno": ["08", "13"], "protokollfehler": ["08", "13"]}


def alle_folgen():
    return [bau() for m in MODULE for bau in m.FOLGEN]


def zeile_text(z):
    return json.dumps(z, ensure_ascii=False, separators=(",", ":"))


def eintrag(name, vertrag, fuer, zweck, zeilen, material, von):
    return {"name": name, "datei": f"{name}.jsonl", "vertrag": vertrag, "von": von, "fuer": fuer, "zweck": zweck,
            "zeilen": len(zeilen), "material": sorted(material),
            "bereiche": sorted({z.get("bereich", "") for z in zeilen} - {""}),
            "schritt_arten": sorted({z["t"] for z in zeilen})}


def index_zeilen(folgen):
    index = [eintrag(n, n, fuer, "Scheibe 02: " + n, bau(), [], "02")
             for n, fuer in VON_02.items() for bau in [erzeuge_folgen.FOLGEN[n]]]
    index += [eintrag(f.name, f.vertrag, f.fuer, f.zweck, f.zeilen, f.material, "09") for f in folgen]
    return index


def main(argv):
    ziel = pathlib.Path(argv[argv.index("--ordner") + 1]) if "--ordner" in argv else HIER / "sequences"
    ziel.mkdir(parents=True, exist_ok=True)
    folgen = alle_folgen()
    for f in folgen:
        (ziel / f"{f.name}.jsonl").write_text("".join(zeile_text(z) + "\n" for z in f.zeilen), encoding="utf-8")
    index = index_zeilen(folgen)
    (ziel / "INDEX.json").write_text("[\n" + ",\n".join(json.dumps(e, ensure_ascii=False) for e in index) + "\n]\n",
                                     encoding="utf-8")
    print(f"{len(folgen)} Folgen von Scheibe 09 mit {sum(len(f.zeilen) for f in folgen)} Zeilen nach {ziel}; "
          f"INDEX.json mit {len(index)} Einträgen")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
