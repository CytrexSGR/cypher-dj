#!/usr/bin/env python3
"""Helper of alles.sh --betroffen: which suites (and which files of them) a change touches.

    betroffen.py [--gegen REF] [--ziel DIR]

Changed files = the working tree (staged, unstaged, untracked) against REF (default: merge base with origin/main), like fast.py, whose
file selection by name it reuses. Prints one line per decision:
    ESKALATION <reason>        the change can reach every suite: run the whole gate
    SUITE <name>               run this suite as a whole
    DATEIEN <name> <n>         run only n files of this suite; they are listed in DIR/<name>.txt (relative to the suite's folder)
    NICHTS <path>              a changed path no suite covers (reported, runs nothing)
Escalation: CMake files, C/C++ headers, anything under djk/contract (except its tests and mock_core), lockfiles and manifests of the
dependencies, the gate itself (djk/tools/alles*, fast.py, betroffen.py, skips_decke.txt, quarantaene.txt, the page test lists, djk/tools/ci/**,
the CI workflow folder .<host>/workflows/**) and third_party/**. Exception: a change to a test list (serial.txt, serial_zeiten.txt,
serial_instanz.txt, ruhig.txt of the page or generator tests) that only adds or removes entries runs the test files those entries name, in their new
place; a changed comment line costs nothing; a line that cannot be read as an entry escalates as before. A changed core source (.cpp, .c, a test script) runs the core suite whole, plus every page test that starts
cypherdj-render (found by grep) and the hand suite; a changed .rs or Cargo.toml runs the instruments suite whole, a changed file under djk/start
runs the start-sh suite (and py-start for .py). Node and pytest suites run the test files that are changed, that name the changed source, or that
reach it through their imports (transitively, also across packages: a mock_core change selects the page tests that import it).
A changed path that no suite and no test covers escalates to the whole gate. NICHTS is only for an allow list of proven irrelevant paths
(.gitignore, licences, a deleted test file; documentation and *.md select the tests that name them, and nothing if no test does).
A git error, an unknown --gegen ref or a missing merge base with origin/main ends with exit 2 and no plan.
Exit 0; 2 usage or git error.
"""
import argparse
import re
import sys
from pathlib import Path

import alles_verteilen
import fast as schnell

DJK = schnell.DJK
REPO = schnell.REPO
# test folder of the node packages -> suite name
NODE_SUITE = {"hand": "hand", "conductor": "conductor", "cues": "cues", "loops": "loops", "player_cli": "player_cli",
              "generator": "generator", "contract/mock_core": "mock_core", "tools": "tools-node"}
PY_SUITES = {"tools", "workshop", "contract", "carla", "bibliothek", "sound", "starter", "key_energy", "start", "generator",
             "structure_suggestion", "testbench", "ablage", "hand_bruecke", "loops", "quellen", "third_party"}
LOCK_NAMEN = {"package.json", "package-lock.json", "requirements.txt", "Cargo.lock", "pnpm-lock.yaml", "yarn.lock", "pytest.ini", "conftest.py"}
KERN_KOPF = (".h", ".hpp", ".hh", ".inl", ".cmake")
GATE = ("djk/tools/alles", "djk/tools/quarantaene.txt", "djk/tools/skips_decke.txt", "djk/ui/tests/serial", "djk/ui/tests/ruhig", "djk/generator/tests/ruhig",
        "djk/tools/betroffen", "djk/tools/schnell", "djk/tools/ci/", "third_party/", "djk/third_party/")
# the CI workflow folder of the git host, whatever the host is called (.<host>/workflows/...)
CI_ORDNER_RX = re.compile(r"\.[a-z]+/workflows/")
# test lists that only distribute test files: list -> (folder of the named files, index of the file name in a line split on whitespace)
TEST_LISTEN = {"djk/ui/tests/serial.txt": ("djk/ui/tests", 0), "djk/ui/tests/ruhig.txt": ("djk/ui/tests", 0),
               "djk/ui/tests/serial_zeiten.txt": ("djk/ui/tests", 1), "djk/ui/tests/serial_instanz.txt": ("djk/ui/tests", 1),
               "djk/generator/tests/ruhig.txt": ("djk/generator/tests", 0)}
TEST_DATEI_RX = re.compile(r"^[A-Za-z0-9_.-]+\.test\.(mjs|js|ts)$")
RENDER_RX = re.compile(r"cypherdj-render|CYPHERDJ_RENDER|cypherdj-noten|CYPHERDJ_NOTEN")


def render_tests():
    """Page test files that start the real cypherdj-render (found by grep, stand-ins left out), with the tests that import a helper that does."""
    ui = schnell.DJK / "ui"
    # only under tests/: the production sources (paths.ts names the program too) are imported by nearly every test and would select all of them
    samen = [p for p in schnell.test_dateien(ui / "tests", "*.mjs") + schnell.test_dateien(ui / "tests", "*.ts")
             if "attrappe" not in p.name and RENDER_RX.search(p.read_text(errors="ignore"))]
    tests = {p for p in samen if schnell.ist_test(p)}
    helfer = [str(p.relative_to(REPO)) for p in samen if not schnell.ist_test(p)]
    if helfer:
        tests |= {t for t in schnell.importeure(helfer) if schnell.wurzel_von(t) == ui}
    return tests


def doku(rel):
    """Prose and documentation: *.md anywhere, and everything under docs/. Tests do read some of them (the public README and features page are
    counted by hand_presets and ui_woerter), so such a path selects the tests that name it, and nothing when no test does."""
    return rel.endswith(".md") or rel.startswith("docs/")


def doku_tests(rel):
    """Node tests of every package whose text names the file: its name together with its folder's name (`docs` + `features.md`)."""
    p = Path(rel)
    return [t for t in schnell.node_tests_aller_pakete()
            if p.name in (txt := t.read_text(errors="ignore")) and (not p.parent.name or p.parent.name in txt)]


def harmlos(rel, geloescht):
    """True for a changed path that is proven irrelevant for every test (an explicit allow list, nothing is guessed)."""
    n = Path(rel).name
    if n in (".gitignore", ".gitattributes") or n.startswith(("LICENSE", "LICENCE", "NOTICE")):
        return True
    return bool(geloescht and schnell.ist_test(Path(rel)))


def git_zeilen(ref):
    """-> fn(rel) -> list of the added and removed lines of rel against ref (the +/- lines of a zero-context diff)."""
    def zeilen(rel):
        aus = schnell.git("diff", "-U0", "--no-renames", ref, "--", rel)
        return [z[1:] for z in aus.splitlines() if z[:1] in "+-" and not z.startswith(("+++", "---"))]
    return zeilen


def listen_eintraege(rel, zeilen):
    """Test files named by the changed lines of a test list, or None when a changed line is not a plain entry (then the list escalates).
    Comment and blank lines name nothing."""
    ordner, feld = TEST_LISTEN[rel]
    namen = set()
    for z in zeilen:
        kern = z.split("#")[0].split()
        if not kern:
            if z.strip() and not z.lstrip().startswith("#"):
                return None
            continue
        if len(kern) <= feld or not TEST_DATEI_RX.match(kern[feld]):
            return None
        namen.add(f"{ordner}/{kern[feld]}")
    return namen


def eskalation(rel):
    """Reason to run the whole gate for this changed path, or None."""
    n = Path(rel).name
    t = rel.split("/")
    if n in LOCK_NAMEN and not (n == "conftest.py" and "tests" in t):
        return f"{rel}: lockfile, manifest or test configuration"
    if n == "CMakeLists.txt" or n.endswith(".cmake"):
        return f"{rel}: CMake"
    if rel.startswith("djk/core/") and n.endswith(KERN_KOPF):
        return f"{rel}: header"
    if rel.startswith(GATE) or CI_ORDNER_RX.match(rel):
        return f"{rel}: the gate itself"
    if rel.startswith("djk/contract/") and not rel.startswith("djk/contract/mock_core/") and not schnell.ist_test(Path(rel)) and not rel.endswith(".md"):
        return f"{rel}: contract"
    return None


def suite_von(rel):
    """Suite for a changed path that selects a whole suite, or None."""
    t = rel.split("/")
    if len(t) < 3 or t[0] != "djk":
        return None
    if t[1] == "core":
        return "core"
    if t[1] == "instruments" and rel.endswith((".rs", ".toml")):
        return "instruments"
    if t[1] == "start" and not rel.endswith(".md"):
        return "start-sh"
    return None


def plane(dateien, ui_shards=None, auswahl_fn=schnell.auswahl_voll, zeilen_fn=None):
    """-> (eskalation, suites, dateien, nichts). eskalation: list of reasons; suites: set; dateien: {suite: set of paths relative to the suite folder}.
    zeilen_fn(rel) gives the changed lines of a test list (see git_zeilen); without it a changed test list escalates."""
    if zeilen_fn:
        neu = []
        for rel in dateien:
            namen = listen_eintraege(rel, zeilen_fn(rel)) if rel in TEST_LISTEN else None
            if namen is None:
                neu.append(rel)
            else:
                # a removed entry whose file is gone names nothing to run
                neu.extend(n for n in sorted(namen) if (REPO / n).exists())
        dateien = sorted(set(neu))
    gruende = [g for g in (eskalation(r) for r in dateien) if g]
    if gruende:
        return gruende, set(), {}, []
    suites, nichts = set(), []
    doku_node = {}
    for rel in list(dateien):
        if doku(rel):
            ts = doku_tests(rel)
            for t in ts:
                doku_node.setdefault(schnell.wurzel_von(t), set()).add(t)
            if not ts:
                nichts.append(rel)
            dateien = [d for d in dateien if d != rel]
    for rel in dateien:
        s = suite_von(rel)
        if s:
            suites.add(s)
            if rel.startswith("djk/start/") and rel.endswith(".py"):
                suites.add("py-start")
        elif schnell.bereich(rel) is None:
            if harmlos(rel, not (REPO / rel).exists()):
                nichts.append(rel)
            else:
                gruende.append(f"{rel}: no suite covers this path")
    node, py, kern, luecken = auswahl_fn(dateien)
    for rel in luecken:
        if not harmlos(rel, not (REPO / rel).exists()):
            gruende.append(f"{rel}: no test names it or imports it")
    if gruende:
        return gruende, set(), {}, []
    for w, ts in doku_node.items():
        node.setdefault(w, set()).update(ts)
    if kern or "core" in suites:
        suites.add("core")
        suites.add("hand")
        ui = schnell.DJK / "ui"
        node.setdefault(ui, set()).update(render_tests())
    datei = {}
    shards = ui_shards or list("abcdefgh")
    ruhig_ui = alles_verteilen.lies_ruhig(schnell.DJK / "ui/tests/ruhig.txt")
    ruhig_gen = alles_verteilen.lies_ruhig(schnell.DJK / "generator/tests/ruhig.txt")
    serial = alles_verteilen.ohne_ruhig(alles_verteilen.lies_serial(schnell.DJK / "ui/tests/serial.txt"), schnell.DJK / "ui/tests/ruhig.txt")
    verteilung = alles_verteilen.verteile(serial, alles_verteilen.lies_zeiten(schnell.DJK / "ui/tests/serial_zeiten.txt"), shards,
                                          alles_verteilen.lies_fest(schnell.DJK / "ui/tests/serial_instanz.txt"))
    shard_von = {f: s for s, fs in verteilung.items() for f in fs}
    for wurzel, ts in node.items():
        rel_w = str(wurzel.relative_to(DJK))
        for t in ts:
            r = str(t.relative_to(wurzel))
            if rel_w == "ui":
                f = r[len("tests/"):] if r.startswith("tests/") else None
                name = "ui-ruhig" if f in ruhig_ui else f"ui-seriell-{shard_von[f]}" if f in shard_von else "ui-seite"
            elif rel_w == "generator" and r.startswith("tests/") and r[len("tests/"):] in ruhig_gen:
                name = "generator-ruhig"
            elif rel_w in NODE_SUITE:
                name = NODE_SUITE[rel_w]
            else:
                nichts.append(str(t.relative_to(REPO)))
                continue
            datei.setdefault(name, set()).add(r)
    for wurzel, ts in py.items():
        rel_w = str(wurzel.relative_to(DJK))
        name = "py-carla" if rel_w == "hosts/carla" else f"py-{rel_w}"
        if rel_w not in PY_SUITES and name != "py-carla":
            nichts.extend(str(t.relative_to(REPO)) for t in ts)
            continue
        for t in ts:
            datei.setdefault(name, set()).add(str(t.relative_to(wurzel)))
    for s in list(datei):
        if s in suites:
            del datei[s]
    return [], suites, datei, sorted(set(nichts))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--gegen", default=None)
    ap.add_argument("--ziel", default=None)
    a = ap.parse_args(argv)
    ref = schnell.basis(a.gegen)
    dateien = schnell.geaendert(ref)
    gruende, suites, datei, nichts = plane(dateien, zeilen_fn=git_zeilen(ref))
    if gruende:
        print("ESKALATION " + "; ".join(gruende[:3]) + (f" (+{len(gruende) - 3} more)" if len(gruende) > 3 else ""))
        return 0
    for s in sorted(suites):
        print(f"SUITE {s}")
    for s in sorted(datei):
        print(f"DATEIEN {s} {len(datei[s])}")
        if a.ziel:
            Path(a.ziel).mkdir(parents=True, exist_ok=True)
            Path(a.ziel, f"{s}.txt").write_text("".join(f + "\n" for f in sorted(datei[s])))
    for n in nichts:
        print(f"NICHTS {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
