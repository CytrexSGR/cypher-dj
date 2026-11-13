#!/usr/bin/env python3
"""Fast test tier (t_2d939cab): only the tests a change touches, meant to finish in about two minutes.

    djk/tools/fast.py [--gegen REF] [--zeige] [--alle-dateien]

Changed files = the working tree (staged, unstaged, untracked) against REF (default: merge base with origin/main).
Selection per area, by name, no import graph:
- a changed test file runs itself;
- a changed source file runs every test file of its area whose text names the source's stem (`muster_lauf` for
  areas/proj/pattern_run.ts, `wirtsteuerung` for host_control.py), plus `<stem>`-named tests;
- core (djk/core): ninja for the build, then ctest -R on the tests whose name contains a changed stem, mutations left out.
Page tests listed in djk/ui/tests/serial.txt run one at a time after the others. Anything bigger belongs in the
nightly run (djk/tools/nachtlauf.sh). --zeige prints the selection without running it.
Exit 0 green or nothing to run, 1 red, 2 usage.
"""
import argparse, os, re, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DJK = REPO / "djk"
PY = os.environ.get("CYPHERDJ_PYTHON", str(DJK / "workshop/.venv/bin/python"))
PY_MIK = REPO / "cues/venv-mik/bin/python"
NODE_PAKETE = ["ui", "hand", "conductor", "cues", "loops", "player_cli", "generator", "contract/mock_core", "tools"]


def git(*a):
    return subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True).stdout


def geaendert(ref):
    namen = set(git("diff", "--name-only", ref).split()) | set(git("ls-files", "--others", "--exclude-standard").split())
    return sorted(n for n in namen if (REPO / n).is_file())


def ist_test(p):
    n = p.name
    return n.startswith("test_") or ".test." in n


def test_dateien(wurzel, muster):
    return sorted(p for p in wurzel.rglob(muster) if "node_modules" not in p.parts and "build" not in p.parts)


def nennt(dateien, stamm):
    rx = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(stamm) + r"(?![A-Za-z0-9_])")
    return [d for d in dateien if rx.search(d.read_text(errors="ignore"))]


def bereich(rel):
    """(kind, area folder) of a changed path, or None."""
    t = Path(rel).parts
    if len(t) < 2 or t[0] != "djk":
        return None
    if t[1] == "core":
        return ("kern", DJK / "core")
    if t[1] == "hosts" and len(t) > 2 and t[2] == "carla":
        return ("py", DJK / "hosts/carla")
    for p in NODE_PAKETE:
        if rel.startswith(f"djk/{p}/"):
            if rel.endswith((".py",)) and p not in ("ui",):
                break
            return ("node", DJK / p)
    if rel.endswith(".py") or (DJK / t[1] / "pytest.ini").exists():
        return ("py", DJK / t[1])
    return None


def auswahl(dateien):
    node, py, kern = {}, {}, set()
    for rel in dateien:
        b = bereich(rel)
        if not b:
            continue
        art, wurzel = b
        p = REPO / rel
        stamm = p.name.split(".")[0]
        if art == "kern":
            kern.add(stamm)
            continue
        alle = test_dateien(wurzel, "*.test.mjs") + test_dateien(wurzel, "*.test.ts") if art == "node" else test_dateien(wurzel, "test_*.py")
        ziel = node if art == "node" else py
        if ist_test(p) and p.suffix in (".mjs", ".ts", ".py"):
            ziel.setdefault(wurzel, set()).add(p)
        elif len(stamm) >= 4:
            for t in nennt(alle, stamm):
                ziel.setdefault(wurzel, set()).add(t)
    return node, py, kern


def lauf(befehl, cwd, titel):
    t0 = time.time()
    r = subprocess.run(befehl, cwd=cwd, capture_output=True, text=True)
    aus = r.stdout + r.stderr
    zeilen = [z for z in aus.splitlines() if re.match(r"^(# (pass|fail) |not ok |FAILED |ERROR |\d+% tests passed|.*\b(passed|failed)\b.* in )", z)]
    print(f"[{'ok ' if r.returncode == 0 else 'RED'}] {titel} ({time.time() - t0:.0f} s)")
    for z in zeilen[-8:]:
        print("      " + z)
    return r.returncode == 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--gegen", default=None)
    ap.add_argument("--zeige", action="store_true")
    a = ap.parse_args(argv)
    ref = a.gegen or git("merge-base", "HEAD", "origin/main").strip() or "HEAD"
    dateien = geaendert(ref)
    node, py, kern = auswahl(dateien)
    seriell = set()
    sl = DJK / "ui/tests/serial.txt"
    if sl.exists():
        seriell = {DJK / "ui/tests" / z.strip() for z in sl.read_text().splitlines() if z.strip() and not z.startswith("#")}
    print(f"schnell: {len(dateien)} changed files against {ref[:10]}")
    for w, ts in node.items():
        print(f"  node {w.relative_to(REPO)}: {len(ts)} files")
    for w, ts in py.items():
        print(f"  pytest {w.relative_to(REPO)}: {len(ts)} files")
    if kern:
        print(f"  core: ctest -R {'|'.join(sorted(kern))}")
    if a.zeige or not (node or py or kern):
        if not (node or py or kern):
            print("schnell: nothing to run")
        return 0
    gut = True
    for w, ts in node.items():
        par = sorted(str(t.relative_to(w)) for t in ts if t not in seriell)
        ser = sorted(str(t.relative_to(w)) for t in ts if t in seriell)
        if par:
            gut &= lauf(["node", "--test", f"--test-concurrency={min(6, os.cpu_count() or 2)}", *par], w, f"node {w.name} ({len(par)})")
        if ser:
            gut &= lauf(["node", "--test", "--test-concurrency=1", *ser], w, f"node {w.name} serial ({len(ser)})")
    for w, ts in py.items():
        p = str(PY_MIK) if w.name == "key_energy" and PY_MIK.exists() else (sys.executable if w.name == "carla" else PY)
        gut &= lauf([p, "-m", "pytest", "-q", "-p", "no:cacheprovider", *sorted(str(t.relative_to(w)) for t in ts)], w, f"pytest {w.relative_to(DJK)} ({len(ts)})")
    if kern:
        b = DJK / "core/build"
        gut &= lauf(["ninja", "-C", str(b)], DJK, "core build")
        gut &= lauf(["ctest", "--test-dir", str(b), "-j6", "--timeout", "300", "-E", "_mutation", "-R", "|".join(sorted(kern))], DJK, "core ctest")
    print("schnell: " + ("green" if gut else "RED"))
    return 0 if gut else 1


if __name__ == "__main__":
    sys.exit(main())
