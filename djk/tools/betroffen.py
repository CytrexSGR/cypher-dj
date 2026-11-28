#!/usr/bin/env python3
"""Helper of alles.sh --betroffen: which suites (and which files of them) a change touches.

    betroffen.py [--gegen REF] [--ziel DIR]

Changed files = the working tree (staged, unstaged, untracked) against REF (default: merge base with origin/main), like fast.py, whose
file selection by name it reuses. Prints one line per decision:
    ESKALATION <reason>        the change can reach every suite: run the whole gate
    SUITE <name>               run this suite as a whole
    DATEIEN <name> <n>         run only n files of this suite; they are listed in DIR/<name>.txt (relative to the suite's folder)
    NICHTS <path>              a changed path no suite covers (reported, runs nothing)
Escalation: CMake files outside djk/core, any file under djk/contract or docs/interfaces that the table VERTRAG does not know (the contract tests
and mock_core are not contract files), lockfiles and manifests of the dependencies, the gate itself (djk/tools/alles*, fast.py, betroffen.py, skips_decke.txt, quarantaene.txt, the page test lists, djk/tools/ci/**,
the CI workflow folder .<host>/workflows/**) and third_party/**. A CMake file or a C/C++ header under djk/core does not escalate: it selects the core suite (core-ruhig follows), the hand and mock_core suites,
every test that starts a program built from djk/core, and the tests of the code outside djk/core that names the header. A known contract file
selects what reads it (table VERTRAG). Exception: a change to a test list (serial.txt, serial_zeiten.txt,
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
import ast
import fnmatch
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
# Every program djk/core builds that a test outside djk/core starts (add_executable of the core CMake files, callers found by grep), and the
# environment variables that point to them. A CMake or header change reaches all of them; a .cpp change keeps the narrower RENDER_RX above.
KERN_PROGRAMM_RX = re.compile(r"cypherdj-(kern|render|noten|mitschnitt|setmitschnitt|pruef-ein|stimme|zustand|nulltest|latenz|aufnehmer4)"
                              r"|CYPHERDJ_(KERN|RENDER|NOTEN)")
CODE_ENDUNG = (".ts", ".mjs", ".js", ".cjs", ".py", ".sh", ".cpp", ".c", ".h", ".rs", ".json", ".toml", ".cmake", ".txt")

# Contract files and what reads them. One row per path pattern (fnmatch on the repo-relative path, first match wins):
#   (pattern, suites run whole, generated files the file feeds (treated as changed, too), words the readers name; None = the file's own name)
# How the table was found (2026-11-28): `git grep` of every file name (and of the folder name where tests read a folder by a glob) over djk/,
# counted per package, plus the header of every djk/contract/erzeuge_*.py for its outputs. A reader that names the file is found at plan time by
# vertrag_leser(), so a new reader needs no row; the whole suites here are the readers a name search cannot see (a folder read by a glob, a schema
# loaded by the generic schema loader). Reader counts then: osc.json core 12, contract tests 10, mock_core 8, ui 5, testbench 3;
# defs.schema.json conductor 3, contract tests 2, ui 1, hand 1; cases/noten core 12 (ctest), contract 37; sequences core 66, mock_core 40.
# A path under djk/contract or docs/interfaces that no row matches escalates, as before.
PC, MC = "py-contract", "mock_core"
_INSERT_OUT = ["djk/core/signalbox/src/insert_zeilen.inc", "djk/ui/project/insert_key.ts", "djk/conductor/src/insert_controls.ts",
               "djk/contract/mock_core/insert_controls.mjs"]
_PULT_OUT = ["djk/contract/pult.ts", "djk/ui/public/pult.js", "djk/core/include/cypherdj/pult_table.h"]
_OSC_OUT = ["djk/contract/osc_addresses.h", "djk/contract/osc_addresses.ts"]
_SCHLUESSEL_OUT = ["djk/core/include/cypherdj/schluessel_regeln.inc", "djk/ui/project/key_table.ts"]
VERTRAG = [
    ("djk/contract/osc.json", {PC, MC}, _OSC_OUT, None),
    ("djk/contract/osc_adressen.*", {PC, MC}, [], None),
    ("djk/contract/pult.json", {PC, MC}, _PULT_OUT, None),
    ("djk/contract/pult.ts", {PC}, [], None),
    ("docs/interfaces/insert_module.json", {PC, MC}, _INSERT_OUT, None),
    ("docs/interfaces/schluessel_regeln.json", {PC}, _SCHLUESSEL_OUT, None),
    ("docs/interfaces/*.json", {PC}, [], None),
    ("djk/contract/schemas/*.json", {PC}, [], None),
    ("djk/contract/*.schema.json", {PC}, [], None),
    ("djk/contract/cases/noten/*", {PC}, [], ["cases/noten"]),
    ("djk/contract/cases/*", {PC, MC}, [], ["contract/cases", "arr_ki_stopp"]),
    ("djk/contract/demos/*", {PC}, [], None),
    ("djk/contract/sequences/*", {PC, MC}, [], ["sequences"]),
    ("djk/contract/baender.json", {PC}, [], None),
    ("djk/contract/mod_ref.json", {PC}, [], None),
    ("djk/contract/warp_referenz*.json", {PC}, [], None),
    ("djk/contract/zell_karte_referenz.json", {PC}, [], None),
    ("djk/contract/generate_osc.py", {PC}, _OSC_OUT, None),
    ("djk/contract/generate_pult.py", {PC}, _PULT_OUT, None),
    ("djk/contract/generate_insert.py", {PC, MC}, _INSERT_OUT, None),
    ("djk/contract/generate_key.py", {PC}, _SCHLUESSEL_OUT, None),
    ("djk/contract/generate_bands.py", {PC}, ["djk/contract/baender.json"], None),
    ("djk/contract/generate_warp_reference.py", {PC}, ["djk/contract/warp_referenz.json"], None),
    ("djk/contract/*.py", {PC}, [], None),
    ("djk/contract/*.mjs", {PC, MC}, [], None),
    ("djk/contract/*.ts", {PC}, [], None),
]


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


def vertrag_datei(rel):
    """True for a file the contract owns: under djk/contract (not its tests, not mock_core, not prose) or the interface files under docs/interfaces."""
    if rel.startswith("docs/interfaces/"):
        return not rel.endswith(".md")
    return (rel.startswith("djk/contract/") and not rel.startswith(("djk/contract/mock_core/", "djk/contract/tests/", "djk/contract/node_modules/"))
            and not schnell.ist_test(Path(rel)) and not rel.endswith(".md"))


def vertrag_zeile(rel):
    """-> (suites, generated files, search words) of the first VERTRAG row that matches the path, or None (unknown contract file: escalate)."""
    for muster, suites, erzeugt, suchen in VERTRAG:
        if fnmatch.fnmatchcase(rel, muster):
            return suites, erzeugt, suchen or [Path(rel).name]
    return None


def kern_eingabe(rel):
    """A CMake file or a header of djk/core: it changes how every core program is built, not what one source says."""
    n = Path(rel).name
    return rel.startswith("djk/core/") and (n == "CMakeLists.txt" or n.endswith(".cmake") or n.endswith(KERN_KOPF))


_korpus = {}
KERN_ENDUNG = CODE_ENDUNG + (".inc", ".in", ".cmake", "CMakeLists.txt")


def code_korpus(kern=False):
    """{path relative to the repo: text} of the code files under djk/ outside djk/core (kern=False) or inside it (kern=True), read once per repo."""
    schluessel = (schnell.REPO, kern)
    if schluessel not in _korpus:
        _korpus.clear()
        pfade = [p for p in schnell.git("ls-files", "--", "djk").splitlines()
                 if p.endswith(KERN_ENDUNG if kern else CODE_ENDUNG) and p.startswith("djk/core/") == kern
                 and "node_modules" not in p and "/ergebnisse/" not in p]
        _korpus[schluessel] = {p: (schnell.REPO / p).read_text(errors="ignore") for p in pfade if (schnell.REPO / p).is_file()}
    return _korpus[schluessel]


def namen_leser(woerter, ausser=(), kern=False):
    """Code files under djk/ (outside djk/core, or inside it with kern=True) whose text names one of the words as a whole name, `ausser` left out."""
    rx = re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(w) for w in woerter) + r")(?![A-Za-z0-9_])")
    return sorted(p for p, t in code_korpus(kern).items() if p not in ausser and rx.search(t))


def quell_importeure(rels):
    """Repo-relative JS/TS files under djk/ (outside djk/core) that import one of rels, directly or through other files (sources, not only tests)."""
    rueck = {}
    for p in code_korpus():
        if p.endswith(schnell.JS_ENDUNG):
            for k in schnell.direkte_importe(str(schnell.REPO / p)):
                rueck.setdefault(k, set()).add(p)
    stapel = [str(schnell.REPO / r) for r in rels]
    gesehen, gefunden = set(stapel), set()
    while stapel:
        for p in rueck.get(stapel.pop(), ()):
            ap = str(schnell.REPO / p)
            if ap not in gesehen:
                gesehen.add(ap)
                stapel.append(ap)
                gefunden.add(p)
    return sorted(gefunden)


def py_tests_die_nennen(woerter):
    """-> {area folder: set of pytest files} of every test_*.py under djk/ (outside djk/core) whose text names one of the words as a whole name."""
    rx = re.compile(r"(?<![A-Za-z0-9_])(?:" + "|".join(re.escape(w) for w in sorted(woerter)) + r")(?![A-Za-z0-9_])")
    py = {}
    for p, t in code_korpus().items():
        if Path(p).name.startswith("test_") and p.endswith(".py") and rx.search(t):
            b = schnell.bereich(p)
            if b and b[0] == "py":
                py.setdefault(b[1], set()).add(schnell.REPO / p)
    return py


def kern_programm_tests():
    """-> (node, py): tests of every package (not of djk/core) that start a program built from djk/core, with the node tests that import a helper that does."""
    node, py, helfer = {}, {}, []
    for p, t in code_korpus().items():
        if not KERN_PROGRAMM_RX.search(t):
            continue
        pp = Path(p)
        if schnell.ist_test(pp) and p.endswith((".mjs", ".ts", ".js")):
            w = schnell.wurzel_von(schnell.REPO / p)
            if w:
                node.setdefault(w, set()).add(schnell.REPO / p)
        elif schnell.ist_test(pp) and p.endswith(".py"):
            b = schnell.bereich(p)
            if b and b[0] == "py":
                py.setdefault(b[1], set()).add(schnell.REPO / p)
        elif "/tests/" in p and p.endswith((".mjs", ".ts", ".js")):
            helfer.append(p)
    if helfer:
        for t in schnell.importeure(helfer):
            w = schnell.wurzel_von(t)
            if w:
                node.setdefault(w, set()).add(Path(t))
    return node, py


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


_namenslisten_cache = {}
NAMENSLISTEN_PRUEFER = "djk/contract/check_name_lists.py"
_PFAD_RX = re.compile(r"(?:djk|docs)/[\w./@+-]+")


def namenslisten_quellen():
    """Paths the names checker djk/contract/check_name_lists.py reads by name, taken from its string literals (q.lies("..."), the folders it
    globs, file://@@/ imports): every path inside a literal that starts with djk/ or docs/. A literal without a file ending is a folder (all below
    it counts). Derived, not kept by hand, so a new source in the checker counts at once. -> set of paths."""
    if REPO not in _namenslisten_cache:
        quellen = {NAMENSLISTEN_PRUEFER}
        try:
            baum = ast.parse((REPO / NAMENSLISTEN_PRUEFER).read_text(encoding="utf-8"))
        except (OSError, SyntaxError):
            baum = None
        for n in ast.walk(baum) if baum else ():
            if isinstance(n, ast.Constant) and isinstance(n.value, str):
                quellen |= {m.rstrip("/.") for m in _PFAD_RX.findall(n.value)}
        _namenslisten_cache[REPO] = quellen
    return _namenslisten_cache[REPO]


def namenslisten_quelle(rel):
    """True when the names checker reads this path (a file it names, or anything below a folder it names)."""
    return any(rel == q or (not Path(q).suffix and rel.startswith(q + "/")) for q in namenslisten_quellen())


def eskalation(rel):
    """Reason to run the whole gate for this changed path, or None."""
    n = Path(rel).name
    t = rel.split("/")
    if n in LOCK_NAMEN and not (n == "conftest.py" and "tests" in t):
        return f"{rel}: lockfile, manifest or test configuration"
    if (n == "CMakeLists.txt" or n.endswith(".cmake")) and not rel.startswith("djk/core/"):
        return f"{rel}: CMake"
    if rel.startswith(GATE) or CI_ORDNER_RX.match(rel):
        return f"{rel}: the gate itself"
    if vertrag_datei(rel) and vertrag_zeile(rel) is None:
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
    # known contract files are judged by the table VERTRAG, not by the generic path rules below
    vertrag = [r for r in dateien if vertrag_datei(r)]
    alle_pfade = set(dateien)
    dateien = [r for r in dateien if r not in vertrag]
    abgeleitet, worte, extra_node, extra_py = [], [], {}, {}
    for rel in vertrag:
        sz, erzeugt, suchen = vertrag_zeile(rel)
        suites |= sz
        abgeleitet += erzeugt
        worte += suchen + [Path(e).name for e in erzeugt]
        if rel.endswith(schnell.JS_ENDUNG):
            for t in schnell.importeure([rel]):
                extra_node.setdefault(schnell.wurzel_von(t), set()).add(t)
    kern_ein = [r for r in dateien if kern_eingabe(r)]
    if kern_ein:
        suites |= {"core", "hand", MC}
        node_k, py_k = kern_programm_tests()
        for w, ts in node_k.items():
            extra_node.setdefault(w, set()).update(ts)
        for w, ts in py_k.items():
            extra_py.setdefault(w, set()).update(ts)
        # what outside the core names a changed core file (a header, a pin list, a .cpp): a python test reads core files by name, too
        worte += [Path(r).name for r in dateien if r.startswith("djk/core/")]
    if worte:
        abgeleitet += namen_leser(worte, alle_pfade)
        if namen_leser(worte, alle_pfade, kern=True):
            suites.add("core")      # a core source, test script or CMake file names it (ctest reads contract files by path)
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
    if abgeleitet:
        # files a contract or core-build change reaches (generated files, readers by name): their tests run; one that no test names is no reason to escalate
        node2, py2, kern2, _ = auswahl_fn(sorted(set(abgeleitet)))
        for w, ts in node2.items():
            node.setdefault(w, set()).update(ts)
        for w, ts in py2.items():
            py.setdefault(w, set()).update(ts)
        kern = set(kern) | set(kern2)
    if abgeleitet:
        # a python test names a page source (the starter demo test names ui/project/model.ts): the sources that import a derived file count, too
        for w, ts in py_tests_die_nennen({Path(r).name for r in abgeleitet} | {Path(r).name for r in quell_importeure(abgeleitet)}).items():
            py.setdefault(w, set()).update(ts)
    for w, ts in extra_node.items():
        node.setdefault(w, set()).update(ts)
    for w, ts in extra_py.items():
        py.setdefault(w, set()).update(ts)
    if kern or "core" in suites:
        suites.add("core")
        suites.add("hand")
        ui = schnell.DJK / "ui"
        node.setdefault(ui, set()).update(render_tests())
    if any(namenslisten_quelle(r) for r in alle_pfade):
        # the names checker reads these by name, with no import edge: its ctest (core) and its python test (py-contract) turn red with them
        suites |= {"core", PC}
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
