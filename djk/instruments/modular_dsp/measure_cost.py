#!/usr/bin/env python3
"""Cost of a Baukasten graph on a quiet machine, under the real-time lock (plan synth-ausbau, Task 1).

    python3 measure_cost.py --graph GRAPH.json [--stimmen N] [--wiederholungen 5] [--warte-max 1800]
                            [--vergleich OLD.json] [--binary PATH] [--aus OUT.json]

Runs the ignored test `kosten_graph` of `tests/kosten_graph.rs` (build it once: `cargo test --release --no-run -p baukasten_dsp
--test kosten_graph`; nothing is compiled while this script measures). One JSON line per run:
  {"graph","stimmen","block","p50_us","p99_us","p999_us","load1_vor","load1_nach","modus","verworfen"}
followed by a summary line (median of p50, worst p99 over the accepted runs).

Quiet: 1-minute load at most 2.0 before a run and at most 2.5 after it (the run itself raises load1), no build process (cargo, rustc, cc1plus, ld, cmake, ninja, make).
A run outside that is discarded and repeated. No quiet window within --warte-max seconds: mode "relativ", the old graph (--vergleich)
and the new one are measured alternately (ABABABABAB, five pairs, same load) and the ratios p50(new)/p50(old) and p99(new)/p99(old)
are reported; a verdict from them is provisional.
"""
import argparse
import fcntl
import glob
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time

LAST_VOR = 2.0   # load1 limit before a run
LAST_NACH = 2.5  # load1 limit after a run: the run raises load1 itself
BAU_PROZESSE = ("cargo", "rustc", "cc1plus", "ld", "cmake", "ninja", "make")
# CYPHERDJ_ECHTZEIT_SCHLOSS (set by djk/config/realtime_lock.sh) wins; without it a lock file in the temp directory.
SCHLOSS_STANDARD = os.path.join(tempfile.gettempdir(), "cypherdj-echtzeit.lock")
HIER = os.path.dirname(os.path.abspath(__file__))


# --- seams (replaced by the tests) -------------------------------------------------------------------------------------
def lade_last():
    with open("/proc/loadavg") as f:
        return float(f.read().split()[0])


def bau_laeuft():
    for name in BAU_PROZESSE:
        if subprocess.run(["pgrep", "-x", name], capture_output=True).returncode == 0:
            return True
    return False


def schlafe(s):
    time.sleep(s)


def jetzt():
    return time.monotonic()


def finde_binary():
    kandidaten = [p for p in glob.glob(os.path.join(HIER, "..", "target", "release", "deps", "kosten_graph-*"))
                  if os.access(p, os.X_OK) and not p.endswith((".d", ".rlib", ".rmeta"))]
    if not kandidaten:
        sys.exit("no kosten_graph test binary; build it: cargo test --release --no-run -p baukasten_dsp --test kosten_graph")
    return max(kandidaten, key=os.path.getmtime)


def fuehre_aus(binary, graph, stimmen):
    """One measurement under the lock; returns the dict the test prints."""
    env = dict(os.environ, BK_KOSTEN_GRAPH=graph)
    if stimmen:
        env["BK_KOSTEN_STIMMEN"] = str(stimmen)
    schloss = os.environ.get("CYPHERDJ_ECHTZEIT_SCHLOSS", SCHLOSS_STANDARD)
    os.makedirs(os.path.dirname(schloss), exist_ok=True)
    with open(schloss, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            out = subprocess.run([binary, "--ignored", "--nocapture", "--exact", "kosten_graph"], env=env,
                                 capture_output=True, text=True, check=True).stdout
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
    for zeile in out.splitlines():
        if zeile.startswith("{") and '"p50_us"' in zeile:
            return json.loads(zeile)
    raise RuntimeError("no result line in test output:\n" + out)


# --- logic ----------------------------------------------------------------------------------------------------------------
def ruhig():
    return lade_last() <= LAST_VOR and not bau_laeuft()


def warte_auf_ruhe(frist):
    """True when a quiet moment came before `frist` (monotonic time)."""
    while True:
        if ruhig():
            return True
        if jetzt() >= frist:
            return False
        schlafe(5)


def messe_einmal(binary, graph, stimmen, modus):
    vor = lade_last()
    vor_ruhig = bau_laeuft() is False
    r = fuehre_aus(binary, graph, stimmen)
    nach = lade_last()
    ok = modus == "relativ" or (vor <= LAST_VOR and nach <= LAST_NACH and vor_ruhig and not bau_laeuft())
    r.update(load1_vor=vor, load1_nach=nach, modus=modus, verworfen=not ok)
    return r


def zusammen(laeufe):
    gut = [r for r in laeufe if not r["verworfen"]]
    if not gut:
        return {"angenommen": 0}
    return {"angenommen": len(gut), "p50_us": statistics.median(r["p50_us"] for r in gut),
            "p99_us_max": max(r["p99_us"] for r in gut), "p999_us_max": max(r["p999_us"] for r in gut)}


def messe(binary, graph, stimmen, wiederholungen, warte_max, vergleich=None, melde=lambda r: None):
    frist = jetzt() + warte_max
    laeufe = []
    angenommen = 0
    while angenommen < wiederholungen:
        if not warte_auf_ruhe(frist):
            break
        r = messe_einmal(binary, graph, stimmen, "ruhig")
        melde(r)
        laeufe.append(r)
        angenommen += 0 if r["verworfen"] else 1
    if angenommen >= wiederholungen:
        return {"modus": "ruhig", "laeufe": laeufe, "neu": zusammen(laeufe)}
    # no quiet window: relative mode, old and new back to back under the same load
    rel = []
    alt = []
    for _ in range(wiederholungen):
        if vergleich:
            a = messe_einmal(binary, vergleich, stimmen, "relativ")
            melde(a)
            alt.append(a)
        n = messe_einmal(binary, graph, stimmen, "relativ")
        melde(n)
        rel.append(n)
    erg = {"modus": "relativ", "vorlaeufig": True, "laeufe": rel, "alt_laeufe": alt, "neu": zusammen(rel)}
    if alt:
        erg["alt"] = zusammen(alt)
        erg["verhaeltnis_p50"] = erg["neu"]["p50_us"] / erg["alt"]["p50_us"]
        erg["verhaeltnis_p99"] = erg["neu"]["p99_us_max"] / erg["alt"]["p99_us_max"]
    return erg


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--graph", required=True)
    ap.add_argument("--stimmen", type=int)
    ap.add_argument("--wiederholungen", type=int, default=5)
    ap.add_argument("--warte-max", type=float, default=1800)
    ap.add_argument("--vergleich")
    ap.add_argument("--binary")
    ap.add_argument("--aus")
    a = ap.parse_args(argv)
    binary = a.binary or finde_binary()
    erg = messe(binary, os.path.abspath(a.graph), a.stimmen, a.wiederholungen, a.warte_max,
                os.path.abspath(a.vergleich) if a.vergleich else None, melde=lambda r: print(json.dumps(r), flush=True))
    erg["governor"] = open("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor").read().strip() \
        if os.path.exists("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor") else None
    print(json.dumps({k: v for k, v in erg.items() if k not in ("laeufe", "alt_laeufe")}), flush=True)
    if a.aus:
        with open(a.aus, "w") as f:
            json.dump(erg, f, indent=1)
    return erg


if __name__ == "__main__":
    main()
