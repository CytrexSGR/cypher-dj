#!/usr/bin/env python3
"""ABBA lane driver for the core cost lanes (kern_kosten_arr).

Interleaved arms of kern_kosten_arr under both real-time locks, load < 1.5 checked inside, pinned
(taskset -c 4,12 for the lane thread, KOSTEN_HALL_CPUS=5,6,7). One JSON line per run into the output file.

usage: cost_lane.py <out.jsonl> <block 256|128> <cycles> <reps> <lane> arm1=K=V,K=V arm2=... --exe PATH
                      [--rep0 N] [--common K=V,...]
Arms alternate in order per repetition and the order flips every repetition (ABBA)."""
import json
import os
import re
import subprocess
import sys
import time

# The timing lock of the machine, as djk/testbench/ins_probe/all.sh names it: CYPHERDJ_TIMING_LOCK, else per user id.
LOCK1 = os.environ.get("CYPHERDJ_TIMING_LOCK") or f"/tmp/claude-{os.getuid()}/cypher-echtzeit.lock"
# Derived from this file's location (<repo>/djk/tools/cost_lane.py). CYPHERDJ_ECHTZEIT_LOCK2 overrides it for
# runs from a git worktree, where the derived path is not the lock the studio holds.
LOCK2 = os.environ.get("CYPHERDJ_ECHTZEIT_LOCK2") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", ".echtzeit.lock")

PACE_US = {256: 5333, 128: 2667}

INNER = r'''
for i in $(seq 1 720); do la=$(cut -d" " -f1 /proc/loadavg); awk -v l=$la 'BEGIN{exit !(l<1.5)}' && break; sleep 5; done
la=$(cut -d" " -f1 /proc/loadavg)
awk -v l=$la 'BEGIN{exit !(l<1.5)}' || { echo "$la $la 99"; exit 0; }
taskset -c 4,12 "$EXE" "$CYC" "$LANE" > "$OUTF" 2> "$ERRF"
rc=$?
la2=$(cut -d" " -f1 /proc/loadavg)
echo "$la $la2 $rc"
'''


def parse(out_text):
    """Pure: parse the HASH line and the JSON line of one run; {} when the run printed nothing."""
    r = {}
    m = re.search(r"HASH lane=(\S+) pm=(\w+) out=(\w+) blocks=(\d+) (.*)", out_text)
    if m:
        r["pm"], r["out"], r["blocks"] = m.group(2), m.group(3), int(m.group(4))
        for kv in m.group(5).split():
            if "=" not in kv:
                continue
            k, v = kv.split("=", 1)
            try:
                r[k] = int(v)
            except ValueError:
                r[k] = v
    m = re.search(r'\{"lage".*\}', out_text)
    if m:
        r.update(json.loads(m.group(0)))
    return r


def arm_env(block, common, arm):
    """Pure: base environment of a lane run plus common and per-arm overrides. KeyError for unpaced blocks."""
    base = {"KOSTEN_BLOCK": str(block), "KOSTEN_HALL_FAEDEN": "3", "KOSTEN_HALL_CPUS": "5,6,7",
            "KOSTEN_ARR_PRIO": "70", "KOSTEN_PACE_US": str(PACE_US[block]), "KOSTEN_HASH": "1"}
    base.update(common)
    base.update(arm)
    return base


def main():
    if not os.environ.get("LANE_SCHLOSS"):   # hold both locks for the whole campaign (a per-run lock would starve behind shared holders)
        os.environ["LANE_SCHLOSS"] = "1"
        os.execvp("flock", ["flock", LOCK1, "flock", LOCK2, sys.executable] + sys.argv)
    a = sys.argv[1:]
    out, blk, cyc, reps, lane = a[0], int(a[1]), int(a[2]), int(a[3]), a[4]
    exe = None
    common = {}
    arms = []
    rep0 = 1
    i = 5
    while i < len(a):
        if a[i] == "--exe":
            exe = a[i + 1]
            i += 2
        elif a[i] == "--rep0":
            rep0 = int(a[i + 1])
            i += 2
        elif a[i] == "--common":
            common = dict(kv.split("=", 1) for kv in a[i + 1].split(",") if kv)
            i += 2
        else:
            name, _, env = a[i].partition("=")
            arms.append((name, dict(kv.split("=", 1) for kv in env.split(",") if kv)))
            i += 1
    if not exe:
        sys.exit("--exe PATH is required")
    import tempfile
    tmp = tempfile.mkdtemp(prefix="kosten_lane_", dir=os.environ.get("TMPDIR"))
    f = open(out, "a")
    for rep in range(rep0, rep0 + reps):
        order = arms if rep % 2 == 1 else arms[::-1]
        for name, env in order:
            e = dict(os.environ)
            e.update(arm_env(blk, common, env))
            e.update(EXE=env.get("EXE", exe), CYC=str(cyc), LANE=lane, OUTF=f"{tmp}/lane.out", ERRF=f"{tmp}/lane.err")
            p = subprocess.run(["bash", "-c", INNER], env=e, capture_output=True, text=True)
            la, la2, rc = (p.stdout.split() + ["?", "?", "?"])[:3]
            r = parse(open(e["OUTF"]).read()) if rc != "99" else {}
            rec = {"blk": blk, "cycles": cyc, "lane": lane, "rep": rep, "arm": name, "env": env,
                   "load_vor": la, "load_nach": la2, "rc": rc, "r": r}
            err = open(e["ERRF"]).read() if os.path.exists(e["ERRF"]) else ""
            rec["err_tail"] = err.strip().splitlines()[-1][:300] if err.strip() else ""
            m = re.search(r"track phase:.*", err)
            if m:
                rec["spur_zeile"] = m.group(0)
            f.write(json.dumps(rec) + "\n")
            f.flush()
            print(rep, name, la, rc, r.get("median_us"), r.get("p999_us"), r.get("max_us"),
                  r.get("spur_rack_worker"), flush=True)
    f.write(json.dumps({"fertig": time.strftime("%H:%M:%S")}) + "\n")


if __name__ == "__main__":
    main()
