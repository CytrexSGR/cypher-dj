#!/usr/bin/env python3
"""Helper of alles.sh: parse suite logs, apply the quarantine list, write SUMMARY.md.

    alles_report.py --ziel DIR [DIR ...] --quarantaene FILE [--nicht-gelaufen "suite: reason" ...] [--erwartet "suite suite ..."] [--skips FILE]

Several result folders (the pool and the parallel packages of the quiet stage, djk/tools/ci/ruhig_pakete.sh) are merged into one report written to the FIRST folder:
suites, failures, flaky reruns (each folder's own rerun/), load skips and notes are collected over all of them, the skip ceilings count over all rows, --erwartet
is checked against the union. A folder with neither a result file (.meta) nor a SUMMARY.md (its run never wrote anything) is a failure of its own.

Reads <ziel>/<suite>.log plus <ziel>/<suite>.meta (lines `kind=...`, `seconds=...`, `exit=...`), writes <ziel>/SUMMARY.md.
Exit 0: no failure outside the quarantine and nothing skipped for load. Exit 1: a failure outside it, a suite that was announced (--erwartet) but left
no .meta, a suite listed as not run, a suite that exited 0 with 0 passed tests, or more skips than the ceiling of its base suite in --skips.
Exit 3: no failure, but tests skipped for load (gate not green).
Flaky retry: `--rerun-plan` (before the report) lists the units that failed (node: test file, pytest: test file, ctest: test name, cargo: test name in its binary)
and writes what alles.sh needs to run them once more, serially, into <ziel>/rerun/. The report then reads <ziel>/rerun/<suite>.log/.meta: a failure that passes on the
rerun is `flaky` (listed in SUMMARY.md and flaky.txt, the gate stays green), one that fails again stays a failure. More than 30 failed units: no rerun (a real breakage).
A suite that crashed, ran no test or has an unnamed failure is never rerun.
Log formats: node TAP, pytest, ctest, cargo test, shell runner lines (`SHELL ok|FAIL <file>`).
"""
import argparse, re, sys
from pathlib import Path


def parse_quarantaene(text):
    """-> list of (suite, name). Line format: `<suite> <test name or file>  # reason`; blank lines and `#` lines are ignored."""
    out = []
    for z in text.splitlines():
        z = re.sub(r"(^|\s)#.*$", "", z).strip()
        if not z:
            continue
        teile = z.split(None, 1)
        if len(teile) == 2:
            out.append((teile[0], teile[1].strip()))
    return out


def grundsuite(suite):
    """Suites that alles.sh splits keep one quarantine name: `ui-seriell-c` (a shard of the serial page tests) is `ui-seriell`, `core-langsam` (the slow stage) and `core-ruhig` (the quiet stage) are `core`, `ui-ruhig` and the packages `ui-ruhig-<n>` are `ui-seite`, `generator-ruhig` is `generator`."""
    suite = re.sub(r"^ui-ruhig(-\d+)?$", "ui-seite", suite)   # ui-ruhig-<n>: package n of the parallel quiet stage
    suite = {"generator-ruhig": "generator"}.get(suite, suite)
    return re.sub(r"^(ui-seriell)-[a-h]$|^(core)-(?:langsam|ruhig)$", lambda m: m.group(1) or m.group(2), suite)


def ist_quarantaene(suite, namen, quarantaene):
    """A failure (its name and the file it belongs to) is quarantined when an entry of the same suite occurs in one of them."""
    suite = grundsuite(suite)
    return any(s == suite and any(n in x for x in namen if x) for s, n in quarantaene)


def parse_node(text):
    """Node TAP. Nested results come before their top-level (file) line, so they are tagged with that file when it arrives."""
    zahl = {"pass": 0, "fail": 0, "skipped": 0}
    fehler, offen = [], []
    for z in text.splitlines():
        m = re.match(r"^# (pass|fail|skipped) (\d+)", z)
        if m:
            zahl[m.group(1)] = int(m.group(2))
            continue
        m = re.match(r"^(\s*)(not ok|ok) \d+ - (.*?)(\s+# (SKIP|TODO).*)?$", z)
        if not m:
            continue
        tief, status, name, markiert = len(m.group(1)), m.group(2), m.group(3), m.group(4)
        if tief:
            if status == "not ok" and not markiert:
                offen.append(name)
        else:
            if status == "not ok" and not markiert:
                fehler += [(n, name) for n in (offen or [name])]
            offen = []
    return zahl["pass"], zahl["fail"], zahl["skipped"], fehler


def parse_pytest(text):
    zahl = {"passed": 0, "failed": 0, "skipped": 0, "error": 0, "errors": 0}
    for z in text.splitlines():
        if re.match(r"^=*\s*(\d+ \w+(, )?)+.* in [\d.]+s", z):
            for n, k in re.findall(r"(\d+) (passed|failed|skipped|errors?)", z):
                zahl[k] = int(n)
    fehler = []
    for z in text.splitlines():
        m = re.match(r"^(FAILED|ERROR) (\S+)", z)
        if m:
            fehler.append((m.group(2), m.group(2).split("::")[0]))
    return zahl["passed"], zahl["failed"] + zahl["error"] + zahl["errors"], zahl["skipped"], fehler


def parse_ctest(text):
    p = f = s = 0
    fehler = []
    for z in text.splitlines():
        m = re.search(r"Test\s+#\d+: (\S+) \.+\s*(?:\*\*\*)?([A-Za-z][A-Za-z ]*?)\s+[\d.]+ sec", z)
        if not m:
            continue
        if m.group(2) == "Passed":
            p += 1
        elif m.group(2) == "Skipped":
            s += 1
        else:
            f += 1
            fehler.append((m.group(1), m.group(1)))
    # A failure whose message wraps over several lines (PASS_REGULAR_EXPRESSION not found) has no result line the pattern above can read; ctest lists it
    # at the end ("The following tests FAILED:"), so every name from that block that is still missing counts.
    bekannt = {n for n, _ in fehler}
    im_block = False
    for z in text.splitlines():
        if z.startswith("The following tests"):
            im_block = z.startswith("The following tests FAILED")   # "did not run" lists skipped tests, not failures
            continue
        if not im_block:
            continue
        m = re.match(r"^\s+\d+ - (\S+) \(([A-Za-z ]+)\)\s*$", z)
        if m and m.group(1) not in bekannt:
            bekannt.add(m.group(1))
            f += 1
            fehler.append((m.group(1), m.group(1)))
        elif not m and z.strip():
            im_block = False
    return p, f, s, fehler


def parse_cargo(text):
    p = f = s = 0
    for m in re.finditer(r"test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored", text):
        p, f, s = p + int(m.group(1)), f + int(m.group(2)), s + int(m.group(3))
    fehler = [(m.group(1), m.group(1)) for m in re.finditer(r"^test (\S+) \.\.\. FAILED", text, re.M)]
    return p, f, s, fehler


def parse_shell(text):
    p = sum(1 for z in text.splitlines() if z.startswith("SHELL ok "))
    s = sum(1 for z in text.splitlines() if z.startswith("SHELL skip-"))
    fehler = [(z[len("SHELL FAIL "):].strip(),) * 2 for z in text.splitlines() if z.startswith("SHELL FAIL ")]
    return p, len(fehler), s, fehler


def lade_uebersprungen(text):
    """Shell suites: the tests skipped because of load or a busy lock (`SHELL skip-last <file>`), with the reason line printed before it."""
    out, grund = [], ""
    for z in text.splitlines():
        if z.startswith("SKIP load"):
            grund = z
        elif z.startswith("SHELL skip-last "):
            out.append(f"{z[len('SHELL skip-last '):].strip()}: {grund}")
            grund = ""
        elif z.startswith("SHELL "):
            grund = ""
    return out


PARSER = {"node": parse_node, "pytest": parse_pytest, "ctest": parse_ctest, "cargo": parse_cargo, "shell": parse_shell}


def lies_meta(pfad):
    d = {}
    if pfad.exists():
        for z in pfad.read_text().splitlines():
            if "=" in z:
                k, v = z.split("=", 1)
                d[k.strip()] = v.strip()
    return d


def lies_skips(text):
    """Skip ceilings: lines `<base suite> <max skipped>  # note`. -> {suite: int}."""
    out = {}
    for z in text.splitlines():
        t = re.sub(r"(^|\s)#.*$", "", z).split()
        if len(t) == 2 and t[1].isdigit():
            out[t[0]] = int(t[1])
    return out


def pruefe_skips(rows, decke):
    """-> ({base suite: [message]}, [note]). More skipped tests than the pinned ceiling of the base suite is red (a missing entry means ceiling 0);
    fewer is fine and only noted. The shards of a split suite (ui-seriell-a..h, core-ruhig, ui-ruhig ...) count together."""
    summe = {}
    for r in rows:
        g = grundsuite(r["suite"])
        summe[g] = summe.get(g, 0) + r["skipped"]
    harte, notizen = {}, []
    for g, n in sorted(summe.items()):
        grenze = decke.get(g, 0)
        if n > grenze:
            harte[g] = [f"{n} skipped tests, more than the pinned ceiling of {grenze} (djk/tools/skips_decke.txt)"]
        elif n < grenze and g in decke:
            notizen.append(f"{g}: {n} skipped, ceiling {grenze} (fewer is fine; lower the pin when this is the new normal)")
    return harte, notizen


RERUN_GRENZE = 30
_SENTINEL = ("suite exit ", "suite exited 0 but ran no test", "suite did not run")


def node_dateien(text):
    """Files of the failing node tests (TAP `location: '<file>:l:c'` of every `not ok` that is not a skip/todo), or None when one failure names no file."""
    z = text.splitlines()
    dateien, ok = [], True
    for i, zeile in enumerate(z):
        m = re.match(r"^\s*not ok \d+ - (.*?)(\s+# (SKIP|TODO).*)?$", zeile)
        if not m or m.group(2):
            continue
        fund = None
        for x in z[i + 1:i + 40]:
            if re.match(r"^\s*(not ok|ok) \d+ - ", x):
                break
            l = re.match(r"^\s*location: '(.+?\.(?:m?[jt]s)):\d+:\d+'", x)
            if l:
                fund = l.group(1)
                break
        if fund is None:
            m2 = re.match(r"^(\S+\.(?:m?[jt]s))$", m.group(1))   # a file that failed as a whole is named by its path
            fund = m2.group(1) if m2 else None
        if fund is None:
            ok = False
        elif fund not in dateien:
            dateien.append(fund)
    return dateien if ok else None


def cargo_einheiten(text):
    """[(cwd, executable, test name)] of the failing cargo tests, from the `Running <exe>  [cwd=<dir>]` headers alles_cargo.sh prints; None when one has no header."""
    cwd = exe = None
    out, ok = [], True
    for z in text.splitlines():
        m = re.match(r"^\s+Running (\S+)(?: \(timing tests\))?\s+\[cwd=(.+)\]\s*$", z)
        if m:
            exe, cwd = m.group(1), m.group(2)
            continue
        if re.match(r"^\s+Doc-tests ", z):
            exe = cwd = None
            continue
        m = re.match(r"^test (\S+) \.\.\. FAILED", z)
        if m:
            if exe:
                out.append((cwd, exe, m.group(1)))
            else:
                ok = False
    return out if ok else None


def rerun_plan(ziel, quarantaene, grenze=RERUN_GRENZE):
    """-> (plan, einheiten, cap). plan: {suite: dict(kind, units, namen)}; einheiten: number of failed units over all suites; cap: True when more than
    `grenze` (then plan is empty: no rerun, the gate is red). Only suites with named failures and a unit for every one of them are rerun."""
    plan, gesamt = {}, 0
    for meta in sorted(Path(ziel).glob("*.meta")):
        suite, m = meta.stem, lies_meta(meta)
        kind = m.get("kind", "")
        log = meta.with_suffix(".log")
        text = log.read_text(errors="replace") if log.exists() else ""
        p, f, s, fehler = PARSER.get(kind, lambda t: (0, 0, 0, []))(text)
        ex = int(m.get("exit", "1"))
        h = [n for n, d in fehler if not ist_quarantaene(suite, (n, d), quarantaene)]
        if ex == 0 or not h or (ex != 0 and not fehler):
            continue
        if kind == "node":
            units = node_dateien(text)
        elif kind == "pytest":
            units = sorted({d for n, d in fehler if not ist_quarantaene(suite, (n, d), quarantaene)})
        elif kind == "ctest":
            units = list(dict.fromkeys(h))
        elif kind == "cargo":
            units = cargo_einheiten(text)
        else:
            units = None   # shell runners: no way to run one file again
        gesamt += len(units or h)
        if units:
            plan[suite] = dict(kind=kind, units=units, namen=list(dict.fromkeys(h)))
    if gesamt > grenze:
        return {}, gesamt, True
    return plan, gesamt, False


def schreibe_rerun(ziel, plan):
    """The files alles.sh reads: rerun/plan.txt (`suite kind`), rerun/betr/<suite>.txt (node, pytest), rerun/<suite>.einheiten, rerun/<suite>.namen."""
    d = Path(ziel) / "rerun"
    (d / "betr").mkdir(parents=True, exist_ok=True)
    for f in list(d.glob("*")):
        if f.is_file():
            f.unlink()
    zeilen = []
    for suite, e in plan.items():
        zeilen.append(f"{suite} {e['kind']}")
        (d / f"{suite}.namen").write_text("\n".join(e["namen"]) + "\n")
        if e["kind"] in ("node", "pytest"):
            (d / "betr" / f"{suite}.txt").write_text("\n".join(e["units"]) + "\n")
        elif e["kind"] == "ctest":
            (d / f"{suite}.einheiten").write_text("\n".join(e["units"]) + "\n")
        elif e["kind"] == "cargo":
            (d / f"{suite}.einheiten").write_text("\n".join("|".join(u) for u in e["units"]) + "\n")
    (d / "plan.txt").write_text("\n".join(zeilen) + ("\n" if zeilen else ""))


def rerun_ergebnis(ziel, suite, kind, h, quarantaene):
    """-> (stehen_bleiben, flaky) for the hard failures `h` of a suite that was rerun, or None when it was not (or the rerun itself is not trustworthy:
    then every failure stays). A name that fails again, and every failure the rerun finds, stays; a name the rerun does not fail is flaky."""
    d = Path(ziel) / "rerun"
    meta, namen = d / f"{suite}.meta", d / f"{suite}.namen"
    if not meta.exists() or not namen.exists():
        return None
    m = lies_meta(meta)
    log = d / f"{suite}.log"
    text = log.read_text(errors="replace") if log.exists() else ""
    p, f, s, fehler = PARSER.get(m.get("kind", kind), lambda t: (0, 0, 0, []))(text)
    ex = int(m.get("exit", "1"))
    if (ex != 0 and not fehler) or (ex == 0 and p == 0):
        return None   # the rerun crashed or ran nothing: it proves nothing, the failures stay
    erneut = [n for n, dd in fehler if not ist_quarantaene(suite, (n, dd), quarantaene)]
    gedeckt = set(namen.read_text().splitlines())
    bleiben = [n for n in h if n not in gedeckt] + [n for n in dict.fromkeys(erneut)]
    flaky = [n for n in h if n in gedeckt and n not in erneut]
    return bleiben, flaky


def auswerten(ziel, quarantaene, erwartet=()):
    """-> (rows, harte, quar, last, flaky). flaky: {suite: [name]} of failures that passed on the rerun (see rerun_ergebnis). rows: one dict per suite; harte/quar: {suite: [failing test name]}; last: {suite: [tests skipped for load]}.
    A suite named in `erwartet` without a .meta, or one that exited 0 with no passed test, is a failure of its own: nothing proves it ran."""
    rows, harte, quar, last, flaky = [], {}, {}, {}, {}
    vorhanden = {m.stem for m in Path(ziel).glob("*.meta")}
    for suite in erwartet:
        if suite not in vorhanden:
            harte[suite] = ["suite did not run: no result file (.meta) was written"]
    for meta in sorted(Path(ziel).glob("*.meta")):
        suite = meta.stem
        m = lies_meta(meta)
        log = meta.with_suffix(".log")
        text = log.read_text(errors="replace") if log.exists() else ""
        p, f, s, fehler = PARSER.get(m.get("kind", ""), lambda t: (0, 0, 0, []))(text)
        ex = int(m.get("exit", "1"))
        h = [n for n, d in fehler if not ist_quarantaene(suite, (n, d), quarantaene)]
        q = [n for n, d in fehler if ist_quarantaene(suite, (n, d), quarantaene)]
        if ex != 0 and not fehler:
            h = [f"suite exit {ex} without named failure (see {suite}.log)"]
        if ex == 0 and p == 0 and s == 0 and not fehler:
            h = h + [f"suite exited 0 but ran no test (0 passed, see {suite}.log)"]
        if m.get("kind") == "shell" and lade_uebersprungen(text):
            last[suite] = lade_uebersprungen(text)
        if h and not any(x.startswith(_SENTINEL) for x in h):
            r = rerun_ergebnis(ziel, suite, m.get("kind", ""), h, quarantaene)
            if r is not None:
                h, fl = r
                if fl:
                    flaky[suite] = fl
                    f = max(f - len(fl), 0)
        if h:
            harte[suite] = h
        if q:
            quar[suite] = q
        rows.append(dict(suite=suite, passed=p, failed=f, skipped=s, seconds=m.get("seconds", "?"), exit=ex))
    return rows, harte, quar, last, flaky


def _abschnitt(d):
    return [f"### {s}\n" + "\n".join(f"- {n}" for n in ns) + "\n" for s, ns in d.items()] or ["none", ""]


def schreibe_summary(ziel, rows, harte, quar, nicht_gelaufen=(), last=None, notizen=(), flaky=None):
    last = last or {}
    flaky = flaky or {}
    z = ["# Test run summary", "", "| suite | passed | failed | skipped | seconds | exit |", "|---|---:|---:|---:|---:|---:|"]
    for r in rows:
        z.append(f"| {r['suite']} | {r['passed']} | {r['failed']} | {r['skipped']} | {r['seconds']} | {r['exit']} |")
    z += ["", f"Total: passed {sum(r['passed'] for r in rows)}, failed {sum(r['failed'] for r in rows)}, "
          f"skipped {sum(r['skipped'] for r in rows)}.", ""]
    if nicht_gelaufen:
        z += ["## Not run", ""] + [f"- {x}" for x in nicht_gelaufen] + [""]
    if notizen:
        z += ["## Notes", ""] + [f"- {x}" for x in notizen] + [""]
    z += ["## Failing tests (gate)", ""] + _abschnitt(harte)
    z += ["## Flaky (failed, then passed on the rerun; the gate does not fail for them, a test that shows up in 3 runs is the next thing to fix)", ""] + _abschnitt(flaky)
    z += ["## Quarantined failures (do not fail the gate)", ""] + _abschnitt(quar)
    z += ["## Skipped for load (the gate is not green while this list is not empty)", ""] + _abschnitt(last)
    if harte or nicht_gelaufen:
        z.append("Result: RED, failures outside quarantine" if harte else "Result: RED, a suite did not run")
    elif last:
        z.append("Result: NOT GREEN, no failure outside quarantine but tests were skipped for load (rerun them on a quiet machine)")
    else:
        z.append("Result: GREEN, no failure outside quarantine")
    (Path(ziel) / "SUMMARY.md").write_text("\n".join(z) + "\n")
    (Path(ziel) / "flaky.txt").write_text("".join(f"{s}\t{n}\n" for s, ns in flaky.items() for n in ns))


def sammle(ziele, quarantaene, erwartet=()):
    """-> (rows, harte, quar, last, flaky, notizen) over several result folders (see the module doc). One folder: exactly what auswerten says plus the CAP note."""
    rows, harte, quar, last, flaky, notizen = [], {}, {}, {}, {}, []
    vorhanden = set()
    for ziel in ziele:
        z = Path(ziel)
        metas = list(z.glob("*.meta"))
        if len(ziele) > 1 and not metas and not (z / "SUMMARY.md").exists():
            harte.setdefault(f"folder {z.name}", []).append(f"no result in {z} (no .meta, no SUMMARY.md: its run wrote nothing)")
        r, h, q, l, f = auswerten(ziel, quarantaene, ())
        vorhanden |= {m.stem for m in metas}
        rows += r
        for ziel_dict, quelle in ((harte, h), (quar, q), (last, l), (flaky, f)):
            for k, v in quelle.items():
                ziel_dict.setdefault(k, []).extend(v)
        cap = z / "rerun" / "CAP"
        if cap.exists():
            notizen.append(f"{cap.read_text().strip()} failed units, more than {RERUN_GRENZE}: no rerun (a real breakage, not a flake)"
                           + (f" ({z.name})" if len(ziele) > 1 else ""))
    for suite in erwartet:
        if suite not in vorhanden:
            harte[suite] = ["suite did not run: no result file (.meta) was written"]
    return rows, harte, quar, last, flaky, notizen


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ziel", required=True, nargs="+")
    ap.add_argument("--quarantaene", required=True)
    ap.add_argument("--nicht-gelaufen", action="append", default=[])
    ap.add_argument("--erwartet", default="", help="suites that must have a result (space separated)")
    ap.add_argument("--skips", default=None, help="file with the skip ceilings per base suite")
    ap.add_argument("--rerun-plan", action="store_true", help="write <ziel>/rerun/ and print `suite kind` per suite to rerun, then stop")
    a = ap.parse_args(argv)
    qf = Path(a.quarantaene)
    q = parse_quarantaene(qf.read_text()) if qf.exists() else []
    if a.rerun_plan:
        if len(a.ziel) != 1:
            print("alles_bericht: --rerun-plan takes exactly one --ziel", file=sys.stderr)
            return 2
        ziel = a.ziel[0]
        plan, gesamt, cap = rerun_plan(ziel, q)
        schreibe_rerun(ziel, plan)
        if cap:
            (Path(ziel) / "rerun" / "CAP").write_text(f"{gesamt}\n")
        for suite, e in plan.items():
            print(suite, e["kind"])
        return 0
    rows, harte, quar, last, flaky, notizen = sammle(a.ziel, q, a.erwartet.split())
    if flaky:
        notizen.append("flaky: " + ", ".join(f"{s}: {len(n)}" for s, n in flaky.items()) + " (see the Flaky section)")
    if a.skips:
        sf = Path(a.skips)
        sh, mehr = pruefe_skips(rows, lies_skips(sf.read_text()) if sf.exists() else {})
        notizen += mehr
        for g, ms in sh.items():
            harte.setdefault(g, []).extend(ms)
    schreibe_summary(a.ziel[0], rows, harte, quar, a.nicht_gelaufen, last, notizen, flaky)
    print((Path(a.ziel[0]) / "SUMMARY.md").read_text())
    return 1 if (harte or a.nicht_gelaufen) else (3 if last else 0)


if __name__ == "__main__":
    sys.exit(main())
