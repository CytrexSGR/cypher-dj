#!/usr/bin/env python3
"""Mutationsmatrix der Hand-Bibliothek (Scheibe 19; Vorbild djk/kern/stellwerk/mutation/mutationen.py, 09 NP b2).

Je Regel genau ein Textersatz (muss genau einmal passen), der diese Regel abschaltet; dann Bau und alle Tests.
Erwartung: je Mutation mindestens ein Fall rot, das Original ganz grün. Nach M01 (Blockgrenze statt Versatz) wird der
mutierte JACK-Prüfclient als build-mut/hand_pruef_blockgrenze aufbewahrt: mit ihm misst Task 11 den Fehlerfall am Ziel.
Arbeitskopie unter build-mut/arbeit (hand, stellwerk, konfig/controller), ein Bauordner, je Mutation zurückgesetzt.
Aufruf (aus djk/kern/hand/): python3 mutation/mutationen.py [<SCHNITTSTELLEN.md>]
  -> mutation/matrix.json, mutation/matrix.md. Bau mit nice -n 19 und ninja -j4 (ROADMAP §8.5). Kein Ton."""
import json
import pathlib
import shutil
import subprocess
import sys

HIER = pathlib.Path(__file__).resolve().parent.parent            # djk/kern/hand
DJK = HIER.parent.parent                                          # djk
MUT = HIER / "build-mut"
ARBEIT = MUT / "arbeit"
BAU = MUT / "bau"

MUTATIONEN = {
    "M01_blockgrenze": ("Ereignis wirkt am Versatz, nicht an der Blockgrenze (§7.3 P1, 09 Probe b naiv_block)", [
        ("src/uebersetzer.cpp", "aus->sample = zyklus_s0 + static_cast<int64_t>(v);",
         "aus->sample = zyklus_s0 + static_cast<int64_t>(n);")]),
    "M02_x_durch_128": ("Stellung = Wert / 127 (Anschlag 127 = 1,0)", [
        ("src/uebersetzer.cpp", "aus->x = static_cast<float>(wert / 127.0);", "aus->x = static_cast<float>(wert / 128.0);")]),
    "M03_zweierkomplement_als_versatz64": ("zweierkomplement vorzeichenrichtig (F4)", [
        ("src/uebersetzer.cpp", "case Kodierung::zweierkomplement: return v < 64 ? v : v - 128;",
         "case Kodierung::zweierkomplement: return v - 64;")]),
    "M04_versatz64_als_zweierkomplement": ("versatz64 vorzeichenrichtig (F4)", [
        ("src/uebersetzer.cpp", "case Kodierung::versatz64: return v - 64;",
         "case Kodierung::versatz64: return v < 64 ? v : v - 128;")]),
    "M05_note_on_0_ist_druck": ("Note-On mit Velocity 0 ist Loslassen", [
        ("src/uebersetzer.cpp", "druck = wert > 0;   // Note-On mit Velocity 0 ist Note-Off", "druck = true;")]),
    "M06_ziel_ungeprueft": ("unbekanntes Ziel wird abgelehnt (§7.2)", [
        ("src/mapping.cpp", "if (ziel->s.size() >= TEXT || !ziel_aufloesen(ziel->s.c_str(), tab, e))",
         "if (ziel->s.size() >= TEXT || (!ziel_aufloesen(ziel->s.c_str(), tab, e) && false))")]),
    "M07_kodierung_ungeprueft": ("falsche Kodierung wird abgelehnt (§7.2)", [
        ("src/mapping.cpp", "    else\n      return p.fehl(FehlerArt::falsche_kodierung, kod->wert.zeile,\n"
                            "                    \"\\\"\" + kod->wert.s + \"\\\" (erlaubt: zweierkomplement, versatz64)\");",
         "    else e->kodierung = Kodierung::zweierkomplement;")]),
    "M08_zeile_immer_1": ("Fehler nennt die Zeile", [
        ("src/mapping.cpp", "    f->zeile = zeile;\n", "    f->zeile = 1;\n")]),
    "M09_umschalten_immer_an": ("Taste schaltet den Schalter um (F5)", [
        ("src/naht_stellwerk.cpp", "g->x = wert_jetzt >= 0.5f ? -1.0f : 1.0f;", "g->x = 1.0f;")]),
    "M10_blinkt_als_an": ("LED-Zustand blinkt sendet den Wert blinkt (§7.2, §7.4)", [
        ("src/led.cpp", "aus[2] = zustand == 0 ? l.aus : zustand == 1 ? l.an : l.blinkt;",
         "aus[2] = zustand == 0 ? l.aus : l.an;")]),
}


def lauf(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def pruefen():
    """Bau und alle Testprogramme; Rückgabe (bau_ok, rote Fälle, grüne Fälle)"""
    b = lauf(["nice", "-n", "19", "ninja", "-C", str(BAU), "-j4"])
    if b.returncode != 0:
        return False, ["BAU"], 0
    rot, gruen = [], 0
    for t in sorted(BAU.glob("hand_test_*")):
        r = lauf([str(t)])
        for z in r.stdout.splitlines():
            if z.startswith("ROT "):
                rot.append(f"{t.name[len('hand_'):]}:{z[4:].strip()}")
            elif z.startswith("OK "):
                gruen += 1
        if r.returncode not in (0, 1):
            rot.append(f"{t.name[len('hand_'):]}:ABSTURZ({r.returncode})")
    return True, rot, gruen


def main():
    vertrag = sys.argv[1] if len(sys.argv) > 1 else str(DJK.parent / "docs/architektur/SCHNITTSTELLEN.md")
    if MUT.exists():
        shutil.rmtree(MUT)
    for teil in ["kern/hand", "kern/stellwerk", "konfig/controller"]:
        shutil.copytree(DJK / teil, ARBEIT / "djk" / teil,
                        ignore=shutil.ignore_patterns("build", "build-*", "__pycache__"))
    q = ARBEIT / "djk/kern/hand"
    k = lauf(["cmake", "-S", str(q), "-B", str(BAU), "-G", "Ninja", f"-DVERTRAG_TEXT={vertrag}"])
    if k.returncode != 0:
        print(k.stdout, k.stderr)
        return 2
    ergebnis = {}
    ok, rot, gruen = pruefen()
    ergebnis["_original"] = {"bau": "ok" if ok else "kaputt", "rot": rot, "gruen": gruen}
    print(f"_original: bau={'ok' if ok else 'kaputt'} rot={len(rot)} gruen={gruen}")
    if not ok or rot:
        print("Original nicht grün, Matrix ohne Aussage")
        return 1
    for name, (regel, ersetzungen) in MUTATIONEN.items():
        alt_inhalt = {}
        for datei, alt, neu in ersetzungen:
            p = q / datei
            s = alt_inhalt.setdefault(p, p.read_text())
            s = p.read_text()
            if s.count(alt) != 1:
                print(f"{name}: Ersatz passt {s.count(alt)}-mal in {datei}")
                return 2
            p.write_text(s.replace(alt, neu))
        ok, rot, gruen = pruefen()
        if name == "M01_blockgrenze" and (BAU / "hand_pruef").exists():
            shutil.copy2(BAU / "hand_pruef", MUT / "hand_pruef_blockgrenze")
        for p, s in alt_inhalt.items():
            p.write_text(s)
        ergebnis[name] = {"bau": "ok" if ok else "kaputt", "rot": rot, "gruen": gruen, "regel": regel}
        print(f"{name}: bau={'ok' if ok else 'kaputt'} rot={len(rot)} gruen={gruen}")
    ok, rot, _ = pruefen()   # zurückgesetzt wieder grün?
    ergebnis["_zurueck"] = {"bau": "ok" if ok else "kaputt", "rot": rot}
    (HIER / "mutation/matrix.json").write_text(json.dumps(ergebnis, indent=1, ensure_ascii=False))
    zeilen = ["| Mutation | abgeschaltete Regel | rote Fälle | Beispiele |", "|---|---|---|---|"]
    for name, e in ergebnis.items():
        if name.startswith("_"):
            continue
        zeilen.append(f"| {name} | {e['regel']} | {len(e['rot'])} | {', '.join(e['rot'][:3])} |")
    (HIER / "mutation/matrix.md").write_text("\n".join(zeilen) + "\n")
    stumm = [n for n, e in ergebnis.items() if not n.startswith("_") and not e["rot"]]
    print("ALLE ROT" if not stumm and not rot else f"STUMM: {stumm} ZURUECK_ROT: {rot}")
    return 0 if not stumm and not rot else 1


if __name__ == "__main__":
    sys.exit(main())
