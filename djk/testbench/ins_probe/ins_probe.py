#!/usr/bin/env python3
"""ins_probe: scenario runner and analysis for the insert-host round trip (plan 1.11, task 1; measuring tool, not product).

  ins_probe.py selbsttest                       self-test of the analysis with a fake producer thread (no JACK)
  ins_probe.py <gesund|stopp|kill> --host-unit U [--dauer 30] [--signal ton|puls] [--out DIR] [--tag T]
  ins_probe.py rundweg --host-unit U            impulse round trip (signal puls), prints the delay in samples
  ins_probe.py analyse PREFIX                   analysis of a stored run

The probe client (ins_probe.c) is built on demand into $INS_PROBE_BIN_DIR (default ~/messungen/2026-11-10-1.11-plugins/t1/bin).
Scenario `stopp`: SIGSTOP to the main process of the unit at 10 s, SIGCONT at 20 s. `kill`: SIGKILL at 10 s.
Env INS_PROBE_MUTATION=1 builds an off-by-one into the impulse search (the self-test must then fail).
"""
import argparse
import json
import os
import statistics
import struct
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIN_DIR = Path(os.environ.get("INS_PROBE_BIN_DIR", os.path.expanduser("~/messungen/2026-11-10-1.11-plugins/t1/bin")))
MUTATION = os.environ.get("INS_PROBE_MUTATION") == "1"


def build() -> Path:
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    exe = BIN_DIR / "ins_probe"
    src = HERE / "ins_probe.c"
    if not exe.exists() or exe.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(["gcc", "-O2", "-Wall", "-Wextra", "-o", str(exe), str(src), "-ljack", "-lm", "-lpthread"], check=True)
    return exe


def load(prefix):
    import numpy as np
    meta = json.load(open(prefix + ".meta.json"))
    raw = np.fromfile(prefix + ".raw.f32", dtype=np.float32).reshape(-1, 3)
    rows = [l.strip().split(",") for l in open(prefix + ".cyc.csv")][1:]
    cyc = {"t_ns": [int(r[1]) for r in rows], "gap_ns": [int(r[2]) for r in rows], "out_peak": [float(r[4]) for r in rows],
           "ret_peak": [float(r[5]) for r in rows], "equal": [int(r[6]) for r in rows], "zero": [int(r[7]) for r in rows]}
    return meta, raw, cyc


def impulse_delays(raw, window=8192):
    """Round trip in samples for every impulse of the output: the position of the largest return sample in the window after it."""
    import numpy as np
    out, ret = raw[:, 0], raw[:, 1]
    res = []
    for f in np.nonzero(np.abs(out) > 0.25)[0]:
        seg = np.abs(ret[f:f + window])
        if len(seg) < window or seg.max() < 0.02:
            continue
        d = int(np.argmax(seg))
        res.append(d + 1 if MUTATION else d)
    return res


def impulse_shape(raw, window=8192):
    """Shape of the first returned impulse: peak value, its delay, largest other sample in the window (0 = unchanged copy)."""
    import numpy as np
    out, ret = raw[:, 0], raw[:, 1]
    for f in np.nonzero(np.abs(out) > 0.25)[0]:
        seg = ret[f:f + window]
        if len(seg) < window or np.abs(seg).max() < 0.02:
            continue
        d = int(np.argmax(np.abs(seg)))
        rest = np.abs(seg).copy()
        rest[d] = 0
        return {"in_peak": float(out[f]), "ret_peak": float(seg[d]), "delay": d, "rest_max": float(rest.max()),
                "unchanged": bool(seg[d] == out[f] and rest.max() == 0.0)}
    return None


def window_stats(meta, cyc, lo_s, hi_s):
    """Statistics over the cycles that started in [lo_s, hi_s) seconds after the first cycle."""
    t0 = cyc["t_ns"][0]
    period = meta["nframes"] / meta["rate"] * 1e3
    idx = [i for i, t in enumerate(cyc["t_ns"]) if lo_s <= (t - t0) / 1e9 < hi_s and i > 0]
    if not idx:
        return {"cycles": 0}
    gaps = [cyc["gap_ns"][i] / 1e6 for i in idx]
    sig = [i for i in idx if cyc["out_peak"][i] > 0]
    return {"cycles": len(idx), "period_ms": round(period, 3), "gap_max_ms": round(max(gaps), 3),
            "dev_max_ms": round(max(abs(g - period) for g in gaps), 3), "gap_p99_ms": round(sorted(gaps)[int(0.99 * (len(gaps) - 1))], 3),
            "ret_peak_max": round(max(cyc["ret_peak"][i] for i in idx), 4),
            "zero_while_signal": sum(1 for i in sig if cyc["zero"][i]), "signal_cycles": len(sig),
            "equal_nonzero": sum(1 for i in idx if cyc["equal"][i] and not cyc["zero"][i])}


def analyse(prefix, events=None):
    meta, raw, cyc = load(prefix)
    if len(cyc["t_ns"]) < 2:
        return {"error": "no cycles logged", "prefix": prefix}
    total = (cyc["t_ns"][-1] - cyc["t_ns"][0]) / 1e9
    res = {"prefix": prefix, "meta": meta, "duration_s": round(total, 3), "overall": window_stats(meta, cyc, 0, 1e9)}
    d = impulse_delays(raw)
    sh = impulse_shape(raw)
    if sh:
        res["shape"] = sh
    if d:
        res["delays"] = d
        res["delay_median"] = statistics.median(d)
        res["delay_spread"] = max(d) - min(d)
    if events:
        t0 = cyc["t_ns"][0] / 1e9
        res["events"] = events
        bounds = [0] + [e["t"] for e in events] + [1e9]
        res["windows"] = [dict(window_stats(meta, cyc, bounds[i], bounds[i + 1]), lo=bounds[i], hi=min(bounds[i + 1], round(total, 1)))
                          for i in range(len(bounds) - 1)]
        # first cycle with exact-zero return while signal after each event, in ms
        for e in events:
            first = None
            for i, t in enumerate(cyc["t_ns"]):
                if (t - cyc["t_ns"][0]) / 1e9 >= e["t"] and cyc["zero"][i] and cyc["out_peak"][i] > 0:
                    first = round((t - cyc["t_ns"][0]) / 1e6 - e["t"] * 1e3, 1)
                    break
            e["first_zero_return_after_ms"] = first
    return res


def selbsttest():
    exe = build()
    d = BIN_DIR / "selbsttest"
    d.mkdir(parents=True, exist_ok=True)
    fails = []

    def lauf(name, fake, signal):
        p = str(d / name)
        subprocess.run([str(exe), "--prefix", p, "--dauer", "3", "--signal", signal, "--fake", fake], check=True)
        return analyse(p)

    r = lauf("delay300", "delay:300", "puls")
    print("delay 300 ->", r.get("delay_median"), "spread", r.get("delay_spread"), "n", len(r.get("delays", [])))
    if r.get("delay_median") != 300 or r.get("delay_spread") != 0 or len(r.get("delays", [])) < 4:
        fails.append(f"delay: expected 300 +/- 0, got {r.get('delays')}")
    r = lauf("gesund", "delay:300", "ton")
    s = r["overall"]
    print("healthy tone -> equal_nonzero", s["equal_nonzero"], "zero_while_signal", s["zero_while_signal"], "of", s["signal_cycles"])
    if s["equal_nonzero"] != 0 or s["zero_while_signal"] > 8:  # up to 8 start-up blocks (300 samples at 64 per block = 5)
        fails.append(f"control: healthy fake flagged: {s}")
    r = lauf("wdh", "wdh", "ton")
    s = r["overall"]
    print("repeated block -> equal_nonzero", s["equal_nonzero"], "of", s["cycles"])
    if s["equal_nonzero"] < 0.5 * s["cycles"]:
        fails.append(f"repeat not detected: {s}")
    r = lauf("stille", "stille", "ton")
    s = r["overall"]
    print("silence -> zero_while_signal", s["zero_while_signal"], "of", s["signal_cycles"])
    if s["zero_while_signal"] < 0.9 * s["signal_cycles"]:
        fails.append(f"silence not detected: {s}")
    if fails:
        for f in fails:
            print("FAIL:", f)
        return 1
    print("selbsttest OK")
    return 0


def sh(*a, check=True):
    return subprocess.run(a, check=check, capture_output=True, text=True)


def main_pid(unit):
    out = sh("systemctl", "--user", "show", "-p", "MainPID", "--value", unit).stdout.strip()
    return int(out or 0)


def wine_pids(unit):
    """PIDs of the unit's cgroup whose command line names yabridge-host (the Wine side of the bridge)."""
    cg = sh("systemctl", "--user", "show", "-p", "ControlGroup", "--value", unit).stdout.strip()
    out = []
    try:
        for pid in open(f"/sys/fs/cgroup{cg}/cgroup.procs").read().split():
            cl = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
            if "yabridge-host" in cl:
                out.append(int(pid))
    except OSError:
        pass
    return out


def pw_link(src, dst):
    r = sh("pw-link", src, dst, check=False)
    return r.returncode == 0 or "File exists" in r.stderr


def szenario(a):
    import signal as sg
    exe = build()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    tag = a.tag or f"{a.szenario}-{a.host_unit}"
    prefix = str(out / tag)
    sigmode = "puls" if a.szenario == "rundweg" else a.signal
    dauer = a.dauer if a.szenario != "rundweg" else min(a.dauer, 12)
    pid = main_pid(a.host_unit)
    if not pid:
        print(f"unit {a.host_unit} has no main process", file=sys.stderr)
        return 2
    cmd = ["/usr/bin/pw-jack", str(exe), "--prefix", prefix, "--dauer", str(dauer), "--signal", sigmode, "--name", a.probe_name]
    env = dict(os.environ, PIPEWIRE_PROPS=a.probe_props, PIPEWIRE_QUANTUM=f"{a.quantum}/48000")
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, env=env)
    line = p.stdout.readline()
    if "ready" not in line:
        print("probe did not start:", line, file=sys.stderr)
        return 3
    c = a.host_client
    out_links = [(f"{a.probe_name}:arr_ins_1_L", f"{c}:audio-in1"), (f"{a.probe_name}:arr_ins_1_R", f"{c}:audio-in2")]
    ret_links = [(f"{c}:audio-out1", f"{a.probe_name}:arr_insret_1_L"), (f"{c}:audio-out2", f"{a.probe_name}:arr_insret_1_R")]
    # default order = studio order (djk-instrumente links the send side first, so the return link is the one PipeWire treats as
    # feedback); --rueck-zuerst links the return first (the send link is then the feedback link, a stalled sync host blocks the probe)
    order = ret_links + out_links if a.rueck_zuerst else out_links + ret_links
    res_l = [pw_link(x, y) for x, y in order]
    ok = all(r for (x, y), r in zip(order, res_l) if not x.endswith("audio-out2"))  # out2 of a one-output plugin may not exist
    t0 = time.monotonic()
    events = []
    plan = {"killwine": [(10, sg.SIGKILL, "SIGKILL yabridge-host")], "gesund": [], "rundweg": [], "stopp": [(10, sg.SIGSTOP, "SIGSTOP"), (20, sg.SIGCONT, "SIGCONT")], "kill": [(10, sg.SIGKILL, "SIGKILL")]}[a.szenario]
    wall0 = None
    for t, s, nm in plan:
        time.sleep(max(0, t0 + t - time.monotonic()))
        try:
            if a.szenario == "killwine":
                for wp in wine_pids(a.host_unit):
                    os.kill(wp, s)
            else:
                os.kill(pid, s)
            events.append({"t": None, "wall": time.monotonic(), "signal": nm})
        except ProcessLookupError:
            events.append({"t": None, "wall": time.monotonic(), "signal": nm + " (process gone)"})
    rc = p.wait(timeout=dauer + 30)
    # event times relative to the first logged cycle (both CLOCK_MONOTONIC)
    first_ns = int(open(prefix + ".cyc.csv").readlines()[1].split(",")[1])
    for e in events:
        e["t"] = round(e["wall"] - first_ns / 1e9, 4)
        del e["wall"]
    res = analyse(prefix, events)
    res.update({"szenario": a.szenario, "host_unit": a.host_unit, "linked": ok, "probe_exit": rc, "loadavg": open("/proc/loadavg").read().split()[0]})
    json.dump(res, open(prefix + ".json", "w"), indent=1)
    print(json.dumps({k: res[k] for k in res if k not in ("meta", "delays")}, indent=1))
    return 0 if rc == 0 else 4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("szenario", choices=["selbsttest", "gesund", "stopp", "kill", "killwine", "rundweg", "analyse"])
    ap.add_argument("prefix", nargs="?")
    ap.add_argument("--host-unit")
    ap.add_argument("--host-client", help="JACK client name of the host (default: the unit name)")
    ap.add_argument("--dauer", type=float, default=30)
    ap.add_argument("--signal", default="ton", choices=["ton", "puls"])
    ap.add_argument("--out", default=os.path.expanduser("~/messungen/2026-11-10-1.11-plugins/t1"))
    ap.add_argument("--tag")
    ap.add_argument("--probe-name", default="cypherdj-probe")
    ap.add_argument("--probe-props", default="{ node.group = cypherdj-ins1 node.lock-quantum = true }")
    ap.add_argument("--rueck-zuerst", action="store_true", help="link the return ports before the send ports")
    ap.add_argument("--quantum", type=int, default=256)
    a = ap.parse_args()
    if a.szenario == "selbsttest":
        return selbsttest()
    if a.szenario == "analyse":
        print(json.dumps(analyse(a.prefix), indent=1))
        return 0
    if not a.host_unit:
        ap.error("--host-unit required")
    a.host_client = a.host_client or a.host_unit
    return szenario(a)


if __name__ == "__main__":
    sys.exit(main())
